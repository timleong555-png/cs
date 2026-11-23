/* ==========================================================================
   ENTRY POINT: INPUT LISTENERS, GAME LOOP & MATCH INITIALIZATION
   ========================================================================== */
import {
    world,
    matchState,
    c4State,
    keys,
    mouse,
    audio,
    rnd,
    TORSO_RADIUS,
    getAWPScopeConfig,
    updateCharacterLists,
    getActiveFocus,
    showAnnouncerBanner
} from './state.js';
import { MAP, isStrictlyInsideSite } from './js-map-physics/dedust2map.js';
import { checkWallCollision, isPointInFire, getMapLineOfSight } from './js-map-physics/map-physics.js';
import { WEAPONS } from './combat-match/Weapon-behavior.js';
import { updateBullets, updateGrenades, performAttack, startReload, dropEquippedWeapon } from './combat-match/Combat.js';
import { startNewMatch, endRound, checkRoundConditions, triggerC4Plant, triggerC4Defused, triggerC4Explosion, quickBuyFull, quickBuyEco } from './combat-match/Match-cycle.js';
import { updateBotAI } from './Bot/Bot-Brain.js';
import {
    updateDesignatedRetriever,
    updateDesignatedDefuser,
    evaluateAdaptiveTStrategy,
    assignSquadTacticalOrders,
    updateCTRetakeMacro
} from './Bot/Bot-Tactics.js';
import { renderGame } from './display Huv/Game-render.js';
import { updateHUD, initHUDListeners, toggleBuyMenu, togglePauseMenu, returnToMainMenu } from './display Huv/Game-UI.js';
import { emitBotFootstep } from './js-map-physics/Map-Finding.js';


/* ==========================================================================
   INPUT EVENT LISTENERS & SPECTATOR SYSTEM
   ========================================================================== */
window.addEventListener('keydown', (e) => {
    keys[e.code] = true;

    if (world.gameState === "PLAYING" && world.player) {
        if (!world.player.isDead) {
            if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'].includes(e.code)) {
                cancelPlayerBombAction(world.player);
            }
            if (e.code === 'Digit1') world.player.selectSlot(1);
            if (e.code === 'Digit2') world.player.selectSlot(2);
            if (e.code === 'Digit3') world.player.selectSlot(3);
            if (e.code === 'Digit4') world.player.selectSlot(4);
            if (e.code === 'Digit5') world.player.selectSlot(5);
            if (e.code === 'Digit6') world.player.selectSlot(6);
            if (e.code === 'Digit7') world.player.selectSlot(7);
            if (e.code === 'Digit8') world.player.selectSlot(8);

            if (e.code === 'KeyQ' && world.player.previousSlot && world.player.previousSlot !== world.player.activeSlot) {
                cancelPlayerBombAction(world.player);
                world.player.selectSlot(world.player.previousSlot);
            }

            if (e.code === 'KeyG') {
                cancelPlayerBombAction(world.player);
                dropEquippedWeapon(world.player);
            }
            if (e.code === 'KeyB') toggleBuyMenu();
            if (e.code === 'KeyR') {
                cancelPlayerBombAction(world.player);
                startReload(world.player);
            }
        } else {
            if (e.code === 'Space' || e.code === 'KeyA' || e.code === 'KeyD') {
                cycleSpectatorTarget();
            }
        }
    }

    if (e.code === 'Tab') {
        e.preventDefault();
        document.getElementById('scoreboard')?.classList.remove('hidden');
    }
    if (e.code === 'Escape') {
        const buyMenu = document.getElementById('buy-menu');
        if (buyMenu && !buyMenu.classList.contains('hidden')) {
            buyMenu.classList.add('hidden');
            return;
        }

        if (world.gameState === "PLAYING" || world.gameState === "PAUSED") {
            togglePauseMenu();
        }
    }
});

window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'Tab') {
        document.getElementById('scoreboard')?.classList.add('hidden');
    }
});

window.addEventListener('wheel', (e) => {
    if (e.deltaY === 0) return;

    if (world.gameState === "PLAYING" && world.player && !world.player.isDead) {
        const availableSlots = [1, 2, 3];
        if (world.player.hasHE) availableSlots.push(4);
        if (world.player.hasSmoke) availableSlots.push(5);
        if (world.player.hasC4) availableSlots.push(6);
        if (world.player.hasFlash) availableSlots.push(7);
        if (world.player.hasMolotov) availableSlots.push(8);

        let currentIdx = availableSlots.indexOf(world.player.activeSlot);
        if (currentIdx === -1) currentIdx = 0;

        if (e.deltaY > 0) {
            // Roll up: 1 -> 2 -> 3 -> ... -> last slot (8) -> 1
            currentIdx = (currentIdx + 1) % availableSlots.length;
        } else {
            // Roll down: last slot (8) -> ... -> 3 -> 2 -> 1 -> last slot (8)
            currentIdx = (currentIdx - 1 + availableSlots.length) % availableSlots.length;
        }
        cancelPlayerBombAction(world.player);
        world.player.selectSlot(availableSlots[currentIdx]);
    }
});

window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

const canvas = document.getElementById('gameCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const radarCanvas = document.getElementById('radarCanvas');
const radarCtx = radarCanvas ? radarCanvas.getContext('2d') : null;

let screenWidth = window.innerWidth;
let screenHeight = window.innerHeight;

function resizeCanvas() {
    screenWidth = window.innerWidth;
    screenHeight = window.innerHeight;
    if (canvas) {
        canvas.width = screenWidth;
        canvas.height = screenHeight;
    }
    if (radarCanvas) {
        radarCanvas.width = 160;
        radarCanvas.height = 160;
    }
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

if (canvas) {
    canvas.addEventListener('mousedown', (e) => {
        if (world.gameState !== "PLAYING") return;
        audio.init();
        if (e.button === 0) {
            mouse.isDown = true;
            if (world.player && world.player.isDead) {
                cycleSpectatorTarget();
            }
        }
        if (e.button === 2) {
            mouse.isRightDown = true;
            if (world.player &&
                !world.player.isDead &&
                world.player.getEquippedKey() === "AWP" &&
                (world.player.equipTimer || 0) <= 0) {
                const nextLevel = ((world.player.scopeLevel || 0) + 1) % 4;
                world.player.scopeLevel = nextLevel;
                audio.playScopeZoom(nextLevel);
            }
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (e.button === 0) mouse.isDown = false;
        if (e.button === 2) mouse.isRightDown = false;
    });
}

window.addEventListener('contextmenu', (e) => e.preventDefault());

function cancelPlayerBombAction(player) {
    if (!player) return;
    if (c4State.planter === player) {
        c4State.plantProgress = 0;
        c4State.planter = null;
    }
    if (c4State.designatedDefuser === player && c4State.isBeingDefused) {
        c4State.defuseProgress = 0;
        c4State.isBeingDefused = false;
        c4State.designatedDefuser = null;
    }
}

function cycleSpectatorTarget() {
    if (world.player && world.player.isDead && (world.gameTime - (world.playerDeathTime || -99)) < 3.0) {
        return;
    }
    const aliveTeammates = world.allCharacters.filter(e => e && !e.isDead && e.team === world.playerTeam);
    if (aliveTeammates.length > 0) {
        world.spectatorIndex = (world.spectatorIndex + 1) % aliveTeammates.length;
    }
}

/* ==========================================================================
   GAME LOOP & 60HZ UPDATE ACCUMULATOR
   ========================================================================== */
function updateGame(dt) {
    world.gameTime += dt;
    updateCharacterLists();

    const allEntitiesForReload = [world.player, ...world.bots].filter(e => e && !e.isDead);
    allEntitiesForReload.forEach(char => {
        char.vx = (char.x - (char.prevX !== undefined ? char.prevX : char.x)) / dt;
        char.vy = (char.y - (char.prevY !== undefined ? char.prevY : char.y)) / dt;
        char.prevX = char.x;
        char.prevY = char.y;

        const currentVelocity = Math.hypot(char.vx, char.vy);
        char.isMoving = currentVelocity > 15;

        if (char.blindTimer > 0) char.blindTimer = Math.max(0, char.blindTimer - dt);
        if (char.tagTimer > 0) char.tagTimer = Math.max(0, char.tagTimer - dt);
        if (char.equipTimer > 0) char.equipTimer = Math.max(0, char.equipTimer - dt);

        const timeSinceLastShot = world.gameTime - (char.lastShotTime || 0);
        const isDeagle = char.getEquippedKey && char.getEquippedKey() === "DEAGLE";
        const TAP_COOLDOWN_WINDOW = isDeagle ? 1.0 : 0.55;

        if (timeSinceLastShot >= TAP_COOLDOWN_WINDOW) {
            char.shotsFired = 0;
            char.recoilBloom = 0;
            char.tapCount = 0;
            char.recoilHeat = 0;
        } else {
            const bloomDecayRate = isDeagle ? 0.18 : 1.15;
            char.recoilBloom = Math.max(0, char.recoilBloom - dt * bloomDecayRate);
        }

        if (char.isReloading) {
            char.reloadTimer -= dt;
            if (char.reloadTimer <= 0) {
                char.isReloading = false;
                char.reloadTimer = 0;
                char.shotsFired = 0;
                char.recoilBloom = 0;
                char.reloadCoverSpot = null;
                const key = char.getEquippedKey();
                const wep = char.getWeapon();
                if (wep && char.clips[key] !== undefined && char.reserves[key] !== undefined) {
                    const needed = wep.clip - char.clips[key];
                    const transfer = Math.min(needed, char.reserves[key]);
                    char.clips[key] += transfer;
                    char.reserves[key] -= transfer;
                }
            }
        }
    });

    for (let i = world.soundRipples.length - 1; i >= 0; i--) {
        const s = world.soundRipples[i];
        s.radius += 180 * dt;
        s.alpha -= 1.8 * dt;
        if (s.alpha <= 0) world.soundRipples.splice(i, 1);
    }

    world.recentAcousticEvents = world.recentAcousticEvents.filter(e => world.gameTime - e.time < 2.0);

    updateDesignatedRetriever();
    updateDesignatedDefuser();
    if (matchState.roundPhase === "COMBAT") {
        evaluateAdaptiveTStrategy();
        assignSquadTacticalOrders();
        updateCTRetakeMacro(dt);
    }

    const roundElapsed = 115 - matchState.roundTimer;

    if (matchState.roundPhase === "BUY_TIME") {
        matchState.freezeTimer -= dt;
        if (matchState.freezeTimer <= 0) {
            matchState.roundPhase = "COMBAT";
            audio.announce("Let's go");
        }
    } else if (matchState.roundPhase === "COMBAT") {
        checkRoundConditions();

        if (!c4State.isPlanted) {
            matchState.roundTimer -= dt;
            if (matchState.roundTimer <= 0) {
                endRound("CT", "TARGET PROTECTED - TIME EXPIRED");
            }
        } else {
            c4State.timer -= dt;
            c4State.beepTimer += dt;

            const interval = c4State.timer > 20 ? 1.0 : (c4State.timer > 8 ? 0.5 : 0.2);
            if (c4State.beepTimer >= interval) {
                audio.playC4Beep(c4State.timer < 8 ? 1.35 : (c4State.timer < 20 ? 1.15 : 1.0), c4State.plantX, c4State.plantY);
                c4State.beepTimer = 0;
            }
            if (c4State.timer <= 0) {
                triggerC4Explosion();
            }
        }
    }

    const allAlive = world.allCharacters.filter(e => e && !e.isDead);
    if (roundElapsed > 2.0) {
        for (let i = 0; i < allAlive.length; i++) {
            for (let j = i + 1; j < allAlive.length; j++) {
                const a = allAlive[i];
                const b = allAlive[j];

                if (a.executePhase === "PLANT_LOCK" || b.executePhase === "PLANT_LOCK" || a.isDefusing || b.isDefusing) {
                    continue;
                }

                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dist = Math.hypot(dx, dy);
                const minDist = a.radius + b.radius + 2;

                if (dist < minDist && dist > 0.5) {
                    const overlap = (minDist - dist) * 0.5;
                    const nx = dx / dist;
                    const ny = dy / dist;

                    const hasActiveFire = world.firePatches.length > 0;
                    const inFireA = (px, py) => hasActiveFire && world.firePatches.some(f => f.life > 0.35 && isPointInFire(px, py, f, a.radius + 14));
                    const inFireB = (px, py) => hasActiveFire && world.firePatches.some(f => f.life > 0.35 && isPointInFire(px, py, f, b.radius + 14));
                    if (!checkWallCollision(a.x - nx * overlap, a.y - ny * overlap, a.radius) &&
                        (inFireA(a.x, a.y) || !inFireA(a.x - nx * overlap, a.y - ny * overlap))) {
                        a.x -= nx * overlap;
                        a.y -= ny * overlap;
                    }
                    if (!checkWallCollision(b.x + nx * overlap, b.y + ny * overlap, b.radius) &&
                        (inFireB(b.x, b.y) || !inFireB(b.x + nx * overlap, b.y + ny * overlap))) {
                        b.x += nx * overlap;
                        b.y += ny * overlap;
                    }
                }
            }
        }
    }

    const player = world.player;
    if (player) {
        for (let i = world.hitmarkers.length - 1; i >= 0; i--) {
            world.hitmarkers[i].life -= dt;
            if (world.hitmarkers[i].life <= 0) world.hitmarkers.splice(i, 1);
        }

        if (player.isDead) {
            player.blindTimer = 0;
        } else {
            let moveX = 0;
            let moveY = 0;

            if (keys['KeyW']) moveY -= 1;
            if (keys['KeyS']) moveY += 1;
            if (keys['KeyA']) moveX -= 1;
            if (keys['KeyD']) moveX += 1;

            const isPlayerMoving = (moveX !== 0 || moveY !== 0);
            player.isSilentWalking = keys['ShiftLeft'] || keys['ShiftRight'];
            player.isCrouching = keys['ControlLeft'] || keys['KeyC'];
            player.isMoving = isPlayerMoving;

            if (isPlayerMoving) {
                const len = Math.hypot(moveX, moveY);
                const wep = player.getWeapon();
                let moveSpeed = 190 * wep.moveSpeedMult;
                if (player.isSilentWalking) moveSpeed *= 0.5;
                if (player.isScoped && player.getEquippedKey() === "AWP") {
                    moveSpeed *= getAWPScopeConfig(player.scopeLevel).moveSpeedMult;
                }

                if (player.tagTimer > 0) {
                    const recoveryFactor = 1.0 - (player.tagTimer / 1.0);
                    const currentTagMult = player.tagSlowMult + (1.0 - player.tagSlowMult) * recoveryFactor;
                    moveSpeed *= currentTagMult;
                }
                const dx = (moveX / len) * moveSpeed * dt;
                const dy = (moveY / len) * moveSpeed * dt;

                if (!checkWallCollision(player.x + dx, player.y, player.radius)) player.x += dx;
                if (!checkWallCollision(player.x, player.y + dy, player.radius)) player.y += dy;
                emitBotFootstep(player, dt, moveSpeed);
            }

            player.angle = Math.atan2(mouse.worldY - player.y, mouse.worldX - player.x);

            const equippedWep = player.getWeapon();
            const isUsingUtility = equippedWep && equippedWep.category === "grenade" && (mouse.isDown || mouse.isRightDown);
            const isShooting = equippedWep && equippedWep.category !== "grenade" && equippedWep.category !== "c4" && mouse.isDown;
            const isBombActionInterrupted = isPlayerMoving || isShooting || isUsingUtility;

            if (isBombActionInterrupted) {
                cancelPlayerBombAction(player);
            }

            if ((mouse.isDown || mouse.isRightDown) && (player.equipTimer || 0) <= 0) {
                performAttack(player, mouse.worldX, mouse.worldY, mouse.isRightDown);
            }

            if (keys['KeyE'] && !isBombActionInterrupted) {
                if (player.team === "T" && player.hasC4) {
                    const inA = isStrictlyInsideSite(player.x, player.y, MAP.siteA);
                    const inB = isStrictlyInsideSite(player.x, player.y, MAP.siteB);
                    if (inA || inB) {
                        c4State.plantProgress += dt / 3.2;
                        c4State.planter = player;
                        if (c4State.plantProgress >= 1.0) {
                            triggerC4Plant(player, inA ? 'A' : 'B');
                        }
                    } else if (c4State.planter === player) {
                        cancelPlayerBombAction(player);
                    }
                } else if (player.team === "CT" && c4State.isPlanted) {
                    const distToC4 = Math.hypot(c4State.plantX - player.x, c4State.plantY - player.y);
                    if (distToC4 <= 40 && getMapLineOfSight(player.x, player.y, c4State.plantX, c4State.plantY)) {
                        if (!c4State.isBeingDefused) {
                            audio.playDefuseClick(c4State.plantX, c4State.plantY);
                        }
                        c4State.designatedDefuser = player;
                        c4State.isBeingDefused = true;
                        c4State.lastDefuseSoundTime = world.gameTime;
                        const defuseTime = player.hasDefuseKit ? 5.0 : 10.0;
                        c4State.defuseProgress += dt / defuseTime;
                        if (c4State.defuseProgress >= 1.0) {
                            triggerC4Defused();
                        }
                    } else if (c4State.designatedDefuser === player) {
                        cancelPlayerBombAction(player);
                    }
                }
            } else {
                cancelPlayerBombAction(player);
            }

            if (player.team === "T" && c4State.isDropped) {
                const dist = Math.hypot(c4State.dropX - player.x, c4State.dropY - player.y);
                if (dist < 40) {
                    c4State.isDropped = false;
                    player.hasC4 = true;
                    c4State.carrier = player;
                    audio.announce("Got the bomb", "T");
                    showAnnouncerBanner("C4 RECOVERED", "YOU RECOVERED THE C4 BOMB!", "T");
                }
            }
        }
    }

    const activeCameraTarget = getActiveFocus();
    const isFocusAWPScoped = activeCameraTarget && !activeCameraTarget.isDead && activeCameraTarget.isScoped && activeCameraTarget.getEquippedKey() === "AWP";
    const activeScopeCfg = isFocusAWPScoped ? getAWPScopeConfig(activeCameraTarget.scopeLevel || 1) : null;
    const rawTargetZoom = activeScopeCfg ? activeScopeCfg.cameraZoom : 1.0;
    const targetZoom = (Number.isFinite(rawTargetZoom) && rawTargetZoom > 0.05) ? rawTargetZoom : 1.0;
    if (!Number.isFinite(world.cameraZoom) || world.cameraZoom <= 0.05) {
        world.cameraZoom = 1.0;
    }
    world.cameraZoom += (targetZoom - world.cameraZoom) * 8 * dt;

    const safeZoom = (Number.isFinite(world.cameraZoom) && world.cameraZoom > 0.01) ? world.cameraZoom : 1.0;
    const safeCamX = Number.isFinite(world.cameraX) ? world.cameraX : 0;
    const safeCamY = Number.isFinite(world.cameraY) ? world.cameraY : 0;

    mouse.worldX = (mouse.x - screenWidth / 2) / safeZoom + screenWidth / 2 + safeCamX;
    mouse.worldY = (mouse.y - screenHeight / 2) / safeZoom + screenHeight / 2 + safeCamY;

    // Update Bots
    world.bots.forEach(bot => updateBotAI(bot, dt));

    if (c4State.isPlanted) {
        const playerIsDefusing = player && !player.isDead && player.team === "CT" &&
            !player.isMoving && keys['KeyE'] && Math.hypot(c4State.plantX - player.x, c4State.plantY - player.y) <= 40 &&
            getMapLineOfSight(player.x, player.y, c4State.plantX, c4State.plantY);
        const botIsDefusing = world.livingCT.some(b => b.isBot && b.isDefusing);

        if (!playerIsDefusing && !botIsDefusing) {
            c4State.isBeingDefused = false;
            c4State.defuseProgress = 0;
            c4State.designatedDefuser = null;
        }
    }

    // Dropped Weapon Pickups
    for (let i = world.droppedWeapons.length - 1; i >= 0; i--) {
        const item = world.droppedWeapons[i];
        const aliveList = allEntitiesForReload;

        for (const char of aliveList) {
            const dist = Math.hypot(char.x - item.x, char.y - item.y);
            if (dist < 35) {
                const wepInfo = WEAPONS[item.key];
                if (!wepInfo) continue;

                if (wepInfo.slot === 1 && !char.primaryKey) {
                    char.primaryKey = item.key;
                    char.clips[item.key] = item.clip;
                    char.reserves[item.key] = item.reserve !== undefined ? item.reserve : wepInfo.maxReserve;
                    if (char === player && char.activeSlot !== 1) char.selectSlot(1);
                    world.droppedWeapons.splice(i, 1);
                    break;
                } else if (wepInfo.slot === 2 && !char.secondaryKey) {
                    char.secondaryKey = item.key;
                    char.clips[item.key] = item.clip;
                    char.reserves[item.key] = item.reserve !== undefined ? item.reserve : wepInfo.maxReserve;
                    world.droppedWeapons.splice(i, 1);
                    break;
                } else if (item.key === "HEGRENADE" && !char.hasHE) {
                    char.hasHE = true;
                    world.droppedWeapons.splice(i, 1);
                    break;
                } else if (item.key === "SMOKE" && !char.hasSmoke) {
                    char.hasSmoke = true;
                    world.droppedWeapons.splice(i, 1);
                    break;
                } else if (item.key === "FLASH" && !char.hasFlash) {
                    char.hasFlash = true;
                    world.droppedWeapons.splice(i, 1);
                    break;
                } else if (item.key === "MOLOTOV" && !char.hasMolotov) {
                    char.hasMolotov = true;
                    world.droppedWeapons.splice(i, 1);
                    break;
                }
            }
        }
    }

    updateBullets(dt);
    updateGrenades(dt);

    for (let i = world.particles.length - 1; i >= 0; i--) {
        const p = world.particles[i];
        p.life -= dt;
        const nextX = p.x + p.vx * dt;
        const nextY = p.y + p.vy * dt;

        if (!p.isSmoke && !p.isDust && checkWallCollision(nextX, nextY, Math.max(2, (p.size || 3) * 0.5))) {
            world.particles.splice(i, 1);
            continue;
        }
        p.x = nextX;
        p.y = nextY;

        if (p.isSmoke || p.isDust) {
            p.size += dt * 3.5;
            const alpha = Math.max(0, (p.life / p.maxLife) * (p.isSmoke ? 0.35 : 0.55));
            p.color = p.isSmoke ? `rgba(220, 225, 230, ${alpha.toFixed(2)})` : `rgba(180, 170, 150, ${alpha.toFixed(2)})`;
        }

        if (p.life <= 0) world.particles.splice(i, 1);
    }

    if (world.particles.length > 120) world.particles.splice(0, world.particles.length - 120);
    if (world.decals.length > 40) world.decals.splice(0, world.decals.length - 40);
    if (world.soundRipples.length > 40) world.soundRipples.splice(0, world.soundRipples.length - 20);

    if (world.cameraShake > 0) world.cameraShake = Math.max(0, world.cameraShake - dt * 40);

    world.cameraRecoilX += (0 - world.cameraRecoilX) * Math.min(1.0, dt * 18);
    world.cameraRecoilY += (0 - world.cameraRecoilY) * Math.min(1.0, dt * 18);

    if (activeCameraTarget) {
        let lookAheadX = 0;
        let lookAheadY = 0;
        if (player && !player.isDead && player.isScoped && player.getEquippedKey() === "AWP") {
            const pScopeCfg = getAWPScopeConfig(player.scopeLevel);
            lookAheadX = (mouse.worldX - player.x) * pScopeCfg.lookAhead;
            lookAheadY = (mouse.worldY - player.y) * pScopeCfg.lookAhead;
        }
        world.cameraX = (activeCameraTarget.x + lookAheadX + world.cameraRecoilX) - screenWidth / 2 + (rnd() - 0.5) * world.cameraShake;
        world.cameraY = (activeCameraTarget.y + lookAheadY + world.cameraRecoilY) - screenHeight / 2 + (rnd() - 0.5) * world.cameraShake;
    }
}

function renderWeaponEquipIndicator(ctx) {
    if (!ctx || !world.player || world.player.isDead) return;
    const rem = world.player.equipTimer || 0;
    const dur = world.player.equipDuration || 0;
    if (rem <= 0 || dur <= 0) return;

    const rawProgress = Math.max(0, Math.min(1, 1 - (rem / dur)));
    // Smooth cubic ease-out so crosshair ticks glide inward and snap crisp at 100%
    const eased = 1 - Math.pow(1 - rawProgress, 3);

    const cx = mouse.x;
    const cy = mouse.y;
    const ringRadius = 15;
    const outerGap = 18 - eased * 12;
    const tickLen = 5;

    ctx.save();

    // Subtle background track ring
    ctx.beginPath();
    ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Smooth amber-to-white deploy progress arc
    const startAng = -Math.PI / 2;
    const endAng = startAng + (Math.PI * 2 * eased);
    ctx.beginPath();
    ctx.arc(cx, cy, ringRadius, startAng, endAng);
    ctx.strokeStyle = eased > 0.85 ? 'rgba(255, 255, 255, 0.85)' : 'rgba(251, 191, 36, 0.80)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Contracting CS-style crosshair deploy ticks
    ctx.strokeStyle = `rgba(255, 255, 255, ${(0.35 + eased * 0.55).toFixed(2)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - outerGap - tickLen, cy);
    ctx.lineTo(cx - outerGap, cy);
    ctx.moveTo(cx + outerGap, cy);
    ctx.lineTo(cx + outerGap + tickLen, cy);
    ctx.moveTo(cx, cy - outerGap - tickLen);
    ctx.lineTo(cx, cy - outerGap);
    ctx.moveTo(cx, cy + outerGap);
    ctx.lineTo(cx, cy + outerGap + tickLen);
    ctx.stroke();

    ctx.restore();
}

const FIXED_DT = 1 / 60;
let accumulator = 0;
let lastFrameTime = performance.now();
let lastHUDUpdate = 0;

function gameLoop(currentTime) {
    let frameTime = (currentTime - lastFrameTime) / 1000;
    if (frameTime > 0.05) frameTime = 0.05;
    lastFrameTime = currentTime;

    if (world.gameState === "PLAYING") {
        accumulator += frameTime;
        if (accumulator >= FIXED_DT) {
            try {
                updateGame(FIXED_DT);
            } catch (frameErr) {
                console.error("Frame update caught:", frameErr);
            }
            accumulator %= FIXED_DT;
        }

        if (currentTime - lastHUDUpdate > 66) {
            lastHUDUpdate = currentTime;
            updateHUD();
        }

        try {
            renderGame(ctx, radarCtx, screenWidth, screenHeight);
            renderWeaponEquipIndicator(ctx);
        } catch (renderErr) {
            console.error("Render frame caught:", renderErr);
        }
    } else if (world.gameState === "PAUSED") {
        try {
            renderGame(ctx, radarCtx, screenWidth, screenHeight);
        } catch (renderErr) {}
    }

    requestAnimationFrame(gameLoop);
}

window.addEventListener('cs:resumeLoop', () => {
    lastFrameTime = performance.now();
});

/* ==========================================================================
   DOM INITIALIZATION & BUTTON BINDINGS
   ========================================================================== */
function initGame() {
    initHUDListeners();
    audio.preloadGunSounds('./');

    const btnCT = document.getElementById('btn-select-ct');
    const btnT = document.getElementById('btn-select-t');
    const btnRestart = document.getElementById('btn-restart');
    const btnPresetFull = document.getElementById('btn-preset-full');
    const btnPresetEco = document.getElementById('btn-preset-eco');
    const btnCloseBuy = document.getElementById('btn-close-buy');

    if (btnCT) {
        btnCT.addEventListener('click', () => {
            try { audio.init(); } catch (e) { console.warn(e); }
            startNewMatch("CT");
        });
    }

    if (btnT) {
        btnT.addEventListener('click', () => {
            try { audio.init(); } catch (e) { console.warn(e); }
            startNewMatch("T");
        });
    }

    if (btnRestart) {
        btnRestart.addEventListener('click', () => {
            try { audio.init(); } catch (e) { console.warn(e); }
            startNewMatch(world.playerTeam);
        });
    }

    if (btnPresetFull) {
        btnPresetFull.addEventListener('click', () => {
            quickBuyFull();
        });
    }

    if (btnPresetEco) {
        btnPresetEco.addEventListener('click', () => {
            quickBuyEco();
        });
    }

    if (btnCloseBuy) {
        btnCloseBuy.addEventListener('click', () => {
            toggleBuyMenu();
        });
    }

    const btnPauseResume = document.getElementById('btn-pause-resume');
    const btnPauseRestart = document.getElementById('btn-pause-restart');
    const btnPauseMainMenu = document.getElementById('btn-pause-main-menu');
    const btnGameOverMenu = document.getElementById('btn-gameover-menu');

    if (btnPauseResume) {
        btnPauseResume.addEventListener('click', () => {
            togglePauseMenu(false);
        });
    }

    if (btnPauseRestart) {
        btnPauseRestart.addEventListener('click', () => {
            togglePauseMenu(false);
            startNewMatch(world.playerTeam);
        });
    }

    if (btnPauseMainMenu) {
        btnPauseMainMenu.addEventListener('click', () => {
            returnToMainMenu();
        });
    }

    if (btnGameOverMenu) {
        btnGameOverMenu.addEventListener('click', () => {
            returnToMainMenu();
        });
    }

    requestAnimationFrame(gameLoop);
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initGame);
} else {
    initGame();
}