// ============================================================
// RoboKyle: Grand Heist — campaign layer
//
// Everything outside the heist itself: the save file, the crew
// roster, recruiting, the armory, the campaign map, and the
// debrief. The in-mission engine lives in heist.js and hooks in
// through the GH namespace defined here.
// ============================================================
window.GH = (() => {
  'use strict';

  const D = window.GH_DATA;
  const T = D.TUNE;
  const KEY_SAVE = 'rk_gh_save';
  const KEY_SETTINGS = 'rk_gh_settings';

  const $  = (id) => document.getElementById(id);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const GH = {};

  // ==================== SETTINGS ====================
  GH.settings = { sfx: 0.5, music: 0.3, shake: true };
  try { Object.assign(GH.settings, JSON.parse(localStorage.getItem(KEY_SETTINGS) || '{}')); } catch (e) {}
  GH.saveSettings = () => {
    try { localStorage.setItem(KEY_SETTINGS, JSON.stringify(GH.settings)); } catch (e) {}
  };

  // ==================== SAVE STATE ====================
  function freshRobo() {
    return {
      name: 'RoboKyle', isRobo: true,
      level: 1, xp: 0,
      shooting: T.roboStart.shooting,
      carry: T.roboStart.carry,
      hpStat: 0,
      trait: 'none',
      weapon: 'knife', bag: 'none', armor: 'none', mask: 'none',
    };
  }

  function freshSave() {
    return {
      version: 1,
      cash: 0,
      unlocked: 1,          // highest bank id available
      cleared: [],          // bank ids beaten
      robo: freshRobo(),
      roster: [],
      selected: [],         // crew ids brought on the next heist
      owned: { weapons: { knife: true }, bags: { none: true }, armor: { none: true }, masks: { none: true } },
      rockets: 0,
      nextCrewId: 1,
      stats: { heists: 0, wins: 0, haul: 0, deaths: 0, kills: 0 },
    };
  }

  GH.state = null;

  GH.load = () => {
    try {
      const raw = localStorage.getItem(KEY_SAVE);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.version === 1) return s;
      }
    } catch (e) {}
    return null;
  };
  GH.save = () => {
    try { localStorage.setItem(KEY_SAVE, JSON.stringify(GH.state)); } catch (e) {}
  };
  GH.hasSave = () => !!GH.load();

  GH.newRun = () => {
    GH.state = freshSave();
    // Start with a full crew of three so the first heist plays properly.
    for (let i = 0; i < T.crewPerHeist; i++) GH.state.roster.push(makeRecruit());
    GH.state.selected = GH.state.roster.slice(0, T.crewPerHeist).map(c => c.id);
    GH.save();
  };

  GH.continueRun = () => {
    const s = GH.load();
    if (!s) return false;
    GH.state = s;
    return true;
  };

  // ==================== CREW GENERATION ====================
  function usedNames() {
    const s = GH.state;
    const n = new Set();
    if (s) s.roster.forEach(c => n.add(c.name));
    return n;
  }

  function rollName(taken) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const style = Math.random();
      let name;
      if (style < 0.45)      name = pick(D.HANDLES);
      else if (style < 0.78) name = pick(D.PREFIXES) + ' ' + pick(D.HANDLES);
      else                   name = pick(D.FIRSTS) + ' "' + pick(D.TAGS) + '"';
      if (!taken.has(name)) return name;
    }
    // Fall back to a numbered handle rather than ever returning a duplicate.
    let i = 2;
    while (taken.has(D.HANDLES[0] + ' ' + i)) i++;
    return D.HANDLES[0] + ' ' + i;
  }

  function makeRecruit(taken) {
    const s = GH.state;
    const t = taken || usedNames();
    const name = rollName(t);
    t.add(name);
    return {
      id: s ? s.nextCrewId++ : 0,
      name,
      level: 1, xp: 0,
      shooting: rint(T.crewStart.min, T.crewStart.max),
      carry:    rint(T.crewStart.min, T.crewStart.max),
      hpStat:   rint(0, 2),
      trait: Math.random() < 0.65 ? pick(D.TRAIT_KEYS.slice(1)) : 'none',
      skin: pick(D.SKIN_TONES),
      outfit: pick(D.OUTFITS).color,
      mask: 'none', weapon: 'knife', bag: 'none', armor: 'none',
    };
  }
  GH.makeRecruit = makeRecruit;

  // ==================== DERIVED STATS ====================
  GH.maxHp = (c) => {
    const base = c.isRobo ? T.roboStart.hp : 70;
    const tr = D.TRAITS[c.trait] || {};
    return Math.round((base + c.hpStat * T.hpPerPoint) * (tr.hpMul || 1));
  };
  GH.carryCap = (c) => {
    const tr = D.TRAITS[c.trait] || {};
    const bag = D.BAGS[c.bag] || D.BAGS.none;
    return Math.round((c.carry * T.carryPerPoint + bag.carry) * (tr.carryMul || 1));
  };
  GH.dmgMul = (c) => {
    const tr = D.TRAITS[c.trait] || {};
    return (1 + c.shooting * T.shootDmgPerPoint) * (tr.shootMul || 1);
  };
  GH.spreadMul = (c) => Math.max(0.35, 1 - c.shooting * T.shootSpreadPerPoint);
  GH.moveMul = (c) => {
    const tr = D.TRAITS[c.trait] || {};
    const bag = D.BAGS[c.bag] || D.BAGS.none;
    const arm = D.ARMOR[c.armor] || D.ARMOR.none;
    const wpn = D.WEAPONS[c.weapon] || D.WEAPONS.knife;
    return (bag.moveMod || 1) * (arm.moveMod || 1) * (wpn.moveMod || 1) * (tr.moveMul || 1);
  };
  GH.xpToNext = (c) => T.xpPerLevel * c.level;

  GH.gearCost = (c, cost) => {
    const tr = D.TRAITS[c.trait] || {};
    return Math.round(cost * (1 - (tr.discount || 0)));
  };

  // Which crew are actually coming on the next job.
  GH.squad = () => {
    const s = GH.state;
    return s.selected.map(id => s.roster.find(c => c.id === id)).filter(Boolean);
  };

  // ==================== SCREENS ====================
  const SCREENS = ['title','map','crew','recruit','armory','heist','debrief','howto','settings'];
  GH.show = (name) => {
    SCREENS.forEach(n => {
      const node = $('screen-' + n);
      if (node) node.classList.toggle('active', n === name);
    });
    GH.current = name;
    if (name === 'map')     renderMap();
    if (name === 'crew')    renderCrew();
    if (name === 'armory')  renderArmory();
    if (name === 'recruit') renderRecruit();
  };

  // ==================== CAMPAIGN MAP ====================
  function bankById(id) { return D.BANKS.find(b => b.id === id); }
  GH.bankById = bankById;

  function copTierLabel(bank) {
    if (!bank.copWaves.length) return 'None';
    const names = bank.copWaves.map(([k]) => D.ENEMIES[k].name);
    return names.join(' / ');
  }

  function renderMap() {
    const s = GH.state;
    $('map-cash').textContent = money(s.cash);
    const wrap = $('map-list');
    wrap.innerHTML = '';

    D.BANKS.forEach(bank => {
      const locked  = bank.id > s.unlocked;
      const cleared = s.cleared.includes(bank.id);
      const card = el('button', 'bank-card' + (locked ? ' is-locked' : '') + (cleared ? ' is-cleared' : '') + (bank.boss ? ' is-boss' : ''));
      card.disabled = locked;

      const unlockList = D.WEAPON_ORDER
        .filter(k => D.WEAPONS[k].unlock === bank.id && D.WEAPONS[k].cost > 0)
        .map(k => D.WEAPONS[k].name);

      card.innerHTML =
        '<div class="bank-top">' +
          '<span class="bank-no">' + (bank.boss ? 'BOSS' : 'Bank ' + bank.id) + '</span>' +
          (cleared ? '<span class="bank-done">Cleared</span>' : '') +
          (locked ? '<span class="bank-lock">Locked</span>' : '') +
        '</div>' +
        '<h3>' + bank.name + '</h3>' +
        '<p class="bank-blurb">' + bank.blurb + '</p>' +
        '<dl class="bank-intel">' +
          '<div><dt>Vault</dt><dd>' + money(bank.haul) + '</dd></div>' +
          '<div><dt>Guards</dt><dd>' + bank.guards + ' &times; ' + D.ENEMIES[bank.guardWpn].name + '</dd></div>' +
          '<div><dt>Police</dt><dd>' + copTierLabel(bank) + '</dd></div>' +
          '<div><dt>Response</dt><dd>' + bank.respond + 's</dd></div>' +
        '</dl>' +
        (unlockList.length ? '<p class="bank-unlock">Clearing unlocks: <b>' + unlockList.join(', ') + '</b></p>' : '');

      if (!locked) card.addEventListener('click', () => { GH.pendingBank = bank.id; GH.show('crew'); });
      wrap.appendChild(card);
    });
  }

  // ==================== CREW SELECT ====================
  function statRow(c) {
    return '<div class="statline">' +
      '<span><b>' + c.shooting + '</b> SHT</span>' +
      '<span><b>' + GH.maxHp(c) + '</b> HP</span>' +
      '<span><b>' + money(GH.carryCap(c)) + '</b> carry</span>' +
      '</div>';
  }

  function crewAvatar(c) {
    const mask = D.MASKS[c.mask] || D.MASKS.none;
    const face = mask.color || c.skin;
    return '<span class="avatar" style="--skin:' + c.skin + ';--fit:' + (c.outfit || '#2A2E38') + ';--face:' + face + '"></span>';
  }

  function renderCrew() {
    const s = GH.state;
    const bank = bankById(GH.pendingBank);
    $('crew-bank').textContent = bank ? bank.name : '';
    $('crew-cash').textContent = money(s.cash);

    // Any empty roster slots must be filled before the job.
    const open = T.crewPerHeist - s.roster.length;
    $('crew-recruit-note').style.display = s.roster.length < T.crewPerHeist ? '' : 'none';

    const wrap = $('crew-list');
    wrap.innerHTML = '';

    s.roster.forEach(c => {
      const on = s.selected.includes(c.id);
      const card = el('button', 'crew-card' + (on ? ' is-picked' : ''));
      const tr = D.TRAITS[c.trait];
      card.innerHTML =
        crewAvatar(c) +
        '<div class="crew-main">' +
          '<h4>' + c.name + '</h4>' +
          '<p class="crew-sub">Lvl ' + c.level + (tr && c.trait !== 'none' ? ' &middot; ' + tr.name : '') + '</p>' +
          statRow(c) +
          '<p class="crew-gear">' + D.WEAPONS[c.weapon].name + ' &middot; ' + D.BAGS[c.bag].name + ' &middot; ' + D.ARMOR[c.armor].name + '</p>' +
        '</div>' +
        '<span class="crew-pick">' + (on ? 'ON THE JOB' : 'Bench') + '</span>';
      card.addEventListener('click', () => {
        const i = s.selected.indexOf(c.id);
        if (i >= 0) s.selected.splice(i, 1);
        else if (s.selected.length < T.crewPerHeist) s.selected.push(c.id);
        GH.save(); renderCrew();
      });
      wrap.appendChild(card);
    });

    const ready = s.selected.length === Math.min(T.crewPerHeist, s.roster.length);
    $('crew-count').textContent = s.selected.length + ' / ' + T.crewPerHeist;
    $('btn-to-armory').disabled = !ready;
    $('btn-hire').style.display = (s.roster.length < T.rosterCap) ? '' : 'none';
    $('btn-hire').textContent = s.roster.length < T.crewPerHeist
      ? 'Recruit (needed)' : 'Recruit';
  }

  // ==================== RECRUITING ====================
  GH.hireCost = () => {
    const s = GH.state;
    return s.roster.length < T.crewPerHeist
      ? 0                                   // filling a hole after a death is free
      : T.hireBaseCost + T.hireCostPerBank * s.unlocked;
  };

  function rollRecruits() {
    const taken = usedNames();
    GH.recruitOffers = [0,1,2].map(() => {
      const r = makeRecruit(taken);
      return r;
    });
  }

  function renderRecruit() {
    if (!GH.recruitOffers) rollRecruits();
    const cost = GH.hireCost();
    $('recruit-cost').textContent = cost === 0 ? 'Free' : money(cost);
    $('recruit-cash').textContent = money(GH.state.cash);
    const wrap = $('recruit-list');
    wrap.innerHTML = '';
    GH.recruitOffers.forEach(c => {
      const tr = D.TRAITS[c.trait];
      const card = el('button', 'crew-card');
      card.innerHTML =
        crewAvatar(c) +
        '<div class="crew-main">' +
          '<h4>' + c.name + '</h4>' +
          '<p class="crew-sub">' + (c.trait !== 'none' ? tr.name + ' &mdash; ' + tr.blurb : 'No standout quirk.') + '</p>' +
          statRow(c) +
        '</div>' +
        '<span class="crew-pick">Hire</span>';
      card.addEventListener('click', () => {
        const s = GH.state;
        const c2 = GH.hireCost();
        if (s.cash < c2) { flash('recruit-cash'); return; }
        if (s.roster.length >= T.rosterCap) return;
        s.cash -= c2;
        s.roster.push(c);
        if (s.selected.length < T.crewPerHeist) s.selected.push(c.id);
        GH.recruitOffers = null;
        GH.save();
        GH.show('crew');
      });
      wrap.appendChild(card);
    });
  }

  function flash(id) {
    const n = $(id);
    if (!n) return;
    n.classList.remove('flash-bad');
    void n.offsetWidth;
    n.classList.add('flash-bad');
  }

  // ==================== ARMORY ====================
  GH.armoryTarget = 0;   // 0 = RoboKyle, 1..3 = squad slots

  function armoryChars() {
    return [GH.state.robo].concat(GH.squad());
  }

  function isUnlocked(w) { return GH.state.unlocked >= D.WEAPONS[w].unlock; }

  function renderArmory() {
    const s = GH.state;
    const chars = armoryChars();
    if (GH.armoryTarget >= chars.length) GH.armoryTarget = 0;
    const c = chars[GH.armoryTarget];

    $('armory-cash').textContent = money(s.cash);
    const bank = bankById(GH.pendingBank);
    $('armory-bank').textContent = bank ? bank.name : '';

    // --- character tabs ---
    const tabs = $('armory-tabs');
    tabs.innerHTML = '';
    chars.forEach((ch, i) => {
      const t = el('button', 'atab' + (i === GH.armoryTarget ? ' is-on' : ''));
      t.innerHTML = crewAvatar(ch.isRobo ? { skin: '#D9A97A', outfit: '#15171F', mask: ch.mask } : ch) +
        '<span>' + ch.name + '</span>';
      t.addEventListener('click', () => { GH.armoryTarget = i; renderArmory(); });
      tabs.appendChild(t);
    });

    // --- readout ---
    $('armory-readout').innerHTML =
      '<div><dt>Damage</dt><dd>&times;' + GH.dmgMul(c).toFixed(2) + '</dd></div>' +
      '<div><dt>Health</dt><dd>' + GH.maxHp(c) + '</dd></div>' +
      '<div><dt>Carry</dt><dd>' + money(GH.carryCap(c)) + '</dd></div>' +
      '<div><dt>Speed</dt><dd>&times;' + GH.moveMul(c).toFixed(2) + '</dd></div>';

    buildShop('shop-weapons', D.WEAPON_ORDER, D.WEAPONS, 'weapons', 'weapon', c, (k) => {
      const w = D.WEAPONS[k];
      let line = w.kind === 'melee'
        ? w.dmg + ' dmg &middot; silent'
        : w.dmg + ' dmg &middot; ' + (w.mag ? w.mag + ' mag' : 'heat') + (w.pellets > 1 ? ' &middot; x' + w.pellets : '');
      return line;
    });
    buildShop('shop-bags', D.BAG_ORDER, D.BAGS, 'bags', 'bag', c, (k) => '+' + money(D.BAGS[k].carry) + ' carry');
    buildShop('shop-armor', D.ARMOR_ORDER, D.ARMOR, 'armor', 'armor', c, (k) => Math.round(D.ARMOR[k].dr * 100) + '% damage cut');
    buildShop('shop-masks', D.MASK_ORDER, D.MASKS, 'masks', 'mask', c, (k) => {
      const m = D.MASKS[k];
      return m.perk === 'loot' ? 'Perk: faster teller grabs'
           : m.perk === 'fear' ? 'Perk: nearby enemies flinch'
           : 'Cosmetic';
    });

    $('btn-launch').textContent = 'Start the job →';
  }

  function buildShop(containerId, order, table, ownKey, slot, c, lineFn) {
    const s = GH.state;
    const wrap = $(containerId);
    wrap.innerHTML = '';
    order.forEach(k => {
      const item = table[k];
      const owned = !!s.owned[ownKey][k] || item.cost === 0;
      const gated = (ownKey === 'weapons') && !isUnlocked(k);
      const equipped = c[slot] === k;
      const cost = GH.gearCost(c, item.cost);

      const card = el('button', 'shop-item' +
        (equipped ? ' is-equipped' : '') +
        (gated ? ' is-gated' : '') +
        (!owned && !gated ? ' is-buyable' : ''));
      card.disabled = gated;

      let action;
      if (gated)        action = 'Bank ' + item.unlock;
      else if (equipped) action = 'Equipped';
      else if (owned)    action = 'Equip';
      else               action = money(cost);

      card.innerHTML =
        '<div class="shop-head"><b>' + item.name + '</b><span class="shop-act">' + action + '</span></div>' +
        '<p class="shop-line">' + lineFn(k) + '</p>' +
        (item.blurb ? '<p class="shop-blurb">' + item.blurb + '</p>' : '');

      card.addEventListener('click', () => {
        if (gated) return;
        if (!owned) {
          if (s.cash < cost) { flash('armory-cash'); return; }
          s.cash -= cost;
          s.owned[ownKey][k] = true;
        }
        // A riot shield forces melee; swapping to it swaps your gun out.
        c[slot] = k;
        if (slot === 'armor' && D.ARMOR[k].meleeOnly && D.WEAPONS[c.weapon].kind !== 'melee') c.weapon = 'knife';
        if (slot === 'weapon' && D.ARMOR[c.armor] && D.ARMOR[c.armor].meleeOnly && D.WEAPONS[k].kind !== 'melee') c.armor = 'none';
        GH.save();
        renderArmory();
      });
      wrap.appendChild(card);
    });
  }

  // ==================== DEBRIEF ====================
  // result: { escaped, haul, killed:[names], perChar:[{char, cash, kills, survived}] , bankId }
  GH.debrief = (result) => {
    const s = GH.state;
    s.stats.heists++;

    const wrap = $('debrief-body');
    wrap.innerHTML = '';

    $('debrief-title').textContent = result.escaped ? 'Clean Getaway' : 'Job Blown';
    $('debrief-title').className = 'screen-title ' + (result.escaped ? 'good' : 'bad');

    let haul = 0;
    if (result.escaped) {
      haul = result.haul;
      s.cash += haul;
      s.stats.haul += haul;
      s.stats.wins++;
      const bank = bankById(result.bankId);
      if (!s.cleared.includes(bank.id)) s.cleared.push(bank.id);
      if (bank.id >= s.unlocked && bank.id < D.BANKS.length) s.unlocked = bank.id + 1;
    }

    // Casualties: brought crew who died are gone for good.
    result.killed.forEach(id => {
      const i = s.roster.findIndex(c => c.id === id);
      if (i >= 0) s.roster.splice(i, 1);
      const j = s.selected.indexOf(id);
      if (j >= 0) s.selected.splice(j, 1);
      s.stats.deaths++;
    });

    const haulRow = el('div', 'debrief-haul');
    haulRow.innerHTML =
      '<span class="k">' + (result.escaped ? 'Extracted with' : 'Cash lost in the building') + '</span>' +
      '<span class="v">' + money(result.escaped ? haul : result.haul) + '</span>';
    wrap.appendChild(haulRow);

    // XP + level ups for everyone who walked out.
    GH.pendingLevels = [];
    result.perChar.forEach(pc => {
      const c = pc.char;
      if (!c) return;
      if (!pc.survived) return;
      const gained = Math.round(pc.kills * T.xpPerKill + pc.cash * T.xpPerCashUnit + (result.escaped ? T.xpSurvive : 0));
      c.xp += gained;
      let levels = 0;
      while (c.xp >= GH.xpToNext(c)) { c.xp -= GH.xpToNext(c); c.level++; levels++; }
      if (levels > 0) GH.pendingLevels.push({ char: c, points: levels });

      const row = el('div', 'debrief-row');
      row.innerHTML =
        '<span class="who">' + c.name + '</span>' +
        '<span class="xp">+' + gained + ' XP</span>' +
        '<span class="lv">Lvl ' + c.level + (levels ? ' <b class="up">+' + levels + '</b>' : '') + '</span>';
      wrap.appendChild(row);
    });

    result.perChar.filter(pc => !pc.survived && pc.char).forEach(pc => {
      const row = el('div', 'debrief-row is-dead');
      row.innerHTML = '<span class="who">' + pc.char.name + '</span><span class="xp">Killed in action</span>' +
        '<span class="lv">' + (pc.cash > 0 ? money(pc.cash) + ' lost' : 'Gear recovered') + '</span>';
      wrap.appendChild(row);
    });

    GH.save();
    renderLevelUps();
    GH.show('debrief');
  };

  function renderLevelUps() {
    const wrap = $('debrief-levels');
    wrap.innerHTML = '';
    if (!GH.pendingLevels || !GH.pendingLevels.length) {
      $('debrief-levels-wrap').style.display = 'none';
      $('btn-debrief-done').disabled = false;
      return;
    }
    $('debrief-levels-wrap').style.display = '';
    $('btn-debrief-done').disabled = true;

    GH.pendingLevels.forEach(pl => {
      const row = el('div', 'levelup');
      row.innerHTML = '<h4>' + pl.char.name + ' <span>' + pl.points + ' point' + (pl.points > 1 ? 's' : '') + '</span></h4>';
      const btns = el('div', 'levelup-btns');
      [['shooting','Shooting'],['hpStat','Max Health'],['carry','Carry']].forEach(([key, label]) => {
        const b = el('button', 'menu-btn small', label);
        b.addEventListener('click', () => {
          if (pl.points <= 0) return;
          pl.char[key]++;
          pl.points--;
          GH.save();
          if (pl.points <= 0) GH.pendingLevels = GH.pendingLevels.filter(x => x !== pl);
          renderLevelUps();
        });
        btns.appendChild(b);
      });
      row.appendChild(btns);
      wrap.appendChild(row);
    });
  }

  GH.autoAssign = () => {
    if (!GH.pendingLevels) return;
    GH.pendingLevels.forEach(pl => {
      while (pl.points > 0) {
        // Round the character out: whichever stat is lagging gets the point.
        const c = pl.char;
        const lowest = [['shooting', c.shooting], ['hpStat', c.hpStat], ['carry', c.carry]]
          .sort((a, b) => a[1] - b[1])[0][0];
        c[lowest]++;
        pl.points--;
      }
    });
    GH.pendingLevels = [];
    GH.save();
    renderLevelUps();
  };

  // ==================== WIRING ====================
  GH.boot = () => {
    $('btn-new').addEventListener('click', () => {
      if (GH.hasSave() && !confirm('Start a new run? Your current campaign will be overwritten.')) return;
      GH.newRun(); GH.show('map');
    });
    const cont = $('btn-continue');
    cont.disabled = !GH.hasSave();
    cont.addEventListener('click', () => { if (GH.continueRun()) GH.show('map'); });

    $('btn-howto').addEventListener('click', () => GH.show('howto'));
    $('btn-settings').addEventListener('click', () => GH.show('settings'));

    document.querySelectorAll('[data-goto]').forEach(b => {
      b.addEventListener('click', () => GH.show(b.dataset.goto));
    });

    $('btn-hire').addEventListener('click', () => { GH.recruitOffers = null; GH.show('recruit'); });
    $('btn-to-armory').addEventListener('click', () => GH.show('armory'));
    $('btn-launch').addEventListener('click', () => {
      GH.save();
      GH.startHeist(GH.pendingBank);
    });
    $('btn-debrief-done').addEventListener('click', () => {
      // A wiped roster gets refilled before you can take another job.
      GH.show(GH.state.roster.length < T.crewPerHeist ? 'recruit' : 'map');
    });
    $('btn-auto-assign').addEventListener('click', GH.autoAssign);

    // settings
    const sfx = $('set-sfx'), mus = $('set-music'), shake = $('set-shake');
    sfx.value = Math.round(GH.settings.sfx * 100);
    mus.value = Math.round(GH.settings.music * 100);
    shake.checked = GH.settings.shake;
    const syncLabels = () => {
      $('set-sfx-val').textContent = sfx.value + '%';
      $('set-music-val').textContent = mus.value + '%';
    };
    syncLabels();
    sfx.addEventListener('input', () => { GH.settings.sfx = sfx.value / 100; syncLabels(); GH.saveSettings(); GH.onVolume && GH.onVolume(); });
    mus.addEventListener('input', () => { GH.settings.music = mus.value / 100; syncLabels(); GH.saveSettings(); GH.onVolume && GH.onVolume(); });
    shake.addEventListener('change', () => { GH.settings.shake = shake.checked; GH.saveSettings(); });

    GH.show('title');
  };

  GH.money = money;
  GH.$ = $;
  GH.el = el;
  GH.flash = flash;
  return GH;
})();
