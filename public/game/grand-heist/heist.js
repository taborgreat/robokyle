// ============================================================
// RoboKyle: Grand Heist — in-mission engine
//
// Spawn at the car, break in, trip the alarm, drill the vault,
// grab everything you can carry, survive the response, drive off.
// Reads GH_DATA for all tuning; reports back to GH.debrief().
// ============================================================
(() => {
  'use strict';

  const D = window.GH_DATA;
  const T = D.TUNE;
  const GH = window.GH;

  const canvas = document.getElementById('heist-canvas');
  const ctx = canvas.getContext('2d');

  // ==================== UTIL ====================
  const rand  = (a, b) => a + Math.random() * (b - a);
  const rint  = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const lerp  = (a, b, t) => a + (b - a) * t;
  const money = GH.money;

  function circleRect(cx, cy, r, R) {
    const nx = clamp(cx, R.x, R.x + R.w);
    const ny = clamp(cy, R.y, R.y + R.h);
    return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
  }

  // Segment vs axis-aligned rect — used for line of sight and bullet walls.
  function segRect(x1, y1, x2, y2, R) {
    if (x1 >= R.x && x1 <= R.x + R.w && y1 >= R.y && y1 <= R.y + R.h) return true;
    const lines = [
      [R.x, R.y, R.x + R.w, R.y],
      [R.x + R.w, R.y, R.x + R.w, R.y + R.h],
      [R.x + R.w, R.y + R.h, R.x, R.y + R.h],
      [R.x, R.y + R.h, R.x, R.y],
    ];
    for (const [x3, y3, x4, y4] of lines) {
      const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
      if (Math.abs(d) < 1e-9) continue;
      const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
      const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
    }
    return false;
  }

  // ==================== AUDIO ====================
  let actx = null, sfxGain = null, musGain = null, sirenOsc = null, sirenGain = null;
  function ensureAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      sfxGain = actx.createGain(); sfxGain.gain.value = GH.settings.sfx; sfxGain.connect(actx.destination);
      musGain = actx.createGain(); musGain.gain.value = GH.settings.music; musGain.connect(actx.destination);
    } catch (e) { actx = null; }
  }
  GH.onVolume = () => {
    if (sfxGain) sfxGain.gain.value = GH.settings.sfx;
    if (musGain) musGain.gain.value = GH.settings.music;
  };
  function tone(f, dur, type, vol, dest) {
    if (!actx) return;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'square'; o.frequency.value = f;
    g.gain.setValueAtTime(vol, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g); g.connect(dest || sfxGain); o.start(); o.stop(actx.currentTime + dur);
  }
  function noise(dur, vol, freq, q) {
    if (!actx) return;
    const n = Math.floor(actx.sampleRate * dur);
    const buf = actx.createBuffer(1, n, actx.sampleRate);
    const dat = buf.getChannelData(0);
    for (let i = 0; i < n; i++) dat[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = actx.createBufferSource(); src.buffer = buf;
    const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 1200; f.Q.value = q || 0.8;
    const g = actx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(sfxGain); src.start();
  }
  const sfx = {
    shot(w) {
      const k = w.kind;
      if (k === 'shotgun') { noise(0.20, 0.32, 700, 0.7); tone(90, 0.14, 'square', 0.16); }
      else if (k === 'explosive') { noise(0.5, 0.4, 220, 0.5); tone(60, 0.4, 'sine', 0.3); }
      else if (k === 'energy' || k === 'exotic') { tone(880, 0.10, 'sawtooth', 0.10); tone(1500, 0.07, 'sine', 0.06); }
      else if (k === 'lmg') { noise(0.07, 0.20, 1100, 0.9); tone(150, 0.05, 'square', 0.09); }
      else { noise(0.08, 0.22, 1500, 0.9); tone(210, 0.05, 'square', 0.10); }
    },
    melee() { noise(0.12, 0.20, 500, 1.2); },
    hit()   { noise(0.06, 0.14, 2200, 1.4); },
    hurt()  { tone(160, 0.16, 'sawtooth', 0.16); },
    pickup(){ tone(880, 0.07, 'triangle', 0.11); tone(1320, 0.07, 'triangle', 0.08); },
    reload(){ noise(0.05, 0.10, 900, 1.5); setTimeout(() => noise(0.05, 0.10, 600, 1.5), 110); },
    drill() { noise(0.09, 0.05, 380, 2.2); },
    alarm() { tone(760, 0.5, 'square', 0.14); setTimeout(() => tone(560, 0.5, 'square', 0.14), 260); },
    boom()  { noise(0.55, 0.42, 180, 0.5); tone(52, 0.5, 'sine', 0.32); },
    down()  { tone(120, 0.5, 'sawtooth', 0.2); },
    revive(){ tone(520, 0.12, 'triangle', 0.14); setTimeout(() => tone(780, 0.14, 'triangle', 0.14), 120); },
    cash()  { tone(1040, 0.09, 'square', 0.09); },
  };
  function startSiren() {
    if (!actx || sirenOsc) return;
    sirenOsc = actx.createOscillator();
    sirenGain = actx.createGain();
    sirenOsc.type = 'sine';
    sirenGain.gain.value = 0.05;
    const lfo = actx.createOscillator(), lg = actx.createGain();
    lfo.frequency.value = 0.6; lg.gain.value = 150;
    lfo.connect(lg); lg.connect(sirenOsc.frequency);
    sirenOsc.frequency.value = 620;
    sirenOsc.connect(sirenGain); sirenGain.connect(musGain);
    sirenOsc.start(); lfo.start();
  }
  function stopSiren() {
    if (sirenOsc) { try { sirenOsc.stop(); } catch (e) {} sirenOsc = null; }
  }

  // ==================== STATE ====================
  let H = null;
  const keys = {};
  const mouse = { x: 0, y: 0, down: false, wx: 0, wy: 0 };

  // ==================== WORLD GENERATION ====================
  const SIZES = {
    small: { w: 1250, h: 950,  lobby: 0.56 },
    mid:   { w: 1550, h: 1150, lobby: 0.54 },
    large: { w: 1950, h: 1400, lobby: 0.52 },
    huge:  { w: 2350, h: 1700, lobby: 0.50 },
  };
  const STREET = 230;
  const WALL = 18;

  function generateWorld(bank) {
    const S = SIZES[bank.size];
    const W = S.w, Hh = S.h;
    const obstacles = [];   // {x,y,w,h,low,breakable,kind}
    const loot = [];        // {x,y,r,amount,kind,locked}
    const world = { w: W, h: Hh, obstacles, loot, vaults: [], boxes: [] };

    const bx = 90, by = 70;
    const bw = W - 180, bh = Hh - STREET - by;
    world.building = { x: bx, y: by, w: bw, h: bh };

    const doorW = 130;
    const doorX = bx + bw / 2 - doorW / 2;
    world.door = { x: doorX, y: by + bh - WALL, w: doorW, h: WALL };

    // ---- outer shell (front wall split around the door) ----
    obstacles.push({ x: bx, y: by, w: bw, h: WALL, kind: 'wall' });                       // back
    obstacles.push({ x: bx, y: by, w: WALL, h: bh, kind: 'wall' });                       // left
    obstacles.push({ x: bx + bw - WALL, y: by, w: WALL, h: bh, kind: 'wall' });           // right
    obstacles.push({ x: bx, y: by + bh - WALL, w: doorX - bx, h: WALL, kind: 'wall' });   // front-left
    obstacles.push({ x: doorX + doorW, y: by + bh - WALL, w: bx + bw - (doorX + doorW), h: WALL, kind: 'wall' });

    // ---- teller counter dividing lobby from the back of house ----
    const counterY = by + bh * S.lobby;
    const gapW = 90;
    const gap1 = bx + bw * 0.30, gap2 = bx + bw * 0.70;
    const segs = [
      [bx + WALL, gap1 - gapW / 2],
      [gap1 + gapW / 2, gap2 - gapW / 2],
      [gap2 + gapW / 2, bx + bw - WALL],
    ];
    segs.forEach(([x0, x1]) => {
      if (x1 - x0 > 10) obstacles.push({ x: x0, y: counterY, w: x1 - x0, h: 16, low: true, kind: 'counter' });
    });
    world.counterY = counterY;

    // ---- teller drawers: quick, low-risk cash on the lobby side ----
    // Split the haul across drawers / vault / boxes. Banks with no deposit
    // boxes hand that share to the vault instead of dropping it on the floor.
    const boxCount   = bank.boxes || 0;
    const drawerShare = 0.16;
    const boxShare    = boxCount > 0 ? 0.16 : 0;
    const vaultShare  = 1 - drawerShare - boxShare;

    const drawers = Math.max(4, Math.round(bw / 210));
    const drawerCash = bank.haul * drawerShare / drawers;
    for (let i = 0; i < drawers; i++) {
      const x = bx + WALL + 60 + (bw - 2 * WALL - 120) * (i / Math.max(1, drawers - 1));
      loot.push({ x, y: counterY - 26, r: 15, amount: drawerCash * rand(0.8, 1.2), kind: 'drawer', locked: false, taken: false });
    }

    // ---- vault rooms across the back ----
    const vaultCount = bank.vaults || 1;
    const vaultCash = bank.haul * vaultShare / vaultCount;
    const vw = Math.min(330, (bw - 2 * WALL - 80) / vaultCount - 40);
    const vh = Math.min(240, bh * 0.30);
    for (let v = 0; v < vaultCount; v++) {
      const cx = bx + bw * ((v + 1) / (vaultCount + 1));
      const vx = cx - vw / 2, vy = by + WALL + 40;
      // three solid walls plus a front wall with a doorway that the drill opens
      obstacles.push({ x: vx, y: vy, w: vw, h: WALL, kind: 'vaultwall' });
      obstacles.push({ x: vx, y: vy, w: WALL, h: vh, kind: 'vaultwall' });
      obstacles.push({ x: vx + vw - WALL, y: vy, w: WALL, h: vh, kind: 'vaultwall' });
      const dW = 96, dX = vx + vw / 2 - dW / 2;
      obstacles.push({ x: vx, y: vy + vh - WALL, w: dX - vx, h: WALL, kind: 'vaultwall' });
      obstacles.push({ x: dX + dW, y: vy + vh - WALL, w: vx + vw - (dX + dW), h: WALL, kind: 'vaultwall' });
      const door = { x: dX, y: vy + vh - WALL, w: dW, h: WALL, kind: 'vaultdoor', open: false, solid: true };
      obstacles.push(door);

      const vault = {
        id: v, x: vx, y: vy, w: vw, h: vh, door,
        drillX: dX + dW / 2, drillY: vy + vh + 16,
        progress: 0, drilling: false, open: false,
        cash: vaultCash,
      };
      world.vaults.push(vault);

      // cash piles inside, revealed when the door comes down
      const piles = 5;
      for (let p = 0; p < piles; p++) {
        loot.push({
          x: vx + WALL + 26 + (vw - 2 * WALL - 52) * (p / (piles - 1)),
          y: vy + vh * 0.42 + rand(-26, 26),
          r: 19, amount: vaultCash / piles, kind: 'vault', vaultId: v, locked: true, taken: false,
        });
      }
    }

    // ---- side offices with deposit boxes ----
    const boxes = boxCount;
    if (boxes > 0) {
      const officeW = 200, officeH = 150;
      const spots = [
        { x: bx + WALL + 10, y: by + bh * 0.30 },
        { x: bx + bw - WALL - officeW - 10, y: by + bh * 0.30 },
        { x: bx + WALL + 10, y: by + bh * 0.62 },
        { x: bx + bw - WALL - officeW - 10, y: by + bh * 0.62 },
      ];
      const boxCash = bank.haul * boxShare / boxes;
      let placed = 0;
      spots.forEach((sp, si) => {
        if (placed >= boxes) return;
        // partial walls so offices read as rooms but stay enterable
        obstacles.push({ x: sp.x, y: sp.y, w: officeW, h: 14, kind: 'wall' });
        obstacles.push({ x: sp.x, y: sp.y + officeH - 14, w: officeW * 0.55, h: 14, kind: 'wall' });
        const perRoom = Math.min(3, boxes - placed);
        for (let i = 0; i < perRoom; i++) {
          loot.push({
            x: sp.x + 40 + i * 55, y: sp.y + officeH * 0.5,
            r: 15, amount: boxCash * rand(0.75, 1.25), kind: 'box', locked: false, taken: false,
          });
          placed++;
        }
      });
    }

    // ---- lobby furniture for cover ----
    const deskCount = Math.round(bw / 320);
    for (let i = 0; i < deskCount; i++) {
      obstacles.push({
        x: bx + bw * (0.18 + 0.64 * (i / Math.max(1, deskCount - 1))) - 45,
        y: counterY + (bh - (counterY - by)) * 0.42,
        w: 90, h: 28, low: true, kind: 'desk',
      });
    }

    // ---- street + getaway car ----
    world.street = { x: 0, y: Hh - STREET, w: W, h: STREET };
    world.car = { x: W / 2, y: Hh - STREET * 0.48, r: 46 };

    // parked cars for cover on the street
    for (let i = 0; i < 4; i++) {
      const cx = W * (0.13 + 0.25 * i);
      if (Math.abs(cx - world.car.x) < 150) continue;
      obstacles.push({ x: cx - 46, y: Hh - STREET * 0.75, w: 92, h: 44, low: true, kind: 'car' });
    }

    return world;
  }

  // ==================== ENTITY FACTORY ====================
  function makeActor(def, x, y, side) {
    return {
      x, y, side,                    // side: 'crew' | 'foe'
      angle: side === 'crew' ? -Math.PI / 2 : Math.PI / 2,
      vx: 0, vy: 0,
      r: def.r || 14,
      hp: def.hp, maxHp: def.hp,
      speed: def.speed || 1.1,
      walkPhase: 0, hitFlash: 0,
      cd: 0, burst: 0, burstLeft: 0,
      dead: false, downed: false, downTimer: 0,
      kills: 0,
    };
  }

  function makePlayerActor(c, x, y, slot) {
    const w = D.WEAPONS[c.weapon];
    const a = makeActor({ hp: GH.maxHp(c), r: c.isRobo ? 16 : 14, speed: 1.0 }, x, y, 'crew');
    a.char = c;
    a.isRobo = !!c.isRobo;
    a.slot = slot;
    a.weapon = c.weapon;
    a.mag = w.mag || 0;
    a.heat = 0;
    a.reloading = 0;
    a.spin = 0;
    a.carried = 0;
    a.carryCap = GH.carryCap(c);
    a.dmgMul = GH.dmgMul(c);
    a.spreadMul = GH.spreadMul(c);
    a.moveMul = GH.moveMul(c);
    a.stance = 'follow';
    a.state = 'follow';
    a.regen = 0;
    a.usedSelfRevive = false;
    a.trait = D.TRAITS[c.trait] || {};
    a.name = c.name;
    a.skin = c.isRobo ? '#D9A97A' : c.skin;
    a.outfit = c.isRobo ? '#15171F' : c.outfit;
    a.mask = c.mask;
    return a;
  }

  function makeEnemy(key, x, y) {
    const def = D.ENEMIES[key];
    const a = makeActor(def, x, y, 'foe');
    a.key = key; a.def = def;
    a.wpn = D.ENEMY_WEAPONS[def.wpn];
    a.body = def.body; a.accent = def.accent;
    a.dr = def.dr || 0;
    a.name = def.name;
    a.alerted = false;
    a.target = null;
    a.lastSeen = null;
    a.repathe = 0;
    return a;
  }

  // ==================== HEIST START ====================
  GH.startHeist = (bankId) => {
    ensureAudio();
    if (actx && actx.state === 'suspended') actx.resume();

    const bank = GH.bankById(bankId);
    const world = generateWorld(bank);
    const squad = GH.squad();

    const spawnX = world.car.x, spawnY = world.car.y + 30;
    const robo = makePlayerActor(GH.state.robo, spawnX, spawnY, 0);
    const crew = squad.map((c, i) =>
      makePlayerActor(c, spawnX + (i - 1) * 44, spawnY + 34, i + 1));

    H = {
      bank, world, robo, crew,
      all: [robo].concat(crew),
      enemies: [], bullets: [], particles: [], drops: [], decals: [], floats: [],
      t: 0, last: performance.now(), running: true, paused: false,
      alarm: false, alarmT: 0,
      policeLeft: bank.respond * 1000,
      copsHere: false, breachLeft: bank.breach * 1000, breached: false,
      waveTimer: 0, waveNo: 0,
      cam: { x: spawnX, y: spawnY, zoom: 1 },
      shake: 0,
      extracted: false, failed: false, over: false,
      banked: 0,
      killedIds: [],
      pingT: 0, ping: null,
      showMap: false,
      msg: null, msgT: 0,
    };

    // interior guards
    for (let i = 0; i < bank.guards; i++) {
      const b = world.building;
      const gx = b.x + 60 + Math.random() * (b.w - 120);
      const gy = b.y + 60 + Math.random() * (b.h - 140);
      H.enemies.push(makeEnemy(bank.guardWpn, gx, gy));
    }
    // a couple of them patrol outside on bigger jobs
    if (bank.guards >= 4) {
      H.enemies.push(makeEnemy(bank.guardWpn, world.car.x - 220, world.h - STREET + 60));
      H.enemies.push(makeEnemy(bank.guardWpn, world.car.x + 220, world.h - STREET + 60));
    }
    // boss unit
    if (bank.boss) {
      const def = D.ENEMIES[bank.boss];
      let bx2, by2;
      if (def.static || def.vehicle) { bx2 = world.car.x + 260; by2 = world.h - STREET + 80; }
      else { const v = world.vaults[0]; bx2 = v.x + v.w / 2; by2 = v.y + v.h + 70; }
      const boss = makeEnemy(bank.boss, bx2, by2);
      boss.isBoss = true;
      H.enemies.push(boss);
      H.boss = boss;
    }

    GH.show('heist');
    resize();
    banner(bank.name, bank.boss ? 'BOSS BANK — ' + bank.bossName : 'Get in, get the vault, get out.');
    requestAnimationFrame(loop);
  };

  // Handle onto live mission state, for debugging and the headless
  // test harness. Read-only in practice; nothing in the game uses it.
  GH.__debug = () => H;

  function banner(text, sub) {
    H.msg = { text, sub };
    H.msgT = 2600;
  }

  // ==================== INPUT ====================
  window.addEventListener('keydown', (e) => {
    if (!H || !H.running) return;
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (k === 'escape') togglePause();
    if (k === 'tab') { e.preventDefault(); H.showMap = !H.showMap; }
    if (k === 'f') toggleStance();
    if (k === 'e') tryInteract();
    if (k === 'r') tryReload(H.robo);
    if (k === 'q') quickMelee();
    if (k === ' ') { e.preventDefault(); tryDodge(); }
    if (k === 'g') placePing();
  });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) mouse.down = true;
    if (e.button === 1) { e.preventDefault(); placePing(); }
  });
  window.addEventListener('mouseup', () => { mouse.down = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function togglePause() {
    if (!H || H.over) return;
    H.paused = !H.paused;
    document.getElementById('heist-pause').classList.toggle('active', H.paused);
    if (H.paused) stopSiren(); else if (H.copsHere) startSiren();
    if (!H.paused) { H.last = performance.now(); requestAnimationFrame(loop); }
  }
  GH.resumeHeist = () => { if (H && H.paused) togglePause(); };
  GH.abandonHeist = () => {
    if (!H) return;
    H.paused = false;
    document.getElementById('heist-pause').classList.remove('active');
    finish(false);
  };

  function toggleStance() {
    const s = H.crew[0] ? H.crew[0].stance : 'follow';
    const next = s === 'follow' ? 'hold' : 'follow';
    H.crew.forEach(c => { c.stance = next; });
    banner(next === 'hold' ? 'HOLD POSITION' : 'ON ME', '');
  }

  function placePing() {
    if (!H) return;
    H.ping = { x: mouse.wx, y: mouse.wy };
    H.pingT = 6000;
  }

  function quickMelee() {
    const p = H.robo;
    if (D.WEAPONS[p.weapon].kind === 'melee') {
      p.weapon = p.char.weapon;
      p.mag = D.WEAPONS[p.weapon].mag || 0;
    } else {
      p.stashed = p.weapon;
      p.weapon = GH.state.owned.weapons.bat ? 'bat' : 'knife';
    }
  }

  function tryDodge() {
    const p = H.robo;
    if (p.dodgeCd > 0 || p.downed) return;
    const a = Math.atan2(p.moveY || 0, p.moveX || 0);
    if (!p.moveX && !p.moveY) return;
    p.dodgeVX = Math.cos(a) * 7.5;
    p.dodgeVY = Math.sin(a) * 7.5;
    p.dodgeT = 220;
    p.iframes = 260;
    p.dodgeCd = 900;
  }

  // ==================== INTERACTION ====================
  function tryInteract() {
    const p = H.robo;
    if (p.downed) return;

    // revive a downed teammate
    for (const c of H.crew) {
      if (c.downed && !c.dead && dist(p, c) < 46) { p.reviving = c; return; }
    }
    // start a drill on a vault
    for (const v of H.world.vaults) {
      if (!v.open && Math.hypot(p.x - v.drillX, p.y - v.drillY) < 60) {
        if (!v.drilling) { v.drilling = true; trip('drill'); banner('DRILL RUNNING', 'Keep it covered.'); }
        return;
      }
    }
    // grab loot
    grabNearbyLoot(p, true);
  }

  function grabNearbyLoot(a, manual) {
    const reach = manual ? 52 : 40;
    let got = 0;
    for (const l of H.world.loot) {
      if (l.taken || l.locked) continue;
      if (dist(a, l) > reach) continue;
      const room = a.carryCap - a.carried;
      if (room <= 4) { if (manual) floatText(a.x, a.y - 26, 'BAG FULL', '#FF7A3D'); return; }
      const take = Math.min(room, l.amount);
      a.carried += take; l.amount -= take;
      got += take;
      if (l.amount <= 1) l.taken = true;
      sfx.cash();
      floatText(l.x, l.y - 20, '+' + money(take), '#7BC59A');
      // Grabbing from a teller drawer is what tips off the staff.
      if (l.kind === 'drawer' && !H.alarm) trip('teller');
    }
    // loose bags dropped by the fallen
    for (const d of H.drops) {
      if (d.taken) continue;
      if (dist(a, d) > reach) continue;
      const room = a.carryCap - a.carried;
      if (room <= 4) continue;
      const take = Math.min(room, d.amount);
      a.carried += take; d.amount -= take;
      if (d.amount <= 1) d.taken = true;
      sfx.pickup();
      floatText(d.x, d.y - 20, '+' + money(take), '#F5E5A0');
    }
    return got;
  }

  // ==================== ALARM ====================
  function trip(reason) {
    if (H.alarm) return;
    H.alarm = true;
    H.alarmT = H.t;
    sfx.alarm();
    H.enemies.forEach(e => { e.alerted = true; });
    const why = { gun: 'Gunfire heard', teller: 'A teller hit the silent alarm', drill: 'The drill tripped the alarm', guard: 'A guard called it in' }[reason] || 'Alarm';
    banner('ALARM', why + ' — police inbound.');
  }

  // ==================== COMBAT ====================
  function spread(base, mul) { return (base || 0) * mul; }

  function fire(a, targetX, targetY) {
    const w = D.WEAPONS[a.weapon];
    if (a.cd > 0 || a.reloading > 0 || a.downed) return;
    const armor = D.ARMOR[a.char ? a.char.armor : 'none'];
    if (armor && armor.meleeOnly && w.kind !== 'melee') return;

    if (w.kind === 'melee') {
      a.cd = w.cd * (a.trait && a.trait.fireRate ? a.trait.fireRate : 1);
      a.swing = 160;
      sfx.melee();
      const ang = Math.atan2(targetY - a.y, targetX - a.x);
      for (const e of H.enemies) {
        if (e.dead) continue;
        if (dist(a, e) > w.reach + e.r) continue;
        const da = Math.abs(normAngle(Math.atan2(e.y - a.y, e.x - a.x) - ang));
        if (da > w.arc / 2) continue;
        const silentKill = !H.alarm && !e.alerted;
        damageEnemy(e, w.dmg * a.dmgMul, a, ang);
        if (w.knockback) { e.x += Math.cos(ang) * w.knockback; e.y += Math.sin(ang) * w.knockback; }
        if (silentKill && e.dead) floatText(e.x, e.y - 30, 'SILENT', '#6FBFCB');
      }
      return;
    }

    // heat-based energy weapons never reload, they cook
    if (w.heat) {
      if (a.heat >= 10) return;
      a.heat = Math.min(10, a.heat + w.heat);
    } else {
      if (a.mag <= 0) { tryReload(a); return; }
      a.mag--;
    }

    if (w.spinUp) {
      a.spin = Math.min(w.spinUp, a.spin + 60);
      if (a.spin < w.spinUp) { a.cd = 60; return; }
    }

    a.cd = w.cd * (a.trait && a.trait.fireRate ? a.trait.fireRate : 1);
    a.flash = 90;
    sfx.shot(w);
    if (!w.silent && !H.alarm) trip('gun');
    if (GH.settings.shake) H.shake = Math.max(H.shake, w.kind === 'explosive' ? 9 : w.kind === 'shotgun' ? 5 : 2.2);

    const base = Math.atan2(targetY - a.y, targetX - a.x);
    const sp = spread(w.spread, a.spreadMul);
    const n = w.pellets || 1;
    for (let i = 0; i < n; i++) {
      const ang = base + rand(-sp, sp);
      H.bullets.push({
        x: a.x + Math.cos(base) * (a.r + 10),
        y: a.y + Math.sin(base) * (a.r + 10),
        vx: Math.cos(ang) * w.speed, vy: Math.sin(ang) * w.speed,
        dmg: w.dmg * a.dmgMul, life: w.range / w.speed,
        side: a.side, owner: a, w, color: w.color,
        splash: w.splash || 0, pierce: !!w.pierceArmor,
        chain: w.chain || 0, chainRange: w.chainRange || 0,
        breaches: !!w.breaches,
      });
    }
    // recoil kick
    a.x -= Math.cos(base) * 0.6; a.y -= Math.sin(base) * 0.6;
  }

  function normAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function tryReload(a) {
    const w = D.WEAPONS[a.weapon];
    if (!w.mag || a.reloading > 0 || a.mag === w.mag) return;
    a.reloading = w.reload * (a.trait && a.trait.reloadRate ? a.trait.reloadRate : 1);
    sfx.reload();
  }

  function damageEnemy(e, dmg, src, ang) {
    if (e.dead) return;
    let d = dmg;
    // riot shields eat frontal damage
    if (e.def.shield && ang != null) {
      const facing = Math.atan2(e.y - (src ? src.y : e.y), e.x - (src ? src.x : e.x));
      const rel = Math.abs(normAngle(facing - e.angle));
      if (rel > Math.PI * 0.55) d *= (1 - (e.def.frontalDR || 0.8));
    }
    d *= (1 - (e.dr || 0));
    e.hp -= d;
    e.hitFlash = 10;
    e.alerted = true;
    sfx.hit();
    spark(e.x, e.y, 4);
    if (e.hp <= 0) {
      e.dead = true;
      if (src && src.side === 'crew') { src.kills = (src.kills || 0) + 1; GH.state.stats.kills++; }
      spark(e.x, e.y, 12);
      if (e.isBoss) banner(e.name + ' DOWN', 'Move!');
    }
  }

  function damageActor(a, dmg, fromX, fromY) {
    if (a.downed || a.dead) return;
    if (a.iframes > 0) return;
    const armor = D.ARMOR[a.char.armor] || D.ARMOR.none;
    let d = dmg * (1 - (armor.dr || 0));
    if (armor.frontal && fromX != null) {
      const toward = Math.atan2(fromY - a.y, fromX - a.x);
      if (Math.abs(normAngle(toward - a.angle)) < Math.PI * 0.45) d *= (1 - armor.frontal);
    }
    a.hp -= d;
    a.hitFlash = 10;
    a.regen = 0;
    sfx.hurt();
    if (GH.settings.shake && a.isRobo) H.shake = Math.max(H.shake, 4);
    if (a.hp <= 0) {
      // Lucky sometimes buys one more second of life.
      if (a.trait && a.trait.cheatDeath && !a.usedLuck && Math.random() < a.trait.cheatDeath) {
        a.usedLuck = true; a.hp = 1;
        floatText(a.x, a.y - 30, 'LUCKY', '#7BC59A');
        return;
      }
      goDown(a);
    }
  }

  function goDown(a) {
    a.hp = 0;
    a.downed = true;
    a.downTimer = a.isRobo ? T.roboSelfRevive : T.downedBleedout;
    sfx.down();
    // Whatever they were hauling hits the floor as a grabbable bag.
    if (a.carried > 0) {
      H.drops.push({ x: a.x, y: a.y, r: 18, amount: a.carried, taken: false, name: a.name });
      a.carried = 0;
    }
    banner(a.name + ' IS DOWN', a.isRobo ? 'Get up or it is over.' : 'Revive them with E.');
  }

  // ==================== EXPLOSIONS ====================
  function explode(x, y, radius, dmg, src) {
    sfx.boom();
    if (GH.settings.shake) H.shake = Math.max(H.shake, 12);
    for (let i = 0; i < 24; i++) {
      H.particles.push({
        x, y, vx: rand(-5, 5), vy: rand(-5, 5), life: rand(16, 34),
        r: rand(2, 6), color: i % 3 ? 'rgba(255,140,60,0.9)' : 'rgba(255,220,140,0.9)',
      });
    }
    for (const e of H.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < radius) damageEnemy(e, dmg * (1 - d / radius), src, null);
    }
    // friendly fire is real with explosives
    for (const a of H.all) {
      if (a.downed || a.dead) continue;
      const d = Math.hypot(a.x - x, a.y - y);
      if (d < radius * 0.8) damageActor(a, dmg * 0.5 * (1 - d / (radius * 0.8)), x, y);
    }
    // blow open breachable walls
    if (H.bank.breachWalls) {
      H.world.obstacles = H.world.obstacles.filter(o => {
        if (o.kind !== 'vaultwall') return true;
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        if (Math.hypot(cx - x, cy - y) > radius * 0.9) return true;
        openVaultNear(cx, cy);
        return false;
      });
    }
  }

  function openVaultNear(x, y) {
    let best = null, bd = 1e9;
    H.world.vaults.forEach(v => {
      const d = Math.hypot(v.x + v.w / 2 - x, v.y + v.h / 2 - y);
      if (d < bd) { bd = d; best = v; }
    });
    if (best && bd < 320 && !best.open) openVault(best);
  }

  function openVault(v) {
    v.open = true;
    v.drilling = false;
    v.door.solid = false;
    v.door.open = true;
    H.world.loot.forEach(l => { if (l.kind === 'vault' && l.vaultId === v.id) l.locked = false; });
    banner('VAULT OPEN', money(v.cash) + ' inside. Fill your bags.');
    sfx.revive();
  }

  // ==================== POLICE ====================
  function pickCop(bank) {
    const pool = [];
    bank.copWaves.forEach(([k, wgt]) => { for (let i = 0; i < wgt; i++) pool.push(k); });
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : 'cop';
  }

  function spawnCopWave(count, inside) {
    const w = H.world;
    for (let i = 0; i < count; i++) {
      if (H.enemies.filter(e => !e.dead).length >= T.maxEnemies) return;
      let x, y;
      if (inside) {
        // breach: come through the front door and the flanks
        const roll = Math.random();
        if (roll < 0.6) { x = w.door.x + rand(0, w.door.w); y = w.door.y - 24; }
        else { x = rand(w.building.x + 40, w.building.x + w.building.w - 40); y = w.building.y + w.building.h - 40; }
      } else {
        // perimeter: they set up around the getaway car
        const side = Math.floor(Math.random() * 3);
        if (side === 0) { x = rand(40, w.w - 40); y = w.h - 40; }
        else if (side === 1) { x = 40; y = rand(w.h - STREET, w.h - 50); }
        else { x = w.w - 40; y = rand(w.h - STREET, w.h - 50); }
      }
      const e = makeEnemy(pickCop(H.bank), x, y);
      e.alerted = true;
      H.enemies.push(e);
    }
  }

  // ==================== AI ====================
  function hasLOS(a, b) {
    for (const o of H.world.obstacles) {
      if (o.low) continue;
      if (o.kind === 'vaultdoor' && !o.solid) continue;
      if (segRect(a.x, a.y, b.x, b.y, o)) return false;
    }
    return true;
  }

  function nearestTarget(e) {
    let best = null, bd = 1e9;
    for (const a of H.all) {
      if (a.dead) continue;
      if (a.downed && !a.isRobo) continue;   // ignore bleeding-out crew, finish the standing ones
      const d = dist(e, a);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  function stepEnemy(e, dt) {
    if (e.dead) return;
    if (e.hitFlash > 0) e.hitFlash -= dt * 0.06;

    const tgt = nearestTarget(e);
    if (!tgt) return;
    const d = dist(e, tgt);
    const los = hasLOS(e, tgt);

    // Guards only wake up when they see you misbehaving or the alarm goes.
    if (!e.alerted) {
      if (los && d < 300) {
        const armed = D.WEAPONS[tgt.weapon] && D.WEAPONS[tgt.weapon].kind !== 'melee';
        if (armed || H.alarm) { e.alerted = true; e.radio = 900; }
      }
      if (!e.alerted) { patrol(e, dt); return; }
    }

    // A guard that spots you radios it in shortly after.
    if (e.radio > 0) {
      e.radio -= dt;
      if (e.radio <= 0 && !H.alarm) trip('guard');
    }

    if (los) e.lastSeen = { x: tgt.x, y: tgt.y };
    e.angle = lerp(e.angle, Math.atan2((e.lastSeen || tgt).y - e.y, (e.lastSeen || tgt).x - e.x), 0.16);

    const wpn = e.wpn;
    const wantRange = wpn.melee ? wpn.reach - 6 : Math.min(wpn.range * 0.62, 330);

    if (!e.def.static && !(e.def.vehicle && d < 200)) {
      const goal = los ? tgt : (e.lastSeen || tgt);
      const ang = Math.atan2(goal.y - e.y, goal.x - e.x);
      const closing = (d > wantRange) || !los;
      const backing = d < wantRange * 0.55 && los && !wpn.melee;
      let mv = 0;
      if (closing) mv = 1; else if (backing) mv = -0.6;
      if (mv !== 0) {
        const sp = e.speed * (H.breached ? 1.08 : 1) * mv;
        moveActor(e, Math.cos(ang) * sp, Math.sin(ang) * sp, dt);
      }
    }

    // shooting
    e.cd -= dt;
    if (los && d < wpn.range && e.cd <= 0) {
      if (wpn.melee) {
        if (d < wpn.reach + tgt.r) {
          e.cd = wpn.cd;
          e.swing = 150;
          damageActor(tgt, wpn.dmg, e.x, e.y);
        } else e.cd = 120;
      } else {
        if (e.burstLeft <= 0) { e.burstLeft = wpn.burst || 1; }
        e.burstLeft--;
        e.cd = e.burstLeft > 0 ? Math.max(60, wpn.cd * 0.34) : wpn.cd;
        const base = Math.atan2(tgt.y - e.y, tgt.x - e.x);
        for (let i = 0; i < (wpn.pellets || 1); i++) {
          const ang = base + rand(-wpn.spread, wpn.spread);
          H.bullets.push({
            x: e.x + Math.cos(base) * (e.r + 8), y: e.y + Math.sin(base) * (e.r + 8),
            vx: Math.cos(ang) * wpn.speed, vy: Math.sin(ang) * wpn.speed,
            dmg: wpn.dmg, life: wpn.range / wpn.speed,
            side: 'foe', owner: e, w: { kind: 'e' }, color: '#FF9B6B',
            splash: wpn.splash || 0,
          });
        }
        sfx.shot({ kind: e.key === 'nest' ? 'lmg' : 'pistol' });
      }
    }
  }

  function patrol(e, dt) {
    e.repathe -= dt;
    if (e.repathe <= 0 || !e.patrolTo) {
      const b = H.world.building;
      e.patrolTo = { x: b.x + 50 + Math.random() * (b.w - 100), y: b.y + 50 + Math.random() * (b.h - 100) };
      e.repathe = rand(2600, 5200);
    }
    const ang = Math.atan2(e.patrolTo.y - e.y, e.patrolTo.x - e.x);
    e.angle = lerp(e.angle, ang, 0.06);
    moveActor(e, Math.cos(ang) * e.speed * 0.42, Math.sin(ang) * e.speed * 0.42, dt);
  }

  // ---- crew AI: follow, engage, loot, extract ----
  function stepCrew(c, dt) {
    if (c.dead) return;
    if (c.downed) {
      c.downTimer -= dt;
      if (c.downTimer <= 0) { c.dead = true; H.killedIds.push(c.char.id); banner(c.name + ' BLED OUT', 'Gone for good.'); }
      return;
    }

    const p = H.robo;
    let foe = null, fd = 1e9;
    for (const e of H.enemies) {
      if (e.dead) continue;
      const d = dist(c, e);
      if (d < fd && d < 460 && hasLOS(c, e)) { fd = d; foe = e; }
    }
    // A ping overrides target choice.
    if (H.ping && H.pingT > 0) {
      let pf = null, pd = 1e9;
      for (const e of H.enemies) {
        if (e.dead) continue;
        const d = Math.hypot(e.x - H.ping.x, e.y - H.ping.y);
        if (d < 150 && d < pd && hasLOS(c, e)) { pd = d; pf = e; }
      }
      if (pf) { foe = pf; fd = dist(c, pf); }
    }

    const w = D.WEAPONS[c.weapon];
    if (foe) {
      c.state = 'engage';
      c.angle = lerp(c.angle, Math.atan2(foe.y - c.y, foe.x - c.x), 0.2);
      const want = w.kind === 'melee' ? w.reach - 8 : Math.min((w.range || 400) * 0.55, 300);
      if (fd > want) {
        const ang = Math.atan2(foe.y - c.y, foe.x - c.x);
        moveActor(c, Math.cos(ang) * 1.6 * c.moveMul, Math.sin(ang) * 1.6 * c.moveMul, dt);
      }
      c.cd -= dt;
      if (c.reloading > 0) c.reloading -= dt;
      else if (w.mag && c.mag <= 0) tryReload(c);
      else if (fd < (w.range || w.reach + 20)) fire(c, foe.x, foe.y);
    } else {
      // no target: loot what is underfoot, then keep formation
      grabNearbyLoot(c, false);
      if (H.extractPhase) {
        const car = H.world.car;
        c.state = 'extract';
        const ang = Math.atan2(car.y - c.y, car.x - c.x);
        if (dist(c, car) > 46) moveActor(c, Math.cos(ang) * 2.1 * c.moveMul, Math.sin(ang) * 2.1 * c.moveMul, dt);
        c.angle = lerp(c.angle, ang, 0.15);
      } else if (c.stance === 'follow') {
        c.state = 'follow';
        const off = [[-46, 40], [46, 40], [0, 62]][c.slot - 1] || [0, 50];
        const tx = p.x + off[0], ty = p.y + off[1];
        const d = Math.hypot(tx - c.x, ty - c.y);
        if (d > 34) {
          const ang = Math.atan2(ty - c.y, tx - c.x);
          const sp = clamp(d / 60, 0.6, 2.3) * c.moveMul;
          moveActor(c, Math.cos(ang) * sp, Math.sin(ang) * sp, dt);
          c.angle = lerp(c.angle, ang, 0.14);
        } else {
          c.angle = lerp(c.angle, p.angle, 0.1);
        }
      } else {
        c.state = 'hold';
      }
      if (c.reloading > 0) c.reloading -= dt;
      else if (w.mag && c.mag < (w.mag || 0)) tryReload(c);
      if (c.heat > 0) c.heat = Math.max(0, c.heat - (w.cool || 2) * dt / 1000);
    }
  }

  // ==================== MOVEMENT ====================
  function moveActor(a, dx, dy, dt) {
    const step = dt / 16.67;
    const nx = a.x + dx * step, ny = a.y + dy * step;
    if (!blocked(nx, a.y, a.r)) a.x = nx;
    if (!blocked(a.x, ny, a.r)) a.y = ny;
    a.x = clamp(a.x, a.r, H.world.w - a.r);
    a.y = clamp(a.y, a.r, H.world.h - a.r);
    a.walkPhase += Math.hypot(dx, dy) * 0.09 * step;
  }

  function blocked(x, y, r) {
    for (const o of H.world.obstacles) {
      if (o.kind === 'vaultdoor' && !o.solid) continue;
      if (circleRect(x, y, r, o)) return true;
    }
    return false;
  }

  // ==================== PLAYER STEP ====================
  function stepRobo(dt) {
    const p = H.robo;
    if (p.dead) return;

    if (p.downed) {
      p.downTimer -= dt;
      // RoboKyle picks himself up once per heist; after that a crew member must reach him.
      if (p.downTimer <= 0) {
        if (!p.usedSelfRevive) {
          p.usedSelfRevive = true;
          p.downed = false;
          p.hp = p.maxHp * 0.45;
          p.iframes = 1200;
          sfx.revive();
          banner('BACK UP', 'That was your one free save.');
        } else {
          finish(false);
        }
      }
      // a standing crew member can pull him up
      for (const c of H.crew) {
        if (!c.downed && !c.dead && dist(c, p) < 44) {
          p.reviveProg = (p.reviveProg || 0) + dt;
          if (p.reviveProg > T.reviveTime) {
            p.downed = false; p.hp = p.maxHp * 0.5; p.reviveProg = 0; p.iframes = 900;
            sfx.revive(); banner('ON YOUR FEET', c.name + ' pulled you up.');
          }
          break;
        }
      }
      return;
    }

    // ---- movement ----
    let mx = 0, my = 0;
    if (keys['w'] || keys['arrowup']) my -= 1;
    if (keys['s'] || keys['arrowdown']) my += 1;
    if (keys['a'] || keys['arrowleft']) mx -= 1;
    if (keys['d'] || keys['arrowright']) mx += 1;
    if (touch.active) { mx = touch.mx; my = touch.my; }
    const len = Math.hypot(mx, my) || 1;
    p.moveX = mx / len; p.moveY = my / len;

    const baseSpeed = 2.55 * p.moveMul;
    if (p.dodgeT > 0) {
      p.dodgeT -= dt;
      moveActor(p, p.dodgeVX, p.dodgeVY, dt);
    } else if (mx || my) {
      moveActor(p, p.moveX * baseSpeed, p.moveY * baseSpeed, dt);
    }
    if (p.dodgeCd > 0) p.dodgeCd -= dt;
    if (p.iframes > 0) p.iframes -= dt;

    // ---- aim ----
    p.angle = Math.atan2(mouse.wy - p.y, mouse.wx - p.x);
    if (touch.active && touch.aiming) p.angle = touch.aimAngle;

    // ---- shooting ----
    const w = D.WEAPONS[p.weapon];
    p.cd -= dt;
    if (p.reloading > 0) {
      p.reloading -= dt;
      if (p.reloading <= 0) p.mag = w.mag;
    }
    if (w.heat) {
      p.heat = Math.max(0, p.heat - (w.cool || 2) * dt / 1000);
      if (p.heat >= 10) p.overheated = true;
      if (p.overheated && p.heat <= 2) p.overheated = false;
    }
    if (w.spinUp && !(mouse.down || (touch.active && touch.firing))) p.spin = Math.max(0, p.spin - dt);

    const firing = mouse.down || (touch.active && touch.firing);
    if (firing && !p.overheated) {
      if (w.auto || w.kind === 'melee' || !p.firedOnce) fire(p, mouse.wx, mouse.wy);
      p.firedOnce = true;
    }
    if (!firing) p.firedOnce = false;

    // ---- reviving a teammate (hold E) ----
    if (p.reviving) {
      const c = p.reviving;
      if (!c.downed || c.dead || dist(p, c) > 52 || !keys['e']) { p.reviving = null; p.reviveProg = 0; }
      else {
        p.reviveProg = (p.reviveProg || 0) + dt;
        if (p.reviveProg > T.reviveTime) {
          c.downed = false; c.hp = c.maxHp * 0.5; p.reviving = null; p.reviveProg = 0;
          sfx.revive(); banner(c.name + ' IS UP', '');
        }
      }
    }

    // ---- passive loot pickup while standing on it ----
    grabNearbyLoot(p, false);

    // ---- regen ----
    p.regen += dt;
    if (p.regen > T.regenDelay && p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + T.regenRate * dt / 1000);
    }
  }

  // ==================== BULLETS ====================
  function stepBullets(dt) {
    const step = dt / 16.67;
    for (let i = H.bullets.length - 1; i >= 0; i--) {
      const b = H.bullets[i];
      b.x += b.vx * step; b.y += b.vy * step;
      b.life -= step;
      let hit = false;

      // walls
      for (const o of H.world.obstacles) {
        if (o.low) continue;
        if (o.kind === 'vaultdoor' && !o.solid) continue;
        if (circleRect(b.x, b.y, 2, o)) {
          if (b.breaches && (o.kind === 'vaultwall' || o.kind === 'vaultdoor')) {
            explode(b.x, b.y, b.splash || 90, b.dmg, b.owner);
            openVaultNear(b.x, b.y);
          } else if (b.splash) {
            explode(b.x, b.y, b.splash, b.dmg, b.owner);
          } else spark(b.x, b.y, 3);
          hit = true; break;
        }
      }

      if (!hit && b.side === 'crew') {
        for (const e of H.enemies) {
          if (e.dead) continue;
          if (dist(b, e) > e.r) continue;
          if (b.splash) explode(b.x, b.y, b.splash, b.dmg, b.owner);
          else {
            const ang = Math.atan2(b.vy, b.vx);
            damageEnemy(e, b.dmg * (b.pierce ? 1 / Math.max(0.35, 1 - (e.dr || 0)) : 1), b.owner, ang);
            if (b.chain > 0) chainTo(b, e);
          }
          hit = true; break;
        }
      } else if (!hit && b.side === 'foe') {
        for (const a of H.all) {
          if (a.dead || a.downed) continue;
          if (dist(b, a) > a.r) continue;
          if (b.splash) explode(b.x, b.y, b.splash, b.dmg, b.owner);
          else damageActor(a, b.dmg, b.x, b.y);
          hit = true; break;
        }
      }

      if (hit || b.life <= 0) H.bullets.splice(i, 1);
    }
  }

  function chainTo(b, from) {
    let left = b.chain;
    const hitSet = new Set([from]);
    let cur = from;
    while (left-- > 0) {
      let best = null, bd = b.chainRange;
      for (const e of H.enemies) {
        if (e.dead || hitSet.has(e)) continue;
        const d = dist(cur, e);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) break;
      damageEnemy(best, b.dmg * 0.7, b.owner, null);
      H.particles.push({ x: cur.x, y: cur.y, vx: 0, vy: 0, life: 8, r: 2, color: '#9AD8FF',
        arc: { x2: best.x, y2: best.y } });
      hitSet.add(best); cur = best;
    }
  }

  // ==================== FX ====================
  function spark(x, y, n) {
    for (let i = 0; i < n; i++) {
      H.particles.push({ x, y, vx: rand(-3, 3), vy: rand(-3, 3), life: rand(6, 16), r: rand(1, 2.6),
        color: 'rgba(255,190,120,0.9)' });
    }
  }
  function floatText(x, y, text, color) {
    H.floats.push({ x, y, text, color, life: 900 });
  }

  // ==================== MISSION TIMERS ====================
  function stepMission(dt) {
    // drills
    for (const v of H.world.vaults) {
      if (v.drilling && !v.open) {
        v.progress += dt / (H.bank.drill * 1000);
        if (Math.random() < 0.14) sfx.drill();
        if (v.progress >= 1) openVault(v);
      }
    }

    if (H.alarm && !H.copsHere) {
      H.policeLeft -= dt;
      if (H.policeLeft <= 0) {
        H.copsHere = true;
        startSiren();
        spawnCopWave(T.copWaveSizeBase, false);
        banner('POLICE ON SCENE', 'They are setting up outside. The car is covered.');
      }
    }

    if (H.copsHere) {
      H.waveTimer -= dt;
      if (H.waveTimer <= 0) {
        H.waveNo++;
        H.waveTimer = T.copWaveInterval;
        const n = Math.round(T.copWaveSizeBase + H.waveNo * T.copWaveSizeGrowth);
        spawnCopWave(n, H.breached);
      }
      if (!H.breached) {
        H.breachLeft -= dt;
        if (H.breachLeft <= 0) {
          H.breached = true;
          banner('THEY ARE BREACHING', 'SWAT is coming through the front.');
          spawnCopWave(4, true);
        }
      }
    }

    // extraction: RoboKyle at the car
    const atCar = dist(H.robo, H.world.car) < H.world.car.r;
    H.canExtract = atCar && !H.robo.downed;
    if (H.canExtract && (keys['e'] || (touch.active && touch.interact))) H.extractPhase = true;

    // Everyone still standing has to be aboard before the car pulls away.
    // finish() tears down mission state, so nothing may touch H after it.
    if (H.extractPhase && atCar) {
      const stragglers = H.crew.filter(c => !c.dead && !c.downed && dist(c, H.world.car) > 70);
      if (stragglers.length === 0) { finish(true); return; }
    }

    // total wipe
    const anyUp = H.all.some(a => !a.dead && !a.downed);
    if (!anyUp && !H.over) { finish(false); return; }
  }

  // ==================== FINISH ====================
  function finish(escaped) {
    if (H.over) return;
    H.over = true;
    H.running = false;
    stopSiren();

    let haul = 0;
    const perChar = [];
    H.all.forEach(a => {
      const survived = !a.dead && (escaped ? !a.downed || a.isRobo : false);
      const cash = (escaped && survived) ? a.carried : 0;
      if (escaped && survived) haul += a.carried;
      perChar.push({ char: a.char, cash: a.carried, kills: a.kills || 0, survived });
    });

    // Crew who were still bleeding out when the car left do not make it.
    H.crew.forEach(c => {
      if (c.dead && H.killedIds.indexOf(c.char.id) < 0) H.killedIds.push(c.char.id);
      if (!escaped && c.downed && !c.dead) { c.dead = true; H.killedIds.push(c.char.id); }
      if (escaped && c.downed && !c.dead) { c.dead = true; H.killedIds.push(c.char.id); }
    });

    const uncollected = H.all.reduce((s, a) => s + (escaped ? 0 : a.carried), 0);

    GH.debrief({
      escaped,
      haul: escaped ? haul : uncollected,
      killed: H.killedIds.slice(),
      perChar,
      bankId: H.bank.id,
    });
    H = null;
  }

  // ==================== LOOP ====================
  function loop(now) {
    if (!H || !H.running) return;
    if (H.paused) return;
    let dt = Math.min(50, now - H.last);
    H.last = now;
    H.t += dt;

    stepRobo(dt);
    if (!H) return;
    H.crew.forEach(c => stepCrew(c, dt));
    H.enemies.forEach(e => stepEnemy(e, dt));
    stepBullets(dt);
    stepMission(dt);
    if (!H) return;   // the mission ended this frame; H is gone

    // particles
    for (let i = H.particles.length - 1; i >= 0; i--) {
      const p = H.particles[i];
      p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94; p.life--;
      if (p.life <= 0) H.particles.splice(i, 1);
    }
    for (let i = H.floats.length - 1; i >= 0; i--) {
      const f = H.floats[i];
      f.y -= dt * 0.03; f.life -= dt;
      if (f.life <= 0) H.floats.splice(i, 1);
    }
    if (H.msgT > 0) H.msgT -= dt;
    if (H.pingT > 0) H.pingT -= dt;
    if (H.shake > 0) H.shake *= 0.88;
    H.enemies = H.enemies.filter(e => !e.dead || (e.fade = (e.fade || 40) - 1) > 0);

    // camera
    H.cam.x = lerp(H.cam.x, H.robo.x, 0.10);
    H.cam.y = lerp(H.cam.y, H.robo.y, 0.10);

    draw();
    updateHud();
    requestAnimationFrame(loop);
  }

  // ==================== CAMERA / RESIZE ====================
  let VW = 0, VH = 0, DPR = 1;
  function resize() {
    const wrap = canvas.parentElement;
    const rect = wrap.getBoundingClientRect();
    DPR = Math.min(2, window.devicePixelRatio || 1);
    VW = Math.max(320, rect.width);
    VH = Math.max(240, rect.height);
    canvas.width = VW * DPR;
    canvas.height = VH * DPR;
    canvas.style.width = VW + 'px';
    canvas.style.height = VH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', () => { if (H) resize(); });

  function camOffset() {
    const zoom = 1;
    // Clamp so the camera never pans past the world and shows dead space.
    // If the viewport is wider than the world, centre it instead.
    const cx = H.world.w <= VW ? H.world.w / 2 : clamp(H.cam.x, VW / 2, H.world.w - VW / 2);
    const cy = H.world.h <= VH ? H.world.h / 2 : clamp(H.cam.y, VH / 2, H.world.h - VH / 2);
    let ox = VW / 2 - cx * zoom;
    let oy = VH / 2 - cy * zoom;
    if (H.shake > 0.4) { ox += rand(-H.shake, H.shake); oy += rand(-H.shake, H.shake); }
    return { ox, oy, zoom };
  }

  function updateMouseWorld() {
    if (!H) return;
    const { ox, oy } = camOffset();
    mouse.wx = mouse.x - ox;
    mouse.wy = mouse.y - oy;
  }

  // ==================== DRAW ====================
  function draw() {
    updateMouseWorld();
    const { ox, oy } = camOffset();
    const w = H.world;

    ctx.fillStyle = '#0A0B0E';
    ctx.fillRect(0, 0, VW, VH);
    ctx.save();
    ctx.translate(ox, oy);

    // ---- ground ----
    ctx.fillStyle = '#15171B';
    ctx.fillRect(0, 0, w.w, w.h);
    // street
    ctx.fillStyle = '#1B1D22';
    ctx.fillRect(w.street.x, w.street.y, w.street.w, w.street.h);
    ctx.strokeStyle = '#2A2D34'; ctx.lineWidth = 3; ctx.setLineDash([26, 22]);
    ctx.beginPath(); ctx.moveTo(0, w.street.y + w.street.h * 0.55); ctx.lineTo(w.w, w.street.y + w.street.h * 0.55); ctx.stroke();
    ctx.setLineDash([]);

    // building floor
    ctx.fillStyle = '#20222A';
    ctx.fillRect(w.building.x, w.building.y, w.building.w, w.building.h);
    // floor tiling
    ctx.strokeStyle = 'rgba(255,255,255,0.026)'; ctx.lineWidth = 1;
    for (let x = w.building.x; x < w.building.x + w.building.w; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, w.building.y); ctx.lineTo(x, w.building.y + w.building.h); ctx.stroke();
    }
    for (let y = w.building.y; y < w.building.y + w.building.h; y += 64) {
      ctx.beginPath(); ctx.moveTo(w.building.x, y); ctx.lineTo(w.building.x + w.building.w, y); ctx.stroke();
    }

    // vault room floors
    w.vaults.forEach(v => {
      ctx.fillStyle = v.open ? 'rgba(227,85,43,0.10)' : 'rgba(120,110,90,0.07)';
      ctx.fillRect(v.x, v.y, v.w, v.h);
    });

    // ---- obstacles ----
    for (const o of w.obstacles) {
      if (o.kind === 'vaultdoor' && !o.solid) continue;
      let fill = '#31353F', top = '#3D424E';
      if (o.kind === 'counter') { fill = '#4A3A2A'; top = '#5C4835'; }
      else if (o.kind === 'desk') { fill = '#3A3026'; top = '#4A3D30'; }
      else if (o.kind === 'car') { fill = '#2A3038'; top = '#39414B'; }
      else if (o.kind === 'vaultwall') { fill = '#4A4436'; top = '#5C5544'; }
      else if (o.kind === 'vaultdoor') { fill = '#6B5A2E'; top = '#8A7540'; }
      ctx.fillStyle = fill;
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.fillStyle = top;
      ctx.fillRect(o.x, o.y, o.w, Math.min(5, o.h));
    }

    // ---- getaway car ----
    drawCar(w.car);

    // ---- loot ----
    for (const l of w.loot) {
      if (l.taken || l.locked) continue;
      drawCash(l.x, l.y, l.kind === 'vault' ? 15 : 10);
    }
    for (const d of H.drops) {
      if (d.taken) continue;
      drawBag(d.x, d.y);
    }

    // ---- drill markers ----
    w.vaults.forEach(v => {
      if (v.open) return;
      ctx.save();
      ctx.translate(v.drillX, v.drillY);
      ctx.fillStyle = v.drilling ? '#E3552B' : '#7C6459';
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0A0B0E';
      ctx.fillRect(-2.5, -8, 5, 16);
      if (v.drilling) {
        ctx.strokeStyle = '#FFB347'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(0, 0, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * v.progress); ctx.stroke();
      }
      ctx.restore();
    });

    // ---- ping ----
    if (H.ping && H.pingT > 0) {
      const a = Math.min(1, H.pingT / 900);
      ctx.strokeStyle = 'rgba(227,85,43,' + a + ')'; ctx.lineWidth = 3;
      const rr = 16 + Math.sin(H.t / 120) * 5;
      ctx.beginPath(); ctx.arc(H.ping.x, H.ping.y, rr, 0, Math.PI * 2); ctx.stroke();
    }

    // ---- actors ----
    for (const e of H.enemies) drawEnemy(e);
    for (const c of H.crew) drawChar(c);
    drawChar(H.robo);

    // ---- bullets ----
    for (const b of H.bullets) {
      ctx.strokeStyle = b.color || '#F5E5A0';
      ctx.lineWidth = b.splash ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 1.5, b.y - b.vy * 1.5);
      ctx.stroke();
    }

    // ---- particles ----
    for (const p of H.particles) {
      if (p.arc) {
        ctx.strokeStyle = p.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.arc.x2, p.arc.y2); ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
    }

    // ---- floating numbers ----
    ctx.font = '700 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    for (const f of H.floats) {
      ctx.globalAlpha = Math.min(1, f.life / 400);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';

    ctx.restore();

    if (H.showMap) drawMinimapLarge();
    else drawMinimap();
    drawBanner();
  }

  function drawCar(car) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(0, 6, 52, 26, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2E1F1C';
    ctx.beginPath(); ctx.roundRect(-52, -24, 104, 48, 9); ctx.fill();
    ctx.fillStyle = '#3E2A24';
    ctx.beginPath(); ctx.roundRect(-34, -17, 60, 34, 6); ctx.fill();
    ctx.fillStyle = '#6FBFCB';
    ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.roundRect(-28, -13, 24, 26, 4); ctx.fill();
    ctx.globalAlpha = 1;
    // extraction glow when you can leave
    if (H.canExtract) {
      ctx.strokeStyle = 'rgba(123,197,154,' + (0.5 + Math.sin(H.t / 150) * 0.3) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, car.r, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(227,85,43,0.28)'; ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.arc(0, 0, car.r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawCash(x, y, r) {
    ctx.save();
    ctx.translate(x, y);
    const bob = Math.sin(H.t / 300 + x) * 1.5;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(0, r * 0.6, r * 0.9, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.translate(0, bob);
    ctx.fillStyle = '#6FA46B';
    ctx.beginPath(); ctx.roundRect(-r, -r * 0.6, r * 2, r * 1.2, 2); ctx.fill();
    ctx.fillStyle = '#8FC98A';
    ctx.beginPath(); ctx.roundRect(-r, -r * 0.6, r * 2, r * 0.35, 2); ctx.fill();
    ctx.strokeStyle = '#3E5C3A'; ctx.lineWidth = 1;
    ctx.strokeRect(-r, -r * 0.6, r * 2, r * 1.2);
    ctx.restore();
  }

  function drawBag(x, y) {
    ctx.save();
    ctx.translate(x, y);
    const bob = Math.sin(H.t / 240 + x) * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(0, 12, 16, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.translate(0, bob);
    ctx.fillStyle = '#4A4038';
    ctx.beginPath(); ctx.roundRect(-15, -10, 30, 22, 5); ctx.fill();
    ctx.strokeStyle = '#F5E5A0'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, -10, 7, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = '#7BC59A';
    ctx.font = '700 10px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('$', 0, 5);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // ==================== CHARACTER RENDERING ====================
  // One renderer for RoboKyle, crew and police. RoboKyle keeps his
  // look from Undead Nightmare — skin deltoids, black tank, one
  // chrome arm, blonde spikes — and the same body carries a mask
  // and outfit colour for everyone else.
  function drawChar(c) {
    if (c.dead) return;
    const SH = c.r * 1.14, CH = c.r * 0.78;
    const walk = Math.sin(c.walkPhase);

    ctx.save();
    ctx.translate(c.x, c.y);

    // downed characters lie flat and stop aiming
    if (c.downed) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath(); ctx.ellipse(0, 4, c.r + 6, c.r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8E0F14';
      ctx.beginPath(); ctx.ellipse(0, 0, c.r * 0.95, c.r * 0.62, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#F1E4D2';
      ctx.font = '700 11px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('DOWN', 0, -c.r - 10);
      const frac = c.isRobo ? (c.reviveProg || 0) / T.reviveTime : 1 - c.downTimer / T.downedBleedout;
      ctx.strokeStyle = '#E3552B'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, c.r + 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(frac, 0, 1)); ctx.stroke();
      ctx.textAlign = 'left';
      ctx.restore();
      return;
    }

    ctx.rotate(c.angle);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.ellipse(1, 3, CH + 5, SH + 2, 0, 0, Math.PI * 2); ctx.fill();

    // legs
    const legC = c.isRobo ? '#20242E' : shade(c.outfit, -0.25);
    [[-SH * 0.55, walk], [SH * 0.55, -walk]].forEach(([oy, sw]) => {
      ctx.save();
      ctx.translate(-2 + sw * 2.2, oy);
      ctx.fillStyle = legC;
      ctx.beginPath(); ctx.roundRect(-5, -4, 13, 8, 3); ctx.fill();
      ctx.restore();
    });

    // torso: skin yoke across the shoulders
    ctx.fillStyle = c.skin;
    ctx.strokeStyle = shade(c.skin, -0.45); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(-1, 0, CH + 1.5, SH, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    // shirt / tank
    ctx.fillStyle = c.isRobo ? '#15171F' : c.outfit;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.ellipse(-2, 0, CH, SH * 0.74, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath(); ctx.ellipse(-3, -SH * 0.26, CH * 0.6, SH * 0.22, -0.25, 0, Math.PI * 2); ctx.fill();

    // body armour plate
    const armor = c.char && D.ARMOR[c.char.armor];
    if (armor && armor.dr > 0 && c.char.armor !== 'riot') {
      ctx.fillStyle = c.char.armor === 'heavy' ? '#3A4048' : '#2A3038';
      ctx.beginPath(); ctx.roundRect(-CH * 0.5, -SH * 0.55, CH * 1.1, SH * 1.1, 3); ctx.fill();
      ctx.strokeStyle = '#565E68'; ctx.lineWidth = 1; ctx.stroke();
    }

    // arms converge on the grip
    const gx = CH + 10, gy = 1;
    // flesh arm
    ctx.strokeStyle = c.skin; ctx.lineWidth = 5.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-1, SH * 0.78); ctx.quadraticCurveTo(CH * 0.7, SH * 0.6, gx - 3, gy + 3.5); ctx.stroke();
    // RoboKyle's chrome arm; crew get a second flesh arm
    ctx.strokeStyle = c.isRobo ? '#C9CFDA' : c.skin;
    ctx.lineWidth = c.isRobo ? 6 : 5.4;
    ctx.beginPath(); ctx.moveTo(-1, -SH * 0.78); ctx.quadraticCurveTo(CH * 0.7, -SH * 0.6, gx - 1, gy - 3); ctx.stroke();
    if (c.isRobo) {
      ctx.strokeStyle = '#5A6070'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(CH * 0.2, -SH * 0.72); ctx.lineTo(CH * 0.5, -SH * 0.62); ctx.stroke();
    }
    ctx.lineCap = 'butt';

    // weapon
    drawWeapon(c, gx, gy);

    // head
    drawHead(c, CH * 0.5);

    // riot shield sits in front
    if (c.char && c.char.armor === 'riot') {
      ctx.fillStyle = 'rgba(120,150,170,0.45)';
      ctx.strokeStyle = '#8FA8B8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(CH + 2, -SH - 2, 7, SH * 2 + 4, 3); ctx.fill(); ctx.stroke();
    }

    if (c.hitFlash > 0) {
      ctx.fillStyle = 'rgba(255,70,55,' + Math.min(0.45, c.hitFlash / 26) + ')';
      ctx.beginPath(); ctx.ellipse(-1, 0, CH + 4, SH + 3, 0, 0, Math.PI * 2); ctx.fill();
      c.hitFlash -= 0.5;
    }
    ctx.restore();

    // name + carry pill above crew
    if (!c.isRobo) {
      ctx.font = '600 10px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(241,228,210,0.62)';
      ctx.fillText(c.name, c.x, c.y - c.r - 12);
      ctx.textAlign = 'left';
    }
  }

  function drawHead(c, hx) {
    const R = c.isRobo ? 7.1 : 6.6;
    const mask = D.MASKS[c.char ? c.char.mask : 'none'] || D.MASKS.none;
    ctx.save();
    ctx.translate(hx, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(-1.5, 0, R * 0.9, R * 0.85, 0, 0, Math.PI * 2); ctx.fill();

    // skull
    ctx.fillStyle = mask.color || c.skin;
    ctx.strokeStyle = shade(mask.color || c.skin, -0.45); ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.ellipse(0, 0, R * 0.95, R, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    if (mask.trim) {
      ctx.fillStyle = mask.trim;
      ctx.beginPath(); ctx.ellipse(R * 0.35, 0, R * 0.34, R * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (!mask.color) {
      // bare face: eyes forward
      ctx.fillStyle = '#0A0709';
      ctx.beginPath(); ctx.arc(R * 0.45, -R * 0.32, 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(R * 0.45, R * 0.32, 1.2, 0, Math.PI * 2); ctx.fill();
    } else {
      // mask eye slits
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(R * 0.25, -R * 0.52, 2.6, 1.8);
      ctx.fillRect(R * 0.25, R * 0.32, 2.6, 1.8);
    }

    // RoboKyle's blonde spikes fan out the back
    if (c.isRobo && !mask.color) {
      ctx.fillStyle = '#F2C75E';
      ctx.strokeStyle = '#C99A31'; ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(-1.6, 0, R * 0.82, R * 0.96, 0, Math.PI * 0.40, Math.PI * 1.60);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      [[-3.0, -5.4, -7.6, -7.4], [-4.6, -1.8, -9.8, -2.6], [-4.6, 1.8, -9.8, 2.6], [-3.0, 5.4, -7.6, 7.4]]
        .forEach(([x1, y1, x2, y2]) => {
          ctx.beginPath();
          ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x1 - 1, y1 + (y1 > 0 ? -2 : 2));
          ctx.closePath(); ctx.fill();
        });
    }
    ctx.restore();
  }

  function drawWeapon(c, gx, gy) {
    const w = D.WEAPONS[c.weapon];
    if (!w) return;
    const kick = c.flash > 0 ? 2 : 0;
    if (c.flash > 0) c.flash -= 6;
    ctx.save();
    ctx.translate(gx - kick, gy);

    if (w.kind === 'melee') {
      const sw = c.swing > 0 ? (c.swing / 160) : 0;
      if (c.swing > 0) c.swing -= 8;
      ctx.rotate(-sw * 1.1);
      ctx.fillStyle = c.weapon === 'bat' ? '#B07C43' : '#C9CFDA';
      const L = c.weapon === 'bat' ? 30 : 16;
      ctx.beginPath(); ctx.roundRect(0, -2, L, 4, 2); ctx.fill();
      if (c.weapon === 'bat') { ctx.fillStyle = '#8A5F32'; ctx.beginPath(); ctx.roundRect(L - 12, -3.5, 12, 7, 3); ctx.fill(); }
    } else {
      const kind = w.kind;
      const L = kind === 'pistol' ? 14 : kind === 'shotgun' ? 26 : kind === 'smg' ? 20
              : kind === 'rifle' ? 28 : kind === 'lmg' ? 34 : kind === 'explosive' ? 38 : 26;
      ctx.fillStyle = '#23262E';
      ctx.beginPath(); ctx.roundRect(0, -3, L, 6, 2); ctx.fill();
      ctx.fillStyle = '#3A3F4A';
      ctx.beginPath(); ctx.roundRect(0, -3, L * 0.4, 3, 1.5); ctx.fill();
      if (kind === 'lmg') { ctx.fillStyle = '#2E333C'; ctx.beginPath(); ctx.roundRect(L * 0.3, 2, 12, 8, 2); ctx.fill(); }
      if (kind === 'explosive') { ctx.fillStyle = '#5A2A22'; ctx.beginPath(); ctx.arc(L, 0, 5, 0, Math.PI * 2); ctx.fill(); }
      if (kind === 'energy' || kind === 'exotic') {
        ctx.fillStyle = w.color;
        ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.roundRect(L * 0.45, -1.6, L * 0.5, 3.2, 1.6); ctx.fill();
        ctx.globalAlpha = 1;
      }
      // muzzle flash
      if (c.flash > 0) {
        ctx.fillStyle = 'rgba(255,200,110,0.95)';
        ctx.beginPath();
        ctx.moveTo(L, 0); ctx.lineTo(L + 13, -5); ctx.lineTo(L + 9, 0); ctx.lineTo(L + 13, 5);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawEnemy(e) {
    const alpha = e.dead ? Math.max(0, (e.fade || 0) / 40) : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(1, 3, e.r * 0.9, e.r * 0.8, 0, 0, Math.PI * 2); ctx.fill();

    if (e.def.vehicle) {
      ctx.fillStyle = e.body;
      ctx.beginPath(); ctx.roundRect(-e.r, -e.r * 0.72, e.r * 2, e.r * 1.44, 6); ctx.fill();
      ctx.fillStyle = e.accent;
      ctx.beginPath(); ctx.roundRect(e.r * 0.2, -6, e.r * 0.9, 12, 3); ctx.fill();
    } else if (e.def.static) {
      ctx.fillStyle = '#2A2E24';
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = e.accent;
      ctx.beginPath(); ctx.roundRect(0, -4, e.r + 14, 8, 3); ctx.fill();
    } else {
      // body
      ctx.fillStyle = e.body;
      ctx.strokeStyle = '#0A0709'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.ellipse(-1, 0, e.r * 0.78, e.r * 1.05, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // vest / accent
      ctx.fillStyle = e.accent;
      ctx.beginPath(); ctx.roundRect(-e.r * 0.35, -e.r * 0.55, e.r * 0.8, e.r * 1.1, 3); ctx.fill();
      // head
      ctx.fillStyle = '#1A1D22';
      ctx.beginPath(); ctx.arc(e.r * 0.45, 0, e.r * 0.44, 0, Math.PI * 2); ctx.fill();
      // gun
      ctx.fillStyle = '#15171B';
      ctx.beginPath(); ctx.roundRect(e.r * 0.5, -2.5, e.wpn.melee ? 12 : 20, 5, 2); ctx.fill();
      // riot shield
      if (e.def.shield) {
        ctx.fillStyle = 'rgba(130,160,180,0.5)';
        ctx.strokeStyle = '#9AB4C4'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(e.r * 0.7, -e.r, 7, e.r * 2, 3); ctx.fill(); ctx.stroke();
      }
    }

    if (e.hitFlash > 0) {
      ctx.fillStyle = 'rgba(255,90,70,0.5)';
      ctx.beginPath(); ctx.arc(0, 0, e.r + 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // boss health bar
    if (e.isBoss && !e.dead) {
      const bw = 90;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(e.x - bw / 2, e.y - e.r - 20, bw, 7);
      ctx.fillStyle = '#B4231C';
      ctx.fillRect(e.x - bw / 2, e.y - e.r - 20, bw * clamp(e.hp / e.maxHp, 0, 1), 7);
      ctx.font = '700 10px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#F1E4D2';
      ctx.fillText(e.name, e.x, e.y - e.r - 26);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;
  }

  function shade(hex, amt) {
    if (!hex || hex[0] !== '#') return hex || '#888';
    let r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
    r = clamp(Math.round(r + 255 * amt), 0, 255);
    g = clamp(Math.round(g + 255 * amt), 0, 255);
    b = clamp(Math.round(b + 255 * amt), 0, 255);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // ==================== MINIMAP ====================
  function drawMinimap() {
    const w = H.world;
    const size = 150;
    const sc = size / Math.max(w.w, w.h);
    const x0 = 14, y0 = VH - size - 14;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(10,11,14,0.82)';
    ctx.fillRect(x0 - 4, y0 - 4, size + 8, size + 8);
    ctx.strokeStyle = '#37211C'; ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 4, y0 - 4, size + 8, size + 8);

    ctx.fillStyle = '#252932';
    ctx.fillRect(x0 + w.building.x * sc, y0 + w.building.y * sc, w.building.w * sc, w.building.h * sc);
    w.vaults.forEach(v => {
      ctx.fillStyle = v.open ? '#E3552B' : '#6B5A2E';
      ctx.fillRect(x0 + v.x * sc, y0 + v.y * sc, v.w * sc, v.h * sc);
    });
    ctx.fillStyle = '#7BC59A';
    ctx.fillRect(x0 + w.car.x * sc - 3, y0 + w.car.y * sc - 2, 6, 4);
    H.enemies.forEach(e => {
      if (e.dead) return;
      ctx.fillStyle = e.isBoss ? '#FF7AF0' : '#B4231C';
      ctx.fillRect(x0 + e.x * sc - 1.5, y0 + e.y * sc - 1.5, 3, 3);
    });
    H.crew.forEach(c => {
      if (c.dead) return;
      ctx.fillStyle = c.downed ? '#7C6459' : '#6FBFCB';
      ctx.fillRect(x0 + c.x * sc - 1.5, y0 + c.y * sc - 1.5, 3, 3);
    });
    ctx.fillStyle = '#F1E4D2';
    ctx.fillRect(x0 + H.robo.x * sc - 2, y0 + H.robo.y * sc - 2, 4, 4);
    ctx.restore();
  }

  function drawMinimapLarge() {
    const w = H.world;
    const size = Math.min(VW, VH) * 0.8;
    const sc = size / Math.max(w.w, w.h);
    const x0 = (VW - w.w * sc) / 2, y0 = (VH - w.h * sc) / 2;
    ctx.fillStyle = 'rgba(7,6,10,0.9)';
    ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = '#252932';
    ctx.fillRect(x0 + w.building.x * sc, y0 + w.building.y * sc, w.building.w * sc, w.building.h * sc);
    w.obstacles.forEach(o => {
      if (o.low) return;
      ctx.fillStyle = '#3D424E';
      ctx.fillRect(x0 + o.x * sc, y0 + o.y * sc, Math.max(1, o.w * sc), Math.max(1, o.h * sc));
    });
    w.vaults.forEach(v => {
      ctx.fillStyle = v.open ? '#E3552B' : '#6B5A2E';
      ctx.fillRect(x0 + v.x * sc, y0 + v.y * sc, v.w * sc, v.h * sc);
    });
    w.loot.forEach(l => {
      if (l.taken || l.locked) return;
      ctx.fillStyle = '#7BC59A';
      ctx.fillRect(x0 + l.x * sc - 2, y0 + l.y * sc - 2, 4, 4);
    });
    ctx.fillStyle = '#6FBFCB';
    ctx.fillRect(x0 + w.car.x * sc - 4, y0 + w.car.y * sc - 3, 8, 6);
    H.enemies.forEach(e => {
      if (e.dead) return;
      ctx.fillStyle = '#B4231C';
      ctx.fillRect(x0 + e.x * sc - 2, y0 + e.y * sc - 2, 4, 4);
    });
    ctx.fillStyle = '#F1E4D2';
    ctx.fillRect(x0 + H.robo.x * sc - 3, y0 + H.robo.y * sc - 3, 6, 6);
    ctx.font = '600 12px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#BFA898';
    ctx.fillText('TAB to close', VW / 2, y0 + w.h * sc + 24);
    ctx.textAlign = 'left';
  }

  function drawBanner() {
    if (!H.msg || H.msgT <= 0) return;
    const a = Math.min(1, H.msgT / 500);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.font = '700 30px "Black Ops One", Impact, sans-serif';
    ctx.fillStyle = '#F1E4D2';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
    ctx.strokeText(H.msg.text, VW / 2, VH * 0.20);
    ctx.fillText(H.msg.text, VW / 2, VH * 0.20);
    if (H.msg.sub) {
      ctx.font = '600 14px Inter, sans-serif';
      ctx.fillStyle = '#BFA898';
      ctx.fillText(H.msg.sub, VW / 2, VH * 0.20 + 24);
    }
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // ==================== HUD ====================
  const hud = {};
  function hudEl(id) { return hud[id] || (hud[id] = document.getElementById(id)); }

  function updateHud() {
    const p = H.robo;
    hudEl('hud-hp-fill').style.width = clamp(p.hp / p.maxHp * 100, 0, 100) + '%';
    hudEl('hud-hp-val').textContent = Math.max(0, Math.round(p.hp));

    const w = D.WEAPONS[p.weapon];
    hudEl('hud-weapon').textContent = w.name;
    if (w.kind === 'melee') hudEl('hud-ammo').textContent = '—';
    else if (w.heat) hudEl('hud-ammo').textContent = p.overheated ? 'OVERHEAT' : Math.round((1 - p.heat / 10) * 100) + '%';
    else hudEl('hud-ammo').textContent = p.reloading > 0 ? 'RELOAD' : p.mag + ' / ' + w.mag;

    hudEl('hud-carry-fill').style.width = clamp(p.carried / p.carryCap * 100, 0, 100) + '%';
    hudEl('hud-carry-val').textContent = money(p.carried);

    // squad total in the bags
    const total = H.all.reduce((s, a) => s + (a.dead ? 0 : a.carried), 0);
    hudEl('hud-total').textContent = money(total);

    // alarm / police
    const alarmBox = hudEl('hud-alarm');
    if (!H.alarm) {
      alarmBox.className = 'hud-alarm quiet';
      alarmBox.innerHTML = '<span class="k">Status</span><span class="v">Quiet</span>';
    } else if (!H.copsHere) {
      alarmBox.className = 'hud-alarm warn';
      alarmBox.innerHTML = '<span class="k">Police ETA</span><span class="v">' + Math.ceil(H.policeLeft / 1000) + 's</span>';
    } else if (!H.breached) {
      alarmBox.className = 'hud-alarm bad';
      alarmBox.innerHTML = '<span class="k">Breach in</span><span class="v">' + Math.ceil(H.breachLeft / 1000) + 's</span>';
    } else {
      alarmBox.className = 'hud-alarm bad';
      alarmBox.innerHTML = '<span class="k">Status</span><span class="v">BREACHED</span>';
    }

    // crew portraits
    const wrap = hudEl('hud-crew');
    if (wrap.children.length !== H.crew.length) {
      wrap.innerHTML = '';
      H.crew.forEach(() => {
        const d = document.createElement('div');
        d.className = 'hud-mate';
        d.innerHTML = '<span class="nm"></span><span class="hud-bar"><i></i></span><span class="cash"></span>';
        wrap.appendChild(d);
      });
    }
    H.crew.forEach((c, i) => {
      const node = wrap.children[i];
      node.className = 'hud-mate' + (c.dead ? ' is-dead' : c.downed ? ' is-down' : '');
      node.querySelector('.nm').textContent = c.name;
      node.querySelector('.hud-bar i').style.width = clamp(c.hp / c.maxHp * 100, 0, 100) + '%';
      node.querySelector('.cash').textContent = c.dead ? 'KIA' : money(c.carried);
    });

    // objective line
    const obj = hudEl('hud-objective');
    const openVaults = H.world.vaults.filter(v => v.open).length;
    if (H.canExtract) obj.textContent = 'Press E to drive off';
    else if (openVaults < H.world.vaults.length) obj.textContent = 'Drill the vault (E at the drill point)';
    else obj.textContent = 'Grab the cash, then get back to the car';
  }

  // ==================== TOUCH ====================
  const touch = { active: false, mx: 0, my: 0, aiming: false, aimAngle: 0, firing: false, interact: false };
  const tState = { moveId: null, aimId: null, moveOrigin: null, aimOrigin: null };

  function isTouch() {
    return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  }

  function bindTouch() {
    if (!isTouch()) return;
    touch.active = true;
    document.getElementById('heist-touch').style.display = 'block';

    const surf = canvas;
    surf.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        const r = surf.getBoundingClientRect();
        const x = t.clientX - r.left, y = t.clientY - r.top;
        if (x < r.width / 2 && tState.moveId === null) {
          tState.moveId = t.identifier; tState.moveOrigin = { x, y };
        } else if (x >= r.width / 2 && tState.aimId === null) {
          tState.aimId = t.identifier; tState.aimOrigin = { x, y };
          touch.aiming = true; touch.firing = true;
        }
      }
      e.preventDefault();
    }, { passive: false });

    surf.addEventListener('touchmove', (e) => {
      const r = surf.getBoundingClientRect();
      for (const t of e.changedTouches) {
        const x = t.clientX - r.left, y = t.clientY - r.top;
        if (t.identifier === tState.moveId && tState.moveOrigin) {
          const dx = x - tState.moveOrigin.x, dy = y - tState.moveOrigin.y;
          const m = Math.hypot(dx, dy) || 1;
          const cl = Math.min(1, m / 55);
          touch.mx = dx / m * cl; touch.my = dy / m * cl;
        } else if (t.identifier === tState.aimId && tState.aimOrigin) {
          const dx = x - tState.aimOrigin.x, dy = y - tState.aimOrigin.y;
          if (Math.hypot(dx, dy) > 8) touch.aimAngle = Math.atan2(dy, dx);
        }
      }
      e.preventDefault();
    }, { passive: false });

    const endT = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === tState.moveId) { tState.moveId = null; touch.mx = 0; touch.my = 0; }
        if (t.identifier === tState.aimId) { tState.aimId = null; touch.aiming = false; touch.firing = false; }
      }
    };
    surf.addEventListener('touchend', endT);
    surf.addEventListener('touchcancel', endT);

    const btn = (id, on, off) => {
      const n = document.getElementById(id);
      if (!n) return;
      n.addEventListener('touchstart', (e) => { e.preventDefault(); on(); }, { passive: false });
      n.addEventListener('touchend', (e) => { e.preventDefault(); off && off(); }, { passive: false });
    };
    btn('t-interact', () => { touch.interact = true; tryInteract(); }, () => { touch.interact = false; });
    btn('t-reload', () => tryReload(H.robo));
    btn('t-stance', () => toggleStance());
    btn('t-map', () => { H.showMap = !H.showMap; });
    btn('t-pause', () => togglePause());
  }

  // ==================== PAUSE BUTTONS ====================
  document.addEventListener('DOMContentLoaded', () => {
    const r = document.getElementById('btn-resume');
    if (r) r.addEventListener('click', GH.resumeHeist);
    const a = document.getElementById('btn-abandon');
    if (a) a.addEventListener('click', () => { if (confirm('Abandon the job? You lose everything in your bags.')) GH.abandonHeist(); });
    bindTouch();
    GH.boot();
  });
})();
