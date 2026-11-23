/* ==========================================================================
   MINKOWSKI CLEARANCE NAV-GRID, STRING-PULLING A* & SMOOTH BOT STEERING
   ========================================================================== */
import {
    world,
    c4State,
    TORSO_RADIUS,
    FOOTSTEP_LISTEN_RADIUS,
    getAWPScopeConfig,
    rnd,
    normalizeAngle,
    rotateTowardsDamped,
    audio
} from '../state.js';
import { MAP, isInsideExpandedSite } from './dedust2map.js';
import { isPointInAWPSightline } from '../Bot/Bot-Sensor.js';
import {
    checkWallCollision,
    ejectFromWall,
    getMapLineOfSight,
    hasBodyClearance,
    isInsideSmoke,
    getWallRepulsionVector,
    getCollisionNormal,
    isPointInFire,
    doesSegmentIntersectFire,
    getBlockingFireOnSegment,
    isBotInRoundCriticalC4Emergency
} from './map-physics.js';

export const NAV_CELL_SIZE = 20; // 130 x 100 grid over 2600x2000 map
export const NAV_COLS = Math.ceil(MAP.width / NAV_CELL_SIZE);
export const NAV_ROWS = Math.ceil(MAP.height / NAV_CELL_SIZE);
export const NAV_TOTAL = NAV_COLS * NAV_ROWS;

export const navWalkable = new Uint8Array(NAV_TOTAL);   // 1 = fits 36px bot body, 0 = blocked
export const navClearance = new Uint8Array(NAV_TOTAL);  // Distance in cells to nearest wall (1..10)
export const navHeatmap = new Float32Array(NAV_TOTAL);

const navGScore = new Float32Array(NAV_TOTAL);
const navFScore = new Float32Array(NAV_TOTAL);
const navCameFrom = new Int32Array(NAV_TOTAL);
const navClosed = new Uint8Array(NAV_TOTAL);
const navOpenFlags = new Uint8Array(NAV_TOTAL);
const navOpenList = new Int32Array(NAV_TOTAL);

export function buildNavigationGrid() {
    const inflationRadius = TORSO_RADIUS + 2; // 20px clearance seals narrow crate gaps automatically

    // 1. Rasterize Minkowski-inflated walls & crates
    for (let r = 0; r < NAV_ROWS; r++) {
        const cy = (r + 0.5) * NAV_CELL_SIZE;
        for (let c = 0; c < NAV_COLS; c++) {
            const cx = (c + 0.5) * NAV_CELL_SIZE;
            const idx = r * NAV_COLS + c;
            let blocked = false;

            for (let i = 0; i < MAP.walls.length; i++) {
                const w = MAP.walls[i];
                if (cx + inflationRadius > w.x && cx - inflationRadius < w.x + w.w &&
                    cy + inflationRadius > w.y && cy - inflationRadius < w.y + w.h) {
                    blocked = true;
                    break;
                }
            }
            if (!blocked && MAP.crates) {
                for (let i = 0; i < MAP.crates.length; i++) {
                    const cr = MAP.crates[i];
                    if (cx + inflationRadius > cr.x && cx - inflationRadius < cr.x + cr.w &&
                        cy + inflationRadius > cr.y && cy - inflationRadius < cr.y + cr.h) {
                        blocked = true;
                        break;
                    }
                }
            }
            navWalkable[idx] = blocked ? 0 : 1;
            navClearance[idx] = blocked ? 0 : 10;
        }
    }

    // 2. Two-pass Brushfire distance transform (scores corridor centerlines)
    for (let r = 0; r < NAV_ROWS; r++) {
        for (let c = 0; c < NAV_COLS; c++) {
            const idx = r * NAV_COLS + c;
            if (!navWalkable[idx]) continue;
            let minVal = 10;
            if (r > 0) minVal = Math.min(minVal, navClearance[(r - 1) * NAV_COLS + c] + 1);
            if (c > 0) minVal = Math.min(minVal, navClearance[r * NAV_COLS + (c - 1)] + 1);
            navClearance[idx] = minVal;
        }
    }
    for (let r = NAV_ROWS - 1; r >= 0; r--) {
        for (let c = NAV_COLS - 1; c >= 0; c--) {
            const idx = r * NAV_COLS + c;
            if (!navWalkable[idx]) continue;
            let minVal = navClearance[idx];
            if (r < NAV_ROWS - 1) minVal = Math.min(minVal, navClearance[(r + 1) * NAV_COLS + c] + 1);
            if (c < NAV_COLS - 1) minVal = Math.min(minVal, navClearance[r * NAV_COLS + (c + 1)] + 1);
            navClearance[idx] = minVal;
        }
    }
}

buildNavigationGrid();

export function worldToNavCell(x, y) {
    const c0 = Math.max(0, Math.min(NAV_COLS - 1, Math.floor(x / NAV_CELL_SIZE)));
    const r0 = Math.max(0, Math.min(NAV_ROWS - 1, Math.floor(y / NAV_CELL_SIZE)));
    const idx0 = r0 * NAV_COLS + c0;
    if (navWalkable[idx0]) return idx0;

    // Spiral outward up to 6 cells (120px) to find closest valid walkable cell
    for (let rad = 1; rad <= 6; rad++) {
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let dr = -rad; dr <= rad; dr++) {
            for (let dc = -rad; dc <= rad; dc++) {
                if (Math.abs(dr) !== rad && Math.abs(dc) !== rad) continue;
                const nr = r0 + dr;
                const nc = c0 + dc;
                if (nr < 0 || nr >= NAV_ROWS || nc < 0 || nc >= NAV_COLS) continue;
                const nIdx = nr * NAV_COLS + nc;
                if (navWalkable[nIdx]) {
                    const wx = (nc + 0.5) * NAV_CELL_SIZE;
                    const wy = (nr + 0.5) * NAV_CELL_SIZE;
                    const d = Math.hypot(wx - x, wy - y);
                    if (d < bestDist) {
                        bestDist = d;
                        bestIdx = nIdx;
                    }
                }
            }
        }
        if (bestIdx !== -1) return bestIdx;
    }
    return idx0;
}

export function navCellToWorld(idx) {
    const r = Math.floor(idx / NAV_COLS);
    const c = idx % NAV_COLS;
    return {
        x: (c + 0.5) * NAV_CELL_SIZE,
        y: (r + 0.5) * NAV_CELL_SIZE
    };
}

export function recordHeatmapEvent(x, y, weight = 3) {
    const idx = worldToNavCell(x, y);
    if (idx >= 0 && idx < NAV_TOTAL) {
        navHeatmap[idx] = Math.min(25, navHeatmap[idx] + weight);
    }
}

function getActiveDeducedAWPNests(bot) {
    if (!bot || !world.tacticalIntel || !world.tacticalIntel.deducedAWPNests) return [];
    const list = world.tacticalIntel.deducedAWPNests[bot.team] || [];
    return list.filter(n => world.gameTime < n.expiresAt);
}

// Fast 8-Directional Typed-Array A* + Line-of-Sight String-Pulling
export function findGridPath(startX, startY, endX, endY, bot = null) {
    const activeNests = getActiveDeducedAWPNests(bot);
    const midX = (startX + endX) * 0.5;
    const midY = (startY + endY) * 0.5;
    const directCrossesAWP = activeNests.some(n =>
        Math.hypot(midX - n.x, midY - n.y) <= 880 && getMapLineOfSight(n.x, n.y, midX, midY)
    );
    const directBlockedByFire = getBlockingFireOnSegment(bot, startX, startY, endX, endY) !== null;

    if (!directCrossesAWP && !directBlockedByFire && hasBodyClearance(startX, startY, endX, endY, TORSO_RADIUS)) {
        return [{ x: endX, y: endY }];
    }

    const startIdx = worldToNavCell(startX, startY);
    const goalIdx = worldToNavCell(endX, endY);
    if (startIdx === goalIdx) {
        return [{ x: endX, y: endY }];
    }

    navGScore.fill(1e9);
    navFScore.fill(1e9);
    navCameFrom.fill(-1);
    navClosed.fill(0);
    navOpenFlags.fill(0);

    const goalR = Math.floor(goalIdx / NAV_COLS);
    const goalC = goalIdx % NAV_COLS;

    navGScore[startIdx] = 0;
    navFScore[startIdx] = Math.hypot(goalC - (startIdx % NAV_COLS), goalR - Math.floor(startIdx / NAV_COLS)) * NAV_CELL_SIZE;
    navOpenList[0] = startIdx;
    navOpenFlags[startIdx] = 1;
    let openCount = 1;

    const DIRS = [
        [-1, 0, 20], [1, 0, 20], [0, -1, 20], [0, 1, 20],
        [-1, -1, 28.28], [-1, 1, 28.28], [1, -1, 28.28], [1, 1, 28.28]
    ];

    let found = false;
    let iterations = 0;
    const maxIterations = NAV_TOTAL;
    while (openCount > 0 && iterations++ < maxIterations) {
        let bestPos = 0;
        let current = navOpenList[0];
        let bestF = navFScore[current];
        for (let i = 1; i < openCount; i++) {
            const cand = navOpenList[i];
            if (navFScore[cand] < bestF) {
                bestF = navFScore[cand];
                current = cand;
                bestPos = i;
            }
        }

        if (current === goalIdx) {
            found = true;
            break;
        }

        openCount--;
        navOpenList[bestPos] = navOpenList[openCount];
        navOpenFlags[current] = 0;
        navClosed[current] = 1;

        const cr = Math.floor(current / NAV_COLS);
        const cc = current % NAV_COLS;

        for (let d = 0; d < 8; d++) {
            const dr = DIRS[d][0];
            const dc = DIRS[d][1];
            const nr = cr + dr;
            const nc = cc + dc;
            if (nr < 0 || nr >= NAV_ROWS || nc < 0 || nc >= NAV_COLS) continue;

            const nIdx = nr * NAV_COLS + nc;
            if (navClosed[nIdx] || !navWalkable[nIdx]) continue;

            // Prevent diagonal corner cutting across blocked cells
            if (dr !== 0 && dc !== 0) {
                if (!navWalkable[(cr + dr) * NAV_COLS + cc] || !navWalkable[cr * NAV_COLS + (cc + dc)]) {
                    continue;
                }
            }

            // Corridor centerline bias
            const clearance = navClearance[nIdx];
            const wallHugPenalty = clearance <= 1 ? 38 : (clearance === 2 ? 14 : 0);

            const cellX = (nc + 0.5) * NAV_CELL_SIZE;
            const cellY = (nr + 0.5) * NAV_CELL_SIZE;

            // Soft traversal penalty for recent teammate death zones (skip in narrow corridors so a corpse never causes U-turn loops)
            let deathZonePenalty = 0;
            const teamDeaths = (bot && world.tacticalIntel && world.tacticalIntel.deathZones)
                ? world.tacticalIntel.deathZones[bot.team]
                : null;
            if (clearance > 2 && teamDeaths && teamDeaths.length > 0) {
                for (let dzIdx = 0; dzIdx < teamDeaths.length; dzIdx++) {
                    const dz = teamDeaths[dzIdx];
                    if (dz.cleared || world.gameTime >= dz.expiresAt) continue;
                    // Do not push a bot backward if it is already entering/crossing the spot
                    if (bot && Math.hypot(bot.x - dz.x, bot.y - dz.y) < 115) continue;

                    const distToDeath = Math.hypot(cellX - dz.x, cellY - dz.y);
                    const zoneRad = dz.radius || 50;
                    if (distToDeath < zoneRad) {
                        const freshness = Math.max(0.2, (dz.expiresAt - world.gameTime) / 18.0);
                        deathZonePenalty += (1.0 - distToDeath / zoneRad) * 70 * freshness;
                    }
                }
            }

            // Active Molotov avoidance: allied fire is impassable; enemy fire blocks only the core and biases A* to skirt the outer edge
            let blockedByFire = false;
            let fireSkirtPenalty = 0;
            if (world.firePatches.length > 0) {
                const isCriticalC4 = isBotInRoundCriticalC4Emergency(bot);
                for (let f = 0; f < world.firePatches.length; f++) {
                    const fire = world.firePatches[f];
                    if (fire.life <= 0.45) continue;
                    const isAllied = bot && fire.owner && (fire.owner.team === bot.team);
                    if (isAllied) {
                        if (isPointInFire(cellX, cellY, fire, TORSO_RADIUS + 10)) {
                            blockedByFire = true;
                            break;
                        }
                    } else if (!isCriticalC4) {
                        if (isPointInFire(cellX, cellY, fire, Math.max(4, TORSO_RADIUS - 4))) {
                            blockedByFire = true;
                            break;
                        }
                        if (isPointInFire(cellX, cellY, fire, TORSO_RADIUS + 18)) {
                            fireSkirtPenalty += 135;
                        }
                    }
                }
            }
            if (blockedByFire) continue;

            // Soft routing preference for covered flanking corridors when approaching a deduced AWPer
            let sniperLanePenalty = 0;
            if (activeNests.length > 0 && (!bot || (bot.getEquippedKey?.() !== "AWP" && !bot.isFastCrossingAWP)) && !isInsideSmoke(cellX, cellY)) {
                const distToGoal = Math.hypot(endX - cellX, endY - cellY);
                if (distToGoal > 140) {
                    for (let nIdx2 = 0; nIdx2 < activeNests.length; nIdx2++) {
                        const nest = activeNests[nIdx2];
                        const dNest = Math.hypot(cellX - nest.x, cellY - nest.y);
                        if (dNest <= 900 && getMapLineOfSight(nest.x, nest.y, cellX, cellY)) {
                            sniperLanePenalty += 220;
                            break;
                        }
                    }
                }
            }

            const tentativeG = navGScore[current] + DIRS[d][2] + wallHugPenalty + deathZonePenalty + sniperLanePenalty + fireSkirtPenalty;
            if (tentativeG < navGScore[nIdx]) {
                navCameFrom[nIdx] = current;
                navGScore[nIdx] = tentativeG;
                const h = Math.hypot(goalC - nc, goalR - nr) * NAV_CELL_SIZE;
                navFScore[nIdx] = tentativeG + h;
                if (!navOpenFlags[nIdx]) {
                    navOpenFlags[nIdx] = 1;
                    navOpenList[openCount++] = nIdx;
                }
            }
        }
    }

    if (!found) {
        return [{ x: endX, y: endY }];
    }

    // Reconstruct raw grid cell centers
    const rawPoints = [];
    let curr = goalIdx;
    while (curr !== -1 && curr !== startIdx) {
        rawPoints.push(navCellToWorld(curr));
        curr = navCameFrom[curr];
    }
    rawPoints.reverse();
    if (rawPoints.length > 0) {
        rawPoints[rawPoints.length - 1] = { x: endX, y: endY };
    } else {
        rawPoints.push({ x: endX, y: endY });
    }

    // String-Pulling: collapse staircase grid steps into straight corner-to-corner vectors
    const smoothed = [];
    let anchorX = startX;
    let anchorY = startY;
    let i = 0;

    while (i < rawPoints.length) {
        let furthest = i;
        for (let j = rawPoints.length - 1; j > i; j--) {
            if (hasBodyClearance(anchorX, anchorY, rawPoints[j].x, rawPoints[j].y, TORSO_RADIUS) &&
                !getBlockingFireOnSegment(bot, anchorX, anchorY, rawPoints[j].x, rawPoints[j].y)) {
                furthest = j;
                break;
            }
        }
        smoothed.push(rawPoints[furthest]);
        anchorX = rawPoints[furthest].x;
        anchorY = rawPoints[furthest].y;
        i = furthest + 1;
    }

    return smoothed;
}

/* ==========================================================================
   ACOUSTIC FOOTSTEPS & FIRE AVOIDANCE / STEERING
   ========================================================================== */
function assignApproximateSoundZone(listener, emitter, dist, maxRange, type) {
    const existing = listener.lastHeardSound;
    const existingAge = existing ? (world.gameTime - existing.time) : 999;
    const hasFreshHighPriority = existing && existingAge < 1.5 &&
        (existing.type === 'visual' || existing.type === 'firing_trace');
    if (hasFreshHighPriority) return;

    if (existing && (existing.type === 'footstep' || existing.type === 'ripple') && existingAge < 0.70) {
        const driftFromZone = Math.hypot(emitter.x - existing.x, emitter.y - existing.y);
        if (driftFromZone < 140) return;
    }

    const occluded = !getMapLineOfSight(listener.x, listener.y, emitter.x, emitter.y) ||
        isInsideSmoke(listener.x, listener.y) ||
        isInsideSmoke(emitter.x, emitter.y);
    const distRatio = Math.min(1.0, dist / Math.max(1, maxRange));
    const minRadius = occluded ? 75 : 48;
    const maxRadius = occluded ? (120 + distRatio * 50) : (82 + distRatio * 42);
    const fuzzDist = minRadius + rnd() * (maxRadius - minRadius);
    const fuzzAng = rnd() * Math.PI * 2;

    listener.lastHeardSound = {
        x: emitter.x + Math.cos(fuzzAng) * fuzzDist,
        y: emitter.y + Math.sin(fuzzAng) * fuzzDist,
        shooter: emitter,
        time: world.gameTime,
        type,
        isApproximate: true
    };
}

export function emitBotFootstep(bot, dt, actualSpeed) {
    if (!bot || bot.isDead || bot.isSilentWalking || bot.isCrouching || actualSpeed < 115) {
        return;
    }

    bot.rippleTimer = (bot.rippleTimer || 0) + dt;
    if (bot.rippleTimer >= 0.85) {
        bot.rippleTimer = 0;
        const rFuzzAng = rnd() * Math.PI * 2;
        const rFuzzDist = 28 + rnd() * 42;

        world.soundRipples.push({
            x: bot.x,
            y: bot.y,
            fuzzX: Math.cos(rFuzzAng) * rFuzzDist,
            fuzzY: Math.sin(rFuzzAng) * rFuzzDist,
            radius: 6,
            maxRadius: 200,
            alpha: 0.85,
            type: 'footstep',
            owner: bot
        });

        for (let i = 0; i < world.bots.length; i++) {
            const other = world.bots[i];
            if (!other || other.isDead || other.team === bot.team) continue;

            const d = Math.hypot(bot.x - other.x, bot.y - other.y);
            if (d <= 200) {
                assignApproximateSoundZone(other, bot, d, 200, 'ripple');
            }
        }
    }

    const stepInterval = 0.40 * (190 / Math.max(120, actualSpeed));
    bot.footstepTimer = (bot.footstepTimer || 0) + dt;
    if (bot.footstepTimer >= stepInterval) {
        bot.footstepTimer = 0;
        audio.playFootstep(bot.x, bot.y, bot);

        for (let i = 0; i < world.bots.length; i++) {
            const other = world.bots[i];
            if (!other || other.isDead || other.team === bot.team) continue;

            const d = Math.hypot(bot.x - other.x, bot.y - other.y);
            if (d <= FOOTSTEP_LISTEN_RADIUS) {
                assignApproximateSoundZone(other, bot, d, FOOTSTEP_LISTEN_RADIUS, 'footstep');
            }
        }
    }
}

function isPositionUnsafeFire(x, y, radius, bot = null) {
    for (let i = 0; i < world.firePatches.length; i++) {
        const fire = world.firePatches[i];
        if (fire.life <= 0.35) continue;
        const isAllied = bot && fire.owner && (fire.owner.team === bot.team);
        const buffer = isAllied ? (radius + 8) : Math.max(4, radius - 4);
        if (isPointInFire(x, y, fire, buffer)) {
            return true;
        }
    }
    return false;
}

function escapeActiveFire(bot, dt) {
    if (!bot || bot.isDead || world.firePatches.length === 0) return false;
    let closestFire = null;
    let minDist = Infinity;
    for (let i = 0; i < world.firePatches.length; i++) {
        const fire = world.firePatches[i];
        if (fire.life <= 0.35) continue;
        const isAllied = fire.owner && (fire.owner.team === bot.team);
        const buffer = isAllied ? (bot.radius + 8) : Math.max(4, bot.radius - 4);
        const d = Math.hypot(bot.x - fire.x, bot.y - fire.y);
        if (d < fire.radius + buffer && isPointInFire(bot.x, bot.y, fire, buffer)) {
            if (d < minDist) {
                minDist = d;
                closestFire = fire;
            }
        }
    }
    if (!closestFire) return false;

    const baseExitAngle = minDist > 0.01
        ? Math.atan2(bot.y - closestFire.y, bot.x - closestFire.x)
        : (bot.angle + Math.PI);

    const offsets = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8];
    const escapeSpeed = 205;
    const stepDist = escapeSpeed * dt;

    for (let i = 0; i < offsets.length; i++) {
        const ang = baseExitAngle + offsets[i];
        const nx = bot.x + Math.cos(ang) * stepDist;
        const ny = bot.y + Math.sin(ang) * stepDist;
        if (!checkWallCollision(nx, ny, bot.radius)) {
            const newDist = Math.hypot(nx - closestFire.x, ny - closestFire.y);
            if (newDist >= minDist - 0.5) {
                bot.prevX = bot.x;
                bot.prevY = bot.y;
                bot.x = nx;
                bot.y = ny;
                bot.vx = Math.cos(ang) * escapeSpeed;
                bot.vy = Math.sin(ang) * escapeSpeed;
                bot.isMoving = true;
                bot.isCrouching = false;
                bot.isSilentWalking = false;
                bot.currentPath = [];
                return true;
            }
        }
    }
    return false;
}

export function brakeBot(bot, dt) {
    if (!bot || bot.isDead) return;
    if (escapeActiveFire(bot, dt)) return;

    bot.prevX = bot.x;
    bot.prevY = bot.y;

    const damp = Math.exp(-16.0 * dt);
    bot.vx = (bot.vx || 0) * damp;
    bot.vy = (bot.vy || 0) * damp;

    if (Math.hypot(bot.vx, bot.vy) < 12) {
        bot.vx = 0;
        bot.vy = 0;
        bot.isMoving = false;
        return;
    }

    const dx = bot.vx * dt;
    const dy = bot.vy * dt;
    if (!checkWallCollision(bot.x + dx, bot.y + dy, bot.radius) &&
        !isPositionUnsafeFire(bot.x + dx, bot.y + dy, bot.radius, bot)) {
        bot.x += dx;
        bot.y += dy;
    } else {
        bot.vx = 0;
        bot.vy = 0;
    }

    const actualSpeed = dt > 0 ? Math.hypot(bot.x - bot.prevX, bot.y - bot.prevY) / dt : 0;
    bot.isMoving = actualSpeed > 25;
}

export function moveBotWithSliding(bot, angle, speed, dt, autoAim = false) {
    if (escapeActiveFire(bot, dt)) {
        return true;
    }

    if (bot.executePhase === "PLANT_LOCK") {
        brakeBot(bot, dt);
        return false;
    }

    if (bot.counterStrafeCooldown > 0) {
        bot.counterStrafeCooldown -= dt;
    }

    const wep = bot.getWeapon ? bot.getWeapon() : null;
    if (wep && wep.moveSpeedMult) {
        speed *= wep.moveSpeedMult;
    }

    const exposedToKnownAWP = Boolean(bot.isFastCrossingAWP) || (isPointInAWPSightline(bot.team, bot.x, bot.y) !== null);
    if (bot.isCrouching || (bot.isSilentWalking && !exposedToKnownAWP)) {
        speed *= 0.48;
    }
    if (bot.isScoped && bot.getEquippedKey() === "AWP") {
        speed *= getAWPScopeConfig(bot.scopeLevel, bot.isBot).moveSpeedMult;
    }
    if (bot.tagTimer > 0) {
        const recoveryFactor = 1.0 - (bot.tagTimer / 1.0);
        const currentTagMult = bot.tagSlowMult + (1.0 - bot.tagSlowMult) * recoveryFactor;
        speed *= currentTagMult;
    }

    const inNarrowCorridor = (bot.x >= 1800 && bot.x <= 2200 && bot.y >= 380 && bot.y <= 700) ||
                             (bot.x >= 2250 && bot.x <= 2560 && bot.y >= 40 && bot.y <= 750)  ||
                             (bot.x >= 1250 && bot.x <= 2200 && bot.y >= 1350 && bot.y <= 1950);

    const weaveOffset = inNarrowCorridor ? 0.0 : Math.sin(world.gameTime * 1.5 + bot.weaveSeed) * 0.015;
    let finalAngle = angle + weaveOffset;

    // Smooth tangent steering around active Molotov perimeter so bots walk right past the flames
    for (const fire of world.firePatches) {
        if (fire.life <= 0.45) continue;
        const isAllied = bot && fire.owner && (fire.owner.team === bot.team);
        const distToFire = Math.hypot(bot.x - fire.x, bot.y - fire.y);
        const margin = isAllied ? (bot.radius + 10) : Math.max(4, bot.radius - 2);
        const safePerimeter = fire.radius + margin;

        if (distToFire < safePerimeter + 32 && distToFire > 0.01) {
            const lookAhead = Math.min(50, distToFire);
            const feelerX = bot.x + Math.cos(finalAngle) * lookAhead;
            const feelerY = bot.y + Math.sin(finalAngle) * lookAhead;

            if (isPointInFire(feelerX, feelerY, fire, margin)) {
                const radAng = Math.atan2(bot.y - fire.y, bot.x - fire.x);
                const tangA = normalizeAngle(radAng + Math.PI / 2);
                const tangB = normalizeAngle(radAng - Math.PI / 2);
                const diffA = Math.abs(normalizeAngle(tangA - finalAngle));
                const diffB = Math.abs(normalizeAngle(tangB - finalAngle));
                finalAngle = diffA <= diffB ? tangA : tangB;
                break;
            }
        }
    }

    // Spacing brake behind friendly entry fraggers
    const teammateAhead = world.allCharacters.some(other => {
        if (!other || other.isDead || other === bot || other.team !== bot.team) return false;
        const dist = Math.hypot(other.x - bot.x, other.y - bot.y);
        if (dist < 75 && dist > 0.5) {
            const angleToOther = Math.atan2(other.y - bot.y, other.x - bot.x);
            return Math.abs(normalizeAngle(angleToOther - finalAngle)) < Math.PI * 0.35;
        }
        return false;
    });

    if (teammateAhead && bot.archetype !== "ENTRY" && !bot.isFastCrossingAWP) {
        speed *= 0.68;
    }

    // Pace the T-side C4 carrier only when an escort is ahead on the approach and the site isn't secured yet
    if (bot.team === "T" && bot.hasC4 && !c4State.isPlanted && !bot.targetEnemy) {
        const targetSiteRect = bot.assignedSite === "B" ? MAP.siteB : MAP.siteA;
        const anyTInSite = targetSiteRect && world.livingT.some(m =>
            m && !m.isDead && (isInsideExpandedSite(m.x, m.y, targetSiteRect) || Math.hypot(targetSiteRect.safeSpot.x - m.x, targetSiteRect.safeSpot.y - m.y) <= 260)
        );
        if (!anyTInSite) {
            const escortAhead = world.livingT.some(m => {
                if (!m || m.isDead || m === bot) return false;
                const d = Math.hypot(m.x - bot.x, m.y - bot.y);
                if (d >= 360 || d < 20) return false;
                const angToEscort = Math.atan2(m.y - bot.y, m.x - bot.x);
                return Math.abs(normalizeAngle(angToEscort - finalAngle)) < Math.PI * 0.45;
            });
            if (escortAhead) {
                speed *= 0.78;
            }
        }
    }

    const repulsion = getWallRepulsionVector(bot.x, bot.y, bot.radius);
    if (repulsion.pushX !== 0 || repulsion.pushY !== 0) {
        finalAngle = Math.atan2(
            Math.sin(finalAngle) + repulsion.pushY * 0.85,
            Math.cos(finalAngle) + repulsion.pushX * 0.85
        );
    }

    bot.lastMoveUpdate = world.gameTime;
    bot.prevX = bot.x;
    bot.prevY = bot.y;

    const targetVx = Math.cos(finalAngle) * speed;
    const targetVy = Math.sin(finalAngle) * speed;
    const accelBlend = 1 - Math.exp(-16.0 * dt);

    bot.vx = (bot.vx || 0) + (targetVx - (bot.vx || 0)) * accelBlend;
    bot.vy = (bot.vy || 0) + (targetVy - (bot.vy || 0)) * accelBlend;

    const dx = bot.vx * dt;
    const dy = bot.vy * dt;

    if (autoAim) {
        const targetDist = bot.targetEnemy ? Math.hypot(bot.targetEnemy.x - bot.x, bot.targetEnemy.y - bot.y) : Infinity;
        const hasRecentThreat = bot.targetEnemy || (bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 2.0));

        if (bot.targetEnemy && targetDist < 300 && (bot.reactionTimer >= bot.humanReactionDelay)) {
            const combatAimAngle = Math.atan2(bot.targetEnemy.y - bot.y, bot.targetEnemy.x - bot.x);
            bot.angle = rotateTowardsDamped(bot.angle, combatAimAngle, 10.0, dt);
            bot.transitScanAngle = 0;
        } else if (!bot.isPatrolling && !bot.isHoldingCrossfire) {
            if (hasRecentThreat) {
                bot.transitScanAngle = 0;
                bot.angle = rotateTowardsDamped(bot.angle, finalAngle, 10.0, dt);
            } else {
                bot.transitScanTimer = (bot.transitScanTimer || 0) - dt;
                if (bot.transitScanTimer <= 0) {
                    bot.transitScanTimer = 0.8 + rnd() * 1.4;
                    bot.transitScanDir = (bot.transitScanDir === 1) ? -1 : 1;
                    bot.transitScanAngle = bot.transitScanDir * (12 * Math.PI / 180);
                }
                const targetFacing = normalizeAngle(finalAngle + (bot.transitScanAngle || 0));
                bot.angle = rotateTowardsDamped(bot.angle, targetFacing, 8.5, dt);
            }
        }
    }

    const wouldEnterFire = (nx, ny) =>
        !isPositionUnsafeFire(bot.x, bot.y, bot.radius, bot) &&
        isPositionUnsafeFire(nx, ny, bot.radius, bot);

    if (wouldEnterFire(bot.x + dx, bot.y + dy)) {
        // Slide tangentially around the fire circle instead of freezing or wiping the A* detour
        const activeFire = world.firePatches.find(f => f.life > 0.35 && isPositionUnsafeFire(bot.x + dx, bot.y + dy, bot.radius, bot));
        if (activeFire) {
            const radAng = Math.atan2(bot.y - activeFire.y, bot.x - activeFire.x);
            const tangA = normalizeAngle(radAng + Math.PI / 2);
            const tangB = normalizeAngle(radAng - Math.PI / 2);
            const slideAng = Math.abs(normalizeAngle(tangA - finalAngle)) <= Math.abs(normalizeAngle(tangB - finalAngle)) ? tangA : tangB;
            const sdx = Math.cos(slideAng) * speed * dt;
            const sdy = Math.sin(slideAng) * speed * dt;
            if (!checkWallCollision(bot.x + sdx, bot.y + sdy, bot.radius) && !wouldEnterFire(bot.x + sdx, bot.y + sdy)) {
                bot.x += sdx;
                bot.y += sdy;
                bot.vx = Math.cos(slideAng) * speed;
                bot.vy = Math.sin(slideAng) * speed;
                bot.isMoving = true;
                return true;
            }
        }
        brakeBot(bot, dt);
        return false;
    }

    let moved = false;
    if (!checkWallCollision(bot.x + dx, bot.y + dy, bot.radius)) {
        bot.x += dx;
        bot.y += dy;
        moved = true;
    } else {
        const col = getCollisionNormal(bot.x + dx, bot.y + dy, bot.radius);
        if (col.nx !== 0 || col.ny !== 0) {
            const dot = dx * col.nx + dy * col.ny;
            if (dot < 0) {
                const slideDx = dx - col.nx * dot;
                const slideDy = dy - col.ny * dot;
                if (!checkWallCollision(bot.x + slideDx, bot.y + slideDy, bot.radius) &&
                    !wouldEnterFire(bot.x + slideDx, bot.y + slideDy)) {
                    bot.x += slideDx;
                    bot.y += slideDy;
                    const vDot = bot.vx * col.nx + bot.vy * col.ny;
                    if (vDot < 0) {
                        bot.vx -= col.nx * vDot;
                        bot.vy -= col.ny * vDot;
                    }
                    moved = true;
                }
            }
        }
        if (!moved && !checkWallCollision(bot.x + dx, bot.y, bot.radius) && !wouldEnterFire(bot.x + dx, bot.y)) {
            bot.x += dx;
            bot.vy = 0;
            moved = true;
        } else if (!moved && !checkWallCollision(bot.x, bot.y + dy, bot.radius) && !wouldEnterFire(bot.x, bot.y + dy)) {
            bot.y += dy;
            bot.vx = 0;
            moved = true;
        }
    }

    if (!moved) {
        bot.vx = 0;
        bot.vy = 0;
        if (bot.counterStrafeCooldown <= 0) {
            bot.counterStrafeDir = -bot.counterStrafeDir;
            bot.counterStrafeCooldown = 0.25;
        }
        if (checkWallCollision(bot.x, bot.y, bot.radius)) {
            ejectFromWall(bot);
        }
    }

    const actualDist = Math.hypot(bot.x - bot.prevX, bot.y - bot.prevY);
    const actualSpeed = dt > 0 ? actualDist / dt : 0;
    const expectedDist = speed * dt;

    bot.stuckTime = (expectedDist > 0 && actualDist < expectedDist * 0.12) ? (bot.stuckTime + dt) : 0;
    bot.lastX = bot.x;
    bot.lastY = bot.y;
    bot.isMoving = actualSpeed > 25;

    if (bot.isMoving) {
        emitBotFootstep(bot, dt, actualSpeed);
    }

    return moved;
}

function isSegmentBlockedByFire(bot, x1, y1, x2, y2) {
    if (world.firePatches.length === 0) return null;
    const isCriticalC4 = isBotInRoundCriticalC4Emergency(bot);
    for (let i = 0; i < world.firePatches.length; i++) {
        const fire = world.firePatches[i];
        if (!fire || fire.life <= 0.45) continue;
        const isAllied = bot && fire.owner && (fire.owner.team === bot.team);
        const margin = isAllied ? (TORSO_RADIUS + 8) : Math.max(4, TORSO_RADIUS - 4);
        if ((isAllied || !isCriticalC4) && doesSegmentIntersectFire(x1, y1, x2, y2, fire, margin)) {
            return fire;
        }
    }
    return null;
}

export function steerBotToDestination(bot, destX, destY, maxSpeed, dt, options = {}) {
    const stopRadius = options.stopRadius !== undefined ? options.stopRadius : 12;
    const arriveRadius = options.arriveRadius !== undefined ? options.arriveRadius : 46;
    const autoAim = options.autoAim !== undefined ? options.autoAim : false;

    const distToDest = Math.hypot(destX - bot.x, destY - bot.y);
    if (distToDest <= stopRadius) {
        brakeBot(bot, dt);
        return;
    }

    const directFireBlock = isSegmentBlockedByFire(bot, bot.x, bot.y, destX, destY);
    if (!directFireBlock && hasBodyClearance(bot.x, bot.y, destX, destY, TORSO_RADIUS)) {
        bot.currentPath = [];
        let moveSpeed = maxSpeed;
        if (distToDest < arriveRadius) {
            moveSpeed *= Math.max(0.35, distToDest / arriveRadius);
        }
        moveBotWithSliding(bot, Math.atan2(destY - bot.y, destX - bot.x), moveSpeed, dt, autoAim);
        return;
    }

    bot.pathRecalcTimer = (bot.pathRecalcTimer || 0) - dt;
    const goalShiftDist = bot.lastPathGoal ? Math.hypot(destX - bot.lastPathGoal.x, destY - bot.lastPathGoal.y) : Infinity;
    const majorGoalShift = goalShiftDist > 135 && bot.pathRecalcTimer <= 0.25;
    const minorGoalShift = goalShiftDist > 45 && bot.pathRecalcTimer <= 0;
    const pathHasFire = world.firePatches.length > 0 &&
        bot.currentPath && bot.currentPath.length > 0 &&
        isSegmentBlockedByFire(bot, bot.x, bot.y, bot.currentPath[0].x, bot.currentPath[0].y) !== null;

    if (!bot.currentPath || majorGoalShift || minorGoalShift || pathHasFire || bot.pathRecalcTimer <= 0) {
        bot.currentPath = findGridPath(bot.x, bot.y, destX, destY, bot);
        bot.lastPathGoal = { x: destX, y: destY };
        bot.pathRecalcTimer = (bot.currentPath && bot.currentPath.length === 0) ? 0.55 : 0.45;
    }

    while (bot.currentPath.length > 1) {
        const pt = bot.currentPath[0];
        if (Math.hypot(pt.x - bot.x, pt.y - bot.y) < 34) {
            bot.currentPath.shift();
        } else {
            break;
        }
    }

    if (bot.currentPath.length > 1) {
        for (let i = bot.currentPath.length - 1; i > 0; i--) {
            const pt = bot.currentPath[i];
            if (!isSegmentBlockedByFire(bot, bot.x, bot.y, pt.x, pt.y) &&
                hasBodyClearance(bot.x, bot.y, pt.x, pt.y, TORSO_RADIUS)) {
                bot.currentPath.splice(0, i);
                break;
            }
        }
    }

    const steerTarget = bot.currentPath.length > 0 ? bot.currentPath[0] : { x: destX, y: destY };

    // Only hold for allied fire; for enemy fire, skirt past the edge and keep advancing
    const nextLegFire = isSegmentBlockedByFire(bot, bot.x, bot.y, steerTarget.x, steerTarget.y);
    if (nextLegFire && bot.currentPath.length <= 1) {
        const isAlliedFire = bot && nextLegFire.owner && (nextLegFire.owner.team === bot.team);
        if (isAlliedFire) {
            const distToFireCenter = Math.hypot(bot.x - nextLegFire.x, bot.y - nextLegFire.y);
            const safeHoldRadius = nextLegFire.radius + bot.radius + 14;
            if (distToFireCenter <= safeHoldRadius + 14) {
                brakeBot(bot, dt);
                return;
            }
        }
    }

    moveBotWithSliding(bot, Math.atan2(steerTarget.y - bot.y, steerTarget.x - bot.x), maxSpeed, dt, autoAim);
}