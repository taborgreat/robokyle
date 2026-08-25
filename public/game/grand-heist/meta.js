// ============================================================
// RoboKyle: Grand Heist — campaign layer
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

  const GH = {};

  // Rebuilding a list fires mouseenter on every card that lands under the
  // cursor, which used to machine-gun the hover sound. Rate-limit each
  // cue, and go quiet for a moment after any re-render.
  const lastPlayed = {};
  let hoverMuteUntil = 0;
  const sfx = (n) => {
    if (!GH.audio) return;
    const now = performance.now();
    if (n === 'hover' && now < hoverMuteUntil) return;
    const gap = n === 'hover' ? 110 : 45;
    if (now - (lastPlayed[n] || 0) < gap) return;
    lastPlayed[n] = now;
    GH.audio.play(n);
  };
  // call before repopulating any list of hoverable cards
  const quietRerender = () => { hoverMuteUntil = performance.now() + 420; };

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
  function makeRecruit(taken) {
    const s = GH.state;
    const t = taken || usedNames();
    const name = rollName(t);
    t.add(name);
    return {
      id: s ? s.nextCrewId++ : 0, name, level: 1, xp: 0,
      shooting: rint(T.crewStart.min, T.crewStart.max),
      carry:    rint(T.crewStart.min, T.crewStart.max),
      hpStat:   rint(0, 2),
      trait: Math.random() < 0.65 ? pick(D.TRAIT_KEYS.slice(1)) : 'none',
      skin: pick(D.SKIN_TONES), outfit: pick(D.OUTFITS).color,
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
  GH.carryCap = (c) => {
    const tr = D.TRAITS[c.trait] || {};
    const bag = D.BAGS[c.bag] || D.BAGS.none;
    return Math.round((c.carry * T.carryPerPoint + bag.carry) * (tr.carryMul || 1));
  };
  GH.dmgMul = (c) => {
    const tr = D.TRAITS[c.trait] || {};
    return (1 + c.shooting * T.shootDmgPerPoint) * (tr.shootMul || 1) * GH.moraleMul(c);
  };
  GH.spreadMul = (c) =>
    Math.max(0.35, 1 - c.shooting * T.shootSpreadPerPoint) / GH.moraleMul(c);
  GH.moveMul = (c) => {
    const tr = D.TRAITS[c.trait] || {};
    return (D.BAGS[c.bag] || D.BAGS.none).moveMod * (D.ARMOR[c.armor] || D.ARMOR.none).moveMod *
           (D.WEAPONS[c.weapon] || D.WEAPONS.knife).moveMod * (tr.moveMul || 1) *
           (0.85 + 0.15 * GH.moraleMul(c));
  };
  GH.xpToNext = (c) => T.xpPerLevel * c.level;

  // ---- morale ----
  // Above `comfortable` there is no penalty. Below it everything they do
  // gets worse, down to a floor, and it takes time on the bench to mend.
  GH.moraleMul = (c) => {
    const m = c.morale == null ? MO.start : c.morale;
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
  GH.healCost = (c) => Math.round((GH.maxHp(c) - GH.curHp(c)) * T.healCostPerHp);
  GH.healUp = (c) => {
    const cost = GH.healCost(c);
    if (cost <= 0) return false;
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

    visible.forEach(bank => {
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

      card.innerHTML =
        '<div class="bank-top">' +
          '<span class="bank-no">' + (bank.boss ? '★ BOSS' : 'Bank ' + bank.id) + '</span>' +
          (isNext  ? '<span class="bank-tag next">Next job</span>' : '') +
          (cleared ? '<span class="bank-tag done">Cleared</span>' : '') +
          (locked  ? '<span class="bank-tag lock">Locked</span>'  : '') +
        '</div>' +
        '<h3>' + bank.name + '</h3>' +
        '<div class="bank-intel">' +
          '<div class="intel take"><span class="lbl">Est. take</span><b>' + money(bank.haul) + '</b></div>' +
          '<div class="intel"><span class="lbl">Guards</span><b>' + bank.guards + '</b></div>' +
          '<div class="intel"><span class="lbl">Response</span><b>' + bank.respond + 's</b></div>' +
        '</div>' +
        '<p class="bank-police"><span class="lbl">Police</span> ' + copTierLabel(bank) + '</p>' +
        (unlocks ? '<div class="bank-unlock">Clearing unlocks ' + unlocks + '</div>' : '');

      if (!locked) {
        card.addEventListener('mouseenter', () => sfx('hover'));
        card.addEventListener('click', () => {
          GH.pendingBank = bank.id;
          sfx('select');
          GH.go('crew', { title: bank.name, sub: bank.boss ? 'Boss bank — ' + bank.bossName : 'Planning the job' });
        });
      }
      wrap.appendChild(card);
    });

    const hidden = D.BANKS.length - visible.length;
    const toggle = $('map-toggle');
    toggle.style.display = (hidden > 0 || GH.showAllBanks) ? '' : 'none';
    toggle.textContent = GH.showAllBanks
      ? 'Show only what matters'
      : 'Show all ' + D.BANKS.length + ' banks (' + hidden + ' hidden)';
  };

  // ==================== CREW + LOADOUT (one board) ====================
  // Everything you do before a job happens here: who comes, what they
  // carry, and the button that starts it. No second screen, no scrolling
  // to find "start".
  GH.editing = 0;              // 0 = RoboKyle, 1..3 = squad slots
  GH.shopTab = 'weapon';

  const boardChars = () => [GH.state.robo].concat(GH.squad());

  function avatarHtml(c, big) {
    const mask = D.MASKS[c.mask] || D.MASKS.none;
    const face = mask.color || (c.isRobo ? '#D9A97A' : c.skin);
    const fit  = c.isRobo ? '#15171F' : (c.outfit || '#2A2E38');
    return '<span class="avatar' + (big ? ' big' : '') + '"' +
           ' style="--skin:' + (c.isRobo ? '#D9A97A' : c.skin) + ';--fit:' + fit + ';--face:' + face + '">' +
           (c.isRobo ? '<i class="rk-tuft"></i>' : '') + '</span>';
  }

  function statChips(c) {
    const hp = GH.curHp(c), max = GH.maxHp(c);
    const hurt = hp < max;
    const mm = GH.moraleMul(c);
    const moraleCls = c.morale >= MO.comfortable ? '' : (c.morale >= 40 ? ' is-warn' : ' is-bad');
    return '<div class="chips">' +
      '<span class="chip" title="Shooting">' + GH.icon.stat('shooting') + '<b>' + c.shooting + '</b><small>SHT</small></span>' +
      '<span class="chip' + (hurt ? ' is-warn' : '') + '" title="Health">' + GH.icon.stat('health') +
        '<b>' + hp + '</b><small>/ ' + max + '</small></span>' +
      '<span class="chip" title="Carry capacity">' + GH.icon.stat('carry') + '<b>' + money(GH.carryCap(c)) + '</b></span>' +
      '<span class="chip' + moraleCls + '" title="Morale — below 70 every stat suffers">' +
        GH.icon.stat('morale') + '<b>' + Math.round(c.morale == null ? MO.start : c.morale) + '</b>' +
        '<small>' + GH.moraleLabel(c) + (mm < 1 ? ' ×' + mm.toFixed(2) : '') + '</small></span>' +
      '</div>';
  }

  function gearChips(c) {
    return '<div class="gear-row">' +
      '<span class="gear" title="' + D.WEAPONS[c.weapon].name + '">' + GH.icon.weapon(c.weapon) + D.WEAPONS[c.weapon].name + '</span>' +
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
      const card = el('div', 'mate-card' + (i === GH.editing ? ' is-editing' : '') + (c.isRobo ? ' is-robo' : ''));
      card.innerHTML =
        '<div class="mate-head">' +
          avatarHtml(c, true) +
          '<div class="mate-id">' +
            '<h4>' + c.name + (c.isRobo ? '<span class="you">YOU</span>' : '') + '</h4>' +
            '<p class="mate-sub">' + GH.icon.stat('level') + 'Level ' + c.level +
              (c.trait !== 'none' ? ' &middot; <b>' + tr.name + '</b>' : '') + '</p>' +
            (c.trait !== 'none' ? '<p class="trait-note">' + tr.blurb + '</p>' : '') +
          '</div>' +
        '</div>' +
        statChips(c) +
        gearChips(c) +
        '<div class="mate-actions">' +
          '<button class="btn-edit">' + (i === GH.editing ? 'Editing' : 'Edit loadout') + '</button>' +
          (GH.healCost(c) > 0
            ? '<button class="btn-heal">Patch up ' + money(GH.healCost(c)) + '</button>'
            : (c.isRobo ? '' : '<button class="btn-bench">Bench</button>')) +
        '</div>';

      card.querySelector('.btn-edit').addEventListener('click', () => {
        GH.editing = i; sfx('select'); RENDER.crew();
      });
      const healBtn = card.querySelector('.btn-heal');
      if (healBtn) healBtn.addEventListener('click', () => {
        if (GH.healUp(c)) { sfx('confirm'); GH.save(); RENDER.crew(); }
        else { sfx('error'); flash('crew-cash'); }
      });
      const bench = card.querySelector('.btn-bench');
      if (bench) bench.addEventListener('click', () => {
        const idx = s.selected.indexOf(c.id);
        if (idx >= 0) s.selected.splice(idx, 1);
        GH.editing = 0; sfx('toggle'); GH.save(); RENDER.crew();
      });
      row.appendChild(card);
    });

    // empty slots
    for (let i = chars.length; i <= T.crewPerHeist; i++) {
      if (i === 0) continue;
      const slot = el('div', 'mate-card is-empty');
      slot.innerHTML = '<p class="empty-slot">Empty slot</p>' +
        '<p class="empty-note">Bring someone, or run a person short.</p>';
      row.appendChild(slot);
    }

    // ---- bench strip ----
    const benchWrap = $('bench-strip');
    const benched = s.roster.filter(c => s.selected.indexOf(c.id) < 0);
    $('bench-wrap').style.display = benched.length ? '' : 'none';
    benchWrap.innerHTML = '';
    benched.forEach(c => {
      const b = el('button', 'bench-chip');
      b.innerHTML = avatarHtml(c) + '<span>' + c.name + '</span><small>Lv ' + c.level + '</small>';
      b.disabled = s.selected.length >= T.crewPerHeist;
      b.addEventListener('click', () => {
        if (s.selected.length >= T.crewPerHeist) return;
        s.selected.push(c.id); sfx('toggle'); GH.save(); RENDER.crew();
      });
      benchWrap.appendChild(b);
    });

    // ---- loadout panel for the selected character ----
    renderLoadout(chars[GH.editing]);

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
    return it.perk === 'loot' ? 'Faster teller grabs'
         : it.perk === 'fear' ? 'Enemies flinch' : 'Cosmetic';
  }

  function renderLoadout(c) {
    const s = GH.state;
    $('loadout-who').innerHTML = avatarHtml(c) + '<span>' + c.name + '</span>';
    $('loadout-readout').innerHTML =
      '<div><dt>Damage</dt><dd>×' + GH.dmgMul(c).toFixed(2) + '</dd></div>' +
      '<div><dt>Health</dt><dd>' + GH.maxHp(c) + '</dd></div>' +
      '<div><dt>Carry</dt><dd>' + money(GH.carryCap(c)) + '</dd></div>' +
      '<div><dt>Speed</dt><dd>×' + GH.moveMul(c).toFixed(2) + '</dd></div>';

    // tabs
    const tabs = $('loadout-tabs');
    tabs.innerHTML = '';
    SLOTS.forEach(slot => {
      const b = el('button', 'ltab' + (GH.shopTab === slot.key ? ' is-on' : ''));
      b.innerHTML = GH.icon.forSlot(slot.key, c[slot.key]) + '<span>' + slot.label + '</span>';
      b.addEventListener('click', () => { GH.shopTab = slot.key; sfx('click'); renderLoadout(c); });
      tabs.appendChild(b);
    });

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
      // How many of the squad already have one — buying is per person,
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

      card.addEventListener('mouseenter', () => sfx('hover'));
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
      note.innerHTML = future.length + ' more unlock later — next is <b>' + next.name +
        '</b> at Bank ' + next.unlock + '.';
    } else note.style.display = 'none';
  }

  // ==================== RECRUITING ====================
  GH.hireCost = () => GH.state.roster.length < T.crewPerHeist
    ? 0 : T.hireBaseCost + T.hireCostPerBank * GH.state.unlocked;

  RENDER.recruit = () => {
    if (!GH.recruitOffers) {
      const taken = usedNames();
      GH.recruitOffers = [0, 1, 2].map(() => makeRecruit(taken));
    }
    const cost = GH.hireCost();
    $('recruit-cost').textContent = cost === 0 ? 'Free' : money(cost);
    $('recruit-cash').textContent = money(GH.state.cash);
    quietRerender();
    const wrap = $('recruit-list');
    wrap.innerHTML = '';
    GH.recruitOffers.forEach(c => {
      const tr = D.TRAITS[c.trait];
      const card = el('button', 'mate-card is-offer');
      card.innerHTML =
        '<div class="mate-head">' + avatarHtml(c, true) +
          '<div class="mate-id"><h4>' + c.name + '</h4>' +
          '<p class="mate-sub">' + (c.trait !== 'none' ? '<b>' + tr.name + '</b>' : 'No standout quirk') + '</p>' +
          (c.trait !== 'none' ? '<p class="trait-note">' + tr.blurb + '</p>' : '') +
          '</div></div>' +
        statChips(c) +
        '<div class="mate-actions"><span class="btn-edit">Hire</span></div>';
      card.addEventListener('mouseenter', () => sfx('hover'));
      card.addEventListener('click', () => {
        const s = GH.state, c2 = GH.hireCost();
        if (s.cash < c2) { sfx('error'); flash('recruit-cash'); return; }
        if (s.roster.length >= T.rosterCap) return;
        s.cash -= c2;
        s.roster.push(c);
        if (s.selected.length < T.crewPerHeist) s.selected.push(c.id);
        GH.recruitOffers = null;
        GH.save();
        sfx('confirm');
        GH.go('crew');
      });
      wrap.appendChild(card);
    });
  };

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

    result.killed.forEach(id => {
      const i = s.roster.findIndex(c => c.id === id);
      if (i >= 0) s.roster.splice(i, 1);
      const j = s.selected.indexOf(id);
      if (j >= 0) s.selected.splice(j, 1);
      s.stats.deaths++;
    });

    const haulRow = el('div', 'debrief-haul');
    haulRow.innerHTML =
      '<span class="k">' + (result.escaped ? 'Extracted with' : 'Left on the floor') + '</span>' +
      '<span class="v">' + money(result.escaped ? haul : result.haul) + '</span>';
    wrap.appendChild(haulRow);

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
      const gained = Math.round(pc.kills * T.xpPerKill + pc.cash * T.xpPerCashUnit + (result.escaped ? T.xpSurvive : 0));
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

    result.perChar.filter(pc => !pc.survived && pc.char).forEach(pc => {
      const row = el('div', 'debrief-row is-dead');
      row.innerHTML = '<span class="who">' + pc.char.name + '</span>' +
        '<span class="xp">Killed in action</span>' +
        '<span class="lv">' + (pc.cash > 0 ? money(pc.cash) + ' lost' : 'Gear recovered') + '</span>';
      wrap.appendChild(row);
    });

    if (rested.length) {
      const head = el('p', 'debrief-sub', 'On the bench');
      wrap.appendChild(head);
      rested.forEach(({ c, before }) => {
        const row = el('div', 'debrief-row is-bench');
        const bits = [];
        if (GH.curHp(c) > before.hp) bits.push('+' + (GH.curHp(c) - before.hp) + ' hp');
        if (c.morale > before.morale) bits.push('+' + Math.round(c.morale - before.morale) + ' morale');
        row.innerHTML = '<span class="who">' + c.name + '</span>' +
          '<span class="xp">Resting</span>' +
          '<span class="mo up">' + bits.join(' · ') + '</span>' +
          '<span class="lv">' + GH.moraleLabel(c) + '</span>';
        wrap.appendChild(row);
      });
    }

    GH.save();
    renderLevelUps();
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
          body: 'Your current campaign — cash, crew and every weapon you have bought — will be erased. This cannot be undone.',
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
      b.addEventListener('click', () => { sfx('back'); GH.go(b.dataset.goto); }));

    $('map-toggle').addEventListener('click', () => {
      GH.showAllBanks = !GH.showAllBanks; sfx('scroll'); RENDER.map();
    });

    $('btn-hire').addEventListener('click', () => { GH.recruitOffers = null; GH.go('recruit'); });

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

    GH.show('title');
  };

  GH.money = money;
  GH.$ = $;
  GH.el = el;
  GH.flash = flash;
  GH.sfx = sfx;
  return GH;
})();
