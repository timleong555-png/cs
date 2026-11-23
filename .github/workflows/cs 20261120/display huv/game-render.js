/* ==========================================================================
   MAIN GAME CANVAS RENDERER (MAP, SMOKE FOG, CHARACTERS, CROSSHAIR & SCOPE)
   ========================================================================== */
import {
    world,
    matchState,
    c4State,
    mouse,
    FIXED_VISION_RANGE,
    FIXED_VISION_HALF_FOV,
    TORSO_RADIUS,
    HEAD_OFFSET,
    getAWPScopeConfig,
    getActiveFocus
} from '../state.js';
import { MAP } from '../js-map-physics/dedust2map.js';
import {
    checkWallCollision,
    getLineOfSight,
    getMapLineOfSight,
    computeSmokePolygon,
    isInsideSmoke,
    isPointInFire,
    isPointVisibleToTeam,
    getRayObstacleEndpoint,
    canBulletPenetrateTo
} from '../js-map-physics/map-physics.js';
import { WEAPONS } from '../combat-match/Weapon-behavior.js';
import { renderRadar } from './Radar.js';

let lastSmokeTransitionTime = performance.now();
let recentFriendlyOrdnance = [];
let botDebugOverlayEnabled = false;

if (typeof window !== 'undefined' && !window.__botDebugToggleBound) {
    window.__botDebugToggleBound = true;
    window.addEventListener('keydown', (e) => {
        if (e.key === 'F9') {
            e.preventDefault();
            botDebugOverlayEnabled = !botDebugOverlayEnabled;
        }
    });
}

/* ==========================================================================
   UTILITY VISIBILITY & SMOKE TRANSITION
   ========================================================================== */
function trackFriendlyGrenades(viewerTeam) {
    const now = world.gameTime;
    recentFriendlyOrdnance = recentFriendlyOrdnance.filter(item => (now - item.time) < 0.55);

    for (let i = 0; i < world.grenades.length; i++) {
        const g = world.grenades[i];
        if (!g || !g.owner || g.owner.team !== viewerTeam) continue;

        const existing = recentFriendlyOrdnance.find(item => item.ref === g);
        if (existing) {
            existing.x = g.x;
            existing.y = g.y;
            existing.time = now;
        } else {
            recentFriendlyOrdnance.push({
                ref: g,
                type: g.type,
                x: g.x,
                y: g.y,
                time: now
            });
        }
    }
}

function isUtilityAreaInTeamSight(x, y, radius, viewerTeam, poly = null) {
    if (isPointVisibleToTeam(x, y, viewerTeam)) return true;

    if (poly && poly.length >= 3) {
        for (let i = 0; i < poly.length; i++) {
            const p1 = poly[i];
            const p2 = poly[(i + 1) % poly.length];
            if (isPointVisibleToTeam(p1.x, p1.y, viewerTeam)) return true;
            if (isPointVisibleToTeam((p1.x + p2.x) * 0.5, (p1.y + p2.y) * 0.5, viewerTeam)) return true;
        }
        return false;
    }

    const checkR = Math.max(16, (radius || 60) * 0.9);
    const steps = 12;
    for (let i = 0; i < steps; i++) {
        const ang = (i / steps) * Math.PI * 2;
        if (isPointVisibleToTeam(x + Math.cos(ang) * checkR, y + Math.sin(ang) * checkR, viewerTeam)) {
            return true;
        }
    }
    return false;
}

function isUtilityEffectVisible(effect, viewerTeam, player, expectedType = null) {
    if (!effect) return false;
    if (player && player.isDead) return true;

    if (!effect._seenBy) effect._seenBy = {};
    if (effect._seenBy[viewerTeam]) return true;

    // 0. Reveal smoke/fire immediately when touching or affecting the player's body (even behind their vision cone)
    const focus = getActiveFocus() || player;
    if (focus && !focus.isDead) {
        const effR = effect.radius || effect.maxRadius || 60;
        const dFocus = Math.hypot(focus.x - effect.x, focus.y - effect.y);
        if (dFocus <= effR + TORSO_RADIUS + 24 && getMapLineOfSight(effect.x, effect.y, focus.x, focus.y)) {
            if (expectedType === "MOLOTOV") {
                if (isPointInFire(focus.x, focus.y, effect, TORSO_RADIUS + 20)) {
                    effect._seenBy[viewerTeam] = true;
                    return true;
                }
            } else {
                effect._seenBy[viewerTeam] = true;
                return true;
            }
        }
    }

    // 1. Direct team ownership or recent friendly detonation
    const isFriendlyOwner = (effect.owner && effect.owner.team === viewerTeam) || effect.team === viewerTeam;
    const isNearFriendlyDetonation = recentFriendlyOrdnance.some(item =>
        (!expectedType || item.type === expectedType) &&
        Math.hypot(item.x - effect.x, item.y - effect.y) < 115
    );

    if (isFriendlyOwner || isNearFriendlyDetonation) {
        effect._seenBy[viewerTeam] = true;
        return true;
    }

    // 2. Check whether any living teammate or the player has sight of this hazard area
    const checkRadius = effect.radius || effect.maxRadius || 60;
    if (isUtilityAreaInTeamSight(effect.x, effect.y, checkRadius, viewerTeam, effect.poly || null)) {
        effect._seenBy[viewerTeam] = true;
        return true;
    }

    return false;
}

export function updateSmokeTransition(activeFocus) {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - lastSmokeTransitionTime) / 1000));
    lastSmokeTransitionTime = now;

    if (!activeFocus || activeFocus.isDead || matchState.roundPhase === "BUY_TIME") {
        world.smokeVisionFactor = 0.0;
        return;
    }

    const targetFactor = isInsideSmoke(activeFocus.x, activeFocus.y) ? 1.0 : 0.0;
    const transitionSeconds = 1.0;

    if (world.smokeVisionFactor < targetFactor) {
        world.smokeVisionFactor = Math.min(targetFactor, world.smokeVisionFactor + dt / transitionSeconds);
    } else if (world.smokeVisionFactor > targetFactor) {
        world.smokeVisionFactor = Math.max(targetFactor, world.smokeVisionFactor - dt / transitionSeconds);
    }
}

export function canViewerSeePointAcrossSmoke(viewer, targetX, targetY, targetEntity = null) {
    if (!viewer) return true;
    if (targetEntity && (targetEntity === viewer || targetEntity.team === viewer.team)) {
        return true;
    }
    if (isInsideSmoke(targetX, targetY) || world.smokeVisionFactor >= 0.85) {
        return false;
    }
    return getLineOfSight(viewer.x, viewer.y, targetX, targetY);
}

/* ==========================================================================
   SMOKE POLYGON & SCREEN-SPACE FOG OVERLAY
   ========================================================================== */
function tracePolygonPath(ctx, effect) {
    ctx.beginPath();
    if (effect.poly && effect.poly.length >= 3) {
        ctx.moveTo(effect.poly[0].x, effect.poly[0].y);
        for (let p = 1; p < effect.poly.length; p++) {
            ctx.lineTo(effect.poly[p].x, effect.poly[p].y);
        }
        ctx.closePath();
    } else {
        ctx.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
    }
}

function drawSmokeBoundaryIndicator(ctx, cloud, activeFocus) {
    if (!cloud || cloud.life <= 0.05) return;

    const lifeRatio = Math.max(0, cloud.life / cloud.maxLife);
    const expiringPulse = cloud.life < 3.0 ? (0.55 + 0.45 * Math.sin(world.gameTime * 10)) : 1.0;
    const alpha = Math.min(0.92, (0.45 + lifeRatio * 0.45) * expiringPulse);

    const distToFocus = activeFocus ? Math.hypot(activeFocus.x - cloud.x, activeFocus.y - cloud.y) : Infinity;
    const nearOrInside = distToFocus <= (cloud.radius + 32);

    ctx.save();
    tracePolygonPath(ctx, cloud);

    ctx.strokeStyle = nearOrInside
        ? `rgba(125, 211, 252, ${alpha.toFixed(3)})`
        : `rgba(235, 242, 250, ${(alpha * 0.85).toFixed(3)})`;
    ctx.lineWidth = nearOrInside ? 2.6 : 2.0;
    ctx.stroke();

    ctx.setLineDash([10, 7]);
    ctx.lineDashOffset = -world.gameTime * 18;
    ctx.strokeStyle = `rgba(15, 23, 42, ${(alpha * 0.55).toFixed(3)})`;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
}

function renderPlayerSmokeScreen(ctx, activeFocus, screenWidth, screenHeight) {
    if (!activeFocus || world.smokeVisionFactor <= 0.005) return;

    const ease = world.smokeVisionFactor * world.smokeVisionFactor * (3 - 2 * world.smokeVisionFactor);
    const screenFocusX = (activeFocus.x - world.cameraX - screenWidth / 2) * world.cameraZoom + screenWidth / 2;
    const screenFocusY = (activeFocus.y - world.cameraY - screenHeight / 2) * world.cameraZoom + screenHeight / 2;

    const cleanCenterRadius = TORSO_RADIUS * 1.3;
    const innerRadius = Math.max(8, (cleanCenterRadius + (220 - cleanCenterRadius) * (1 - ease)) * world.cameraZoom);
    const outerRadius = Math.max(30, (135 + 285 * (1 - ease)) * world.cameraZoom);

    const smokeOverlay = ctx.createRadialGradient(
        screenFocusX, screenFocusY, innerRadius,
        screenFocusX, screenFocusY, outerRadius
    );
    smokeOverlay.addColorStop(0.0, "rgba(155, 160, 165, 0.0)");
    smokeOverlay.addColorStop(0.55, `rgba(145, 150, 155, ${(0.90 * ease).toFixed(3)})`);
    smokeOverlay.addColorStop(1.0, `rgba(135, 140, 145, ${(0.98 * ease).toFixed(3)})`);
    ctx.fillStyle = smokeOverlay;
    ctx.fillRect(0, 0, screenWidth, screenHeight);

    if (world.smokeClouds.length > 0) {
        const viewerTeam = world.player ? world.player.team : world.playerTeam;
        ctx.save();
        ctx.translate(screenWidth / 2, screenHeight / 2);
        ctx.scale(world.cameraZoom, world.cameraZoom);
        ctx.translate(-screenWidth / 2, -screenHeight / 2);
        ctx.translate(-world.cameraX, -world.cameraY);
        for (let i = 0; i < world.smokeClouds.length; i++) {
            const cloud = world.smokeClouds[i];
            if (!isUtilityEffectVisible(cloud, viewerTeam, world.player, "SMOKE")) continue;
            drawSmokeBoundaryIndicator(ctx, cloud, activeFocus);
        }
        ctx.restore();
    }
}

/* ==========================================================================
   UTILITY TRAJECTORY PREVIEW, CROSSHAIR & AWP OPTICS
   ========================================================================== */
export function predictUtilityLandingSpot(thrower, wepKey, targetX, targetY, isExtended) {
    const wep = WEAPONS[wepKey];
    if (!wep || wep.category !== "grenade") return null;

    const throwAngle = Math.atan2(targetY - thrower.y, targetX - thrower.x);
    const throwSpeed = isExtended ? wep.speed * 2.0 : wep.speed;

    let spawnDist = 20;
    let simX = thrower.x + Math.cos(throwAngle) * spawnDist;
    let simY = thrower.y + Math.sin(throwAngle) * spawnDist;

    if (checkWallCollision(simX, simY, 8)) {
        spawnDist = 42;
        simX = thrower.x + Math.cos(throwAngle) * spawnDist;
        simY = thrower.y + Math.sin(throwAngle) * spawnDist;
    }

    let vx = Math.cos(throwAngle) * throwSpeed;
    let vy = Math.sin(throwAngle) * throwSpeed;
    let fuse = 1.5;
    const stepDt = 1 / 60;
    const drag = Math.pow(0.08, stepDt);

    for (let step = 0; step < 150; step++) {
        const nextX = simX + vx * stepDt;
        const nextY = simY + vy * stepDt;

        if (checkWallCollision(nextX, simY, 8)) vx *= -0.5;
        else simX = nextX;

        if (checkWallCollision(simX, nextY, 8)) vy *= -0.5;
        else simY = nextY;

        vx *= drag;
        vy *= drag;
        fuse -= stepDt;

        const speed = Math.hypot(vx, vy);
        if (wepKey === "HEGRENADE") {
            if (speed < 35) break;
        } else if (wepKey === "MOLOTOV") {
            if (fuse <= 0 || speed < 30) break;
        } else if (fuse <= 0) {
            break;
        }
    }

    return { x: simX, y: simY };
}

function drawCenterLandingMarker(ctx, x, y, color, label, labelOffsetY = -12, radius = 7) {
    ctx.save();

    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "bold 10px 'Share Tech Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillText(label, x + 1, y + labelOffsetY + 1);
    ctx.fillStyle = color;
    ctx.fillText(label, x, y + labelOffsetY);

    ctx.restore();
}

function renderUtilityLandingPreview(ctx) {
    const player = world.player;
    if (!player || player.isDead) return;
    if (!Number.isFinite(mouse.worldX) || !Number.isFinite(mouse.worldY)) return;

    const wepKey = player.getEquippedKey();
    const wep = player.getWeapon();
    if (!wep || wep.category !== "grenade") return;

    const leftSpot = predictUtilityLandingSpot(player, wepKey, mouse.worldX, mouse.worldY, false);
    const rightSpot = predictUtilityLandingSpot(player, wepKey, mouse.worldX, mouse.worldY, true);
    if (!leftSpot || !rightSpot) return;

    const leftColor = "#38bdf8";
    const rightColor = "#ffffff";
    const spotsOverlap = Math.hypot(rightSpot.x - leftSpot.x, rightSpot.y - leftSpot.y) < 16;

    if (spotsOverlap) {
        drawCenterLandingMarker(ctx, leftSpot.x, leftSpot.y, leftColor, "[L]", -14, 9);
        drawCenterLandingMarker(ctx, rightSpot.x, rightSpot.y, rightColor, "[R]", 18, 5);
    } else {
        drawCenterLandingMarker(ctx, leftSpot.x, leftSpot.y, leftColor, "[L]", -12, 7);
        drawCenterLandingMarker(ctx, rightSpot.x, rightSpot.y, rightColor, "[R]", -12, 7);
    }
}

function renderDynamicCrosshair(ctx, cx, cy) {
    const player = world.player;
    if (!player || player.isDead) return;

    const targetX = (typeof cx === "number" && Number.isFinite(cx)) ? cx : mouse.worldX;
    const targetY = (typeof cy === "number" && Number.isFinite(cy)) ? cy : mouse.worldY;
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return;

    const bloom = Number.isFinite(player.recoilBloom) ? player.recoilBloom : 0;
    const pWep = player.getWeapon();

    let movementGap = 0;
    if (player.isMoving) {
        const isControlledWalk = player.isSilentWalking || (pWep.category === "sniper" && player.isScoped);
        movementGap = isControlledWalk ? 5 : (pWep.category === "sniper" ? 28 : 16);
    } else if (player.isCrouching) {
        movementGap = -2;
    }

    const gap = Math.max(2, 4 + bloom * 110 + movementGap);
    const len = 8;

    ctx.save();
    ctx.strokeStyle = "#00ff00";
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(targetX, targetY - gap); ctx.lineTo(targetX, targetY - gap - len);
    ctx.moveTo(targetX, targetY + gap); ctx.lineTo(targetX, targetY + gap + len);
    ctx.moveTo(targetX - gap, targetY); ctx.lineTo(targetX - gap - len, targetY);
    ctx.moveTo(targetX + gap, targetY); ctx.lineTo(targetX + gap + len, targetY);
    ctx.stroke();

    const wepKey = player.getEquippedKey();
    const rawSpread = (pWep && Number.isFinite(pWep.spread)) ? pWep.spread : 0.02;
    const maxVisualSpread = wepKey === "VECTOR" ? Math.min(rawSpread, 0.075) : rawSpread;
    const tapLimit = wepKey === "DEAGLE" ? 1 : 2;
    const activeTaps = (world.gameTime - (player.lastShotTime || 0) > 0.45) ? 0 : (player.tapCount || 0);

    const tapBase = Math.min(maxVisualSpread, 0.022);
    const visualRampT = activeTaps <= tapLimit ? 0 : Math.min(1, (activeTaps - tapLimit) / 5);
    const visualSpread = tapBase + (maxVisualSpread - tapBase) * visualRampT;

    const spreadRadius = Math.max(1, (visualSpread + bloom * 0.55) * 320);
    ctx.strokeStyle = "rgba(0, 255, 0, 0.22)";
    ctx.beginPath();
    ctx.arc(targetX, targetY, spreadRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    for (let i = world.hitmarkers.length - 1; i >= 0; i--) {
        const hm = world.hitmarkers[i];
        if (!hm || !Number.isFinite(hm.x) || !Number.isFinite(hm.y)) continue;
        ctx.strokeStyle = hm.isHeadshot ? "#ef4444" : "#ffffff";
        ctx.lineWidth = 2;
        const hSize = 8;

        ctx.beginPath();
        ctx.moveTo(hm.x - hSize, hm.y - hSize);
        ctx.lineTo(hm.x + hSize, hm.y + hSize);
        ctx.moveTo(hm.x + hSize, hm.y - hSize);
        ctx.lineTo(hm.x - hSize, hm.y + hSize);
        ctx.stroke();
    }
}

function renderAWPScopeLaser(ctx, activeFocus) {
    if (!activeFocus || activeFocus.isDead || activeFocus.getEquippedKey() !== "AWP") return;

    const wep = activeFocus.getWeapon ? activeFocus.getWeapon() : WEAPONS["AWP"];
    const boltCooldown = (wep && (wep.fireRate || wep.cooldown)) || 1.45;
    const isChamberingShot = ((activeFocus.awpBoltTimer || 0) > 0) ||
        ((activeFocus.lastShotTime || 0) > 0 && (world.gameTime - activeFocus.lastShotTime) < boltCooldown);
    const isClipEmpty = activeFocus.getCurrentClip && activeFocus.getCurrentClip() <= 0;

    if (activeFocus.isReloading || isChamberingShot || isClipEmpty) return;

    const isScoped = Boolean(activeFocus.isScoped);
    const maxRange = isScoped ? 780 : (FIXED_VISION_RANGE || 520);
    const isLocalPlayer = activeFocus === world.player;
    const rawTargetX = isLocalPlayer ? mouse.worldX : activeFocus.x + Math.cos(activeFocus.angle) * maxRange;
    const rawTargetY = isLocalPlayer ? mouse.worldY : activeFocus.y + Math.sin(activeFocus.angle) * maxRange;
    if (!Number.isFinite(rawTargetX) || !Number.isFinite(rawTargetY)) return;

    const dx = rawTargetX - activeFocus.x;
    const dy = rawTargetY - activeFocus.y;
    if (Math.hypot(dx, dy) < 1) return;

    const angle = Math.atan2(dy, dx);
    const muzzleOffset = TORSO_RADIUS + 10;
    const startX = activeFocus.x + Math.cos(angle) * muzzleOffset;
    const startY = activeFocus.y + Math.sin(angle) * muzzleOffset;

    const targetDist = maxRange - muzzleOffset;
    if (targetDist <= 4) return;

    const endX = startX + Math.cos(angle) * targetDist;
    const endY = startY + Math.sin(angle) * targetDist;

    const hitPt = getRayObstacleEndpoint(startX, startY, angle, targetDist);
    const hitDist = Math.hypot(hitPt.x - startX, hitPt.y - startY);
    const isBlocked = hitDist < targetDist - 2;

    const speed = Math.hypot(activeFocus.vx || 0, activeFocus.vy || 0);
    const isSteady = speed <= 35 && !activeFocus.isMoving;
    const smokeDim = isInsideSmoke(activeFocus.x, activeFocus.y) ? 0.35 : 1.0;
    const stateAlpha = isScoped ? (isSteady ? 0.85 : 0.38) : (isSteady ? 0.65 : 0.30);
    const baseAlpha = stateAlpha * smokeDim;

    ctx.save();
    ctx.lineCap = "round";

    const beamGrad = ctx.createLinearGradient(startX, startY, hitPt.x, hitPt.y);
    beamGrad.addColorStop(0, `rgba(255, 55, 55, ${baseAlpha.toFixed(3)})`);
    beamGrad.addColorStop(1, `rgba(255, 45, 45, ${(baseAlpha * 0.55).toFixed(3)})`);

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(hitPt.x, hitPt.y);
    ctx.strokeStyle = `rgba(255, 30, 30, ${(baseAlpha * 0.22).toFixed(3)})`;
    ctx.lineWidth = isSteady ? 3.5 : 5.0;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(hitPt.x, hitPt.y);
    ctx.strokeStyle = beamGrad;
    ctx.lineWidth = isSteady ? 1.1 : 1.5;
    ctx.stroke();

    if (isBlocked) {
        ctx.beginPath();
        ctx.arc(hitPt.x, hitPt.y, 3.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 50, 50, ${(0.28 * smokeDim).toFixed(3)})`;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(hitPt.x, hitPt.y, 1.7, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 130, 130, ${(0.95 * smokeDim).toFixed(3)})`;
        ctx.fill();

        const piercing = activeFocus.getWeapon ? (activeFocus.getWeapon().piercingPower || 2) : 2;
        const canWallbang = canBulletPenetrateTo(startX, startY, endX, endY, piercing);

        ctx.beginPath();
        ctx.setLineDash([4, 6]);
        ctx.moveTo(hitPt.x, hitPt.y);
        ctx.lineTo(endX, endY);
        ctx.strokeStyle = canWallbang
            ? `rgba(255, 175, 45, ${(0.55 * smokeDim).toFixed(3)})`
            : `rgba(255, 65, 65, ${(0.22 * smokeDim).toFixed(3)})`;
        ctx.lineWidth = 1.0;
        ctx.stroke();
        ctx.setLineDash([]);
    } else {
        ctx.beginPath();
        ctx.arc(endX, endY, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 90, 90, ${baseAlpha.toFixed(3)})`;
        ctx.fill();
    }

    ctx.restore();
}

function renderAWPScopeOverlay(ctx, screenWidth, screenHeight, scopeLevel = 1) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const cx = screenWidth / 2;
    const cy = screenHeight / 2;
    const radius = Math.min(screenWidth, screenHeight) * 0.48;

    ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
    ctx.beginPath();
    ctx.rect(0, 0, screenWidth, screenHeight);
    ctx.arc(cx, cy, radius, 0, Math.PI * 2, true);
    ctx.fill();

    ctx.strokeStyle = "rgba(17, 24, 39, 0.85)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx, cy + radius);
    ctx.stroke();

    const hudY = cy + radius - 22;
    const pipW = 18;
    const pipH = 4;
    const pipGap = 5;
    const totalW = pipW * 3 + pipGap * 2;
    const startX = cx - totalW / 2;

    for (let i = 1; i <= 3; i++) {
        ctx.fillStyle = i <= scopeLevel ? "rgba(34, 211, 238, 0.85)" : "rgba(255, 255, 255, 0.20)";
        ctx.fillRect(startX + (i - 1) * (pipW + pipGap), hudY, pipW, pipH);
    }

    ctx.font = "bold 10px 'Share Tech Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(34, 211, 238, 0.85)";
    ctx.fillText(`ZOOM ${scopeLevel}/3`, cx, hudY - 5);

    ctx.restore();
}

/* ==========================================================================
   MODULAR WORLD RENDER PASSES
   ========================================================================== */
function renderMapLayer(ctx) {
    ctx.fillStyle = MAP.bgColor;
    ctx.fillRect(0, 0, MAP.width, MAP.height);

    for (const d of world.decals) {
        ctx.fillStyle = `rgba(139, 0, 0, ${d.alpha})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
        ctx.fill();
    }

    if (MAP.shadedZones && MAP.shadedZones.length > 0) {
        for (const zone of MAP.shadedZones) {
            const zGrad = ctx.createLinearGradient(zone.x, zone.y, zone.x + zone.w, zone.y);
            zGrad.addColorStop(0.0, "#64748b");
            zGrad.addColorStop(0.25, "#3f3f46");
            zGrad.addColorStop(0.55, "#18181b");
            zGrad.addColorStop(0.85, "#27272a");
            zGrad.addColorStop(1.0, "#52525b");

            ctx.fillStyle = zGrad;
            ctx.fillRect(zone.x, zone.y, zone.w, zone.h);

            ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
            ctx.lineWidth = 2;
            for (let seamX = zone.x + 50; seamX < zone.x + zone.w; seamX += 65) {
                ctx.beginPath();
                ctx.moveTo(seamX, zone.y);
                ctx.lineTo(seamX, zone.y + zone.h);
                ctx.stroke();
            }
        }
    }

    // Bombsites A & B
    ctx.fillStyle = "rgba(220, 38, 38, 0.18)";
    ctx.strokeStyle = "rgba(220, 38, 38, 0.75)";
    ctx.lineWidth = 3;

    ctx.fillRect(MAP.siteA.x, MAP.siteA.y, MAP.siteA.w, MAP.siteA.h);
    ctx.strokeRect(MAP.siteA.x, MAP.siteA.y, MAP.siteA.w, MAP.siteA.h);

    ctx.fillRect(MAP.siteB.x, MAP.siteB.y, MAP.siteB.w, MAP.siteB.h);
    ctx.strokeRect(MAP.siteB.x, MAP.siteB.y, MAP.siteB.w, MAP.siteB.h);

    if (MAP.areas) {
        ctx.textAlign = "center";
        for (const area of MAP.areas) {
            if (area.label.toLowerCase().includes("site") || area.label.toLowerCase().includes("boom")) {
                ctx.font = "900 24px 'Share Tech Mono'";
                ctx.fillStyle = "#ff3333";
            } else {
                ctx.font = "bold 13px 'Share Tech Mono'";
                ctx.fillStyle = "rgba(255, 190, 0, 0.65)";
            }
            ctx.fillText(area.label.toUpperCase(), area.x, area.y);
        }
    }

    // Walls
    ctx.fillStyle = "#5c4f3d";
    ctx.strokeStyle = "#383025";
    ctx.lineWidth = 3;
    for (const wall of MAP.walls) {
        ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
        ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
    }

    // Crates
    ctx.fillStyle = "#8a6d48";
    ctx.strokeStyle = "#4d3a24";
    for (const crate of (MAP.crates || [])) {
        ctx.fillRect(crate.x, crate.y, crate.w, crate.h);
        ctx.strokeRect(crate.x, crate.y, crate.w, crate.h);
        ctx.beginPath();
        ctx.moveTo(crate.x, crate.y);
        ctx.lineTo(crate.x + crate.w, crate.y + crate.h);
        ctx.moveTo(crate.x + crate.w, crate.y);
        ctx.lineTo(crate.x, crate.y + crate.h);
        ctx.stroke();
    }

    // Buy Zone Outlines during freeze time
    if (matchState.roundPhase === "BUY_TIME") {
        ctx.strokeStyle = "rgba(239, 68, 68, 0.6)";
        ctx.lineWidth = 4;
        ctx.setLineDash([8, 8]);

        const ctB = MAP.spawnBoundsCT;
        ctx.strokeRect(ctB.x1, ctB.y1, ctB.x2 - ctB.x1, ctB.y2 - ctB.y1);

        const tB = MAP.spawnBoundsT;
        ctx.strokeRect(tB.x1, tB.y1, tB.x2 - tB.x1, tB.y2 - tB.y1);
        ctx.setLineDash([]);
    }
}

function renderUtilityLayer(ctx, activeFocus, viewerTeam, player) {
    trackFriendlyGrenades(viewerTeam);

    // Fire Patches
    for (const fire of world.firePatches) {
        if (!isUtilityEffectVisible(fire, viewerTeam, player, "MOLOTOV")) continue;

        ctx.save();
        const fireAlpha = Math.min(0.62, fire.life / 2.0);
        const fireGrad = ctx.createRadialGradient(fire.x, fire.y, 12, fire.x, fire.y, fire.radius);
        fireGrad.addColorStop(0.0, `rgba(251, 146, 60, ${(fireAlpha * 1.15).toFixed(3)})`);
        fireGrad.addColorStop(0.7, `rgba(234, 88, 12, ${fireAlpha.toFixed(3)})`);
        fireGrad.addColorStop(1.0, `rgba(220, 38, 38, ${(fireAlpha * 0.75).toFixed(3)})`);

        ctx.fillStyle = fireGrad;
        tracePolygonPath(ctx, fire);
        ctx.fill();

        ctx.strokeStyle = `rgba(248, 113, 113, ${Math.min(0.95, fireAlpha * 1.4).toFixed(3)})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
    }

    // Smoke Clouds
    for (const cloud of world.smokeClouds) {
        if (!isUtilityEffectVisible(cloud, viewerTeam, player, "SMOKE")) continue;

        ctx.save();
        const lifeRatio = Math.max(0, cloud.life / cloud.maxLife);
        const smokeGrad = ctx.createRadialGradient(cloud.x, cloud.y, 15, cloud.x, cloud.y, cloud.radius);
        smokeGrad.addColorStop(0.0, `rgba(185, 190, 195, ${(lifeRatio * 0.82).toFixed(3)})`);
        smokeGrad.addColorStop(0.75, `rgba(175, 180, 185, ${(lifeRatio * 0.74).toFixed(3)})`);
        smokeGrad.addColorStop(1.0, `rgba(165, 170, 175, ${(lifeRatio * 0.45).toFixed(3)})`);

        ctx.fillStyle = smokeGrad;
        tracePolygonPath(ctx, cloud);
        ctx.fill();
        ctx.restore();

        drawSmokeBoundaryIndicator(ctx, cloud, activeFocus);
    }

    // Shockwaves (Occluded behind walls and clipped to room geometry)
    for (const sw of world.shockwaves) {
        const isC4Blast = (sw.maxRadius || 0) >= 700;
        if (!isC4Blast && !isUtilityEffectVisible(sw, viewerTeam, player)) continue;
        if (!isC4Blast && activeFocus && !(player && player.isDead)) {
            if (!getMapLineOfSight(activeFocus.x, activeFocus.y, sw.x, sw.y)) continue;
        }

        if (!sw.poly && !isC4Blast) {
            sw.poly = computeSmokePolygon(sw.x, sw.y, sw.maxRadius || 260, 36);
        }

        ctx.save();
        if (sw.poly && sw.poly.length >= 3) {
            ctx.beginPath();
            ctx.moveTo(sw.poly[0].x, sw.poly[0].y);
            for (let p = 1; p < sw.poly.length; p++) {
                ctx.lineTo(sw.poly[p].x, sw.poly[p].y);
            }
            ctx.closePath();
            ctx.clip();
        }
        ctx.strokeStyle = `rgba(255, 200, 100, ${sw.alpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    // Active Grenades
    for (const g of world.grenades) {
        const isFriendly = g.owner && g.owner.team === viewerTeam;
        const isVisible = isFriendly || (player && player.isDead) || isPointVisibleToTeam(g.x, g.y, viewerTeam);
        if (!isVisible) continue;

        ctx.save();
        ctx.fillStyle = g.type === "HEGRENADE" ? "#ef4444" : (g.type === "MOLOTOV" ? "#ea580c" : (g.type === "FLASH" ? "#facc15" : "#9ca3af"));
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.isExtended ? 8 : 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = g.isExtended ? "#22d3ee" : "#000000";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }
}

function renderObjectivesAndItems(ctx, viewerTeam, player) {
    const isSpectator = Boolean(player && player.isDead);

    // C4 Objective
    if (c4State.isDropped && (isPointVisibleToTeam(c4State.dropX, c4State.dropY, viewerTeam) || isSpectator)) {
        ctx.fillStyle = "#dc2626";
        ctx.fillRect(c4State.dropX - 10, c4State.dropY - 10, 20, 20);
        ctx.strokeStyle = "#ffffff";
        ctx.strokeRect(c4State.dropX - 10, c4State.dropY - 10, 20, 20);
    } else if (c4State.isPlanted && (isPointVisibleToTeam(c4State.plantX, c4State.plantY, viewerTeam) || isSpectator)) {
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(c4State.plantX, c4State.plantY, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#000";
        ctx.font = "900 10px sans-serif";
        ctx.fillText("C4", c4State.plantX - 6, c4State.plantY + 3);

        if (c4State.isBeingDefused && c4State.designatedDefuser &&
            Number.isFinite(c4State.designatedDefuser.x) && Number.isFinite(c4State.designatedDefuser.y)) {
            ctx.save();
            ctx.strokeStyle = "#22d3ee";
            ctx.lineWidth = 3;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(c4State.designatedDefuser.x, c4State.designatedDefuser.y);
            ctx.lineTo(c4State.plantX, c4State.plantY);
            ctx.stroke();
            ctx.restore();
        }
    }

    // Dropped Weapons
    for (const item of world.droppedWeapons) {
        if (isPointVisibleToTeam(item.x, item.y, viewerTeam) || isSpectator) {
            ctx.save();
            ctx.fillStyle = "#fbbf24";
            ctx.strokeStyle = "#000000";
            ctx.lineWidth = 1.5;
            ctx.fillRect(item.x - 8, item.y - 4, 16, 8);
            ctx.strokeRect(item.x - 8, item.y - 4, 16, 8);
            ctx.font = "bold 8px sans-serif";
            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "center";
            ctx.fillText(item.key.substring(0, 5), item.x, item.y - 6);
            ctx.restore();
        }
    }
}

function renderCharacterWeapon(ctx, char) {
    const wepKey = char.getEquippedKey();
    const wep = char.getWeapon();
    const skinSprite = char.activeWeaponSkins?.[wepKey];

    // Ready hook for custom .png in-hand weapon sprites
    if (skinSprite && skinSprite.complete && skinSprite.naturalWidth > 0) {
        const spriteLen = wep.category === "sniper" ? 30 : (wep.category === "rifle" ? 24 : 16);
        const spriteWidth = 10;
        ctx.drawImage(skinSprite, 6, -spriteWidth * 0.5, spriteLen, spriteWidth);
        return;
    }

    if (wepKey === "DUALIES") {
        ctx.fillStyle = "#222222";
        ctx.fillRect(6, -11, 14, 4); // Left-hand pistol barrel
        ctx.fillRect(6, 7, 14, 4);   // Right-hand pistol barrel
        return;
    }

    ctx.fillStyle = "#222222";
    const barrelLength = wep.category === "sniper" ? 24 : (wep.category === "rifle" ? 20 : 14);
    ctx.fillRect(8, -3, barrelLength, 6);
}

function renderEntitiesLayer(ctx, activeFocus, viewerTeam, player) {
    // Corpses
    for (const c of world.corpses) {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.angle);
        ctx.fillStyle = c.team === "CT" ? "#1e3a8a" : "#881337";
        ctx.beginPath();
        ctx.arc(0, 0, TORSO_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = "#fbcfe8";
        ctx.beginPath();
        ctx.arc(HEAD_OFFSET, 0, 4.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "#ef4444";
        ctx.beginPath();
        ctx.moveTo(-6, -6); ctx.lineTo(6, 6);
        ctx.moveTo(6, -6); ctx.lineTo(-6, 6);
        ctx.stroke();
        ctx.restore();

        ctx.font = "bold 9px sans-serif";
        ctx.fillStyle = "#ef4444";
        ctx.textAlign = "center";
        ctx.fillText(`[DEAD] ${c.name}`, c.x, c.y - 22);
    }

    // Living Characters
    for (const char of world.allCharacters) {
        if (!char || char.isDead) continue;

        const isVisible = char.team === viewerTeam || (player && player.isDead) ||
            (isPointVisibleToTeam(char.x, char.y, viewerTeam) && canViewerSeePointAcrossSmoke(activeFocus, char.x, char.y, char));
        if (!isVisible) continue;

        const isEnemyChar = char.team !== viewerTeam && !(player && player.isDead);
        ctx.globalAlpha = (isEnemyChar && world.smokeVisionFactor > 0.01)
            ? Math.max(0.0, 1.0 - world.smokeVisionFactor)
            : 1.0;

        ctx.save();
        ctx.translate(char.x, char.y);
        ctx.rotate(char.angle);

        renderCharacterWeapon(ctx, char);

        const torso = char.getTorsoHitbox();
        ctx.fillStyle = char.team === "CT" ? "#3b82f6" : "#ef4444";
        ctx.beginPath();
        ctx.arc(0, 0, torso.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2;
        ctx.stroke();

        const head = char.getHeadHitbox();
        ctx.fillStyle = char.hasHelmet ? "#94a3b8" : "#fbcfe8";
        ctx.beginPath();
        ctx.arc(HEAD_OFFSET, 0, head.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();

        // Health Bar
        if (char.health < 100) {
            ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
            ctx.fillRect(char.x - 20, char.y - 28, 40, 5);
            ctx.fillStyle = char.team === "CT" ? "#60a5fa" : "#f87171";
            ctx.fillRect(char.x - 20, char.y - 28, (char.health / 100) * 40, 5);
        }

        // Name Tag
        ctx.font = "bold 10px sans-serif";
        ctx.fillStyle = char.team === "CT" ? "#93c5fd" : "#fca5a5";
        ctx.textAlign = "center";
        const displayTag = char.isBot ? `${char.name} [${char.archetype}]` : char.name;
        ctx.fillText(displayTag, char.x, char.y - 32);

        // Progressive Recoil Heat Bar
        if (char === activeFocus) {
            const timeSinceLastShot = world.gameTime - (char.lastShotTime || 0);
            const TAP_COOLDOWN_WINDOW = 0.55;
            if (timeSinceLastShot < TAP_COOLDOWN_WINDOW && (char.tapCount || 0) > 2 && (char.recoilHeat || 0) > 0) {
                const decayRatio = 1.0 - (timeSinceLastShot / TAP_COOLDOWN_WINDOW);
                const fillRatio = Math.min(1.0, char.recoilHeat * decayRatio);
                const barW = 36;
                const barH = 4;
                const bx = char.x - barW / 2;
                const by = char.y + char.radius + 10;

                ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
                ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);

                ctx.fillStyle = fillRatio > 0.7 ? "#ef4444" : (fillRatio > 0.4 ? "#f59e0b" : "#22d3ee");
                ctx.fillRect(bx, by, barW * fillRatio, barH);
            }
        }
    }

    ctx.globalAlpha = 1.0;
}

function renderEffectsAndVision(ctx, activeFocus, viewerTeam, player) {
    // Sound Ripples
    const viewerInSmoke = activeFocus && isInsideSmoke(activeFocus.x, activeFocus.y);
    if (!viewerInSmoke) {
        for (let i = world.soundRipples.length - 1; i >= 0; i--) {
            const s = world.soundRipples[i];
            const isFriendly = s.owner && s.owner.team === world.playerTeam;
            const distToFocus = activeFocus ? Math.hypot(s.x - activeFocus.x, s.y - activeFocus.y) : Infinity;

            if (!isFriendly && (distToFocus > 200 || isInsideSmoke(s.x, s.y))) continue;

            const drawX = isFriendly ? s.x : (s.x + (s.fuzzX || 0));
            const drawY = isFriendly ? s.y : (s.y + (s.fuzzY || 0));

            ctx.save();
            ctx.strokeStyle = isFriendly
                ? `rgba(96, 165, 250, ${s.alpha * 0.55})`
                : `rgba(239, 68, 68, ${s.alpha * 0.65})`;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(drawX, drawY, s.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    // Bullets
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 3;
    for (const b of world.bullets) {
        if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) continue;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - b.vx * 0.03, b.y - b.vy * 0.03);
        ctx.stroke();
    }

    // Particles
    const isSpectating = !player || player.isDead;
    for (const p of world.particles) {
        if (!isSpectating) {
            const hasDirectWallLOS = !activeFocus || getMapLineOfSight(activeFocus.x, activeFocus.y, p.x, p.y);
            const inTeamSight = hasDirectWallLOS &&
                isPointVisibleToTeam(p.x, p.y, viewerTeam) &&
                canViewerSeePointAcrossSmoke(activeFocus, p.x, p.y);
            if (!inTeamSight) continue;
        }
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
    }

    // Active Focus Vision Cone
    if (activeFocus && !activeFocus.isDead &&
        Number.isFinite(activeFocus.x) && Number.isFinite(activeFocus.y) && Number.isFinite(activeFocus.angle)) {
        ctx.save();
        const isFocusScoped = activeFocus.isScoped && activeFocus.getEquippedKey() === "AWP";
        const focusScopeCfg = isFocusScoped ? getAWPScopeConfig(activeFocus.scopeLevel) : null;
        const visionLen = focusScopeCfg ? focusScopeCfg.visionRange : FIXED_VISION_RANGE;
        const halfFov = focusScopeCfg ? focusScopeCfg.halfFov : FIXED_VISION_HALF_FOV;
        ctx.beginPath();
        ctx.moveTo(activeFocus.x, activeFocus.y);
        ctx.arc(activeFocus.x, activeFocus.y, visionLen, activeFocus.angle - halfFov, activeFocus.angle + halfFov);
        ctx.closePath();

        ctx.fillStyle = isFocusScoped ? "rgba(34, 211, 238, 0.08)" : "rgba(255, 200, 50, 0.05)";
        ctx.fill();

        ctx.strokeStyle = isFocusScoped ? "rgba(34, 211, 238, 0.6)" : "rgba(255, 190, 0, 0.35)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
    }
}

function renderBotDebugOverlay(ctx) {
    if (!botDebugOverlayEnabled) return;

    ctx.save();

    // 1. Draw Deduced AWP Nests for both teams
    const nestsByTeam = world.tacticalIntel?.deducedAWPNests;
    if (nestsByTeam) {
        for (const teamKey of ["CT", "T"]) {
            const nests = nestsByTeam[teamKey] || [];
            for (let i = 0; i < nests.length; i++) {
                const n = nests[i];
                ctx.strokeStyle = teamKey === "CT" ? "rgba(56, 189, 248, 0.85)" : "rgba(248, 113, 113, 0.85)";
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.arc(n.x, n.y, 34, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.font = "bold 9px 'Share Tech Mono', monospace";
                ctx.textAlign = "center";
                ctx.fillStyle = "#fde047";
                ctx.fillText(`AWP NEST (${teamKey})`, n.x, n.y - 38);
            }
        }
    }

    // 2. Draw each bot's active tactical order / objective state and next path waypoint
    for (const char of world.allCharacters) {
        if (!char || !char.isBot || char.isDead) continue;

        const targetPt = (char.currentPath && char.currentPath.length > 0)
            ? char.currentPath[0]
            : char.tacticalOrder?.targetPos;

        if (targetPt && Number.isFinite(targetPt.x) && Number.isFinite(targetPt.y)) {
            ctx.strokeStyle = char.team === "CT" ? "rgba(96, 165, 250, 0.55)" : "rgba(248, 113, 113, 0.55)";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(char.x, char.y);
            ctx.lineTo(targetPt.x, targetPt.y);
            ctx.stroke();
        }

        const stateLabel = char.isDefusing
            ? `DEFUSING (${char.fakeDefusesRemaining ?? 0}F)`
            : (char.executePhase === "PLANT_LOCK"
                ? "PLANTING"
                : (char.tacticalOrder?.role || (char.isHoldingCrossfire ? "HOLD_ANGLE" : "ADVANCE")));

        ctx.font = "bold 9px 'Share Tech Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "#a7f3d0";
        ctx.fillText(stateLabel, char.x, char.y - 44);
    }

    ctx.restore();
}

/* ==========================================================================
   MAIN RENDER ENTRYPOINT
   ========================================================================== */
export function renderGame(ctx, radarCtx, screenWidth, screenHeight) {
    const activeFocus = getActiveFocus();
    const player = world.player;
    const viewerTeam = player ? player.team : world.playerTeam;
    updateSmokeTransition(activeFocus);

    ctx.save();
    ctx.clearRect(0, 0, screenWidth, screenHeight);

    ctx.translate(screenWidth / 2, screenHeight / 2);
    ctx.scale(world.cameraZoom, world.cameraZoom);
    ctx.translate(-screenWidth / 2, -screenHeight / 2);
    ctx.translate(-world.cameraX, -world.cameraY);

    renderMapLayer(ctx);
    renderEffectsAndVision(ctx, activeFocus, viewerTeam, player);
    renderUtilityLayer(ctx, activeFocus, viewerTeam, player);
    renderObjectivesAndItems(ctx, viewerTeam, player);
    renderEntitiesLayer(ctx, activeFocus, viewerTeam, player);
    renderBotDebugOverlay(ctx);

    ctx.globalAlpha = 1.0;
    renderUtilityLandingPreview(ctx);
    renderAWPScopeLaser(ctx, activeFocus);
    renderDynamicCrosshair(ctx);

    if (activeFocus && !activeFocus.isDead && activeFocus.isScoped && activeFocus.getEquippedKey() === "AWP") {
        renderAWPScopeOverlay(ctx, screenWidth, screenHeight, activeFocus.scopeLevel || 1);
    }

    if (player && !player.isDead && player.blindTimer > 0) {
        const flashAlpha = Math.min(1.0, player.blindTimer / 1.5);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha * 0.95})`;
        ctx.fillRect(0, 0, screenWidth, screenHeight);
        ctx.restore();
    }

    ctx.restore();

    renderPlayerSmokeScreen(ctx, activeFocus, screenWidth, screenHeight);
    renderDirectionalDamageIndicators(ctx, screenWidth / 2, screenHeight / 2);

    if (radarCtx) {
        renderRadar(radarCtx, canViewerSeePointAcrossSmoke);
    }
}

function renderDirectionalDamageIndicators(ctx, centerX, centerY) {
    if (!world.directionalIndicators || world.directionalIndicators.length === 0) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = world.directionalIndicators.length - 1; i >= 0; i--) {
        const ind = world.directionalIndicators[i];
        ind.alpha -= 0.022;
        if (ind.alpha <= 0) {
            world.directionalIndicators.splice(i, 1);
            continue;
        }

        const arcRadius = 74;
        const arcSpread = ind.isHeadshot ? 0.42 : 0.32;
        ctx.beginPath();
        ctx.arc(centerX, centerY, arcRadius, ind.angle - arcSpread, ind.angle + arcSpread);
        ctx.strokeStyle = ind.isHeadshot
            ? `rgba(255, 45, 45, ${Math.min(1, ind.alpha).toFixed(3)})`
            : `rgba(225, 35, 35, ${Math.min(0.9, ind.alpha).toFixed(3)})`;
        ctx.lineWidth = ind.isHeadshot ? 8 : 6;
        ctx.lineCap = "round";
        ctx.stroke();
    }
    ctx.restore();
}