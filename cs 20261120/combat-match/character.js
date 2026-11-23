/* ==========================================================================
   CHARACTER ENTITY CLASS & CONCENTRIC HITBOX GEOMETRY
   ========================================================================== */
import {
    world,
    matchState,
    c4State,
    mouse,
    TORSO_RADIUS,
    HEAD_RADIUS,
    HEAD_OFFSET,
    rnd,
    audio,
    createBloodParticles,
    createBloodDecal,
    createCorpse,
    invokeKillHandler,
    invokeSquadHelp,
    invokeTagConfirm,
    getFormattedPlayerTag,
    recordPlayerDamage,
    showAnnouncerBanner
} from '../state.js';
import { recordHeatmapEvent } from '../js-map-physics/Map-Finding.js';
import { WEAPONS } from './Weapon-behavior.js';

export class Character {
    constructor(id, name, isBot, team, spawnX, spawnY) {
        // Identity & spatial state
        this.id = id;
        this.name = name;
        this.isBot = isBot;
        this.team = team;
        this.x = spawnX;
        this.y = spawnY;
        this.lastX = spawnX;
        this.lastY = spawnY;
        this.prevX = spawnX;
        this.prevY = spawnY;
        this.vx = 0;
        this.vy = 0;
        this.radius = TORSO_RADIUS;
        this.angle = 0;

        // Vitals, armor & economy
        this.health = 100;
        this.armor = 0;
        this.hasHelmet = false;
        this.hasDefuseKit = false;
        this.hasC4 = false;
        this.money = 800;
        this.isDead = false;
        this.isDefusing = false;

        // Loadout, skins & ammunition
        this.primaryKey = null;
        this.secondaryKey = team === 'CT' ? 'USP' : 'GLOCK';
        this.activeSlot = 2;
        this.previousSlot = 2;
        this.activeWeaponSkins = {};

        this.hasHE = false;
        this.hasSmoke = false;
        this.hasFlash = false;
        this.hasMolotov = false;

        this.clips = {
            "GLOCK": WEAPONS["GLOCK"].clip,
            "USP": WEAPONS["USP"].clip,
            "DEAGLE": WEAPONS["DEAGLE"].clip,
            "DUALIES": WEAPONS["DUALIES"].clip,
            "MP5": WEAPONS["MP5"].clip,
            "VECTOR": WEAPONS["VECTOR"].clip,
            "AK47": WEAPONS["AK47"].clip,
            "M4A1": WEAPONS["M4A1"].clip,
            "AWP": WEAPONS["AWP"].clip,
            "HEGRENADE": 1,
            "SMOKE": 1,
            "FLASH": 1,
            "MOLOTOV": 1
        };

        this.reserves = {
            "GLOCK": WEAPONS["GLOCK"].maxReserve,
            "USP": WEAPONS["USP"].maxReserve,
            "DEAGLE": WEAPONS["DEAGLE"].maxReserve,
            "DUALIES": WEAPONS["DUALIES"].maxReserve,
            "MP5": WEAPONS["MP5"].maxReserve,
            "VECTOR": WEAPONS["VECTOR"].maxReserve,
            "AK47": WEAPONS["AK47"].maxReserve,
            "M4A1": WEAPONS["M4A1"].maxReserve,
            "AWP": WEAPONS["AWP"].maxReserve
        };

        // Combat, ballistics & movement state
        this.recoilBloom = 0;
        this.recoilHeat = 0;
        this.shotsFired = 0;
        this.tapCount = 0;
        this.burstCount = 0;
        this.isReloading = false;
        this.reloadTimer = 0;
        this.equipTimer = 0;
        this.equipDuration = 0;
        this.lastShotTime = 0;
        this.scopeLevel = 0;

        this.blindTimer = 0;
        this.tagTimer = 0;
        this.tagSlowMult = 1.0;
        this.isMoving = false;
        this.isCrouching = false;
        this.isSilentWalking = false;
        this.footstepTimer = 0;

        // Scoreboard & match-scoped role defaults
        this.kills = 0;
        this.deaths = 0;
        this.archetype = "ENTRY";
        this.aggroFactor = 0.7;
        this.squadGroup = "ALPHA";
        this.retakeGroup = "RAMP";
        this.assignedSite = 'A';
        this.role = 'DEFEND_A_LONG';
        this.humanReactionDelay = 0.1775;

        this.resetAIState(spawnX, spawnY);
    }

    resetAIState(spawnX = this.x, spawnY = this.y) {
        // Macro strategy & objective progression
        this.executePhase = "BREACH";
        this.spawnExitDelay = 0;
        this.assemblyTimer = 0;
        this.isCTStaged = false;
        this.siteObjectiveLock = false;
        this.isApproachingSite = false;
        this.hasCalledAssistance = false;
        this.hasThrownLongFlash = false;
        this.hasThrownCrossSmoke = false;
        this.hasReachedAssignedSite = false;
        this.sweepPlanIndex = 0;
        this.escortWaitTimer = 0;

        // Pathfinding, dynamic lane rerouting & unstuck tracking
        this.currentPath = [];
        this.pathTargetWp = null;
        this.lastPathGoal = null;
        this.smokeHoldState = null;
        this.planIndex = 0;
        this.maxPlanIndex = 0;
        this.isFollowingPlanRoute = false;
        this.customMazeRoute = null;
        this.mazeRerouteCooldown = 0;
        this.customALaneRoute = null;
        this.aLaneRerouteCooldown = 0;
        this.unstuckTimer = 0;
        this.unstuckAngle = 0;
        this.stuckTime = 0;
        this.stuckTrackerTimer = 0;
        this.stuckSampleX = spawnX;
        this.stuckSampleY = spawnY;
        this.blockedWaypoints = {};
        this.pathRecalcTimer = 0;
        this.forwardProgressAngle = null;
        this.spreadWpCache = null;
        this.transitSpreadCache = null;

        // Target acquisition, memory & sensory caches
        this.targetEnemy = null;
        this.targetLockTimer = 0;
        this.reactionTimer = 0;
        this.lastHitBy = null;
        this.lastHitTime = 0;
        this.lastDamageSourcePos = null;
        this.lastHeardSound = null;
        this.lastSeenEnemy = null;
        this.lastSeenEnemyPos = null;
        this.lastSpottedTime = 0;
        this.lastSpottedX = spawnX;
        this.lastSpottedY = spawnY;

        this.visionScanThrottle = rnd() * 0.1;
        this.cachedPriorityEnemy = null;
        this.cachedClosestEnemy = null;
        this.cachedPriorityDist = 0;
        this.cachedMinDist = 0;
        this.cachedSmokeEnemyTarget = null;
        this.cachedSmokeCueType = null;
        this.blockingSmokeCloud = null;
        this.smoothGazeCache = null;

        // Combat cadence, aim error & trade tracking
        this.aiState = "MOVE";
        this.combatCadenceTimer = 0;
        this.combatCadenceState = "STRAFE";
        this.nextStrafeWindow = 0;
        this.nextStopWindow = 0;
        this.combatCommitmentTimer = 0;
        this.lastCombatTarget = null;
        this.lastCombatTargetPos = null;
        this.tradeTarget = null;
        this.tradeTimer = 0;
        this.vulnerableTarget = null;
        this.counterStrafeCooldown = 0;
        this.counterStrafeDir = 1;
        this.weaveSeed = rnd() * 1000;
        this.knifeLockTimer = 0;
        this.reloadCoverSpot = null;
        this.targetTrackingTime = 0;
        this.aimOffsetAngle = (rnd() - 0.5) * Math.PI * 2;
        this.aimErrorDist = rnd() * 6.0;

        // Peeking, pre-firing & head scan state
        this.peekingTimer = 0;
        this.isPeekingOut = false;
        this.isADPeeking = false;
        this.isWallHuggingHold = false;
        this.defenseADState = null;
        this.peekStepTime = 0;
        this.holdAngleTimer = 0;
        this.prefireTimer = 0;
        this.isPrefiringProbe = false;
        this.lastPrefireTime = -99;
        this.patrolTimer = 0;
        this.patrolNextInterval = undefined;
        this.patrolScanAngle = 0;
        this.patrolScanDir = 0;
        this.patrolSweepCount = 0;
        this.patrolBaseAngle = 0;
        this.patrolTargetWp = null;
        this.patrolTargetPt = null;
        this.isPatrolling = false;
        this.transitScanTimer = 0.5 + rnd() * 1.5;
        this.transitScanAngle = 0;
        this.transitScanDir = rnd() < 0.5 ? -1 : 1;

        // Utility & smoke handling
        this.lastUtilityThrowTime = 0;
        this.utilityLookAngle = undefined;
        this.utilityLookLockTimer = 0;
        this.pendingUtilityThrow = null;
        this.utilityCoverRetreat = null;
        this.utilitySearchCooldown = 0;
        this.antiFlashTimer = 0;
        this.antiFlashAngle = 0;
        this.smokeSpamCooldown = 0;
        this.smokeWatchTimer = 0;
        this.smokeBurstCount = 0;
        this.smokeBurstTimer = 0;
        this.smokePushCommitted = false;
        this.smokePushCommitUntil = 0;
        this.smokeReactionTimer = 0;
        this.smokeSprayAnchor = null;
        this.activeBlockingSmoke = null;
        this.smokeStrafeTimer = 0;
        this.isExitingSmoke = false;
        this.wasInSmokeCluster = false;
        this.smokeTraverseCache = null;
        this.smokeFallbackCache = null;
        this.postSmokeSweepTimer = 0;
        this.postSmokeSweepBaseAngle = 0;
        this.postSmokeSweepDir = 1;

        // AWP-specific state
        this.antiAWPCoverNode = null;
        this.antiAWPWaitTimer = 0;
        this.awpHoldTimer = 0;
        this.awpBoltTimer = 0;
        this.awpShotOrigin = null;
        this.awpCoverSpot = null;
        this.awpEmergencyRetreat = false;
        this.awpBlindShotCooldown = 0;
        this.awpBaitCooldown = 0;
        this.isBaitingAWP = false;
        this.awpBaitTimer = 0;
        this.awpBaitDir = 1;
        this.isFastCrossingAWP = false;

        // CT defense, Mid options, active info-check & C4 fake-defuse quota (1-4 per round)
        this.assignedCTStrat = null;
        this.midOptionKey = null;
        this.assignedMidSpot = null;
        this.committedRotateSite = null;
        this.committedRotateUntil = 0;
        this.assignedDefenseSpot = null;
        this.dynamicDefensePos = null;
        this.isHoldingCrossfire = false;
        this.anchorHoldTimer = 0;
        this.anchorHoldDuration = 8.0 + rnd() * 6.0;
        this.anchorPacePos = null;
        this.anchorPaceSide = 1;
        this.lastKillRepositionCount = 0;
        this.isRoamingPatrol = false;
        this.roamTimer = 0;
        this.isAggroPushing = false;
        this.aggroPushCompleted = false;
        this.ctAggroPushTarget = null;
        this.ctNoInfoTimer = 0;
        this.isCTInfoPushing = false;
        this.ctInfoPushRoute = null;
        this.ctInfoPushIndex = 0;
        this.ctInfoPushStartTime = 0;
        this.ctInfoPushCooldown = 0;
        this.ctCornerCheckTimer = 0;
        this.ctCheckedCorners = null;

        this.defuseReactionTimer = 0;
        this.defuseSprayCooldown = 0;
        this.defuseSprayShots = 0;
        this.fakeDefusesRemaining = 1 + Math.floor(rnd() * 4);
        this.startedFakeSequence = false;
        this.fakeDefuseStartTime = 0;
        this.fakeDefuseBaitUntil = 0;
        this.ctCoverSpot = null;
        this.c4GuardSpot = null;
        this.retakeAssignment = null;

        // Squad coordinator & zone-control caches
        this.tacticalOrder = null;
        this.macroGoal = null;
        this.areaControlState = null;
        this.tChokeHoldState = null;
        this.tPeekedCorners = null;
        this.tAttackPeekState = null;
        this.cachedCrossfirePlan = null;
        this.cachedSupportPos = null;
        this.cachedSupportPosTime = 0;
    }

    get isScoped() {
        return (this.scopeLevel || 0) > 0;
    }

    set isScoped(val) {
        if (val) {
            if (!this.scopeLevel || this.scopeLevel <= 0) this.scopeLevel = 1;
        } else {
            this.scopeLevel = 0;
        }
    }

    getTorsoHitbox() {
        return { x: this.x, y: this.y, radius: TORSO_RADIUS };
    }

    getHeadHitbox() {
        return {
            x: this.x + Math.cos(this.angle) * HEAD_OFFSET,
            y: this.y + Math.sin(this.angle) * HEAD_OFFSET,
            radius: HEAD_RADIUS
        };
    }

    getEquippedKey() {
        if (this.activeSlot === 1 && this.primaryKey) return this.primaryKey;
        if (this.activeSlot === 2 && this.secondaryKey) return this.secondaryKey;
        if (this.activeSlot === 3) return "KNIFE";
        if (this.activeSlot === 4 && this.hasHE) return "HEGRENADE";
        if (this.activeSlot === 5 && this.hasSmoke) return "SMOKE";
        if (this.activeSlot === 6 && this.hasC4) return "C4";
        if (this.activeSlot === 7 && this.hasFlash) return "FLASH";
        if (this.activeSlot === 8 && this.hasMolotov) return "MOLOTOV";
        return this.secondaryKey ? this.secondaryKey : "KNIFE";
    }

    getWeaponSwitchDelay(slotNum) {
        if (slotNum === 1 && this.primaryKey) {
            if (this.primaryKey === "AWP") return 0.85;
            if (this.primaryKey === "MP5" || this.primaryKey === "VECTOR") return 0.50;
            return 0.62; // AK47 / M4A1
        }
        if (slotNum === 2) {
            if (this.secondaryKey === "DEAGLE") return 0.50;
            if (this.secondaryKey === "DUALIES") return 0.48;
            return 0.42;
        }
        if (slotNum === 3) return 0.36; // Knife
        return 0.42; // Grenades & C4
    }

    selectSlot(slotNum) {
        if (slotNum === 1 && !this.primaryKey) return;
        if (slotNum === 2 && !this.secondaryKey) return;
        if (slotNum === 4 && !this.hasHE) return;
        if (slotNum === 5 && !this.hasSmoke) return;
        if (slotNum === 6 && !this.hasC4) return;
        if (slotNum === 7 && !this.hasFlash) return;
        if (slotNum === 8 && !this.hasMolotov) return;

        const changedSlot = this.activeSlot !== slotNum;

        if (this.isReloading) {
            this.isReloading = false;
            this.reloadTimer = 0;
            this.reloadCoverSpot = null;
        }

        this.isScoped = false;
        if (changedSlot) {
            this.previousSlot = this.activeSlot;
        }
        this.activeSlot = slotNum;

        if (changedSlot) {
            const delay = this.getWeaponSwitchDelay(slotNum);
            this.equipDuration = delay;
            this.equipTimer = (matchState.roundPhase === "COMBAT" || !this.isBot) ? delay : 0;
            audio.playWeaponDraw?.(this.getEquippedKey(), this.x, this.y, this);
        }
    }

    getWeapon() {
        const key = this.getEquippedKey();
        return WEAPONS[key] || WEAPONS["KNIFE"];
    }

    getCurrentClip() {
        const key = this.getEquippedKey();
        return this.clips[key] !== undefined ? this.clips[key] : Infinity;
    }

    setCurrentClip(amount) {
        const key = this.getEquippedKey();
        if (this.clips && key && this.clips[key] !== undefined) {
            this.clips[key] = amount;
        }
    }

    resetForNewRound(spawnX, spawnY) {
        if (this.isDead) {
            this.primaryKey = null;
            this.secondaryKey = this.team === 'CT' ? 'USP' : 'GLOCK';
            this.activeWeaponSkins = {};
            this.hasHE = false;
            this.hasSmoke = false;
            this.hasFlash = false;
            this.hasMolotov = false;
            this.armor = 0;
            this.hasHelmet = false;
            this.hasDefuseKit = false;
        }

        this.x = spawnX;
        this.y = spawnY;
        this.lastX = spawnX;
        this.lastY = spawnY;
        this.prevX = spawnX;
        this.prevY = spawnY;
        this.vx = 0;
        this.vy = 0;

        this.health = 100;
        this.isDead = false;
        this.isDefusing = false;
        this.isReloading = false;
        this.reloadTimer = 0;
        this.equipTimer = 0;
        this.equipDuration = 0;
        this.hasC4 = false;
        this.scopeLevel = 0;
        this.blindTimer = 0;
        this.tagTimer = 0;
        this.tagSlowMult = 1.0;

        this.recoilBloom = 0;
        this.recoilHeat = 0;
        this.shotsFired = 0;
        this.tapCount = 0;
        this.burstCount = 0;
        this.isMoving = false;
        this.isCrouching = false;
        this.isSilentWalking = false;
        this.footstepTimer = 0;

        this.activeSlot = this.primaryKey ? 1 : (this.secondaryKey ? 2 : 3);
        this.previousSlot = this.activeSlot;

        for (const k in this.clips) {
            if (WEAPONS[k]) this.clips[k] = WEAPONS[k].clip;
        }
        for (const k in this.reserves) {
            if (WEAPONS[k] && WEAPONS[k].maxReserve !== undefined) {
                this.reserves[k] = WEAPONS[k].maxReserve;
            }
        }

        this.resetAIState(spawnX, spawnY);
    }

    resetForHalftime() {
        this.money = 800;
        this.primaryKey = null;
        this.secondaryKey = this.team === 'CT' ? 'USP' : 'GLOCK';
        this.activeWeaponSkins = {};
        this.armor = 0;
        this.hasHelmet = false;
        this.hasDefuseKit = false;
        this.hasHE = false;
        this.hasSmoke = false;
        this.hasFlash = false;
        this.hasMolotov = false;
        this.hasC4 = false;
        this.isDead = true; // Ensures resetForNewRound() performs a clean spawn reset
        this.activeSlot = 2;
        this.previousSlot = 2;
    }

    takeDamage(amount, attacker, isHeadshot, weaponName) {
        if (this.isDead) return false;

        const wep = attacker ? attacker.getWeapon() : WEAPONS["AK47"];
        let actualDmg = amount;

        if (isHeadshot) {
            actualDmg = amount * wep.hsMult;
            if (this.hasHelmet) {
                actualDmg *= (wep.helmetPen || 0.75);
                if (this.armor > 0) this.armor = Math.max(0, this.armor - 20);
            }
        } else {
            if (this.armor > 0) {
                const armorPen = wep.armorPen || 0.7;
                const absorbedByArmor = amount * (1 - armorPen);
                actualDmg = amount * armorPen;
                this.armor = Math.max(0, this.armor - absorbedByArmor * 0.8);
            }
        }

        const prevHealth = this.health;
        this.health -= actualDmg;

        if (attacker && attacker !== this) {
            const wepClass = wep ? wep.category : "rifle";
            this.tagSlowMult = wepClass === "sniper" ? 0.35 : (wepClass === "rifle" ? 0.45 : 0.65);
            this.tagTimer = 1.0;
        }

        if (attacker && attacker.team !== this.team) {
            // Deduce approximate bullet origin (55-125 px uncertainty; wider through smoke/cover)
            const shotDist = Math.hypot(attacker.x - this.x, attacker.y - this.y);
            const distRatio = Math.min(1.0, shotDist / 900);
            const fuzzRadius = (55 + distRatio * 70) * (this.blindTimer > 0 ? 1.45 : 1.0);
            const fuzzAng = rnd() * Math.PI * 2;
            const approxOriginX = Math.max(80, Math.min(2480, attacker.x + Math.cos(fuzzAng) * fuzzRadius));
            const approxOriginY = Math.max(80, Math.min(1920, attacker.y + Math.sin(fuzzAng) * fuzzRadius));
            const incomingBulletAng = Math.atan2(attacker.y - this.y, attacker.x - this.x);

            this.lastHitBy = attacker;
            this.lastHitTime = world.gameTime;
            this.lastDamageSourcePos = {
                x: approxOriginX,
                y: approxOriginY,
                angle: incomingBulletAng,
                time: world.gameTime
            };

            // Feed the approximate bullet direction into the bot's own acoustic/threat awareness
            if (this.isBot) {
                this.lastHeardSound = {
                    x: approxOriginX,
                    y: approxOriginY,
                    shooter: attacker,
                    time: world.gameTime,
                    type: "firing_trace",
                    isApproximate: true
                };
            }

            // Record approximate enemy zone in team suspicion memory so teammates react to the callout
            const teamSus = world.teamSuspicionMemory?.[this.team];
            if (teamSus) {
                const existing = teamSus.find(s => !s.clearedThisRound && Math.hypot(s.x - approxOriginX, s.y - approxOriginY) < 160);
                if (existing) {
                    existing.x = (existing.x + approxOriginX) * 0.5;
                    existing.y = (existing.y + approxOriginY) * 0.5;
                    existing.time = world.gameTime;
                    existing.weight = Math.min(5, (existing.weight || 1) + 1);
                } else {
                    teamSus.push({
                        x: approxOriginX,
                        y: approxOriginY,
                        time: world.gameTime,
                        weight: 2,
                        weaponCategory: wep ? wep.category : "rifle",
                        clearedThisRound: false
                    });
                }
            }

            invokeSquadHelp(this, attacker, { x: approxOriginX, y: approxOriginY, angle: incomingBulletAng });
            invokeTagConfirm(attacker, this);

            if (attacker === world.player && this !== world.player && actualDmg > 0) {
                const effectiveDmg = Math.min(prevHealth, actualDmg);
                const dmgRounded = Math.max(0, Math.round(effectiveDmg));
                recordPlayerDamage(dmgRounded, isHeadshot, weaponName);
                world.player.name = getFormattedPlayerTag();
            }

            if (this.isBot && this.health > 0 && this.health <= 25 && !this.hasCalledAssistance) {
                this.hasCalledAssistance = true;
                audio.announce("Need assistance", this.team);
                showAnnouncerBanner("DISTRESS", `${this.name}: NEED ASSISTANCE!`, this.team);
            }
        }

        recordHeatmapEvent(this.x, this.y, 2);
        createBloodParticles(this.x, this.y, isHeadshot ? 12 : 6);
        createBloodDecal(this.x, this.y);

        if (attacker === world.player) {
            if (isHeadshot) audio.playHeadshotDing();
            else audio.playHitTick();

            if (Number.isFinite(mouse.worldX) && Number.isFinite(mouse.worldY)) {
                world.hitmarkers.push({ x: mouse.worldX, y: mouse.worldY, life: 0.25, isHeadshot });
            }
        }

        if (this === world.player && attacker) {
            const dmgAngle = Math.atan2(attacker.y - this.y, attacker.x - this.x);
            world.directionalIndicators.push({
                angle: dmgAngle,
                alpha: 1.0,
                isHeadshot: Boolean(isHeadshot),
                damage: Math.round(actualDmg)
            });
            const damageOverlay = document.getElementById('damage-vignette');
            if (damageOverlay) {
                damageOverlay.style.opacity = isHeadshot ? '1' : '0.82';
                setTimeout(() => { damageOverlay.style.opacity = '0'; }, 220);
            }
        }

        if (this.health <= 0) {
            this.health = 0;
            this.isDead = true;
            this.isScoped = false;
            this.isDefusing = false;
            this.deaths++;

            if (this === world.player) {
                world.playerDeathTime = world.gameTime;
            }

            if (this.executePhase === "PLANT_LOCK" || c4State.planter === this) {
                c4State.plantProgress = 0;
                c4State.planter = null;
            }

            recordHeatmapEvent(this.x, this.y, 5);
            if (world.tacticalIntel && world.tacticalIntel.deathZones && world.tacticalIntel.deathZones[this.team]) {
                world.tacticalIntel.deathZones[this.team].push({
                    x: this.x,
                    y: this.y,
                    radius: 50,
                    time: world.gameTime,
                    expiresAt: world.gameTime + 18.0,
                    cleared: false
                });
            }
            createCorpse(this.x, this.y, this.angle, this.team, this.name);

            if (this.hasC4) {
                this.hasC4 = false;
                c4State.carrier = null;
                c4State.c4Retriever = null;
                c4State.isDropped = true;
                c4State.dropX = this.x;
                c4State.dropY = this.y;
                audio.announce("Bomb has been dropped", "T");
                showAnnouncerBanner("BOMB DROPPED", "THE C4 BOMB HAS BEEN DROPPED!");
            }

            invokeKillHandler(attacker, this, isHeadshot, weaponName);
            return true;
        }
        return false;
    }
}