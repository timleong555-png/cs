/* ==========================================================================
   TACTICAL MINIMAP RADAR, HEATMAP & ACOUSTIC RIPPLES
   ========================================================================== */
import {
    world,
    c4State,
    FOOTSTEP_LISTEN_RADIUS,
    getActiveFocus
} from '../state.js';
import { MAP } from '../js-map-physics/dedust2map.js';
import { isPointVisibleToTeam, isInsideSmoke } from '../js-map-physics/map-physics.js';
import { NAV_TOTAL, navHeatmap, navCellToWorld } from '../js-map-physics/Map-Finding.js';

export function renderRadar(radarCtx, canViewerSeePointAcrossSmoke) {
    const activeFocus = getActiveFocus();
    const player = world.player;
    const viewerTeam = player ? player.team : world.playerTeam;

    radarCtx.clearRect(0, 0, 160, 160);
    radarCtx.fillStyle = "#111827";
    radarCtx.fillRect(0, 0, 160, 160);

    const scaleX = 160 / MAP.width;
    const scaleY = 160 / MAP.height;

    radarCtx.fillStyle = "#374151";
    for (const wall of MAP.walls) {
        radarCtx.fillRect(wall.x * scaleX, wall.y * scaleY, wall.w * scaleX, wall.h * scaleY);
    }

    if (MAP.shadedZones) {
        radarCtx.fillStyle = "#27272a";
        for (const zone of MAP.shadedZones) {
            radarCtx.fillRect(zone.x * scaleX, zone.y * scaleY, zone.w * scaleX, zone.h * scaleY);
        }
    }

    radarCtx.fillStyle = "rgba(239, 68, 68, 0.35)";
    radarCtx.strokeStyle = "rgba(239, 68, 68, 0.85)";
    radarCtx.lineWidth = 1.5;

    radarCtx.fillRect(MAP.siteA.x * scaleX, MAP.siteA.y * scaleY, MAP.siteA.w * scaleX, MAP.siteA.h * scaleY);
    radarCtx.strokeRect(MAP.siteA.x * scaleX, MAP.siteA.y * scaleY, MAP.siteA.w * scaleX, MAP.siteA.h * scaleY);

    radarCtx.fillRect(MAP.siteB.x * scaleX, MAP.siteB.y * scaleY, MAP.siteB.w * scaleX, MAP.siteB.h * scaleY);
    radarCtx.strokeRect(MAP.siteB.x * scaleX, MAP.siteB.y * scaleY, MAP.siteB.w * scaleX, MAP.siteB.h * scaleY);

    // Grid Heatmap Overlay
    for (let idx = 0; idx < NAV_TOTAL; idx += 3) {
        const heat = navHeatmap[idx];
        if (heat > 2) {
            const intensity = Math.min(1.0, heat / 20);
            const pt = navCellToWorld(idx);
            radarCtx.fillStyle = `rgba(239, 68, 68, ${intensity * 0.45})`;
            radarCtx.beginPath();
            radarCtx.arc(pt.x * scaleX, pt.y * scaleY, 4, 0, Math.PI * 2);
            radarCtx.fill();
        }
    }

    const viewerInSmoke = activeFocus && isInsideSmoke(activeFocus.x, activeFocus.y);
 if (!viewerInSmoke) {
     for (const s of world.soundRipples) {
         const isFriendly = s.owner && s.owner.team === world.playerTeam;
         const distToFocus = activeFocus ? Math.hypot(s.x - activeFocus.x, s.y - activeFocus.y) : Infinity;
         if (!isFriendly && (distToFocus > 200 || isInsideSmoke(s.x, s.y))) continue;

         const radarDrawX = isFriendly ? s.x : (s.x + (s.fuzzX || 0));
         const radarDrawY = isFriendly ? s.y : (s.y + (s.fuzzY || 0));

         radarCtx.strokeStyle = isFriendly ? "rgba(96, 165, 250, 0.85)" : "rgba(239, 68, 68, 0.9)";
         radarCtx.lineWidth = 1.5;
         radarCtx.beginPath();
         radarCtx.arc(radarDrawX * scaleX, radarDrawY * scaleY, s.radius * scaleX, 0, Math.PI * 2);
         radarCtx.stroke();
     }
 }

    for (const char of world.allCharacters) {
        if (!char || char.isDead) continue;

        const isSpottedByTeam = isPointVisibleToTeam(char.x, char.y, viewerTeam) &&
            canViewerSeePointAcrossSmoke(activeFocus, char.x, char.y, char);

        if (char.team === viewerTeam || isSpottedByTeam || (player && player.isDead)) {
            radarCtx.fillStyle = char.team === "CT" ? "#60a5fa" : "#f87171";
            radarCtx.beginPath();
            radarCtx.arc(char.x * scaleX, char.y * scaleY, 3, 0, Math.PI * 2);
            radarCtx.fill();
        } else if (char.lastSpottedTime && (world.gameTime - char.lastSpottedTime < 3.5)) {
            const ghostAlpha = 1.0 - ((world.gameTime - char.lastSpottedTime) / 3.5);
            radarCtx.fillStyle = `rgba(239, 68, 68, ${ghostAlpha * 0.7})`;
            radarCtx.beginPath();
            radarCtx.arc(char.lastSpottedX * scaleX, char.lastSpottedY * scaleY, 2.5, 0, Math.PI * 2);
            radarCtx.fill();
        }
    }

    if (c4State.isPlanted && (isPointVisibleToTeam(c4State.plantX, c4State.plantY, viewerTeam) || (player && player.isDead))) {
        radarCtx.fillStyle = "#ef4444";
        radarCtx.beginPath();
        radarCtx.arc(c4State.plantX * scaleX, c4State.plantY * scaleY, 5, 0, Math.PI * 2);
        radarCtx.fill();
    }
}