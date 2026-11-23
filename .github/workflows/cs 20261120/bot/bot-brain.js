/* ==========================================================================
   BOT MAIN AI DECISION STATE MACHINE & CONTINUOUS BODY EXECUTION
   ========================================================================== */
import {
    world,
    matchState,
    c4State,
    pincerState,
    ctPincerState,
    TORSO_RADIUS,
    FOOTSTEP_LISTEN_RADIUS,
    rnd,
    normalizeAngle,
    rotateTowardsDamped,
    audio,
    showAnnouncerBanner
} from '../state.js';
import {
    MAP,
    TACTICAL_CORNERS,
    SITE_PATROL_POINTS,
    T_SITE_HOLD_ANGLES,
    T_POST_PLANT_ZONES,
    T_STRATEGIES,
    CT_STRATEGIES,
    CT_DEFENSE_SPOTS,
    AREA_CONTROL_ZONES,
    isNearSpawn,
    isStrictlyInsideSite,
    isInsideExpandedSite,
    getClosestRouteIndex,
    getBotPowerPosition,
    isEnemyInControlledZone
} from '../js-map-physics/dedust2map.js';
import {
    checkWallCollision,
    ejectFromWall,
    getMapLineOfSight,
    getRayObstacleEndpoint,
    hasBodyClearance,
    isInsideSmoke,
    getCollisionNormal,
    canBulletPenetrateTo
} from '../js-map-physics/map-physics.js';
import {
    worldToNavCell,
    navCellToWorld,
    brakeBot,
    moveBotWithSliding,
    steerBotToDestination
} from '../js-map-physics/Map-Finding.js';
import { performAttack, startReload } from '../combat-match/Combat.js';
import { triggerC4Plant, triggerC4Defused } from '../combat-match/Match-cycle.js';
import {
    isPointVisibleToBot,
    getRelevantSuspiciousSpot,
    shouldCTBotSupport,
    getSquadMacroSearchTarget,
    getCornerPeekPrefireTarget,
    scanBotSensors,
    getTacticalBlackboardThreat,
    isSectorRecentlyCleared,
    recordClearedSector,
    getDeducedAWPTarget,
    isExposedToLongAWPSightline,
    evaluateAWPNestPinchability,
    getConnectedSmokeCluster,
    isPointInSmokeCluster,
    evaluateSoloClutchSiteChoice
} from './Bot-Sensor.js';
import {
    evaluateCTDefuseTactic,
    isUtilityTargetClaimed,
    claimUtilityTarget,
    tryExecuteTacticalUtility,
    tryPostPlantDenial,
    updatePatrolVision,
    getSitePatrolDestination,
    tryTacticalReload,
    findTacticalCover,
    findMultiAngleSupportPosition,
    findCrossfireSupportAngle,
    getBotCombatAimPoint,
    executeBotGunplay,
    solveBotUtilityThrow,
    executeBotGrenadeThrow,
    processPendingUtilityThrow,
    isBeyondOverchaseTether,
    executeTRotation,
    hasAWPScopeLineClearance,
    getNextUnclearedSitePocket,
    commitCTSiteRotation,
    isTSquadOccupyingSite,
    isTReadyToPlantAtSite,
    isTFastExecuteActive,
    tryCounterAWPUtility,
    updateDesignatedRetriever
} from './Bot-Tactics.js';

const C4_EVAC_HAVENS = {
    A: { x: 1450, y: 1080 },
    B: { x: 1810, y: 1140 }
};

const SECTOR_ALT_EXITS = {
    northEast: [
        { x: 2038, y: 542 }, // A Short Site A doorway
        { x: 1715, y: 542 }, // Extended A Short catwalk mouth
        { x: 1860, y: 200 }, // A Long ramp entry
        { x: 2225, y: 540 }, // CT Ramp to Site A
        { x: 1280, y: 445 }  // A Long <-> A Short wall gap
    ],
    southEast: [
        { x: 2040, y: 1561 }, // Top Maze Lane east exit
        { x: 2050, y: 1712 }, // Mid Maze Lane east exit
        { x: 2050, y: 1877 }, // Bottom Maze Lane east exit
        { x: 2245, y: 1435 }, // Widened B Doors (west)
        { x: 2375, y: 1435 }  // Widened B Doors (east)
    ]
};

const CT_SPAWN_WALL_BYPASSES = [
    // North CT-spawn wall { x: 1850, y: 820, w: 400, h: 90 }
    {
        xMin: 1835, xMax: 2265, destXMin: 1825, destXMax: 2275,
        sideAYMax: 825, sideBYMin: 905,
        westCornerX: 1790, eastCornerX: 2310, midX: 2050,
        sideAY: 785, sideBY: 945
    },
    // South CT-spawn wall { x: 1850, y: 1050, w: 200, h: 45 }
    {
        xMin: 1835, xMax: 2065, destXMin: 1825, destXMax: 2075,
        sideAYMax: 1055, sideBYMin: 1090,
        westCornerX: 1790, eastCornerX: 2105, midX: 1950,
        sideAY: 1020, sideBY: 1125
    }
];

function snapToWalkablePos(x, y, radius = 18) {
    const clampedX = Math.max(80, Math.min(MAP.width - 80, x));
    const clampedY = Math.max(80, Math.min(MAP.height - 80, y));
    const paddedRadius = radius + 8;
    const base = navCellToWorld(worldToNavCell(clampedX, clampedY));
    if (!checkWallCollision(base.x, base.y, paddedRadius)) return base;

    for (let r = 24; r <= 168; r += 24) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
            const cand = navCellToWorld(worldToNavCell(clampedX + Math.cos(a) * r, clampedY + Math.sin(a) * r));
            if (!checkWallCollision(cand.x, cand.y, paddedRadius)) return cand;
        }
    }

    if (!checkWallCollision(base.x, base.y, radius)) return base;
    for (let r = 24; r <= 168; r += 24) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
            const cand = navCellToWorld(worldToNavCell(clampedX + Math.cos(a) * r, clampedY + Math.sin(a) * r));
            if (!checkWallCollision(cand.x, cand.y, radius)) return cand;
        }
    }
    return base;
}
/* ==========================================================================
   SPATIAL POSITIONING, OFF-ANGLE & DEFUSE WATCH HELPERS
   ========================================================================== */
// Snaps a defense/hold coordinate tight to the nearest wall or pillar with a 5.5 px steering buffer
function snapToWallHugPos(x, y, radius = TORSO_RADIUS, hugGap = 5.5) {
    const clampedX = Math.max(40 + radius + hugGap, Math.min(MAP.width - 40 - radius - hugGap, x));
    const clampedY = Math.max(40 + radius + hugGap, Math.min(MAP.height - 40 - radius - hugGap, y));
    let origin = { x: clampedX, y: clampedY };

    if (checkWallCollision(origin.x, origin.y, radius + 0.5)) {
        let escaped = null;
        for (let r = 2; r <= 96 && !escaped; r += 2) {
            for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
                const tx = clampedX + Math.cos(a) * r;
                const ty = clampedY + Math.sin(a) * r;
                if (!checkWallCollision(tx, ty, radius + 0.5)) {
                    escaped = { x: tx, y: ty };
                    break;
                }
            }
        }
        origin = escaped || snapToWalkablePos(clampedX, clampedY, radius);
    }

    // Slide straight toward the nearest wall until the body edge sits 1.5-2 px from the wall
    let bestWallAng = null;
    let bestWallDist = 90;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        for (let d = 1; d <= bestWallDist; d += 2) {
            if (checkWallCollision(origin.x + Math.cos(a) * d, origin.y + Math.sin(a) * d, radius)) {
                if (d < bestWallDist) {
                    bestWallDist = d;
                    bestWallAng = a;
                }
                break;
            }
        }
    }

    if (bestWallAng === null) return origin;

    let hugged = origin;
    for (let step = 1; step <= bestWallDist; step += 1) {
        const tx = origin.x + Math.cos(bestWallAng) * step;
        const ty = origin.y + Math.sin(bestWallAng) * step;
        if (checkWallCollision(tx, ty, radius + hugGap)) break;
        hugged = { x: tx, y: ty };
    }
    return hugged;
}

function getSpreadAttackWaypoint(bot, targetPt, isFinalApproach) {
    if (!targetPt) return { x: bot.x, y: bot.y };
    const allies = (bot.team === "CT" ? world.livingCT : world.livingT).filter(m => m && !m.isDead);
    const myRank = Math.max(0, allies.indexOf(bot));

    const wpKey = `${bot.team}_${Math.round(targetPt.x)}_${Math.round(targetPt.y)}_${myRank}_${isFinalApproach ? 1 : 0}`;
    if (bot.spreadWpCache && bot.spreadWpCache.key === wpKey) {
        return bot.spreadWpCache.pos;
    }

    const approachAng = Math.atan2(targetPt.y - bot.y, targetPt.x - bot.x);
    const perpAng = approachAng + Math.PI / 2;

    // T-side attackers hug adjacent cover walls instead of walking down the exposed center of lanes
    if (bot.team === "T" && !isNearSpawn(bot.x, bot.y)) {
        const preferredSide = (myRank % 2 === 0) ? 1 : -1;
        const sideOrder = [preferredSide, -preferredSide];
        let bestWallHug = null;
        let bestScore = -Infinity;

        for (let s = 0; s < sideOrder.length; s++) {
            const side = sideOrder[s];
            for (let latDist = 28; latDist <= 108; latDist += 20) {
                const cand = snapToWalkablePos(
                    targetPt.x + Math.cos(perpAng) * (side * latDist),
                    targetPt.y + Math.sin(perpAng) * (side * latDist),
                    bot.radius + 4
                );
                if (checkWallCollision(cand.x, cand.y, bot.radius + 5)) continue;
                if (!getMapLineOfSight(cand.x, cand.y, targetPt.x, targetPt.y)) continue;

                // Reward hugging a solid wall within 34px on the outside edge for cover
                const wallCheckX = cand.x + Math.cos(perpAng) * (side * 34);
                const wallCheckY = cand.y + Math.sin(perpAng) * (side * 34);
                const hugsWall = checkWallCollision(wallCheckX, wallCheckY, 10);
                if (!hugsWall) continue;

                let score = (s === 0 ? 45 : 15) - latDist * 0.25;
                for (let a = 0; a < allies.length; a++) {
                    const ally = allies[a];
                    if (ally === bot) continue;
                    const dAlly = Math.hypot(cand.x - ally.x, cand.y - ally.y);
                    if (dAlly < 85) score -= (85 - dAlly) * 2.5;
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestWallHug = cand;
                }
            }
        }

        if (bestWallHug) {
            bot.spreadWpCache = { key: wpKey, pos: bestWallHug };
            return bestWallHug;
        }
    }

    if (allies.length <= 1) return { x: targetPt.x, y: targetPt.y };

    const slotOrder = [0, -1, 1, -2, 2];
    const laneSlot = slotOrder[myRank % slotOrder.length];
    if (laneSlot === 0) return { x: targetPt.x, y: targetPt.y };

    const spacing = isFinalApproach ? 68 : 44;
    const cand = snapToWalkablePos(
        targetPt.x + Math.cos(perpAng) * (laneSlot * spacing),
        targetPt.y + Math.sin(perpAng) * (laneSlot * spacing),
        bot.radius + 4
    );

    const resolved = (!checkWallCollision(cand.x, cand.y, bot.radius + 4) &&
        getMapLineOfSight(cand.x, cand.y, targetPt.x, targetPt.y))
        ? cand
        : { x: targetPt.x, y: targetPt.y };

    bot.spreadWpCache = { key: wpKey, pos: resolved };
    return resolved;
}

function getDynamicCTOffAngle(bot, spot) {
    if (!spot) return null;
    const baseAngle = normalizeAngle(spot.angle);
    const chokeX = spot.x + Math.cos(baseAngle) * 260;
    const chokeY = spot.y + Math.sin(baseAngle) * 260;
    const susSpots = world.teamSuspicionMemory?.T || [];
    const siteAllies = world.livingCT.filter(m => m && m !== bot && !m.isDead && m.assignedCTStrat?.site === spot.site);

    let bestCand = null;
    let bestScore = -Infinity;

    for (let i = 0; i < 14; i++) {
        const offsetAng = (i === 0) ? 0 : (rnd() * Math.PI * 2);
        const offsetDist = (i === 0) ? 0 : (85 + rnd() * 135);
        const rawX = Math.max(80, Math.min(MAP.width - 80, spot.x + Math.cos(offsetAng) * offsetDist));
        const rawY = Math.max(80, Math.min(MAP.height - 80, spot.y + Math.sin(offsetAng) * offsetDist));
        const cand = navCellToWorld(worldToNavCell(rawX, rawY));

        if (checkWallCollision(cand.x, cand.y, bot.radius + 5)) continue;
        if (!getMapLineOfSight(cand.x, cand.y, chokeX, chokeY)) continue;

        let score = (i === 0 ? -40 : 25);

        for (let s = 0; s < susSpots.length; s++) {
            const dSus = Math.hypot(cand.x - susSpots[s].x, cand.y - susSpots[s].y);
            if (dSus < 140) score -= (140 - dSus) * 2.2;
        }

        for (let d = 0; d < 4; d++) {
            const wa = d * (Math.PI / 2);
            if (checkWallCollision(cand.x + Math.cos(wa) * 32, cand.y + Math.sin(wa) * 32, 10)) {
                score += 35;
                break;
            }
        }

        const candWatchAng = Math.atan2(chokeY - cand.y, chokeX - cand.x);
        for (let a = 0; a < siteAllies.length; a++) {
            const ally = siteAllies[a];
            const allyPos = ally.dynamicDefensePos || { x: ally.x, y: ally.y };
            const dAlly = Math.hypot(cand.x - allyPos.x, cand.y - allyPos.y);
            if (dAlly < 165) {
                score -= (165 - dAlly) * 2.0;
            } else {
                const allyWatchAng = Math.atan2(chokeY - allyPos.y, chokeX - allyPos.x);
                if (Math.abs(normalizeAngle(candWatchAng - allyWatchAng)) > 0.65) score += 45;
            }
        }

        if (score > bestScore) {
            bestScore = score;
            bestCand = { x: cand.x, y: cand.y, angle: candWatchAng, spotId: spot.id };
        }
    }

    return bestCand || { x: spot.x, y: spot.y, angle: baseAngle, spotId: spot.id };
}

function getOutwardDefuseWatchAngle(bot) {
    if (bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 3.5)) {
        return Math.atan2(bot.lastHeardSound.y - bot.y, bot.lastHeardSound.x - bot.x);
    }
    const freshIntel = Object.values(world.sharedEnemyIntelCT || {}).find(
        i => i && i.enemy && !i.enemy.isDead && (world.gameTime - i.time < 4.5)
    );
    if (freshIntel) {
        return Math.atan2(freshIntel.y - bot.y, freshIntel.x - bot.x);
    }
    const sus = getRelevantSuspiciousSpot(bot);
    if (sus) {
        return Math.atan2(sus.y - bot.y, sus.x - bot.x);
    }

    const bombOutward = Math.atan2(bot.y - c4State.plantY, bot.x - c4State.plantX);
    let bestAngle = bombOutward;
    let bestClearDist = -1;

    for (let i = 0; i < 12; i++) {
        const candAng = normalizeAngle(bombOutward + (i - 6) * (Math.PI / 6));
        let clearSteps = 0;
        for (let d = 40; d <= 360; d += 40) {
            if (checkWallCollision(bot.x + Math.cos(candAng) * d, bot.y + Math.sin(candAng) * d, 8)) break;
            clearSteps = d;
        }
        if (clearSteps > bestClearDist) {
            bestClearDist = clearSteps;
            bestAngle = candAng;
        }
    }
    return bestAngle;
}

function getDefenseADStrafeDest(bot, anchorPos, watchAngle, dt, strafeRadius = 26, requireLOS = true) {
    if (!bot || bot.getEquippedKey() === "AWP") return anchorPos;
    const perpAng = normalizeAngle(watchAngle + Math.PI / 2);

    if (!bot.defenseADState ||
        Math.hypot(bot.defenseADState.anchorX - anchorPos.x, bot.defenseADState.anchorY - anchorPos.y) > 45) {
        bot.defenseADState = {
            anchorX: anchorPos.x,
            anchorY: anchorPos.y,
            dir: (bot.id % 2 === 0) ? 1 : -1,
            phase: 0, // 0 = step out to active side, 1 = return to anchor/opposite side
            timer: 0,
            duration: 0.36 + rnd() * 0.20
        };
    }

    const st = bot.defenseADState;
    st.timer += dt;
    if (st.timer >= st.duration) {
        st.timer = 0;
        st.duration = 0.34 + rnd() * 0.20;
        if (st.phase === 0) {
            st.phase = 1;
        } else {
            st.phase = 0;
            st.dir = -st.dir;
        }
    }

    const trySide = (dir) => {
        const cx = Math.max(60, Math.min(MAP.width - 60, anchorPos.x + Math.cos(perpAng) * (dir * strafeRadius)));
        const cy = Math.max(60, Math.min(MAP.height - 60, anchorPos.y + Math.sin(perpAng) * (dir * strafeRadius)));
        if (checkWallCollision(cx, cy, bot.radius + 6)) return null;
        if (!hasBodyClearance(anchorPos.x, anchorPos.y, cx, cy, bot.radius + 4)) return null;
        if (requireLOS) {
            const watchPtX = anchorPos.x + Math.cos(watchAngle) * 180;
            const watchPtY = anchorPos.y + Math.sin(watchAngle) * 180;
            if (!getMapLineOfSight(cx, cy, watchPtX, watchPtY)) return null;
        }
        return { x: cx, y: cy };
    };

    const primarySide = trySide(st.dir);
    const oppositeSide = trySide(-st.dir);

    // Both sides open: smooth A-D-A-D oscillation across the anchor
    if (primarySide && oppositeSide) {
        return st.phase === 0 ? primarySide : oppositeSide;
    }
    // One side is against a cover wall: smoothly step out to the open side and tuck back to the anchor
    const openSide = primarySide || oppositeSide;
    if (openSide) {
        return st.phase === 0 ? openSide : anchorPos;
    }
    return anchorPos;
}

const CT_EXTENDED_INFO_ROUTES = {
    B: [
        // 1. Top Maze -> Tunnels / West Maze Plaza
        {
            name: "B_TOP_MAZE_TUNNELS",
            waypoints: [
                { x: 1915, y: 1561 },
                { x: 1665, y: 1525 },
                { x: 1350, y: 1520 },
                { x: 950, y: 1580 }
            ]
        },
        // 2. Mid Maze -> Central Spine -> Tunnels Plaza
        {
            name: "B_MID_MAZE_TUNNELS",
            waypoints: [
                { x: 1880, y: 1712 },
                { x: 1665, y: 1715 },
                { x: 1350, y: 1715 },
                { x: 1020, y: 1720 }
            ]
        },
        // 3. Bottom Maze -> Lower Bend -> Tunnels Plaza
        {
            name: "B_BOT_MAZE_TUNNELS",
            waypoints: [
                { x: 1880, y: 1877 },
                { x: 1665, y: 1877 },
                { x: 1350, y: 1900 },
                { x: 1120, y: 1900 },
                { x: 1020, y: 1720 }
            ]
        },
        // 4. Ant-Hill Connector -> Mid Doors -> Mid Courtyard
        {
            name: "B_CONNECTOR_MID_COURTYARD",
            waypoints: [
                { x: 1915, y: 1561 },
                { x: 1733, y: 1420 },
                { x: 1733, y: 1310 },
                { x: 1490, y: 1145 },
                { x: 1290, y: 1020 },
                { x: 1090, y: 1030 }
            ]
        },
        // 5. Conditional Garden Wrap (only used late-round when Ts are quiet across the whole map)
        {
            name: "B_MID_COURTYARD_GARDEN_WRAP",
            requiresLateQuietMap: true,
            waypoints: [
                { x: 1915, y: 1561 },
                { x: 1733, y: 1420 },
                { x: 1733, y: 1310 },
                { x: 1490, y: 1145 },
                { x: 1290, y: 1020 },
                { x: 1090, y: 1030 },
                { x: 910, y: 880 },
                { x: 580, y: 880 },
                { x: 250, y: 920 }
            ]
        }
    ],
    MID: [
        // 1. Mid Doors -> Mid Courtyard -> A-Short / West Courtyard Junction
        {
            name: "MID_COURTYARD_SWEEP",
            waypoints: [
                { x: 1450, y: 1080 },
                { x: 1290, y: 1020 },
                { x: 1090, y: 1030 },
                { x: 910, y: 880 }
            ]
        },
        // 2. Conditional Garden Wrap (Mid Courtyard -> West Courtyard -> Garden)
        {
            name: "MID_TO_GARDEN_WRAP",
            requiresLateQuietMap: true,
            waypoints: [
                { x: 1450, y: 1080 },
                { x: 1290, y: 1020 },
                { x: 1090, y: 1030 },
                { x: 910, y: 880 },
                { x: 580, y: 880 },
                { x: 250, y: 920 }
            ]
        }
    ]
};

function updateCTActiveInfoCheck(bot, siteKey, roundElapsed, dt) {
    if (!bot || bot.team !== "CT" || (siteKey !== "B" && siteKey !== "MID")) return null;
    if (c4State.isPlanted || c4State.isDropped || bot.isAggroPushing || bot.isRoamingPatrol) {
        bot.isCTInfoPushing = false;
        bot.ctInfoPushRoute = null;
        return null;
    }

    // Global intel/sound check: abort immediately if any enemy is seen or heard anywhere on the map
    const hasLocalAudio = bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 4.5);
    const hasGlobalCTIntel = Object.values(world.sharedEnemyIntelCT || {}).some(i =>
        i && i.enemy && !i.enemy.isDead && !i.isSpotCleared && (world.gameTime - i.time < 5.0)
    );
    const hasGlobalDistress = world.squadHelpSignals.some(s =>
        s.team === "CT" && (world.gameTime - s.time < 5.0) && (!s.targetEnemy || !s.targetEnemy.isDead)
    );
    const hasAnyInfo = Boolean(hasLocalAudio || hasGlobalCTIntel || hasGlobalDistress || bot.targetEnemy);

    if (hasAnyInfo) {
        bot.ctNoInfoTimer = 0;
        if (bot.isCTInfoPushing) {
            bot.isCTInfoPushing = false;
            bot.ctInfoPushRoute = null;
            bot.ctCornerCheckTimer = 0;
            bot.ctInfoPushCooldown = world.gameTime + 12.0;
        }
        return null;
    }

    bot.ctNoInfoTimer = (bot.ctNoInfoTimer || 0) + dt;

    // Global 1-pusher cap: only 1 CT across the entire team probes deep at a time
    const anotherCTAlreadyPushing = world.livingCT.some(m =>
        m && m !== bot && !m.isDead && m.isCTInfoPushing
    );

    if (!bot.isCTInfoPushing &&
        !anotherCTAlreadyPushing &&
        world.livingCT.length >= 2 &&
        bot.getEquippedKey() !== "AWP" &&
        world.gameTime >= (bot.ctInfoPushCooldown || 0) &&
        bot.ctNoInfoTimer >= (11.5 + (bot.id % 3) * 1.5)) {
        const routeTemplates = CT_EXTENDED_INFO_ROUTES[siteKey] || [];
        const allowGardenWrap = roundElapsed >= 24.0 && world.livingCT.length >= 3;

        const eligibleRoutes = routeTemplates.filter(tpl => {
            if (tpl.requiresLateQuietMap && !allowGardenWrap) return false;
            const pts = tpl.waypoints;
            const endPt = pts[pts.length - 1];
            const hasFire = pts.some(pt =>
                world.firePatches.some(f => f.life > 0.5 && Math.hypot(pt.x - f.x, pt.y - f.y) < f.radius + 32)
            );
            return !hasFire && !isSectorRecentlyCleared("CT", endPt.x, endPt.y, 160);
        });

        const pool = eligibleRoutes.length > 0
            ? eligibleRoutes
            : routeTemplates.filter(tpl => !tpl.requiresLateQuietMap);

        if (pool.length > 0) {
            const chosen = pool[Math.floor(rnd() * pool.length)];
            bot.isCTInfoPushing = true;
            bot.ctInfoPushRoute = chosen.waypoints;
            bot.ctInfoPushIndex = 0;
            bot.ctInfoPushStartTime = world.gameTime;
            bot.ctCornerCheckTimer = 0;
            bot.ctCheckedCorners = {};
            bot.areaControlState = null;
        }
    }

    if (!bot.isCTInfoPushing || !bot.ctInfoPushRoute) return null;

    const maxDuration = bot.ctInfoPushRoute.length >= 7 ? 15.0 : 12.0;
    const timedOut = (world.gameTime - (bot.ctInfoPushStartTime || 0)) >= maxDuration;
    const curWp = bot.ctInfoPushRoute[bot.ctInfoPushIndex];
    const wpInFire = curWp && world.firePatches.some(f =>
        f.life > 0.5 && Math.hypot(curWp.x - f.x, curWp.y - f.y) < f.radius + 32
    );

    if (curWp && (Math.hypot(curWp.x - bot.x, curWp.y - bot.y) <= 46 || wpInFire)) {
        bot.ctInfoPushIndex++;
        bot.ctCornerCheckTimer = 0;
    }

    if (timedOut || bot.ctInfoPushIndex >= bot.ctInfoPushRoute.length) {
        bot.isCTInfoPushing = false;
        bot.ctInfoPushRoute = null;
        bot.ctCornerCheckTimer = 0;
        bot.ctInfoPushCooldown = world.gameTime + 18.0;
        bot.ctNoInfoTimer = 0;
        return null;
    }

    const targetWp = bot.ctInfoPushRoute[bot.ctInfoPushIndex];
    const nextWp = bot.ctInfoPushRoute[Math.min(bot.ctInfoPushRoute.length - 1, bot.ctInfoPushIndex + 1)] || targetWp;
    const dest = snapToWalkablePos(targetWp.x, targetWp.y, bot.radius + 4);
    const moveAngle = Math.atan2(dest.y - bot.y, dest.x - bot.x);

    // Methodical corner pre-aiming & brief 0.24s slice at unchecked TACTICAL_CORNERS junctions
    let upcomingCorner = null;
    let bestCornerDist = 235;
    for (let i = 0; i < TACTICAL_CORNERS.length; i++) {
        const c = TACTICAL_CORNERS[i];
        const key = `${Math.round(c.x)}_${Math.round(c.y)}`;
        if (bot.ctCheckedCorners?.[key]) continue;

        const d = Math.hypot(c.x - bot.x, c.y - bot.y);
        if (d < 55 || d > bestCornerDist) continue;
        const angToCorner = Math.atan2(c.y - bot.y, c.x - bot.x);
        if (Math.abs(normalizeAngle(angToCorner - moveAngle)) > 0.85) continue;
        if (!getMapLineOfSight(bot.x, bot.y, c.x, c.y)) continue;

        bestCornerDist = d;
        upcomingCorner = { ...c, key };
    }

    let lookAngle = getForwardCornerPreAimAngle(bot, dest.x, dest.y) ??
        Math.atan2(nextWp.y - bot.y, nextWp.x - bot.x);
    let holdToSliceCorner = false;

    if (upcomingCorner) {
        const edgeAng = Math.atan2(upcomingCorner.y - bot.y, upcomingCorner.x - bot.x);
        const laneDir = (upcomingCorner.hotAngle !== undefined && Math.abs(normalizeAngle(upcomingCorner.hotAngle - moveAngle)) < 1.35)
            ? upcomingCorner.hotAngle
            : moveAngle;
        const perpSign = normalizeAngle(laneDir - edgeAng) >= 0 ? 1 : -1;
        const tangentAng = edgeAng + perpSign * (Math.PI / 2);
        const seamX = upcomingCorner.x + Math.cos(tangentAng) * 24 + Math.cos(laneDir) * 95;
        const seamY = upcomingCorner.y + Math.sin(tangentAng) * 24 + Math.sin(laneDir) * 95;
        lookAngle = Math.atan2(seamY - bot.y, seamX - bot.x);

        // Pause briefly (0.24s) just before stepping past the corner edge to clear the angle cleanly
        if (bestCornerDist <= 125) {
            bot.ctCornerCheckTimer = (bot.ctCornerCheckTimer || 0) + dt;
            if (bot.ctCornerCheckTimer < 0.24) {
                holdToSliceCorner = true;
            } else {
                bot.ctCheckedCorners[upcomingCorner.key] = true;
                markSightlineSectorCleared("CT", upcomingCorner.x, upcomingCorner.y, laneDir);
                bot.ctCornerCheckTimer = 0;
            }
        }
    }

    return {
        dest,
        lookAngle,
        hold: holdToSliceCorner
    };
}

function updateAreaControlZone(bot, zoneKey, dt, zoneTable = AREA_CONTROL_ZONES) {
    const zone = zoneTable[zoneKey] || zoneTable.A || AREA_CONTROL_ZONES.A;
    if (!zone || !zone.pockets || zone.pockets.length === 0) return null;

    const teamName = bot.team || "CT";
    const isPostPlantPassive = zoneTable === T_POST_PLANT_ZONES;
    const allies = (teamName === "CT" ? world.livingCT : world.livingT).filter(m => m && m !== bot && !m.isDead);
    const hotzones = world.tacticalIntel?.killerHotzones?.[teamName] || [];
    const deathZones = world.tacticalIntel?.deathZones?.[teamName] || [];

    const pickBestPocket = (excludeId = null) => {
        let best = null;
        let bestScore = -Infinity;

        for (let i = 0; i < zone.pockets.length; i++) {
            const p = zone.pockets[i];
            const snapped = snapToWallHugPos(p.x, p.y, bot.radius, 1.8);
            if (checkWallCollision(snapped.x, snapped.y, bot.radius)) continue;

            let score = (p.id === excludeId) ? -65 : (p.weight || 20);
            score += (rnd() - 0.5) * 32;
            const pWatchAng = Math.atan2(p.watchY - snapped.y, p.watchX - snapped.x);

            // Boost a pocket if fresh footsteps, gunfire, or squad intel are detected near the lane it watches
            if (bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 3.5)) {
                const dCueToWatch = Math.hypot(bot.lastHeardSound.x - p.watchX, bot.lastHeardSound.y - p.watchY);
                if (dCueToWatch < 340) score += (340 - dCueToWatch) * 0.22;
            }

            for (let a = 0; a < allies.length; a++) {
                const ally = allies[a];
                const dAlly = Math.hypot(snapped.x - ally.x, snapped.y - ally.y);
                // Use 120px personal-space check so Top Maze (y=1561) and Mid Maze (y=1712) across the wall don't penalize each other
                if (dAlly < 120) score -= (120 - dAlly) * 2.5;
                if (ally.areaControlState?.pocket) {
                    const allyPocket = ally.areaControlState.pocket;
                    if (p.id === allyPocket.id || Math.hypot(snapped.x - allyPocket.x, snapped.y - allyPocket.y) < 110) {
                        score -= 240;
                    }
                    const distinctLaneGroups = p.laneGroup && allyPocket.laneGroup && p.laneGroup !== allyPocket.laneGroup;
                    if (distinctLaneGroups) {
                        // Covering two separate Maze lanes (or Maze + B Doors) adds multi-lane map information
                        score += 25;
                    } else {
                        const allyWatchAng = Math.atan2(allyPocket.watchY - allyPocket.y, allyPocket.watchX - allyPocket.x);
                        if (Math.abs(normalizeAngle(pWatchAng - allyWatchAng)) < 0.52) {
                            score -= 115;
                        }
                    }
                }
            }

            for (let h = 0; h < hotzones.length; h++) {
                const dHot = Math.hypot(snapped.x - hotzones[h].x, snapped.y - hotzones[h].y);
                if (dHot < 130) score -= (130 - dHot) * 1.8;
            }
            // Never rotate into a pocket where a teammate just died
            for (let dz = 0; dz < deathZones.length; dz++) {
                if (!deathZones[dz].cleared && world.gameTime < deathZones[dz].expiresAt) {
                    const dDeath = Math.hypot(snapped.x - deathZones[dz].x, snapped.y - deathZones[dz].y);
                    if (dDeath < 200) score -= (200 - dDeath) * 2.2;
                }
            }
            // Post-plant Ts stay anchored close to the bomb rather than drifting to outer choke pockets
            if (isPostPlantPassive && c4State.isPlanted) {
                const dBomb = Math.hypot(snapped.x - c4State.plantX, snapped.y - c4State.plantY);
                if (dBomb > 480) score -= (dBomb - 480) * 0.45;
            }
            if (world.firePatches.some(f => f.life > 0.5 && Math.hypot(f.x - snapped.x, f.y - snapped.y) < f.radius + 55)) {
                score -= 500;
            }
            // Prefer watching unsmoked lanes unless an active enemy cue was just heard near this pocket's watch point
            const hasCueAtWatch = bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 2.8) &&
                Math.hypot(bot.lastHeardSound.x - p.watchX, bot.lastHeardSound.y - p.watchY) < 260;
            if (!hasCueAtWatch && isSegmentObscuredBySmoke(snapped.x, snapped.y, p.watchX, p.watchY)) {
                score -= 95;
            }

            if (score > bestScore) {
                bestScore = score;
                best = { ...p, x: snapped.x, y: snapped.y };
            }
        }
        return best || { ...zone.pockets[0] };
    };

    const pocketCompromisedByDeath = bot.areaControlState?.pocket && deathZones.some(dz =>
        !dz.cleared && world.gameTime < dz.expiresAt &&
        Math.hypot(dz.x - bot.areaControlState.pocket.x, dz.y - bot.areaControlState.pocket.y) < 165
    );

    const needNewPocket = !bot.areaControlState ||
        bot.areaControlState.zoneKey !== zoneKey ||
        world.gameTime >= bot.areaControlState.rotateAt ||
        pocketCompromisedByDeath ||
        bot.lastKillRepositionCount !== (bot.kills || 0) ||
        world.firePatches.some(f => f.life > 0.5 && Math.hypot(f.x - bot.areaControlState.pocket.x, f.y - bot.areaControlState.pocket.y) < f.radius + 55);

    if (needNewPocket) {
        const prevId = bot.areaControlState?.pocket?.id || null;
        const chosenPocket = pickBestPocket(prevId);
        bot.lastKillRepositionCount = bot.kills || 0;
        // Post-plant Ts hold steady angles for 14-20s instead of constantly rotating across the site
        const holdDuration = isPostPlantPassive ? (14.0 + rnd() * 6.0) : (3.8 + rnd() * 2.4);
        bot.areaControlState = {
            zoneKey,
            pocket: chosenPocket,
            rotateAt: world.gameTime + holdDuration,
            cycleTimer: rnd() * 1.5,
            isPeeking: false
        };
    }

    const st = bot.areaControlState;
    const pocket = st.pocket;
    const distToPocket = Math.hypot(pocket.x - bot.x, pocket.y - bot.y);

    if (!st.isPeeking && distToPocket > 42) {
        return {
            dest: { x: pocket.x, y: pocket.y },
            lookAngle: null,
            hold: false,
            isPeeking: false
        };
    }

    const isAWP = bot.getEquippedKey() === "AWP";
    const useADPeek = !isAWP;
    const activeGazeAngle = getActiveGazeHoldAngle(bot);
    const hasActiveAimTarget = activeGazeAngle !== null;

    // Post-plant Ts pause behind cover with micro A-D footwork, then take brief 0.45s info-peeks
    const coverHoldDuration = isAWP
        ? 1.6
        : (isPostPlantPassive ? (hasActiveAimTarget ? 1.15 : (2.3 + rnd() * 1.4)) : (hasActiveAimTarget ? 1.2 : 2.2));
    const peekHoldDuration = isAWP
        ? 3.4
        : (isPostPlantPassive
            ? (hasActiveAimTarget ? (0.85 + rnd() * 0.35) : (0.42 + rnd() * 0.16))
            : (useADPeek ? (1.45 + rnd() * 0.55) : (hasActiveAimTarget ? 0.95 : 0.58)));

    const activePeekPocket = st.altPeekPocket || pocket;
    const peekDest = snapToWalkablePos(activePeekPocket.peekX, activePeekPocket.peekY, bot.radius + 6);
    const distToPeek = Math.hypot(peekDest.x - bot.x, peekDest.y - bot.y);
    const atActiveSpot = st.isPeeking
        ? (useADPeek ? distToPeek <= 48 : distToPeek <= 24)
        : (distToPocket <= 28);

    // Hold timer only advances once settled at the cover/peek spot (with a 2.0s transit safety cap)
    st.transitTimer = atActiveSpot ? 0 : ((st.transitTimer || 0) + dt);
    if (atActiveSpot || st.transitTimer >= 2.0) {
        st.cycleTimer = (st.cycleTimer || 0) + dt;
    }

    if (!st.isPeeking && st.cycleTimer >= coverHoldDuration) {
        st.isPeeking = true;
        st.cycleTimer = 0;
        st.transitTimer = 0;
        st.peekCount = (st.peekCount || 0) + 1;
        st.adDir = (bot.id % 2 === 0) ? 1 : -1;
        st.adTimer = 0;
        st.adDuration = 0.28 + rnd() * 0.16;

        // Every second info-peek without a live target, briefly check an extra nearby angle/lane
        if (isPostPlantPassive && !hasActiveAimTarget && st.peekCount % 2 === 0) {
            const baseWatchAng = Math.atan2(pocket.watchY - pocket.y, pocket.watchX - pocket.x);
            const extraAngles = zone.pockets.filter(cand => {
                if (cand.id === pocket.id) return false;
                if (Math.hypot(cand.peekX - pocket.x, cand.peekY - pocket.y) > 220) return false;
                if (!getMapLineOfSight(pocket.x, pocket.y, cand.peekX, cand.peekY)) return false;
                const candAng = Math.atan2(cand.watchY - cand.peekY, cand.watchX - cand.peekX);
                return Math.abs(normalizeAngle(candAng - baseWatchAng)) > 0.45;
            });
            st.altPeekPocket = extraAngles.length > 0
                ? extraAngles[Math.floor(rnd() * extraAngles.length)]
                : null;
        } else {
            st.altPeekPocket = null;
        }
    } else if (st.isPeeking && st.cycleTimer >= peekHoldDuration) {
        st.isPeeking = false;
        st.altPeekPocket = null;
        st.cycleTimer = 0;
        st.transitTimer = 0;
    }

    if (st.isPeeking) {
        const atPeek = distToPeek <= 20;
        const laneWatchAng = Math.atan2(activePeekPocket.watchY - peekDest.y, activePeekPocket.watchX - peekDest.x);
        const effectivePeekLook = (hasActiveAimTarget && Math.abs(normalizeAngle(activeGazeAngle - laneWatchAng)) <= (115 * Math.PI / 180))
            ? activeGazeAngle
            : laneWatchAng;

        if (useADPeek && distToPeek <= 48) {
            const strafeDist = isPostPlantPassive ? 20 : 30;
            const adDest = getDefenseADStrafeDest(bot, peekDest, effectivePeekLook, dt, strafeDist, true);
            return {
                dest: adDest,
                lookAngle: effectivePeekLook,
                hold: false,
                isPeeking: true,
                isADPeeking: true
            };
        }

        return {
            dest: peekDest,
            lookAngle: effectivePeekLook,
            hold: atPeek,
            isPeeking: true
        };
    }

    const distToCornerEdge = Math.hypot(peekDest.x - bot.x, peekDest.y - bot.y);
    const coverWatchAng = distToCornerEdge > 18
        ? Math.atan2(peekDest.y - bot.y, peekDest.x - bot.x)
        : Math.atan2(pocket.watchY - bot.y, pocket.watchX - bot.x);
    const effectiveCoverLook = (hasActiveAimTarget && Math.abs(normalizeAngle(activeGazeAngle - coverWatchAng)) <= (115 * Math.PI / 180))
        ? activeGazeAngle
        : coverWatchAng;

    // Subtle micro A-D-A-D footwork behind cover so post-plant Ts never look like static statues
    if (isPostPlantPassive && useADPeek && distToPocket <= 42) {
        const microStrafeDest = getDefenseADStrafeDest(bot, { x: pocket.x, y: pocket.y }, effectiveCoverLook, dt, 16, false);
        return {
            dest: microStrafeDest,
            lookAngle: effectiveCoverLook,
            hold: false,
            isPeeking: false,
            isADPeeking: true
        };
    }

    return {
        dest: { x: pocket.x, y: pocket.y },
        lookAngle: effectiveCoverLook,
        hold: distToPocket <= 22,
        isPeeking: false
    };
}

function getForwardCornerPreAimAngle(bot, destX, destY) {
    const moveDist = Math.hypot(destX - bot.x, destY - bot.y);
    if (moveDist < 35) return null;
    const moveAngle = Math.atan2(destY - bot.y, destX - bot.x);

    // Near-to-far corner ordering: clear the closest visible corner seam before deeper angles
    let bestCorner = null;
    let bestDist = bot.team === "T" ? 340 : 260;

    for (let i = 0; i < TACTICAL_CORNERS.length; i++) {
        const c = TACTICAL_CORNERS[i];
        const d = Math.hypot(c.x - bot.x, c.y - bot.y);
        if (d < 55 || d > bestDist) continue;
        const angToCorner = Math.atan2(c.y - bot.y, c.x - bot.x);
        if (Math.abs(normalizeAngle(angToCorner - moveAngle)) > 0.90) continue;
        if (!getMapLineOfSight(bot.x, bot.y, c.x, c.y)) continue;

        bestDist = d;
        bestCorner = c;
    }

    if (!bestCorner) return null;

    // Tangent edge projection: aim just past the perpendicular corner edge toward the opening lane
    const edgeAng = Math.atan2(bestCorner.y - bot.y, bestCorner.x - bot.x);
    const laneDir = (bestCorner.hotAngle !== undefined && Math.abs(normalizeAngle(bestCorner.hotAngle - moveAngle)) < 1.35)
        ? bestCorner.hotAngle
        : moveAngle;
    const perpSign = normalizeAngle(laneDir - edgeAng) >= 0 ? 1 : -1;
    const tangentAng = edgeAng + perpSign * (Math.PI / 2);

    const seamX = bestCorner.x + Math.cos(tangentAng) * 24 + Math.cos(laneDir) * 85;
    const seamY = bestCorner.y + Math.sin(tangentAng) * 24 + Math.sin(laneDir) * 85;
    return Math.atan2(seamY - bot.y, seamX - bot.x);
}

function markSightlineSectorCleared(team, cornerX, cornerY, laneAngle) {
    if (!world.tacticalIntel?.clearedSectors?.[team]) return;
    const list = world.tacticalIntel.clearedSectors[team];
    const farX = Math.max(80, Math.min(MAP.width - 80, cornerX + Math.cos(laneAngle) * 145));
    const farY = Math.max(80, Math.min(MAP.height - 80, cornerY + Math.sin(laneAngle) * 145));
    const expiresAt = world.gameTime + 6.5;

    list.push({ x: cornerX, y: cornerY, radius: 130, time: world.gameTime, expiresAt });
    list.push({ x: farX, y: farY, radius: 135, time: world.gameTime, expiresAt });
}
function getFriendlyFlashWindow(bot, focusX, focusY) {
    // 1. Check live friendly flashbangs in flight near the target angle
    for (let i = 0; i < world.grenades.length; i++) {
        const g = world.grenades[i];
        if (!g || g.type !== "FLASH" || g.owner?.team !== bot.team || g.owner === bot) continue;
        if (Math.hypot(g.x - focusX, g.y - focusY) > 380) continue;

        if (g.fuse > 0.14) return "WAIT_FOR_POP";
        if (g.fuse > 0) return "SWING_NOW";
    }

    // 2. Check recent friendly flash reservations that just detonated (1.65s blind window)
    const reservations = world.teamUtilityReservations || [];
    for (let i = 0; i < reservations.length; i++) {
        const res = reservations[i];
        if (!res || res.team !== bot.team || res.type !== "FLASH") continue;
        if (Math.hypot(res.x - focusX, res.y - focusY) > 380) continue;

        const popTime = res.detonateAt || (res.expiresAt - 0.75);
        if (world.gameTime >= popTime && world.gameTime <= popTime + 1.65) {
            return "SWING_NOW";
        }
    }

    return "NONE";
}
function updateTAttackCornerPeek(bot, watchTarget, isSplitStaging, dt) {
    if (!bot || !watchTarget || isNearSpawn(bot.x, bot.y) || c4State.isDropped) return null;
    if (bot.team === "T" && !c4State.isPlanted && (world.livingT.length <= 4 || world.gameTime < (bot.tCornerPeekCooldown || 0))) {
        return null;
    }

    if (!bot.tPeekedCorners || bot.tPeekedCorners.round !== matchState.roundNumber) {
        bot.tPeekedCorners = { round: matchState.roundNumber };
    }

    // Near-to-far corner selection so close angles are cleared before deep angles
    const approachAng = Math.atan2(watchTarget.y - bot.y, watchTarget.x - bot.x);
    const candidateCorners = [];

    for (let i = 0; i < TACTICAL_CORNERS.length; i++) {
        const c = TACTICAL_CORNERS[i];
        const key = `${Math.round(c.x)}_${Math.round(c.y)}`;
        if (bot.tPeekedCorners[key]) continue;

        const d = Math.hypot(c.x - bot.x, c.y - bot.y);
        if (d < 60 || d > 265) continue;
        if (!getMapLineOfSight(bot.x, bot.y, c.x, c.y)) continue;
        if (!isSplitStaging && Math.abs(normalizeAngle(Math.atan2(c.y - bot.y, c.x - bot.x) - approachAng)) > 1.05) {
            continue;
        }
        candidateCorners.push({ x: c.x, y: c.y, hotAngle: c.hotAngle, key, d });
    }

    candidateCorners.sort((a, b) => a.d - b.d);
    const chokeCorner = candidateCorners[0] || null;

    if (!chokeCorner) {
        bot.tAttackPeekState = null;
        return null;
    }

    const hasSoundNearChoke = bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 3.2) &&
        Math.hypot(bot.lastHeardSound.x - chokeCorner.x, bot.lastHeardSound.y - chokeCorner.y) < 420;
    const susSpot = getRelevantSuspiciousSpot(bot);
    const hasSusNearChoke = susSpot && Math.hypot(susSpot.x - chokeCorner.x, susSpot.y - chokeCorner.y) < 380;
    const bbThreat = getTacticalBlackboardThreat(bot);
    const isCurrentRoundBB = bbThreat && (bbThreat.isConfirmed || bbThreat.source === "BALLISTIC_TRACE" || bbThreat.lastKillRound === matchState.roundNumber);
    const hasHotzoneNearChoke = isCurrentRoundBB && bbThreat.tier >= 2 &&
        Math.hypot(bbThreat.x - chokeCorner.x, bbThreat.y - chokeCorner.y) < 420;
    const inTightChoke = isTightCorridorAround(bot.x, bot.y, approachAng, bot.radius || TORSO_RADIUS);
    const hasCorpseNearChoke = !inTightChoke && world.corpses.some(c =>
        c.team === "T" && Math.hypot(c.x - chokeCorner.x, c.y - chokeCorner.y) < 280
    );
    const angleAlreadyCleared = isSectorRecentlyCleared("T", chokeCorner.x, chokeCorner.y, 120);
    const roundElapsed = 115 - matchState.roundTimer;
    // Proactively slice/jiggle unchecked choke corners while attacking so T bots don't walk blindly into CT crosshairs
    const isProactiveChokeCheck = !inTightChoke &&
        chokeCorner.hotAngle !== undefined &&
        chokeCorner.d >= 75 &&
        chokeCorner.d <= 230 &&
        roundElapsed >= 3.0;

    if (!isSplitStaging && (angleAlreadyCleared || (!hasSoundNearChoke && !hasSusNearChoke && !hasHotzoneNearChoke && !hasCorpseNearChoke && !isProactiveChokeCheck && bot.archetype !== "AWPER"))) {
        bot.tAttackPeekState = null;
        return null;
    }

    // Mid Doors extreme choke check: throw screening smoke first if available, then slice Top, Top-Right & South angles
    const isMidDoorsChoke = chokeCorner.x >= 1180 && chokeCorner.x <= 1450 &&
        chokeCorner.y >= 980 && chokeCorner.y <= 1180;
    if (isMidDoorsChoke && bot.hasSmoke && !bot.hasC4 && !isNearSpawn(bot.x, bot.y) &&
        !isInsideSmoke(1490, 1080, 30) && !isUtilityTargetClaimed("T", 1490, 1080, "SMOKE", 220)) {
        const midSmokePlan = solveBotUtilityThrow(bot, "SMOKE", 1490, 1080, 130);
        if (midSmokePlan) {
            claimUtilityTarget("T", 1490, 1080, "SMOKE", 4.5);
            executeBotGrenadeThrow(bot, 5, midSmokePlan.aimX, midSmokePlan.aimY, midSmokePlan.isExtended);
        }
    }

    // Build ordered near-to-far threat points to slice sequentially as the bot steps out
    const laneDir = chokeCorner.hotAngle !== undefined ? chokeCorner.hotAngle : approachAng;
    const nearSeamPt = {
        x: chokeCorner.x + Math.cos(laneDir) * 115,
        y: chokeCorner.y + Math.sin(laneDir) * 115
    };
    const slicePoints = [nearSeamPt];
    if (isMidDoorsChoke) {
        slicePoints.push({ x: 1460, y: 955 });  // Top Mid wall / catwalk ledge
        slicePoints.push({ x: 1620, y: 955 });  // Top-Right Mid corner wall
        slicePoints.push({ x: 1520, y: 1265 }); // South Mid / B-connector angle
    }
    if (hasSusNearChoke) slicePoints.push({ x: susSpot.x, y: susSpot.y });
    if (hasHotzoneNearChoke) slicePoints.push({ x: bbThreat.x, y: bbThreat.y });
    if (hasSoundNearChoke) slicePoints.push({ x: bot.lastHeardSound.x, y: bot.lastHeardSound.y });
    slicePoints.push({ x: watchTarget.x, y: watchTarget.y });
    slicePoints.sort((a, b) =>
        Math.hypot(a.x - chokeCorner.x, a.y - chokeCorner.y) -
        Math.hypot(b.x - chokeCorner.x, b.y - chokeCorner.y)
    );

    const primaryFocus = slicePoints[slicePoints.length - 1];
    const flashWindow = !isSplitStaging ? getFriendlyFlashWindow(bot, primaryFocus.x, primaryFocus.y) : "NONE";

    // Step 1: Teammate's flashbang is still in flight -> stay behind cover so we don't blind ourselves
    if (flashWindow === "WAIT_FOR_POP") {
        const holdCover = findTacticalCover(bot, primaryFocus.x, primaryFocus.y);
        return {
            dest: holdCover,
            lookAngle: Math.atan2(primaryFocus.y - bot.y, primaryFocus.x - bot.x),
            hold: Math.hypot(holdCover.x - bot.x, holdCover.y - bot.y) <= 18,
            isPeeking: false,
            peekType: "JIGGLE_INFO",
            shouldBurstFire: false,
            burstFocusPos: primaryFocus
        };
    }

    const computePeekSpot = (stepDist) => {
        const toFocusAng = Math.atan2(primaryFocus.y - chokeCorner.y, primaryFocus.x - chokeCorner.x);
        const perpLeft = toFocusAng + Math.PI / 2;
        const perpRight = toFocusAng - Math.PI / 2;
        const candA = snapToWalkablePos(chokeCorner.x + Math.cos(perpLeft) * stepDist, chokeCorner.y + Math.sin(perpLeft) * stepDist, bot.radius + 4);
        const candB = snapToWalkablePos(chokeCorner.x + Math.cos(perpRight) * stepDist, chokeCorner.y + Math.sin(perpRight) * stepDist, bot.radius + 4);

        if (!checkWallCollision(candA.x, candA.y, bot.radius + 4) && getMapLineOfSight(candA.x, candA.y, primaryFocus.x, primaryFocus.y)) {
            return candA;
        }
        if (!checkWallCollision(candB.x, candB.y, bot.radius + 4) && getMapLineOfSight(candB.x, candB.y, primaryFocus.x, primaryFocus.y)) {
            return candB;
        }
        return { x: chokeCorner.x, y: chokeCorner.y };
    };

    if (!bot.tAttackPeekState || bot.tAttackPeekState.cornerKey !== chokeCorner.key) {
        const nearbyAllySwinging = Boolean(bot.tradeTarget && !bot.tradeTarget.isDead) ||
            world.livingT.some(m => m && m !== bot && !m.isDead && Math.hypot(m.x - bot.x, m.y - bot.y) < 210);
        const deducedAWPNearby = Boolean(getDeducedAWPTarget("T", chokeCorner.x, chokeCorner.y, 780));

        // Step 2: Pick WIDE_SWING if a friendly flash just popped or an ally is swinging with us
        let peekType = "JIGGLE_INFO";
        if (flashWindow === "SWING_NOW" || (!isSplitStaging && nearbyAllySwinging && (hasSoundNearChoke || hasSusNearChoke || hasHotzoneNearChoke))) {
            peekType = "WIDE_SWING";
        } else if (!deducedAWPNearby && (hasHotzoneNearChoke || hasSusNearChoke || hasSoundNearChoke || hasCorpseNearChoke)) {
            peekType = "SLICE_BURST";
        }

        const stepDist = peekType === "WIDE_SWING"
            ? (55 + rnd() * 17)
            : (peekType === "SLICE_BURST" ? (30 + rnd() * 8) : (16 + rnd() * 6));
        const exposeDur = peekType === "WIDE_SWING"
            ? 0.55
            : (peekType === "SLICE_BURST" ? (0.35 + rnd() * 0.13) : (0.18 + rnd() * 0.06));
        const tuckDur = 0.65 + rnd() * 0.70;

        bot.tAttackPeekState = {
            cornerKey: chokeCorner.key,
            cornerX: chokeCorner.x,
            cornerY: chokeCorner.y,
            laneDir,
            peekType,
            exposeDur,
            tuckDur,
            tuckSpot: findTacticalCover(bot, primaryFocus.x, primaryFocus.y),
            peekSpot: computePeekSpot(stepDist),
            totalTime: 0,
            cycleTimer: 0,
            isPeeking: true,
            burstShotsDone: 0
        };
    }

    const st = bot.tAttackPeekState;
    // Step 3: If we were already jiggling at the corner when the flash popped, immediately widen our swing
    if (flashWindow === "SWING_NOW" && st.peekType !== "WIDE_SWING") {
        st.peekType = "WIDE_SWING";
        st.peekSpot = computePeekSpot(58);
        st.isPeeking = true;
        st.cycleTimer = 0;
    }

    st.totalTime += dt;
    st.cycleTimer += dt;

    const hasConfirmedThreatCue = hasSoundNearChoke || hasSusNearChoke || hasHotzoneNearChoke || hasCorpseNearChoke;
    const maxCornerTime = st.peekType === "WIDE_SWING"
        ? 0.65
        : (isSplitStaging ? 1.35 : (!hasConfirmedThreatCue && bot.archetype !== "AWPER" ? 0.62 : (bot.archetype === "AWPER" ? 1.8 : 1.15)));

    if (st.totalTime >= maxCornerTime) {
        bot.tPeekedCorners[chokeCorner.key] = true;
        markSightlineSectorCleared("T", st.cornerX, st.cornerY, st.laneDir);
        bot.tAttackPeekState = null;
        bot.tCornerPeekCooldown = world.gameTime + 3.5;
        return null;
    }

    if (st.peekType !== "WIDE_SWING") {
        if (st.isPeeking && st.cycleTimer >= st.exposeDur) {
            st.isPeeking = false;
            st.cycleTimer = 0;
            st.tuckDur = 0.65 + rnd() * 0.70;
            st.burstShotsDone = 0;
        } else if (!st.isPeeking && st.cycleTimer >= st.tuckDur) {
            st.isPeeking = true;
            st.cycleTimer = 0;
        }
    }

    // Sweep crosshair smoothly from nearest angle to farthest angle across the exposure window
    const sliceProgress = st.isPeeking ? Math.min(0.999, st.cycleTimer / Math.max(0.12, st.exposeDur)) : 0;
    const sliceIdx = Math.min(slicePoints.length - 1, Math.floor(sliceProgress * slicePoints.length));
    const activeSliceTarget = slicePoints[sliceIdx];

    const activeDest = st.isPeeking ? st.peekSpot : st.tuckSpot;
    const distToDest = Math.hypot(activeDest.x - bot.x, activeDest.y - bot.y);
    const lookAngle = Math.atan2(activeSliceTarget.y - bot.y, activeSliceTarget.x - bot.x);
    const shouldHoldAtEdge = st.peekType === "SLICE_BURST" && st.isPeeking && distToDest <= 18;
    const shouldBurstFire = shouldHoldAtEdge &&
        st.burstShotsDone < 3 &&
        (hasHotzoneNearChoke || hasSusNearChoke || hasSoundNearChoke);

    return {
        dest: activeDest,
        lookAngle,
        hold: shouldHoldAtEdge || (!st.isPeeking && distToDest <= 18),
        isPeeking: st.isPeeking,
        peekType: st.peekType,
        shouldBurstFire,
        burstFocusPos: activeSliceTarget
    };
}

function isBotInOpenDisadvantage(bot, threatX, threatY) {
    if (Math.hypot(threatX - bot.x, threatY - bot.y) < 440) return false;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        if (checkWallCollision(bot.x + Math.cos(a) * 90, bot.y + Math.sin(a) * 90, 12)) {
            return false;
        }
    }
    return true;
}

function isTightCorridorAround(x, y, travelAngle, radius = 16) {
    const leftAng = travelAngle - Math.PI / 2;
    const rightAng = travelAngle + Math.PI / 2;
    return checkWallCollision(x + Math.cos(leftAng) * 38, y + Math.sin(leftAng) * 38, radius) ||
        checkWallCollision(x + Math.cos(rightAng) * 38, y + Math.sin(rightAng) * 38, radius);
}

function getCorridorRightOfWayScore(entity, goalPriority = 0) {
    if (!entity) return -Infinity;
    if (!entity.isBot) return 1000;
    let score = goalPriority;
    if (entity.hasC4 || entity === c4State.designatedDefuser || entity.isDefusing) score += 500;
    if (entity.targetEnemy) score += 350;
    if (entity.isAggroPushing || (entity.macroGoal && entity.macroGoal.type === "SUPPORT")) score += 80;
    score += (entity.id || 0) * 0.01;
    return score;
}

function findAlternateExitOrAngle(bot, blockingMate, currentDest, wantsToHold) {
    const angToMate = Math.atan2(blockingMate.y - bot.y, blockingMate.x - bot.x);

    if (wantsToHold || bot.isPatrolling || bot.isHoldingCrossfire) {
        if (bot.team === "CT" && bot.assignedDefenseSpot && !c4State.isPlanted) {
            const newSpot = getDynamicCTOffAngle(bot, bot.assignedDefenseSpot);
            if (newSpot && Math.hypot(newSpot.x - blockingMate.x, newSpot.y - blockingMate.y) > 130) {
                bot.dynamicDefensePos = newSpot;
                bot.isHoldingCrossfire = false;
                return { x: newSpot.x, y: newSpot.y, lookAngle: newSpot.angle, isHoldShift: true };
            }
        }

        const siteKey = (bot.assignedCTStrat?.site === "B" || bot.assignedSite === "B" || c4State.plantSite === "B") ? "B" : "A";
        const patrolPool = SITE_PATROL_POINTS[siteKey] || SITE_PATROL_POINTS.A;
        const altPatrol = patrolPool
            .filter(p => Math.hypot(p.x - blockingMate.x, p.y - blockingMate.y) > 150 && !checkWallCollision(p.x, p.y, bot.radius))
            .sort((a, b) => Math.hypot(a.x - bot.x, a.y - bot.y) - Math.hypot(b.x - bot.x, b.y - bot.y))[0];

        if (altPatrol) {
            bot.patrolTargetPt = altPatrol;
            return { x: altPatrol.x, y: altPatrol.y, lookAngle: null, isHoldShift: true };
        }
    }

    const isNorthEastGoal = currentDest.y < 900 && currentDest.x > 1350;
    const isSouthEastGoal = currentDest.y >= 1150 && currentDest.x > 1350;
    const sectorExits = isNorthEastGoal
        ? SECTOR_ALT_EXITS.northEast
        : (isSouthEastGoal ? SECTOR_ALT_EXITS.southEast : []);

    const validExits = sectorExits
        .map(pt => snapToWalkablePos(pt.x, pt.y, bot.radius))
        .filter(pt => {
            if (Math.hypot(pt.x - blockingMate.x, pt.y - blockingMate.y) < 145) return false;
            if (Math.hypot(pt.x - bot.x, pt.y - bot.y) < 65) return false;
            const angToExit = Math.atan2(pt.y - bot.y, pt.x - bot.x);
            return Math.abs(normalizeAngle(angToExit - angToMate)) > 0.50;
        })
        .sort((a, b) => Math.hypot(a.x - bot.x, a.y - bot.y) - Math.hypot(b.x - bot.x, b.y - bot.y));

    if (validExits.length > 0) {
        return { x: validExits[0].x, y: validExits[0].y, lookAngle: null, isHoldShift: false };
    }

    const flankPt = findMultiAngleSupportPosition(bot, currentDest.x, currentDest.y, blockingMate);
    if (flankPt && Math.hypot(flankPt.x - blockingMate.x, flankPt.y - blockingMate.y) > 135 && !checkWallCollision(flankPt.x, flankPt.y, bot.radius)) {
        return { x: flankPt.x, y: flankPt.y, lookAngle: null, isHoldShift: false };
    }

    return null;
}

/* ==========================================================================
   SMOKE EXIT / OFF-ANGLE HELPERS, APPROACHABILITY & HEAD ORIENTATION
   ========================================================================== */
function getSmokeClusterThroughExit(bot, smokeCluster, preferredDest) {
    if (!smokeCluster) return preferredDest || { x: bot.x, y: bot.y };

    // Reuse cached exit across consecutive smokes so the bot never reverses or tweaks mid-cloud
    if (bot.smokeTraverseCache &&
        world.gameTime < bot.smokeTraverseCache.until &&
        !isPointInSmokeCluster(bot.smokeTraverseCache.pos.x, bot.smokeTraverseCache.pos.y, smokeCluster, 18)) {
        return bot.smokeTraverseCache.pos;
    }

    const throughAng = (preferredDest && Math.hypot(preferredDest.x - bot.x, preferredDest.y - bot.y) > 35)
        ? Math.atan2(preferredDest.y - bot.y, preferredDest.x - bot.x)
        : (bot.forwardProgressAngle ?? bot.angle);

    // Project beyond the far edge of the entire connected smoke cluster along the objective axis
    const maxStep = smokeCluster.radius * 2 + 180;
    let chosenExit = null;

    for (let dist = 90; dist <= maxStep; dist += 36) {
        const cand = snapToWalkablePos(
            bot.x + Math.cos(throughAng) * dist,
            bot.y + Math.sin(throughAng) * dist,
            bot.radius + 4
        );
        if (checkWallCollision(cand.x, cand.y, bot.radius + 4)) continue;
        if (isPointInSmokeCluster(cand.x, cand.y, smokeCluster, 22)) continue;
        if (world.firePatches.some(f => f.life > 0.45 && Math.hypot(f.x - cand.x, f.y - cand.y) < (f.radius + 24))) {
            continue;
        }
        chosenExit = cand;
        break;
    }

    if (!chosenExit) {
        for (let i = 0; i < 16; i++) {
            const ang = throughAng + ((i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8));
            const cand = snapToWalkablePos(
                smokeCluster.x + Math.cos(ang) * (smokeCluster.radius + bot.radius + 36),
                smokeCluster.y + Math.sin(ang) * (smokeCluster.radius + bot.radius + 36),
                bot.radius + 4
            );
            if (!checkWallCollision(cand.x, cand.y, bot.radius + 4) &&
                !isPointInSmokeCluster(cand.x, cand.y, smokeCluster, 20)) {
                chosenExit = cand;
                break;
            }
        }
    }

    const resolved = chosenExit || preferredDest || { x: bot.x, y: bot.y };
    bot.smokeTraverseCache = { pos: resolved, until: world.gameTime + 1.4 };
    return resolved;
}

function getSafeSmokeFallbackPlan(bot, smokeCluster, fallbackDest) {
    if (!smokeCluster) return null;

    // Lock the fallback angle for 1.8s so the bot holds a steady cover angle instead of jittering on the smoke edge
    if (bot.smokeFallbackCache &&
        world.gameTime < bot.smokeFallbackCache.until &&
        Math.hypot(bot.smokeFallbackCache.clusterX - smokeCluster.x, bot.smokeFallbackCache.clusterY - smokeCluster.y) < 90 &&
        !isPointInSmokeCluster(bot.smokeFallbackCache.dest.x, bot.smokeFallbackCache.dest.y, smokeCluster, 24)) {
        return bot.smokeFallbackCache;
    }

    const allies = (bot.team === "CT" ? world.livingCT : world.livingT)
        .filter(m => m && !m.isDead && Math.hypot(m.x - smokeCluster.x, m.y - smokeCluster.y) < smokeCluster.radius + 520)
        .sort((a, b) => a.id - b.id);
    const slotRank = Math.max(0, allies.indexOf(bot));

    const angleSlots = [-0.55, 0.55, -0.95, 0.95, 0.25];
    const slotArc = angleSlots[slotRank % angleSlots.length];
    const fromSmokeAng = Math.atan2(bot.y - smokeCluster.y, bot.x - smokeCluster.x);
    const targetSectorAng = normalizeAngle(fromSmokeAng + slotArc);

    // Fall back 165-235px behind the smoke edge so bots play safe off-angles rather than tweaking right on the smoke
    const standDist = smokeCluster.radius + 165 + (slotRank % 2) * 45;

    let bestSpot = null;
    let bestScore = -Infinity;

    for (let rAdd = 0; rAdd <= 70; rAdd += 35) {
        for (let offset = -0.45; offset <= 0.45; offset += 0.225) {
            const testAng = normalizeAngle(targetSectorAng + offset);
            const rawX = Math.max(80, Math.min(MAP.width - 80, smokeCluster.x + Math.cos(testAng) * (standDist + rAdd)));
            const rawY = Math.max(80, Math.min(MAP.height - 80, smokeCluster.y + Math.sin(testAng) * (standDist + rAdd)));
            const cand = snapToWalkablePos(rawX, rawY, bot.radius + 4);

            if (checkWallCollision(cand.x, cand.y, bot.radius + 4)) continue;
            if (isPointInSmokeCluster(cand.x, cand.y, smokeCluster, 28)) continue;
            if (!getMapLineOfSight(cand.x, cand.y, smokeCluster.x, smokeCluster.y)) continue;

            let score = -Math.abs(offset) * 35 - Math.hypot(cand.x - bot.x, cand.y - bot.y) * 0.12 + rAdd * 0.35;

            for (let d = 0; d < 8; d++) {
                const wa = d * (Math.PI / 4);
                if (checkWallCollision(cand.x + Math.cos(wa) * 34, cand.y + Math.sin(wa) * 34, 10)) {
                    score += 110;
                    break;
                }
            }

            for (let i = 0; i < allies.length; i++) {
                const ally = allies[i];
                if (ally === bot) continue;
                const dAlly = Math.hypot(cand.x - ally.x, cand.y - ally.y);
                if (dAlly < 145) score -= (145 - dAlly) * 3.0;
            }

            if (score > bestScore) {
                bestScore = score;
                bestSpot = cand;
            }
        }
    }

    const chosenSpot = bestSpot || findTacticalCover(bot, smokeCluster.x, smokeCluster.y) || fallbackDest;
    const seamPerp = targetSectorAng + (slotRank % 2 === 0 ? Math.PI / 2 : -Math.PI / 2);
    const seamX = smokeCluster.x + Math.cos(seamPerp) * (smokeCluster.radius * 0.45);
    const seamY = smokeCluster.y + Math.sin(seamPerp) * (smokeCluster.radius * 0.45);

    const plan = {
        dest: chosenSpot,
        watchAngle: Math.atan2(seamY - chosenSpot.y, seamX - chosenSpot.x),
        clusterX: smokeCluster.x,
        clusterY: smokeCluster.y,
        until: world.gameTime + 1.8
    };
    bot.smokeFallbackCache = plan;
    return plan;
}

// Finds an open rear/flank sightline behind the bot for periodic shoulder-checks while holding a smoke
function getSmokeRearCheckAngle(bot, smokeWatchAngle) {
    const rearBase = normalizeAngle(smokeWatchAngle + Math.PI);
    const muzzleDist = (bot.radius || TORSO_RADIUS) + 4;
    let bestAngle = rearBase;
    let bestScore = -Infinity;

    for (let i = -4; i <= 4; i++) {
        const candAng = normalizeAngle(rearBase + i * (Math.PI / 8));
        const sx = bot.x + Math.cos(candAng) * muzzleDist;
        const sy = bot.y + Math.sin(candAng) * muzzleDist;
        if (checkWallCollision(sx, sy, 3)) continue;

        const hit = getRayObstacleEndpoint(sx, sy, candAng, 360);
        const clearDist = Math.hypot(hit.x - sx, hit.y - sy);
        if (clearDist < 95) continue;

        const score = Math.min(360, clearDist) - Math.abs(i) * 28;
        if (score > bestScore) {
            bestScore = score;
            bestAngle = candAng;
        }
    }

    return bestScore > -Infinity ? bestAngle : null;
}

// Locks a bot's smoke reaction (REROUTE, HOLD_AD, or PUSH) with hysteresis so head turns never cause movement jitter
function updateSmokeHoldController(bot, smokeCluster, fallbackDest, options, dt) {
    const {
        canPushThrough,
        isFriendlyOrCleared,
        hasHigherPriorityCue,
        roundElapsed,
        isUnarmedC4Carrier
    } = options;

    // Clear state if smoke dissipated or high-priority combat/push overrides it
    if (bot.smokeHoldState) {
        const stillActive = world.smokeClouds.some(c =>
            c.life > 0.35 &&
            Math.hypot(c.x - bot.smokeHoldState.clusterX, c.y - bot.smokeHoldState.clusterY) <= (bot.smokeHoldState.clusterRadius + 75)
        );
        if (!stillActive || canPushThrough || isFriendlyOrCleared || hasHigherPriorityCue) {
            bot.smokeHoldState = null;
        }
    }

    if (!smokeCluster || canPushThrough || isFriendlyOrCleared || hasHigherPriorityCue) {
        return null;
    }

    const needNewDecision = !bot.smokeHoldState ||
        world.gameTime >= bot.smokeHoldState.until ||
        Math.hypot(bot.smokeHoldState.clusterX - smokeCluster.x, bot.smokeHoldState.clusterY - smokeCluster.y) > 130;

    if (needNewDecision) {
        let mode = "HOLD_AD";

        // T-side attackers without man advantage can freely pivot to another site/lane instead of risking a smoked choke
        if (bot.team === "T" && !c4State.isPlanted && !isTSquadOccupyingSite()) {
            const canMacroRotate = roundElapsed >= 7.0 && (world.gameTime - world.lastTRotationTime) >= 10.0;
            const wantsPivot = canMacroRotate && (bot.archetype !== "ENTRY" || rnd() < 0.65);
            if (wantsPivot) {
                const currentStrat = T_STRATEGIES[world.currentTStrategyKey];
                const curSite = currentStrat ? currentStrat.targetSite : "A";
                const pivotCandidates = (curSite === "A"
                    ? ["MAZE_TOP_LANE_RUSH", "MAZE_MID_LANE_RUSH", "MAZE_BOTTOM_LANE_RUSH", "SPLIT_B_MID", "MID_TO_B_DOORS"]
                    : ["GARDEN_A_SHORT", "SPLIT_A", "DIRECT_A_LONG"]
                ).filter(k => T_STRATEGIES[k] && k !== world.currentTStrategyKey);
                const nextKey = pivotCandidates[Math.floor(rnd() * pivotCandidates.length)];
                if (nextKey) {
                    executeTRotation(nextKey, "SMOKED CHOKE — ROTATING");
                    mode = "REROUTE";
                }
            } else if (bot.customMazeRoute || bot.customALaneRoute) {
                // Force immediate local lane swap (Maze Top/Mid/Bot or A Long/Short)
                bot.mazeRerouteCooldown = 0;
                bot.aLaneRerouteCooldown = 0;
                mode = "REROUTE";
            }
        }

        const fallbackPlan = getSafeSmokeFallbackPlan(bot, smokeCluster, fallbackDest);
        const anchorPos = fallbackPlan ? fallbackPlan.dest : fallbackDest;
        const watchAngle = fallbackPlan
            ? fallbackPlan.watchAngle
            : Math.atan2(smokeCluster.y - bot.y, smokeCluster.x - bot.x);

        // Optional pop-flash once when committing to hold an uncleared enemy smoke
        if (mode === "HOLD_AD" && bot.hasFlash && !isNearSpawn(bot.x, bot.y) && !isUnarmedC4Carrier && rnd() < 0.40) {
            const throughAng = Math.atan2(smokeCluster.y - bot.y, smokeCluster.x - bot.x);
            const flashX = smokeCluster.x + Math.cos(throughAng) * (smokeCluster.radius + 70);
            const flashY = smokeCluster.y + Math.sin(throughAng) * (smokeCluster.radius + 70);
            const throwPlan = solveBotUtilityThrow(bot, "FLASH", flashX, flashY, 120);
            if (throwPlan && !isUtilityTargetClaimed(bot.team, flashX, flashY, "FLASH", 260)) {
                claimUtilityTarget(bot.team, flashX, flashY, "FLASH", 2.2);
                executeBotGrenadeThrow(bot, 7, throwPlan.aimX, throwPlan.aimY, throwPlan.isExtended);
            }
        }

        bot.smokeHoldState = {
            mode,
            clusterX: smokeCluster.x,
            clusterY: smokeCluster.y,
            clusterRadius: smokeCluster.radius,
            anchorPos,
            watchAngle,
            until: world.gameTime + (mode === "REROUTE" ? 2.5 : (4.0 + rnd() * 2.5)),
            rearCheckTimer: 2.0 + rnd() * 1.4,
            rearCheckRemaining: 0,
            rearLookAngle: null
        };
    }

    const st = bot.smokeHoldState;
    if (!st || st.mode === "REROUTE") return null;

    // Periodic rear/flank shoulder-check while holding the smoke angle
    const hasActiveFrontCue = getActiveGazeHoldAngle(bot) !== null ||
        (bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 2.2));

    if (hasActiveFrontCue) {
        st.rearCheckRemaining = 0;
        st.rearCheckTimer = 2.2 + rnd() * 1.2;
    } else if (st.rearCheckRemaining > 0) {
        st.rearCheckRemaining = Math.max(0, st.rearCheckRemaining - dt);
    } else {
        st.rearCheckTimer -= dt;
        if (st.rearCheckTimer <= 0) {
            const rearAng = getSmokeRearCheckAngle(bot, st.watchAngle);
            if (rearAng !== null) {
                st.rearLookAngle = rearAng;
                st.rearCheckRemaining = 0.45;
            }
            st.rearCheckTimer = 2.8 + rnd() * 1.6;
        }
    }

    const lookAngle = (st.rearCheckRemaining > 0 && st.rearLookAngle !== null)
        ? st.rearLookAngle
        : st.watchAngle;

    // Smooth A-D-A-D counter-strafe holding once near the fallback cover anchor
    const distToAnchor = Math.hypot(st.anchorPos.x - bot.x, st.anchorPos.y - bot.y);
    if (distToAnchor <= 55 && bot.getEquippedKey() !== "AWP") {
        const adDest = getDefenseADStrafeDest(bot, st.anchorPos, st.watchAngle, dt, 28);
        return {
            dest: adDest,
            lookAngle,
            hold: false,
            isADPeeking: true
        };
    }

    return {
        dest: st.anchorPos,
        lookAngle,
        hold: distToAnchor <= 22,
        isADPeeking: false
    };
}

function isSegmentObscuredBySmoke(x1, y1, x2, y2) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(dist / 36));
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        if (isInsideSmoke(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 8)) {
            return true;
        }
    }
    return false;
}

// Estimates seconds until mutual line-of-sight/fire contact (0s if already exposed in LOS; higher if behind wall cover)
function estimateTargetContactTime(bot, target) {
    const dist = Math.hypot(target.x - bot.x, target.y - bot.y);
    const hasDirectLOS = getMapLineOfSight(bot.x, bot.y, target.x, target.y);
    if (hasDirectLOS) {
        // Immediate sightline: factor in turn time needed to bring crosshair onto target
        const aimAng = Math.atan2(target.y - bot.y, target.x - bot.x);
        const turnTime = Math.abs(normalizeAngle(aimAng - bot.angle)) / 10.5;
        return turnTime + (dist / 2400);
    }

    // Behind a wall: estimate time for the closer player to step out around the intervening corner
    const apex = getCornerPeekPrefireTarget(bot, target.x, target.y, target.vx || 0, target.vy || 0);
    const cornerDist = apex
        ? Math.min(Math.hypot(apex.x - bot.x, apex.y - bot.y), Math.hypot(apex.x - target.x, apex.y - target.y))
        : dist * 0.5;
    const closingSpeed = Math.max(135, Math.hypot(target.vx || 0, target.vy || 0), 185);
    return (cornerDist / closingSpeed) + 0.35;
}

function getTargetApproachabilityScore(bot, target) {
    if (!target || target.isDead) return -Infinity;
    const dist = Math.hypot(target.x - bot.x, target.y - bot.y);
    const contactTime = estimateTargetContactTime(bot, target);
    // Prioritize fastest expected contact time so open threats outrank enemies tucked behind walls
    let score = -contactTime * 210 - dist * 0.25;

    // 1. Visibility & Smoke Clarity: enemies outside smoke outrank obscured enemies inside/behind smoke
    const targetInSmoke = isInsideSmoke(target.x, target.y, 12);
    const smokeObscuringLine = !targetInSmoke && isSegmentObscuredBySmoke(bot.x, bot.y, target.x, target.y);
    if (targetInSmoke) {
        score -= (dist < 95) ? 140 : 420;
    } else if (smokeObscuringLine) {
        score -= 260;
    } else {
        score += 180;
    }

    // 2. Direct Line of Sight (unblocked by walls)
    const hasDirectLOS = getMapLineOfSight(bot.x, bot.y, target.x, target.y);
    score += hasDirectLOS ? 160 : -260;

    // 3. Fire-Free Approach (penalize targets standing inside or directly behind Molotov flames)
    const midX = (bot.x + target.x) * 0.5;
    const midY = (bot.y + target.y) * 0.5;
    const blockedByFire = world.firePatches.some(f =>
        f.life > 0.45 && (
            Math.hypot(f.x - target.x, f.y - target.y) < (f.radius + 24) ||
            Math.hypot(f.x - midX, f.y - midY) < (f.radius + 16)
        )
    );
    if (blockedByFire) score -= 175;

    // 4. Tactical Exposure & Immediate Threat
    if (bot.lastHitBy === target && (world.gameTime - bot.lastHitTime < 1.2)) {
        score += 190;
    }
    if ((target.blindTimer || 0) > 0.35) {
        score += 175;
    }
    if (target.isReloading || (target.equipTimer || 0) > 0.12 || target.activeSlot === 3 || (target.activeSlot >= 4 && target.activeSlot <= 8)) {
        score += 85;
    }
    if (target.hasC4) {
        score += 65;
    }

    return score;
}

function isPointingAtPlantedBombWithoutCue(bot, candidateAngle) {
    if (!c4State.isPlanted || bot.isDefusing) return false;
    const defuseCueActive = c4State.isBeingDefused || (world.gameTime - (c4State.lastDefuseSoundTime || -99) < 1.2);
    if (defuseCueActive) return false;

    const distToBomb = Math.hypot(c4State.plantX - bot.x, c4State.plantY - bot.y);
    if (distToBomb <= 45) return false;

    const angleToBomb = Math.atan2(c4State.plantY - bot.y, c4State.plantX - bot.x);
    return Math.abs(normalizeAngle(candidateAngle - angleToBomb)) < 0.34;
}

function getActiveGazeHoldAngle(bot) {
    bot._gazeCueIsUrgent = false;

    const hasFreshCloseAudio = bot.lastHeardSound &&
        (!bot.lastHeardSound.shooter || !bot.lastHeardSound.shooter.isDead) &&
        (world.gameTime - bot.lastHeardSound.time < 1.5) &&
        Math.hypot(bot.lastHeardSound.x - bot.x, bot.lastHeardSound.y - bot.y) <= 480;

    if (bot.lastSeenEnemyPos && (!bot.lastSeenEnemy || !bot.lastSeenEnemy.isDead)) {
        const seenAge = world.gameTime - bot.lastSeenEnemyPos.time;
        if (seenAge < 3.8 && (seenAge < 1.1 || !hasFreshCloseAudio)) {
            bot._gazeCueHasLOS = getMapLineOfSight(bot.x, bot.y, bot.lastSeenEnemyPos.x, bot.lastSeenEnemyPos.y);
            bot._gazeCueIsUrgent = seenAge < 1.5;
            return Math.atan2(bot.lastSeenEnemyPos.y - bot.y, bot.lastSeenEnemyPos.x - bot.x);
        }
    }

    // Compare clear acoustic cues (gunfire, footsteps) vs. shared squad intel and pick the clearest/freshest
    let bestClearCue = null;
    let bestClearScore = -Infinity;

    if (bot.lastHeardSound && (!bot.lastHeardSound.shooter || !bot.lastHeardSound.shooter.isDead)) {
        const age = world.gameTime - bot.lastHeardSound.time;
        if (age < 3.2) {
            const isGunfire = bot.lastHeardSound.type === "firing_trace" || bot.lastHeardSound.type === "visual";
            const dist = Math.hypot(bot.lastHeardSound.x - bot.x, bot.lastHeardSound.y - bot.y);
            const score = (isGunfire ? 220 : 165) - age * 45 - dist * 0.12;
            if (score > bestClearScore) {
                bestClearScore = score;
                bestClearCue = { x: bot.lastHeardSound.x, y: bot.lastHeardSound.y, age, dist, isGunfire };
            }
        }
    }

    const intelMap = bot.team === "CT" ? world.sharedEnemyIntelCT : world.sharedEnemyIntelT;
    if (intelMap) {
        for (const key in intelMap) {
            const intel = intelMap[key];
            if (!intel || !intel.enemy || intel.enemy.isDead || intel.isSpotCleared) continue;
            const age = world.gameTime - intel.time;
            if (age > 3.2) continue;
            const ix = intel.x !== undefined ? intel.x : intel.enemy.x;
            const iy = intel.y !== undefined ? intel.y : intel.enemy.y;
            const dist = Math.hypot(ix - bot.x, iy - bot.y);
            if (dist < 680) {
                const score = 175 - age * 45 - dist * 0.12;
                if (score > bestClearScore) {
                    bestClearScore = score;
                    bestClearCue = { x: ix, y: iy };
                }
            }
        }
    }

    if (bestClearCue) {
        bot._gazeCueHasLOS = getMapLineOfSight(bot.x, bot.y, bestClearCue.x, bestClearCue.y);
        const cueAge = bestClearCue.age ?? 0;
        const cueDist = bestClearCue.dist ?? Math.hypot(bestClearCue.x - bot.x, bestClearCue.y - bot.y);
        bot._gazeCueIsUrgent = Boolean(
            (bestClearCue.isGunfire && cueAge < 2.0 && cueDist <= 720) ||
            (!bestClearCue.isGunfire && cueAge < 1.8 && cueDist <= FOOTSTEP_LISTEN_RADIUS)
        );
        return Math.atan2(bestClearCue.y - bot.y, bestClearCue.x - bot.x);
    }
    bot._gazeCueHasLOS = false;
    return null;
}

function isRearGazeBlocked(bot, candidateAngle, isMoving) {
    if (bot.isHoldingCrossfire || bot.isDefusing || bot.executePhase === "PLANT_LOCK" || bot.isExitingSmoke || bot.isADPeeking || bot.pendingUtilityThrow) {
        return false;
    }

    const enforcingForwardApproach = Boolean(bot.isApproachingSite);
    if (!isMoving && !enforcingForwardApproach) {
        return false;
    }

    const recentlyHit = bot.lastHitBy && !bot.lastHitBy.isDead && (world.gameTime - bot.lastHitTime < 1.5);
    const heardGunfireRecently = bot.lastHeardSound &&
        (bot.lastHeardSound.type === "firing_trace" || bot.lastHeardSound.type === "visual") &&
        (world.gameTime - bot.lastHeardSound.time < 3.2);
    const heardCloseFootstepRecently = bot.lastHeardSound &&
        (bot.lastHeardSound.type === "footstep" || bot.lastHeardSound.type === "ripple") &&
        (world.gameTime - bot.lastHeardSound.time < 2.2) &&
        Math.hypot(bot.lastHeardSound.x - bot.x, bot.lastHeardSound.y - bot.y) <= FOOTSTEP_LISTEN_RADIUS;
    const hasDirectVisualTarget = bot.targetEnemy && !bot.targetEnemy.isDead &&
        getMapLineOfSight(bot.x, bot.y, bot.targetEnemy.x, bot.targetEnemy.y);
    const contestingDefuse = bot.team === "T" && c4State.isPlanted && c4State.isBeingDefused;
    if (recentlyHit || heardGunfireRecently || heardCloseFootstepRecently || hasDirectVisualTarget || contestingDefuse) {
        return false;
    }

    const forwardAxis = (bot.forwardProgressAngle !== undefined && bot.forwardProgressAngle !== null)
        ? bot.forwardProgressAngle
        : ((Math.hypot(bot.vx || 0, bot.vy || 0) > 15) ? Math.atan2(bot.vy, bot.vx) : bot.angle);

    const maxCone = enforcingForwardApproach ? (100 * Math.PI / 180) : (105 * Math.PI / 180);
    return Math.abs(normalizeAngle(candidateAngle - forwardAxis)) > maxCone;
}

// Redirects non-combat look angles away from close walls (< minClearance) toward the nearest open lane or corner edge
function sanitizeOpenLookAngle(bot, desiredAngle, minClearance = 105) {
    if (!bot || desiredAngle === null || desiredAngle === undefined || !Number.isFinite(desiredAngle)) {
        return desiredAngle;
    }
    const muzzleDist = (bot.radius || TORSO_RADIUS) + 4;
    const startX = bot.x + Math.cos(desiredAngle) * muzzleDist;
    const startY = bot.y + Math.sin(desiredAngle) * muzzleDist;
    if (!checkWallCollision(startX, startY, 3)) {
        const hit = getRayObstacleEndpoint(startX, startY, desiredAngle, 260);
        if (Math.hypot(hit.x - startX, hit.y - startY) >= minClearance) {
            return desiredAngle;
        }
    }

    let bestAngle = desiredAngle;
    let bestScore = -Infinity;

    for (let i = 0; i < 24; i++) {
        const candAng = normalizeAngle(desiredAngle + (i * Math.PI) / 12);
        const sx = bot.x + Math.cos(candAng) * muzzleDist;
        const sy = bot.y + Math.sin(candAng) * muzzleDist;
        if (checkWallCollision(sx, sy, 3)) continue;

        const hit = getRayObstacleEndpoint(sx, sy, candAng, 340);
        const clearDist = Math.hypot(hit.x - sx, hit.y - sy);
        if (clearDist < 55) continue;

        const angDiff = Math.abs(normalizeAngle(candAng - desiredAngle));
        // Favor open sightlines (>= minClearance) closest to the original direction of interest
        const clearanceScore = Math.min(340, clearDist) + (clearDist >= minClearance ? 140 : -120);
        const score = clearanceScore - angDiff * 70;
        if (score > bestScore) {
            bestScore = score;
            bestAngle = candAng;
        }
    }

    return bestAngle;
}

// Detects enemy bullets passing inside the bot's vision cone that originated from behind/flank
function evaluateRearBulletFlyby(bot, dt) {
    if ((bot.rearBulletSweepTimer || 0) > 0) {
        bot.rearBulletSweepTimer = Math.max(0, bot.rearBulletSweepTimer - dt);
        return;
    }
    if (!world.bullets || world.bullets.length === 0) return;

    for (let i = 0; i < world.bullets.length; i++) {
        const b = world.bullets[i];
        if (!b || b.owner?.team === bot.team) continue;

        const dBullet = Math.hypot(b.x - bot.x, b.y - bot.y);
        if (dBullet > 340) continue;

        // Bullet must be visible in front of the bot's gaze cone
        const angToBullet = Math.atan2(b.y - bot.y, b.x - bot.x);
        if (Math.abs(normalizeAngle(angToBullet - bot.angle)) > (85 * Math.PI / 180)) continue;
        if (!getMapLineOfSight(bot.x, bot.y, b.x, b.y)) continue;

        // Check if the bullet's origin/reverse travel vector came from behind the bot (> 105° off gaze)
        const bulletTravelAng = Math.atan2(b.vy || 0, b.vx || 0);
        const bulletOriginAng = normalizeAngle(bulletTravelAng + Math.PI);
        if (Math.abs(normalizeAngle(bulletOriginAng - bot.angle)) > (105 * Math.PI / 180)) {
            bot.rearBulletSweepTimer = 0.55;
            bot.rearBulletTargetAngle = bulletOriginAng;
            break;
        }
    }
}

export function updateBotHeadOrientation(bot, lookAngle, isMoving, hasThreat, dt) {
    if (bot.antiFlashTimer > 0) {
        bot.postSmokeSweepTimer = 0;
        bot.rearBulletSweepTimer = 0;
        bot.angle = rotateTowardsDamped(bot.angle, bot.antiFlashAngle, 18.0, dt);
        return;
    }

    evaluateRearBulletFlyby(bot, dt);
    if ((bot.rearBulletSweepTimer || 0) > 0 && !hasThreat && bot.rearBulletTargetAngle !== undefined) {
        const rearLook = sanitizeOpenLookAngle(bot, bot.rearBulletTargetAngle, 75);
        bot.angle = rotateTowardsDamped(bot.angle, rearLook, 11.5, dt, 8.8);
        return;
    }

    if ((bot.utilityLookLockTimer || 0) > 0 && bot.utilityLookAngle !== undefined) {
        if (bot.pendingUtilityThrow || !bot.isApproachingSite || !isRearGazeBlocked(bot, bot.utilityLookAngle, true)) {
            bot.angle = rotateTowardsDamped(bot.angle, bot.utilityLookAngle, 11.5, dt, 8.5);
            return;
        }
    }

    // Tier 1/2: Direct-LOS cues and urgent close gunfire/footsteps override forward corner pre-aims (even during high-priority macro goals)
    const rawGazeHoldAngle = getActiveGazeHoldAngle(bot);
    const hasExplicitCornerAim = lookAngle !== null && lookAngle !== undefined;
    const allowUrgentAudioTurn = Boolean(bot._gazeCueIsUrgent) && !bot.isDefusing && bot.executePhase !== "PLANT_LOCK";
    if (rawGazeHoldAngle !== null && (!hasThreat || allowUrgentAudioTurn) &&
        (bot._gazeCueHasLOS || bot._gazeCueIsUrgent || !hasExplicitCornerAim) &&
        !isRearGazeBlocked(bot, rawGazeHoldAngle, isMoving)) {
        const gazeHoldAngle = bot._gazeCueHasLOS
            ? rawGazeHoldAngle
            : sanitizeOpenLookAngle(bot, rawGazeHoldAngle, 105);
        bot.postSmokeSweepTimer = 0;
        bot.transitScanAngle = 0;
        const turnDelta = Math.abs(normalizeAngle(gazeHoldAngle - bot.angle));
        const isLargeRearTurn = turnDelta > (Math.PI * 0.55);
        const turnSpeed = isLargeRearTurn ? 9.5 : 11.5;
        const maxTurnRate = isLargeRearTurn ? 7.5 : 8.5;
        bot.angle = rotateTowardsDamped(bot.angle, gazeHoldAngle, turnSpeed, dt, maxTurnRate);
        return;
    }

    // Smooth 180-degree check within 0.5s after exiting a smoke cluster when no sound cues exist
    if ((bot.postSmokeSweepTimer || 0) > 0) {
        const wasShotRecently = bot.lastHitBy && !bot.lastHitBy.isDead && (world.gameTime - bot.lastHitTime < 0.45);
        if (hasThreat || wasShotRecently) {
            bot.postSmokeSweepTimer = 0;
        } else {
            bot.postSmokeSweepTimer = Math.max(0, bot.postSmokeSweepTimer - dt);
            const progress = 1.0 - (bot.postSmokeSweepTimer / 0.5);
            const sweepPhase = Math.sin(progress * Math.PI * 2);
            const dir = bot.postSmokeSweepDir || 1;
            const rawSweepAngle = normalizeAngle((bot.postSmokeSweepBaseAngle ?? bot.angle) + dir * sweepPhase * (Math.PI / 2));
            const sweepAngle = sanitizeOpenLookAngle(bot, rawSweepAngle, 85);
            bot.angle = rotateTowardsDamped(bot.angle, sweepAngle, 11.5, dt, 8.5);
            return;
        }
    }

    if (lookAngle !== null && lookAngle !== undefined) {
        const rawLookAngle = (!hasThreat && isPointingAtPlantedBombWithoutCue(bot, lookAngle))
            ? getOutwardDefuseWatchAngle(bot)
            : lookAngle;
        const cornerClearance = (bot.isHoldingCrossfire || bot.isADPeeking) ? 58 : 105;
        const effectiveLookAngle = hasThreat ? rawLookAngle : sanitizeOpenLookAngle(bot, rawLookAngle, cornerClearance);
        if (hasThreat || !isRearGazeBlocked(bot, effectiveLookAngle, isMoving)) {
            bot.transitScanAngle = 0;
            bot.angle = rotateTowardsDamped(bot.angle, effectiveLookAngle, hasThreat ? 11.5 : 8.5, dt);
            return;
        }
    }

    // Tier 3: Suspicious spots (with 0.40s gaze hysteresis and open-corridor check)
    const suspiciousSpot = getRelevantSuspiciousSpot(bot);
    if (suspiciousSpot && (!isMoving || getMapLineOfSight(bot.x, bot.y, suspiciousSpot.x, suspiciousSpot.y))) {
        const spotAngle = sanitizeOpenLookAngle(bot, Math.atan2(suspiciousSpot.y - bot.y, suspiciousSpot.x - bot.x), 105);
        if (!isRearGazeBlocked(bot, spotAngle, isMoving) && !isPointingAtPlantedBombWithoutCue(bot, spotAngle)) {
            bot.transitScanAngle = 0;
            bot.smoothGazeCache = { angle: spotAngle, until: world.gameTime + 0.40 };
            bot.angle = rotateTowardsDamped(bot.angle, spotAngle, 7.2, dt);
            return;
        }
    }

    if (bot.smoothGazeCache && world.gameTime < bot.smoothGazeCache.until &&
        !isRearGazeBlocked(bot, bot.smoothGazeCache.angle, isMoving) &&
        !isPointingAtPlantedBombWithoutCue(bot, bot.smoothGazeCache.angle)) {
        const cachedAngle = sanitizeOpenLookAngle(bot, bot.smoothGazeCache.angle, 105);
        bot.angle = rotateTowardsDamped(bot.angle, cachedAngle, 6.5, dt);
        return;
    }

    if (isMoving) {
        const moveAngle = (bot.forwardProgressAngle !== undefined && bot.forwardProgressAngle !== null)
            ? bot.forwardProgressAngle
            : ((Math.hypot(bot.vx || 0, bot.vy || 0) > 15) ? Math.atan2(bot.vy, bot.vx) : bot.angle);

        bot.transitScanTimer = (bot.transitScanTimer || 0) - dt;
        if (bot.transitScanTimer <= 0) {
            bot.transitScanTimer = 1.15 + rnd() * 1.45;
            bot.transitScanDir = (bot.transitScanDir === 1) ? -1 : 1;
            bot.transitScanAngle = bot.transitScanDir * (10 * Math.PI / 180);
        }
        const scanTarget = sanitizeOpenLookAngle(bot, normalizeAngle(moveAngle + (bot.transitScanAngle || 0)), 95);
        bot.angle = rotateTowardsDamped(bot.angle, scanTarget, 5.2, dt);
    }
}

/* ==========================================================================
   AI LIFECYCLE & STAGE HELPERS
   ========================================================================== */
function decayBotTimers(bot, dt) {
    if (bot.equipTimer > 0) bot.equipTimer = Math.max(0, bot.equipTimer - dt);
    if (bot.targetLockTimer > 0) bot.targetLockTimer -= dt;
    if (bot.knifeLockTimer > 0) bot.knifeLockTimer -= dt;
    if (bot.awpBlindShotCooldown > 0) bot.awpBlindShotCooldown -= dt;
    if (bot.utilitySearchCooldown > 0) bot.utilitySearchCooldown -= dt;
    if (bot.utilityLookLockTimer > 0) bot.utilityLookLockTimer -= dt;

    if (bot.combatCommitmentTimer > 0) {
        bot.combatCommitmentTimer -= dt;
        if (bot.combatCommitmentTimer <= 0 || (bot.lastCombatTarget && bot.lastCombatTarget.isDead)) {
            bot.combatCommitmentTimer = 0;
            bot.lastCombatTarget = null;
            bot.lastCombatTargetPos = null;
        }
    }

    if (bot.tradeTimer > 0) {
        bot.tradeTimer -= dt;
        if (bot.tradeTimer <= 0 || (bot.tradeTarget && bot.tradeTarget.isDead)) {
            bot.tradeTarget = null;
            bot.tradeTimer = 0;
        }
    }

    if (bot.lastHeardSound && bot.lastHeardSound.shooter && bot.lastHeardSound.shooter.isDead) {
        bot.lastHeardSound = null;
    }
    if (bot.vulnerableTarget && (!bot.vulnerableTarget.target || bot.vulnerableTarget.target.isDead || (world.gameTime - bot.vulnerableTarget.time >= 2.2))) {
        bot.vulnerableTarget = null;
    }
}

function evaluateAntiFlashReflex(bot, dt) {
    if (bot.antiFlashTimer > 0) {
        bot.antiFlashTimer -= dt;
        return;
    }

    const incomingFlash = world.grenades.find(g =>
        g.type === "FLASH" && g.fuse > 0 && g.fuse <= 0.42 &&
        Math.hypot(g.x - bot.x, g.y - bot.y) < 480 &&
        getMapLineOfSight(bot.x, bot.y, g.x, g.y)
    );
    if (!incomingFlash) return;

    const angleToFlash = Math.atan2(incomingFlash.y - bot.y, incomingFlash.x - bot.x);
    const flashDiff = Math.abs(normalizeAngle(angleToFlash - bot.angle));
    const reflexChance = (bot.archetype === "ENTRY" || bot.archetype === "AWPER" || bot.archetype === "SUPPORT") ? 0.85 : 0.68;
    if (flashDiff < Math.PI * 0.55 && rnd() < reflexChance) {
        bot.antiFlashAngle = normalizeAngle(angleToFlash + Math.PI);
        bot.antiFlashTimer = 0.42;
    }
}

function fuzzAcousticFootstep(bot) {
    if (!bot.lastHeardSound || (bot.lastHeardSound.type !== "footstep" && bot.lastHeardSound.type !== "ripple")) {
        return;
    }
    const s = bot.lastHeardSound;
    if (s.isApproximate || !s.shooter) return;

    const dist = Math.hypot(s.shooter.x - bot.x, s.shooter.y - bot.y);
    const occluded = !getMapLineOfSight(bot.x, bot.y, s.shooter.x, s.shooter.y) ||
        isInsideSmoke(bot.x, bot.y) ||
        isInsideSmoke(s.shooter.x, s.shooter.y);

    // Scale uncertainty with distance so close footsteps stay accurate and never jump behind the listener
    const distScale = Math.max(0.25, Math.min(1.0, dist / 380));
    const minR = (occluded ? 42 : 24) * distScale;
    const maxR = (occluded ? 115 : 75) * distScale;

    let resolvedX = s.shooter.x;
    let resolvedY = s.shooter.y;
    for (let attempt = 0; attempt < 6; attempt++) {
        const fuzzDist = minR + rnd() * Math.max(6, maxR - minR);
        const fuzzAng = rnd() * Math.PI * 2;
        const candX = s.shooter.x + Math.cos(fuzzAng) * fuzzDist;
        const candY = s.shooter.y + Math.sin(fuzzAng) * fuzzDist;
        if (!checkWallCollision(candX, candY, 12) &&
            getMapLineOfSight(s.shooter.x, s.shooter.y, candX, candY)) {
            resolvedX = candX;
            resolvedY = candY;
            break;
        }
    }

    s.x = resolvedX;
    s.y = resolvedY;
    s.isApproximate = true;
}

function processPassiveObjectiveEvents(bot) {
    if (bot.team === "CT" && c4State.isDropped && !c4State.ctSeenDropped) {
        if (isPointVisibleToBot(bot, c4State.dropX, c4State.dropY)) {
            c4State.ctSeenDropped = true;
            c4State.ctSeenRecovered = false;
            audio.announce("Bomb dropped", "CT");
            showAnnouncerBanner("CT RADIO", `${bot.name}: BOMB DROPPED!`, "CT");
        }
    }

    if (bot.team === "T" && c4State.isDropped && Math.hypot(c4State.dropX - bot.x, c4State.dropY - bot.y) < 45) {
        const witnessingCT = world.livingCT.find(b => b.isBot && isPointVisibleToBot(b, c4State.dropX, c4State.dropY));
        c4State.isDropped = false;
        c4State.c4Retriever = null;
        bot.hasC4 = true;
        c4State.carrier = bot;
        bot.selectSlot(bot.primaryKey ? 1 : (bot.secondaryKey ? 2 : 3));
        audio.announce("Got the bomb", "T");
        showAnnouncerBanner("C4 RECOVERED", `${bot.name} RECOVERED THE BOMB!`, "T");
        if (witnessingCT) {
            c4State.ctSeenRecovered = true;
            c4State.ctSeenDropped = false;
            audio.announce("Bomb recovered", "CT");
            showAnnouncerBanner("CT RADIO", `${witnessingCT.name}: BOMB RECOVERED!`, "CT");
        }
    }

    if (bot.team === "CT" && !bot.hasReachedAssignedSite && bot.assignedCTStrat) {
        const strat = bot.assignedCTStrat;
        const routeFinished = bot.planIndex >= strat.route.length;
        if (bot.assignedDefenseSpot) {
            const distToSpot = Math.hypot(bot.assignedDefenseSpot.x - bot.x, bot.assignedDefenseSpot.y - bot.y);
            if (distToSpot < 55 || (routeFinished && distToSpot < 90)) bot.hasReachedAssignedSite = true;
        } else if (strat.type === "SITE") {
            const targetSite = (strat.site === "B") ? MAP.siteB : MAP.siteA;
            if (isInsideExpandedSite(bot.x, bot.y, targetSite) || routeFinished) bot.hasReachedAssignedSite = true;
        } else if (routeFinished) {
            bot.hasReachedAssignedSite = true;
        }
    }
}

function updateBaseAWPScope(bot, priorityEnemy) {
    if (bot.getEquippedKey() !== "AWP") {
        bot.isScoped = false;
        return;
    }
    if (!priorityEnemy) {
        const nearlyStopped = Math.hypot(bot.vx || 0, bot.vy || 0) < 45;
        const canHoldScoped = (bot.isHoldingCrossfire || bot.isPatrolling) &&
            nearlyStopped &&
            !isNearSpawn(bot.x, bot.y) &&
            hasAWPScopeLineClearance(bot);
        if (!canHoldScoped) bot.isScoped = false;
    }
}

function handleImminentC4Evacuation(bot, priorityEnemy, distToPlantedC4, dt) {
    if (bot.isDefusing) {
        bot.isDefusing = false;
        c4State.isBeingDefused = false;
        c4State.defuseProgress = 0;
    }
    if (!c4State.evacAnnounced) {
        c4State.evacAnnounced = true;
        audio.announce("Get out of there, it's gonna blow");
    }

    bot.isSilentWalking = false;
    bot.isCrouching = false;
    bot.isPatrolling = false;
    bot.isHoldingCrossfire = false;

    if (!priorityEnemy && bot.activeSlot !== 3 && bot.knifeLockTimer <= 0) {
        bot.selectSlot(3);
    }

    const safeHaven = (c4State.plantSite === "A") ? C4_EVAC_HAVENS.A : C4_EVAC_HAVENS.B;
    const evacDest = (Math.hypot(safeHaven.x - c4State.plantX, safeHaven.y - c4State.plantY) >= 760)
        ? safeHaven
        : navCellToWorld(worldToNavCell(
            bot.x + Math.cos(Math.atan2(bot.y - c4State.plantY, bot.x - c4State.plantX)) * 500,
            bot.y + Math.sin(Math.atan2(bot.y - c4State.plantY, bot.x - c4State.plantX)) * 500
        ));

    bot.forwardProgressAngle = Math.atan2(evacDest.y - bot.y, evacDest.x - bot.x);
    steerBotToDestination(bot, evacDest.x, evacDest.y, 195, dt, { stopRadius: 15, autoAim: false });

    if (priorityEnemy && !(bot.team === "T" && bot.hasC4 && !c4State.isPlanted)) {
        const aimPt = getBotCombatAimPoint(bot, priorityEnemy, dt);
        const aimAng = Math.atan2(aimPt.y - bot.y, aimPt.x - bot.x);
        updateBotHeadOrientation(bot, aimAng, true, true, dt);
        if (Math.abs(normalizeAngle(aimAng - bot.angle)) < 0.25) performAttack(bot, aimPt.x, aimPt.y, false);
    } else {
        updateBotHeadOrientation(bot, null, true, false, dt);
    }
}
function getTWaitingPatrolPlan(bot, anchorPos, dt) {
    const baseAnchor = anchorPos || { x: bot.x, y: bot.y };
    const needNewPt = !bot.tWaitPatrolPt ||
        world.gameTime >= (bot.tWaitPatrolUntil || 0) ||
        Math.hypot(bot.tWaitPatrolPt.x - bot.x, bot.tWaitPatrolPt.y - bot.y) <= 32 ||
        Math.hypot(bot.tWaitPatrolPt.x - baseAnchor.x, bot.tWaitPatrolPt.y - baseAnchor.y) > 320;

    if (needNewPt) {
        const candidates = [];

        // 1. Prefer nearby tactical corners around the waiting zone
        for (let i = 0; i < TACTICAL_CORNERS.length; i++) {
            const c = TACTICAL_CORNERS[i];
            const dAnchor = Math.hypot(c.x - baseAnchor.x, c.y - baseAnchor.y);
            if (dAnchor >= 75 && dAnchor <= 280 && getMapLineOfSight(baseAnchor.x, baseAnchor.y, c.x, c.y)) {
                candidates.push(snapToWalkablePos(c.x, c.y, bot.radius + 4));
            }
        }

        // 2. Sample open walkable patrol points around the waiting anchor
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
            const rad = 115 + rnd() * 95;
            const cand = snapToWalkablePos(
                baseAnchor.x + Math.cos(a) * rad,
                baseAnchor.y + Math.sin(a) * rad,
                bot.radius + 4
            );
            if (!checkWallCollision(cand.x, cand.y, bot.radius + 4) &&
                getMapLineOfSight(baseAnchor.x, baseAnchor.y, cand.x, cand.y)) {
                candidates.push(cand);
            }
        }

        const valid = candidates.filter(pt => {
            if (Math.hypot(pt.x - bot.x, pt.y - bot.y) < 55) return false;
            const inFire = world.firePatches.some(f => f.life > 0.45 && Math.hypot(pt.x - f.x, pt.y - f.y) < f.radius + 32);
            if (inFire) return false;
            const stackedOnAlly = world.livingT.some(m => m && m !== bot && !m.isDead && Math.hypot(pt.x - m.x, pt.y - m.y) < 95);
            return !stackedOnAlly;
        });

        bot.tWaitPatrolPt = valid.length > 0
            ? valid[Math.floor(rnd() * valid.length)]
            : baseAnchor;
        bot.tWaitPatrolUntil = world.gameTime + (1.8 + rnd() * 1.1);
    }

    const dest = bot.tWaitPatrolPt;
    const moveAngle = Math.hypot(dest.x - bot.x, dest.y - bot.y) > 12
        ? Math.atan2(dest.y - bot.y, dest.x - bot.x)
        : bot.angle;

    bot.isPatrolling = true;
    bot.isCrouching = false;
    updatePatrolVision(bot, moveAngle, dt);

    return {
        dest,
        lookAngle: bot.angle,
        hold: false
    };
}
/* ==========================================================================
   MAIN BOT AI UPDATE ENTRYPOINT
   ========================================================================== */
export function updateBotAI(bot, dt) {
    if (bot.isDead) {
        if (bot.isDefusing || (c4State.designatedDefuser === bot && c4State.isBeingDefused)) {
            bot.isDefusing = false;
            c4State.isBeingDefused = false;
            c4State.defuseProgress = 0;
        }
        if (bot.executePhase === "PLANT_LOCK" || c4State.planter === bot) {
            bot.executePhase = "BREACH";
            c4State.plantProgress = 0;
            c4State.planter = null;
        }
        return;
    }
    if (matchState.roundPhase === "BUY_TIME") return;

    // 1. Decay Timers, Reflexes & Sensor Sweep
    decayBotTimers(bot, dt);
    evaluateAntiFlashReflex(bot, dt);

    if (bot.spawnExitDelay > 0) {
        bot.spawnExitDelay -= dt;
        brakeBot(bot, dt);
        return;
    }

    if (bot.lastHitBy && !bot.lastHitBy.isDead && (world.gameTime - bot.lastHitTime < 0.75)) {
        bot.visionScanThrottle = 0;
    }

    const sensors = scanBotSensors(bot, dt);
    const { priorityEnemy, closestEnemy, priorityDist, smokeEnemyTarget, smokeCueType, blockingSmokeCloud } = sensors;
    fuzzAcousticFootstep(bot);

    const hasCloseCombatThreat = Boolean(
        (priorityEnemy && priorityDist < 260) ||
        (closestEnemy && Math.hypot(closestEnemy.x - bot.x, closestEnemy.y - bot.y) < 240)
    );
    if (processPendingUtilityThrow(bot, dt, hasCloseCombatThreat)) {
        return;
    }

    // 2. Immediate CT Stick-Defuse & Passive World Checks
    const allTerroristsDead = c4State.isPlanted && world.livingT.length === 0;
    if (bot.team === "CT" && allTerroristsDead) {
        if (!c4State.designatedDefuser || c4State.designatedDefuser.isDead || !c4State.isBeingDefused) {
            const aliveCTs = world.livingCT.filter(c => c && !c.isDead).sort((a, b) =>
                (Math.hypot(c4State.plantX - a.x, c4State.plantY - a.y) - (a.hasDefuseKit ? 180 : 0)) -
                (Math.hypot(c4State.plantX - b.x, c4State.plantY - b.y) - (b.hasDefuseKit ? 180 : 0))
            );
            if (aliveCTs[0]) c4State.designatedDefuser = aliveCTs[0];
        }
    }

    const ctTactic = (bot.team === "CT" && c4State.isPlanted)
        ? evaluateCTDefuseTactic(bot, closestEnemy, priorityEnemy)
        : "NONE";

    if (bot.isDefusing && ctTactic !== "STICK_DEFUSE" && ctTactic !== "DEFUSE_BOMB" && ctTactic !== "FAKE_DEFUSE") {
        bot.isDefusing = false;
        if (c4State.designatedDefuser === bot) {
            c4State.isBeingDefused = false;
            c4State.defuseProgress = 0;
        }
    }

    if (ctTactic === "STICK_DEFUSE") {
        bot.isPatrolling = false;
        bot.isCrouching = true;
        bot.isDefusing = true;
        c4State.designatedDefuser = bot;
        c4State.isBeingDefused = true;
        c4State.lastDefuseSoundTime = world.gameTime;
        brakeBot(bot, dt);

        const stickWatchAngle = getOutwardDefuseWatchAngle(bot);
        bot.angle = rotateTowardsDamped(bot.angle, stickWatchAngle, 12.0, dt);

        const defuseTime = bot.hasDefuseKit ? 5.0 : 10.0;
        c4State.defuseProgress += dt / defuseTime;
        if (c4State.defuseProgress >= 1.0) triggerC4Defused();
        return;
    }

    const roundElapsed = 115 - matchState.roundTimer;
    const inSiteABox = isStrictlyInsideSite(bot.x, bot.y, MAP.siteA);
    const inSiteBBox = isStrictlyInsideSite(bot.x, bot.y, MAP.siteB);
    const inAnySiteBox = inSiteABox || inSiteBBox;

    processPassiveObjectiveEvents(bot);
    updateBaseAWPScope(bot, priorityEnemy);

    const isSoloTClutch = bot.team === "T" && !c4State.isPlanted && world.livingT.length === 1;
    const isTClockUnder20s = bot.team === "T" && !c4State.isPlanted && matchState.roundTimer <= 20.0;

    if ((isSoloTClutch || isTClockUnder20s) && (!bot.soloClutchCommitted || (isTClockUnder20s && !bot.soloClockUrgentTriggered))) {
        const refT = (c4State.carrier && !c4State.carrier.isDead) ? c4State.carrier : bot;
        const clutchPlan = evaluateSoloClutchSiteChoice(refT, 20.0);
        if (isSoloTClutch) bot.soloClutchCommitted = true;
        if (isTClockUnder20s) bot.soloClockUrgentTriggered = true;
        pincerState.breachInitiated = true;

        const chosenKey = clutchPlan?.stratKey || world.currentTStrategyKey;
        const chosenStrat = T_STRATEGIES[chosenKey] || T_STRATEGIES[world.currentTStrategyKey];
        if (chosenStrat) {
            world.currentTStrategyKey = chosenKey;
            world.lastTRotationTime = world.gameTime;
            bot.assignedSite = chosenStrat.targetSite;
            bot.executePhase = "BREACH";
            bot.siteObjectiveLock = true;
            bot.customMazeRoute = null;
            bot.customALaneRoute = null;
            bot.tAttackPeekState = null;
            bot.smokeHoldState = null;
            bot.isPatrolling = false;

            const useCarrierRoute = bot.hasC4 || bot.squadGroup === "ALPHA" || !chosenStrat.isSplit;
            const route = useCarrierRoute ? chosenStrat.carrierRoute : chosenStrat.supportRoute;
            bot.planIndex = getClosestRouteIndex(bot.x, bot.y, route);
            bot.maxPlanIndex = bot.planIndex;
            bot.isFollowingPlanRoute = true;
            bot.currentPath = [];
        }
    }

    const isUnarmedC4Carrier = bot.team === "T" && bot.hasC4 && !c4State.isPlanted;
    const retakeTargetSite = c4State.plantSite === "B" ? MAP.siteB : MAP.siteA;
    bot.isApproachingSite = (bot.team === "T")
        ? (!c4State.isPlanted && !inAnySiteBox)
        : (c4State.isPlanted
            ? !isInsideExpandedSite(bot.x, bot.y, retakeTargetSite)
            : (!bot.hasReachedAssignedSite && !bot.isHoldingCrossfire && !bot.isPatrolling));

    // =====================================================================
    // PRIORITY 1: IMMINENT C4 EXPLOSION EVACUATION
    // =====================================================================
    const distToPlantedC4 = c4State.isPlanted ? Math.hypot(bot.x - c4State.plantX, bot.y - c4State.plantY) : Infinity;
    const defuseDuration = bot.hasDefuseKit ? 5.0 : 10.0;
    const timeNeededToDefuse = (1.0 - c4State.defuseProgress) * defuseDuration;
    const isDefuser = c4State.isPlanted && (bot === c4State.designatedDefuser);
    const canDefuseInTime = isDefuser && (c4State.timer > timeNeededToDefuse + 0.3);
    const isBombImminent = c4State.isPlanted && c4State.timer <= 7.0 && !canDefuseInTime;

    if (isBombImminent && distToPlantedC4 < 750) {
        handleImminentC4Evacuation(bot, priorityEnemy, distToPlantedC4, dt);
        return;
    }

    // =====================================================================
    // PRIORITY 2: C4 PLANTING & DEFUSING LOCKS (REQUIRES OCCUPIED SITE & NO NEARBY ENEMIES)
    // =====================================================================
    const cancelBotPlant = () => {
        if (bot.executePhase === "PLANT_LOCK") bot.executePhase = "BREACH";
        if (c4State.planter === bot) {
            c4State.plantProgress = 0;
            c4State.planter = null;
        }
        bot.isCrouching = false;
        if (bot.activeSlot === 6) {
            bot.selectSlot(bot.primaryKey ? 1 : (bot.secondaryKey ? 2 : 3));
        }
    };

    const incomingHEDanger = world.grenades.some(g =>
        g.type === "HEGRENADE" &&
        Math.hypot(g.x - bot.x, g.y - bot.y) < 250 &&
        getMapLineOfSight(bot.x, bot.y, g.x, g.y)
    );

    const activePlantSiteRect = inSiteABox ? MAP.siteA : (inSiteBBox ? MAP.siteB : null);
    const activePlantSiteKey = inSiteABox ? "A" : "B";
    const siteOccupiedForPlant = activePlantSiteRect && isTReadyToPlantAtSite(activePlantSiteKey);
    const enemySeenNearPlant = Boolean(
        (priorityEnemy && priorityDist < 420) ||
        (closestEnemy && Math.hypot(closestEnemy.x - bot.x, closestEnemy.y - bot.y) < 380)
    );
    const enemyHeardNearPlant = Boolean(
        bot.lastHeardSound &&
        (world.gameTime - bot.lastHeardSound.time < 1.8) &&
        Math.hypot(bot.lastHeardSound.x - bot.x, bot.lastHeardSound.y - bot.y) < 380
    );

    if (bot.team === "T" && bot.hasC4 && !c4State.isPlanted && (inAnySiteBox || bot.executePhase === "PLANT_LOCK")) {
        if (!inAnySiteBox || !siteOccupiedForPlant || incomingHEDanger || enemySeenNearPlant || enemyHeardNearPlant) {
            cancelBotPlant();
        } else {
            if (bot.executePhase !== "PLANT_LOCK" && bot.hasSmoke && !isUtilityTargetClaimed("T", bot.x, bot.y, "SMOKE", 160)) {
                claimUtilityTarget("T", bot.x, bot.y, "SMOKE", 5.0);
                executeBotGrenadeThrow(bot, 5, bot.x, bot.y, false);
                return;
            }

            if (bot.executePhase !== "PLANT_LOCK") {
                bot.executePhase = "PLANT_LOCK";
                c4State.planter = bot;
                c4State.plantProgress = 0;
            }

            brakeBot(bot, dt);
            bot.selectSlot(6);
            bot.isCrouching = true;
            const plantFacingAngle = inSiteABox ? Math.PI : 0;
            bot.angle = rotateTowardsDamped(bot.angle, plantFacingAngle, 8.0, dt);

            c4State.plantProgress += dt / 3.2;
            if (c4State.plantProgress >= 1.0) {
                triggerC4Plant(bot, inSiteABox ? "A" : "B");
                bot.executePhase = "DEFEND_BOMB";
                bot.isCrouching = false;
                bot.selectSlot(bot.primaryKey ? 1 : (bot.secondaryKey ? 2 : 3));
            }
            return;
        }
    } else if (c4State.planter === bot) {
        cancelBotPlant();
    }

    if (bot.isDefusing && ctTactic !== "DEFUSE_BOMB" && ctTactic !== "FAKE_DEFUSE" && ctTactic !== "STICK_DEFUSE") {
        bot.isDefusing = false;
        if (c4State.designatedDefuser === bot) {
            c4State.isBeingDefused = false;
            c4State.defuseProgress = 0;
        }
    }

    // =====================================================================
    // PRIORITY 3: INCOMING LIVE HE GRENADE EVASION
    // =====================================================================
    const nearbyHE = world.grenades.find(g =>
        g.type === "HEGRENADE" &&
        Math.hypot(g.x - bot.x, g.y - bot.y) < 250 &&
        getMapLineOfSight(bot.x, bot.y, g.x, g.y)
    );
    if (nearbyHE) {
        bot.isSilentWalking = false;
        bot.isCrouching = false;
        const evadeAngle = Math.atan2(bot.y - nearbyHE.y, bot.x - nearbyHE.x);
        bot.forwardProgressAngle = evadeAngle;
        moveBotWithSliding(bot, evadeAngle, 205, dt, false);
        updateBotHeadOrientation(bot, null, true, true, dt);
        return;
    }

    // =====================================================================
    // PRIORITY 4: DIRECT VISUAL GUNPLAY (APPROACHABILITY-FIRST SWITCHING)
    // =====================================================================
    const visualCandidates = [];
    if (priorityEnemy && !priorityEnemy.isDead) visualCandidates.push(priorityEnemy);
    if (closestEnemy && !closestEnemy.isDead && !visualCandidates.includes(closestEnemy)) {
        visualCandidates.push(closestEnemy);
    }
    if (bot.targetEnemy && !bot.targetEnemy.isDead && !visualCandidates.includes(bot.targetEnemy) &&
        getMapLineOfSight(bot.x, bot.y, bot.targetEnemy.x, bot.targetEnemy.y)) {
        visualCandidates.push(bot.targetEnemy);
    }

    let bestApproachableEnemy = null;
    let bestApproachScore = -Infinity;
    for (let i = 0; i < visualCandidates.length; i++) {
        const cand = visualCandidates[i];
        const s = getTargetApproachabilityScore(bot, cand);
        if (s > bestApproachScore) {
            bestApproachScore = s;
            bestApproachableEnemy = cand;
        }
    }

    if (bestApproachableEnemy) {
        bot.isPatrolling = false;
        bot.prefireTimer = 0;

        const prevLocked = (bot.targetEnemy && !bot.targetEnemy.isDead) ? bot.targetEnemy : null;
        const prevLockedScore = prevLocked ? getTargetApproachabilityScore(bot, prevLocked) : -Infinity;
        const prevLockedClear = prevLocked &&
            getMapLineOfSight(bot.x, bot.y, prevLocked.x, prevLocked.y) &&
            !isInsideSmoke(prevLocked.x, prevLocked.y, 12);

        if (prevLocked !== bestApproachableEnemy) {
            const clearlyMoreApproachable = bestApproachScore > prevLockedScore + 75;
            const immediateThreat = bot.lastHitBy === bestApproachableEnemy && (world.gameTime - bot.lastHitTime < 1.2);
            const shouldSwitch = !prevLocked || !prevLockedClear || bot.targetLockTimer <= 0 || clearlyMoreApproachable || immediateThreat;

            if (shouldSwitch) {
                const alreadyEngaged = prevLocked !== null && (bot.reactionTimer || 0) > 0;
                const isFastReactionArchetype = bot.archetype === "AWPER" || bot.archetype === "ENTRY";
                const switchHeadStart = isFastReactionArchetype ? 0.45 : 0.30; // 45% faster for AWPER/ENTRY, 30% for others
                bot.targetEnemy = bestApproachableEnemy;
                bot.targetLockTimer = 0.35;
                bot.reactionTimer = (immediateThreat || alreadyEngaged)
                    ? ((bot.humanReactionDelay || 0.1775) * switchHeadStart)
                    : 0;
            }
        }

        const activeTarget = (bot.targetEnemy && !bot.targetEnemy.isDead) ? bot.targetEnemy : bestApproachableEnemy;
        const activeTargetDist = Math.hypot(activeTarget.x - bot.x, activeTarget.y - bot.y);

        bot.combatCommitmentTimer = (bot.getEquippedKey() === "AWP") ? 0.90 : 0.45;
        bot.lastCombatTarget = activeTarget;
        bot.lastCombatTargetPos = { x: activeTarget.x, y: activeTarget.y };

        bot.lastSeenEnemy = activeTarget;
        bot.lastSeenEnemyPos = { x: activeTarget.x, y: activeTarget.y, time: world.gameTime };
        bot.lastHeardSound = { x: activeTarget.x, y: activeTarget.y, shooter: activeTarget, time: world.gameTime, type: "visual" };

        const aimPoint = getBotCombatAimPoint(bot, activeTarget, dt);

        if (bot.activeSlot === 3 || (bot.activeSlot === 6 && bot.executePhase !== "PLANT_LOCK")) {
            bot.selectSlot(bot.primaryKey ? 1 : (bot.secondaryKey ? 2 : 3));
        }

        const heldPowerPos = getBotPowerPosition(bot);
        const enemyInFunnel = heldPowerPos && isEnemyInControlledZone(heldPowerPos, activeTarget);
        const hasSightToFunnelEnemy = enemyInFunnel && getMapLineOfSight(bot.x, bot.y, activeTarget.x, activeTarget.y);

        if (heldPowerPos && hasSightToFunnelEnemy && !isBombImminent) {
            bot.isHoldingCrossfire = true;
            bot.isSilentWalking = true;
            const isAWPHold = bot.getEquippedKey() === "AWP";
            bot.isCrouching = !isAWPHold;
            if (isAWPHold) {
                bot.isScoped = true;
                bot.scopeLevel = 1;
            }
            bot.reactionTimer += dt;

            if (bot.reactionTimer < bot.humanReactionDelay) {
                brakeBot(bot, dt);
                return;
            }

            const aimAngle = Math.atan2(aimPoint.y - bot.y, aimPoint.x - bot.x);
            bot.angle = rotateTowardsDamped(bot.angle, aimAngle, 14.0, dt);

            const distToAnchor = Math.hypot(heldPowerPos.anchorX - bot.x, heldPowerPos.anchorY - bot.y);
            if (distToAnchor > 35) {
                steerBotToDestination(bot, heldPowerPos.anchorX, heldPowerPos.anchorY, 110, dt, { stopRadius: 12, autoAim: false });
            } else {
                brakeBot(bot, dt);
            }

            if ((bot.equipTimer || 0) <= 0 && Math.abs(normalizeAngle(aimAngle - bot.angle)) < 0.20 && bot.reactionTimer >= bot.humanReactionDelay) {
                performAttack(bot, aimPoint.x, aimPoint.y, false);
            }
            return;
        }

        // Immediately deploy Molotov, HE, Flash, or Smoke to zone out a spotted enemy AWPer/sniper
        const targetIsSniper = activeTarget.getEquippedKey?.() === "AWP" || activeTarget.getWeapon?.().category === "sniper";
        const hasAnyAntiAWPUtil = bot.hasSmoke || bot.hasFlash || bot.hasMolotov || bot.hasHE;
        if (targetIsSniper && hasAnyAntiAWPUtil && bot.getEquippedKey() !== "AWP" &&
            !isUnarmedC4Carrier && !isBombImminent && !isNearSpawn(bot.x, bot.y) &&
            !isInsideSmoke(bot.x, bot.y, 12) && activeTargetDist >= 260) {
            if (tryCounterAWPUtility(bot, activeTarget, true)) {
                brakeBot(bot, dt);
                updateBotHeadOrientation(bot, Math.atan2(activeTarget.y - bot.y, activeTarget.x - bot.x), false, true, dt);
                return;
            }
        }

        const isOpenAreaDisadvantage = bot.team === "T" && !c4State.isPlanted && bot.getEquippedKey() !== "AWP" &&
            activeTargetDist > 450 && isBotInOpenDisadvantage(bot, activeTarget.x, activeTarget.y);

        if (isOpenAreaDisadvantage && !isBombImminent) {
            const siteRect = bot.assignedSite === "B" ? MAP.siteB : MAP.siteA;
            const pushDest = siteRect ? siteRect.safeSpot : findTacticalCover(bot, activeTarget.x, activeTarget.y);

            if (bot.hasSmoke && activeTargetDist > 320 && !isNearSpawn(bot.x, bot.y)) {
                const screenX = (bot.x + activeTarget.x) * 0.5;
                const screenY = (bot.y + activeTarget.y) * 0.5;
                if (!isUtilityTargetClaimed("T", screenX, screenY, "SMOKE", 180)) {
                    const smokePlan = solveBotUtilityThrow(bot, "SMOKE", screenX, screenY, 120);
                    if (smokePlan) {
                        claimUtilityTarget("T", screenX, screenY, "SMOKE", 4.5);
                        executeBotGrenadeThrow(bot, 5, smokePlan.aimX, smokePlan.aimY, smokePlan.isExtended);
                    }
                }
            }

            if (bot.activeSlot === 3) {
                bot.selectSlot(bot.primaryKey ? 1 : (bot.secondaryKey ? 2 : 3));
            }
            bot.isSilentWalking = false;
            bot.isCrouching = false;
            bot.forwardProgressAngle = Math.atan2(pushDest.y - bot.y, pushDest.x - bot.x);
            steerBotToDestination(bot, pushDest.x, pushDest.y, 195, dt, { stopRadius: 14, autoAim: false });
            const aimAng = Math.atan2(aimPoint.y - bot.y, aimPoint.x - bot.x);
            updateBotHeadOrientation(bot, aimAng, true, true, dt);
            if ((bot.equipTimer || 0) <= 0 && Math.abs(normalizeAngle(aimAng - bot.angle)) < 0.24 && bot.reactionTimer >= bot.humanReactionDelay) {
                performAttack(bot, aimPoint.x, aimPoint.y, false);
            }
            return;
        }

        executeBotGunplay(bot, activeTarget, aimPoint, activeTargetDist, dt, isBombImminent);
        return;
    }

    if (bot.targetLockTimer <= 0) bot.targetEnemy = null;
    bot.reactionTimer = 0;

    // =====================================================================
    // PRIORITY 5: SMOKE BURST (LOWEST PRIORITY), RETALIATION & UTILITY
    // =====================================================================
    if (bot.smokePushCommitted && world.gameTime >= (bot.smokePushCommitUntil || 0)) {
        bot.smokePushCommitted = false;
        bot.smokeWatchTimer = 0;
    }

    const tTargetSiteKey = bot.assignedSite === "B" ? "B" : "A";
    const tTargetSiteRect = tTargetSiteKey === "B" ? MAP.siteB : MAP.siteA;
    const activeSuspicious = getRelevantSuspiciousSpot(bot);

    // Pre-plant T bots ignore smoke completely unless they were hit from that smoke's direction
    const hitFromSmokeDir = Boolean(
        blockingSmokeCloud &&
        bot.lastHitBy &&
        (world.gameTime - bot.lastHitTime < 2.2) &&
        (() => {
            const dmgPos = bot.lastDamageSourcePos || bot.lastHitBy;
            const angToDmg = Math.atan2(dmgPos.y - bot.y, dmgPos.x - bot.x);
            const angToSmoke = Math.atan2(blockingSmokeCloud.y - bot.y, blockingSmokeCloud.x - bot.x);
            return Math.abs(normalizeAngle(angToDmg - angToSmoke)) <= (55 * Math.PI / 180) ||
                isInsideSmoke(dmgPos.x, dmgPos.y, 24);
        })()
    );
    const ignoreSmokePrePlantT = bot.team === "T" && !c4State.isPlanted && !hitFromSmokeDir;

    const isTPrePlantFastTrack = bot.team === "T" && !c4State.isPlanted && (
        ignoreSmokePrePlantT ||
        bot.hasC4 ||
        !blockingSmokeCloud ||
        isTSquadOccupyingSite(tTargetSiteKey) ||
        isStrictlyInsideSite(bot.x, bot.y, tTargetSiteRect) ||
        isSectorRecentlyCleared("T", tTargetSiteRect.safeSpot.x, tTargetSiteRect.safeSpot.y, 185)
    );

    const forwardRefAxis = (bot.forwardProgressAngle !== undefined && bot.forwardProgressAngle !== null)
        ? bot.forwardProgressAngle
        : bot.angle;
    const smokeCueBehindApproach = Boolean(
        bot.isApproachingSite &&
        bot.lastHeardSound &&
        !(bot.lastHitBy && (world.gameTime - bot.lastHitTime < 1.5)) &&
        Math.abs(normalizeAngle(Math.atan2(bot.lastHeardSound.y - bot.y, bot.lastHeardSound.x - bot.x) - forwardRefAxis)) > (100 * Math.PI / 180)
    );

    // Smoke is strictly the lowest priority: any clear cue or suspicious spot overrides smoke checking
    const hasHigherPriorityCue = Boolean(
        activeSuspicious ||
        (bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 2.8) && !isInsideSmoke(bot.lastHeardSound.x, bot.lastHeardSound.y, 14)) ||
        world.squadHelpSignals.some(s => s.team === bot.team && s.victim !== bot && (world.gameTime - s.time < 3.0)) ||
        (bot.team === "CT" && Object.values(world.sharedEnemyIntelCT || {}).some(i => i && i.enemy && !i.enemy.isDead && !i.isSpotCleared && (world.gameTime - i.time < 3.0)))
    );

    const smokeSoundIsFresh = bot.lastHeardSound &&
        (world.gameTime - bot.lastHeardSound.time < 2.2) &&
        !isSectorRecentlyCleared(bot.team, bot.lastHeardSound.x, bot.lastHeardSound.y, 130);

    const hasActiveSmokeCue = !ignoreSmokePrePlantT &&
        !isTPrePlantFastTrack &&
        !smokeCueBehindApproach &&
        !hasHigherPriorityCue &&
        smokeEnemyTarget &&
        smokeSoundIsFresh &&
        (bot.lastHeardSound.type === "firing_trace" ||
            Math.hypot(bot.lastHeardSound.x - bot.x, bot.lastHeardSound.y - bot.y) < 190) &&
        getMapLineOfSight(bot.x, bot.y, bot.lastHeardSound.x, bot.lastHeardSound.y) &&
        (bot.smokeSpamCooldown || 0) <= 0 &&
        !bot.isSilentWalking;

    if (hasActiveSmokeCue) {
        bot.isPatrolling = false;
        bot.smokeReactionTimer = (bot.smokeReactionTimer || 0) + dt;
        const smokeProcessDelay = (bot.humanReactionDelay || 0.1775) + 0.10;
        if (bot.smokeReactionTimer < smokeProcessDelay) {
            return;
        }

        const baseThreatX = bot.lastHeardSound.x;
        const baseThreatY = bot.lastHeardSound.y;
        const cueType = smokeCueType || bot.lastHeardSound.type;
        const isAWP = bot.getEquippedKey() === "AWP";

        if (!bot.smokeSprayAnchor || world.gameTime >= (bot.smokeSprayAnchor.expiresAt || 0)) {
            const jitterRadius = isAWP
                ? ((cueType === "firing_trace") ? 18 : 34)
                : ((cueType === "firing_trace") ? 75 : 110);
            const randAng = rnd() * Math.PI * 2;
            const randDist = (0.2 + rnd() * 0.8) * jitterRadius;
            bot.smokeSprayAnchor = {
                x: baseThreatX + Math.cos(randAng) * randDist,
                y: baseThreatY + Math.sin(randAng) * randDist,
                expiresAt: world.gameTime + 0.65
            };
        }

        const baseAngle = Math.atan2(bot.smokeSprayAnchor.y - bot.y, bot.smokeSprayAnchor.x - bot.x);
        const sweepOffset = isAWP ? 0 : Math.sin(world.gameTime * 5.0 + bot.weaveSeed) * 0.18;
        const sprayAngle = normalizeAngle(baseAngle + sweepOffset);
        const threatDist = Math.hypot(bot.smokeSprayAnchor.x - bot.x, bot.smokeSprayAnchor.y - bot.y);
        const sprayTargetX = bot.x + Math.cos(sprayAngle) * threatDist;
        const sprayTargetY = bot.y + Math.sin(sprayAngle) * threatDist;

        bot.angle = rotateTowardsDamped(bot.angle, sprayAngle, isAWP ? 13.0 : 10.5, dt);
        const alignedDiff = Math.abs(normalizeAngle(sprayAngle - bot.angle));
        const wep = bot.getWeapon();
        const currentClip = bot.getCurrentClip();

        if (isAWP) {
            if (cueType === "firing_trace" && currentClip > 0) {
                bot.isScoped = true;
                bot.scopeLevel = 1;
                brakeBot(bot, dt);
                if (alignedDiff < 0.08 && Math.hypot(bot.vx || 0, bot.vy || 0) < 35) {
                    performAttack(bot, sprayTargetX, sprayTargetY, false);
                    bot.smokeSpamCooldown = 2.5;
                }
                return;
            }
        } else if (wep.category !== "knife" && wep.category !== "grenade" && wep.category !== "c4" && currentClip > 6) {
            bot.smokeBurstTimer = (bot.smokeBurstTimer || 0) + dt;
            bot.smokeBurstCount = bot.smokeBurstCount || 0;

            if (bot.smokeBurstCount < 4 && bot.smokeBurstTimer <= 0.55) {
                // Keep strafing to an off-angle while firing rather than standing still in the open
                const strafeAng = sprayAngle + ((bot.counterStrafeDir || 1) * (Math.PI / 2));
                moveBotWithSliding(bot, strafeAng, 155, dt, false);
                bot.isCrouching = false;
                if (alignedDiff < 0.24) {
                    const clipBefore = bot.getCurrentClip();
                    bot.isPrefiringProbe = true;
                    performAttack(bot, sprayTargetX, sprayTargetY, false);
                    bot.isPrefiringProbe = false;
                    if (bot.getCurrentClip() < clipBefore) bot.smokeBurstCount++;
                }
                return;
            } else {
                bot.smokeBurstCount = 0;
                bot.smokeBurstTimer = 0;
                bot.smokeSpamCooldown = 3.5;
            }
        }
    } else {
        bot.smokeReactionTimer = 0;
        bot.smokeBurstCount = 0;
        bot.smokeBurstTimer = 0;
    }

    const myLivingSquad = bot.team === "CT" ? world.livingCT : world.livingT;
    const enemyLivingSquad = bot.team === "CT" ? world.livingT : world.livingCT;
    const hasManAdvantage = myLivingSquad.length > enemyLivingSquad.length;
    const blockingSmokeCluster = blockingSmokeCloud ? getConnectedSmokeCluster(blockingSmokeCloud) : null;

    const tContestingActiveDefuse = bot.team === "T" && c4State.isPlanted && c4State.isBeingDefused;
    const isOwnThrownSmoke = blockingSmokeCluster && blockingSmokeCluster.owner === bot;
    const isFriendlySmoke = blockingSmokeCluster && blockingSmokeCluster.owner && blockingSmokeCluster.owner.team === bot.team;
    const isSmokeAreaCleared = blockingSmokeCluster &&
        isSectorRecentlyCleared(bot.team, blockingSmokeCluster.x, blockingSmokeCluster.y, 160);
    const hasFreshSmokeEnemyCue = Boolean(smokeEnemyTarget && smokeSoundIsFresh);
    const isFriendlyOrClearedSmoke = Boolean(
        blockingSmokeCluster && (
            isOwnThrownSmoke ||
            isSmokeAreaCleared ||
            (isFriendlySmoke && !hasFreshSmokeEnemyCue)
        )
    );

    bot.activeBlockingSmoke = (blockingSmokeCluster && !isFriendlyOrClearedSmoke && !tContestingActiveDefuse)
        ? blockingSmokeCluster
        : null;

    if (bot.lastHitBy && !bot.lastHitBy.isDead && (world.gameTime - bot.lastHitTime < 1.2)) {
        const timeSinceHit = world.gameTime - bot.lastHitTime;
        const threatX = bot.lastDamageSourcePos ? bot.lastDamageSourcePos.x : bot.lastHitBy.x;
        const threatY = bot.lastDamageSourcePos ? bot.lastDamageSourcePos.y : bot.lastHitBy.y;
        const threatAngle = Math.atan2(threatY - bot.y, threatX - bot.x);

        bot.lastSeenEnemy = bot.lastHitBy;
        bot.lastSeenEnemyPos = { x: threatX, y: threatY, time: world.gameTime };

        let strafeDir = bot.counterStrafeDir || 1;
        let strafeAngle = threatAngle + (strafeDir * Math.PI / 2);
        const testSX = bot.x + Math.cos(strafeAngle) * 34;
        const testSY = bot.y + Math.sin(strafeAngle) * 34;
        if (!hasBodyClearance(bot.x, bot.y, testSX, testSY, bot.radius + 5)) {
            strafeDir = -strafeDir;
            bot.counterStrafeDir = strafeDir;
            strafeAngle = threatAngle + (strafeDir * Math.PI / 2);
        }
        const safeSX = bot.x + Math.cos(strafeAngle) * 34;
        const safeSY = bot.y + Math.sin(strafeAngle) * 34;
        if (hasBodyClearance(bot.x, bot.y, safeSX, safeSY, bot.radius + 5)) {
            moveBotWithSliding(bot, strafeAngle, 165, dt, false);
        } else {
            const coverPt = findTacticalCover(bot, threatX, threatY);
            steerBotToDestination(bot, coverPt.x, coverPt.y, 185, dt, { stopRadius: 12, autoAim: false });
        }

        if (timeSinceHit >= 0.16 && !isUnarmedC4Carrier) {
            bot.isPatrolling = false;
            bot.angle = rotateTowardsDamped(bot.angle, threatAngle, 14.5, dt, 11.5);
            const alignedDiff = Math.abs(normalizeAngle(threatAngle - bot.angle));
            const wep = bot.getWeapon();
            const canWallbang = canBulletPenetrateTo(bot.x, bot.y, threatX, threatY, wep.piercingPower);
            const hasDirectSight = getMapLineOfSight(bot.x, bot.y, threatX, threatY);

            if ((bot.equipTimer || 0) <= 0 && wep.category !== "sniper" && wep.category !== "knife" && wep.category !== "grenade" && bot.getCurrentClip() > 0) {
                if (alignedDiff < 0.26 && (hasDirectSight || canWallbang)) {
                    performAttack(bot, threatX, threatY, false);
                }
            }
        }
        return;
    }

    const nearbyShotInterrupt = bot.lastHeardSound &&
        (world.gameTime - bot.lastHeardSound.time < 1.2) &&
        (bot.lastHeardSound.type === "firing_trace" || bot.lastHeardSound.type === "visual") &&
        Math.hypot(bot.lastHeardSound.x - bot.x, bot.lastHeardSound.y - bot.y) <= 460;

    if (nearbyShotInterrupt && bot.lastCombatTargetPos) {
        const oldHoldAng = Math.atan2(bot.lastCombatTargetPos.y - bot.y, bot.lastCombatTargetPos.x - bot.x);
        const newShotAng = Math.atan2(bot.lastHeardSound.y - bot.y, bot.lastHeardSound.x - bot.x);
        const oldHoldObscured = isInsideSmoke(bot.lastCombatTargetPos.x, bot.lastCombatTargetPos.y, 12);
        const newShotExposed = !isInsideSmoke(bot.lastHeardSound.x, bot.lastHeardSound.y, 12);
        if (Math.abs(normalizeAngle(newShotAng - oldHoldAng)) > 0.55 || (oldHoldObscured && newShotExposed)) {
            bot.combatCommitmentTimer = 0;
            bot.lastCombatTarget = null;
        }
    }

    const fastExecuteMode = bot.team === "T" && isTFastExecuteActive(tTargetSiteKey);
    if (fastExecuteMode) {
        bot.combatCommitmentTimer = 0;
        bot.utilityCoverRetreat = null;
    }

    if (bot.combatCommitmentTimer > 0 && bot.lastCombatTarget && !bot.lastCombatTarget.isDead && !isUnarmedC4Carrier && !fastExecuteMode) {
        bot.isPatrolling = false;
        const holdPos = bot.lastCombatTargetPos || { x: bot.lastCombatTarget.x, y: bot.lastCombatTarget.y };
        const holdAngle = Math.atan2(holdPos.y - bot.y, holdPos.x - bot.x);
        bot.angle = rotateTowardsDamped(bot.angle, holdAngle, 12.0, dt);

        // Pre-plant T riflers keep advancing toward site while holding crosshair on the angle instead of freezing in the open
        if (bot.team === "T" && !c4State.isPlanted && bot.getEquippedKey() !== "AWP") {
            const siteAdvance = tTargetSiteRect ? tTargetSiteRect.safeSpot : holdPos;
            steerBotToDestination(bot, siteAdvance.x, siteAdvance.y, 175, dt, { stopRadius: 16, autoAim: false });
            tryExecuteTacticalUtility(bot, dt, bot.lastCombatTarget);
            return;
        }

        brakeBot(bot, dt);

        if (bot.getEquippedKey() === "AWP") {
            const clearScope = hasAWPScopeLineClearance(bot, holdAngle);
            bot.isScoped = clearScope;
            if (clearScope) bot.scopeLevel = 1;
            if (bot.combatCommitmentTimer <= 0.35) {
                tryExecuteTacticalUtility(bot, dt, bot.lastCombatTarget);
            }
        } else {
            tryExecuteTacticalUtility(bot, dt, bot.lastCombatTarget);
        }
        return;
    }

    const hasFreshSound = bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 3.5);
    const hasCTIntel = bot.team === "CT" && (
        world.squadHelpSignals.some(s => s.team === "CT" && (world.gameTime - s.time < 4.0) && (!s.targetEnemy || !s.targetEnemy.isDead)) ||
        Object.values(world.sharedEnemyIntelCT).some(intel => intel && !intel.enemy.isDead && !intel.isSpotCleared && (world.gameTime - intel.time < 4.0))
    );
    const hasDueAWPDangerSmoke = Boolean(
        bot.hasSmoke &&
        !c4State.isPlanted &&
        (world.awpDangerMemory?.[bot.team] || []).some(d =>
            !d.smokedThisRound &&
            (d.roundRoll ?? 0) < (d.smokeChance ?? 0) &&
            roundElapsed >= Math.max(2.0, d.roundElapsed - 4.0) &&
            roundElapsed <= d.roundElapsed + 10.0 &&
            Math.hypot(d.smokeX - bot.x, d.smokeY - bot.y) <= 950
        )
    );
    const canUseProactiveUtility = !allTerroristsDead && !isNearSpawn(bot.x, bot.y) && !isTClockUnder20s && (
        c4State.isPlanted ||
        hasFreshSound ||
        hasCTIntel ||
        hasDueAWPDangerSmoke ||
        (bot.team === "CT" ? roundElapsed >= 11.0 : roundElapsed >= 4.5)
    );

    if (canUseProactiveUtility && tryExecuteTacticalUtility(bot, dt, null)) {
        brakeBot(bot, dt);
        return;
    }
    tryTacticalReload(bot);

    // =====================================================================
    // PRIORITY 6: MACRO-OBJECTIVE & NAVIGATION BRAIN
    // =====================================================================
    let destinationPos = null;
    let desiredLookAngle = null;
    let wantsToHoldPosition = false;
    let goalPriority = 0;
    bot.isADPeeking = false;
    bot.isWallHuggingHold = false;

    // Cover-First Utility Step: tuck behind nearby wall cover before pulling a grenade pin in direct LOS
    if (bot.utilityCoverRetreat && world.gameTime < bot.utilityCoverRetreat.expiresAt && !isUnarmedC4Carrier) {
        const ret = bot.utilityCoverRetreat;
        if (Math.hypot(ret.x - bot.x, ret.y - bot.y) > 18) {
            goalPriority = 86;
            bot.isPatrolling = false;
            bot.isFollowingPlanRoute = false;
            destinationPos = { x: ret.x, y: ret.y };
            desiredLookAngle = Math.atan2(ret.threatY - bot.y, ret.threatX - bot.x);
        } else {
            bot.utilityCoverRetreat = null;
        }
    } else {
        bot.utilityCoverRetreat = null;
    }

    // 6A. Planted C4 Retake / Post-Plant Defense (Priority 100)
    if (c4State.isPlanted) {
        goalPriority = 100;
        bot.isFollowingPlanRoute = false;

        if (bot.team === "CT") {
            const lane = bot.retakeAssignment;
            const retakeSiteRect = c4State.plantSite === "B" ? MAP.siteB : MAP.siteA;
            const isOutsideRetakeSite = retakeSiteRect && !isInsideExpandedSite(bot.x, bot.y, retakeSiteRect);
            const approachingEntryPortal = Boolean(
                isOutsideRetakeSite &&
                lane?.entryPos &&
                Math.hypot(lane.entryPos.x - bot.x, lane.entryPos.y - bot.y) > 95
            );

            const minRetakeClock = ctPincerState.minRequiredClock || 14.0;
            const canStageRetake = !allTerroristsDead &&
                !ctPincerState.breachInitiated &&
                lane?.stagePos &&
                c4State.timer > minRetakeClock &&
                world.livingCT.length >= 2 &&
                ctTactic !== "SAVE_GEAR" &&
                ctTactic !== "STICK_DEFUSE";

            if (canStageRetake) {
                const stageAnchor = snapToWalkablePos(lane.stagePos.x, lane.stagePos.y, bot.radius);
                const distToStage = Math.hypot(stageAnchor.x - bot.x, stageAnchor.y - bot.y);
                bot.isPatrolling = false;
                bot.isCrouching = false;
                destinationPos = stageAnchor;
                desiredLookAngle = Math.atan2(lane.watchPos.y - bot.y, lane.watchPos.x - bot.x);
                if (distToStage <= 32) wantsToHoldPosition = true;
            }

            if (destinationPos) {
                // Holding or advancing to synchronized retake staging point
            } else if (ctTactic === "SAVE_GEAR") {
                bot.isPatrolling = false;
                bot.isCrouching = false;
                const awayAngle = Math.atan2(bot.y - c4State.plantY, bot.x - c4State.plantX);
                destinationPos = navCellToWorld(worldToNavCell(
                    Math.max(80, Math.min(MAP.width - 80, c4State.plantX + Math.cos(awayAngle) * 1100)),
                    Math.max(80, Math.min(MAP.height - 80, c4State.plantY + Math.sin(awayAngle) * 1100))
                ));
                desiredLookAngle = getActiveGazeHoldAngle(bot) ?? awayAngle;
            } else if (ctTactic === "FIGHT_FIRST") {
                bot.isPatrolling = false;
                const activeIntel = Object.values(world.sharedEnemyIntelCT || {}).find(
                    i => i && i.enemy && !i.enemy.isDead && !i.isSpotCleared && (world.gameTime - i.time < 3.5)
                );
                const clearTarget = (bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 2.6))
                    ? { x: bot.lastHeardSound.x, y: bot.lastHeardSound.y }
                    : (activeIntel
                        ? { x: activeIntel.x, y: activeIntel.y }
                        : (lane ? lane.entryPos : { x: c4State.plantX, y: c4State.plantY }));
                destinationPos = clearTarget;
                desiredLookAngle = Math.atan2(clearTarget.y - bot.y, clearTarget.x - bot.x);
            } else if (ctTactic === "CLEAR_SITE") {
                bot.isPatrolling = false;
                const pocket = getNextUnclearedSitePocket(c4State.plantSite || "A");
                if (pocket) {
                    destinationPos = snapToWalkablePos(pocket.x, pocket.y, bot.radius);
                    desiredLookAngle = Math.atan2(pocket.y - bot.y, pocket.x - bot.x);
                } else {
                    destinationPos = { x: c4State.plantX, y: c4State.plantY };
                    desiredLookAngle = getOutwardDefuseWatchAngle(bot);
                }
            } else if (ctTactic === "SMOKE_BOMB") {
                bot.isPatrolling = false;
                if (distToPlantedC4 <= 680 && !isUtilityTargetClaimed("CT", c4State.plantX, c4State.plantY, "SMOKE", 180)) {
                    const throwPlan = solveBotUtilityThrow(bot, "SMOKE", c4State.plantX, c4State.plantY, 85);
                    if (throwPlan) {
                        claimUtilityTarget("CT", c4State.plantX, c4State.plantY, "SMOKE", 4.5);
                        executeBotGrenadeThrow(bot, 5, throwPlan.aimX, throwPlan.aimY, throwPlan.isExtended);
                    }
                }
                destinationPos = { x: c4State.plantX, y: c4State.plantY };
                desiredLookAngle = getOutwardDefuseWatchAngle(bot);
            } else if (ctTactic === "FAKE_DEFUSE") {
                bot.isPatrolling = false;
                if (distToPlantedC4 > 34) {
                    destinationPos = { x: c4State.plantX, y: c4State.plantY };
                    desiredLookAngle = getOutwardDefuseWatchAngle(bot);
                } else {
                    brakeBot(bot, dt);
                    bot.isCrouching = true;
                    if (!bot.fakeDefuseStartTime) {
                        bot.fakeDefuseStartTime = world.gameTime;
                        audio.playDefuseClick(c4State.plantX, c4State.plantY);
                    }
                    bot.isDefusing = true;
                    c4State.designatedDefuser = bot;
                    c4State.isBeingDefused = true;
                    c4State.lastDefuseSoundTime = world.gameTime;

                    const watchAng = getOutwardDefuseWatchAngle(bot);
                    bot.angle = rotateTowardsDamped(bot.angle, watchAng, 13.5, dt);

                    if (world.gameTime - bot.fakeDefuseStartTime >= 0.45) {
                        bot.isDefusing = false;
                        c4State.isBeingDefused = false;
                        c4State.defuseProgress = 0;
                        bot.fakeDefusesRemaining = Math.max(0, (bot.fakeDefusesRemaining || 1) - 1);
                        bot.startedFakeSequence = bot.fakeDefusesRemaining > 0;
                        bot.fakeDefuseStartTime = 0;
                        bot.fakeDefuseBaitUntil = world.gameTime + (1.3 + rnd() * 0.7);
                    }
                    return;
                }
            } else if (ctTactic === "HOLD_FAKE_BAIT") {
                bot.isPatrolling = false;
                bot.isCrouching = false;
                const watchAng = getOutwardDefuseWatchAngle(bot);
                const threatX = bot.x + Math.cos(watchAng) * 300;
                const threatY = bot.y + Math.sin(watchAng) * 300;
                const baitCover = findTacticalCover(bot, threatX, threatY);
                const nearBombCover = Math.hypot(baitCover.x - c4State.plantX, baitCover.y - c4State.plantY) <= 135
                    ? baitCover
                    : { x: c4State.plantX, y: c4State.plantY };

                destinationPos = nearBombCover;
                desiredLookAngle = watchAng;
                if (Math.hypot(nearBombCover.x - bot.x, nearBombCover.y - bot.y) <= 20) {
                    wantsToHoldPosition = true;
                }
            } else if (ctTactic === "DEFUSE_BOMB") {
                bot.isPatrolling = false;
                if (distToPlantedC4 > 34) {
                    bot.isDefusing = false;
                    bot.isSilentWalking = false;
                    bot.isCrouching = false;
                    const isSoloCT = world.livingCT.length === 1;
                    const useDirectSprint = allTerroristsDead || isSoloCT || !approachingEntryPortal;
                    destinationPos = useDirectSprint
                        ? { x: c4State.plantX, y: c4State.plantY }
                        : { x: lane.entryPos.x, y: lane.entryPos.y };
                    desiredLookAngle = getActiveGazeHoldAngle(bot) ??
                        (lane?.watchPos ? Math.atan2(lane.watchPos.y - bot.y, lane.watchPos.x - bot.x) : getOutwardDefuseWatchAngle(bot));
                } else {
                    brakeBot(bot, dt);
                    bot.isCrouching = true;
                    if (!bot.isDefusing) audio.playDefuseClick(c4State.plantX, c4State.plantY);
                    bot.isDefusing = true;
                    c4State.designatedDefuser = bot;
                    c4State.isBeingDefused = true;
                    c4State.lastDefuseSoundTime = world.gameTime;

                    const watchOutwardAngle = getOutwardDefuseWatchAngle(bot);
                    bot.angle = rotateTowardsDamped(bot.angle, watchOutwardAngle, 13.5, dt);

                    const defuseTime = bot.hasDefuseKit ? 5.0 : 10.0;
                    c4State.defuseProgress += dt / defuseTime;
                    if (c4State.defuseProgress >= 1.0) triggerC4Defused();
                    return;
                }
            } else {
                // COVER_CHOKE: Enter via assigned pinch portal first, then contest site angles & hunt T positions
                bot.isDefusing = false;
                bot.isCrouching = false;

                const activeSiteIntel = Object.values(world.sharedEnemyIntelCT || {}).find(
                    i => i && i.enemy && !i.enemy.isDead && !i.isSpotCleared && (world.gameTime - i.time < 4.5)
                );
                const freshSound = bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 3.2);

                if (approachingEntryPortal) {
                    bot.isPatrolling = false;
                    destinationPos = { x: lane.entryPos.x, y: lane.entryPos.y };
                    desiredLookAngle = Math.atan2(lane.watchPos.y - bot.y, lane.watchPos.x - bot.x);
                } else if (activeSiteIntel) {
                    const ix = activeSiteIntel.x !== undefined ? activeSiteIntel.x : activeSiteIntel.enemy.x;
                    const iy = activeSiteIntel.y !== undefined ? activeSiteIntel.y : activeSiteIntel.enemy.y;
                    bot.isPatrolling = false;
                    destinationPos = findMultiAngleSupportPosition(bot, ix, iy, activeSiteIntel.spotter || bot);
                    desiredLookAngle = Math.hypot(ix - bot.x, iy - bot.y) < 550
                        ? Math.atan2(iy - bot.y, ix - bot.x)
                        : null;
                } else if (freshSound) {
                    bot.isPatrolling = false;
                    const soundPt = { x: bot.lastHeardSound.x, y: bot.lastHeardSound.y };
                    destinationPos = findMultiAngleSupportPosition(bot, soundPt.x, soundPt.y, bot);
                    desiredLookAngle = Math.atan2(soundPt.y - bot.y, soundPt.x - bot.x);
                } else {
                    const postPlantAWP = world.livingCT.length >= 2
                        ? getDeducedAWPTarget("CT", c4State.plantX, c4State.plantY, 850)
                        : null;
                    if (postPlantAWP) {
                        bot.isPatrolling = false;
                        const pinchSide = (bot.id % 2 === 0) ? 1 : -1;
                        destinationPos = findMultiAngleSupportPosition(
                            bot,
                            postPlantAWP.x,
                            postPlantAWP.y,
                            c4State.designatedDefuser || bot,
                            pinchSide
                        );
                        desiredLookAngle = Math.atan2(postPlantAWP.y - bot.y, postPlantAWP.x - bot.x);
                    }

                    if (!destinationPos) {
                        const siteZoneKey = c4State.plantSite === "B" ? "B" : "A";
                        const chokeControl = updateAreaControlZone(bot, siteZoneKey, dt);
                        if (chokeControl) {
                            destinationPos = chokeControl.dest;
                            desiredLookAngle = chokeControl.lookAngle;
                            wantsToHoldPosition = chokeControl.hold;
                            bot.isHoldingCrossfire = chokeControl.hold;
                            bot.isPatrolling = false;
                            if (bot.getEquippedKey() === "AWP" && chokeControl.hold && hasAWPScopeLineClearance(bot, chokeControl.lookAngle)) {
                                bot.isScoped = true;
                                bot.scopeLevel = 1;
                            }
                        }
                    }
                }
            }
        } else if (bot.team === "T") {
            const canSeeBombGeometry = getMapLineOfSight(bot.x, bot.y, c4State.plantX, c4State.plantY);
            const wep = bot.getWeapon();
            const hasShootingWeapon = wep.category !== "knife" && wep.category !== "grenade" && wep.category !== "c4";
            const heardDefuseRecently = c4State.isBeingDefused || (world.gameTime - (c4State.lastDefuseSoundTime || -99) < 0.95);

            const bombAngleFromBot = Math.atan2(c4State.plantY - bot.y, c4State.plantX - bot.x);
            const hasFlankSound = bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 2.2) &&
                Math.hypot(bot.lastHeardSound.x - c4State.plantX, bot.lastHeardSound.y - c4State.plantY) > 170 &&
                (Math.hypot(bot.lastHeardSound.x - bot.x, bot.lastHeardSound.y - bot.y) < 520 ||
                    Math.abs(normalizeAngle(Math.atan2(bot.lastHeardSound.y - bot.y, bot.lastHeardSound.x - bot.x) - bombAngleFromBot)) > 0.65);

            const hasFlankSquadCall = world.squadHelpSignals.some(s =>
                s.team === "T" && s.victim !== bot && (world.gameTime - s.time < 3.0) &&
                Math.hypot(s.enemyPos.x - c4State.plantX, s.enemyPos.y - c4State.plantY) > 170
            );

            const rankedTs = world.livingT.slice().sort((a, b) => {
                const scoreA = Math.hypot(c4State.plantX - a.x, c4State.plantY - a.y)
                    - (getMapLineOfSight(a.x, a.y, c4State.plantX, c4State.plantY) ? 450 : 0)
                    - ((a.hasMolotov || a.hasHE) ? 160 : 0);
                const scoreB = Math.hypot(c4State.plantX - b.x, c4State.plantY - b.y)
                    - (getMapLineOfSight(b.x, b.y, c4State.plantX, c4State.plantY) ? 450 : 0)
                    - ((b.hasMolotov || b.hasHE) ? 160 : 0);
                return scoreA - scoreB;
            });
            const contestRank = rankedTs.indexOf(bot);
            const maxContesters = (c4State.timer <= 11.0 && !hasFlankSound && !hasFlankSquadCall) ? 2 : 1;

            const shouldContestBomb = heardDefuseRecently && distToPlantedC4 <= 1050 &&
                contestRank !== -1 && contestRank < maxContesters &&
                !(hasFlankSound && Math.hypot(bot.lastHeardSound.x - bot.x, bot.lastHeardSound.y - bot.y) < 340);

            if (shouldContestBomb) {
                bot.isPatrolling = false;
                bot.isSilentWalking = false;

                if (bot.activeSlot === 3 || wep.category === "grenade" || wep.category === "c4") {
                    bot.selectSlot(bot.primaryKey ? 1 : (bot.secondaryKey ? 2 : 3));
                }

                if (tryPostPlantDenial(bot)) return;

                bot.defuseReactionTimer = (bot.defuseReactionTimer || 0) + dt;
                const defuseReactDelay = (bot.humanReactionDelay || 0.1775) + 0.08;
                if (bot.defuseReactionTimer < defuseReactDelay) {
                    brakeBot(bot, dt);
                    bot.angle = rotateTowardsDamped(bot.angle, bombAngleFromBot, 10.0, dt);
                    return;
                }

                if (bot.getCurrentClip() <= 0) {
                    startReload(bot);
                    const coverPt = findTacticalCover(bot, c4State.plantX, c4State.plantY);
                    steerBotToDestination(bot, coverPt.x, coverPt.y, 190, dt, { stopRadius: 14, autoAim: false });
                    return;
                }

                const bombIsSmoked = isInsideSmoke(c4State.plantX, c4State.plantY, 20);
                const isCriticalTimer = c4State.timer <= 8.5;

                if (bombIsSmoked && canSeeBombGeometry && distToPlantedC4 <= 720 && hasShootingWeapon) {
                    if (bot.getEquippedKey() === "AWP") {
                        brakeBot(bot, dt);
                        bot.isScoped = true;
                        bot.scopeLevel = 1;
                        const aimX = c4State.plantX + (rnd() - 0.5) * 16;
                        const aimY = c4State.plantY + (rnd() - 0.5) * 16;
                        const aimAng = Math.atan2(aimY - bot.y, aimX - bot.x);
                        bot.angle = rotateTowardsDamped(bot.angle, aimAng, 14.0, dt);

                        if (bot.defuseSprayCooldown > 0) {
                            bot.defuseSprayCooldown = Math.max(0, bot.defuseSprayCooldown - dt);
                        } else if (Math.abs(normalizeAngle(aimAng - bot.angle)) < 0.08 && Math.hypot(bot.vx || 0, bot.vy || 0) < 35) {
                            const clipBefore = bot.getCurrentClip();
                            performAttack(bot, aimX, aimY, false);
                            if (bot.getCurrentClip() < clipBefore) bot.defuseSprayCooldown = 2.0;
                        }
                        return;
                    }

                    const moveWhileContestingSmoke = () => {
                        bot.isCrouching = false;
                        bot.smokeStrafeTimer = (bot.smokeStrafeTimer || 0) + dt;
                        const checkSideAngle = bombAngleFromBot + ((bot.counterStrafeDir || 1) * (Math.PI * 0.45));

                        if (bot.smokeStrafeTimer >= 0.55 ||
                            checkWallCollision(bot.x + Math.cos(checkSideAngle) * 32, bot.y + Math.sin(checkSideAngle) * 32, bot.radius)) {
                            bot.counterStrafeDir = -(bot.counterStrafeDir || 1);
                            bot.smokeStrafeTimer = 0;
                        }

                        const strafeOffset = (distToPlantedC4 > 125 ? Math.PI * 0.34 : Math.PI * 0.48) * (bot.counterStrafeDir || 1);
                        moveBotWithSliding(bot, bombAngleFromBot + strafeOffset, 168, dt, false);
                    };

                    if (bot.defuseSprayCooldown > 0) {
                        bot.defuseSprayCooldown = Math.max(0, bot.defuseSprayCooldown - dt);
                        bot.defuseSprayShots = 0;
                        moveWhileContestingSmoke();
                        bot.angle = rotateTowardsDamped(bot.angle, bombAngleFromBot, 12.0, dt);
                        return;
                    }

                    moveWhileContestingSmoke();
                    const sweepAng = world.gameTime * 5.5 + bot.weaveSeed;
                    const sprayAimX = c4State.plantX + Math.cos(sweepAng) * 48 * 0.65 + (rnd() - 0.5) * 22;
                    const sprayAimY = c4State.plantY + Math.sin(sweepAng) * 48 * 0.65 + (rnd() - 0.5) * 22;
                    const sprayAngle = Math.atan2(sprayAimY - bot.y, sprayAimX - bot.x);
                    bot.angle = rotateTowardsDamped(bot.angle, sprayAngle, 14.0, dt);

                    if (Math.abs(normalizeAngle(sprayAngle - bot.angle)) < 0.26) {
                        const clipBefore = bot.getCurrentClip();
                        performAttack(bot, sprayAimX, sprayAimY, false);
                        if (bot.getCurrentClip() < clipBefore) {
                            bot.defuseSprayShots = (bot.defuseSprayShots || 0) + 1;
                            if (!isCriticalTimer && bot.defuseSprayShots >= 5) {
                                bot.defuseSprayCooldown = 0.75;
                            }
                        }
                    }
                    return;
                }

                bot.isCrouching = false;
                destinationPos = { x: c4State.plantX, y: c4State.plantY };
                desiredLookAngle = bombAngleFromBot;
            } else {
                bot.defuseReactionTimer = 0;
                bot.defuseSprayShots = 0;
                const siteKey = c4State.plantSite === "B" ? "B" : "A";
                const tDeathZones = world.tacticalIntel?.deathZones?.T || [];

                // Prioritize actual enemy coordinates (shared intel -> attacker position -> non-corpse sound)
                let knownEnemyPos = null;
                let allyNearThreat = null;

                const freshTIntel = Object.values(world.sharedEnemyIntelT || {})
                    .filter(i => i && i.enemy && !i.enemy.isDead && !i.isSpotCleared && (world.gameTime - i.time < 4.5))
                    .sort((a, b) => Math.hypot(a.x - bot.x, a.y - bot.y) - Math.hypot(b.x - bot.x, b.y - bot.y))[0];

                const activeFlankSignal = world.squadHelpSignals.find(s =>
                    s.team === "T" && s.victim !== bot && (world.gameTime - s.time < 4.0) &&
                    (!s.targetEnemy || !s.targetEnemy.isDead)
                );

                const hasRecentSound = bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 3.2);
                const isFootstepOrRipple = bot.lastHeardSound?.type === "footstep" || bot.lastHeardSound?.type === "ripple";
                const soundIsOnDeadTeammate = hasRecentSound &&
                    isFootstepOrRipple &&
                    tDeathZones.some(dz => !dz.cleared && world.gameTime < dz.expiresAt &&
                        Math.hypot(dz.x - bot.lastHeardSound.x, dz.y - bot.lastHeardSound.y) < 110);

                if (freshTIntel && Math.hypot(freshTIntel.x - c4State.plantX, freshTIntel.y - c4State.plantY) <= 950) {
                    knownEnemyPos = { x: freshTIntel.x, y: freshTIntel.y };
                    if (freshTIntel.spotter && !freshTIntel.spotter.isDead) allyNearThreat = freshTIntel.spotter;
                } else if (activeFlankSignal) {
                    const callPos = activeFlankSignal.approxPos || activeFlankSignal.enemyPos;
                    if (Math.hypot(callPos.x - c4State.plantX, callPos.y - c4State.plantY) <= 950) {
                        knownEnemyPos = { x: callPos.x, y: callPos.y };
                        if (activeFlankSignal.victim && !activeFlankSignal.victim.isDead) allyNearThreat = activeFlankSignal.victim;
                    }
                } else if ((hasRecentSound || hasFlankSound) && !soundIsOnDeadTeammate &&
                    Math.hypot(bot.lastHeardSound.x - c4State.plantX, bot.lastHeardSound.y - c4State.plantY) <= 820) {
                    knownEnemyPos = { x: bot.lastHeardSound.x, y: bot.lastHeardSound.y };
                }

                if (knownEnemyPos) {
                    const threatAngle = Math.atan2(knownEnemyPos.y - bot.y, knownEnemyPos.x - bot.x);
                    const enemyInSmoke = isInsideSmoke(knownEnemyPos.x, knownEnemyPos.y, 14);
                    bot.isPatrolling = false;

                    // Find a safe crossfire/off-angle around the site with direct LOS to kill the enemy, without walking onto a dead teammate
                    let killAnglePos = null;
                    if (!enemyInSmoke && !isBeyondOverchaseTether(bot, knownEnemyPos)) {
                        const crossfire = findCrossfireSupportAngle(bot, knownEnemyPos, allyNearThreat);
                        const supportCand = crossfire || findMultiAngleSupportPosition(bot, knownEnemyPos.x, knownEnemyPos.y, allyNearThreat || bot);
                        if (supportCand && Math.hypot(supportCand.x - c4State.plantX, supportCand.y - c4State.plantY) <= 620) {
                            const nearDeath = tDeathZones.some(dz => !dz.cleared && world.gameTime < dz.expiresAt &&
                                Math.hypot(dz.x - supportCand.x, dz.y - supportCand.y) < 140);
                            const inFire = world.firePatches.some(f => f.life > 0.5 &&
                                Math.hypot(f.x - supportCand.x, f.y - supportCand.y) < f.radius + 32);
                            if (!nearDeath && !inFire) {
                                const hugged = snapToWallHugPos(supportCand.x, supportCand.y, bot.radius, 1.8);
                                killAnglePos = getMapLineOfSight(hugged.x, hugged.y, knownEnemyPos.x, knownEnemyPos.y)
                                    ? hugged
                                    : snapToWalkablePos(supportCand.x, supportCand.y, bot.radius + 4);
                            }
                        }
                    }

                    if (killAnglePos) {
                        const distToAngle = Math.hypot(killAnglePos.x - bot.x, killAnglePos.y - bot.y);
                        bot.isWallHuggingHold = true;
                        destinationPos = killAnglePos;
                        desiredLookAngle = Math.atan2(knownEnemyPos.y - killAnglePos.y, knownEnemyPos.x - killAnglePos.x);
                        if (distToAngle <= 32) {
                            bot.isHoldingCrossfire = true;
                            if (bot.getEquippedKey() === "AWP") {
                                wantsToHoldPosition = true;
                                if (hasAWPScopeLineClearance(bot, desiredLookAngle)) {
                                    bot.isScoped = true;
                                    bot.scopeLevel = 1;
                                }
                            } else {
                                bot.isADPeeking = true;
                                destinationPos = getDefenseADStrafeDest(bot, killAnglePos, desiredLookAngle, dt, 22);
                            }
                        }
                    } else {
                        // No safe off-angle in range: play a cover-backed post-plant pocket with smooth A-D footwork aimed at the enemy's peek corner
                        const zoneControl = updateAreaControlZone(bot, siteKey, dt, T_POST_PLANT_ZONES);
                        const apex = getCornerPeekPrefireTarget(bot, knownEnemyPos.x, knownEnemyPos.y, 0, 0);
                        destinationPos = zoneControl ? zoneControl.dest : findTacticalCover(bot, knownEnemyPos.x, knownEnemyPos.y);
                        wantsToHoldPosition = zoneControl ? zoneControl.hold : (Math.hypot(destinationPos.x - bot.x, destinationPos.y - bot.y) <= 24);
                        bot.isADPeeking = Boolean(zoneControl?.isADPeeking);
                        bot.isHoldingCrossfire = wantsToHoldPosition || bot.isADPeeking;
                        desiredLookAngle = apex
                            ? Math.atan2(apex.y - bot.y, apex.x - bot.x)
                            : threatAngle;
                    }
                } else {
                    const postPlantControl = updateAreaControlZone(bot, siteKey, dt, T_POST_PLANT_ZONES);
                    if (postPlantControl) {
                        destinationPos = postPlantControl.dest;
                        desiredLookAngle = postPlantControl.lookAngle;
                        wantsToHoldPosition = postPlantControl.hold;
                        bot.isADPeeking = Boolean(postPlantControl.isADPeeking);
                        bot.isHoldingCrossfire = postPlantControl.hold || bot.isADPeeking;
                        bot.isPatrolling = false;
                        bot.isCrouching = false;
                        if (bot.getEquippedKey() === "AWP" && postPlantControl.hold && hasAWPScopeLineClearance(bot, desiredLookAngle)) {
                            bot.isScoped = true;
                            bot.scopeLevel = 1;
                        }
                    } else {
                        bot.isPatrolling = true;
                        destinationPos = getSitePatrolDestination(bot, siteKey);
                        const moveAngle = Math.atan2(destinationPos.y - bot.y, destinationPos.x - bot.x);
                        updatePatrolVision(bot, moveAngle, dt);
                        desiredLookAngle = bot.angle;
                    }
                }
            }
        }
    }

    // Pre-plant objective lock & carrier escort identification
    const activeCarrier = (bot.team === "T" && !c4State.isPlanted && !c4State.isDropped &&
        c4State.carrier && !c4State.carrier.isDead && !bot.hasC4)
        ? c4State.carrier
        : null;
    const isCarrierEscort = Boolean(activeCarrier && (
        bot.squadGroup === "ALPHA" ||
        !T_STRATEGIES[world.currentTStrategyKey]?.isSplit ||
        Math.hypot(activeCarrier.x - bot.x, activeCarrier.y - bot.y) <= 440
    ));
    const isWithinCarrierEscortRadius = (pos) =>
        !isCarrierEscort || !activeCarrier || Math.hypot(pos.x - activeCarrier.x, pos.y - activeCarrier.y) <= 420;

    const isTPlantLockdown = bot.team === "T" && !c4State.isPlanted &&
        (isTReadyToPlantAtSite(bot.assignedSite || "A") || Boolean(c4State.planter && !c4State.planter.isDead));
    const skipHuntForPlant = isUnarmedC4Carrier || isTPlantLockdown;

    // 6B. Coordinated Anti-AWP Response: <= 780px Utility + Multi-Angle Pinch | > 780px Fast Sightline Cross
    bot.isFastCrossingAWP = false;
    world.awpSwarmSignals = world.awpSwarmSignals.filter(s => world.gameTime - s.time < 14.0 && !s.awper.isDead);
    const awpThreat = !destinationPos ? getDeducedAWPTarget(bot.team, bot.x, bot.y, 2400) : null;

    if (awpThreat && awpThreat.dist > 780) {
        bot.isFastCrossingAWP = true;
        bot.isSilentWalking = false;
        bot.isCrouching = false;

        if (bot.team === "T" && !c4State.isPlanted) {
            pincerState.breachInitiated = true;
        } else if (bot.team === "CT" && c4State.isPlanted) {
            ctPincerState.breachInitiated = true;
            goalPriority = 85;
            bot.isPatrolling = false;
            destinationPos = { x: c4State.plantX, y: c4State.plantY };
        }
    } else if (awpThreat && awpThreat.dist <= 780 && !skipHuntForPlant && !isSoloTClutch && !isTClockUnder20s) {
        const teammates = bot.team === "CT" ? world.livingCT : world.livingT;
        const postPlantDistantAWP = c4State.isPlanted && bot.team === "T" &&
            Math.hypot(awpThreat.x - c4State.plantX, awpThreat.y - c4State.plantY) > 620;
        const awpGeometry = evaluateAWPNestPinchability(awpThreat.x, awpThreat.y);

        if (!postPlantDistantAWP) {
            // If a T bot detects an AWP locked on a tight single-lane choke (like A Short), do NOT chase single-file:
            // throw blocking smoke/flash if available and pivot/avoid the sightline
            if (bot.team === "T" && !awpGeometry.isOpenMultiAngle) {
                if (bot.getEquippedKey() !== "AWP") {
                    tryCounterAWPUtility(bot, awpThreat);
                }
                if (!c4State.isPlanted && !isTSquadOccupyingSite() &&
                    roundElapsed >= 8.0 && (world.gameTime - world.lastTRotationTime) >= 10.0) {
                    const currentStrat = T_STRATEGIES[world.currentTStrategyKey];
                    const curSite = currentStrat ? currentStrat.targetSite : "A";
                    const pivotCandidates = (curSite === "A"
                        ? ["MAZE_TOP_LANE_RUSH", "MAZE_MID_LANE_RUSH", "MAZE_BOTTOM_LANE_RUSH", "SPLIT_B_MID", "MID_TO_B_DOORS"]
                        : ["DIRECT_A_LONG", "GARDEN_A_SHORT", "SPLIT_A"]
                    ).filter(k => T_STRATEGIES[k] && k !== world.currentTStrategyKey);
                    const nextKey = pivotCandidates[Math.floor(rnd() * pivotCandidates.length)];
                    if (nextKey) executeTRotation(nextKey, "TIGHT AWP CHOKE — ROTATING");
                }
            } else {
                const eligibleResponders = teammates
                    .filter(m => {
                        if (!m || m.isDead || (m.hasC4 && !c4State.isPlanted)) return false;
                        if (m.getEquippedKey && m.getEquippedKey() === "AWP") return false;
                        if (m.team === "T" && m.x < 760 && m.y > 460) return false;
                        return Math.hypot(awpThreat.x - m.x, awpThreat.y - m.y) <= 780;
                    })
                    .sort((a, b) => Math.hypot(awpThreat.x - a.x, awpThreat.y - a.y) - Math.hypot(awpThreat.x - b.x, awpThreat.y - b.y));

                const responderRank = eligibleResponders.indexOf(bot);
                const maxResponders = teammates.length >= 3 ? 3 : teammates.length;

                if (responderRank !== -1 && responderRank < maxResponders &&
                    world.gameTime >= (bot.antiAWPPinchCooldown || 0)) {
                    bot.antiAWPPinchTimer = (bot.antiAWPPinchTimer || 0) + dt;
                    tryCounterAWPUtility(bot, awpThreat);

                    const baseFromAWP = Math.atan2(bot.y - awpThreat.y, bot.x - awpThreat.x);
                    const angleSpread = responderRank === 0 ? 0 : (responderRank === 1 ? (75 * Math.PI / 180) : (-75 * Math.PI / 180));
                    const pinchAngle = baseFromAWP + angleSpread;
                    const pinchDist = responderRank === 0 ? 210 : 235;
                    const rawPinch = snapToWalkablePos(
                        awpThreat.x + Math.cos(pinchAngle) * pinchDist,
                        awpThreat.y + Math.sin(pinchAngle) * pinchDist,
                        bot.radius + 4
                    );

                    const pinchDest = getMapLineOfSight(rawPinch.x, rawPinch.y, awpThreat.x, awpThreat.y)
                        ? rawPinch
                        : findMultiAngleSupportPosition(bot, awpThreat.x, awpThreat.y, eligibleResponders[0], responderRank === 2 ? -1 : 1);

                    const reachedPinch = pinchDest && Math.hypot(pinchDest.x - bot.x, pinchDest.y - bot.y) <= 32;
                    if (reachedPinch || bot.antiAWPPinchTimer >= 2.4) {
                        recordClearedSector(bot.team, awpThreat.x, awpThreat.y, 7.0);
                        bot.antiAWPPinchTimer = 0;
                        bot.antiAWPPinchCooldown = world.gameTime + 6.0;
                    } else {
                        goalPriority = 85;
                        bot.isPatrolling = false;
                        bot.isSilentWalking = false;
                        destinationPos = pinchDest;
                        desiredLookAngle = Math.atan2(awpThreat.y - bot.y, awpThreat.x - bot.x);
                    }
                } else {
                    bot.antiAWPPinchTimer = 0;
                }
            }
        }
    }

    // 6C. Dropped C4 Area Clearing (Based on Existing Info) & Retrieval (Priority 88 / 78)
    if (!destinationPos && c4State.isDropped) {
        const walkableDrop = snapToWalkablePos(c4State.dropX, c4State.dropY, TORSO_RADIUS + 4);
        c4State.dropX = walkableDrop.x;
        c4State.dropY = walkableDrop.y;

        if (bot.team === "T") {
            updateDesignatedRetriever();

            // Cap area-clearing time at 2.4s (or bypass immediately when <= 2 Ts remain or clock <= 40s) so C4 recovery never deadlocks
            bot.c4ClearTimer = (bot.c4ClearTimer || 0) + dt;
            const bypassDropClear = bot.c4ClearTimer >= 2.4 || world.livingT.length <= 2 || matchState.roundTimer <= 40.0;

            // Gather reachable threat info within vision range (<= 460px) overlooking the dropped bomb
            const areaThreats = [];
            const addAreaThreat = (tx, ty, priority, label) => {
                if (bypassDropClear) return;
                if (Math.hypot(tx - walkableDrop.x, ty - walkableDrop.y) > 460) return;
                if (isSectorRecentlyCleared("T", tx, ty, 125)) return;
                // Mark cleared immediately if any alive T sees the spot empty or is already holding close to it
                const seenEmpty = world.livingT.some(m =>
                    m && !m.isDead &&
                    (isPointVisibleToBot(m, tx, ty) || (Math.hypot(m.x - tx, m.y - ty) < 220 && getMapLineOfSight(m.x, m.y, tx, ty))) &&
                    !world.livingCT.some(c => !c.isDead && Math.hypot(c.x - tx, c.y - ty) < 150)
                );
                if (seenEmpty) {
                    recordClearedSector("T", tx, ty, 7.0);
                    return;
                }
                if (!areaThreats.some(t => Math.hypot(t.x - tx, t.y - ty) < 110)) {
                    areaThreats.push({ x: tx, y: ty, priority, label });
                }
            };

            // 1. Live CT intel sightings near the dropped C4
            for (const id in (world.sharedEnemyIntelT || {})) {
                const intel = world.sharedEnemyIntelT[id];
                if (intel && intel.enemy && !intel.enemy.isDead && !intel.isSpotCleared &&
                    (world.gameTime - intel.time < 5.5) &&
                    Math.hypot(intel.x - walkableDrop.x, intel.y - walkableDrop.y) <= 580) {
                    addAreaThreat(intel.x, intel.y, 100, "INTEL");
                }
            }

            // 2. Recent CT footsteps / gunfire cues near the dropped C4
            if (bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 4.0) &&
                Math.hypot(bot.lastHeardSound.x - walkableDrop.x, bot.lastHeardSound.y - walkableDrop.y) <= 560) {
                addAreaThreat(bot.lastHeardSound.x, bot.lastHeardSound.y, 90, "SOUND");
            }

            // 3. Deduced AWP nests, ballistic traces, killer hotzones & suspicion memory near the dropped C4
            const awpNearDrop = getDeducedAWPTarget("T", walkableDrop.x, walkableDrop.y, 650);
            if (awpNearDrop) {
                addAreaThreat(awpNearDrop.x, awpNearDrop.y, 95, "AWP");
            }
            (world.tacticalIntel?.ballisticTraces?.T || []).forEach(tr => {
                if (world.gameTime < tr.expiresAt && Math.hypot(tr.x - walkableDrop.x, tr.y - walkableDrop.y) <= 560) {
                    addAreaThreat(tr.x, tr.y, 85, "TRACE");
                }
            });
            (world.tacticalIntel?.killerHotzones?.T || []).forEach(hz => {
                if (!hz.clearedThisRound && Math.hypot(hz.x - walkableDrop.x, hz.y - walkableDrop.y) <= 540) {
                    addAreaThreat(hz.x, hz.y, 75, "HOTZONE");
                }
            });
            (world.teamSuspicionMemory?.T || []).forEach(sp => {
                if (!sp.clearedThisRound && Math.hypot(sp.x - walkableDrop.x, sp.y - walkableDrop.y) <= 520) {
                    addAreaThreat(sp.x, sp.y, 70, "SUSPICION");
                }
            });

            areaThreats.sort((a, b) => (b.priority - Math.hypot(b.x - bot.x, b.y - bot.y) * 0.25) -
                (a.priority - Math.hypot(a.x - bot.x, a.y - bot.y) * 0.25));

            const primaryDropThreat = areaThreats[0] || null;
            const escorts = world.livingT
                .filter(m => m && !m.isDead && m !== c4State.c4Retriever)
                .sort((a, b) => Math.hypot(walkableDrop.x - a.x, walkableDrop.y - a.y) - Math.hypot(walkableDrop.x - b.x, walkableDrop.y - b.y));
            const escortIdx = Math.max(0, escorts.indexOf(bot));

            if (bot === c4State.c4Retriever) {
                // Designated retriever moves directly to pick up the dropped C4 without stalling on corner sweeps
                bot.tAttackPeekState = null;
                goalPriority = 88;
                bot.isPatrolling = false;
                bot.isHoldingCrossfire = false;
                bot.isFollowingPlanRoute = false;
                bot.isSilentWalking = false;
                destinationPos = { x: walkableDrop.x, y: walkableDrop.y };
                desiredLookAngle = getActiveGazeHoldAngle(bot) ??
                    (primaryDropThreat
                        ? Math.atan2(primaryDropThreat.y - bot.y, primaryDropThreat.x - bot.x)
                        : Math.atan2(walkableDrop.y - bot.y, walkableDrop.x - bot.x));
            } else if (primaryDropThreat) {
                // Escorts clear active enemy threats overlooking the dropped C4 while the retriever grabs it
                goalPriority = 86;
                bot.isPatrolling = false;
                bot.isHoldingCrossfire = false;
                bot.isFollowingPlanRoute = false;

                const clearTarget = areaThreats[escortIdx % areaThreats.length] || primaryDropThreat;
                const peekPlan = updateTAttackCornerPeek(bot, clearTarget, false, dt);

                if (peekPlan) {
                    destinationPos = peekPlan.dest;
                    desiredLookAngle = peekPlan.lookAngle;
                    wantsToHoldPosition = peekPlan.hold;
                } else {
                    const clearAnglePos = findCrossfireSupportAngle(bot, clearTarget, c4State.c4Retriever);
                    destinationPos = clearAnglePos
                        ? { x: clearAnglePos.x, y: clearAnglePos.y }
                        : { x: clearTarget.x, y: clearTarget.y };
                    desiredLookAngle = Math.atan2(clearTarget.y - bot.y, clearTarget.x - bot.x);

                    if (Math.hypot(destinationPos.x - bot.x, destinationPos.y - bot.y) <= 28 &&
                        getMapLineOfSight(bot.x, bot.y, clearTarget.x, clearTarget.y)) {
                        recordClearedSector("T", clearTarget.x, clearTarget.y, 7.0);
                    }
                }
            } else if (false) {
                // Step 2: Area is clear — retriever picks up the dropped C4
                bot.tAttackPeekState = null;
                goalPriority = 88;
                bot.isPatrolling = false;
                bot.isHoldingCrossfire = false;
                bot.isFollowingPlanRoute = false;
                bot.isSilentWalking = false;
                destinationPos = { x: walkableDrop.x, y: walkableDrop.y };
                desiredLookAngle = getActiveGazeHoldAngle(bot) ??
                    Math.atan2(walkableDrop.y - bot.y, walkableDrop.x - bot.x);
            } else if ((bot.c4EscortHoldTimer || 0) < 2.5) {
                // Step 2 (Escorts): Hold perimeter angles briefly (up to 2.5s) while retriever closes in
                bot.c4EscortHoldTimer = (bot.c4EscortHoldTimer || 0) + dt;
                bot.tAttackPeekState = null;
                goalPriority = 78;
                bot.isPatrolling = false;
                bot.isFollowingPlanRoute = false;

                const distToBomb = Math.hypot(walkableDrop.x - bot.x, walkableDrop.y - bot.y);
                let bestEscortPt = null;
                let bestEscortScore = -Infinity;
                const slotAngles = [0, Math.PI * 0.5, -Math.PI * 0.5, Math.PI, Math.PI * 0.25];
                const baseGuardAng = slotAngles[escortIdx % slotAngles.length];

                for (let k = 0; k < 8; k++) {
                    const ang = baseGuardAng + k * (Math.PI / 4);
                    const ringDist = 145 + (escortIdx % 2) * 35;
                    const cand = snapToWallHugPos(
                        walkableDrop.x + Math.cos(ang) * ringDist,
                        walkableDrop.y + Math.sin(ang) * ringDist,
                        bot.radius,
                        5.5
                    );
                    if (checkWallCollision(cand.x, cand.y, bot.radius)) continue;
                    if (!getMapLineOfSight(cand.x, cand.y, walkableDrop.x, walkableDrop.y)) continue;

                    const dBomb = Math.hypot(cand.x - walkableDrop.x, cand.y - walkableDrop.y);
                    if (dBomb < 110 || dBomb > 240) continue;

                    let score = -Math.hypot(cand.x - bot.x, cand.y - bot.y) * 0.25 + (k === 0 ? 45 : 0);
                    for (let e = 0; e < escorts.length; e++) {
                        const other = escorts[e];
                        if (other === bot) continue;
                        const dOther = Math.hypot(cand.x - other.x, cand.y - other.y);
                        if (dOther < 110) score -= (110 - dOther) * 3.0;
                    }
                    if (score > bestEscortScore) {
                        bestEscortScore = score;
                        bestEscortPt = cand;
                    }
                }

                const escortPt = bestEscortPt || { x: walkableDrop.x, y: walkableDrop.y };
                destinationPos = escortPt;

                const clearGaze = getActiveGazeHoldAngle(bot);
                const susSpot = getRelevantSuspiciousSpot(bot);
                const nearestChoke = TACTICAL_CORNERS
                    .filter(c => Math.hypot(c.x - escortPt.x, c.y - escortPt.y) > 90 &&
                        Math.hypot(c.x - escortPt.x, c.y - escortPt.y) < 420 &&
                        getMapLineOfSight(escortPt.x, escortPt.y, c.x, c.y))
                    .sort((a, b) => Math.hypot(a.x - escortPt.x, a.y - escortPt.y) - Math.hypot(b.x - escortPt.x, b.y - escortPt.y))[0];

                const chokeAngle = nearestChoke
                    ? Math.atan2(nearestChoke.y - escortPt.y, nearestChoke.x - escortPt.x)
                    : Math.atan2(walkableDrop.y - escortPt.y, walkableDrop.x - escortPt.x);

                desiredLookAngle = clearGaze ??
                    (susSpot ? Math.atan2(susSpot.y - bot.y, susSpot.x - bot.x) : chokeAngle);

                if (distToBomb <= 240 && Math.hypot(escortPt.x - bot.x, escortPt.y - bot.y) <= 10) {
                    wantsToHoldPosition = true;
                    bot.isHoldingCrossfire = true;
                }
            }
        } else {
            bot.c4ClearTimer = 0;
            if (bot.team === "CT" && c4State.ctSeenDropped) {
                const sortedCTs = world.livingCT.slice().sort((a, b) =>
                    Math.hypot(c4State.dropX - a.x, c4State.dropY - a.y) -
                    Math.hypot(c4State.dropX - b.x, c4State.dropY - b.y)
                );
                const guardRank = sortedCTs.indexOf(bot);

                if (guardRank !== -1 && guardRank < 2) {
                    goalPriority = 70;
                    bot.isFollowingPlanRoute = false;
                    bot.isPatrolling = true;
                    bot.isCrouching = false;

                    const bombMoved = !bot.c4GuardSpot ||
                        Math.hypot(bot.c4GuardSpot.bombX - c4State.dropX, bot.c4GuardSpot.bombY - c4State.dropY) > 40;
                    const reachedPatrolWp = bot.c4GuardSpot &&
                        Math.hypot(bot.c4GuardSpot.x - bot.x, bot.c4GuardSpot.y - bot.y) <= 34;

                    if (bombMoved || reachedPatrolWp || world.gameTime >= (bot.c4GuardSpot.expiresAt || 0)) {
                        const sectorBase = (guardRank === 0 ? 0 : Math.PI) + (rnd() - 0.5) * 1.9;
                        const patrolRad = 185 + rnd() * 155;
                        const rawX = Math.max(80, Math.min(MAP.width - 80, c4State.dropX + Math.cos(sectorBase) * patrolRad));
                        const rawY = Math.max(80, Math.min(MAP.height - 80, c4State.dropY + Math.sin(sectorBase) * patrolRad));
                        const patrolPt = navCellToWorld(worldToNavCell(rawX, rawY));

                        bot.c4GuardSpot = {
                            x: patrolPt.x,
                            y: patrolPt.y,
                            bombX: c4State.dropX,
                            bombY: c4State.dropY,
                            expiresAt: world.gameTime + (2.6 + rnd() * 1.6)
                        };
                    }

                    destinationPos = { x: bot.c4GuardSpot.x, y: bot.c4GuardSpot.y };
                    const suspiciousSpot = getRelevantSuspiciousSpot(bot);
                    if (suspiciousSpot) {
                        desiredLookAngle = Math.atan2(suspiciousSpot.y - bot.y, suspiciousSpot.x - bot.x);
                    } else {
                        const patrolMoveAngle = Math.atan2(destinationPos.y - bot.y, destinationPos.x - bot.x);
                        updatePatrolVision(bot, patrolMoveAngle, dt);
                        desiredLookAngle = bot.angle;
                    }
                }
            }
        }
    } else {
        bot.c4ClearTimer = 0;
        bot.c4EscortHoldTimer = 0;
    }

    // Approachability check for nearby unsmoked gunfire vs. distant or smoke-obscured chases
    const freshLocalGunfire = bot.lastHeardSound &&
        (world.gameTime - bot.lastHeardSound.time < 1.6) &&
        (bot.lastHeardSound.type === "firing_trace" || bot.lastHeardSound.type === "visual") &&
        Math.hypot(bot.lastHeardSound.x - bot.x, bot.lastHeardSound.y - bot.y) <= 520;
    const freshLocalShotDist = freshLocalGunfire
        ? Math.hypot(bot.lastHeardSound.x - bot.x, bot.lastHeardSound.y - bot.y)
        : Infinity;
    const freshLocalShotExposed = Boolean(
        freshLocalGunfire &&
        !isInsideSmoke(bot.lastHeardSound.x, bot.lastHeardSound.y, 12) &&
        getMapLineOfSight(bot.x, bot.y, bot.lastHeardSound.x, bot.lastHeardSound.y)
    );
    const isMoreApproachableLocalShot = (chasePos) => {
        if (!freshLocalGunfire) return false;
        const chaseDist = Math.hypot(chasePos.x - bot.x, chasePos.y - bot.y);
        const chaseInSmoke = isInsideSmoke(chasePos.x, chasePos.y, 12) ||
            isSegmentObscuredBySmoke(bot.x, bot.y, chasePos.x, chasePos.y);
        return (freshLocalShotExposed && chaseInSmoke) || (freshLocalShotDist + 135 < chaseDist);
    };

    // 6D. Squad Trade-Frag Swing (Priority 80) & Vulnerable Enemy Push (Priority 75)
    if (!destinationPos && !skipHuntForPlant && !isSoloTClutch && !isTClockUnder20s &&
        bot.tradeTarget && !bot.tradeTarget.isDead && bot.tradeTimer > 0 &&
        !isMoreApproachableLocalShot({ x: bot.tradeTarget.x, y: bot.tradeTarget.y }) &&
        isWithinCarrierEscortRadius({ x: bot.tradeTarget.x, y: bot.tradeTarget.y }) &&
        !isBeyondOverchaseTether(bot, { x: bot.tradeTarget.x, y: bot.tradeTarget.y })) {
        goalPriority = 80;
        bot.isPatrolling = false;
        bot.isFollowingPlanRoute = false;
        destinationPos = { x: bot.tradeTarget.x, y: bot.tradeTarget.y };
        desiredLookAngle = Math.atan2(bot.tradeTarget.y - bot.y, bot.tradeTarget.x - bot.x);
    }

    if (!destinationPos && !skipHuntForPlant && !isSoloTClutch && !isTClockUnder20s &&
        bot.vulnerableTarget && !bot.vulnerableTarget.target.isDead) {
        const vTarget = bot.vulnerableTarget.target;
        const vDist = Math.hypot(vTarget.x - bot.x, vTarget.y - bot.y);
        if (vDist < 550 &&
            !isMoreApproachableLocalShot({ x: vTarget.x, y: vTarget.y }) &&
            isWithinCarrierEscortRadius({ x: vTarget.x, y: vTarget.y }) &&
            !isBeyondOverchaseTether(bot, { x: vTarget.x, y: vTarget.y })) {
            goalPriority = 75;
            bot.isPatrolling = false;
            bot.isHoldingCrossfire = false;
            destinationPos = { x: vTarget.x, y: vTarget.y };
            desiredLookAngle = Math.atan2(vTarget.y - bot.y, vTarget.x - bot.x);
        }
    }

    // 6E. Dynamic Squad Coordinator Orders (Site Plant Escort, Pre-Fires, Pinches & AWP Overwatch)
    if (!destinationPos && bot.tacticalOrder && world.gameTime < bot.tacticalOrder.expiresAt) {
        const order = bot.tacticalOrder;

        if (order.role === "SITE_PLANT_ESCORT") {
            goalPriority = 82;
            bot.isFollowingPlanRoute = false;
            const siteKey = bot.assignedSite === "B" ? "B" : "A";
            const holdAngles = T_SITE_HOLD_ANGLES[siteKey] || [];
            const escorts = world.livingT.filter(t => t && !t.isDead && !t.hasC4);
            const escortSlot = Math.max(0, escorts.indexOf(bot));

            if (holdAngles.length > 0) {
                const holdSlot = holdAngles[escortSlot % holdAngles.length];
                const holdPt = snapToWallHugPos(holdSlot.x, holdSlot.y, bot.radius, 1.8);
                const distHold = Math.hypot(holdPt.x - bot.x, holdPt.y - bot.y);

                bot.isPatrolling = false;
                bot.isWallHuggingHold = true;
                destinationPos = holdPt;
                desiredLookAngle = Math.atan2(holdSlot.watchY - holdPt.y, holdSlot.watchX - holdPt.x);
                if (distHold <= 36) {
                    bot.isHoldingCrossfire = true;
                    if (bot.getEquippedKey() === "AWP") {
                        wantsToHoldPosition = true;
                        bot.isCrouching = false;
                        if (hasAWPScopeLineClearance(bot, desiredLookAngle)) {
                            bot.isScoped = true;
                            bot.scopeLevel = 1;
                        }
                    } else {
                        bot.isCrouching = false;
                        bot.isADPeeking = true;
                        destinationPos = getDefenseADStrafeDest(bot, holdPt, desiredLookAngle, dt, 30);
                    }
                }
            } else {
                bot.isPatrolling = true;
                destinationPos = getSitePatrolDestination(bot, siteKey);
                const moveAngle = Math.atan2(destinationPos.y - bot.y, destinationPos.x - bot.x);
                updatePatrolVision(bot, moveAngle, dt);
                desiredLookAngle = bot.angle;
            }
        } else if (order.role === "PROBE_PREFIRE" && order.focusPos && !isUnarmedC4Carrier) {
            const distFocus = Math.hypot(order.focusPos.x - bot.x, order.focusPos.y - bot.y);
            const sectorAlreadyCleared = isSectorRecentlyCleared(bot.team, order.focusPos.x, order.focusPos.y, 120);
            const minPrefireTime = bot.team === "T" ? 3.5 : 8.5;
            const maxPrefireRange = bot.team === "T" ? 480 : 420;

            if (!sectorAlreadyCleared && roundElapsed >= minPrefireTime && distFocus <= maxPrefireRange && !bot.isSilentWalking) {
                goalPriority = 68;
                bot.isPatrolling = false;
                const focusAng = Math.atan2(order.focusPos.y - bot.y, order.focusPos.x - bot.x);
                desiredLookAngle = focusAng;

                // Pre-plant T attackers fire probe bursts on the move toward site rather than standing still
                if (bot.team === "T" && !c4State.isPlanted) {
                    const siteRect = bot.assignedSite === "B" ? MAP.siteB : MAP.siteA;
                    destinationPos = { x: siteRect.safeSpot.x, y: siteRect.safeSpot.y };
                } else {
                    destinationPos = { x: bot.x, y: bot.y };
                    wantsToHoldPosition = true;
                }

                const wep = bot.getWeapon();
                const hasSight = getMapLineOfSight(bot.x, bot.y, order.focusPos.x, order.focusPos.y);
                const canWallbangWithin3s = canBulletPenetrateTo(bot.x, bot.y, order.focusPos.x, order.focusPos.y, wep.piercingPower) &&
                    (distFocus / Math.max(190, wep.speed || 1600)) <= 3.0;
                const prefireCooldown = bot.team === "T" ? 2.2 : 3.5;

                if (wep.category !== "sniper" && wep.category !== "knife" && wep.category !== "grenade" &&
                    bot.getCurrentClip() > 6 && (world.gameTime - (bot.lastPrefireTime || -99)) >= prefireCooldown &&
                    Math.abs(normalizeAngle(focusAng - bot.angle)) < 0.18 &&
                    (hasSight || canWallbangWithin3s)) {
                    bot.isPrefiringProbe = true;
                    performAttack(bot, order.focusPos.x, order.focusPos.y, false);
                    bot.isPrefiringProbe = false;
                    bot.lastPrefireTime = world.gameTime;
                }
            }
        } else if ((order.role === "SUPPRESS_COVER" || order.role === "CONTAIN_UTILITY") && order.focusPos && !isUnarmedC4Carrier) {
            const distFocus = Math.hypot(order.focusPos.x - bot.x, order.focusPos.y - bot.y);
            const sectorAlreadyCleared = isSectorRecentlyCleared(bot.team, order.focusPos.x, order.focusPos.y, 120);
            const minSuppressTime = bot.team === "T" ? 3.5 : 8.5;

            if (!sectorAlreadyCleared) {
                goalPriority = 72;
                bot.isPatrolling = false;
                const focusAng = Math.atan2(order.focusPos.y - bot.y, order.focusPos.x - bot.x);
                desiredLookAngle = focusAng;

                const threwAntiAWP = order.isAntiAWP && tryCounterAWPUtility(bot, order.focusPos);
                if (threwAntiAWP) {
                    bot.lastAntiAWPUtilTime = world.gameTime;
                    bot.tacticalOrder = null;
                } else if (!tryExecuteTacticalUtility(bot, dt, null) && order.suppressFire && roundElapsed >= minSuppressTime && distFocus <= 480) {
                    const wep = bot.getWeapon();
                    const maxClip = wep.clip || 30;
                    const hasSight = getMapLineOfSight(bot.x, bot.y, order.focusPos.x, order.focusPos.y);
                    const canWallbangWithin3s = canBulletPenetrateTo(bot.x, bot.y, order.focusPos.x, order.focusPos.y, wep.piercingPower) &&
                        (distFocus / Math.max(190, wep.speed || 1600)) <= 3.0;

                    if (wep.category !== "sniper" && wep.category !== "knife" && wep.category !== "grenade" &&
                        bot.getCurrentClip() > Math.ceil(maxClip * 0.35) &&
                        Math.abs(normalizeAngle(focusAng - bot.angle)) < 0.20 &&
                        (hasSight || canWallbangWithin3s)) {
                        bot.isPrefiringProbe = true;
                        performAttack(bot, order.focusPos.x, order.focusPos.y, false);
                        bot.isPrefiringProbe = false;
                    }
                }

                if (order.role === "CONTAIN_UTILITY") {
                    if (order.avoidDryChase && !threwAntiAWP) {
                        // Cannot throw from here; release order immediately so the bot continues its route or rotation
                        bot.tacticalOrder = null;
                        goalPriority = 0;
                    } else if (order.isAntiAWP && order.targetPos) {
                        destinationPos = order.targetPos;
                    } else if (bot.team === "T" && !c4State.isPlanted) {
                        const siteRect = bot.assignedSite === "B" ? MAP.siteB : MAP.siteA;
                        destinationPos = { x: siteRect.safeSpot.x, y: siteRect.safeSpot.y };
                    } else {
                        destinationPos = { x: bot.x, y: bot.y };
                        wantsToHoldPosition = true;
                    }
                }
            }
        } else if (order.role === "FLANK_PINCH" || order.role === "PREDICTED_CUTOFF") {
            if (bot.team === "T" && !c4State.isPlanted && order.targetPos &&
                Math.hypot(order.targetPos.x - bot.x, order.targetPos.y - bot.y) <= 32) {
                if (order.focusPos) recordClearedSector("T", order.focusPos.x, order.focusPos.y, 7.0);
                bot.tacticalOrder = null;
            } else {
                goalPriority = 72;
                bot.isPatrolling = false;
                bot.isFollowingPlanRoute = false;
                destinationPos = order.targetPos;
                desiredLookAngle = order.focusPos
                    ? Math.atan2(order.focusPos.y - bot.y, order.focusPos.x - bot.x)
                    : null;
            }
        } else if (order.role === "AWP_OVERWATCH") {
            goalPriority = 66;
            bot.isFollowingPlanRoute = false;
            bot.isPatrolling = false;
            destinationPos = order.targetPos;
            const distOw = Math.hypot(order.targetPos.x - bot.x, order.targetPos.y - bot.y);
            const lookAng = order.focusPos
                ? Math.atan2(order.focusPos.y - bot.y, order.focusPos.x - bot.x)
                : bot.angle;

            if (distOw <= 68) {
                if (hasAWPScopeLineClearance(bot, lookAng)) {
                    wantsToHoldPosition = true;
                    bot.isHoldingCrossfire = true;
                    bot.isScoped = true;
                    bot.scopeLevel = 1;
                } else if (!order.adjustedOnce && order.focusPos) {
                    order.adjustedOnce = true;
                    const clearSpot = findMultiAngleSupportPosition(bot, order.focusPos.x, order.focusPos.y, bot);
                    if (clearSpot && Math.hypot(clearSpot.x - order.targetPos.x, clearSpot.y - order.targetPos.y) > 20) {
                        order.targetPos = snapToWalkablePos(clearSpot.x, clearSpot.y, bot.radius + 4);
                        destinationPos = order.targetPos;
                    } else {
                        wantsToHoldPosition = true;
                        bot.isHoldingCrossfire = true;
                        bot.isScoped = false;
                    }
                } else {
                    wantsToHoldPosition = true;
                    bot.isHoldingCrossfire = true;
                    bot.isScoped = false;
                }
            }
            desiredLookAngle = lookAng;
        }
    }

    // 6F. Immediate Teammate Support & Hysteresis-Locked Tactical Responses (Priority 65 / 55)
    if (!destinationPos) {
        const freshCTIntel = bot.team === "CT"
            ? Object.values(world.sharedEnemyIntelCT).filter(
                intel => intel && intel.enemy && !intel.enemy.isDead && !intel.isSpotCleared && (world.gameTime - intel.time <= 4.5)
            )
            : [];

        const hasUrgentSupportAlert = bot.team === "CT" && (
            freshCTIntel.some(intel => (world.gameTime - intel.time) < 1.2) ||
            world.squadHelpSignals.some(s => s.team === "CT" && (world.gameTime - s.time) < 1.2 && (!s.targetEnemy || !s.targetEnemy.isDead))
        );
        if (hasUrgentSupportAlert && bot.macroGoal && bot.macroGoal.type !== "SUPPORT") {
            bot.macroGoal = null;
        }

        const macroGoalDist = bot.macroGoal ? Math.hypot(bot.macroGoal.x - bot.x, bot.macroGoal.y - bot.y) : Infinity;
        const closerShotOverridesMacro = Boolean(
            bot.macroGoal &&
            isMoreApproachableLocalShot({ x: bot.macroGoal.x, y: bot.macroGoal.y })
        );

        if (bot.macroGoal && !closerShotOverridesMacro && world.gameTime < bot.macroGoal.until && macroGoalDist > 45) {
            destinationPos = { x: bot.macroGoal.x, y: bot.macroGoal.y };
            desiredLookAngle = bot.macroGoal.lookAngle !== undefined ? bot.macroGoal.lookAngle : null;
        } else {
            bot.macroGoal = null;

            world.squadHelpSignals = world.squadHelpSignals.filter(
                s => (world.gameTime - s.time < 4.5) && (!s.targetEnemy || !s.targetEnemy.isDead)
            );
            const isTInGarden = bot.team === "T" && bot.x < 760 && bot.y > 460;
            const isTClockOrClutchUrgent = bot.team === "T" && !c4State.isPlanted &&
                (matchState.roundTimer <= 45.0 || world.livingT.length <= 3 || isTInGarden);
            const validSignals = world.squadHelpSignals.filter(s => {
                if (s.team !== bot.team) return false;
                if (bot.team === "CT") return shouldCTBotSupport(bot, s);
                if (isTClockOrClutchUrgent) return false;
                if (s.victim === activeCarrier) return true;
                if (skipHuntForPlant || !isWithinCarrierEscortRadius(s.enemyPos)) return false;
                return s.victim !== bot;
            });
            validSignals.sort((a, b) => {
                if (a.victim === activeCarrier && b.victim !== activeCarrier) return -1;
                if (b.victim === activeCarrier && a.victim !== activeCarrier) return 1;
                return Math.hypot(a.enemyPos.x - bot.x, a.enemyPos.y - bot.y) -
                    Math.hypot(b.enemyPos.x - bot.x, b.enemyPos.y - bot.y);
            });

            const activeDistress = validSignals[0];
            if (activeDistress) {
                goalPriority = (activeDistress.victim === activeCarrier) ? 84 : 65;
                bot.isPatrolling = false;
                bot.isFollowingPlanRoute = false;

                // Deduce shooter position from live sight or teammate's directional bullet-hit callout (approximate zone)
                const shooter = activeDistress.attacker;
                const shooterPos = (shooter && !shooter.isDead && (world.gameTime - (shooter.lastSpottedTime || -99) < 1.5))
                    ? { x: shooter.x, y: shooter.y }
                    : (activeDistress.approxPos || activeDistress.enemyPos);
                const allyPos = (activeDistress.victim && !activeDistress.victim.isDead)
                    ? { x: activeDistress.victim.x, y: activeDistress.victim.y }
                    : activeDistress.victimPos;

                if (bot.team === "CT") {
                    const distressSite = shooterPos.y >= 1150 ? "B" : (shooterPos.y <= 780 ? "A" : null);
                    if (distressSite) commitCTSiteRotation(bot, distressSite, 12.0);
                }

                // Find a superior crossfire angle with LOS to the deduced shooter rather than running onto the ally
                const crossfirePlan = findCrossfireSupportAngle(bot, shooterPos, allyPos);
                const supportPos = crossfirePlan
                    ? { x: crossfirePlan.x, y: crossfirePlan.y }
                    : findMultiAngleSupportPosition(bot, shooterPos.x, shooterPos.y, activeDistress.victim);

                destinationPos = supportPos;
                const distToEnemy = Math.hypot(shooterPos.x - bot.x, shooterPos.y - bot.y);
                const lookAng = crossfirePlan
                    ? crossfirePlan.lookAngle
                    : (distToEnemy < 680 ? Math.atan2(shooterPos.y - bot.y, shooterPos.x - bot.x) : null);

                // Pre-plant T attackers keep moving/strafing rather than freezing in Maze/Garden after a teammate dies
                if (bot.team === "CT" && crossfirePlan && Math.hypot(supportPos.x - bot.x, supportPos.y - bot.y) <= 26) {
                    wantsToHoldPosition = true;
                    bot.isHoldingCrossfire = true;
                } else {
                    bot.isHoldingCrossfire = false;
                }

                bot.macroGoal = { type: "SUPPORT", x: supportPos.x, y: supportPos.y, lookAngle: lookAng, until: world.gameTime + 2.0 };
                desiredLookAngle = lookAng;
            }

            if (!destinationPos && bot.team === "CT" && freshCTIntel.length > 0) {
                freshCTIntel.sort((a, b) => {
                    const ax = a.x !== undefined ? a.x : a.enemy.x;
                    const ay = a.y !== undefined ? a.y : a.enemy.y;
                    const bx = b.x !== undefined ? b.x : b.enemy.x;
                    const by = b.y !== undefined ? b.y : b.enemy.y;
                    return Math.hypot(ax - bot.x, ay - bot.y) - Math.hypot(bx - bot.x, by - bot.y);
                });

                const primaryIntel = freshCTIntel[0];
                const intelX = primaryIntel.x !== undefined ? primaryIntel.x : primaryIntel.enemy.x;
                const intelY = primaryIntel.y !== undefined ? primaryIntel.y : primaryIntel.enemy.y;
                const distToSpotted = Math.hypot(intelX - bot.x, intelY - bot.y);
                const mySite = bot.assignedCTStrat?.site || "A";
                const mySiteAllies = world.livingCT.filter(m => m && m !== bot && !m.isDead && m.assignedCTStrat?.site === mySite);

                const shouldImmediateSupport = freshCTIntel.length >= 2 ||
                    distToSpotted <= 1150 ||
                    mySite === "MID" ||
                    mySiteAllies.length >= 1;

                if (shouldImmediateSupport) {
                    goalPriority = 65;
                    bot.isPatrolling = false;
                    bot.isFollowingPlanRoute = false;

                    const targetSiteKey = intelY >= 1150 ? "B" : (intelY <= 780 ? "A" : null);
                    if (targetSiteKey && (freshCTIntel.length >= 2 || primaryIntel.hasC4 || distToSpotted <= 1150)) {
                        commitCTSiteRotation(bot, targetSiteKey, 12.0);
                    }

                    const allyRef = (primaryIntel.spotter && !primaryIntel.spotter.isDead)
                        ? { x: primaryIntel.spotter.x, y: primaryIntel.spotter.y }
                        : null;
                    const crossfirePlan = findCrossfireSupportAngle(bot, { x: intelX, y: intelY }, allyRef);
                    const supportPos = crossfirePlan
                        ? { x: crossfirePlan.x, y: crossfirePlan.y }
                        : (findMultiAngleSupportPosition(bot, intelX, intelY, primaryIntel.spotter || bot) ||
                            getSquadMacroSearchTarget(bot, primaryIntel) ||
                            { x: intelX, y: intelY });

                    destinationPos = supportPos;
                    const lookAng = crossfirePlan
                        ? crossfirePlan.lookAngle
                        : (distToSpotted < 680 ? Math.atan2(intelY - bot.y, intelX - bot.x) : null);

                    if (crossfirePlan && Math.hypot(supportPos.x - bot.x, supportPos.y - bot.y) <= 26) {
                        wantsToHoldPosition = true;
                        bot.isHoldingCrossfire = true;
                    } else {
                        bot.isHoldingCrossfire = false;
                    }

                    bot.macroGoal = { type: "SUPPORT", x: supportPos.x, y: supportPos.y, lookAngle: lookAng, until: world.gameTime + 2.0 };
                    desiredLookAngle = lookAng;
                }
            }

            if (!destinationPos && bot.lastHeardSound && !skipHuntForPlant &&
                !(bot.team === "T" && !c4State.isPlanted && world.livingT.length <= 4)) {
                const soundAge = world.gameTime - bot.lastHeardSound.time;
                const soundDist = Math.hypot(bot.lastHeardSound.x - bot.x, bot.lastHeardSound.y - bot.y);
                const isGunfireTrace = bot.lastHeardSound.type === "firing_trace" || bot.lastHeardSound.type === "visual";
                const isFreshGunshot = isGunfireTrace && soundAge < 1.6 && soundDist <= 850;
                const canHearThroughWall = soundDist <= FOOTSTEP_LISTEN_RADIUS || isFreshGunshot || getMapLineOfSight(bot.x, bot.y, bot.lastHeardSound.x, bot.lastHeardSound.y);
                const tCanInvestigate = (bot.team !== "T" || (!isTInGarden && (isFreshGunshot || (isWithinCarrierEscortRadius(bot.lastHeardSound) && (!bot.siteObjectiveLock || soundDist <= (isGunfireTrace ? 520 : 220))))));
                const withinTether = isFreshGunshot || !isBeyondOverchaseTether(bot, { x: bot.lastHeardSound.x, y: bot.lastHeardSound.y });
                const minSoundAge = (bot.team === "T" && isGunfireTrace) ? 0.08 : 0.18;

                if (soundAge >= minSoundAge && soundAge < 3.2 && canHearThroughWall && tCanInvestigate && withinTether) {
                    goalPriority = 55;
                    bot.isPatrolling = false;
                    bot.isFollowingPlanRoute = false;
                    const threatX = bot.lastHeardSound.x;
                    const threatY = bot.lastHeardSound.y;
                    const shooter = bot.lastHeardSound.shooter;

                    destinationPos = { x: threatX, y: threatY };
                    let lookAng = null;

                    if (!getMapLineOfSight(bot.x, bot.y, threatX, threatY)) {
                        const wep = bot.getWeapon();
                        const prefireApex = getCornerPeekPrefireTarget(
                            bot, threatX, threatY,
                            (isGunfireTrace && shooter) ? (shooter.vx || 0) : 0,
                            (isGunfireTrace && shooter) ? (shooter.vy || 0) : 0
                        );
                        if (bot.getEquippedKey() === "AWP") {
                            const canWallbang = canBulletPenetrateTo(bot.x, bot.y, threatX, threatY, wep.piercingPower);
                            const blindTarget = (prefireApex && soundAge < 1.35)
                                ? prefireApex
                                : ((canWallbang && soundAge < 0.95) ? { x: threatX, y: threatY } : null);

                            if (!isUnarmedC4Carrier && blindTarget && isGunfireTrace && bot.getCurrentClip() > 2 && (bot.awpBlindShotCooldown || 0) <= 0) {
                                wantsToHoldPosition = true;
                                bot.isScoped = true;
                                bot.scopeLevel = 1;
                                lookAng = Math.atan2(blindTarget.y - bot.y, blindTarget.x - bot.x);
                                if (Math.abs(normalizeAngle(lookAng - bot.angle)) < 0.08 && Math.hypot(bot.vx || 0, bot.vy || 0) < 35) {
                                    performAttack(bot, blindTarget.x, blindTarget.y, false);
                                    bot.awpBlindShotCooldown = 2.8;
                                }
                            } else if (prefireApex && soundAge < 1.8) {
                                lookAng = Math.atan2(prefireApex.y - bot.y, prefireApex.x - bot.x);
                            }
                        } else if (prefireApex && soundAge < 1.8) {
                            lookAng = Math.atan2(prefireApex.y - bot.y, prefireApex.x - bot.x);
                            if (!isUnarmedC4Carrier && isGunfireTrace && wep.category !== "sniper" &&
                                Math.abs(normalizeAngle(lookAng - bot.angle)) < 0.20 && bot.getCurrentClip() > 0) {
                                performAttack(bot, prefireApex.x, prefireApex.y, false);
                            }
                        }
                    } else {
                        lookAng = Math.atan2(threatY - bot.y, threatX - bot.x);
                    }

                    bot.macroGoal = { type: "SOUND", x: threatX, y: threatY, lookAngle: lookAng, until: world.gameTime + 1.0 };
                    desiredLookAngle = lookAng;
                }
            }
        }
    }

    // 6G. Default Team Execution / Site Defense & Patrol
    if (!destinationPos && bot.team === "T") {
        bot.isPatrolling = false;
        const activeStrat = T_STRATEGIES[world.currentTStrategyKey];
        const baseRoute = (bot.squadGroup === "ALPHA" || bot.archetype === "ENTRY") ? activeStrat.carrierRoute : activeStrat.supportRoute;

        // Interchangeable Top / Mid / Bottom Maze rerouting (starts at West Maze Plaza x=900 for clean Bottom Maze entry)
        const inMazeBounds = activeStrat.targetSite === "B" &&
            bot.x >= 900 && bot.x <= 2060 &&
            bot.y >= 1455 && bot.y <= 1940;

        if (inMazeBounds) {
            const MAZE_LANE_ROUTES = {
                TOP: [
                    { x: 1350, y: 1520 }, { x: 1665, y: 1525 }, { x: 1910, y: 1485 },
                    { x: 1915, y: 1561 }, { x: 2040, y: 1561 }, { x: 2165, y: 1561 }, { x: 2280, y: 1820 }
                ],
                MID: [
                    { x: 1350, y: 1715 }, { x: 1665, y: 1715 }, { x: 1880, y: 1712 },
                    { x: 2050, y: 1712 }, { x: 2165, y: 1715 }, { x: 2280, y: 1820 }
                ],
                BOTTOM: [
                    { x: 1350, y: 1900 }, { x: 1665, y: 1877 }, { x: 1880, y: 1877 },
                    { x: 2050, y: 1877 }, { x: 2145, y: 1877 }, { x: 2280, y: 1820 }
                ]
            };

            const currentLaneKey = bot.y < 1615 ? "TOP" : (bot.y < 1790 ? "MID" : "BOTTOM");
            const activeLaneRoute = bot.customMazeRoute || baseRoute;
            const lookAheadPts = activeLaneRoute.slice(Math.max(0, bot.planIndex || 0), (bot.planIndex || 0) + 3);

            const laneBlockedByFire = lookAheadPts.some(pt =>
                world.firePatches.some(f => f.life > 0.45 && Math.hypot(pt.x - f.x, pt.y - f.y) < (f.radius + 32) && getMapLineOfSight(f.x, f.y, pt.x, pt.y))
            );
            const laneBlockedBySmoke = lookAheadPts.some(pt => isInsideSmoke(pt.x, pt.y, 18));
            const laneHasRecentDeath = lookAheadPts.some(pt =>
                (world.tacticalIntel?.deathZones?.T || []).some(dz => !dz.cleared && world.gameTime < dz.expiresAt && Math.hypot(pt.x - dz.x, pt.y - dz.y) < 115)
            );
            const laneCongested = world.livingT.filter(m =>
                m && m !== bot && !m.isDead &&
                Math.hypot(m.x - bot.x, m.y - bot.y) < 145 &&
                Math.abs(m.y - bot.y) < 55 &&
                m.x > bot.x
            ).length >= 2;

            const wantsEarlyBottomShift = bot.x < 1350 &&
                currentLaneKey !== "BOTTOM" &&
                (bot.hasC4 || bot.squadGroup === "ALPHA" || rnd() < 0.65);

            if ((laneBlockedByFire || laneBlockedBySmoke || laneHasRecentDeath || laneCongested || wantsEarlyBottomShift) &&
                world.gameTime >= (bot.mazeRerouteCooldown || 0)) {
                const candidateKeys = ["BOTTOM", "MID", "TOP"].filter(k => k !== currentLaneKey);
                let bestLane = null;
                let bestScore = -Infinity;

                for (let i = 0; i < candidateKeys.length; i++) {
                    const key = candidateKeys[i];
                    const candPts = MAZE_LANE_ROUTES[key];
                    const exitPt = candPts[candPts.length - 3];
                    let score = (rnd() - 0.5) * 30;

                    const alliesInLane = world.livingT.filter(m => m && m !== bot && !m.isDead && Math.abs(m.y - exitPt.y) < 60 && m.x >= 1100 && m.x <= 2120).length;
                    if (key === "BOTTOM" && alliesInLane < 3) {
                        score += (bot.hasC4 || bot.squadGroup === "ALPHA") ? 95 : 65;
                    }

                    if (candPts.some(pt => world.firePatches.some(f => f.life > 0.45 && Math.hypot(pt.x - f.x, pt.y - f.y) < (f.radius + 32)))) {
                        score -= 500;
                    }
                    if (candPts.some(pt => isInsideSmoke(pt.x, pt.y, 18))) {
                        score -= 220;
                    }
                    if (candPts.some(pt => (world.tacticalIntel?.deathZones?.T || []).some(dz => !dz.cleared && world.gameTime < dz.expiresAt && Math.hypot(pt.x - dz.x, pt.y - dz.y) < 115))) {
                        score -= 260;
                    }
                    score -= alliesInLane * 65;

                    if (score > bestScore) {
                        bestScore = score;
                        bestLane = candPts;
                    }
                }

                if (bestLane && bestScore > -250) {
                    let connectorWp;
                    let filterMinX;
                    if (bot.x < 1350) {
                        connectorWp = { x: 1120, y: bestLane[0].y };
                        filterMinX = 1120;
                    } else if (bot.x <= 1710) {
                        connectorWp = { x: 1665, y: bestLane[1].y };
                        filterMinX = 1665;
                    } else {
                        connectorWp = { x: 1885, y: bestLane[2].y };
                        filterMinX = 1885;
                    }
                    const remainingLane = bestLane.filter(pt => pt.x >= filterMinX);

                    bot.customMazeRoute = [connectorWp, ...remainingLane];
                    bot.planIndex = 0;
                    bot.maxPlanIndex = 0;
                    bot.currentPath = [];
                    bot.mazeRerouteCooldown = world.gameTime + 2.8;
                }
            }
        } else if (!inMazeBounds && bot.customMazeRoute && bot.x > 2060) {
            bot.customMazeRoute = null;
        }

        // Interchangeable A Long <-> A Short rerouting through the wall gap (1280, 445)
        const inAGapZone = activeStrat.targetSite === "A" &&
            bot.x >= 820 && bot.x <= 1465 &&
            bot.y >= 90 && bot.y <= 600;

        if (inAGapZone) {
            const A_LANE_ROUTES = {
                LONG: [
                    { x: 1280, y: 220 }, { x: 1410, y: 180 }, { x: 1600, y: 180 }, { x: 2050, y: 135 }
                ],
                SHORT: [
                    { x: 1350, y: 545 }, { x: 1715, y: 542 }, { x: 2038, y: 450 }, { x: 2050, y: 135 }
                ]
            };

            const currentALane = bot.y < 420 ? "LONG" : "SHORT";
            const activeARoute = bot.customALaneRoute || bot.customMazeRoute || baseRoute;
            const lookAheadPts = activeARoute.slice(Math.max(0, bot.planIndex || 0), (bot.planIndex || 0) + 3);

            const aLaneBlockedByFire = lookAheadPts.some(pt =>
                world.firePatches.some(f => f.life > 0.45 && Math.hypot(pt.x - f.x, pt.y - f.y) < (f.radius + 32) && getMapLineOfSight(f.x, f.y, pt.x, pt.y))
            );
            const aLaneBlockedBySmoke = lookAheadPts.some(pt => isInsideSmoke(pt.x, pt.y, 18));
            const aLaneHasRecentDeath = lookAheadPts.some(pt =>
                (world.tacticalIntel?.deathZones?.T || []).some(dz => !dz.cleared && world.gameTime < dz.expiresAt && Math.hypot(pt.x - dz.x, pt.y - dz.y) < 115)
            );
            const aLaneCongested = world.livingT.filter(m =>
                m && m !== bot && !m.isDead &&
                Math.hypot(m.x - bot.x, m.y - bot.y) < 150 &&
                Math.abs(m.y - bot.y) < 75 &&
                m.x > bot.x
            ).length >= 2;

            if ((aLaneBlockedByFire || aLaneBlockedBySmoke || aLaneHasRecentDeath || aLaneCongested) &&
                world.gameTime >= (bot.aLaneRerouteCooldown || 0)) {
                const altLaneKey = currentALane === "LONG" ? "SHORT" : "LONG";
                const altPts = A_LANE_ROUTES[altLaneKey];

                const altHasFire = altPts.some(pt =>
                    world.firePatches.some(f => f.life > 0.45 && Math.hypot(pt.x - f.x, pt.y - f.y) < (f.radius + 32))
                );
                const altHasDeath = altPts.some(pt =>
                    (world.tacticalIntel?.deathZones?.T || []).some(dz => !dz.cleared && world.gameTime < dz.expiresAt && Math.hypot(pt.x - dz.x, pt.y - dz.y) < 115)
                );

                if (!altHasFire && !altHasDeath) {
                    bot.customALaneRoute = [{ x: 1280, y: 445 }, ...altPts];
                    bot.planIndex = 0;
                    bot.maxPlanIndex = 0;
                    bot.currentPath = [];
                    bot.aLaneRerouteCooldown = world.gameTime + 3.0;
                }
            }
        } else if (!inAGapZone && bot.customALaneRoute && bot.x > 1650) {
            bot.customALaneRoute = null;
        }

        const planPath = bot.customALaneRoute || bot.customMazeRoute || baseRoute;

        if (bot.planIndex === undefined || bot.planIndex === null || bot.planIndex >= planPath.length) {
            bot.planIndex = getClosestRouteIndex(bot.x, bot.y, planPath);
        }
        if (bot.maxPlanIndex === undefined) bot.maxPlanIndex = bot.planIndex;
        bot.planIndex = Math.min(planPath.length - 1, Math.max(bot.planIndex, bot.maxPlanIndex));

        // Advance past waypoints that are reached OR covered by active Molotov flames so bots skirt right past
        const currentTargetPt = planPath[bot.planIndex];
        const wpInsideFire = currentTargetPt && world.firePatches.some(f =>
            f.life > 0.45 && Math.hypot(currentTargetPt.x - f.x, currentTargetPt.y - f.y) < (f.radius + 26)
        );
        if (currentTargetPt && (Math.hypot(currentTargetPt.x - bot.x, currentTargetPt.y - bot.y) < 75 || wpInsideFire) && bot.planIndex < planPath.length - 1) {
            bot.planIndex++;
            bot.maxPlanIndex = Math.max(bot.maxPlanIndex, bot.planIndex);
        }

        const targetSiteRect = activeStrat.targetSite === "B" ? MAP.siteB : MAP.siteA;
        const siteReadyForPlant = isTReadyToPlantAtSite(activeStrat.targetSite);
        const isClockUrgentCommit = matchState.roundTimer <= 38.0 || world.livingT.length <= 2;
        if (!pincerState.breachInitiated && (siteReadyForPlant || isClockUrgentCommit)) {
            pincerState.breachInitiated = true;
        }

        if (bot.hasC4 && !c4State.isPlanted && siteReadyForPlant) {
            bot.isFollowingPlanRoute = false;
            bot.isPatrolling = false;
            destinationPos = { x: targetSiteRect.safeSpot.x, y: targetSiteRect.safeSpot.y };
            bot.forwardProgressAngle = Math.atan2(destinationPos.y - bot.y, destinationPos.x - bot.x);
            steerBotToDestination(bot, destinationPos.x, destinationPos.y, 195, dt, { stopRadius: 10, autoAim: false });
            updateBotHeadOrientation(bot, null, bot.isMoving, false, dt);
            return;
        }

        const isSplitStrat = Boolean(activeStrat.isSplit);
        const alphaAlive = world.livingT.some(t => t && t.isBot && !t.isDead && t.squadGroup === "ALPHA");
        const bravoAlive = world.livingT.some(t => t && t.isBot && !t.isDead && t.squadGroup === "BRAVO");
        const anyTNearSite = world.livingT.some(t =>
            t && !t.isDead && Math.hypot(targetSiteRect.safeSpot.x - t.x, targetSiteRect.safeSpot.y - t.y) < 560
        );
        if (isSplitStrat && !pincerState.breachInitiated && (!alphaAlive || !bravoAlive || anyTNearSite || roundElapsed >= 14.0)) {
            pincerState.breachInitiated = true;
        }

        const stagePt = (isSplitStrat && planPath.length > 1 && (bot.planIndex || 0) <= 1) ? planPath[1] : null;
        const atStagePoint = !isClockUrgentCommit && !fastExecuteMode && stagePt && Math.hypot(stagePt.x - bot.x, stagePt.y - bot.y) < 85;

        if (atStagePoint && !pincerState.breachInitiated) {
            if (bot.squadGroup === "ALPHA") pincerState.alphaStaged = true;
            if (bot.squadGroup === "BRAVO") pincerState.bravoStaged = true;
            pincerState.stagingTimer += dt;
            if ((pincerState.alphaStaged && pincerState.bravoStaged) || pincerState.stagingTimer > 0.9) {
                pincerState.breachInitiated = true;
            }
        }

        const carrierDistToSite = activeCarrier
            ? Math.hypot(targetSiteRect.safeSpot.x - activeCarrier.x, targetSiteRect.safeSpot.y - activeCarrier.y)
            : Infinity;
        const botDistToSite = Math.hypot(targetSiteRect.safeSpot.x - bot.x, targetSiteRect.safeSpot.y - bot.y);
        const escortBehindCarrier = Boolean(isCarrierEscort && activeCarrier && botDistToSite > carrierDistToSite + 150);

        const nextWatchPt = planPath[Math.min(planPath.length - 1, (bot.planIndex || 0) + 1)] || targetSiteRect.safeSpot;
        const isHardRushing = bot.hasC4 ||
            isClockUrgentCommit ||
            fastExecuteMode ||
            siteReadyForPlant ||
            escortBehindCarrier ||
            isInsideExpandedSite(bot.x, bot.y, targetSiteRect) ||
            bot.smokePushCommitted ||
            isInsideSmoke(bot.x, bot.y, 16);

        if (atStagePoint && !pincerState.breachInitiated) {
            const stagePeek = updateTAttackCornerPeek(bot, nextWatchPt, true, dt);
            if (stagePeek) {
                destinationPos = stagePeek.dest;
                desiredLookAngle = stagePeek.lookAngle;
                wantsToHoldPosition = false;
                if (bot.getEquippedKey() === "AWP" && stagePeek.isPeeking && hasAWPScopeLineClearance(bot, stagePeek.lookAngle)) {
                    bot.isScoped = true;
                    bot.scopeLevel = 1;
                }
            } else {
                const waitPatrol = getTWaitingPatrolPlan(bot, stagePt, dt);
                destinationPos = waitPatrol.dest;
                desiredLookAngle = waitPatrol.lookAngle;
                wantsToHoldPosition = false;
            }
            bot.isFollowingPlanRoute = true;
        } else {
            const routeFinished = bot.planIndex >= planPath.length - 1;
            const targetPt = planPath[bot.planIndex];
            const distToFinal = targetPt ? Math.hypot(targetPt.x - bot.x, targetPt.y - bot.y) : Infinity;

            if (routeFinished && distToFinal < 75 && !bot.hasC4) {
                if (c4State.isDropped) {
                    bot.isFollowingPlanRoute = false;
                    bot.isPatrolling = false;
                    destinationPos = snapToWalkablePos(c4State.dropX, c4State.dropY, bot.radius);
                } else {
                    bot.isFollowingPlanRoute = false;
                    const siteKey = activeStrat.targetSite === "B" ? "B" : "A";
                    const holdAngles = T_SITE_HOLD_ANGLES[siteKey] || [];
                    const siteTs = world.livingT.filter(t => t && !t.isDead && !t.hasC4);
                    const slotIdx = Math.max(0, siteTs.indexOf(bot));

                    if (holdAngles.length > 0) {
                        const slot = holdAngles[slotIdx % holdAngles.length];
                        const hugPt = snapToWallHugPos(slot.x, slot.y, bot.radius, 1.8);
                        const distHug = Math.hypot(hugPt.x - bot.x, hugPt.y - bot.y);

                        bot.isPatrolling = false;
                        bot.isWallHuggingHold = true;
                        destinationPos = hugPt;
                        desiredLookAngle = Math.atan2(slot.watchY - hugPt.y, slot.watchX - hugPt.x);
                        if (distHug <= 36) {
                            bot.isHoldingCrossfire = true;
                            if (bot.getEquippedKey() === "AWP") {
                                wantsToHoldPosition = true;
                                if (hasAWPScopeLineClearance(bot, desiredLookAngle)) {
                                    bot.isScoped = true;
                                    bot.scopeLevel = 1;
                                }
                            } else {
                                bot.isADPeeking = true;
                                destinationPos = getDefenseADStrafeDest(bot, hugPt, desiredLookAngle, dt, 26);
                            }
                        }
                    } else {
                        bot.isPatrolling = true;
                        destinationPos = getSitePatrolDestination(bot, siteKey);
                        const suspiciousSpot = getRelevantSuspiciousSpot(bot);
                        if (suspiciousSpot) {
                            desiredLookAngle = Math.atan2(suspiciousSpot.y - bot.y, suspiciousSpot.x - bot.x);
                        } else {
                            const moveAngle = Math.atan2(destinationPos.y - bot.y, destinationPos.x - bot.x);
                            updatePatrolVision(bot, moveAngle, dt);
                            desiredLookAngle = bot.angle;
                        }
                    }
                }
            } else if (targetPt) {
                const cornerPeekPlan = !isHardRushing ? updateTAttackCornerPeek(bot, targetPt, false, dt) : null;
                if (cornerPeekPlan) {
                    destinationPos = cornerPeekPlan.dest;
                    desiredLookAngle = cornerPeekPlan.lookAngle;
                    wantsToHoldPosition = cornerPeekPlan.hold;
                    bot.isFollowingPlanRoute = false;
                    if (bot.getEquippedKey() === "AWP" && cornerPeekPlan.isPeeking && hasAWPScopeLineClearance(bot, cornerPeekPlan.lookAngle)) {
                        bot.isScoped = true;
                        bot.scopeLevel = 1;
                    } else if (cornerPeekPlan.shouldBurstFire && cornerPeekPlan.burstFocusPos &&
                        !isUnarmedC4Carrier && !bot.isSilentWalking && roundElapsed >= 3.5) {
                        const wep = bot.getWeapon();
                        const bTarget = cornerPeekPlan.burstFocusPos;
                        const hasSight = getMapLineOfSight(bot.x, bot.y, bTarget.x, bTarget.y);
                        const canPenetrate = canBulletPenetrateTo(bot.x, bot.y, bTarget.x, bTarget.y, wep.piercingPower);
                        if (wep.category !== "sniper" && wep.category !== "knife" && wep.category !== "grenade" &&
                            bot.getCurrentClip() > 6 &&
                            Math.abs(normalizeAngle(cornerPeekPlan.lookAngle - bot.angle)) < 0.18 &&
                            (hasSight || canPenetrate)) {
                            const clipBefore = bot.getCurrentClip();
                            bot.isPrefiringProbe = true;
                            performAttack(bot, bTarget.x, bTarget.y, false);
                            bot.isPrefiringProbe = false;
                            if (bot.getCurrentClip() < clipBefore && bot.tAttackPeekState) {
                                bot.tAttackPeekState.burstShotsDone++;
                            }
                        }
                    }
                } else {
                    destinationPos = getSpreadAttackWaypoint(bot, targetPt, bot.planIndex >= planPath.length - 2);
                    bot.isFollowingPlanRoute = true;

                    // Patrol nearby angles while waiting for a bot C4 carrier to catch up (never freeze)
                    const carrierAdvancing = activeCarrier && activeCarrier.isBot && Math.hypot(activeCarrier.vx || 0, activeCarrier.vy || 0) > 35;
                    if (!isClockUrgentCommit && matchState.roundTimer > 20.0 &&
                        isCarrierEscort && carrierAdvancing && !siteReadyForPlant && !fastExecuteMode &&
                        botDistToSite <= 340 &&
                        !isInsideExpandedSite(bot.x, bot.y, targetSiteRect) &&
                        botDistToSite + 260 < carrierDistToSite &&
                        (bot.escortWaitTimer || 0) < 2.2) {
                        bot.escortWaitTimer = (bot.escortWaitTimer || 0) + dt;
                        const escortPatrol = getTWaitingPatrolPlan(bot, targetPt, dt);
                        destinationPos = escortPatrol.dest;
                        desiredLookAngle = escortPatrol.lookAngle;
                        wantsToHoldPosition = false;
                    }

                    // Opening bait/probe fire (3.5s-13.5s) at chokes & hotzones to draw CT footsteps and utility before committing
                    const isOpeningBaitWindow = !fastExecuteMode && roundElapsed >= 3.5 && roundElapsed <= 13.5 &&
                        bot.planIndex >= 1 && bot.planIndex <= 3 && !bot.hasC4;
                    const advanceHotspot = (!bot.isSilentWalking && roundElapsed >= 3.5)
                        ? (getTacticalBlackboardThreat(bot) || getRelevantSuspiciousSpot(bot) || (isOpeningBaitWindow ? nextWatchPt : null))
                        : null;

                    if (advanceHotspot &&
                        !isSectorRecentlyCleared("T", advanceHotspot.x, advanceHotspot.y, 120) &&
                        Math.hypot(advanceHotspot.x - bot.x, advanceHotspot.y - bot.y) <= 460) {
                        const hotAng = Math.atan2(advanceHotspot.y - bot.y, advanceHotspot.x - bot.x);
                        desiredLookAngle = hotAng;

                        const wep = bot.getWeapon();
                        const hasDirectLOS = getMapLineOfSight(bot.x, bot.y, advanceHotspot.x, advanceHotspot.y);
                        const canPenetrate = canBulletPenetrateTo(bot.x, bot.y, advanceHotspot.x, advanceHotspot.y, wep.piercingPower);
                        const probeCadence = isOpeningBaitWindow ? 1.6 : 2.2;

                        if (wep.category !== "sniper" && wep.category !== "knife" && wep.category !== "grenade" &&
                            bot.getCurrentClip() > 8 && (world.gameTime - (bot.lastPrefireTime || -99)) >= probeCadence &&
                            Math.abs(normalizeAngle(hotAng - bot.angle)) < 0.18 &&
                            (hasDirectLOS || canPenetrate)) {
                            bot.isPrefiringProbe = true;
                            performAttack(bot, advanceHotspot.x, advanceHotspot.y, false);
                            bot.isPrefiringProbe = false;
                            bot.lastPrefireTime = world.gameTime;
                        }
                    } else if (desiredLookAngle === null) {
                        desiredLookAngle = getForwardCornerPreAimAngle(bot, destinationPos.x, destinationPos.y);
                    }
                }
            }
        }
    } else if (!destinationPos && bot.team === "CT") {
        bot.isFollowingPlanRoute = false;
        const activeStrat = bot.assignedCTStrat || CT_STRATEGIES["PATROL_A"];
        const route = activeStrat.route;

        const ctInfoPlan = (bot.hasReachedAssignedSite || bot.planIndex >= route.length)
            ? updateCTActiveInfoCheck(bot, activeStrat.site, roundElapsed, dt)
            : null;

        if (ctInfoPlan) {
            destinationPos = ctInfoPlan.dest;
            desiredLookAngle = ctInfoPlan.lookAngle;
            wantsToHoldPosition = ctInfoPlan.hold;
            bot.isHoldingCrossfire = false;
            bot.isPatrolling = false;
            bot.isCrouching = false;
        } else if (activeStrat.site === "MID" && bot.assignedMidSpot) {
            const midSpot = snapToWalkablePos(bot.assignedMidSpot.x, bot.assignedMidSpot.y, bot.radius + 4);
            const distToMidSpot = Math.hypot(midSpot.x - bot.x, midSpot.y - bot.y);
            bot.isPatrolling = false;
            bot.isCrouching = false;

            if (distToMidSpot > 45) {
                destinationPos = midSpot;
                desiredLookAngle = Math.atan2(midSpot.y - bot.y, midSpot.x - bot.x);
                bot.isHoldingCrossfire = false;
            } else {
                bot.hasReachedAssignedSite = true;
                bot.isHoldingCrossfire = true;
                const clearGaze = getActiveGazeHoldAngle(bot);
                const susSpot = getRelevantSuspiciousSpot(bot);
                desiredLookAngle = clearGaze ??
                    (susSpot ? Math.atan2(susSpot.y - bot.y, susSpot.x - bot.x) : normalizeAngle(bot.assignedMidSpot.angle));
                if (bot.getEquippedKey() === "AWP") {
                    wantsToHoldPosition = true;
                    destinationPos = midSpot;
                    if (hasAWPScopeLineClearance(bot, desiredLookAngle)) {
                        bot.isScoped = true;
                        bot.scopeLevel = 1;
                    }
                } else {
                    bot.isADPeeking = true;
                    destinationPos = getDefenseADStrafeDest(bot, midSpot, desiredLookAngle, dt, 30);
                }
            }
        } else if (activeStrat.site === "MID") {
            let controlZoneKey = "MID";
            if (roundElapsed >= 20.0) {
                const aActivity = Object.values(world.sharedEnemyIntelCT).some(i => i && !i.enemy.isDead && i.x > 1650 && i.y < 700);
                const bActivity = Object.values(world.sharedEnemyIntelCT).some(i => i && !i.enemy.isDead && i.x > 1750 && i.y > 1250);
                if (aActivity && !bActivity) controlZoneKey = "A";
                else if (bActivity && !aActivity) controlZoneKey = "B";
            }

            const areaPlan = updateAreaControlZone(bot, controlZoneKey, dt);
            if (areaPlan) {
                destinationPos = areaPlan.dest;
                desiredLookAngle = areaPlan.lookAngle;
                wantsToHoldPosition = areaPlan.hold;
                bot.isHoldingCrossfire = areaPlan.hold;
                bot.isPatrolling = false;
                bot.hasReachedAssignedSite = true;
                bot.isCrouching = false;
                if (bot.getEquippedKey() === "AWP" && areaPlan.hold && hasAWPScopeLineClearance(bot, areaPlan.lookAngle)) {
                    bot.isScoped = true;
                    bot.scopeLevel = 1;
                }
            }
        } else if (bot.planIndex < route.length) {
            bot.isFollowingPlanRoute = true;
            bot.isPatrolling = false;
            bot.isHoldingCrossfire = false;
            const targetPt = route[bot.planIndex];
            if (targetPt) {
                destinationPos = { x: targetPt.x, y: targetPt.y };
                if (Math.hypot(targetPt.x - bot.x, targetPt.y - bot.y) < 65) {
                    bot.planIndex++;
                }

                if (bot.planIndex >= route.length - 1 && roundElapsed < 14.0) {
                    const trailingPartner = world.livingCT.find(m =>
                        m && m !== bot && !m.isDead &&
                        m.assignedCTStrat?.site === activeStrat.site &&
                        Math.hypot(m.x - bot.x, m.y - bot.y) > 150 &&
                        Math.hypot(m.x - bot.x, m.y - bot.y) < 380
                    );
                    if (trailingPartner && Math.hypot(targetPt.x - bot.x, targetPt.y - bot.y) < 75) {
                        const paceAng = bot.angle + ((bot.counterStrafeDir || 1) * Math.PI / 2);
                        destinationPos = snapToWalkablePos(
                            targetPt.x + Math.cos(paceAng) * 55,
                            targetPt.y + Math.sin(paceAng) * 55,
                            bot.radius + 4
                        );
                        if (Math.hypot(destinationPos.x - bot.x, destinationPos.y - bot.y) <= 18) {
                            bot.counterStrafeDir = -(bot.counterStrafeDir || 1);
                        }
                    }
                }
            }
        } else if ((activeStrat.site === "A" || activeStrat.site === "B") && !bot.isAggroPushing && !bot.isRoamingPatrol) {
            bot.isADPeeking = false;
            const siteAreaPlan = updateAreaControlZone(bot, activeStrat.site, dt);
            if (siteAreaPlan) {
                destinationPos = siteAreaPlan.dest;
                desiredLookAngle = siteAreaPlan.lookAngle;
                wantsToHoldPosition = siteAreaPlan.hold;
                bot.isHoldingCrossfire = siteAreaPlan.hold;
                bot.isADPeeking = Boolean(siteAreaPlan.isADPeeking);
                bot.isPatrolling = false;
                bot.isCrouching = false;
                if (bot.getEquippedKey() === "AWP" && siteAreaPlan.hold && hasAWPScopeLineClearance(bot, siteAreaPlan.lookAngle)) {
                    bot.isScoped = true;
                    bot.scopeLevel = 1;
                }
            }
        } else {
            bot.isADPeeking = false;
            const baseSpot = bot.assignedDefenseSpot;
            const hasRecentAcoustic = bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 3.5);
           const isEcoRound = !bot.primaryKey || bot.primaryKey === "MP5" || bot.primaryKey === "VECTOR";
            const isManDown = world.livingCT.length < world.livingT.length && world.livingCT.length >= 2;
            const anotherCTAlreadyPushing = world.livingCT.some(m => m && m !== bot && !m.isDead && m.isAggroPushing);

            if (!bot.isAggroPushing && !bot.aggroPushCompleted && !anotherCTAlreadyPushing && !hasRecentAcoustic && baseSpot &&
                (bot.archetype === "ENTRY" || bot.archetype === "SUPPORT") &&
                ((isManDown && roundElapsed >= 12.0) || (isEcoRound && roundElapsed >= 5.0 && bot.aggroFactor >= 0.65))) {
                const pushAngle = normalizeAngle(baseSpot.angle);
                bot.ctAggroPushTarget = snapToWalkablePos(
                    baseSpot.x + Math.cos(pushAngle) * 440,
                    baseSpot.y + Math.sin(pushAngle) * 440,
                    bot.radius
                );
                bot.isAggroPushing = true;
                bot.isHoldingCrossfire = false;
                bot.isPatrolling = false;

                if (bot.hasFlash && !isNearSpawn(bot.x, bot.y)) {
                    const flashX = bot.x + Math.cos(pushAngle) * 240;
                    const flashY = bot.y + Math.sin(pushAngle) * 240;
                    const flashPlan = solveBotUtilityThrow(bot, "FLASH", flashX, flashY, 110);
                    if (flashPlan && !isUtilityTargetClaimed("CT", flashX, flashY, "FLASH", 260)) {
                        claimUtilityTarget("CT", flashX, flashY, "FLASH", 2.2);
                        executeBotGrenadeThrow(bot, 7, flashPlan.aimX, flashPlan.aimY, flashPlan.isExtended);
                    }
                }
            }

            if (bot.isAggroPushing && bot.ctAggroPushTarget) {
                const distToPush = Math.hypot(bot.ctAggroPushTarget.x - bot.x, bot.ctAggroPushTarget.y - bot.y);
                if (distToPush < 55 || hasRecentAcoustic) {
                    bot.isAggroPushing = false;
                    bot.aggroPushCompleted = true;
                    bot.ctAggroPushTarget = null;
                    bot.isRoamingPatrol = true;
                    bot.roamTimer = 6.0;
                } else {
                    bot.isCrouching = false;
                    destinationPos = bot.ctAggroPushTarget;
                    desiredLookAngle = Math.atan2(bot.ctAggroPushTarget.y - bot.y, bot.ctAggroPushTarget.x - bot.x);
                }
            }

            if (!destinationPos) {
                const dynSpotInFire = bot.dynamicDefensePos && world.firePatches.some(f =>
                    f.life > 0.6 && Math.hypot(f.x - bot.dynamicDefensePos.x, f.y - bot.dynamicDefensePos.y) < (f.radius + 55)
                );
                if (baseSpot && (!bot.dynamicDefensePos || dynSpotInFire || bot.dynamicDefensePos.spotId !== baseSpot.id || bot.lastKillRepositionCount !== (bot.kills || 0))) {
                    bot.dynamicDefensePos = getDynamicCTOffAngle(bot, baseSpot);
                    bot.lastKillRepositionCount = bot.kills || 0;
                    bot.anchorHoldTimer = 0;
                }
                const dynSpot = bot.dynamicDefensePos;
                const distToAnchor = dynSpot ? Math.hypot(dynSpot.x - bot.x, dynSpot.y - bot.y) : Infinity;
                const activeSuspicious = getRelevantSuspiciousSpot(bot);
                const sitePartnerNearby = world.livingCT.some(m =>
                    m && m !== bot && !m.isDead &&
                    m.assignedCTStrat?.site === activeStrat.site &&
                    Math.hypot(m.x - bot.x, m.y - bot.y) < 420
                );
                const isAmbushEligible = dynSpot && (distToAnchor < 85) &&
                    (activeSuspicious !== null || hasRecentAcoustic || sitePartnerNearby || bot.archetype === "AWPER" || bot.archetype === "ANCHOR");

                if (isAmbushEligible && !bot.isRoamingPatrol) {
                    bot.isHoldingCrossfire = true;
                    bot.isPatrolling = false;

                    const isAWPHolder = bot.getEquippedKey() === "AWP";

                    // Clear cues (recent footsteps/gunfire) always outrank suspicious memory spots
                    let targetAim = normalizeAngle(dynSpot.angle);
                    const clearGaze = getActiveGazeHoldAngle(bot);
                    if (clearGaze !== null) targetAim = clearGaze;
                    else if (hasRecentAcoustic) targetAim = Math.atan2(bot.lastHeardSound.y - bot.y, bot.lastHeardSound.x - bot.x);
                    else if (activeSuspicious) targetAim = Math.atan2(activeSuspicious.y - bot.y, activeSuspicious.x - bot.x);
                    desiredLookAngle = targetAim;

                    if (isAWPHolder) {
                        wantsToHoldPosition = true;
                        bot.isCrouching = false;
                        destinationPos = { x: dynSpot.x, y: dynSpot.y };
                    } else {
                        wantsToHoldPosition = false;
                        bot.isCrouching = false;
                        bot.isADPeeking = true;
                        destinationPos = getDefenseADStrafeDest(bot, { x: dynSpot.x, y: dynSpot.y }, targetAim, dt, 32);
                    }

                    if (isAWPHolder && hasAWPScopeLineClearance(bot, targetAim)) {
                        bot.isScoped = true;
                        bot.scopeLevel = 1;
                    }

                    const defaultHoldDur = isAWPHolder ? (11.0 + rnd() * 5.0) : (6.5 + rnd() * 4.0);
                    bot.anchorHoldTimer = (bot.anchorHoldTimer || 0) + dt;
                    if (bot.anchorHoldTimer >= (bot.anchorHoldDuration || defaultHoldDur)) {
                        bot.anchorHoldTimer = 0;
                        bot.anchorHoldDuration = defaultHoldDur;
                        bot.dynamicDefensePos = getDynamicCTOffAngle(bot, baseSpot);
                        bot.isHoldingCrossfire = false;
                    }
                } else {
                    bot.isHoldingCrossfire = false;
                    bot.isPatrolling = true;
                    bot.isCrouching = false;

                    if (bot.isRoamingPatrol) {
                        bot.roamTimer = (bot.roamTimer || 0) - dt;
                        if (bot.roamTimer <= 0) {
                            bot.isRoamingPatrol = false;
                            const isSiteA = activeStrat.site === "A";
                            const candidateSpots = CT_DEFENSE_SPOTS.filter(s => s.site === (isSiteA ? "A" : "B"));
                            if (candidateSpots.length > 0) {
                                bot.assignedDefenseSpot = candidateSpots[Math.floor(rnd() * candidateSpots.length)];
                                bot.dynamicDefensePos = getDynamicCTOffAngle(bot, bot.assignedDefenseSpot);
                            }
                        }
                    }

                    if (activeStrat.site === "MID" && activeStrat.patrolPoints) {
                        const pts = activeStrat.patrolPoints;
                        if (!bot.patrolTargetPt || Math.hypot(bot.patrolTargetPt.x - bot.x, bot.patrolTargetPt.y - bot.y) < 55) {
                            bot.patrolTargetPt = pts[Math.floor(rnd() * pts.length)];
                        }
                        destinationPos = bot.patrolTargetPt;
                    } else {
                        const currentSiteKey = activeStrat.site === "B" ? "B" : "A";
                        destinationPos = getSitePatrolDestination(bot, currentSiteKey);
                    }

                    const moveAngle = Math.atan2(destinationPos.y - bot.y, destinationPos.x - bot.x);
                    updatePatrolVision(bot, moveAngle, dt);
                    desiredLookAngle = bot.angle;
                }
            }
        }
    }

    if (!destinationPos) {
        destinationPos = { x: bot.x, y: bot.y };
        wantsToHoldPosition = true;
    }

    // Relocate destination past the far side of active Molotov flames without turning backward to stare at the fire
    if (world.firePatches.length > 0 && !isBombImminent && !bot.isDefusing) {
        const goalFire = world.firePatches.find(f =>
            f.life > 0.6 && Math.hypot(f.x - destinationPos.x, f.y - destinationPos.y) < (f.radius + bot.radius + 12)
        );
        if (goalFire) {
            const passAng = (bot.team === "T" && !c4State.isPlanted)
                ? Math.atan2(
                    (bot.assignedSite === "B" ? MAP.siteB.safeSpot.y : MAP.siteA.safeSpot.y) - goalFire.y,
                    (bot.assignedSite === "B" ? MAP.siteB.safeSpot.x : MAP.siteA.safeSpot.x) - goalFire.x
                )
                : Math.atan2(bot.y - goalFire.y, bot.x - goalFire.x);
            destinationPos = snapToWalkablePos(
                goalFire.x + Math.cos(passAng) * (goalFire.radius + bot.radius + 24),
                goalFire.y + Math.sin(passAng) * (goalFire.radius + bot.radius + 24),
                bot.radius
            );
            wantsToHoldPosition = false;
        }
    }

    // Hysteresis-locked smoke hold: smooth A-D-A-D counter-strafing, rear shoulder-checks, or clean route pivot
    const rawEnclosingSmoke = world.smokeClouds.find(c =>
        c.life > 0.35 && Math.hypot(bot.x - c.x, bot.y - c.y) <= (c.radius + 12)
    );
    const enclosingCluster = rawEnclosingSmoke ? getConnectedSmokeCluster(rawEnclosingSmoke) : null;
    const isActivelyDefusingOrPlanting = bot.isDefusing ||
        bot.executePhase === "PLANT_LOCK" ||
        (bot.team === "CT" && c4State.isPlanted && (ctTactic === "DEFUSE_BOMB" || ctTactic === "FAKE_DEFUSE" || ctTactic === "STICK_DEFUSE"));

   const smokeClusterForControl = bot.activeBlockingSmoke || enclosingCluster;
    const isTUrgentCommit = bot.team === "T" && !c4State.isPlanted &&
        (matchState.roundTimer <= 20.0 || world.livingT.length <= 3 || roundElapsed >= 14.0);
    const isTInGardenArea = bot.team === "T" && bot.x < 760 && bot.y > 460;
    const canPushThroughSmoke = hasManAdvantage ||
        isTUrgentCommit ||
        isTInGardenArea ||
        bot.smokePushCommitted ||
        fastExecuteMode ||
        bot.hasC4 ||
        isTSquadOccupyingSite(tTargetSiteKey) ||
        isStrictlyInsideSite(bot.x, bot.y, tTargetSiteRect) ||
        isActivelyDefusingOrPlanting;

    const smokeHoldPlan = updateSmokeHoldController(bot, smokeClusterForControl, destinationPos, {
        canPushThrough: canPushThroughSmoke,
        isFriendlyOrCleared: isFriendlyOrClearedSmoke,
        hasHigherPriorityCue,
        roundElapsed,
        isUnarmedC4Carrier
    }, dt);

    if (smokeHoldPlan && !wantsToHoldPosition) {
        if (bot.team === "T" && !c4State.isPlanted && !isTClockUnder20s) {
            const smokePatrol = getTWaitingPatrolPlan(bot, smokeHoldPlan.dest, dt);
            destinationPos = smokePatrol.dest;
            desiredLookAngle = smokePatrol.lookAngle;
            wantsToHoldPosition = false;
        } else {
            destinationPos = smokeHoldPlan.dest;
            wantsToHoldPosition = smokeHoldPlan.hold;
            if (smokeHoldPlan.isADPeeking) {
                bot.isADPeeking = true;
                bot.isHoldingCrossfire = true;
                bot.isSilentWalking = false;
            }
            if (desiredLookAngle === null && getActiveGazeHoldAngle(bot) === null && !activeSuspicious) {
                desiredLookAngle = smokeHoldPlan.lookAngle;
            }
        }
    }

    // Anti-freeze safeguard: if a pre-plant T bot would otherwise stand idle waiting before 20s left, patrol nearby cover
    if (bot.team === "T" && !c4State.isPlanted && !isTClockUnder20s && !isTPlantLockdown &&
        bot.executePhase !== "PLANT_LOCK" &&
        (wantsToHoldPosition || Math.hypot(destinationPos.x - bot.x, destinationPos.y - bot.y) <= 18)) {
        const idlePatrol = getTWaitingPatrolPlan(bot, destinationPos, dt);
        destinationPos = idlePatrol.dest;
        desiredLookAngle = idlePatrol.lookAngle;
        wantsToHoldPosition = false;
    }

    // =====================================================================
    // CONTINUOUS BODY EXECUTION
    // =====================================================================
    const immediateStepTarget = (bot.currentPath && bot.currentPath.length > 0)
        ? bot.currentPath[0]
        : destinationPos;
    if (Math.hypot(immediateStepTarget.x - bot.x, immediateStepTarget.y - bot.y) > 16) {
        bot.forwardProgressAngle = Math.atan2(immediateStepTarget.y - bot.y, immediateStepTarget.x - bot.x);
    } else if (Math.hypot(destinationPos.x - bot.x, destinationPos.y - bot.y) > 20) {
        bot.forwardProgressAngle = Math.atan2(destinationPos.y - bot.y, destinationPos.x - bot.x);
    }

    if (!wantsToHoldPosition) {
        for (let bIdx = 0; bIdx < CT_SPAWN_WALL_BYPASSES.length; bIdx++) {
            const wall = CT_SPAWN_WALL_BYPASSES[bIdx];
            if (bot.x >= wall.xMin && bot.x <= wall.xMax &&
                destinationPos.x >= wall.destXMin && destinationPos.x <= wall.destXMax) {
                const botSideA = bot.y <= wall.sideAYMax;
                const botSideB = bot.y >= wall.sideBYMin;
                const goalSideA = destinationPos.y <= wall.sideAYMax;
                const goalSideB = destinationPos.y >= wall.sideBYMin;

                if ((botSideB && goalSideA) || (botSideA && goalSideB)) {
                    const useWestCorner = Math.abs(bot.x - wall.xMin) <= Math.abs(bot.x - wall.midX);
                    const cornerX = useWestCorner ? wall.westCornerX : wall.eastCornerX;
                    const entryY = botSideB ? wall.sideBY : wall.sideAY;
                    const exitY = botSideB ? wall.sideAY : wall.sideBY;

                    destinationPos = Math.abs(bot.x - cornerX) > 28
                        ? { x: cornerX, y: entryY }
                        : { x: cornerX, y: exitY };
                }
            }
        }
    }

    const distToGoal = Math.hypot(destinationPos.x - bot.x, destinationPos.y - bot.y);

    if (bot.team === "T") {
        // Sprint off the planted C4 into cover; walk quietly during subtle post-plant A-D footwork so footsteps don't give away cover
        const hasFreshCue = bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 2.2);
        bot.isSilentWalking = c4State.isPlanted && !c4State.isBeingDefused && !closestEnemy && (distToGoal <= 45 || bot.isADPeeking) && !hasFreshCue;
    } else if (c4State.isPlanted) {
        const isTimeCritical = c4State.timer <= ((bot.hasDefuseKit ? 5.2 : 10.2) + 2.5);
        const targetSite = (c4State.plantSite === "B") ? MAP.siteB : MAP.siteA;
        const inAudiblePerimeter = (distToPlantedC4 <= FOOTSTEP_LISTEN_RADIUS + 30) || isInsideExpandedSite(bot.x, bot.y, targetSite);
        bot.isSilentWalking = !allTerroristsDead && !isTimeCritical && inAudiblePerimeter;
    } else if (bot.isAggroPushing || bot.isADPeeking || bot.isCTInfoPushing) {
        bot.isSilentWalking = false;
    } else if (bot.macroGoal && bot.macroGoal.type === "SUPPORT") {
        const dSupport = Math.hypot(bot.macroGoal.x - bot.x, bot.macroGoal.y - bot.y);
        bot.isSilentWalking = (dSupport <= 320 && dSupport > 160);
    } else if (c4State.isDropped) {
        bot.isSilentWalking = Math.hypot(c4State.dropX - bot.x, c4State.dropY - bot.y) <= 450;
    } else if (bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 3.0)) {
        const dSound = Math.hypot(bot.lastHeardSound.x - bot.x, bot.lastHeardSound.y - bot.y);
        bot.isSilentWalking = (dSound <= FOOTSTEP_LISTEN_RADIUS && dSound > 140);
    } else {
        bot.isSilentWalking = bot.hasReachedAssignedSite && !bot.isPatrolling;
    }

    if (activeSuspicious && Math.hypot(activeSuspicious.x - bot.x, activeSuspicious.y - bot.y) < 280) {
        bot.isSilentWalking = true;
    }

    const standingInAWPLine = isExposedToLongAWPSightline(bot.team, bot.x, bot.y, 2200);
    const nextStepCheck = (bot.currentPath && bot.currentPath.length > 0) ? bot.currentPath[0] : destinationPos;
    const enteringAWPLine = !standingInAWPLine && nextStepCheck &&
        (isExposedToLongAWPSightline(bot.team, nextStepCheck.x, nextStepCheck.y, 2200) ||
            isExposedToLongAWPSightline(bot.team, (bot.x + nextStepCheck.x) * 0.5, (bot.y + nextStepCheck.y) * 0.5, 2200));
    const awpSightlineDanger = standingInAWPLine || enteringAWPLine;

    if (awpSightlineDanger) {
        bot.isSilentWalking = false;
        const hasPostPlantUtilMargin = !c4State.isPlanted || c4State.timer > (bot.hasDefuseKit ? 7.5 : 12.5);

        // Immediately deploy protective smoke/flash across ANY AWP sightline (skip utility throw only if C4 timer is critical)
        if (hasPostPlantUtilMargin && !isBombImminent && !bot.isDefusing && !isUnarmedC4Carrier && bot.getEquippedKey() !== "AWP") {
            if (tryCounterAWPUtility(bot, awpSightlineDanger, true)) {
                brakeBot(bot, dt);
                updateBotHeadOrientation(bot, Math.atan2(awpSightlineDanger.y - bot.y, awpSightlineDanger.x - bot.x), false, true, dt);
                return;
            }
        }

        if (awpSightlineDanger.dist > 780 || c4State.isPlanted) {
            bot.isFastCrossingAWP = true;
            bot.isCrouching = false;
            if (!isBombImminent && !bot.isDefusing && distToGoal > 18) {
                wantsToHoldPosition = false;
            }
        }

        if (desiredLookAngle === null || c4State.isPlanted) {
            desiredLookAngle = Math.atan2(awpSightlineDanger.y - bot.y, awpSightlineDanger.x - bot.x);
        }
    }

    bot.isExitingSmoke = false;

    const enclosingIsFriendlyOrCleared = Boolean(
        enclosingCluster && (
            enclosingCluster.owner === bot ||
            (enclosingCluster.owner && enclosingCluster.owner.team === bot.team && !hasFreshSmokeEnemyCue) ||
            isSectorRecentlyCleared(bot.team, enclosingCluster.x, enclosingCluster.y, 160)
        )
    );

    // Detect clean exit from an enemy/uncleared smoke cluster
    if (enclosingCluster && !enclosingIsFriendlyOrCleared) {
        bot.wasInSmokeCluster = true;
    } else if (bot.wasInSmokeCluster) {
        bot.wasInSmokeCluster = false;
        bot.smokeTraverseCache = null;

        // After passing an enemy smoke: react to sound/intel cues if present, otherwise sweep 180° smoothly over 0.5s
        const hasPostSmokeCue = getActiveGazeHoldAngle(bot) !== null ||
            (bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 2.5));
        if (!hasPostSmokeCue) {
            bot.postSmokeSweepTimer = 0.5;
            bot.postSmokeSweepBaseAngle = bot.angle;
            bot.postSmokeSweepDir = (bot.id % 2 === 0) ? 1 : -1;
        }
    }

    const canTraverseSmoke = canPushThroughSmoke || isTPrePlantFastTrack || enclosingIsFriendlyOrCleared;
    const traversingSmoke = (Boolean(enclosingCluster) && !enclosingIsFriendlyOrCleared) || bot.smokePushCommitted;

    if (traversingSmoke) {
        bot.isSilentWalking = false;
        bot.isCrouching = false;
        if (!isBombImminent) wantsToHoldPosition = false;

        if (enclosingCluster && !isActivelyDefusingOrPlanting) {
            if (canTraverseSmoke) {
                // Push straight through the entire connected smoke cluster to the objective side
                destinationPos = getSmokeClusterThroughExit(bot, enclosingCluster, destinationPos);
            } else if (smokeHoldPlan) {
                // No man advantage: step back out to the locked smoke-hold cover angle
                destinationPos = smokeHoldPlan.dest;
                bot.isExitingSmoke = true;
            }
            if (desiredLookAngle === null && getActiveGazeHoldAngle(bot) === null && !activeSuspicious && distToGoal > 15) {
                desiredLookAngle = Math.atan2(destinationPos.y - bot.y, destinationPos.x - bot.x);
            }
        } else if (desiredLookAngle === null && getActiveGazeHoldAngle(bot) === null) {
            if (activeSuspicious && Math.hypot(activeSuspicious.x - bot.x, activeSuspicious.y - bot.y) < 420) {
                desiredLookAngle = Math.atan2(activeSuspicious.y - bot.y, activeSuspicious.x - bot.x);
            } else if (distToGoal > 15) {
                desiredLookAngle = Math.atan2(destinationPos.y - bot.y, destinationPos.x - bot.x);
            }
        }
    }

    const switchDelay = bot.getWeaponSwitchDelay ? bot.getWeaponSwitchDelay(1) : 0.62;
    const cornerDrawRange = Math.round(210 + switchDelay * 240);
    const cornerDrawRangeSq = cornerDrawRange * cornerDrawRange;
    const goalDrawDist = Math.round(220 + switchDelay * 210);

    const inCombatZone = inAnySiteBox || traversingSmoke || Boolean(awpSightlineDanger) ||
        (bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 3.2));
    const nearThreatCorner = (activeSuspicious !== null && Math.hypot(activeSuspicious.x - bot.x, activeSuspicious.y - bot.y) < cornerDrawRange + 90) ||
        TACTICAL_CORNERS.some(c => {
            const dx = c.x - bot.x;
            const dy = c.y - bot.y;
            return (dx * dx + dy * dy) < cornerDrawRangeSq;
        });

    if (inCombatZone || nearThreatCorner || bot.isDefusing || bot.hasC4 || distToGoal < goalDrawDist || bot.isSilentWalking || wantsToHoldPosition) {
        if (bot.activeSlot === 3) {
            bot.selectSlot(bot.primaryKey ? 1 : (bot.secondaryKey ? 2 : 3));
            bot.knifeLockTimer = 0;
        }
    } else if (distToGoal > goalDrawDist + 130 && bot.knifeLockTimer <= 0 && bot.activeSlot !== 3) {
        bot.selectSlot(3);
        bot.knifeLockTimer = 1.4;
    }

    const goalAngle = Math.atan2(destinationPos.y - bot.y, destinationPos.x - bot.x);
    const isQueueingBehindMate = world.allCharacters.some(other => {
        if (!other || other.isDead || other === bot || other.team !== bot.team) return false;
        const d = Math.hypot(other.x - bot.x, other.y - bot.y);
        if (d >= 75) return false;
        const otherSpeed = Math.hypot(other.vx || 0, other.vy || 0);
        if (otherSpeed < 45) return false;
        const angToOther = Math.atan2(other.y - bot.y, other.x - bot.x);
        return Math.abs(normalizeAngle(angToOther - goalAngle)) < 0.95;
    });

    if (matchState.roundPhase === "COMBAT" && !wantsToHoldPosition && !isQueueingBehindMate && distToGoal > 16) {
        bot.stuckTrackerTimer = (bot.stuckTrackerTimer || 0) + dt;
        if (bot.stuckTrackerTimer >= 0.75) {
            const distMoved = Math.hypot(bot.x - bot.stuckSampleX, bot.y - bot.stuckSampleY);
            if (distMoved < 16) {
                bot.currentPath = [];
                bot.pathRecalcTimer = 0;
                bot.macroGoal = null;
                bot.tAttackPeekState = null;
                bot.tacticalOrder = null;
                wantsToHoldPosition = false;
                // Clear nearby deathZones if a bot stalled oscillating in front of a dead teammate
                const teamDeaths = world.tacticalIntel?.deathZones?.[bot.team];
                if (teamDeaths) {
                    for (let dzIdx = teamDeaths.length - 1; dzIdx >= 0; dzIdx--) {
                        if (Math.hypot(teamDeaths[dzIdx].x - bot.x, teamDeaths[dzIdx].y - bot.y) < 150) {
                            teamDeaths[dzIdx].cleared = true;
                            teamDeaths.splice(dzIdx, 1);
                        }
                    }
                }
                if (bot.isFollowingPlanRoute && bot.planIndex !== undefined && bot.planIndex < 14) {
                    bot.planIndex++;
                    bot.maxPlanIndex = Math.max(bot.maxPlanIndex || 0, bot.planIndex);
                }
                const colNormal = getCollisionNormal(bot.x, bot.y, bot.radius + 6);
                if (colNormal.nx !== 0 || colNormal.ny !== 0) {
                    const nX = colNormal.nx * 12;
                    const nY = colNormal.ny * 12;
                    if (!checkWallCollision(bot.x + nX, bot.y + nY, bot.radius)) {
                        bot.x += nX;
                        bot.y += nY;
                    } else {
                        ejectFromWall(bot);
                    }
                    const toGoalX = Math.cos(goalAngle);
                    const toGoalY = Math.sin(goalAngle);
                    const dotPos = (-colNormal.ny * toGoalX) + (colNormal.nx * toGoalY);
                    const preferredDir = dotPos >= 0 ? 1 : -1;
                    const dirs = [preferredDir, -preferredDir];

                    for (let d = 0; d < dirs.length; d++) {
                        const tanX = -colNormal.ny * dirs[d] * 22;
                        const tanY = colNormal.nx * dirs[d] * 22;
                        if (!checkWallCollision(bot.x + tanX, bot.y + tanY, bot.radius)) {
                            bot.x += tanX;
                            bot.y += tanY;
                            break;
                        }
                    }
                }
            }
            bot.stuckTrackerTimer = 0;
            bot.stuckSampleX = bot.x;
            bot.stuckSampleY = bot.y;
        }
    } else {
        bot.stuckTrackerTimer = 0;
        bot.stuckSampleX = bot.x;
        bot.stuckSampleY = bot.y;
    }

    const isSubtlePostPlantAD = bot.team === "T" && c4State.isPlanted && bot.isADPeeking && !c4State.isBeingDefused;
    const baseSpeed = (traversingSmoke || bot.isFastCrossingAWP)
        ? 205
        : (isSubtlePostPlantAD ? 140 : ((bot.team === "CT" && bot.isPatrolling) ? 165 : 190));
    const travelAng = distToGoal > 8 ? Math.atan2(destinationPos.y - bot.y, destinationPos.x - bot.x) : bot.angle;
    const inNarrowSpace = isTightCorridorAround(bot.x, bot.y, travelAng, bot.radius || TORSO_RADIUS);

    const blockingMate = world.allCharacters.find(other => {
        if (!other || other.isDead || other === bot || other.team !== bot.team) return false;
        const d = Math.hypot(other.x - bot.x, other.y - bot.y);
        if (d > 84) return false;

        const angToOther = Math.atan2(other.y - bot.y, other.x - bot.x);
        const otherSpeed = Math.hypot(other.vx || 0, other.vy || 0);
        const otherMoveAng = otherSpeed > 35 ? Math.atan2(other.vy, other.vx) : travelAng;

        // Allow single-file advances in narrow tunnels without diverting followers
        const otherAdvancingSameWay = otherSpeed > 45 && Math.abs(normalizeAngle(otherMoveAng - travelAng)) < 0.95;
        const inFrontOfMe = distToGoal > 18 && !otherAdvancingSameWay && Math.abs(normalizeAngle(angToOther - travelAng)) < 1.15;
        const otherMovingAtMe = otherSpeed > 35 &&
            Math.abs(normalizeAngle(otherMoveAng - (angToOther + Math.PI))) < 1.15;

        return inFrontOfMe || otherMovingAtMe;
    });

    if (blockingMate && inNarrowSpace) {
        const myScore = getCorridorRightOfWayScore(bot, goalPriority);
        const mateScore = getCorridorRightOfWayScore(blockingMate, 50);

        if (myScore < mateScore) {
            const altPlan = findAlternateExitOrAngle(bot, blockingMate, destinationPos, wantsToHoldPosition);
            if (altPlan) {
                destinationPos = { x: altPlan.x, y: altPlan.y };
                if (altPlan.lookAngle !== null) desiredLookAngle = altPlan.lookAngle;
                wantsToHoldPosition = false;

                if (!altPlan.isHoldShift) {
                    bot.macroGoal = {
                        type: "ALT_ROUTE",
                        x: altPlan.x,
                        y: altPlan.y,
                        lookAngle: null,
                        until: world.gameTime + 2.2
                    };
                    if (bot.isFollowingPlanRoute && bot.planIndex !== undefined) {
                        bot.planIndex++;
                        bot.maxPlanIndex = Math.max(bot.maxPlanIndex || 0, bot.planIndex);
                    }
                }
            } else {
                const angToMate = Math.atan2(blockingMate.y - bot.y, blockingMate.x - bot.x);
                moveBotWithSliding(bot, normalizeAngle(angToMate + Math.PI), 165, dt, false);
                updateBotHeadOrientation(bot, desiredLookAngle, true, goalPriority >= 70, dt);
                return;
            }
        }
    }

    // Anti-stacking: never hold shoulder-to-shoulder watching the exact same angle as an ally
    if (wantsToHoldPosition && !bot.isDefusing && bot.executePhase !== "PLANT_LOCK") {
        const overlappingHolder = world.allCharacters.find(other => {
            if (!other || other.isDead || other === bot || other.team !== bot.team) return false;
            if (Math.hypot(other.x - destinationPos.x, other.y - destinationPos.y) >= 105) return false;
            if (desiredLookAngle === null || desiredLookAngle === undefined) return true;
            return Math.abs(normalizeAngle(other.angle - desiredLookAngle)) < 0.72;
        });

        if (overlappingHolder) {
            const altAnglePos = findAlternateExitOrAngle(bot, overlappingHolder, destinationPos, true);
            if (altAnglePos) {
                destinationPos = { x: altAnglePos.x, y: altAnglePos.y };
                if (altAnglePos.lookAngle !== null) desiredLookAngle = altAnglePos.lookAngle;
                wantsToHoldPosition = false;
            } else {
                const watchAng = desiredLookAngle ?? bot.angle;
                const sideDir = (bot.id % 2 === 0) ? 1 : -1;
                const shiftAng = watchAng + sideDir * (Math.PI / 2);
                const shifted = snapToWalkablePos(
                    destinationPos.x + Math.cos(shiftAng) * 115,
                    destinationPos.y + Math.sin(shiftAng) * 115,
                    bot.radius + 4
                );
                if (Math.hypot(shifted.x - overlappingHolder.x, shifted.y - overlappingHolder.y) > 95) {
                    destinationPos = shifted;
                    wantsToHoldPosition = false;
                }
            }
        }
    }

    // Open-lane transit spread: latch lateral offset for 0.65s to prevent side-to-side jitter
    if (!wantsToHoldPosition && !inNarrowSpace && distToGoal > 36 && !bot.isDefusing && bot.executePhase !== "PLANT_LOCK") {
        if (bot.transitSpreadCache && world.gameTime < bot.transitSpreadCache.until) {
            destinationPos = bot.transitSpreadCache.pos;
        } else {
            const closeTransitMate = world.allCharacters.find(other => {
                if (!other || other.isDead || other === bot || other.team !== bot.team) return false;
                const d = Math.hypot(other.x - bot.x, other.y - bot.y);
                return d > 12 && d < 105;
            });

            if (closeTransitMate) {
                const mateAng = Math.atan2(closeTransitMate.y - bot.y, closeTransitMate.x - bot.x);
                const awayPerp = normalizeAngle(travelAng + (normalizeAngle(mateAng - travelAng) >= 0 ? -Math.PI / 2 : Math.PI / 2));
                const spreadDest = snapToWalkablePos(
                    destinationPos.x + Math.cos(awayPerp) * 85,
                    destinationPos.y + Math.sin(awayPerp) * 85,
                    bot.radius + 4
                );
                if (!checkWallCollision(spreadDest.x, spreadDest.y, bot.radius + 4) &&
                    getMapLineOfSight(bot.x, bot.y, spreadDest.x, spreadDest.y)) {
                    destinationPos = spreadDest;
                    bot.transitSpreadCache = { pos: spreadDest, until: world.gameTime + 0.65 };
                }
            }
        }
    }

    const holdSnapRadius = (bot.isWallHuggingHold || bot.isHoldingCrossfire) ? 6.0 : 14;
    const updatedDistToGoal = Math.hypot(destinationPos.x - bot.x, destinationPos.y - bot.y);
    const isHardCombatFocus = goalPriority >= 85 && !c4State.isPlanted;
    if (wantsToHoldPosition && updatedDistToGoal <= holdSnapRadius + 2) {
        brakeBot(bot, dt);
        updateBotHeadOrientation(bot, desiredLookAngle, false, isHardCombatFocus, dt);
    } else {
        steerBotToDestination(bot, destinationPos.x, destinationPos.y, baseSpeed, dt, {
            stopRadius: holdSnapRadius,
            arriveRadius: bot.isWallHuggingHold ? 28 : 52,
            autoAim: false
        });
        updateBotHeadOrientation(bot, desiredLookAngle, bot.isMoving, isHardCombatFocus, dt);
    }
}