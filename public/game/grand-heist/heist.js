// ============================================================
// RoboKyle: Grand Heist - in-mission engine
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

  // Cash is picked up from a comfortable distance, and a pile that has
  // just been spilled is the player's alone for a moment.
  const PICKUP_REACH = 56;
  const LOOT_GRACE = 2600;
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

  // Segment vs axis-aligned rect - used for line of sight and bullet walls.
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
      if (s) GH.audio.playShot(s.name, s.rate * (0.96 + Math.random() * 0.09), s.vol);
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
    drill()  { A() && GH.audio.play('drill', { rate: 0.94 + Math.random() * 0.12, vol: 0.34 }); },
    // forcing a machine: a grind that climbs as the lock gives
    crack(done) {
      if (!A()) return;
      const t = Math.max(0, Math.min(1, done || 0));
      GH.audio.play('drill', { rate: 0.78 + t * 0.5, vol: 0.26 + t * 0.12 });
      if (Math.random() < 0.25 + t * 0.4) {
        GH.audio.play('metal', { rate: 1.2 + t * 0.7, vol: 0.14 + t * 0.1 });
      }
    },
    // "no" - an order that cannot be carried out
    deny()   { A() && GH.audio.play('metal', { rate: 0.6, vol: 0.22 }); },
    alarm()  { A() && GH.audio.play('alarm', { vol: 1 }); },
    boom()   { A() && GH.audio.play('gunHeavy', { rate: 0.45, vol: 1 }); },
    down()   { A() && GH.audio.play('down', { vol: 0.9 }); },
    revive() { A() && GH.audio.play('revive', { vol: 0.9 }); },
    // Each class of weapon reloads with its own rhythm, so you can hear
    // what somebody is doing without looking at them. Layered from the
    // CC0 impact samples already in the pack.
    reload(kind) {
      if (!A()) return;
      const hit = (key, rate, vol, at) => setTimeout(() => {
        A() && GH.audio.play(key, { rate, vol });
      }, at);
      switch (kind) {
        case 'shotgun':                       // shells in, then the pump
          hit('metal', 1.5, 0.26, 0);
          hit('metal', 1.44, 0.24, 150);
          hit('metal', 1.38, 0.24, 300);
          hit('metal', 0.72, 0.42, 470);
          break;
        case 'rifle':                         // mag out, mag in, bolt
          hit('metal', 1.28, 0.30, 0);
          hit('hitArmor', 0.86, 0.34, 190);
          hit('metal', 0.82, 0.40, 340);
          break;
        case 'heavy':                         // a belt, and it is not quick
          hit('metal', 0.62, 0.40, 0);
          hit('hitArmor', 0.58, 0.38, 240);
          hit('metal', 0.50, 0.46, 520);
          hit('metal', 0.70, 0.36, 760);
          break;
        case 'rocket':                        // tube open, round in, shut
          hit('metal', 0.90, 0.34, 0);
          hit('hitArmor', 0.66, 0.40, 260);
          hit('metal', 0.58, 0.44, 520);
          break;
        case 'energy':                        // a cell swap and a spin-up
          hit('glass', 1.6, 0.22, 0);
          hit('metal', 1.75, 0.20, 120);
          hit('metal', 2.0, 0.16, 240);
          hit('metal', 2.3, 0.13, 340);
          break;
        default:                              // pistol: clack, clack
          hit('metal', 1.42, 0.30, 0);
          hit('metal', 0.98, 0.42, 140);
      }
    },
    vault()  { A() && GH.audio.play('vault', { vol: 1 }); },
    scream() {
      // Rate-limited hard: a crowd reacting is a burst of two or three
      // voices, not one every second for the rest of the job.
      if (!A()) return;
      if (H.screamT > 0) return;
      if ((H.screamCount || 0) >= 3 && H.t - (H.screamWindow || 0) < 9000) return;
      if (H.t - (H.screamWindow || 0) >= 9000) { H.screamWindow = H.t; H.screamCount = 0; }
      H.screamCount = (H.screamCount || 0) + 1;
      H.screamT = 900 + Math.random() * 600;
      GH.audio.play(Math.random() < 0.5 ? 'screamA' : 'screamB',
        { rate: 0.94 + Math.random() * 0.18, vol: 0.34 });
    },
    step()   { A() && GH.audio.play('step', { rate: 0.9 + Math.random() * 0.25, vol: 0.18 }); },
  };
  // Any cue this table does not define resolves to a no-op instead of a
  // TypeError. A sound is never worth losing the game over.
  const sfxSafe = new Proxy(sfx, {
    get(t, k) {
      const v = t[k];
      if (typeof v === 'function') return v;
      return function () {};
    },
  });

  // Siren is a looping bed rather than a one-shot; the music engine owns it.
  function startSiren() { if (A()) GH.audio.music('heist'); }
  function stopSiren() {}

  // ==================== STATE ====================
  let H = null;
  const keys = {};
  const mouse = { x: 0, y: 0, down: false, wx: 0, wy: 0 };

  // ==================== WORLD GENERATION ====================
  // Heights include the street below the building, so they grew with it -
  // the banks themselves are the same size they always were.
  const SIZES = {
    small: { w: 1250, h: 1030, lobby: 0.56 },
    mid:   { w: 1550, h: 1230, lobby: 0.54 },
    large: { w: 1950, h: 1480, lobby: 0.52 },
    huge:  { w: 2350, h: 1780, lobby: 0.50 },
  };
  // Deep enough for a proper pavement AND a carriageway: 120 of pavement,
  // and road left over for parked cars with room to walk round them.
  const STREET = 310;
  const WALL = 18;

  // Put a cash pile on open floor near a prop rather than inside it.
  // Tries a few angles outward, then falls back to the nearest free cell,
  // so nothing ever spawns clipped into a wall or a counter.
  // `mustPass` lets a caller insist on a side - a till has to drop its
  // takings where the customer is standing, not behind the counter.
  function spillSpot(x, y, preferAngle, away, mustPass) {
    const d0 = away == null ? 34 : away;
    const ok = (sx, sy) => {
      // Real geometry, not the nav grid: a cell that merely clips a
      // counter's clearance is still perfectly good floor to drop cash on,
      // and testing the grid here was throwing the money over the counter.
      if (blocked(sx, sy, 10)) return false;
      if (mustPass && !mustPass(sx, sy)) return false;
      return true;
    };
    for (let step = 0; step < 3; step++) {
      const d = d0 + step * 16;
      if (preferAngle != null && ok(x + Math.cos(preferAngle) * d, y + Math.sin(preferAngle) * d)) {
        return { x: x + Math.cos(preferAngle) * d, y: y + Math.sin(preferAngle) * d };
      }
      for (let i = 1; i <= 8; i++) {
        const a = (preferAngle == null ? 0 : preferAngle) + i * Math.PI / 5 * (i % 2 ? 1 : -1);
        const sx = x + Math.cos(a) * d, sy = y + Math.sin(a) * d;
        if (ok(sx, sy)) return { x: sx, y: sy };
      }
    }
    const cell = nearestFree(H.world.nav, Math.floor(x / NAV_CELL), Math.floor(y / NAV_CELL));
    return cell ? { x: cellCentre(cell[0]), y: cellCentre(cell[1]) } : { x, y };
  }

  // Split `total` into n randomised-but-exact parts. Piles vary in size
  // for looks, but the sum still matches the haul advertised on the intel
  // card - otherwise the number the player planned around is a lie.
  function splitCash(total, n, spread) {
    const w = [];
    let sum = 0;
    for (let i = 0; i < n; i++) { const v = 1 + rand(-spread, spread); w.push(v); sum += v; }
    return w.map(v => total * v / sum);
  }

  // Deterministic per-bank randomness. The same bank always generates the
  // same building, so "the one with the corner vault" stays that way.
  function seededRandom(seed) {
    let a = (seed * 1103515245 + 12345) >>> 0;
    return function () {
      a ^= a << 13; a >>>= 0;
      a ^= a >> 17;
      a ^= a << 5;  a >>>= 0;
      return a / 4294967296;
    };
  }

  function generateWorld(bank) {
    const S = SIZES[bank.size];
    const W = S.w, Hh = S.h;
    const obstacles = [];   // {x,y,w,h,low,breakable,kind}
    const loot = [];        // {x,y,r,amount,kind,locked}
    const world = { w: W, h: Hh, obstacles, loot, vaults: [], boxes: [] };

    // ---- this bank's own plan ----
    const R = seededRandom(bank.id * 7919 + 31);
    const pick2 = (arr) => arr[Math.floor(R() * arr.length)];
    const between = (a, b) => a + R() * (b - a);

    const bx = 90, by = 70;
    const bw = W - 180, bh = Hh - STREET - by;
    world.building = { x: bx, y: by, w: bw, h: bh };

    // The entrance is not always dead centre.
    const doorW = Math.round(between(120, 170));
    const doorFrac = pick2([0.24, 0.36, 0.5, 0.5, 0.64, 0.76]);
    const doorX = clamp(bx + bw * doorFrac - doorW / 2, bx + WALL + 40, bx + bw - WALL - doorW - 40);
    world.door = { x: doorX, y: by + bh - WALL, w: doorW, h: WALL };
    world.plan = { doorFrac };

    // ---- outer shell (front wall split around the door) ----
    obstacles.push({ x: bx, y: by, w: bw, h: WALL, kind: 'wall' });                       // back
    obstacles.push({ x: bx, y: by, w: WALL, h: bh, kind: 'wall' });                       // left
    obstacles.push({ x: bx + bw - WALL, y: by, w: WALL, h: bh, kind: 'wall' });           // right
    obstacles.push({ x: bx, y: by + bh - WALL, w: doorX - bx, h: WALL, kind: 'wall' });   // front-left
    obstacles.push({ x: doorX + doorW, y: by + bh - WALL, w: bx + bw - (doorX + doorW), h: WALL, kind: 'wall' });

    // ---- teller counter dividing lobby from the back of house ----
    // Its depth into the building, how many ways through it has, and where
    // those are all vary by bank.
    const counterY = by + bh * (S.lobby + between(-0.07, 0.09));
    const gapW = Math.round(between(84, 118));
    const gapCount = pick2([1, 2, 2, 2, 3]);
    const gapXs = [];
    if (gapCount === 1) {
      gapXs.push(bx + bw * pick2([0.32, 0.5, 0.68]));
    } else if (gapCount === 2) {
      const spread = between(0.18, 0.30);
      const mid = between(0.42, 0.58);
      gapXs.push(bx + bw * (mid - spread), bx + bw * (mid + spread));
    } else {
      gapXs.push(bx + bw * 0.22, bx + bw * 0.5, bx + bw * 0.78);
    }
    gapXs.sort((a, b) => a - b);
    world.plan.gapXs = gapXs;

    const segs = [];
    let cursor = bx + WALL;
    gapXs.forEach(gxc => {
      segs.push([cursor, gxc - gapW / 2]);
      cursor = gxc + gapW / 2;
    });
    segs.push([cursor, bx + bw - WALL]);
    const counterSegs = [];
    segs.forEach(([x0, x1]) => {
      if (x1 - x0 > 10) {
        obstacles.push({ x: x0, y: counterY, w: x1 - x0, h: 16, low: true, kind: 'counter' });
        counterSegs.push([x0, x1]);
      }
    });
    world.counterY = counterY;
    world.counterSegs = counterSegs;

    // Lanes people must be able to use: straight in from the door, and
    // through each gap in the counter. Nothing solid may stand in them.
    const doorLane = [doorX - 46, doorX + doorW + 46];
    const gapLanes = gapXs.map(gxc => [gxc - gapW, gxc + gapW]);
    const inLane = (x, y) => {
      if (y < by || y > by + bh) return false;               // outside is fine
      // the strip in front of the counter has to stay walkable, or you
      // cannot get to your own tills
      // deep enough that nothing solid ends up within a body's width of
      // somebody standing at a till
      if (y > counterY - 30 && y < counterY + 92) return true;
      if (x > doorLane[0] && x < doorLane[1]) return true;
      for (const g of gapLanes) if (x > g[0] && x < g[1]) return true;
      return false;
    };


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
    world.queues = [];          // filled in once tills and ATMs exist
    world.deposits = [];
    world.registers = [];
    // Lay them out along the counter segments only. Spacing them evenly
    // across the full width dropped tills into the walkway gaps, standing
    // in the middle of the floor with nothing behind them.
    const tillSpots = [];
    const totalCounter = counterSegs.reduce((sum, sg) => sum + (sg[1] - sg[0]), 0);
    counterSegs.forEach(sg => {
      const segLen = sg[1] - sg[0];
      const want = Math.max(1, Math.round(tills * segLen / totalCounter));
      for (let i = 0; i < want; i++) {
        const t = (i + 0.5) / want;
        const x = sg[0] + 28 + (segLen - 56) * t;
        if (x > sg[0] + 16 && x < sg[1] - 16) tillSpots.push(x);
      }
    });
    const tillAmounts = splitCash(bank.haul * drawerShare, Math.max(1, tillSpots.length), 0.2);
    tillSpots.forEach((x, i) => {
      world.registers.push({
        x, y: counterY - 4, r: 20,
        amount: tillAmounts[i],
        open: false, hp: 45, prying: 0, shake: 0,
      });
      // a till is a solid object on the counter
      // no separate obstacle: the counter underneath already blocks, and
      // stacking another box here squeezed the walkway
    });

    // ---- vault rooms across the back ----
    const vaultCount = bank.vaults || 1;
    const vaultCash = bank.haul * vaultShare / vaultCount;
    const vw = Math.min(330, (bw - 2 * WALL - 80) / vaultCount - 40);
    const vh = Math.min(240, bh * 0.30);

    // Where the strongroom sits is part of a bank's character: tucked in a
    // corner, off to one side, or square in the middle of the back wall.
    const vaultPlan = pick2(['centre', 'left', 'right', 'split', 'corner']);
    world.plan.vault = vaultPlan;
    // Where each vault sits along the back wall. `corner` and `split` used
    // `v % 2`, which put the first and third vault in exactly the same
    // place on a three-vault bank: two strongrooms inside each other, and
    // a drill point buried in someone else's wall.
    const FRACS = {
      left:   [0.06, 0.36, 0.66],
      right:  [0.94, 0.64, 0.34],
      split:  [0.14, 0.86, 0.50],
      corner: [0.08, 0.92, 0.50],
    };
    const vaultSpotFor = (v) => {
      const inset = WALL + 40;
      const usable = bw - 2 * inset - vw;
      const table = FRACS[vaultPlan];
      if (!table) return bx + bw * ((v + 1) / (vaultCount + 1)) - vw / 2;
      // beyond the table, fall back to spreading them evenly
      const f = v < table.length ? table[v] : (v + 1) / (vaultCount + 1);
      return bx + inset + usable * f;
    };
    for (let v = 0; v < vaultCount; v++) {
      const vx = clamp(vaultSpotFor(v), bx + WALL + 24, bx + bw - WALL - vw - 24);
      const vy = by + WALL + Math.round(between(28, 64));
      // three solid walls plus a front wall with a doorway that the drill opens
      obstacles.push({ x: vx, y: vy, w: vw, h: WALL, kind: 'vaultwall' });
      obstacles.push({ x: vx, y: vy, w: WALL, h: vh, kind: 'vaultwall' });
      obstacles.push({ x: vx + vw - WALL, y: vy, w: WALL, h: vh, kind: 'vaultwall' });
      const dW = Math.round(between(86, 112)), dX = vx + vw / 2 - dW / 2;
      obstacles.push({ x: vx, y: vy + vh - WALL, w: dX - vx, h: WALL, kind: 'vaultwall' });
      obstacles.push({ x: dX + dW, y: vy + vh - WALL, w: vx + vw - (dX + dW), h: WALL, kind: 'vaultwall' });
      const door = { x: dX, y: vy + vh - WALL, w: dW, h: WALL, kind: 'vaultdoor', open: false, solid: true };
      obstacles.push(door);

      const vault = {
        id: v, x: vx, y: vy, w: vw, h: vh, door,
        drillX: dX + dW / 2, drillY: vy + vh + 36,
        progress: 0, drilling: false, open: false, rig: false,
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
    // Only for the small branches. Anywhere with a proper back of house
    // puts its boxes in the strongroom corridor instead, which is both
    // more like a real bank and stops two floor plans fighting for the
    // same square metres.
    const backTop0 = by + WALL;
    const backBot0 = counterY - 30;
    const roomy = (bank.size === 'large' || bank.size === 'huge') &&
                  (backBot0 - backTop0) > 300;
    world.plan.backOffice = roomy;

    const boxes = boxCount;
    if (boxes > 0 && !roomy) {
      const officeW = 200, officeH = 150;
      const hi = by + bh * between(0.26, 0.36);
      const lo = by + bh * between(0.56, 0.68);
      const spots = vaultPlan === 'right'
        ? [{ x: bx + WALL + 10, y: hi }, { x: bx + WALL + 10, y: lo },
           { x: bx + bw - WALL - officeW - 10, y: lo }, { x: bx + bw - WALL - officeW - 10, y: hi }]
        : [{ x: bx + bw - WALL - officeW - 10, y: hi }, { x: bx + bw - WALL - officeW - 10, y: lo },
           { x: bx + WALL + 10, y: lo }, { x: bx + WALL + 10, y: hi }];
      const boxAmounts = splitCash(bank.haul * boxShare, boxes, 0.25);
      let placed = 0;
      spots.forEach((sp, si) => {
        if (placed >= boxes) return;
        // partial walls so offices read as rooms but stay enterable
        // Interior, so they are tagged as partitions: the repair pass is
        // allowed to cut a doorway through one, and never through the shell.
        obstacles.push({ x: sp.x, y: sp.y, w: officeW, h: 14, kind: 'partition' });
        obstacles.push({ x: sp.x, y: sp.y + officeH - 14, w: officeW * 0.55, h: 14, kind: 'partition' });
        const perRoom = Math.min(3, boxes - placed);
        for (let i = 0; i < perRoom; i++) {
          world.deposits.push({
            x: sp.x + 40 + i * 55, y: sp.y + officeH * 0.5,
            r: 16, amount: boxAmounts[placed],
            open: false, hp: 60, shake: 0,
          });
          placed++;
        }
      });
    }

    // Queue lanes: a line of standing spots leading away from each till
    // and each ATM, on the customer side.
    world.registers.forEach(t => {
      const spots = [];
      // offset to one side so the window itself stays walk-up-able
      const lean = (world.registers.indexOf(t) % 2) ? 30 : -30;
      for (let i = 0; i < 4; i++) {
        spots.push({ x: t.x + lean, y: counterY + 62 + i * 36 });
      }
      world.queues.push({ kind: 'till', x: t.x, y: counterY + 30, spots });
    });

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
      // hug the wall: a deep box here can pinch the side aisle shut
      const wallSide = onLeft ? ax - 15 : ax - 11;
      obstacles.push({ x: wallSide, y: ay - 17, w: 26, h: 34, low: true, kind: 'atm' });
    }

    world.atms.forEach(a => {
      const dir = a.facing === 0 ? 1 : -1;
      const spots = [];
      for (let i = 0; i < 3; i++) spots.push({ x: a.x + dir * (40 + i * 32), y: a.y });
      world.queues.push({ kind: 'atm', x: a.x + dir * 30, y: a.y, spots });
    });

    // ATM money comes out of the advertised take, so the intel figure on
    // the mission card stays honest.
    if (world.atms.length) {
      const amounts = splitCash(bank.haul * atmShare, world.atms.length, 0.2);
      world.atms.forEach((a, i) => { a.amount = amounts[i]; });
    }

    // ---- lobby furniture for cover ----
    // Lobby furniture: a row of writing desks, a pair of islands, or a
    // scatter of pillars. Kept out of the door and counter lanes.
    const lobbyPlan = pick2(['desks', 'islands', 'pillars', 'desks']);
    world.plan.lobby = lobbyPlan;
    const lobbyMidY = counterY + (bh - (counterY - by)) * between(0.36, 0.52);
    const placeProp = (x, y, w, h, kind) => {
      if (inLane(x, y) || inLane(x - w / 2, y) || inLane(x + w / 2, y)) return;
      obstacles.push({ x: x - w / 2, y: y - h / 2, w, h, low: true, kind });
    };
    if (lobbyPlan === 'desks') {
      const n = Math.max(2, Math.round(bw / 320));
      for (let i = 0; i < n; i++) {
        placeProp(bx + bw * (0.18 + 0.64 * (i / Math.max(1, n - 1))), lobbyMidY, 90, 28, 'desk');
      }
    } else if (lobbyPlan === 'islands') {
      placeProp(bx + bw * between(0.24, 0.32), lobbyMidY, 120, 48, 'desk');
      placeProp(bx + bw * between(0.68, 0.76), lobbyMidY, 120, 48, 'desk');
    } else {
      const n = Math.max(3, Math.round(bw / 260));
      for (let i = 0; i < n; i++) {
        const px = bx + bw * (0.14 + 0.72 * (i / Math.max(1, n - 1)));
        placeProp(px, lobbyMidY - 30, 34, 34, 'pillar');
        if (i % 2 === 0) placeProp(px, lobbyMidY + 62, 34, 34, 'pillar');
      }
    }

    // ---- street, pavement and the getaway car ----
    // The street is three bands: pavement against the building, a kerb,
    // then road. Everything parks along the kerb like it would in life,
    // rather than floating in the middle of the carriageway.
    world.street = { x: 0, y: Hh - STREET, w: W, h: STREET };
    const walkY = Hh - STREET;                 // top of the pavement
    const kerbY = walkY + 120;                 // pavement meets road here
    const parkY = kerbY + 40;                  // centre line of parked cars
    world.walkY = walkY;
    world.kerbY = kerbY;
    world.parkY = parkY;

    // The getaway car waits at the kerb. Normally that is right outside
    // the entrance - but if this job has men posted on the street, park
    // at the other end of it. Walking up the pavement towards a guard is
    // a decision; spawning six feet from one is just an ambush.
    const entranceX = doorX + doorW / 2;
    const guardsOutside = bank.guards >= 4 || !!bank.boss;
    world.guardsOutside = guardsOutside;
    world.car = {
      x: guardsOutside
        ? (entranceX > W / 2 ? W * 0.16 : W * 0.84)
        : entranceX,
      y: parkY, r: 78,
    };
    world.entranceX = entranceX;

    // Other vehicles along the same kerb, never on top of the getaway car.
    // A street's worth of different vehicles, all at full size - the old
    // ones were scaled down and read as models parked next to the real car.
    world.vehicles = [];
    const PAINT = ['#2B3A4A', '#3A3038', '#243028', '#40382A', '#32323A', '#3B2A2A',
                   '#4A4438', '#1E2A34', '#513B2E', '#6A6257', '#2E3E3A'];
    const BODIES = ['saloon', 'saloon', 'hatch', 'estate', 'van', 'pickup', 'taxi'];
    for (let vx = 170; vx < W - 170; vx += rand(240, 340)) {
      if (Math.abs(vx - world.car.x) < 300) continue;   // room to load up
      const body = BODIES[Math.floor(Math.random() * BODIES.length)];
      const len = VEHICLE_LEN[body];
      world.vehicles.push({
        x: vx, y: parkY + rand(-3, 3),
        color: body === 'taxi' ? '#C9A227' : PAINT[Math.floor(Math.random() * PAINT.length)],
        flip: Math.random() < 0.5,
        scale: rand(0.98, 1.06),
        body,
        rust: Math.random() < 0.3,
      });
      obstacles.push({ x: vx - len / 2, y: parkY - 26, w: len, h: 52, low: true, kind: 'car' });
    }

    // ---- decoration ----
    // How well kept the place is scales with the bank. A pawn shop has
    // litter and a skip out front; a reserve bank has topiary and brass
    // bollards. Flat scenery never blocks anyone; anything you would walk
    // around in life gets an obstacle.
    world.decor = [];
    world.rooms = [];
    const tier = bank.id <= 4 ? 'low' : (bank.id <= 12 ? 'mid' : 'high');
    world.tier = tier;


    // The strip of pavement against the shopfronts stays clear end to
    // end. Benches and planters live on the kerb side of it. Without this
    // the street furniture could wall the pavement off completely, which
    // matters now that the car is not always parked at the door.
    // Wide enough that a whole nav-grid row fits inside it: a 30px gap
    // that a body fits through is no use if every cell covering it also
    // clips the wall's clearance and reads as blocked.
    const PAVE_CLEAR_TO = walkY + 68;

    const addDecor = (kind, x, y, opts) => {
      const d = Object.assign({ kind, x, y, rot: 0, s: 1 }, opts || {});
      // keep solid street furniture out of the walking lane
      if (d.solid && y > walkY - 20 && y < kerbY + 30) {
        const half = d.solid[1] / 2;
        if (d.y - half < PAVE_CLEAR_TO) d.y = PAVE_CLEAR_TO + half;
        if (d.y + half > kerbY - 4) d.y = kerbY - 4 - half;     // and off the road
      }
      // shove a blocking prop aside rather than dropping it in a doorway
      if (d.solid && inLane(x, y)) {
        const shift = (x < (bx + bw) / 2 ? -1 : 1) * (gapW + 40);
        d.x = clamp(x + shift, bx + 40, bx + bw - 40);
        if (inLane(d.x, d.y)) return d;                       // still bad: skip it
      }
      world.decor.push(d);
      if (d.solid) {
        obstacles.push({
          x: d.x - d.solid[0] / 2, y: d.y - d.solid[1] / 2,
          w: d.solid[0], h: d.solid[1], low: true, kind: 'decor',
        });
      }
      return d;
    };

    const onPavement = () => ({
      x: rand(bx - 40, bx + bw + 40),
      y: rand(walkY + 14, kerbY - 12),
    });

    // ---------- pavement, by tier ----------
    if (tier === 'low') {
      for (let i = 0; i < 22; i++) { const p = onPavement(); addDecor('litter', p.x, p.y, { rot: rand(0, 6.3), s: rand(0.7, 1.3) }); }
      for (let i = 0; i < 5; i++)  { const p = onPavement(); addDecor('trashbag', p.x, p.y, { rot: rand(0, 6.3), s: rand(0.85, 1.2) }); }
      for (let i = 0; i < 7; i++)  { const p = onPavement(); addDecor('crack', p.x, p.y, { rot: rand(0, 3.1), s: rand(0.8, 1.6) }); }
      for (let i = 0; i < 4; i++)  { const p = onPavement(); addDecor('stain', p.x, p.y, { s: rand(0.9, 1.8) }); }
      addDecor('dumpster', bx - 10, walkY + 34, { solid: [68, 44] });
      addDecor('weeds', bx + bw + 18, kerbY - 16, { s: 1.1 });
      addDecor('weeds', bx - 26, kerbY - 20, { s: 0.9 });
      addDecor('graffiti', bx + bw * 0.22, walkY + 6, { s: 1.2 });
      addDecor('graffiti', bx + bw * 0.78, walkY + 6, { s: 0.9 });
    } else if (tier === 'mid') {
      for (let i = 0; i < 8; i++)  { const p = onPavement(); addDecor('litter', p.x, p.y, { rot: rand(0, 6.3), s: rand(0.6, 1) }); }
      for (let i = 0; i < 3; i++)  { const p = onPavement(); addDecor('crack', p.x, p.y, { rot: rand(0, 3.1), s: rand(0.6, 1) }); }
      addDecor('bench', bx + bw * 0.18, walkY + 40, { solid: [72, 26] });
      addDecor('bench', bx + bw * 0.82, walkY + 40, { solid: [72, 26] });
      addDecor('bin', bx + bw * 0.30, walkY + 34, { solid: [26, 26] });
      addDecor('newsbox', bx + bw * 0.70, walkY + 34, { solid: [26, 30] });
      addDecor('planter', bx + bw * 0.42, walkY + 30, { solid: [40, 40], s: 1 });
      addDecor('planter', bx + bw * 0.58, walkY + 30, { solid: [40, 40], s: 1 });
      addDecor('lamp', bx + bw * 0.10, kerbY - 22, { solid: [16, 16] });
      addDecor('lamp', bx + bw * 0.90, kerbY - 22, { solid: [16, 16] });
      addDecor('bikerack', bx + bw * 0.62, kerbY - 26, { solid: [56, 16] });
    } else {
      addDecor('carpet', doorX + doorW / 2, walkY + 34, { s: 1 });
      for (let i = 0; i < 6; i++) {
        const side = i < 3 ? -1 : 1;
        addDecor('bollard', doorX + doorW / 2 + side * (70 + (i % 3) * 46), kerbY - 18, { solid: [16, 16] });
      }
      addDecor('topiary', doorX - 58, walkY + 30, { solid: [44, 44], s: 1.1 });
      addDecor('topiary', doorX + doorW + 58, walkY + 30, { solid: [44, 44], s: 1.1 });
      addDecor('planter', bx + bw * 0.16, walkY + 32, { solid: [46, 46], s: 1.15 });
      addDecor('planter', bx + bw * 0.84, walkY + 32, { solid: [46, 46], s: 1.15 });
      addDecor('lampOrnate', bx + bw * 0.28, kerbY - 24, { solid: [18, 18] });
      addDecor('lampOrnate', bx + bw * 0.72, kerbY - 24, { solid: [18, 18] });
      addDecor('bench', bx + bw * 0.40, walkY + 42, { solid: [76, 26] });
      addDecor('bench', bx + bw * 0.60, walkY + 42, { solid: [76, 26] });
      addDecor('banner', bx + bw * 0.34, walkY + 4, { s: 1 });
      addDecor('banner', bx + bw * 0.66, walkY + 4, { s: 1 });
    }

    // drains and manholes on the road, flat
    for (let i = 0; i < 4; i++) {
      addDecor('drain', W * (0.18 + 0.22 * i), kerbY + 12, { s: 1 });
    }
    addDecor('manhole', W * 0.4, parkY + 62, { s: 1 });
    addDecor('manhole', W * 0.72, parkY + 54, { s: 0.9 });

    // ---------- interior dressing ----------
    const lobbyTop = counterY + 40;
    const lobbyBot = by + bh - 46;
    const inLobby = () => ({
      x: rand(bx + 60, bx + bw - 60),
      y: rand(lobbyTop, lobbyBot),
    });

    if (tier === 'low') {
      for (let i = 0; i < 10; i++) { const p = inLobby(); addDecor('scuff', p.x, p.y, { s: rand(0.8, 1.6) }); }
      for (let i = 0; i < 5; i++)  { const p = inLobby(); addDecor('litter', p.x, p.y, { rot: rand(0, 6.3), s: 0.8 }); }
      addDecor('cooler', bx + 40, counterY + 126, { solid: [26, 26] });
      addDecor('chair', bx + 96, lobbyBot - 10, { solid: [26, 26] });
      addDecor('chair', bx + 132, lobbyBot - 10, { solid: [26, 26] });
      addDecor('board', bx + bw - 60, counterY + 54, { s: 1 });
    } else if (tier === 'mid') {
      addDecor('plant', bx + 44, counterY + 128, { solid: [34, 34] });
      addDecor('plant', bx + bw - 44, counterY + 128, { solid: [34, 34] });
      addDecor('seating', bx + 74, lobbyBot - 16, { solid: [90, 30] });
      addDecor('seating', bx + bw - 74, lobbyBot - 16, { solid: [90, 30] });
      addDecor('stand', bx + 96, counterY + 132, { solid: [24, 24] });
    } else {
      addDecor('rug', bx + bw * 0.5, (counterY + lobbyBot) / 2, { s: 1 });
      addDecor('topiary', bx + 46, counterY + 132, { solid: [40, 40] });
      addDecor('topiary', bx + bw - 46, counterY + 132, { solid: [40, 40] });
      addDecor('flowers', bx + bw * 0.34, counterY - 40, { s: 1 });
      addDecor('flowers', bx + bw * 0.66, counterY - 40, { s: 1 });
      addDecor('rope', doorX - 70, by + bh - 90, { solid: [12, 12] });
      addDecor('rope', doorX + doorW + 70, by + bh - 90, { solid: [12, 12] });
      addDecor('seating', bx + 78, lobbyBot - 18, { solid: [96, 32] });
      addDecor('seating', bx + bw - 78, lobbyBot - 18, { solid: [96, 32] });
      addDecor('art', bx + bw * 0.5, by + WALL + 6, { s: 1 });
    }

    // ---- back of house: corridor, offices, cubicles ----
    // A bank is not one open hall with a strongroom dropped in the middle:
    // there is a corridor off the counter, rooms either side of it, and
    // the vault at the end.
    const backBot = backBot0;
    if (roomy) {
      const DOOR = 74;                       // a doorway a body fits through
      const WALLT = 18;                      // same thickness as the shell

      // A corridor runs across the back, in front of the vaults, so there
      // is always a route from the counter gaps to the strongroom.
      const vaultBot = Math.max.apply(null, world.vaults.map(v => v.y + v.h));
      const corrTop = Math.min(vaultBot + 34, backBot - 150);
      const corrBot = corrTop + 78;          // a corridor, not a concourse

      // Partition between the corridor and the rooms behind the counter,
      // with two doorways off it.
      const doorAts = [bx + bw * between(0.22, 0.34), bx + bw * between(0.66, 0.78)];
      const runWall = (y, gaps) => {
        const cuts = gaps.slice().sort((a, b) => a - b);
        let cursor = bx + WALL;
        cuts.forEach(gx => {
          const from = cursor, to = gx - DOOR / 2;
          if (to - from > 26) {
            obstacles.push({ x: from, y, w: to - from, h: WALLT, kind: 'partition' });
          }
          cursor = gx + DOOR / 2;
        });
        if (bx + bw - WALL - cursor > 26) {
          obstacles.push({ x: cursor, y, w: bx + bw - WALL - cursor, h: WALLT, kind: 'partition' });
        }
      };
      runWall(corrBot, doorAts);

      // Rooms between that partition and the counter, split by cross walls
      // with a doorway in each. Three or four of them across the width.
      const roomTop = corrBot + WALLT;
      const roomBot = backBot;
      const roomCount = bank.size === 'huge' ? 5 : 3;
      const cross = [];
      for (let i = 1; i < roomCount; i++) {
        const cx2 = bx + WALL + (bw - 2 * WALL) * (i / roomCount);
        cross.push(cx2);
        // a wall with a gap in it, so the rooms interconnect as well
        const gapAt = roomTop + (roomBot - roomTop) * between(0.35, 0.65);
        if (gapAt - roomTop > 26) {
          obstacles.push({ x: cx2 - WALLT / 2, y: roomTop, w: WALLT,
                           h: gapAt - roomTop - DOOR / 2, kind: 'partition' });
        }
        const lower = gapAt + DOOR / 2;
        if (roomBot - lower > 26) {
          obstacles.push({ x: cx2 - WALLT / 2, y: lower, w: WALLT,
                           h: roomBot - lower, kind: 'partition' });
        }
      }

      // Furnish each room. What goes in it depends on which room it is,
      // and one of them is the safe-deposit room.
      const edges = [bx + WALL].concat(cross).concat([bx + bw - WALL]);
      const KINDS = ['cubicles', 'offices', 'records', 'break'];

      for (let i = 0; i < roomCount; i++) {
        const x0 = edges[i] + 16, x1 = edges[i + 1] - 16;
        const w2 = x1 - x0;
        if (w2 < 90) continue;
        const cy2 = (roomTop + roomBot) / 2;

        const kind = KINDS[Math.floor(R() * KINDS.length)];

        // the room itself, so the floor and the props can match
        world.rooms.push({ x: x0 - 16, y: roomTop, w: w2 + 32, h: roomBot - roomTop, kind });

        if (kind === 'cubicles') {
          // An open-plan bay: dividers you can shoot over, a workstation in
          // each pen, and a chair pushed back from every one of them.
          const cols = Math.max(1, Math.floor(w2 / 104));
          for (let c2 = 0; c2 < cols; c2++) {
            const px2 = x0 + (c2 + 0.5) * (w2 / cols);
            for (const oy of [-56, 20]) {
              if (cy2 + oy < roomTop + 24 || cy2 + oy > roomBot - 30) continue;
              obstacles.push({ x: px2 - 40, y: cy2 + oy, w: 80, h: 11,
                               low: true, kind: 'cubicle' });
              obstacles.push({ x: px2 - 40, y: cy2 + oy, w: 11, h: 40,
                               low: true, kind: 'cubicle' });
              addDecor('workstation', px2, cy2 + oy + 28, { solid: [58, 26] });
              addDecor('officechair', px2 + rand(-10, 10), cy2 + oy + 50,
                       { solid: [22, 22] });
            }
          }
          if (w2 > 150) addDecor('printer', x1 - 26, roomBot - 26, { solid: [34, 24] });

        } else if (kind === 'offices') {
          // A manager's room: desk facing the door, a chair behind it, and
          // filing along the back wall.
          addDecor('workstation', x0 + w2 * 0.5, cy2 - 18, { solid: [58, 26] });
          addDecor('officechair', x0 + w2 * 0.5, cy2 + 16, { solid: [22, 22] });
          obstacles.push({ x: x0 + 8, y: roomTop + 24, w: Math.min(66, w2 * 0.35), h: 24,
                           low: true, kind: 'shelf' });
          if (w2 > 170) addDecor('whiteboard', x1 - 34, roomTop + 20, { solid: [52, 14] });
          addDecor('plant', x1 - 24, roomBot - 30, { solid: [30, 30] });
          addDecor('coatstand', x0 + 22, roomBot - 28, { solid: [18, 18] });

        } else if (kind === 'records') {
          // Aisles of filing, front to back, with a workbench at the end.
          const rows = Math.max(1, Math.floor(w2 / 78));
          for (let c2 = 0; c2 < rows; c2++) {
            const px2 = x0 + (c2 + 0.5) * (w2 / rows);
            obstacles.push({ x: px2 - 24, y: cy2 - 50, w: 48, h: 28,
                             low: true, kind: 'shelf' });
            obstacles.push({ x: px2 - 24, y: cy2 + 14, w: 48, h: 28,
                             low: true, kind: 'shelf' });
          }
          addDecor('printer', x0 + 28, roomBot - 26, { solid: [34, 24] });
          addDecor('board', x0 + w2 * 0.5, roomTop + 12, { s: 1 });

        } else {
          // Staff room: a table with chairs round it, a cooler, a board.
          addDecor('table', x0 + w2 * 0.5, cy2, { solid: [76, 40] });
          addDecor('officechair', x0 + w2 * 0.5 - 54, cy2, { solid: [22, 22] });
          addDecor('officechair', x0 + w2 * 0.5 + 54, cy2, { solid: [22, 22] });
          addDecor('officechair', x0 + w2 * 0.5, cy2 - 42, { solid: [22, 22] });
          addDecor('cooler', x1 - 26, roomTop + 32, { solid: [26, 26] });
          addDecor('whiteboard', x0 + w2 * 0.5, roomTop + 14, { solid: [52, 14] });
          addDecor('coatstand', x0 + 24, roomBot - 28, { solid: [18, 18] });
        }
      }

      // the corridor is a room in its own right, floor-wise
      world.rooms.push({ x: bx + WALL, y: corrTop, w: bw - 2 * WALL,
                         h: corrBot - corrTop, kind: 'corridor' });

      // ---- safe-deposit boxes down the corridor ----
      // Two banks of them facing each other along the strongroom corridor.
      // They are wall-mounted and do not block, so the corridor stays a
      // corridor, and it is always connected to the vaults.
      if (boxCount > 0) {
        const amounts = splitCash(bank.haul * boxShare, boxCount, 0.25);
        const left = bx + WALL + 56;
        const span = bw - 2 * WALL - 112;
        const perSide = Math.ceil(boxCount / 2);
        const gap = span / Math.max(1, perSide - 1);
        for (let k = 0; k < boxCount; k++) {
          const side = k % 2;
          const idx = Math.floor(k / 2);
          world.deposits.push({
            x: perSide > 1 ? left + idx * gap : bx + bw / 2,
            y: side ? corrBot - 22 : corrTop + 22,
            r: 16, amount: amounts[k],
            open: false, hp: 60, shake: 0,
          });
        }
      }
    }

    clearAroundLootables(world);
    buildNav(world);
    proveRoutes(world);
    return world;
  }

  // A cash machine is a fixture; the potted plant is not. Anything loose
  // standing on top of something you have to reach gets moved out of it,
  // because a machine you cannot walk up to is a machine that is not in
  // the level as far as the player is concerned.
  function clearAroundLootables(world) {
    const spots = []
      .concat(world.atms.map(o => ({ x: o.x, y: o.y, r: 24 })))
      .concat(world.registers.map(o => ({ x: o.x, y: o.y, r: 20 })))
      .concat(world.deposits.map(o => ({ x: o.x, y: o.y, r: 20 })));
    if (!spots.length) return;

    world.obstacles = world.obstacles.filter(ob => {
      if (ob.kind !== 'decor') return true;
      for (const s2 of spots) {
        const nx = Math.max(ob.x, Math.min(s2.x, ob.x + ob.w));
        const ny = Math.max(ob.y, Math.min(s2.y, ob.y + ob.h));
        if ((s2.x - nx) ** 2 + (s2.y - ny) ** 2 < s2.r * s2.r) {
          // take the visible prop with it
          const dec = world.decor.find(d => d.solid &&
            Math.abs(d.x - (ob.x + ob.w / 2)) < 1 && Math.abs(d.y - (ob.y + ob.h / 2)) < 1);
          if (dec) world.decor.splice(world.decor.indexOf(dec), 1);
          return false;
        }
      }
      return true;
    });
  }

  // Everywhere the player has to be able to stand.
  function objectives(world) {
    const out = [{ x: world.door.x + world.door.w / 2, y: world.door.y + 40, what: 'door' }];
    world.vaults.forEach((v, i) => out.push({ x: v.drillX, y: v.drillY, what: 'vault ' + i }));
    world.registers.forEach((t, i) => out.push({ x: t.x, y: world.counterY + 34, what: 'till ' + i }));
    world.atms.forEach((a, i) => out.push({
      x: a.x + Math.cos(a.facing) * 34, y: a.y + Math.sin(a.facing) * 34, what: 'atm ' + i,
    }));
    world.deposits.forEach((d, i) => out.push({ x: d.x, y: d.y + 32, what: 'box ' + i }));
    return out;
  }

  // Flood the nav grid from the car and report which objectives it reaches.
  function reachSet(world) {
    const nav = world.nav, CELL = NAV_CELL;
    const sx = Math.floor(world.car.x / CELL), sy = Math.floor(world.car.y / CELL);
    const seen = new Uint8Array(nav.cols * nav.rows);
    if (nav.blocked[sy * nav.cols + sx]) return seen;
    const q = [sx, sy];
    seen[sy * nav.cols + sx] = 1;
    for (let h = 0; h < q.length; h += 2) {
      const x = q[h], y = q[h + 1];
      for (let d = 0; d < 4; d++) {
        const nx = x + [1, -1, 0, 0][d], ny = y + [0, 0, 1, -1][d];
        if (nx < 0 || ny < 0 || nx >= nav.cols || ny >= nav.rows) continue;
        const i = ny * nav.cols + nx;
        if (seen[i] || nav.blocked[i]) continue;
        seen[i] = 1;
        q.push(nx, ny);
      }
    }
    return seen;
  }

  function unreached(world) {
    const seen = reachSet(world);
    const nav = world.nav, CELL = NAV_CELL;
    return objectives(world).filter(o => {
      const cx = Math.floor(o.x / CELL), cy = Math.floor(o.y / CELL);
      if (cx < 0 || cy < 0 || cx >= nav.cols || cy >= nav.rows) return true;
      // Exact cell only. Accepting a neighbouring free cell let this pass
      // declare victory while the objective itself was still walled in.
      return !seen[cy * nav.cols + cx];
    });
  }

  // Take out whatever is sealing something off. Loose scenery goes first,
  // then cubicle dividers and filing, then a doorway through a partition -
  // never the shell of the building or a vault wall.
  // Order matters: cutting a doorway through a partition is what a real
  // route looks like, and it keeps the room. Deleting the furniture is the
  // fallback, and deleting scenery outright is the last resort - doing it
  // first stripped whole banks bare.
  const CLEARABLE = ['partition', 'cubicle', 'shelf', 'desk', 'decor'];

  // Grid of what is blocked by things we are NOT allowed to move: the
  // shell, the vaults, the counters. Everything else counts as passable,
  // because we can put a doorway through it.
  function hardGrid(world) {
    const nav = world.nav;
    const hard = new Uint8Array(nav.cols * nav.rows);
    const PAD_WALL = 15, PAD_LOW = 8;
    for (const o of world.obstacles) {
      if (o.kind === 'vaultdoor' && !o.solid) continue;
      if (CLEARABLE.indexOf(o.kind) >= 0) continue;
      const PAD = o.low ? PAD_LOW : PAD_WALL;
      const x0 = Math.max(0, Math.floor((o.x - PAD) / NAV_CELL));
      const y0 = Math.max(0, Math.floor((o.y - PAD) / NAV_CELL));
      const x1 = Math.min(nav.cols - 1, Math.floor((o.x + o.w + PAD) / NAV_CELL));
      const y1 = Math.min(nav.rows - 1, Math.floor((o.y + o.h + PAD) / NAV_CELL));
      for (let cy = y0; cy <= y1; cy++)
        for (let cx = x0; cx <= x1; cx++) hard[cy * nav.cols + cx] = 1;
    }
    return hard;
  }

  // Shortest run of cells from the car to a point, ignoring anything we
  // could clear. Returns the cells, or null if even that cannot get there.
  function softRoute(world, tx, ty) {
    const nav = world.nav;
    const hard = hardGrid(world);
    const sx = Math.floor(world.car.x / NAV_CELL), sy = Math.floor(world.car.y / NAV_CELL);
    const gx = Math.floor(tx / NAV_CELL), gy = Math.floor(ty / NAV_CELL);
    if (gx < 0 || gy < 0 || gx >= nav.cols || gy >= nav.rows) return null;
    if (hard[gy * nav.cols + gx] || hard[sy * nav.cols + sx]) return null;

    const prev = new Int32Array(nav.cols * nav.rows).fill(-1);
    const seen = new Uint8Array(nav.cols * nav.rows);
    const q = [sx, sy];
    seen[sy * nav.cols + sx] = 1;
    for (let h = 0; h < q.length; h += 2) {
      const x = q[h], y = q[h + 1];
      if (x === gx && y === gy) break;
      for (let d = 0; d < 4; d++) {
        const nx = x + [1, -1, 0, 0][d], ny = y + [0, 0, 1, -1][d];
        if (nx < 0 || ny < 0 || nx >= nav.cols || ny >= nav.rows) continue;
        const i = ny * nav.cols + nx;
        if (seen[i] || hard[i]) continue;
        seen[i] = 1;
        prev[i] = y * nav.cols + x;
        q.push(nx, ny);
      }
    }
    if (!seen[gy * nav.cols + gx]) return null;

    const out = [];
    let cur = gy * nav.cols + gx;
    while (cur >= 0) { out.push(cur); cur = prev[cur]; }
    return out;
  }

  // Open a route to everything the player has to reach. Rather than
  // removing props and hoping, work out the route first and then clear
  // only what is standing on it.
  function proveRoutes(world) {
    // A drill point has to be somewhere a body can actually stand.
    world.vaults.forEach(v => {
      for (let step2 = 0; step2 < 8; step2++) {
        const cx = Math.floor(v.drillX / NAV_CELL), cy = Math.floor(v.drillY / NAV_CELL);
        if (cy >= world.nav.rows) break;
        if (!world.nav.blocked[cy * world.nav.cols + cx]) break;
        v.drillY += 10;
      }
    });

    for (let pass = 0; pass < 30; pass++) {
      const bad = unreached(world);
      if (!bad.length) return;
      const target = bad[0];

      const route = softRoute(world, target.x, target.y);
      if (!route) return;                 // sealed by something we may not move

      // Everything clearable sitting on that run has to give way.
      const nav = world.nav;
      const onRoute = new Set(route);
      const doomed = [];
      for (const o of world.obstacles) {
        if (CLEARABLE.indexOf(o.kind) < 0) continue;
        const PAD = o.low ? 8 : 15;
        const x0 = Math.max(0, Math.floor((o.x - PAD) / NAV_CELL));
        const y0 = Math.max(0, Math.floor((o.y - PAD) / NAV_CELL));
        const x1 = Math.min(nav.cols - 1, Math.floor((o.x + o.w + PAD) / NAV_CELL));
        const y1 = Math.min(nav.rows - 1, Math.floor((o.y + o.h + PAD) / NAV_CELL));
        let hits = false;
        for (let cy = y0; cy <= y1 && !hits; cy++)
          for (let cx = x0; cx <= x1; cx++) {
            if (onRoute.has(cy * nav.cols + cx)) { hits = true; break; }
          }
        if (hits) doomed.push(o);
      }
      if (!doomed.length) return;
      doomed.forEach(o => cutOrRemove(world, o));
      buildNav(world);
    }
  }

  // Cut a doorway through a long wall; take a small thing away entirely.
  function cutOrRemove(world, o) {
    const i = world.obstacles.indexOf(o);
    if (i < 0) return;
    world.obstacles.splice(i, 1);

    if (o.kind === 'partition' && Math.max(o.w, o.h) > 110) {
      const DOOR = 76;
      if (o.w > o.h) {
        const midx = o.x + o.w / 2;
        if (midx - DOOR / 2 - o.x > 24) {
          world.obstacles.push({ x: o.x, y: o.y, w: midx - DOOR / 2 - o.x,
                                 h: o.h, kind: 'partition' });
        }
        const right = midx + DOOR / 2;
        if (o.x + o.w - right > 24) {
          world.obstacles.push({ x: right, y: o.y, w: o.x + o.w - right,
                                 h: o.h, kind: 'partition' });
        }
      } else {
        const midy = o.y + o.h / 2;
        if (midy - DOOR / 2 - o.y > 24) {
          world.obstacles.push({ x: o.x, y: o.y, w: o.w,
                                 h: midy - DOOR / 2 - o.y, kind: 'partition' });
        }
        const low = midy + DOOR / 2;
        if (o.y + o.h - low > 24) {
          world.obstacles.push({ x: o.x, y: low, w: o.w,
                                 h: o.y + o.h - low, kind: 'partition' });
        }
      }
      return;
    }

    const dec = world.decor.find(d => d.solid &&
      Math.abs(d.x - (o.x + o.w / 2)) < 1 && Math.abs(d.y - (o.y + o.h / 2)) < 1);
    if (dec) world.decor.splice(world.decor.indexOf(dec), 1);
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
    a.role = pickRole(def, a.wpn);
    a.postX = x; a.postY = y;          // where an anchor is unwilling to leave
    a.flankSide = Math.random() < 0.5 ? 1 : -1;
    return a;
  }

  // ==================== HEIST START ====================
  GH.startHeist = (bankId) => {
    if (GH.audio) { GH.audio.resume(); GH.audio.music('heist'); }

    const bank = GH.bankById(bankId);
    const world = generateWorld(bank);
    const squad = GH.squad();

    // Put everyone down on ground the nav grid agrees is walkable. The
    // kerb is busy now, and a crew member spawned inside a parked car's
    // clearance can never path out of it.
    const onFoot = (x, y) => {
      const cell = nearestFree(world.nav, Math.floor(x / NAV_CELL), Math.floor(y / NAV_CELL));
      return cell ? { x: cellCentre(cell[0]), y: cellCentre(cell[1]) } : { x, y };
    };
    const spawn0 = onFoot(world.car.x, world.car.y + 46);
    const robo = makePlayerActor(GH.state.robo, spawn0.x, spawn0.y, 0);
    const crew = squad.map((c, i) => {
      const p = onFoot(world.car.x + (i - 1) * 52, world.car.y + 76);
      return makePlayerActor(c, p.x, p.y, i + 1);
    });

    H = {
      bank, world, robo, crew,
      all: [robo].concat(crew),
      enemies: [], bullets: [], particles: [], drops: [], decals: [], floats: [],
      bodies: [], civilians: [], labels: [],
      t: 0, last: performance.now(), running: true, paused: false,
      civKills: 0,
      alarm: false, alarmT: 0,
      policeLeft: bank.respond * 1000,
      zoom: clamp(GH.settings.zoom || 1, ZOOM_MIN, ZOOM_MAX),
      copsHere: false, breachLeft: bank.breach * 1000, breached: false,
      waveTimer: 0, waveNo: 0, waveGap: T.copWaveInterval,
      cam: { x: spawn0.x, y: spawn0.y, zoom: 1 },
      shake: 0,
      extracted: false, failed: false, over: false,
      banked: 0,
      killedIds: [],
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
    // A couple of them stand outside on bigger jobs - by the doors they
    // are watching. Never within opening-fire distance of the car.
    if (bank.guards >= 4) {
      const post = world.entranceX;
      [post - 120, post + 120].forEach(gx2 => {
        const x2 = clamp(gx2, 90, world.w - 90);
        if (Math.abs(x2 - world.car.x) < 360) return;    // too near the car
        H.enemies.push(makeEnemy(bank.guardWpn, x2, world.h - STREET + 60));
      });
    }
    // boss unit
    if (bank.boss) {
      const def = D.ENEMIES[bank.boss];
      let bx2, by2;
      // parked across the entrance, not across your escape
      if (def.static || def.vehicle) {
        bx2 = clamp(world.entranceX + (world.entranceX > world.car.x ? 180 : -180), 120, world.w - 120);
        by2 = world.h - STREET + 80;
      }
      else { const v = world.vaults[0]; bx2 = v.x + v.w / 2; by2 = v.y + v.h + 70; }
      const boss = makeEnemy(bank.boss, bx2, by2);
      boss.isBoss = true;
      H.enemies.push(boss);
      H.boss = boss;
    }

    GH.show('heist');
    resize();
    H.cam.x = H.robo.x;
    H.cam.y = H.robo.y;
    H.intro = makeIntro(world, bank);
    const wrap = canvas.parentElement;
    if (wrap) wrap.classList.add('is-intro');
    requestAnimationFrame(loop);
  };

  // Handle onto live mission state, for debugging and the headless
  // test harness. Read-only in practice; nothing in the game uses it.
  GH.__debug = () => H;
  GH.__mouse = () => mouse;      // tests need to point somewhere before pinging
  GH.skipIntro = () => endIntro();   // straight to the job

  function banner(text, sub) {
    H.msg = { text, sub };
    H.msgT = 2600;
  }

  // ==================== INPUT ====================
  window.addEventListener('keydown', (e) => {
    if (!H || !H.running) return;
    const k = e.key.toLowerCase();
    // Any key gets you out of the look round - including the one you were
    // about to move with, which should not also fire an action.
    if (H.intro) {
      if (k === 'tab') e.preventDefault();
      endIntro();
      return;
    }
    if (H.death) { if (H.death.t > 1200) finish(false); return; }
    keys[k] = true;
    if (k === 'escape') togglePause();
    if (k === 'f') toggleStance();
    if (k === 'e') tryInteract();
    if (k === 'r') tryReload(H.robo);
    if (k === 'q') quickMelee();
    if (k === ' ') { e.preventDefault(); tryDodge(); }
    if (k === 'g') placePing();
  });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('touchstart', () => { if (H && H.intro) endIntro(); }, { passive: true });

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (H && H.intro) { e.preventDefault(); endIntro(); return; }
    if (e.button === 0) mouse.down = true;
    if (e.button === 1) { e.preventDefault(); placePing(); }
  });
  window.addEventListener('mouseup', () => { mouse.down = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Wheel zooms. Kept on the canvas and non-passive so it does not scroll
  // the page out from under the game.
  canvas.addEventListener('wheel', (e) => {
    if (!H || !H.running) return;
    e.preventDefault();
    const step = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    H.zoom = clamp((H.zoom || 1) * step, ZOOM_MIN, ZOOM_MAX);
    GH.settings.zoom = H.zoom;                // remembered between jobs
    GH.saveSettings && GH.saveSettings();
  }, { passive: false });

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
    H.abandoned = true;
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

  // Marking is how you hand out work. It has to land on something worth
  // opening; there is no "everybody go and stand over there" any more.
  function placePing() {
    if (!H) return;
    const job = machineAt(mouse.wx, mouse.wy);
    if (!job) {
      sfxSafe.deny();
      banner('NOTHING TO CRACK THERE', 'Mark a till, a cash machine or a deposit box.');
      return;
    }
    const hand = freestCrewFor(job.obj);
    if (!hand) {
      sfxSafe.deny();
      banner('NOBODY FREE', 'Everyone is busy \u2014 do it yourself.');
      return;
    }
    hand.job = { kind: job.kind, obj: job.obj };
    sfxSafe.pickup();
    banner(hand.name.toUpperCase() + ' IS ON IT', 'Cracking the ' + job.label + '.');
    floatText(job.obj.x, job.obj.y - 34, hand.name, '#E0B44C');
  }

  // What is under the mark, if anything: a till, a machine or a box.
  function machineAt(x, y) {
    let best = null, bd = 78;
    const test = (obj, kind, label) => {
      if (obj.open) return;
      const d = Math.hypot(obj.x - x, obj.y - y);
      if (d < bd) { bd = d; best = { obj, kind, label }; }
    };
    H.world.atms.forEach(a => test(a, 'atm', 'cash machine'));
    H.world.registers.forEach(t => test(t, 'register', 'till'));
    H.world.deposits.forEach(b => test(b, 'deposit', 'deposit box'));
    // loose money on the floor can be marked too, for anything they
    // walked away from
    H.world.loot.forEach(l => {
      if (l.taken || l.locked) return;
      const d = Math.hypot(l.x - x, l.y - y);
      if (d < bd) { bd = d; best = { obj: l, kind: 'pickup', label: 'money on the floor' }; }
    });
    H.drops.forEach(dr => {
      if (dr.taken) return;
      const d = Math.hypot(dr.x - x, dr.y - y);
      if (d < bd) { bd = d; best = { obj: dr, kind: 'pickup', label: 'dropped bag' }; }
    });
    // the vault too: mark it and somebody goes and sets the drill up
    H.world.vaults.forEach(v => {
      if (v.open || v.drilling) return;
      const d = Math.hypot(v.drillX - x, v.drillY - y);
      if (d < bd) { bd = d; best = { obj: v, kind: 'vault', label: 'vault' }; }
    });
    // and anyone with a wallet worth taking
    H.civilians.forEach(civ => {
      if (civ.dead || civ.robbed) return;              // dead also means walked out
      if (civ.kind !== 'customer' || civ.wallet <= 0) return;
      const d = Math.hypot(civ.x - x, civ.y - y);
      if (d < bd) { bd = d; best = { obj: civ, kind: 'rob', label: 'customer' }; }
    });
    return best;
  }

  // Whoever is least busy, nearest first. Somebody already carrying a job
  // is not free, so a second mark goes to a second pair of hands.
  function freestCrewFor(obj) {
    let best = null, bd = 1e9;
    for (const c of H.crew) {
      if (c.dead || c.downed) continue;
      if (c.job && c.job.obj && !c.job.obj.open) continue;    // already tasked
      const d = dist(c, obj);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) return best;
    // everyone is tasked: hand it to whoever is closest anyway
    for (const c of H.crew) {
      if (c.dead || c.downed) continue;
      const d = dist(c, obj);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
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
    // set the drill up on a vault, then start it
    for (const v of H.world.vaults) {
      if (!v.open && Math.hypot(p.x - v.drillX, p.y - v.drillY) < 60) {
        if (!v.drilling) setDrill(v, p);
        return;
      }
    }
    // lift a wallet - quiet, and quicker than the vault
    if (tryRobCivilian(p, 0)) return;

    // Everything worth forcing is a hold now. p.job is whatever his hands
    // are busy with; the loop below runs it down while E is held.
    for (const b of H.world.deposits) {
      if (b.open) continue;
      if (Math.hypot(p.x - b.x, p.y - b.y) > 54) continue;
      p.job = { obj: b, kind: 'deposit' };
      return;
    }
    for (const a of H.world.atms) {
      if (a.open) continue;
      if (Math.hypot(p.x - a.x, p.y - a.y) > 56) continue;
      p.job = { obj: a, kind: 'atm' };
      p.atm = a;
      return;
    }
    for (const t of H.world.registers) {
      if (t.open) continue;
      if (Math.hypot(p.x - t.x, p.y - t.y) > 68) continue;
      p.job = { obj: t, kind: 'register' };
      return;
    }
    // grab loot
    grabNearbyLoot(p, true);
  }

  // Bolt the rig to the vault door and start it cutting. Whoever does it
  // is the one who carried it in, so a crew member can be sent to do it.
  function setDrill(v, by) {
    if (v.open || v.drilling) return;
    v.rig = true;
    v.drilling = true;
    v.drillMul = perk(by, 'drill') * trait(by, 'workRate');   // whoever set it up
    trip('drill');
    banner('DRILL IS RUNNING', by && !by.isRobo ? by.name + ' set it up. Keep it covered.'
                                                : 'Keep it covered.');
  }

  function openDeposit(b, by) {
    if (b.open) return;
    b.open = true;
    b.shake = 10;
    sfxSafe.register();
    const spot = spillSpot(b.x, b.y, Math.PI / 2, 40);
    H.world.loot.push({
      x: spot.x, y: spot.y, r: 13,
      amount: b.amount, kind: 'box', locked: false, taken: false,
      claimAt: H.t + LOOT_GRACE,
      openedBy: by && !by.isRobo ? by : null,
    });
    for (let i = 0; i < 8; i++) {
      H.particles.push({
        x: b.x, y: b.y, vx: rand(-2, 2), vy: rand(-2.6, -0.4),
        life: rand(12, 24), r: rand(1.2, 2.6),
        color: i % 2 ? 'rgba(150,200,150,0.8)' : 'rgba(200,205,215,0.6)',
      });
    }
  }

  function openATM(a, by) {
    if (a.open) return;
    a.open = true;
    a.shake = 12;
    sfxSafe.register();
    sfxSafe.glass();
    const spot = spillSpot(a.x, a.y, a.facing, 44);
    H.world.loot.push({
      x: spot.x, y: spot.y, r: 14,
      amount: a.amount, kind: 'atm', locked: false, taken: false,
      claimAt: H.t + LOOT_GRACE,
      openedBy: by && !by.isRobo ? by : null,
    });
    for (let i = 0; i < 12; i++) {
      H.particles.push({
        x: a.x, y: a.y, vx: rand(-2.6, 2.6), vy: rand(-3.2, -0.5),
        life: rand(14, 28), r: rand(1.4, 3),
        color: i % 2 ? 'rgba(150,200,150,0.85)' : 'rgba(210,215,225,0.7)',
      });
    }
    // ripping open a machine in the middle of the lobby is not subtle
    panicAll(a.x, a.y, 300, 'seen', by);
    for (const e of H.enemies) {
      if (e.dead || e.alerted) continue;
      if (dist(e, a) < 340 && hasLOS(e, a)) {
        e.suspicion = 1;
        e.lastSeen = by ? { x: by.x, y: by.y } : { x: a.x, y: a.y };
      }
    }
  }

  // loud = smashed with a weapon rather than levered open by hand.
  // `by` is whoever did it - they get first refusal on what falls out.
  function openRegister(t, loud, by) {
    // Only crew get a reservation. The player already has first refusal
    // through the grace window, and holding a pile against your own crew
    // for eight seconds after you walked off helps nobody.
    t.openedBy = by && !by.isRobo ? by : null;
    if (t.open) return;
    t.open = true;
    t.shake = 12;
    sfxSafe.register();
    if (loud) { sfxSafe.glass(); if (!H.alarm) trip('teller'); }
    // Onto the side of the counter whoever opened it is standing on. It
    // used to always go to the lobby, so forcing a till from behind the
    // counter threw the money over it and you had to walk right round.
    const at = by || H.robo;
    const cy2 = H.world.counterY;
    const fromLobby = !at || at.y > cy2;
    const sameSide = fromLobby ? (sx, sy) => sy > cy2 + 26
                               : (sx, sy) => sy < cy2 - 20;
    const spot = spillSpot(t.x, t.y, fromLobby ? Math.PI / 2 : -Math.PI / 2, 46, sameSide);
    H.world.loot.push({
      x: spot.x, y: spot.y, r: 13,
      amount: t.amount, kind: 'till', locked: false, taken: false,
      claimAt: H.t + LOOT_GRACE,
      openedBy: t.openedBy || null,       // whoever forced it gets first claim
    });
    for (let i = 0; i < 9; i++) {
      H.particles.push({
        x: t.x, y: t.y, vx: rand(-2.4, 2.4), vy: rand(-3, -0.6),
        life: rand(14, 26), r: rand(1.4, 3),
        color: i % 2 ? 'rgba(150,200,150,0.85)' : 'rgba(200,200,190,0.7)',
      });
    }
  }

  // A steady grinding while a machine is being forced, pitching up as it
  // gives way. Keyed per machine so two people working two machines do
  // not stamp on each other's timer.
  function crackNoise(o, need) {
    if (H.t < (o.noiseAt || 0)) return;
    o.noiseAt = H.t + 190;
    const done = Math.min(1, (o.prog || 0) / (need || o.needed || LO.atmDrill));
    sfxSafe.crack(done);
  }

  function grabNearbyLoot(a, manual) {
    const reach = manual ? PICKUP_REACH + 10 : PICKUP_REACH;
    let got = 0;
    for (const l of H.world.loot) {
      if (l.taken || l.locked) continue;
      if (dist(a, l) > reach) continue;
      // still the opener's, for a moment, unless they cannot come for it
      if (!manual && l.openedBy && l.openedBy !== a &&
          !l.openedBy.dead && !l.openedBy.downed &&
          l.openedBy.carryCap - l.openedBy.carried > 200 &&
          H.t < (l.claimAt || 0) + 5200) continue;
      const room = a.carryCap - a.carried;
      if (room <= 4) { if (manual) floatText(a.x, a.y - 26, 'BAG FULL', '#E0B44C'); return; }
      let take = Math.min(room, l.amount);
      a.carried += take; l.amount -= take;
      // One pickup in four pays twice for somebody lucky. The extra is
      // found money: it does not come out of the pile.
      const luck = (a.char && (D.TRAITS[a.char.trait] || {}).lootDouble) || 0;
      if (luck && Math.random() < luck) {
        const bonus = Math.min(a.carryCap - a.carried, take);
        if (bonus > 0) {
          a.carried += bonus;
          take += bonus;
          floatText(l.x, l.y - 34, 'LUCKY', '#E0B44C');
        }
      }
      got += take;
      if (l.amount <= 1) { l.taken = true; if (l.claimedBy) { l.claimedBy.claim = null; l.claimedBy = null; } }
      sfxSafe.cash();
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
      sfxSafe.pickup();
      floatText(d.x, d.y - 20, '+' + money(take), '#F5E5A0');
    }
    return got;
  }

  // ==================== ALARM ====================
  function trip(reason) {
    if (H.alarm) return;
    H.alarm = true;
    H.alarmT = H.t;
    sfxSafe.alarm();
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
      sfxSafe.melee();
      const ang = Math.atan2(targetY - a.y, targetX - a.x);
      // Only the player smashes tills with melee. Crew swinging at a guard
      // next to the counter should not quietly empty the registers for you.
      for (const t of (a.isRobo ? H.world.registers : [])) {
        if (t.open) continue;
        if (Math.hypot(a.x - t.x, a.y - t.y) > w.reach + t.r) continue;
        const da = Math.abs(normAngle(Math.atan2(t.y - a.y, t.x - a.x) - ang));
        if (da > w.arc / 2) continue;
        t.hp -= w.dmg * a.dmgMul * perk(a, 'melee'); t.shake = 8;
        // whoever smashed it gets first claim, same as levering it open
        if (t.hp <= 0) openRegister(t, false, a.isRobo ? null : a);   // melee stays quiet
      }
      for (const e of H.enemies) {
        if (e.dead) continue;
        if (dist(a, e) > w.reach + e.r) continue;
        const da = Math.abs(normAngle(Math.atan2(e.y - a.y, e.x - a.x) - ang));
        if (da > w.arc / 2) continue;
        const silentKill = !H.alarm && !e.alerted;
        damageEnemy(e, w.dmg * a.dmgMul * perk(a, 'melee'), a, ang);
        bloodSpray(e.x, e.y, Math.cos(ang), Math.sin(ang), 10);
        // Knock them back, but never into the scenery - shoving a body
        // inside a wall is how things end up permanently stuck.
        if (w.knockback) {
          const kx = e.x + Math.cos(ang) * w.knockback;
          const ky = e.y + Math.sin(ang) * w.knockback;
          if (!blocked(kx, e.y, e.r)) e.x = kx;
          if (!blocked(e.x, ky, e.r)) e.y = ky;
        }
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
    sfxSafe.shot(w);
    if (!w.silent) {
      // whoever fired carries their own reputation into how far it spreads
      panicAll(a.x, a.y, 520, 'seen', a);
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

  // Which reload rhythm a weapon uses. Falls back to the pistol pattern,
  // so a weapon added later still makes a sensible noise.
  const RELOAD_KIND = {
    glock: 'pistol', shotgun: 'shotgun', smg: 'rifle', rifle: 'rifle',
    lmg: 'heavy', minigun: 'heavy', rpg: 'rocket',
    pulse: 'energy', arc: 'energy', plasma: 'energy', singularity: 'energy',
  };

  // What an actor's mask is worth for a given perk. Actors carry their
  // character sheet, so this is the same number the crew screen shows.
  function perk(a, kind) {
    return a && a.char ? GH.maskPerk(a.char, kind) : 1;
  }

  // What their character is worth for a given knack. Traits and masks
  // stack: a quick pair of hands in a ski mask is quicker still.
  function trait(a, key) {
    const t = a && a.char ? (D.TRAITS[a.char.trait] || {}) : {};
    return t[key] == null ? 1 : t[key];
  }

  // Is there somebody standing between this crew member and what they
  // are aiming at? People flat on the floor do not count: rounds go over
  // the top of them, which is the point of getting down.
  function civilianInLine(from, tx, ty) {
    const dx = tx - from.x, dy = ty - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len, ny = dy / len;
    for (let i = 0; i < H.civilians.length; i++) {
      const c = H.civilians[i];
      if (c.dead || c.prone) continue;
      const rx = c.x - from.x, ry = c.y - from.y;
      const along = rx * nx + ry * ny;
      if (along < 12 || along > len) continue;          // behind them, or past the target
      const off = Math.abs(rx * ny - ry * nx);
      if (off < c.r + 9) return c;
    }
    return null;
  }

  // Somewhere to stand that opens the shot up. A short sidestep, either
  // way, whichever one is clear.
  function stepOffTheLine(c, tx, ty, speed, dt) {
    const ang = Math.atan2(ty - c.y, tx - c.x) + Math.PI / 2;
    const side = c.lineSide || (c.lineSide = Math.random() < 0.5 ? 1 : -1);
    for (const dir of [side, -side]) {
      const sx = c.x + Math.cos(ang) * dir * 46;
      const sy = c.y + Math.sin(ang) * dir * 46;
      if (blocked(sx, sy, c.r)) continue;
      if (civilianInLine({ x: sx, y: sy }, tx, ty)) continue;
      moveActor(c, Math.cos(ang) * dir * speed, Math.sin(ang) * dir * speed, dt);
      return true;
    }
    c.lineSide = -side;                                 // try the other way next time
    return false;
  }

  function tryReload(a) {
    const w = D.WEAPONS[a.weapon];
    if (!w.mag || a.reloading > 0 || a.mag === w.mag) return;
    const time = w.reload * (a.trait && a.trait.reloadRate ? a.trait.reloadRate : 1);
    a.reloading = time;
    a.reloadFor = time;                    // for the spinner over their head
    sfxSafe.reload(RELOAD_KIND[a.weapon]);
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
    if (src) bloodSpray(e.x, e.y, e.x - src.x, e.y - src.y, Math.min(9, 3 + d / 12));
    e.bleed = Math.max(e.bleed || 0, 5200);
    e.alerted = true;
    sfxSafe.hit((e.dr || 0) > 0.15);
    spark(e.x, e.y, 4);
    if (e.hp <= 0) {
      e.dead = true;
      if (src && src.side === 'crew') { src.kills = (src.kills || 0) + 1; GH.state.stats.kills++; }
      spark(e.x, e.y, 12);
      bloodSpray(e.x, e.y, rand(-1, 1), rand(-1, 1), 16);
      bloodPool(e.x, e.y, e.r * 0.9);
      // A body on the floor is evidence. Anyone who walks past it reacts -
      // and it stays there for the rest of the job.
      layBody(e, e.def && e.def.vehicle ? 'wreck' : 'cop');
      if (e.isBoss) banner(e.name + ' IS DOWN', 'Keep moving.');
    } else {
      // Survived it - they shout, and they get on the radio.
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
      o.draw = o.drawMax = o.wpn.melee ? 260 : 520;
      o.lastSeen = from.lastSeen || { x: from.x, y: from.y };
      if (o.radio == null || o.radio > 1400) o.radio = 1400;
    }
  }

  function damageActor(a, dmg, fromX, fromY) {
    if (a.downed || a.dead) return;
    if (a.iframes > 0) return;
    const armor = D.ARMOR[a.char.armor] || D.ARMOR.none;
    // A hard-shelled mask is armour as much as disguise.
    let d = dmg * (1 - (armor.dr || 0)) * perk(a, 'tough') * trait(a, 'hurtMul');
    if (armor.frontal && fromX != null) {
      const toward = Math.atan2(fromY - a.y, fromX - a.x);
      if (Math.abs(normAngle(toward - a.angle)) < Math.PI * 0.45) d *= (1 - armor.frontal);
    }
    a.hp -= d;
    a.hitFlash = 10;
    a.regen = 0;
    sfxSafe.hurt();
    if (fromX != null) bloodSpray(a.x, a.y, a.x - fromX, a.y - fromY, Math.min(9, 3 + d / 10));
    a.bleed = Math.max(a.bleed || 0, 6000);
    if (GH.settings.shake && a.isRobo) H.shake = Math.max(H.shake, 4);
    if (a.hp <= 0) {
      goDown(a);
    }
  }

  // Record somebody where they fell, with enough of their look to draw
  // them. `seen` is the evidence flag the AI already used this list for.
  function layBody(a, kind) {
    H.bodies.push({
      x: a.x, y: a.y, seen: false, kind,
      angle: (a.angle || 0) + rand(-0.6, 0.6),
      skin: a.skin || '#C79B76',
      hair: a.hair || '#3A2A20',
      outfit: a.outfit || (a.def && a.def.body) || '#3A4250',
      accent: (a.def && a.def.accent) || null,
      mask: a.char ? a.char.mask : null,
      big: !!(a.def && a.def.r > 18),
      t: H.t,
    });
  }

  function goDown(a) {
    a.hp = 0;
    a.downed = true;
    bloodSpray(a.x, a.y, rand(-1, 1), rand(-1, 1), 14);
    bloodPool(a.x, a.y, a.r * 0.95);
    a.bleed = 9000;
    a.downTimer = a.isRobo ? T.roboSelfRevive : T.downedBleedout;
    sfxSafe.down();
    // Whatever they were hauling hits the floor as a grabbable bag.
    if (a.carried > 0) {
      H.drops.push({ x: a.x, y: a.y, r: 18, amount: a.carried, taken: false, name: a.name });
      a.carried = 0;
    }
    banner(a.name + ' IS DOWN', a.isRobo ? 'Get up, or that is the job.' : 'Stand them up with E.');
  }

  // ==================== EXPLOSIONS ====================
  function explode(x, y, radius, dmg, src) {
    sfxSafe.boom();
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
    H.world.obIndex = null;         // the door stopped blocking; reindex
    v.door.open = true;
    H.world.navDirty = true;      // the vault is a doorway now
    H.world.loot.forEach(l => { if (l.kind === 'vault' && l.vaultId === v.id) l.locked = false; });
    banner('VAULT IS OPEN', money(v.cash) + ' in there. Fill the bags.');
    sfxSafe.revive();
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
        // facing matters - a guard notices what is in front of him faster
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
        e.draw = e.drawMax = e.wpn.melee ? 260 : 520;   // time spent pulling the weapon
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
    // How close this one wants to be depends on how it fights. A room full
    // of hostiles all wanting the same 330px was why they arrived as one
    // crowd, every time.
    const roleRange = ROLE_RANGE[e.role] || 0.62;
    const wantRange = wpn.melee ? wpn.reach - 6
                                : clamp(wpn.range * roleRange, 90, 420);

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
        // Each officer takes their own lane through the doorway instead of
        // queueing on one pixel, which is what made them file in nose to
        // tail. They also stage a moment before going in.
        if (e.lane == null) e.lane = (Math.random() * 2 - 1) * (dr.w * 0.34);
        goal = { x: dr.x + dr.w / 2 + e.lane, y: dr.y - 30 };
      } else if (!outside) {
        // What they do with the space between them and you depends on the
        // sort of fighter they are.
        if (e.role === 'anchor') {
          // Holds his post: takes the best cover near it and shoots from
          // there. But he will not stand in an empty back room forever
          // while the front of the building is being robbed - if nothing
          // has come near him for a while, he gives up the post for good
          // and goes to find the fight.
          if (!los && d > 600 && (e.searchT || 0) > 9000) {
            e.role = 'hold';
          } else {
            const spot = coverNear(e, goal);
            const post = { x: e.postX, y: e.postY };
            const far = Math.hypot(e.x - post.x, e.y - post.y);
            if (spot && Math.hypot(spot.x - post.x, spot.y - post.y) < 240) goal = spot;
            else if (far > 210) goal = post;
            else goal = { x: e.x, y: e.y };          // stand your ground
          }
        }
        if (e.role === 'flank' && los && d < wpn.range * 1.1) {
          // Come at it from the side rather than straight up the middle.
          const toE = Math.atan2(e.y - goal.y, e.x - goal.x);
          const off = toE + e.flankSide * 1.15;
          goal = {
            x: goal.x + Math.cos(off) * wantRange,
            y: goal.y + Math.sin(off) * wantRange,
          };
        } else if (e.role !== 'anchor' && los && d < wantRange * 1.4) {
          const spot = coverNear(e, goal);
          if (spot) goal = spot;
        }
      }
      const holdingBack = e.role === 'hold' || e.role === 'anchor';
      if (d > wantRange || !los) {
        // route around walls instead of pressing into them
        navigateTo(e, goal.x, goal.y, sp * (holdingBack ? 0.82 : 1), dt);
      } else if (los && !wpn.melee && d < wantRange * (holdingBack ? 0.85 : 0.55)) {
        // Too close for comfort: give ground rather than trade at arm's
        // length. The ones who hold do this a lot sooner.
        const ang = Math.atan2(goal.y - e.y, goal.x - e.x);
        moveActor(e, -Math.cos(ang) * sp * 0.6, -Math.sin(ang) * sp * 0.6, dt);
      } else if (los) {
        // In contact: sidestep along the firing line rather than standing
        // still. Each one drifts on its own phase so they do not sync up.
        const ang = Math.atan2(tgt.y - e.y, tgt.x - e.x) + Math.PI / 2;
        const drift = Math.sin((H.t + (e.seed || 0)) / 760) * 0.8;
        moveActor(e, Math.cos(ang) * sp * drift, Math.sin(ang) * sp * drift, dt);
      }
      separate(e, H.enemies, e.r * 3.0, 0.42, dt);
      // and push through the people in the room rather than into them
      shoveAside(e, H.civilians, dt);
    }

    // shooting
    e.cd -= dt;
    if (los && d < wpn.range && e.cd <= 0 && !(e.draw > 0)) {
      if (wpn.melee) {
        if (d < wpn.reach + tgt.r) {
          e.cd = wpn.cd;
          e.swing = 220;
          sfxSafe.melee();
          damageActor(tgt, wpn.dmg, e.x, e.y);
        } else e.cd = 120;
      } else {
        if (e.burstLeft <= 0) { e.burstLeft = wpn.burst || 1; }
        e.burstLeft--;
        e.cd = e.burstLeft > 0 ? Math.max(60, wpn.cd * 0.34) : wpn.cd;
        const base = Math.atan2(tgt.y - e.y, tgt.x - e.x);
        // Anyone frightening within arm's reach of this shot widens it.
        let fear = 1;
        for (const a of H.all) {
          if (a.dead || a.downed) continue;
          const fm = perk(a, 'fear');
          if (fm > fear && dist(a, e) < 260) fear = fm;
        }
        const sp2 = (wpn.spread || 0.01) * fear;
        for (let i = 0; i < (wpn.pellets || 1); i++) {
          const ang = base + rand(-sp2, sp2);
          H.bullets.push({
            x: e.x + Math.cos(base) * (e.r + 8), y: e.y + Math.sin(base) * (e.r + 8),
            vx: Math.cos(ang) * wpn.speed, vy: Math.sin(ang) * wpn.speed,
            dmg: wpn.dmg, life: wpn.range / wpn.speed,
            side: 'foe', owner: e, w: { kind: 'e' }, color: '#FF9B6B',
            splash: wpn.splash || 0,
          });
        }
        e.muzzle = 70;
        sfxSafe.shot({ kind: e.key === 'nest' ? 'lmg' : 'pistol' });
      }
    }
  }

  // Nearest bit of low cover that still faces the threat. Cached briefly,
  // because scanning the prop list every frame for every officer is waste.
  // How this one fights. Decided once, when they are made, so a guard
  // does not change his mind about who he is halfway through a gunfight.
  //
  //   hold   : stays back at his weapon's range, works cover, gives ground
  //   anchor : does not leave his post; takes cover near it and shoots
  //   flank  : works round to one side before engaging
  //   push   : closes. The only ones who charge, and there are few.
  function pickRole(def, wpn) {
    if (wpn && wpn.melee) return 'push';        // a baton has no other option
    if (def && (def.static || def.vehicle)) return 'anchor';
    const r = Math.random();
    if (r < 0.42) return 'hold';
    if (r < 0.70) return 'anchor';
    if (r < 0.88) return 'flank';
    return 'push';
  }

  // The distance this one wants to fight at, as a fraction of its range.
  const ROLE_RANGE = { hold: 0.82, anchor: 0.80, flank: 0.66, push: 0.40 };

  function coverNear(e, threat) {
    if (e.coverAt && H.t - e.coverAt < 2200 && e.cover) return e.cover;
    e.coverAt = H.t;
    e.cover = null;
    let best = null, bestScore = 1e9;
    for (const o of H.world.obstacles) {
      if (!o.low) continue;
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      const d = Math.hypot(cx - e.x, cy - e.y);
      if (d > 340) continue;
      // stand on the far side of it from whoever is shooting
      const ang = Math.atan2(cy - threat.y, cx - threat.x);
      const sx = cx + Math.cos(ang) * 26;
      const sy = cy + Math.sin(ang) * 26;
      if (navBlockedAt(H.world.nav, sx, sy)) continue;
      // prefer close cover, and cover that is not already crowded
      let taken = 0;
      for (const o2 of H.enemies) {
        if (o2 === e || o2.dead) continue;
        if (Math.hypot(o2.x - sx, o2.y - sy) < 46) taken++;
      }
      const score = d + taken * 150;
      if (score < bestScore) { bestScore = score; best = { x: sx, y: sy }; }
    }
    e.cover = best;
    return best;
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
    // reached it (or gave up) - pick somewhere new next tick
    if (Math.hypot(e.patrolTo.x - e.x, e.patrolTo.y - e.y) < 30) e.repathe = 0;
  }

  // Idle behaviour. Somebody waiting on a job does not stand to attention:
  // they shift about a bit and keep an eye on the room. Each crew member
  // gets their own timing so they never move in unison.
  function idleAbout(c, anchorX, anchorY, speed, dt) {
    if (c.seed == null) c.seed = Math.random() * 1000;
    c.idleT = (c.idleT || 0) - dt;

    if (!c.idle || c.idleT <= 0) {
      c.idleT = rand(3200, 7000);
      const r = rand(10, 34);
      const a = rand(0, Math.PI * 2);
      c.idle = { x: anchorX + Math.cos(a) * r, y: anchorY + Math.sin(a) * r };
      // pick something to look at: a teammate, a body, or just the room
      const pool = H.all.filter(o => o !== c && !o.dead)
        .concat(H.civilians.filter(o => !o.dead));
      c.lookAt = (pool.length && Math.random() < 0.35)
        ? pool[Math.floor(Math.random() * pool.length)]
        : null;
      c.lookAngle = rand(0, Math.PI * 2);
    }

    const d = Math.hypot(c.idle.x - c.x, c.idle.y - c.y);
    if (d > 10) {
      // Walking: face the way you are walking. Anything else reads as a
      // person sliding sideways, which is what looked so wrong before.
      const ang = Math.atan2(c.idle.y - c.y, c.idle.x - c.x);
      moveActor(c, Math.cos(ang) * speed * 0.30, Math.sin(ang) * speed * 0.30, dt);
      c.angle = lerp(c.angle, ang, 0.12);
    } else {
      // Standing: now they can look about, slowly, and only occasionally.
      c.walkPhase += dt * 0.0012;
      const want = c.lookAt && !c.lookAt.dead
        ? Math.atan2(c.lookAt.y - c.y, c.lookAt.x - c.x)
        : c.lookAngle;
      c.angle = lerp(c.angle, want, 0.022);
    }
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
        layBody(c, 'crew');
        H.killedIds.push(c.char.id);
        banner(c.name + ' DIDN\u2019T MAKE IT', 'That one is permanent.');
      }
      return;
    }

    const p = H.robo;
    const w = D.WEAPONS[c.weapon];
    const speed = 2.1 * c.moveMul;

    if (c.reloading > 0) {
      c.reloading -= dt;
      if (c.reloading <= 0) c.mag = w.mag;      // the magazine actually goes in
    }
    if (c.heat > 0) c.heat = Math.max(0, c.heat - (w.cool || 2) * dt / 1000);
    c.cd -= dt;

    // ---------- 1. pick a threat ----------
    // While nothing has kicked off, the crew do not start anything. They
    // will defend themselves against someone already coming for them, but
    // they will not sprint across the car park at a guard on sight.
    const quiet = !H.alarm;
    let foe = null, fd = 1e9;
    for (const e of H.enemies) {
      if (e.dead) continue;
      const d = dist(c, e);
      const range = quiet ? 150 : 480;          // quiet: only what is on top of them
      if (quiet && !e.alerted) continue;        // and only if it has noticed them
      if (d < fd && d < range && hasLOS(c, e)) { fd = d; foe = e; }
    }
    // ---------- 1b. a job they were given ----------
    // Marked on a till or a machine: go and open it. This outranks the
    // plain move order and everything below it short of being shot at.
    if (c.job && c.job.obj) {
      const o = c.job.obj;
      const isVault = c.job.kind === 'vault';
      const isRob = c.job.kind === 'rob';
      const isPickup = c.job.kind === 'pickup';

      // Forcing something is only half of it: whatever falls out is what
      // they were sent for. When a till or a machine gives, the job turns
      // into collecting what came out of it.
      if (!isPickup && !isVault && !isRob && o.open && !c.job.collected) {
        const spill = H.world.loot.find(l => !l.taken && !l.locked &&
          Math.hypot(l.x - o.x, l.y - o.y) < 120);
        if (spill) {
          c.job = { kind: 'pickup', obj: spill, collected: true };
          return;
        }
      }

      const finished = isPickup ? (o.taken || o.amount <= 1)
                     : o.open || (isVault && o.drilling) ||
                       (isRob && (o.robbed || o.wallet <= 0));
      const lost = (isRob && o.dead) ||
                   (isPickup && c.carryCap - c.carried <= 200);   // nothing left to fill
      if (finished || lost) { c.job = null; }
      else {
        // Being shot at pauses a job, it does not cancel one. They deal
        // with whoever is on them and then go back to it.
        if (foe && fd < 190) {
          c.state = 'engage';
          c.angle = lerp(c.angle, Math.atan2(foe.y - c.y, foe.x - c.x), 0.22);
          if (w.mag && c.mag <= 0) tryReload(c);
          else fire(c, foe.x, foe.y);
          separate(c, H.all, c.r * 3.0, 0.45, dt);
          grabNearbyLoot(c, false);
          return;
        }

        c.state = isPickup ? 'collect' : 'crack';
        const reach = isPickup ? PICKUP_REACH - 6
                    : isVault ? 56 : (isRob ? 40 : (c.job.kind === 'register' ? 60 : 50));
        const tx = isVault ? o.drillX : o.x, ty = isVault ? o.drillY : o.y;
        const d = Math.hypot(tx - c.x, ty - c.y);
        if (d > reach) {
          navigateTo(c, tx, ty, speed * 1.1, dt);
        } else {
          c.angle = lerp(c.angle, Math.atan2(ty - c.y, tx - c.x), 0.18);
          if (isPickup) grabNearbyLoot(c, true);
          else if (isVault) setDrill(o, c);
          else if (isRob) robCivilian(c, o, dt);
          else {
            // Tills, boxes and machines are all holds; only the length
            // differs, and their own hands decide how fast it goes.
            const need = c.job.kind === 'atm' ? LO.atmDrill
                       : c.job.kind === 'register' ? LO.registerPry : LO.boxPry;
            o.prog = (o.prog || 0) + dt * perk(c, 'crack') * trait(c, 'workRate');
            o.shake = 4;
            o.needed = need;
            crackNoise(o, need);
            if (o.prog >= need) {
              if (c.job.kind === 'atm') openATM(o, c);
              else if (c.job.kind === 'register') openRegister(o, false, c);
              else openDeposit(o, c);
            }
          }
        }
        if (foe && fd < (w.range || w.reach + 20)) {
          if (w.mag && c.mag <= 0) tryReload(c);
          else fire(c, foe.x, foe.y);
        }
        separate(c, H.all, c.r * 3.0, 0.45, dt);
        grabNearbyLoot(c, false);
        return;
      }
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
      c.holdX = c.holdY = null;
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

      // Anybody standing in the way and they hold, and move to where they
      // have a shot instead of taking it through a hostage.
      const blockedBy = w.kind === 'melee' ? null : civilianInLine(c, foe.x, foe.y);
      if (blockedBy) {
        c.state = 'noshot';
        if (!stepOffTheLine(c, foe.x, foe.y, speed, dt)) {
          // nowhere to go: back off rather than fire through them
          const ang = Math.atan2(foe.y - c.y, foe.x - c.x);
          moveActor(c, -Math.cos(ang) * speed * 0.5, -Math.sin(ang) * speed * 0.5, dt);
        }
        if (w.mag && c.mag < w.mag) tryReload(c);
        separate(c, H.all, c.r * 4.0, 0.55, dt);
        grabNearbyLoot(c, false);
        return;
      }

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
        if (c.reviveProg > T.reviveTime * trait(c, 'reviveRate')) {
          rescue.downed = false;
          rescue.hp = rescue.maxHp * 0.5;
          c.reviveProg = 0;
          sfxSafe.revive();
          banner(rescue.name + ' IS UP', c.name + ' got them.');
        }
      } else c.reviveProg = 0;

    } else {
      // ---------- idle: go earn your cut ----------
      const room = c.carryCap - c.carried > 200;
      let target = null, td = c.stance === 'hold' ? 220 : 460;

      if (room) {
        const consider = (l) => {
          if (l.taken) return;
          if (l.locked) return;
          // fresh out of a till or a machine: the player gets first refusal
          if (l.claimAt && H.t < l.claimAt) return;
          // The person who forced it open gets it, so long as they are
          // still standing and still have room. Nobody else walks in on
          // a till somebody else just did the work on.
          if (l.openedBy && l.openedBy !== c &&
              !l.openedBy.dead && !l.openedBy.downed &&
              l.openedBy.carryCap - l.openedBy.carried > 200 &&
              H.t < (l.claimAt || 0) + 5200) return;

          // One earner per pile. But a claim is not a deed: if somebody
          // else ends up clearly nearer, they take it over rather than the
          // pair of them crossing the room past each other.
          const holder = l.claimedBy;
          if (holder && holder !== c && !holder.dead && !holder.downed) {
            if (holder.carryCap - holder.carried <= 200) {
              // their bag is full, so it is going spare anyway
            } else if (dist(c, l) > dist(holder, l) - 70) {
              return;                          // not clearly nearer: leave it
            }
          }
          const d = dist(c, l);
          if (d < td) { td = d; target = l; }
        };
        H.world.loot.forEach(consider);
        H.drops.forEach(consider);
      }

      // release anything this crew member was going for but no longer is
      if (c.claim && c.claim !== target) { c.claim.claimedBy = null; c.claim = null; }
      if (target) {
        // taking it off somebody else: let them go and find another
        if (target.claimedBy && target.claimedBy !== c) target.claimedBy.claim = null;
        target.claimedBy = c;
        c.claim = target;
      }

      if (target) {
        c.state = 'loot';
        // Stop as soon as it is in reach. Walking the last few pixels into
        // a pile half-tucked behind a counter is how they used to end up
        // grinding against a wall forever.
        if (dist(c, target) > PICKUP_REACH - 6) navigateTo(c, target.x, target.y, speed, dt);
        c.angle = lerp(c.angle, Math.atan2(target.y - c.y, target.x - c.x), 0.14);
      } else if (c.stance === 'follow') {
        c.state = 'follow';
        // loose formation, offset behind RoboKyle rather than on top of him
        // Well back and well apart, so the player can always see himself
        // and what he is standing on.
        const off = [[-132, 110], [132, 110], [0, 168]][c.slot - 1] || [0, 140];
        let tx = p.x + off[0], ty = p.y + off[1];
        // A formation slot can land inside a wall, and in a corridor the
        // wide spacing does not fit at all. Tuck in toward the player
        // before giving up and snapping to whatever ground is nearest -
        // trailing him down a hallway is what you want there anyway.
        if (navBlockedAt(H.world.nav, tx, ty)) {
          let found = false;
          for (const squeeze of [0.7, 0.45, 0.25]) {
            const sx2 = p.x + off[0] * squeeze, sy2 = p.y + off[1] * squeeze;
            if (!navBlockedAt(H.world.nav, sx2, sy2)) {
              tx = sx2; ty = sy2; found = true; break;
            }
          }
          if (!found) {
            const cell = nearestFree(H.world.nav, Math.floor(tx / NAV_CELL), Math.floor(ty / NAV_CELL));
            if (cell) { tx = cellCentre(cell[0]); ty = cellCentre(cell[1]); }
          }
        }
        const d = Math.hypot(tx - c.x, ty - c.y);
        if (d > 68) {
          navigateTo(c, tx, ty, clamp(d / 55, 0.7, 1) * speed, dt);
          c.angle = lerp(c.angle, Math.atan2(ty - c.y, tx - c.x), 0.14);
          c.idle = null;
        } else {
          idleAbout(c, tx, ty, speed, dt);
        }
      } else {
        c.state = 'hold';
        idleAbout(c, c.holdX == null ? c.x : c.holdX, c.holdY == null ? c.y : c.holdY, speed, dt);
        if (c.holdX == null) { c.holdX = c.x; c.holdY = c.y; }
      }

      if (w.mag && c.mag < w.mag) tryReload(c);
    }

    // never bunch up on each other or on RoboKyle
    separate(c, H.all, c.r * 4.0, 0.55, dt);

    // whatever they are doing, they hoover up cash they walk over
    grabNearbyLoot(c, false);
  }

  // ==================== CIVILIANS ====================
  // Tellers behind the counter, customers in the lobby. They are not
  // targets - they are pressure. They scream, they run for the door, and
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
      // How they take it when it goes off. Staff always comply; among
      // customers it is close to a coin toss, which is what stops every
      // job looking like the same stampede for the door.
      nerve: kind === 'teller' ? 'freeze' : (Math.random() < 0.55 ? 'freeze' : 'run'),
      hp: 30, dead: false, downed: false, side: 'civ',
      walkPhase: 0, hitFlash: 0,
      panic: 0,                   // 0..1
      robbed: false, robProg: 0,
      // Only customers have pockets worth going through. Staff are behind
      // the counter with a till, not a wallet.
      wallet: kind === 'customer' ? Math.round(rand(LO.walletMin, LO.walletMax)) : 0,
      callT: rand(9000, 15000),   // time to reach a phone once panicking
      idleT: rand(1200, 4000),
      screamed: false,
      name: pick(CIV_FIRST),
      skin: pick(D.SKIN_TONES),
      outfit: kind === 'teller' ? '#D7DFE8' : pick(D.OUTFITS).color,
      seed: Math.random() * 1000,
    };
  }

  function spawnCivilians(world, bank) {
    const list = [];
    // one teller per till, standing on the staff side of the counter
    world.registers.forEach((t, i) => {
      if (i % 2 && world.registers.length > 4) return;   // not every till is staffed
      list.push(makeCivilian('teller', t.x + rand(-6, 6), t.y - 44));
    });
    // Customers, each queueing for something. Nobody is here for a stroll.
    const custs = clamp(2 + Math.round(bank.guards * 0.8), 3, 9);
    const queues = world.queues || [];
    const used = queues.map(() => 0);
    for (let i = 0; i < custs; i++) {
      if (!queues.length) break;
      // pick the shortest queue so the lines fill evenly
      let qi = 0;
      for (let k = 1; k < queues.length; k++) if (used[k] < used[qi]) qi = k;
      const q = queues[qi];
      const place = used[qi]++;
      if (place >= q.spots.length) continue;
      const spot = q.spots[place];
      const c = makeCivilian('customer', spot.x, spot.y);
      c.queue = qi;
      c.place = place;
      c.business = rand(4000, 11000);      // how long their errand takes
      c.angle = Math.atan2(q.y - spot.y, q.x - spot.x);
      list.push(c);
    }
    return list;
  }

  function scare(c, why, by) {
    if (c.dead) return;
    c.panic = 1;
    if (c.state === 'idle') c.state = 'scared';
    if (!c.screamed) {
      c.screamed = true;
      sfxSafe.scream();
    }
    // Staff are trained to comply: hands up, stay put.
    if (c.kind === 'teller') { c.state = 'cower'; c.handsUp = true; return; }
    if (why !== 'seen' && why !== 'alarm') return;

    // Customers split by nerve. Runners make for the door; the rest go
    // down where they stand. Somebody frightening enough standing over
    // you settles the question either way.
    if (c.nerve === 'freeze' || scariestNear(c) > 1) {
      c.state = 'cower';
      c.handsUp = true;
      // About half of those get right down on their front rather than
      // standing with their hands up. Out of the way, and out of the
      // line of fire.
      if (c.prone == null) c.prone = Math.random() < 0.5;
      return;
    }
    c.state = 'flee';
  }

  // The strongest 'cow' perk worn by anyone close enough to be the reason
  // this person is frightened.
  function scariestNear(c) {
    let worst = 1;
    for (const a of H.all) {
      if (a.dead || a.downed) continue;
      // Far enough to cover a room: a mask only works on people who can
      // see it, but 300px did not reach the far side of a banking hall.
      const v = perk(a, 'cow');
      if (v > worst && dist(a, c) < 520) worst = v;
    }
    return worst;
  }

  function panicAll(x, y, radius, why, by) {
    // A quiet worker frightens a smaller circle of people.
    const r = radius * (by ? perk(by, 'calm') : 1);
    for (const c of H.civilians) {
      if (c.dead) continue;
      if (Math.hypot(c.x - x, c.y - y) > r) continue;
      scare(c, why, by);
    }
  }

  function stepCivilian(c, dt) {
    if (c.dead) return;
    if (c.hitFlash > 0) c.hitFlash -= dt * 0.06;

    // How much ground they covered last frame decides whether their hands
    // are up. Somebody rooted to the spot in the middle of a robbery is
    // not standing there with their arms by their sides.
    const wasX = c.x, wasY = c.y;
    if (c.panic > 0) {
      const moved = Math.hypot(c.x - (c.lastX == null ? c.x : c.lastX),
                               c.y - (c.lastY == null ? c.y : c.lastY));
      if (moved < 0.35) c.stillT = (c.stillT || 0) + dt;
      else c.stillT = 0;
      if (c.stillT > 220) c.handsUp = true;
      else if (moved > 0.9 && c.state === 'flee') c.handsUp = false;
    }
    c.lastX = wasX; c.lastY = wasY;
    // Being held up pins them briefly, then they carry on doing whatever
    // they were doing. Previously this latched and they never moved again.
    if (c.heldUp > 0) {
      c.heldUp -= dt;
      c.state = 'cower';
      if (c.heldUp <= 0) {
        // Back to whatever they were going to do anyway. This used to send
        // everyone to 'flee' regardless, which undid the whole split.
        c.state = (c.kind === 'teller' || c.nerve === 'freeze') ? 'cower'
                : (c.wasFleeing ? 'flee' : 'flee');
        if (c.state === 'cower') c.handsUp = true;
      }
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
    // Staff comply and stay put. Only customers run for the door.
    if (c.kind === 'teller' && c.state === 'flee') { c.state = 'cower'; c.handsUp = true; }

    if (c.state === 'flee') {
      // head for the front door and out onto the street
      const dr = H.world.door;
      const goal = c.y > H.world.building.y + H.world.building.h - 10
        ? { x: c.x, y: H.world.h - 60 }                   // already outside, keep going
        : { x: dr.x + dr.w / 2, y: dr.y + 40 };
      navigateTo(c, goal.x, goal.y, speed, dt);
      c.angle = lerp(c.angle, Math.atan2(goal.y - c.y, goal.x - c.x), 0.2);
      // made it out - they will be telling the police everything
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
      // idle: staff hold their post, customers wait their turn
      if (c.kind === 'teller') {
        c.angle = lerp(c.angle, Math.PI / 2, 0.04);
      } else {
        const q = H.world.queues[c.queue];
        if (!q) { c.angle = lerp(c.angle, c.angle, 0.02); }
        else {
          const spot = q.spots[Math.min(c.place, q.spots.length - 1)];
          const d = Math.hypot(spot.x - c.x, spot.y - c.y);
          if (d > 12) {
            navigateTo(c, spot.x, spot.y, speed * 0.5, dt);
            c.angle = lerp(c.angle, Math.atan2(spot.y - c.y, spot.x - c.x), 0.12);
          } else {
            // at their place: face the counter and shuffle a little
            c.angle = lerp(c.angle, Math.atan2(q.y - c.y, q.x - c.x), 0.06);
            c.walkPhase += dt * 0.0010;
            // the front of the queue is being served; when done, move up
            if (c.place === 0) {
              c.business -= dt;
              if (c.business <= 0) {
                c.business = rand(5000, 12000);
                // everyone shuffles forward one place
                H.civilians.forEach(o => {
                  if (o.kind === 'customer' && o.queue === c.queue && o.place > 0) o.place--;
                });
                c.place = q.spots.length - 1;    // back of the line again
              }
            }
          }
        }
      }
    }

    separate(c, H.civilians, c.r * 2.2, 0.3, dt);
  }

  // Robbing: hold E next to someone. Quiet, but it terrifies them, and a
  // guard who sees it will not let it go.
  // Take one named person's wallet. tryRobCivilian picks whoever is
  // closest; this is for when somebody has been told to rob THAT one.
  function robCivilian(by, target, dt) {
    if (!target || target.dead || target.robbed) return;
    target.robProg = (target.robProg || 0) + dt * perk(by, 'rob') * trait(by, 'workRate');
    scare(target, 'rob');
    target.wasFleeing = target.state === 'flee' || target.wasFleeing;
    target.state = 'cower';
    target.heldUp = 400;
    if (target.robProg > LO.walletTime) {
      target.robbed = true;
      target.robProg = 0;
      const take = Math.min(target.wallet, Math.max(0, by.carryCap - by.carried));
      if (take > 0) {
        by.carried += take;
        sfxSafe.pickup();
        floatText(target.x, target.y - 26, '+' + money(take), '#5FBF87');
      } else {
        floatText(target.x, target.y - 26, 'BAG FULL', '#E0B44C');
      }
      target.wallet = 0;
    }
  }

  function tryRobCivilian(p, dt) {
    let target = null, td = 54;
    for (const c of H.civilians) {
      if (c.dead || c.robbed) continue;
      if (c.kind !== 'customer' || c.wallet <= 0) continue;   // staff are not marks
      const d = dist(p, c);
      if (d < td) { td = d; target = c; }
    }
    if (!target) { if (p.robbing) p.robbing.robProg = 0; p.robbing = null; return false; }

    p.robbing = target;
    target.robProg += dt * perk(p, 'rob') * trait(p, 'workRate');
    scare(target, 'rob');
    // Hands up and rooted to the spot. A civilian who backs away from the
    // person robbing them makes the whole interaction impossible.
    target.wasFleeing = target.state === 'flee' || target.wasFleeing;
    target.state = 'cower';
    target.heldUp = 400;
    if (target.robProg > LO.walletTime) {
      target.robbed = true;
      target.robProg = 0;
      p.robbing = null;
      const take = Math.min(target.wallet, Math.max(0, p.carryCap - p.carried));
      if (take > 0) {
        p.carried += take;
        sfxSafe.pickup();
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

  // Face down, arms and legs out, doing exactly as they were told. Not a
  // casualty: they breathe, and they can still be gone through.
  function drawProne(c) {
    const r = c.r;
    const breathe = Math.sin(H.t / 700 + (c.seed || 0)) * 0.5;
    if (c.fallAngle == null) c.fallAngle = (c.angle || 0) + rand(-0.4, 0.4);

    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.fillStyle = 'rgba(0,0,0,0.36)';
    ctx.beginPath(); ctx.ellipse(2, 4, r * 1.5, r * 0.85, c.fallAngle, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(c.fallAngle);

    // legs, straight out behind
    ctx.strokeStyle = shade(c.outfit || '#3A4250', -0.3);
    ctx.lineWidth = r * 0.4;
    ctx.lineCap = 'round';
    for (const sp of [-0.42, 0.42]) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.1, sp * r * 0.5);
      ctx.lineTo(-r * 1.35, sp * r * 1.05);
      ctx.stroke();
    }
    ctx.fillStyle = '#15171C';
    for (const sp of [-0.42, 0.42]) {
      ctx.beginPath(); ctx.ellipse(-r * 1.4, sp * r * 1.1, 3.2, 2.4, 0, 0, Math.PI * 2); ctx.fill();
    }

    // arms out to the sides, hands open and flat
    ctx.strokeStyle = c.skin || '#C79B76';
    ctx.lineWidth = r * 0.3;
    for (const sp of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(r * 0.1, sp * r * 0.45);
      ctx.lineTo(r * 0.55, sp * r * 1.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r * 0.62, sp * r * 1.45, r * 0.17, 0, Math.PI * 2);
      ctx.fillStyle = c.skin || '#C79B76';
      ctx.fill();
    }

    // torso, rising and falling
    ctx.fillStyle = c.outfit || '#3A4250';
    ctx.strokeStyle = shade(c.outfit || '#3A4250', -0.45);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.8 + breathe * 0.3, r * 0.56 + breathe * 0.2, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    // head, turned to one side, cheek on the floor
    ctx.save();
    ctx.translate(r * 0.86, r * 0.1);
    const R = r * 0.44;
    ctx.fillStyle = c.skin || '#C79B76';
    ctx.strokeStyle = shade(c.skin || '#C79B76', -0.45);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 0, R, R * 0.92, 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c.hair || '#3A2A20';
    ctx.beginPath();
    ctx.ellipse(-R * 0.35, 0, R * 0.78, R * 0.88, 0, Math.PI * 0.4, Math.PI * 1.6);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(10,7,9,0.75)'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(R * 0.1, -R * 0.26); ctx.lineTo(R * 0.55, -R * 0.2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(R * 0.1, R * 0.3); ctx.lineTo(R * 0.55, R * 0.24); ctx.stroke();
    ctx.restore();
    ctx.restore();

    if (c.robbed) label(c.x, c.y - r - 12, 'EMPTY', '#6B7C8B', { size: 8, alpha: 0.7 });
    else if (H.robo && dist(H.robo, c) < 60 && c.wallet > 0 && !beingWorked(c)) {
      label(c.x, c.y - r - 14, 'E   TAKE WALLET', '#5FBF87', { size: 9 });
    }
  }

  function drawCivilian(c) {
    if (c.dead) return;
    if (c.prone) { drawProne(c); return; }
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
      // Bank uniform, built to be unmistakable from directly above: the
      // only pale torso in a level where every threat is dark, a slate
      // waistcoat over it, a gold name badge, and a tie down the middle.
      ctx.fillStyle = '#33404E';                            // waistcoat
      ctx.beginPath(); ctx.roundRect(-CH * 0.55, -SH * 0.80, CH * 0.72, SH * 1.60, 2.5); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-CH * 0.55, -SH * 0.80, CH * 1.35, SH * 0.34, 2.5); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-CH * 0.55,  SH * 0.46, CH * 1.35, SH * 0.34, 2.5); ctx.fill();
      // tie
      ctx.fillStyle = '#1F6E7A';
      ctx.beginPath(); ctx.roundRect(CH * 0.45, -SH * 0.16, CH * 0.55, SH * 0.32, 1.5); ctx.fill();
      // collar points
      ctx.fillStyle = '#F3F7FA';
      ctx.beginPath();
      ctx.moveTo(CH * 0.30, -SH * 0.34); ctx.lineTo(CH * 0.92, -SH * 0.06);
      ctx.lineTo(CH * 0.30, -SH * 0.02); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(CH * 0.30,  SH * 0.34); ctx.lineTo(CH * 0.92,  SH * 0.06);
      ctx.lineTo(CH * 0.30,  SH * 0.02); ctx.closePath(); ctx.fill();
      // gold name badge
      ctx.fillStyle = '#E0B44C';
      ctx.beginPath(); ctx.roundRect(-CH * 0.15, -SH * 0.52, 4.6, 2.6, 0.8); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(-CH * 0.15 + 0.8, -SH * 0.52 + 0.9, 3, 0.7);
    }

    // ---- arms ----
    const up = c.state === 'cower' || c.state === 'scared' || c.handsUp;
    const armSwing = up ? 0 : Math.sin(c.walkPhase) * 2.2;
    // a small nervous tremble while they are held up
    const shake = up ? Math.sin(H.t / 90 + c.seed) * 0.5 : 0;
    const raised = [];

    ctx.lineCap = 'round';
    [1, -1].forEach(function (side) {
      const shoulderY = side * SH * 0.72;

      if (up) {
        // Elbow stays tucked beside the shoulder; the forearm comes back
        // toward the head, because from above a raised arm foreshortens
        // almost to nothing. The hands end up level with the head.
        const elbowX = -CH * 0.10;
        const elbowY = side * SH * 1.02;
        const handX  = CH * 0.60 + shake;
        const handY  = side * SH * 0.44;

        ctx.strokeStyle = c.outfit;
        ctx.lineWidth = 5.6;
        ctx.beginPath();
        ctx.moveTo(-1, shoulderY);
        ctx.lineTo(elbowX, elbowY);
        ctx.stroke();

        ctx.strokeStyle = shade(c.skin, -0.12);   // forearm, shaded: it is
        ctx.lineWidth = 4.8;                      // angled away from us
        ctx.beginPath();
        ctx.moveTo(elbowX, elbowY);
        ctx.lineTo(handX, handY);
        ctx.stroke();

        raised.push({ x: handX, y: handY });
      } else {
        const elbowX = CH * 0.35;
        const elbowY = side * SH * 0.85 + armSwing * side;
        const handX  = CH * 0.55;
        const handY  = side * SH * 0.78 + armSwing * side;

        ctx.strokeStyle = c.outfit;
        ctx.lineWidth = 5.4;
        ctx.beginPath();
        ctx.moveTo(-1, shoulderY);
        ctx.lineTo(elbowX, elbowY);
        ctx.stroke();

        ctx.strokeStyle = c.skin;
        ctx.lineWidth = 4.6;
        ctx.beginPath();
        ctx.moveTo(elbowX, elbowY);
        ctx.lineTo(handX, handY);
        ctx.stroke();

        ctx.fillStyle = c.skin;
        ctx.beginPath();
        ctx.arc(handX, handY, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.lineCap = 'butt';

    // head
    ctx.fillStyle = c.skin;
    ctx.strokeStyle = shade(c.skin, -0.4); ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(CH * 0.5, 0, c.r * 0.46, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    if (c.kind === 'teller') {
      // headset - band across the crown, earpiece, and a mic on a boom
      const hx = CH * 0.5, hr = c.r * 0.46;
      ctx.strokeStyle = '#20262E'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(hx, 0, hr * 1.05, -Math.PI * 0.62, Math.PI * 0.62); ctx.stroke();
      ctx.fillStyle = '#20262E';
      ctx.beginPath(); ctx.ellipse(hx - hr * 0.1, -hr * 1.05, 1.9, 1.3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(hx - hr * 0.1,  hr * 1.05, 1.9, 1.3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#2C343E'; ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(hx - hr * 0.1, hr * 1.0);
      ctx.quadraticCurveTo(hx + hr * 1.5, hr * 0.9, hx + hr * 1.5, hr * 0.15);
      ctx.stroke();
      ctx.fillStyle = '#3E4954';
      ctx.beginPath(); ctx.arc(hx + hr * 1.5, hr * 0.1, 1.1, 0, Math.PI * 2); ctx.fill();
    }
    // a suggestion of hair so they are not featureless
    ctx.fillStyle = shade(c.skin, -0.5);
    ctx.beginPath();
    ctx.arc(CH * 0.5 - 1.4, 0, c.r * 0.44, Math.PI * 0.45, Math.PI * 1.55);
    ctx.closePath(); ctx.fill();

    // Hands last, drawn over everything else. From straight above, the
    // only cue that something is raised is that it occludes what is below
    // it and casts a shadow onto it - so the palms overlap the head and
    // sit on their own drop shadow. Everything scales off c.r.
    const hr = c.r * 0.30;                       // palm radius
    raised.forEach(function (h) {
      ctx.fillStyle = 'rgba(0,0,0,0.34)';        // shadow cast down
      ctx.beginPath();
      ctx.ellipse(h.x - hr * 0.45, h.y + hr * 0.5, hr * 1.02, hr * 0.88, 0, 0, Math.PI * 2);
      ctx.fill();

      // fingers first, so the palm sits on top of their roots
      ctx.strokeStyle = shade(c.skin, 0.02);
      ctx.lineWidth = hr * 0.46;
      ctx.lineCap = 'round';
      [-0.62, -0.21, 0.21, 0.62].forEach(function (a) {
        ctx.beginPath();
        ctx.moveTo(h.x + Math.cos(a) * hr * 0.4, h.y + Math.sin(a) * hr * 0.4);
        ctx.lineTo(h.x + Math.cos(a) * hr * 1.85, h.y + Math.sin(a) * hr * 1.85);
        ctx.stroke();
      });
      // thumb, tucked back toward the body
      ctx.lineWidth = hr * 0.42;
      ctx.beginPath();
      ctx.moveTo(h.x, h.y);
      ctx.lineTo(h.x - hr * 0.9, h.y - Math.sign(h.y || 1) * hr * 1.1);
      ctx.stroke();
      ctx.lineCap = 'butt';

      ctx.fillStyle = shade(c.skin, 0.13);       // palm, lit from above
      ctx.strokeStyle = shade(c.skin, -0.4);
      ctx.lineWidth = Math.max(0.8, hr * 0.16);
      ctx.beginPath();
      ctx.arc(h.x, h.y, hr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    if (c.hitFlash > 0) {
      ctx.fillStyle = 'rgba(255,110,80,0.45)';
      ctx.beginPath(); ctx.arc(0, 0, c.r + 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // status above the head, upright
    if (c.panic > 0 || c.robbed) {
      if (c.robbed) label(c.x, c.y - c.r - 12, 'EMPTY', '#6B7C8B', { size: 9, alpha: 0.85 });
      else label(c.x, c.y - c.r - 12, '!', '#E0B44C', { size: 11 });
    }
    // prompt when you can take their wallet
    if (!c.robbed && c.wallet > 0 && H.robo && dist(H.robo, c) < 54) {
      if (!beingWorked(c)) label(c.x, c.y - c.r - 26, 'E   TAKE WALLET', '#5FBF87', { size: 9 });
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

  // O(1) walkability test at a world position - used instead of scanning
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

  // Minimal binary heap - the open set gets hot with a dozen agents.
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
        // genuinely pinned: new route, a sidestep, and permission to slip
        // past whoever is in the way
        requestPath(a, tx, ty, true);
        a.ghost = 700;
        // No route at all means the search found nowhere to go from here -
        // a pocket the grid cannot reason about. Slide toward the goal
        // ignoring collision until they are back on open floor.
        if (!a.path || !a.path.length) {
          const ang2 = Math.atan2(dy, dx);
          const push = 2.6 * (dt / 16.67);
          a.x = clamp(a.x + Math.cos(ang2) * push, a.r, H.world.w - a.r);
          a.y = clamp(a.y + Math.sin(ang2) * push, a.r, H.world.h - a.r);
        }
        const side = (a.stuckSide = -(a.stuckSide || 1));
        const ang = Math.atan2(dy, dx) + side * 1.5;
        moveActor(a, Math.cos(ang) * speed * 1.4, Math.sin(ang) * speed * 1.4, dt);
      }
      a.stuckT = 0;
      a.stuckFrom = { x: a.x, y: a.y };
    }
  }

  // If an agent ends up inside geometry - spawned there, shoved there by
  // separation, or left behind when a wall was rebuilt - normal movement
  // can never free them, because every candidate step is blocked too.
  // Slide them out toward open floor, ignoring collision for that nudge.
  // Ease a body out of anything it has ended up inside - knockback from a
  // burst of fire is the usual way it happens. Pushes out of the NEAREST
  // face of each prop, so a wall pushes you back the way you came instead
  // of through to the other side, which an "any open floor" search would
  // happily do.
  function pushOutOfProps(a, dt) {
    const step = 3.0 * (dt / 16.67);
    let mx = 0, my = 0;
    for (const o of H.world.obstacles) {
      if (o.kind === 'vaultdoor' && !o.solid) continue;
      const nx = Math.max(o.x, Math.min(a.x, o.x + o.w));
      const ny = Math.max(o.y, Math.min(a.y, o.y + o.h));
      const dx = a.x - nx, dy = a.y - ny;
      if (dx * dx + dy * dy >= a.r * a.r) continue;

      if (dx || dy) {
        // clipping a corner or an edge: straight back out along it
        const d = Math.hypot(dx, dy) || 1;
        mx += dx / d; my += dy / d;
      } else {
        // dead inside: leave by whichever face is closest
        const left = a.x - o.x, right = o.x + o.w - a.x;
        const up = a.y - o.y, down = o.y + o.h - a.y;
        const m = Math.min(left, right, up, down);
        if (m === left) mx -= 1; else if (m === right) mx += 1;
        else if (m === up) my -= 1; else my += 1;
      }
    }
    const len = Math.hypot(mx, my);
    if (!len) return;
    a.x = clamp(a.x + mx / len * step, a.r, H.world.w - a.r);
    a.y = clamp(a.y + my / len * step, a.r, H.world.h - a.r);
    a.ghost = 200;                        // squeeze past bodies on the way out
  }

  function unembed(a, dt) {
    const nav = H.world.nav;
    // Physically inside a prop: always needs the escape hatch.
    const solid = blocked(a.x, a.y, a.r);
    // Standing in a cell the grid calls unwalkable is NOT the same thing.
    // Cells are coarse, so the free half of a cell next to a parked car
    // reads as blocked. Yanking those agents fought their own movement and
    // pinned them in place, so only do it as a last resort once they have
    // genuinely stopped making progress.
    const gridTrapped = !solid && navBlockedAt(nav, a.x, a.y) && (a.stuckT || 0) > 260;
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
    // Push directly rather than through moveActor: this nudge exists to
    // resolve overlap, and body collision would veto the very move that
    // separates them.
    const step = dt / 16.67;
    const nx = a.x + sx * push * step, ny = a.y + sy * push * step;
    if (!blocked(nx, a.y, a.r)) a.x = nx;
    if (!blocked(a.x, ny, a.r)) a.y = ny;
  }

  // ==================== MOVEMENT ====================
  // Solid bodies, but only where a player can feel them.
  //
  // RoboKyle collides with everyone and everyone collides with RoboKyle,
  // so you can never walk through a person and nobody walks through you.
  // AI-against-AI stays on soft separation: hard collision between two
  // pathing agents deadlocks them in doorways, and a crowd that shuffles
  // past itself is far better than a crowd that stops.
  function bodyBlocked(self, x, y) {
    if (!H.robo || self.dead) return false;
    const player = H.robo;
    if (self === player) {
      const r = self.r * 0.82;
      // Only hostiles are solid to you. Your own crew and the bystanders
      // get shouldered out of the way instead - nothing is worse than
      // being pinned in a doorway by the people you brought with you.
      for (let i = 0; i < H.enemies.length; i++) {
        const o = H.enemies[i];
        if (o.dead || o.downed) continue;
        const rr = r + o.r * 0.82;
        if ((x - o.x) ** 2 + (y - o.y) ** 2 < rr * rr) return true;
      }
      return false;
    }
    // Somebody flat on the floor is not an obstacle to anyone.
    if (self.side === 'civ' && self.prone) return false;

    // A bystander will not walk into a hostile either. They used to treat
    // everyone as thin air, so a customer fleeing across the room went
    // straight through the officer you were aiming at.
    if (self.side === 'civ') {
      const rc = self.r * 0.7;
      for (let i = 0; i < H.enemies.length; i++) {
        const e = H.enemies[i];
        if (e.dead || e.downed) continue;
        const rr3 = rc + e.r * 0.7;
        if ((x - e.x) ** 2 + (y - e.y) ** 2 < rr3 * rr3) return true;
      }
      return false;                          // but they block nobody else
    }

    // Hostiles cannot stand inside a bystander, or inside your crew. No
    // ghost exemption: being jammed is not a licence to stand inside a
    // hostage, and the unstack below is what gets them free instead.
    if (self.side === 'foe') {
      const r2 = self.r * 0.7;
      for (let i = 0; i < H.civilians.length; i++) {
        const c = H.civilians[i];
        if (c.dead) continue;
        const rr2 = r2 + c.r * 0.7;
        if ((x - c.x) ** 2 + (y - c.y) ** 2 < rr2 * rr2) return true;
      }
      for (let i = 0; i < H.crew.length; i++) {
        const c = H.crew[i];
        if (c.dead || c.downed) continue;
        const rr2 = r2 + c.r * 0.7;
        if ((x - c.x) ** 2 + (y - c.y) ** 2 < rr2 * rr2) return true;
      }
    }

    if (player.dead || player.downed) return false;
    // A jammed agent may squeeze past the player too. Without this a body
    // pressed against RoboKyle in a doorway had nowhere at all to go.
    if (self.ghost > 0) return false;
    const rr = self.r * 0.82 + player.r * 0.82;
    return (x - player.x) ** 2 + (y - player.y) ** 2 < rr * rr;
  }

  // Whatever moved them - a shove, an unembed, a knockback, or their own
  // legs - nobody finishes a frame standing inside anybody else. This is
  // the backstop that makes it true regardless of which code path did it.
  function unstackBodies() {
    // Bystanders first, then your own crew: an officer standing inside
    // either of them is a shot you cannot take.
    const lists = [H.civilians, H.crew];
    for (let i = 0; i < H.enemies.length; i++) {
      const e = H.enemies[i];
      if (e.dead) continue;
      for (let l = 0; l < 2; l++) {
      const list = lists[l];
      for (let j = 0; j < list.length; j++) {
        const c = list[j];
        if (c.dead || c.downed) continue;
        if (c.prone) continue;              // people on the floor are stepped over
        const dx = c.x - e.x, dy = c.y - e.y;
        const rr = e.r * 0.7 + c.r * 0.7;
        let d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;

        // exactly on top of each other: pick a direction rather than
        // dividing by zero
        let nx, ny, d;
        if (d2 < 0.01) {
          const a = (e.seed || 0) + i * 0.7 + j;
          nx = Math.cos(a); ny = Math.sin(a); d = 0;
        } else {
          d = Math.sqrt(d2);
          nx = dx / d; ny = dy / d;
        }
        const push = (rr - d) + 0.5;

        // Move the bystander first; they are the one who should give way.
        const cx = c.x + nx * push, cy = c.y + ny * push;
        const cxOk = !blocked(cx, c.y, c.r);
        const cyOk = !blocked(c.x, cy, c.r);
        if (cxOk) c.x = cx;
        if (cyOk) c.y = cy;
        if (cxOk || cyOk) continue;

        // Wall behind them: back the hostile off instead.
        const ex = e.x - nx * push, ey = e.y - ny * push;
        const exOk = !blocked(ex, e.y, e.r);
        const eyOk = !blocked(e.x, ey, e.r);
        if (exOk) e.x = ex;
        if (eyOk) e.y = ey;
        if (exOk || eyOk) continue;

        // Both boxed in - a teller caught between the counter and an
        // officer. Slide the bystander out sideways instead of leaving
        // the two of them occupying the same square foot.
        const tx = -ny, ty = nx;
        for (const dir of [1, -1]) {
          const sx = c.x + tx * push * dir, sy = c.y + ty * push * dir;
          if (!blocked(sx, sy, c.r)) { c.x = sx; c.y = sy; break; }
        }
      }
      }
    }
  }

  // Walking into somebody shoulders them aside rather than stopping dead.
  // Used by the player and by the police; the person being shoved is only
  // moved onto floor they could stand on anyway.
  function shoveAside(a, list, dt) {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c === a || c.dead) continue;
      const dx = c.x - a.x, dy = c.y - a.y;
      const rr = a.r + c.r * 0.9;
      const d2 = dx * dx + dy * dy;
      if (d2 > rr * rr || d2 < 0.01) continue;
      const d = Math.sqrt(d2);
      const push = (rr - d) * 0.4;
      const nx = c.x + dx / d * push, ny = c.y + dy / d * push;
      if (!blocked(nx, c.y, c.r)) c.x = nx;
      if (!blocked(c.x, ny, c.r)) c.y = ny;
      if (c.side === 'civ') scare(c, 'shoved', a);
    }
  }

  function moveActor(a, dx, dy, dt) {
    const step = dt / 16.67;
    const nx = a.x + dx * step, ny = a.y + dy * step;
    if (a.ghost > 0) a.ghost -= dt;
    const soft = a.ghost > 0;      // jammed: squeeze past rather than deadlock
    if (!blocked(nx, a.y, a.r) && (soft || !bodyBlocked(a, nx, a.y))) a.x = nx;
    if (!blocked(a.x, ny, a.r) && (soft || !bodyBlocked(a, a.x, ny))) a.y = ny;
    a.x = clamp(a.x, a.r, H.world.w - a.r);
    a.y = clamp(a.y, a.r, H.world.h - a.r);
    a.walkPhase += Math.hypot(dx, dy) * 0.09 * step;
  }

  // Obstacles bucketed into a coarse grid. Rebuilt whenever the obstacle
  // list changes, which is rare: a vault opening, or a wall coming down.
  const OB_CELL = 96;

  function buildObstacleIndex(world) {
    const cols = Math.ceil(world.w / OB_CELL);
    const rows = Math.ceil(world.h / OB_CELL);
    const cells = new Array(cols * rows);
    for (const o of world.obstacles) {
      const x0 = Math.max(0, Math.floor(o.x / OB_CELL));
      const y0 = Math.max(0, Math.floor(o.y / OB_CELL));
      const x1 = Math.min(cols - 1, Math.floor((o.x + o.w) / OB_CELL));
      const y1 = Math.min(rows - 1, Math.floor((o.y + o.h) / OB_CELL));
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const i = cy * cols + cx;
          (cells[i] || (cells[i] = [])).push(o);
        }
      }
    }
    world.obIndex = { cols, rows, cells, n: world.obstacles.length };
  }

  function blocked(x, y, r) {
    const w = H.world;
    // The index is keyed on the obstacle count, so anything that adds or
    // removes one rebuilds it without every caller having to remember.
    if (!w.obIndex || w.obIndex.n !== w.obstacles.length) buildObstacleIndex(w);
    const ix = w.obIndex;
    const x0 = Math.max(0, Math.floor((x - r) / OB_CELL));
    const y0 = Math.max(0, Math.floor((y - r) / OB_CELL));
    const x1 = Math.min(ix.cols - 1, Math.floor((x + r) / OB_CELL));
    const y1 = Math.min(ix.rows - 1, Math.floor((y + r) / OB_CELL));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = ix.cells[cy * ix.cols + cx];
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const o = list[i];
          if (o.kind === 'vaultdoor' && !o.solid) continue;
          if (circleRect(x, y, r, o)) return true;
        }
      }
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
          sfxSafe.revive();
          banner('ON YOUR FEET', 'That was the only free one.');
        } else {
          startDeathSequence();
        }
      }
      // a standing crew member can pull him up
      for (const c of H.crew) {
        if (!c.downed && !c.dead && dist(c, p) < 44) {
          p.reviveProg = (p.reviveProg || 0) + dt;
          if (p.reviveProg > T.reviveTime) {
            p.downed = false; p.hp = p.maxHp * 0.5; p.reviveProg = 0; p.iframes = 900;
            sfxSafe.revive(); banner('ON YOUR FEET', c.name + ' pulled you up.');
          }
          break;
        }
      }
      return;
    }

    // ---- never leave the player wedged in the scenery ----
    // Getting shoved into a wall by a rushing enemy, or a prop landing on
    // top of you, used to be unrecoverable: every direction reads blocked,
    // so no input helps. Walk them back out to real floor instead. This
    // tests actual geometry, not the nav grid, whose cells are coarse
    // enough to call perfectly good floor blocked.
    if (blocked(p.x, p.y, p.r)) {
      pushOutOfProps(p, dt);
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
      if (p.reloading <= 0) { p.mag = w.mag; p.reloadFor = 0; }
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
          sfxSafe.revive(); banner(c.name + ' IS UP', '');
        }
      }
    }

    // ---- holds: robbing someone, or working an ATM ----
    const holding = keys['e'] || (touch.active && touch.interact);
    if (holding) tryRobCivilian(p, dt);
    else if (p.robbing) { p.robbing.robProg = 0; p.robbing = null; }

    // ---- forcing something open ----
    // Whatever his hands are on runs down while E is held, and slips back
    // if he lets go or walks away. Nothing here is instant, which is what
    // makes a mask that speeds it up worth buying.
    if (p.job && p.job.obj && !p.job.obj.open) {
      const o = p.job.obj;
      const reach = p.job.kind === 'register' ? 72 : 60;
      if (holding && Math.hypot(p.x - o.x, p.y - o.y) < reach) {
        const need = p.job.kind === 'atm' ? LO.atmDrill
                   : p.job.kind === 'register' ? LO.registerPry : LO.boxPry;
        o.prog = (o.prog || 0) + dt * perk(p, 'crack') * trait(p, 'workRate');
        o.shake = 4;
        o.needed = need;
        crackNoise(o, need);
        if (o.prog >= need) {
          if (p.job.kind === 'atm') openATM(o, p);
          else if (p.job.kind === 'register') openRegister(o, false, p);
          else openDeposit(o, p);
          p.job = null; p.atm = null;
        }
      } else {
        o.prog = Math.max(0, (o.prog || 0) - dt * 2);
        if (!holding) { p.job = null; p.atm = null; }
      }
    } else if (p.job) {
      p.job = null; p.atm = null;
    }

    // Walking into a bystander or one of your own shoulders them out of
    // the way rather than stopping you dead.
    shoveAside(p, H.civilians, dt);
    shoveAside(p, H.crew, dt);

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

      // deposit boxes can be shot open too
      if (!hit) {
        for (const dep of H.world.deposits) {
          if (dep.open) continue;
          if (Math.hypot(b.x - dep.x, b.y - dep.y) > dep.r) continue;
          dep.hp -= b.dmg; dep.shake = 7;
          sfxSafe.ricochet();
          if (dep.hp <= 0) openDeposit(dep, b.owner);
          hit = true; break;
        }
      }

      // ATMs can be shot open, loudly
      if (!hit) {
        for (const a of H.world.atms) {
          if (a.open) continue;
          if (Math.hypot(b.x - a.x, b.y - a.y) > a.r) continue;
          a.hp -= b.dmg; a.shake = 8;
          sfxSafe.ricochet();
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
          sfxSafe.ricochet();
          if (t.hp <= 0) openRegister(t, true, b.owner && !b.owner.isRobo ? b.owner : null);
          hit = true; break;
        }
      }

      // Civilians are in the line of fire like anyone else, unless they
      // are flat on the floor: rounds go over the top of them, which is
      // the whole reason anybody gets down.
      if (!hit) {
        for (const c of H.civilians) {
          if (c.dead || c.prone) continue;
          if (dist(b, c) > c.r) continue;
          // A stray round from one of your own crew is a graze. They are
          // not aiming at anybody in the room, and you cannot take the
          // trigger off them, so it should not cost you the job.
          const fromCrew = b.owner && b.owner.side === 'crew' && !b.owner.isRobo;
          c.hp -= b.dmg * (fromCrew ? 0.2 : 1); c.hitFlash = 10;
          bloodSpray(c.x, c.y, b.vx, b.vy, Math.min(9, 3 + b.dmg / 10));
          c.bleed = Math.max(c.bleed || 0, 6000);
          scare(c, 'shot', b.owner);
          panicAll(c.x, c.y, 320, 'seen', b.owner);
          sfxSafe.hit(false);
          if (c.hp <= 0) {
            c.dead = true;
            bloodSpray(c.x, c.y, rand(-1, 1), rand(-1, 1), 18);
            bloodPool(c.x, c.y, c.r);
            H.civKills++;
            layBody(c, c.kind === 'teller' ? 'teller' : 'civ');
            // Whatever was in their pockets is on the floor now. Killing
            // somebody pays, in the smallest and ugliest way: the crew
            // will still hold it against you.
            if (c.wallet > 0) {
              const spot = spillSpot(c.x, c.y, null, 22);
              H.world.loot.push({
                x: spot.x, y: spot.y, r: 11,
                amount: c.wallet, kind: 'wallet', locked: false, taken: false,
                claimAt: H.t + LOOT_GRACE,
              });
              c.wallet = 0;
            }
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

  // ==================== BLOOD ====================
  // Decals live in their own list and are drawn on the floor beneath
  // everything, so they build up over a firefight without ever sitting
  // on top of an actor. Capped so a long job cannot bloat the frame.
  const BLOOD_TONES = ['#6E0F14', '#7E1218', '#5A0C11', '#8E1A1E'];
  const MAX_DECALS = 340;

  function bloodDecal(x, y, r, alpha) {
    H.decals.push({
      x, y, r,
      a: alpha == null ? 0.55 : alpha,
      tone: BLOOD_TONES[Math.floor(Math.random() * BLOOD_TONES.length)],
      squash: 0.55 + Math.random() * 0.5,
      rot: Math.random() * Math.PI,
    });
    if (H.decals.length > MAX_DECALS) H.decals.splice(0, H.decals.length - MAX_DECALS);
  }

  // arterial spray in the direction the hit came from
  function bloodSpray(x, y, dirX, dirY, amount) {
    const base = Math.atan2(dirY, dirX);
    for (let i = 0; i < amount; i++) {
      const a = base + rand(-0.7, 0.7);
      const sp = rand(1.4, 5.2);
      H.particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(10, 24), r: rand(1.2, 3.2),
        color: BLOOD_TONES[Math.floor(Math.random() * BLOOD_TONES.length)],
        blood: true,
      });
    }
    bloodDecal(x + Math.cos(base) * 8, y + Math.sin(base) * 8, rand(4, 9), 0.4);
  }

  // a widening pool under a body
  function bloodPool(x, y, size) {
    for (let i = 0; i < 7; i++) {
      bloodDecal(x + rand(-size, size), y + rand(-size * 0.6, size * 0.6),
                 rand(size * 0.5, size), 0.5);
    }
  }

  // Anyone hurt leaves spots behind them. `bleed` counts down as it drips.
  function stepBleeding(a, dt) {
    if (a.dead || !a.bleed || a.bleed <= 0) return;
    a.bleed -= dt;
    a.dripT = (a.dripT || 0) - dt;
    if (a.dripT > 0) return;
    a.dripT = rand(90, 190);
    const moving = Math.hypot(a.x - (a.lastBleedX || a.x), a.y - (a.lastBleedY || a.y));
    a.lastBleedX = a.x; a.lastBleedY = a.y;
    // a still body pools; a moving one leaves a trail
    bloodDecal(a.x + rand(-3, 3), a.y + rand(-3, 3),
               moving > 1.5 ? rand(1.8, 3.6) : rand(2.6, 5), moving > 1.5 ? 0.42 : 0.5);
  }

  // Somebody face down on the floor. Same build as the living so the
  // room reads consistently, but slack: limbs out, no weapon up, and
  // blood that keeps spreading for a while after.
  function drawBody(b) {
    const r = b.big ? 20 : 15;
    const spread = r * 1.2;
    const age = Math.min(1, (H.t - b.t) / 9000);

    ctx.save();
    ctx.translate(b.x, b.y);

    // pool, still growing early on
    ctx.fillStyle = 'rgba(88,10,14,0.5)';
    ctx.beginPath();
    ctx.ellipse(-2, 3, spread * (1 + age * 0.5), r * 0.72 * (1 + age * 0.45),
                b.angle, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(b.angle);

    // legs
    ctx.strokeStyle = shade(b.outfit, -0.34);
    ctx.lineWidth = r * 0.4;
    ctx.lineCap = 'round';
    for (const sp of [-0.5, 0.44]) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.1, sp * r * 0.5);
      ctx.lineTo(-spread * 1.02, sp * r * 1.45);
      ctx.stroke();
    }
    ctx.fillStyle = '#15171C';
    for (const sp of [-0.5, 0.44]) {
      ctx.beginPath();
      ctx.ellipse(-spread * 1.08, sp * r * 1.5, 3.2, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // arms, thrown out
    ctx.strokeStyle = b.skin;
    ctx.lineWidth = r * 0.3;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.5); ctx.lineTo(r * 0.55, -r * 1.4); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, r * 0.5); ctx.lineTo(r * 0.8, r * 0.9); ctx.stroke();

    // torso
    ctx.fillStyle = b.outfit;
    ctx.strokeStyle = shade(b.outfit, -0.45);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.84, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    if (b.accent) {
      // a uniform stripe, so a cop still reads as a cop face down
      ctx.fillStyle = b.accent;
      ctx.beginPath();
      ctx.ellipse(-r * 0.2, 0, r * 0.16, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (b.kind === 'teller') {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-r * 0.4, 0); ctx.lineTo(r * 0.4, 0); ctx.stroke();
    }

    // head, turned aside
    ctx.save();
    ctx.translate(r * 0.9, r * 0.12);
    const R = r * 0.45;
    const maskDef = b.mask ? (D.MASKS[b.mask] || null) : null;
    ctx.fillStyle = (maskDef && maskDef.color) || b.skin;
    ctx.strokeStyle = shade((maskDef && maskDef.color) || b.skin, -0.45);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 0, R, R * 0.94, 0.3, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    if (!(maskDef && maskDef.color)) {
      ctx.fillStyle = b.hair;
      ctx.beginPath();
      ctx.ellipse(-R * 0.35, 0, R * 0.78, R * 0.88, 0, Math.PI * 0.4, Math.PI * 1.6);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(10,7,9,0.7)';
      ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(R * 0.12, -R * 0.28); ctx.lineTo(R * 0.58, -R * 0.22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(R * 0.12, R * 0.32); ctx.lineTo(R * 0.58, R * 0.26); ctx.stroke();
    }
    ctx.restore();

    // a dropped cap for the uniformed
    if (b.kind === 'cop') {
      ctx.fillStyle = shade(b.outfit, -0.2);
      ctx.beginPath();
      ctx.ellipse(r * 1.5, -r * 0.5, r * 0.3, r * 0.22, 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  const ROOM_FLOOR = {
    corridor: { base: 'rgba(126,134,146,0.10)', line: 'rgba(255,255,255,0.05)', tile: 52 },
    cubicles: { base: 'rgba(96,110,126,0.09)',  line: 'rgba(0,0,0,0.10)',      tile: 0 },
    offices:  { base: 'rgba(112,84,68,0.13)',   line: 'rgba(0,0,0,0.09)',      tile: 0 },
    records:  { base: 'rgba(84,92,104,0.12)',   line: 'rgba(255,255,255,0.04)', tile: 44 },
    break:    { base: 'rgba(94,118,110,0.12)',  line: 'rgba(255,255,255,0.05)', tile: 38 },
  };

  function drawRoomFloors() {
    const rooms = H.world.rooms;
    if (!rooms || !rooms.length) return;
    for (let i = 0; i < rooms.length; i++) {
      const r = rooms[i];
      const f = ROOM_FLOOR[r.kind];
      if (!f) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();

      ctx.fillStyle = f.base;
      ctx.fillRect(r.x, r.y, r.w, r.h);

      if (f.tile) {
        // laid tiles or vinyl sheet joins
        ctx.strokeStyle = f.line;
        ctx.lineWidth = 1;
        for (let x2 = r.x; x2 < r.x + r.w; x2 += f.tile) {
          ctx.beginPath(); ctx.moveTo(x2, r.y); ctx.lineTo(x2, r.y + r.h); ctx.stroke();
        }
        for (let y2 = r.y; y2 < r.y + r.h; y2 += f.tile) {
          ctx.beginPath(); ctx.moveTo(r.x, y2); ctx.lineTo(r.x + r.w, y2); ctx.stroke();
        }
      } else {
        // carpet: a soft grain rather than a grid
        ctx.strokeStyle = f.line;
        ctx.lineWidth = 1;
        for (let y2 = r.y + 4; y2 < r.y + r.h; y2 += 7) {
          ctx.beginPath(); ctx.moveTo(r.x, y2); ctx.lineTo(r.x + r.w, y2); ctx.stroke();
        }
      }

      // a threshold strip at the top edge, where a doorway would be
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      ctx.fillRect(r.x, r.y, r.w, 3);
      ctx.restore();
    }
  }

  function drawDecals() {
    for (let i = 0; i < H.decals.length; i++) {
      const d = H.decals[i];
      ctx.save();
      ctx.globalAlpha = d.a;
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      ctx.fillStyle = d.tone;
      ctx.beginPath();
      ctx.ellipse(0, 0, d.r, d.r * d.squash, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ==================== WORLD LABELS ====================
  // Anything readable in the world is queued here and drawn last, on top
  // of every actor and prop, on a translucent plate. Drawing text inline
  // meant a crew member could stand in front of a prompt and hide it.
  function label(x, y, text, color, opts) {
    const o = opts || {};
    H.labels.push({
      x, y, text,
      color: color || '#E8EDF2',
      size: o.size || 10,
      alpha: o.alpha == null ? 1 : o.alpha,
      plate: o.plate !== false,
    });
  }

  function drawLabels() {
    ctx.textAlign = 'center';
    for (let i = 0; i < H.labels.length; i++) {
      const l = H.labels[i];
      ctx.font = '700 ' + l.size + 'px Oswald, Impact, sans-serif';
      if (l.plate) {
        const w = ctx.measureText(l.text).width;
        const padX = 4.5, h = l.size + 4;
        ctx.globalAlpha = 0.62 * l.alpha;
        ctx.fillStyle = '#05080B';
        ctx.beginPath();
        ctx.roundRect(l.x - w / 2 - padX, l.y - l.size + 1, w + padX * 2, h, 3);
        ctx.fill();
        ctx.globalAlpha = 0.30 * l.alpha;
        ctx.strokeStyle = l.color;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.globalAlpha = l.alpha;
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, l.x, l.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    H.labels.length = 0;
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
        v.progress += dt * (v.drillMul || 1) / (H.bank.drill * 1000);
        if (Math.random() < 0.05) sfxSafe.drill();
        if (v.progress >= 1) openVault(v);
      }
    }

    if (H.alarm && !H.copsHere) {
      H.policeLeft -= dt;
      if (H.policeLeft <= 0) {
        H.copsHere = true;
        startSiren();
        spawnCopWave(T.copFirstWave, false);
        // Start the clock for the NEXT wave. It used to be zero, which
        // fired wave two on the same frame as the first response.
        H.waveGap = T.copWaveInterval;
        H.waveTimer = H.waveGap;
        banner('POLICE ARE HERE', 'First car on the street. More behind it.');
      }
    }

    if (H.copsHere) {
      H.waveTimer -= dt;
      if (H.waveTimer <= 0) {
        H.waveNo++;
        // Each wave comes a little sooner than the last, down to a floor.
        // The pressure builds over the job rather than arriving with it.
        H.waveGap = Math.max(T.copWaveIntervalMin,
                             (H.waveGap || T.copWaveInterval) - T.copWaveIntervalStep);
        H.waveTimer = H.waveGap;
        const n = Math.round(T.copWaveSizeBase + H.waveNo * T.copWaveSizeGrowth);
        spawnCopWave(n, H.breached);
        if (H.waveNo === 1) banner('MORE UNITS', 'They are still coming.');
      }
      if (!H.breached) {
        H.breachLeft -= dt;
        if (H.breachLeft <= 0) {
          H.breached = true;
          banner('BREACH', 'SWAT is coming through the front door.');
          spawnCopWave(T.copBreachWave, true);
        }
      }
    }

    // extraction: RoboKyle at the car, once the driver has had time to
    // get the engine going. Without this you could roll up, touch the
    // door and drive off with nothing.
    const atCar = dist(H.robo, H.world.car) < H.world.car.r;
    H.extractLeft = Math.max(0, TUNE_EXTRACT_LOCK - H.t);
    H.canExtract = atCar && !H.robo.downed && H.extractLeft <= 0;
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
    if (!anyUp && !H.over) { startDeathSequence(); return; }
  }

  // ==================== GOING DOWN ====================
  // Not an instant cut to the debrief. Time stretches out, the colour
  // drains, the camera closes on him, and the word lands.
  const DEATH_LEN = 3400;

  function startDeathSequence() {
    if (!H || H.death || H.over) return;
    H.death = { t: 0, x: H.robo.x, y: H.robo.y };
    const wrap = canvas.parentElement;
    if (wrap) wrap.classList.add('is-cine');
    H.robo.dead = true;
    H.robo.downed = false;
    layBody(H.robo, 'crew');
    stopSiren();
    if (GH.audio) GH.audio.music('planning');
    sfxSafe.down();
    if (GH.settings.shake) H.shake = 16;
  }

  function stepDeath(dt) {
    const Dq = H.death;
    Dq.t += dt;
    // ease the camera onto him and hold
    H.cam.x = lerp(H.cam.x, Dq.x, 0.07);
    H.cam.y = lerp(H.cam.y, Dq.y, 0.07);
    if (H.shake > 0.4) H.shake *= 0.9;
    if (Dq.t >= DEATH_LEN) finish(false);
  }

  function drawDeath() {
    const Dq = H.death;
    if (!Dq) return;
    const t = Dq.t / DEATH_LEN;

    // the colour goes out of the room
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = 'hsl(0,' + Math.round((1 - Math.min(1, t * 2.2)) * 100) + '%,50%)';
    ctx.fillRect(0, 0, VW, VH);
    ctx.restore();

    // and the light with it
    ctx.save();
    ctx.fillStyle = 'rgba(5,4,6,' + (Math.min(1, t * 1.5) * 0.62).toFixed(3) + ')';
    ctx.fillRect(0, 0, VW, VH);

    // a red wash creeping in from the edges
    const vg = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.18,
                                        VW / 2, VH / 2, VH * 0.78);
    vg.addColorStop(0, 'rgba(120,10,14,0)');
    vg.addColorStop(1, 'rgba(120,10,14,' + (Math.min(1, t * 1.3) * 0.55).toFixed(3) + ')');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VW, VH);

    // ---- the word ----
    if (Dq.t > 700) {
      const k = Math.min(1, (Dq.t - 700) / 520);
      const ease = 1 - Math.pow(1 - k, 3);
      const scale = 3.2 - 2.2 * ease;
      ctx.save();
      ctx.translate(VW / 2, VH * 0.44);
      ctx.scale(scale, scale);
      ctx.textAlign = 'center';
      ctx.globalAlpha = ease;

      // a hard shadow, then the letters, then a thin bleed of red
      ctx.font = '700 62px "Black Ops One", Impact, sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillText('KIA', 3, 3);
      ctx.fillStyle = '#C4453A';
      ctx.fillText('KIA', 0, 0);
      ctx.strokeStyle = 'rgba(255,90,70,' + (0.5 + Math.sin(H.t / 180) * 0.2).toFixed(2) + ')';
      ctx.lineWidth = 1.4;
      ctx.strokeText('KIA', 0, 0);
      ctx.restore();

      // rules above and below it, drawing out
      ctx.globalAlpha = ease;
      ctx.strokeStyle = 'rgba(196,69,58,0.75)';
      ctx.lineWidth = 2;
      const rw = 150 * ease;
      ctx.beginPath();
      ctx.moveTo(VW / 2 - rw, VH * 0.44 + 24); ctx.lineTo(VW / 2 + rw, VH * 0.44 + 24);
      ctx.stroke();
    }

    // ---- who, and where ----
    if (Dq.t > 1500) {
      const k2 = Math.min(1, (Dq.t - 1500) / 600);
      ctx.globalAlpha = k2;
      ctx.textAlign = 'center';
      ctx.font = '700 15px Oswald, Impact, sans-serif';
      ctx.fillStyle = '#E8EDF2';
      ctx.fillText('ROBOKYLE', VW / 2, VH * 0.44 + 48);
      ctx.font = '600 12px Inter, sans-serif';
      ctx.fillStyle = 'rgba(232,237,242,0.6)';
      ctx.fillText(H.bank.name + '  \u00b7  ' + money(H.robo.carried) + ' left on the floor',
                   VW / 2, VH * 0.44 + 68);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // ==================== FINISH ====================
  function finish(escaped) {
    const wrap = canvas.parentElement;
    if (wrap) wrap.classList.remove('is-cine', 'is-intro');
    if (H.over) return;
    H.over = true;
    H.running = false;
    stopSiren();

    // ---- work out each crew member's fate ----
    // 'kia'  : killed on the job
    // 'left' : down when the car pulled away, and somebody drove it
    // 'walked' / 'out' : still standing at the end
    //
    // "Left behind" only means something if there was somebody to do the
    // leaving. If the whole crew went down, nobody abandoned anyone -
    // they were killed, and the debrief should say so.
    const someoneDroveOff = escaped || (H.abandoned && !H.robo.dead);
    const fate = {};
    H.crew.forEach(c => {
      const id = c.char.id;
      if (c.dead) {
        fate[id] = 'kia';
        if (H.killedIds.indexOf(id) < 0) H.killedIds.push(id);
      } else if (c.downed) {
        c.dead = true;
        fate[id] = someoneDroveOff ? 'left' : 'kia';
        if (H.killedIds.indexOf(id) < 0) H.killedIds.push(id);
      } else {
        fate[id] = H.abandoned ? 'walked' : (escaped ? 'out' : 'walked');
      }
    });

    let haul = 0;
    const perChar = [];
    H.all.forEach(a => {
      if (!a.char) return;
      const lost = !a.isRobo && (fate[a.char.id] === 'kia' || fate[a.char.id] === 'left');
      // "survived" means they are still on the roster afterwards, which is
      // not the same as the job having paid out.
      const survived = !lost;
      if (escaped && survived) haul += a.carried;
      perChar.push({
        char: a.char,
        cash: a.carried,
        kills: a.kills || 0,
        survived,
        fate: a.isRobo ? 'out' : fate[a.char.id],
      });
    });

    const uncollected = H.all.reduce((s, a) => s + (escaped ? 0 : a.carried), 0);

    // hand back everyone's remaining health so wounds persist
    const hpOut = {};
    H.all.forEach(a => {
      if (!a.char) return;
      const key = a.isRobo ? 'robo' : a.char.id;
      hpOut[key] = a.dead ? 1 : Math.max(1, Math.round(a.hp));
    });

    // The first vault is the main one. Cracking it is what the job was
    // for, and what earns the next bank on the board.
    const mainVault = H.world.vaults[0];
    GH.debrief({
      escaped,
      vaultCracked: !!(mainVault && mainVault.open),
      haul: escaped ? haul : uncollected,
      killed: H.killedIds.slice(),
      perChar,
      bankId: H.bank.id,
      civilians: H.civKills,
      hp: hpOut,
      abandoned: !!H.abandoned,
    });
    H = null;
  }

  // The driver needs a moment before the car is going anywhere.
  const TUNE_EXTRACT_LOCK = 15000;

  // ==================== OPENING LOOK ROUND ====================
  // Casing the place. The camera walks the job one thing at a time: the
  // street, the way in, the tills, the machines, the boxes, the vault,
  // whoever is watching it, and how many people are in the room. Each
  // beat frames its own subject and pings the props in turn, so you can
  // actually see what you are being shown.
  function makeIntro(world, bank) {
    const mid = (list) => {
      if (!list.length) return null;
      let x = 0, y = 0;
      list.forEach(o => { x += o.x; y += o.y; });
      return { x: x / list.length, y: y / list.length };
    };
    const spread = (list) => {
      if (list.length < 2) return 0;
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      list.forEach(o => {
        minX = Math.min(minX, o.x); maxX = Math.max(maxX, o.x);
        minY = Math.min(minY, o.y); maxY = Math.max(maxY, o.y);
      });
      return Math.max(maxX - minX, maxY - minY);
    };
    // a zoom that fits the thing being shown, within sensible bounds
    const fit = (list, tight) => {
      const sp = spread(list);
      if (!sp) return tight || 1.35;
      return clamp(Math.min(VW, VH) / (sp + 320), 0.7, tight || 1.5);
    };

    const tills = world.registers, atms = world.atms, boxes = world.deposits;
    const vaults = world.vaults;
    const guards = H.enemies.filter(e => !e.dead);
    const customers = H.civilians.filter(c => c.kind === 'customer');
    const staff = H.civilians.filter(c => c.kind === 'teller');
    const plural = (n, one2, many) => n + ' ' + (n === 1 ? one2 : many);

    const beats = [];

    // 1. the street, from the car
    beats.push({
      hold: 2000, zoom: 0.85,
      cam: { x: world.car.x, y: world.car.y - 40 },
      pan: { x: world.entranceX, y: world.door.y - 60 },
      title: bank.name.toUpperCase(),
      sub: 'The car waits here. Everything you carry out has to come back to it.',
      marks: [{ x: world.car.x, y: world.car.y, r: 40 }],
      color: '#E8EDF2',
    });

    // 2. the way in
    beats.push({
      hold: 1700, zoom: 1.25,
      cam: { x: world.entranceX, y: world.door.y - 30 },
      title: 'THE WAY IN',
      sub: world.guardsOutside
        ? 'Front doors, and there are men on the street between you and them.'
        : 'Front doors, straight off the pavement.',
      marks: [{ x: world.entranceX, y: world.door.y - 10, r: 46 }],
      color: '#E8EDF2',
    });

    // 3. the counter and the tills
    if (tills.length) {
      beats.push({
        hold: 2200, zoom: fit(tills, 1.15),
        cam: mid(tills) || { x: world.building.x + world.building.w / 2, y: world.counterY },
        title: 'THE COUNTER',
        sub: plural(tills.length, 'till', 'tills') +
             ', and whatever the staff have not banked yet. Quick money, and quiet if you lever them.',
        marks: tills.map(t => ({ x: t.x, y: t.y, r: 20 })),
        color: '#E0B44C',
      });
    }

    // 4. the machines
    if (atms.length) {
      beats.push({
        hold: 1900, zoom: fit(atms, 1.2),
        cam: mid(atms),
        title: 'CASH MACHINES',
        sub: plural(atms.length, 'machine', 'machines') +
             '. Worth more than a till, and forcing one is not subtle.',
        marks: atms.map(a => ({ x: a.x, y: a.y, r: 22 })),
        color: '#4FB3C4',
      });
    }

    // 5. the boxes
    if (boxes.length) {
      beats.push({
        hold: 1900, zoom: fit(boxes, 1.05),
        cam: mid(boxes),
        title: 'SAFE DEPOSIT',
        sub: plural(boxes.length, 'box', 'boxes') +
             ' along the wall. Somebody else\'s valuables, and they lever open fast.',
        marks: boxes.map(b => ({ x: b.x, y: b.y, r: 18 })),
        color: '#B79BD6',
      });
    }

    // 6. the vault, which is the job
    beats.push({
      hold: 2400, zoom: fit(vaults.map(v => ({ x: v.drillX, y: v.drillY })), 1.1),
      cam: vaults.length
        ? { x: vaults[0].x + vaults[0].w / 2, y: vaults[0].y + vaults[0].h / 2 }
        : { x: world.building.x + world.building.w / 2, y: world.counterY },
      title: vaults.length > 1 ? 'THE VAULTS' : 'THE VAULT',
      sub: 'Most of the ' + money(bank.haul) + ' is in there. ' + bank.drill +
           ' seconds on the drill, and the job does not count without it.',
      marks: vaults.map(v => ({ x: v.drillX, y: v.drillY, r: 30 })),
      color: '#E3552B',
    });

    // 7. who is watching
    beats.push({
      hold: 2200, zoom: fit(guards, 1.0),
      cam: mid(guards) || { x: world.building.x + world.building.w / 2, y: world.counterY - 60 },
      title: guards.length ? 'WHO IS WATCHING' : 'NOBODY WATCHING',
      sub: (guards.length
              ? plural(guards.length, 'of them on the floor', 'of them on the floor') + '. '
              : 'Not a soul on the floor. ') +
           'Police take ' + bank.respond + ' seconds once it goes loud.',
      marks: guards.map(e => ({ x: e.x, y: e.y, r: 24 })),
      color: '#C4453A',
    });

    // 8. everybody else
    beats.push({
      hold: 2000, zoom: fit(H.civilians, 0.95),
      cam: mid(H.civilians) || { x: world.building.x + world.building.w / 2, y: world.counterY + 90 },
      title: 'AND EVERYONE ELSE',
      sub: plural(customers.length, 'customer', 'customers') + ' and ' +
           plural(staff.length, 'behind the counter', 'behind the counter') +
           '. Hurt one and the crew will not forget it.',
      marks: H.civilians.map(c => ({ x: c.x, y: c.y, r: 18 })),
      color: '#9FB0BF',
    });

    // 9. go
    beats.push({
      hold: 1300, zoom: 1.1,
      cam: { x: H.robo.x, y: H.robo.y },
      title: 'GO',
      sub: 'Any key skips this.',
      marks: [], color: '#5FBF87',
    });

    return { i: 0, t: 0, bars: 0, beats, done: false };
  }

  function stepIntro(dt) {
    const I = H.intro;
    I.t += dt;
    I.anim = (I.anim || 0) + dt;
    I.bars = Math.min(1, I.bars + dt / 260);

    const beat = I.beats[I.i];

    // Where the camera is heading. A beat can pan across to a second
    // point over its length, which is what makes the street shot read as
    // walking up to the doors rather than sitting still.
    let tx = beat.cam.x, ty = beat.cam.y;
    if (beat.pan) {
      const k = clamp(I.t / beat.hold, 0, 1);
      const ease = k * k * (3 - 2 * k);
      tx = beat.cam.x + (beat.pan.x - beat.cam.x) * ease;
      ty = beat.cam.y + (beat.pan.y - beat.cam.y) * ease;
    }
    H.cam.x = lerp(H.cam.x, tx, 0.07);
    H.cam.y = lerp(H.cam.y, ty, 0.07);

    // and it pushes in slightly over each beat, so nothing is static
    const want = (beat.zoom || 1) * (1 + clamp(I.t / beat.hold, 0, 1) * 0.06);
    H.zoom = lerp(H.zoom || 1, want, 0.06);

    if (I.t >= beat.hold) {
      I.t = 0;
      I.i++;
      if (I.i >= I.beats.length) endIntro();
    }
  }

  function endIntro() {
    if (!H || !H.intro) return;
    H.intro = null;
    H.zoom = clamp(GH.settings.zoom || 1, ZOOM_MIN, ZOOM_MAX);
    const wrap = canvas.parentElement;
    if (wrap) wrap.classList.remove('is-intro');
    H.last = performance.now();
    banner(H.bank.name, H.bank.boss ? H.bank.bossName + ' is inside' : 'In, vault, out.');
  }

  function drawIntro() {
    const I = H.intro;
    if (!I) return;
    const beat = I.beats[I.i];
    const { ox, oy } = camOffset();

    // ---- highlight what this beat is about ----
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(camOffset().zoom, camOffset().zoom);
    // Each one pings in its own turn, quickly, one after another: a ring
    // that snaps outward and settles, so you can count what you are being
    // shown instead of the whole room lighting up at once.
    const STEP = beat.marks.length > 10 ? 90 : 150;
    for (let k = 0; k < beat.marks.length; k++) {
      const m = beat.marks[k];
      const lead = k * STEP;
      if (I.t < lead) continue;
      const since = I.t - lead;

      // the ping itself: a ring thrown out and fading
      const ping = Math.min(1, since / 420);
      if (ping < 1) {
        const grow = 1 - Math.pow(1 - ping, 3);
        ctx.globalAlpha = (1 - ping) * 0.85;
        ctx.strokeStyle = beat.color;
        ctx.lineWidth = 3 - ping * 1.6;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r * 0.5 + grow * m.r * 2.6, 0, Math.PI * 2);
        ctx.stroke();
      }

      // and the marker it leaves behind
      const age = Math.min(1, since / 240);
      const settle = 1 - Math.pow(1 - age, 3);
      const r = m.r * (1.5 - settle * 0.5);
      ctx.globalAlpha = age * 0.95;
      ctx.strokeStyle = beat.color;
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = age * 0.18;
      ctx.fillStyle = beat.color;
      ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2); ctx.fill();

      // corner ticks, so a marker reads as a sight rather than a circle
      if (age >= 1) {
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = beat.color;
        ctx.lineWidth = 1.8;
        for (let q = 0; q < 4; q++) {
          const a0 = q * Math.PI / 2 + Math.PI / 4;
          ctx.beginPath();
          ctx.arc(m.x, m.y, r + 5, a0 - 0.22, a0 + 0.22);
          ctx.stroke();
        }
        // and a count, so ten tills read as ten
        if (beat.marks.length > 1 && beat.marks.length <= 14) {
          ctx.globalAlpha = 0.75;
          ctx.fillStyle = beat.color;
          ctx.font = '700 10px Oswald, Impact, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(String(k + 1), m.x, m.y - r - 9);
          ctx.textAlign = 'left';
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // ---- letterbox ----
    const barH = 58 * I.bars;
    ctx.save();
    ctx.fillStyle = '#05080B';
    ctx.fillRect(0, 0, VW, barH);
    ctx.fillRect(0, VH - barH, VW, barH);
    ctx.strokeStyle = 'rgba(224,180,76,0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, barH); ctx.lineTo(VW, barH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, VH - barH); ctx.lineTo(VW, VH - barH); ctx.stroke();

    // ---- caption ----
    ctx.textAlign = 'center';
    ctx.globalAlpha = Math.min(1, I.t / 220) * I.bars;
    ctx.font = '700 24px "Black Ops One", Impact, sans-serif';
    ctx.fillStyle = beat.color;
    ctx.fillText(beat.title, VW / 2, VH - barH + 24);
    if (beat.sub) {
      ctx.font = '600 12px Inter, sans-serif';
      ctx.fillStyle = 'rgba(232,237,242,0.72)';
      ctx.fillText(beat.sub, VW / 2, VH - barH + 43);
    }

    // ---- how far through, and how to leave ----
    ctx.globalAlpha = I.bars;
    const pipW = 22, gap = 6;
    const total = I.beats.length * pipW + (I.beats.length - 1) * gap;
    let px = VW / 2 - total / 2;
    for (let i = 0; i < I.beats.length; i++) {
      const doneBeat = i < I.i;
      const now2 = i === I.i;
      ctx.fillStyle = doneBeat ? 'rgba(224,180,76,0.7)' : 'rgba(255,255,255,0.16)';
      ctx.fillRect(px, barH - 12, pipW, 3);
      if (now2) {
        ctx.fillStyle = '#E0B44C';
        ctx.fillRect(px, barH - 12, pipW * Math.min(1, I.t / I.beats[i].hold), 3);
      }
      px += pipW + gap;
    }
    ctx.font = '600 11px Inter, sans-serif';
    ctx.fillStyle = 'rgba(232,237,242,0.45)';
    ctx.textAlign = 'right';
    ctx.fillText('ANY KEY TO SKIP', VW - 18, VH - 14);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ==================== LOOP ====================
  let frameErrors = 0;

  function loop(now) {
    if (!H || !H.running) return;
    if (H.paused) return;
    try {
      frame(now);
    } catch (err) {
      // Keep the mission alive. A bug in one frame used to stop the whole
      // loop and freeze the game with no way back except the pause menu.
      if (frameErrors++ < 5 && typeof console !== 'undefined') console.error('frame error:', err);
      if (H) { H.last = now; requestAnimationFrame(loop); }
    }
  }

  function frame(now) {
    let dt = Math.min(50, now - H.last);
    H.last = now;

    // The opening look round. Nothing in the world moves, nothing notices
    // you, and no clock runs - H.t is held so the police response and the
    // getaway driver both start counting when you actually start.
    if (H.intro) {
      stepIntro(dt);
      draw();
      drawIntro();
      updateHud();
      requestAnimationFrame(loop);
      return;
    }

    // He is down. The world stops mattering; play it out and then leave.
    if (H.death) {
      H.t += dt * 0.35;             // slowed right down
      stepDeath(dt);
      if (!H) return;
      draw();
      drawDeath();
      requestAnimationFrame(loop);
      return;
    }

    H.t += dt;

    if (H.world.navDirty) buildNav(H.world);
    pathBudget = 8;               // cap A* calls per frame (perf headroom measured at ~4x)

    stepRobo(dt);
    if (!H) return;
    H.crew.forEach(c => stepCrew(c, dt));
    H.enemies.forEach(e => stepEnemy(e, dt));
    H.civilians.forEach(c => stepCivilian(c, dt));
    // anyone wounded drips as they go
    stepBleeding(H.robo, dt);
    H.crew.forEach(c => stepBleeding(c, dt));
    H.enemies.forEach(e => stepBleeding(e, dt));
    H.civilians.forEach(c => stepBleeding(c, dt));
    stepBullets(dt);
    stepMission(dt);
    if (!H) return;   // the mission ended this frame; H is gone

    // particles
    for (let i = H.particles.length - 1; i >= 0; i--) {
      const p = H.particles[i];
      p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94; p.life--;
      if (p.life <= 0) {
        // a droplet that lands leaves a mark
        if (p.blood && Math.random() < 0.6) bloodDecal(p.x, p.y, rand(1.2, 2.8), 0.4);
        H.particles.splice(i, 1);
      }
    }
    for (let i = H.floats.length - 1; i >= 0; i--) {
      const f = H.floats[i];
      f.y -= dt * 0.03; f.life -= dt;
      if (f.life <= 0) H.floats.splice(i, 1);
    }
    H.world.registers.forEach(t => { if (t.shake > 0) t.shake -= dt * 0.05; });
    H.world.atms.forEach(a => { if (a.shake > 0) a.shake -= dt * 0.05; });
    H.world.deposits.forEach(b => { if (b.shake > 0) b.shake -= dt * 0.05; });
    if (H.screamT > 0) H.screamT -= dt;
    if (H.msgT > 0) H.msgT -= dt;
    if (H.shake > 0) H.shake *= 0.88;
    H.enemies = H.enemies.filter(e => !e.dead || (e.fade = (e.fade || 40) - 1) > 0);

    // Last thing before anything is drawn: nobody is standing inside
    // anybody. Whatever moved them, this is where it gets undone. Twice,
    // because pushing one person clear can put them against another.
    unstackBodies();
    unstackBodies();

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

  const ZOOM_MIN = 0.62, ZOOM_MAX = 1.85;

  function camOffset() {
    const zoom = H.zoom || 1;
    // How much world fits on screen depends on the zoom, so the clamp
    // that keeps the camera off the edge has to account for it.
    const halfW = VW / (2 * zoom), halfH = VH / (2 * zoom);
    const cx = H.world.w <= halfW * 2 ? H.world.w / 2
             : clamp(H.cam.x, halfW, H.world.w - halfW);
    const cy = H.world.h <= halfH * 2 ? H.world.h / 2
             : clamp(H.cam.y, halfH, H.world.h - halfH);
    let ox = VW / 2 - cx * zoom;
    let oy = VH / 2 - cy * zoom;
    if (H.shake > 0.4) { ox += rand(-H.shake, H.shake); oy += rand(-H.shake, H.shake); }
    return { ox, oy, zoom };
  }

  function updateMouseWorld() {
    if (!H) return;
    const { ox, oy, zoom } = camOffset();
    mouse.wx = (mouse.x - ox) / zoom;
    mouse.wy = (mouse.y - oy) / zoom;
  }

  // ==================== DRAW ====================
  function draw() {
    updateMouseWorld();
    const { ox, oy, zoom } = camOffset();
    const w = H.world;

    ctx.fillStyle = '#0A0B0E';
    ctx.fillRect(0, 0, VW, VH);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(zoom, zoom);

    // ---- ground ----
    ctx.fillStyle = '#0E1218';
    ctx.fillRect(0, 0, w.w, w.h);

    // road
    ctx.fillStyle = '#14181E';
    ctx.fillRect(w.street.x, w.kerbY, w.street.w, w.street.y + w.street.h - w.kerbY);
    // pavement against the building, in paving slabs
    ctx.fillStyle = w.tier === 'high' ? '#2E3540' : (w.tier === 'mid' ? '#2A303A' : '#262A31');
    ctx.fillRect(w.street.x, w.street.y, w.street.w, w.kerbY - w.street.y);
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1;
    for (let x = 0; x < w.w; x += 58) {
      ctx.beginPath(); ctx.moveTo(x, w.street.y); ctx.lineTo(x, w.kerbY); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, w.street.y + 33); ctx.lineTo(w.w, w.street.y + 33); ctx.stroke();
    // kerbstone
    ctx.fillStyle = '#3B434D';
    ctx.fillRect(0, w.kerbY - 6, w.w, 6);
    ctx.fillStyle = '#4A545F';
    ctx.fillRect(0, w.kerbY - 6, w.w, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, w.kerbY, w.w, 3);
    // centre line
    ctx.strokeStyle = 'rgba(190,180,120,0.30)'; ctx.lineWidth = 3;
    ctx.setLineDash([34, 28]);
    ctx.beginPath();
    ctx.moveTo(0, w.street.y + w.street.h * 0.82);
    ctx.lineTo(w.w, w.street.y + w.street.h * 0.82);
    ctx.stroke();
    ctx.setLineDash([]);
    // wet sheen on the asphalt
    ctx.fillStyle = 'rgba(120,150,180,0.04)';
    for (let i = 0; i < 5; i++) {
      const px = (i * 421 % w.w);
      ctx.beginPath();
      ctx.ellipse(px, w.kerbY + 70, 70, 18, 0, 0, Math.PI * 2);
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
        // Frosted, not blacked out - the mystery is the point.
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
        label(v.x + v.w / 2, v.y + v.h / 2 + 4, 'VAULT - SEALED', '#E0B44C',
              { size: 12, alpha: 0.8, plate: false });
      }
    });

    // ---- obstacles ----
    for (const o of w.obstacles) {
      if (o.kind === 'vaultdoor' && !o.solid) continue;
      let fill = '#2C333C', top = '#3A434E', edge = '#191E25';
      if (o.kind === 'counter')        { fill = '#4A3521'; top = '#5E442B'; edge = '#2A1D12'; }
      else if (o.kind === 'desk')      { fill = '#3A2E20'; top = '#4B3B29'; edge = '#221A12'; }
      else if (o.kind === 'car')       { continue; }   // drawn as a vehicle
      else if (o.kind === 'till' || o.kind === 'atm' || o.kind === 'decor') { continue; }   // drawn as props
      else if (o.kind === 'vaultwall') { fill = '#464F59'; top = '#5A6570'; edge = '#252B32'; }
      else if (o.kind === 'vaultdoor') { fill = '#8A6520'; top = '#C79A3C'; edge = '#4A360F'; }
      // these are furniture, not blocks, and have renderers of their own
      else if (o.kind === 'cubicle')   { drawCubicle(o); continue; }
      else if (o.kind === 'shelf')     { drawFiling(o); continue; }
      else if (o.kind === 'partition') { drawPartition(o); continue; }

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

    // ---- blood on the floor ----
    drawRoomFloors();
    drawDecals();
    for (let i = 0; i < H.bodies.length; i++) drawBody(H.bodies[i]);

    // ---- flat scenery: litter, stains, rugs, road markings ----
    for (const d of w.decor) if (FLAT_DECOR[d.kind]) drawDecor(d);

    // ---- parked vehicles ----
    for (const v of w.vehicles) {
      drawVehicle(v.x, v.y, v.color, v.scale, v.flip, { body: v.body, rust: v.rust });
    }

    // ---- upright scenery ----
    for (const d of w.decor) if (!FLAT_DECOR[d.kind]) drawDecor(d);

    // ---- cash registers on the counter ----
    for (const t of w.registers) drawRegister(t);
    for (const a of w.atms) drawATM(a);
    for (const b of w.deposits) drawDeposit(b);

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

    // ---- drill rigs (the progress ring is drawn later, on top) ----
    w.vaults.forEach(v => {
      if (v.open) return;
      if (v.rig) drawDrillRig(v);
      else drawDrillSpot(v);
    });

    // ---- whatever the crew have been told to open ----
    // One marker per job, on the thing itself, for as long as the job
    // stands. You can see at a glance what is spoken for and who has it.
    for (const c of H.crew) {
      if (c.dead || !c.job || !c.job.obj) continue;
      if (c.job.obj.dead) continue;                   // the mark left, or died
      const o = c.job.obj, kind = c.job.kind;
      const mx = kind === 'vault' ? o.drillX : o.x;
      const my = kind === 'vault' ? o.drillY : o.y;
      const rr = 18 + Math.sin(H.t / 160) * 4;

      // a soft wash over the thing itself, so it is obviously spoken for
      const g = ctx.createRadialGradient(mx, my, 2, mx, my, rr + 8);
      g.addColorStop(0, 'rgba(227,85,43,0.26)');
      g.addColorStop(1, 'rgba(227,85,43,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(mx, my, rr + 8, 0, Math.PI * 2); ctx.fill();

      ctx.strokeStyle = 'rgba(227,85,43,0.92)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(mx, my, rr, 0, Math.PI * 2); ctx.stroke();
      // a dashed inner ring that turns, so it reads as "in progress"
      ctx.strokeStyle = 'rgba(255,190,150,0.75)'; ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -(H.t / 40) % 12;
      ctx.beginPath(); ctx.arc(mx, my, rr - 6, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;

      // The route they are actually going to walk, from where they are
      // now. A straight line to the target told you the what but not the
      // where, which is the half that matters in a building like this.
      ctx.strokeStyle = 'rgba(227,85,43,0.34)';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 6]);
      ctx.lineDashOffset = -(H.t / 26) % 13;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      if (c.path && c.pathIdx < c.path.length) {
        for (let i = c.pathIdx; i < c.path.length; i++) ctx.lineTo(c.path[i].x, c.path[i].y);
      }
      ctx.lineTo(mx, my);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;

      // a pip at each turn, so a route round a counter reads as a route
      if (c.path) {
        ctx.fillStyle = 'rgba(227,85,43,0.5)';
        for (let i = c.pathIdx; i < c.path.length; i++) {
          ctx.beginPath(); ctx.arc(c.path[i].x, c.path[i].y, 2.4, 0, Math.PI * 2); ctx.fill();
        }
      }
      label(mx, my - rr - 8, c.name.toUpperCase(), '#E3552B', { size: 9 });
    }

    // ---- who is who ----
    // A soft ring on the floor under everyone, colour-coded by side, so a
    // glance tells you what you are looking at in a crowded lobby. Drawn
    // as one pass before any sprite, so a marker never covers a body.
    for (const c of H.civilians) if (!c.dead) drawMarker(c, MARK.civilian);
    for (const e of H.enemies) if (!e.dead) drawMarker(e, MARK.hostile);
    for (const c of H.crew) if (!c.dead) drawMarker(c, c.downed ? MARK.downed : MARK.crew);
    if (!H.robo.dead) drawMarker(H.robo, H.robo.downed ? MARK.downed : MARK.player);

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
    for (const f of H.floats) {
      label(f.x, f.y, f.text, f.color, { size: 12, alpha: Math.min(1, f.life / 400) });
    }

    drawProgressRings();   // above the actors: never hidden by whoever is working
    drawLabels();          // always on top of every actor and prop
    ctx.restore();

    drawBanner();
  }

  // ==================== SCENERY ====================
  // One vehicle renderer, used for the getaway car and everything parked
  // along the kerb, so the street does not look like a car surrounded by
  // rectangles pretending to be cars.
  function drawVehicle(x, y, color, scale, flip, opts) {
    const o = opts || {};
    const body = o.body || 'saloon';
    const L = VEHICLE_LEN[body] || 124;      // nose to tail
    const Wd = VEHICLE_WID[body] || 48;      // kerb side to road side
    const half = L / 2, halfW = Wd / 2;
    // where the cabin sits, and how much of the length it takes
    const cab = VEHICLE_CAB[body];

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(flip ? -scale : scale, scale);

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.ellipse(3, 8, half + 6, halfW + 4, 0, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#0C0F13';
    [[-half * 0.61, -halfW - 3], [-half * 0.61, halfW + 3],
     [half * 0.58, -halfW - 3], [half * 0.58, halfW + 3]].forEach(function (w) {
      ctx.beginPath(); ctx.roundRect(w[0] - 10, w[1] - 5.5, 20, 11, 4); ctx.fill();
    });

    const grd = ctx.createLinearGradient(0, -halfW, 0, halfW);
    grd.addColorStop(0, shade(color, 0.10));
    grd.addColorStop(0.45, color);
    grd.addColorStop(1, shade(color, -0.12));
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.roundRect(-half, -halfW, L, Wd, body === 'van' ? 7 : 12); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.8; ctx.stroke();

    // a pickup's bed and a van's box read differently to a saloon roof
    if (body === 'pickup') {
      ctx.fillStyle = shade(color, -0.30);
      ctx.beginPath(); ctx.roundRect(half * 0.05, -halfW + 4, half * 0.85, Wd - 8, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    }
    if (o.rust) {
      ctx.fillStyle = 'rgba(96,58,32,0.35)';
      ctx.beginPath(); ctx.ellipse(-half * 0.5, halfW * 0.5, 11, 6, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(half * 0.35, -halfW * 0.6, 8, 5, -0.2, 0, Math.PI * 2); ctx.fill();
    }
    if (body === 'taxi') {
      ctx.fillStyle = '#141414';
      for (let i = -1; i <= 1; i++) {
        ctx.fillRect(-half * 0.2 + i * 12, -halfW - 0.5, 10, 5);
        ctx.fillRect(-half * 0.2 + i * 12, halfW - 4.5, 10, 5);
      }
      ctx.fillStyle = '#E8E2D0';
      ctx.beginPath(); ctx.roundRect(cab.x - 6, -5, 13, 10, 2); ctx.fill();
    }

    ctx.fillStyle = shade(color, 0.07);
    ctx.beginPath(); ctx.roundRect(cab.x - cab.len / 2, -halfW + 4, cab.len, Wd - 8, 8); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath(); ctx.roundRect(cab.x - cab.len / 2 + 4, -halfW + 8, cab.len - 8, 10, 5); ctx.fill();

    // glass: windscreen, rear screen, side windows
    ctx.fillStyle = 'rgba(120,180,205,0.26)';
    ctx.beginPath();
    ctx.roundRect(cab.x - cab.len / 2 - 7, -halfW + 7, 9, Wd - 14, 4); ctx.fill();
    ctx.beginPath();
    ctx.roundRect(cab.x + cab.len / 2 - 2, -halfW + 7, 8, Wd - 14, 4); ctx.fill();
    if (body !== 'van') {
      ctx.fillStyle = 'rgba(120,180,205,0.14)';
      ctx.beginPath();
      ctx.roundRect(cab.x - cab.len / 2 + 6, -halfW + 3, cab.len - 12, 4.5, 2); ctx.fill();
      ctx.beginPath();
      ctx.roundRect(cab.x - cab.len / 2 + 6, halfW - 7.5, cab.len - 12, 4.5, 2); ctx.fill();
    }

    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(-2, -halfW); ctx.lineTo(-2, halfW); ctx.stroke();
    ctx.fillStyle = shade(color, 0.22);
    ctx.beginPath(); ctx.roundRect(-13, -halfW + 0.4, 6, 2, 1); ctx.fill();
    ctx.beginPath(); ctx.roundRect(5, -halfW + 0.4, 6, 2, 1); ctx.fill();

    // lights
    ctx.fillStyle = o.lightsOn ? '#FFE9B0' : 'rgba(220,215,195,0.5)';
    ctx.beginPath(); ctx.roundRect(-half - 2, -halfW + 6, 5, 8, 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(-half - 2, halfW - 14, 5, 8, 2); ctx.fill();
    ctx.fillStyle = o.lightsOn ? '#B4322A' : 'rgba(120,50,44,0.7)';
    ctx.beginPath(); ctx.roundRect(half - 2.5, -halfW + 6, 4.5, 8, 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(half - 2.5, halfW - 14, 4.5, 8, 2); ctx.fill();
    ctx.restore();
  }

  // Vehicle shapes. A van is longer and boxier than a hatchback, and both
  // are the same size on the road as the car you arrived in.
  const VEHICLE_LEN = { saloon: 128, hatch: 112, estate: 138, van: 152, pickup: 146, taxi: 130 };
  const VEHICLE_WID = { saloon: 50, hatch: 48, estate: 50, van: 56, pickup: 52, taxi: 50 };
  const VEHICLE_CAB = {
    saloon: { x: 0, len: 54 }, hatch: { x: 4, len: 50 }, estate: { x: 6, len: 72 },
    van:    { x: 22, len: 92 }, pickup: { x: -22, len: 46 }, taxi: { x: 0, len: 56 },
  };

  // Flat scenery drawn under everything, then upright props drawn with
  // the actors. `layer` keeps ground stains from painting over a bollard.
  const FLAT_DECOR = { litter: 1, crack: 1, stain: 1, scuff: 1, drain: 1, manhole: 1,
                       carpet: 1, rug: 1, graffiti: 1, banner: 1, art: 1, board: 1 };

  function drawDecor(d) {
    ctx.save();
    ctx.translate(d.x, d.y);
    if (d.rot) ctx.rotate(d.rot);
    if (d.s && d.s !== 1) ctx.scale(d.s, d.s);

    switch (d.kind) {
      case 'litter':
        ctx.fillStyle = 'rgba(214,210,196,0.30)';
        ctx.beginPath();
        ctx.moveTo(-4, -2); ctx.lineTo(3, -4); ctx.lineTo(5, 2); ctx.lineTo(-2, 4);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(160,155,140,0.22)';
        ctx.fillRect(-6, 3, 5, 1.6);
        break;

      case 'crack':
        ctx.strokeStyle = 'rgba(0,0,0,0.34)'; ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(-14, 0); ctx.lineTo(-4, -3); ctx.lineTo(3, 2); ctx.lineTo(14, -1);
        ctx.moveTo(-4, -3); ctx.lineTo(-1, -9);
        ctx.moveTo(3, 2); ctx.lineTo(6, 8);
        ctx.stroke();
        break;

      case 'stain':
        ctx.fillStyle = 'rgba(20,24,20,0.22)';
        ctx.beginPath(); ctx.ellipse(0, 0, 14, 9, 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(9, 4, 6, 4, 0.2, 0, Math.PI * 2); ctx.fill();
        break;

      case 'scuff':
        ctx.strokeStyle = 'rgba(0,0,0,0.14)'; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(0, 0, 10, 0.4, 2.2); ctx.stroke();
        break;

      case 'drain':
        ctx.fillStyle = '#14181D';
        ctx.beginPath(); ctx.roundRect(-13, -6, 26, 12, 2); ctx.fill();
        ctx.strokeStyle = '#2A323A'; ctx.lineWidth = 1.4;
        for (let i = -9; i <= 9; i += 4) { ctx.beginPath(); ctx.moveTo(i, -4.5); ctx.lineTo(i, 4.5); ctx.stroke(); }
        break;

      case 'manhole':
        ctx.fillStyle = '#1B2027';
        ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#2E3740'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(0, 0, 9.5, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.stroke();
        break;

      case 'graffiti':
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#6FBF8C'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-22, 4); ctx.quadraticCurveTo(-10, -8, 0, 3);
        ctx.quadraticCurveTo(10, 12, 22, 0);
        ctx.stroke();
        ctx.strokeStyle = '#C4453A'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-14, 9); ctx.lineTo(12, 7); ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.globalAlpha = 1;
        break;

      case 'banner':
        ctx.fillStyle = '#7E2438';
        ctx.beginPath(); ctx.roundRect(-16, 0, 32, 46, 2); ctx.fill();
        ctx.fillStyle = 'rgba(224,180,76,0.9)';
        ctx.fillRect(-16, 8, 32, 3);
        ctx.fillRect(-16, 34, 32, 3);
        ctx.beginPath(); ctx.arc(0, 22, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#7E2438';
        ctx.beginPath(); ctx.arc(0, 22, 3.4, 0, Math.PI * 2); ctx.fill();
        break;

      case 'art':
        ctx.fillStyle = '#8A6520';
        ctx.beginPath(); ctx.roundRect(-40, 0, 80, 26, 2); ctx.fill();
        ctx.fillStyle = '#1E2A33';
        ctx.fillRect(-36, 3, 72, 20);
        ctx.fillStyle = 'rgba(224,180,76,0.35)';
        ctx.beginPath(); ctx.moveTo(-30, 21); ctx.lineTo(-12, 8); ctx.lineTo(2, 17);
        ctx.lineTo(18, 5); ctx.lineTo(32, 21); ctx.closePath(); ctx.fill();
        break;

      case 'board':
        ctx.fillStyle = '#3A2E20';
        ctx.beginPath(); ctx.roundRect(-22, -14, 44, 28, 2); ctx.fill();
        ctx.fillStyle = '#5B4A34';
        ctx.fillRect(-19, -11, 38, 22);
        ctx.fillStyle = 'rgba(230,230,220,0.7)';
        ctx.fillRect(-15, -8, 12, 9);
        ctx.fillRect(0, -6, 13, 11);
        break;

      case 'carpet':
        ctx.fillStyle = 'rgba(126,36,56,0.55)';
        ctx.beginPath(); ctx.roundRect(-56, -22, 112, 44, 3); ctx.fill();
        ctx.strokeStyle = 'rgba(224,180,76,0.5)'; ctx.lineWidth = 2;
        ctx.strokeRect(-52, -18, 104, 36);
        break;

      case 'rug':
        ctx.fillStyle = 'rgba(126,36,56,0.30)';
        ctx.beginPath(); ctx.roundRect(-150, -60, 300, 120, 6); ctx.fill();
        ctx.strokeStyle = 'rgba(224,180,76,0.28)'; ctx.lineWidth = 3;
        ctx.strokeRect(-140, -50, 280, 100);
        ctx.strokeStyle = 'rgba(224,180,76,0.16)'; ctx.lineWidth = 1.4;
        ctx.strokeRect(-124, -36, 248, 72);
        break;

      case 'trashbag':
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.ellipse(2, 9, 15, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#20242A';
        ctx.beginPath(); ctx.ellipse(0, 0, 14, 12, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2C323A';
        ctx.beginPath(); ctx.ellipse(-4, -4, 6, 5, -0.4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#171B20'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(-3, -10); ctx.lineTo(0, -14); ctx.lineTo(3, -10); ctx.stroke();
        break;

      case 'weeds':
        ctx.strokeStyle = '#4A5C36'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
        for (let i = -3; i <= 3; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 3, 6);
          ctx.quadraticCurveTo(i * 5, -4, i * 7, -12 - Math.abs(i));
          ctx.stroke();
        }
        ctx.lineCap = 'butt';
        break;

      case 'dumpster':
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath(); ctx.roundRect(-32, -18, 68, 46, 3); ctx.fill();
        ctx.fillStyle = '#2E4535';
        ctx.beginPath(); ctx.roundRect(-34, -22, 68, 44, 3); ctx.fill();
        ctx.strokeStyle = '#16241B'; ctx.lineWidth = 1.8; ctx.stroke();
        ctx.fillStyle = '#38553F';
        ctx.beginPath(); ctx.roundRect(-31, -19, 62, 16, 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(0, -19); ctx.lineTo(0, 19); ctx.stroke();
        ctx.fillStyle = '#20242A';
        ctx.beginPath(); ctx.ellipse(-18, -26, 9, 6, 0, 0, Math.PI * 2); ctx.fill();
        break;

      case 'bin':
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.ellipse(2, 12, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#333C45';
        ctx.beginPath(); ctx.roundRect(-12, -12, 24, 26, 3); ctx.fill();
        ctx.fillStyle = '#455059';
        ctx.beginPath(); ctx.roundRect(-14, -16, 28, 6, 2); ctx.fill();
        ctx.strokeStyle = '#232B33'; ctx.lineWidth = 1;
        for (let i = -7; i <= 7; i += 7) { ctx.beginPath(); ctx.moveTo(i, -9); ctx.lineTo(i, 12); ctx.stroke(); }
        break;

      case 'newsbox':
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.ellipse(2, 14, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2C4A63';
        ctx.beginPath(); ctx.roundRect(-12, -14, 24, 28, 3); ctx.fill();
        ctx.fillStyle = 'rgba(190,215,230,0.4)';
        ctx.beginPath(); ctx.roundRect(-8, -10, 16, 12, 2); ctx.fill();
        ctx.fillStyle = '#1B2E3E';
        ctx.beginPath(); ctx.roundRect(-9, 4, 18, 6, 2); ctx.fill();
        break;

      case 'bench':
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.roundRect(-34, -8, 72, 22, 3); ctx.fill();
        ctx.fillStyle = '#5A4028';
        ctx.beginPath(); ctx.roundRect(-36, -13, 72, 24, 3); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
        for (let i = -8; i <= 8; i += 8) { ctx.beginPath(); ctx.moveTo(-34, i); ctx.lineTo(34, i); ctx.stroke(); }
        ctx.fillStyle = '#3A4149';
        ctx.beginPath(); ctx.roundRect(-33, 11, 8, 5, 2); ctx.fill();
        ctx.beginPath(); ctx.roundRect(25, 11, 8, 5, 2); ctx.fill();
        break;

      case 'seating':
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.roundRect(-44, -8, 92, 26, 5); ctx.fill();
        ctx.fillStyle = '#2E3A46';
        ctx.beginPath(); ctx.roundRect(-46, -14, 92, 28, 5); ctx.fill();
        ctx.fillStyle = '#3B4A58';
        ctx.beginPath(); ctx.roundRect(-42, -10, 84, 12, 4); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-14, -10); ctx.lineTo(-14, 12);
        ctx.moveTo(14, -10); ctx.lineTo(14, 12); ctx.stroke();
        break;

      case 'chair':
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(2, 10, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3E4750';
        ctx.beginPath(); ctx.roundRect(-11, -10, 22, 20, 3); ctx.fill();
        ctx.fillStyle = '#4C5762';
        ctx.beginPath(); ctx.roundRect(-11, -13, 22, 6, 2); ctx.fill();
        break;

      case 'workstation': {
        // A desk with a monitor, a keyboard, a mug and somebody's paperwork.
        ctx.fillStyle = 'rgba(0,0,0,0.38)';
        ctx.beginPath(); ctx.roundRect(-27, -8, 58, 26, 3); ctx.fill();
        // desktop, with an edge band so it has thickness
        const dg = ctx.createLinearGradient(0, -14, 0, 14);
        dg.addColorStop(0, '#5B4733'); dg.addColorStop(1, '#3E3122');
        ctx.fillStyle = dg;
        ctx.beginPath(); ctx.roundRect(-29, -13, 58, 26, 3); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(-29, 9, 58, 4);
        // grain
        ctx.strokeStyle = 'rgba(255,225,180,0.06)'; ctx.lineWidth = 1;
        for (let gx4 = -25; gx4 < 27; gx4 += 9) {
          ctx.beginPath(); ctx.moveTo(gx4, -11); ctx.lineTo(gx4 + 3, 8); ctx.stroke();
        }
        // monitor: stand, back panel, screen glow
        ctx.fillStyle = '#22262B';
        ctx.fillRect(-4, -14, 8, 4);
        ctx.beginPath(); ctx.roundRect(-13, -24, 26, 12, 2); ctx.fill();
        ctx.fillStyle = '#2E6B7A';
        ctx.beginPath(); ctx.roundRect(-11.5, -22.5, 23, 9, 1.5); ctx.fill();
        ctx.fillStyle = 'rgba(150,220,240,0.35)';
        ctx.fillRect(-10, -21, 12, 1.4);
        ctx.fillRect(-10, -18.4, 18, 1.4);
        ctx.fillRect(-10, -15.8, 8, 1.4);
        // keyboard
        ctx.fillStyle = '#1E2126';
        ctx.beginPath(); ctx.roundRect(-13, -6, 26, 8, 1.5); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        for (let ky = -4.5; ky < 0.5; ky += 2.4) {
          for (let kx = -11; kx < 11; kx += 3.4) ctx.fillRect(kx, ky, 2.4, 1.4);
        }
        // mouse, mug, paper
        ctx.fillStyle = '#2A2F35';
        ctx.beginPath(); ctx.ellipse(18, -2, 3, 4.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#B8482F';
        ctx.beginPath(); ctx.arc(-20, 2, 3.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.arc(-20, 2, 2.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(238,232,214,0.85)';
        ctx.fillRect(6, 2, 13, 9);
        ctx.strokeStyle = 'rgba(0,0,0,0.28)';
        ctx.strokeRect(6.5, 2.5, 12, 8);
        break;
      }

      case 'officechair': {
        // Five-star base, gas lift, seat and a mesh back.
        ctx.fillStyle = 'rgba(0,0,0,0.34)';
        ctx.beginPath(); ctx.ellipse(2, 9, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#2A2F35'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
        for (let i = 0; i < 5; i++) {
          const a = i * Math.PI * 2 / 5 + 0.3;
          ctx.beginPath(); ctx.moveTo(0, 4);
          ctx.lineTo(Math.cos(a) * 12, 4 + Math.sin(a) * 6);
          ctx.stroke();
        }
        ctx.fillStyle = '#343A41';
        ctx.beginPath(); ctx.roundRect(-10, -6, 20, 14, 4); ctx.fill();
        ctx.fillStyle = '#3E464F';
        ctx.beginPath(); ctx.roundRect(-9, -14, 18, 9, 3); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
        for (let mx = -7; mx < 8; mx += 3) {
          ctx.beginPath(); ctx.moveTo(mx, -13); ctx.lineTo(mx, -6); ctx.stroke();
        }
        break;
      }

      case 'printer':
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.roundRect(-16, 2, 34, 12, 3); ctx.fill();
        ctx.fillStyle = '#4A5057';
        ctx.beginPath(); ctx.roundRect(-17, -12, 34, 24, 3); ctx.fill();
        ctx.fillStyle = '#2E3339';
        ctx.beginPath(); ctx.roundRect(-14, -9, 28, 7, 2); ctx.fill();
        ctx.fillStyle = 'rgba(238,232,214,0.9)';
        ctx.fillRect(-11, 1, 22, 7);
        ctx.fillStyle = '#6FBF8A';
        ctx.beginPath(); ctx.arc(12, -6, 1.8, 0, Math.PI * 2); ctx.fill();
        break;

      case 'whiteboard':
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(-25, -4, 52, 8);
        ctx.fillStyle = '#C9CED4';
        ctx.beginPath(); ctx.roundRect(-26, -9, 52, 14, 2); ctx.fill();
        ctx.fillStyle = '#EDF1F4';
        ctx.fillRect(-24, -7, 48, 10);
        ctx.strokeStyle = 'rgba(60,90,140,0.45)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(-19, -4); ctx.lineTo(-4, -4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-19, -1); ctx.lineTo(8, -1); ctx.stroke();
        ctx.strokeStyle = 'rgba(170,60,50,0.5)';
        ctx.beginPath(); ctx.moveTo(-19, 2); ctx.lineTo(0, 2); ctx.stroke();
        break;

      case 'coatstand':
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        ctx.beginPath(); ctx.ellipse(2, 10, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#4A4038'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, 9); ctx.lineTo(0, -16); ctx.stroke();
        ctx.lineWidth = 2;
        for (const a of [-0.9, 0.9]) {
          ctx.beginPath(); ctx.moveTo(0, -14);
          ctx.lineTo(Math.cos(a - Math.PI / 2) * 8, -14 + Math.sin(a - Math.PI / 2) * 4);
          ctx.stroke();
        }
        ctx.fillStyle = '#2E3A4A';
        ctx.beginPath(); ctx.roundRect(-9, -12, 9, 16, 3); ctx.fill();
        break;

      case 'cooler':
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(2, 12, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#DCE6EE';
        ctx.beginPath(); ctx.roundRect(-8, -16, 16, 14, 4); ctx.fill();
        ctx.fillStyle = 'rgba(120,190,215,0.55)';
        ctx.beginPath(); ctx.roundRect(-6, -14, 12, 10, 3); ctx.fill();
        ctx.fillStyle = '#39424B';
        ctx.beginPath(); ctx.roundRect(-9, -3, 18, 16, 2); ctx.fill();
        break;

      case 'stand':
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(2, 12, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2A3038';
        ctx.beginPath(); ctx.roundRect(-3, -4, 6, 16, 2); ctx.fill();
        ctx.fillStyle = '#3D4956';
        ctx.beginPath(); ctx.roundRect(-11, -14, 22, 12, 2); ctx.fill();
        ctx.fillStyle = 'rgba(224,180,76,0.5)';
        ctx.fillRect(-8, -11, 16, 2);
        ctx.fillRect(-8, -7, 11, 2);
        break;

      case 'plant':
      case 'planter':
      case 'topiary': {
        const potW = d.kind === 'topiary' ? 15 : 13;
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.ellipse(2, 12, potW + 3, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = d.kind === 'planter' ? '#6B5A46' : '#8A6520';
        ctx.beginPath(); ctx.roundRect(-potW, 2, potW * 2, 14, 3); ctx.fill();
        ctx.fillStyle = shade(d.kind === 'planter' ? '#6B5A46' : '#8A6520', 0.12);
        ctx.beginPath(); ctx.roundRect(-potW - 2, 0, potW * 2 + 4, 5, 2); ctx.fill();
        ctx.fillStyle = '#2E3A22';
        ctx.beginPath(); ctx.ellipse(0, 1, potW - 2, 5, 0, 0, Math.PI * 2); ctx.fill();
        if (d.kind === 'topiary') {
          ctx.fillStyle = '#3E6B3A';
          ctx.beginPath(); ctx.arc(0, -8, 15, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#4E7F46';
          ctx.beginPath(); ctx.arc(-4, -12, 9, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = '#3E6B3A';
          [[-9, -6, 8], [8, -7, 9], [0, -12, 10], [-6, -14, 6], [7, -13, 6]].forEach(function (b) {
            ctx.beginPath(); ctx.arc(b[0], b[1], b[2], 0, Math.PI * 2); ctx.fill();
          });
          ctx.fillStyle = '#4E7F46';
          ctx.beginPath(); ctx.arc(-3, -14, 6, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }

      case 'flowers':
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(2, 10, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#B8B2A4';
        ctx.beginPath(); ctx.roundRect(-9, 0, 18, 12, 3); ctx.fill();
        ctx.fillStyle = '#3E6B3A';
        ctx.beginPath(); ctx.ellipse(0, -2, 11, 6, 0, 0, Math.PI * 2); ctx.fill();
        [['#E0B44C', -6, -7], ['#C4453A', 2, -9], ['#E8E2D0', 7, -5], ['#C77FA8', -2, -4]]
          .forEach(function (f) {
            ctx.fillStyle = f[0];
            ctx.beginPath(); ctx.arc(f[1], f[2], 3.2, 0, Math.PI * 2); ctx.fill();
          });
        break;

      case 'bollard':
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.ellipse(2, 6, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#8A6520';
        ctx.beginPath(); ctx.roundRect(-6, -10, 12, 18, 3); ctx.fill();
        ctx.fillStyle = '#C79A3C';
        ctx.beginPath(); ctx.ellipse(0, -10, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(-6, -1, 12, 2);
        break;

      case 'lamp':
      case 'lampOrnate': {
        const ornate = d.kind === 'lampOrnate';
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath(); ctx.ellipse(4, 6, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = ornate ? '#3A3222' : '#2A3038';
        ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = ornate ? '#8A6520' : '#39424B';
        ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, Math.PI * 2); ctx.fill();
        // pool of light cast on the pavement
        const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 62);
        g.addColorStop(0, ornate ? 'rgba(255,225,160,0.16)' : 'rgba(200,220,240,0.11)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, 62, 0, Math.PI * 2); ctx.fill();
        break;
      }

      case 'bikerack':
        ctx.strokeStyle = '#4A545E'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.arc(i * 13, 4, 7, Math.PI, 0);
          ctx.stroke();
        }
        ctx.lineCap = 'butt';
        break;

      case 'rope':
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(2, 8, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#8A6520';
        ctx.beginPath(); ctx.roundRect(-4, -12, 8, 20, 2); ctx.fill();
        ctx.fillStyle = '#C79A3C';
        ctx.beginPath(); ctx.arc(0, -13, 4.5, 0, Math.PI * 2); ctx.fill();
        break;

      default:
        break;
    }
    ctx.restore();
  }

  // Where the rig goes: chalk on the floor, nothing standing there yet.
  function drawDrillSpot(v) {
    ctx.save();
    ctx.translate(v.drillX, v.drillY);
    const pulse = 0.30 + Math.sin(H.t / 460) * 0.12;
    ctx.strokeStyle = 'rgba(224,180,76,' + pulse.toFixed(2) + ')';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    // three tick marks where the legs would stand
    ctx.strokeStyle = 'rgba(224,180,76,0.34)';
    ctx.lineWidth = 2;
    for (const a of [Math.PI * 0.5, Math.PI * 1.17, Math.PI * 1.83]) {
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 11, Math.sin(a) * 7);
      ctx.lineTo(Math.cos(a) * 15, Math.sin(a) * 9);
      ctx.stroke();
    }
    ctx.restore();
    label(v.drillX, v.drillY - 22, 'SET THE DRILL', '#E0B44C', { size: 9, alpha: 0.75 });
  }

  // A proper drill rig: tripod feet, a braced column, a motor housing
  // with cooling fins, and a bit that turns while it is cutting.
  function drawDrillRig(v) {
    const on = v.drilling;
    ctx.save();
    ctx.translate(v.drillX, v.drillY);

    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.beginPath(); ctx.ellipse(1, 9, 17, 6, 0, 0, Math.PI * 2); ctx.fill();

    // three legs splayed off the column
    ctx.strokeStyle = '#6B6259';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    for (const a of [Math.PI * 0.5, Math.PI * 1.17, Math.PI * 1.83]) {
      ctx.beginPath();
      ctx.moveTo(0, -2);
      ctx.lineTo(Math.cos(a) * 15, Math.sin(a) * 9 + 6);
      ctx.stroke();
      ctx.fillStyle = '#4A443E';
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * 15, Math.sin(a) * 9 + 6, 3.4, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // column
    ctx.fillStyle = '#8A7F73';
    ctx.beginPath(); ctx.roundRect(-3, -14, 6, 16, 1.5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(-3, -14, 2, 16);

    // motor housing
    ctx.fillStyle = on ? '#C4453A' : '#5E564E';
    ctx.beginPath(); ctx.roundRect(-9, -24, 18, 12, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1;
    ctx.stroke();
    // cooling fins
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    for (let i = -5; i <= 5; i += 3.5) {
      ctx.beginPath(); ctx.moveTo(i, -23); ctx.lineTo(i, -13); ctx.stroke();
    }
    // running light
    ctx.fillStyle = on ? '#FFD37A' : '#3A342E';
    ctx.beginPath(); ctx.arc(6, -21, 1.8, 0, Math.PI * 2); ctx.fill();

    // the bit, spinning while it cuts
    const spin = on ? (H.t / 40) % (Math.PI * 2) : 0;
    ctx.save();
    ctx.translate(0, -6);
    ctx.rotate(spin);
    ctx.fillStyle = '#C9CED6';
    ctx.beginPath(); ctx.roundRect(-1.6, -3, 3.2, 12, 1); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-1.6, 2, 3.2, 1.2);
    ctx.restore();

    // swarf and sparks
    if (on && Math.random() < 0.5) {
      H.particles.push({
        x: v.drillX + rand(-4, 4), y: v.drillY + 4,
        vx: rand(-1.6, 1.6), vy: rand(-2.2, -0.4),
        life: rand(8, 18), r: rand(0.8, 1.8),
        color: Math.random() < 0.5 ? 'rgba(255,196,110,0.9)' : 'rgba(210,215,225,0.6)',
      });
    }
    ctx.restore();
  }

  // Every "this is happening" ring, drawn last so nothing standing on top
  // of it can hide it. Watching a drill you cannot see was the problem.
  function drawProgressRings() {
    const ring = (x, y, frac, color, label) => {
      const R = 22;
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = 'rgba(6,10,14,0.62)';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, frac));
      ctx.stroke();
      ctx.restore();
      label(x, y - R - 6, Math.round(frac * 100) + '%', color, { size: 10 });
    };

    for (const v of H.world.vaults) {
      if (v.open || !v.drilling) continue;
      ring(v.drillX, v.drillY, clamp(v.progress, 0, 1), '#FFB347', label);
    }
    // Anything being forced shows how far along it is, whichever kind
    // of thing it is and whoever is working on it.
    const forcing = H.world.atms.concat(H.world.registers).concat(H.world.deposits);
    for (const o of forcing) {
      if (o.open || !o.prog) continue;
      const need = o.needed || LO.atmDrill;
      ring(o.x, o.y, clamp(o.prog / need, 0, 1), '#4FB3C4', label);
    }
    // and everyone mid-reload, above their own name tag
    for (const c of H.crew) if (!c.dead && !c.downed) drawReloadSpinner(c);
    if (!H.robo.dead && !H.robo.downed) drawReloadSpinner(H.robo);
    for (const e of H.enemies) if (!e.dead) drawReloadSpinner(e);
  }

  // A stud-wall partition, seen from above: skirting on both faces, a
  // capping rail down the middle, and the odd scuff.
  function drawPartition(o) {
    const horiz = o.w >= o.h;
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(o.x + 3, o.y + 5, o.w, o.h);

    const g = horiz
      ? ctx.createLinearGradient(0, o.y, 0, o.y + o.h)
      : ctx.createLinearGradient(o.x, 0, o.x + o.w, 0);
    g.addColorStop(0, '#4E5A68');
    g.addColorStop(0.45, '#3B4550');
    g.addColorStop(1, '#2C343D');
    ctx.fillStyle = g;
    ctx.fillRect(o.x, o.y, o.w, o.h);

    // skirting on each face
    ctx.fillStyle = 'rgba(12,16,20,0.55)';
    if (horiz) {
      ctx.fillRect(o.x, o.y, o.w, 2.5);
      ctx.fillRect(o.x, o.y + o.h - 2.5, o.w, 2.5);
    } else {
      ctx.fillRect(o.x, o.y, 2.5, o.h);
      ctx.fillRect(o.x + o.w - 2.5, o.y, 2.5, o.h);
    }
    // capping rail
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    if (horiz) ctx.fillRect(o.x, o.y + o.h * 0.42, o.w, 1.4);
    else ctx.fillRect(o.x + o.w * 0.42, o.y, 1.4, o.h);

    // studs, spaced like a real wall
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    if (horiz) {
      for (let x2 = o.x + 22; x2 < o.x + o.w - 8; x2 += 44) ctx.fillRect(x2, o.y + 3, 1.6, o.h - 6);
    } else {
      for (let y2 = o.y + 22; y2 < o.y + o.h - 8; y2 += 44) ctx.fillRect(o.x + 3, y2, o.w - 6, 1.6);
    }

    // a doorframe reveal at each open end, so gaps read as doorways
    ctx.fillStyle = '#6E7B88';
    if (horiz) {
      ctx.fillRect(o.x - 1, o.y, 3, o.h);
      ctx.fillRect(o.x + o.w - 2, o.y, 3, o.h);
    } else {
      ctx.fillRect(o.x, o.y - 1, o.w, 3);
      ctx.fillRect(o.x, o.y + o.h - 2, o.w, 3);
    }
    ctx.strokeStyle = 'rgba(10,14,18,0.6)'; ctx.lineWidth = 1;
    ctx.strokeRect(o.x + .5, o.y + .5, o.w - 1, o.h - 1);
  }

  // A cubicle divider: fabric panel in an aluminium frame, with feet.
  function drawCubicle(o) {
    const horiz = o.w >= o.h;
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.fillRect(o.x + 2, o.y + 4, o.w, o.h);

    ctx.fillStyle = '#4A5157';
    ctx.fillRect(o.x, o.y, o.w, o.h);
    // fabric
    ctx.fillStyle = '#5A636B';
    ctx.fillRect(o.x + 1.5, o.y + 1.5, o.w - 3, o.h - 3);
    // weave
    ctx.strokeStyle = 'rgba(0,0,0,0.10)'; ctx.lineWidth = 1;
    if (horiz) {
      for (let x2 = o.x + 3; x2 < o.x + o.w - 2; x2 += 4) {
        ctx.beginPath(); ctx.moveTo(x2, o.y + 2); ctx.lineTo(x2, o.y + o.h - 2); ctx.stroke();
      }
    } else {
      for (let y2 = o.y + 3; y2 < o.y + o.h - 2; y2 += 4) {
        ctx.beginPath(); ctx.moveTo(o.x + 2, y2); ctx.lineTo(o.x + o.w - 2, y2); ctx.stroke();
      }
    }
    // aluminium capping catches the light
    ctx.fillStyle = 'rgba(200,214,226,0.30)';
    if (horiz) ctx.fillRect(o.x, o.y, o.w, 2);
    else ctx.fillRect(o.x, o.y, 2, o.h);
    // feet
    ctx.fillStyle = '#23282C';
    if (horiz) {
      ctx.fillRect(o.x + 2, o.y + o.h - 1, 6, 3);
      ctx.fillRect(o.x + o.w - 8, o.y + o.h - 1, 6, 3);
    } else {
      ctx.fillRect(o.x + o.w - 1, o.y + 2, 3, 6);
      ctx.fillRect(o.x + o.w - 1, o.y + o.h - 8, 3, 6);
    }
  }

  // A run of filing cabinets: drawer fronts, handles, and paper on top.
  function drawFiling(o) {
    ctx.fillStyle = 'rgba(0,0,0,0.36)';
    ctx.fillRect(o.x + 2, o.y + 4, o.w, o.h);

    const g = ctx.createLinearGradient(0, o.y, 0, o.y + o.h);
    g.addColorStop(0, '#4C463C');
    g.addColorStop(1, '#332E27');
    ctx.fillStyle = g;
    ctx.fillRect(o.x, o.y, o.w, o.h);

    const cols = Math.max(1, Math.round(o.w / 22));
    for (let c2 = 0; c2 < cols; c2++) {
      const cw = o.w / cols;
      const cx2 = o.x + c2 * cw;
      // drawer face
      ctx.fillStyle = '#413A31';
      ctx.fillRect(cx2 + 1.5, o.y + 2, cw - 3, o.h - 4);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1;
      ctx.strokeRect(cx2 + 1.5, o.y + 2, cw - 3, o.h - 4);
      // handle
      ctx.fillStyle = '#9A8F7C';
      ctx.fillRect(cx2 + cw / 2 - 5, o.y + o.h / 2 - 1, 10, 2);
      // label holder
      ctx.fillStyle = 'rgba(240,236,220,0.55)';
      ctx.fillRect(cx2 + cw / 2 - 4, o.y + 4, 8, 2.4);
    }
    // a stack of paper left on top
    if (o.w > 30) {
      ctx.fillStyle = 'rgba(238,232,214,0.75)';
      ctx.fillRect(o.x + o.w - 16, o.y + 3, 11, 7);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.strokeRect(o.x + o.w - 16.5, o.y + 2.5, 12, 8);
    }
    ctx.strokeStyle = 'rgba(15,13,10,0.7)'; ctx.lineWidth = 1;
    ctx.strokeRect(o.x + .5, o.y + .5, o.w - 1, o.h - 1);
  }

  function drawCar(car) {
    const ready = H.canExtract;
    ctx.save();
    ctx.translate(car.x, car.y);

    // ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.ellipse(3, 9, 74, 32, 0, 0, Math.PI * 2); ctx.fill();

    // wheels first, so the body sits over them
    ctx.fillStyle = '#0C0F13';
    [[-42, -30], [-42, 30], [40, -30], [40, 30]].forEach(function (w) {
      ctx.beginPath(); ctx.roundRect(w[0] - 11, w[1] - 6, 22, 12, 4); ctx.fill();
    });

    // body: a long saloon, nose to the left ready to pull away
    const grd = ctx.createLinearGradient(0, -28, 0, 28);
    grd.addColorStop(0, '#3A2A24');
    grd.addColorStop(0.45, '#2A1D19');
    grd.addColorStop(1, '#1B1211');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.roundRect(-68, -27, 136, 54, 13); ctx.fill();
    ctx.strokeStyle = '#0E0A09'; ctx.lineWidth = 2; ctx.stroke();

    // roof
    ctx.fillStyle = '#43312A';
    ctx.beginPath(); ctx.roundRect(-30, -22, 58, 44, 9); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.4; ctx.stroke();
    // roof highlight
    ctx.fillStyle = 'rgba(255,235,210,0.07)';
    ctx.beginPath(); ctx.roundRect(-26, -18, 50, 12, 6); ctx.fill();

    // windows
    ctx.fillStyle = 'rgba(120,180,205,0.30)';
    ctx.beginPath(); ctx.roundRect(-38, -19, 10, 38, 4); ctx.fill();   // windscreen
    ctx.beginPath(); ctx.roundRect(28, -19, 9, 38, 4); ctx.fill();     // rear
    ctx.fillStyle = 'rgba(120,180,205,0.18)';
    ctx.beginPath(); ctx.roundRect(-24, -23, 44, 5, 2); ctx.fill();    // side glass
    ctx.beginPath(); ctx.roundRect(-24, 18, 44, 5, 2); ctx.fill();

    // door seams + handles
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-2, -27); ctx.lineTo(-2, 27); ctx.stroke();
    ctx.fillStyle = '#6B564A';
    ctx.beginPath(); ctx.roundRect(-14, -26.5, 7, 2.2, 1); ctx.fill();
    ctx.beginPath(); ctx.roundRect(6, -26.5, 7, 2.2, 1); ctx.fill();
    ctx.beginPath(); ctx.roundRect(-14, 24.3, 7, 2.2, 1); ctx.fill();
    ctx.beginPath(); ctx.roundRect(6, 24.3, 7, 2.2, 1); ctx.fill();

    // headlights on, engine running
    ctx.fillStyle = '#FFE9B0';
    ctx.beginPath(); ctx.roundRect(-70, -20, 6, 9, 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(-70, 11, 6, 9, 2); ctx.fill();
    const beam = ctx.createLinearGradient(-70, 0, -150, 0);
    beam.addColorStop(0, 'rgba(255,233,176,0.20)');
    beam.addColorStop(1, 'rgba(255,233,176,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(-68, -20); ctx.lineTo(-150, -44); ctx.lineTo(-150, 44); ctx.lineTo(-68, 20);
    ctx.closePath(); ctx.fill();
    // tail lights
    ctx.fillStyle = '#B4322A';
    ctx.beginPath(); ctx.roundRect(64, -20, 5, 9, 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(64, 11, 5, 9, 2); ctx.fill();

    // exhaust puff, so it reads as idling and waiting
    if (Math.random() < 0.25) {
      H.particles.push({
        x: car.x + 70, y: car.y + 22 + rand(-3, 3),
        vx: rand(0.2, 0.8), vy: rand(-0.5, -0.1),
        life: rand(18, 34), r: rand(2, 4.5),
        color: 'rgba(180,185,195,0.20)',
      });
    }

    // extraction ring
    if (ready) {

      ctx.strokeStyle = 'rgba(95,191,135,' + (0.55 + Math.sin(H.t / 160) * 0.3) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, car.r, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(224,180,76,0.22)'; ctx.lineWidth = 2;
      ctx.setLineDash([10, 10]);
      ctx.beginPath(); ctx.arc(0, 0, car.r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // Prompt. The car is where the job ends, so never make the player
    // guess whether they can go.
    if (ready) {
      label(car.x, car.y - car.r - 12,
            H.extractPhase && H.stragglers > 0
              ? 'E   GO WITHOUT THEM (' + H.stragglers + ' MISSING)'
              : 'E   DRIVE OFF',
            '#5FBF87', { size: 12 });
    } else if (H.extractLeft > 0) {
      // the driver is still getting the engine going
      label(car.x, car.y - car.r - 12,
            'ENGINE WARMING, ' + Math.ceil(H.extractLeft / 1000) + 's',
            '#E0B44C', { size: 11 });
    } else {
      label(car.x, car.y - car.r - 12, 'GETAWAY CAR', '#E0B44C', { size: 9, alpha: 0.7 });
    }
  }

  // A cash register you can actually break into: closed it is a solid
  // till with a screen and keys; open it is a sprung drawer with notes
  // spilling out. The whole prop is flipped so the business end faces
  // the staff side of the counter, not the lobby.
  // A till on the counter, seen from above, facing the person who works
  // it. The screen and the keys are on the staff side; the drawer slides
  // out toward them when it goes. It used to be drawn upside down, with
  // the screen pointed at the queue.
  function drawRegister(t) {
    const shake = t.shake > 0 ? (Math.random() - 0.5) * t.shake * 0.5 : 0;
    const prog = clamp((t.prog || 0) / LO.registerPry, 0, 1);
    ctx.save();
    ctx.translate(t.x + shake, t.y);

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(1, 5, 17, 6, 0, 0, Math.PI * 2); ctx.fill();

    // ---- the drawer, behind the body, sliding out toward the staff ----
    if (t.open || prog > 0) {
      const out = t.open ? 13 : prog * 6;
      ctx.fillStyle = '#2A3038';
      ctx.beginPath(); ctx.roundRect(-13, -6 - out, 26, 12, 2); ctx.fill();
      ctx.fillStyle = '#171B20';
      ctx.beginPath(); ctx.roundRect(-11, -4 - out, 22, 8, 1.5); ctx.fill();
      // note bays, and the coin cups behind them
      ctx.fillStyle = t.open ? '#6E7A5C' : '#3E4750';
      for (let i = 0; i < 4; i++) ctx.fillRect(-10 + i * 5.4, -3 - out, 4.2, 5);
      if (t.open) {
        ctx.fillStyle = '#C9BE84';
        for (let i = 0; i < 4; i++) ctx.fillRect(-10 + i * 5.4, -3 - out, 4.2, 1.6);
      }
      ctx.strokeStyle = '#12161A'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(-13, -6 - out, 26, 12, 2); ctx.stroke();
    }

    // ---- body ----
    const bg = ctx.createLinearGradient(0, -8, 0, 12);
    bg.addColorStop(0, t.open ? '#3E464F' : '#4C5661');
    bg.addColorStop(1, '#2B323A');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.roundRect(-14, -8, 28, 20, 3); ctx.fill();
    ctx.strokeStyle = '#1C2128'; ctx.lineWidth = 1.2; ctx.stroke();

    // ---- screen housing, on the staff side ----
    ctx.fillStyle = '#2E353D';
    ctx.beginPath(); ctx.roundRect(-11, -15, 22, 9, 2.5); ctx.fill();
    ctx.strokeStyle = '#171C22'; ctx.stroke();
    ctx.fillStyle = t.open ? '#243027' : '#1B2A34';
    ctx.beginPath(); ctx.roundRect(-9, -13.5, 18, 6, 1.5); ctx.fill();
    if (!t.open) {
      ctx.fillStyle = 'rgba(120,200,220,0.6)';
      ctx.fillRect(-7.5, -12.4, 9, 1.3);
      ctx.fillRect(-7.5, -10.2, 6, 1.3);
      // a total, blinking away
      ctx.fillStyle = 'rgba(150,230,255,' + (0.4 + Math.sin(H.t / 640 + t.x) * 0.2) + ')';
      ctx.fillRect(2.5, -12.4, 5, 1.3);
    }

    // ---- keypad ----
    ctx.fillStyle = '#5C666F';
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        ctx.beginPath();
        ctx.roundRect(-10.5 + c * 5.3, -4 + r * 4.6, 3.8, 3.2, 1);
        ctx.fill();
      }
    }
    // the big key, bottom right, the way they always are
    ctx.fillStyle = t.open ? '#4A5560' : '#7C8A4A';
    ctx.beginPath(); ctx.roundRect(5.2, 5.2, 3.8, 3.2, 1); ctx.fill();

    // ---- the customer's little display, on the lobby face ----
    ctx.fillStyle = '#232A31';
    ctx.beginPath(); ctx.roundRect(-6, 11, 12, 4, 1.4); ctx.fill();
    if (!t.open) {
      ctx.fillStyle = 'rgba(120,200,220,0.4)';
      ctx.fillRect(-4.5, 12.2, 6, 1.2);
    }

    // ---- a lock, and the damage as it gives ----
    if (!t.open) {
      ctx.fillStyle = '#C79A3C';
      ctx.beginPath(); ctx.arc(0, 9, 2.1, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(0, 9, 2.1, 0, Math.PI * 2); ctx.stroke();
      if (prog > 0.15 || t.hp < 45) {
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1;
        const n = (t.hp < 20 || prog > 0.6) ? 4 : 2;
        for (let i = 0; i < n; i++) {
          ctx.beginPath();
          ctx.moveTo(-9 + i * 5, -6);
          ctx.lineTo(-6 + i * 5, 4);
          ctx.stroke();
        }
      }
    }
    ctx.restore();

    // ---- prompts and progress ----
    if (t.open) {
      label(t.x, t.y - 26, 'EMPTY', '#6B7C8B', { size: 8, alpha: 0.85 });
    } else if (prog > 0) {
      // handled by the shared progress ring, drawn above everything
    } else if (H.robo && Math.hypot(H.robo.x - t.x, H.robo.y - t.y) < 68 && !beingWorked(t)) {
      label(t.x, t.y - 24, 'E   PRY OPEN', '#E0B44C', { size: 9 });
    }
  }

  function drawDeposit(b) {
    const shake = b.shake > 0 ? (Math.random() - 0.5) * b.shake * 0.5 : 0;
    ctx.save();
    ctx.translate(b.x + shake, b.y);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.roundRect(-13, -13, 30, 32, 3); ctx.fill();
    ctx.fillStyle = b.open ? '#2C333B' : '#3E4650';
    ctx.beginPath(); ctx.roundRect(-15, -16, 30, 32, 3); ctx.fill();
    ctx.strokeStyle = '#1A1F26'; ctx.lineWidth = 1.3; ctx.stroke();
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 2; c++) {
        const dx = -12 + c * 13, dy = -13 + r * 10;
        ctx.fillStyle = b.open ? '#171C22' : '#4C5661';
        ctx.beginPath(); ctx.roundRect(dx, dy, 11, 8, 1.5); ctx.fill();
        if (!b.open) {
          ctx.fillStyle = '#C79A3C';
          ctx.beginPath(); ctx.arc(dx + 8.4, dy + 4, 1.1, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    ctx.restore();

    if (b.open) label(b.x, b.y - 22, 'EMPTY', '#6B7C8B', { size: 8, alpha: 0.85 });
    else if (H.robo && dist(H.robo, b) < 54 && !beingWorked(b)) {
      label(b.x, b.y - 24, 'E   FORCE BOX', '#E0B44C', { size: 9 });
    }
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
      label(a.x, a.y - 26, 'EMPTIED', '#6B7C8B', { size: 8, alpha: 0.85 });
    } else if (H.robo && dist(H.robo, a) < 56 && !beingWorked(a)) {
      // The prompt is only useful before anything starts. Once it does, the
      // progress ring on the top layer says it better, and the two clipped
      // into each other. There is no second arc drawn down here any more.
      label(a.x, a.y - 28, 'E   CRACK ATM', '#5FBF87', { size: 9 });
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

  // ==================== SIDE MARKERS ====================
  // Green is yours, red will shoot you, grey is a bystander. RoboKyle
  // gets a brighter ring than the rest of the crew so you can always
  // pick yourself out of a scrum.
  const MARK = {
    player:   { rgb: '110,235,165', ring: 0.95, fill: 0.30 },
    crew:     { rgb: '95,191,135',  ring: 0.80, fill: 0.22 },
    hostile:  { rgb: '224,72,60',   ring: 0.80, fill: 0.22 },
    civilian: { rgb: '168,182,196', ring: 0.62, fill: 0.15 },
    downed:   { rgb: '224,180,76',  ring: 0.90, fill: 0.26 },
  };

  // Anybody mid-reload gets a spinner over their head. Not knowing why
  // the trigger had stopped working was the single most annoying thing
  // about running dry.
  function drawReloadSpinner(a) {
    if (!a.reloading || a.reloading <= 0) return;
    const total = a.reloadFor || a.reloading;
    const done = Math.max(0, Math.min(1, 1 - a.reloading / total));
    const cx = a.x, cy = a.y - (a.r || 14) * 3.6;   // clear of the name plate
    const R = 9;

    ctx.save();
    ctx.translate(cx, cy);

    // dark disc so it reads on any floor
    ctx.fillStyle = 'rgba(6,10,14,0.62)';
    ctx.beginPath(); ctx.arc(0, 0, R + 3, 0, Math.PI * 2); ctx.fill();

    // the track
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();

    // a chasing arc that spins, on top of the fill showing how far along
    ctx.strokeStyle = 'rgba(224,180,76,0.35)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + done * Math.PI * 2);
    ctx.stroke();

    const spin = (H.t / 320) % (Math.PI * 2);
    ctx.strokeStyle = '#E0B44C';
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, R, spin, spin + Math.PI * 0.6);
    ctx.stroke();

    // two little arrowheads, so it reads as "reloading" not "loading"
    ctx.fillStyle = '#E0B44C';
    for (const a0 of [spin + Math.PI * 0.6, spin + Math.PI * 1.6]) {
      ctx.save();
      ctx.rotate(a0);
      ctx.beginPath();
      ctx.moveTo(R + 3.4, 0); ctx.lineTo(R - 3.4, -2.6); ctx.lineTo(R - 3.4, 2.6);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // Is this thing already spoken for, or already being forced? Either way
  // it has a ring on it, and a prompt on top of that is just clutter.
  function beingWorked(o) {
    if (o.prog > 0 || o.drilling || o.robProg > 0) return true;
    for (const c of H.crew) {
      if (!c.dead && c.job && c.job.obj === o) return true;
    }
    return !!(H.robo && (H.robo.atm === o || H.robo.robbing === o));
  }

  function drawMarker(a, m) {
    // Sized to sit clearly OUTSIDE the sprite and its own drop shadow -
    // tucked underneath, the ring was invisible at any real zoom.
    const r = (a.r || 14) * 2.15;
    const SQ = 0.55;                       // flatten: it lies on the floor
    ctx.save();
    ctx.translate(a.x, a.y + (a.r || 14) * 0.42);
    ctx.scale(1, SQ);

    const g = ctx.createRadialGradient(0, 0, r * 0.35, 0, 0, r);
    g.addColorStop(0, 'rgba(' + m.rgb + ',0)');
    g.addColorStop(0.62, 'rgba(' + m.rgb + ',' + (m.fill * 0.5) + ')');
    g.addColorStop(0.9, 'rgba(' + m.rgb + ',' + m.fill + ')');
    g.addColorStop(1, 'rgba(' + m.rgb + ',0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

    // a dark backing line first, so the ring holds up on a pale floor
    ctx.strokeStyle = 'rgba(6,10,14,0.45)';
    ctx.lineWidth = 3.6 / SQ;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2); ctx.stroke();

    ctx.strokeStyle = 'rgba(' + m.rgb + ',' + m.ring + ')';
    ctx.lineWidth = 2.2 / SQ;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2); ctx.stroke();

    if (m === MARK.player) {
      // a second, slowly pulsing ring so you can always find yourself
      const pulse = 0.55 + Math.sin(H.t / 420) * 0.2;
      ctx.strokeStyle = 'rgba(' + m.rgb + ',' + pulse.toFixed(2) + ')';
      ctx.lineWidth = 1.6 / SQ;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.04, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // ==================== CHARACTER RENDERING ====================
  // One renderer for RoboKyle, crew and police. RoboKyle keeps his
  // look from Undead Nightmare - skin deltoids, black tank, one
  // chrome arm, blonde spikes - and the same body carries a mask
  // and outfit colour for everyone else.
  function drawChar(c) {
    if (c.dead) return;
    const SH = c.r * 1.14, CH = c.r * 0.78;
    const walk = Math.sin(c.walkPhase);

    ctx.save();
    ctx.translate(c.x, c.y);

    // downed characters lie flat and stop aiming
    if (c.downed) {
      ctx.restore();
      drawDowned(c);
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
    if (!c.isRobo) label(c.x, c.y - c.r - 13, c.name, '#9FB0BF', { size: 9, alpha: 0.9 });
  }

  // Somebody on the floor, not a stain. They keep their outfit, their
  // mask and their hair; the chest rises; the blood spreads. You should
  // be able to tell at a glance WHO is down without reading the tag.
  function drawDowned(c) {
    // Which way they fell is fixed the moment they go down, so the body
    // does not swivel about on the floor.
    if (c.fallAngle == null) c.fallAngle = (c.angle || 0) + rand(-0.5, 0.5);
    const spread = c.r * 1.25;
    const breathe = Math.sin(H.t / 620 + (c.slot || 0)) * 0.6;
    const skin = c.skin || '#C79B76';
    const outfit = c.isRobo ? '#1B1F27' : (c.outfit || '#3A4250');
    const mask = D.MASKS[c.char ? c.char.mask : 'none'] || D.MASKS.none;

    ctx.save();
    ctx.translate(c.x, c.y);

    // blood, spreading and irregular
    const pool = 1 + Math.min(1, (c.bleedSpread = Math.min(1.6, (c.bleedSpread || 0) + 0.0016)));
    ctx.fillStyle = 'rgba(96,10,14,0.55)';
    ctx.beginPath();
    ctx.ellipse(-2, 3, spread * pool, c.r * 0.78 * pool, c.fallAngle, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(140,16,20,0.5)';
    ctx.beginPath();
    ctx.ellipse(spread * 0.5, 5, c.r * 0.5 * pool, c.r * 0.3 * pool, c.fallAngle, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(c.fallAngle);

    // legs, sprawled apart
    ctx.strokeStyle = shade(outfit, -0.3);
    ctx.lineWidth = c.r * 0.42;
    ctx.lineCap = 'round';
    for (const sp of [-0.55, 0.42]) {
      ctx.beginPath();
      ctx.moveTo(-c.r * 0.1, sp * c.r * 0.5);
      ctx.lineTo(-spread * 1.05, sp * c.r * 1.5);
      ctx.stroke();
    }
    // boots
    ctx.fillStyle = '#15171C';
    for (const sp of [-0.55, 0.42]) {
      ctx.beginPath();
      ctx.ellipse(-spread * 1.12, sp * c.r * 1.55, 3.4, 2.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // one arm flung out, one across the chest
    ctx.strokeStyle = skin;
    ctx.lineWidth = c.r * 0.32;
    ctx.beginPath();
    ctx.moveTo(0, -c.r * 0.5);
    ctx.lineTo(c.r * 0.5, -c.r * 1.45);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, c.r * 0.5);
    ctx.lineTo(c.r * 0.75, c.r * 0.95);
    ctx.stroke();

    // torso, breathing
    ctx.fillStyle = outfit;
    ctx.strokeStyle = shade(outfit, -0.45);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, c.r * 0.86 + breathe * 0.3, c.r * 0.62 + breathe * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // vest seam
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-c.r * 0.5, 0); ctx.lineTo(c.r * 0.5, 0); ctx.stroke();

    // RoboKyle's chrome arm still reads even face down
    if (c.isRobo) {
      ctx.strokeStyle = '#B9C1CC';
      ctx.lineWidth = c.r * 0.3;
      ctx.beginPath();
      ctx.moveTo(0, c.r * 0.5);
      ctx.lineTo(c.r * 0.75, c.r * 0.95);
      ctx.stroke();
    }

    // head, turned to one side
    ctx.save();
    ctx.translate(c.r * 0.92, c.r * 0.12);
    const R = c.r * 0.46;
    ctx.fillStyle = mask.color || skin;
    ctx.strokeStyle = shade(mask.color || skin, -0.45);
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.ellipse(0, 0, R, R * 0.94, 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (!mask.color) {
      // eyes shut
      ctx.strokeStyle = 'rgba(10,7,9,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(R * 0.1, -R * 0.3); ctx.lineTo(R * 0.6, -R * 0.24); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(R * 0.1, R * 0.34); ctx.lineTo(R * 0.6, R * 0.28); ctx.stroke();
      // hair
      ctx.fillStyle = c.isRobo ? '#F2C75E' : (c.hair || '#3A2A20');
      ctx.beginPath();
      ctx.ellipse(-R * 0.35, 0, R * 0.8, R * 0.9, 0, Math.PI * 0.4, Math.PI * 1.6);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(R * 0.1, -R * 0.5, 2.2, 1.5);
      ctx.fillRect(R * 0.1, R * 0.3, 2.2, 1.5);
    }
    ctx.restore();
    ctx.restore();

    // the tag and the clock, upright and on top
    label(c.x, c.y - c.r - 14, c.name.toUpperCase() + ' \u2014 DOWN', '#E0B44C', { size: 11 });
    ctx.save();
    ctx.translate(c.x, c.y);
    const frac = c.isRobo ? (c.reviveProg || 0) / T.reviveTime
                          : 1 - c.downTimer / T.downedBleedout;
    ctx.strokeStyle = 'rgba(6,10,14,0.6)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, c.r + 12, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#E3552B'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, c.r + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(frac, 0, 1));
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.restore();
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
      // Melee thrusts STRAIGHT FORWARD and pulls back - a stab, not a
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
      label(e.x, e.y - e.r - 27, e.name.toUpperCase(), '#E8EDF2', { size: 10 });
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

    // ---- arms ----
    // `ready` is 0 with the weapon stowed and 1 once it is up, so the arms
    // travel onto the grip across the draw instead of snapping. An idle
    // guard used to stand permanently braced around an invisible weapon.
    const gx = CH + 9;
    let ready;
    if (!e.alerted) ready = 0;
    else if (e.draw > 0 && e.drawMax) ready = 1 - clamp(e.draw / e.drawMax, 0, 1);
    else ready = 1;

    // a melee swing throws the weapon arm forward with the weapon
    const swingT = (e.swing > 0 && e.wpn.melee) ? Math.sin((1 - e.swing / 220) * Math.PI) : 0;
    const sway = Math.sin(e.walkPhase || 0) * 2.4;

    ctx.lineWidth = heavy ? 6 : 5;
    ctx.lineCap = 'round';
    [1, -1].forEach(function (side) {
      const shoulderY = side * SH * 0.74;
      const restX = -CH * 0.35, restY = side * SH * 1.06 + sway * side;
      const gripX = gx - (side > 0 ? 3 : 1), gripY = side > 0 ? 3.4 : -3;

      const lead = side > 0 ? swingT * 13 : swingT * 5;   // leading arm drives the swing
      const handX = lerp(restX, gripX, ready) + lead;
      const handY = lerp(restY, gripY, ready);
      const ctrlX = lerp(CH * 0.05, CH * 0.7, ready) + lead * 0.5;
      const ctrlY = side * lerp(SH * 1.0, SH * 0.55, ready);

      ctx.strokeStyle = shade(e.body, 0.06);
      ctx.beginPath();
      ctx.moveTo(-1, shoulderY);
      ctx.quadraticCurveTo(ctrlX, ctrlY, handX, handY);
      ctx.stroke();

      ctx.fillStyle = '#C79A6E';
      ctx.beginPath();
      ctx.arc(handX, handY, 2.4, 0, Math.PI * 2);
      ctx.fill();
    });
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

  // What is on the belt, drawn so you can tell it apart across a lobby.
  // A baton hangs in a loop, a sidearm sits in a holster with the grip
  // showing, and anything bigger is slung across the back.
  function drawHolstered(e) {
    const w = e.wpn;
    const y = e.r * 0.66;
    ctx.save();

    if (w.melee) {
      // baton in a belt loop, hanging down past the hip
      ctx.strokeStyle = '#0C0F14'; ctx.lineWidth = 4.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-2, y); ctx.lineTo(-4, y + 13); ctx.stroke();
      ctx.strokeStyle = '#3A424C'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-2, y); ctx.lineTo(-4, y + 13); ctx.stroke();
      ctx.fillStyle = '#8E99A6';
      ctx.beginPath(); ctx.arc(-2, y - 0.5, 2.2, 0, Math.PI * 2); ctx.fill();
      // the loop itself
      ctx.strokeStyle = '#1A1E24'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(-2, y, 3.6, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      return;
    }

    const big = (w.range || 0) > 480 || (w.burst || 1) > 2;
    if (big) {
      // slung across the back: you can see the barrel and the stock
      ctx.save();
      ctx.rotate(-0.62);
      ctx.fillStyle = '#14171C';
      ctx.beginPath(); ctx.roundRect(-13, y - 3, 26, 5.4, 1.6); ctx.fill();
      ctx.fillStyle = '#2C333C';
      ctx.beginPath(); ctx.roundRect(-13, y - 2.4, 9, 4.2, 1.4); ctx.fill();   // stock
      ctx.fillStyle = '#3E4650';
      ctx.beginPath(); ctx.roundRect(2, y - 1.6, 12, 2.6, 1); ctx.fill();      // barrel
      ctx.fillStyle = '#1A1E24';
      ctx.beginPath(); ctx.roundRect(-3, y + 1.6, 5, 6, 1.4); ctx.fill();      // magazine
      ctx.strokeStyle = '#0A0D12'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.roundRect(-13, y - 3, 26, 5.4, 1.6); ctx.stroke();
      ctx.restore();
      // the sling strap across the shoulder
      ctx.strokeStyle = 'rgba(20,24,30,0.75)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-6, -e.r * 0.5); ctx.lineTo(4, e.r * 0.5); ctx.stroke();
      ctx.restore();
      return;
    }

    // sidearm: holster body with the grip and hammer standing proud
    ctx.fillStyle = '#241A12';
    ctx.beginPath(); ctx.roundRect(-4, y - 1, 9, 9, 2); ctx.fill();
    ctx.strokeStyle = '#0C0906'; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.fillStyle = '#33383F';
    ctx.beginPath(); ctx.roundRect(-2.5, y - 5, 5.5, 5, 1.4); ctx.fill();      // grip
    ctx.fillStyle = '#6E7883';
    ctx.beginPath(); ctx.roundRect(-1, y - 6.4, 3, 2, 0.8); ctx.fill();        // hammer
    // retaining strap
    ctx.strokeStyle = '#4A3626'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-4, y + 1.5); ctx.lineTo(5, y + 1.5); ctx.stroke();
    ctx.restore();
  }

  function drawEnemyGun(e, gx) {
    // Before they have noticed you the weapon is still on the hip.
    const drawing = e.draw > 0;
    const holstered = !e.alerted;
    if (holstered) {
      drawHolstered(e);
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
    if (w.kind === 'melee') hudEl('hud-ammo').textContent = '-';
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
                  H.world.atms.filter(a => !a.open).length +
                  H.world.deposits.filter(b => !b.open).length;
    if (H.extractPhase && H.stragglers > 0)
      obj.textContent = 'Waiting on ' + H.stragglers + ' - press E again to go without them';
    else if (H.canExtract) obj.textContent = 'Press E to drive off';
    else if (H.extractLeft > 0 && dist(H.robo, H.world.car) < H.world.car.r)
      obj.textContent = 'The driver is still warming it up. ' +
                        Math.ceil(H.extractLeft / 1000) + 's';
    else if (!H.world.vaults[0].open)
      obj.textContent = 'Crack the main vault. Nothing else counts as the job';
    else if (openVaults < H.world.vaults.length)
      obj.textContent = tills
        ? 'Drill the vault. ' + tills + ' till' + (tills > 1 ? 's' : '') + ' still shut, if you have time'
        : 'Set the drill on the vault. Press E at the mark, or mark it for the crew';
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
