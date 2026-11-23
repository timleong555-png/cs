/* ==========================================================================
   DOM HUD UPDATES, BUY MENU, SCOREBOARD, PAUSE MENU & 15-LEVEL PROGRESSION
   ========================================================================== */
import {
    world,
    matchState,
    c4State,
    getActiveFocus,
    registerProfileTagResolver,
    registerProfileDamageRecorder,
    registerBannerHandler
} from '../state.js';
import { WEAPONS } from '../combat-match/Weapon-behavior.js';
import { buyItem } from '../combat-match/Match-cycle.js';

/* ==========================================================================
   15-LEVEL OVERALL & WEAPON MASTERY PROGRESSION SYSTEM
   ========================================================================== */
export const OVERALL_LEVEL_THRESHOLDS = [
    0, 2500, 6000, 11000, 17500,          // Lv 1 - 5: ⭐ (1 to 5)
    25500, 35000, 46000, 59000, 74000,    // Lv 6 - 10: 🪩 (1 to 5)
    91000, 111000, 134000, 160000, 190000 // Lv 11 - 15: 👑 (1 to 5)
];

export const MASTERY_CONFIG = {
    rifle: { key: "rifle", title: "Rifle Expert 🎯", desc: "AK-47 & M4A1 Damage & Kills" },
    awp:   { key: "awp",   title: "Awper Expert 🎯", desc: "AWP Sniper Damage & Kills" },
    smg:   { key: "smg",   title: "SMG Expert 🎯",   desc: "KRISS Vector & MP5 Damage & Kills" },
    kda:   { key: "kda",   title: "KDA Looper 🎯",   desc: "Total Kills Secured" },
    hs:    { key: "hs",    title: "One Tapper 🎯",   desc: "Headshot Hits & Eliminations" }
};

export const playerProfile = {
    name: "Alex",
    totalDamage: 0,
    equippedTitle: "",
    masteryXP: { rifle: 0, awp: 0, smg: 0, kda: 0, hs: 0 }
};

export const matchTelemetry = {
    damageDealt: 0,
    expGained: 0
};

export function loadPlayerProfile() {
    try {
        const raw = localStorage.getItem("cs2d_dust2_profile_v1");
        if (raw) {
            const parsed = JSON.parse(raw);
            playerProfile.name = (typeof parsed.name === "string" && parsed.name.trim()) ? parsed.name.trim() : "Alex";
            playerProfile.totalDamage = Number.isFinite(parsed.totalDamage) ? Math.max(0, parsed.totalDamage) : 0;
            playerProfile.equippedTitle = typeof parsed.equippedTitle === "string" ? parsed.equippedTitle : "";
            if (parsed.masteryXP) {
                playerProfile.masteryXP.rifle = parsed.masteryXP.rifle || 0;
                playerProfile.masteryXP.awp   = parsed.masteryXP.awp   || 0;
                playerProfile.masteryXP.smg   = parsed.masteryXP.smg   || 0;
                playerProfile.masteryXP.kda   = parsed.masteryXP.kda   || 0;
                playerProfile.masteryXP.hs    = parsed.masteryXP.hs    || 0;
            }
        }
    } catch (e) {
        console.warn("Unable to load profile from localStorage:", e);
    }
}

export function savePlayerProfile() {
    try {
        localStorage.setItem("cs2d_dust2_profile_v1", JSON.stringify(playerProfile));
    } catch (e) {
        console.warn("Unable to save profile to localStorage:", e);
    }
}

export function getOverallLevelInfo(totalDmg) {
    let level = 1;
    for (let i = OVERALL_LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
        if (totalDmg >= OVERALL_LEVEL_THRESHOLDS[i]) {
            level = i + 1;
            break;
        }
    }
    const count = ((level - 1) % 5) + 1;
    let symbol = "⭐";
    if (level >= 6 && level <= 10) symbol = "🪩";
    else if (level >= 11) symbol = "👑";

    const badgeStr = symbol.repeat(count);
    const currentFloor = OVERALL_LEVEL_THRESHOLDS[level - 1];
    const nextCeil = level < 15 ? OVERALL_LEVEL_THRESHOLDS[level] : OVERALL_LEVEL_THRESHOLDS[14];
    const percent = level >= 15 ? 100 : Math.min(100, Math.max(0, ((totalDmg - currentFloor) / (nextCeil - currentFloor)) * 100));

    return { level, badgeStr, currentFloor, nextCeil, percent };
}

export function getMasteryLevelInfo(xp) {
    let level = 0;
    let remainingXp = Math.max(0, Math.floor(xp));
    let reqForNext = 250;

    while (level < 15 && remainingXp >= reqForNext) {
        remainingXp -= reqForNext;
        level++;
        reqForNext = 250 + level * 150;
    }

    if (level >= 15) {
        return { level: 15, currentXp: reqForNext, reqForNext, percent: 100 };
    }
    return {
        level,
        currentXp: remainingXp,
        reqForNext,
        percent: Math.min(100, Math.max(0, (remainingXp / reqForNext) * 100))
    };
}

export function getFormattedPlayerTag() {
    const { badgeStr } = getOverallLevelInfo(playerProfile.totalDamage);
    const titleSuffix = playerProfile.equippedTitle ? ` [${playerProfile.equippedTitle}]` : "";
    return `${playerProfile.name} ${badgeStr}${titleSuffix}`;
}

registerProfileTagResolver(getFormattedPlayerTag);

registerProfileDamageRecorder((dmgRounded, isHeadshot, weaponName) => {
    matchTelemetry.damageDealt += dmgRounded;
    playerProfile.totalDamage += dmgRounded;

    if (weaponName === "AK-47" || weaponName === "M4A1") {
        const xp = Math.max(1, Math.round(dmgRounded * 0.5));
        playerProfile.masteryXP.rifle += xp;
        matchTelemetry.expGained += xp;
    } else if (weaponName === "AWP SNIPER") {
        const xp = Math.max(1, Math.round(dmgRounded * 0.5));
        playerProfile.masteryXP.awp += xp;
        matchTelemetry.expGained += xp;
    } else if (weaponName === "KRISS Vector" || weaponName === "MP5 NAVY") {
        const xp = Math.max(1, Math.round(dmgRounded * 0.5));
        playerProfile.masteryXP.smg += xp;
        matchTelemetry.expGained += xp;
    }

    if (isHeadshot) {
        playerProfile.masteryXP.hs += 50;
        matchTelemetry.expGained += 50;
    }
});

export function syncStartScreenProfileUI() {
    const nameInput = document.getElementById("player-name-input");
    const titleSelect = document.getElementById("start-title-select");
    const previewEl = document.getElementById("start-profile-preview");
    if (!nameInput || !titleSelect || !previewEl) return;

    nameInput.value = playerProfile.name;

    const validTitles = [""];
    titleSelect.innerHTML = `<option value="">None</option>`;
    for (const key in MASTERY_CONFIG) {
        const info = getMasteryLevelInfo(playerProfile.masteryXP[key]);
        const cfg = MASTERY_CONFIG[key];
        if (info.level >= 1) {
            validTitles.push(cfg.title);
            const opt = document.createElement("option");
            opt.value = cfg.title;
            opt.textContent = `${cfg.title} (Lv.${info.level})`;
            titleSelect.appendChild(opt);
        }
    }

    if (!validTitles.includes(playerProfile.equippedTitle)) {
        playerProfile.equippedTitle = "";
    }
    titleSelect.value = playerProfile.equippedTitle;
    previewEl.innerText = getFormattedPlayerTag();
}

export function renderPostMatchTitleSelector() {
    const optionsContainer = document.getElementById('post-title-options');
    const previewEl = document.getElementById('post-title-preview');
    if (!optionsContainer || !previewEl) return;

    previewEl.innerText = getFormattedPlayerTag();
    optionsContainer.innerHTML = "";

    const candidates = [{ title: "", label: "None", unlocked: true }];
    for (const key in MASTERY_CONFIG) {
        const cfg = MASTERY_CONFIG[key];
        const mInfo = getMasteryLevelInfo(playerProfile.masteryXP[key]);
        candidates.push({
            title: cfg.title,
            label: `${cfg.title} (Lv.${mInfo.level})`,
            unlocked: mInfo.level >= 1
        });
    }

    candidates.forEach(item => {
        const isSelected = playerProfile.equippedTitle === item.title;
        const btn = document.createElement('button');
        btn.disabled = !item.unlocked;
        btn.className = `px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
            !item.unlocked
                ? "bg-black/40 border-gray-800 text-gray-600 cursor-not-allowed"
                : isSelected
                    ? "bg-amber-500 text-black border-amber-300 shadow-md cursor-pointer"
                    : "bg-black/80 text-amber-300 border-amber-500/40 hover:border-amber-400 cursor-pointer"
        }`;
        btn.innerText = item.unlocked ? item.label : `🔒 ${item.label}`;

        if (item.unlocked) {
            btn.addEventListener('click', () => {
                playerProfile.equippedTitle = item.title;
                savePlayerProfile();
                if (world.player) world.player.name = getFormattedPlayerTag();
                syncStartScreenProfileUI();
                renderPostMatchTitleSelector();
            });
        }
        optionsContainer.appendChild(btn);
    });
}

export function renderMatchVictoryUI() {
    savePlayerProfile();
    syncStartScreenProfileUI();

    const ctWon = matchState.ctScore >= 16;
    const playerWon = (ctWon && world.playerTeam === "CT") || (!ctWon && world.playerTeam === "T");

    document.getElementById('hud-overlay')?.classList.add('hidden');
    document.getElementById('gameover-screen')?.classList.remove('hidden');

    const winnerTag = document.getElementById('winner-tag');
    const winnerTitle = document.getElementById('winner-title');
    if (winnerTag) winnerTag.innerText = ctWon ? "COUNTER-TERRORISTS WIN THE MATCH!" : "TERRORISTS WIN THE MATCH!";
    if (winnerTitle) {
        winnerTitle.innerText = playerWon ? "VICTORY!" : "DEFEAT!";
        winnerTitle.className = playerWon
            ? "text-3xl md:text-4xl font-black text-green-400 tracking-wider mb-4"
            : "text-3xl md:text-4xl font-black text-red-500 tracking-wider mb-4";
    }

    document.getElementById('stat-score').innerText = `${matchState.ctScore} - ${matchState.tScore}`;
    document.getElementById('stat-kd').innerText = `${world.player ? world.player.kills : 0} / ${world.player ? world.player.deaths : 0}`;
    document.getElementById('stat-damage').innerText = matchTelemetry.damageDealt.toLocaleString();
    document.getElementById('stat-exp').innerText = `+${matchTelemetry.expGained.toLocaleString()} XP`;

    const lvlInfo = getOverallLevelInfo(playerProfile.totalDamage);
    document.getElementById('post-overall-level').innerText = `Level ${lvlInfo.level} ${lvlInfo.badgeStr}`;
    document.getElementById('post-overall-dmg-text').innerText = lvlInfo.level >= 15
        ? `${playerProfile.totalDamage.toLocaleString()} DMG (MAX)`
        : `${playerProfile.totalDamage.toLocaleString()} / ${lvlInfo.nextCeil.toLocaleString()} DMG`;
    document.getElementById('post-overall-bar').style.width = `${lvlInfo.percent}%`;

    const masteryContainer = document.getElementById('post-mastery-list');
    if (masteryContainer) {
        masteryContainer.innerHTML = "";
        for (const key in MASTERY_CONFIG) {
            const cfg = MASTERY_CONFIG[key];
            const mInfo = getMasteryLevelInfo(playerProfile.masteryXP[key]);
            const isUnlocked = mInfo.level >= 1;

            const card = document.createElement('div');
            card.className = "bg-black/70 p-2.5 rounded-lg border border-amber-500/20";
            card.innerHTML = `
                <div class="flex justify-between items-center text-xs mb-1">
                    <span class="font-bold ${isUnlocked ? 'text-amber-300' : 'text-gray-400'}">${cfg.title}</span>
                    <span class="font-black text-cyan-300">Lv.${mInfo.level} / 15</span>
                </div>
                <div class="w-full bg-black h-2 rounded-full overflow-hidden border border-gray-700 mb-1">
                    <div class="bg-cyan-400 h-full transition-all duration-500" style="width: ${mInfo.percent}%"></div>
                </div>
                <div class="flex justify-between text-[9px] text-gray-400">
                    <span>${cfg.desc}</span>
                    <span>${mInfo.level >= 15 ? 'MAX' : `${mInfo.currentXp}/${mInfo.reqForNext} XP`}</span>
                </div>
            `;
            masteryContainer.appendChild(card);
        }
    }

    renderPostMatchTitleSelector();
}

/* ==========================================================================
   BUY MENU, PAUSE MENU & ANNOUNCER BANNER
   ========================================================================== */
export function populateBuyMenu() {
    const player = world.player;
    if (!player) return;

    const moneyEl = document.getElementById('buy-menu-money');
    if (moneyEl) moneyEl.innerText = `$${player.money}`;
    const container = document.getElementById('buy-options-list');
    if (!container) return;
    container.innerHTML = '';

    const buyItems = [
        { key: "DUALIES", name: "Dual .40 Berettas", price: 400, type: "weapon" },
        { key: "DEAGLE", name: "Desert Eagle", price: 650, type: "weapon" },
        { key: "MP5", name: "MP5 Navy", price: 1500, type: "weapon" },
        { key: "VECTOR", name: "KRISS Vector", price: 2100, type: "weapon" },
        { key: player.team === "T" ? "AK47" : "M4A1", name: player.team === "T" ? "AK-47" : "M4A1", price: player.team === "T" ? 2700 : 3100, type: "weapon" },
        { key: "AWP", name: "AWP Sniper", price: 4750, type: "weapon" },
        { key: "HEGRENADE", name: "HE Grenade", price: 300, type: "grenade" },
        { key: "SMOKE", name: "Smoke Grenade", price: 300, type: "grenade" },
        { key: "FLASH", name: "Flashbang", price: 200, type: "grenade" },
        { key: "MOLOTOV", name: "Molotov", price: 400, type: "grenade" },
        { key: "KEVLAR", name: "Kevlar Vest", price: 650, type: "armor_vest" },
        { key: "ARMOR", name: "Kevlar + Helmet", price: 1000, type: "armor" },
        ...(player.team === "CT" ? [{ key: "KIT", name: "Defuse Kit", price: 400, type: "kit" }] : [])
    ];

    buyItems.forEach(item => {
        let alreadyOwned = false;
        if (item.type === "weapon") {
            if (player.primaryKey === item.key || player.secondaryKey === item.key) alreadyOwned = true;
        } else if (item.type === "grenade") {
            if (item.key === "HEGRENADE" && player.hasHE) alreadyOwned = true;
            if (item.key === "SMOKE" && player.hasSmoke) alreadyOwned = true;
            if (item.key === "FLASH" && player.hasFlash) alreadyOwned = true;
            if (item.key === "MOLOTOV" && player.hasMolotov) alreadyOwned = true;
        } else if (item.type === "armor_vest" && player.armor >= 100) {
            alreadyOwned = true;
        } else if (item.type === "armor" && player.armor >= 100 && player.hasHelmet) {
            alreadyOwned = true;
        } else if (item.type === "kit" && player.hasDefuseKit) {
            alreadyOwned = true;
        }

        const canAfford = player.money >= item.price && !alreadyOwned;
        const btn = document.createElement('button');
        btn.className = `p-3 rounded-xl border flex justify-between items-center transition-all cursor-pointer ${canAfford ? 'cs-box-bg border-amber-500/40 hover:border-amber-400 hover:bg-amber-500/10' : 'bg-black/40 border-gray-800 text-gray-600 opacity-50 cursor-not-allowed'}`;
        btn.innerHTML = `
            <div class="text-left">
                <div class="font-bold text-amber-300">${item.name} ${alreadyOwned ? '<span class="text-[10px] text-amber-500/80">(OWNED)</span>' : ''}</div>
                <div class="text-[10px] text-gray-400">${item.type.toUpperCase()}</div>
            </div>
            <div class="font-black text-green-400">${alreadyOwned ? 'MAX' : '$' + item.price}</div>
        `;

        if (canAfford) {
            btn.addEventListener('click', () => buyItem(item));
        }
        container.appendChild(btn);
    });
}

export function toggleBuyMenu() {
    const buyMenu = document.getElementById('buy-menu');
    if (!buyMenu) return;
    if (buyMenu.classList.contains('hidden')) {
        if (matchState.roundPhase !== "BUY_TIME") return;
        populateBuyMenu();
        buyMenu.classList.remove('hidden');
    } else {
        buyMenu.classList.add('hidden');
    }
}

export function togglePauseMenu(forceOpen = null) {
    const pauseMenu = document.getElementById('pause-menu');
    if (!pauseMenu) return;

    const isCurrentlyHidden = pauseMenu.classList.contains('hidden');
    const shouldOpen = forceOpen !== null ? forceOpen : isCurrentlyHidden;

    if (shouldOpen) {
        if (world.gameState === "PLAYING") {
            world.gameState = "PAUSED";
        }
        pauseMenu.classList.remove('hidden');
    } else {
        pauseMenu.classList.add('hidden');
        if (world.gameState === "PAUSED") {
            world.gameState = "PLAYING";
            window.dispatchEvent(new CustomEvent('cs:resumeLoop'));
        }
    }
}

export function returnToMainMenu() {
    world.gameState = "START";

    try {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
    } catch (e) {}

    document.getElementById('hud-overlay')?.classList.add('hidden');
    document.getElementById('pause-menu')?.classList.add('hidden');
    document.getElementById('buy-menu')?.classList.add('hidden');
    document.getElementById('scoreboard')?.classList.add('hidden');
    document.getElementById('gameover-screen')?.classList.add('hidden');
    document.getElementById('spectator-bar')?.classList.add('hidden');
    document.getElementById('action-progress-container')?.classList.add('hidden');

    const damageOverlay = document.getElementById('damage-vignette');
    if (damageOverlay) damageOverlay.style.opacity = '0';

    if (world.player) {
        world.player.isScoped = false;
        world.player.isDead = true;
    }
    c4State.plantProgress = 0;
    c4State.defuseProgress = 0;
    c4State.isBeingDefused = false;

    document.getElementById('start-screen')?.classList.remove('hidden');
    syncStartScreenProfileUI();
}

let bannerHideTimeout = null;

export function showAnnouncerBanner(title, subtext, targetTeam = "ALL", winningTeam = null) {
    if (targetTeam !== "ALL" && targetTeam !== world.playerTeam) return;

    const banner = document.getElementById('announcer-banner');
    const bannerText = document.getElementById('banner-text');
    const bannerSubtext = document.getElementById('banner-subtext');
    if (!banner || !bannerText || !bannerSubtext) return;

    bannerText.innerText = title;
    bannerSubtext.innerText = subtext;

    if (winningTeam === 'CT') {
        bannerText.className = "text-2xl md:text-3xl font-extrabold tracking-widest cs-hud-blue drop-shadow-lg";
    } else if (winningTeam === 'T') {
        bannerText.className = "text-2xl md:text-3xl font-extrabold tracking-widest cs-hud-red drop-shadow-lg";
    } else {
        bannerText.className = "text-2xl md:text-3xl font-extrabold tracking-widest cs-hud-green drop-shadow-lg";
    }

    banner.classList.remove('opacity-0', 'scale-90');
    banner.classList.add('opacity-100', 'scale-100');

    if (bannerHideTimeout) clearTimeout(bannerHideTimeout);
    bannerHideTimeout = setTimeout(() => {
        banner.classList.remove('opacity-100', 'scale-100');
        banner.classList.add('opacity-0', 'scale-90');
    }, 3500);
}

registerBannerHandler(showAnnouncerBanner);

/* ==========================================================================
   SCOREBOARD & ACTIVE HUD SYNC
   ========================================================================== */
export function updateScoreboard() {
    const sbModal = document.getElementById('scoreboard');
    if (!sbModal || sbModal.classList.contains('hidden')) return;

    const tbody = document.getElementById('scoreboard-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const player = world.player;
    const allPlayers = world.allCharacters.slice().sort((a, b) => b.kills - a.kills);

    allPlayers.forEach(p => {
        const tr = document.createElement('tr');
        const teamColor = p.team === 'CT' ? 'text-blue-400' : 'text-red-400';
        const isFriendly = (p.team === world.playerTeam || (player && player.isDead));

        const roleTag = isFriendly
            ? (p.isBot
                ? `<span class="px-1.5 py-0.5 text-[9px] rounded bg-gray-800 text-amber-300 font-bold">${p.archetype}</span>`
                : `<span class="px-1.5 py-0.5 text-[9px] rounded bg-amber-500/20 text-amber-400 font-bold">PLAYER</span>`)
            : `<span class="px-1.5 py-0.5 text-[9px] rounded bg-gray-900 text-gray-500 font-bold">ENEMY</span>`;

        const weaponDisplay = isFriendly ? p.getWeapon().name : '<span class="text-gray-600 font-mono">---</span>';
        const moneyDisplay = isFriendly ? `$${p.money}` : '<span class="text-gray-600 font-mono">---</span>';

        tr.innerHTML = `
            <td class="py-2 font-bold ${teamColor}">${p.name} ${p === player ? '(YOU)' : ''}</td>
            <td class="py-2">${roleTag}</td>
            <td class="py-2">${p.isDead ? '<span class="text-red-500 font-bold">DEAD</span>' : '<span class="text-green-400 font-bold">ALIVE</span>'}</td>
            <td class="py-2 text-gray-300">${weaponDisplay}</td>
            <td class="py-2 text-center font-bold text-amber-300">${p.kills}</td>
            <td class="py-2 text-center text-gray-400">${p.deaths}</td>
            <td class="py-2 text-right text-green-400 font-mono">${moneyDisplay}</td>
        `;
        tbody.appendChild(tr);
    });
}

export function updateHUD() {
    const player = world.player;
    if (!player) return;

    const ctAlive = world.livingCT.length;
    const tAlive = world.livingT.length;

    document.getElementById('hud-ct-score').innerText = matchState.ctScore;
    document.getElementById('hud-t-score').innerText = matchState.tScore;

    const ctAliveEl = document.getElementById('hud-ct-alive');
    const tAliveEl = document.getElementById('hud-t-alive');
    if (ctAliveEl) ctAliveEl.innerText = `${ctAlive} ALIVE`;
    if (tAliveEl) tAliveEl.innerText = `${tAlive} ALIVE`;

    document.getElementById('hud-round-phase').innerText = `ROUND ${matchState.roundNumber} / ${matchState.maxRounds}`;

    if (matchState.roundPhase === "BUY_TIME") {
        document.getElementById('hud-timer').innerText = `FREEZE: ${Math.ceil(matchState.freezeTimer)}s`;
        document.getElementById('buy-notice')?.classList.remove('hidden');
    } else {
        const mins = Math.floor(matchState.roundTimer / 60);
        const secs = Math.floor(matchState.roundTimer % 60);
        document.getElementById('hud-timer').innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        document.getElementById('buy-notice')?.classList.add('hidden');
    }

    const activeSpectateTarget = getActiveFocus() || player;

    document.getElementById('hud-health').innerText = Math.ceil(activeSpectateTarget.health);
    document.getElementById('hud-armor').innerText = Math.ceil(activeSpectateTarget.armor);
    document.getElementById('hud-money').innerText = `$${activeSpectateTarget.money}`;

    const spectateBar = document.getElementById('spectator-bar');
    if (player.isDead) {
        spectateBar?.classList.remove('hidden');
        const nameEl = document.getElementById('spectator-target-name');
        if (nameEl) nameEl.innerText = activeSpectateTarget.name;
    } else {
        spectateBar?.classList.add('hidden');
    }

    const wep = activeSpectateTarget.getWeapon();
    let wepDisplayName = wep.name;
    if (wep.category === "grenade") {
        wepDisplayName += " [L-CLICK] THROW | [R-CLICK] EXTENDED";
    } else if (wep.name.includes("AWP")) {
        const sLvl = activeSpectateTarget.scopeLevel || 0;
        if (sLvl === 1) wepDisplayName += " [SCOPED LV.1 - 20° FOV | R-CLICK ZOOM]";
        else if (sLvl === 2) wepDisplayName += " [SCOPED LV.2 - 15° FOV | R-CLICK ZOOM]";
        else if (sLvl === 3) wepDisplayName += " [SCOPED LV.3 - 11° FOV | R-CLICK UNSCOPE]";
        else wepDisplayName += " [R-CLICK SCOPE]";
    }
    document.getElementById('hud-weapon-name').innerText = wepDisplayName;

    const currentClip = activeSpectateTarget.getCurrentClip();
    const key = activeSpectateTarget.getEquippedKey();
    const currentReserve = activeSpectateTarget.reserves ? (activeSpectateTarget.reserves[key] !== undefined ? activeSpectateTarget.reserves[key] : 0) : 0;

    if (wep.category === "knife" || wep.category === "c4" || wep.category === "grenade") {
        document.getElementById('hud-ammo').innerText = "∞";
        document.getElementById('hud-reserve').innerText = "";
        document.getElementById('hud-reserve-slash')?.classList.add('hidden');
    } else {
        document.getElementById('hud-reserve-slash')?.classList.remove('hidden');
        document.getElementById('hud-ammo').innerText = activeSpectateTarget.isReloading ? "RELOAD" : currentClip;
        document.getElementById('hud-reserve').innerText = currentReserve;
    }

    document.getElementById('badge-kit')?.classList.toggle('hidden', !activeSpectateTarget.hasDefuseKit);
    document.getElementById('badge-he')?.classList.toggle('hidden', !activeSpectateTarget.hasHE);
    document.getElementById('badge-smoke')?.classList.toggle('hidden', !activeSpectateTarget.hasSmoke);
    document.getElementById('badge-flash')?.classList.toggle('hidden', !activeSpectateTarget.hasFlash);
    document.getElementById('badge-molotov')?.classList.toggle('hidden', !activeSpectateTarget.hasMolotov);
    document.getElementById('badge-c4')?.classList.toggle('hidden', !activeSpectateTarget.hasC4);

    const activeSlot = activeSpectateTarget.activeSlot;

    const updateSlotUI = (slotNum, weaponKey, nameElId, containerId) => {
        const el = document.getElementById(containerId);
        const nameEl = document.getElementById(nameElId);
        if (!el || !nameEl) return;

        if (weaponKey) {
            el.classList.remove('hidden');
            const wepInfo = WEAPONS[weaponKey];
            nameEl.innerText = wepInfo ? wepInfo.name : weaponKey;

            if (activeSlot === slotNum) {
                el.className = "cs-box-bg px-2.5 py-1 rounded-lg border-2 border-amber-400 bg-amber-500/25 text-[10px] font-extrabold text-amber-300 shadow-md scale-105 transition-all cursor-pointer";
            } else {
                el.className = "cs-box-bg px-2.5 py-1 rounded-lg border border-amber-500/30 text-[10px] font-bold text-gray-400 opacity-70 hover:opacity-100 transition-all cursor-pointer";
            }
        } else {
            el.classList.add('hidden');
        }
    };

    updateSlotUI(1, activeSpectateTarget.primaryKey, 'slot-1-name', 'slot-1');
    updateSlotUI(2, activeSpectateTarget.secondaryKey, 'slot-2-name', 'slot-2');
    updateSlotUI(3, "KNIFE", 'slot-3-name', 'slot-3');
    updateSlotUI(4, activeSpectateTarget.hasHE ? "HEGRENADE" : null, 'slot-4-he-name', 'slot-4-he');
    updateSlotUI(5, activeSpectateTarget.hasSmoke ? "SMOKE" : null, 'slot-5-smoke-name', 'slot-5-smoke');
    updateSlotUI(6, activeSpectateTarget.hasC4 ? "C4 BOMB" : null, 'slot-6-name', 'slot-6-c4');
    updateSlotUI(7, activeSpectateTarget.hasFlash ? "FLASH" : null, 'slot-7-name', 'slot-7-flash');
    updateSlotUI(8, activeSpectateTarget.hasMolotov ? "MOLOTOV" : null, 'slot-8-name', 'slot-8-molotov');

    if (c4State.isPlanted) {
        document.getElementById('hud-c4-status')?.classList.remove('hidden');
        const c4Text = document.getElementById('hud-c4-text');
        if (c4Text) c4Text.innerText = `C4 PLANTED (${Math.ceil(c4State.timer)}s)`;
    } else {
        document.getElementById('hud-c4-status')?.classList.add('hidden');
    }

    const progressContainer = document.getElementById('action-progress-container');
    const progressBar = document.getElementById('action-progress-bar');
    const progressLabel = document.getElementById('action-progress-label');

    if (c4State.plantProgress > 0 && !c4State.isPlanted) {
        progressContainer?.classList.remove('hidden');
        if (progressLabel) progressLabel.innerText = "PLANTING C4 BOMB...";
        if (progressBar) progressBar.style.width = `${Math.min(100, c4State.plantProgress * 100)}%`;
    } else if (c4State.defuseProgress > 0 && c4State.isPlanted) {
        progressContainer?.classList.remove('hidden');
        if (progressLabel) progressLabel.innerText = "DEFUSING C4 BOMB...";
        if (progressBar) progressBar.style.width = `${Math.min(100, c4State.defuseProgress * 100)}%`;
    } else {
        progressContainer?.classList.add('hidden');
    }

    updateScoreboard();
}

export function initHUDListeners() {
    loadPlayerProfile();
    syncStartScreenProfileUI();

    const nameInput = document.getElementById("player-name-input");
    const titleSelect = document.getElementById("start-title-select");
    if (nameInput) {
        nameInput.addEventListener("input", () => {
            playerProfile.name = nameInput.value.trim() || "Alex";
            savePlayerProfile();
            const previewEl = document.getElementById("start-profile-preview");
            if (previewEl) previewEl.innerText = getFormattedPlayerTag();
        });
    }
    if (titleSelect) {
        titleSelect.addEventListener("change", () => {
            playerProfile.equippedTitle = titleSelect.value;
            savePlayerProfile();
            const previewEl = document.getElementById("start-profile-preview");
            if (previewEl) previewEl.innerText = getFormattedPlayerTag();
        });
    }

    // Weapon inventory slot click listeners (replaces inline HTML onclick handlers)
    const slotBindings = [
        ['slot-1', 1],
        ['slot-2', 2],
        ['slot-3', 3],
        ['slot-4-he', 4],
        ['slot-5-smoke', 5],
        ['slot-6-c4', 6],
        ['slot-7-flash', 7],
        ['slot-8-molotov', 8]
    ];
    slotBindings.forEach(([id, slotNum]) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('click', () => {
                if (world.player && !world.player.isDead) {
                    world.player.selectSlot(slotNum);
                }
            });
        }
    });

    window.addEventListener('cs:matchStart', () => {
        if (nameInput && nameInput.value.trim() !== "") {
            playerProfile.name = nameInput.value.trim();
        }
        savePlayerProfile();
        matchTelemetry.damageDealt = 0;
        matchTelemetry.expGained = 0;
    });

    window.addEventListener('cs:playerKill', (e) => {
        const { isHeadshot, weaponName } = e.detail || {};
        playerProfile.masteryXP.kda += 100;
        matchTelemetry.expGained += 100;

        if (weaponName === "AK-47" || weaponName === "M4A1") {
            playerProfile.masteryXP.rifle += 75;
            matchTelemetry.expGained += 75;
        } else if (weaponName === "AWP SNIPER") {
            playerProfile.masteryXP.awp += 120;
            matchTelemetry.expGained += 120;
        } else if (weaponName === "KRISS Vector" || weaponName === "MP5 NAVY") {
            playerProfile.masteryXP.smg += 85;
            matchTelemetry.expGained += 85;
        }

        if (isHeadshot) {
            playerProfile.masteryXP.hs += 150;
            matchTelemetry.expGained += 150;
        }
    });

    window.addEventListener('cs:buyUpdated', () => {
        populateBuyMenu();
        updateHUD();
    });

    window.addEventListener('cs:matchVictory', () => {
        renderMatchVictoryUI();
    });
}