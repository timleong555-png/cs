/* ==========================================================================
   BOT VISION CONE, ACOUSTIC PERCEPTION, SHARED INTEL & THREAT SCORING
   ========================================================================== */
import {
    world,
    matchState,
    c4State,
    FIXED_VISION_RANGE,
    FIXED_VISION_HALF_FOV,
    getAWPScopeConfig,
    rnd,
    normalizeAngle,
    audio,
    showAnnouncerBanner,
    registerSquadHelpHandler,
    registerBallisticImpactHandler,
    registerTagConfirmHandler,
    recordDeducedAWPNest
} from '../state.js';
import {
    MAP,
    TACTICAL_CORNERS,
    T_STRATEGIES,
    isInsideExpandedSite,
    getBotPowerPosition
} from '../js-map-physics/dedust2map.js';
import {
    checkWallCollision,
    getMapLineOfSight,
    hasClearEntitySightline,
    getLineOfSight,
    getRayObstacleEndpoint,
    isInsideSmoke,
    getFuzzedAcousticPos,
    lineIntersectsCircle,
    canBulletPenetrateTo,
    hasThickWallBetween
} from '../js-map-physics/map-physics.js';
import { worldToNavCell, navCellToWorld } from '../js-map-physics/Map-Finding.js';

const SITE_SWEEP_ANCHORS = [
    // Bombsite A pockets (Twin Pillars, East Cubby, A Short Door & CT Ramp)
    { x: 1890, y: 180 }, { x: 2050, y: 135 }, { x: 2048, y: 215 },
    { x: 2220, y: 175 }, { x: 2220, y: 340 }, { x: 2038, y: 542 },
    // Bombsite B pockets (Pillars, Widened Doors, Ant Hill Exits & Bottom-Right Cubby)
    { x: 2280, y: 1820 }, { x: 2165, y: 1715 }, { x: 2165, y: 1530 },
    { x: 2280, y: 1525 }, { x: 2464, y: 1680 }, { x: 2486, y: 1895 },
    { x: 2310, y: 1435 }, { x: 2000, y: 1715 }
];

const lastTopoIntelUpdate = { CT: 0, T: 0 };
const lastSuspicionClearUpdate = { CT: 0, T: 0 };

/* ==========================================================================
   VISION, SMOKE CLUSTER & LINE-OF-SIGHT QUERIES
   ========================================================================== */
export function getConnectedSmokeCluster(seedCloud) {
    if (!seedCloud) return null;
    const activeClouds = (world.smokeClouds || []).filter(c => c && c.life > 0.35);
    if (activeClouds.length === 0) return null;

    const cluster = [seedCloud];
    const visited = new Set([seedCloud]);
    let head = 0;

    while (head < cluster.length) {
        const cur = cluster[head++];
        for (let i = 0; i < activeClouds.length; i++) {
            const other = activeClouds[i];
            if (visited.has(other)) continue;
            // Treat overlapping or consecutive smokes (gap <= 60px) as one unified smoke cloud
            if (Math.hypot(other.x - cur.x, other.y - cur.y) <= (cur.radius + other.radius + 60)) {
                visited.add(other);
                cluster.push(other);
            }
        }
    }

    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < cluster.length; i++) {
        sumX += cluster[i].x;
        sumY += cluster[i].y;
    }
    const centerX = sumX / cluster.length;
    const centerY = sumY / cluster.length;

    let effectiveRadius = seedCloud.radius;
    for (let i = 0; i < cluster.length; i++) {
        const edgeDist = Math.hypot(cluster[i].x - centerX, cluster[i].y - centerY) + cluster[i].radius;
        if (edgeDist > effectiveRadius) effectiveRadius = edgeDist;
    }

    return {
        clouds: cluster,
        x: centerX,
        y: centerY,
        radius: effectiveRadius,
        owner: seedCloud.owner
    };
}

export function isPointInSmokeCluster(x, y, cluster, margin = 12) {
    if (!cluster || !cluster.clouds) return false;
    for (let i = 0; i < cluster.clouds.length; i++) {
        const c = cluster.clouds[i];
        if (c.life > 0.35 && Math.hypot(x - c.x, y - c.y) <= (c.radius + margin)) {
            return true;
        }
    }
    return false;
}

export function isPointVisibleToBot(bot, targetX, targetY) {
    if (!bot || bot.isDead) return false;
    const isScoped = bot.isScoped && bot.getEquippedKey() === "AWP";
    const scopeCfg = isScoped ? getAWPScopeConfig(bot.scopeLevel) : null;
    const maxRange = scopeCfg ? scopeCfg.visionRange : FIXED_VISION_RANGE;
    const halfFov = scopeCfg ? scopeCfg.halfFov : FIXED_VISION_HALF_FOV;

    const dist = Math.hypot(targetX - bot.x, targetY - bot.y);
    if (dist > maxRange) return false;

    const angleToTarget = Math.atan2(targetY - bot.y, targetX - bot.x);
    const diff = Math.abs(normalizeAngle(angleToTarget - bot.angle));
    if (diff > halfFov) return false;

    return getLineOfSight(bot.x, bot.y, targetX, targetY);
}

/* ==========================================================================
   SHARED TEAM SIGHTINGS & TOPOLOGICAL INTEL
   ========================================================================== */
export function registerEnemySightingCT(enemy, spotter = null) {
    if (!enemy || enemy.isDead || enemy.team !== "T") return;
    world.lastEnemyIntelTimeCT = world.gameTime;
    world.sharedEnemyIntelCT[enemy.id] = {
        id: enemy.id,
        x: enemy.x,
        y: enemy.y,
        time: world.gameTime,
        enemy,
        spotter,
        isSpotCleared: false
    };
}

export function registerEnemySightingT(enemy) {
    if (!enemy || enemy.isDead || enemy.team !== "CT") return;
    world.lastEnemyIntelTimeT = world.gameTime;
    world.sharedEnemyIntelT[enemy.id] = {
        id: enemy.id,
        x: enemy.x,
        y: enemy.y,
        time: world.gameTime,
        enemy,
        isSpotCleared: false
    };
}

export function updateTopologicalIntel(team) {
    const intelMap = (team === "CT") ? world.sharedEnemyIntelCT : world.sharedEnemyIntelT;
    const friendlyTeam = (team === "CT") ? world.livingCT : world.livingT;

    for (const id in intelMap) {
        const intel = intelMap[id];
        if (!intel || intel.enemy.isDead) {
            delete intelMap[id];
            continue;
        }

        if (!intel.isSpotCleared) {
            for (let i = 0; i < friendlyTeam.length; i++) {
                const member = friendlyTeam[i];
                const distToSpot = Math.hypot(intel.x - member.x, intel.y - member.y);
                if (distToSpot <= FIXED_VISION_RANGE && getLineOfSight(member.x, member.y, intel.x, intel.y)) {
                    const enemyAtSpot = Math.hypot(intel.enemy.x - intel.x, intel.enemy.y - intel.y) < 65;
                    if (!enemyAtSpot) {
                        intel.isSpotCleared = true;
                    }
                    break;
                }
            }
        }
    }
}

export function getSquadMacroSearchTarget(bot, intel) {
    if (!intel) return null;

    if (!intel.isSpotCleared) {
        const isClosest = !world.livingCT.some(other =>
            other !== bot &&
            Math.hypot(intel.x - other.x, intel.y - other.y) < Math.hypot(intel.x - bot.x, intel.y - bot.y)
        );
        if (isClosest) {
            return { x: intel.x, y: intel.y, role: "POINT" };
        }
    }

    const spreadAngle = ((bot.id % 4) * (Math.PI / 2)) + 0.4;
    const tx = intel.x + Math.cos(spreadAngle) * 160;
    const ty = intel.y + Math.sin(spreadAngle) * 160;
    const snapped = navCellToWorld(worldToNavCell(tx, ty));
    return { x: snapped.x, y: snapped.y, role: "CUTOFF" };
}

/* ==========================================================================
   SYNCHRONIZED SECTOR & SUSPICION CLEARING
   ========================================================================== */
export function recordClearedSector(team, x, y, duration = 6.0) {
    if (!world.tacticalIntel) return;
    if (!world.tacticalIntel.clearedSectors) {
        world.tacticalIntel.clearedSectors = { CT: [], T: [] };
    }
    const list = world.tacticalIntel.clearedSectors[team];
    if (!list) return;

    const existing = list.find(s => Math.hypot(s.x - x, s.y - y) < 110);
    if (existing) {
        existing.expiresAt = Math.max(existing.expiresAt, world.gameTime + duration);
    } else {
        list.push({ x, y, expiresAt: world.gameTime + duration });
    }
}

export function isSectorRecentlyCleared(team, x, y, radius = 145) {
    if (!world.tacticalIntel || !world.tacticalIntel.clearedSectors) return false;
    const list = world.tacticalIntel.clearedSectors[team];
    if (!list || list.length === 0) return false;

    for (let i = list.length - 1; i >= 0; i--) {
        if (world.gameTime >= list[i].expiresAt) {
            list.splice(i, 1);
            continue;
        }
        if (Math.hypot(list[i].x - x, list[i].y - y) <= radius) {
            return true;
        }
    }
    return false;
}

function syncClearedAngleMemory(team, x, y, radius = 120) {
    recordClearedSector(team, x, y, 6.0);

    const hotzones = world.tacticalIntel?.killerHotzones?.[team] || [];
    for (let i = 0; i < hotzones.length; i++) {
        const hz = hotzones[i];
        if (!hz.clearedThisRound && world.gameTime >= (hz.confirmedUntil || 0) &&
            Math.hypot(hz.x - x, hz.y - y) <= radius) {
            hz.clearedThisRound = true;
        }
    }

    const legacyMem = world.teamSuspicionMemory?.[team] || [];
    for (let i = 0; i < legacyMem.length; i++) {
        const sp = legacyMem[i];
        if (!sp.clearedThisRound && Math.hypot(sp.x - x, sp.y - y) <= radius) {
            sp.clearedThisRound = true;
        }
    }
}

export function updateSuspiciousSpotClearing(team) {
    const memoryList = world.teamSuspicionMemory[team];
    if (!memoryList || memoryList.length === 0) return;

    const aliveTeammates = team === "CT" ? world.livingCT : world.livingT;
    const livingEnemies = team === "CT" ? world.livingT : world.livingCT;

    for (let i = 0; i < memoryList.length; i++) {
        const spot = memoryList[i];
        if (spot.clearedThisRound) continue;

        for (const mate of aliveTeammates) {
            const distToSpot = Math.hypot(spot.x - mate.x, spot.y - mate.y);
            if (distToSpot <= FIXED_VISION_RANGE && getLineOfSight(mate.x, mate.y, spot.x, spot.y)) {
                const enemyPresent = livingEnemies.some(e => Math.hypot(e.x - spot.x, e.y - spot.y) < 100);
                if (!enemyPresent) {
                    syncClearedAngleMemory(team, spot.x, spot.y, 120);
                }
                break;
            }
        }
    }
}

export function getRelevantSuspiciousSpot(bot) {
    if (!bot || bot.isDead) return null;
    const memoryList = world.teamSuspicionMemory[bot.team];
    if (!memoryList || memoryList.length === 0) return null;

    const plantSiteObj = c4State.isPlanted ? (c4State.plantSite === 'B' ? MAP.siteB : MAP.siteA) : null;

    let bestSpot = null;
    let highestPriority = -Infinity;

    for (let i = 0; i < memoryList.length; i++) {
        const spot = memoryList[i];
        if (spot.clearedThisRound) continue;
        if (plantSiteObj && !isInsideExpandedSite(spot.x, spot.y, plantSiteObj)) continue;

        const dist = Math.hypot(spot.x - bot.x, spot.y - bot.y);
        if (dist >= 70 && dist <= 520) {
            const priority = (spot.kills * 200) + (520 - dist);
            if (priority > highestPriority) {
                highestPriority = priority;
                bestSpot = spot;
            }
        }
    }

    return bestSpot;
}

function sweepVisibleSectorsForBot(bot) {
    if (!bot || bot.isDead || bot.blindTimer > 1.0) return;
    const enemies = bot.team === "CT" ? world.livingT : world.livingCT;

    // 1. Instant clearance for bombsite anchor pockets swept by this bot's vision cone
    for (let i = 0; i < SITE_SWEEP_ANCHORS.length; i++) {
        const pt = SITE_SWEEP_ANCHORS[i];
        if (!isPointVisibleToBot(bot, pt.x, pt.y)) continue;
        const enemyNear = enemies.some(e => !e.isDead && Math.hypot(e.x - pt.x, e.y - pt.y) < 155);
        if (!enemyNear) {
            recordClearedSector(bot.team, pt.x, pt.y, 6.0);
        }
    }

    // 2. Synchronized clearance for Killer Hotzones & suspicion memory seen empty
    const hotzones = world.tacticalIntel?.killerHotzones?.[bot.team] || [];
    for (let i = 0; i < hotzones.length; i++) {
        const hz = hotzones[i];
        if (hz.clearedThisRound || world.gameTime < (hz.confirmedUntil || 0)) continue;
        if (isPointVisibleToBot(bot, hz.x, hz.y)) {
            const enemyNear = enemies.some(e => !e.isDead && Math.hypot(e.x - hz.x, e.y - hz.y) < 120);
            if (!enemyNear) {
                syncClearedAngleMemory(bot.team, hz.x, hz.y, 120);
            }
        }
    }

    const legacyMem = world.teamSuspicionMemory?.[bot.team] || [];
    for (let i = 0; i < legacyMem.length; i++) {
        const sp = legacyMem[i];
        if (sp.clearedThisRound) continue;
        if (isPointVisibleToBot(bot, sp.x, sp.y)) {
            const enemyNear = enemies.some(e => !e.isDead && Math.hypot(e.x - sp.x, e.y - sp.y) < 120);
            if (!enemyNear) {
                syncClearedAngleMemory(bot.team, sp.x, sp.y, 120);
            }
        }
    }

    // 3. Clear deduced AWP nests once a friendly vision cone confirms the angle is empty
    const nests = world.tacticalIntel?.deducedAWPNests?.[bot.team] || [];
    for (let i = nests.length - 1; i >= 0; i--) {
        const nest = nests[i];
        if (world.gameTime >= nest.expiresAt) {
            nests.splice(i, 1);
            continue;
        }
        if (isPointVisibleToBot(bot, nest.x, nest.y)) {
            const enemyNear = enemies.some(e => !e.isDead && Math.hypot(e.x - nest.x, e.y - nest.y) < 140);
            if (!enemyNear) {
                nests.splice(i, 1);
            }
        }
    }
}

/* ==========================================================================
   SQUAD DISTRESS CALLS & THREAT SCORING
   ========================================================================== */
export function emitSquadHelp(victim, attacker, approxOrigin = null) {
    if (!victim || victim.isDead || victim.health <= 0) return;
    if (!attacker || attacker.team === victim.team) return;

    const isSiteA = (victim.x > 1550 && victim.y < 650) || (attacker.x > 1550 && attacker.y < 650);
    const isSiteB = (victim.x > 1650 && victim.y > 1150) || (attacker.x > 1650 && attacker.y > 1150);
    const engagementSite = isSiteA ? 'A' : (isSiteB ? 'B' : 'MID');

    const existingDistress = world.squadHelpSignals.find(
        s => s.victim === victim && s.team === victim.team && (world.gameTime - s.time < 1.5)
    );
    if (!existingDistress) {
        if (victim.team === "CT") {
            world.lastEnemyIntelTimeCT = world.gameTime;
            registerEnemySightingCT(attacker);
        }
        const deducedPos = approxOrigin
            ? { x: approxOrigin.x, y: approxOrigin.y }
            : { x: attacker.x, y: attacker.y };
        world.squadHelpSignals.push({
            victim,
            attacker,
            team: victim.team,
            victimPos: { x: victim.x, y: victim.y },
            enemyPos: deducedPos,
            approxPos: deducedPos,
            engagementSite,
            time: world.gameTime
        });
    }

    if (attacker.team === "CT" && victim.team === "T") {
        world.lastEnemyIntelTimeCT = world.gameTime;
        registerEnemySightingCT(victim);

        const existingOffensive = world.squadHelpSignals.find(
            s => s.team === "CT" && s.targetEnemy === victim && (world.gameTime - s.time < 1.5)
        );
        if (!existingOffensive) {
            world.squadHelpSignals.push({
                victim: attacker,
                targetEnemy: victim,
                attacker,
                team: "CT",
                victimPos: { x: attacker.x, y: attacker.y },
                enemyPos: { x: victim.x, y: victim.y },
                engagementSite,
                time: world.gameTime,
                isOffensiveSupport: true
            });
        }
    }
}

registerSquadHelpHandler(emitSquadHelp);

export function emitEnemySpotted(spotter, enemy) {
    if (!spotter || spotter.isDead || !enemy || enemy.isDead) return;
    if (spotter.team !== "CT") return;

    const isSiteA = (enemy.x > 1550 && enemy.y < 650);
    const isSiteB = (enemy.x > 1650 && enemy.y > 1150);
    const engagementSite = isSiteA ? 'A' : (isSiteB ? 'B' : 'MID');

    const existing = world.squadHelpSignals.find(
        s => s.team === "CT" && s.targetEnemy === enemy && (world.gameTime - s.time < 3.5)
    );
    if (!existing) {
        world.squadHelpSignals.push({
            victim: spotter,
            attacker: enemy,
            targetEnemy: enemy,
            team: "CT",
            victimPos: { x: spotter.x, y: spotter.y },
            enemyPos: { x: enemy.x, y: enemy.y },
            engagementSite,
            time: world.gameTime,
            isSpottedCall: true
        });
    }
}

export function shouldCTBotSupport(bot, signal) {
    if (!bot || bot.isDead || bot.team !== "CT" || !signal) return false;
    if (bot === signal.victim) return false;
    if (bot.isDefusing || bot.targetEnemy) return false;

    const enemy = signal.targetEnemy || signal.attacker;
    const isC4Confirmed = (enemy && enemy.hasC4) ||
        (c4State.ctSeenDropped && Math.hypot(c4State.dropX - signal.enemyPos.x, c4State.dropY - signal.enemyPos.y) < 650);

    if (isC4Confirmed) return true;

    const distToThreat = Math.hypot(signal.enemyPos.x - bot.x, signal.enemyPos.y - bot.y);
    if (distToThreat < 950 || bot.isRoamingPatrol) return true;
    if (bot.assignedCTStrat && bot.assignedCTStrat.site === "MID") return true;
    if (bot.archetype === "ENTRY" || bot.archetype === "SUPPORT") return true;

    if (bot.assignedCTStrat && bot.assignedCTStrat.site !== signal.engagementSite) {
        const teammatesAtMySite = world.livingCT.filter(
            other => other !== bot && other.assignedCTStrat && other.assignedCTStrat.site === bot.assignedCTStrat.site
        );
        if (teammatesAtMySite.length > 0 && (bot.id % 2 === 0)) {
            return true;
        }
        return distToThreat < 1050;
    }

    return true;
}

export function getSensoryDistraction(bot) {
    if (!bot) return 0;
    let distraction = 0;

    if (bot.blindTimer > 0) {
        distraction += Math.min(0.8, bot.blindTimer / 1.5);
    }

    for (const ev of world.recentAcousticEvents) {
        const dist = Math.hypot(ev.x - bot.x, ev.y - bot.y);
        if (dist < 750) {
            distraction += (1 - dist / 750) * ev.intensity;
        }
    }

    return Math.min(0.85, distraction);
}

export function calculateEnemyThreatScore(bot, enemy, dist) {
    let score = Math.max(0, 1000 - dist);

    const isDefusing = enemy.isDefusing || (c4State.isBeingDefused && c4State.designatedDefuser === enemy);
    const isPlanting = enemy.executePhase === "PLANT_LOCK" || c4State.planter === enemy;
    if (isDefusing || isPlanting) score += 800;

    if (bot.lastHitBy === enemy && (world.gameTime - bot.lastHitTime < 2.5)) {
        score += 350;
    }
    if (enemy.health <= 35) score += 180;

    const angleToBot = Math.atan2(bot.y - enemy.y, bot.x - enemy.x);
    if (Math.abs(normalizeAngle(angleToBot - enemy.angle)) < 0.6) {
        score += 120;
    }
    if (bot.targetEnemy === enemy) score += 220;

    return score;
}

/* ==========================================================================
   PRE-FIRE, CORNER APEX & BALLISTIC IMPACT DEDUCTION
   ========================================================================== */
export function shouldBotPrefire(bot, targetX, targetY) {
    const wep = bot.getWeapon();
    if (wep.category === "sniper" || bot.getEquippedKey() === "AWP") return false;
    if (wep.category === "knife" || wep.category === "grenade" || wep.category === "c4") return false;
    if (bot.getCurrentClip() <= 0) return false;

    if (getLineOfSight(bot.x, bot.y, targetX, targetY)) return true;
    if (bot.prefireTimer >= 1.0) return false;
    if (hasThickWallBetween(bot.x, bot.y, targetX, targetY)) return false;

    const distToTarget = Math.hypot(targetX - bot.x, targetY - bot.y);
    const botSpeed = 190 * (wep.moveSpeedMult || 1.0);

    if (canBulletPenetrateTo(bot.x, bot.y, targetX, targetY, wep.piercingPower)) {
        const bulletTravelTime = distToTarget / wep.speed;
        const soundAge = bot.lastHeardSound ? (world.gameTime - bot.lastHeardSound.time) : 0;
        if (bulletTravelTime <= 1.0 && soundAge <= 1.0 && distToTarget <= 750) {
            return true;
        }
    }

    const futureX = bot.x + Math.cos(bot.angle) * (botSpeed * 1.0);
    const futureY = bot.y + Math.sin(bot.angle) * (botSpeed * 1.0);
    const willHaveSightWithin1s = !hasThickWallBetween(futureX, futureY, targetX, targetY);

    return willHaveSightWithin1s && distToTarget <= 650;
}

export function getCornerPeekPrefireTarget(bot, enemyX, enemyY, enemyVx = 0, enemyVy = 0) {
    for (let i = 0; i < TACTICAL_CORNERS.length; i++) {
        const corner = TACTICAL_CORNERS[i];
        const distToBot = Math.hypot(corner.x - bot.x, corner.y - bot.y);
        if (distToBot < 90 || distToBot > 650) continue;
        if (!getMapLineOfSight(bot.x, bot.y, corner.x, corner.y)) continue;

        if (Math.hypot(corner.x - enemyX, corner.y - enemyY) <= 160) {
            const toCorner = Math.atan2(corner.y - enemyY, corner.x - enemyX);
            const speed = Math.hypot(enemyVx, enemyVy);
            const movingToward = speed > 20
                ? (Math.abs(normalizeAngle(toCorner - Math.atan2(enemyVy, enemyVx))) < Math.PI * 0.45)
                : true;
            if (movingToward) {
                const edgeAngle = Math.atan2(corner.y - bot.y, corner.x - bot.x);
                return { x: corner.x + Math.cos(edgeAngle) * 15, y: corner.y + Math.sin(edgeAngle) * 15 };
            }
        }
    }
    return null;
}

export function getAnglePriorityPoint(bot, threatX, threatY) {
    const powerPos = getBotPowerPosition(bot);
    if (powerPos) {
        return { x: powerPos.doorSeamX, y: powerPos.doorSeamY, isPowerHold: true };
    }

    if (getMapLineOfSight(bot.x, bot.y, threatX, threatY)) {
        return { x: threatX, y: threatY, isPowerHold: false };
    }

    let bestCorner = null;
    let minD = Infinity;

    for (let i = 0; i < TACTICAL_CORNERS.length; i++) {
        const c = TACTICAL_CORNERS[i];
        const dBot = Math.hypot(c.x - bot.x, c.y - bot.y);
        if (dBot >= 450) continue;
        const dThreat = Math.hypot(c.x - threatX, c.y - threatY);
        if (dThreat >= 550) continue;

        const totalD = dBot + dThreat;
        if (totalD < minD && getMapLineOfSight(bot.x, bot.y, c.x, c.y)) {
            minD = totalD;
            bestCorner = c;
        }
    }

    if (bestCorner) {
        const cornerToThreat = Math.atan2(threatY - bestCorner.y, threatX - bestCorner.x);
        return {
            x: bestCorner.x + Math.cos(cornerToThreat) * 22,
            y: bestCorner.y + Math.sin(cornerToThreat) * 22,
            isPowerHold: false
        };
    }

    return { x: threatX, y: threatY, isPowerHold: false };
}

function distanceToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function handleBallisticImpact(bullet, hitX, hitY) {
    if (!bullet || !bullet.owner || !world.tacticalIntel) return;
    const speed = Math.hypot(bullet.vx || 0, bullet.vy || 0);
    if (speed < 1) return;

    const targetTeam = bullet.owner.team === "CT" ? "T" : "CT";
    const observers = targetTeam === "CT" ? world.livingCT : world.livingT;
    if (observers.length === 0) return;

    const backAngle = Math.atan2(-bullet.vy, -bullet.vx);

    // Step backward out of the wall/crate surface so ray-marching starts cleanly in open air
    let rayStartX = hitX;
    let rayStartY = hitY;
    for (let step = 12; step <= 48; step += 12) {
        const tx = hitX + Math.cos(backAngle) * step;
        const ty = hitY + Math.sin(backAngle) * step;
        if (!checkWallCollision(tx, ty, 4)) {
            rayStartX = tx;
            rayStartY = ty;
            break;
        }
    }

    const isSniper = Boolean(bullet.isAWP);
    const hearRange = isSniper ? 680 : 460;
    const originX = bullet.startX !== undefined ? bullet.startX : bullet.owner.x;
    const originY = bullet.startY !== undefined ? bullet.startY : bullet.owner.y;

    const perceivingBots = observers.filter(b =>
        b && b.isBot && !b.isDead && (
            isPointVisibleToBot(b, rayStartX, rayStartY) ||
            Math.hypot(rayStartX - b.x, rayStartY - b.y) < hearRange ||
            distanceToSegment(b.x, b.y, originX, originY, rayStartX, rayStartY) < 175
        )
    );
    if (perceivingBots.length === 0) return;

    // Reverse trajectory ray with realistic angular estimation jitter (+/- 4 deg)
    const estAngle = backAngle + (rnd() - 0.5) * 0.14;
    const corridorEnd = getRayObstacleEndpoint(rayStartX, rayStartY, estAngle, 780);
    const corridorLen = Math.hypot(corridorEnd.x - rayStartX, corridorEnd.y - rayStartY);
    if (corridorLen < 60) return;

    const actualShotDist = Math.hypot(rayStartX - originX, rayStartY - originY);

    let bestCorner = null;
    let bestCornerScore = Infinity;
    for (let i = 0; i < TACTICAL_CORNERS.length; i++) {
        const c = TACTICAL_CORNERS[i];
        const distFromImpact = Math.hypot(c.x - rayStartX, c.y - rayStartY);
        // Ignore corners closer to the impact than the actual shooter so rear flybys never snap to front corners
        if (distFromImpact < actualShotDist * 0.65) continue;

        const perpDist = distanceToSegment(c.x, c.y, rayStartX, rayStartY, corridorEnd.x, corridorEnd.y);
        if (perpDist > 135) continue;
        if (!getMapLineOfSight(c.x, c.y, rayStartX, rayStartY)) continue;

        const score = perpDist * 2.0 + Math.abs(distFromImpact - actualShotDist) * 0.35;
        if (score < bestCornerScore) {
            bestCornerScore = score;
            bestCorner = c;
        }
    }

    // Cap open-air back-projection to the actual shot travel distance so close-range shots don't project onto far back walls
    const boundedDist = Math.min(corridorLen, Math.max(85, actualShotDist));
    const deducedX = bestCorner ? bestCorner.x : (rayStartX + Math.cos(estAngle) * boundedDist);
    const deducedY = bestCorner ? bestCorner.y : (rayStartY + Math.sin(estAngle) * boundedDist);

    if (isSniper) {
        recordDeducedAWPNest(targetTeam, deducedX, deducedY, "BULLET_TRACE", 16.0);
    }

    const traces = world.tacticalIntel.ballisticTraces[targetTeam];
    const existingTrace = traces.find(t => Math.hypot(t.x - deducedX, t.y - deducedY) < 110 && (world.gameTime - t.time) < 2.0);
    if (existingTrace) {
        existingTrace.x = (existingTrace.x + deducedX) * 0.5;
        existingTrace.y = (existingTrace.y + deducedY) * 0.5;
        existingTrace.time = world.gameTime;
        existingTrace.expiresAt = world.gameTime + 3.5;
        existingTrace.hits = (existingTrace.hits || 1) + 1;
        if (isSniper) existingTrace.weaponCategory = "sniper";
    } else {
        traces.push({
            x: deducedX,
            y: deducedY,
            impactX: rayStartX,
            impactY: rayStartY,
            weaponCategory: isSniper ? "sniper" : "rifle",
            hits: 1,
            time: world.gameTime,
            expiresAt: world.gameTime + 3.5
        });
    }

    const hotzones = world.tacticalIntel.killerHotzones[targetTeam];
    const existingHz = hotzones.find(h => Math.hypot(h.x - deducedX, h.y - deducedY) < 105);
    if (existingHz) {
        existingHz.kills = Math.min(8, (existingHz.kills || 1) + (isSniper ? 2 : 1));
        existingHz.clearedThisRound = false;
        if (isSniper) existingHz.weaponCategory = "sniper";
    } else {
        hotzones.push({
            id: Math.floor(Math.random() * 100000),
            x: deducedX,
            y: deducedY,
            kills: isSniper ? 2 : 1,
            streak: 1,
            weaponCategory: isSniper ? "sniper" : "rifle",
            clearedThisRound: false,
            confirmedUntil: 0
        });
    }

    for (let i = 0; i < perceivingBots.length; i++) {
        const b = perceivingBots[i];
        const prev = b.lastHeardSound;
        if (!prev || prev.type !== "visual" || (world.gameTime - prev.time) > 1.0) {
            b.lastHeardSound = {
                x: deducedX,
                y: deducedY,
                shooter: null,
                time: world.gameTime,
                type: "firing_trace"
            };
        }
    }
}

registerBallisticImpactHandler(handleBallisticImpact);

export function handleTagConfirm(attacker, victim) {
    if (!attacker || !victim || !attacker.isBot || attacker.team === victim.team) return;
    if (!world.tacticalIntel) return;

    const wasProbeShot = Boolean(attacker.isPrefiringProbe);
    const hitWithoutDirectSight = !isPointVisibleToBot(attacker, victim.x, victim.y) || isInsideSmoke(victim.x, victim.y);
    if (!wasProbeShot && !hitWithoutDirectSight) return;

    attacker.isPrefiringProbe = false;
    const team = attacker.team;

    const hotzones = world.tacticalIntel.killerHotzones[team];
    const existingHz = hotzones.find(h => Math.hypot(h.x - victim.x, h.y - victim.y) < 120);
    if (existingHz) {
        existingHz.x = (existingHz.x + victim.x) * 0.5;
        existingHz.y = (existingHz.y + victim.y) * 0.5;
        existingHz.kills = Math.max(existingHz.kills || 0, 5);
        existingHz.streak = Math.max(existingHz.streak || 0, 5);
        existingHz.clearedThisRound = false;
        existingHz.confirmedUntil = world.gameTime + 4.0;
    } else {
        hotzones.push({
            id: Math.floor(Math.random() * 100000),
            x: victim.x,
            y: victim.y,
            kills: 5,
            streak: 5,
            weaponCategory: victim.getWeapon ? victim.getWeapon().category : "rifle",
            clearedThisRound: false,
            confirmedUntil: world.gameTime + 4.0
        });
    }

    if (team === "CT") {
        registerEnemySightingCT(victim);
        emitEnemySpotted(attacker, victim);
    } else {
        registerEnemySightingT(victim);
    }
}

registerTagConfirmHandler(handleTagConfirm);

/* ==========================================================================
   SHARED TACTICAL BLACKBOARD & UNIFIED AWP THREAT PIPELINE
   ========================================================================== */
export function updateTacticalBlackboard(team) {
    if (!world.tacticalIntel) return;
    const teammates = team === "CT" ? world.livingCT : world.livingT;
    const enemies = team === "CT" ? world.livingT : world.livingCT;

    // 1. Decay & sweep-clear 50px round deathZones once a teammate safely checks the area
    const deathZones = world.tacticalIntel.deathZones[team] || [];
    for (let i = deathZones.length - 1; i >= 0; i--) {
        const dz = deathZones[i];
        if (dz.cleared || world.gameTime >= dz.expiresAt) {
            deathZones.splice(i, 1);
            continue;
        }
        const sweptClear = teammates.some(m =>
            Math.hypot(m.x - dz.x, m.y - dz.y) < 60 &&
            getLineOfSight(m.x, m.y, dz.x, dz.y) &&
            !enemies.some(e => Math.hypot(e.x - dz.x, e.y - dz.y) < 190)
        );
        if (sweptClear) {
            dz.cleared = true;
            deathZones.splice(i, 1);
        }
    }

    // 2. Prune expired ballisticTraces
    const traces = world.tacticalIntel.ballisticTraces[team] || [];
    for (let i = traces.length - 1; i >= 0; i--) {
        if (world.gameTime >= traces[i].expiresAt) traces.splice(i, 1);
    }

    // 3. Synchronized sweep-clear of Killer Hotzones & suspicion memory once checked empty
    const hotzones = world.tacticalIntel.killerHotzones[team] || [];
    for (let i = 0; i < hotzones.length; i++) {
        const hz = hotzones[i];
        if (hz.clearedThisRound || world.gameTime < (hz.confirmedUntil || 0)) continue;
        for (let mIdx = 0; mIdx < teammates.length; mIdx++) {
            const mate = teammates[mIdx];
            if (Math.hypot(hz.x - mate.x, hz.y - mate.y) <= FIXED_VISION_RANGE &&
                getLineOfSight(mate.x, mate.y, hz.x, hz.y)) {
                const enemyStillThere = enemies.some(e => Math.hypot(e.x - hz.x, e.y - hz.y) < 110);
                if (!enemyStillThere) {
                    syncClearedAngleMemory(team, hz.x, hz.y, 120);
                }
                break;
            }
        }
    }

    // 4. Spatio-Temporal Enemy Prediction Rings
    const predicted = [];
    const intelMap = team === "CT" ? world.sharedEnemyIntelCT : world.sharedEnemyIntelT;
    const sources = [];

    for (const id in intelMap) {
        const item = intelMap[id];
        if (!item || !item.enemy || item.enemy.isDead) continue;
        const age = world.gameTime - item.time;
        if (age >= 0.45 && age <= 4.5) {
            sources.push({ x: item.x, y: item.y, age });
        }
    }
    for (let i = 0; i < traces.length; i++) {
        const tr = traces[i];
        const age = world.gameTime - tr.time;
        if (age >= 0.35 && age <= 3.5) {
            sources.push({ x: tr.x, y: tr.y, age });
        }
    }

    for (let s = 0; s < sources.length; s++) {
        const src = sources[s];
        const expandedRadius = Math.min(720, src.age * 185);
        for (let c = 0; c < TACTICAL_CORNERS.length; c++) {
            const corner = TACTICAL_CORNERS[c];
            const distFromOrigin = Math.hypot(corner.x - src.x, corner.y - src.y);
            if (Math.abs(distFromOrigin - expandedRadius) > 165) continue;
            if (!getMapLineOfSight(src.x, src.y, corner.x, corner.y)) continue;

            const alreadyWatched = teammates.some(m => Math.hypot(m.x - corner.x, m.y - corner.y) < 210);
            if (alreadyWatched) continue;

            if (!predicted.some(p => Math.hypot(p.x - corner.x, p.y - corner.y) < 110)) {
                predicted.push({
                    x: corner.x,
                    y: corner.y,
                    originX: src.x,
                    originY: src.y,
                    age: src.age,
                    radius: expandedRadius
                });
            }
        }
    }
    world.tacticalIntel.predictedZones[team] = predicted;
}

export function getTacticalBlackboardThreat(bot) {
    if (!bot || bot.isDead || !world.tacticalIntel) return null;
    const team = bot.team;
    const hotzones = world.tacticalIntel.killerHotzones[team] || [];
    const traces = world.tacticalIntel.ballisticTraces[team] || [];

    let bestThreat = null;
    let bestScore = -Infinity;

    for (let i = 0; i < hotzones.length; i++) {
        const hz = hotzones[i];
        const isConfirmed = world.gameTime < (hz.confirmedUntil || 0);
        if (hz.clearedThisRound && !isConfirmed) continue;

        const dist = Math.hypot(hz.x - bot.x, hz.y - bot.y);
        if (dist < 65 || dist > 780) continue;

        const effectiveKills = isConfirmed ? Math.max(hz.kills || 0, 5) : (hz.kills || 1);
        const tier = effectiveKills >= 5 ? 3 : (effectiveKills >= 3 ? 2 : 1);
        const score = tier * 400 + (isConfirmed ? 500 : 0) + (780 - dist);

        if (score > bestScore) {
            bestScore = score;
            bestThreat = {
                x: hz.x,
                y: hz.y,
                tier,
                isConfirmed,
                lastKillRound: hz.lastKillRound,
                weaponCategory: hz.weaponCategory || "rifle",
                source: "HOTZONE"
            };
        }
    }

    for (let i = 0; i < traces.length; i++) {
        const tr = traces[i];
        if (world.gameTime >= tr.expiresAt) continue;
        const dist = Math.hypot(tr.x - bot.x, tr.y - bot.y);
        if (dist < 65 || dist > 850) continue;

        const tier = (tr.hits >= 3 || tr.weaponCategory === "sniper") ? 2 : 1;
        const freshness = Math.max(0, 1.0 - (world.gameTime - tr.time) / 3.5);
        const score = tier * 380 + freshness * 300 + (850 - dist);

        if (score > bestScore) {
            bestScore = score;
            bestThreat = {
                x: tr.x,
                y: tr.y,
                tier,
                isConfirmed: false,
                weaponCategory: tr.weaponCategory || "rifle",
                source: "BALLISTIC_TRACE"
            };
        }
    }

    return bestThreat;
}

function collectAWPThreatCandidates(team, includeSpottedAwpers = false) {
    if (!world.tacticalIntel) return [];
    const candidates = [];

    // 1. Live AWP swarm signals (14s window)
    const signals = world.awpSwarmSignals || [];
    for (let i = 0; i < signals.length; i++) {
        const sig = signals[i];
        if (!sig || sig.team !== team || !sig.awper || sig.awper.isDead) continue;
        const age = world.gameTime - sig.time;
        if (age <= 14.0) {
            candidates.push({
                x: sig.awper.x,
                y: sig.awper.y,
                source: "AWP_SIGNAL",
                freshnessWeight: 1.25 - age * 0.04,
                awper: sig.awper
            });
        }
    }

    // 2. Active AWP shot threat (14s window)
    const activeAWP = world.activeAWPThreat?.awper || world.activeAWPThreat?.shooter;
    if (world.activeAWPThreat && activeAWP && !activeAWP.isDead && activeAWP.team !== team) {
        const age = world.gameTime - world.activeAWPThreat.time;
        if (age <= 14.0) {
            candidates.push({
                x: activeAWP.x,
                y: activeAWP.y,
                source: "ACTIVE_AWP",
                freshnessWeight: 1.20 - age * 0.04,
                awper: activeAWP
            });
        }
    }

    // 3. Killfeed [AWP] & Bullet-Trace Deduced AWP Nests (16s window)
    const nests = world.tacticalIntel.deducedAWPNests?.[team] || [];
    for (let i = nests.length - 1; i >= 0; i--) {
        const nest = nests[i];
        if (world.gameTime >= nest.expiresAt) {
            nests.splice(i, 1);
            continue;
        }
        const age = world.gameTime - (nest.time || 0);
        candidates.push({
            x: nest.x,
            y: nest.y,
            source: nest.source || "DEDUCED_AWP",
            freshnessWeight: 1.15 - age * 0.03,
            awper: null
        });
    }

    // 4. Sniper-tagged Killer Hotzones & Ballistic Traces (current round only)
    const hotzones = world.tacticalIntel.killerHotzones?.[team] || [];
    for (let i = 0; i < hotzones.length; i++) {
        const hz = hotzones[i];
        if (hz.clearedThisRound || hz.weaponCategory !== "sniper") continue;
        if (hz.lastKillRound !== matchState.roundNumber && world.gameTime >= (hz.confirmedUntil || 0)) continue;
        candidates.push({
            x: hz.x,
            y: hz.y,
            source: "SNIPER_HOTZONE",
            freshnessWeight: 0.90,
            awper: null
        });
    }

    const traces = world.tacticalIntel.ballisticTraces?.[team] || [];
    for (let i = 0; i < traces.length; i++) {
        const tr = traces[i];
        if (world.gameTime >= tr.expiresAt || tr.weaponCategory !== "sniper") continue;
        candidates.push({
            x: tr.x,
            y: tr.y,
            source: "SNIPER_TRACE",
            freshnessWeight: 1.00,
            awper: null
        });
    }

    // 5. Recently spotted enemy AWPers (within 10s)
    if (includeSpottedAwpers) {
        const enemies = team === "CT" ? world.livingT : world.livingCT;
        for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i];
            if (!e || e.isDead || !e.getEquippedKey || e.getEquippedKey() !== "AWP") continue;
            const age = world.gameTime - (e.lastSpottedTime || -99);
            if (age > 10.0) continue;
            candidates.push({
                x: e.lastSpottedX !== undefined ? e.lastSpottedX : e.x,
                y: e.lastSpottedY !== undefined ? e.lastSpottedY : e.y,
                source: "SPOTTED_AWP",
                freshnessWeight: 1.05 - age * 0.04,
                awper: e
            });
        }
    }

    return candidates;
}

export function isPointInAWPSightline(team, x, y) {
    const candidates = collectAWPThreatCandidates(team, true);
    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const d = Math.hypot(c.x - x, c.y - y);
        if (d <= 780 && getMapLineOfSight(c.x, c.y, x, y)) {
            return { x: c.x, y: c.y, dist: d, source: c.source };
        }
    }
    return null;
}

export function getDeducedAWPTarget(team, x, y, maxRange = 780) {
    const candidates = collectAWPThreatCandidates(team, false);
    let bestTarget = null;
    let bestScore = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const d = Math.hypot(c.x - x, c.y - y);
        if (d > maxRange) continue;
        const score = c.freshnessWeight * 400 + (maxRange - d);
        if (score > bestScore) {
            bestScore = score;
            bestTarget = { x: c.x, y: c.y, dist: d, source: c.source, awper: c.awper };
        }
    }

    return bestTarget;
}

export function isExposedToLongAWPSightline(team, x, y, maxRange = 2200) {
    const threat = getDeducedAWPTarget(team, x, y, maxRange);
    if (!threat) return null;
    return getMapLineOfSight(threat.x, threat.y, x, y) ? threat : null;
}

// Evaluates whether a deduced AWP nest is exposed to multiple distinct attack angles (pinchable)
// or tucked inside a tight single-lane choke (avoid / smoke off instead of dry-chasing)
export function evaluateAWPNestPinchability(awpX, awpY) {
    let openRays = 0;
    const sampleCount = 12;
    for (let i = 0; i < sampleCount; i++) {
        const ang = (i * Math.PI * 2) / sampleCount;
        const hit = getRayObstacleEndpoint(awpX, awpY, ang, 340);
        if (Math.hypot(hit.x - awpX, hit.y - awpY) >= 240) {
            openRays++;
        }
    }

    const attackAngles = [];
    for (let i = 0; i < TACTICAL_CORNERS.length; i++) {
        const c = TACTICAL_CORNERS[i];
        const d = Math.hypot(c.x - awpX, c.y - awpY);
        if (d < 130 || d > 680) continue;
        if (!getMapLineOfSight(c.x, c.y, awpX, awpY)) continue;

        const ang = Math.atan2(c.y - awpY, c.x - awpX);
        if (!attackAngles.some(prevAng => Math.abs(normalizeAngle(prevAng - ang)) < (42 * Math.PI / 180))) {
            attackAngles.push(ang);
        }
    }

    const isOpenMultiAngle = openRays >= 5 && attackAngles.length >= 2;
    return {
        isOpenMultiAngle,
        openRays,
        distinctAttackAngles: attackAngles.length
    };
}

/* ==========================================================================
   MAIN BOT PERCEPTION SCANNER
   ========================================================================== */
function detectBlockingSmokeCloud(bot, botInSmoke) {
    if (world.smokeClouds.length === 0 || botInSmoke) return null;

    let navCheckX = bot.x + Math.cos(bot.angle) * 200;
    let navCheckY = bot.y + Math.sin(bot.angle) * 200;

    if (bot.currentPath && bot.currentPath.length > 0) {
        navCheckX = bot.currentPath[0].x;
        navCheckY = bot.currentPath[0].y;
    } else if (bot.team === "T" && !c4State.isPlanted) {
        const activeStrat = T_STRATEGIES[world.currentTStrategyKey];
        const planPath = activeStrat
            ? ((bot.squadGroup === "ALPHA" || bot.archetype === "ENTRY") ? activeStrat.carrierRoute : activeStrat.supportRoute)
            : null;
        const wp = (planPath && bot.planIndex !== undefined && planPath[bot.planIndex])
            ? planPath[bot.planIndex]
            : (bot.assignedSite === "B" ? MAP.siteB.safeSpot : MAP.siteA.safeSpot);
        if (wp) {
            navCheckX = wp.x;
            navCheckY = wp.y;
        }
    } else if (Math.hypot(bot.vx || 0, bot.vy || 0) > 25) {
        const moveAng = Math.atan2(bot.vy, bot.vx);
        navCheckX = bot.x + Math.cos(moveAng) * 200;
        navCheckY = bot.y + Math.sin(moveAng) * 200;
    }

    // Clamp check segment to 240px ahead so distant site smokes don't stall bots early in Mid or A Short
    const segDist = Math.hypot(navCheckX - bot.x, navCheckY - bot.y);
    if (segDist > 240) {
        const segAng = Math.atan2(navCheckY - bot.y, navCheckX - bot.x);
        navCheckX = bot.x + Math.cos(segAng) * 240;
        navCheckY = bot.y + Math.sin(segAng) * 240;
    }

    for (let c = 0; c < world.smokeClouds.length; c++) {
        const cloud = world.smokeClouds[c];
        if (cloud.life <= 1.2) continue;
        const dCloud = Math.hypot(cloud.x - bot.x, cloud.y - bot.y);
        if (dCloud <= cloud.radius + 140 &&
            getMapLineOfSight(bot.x, bot.y, cloud.x, cloud.y) &&
            lineIntersectsCircle(bot.x, bot.y, navCheckX, navCheckY, cloud.x, cloud.y, cloud.radius * 0.85)) {
            return cloud;
        }
    }

    return null;
}

export function scanBotSensors(bot, dt) {
    const isBotScoped = bot.isScoped && bot.getEquippedKey() === "AWP";
    const botScopeCfg = isBotScoped ? getAWPScopeConfig(bot.scopeLevel) : null;
    const botVisionMaxRange = botScopeCfg ? botScopeCfg.visionRange : FIXED_VISION_RANGE;
    const botVisionHalfFov = botScopeCfg ? botScopeCfg.halfFov : FIXED_VISION_HALF_FOV;
    const botInSmoke = isInsideSmoke(bot.x, bot.y);

    if (bot.smokeSpamCooldown > 0) {
        bot.smokeSpamCooldown = Math.max(0, bot.smokeSpamCooldown - dt);
    }
    if (world.smokeClouds.length === 0) {
        bot.smokeWatchTimer = 0;
        bot.smokeBurstCount = 0;
        bot.smokePushCommitted = false;
        bot.blockingSmokeCloud = null;
    }

    if (world.gameTime - (lastTopoIntelUpdate[bot.team] || 0) >= 0.25) {
        lastTopoIntelUpdate[bot.team] = world.gameTime;
        updateTopologicalIntel(bot.team);
        updateTacticalBlackboard(bot.team);
    }
    if (world.gameTime - (lastSuspicionClearUpdate[bot.team] || 0) >= 0.30) {
        lastSuspicionClearUpdate[bot.team] = world.gameTime;
        updateSuspiciousSpotClearing(bot.team);
    }

    // 360-degree gunshot localization using edge-aware sightlines so corner walls don't suppress open shots
    if (bot.blindTimer <= 1.2 && world.recentAcousticEvents && world.recentAcousticEvents.length > 0) {
        let bestShot = null;
        let bestShotScore = -Infinity;

        for (let i = 0; i < world.recentAcousticEvents.length; i++) {
            const ev = world.recentAcousticEvents[i];
            if (!ev || !ev.team || ev.team === bot.team) continue;
            const age = world.gameTime - ev.time;
            if (age < 0 || age > 0.65) continue;

            const dist = Math.hypot(ev.x - bot.x, ev.y - bot.y);
            const intensity = ev.intensity !== undefined ? ev.intensity : 0.6;
            const hasDirectLine = hasClearEntitySightline(bot.x, bot.y, ev.x, ev.y, 14);
            const isLoudSniper = intensity >= 0.85;

            const maxHearDist = hasDirectLine
                ? (isLoudSniper ? 1500 : 1100)
                : (dist <= 520 ? 520 : (isLoudSniper ? 950 : 720));
            if (dist > maxHearDist) continue;

            const score = (maxHearDist - dist) + (hasDirectLine ? 320 : 0) - age * 200;
            if (score > bestShotScore) {
                bestShotScore = score;
                bestShot = { ev, dist, hasDirectLine };
            }
        }

        if (bestShot) {
            const { ev, dist, hasDirectLine } = bestShot;
            const isLoudSniper = (ev.intensity !== undefined ? ev.intensity : 0) >= 0.85;

            // Out-of-sight AWP shot deduction: snap to nearest tactical corner with LOS to the shot origin
            if (isLoudSniper) {
                let awpNestX = ev.x;
                let awpNestY = ev.y;
                let bestCornerDist = 175;
                for (let c = 0; c < TACTICAL_CORNERS.length; c++) {
                    const corner = TACTICAL_CORNERS[c];
                    const dCorner = Math.hypot(corner.x - ev.x, corner.y - ev.y);
                    if (dCorner < bestCornerDist && getMapLineOfSight(corner.x, corner.y, ev.x, ev.y)) {
                        bestCornerDist = dCorner;
                        awpNestX = corner.x;
                        awpNestY = corner.y;
                    }
                }
                recordDeducedAWPNest(bot.team, awpNestX, awpNestY, "AWP_ACOUSTIC", 14.0);
            }

            const prev = bot.lastHeardSound;
            const prevAng = prev ? Math.atan2(prev.y - bot.y, prev.x - bot.x) : 0;
            const newAng = Math.atan2(ev.y - bot.y, ev.x - bot.x);
            const isDifferentDirection = !prev || Math.abs(normalizeAngle(newAng - prevAng)) > 0.75;
            const hasFreshVisual = prev && prev.type === "visual" && (world.gameTime - prev.time < 0.85) && !isDifferentDirection;
            const sameFreshTrace = prev && prev.type === "firing_trace" && (world.gameTime - prev.time < 0.25) &&
                Math.hypot(prev.x - ev.x, prev.y - ev.y) < 120;

            if (!hasFreshVisual && !sameFreshTrace) {
                const fuzzRadius = hasDirectLine ? 18 : (dist <= 520 ? 38 : 75);
                let soundX = ev.x;
                let soundY = ev.y;
                for (let attempt = 0; attempt < 4; attempt++) {
                    const fuzzed = getFuzzedAcousticPos(ev.x, ev.y, fuzzRadius);
                    if (!checkWallCollision(fuzzed.x, fuzzed.y, 12) &&
                        getMapLineOfSight(ev.x, ev.y, fuzzed.x, fuzzed.y)) {
                        soundX = fuzzed.x;
                        soundY = fuzzed.y;
                        break;
                    }
                }

                const shooterObj = ev.shooter || ev.owner || null;
                bot.lastHeardSound = {
                    x: soundX,
                    y: soundY,
                    shooter: (shooterObj && !shooterObj.isDead) ? shooterObj : null,
                    time: ev.time,
                    type: "firing_trace"
                };
            }
        }
    }

    bot.visionScanThrottle = (bot.visionScanThrottle || 0) - dt;

    if (bot.cachedPriorityEnemy && bot.cachedPriorityEnemy.isDead) bot.cachedPriorityEnemy = null;
    if (bot.cachedClosestEnemy && bot.cachedClosestEnemy.isDead) bot.cachedClosestEnemy = null;
    if (bot.cachedSmokeEnemyTarget && bot.cachedSmokeEnemyTarget.isDead) bot.cachedSmokeEnemyTarget = null;

    if (bot.visionScanThrottle <= 0) {
        bot.visionScanThrottle = bot.targetEnemy ? 0.06 : 0.10;

        const enemies = (bot.team === "CT") ? world.livingT : world.livingCT;
        let priorityEnemy = null;
        let closestEnemy = null;
        let bestThreatScore = -Infinity;
        let priorityDist = botVisionMaxRange;
        let minDist = botVisionMaxRange;
        let smokeEnemyTarget = null;
        let smokeCueType = null;

        for (let i = 0; i < enemies.length; i++) {
            const enemy = enemies[i];
            if (!enemy || enemy.isDead || bot.blindTimer > 1.2) continue;

            const d = Math.hypot(enemy.x - bot.x, enemy.y - bot.y);
            if (d > botVisionMaxRange) continue;

            const angleToEnemy = Math.atan2(enemy.y - bot.y, enemy.x - bot.x);
            const diff = Math.abs(normalizeAngle(angleToEnemy - bot.angle));
            const enemyInSmoke = isInsideSmoke(enemy.x, enemy.y);
            const hasClearMapLOS = getMapLineOfSight(bot.x, bot.y, enemy.x, enemy.y);

            const hasFullVision = !botInSmoke &&
                !enemyInSmoke &&
                hasClearMapLOS &&
                getLineOfSight(bot.x, bot.y, enemy.x, enemy.y);

            const isPeripheralContact = (d <= 95) && !botInSmoke && !enemyInSmoke;

            if (hasFullVision && (diff <= botVisionHalfFov || isPeripheralContact)) {
                const threatScore = calculateEnemyThreatScore(bot, enemy, d);
                if (threatScore > bestThreatScore) {
                    bestThreatScore = threatScore;
                    priorityEnemy = enemy;
                    priorityDist = d;
                }
                if (d < minDist) {
                    minDist = d;
                    closestEnemy = enemy;
                }

                enemy.lastSpottedTime = world.gameTime;
                enemy.lastSpottedX = enemy.x;
                enemy.lastSpottedY = enemy.y;

                if (bot.team === "CT") {
                    registerEnemySightingCT(enemy, bot);
                    emitEnemySpotted(bot, enemy);
                } else {
                    registerEnemySightingT(enemy);
                }

                if (world.gameTime - world.lastSpottedRadioTime[bot.team] > 4.0) {
                    world.lastSpottedRadioTime[bot.team] = world.gameTime;
                    audio.announce("Enemy spotted", bot.team);
                    showAnnouncerBanner("RADIO", `${bot.name}: ENEMY SPOTTED!`, bot.team);
                }

                if (bot.team === "CT" && enemy.hasC4 && c4State.ctSeenDropped && !c4State.ctSeenRecovered) {
                    c4State.ctSeenRecovered = true;
                    c4State.ctSeenDropped = false;
                    audio.announce("Bomb recovered", "CT");
                    showAnnouncerBanner("CT RADIO", `${bot.name}: BOMB RECOVERED!`, "CT");
                }
            } else if (hasClearMapLOS && !hasFullVision && diff <= botVisionHalfFov) {
                const sawFireshot = (world.gameTime - (enemy.lastShotTime || -99)) < 0.55;
                if (sawFireshot) {
                    smokeEnemyTarget = true;
                    smokeCueType = 'firing_trace';
                    const fuzzed = getFuzzedAcousticPos(enemy.x, enemy.y, 85);
                    bot.lastHeardSound = {
                        x: fuzzed.x,
                        y: fuzzed.y,
                        shooter: null,
                        time: world.gameTime,
                        type: 'firing_trace'
                    };
                }
            }
        }

        if (!smokeEnemyTarget && bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 1.1)) {
            const sx = bot.lastHeardSound.x;
            const sy = bot.lastHeardSound.y;
            const sType = bot.lastHeardSound.type;
            const isClearMistake = ['firing_trace', 'footstep', 'reloading', 'empty_click'].includes(sType);
            if (isClearMistake && isInsideSmoke(sx, sy, 20) && getMapLineOfSight(bot.x, bot.y, sx, sy)) {
                const dSound = Math.hypot(sx - bot.x, sy - bot.y);
                if (dSound <= 360) {
                    smokeEnemyTarget = true;
                    smokeCueType = sType;
                }
            }
        }

        bot.cachedPriorityEnemy = priorityEnemy;
        bot.cachedClosestEnemy = closestEnemy;
        bot.cachedPriorityDist = priorityDist;
        bot.cachedMinDist = minDist;
        bot.cachedSmokeEnemyTarget = smokeEnemyTarget;
        bot.cachedSmokeCueType = smokeCueType;
        bot.blockingSmokeCloud = priorityEnemy ? null : detectBlockingSmokeCloud(bot, botInSmoke);

        // Immediately mark any site pockets or hotzones inside this bot's vision cone as cleared if empty
        sweepVisibleSectorsForBot(bot);
    }

    return {
        priorityEnemy: bot.cachedPriorityEnemy,
        closestEnemy: bot.cachedClosestEnemy,
        priorityDist: bot.cachedPriorityDist || botVisionMaxRange,
        minDist: bot.cachedMinDist || botVisionMaxRange,
        smokeEnemyTarget: bot.cachedSmokeEnemyTarget,
        smokeCueType: bot.cachedSmokeCueType,
        blockingSmokeCloud: bot.blockingSmokeCloud
    };
}

function classifyMapIntelSector(x, y) {
    if (x >= 1350 && y <= 680) return "A";
    if (x >= 1550 && y >= 1320) return "B";
    if (x >= 1050 && x < 1750 && y > 680 && y < 1320) return "MID";
    return "OTHER";
}

export function evaluateSoloClutchSiteChoice(bot, windowSeconds = 20.0) {
    const threatBySector = { A: 0, B: 0, MID: 0 };
    let intelCount = 0;

    const addSectorThreat = (x, y, weight, age = 0) => {
        if (age < 0 || age > windowSeconds) return;
        const sector = classifyMapIntelSector(x, y);
        if (sector === "A" || sector === "B" || sector === "MID") {
            const freshness = 1.0 - (age / (windowSeconds * 1.6));
            threatBySector[sector] += weight * Math.max(0.4, freshness);
            intelCount++;
        }
    };

    // 1. Visual CT sightings from teammates within the last 20s
    const intelMap = world.sharedEnemyIntelT || {};
    for (const id in intelMap) {
        const item = intelMap[id];
        if (!item || !item.enemy || item.enemy.isDead) continue;
        addSectorThreat(item.x, item.y, 50, world.gameTime - item.time);
    }

    // 2. Deduced enemy AWP nests within the last 20s
    const awpNests = world.tacticalIntel?.deducedAWPNests?.T || [];
    for (let i = 0; i < awpNests.length; i++) {
        const nest = awpNests[i];
        const age = nest.time !== undefined ? (world.gameTime - nest.time) : 0;
        addSectorThreat(nest.x, nest.y, 45, age);
    }

    // 3. Ballistic bullet traces within the last 20s
    const traces = world.tacticalIntel?.ballisticTraces?.T || [];
    for (let i = 0; i < traces.length; i++) {
        addSectorThreat(traces[i].x, traces[i].y, 35, world.gameTime - traces[i].time);
    }

    // 4. Current-round killer hotzones & recent T death locations (last 20s)
    const hotzones = world.tacticalIntel?.killerHotzones?.T || [];
    for (let i = 0; i < hotzones.length; i++) {
        const hz = hotzones[i];
        if (hz.lastKillRound === matchState.roundNumber || world.gameTime < (hz.confirmedUntil || 0)) {
            addSectorThreat(hz.x, hz.y, 40, 0);
        }
    }

    const deathZones = world.tacticalIntel?.deathZones?.T || [];
    for (let i = 0; i < deathZones.length; i++) {
        const dz = deathZones[i];
        addSectorThreat(dz.x, dz.y, 30, world.gameTime - dz.time);
    }

    // 5. Bot's own last heard gunfire or footsteps within the last 20s
    if (bot?.lastHeardSound) {
        addSectorThreat(bot.lastHeardSound.x, bot.lastHeardSound.y, 30, world.gameTime - bot.lastHeardSound.time);
    }

    const distToA = bot ? Math.hypot(MAP.siteA.safeSpot.x - bot.x, MAP.siteA.safeSpot.y - bot.y) : 1000;
    const distToB = bot ? Math.hypot(MAP.siteB.safeSpot.x - bot.x, MAP.siteB.safeSpot.y - bot.y) : 1000;

    // Lower threat score = safer bombsite; distance breaks ties when no 20s info exists
    const siteAScore = -threatBySector.A - distToA * 0.04;
    const siteBScore = -threatBySector.B - distToB * 0.04;
    const targetSite = siteAScore >= siteBScore ? "A" : "B";

    const candidateKeys = targetSite === "A"
        ? (threatBySector.MID > 20
            ? ["GARDEN_A_SHORT", "DIRECT_A_LONG", "TOP_MID_A_SHORT"]
            : ["TOP_MID_A_SHORT", "GARDEN_A_SHORT", "DIRECT_A_LONG", "MID_TO_A"])
        : (threatBySector.MID > 20
            ? ["MAZE_TOP_LANE_RUSH", "MAZE_MID_LANE_RUSH", "MAZE_BOTTOM_LANE_RUSH"]
            : ["MAZE_TOP_LANE_RUSH", "MAZE_MID_LANE_RUSH", "MAZE_BOTTOM_LANE_RUSH", "MID_TO_B_DOORS"]);

    const cleanCandidates = candidateKeys.filter(key => {
        const strat = T_STRATEGIES[key];
        if (!strat) return false;
        const route = strat.carrierRoute || [];
        const hasFire = route.some(pt =>
            world.firePatches.some(f => f.life > 0.5 && Math.hypot(pt.x - f.x, pt.y - f.y) < f.radius + 32)
        );
        const hasRecentDeath = route.some(pt =>
            deathZones.some(dz => (world.gameTime - dz.time) <= windowSeconds && Math.hypot(pt.x - dz.x, pt.y - dz.y) < 120)
        );
        return !hasFire && !hasRecentDeath;
    });

    const pool = cleanCandidates.length > 0 ? cleanCandidates : candidateKeys;
    const cleanStratKey = pool[Math.floor(rnd() * pool.length)];

    return {
        targetSite,
        stratKey: cleanStratKey,
        threatA: threatBySector.A,
        threatB: threatBySector.B,
        threatMid: threatBySector.MID,
        hasRecentIntel: intelCount > 0
    };
}