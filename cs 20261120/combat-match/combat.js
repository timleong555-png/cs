/* ==========================================================================
   COMBAT ACTIONS, ACOUSTIC ALERTS, BULLET BALLISTICS & GRENADE PHYSICS
   ========================================================================== */
import {
    world,
    matchState,
    c4State,
    mouse,
    FIXED_VISION_RANGE,
    rnd,
    audio,
    createMuzzleFlash,
    createAWPMuzzleDust,
    createSparkParticles,
    showAnnouncerBanner,
    invokeBallisticImpact
} from '../state.js';
import { MAP } from '../js-map-physics/dedust2map.js';
import {
    checkWallCollision,
    lineIntersectsCircle,
    lineIntersectsRect,
    getMapLineOfSight,
    getRayObstacleEndpoint,
    getCollisionNormal,
    createSmokeCloud,
    createFirePatch,
    isPointInFire,
    getFuzzedAcousticPos
} from '../js-map-physics/map-physics.js';
import { WEAPONS, SPRAY_PATTERNS, getMovementInaccuracy } from './Weapon-behavior.js';

/* ==========================================================================
   ACOUSTIC & THREAT BROADCASTS
   ========================================================================== */
export function registerAWPShot(awper) {
    if (!awper || awper.isDead) return;
    world.activeAWPThreat = {
        shooter: awper,
        x: awper.x,
        y: awper.y,
        team: awper.team,
        time: world.gameTime
    };

    const opposingTeam = awper.team === "CT" ? "T" : "CT";
    const existingSignal = world.awpSwarmSignals.find(s => s.awper === awper && world.gameTime - s.time < 3.0);
    if (!existingSignal) {
        world.awpSwarmSignals.push({
            awper,
            x: awper.x,
            y: awper.y,
            team: opposingTeam,
            time: world.gameTime
        });
    }
}

export function registerVulnerabilityNoise(character, type, radius = 620) {
    if (!character) return;

    world.soundRipples.push({
        x: character.x,
        y: character.y,
        fuzzX: 0,
        fuzzY: 0,
        radius: 8,
        maxRadius: radius,
        alpha: 0.8,
        type,
        owner: character
    });

    for (let i = 0; i < world.bots.length; i++) {
        const b = world.bots[i];
        if (!b || b.isDead || b.team === character.team) continue;
        const dist = Math.hypot(character.x - b.x, character.y - b.y);
        if (dist <= radius) {
            b.lastHeardSound = {
                x: character.x,
                y: character.y,
                shooter: character,
                time: world.gameTime,
                type
            };
            b.vulnerableTarget = {
                target: character,
                time: world.gameTime,
                type
            };
        }
    }
}

export function registerGunfireNoise(shooter, radius) {
    if (!shooter) return;

    world.recentAcousticEvents.push({
        x: shooter.x,
        y: shooter.y,
        team: shooter.team,
        shooter,
        intensity: shooter.getWeapon().category === "sniper" ? 0.90 : 0.60,
        time: world.gameTime
    });

    const enemies = shooter.team === "CT" ? world.livingT : world.livingCT;
    for (let i = 0; i < enemies.length; i++) {
        const ent = enemies[i];
        if (!ent || !ent.isBot || ent.isDead) continue;

        const dist = Math.hypot(shooter.x - ent.x, shooter.y - ent.y);
        if (dist <= radius) {
            const noiseError = 25 + (dist / radius) * 65;
            const fuzzed = getFuzzedAcousticPos(shooter.x, shooter.y, noiseError);

            ent.lastHeardSound = {
                x: fuzzed.x,
                y: fuzzed.y,
                shooter: fuzzed.inSmoke ? null : shooter,
                time: world.gameTime,
                type: 'firing_trace'
            };
            if (ent.team === "CT") {
                world.lastEnemyIntelTimeCT = world.gameTime;
            }
        }
    }
}

/* ==========================================================================
   RELOAD, WEAPON DROP & ATTACK EXECUTION
   ========================================================================== */
export function startReload(char) {
    if (!char || char.isReloading || char.isDead) return;
    const key = char.getEquippedKey();
    const wep = char.getWeapon();
    if (wep.category === "knife" || wep.category === "c4" || wep.category === "grenade") return;

    const currentClip = char.getCurrentClip();
    const currentReserve = char.reserves ? (char.reserves[key] || 0) : 0;

    if (currentClip >= wep.clip || currentReserve <= 0) return;

    char.isReloading = true;
    char.reloadTimer = wep.reloadTime;

    audio.playReload(char.x, char.y, wep.reloadTime, char);
    registerVulnerabilityNoise(char, "reloading", 620);
}

export function dropEquippedWeapon(char) {
    if (!char || char.isDead || matchState.roundPhase === "ROUND_END") return;

    if (char.isReloading) {
        char.isReloading = false;
        char.reloadTimer = 0;
        char.reloadCoverSpot = null;
    }

    const slot = char.activeSlot;
    const dropAngle = char.angle;
    const rawX = char.x + Math.cos(dropAngle) * 25;
    const rawY = char.y + Math.sin(dropAngle) * 25;
    const isBlocked = checkWallCollision(rawX, rawY, 10);
    const spawnX = isBlocked ? char.x : rawX;
    const spawnY = isBlocked ? char.y : rawY;

    if (slot === 1 && char.primaryKey) {
        const dropKey = char.primaryKey;
        const skin = char.activeWeaponSkins?.[dropKey] || null;
        if (char.activeWeaponSkins) delete char.activeWeaponSkins[dropKey];

        world.droppedWeapons.push({
            x: spawnX,
            y: spawnY,
            key: dropKey,
            clip: char.clips[dropKey] || WEAPONS[dropKey].clip,
            reserve: char.reserves[dropKey] !== undefined ? char.reserves[dropKey] : WEAPONS[dropKey].maxReserve,
            skin
        });
        char.primaryKey = null;
        char.selectSlot(char.secondaryKey ? 2 : 3);
    } else if (slot === 2 && char.secondaryKey) {
        const dropKey = char.secondaryKey;
        const skin = char.activeWeaponSkins?.[dropKey] || null;
        if (char.activeWeaponSkins) delete char.activeWeaponSkins[dropKey];

        world.droppedWeapons.push({
            x: spawnX,
            y: spawnY,
            key: dropKey,
            clip: char.clips[dropKey] || WEAPONS[dropKey].clip,
            reserve: char.reserves[dropKey] !== undefined ? char.reserves[dropKey] : WEAPONS[dropKey].maxReserve,
            skin
        });
        char.secondaryKey = null;
        char.selectSlot(3);
    } else if (slot === 4 && char.hasHE) {
        char.hasHE = false;
        world.droppedWeapons.push({ x: spawnX, y: spawnY, key: "HEGRENADE", clip: 1 });
        if (char.hasSmoke) char.selectSlot(5);
        else char.selectSlot(char.primaryKey ? 1 : (char.secondaryKey ? 2 : 3));
    } else if (slot === 5 && char.hasSmoke) {
        char.hasSmoke = false;
        world.droppedWeapons.push({ x: spawnX, y: spawnY, key: "SMOKE", clip: 1 });
        if (char.hasHE) char.selectSlot(4);
        else char.selectSlot(char.primaryKey ? 1 : (char.secondaryKey ? 2 : 3));
    } else if (slot === 7 && char.hasFlash) {
        char.hasFlash = false;
        world.droppedWeapons.push({ x: spawnX, y: spawnY, key: "FLASH", clip: 1 });
        char.selectSlot(char.primaryKey ? 1 : (char.secondaryKey ? 2 : 3));
    } else if (slot === 8 && char.hasMolotov) {
        char.hasMolotov = false;
        world.droppedWeapons.push({ x: spawnX, y: spawnY, key: "MOLOTOV", clip: 1 });
        char.selectSlot(char.primaryKey ? 1 : (char.secondaryKey ? 2 : 3));
    } else if (slot === 6 && char.hasC4) {
        char.hasC4 = false;
        c4State.carrier = null;
        c4State.c4Retriever = null;
        c4State.isDropped = true;
        c4State.dropX = spawnX;
        c4State.dropY = spawnY;
        char.selectSlot(char.primaryKey ? 1 : (char.secondaryKey ? 2 : 3));
        audio.announce("Bomb has been dropped", "T");
        showAnnouncerBanner("BOMB DROPPED", "C4 BOMB HAS BEEN DROPPED!", "T");
    }
}

export function performAttack(attacker, targetX, targetY, isRightClick = false) {
    if (!attacker || attacker.isDead || attacker.isReloading) return;
    const wep = attacker.getWeapon();
    if (wep.category === "c4") return;

    if (isRightClick && wep.category !== "grenade") return;
    if (world.gameTime - attacker.lastShotTime < wep.fireRate) return;

    const currentClip = attacker.getCurrentClip();

    // Dry-fire click & acoustic vulnerability on empty chamber
    if (wep.category !== "knife" && wep.category !== "grenade" && currentClip <= 0) {
        if (world.gameTime - (attacker.lastDryFireTime || 0) >= 0.25) {
            attacker.lastDryFireTime = world.gameTime;
            audio.playDryFire(attacker.x, attacker.y, attacker);
            registerVulnerabilityNoise(attacker, "empty_click", 520);
        }

        const key = attacker.getEquippedKey();
        const reserve = attacker.reserves ? (attacker.reserves[key] || 0) : 0;
        if (reserve > 0) {
            startReload(attacker);
        } else if (attacker.isBot) {
            attacker.selectSlot(attacker.activeSlot === 1 && attacker.secondaryKey ? 2 : 3);
        }
        return;
    }

    // Cancel active plant or defuse lock on attack
    if (c4State.planter === attacker || attacker.executePhase === "PLANT_LOCK") {
        c4State.plantProgress = 0;
        c4State.planter = null;
        if (attacker.executePhase === "PLANT_LOCK") attacker.executePhase = "BREACH";
    }
    if (attacker.isDefusing || (c4State.designatedDefuser === attacker && c4State.isBeingDefused)) {
        attacker.isDefusing = false;
        c4State.isBeingDefused = false;
        c4State.defuseProgress = 0;
        if (c4State.designatedDefuser === attacker) c4State.designatedDefuser = null;
    }

    // Grenade Throwing
    if (wep.category === "grenade") {
        const thrownKey = attacker.getEquippedKey();
        if (!thrownKey) return;

        attacker.lastShotTime = world.gameTime;
        if (thrownKey === "HEGRENADE") attacker.hasHE = false;
        if (thrownKey === "SMOKE") attacker.hasSmoke = false;
        if (thrownKey === "FLASH") attacker.hasFlash = false;
        if (thrownKey === "MOLOTOV") attacker.hasMolotov = false;

        const isExtended = isRightClick;
        const throwAngle = Math.atan2(targetY - attacker.y, targetX - attacker.x);
        const throwSpeed = isExtended ? wep.speed * 2.0 : wep.speed;

        let spawnDist = 20;
        let spawnX = attacker.x + Math.cos(throwAngle) * spawnDist;
        let spawnY = attacker.y + Math.sin(throwAngle) * spawnDist;

        if (checkWallCollision(spawnX, spawnY, 8)) {
            spawnDist = 42;
            spawnX = attacker.x + Math.cos(throwAngle) * spawnDist;
            spawnY = attacker.y + Math.sin(throwAngle) * spawnDist;
        }

        world.grenades.push({
            x: spawnX,
            y: spawnY,
            vx: Math.cos(throwAngle) * throwSpeed,
            vy: Math.sin(throwAngle) * throwSpeed,
            type: thrownKey,
            damage: wep.damage,
            owner: attacker,
            fuse: 1.5,
            isExtended,
            hasLanded: false,
            landTimer: 0.5
        });

        if (attacker.hasHE) attacker.selectSlot(4);
        else if (attacker.hasSmoke) attacker.selectSlot(5);
        else if (attacker.hasFlash) attacker.selectSlot(7);
        else if (attacker.hasMolotov) attacker.selectSlot(8);
        else attacker.selectSlot(attacker.primaryKey ? 1 : (attacker.secondaryKey ? 2 : 3));
        return;
    }

    if (wep.category !== "knife") {
        attacker.setCurrentClip(currentClip - 1);
        if (attacker === world.player && wep.semiAuto) {
            mouse.isDown = false;
        }
    }

    const wepKey = attacker.getEquippedKey();
    const isSniper = wep.category === "sniper" || wepKey === "AWP";
    const isDeagle = wepKey === "DEAGLE";
    const timeSinceLastShot = world.gameTime - (attacker.lastShotTime || 0);

    const TAP_COOLDOWN_WINDOW = isDeagle ? 1.0 : 0.55;
    const recoveryDelay = Math.max(0.13, wep.fireRate * 1.8);
    if (timeSinceLastShot >= TAP_COOLDOWN_WINDOW) {
        attacker.tapCount = 0;
        attacker.shotsFired = 0;
        attacker.recoilBloom = 0;
        attacker.recoilHeat = 0;
    } else if (!isDeagle && timeSinceLastShot > recoveryDelay) {
        const recoveredShots = Math.floor((timeSinceLastShot - recoveryDelay) / 0.08);
        if (recoveredShots > 0) {
            attacker.tapCount = Math.max(0, (attacker.tapCount || 0) - recoveredShots);
            attacker.shotsFired = Math.max(0, (attacker.shotsFired || 0) - recoveredShots);
            attacker.recoilHeat = Math.max(0, (attacker.recoilHeat || 0) - recoveredShots * 0.22);
        }
    }

    attacker.tapCount = (attacker.tapCount || 0) + 1;
    attacker.lastShotTime = world.gameTime;

    const accurateTapLimit = isDeagle ? 1 : 2;
    const isAccurateTap = !isSniper && attacker.tapCount <= accurateTapLimit;
    let rapidTapPenalty = 0;

    if (!isSniper) {
        if (isAccurateTap) {
            attacker.recoilBloom = Math.min(0.015, attacker.recoilBloom + wep.recoil * 0.20);
        } else {
            const growth = (wep.recoilGrowth || 0.018) * 1.35;
            const maxBloom = (wep.maxBloom || 0.10) * 1.25;
            attacker.recoilBloom = Math.min(maxBloom, attacker.recoilBloom + wep.recoil * 1.2 + growth);

            const excessTaps = attacker.tapCount - accurateTapLimit;
            rapidTapPenalty = isDeagle
                ? Math.min(0.18, 0.065 + excessTaps * 0.025)
                : Math.min(0.095, 0.022 + excessTaps * 0.007);
        }
    } else {
        attacker.recoilHeat = 1.0;
    }

    const baseAngle = Math.atan2(targetY - attacker.y, targetX - attacker.x);
    const pattern = SPRAY_PATTERNS[wepKey];

    let patternAngleOffset = 0;
    if (pattern && pattern.length > 0) {
        const shotIdx = Math.min(attacker.shotsFired, pattern.length - 1);
        patternAngleOffset = isAccurateTap ? 0 : pattern[shotIdx];
        attacker.shotsFired++;
    }

    const moveInaccuracy = getMovementInaccuracy(attacker, wep);
    const isScopedAWP = attacker.isScoped && wepKey === "AWP";
    const effectiveVisionRange = isScopedAWP ? 780 : FIXED_VISION_RANGE;

    const tapBase = Math.min(wep.spread, 0.022);
    const spreadRampT = isAccurateTap ? 0 : Math.min(1, (attacker.tapCount - accurateTapLimit) / 5);
    const effectiveBaseSpread = tapBase + (wep.spread - tapBase) * spreadRampT;

    const effectiveMoveInaccuracy = (isAccurateTap && moveInaccuracy < 0)
        ? -effectiveBaseSpread * 0.25
        : moveInaccuracy;
    const totalSpreadCone = Math.max(0.001, effectiveBaseSpread + attacker.recoilBloom * 0.35 + effectiveMoveInaccuracy + rapidTapPenalty);

    const totalInaccuracy = (rnd() - 0.5) * totalSpreadCone;
    const spreadAngle = baseAngle + patternAngleOffset + totalInaccuracy;

    wep.sound(attacker.x, attacker.y, attacker);
    registerGunfireNoise(attacker, wep.category === "sniper" ? 1200 : 800);

    if (isSniper) {
        registerAWPShot(attacker);
    }

    if (wep.category === "knife") {
        const targets = attacker.team === "CT" ? world.livingT : world.livingCT;
        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            if (Math.hypot(target.x - attacker.x, target.y - attacker.y) < 45) {
                target.takeDamage(wep.damage, attacker, false, "KNIFE");
                break;
            }
        }
        return;
    }

    if (attacker === world.player) {
        if (wepKey === "AWP") {
            const recoilKick = 18;
            world.cameraRecoilX = -Math.cos(attacker.angle) * recoilKick;
            world.cameraRecoilY = -Math.sin(attacker.angle) * recoilKick;
            world.cameraShake = Math.max(world.cameraShake, 24);
        } else {
            world.cameraShake = Math.min(28, world.cameraShake + wep.recoil * 320);
        }
    }

    if (wepKey === "AWP") {
        attacker.scopeLevel = 0;
        attacker.isScoped = false;
        if (attacker.isBot) {
            attacker.awpShotOrigin = { x: attacker.x, y: attacker.y };
            attacker.awpBoltTimer = 1.25;
            attacker.awpHoldTimer = 0;
            attacker.awpCoverSpot = null;

            const enemies = attacker.team === "CT" ? world.livingT : world.livingCT;
            const closeRushers = enemies.filter(e => Math.hypot(e.x - attacker.x, e.y - attacker.y) <= 220);
            attacker.awpEmergencyRetreat = closeRushers.length >= 2;
        }
    }

    const muzzleX = attacker.x + Math.cos(attacker.angle) * 20;
    const muzzleY = attacker.y + Math.sin(attacker.angle) * 20;
    createMuzzleFlash(muzzleX, muzzleY);

    if (wepKey === "AWP") {
        createAWPMuzzleDust(attacker.x + Math.cos(attacker.angle) * 24, attacker.y + Math.sin(attacker.angle) * 24, attacker.angle);
    }

    world.bullets.push({
        x: muzzleX,
        y: muzzleY,
        startX: muzzleX,
        startY: muzzleY,
        vx: Math.cos(spreadAngle) * wep.speed,
        vy: Math.sin(spreadAngle) * wep.speed,
        damage: wep.damage,
        piercingPower: wep.piercingPower,
        hsMult: wep.hsMult,
        armorPen: wep.armorPen,
        helmetPen: wep.helmetPen,
        rangeModifier: wep.rangeModifier,
        visionRange: effectiveVisionRange,
        owner: attacker,
        weaponKey: wepKey,
        weaponName: wep.name,
        life: 1.0,
        isAWP: wepKey === "AWP",
        penetratedObstacles: new Set()
    });
}

/* ==========================================================================
   GRENADE, FIRE & SMOKE SIMULATION
   ========================================================================== */
function detonateHEGrenade(g, dt) {
    world.cameraShake = 38;
    world.recentAcousticEvents.push({
        x: g.x,
        y: g.y,
        intensity: 0.65,
        time: world.gameTime
    });

    const blastRadius = g.isExtended ? 260 : 220;
    world.shockwaves.push({
        x: g.x,
        y: g.y,
        radius: 10,
        maxRadius: blastRadius,
        alpha: 1.0
    });

    for (let j = 0; j < world.allCharacters.length; j++) {
        const ent = world.allCharacters[j];
        if (!ent || ent.isDead) continue;
        const d = Math.hypot(ent.x - g.x, ent.y - g.y);
        if (d < blastRadius && getMapLineOfSight(g.x, g.y, ent.x, ent.y)) {
            const dmg = (1 - d / blastRadius) * g.damage;
            ent.takeDamage(dmg, g.owner, false, "HE GRENADE");

            const knockback = (1 - d / blastRadius) * 320;
            const kbAngle = Math.atan2(ent.y - g.y, ent.x - g.x);
            const pushX = Math.cos(kbAngle) * knockback * dt;
            const pushY = Math.sin(kbAngle) * knockback * dt;
            if (!checkWallCollision(ent.x + pushX, ent.y, ent.radius)) ent.x += pushX;
            if (!checkWallCollision(ent.x, ent.y + pushY, ent.radius)) ent.y += pushY;
        }
    }

    world.decals.push({ x: g.x, y: g.y, size: rnd() * 20 + 25, alpha: 0.85 });

    for (let p = 0; p < 24; p++) {
        world.particles.push({
            x: g.x,
            y: g.y,
            vx: (rnd() - 0.5) * 350,
            vy: (rnd() - 0.5) * 350,
            color: rnd() < 0.5 ? '#ff4400' : '#ffbb00',
            size: rnd() * 7 + 3,
            life: 0.5
        });
    }
}

function detonateFlashbang(g) {
    world.shockwaves.push({
        x: g.x,
        y: g.y,
        radius: 10,
        maxRadius: 280,
        alpha: 1.0
    });
    audio.playHitTick();

    for (let j = 0; j < world.allCharacters.length; j++) {
        const ent = world.allCharacters[j];
        if (!ent || ent.isDead) continue;
        const d = Math.hypot(ent.x - g.x, ent.y - g.y);
        if (d < 550 && getMapLineOfSight(g.x, g.y, ent.x, ent.y)) {
            const facingAngle = Math.atan2(g.y - ent.y, g.x - ent.x);
            let angleDiff = Math.abs(facingAngle - ent.angle);
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            angleDiff = Math.abs(angleDiff);

            const isFacing = angleDiff < Math.PI * 0.55;
            const duration = (isFacing ? 3.5 : 0.3) * (1 - d / 650);
            ent.blindTimer = Math.max(ent.blindTimer || 0, duration);
        }
    }
}

function detonateSmokeGrenade(g) {
    audio.playSmokePop(g.x, g.y);
    const smokeRad = g.isExtended ? 250 : 210;
    createSmokeCloud(g.x, g.y, smokeRad, 15.0);

    for (let f = world.firePatches.length - 1; f >= 0; f--) {
        if (Math.hypot(world.firePatches[f].x - g.x, world.firePatches[f].y - g.y) < smokeRad &&
            getMapLineOfSight(g.x, g.y, world.firePatches[f].x, world.firePatches[f].y)) {
            world.firePatches.splice(f, 1);
        }
    }
}

function detonateMolotov(g) {
    audio.playSmokePop(g.x, g.y);
    createFirePatch(g.x, g.y, g.owner, 155, 7.0);
}

export function updateGrenades(dt) {
    for (let i = world.grenades.length - 1; i >= 0; i--) {
        const g = world.grenades[i];

        const nextX = g.x + g.vx * dt;
        const nextY = g.y + g.vy * dt;

        if (checkWallCollision(nextX, g.y, 8)) g.vx *= -0.5;
        else g.x = nextX;

        if (checkWallCollision(g.x, nextY, 8)) g.vy *= -0.5;
        else g.y = nextY;

        g.vx *= Math.pow(0.08, dt);
        g.vy *= Math.pow(0.08, dt);

        const currentSpeed = Math.hypot(g.vx, g.vy);

        if (g.type === "HEGRENADE") {
            if (!g.hasLanded && currentSpeed < 35) {
                g.hasLanded = true;
                g.landTimer = 0.5;
            }
            if (g.hasLanded) {
                g.landTimer -= dt;
                if (g.landTimer <= 0) {
                    detonateHEGrenade(g, dt);
                    world.grenades.splice(i, 1);
                }
            }
        } else if (g.type === "FLASH") {
            g.fuse -= dt;
            if (g.fuse <= 0) {
                detonateFlashbang(g);
                world.grenades.splice(i, 1);
            }
        } else if (g.type === "SMOKE") {
            g.fuse -= dt;
            if (g.fuse <= 0) {
                detonateSmokeGrenade(g);
                world.grenades.splice(i, 1);
            }
        } else if (g.type === "MOLOTOV") {
            g.fuse -= dt;
            if (g.fuse <= 0 || currentSpeed < 30) {
                detonateMolotov(g);
                world.grenades.splice(i, 1);
            }
        }
    }

    // Process fire damage and extinguish timers (strictly wall-clipped)
    for (let i = world.firePatches.length - 1; i >= 0; i--) {
        const fire = world.firePatches[i];
        fire.life -= dt;
        fire.damageTimer += dt;

        if (rnd() < 0.85) {
            const pAng = rnd() * Math.PI * 2;
            const pDist = Math.sqrt(rnd()) * fire.radius * 0.96;
            const px = fire.x + Math.cos(pAng) * pDist;
            const py = fire.y + Math.sin(pAng) * pDist;
            if (isPointInFire(px, py, fire)) {
                world.particles.push({
                    x: px,
                    y: py,
                    vx: (rnd() - 0.5) * 35,
                    vy: -rnd() * 75,
                    color: rnd() < 0.5 ? '#f97316' : '#ef4444',
                    size: rnd() * 6 + 3,
                    life: 0.35
                });
            }
        }

        if (fire.damageTimer >= 0.2) {
            fire.damageTimer = 0;
            for (let j = 0; j < world.allCharacters.length; j++) {
                const ent = world.allCharacters[j];
                if (ent && !ent.isDead && isPointInFire(ent.x, ent.y, fire)) {
                    ent.takeDamage(8, fire.owner, false, "MOLOTOV");
                }
            }
        }

        if (fire.life <= 0) {
            world.firePatches.splice(i, 1);
        }
    }

    for (let i = world.smokeClouds.length - 1; i >= 0; i--) {
        const cloud = world.smokeClouds[i];
        cloud.life -= dt;
        if (cloud.life <= 0) world.smokeClouds.splice(i, 1);
    }

    for (let i = world.shockwaves.length - 1; i >= 0; i--) {
        const sw = world.shockwaves[i];
        sw.radius += (sw.maxRadius - sw.radius) * 12 * dt;
        sw.alpha -= 1.8 * dt;
        if (sw.alpha <= 0) world.shockwaves.splice(i, 1);
    }
}

/* ==========================================================================
   BULLET BALLISTICS & PENETRATION
   ========================================================================== */
function getWallSurfaceImpact(b, nextX, nextY) {
    const dx = nextX - b.x;
    const dy = nextY - b.y;
    const stepDist = Math.hypot(dx, dy);
    if (stepDist < 0.001) {
        return { x: b.x, y: b.y, bounceAngle: Math.atan2(-dy, -dx) };
    }

    const bulletAngle = Math.atan2(dy, dx);
    const edgePt = getRayObstacleEndpoint(b.x, b.y, bulletAngle, stepDist);
    const dirX = dx / stepDist;
    const dirY = dy / stepDist;

    // Step 4px back off the wall face into open air so sparks pass LOS checks and aren't culled as inside-wall
    const surfX = edgePt.x - dirX * 4;
    const surfY = edgePt.y - dirY * 4;
    const col = getCollisionNormal(edgePt.x + dirX * 2, edgePt.y + dirY * 2, 4);
    const bounceAngle = (col.nx !== 0 || col.ny !== 0)
        ? Math.atan2(col.ny, col.nx)
        : Math.atan2(-dirY, -dirX);

    return { x: surfX, y: surfY, bounceAngle };
}

function checkBulletObstacleCollision(b, nextX, nextY) {
    const obstacleLists = [MAP.walls, MAP.crates || []];
    for (let l = 0; l < obstacleLists.length; l++) {
        const list = obstacleLists[l];
        for (let i = 0; i < list.length; i++) {
            const obs = list[i];
            if (!lineIntersectsRect(b.x, b.y, nextX, nextY, obs.x, obs.y, obs.w, obs.h)) continue;
            if (b.penetratedObstacles && b.penetratedObstacles.has(obs)) continue;

            if (obs.penetrable && b.piercingPower > 0) {
                if (b.penetratedObstacles) b.penetratedObstacles.add(obs);
                b.piercingPower--;
                b.damage *= 0.65;
                const impact = getWallSurfaceImpact(b, nextX, nextY);
                createSparkParticles(impact.x, impact.y, impact.bounceAngle, true);
                audio.playWallImpact(impact.x, impact.y, true);
            } else {
                return true;
            }
        }
    }
    return false;
}

function normalizeAngle(angle) {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle <= -Math.PI) angle += Math.PI * 2;
    return angle;
}

export function updateBullets(dt) {
    for (let i = world.bullets.length - 1; i >= 0; i--) {
        const b = world.bullets[i];
        b.life -= dt;

        if (b.life <= 0 || b.x < 0 || b.x > MAP.width || b.y < 0 || b.y > MAP.height) {
            world.bullets.splice(i, 1);
            continue;
        }

        const nextX = b.x + b.vx * dt;
        const nextY = b.y + b.vy * dt;

        // Lingering AWP supersonic vapor trail
        if (b.isAWP && rnd() < 0.85) {
            world.particles.push({
                x: b.x + (nextX - b.x) * rnd(),
                y: b.y + (nextY - b.y) * rnd(),
                vx: (rnd() - 0.5) * 8,
                vy: (rnd() - 0.5) * 8,
                color: 'rgba(230, 235, 240, 0.4)',
                size: 2.2,
                life: 0.45,
                maxLife: 0.45,
                isSmoke: true
            });
        }

        // Near-miss bullet whiz -> geometric back-trace + immediate rear/flank awareness for close-range shots
        const enemies = b.owner.team === "CT" ? world.livingT : world.livingCT;
        for (let j = 0; j < enemies.length; j++) {
            const ent = enemies[j];
            if (!ent.isBot || ent.isDead) continue;
            if (lineIntersectsCircle(b.x, b.y, nextX, nextY, ent.x, ent.y, 165)) {
                invokeBallisticImpact(b, nextX, nextY, false);
                const originX = b.startX !== undefined ? b.startX : b.owner.x;
                const originY = b.startY !== undefined ? b.startY : b.owner.y;
                const originAng = Math.atan2(originY - ent.y, originX - ent.x);
                if (Math.abs(normalizeAngle(originAng - ent.angle)) > (95 * Math.PI / 180)) {
                    ent.rearBulletSweepTimer = 0.55;
                    ent.rearBulletTargetAngle = originAng;
                }
            }
        }

        // Check Wall & Crate Collisions / Penetration
        if (checkBulletObstacleCollision(b, nextX, nextY)) {
            const impact = getWallSurfaceImpact(b, nextX, nextY);
            createSparkParticles(impact.x, impact.y, impact.bounceAngle, false);
            audio.playWallImpact(impact.x, impact.y, false);
            invokeBallisticImpact(b, impact.x, impact.y, false);
            world.bullets.splice(i, 1);
            continue;
        }

        // Check Concentric Target Hitboxes
        const targets = b.owner.team === "CT" ? world.livingT : world.livingCT;
        let hit = false;

        for (let tIdx = 0; tIdx < targets.length; tIdx++) {
            const target = targets[tIdx];
            const head = target.getHeadHitbox();
            const torso = target.getTorsoHitbox();

            const hitHead = lineIntersectsCircle(b.x, b.y, nextX, nextY, head.x, head.y, head.radius);
            const hitTorso = !hitHead && lineIntersectsCircle(b.x, b.y, nextX, nextY, torso.x, torso.y, torso.radius);

            if (hitHead || hitTorso) {
                const isHeadshot = hitHead;
                let finalDmg = b.damage;

                if (b.startX !== undefined && b.startY !== undefined) {
                    const travelDist = Math.hypot(nextX - b.startX, nextY - b.startY);

                    if (!b.isAWP && b.rangeModifier && b.rangeModifier < 1.0) {
                        finalDmg *= Math.pow(b.rangeModifier, travelDist / 500.0);
                    }

                    const vRange = b.visionRange || FIXED_VISION_RANGE;
                    if (!b.isAWP && travelDist > vRange) {
                        const excessDist = travelDist - vRange;
                        const fogMult = Math.max(0.20, 1.0 - (excessDist / 300.0) * 0.80);
                        finalDmg *= fogMult;
                    }
                }

                const killed = target.takeDamage(finalDmg, b.owner, isHeadshot, b.weaponName);

                if (killed && b.owner === world.player) {
                    const reward = WEAPONS[b.weaponKey]?.killReward ?? 300;
                    world.player.money = Math.min(16000, world.player.money + reward);
                }

                world.bullets.splice(i, 1);
                hit = true;
                break;
            }
        }

        if (!hit) {
            b.x = nextX;
            b.y = nextY;
        }
    }
}