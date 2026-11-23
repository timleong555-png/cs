/* ==========================================================================
   C4 DEFUSE / FAKE-BAIT TACTICS, UTILITY COORDINATION & GUNPLAY / AWP EXECUTORS
   ========================================================================== */
import {
    world,
    matchState,
    c4State,
    pincerState,
    ctPincerState,
    FIXED_VISION_RANGE,
    TORSO_RADIUS,
    HEAD_RADIUS,
    HEAD_OFFSET,
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
    T_STRATEGIES,
    CT_STRATEGIES,
    STRATEGIC_POWER_POSITIONS,
    isNearSpawn,
    isStrictlyInsideSite,
    isInsideExpandedSite,
    getClosestRouteIndex
} from '../js-map-physics/dedust2map.js';
import {
    checkWallCollision,
    getMapLineOfSight,
    getLineOfSight,
    getRayObstacleEndpoint,
    hasBodyClearance,
    isInsideSmoke,
    isPointInFire,
    canBotSafelyTraverseFire
} from '../js-map-physics/map-physics.js';
import {
    worldToNavCell,
    navCellToWorld,
    findGridPath,
    brakeBot,
    moveBotWithSliding,
    steerBotToDestination
} from '../js-map-physics/Map-Finding.js';
import { WEAPONS, SPRAY_PATTERNS } from '../combat-match/Weapon-behavior.js';
import { performAttack, startReload } from '../combat-match/Combat.js';
import {
    getRelevantSuspiciousSpot,
    getSensoryDistraction,
    getTacticalBlackboardThreat,
    isSectorRecentlyCleared,
    recordClearedSector,
    getDeducedAWPTarget,
    evaluateAWPNestPinchability,
    evaluateSoloClutchSiteChoice
} from './Bot-Sensor.js';
import { predictUtilityLandingSpot } from '../display Huv/Game-render.js';

const T_ROTATION_COOLDOWN = 8.5;

const SITE_CLEAR_POCKETS = {
    A: [
        { x: 2050, y: 135 },
        { x: 2220, y: 175 },
        { x: 2220, y: 340 },
        { x: 2038, y: 542 },
        { x: 1890, y: 180 }
    ],
    B: [
        { x: 2486, y: 1895 },
        { x: 2464, y: 1680 },
        { x: 2165, y: 1530 },
        { x: 2000, y: 1715 },
        { x: 2310, y: 1435 }
    ]
};

const SITE_RETAKE_PORTALS = {
    A: [
        {
            name: "A_SHORT_CATWALK",
            doorGroup: "A_SHORT",
            entryPos: { x: 2038, y: 465 },
            preferredStagePos: { x: 1835, y: 542 },
            watchPos: { x: 2050, y: 220 },
            cutoffSmoke: { x: 1890, y: 180 }
        },
        {
            name: "A_CT_RAMP",
            doorGroup: "A_CT_RAMP",
            entryPos: { x: 2225, y: 465 },
            preferredStagePos: { x: 2225, y: 695 },
            watchPos: { x: 2050, y: 180 },
            cutoffSmoke: { x: 2038, y: 465 }
        },
        {
            name: "A_LONG_RAMP",
            doorGroup: "A_LONG",
            entryPos: { x: 1860, y: 180 },
            preferredStagePos: { x: 1620, y: 180 },
            watchPos: { x: 2050, y: 220 },
            cutoffSmoke: { x: 2225, y: 420 }
        }
    ],
    B: [
        { name: "B_DOORS_WEST", doorGroup: "B_DOORS", entryPos: { x: 2245, y: 1435 }, watchPos: { x: 2280, y: 1760 }, cutoffSmoke: { x: 2245, y: 1435 } },
        { name: "B_DOORS_EAST", doorGroup: "B_DOORS", entryPos: { x: 2375, y: 1435 }, watchPos: { x: 2340, y: 1760 }, cutoffSmoke: { x: 2375, y: 1435 } },
        { name: "B_MAZE_TOP_FLANK", doorGroup: "MAZE_TOP", entryPos: { x: 2040, y: 1561 }, watchPos: { x: 2280, y: 1650 }, cutoffSmoke: { x: 1915, y: 1561 } },
        { name: "B_MAZE_MID_FLANK", doorGroup: "MAZE_MID", entryPos: { x: 2050, y: 1712 }, watchPos: { x: 2280, y: 1780 }, cutoffSmoke: { x: 1955, y: 1712 } },
        { name: "B_MAZE_BOT_FLANK", doorGroup: "MAZE_BOT", entryPos: { x: 2050, y: 1877 }, watchPos: { x: 2280, y: 1820 }, cutoffSmoke: { x: 1955, y: 1877 } }
    ]
};

const T_BREACH_CHOKES = [
    { x: 910, y: 200 },
    { x: 1280, y: 445 },
    { x: 1320, y: 1080 },
    { x: 1350, y: 545 },
    { x: 1715, y: 542 },
    { x: 1733, y: 1420 },
    { x: 2040, y: 1561 },
    { x: 2050, y: 1712 },
    { x: 2050, y: 1877 },
    { x: 2225, y: 340 },
    { x: 2310, y: 1435 }
];

const T_SITE_DEFENDER_POCKETS = {
    A: [
        { x: 2220, y: 175 },
        { x: 2048, y: 215 },
        { x: 1890, y: 180 }
    ],
    B: [
        { x: 2486, y: 1895 },
        { x: 2464, y: 1680 },
        { x: 2165, y: 1715 }
    ]
};

const T_EXECUTE_MOLOTOV_POCKETS = {
    A: [
        { x: 2220, y: 175 },
        { x: 2048, y: 215 },
        { x: 1890, y: 180 }
    ],
    B: [
        { x: 2486, y: 1895 },
        { x: 2464, y: 1680 },
        { x: 2165, y: 1820 }
    ]
};

const T_AWP_OVERWATCH_ANCHORS = {
    prePlant: {
        A: { targetPos: { x: 1410, y: 180 }, focusPos: { x: 1890, y: 180 } },
        B: { targetPos: { x: 1912, y: 1520 }, focusPos: { x: 2165, y: 1530 } }
    },
    postPlant: {
        A: { targetPos: { x: 1890, y: 180 }, focusPos: { x: 1500, y: 150 } },
        B: { targetPos: { x: 2280, y: 1525 }, focusPos: { x: 2310, y: 1320 } }
    }
};

const CT_AWP_OVERWATCH_IDS = {
    prePlant: {
        A: ["A_SHORT_DOOR_HOLD", "A_EAST_CUBBY_HOLD"],
        B: ["B_DOORS_HOLD"],
        MID: ["MID_DOORS_CT_SIDE"]
    },
    postPlant: {
        A: ["A_SHORT_DOOR_HOLD", "A_EAST_CUBBY_HOLD", "MID_DOORS_CT_SIDE"],
        B: ["B_DOORS_HOLD", "MID_DOORS_CT_SIDE"]
    }
};

/* ==========================================================================
   TEAM ROTATION, SITE CONTROL & TETHER HELPERS
   ========================================================================== */
export function commitCTSiteRotation(bot, siteKey, duration = 12.0) {
    if (!bot || bot.team !== "CT" || (siteKey !== "A" && siteKey !== "B")) return;
    if (c4State.isPlanted) return;

    const stratKey = siteKey === "B" ? "PATROL_B" : "PATROL_A";
    const nextStrat = CT_STRATEGIES[stratKey];
    if (!nextStrat) return;

    const alreadyCommitted = bot.committedRotateSite === siteKey &&
        world.gameTime < (bot.committedRotateUntil || 0);

    bot.committedRotateSite = siteKey;
    bot.committedRotateUntil = Math.max(bot.committedRotateUntil || 0, world.gameTime + duration);

    if (!alreadyCommitted && bot.assignedCTStrat?.site !== siteKey) {
        bot.assignedCTStrat = nextStrat;
        bot.role = nextStrat.name;
        bot.planIndex = nextStrat.route.length;
        bot.isFollowingPlanRoute = false;
        bot.hasReachedAssignedSite = false;
        bot.areaControlState = null;
        bot.dynamicDefensePos = null;
        bot.isHoldingCrossfire = false;
    }
}

export function isTSquadOccupyingSite(siteKey = null) {
    const aliveTs = world.livingT.filter(t => t && !t.isDead);
    if (aliveTs.length === 0) return false;

    const checkSite = (key) => {
        const siteRect = key === "B" ? MAP.siteB : MAP.siteA;
        if (!siteRect) return false;

        const tsInSite = aliveTs.filter(t =>
            isInsideExpandedSite(t.x, t.y, siteRect) ||
            Math.hypot(siteRect.safeSpot.x - t.x, siteRect.safeSpot.y - t.y) < 230
        ).length;

        const ctsContesting = world.livingCT.filter(c =>
            c && !c.isDead && isInsideExpandedSite(c.x, c.y, siteRect)
        ).length;

        return tsInSite >= 1 && tsInSite >= ctsContesting;
    };

    if (siteKey) return checkSite(siteKey);
    return checkSite("A") || checkSite("B");
}

export function isTReadyToPlantAtSite(siteKey = null) {
    if (c4State.isPlanted || c4State.isDropped || !c4State.carrier || c4State.carrier.isDead) {
        return false;
    }
    const carrier = c4State.carrier;
    const targetKey = siteKey || carrier.assignedSite ||
        (T_STRATEGIES[world.currentTStrategyKey]?.targetSite) || "A";
    const siteRect = targetKey === "B" ? MAP.siteB : MAP.siteA;
    if (!siteRect) return false;

    // Carrier must actually be inside or entering the bombsite before locking teammates into plant-escort holds
    const carrierAtSite = isInsideExpandedSite(carrier.x, carrier.y, siteRect) ||
        Math.hypot(siteRect.safeSpot.x - carrier.x, siteRect.safeSpot.y - carrier.y) <= 260;
    if (!carrierAtSite) return false;

    const aliveTs = world.livingT.filter(t => t && !t.isDead);
    const tsStrictlyInside = aliveTs.filter(t => isStrictlyInsideSite(t.x, t.y, siteRect)).length;
    const ctsInSite = world.livingCT.filter(c =>
        c && !c.isDead && isInsideExpandedSite(c.x, c.y, siteRect)
    ).length;

    // Site is occupied only when at least one T is strictly inside the site box and CTs do not contest it
    return tsStrictlyInside >= 1 && ctsInSite === 0;
}

export function isTFastExecuteActive(siteKey = null) {
    if (c4State.isPlanted || matchState.roundPhase !== "COMBAT") return false;
    if (world.livingT.length === 1) return true;

    const activeStrat = T_STRATEGIES[world.currentTStrategyKey];
    const targetKey = siteKey || activeStrat?.targetSite || "A";
    const siteRect = targetKey === "B" ? MAP.siteB : MAP.siteA;
    if (!siteRect) return false;

    // 1. Site is already occupied or ready to plant
    if (isTSquadOccupyingSite(targetKey) || isTReadyToPlantAtSite(targetKey)) {
        return true;
    }

    // 2. Post-entry-kill flood: once any CT falls, flood the site immediately before CT rotators arrive
    const allCTs = [world.player, ...world.bots].filter(e => e && e.team === "CT");
    const hasEntryPick = allCTs.some(c => c.isDead);
    if (hasEntryPick) {
        return true;
    }

    // 3. Late-round clock commit (< 26s left): commit together so the carrier has time to plant
    if (matchState.roundTimer <= 26.0) {
        return true;
    }

    // 4. Confirmed CT over-rotation away from our target site after opening bait phase
    const roundElapsed = 115 - matchState.roundTimer;
    if (roundElapsed >= 10.0) {
        const oppSite = targetKey === "A" ? "B" : "A";
        const ctOnTarget = countDistinctCTPresence(targetKey);
        const ctOnOpposite = countDistinctCTPresence(oppSite);
        if (ctOnTarget <= 1 && ctOnOpposite >= 2) {
            return true;
        }
    }

    return false;
}

export function isBeyondOverchaseTether(bot, targetPos) {
    if (!bot || !targetPos) return false;
    const teammates = bot.team === "CT" ? world.livingCT : world.livingT;
    if (teammates.length <= 1) return false;

    let anchorX = bot.x;
    let anchorY = bot.y;

    if (c4State.isPlanted) {
        anchorX = c4State.plantX;
        anchorY = c4State.plantY;
    } else if (bot.team === "T") {
        if (c4State.isDropped) {
            anchorX = c4State.dropX;
            anchorY = c4State.dropY;
        } else if (c4State.carrier && !c4State.carrier.isDead && c4State.carrier !== bot) {
            anchorX = c4State.carrier.x;
            anchorY = c4State.carrier.y;
        } else {
            const siteRect = bot.assignedSite === "B" ? MAP.siteB : MAP.siteA;
            anchorX = siteRect.safeSpot.x;
            anchorY = siteRect.safeSpot.y;
        }
    } else if (bot.team === "CT" && bot.assignedDefenseSpot) {
        anchorX = bot.assignedDefenseSpot.x;
        anchorY = bot.assignedDefenseSpot.y;
    }

    const botToAnchor = Math.hypot(bot.x - anchorX, bot.y - anchorY);
    const targetToAnchor = Math.hypot(targetPos.x - anchorX, targetPos.y - anchorY);
    const isTPostPlant = c4State.isPlanted && bot.team === "T";
    const maxAnchorRadius = isTPostPlant ? 820 : 340;
    const maxChaseMargin = isTPostPlant ? 360 : 280;
    return targetToAnchor > botToAnchor + maxChaseMargin && targetToAnchor > maxAnchorRadius;
}

/* ==========================================================================
   SQUAD TACTICAL COORDINATOR & ROLE ASSIGNERS
   ========================================================================== */
function hasUsableAWP(bot) {
    if (!bot || bot.primaryKey !== "AWP") return false;
    const clip = bot.clips ? (bot.clips["AWP"] || 0) : 0;
    const reserve = bot.reserves ? (bot.reserves["AWP"] || 0) : 0;
    return (clip + reserve) > 0;
}

function getAWPOverwatchAnchor(bot) {
    const team = bot.team;
    const targetSite = c4State.isPlanted
        ? (c4State.plantSite || "A")
        : (team === "T" ? (bot.assignedSite || "A") : (bot.assignedCTStrat?.site || "A"));

    let rawAnchor = null;
    if (team === "CT") {
        const phaseTable = c4State.isPlanted ? CT_AWP_OVERWATCH_IDS.postPlant : CT_AWP_OVERWATCH_IDS.prePlant;
        const preferredIds = phaseTable[targetSite] || phaseTable.A;

        for (let i = 0; i < preferredIds.length; i++) {
            const pos = STRATEGIC_POWER_POSITIONS.find(p => p.id === preferredIds[i]);
            if (pos) {
                rawAnchor = {
                    targetPos: { x: pos.anchorX, y: pos.anchorY },
                    focusPos: { x: pos.doorSeamX, y: pos.doorSeamY }
                };
                break;
            }
        }
    } else {
        const phaseTable = c4State.isPlanted ? T_AWP_OVERWATCH_ANCHORS.postPlant : T_AWP_OVERWATCH_ANCHORS.prePlant;
        const template = targetSite === "B" ? phaseTable.B : phaseTable.A;
        rawAnchor = {
            targetPos: { ...template.targetPos },
            focusPos: { ...template.focusPos }
        };
    }

    if (!rawAnchor) return null;

    const aimAng = Math.atan2(rawAnchor.focusPos.y - rawAnchor.targetPos.y, rawAnchor.focusPos.x - rawAnchor.targetPos.x);
    const hitPt = getRayObstacleEndpoint(rawAnchor.targetPos.x, rawAnchor.targetPos.y, aimAng, 200);
    if (Math.hypot(hitPt.x - rawAnchor.targetPos.x, hitPt.y - rawAnchor.targetPos.y) < 135) {
        const adjusted = findMultiAngleSupportPosition(bot, rawAnchor.focusPos.x, rawAnchor.focusPos.y, bot);
        if (adjusted) rawAnchor.targetPos = adjusted;
    }

    return rawAnchor;
}

function createOrderScheduler(aliveBots, aliveCount, teamOrders) {
    const claimedIds = new Set();

    aliveBots.forEach(bot => {
        const ord = bot.tacticalOrder;
        if (ord &&
            world.gameTime < ord.expiresAt &&
            ord.assignedByCount === aliveCount &&
            ord.isPlantedSnapshot === c4State.isPlanted) {
            claimedIds.add(bot.id);
        } else {
            bot.tacticalOrder = null;
            delete teamOrders[bot.id];
        }
    });

    return {
        setOrder(bot, orderData) {
            if (!bot || !bot.isBot || claimedIds.has(bot.id)) return false;
            const fullOrder = {
                ...orderData,
                assignedByCount: aliveCount,
                isPlantedSnapshot: c4State.isPlanted
            };
            bot.tacticalOrder = fullOrder;
            teamOrders[bot.id] = fullOrder;
            claimedIds.add(bot.id);
            return true;
        },
        getUnclaimed() {
            return aliveBots.filter(b => !claimedIds.has(b.id));
        }
    };
}

function assignObjectiveOrders(team, scheduler) {
    if (team === "T" && !c4State.isPlanted) {
        if (c4State.isDropped) {
            updateDesignatedRetriever();
            // Do not lock out suspicion/anti-AWP orders so T bots can suppress/pinch threats around the dropped C4 first
            return false;
        }

        if (c4State.carrier && c4State.carrier.isBot && !c4State.carrier.isDead) {
            const siteRect = c4State.carrier.assignedSite === "B" ? MAP.siteB : MAP.siteA;
            scheduler.setOrder(c4State.carrier, {
                role: "OBJECTIVE_PLANT",
                targetPos: { x: siteRect.safeSpot.x, y: siteRect.safeSpot.y },
                focusPos: null,
                avoidLongDuels: true,
                expiresAt: world.gameTime + 1.2
            });
        }

        const carrierIsActivelyPlanting = Boolean(c4State.planter && !c4State.planter.isDead);
        const botCarrierReadyToPlant = Boolean(c4State.carrier && c4State.carrier.isBot && isTReadyToPlantAtSite());
        if (carrierIsActivelyPlanting || botCarrierReadyToPlant) {
            const activeSiteKey = carrierIsActivelyPlanting
                ? (isStrictlyInsideSite(c4State.planter.x, c4State.planter.y, MAP.siteB) ? "B" : "A")
                : (c4State.carrier.assignedSite || "A");
            const activeSiteRect = activeSiteKey === "B" ? MAP.siteB : MAP.siteA;

            scheduler.getUnclaimed().forEach(escort => {
                scheduler.setOrder(escort, {
                    role: "SITE_PLANT_ESCORT",
                    targetPos: { x: activeSiteRect.safeSpot.x, y: activeSiteRect.safeSpot.y },
                    focusPos: null,
                    expiresAt: world.gameTime + 1.2
                });
            });
            return true;
        }
    } else if (team === "CT" && c4State.isPlanted && c4State.designatedDefuser &&
        c4State.designatedDefuser.isBot && !c4State.designatedDefuser.isDead) {
        scheduler.setOrder(c4State.designatedDefuser, {
            role: "OBJECTIVE_DEFUSE",
            targetPos: { x: c4State.plantX, y: c4State.plantY },
            focusPos: { x: c4State.plantX, y: c4State.plantY },
            avoidLongDuels: false,
            expiresAt: world.gameTime + 1.2
        });
    }

    return false;
}

function assignAWPOrders(team, scheduler) {
    if (team === "T" && !c4State.isPlanted) return;
    scheduler.getUnclaimed().forEach(bot => {
        if (!hasUsableAWP(bot)) return;
        const bbThreat = getTacticalBlackboardThreat(bot);
        const awpThreat = getDeducedAWPTarget(team, bot.x, bot.y, 780);
        if (team === "CT" && !c4State.isPlanted && !bbThreat && !awpThreat) return;

        const ow = getAWPOverwatchAnchor(bot);
        const focus = awpThreat
            ? { x: awpThreat.x, y: awpThreat.y }
            : (bbThreat ? { x: bbThreat.x, y: bbThreat.y } : (ow ? ow.focusPos : null));

        scheduler.setOrder(bot, {
            role: "AWP_OVERWATCH",
            targetPos: ow ? ow.targetPos : { x: bot.x, y: bot.y },
            focusPos: focus,
            expiresAt: world.gameTime + 2.4
        });
    });
}

function assignAntiAWPPinchOrders(team, aliveBots, scheduler) {
    const refBot = scheduler.getUnclaimed()[0] || aliveBots[0];
    const deducedAWP = refBot ? getDeducedAWPTarget(team, refBot.x, refBot.y, 780) : null;
    if (!deducedAWP) return;

    const postPlantTooFar = c4State.isPlanted && team === "T" &&
        Math.hypot(deducedAWP.x - c4State.plantX, deducedAWP.y - c4State.plantY) > 820;
    if (postPlantTooFar) return;

    const pinchCandidates = scheduler.getUnclaimed()
        .filter(b => {
            if (b.team === "T" && b.x < 760 && b.y > 460) return false;
            return Math.hypot(deducedAWP.x - b.x, deducedAWP.y - b.y) <= 780;
        })
        .sort((a, b) => Math.hypot(deducedAWP.x - a.x, deducedAWP.y - a.y) - Math.hypot(deducedAWP.x - b.x, deducedAWP.y - b.y));

    if (pinchCandidates.length === 0) return;

    const pinchEval = evaluateAWPNestPinchability(deducedAWP.x, deducedAWP.y);
    const nonCarrierCandidates = pinchCandidates.filter(b => !(b.team === "T" && b.hasC4 && !c4State.isPlanted));
    const utilLead = nonCarrierCandidates.find(b => b.hasSmoke || b.hasFlash || b.hasMolotov || b.hasHE) || nonCarrierCandidates[0];
    if (!utilLead) return;

    // If the AWPer is tucked in a tight single-lane choke (like A Short), DO NOT dry-chase single-file or freeze in place:
    // throw a quick blocking smoke/flash only if a valid trajectory exists, then keep rotating/advancing
    if (team === "T" && !pinchEval.isOpenMultiAngle) {
        const canThrowNow = (utilLead.hasSmoke || utilLead.hasFlash) &&
            (world.gameTime - (utilLead.lastAntiAWPUtilTime || -99)) >= 6.0 &&
            (Boolean(utilLead.hasSmoke && solveBotUtilityThrow(utilLead, "SMOKE", deducedAWP.x, deducedAWP.y, 135)) ||
             Boolean(utilLead.hasFlash && solveBotUtilityThrow(utilLead, "FLASH", deducedAWP.x, deducedAWP.y, 135)));

        if (canThrowNow) {
            scheduler.setOrder(utilLead, {
                role: "CONTAIN_UTILITY",
                targetPos: null,
                focusPos: { x: deducedAWP.x, y: deducedAWP.y },
                suppressFire: false,
                isAntiAWP: true,
                avoidDryChase: true,
                expiresAt: world.gameTime + 1.1
            });
        }
        return;
    }

    // Open area with multiple attack angles: lead with utility (smoke/flash/molotov) and pinch from 2+ angles
    const leadAngle = Math.atan2(utilLead.y - deducedAWP.y, utilLead.x - deducedAWP.x);
    const leadAdvancePos = findMultiAngleSupportPosition(utilLead, deducedAWP.x, deducedAWP.y, utilLead, 0);
    if (team === "T" && !c4State.isPlanted &&
        (!leadAdvancePos || Math.hypot(leadAdvancePos.x - deducedAWP.x, leadAdvancePos.y - deducedAWP.y) < 90)) {
        return;
    }

    scheduler.setOrder(utilLead, {
        role: "CONTAIN_UTILITY",
        targetPos: leadAdvancePos,
        focusPos: { x: deducedAWP.x, y: deducedAWP.y },
        suppressFire: true,
        isAntiAWP: true,
        expiresAt: world.gameTime + 2.5
    });

    const flankers = scheduler.getUnclaimed()
        .filter(b => Math.hypot(deducedAWP.x - b.x, deducedAWP.y - b.y) <= 780)
        .slice(0, 2);

    flankers.forEach((flanker, idx) => {
        const flankSide = idx === 0 ? 1 : -1;
        const flankAngle = leadAngle + flankSide * (78 * Math.PI / 180);
        const rawFlankX = deducedAWP.x + Math.cos(flankAngle) * 235;
        const rawFlankY = deducedAWP.y + Math.sin(flankAngle) * 235;
        const snappedFlank = navCellToWorld(worldToNavCell(
            Math.max(80, Math.min(MAP.width - 80, rawFlankX)),
            Math.max(80, Math.min(MAP.height - 80, rawFlankY))
        ));
        const pinchPos = (!checkWallCollision(snappedFlank.x, snappedFlank.y, flanker.radius + 4) &&
            getMapLineOfSight(snappedFlank.x, snappedFlank.y, deducedAWP.x, deducedAWP.y))
            ? snappedFlank
            : findMultiAngleSupportPosition(flanker, deducedAWP.x, deducedAWP.y, utilLead, flankSide);

        scheduler.setOrder(flanker, {
            role: "FLANK_PINCH",
            targetPos: pinchPos,
            focusPos: { x: deducedAWP.x, y: deducedAWP.y },
            isAntiAWP: true,
            expiresAt: world.gameTime + 2.8
        });
    });
}

function assignSuspicionOrders(team, scheduler) {
    const roundElapsed = 115 - matchState.roundTimer;
    const minEscalationTime = team === "T" ? 3.5 : 8.5;

    const hotzones = (world.tacticalIntel.killerHotzones[team] || []).filter(h =>
        (!h.clearedThisRound && !isSectorRecentlyCleared(team, h.x, h.y, 120)) ||
        world.gameTime < (h.confirmedUntil || 0)
    );
    const traces = (world.tacticalIntel.ballisticTraces[team] || []).filter(t =>
        world.gameTime < t.expiresAt && !isSectorRecentlyCleared(team, t.x, t.y, 120)
    );

    let topThreat = null;
    let topTier = 0;

    for (let i = 0; i < hotzones.length; i++) {
        const hz = hotzones[i];
        const isConfirmed = world.gameTime < (hz.confirmedUntil || 0) || (hz.kills || 0) >= 2;
        const effKills = isConfirmed ? Math.max(hz.kills || 0, 4) : (hz.kills || 1);
        const tier = effKills >= 4 ? 3 : (effKills >= 2 ? 2 : 1);
        if (tier > topTier) {
            topTier = tier;
            topThreat = { x: hz.x, y: hz.y, tier, isConfirmed, weaponCategory: hz.weaponCategory || "rifle" };
        }
    }
    for (let i = 0; i < traces.length; i++) {
        const tr = traces[i];
        const tier = (tr.hits >= 3 || tr.weaponCategory === "sniper") ? 2 : 1;
        if (tier > topTier) {
            topTier = tier;
            topThreat = { x: tr.x, y: tr.y, tier, isConfirmed: false, weaponCategory: tr.weaponCategory || "rifle" };
        }
    }

    const freeRiflers = scheduler.getUnclaimed().filter(b => !(b.team === "T" && b.x < 760 && b.y > 460));
    if (!topThreat || (!topThreat.isConfirmed && roundElapsed < minEscalationTime) || freeRiflers.length === 0) {
        return;
    }

    freeRiflers.sort((a, b) => Math.hypot(topThreat.x - a.x, topThreat.y - a.y) - Math.hypot(topThreat.x - b.x, topThreat.y - b.y));
    const closestDist = Math.hypot(topThreat.x - freeRiflers[0].x, topThreat.y - freeRiflers[0].y);
    const maxEscalationDist = topThreat.isConfirmed ? 780 : 480;
    if (closestDist > maxEscalationDist) return;

    if (topTier === 3) {
        const targetSiteRect = (team === "T" && freeRiflers[0].assignedSite === "B") ? MAP.siteB : MAP.siteA;
        const offSiteThreat = !isStrictlyInsideSite(topThreat.x, topThreat.y, targetSiteRect);
        const utilityBot = freeRiflers.find(b => b.hasSmoke || b.hasMolotov);

        if (team === "T" && !c4State.isPlanted && offSiteThreat && utilityBot && freeRiflers.length >= 2) {
            scheduler.setOrder(utilityBot, {
                role: "CONTAIN_UTILITY",
                targetPos: { x: utilityBot.x, y: utilityBot.y },
                focusPos: { x: topThreat.x, y: topThreat.y },
                suppressFire: true,
                expiresAt: world.gameTime + 2.5
            });
            scheduler.getUnclaimed().forEach(runner => {
                scheduler.setOrder(runner, {
                    role: "BREACH_ENTRY",
                    targetPos: { x: targetSiteRect.safeSpot.x, y: targetSiteRect.safeSpot.y },
                    focusPos: { x: topThreat.x, y: topThreat.y },
                    expiresAt: world.gameTime + 2.4
                });
            });
        } else {
            const suppressor = freeRiflers[0];
            scheduler.setOrder(suppressor, {
                role: "SUPPRESS_COVER",
                targetPos: { x: suppressor.x, y: suppressor.y },
                focusPos: { x: topThreat.x, y: topThreat.y },
                suppressFire: true,
                expiresAt: world.gameTime + 2.4
            });

            if (team === "CT" || c4State.isPlanted) {
                scheduler.getUnclaimed().slice(0, 2).forEach(flanker => {
                    const pinchPos = findMultiAngleSupportPosition(flanker, topThreat.x, topThreat.y, suppressor);
                    scheduler.setOrder(flanker, {
                        role: "FLANK_PINCH",
                        targetPos: pinchPos,
                        focusPos: { x: topThreat.x, y: topThreat.y },
                        expiresAt: world.gameTime + 2.6
                    });
                });
            }
        }
    } else if (topTier === 2) {
        const suppressor = freeRiflers[0];
        scheduler.setOrder(suppressor, {
            role: "SUPPRESS_COVER",
            targetPos: { x: suppressor.x, y: suppressor.y },
            focusPos: { x: topThreat.x, y: topThreat.y },
            suppressFire: true,
            useReachAwareUtility: true,
            expiresAt: world.gameTime + 2.2
        });
    } else if (topTier === 1 && closestDist <= (team === "T" ? 480 : 420) && roundElapsed >= minEscalationTime) {
        const prober = freeRiflers[0];
        scheduler.setOrder(prober, {
            role: "PROBE_PREFIRE",
            targetPos: { x: prober.x, y: prober.y },
            focusPos: { x: topThreat.x, y: topThreat.y },
            expiresAt: world.gameTime + 1.8
        });
    }
}

function assignPredictedCutoffOrders(team, scheduler) {
    if (team === "T" && !c4State.isPlanted) return;
    const predictedZones = world.tacticalIntel.predictedZones[team] || [];
    if (predictedZones.length === 0 || scheduler.getUnclaimed().length === 0) return;

    const pred = predictedZones[0];
    const candidates = scheduler.getUnclaimed()
        .filter(b => b.archetype === "SUPPORT" || b.archetype === "ANCHOR" || team === "CT")
        .sort((a, b) => Math.hypot(pred.x - a.x, pred.y - a.y) - Math.hypot(pred.x - b.x, pred.y - b.y));

    if (candidates.length > 0 && Math.hypot(pred.x - candidates[0].x, pred.y - candidates[0].y) < 750) {
        scheduler.setOrder(candidates[0], {
            role: "PREDICTED_CUTOFF",
            targetPos: { x: pred.x, y: pred.y },
            focusPos: { x: pred.originX, y: pred.originY },
            expiresAt: world.gameTime + 2.0
        });
    }
}

function assignDefaultExecuteOrders(team, aliveCount, scheduler) {
    if (team !== "T" || c4State.isPlanted) return;

    const fastExecute = isTFastExecuteActive();
    scheduler.getUnclaimed().forEach(bot => {
        const siteRect = bot.assignedSite === "B" ? MAP.siteB : MAP.siteA;
        const role = (!fastExecute && aliveCount >= 4 && bot.archetype === "SUPPORT")
            ? "SUPPRESS_COVER"
            : "BREACH_ENTRY";
        scheduler.setOrder(bot, {
            role,
            targetPos: { x: siteRect.safeSpot.x, y: siteRect.safeSpot.y },
            focusPos: null,
            expiresAt: world.gameTime + 1.4
        });
    });
}

export function assignSquadTacticalOrders() {
    if (!world.tacticalIntel) return;

    for (const team of ["CT", "T"]) {
        const aliveTeam = team === "CT" ? world.livingCT : world.livingT;
        const aliveBots = aliveTeam.filter(b => b && b.isBot && !b.isDead);
        const teamOrders = world.tacticalIntel.squadOrders[team] || {};

        // 1vX Clutch Mode: clear multi-bot roles so the last survivor plays self-reliantly
        if (aliveTeam.length <= 1) {
            aliveBots.forEach(b => {
                b.tacticalOrder = null;
                delete teamOrders[b.id];
            });
            world.tacticalIntel.squadOrders[team] = teamOrders;
            continue;
        }

        const scheduler = createOrderScheduler(aliveBots, aliveTeam.length, teamOrders);
        const objectiveLocked = assignObjectiveOrders(team, scheduler);

        if (!objectiveLocked) {
            assignAWPOrders(team, scheduler);
            assignAntiAWPPinchOrders(team, aliveBots, scheduler);
            assignSuspicionOrders(team, scheduler);
            assignPredictedCutoffOrders(team, scheduler);
            assignDefaultExecuteOrders(team, aliveTeam.length, scheduler);
        }

        world.tacticalIntel.squadOrders[team] = teamOrders;
    }
}

/* ==========================================================================
   C4 RETRIEVER, DEFUSER & CT RETAKE MACRO
   ========================================================================== */
export function updateDesignatedRetriever() {
    if (!c4State.isDropped) {
        c4State.c4Retriever = null;
        return;
    }

    const aliveTs = world.livingT.filter(t => t && !t.isDead);
    if (aliveTs.length === 0) {
        c4State.c4Retriever = null;
        return;
    }

    if (c4State.c4Retriever && (c4State.c4Retriever.isDead || c4State.c4Retriever.team !== "T")) {
        c4State.c4Retriever = null;
    }

    const playerRightOnBomb = world.player && !world.player.isDead && world.player.team === "T" &&
        Math.hypot(c4State.dropX - world.player.x, c4State.dropY - world.player.y) <= 130;
    const tBots = aliveTs.filter(t => t.isBot);
    const retrieverPool = (!playerRightOnBomb && tBots.length > 0) ? tBots : aliveTs;

    const sorted = retrieverPool.slice().sort(
        (a, b) => Math.hypot(c4State.dropX - a.x, c4State.dropY - a.y) - Math.hypot(c4State.dropX - b.x, c4State.dropY - b.y)
    );
    const closestT = sorted[0];

    if (!c4State.c4Retriever) {
        c4State.c4Retriever = closestT;
        return;
    }

    const curDist = Math.hypot(c4State.dropX - c4State.c4Retriever.x, c4State.dropY - c4State.c4Retriever.y);
    const bestDist = Math.hypot(c4State.dropX - closestT.x, c4State.dropY - closestT.y);
    if (closestT !== c4State.c4Retriever && bestDist + 140 < curDist) {
        c4State.c4Retriever = closestT;
    }
}

export function updateDesignatedDefuser() {
    if (!c4State.isPlanted) {
        c4State.designatedDefuser = null;
        c4State.isBeingDefused = false;
        return;
    }

    if (world.player && !world.player.isDead && world.player.team === "CT" &&
        c4State.designatedDefuser === world.player && c4State.isBeingDefused) {
        return;
    }

    const current = c4State.designatedDefuser;
    if (current && current.isBot && !current.isDead && current.team === "CT") {
        const isHoldingBait = current.fakeDefuseBaitUntil && world.gameTime < current.fakeDefuseBaitUntil;
        const isContinuingFakes = current.startedFakeSequence &&
            (current.fakeDefusesRemaining || 0) > 0 &&
            !current.targetEnemy &&
            Math.hypot(c4State.plantX - current.x, c4State.plantY - current.y) < 260;
        if (current.isDefusing || isHoldingBait || isContinuingFakes) {
            return;
        }
    }

    const ctBots = world.livingCT.filter(c => c && c.isBot && !c.isDead);
    if (ctBots.length === 0) {
        if (c4State.designatedDefuser !== world.player) {
            c4State.designatedDefuser = null;
        }
        return;
    }

    let bestBot = null;
    let bestScore = Infinity;

    for (const ct of ctBots) {
        const dist = Math.hypot(c4State.plantX - ct.x, c4State.plantY - ct.y);
        const kitBonus = ct.hasDefuseKit ? -380 : 0;
        const hpBonus = -(ct.health || 100) * 0.6;
        const score = dist + kitBonus + hpBonus;

        if (score < bestScore) {
            bestScore = score;
            bestBot = ct;
        }
    }

    c4State.designatedDefuser = bestBot;
}

export function getNextUnclearedSitePocket(siteKey) {
    const pockets = siteKey === "B" ? SITE_CLEAR_POCKETS.B : SITE_CLEAR_POCKETS.A;
    for (let i = 0; i < pockets.length; i++) {
        if (!isSectorRecentlyCleared("CT", pockets[i].x, pockets[i].y, 145)) {
            return pockets[i];
        }
    }
    return null;
}

function computePolylineDistance(points) {
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
        total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    }
    return total;
}

function computeRetakeStagingData(bot, portal, siteRect) {
    // If the portal defines a dedicated pre-breach cover anchor (e.g., Catwalk Mouth, Bottom of CT Ramp, or A Long),
    // compute the real A* path distance to that anchor so CTs never bunch up on the left wall of Room 1
    if (portal.preferredStagePos) {
        const anchor = navCellToWorld(worldToNavCell(portal.preferredStagePos.x, portal.preferredStagePos.y));
        const inFire = world.firePatches.some(f => f.life > 0.5 && isPointInFire(anchor.x, anchor.y, f, 24));
        if (!inFire && !checkWallCollision(anchor.x, anchor.y, bot.radius + 4)) {
            const pathToAnchor = findGridPath(bot.x, bot.y, anchor.x, anchor.y, bot);
            const distToAnchor = computePolylineDistance([{ x: bot.x, y: bot.y }, ...pathToAnchor, anchor]);
            const entryDist = Math.hypot(portal.entryPos.x - anchor.x, portal.entryPos.y - anchor.y);
            return {
                stagePos: anchor,
                pathDist: distToAnchor + entryDist
            };
        }
    }

    const path = findGridPath(bot.x, bot.y, portal.entryPos.x, portal.entryPos.y, bot);
    const waypoints = [{ x: bot.x, y: bot.y }, ...path, portal.entryPos];
    const fullPathDist = computePolylineDistance(waypoints);
    let lastSafeCover = null;
    let safePathDist = 0;
    let walkedDist = 0;

    // Walk along the bot's actual A* path around the walls and stop at the last safe cover point before site LOS opens
    for (let i = 0; i < waypoints.length - 1; i++) {
        const a = waypoints[i];
        const b = waypoints[i + 1];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(1, Math.ceil(segLen / 32));

        for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const px = a.x + (b.x - a.x) * t;
            const py = a.y + (b.y - a.y) * t;
            if (checkWallCollision(px, py, bot.radius + 4)) continue;

            const insideSite = isInsideExpandedSite(px, py, siteRect);
            const exposedToBomb = getMapLineOfSight(px, py, c4State.plantX, c4State.plantY);
            if (insideSite || exposedToBomb) {
                if (lastSafeCover) {
                    return { stagePos: lastSafeCover, pathDist: safePathDist };
                }
                break;
            }
            lastSafeCover = { x: px, y: py };
            safePathDist = walkedDist + segLen * t;
        }
        walkedDist += segLen;
    }

    if (lastSafeCover) {
        return { stagePos: lastSafeCover, pathDist: safePathDist };
    }

    // Fallback: step 85px back outside the portal away from the bomb
    const outAng = Math.atan2(portal.entryPos.y - c4State.plantY, portal.entryPos.x - c4State.plantX);
    const rawX = Math.max(80, Math.min(MAP.width - 80, portal.entryPos.x + Math.cos(outAng) * 85));
    const rawY = Math.max(80, Math.min(MAP.height - 80, portal.entryPos.y + Math.sin(outAng) * 85));
    const fallbackPos = navCellToWorld(worldToNavCell(rawX, rawY));
    return {
        stagePos: fallbackPos,
        pathDist: Math.max(0, fullPathDist - 85)
    };
}

function scoreRetakePortal(bot, portal, stagingData, claimedPortals) {
    // Use actual A* path distance around the new walls rather than straight-line Euclidean distance
    const pathDist = stagingData.pathDist;
    let score = -pathDist * 0.42;

    // Hysteresis bonus prevents jitter between portals
    if (bot.retakeAssignment && bot.retakeAssignment.name === portal.name) {
        score += 110;
    }

    // Designated defuser favors the shortest entry path directly onto the planted C4
    const distToBomb = Math.hypot(c4State.plantX - portal.entryPos.x, c4State.plantY - portal.entryPos.y);
    if (bot === c4State.designatedDefuser) {
        score -= distToBomb * 0.55;
    }

    // True Multi-Angle Crossfire Split: group B_DOORS_WEST & B_DOORS_EAST under doorGroup "B_DOORS"
    // so cover teammates split into Maze flanks (or A Short / CT Ramp / A Long on Site A) instead of stacking one doorway
    const portalAngFromBomb = Math.atan2(portal.entryPos.y - c4State.plantY, portal.entryPos.x - c4State.plantX);
    let sameDoorGroupClaims = 0;
    for (let i = 0; i < claimedPortals.length; i++) {
        const claimed = claimedPortals[i];
        if (claimed.doorGroup === portal.doorGroup) {
            sameDoorGroupClaims++;
        } else {
            const claimedAng = Math.atan2(claimed.entryPos.y - c4State.plantY, claimed.entryPos.x - c4State.plantX);
            const angularSpread = Math.abs(normalizeAngle(portalAngFromBomb - claimedAng));
            if (angularSpread >= (60 * Math.PI / 180)) {
                score += 240;
            } else {
                score += 110;
            }
        }
    }
    score -= sameDoorGroupClaims * 420;

    // Penalize active Molotov fire or recent CT deaths on the portal
    const inFire = world.firePatches.some(f => f.life > 0.5 && isPointInFire(portal.entryPos.x, portal.entryPos.y, f, 28));
    if (inFire) score -= 500;

    const recentDeaths = (world.tacticalIntel?.deathZones?.CT || []).filter(dz =>
        !dz.cleared && world.gameTime < dz.expiresAt && Math.hypot(dz.x - portal.entryPos.x, dz.y - portal.entryPos.y) < 140
    ).length;
    score -= recentDeaths * 240;

    // Against a post-plant AWP: a solo CT commits straight via the fastest entrance, while multi-CT squads split angles with smoke/flash lead
    const awpNest = getDeducedAWPTarget("CT", portal.entryPos.x, portal.entryPos.y, 780);
    if (awpNest && getMapLineOfSight(awpNest.x, awpNest.y, portal.entryPos.x, portal.entryPos.y)) {
        const isSoloCT = world.livingCT.length <= 1;
        const hasScreenOrFlash = Boolean(bot.hasSmoke || bot.hasFlash);
        if (isSoloCT) {
            score -= 20;
        } else {
            score -= hasScreenOrFlash ? 45 : 135;
        }
    }

    // Reward flanking portals opposite fresh T sightings on site
    const freshTIntel = Object.values(world.sharedEnemyIntelCT || {}).filter(
        intel => intel && intel.enemy && !intel.enemy.isDead && !intel.isSpotCleared && (world.gameTime - intel.time < 4.5)
    );
    for (let i = 0; i < freshTIntel.length; i++) {
        const tInfo = freshTIntel[i];
        const enemyAngFromBomb = Math.atan2(tInfo.y - c4State.plantY, tInfo.x - c4State.plantX);
        const angularDiff = Math.abs(normalizeAngle(portalAngFromBomb - enemyAngFromBomb));
        if (angularDiff >= (70 * Math.PI / 180)) {
            score += 135;
        } else if (angularDiff < (35 * Math.PI / 180)) {
            score -= 75;
        }
    }

    return score;
}

let lastRetakeReplanTime = -99;
let lastRetakeCTCount = 0;

export function updateCTRetakeMacro(dt) {
    if (!c4State.isPlanted) {
        ctPincerState.alphaStaged = false;
        ctPincerState.bravoStaged = false;
        ctPincerState.breachInitiated = false;
        ctPincerState.stagingTimer = 0;
        ctPincerState.minRequiredClock = 14.0;
        lastRetakeReplanTime = -99;
        lastRetakeCTCount = 0;
        return;
    }

    const ctBots = world.livingCT.filter(c => c && c.isBot && !c.isDead);
    if (ctBots.length === 0) return;

    const siteKey = c4State.plantSite === "B" ? "B" : "A";
    const siteRect = siteKey === "B" ? MAP.siteB : MAP.siteA;
    const portals = SITE_RETAKE_PORTALS[siteKey] || SITE_RETAKE_PORTALS.A;

    const needsPortalReplan = (world.gameTime - lastRetakeReplanTime >= 0.45) ||
        (ctBots.length !== lastRetakeCTCount) ||
        ctBots.some(b => !b.retakeAssignment || !b.retakeAssignment.stagePos);

    if (needsPortalReplan) {
        lastRetakeReplanTime = world.gameTime;
        lastRetakeCTCount = ctBots.length;

        // Assign defuser first so cover teammates split around the defuser's chosen entry
        const sorted = ctBots.slice().sort((a, b) => {
            if (a === c4State.designatedDefuser) return -1;
            if (b === c4State.designatedDefuser) return 1;
            return Math.hypot(c4State.plantX - a.x, c4State.plantY - a.y) - Math.hypot(c4State.plantX - b.x, c4State.plantY - b.y);
        });

        const claimedPortals = [];
        sorted.forEach(bot => {
            let bestPortal = portals[0];
            let bestStaging = null;
            let bestScore = -Infinity;

            for (let i = 0; i < portals.length; i++) {
                const portal = portals[i];
                const staging = computeRetakeStagingData(bot, portal, siteRect);
                const s = scoreRetakePortal(bot, portal, staging, claimedPortals);
                if (s > bestScore) {
                    bestScore = s;
                    bestPortal = portal;
                    bestStaging = staging;
                }
            }

            claimedPortals.push(bestPortal);

            const prev = bot.retakeAssignment;
            const stageInFire = prev?.stagePos && world.firePatches.some(f =>
                f.life > 0.5 && isPointInFire(prev.stagePos.x, prev.stagePos.y, f, 24)
            );
            const chosenStagePos = (prev && prev.name === bestPortal.name && prev.stagePos && !stageInFire)
                ? prev.stagePos
                : bestStaging.stagePos;
            const remDist = Math.hypot(chosenStagePos.x - bot.x, chosenStagePos.y - bot.y);

            bot.retakeAssignment = {
                ...bestPortal,
                stagePos: chosenStagePos,
                eta: Math.max(remDist, bestStaging.pathDist) / 195
            };
        });
    } else {
        // Update live remaining arrival ETA each tick
        for (let i = 0; i < ctBots.length; i++) {
            const b = ctBots[i];
            if (b.retakeAssignment?.stagePos) {
                const remDist = Math.hypot(b.retakeAssignment.stagePos.x - b.x, b.retakeAssignment.stagePos.y - b.y);
                b.retakeAssignment.eta = remDist / 195;
            }
        }
    }

    // Compute exact arrival time of the slowest rotating CT + defuse duration so CTs synchronize their hit
    const defuser = c4State.designatedDefuser;
    const defuseDuration = (defuser && defuser.hasDefuseKit) ? 5.0 : 10.0;
    const etas = ctBots
        .map(b => b.retakeAssignment?.eta ?? 0)
        .filter(eta => eta <= 14.0);
    const slowestEta = etas.length > 0 ? Math.max(...etas) : 0;
    const minRequiredClock = Math.min(24.0, defuseDuration + slowestEta + 3.2);
    ctPincerState.minRequiredClock = minRequiredClock;

    if (ctPincerState.breachInitiated) return;

    // Trigger synchronized breach when solo, bomb clock hits the minimum required window, or a CT is already engaged on site
    const anyBotOnSiteOrFighting = ctBots.some(b =>
        isInsideExpandedSite(b.x, b.y, siteRect) ||
        Math.hypot(c4State.plantX - b.x, c4State.plantY - b.y) < 260 ||
        (b.targetEnemy && Math.hypot(c4State.plantX - b.x, c4State.plantY - b.y) < 420)
    );

    if (world.livingCT.length <= 1 || c4State.timer <= minRequiredClock || anyBotOnSiteOrFighting) {
        ctPincerState.breachInitiated = true;
        return;
    }

    // Wait at cover outside the retake portals until ALL alive CTs arrive within 0.85s of their staging positions
    const allStaged = ctBots.every(b => (b.retakeAssignment?.eta ?? 0) <= 0.85);
    if (allStaged) {
        ctPincerState.breachInitiated = true;
        return;
    }

    const stagedCount = ctBots.filter(b => (b.retakeAssignment?.eta ?? 0) <= 0.85).length;
    if (stagedCount >= 1) {
        ctPincerState.stagingTimer += dt;
        // Safety cap (11.5s) covers the full A-to-B rotation around the new walls
        if (ctPincerState.stagingTimer >= 11.5) {
            ctPincerState.breachInitiated = true;
        }
    }
}

export function evaluateCTDefuseTactic(bot, closestEnemy, priorityEnemy) {
    if (!c4State.isPlanted || bot.team !== "CT") return "NONE";

    const timeNeeded = bot.hasDefuseKit ? 5.0 : 10.0;
    const isDefuser = (bot === c4State.designatedDefuser);
    const bombInSmoke = isInsideSmoke(c4State.plantX, c4State.plantY, 15);
    const aliveEnemies = world.livingT.length;

    // All Terrorists eliminated: sprint straight to the bomb and defuse immediately without smokes, fakes, or sweeps
    if (aliveEnemies === 0) {
        return isDefuser ? "DEFUSE_BOMB" : "COVER_CHOKE";
    }

    const hasManAdvantage = world.livingCT.length > aliveEnemies;

    const activeDefuser = c4State.designatedDefuser;
    const activeTimeNeeded = (activeDefuser && activeDefuser.hasDefuseKit) ? 5.0 : 10.0;
    const remainingActiveDefuse = c4State.isBeingDefused
        ? (1.0 - (c4State.defuseProgress || 0)) * activeTimeNeeded
        : timeNeeded;

    // 1. Unwinnable timer with Terrorists still alive -> save gear
    if (aliveEnemies > 0 && c4State.timer < (remainingActiveDefuse - 0.15)) {
        return "SAVE_GEAR";
    }

    // 2. True point-of-no-return stick check
    if (isDefuser && bot.isDefusing) {
        const remSelf = (1.0 - (c4State.defuseProgress || 0)) * timeNeeded;
        if (c4State.timer <= remSelf + 1.1) {
            return "STICK_DEFUSE";
        }
        if (bombInSmoke) {
            const hitRecently = (world.gameTime - (bot.lastHitTime || -99)) < 0.45;
            const closeGunfireOrSteps = bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 0.9) &&
                Math.hypot(bot.lastHeardSound.x - bot.x, bot.lastHeardSound.y - bot.y) < 280;
            const enemyInSmokeRange = closestEnemy && Math.hypot(closestEnemy.x - bot.x, closestEnemy.y - bot.y) < 145;
            if (!hitRecently && !closeGunfireOrSteps && !enemyInSmokeRange) {
                return "STICK_DEFUSE";
            }
        }
    }

    // 3. Visible enemy -> always break defuse and fight first
    if (priorityEnemy || closestEnemy) {
        return "FIGHT_FIRST";
    }

    // 4. Man advantage -> skip fakes & corner sweeps; smoke if available and commit straight to defusing
    if (isDefuser && hasManAdvantage) {
        if (bot.hasSmoke && !bombInSmoke && c4State.timer > timeNeeded + 2.0) {
            return "SMOKE_BOMB";
        }
        return "DEFUSE_BOMB";
    }

    // 5. Fresh gunshot, footsteps, or teammate sighting on site -> locate & clear enemy before defusing
    if (aliveEnemies > 0 && c4State.timer > timeNeeded + 2.5) {
        const recentLocalThreat = bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 2.6) &&
            Math.hypot(bot.lastHeardSound.x - c4State.plantX, bot.lastHeardSound.y - c4State.plantY) < 420;
        const freshSiteIntel = Object.values(world.sharedEnemyIntelCT || {}).some(intel =>
            intel && intel.enemy && !intel.enemy.isDead && !intel.isSpotCleared &&
            (world.gameTime - intel.time < 3.5) &&
            Math.hypot(intel.x - c4State.plantX, intel.y - c4State.plantY) < 460
        );
        if (recentLocalThreat || freshSiteIntel) {
            return "FIGHT_FIRST";
        }
    }

    const isSoloCTClutch = world.livingCT.length === 1;

    // 6. Fake-Defuse Quota & Reactive Cover Bait (solo CT caps at 1 quick fake only when plenty of clock remains)
    if (isDefuser && aliveEnemies >= 1) {
        if (bot.fakeDefuseBaitUntil && world.gameTime < bot.fakeDefuseBaitUntil) {
            return "HOLD_FAKE_BAIT";
        }
        if (isSoloCTClutch && (bot.fakeDefusesRemaining || 0) > 1) {
            bot.fakeDefusesRemaining = 1;
        }
        const fakesLeft = bot.fakeDefusesRemaining !== undefined ? bot.fakeDefusesRemaining : 0;
        const minFakeClock = isSoloCTClutch ? (timeNeeded + 6.5) : (timeNeeded + 4.2);
        if (fakesLeft > 0 && c4State.timer > minFakeClock) {
            return "FAKE_DEFUSE";
        }
    }

    // 7. Sweep close uncleared bombsite pockets only when teammates cover or solo CT is still far from the bomb
    const distToBombNow = Math.hypot(c4State.plantX - bot.x, c4State.plantY - bot.y);
    if (isDefuser && !bot.isDefusing && !isSoloCTClutch && aliveEnemies > 0 &&
        distToBombNow > 160 && c4State.timer > timeNeeded + 6.5) {
        const unclearedPocket = getNextUnclearedSitePocket(c4State.plantSite || "A");
        if (unclearedPocket) {
            return "CLEAR_SITE";
        }
    }

    // 8. Drop smoke on bomb before committing to a full defuse
    if (isDefuser && bot.hasSmoke && !bombInSmoke && c4State.timer > timeNeeded + 2.0) {
        return "SMOKE_BOMB";
    }

    return isDefuser ? "DEFUSE_BOMB" : "COVER_CHOKE";
}

/* ==========================================================================
   PHYSICS UTILITY SOLVER & SQUAD DECONFLICTION
   ========================================================================== */
function getWallBankCandidateAngles(bot, desiredX, desiredY) {
    const bankAngles = [];
    const rayCount = 24;
    const muzzleOffset = (bot.radius || TORSO_RADIUS) + 6;

    for (let i = 0; i < rayCount; i++) {
        const rayAng = (i * Math.PI * 2) / rayCount;
        const sx = bot.x + Math.cos(rayAng) * muzzleOffset;
        const sy = bot.y + Math.sin(rayAng) * muzzleOffset;
        if (checkWallCollision(sx, sy, 6)) continue;

        const hit = getRayObstacleEndpoint(sx, sy, rayAng, 420);
        const hitDist = Math.hypot(hit.x - bot.x, hit.y - bot.y);
        if (hitDist < 48 || hitDist > 400) continue;

        // Estimate outward wall normal around the impact point
        let nx = 0;
        let ny = 0;
        for (let k = 0; k < 8; k++) {
            const probeAng = (k * Math.PI) / 4;
            if (!checkWallCollision(hit.x + Math.cos(probeAng) * 14, hit.y + Math.sin(probeAng) * 14, 4)) {
                nx += Math.cos(probeAng);
                ny += Math.sin(probeAng);
            }
        }
        const nLen = Math.hypot(nx, ny);
        if (nLen < 0.001) continue;
        nx /= nLen;
        ny /= nLen;

        // Reflect the vector from the wall impact toward the target back to the thrower
        const toTargetX = desiredX - hit.x;
        const toTargetY = desiredY - hit.y;
        const tLen = Math.hypot(toTargetX, toTargetY);
        if (tLen < 30 || tLen > 620) continue;

        const dirX = toTargetX / tLen;
        const dirY = toTargetY / tLen;
        const dot = dirX * nx + dirY * ny;
        if (dot <= 0.12) continue; // Target is behind this wall, not on the reflected side

        const incX = dirX - 2 * dot * nx;
        const incY = dirY - 2 * dot * ny;
        const bankAng = normalizeAngle(Math.atan2(-incY, -incX));

        if (!bankAngles.some(prev => Math.abs(normalizeAngle(prev - bankAng)) < 0.09)) {
            bankAngles.push(bankAng);
        }
    }

    return bankAngles;
}

export function solveBotUtilityThrow(bot, wepKey, desiredX, desiredY, maxError = 85, actualThreatPos = null) {
    const wep = WEAPONS[wepKey];
    if (!bot || !wep || wep.category !== "grenade") return null;

    const baseAngle = Math.atan2(desiredY - bot.y, desiredX - bot.x);
    const angleOffsets = [0, -0.14, 0.14, -0.28, 0.28, -0.45, 0.45, -0.65, 0.65, -0.88, 0.88];
    const powerModes = [false, true];
    const teammates = bot.team === "CT" ? world.livingCT : world.livingT;

    let bestSolution = null;
    let bestScore = Infinity;

    for (let i = 0; i < angleOffsets.length; i++) {
        const offset = angleOffsets[i];
        const candAngle = baseAngle + offset;

        // Reject throws that immediately hit a wall right in front of the bot
        let hitsImmediateWall = false;
        for (let d = 20; d <= 68; d += 16) {
            if (checkWallCollision(bot.x + Math.cos(candAngle) * d, bot.y + Math.sin(candAngle) * d, 10)) {
                hitsImmediateWall = true;
                break;
            }
        }
        if (hitsImmediateWall) continue;

        const aimX = bot.x + Math.cos(candAngle) * 300;
        const aimY = bot.y + Math.sin(candAngle) * 300;

        for (let p = 0; p < powerModes.length; p++) {
            const isExtended = powerModes[p];
            const spot = predictUtilityLandingSpot(bot, wepKey, aimX, aimY, isExtended);
            if (!spot) continue;

            const landingError = Math.hypot(spot.x - desiredX, spot.y - desiredY);
            if (landingError > maxError) continue;

            if (landingError > 24 && !getMapLineOfSight(spot.x, spot.y, desiredX, desiredY)) {
                continue;
            }

            // Ensure the grenade actually lands on the real enemy's side of any wall
            if (actualThreatPos) {
                const distToRealThreat = Math.hypot(spot.x - actualThreatPos.x, spot.y - actualThreatPos.y);
                if (distToRealThreat > 220 || !getMapLineOfSight(spot.x, spot.y, actualThreatPos.x, actualThreatPos.y)) {
                    continue;
                }
            }

            if (wepKey === "MOLOTOV" || wepKey === "HEGRENADE") {
                const safeRadius = wepKey === "MOLOTOV" ? 165 : 145;
                const hitsAlly = teammates.some(m => m && !m.isDead && Math.hypot(spot.x - m.x, spot.y - m.y) < safeRadius);
                if (hitsAlly) continue;
            } else if (wepKey === "FLASH") {
                // Prevent self-blinding if the flash lands close with line-of-sight back to the thrower
                const distToSelf = Math.hypot(spot.x - bot.x, spot.y - bot.y);
                if (distToSelf < 245 && getMapLineOfSight(spot.x, spot.y, bot.x, bot.y)) {
                    continue;
                }
                // Prevent team-flashing teammates looking toward the predicted detonation point
                const blindsAlly = teammates.some(m => {
                    if (!m || m === bot || m.isDead) return false;
                    const dAlly = Math.hypot(spot.x - m.x, spot.y - m.y);
                    if (dAlly > 340 || !getMapLineOfSight(spot.x, spot.y, m.x, m.y)) return false;
                    const allyToFlash = Math.atan2(spot.y - m.y, spot.x - m.x);
                    return Math.abs(normalizeAngle(allyToFlash - m.angle)) < (Math.PI * 0.48);
                });
                if (blindsAlly) continue;
            }

            const score = landingError + Math.abs(offset) * 18;
            if (score < bestScore) {
                bestScore = score;
                bestSolution = { aimX, aimY, isExtended, landingSpot: spot, error: landingError };
            }
        }
    }

    return bestSolution;
}

export function calculateCircleOverlapRatio(x1, y1, r1, x2, y2, r2) {
    const d = Math.hypot(x2 - x1, y2 - y1);
    if (d >= r1 + r2) return 0;
    if (d <= Math.abs(r1 - r2)) {
        const smallerArea = Math.PI * Math.min(r1, r2) * Math.min(r1, r2);
        return smallerArea / (Math.PI * r1 * r1);
    }
    const r1Sq = r1 * r1;
    const r2Sq = r2 * r2;
    const alpha = Math.acos((d * d + r1Sq - r2Sq) / (2 * d * r1));
    const beta = Math.acos((d * d + r2Sq - r1Sq) / (2 * d * r2));
    const intersectionArea = r1Sq * alpha + r2Sq * beta - 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
    return intersectionArea / (Math.PI * r1 * r1);
}

export function isUtilityTargetClaimed(team, tx, ty, type, checkRadius = 220) {
    world.teamUtilityReservations = world.teamUtilityReservations.filter(r => world.gameTime < r.expiresAt);

    if (type === "SMOKE") {
        const newRadius = 210;

        for (let i = 0; i < world.smokeClouds.length; i++) {
            const cloud = world.smokeClouds[i];
            if (cloud.life > 1.5 && calculateCircleOverlapRatio(tx, ty, newRadius, cloud.x, cloud.y, cloud.radius) > 0.50) {
                return true;
            }
        }
        for (let i = 0; i < world.grenades.length; i++) {
            const g = world.grenades[i];
            if (g.type === "SMOKE" && calculateCircleOverlapRatio(tx, ty, newRadius, g.x, g.y, g.isExtended ? 250 : 210) > 0.50) {
                return true;
            }
        }
        for (let i = 0; i < world.teamUtilityReservations.length; i++) {
            const res = world.teamUtilityReservations[i];
            if (res.type === "SMOKE" && (!team || res.team === team) &&
                calculateCircleOverlapRatio(tx, ty, newRadius, res.x, res.y, 210) > 0.50) {
                return true;
            }
        }
        return false;
    }

    for (let i = 0; i < world.teamUtilityReservations.length; i++) {
        const res = world.teamUtilityReservations[i];
        if (res.type === type && (!team || res.team === team) && Math.hypot(res.x - tx, res.y - ty) < checkRadius) {
            return true;
        }
    }
    return false;
}

export function claimUtilityTarget(team, tx, ty, type, reservationDuration = 3.0) {
    world.teamUtilityReservations = world.teamUtilityReservations.filter(r => world.gameTime < r.expiresAt);
    world.teamUtilityReservations.push({
        team,
        x: tx,
        y: ty,
        type,
        detonateAt: world.gameTime + 1.45,
        expiresAt: world.gameTime + reservationDuration
    });
}

export function hasClearThrowTrajectory(fromX, fromY, toX, toY) {
    const dist = Math.hypot(toX - fromX, toY - fromY);
    if (dist < 90 || dist > 850) return false;
    if (checkWallCollision(toX, toY, 16)) return false;

    const throwAngle = Math.atan2(toY - fromY, toX - fromX);
    const feelerX = fromX + Math.cos(throwAngle) * 35;
    const feelerY = fromY + Math.sin(throwAngle) * 35;
    if (checkWallCollision(feelerX, feelerY, 12)) return false;

    return getMapLineOfSight(fromX, fromY, toX, toY);
}

export function getCornerTossTarget(bot, threatX, threatY) {
    let bestTarget = null;
    let bestDist = Infinity;

    for (let i = 0; i < TACTICAL_CORNERS.length; i++) {
        const corner = TACTICAL_CORNERS[i];
        const distToCorner = Math.hypot(corner.x - bot.x, corner.y - bot.y);
        if (distToCorner < 95 || distToCorner > 760) continue;

        const distCornerToThreat = Math.hypot(threatX - corner.x, threatY - corner.y);
        if (distCornerToThreat < 35 || distCornerToThreat >= 280) continue;

        // Project past the corner lip toward the threat and verify the other side is actually open
        const pastAng = Math.atan2(threatY - corner.y, threatX - corner.x);
        const clearDist = Math.min(85, distCornerToThreat * 0.65);
        const deepX = corner.x + Math.cos(pastAng) * clearDist;
        const deepY = corner.y + Math.sin(pastAng) * clearDist;

        if (checkWallCollision(deepX, deepY, 14)) continue;
        if (!getMapLineOfSight(corner.x, corner.y, deepX, deepY)) continue;
        if (!getMapLineOfSight(deepX, deepY, threatX, threatY)) continue;

        if (distToCorner < bestDist && hasClearThrowTrajectory(bot.x, bot.y, deepX, deepY)) {
            bestDist = distToCorner;
            bestTarget = { x: deepX, y: deepY };
        }
    }
    return bestTarget;
}

function getExposingThreatForUtility(bot, closestEnemy) {
    if (closestEnemy && !closestEnemy.isDead) {
        const d = Math.hypot(closestEnemy.x - bot.x, closestEnemy.y - bot.y);
        if (d <= 720 && !isInsideSmoke(closestEnemy.x, closestEnemy.y, 12) &&
            getMapLineOfSight(closestEnemy.x, closestEnemy.y, bot.x, bot.y)) {
            return { x: closestEnemy.x, y: closestEnemy.y };
        }
    }

    const bbThreat = getTacticalBlackboardThreat(bot);
    const susSpot = (bbThreat && bbThreat.tier >= 2) ? bbThreat : getRelevantSuspiciousSpot(bot);
    if (susSpot) {
        const d = Math.hypot(susSpot.x - bot.x, susSpot.y - bot.y);
        if (d >= 130 && d <= 720 && !isInsideSmoke(susSpot.x, susSpot.y, 12) &&
            getMapLineOfSight(susSpot.x, susSpot.y, bot.x, bot.y)) {
            return { x: susSpot.x, y: susSpot.y };
        }
    }

    return null;
}

const SLOT_TO_GRENADE_FLAG = {
    4: "hasHE",
    5: "hasSmoke",
    7: "hasFlash",
    8: "hasMolotov"
};

function releaseBotGrenade(bot, slotNum, targetX, targetY, isExtended, throwAngle) {
    const wepFlag = SLOT_TO_GRENADE_FLAG[slotNum] || null;
    if (wepFlag && !bot[wepFlag]) return false;

    const isFlash = slotNum === 7;
    bot.utilityLookAngle = isFlash ? normalizeAngle(throwAngle + Math.PI * 0.75) : throwAngle;
    bot.utilityLookLockTimer = isFlash ? 0.18 : 0.25;
    bot.utilityCoverRetreat = null;

    if (bot.activeSlot !== slotNum) {
        bot.selectSlot(slotNum);
    }
    const key = bot.getEquippedKey();
    if (bot.clips && key && bot.clips[key] !== undefined && bot.clips[key] <= 0) {
        bot.clips[key] = 1;
    }

    bot.angle = throwAngle;
    performAttack(bot, targetX, targetY, isExtended);

    if (wepFlag) {
        bot[wepFlag] = false;
    }
    bot.lastUtilityThrowTime = world.gameTime;
    bot.selectSlot(bot.primaryKey ? 1 : (bot.secondaryKey ? 2 : 3));
    return true;
}

export function executeBotGrenadeThrow(bot, slotNum, targetX, targetY, isExtended = false) {
    if (!bot || bot.isDead || bot.pendingUtilityThrow) return false;
    if ((bot.blindTimer || 0) > 0.65) return false;
    if (world.gameTime - (bot.lastUtilityThrowTime || -99) < 1.65) return false;

    const wepFlag = SLOT_TO_GRENADE_FLAG[slotNum] || null;
    if (wepFlag && !bot[wepFlag]) return false;

    const throwAngle = Math.atan2(targetY - bot.y, targetX - bot.x);
    bot.utilityCoverRetreat = null;

    // Pull out the grenade first so the switch/draw timer applies before release
    bot.selectSlot(slotNum);
    const isNearlyStopped = Math.hypot(bot.vx || 0, bot.vy || 0) < 45;
    if ((bot.equipTimer || 0) <= 0 && isNearlyStopped && Math.abs(normalizeAngle(throwAngle - bot.angle)) <= 0.14) {
        return releaseBotGrenade(bot, slotNum, targetX, targetY, isExtended, throwAngle);
    }

    bot.utilityLookAngle = throwAngle;
    bot.utilityLookLockTimer = 0.85;
    bot.pendingUtilityThrow = {
        slotNum,
        wepFlag,
        targetX,
        targetY,
        isExtended,
        throwAngle,
        expiresAt: world.gameTime + 0.85
    };
    return true;
}

export function processPendingUtilityThrow(bot, dt, abortForCloseCombat = false) {
    const pending = bot?.pendingUtilityThrow;
    if (!pending) return false;

    const wepAvailable = !pending.wepFlag || Boolean(bot[pending.wepFlag]);
    const wasJustHit = bot.lastHitBy && !bot.lastHitBy.isDead && (world.gameTime - bot.lastHitTime < 0.45);
    const isBlinded = (bot.blindTimer || 0) > 0.65;

    if (bot.isDead || abortForCloseCombat || wasJustHit || isBlinded || bot.isDefusing ||
        bot.executePhase === "PLANT_LOCK" || !wepAvailable || world.gameTime >= pending.expiresAt) {
        bot.pendingUtilityThrow = null;
        bot.utilityLookLockTimer = 0;
        if ([4, 5, 7, 8].includes(bot.activeSlot)) {
            bot.selectSlot(bot.primaryKey ? 1 : (bot.secondaryKey ? 2 : 3));
        }
        return false;
    }

    const exposedWhileDrawing = getMapLineOfSight(bot.x, bot.y, pending.targetX, pending.targetY);
    if (exposedWhileDrawing) {
        const coverPt = findTacticalCover(bot, pending.targetX, pending.targetY);
        if (Math.hypot(coverPt.x - bot.x, coverPt.y - bot.y) > 14 && !checkWallCollision(coverPt.x, coverPt.y, bot.radius)) {
            steerBotToDestination(bot, coverPt.x, coverPt.y, 195, dt, { stopRadius: 10, autoAim: false });
        } else {
            brakeBot(bot, dt);
        }
    } else {
        brakeBot(bot, dt);
    }

    bot.angle = rotateTowardsDamped(bot.angle, pending.throwAngle, 12.5, dt, 9.5);
    bot.utilityLookAngle = pending.throwAngle;
    bot.utilityLookLockTimer = 0.25;

    const remainingDiff = Math.abs(normalizeAngle(pending.throwAngle - bot.angle));
    if ((bot.equipTimer || 0) <= 0 && remainingDiff <= 0.14) {
        bot.pendingUtilityThrow = null;
        releaseBotGrenade(bot, pending.slotNum, pending.targetX, pending.targetY, pending.isExtended, pending.throwAngle);
    }
    return true;
}


function tryPlannedThrow(bot, wepKey, slotNum, targetX, targetY, maxError, claimRadius, claimDuration, actualThreatPos = null) {
    if (isUtilityTargetClaimed(bot.team, targetX, targetY, wepKey, claimRadius)) return false;

    // Anti-synergy guards: never extinguish friendly fire with smoke, or throw fire into smoke/existing fire
    if (wepKey === "SMOKE") {
        const extinguishesFriendlyFire = world.firePatches.some(f =>
            f.life > 1.2 &&
            ((f.owner && f.owner.team === bot.team) || f.team === bot.team) &&
            Math.hypot(f.x - targetX, f.y - targetY) < (f.radius + 95)
        );
        if (extinguishesFriendlyFire) return false;
    } else if (wepKey === "MOLOTOV") {
        if (isInsideSmoke(targetX, targetY, 24)) return false;
        const alreadyBurning = world.firePatches.some(f =>
            f.life > 2.0 && Math.hypot(f.x - targetX, f.y - targetY) < (f.radius + 35)
        );
        if (alreadyBurning) return false;
    }

    const plan = solveBotUtilityThrow(bot, wepKey, targetX, targetY, maxError, actualThreatPos);
    if (!plan) return false;

    // Double-check actual predicted landing spot against smoke/friendly fire anti-synergy
    if (wepKey === "MOLOTOV" && isInsideSmoke(plan.landingSpot.x, plan.landingSpot.y, 20)) return false;
    if (wepKey === "SMOKE") {
        const hitsFriendlyMolotov = world.firePatches.some(f =>
            f.life > 1.2 &&
            ((f.owner && f.owner.team === bot.team) || f.team === bot.team) &&
            Math.hypot(f.x - plan.landingSpot.x, f.y - plan.landingSpot.y) < (f.radius + 85)
        );
        if (hitsFriendlyMolotov) return false;
    }

    claimUtilityTarget(bot.team, targetX, targetY, wepKey, claimDuration);
    executeBotGrenadeThrow(bot, slotNum, plan.aimX, plan.aimY, plan.isExtended);
    return true;
}

function hasCurrentRoundEvidenceAtSpot(bot, x, y, radius = 340) {
    const teammates = bot.team === "CT" ? world.livingCT : world.livingT;
    for (let i = 0; i < teammates.length; i++) {
        const s = teammates[i]?.lastHeardSound;
        if (s && (world.gameTime - s.time < 4.5) && Math.hypot(s.x - x, s.y - y) <= radius) {
            return true;
        }
    }

    if (world.squadHelpSignals.some(sig =>
        sig.team === bot.team &&
        (world.gameTime - sig.time < 5.0) &&
        (!sig.targetEnemy || !sig.targetEnemy.isDead) &&
        Math.hypot(sig.enemyPos.x - x, sig.enemyPos.y - y) <= radius
    )) {
        return true;
    }

    const intelMap = bot.team === "CT" ? world.sharedEnemyIntelCT : world.sharedEnemyIntelT;
    for (const id in intelMap) {
        const intel = intelMap[id];
        if (intel && intel.enemy && !intel.enemy.isDead && !intel.isSpotCleared &&
            (world.gameTime - intel.time < 5.0) &&
            Math.hypot(intel.x - x, intel.y - y) <= radius) {
            return true;
        }
    }

    return false;
}

function tryFlushSuspiciousSpot(bot) {
    if (!bot || bot.isDead) return false;
    if (!bot.hasSmoke && !bot.hasHE && !bot.hasFlash && !bot.hasMolotov) return false;

    const bbThreat = getTacticalBlackboardThreat(bot);
    const legacySpot = getRelevantSuspiciousSpot(bot);
    const spot = (bbThreat && bbThreat.tier >= 2) ? bbThreat : (legacySpot || bbThreat);
    if (!spot) return false;
    if (!spot.isConfirmed && isSectorRecentlyCleared(bot.team, spot.x, spot.y, 130)) return false;

    // Require current-round evidence (this round's kill/trace or a fresh sound/sighting) so old-round deaths don't waste utility
    const isCurrentRoundThreat = spot.isConfirmed ||
        spot.source === "BALLISTIC_TRACE" ||
        spot.lastKillRound === matchState.roundNumber;
    if (!isCurrentRoundThreat && !hasCurrentRoundEvidenceAtSpot(bot, spot.x, spot.y, 340)) {
        return false;
    }

    const teammates = bot.team === "CT" ? world.livingCT : world.livingT;
    const enemies = bot.team === "CT" ? world.livingT : world.livingCT;

    // If any teammate already has direct LOS to the spot and no enemy is there, mark it cleared and do not throw
    const knownEmptyByLOS = teammates.some(m =>
        m && !m.isDead &&
        Math.hypot(spot.x - m.x, spot.y - m.y) <= FIXED_VISION_RANGE &&
        getLineOfSight(m.x, m.y, spot.x, spot.y) &&
        !enemies.some(e => !e.isDead && Math.hypot(e.x - spot.x, e.y - spot.y) < 150)
    );
    if (knownEmptyByLOS) {
        spot.clearedThisRound = true;
        recordClearedSector(bot.team, spot.x, spot.y, 8.0);
        return false;
    }

    const distToSpot = Math.hypot(spot.x - bot.x, spot.y - bot.y);
    if (distToSpot < 170 || distToSpot > 760) return false;

    const hasDirectSight = hasClearThrowTrajectory(bot.x, bot.y, spot.x, spot.y);
    if (hasUsableAWP(bot) && hasDirectSight) return false;

    const teamNearby = teammates.some(t => Math.hypot(t.x - spot.x, t.y - spot.y) < 165);

    if (spot.weaponCategory !== "sniper" && !teamNearby && bot.hasMolotov &&
        tryPlannedThrow(bot, "MOLOTOV", 8, spot.x, spot.y, 90, 150, 3.5)) {
        return true;
    }

    if (bot.hasSmoke) {
        const smokeTarget = distToSpot > 460
            ? { x: (bot.x + spot.x) * 0.5, y: (bot.y + spot.y) * 0.5 }
            : { x: spot.x, y: spot.y };
        if (tryPlannedThrow(bot, "SMOKE", 5, smokeTarget.x, smokeTarget.y, 110, 180, 4.5)) {
            return true;
        }
    }

    if (bot.hasFlash && tryPlannedThrow(bot, "FLASH", 7, spot.x, spot.y, 120, 240, 2.2)) {
        return true;
    }

    if (!teamNearby && bot.hasHE && tryPlannedThrow(bot, "HEGRENADE", 4, spot.x, spot.y, 95, 150, 2.5)) {
        return true;
    }

    return false;
}

function tryCTChokeDenial(bot, roundElapsed) {
    if (bot.team !== "CT" || (!bot.hasSmoke && !bot.hasMolotov && !bot.hasFlash)) return false;
    if (hasUsableAWP(bot)) return false;

    const siteKey = bot.assignedCTStrat?.site || "MID";
    if (siteKey === "B") return false;

    const chokes = {
        A: { x: 1030, y: 240, name: "A Long Corner" },
        MID: { x: 1290, y: 1080, name: "Mid Doors" }
    };

    const targetChoke = chokes[siteKey] || chokes.MID;
    const dist = Math.hypot(targetChoke.x - bot.x, targetChoke.y - bot.y);
    if (dist < 180 || dist > 780) return false;

    const isMidCross = targetChoke.name === "Mid Doors";
    const isEarlyDrop = isMidCross
        ? (roundElapsed >= 2.5 && roundElapsed <= 9.0)
        : (roundElapsed >= 4.0 && roundElapsed <= 12.0);
    const isMidResmoke = isMidCross && roundElapsed >= 25.0 && roundElapsed <= 75.0;

    // Skip if a CT already has clear sight of the choke and confirms nobody is there after initial contact time
    if (!isMidCross && roundElapsed >= 6.5) {
        const chokeVisiblyEmpty = world.livingCT.some(m =>
            m && !m.isDead &&
            Math.hypot(targetChoke.x - m.x, targetChoke.y - m.y) <= FIXED_VISION_RANGE &&
            getLineOfSight(m.x, m.y, targetChoke.x, targetChoke.y) &&
            !world.livingT.some(t => !t.isDead && Math.hypot(t.x - targetChoke.x, t.y - targetChoke.y) < 180)
        );
        if (chokeVisiblyEmpty) return false;
    }

    if (isMidCross && roundElapsed >= 3.0 && roundElapsed <= 6.5 && bot.hasFlash && bot.x > 1320) {
        if (tryPlannedThrow(bot, "FLASH", 7, 1160, 1080, 130, 260, 2.0)) {
            return true;
        }
    }

    if (isEarlyDrop || isMidResmoke) {
        if (bot.hasSmoke && tryPlannedThrow(bot, "SMOKE", 5, targetChoke.x, targetChoke.y, 110, 180, 4.0)) {
            return true;
        }
        if (bot.hasMolotov && tryPlannedThrow(bot, "MOLOTOV", 8, targetChoke.x, targetChoke.y, 95, 140, 3.0)) {
            return true;
        }
    }
    return false;
}

const T_EXECUTE_CUTOFF_SMOKES = {
    A: [
        { x: 2225, y: 420 }, // CT Ramp choke cutoff
        { x: 1890, y: 180 }  // West site / A Long cross cutoff
    ],
    B: [
        { x: 2310, y: 1435 } // Widened B Doors rotator cutoff
    ]
};

function tryFastExecuteUtilityDump(bot) {
    if (bot.team !== "T" || c4State.isPlanted || bot.hasC4 || hasUsableAWP(bot)) return false;

    const targetSiteKey = bot.assignedSite === "B" ? "B" : "A";
    if (!isTFastExecuteActive(targetSiteKey)) return false;

    const siteRect = targetSiteKey === "B" ? MAP.siteB : MAP.siteA;
    if (!siteRect) return false;

    const siteCenterX = siteRect.x + siteRect.w * 0.5;
    const siteCenterY = siteRect.y + siteRect.h * 0.5;
    const distToSite = Math.hypot(siteCenterX - bot.x, siteCenterY - bot.y);
    if (distToSite < 165 || distToSite > 720) return false;

    const teammatesOnSite = world.livingT.some(t => t && !t.isDead && isStrictlyInsideSite(t.x, t.y, siteRect));

    // 1. Dump rotator cutoff smokes first (CT Ramp / Widened B Doors)
    if (bot.hasSmoke) {
        const smokes = T_EXECUTE_CUTOFF_SMOKES[targetSiteKey] || [];
        for (let i = 0; i < smokes.length; i++) {
            if (tryPlannedThrow(bot, "SMOKE", 5, smokes[i].x, smokes[i].y, 120, 210, 5.5)) {
                return true;
            }
        }
    }

    // 2. Dump Molotovs & HEs into common CT anchor cubbies before teammates enter the site box
    if (!teammatesOnSite && (bot.hasMolotov || bot.hasHE)) {
        const pockets = (T_EXECUTE_MOLOTOV_POCKETS[targetSiteKey] || T_EXECUTE_MOLOTOV_POCKETS.A)
            .slice()
            .sort((a, b) => Math.hypot(a.x - bot.x, a.y - bot.y) - Math.hypot(b.x - bot.x, b.y - bot.y));

        for (let i = 0; i < pockets.length; i++) {
            const pocket = pockets[i];
            if (isSectorRecentlyCleared("T", pocket.x, pocket.y, 150)) continue;
            if (bot.hasMolotov && tryPlannedThrow(bot, "MOLOTOV", 8, pocket.x, pocket.y, 100, 165, 4.0)) {
                return true;
            }
            if (bot.hasHE && tryPlannedThrow(bot, "HEGRENADE", 4, pocket.x, pocket.y, 105, 175, 2.5)) {
                return true;
            }
        }
    }

    // 3. Pop an entry flash onto the site ahead of the flood wave
    if (!teammatesOnSite && bot.hasFlash) {
        const flashX = siteRect.safeSpot.x;
        const flashY = siteRect.safeSpot.y;
        const allyAhead = world.livingT.some(m => m !== bot && !m.isDead && Math.hypot(m.x - flashX, m.y - flashY) < 240);
        if (!allyAhead && tryPlannedThrow(bot, "FLASH", 7, flashX, flashY, 135, 260, 2.2)) {
            return true;
        }
    }

    return false;
}

function tryTBombsiteExecuteMolotov(bot) {
    if (bot.team !== "T" || !bot.hasMolotov || c4State.isPlanted || !pincerState.breachInitiated) return false;
    if (bot.hasC4 || hasUsableAWP(bot)) return false;

    const targetSiteKey = bot.assignedSite === "B" ? "B" : "A";
    const siteRect = targetSiteKey === "B" ? MAP.siteB : MAP.siteA;
    if (!siteRect) return false;

    if (world.livingT.some(t => t && !t.isDead && isStrictlyInsideSite(t.x, t.y, siteRect))) {
        return false;
    }

    const siteCenterX = siteRect.x + siteRect.w * 0.5;
    const siteCenterY = siteRect.y + siteRect.h * 0.5;
    const distToSite = Math.hypot(siteCenterX - bot.x, siteCenterY - bot.y);
    if (distToSite < 210 || distToSite > 660) return false;

    const pockets = (T_EXECUTE_MOLOTOV_POCKETS[targetSiteKey] || T_EXECUTE_MOLOTOV_POCKETS.A)
        .slice()
        .sort((a, b) => Math.hypot(a.x - bot.x, a.y - bot.y) - Math.hypot(b.x - bot.x, b.y - bot.y));

    for (let i = 0; i < pockets.length; i++) {
        const pocket = pockets[i];
        if (isSectorRecentlyCleared("T", pocket.x, pocket.y, 150)) continue;
        if (tryPlannedThrow(bot, "MOLOTOV", 8, pocket.x, pocket.y, 95, 165, 4.0)) {
            return true;
        }
    }

    return false;
}

function tryMolotovHEFollowup(bot) {
    if (!bot || !bot.hasHE || hasUsableAWP(bot)) return false;
    if (bot.team === "T" && bot.hasC4 && !c4State.isPlanted) return false;

    const siteKey = c4State.isPlanted
        ? (c4State.plantSite === "B" ? "B" : "A")
        : (bot.assignedSite === "B" ? "B" : "A");
    const pockets = bot.team === "T"
        ? (T_EXECUTE_MOLOTOV_POCKETS[siteKey] || T_EXECUTE_MOLOTOV_POCKETS.A)
        : (T_SITE_DEFENDER_POCKETS[siteKey] || T_SITE_DEFENDER_POCKETS.A);

    const exitAnchor = bot.team === "T"
        ? (siteKey === "B" ? MAP.siteB.safeSpot : MAP.siteA.safeSpot)
        : { x: c4State.plantX, y: c4State.plantY };

    for (let i = 0; i < pockets.length; i++) {
        const pocket = pockets[i];
        const mollyActiveHere = (world.teamUtilityReservations || []).some(r =>
            r.team === bot.team && r.type === "MOLOTOV" && Math.hypot(r.x - pocket.x, r.y - pocket.y) < 120
        ) || world.firePatches.some(f =>
            f.life > 3.2 && ((f.owner && f.owner.team === bot.team) || f.team === bot.team) &&
            Math.hypot(f.x - pocket.x, f.y - pocket.y) < (f.radius + 45)
        );
        if (!mollyActiveHere) continue;

        // Place the HE 70px along the defender's escape path out of the Molotov
        const escapeAng = Math.atan2(exitAnchor.y - pocket.y, exitAnchor.x - pocket.x);
        const rawX = Math.max(80, Math.min(MAP.width - 80, pocket.x + Math.cos(escapeAng) * 70));
        const rawY = Math.max(80, Math.min(MAP.height - 80, pocket.y + Math.sin(escapeAng) * 70));
        const punishPt = navCellToWorld(worldToNavCell(rawX, rawY));

        const dist = Math.hypot(punishPt.x - bot.x, punishPt.y - bot.y);
        if (dist >= 165 && dist <= 740 && tryPlannedThrow(bot, "HEGRENADE", 4, punishPt.x, punishPt.y, 100, 155, 2.4)) {
            return true;
        }
    }

    return false;
}

function tryTBreachUtility(bot) {
    if (bot.team !== "T" || !pincerState.breachInitiated) return false;
    if (hasUsableAWP(bot)) return false;
    if (!T_BREACH_CHOKES.some(p => Math.hypot(bot.x - p.x, bot.y - p.y) < 95)) return false;

    if (bot.hasFlash) {
        const targetX = bot.x + Math.cos(bot.angle) * 420;
        const targetY = bot.y + Math.sin(bot.angle) * 420;
        const friendlyInFront = world.livingT.some(m =>
            m !== bot && Math.hypot(m.x - targetX, m.y - targetY) < 260
        );
        if (!friendlyInFront && tryPlannedThrow(bot, "FLASH", 7, targetX, targetY, 135, 260, 2.2)) {
            return true;
        }
    }

    const defenderPockets = bot.assignedSite === "B" ? T_SITE_DEFENDER_POCKETS.B : T_SITE_DEFENDER_POCKETS.A;
    for (let i = 0; i < defenderPockets.length; i++) {
        const spot = defenderPockets[i];
        if (isSectorRecentlyCleared("T", spot.x, spot.y, 145)) continue;
        const dist = Math.hypot(spot.x - bot.x, spot.y - bot.y);
        if (dist <= 180 || dist >= 680) continue;

        if (bot.hasMolotov && tryPlannedThrow(bot, "MOLOTOV", 8, spot.x, spot.y, 95, 140, 3.0)) {
            return true;
        }
        if (bot.hasHE && tryPlannedThrow(bot, "HEGRENADE", 4, spot.x, spot.y, 100, 160, 2.0)) {
            return true;
        }
    }

    return false;
}

function tryCTRetakeUtility(bot) {
    if (bot.team !== "CT" || !c4State.isPlanted || !ctPincerState.breachInitiated) return false;
    if (bot === c4State.designatedDefuser) return false;

    const siteKey = c4State.plantSite === "B" ? "B" : "A";
    const portal = bot.retakeAssignment;

    // 1. Flush entrenched T post-plant pockets with Molotov or HE before swinging onto site
    if (bot.hasMolotov || bot.hasHE) {
        const pockets = (siteKey === "B" ? T_SITE_DEFENDER_POCKETS.B : T_SITE_DEFENDER_POCKETS.A)
            .slice()
            .sort((a, b) => Math.hypot(a.x - bot.x, a.y - bot.y) - Math.hypot(b.x - bot.x, b.y - bot.y));

        for (let i = 0; i < pockets.length; i++) {
            const pocket = pockets[i];
            if (isSectorRecentlyCleared("CT", pocket.x, pocket.y, 145)) continue;
            const dist = Math.hypot(pocket.x - bot.x, pocket.y - bot.y);
            if (dist < 165 || dist > 720) continue;

            if (bot.hasMolotov && tryPlannedThrow(bot, "MOLOTOV", 8, pocket.x, pocket.y, 95, 155, 3.5)) {
                return true;
            }
            if (bot.hasHE && tryPlannedThrow(bot, "HEGRENADE", 4, pocket.x, pocket.y, 100, 165, 2.2)) {
                return true;
            }
        }
    }

    // 2. Smoke off crossfire cutoffs if portal defines a cutoffSmoke (avoid blocking own retake if man-up)
    const hasManAdvantage = world.livingCT.length > world.livingT.length;
    if (bot.hasSmoke && portal?.cutoffSmoke && !hasManAdvantage) {
        const dist = Math.hypot(portal.cutoffSmoke.x - bot.x, portal.cutoffSmoke.y - bot.y);
        if (dist > 180 && dist < 780 && tryPlannedThrow(bot, "SMOKE", 5, portal.cutoffSmoke.x, portal.cutoffSmoke.y, 110, 200, 4.5)) {
            return true;
        }
    }

    // 3. Pop entry flash into site watch angles
    const flashTarget = portal ? portal.watchPos : { x: c4State.plantX, y: c4State.plantY };
    if (bot.hasFlash) {
        const dist = Math.hypot(flashTarget.x - bot.x, flashTarget.y - bot.y);
        if (dist > 180 && dist < 760 && tryPlannedThrow(bot, "FLASH", 7, flashTarget.x, flashTarget.y, 125, 280, 2.4)) {
            return true;
        }
    }

    return false;
}

const T_POTENTIAL_PEEK_SPOTS = [
    // Site A attack path potential CT peek points
    { x: 910, y: 200, site: "A", utility: "FLASH", minDist: 210, maxDist: 560 },   // A Long corner swing
    { x: 1410, y: 180, site: "A", utility: "FLASH", minDist: 220, maxDist: 600 },  // A Long pit / mid-long angle
    { x: 1750, y: 180, site: "A", utility: "SMOKE", minDist: 280, maxDist: 720 },  // A Long cross / CT ramp peek
    { x: 1715, y: 542, site: "A", utility: "FLASH", minDist: 210, maxDist: 580 },  // Extended A Short catwalk mouth
    { x: 2038, y: 542, site: "A", utility: "MOLOTOV", minDist: 210, maxDist: 560 }, // Site A Short door cubby
    { x: 2225, y: 420, site: "A", utility: "SMOKE", minDist: 260, maxDist: 700 },  // CT Ramp cutoff

    // Mid & Site B attack path potential CT peek points
    { x: 1290, y: 1080, site: "ANY", utility: "FLASH", minDist: 210, maxDist: 560 }, // Mid Doors peek
    { x: 1490, y: 1145, site: "ANY", utility: "MOLOTOV", minDist: 220, maxDist: 580 }, // Mid L-Bunker corner
    { x: 1733, y: 1420, site: "B", utility: "FLASH", minDist: 210, maxDist: 580 },  // Mid-to-Ant-Hill connector exit
    { x: 2040, y: 1561, site: "B", utility: "FLASH", minDist: 200, maxDist: 540 },  // Top Maze east exit peek
    { x: 2050, y: 1712, site: "B", utility: "FLASH", minDist: 200, maxDist: 540 },  // Mid Maze east exit peek
    { x: 2050, y: 1877, site: "B", utility: "FLASH", minDist: 200, maxDist: 540 },  // Bottom Maze east exit peek
    { x: 2310, y: 1435, site: "B", utility: "SMOKE", minDist: 260, maxDist: 720 }   // Widened B Doors CT peek
];

function tryTProactivePeekUtility(bot, roundElapsed) {
    if (bot.team !== "T" || c4State.isPlanted || bot.hasC4 || hasUsableAWP(bot)) return false;
    if (roundElapsed < 4.5) return false;
    if (!bot.hasFlash && !bot.hasSmoke && !bot.hasMolotov && !bot.hasHE) return false;

    // Defer fixed peek-point throws if the bot has a fresh acoustic cue or an active danger zone to clear
    const hasFreshCue = bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 3.5);
    const hasDangerZone = Boolean(getTacticalBlackboardThreat(bot) || getRelevantSuspiciousSpot(bot));
    if (hasFreshCue || hasDangerZone) return false;

    const targetSite = bot.assignedSite === "B" ? "B" : "A";
    const forwardDir = (bot.forwardProgressAngle !== undefined && bot.forwardProgressAngle !== null)
        ? bot.forwardProgressAngle
        : bot.angle;

    let bestSpot = null;
    let bestScore = -Infinity;

    for (let i = 0; i < T_POTENTIAL_PEEK_SPOTS.length; i++) {
        const spot = T_POTENTIAL_PEEK_SPOTS[i];
        if (spot.site !== "ANY" && spot.site !== targetSite) continue;

        const dist = Math.hypot(spot.x - bot.x, spot.y - bot.y);
        if (dist < spot.minDist || dist > spot.maxDist) continue;

        // Only throw utility at potential peek angles ahead of the bot's advance
        const angToSpot = Math.atan2(spot.y - bot.y, spot.x - bot.x);
        if (Math.abs(normalizeAngle(angToSpot - forwardDir)) > 0.95) continue;

        // Skip angles already cleared by teammates or already smoked/molotoved
        if (isSectorRecentlyCleared("T", spot.x, spot.y, 150)) continue;
        if (isInsideSmoke(spot.x, spot.y, 24)) continue;
        if (world.firePatches.some(f => f.life > 0.6 && Math.hypot(f.x - spot.x, f.y - spot.y) < f.radius + 32)) continue;

        // Never flash or molotov on top of an advancing teammate
        const allyNearSpot = world.livingT.some(m => m && m !== bot && !m.isDead && Math.hypot(m.x - spot.x, m.y - spot.y) < 230);
        if (allyNearSpot) continue;

        const score = (spot.maxDist - dist) + (spot.utility === "SMOKE" ? 40 : 20);
        if (score > bestScore) {
            bestScore = score;
            bestSpot = spot;
        }
    }

    if (!bestSpot) return false;

    if (bestSpot.utility === "SMOKE" && bot.hasSmoke &&
        tryPlannedThrow(bot, "SMOKE", 5, bestSpot.x, bestSpot.y, 120, 210, 5.0)) {
        return true;
    }
    if (bestSpot.utility === "MOLOTOV") {
        if (bot.hasMolotov && tryPlannedThrow(bot, "MOLOTOV", 8, bestSpot.x, bestSpot.y, 95, 160, 3.5)) {
            return true;
        }
        if (bot.hasHE && tryPlannedThrow(bot, "HEGRENADE", 4, bestSpot.x, bestSpot.y, 100, 170, 2.5)) {
            return true;
        }
    }
    if (bot.hasFlash && tryPlannedThrow(bot, "FLASH", 7, bestSpot.x, bestSpot.y, 130, 260, 2.2)) {
        return true;
    }

    return false;
}

function trySupportSetpieceUtility(bot) {
    if (bot.team !== "T" || c4State.isPlanted) return false;
    const isSupport = bot.archetype === "SUPPORT" || bot.id % 2 === 0;
    if (!isSupport) return false;

    if (bot.assignedSite === "A") {
        const isNearLongChoke = Math.hypot(bot.x - 910, bot.y - 200) < 170;
        if (isNearLongChoke && bot.hasSmoke && !bot.hasThrownCrossSmoke &&
            tryPlannedThrow(bot, "SMOKE", 5, 1600, 180, 115, 220, 5.0)) {
            bot.hasThrownCrossSmoke = true;
            return true;
        }
        if (isNearLongChoke && bot.hasFlash && !bot.hasThrownLongFlash &&
            tryPlannedThrow(bot, "FLASH", 7, 2050, 135, 130, 280, 2.2)) {
            bot.hasThrownLongFlash = true;
            return true;
        }
    }

    if (bot.assignedSite === "B") {
        const isNearTunnelChoke = Math.hypot(bot.x - 1350, bot.y - 1520) < 180 ||
            Math.hypot(bot.x - 1733, bot.y - 1420) < 180;
        if (isNearTunnelChoke && bot.hasSmoke &&
            tryPlannedThrow(bot, "SMOKE", 5, 2310, 1435, 115, 220, 5.0)) {
            return true;
        }
    }

    return false;
}

export function trySmokeDefuse(bot) {
    if (bot.team !== "CT" || !bot.hasSmoke || !c4State.isPlanted) return false;
    if (bot !== c4State.designatedDefuser) return false;

    const distToBomb = Math.hypot(c4State.plantX - bot.x, c4State.plantY - bot.y);
    if (distToBomb <= 140) {
        return tryPlannedThrow(bot, "SMOKE", 5, c4State.plantX, c4State.plantY, 65, 160, 5.0);
    }
    return false;
}

function tryExtinguishFireChoke(bot) {
    if (!bot || !bot.hasSmoke || world.firePatches.length === 0) return false;

    const isUrgentObjective = c4State.isPlanted || matchState.roundTimer <= 28;
    if (!isUrgentObjective) return false;

    for (const fire of world.firePatches) {
        if (fire.life <= 1.5) continue;

        const isFriendlyFire = (fire.owner && fire.owner.team === bot.team) || fire.team === bot.team;
        if (isFriendlyFire) continue;

        const distToFire = Math.hypot(fire.x - bot.x, fire.y - bot.y);
        if (distToFire < 90 || distToFire > 650) continue;

        let isBlockingPath = false;
        if (bot.currentPath && bot.currentPath.length > 0) {
            isBlockingPath = bot.currentPath.slice(0, 3).some(pt =>
                pt && Math.hypot(pt.x - fire.x, pt.y - fire.y) < (fire.radius + 40)
            );
        }

        if (!isBlockingPath) {
            const angleToFire = Math.atan2(fire.y - bot.y, fire.x - bot.x);
            const angleDiff = Math.abs(normalizeAngle(angleToFire - bot.angle));
            if (angleDiff < Math.PI * 0.35 && distToFire < (fire.radius + 180)) {
                isBlockingPath = true;
            }
        }

        if (isBlockingPath) {
            const isDangerous = !canBotSafelyTraverseFire(bot, fire, bot.x, bot.y, fire.x, fire.y);
            if (isDangerous && tryPlannedThrow(bot, "SMOKE", 5, fire.x, fire.y, 100, 180, 4.0)) {
                return true;
            }
        }
    }
    return false;
}

export function tryPostPlantDenial(bot) {
    if (bot.team !== "T" || !c4State.isPlanted || (!bot.hasMolotov && !bot.hasHE)) return false;

    if (!c4State.isBeingDefused) {
        bot.defuseDenialWaitStart = 0;
        return false;
    }

    if (!bot.defuseDenialWaitStart) {
        bot.defuseDenialWaitStart = world.gameTime;
    }

    // Hold utility for 0.65s so 0.45s tap-fakes don't bait out grenades unless the defuse clock is urgent
    const heardDuration = world.gameTime - bot.defuseDenialWaitStart;
    const isUrgentTimer = c4State.timer <= 11.5;
    if (heardDuration < 0.65 && !isUrgentTimer) {
        return false;
    }

    const distToBomb = Math.hypot(c4State.plantX - bot.x, c4State.plantY - bot.y);
    if (distToBomb <= 180 || distToBomb >= 720) return false;

    const bombInSmoke = isInsideSmoke(c4State.plantX, c4State.plantY, 22);

    // If the bomb is smoked, Molotovs get extinguished—prioritize HE Grenade splash damage instead
    if (bombInSmoke) {
        if (bot.hasHE && tryPlannedThrow(bot, "HEGRENADE", 4, c4State.plantX, c4State.plantY, 95, 140, 2.2)) {
            return true;
        }
        return false;
    }

    // Open bomb: Molotov denies for several seconds if enough bomb timer remains; HE finishes fast
    if (c4State.timer > 6.5 && bot.hasMolotov &&
        tryPlannedThrow(bot, "MOLOTOV", 8, c4State.plantX, c4State.plantY, 90, 140, 3.2)) {
        return true;
    }
    if (bot.hasHE && tryPlannedThrow(bot, "HEGRENADE", 4, c4State.plantX, c4State.plantY, 95, 140, 2.2)) {
        return true;
    }

    return false;
}

function tryProactiveAWPDangerSmoke(bot, roundElapsed) {
    if (!bot || bot.isDead || !bot.hasSmoke || c4State.isPlanted) return false;
    if (hasUsableAWP(bot) || isNearSpawn(bot.x, bot.y)) return false;

    const dangerList = world.awpDangerMemory?.[bot.team];
    if (!dangerList || dangerList.length === 0) return false;

    const dueSpots = dangerList
        .filter(spot => {
            if (!spot || spot.smokedThisRound) return false;
            if ((spot.roundRoll ?? 0) >= (spot.smokeChance ?? 0)) return false;

            // Throw ~4s before the recorded death time so the smoke blooms before teammates cross
            const triggerStart = Math.max(2.0, spot.roundElapsed - 4.0);
            const triggerEnd = spot.roundElapsed + 10.0;
            if (roundElapsed < triggerStart || roundElapsed > triggerEnd) return false;

            if (isSectorRecentlyCleared(bot.team, spot.awpX, spot.awpY, 130)) return false;
            const distToSmoke = Math.hypot(spot.smokeX - bot.x, spot.smokeY - bot.y);
            return distToSmoke >= 150 && distToSmoke <= 950;
        })
        .sort((a, b) => Math.hypot(a.smokeX - bot.x, a.smokeY - bot.y) - Math.hypot(b.smokeX - bot.x, b.smokeY - bot.y));

    for (let i = 0; i < dueSpots.length; i++) {
        const spot = dueSpots[i];
        if (tryPlannedThrow(bot, "SMOKE", 5, spot.smokeX, spot.smokeY, 145, 210, 6.0) ||
            tryPlannedThrow(bot, "SMOKE", 5, spot.victimX, spot.victimY, 145, 210, 6.0)) {
            spot.smokedThisRound = true;
            return true;
        }
    }

    return false;
}

export function tryExecuteTacticalUtility(bot, dt, closestEnemy) {
    if (bot.pendingUtilityThrow) return false;
    if ((bot.blindTimer || 0) > 0.65) return false;
    if (isNearSpawn(bot.x, bot.y)) return false;
    if (bot.team === "T" && bot.hasC4 && !c4State.isPlanted) return false;
    if (world.gameTime - (bot.lastUtilityThrowTime || -99) < 1.65) return false;
    if (!bot.hasSmoke && !bot.hasHE && !bot.hasFlash && !bot.hasMolotov) return false;

    const roundElapsed = 115 - matchState.roundTimer;
    const fastExecute = bot.team === "T" && isTFastExecuteActive(bot.assignedSite || "A");
    const deducedAWP = getDeducedAWPTarget(bot.team, bot.x, bot.y, 1650);

    if (deducedAWP && tryCounterAWPUtility(bot, deducedAWP, true)) {
        return true;
    }

    if (tryProactiveAWPDangerSmoke(bot, roundElapsed)) {
        return true;
    }

    if (bot.team === "T" && !c4State.isPlanted && !fastExecute && roundElapsed < 11.5 && bot.x < 920 && !closestEnemy) {
        return false;
    }

    if (!closestEnemy && bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 2.2)) {
        const sDist = Math.hypot(bot.lastHeardSound.x - bot.x, bot.lastHeardSound.y - bot.y);
        const sAng = Math.atan2(bot.lastHeardSound.y - bot.y, bot.lastHeardSound.x - bot.x);
        if (sDist <= 450 && Math.abs(normalizeAngle(sAng - bot.angle)) > (85 * Math.PI / 180)) {
            return false;
        }
    }

    if (bot.team === "T" && !c4State.isPlanted && !fastExecute && roundElapsed < 11.5 && bot.x < 920 && !closestEnemy) {
        return false;
    }

    if (trySmokeDefuse(bot)) return true;
    if (tryExtinguishFireChoke(bot)) return true;
    if (tryPostPlantDenial(bot)) return true;

    if (bot.health < 35 && closestEnemy && bot.hasSmoke) {
        const midX = (bot.x + closestEnemy.x) * 0.5;
        const midY = (bot.y + closestEnemy.y) * 0.5;
        if (tryPlannedThrow(bot, "SMOKE", 5, midX, midY, 110, 180, 4.0)) {
            return true;
        }
    }

    if (tryFastExecuteUtilityDump(bot)) return true;

    // Tiered Cover & Open-Space Utility Discipline
    const exposingThreat = !fastExecute ? getExposingThreatForUtility(bot, closestEnemy) : null;
    if (exposingThreat) {
        const hasLiveShooter = Boolean(closestEnemy && !closestEnemy.isDead);

        // 1. Suspected threat only (no live enemy in sight yet): throw immediately from current position
        if (!hasLiveShooter) {
            if (tryCTRetakeUtility(bot)) return true;
            if (tryFlushSuspiciousSpot(bot)) return true;
            if (tryTBombsiteExecuteMolotov(bot)) return true;
            if (trySupportSetpieceUtility(bot)) return true;
            if (tryTProactivePeekUtility(bot, roundElapsed)) return true;
            if (tryCTChokeDenial(bot, roundElapsed)) return true;
            if (tryTBreachUtility(bot)) return true;
            return false;
        }

        // 2. Live shooter visible: tuck behind nearby wall cover first if it actually breaks LOS
        const coverPt = findTacticalCover(bot, exposingThreat.x, exposingThreat.y);
        const hasRealWallCover = Math.hypot(coverPt.x - bot.x, coverPt.y - bot.y) > 16 &&
            !checkWallCollision(coverPt.x, coverPt.y, bot.radius) &&
            !getLineOfSight(coverPt.x, coverPt.y, exposingThreat.x, exposingThreat.y);

        if (hasRealWallCover) {
            bot.utilityCoverRetreat = {
                x: coverPt.x,
                y: coverPt.y,
                threatX: exposingThreat.x,
                threatY: exposingThreat.y,
                expiresAt: world.gameTime + 1.1
            };
            return false;
        }

        // 3. Truly open area (no cover nearby): allow Smoke/Flash to create space (>= 265px so close-combat abort won't cancel),
        //    but block slow Molotov/HE throws so the bot fights back with its gun
        const liveDist = Math.hypot(closestEnemy.x - bot.x, closestEnemy.y - bot.y);
        if (liveDist >= 265) {
            if (bot.hasSmoke && liveDist <= 850) {
                const screenX = (bot.x + closestEnemy.x) * 0.5;
                const screenY = (bot.y + closestEnemy.y) * 0.5;
                if (tryPlannedThrow(bot, "SMOKE", 5, screenX, screenY, 120, 200, 4.5)) {
                    return true;
                }
            }
            if (bot.hasFlash && liveDist <= 750) {
                if (tryPlannedThrow(bot, "FLASH", 7, closestEnemy.x, closestEnemy.y, 135, 250, 2.2)) {
                    return true;
                }
            }
        }
        return false;
    }

    if (tryCTRetakeUtility(bot)) return true;
    // Dynamic danger zones & site execute denials always outrank static fixed-point throws
    if (tryFlushSuspiciousSpot(bot)) return true;
    if (tryTBombsiteExecuteMolotov(bot)) return true;
    if (trySupportSetpieceUtility(bot)) return true;
    if (tryTProactivePeekUtility(bot, roundElapsed)) return true;
    if (tryCTChokeDenial(bot, roundElapsed)) return true;
    if (tryTBreachUtility(bot)) return true;

    if (closestEnemy || (bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 3.5))) {
        const isAWP = hasUsableAWP(bot);
        const rawThreatX = closestEnemy ? closestEnemy.x : bot.lastHeardSound.x;
        const rawThreatY = closestEnemy ? closestEnemy.y : bot.lastHeardSound.y;
        const soundType = bot.lastHeardSound?.type;

        if (isAWP && closestEnemy && getMapLineOfSight(bot.x, bot.y, closestEnemy.x, closestEnemy.y)) {
            return false;
        }

        let aimX = rawThreatX;
        let aimY = rawThreatY;
        const hasDirectSight = hasClearThrowTrajectory(bot.x, bot.y, rawThreatX, rawThreatY);

        if (isAWP && hasDirectSight) return false;

        if (!hasDirectSight) {
            // Never blind-throw grenades at muffled footsteps behind walls
            if (!closestEnemy && (soundType === "footstep" || soundType === "ripple")) {
                return false;
            }
            const cornerTarget = getCornerTossTarget(bot, rawThreatX, rawThreatY);
            if (cornerTarget) {
                aimX = cornerTarget.x;
                aimY = cornerTarget.y;
            } else {
                return false;
            }
        }

        const threatDist = Math.hypot(aimX - bot.x, aimY - bot.y);
        if (bot.team === "T" && !c4State.isPlanted && roundElapsed < 11.5 && aimX < 920 && !closestEnemy) {
            return false;
        }

        const teammates = bot.team === "CT" ? world.livingCT : world.livingT;
        if (teammates.some(t => Math.hypot(t.x - aimX, t.y - aimY) < 170)) return false;

        const targetWounded = closestEnemy && closestEnemy.health <= 40;
        const targetIsReloading = closestEnemy && closestEnemy.isReloading;
        const isSniperThreat = closestEnemy && (closestEnemy.getEquippedKey() === "AWP" || closestEnemy.getWeapon().category === "sniper");
        const inCornerCover = !hasDirectSight;
        const soundAge = bot.lastHeardSound ? (world.gameTime - bot.lastHeardSound.time) : 999;
        const isRushingFootsteps = bot.lastHeardSound && bot.lastHeardSound.type === "footstep" && soundAge < 1.2;

        const livingEnemies = bot.team === "CT" ? world.livingT : world.livingCT;
        const isClusterTarget = livingEnemies.filter(e => Math.hypot(e.x - aimX, e.y - aimY) < 220).length >= 2;
        const matePlantingNearby = teammates.some(e => e.executePhase === "PLANT_LOCK" && Math.hypot(e.x - bot.x, e.y - bot.y) < 300);

        const utilityWeights = [];

        if (bot.hasMolotov && (inCornerCover || matePlantingNearby) && threatDist > 180 && threatDist < 600) {
            let score = 45;
            if (inCornerCover) score += 65;
            if (matePlantingNearby) score += 70;
            if (isSniperThreat && inCornerCover) score += 45;
            utilityWeights.push({ type: "MOLOTOV", slot: 8, score, maxErr: 95, claimRad: 190, dur: 2.5 });
        }

        if (bot.hasHE && threatDist > 150 && threatDist < 750) {
            let score = 35;
            if (isClusterTarget) score += 80;
            if (targetWounded && inCornerCover) score += 75;
            else if (targetWounded) score += 50;
            if (targetIsReloading) score += 60;
            if (isRushingFootsteps && threatDist < 500) score += 45;
            utilityWeights.push({ type: "HEGRENADE", slot: 4, score, maxErr: 100, claimRad: 190, dur: 2.5 });
        }

        const isFlashSafeDist = !hasDirectSight || threatDist >= 260;
        if (bot.hasFlash && threatDist > 160 && threatDist < 750 && isFlashSafeDist) {
            let score = 30;
            if (inCornerCover && threatDist < 420) score += 65;
            if (isSniperThreat && hasDirectSight && threatDist > 320) score += 75;
            if (bot.health < 40 && closestEnemy && hasDirectSight) score += 60;
            if (hasDirectSight && threatDist > 280 && threatDist < 550) score += 45;
            utilityWeights.push({ type: "FLASH", slot: 7, score, maxErr: 120, claimRad: 220, dur: 2.2 });
        }

        if (!isAWP && bot.hasSmoke && threatDist > 200 && threatDist < 850) {
            let score = 35;
            if (hasDirectSight && threatDist > 260) score += 45;
            if (isSniperThreat && threatDist > 360 && hasDirectSight) score += 80;
            if (bot.health < 35 && closestEnemy) score += 70;
            if (c4State.isPlanted && bot.team === "T" && hasDirectSight) score += 55;
            if (isRushingFootsteps && threatDist > 240) score += 65;
            utilityWeights.push({ type: "SMOKE", slot: 5, score, maxErr: 110, claimRad: 210, dur: 4.5 });
        }

        if (utilityWeights.length > 0) {
            utilityWeights.sort((a, b) => b.score - a.score);
            const chosen = utilityWeights[0];
            const realThreat = !hasDirectSight ? { x: rawThreatX, y: rawThreatY } : null;
            if (chosen.score >= 45 && tryPlannedThrow(bot, chosen.type, chosen.slot, aimX, aimY, chosen.maxErr, chosen.claimRad, chosen.dur, realThreat)) {
                return true;
            }
        }
    }

    return false;
}

/* ==========================================================================
   ADAPTIVE T-SIDE ROTATION ENGINE
   ========================================================================== */
function isPointInTacticalSector(x, y, sectorKey) {
    if (sectorKey === "A") return x >= 1350 && y <= 660;
    if (sectorKey === "B") return x >= 1550 && y >= 1320;
    if (sectorKey === "MID") return x >= 1050 && x <= 1850 && y > 660 && y < 1320;
    return false;
}

function countDistinctCTPresence(sectorKey) {
    const clusters = [];
    const addCue = (x, y) => {
        if (!isPointInTacticalSector(x, y, sectorKey)) return;
        if (!clusters.some(c => Math.hypot(c.x - x, c.y - y) < 115)) {
            clusters.push({ x, y });
        }
    };

    // 1. Visual intel from T teammates
    for (const id in world.sharedEnemyIntelT) {
        const intel = world.sharedEnemyIntelT[id];
        if (intel && intel.enemy && !intel.enemy.isDead && (world.gameTime - intel.time <= 5.5)) {
            addCue(intel.x, intel.y);
        }
    }

    // 2. Footstep & gunfire cues heard by any living T
    const aliveTs = world.livingT.filter(t => t && !t.isDead);
    for (let i = 0; i < aliveTs.length; i++) {
        const s = aliveTs[i].lastHeardSound;
        if (s && (!s.shooter || (!s.shooter.isDead && s.shooter.team === "CT")) && (world.gameTime - s.time <= 5.0)) {
            addCue(s.x, s.y);
        }
    }

    // 3. Global acoustic events (CT footsteps / shots near T chokes)
    for (let i = 0; i < world.recentAcousticEvents.length; i++) {
        const ev = world.recentAcousticEvents[i];
        if (ev && ev.team === "CT" && (world.gameTime - ev.time <= 3.5)) {
            addCue(ev.x, ev.y);
        }
    }

    return clusters.length;
}

function hasCTDefensiveUtilityAtSite(siteKey) {
    const smokesAtSite = world.smokeClouds.some(c =>
        c.life > 1.5 && c.owner?.team === "CT" && isPointInTacticalSector(c.x, c.y, siteKey)
    );
    const firesAtSite = world.firePatches.some(f =>
        f.life > 1.2 && (f.owner?.team === "CT" || f.team === "CT") && isPointInTacticalSector(f.x, f.y, siteKey)
    );
    return smokesAtSite || firesAtSite;
}

export function evaluateAdaptiveTStrategy() {
    if (c4State.isPlanted || matchState.roundPhase !== "COMBAT") return;
    if (world.livingT.length === 0) return;

    const isSoloT = world.livingT.length === 1;
    const isClockUrgent = matchState.roundTimer <= 20.0;

    // Trigger immediate 20s-intel site commit when 1 T is left OR when <= 20s remain on the clock (regardless of team count)
    if (isSoloT || isClockUrgent) {
        const aliveTBots = world.bots.filter(b => b && !b.isDead && b.team === "T");
        const needsCommit = aliveTBots.some(b =>
            (isSoloT && !b.soloClutchCommitted) ||
            (isClockUrgent && !b.soloClockUrgentTriggered)
        );

        if (needsCommit && aliveTBots.length > 0) {
            const refT = (c4State.carrier && !c4State.carrier.isDead) ? c4State.carrier : aliveTBots[0];
            const clutchPlan = evaluateSoloClutchSiteChoice(refT, 20.0);

            pincerState.breachInitiated = true;
            const chosenKey = clutchPlan?.stratKey || world.currentTStrategyKey;
            const chosenStrat = T_STRATEGIES[chosenKey] || T_STRATEGIES[world.currentTStrategyKey];

            if (chosenStrat) {
                world.currentTStrategyKey = chosenKey;
                world.lastTRotationTime = world.gameTime;

                aliveTBots.forEach(bot => {
                    if (isSoloT) bot.soloClutchCommitted = true;
                    if (isClockUrgent) bot.soloClockUrgentTriggered = true;

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
                    const entryPt = route[bot.planIndex];
                    bot.currentPath = entryPt ? findGridPath(bot.x, bot.y, entryPt.x, entryPt.y, bot) : [];
                });

                const title = isSoloT ? "SOLO CLUTCH EXECUTE" : "FINAL 20S EXECUTE";
                const reason = isClockUrgent
                    ? `20S LEFT — ALL TERRORISTS PUSHING SITE ${chosenStrat.targetSite}!`
                    : `LAST ALIVE (20S INTEL) — ATTACKING SITE ${chosenStrat.targetSite}`;
                showAnnouncerBanner(title, reason, "T");
                audio.announce(`Attacking site ${chosenStrat.targetSite}`, "T");
            }
        }
        return;
    }

    if (c4State.isDropped) return;

    const roundElapsed = 115 - matchState.roundTimer;
    if (roundElapsed < 6.5) return;
    if (world.gameTime - world.lastTRotationTime < T_ROTATION_COOLDOWN) return;

    const currentStrat = T_STRATEGIES[world.currentTStrategyKey];
    const currentTargetSite = currentStrat ? currentStrat.targetSite : "A";
    const oppositeSite = currentTargetSite === "A" ? "B" : "A";

    if (isTSquadOccupyingSite(currentTargetSite) || isTSquadOccupyingSite()) {
        return;
    }

    const ctAtTarget = countDistinctCTPresence(currentTargetSite);
    const ctAtOpposite = countDistinctCTPresence(oppositeSite);
    const ctAtMid = countDistinctCTPresence("MID");
    const ctDumpedUtilAtTarget = hasCTDefensiveUtilityAtSite(currentTargetSite);

    const aliveTs = world.livingT.filter(t => t && !t.isDead);
    const tsNearTarget = aliveTs.filter(t =>
        isPointInTacticalSector(t.x, t.y, currentTargetSite) ||
        Math.hypot(
            (currentTargetSite === "A" ? MAP.siteA.safeSpot.x : MAP.siteB.safeSpot.x) - t.x,
            (currentTargetSite === "A" ? MAP.siteA.safeSpot.y : MAP.siteB.safeSpot.y) - t.y
        ) < 760
    ).length;

    const recentTCasualtiesNearChoke = world.corpses.filter(c =>
        c.team === "T" && isPointInTacticalSector(c.x, c.y, currentTargetSite)
    ).length;

    // Outnumbered check via footsteps, gunfire, visual intel, or baited CT defensive utility
    const outnumberedAtChoke = ctAtTarget >= 2 && (ctAtTarget > Math.max(1, tsNearTarget) || ctAtTarget >= 3);
    const baitedCTUtility = ctDumpedUtilAtTarget && ctAtTarget >= 1 && ctAtOpposite <= 1 && roundElapsed >= 7.5;
    const stalledWithCasualties = recentTCasualtiesNearChoke >= 2;

    let shouldRotate = false;
    let pivotReason = "OUTNUMBERED AT CHOKE";
    let newStratKey = world.currentTStrategyKey;

    const pickCleanStrat = (candidates) => {
        const valid = candidates.filter(k => T_STRATEGIES[k] && k !== world.currentTStrategyKey);
        if (valid.length === 0) return world.currentTStrategyKey;

        // Prefer routes free of active CT fire, smoke, or recent T deaths
        const clean = valid.filter(k => {
            const route = T_STRATEGIES[k].carrierRoute || [];
            const hasFire = route.some(pt => world.firePatches.some(f => f.life > 0.6 && Math.hypot(pt.x - f.x, pt.y - f.y) < f.radius + 32));
            const hasDeath = route.some(pt => (world.tacticalIntel?.deathZones?.T || []).some(dz => !dz.cleared && world.gameTime < dz.expiresAt && Math.hypot(pt.x - dz.x, pt.y - dz.y) < 120));
            return !hasFire && !hasDeath;
        });
        const pool = clean.length > 0 ? clean : valid;
        return pool[Math.floor(rnd() * pool.length)];
    };

    if ((outnumberedAtChoke || baitedCTUtility || stalledWithCasualties) && ctAtOpposite <= ctTarget) {
        shouldRotate = true;
        if (baitedCTUtility && !outnumberedAtChoke) pivotReason = "CT UTILITY BAITED";

        if (currentTargetSite === "A") {
            newStratKey = (ctAtMid === 0)
                ? pickCleanStrat(["MAZE_TOP_LANE_RUSH", "MAZE_MID_LANE_RUSH", "MAZE_BOTTOM_LANE_RUSH", "SPLIT_B_MID", "MID_TO_B_DOORS"])
                : pickCleanStrat(["MAZE_TOP_LANE_RUSH", "MAZE_MID_LANE_RUSH", "MAZE_BOTTOM_LANE_RUSH", "MAZE_TOP_BOTTOM_PINCER", "MAZE_MID_BOTTOM_PINCER"]);
        } else {
            newStratKey = (ctAtMid === 0)
                ? pickCleanStrat(["SPLIT_MID_CATWALK_A_SHORT", "GARDEN_A_SHORT", "SPLIT_A_LONG_GAP_SHORT", "DIRECT_A_LONG"])
                : pickCleanStrat(["GARDEN_A_SHORT", "SPLIT_A_LONG_GAP_SHORT", "A_SHORT_GAP_WRAP_LONG", "DIRECT_A_LONG"]);
        }
    } else if (c4State.carrier && roundElapsed >= 20.0) {
        const carrier = c4State.carrier;
        const distToA = Math.hypot(MAP.siteA.x - carrier.x, MAP.siteA.y - carrier.y);
        const distToB = Math.hypot(MAP.siteB.x - carrier.x, MAP.siteB.y - carrier.y);

        if (currentTargetSite === "A" && distToB < distToA - 550 && ctAtOpposite <= 1) {
            shouldRotate = true;
            pivotReason = "CARRIER FLANK OPPORTUNITY";
            newStratKey = pickCleanStrat(["MAZE_TOP_LANE_RUSH", "MAZE_MID_LANE_RUSH", "MAZE_BOTTOM_LANE_RUSH", "MID_TO_B_DOORS"]);
        } else if (currentTargetSite === "B" && distToA < distToB - 550 && ctAtOpposite <= 1) {
            shouldRotate = true;
            pivotReason = "CARRIER FLANK OPPORTUNITY";
            newStratKey = pickCleanStrat(["GARDEN_A_SHORT", "SPLIT_A", "DIRECT_A_LONG"]);
        }
    }

    if ((outnumberedAtChoke || baitedCTUtility || stalledWithCasualties) && ctAtOpposite <= ctAtTarget) {
        shouldRotate = true;
        if (baitedCTUtility && !outnumberedAtChoke) pivotReason = "CT UTILITY BAITED";

        if (currentTargetSite === "A") {
            newStratKey = (ctAtMid === 0)
                ? pickCleanStrat(["MAZE_BOTTOM_LANE_RUSH", "SPLIT_B_MID", "MAZE_MID_BOTTOM_PINCER", "MID_TO_B_DOORS"])
                : pickCleanStrat(["MAZE_BOTTOM_LANE_RUSH", "MAZE_MID_BOTTOM_PINCER", "MAZE_TOP_BOTTOM_PINCER", "MAZE_MID_LANE_RUSH"]);
        } else {
            newStratKey = (ctAtMid === 0)
                ? pickCleanStrat(["SPLIT_MID_CATWALK_A_SHORT", "GARDEN_A_SHORT", "SPLIT_A_LONG_GAP_SHORT", "DIRECT_A_LONG"])
                : pickCleanStrat(["GARDEN_A_SHORT", "SPLIT_A_LONG_GAP_SHORT", "A_SHORT_GAP_WRAP_LONG", "DIRECT_A_LONG"]);
        }
    } else if (c4State.carrier && roundElapsed >= 20.0) {
        const carrier = c4State.carrier;
        const distToA = Math.hypot(MAP.siteA.x - carrier.x, MAP.siteA.y - carrier.y);
        const distToB = Math.hypot(MAP.siteB.x - carrier.x, MAP.siteB.y - carrier.y);

        if (currentTargetSite === "A" && distToB < distToA - 550 && ctAtOpposite <= 1) {
            shouldRotate = true;
            pivotReason = "CARRIER FLANK OPPORTUNITY";
            newStratKey = pickCleanStrat(["MAZE_BOTTOM_LANE_RUSH", "MAZE_MID_BOTTOM_PINCER", "MAZE_MID_LANE_RUSH", "MID_TO_B_DOORS"]);
        } else if (currentTargetSite === "B" && distToA < distToB - 550 && ctAtOpposite <= 1) {
            shouldRotate = true;
            pivotReason = "CARRIER FLANK OPPORTUNITY";
            newStratKey = pickCleanStrat(["GARDEN_A_SHORT", "SPLIT_A", "DIRECT_A_LONG"]);
        }
    }

    if (shouldRotate && newStratKey !== world.currentTStrategyKey && T_STRATEGIES[newStratKey]) {
        executeTRotation(newStratKey, pivotReason);
    }
}

export function executeTRotation(newStratKey, reasonLabel = "DEFENSE DETECTED") {
    if (isTSquadOccupyingSite()) return;
    world.currentTStrategyKey = newStratKey;
    const nextStrat = T_STRATEGIES[newStratKey];
    if (!nextStrat) return;

    world.lastTRotationTime = world.gameTime;

    pincerState.alphaStaged = false;
    pincerState.bravoStaged = false;
    pincerState.breachInitiated = false;
    pincerState.stagingTimer = 0;

    const aliveTBots = world.bots.filter(b => b && !b.isDead && b.team === "T");
    aliveTBots.forEach(bot => {
        bot.assignedSite = nextStrat.targetSite;
        bot.executePhase = "BREACH";
        bot.siteObjectiveLock = true;
        bot.customMazeRoute = null;
        bot.customALaneRoute = null;
        bot.tAttackPeekState = null;

        const useCarrierRoute = bot.hasC4 || bot.squadGroup === "ALPHA" || !nextStrat.isSplit;
        const newRoute = useCarrierRoute ? nextStrat.carrierRoute : nextStrat.supportRoute;

        bot.planIndex = getClosestRouteIndex(bot.x, bot.y, newRoute);
        bot.maxPlanIndex = bot.planIndex;
        bot.isFollowingPlanRoute = true;

        const targetEntryPt = newRoute[bot.planIndex];
        bot.currentPath = targetEntryPt ? findGridPath(bot.x, bot.y, targetEntryPt.x, targetEntryPt.y, bot) : [];
    });

    showAnnouncerBanner("TACTICAL PIVOT", `${reasonLabel} — PIVOTING TO BOMBSITE ${nextStrat.targetSite}!`, "T");
    audio.announce(`Rotating to site ${nextStrat.targetSite}`, "T");
}

export function deployAntiAWPFlash(bot, threatX, threatY) {
    if (!bot.hasFlash) return false;
    return tryPlannedThrow(bot, "FLASH", 7, threatX, threatY, 135, 260, 2.4);
}

export function tryCounterAWPUtility(bot, awpPos, isSelfProtection = false) {
    if (!bot || bot.isDead || !awpPos || bot.pendingUtilityThrow) return false;
    if (isNearSpawn(bot.x, bot.y)) return false;
    if (bot.team === "T" && bot.hasC4 && !c4State.isPlanted && !bot.hasSmoke) return false;
    if (bot.getEquippedKey() === "AWP") return false;
    if (world.gameTime - (bot.lastUtilityThrowTime || 0) < 1.0) return false;
    if (!bot.hasFlash && !bot.hasMolotov && !bot.hasHE && !bot.hasSmoke) return false;

    const dist = Math.hypot(awpPos.x - bot.x, awpPos.y - bot.y);
    const maxAWPRange = bot.hasSmoke ? 1650 : 850;
    if (dist < 140 || dist > maxAWPRange) return false;

    const hasDirectLOS = getMapLineOfSight(bot.x, bot.y, awpPos.x, awpPos.y);
    const canThrowImmediateScreenOrBlind = bot.hasSmoke || (bot.hasFlash && dist >= 220 && dist <= 850);

    // Only step into cover first pre-plant if exposed in direct LOS without an immediate smoke or flashbang
    if (!c4State.isPlanted && hasDirectLOS && !canThrowImmediateScreenOrBlind && !isSelfProtection && !isInsideSmoke(bot.x, bot.y, 12)) {
        const coverPt = findTacticalCover(bot, awpPos.x, awpPos.y);
        if (Math.hypot(coverPt.x - bot.x, coverPt.y - bot.y) > 16 && !checkWallCollision(coverPt.x, coverPt.y, bot.radius)) {
            bot.utilityCoverRetreat = {
                x: coverPt.x,
                y: coverPt.y,
                threatX: awpPos.x,
                threatY: awpPos.y,
                expiresAt: world.gameTime + 1.1
            };
            return false;
        }
    }

    const teammates = bot.team === "CT" ? world.livingCT : world.livingT;
    const allyNearNest = teammates.some(m => m && !m.isDead && Math.hypot(m.x - awpPos.x, m.y - awpPos.y) < 155);
    const pinchAlliesMovingIn = teammates.some(m =>
        m && m !== bot && !m.isDead && m.tacticalOrder?.isAntiAWP && m.tacticalOrder?.role === "FLANK_PINCH"
    );
    const pinchEval = evaluateAWPNestPinchability(awpPos.x, awpPos.y);
    const awperWounded = typeof awpPos.health === "number" && awpPos.health <= 55;

    const candidates = [];

    // 1. Molotov: forces AWPer out of their nest/corner for several seconds
    if (bot.hasMolotov && !allyNearNest && dist >= 170 && dist <= 680) {
        const plan = solveBotUtilityThrow(bot, "MOLOTOV", awpPos.x, awpPos.y, 105);
        if (plan && !isUtilityTargetClaimed(bot.team, awpPos.x, awpPos.y, "MOLOTOV", 160)) {
            let score = !hasDirectLOS ? 108 : 88;
            if (pinchAlliesMovingIn) score += 18;
            if (!pinchEval.isOpenMultiAngle) score += 10;
            candidates.push({ type: "MOLOTOV", slot: 8, plan, claimX: awpPos.x, claimY: awpPos.y, claimRad: 160, dur: 4.0, score });
        }
    }

    // 2. Flashbang: blinds scoped AWPer in direct LOS or before a swing
    if (bot.hasFlash && dist >= 220 && dist <= 850) {
        const plan = solveBotUtilityThrow(bot, "FLASH", awpPos.x, awpPos.y, 135);
        if (plan && !isUtilityTargetClaimed(bot.team, awpPos.x, awpPos.y, "FLASH", 260)) {
            let score = hasDirectLOS ? 102 : 84;
            if (pinchAlliesMovingIn || isSelfProtection || c4State.isPlanted) score += 28;
            candidates.push({ type: "FLASH", slot: 7, plan, claimX: awpPos.x, claimY: awpPos.y, claimRad: 260, dur: 2.4, score });
        }
    }

    // 3. HE Grenade: damages/tags AWPer behind cover or finishes a wounded AWPer
    if (bot.hasHE && !allyNearNest && dist >= 160 && dist <= 750) {
        const plan = solveBotUtilityThrow(bot, "HEGRENADE", awpPos.x, awpPos.y, 110);
        if (plan && !isUtilityTargetClaimed(bot.team, awpPos.x, awpPos.y, "HEGRENADE", 165)) {
            let score = !hasDirectLOS ? 96 : 76;
            if (awperWounded) score += 26;
            if (pinchAlliesMovingIn) score += 12;
            candidates.push({ type: "HEGRENADE", slot: 4, plan, claimX: awpPos.x, claimY: awpPos.y, claimRad: 165, dur: 2.5, score });
        }
    }

    // 4. Smoke: screens long-range AWP lanes, tight chokes, or post-plant retake crossings
    if (bot.hasSmoke && dist >= 160 && dist <= 1650) {
        const crossAnchor = (bot.currentPath && bot.currentPath.length > 0 && !getMapLineOfSight(bot.x, bot.y, awpPos.x, awpPos.y))
            ? bot.currentPath[0]
            : { x: bot.x, y: bot.y };
        const laneDist = Math.hypot(crossAnchor.x - awpPos.x, crossAnchor.y - awpPos.y);
        const fromAWPAng = Math.atan2(crossAnchor.y - awpPos.y, crossAnchor.x - awpPos.x);
        const smokeTarget = laneDist > 420
            ? { x: awpPos.x + Math.cos(fromAWPAng) * Math.min(laneDist * 0.55, 360), y: awpPos.y + Math.sin(fromAWPAng) * Math.min(laneDist * 0.55, 360) }
            : { x: awpPos.x, y: awpPos.y };
        const plan = solveBotUtilityThrow(bot, "SMOKE", smokeTarget.x, smokeTarget.y, 165);
        if (plan && !isUtilityTargetClaimed(bot.team, smokeTarget.x, smokeTarget.y, "SMOKE", 210)) {
            let score = (dist > 680 || !pinchEval.isOpenMultiAngle) ? 115 : (hasDirectLOS ? 94 : 74);
            if (c4State.isPlanted) score += 32;
            candidates.push({ type: "SMOKE", slot: 5, plan, claimX: smokeTarget.x, claimY: smokeTarget.y, claimRad: 210, dur: 4.5, score });
        }
    }

    if (candidates.length === 0) return false;
    candidates.sort((a, b) => b.score - a.score);
    const chosen = candidates[0];

    claimUtilityTarget(bot.team, chosen.claimX, chosen.claimY, chosen.type, chosen.dur);
    executeBotGrenadeThrow(bot, chosen.slot, chosen.plan.aimX, chosen.plan.aimY, chosen.plan.isExtended);
    return true;
}

export function updatePatrolVision(bot, baseAngle, dt) {
    bot.patrolBaseAngle = baseAngle;
    const isPostPlantT = c4State.isPlanted && bot.team === "T";

    if (bot.patrolNextInterval === undefined) {
        bot.patrolNextInterval = isPostPlantT ? (1.35 + rnd() * 0.95) : (0.65 + rnd() * 1.0);
    }

    bot.patrolTimer += dt;
    if (bot.patrolTimer >= bot.patrolNextInterval) {
        bot.patrolTimer = 0;

        if (isPostPlantT) {
            bot.patrolNextInterval = 1.35 + rnd() * 0.95;
            bot.patrolScanDir = -(bot.patrolScanDir || (bot.id % 2 === 0 ? 1 : -1));
            bot.patrolSweepCount = (bot.patrolSweepCount || 0) + 1;

            if (bot.isMoving) {
                bot.patrolScanAngle = bot.patrolScanDir * ((6 + rnd() * 5) * Math.PI / 180);
            } else {
                bot.patrolScanAngle = bot.patrolScanDir * ((12 + rnd() * 8) * Math.PI / 180);
            }
        } else {
            bot.patrolNextInterval = bot.isMoving ? (0.8 + rnd() * 1.1) : (0.55 + rnd() * 1.0);
            if (bot.isMoving) {
                bot.patrolScanAngle = (rnd() - 0.5) * (24 * Math.PI / 180);
            } else {
                const isWideCheck = rnd() < 0.25;
                const sweepSpread = isWideCheck ? (96 * Math.PI / 180) : (58 * Math.PI / 180);
                bot.patrolScanAngle = (rnd() - 0.5) * sweepSpread;
            }
        }
    }

    const maxOffset = isPostPlantT
        ? (bot.isMoving ? (14 * Math.PI / 180) : (40 * Math.PI / 180))
        : (bot.isMoving ? (14 * Math.PI / 180) : (48 * Math.PI / 180));
    const clampedScan = Math.max(-maxOffset, Math.min(maxOffset, bot.patrolScanAngle || 0));
    const targetFacing = normalizeAngle(bot.patrolBaseAngle + clampedScan);
    const turnSpeed = isPostPlantT ? 4.2 : (bot.isMoving ? 5.8 : 4.8);
    bot.angle = rotateTowardsDamped(bot.angle, targetFacing, turnSpeed, dt);
}

export function getSitePatrolDestination(bot, siteKey) {
    const points = SITE_PATROL_POINTS[siteKey] || SITE_PATROL_POINTS.A;
    if (!bot.patrolTargetPt || Math.hypot(bot.patrolTargetPt.x - bot.x, bot.patrolTargetPt.y - bot.y) < 55) {
        const candidates = points.filter(p => !bot.patrolTargetPt || Math.hypot(p.x - bot.patrolTargetPt.x, p.y - bot.patrolTargetPt.y) > 40);
        bot.patrolTargetPt = candidates[Math.floor(rnd() * candidates.length)] || points[0];
    }
    return bot.patrolTargetPt;
}

export function tryTacticalReload(bot) {
    if (!bot || bot.isDead || bot.isReloading || bot.isDefusing || bot.executePhase === "PLANT_LOCK") return false;
    if (bot.targetEnemy) return false;

    const key = bot.getEquippedKey();
    const wep = bot.getWeapon();
    if (!wep || wep.category === "knife" || wep.category === "c4" || wep.category === "grenade") return false;

    const currentClip = bot.getCurrentClip();
    const reserve = bot.reserves ? (bot.reserves[key] || 0) : 0;
    const reloadThreshold = Math.max(2, Math.floor(wep.clip * 0.35));

    if (currentClip <= reloadThreshold && reserve > 0) {
        startReload(bot);
        return true;
    }
    return false;
}

export function findTacticalCover(bot, threatX, threatY) {
    let bestCover = null;
    let minDist = Infinity;
    for (let i = 0; i < TACTICAL_CORNERS.length; i++) {
        const c = TACTICAL_CORNERS[i];
        const d = Math.hypot(c.x - bot.x, c.y - bot.y);
        if (d < 340 && d < minDist && hasBodyClearance(bot.x, bot.y, c.x, c.y, TORSO_RADIUS) && !getLineOfSight(c.x, c.y, threatX, threatY)) {
            minDist = d;
            bestCover = { x: c.x, y: c.y };
        }
    }
    if (bestCover) return bestCover;

    const awayAngle = Math.atan2(bot.y - threatY, bot.x - threatX);
    const fbX = bot.x + Math.cos(awayAngle) * 70;
    const fbY = bot.y + Math.sin(awayAngle) * 70;
    return !checkWallCollision(fbX, fbY, bot.radius) ? { x: fbX, y: fbY } : { x: bot.x, y: bot.y };
}

export function findCrossfireSupportAngle(bot, enemyPos, allyPos) {
    if (!bot || !enemyPos) return null;

    if (bot.cachedCrossfirePlan &&
        world.gameTime < bot.cachedCrossfirePlan.until &&
        Math.hypot(bot.cachedCrossfirePlan.enemyX - enemyPos.x, bot.cachedCrossfirePlan.enemyY - enemyPos.y) < 95) {
        return bot.cachedCrossfirePlan;
    }

    const teammates = (bot.team === "CT" ? world.livingCT : world.livingT).filter(m => m && !m.isDead);
    const allyRef = allyPos || bot;
    const allyToEnemyAng = Math.atan2(enemyPos.y - allyRef.y, enemyPos.x - allyRef.x);
    const enemyToAllyAng = Math.atan2(allyRef.y - enemyPos.y, allyRef.x - enemyPos.x);
    const isAWP = hasUsableAWP(bot);
    const minEngagementDist = isAWP ? 300 : 185;
    const maxEngagementDist = isAWP ? 760 : 540;

    let bestSpot = null;
    let bestScore = -Infinity;

    const considerCandidate = (rawX, rawY, baseBonus = 0) => {
        const clampedX = Math.max(80, Math.min(MAP.width - 80, rawX));
        const clampedY = Math.max(80, Math.min(MAP.height - 80, rawY));
        const cand = navCellToWorld(worldToNavCell(clampedX, clampedY));

        if (checkWallCollision(cand.x, cand.y, bot.radius + 5)) return;
        const distToEnemy = Math.hypot(enemyPos.x - cand.x, enemyPos.y - cand.y);
        if (distToEnemy < minEngagementDist || distToEnemy > maxEngagementDist) return;

        // Must have direct line-of-sight to the deduced enemy shooter
        if (!getMapLineOfSight(cand.x, cand.y, enemyPos.x, enemyPos.y)) return;

        // Never run onto the ally's position
        const distToAlly = Math.hypot(cand.x - allyRef.x, cand.y - allyRef.y);
        if (allyPos && distToAlly < 145) return;

        // Crossfire angular separation relative to the enemy (reward 35°-125° pinch spread)
        const enemyToCandAng = Math.atan2(cand.y - enemyPos.y, cand.x - enemyPos.x);
        const crossfireArc = Math.abs(normalizeAngle(enemyToCandAng - enemyToAllyAng));
        if (allyPos && crossfireArc < (28 * Math.PI / 180)) return;

        let score = baseBonus;
        score += Math.min(130, crossfireArc * 95);
        score -= Math.hypot(cand.x - bot.x, cand.y - bot.y) * 0.22;

        // Strong reward for wall cover adjacent to the holding spot
        for (let d = 0; d < 8; d++) {
            const wa = d * (Math.PI / 4);
            if (checkWallCollision(cand.x + Math.cos(wa) * 34, cand.y + Math.sin(wa) * 34, 10)) {
                score += 110;
                break;
            }
        }

        // Penalize stacking near any other teammate
        for (let i = 0; i < teammates.length; i++) {
            const mate = teammates[i];
            if (mate === bot) continue;
            const dMate = Math.hypot(cand.x - mate.x, cand.y - mate.y);
            if (dMate < 135) score -= (135 - dMate) * 3.2;
        }

        // Penalize picking a spot right where a teammate just died
        const teamDeaths = world.tacticalIntel?.deathZones?.[bot.team] || [];
        for (let dz = 0; dz < teamDeaths.length; dz++) {
            if (!teamDeaths[dz].cleared && world.gameTime < teamDeaths[dz].expiresAt) {
                const dDeath = Math.hypot(cand.x - teamDeaths[dz].x, cand.y - teamDeaths[dz].y);
                if (dDeath < 150) score -= (150 - dDeath) * 2.5;
            }
        }

        if (score > bestScore) {
            bestScore = score;
            bestSpot = cand;
        }
    };

    // 1. Check nearby tactical corners that open a crossfire angle onto the enemy
    for (let i = 0; i < TACTICAL_CORNERS.length; i++) {
        const c = TACTICAL_CORNERS[i];
        if (Math.hypot(c.x - bot.x, c.y - bot.y) <= 520) {
            considerCandidate(c.x, c.y, 45);
        }
    }

    // 2. Sample lateral & diagonal off-angles around the bot and around the enemy's flank
    const radii = [240, 320, 410];
    const sideOffsets = [-1.15, -0.78, -0.45, 0.45, 0.78, 1.15];
    for (let r = 0; r < radii.length; r++) {
        for (let s = 0; s < sideOffsets.length; s++) {
            const ang = enemyToAllyAng + sideOffsets[s];
            considerCandidate(
                enemyPos.x + Math.cos(ang) * radii[r],
                enemyPos.y + Math.sin(ang) * radii[r],
                0
            );
        }
    }

    // 3. Local lateral sidestep around the bot's own position to peek the enemy from cover
    const perpLeft = allyToEnemyAng + Math.PI / 2;
    const perpRight = allyToEnemyAng - Math.PI / 2;
    for (let step = 70; step <= 210; step += 70) {
        considerCandidate(bot.x + Math.cos(perpLeft) * step, bot.y + Math.sin(perpLeft) * step, 20);
        considerCandidate(bot.x + Math.cos(perpRight) * step, bot.y + Math.sin(perpRight) * step, 20);
    }

    if (!bestSpot) return null;

    const plan = {
        x: bestSpot.x,
        y: bestSpot.y,
        enemyX: enemyPos.x,
        enemyY: enemyPos.y,
        lookAngle: Math.atan2(enemyPos.y - bestSpot.y, enemyPos.x - bestSpot.x),
        until: world.gameTime + 1.6
    };
    bot.cachedCrossfirePlan = plan;
    return plan;
}

export function findMultiAngleSupportPosition(bot, threatX, threatY, teammate, forcedSide = 0) {
    if (!teammate) return { x: threatX, y: threatY };
    if (forcedSide === 0 && bot.cachedSupportPos && (world.gameTime - (bot.cachedSupportPosTime || 0) < 0.5)) {
        return bot.cachedSupportPos;
    }

    const teammates = (bot.team === "CT" ? world.livingCT : world.livingT).filter(m => m && !m.isDead);
    const mateRank = Math.max(0, teammates.indexOf(bot));
    const mateAngle = Math.atan2(teammate.y - threatY, teammate.x - threatX);
    const sideSign = forcedSide !== 0 ? Math.sign(forcedSide) : ((mateRank % 2 === 0) ? 1 : -1);

    // Assign each teammate a distinct angular arc & standoff radius so flankers never stack
    const arcOffsets = [0, 0.42, -0.42, 0.78, -0.78];
    const rankArc = arcOffsets[mateRank % arcOffsets.length];
    const baseFlankAngle = mateAngle + sideSign * (Math.PI * 0.48) + rankArc;
    const radii = [235 + (mateRank % 3) * 25, 290, 195];

    let bestPt = null;
    let bestScore = -Infinity;

    for (let rIdx = 0; rIdx < radii.length; rIdx++) {
        const rad = radii[rIdx];
        for (let offset = -0.45; offset <= 0.45; offset += 0.225) {
            const testAng = baseFlankAngle + offset;
            const tx = Math.max(80, Math.min(MAP.width - 80, threatX + Math.cos(testAng) * rad));
            const ty = Math.max(80, Math.min(MAP.height - 80, threatY + Math.sin(testAng) * rad));
            const worldPt = navCellToWorld(worldToNavCell(tx, ty));

            if (checkWallCollision(worldPt.x, worldPt.y, bot.radius + 6)) continue;
            if (!getMapLineOfSight(worldPt.x, worldPt.y, threatX, threatY)) continue;

            let score = -Math.abs(offset) * 30 - Math.hypot(worldPt.x - bot.x, worldPt.y - bot.y) * 0.08;
            for (let i = 0; i < teammates.length; i++) {
                const ally = teammates[i];
                if (ally === bot) continue;
                const dAlly = Math.hypot(worldPt.x - ally.x, worldPt.y - ally.y);
                if (dAlly < 130) score -= (130 - dAlly) * 4.0;
                if (ally.cachedSupportPos && Math.hypot(worldPt.x - ally.cachedSupportPos.x, worldPt.y - ally.cachedSupportPos.y) < 125) {
                    score -= 220;
                }
            }

            if (score > bestScore) {
                bestScore = score;
                bestPt = worldPt;
            }
        }
    }

    bot.cachedSupportPos = bestPt || { x: threatX, y: threatY };
    bot.cachedSupportPosTime = world.gameTime;
    return bot.cachedSupportPos;
}

export function getBotCombatAimPoint(bot, target, dt) {
    if (!target) return { x: 0, y: 0 };
    const wepKey = bot.getEquippedKey();
    const wep = bot.getWeapon();
    const isSniper = wep.category === "sniper" || wepKey === "AWP";

    const dist = Math.hypot(target.x - bot.x, target.y - bot.y);
    const bulletSpeed = (wep && wep.speed) ? wep.speed : 1600;
    const leadTime = dist / bulletSpeed;

    const predictedBaseX = target.x + (target.vx || 0) * leadTime;
    const predictedBaseY = target.y + (target.vy || 0) * leadTime;

    if (isSniper) {
        const sniperJitter = bot.isMoving ? 14.0 : 2.2;
        bot.aimOffsetAngle = (bot.aimOffsetAngle || 0) + (rnd() - 0.5) * 0.5;
        return {
            x: predictedBaseX + Math.cos(bot.aimOffsetAngle) * sniperJitter,
            y: predictedBaseY + Math.sin(bot.aimOffsetAngle) * sniperJitter
        };
    }

    const shots = bot.shotsFired || 0;
    const headBias = Math.max(0.0, 1.0 - (shots * 0.32));
    let aimX = predictedBaseX + Math.cos(target.angle) * (HEAD_OFFSET * headBias);
    let aimY = predictedBaseY + Math.sin(target.angle) * (HEAD_OFFSET * headBias);

    const pattern = SPRAY_PATTERNS[wepKey];
    if (pattern && pattern.length > 0 && shots > 0) {
        const shotIdx = Math.min(shots, pattern.length - 1);
        const activePatternOffset = pattern[shotIdx];
        if (activePatternOffset !== 0) {
            const rawAngle = Math.atan2(aimY - bot.y, aimX - bot.x);
            const compensatedAngle = rawAngle - (activePatternOffset * 0.70);
            aimX = bot.x + Math.cos(compensatedAngle) * dist;
            aimY = bot.y + Math.sin(compensatedAngle) * dist;
        }
    }

    // Keep the crosshair inside the target's hitbox during sustained spray; weapon recoilBloom handles bullet spread
    bot.aimOffsetAngle = (bot.aimOffsetAngle || 0) + (rnd() - 0.5) * 0.55;
    const maxBodyJitter = Math.min(TORSO_RADIUS * 0.78, (shots <= 1 && !bot.isMoving) ? (HEAD_RADIUS * 0.75) : (TORSO_RADIUS * 0.65));
    const minBodyJitter = (shots <= 1 && !bot.isMoving) ? 0.5 : 2.2;

    const desiredDivergence = Math.min(maxBodyJitter, minBodyJitter + rnd() * Math.max(0.4, maxBodyJitter - minBodyJitter));
    bot.aimErrorDist = bot.aimErrorDist
        ? Math.min(maxBodyJitter, bot.aimErrorDist * 0.72 + desiredDivergence * 0.28)
        : desiredDivergence;

    return {
        x: aimX + Math.cos(bot.aimOffsetAngle) * bot.aimErrorDist,
        y: aimY + Math.sin(bot.aimOffsetAngle) * bot.aimErrorDist
    };
}

export function hasAWPScopeLineClearance(bot, aimAngle = null) {
    if (!bot) return false;
    const checkAngle = (aimAngle !== null && aimAngle !== undefined) ? aimAngle : bot.angle;
    const muzzleDist = (bot.radius || TORSO_RADIUS) + 8;
    const startX = bot.x + Math.cos(checkAngle) * muzzleDist;
    const startY = bot.y + Math.sin(checkAngle) * muzzleDist;
    if (checkWallCollision(startX, startY, 4)) return false;

    const hitPt = getRayObstacleEndpoint(startX, startY, checkAngle, 200);
    const clearDist = Math.hypot(hitPt.x - startX, hitPt.y - startY);
    return clearDist >= 135;
}

export function executeAWPTactics(bot, dt, activeTarget, aimAngle, distToTarget) {
    const hasLOS = activeTarget ? getLineOfSight(bot.x, bot.y, activeTarget.x, activeTarget.y) : false;
    const STANDOFF_SAFE_DISTANCE = 420;
    const awpAmmoLeft = (bot.clips?.["AWP"] || 0) + (bot.reserves?.["AWP"] || 0);

    // Pure-AWP discipline: only switch to secondary weapon when completely out of AWP ammunition
    if (awpAmmoLeft <= 0) {
        bot.isScoped = false;
        const hasSecondaryAmmo = bot.secondaryKey &&
            ((bot.clips?.[bot.secondaryKey] || 0) + (bot.reserves?.[bot.secondaryKey] || 0)) > 0;
        bot.selectSlot(hasSecondaryAmmo ? 2 : 3);
        return false;
    }

    if (bot.awpBoltTimer > 0) {
        bot.awpBoltTimer -= dt;

        if (activeTarget) {
            if (distToTarget < STANDOFF_SAFE_DISTANCE) {
                bot.isScoped = false;
                const coverPt = findTacticalCover(bot, activeTarget.x, activeTarget.y);
                const retreatAngle = Math.atan2(coverPt.y - bot.y, coverPt.x - bot.x);
                bot.angle = rotateTowardsDamped(bot.angle, retreatAngle, 14.0, dt);
                moveBotWithSliding(bot, retreatAngle, 195, dt, false);
                return true;
            }

            if (bot.awpBoltTimer > 0.25) {
                if (!bot.awpCoverSpot) {
                    const perpAngle = aimAngle + Math.PI / 2;
                    const testA = { x: bot.x + Math.cos(perpAngle) * 55, y: bot.y + Math.sin(perpAngle) * 55 };
                    const testB = { x: bot.x - Math.cos(perpAngle) * 55, y: bot.y - Math.sin(perpAngle) * 55 };

                    if (!checkWallCollision(testA.x, testA.y, bot.radius) && !getLineOfSight(testA.x, testA.y, activeTarget.x, activeTarget.y)) {
                        bot.awpCoverSpot = testA;
                    } else if (!checkWallCollision(testB.x, testB.y, bot.radius) && !getLineOfSight(testB.x, testB.y, activeTarget.x, activeTarget.y)) {
                        bot.awpCoverSpot = testB;
                    } else {
                        bot.awpCoverSpot = { x: bot.x - Math.cos(aimAngle) * 45, y: bot.y - Math.sin(aimAngle) * 45 };
                    }
                }

                const coverAngle = Math.atan2(bot.awpCoverSpot.y - bot.y, bot.awpCoverSpot.x - bot.x);
                bot.angle = rotateTowardsDamped(bot.angle, aimAngle, 10.0, dt);
                moveBotWithSliding(bot, coverAngle, 185, dt, false);
                return true;
            } else if (bot.awpShotOrigin) {
                const returnAngle = Math.atan2(bot.awpShotOrigin.y - bot.y, bot.awpShotOrigin.x - bot.x);
                bot.angle = rotateTowardsDamped(bot.angle, aimAngle, 14.0, dt);
                bot.isScoped = true;
                bot.scopeLevel = 1;
                if (Math.hypot(bot.awpShotOrigin.x - bot.x, bot.awpShotOrigin.y - bot.y) > 10) {
                    moveBotWithSliding(bot, returnAngle, 175, dt, false);
                } else {
                    brakeBot(bot, dt);
                }
                return true;
            }
        }
    }

    bot.awpEmergencyRetreat = false;
    const preAlignedDiff = Math.abs(normalizeAngle(aimAngle - bot.angle));
    const isCrosshairReady = preAlignedDiff < 0.28;
    if (isCrosshairReady && !bot.isMoving && bot.reactionTimer === 0) {
        bot.combatCadenceState = "STOP_AND_BURST";
        bot.combatCadenceTimer = 0;
    }

    bot.reactionTimer += dt;
    const isFastReactionArchetype = bot.archetype === "AWPER" || bot.archetype === "ENTRY";
    const preAimScale = isFastReactionArchetype ? 0.55 : 0.70; // -45% delay for AWPER/ENTRY, -30% for others
    const baseDelay = isCrosshairReady
        ? (bot.humanReactionDelay || 0.1775) * preAimScale
        : (bot.humanReactionDelay || 0.1775);
    const effectiveDelay = baseDelay + getSensoryDistraction(bot) * 0.08;
    if (bot.reactionTimer < effectiveDelay) {
        return true;
    }

    bot.angle = rotateTowardsDamped(bot.angle, aimAngle, 14.0, dt);
    const alignedDiff = Math.abs(normalizeAngle(aimAngle - bot.angle));

    if (distToTarget <= 250 && activeTarget) {
        bot.isScoped = false;
        brakeBot(bot, dt);
        if (alignedDiff < 0.22) {
            performAttack(bot, activeTarget.x, activeTarget.y, false);
        }
        return true;
    }

    if (hasLOS) {
        bot.awpHoldTimer = 0;

        // Stay evasive and un-scoped while still drawing the AWP instead of freezing in the open
        if ((bot.equipTimer || 0) > 0) {
            bot.isScoped = false;
            const evadeAng = aimAngle + ((bot.counterStrafeDir || 1) * (Math.PI / 2));
            if (!checkWallCollision(bot.x + Math.cos(evadeAng) * 28, bot.y + Math.sin(evadeAng) * 28, bot.radius)) {
                moveBotWithSliding(bot, evadeAng, 185, dt, false);
            } else {
                const coverPt = findTacticalCover(bot, activeTarget.x, activeTarget.y);
                steerBotToDestination(bot, coverPt.x, coverPt.y, 190, dt, { stopRadius: 12, autoAim: false });
            }
            return true;
        }

        bot.isScoped = true;
        bot.scopeLevel = 1;
        brakeBot(bot, dt);

        if (alignedDiff < 0.14 && !bot.isMoving) {
            performAttack(bot, activeTarget.x, activeTarget.y, false);
        }
        return true;
    }

    if (bot.lastHeardSound && (world.gameTime - bot.lastHeardSound.time < 1.5)) {
        const sDist = Math.hypot(bot.lastHeardSound.x - bot.x, bot.lastHeardSound.y - bot.y);
        const sAng = Math.atan2(bot.lastHeardSound.y - bot.y, bot.lastHeardSound.x - bot.x);
        if (sDist <= 520 && Math.abs(normalizeAngle(sAng - bot.angle)) > (85 * Math.PI / 180)) {
            bot.isScoped = false;
            bot.awpHoldTimer = 0;
            bot.targetEnemy = null;
            return false;
        }
    }

    if (bot.team === "T" && !c4State.isPlanted) {
        bot.isScoped = false;
        bot.awpHoldTimer = 0;
        bot.targetEnemy = null;
        return false;
    }

    bot.awpHoldTimer += dt;
    const canHoldCorner = hasAWPScopeLineClearance(bot, aimAngle);

    if (canHoldCorner && bot.awpHoldTimer <= 0.75) {
        bot.isScoped = true;
        bot.scopeLevel = 1;
        brakeBot(bot, dt);
        return true;
    }
    if (activeTarget && tryExecuteTacticalUtility(bot, dt, activeTarget)) {
        bot.isScoped = false;
        bot.awpHoldTimer = 0;
        return true;
    }
    if (canHoldCorner && bot.awpHoldTimer <= 1.35) {
        bot.isScoped = true;
        bot.scopeLevel = 1;
        brakeBot(bot, dt);
        return true;
    }

    bot.isScoped = false;
    bot.awpHoldTimer = 0;
    bot.targetEnemy = null;
    return false;
}

export function executeBotGunplay(bot, activeTarget, aimPoint, distToTarget, dt, isBombImminent) {
    if (bot.isDefusing || bot.startedFakeSequence || (c4State.designatedDefuser === bot && c4State.isBeingDefused)) {
        bot.isDefusing = false;
        bot.startedFakeSequence = false;
        bot.fakeDefuseStartTime = 0;
        bot.fakeDefuseBaitUntil = 0;
        c4State.isBeingDefused = false;
        c4State.defuseProgress = 0;
        if (c4State.designatedDefuser === bot) {
            c4State.designatedDefuser = null;
        }
    }
    if (bot.executePhase === "PLANT_LOCK" || c4State.planter === bot) {
        if (bot.executePhase === "PLANT_LOCK") bot.executePhase = "BREACH";
        if (c4State.planter === bot) {
            c4State.plantProgress = 0;
            c4State.planter = null;
        }
    }

    const aimAngle = Math.atan2(aimPoint.y - bot.y, aimPoint.x - bot.x);
    const primaryKey = bot.primaryKey;
    const primaryTotalAmmo = primaryKey ? ((bot.clips?.[primaryKey] || 0) + (bot.reserves?.[primaryKey] || 0)) : 0;

    if (bot.activeSlot === 3 || (bot.activeSlot === 2 && primaryKey && !bot.isReloading && primaryTotalAmmo > 0)) {
        bot.selectSlot(primaryTotalAmmo > 0 ? 1 : (bot.secondaryKey ? 2 : 3));
        bot.knifeLockTimer = 0;
    }

    if (bot.getEquippedKey() === "AWP") {
        if (executeAWPTactics(bot, dt, activeTarget, aimAngle, distToTarget)) return;
    }

    bot.reactionTimer += dt;
    const preAlignedDiff = Math.abs(normalizeAngle(aimAngle - bot.angle));
    const isPreAimed = preAlignedDiff < 0.28;
    const isFastReactionArchetype = bot.archetype === "AWPER" || bot.archetype === "ENTRY";
    const preAimScale = isFastReactionArchetype ? 0.55 : 0.70; // -45% delay for AWPER/ENTRY, -30% for others
    const baseReaction = isPreAimed
        ? (bot.humanReactionDelay || 0.1775) * preAimScale
        : (bot.humanReactionDelay || 0.1775);
    const effectiveDelay = baseReaction + getSensoryDistraction(bot) * 0.08;

    if (bot.isReloading) {
        if (primaryKey !== "AWP" && distToTarget < 260 && bot.secondaryKey && (bot.clips[bot.secondaryKey] > 0) && bot.activeSlot !== 2) {
            bot.selectSlot(2);
        } else {
            if (!bot.reloadCoverSpot) {
                bot.reloadCoverSpot = findTacticalCover(bot, activeTarget.x, activeTarget.y);
            }
            if (bot.reactionTimer >= effectiveDelay) {
                bot.angle = rotateTowardsDamped(bot.angle, aimAngle, 9.5, dt);
            }
            steerBotToDestination(bot, bot.reloadCoverSpot.x, bot.reloadCoverSpot.y, 195, dt, { stopRadius: 14, autoAim: false });
            return;
        }
    }

    if (bot.reactionTimer < effectiveDelay) {
        if (bot.isMoving) {
            moveBotWithSliding(bot, bot.angle, 165, dt, false);
        }
        return;
    }

    if (bot.antiFlashTimer <= 0) {
        bot.angle = rotateTowardsDamped(bot.angle, aimAngle, 11.5, dt);
    }

    const alignedDiff = Math.abs(normalizeAngle(aimAngle - bot.angle));
    const angleToBot = Math.atan2(bot.y - activeTarget.y, bot.x - activeTarget.x);
    const enemyFacingDiff = Math.abs(normalizeAngle(angleToBot - activeTarget.angle));
    const isEnemyUnaware = enemyFacingDiff > (85 * Math.PI / 180);

    if (isEnemyUnaware && distToTarget > 180 && (bot.shotsFired || 0) === 0 && alignedDiff > 0.07) {
        bot.isSilentWalking = true;
        brakeBot(bot, dt);
        return;
    }

    // While still drawing a weapon, strafe or tuck into cover with full-body clearance so the bot never scrapes walls
    if ((bot.equipTimer || 0) > 0) {
        bot.isCrouching = false;
        const strafeDir = bot.counterStrafeDir || 1;
        let drawStrafeAng = aimAngle + strafeDir * (Math.PI / 2);
        const testAX = bot.x + Math.cos(drawStrafeAng) * 34;
        const testAY = bot.y + Math.sin(drawStrafeAng) * 34;
        if (!hasBodyClearance(bot.x, bot.y, testAX, testAY, bot.radius + 5)) {
            bot.counterStrafeDir = -strafeDir;
            drawStrafeAng = aimAngle - strafeDir * (Math.PI / 2);
        }

        const safeAX = bot.x + Math.cos(drawStrafeAng) * 34;
        const safeAY = bot.y + Math.sin(drawStrafeAng) * 34;
        if (hasBodyClearance(bot.x, bot.y, safeAX, safeAY, bot.radius + 5)) {
            moveBotWithSliding(bot, drawStrafeAng, 185, dt, false);
        } else {
            const coverPt = findTacticalCover(bot, activeTarget.x, activeTarget.y);
            steerBotToDestination(bot, coverPt.x, coverPt.y, 190, dt, { stopRadius: 12, autoAim: false });
        }
        return;
    }

    const wep = bot.getWeapon();
    const isRunAndGunWep = wep.category === "smg" || (wep.category === "pistol" && !wep.name.includes("DEAGLE"));
    const enemyHasAWP = activeTarget && (activeTarget.getEquippedKey?.() === "AWP" || activeTarget.getWeapon?.().category === "sniper");
    const enemyBoltOnCooldown = enemyHasAWP && (activeTarget.awpBoltTimer || 0) > 0.25;
    const enemyMidSwitch = activeTarget && (activeTarget.equipTimer || 0) > 0.18;
    const isTFastFlood = bot.team === "T" && isTFastExecuteActive(bot.assignedSite || "A");
    const isFinishable = distToTarget < (isTFastFlood ? 290 : 215) || (activeTarget && activeTarget.health <= 32) || enemyMidSwitch;

    const inTightCorridor = (bot.x >= 1250 && bot.x <= 2200 && bot.y >= 1350 && bot.y <= 1950) ||
        (bot.x >= 1800 && bot.x <= 2200 && bot.y >= 380 && bot.y <= 700) ||
        (bot.x >= 2250 && bot.x <= 2560 && bot.y >= 40 && bot.y <= 750);

    bot.combatCadenceTimer = (bot.combatCadenceTimer || 0) + dt;
    if (!bot.nextStrafeWindow) bot.nextStrafeWindow = 0.18 + rnd() * 0.18;
    if (!bot.nextStopWindow) bot.nextStopWindow = 0.20 + rnd() * 0.14;

    if (enemyHasAWP && !enemyBoltOnCooldown && !inTightCorridor && distToTarget >= 320 &&
        (bot.awpBaitCooldown || 0) <= 0 && !bot.isBaitingAWP) {
        bot.isBaitingAWP = true;
        bot.awpBaitTimer = 0;
        bot.awpBaitDir = bot.counterStrafeDir || 1;
    }

    if (bot.isBaitingAWP) {
        bot.awpBaitTimer = (bot.awpBaitTimer || 0) + dt;
        bot.isCrouching = false;

        if (bot.awpBaitTimer <= 0.18) {
            const baitOutAng = aimAngle + bot.awpBaitDir * (Math.PI / 2);
            if (!checkWallCollision(bot.x + Math.cos(baitOutAng) * 26, bot.y + Math.sin(baitOutAng) * 26, bot.radius)) {
                moveBotWithSliding(bot, baitOutAng, 185, dt, false);
            } else {
                bot.isBaitingAWP = false;
                bot.awpBaitCooldown = 2.0;
            }
            return;
        }
        if (bot.awpBaitTimer <= 0.38) {
            const baitBackAng = aimAngle - bot.awpBaitDir * (Math.PI / 2);
            moveBotWithSliding(bot, baitBackAng, 190, dt, false);
            return;
        }
        bot.isBaitingAWP = false;
        bot.awpBaitCooldown = 3.2;
        bot.combatCadenceState = "STOP_AND_BURST";
        bot.combatCadenceTimer = 0;
    }
    if (bot.awpBaitCooldown > 0) bot.awpBaitCooldown -= dt;

    if (distToTarget > 420 && (bot.tapCount || 0) >= 3) {
        bot.combatCadenceState = "BURST_RESET";
        bot.combatCadenceTimer = 0;
        bot.nextStrafeWindow = 0.22 + rnd() * 0.16;
        bot.tapCount = 0;
        bot.shotsFired = 0;
    }

    if (bot.combatCadenceState === "BURST_RESET") {
        bot.isCrouching = false;
        const strafeAngle = aimAngle + (bot.counterStrafeDir * Math.PI * 0.48);
        moveBotWithSliding(bot, strafeAngle, 165, dt, false);
        if (bot.combatCadenceTimer >= bot.nextStrafeWindow) {
            bot.combatCadenceState = "STOP_AND_BURST";
            bot.combatCadenceTimer = 0;
            bot.nextStopWindow = 0.22 + rnd() * 0.14;
            bot.counterStrafeDir = -bot.counterStrafeDir;
        }
        return;
    }

    const shouldADADBait = !isFinishable && !isRunAndGunWep && !inTightCorridor && !enemyBoltOnCooldown &&
        distToTarget >= 220 && distToTarget <= 540;

    if (bot.combatCadenceState === "STRAFE") {
        bot.isCrouching = false;

        const nearbyDuelMate = world.allCharacters.find(other =>
            other && !other.isDead && other !== bot && other.team === bot.team &&
            (other.targetEnemy === activeTarget || Math.hypot(other.x - bot.x, other.y - bot.y) < 260)
        );
        if (nearbyDuelMate) {
            const toMateAngle = Math.atan2(nearbyDuelMate.y - bot.y, nearbyDuelMate.x - bot.x);
            bot.counterStrafeDir = normalizeAngle(toMateAngle - aimAngle) > 0 ? -1 : 1;
        }

        let strafeAngle = aimAngle + (bot.counterStrafeDir * (Math.PI / 2));
        if (checkWallCollision(bot.x + Math.cos(strafeAngle) * 28, bot.y + Math.sin(strafeAngle) * 28, bot.radius)) {
            bot.counterStrafeDir = -bot.counterStrafeDir;
            strafeAngle = aimAngle + (bot.counterStrafeDir * (Math.PI / 2));
        }

        const sideBlocked = checkWallCollision(bot.x + Math.cos(strafeAngle) * 28, bot.y + Math.sin(strafeAngle) * 28, bot.radius);

        if (isBombImminent) {
            const fleeAngle = Math.atan2(bot.y - c4State.plantY, bot.x - c4State.plantX);
            moveBotWithSliding(bot, fleeAngle, 190, dt, false);
        } else if (inTightCorridor || sideBlocked || isFinishable) {
            brakeBot(bot, dt);
            bot.combatCadenceState = "STOP_AND_BURST";
            bot.combatCadenceTimer = 0;
        } else {
            moveBotWithSliding(bot, strafeAngle, shouldADADBait ? 175 : 155, dt, false);
        }

        if (!tryExecuteTacticalUtility(bot, dt, activeTarget)) {
            if (bot.utilityCoverRetreat && world.gameTime < bot.utilityCoverRetreat.expiresAt &&
                Math.hypot(bot.utilityCoverRetreat.x - bot.x, bot.utilityCoverRetreat.y - bot.y) > 18) {
                const retreatAng = Math.atan2(bot.utilityCoverRetreat.y - bot.y, bot.utilityCoverRetreat.x - bot.x);
                moveBotWithSliding(bot, retreatAng, 185, dt, false);
            }
            if ((bot.equipTimer || 0) <= 0 && (distToTarget < 165 || isRunAndGunWep) && alignedDiff < 0.16) {
                performAttack(bot, aimPoint.x, aimPoint.y, false);
            }
        }

        if (bot.combatCadenceTimer >= bot.nextStrafeWindow) {
            bot.combatCadenceState = "STOP_AND_BURST";
            bot.combatCadenceTimer = 0;
            bot.nextStopWindow = shouldADADBait ? (0.16 + rnd() * 0.10) : (0.24 + rnd() * 0.14);
            if (rnd() < 0.75) {
                bot.counterStrafeDir = -bot.counterStrafeDir;
            }
        }
    } else {
        brakeBot(bot, dt);
        bot.isCrouching = (!bot.isMoving && !shouldADADBait && (bot.shotsFired || 0) >= 2 && distToTarget < 420);

        if (!tryExecuteTacticalUtility(bot, dt, activeTarget)) {
            if (bot.utilityCoverRetreat && world.gameTime < bot.utilityCoverRetreat.expiresAt &&
                Math.hypot(bot.utilityCoverRetreat.x - bot.x, bot.utilityCoverRetreat.y - bot.y) > 18) {
                const retreatAng = Math.atan2(bot.utilityCoverRetreat.y - bot.y, bot.utilityCoverRetreat.x - bot.x);
                moveBotWithSliding(bot, retreatAng, 185, dt, false);
            }
            if ((bot.equipTimer || 0) <= 0 && alignedDiff < 0.15) {
                performAttack(bot, aimPoint.x, aimPoint.y, false);
            }
        }

        if (bot.combatCadenceTimer >= bot.nextStopWindow) {
            bot.combatCadenceState = "STRAFE";
            bot.combatCadenceTimer = 0;
            bot.nextStrafeWindow = shouldADADBait ? (0.14 + rnd() * 0.20) : (0.24 + rnd() * 0.16);
        }
    }
}