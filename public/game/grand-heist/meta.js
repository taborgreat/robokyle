// ============================================================
// RoboKyle: Grand Heist - campaign layer
//
// Everything outside the heist itself: the save file, the crew
// roster, recruiting, the loadout board, the campaign map and
// the debrief. The in-mission engine lives in heist.js.
//
// UI rule: this game never uses browser dialogs. Confirmations
// and prompts are drawn in-game, because alert()/confirm() break
// the illusion and cannot be styled.
// ============================================================
window.GH = (() => {
  'use strict';

  const D = window.GH_DATA;
  const T = D.TUNE;
  const MO = D.MORALE;
  const LO = D.LOOT;
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

  const HAIR_COLORS = ['#2A1E18', '#40291B', '#6B4A2A', '#8A6134', '#C79A4E',
                      '#3A3A3E', '#6E6E74', '#A8A29A', '#5A2418', '#1E1A1A'];
  const HAIR_STYLE_KEYS = ['short', 'crop', 'swept', 'bun', 'braids', 'bald', 'curls'];

  const GH = {};

  const lastPlayed = {};
  const sfx = (n, opts) => {
    if (!GH.audio) return;
    const now = performance.now();
    const gap = n === 'hover' ? 55 : 40;
    if (now - (lastPlayed[n] || 0) < gap) return;
    lastPlayed[n] = now;
    GH.audio.play(n, opts);
  };

  // ---- interface sound, delegated ----
  // Every control gets hover and press feedback from one place, so new UI
  // is never silent by omission. The hover cue only fires if the pointer
  // has genuinely moved since the last one: rebuilding a list under a
  // still cursor fires an enter event per card, and those are not hovers.
  const HOVERABLE = 'button, .game-card, .bank-card, .mate-card, .item, .ltab, ' +
                    '.atab, .bench-chip, .menu-btn, .menu-back, .ghost-btn, ' +
                    '.btn-edit, .btn-bench, .btn-heal, input[type="range"], input[type="checkbox"]';
  let pointerMoved = false;
  let lastHovered = null;

  function bindInterfaceSound() {
    document.addEventListener('pointermove', () => { pointerMoved = true; }, { passive: true });

    document.addEventListener('pointerover', (e) => {
      const t = e.target.closest && e.target.closest(HOVERABLE);
      if (!t || t === lastHovered) return;
      lastHovered = t;
      if (!pointerMoved) return;        // a re-render, not a real hover
      pointerMoved = false;
      if (t.disabled || t.classList.contains('is-locked')) return;
      // a lighter, higher tick for hover so it sits under the click
      sfx('hover', { rate: 1.25, vol: 0.35 });
    }, { passive: true });

    document.addEventListener('pointerout', (e) => {
      if (e.target === lastHovered) lastHovered = null;
    }, { passive: true });

    // press feedback on anything clickable that has not asked for its own
    document.addEventListener('pointerdown', (e) => {
      const t = e.target.closest && e.target.closest(HOVERABLE);
      if (!t || t.disabled) return;
      if (t.dataset && t.dataset.noclick === '1') return;
      sfx('select', { vol: 0.7 });

      // press animation, driven from here so every control gets it
      t.classList.remove('is-pressed');
      void t.offsetWidth;                 // restart the animation
      t.classList.add('is-pressed');
      const clear = () => t.classList.remove('is-pressed');
      t.addEventListener('animationend', clear, { once: true });
      setTimeout(clear, 400);             // belt and braces if it never fires
    }, { passive: true });
  }

  const quietRerender = () => {};   // no longer needed: hovers are gated on movement

  // ==================== SETTINGS ====================
  GH.settings = { sfx: 0.6, music: 0.4, shake: true };
  try { Object.assign(GH.settings, JSON.parse(localStorage.getItem(KEY_SETTINGS) || '{}')); } catch (e) {}
  GH.saveSettings = () => {
    try { localStorage.setItem(KEY_SETTINGS, JSON.stringify(GH.settings)); } catch (e) {}
  };

  // ==================== SAVE STATE ====================
  // Everything a person owns is theirs alone, and dies with them.
  const freshOwns = () => ({
    weapons: { knife: true }, bags: { none: true },
    armor: { none: true }, masks: { none: true },
  });

  function freshRobo() {
    return {
      name: 'RoboKyle', isRobo: true, level: 1, xp: 0,
      shooting: T.roboStart.shooting, carry: T.roboStart.carry, hpStat: 0,
      trait: 'none', weapon: 'knife', bag: 'none', armor: 'none', mask: 'none',
      owns: freshOwns(),
      morale: MO.start,
      hp: null,               // filled in below once maxHp is computable
    };
  }

  function freshSave() {
    const robo = freshRobo();
    robo.hp = GH.maxHp(robo);
    return {
      version: 2, cash: 0, unlocked: 1, cleared: [],
      robo, roster: [], selected: [],
      nextCrewId: 1,
      stats: { heists: 0, wins: 0, haul: 0, deaths: 0, kills: 0, civilians: 0 },
    };
  }

  GH.state = null;
  GH.load = () => {
    try {
      const raw = localStorage.getItem(KEY_SAVE);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s) return null;
      if (s.version === 2) return s;
      if (s.version === 1) return migrateV1(s);
    } catch (e) {}
    return null;
  };

  // v1 kept one shared armory. Split it: everyone keeps what they had
  // equipped plus the free basics, and nobody loses a campaign over it.
  function migrateV1(s) {
    const shared = s.owned || {};
    const give = (c) => {
      c.owns = freshOwns();
      ['weapon', 'bag', 'armor', 'mask'].forEach(slot => {
        const table = { weapon: 'weapons', bag: 'bags', armor: 'armor', mask: 'masks' }[slot];
        if (c[slot]) c.owns[table][c[slot]] = true;
      });
      // free items are always available to everyone
      Object.keys(D.WEAPONS).forEach(k => { if (D.WEAPONS[k].cost === 0) c.owns.weapons[k] = true; });
      if (c.morale == null) c.morale = MO.start;
      if (c.hp == null) c.hp = GH.maxHp(c);
    };
    give(s.robo);
    (s.roster || []).forEach(give);
    // one goodwill payment so the split does not feel like a punishment
    const refund = Object.keys(shared.weapons || {}).reduce((sum, k) =>
      sum + ((D.WEAPONS[k] && D.WEAPONS[k].cost) || 0), 0);
    s.cash = (s.cash || 0) + Math.round(refund * 0.5);
    s.stats = s.stats || {};
    if (s.stats.civilians == null) s.stats.civilians = 0;
    delete s.owned;
    s.version = 2;
    return s;
  }
  GH.save = () => { try { localStorage.setItem(KEY_SAVE, JSON.stringify(GH.state)); } catch (e) {} };
  GH.hasSave = () => !!GH.load();

  GH.newRun = () => {
    GH.state = freshSave();
    for (let i = 0; i < T.crewPerHeist; i++) {
      const r = makeRecruit();
      r.hp = GH.maxHp(r);
      GH.state.roster.push(r);
    }
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
    const n = new Set();
    if (GH.state) GH.state.roster.forEach(c => n.add(c.name));
    return n;
  }
  function rollName(taken) {
    for (let i = 0; i < 200; i++) {
      const r = Math.random();
      const name = r < 0.45 ? pick(D.HANDLES)
                 : r < 0.78 ? pick(D.PREFIXES) + ' ' + pick(D.HANDLES)
                 : pick(D.FIRSTS) + ' "' + pick(D.TAGS) + '"';
      if (!taken.has(name)) return name;
    }
    let i = 2;
    while (taken.has(D.HANDLES[0] + ' ' + i)) i++;
    return D.HANDLES[0] + ' ' + i;
  }
  // Who is available depends on how far you have got. Early on it is
  // whoever is hanging around; by the back half of the campaign the people
  // putting themselves forward have done this for years, and the ones at
  // the top of the pile are frightening.
  function rollTier(progress) {
    const tiers = D.RECRUIT_TIERS;
    let total = 0;
    const w = tiers.map(t2 => {
      const weight = t2.weight + (t2.weightLate - t2.weight) * progress;
      total += weight;
      return weight;
    });
    let r = Math.random() * total;
    for (let i = 0; i < tiers.length; i++) {
      r -= w[i];
      if (r <= 0) return tiers[i];
    }
    return tiers[0];
  }

  function makeRecruit(taken) {
    const s = GH.state;
    const t = taken || usedNames();
    const name = rollName(t);
    t.add(name);

    // 0 at the first bank, 1 by the last
    const unlocked = s ? s.unlocked : 1;
    const progress = clamp((unlocked - 1) / (D.BANKS.length - 1), 0, 1);
    const tier = rollTier(progress);

    // Somebody worth hiring at bank 15 has been working since bank 1.
    const baseLevel = 1 + (unlocked - 1) * 0.55;
    const level = clamp(Math.round(baseLevel * tier.levelMul + rint(-1, 1)), 1, 14);

    // Their stats reflect that: the points they would have earned, plus
    // whatever their tier is worth on top.
    // Levelling hands out one point per level, so this is what they would
    // have banked getting to where they are.
    const earned = Math.max(0, level - 1);
    const spread = earned + tier.statBonus;
    const toShoot = rint(Math.floor(spread * 0.3), Math.ceil(spread * 0.7));
    const toCarry = rint(0, Math.max(0, spread - toShoot));
    const toHp = Math.max(0, spread - toShoot - toCarry);

    const rare = Math.random() < tier.rare;
    const trait = rare ? pick(D.RARE_TRAIT_KEYS)
                : Math.random() < 0.65 ? pick(D.TRAIT_KEYS.slice(1))
                : 'none';

    return {
      id: s ? s.nextCrewId++ : 0, name, level, xp: 0,
      tier: tier.key,
      shooting: rint(T.crewStart.min, T.crewStart.max) + toShoot,
      carry:    rint(T.crewStart.min, T.crewStart.max) + toCarry,
      hpStat:   rint(0, 2) + toHp,
      trait,
      skin: pick(D.SKIN_TONES), outfit: pick(D.OUTFITS).color,
      hair: pick(HAIR_COLORS), hairStyle: pick(HAIR_STYLE_KEYS),
      mask: 'none', weapon: 'knife', bag: 'none', armor: 'none',
      owns: freshOwns(), morale: MO.start, hp: null,
    };
  }
  GH.makeRecruit = makeRecruit;

  // ==================== DERIVED STATS ====================
  GH.maxHp = (c) => {
    const tr = D.TRAITS[c.trait] || {};
    return Math.round(((c.isRobo ? T.roboStart.hp : 70) + c.hpStat * T.hpPerPoint) * (tr.hpMul || 1));
  };
  // What a mask is worth, for whichever kind of perk is being asked about.
  // 1 means "no help from the mask".
  GH.maskPerk = (c, kind) => {
    const m = D.MASKS[c && c.mask] || null;
    return (m && m.perk && m.perk.kind === kind) ? m.perk.value : 1;
  };

  GH.carryCap = (c) => {
    const tr = D.TRAITS[c.trait] || {};
    const bag = D.BAGS[c.bag] || D.BAGS.none;
    // Morale drags this down with everything else. It used to be exempt,
    // which made the crew screen's claim about it untrue.
    return Math.round((c.carry * T.carryPerPoint + bag.carry) *
                      (tr.carryMul || 1) * GH.maskPerk(c, 'carry') * GH.moraleMul(c));
  };
  GH.dmgMul = (c) => {
    const tr = D.TRAITS[c.trait] || {};
    return (1 + c.shooting * T.shootDmgPerPoint) * (tr.shootMul || 1) * GH.moraleMul(c);
  };
  GH.spreadMul = (c) => {
    const tr = D.TRAITS[c.trait] || {};
    return Math.max(0.28, (1 - c.shooting * T.shootSpreadPerPoint) * (tr.spreadMul || 1)) /
           GH.moraleMul(c);
  };
  GH.moveMul = (c) => {
    const tr = D.TRAITS[c.trait] || {};
    return (D.BAGS[c.bag] || D.BAGS.none).moveMod * (D.ARMOR[c.armor] || D.ARMOR.none).moveMod *
           (D.WEAPONS[c.weapon] || D.WEAPONS.knife).moveMod * (tr.moveMul || 1) *
           (0.85 + 0.15 * GH.moraleMul(c));
  };
  GH.xpToNext = (c) => T.xpPerLevel * c.level;
  GH.xpMul = (c) => (D.TRAITS[c.trait] || {}).xpMul || 1;

  // ---- morale ----
  // Above `comfortable` there is no penalty. Below it everything they do
  // gets worse, down to a floor, and it takes time on the bench to mend.
  // A psychopath's work is not affected by how the job is going.
  GH.moraleMul = (c) => {
    if ((D.TRAITS[c.trait] || {}).moraleProof) return 1;
    return GH.moraleMulRaw(c);
  };
  // Someone resilient shrugs part of a bad night off: their working
  // morale sits closer to normal than the number on the card.
  GH.effectiveMorale = (c) => {
    const raw = c.morale == null ? MO.start : c.morale;
    const hold = (D.TRAITS[c.trait] || {}).moraleHold || 0;
    return raw + (MO.start - raw) * hold;
  };

  GH.moraleMulRaw = (c) => {
    const m = GH.effectiveMorale(c);
    if (m >= MO.comfortable) return 1;
    const t = Math.max(0, m) / MO.comfortable;
    return MO.worstMultiplier + (1 - MO.worstMultiplier) * t;
  };
  GH.moraleLabel = (c) => {
    const m = c.morale == null ? MO.start : c.morale;
    return m >= 90 ? 'Steady' : m >= 70 ? 'Fine' : m >= 45 ? 'Shaken'
         : m >= 20 ? 'Rattled' : 'Broken';
  };
  GH.adjustMorale = (c, delta) => {
    c.morale = clamp((c.morale == null ? MO.start : c.morale) + delta, MO.min, MO.start);
  };

  // ---- per-person ownership ----
  const SLOT_TABLE = { weapon: 'weapons', bag: 'bags', armor: 'armor', mask: 'masks' };
  GH.ownsItem = (c, slot, key) => {
    const table = SLOT_TABLE[slot];
    const item = ({ weapon: D.WEAPONS, bag: D.BAGS, armor: D.ARMOR, mask: D.MASKS })[slot][key];
    if (item && item.cost === 0) return true;
    if (!c.owns) c.owns = freshOwns();
    return !!c.owns[table][key];
  };
  GH.grantItem = (c, slot, key) => {
    if (!c.owns) c.owns = freshOwns();
    c.owns[SLOT_TABLE[slot]][key] = true;
  };

  // ---- health between jobs ----
  GH.curHp = (c) => (c.hp == null ? GH.maxHp(c) : clamp(c.hp, 0, GH.maxHp(c)));
  // What the doctor charges. The first few points are free, so a graze
  // does not cost you a job's takings, and the rate is per point missing
  // rather than a flat fee - a crew member who nearly died is the
  // expensive one, which is the way round it should be.
  GH.healCost = (c) => {
    const missing = GH.maxHp(c) - GH.curHp(c);
    const billed = Math.max(0, missing - (T.healFreeHp || 0));
    return Math.round(billed * T.healCostPerHp);
  };
  GH.healUp = (c) => {
    const cost = GH.healCost(c);
    // A free patch-up is still a patch-up: only refuse if they are already
    // in one piece.
    if (GH.curHp(c) >= GH.maxHp(c)) return false;
    if (cost < 0) return false;
    if (GH.state.cash < cost) return false;
    GH.state.cash -= cost;
    c.hp = GH.maxHp(c);
    return true;
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  GH.gearCost = (c, cost) => Math.round(cost * (1 - ((D.TRAITS[c.trait] || {}).discount || 0)));
  GH.squad = () => GH.state.selected.map(id => GH.state.roster.find(c => c.id === id)).filter(Boolean);

  // ==================== IN-GAME MODAL ====================
  // Replaces confirm(). Returns a promise resolving true/false.
  GH.confirm = (opts) => new Promise((resolve) => {
    const wrap = $('modal');
    $('modal-title').textContent = opts.title || 'Are you sure?';
    $('modal-body').textContent = opts.body || '';
    const yes = $('modal-yes'), no = $('modal-no');
    yes.textContent = opts.yes || 'Confirm';
    no.textContent  = opts.no  || 'Cancel';
    yes.className = 'menu-btn ' + (opts.danger ? 'is-danger' : 'is-primary');
    wrap.classList.add('active');
    sfx('open');
    const done = (v) => {
      wrap.classList.remove('active');
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      window.removeEventListener('keydown', onKey);
      sfx(v ? 'confirm' : 'back');
      resolve(v);
    };
    const onYes = () => done(true);
    const onNo  = () => done(false);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      if (e.key === 'Enter')  { e.preventDefault(); done(true); }
    };
    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
    window.addEventListener('keydown', onKey);
    yes.focus();
  });

  // ==================== SCREENS + TRANSITIONS ====================
  const SCREENS = ['title','map','crew','recruit','heist','debrief','howto','settings'];
  const RENDER = {};

  GH.show = (name) => {
    SCREENS.forEach(n => {
      const node = $('screen-' + n);
      if (node) node.classList.toggle('active', n === name);
    });
    GH.current = name;
    if (RENDER[name]) RENDER[name]();
    // music follows the screen
    if (GH.audio) {
      if (name === 'heist') GH.audio.music('heist');
      else GH.audio.music('planning');
    }
  };

  // Animated screen change: curtain wipe + a title card, so nothing
  // ever cuts straight from one screen to the next.
  let transitioning = false;
  GH.go = (name, card) => {
    if (transitioning) return;
    transitioning = true;
    const t = $('transition');
    $('transition-title').textContent = card ? card.title : '';
    $('transition-sub').textContent   = card ? card.sub   : '';
    t.classList.toggle('has-card', !!card);
    t.classList.add('is-in');
    sfx(card ? 'open' : 'click');

    const hold = card ? 620 : 130;
    setTimeout(() => {
      GH.show(name);
      t.classList.remove('is-in');
      t.classList.add('is-out');
      setTimeout(() => { t.classList.remove('is-out'); transitioning = false; }, 320);
    }, 340 + hold);
  };

  // ==================== CAMPAIGN MAP ====================
  const bankById = (id) => D.BANKS.find(b => b.id === id);
  GH.bankById = bankById;

  const copTierLabel = (bank) => bank.copWaves.length
    ? bank.copWaves.map(([k]) => D.ENEMIES[k].name).join(' / ') : 'None';

  GH.showAllBanks = false;

  const ACT_NAMES = {
    1: 'Small time',
    2: 'Getting noticed',
    3: 'Serious money',
    4: 'The big ones',
  };
  const SIZE_WORD = { small: 'Small', mid: 'Medium', large: 'Large', huge: 'Huge' };

  // Green through amber to red, for how little room a job gives you.
  function heatColor(t) {
    const stops = [[0, [95, 191, 135]], [0.5, [224, 180, 76]], [1, [196, 69, 58]]];
    for (let i = 1; i < stops.length; i++) {
      if (t > stops[i][0] && i < stops.length - 1) continue;
      const a = stops[i - 1], b = stops[i];
      const k = (t - a[0]) / (b[0] - a[0] || 1);
      const mix = (j) => Math.round(a[1][j] + (b[1][j] - a[1][j]) * clamp(k, 0, 1));
      return 'rgb(' + mix(0) + ',' + mix(1) + ',' + mix(2) + ')';
    }
    return 'rgb(196,69,58)';
  }

  RENDER.map = () => {
    const s = GH.state;
    $('map-cash').textContent = money(s.cash);
    $('map-progress').textContent = s.cleared.length + ' / ' + D.BANKS.length + ' cleared';

    // Declutter: the next job, everything already cleared, and a
    // two-bank preview of what is coming. The rest is behind a toggle.
    const visible = D.BANKS.filter(b =>
      GH.showAllBanks || b.id <= s.unlocked + 2);

    quietRerender();
    const wrap = $('map-list');
    wrap.innerHTML = '';

    // ---- how far through the whole thing you are ----
    const bar = el('div', 'campaign-bar');
    const doneN = s.cleared.length;
    bar.innerHTML =
      '<span class="cb-track"><i style="width:' +
        (doneN / D.BANKS.length * 100).toFixed(1) + '%"></i></span>' +
      '<span class="cb-text">' + doneN + ' of ' + D.BANKS.length + ' done</span>';
    wrap.appendChild(bar);

    let shownAct = null;

    visible.forEach(bank => {
      // ---- act headers, so the board reads as a campaign ----
      if (bank.act !== shownAct) {
        shownAct = bank.act;
        const inAct = D.BANKS.filter(b => b.act === shownAct);
        const clearedInAct = inAct.filter(b => s.cleared.includes(b.id)).length;
        const head = el('div', 'act-head' + (clearedInAct === inAct.length ? ' is-done' : ''));
        head.innerHTML =
          '<span class="act-no">Act ' + shownAct + '</span>' +
          '<span class="act-name">' + (ACT_NAMES[shownAct] || '') + '</span>' +
          '<span class="act-count">' + clearedInAct + ' / ' + inAct.length + '</span>';
        wrap.appendChild(head);
      }
      const locked  = bank.id > s.unlocked;
      const cleared = s.cleared.includes(bank.id);
      const isNext  = bank.id === s.unlocked && !cleared;

      const card = el('button', 'bank-card' +
        (locked ? ' is-locked' : '') + (cleared ? ' is-cleared' : '') +
        (bank.boss ? ' is-boss' : '') + (isNext ? ' is-next' : ''));
      card.disabled = locked;

      const unlocks = D.WEAPON_ORDER
        .filter(k => D.WEAPONS[k].unlock === bank.id && D.WEAPONS[k].cost > 0)
        .map(k => '<span class="unlock-chip">' + GH.icon.weapon(k) + D.WEAPONS[k].name + '</span>')
        .join('');

      // How tight the job is: what you have left once the vault is open.
      const spare = bank.respond - bank.drill;
      const heat = clamp(1 - (spare - 14) / 60, 0, 1);      // 0 easy, 1 brutal
      const heatWord = spare >= 45 ? 'Roomy' : spare >= 30 ? 'Steady'
                     : spare >= 22 ? 'Tight' : spare >= 17 ? 'Very tight' : 'Brutal';

      card.innerHTML =
        '<div class="bank-head">' +
          GH.bankMark(bank) +
          '<div class="bank-id">' +
            '<div class="bank-top">' +
              '<span class="bank-no">' + (bank.boss ? '\u2605 BOSS' : 'Bank ' + bank.id) + '</span>' +
              (isNext  ? '<span class="bank-tag next">Next job</span>' : '') +
              (cleared ? '<span class="bank-tag done">Cleared</span>' : '') +
              (locked  ? '<span class="bank-tag lock">Locked</span>'  : '') +
            '</div>' +
            '<h3>' + bank.name + '</h3>' +
            '<p class="bank-sub">' + SIZE_WORD[bank.size] + ' floor plan' +
              (bank.vaults > 1 ? ' \u00b7 ' + bank.vaults + ' vaults' : '') + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="bank-intel">' +
          '<div class="intel take"><span class="lbl">Est. take</span><b>' + money(bank.haul) + '</b></div>' +
          '<div class="intel"><span class="lbl">Guards</span><b>' + bank.guards + '</b></div>' +
          '<div class="intel"><span class="lbl">Drill</span><b>' + bank.drill + 's</b></div>' +
          '<div class="intel"><span class="lbl">Police in</span><b>' + bank.respond + 's</b></div>' +
        '</div>' +
        '<div class="bank-heat" style="--heat:' + heatColor(heat) + '">' +
          '<span class="lbl">Working time</span>' +
          '<span class="heat-track"><i style="width:' +
            ((1 - heat) * 100).toFixed(0) + '%"></i></span>' +
          '<b>' + heatWord + '</b>' +
        '</div>' +
        '<p class="bank-police"><span class="lbl">Police</span> ' + copTierLabel(bank) + '</p>' +
        (unlocks ? '<div class="bank-unlock">Clearing unlocks ' + unlocks + '</div>' : '');

      if (!locked) {
        card.addEventListener('click', () => {
          GH.pendingBank = bank.id;
          sfx('select');
          GH.go('crew', { title: bank.name, sub: bank.boss ? bank.bossName + ' is waiting inside' : 'Planning the job' });
        });
      }
      wrap.appendChild(card);
    });

    const hidden = D.BANKS.length - visible.length;
    const toggle = $('map-toggle');
    toggle.style.display = (hidden > 0 || GH.showAllBanks) ? '' : 'none';
    toggle.textContent = GH.showAllBanks
      ? 'Collapse'
      : 'Show all ' + D.BANKS.length + ' banks (' + hidden + ' hidden)';
  };

  // ==================== CREW + LOADOUT (one board) ====================
  // Everything you do before a job happens here: who comes, what they
  // carry, and the button that starts it. No second screen, no scrolling
  // to find "start".
  GH.editing = 0;              // 0 = RoboKyle, 1..3 = squad slots
  GH.shopTab = 'weapon';

  const boardChars = () => [GH.state.robo].concat(GH.squad());

  // A drawn bust rather than a coloured square: their own skin, hair,
  // outfit and whatever mask they are actually wearing.
  function avatarHtml(c, big) {
    if (!c.hair) {
      // older saves and RoboKyle have no hair recorded; derive it stably
      const seed = (c.id || 0) + (c.name || '').length;
      c.hair = HAIR_COLORS[seed % HAIR_COLORS.length];
      c.hairStyle = HAIR_STYLE_KEYS[(seed * 7) % HAIR_STYLE_KEYS.length];
    }
    return GH.portrait(c, { big: !!big });
  }

  // One stat, spelled out: icon, name, value, and a plain-English note
  // about what it changes. `tone` colours the row when something is wrong.
  function statRow(icon, name, value, note, tone) {
    return '<div class="stat-row' + (tone ? ' is-' + tone : '') + '">' +
      '<span class="stat-ico">' + GH.icon.stat(icon) + '</span>' +
      '<span class="stat-name">' + name + '</span>' +
      '<span class="stat-val">' + value + '</span>' +
      (note ? '<span class="stat-note">' + note + '</span>' : '') +
      '</div>';
  }

  // Green through amber to a deep red. t = 1 is fine, 0 is as bad as it gets.
  function conditionColor(t) {
    t = Math.max(0, Math.min(1, t));
    const stops = [
      [0.00, [96, 18, 18]], [0.28, [178, 48, 40]], [0.55, [214, 148, 58]],
      [0.80, [176, 190, 90]], [1.00, [95, 191, 135]],
    ];
    for (let i = 1; i < stops.length; i++) {
      if (t > stops[i][0] && i < stops.length - 1) continue;
      const a = stops[i - 1], b = stops[i];
      const k = Math.max(0, Math.min(1, (t - a[0]) / ((b[0] - a[0]) || 1)));
      const mix = (j) => Math.round(a[1][j] + (b[1][j] - a[1][j]) * k);
      return 'rgb(' + mix(0) + ',' + mix(1) + ',' + mix(2) + ')';
    }
    return 'rgb(95,191,135)';
  }

  // A stat row with a filled meter behind it, tinted by how bad things
  // are. Seeing morale sit deep in red says more than reading "35 / 100".
  function meterRow(icon, name, value, note, frac, color) {
    const pct = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1);
    return '<div class="stat-row has-meter" style="--cond:' + color + '">' +
      '<span class="stat-meter" style="width:' + pct + '%"></span>' +
      '<span class="stat-ico">' + GH.icon.stat(icon) + '</span>' +
      '<span class="stat-name">' + name + '</span>' +
      '<span class="stat-val">' + value + '</span>' +
      (note ? '<span class="stat-note">' + note + '</span>' : '') +
      '</div>';
  }

  function statChips(c) {
    const hp = GH.curHp(c), max = GH.maxHp(c);
    const mm = GH.moraleMul(c);
    const morale = Math.round(c.morale == null ? MO.start : c.morale);
    const hpFrac = max ? hp / max : 1;
    const moraleFrac = morale / MO.start;
    const hpNote = hpFrac >= 1 ? 'Unhurt' : hpFrac > 0.6 ? 'Grazed'
                 : hpFrac > 0.3 ? 'Wounded' : 'In a bad way';

    // What their morale is costing them, in the numbers they care about.
    // Compare each stat against the same crew member on a good day.
    const happy = Object.assign({}, c, { morale: MO.start, trait: c.trait });
    const dmgNow = GH.dmgMul(c), dmgFull = GH.dmgMul(happy);
    const carryNow = GH.carryCap(c), carryFull = GH.carryCap(happy);
    const spreadNow = GH.spreadMul(c), spreadFull = GH.spreadMul(happy);
    const shaken = mm < 0.995;

    const drop = (now, full) => Math.round((1 - now / full) * 100);
    const dmgDrop = drop(dmgNow, dmgFull);
    const carryDrop = drop(carryNow, carryFull);
    const aimDrop = Math.round((spreadNow / spreadFull - 1) * 100);

    const cost = (n, word) => n > 0
      ? '<span class="mor-cost">' + word + ' &minus;' + n + '%</span>' : '';

    return '<div class="stat-rows">' +
      statRow('shooting', 'Shooting', c.shooting,
              'Damage and aim' + (shaken && dmgDrop > 0
                ? '. Shaken: hitting for ' + dmgDrop + '% less' : ''), shaken ? 'warn' : '') +
      meterRow('health', 'Health', hp + ' / ' + max, hpNote, hpFrac, conditionColor(hpFrac)) +
      statRow('carry', 'Carry', money(carryNow),
              'Most they can take out' + (shaken && carryDrop > 0
                ? '. Shaken: ' + money(carryFull - carryNow) + ' less than usual' : ''),
              shaken ? 'warn' : '') +
      meterRow('morale', 'Morale', morale + ' / 100',
               GH.moraleLabel(c), moraleFrac, conditionColor(moraleFrac)) +
      (shaken
        ? '<div class="morale-cost">' +
            '<span class="lbl">What that costs</span>' +
            cost(dmgDrop, 'Damage') +
            cost(aimDrop, 'Aim') +
            cost(carryDrop, 'Carry') +
          '</div>'
        : '') +
      '</div>';
  }

  // The headline piece of kit, big enough to read across the room. It
  // sits next to the name because for a lot of players that one fact
  // decides who goes in.
  function weaponTag(c) {
    const w = D.WEAPONS[c.weapon];
    return '<span class="weapon-tag" title="Carrying a ' + w.name + '">' +
      GH.icon.weapon(c.weapon) + '<b>' + w.name + '</b></span>';
  }

  // A dot and a short word, coloured on the same ramp as the stat meters,
  // so you can tell at a glance who has recovered enough to go back in.
  function moralePip(c) {
    const m = Math.round(c.morale == null ? MO.start : c.morale);
    const frac = m / MO.start;
    return '<span class="morale-pip" style="--cond:' + conditionColor(frac) + '" ' +
      'title="Morale ' + m + ' out of 100, ' + GH.moraleLabel(c) + '">' +
      '<i class="pip-dot"></i>' + GH.moraleLabel(c) + '</span>';
  }

  function gearChips(c) {
    return '<div class="gear-row">' +
      '<span class="gear" title="' + D.BAGS[c.bag].name + '">' + GH.icon.bag(c.bag) + D.BAGS[c.bag].name + '</span>' +
      '<span class="gear" title="' + D.ARMOR[c.armor].name + '">' + GH.icon.armor(c.armor) + D.ARMOR[c.armor].name + '</span>' +
      '<span class="gear" title="' + D.MASKS[c.mask].name + '">' + GH.icon.mask(c.mask) + D.MASKS[c.mask].name + '</span>' +
      '</div>';
  }

  RENDER.crew = () => {
    const s = GH.state;
    const bank = bankById(GH.pendingBank);
    $('crew-cash').textContent = money(s.cash);
    $('crew-bank').textContent = bank ? bank.name : '';
    $('crew-bank-intel').innerHTML = bank
      ? '<span>' + money(bank.haul) + ' est. take</span><span>' + bank.guards + ' guards</span>' +
        '<span>' + bank.respond + 's response</span><span>' + copTierLabel(bank) + '</span>'
      : '';

    const chars = boardChars();
    if (GH.editing >= chars.length) GH.editing = 0;

    // ---- squad row ----
    quietRerender();
    const row = $('squad-row');
    row.innerHTML = '';
    chars.forEach((c, i) => {
      const tr = D.TRAITS[c.trait];
      const card = el('div', 'mate-card is-selectable' +
        (i === GH.editing ? ' is-editing' : '') + (c.isRobo ? ' is-robo' : ''));
      card.innerHTML =
        '<div class="mate-head">' +
          avatarHtml(c, true) +
          '<div class="mate-id">' +
            '<h4><span class="mate-name">' + c.name + '</span>' +
              (c.isRobo ? '<span class="you">YOU</span>' : '') +
              weaponTag(c) + '</h4>' +
            '<p class="mate-sub">' + GH.icon.stat('level') + 'Level ' + c.level +
              (c.trait !== 'none' ? ' &middot; <b>' + tr.name + '</b>' : '') + '</p>' +
            (c.trait !== 'none' ? '<p class="trait-note">' + tr.blurb + '</p>' : '') +
          '</div>' +
        '</div>' +
        statChips(c) +
        gearChips(c) +
        '<div class="mate-actions">' +
          '<button class="btn-edit">' + (i === GH.editing ? 'Editing' : 'Edit loadout') + '</button>' +
          (GH.curHp(c) < GH.maxHp(c)
            ? '<button class="btn-heal">Patch up ' +
              (GH.healCost(c) > 0 ? money(GH.healCost(c)) : 'free') + '</button>'
            : '') +
          (c.isRobo ? '' : '<button class="btn-bench">Bench</button>') +
        '</div>';

      // clicking anywhere on the card starts editing them; the button
      // stays because it is what tells you that is possible
      const startEdit = (ev) => {
        if (ev.target.closest && ev.target.closest('.btn-bench, .btn-heal')) return;
        GH.editing = i;
        RENDER.crew();
      };
      card.addEventListener('click', startEdit);
      const healBtn = card.querySelector('.btn-heal');
      if (healBtn) healBtn.addEventListener('click', () => {
        if (GH.healUp(c)) { sfx('confirm'); GH.save(); RENDER.crew(); }
        else { sfx('error'); flash('crew-cash'); }
      });
      const bench = card.querySelector('.btn-bench');
      if (bench) bench.addEventListener('click', () => {
        const idx = s.selected.indexOf(c.id);
        if (idx >= 0) s.selected.splice(idx, 1);
        GH.editing = 0; GH.save(); RENDER.crew();
      });
      row.appendChild(card);
    });

    // empty slots
    for (let i = chars.length; i <= T.crewPerHeist; i++) {
      if (i === 0) continue;
      const slot = el('button', 'mate-card is-empty');
      slot.innerHTML =
        '<span class="empty-plus">+</span>' +
        '<p class="empty-slot">Empty slot</p>' +
        '<p class="empty-note">Click to recruit somebody, or run a person short.</p>';
      slot.addEventListener('click', () => {
        GH.recruitOffers = null;
        GH.rerolls = 0;
        sfx('select');
        GH.go('recruit');
      });
      row.appendChild(slot);
    }

    // ---- bench strip ----
    const benchWrap = $('bench-strip');
    const benched = s.roster.filter(c => s.selected.indexOf(c.id) < 0);
    $('bench-wrap').style.display = benched.length ? '' : 'none';
    benchWrap.innerHTML = '';
    // Who a click would displace: whoever is being edited, unless that is
    // RoboKyle, who never sits out - then it is the last crew slot.
    const full = s.selected.length >= T.crewPerHeist;
    const editedChar = chars[GH.editing];
    const swapFor = !full ? null
      : (editedChar && !editedChar.isRobo ? editedChar
         : GH.squad()[s.selected.length - 1] || null);

    benched.forEach(c => {
      const b = el('button', 'bench-chip');
      b.innerHTML = avatarHtml(c) +
        '<span class="bench-id"><span class="bench-name">' + c.name + '</span>' +
          moralePip(c) + '</span>' +
        '<small>Lv ' + c.level + '</small>' +
        // What they are carrying matters more here than who they would
        // replace: it is the thing you are deciding on.
        '<em class="bench-gun">' + GH.icon.weapon(c.weapon) +
          D.WEAPONS[c.weapon].name + '</em>';
      b.title = swapFor ? 'Swap ' + c.name + ' in for ' + swapFor.name
                        : 'Bring ' + c.name + ' along';
      b.addEventListener('click', () => {
        if (!full) {
          s.selected.push(c.id);
          GH.editing = s.selected.length;          // land on the person you just added
        } else {
          if (!swapFor) return;
          const at = s.selected.indexOf(swapFor.id);
          if (at < 0) return;
          s.selected[at] = c.id;                   // same slot, so you stay put
          GH.editing = at + 1;                     // +1 for RoboKyle at the front
        }
        sfx('confirm');
        GH.save();
        RENDER.crew();
      });
      benchWrap.appendChild(b);
    });

    // ---- loadout panel for the selected character ----
    renderLoadout(chars[GH.editing]);
    $('crew-primer').innerHTML =
      '<b>Shooting</b> is damage and aim. <b>Carry</b> caps what they can take out of the bank. ' +
      '<b>Health</b> does not refill on its own. Pay to patch them up, or leave them on the bench to mend. ' +
      '<b>Morale</b> drops when bystanders get hurt, and drags every other stat down with it.';

    // ---- header state ----
    const short = s.roster.length < T.crewPerHeist;
    $('crew-warn').style.display = short ? '' : 'none';
    $('btn-hire').style.display = (s.roster.length < T.rosterCap) ? '' : 'none';
    $('btn-hire').textContent = short ? 'Recruit (needed)' : 'Recruit';
    $('btn-begin').disabled = false;
  };

  const SLOTS = [
    { key: 'weapon', label: 'Weapon', table: D.WEAPONS, order: D.WEAPON_ORDER, own: 'weapons' },
    { key: 'bag',    label: 'Bag',    table: D.BAGS,    order: D.BAG_ORDER,    own: 'bags' },
    { key: 'armor',  label: 'Armour', table: D.ARMOR,   order: D.ARMOR_ORDER,  own: 'armor' },
    { key: 'mask',   label: 'Mask',   table: D.MASKS,   order: D.MASK_ORDER,   own: 'masks' },
  ];

  function itemLine(slot, k) {
    const it = slot.table[k];
    if (slot.key === 'weapon') {
      return it.kind === 'melee'
        ? it.dmg + ' dmg · silent'
        : it.dmg + ' dmg · ' + (it.mag ? it.mag + ' rounds' : 'heat') + (it.pellets > 1 ? ' · ×' + it.pellets : '');
    }
    if (slot.key === 'bag')   return it.carry ? '+' + money(it.carry) + ' carry' : 'Carry stat only';
    if (slot.key === 'armor') return it.dr ? Math.round(it.dr * 100) + '% damage cut' : 'No protection';
    if (!it.perk) return 'Cosmetic';
    const pct = (v) => Math.round(Math.abs(1 - v) * 100) + '%';
    switch (it.perk.kind) {
      case 'crack':  return 'Machines open ' + pct(it.perk.value) + ' faster';
      case 'rob':    return 'Wallets ' + pct(it.perk.value) + ' faster';
      case 'calm':   return 'Panics people ' + pct(it.perk.value) + ' less far';
      case 'cow':    return 'People freeze instead of fleeing';
      case 'melee':  return '+' + pct(it.perk.value) + ' melee damage';
      case 'fear':   return 'Hostiles nearby shoot wide';
      case 'carry':  return '+' + pct(it.perk.value) + ' carry';
      case 'drill':  return 'Drills ' + pct(it.perk.value) + ' faster';
      case 'tough':  return 'Takes ' + pct(it.perk.value) + ' less damage';
      default:       return 'Cosmetic';
    }
  }

  function renderLoadout(c) {
    const s = GH.state;
    $('loadout-who').innerHTML = avatarHtml(c) + '<span>' + c.name + '</span>';
    $('loadout-readout').innerHTML =
      '<div><dt>Damage</dt><dd>×' + GH.dmgMul(c).toFixed(2) + '</dd></div>' +
      '<div><dt>Health</dt><dd>' + GH.maxHp(c) + '</dd></div>' +
      '<div><dt>Carry</dt><dd>' + money(GH.carryCap(c)) + '</dd></div>' +
      '<div><dt>Speed</dt><dd>×' + GH.moveMul(c).toFixed(2) + '</dd></div>';

    // ---- category picker ----
    // Names the slot AND what is in it right now, so the whole loadout is
    // legible without clicking through four unlabelled buttons.
    const tabs = $('loadout-tabs');
    tabs.innerHTML = '';
    SLOTS.forEach(slot => {
      const on = GH.shopTab === slot.key;
      const b = el('button', 'ltab' + (on ? ' is-on' : ''));
      b.innerHTML =
        '<span class="ltab-ico">' + GH.icon.forSlot(slot.key, c[slot.key]) + '</span>' +
        '<span class="ltab-text"><small>' + slot.label + '</small>' +
        '<b>' + slot.table[c[slot.key]].name + '</b></span>';
      b.addEventListener('click', () => { GH.shopTab = slot.key; renderLoadout(c); });
      tabs.appendChild(b);
    });

    const activeSlot = SLOTS.find(x => x.key === GH.shopTab);
    $('loadout-heading').innerHTML =
      'A <b>' + activeSlot.label.toLowerCase() + '</b> for ' + c.name +
      '. Bought for them alone, and theirs until they die.';

    const slot = SLOTS.find(x => x.key === GH.shopTab);
    quietRerender();
    const list = $('loadout-list');
    list.innerHTML = '';

    // Only show what you can actually act on: owned, or unlocked and
    // buyable. Anything gated behind a future bank is summarised in one
    // line instead of padding the page with things you cannot have.
    const shown = [], future = [];
    slot.order.forEach(k => {
      const it = slot.table[k];
      const gated = slot.key === 'weapon' && s.unlocked < it.unlock;
      const owned = GH.ownsItem(c, slot.key, k);
      if (gated && !owned) future.push(k); else shown.push(k);
    });

    shown.forEach(k => {
      const it = slot.table[k];
      const owned = GH.ownsItem(c, slot.key, k);
      const equipped = c[slot.key] === k;
      const cost = GH.gearCost(c, it.cost);
      const afford = s.cash >= cost;

      const card = el('button', 'item' + (equipped ? ' is-equipped' : '') +
        (!owned ? (afford ? ' is-buyable' : ' is-poor') : ''));
      // How many of the squad already have one - buying is per person,
      // so it matters that Bishop's shotgun is not Rico's shotgun.
      const alsoOwned = boardChars().filter(o => o !== c && GH.ownsItem(o, slot.key, k)).length;
      card.innerHTML =
        '<span class="item-ico">' + GH.icon.forSlot(slot.key, k) + '</span>' +
        '<span class="item-main">' +
          '<b>' + it.name + '</b>' +
          '<small>' + itemLine(slot, k) +
            (alsoOwned && it.cost > 0 ? ' · ' + alsoOwned + ' other' + (alsoOwned > 1 ? 's have' : ' has') + ' one' : '') +
          '</small>' +
        '</span>' +
        '<span class="item-act">' + (equipped ? 'Equipped' : owned ? 'Equip' : money(cost)) + '</span>';
      card.addEventListener('click', () => {
        if (!owned) {
          if (!afford) { sfx('error'); flash('crew-cash'); return; }
          s.cash -= cost;
          GH.grantItem(c, slot.key, k);
          sfx('confirm');
        } else sfx('click');
        c[slot.key] = k;
        // A riot shield means melee only; keep the two slots consistent.
        if (slot.key === 'armor' && D.ARMOR[k].meleeOnly && D.WEAPONS[c.weapon].kind !== 'melee') c.weapon = 'knife';
        if (slot.key === 'weapon' && D.ARMOR[c.armor].meleeOnly && D.WEAPONS[k].kind !== 'melee') c.armor = 'none';
        GH.save();
        RENDER.crew();
      });
      list.appendChild(card);
    });

    const note = $('loadout-future');
    if (future.length) {
      const next = future.map(k => slot.table[k])
        .sort((a, b) => (a.unlock || 0) - (b.unlock || 0))[0];
      note.style.display = '';
      note.innerHTML = future.length + ' more come later. Next up is <b>' + next.name +
        '</b> at Bank ' + next.unlock + '.';
    } else note.style.display = 'none';
  }

  // ==================== RECRUITING ====================
  // Short-handed after a bad job? The next body is free. Beyond that you
  // pay for what you are getting: their level, their stats, their tier,
  // and a premium for anyone with a rare trait.
  GH.hireCost = (c) => {
    if (GH.state.roster.length < T.crewPerHeist) return 0;
    const base = T.hireBaseCost + T.hireCostPerBank * GH.state.unlocked;
    if (!c) return base;

    const tier = (D.RECRUIT_TIERS.find(t2 => t2.key === c.tier) || { price: 1 });
    const stats = (c.shooting || 0) + (c.carry || 0) + (c.hpStat || 0);
    const tr = D.TRAITS[c.trait] || {};

    let worth = tier.price;
    worth *= 1 + ((c.level || 1) - 1) * 0.22;
    worth *= 1 + stats * 0.035;
    // What they are like to work with, priced both ways. Somebody lazy
    // comes cheap, and they are cheap for a reason.
    worth *= 1 + (tr.worth || 0);
    if (tr.rare) worth *= 1.35;
    return Math.max(50, Math.round(base * worth / 50) * 50);
  };

  // Don't like any of them? Put the word out again. It costs, and it costs
  // more each time you do it on the same trip, so it is a decision rather
  // than a free slot machine.
  GH.rerollCost = () => {
    const base = 120 + 40 * GH.state.unlocked;
    return Math.round(base * Math.pow(1.6, GH.rerolls || 0));
  };
  GH.rerollRecruits = () => {
    const cost = GH.rerollCost();
    if (GH.state.cash < cost) return false;
    GH.state.cash -= cost;
    GH.rerolls = (GH.rerolls || 0) + 1;
    GH.recruitOffers = null;
    GH.save();
    return true;
  };

  RENDER.recruit = () => {
    if (!GH.recruitOffers) {
      const taken = usedNames();
      GH.recruitOffers = [0, 1, 2].map(() => makeRecruit(taken));
    }
    const shortHanded = GH.state.roster.length < T.crewPerHeist;
    $('recruit-cost').textContent = shortHanded
      ? 'the next body is free'
      : 'what they are worth';
    $('recruit-cash').textContent = money(GH.state.cash);

    const rc = GH.rerollCost();
    const btn = $('btn-reroll');
    const broke = GH.state.cash < rc;
    $('reroll-price').textContent = money(rc);
    $('reroll-note').textContent = broke
      ? 'You cannot cover it'
      : (GH.rerolls ? 'Word is getting expensive' : 'Three different faces');
    btn.classList.toggle('is-broke', broke);
    btn.disabled = broke;
    btn.title = broke ? 'Not enough cash' : 'Put the word out again';
    quietRerender();
    const wrap = $('recruit-list');
    wrap.innerHTML = '';
    GH.recruitOffers.forEach(c => {
      const tr = D.TRAITS[c.trait];
      const price = GH.hireCost(c);
      const tier = D.RECRUIT_TIERS.find(t2 => t2.key === c.tier);
      const canAfford = GH.state.cash >= price;

      const card = el('button', 'mate-card is-offer' +
        (tr.rare ? ' is-rare' : '') + (canAfford ? '' : ' is-dear'));
      card.innerHTML =
        '<div class="mate-head">' + avatarHtml(c, true) +
          '<div class="mate-id">' +
            '<h4><span class="mate-name">' + c.name + '</span>' +
              (tier ? '<span class="tier-tag t-' + c.tier + '">' + tier.name + '</span>' : '') +
            '</h4>' +
            '<p class="mate-sub">' + GH.icon.stat('level') + 'Level ' + c.level +
              (c.trait !== 'none' ? ' \u00b7 <b>' + tr.name + '</b>' : '') +
              (tr.rare ? '<span class="rare-tag">Rare</span>' : '') + '</p>' +
            (c.trait !== 'none' ? '<p class="trait-note">' + tr.blurb + '</p>' : '') +
          '</div>' +
        '</div>' +
        statChips(c) +
        '<p class="recruit-note">Starts with a knife and nothing else. Anything you buy them is theirs alone.</p>' +
        '<div class="mate-actions">' +
          '<span class="btn-edit hire-btn">Hire ' +
            (price === 0 ? '\u00b7 free' : '\u00b7 ' + money(price)) + '</span>' +
        '</div>';
      card.addEventListener('click', () => {
        const s = GH.state, c2 = GH.hireCost(c);
        if (s.cash < c2) { sfx('error'); flash('recruit-cash'); return; }
        if (s.roster.length >= T.rosterCap) return;
        s.cash -= c2;
        s.roster.push(c);
        if (s.selected.length < T.crewPerHeist) s.selected.push(c.id);
        GH.recruitOffers = null;
        GH.rerolls = 0;
        GH.save();
        sfx('confirm');
        GH.go('crew');
      });
      wrap.appendChild(card);
    });
  };

  // Bring the report in a line at a time, and run the take up to its
  // figure. Cheap, and it makes a list of numbers feel like a result.
  let debriefTimers = [];
  function animateDebrief(wrap, target) {
    debriefTimers.forEach(clearTimeout);
    debriefTimers = [];

    const rows = Array.prototype.slice.call(wrap.children);
    rows.forEach((node, i) => {
      node.classList.add('db-in');
      debriefTimers.push(setTimeout(() => node.classList.add('is-shown'), 90 + i * 110));
    });

    // The figure is handed in rather than read back off the element: the
    // number is the source of truth, not the markup.
    const counter = wrap.querySelector('.db-take .v');
    if (!counter) return;
    if (!(target > 0)) { counter.textContent = money(0); return; }

    const DUR = 900;
    const started = Date.now();
    const tick = () => {
      const k = Math.min(1, (Date.now() - started) / DUR);
      const ease = 1 - Math.pow(1 - k, 3);
      counter.textContent = money(Math.round(target * ease));
      if (k < 1) debriefTimers.push(setTimeout(tick, 32));
      else counter.classList.add('is-landed');
    };
    debriefTimers.push(setTimeout(tick, 420));
  }

  function flash(id) {
    const n = $(id);
    if (!n) return;
    n.classList.remove('flash-bad');
    void n.offsetWidth;
    n.classList.add('flash-bad');
  }

  // ==================== DEBRIEF ====================
  GH.debrief = (result) => {
    const s = GH.state;
    s.stats.heists++;

    const wrap = $('debrief-body');
    wrap.innerHTML = '';

    // Getting out is worth the money you got out with. Getting the NEXT
    // bank on the board takes cracking the main vault - driving away from
    // an untouched vault is a walk, not a job.
    let haul = 0;
    const didTheJob = result.escaped && result.vaultCracked;
    if (result.escaped) {
      haul = result.haul;
      s.cash += haul;
      s.stats.haul += haul;
      if (didTheJob) {
        s.stats.wins++;
        const bank = bankById(result.bankId);
        if (!s.cleared.includes(bank.id)) s.cleared.push(bank.id);
        if (bank.id >= s.unlocked && bank.id < D.BANKS.length) s.unlocked = bank.id + 1;
      }
    }

    result.killed.forEach(id => {
      const i = s.roster.findIndex(c => c.id === id);
      if (i >= 0) s.roster.splice(i, 1);
      const j = s.selected.indexOf(id);
      if (j >= 0) s.selected.splice(j, 1);
      s.stats.deaths++;
    });

    // ---- the headline ----
    const bank = bankById(result.bankId);
    const took = result.escaped ? haul : result.haul;
    const share = bank && bank.haul ? took / bank.haul : 0;
    const verdict =
      !result.escaped && !result.abandoned ? ['Job Blown', 'You did not get out.', 'bad']
      : result.abandoned                   ? ['Walked Away', 'You called it before it went wrong.', 'warn']
      : !result.vaultCracked                ? ['Got Out Empty', 'The vault never opened, so the job does not count.', 'warn']
      : share >= 0.85                       ? ['Cleaned Out', 'They will be counting what is left for weeks.', 'good']
      : share >= 0.55                       ? ['Clean Getaway', 'A good night\'s work.', 'good']
      :                                       ['Got Away With It', 'Not everything, but enough.', 'good'];

    $('debrief-title').textContent = verdict[0];
    $('debrief-title').className = 'screen-title ' + (verdict[2] === 'good' ? 'good' : 'bad');

    const head = el('div', 'debrief-head ' + verdict[2]);
    head.innerHTML =
      '<p class="db-verdict">' + verdict[1] + '</p>' +
      '<div class="db-take">' +
        '<span class="k">' + (result.escaped ? 'Out the door with'
                              : result.abandoned ? 'Walked away from' : 'Left on the floor') + '</span>' +
        '<b class="v">' + money(0) + '</b>' +
      '</div>' +
      (bank ? '<div class="db-bar"><i style="width:' +
                (Math.min(1, share) * 100).toFixed(1) + '%"></i>' +
              '<span>' + Math.round(share * 100) + '% of what was in there</span></div>' : '');
    wrap.appendChild(head);

    // ---- the numbers behind it ----
    const kills = result.perChar.reduce((a, pc) => a + (pc.kills || 0), 0);
    const civs0 = result.civilians || 0;
    const lost = result.perChar.filter(pc => !pc.survived).length;
    const tiles = el('div', 'debrief-tiles');
    const tile = (label, value, tone) =>
      '<div class="db-tile ' + (tone || '') + '"><span class="lbl">' + label +
      '</span><b>' + value + '</b></div>';
    tiles.innerHTML =
      tile('Bank', bank ? bank.name : '?', '') +
      tile('Vault', result.vaultCracked ? 'Cracked' : 'Untouched',
           result.vaultCracked ? 'good' : 'bad') +
      tile('Hostiles down', kills, kills ? 'warn' : '') +
      tile('Bystanders hurt', civs0, civs0 ? 'bad' : 'good') +
      tile('Crew lost', lost, lost ? 'bad' : 'good');
    wrap.appendChild(tiles);

    // Say plainly why the board did not move, rather than leaving the
    // player to notice the next bank is still locked.
    if (result.escaped && !result.vaultCracked) {
      const note = el('div', 'debrief-row is-warn');
      note.innerHTML = '<span class="who">Main vault</span>' +
        '<span class="xp">Never opened</span>' +
        '<span class="lv">This bank is not done</span>';
      wrap.appendChild(note);
    }

    // ---- what the job did to the people who ran it ----
    const civs = result.civilians || 0;
    s.stats.civilians += civs;
    const onJob = result.perChar.map(pc => pc.char).filter(Boolean);
    const moraleLog = [];

    let moraleDelta = 0;
    if (civs > 0) moraleDelta += MO.civilianKill * civs;
    if (result.killed.length) moraleDelta += MO.crewDeath * result.killed.length;
    if (!result.escaped) moraleDelta += MO.failedJob;
    if (civs === 0 && result.escaped) moraleDelta += MO.cleanBonus;

    onJob.forEach(c => { if (moraleDelta) GH.adjustMorale(c, moraleDelta); });

    // A clean job lifts everyone, including the people who sat it out.
    if (civs === 0 && result.escaped) {
      s.roster.forEach(c => { if (onJob.indexOf(c) < 0) GH.adjustMorale(c, MO.cleanBonus); });
    }

    // Benched crew rest: they mend and they calm down.
    const rested = [];
    s.roster.forEach(c => {
      if (onJob.indexOf(c) >= 0) return;
      const before = { hp: GH.curHp(c), morale: c.morale };
      c.hp = Math.min(GH.maxHp(c), GH.curHp(c) + Math.round(GH.maxHp(c) * MO.benchHealFrac));
      GH.adjustMorale(c, MO.benchRecovery);
      if (c.hp !== before.hp || c.morale !== before.morale) rested.push({ c, before });
    });

    // carry wounds out of the mission
    if (result.hp) {
      Object.keys(result.hp).forEach(id => {
        const target = String(id) === 'robo' ? s.robo : s.roster.find(c => String(c.id) === String(id));
        if (target) target.hp = Math.max(1, Math.round(result.hp[id]));
      });
    }

    if (civs > 0) {
      const row = el('div', 'debrief-alert');
      row.innerHTML = '<b>' + civs + ' bystander' + (civs > 1 ? 's' : '') + ' killed.</b> ' +
        'Everyone who was on this job takes ' + Math.abs(MO.civilianKill * civs) + ' morale for it.';
      wrap.appendChild(row);
    } else if (result.escaped) {
      const row = el('div', 'debrief-good');
      row.innerHTML = '<b>Nobody innocent got hurt.</b> +' + MO.cleanBonus + ' morale to the whole crew, bench included.';
      wrap.appendChild(row);
    }

    GH.pendingLevels = [];
    result.perChar.forEach(pc => {
      const c = pc.char;
      if (!c || !pc.survived) return;
      // A fast learner takes more away from the same night's work.
      const gained = Math.round(
        (pc.kills * T.xpPerKill + pc.cash * T.xpPerCashUnit +
         (result.escaped ? T.xpSurvive : 0)) * GH.xpMul(c));
      c.xp += gained;
      let levels = 0;
      while (c.xp >= GH.xpToNext(c)) { c.xp -= GH.xpToNext(c); c.level++; levels++; }
      if (levels > 0) GH.pendingLevels.push({ char: c, points: levels });
      const row = el('div', 'debrief-row');
      const hp = GH.curHp(c), max = GH.maxHp(c);
      row.innerHTML = '<span class="who">' + c.name +
          (hp < max ? ' <em class="hurt">' + hp + '/' + max + ' hp</em>' : '') + '</span>' +
        '<span class="xp">+' + gained + ' XP</span>' +
        '<span class="mo' + (moraleDelta < 0 ? ' down' : moraleDelta > 0 ? ' up' : '') + '">' +
          (moraleDelta ? (moraleDelta > 0 ? '+' : '') + moraleDelta + ' morale' : GH.moraleLabel(c)) + '</span>' +
        '<span class="lv">Lvl ' + c.level + (levels ? ' <b class="up">+' + levels + '</b>' : '') + '</span>';
      wrap.appendChild(row);
    });

    // Only the people who are actually gone, and why. Gear is not listed
    // as recovered because it never is - it belongs to the person and it
    // goes with them.
    result.perChar.filter(pc => !pc.survived && pc.char).forEach(pc => {
      const row = el('div', 'debrief-row is-dead');
      const what = pc.fate === 'left' ? 'Left behind' : 'Killed in action';
      row.innerHTML = '<span class="who">' + pc.char.name + '</span>' +
        '<span class="xp">' + what + '</span>' +
        '<span class="mo down">' + (pc.cash > 0 ? money(pc.cash) + ' gone with them' : 'Gear lost') + '</span>' +
        '<span class="lv">Off the roster</span>';
      wrap.appendChild(row);
    });

    if (rested.length) {
      const head = el('p', 'debrief-sub', 'On the bench');
      wrap.appendChild(head);
      rested.forEach(({ c, before }) => {
        const row = el('div', 'debrief-row is-bench');
        const gainedHp = GH.curHp(c) - before.hp;
        const gainedMo = Math.round(c.morale - before.morale);
        const bits = [];
        if (gainedHp > 0) bits.push('+' + gainedHp + ' hp');
        if (gainedMo > 0) bits.push('+' + gainedMo + ' morale');

        const hurt = GH.curHp(c) < GH.maxHp(c);
        const what = gainedHp > 0
          ? (hurt ? 'Mending' : 'Back on their feet')
          : 'Sat it out';
        row.innerHTML = '<span class="who">' + c.name + '</span>' +
          '<span class="xp">' + what + '</span>' +
          '<span class="mo up">' + (bits.length ? bits.join(' · ') : 'no change') + '</span>' +
          '<span class="lv">' +
            (hurt ? GH.curHp(c) + ' / ' + GH.maxHp(c) + ' hp' : GH.moraleLabel(c)) +
          '</span>';
        wrap.appendChild(row);
      });
      const note = el('p', 'debrief-note',
        'Time off does the healing. Anybody you leave on the bench mends a little ' +
        'and steadies up every job you run without them.');
      wrap.appendChild(note);
    }

    GH.save();
    renderLevelUps();
    animateDebrief(wrap, took);

    GH.go('debrief', {
      title: result.escaped ? 'Clean Getaway' : 'Job Blown',
      sub: result.escaped ? money(haul) + ' in the bags' : 'Everyone regroups',
    });
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
      [['shooting','Shooting','shooting'],['hpStat','Max Health','health'],['carry','Carry','carry']]
        .forEach(([key, label, ico]) => {
          const b = el('button', 'menu-btn small', GH.icon.stat(ico) + label);
          b.addEventListener('click', () => {
            if (pl.points <= 0) return;
            pl.char[key]++; pl.points--;
            sfx('confirm');
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
        const c = pl.char;
        const lowest = [['shooting', c.shooting], ['hpStat', c.hpStat], ['carry', c.carry]]
          .sort((a, b) => a[1] - b[1])[0][0];
        c[lowest]++; pl.points--;
      }
    });
    GH.pendingLevels = [];
    sfx('confirm');
    GH.save();
    renderLevelUps();
  };

  // ==================== WIRING ====================
  GH.boot = () => {
    // Any click is a user gesture; that is when audio may start.
    const wake = () => { if (GH.audio) { GH.audio.resume(); GH.audio.music('planning'); } };
    window.addEventListener('pointerdown', wake, { once: true });
    window.addEventListener('keydown', wake, { once: true });

    $('btn-new').addEventListener('click', async () => {
      if (GH.hasSave()) {
        const ok = await GH.confirm({
          title: 'Start a new run?',
          body: 'This wipes the lot: your cash, your crew, and every weapon you have bought. There is no getting it back.',
          yes: 'Erase and start over', no: 'Keep my run', danger: true,
        });
        if (!ok) return;
      }
      GH.newRun();
      GH.go('map', { title: 'New Crew', sub: 'Everybody starts at the pawn shop' });
    });

    const cont = $('btn-continue');
    cont.disabled = !GH.hasSave();
    cont.addEventListener('click', () => {
      if (!GH.continueRun()) return;
      const b = bankById(GH.state.unlocked) || D.BANKS[0];
      GH.go('map', { title: 'Back to Work', sub: 'Next job: ' + b.name });
    });

    $('btn-howto').addEventListener('click', () => GH.go('howto'));
    $('btn-settings').addEventListener('click', () => GH.go('settings'));
    document.querySelectorAll('[data-goto]').forEach(b =>
      b.addEventListener('click', () => GH.go(b.dataset.goto)));

    $('map-toggle').addEventListener('click', () => {
      GH.showAllBanks = !GH.showAllBanks;
      RENDER.map();                       // press sound comes from delegation
    });

    $('btn-hire').addEventListener('click', () => {
      GH.recruitOffers = null; GH.rerolls = 0; GH.go('recruit');
    });

    $('btn-begin').addEventListener('click', () => {
      const bank = bankById(GH.pendingBank);
      GH.save();
      sfx('confirm');
      transitioning = true;
      const t = $('transition');
      $('transition-title').textContent = bank.name;
      $('transition-sub').textContent = 'Masks on.';
      t.classList.add('has-card', 'is-in');
      setTimeout(() => {
        GH.startHeist(GH.pendingBank);
        t.classList.remove('is-in');
        t.classList.add('is-out');
        setTimeout(() => { t.classList.remove('is-out', 'has-card'); transitioning = false; }, 320);
      }, 900);
    });

    $('btn-debrief-done').addEventListener('click', () => {
      const short = GH.state.roster.length < T.crewPerHeist;
      GH.go(short ? 'recruit' : 'map');
    });
    $('btn-auto-assign').addEventListener('click', GH.autoAssign);

    // settings
    const s1 = $('set-sfx'), s2 = $('set-music'), s3 = $('set-shake');
    s1.value = Math.round(GH.settings.sfx * 100);
    s2.value = Math.round(GH.settings.music * 100);
    s3.checked = GH.settings.shake;
    const sync = () => {
      $('set-sfx-val').textContent = s1.value + '%';
      $('set-music-val').textContent = s2.value + '%';
    };
    sync();
    s1.addEventListener('input', () => {
      GH.settings.sfx = s1.value / 100; sync(); GH.saveSettings();
      if (GH.audio) GH.audio.setSfxVolume(GH.settings.sfx);
    });
    s1.addEventListener('change', () => sfx('click'));
    s2.addEventListener('input', () => {
      GH.settings.music = s2.value / 100; sync(); GH.saveSettings();
      if (GH.audio) GH.audio.setMusicVolume(GH.settings.music);
    });
    s3.addEventListener('change', () => { GH.settings.shake = s3.checked; GH.saveSettings(); sfx('toggle'); });

    bindInterfaceSound();
    $('btn-reroll').addEventListener('click', () => {
      if (GH.rerollRecruits()) RENDER.recruit();
      else { sfx('error'); flash('recruit-cash'); }
    });

    GH.show('title');
  };

  GH.money = money;
  GH.$ = $;
  GH.el = el;
  GH.flash = flash;
  GH.sfx = sfx;
  return GH;
})();
