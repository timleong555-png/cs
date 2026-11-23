/* ==========================================================================
   COLLISIONS, LIANG-BARSKY RAYCASTS, LINE-OF-SIGHT & SMOKE / FIRE VOLUMES
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
    registerLOSChecker
} from '../state.js';
import { MAP } from './dedust2map.js';

function nudgeOutOfObstacle(x, y, radius = 4, maxDist = 48) {
    if (!checkWallCollision(x, y, radius)) return { x, y };
    for (let r = 4; r <= maxDist; r += 4) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
            const tx = x + Math.cos(a) * r;
            const ty = y + Math.sin(a) * r;
            if (!checkWallCollision(tx, ty, radius)) {
                return { x: tx, y: ty };
            }
        }
    }
    return { x, y };
}

export function checkWallCollision(x, y, radius) {
    for (let i = 0; i < MAP.walls.length; i++) {
        const wall = MAP.walls[i];
        if (x + radius > wall.x && x - radius < wall.x + wall.w &&
            y + radius > wall.y && y - radius < wall.y + wall.h) {
            return true;
        }
    }
    const crates = MAP.crates || [];
    for (let i = 0; i < crates.length; i++) {
        const crate = crates[i];
        if (x + radius > crate.x && x - radius < crate.x + crate.w &&
            y + radius > crate.y && y - radius < crate.y + crate.h) {
            return true;
        }
    }

    if (matchState.roundPhase === "BUY_TIME") {
        const ctB = MAP.spawnBoundsCT;
        const tB = MAP.spawnBoundsT;
        const inCT = x > ctB.x1 && x < ctB.x2 && y > ctB.y1 && y < ctB.y2;
        const inT = x > tB.x1 && x < tB.x2 && y > tB.y1 && y < tB.y2;
        if (!inCT && !inT) return true;
    }

    return false;
}

export function ejectFromWall(entity) {
    if (!entity || entity.isDead) return;
    if (checkWallCollision(entity.x, entity.y, entity.radius)) {
        if (entity.lastValidX !== undefined && !checkWallCollision(entity.lastValidX, entity.lastValidY, entity.radius)) {
            entity.x = entity.lastValidX;
            entity.y = entity.lastValidY;
            return;
        }
        const nudged = nudgeOutOfObstacle(entity.x, entity.y, entity.radius, 80);
        if (!checkWallCollision(nudged.x, nudged.y, entity.radius)) {
            entity.x = nudged.x;
            entity.y = nudged.y;
            entity.lastValidX = nudged.x;
            entity.lastValidY = nudged.y;
        }
    } else {
        entity.lastValidX = entity.x;
        entity.lastValidY = entity.y;
    }
}

export function lineIntersectsCircle(x1, y1, x2, y2, cx, cy, radius) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len === 0) return Math.hypot(x1 - cx, y1 - cy) <= radius;

    const u = ((cx - x1) * dx + (cy - y1) * dy) / (len * len);
    const clampedU = Math.max(0, Math.min(1, u));
    const nearestX = x1 + clampedU * dx;
    const nearestY = y1 + clampedU * dy;

    return Math.hypot(cx - nearestX, cy - nearestY) <= radius;
}

// Analytical O(1) Liang-Barsky Line-AABB Intersection
export function lineIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    if (maxX < rx || minX > rx + rw || maxY < ry || minY > ry + rh) return false;

    const dx = x2 - x1;
    const dy = y2 - y1;
    let t0 = 0.0, t1 = 1.0;

    const p = [-dx, dx, -dy, dy];
    const q = [x1 - rx, rx + rw - x1, y1 - ry, ry + rh - y1];

    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
            if (q[i] < 0) return false;
        } else {
            const t = q[i] / p[i];
            if (p[i] < 0) {
                if (t > t1) return false;
                if (t > t0) t0 = t;
            } else {
                if (t < t0) return false;
                if (t < t1) t1 = t;
            }
        }
    }
    return t0 <= t1;
}

export function checkLineBlocked(x1, y1, x2, y2) {
    const minX = x1 < x2 ? x1 : x2, maxX = x1 > x2 ? x1 : x2;
    const minY = y1 < y2 ? y1 : y2, maxY = y1 > y2 ? y1 : y2;

    for (let i = 0; i < MAP.walls.length; i++) {
        const w = MAP.walls[i];
        if (maxX >= w.x && minX <= w.x + w.w && maxY >= w.y && minY <= w.y + w.h) {
            if (lineIntersectsRect(x1, y1, x2, y2, w.x, w.y, w.w, w.h)) return true;
        }
    }
    const crates = MAP.crates || [];
    for (let i = 0; i < crates.length; i++) {
        const c = crates[i];
        if (maxX >= c.x && minX <= c.x + c.w && maxY >= c.y && minY <= c.y + c.h) {
            if (lineIntersectsRect(x1, y1, x2, y2, c.x, c.y, c.w, c.h)) return true;
        }
    }
    return false;
}

export function getMapLineOfSight(x1, y1, x2, y2) {
    return !checkLineBlocked(x1, y1, x2, y2);
}

// Checks center-to-center plus left/right body edges so corner peeks with clear line-of-fire aren't falsely flagged as wall-blocked
export function hasClearEntitySightline(x1, y1, x2, y2, bodyOffset = 14) {
    if (getMapLineOfSight(x1, y1, x2, y2)) return true;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const perpX = -Math.sin(ang) * bodyOffset;
    const perpY = Math.cos(ang) * bodyOffset;

    const leftClear = !checkWallCollision(x1 + perpX, y1 + perpY, 4) &&
        !checkWallCollision(x2 + perpX, y2 + perpY, 4) &&
        getMapLineOfSight(x1 + perpX, y1 + perpY, x2 + perpX, y2 + perpY);
    if (leftClear) return true;

    return !checkWallCollision(x1 - perpX, y1 - perpY, 4) &&
        !checkWallCollision(x2 - perpX, y2 - perpY, 4) &&
        getMapLineOfSight(x1 - perpX, y1 - perpY, x2 - perpX, y2 - perpY);
}

// Register edge-aware LOS checker into state.js so corner walls don't falsely muffle audio
registerLOSChecker(hasClearEntitySightline);

export function hasBodyClearance(x1, y1, x2, y2, radius = 18) {
    if (!getMapLineOfSight(x1, y1, x2, y2)) return false;
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(2, Math.ceil(dist / 16));
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const px = x1 + (x2 - x1) * t;
        const py = y1 + (y2 - y1) * t;
        if (checkWallCollision(px, py, radius)) return false;
    }
    return true;
}

export function getRayObstacleEndpoint(x1, y1, angle, maxDist) {
    const dx = Math.cos(angle) * maxDist;
    const dy = Math.sin(angle) * maxDist;
    let minT = 1.0;

    const testRect = (rx, ry, rw, rh) => {
        let t0 = 0.0, t1 = 1.0;
        const p = [-dx, dx, -dy, dy];
        const q = [x1 - rx, rx + rw - x1, y1 - ry, ry + rh - y1];
        for (let i = 0; i < 4; i++) {
            if (p[i] === 0) {
                if (q[i] < 0) return;
            } else {
                const t = q[i] / p[i];
                if (p[i] < 0) {
                    if (t > t1) return;
                    if (t > t0) t0 = t;
                } else {
                    if (t < t0) return;
                    if (t < t1) t1 = t;
                }
            }
        }
        if (t0 <= t1 && t0 >= 0 && t0 < minT) {
            minT = t0;
        }
    };

    for (let i = 0; i < MAP.walls.length; i++) {
        const w = MAP.walls[i];
        testRect(w.x, w.y, w.w, w.h);
    }
    const crates = MAP.crates || [];
    for (let i = 0; i < crates.length; i++) {
        const c = crates[i];
        testRect(c.x, c.y, c.w, c.h);
    }

    return { x: x1 + dx * minT, y: y1 + dy * minT };
}

export function computeSmokePolygon(cx, cy, radius, rayCount = 96) {
    const poly = [];
    const step = (Math.PI * 2) / rayCount;
    for (let i = 0; i < rayCount; i++) {
        poly.push(getRayObstacleEndpoint(cx, cy, i * step, radius));
    }
    return poly;
}

export function createSmokeCloud(x, y, radius = 210, life = 15.0) {
    const pos = nudgeOutOfObstacle(x, y, 4, 48);
    world.smokeClouds.push({
        x: pos.x,
        y: pos.y,
        radius,
        life,
        maxLife: life,
        poly: computeSmokePolygon(pos.x, pos.y, radius, 48)
    });
}

export function createFirePatch(x, y, owner, radius = 155, life = 7.0) {
    const pos = nudgeOutOfObstacle(x, y, 4, 48);
    world.firePatches.push({
        x: pos.x,
        y: pos.y,
        radius,
        life,
        maxLife: life,
        owner,
        damageTimer: 0,
        poly: computeSmokePolygon(pos.x, pos.y, radius, 48)
    });
}

export function isPointInPolygon(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y;
        const xj = poly[j].x, yj = poly[j].y;
        const intersect = ((yi > py) !== (yj > py)) &&
            (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-9) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

export function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const ccw = (p1x, p1y, p2x, p2y, p3x, p3y) =>
        (p3y - p1y) * (p2x - p1x) > (p2y - p1y) * (p3x - p1x);
    return (ccw(ax, ay, cx, cy, dx, dy) !== ccw(bx, by, cx, cy, dx, dy)) &&
           (ccw(ax, ay, bx, by, cx, cy) !== ccw(ax, ay, bx, by, dx, dy));
}

export function isPointInFire(px, py, fire, margin = 0) {
    if (!fire || fire.life <= 0.25) return false;
    const effectiveRadius = margin > 0 ? (fire.radius + margin) : (fire.radius * 0.94);
    if (Math.hypot(px - fire.x, py - fire.y) > effectiveRadius) return false;
    if (!getMapLineOfSight(fire.x, fire.y, px, py)) return false;
    if (margin > 0) return true;
    if (fire.poly && fire.poly.length >= 3) {
        return isPointInPolygon(px, py, fire.poly);
    }
    return true;
}

export function doesSegmentIntersectFire(x1, y1, x2, y2, fire, margin = 0) {
    if (!fire || fire.life <= 0.35) return false;
    if (!lineIntersectsCircle(x1, y1, x2, y2, fire.x, fire.y, fire.radius + margin)) {
        return false;
    }
    if (!fire.poly || fire.poly.length < 3) {
        return getMapLineOfSight(fire.x, fire.y, (x1 + x2) * 0.5, (y1 + y2) * 0.5);
    }
    if (isPointInPolygon(x1, y1, fire.poly) || isPointInPolygon(x2, y2, fire.poly)) {
        return true;
    }
    for (let i = 0, j = fire.poly.length - 1; i < fire.poly.length; j = i++) {
        if (segmentsIntersect(x1, y1, x2, y2, fire.poly[j].x, fire.poly[j].y, fire.poly[i].x, fire.poly[i].y)) {
            return true;
        }
    }
    return false;
}

export function getLineOfSight(x1, y1, x2, y2) {
    if (!getMapLineOfSight(x1, y1, x2, y2)) return false;
    for (let c = 0; c < world.smokeClouds.length; c++) {
        const cloud = world.smokeClouds[c];
        if (!cloud || cloud.life <= 1.1) continue;
        if (!lineIntersectsCircle(x1, y1, x2, y2, cloud.x, cloud.y, cloud.radius)) {
            continue;
        }
        if (!cloud.poly || cloud.poly.length < 3) {
            return false;
        }
        if (isPointInPolygon(x1, y1, cloud.poly) || isPointInPolygon(x2, y2, cloud.poly)) {
            return false;
        }
        for (let i = 0, j = cloud.poly.length - 1; i < cloud.poly.length; j = i++) {
            if (segmentsIntersect(x1, y1, x2, y2, cloud.poly[j].x, cloud.poly[j].y, cloud.poly[i].x, cloud.poly[i].y)) {
                return false;
            }
        }
    }
    return true;
}

export function getSmokeCloudAt(x, y, margin = 0) {
    for (let i = 0; i < world.smokeClouds.length; i++) {
        const cloud = world.smokeClouds[i];
        if (cloud.life <= 1.1) continue;
        const dx = x - cloud.x;
        const dy = y - cloud.y;
        const maxR = cloud.radius + margin;
        if (dx * dx + dy * dy > maxR * maxR) continue;
        if (cloud.poly && cloud.poly.length >= 3) {
            if (isPointInPolygon(x, y, cloud.poly)) return cloud;
            if (margin > 0 && getMapLineOfSight(cloud.x, cloud.y, x, y)) return cloud;
        } else {
            return cloud;
        }
    }
    return null;
}

export function isInsideSmoke(x, y, margin = 0) {
    return getSmokeCloudAt(x, y, margin) !== null;
}

// Blurs sound/flash coordinates inside smoke so bots never get exact player GPS coordinates
export function getFuzzedAcousticPos(x, y, baseFuzz = 45) {
    const cloud = getSmokeCloudAt(x, y, 25);
    if (cloud) {
        const fuzzR = Math.max(100, cloud.radius * 0.62);
        const ang = rnd() * Math.PI * 2;
        const dist = (0.35 + rnd() * 0.65) * fuzzR;
        let fx = x + Math.cos(ang) * dist;
        let fy = y + Math.sin(ang) * dist;
        const dFromCenter = Math.hypot(fx - cloud.x, fy - cloud.y);
        if (dFromCenter > cloud.radius * 0.85) {
            const pullAng = Math.atan2(fy - cloud.y, fx - cloud.x);
            fx = cloud.x + Math.cos(pullAng) * (cloud.radius * 0.85);
            fy = cloud.y + Math.sin(pullAng) * (cloud.radius * 0.85);
        }
        return { x: fx, y: fy, inSmoke: true };
    }
    const ang = rnd() * Math.PI * 2;
    const dist = rnd() * baseFuzz;
    return { x: x + Math.cos(ang) * dist, y: y + Math.sin(ang) * dist, inSmoke: false };
}

export function isPointVisibleToTeam(targetX, targetY, team) {
    const teamMembers = team === "CT" ? world.livingCT : world.livingT;
    for (let i = 0; i < teamMembers.length; i++) {
        const member = teamMembers[i];
        if (!member || member.isDead) continue;

        const isScoped = member.isScoped && member.getEquippedKey() === "AWP";
        const scopeCfg = isScoped ? getAWPScopeConfig(member.scopeLevel, member.isBot) : null;
        const maxRange = scopeCfg ? scopeCfg.visionRange : FIXED_VISION_RANGE;

        const dist = Math.hypot(targetX - member.x, targetY - member.y);
        if (dist <= maxRange) {
            const angleToTarget = Math.atan2(targetY - member.y, targetX - member.x);
            const diff = Math.abs(normalizeAngle(angleToTarget - member.angle));
            const halfFov = scopeCfg ? scopeCfg.halfFov : FIXED_VISION_HALF_FOV;

            if (diff <= halfFov && getLineOfSight(member.x, member.y, targetX, targetY)) {
                return true;
            }
        }
    }
    return false;
}

export function getWallRepulsionVector(x, y, radius) {
    let pushX = 0;
    let pushY = 0;
    const feelerDist = radius + 1.0;

    const accumulateRepulsion = (list) => {
        for (let i = 0; i < list.length; i++) {
            const obs = list[i];
            const closestX = Math.max(obs.x, Math.min(x, obs.x + obs.w));
            const closestY = Math.max(obs.y, Math.min(y, obs.y + obs.h));
            const dist = Math.hypot(x - closestX, y - closestY);

            if (dist < feelerDist && dist > 0) {
                const overlap = (feelerDist - dist) / feelerDist;
                pushX += ((x - closestX) / dist) * overlap * 0.45;
                pushY += ((y - closestY) / dist) * overlap * 0.45;
            }
        }
    };

    accumulateRepulsion(MAP.walls);
    accumulateRepulsion(MAP.crates || []);

    return { pushX, pushY };
}

export function getCollisionNormal(x, y, radius) {
    let bestDist = Infinity;
    let normalX = 0;
    let normalY = 0;

    const checkList = (list) => {
        if (!list) return;
        for (let i = 0; i < list.length; i++) {
            const obs = list[i];
            const closestX = Math.max(obs.x, Math.min(x, obs.x + obs.w));
            const closestY = Math.max(obs.y, Math.min(y, obs.y + obs.h));
            const distX = x - closestX;
            const distY = y - closestY;
            const dist = Math.hypot(distX, distY);

            if (dist < radius + 6 && dist < bestDist) {
                bestDist = dist;
                if (dist > 0.001) {
                    normalX = distX / dist;
                    normalY = distY / dist;
                } else {
                    const dLeft = Math.abs(x - obs.x);
                    const dRight = Math.abs(x - (obs.x + obs.w));
                    const dTop = Math.abs(y - obs.y);
                    const dBottom = Math.abs(y - (obs.y + obs.h));
                    const minEdge = Math.min(dLeft, dRight, dTop, dBottom);

                    if (minEdge === dLeft) { normalX = -1; normalY = 0; }
                    else if (minEdge === dRight) { normalX = 1; normalY = 0; }
                    else if (minEdge === dTop) { normalX = 0; normalY = -1; }
                    else { normalX = 0; normalY = 1; }
                }
            }
        }
    };

    checkList(MAP.walls);
    checkList(MAP.crates);
    return { nx: normalX, ny: normalY, dist: bestDist };
}

export function calculateFireTraversalDamage(bot, fire, x1, y1, x2, y2) {
    if (!fire || fire.life <= 0.4) return 0;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const segLen = Math.hypot(dx, dy);
    const distStart = Math.hypot(x1 - fire.x, y1 - fire.y);

    let distInFire = 0;
    if (distStart < fire.radius) {
        distInFire = fire.radius + (fire.radius - distStart);
    } else if (segLen < 0.01) {
        distInFire = distStart < fire.radius ? (fire.radius - distStart) : 0;
    } else {
        const u = ((fire.x - x1) * dx + (fire.y - y1) * dy) / (segLen * segLen);
        const clampedU = Math.max(0.0, Math.min(1.0, u));
        const nearestX = x1 + clampedU * dx;
        const nearestY = y1 + clampedU * dy;
        const distToCenter = Math.hypot(fire.x - nearestX, fire.y - nearestY);

        if (distToCenter >= fire.radius) return 0;

        const halfChord = Math.sqrt(fire.radius * fire.radius - distToCenter * distToCenter);
        distInFire = 2 * halfChord;
    }

    const wep = bot && bot.getWeapon ? bot.getWeapon() : null;
    const speedMult = wep && wep.moveSpeedMult ? wep.moveSpeedMult : 1.0;
    const moveSpeed = bot ? (bot.isSilentWalking ? 95 : (190 * speedMult)) : 185;
    const timeInFire = distInFire / Math.max(70, moveSpeed);

    return timeInFire * 40;
}

export function isBotInRoundCriticalC4Emergency(bot) {
    if (!bot || !c4State.isPlanted) return false;
    const isUrgentDefuser = (bot.team === "CT" && bot === c4State.designatedDefuser && c4State.timer <= 14.0);
    const isBlastEvac = (c4State.timer <= 7.0 && Math.hypot(bot.x - c4State.plantX, bot.y - c4State.plantY) < 750);
    return isUrgentDefuser || isBlastEvac;
}

export function canBotSafelyTraverseFire(bot, fire, x1, y1, x2, y2) {
    if (!bot || !fire || fire.life <= 0.35) return true;

    const isAlliedFire = fire.owner && (fire.owner.team === bot.team);
    const safeMargin = isAlliedFire ? (bot.radius + 8) : Math.max(4, bot.radius - 4);
    if (!doesSegmentIntersectFire(x1, y1, x2, y2, fire, safeMargin)) {
        return true;
    }

    // Never walk into allied fire under any circumstance
    if (isAlliedFire) {
        return false;
    }

    const expandedFire = { x: fire.x, y: fire.y, radius: fire.radius + safeMargin, life: fire.life };
    const expectedDamage = calculateFireTraversalDamage(bot, expandedFire, x1, y1, x2, y2);
    if (expectedDamage <= 0) return true;

    const isEmergency = isBotInRoundCriticalC4Emergency(bot);
    const willDie = bot.health <= (expectedDamage + 15);
    const maxAllowedDmg = isEmergency ? 45 : 20;
    return !willDie && expectedDamage <= maxAllowedDmg;
}

export function getBlockingFireOnSegment(bot, x1, y1, x2, y2) {
    for (let i = 0; i < world.firePatches.length; i++) {
        const fire = world.firePatches[i];
        if (!fire || fire.life <= 0.35) continue;
        if (!canBotSafelyTraverseFire(bot, fire, x1, y1, x2, y2)) {
            return fire;
        }
    }
    return null;
}

export function canBulletPenetrateTo(x1, y1, x2, y2, piercingPower) {
    if (piercingPower <= 0) return false;
    let penetrableCount = 0;
    const obstacleLists = [MAP.walls, MAP.crates || []];
    for (let l = 0; l < obstacleLists.length; l++) {
        const list = obstacleLists[l];
        for (let i = 0; i < list.length; i++) {
            const obs = list[i];
            if (lineIntersectsRect(x1, y1, x2, y2, obs.x, obs.y, obs.w, obs.h)) {
                if (!obs.penetrable) return false;
                penetrableCount++;
                if (penetrableCount > piercingPower) return false;
            }
        }
    }
    return true;
}

export function hasThickWallBetween(x1, y1, x2, y2) {
    const obstacleLists = [MAP.walls, MAP.crates || []];
    for (let l = 0; l < obstacleLists.length; l++) {
        const list = obstacleLists[l];
        for (let i = 0; i < list.length; i++) {
            const obs = list[i];
            if (!obs.penetrable && lineIntersectsRect(x1, y1, x2, y2, obs.x, obs.y, obs.w, obs.h)) {
                return true;
            }
        }
    }
    return false;
}