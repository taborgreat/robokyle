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
  const LO = D.LOOT;
  const GH = window.GH;

  const canvas = document.getElementById('heist-canvas');
  const ctx = canvas.getContext('2d');

  // ==================== UTIL ====================
  const rand  = (a, b) => a + Math.random() * (b - a);
  const rint  = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const lerp  = (a, b, t) => a + (b - a) * t;
  const pick  = (arr) => arr[Math.floor(Math.random() * arr.length)];
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
  // Real recorded samples live in audio.js; this is just the mission's
  // vocabulary on top of it. No synthesised beeps.
  const A = () => GH.audio;
  const sfx = {
    shot(w) {
      const s = GH.audio && GH.audio.weaponSound(w);
      if (s) GH.audio.play(s.name, { rate: s.rate * (0.94 + Math.random() * 0.12), vol: s.vol });
    },
    melee()  { A() && GH.audio.playVaried('meleeSwing', 0.7); },
    meleeHit(){ A() && GH.audio.playVaried('meleeHit', 0.9); },
    hit(armoured) { A() && GH.audio.playVaried(armoured ? 'hitArmor' : 'hitFlesh', 0.75); },
    ricochet(){ A() && GH.audio.playVaried('metal', 0.4); },
    hurt()   { A() && GH.audio.playVaried('hitFlesh', 0.9, 0.05); },
    pickup() { A() && GH.audio.playVaried('cash', 0.8); },
    cash()   { A() && GH.audio.playVaried('cash', 0.7); },
    register(){ A() && GH.audio.playVaried('register', 0.9); },
    glass()  { A() && GH.audio.playVaried('glass', 0.8); },
    drill()  { A() && GH.audio.play('drill', { rate: 1.6 + Math.random() * 0.3, vol: 0.28 }); },
    alarm()  { A() && GH.audio.play('alarm', { vol: 1 }); },
    boom()   { A() && GH.audio.play('gunHeavy', { rate: 0.45, vol: 1 }); },
    down()   { A() && GH.audio.play('down', { vol: 0.9 }); },
    revive() { A() && GH.audio.play('revive', { vol: 0.9 }); },
    vault()  { A() && GH.audio.play('vault', { vol: 1 }); },
    scream() {
      A() && GH.audio.play(Math.random() < 0.5 ? 'screamA' : 'screamB',
        { rate: 0.92 + Math.random() * 0.22, vol: 0.5 });
    },
    step()   { A() && GH.audio.play('step', { rate: 0.9 + Math.random() * 0.25, vol: 0.18 }); },
  };
  // Siren is a looping bed rather than a one-shot; the music engine owns it.
  function startSiren() { if (A()) GH.audio.music('heist'); }
  function stopSiren() {}

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

  // Split `total` into n randomised-but-exact parts. Piles vary in size
  // for looks, but the sum still matches the haul advertised on the intel
  // card — otherwise the number the player planned around is a lie.
  function splitCash(total, n, spread) {
    const w = [];
    let sum = 0;
    for (let i = 0; i < n; i++) { const v = 1 + rand(-spread, spread); w.push(v); sum += v; }
    return w.map(v => total * v / sum);
  }

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
    const atmCountCfg = bank.atms || 0;
    const drawerShare = 0.14;
    const boxShare    = boxCount > 0 ? 0.14 : 0;
    const atmShare    = atmCountCfg > 0 ? 0.10 : 0;
    const vaultShare  = 1 - drawerShare - boxShare - atmShare;

    // Cash registers sit on the teller counter. They are props you have to
    // actually break into rather than money lying on the floor: optional,
    // quick, and quiet if you pry them by hand.
    const tills = Math.max(4, Math.round(bw / 210));
    world.registers = [];
    const tillAmounts = splitCash(bank.haul * drawerShare, tills, 0.2);
    for (let i = 0; i < tills; i++) {
      const x = bx + WALL + 60 + (bw - 2 * WALL - 120) * (i / Math.max(1, tills - 1));
      world.registers.push({
        x, y: counterY - 22, r: 20,
        amount: tillAmounts[i],
        open: false, hp: 45, prying: 0, shake: 0,
      });
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
      const boxAmounts = splitCash(bank.haul * boxShare, boxes, 0.25);
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
            r: 15, amount: boxAmounts[placed], kind: 'box', locked: false, taken: false,
          });
          placed++;
        }
      });
    }

    // ---- ATMs along the lobby walls ----
    // Slower to crack than a till and worth more, but working one leaves
    // you standing in the open with your back to the room.
    world.atms = [];
    const atmCount = bank.atms || 0;
    for (let i = 0; i < atmCount; i++) {
      const onLeft = i % 2 === 0;
      const ax = onLeft ? bx + WALL + 26 : bx + bw - WALL - 26;
      const ay = counterY + 110 + Math.floor(i / 2) * 130;
      if (ay > by + bh - 90) break;
      world.atms.push({
        x: ax, y: ay, r: 20,
        facing: onLeft ? 0 : Math.PI,
        amount: 0,                       // filled in below, exactly
        open: false, prog: 0, hp: 90, shake: 0,
      });
    }

    // ATM money comes out of the advertised take, so the intel figure on
    // the mission card stays honest.
    if (world.atms.length) {
      const amounts = splitCash(bank.haul * atmShare, world.atms.length, 0.2);
      world.atms.forEach((a, i) => { a.amount = amounts[i]; });
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

    buildNav(world);
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
    // They turn up carrying whatever damage they left the last job with.
    a.hp = GH.curHp(c);
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
    a.suspicion = 0;
    a.target = null;
    a.lastSeen = null;
    a.repathe = 0;
    a.seed = Math.random() * 10000;
    return a;
  }

  // ==================== HEIST START ====================
  GH.startHeist = (bankId) => {
    if (GH.audio) { GH.audio.resume(); GH.audio.music('heist'); }

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
      bodies: [], civilians: [],
      t: 0, last: performance.now(), running: true, paused: false,
      civKills: 0,
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

    H.civilians = spawnCivilians(world, bank);

    // interior guards
    for (let i = 0; i < bank.guards; i++) {
      const b = world.building;
      let gx = 0, gy = 0, ok = false;
      for (let tries = 0; tries < 40 && !ok; tries++) {
        gx = b.x + 60 + Math.random() * (b.w - 120);
        gy = b.y + 60 + Math.random() * (b.h - 140);
        const cx = Math.floor(gx / NAV_CELL), cy = Math.floor(gy / NAV_CELL);
        ok = navFree(world.nav, cx, cy);
      }
      if (!ok) { gx = b.x + b.w / 2; gy = world.counterY + 80; }   // lobby fallback
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
    banner(bank.name, bank.boss ? bank.bossName + ' is inside' : 'In, vault, out.');
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
    banner(next === 'hold' ? 'HOLD HERE' : 'ON ME', '');
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
        if (!v.drilling) { v.drilling = true; trip('drill'); banner('DRILL IS RUNNING', 'Keep it covered.'); }
        return;
      }
    }
    // lift a wallet — quiet, and quicker than the vault
    if (tryRobCivilian(p, 0)) return;

    // crack an ATM — a hold, and it takes a while
    for (const a of H.world.atms) {
      if (a.open) continue;
      if (Math.hypot(p.x - a.x, p.y - a.y) > 56) continue;
      p.atm = a;
      return;
    }

    // pry open a cash register (quiet — no alarm)
    for (const t of H.world.registers) {
      if (t.open) continue;
      if (Math.hypot(p.x - t.x, p.y - t.y) > 52) continue;
      openRegister(t, false);
      return;
    }
    // grab loot
    grabNearbyLoot(p, true);
  }

  function openATM(a, by) {
    if (a.open) return;
    a.open = true;
    a.shake = 12;
    sfx.register();
    sfx.glass();
    H.world.loot.push({
      x: a.x + Math.cos(a.facing) * 30, y: a.y + 18, r: 14,
      amount: a.amount, kind: 'atm', locked: false, taken: false,
    });
    for (let i = 0; i < 12; i++) {
      H.particles.push({
        x: a.x, y: a.y, vx: rand(-2.6, 2.6), vy: rand(-3.2, -0.5),
        life: rand(14, 28), r: rand(1.4, 3),
        color: i % 2 ? 'rgba(150,200,150,0.85)' : 'rgba(210,215,225,0.7)',
      });
    }
    // ripping open a machine in the middle of the lobby is not subtle
    panicAll(a.x, a.y, 300, 'seen');
    for (const e of H.enemies) {
      if (e.dead || e.alerted) continue;
      if (dist(e, a) < 340 && hasLOS(e, a)) {
        e.suspicion = 1;
        e.lastSeen = by ? { x: by.x, y: by.y } : { x: a.x, y: a.y };
      }
    }
  }

  // loud = smashed with a weapon rather than levered open by hand
  function openRegister(t, loud) {
    if (t.open) return;
    t.open = true;
    t.shake = 12;
    sfx.register();
    if (loud) { sfx.glass(); if (!H.alarm) trip('teller'); }
    H.world.loot.push({
      x: t.x + rand(-6, 6), y: t.y + 20, r: 13,
      amount: t.amount, kind: 'till', locked: false, taken: false,
    });
    for (let i = 0; i < 9; i++) {
      H.particles.push({
        x: t.x, y: t.y, vx: rand(-2.4, 2.4), vy: rand(-3, -0.6),
        life: rand(14, 26), r: rand(1.4, 3),
        color: i % 2 ? 'rgba(150,200,150,0.85)' : 'rgba(200,200,190,0.7)',
      });
    }
  }

  function grabNearbyLoot(a, manual) {
    const reach = manual ? 52 : 40;
    let got = 0;
    for (const l of H.world.loot) {
      if (l.taken || l.locked) continue;
      if (dist(a, l) > reach) continue;
      const room = a.carryCap - a.carried;
      if (room <= 4) { if (manual) floatText(a.x, a.y - 26, 'BAG FULL', '#E0B44C'); return; }
      const take = Math.min(room, l.amount);
      a.carried += take; l.amount -= take;
      got += take;
      if (l.amount <= 1) l.taken = true;
      sfx.cash();
      floatText(l.x, l.y - 20, '+' + money(take), '#7BC59A');

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
    const why = {
      gun: 'Gunfire heard',
      teller: 'A teller hit the silent alarm',
      drill: 'The drill tripped the alarm',
      guard: 'A guard called it in',
      civilian: 'Somebody got to a phone',
    }[reason] || 'Someone raised the alarm';
    banner('ALARM', why + '. Police are coming.');
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
      // Only the player smashes tills with melee. Crew swinging at a guard
      // next to the counter should not quietly empty the registers for you.
      for (const t of (a.isRobo ? H.world.registers : [])) {
        if (t.open) continue;
        if (Math.hypot(a.x - t.x, a.y - t.y) > w.reach + t.r) continue;
        const da = Math.abs(normAngle(Math.atan2(t.y - a.y, t.x - a.x) - ang));
        if (da > w.arc / 2) continue;
        t.hp -= w.dmg * a.dmgMul; t.shake = 8;
        if (t.hp <= 0) openRegister(t, false);   // melee stays quiet
      }
      for (const e of H.enemies) {
        if (e.dead) continue;
        if (dist(a, e) > w.reach + e.r) continue;
        const da = Math.abs(normAngle(Math.atan2(e.y - a.y, e.x - a.x) - ang));
        if (da > w.arc / 2) continue;
        const silentKill = !H.alarm && !e.alerted;
        damageEnemy(e, w.dmg * a.dmgMul, a, ang);
        if (w.knockback) { e.x += Math.cos(ang) * w.knockback; e.y += Math.sin(ang) * w.knockback; }
        if (silentKill && e.dead) floatText(e.x, e.y - 30, 'QUIET', '#4FB3C4');
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
    if (!w.silent) {
      panicAll(a.x, a.y, 520, 'seen');
      if (!H.alarm) trip('gun');
    }
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
    sfx.hit((e.dr || 0) > 0.15);
    spark(e.x, e.y, 4);
    if (e.hp <= 0) {
      e.dead = true;
      if (src && src.side === 'crew') { src.kills = (src.kills || 0) + 1; GH.state.stats.kills++; }
      spark(e.x, e.y, 12);
      // A body on the floor is evidence. Anyone who walks past it reacts.
      H.bodies.push({ x: e.x, y: e.y, seen: false });
      if (e.isBoss) banner(e.name + ' IS DOWN', 'Keep moving.');
    } else {
      // Survived it — they shout, and they get on the radio.
      e.suspicion = 1;
      if (e.radio == null || e.radio > 700) e.radio = 700;
      alertNearby(e, 300);
      if (src) e.lastSeen = { x: src.x, y: src.y };
    }
  }

  // One guard reacting pulls in everyone within earshot.
  function alertNearby(from, radius) {
    for (const o of H.enemies) {
      if (o === from || o.dead || o.alerted) continue;
      if (dist(o, from) > radius) continue;
      o.alerted = true;
      o.suspicion = 1;
      o.draw = o.wpn.melee ? 260 : 520;
      o.lastSeen = from.lastSeen || { x: from.x, y: from.y };
      if (o.radio == null || o.radio > 1400) o.radio = 1400;
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
        floatText(a.x, a.y - 30, 'LUCKY', '#5FBF87');
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
    banner(a.name + ' IS DOWN', a.isRobo ? 'Get up, or that is the job.' : 'Stand them up with E.');
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
        H.world.navDirty = true;
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
    H.world.navDirty = true;      // the vault is a doorway now
    H.world.loot.forEach(l => { if (l.kind === 'vault' && l.vaultId === v.id) l.locked = false; });
    banner('VAULT IS OPEN', money(v.cash) + ' in there. Fill the bags.');
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
        // spread them along the edge instead of stacking on one point
        if (side === 0) { x = rand(60, w.w - 60); y = w.h - rand(40, 90); }
        else if (side === 1) { x = rand(40, 130); y = rand(w.h - STREET + 20, w.h - 60); }
        else { x = w.w - rand(40, 130); y = rand(w.h - STREET + 20, w.h - 60); }
      }
      // never drop a cop inside a wall
      const nav = w.nav;
      if (!navFree(nav, Math.floor(x / NAV_CELL), Math.floor(y / NAV_CELL))) {
        const free = nearestFree(nav, Math.floor(x / NAV_CELL), Math.floor(y / NAV_CELL));
        if (free) { x = cellCentre(free[0]); y = cellCentre(free[1]); }
      }
      const e = makeEnemy(pickCop(H.bank), x, y);
      e.alerted = true;
      H.enemies.push(e);
    }
  }

  // ==================== AI ====================
  function hasLOS(a, b) {
    // Bounding-box reject first: segRect is the expensive part and most
    // obstacles are nowhere near the sight line.
    const minX = a.x < b.x ? a.x : b.x, maxX = a.x < b.x ? b.x : a.x;
    const minY = a.y < b.y ? a.y : b.y, maxY = a.y < b.y ? b.y : a.y;
    const obs = H.world.obstacles;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (o.low) continue;
      if (o.kind === 'vaultdoor' && !o.solid) continue;
      if (o.x > maxX || o.x + o.w < minX || o.y > maxY || o.y + o.h < minY) continue;
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
    if (!e.def.static && unembed(e, dt)) return;   // free them first
    if (e.hitFlash > 0) e.hitFlash -= dt * 0.06;
    if (e.muzzle > 0) e.muzzle -= dt;
    if (e.draw > 0) e.draw -= dt;
    if (e.swing > 0) e.swing -= dt;

    const tgt = nearestTarget(e);
    if (!tgt) return;
    const d = dist(e, tgt);
    const los = hasLOS(e, tgt);

    // ---- awareness ----
    // Suspicion builds from what a guard can actually see: how close you
    // are, whether you are armed, and whether you are wearing a mask into
    // a bank. It is not instant, so a careful approach still works.
    if (!e.alerted) {
      e.suspicion = e.suspicion || 0;
      const SIGHT = 360;
      if (los && d < SIGHT) {
        const wpn = D.WEAPONS[tgt.weapon];
        const armed  = wpn && wpn.kind !== 'melee';
        const masked = tgt.char && tgt.char.mask && tgt.char.mask !== 'none';
        // facing matters — a guard notices what is in front of him faster
        const rel = Math.abs(normAngle(Math.atan2(tgt.y - e.y, tgt.x - e.x) - e.angle));
        const inView = rel < 1.1 ? 1 : 0.35;
        let rate = (1 - d / SIGHT) * inView;
        if (armed)  rate *= 3.2;
        if (masked) rate *= 2.0;
        if (H.alarm) rate = 4;
        e.suspicion = Math.min(1, e.suspicion + rate * dt / 1000);
        // turn toward whatever caught his eye
        if (e.suspicion > 0.25) {
          e.angle = lerp(e.angle, Math.atan2(tgt.y - e.y, tgt.x - e.x), 0.08);
        }
      } else {
        e.suspicion = Math.max(0, e.suspicion - 0.35 * dt / 1000);
      }

      // a body in plain sight is all the proof anyone needs
      if (!e.alerted) {
        for (const b of H.bodies) {
          if (dist(e, b) > 190) continue;
          if (!hasLOS(e, b)) continue;
          e.suspicion = 1;
          e.lastSeen = { x: b.x, y: b.y };
          break;
        }
      }

      if (e.suspicion >= 1) {
        e.alerted = true;
        e.radio = 900;
        e.draw = e.wpn.melee ? 260 : 520;   // time spent pulling the weapon
        alertNearby(e, 260);
        floatText(e.x, e.y - e.r - 16, '!', '#E0B44C');
      } else {
        patrol(e, dt);
        return;
      }
    }

    // A guard that spots you radios it in shortly after.
    if (e.radio > 0) {
      e.radio -= dt;
      if (e.radio <= 0 && !H.alarm) trip('guard');
    }

    if (los) { e.lastSeen = { x: tgt.x, y: tgt.y }; e.searchT = 0; }
    else e.searchT = (e.searchT || 0) + dt;
    e.angle = lerp(e.angle, Math.atan2((e.lastSeen || tgt).y - e.y, (e.lastSeen || tgt).x - e.x), 0.16);

    const wpn = e.wpn;
    const wantRange = wpn.melee ? wpn.reach - 6 : Math.min(wpn.range * 0.62, 330);

    if (!e.def.static && !(e.def.vehicle && d < 200)) {
      let goal = los ? tgt : (e.lastSeen || tgt);
      const sp = e.speed * (H.breached ? 1.08 : 1);

      // Police arriving from the street have to come in through the front
      // door. Aim them at the entrance first: it is how a real response
      // works, and it turns one long cross-boundary route into two short
      // ones that never fail.
      const B = H.world.building, dr = H.world.door;
      const outside = e.y > B.y + B.h - 4;
      const targetInside = goal.y < B.y + B.h - 4;
      if (outside && targetInside) {
        goal = { x: dr.x + dr.w / 2, y: dr.y - 26 };
      }
      if (d > wantRange || !los) {
        // route around walls instead of pressing into them
        navigateTo(e, goal.x, goal.y, sp, dt);
      } else if (d < wantRange * 0.55 && los && !wpn.melee) {
        // back off to a comfortable firing distance
        const ang = Math.atan2(goal.y - e.y, goal.x - e.x);
        moveActor(e, -Math.cos(ang) * sp * 0.6, -Math.sin(ang) * sp * 0.6, dt);
      } else if (los) {
        // in position: strafe a little so a firing line is not a queue
        const ang = Math.atan2(goal.y - e.y, goal.x - e.x) + Math.PI / 2;
        const drift = Math.sin((H.t + (e.seed || 0)) / 900) * 0.55;
        moveActor(e, Math.cos(ang) * sp * drift, Math.sin(ang) * sp * drift, dt);
      }
      separate(e, H.enemies, e.r * 2.0, 0.32, dt);
    }

    // shooting
    e.cd -= dt;
    if (los && d < wpn.range && e.cd <= 0 && !(e.draw > 0)) {
      if (wpn.melee) {
        if (d < wpn.reach + tgt.r) {
          e.cd = wpn.cd;
          e.swing = 220;
          sfx.melee();
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
        e.muzzle = 70;
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
    navigateTo(e, e.patrolTo.x, e.patrolTo.y, e.speed * 0.42, dt);
    // reached it (or gave up) — pick somewhere new next tick
    if (Math.hypot(e.patrolTo.x - e.x, e.patrolTo.y - e.y) < 30) e.repathe = 0;
  }

  // ---- crew AI ----
  // They are not a conga line. Left alone they will pick up cash they can
  // see, go pick a downed teammate up, and fight without being told. The
  // player's stance toggle only decides whether they stay near him.
  function stepCrew(c, dt) {
    if (c.dead) return;
    if (!c.downed && unembed(c, dt)) return;

    if (c.downed) {
      c.downTimer -= dt;
      if (c.downTimer <= 0) {
        c.dead = true;
        H.killedIds.push(c.char.id);
        banner(c.name + ' DIDN\u2019T MAKE IT', 'That one is permanent.');
      }
      return;
    }

    const p = H.robo;
    const w = D.WEAPONS[c.weapon];
    const speed = 2.1 * c.moveMul;

    if (c.reloading > 0) c.reloading -= dt;
    if (c.heat > 0) c.heat = Math.max(0, c.heat - (w.cool || 2) * dt / 1000);
    c.cd -= dt;

    // ---------- 1. pick a threat ----------
    let foe = null, fd = 1e9;
    for (const e of H.enemies) {
      if (e.dead) continue;
      const d = dist(c, e);
      if (d < fd && d < 480 && hasLOS(c, e)) { fd = d; foe = e; }
    }
    // a ping overrides target choice
    if (H.ping && H.pingT > 0) {
      let pf = null, pd = 1e9;
      for (const e of H.enemies) {
        if (e.dead) continue;
        const d = Math.hypot(e.x - H.ping.x, e.y - H.ping.y);
        if (d < 170 && d < pd && hasLOS(c, e)) { pd = d; pf = e; }
      }
      if (pf) { foe = pf; fd = dist(c, pf); }
    }

    // ---------- 2. a mate on the floor outranks everything but survival ----------
    let rescue = null;
    if (!foe || fd > 240) {
      let bd = 420;
      for (const m of H.all) {
        if (m === c || m.dead || !m.downed) continue;
        const d = dist(c, m);
        if (d < bd) { bd = d; rescue = m; }
      }
    }

    // ---------- 3. act ----------
    // Extraction wins over everything. They will still shoot on the move,
    // but they stop chasing money and start running for the car.
    if (H.extractPhase) {
      c.state = 'extract';
      const car = H.world.car;
      const d = dist(c, car);
      if (d > 44) navigateTo(c, car.x, car.y, speed * 1.25, dt);
      if (foe && fd < (w.range || w.reach + 20)) {
        c.angle = lerp(c.angle, Math.atan2(foe.y - c.y, foe.x - c.x), 0.2);
        if (w.mag && c.mag <= 0) tryReload(c);
        else fire(c, foe.x, foe.y);
      } else {
        c.angle = lerp(c.angle, Math.atan2(car.y - c.y, car.x - c.x), 0.15);
      }
      separate(c, H.all, c.r * 2.2, 0.34, dt);
      grabNearbyLoot(c, false);
      return;
    }

    if (foe) {
      c.state = 'engage';
      c.angle = lerp(c.angle, Math.atan2(foe.y - c.y, foe.x - c.x), 0.2);
      const want = w.kind === 'melee' ? w.reach - 8 : Math.min((w.range || 420) * 0.55, 320);
      if (fd > want) {
        navigateTo(c, foe.x, foe.y, speed, dt);
      } else if (fd < want * 0.5 && w.kind !== 'melee') {
        const ang = Math.atan2(foe.y - c.y, foe.x - c.x);
        moveActor(c, -Math.cos(ang) * speed * 0.7, -Math.sin(ang) * speed * 0.7, dt);
      }
      if (w.mag && c.mag <= 0) tryReload(c);
      else if (fd < (w.range || w.reach + 20)) fire(c, foe.x, foe.y);

    } else if (rescue) {
      c.state = 'revive';
      navigateTo(c, rescue.x, rescue.y, speed * 1.1, dt);
      c.angle = lerp(c.angle, Math.atan2(rescue.y - c.y, rescue.x - c.x), 0.15);
      if (dist(c, rescue) < 44 && !rescue.isRobo) {
        c.reviveProg = (c.reviveProg || 0) + dt;
        if (c.reviveProg > T.reviveTime) {
          rescue.downed = false;
          rescue.hp = rescue.maxHp * 0.5;
          c.reviveProg = 0;
          sfx.revive();
          banner(rescue.name + ' IS UP', c.name + ' got them.');
        }
      } else c.reviveProg = 0;

    } else {
      // ---------- idle: go earn your cut ----------
      const room = c.carryCap - c.carried > 200;
      let target = null, td = c.stance === 'hold' ? 220 : 460;

      if (room) {
        for (const l of H.world.loot) {
          if (l.taken || l.locked) continue;
          const d = dist(c, l);
          if (d < td) { td = d; target = l; }
        }
        for (const d2 of H.drops) {
          if (d2.taken) continue;
          const d = dist(c, d2);
          if (d < td) { td = d; target = d2; }
        }
      }

      if (target) {
        c.state = 'loot';
        navigateTo(c, target.x, target.y, speed, dt);
        c.angle = lerp(c.angle, Math.atan2(target.y - c.y, target.x - c.x), 0.14);
      } else if (c.stance === 'follow') {
        c.state = 'follow';
        // loose formation, offset behind RoboKyle rather than on top of him
        const off = [[-52, 44], [52, 44], [0, 70]][c.slot - 1] || [0, 56];
        const tx = p.x + off[0], ty = p.y + off[1];
        const d = Math.hypot(tx - c.x, ty - c.y);
        if (d > 38) {
          navigateTo(c, tx, ty, clamp(d / 55, 0.7, 1) * speed, dt);
          c.angle = lerp(c.angle, Math.atan2(ty - c.y, tx - c.x), 0.14);
        } else {
          c.angle = lerp(c.angle, p.angle, 0.1);
        }
      } else {
        c.state = 'hold';
        c.angle = lerp(c.angle, p.angle, 0.06);
      }

      if (w.mag && c.mag < w.mag) tryReload(c);
    }

    // never bunch up on each other or on RoboKyle
    separate(c, H.all, c.r * 2.2, 0.34, dt);

    // whatever they are doing, they hoover up cash they walk over
    grabNearbyLoot(c, false);
  }

  // ==================== CIVILIANS ====================
  // Tellers behind the counter, customers in the lobby. They are not
  // targets — they are pressure. They scream, they run for the door, and
  // if one gets out or reaches a phone they call the police themselves.
  // They also carry wallets, which is free money for anyone patient
  // enough to take it before the shooting starts.

  const CIV_FIRST = ['Marcy','Dev','Priya','Tom','Aisha','Gordon','Lena','Ray','Nina','Karl',
                     'Sofia','Errol','Jean','Malik','Bea','Hugo'];

  function makeCivilian(kind, x, y) {
    return {
      kind, x, y, r: 15,
      angle: kind === 'teller' ? Math.PI / 2 : rand(0, Math.PI * 2),
      state: 'idle',              // idle | scared | flee | cower | robbed
      hp: 30, dead: false, downed: false, side: 'civ',
      walkPhase: 0, hitFlash: 0,
      panic: 0,                   // 0..1
      robbed: false, robProg: 0,
      wallet: kind === 'customer'
        ? Math.round(rand(LO.walletMin, LO.walletMax))
        : Math.round(rand(0, LO.tellerWalletMax)),
      callT: rand(9000, 15000),   // time to reach a phone once panicking
      idleT: rand(1200, 4000),
      screamed: false,
      name: pick(CIV_FIRST),
      skin: pick(D.SKIN_TONES),
      outfit: kind === 'teller' ? '#7E2438' : pick(D.OUTFITS).color,
      seed: Math.random() * 1000,
    };
  }

  function spawnCivilians(world, bank) {
    const list = [];
    // one teller per till, standing on the staff side of the counter
    world.registers.forEach((t, i) => {
      if (i % 2 && world.registers.length > 4) return;   // not every till is staffed
      list.push(makeCivilian('teller', t.x + rand(-8, 8), t.y - 26));
    });
    // customers milling about the lobby
    const custs = clamp(2 + Math.round(bank.guards * 0.8), 3, 9);
    const B = world.building;
    for (let i = 0; i < custs; i++) {
      let x = 0, y = 0, ok = false;
      for (let tries = 0; tries < 30 && !ok; tries++) {
        x = B.x + 70 + Math.random() * (B.w - 140);
        y = world.counterY + 60 + Math.random() * (B.y + B.h - world.counterY - 120);
        ok = navFree(world.nav, Math.floor(x / NAV_CELL), Math.floor(y / NAV_CELL));
      }
      if (ok) list.push(makeCivilian('customer', x, y));
    }
    return list;
  }

  function scare(c, why) {
    if (c.dead) return;
    c.panic = 1;
    if (c.state === 'idle') c.state = 'scared';
    if (!c.screamed) {
      c.screamed = true;
      sfx.scream();
    }
    // Staff are trained to comply: hands up, stay put. Customers run.
    if (c.kind === 'teller') { c.state = 'cower'; c.handsUp = true; }
    else if (why === 'seen' || why === 'alarm') c.state = 'flee';
  }

  function panicAll(x, y, radius, why) {
    for (const c of H.civilians) {
      if (c.dead) continue;
      if (Math.hypot(c.x - x, c.y - y) > radius) continue;
      scare(c, why);
    }
  }

  function stepCivilian(c, dt) {
    if (c.dead) return;
    if (c.hitFlash > 0) c.hitFlash -= dt * 0.06;
    // Being held up pins them briefly, then they carry on doing whatever
    // they were doing. Previously this latched and they never moved again.
    if (c.heldUp > 0) {
      c.heldUp -= dt;
      c.state = 'cower';
      if (c.heldUp <= 0) c.state = c.wasFleeing ? 'flee' : (c.kind === 'teller' ? 'cower' : 'flee');
    }

    // Anything frightening nearby: a drawn gun, a body, the alarm.
    if (!c.panic) {
      if (H.alarm) scare(c, 'alarm');
      else {
        for (const a of H.all) {
          if (a.dead || a.downed) continue;
          const d = dist(c, a);
          if (d > 190) continue;
          const w = D.WEAPONS[a.weapon];
          const armed = w && w.kind !== 'melee';
          const masked = a.char && a.char.mask && a.char.mask !== 'none';
          if ((armed || masked) && hasLOS(c, a)) { scare(c, 'seen'); break; }
        }
        for (const b of H.bodies) {
          if (dist(c, b) < 170 && hasLOS(c, b)) { scare(c, 'seen'); break; }
        }
      }
    }

    if (c.panic > 0) {
      // A frightened civilian who is not being watched will get to a phone.
      c.callT -= dt;
      if (c.callT <= 0 && !H.alarm) {
        trip('civilian');
        c.callT = 1e9;
      }
    }

    const speed = 1.9;
    if (c.state === 'flee') {
      // head for the front door and out onto the street
      const dr = H.world.door;
      const goal = c.y > H.world.building.y + H.world.building.h - 10
        ? { x: c.x, y: H.world.h - 60 }                   // already outside, keep going
        : { x: dr.x + dr.w / 2, y: dr.y + 40 };
      navigateTo(c, goal.x, goal.y, speed, dt);
      c.angle = lerp(c.angle, Math.atan2(goal.y - c.y, goal.x - c.x), 0.2);
      // made it out — they will be telling the police everything
      if (c.y > H.world.h - 80) {
        c.dead = true;                                    // leaves the level
        if (!H.alarm) trip('civilian');
      }
    } else if (c.state === 'cower') {
      // stay put, hands up
      c.angle = lerp(c.angle, c.angle, 0.1);
    } else if (c.state === 'scared') {
      // back away from the nearest threat
      let near = null, nd = 1e9;
      for (const a of H.all) {
        if (a.dead || a.downed) continue;
        const d = dist(c, a);
        if (d < nd) { nd = d; near = a; }
      }
      if (near && nd < 200) {
        const ang = Math.atan2(c.y - near.y, c.x - near.x);
        moveActor(c, Math.cos(ang) * speed * 0.9, Math.sin(ang) * speed * 0.9, dt);
        c.angle = lerp(c.angle, ang + Math.PI, 0.2);
      } else if (Math.random() < 0.01) {
        c.state = c.kind === 'teller' ? 'cower' : 'flee';
      }
    } else {
      // idle: tellers stand their post, customers drift
      c.idleT -= dt;
      if (c.kind === 'customer') {
        if (c.idleT <= 0) {
          c.idleT = rand(2000, 5000);
          const B = H.world.building;
          c.wanderTo = {
            x: clamp(c.x + rand(-160, 160), B.x + 60, B.x + B.w - 60),
            y: clamp(c.y + rand(-110, 110), H.world.counterY + 50, B.y + B.h - 70),
          };
        }
        if (c.wanderTo) {
          const d = Math.hypot(c.wanderTo.x - c.x, c.wanderTo.y - c.y);
          if (d > 18) {
            navigateTo(c, c.wanderTo.x, c.wanderTo.y, speed * 0.35, dt);
            c.angle = lerp(c.angle, Math.atan2(c.wanderTo.y - c.y, c.wanderTo.x - c.x), 0.08);
          }
        }
      } else {
        c.angle = lerp(c.angle, Math.PI / 2, 0.05);
      }
    }

    separate(c, H.civilians, c.r * 2.2, 0.3, dt);
  }

  // Robbing: hold E next to someone. Quiet, but it terrifies them, and a
  // guard who sees it will not let it go.
  function tryRobCivilian(p, dt) {
    let target = null, td = 54;
    for (const c of H.civilians) {
      if (c.dead || c.robbed) continue;
      const d = dist(p, c);
      if (d < td) { td = d; target = c; }
    }
    if (!target) { if (p.robbing) p.robbing.robProg = 0; p.robbing = null; return false; }

    p.robbing = target;
    target.robProg += dt;
    scare(target, 'rob');
    // Hands up and rooted to the spot. A civilian who backs away from the
    // person robbing them makes the whole interaction impossible.
    target.wasFleeing = target.state === 'flee' || target.wasFleeing;
    target.state = 'cower';
    target.heldUp = 400;
    if (target.robProg > 700) {
      target.robbed = true;
      target.robProg = 0;
      p.robbing = null;
      const take = Math.min(target.wallet, Math.max(0, p.carryCap - p.carried));
      if (take > 0) {
        p.carried += take;
        sfx.pickup();
        floatText(target.x, target.y - 26, '+' + money(take), '#5FBF87');
      } else {
        floatText(target.x, target.y - 26, 'BAG FULL', '#E0B44C');
      }
      target.wallet = 0;
      target.heldUp = 500;
      target.wasFleeing = true;      // once you have taken it, they run
      // a guard watching you rob someone is not going to shrug it off
      for (const e of H.enemies) {
        if (e.dead || e.alerted) continue;
        if (dist(e, target) < 320 && hasLOS(e, target)) {
          e.suspicion = 1;
          e.lastSeen = { x: p.x, y: p.y };
        }
      }
    }
    return true;
  }

  function drawCivilian(c) {
    if (c.dead) return;
    // Match the crew's build so a bystander reads as an adult standing
    // next to them, not a child.
    const SH = c.r * 1.12, CH = c.r * 0.76;
    const walk = Math.sin(c.walkPhase);

    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);

    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.beginPath(); ctx.ellipse(1, 3, CH + 4, SH + 2, 0, 0, Math.PI * 2); ctx.fill();

    // legs
    ctx.fillStyle = shade(c.outfit, -0.22);
    [[-SH * 0.55, walk], [SH * 0.55, -walk]].forEach(function (pair) {
      ctx.save();
      ctx.translate(-2 + pair[1] * 2.2, pair[0]);
      ctx.beginPath(); ctx.roundRect(-5, -3.6, 12, 7.2, 3); ctx.fill();
      ctx.restore();
    });

    // torso
    ctx.fillStyle = c.outfit;
    ctx.strokeStyle = '#0A0D12'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(-1, 0, CH + 1, SH, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    if (c.kind === 'teller') {
      // pale shirt front under a burgundy waistcoat, plus a name badge —
      // nothing like the navy/black of anyone carrying a weapon
      ctx.fillStyle = '#EDF1F5';
      ctx.beginPath(); ctx.roundRect(CH * 0.05, -SH * 0.5, CH * 0.85, SH * 1.0, 2); ctx.fill();
      ctx.fillStyle = shade(c.outfit, -0.08);
      ctx.beginPath(); ctx.roundRect(-CH * 0.1, -SH * 0.72, CH * 0.5, SH * 1.44, 2); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-CH * 0.1, SH * 0.28, CH * 0.5, SH * 0.44, 2); ctx.fill();
      ctx.fillStyle = '#E0B44C';
      ctx.beginPath(); ctx.roundRect(CH * 0.3, -SH * 0.34, 3.4, 2.4, 0.8); ctx.fill();
      // collar
      ctx.strokeStyle = '#C9D3DC'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(CH * 0.55, -SH * 0.22); ctx.lineTo(CH * 0.85, 0);
      ctx.lineTo(CH * 0.55, SH * 0.22); ctx.stroke();
    }

    // ---- arms ----
    // Two segments with a visible elbow and hand. Hands go up and slightly
    // forward when they surrender, which is legible from above; the old
    // single curve just splayed sideways and looked broken.
    const up = c.state === 'cower' || c.state === 'scared' || c.handsUp;
    const armSwing = up ? 0 : Math.sin(c.walkPhase) * 2.2;
    ctx.lineCap = 'round';
    [1, -1].forEach(function (side) {
      const shoulderY = side * SH * 0.72;
      const elbowX = up ? CH * 0.15 : CH * 0.35;
      const elbowY = side * (up ? SH * 0.95 : SH * 0.85) + armSwing * side;
      const handX  = up ? CH * 0.95 : CH * 0.55;
      const handY  = side * (up ? SH * 0.62 : SH * 0.78) + armSwing * side;

      ctx.strokeStyle = c.outfit;          // sleeve
      ctx.lineWidth = 5.4;
      ctx.beginPath();
      ctx.moveTo(-1, shoulderY);
      ctx.lineTo(elbowX, elbowY);
      ctx.stroke();

      ctx.strokeStyle = c.skin;            // forearm
      ctx.lineWidth = 4.6;
      ctx.beginPath();
      ctx.moveTo(elbowX, elbowY);
      ctx.lineTo(handX, handY);
      ctx.stroke();

      ctx.fillStyle = c.skin;              // hand
      ctx.beginPath();
      ctx.arc(handX, handY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.lineCap = 'butt';

    // head
    ctx.fillStyle = c.skin;
    ctx.strokeStyle = shade(c.skin, -0.4); ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(CH * 0.5, 0, c.r * 0.46, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // a suggestion of hair so they are not featureless
    ctx.fillStyle = shade(c.skin, -0.5);
    ctx.beginPath();
    ctx.arc(CH * 0.5 - 1.4, 0, c.r * 0.44, Math.PI * 0.45, Math.PI * 1.55);
    ctx.closePath(); ctx.fill();

    if (c.hitFlash > 0) {
      ctx.fillStyle = 'rgba(255,110,80,0.45)';
      ctx.beginPath(); ctx.arc(0, 0, c.r + 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // status above the head, upright
    if ((c.state === 'cower' || c.handsUp) && !c.robbed) {
      ctx.font = '700 9px Oswald, Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(159,176,191,0.85)';
      ctx.fillText('HANDS UP', c.x, c.y - c.r - 12);
      ctx.textAlign = 'left';
    } else if (c.panic > 0 || c.robbed) {
      ctx.font = '700 11px Oswald, Impact, sans-serif';
      ctx.textAlign = 'center';
      if (c.robbed) { ctx.fillStyle = 'rgba(107,124,139,0.9)'; ctx.fillText('EMPTY', c.x, c.y - c.r - 12); }
      else { ctx.fillStyle = 'rgba(224,180,76,0.95)'; ctx.fillText('!', c.x, c.y - c.r - 12); }
      ctx.textAlign = 'left';
    }
    // prompt when you can take their wallet
    if (!c.robbed && c.wallet > 0 && H.robo && dist(H.robo, c) < 54) {
      ctx.font = '700 9px Oswald, Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(95,191,135,0.95)';
      ctx.fillText('E  TAKE WALLET', c.x, c.y - c.r - 24);
      if (c.robProg > 0) {
        ctx.strokeStyle = '#5FBF87'; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(c.robProg / 700, 0, 1));
        ctx.stroke();
      }
      ctx.textAlign = 'left';
    }
  }

  // ==================== NAVIGATION ====================
  // Straight-line steering walks agents into walls and parks them in
  // corners. Everything that moves now paths on a coarse grid instead:
  // A* to get around geometry, string-pulling to keep the result looking
  // like a person walking rather than a chess piece.
  //
  // The hot paths are written for cost, not elegance: line-of-walk tests
  // read the grid instead of scanning every obstacle, A* reuses one set
  // of scratch buffers, and string-pulling only looks a short way ahead.

  const NAV_CELL = 26;

  function buildNav(world) {
    const cols = Math.ceil(world.w / NAV_CELL);
    const rows = Math.ceil(world.h / NAV_CELL);
    const blockedCells = new Uint8Array(cols * rows);

    // Inflate obstacles by roughly one body radius so agents route with
    // clearance instead of scraping (and catching on) every corner.
    // Anything that stops a body has to stop a path. Walls get a full
    // body-radius of clearance; low furniture gets less, so the gaps
    // between counters stay wide enough to walk through.
    const PAD_WALL = 15, PAD_LOW = 8;
    for (const o of world.obstacles) {
      if (o.kind === 'vaultdoor' && !o.solid) continue;
      const PAD = o.low ? PAD_LOW : PAD_WALL;
      const x0 = Math.max(0, Math.floor((o.x - PAD) / NAV_CELL));
      const y0 = Math.max(0, Math.floor((o.y - PAD) / NAV_CELL));
      const x1 = Math.min(cols - 1, Math.floor((o.x + o.w + PAD) / NAV_CELL));
      const y1 = Math.min(rows - 1, Math.floor((o.y + o.h + PAD) / NAV_CELL));
      for (let cy = y0; cy <= y1; cy++)
        for (let cx = x0; cx <= x1; cx++) blockedCells[cy * cols + cx] = 1;
    }

    // Cells next to something solid cost a little more, so agents drift
    // toward the middle of a doorway instead of scraping the frame.
    const cost = new Float32Array(cols * rows).fill(1);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx;
        if (blockedCells[i]) continue;
        let near = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) { near++; continue; }
            if (blockedCells[ny * cols + nx]) near++;
          }
        if (near) cost[i] = 1 + near * 0.25;
      }
    }

    world.nav = { cols, rows, blocked: blockedCells, cost };
    world.navDirty = false;
    navScratch = null;              // grid changed: drop the A* buffers
  }

  const cellOf = (v) => Math.floor(v / NAV_CELL);
  const cellCentre = (c) => c * NAV_CELL + NAV_CELL / 2;

  function navFree(nav, cx, cy) {
    if (cx < 0 || cy < 0 || cx >= nav.cols || cy >= nav.rows) return false;
    return !nav.blocked[cy * nav.cols + cx];
  }

  // O(1) walkability test at a world position — used instead of scanning
  // the obstacle list, which was the single most expensive thing here.
  function navBlockedAt(nav, x, y) {
    const cx = (x / NAV_CELL) | 0, cy = (y / NAV_CELL) | 0;
    if (cx < 0 || cy < 0 || cx >= nav.cols || cy >= nav.rows) return true;
    return !!nav.blocked[cy * nav.cols + cx];
  }

  function nearestFree(nav, cx, cy) {
    if (navFree(nav, cx, cy)) return [cx, cy];
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (navFree(nav, cx + dx, cy + dy)) return [cx + dx, cy + dy];
        }
      }
    }
    return null;
  }

  // Minimal binary heap — the open set gets hot with a dozen agents.
  function Heap() { this.a = []; }
  Heap.prototype.push = function (node) {
    const a = this.a; a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      const t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  };
  Heap.prototype.pop = function () {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        const t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top;
  };

  const DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
  ];

  // One set of scratch buffers for every A* call. A generation stamp
  // replaces clearing them, so a search costs no allocation at all.
  let navScratch = null;
  function scratchFor(n) {
    if (!navScratch || navScratch.n !== n) {
      navScratch = {
        n, gen: 0,
        came: new Int32Array(n),
        g: new Float32Array(n),
        seen: new Int32Array(n),
        closed: new Int32Array(n),
      };
    }
    navScratch.gen++;
    return navScratch;
  }

  function aStar(nav, sx, sy, tx, ty) {
    const start = nearestFree(nav, cellOf(sx), cellOf(sy));
    const goal  = nearestFree(nav, cellOf(tx), cellOf(ty));
    if (!start || !goal) return null;
    const s0 = start[0], s1 = start[1], g0 = goal[0], g1 = goal[1];
    if (s0 === g0 && s1 === g1) return [];

    const cols = nav.cols;
    const B = scratchFor(cols * nav.rows);
    const gen = B.gen;
    const startI = s1 * cols + s0, goalI = g1 * cols + g0;

    B.g[startI] = 0;
    B.seen[startI] = gen;
    B.came[startI] = -1;

    const open = new Heap();
    open.push({ i: startI, cx: s0, cy: s1, f: 0 });

    let expanded = 0;
    // Long cross-map routes on the biggest banks legitimately expand a
    // few thousand cells. Too low a cap made those searches fail outright
    // and the agent fell back to walking into a wall.
    const LIMIT = 7000;
    let reached = false;
    // Track the closest node reached, so a search that runs out of budget
    // still returns a partial route in roughly the right direction.
    let bestI = startI, bestH = Infinity;

    while (open.a.length) {
      const cur = open.pop();
      if (B.closed[cur.i] === gen) continue;
      B.closed[cur.i] = gen;
      if (cur.i === goalI) { reached = true; break; }
      const chx = Math.abs(cur.cx - g0), chy = Math.abs(cur.cy - g1);
      const ch = (chx + chy) - 0.586 * Math.min(chx, chy);
      if (ch < bestH) { bestH = ch; bestI = cur.i; }
      if (++expanded > LIMIT) break;

      for (let k = 0; k < 8; k++) {
        const dx = DIRS[k][0], dy = DIRS[k][1], w = DIRS[k][2];
        const nx = cur.cx + dx, ny = cur.cy + dy;
        if (!navFree(nav, nx, ny)) continue;
        if (dx && dy && (!navFree(nav, cur.cx + dx, cur.cy) || !navFree(nav, cur.cx, cur.cy + dy))) continue;
        const ni = ny * cols + nx;
        if (B.closed[ni] === gen) continue;
        const g = B.g[cur.i] + w * nav.cost[ni];
        if (B.seen[ni] === gen && g >= B.g[ni]) continue;
        B.seen[ni] = gen;
        B.g[ni] = g;
        B.came[ni] = cur.i;
        const hx = Math.abs(nx - g0), hy = Math.abs(ny - g1);
        open.push({ i: ni, cx: nx, cy: ny, f: g + (hx + hy) - 0.586 * Math.min(hx, hy) });
      }
    }

    // Prefer the real goal; otherwise hand back the best partial route.
    let endI = goalI;
    if (!reached && B.seen[goalI] !== gen) {
      if (bestI === startI) return null;
      endI = bestI;
    }

    const out = [];
    let i = endI;
    let guard = 0;
    while (i !== -1 && i !== startI && guard++ < 4000) {
      out.push({ x: cellCentre(i % cols), y: cellCentre((i / cols) | 0) });
      i = B.came[i];
    }
    out.reverse();
    return out;
  }

  // Can an agent walk straight from A to B? Grid lookups only.
  function clearLine(x1, y1, x2, y2) {
    const nav = H.world.nav;
    const dx = x2 - x1, dy = y2 - y1;
    const d = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(d / (NAV_CELL * 0.75)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (navBlockedAt(nav, x1 + dx * t, y1 + dy * t)) return false;
    }
    return true;
  }

  // String-pulling with a bounded lookahead: enough to turn a staircase
  // into a diagonal, cheap enough to run for a whole crowd.
  const SMOOTH_LOOKAHEAD = 8;
  function smoothPath(a, path) {
    if (!path || path.length < 2) return path || [];
    const out = [];
    let fx = a.x, fy = a.y;
    let i = 0;
    while (i < path.length) {
      let best = i;
      const last = Math.min(path.length - 1, i + SMOOTH_LOOKAHEAD);
      for (let j = last; j > i; j--) {
        if (clearLine(fx, fy, path[j].x, path[j].y)) { best = j; break; }
      }
      out.push(path[best]);
      fx = path[best].x; fy = path[best].y;
      i = best + 1;
    }
    return out;
  }

  // Repathing is capped per frame so a crowd cannot spike the frame time.
  let pathBudget = 0;

  function requestPath(a, tx, ty, force) {
    const moved = a.pathGoal ? Math.hypot(a.pathGoal.x - tx, a.pathGoal.y - ty) : 1e9;
    const stale = H.t - (a.pathAt || -1e9) > 1100;
    if (!force && !stale && moved < 80 && a.path && a.pathIdx < a.path.length) return;
    if (pathBudget <= 0) return;
    pathBudget--;
    a.pathAt = H.t;
    a.pathGoal = { x: tx, y: ty };
    const raw = aStar(H.world.nav, a.x, a.y, tx, ty);
    a.path = raw ? smoothPath(a, raw) : null;
    a.pathIdx = 0;
    // if we found nothing at all, try again soon rather than idling
    if (!a.path || !a.path.length) a.pathAt = H.t - 800;
  }

  function followPath(a, speed, dt) {
    if (!a.path || a.pathIdx >= a.path.length) return false;
    let wp = a.path[a.pathIdx];
    while (wp && Math.hypot(wp.x - a.x, wp.y - a.y) < 16) {
      a.pathIdx++;
      wp = a.path[a.pathIdx];
    }
    if (!wp) return false;
    const ang = Math.atan2(wp.y - a.y, wp.x - a.x);
    moveActor(a, Math.cos(ang) * speed, Math.sin(ang) * speed, dt);
    return true;
  }

  // Move toward a point: straight line when the way is clear, path when
  // it is not. Includes a stuck-detector that forces a fresh path and a
  // sidestep, so nobody stands grinding against a desk forever.
  function navigateTo(a, tx, ty, speed, dt) {
    const dx = tx - a.x, dy = ty - a.y;
    const far = Math.hypot(dx, dy);
    if (far < 4) return;

    const bx = a.x, by = a.y;
    // the straight-line test is cheap now, but still only worth it close in
    const direct = far < 300 && clearLine(a.x, a.y, tx, ty);

    if (direct) {
      a.path = null;
      const ang = Math.atan2(dy, dx);
      moveActor(a, Math.cos(ang) * speed, Math.sin(ang) * speed, dt);
    } else {
      requestPath(a, tx, ty, false);
      if (!followPath(a, speed, dt)) {
        const ang = Math.atan2(dy, dx);
        moveActor(a, Math.cos(ang) * speed, Math.sin(ang) * speed, dt);
      }
    }

    // ---- stuck detection ----
    // Per-frame movement is a bad signal: an agent vibrating against a
    // desk moves a pixel every frame and looks busy. Track NET progress
    // over a window instead.
    a.stuckT = (a.stuckT || 0) + dt;
    if (!a.stuckFrom) a.stuckFrom = { x: bx, y: by };
    if (a.stuckT > 420) {
      const net = Math.hypot(a.x - a.stuckFrom.x, a.y - a.stuckFrom.y);
      if (net < 12) {
        // genuinely pinned: force a new route and shove sideways past it
        requestPath(a, tx, ty, true);
        const side = (a.stuckSide = -(a.stuckSide || 1));
        const ang = Math.atan2(dy, dx) + side * 1.5;
        moveActor(a, Math.cos(ang) * speed * 1.4, Math.sin(ang) * speed * 1.4, dt);
      }
      a.stuckT = 0;
      a.stuckFrom = { x: a.x, y: a.y };
    }
  }

  // If an agent ends up inside geometry — spawned there, shoved there by
  // separation, or left behind when a wall was rebuilt — normal movement
  // can never free them, because every candidate step is blocked too.
  // Slide them out toward open floor, ignoring collision for that nudge.
  function unembed(a, dt) {
    const nav = H.world.nav;
    // Physically inside a prop: always needs the escape hatch.
    const solid = blocked(a.x, a.y, a.r);
    // Standing in a cell the grid calls unwalkable is NOT the same thing.
    // Cells are coarse, so the free half of a cell next to a parked car
    // reads as blocked. Yanking those agents fought their own movement and
    // pinned them in place, so only do it as a last resort once they have
    // genuinely stopped making progress.
    const gridTrapped = !solid && navBlockedAt(nav, a.x, a.y) && (a.stuckT || 0) > 700;
    if (!solid && !gridTrapped) return false;
    const cell = nearestFree(nav, cellOf(a.x), cellOf(a.y));
    if (!cell) return false;
    const tx = cellCentre(cell[0]), ty = cellCentre(cell[1]);
    const d = Math.hypot(tx - a.x, ty - a.y) || 1;
    const push = 3.2 * (dt / 16.67);
    a.x += (tx - a.x) / d * push;
    a.y += (ty - a.y) / d * push;
    a.path = null;
    return true;
  }

  // Keep agents from stacking on the exact same pixel.
  function separate(a, others, radius, push, dt) {
    let sx = 0, sy = 0, n = 0;
    const r2 = radius * radius;
    for (let i = 0; i < others.length; i++) {
      const o = others[i];
      if (o === a || o.dead || o.downed) continue;
      const dx = a.x - o.x, dy = a.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2 || d2 < 0.0001) continue;
      const d = Math.sqrt(d2);
      sx += dx / d * (1 - d / radius);
      sy += dy / d * (1 - d / radius);
      n++;
    }
    if (!n) return;
    moveActor(a, sx * push, sy * push, dt);
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
          banner('ON YOUR FEET', 'That was the only free one.');
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

    // ---- holds: robbing someone, or working an ATM ----
    const holding = keys['e'] || (touch.active && touch.interact);
    if (holding) tryRobCivilian(p, dt);
    else if (p.robbing) { p.robbing.robProg = 0; p.robbing = null; }

    if (holding && p.atm && !p.atm.open && Math.hypot(p.x - p.atm.x, p.y - p.atm.y) < 60) {
      const a = p.atm;
      a.prog += dt;
      a.shake = 4;
      if (Math.random() < 0.10) sfx.drill();
      if (a.prog >= LO.atmDrill) openATM(a, p);
    } else if (p.atm) {
      p.atm.prog = Math.max(0, p.atm.prog - dt * 2);   // slips back if you walk off
      if (!holding) p.atm = null;
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

      // ATMs can be shot open, loudly
      if (!hit) {
        for (const a of H.world.atms) {
          if (a.open) continue;
          if (Math.hypot(b.x - a.x, b.y - a.y) > a.r) continue;
          a.hp -= b.dmg; a.shake = 8;
          sfx.ricochet();
          if (a.hp <= 0) { openATM(a, b.owner); if (!H.alarm) trip('gun'); }
          hit = true; break;
        }
      }

      // registers are breakable props
      if (!hit) {
        for (const t of H.world.registers) {
          if (t.open) continue;
          if (Math.hypot(b.x - t.x, b.y - t.y) > t.r) continue;
          t.hp -= b.dmg; t.shake = 8;
          sfx.ricochet();
          if (t.hp <= 0) openRegister(t, true);
          hit = true; break;
        }
      }

      // civilians are in the line of fire like anyone else
      if (!hit) {
        for (const c of H.civilians) {
          if (c.dead) continue;
          if (dist(b, c) > c.r) continue;
          c.hp -= b.dmg; c.hitFlash = 10;
          scare(c, 'shot');
          panicAll(c.x, c.y, 320, 'seen');
          sfx.hit(false);
          if (c.hp <= 0) {
            c.dead = true;
            H.civKills++;
            H.bodies.push({ x: c.x, y: c.y, seen: false });
            if (!H.alarm) trip('civilian');
            floatText(c.x, c.y - 24, 'CIVILIAN KILLED', '#C4453A');
            banner('BYSTANDER DOWN', 'The crew will not forget that.');
          }
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
        banner('POLICE ARE HERE', 'They have the street. The car is covered.');
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
          banner('BREACH', 'SWAT is coming through the front door.');
          spawnCopWave(4, true);
        }
      }
    }

    // extraction: RoboKyle at the car
    const atCar = dist(H.robo, H.world.car) < H.world.car.r;
    H.canExtract = atCar && !H.robo.downed;
    const wantsExtract = keys['e'] || (touch.active && touch.interact);
    if (H.canExtract && wantsExtract && !H.extractPhase) {
      H.extractPhase = true;
      H.extractAt = H.t;
      banner('EVERYONE TO THE CAR', 'Press E again to go without them.');
    }

    // finish() tears down mission state, so nothing may touch H after it.
    if (H.extractPhase && atCar) {
      const stragglers = H.crew.filter(c => !c.dead && !c.downed && dist(c, H.world.car) > 80);
      H.stragglers = stragglers.length;
      if (stragglers.length === 0) { finish(true); return; }

      // You are never trapped waiting on someone who cannot get here.
      // After a moment, pressing E again offers to drive off without them.
      if (wantsExtract && H.t - H.extractAt > 1400 && !H.leavePrompt) {
        H.leavePrompt = true;
        H.paused = true;
        const names = stragglers.map(c => c.name).join(' and ');
        GH.confirm({
          title: 'Leave without ' + (stragglers.length > 1 ? 'them?' : names + '?'),
          body: stragglers.length > 1
            ? names + ' are not at the car. Drive off now and they do not come back.'
            : names + ' is not at the car. Drive off now and they do not come back.',
          yes: 'Drive off', no: 'Wait for them', danger: true,
        }).then((leave) => {
          H.leavePrompt = false;
          if (!H) return;
          if (leave) {
            stragglers.forEach(c => {
              c.dead = true;
              if (H.killedIds.indexOf(c.char.id) < 0) H.killedIds.push(c.char.id);
            });
            H.paused = false;
            finish(true);
          } else {
            H.extractAt = H.t;          // reset, so a stray E does not re-ask
            H.paused = false;
            H.last = performance.now();
            requestAnimationFrame(loop);
          }
        });
        return;
      }
    } else {
      H.stragglers = 0;
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

    // hand back everyone's remaining health so wounds persist
    const hpOut = {};
    H.all.forEach(a => {
      if (!a.char) return;
      const key = a.isRobo ? 'robo' : a.char.id;
      hpOut[key] = a.dead ? 1 : Math.max(1, Math.round(a.hp));
    });

    GH.debrief({
      escaped,
      haul: escaped ? haul : uncollected,
      killed: H.killedIds.slice(),
      perChar,
      bankId: H.bank.id,
      civilians: H.civKills,
      hp: hpOut,
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

    if (H.world.navDirty) buildNav(H.world);
    pathBudget = 8;               // cap A* calls per frame (perf headroom measured at ~4x)

    stepRobo(dt);
    if (!H) return;
    H.crew.forEach(c => stepCrew(c, dt));
    H.enemies.forEach(e => stepEnemy(e, dt));
    H.civilians.forEach(c => stepCivilian(c, dt));
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
    H.world.registers.forEach(t => { if (t.shake > 0) t.shake -= dt * 0.05; });
    H.world.atms.forEach(a => { if (a.shake > 0) a.shake -= dt * 0.05; });
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
    ctx.fillStyle = '#0E1218';
    ctx.fillRect(0, 0, w.w, w.h);

    // street asphalt with kerb, lane markings and a wet sheen
    ctx.fillStyle = '#15191F';
    ctx.fillRect(w.street.x, w.street.y, w.street.w, w.street.h);
    ctx.fillStyle = '#232A33';
    ctx.fillRect(w.street.x, w.street.y, w.street.w, 7);          // kerb
    ctx.fillStyle = '#1A2027';
    ctx.fillRect(w.street.x, w.street.y + 7, w.street.w, 3);
    ctx.strokeStyle = '#3A424C'; ctx.lineWidth = 3;
    ctx.setLineDash([30, 26]);
    ctx.beginPath();
    ctx.moveTo(0, w.street.y + w.street.h * 0.56);
    ctx.lineTo(w.w, w.street.y + w.street.h * 0.56);
    ctx.stroke();
    ctx.setLineDash([]);
    // drain covers + puddles
    ctx.fillStyle = 'rgba(120,150,180,0.05)';
    for (let i = 0; i < 5; i++) {
      const px = (i * 421 % w.w);
      ctx.beginPath();
      ctx.ellipse(px, w.street.y + w.street.h * 0.8, 60, 16, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- building floor: marble slabs with veining ----
    const B = w.building;
    ctx.fillStyle = '#232A33';
    ctx.fillRect(B.x, B.y, B.w, B.h);
    // slab grid
    const TILE = 72;
    ctx.strokeStyle = 'rgba(0,0,0,0.30)'; ctx.lineWidth = 1;
    for (let x = B.x; x <= B.x + B.w; x += TILE) {
      ctx.beginPath(); ctx.moveTo(x, B.y); ctx.lineTo(x, B.y + B.h); ctx.stroke();
    }
    for (let y = B.y; y <= B.y + B.h; y += TILE) {
      ctx.beginPath(); ctx.moveTo(B.x, y); ctx.lineTo(B.x + B.w, y); ctx.stroke();
    }
    // alternating slab tint so the floor is not one flat colour
    ctx.fillStyle = 'rgba(255,255,255,0.018)';
    for (let iy = 0, y = B.y; y < B.y + B.h; y += TILE, iy++) {
      for (let ix = 0, x = B.x; x < B.x + B.w; x += TILE, ix++) {
        if ((ix + iy) % 2) continue;
        ctx.fillRect(x, y, Math.min(TILE, B.x + B.w - x), Math.min(TILE, B.y + B.h - y));
      }
    }
    // marble veins (deterministic, so they do not crawl between frames)
    ctx.strokeStyle = 'rgba(190,210,230,0.05)'; ctx.lineWidth = 1.4;
    for (let i = 0; i < 26; i++) {
      const vx = B.x + ((i * 977) % B.w);
      const vy = B.y + ((i * 613) % B.h);
      ctx.beginPath();
      ctx.moveTo(vx, vy);
      ctx.quadraticCurveTo(vx + 40, vy + 26, vx + 92, vy + 8);
      ctx.stroke();
    }
    // lobby runner carpet in front of the counter
    ctx.fillStyle = 'rgba(122,32,28,0.16)';
    ctx.fillRect(B.x + B.w * 0.22, w.counterY + 34, B.w * 0.56, 96);
    ctx.strokeStyle = 'rgba(224,180,76,0.14)'; ctx.lineWidth = 2;
    ctx.strokeRect(B.x + B.w * 0.22, w.counterY + 34, B.w * 0.56, 96);

    // pools of ceiling light
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let lx = B.x + 120; lx < B.x + B.w; lx += 260) {
      for (let ly = B.y + 110; ly < B.y + B.h; ly += 240) {
        const g = ctx.createRadialGradient(lx, ly, 6, lx, ly, 150);
        g.addColorStop(0, 'rgba(190,215,240,0.055)');
        g.addColorStop(1, 'rgba(190,215,240,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(lx, ly, 150, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();

    // ---- vault rooms ----
    w.vaults.forEach(v => {
      if (v.open) {
        // opened: warm gold light spilling out of the strongroom
        ctx.fillStyle = '#2A2415';
        ctx.fillRect(v.x, v.y, v.w, v.h);
        const g = ctx.createRadialGradient(v.x + v.w / 2, v.y + v.h / 2, 8,
                                           v.x + v.w / 2, v.y + v.h / 2, v.w * 0.7);
        g.addColorStop(0, 'rgba(224,180,76,0.22)');
        g.addColorStop(1, 'rgba(224,180,76,0)');
        ctx.fillStyle = g;
        ctx.fillRect(v.x, v.y, v.w, v.h);
      } else {
        // sealed: you can SEE there is a room, but not what is in it.
        // Frosted, not blacked out — the mystery is the point.
        ctx.fillStyle = '#1A2028';
        ctx.fillRect(v.x, v.y, v.w, v.h);
        // suggestion of shelving behind the frost
        ctx.save();
        ctx.beginPath(); ctx.rect(v.x, v.y, v.w, v.h); ctx.clip();
        ctx.globalAlpha = 0.30;
        ctx.fillStyle = '#3E4A57';
        for (let sx = v.x + 22; sx < v.x + v.w - 16; sx += 40) {
          ctx.fillRect(sx, v.y + 30, 24, v.h - 62);
        }
        ctx.fillStyle = '#5A6A34';
        for (let sx = v.x + 26; sx < v.x + v.w - 16; sx += 40) {
          for (let sy = v.y + 40; sy < v.y + v.h - 34; sy += 26) {
            ctx.fillRect(sx, sy, 16, 14);
          }
        }
        ctx.globalAlpha = 1;
        // frosted glass pass
        ctx.fillStyle = 'rgba(150,175,200,0.42)';
        ctx.fillRect(v.x, v.y, v.w, v.h);
        ctx.fillStyle = 'rgba(20,26,33,0.42)';
        ctx.fillRect(v.x, v.y, v.w, v.h);
        // frost streaks
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 6;
        for (let i = 0; i < 7; i++) {
          const fy = v.y + (i * 37) % v.h;
          ctx.beginPath(); ctx.moveTo(v.x, fy); ctx.lineTo(v.x + v.w, fy + 12); ctx.stroke();
        }
        ctx.restore();
        // hatched "sealed" border
        ctx.strokeStyle = 'rgba(224,180,76,0.30)'; ctx.lineWidth = 2;
        ctx.setLineDash([9, 7]);
        ctx.strokeRect(v.x + 2, v.y + 2, v.w - 4, v.h - 4);
        ctx.setLineDash([]);
        // label
        ctx.font = '700 12px Oswald, Impact, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(224,180,76,0.55)';
        ctx.fillText('VAULT — SEALED', v.x + v.w / 2, v.y + v.h / 2 + 4);
        ctx.textAlign = 'left';
      }
    });

    // ---- obstacles ----
    for (const o of w.obstacles) {
      if (o.kind === 'vaultdoor' && !o.solid) continue;
      let fill = '#2C333C', top = '#3A434E', edge = '#191E25';
      if (o.kind === 'counter')        { fill = '#4A3521'; top = '#5E442B'; edge = '#2A1D12'; }
      else if (o.kind === 'desk')      { fill = '#3A2E20'; top = '#4B3B29'; edge = '#221A12'; }
      else if (o.kind === 'car')       { fill = '#242B34'; top = '#333C47'; edge = '#141920'; }
      else if (o.kind === 'vaultwall') { fill = '#464F59'; top = '#5A6570'; edge = '#252B32'; }
      else if (o.kind === 'vaultdoor') { fill = '#8A6520'; top = '#C79A3C'; edge = '#4A360F'; }

      // drop shadow so props sit on the floor
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.fillRect(o.x + 3, o.y + 4, o.w, o.h);
      ctx.fillStyle = fill;
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.fillStyle = top;
      ctx.fillRect(o.x, o.y, o.w, Math.min(5, o.h));
      ctx.strokeStyle = edge; ctx.lineWidth = 1;
      ctx.strokeRect(o.x + .5, o.y + .5, o.w - 1, o.h - 1);

      // counters get a wood grain + brass rail
      if (o.kind === 'counter') {
        ctx.strokeStyle = 'rgba(255,220,170,0.07)'; ctx.lineWidth = 1;
        for (let gx2 = o.x + 6; gx2 < o.x + o.w; gx2 += 14) {
          ctx.beginPath(); ctx.moveTo(gx2, o.y + 2); ctx.lineTo(gx2 + 4, o.y + o.h - 2); ctx.stroke();
        }
        ctx.fillStyle = '#C79A3C';
        ctx.fillRect(o.x, o.y - 2, o.w, 2);
      }
      // the vault door reads as a slab of gold-steel with rivets
      if (o.kind === 'vaultdoor') {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        for (let rx = o.x + 8; rx < o.x + o.w - 4; rx += 16) {
          ctx.beginPath(); ctx.arc(rx, o.y + o.h / 2, 1.8, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // ---- cash registers on the counter ----
    for (const t of w.registers) drawRegister(t);
    for (const a of w.atms) drawATM(a);

    // ---- getaway car ----
    drawCar(w.car);

    // ---- loot ----
    for (const l of w.loot) {
      if (l.taken || l.locked) continue;
      drawCash(l.x, l.y, l.kind === 'vault' ? 16 : 11);
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
    for (const c of H.civilians) drawCivilian(c);
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

  // A cash register you can actually break into: closed it is a solid
  // till with a screen and keys; open it is a sprung drawer with notes
  // spilling out. Far more legible than a green square on the floor.
  function drawRegister(t) {
    const shake = t.shake > 0 ? (Math.random() - 0.5) * t.shake * 0.5 : 0;
    ctx.save();
    ctx.translate(t.x + shake, t.y);
    // The till belongs to the teller, so it faces the counter — screen and
    // keys toward the staff side, drawer opening away from the lobby.
    ctx.scale(1, -1);

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(1, 12, 16, 5, 0, 0, Math.PI * 2); ctx.fill();

    // body
    ctx.fillStyle = t.open ? '#3A4149' : '#454E58';
    ctx.beginPath(); ctx.roundRect(-14, -4, 28, 17, 3); ctx.fill();
    ctx.strokeStyle = '#1C2128'; ctx.lineWidth = 1.2; ctx.stroke();
    // upper housing / screen
    ctx.fillStyle = '#2E353D';
    ctx.beginPath(); ctx.roundRect(-11, -15, 22, 12, 3); ctx.fill();
    ctx.strokeStyle = '#171C22'; ctx.stroke();
    ctx.fillStyle = t.open ? '#243027' : '#1B2A34';
    ctx.beginPath(); ctx.roundRect(-8, -13, 16, 7, 1.5); ctx.fill();
    if (!t.open) {
      ctx.fillStyle = 'rgba(120,200,220,0.55)';
      ctx.fillRect(-6.5, -11.5, 9, 1.4);
      ctx.fillRect(-6.5, -9, 6, 1.4);
    }
    // keys
    ctx.fillStyle = '#5C666F';
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 4; c++) {
        ctx.beginPath(); ctx.roundRect(-10 + c * 5.2, -1 + r * 4.4, 3.6, 3, 1); ctx.fill();
      }
    }

    if (t.open) {
      // sprung drawer
      ctx.fillStyle = '#2A3038';
      ctx.beginPath(); ctx.roundRect(-13, 11, 26, 11, 2); ctx.fill();
      ctx.fillStyle = '#1A1F25';
      ctx.beginPath(); ctx.roundRect(-11, 13, 22, 7, 1.5); ctx.fill();
      // note compartments, emptied
      ctx.fillStyle = '#3E4750';
      for (let i = 0; i < 4; i++) ctx.fillRect(-10 + i * 5.4, 14, 4.2, 5);
      ctx.save();
      ctx.scale(1, -1);                     // un-flip so the label reads
      ctx.fillStyle = 'rgba(224,180,76,0.5)';
      ctx.font = '700 8px Oswald, Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('EMPTY', 0, -17);
      ctx.textAlign = 'left';
      ctx.restore();
    } else {
      // drawer front, still shut
      ctx.fillStyle = '#39424B';
      ctx.beginPath(); ctx.roundRect(-13, 8, 26, 5, 1.5); ctx.fill();
      ctx.fillStyle = '#C79A3C';
      ctx.beginPath(); ctx.roundRect(-4, 9.4, 8, 2.2, 1); ctx.fill();
      // damage cracks as it takes hits
      if (t.hp < 45) {
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
        const n = t.hp < 20 ? 4 : 2;
        for (let i = 0; i < n; i++) {
          ctx.beginPath();
          ctx.moveTo(-9 + i * 5, -3);
          ctx.lineTo(-6 + i * 5, 7);
          ctx.stroke();
        }
      }
      // prompt when you are close enough to pry it
      if (H.robo && Math.hypot(H.robo.x - t.x, H.robo.y - t.y) < 52) {
        ctx.save();
        ctx.scale(1, -1);                   // un-flip so the prompt reads
        ctx.fillStyle = 'rgba(224,180,76,0.95)';
        ctx.font = '700 9px Oswald, Impact, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('E  PRY OPEN', 0, 26);
        ctx.textAlign = 'left';
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawATM(a) {
    const shake = a.shake > 0 ? (Math.random() - 0.5) * a.shake * 0.5 : 0;
    ctx.save();
    ctx.translate(a.x + shake, a.y);
    ctx.rotate(a.facing);

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(2, 14, 20, 6, 0, 0, Math.PI * 2); ctx.fill();

    // cabinet set into the wall
    ctx.fillStyle = a.open ? '#2B333C' : '#39424D';
    ctx.beginPath(); ctx.roundRect(-16, -18, 30, 36, 4); ctx.fill();
    ctx.strokeStyle = '#161B21'; ctx.lineWidth = 1.4; ctx.stroke();
    // fascia
    ctx.fillStyle = a.open ? '#1B2128' : '#20272F';
    ctx.beginPath(); ctx.roundRect(-4, -14, 17, 28, 3); ctx.fill();
    // screen
    ctx.fillStyle = a.open ? '#241B14' : '#16303A';
    ctx.beginPath(); ctx.roundRect(-1, -11, 12, 10, 1.6); ctx.fill();
    if (!a.open) {
      ctx.fillStyle = 'rgba(120,200,220,0.5)';
      ctx.fillRect(0.5, -9.5, 8, 1.2);
      ctx.fillRect(0.5, -7, 5, 1.2);
    }
    // keypad + dispenser slot
    ctx.fillStyle = '#4E5762';
    for (let r2 = 0; r2 < 2; r2++)
      for (let c2 = 0; c2 < 3; c2++)
        { ctx.beginPath(); ctx.roundRect(0.5 + c2 * 4, 1 + r2 * 4, 3, 3, 1); ctx.fill(); }
    ctx.fillStyle = a.open ? '#0D1013' : '#E0B44C';
    ctx.beginPath(); ctx.roundRect(0, 10, 12, 2.6, 1.2); ctx.fill();

    if (a.open) {
      ctx.save(); ctx.rotate(-a.facing);
      ctx.fillStyle = 'rgba(224,180,76,0.5)';
      ctx.font = '700 8px Oswald, Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('EMPTIED', 0, -24);
      ctx.textAlign = 'left';
      ctx.restore();
    } else if (H.robo && dist(H.robo, a) < 56) {
      ctx.save(); ctx.rotate(-a.facing);
      ctx.fillStyle = 'rgba(95,191,135,0.95)';
      ctx.font = '700 9px Oswald, Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('E  CRACK ATM', 0, -26);
      ctx.textAlign = 'left';
      if (a.prog > 0) {
        ctx.strokeStyle = '#5FBF87'; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(a.prog / LO.atmDrill, 0, 1));
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function drawCash(x, y, r) {
    ctx.save();
    ctx.translate(x, y);
    const bob = Math.sin(H.t / 320 + x * 0.05) * 1.4;
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.beginPath(); ctx.ellipse(0, r * 0.55, r * 0.95, r * 0.38, 0, 0, Math.PI * 2); ctx.fill();
    ctx.translate(0, bob);

    // a stack of banded bundles rather than one flat rectangle
    for (let i = 2; i >= 0; i--) {
      const off = i * 2.2;
      ctx.fillStyle = i === 0 ? '#7FB07A' : '#5E8A5C';
      ctx.beginPath(); ctx.roundRect(-r + i * 0.8, -r * 0.5 - off, r * 2 - i * 1.6, r * 0.9, 2); ctx.fill();
      ctx.strokeStyle = '#33512F'; ctx.lineWidth = .8;
      ctx.strokeRect(-r + i * 0.8, -r * 0.5 - off, r * 2 - i * 1.6, r * 0.9);
      // paper band
      ctx.fillStyle = '#D9C98B';
      ctx.fillRect(-r * 0.28, -r * 0.5 - off, r * 0.56, r * 0.9);
    }
    // faint sparkle so it reads as pickup-able
    const tw = (Math.sin(H.t / 240 + x) + 1) * 0.5;
    ctx.globalAlpha = 0.25 + tw * 0.35;
    ctx.fillStyle = '#FFF3C4';
    ctx.beginPath(); ctx.arc(r * 0.55, -r * 0.75, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawBag(x, y) {
    ctx.save();
    ctx.translate(x, y);
    const bob = Math.sin(H.t / 260 + x * 0.04) * 1.8;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.ellipse(0, 13, 17, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.translate(0, bob);
    ctx.fillStyle = '#3E362E';
    ctx.beginPath(); ctx.roundRect(-16, -10, 32, 23, 6); ctx.fill();
    ctx.strokeStyle = '#241F1A'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = '#4C433A';
    ctx.beginPath(); ctx.roundRect(-16, -10, 32, 7, 4); ctx.fill();
    ctx.strokeStyle = '#C79A3C'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -10, 8, Math.PI, 0); ctx.stroke();
    // notes poking out of the top
    ctx.fillStyle = '#7FB07A';
    ctx.beginPath(); ctx.roundRect(-7, -13, 5, 5, 1); ctx.fill();
    ctx.beginPath(); ctx.roundRect(2, -12, 5, 4, 1); ctx.fill();
    ctx.fillStyle = '#5FBF87';
    ctx.font = '700 11px Oswald, Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('$', 0, 7);
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

    if (w.kind === 'melee') {
      // Melee thrusts STRAIGHT FORWARD and pulls back — a stab, not a
      // pinwheel. t runs 1 -> 0 across the swing; sin gives out-and-back.
      const t = c.swing > 0 ? c.swing / 160 : 0;
      if (c.swing > 0) c.swing -= 9;
      const reach = c.weapon === 'bat' ? 17 : 14;
      const lunge = Math.sin((1 - t) * Math.PI) * reach;
      // a slight rise as it drives in reads as weight behind the thrust
      const rise = Math.sin((1 - t) * Math.PI) * (c.weapon === 'bat' ? -2.2 : -1.1);

      ctx.save();
      ctx.translate(gx + lunge, gy + rise);

      if (c.weapon === 'bat') {
        // grip
        ctx.fillStyle = '#2A2018';
        ctx.beginPath(); ctx.roundRect(-2, -2, 11, 4, 2); ctx.fill();
        // taper into the barrel
        ctx.fillStyle = '#B07C43';
        ctx.beginPath();
        ctx.moveTo(9, -2.1); ctx.lineTo(24, -4.4);
        ctx.quadraticCurveTo(31, -4.6, 31, 0);
        ctx.quadraticCurveTo(31, 4.6, 24, 4.4);
        ctx.lineTo(9, 2.1); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,235,200,0.28)';
        ctx.beginPath(); ctx.roundRect(12, -2.6, 16, 1.5, .8); ctx.fill();
        ctx.strokeStyle = '#6E4A24'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(9, -2.1); ctx.lineTo(24, -4.4); ctx.stroke();
      } else {
        // ---- knife: pommel, grip, guard, tapered blade with a fuller ----
        ctx.fillStyle = '#1D2026';
        ctx.beginPath(); ctx.arc(-1.5, 0, 2.2, 0, Math.PI * 2); ctx.fill();   // pommel
        ctx.fillStyle = '#2E333B';
        ctx.beginPath(); ctx.roundRect(-1, -1.9, 8, 3.8, 1.6); ctx.fill();    // grip
        ctx.strokeStyle = '#151920'; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(1.5, -1.9); ctx.lineTo(1.5, 1.9);
        ctx.moveTo(3.5, -1.9); ctx.lineTo(3.5, 1.9); ctx.stroke();
        ctx.fillStyle = '#8E96A3';                                            // guard
        ctx.beginPath(); ctx.roundRect(6.6, -4, 2.2, 8, 1); ctx.fill();
        // blade
        ctx.fillStyle = '#D6DCE6';
        ctx.beginPath();
        ctx.moveTo(8.8, -2.9);
        ctx.lineTo(19, -2.2);
        ctx.lineTo(24, 0);          // point
        ctx.lineTo(19, 2.4);
        ctx.lineTo(8.8, 2.9);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#FAFCFF';                                            // edge highlight
        ctx.beginPath();
        ctx.moveTo(9, -2.5); ctx.lineTo(19, -1.8); ctx.lineTo(23.4, 0);
        ctx.lineTo(19, -0.5); ctx.lineTo(9, -1.1); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#8C96A6'; ctx.lineWidth = 0.7;                     // fuller
        ctx.beginPath(); ctx.moveTo(10.5, 0.5); ctx.lineTo(19, 0.7); ctx.stroke();
      }

      // a short arc of motion behind the tip while thrusting
      if (t > 0) {
        ctx.globalAlpha = t * 0.35;
        ctx.strokeStyle = '#DCE6F2'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(6, -3.5); ctx.lineTo(-4 - reach * 0.5, -3.5);
        ctx.moveTo(6, 3.5); ctx.lineTo(-4 - reach * 0.5, 3.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      return;
    }

    // ---------- firearms ----------
    ctx.save();
    ctx.translate(gx - kick, gy);
    const kind = w.kind;
    const L = kind === 'pistol' ? 15 : kind === 'shotgun' ? 27 : kind === 'smg' ? 21
            : kind === 'rifle' ? 29 : kind === 'lmg' ? 35 : kind === 'explosive' ? 39 : 27;

    // body
    ctx.fillStyle = '#1B1F26';
    ctx.beginPath(); ctx.roundRect(-3, -3.2, L + 3, 6.4, 2); ctx.fill();
    // top rail highlight
    ctx.fillStyle = '#39414D';
    ctx.beginPath(); ctx.roundRect(-2, -3.2, L * 0.55, 2.2, 1); ctx.fill();
    // grip under the receiver
    ctx.fillStyle = '#22272F';
    ctx.beginPath(); ctx.roundRect(-1, 2.4, 5, 6, 1.6); ctx.fill();
    // magazine
    if (kind !== 'pistol' && kind !== 'explosive') {
      ctx.fillStyle = '#2A303A';
      ctx.beginPath(); ctx.roundRect(L * 0.34, 2.6, 4.6, kind === 'lmg' ? 4 : 7, 1.4); ctx.fill();
    }
    if (kind === 'lmg') { ctx.fillStyle = '#2E333C'; ctx.beginPath(); ctx.roundRect(L * 0.28, 2.6, 13, 8, 2); ctx.fill(); }
    if (kind === 'shotgun') { ctx.fillStyle = '#4A3524'; ctx.beginPath(); ctx.roundRect(-3, -2.6, 7, 5.2, 1.6); ctx.fill(); }
    if (kind === 'explosive') {
      ctx.fillStyle = '#4A2A20';
      ctx.beginPath(); ctx.ellipse(L + 2, 0, 6.5, 4.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6B3A2A';
      ctx.beginPath(); ctx.moveTo(L - 3, -4); ctx.lineTo(L - 7, -6.5); ctx.lineTo(L - 7, 6.5); ctx.lineTo(L - 3, 4); ctx.fill();
    }
    if (kind === 'energy' || kind === 'exotic') {
      ctx.fillStyle = w.color;
      ctx.globalAlpha = 0.75;
      ctx.beginPath(); ctx.roundRect(L * 0.42, -1.7, L * 0.5, 3.4, 1.7); ctx.fill();
      ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.arc(L, 0, 5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // muzzle
    ctx.fillStyle = '#12151A';
    ctx.beginPath(); ctx.roundRect(L - 2, -1.6, 4, 3.2, 1); ctx.fill();

    if (c.flash > 0) {
      const f = Math.min(1, c.flash / 60);
      ctx.globalAlpha = f;
      ctx.fillStyle = 'rgba(255,214,138,0.95)';
      ctx.beginPath();
      ctx.moveTo(L, 0); ctx.lineTo(L + 15, -6); ctx.lineTo(L + 10, 0); ctx.lineTo(L + 15, 6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,235,0.9)';
      ctx.beginPath(); ctx.arc(L + 2, 0, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // Enemies get the same anatomical treatment as the crew: shoulders,
  // legs that walk, a head with headgear, a held weapon. A guard should
  // read as a person, not a coloured dot.
  function drawEnemy(e) {
    const alpha = e.dead ? Math.max(0, (e.fade || 0) / 40) : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);

    if (e.def.vehicle)      drawAPC(e);
    else if (e.def.static)  drawNest(e);
    else                    drawFoot(e);

    if (e.hitFlash > 0) {
      ctx.fillStyle = 'rgba(255,110,80,' + Math.min(0.5, e.hitFlash / 22) + ')';
      ctx.beginPath(); ctx.ellipse(0, 0, e.r + 3, e.r + 2, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    if (e.isBoss && !e.dead) {
      const bw = 110;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(e.x - bw / 2 - 1, e.y - e.r - 23, bw + 2, 9);
      ctx.fillStyle = '#7E2019';
      ctx.fillRect(e.x - bw / 2, e.y - e.r - 22, bw, 7);
      ctx.fillStyle = '#C4453A';
      ctx.fillRect(e.x - bw / 2, e.y - e.r - 22, bw * clamp(e.hp / e.maxHp, 0, 1), 7);
      ctx.font = '700 10px Oswald, Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#E8EDF2';
      ctx.fillText(e.name.toUpperCase(), e.x, e.y - e.r - 28);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;
  }

  function drawFoot(e) {
    const r = e.r;
    const SH = r * 1.08, CH = r * 0.74;
    const walk = Math.sin(e.walkPhase || 0);
    const heavy = e.key === 'heavy' || e.key === 'captain' || e.key === 'warden';
    const swat  = e.key === 'swat' || heavy;
    const cop   = e.key === 'cop' || e.key === 'riot';

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.ellipse(1, 3, CH + 5, SH + 2, 0, 0, Math.PI * 2); ctx.fill();

    // legs
    [[-SH * 0.54, walk], [SH * 0.54, -walk]].forEach(function (pair) {
      const oy = pair[0], sw = pair[1];
      ctx.save();
      ctx.translate(-2 + sw * 2.2, oy);
      ctx.fillStyle = shade(e.body, -0.10);
      ctx.beginPath(); ctx.roundRect(-5, -3.6, 12, 7.2, 3); ctx.fill();
      ctx.fillStyle = '#0E1116';
      ctx.beginPath(); ctx.roundRect(4, -3.2, 4, 6.4, 2); ctx.fill();
      ctx.restore();
    });

    // torso
    ctx.fillStyle = e.body;
    ctx.strokeStyle = '#080A0D'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(-1, 0, CH + 1, SH, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    // vest / plate carrier
    ctx.fillStyle = e.accent;
    ctx.beginPath(); ctx.roundRect(-CH * 0.6, -SH * 0.66, CH * 1.25, SH * 1.32, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1; ctx.stroke();

    if (swat) {
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.beginPath(); ctx.roundRect(-CH * 0.35, -SH * 0.5, CH * 0.7, 3.4, 1.2); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-CH * 0.35, SH * 0.16, CH * 0.7, 3.4, 1.2); ctx.fill();
    }
    if (cop) {
      ctx.fillStyle = '#E0B44C';
      ctx.beginPath(); ctx.arc(CH * 0.1, -SH * 0.38, 2, 0, Math.PI * 2); ctx.fill();
    }
    if (heavy) {
      ctx.fillStyle = shade(e.body, 0.10);
      ctx.beginPath(); ctx.roundRect(-CH * 0.2, -SH - 1.5, CH * 0.9, 5, 2); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-CH * 0.2, SH - 3.5, CH * 0.9, 5, 2); ctx.fill();
    }

    // arms converging on the weapon
    const gx = CH + 9;
    ctx.strokeStyle = shade(e.body, 0.06);
    ctx.lineWidth = heavy ? 6 : 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-1, SH * 0.74); ctx.quadraticCurveTo(CH * 0.7, SH * 0.55, gx - 3, 3.4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-1, -SH * 0.74); ctx.quadraticCurveTo(CH * 0.7, -SH * 0.55, gx - 1, -3); ctx.stroke();
    ctx.lineCap = 'butt';

    drawEnemyGun(e, gx);

    // head + headgear
    ctx.save();
    ctx.translate(CH * 0.5, 0);
    const HR = r * 0.44;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(-1.2, 0, HR * 0.95, HR * 0.9, 0, 0, Math.PI * 2); ctx.fill();

    if (swat) {
      ctx.fillStyle = '#14171D';
      ctx.beginPath(); ctx.arc(0, 0, HR * 1.12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3B4550';
      ctx.beginPath(); ctx.arc(0, 0, HR * 1.12, -0.7, 0.7); ctx.lineTo(0, 0); ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#8FD8E8';
      ctx.beginPath(); ctx.roundRect(HR * 0.25, -HR * 0.6, HR * 0.7, HR * 1.2, 1.4); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (e.key === 'riot') {
      ctx.fillStyle = '#1A2436';
      ctx.beginPath(); ctx.arc(0, 0, HR * 1.12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(180,215,235,0.5)';
      ctx.beginPath(); ctx.roundRect(HR * 0.2, -HR * 0.95, HR * 0.9, HR * 1.9, 2); ctx.fill();
    } else {
      ctx.fillStyle = '#C79A6E';
      ctx.beginPath(); ctx.arc(0, 0, HR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade(e.body, 0.04);
      ctx.beginPath(); ctx.arc(-0.6, 0, HR * 1.02, Math.PI * 0.42, Math.PI * 1.58); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#12161C';
      ctx.beginPath(); ctx.roundRect(HR * 0.35, -HR * 0.75, HR * 0.6, HR * 1.5, 1.2); ctx.fill();
      ctx.fillStyle = '#0B0D11';
      ctx.beginPath(); ctx.arc(HR * 0.28, -HR * 0.32, 0.9, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(HR * 0.28, HR * 0.32, 0.9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    if (e.def.shield) {
      ctx.fillStyle = 'rgba(140,175,200,0.42)';
      ctx.strokeStyle = '#9BB6C8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(CH + 3, -r * 1.05, 7, r * 2.1, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(CH + 5, -r * 0.7); ctx.lineTo(CH + 5, r * 0.7); ctx.stroke();
    }

    // alerted marker, drawn upright regardless of facing
    if (e.alerted && !e.dead) {
      ctx.save();
      ctx.rotate(-e.angle);
      ctx.fillStyle = 'rgba(224,180,76,0.9)';
      ctx.beginPath();
      ctx.moveTo(0, -r - 12); ctx.lineTo(-3.4, -r - 6); ctx.lineTo(3.4, -r - 6);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  function drawEnemyGun(e, gx) {
    // Before they have noticed you the weapon is still on the hip.
    const drawing = e.draw > 0;
    const holstered = !e.alerted;
    if (holstered) {
      ctx.save();
      ctx.fillStyle = e.wpn.melee ? '#2A2E36' : '#171A20';
      ctx.beginPath();
      ctx.roundRect(-4, e.r * 0.62, e.wpn.melee ? 12 : 9, 4.5, 2);
      ctx.fill();
      ctx.strokeStyle = '#0A0D12'; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.restore();
      return;
    }

    ctx.save();
    // while drawing, the weapon swings up from the hip into position
    if (drawing) {
      const t = clamp(e.draw / (e.wpn.melee ? 260 : 520), 0, 1);
      ctx.translate(gx - 6 * t, e.r * 0.6 * t);
      ctx.rotate(t * 0.9);
    } else {
      ctx.translate(gx, 0);
    }

    if (e.wpn.melee) {
      // baton thrusts forward on a swing, same language as the player's
      const sw = e.swing > 0 ? e.swing / 220 : 0;
      const lunge = Math.sin((1 - sw) * Math.PI) * 14;
      ctx.translate(lunge, 0);
      ctx.fillStyle = '#1F242B';
      ctx.beginPath(); ctx.roundRect(-2, -1.7, 6, 3.4, 1.6); ctx.fill();
      ctx.fillStyle = '#3C444E';
      ctx.beginPath(); ctx.roundRect(4, -1.5, 12, 3, 1.5); ctx.fill();
      ctx.fillStyle = '#59626D';
      ctx.beginPath(); ctx.roundRect(15, -2, 5, 4, 2); ctx.fill();
      if (sw > 0) {
        ctx.globalAlpha = sw * 0.35;
        ctx.strokeStyle = '#9BA6B3'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(2, -3); ctx.lineTo(-12, -3);
        ctx.moveTo(2, 3);  ctx.lineTo(-12, 3);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    } else {
      const L = (e.key === 'heavy' || e.key === 'guard_rifle') ? 22 : 17;
      ctx.fillStyle = '#171A20';
      ctx.beginPath(); ctx.roundRect(-2, -2.6, L + 2, 5.2, 1.8); ctx.fill();
      ctx.fillStyle = '#333A45';
      ctx.beginPath(); ctx.roundRect(-1, -2.6, L * 0.5, 1.8, 0.9); ctx.fill();
      ctx.fillStyle = '#252B34';
      ctx.beginPath(); ctx.roundRect(L * 0.35, 2, 3.8, 5, 1.2); ctx.fill();
      if (e.muzzle > 0) {
        ctx.globalAlpha = Math.min(1, e.muzzle / 70);
        ctx.fillStyle = 'rgba(255,206,130,0.95)';
        ctx.beginPath();
        ctx.moveTo(L, 0); ctx.lineTo(L + 11, -4.5); ctx.lineTo(L + 7, 0); ctx.lineTo(L + 11, 4.5);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  function drawNest(e) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.ellipse(2, 4, e.r + 6, e.r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4A4636';
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      ctx.save();
      ctx.translate(Math.cos(a) * e.r, Math.sin(a) * e.r);
      ctx.rotate(a);
      ctx.beginPath(); ctx.roundRect(-7, -5, 14, 10, 4); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#20252C';
    ctx.beginPath(); ctx.arc(0, 0, e.r * 0.62, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#12161B';
    ctx.beginPath(); ctx.roundRect(0, -5, e.r + 18, 10, 3); ctx.fill();
    ctx.fillStyle = e.accent;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.roundRect(e.r * 0.5, i * 3 - 0.8, 18, 1.6, 0.8); ctx.fill();
    }
    if (e.muzzle > 0) {
      ctx.globalAlpha = Math.min(1, e.muzzle / 70);
      ctx.fillStyle = 'rgba(255,190,110,0.9)';
      ctx.beginPath(); ctx.arc(e.r + 20, 0, 8, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawAPC(e) {
    const r = e.r;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.roundRect(-r + 3, -r * 0.72 + 5, r * 2, r * 1.44, 8); ctx.fill();
    ctx.fillStyle = e.body;
    ctx.beginPath(); ctx.roundRect(-r, -r * 0.72, r * 2, r * 1.44, 7); ctx.fill();
    ctx.strokeStyle = '#0A0D12'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = shade(e.body, 0.08);
    ctx.beginPath();
    ctx.moveTo(r * 0.3, -r * 0.72); ctx.lineTo(r, -r * 0.35);
    ctx.lineTo(r, r * 0.35); ctx.lineTo(r * 0.3, r * 0.72); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0D1015';
    [-0.55, 0, 0.55].forEach(function (o) {
      ctx.beginPath(); ctx.roundRect(o * r - 6, -r * 0.86, 12, 6, 3); ctx.fill();
      ctx.beginPath(); ctx.roundRect(o * r - 6,  r * 0.5,  12, 6, 3); ctx.fill();
    });
    ctx.fillStyle = shade(e.body, -0.08);
    ctx.beginPath(); ctx.arc(-r * 0.1, 0, r * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#12161B';
    ctx.beginPath(); ctx.roundRect(0, -3, r * 0.95, 6, 2); ctx.fill();
    ctx.fillStyle = '#3E7ACC';
    ctx.beginPath(); ctx.roundRect(-r * 0.7, -r * 0.5, 7, 4, 1.5); ctx.fill();
    ctx.fillStyle = '#C4453A';
    ctx.beginPath(); ctx.roundRect(-r * 0.7, r * 0.3, 7, 4, 1.5); ctx.fill();
    if (e.muzzle > 0) {
      ctx.globalAlpha = Math.min(1, e.muzzle / 90);
      ctx.fillStyle = 'rgba(255,200,120,0.95)';
      ctx.beginPath(); ctx.arc(r, 0, 10, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
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
    w.registers.forEach(t => {
      if (t.open) return;
      ctx.fillStyle = '#5FBF87';
      ctx.fillRect(x0 + t.x * sc - 1, y0 + t.y * sc - 1, 2, 2);
    });
    w.atms.forEach(a => {
      if (a.open) return;
      ctx.fillStyle = '#E0B44C';
      ctx.fillRect(x0 + a.x * sc - 1.5, y0 + a.y * sc - 1.5, 3, 3);
    });
    H.civilians.forEach(c => {
      if (c.dead) return;
      ctx.fillStyle = 'rgba(200,210,220,0.5)';
      ctx.fillRect(x0 + c.x * sc - 1, y0 + c.y * sc - 1, 2, 2);
    });
    H.crew.forEach(c => {
      if (c.dead) return;
      ctx.fillStyle = c.downed ? '#E0B44C' : '#4FB3C4';
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
    const tills = H.world.registers.filter(t => !t.open).length +
                  H.world.atms.filter(a => !a.open).length;
    if (H.extractPhase && H.stragglers > 0)
      obj.textContent = 'Waiting on ' + H.stragglers + ' — press E again to go without them';
    else if (H.canExtract) obj.textContent = 'Press E to drive off';
    else if (openVaults < H.world.vaults.length)
      obj.textContent = tills
        ? 'Drill the vault. ' + tills + ' till' + (tills > 1 ? 's' : '') + ' still shut, if you have time'
        : 'Drill the vault — press E at the drill point';
    else obj.textContent = 'Grab what you can carry, then back to the car';
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
    if (a) a.addEventListener('click', async () => {
      const ok = await GH.confirm({
        title: 'Abandon the job?',
        body: 'You walk away with nothing. Everything in your bags stays on the floor, and anyone already down is left behind.',
        yes: 'Walk away', no: 'Keep going', danger: true,
      });
      if (ok) GH.abandonHeist();
    });
    bindTouch();
    GH.boot();
  });
})();
