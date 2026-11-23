/* ==========================================================================
   MATCH LIFECYCLE, ROUND TIMERS, ECONOMY SHOP, C4 EVENTS & KILL TRACKING
   ========================================================================== */
import {
    world,
    matchState,
    c4State,
    pincerState,
    ctPincerState,
    C4_DETONATION_TIME,
    rnd,
    setRoundSeed,
    audio,
    updateCharacterLists,
    registerKillHandler,
    getFormattedPlayerTag,
    showAnnouncerBanner,
    resetTacticalIntelForRound,
    recordDeducedAWPNest,
    recordAWPDangerSpot,
    updateAWPDangerMemoryForNewRound
} from '../state.js';
import {
    MAP,
    T_STRATEGIES,
    CT_STRATEGIES,
    CT_DEFENSE_SPOTS,
    TACTICAL_CORNERS,
    STRATEGIC_POWER_POSITIONS,
    getClosestRouteIndex
} from '../js-map-physics/dedust2map.js';
import { getLineOfSight, getMapLineOfSight } from '../js-map-physics/map-physics.js';
import { WEAPONS } from './Weapon-behavior.js';
import { Character } from './Character.js';

const GRENADE_META = {
    HEGRENADE: { flag: "hasHE", slot: 4 },
    SMOKE: { flag: "hasSmoke", slot: 5 },
    FLASH: { flag: "hasFlash", slot: 7 },
    MOLOTOV: { flag: "hasMolotov", slot: 8 }
};

/* ==========================================================================
   KILLER SUSPICION & SNIPER ORIGIN DEDUCTION
   ========================================================================== */
function deduceSniperOriginFromKill(victim, killer) {
    const shotAngle = Math.atan2(killer.y - victim.y, killer.x - victim.x);
    let bestAnchor = null;
    let bestScore = Infinity;

    for (let i = 0; i < TACTICAL_CORNERS.length; i++) {
        const c = TACTICAL_CORNERS[i];
        if (!getMapLineOfSight(c.x, c.y, victim.x, victim.y)) continue;
        const dKiller = Math.hypot(c.x - killer.x, c.y - killer.y);
        if (dKiller > 160) continue;
        if (dKiller < bestScore) {
            bestScore = dKiller;
            bestAnchor = c;
        }
    }

    if (!bestAnchor) {
        for (let i = 0; i < STRATEGIC_POWER_POSITIONS.length; i++) {
            const p = STRATEGIC_POWER_POSITIONS[i];
            const dKiller = Math.hypot(p.anchorX - killer.x, p.anchorY - killer.y);
            if (dKiller <= 165 && getMapLineOfSight(p.anchorX, p.anchorY, victim.x, victim.y)) {
                bestAnchor = { x: p.anchorX, y: p.anchorY };
                break;
            }
        }
    }

    if (bestAnchor) {
        return { x: bestAnchor.x, y: bestAnchor.y };
    }

    const estDist = Math.min(780, Math.hypot(killer.x - victim.x, killer.y - victim.y));
    const fuzzAng = shotAngle + (rnd() - 0.5) * 0.12;
    return {
        x: victim.x + Math.cos(fuzzAng) * estDist,
        y: victim.y + Math.sin(fuzzAng) * estDist
    };
}

export function registerKillerSuspicion(killer, victim, weaponName) {
    if (!killer || !victim || killer.team === victim.team) return;
    const wep = WEAPONS[weaponName] || (killer.getWeapon ? killer.getWeapon() : null);
    const isAWPKill = Boolean((weaponName && weaponName.includes("AWP")) || (wep && wep.category === "sniper"));
    const wepCategory = isAWPKill ? "sniper" : (wep ? wep.category : "rifle");

    // Killfeed [AWP] + teammate death location allows inferring the sniper's angle even through smoke or fog-of-war
    if (!isAWPKill && !getLineOfSight(victim.x, victim.y, killer.x, killer.y)) return;

    const deducedPos = isAWPKill ? deduceSniperOriginFromKill(victim, killer) : { x: killer.x, y: killer.y };
    if (isAWPKill) {
        recordDeducedAWPNest(victim.team, deducedPos.x, deducedPos.y, "KILLFEED_AWP", 16.0);
        if (!c4State.isPlanted) {
            recordAWPDangerSpot(
                victim.team,
                victim.x,
                victim.y,
                deducedPos.x,
                deducedPos.y,
                115 - matchState.roundTimer,
                matchState.roundNumber
            );
        }
    }

    const memoryList = world.teamSuspicionMemory[victim.team];
    const existing = memoryList.find(s => Math.hypot(s.x - killer.x, s.y - killer.y) < 90);
    if (existing) {
        existing.x = (existing.x + killer.x) * 0.5;
        existing.y = (existing.y + killer.y) * 0.5;
        existing.kills++;
        existing.weaponCategory = wepCategory;
        existing.lastKillRound = matchState.roundNumber;
        existing.clearedThisRound = false;
    } else {
        memoryList.push({
            id: Math.floor(Math.random() * 100000),
            x: killer.x,
            y: killer.y,
            kills: 1,
            weaponCategory: wepCategory,
            lastKillRound: matchState.roundNumber,
            clearedThisRound: false
        });
    }

    if (world.tacticalIntel && world.tacticalIntel.killerHotzones) {
        const hotzones = world.tacticalIntel.killerHotzones[victim.team];
        const existingHz = hotzones.find(h => Math.hypot(h.x - killer.x, h.y - killer.y) < 95);
        if (existingHz) {
            existingHz.x = (existingHz.x + killer.x) * 0.5;
            existingHz.y = (existingHz.y + killer.y) * 0.5;
            existingHz.kills++;
            existingHz.streak = (existingHz.streak || 1) + 1;
            existingHz.weaponCategory = wepCategory;
            existingHz.lastKillRound = matchState.roundNumber;
            existingHz.clearedThisRound = false;
        } else {
            hotzones.push({
                id: Math.floor(Math.random() * 100000),
                x: killer.x,
                y: killer.y,
                kills: 1,
                streak: 1,
                weaponCategory: wepCategory,
                lastKillRound: matchState.roundNumber,
                clearedThisRound: false,
                confirmedUntil: 0
            });
        }
    }
}

/* ==========================================================================
   MATCH & ROUND LIFECYCLE
   ========================================================================== */
export function startNewMatch(selectedTeam) {
    world.playerTeam = selectedTeam;
    matchState.ctScore = 0;
    matchState.tScore = 0;
    matchState.roundNumber = 1;
    matchState.lossStreakCT = 0;
    matchState.lossStreakT = 0;
    world.gameTime = 0;

    world.matchSeed = Math.floor(Math.random() * 100000);
    world.teamSuspicionMemory = { CT: [], T: [] };
    updateAWPDangerMemoryForNewRound(1, true);
    world.playerDeathTime = -99;
    world.midBotSpotWeights = {
        MID_1516_940: 1.0,
        MID_1454_755: 1.0,
        MID_1547_1262: 1.0,
        MID_1702_1410: 1.0,
        STRENGTHEN_A: 1.0,
        STRENGTHEN_B: 1.0
    };
    resetTacticalIntelForRound(true);

    window.dispatchEvent(new CustomEvent('cs:matchStart'));

    world.player = new Character(1, getFormattedPlayerTag(), false, world.playerTeam, 0, 0);

    world.bots = [];
    const enemyTeam = world.playerTeam === "CT" ? "T" : "CT";
    const ctBotNames = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];
    const tBotNames = ["Viper", "Ghost", "Reaper", "Shadow", "Titan"];

    const friendlyNames = world.playerTeam === "CT" ? ctBotNames : tBotNames;
    const enemyNames = enemyTeam === "CT" ? ctBotNames : tBotNames;

    let nextId = 2;
    for (let i = 0; i < 4; i++) {
        world.bots.push(new Character(nextId++, friendlyNames[i], true, world.playerTeam, 0, 0));
    }
    for (let i = 0; i < 5; i++) {
        world.bots.push(new Character(nextId++, enemyNames[i], true, enemyTeam, 0, 0));
    }

    updateCharacterLists();

    document.getElementById('start-screen')?.classList.add('hidden');
    document.getElementById('gameover-screen')?.classList.add('hidden');
    document.getElementById('hud-overlay')?.classList.remove('hidden');

    startRound();
}

export function assignBotArchetypes() {
    const ctBots = world.bots.filter(b => b.team === "CT");
    const tBots = world.bots.filter(b => b.team === "T");

    const ctArchetypes = ["AWPER", "ENTRY", "SUPPORT", "ANCHOR", "ANCHOR"];

    let chosenFormation;
    if (world.playerTeam === "CT") {
        const FORMATIONS_4_BOTS = [
            ["PATROL_A", "PATROL_A", "PATROL_B", "MID_DOORS"],
            ["PATROL_A", "PATROL_B", "PATROL_B", "MID_DOORS"],
            ["PATROL_A", "PATROL_A", "PATROL_B", "PATROL_B"]
        ];
        chosenFormation = FORMATIONS_4_BOTS[Math.floor(rnd() * FORMATIONS_4_BOTS.length)];
    } else {
        const FORMATIONS_5_BOTS = [
            ["PATROL_A", "PATROL_A", "MID_DOORS", "PATROL_B", "PATROL_B"],
            ["PATROL_A", "PATROL_A", "MID_DOORS", "PATROL_B", "PATROL_B"],
            ["PATROL_A", "PATROL_A", "MID_DOORS", "PATROL_B", "PATROL_B"],
            ["PATROL_A", "PATROL_A", "PATROL_A", "MID_DOORS", "PATROL_B"],
            ["PATROL_A", "PATROL_B", "PATROL_B", "PATROL_B", "MID_DOORS"]
        ];
        chosenFormation = FORMATIONS_5_BOTS[Math.floor(rnd() * FORMATIONS_5_BOTS.length)];
    }

    const availableASpots = ["A_LONG_CORNER", "A_SITE_PILLAR", "A_SHORT_DOOR", "A_EAST_CUBBY"];
    for (let i = availableASpots.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [availableASpots[i], availableASpots[j]] = [availableASpots[j], availableASpots[i]];
    }

    const availableBSpots = ["B_DOOR_CHOKE", "B_ANT_HILL_CHOKE", "B_EAST_CUBBY"];
    for (let i = availableBSpots.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [availableBSpots[i], availableBSpots[j]] = [availableBSpots[j], availableBSpots[i]];
    }

    if (!world.midBotSpotWeights) {
        world.midBotSpotWeights = {
            MID_1516_940: 1.0,
            MID_1454_755: 1.0,
            MID_1547_1262: 1.0,
            MID_1702_1410: 1.0,
            STRENGTHEN_A: 1.0,
            STRENGTHEN_B: 1.0
        };
    }

    // 6 equal-start options for the Mid CT bot with unobstructed sightlines down Mid & Connector
    const MID_BOT_OPTIONS = [
        // 1. Mid Bunker North-West Corner: looks cleanly through the Mid Doors opening (1290, 1080)
        { key: "MID_1516_940", strat: "MID_DOORS", spot: { id: "MID_1516_940", name: "Mid L-Bunker North", x: 1495, y: 1020, angle: Math.atan2(1080 - 1020, 1290 - 1495), site: "MID" } },
        // 2. Upper-Mid Pillar West Edge: watches down the full Mid corridor toward (1385, 1080)
        { key: "MID_1454_755", strat: "MID_DOORS", spot: { id: "MID_1454_755", name: "Upper Mid Pillar", x: 1434, y: 805, angle: Math.atan2(1080 - 805, 1385 - 1434), site: "MID" } },
        // 3. South-West Mid Bunker Corner: watches diagonally through Mid Doors (1290, 1080)
        { key: "MID_1547_1262", strat: "MID_DOORS", spot: { id: "MID_1547_1262", name: "South-West Mid Watch", x: 1547, y: 1272, angle: Math.atan2(1080 - 1272, 1290 - 1547), site: "MID" } },
        // 4. Mid-to-Ant-Hill Connector: hugs east edge of pillar (1690) and watches south into Ant-Hill (1733, 1540)
        { key: "MID_1702_1410", strat: "MID_DOORS", spot: { id: "MID_1702_1410", name: "Mid Connector Watch", x: 1712, y: 1425, angle: Math.PI / 2, site: "MID" } },
        { key: "STRENGTHEN_A", strat: "PATROL_A", spot: null },
        { key: "STRENGTHEN_B", strat: "PATROL_B", spot: null }
    ];

    const pickWeightedMidOption = () => {
        let totalWeight = 0;
        for (let i = 0; i < MID_BOT_OPTIONS.length; i++) {
            totalWeight += (world.midBotSpotWeights[MID_BOT_OPTIONS[i].key] ?? 1.0);
        }
        let roll = rnd() * totalWeight;
        for (let i = 0; i < MID_BOT_OPTIONS.length; i++) {
            const opt = MID_BOT_OPTIONS[i];
            roll -= (world.midBotSpotWeights[opt.key] ?? 1.0);
            if (roll <= 0) return opt;
        }
        return MID_BOT_OPTIONS[0];
    };

    let aSpotIdx = 0;
    let bSpotIdx = 0;

    ctBots.forEach((bot, idx) => {
        bot.archetype = ctArchetypes[idx % ctArchetypes.length];
        bot.aggroFactor = bot.archetype === "ENTRY" ? 0.9 : (bot.archetype === "AWPER" ? 0.35 : 0.65);
        bot.retakeGroup = (idx % 2 === 0) ? "RAMP" : "CATWALK";
        bot.humanReactionDelay = (bot.archetype === "AWPER" || bot.archetype === "ENTRY")
            ? (0.1575 + rnd() * 0.03)
            : (0.1675 + rnd() * 0.04);

        let assignedStratKey = chosenFormation[idx % chosenFormation.length];
        bot.midOptionKey = null;
        bot.assignedMidSpot = null;

        if (assignedStratKey === "MID_DOORS") {
            const chosenOpt = pickWeightedMidOption();
            assignedStratKey = chosenOpt.strat;
            bot.midOptionKey = chosenOpt.key;
            bot.assignedMidSpot = chosenOpt.spot;
        }

        bot.assignedCTStrat = CT_STRATEGIES[assignedStratKey];
        bot.role = bot.assignedCTStrat.name;
        bot.planIndex = 0;
        bot.maxPlanIndex = 0;
        bot.isFollowingPlanRoute = true;
        bot.patrolTargetWp = null;
        bot.dynamicDefensePos = null;
        bot.lastKillRepositionCount = bot.kills || 0;
        bot.anchorHoldTimer = 0;
        bot.isAggroPushing = false;
        bot.aggroPushCompleted = false;
        bot.ctAggroPushTarget = null;

        if (assignedStratKey === "PATROL_A") {
            const spotId = availableASpots[aSpotIdx % availableASpots.length];
            bot.assignedDefenseSpot = CT_DEFENSE_SPOTS.find(s => s.id === spotId) || null;
            aSpotIdx++;
        } else if (assignedStratKey === "PATROL_B") {
            const spotId = availableBSpots[bSpotIdx % availableBSpots.length];
            bot.assignedDefenseSpot = CT_DEFENSE_SPOTS.find(s => s.id === spotId) || null;
            bSpotIdx++;
        } else {
            bot.assignedDefenseSpot = bot.assignedMidSpot || null;
        }
    });

    const tArchetypes = ["ENTRY", "AWPER", "SUPPORT", "ANCHOR", "ANCHOR"];
    tBots.forEach((bot, idx) => {
        bot.archetype = tArchetypes[idx % tArchetypes.length];
        bot.aggroFactor = bot.archetype === "ENTRY" ? 0.95 : (bot.archetype === "AWPER" ? 0.30 : 0.7);
        bot.squadGroup = (idx % 2 === 0) ? "ALPHA" : "BRAVO";
        bot.humanReactionDelay = (bot.archetype === "AWPER" || bot.archetype === "ENTRY")
            ? (0.1575 + rnd() * 0.03)
            : (0.1675 + rnd() * 0.04);
    });
}

export function startRound() {
    setRoundSeed(world.matchSeed + matchState.roundNumber * 10007);

    matchState.roundPhase = "BUY_TIME";
    matchState.freezeTimer = 10;
    matchState.roundTimer = 115;

    world.squadHelpSignals = [];
    world.teamUtilityReservations = [];
    world.recentAcousticEvents = [];
    world.sharedEnemyIntelCT = {};
    world.sharedEnemyIntelT = {};
    world.activeAWPThreat = null;
    world.awpSwarmSignals = [];
    world.lastEnemyIntelTimeCT = world.gameTime;
    world.lastEnemyIntelTimeT = world.gameTime;

    c4State.carrier = null;
    c4State.isDropped = false;
    c4State.isPlanted = false;
    c4State.timer = C4_DETONATION_TIME;
    c4State.plantProgress = 0;
    c4State.defuseProgress = 0;
    c4State.designatedDefuser = null;
    c4State.c4Retriever = null;
    c4State.isBeingDefused = false;
    c4State.ctRetakeAnnounced = false;
    c4State.evacAnnounced = false;
    c4State.planter = null;
    c4State.ctSeenDropped = false;
    c4State.ctSeenRecovered = false;
    c4State.lastDefuseSoundTime = -99;

    pincerState.alphaStaged = false;
    pincerState.bravoStaged = false;
    pincerState.breachInitiated = false;
    pincerState.stagingTimer = 0;

    ctPincerState.alphaStaged = false;
    ctPincerState.bravoStaged = false;
    ctPincerState.breachInitiated = false;
    ctPincerState.stagingTimer = 0;

    world.bullets = [];
    world.grenades = [];
    world.smokeClouds = [];
    world.shockwaves = [];
    world.particles = [];
    world.corpses = [];
    world.droppedWeapons = [];
    world.soundRipples = [];
    world.firePatches = [];

    for (const team in world.teamSuspicionMemory) {
        world.teamSuspicionMemory[team].forEach(s => { s.clearedThisRound = false; });
    }
    resetTacticalIntelForRound(false);
    updateAWPDangerMemoryForNewRound(matchState.roundNumber, false);

    const ctList = [world.player, ...world.bots].filter(e => e && e.team === "CT");
    ctList.forEach((ct, idx) => {
        const sp = MAP.spawnsCT[idx % MAP.spawnsCT.length];
        ct.resetForNewRound(sp.x, sp.y);
        ct.angle = Math.PI;
        if (ct.isBot) ct.spawnExitDelay = idx * 0.08;
    });

    const tList = [world.player, ...world.bots].filter(e => e && e.team === "T");
    tList.forEach((t, idx) => {
        const sp = MAP.spawnsT[idx % MAP.spawnsT.length];
        t.resetForNewRound(sp.x, sp.y);
        if (t.isBot) t.spawnExitDelay = idx * 0.08;
    });

    assignBotArchetypes();

    const randomT = tList[Math.floor(rnd() * tList.length)];
    if (randomT) {
        randomT.hasC4 = true;
        c4State.carrier = randomT;
        randomT.squadGroup = "ALPHA";
    }

    // Ensure at least 2 T bots are in ALPHA to directly escort the C4 carrier
    const alphaEscorts = tList.filter(t => t !== randomT && t.squadGroup === "ALPHA");
    if (alphaEscorts.length < 2) {
        tList
            .filter(t => t !== randomT && t.squadGroup !== "ALPHA")
            .slice(0, 2 - alphaEscorts.length)
            .forEach(t => { t.squadGroup = "ALPHA"; });
    }

    const T_STRATEGY_WEIGHTS = {
        // Site A strategies (8 × 2.5 = 20.0 total)
        DIRECT_A_LONG: 2.5,
        GARDEN_A_SHORT: 2.5,
        TOP_MID_A_SHORT: 2.5,
        SPLIT_A: 2.5,
        SPLIT_A_LONG_GAP_SHORT: 2.5,
        A_SHORT_GAP_WRAP_LONG: 2.5,
        MID_TO_A: 2.5,
        SPLIT_MID_CATWALK_A_SHORT: 2.5,
        // Site B strategies (10 × 2.0 = 20.0 total — all 3 Maze tunnels equal)
        MAZE_TOP_LANE_RUSH: 2.0,
        MAZE_MID_LANE_RUSH: 2.0,
        MAZE_BOTTOM_LANE_RUSH: 2.0,
        MAZE_TOP_BOTTOM_PINCER: 2.0,
        MAZE_MID_BOTTOM_PINCER: 2.0,
        SPLIT_B_MID: 2.0,
        MID_TO_B_DOORS: 2.0,
        SPLIT_MID_MAZE_B_DOORS: 2.0,
        MID_CONNECTOR_MAZE_TOP_MID: 2.0,
        MID_CONNECTOR_MAZE_BOTTOM: 2.0
    };

    const stratKeys = Object.keys(T_STRATEGIES);
    let totalStratWeight = 0;
    for (let i = 0; i < stratKeys.length; i++) {
        totalStratWeight += (T_STRATEGY_WEIGHTS[stratKeys[i]] ?? 1.0);
    }
    let stratRoll = rnd() * totalStratWeight;
    let pickedStratKey = stratKeys[0];
    for (let i = 0; i < stratKeys.length; i++) {
        const k = stratKeys[i];
        stratRoll -= (T_STRATEGY_WEIGHTS[k] ?? 1.0);
        if (stratRoll <= 0) {
            pickedStratKey = k;
            break;
        }
    }
    world.currentTStrategyKey = pickedStratKey;
    const activeStrat = T_STRATEGIES[world.currentTStrategyKey];

    const stratKeys = Object.keys(T_STRATEGIES);
    let totalStratWeight = 0;
    for (let i = 0; i < stratKeys.length; i++) {
        totalStratWeight += (T_STRATEGY_WEIGHTS[stratKeys[i]] ?? 1.0);
    }
    let stratRoll = rnd() * totalStratWeight;
    let pickedStratKey = stratKeys[0];
    for (let i = 0; i < stratKeys.length; i++) {
        const k = stratKeys[i];
        stratRoll -= (T_STRATEGY_WEIGHTS[k] ?? 1.0);
        if (stratRoll <= 0) {
            pickedStratKey = k;
            break;
        }
    }
    world.currentTStrategyKey = pickedStratKey;
    const activeStrat = T_STRATEGIES[world.currentTStrategyKey];

    tList.forEach(t => {
        t.assignedSite = activeStrat.targetSite;
        t.executePhase = "BREACH";
        t.assemblyTimer = 0;
        t.siteObjectiveLock = true;
        const useCarrierRoute = t.hasC4 || t.squadGroup === "ALPHA" || !activeStrat.isSplit;
        const planPath = useCarrierRoute ? activeStrat.carrierRoute : activeStrat.supportRoute;
        t.planIndex = getClosestRouteIndex(t.x, t.y, planPath);
        t.maxPlanIndex = t.planIndex;
        t.isFollowingPlanRoute = true;
    });

    if (!activeStrat.isSplit) {
        pincerState.breachInitiated = true;
    }

    triggerBotShopping();
    updateCharacterLists();

    world.gameState = "PLAYING";

    if (world.playerTeam === "CT") {
        showAnnouncerBanner(`ROUND ${matchState.roundNumber}`, `DEFEND BOMBSITES A & B`);
    } else {
        showAnnouncerBanner(`ROUND ${matchState.roundNumber}`, `STRATEGY: ${activeStrat.name}`);
    }
}

export function endRound(winningTeam, reasonText, force = false) {
    if (matchState.roundPhase === "ROUND_END" && !force) return;
    matchState.roundPhase = "ROUND_END";

    if (winningTeam === "CT") {
        matchState.ctScore++;
        matchState.lossStreakCT = 0;
        matchState.lossStreakT++;
        audio.announce("Counter-Terrorists win", "ALL", true);
        showAnnouncerBanner("COUNTER-TERRORISTS WIN", reasonText, "ALL", "CT");
    } else {
        matchState.tScore++;
        matchState.lossStreakT = 0;
        matchState.lossStreakCT++;
        audio.announce("Terrorists win", "ALL", true);
        showAnnouncerBanner("TERRORISTS WIN", reasonText, "ALL", "T");
    }

    distributeEconomyRewards(winningTeam);

    setTimeout(() => {
        if (matchState.ctScore >= 16 || matchState.tScore >= 16) {
            triggerMatchVictory();
        } else {
            if (matchState.roundNumber === 15) {
                const tempScore = matchState.ctScore;
                matchState.ctScore = matchState.tScore;
                matchState.tScore = tempScore;

                matchState.lossStreakCT = 0;
                matchState.lossStreakT = 0;

                world.playerTeam = world.playerTeam === "CT" ? "T" : "CT";
                if (world.player) world.player.team = world.playerTeam;
                world.bots.forEach(b => { b.team = b.team === "CT" ? "T" : "CT"; });

                [world.player, ...world.bots].filter(Boolean).forEach(ent => {
                    ent.resetForHalftime();
                });

                showAnnouncerBanner("HALFTIME", "TEAMS SWAPPING SIDES!");
                world.teamSuspicionMemory = { CT: [], T: [] };
                updateAWPDangerMemoryForNewRound(16, true);
                world.midBotSpotWeights = {
                    MID_1516_940: 1.0,
                    MID_1454_755: 1.0,
                    MID_1547_1262: 1.0,
                    MID_1702_1410: 1.0,
                    STRENGTHEN_A: 1.0,
                    STRENGTHEN_B: 1.0
                };
                resetTacticalIntelForRound(true);
            }
            matchState.roundNumber++;
            startRound();
        }
    }, 4000);
}

export function distributeEconomyRewards(winningTeam) {
    const allEntities = [world.player, ...world.bots].filter(Boolean);

    allEntities.forEach(ent => {
        let reward = 0;
        if (ent.team === winningTeam) {
            reward = 3250;
        } else {
            const streak = ent.team === "CT" ? matchState.lossStreakCT : matchState.lossStreakT;
            reward = Math.min(3400, 1400 + (streak - 1) * 500);
            if (ent.team === "T" && c4State.isPlanted) reward += 800;
        }
        ent.money = Math.min(16000, ent.money + reward);
    });
}

export function triggerMatchVictory() {
    world.gameState = "GAMEOVER";
    window.dispatchEvent(new CustomEvent('cs:matchVictory'));
}

/* ==========================================================================
   KILL TRACKING, KILLFEED & ROUND WIN CHECKS
   ========================================================================== */
export function handleKill(killer, victim, isHeadshot, weaponName) {
    if (killer) killer.kills++;

    // If the Mid CT bot dies within the first 20s nearby his chosen defense spot/site, halve that option's probability next round
    if (victim && victim.isBot && victim.team === "CT" && victim.midOptionKey && world.midBotSpotWeights) {
        const roundElapsed = 115 - matchState.roundTimer;
        if (roundElapsed <= 20.0) {
            let diedNearAssignedArea = false;
            if (victim.midOptionKey === "STRENGTHEN_A") {
                diedNearAssignedArea = (victim.x >= 1350 && victim.y <= 720);
            } else if (victim.midOptionKey === "STRENGTHEN_B") {
                diedNearAssignedArea = (victim.x >= 1550 && victim.y >= 1320);
            } else if (victim.assignedMidSpot) {
                diedNearAssignedArea = Math.hypot(victim.x - victim.assignedMidSpot.x, victim.y - victim.assignedMidSpot.y) <= 340;
            }

            if (diedNearAssignedArea) {
                const curWeight = world.midBotSpotWeights[victim.midOptionKey] ?? 1.0;
                world.midBotSpotWeights[victim.midOptionKey] = Math.max(0.05, curWeight * 0.5);
            }
        }
    }

    if (killer === world.player && victim !== world.player) {
        const weaponKey = killer.getEquippedKey ? killer.getEquippedKey() : weaponName;
        window.dispatchEvent(new CustomEvent('cs:playerKill', {
            detail: {
                isHeadshot,
                weaponName,
                weaponKey,
                victimName: victim.name,
                victimTeam: victim.team,
                skin: killer.activeWeaponSkins?.[weaponKey] || null
            }
        }));
    }

    world.squadHelpSignals = world.squadHelpSignals.filter(
        s => s.victim !== victim && s.targetEnemy !== victim && s.attacker !== victim
    );

    // Clear active AWP signals & deduced nests if an AWPer was eliminated
    if (world.activeAWPThreat?.shooter === victim) {
        world.activeAWPThreat = null;
    }
    world.awpSwarmSignals = world.awpSwarmSignals.filter(s => s.awper !== victim);
    if (victim && (victim.primaryKey === "AWP" || victim.archetype === "AWPER")) {
        const opposingTeam = victim.team === "CT" ? "T" : "CT";
        const nests = world.tacticalIntel?.deducedAWPNests?.[opposingTeam];
        if (nests) {
            for (let i = nests.length - 1; i >= 0; i--) {
                if (Math.hypot(nests[i].x - victim.x, nests[i].y - victim.y) < 180) {
                    nests.splice(i, 1);
                }
            }
        }
    }

    registerKillerSuspicion(killer, victim, weaponName);

    const isAWPKill = Boolean((weaponName && weaponName.includes("AWP")) || (killer && killer.getEquippedKey && killer.getEquippedKey() === "AWP"));
    if (killer && killer !== victim) {
        const tradeCandidates = world.bots.filter(
            b => b && !b.isDead && b.team === victim.team && b !== victim && Math.hypot(b.x - victim.x, b.y - victim.y) < 380
        );
        if (tradeCandidates.length > 0) {
            tradeCandidates.sort((a, b) => Math.hypot(a.x - victim.x, a.y - victim.y) - Math.hypot(b.x - victim.x, b.y - victim.y));
            const trader = tradeCandidates[0];
            const distToAWPer = Math.hypot(killer.x - trader.x, killer.y - trader.y);

            if (!isAWPKill || distToAWPer <= 250 || trader.getEquippedKey() === "AWP") {
                trader.tradeTarget = killer;
                trader.tradeTimer = 2.2;
                if (trader.activeSlot === 3) {
                    trader.selectSlot(trader.primaryKey ? 1 : (trader.secondaryKey ? 2 : 3));
                }
            }
        }
    }

    const killfeedEl = document.getElementById('killfeed');
    if (killfeedEl) {
        const item = document.createElement('div');
        item.className = 'cs-box-bg px-3 py-1 rounded text-xs font-bold flex items-center gap-2 border border-amber-500/30 animate-pulse';

        const killerName = killer ? killer.name : "WORLD";
        const killerTeam = killer ? killer.team : "CT";
        const killerColor = killerTeam === 'CT' ? 'text-blue-400' : 'text-red-400';
        const victimColor = victim.team === 'CT' ? 'text-blue-400' : 'text-red-400';

        item.innerHTML = `
            <span class="${killerColor}">${killerName}</span>
            <span class="text-gray-400 font-mono">[${weaponName}${isHeadshot ? ' 🎯' : ''}]</span>
            <span class="${victimColor}">${victim.name}</span>
        `;
        killfeedEl.appendChild(item);
        setTimeout(() => { if (item.parentNode) item.parentNode.removeChild(item); }, 5000);
    }

    checkRoundConditions();
}

registerKillHandler(handleKill);

export function checkRoundConditions() {
    if (matchState.roundPhase === "ROUND_END") return;

    const ctAlive = [world.player, ...world.bots].filter(e => e && !e.isDead && e.team === "CT").length;
    const tAlive = [world.player, ...world.bots].filter(e => e && !e.isDead && e.team === "T").length;

    if (tAlive === 0 && !c4State.isPlanted) {
        endRound("CT", "ALL TERRORISTS ELIMINATED");
    } else if (ctAlive === 0) {
        endRound("T", "ALL COUNTER-TERRORISTS ELIMINATED");
    }
}

/* ==========================================================================
   C4 PLANT, DEFUSE & DETONATION EVENTS
   ========================================================================== */
export function triggerC4Plant(planter, site) {
    if (c4State.isPlanted) return;
    c4State.isPlanted = true;
    c4State.plantX = planter.x;
    c4State.plantY = planter.y;
    c4State.plantSite = site;
    c4State.timer = C4_DETONATION_TIME;
    c4State.beepTimer = 0;
    c4State.plantProgress = 0;
    c4State.defuseProgress = 0;
    c4State.isBeingDefused = false;
    c4State.ctRetakeAnnounced = false;
    planter.hasC4 = false;
    c4State.carrier = null;

    planter.money = Math.min(16000, planter.money + 300);

    const tList = [world.player, ...world.bots].filter(e => e && e.team === "T");
    tList.forEach(t => {
        t.executePhase = "DEFEND_BOMB";
        t.siteObjectiveLock = false;
    });

    audio.announce("Bomb has been planted", "ALL", true);
    showAnnouncerBanner("BOMB HAS BEEN PLANTED", `DEFUSE AT BOMBSITE ${site}!`, "ALL", "T");
    document.getElementById('hud-c4-status')?.classList.remove('hidden');
}

export function triggerC4Defused() {
    if (!c4State.isPlanted) return;
    c4State.isPlanted = false;
    c4State.isBeingDefused = false;
    c4State.defuseProgress = 0;
    if (c4State.designatedDefuser) {
        c4State.designatedDefuser.money = Math.min(16000, c4State.designatedDefuser.money + 300);
    }
    audio.announce("The bomb has been defused", "ALL", true);
    endRound("CT", "BOMB HAS BEEN DEFUSED");
}

export function triggerC4Explosion() {
    if (!c4State.isPlanted) return;
    c4State.isPlanted = false;
    c4State.isBeingDefused = false;
    audio.playC4Explosion(c4State.plantX, c4State.plantY);
    world.cameraShake = 40;
    world.shockwaves.push({ x: c4State.plantX, y: c4State.plantY, radius: 20, maxRadius: 750, alpha: 1.0 });

    const allEntities = [world.player, ...world.bots].filter(Boolean);
    allEntities.forEach(ent => {
        if (!ent.isDead) {
            const d = Math.hypot(ent.x - c4State.plantX, ent.y - c4State.plantY);
            if (d < 650) {
                const dmg = (1 - d / 650) * 350;
                ent.takeDamage(dmg, null, false, "C4 EXPLOSION");
            }
        }
    });

    endRound("T", "C4 BOMB DETONATED", true);
}

/* ==========================================================================
   PLAYER & BOT ECONOMY PURCHASES
   ========================================================================== */
export function buyItem(item) {
    const player = world.player;
    if (!player || player.money < item.price) return;

    if (item.type === "weapon") {
        if (player.primaryKey === item.key || player.secondaryKey === item.key) return;
    } else if (item.type === "grenade") {
        const meta = GRENADE_META[item.key];
        if (!meta || player[meta.flag]) return;
    } else if (item.type === "armor_vest" && player.armor >= 100) return;
    else if (item.type === "armor" && player.armor >= 100 && player.hasHelmet) return;
    else if (item.type === "kit" && player.hasDefuseKit) return;

    player.money -= item.price;
    audio.playBuySound();

    if (item.type === "weapon") {
        const wep = WEAPONS[item.key];
        if (wep.slot === 2) {
            player.secondaryKey = item.key;
            player.selectSlot(2);
        } else if (wep.slot === 1) {
            player.primaryKey = item.key;
            player.selectSlot(1);
        }
        player.clips[item.key] = wep.clip;
        if (player.reserves && wep.maxReserve !== undefined) {
            player.reserves[item.key] = wep.maxReserve;
        }
    } else if (item.type === "grenade") {
        const meta = GRENADE_META[item.key];
        if (meta) {
            player[meta.flag] = true;
            player.selectSlot(meta.slot);
        }
    } else if (item.type === "armor_vest") {
        player.armor = 100;
    } else if (item.type === "armor") {
        player.armor = 100;
        player.hasHelmet = true;
    } else if (item.type === "kit") {
        player.hasDefuseKit = true;
    }

    window.dispatchEvent(new CustomEvent('cs:buyUpdated'));
}

export function quickBuyFull() {
    const player = world.player;
    if (!player) return;
    const rifleKey = player.team === "T" ? "AK47" : "M4A1";
    const rifleCost = player.team === "T" ? 2700 : 3100;

    if (player.primaryKey !== rifleKey && player.money >= rifleCost) {
        buyItem({ key: rifleKey, price: rifleCost, type: "weapon" });
    }
    if ((!player.hasHelmet || player.armor < 100) && player.money >= 1000) {
        buyItem({ key: "ARMOR", price: 1000, type: "armor" });
    }
    if (!player.hasHE && player.money >= 300) buyItem({ key: "HEGRENADE", price: 300, type: "grenade" });
    if (!player.hasSmoke && player.money >= 300) buyItem({ key: "SMOKE", price: 300, type: "grenade" });
    if (player.team === "CT" && !player.hasDefuseKit && player.money >= 400) {
        buyItem({ key: "KIT", price: 400, type: "kit" });
    }
}

export function quickBuyEco() {
    const player = world.player;
    if (!player) return;
    if (player.secondaryKey !== "DEAGLE" && player.money >= 650) {
        buyItem({ key: "DEAGLE", price: 650, type: "weapon" });
    }
    if ((!player.hasHelmet || player.armor < 100) && player.money >= 1000) {
        buyItem({ key: "ARMOR", price: 1000, type: "armor" });
    }
}

export function triggerBotShopping() {
    const teams = ["CT", "T"];
    teams.forEach(teamName => {
        const teamBots = world.bots.filter(b => b.team === teamName && !b.isDead);
        if (teamBots.length === 0) return;

        teamBots.forEach(bot => {
            const isSupport = bot.archetype === "SUPPORT";
            const isAwper = bot.archetype === "AWPER";
            const rifleKey = bot.team === "T" ? "AK47" : "M4A1";
            const rifleCost = bot.team === "T" ? 2700 : 3100;

            const buyUtility = () => {
                if (!bot.hasFlash && bot.money >= 200) { bot.hasFlash = true; bot.money -= 200; }
                if (!bot.hasHE && bot.money >= 300) { bot.hasHE = true; bot.money -= 300; }
                if (!bot.hasMolotov && bot.money >= 400) { bot.hasMolotov = true; bot.money -= 400; }
                if (!bot.hasSmoke && bot.money >= 300) { bot.hasSmoke = true; bot.money -= 300; }
            };

            const buyArmorAndKit = () => {
                if (bot.money >= 1000 && (!bot.hasHelmet || bot.armor < 100)) {
                    bot.armor = 100;
                    bot.hasHelmet = true;
                    bot.money -= 1000;
                } else if (bot.money >= 650 && bot.armor < 100) {
                    bot.armor = 100;
                    bot.money -= 650;
                }

                if (bot.team === "CT" && bot.money >= 400 && !bot.hasDefuseKit) {
                    bot.hasDefuseKit = true;
                    bot.money -= 400;
                }
            };

            const buySecondaryPistol = () => {
                if (bot.secondaryKey !== "DEAGLE" && bot.money >= 650) {
                    bot.secondaryKey = "DEAGLE";
                    bot.money -= 650;
                } else if (bot.secondaryKey !== "DEAGLE" && bot.secondaryKey !== "DUALIES" && bot.money >= 400) {
                    bot.secondaryKey = "DUALIES";
                    bot.money -= 400;
                }
            };

            const buyPrimaryGun = () => {
                if (bot.primaryKey !== rifleKey && bot.money >= rifleCost) {
                    bot.primaryKey = rifleKey;
                    bot.money -= rifleCost;
                } else if ((!bot.primaryKey || bot.primaryKey === "MP5") && bot.money >= 2100) {
                    bot.primaryKey = "VECTOR";
                    bot.money -= 2100;
                } else if (!bot.primaryKey && bot.money >= 1500) {
                    bot.primaryKey = "MP5";
                    bot.money -= 1500;
                }
            };

            if (isSupport) {
                buyUtility();
                buyArmorAndKit();
                buyPrimaryGun();
                buySecondaryPistol();
            } else if (isAwper) {
                if (bot.primaryKey !== "AWP" && bot.money >= 4750) {
                    bot.primaryKey = "AWP";
                    bot.money -= 4750;
                }

                buyArmorAndKit();
                buySecondaryPistol();
                buyUtility();
            } else {
                buyPrimaryGun();
                buySecondaryPistol();
                buyArmorAndKit();
                buyUtility();
            }

            if (bot.primaryKey && WEAPONS[bot.primaryKey]) {
                bot.clips[bot.primaryKey] = WEAPONS[bot.primaryKey].clip;
                if (bot.reserves) bot.reserves[bot.primaryKey] = WEAPONS[bot.primaryKey].maxReserve;
            }
            if (bot.secondaryKey && WEAPONS[bot.secondaryKey]) {
                bot.clips[bot.secondaryKey] = WEAPONS[bot.secondaryKey].clip;
                if (bot.reserves) bot.reserves[bot.secondaryKey] = WEAPONS[bot.secondaryKey].maxReserve;
            }

            bot.selectSlot(bot.primaryKey ? 1 : 2);
        });
    });
}