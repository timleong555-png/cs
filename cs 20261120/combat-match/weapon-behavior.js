/* ==========================================================================
   WEAPONS CONFIGURATION, DETERMINISTIC SPRAY TABLES & MOVEMENT INACCURACY
   ========================================================================== */
import { audio } from '../state.js';

export const WEAPONS = {
    "KNIFE": {
        name: "COMBAT KNIFE", slot: 3, category: "knife", price: 0, team: "ANY",
        damage: 45, hsMult: 1.5, armorPen: 0.2, helmetPen: 0.2, piercingPower: 0,
        fireRate: 0.35, clip: Infinity, reloadTime: 0, speed: 1800, moveSpeedMult: 1.15,
        spread: 0.01, recoil: 0, recoilGrowth: 0, maxBloom: 0, killReward: 1500,
        rangeModifier: 1.0, sound: () => audio.playKnifeSwing()
    },
    "GLOCK": {
        name: "GLOCK-18", slot: 2, category: "pistol", price: 0, team: "T",
        damage: 24, hsMult: 2.5, armorPen: 0.5, helmetPen: 0.5, piercingPower: 0,
        fireRate: 0.16, clip: 20, maxReserve: 120, reloadTime: 1.8, speed: 2600, moveSpeedMult: 1.0,
        spread: 0.032, recoil: 0.015, recoilGrowth: 0.008, maxBloom: 0.08, killReward: 300,
        rangeModifier: 0.65, sound: (x, y, char) => audio.playWeaponFire("GLOCK", x, y, char)
    },
    "USP": {
        name: "USP-S", slot: 2, category: "pistol", price: 0, team: "CT",
        damage: 30, hsMult: 2.8, armorPen: 0.55, helmetPen: 0.5, piercingPower: 0,
        fireRate: 0.18, clip: 12, maxReserve: 36, reloadTime: 1.8, speed: 2600, moveSpeedMult: 1.0,
        spread: 0.022, recoil: 0.015, recoilGrowth: 0.010, maxBloom: 0.07, killReward: 300,
        rangeModifier: 0.72, sound: (x, y, char) => audio.playWeaponFire("USP", x, y, char)
    },
    "DUALIES": {
        name: "DUAL .40 BERETTAS", slot: 2, category: "pistol", price: 400, team: "ANY",
        semiAuto: true,
        damage: 29, hsMult: 2.6, armorPen: 0.52, helmetPen: 0.50, piercingPower: 0,
        fireRate: 0.10, clip: 30, maxReserve: 120, reloadTime: 2.6, speed: 1520 * 2, moveSpeedMult: 1.01,
        spread: 0.044, recoil: 0.018, recoilGrowth: 0.012, maxBloom: 0.14, killReward: 300,
        rangeModifier: 0.68, sound: (x, y, char) => audio.playWeaponFire("DUALIES", x, y, char)
    },
    "DEAGLE": {
        name: "DESERT EAGLE", slot: 2, category: "pistol", price: 650, team: "ANY",
        damage: 54, hsMult: 4.0, armorPen: 0.85, helmetPen: 0.525, piercingPower: 0,
        fireRate: 0.32, clip: 7, maxReserve: 35, reloadTime: 2.2, speed: 1650 * 2, moveSpeedMult: 0.98,
        spread: 0.042, recoil: 0.080, recoilGrowth: 0.035, maxBloom: 0.16, killReward: 300,
        rangeModifier: 0.80, sound: (x, y, char) => audio.playWeaponFire("DEAGLE", x, y, char)
    },
    "MP5": {
        name: "MP5 NAVY", slot: 1, category: "smg", price: 1500, team: "ANY",
        damage: 23, hsMult: 2.2, armorPen: 0.75, helmetPen: 0.60, piercingPower: 0,
        fireRate: 0.085, clip: 30, maxReserve: 120, reloadTime: 2.0, speed: 1550 * 1.75, moveSpeedMult: 1.02,
        spread: 0.028, recoil: 0.010, recoilGrowth: 0.007, maxBloom: 0.065, killReward: 600,
        rangeModifier: 0.62, sound: (x, y, char) => audio.playWeaponFire("MP5", x, y, char)
    },
    "VECTOR": {
        name: "KRISS Vector", slot: 1, category: "smg", price: 2100, team: "ANY",
        damage: 25, hsMult: 2.35, armorPen: 0.56, helmetPen: 0.55, piercingPower: 0,
        fireRate: 0.048, clip: 25, maxReserve: 100, reloadTime: 2.1, speed: 3200, moveSpeedMult: 1.03,
        spread: 0.095, recoil: 0.011, recoilGrowth: 0.010, maxBloom: 0.11, killReward: 600,
        rangeModifier: 0.60, sound: (x, y, char) => audio.playWeaponFire("VECTOR", x, y, char)
    },
    "M4A1": {
        name: "M4A1", slot: 1, category: "rifle", price: 3100, team: "CT",
        damage: 32, hsMult: 4.0, armorPen: 0.75, helmetPen: 0.70, piercingPower: 0,
        fireRate: 0.10, clip: 30, maxReserve: 90, reloadTime: 2.2, speed: 1650 * 2, moveSpeedMult: 0.94,
        spread: 0.020, recoil: 0.022, recoilGrowth: 0.015, maxBloom: 0.103, killReward: 300,
        rangeModifier: 0.85, sound: (x, y, char) => audio.playWeaponFire("M4A1", x, y, char)
    },
    "AK47": {
        name: "AK-47", slot: 1, category: "rifle", price: 2700, team: "T",
        damage: 36, hsMult: 4.0, armorPen: 0.80, helmetPen: 0.775, piercingPower: 0,
        fireRate: 0.11, clip: 30, maxReserve: 90, reloadTime: 2.3, speed: 1700 * 2, moveSpeedMult: 0.92,
        spread: 0.028, recoil: 0.038, recoilGrowth: 0.027, maxBloom: 0.157, killReward: 300,
        rangeModifier: 0.85, sound: (x, y, char) => audio.playWeaponFire("AK47", x, y, char)
    },
    "AWP": {
        name: "AWP SNIPER", slot: 1, category: "sniper", price: 4750, team: "ANY",
        damage: 115, hsMult: 4.0, armorPen: 0.98, helmetPen: 0.95, piercingPower: 0,
        fireRate: 1.45, clip: 5, maxReserve: 30, reloadTime: 2.8, speed: 2200 * 2.5, moveSpeedMult: 0.82,
        spread: 0.001, recoil: 0, recoilGrowth: 0, maxBloom: 0, killReward: 100,
        rangeModifier: 1.00, sound: (x, y, char) => audio.playWeaponFire("AWP", x, y, char)
    },
    "HEGRENADE": {
        name: "HE GRENADE", slot: 4, category: "grenade", price: 300, team: "ANY",
        damage: 95, hsMult: 1.0, armorPen: 0.75, helmetPen: 0.75, piercingPower: 0,
        fireRate: 0.8, clip: 1, reloadTime: 0, speed: 650, moveSpeedMult: 1.0,
        spread: 0.01, recoil: 0, recoilGrowth: 0, maxBloom: 0, killReward: 300,
        rangeModifier: 1.0, sound: () => {}
    },
    "FLASH": {
        name: "FLASHBANG", slot: 7, category: "grenade", price: 200, team: "ANY",
        damage: 0, hsMult: 1.0, armorPen: 0, helmetPen: 0, piercingPower: 0,
        fireRate: 0.8, clip: 1, reloadTime: 0, speed: 750, moveSpeedMult: 1.0,
        spread: 0.01, recoil: 0, recoilGrowth: 0, maxBloom: 0, killReward: 0,
        rangeModifier: 1.0, sound: () => {}
    },
    "MOLOTOV": {
        name: "MOLOTOV", slot: 8, category: "grenade", price: 400, team: "ANY",
        damage: 40, hsMult: 1.0, armorPen: 0.9, helmetPen: 0.9, piercingPower: 0,
        fireRate: 0.8, clip: 1, reloadTime: 0, speed: 650, moveSpeedMult: 1.0,
        spread: 0.01, recoil: 0, recoilGrowth: 0, maxBloom: 0, killReward: 300,
        rangeModifier: 1.0, sound: () => {}
    },
    "SMOKE": {
        name: "SMOKE GRENADE", slot: 5, category: "grenade", price: 300, team: "ANY",
        damage: 0, hsMult: 1.0, armorPen: 0, helmetPen: 0, piercingPower: 0,
        fireRate: 0.8, clip: 1, reloadTime: 0, speed: 650, moveSpeedMult: 1.0,
        spread: 0.01, recoil: 0, recoilGrowth: 0, maxBloom: 0, killReward: 0,
        rangeModifier: 1.0, sound: () => {}
    },
    "C4": {
        name: "C4 BOMB", slot: 6, category: "c4", price: 0, team: "T",
        damage: 0, hsMult: 1, armorPen: 0, helmetPen: 0, piercingPower: 0,
        fireRate: 1.0, clip: Infinity, reloadTime: 0, speed: 0, moveSpeedMult: 1.0,
        spread: 0, recoil: 0, recoilGrowth: 0, maxBloom: 0, killReward: 0,
        rangeModifier: 1.0, sound: () => {}
    }
};

// Deterministic CS 1.6 Angular Spray Tables (in Radians)
export const SPRAY_PATTERNS = {
    "AK47": [
        0.0, 0.0, 0.014, 0.026, 0.038, 0.030, -0.010, -0.034, -0.050, -0.058,
        -0.054, -0.040, -0.014, 0.022, 0.044, 0.055, 0.058, 0.046, 0.026, 0.0,
        -0.024, -0.040, -0.048, -0.036, -0.016, 0.010, 0.028, 0.034, 0.020, 0.0
    ],
    "M4A1": [
        0.0, 0.0, 0.009, 0.018, 0.026, 0.020, -0.008, -0.024, -0.036, -0.042,
        -0.038, -0.026, -0.008, 0.016, 0.030, 0.040, 0.042, 0.032, 0.018, 0.0,
        -0.016, -0.028, -0.034, -0.026, -0.012, 0.006, 0.018, 0.022, 0.012, 0.0
    ],
    "MP5": [
        0.0, 0.0, 0.008, 0.016, 0.022, 0.016, -0.008, -0.025, -0.038, -0.045,
        -0.038, -0.026, -0.010, 0.016, 0.032, 0.038, 0.032, 0.022, 0.010, 0.0,
        -0.016, -0.028, -0.032, -0.022, -0.010, 0.006, 0.016, 0.022, 0.012, 0.0
    ],
    "DEAGLE": [
        0.0, 0.035, -0.050, 0.065, -0.075, 0.085, -0.090
    ],
    "DUALIES": [
        0.0, 0.012, -0.014, 0.020, -0.024, 0.030, -0.032, 0.036, -0.036, 0.032
    ],
    "VECTOR": [
        0.0, 0.0, 0.004, 0.009, 0.014, 0.019, 0.015, 0.006, -0.006, -0.016,
        -0.022, -0.016, -0.004, 0.010, 0.020, 0.025, 0.018, 0.005, -0.010, -0.022,
        -0.026, -0.018, -0.004, 0.014, 0.024
    ]
};

// Dynamic Movement Inaccuracy Table (in Radians)
export function getMovementInaccuracy(char, wep) {
    if (!char || !wep) return 0;
    const category = wep.category;

    // 1. Stationary (Dead Stop)
    if (!char.isMoving) {
        return char.isCrouching ? -wep.spread * 0.25 : 0;
    }

    // 2. Shift-Walking or Scoped Sniper Movement (Controlled Pace)
    if (char.isSilentWalking || (category === "sniper" && char.isScoped)) {
        if (category === "sniper") return 0.14;
        if (category === "rifle") return 0.032;
        if (category === "smg") return 0.012;
        return 0.018;
    }

    // 3. Full Sprint / Running (Heavy Inaccuracy Penalty)
    if (category === "sniper") return 0.52;
    if (category === "rifle") return 0.230;
    if (category === "smg") return 0.035;
    if (wep.name.includes("DEAGLE")) return 0.13;
    return 0.048;
}