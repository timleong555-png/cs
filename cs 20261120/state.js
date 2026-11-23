/* ==========================================================================
   SHARED ENGINE STATE, DETERMINISTIC MATH, AUDIO SYNTH & PARTICLE HELPERS
   ========================================================================== */

// --- CORE VISION & HITBOX CONSTANTS ---
export const FIXED_VISION_RANGE = 520;
export const FIXED_VISION_HALF_FOV = 35 * Math.PI / 180; // ~70° pure sector FOV
export const SCOPED_VISION_HALF_FOV = 20 * Math.PI / 180; // Tight 40° Stage-1 scoped AWP FOV
export const BOT_SCOPED_HALF_FOV = 30 * Math.PI / 180;    // Steady 60° scoped tracking FOV for bot AWPers

export const AWP_SCOPE_STAGES = [
    { level: 0, visionRange: FIXED_VISION_RANGE, halfFov: FIXED_VISION_HALF_FOV, cameraZoom: 1.00, lookAhead: 0.00, moveSpeedMult: 1.00 },
    { level: 1, visionRange: 780, halfFov: 20 * Math.PI / 180, cameraZoom: 0.60, lookAhead: 0.22, moveSpeedMult: 0.28 },
    { level: 2, visionRange: 780, halfFov: 15 * Math.PI / 180, cameraZoom: 0.85, lookAhead: 0.34, moveSpeedMult: 0.22 },
    { level: 3, visionRange: 780, halfFov: 11 * Math.PI / 180, cameraZoom: 1.15, lookAhead: 0.45, moveSpeedMult: 0.16 }
];

export function getAWPScopeConfig(scopeLevel = 0, isBot = false) {
    const raw = Number(scopeLevel);
    const safeLevel = Number.isFinite(raw) ? Math.floor(raw) : 0;
    const idx = Math.max(0, Math.min(AWP_SCOPE_STAGES.length - 1, safeLevel));
    const baseCfg = AWP_SCOPE_STAGES[idx] || AWP_SCOPE_STAGES[0];

    if (isBot && idx > 0) {
        return { ...baseCfg, halfFov: BOT_SCOPED_HALF_FOV };
    }
    return baseCfg;
}

export const TORSO_RADIUS = 18.0;  // Torso body radius
export const HEAD_RADIUS = 4.5;    // Concentric head radius
export const HEAD_OFFSET = 10.0;   // Forward distance offset

export const BODY_SIZE = TORSO_RADIUS * 2; // 36px
export const FOOTSTEP_LISTEN_RADIUS = 520; // 520px
export const C4_DETONATION_TIME = 40.0;    // 40s bomb timer

// --- SEEDED PRNG & DETERMINISTIC ANGLE MATH ---
let prngState = 1337;

export function setRoundSeed(seed) {
    world.roundSeed = seed;
    prngState = seed >>> 0;
}

export function rnd() {
    let t = prngState += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function normalizeAngle(a) {
    if (!Number.isFinite(a)) return 0;
    a = a % (Math.PI * 2);
    if (a <= -Math.PI) a += Math.PI * 2;
    if (a > Math.PI) a -= Math.PI * 2;
    return a;
}

export function rotateTowardsDamped(currentAngle, targetAngle, speed = 10.0, dt = 0.0166, maxRate = 8.5) {
    if (!Number.isFinite(currentAngle)) currentAngle = 0;
    if (!Number.isFinite(targetAngle)) targetAngle = 0;
    currentAngle = normalizeAngle(currentAngle);
    targetAngle = normalizeAngle(targetAngle);

    let diff = targetAngle - currentAngle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;

    let step = diff * (1 - Math.exp(-speed * dt));
    const maxStep = maxRate * dt;
    if (step > maxStep) step = maxStep;
    else if (step < -maxStep) step = -maxStep;

    return normalizeAngle(currentAngle + step);
}

// --- CENTRALIZED MUTABLE WORLD STATE ---
export const world = {
    matchSeed: 1337,
    roundSeed: 1337,
    gameState: "START",
    playerTeam: "CT",
    spectatorIndex: 0,
    gameTime: 0,

    currentTStrategyKey: "SPLIT_A",
    lastTRotationTime: 0,

    player: null,
    bots: [],
    allCharacters: [],
    livingCT: [],
    livingT: [],
    playerDeathTime: -99,
    midBotSpotWeights: null,

    bullets: [],
    grenades: [],
    smokeClouds: [],
    shockwaves: [],
    particles: [],
    decals: [],
    corpses: [],
    hitmarkers: [],
    directionalIndicators: [],
    droppedWeapons: [],
    soundRipples: [],
    firePatches: [],

    squadHelpSignals: [],
    teamUtilityReservations: [],
    teamSuspicionMemory: { CT: [], T: [] },
    awpDangerMemory: { CT: [], T: [] },
    tacticalIntel: {
        deathZones: { CT: [], T: [] },      // 50px round death spots (soft pathing cost, 18s decay or cleared on sweep)
        killerHotzones: { CT: [], T: [] },  // Cross-round killer positions (drives Tier 1-3 suspicion escalation)
        ballisticTraces: { CT: [], T: [] }, // Deduced shooter corners from bullet impacts & near-miss tracers
        predictedZones: { CT: [], T: [] },  // Spatio-temporal enemy movement rings projected onto chokes
        deducedAWPNests: { CT: [], T: [] }, // Killfeed [AWP] + bullet-trace deduced AWP positions (16s window)
        clearedSectors: { CT: [], T: [] },  // Recently swept bombsite pockets & angles
        squadOrders: { CT: {}, T: {} },     // Dynamic per-bot tacticalOrder assignments
        lastOrderUpdate: { CT: 0, T: 0 }
    },
    sharedEnemyIntelCT: {},
    sharedEnemyIntelT: {},
    activeAWPThreat: null,
    awpSwarmSignals: [],
    lastEnemyIntelTimeCT: 0,
    lastEnemyIntelTimeT: 0,
    recentAcousticEvents: [],
    lastSpottedRadioTime: { CT: 0, T: 0 },

    cameraX: 0,
    cameraY: 0,
    cameraShake: 0,
    cameraZoom: 1.0,
    cameraRecoilX: 0,
    cameraRecoilY: 0,
    smokeVisionFactor: 0.0
};

export const matchState = {
    ctScore: 0,
    tScore: 0,
    roundNumber: 1,
    maxRounds: 30,
    roundPhase: "BUY_TIME",
    roundTimer: 115,
    freezeTimer: 10,
    lossStreakCT: 0,
    lossStreakT: 0
};

export const c4State = {
    carrier: null,
    isDropped: false,
    dropX: 0,
    dropY: 0,
    isPlanted: false,
    plantX: 0,
    plantY: 0,
    plantSite: null,
    timer: C4_DETONATION_TIME,
    beepTimer: 0,
    plantProgress: 0,
    defuseProgress: 0,
    designatedDefuser: null,
    c4Retriever: null,
    isBeingDefused: false,
    ctRetakeAnnounced: false,
    evacAnnounced: false,
    planter: null,
    ctSeenDropped: false,
    ctSeenRecovered: false,
    lastDefuseSoundTime: -99
};

export const pincerState = {
    alphaStaged: false,
    bravoStaged: false,
    breachInitiated: false,
    stagingTimer: 0
};

export const ctPincerState = {
    alphaStaged: false,
    bravoStaged: false,
    breachInitiated: false,
    stagingTimer: 0,
    minRequiredClock: 14.0
};

export const keys = {};
export const mouse = {
    x: 0,
    y: 0,
    worldX: 0,
    worldY: 0,
    isDown: false,
    isRightDown: false
};

// --- ACTIVE FOCUS & ENTITY CACHE HELPERS ---
export function getActiveFocus() {
    if (world.player && !world.player.isDead) return world.player;
    // Hold camera on the player's body for 3.0 seconds after death before switching to teammates
    if (world.player && world.player.isDead && (world.gameTime - (world.playerDeathTime || -99)) < 3.0) {
        return world.player;
    }
    const alive = world.playerTeam === "CT" ? world.livingCT : world.livingT;
    if (alive.length > 0) {
        return alive[world.spectatorIndex % alive.length];
    }
    return world.player;
}

export function updateCharacterLists() {
    world.allCharacters = world.player ? [world.player, ...world.bots] : [...world.bots];
    world.livingCT = [];
    world.livingT = [];
    for (let i = 0; i < world.allCharacters.length; i++) {
        const c = world.allCharacters[i];
        if (c && !c.isDead) {
            if (c.team === 'CT') world.livingCT.push(c);
            else world.livingT.push(c);
        }
    }
}

// --- LATE-BOUND HOOKS (Prevents circular imports across subfolders) ---
let losCheckerFn = null;
export function registerLOSChecker(fn) {
    losCheckerFn = fn;
}

let killHandlerFn = null;
export function registerKillHandler(fn) {
    killHandlerFn = fn;
}
export function invokeKillHandler(attacker, victim, isHeadshot, weaponName) {
    if (killHandlerFn) killHandlerFn(attacker, victim, isHeadshot, weaponName);
}

let squadHelpHandlerFn = null;
export function registerSquadHelpHandler(fn) {
    squadHelpHandlerFn = fn;
}
export function invokeSquadHelp(victim, attacker, approxOrigin = null) {
    if (squadHelpHandlerFn) squadHelpHandlerFn(victim, attacker, approxOrigin);
}

let ballisticImpactHandlerFn = null;
export function registerBallisticImpactHandler(fn) {
    ballisticImpactHandlerFn = fn;
}
export function invokeBallisticImpact(bullet, hitX, hitY, isWallbang = false) {
    if (ballisticImpactHandlerFn) ballisticImpactHandlerFn(bullet, hitX, hitY, isWallbang);
}

let tagConfirmHandlerFn = null;
export function registerTagConfirmHandler(fn) {
    tagConfirmHandlerFn = fn;
}
export function invokeTagConfirm(attacker, victim) {
    if (tagConfirmHandlerFn) tagConfirmHandlerFn(attacker, victim);
}

export function recordDeducedAWPNest(team, x, y, source = "KILLFEED_AWP", duration = 16.0) {
    if (!world.tacticalIntel || (team !== "CT" && team !== "T")) return;
    if (!world.tacticalIntel.deducedAWPNests) {
        world.tacticalIntel.deducedAWPNests = { CT: [], T: [] };
    }
    const list = world.tacticalIntel.deducedAWPNests[team];
    const existing = list.find(n => Math.hypot(n.x - x, n.y - y) < 135);
    if (existing) {
        existing.x = (existing.x + x) * 0.5;
        existing.y = (existing.y + y) * 0.5;
        existing.source = source;
        existing.time = world.gameTime;
        existing.expiresAt = Math.max(existing.expiresAt, world.gameTime + duration);
    } else {
        list.push({
            x,
            y,
            source,
            time: world.gameTime,
            expiresAt: world.gameTime + duration
        });
    }
}

export function recordAWPDangerSpot(team, victimX, victimY, awpX, awpY, roundElapsed, roundNum) {
    if (team !== "CT" && team !== "T") return;
    if (!world.awpDangerMemory) {
        world.awpDangerMemory = { CT: [], T: [] };
    }
    const list = world.awpDangerMemory[team];

    // Place smoke along the kill sightline (~42% from victim toward AWPer) to block the sniper angle across the lane
    const dist = Math.hypot(awpX - victimX, awpY - victimY);
    const ang = Math.atan2(awpY - victimY, awpX - victimX);
    const offset = dist > 260 ? Math.min(dist * 0.42, 340) : dist;
    const smokeX = victimX + Math.cos(ang) * offset;
    const smokeY = victimY + Math.sin(ang) * offset;

    const existing = list.find(d =>
        (Math.hypot(d.smokeX - smokeX, d.smokeY - smokeY) < 180 ||
         Math.hypot(d.victimX - victimX, d.victimY - victimY) < 180) &&
        Math.abs(d.roundElapsed - roundElapsed) < 16.0
    );

    if (existing) {
        existing.smokeX = (existing.smokeX + smokeX) * 0.5;
        existing.smokeY = (existing.smokeY + smokeY) * 0.5;
        existing.victimX = (existing.victimX + victimX) * 0.5;
        existing.victimY = (existing.victimY + victimY) * 0.5;
        existing.awpX = (existing.awpX + awpX) * 0.5;
        existing.awpY = (existing.awpY + awpY) * 0.5;
        existing.roundElapsed = Math.min(existing.roundElapsed, roundElapsed);
        existing.smokeChance = 1.0;
        existing.roundRoll = 0;
        existing.lastKillRound = roundNum;
        existing.smokedThisRound = false;
    } else {
        list.push({
            smokeX,
            smokeY,
            victimX,
            victimY,
            awpX,
            awpY,
            roundElapsed,
            smokeChance: 1.0,
            roundRoll: 0,
            lastKillRound: roundNum,
            smokedThisRound: false
        });
    }
}

export function updateAWPDangerMemoryForNewRound(currentRoundNum, clearAll = false) {
    if (!world.awpDangerMemory || clearAll) {
        world.awpDangerMemory = { CT: [], T: [] };
        return;
    }

    for (const team of ["CT", "T"]) {
        const list = world.awpDangerMemory[team] || [];
        for (let i = list.length - 1; i >= 0; i--) {
            const spot = list[i];
            spot.smokedThisRound = false;

            if (spot.lastKillRound === currentRoundNum - 1) {
                // Killed by AWP last round -> 100% guaranteed proactive smoke this round
                spot.smokeChance = 1.0;
                spot.roundRoll = 0;
            } else {
                // Gradually cool down if no AWP kill occurred here last round
                if (spot.smokeChance > 0.75) spot.smokeChance = 0.65;
                else if (spot.smokeChance > 0.45) spot.smokeChance = 0.35;
                else if (spot.smokeChance > 0.20) spot.smokeChance = 0.15;
                else {
                    list.splice(i, 1);
                    continue;
                }
                spot.roundRoll = rnd();
            }
        }
    }
}

export function resetTacticalIntelForRound(clearMatchMemory = false) {
    if (!world.tacticalIntel) {
        world.tacticalIntel = {
            deathZones: { CT: [], T: [] },
            killerHotzones: { CT: [], T: [] },
            ballisticTraces: { CT: [], T: [] },
            predictedZones: { CT: [], T: [] },
            deducedAWPNests: { CT: [], T: [] },
            clearedSectors: { CT: [], T: [] },
            squadOrders: { CT: {}, T: {} },
            lastOrderUpdate: { CT: 0, T: 0 }
        };
    }
    world.tacticalIntel.deathZones = { CT: [], T: [] };
    world.tacticalIntel.ballisticTraces = { CT: [], T: [] };
    world.tacticalIntel.predictedZones = { CT: [], T: [] };
    world.tacticalIntel.deducedAWPNests = { CT: [], T: [] };
    world.tacticalIntel.clearedSectors = { CT: [], T: [] };
    world.tacticalIntel.squadOrders = { CT: {}, T: {} };
    world.tacticalIntel.lastOrderUpdate = { CT: 0, T: 0 };

    if (clearMatchMemory) {
        world.tacticalIntel.killerHotzones = { CT: [], T: [] };
    } else {
        for (const team of ["CT", "T"]) {
            (world.tacticalIntel.killerHotzones[team] || []).forEach(hz => {
                hz.clearedThisRound = false;
                hz.confirmedUntil = 0;
            });
        }
    }
}

let profileTagFn = () => "Alex ⭐";
export function registerProfileTagResolver(fn) {
    profileTagFn = fn;
}
export function getFormattedPlayerTag() {
    return profileTagFn();
}

let profileDmgRecorderFn = null;
export function registerProfileDamageRecorder(fn) {
    profileDmgRecorderFn = fn;
}
export function recordPlayerDamage(dmgRounded, isHeadshot, weaponName) {
    if (profileDmgRecorderFn) profileDmgRecorderFn(dmgRounded, isHeadshot, weaponName);
}

let bannerHandlerFn = null;
export function registerBannerHandler(fn) {
    bannerHandlerFn = fn;
}
export function showAnnouncerBanner(title, subtext, targetTeam = "ALL", winningTeam = null) {
    if (bannerHandlerFn) bannerHandlerFn(title, subtext, targetTeam, winningTeam);
}

// --- PARTICLE, DECAL & CORPSE SPAWNERS ---
export function createBloodParticles(x, y, count = 6) {
    if (world.particles.length > 140) return;
    for (let i = 0; i < count; i++) {
        world.particles.push({
            x,
            y,
            vx: (rnd() - 0.5) * 140,
            vy: (rnd() - 0.5) * 140,
            color: '#cc0000',
            size: rnd() * 4 + 2,
            life: 0.4
        });
    }
}

export function createBloodDecal(x, y) {
    world.decals.push({
        x: x + (rnd() - 0.5) * 20,
        y: y + (rnd() - 0.5) * 20,
        size: rnd() * 14 + 10,
        alpha: 0.7
    });
    if (world.decals.length > 50) world.decals.shift();
}

export function createMuzzleFlash(x, y) {
    world.particles.push({
        x,
        y,
        vx: 0,
        vy: 0,
        color: '#ffcc00',
        size: 8,
        life: 0.05
    });
}

export function createAWPMuzzleDust(x, y, angle) {
    for (let i = 0; i < 9; i++) {
        const spreadAngle = angle + (rnd() - 0.5) * 1.6;
        const speed = 40 + rnd() * 80;
        world.particles.push({
            x: x + Math.cos(spreadAngle) * 6,
            y: y + Math.sin(spreadAngle) * 6,
            vx: Math.cos(spreadAngle) * speed,
            vy: Math.sin(spreadAngle) * speed,
            color: 'rgba(180, 170, 150, 0.55)',
            size: 3 + rnd() * 2.5,
            life: 0.35 + rnd() * 0.15,
            maxLife: 0.5,
            isDust: true
        });
    }
}

export function createSparkParticles(x, y, bounceAngle = null, isPenetration = false) {
    const sparkCount = isPenetration ? 4 : 6;
    for (let i = 0; i < sparkCount; i++) {
        const ang = (bounceAngle !== null)
            ? (bounceAngle + (rnd() - 0.5) * 1.45)
            : (rnd() * Math.PI * 2);
        const speed = 55 + rnd() * 115;
        world.particles.push({
            x,
            y,
            vx: Math.cos(ang) * speed,
            vy: Math.sin(ang) * speed,
            color: i % 2 === 0 ? '#fde047' : '#fb923c',
            size: 1.8 + rnd() * 1.4,
            life: 0.16 + rnd() * 0.10
        });
    }
}

export function createCorpse(x, y, angle, team, name) {
    world.corpses.push({ x, y, angle, team, name });
}

// --- WEB AUDIO SYNTHESIZER (BINAURAL PANNING, OCCLUSION & ASSET HOOKS) ---
export class AudioSynthesizer {
    constructor() {
        this.ctx = null;
        this.lastRadioCallTime = 0;
        this.noiseCache = {};
        this.customSounds = {};
        this.rawAudioBuffers = {};
        this.decodedBuffers = {};
        this.preloaded = false;
        this.masterVolume = 1.0;
        this.sfxVolume = 1.0;
        this.radioVolume = 1.0;
        this.muted = false;
    }

    async preloadGunSounds(audioFolder = './') {
        if (this.preloaded) return;
        this.preloaded = true;

        const gunFiles = {
            USP: 'usp.mp3',
            GLOCK: 'glock.mp3',
            DUALIES: 'dual berettas.mp3',
            DEAGLE: 'desert eagle.mp3',
            MP5: 'mp5.mp3',
            VECTOR: 'kriss vector.mp3',
            M4A1: 'm4a1.mp3',
            AK47: 'ak47.mp3',
            AWP: 'awp.mp3'
        };

        await Promise.all(
            Object.entries(gunFiles).map(async ([key, fileName]) => {
                try {
                    const url = encodeURI(`${audioFolder}${fileName}`);
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const arrayBuf = await res.arrayBuffer();
                    this.rawAudioBuffers[key] = arrayBuf;

                    if (this.ctx) {
                        this.decodedBuffers[key] = await this.ctx.decodeAudioData(arrayBuf.slice(0));
                    }
                } catch (err) {
                    console.warn(`Failed to preload ${fileName}:`, err);
                }
            })
        );
    }

    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        // Decode any raw buffers fetched before the first user click unlocked AudioContext
        for (const [key, rawBuf] of Object.entries(this.rawAudioBuffers)) {
            if (!this.decodedBuffers[key]) {
                this.ctx.decodeAudioData(rawBuf.slice(0))
                    .then(decoded => { this.decodedBuffers[key] = decoded; })
                    .catch(err => console.warn(`Decode failed for ${key}:`, err));
            }
        }
    }

    setVolumes({ master, sfx, radio, muted } = {}) {
        if (typeof master === 'number') this.masterVolume = Math.max(0, Math.min(1, master));
        if (typeof sfx === 'number') this.sfxVolume = Math.max(0, Math.min(1, sfx));
        if (typeof radio === 'number') this.radioVolume = Math.max(0, Math.min(1, radio));
        if (typeof muted === 'boolean') this.muted = muted;
    }

    getEffectiveSfxGain() {
        return this.muted ? 0 : (this.masterVolume * this.sfxVolume);
    }

    registerCustomSound(key, audioBufferOrUrl) {
        if (key && audioBufferOrUrl) {
            this.customSounds[key] = audioBufferOrUrl;
        }
    }

    playGunSample(key, x, y, sourceEntity = null, maxRange = 1500, baseGain = 0.75) {
        if (!this.ctx || this.muted) return false;
        const buffer = this.decodedBuffers[key];
        if (!buffer) return false;

        const cleanupMs = Math.max(1300, Math.ceil(buffer.duration * 1000) + 200);
        const pipeline = this.createSpatialPipeline(x, y, maxRange, sourceEntity, true, cleanupMs);
        if (!pipeline) return true; // Out of audible range; handled cleanly without synth fallback

        const now = this.ctx.currentTime;
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(baseGain, now);

        src.connect(gain);
        gain.connect(pipeline.input);
        src.onended = () => {
            try {
                src.disconnect();
                gain.disconnect();
            } catch (_) {}
        };
        src.start(now);
        return true;
    }

    playWeaponFire(weaponKey, x, y, sourceEntity = null) {
        const gunAudioProfiles = {
            USP: { maxRange: 1100, gain: 0.70, fallback: () => this.playPistol(x, y, sourceEntity) },
            GLOCK: { maxRange: 1200, gain: 0.75, fallback: () => this.playPistol(x, y, sourceEntity) },
            DUALIES: { maxRange: 1250, gain: 0.78, fallback: () => this.playPistol(x, y, sourceEntity) },
            DEAGLE: { maxRange: 1450, gain: 0.85, fallback: () => this.playDeagle(x, y, sourceEntity) },
            MP5: { maxRange: 1300, gain: 0.75, fallback: () => this.playPistol(x, y, sourceEntity) },
            VECTOR: { maxRange: 1300, gain: 0.72, fallback: () => this.playVector(x, y, sourceEntity) },
            M4A1: { maxRange: 1500, gain: 0.80, fallback: () => this.playRifle(x, y, sourceEntity) },
            AK47: { maxRange: 1550, gain: 0.85, fallback: () => this.playRifle(x, y, sourceEntity) },
            AWP: { maxRange: 2200, gain: 1.00, fallback: () => this.playAWP(x, y, sourceEntity) }
        };

        const profile = gunAudioProfiles[weaponKey];
        if (!profile) {
            this.playPistol(x, y, sourceEntity);
            return;
        }

        const played = this.playGunSample(weaponKey, x, y, sourceEntity, profile.maxRange, profile.gain);
        if (!played && profile.fallback) {
            profile.fallback();
        }
    }

    playDryFire(x, y, sourceEntity = null) {
        if (!this.ctx || this.muted) return;
        const pipeline = this.createSpatialPipeline(x, y, 600, sourceEntity);
        if (!pipeline) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1600, now);
        osc.frequency.exponentialRampToValueAtTime(320, now + 0.035);

        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

        osc.connect(gain);
        gain.connect(pipeline.input);
        osc.start(now);
        osc.stop(now + 0.035);
    }

    playReload(x, y, duration = 2.0, sourceEntity = null) {
        if (!this.ctx || this.muted) return;
        const pipeline = this.createSpatialPipeline(x, y, 800, sourceEntity);
        if (!pipeline) return;

        const now = this.ctx.currentTime;

        const osc1 = this.ctx.createOscillator();
        const gain1 = this.ctx.createGain();
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(950, now);
        osc1.frequency.exponentialRampToValueAtTime(220, now + 0.06);
        gain1.gain.setValueAtTime(0.28, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc1.connect(gain1);
        gain1.connect(pipeline.input);
        osc1.start(now);
        osc1.stop(now + 0.06);

        const tMagIn = now + Math.min(0.9, duration * 0.45);
        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.type = 'square';
        osc2.frequency.setValueAtTime(1200, tMagIn);
        osc2.frequency.exponentialRampToValueAtTime(280, tMagIn + 0.08);
        gain2.gain.setValueAtTime(0.22, tMagIn);
        gain2.gain.exponentialRampToValueAtTime(0.001, tMagIn + 0.08);
        osc2.connect(gain2);
        gain2.connect(pipeline.input);
        osc2.start(tMagIn);
        osc2.stop(tMagIn + 0.08);

        const tBolt = now + Math.max(0.3, duration - 0.35);
        const osc3 = this.ctx.createOscillator();
        const gain3 = this.ctx.createGain();
        osc3.type = 'sawtooth';
        osc3.frequency.setValueAtTime(400, tBolt);
        osc3.frequency.linearRampToValueAtTime(1050, tBolt + 0.08);
        gain3.gain.setValueAtTime(0.20, tBolt);
        gain3.gain.exponentialRampToValueAtTime(0.001, tBolt + 0.10);
        osc3.connect(gain3);
        gain3.connect(pipeline.input);
        osc3.start(tBolt);
        osc3.stop(tBolt + 0.10);
    }

    playWeaponDraw(weaponKey, x, y, sourceEntity = null) {
        if (!this.ctx || this.muted) return;
        const maxRange = (sourceEntity === world.player) ? 1200 : 420;
        const pipeline = this.createSpatialPipeline(x, y, maxRange, sourceEntity);
        if (!pipeline) return;

        const now = this.ctx.currentTime;
        const volScale = (sourceEntity === world.player) ? 1.0 : 0.45;

        if (weaponKey === "AWP") {
            // Two-stage heavy sniper bolt pull + lock
            const osc1 = this.ctx.createOscillator();
            const gain1 = this.ctx.createGain();
            osc1.type = 'sawtooth';
            osc1.frequency.setValueAtTime(320, now + 0.06);
            osc1.frequency.linearRampToValueAtTime(680, now + 0.18);
            gain1.gain.setValueAtTime(0.24 * volScale, now + 0.06);
            gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.20);
            osc1.connect(gain1);
            gain1.connect(pipeline.input);
            osc1.start(now + 0.06);
            osc1.stop(now + 0.20);

            const osc2 = this.ctx.createOscillator();
            const gain2 = this.ctx.createGain();
            osc2.type = 'triangle';
            osc2.frequency.setValueAtTime(920, now + 0.24);
            osc2.frequency.exponentialRampToValueAtTime(260, now + 0.34);
            gain2.gain.setValueAtTime(0.28 * volScale, now + 0.24);
            gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
            osc2.connect(gain2);
            gain2.connect(pipeline.input);
            osc2.start(now + 0.24);
            osc2.stop(now + 0.34);
        } else if (weaponKey === "AK47" || weaponKey === "M4A1" || weaponKey === "MP5" || weaponKey === "VECTOR") {
            // Crisp rifle/SMG charging handle rack
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(520, now + 0.04);
            osc.frequency.linearRampToValueAtTime(1180, now + 0.12);
            osc.frequency.exponentialRampToValueAtTime(340, now + 0.19);
            gain.gain.setValueAtTime(0.18 * volScale, now + 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.20);
            osc.connect(gain);
            gain.connect(pipeline.input);
            osc.start(now + 0.04);
            osc.stop(now + 0.20);
        } else if (weaponKey === "KNIFE") {
            // Metallic blade unsheathe ring
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(2400, now);
            osc.frequency.exponentialRampToValueAtTime(3600, now + 0.09);
            gain.gain.setValueAtTime(0.14 * volScale, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
            osc.connect(gain);
            gain.connect(pipeline.input);
            osc.start(now);
            osc.stop(now + 0.11);
        } else if (weaponKey === "DEAGLE" || weaponKey === "USP" || weaponKey === "GLOCK" || weaponKey === "DUALIES") {
            // Sharp pistol slide / hammer snap
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(1150, now + 0.02);
            osc.frequency.exponentialRampToValueAtTime(380, now + 0.10);
            gain.gain.setValueAtTime(0.20 * volScale, now + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
            osc.connect(gain);
            gain.connect(pipeline.input);
            osc.start(now + 0.02);
            osc.stop(now + 0.11);
        } else {
            // Soft cloth/pin rustle for grenades & C4
            const noise = this.ctx.createBufferSource();
            noise.buffer = this.createBufferNoise(0.10);
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 1400;
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.14 * volScale, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.10);
            noise.connect(filter);
            filter.connect(gain);
            gain.connect(pipeline.input);
            noise.start(now);
        }
    }

    createSpatialPipeline(sourceX, sourceY, maxAudibleRange = 1400, sourceEntity = null, isGunshot = false, cleanupMs = 1300) {
        if (!this.ctx || this.muted) return null;
        const sfxScale = this.getEffectiveSfxGain();
        if (sfxScale <= 0.001) return null;

        const listener = getActiveFocus();
        if (sourceX === undefined || sourceY === undefined || !listener) {
            return { input: this.ctx.destination, isOccluded: false };
        }

        const dx = sourceX - listener.x;
        const dy = sourceY - listener.y;
        const dist = Math.hypot(dx, dy);
        const isDistantGunshot = isGunshot && dist > maxAudibleRange;

        if (dist > maxAudibleRange && !isDistantGunshot) return null;

        let panner = null;
        if (this.ctx.createStereoPanner) {
            panner = this.ctx.createStereoPanner();
            const panValue = Math.max(-1.0, Math.min(1.0, dx / 550));
            panner.pan.setValueAtTime(panValue, this.ctx.currentTime);
        }

        const isEnemy = sourceEntity && (sourceEntity.team !== world.playerTeam);

        let hasLOS = true;
        if (dist > 350 && losCheckerFn) {
            hasLOS = losCheckerFn(listener.x, listener.y, sourceX, sourceY);
        }

        const occlusionFilter = this.ctx.createBiquadFilter();
        occlusionFilter.type = 'lowpass';
        if (isDistantGunshot) {
            occlusionFilter.frequency.setValueAtTime(1100, this.ctx.currentTime);
            occlusionFilter.Q.setValueAtTime(1.0, this.ctx.currentTime);
        } else if (!hasLOS) {
            occlusionFilter.frequency.setValueAtTime(isEnemy ? 1400 : 450, this.ctx.currentTime);
            occlusionFilter.Q.setValueAtTime(isEnemy ? 1.0 : 2.0, this.ctx.currentTime);
        } else {
            occlusionFilter.frequency.setValueAtTime(20000, this.ctx.currentTime);
        }

        const distanceGain = this.ctx.createGain();
        let volumeMultiplier;

        if (isDistantGunshot) {
            const farT = Math.min(1.0, (dist - maxAudibleRange) / 1600);
            volumeMultiplier = isEnemy
                ? Math.max(0.12, 0.22 - farT * 0.10)
                : Math.max(0.08, 0.11 - farT * 0.03);
        } else if (isEnemy) {
            const normDist = Math.min(1.0, dist / maxAudibleRange);
            const enemyFalloff = Math.max(0.25, Math.pow(1.0 - normDist, 0.50));
            volumeMultiplier = (hasLOS ? enemyFalloff : enemyFalloff * 0.82) * 2.2;
        } else {
            const defaultFalloff = Math.max(0.04, 1.0 - (dist / maxAudibleRange));
            volumeMultiplier = hasLOS ? defaultFalloff : defaultFalloff * 0.65;
        }

        distanceGain.gain.setValueAtTime(volumeMultiplier * sfxScale, this.ctx.currentTime);

        if (panner) {
            occlusionFilter.connect(panner);
            panner.connect(distanceGain);
        } else {
            occlusionFilter.connect(distanceGain);
        }
        distanceGain.connect(this.ctx.destination);

        setTimeout(() => {
            try {
                occlusionFilter.disconnect();
                if (panner) panner.disconnect();
                distanceGain.disconnect();
            } catch (_) {}
        }, cleanupMs);

        return { input: occlusionFilter, isOccluded: !hasLOS };
    }

    createBufferNoise(duration = 0.5) {
        if (!this.ctx) return null;
        if (this.noiseCache[duration]) return this.noiseCache[duration];
        const bufferSize = Math.floor(this.ctx.sampleRate * duration);
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        this.noiseCache[duration] = buffer;
        return buffer;
    }

    playPistol(x, y, sourceEntity = null) {
        if (!this.ctx || this.muted) return;
        const pipeline = this.createSpatialPipeline(x, y, 1200, sourceEntity, true);
        if (!pipeline) return;

        const now = this.ctx.currentTime;
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.createBufferNoise(0.08);
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1800;

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(pipeline.input);
        noise.start(now);
    }

    playDeagle(x, y, sourceEntity = null) {
        if (!this.ctx || this.muted) return;
        const pipeline = this.createSpatialPipeline(x, y, 1400, sourceEntity, true);
        if (!pipeline) return;

        const now = this.ctx.currentTime;
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.createBufferNoise(0.22);
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 2400;

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.7, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(pipeline.input);
        noise.start(now);
    }

    playRifle(x, y, sourceEntity = null) {
        if (!this.ctx || this.muted) return;
        const pipeline = this.createSpatialPipeline(x, y, 1500, sourceEntity, true);
        if (!pipeline) return;

        const now = this.ctx.currentTime;
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.createBufferNoise(0.12);
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 2200;

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(pipeline.input);
        noise.start(now);
    }

    playVector(x, y, sourceEntity = null) {
        if (!this.ctx || this.muted) return;
        const pipeline = this.createSpatialPipeline(x, y, 1300, sourceEntity, true);
        if (!pipeline) return;

        const now = this.ctx.currentTime;
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.createBufferNoise(0.065);
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 2600;
        filter.Q.value = 1.2;

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.42, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.065);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(pipeline.input);
        noise.start(now);
    }

    playAWP(x, y, sourceEntity = null) {
        if (!this.ctx || this.muted) return;
        const pipeline = this.createSpatialPipeline(x, y, 2200, sourceEntity, true);
        if (!pipeline) return;

        const now = this.ctx.currentTime;
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.createBufferNoise(0.45);
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1000;

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(1.0, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(pipeline.input);
        noise.start(now);
    }

    playKnifeSwing() {
        if (!this.ctx || this.muted) return;
        const sfxScale = this.getEffectiveSfxGain();
        if (sfxScale <= 0.001) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.08);

        gain.gain.setValueAtTime(0.2 * sfxScale, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.08);
    }

    playHitTick() {
        if (!this.ctx || this.muted) return;
        const sfxScale = this.getEffectiveSfxGain();
        if (sfxScale <= 0.001) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1200, now);

        gain.gain.setValueAtTime(0.15 * sfxScale, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.04);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.04);
    }

    playWallImpact(x, y, isPenetration = false) {
        if (!this.ctx || this.muted) return;
        const pipeline = this.createSpatialPipeline(x, y, 750);
        if (!pipeline) return;

        const now = this.ctx.currentTime;
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.createBufferNoise(0.05);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(isPenetration ? 1400 : 2400, now);
        filter.Q.setValueAtTime(2.2, now);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(isPenetration ? 0.16 : 0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(pipeline.input);
        noise.start(now);
    }

    playScopeZoom(stage = 1) {
        if (!this.ctx || this.muted) return;
        const sfxScale = this.getEffectiveSfxGain();
        if (sfxScale <= 0.001) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        const pitchTable = {
            0: { start: 1050, end: 580 },
            1: { start: 1050, end: 1380 },
            2: { start: 1350, end: 1720 },
            3: { start: 1650, end: 2100 }
        };
        const tone = pitchTable[stage] || pitchTable[1];

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(tone.start, now);
        osc.frequency.exponentialRampToValueAtTime(tone.end, now + 0.045);

        gain.gain.setValueAtTime(0.18 * sfxScale, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
    }

    playHeadshotDing() {
        if (!this.ctx || this.muted) return;
        const sfxScale = this.getEffectiveSfxGain();
        if (sfxScale <= 0.001) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(2800, now);

        gain.gain.setValueAtTime(0.4 * sfxScale, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.12);
    }

    playC4Beep(pitchMult = 1.0, x, y) {
        if (!this.ctx || this.muted) return;
        const sfxScale = this.getEffectiveSfxGain();
        if (sfxScale <= 0.001) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.value = 2400 * pitchMult;

        const listener = getActiveFocus();
        let volume = 0.35;
        let panValue = 0;

        if (listener && x !== undefined && y !== undefined) {
            const dx = x - listener.x;
            const dy = y - listener.y;
            const dist = Math.hypot(dx, dy);

            panValue = Math.max(-1.0, Math.min(1.0, dx / 700));
            const falloff = Math.max(0, 1.0 - dist / 2400);
            volume = 0.16 + falloff * 0.22;
        }

        gain.gain.setValueAtTime(volume * sfxScale, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        if (this.ctx.createStereoPanner) {
            const panner = this.ctx.createStereoPanner();
            panner.pan.setValueAtTime(panValue, now);
            osc.connect(gain);
            gain.connect(panner);
            panner.connect(this.ctx.destination);
        } else {
            osc.connect(gain);
            gain.connect(this.ctx.destination);
        }

        osc.start(now);
        osc.stop(now + 0.08);
    }

    playDefuseClick(x, y) {
        if (!this.ctx || this.muted) return;
        const pipeline = this.createSpatialPipeline(x, y, 800);
        if (!pipeline) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1600, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.05);

        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);

        osc.connect(gain);
        gain.connect(pipeline.input);
        osc.start(now);
        osc.stop(now + 0.05);
    }

    playBuySound() {
        if (!this.ctx || this.muted) return;
        const sfxScale = this.getEffectiveSfxGain();
        if (sfxScale <= 0.001) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.setValueAtTime(1200, now + 0.06);

        gain.gain.setValueAtTime(0.25 * sfxScale, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.12);
    }

    playC4Explosion(x, y) {
        if (!this.ctx || this.muted) return;
        const pipeline = this.createSpatialPipeline(x, y, 2600);
        if (!pipeline) return;

        const now = this.ctx.currentTime;
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.createBufferNoise(1.2);
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(900, now);
        filter.frequency.exponentialRampToValueAtTime(80, now + 1.2);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(1.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 1.2);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(pipeline.input);
        noise.start(now);
    }

    playSmokePop(x, y) {
        if (!this.ctx || this.muted) return;
        const pipeline = this.createSpatialPipeline(x, y, 1200);
        if (!pipeline) return;

        const now = this.ctx.currentTime;
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.createBufferNoise(0.5);
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(600, now);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.6, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(pipeline.input);
        noise.start(now);
    }

    playFootstep(x, y, sourceEntity = null) {
        if (!this.ctx || this.muted) return;
        const pipeline = this.createSpatialPipeline(x, y, FOOTSTEP_LISTEN_RADIUS, sourceEntity);
        if (!pipeline) return;

        const now = this.ctx.currentTime;
        const isSelf = sourceEntity && (sourceEntity === world.player);
        const isEnemy = sourceEntity && (sourceEntity.team !== world.playerTeam);
        const roleGain = isSelf ? 0.18 : (isEnemy ? 0.42 : 0.26);

        // Alternate left/right foot pitch slightly so sprinting sounds like a natural stride
        let stepSign = 1;
        if (sourceEntity) {
            sourceEntity._stepAlt = !sourceEntity._stepAlt;
            stepSign = sourceEntity._stepAlt ? 1 : -1;
        }
        const pitchScale = 1 + stepSign * 0.05 + (Math.random() - 0.5) * 0.03;

        // 1. Solid rubber-sole heel thud (clean sine drop, no triangle buzz)
        const heelOsc = this.ctx.createOscillator();
        const heelGain = this.ctx.createGain();
        heelOsc.type = 'sine';
        heelOsc.frequency.setValueAtTime(138 * pitchScale, now);
        heelOsc.frequency.exponentialRampToValueAtTime(38, now + 0.065);

        heelGain.gain.setValueAtTime(roleGain * 1.1, now);
        heelGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

        heelOsc.connect(heelGain);
        heelGain.connect(pipeline.input);
        heelOsc.start(now);
        heelOsc.stop(now + 0.07);

        // 2. Ultra-short dry stone/concrete tap (22ms, zero sandy hiss tail)
        const tap = this.ctx.createBufferSource();
        tap.buffer = this.createBufferNoise(0.022);

        const tapFilter = this.ctx.createBiquadFilter();
        tapFilter.type = 'bandpass';
        tapFilter.frequency.setValueAtTime(820 * pitchScale, now);
        tapFilter.Q.setValueAtTime(3.2, now);

        const tapGain = this.ctx.createGain();
        tapGain.gain.setValueAtTime(roleGain * 0.55, now);
        tapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.022);

        tap.connect(tapFilter);
        tapFilter.connect(tapGain);
        tapGain.connect(pipeline.input);
        tap.start(now);

        // 3. Soft secondary toe-off plant (+32ms) for heavy boot weight
        const toeTime = now + 0.032;
        const toeOsc = this.ctx.createOscillator();
        const toeGain = this.ctx.createGain();
        toeOsc.type = 'sine';
        toeOsc.frequency.setValueAtTime(105 * pitchScale, toeTime);
        toeOsc.frequency.exponentialRampToValueAtTime(42, toeTime + 0.045);

        toeGain.gain.setValueAtTime(roleGain * 0.45, toeTime);
        toeGain.gain.exponentialRampToValueAtTime(0.001, toeTime + 0.048);

        toeOsc.connect(toeGain);
        toeGain.connect(pipeline.input);
        toeOsc.start(toeTime);
        toeOsc.stop(toeTime + 0.048);
    }

    announce(text, targetTeam = "ALL", force = false) {
        if (this.muted) return;
        if (targetTeam !== "ALL" && targetTeam !== world.playerTeam) return;

        const radioScale = this.masterVolume * this.radioVolume;
        if (radioScale <= 0.001) return;

        const now = performance.now();
        if (!force && (now - this.lastRadioCallTime < 2500)) return;
        this.lastRadioCallTime = now;

        try {
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
                const msg = new SpeechSynthesisUtterance(text);
                msg.rate = 1.05;
                msg.pitch = 0.85;
                msg.volume = radioScale;
                window.speechSynthesis.speak(msg);
            }
        } catch (e) {
            console.warn("Speech Synthesis unavailable", e);
        }
    }
}

export const audio = new AudioSynthesizer();