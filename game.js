// ============================================================
// RoboKyle — top-down wave-survival shooter
// Camera + zoom, larger world, smarter AI, minimap,
// WebAudio-synth music + SFX (all original, no external files).
// ============================================================
(() => {
  'use strict';

  // roundRect polyfill for older browsers
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      const rr = Math.min(typeof r === 'number' ? r : 0, Math.abs(w) / 2, Math.abs(h) / 2);
      this.moveTo(x + rr, y);
      this.arcTo(x + w, y, x + w, y + h, rr);
      this.arcTo(x + w, y + h, x, y + h, rr);
      this.arcTo(x, y + h, x, y, rr);
      this.arcTo(x, y, x + w, y, rr);
      this.closePath();
      return this;
    };
  }

  // ==================== DOM ====================
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const mini = document.getElementById('minimap');
  const mctx = mini.getContext('2d');
  const hud = {
    hp:        document.getElementById('hud-hp'),
    hpBar:     document.getElementById('hud-hp-bar'),
    sprintBar: document.getElementById('hud-sprint-bar'),
    wave:      document.getElementById('hud-wave'),
    weapon:    document.getElementById('hud-weapon'),
    ammo:      document.getElementById('hud-ammo'),
    score:     document.getElementById('hud-score'),
    combo:     document.getElementById('hud-combo'),
    comboNum:  document.getElementById('hud-combo-num'),
  };
  const banner = document.getElementById('waveBanner');
  const bannerText = document.getElementById('waveBannerText');
  const bannerSub = document.getElementById('waveBannerSub');
  const pauseOverlay = document.getElementById('overlay-pause');
  const gameoverOverlay = document.getElementById('overlay-gameover');

  // ==================== CONFIG ====================
  const W = canvas.width;   // 960 — viewport width
  const H = canvas.height;  // 640 — viewport height
  const BASE_SPEED = 2.7;
  const SPRINT_SPEED = 4.6;
  const SPRINT_BUDGET_MS = 1600;
  const SPRINT_REGEN = 0.35;
  const COMBO_WINDOW = 2400; // ms to keep combo alive

  // ==================== STATE ====================
  const S = {
    screen: 'title',
    map: null,
    mapData: null,
    settings: {
      volume: 0.45,      // SFX
      musicVolume: 0.30, // music
      difficulty: 'normal',
      shake: true,
      blood: true,
    },
    best: parseInt(localStorage.getItem('rk_best') || '0', 10),
    player: null,
    enemies: [],
    corpses: [],
    bullets: [],
    pickups: [],
    particles: [],
    explosions: [],
    tracers: [],
    decals: [],       // permanent blood pools / splatter on the ground
    gibs: [],         // flying chunks that leave trails
    screenBlood: [],  // blood spatter on the "lens"
    casings: [],      // ejected shell casings
    smoke: [],        // muzzle / explosion smoke puffs
    damageNums: [],   // floating damage readouts
    sparks: [],       // impact sparks on walls
    shockwaves: [],   // expanding rings from explosions
    groanTimer: 2000, // ambient zombie ambience
    lowHpTimer: 0,    // heartbeat beep when hurt
    hitStop: 0,       // brief freeze-frame on big hits
    flashBang: 0,     // white screen pop
    wave: 0,
    waveActive: false,
    interWaveTimer: 0,
    spawnBudget: 0,
    spawnTimer: 0,
    score: 0,
    combo: 0,
    comboTimer: 0,
    running: false,
    paused: false,
    shake: 0,
    keys: {},
    mouseSX: W / 2,    // mouse on canvas (screen-space)
    mouseSY: H / 2,
    mouseX: 0,          // mouse in world-space (recomputed each frame)
    mouseY: 0,
    mouseDown: false,
    lastTime: 0,
    // touch input (mobile). moveX/moveY and aimX/aimY are unit-ish
    // vectors from the on-screen sticks; magnitude drives walk speed.
    touch: {
      active: false,   // touch control scheme is live for this session
      moveX: 0, moveY: 0,
      aimX: 1, aimY: 0,
      aiming: false,
      firing: false,
      sprint: false,
    },
    // camera
    cam: { x: W/2, y: H/2, zoom: 1.0, targetZoom: 1.0 },
  };

  // ==================== SETTINGS PERSISTENCE ====================
  try { Object.assign(S.settings, JSON.parse(localStorage.getItem('rk_settings') || '{}')); } catch (e) {}
  const saveSettings = () => { try { localStorage.setItem('rk_settings', JSON.stringify(S.settings)); } catch (e) {} };

  // ==================== WEAPONS ====================
  const WEAPONS = {
    pistol:  { name: 'Pistol',  cd: 220, dmg: 26, speed: 12, spread: 0.02, pellets: 1, ammo: Infinity, auto: false, color: '#F5E5A0', size: 3, range: 900, tracer: false },
    uzi:     { name: 'Uzi',     cd: 70,  dmg: 12, speed: 13, spread: 0.11, pellets: 1, ammo: 0,        auto: true,  color: '#FFD070', size: 3, range: 780, tracer: true },
    shotgun: { name: 'Shotgun', cd: 560, dmg: 18, speed: 11, spread: 0.28, pellets: 8, ammo: 0,        auto: false, color: '#FF8A50', size: 3, range: 560, tracer: false },
    rocket:  { name: 'Rocket',  cd: 900, dmg: 100,speed: 8,  spread: 0,    pellets: 1, ammo: 0,        auto: false, color: '#FF5030', size: 5, range: 900, explosive: true, radius: 100, tracer: false },
  };

  // ==================== ENEMY TYPES ====================
  const ENEMY_TYPES = {
    grunt:    { hp: 42,  speed: 0.9, dmg: 12, r: 15, color: '#4A6B3E', armColor: '#3E5A32', eye: '#F5C842', points: 10, minWave: 1, drop: 0.32, weight: 4 },
    sprinter: { hp: 28,  speed: 2.0, dmg: 8,  r: 12, color: '#5C4A6E', armColor: '#4A3D5A', eye: '#F5844A', points: 15, minWave: 3, drop: 0.36, weight: 3 },
    bomber:   { hp: 55,  speed: 1.1, dmg: 34, r: 16, color: '#8A3E2E', armColor: '#6E3226', eye: '#FFC040', points: 25, minWave: 5, drop: 0.25, weight: 2, explosive: true, radius: 78 },
    brute:    { hp: 200, speed: 0.7, dmg: 24, r: 22, color: '#2A2830', armColor: '#1E1C24', eye: '#E36B3E', points: 50, minWave: 8, drop: 0.60, weight: 1 },
  };

  // ==================== MAPS ====================
  // Larger world areas with more environmental detail.
  const MAPS = {
    yard: {
      name: 'The Backyard',
      worldW: 2400, worldH: 1700,
      floor: '#1E2A1B', floor2: '#243026', line: '#2D3B26', accent: '#3E5A32',
      // Hedges (long walls), shed, planters, barrels
      obstacles: [
        // Perimeter hedges (thick, gap-free walls at world edges done by bounds check)
        // Interior hedges
        { x: 300, y: 200, w: 500, h: 30, tone: '#33472A' },
        { x: 300, y: 200, w: 30, h: 320, tone: '#33472A' },
        { x: 800, y: 700, w: 30, h: 340, tone: '#33472A' },
        { x: 1200, y: 1000, w: 460, h: 30, tone: '#33472A' },
        { x: 1600, y: 400, w: 30, h: 340, tone: '#33472A' },
        // Shed
        { x: 1900, y: 200, w: 220, h: 160, tone: '#5A4632' },
        // Long fence
        { x: 400, y: 1400, w: 700, h: 26, tone: '#5A4632' },
        // Small planters
        { x: 1200, y: 300, w: 60, h: 60, tone: '#4A5236' },
        { x: 1400, y: 700, w: 60, h: 60, tone: '#4A5236' },
        { x: 700, y: 900, w: 60, h: 60, tone: '#4A5236' },
        { x: 2000, y: 1200, w: 60, h: 60, tone: '#4A5236' },
        { x: 200, y: 1100, w: 60, h: 60, tone: '#4A5236' },
        // Barrels (small square)
        { x: 1050, y: 400, w: 36, h: 36, tone: '#6E4A30' },
        { x: 1100, y: 400, w: 36, h: 36, tone: '#6E4A30' },
        { x: 500, y: 800, w: 36, h: 36, tone: '#6E4A30' },
        { x: 1750, y: 1300, w: 36, h: 36, tone: '#6E4A30' },
      ],
    },
    warehouse: {
      name: 'The Warehouse',
      worldW: 2400, worldH: 1700,
      floor: '#12151D', floor2: '#191D28', line: '#252A38', accent: '#3A465A',
      obstacles: [
        // Central spine — a long wall with gaps
        { x: 800, y: 400, w: 40, h: 300, tone: '#2C3140' },
        { x: 800, y: 800, w: 40, h: 500, tone: '#2C3140' },
        { x: 1560, y: 300, w: 40, h: 380, tone: '#2C3140' },
        { x: 1560, y: 800, w: 40, h: 400, tone: '#2C3140' },
        // Crate stacks (rows)
        { x: 260, y: 260, w: 90, h: 90, tone: '#4A3C24' },
        { x: 260, y: 400, w: 90, h: 90, tone: '#4A3C24' },
        { x: 260, y: 540, w: 90, h: 90, tone: '#4A3C24' },
        { x: 260, y: 1050, w: 90, h: 90, tone: '#4A3C24' },
        { x: 260, y: 1190, w: 90, h: 90, tone: '#4A3C24' },
        // Right side stacks
        { x: 2050, y: 260, w: 90, h: 90, tone: '#4A3C24' },
        { x: 2050, y: 400, w: 90, h: 90, tone: '#4A3C24' },
        { x: 2050, y: 1050, w: 90, h: 90, tone: '#4A3C24' },
        { x: 2050, y: 1190, w: 90, h: 90, tone: '#4A3C24' },
        // Middle single crates for cover
        { x: 1100, y: 220, w: 70, h: 70, tone: '#4A3C24' },
        { x: 1250, y: 220, w: 70, h: 70, tone: '#4A3C24' },
        { x: 1100, y: 1300, w: 70, h: 70, tone: '#4A3C24' },
        { x: 1250, y: 1300, w: 70, h: 70, tone: '#4A3C24' },
        // Pillars around center
        { x: 1100, y: 700, w: 60, h: 60, tone: '#3A3F52' },
        { x: 1280, y: 700, w: 60, h: 60, tone: '#3A3F52' },
        { x: 1100, y: 900, w: 60, h: 60, tone: '#3A3F52' },
        { x: 1280, y: 900, w: 60, h: 60, tone: '#3A3F52' },
      ],
    },
    rooftop: {
      name: 'The Rooftop',
      worldW: 1900, worldH: 1300,
      floor: '#1E2530', floor2: '#252F3E', line: '#2F3A4C', accent: '#4A5A72',
      bounds: { x: 120, y: 100, w: 1660, h: 1100 },
      obstacles: [
        // HVAC boxes
        { x: 400, y: 300, w: 140, h: 90, tone: '#3A465A' },
        { x: 400, y: 400, w: 140, h: 30, tone: '#4A5A72' },
        { x: 1200, y: 800, w: 140, h: 90, tone: '#3A465A' },
        { x: 1200, y: 900, w: 140, h: 30, tone: '#4A5A72' },
        // Ducts
        { x: 700, y: 250, w: 30, h: 300, tone: '#3A465A' },
        { x: 1050, y: 700, w: 30, h: 300, tone: '#3A465A' },
        // Small chimney
        { x: 900, y: 500, w: 80, h: 80, tone: '#4A3E32' },
        // Skylights (visual cover)
        { x: 300, y: 900, w: 120, h: 60, tone: '#3A4258' },
        { x: 1450, y: 250, w: 120, h: 60, tone: '#3A4258' },
      ],
    },
  };

  // ==================== UTIL ====================
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const circleRect = (cx, cy, r, rx, ry, rw, rh) => {
    const nx = clamp(cx, rx, rx + rw);
    const ny = clamp(cy, ry, ry + rh);
    return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
  };
  const collidesObstacles = (x, y, r) => {
    for (const o of S.mapData.obstacles) if (circleRect(x, y, r, o.x, o.y, o.w, o.h)) return true;
    return false;
  };
  const inWorldBounds = (x, y, r) => {
    if (S.mapData.bounds) {
      const b = S.mapData.bounds;
      return x - r > b.x && x + r < b.x + b.w && y - r > b.y && y + r < b.y + b.h;
    }
    return x - r > 0 && x + r < S.mapData.worldW && y - r > 0 && y + r < S.mapData.worldH;
  };
  const worldToScreen = (wx, wy) => ({
    x: (wx - S.cam.x) * S.cam.zoom + W / 2,
    y: (wy - S.cam.y) * S.cam.zoom + H / 2,
  });
  const screenToWorld = (sx, sy) => ({
    x: (sx - W / 2) / S.cam.zoom + S.cam.x,
    y: (sy - H / 2) / S.cam.zoom + S.cam.y,
  });
  const diffMod = () => ({ easy: 0.75, normal: 1.0, hard: 1.4 })[S.settings.difficulty];

  // ==================== AUDIO (SFX + MUSIC) ====================
  let audioCtx = null;
  let sfxGain = null;
  let musicGain = null;

  const ensureAudio = () => {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        sfxGain = audioCtx.createGain();
        sfxGain.gain.value = S.settings.volume;
        sfxGain.connect(audioCtx.destination);
        musicGain = audioCtx.createGain();
        musicGain.gain.value = 0; // fades in when music starts
        musicGain.connect(audioCtx.destination);
        music.setup(audioCtx, musicGain);
      } catch (e) {}
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  };
  const setSfxVolume = (v) => { if (sfxGain) sfxGain.gain.value = v; };
  const setMusicVolume = (v) => { if (musicGain) musicGain.gain.setTargetAtTime(v, audioCtx.currentTime, 0.15); };

  // -- Small SFX helpers
  const tone = (freq, dur, type = 'square', vol = 0.15, when = 0) => {
    if (!audioCtx) return;
    const t = audioCtx.currentTime + when;
    const g = audioCtx.createGain();
    const o = audioCtx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(sfxGain);
    o.start(t);
    o.stop(t + dur + 0.02);
  };
  const noise = (dur, vol, filterFreq = 3000, filterQ = 0.7, when = 0) => {
    if (!audioCtx) return;
    const t = audioCtx.currentTime + when;
    const size = audioCtx.sampleRate * dur;
    const buf = audioCtx.createBuffer(1, size, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < size; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, 2.5);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const f = audioCtx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = filterFreq; f.Q.value = filterQ;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(sfxGain);
    src.start(t);
  };
  const sweep = (fromF, toF, dur, type = 'sawtooth', vol = 0.14) => {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const g = audioCtx.createGain();
    const o = audioCtx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(fromF, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, toF), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  };

  // Layered noise burst with a pitch-swept body — the backbone of the gun sounds.
  const boom = (lowF, dur, vol, filterF, q = 0.6) => {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(lowF, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(24, lowF * 0.28), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
    noise(dur * 0.8, vol * 0.7, filterF, q);
  };

  // Metallic ring — for shell casings, ricochets, mech sounds.
  const clang = (freq, dur, vol = 0.08) => {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    for (const mult of [1, 2.76, 5.4]) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(freq * mult, t);
      g.gain.setValueAtTime(vol / mult, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(sfxGain);
      o.start(t); o.stop(t + dur + 0.02);
    }
  };

  // Guttural monster voice — stacked detuned saws through a lowpass.
  const growl = (baseF, dur, vol = 0.13, bend = 0.6) => {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(240, t + dur);
    lp.Q.value = 4;
    const master = audioCtx.createGain();
    master.gain.setValueAtTime(vol, t);
    master.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(master).connect(sfxGain);
    for (const det of [-18, 0, 15]) {
      const o = audioCtx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(baseF, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(28, baseF * bend), t + dur);
      o.detune.setValueAtTime(det, t);
      o.connect(lp);
      o.start(t); o.stop(t + dur + 0.02);
    }
    // wet rasp on top
    noise(dur * 0.7, vol * 0.35, 900, 1.6);
  };

  const sfx = {
    // ---------- weapons ----------
    pistol: () => {
      boom(320, 0.13, 0.20, 2600, 0.7);
      tone(1500, 0.035, 'square', 0.09);
      setTimeout(() => clang(2400, 0.10, 0.035), 190);   // shell hits the floor
    },
    uzi: () => {
      boom(260, 0.075, 0.13, 3200, 0.9);
      tone(1750 + rand(-120, 120), 0.022, 'square', 0.055);
    },
    shotgun: () => {
      boom(170, 0.30, 0.30, 1100, 0.5);
      sweep(700, 110, 0.14, 'sawtooth', 0.14);
      noise(0.22, 0.16, 620, 0.4);
      setTimeout(() => { noise(0.09, 0.05, 1800, 1.2); clang(1400, 0.14, 0.05); }, 260); // pump action
    },
    rocket: () => {
      sweep(420, 95, 0.42, 'sawtooth', 0.16);
      noise(0.38, 0.11, 700, 0.4);
      tone(70, 0.34, 'sine', 0.14);
    },
    dryFire: () => { clang(1900, 0.05, 0.05); tone(140, 0.04, 'square', 0.04); },

    // ---------- impacts ----------
    boom: () => {
      boom(180, 0.55, 0.34, 320, 0.4);
      sweep(240, 34, 0.48, 'sawtooth', 0.22);
      noise(0.45, 0.20, 180, 0.35);
      setTimeout(() => noise(0.5, 0.07, 420, 0.5), 120);  // debris rain
    },
    hit: () => {
      tone(240 + rand(-40, 40), 0.045, 'square', 0.07);
      noise(0.05, 0.07, 1500, 1.3);
    },
    fleshHit: () => { noise(0.07, 0.10, 480, 0.7); tone(120, 0.05, 'sine', 0.06); },
    ricochet: () => {
      const f = 1700 + rand(-300, 500);
      sweep(f, f * 0.35, 0.16, 'square', 0.055);
      clang(f, 0.12, 0.03);
    },
    hurt: () => {
      growl(150, 0.22, 0.11, 0.55);
      tone(90, 0.18, 'sine', 0.10);
      noise(0.10, 0.08, 700, 0.8);
    },

    // ---------- gore ----------
    splat: () => { noise(0.13, 0.14, 380, 0.55); tone(85 + rand(-15, 15), 0.09, 'sine', 0.08); },
    gib:   () => { noise(0.22, 0.17, 260, 0.45); sweep(190, 55, 0.18, 'sawtooth', 0.10); tone(60, 0.20, 'sine', 0.09); },

    // ---------- zombie voices ----------
    zombieDeath: (type) => {
      if (type === 'brute') {
        growl(78, 0.60, 0.19, 0.45);                       // deep dying bellow
        setTimeout(() => { noise(0.28, 0.14, 300, 0.5); tone(52, 0.30, 'sine', 0.11); }, 150);
      } else if (type === 'bomber') {
        growl(150, 0.26, 0.13, 0.5);
        setTimeout(() => noise(0.10, 0.09, 900, 0.9), 90);  // fuse hiss
      } else if (type === 'sprinter') {
        growl(230, 0.24, 0.12, 0.42);                       // shriek
        sweep(560, 190, 0.20, 'sawtooth', 0.07);
      } else {
        growl(125, 0.34, 0.13, 0.5);                        // classic groan
        setTimeout(() => noise(0.12, 0.08, 520, 0.7), 110);
      }
    },
    zombieGroan: () => growl(105 + rand(-25, 35), rand(0.4, 0.7), 0.055, 0.62),
    zombieSpawn: () => { growl(95, 0.30, 0.05, 0.7); noise(0.14, 0.03, 400, 0.6); },

    // ---------- pickups / UI ----------
    pickupAmmo: () => { tone(880, 0.045, 'square', 0.08); tone(1320, 0.06, 'square', 0.08, 0.045); clang(2600, 0.08, 0.025); },
    pickupHP:   () => { tone(660, 0.07, 'triangle', 0.09); tone(880, 0.07, 'triangle', 0.09, 0.06); tone(1320, 0.14, 'triangle', 0.10, 0.12); },
    swap:       () => { clang(1200, 0.09, 0.05); tone(420, 0.03, 'square', 0.05); tone(700, 0.04, 'square', 0.05, 0.035); },
    empty:      () => { clang(1900, 0.05, 0.045); tone(130, 0.05, 'square', 0.04); },

    // ---------- events ----------
    waveStart: () => {
      // rising alarm into a hit
      sweep(180, 720, 0.55, 'sawtooth', 0.11);
      setTimeout(() => { boom(150, 0.4, 0.22, 500, 0.5); growl(70, 0.5, 0.10, 0.5); }, 520);
    },
    waveClear: () => {
      const seq = [523.25, 659.25, 783.99, 1046.5];
      seq.forEach((f, i) => {
        tone(f, 0.14, 'square', 0.09, i * 0.09);
        tone(f * 1.5, 0.14, 'triangle', 0.05, i * 0.09);
      });
    },
    combo: (n) => {
      const f = 500 + Math.min(n, 12) * 85;
      tone(f, 0.06, 'square', 0.06);
      tone(f * 1.5, 0.08, 'triangle', 0.04, 0.04);
    },
    gameover: () => {
      growl(180, 1.0, 0.20, 0.22);
      [330, 262, 196, 147].forEach((f, i) => tone(f, 0.45, 'sawtooth', 0.13, i * 0.22));
      setTimeout(() => noise(0.7, 0.10, 200, 0.4), 400);
    },
    lowHealth: () => { tone(1200, 0.05, 'sine', 0.05); tone(900, 0.07, 'sine', 0.05, 0.07); },
  };

  // ==================== MUSIC ENGINE ====================
  // Original 8-bit driving loop in E minor (no copyrighted material).
  // Kick / snare / hi-hat / palm-muted square bass / occasional lead lick.
  // ============================================================
  // MUSIC — original 16-bit style metal loop, E phrygian.
  // 4 sections x 16 bars, ~128 steps of melody so it doesn't
  // wear out. All synthesized: detuned saw leads, sub bass,
  // gated power chords, and a real rock kit.
  // ============================================================
  const NOTE = {
    E1: 41.20,  G1: 49.00,  A1: 55.00,  B1: 61.74,  C2: 65.41,  D2: 73.42,
    E2: 82.41,  F2: 87.31,  G2: 98.00,  A2: 110.00, B2: 123.47, C3: 130.81,
    D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00,
    B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25,
  };

  const music = {
    started: false,
    step: 0,
    nextTime: 0,
    bpm: 148,
    stepDur: 0,
    dest: null,
    timer: null,
    intensity: 0,   // 0..1 — rises with the wave count

    setup(ctx, dest) {
      this.dest = dest;
      this.stepDur = 60 / this.bpm / 4;   // 16th notes
      const N = NOTE;
      const _ = 0;

      // ---- Riff root per bar (16 bars, phrygian-flavoured) ----
      // E - E - F - E   |  E - G - F - E  |  E - E - C - D  |  E - F - G - E
      this.roots = [
        N.E1, N.E1, N.F2 / 2, N.E1,
        N.E1, N.G1, N.F2 / 2, N.E1,
        N.E1, N.E1, N.C2,     N.D2,
        N.E1, N.F2 / 2, N.G1, N.E1,
      ];

      // ---- Gallop pattern per bar: which 16ths the bass/chord hit ----
      // classic dm-dm-dm gallop: x..x.x..x..x.x..
      this.gallop = [1,0,0,1,0,1,0,0, 1,0,0,1,0,1,0,0];

      // ---- LEAD MELODY: 8 bars x 16 = 128 steps ----
      // Sits over bars 8-15 so the first half is riff-only, then it soars.
      this.lead = [
        // bar 8 — pickup and climb
        _,_,_,_,      N.E4,_,N.G4,_,   N.A4,_,_,_,      N.B4,_,_,_,
        // bar 9 — hang and fall
        N.B4,_,_,N.A4, _,N.G4,_,_,      N.E4,_,_,_,      _,_,N.D4,N.E4,
        // bar 10 — second phrase, higher
        N.G4,_,N.A4,_, N.B4,_,_,_,      N.D5,_,_,N.B4,   _,N.A4,_,_,
        // bar 11 — resolve down
        N.G4,_,_,_,    N.E4,_,N.D4,_,   N.E4,_,_,_,      _,_,_,_,
        // bar 12 — tension, chromatic push
        N.E4,_,N.F4,_, N.G4,_,N.A4,_,   N.B4,_,N.C5,_,   N.B4,_,N.A4,_,
        // bar 13 — high sustain
        N.E5,_,_,_,    _,_,N.D5,_,      N.B4,_,_,_,      N.A4,_,N.G4,_,
        // bar 14 — descending run
        N.E4,N.D4,N.C4,N.B3, N.A3,_,_,_, N.B3,_,N.C4,_,  N.D4,_,N.E4,_,
        // bar 15 — final hold into the loop
        N.E4,_,_,_,    N.G4,_,_,_,      N.A4,_,_,_,      _,_,_,_,
      ];

      // ---- Harmony line, a third under the lead on the big moments ----
      this.harm = this.lead.map((n, i) => {
        if (!n) return 0;
        // drop a minor third for a chunkier 16-bit feel
        return (i > 63) ? n * 0.7937 : 0;
      });
    },

    start() {
      if (this.started || !audioCtx) return;
      this.started = true;
      this.step = 0;
      this.nextTime = audioCtx.currentTime + 0.1;
      this.timer = setInterval(() => this.tick(), 25);
    },
    stop() {
      this.started = false;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    },
    setIntensity(v) { this.intensity = clamp(v, 0, 1); },

    tick() {
      if (!this.started || !audioCtx) return;
      while (this.nextTime < audioCtx.currentTime + 0.2) {
        this.playStep(this.step, this.nextTime);
        this.step = (this.step + 1) % 256;   // 16 bars
        this.nextTime += this.stepDur;
      }
    },

    playStep(step, t) {
      const bar = Math.floor(step / 16) % 16;
      const b = step % 16;
      const root = this.roots[bar];
      const half = Math.floor(step / 128);   // 0 = first 8 bars, 1 = second

      // ---------- DRUMS ----------
      if (b === 0 || b === 6 || b === 10) this.kick(t);
      if (bar >= 4 && (b === 3 || b === 13)) this.kick(t);       // extra gallop kicks
      if (b === 4 || b === 12) this.snare(t);
      if (bar >= 8 && b === 14) this.snare(t, 0.6);              // ghost note
      // hats: 8ths early, 16ths once the lead comes in
      if (bar < 8 ? (b % 4 === 0) : (b % 2 === 0)) this.hat(t, b % 8 === 0 ? 0.13 : 0.08);
      // crash on section changes
      if (b === 0 && (bar === 0 || bar === 8)) this.crash(t);
      // tom fill at the end of each 8-bar block
      if (bar === 7 || bar === 15) {
        if (b === 8)  this.tom(t, 190);
        if (b === 10) this.tom(t, 160);
        if (b === 12) this.tom(t, 130);
        if (b === 14) this.tom(t, 105);
      }

      // ---------- BASS (gallop, palm-muted) ----------
      if (this.gallop[b]) {
        const accent = (b === 0 || b === 8) ? 1.25 : 1;
        this.bass(root, t, accent);
      }

      // ---------- POWER CHORD STABS ----------
      if (b === 0 || b === 8) this.power(root * 4, t);
      if (bar >= 8 && b === 6) this.power(root * 4, t, 0.6);

      // ---------- LEAD + HARMONY ----------
      const li = step % 128;
      if (half === 1 || bar >= 8) {
        const ln = this.lead[li];
        if (ln) this.leadVoice(ln, t);
        const hn = this.harm[li];
        if (hn) this.leadVoice(hn, t, 0.45);
      }

      // ---------- ARP SHIMMER (only at high intensity) ----------
      if (this.intensity > 0.45 && b % 4 === 2) {
        const arp = [root * 8, root * 12, root * 16][Math.floor(step / 4) % 3];
        this.arp(arp, t);
      }
    },

    // ---- instruments ----
    kick(t) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(165, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.09);
      g.gain.setValueAtTime(0.52, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
      o.connect(g).connect(this.dest);
      o.start(t); o.stop(t + 0.2);
      // click transient
      const c = audioCtx.createOscillator(), cg = audioCtx.createGain();
      c.type = 'square'; c.frequency.setValueAtTime(900, t);
      cg.gain.setValueAtTime(0.10, t);
      cg.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
      c.connect(cg).connect(this.dest);
      c.start(t); c.stop(t + 0.03);
    },
    snare(t, vol = 1) {
      const dur = 0.16;
      const size = Math.floor(audioCtx.sampleRate * dur);
      const buf = audioCtx.createBuffer(1, size, audioCtx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < size; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, 2.6);
      const src = audioCtx.createBufferSource(); src.buffer = buf;
      const bp = audioCtx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1750; bp.Q.value = 0.75;
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0.30 * vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(bp).connect(g).connect(this.dest);
      src.start(t);
      // body tone under the noise
      const o = audioCtx.createOscillator(), og = audioCtx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(200, t);
      o.frequency.exponentialRampToValueAtTime(140, t + 0.07);
      og.gain.setValueAtTime(0.13 * vol, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      o.connect(og).connect(this.dest);
      o.start(t); o.stop(t + 0.11);
    },
    hat(t, vol = 0.09) {
      const dur = 0.032;
      const size = Math.floor(audioCtx.sampleRate * dur);
      const buf = audioCtx.createBuffer(1, size, audioCtx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < size; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, 5);
      const src = audioCtx.createBufferSource(); src.buffer = buf;
      const hp = audioCtx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 7200;
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(hp).connect(g).connect(this.dest);
      src.start(t);
    },
    crash(t) {
      const dur = 0.9;
      const size = Math.floor(audioCtx.sampleRate * dur);
      const buf = audioCtx.createBuffer(1, size, audioCtx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < size; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, 1.4);
      const src = audioCtx.createBufferSource(); src.buffer = buf;
      const hp = audioCtx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 4200;
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(hp).connect(g).connect(this.dest);
      src.start(t);
    },
    tom(t, freq) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.14);
      g.gain.setValueAtTime(0.26, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g).connect(this.dest);
      o.start(t); o.stop(t + 0.2);
    },
    bass(freq, t, accent = 1) {
      const dur = this.stepDur * 0.82;
      // sub sine
      const s = audioCtx.createOscillator(), sg = audioCtx.createGain();
      s.type = 'sine'; s.frequency.setValueAtTime(freq, t);
      sg.gain.setValueAtTime(0, t);
      sg.gain.linearRampToValueAtTime(0.20 * accent, t + 0.006);
      sg.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(sg).connect(this.dest);
      s.start(t); s.stop(t + dur + 0.02);
      // distorted saw an octave up, filtered — the "guitar" chug
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      const lp = audioCtx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(900 + this.intensity * 900, t);
      lp.Q.value = 6;
      o.type = 'sawtooth'; o.frequency.setValueAtTime(freq * 2, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.11 * accent, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.75);
      o.connect(lp).connect(g).connect(this.dest);
      o.start(t); o.stop(t + dur + 0.02);
    },
    power(freq, t, vol = 1) {
      // root + fifth, detuned saws = power chord
      const dur = this.stepDur * 2.6;
      for (const [mult, det] of [[1, -4], [1, 4], [1.4983, -3], [1.4983, 3]]) {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        const lp = audioCtx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = 1;
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(freq * mult, t);
        o.detune.setValueAtTime(det, t);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.030 * vol, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(lp).connect(g).connect(this.dest);
        o.start(t); o.stop(t + dur + 0.02);
      }
    },
    leadVoice(freq, t, vol = 1) {
      const dur = this.stepDur * 3.1;
      // two detuned saws + a square for bite
      for (const [type, det, amp] of [['sawtooth', -7, 0.055], ['sawtooth', 7, 0.055], ['square', 0, 0.030]]) {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        const lp = audioCtx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2600, t);
        lp.frequency.exponentialRampToValueAtTime(1500, t + dur);
        lp.Q.value = 2;
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        o.detune.setValueAtTime(det, t);
        // slight vibrato on the tail
        o.frequency.setValueAtTime(freq, t + dur * 0.4);
        o.frequency.linearRampToValueAtTime(freq * 1.006, t + dur * 0.7);
        o.frequency.linearRampToValueAtTime(freq, t + dur);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(amp * vol, t + 0.012);
        g.gain.setValueAtTime(amp * vol, t + dur * 0.55);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(lp).connect(g).connect(this.dest);
        o.start(t); o.stop(t + dur + 0.03);
      }
    },
    arp(freq, t) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.022, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + this.stepDur * 0.8);
      o.connect(g).connect(this.dest);
      o.start(t); o.stop(t + this.stepDur + 0.02);
    },
  };

  // ==================== SCREENS ====================
  const screenEls = {
    title:       document.getElementById('screen-title'),
    mapSelect:   document.getElementById('screen-mapSelect'),
    multiplayer: document.getElementById('screen-multiplayer'),
    howTo:       document.getElementById('screen-howTo'),
    settings:    document.getElementById('screen-settings'),
    play:        document.getElementById('screen-play'),
  };
  const show = (name) => {
    Object.values(screenEls).forEach(el => el.classList.remove('active'));
    if (screenEls[name]) screenEls[name].classList.add('active');
    S.screen = name;
    if (name === 'play') canvas.focus();
  };

  // ==================== SETTINGS BINDINGS ====================
  const volEl = document.getElementById('set-volume');
  const volValEl = document.getElementById('set-volume-value');
  const musicEl = document.getElementById('set-music');
  const musicValEl = document.getElementById('set-music-value');
  volEl.value = Math.round(S.settings.volume * 100);
  volValEl.textContent = volEl.value + '%';
  volEl.addEventListener('input', () => {
    S.settings.volume = volEl.value / 100;
    volValEl.textContent = volEl.value + '%';
    setSfxVolume(S.settings.volume);
    saveSettings();
  });
  musicEl.value = Math.round(S.settings.musicVolume * 100);
  musicValEl.textContent = musicEl.value + '%';
  musicEl.addEventListener('input', () => {
    S.settings.musicVolume = musicEl.value / 100;
    musicValEl.textContent = musicEl.value + '%';
    if (audioCtx) setMusicVolume(S.settings.musicVolume);
    saveSettings();
  });
  document.querySelectorAll('input[name="difficulty"]').forEach(r => {
    r.checked = (r.value === S.settings.difficulty);
    r.addEventListener('change', () => { if (r.checked) { S.settings.difficulty = r.value; saveSettings(); } });
  });
  document.querySelectorAll('input[name="shake"]').forEach(r => {
    r.checked = ((r.value === 'on') === S.settings.shake);
    r.addEventListener('change', () => { if (r.checked) { S.settings.shake = (r.value === 'on'); saveSettings(); } });
  });
  document.querySelectorAll('input[name="blood"]').forEach(r => {
    r.checked = ((r.value === 'on') === S.settings.blood);
    r.addEventListener('change', () => { if (r.checked) { S.settings.blood = (r.value === 'on'); saveSettings(); } });
  });

  // ==================== MENU HANDLERS ====================
  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => { ensureAudio(); show(btn.dataset.goto); });
  });
  document.querySelectorAll('[data-map]').forEach(btn => {
    btn.addEventListener('click', () => { ensureAudio(); startGame(btn.dataset.map); });
  });
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.action;
      if (a === 'resume')  resumeGame();
      if (a === 'restart') startGame(S.map);
      if (a === 'quit')    quitToMenu();
    });
  });

  // ==================== INPUT ====================
  const recomputeWorldMouse = () => {
    const w = screenToWorld(S.mouseSX, S.mouseSY);
    S.mouseX = w.x; S.mouseY = w.y;
  };

  window.addEventListener('keydown', e => {
    if (S.screen !== 'play') return;
    const k = e.key.toLowerCase();
    S.keys[k] = true;
    if (k === 'escape' || k === 'p') togglePause();
    if (!S.paused && S.running) {
      if (k === '1') switchWeapon('pistol');
      if (k === '2') switchWeapon('uzi');
      if (k === '3') switchWeapon('shotgun');
      if (k === '4') switchWeapon('rocket');
    }
    if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',' '].includes(k)) e.preventDefault();
  });
  window.addEventListener('keyup', e => { S.keys[e.key.toLowerCase()] = false; });
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    S.mouseSX = (e.clientX - rect.left) * (canvas.width / rect.width);
    S.mouseSY = (e.clientY - rect.top)  * (canvas.height / rect.height);
  });
  canvas.addEventListener('mousedown', e => { if (e.button === 0) { S.mouseDown = true; ensureAudio(); } });
  window.addEventListener('mouseup',   e => { if (e.button === 0)  S.mouseDown = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => {
    if (S.screen !== 'play') return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    S.cam.targetZoom = clamp(S.cam.targetZoom + delta, 0.55, 1.75);
  }, { passive: false });

  // ==================== TOUCH CONTROLS ====================
  // Two virtual sticks plus a small button cluster. Only wired up on
  // touch-capable devices (site.js decides that and puts `is-touch` on
  // <html>); a desktop mouse never sees any of it.
  const touchUI  = document.getElementById('touchUI');
  const gameFrame = document.querySelector('.game-frame');

  function isTouchDevice() {
    if (window.RK && window.RK.device) return window.RK.device.touch;
    // site.js should always be loaded first, but don't hard-depend on it.
    return ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
  }

  function setTouchMode(on) {
    S.touch.active = !!on;
    if (gameFrame) gameFrame.classList.toggle('touch-mode', !!on);
    if (touchUI) touchUI.setAttribute('aria-hidden', on ? 'false' : 'true');
    if (!on) resetTouchInput();
  }

  function resetTouchInput() {
    S.touch.moveX = 0; S.touch.moveY = 0;
    S.touch.aiming = false;
    S.touch.firing = false;
    S.touch.sprint = false;
  }

  if (touchUI && isTouchDevice()) {
    const MOVE_DEAD = 0.14;   // fraction of radius ignored near the centre
    const AIM_DEAD  = 0.18;

    // ---- Stick factory. Tracks one contact per stick by id, so two
    //      thumbs can drive both sticks at the same time.
    //      Uses Pointer Events where available and falls back to Touch
    //      Events (iOS 12 and older) so no device is left without input.
    const hasPointer = typeof window.PointerEvent === 'function';

    function makeStick(rootEl, knobEl, onMove, onEnd, deadZone) {
      let activeId = null;
      let originX = 0, originY = 0, radius = 50;

      const place = (cx, cy) => {
        let dx = cx - originX, dy = cy - originY;
        const d = Math.hypot(dx, dy);
        if (d > radius) { dx = dx / d * radius; dy = dy / d * radius; }
        knobEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        let nx = dx / radius, ny = dy / radius;
        const n = Math.hypot(nx, ny);
        if (n < deadZone) { nx = 0; ny = 0; }
        onMove(nx, ny, Math.min(1, n));
      };

      const grab = (id, cx, cy) => {
        activeId = id;
        const r = rootEl.getBoundingClientRect();
        originX = r.left + r.width / 2;
        originY = r.top + r.height / 2;
        radius = r.width / 2 || 50;
        rootEl.classList.add('is-active');
        ensureAudio();
        place(cx, cy);
      };

      const release = () => {
        if (activeId === null) return;
        activeId = null;
        knobEl.style.transform = '';
        rootEl.classList.remove('is-active');
        onEnd();
      };

      if (hasPointer) {
        rootEl.addEventListener('pointerdown', e => {
          if (activeId !== null) return;
          // Capture keeps the thumb bound to this stick even if it slides
          // off the pad. Not every engine implements it — never let a
          // failure here abort the rest of the handler.
          try { rootEl.setPointerCapture(e.pointerId); } catch (err) {}
          grab(e.pointerId, e.clientX, e.clientY);
          e.preventDefault();
        });

        rootEl.addEventListener('pointermove', e => {
          if (e.pointerId !== activeId) return;
          place(e.clientX, e.clientY);
          e.preventDefault();
        });

        const endIf = e => { if (e.pointerId === activeId) { release(); e.preventDefault(); } };
        rootEl.addEventListener('pointerup', endIf);
        rootEl.addEventListener('pointercancel', endIf);
        rootEl.addEventListener('lostpointercapture', e => {
          if (e.pointerId === activeId) release();
        });
      } else {
        const find = list => {
          for (let i = 0; i < list.length; i++) if (list[i].identifier === activeId) return list[i];
          return null;
        };
        rootEl.addEventListener('touchstart', e => {
          if (activeId !== null) return;
          const t = e.changedTouches[0];
          grab(t.identifier, t.clientX, t.clientY);
          e.preventDefault();
        }, { passive: false });
        // Bind move/end to the document: without pointer capture the
        // events stop targeting the pad once the thumb leaves it.
        document.addEventListener('touchmove', e => {
          const t = find(e.touches);
          if (!t) return;
          place(t.clientX, t.clientY);
          e.preventDefault();
        }, { passive: false });
        const endTouch = e => { if (find(e.changedTouches)) release(); };
        document.addEventListener('touchend', endTouch);
        document.addEventListener('touchcancel', endTouch);
      }
    }

    // ---- Move stick
    makeStick(
      document.getElementById('tcMove'),
      document.getElementById('tcMoveKnob'),
      (nx, ny) => { S.touch.moveX = nx; S.touch.moveY = ny; },
      () => { S.touch.moveX = 0; S.touch.moveY = 0; },
      MOVE_DEAD
    );

    // ---- Aim stick: pushing it aims AND fires, so one thumb does both.
    makeStick(
      document.getElementById('tcAim'),
      document.getElementById('tcAimKnob'),
      (nx, ny, n) => {
        if (n > AIM_DEAD) {
          S.touch.aimX = nx; S.touch.aimY = ny;
          S.touch.aiming = true;
          S.touch.firing = true;
        } else {
          S.touch.aiming = false;
          S.touch.firing = false;
        }
      },
      () => { S.touch.aiming = false; S.touch.firing = false; },
      0
    );

    // ---- Weapon slots
    document.querySelectorAll('.tc-wpn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        ensureAudio();
        switchWeapon(btn.dataset.weapon);
      });
    });

    // ---- Sprint: hold to run
    const sprintBtn = document.querySelector('.tc-sprint');
    if (sprintBtn) {
      const on  = e => { S.touch.sprint = true;  sprintBtn.classList.add('is-active'); e.preventDefault(); };
      const off = e => { S.touch.sprint = false; sprintBtn.classList.remove('is-active'); e.preventDefault(); };
      if (hasPointer) {
        sprintBtn.addEventListener('pointerdown', on);
        sprintBtn.addEventListener('pointerup', off);
        sprintBtn.addEventListener('pointercancel', off);
        sprintBtn.addEventListener('pointerleave', off);
      } else {
        sprintBtn.addEventListener('touchstart', on, { passive: false });
        sprintBtn.addEventListener('touchend', off);
        sprintBtn.addEventListener('touchcancel', off);
      }
    }

    // ---- Pause + zoom
    document.querySelectorAll('[data-touch]').forEach(btn => {
      const kind = btn.dataset.touch;
      if (kind === 'sprint') return;
      btn.addEventListener('click', e => {
        e.preventDefault();
        if (kind === 'pause') { resetTouchInput(); togglePause(); }
        if (kind === 'zoomin')  S.cam.targetZoom = clamp(S.cam.targetZoom + 0.15, 0.55, 1.75);
        if (kind === 'zoomout') S.cam.targetZoom = clamp(S.cam.targetZoom - 0.15, 0.55, 1.75);
      });
    });

    // Two-finger pinch on the canvas as a second way to zoom.
    // Pointer-Events only; the +/- buttons cover engines without it.
    let pinchStart = 0, pinchZoom = 1;
    const pinchPts = new Map();
    if (hasPointer) canvas.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      pinchPts.set(e.pointerId, e);
      if (pinchPts.size === 2) {
        const [a, b] = [...pinchPts.values()];
        pinchStart = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        pinchZoom = S.cam.targetZoom;
      }
    });
    if (hasPointer) canvas.addEventListener('pointermove', e => {
      if (e.pointerType !== 'touch' || !pinchPts.has(e.pointerId)) return;
      pinchPts.set(e.pointerId, e);
      if (pinchPts.size === 2 && pinchStart > 0) {
        const [a, b] = [...pinchPts.values()];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        S.cam.targetZoom = clamp(pinchZoom * (d / pinchStart), 0.55, 1.75);
        e.preventDefault();
      }
    }, { passive: false });
    const dropPinch = e => { pinchPts.delete(e.pointerId); if (pinchPts.size < 2) pinchStart = 0; };
    if (hasPointer) {
      canvas.addEventListener('pointerup', dropPinch);
      canvas.addEventListener('pointercancel', dropPinch);
    }

    // Stop input dead if the tab/app goes away mid-round.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) resetTouchInput();
    });
    window.addEventListener('blur', resetTouchInput);
  }

  // Keep the weapon slots in sync with what the player actually carries.
  function updateTouchWeapons() {
    if (!S.touch.active || !S.player) return;
    document.querySelectorAll('.tc-wpn').forEach(btn => {
      const w = btn.dataset.weapon;
      const ammo = S.player.ammo[w];
      btn.classList.toggle('is-active', S.player.weapon === w);
      btn.classList.toggle('is-empty', w !== 'pistol' && !(ammo > 0));
    });
  }

  // ==================== FLOW ====================
  function startGame(mapKey) {
    S.map = mapKey;
    S.mapData = MAPS[mapKey];
    S.enemies = [];
    S.corpses = [];
    S.bullets = [];
    S.pickups = [];
    S.particles = [];
    S.explosions = [];
    S.tracers = [];
    S.decals = [];
    S.gibs = [];
    S.screenBlood = [];
    S.casings = [];
    S.smoke = [];
    S.damageNums = [];
    S.sparks = [];
    S.shockwaves = [];
    S.groanTimer = 2000;
    S.lowHpTimer = 0;
    S.hitStop = 0;
    S.flashBang = 0;
    S.wave = 0;
    S.score = 0;
    S.combo = 0;
    S.comboTimer = 0;
    S.shake = 0;
    S.waveActive = false;
    S.interWaveTimer = 1800;
    S.spawnBudget = 0;
    S.spawnTimer = 0;
    S.paused = false;
    S.cam.zoom = 1.0;
    S.cam.targetZoom = 1.0;
    pauseOverlay.classList.remove('active');
    gameoverOverlay.classList.remove('active');
    hud.combo.classList.remove('show');
    setTouchMode(isTouchDevice());

    const spawn = findPlayerSpawn();
    S.player = {
      x: spawn.x, y: spawn.y, r: 15,
      hp: 100, maxHp: 100,
      angle: 0,
      weapon: 'pistol',
      ammo: { pistol: Infinity, uzi: 0, shotgun: 0, rocket: 0 },
      cd: 0,
      sprint: SPRINT_BUDGET_MS,
      hitFlash: 0,
      alive: true,
      lastShotFlash: 0,
      walkPhase: 0,
      idlePhase: 0,
      sprinting: false,
    };
    S.cam.x = S.player.x;
    S.cam.y = S.player.y;

    show('play');
    S.running = true;
    S.lastTime = performance.now();
    updateHUD();

    if (audioCtx) {
      music.stop();
      music.start();
      setMusicVolume(S.settings.musicVolume);
    }

    requestAnimationFrame(loop);
  }

  function findPlayerSpawn() {
    const cx = S.mapData.worldW / 2, cy = S.mapData.worldH / 2;
    if (!collidesObstacles(cx, cy, 20) && inWorldBounds(cx, cy, 20)) return { x: cx, y: cy };
    for (let i = 0; i < 400; i++) {
      const x = rand(150, S.mapData.worldW - 150);
      const y = rand(150, S.mapData.worldH - 150);
      if (!collidesObstacles(x, y, 20) && inWorldBounds(x, y, 20)) return { x, y };
    }
    return { x: cx, y: cy };
  }

  function togglePause() {
    if (!S.running || !S.player || !S.player.alive) return;
    S.paused = !S.paused;
    if (S.paused) resetTouchInput();
    pauseOverlay.classList.toggle('active', S.paused);
    if (S.paused) { if (audioCtx) setMusicVolume(S.settings.musicVolume * 0.35); }
    else          { S.lastTime = performance.now(); if (audioCtx) setMusicVolume(S.settings.musicVolume); }
  }
  function resumeGame() { if (S.paused) togglePause(); }
  function quitToMenu() {
    S.running = false;
    S.paused = false;
    setTouchMode(false);
    pauseOverlay.classList.remove('active');
    gameoverOverlay.classList.remove('active');
    music.stop();
    show('title');
  }

  function switchWeapon(name) {
    if (!S.player || !S.player.alive) return;
    if (name !== 'pistol' && S.player.ammo[name] <= 0) { sfx.dryFire(); return; }
    if (S.player.weapon === name) return;
    S.player.weapon = name;
    S.player.cd = 0;
    sfx.swap();
    updateHUD();
  }

  // ==================== WAVE + SPAWNING ====================
  function beginWave() {
    S.wave++;
    S.waveActive = true;
    S.spawnBudget = Math.min(60, 7 + Math.floor(S.wave * 3.2));
    S.spawnTimer = 500;
    sfx.waveStart();
    S.flashBang = Math.max(S.flashBang, 0.25);
    if (S.settings.shake) S.shake = Math.max(S.shake, 6);
    const sub = S.wave >= 10 ? 'They keep coming' : (S.wave >= 5 ? 'Bombers inbound' : 'Rip and tear');
    showBanner('Wave ' + S.wave, sub);
    updateHUD();
  }

  function pickEnemyType() {
    const pool = Object.entries(ENEMY_TYPES).filter(([, t]) => S.wave >= t.minWave);
    const weighted = [];
    for (const [key, t] of pool) for (let i = 0; i < t.weight; i++) weighted.push(key);
    return weighted[Math.floor(Math.random() * weighted.length)];
  }

  function spawnEnemyAtEdge() {
    const type = pickEnemyType();
    const t = ENEMY_TYPES[type];
    const b = S.mapData.bounds || { x: 20, y: 20, w: S.mapData.worldW - 40, h: S.mapData.worldH - 40 };
    let x = 0, y = 0;
    for (let tries = 0; tries < 60; tries++) {
      const side = Math.floor(Math.random() * 4);
      if (side === 0) { x = rand(b.x + 30, b.x + b.w - 30); y = b.y + 25; }
      if (side === 1) { x = rand(b.x + 30, b.x + b.w - 30); y = b.y + b.h - 25; }
      if (side === 2) { x = b.x + 25; y = rand(b.y + 30, b.y + b.h - 30); }
      if (side === 3) { x = b.x + b.w - 25; y = rand(b.y + 30, b.y + b.h - 30); }
      if (!collidesObstacles(x, y, t.r + 4) && dist({ x, y }, S.player) > 380) break;
    }
    const scale = 1 + (S.wave - 1) * 0.06 * diffMod();
    S.enemies.push({
      type, x, y, r: t.r,
      hp: Math.round(t.hp * scale),
      maxHp: Math.round(t.hp * scale),
      speed: t.speed,
      dmg: t.dmg,
      color: t.color, armColor: t.armColor, eye: t.eye,
      points: t.points, drop: t.drop,
      hitFlash: 0,
      angle: 0,
      wobble: Math.random() * Math.PI * 2,
      explosive: !!t.explosive, radius: t.radius || 0,
      attackCd: 0,
      stuck: { lastX: x, lastY: y, timer: 0, jitterMs: 0, perp: 0 },
    });
    if (Math.random() < 0.25) sfx.zombieSpawn();
    // spawn puff so they don't just pop in
    puffSmoke(x, y, 3, 7);
  }

  function showBanner(text, sub) {
    bannerText.textContent = text;
    bannerSub.textContent = sub || '';
    banner.classList.add('show');
    clearTimeout(showBanner._t);
    showBanner._t = setTimeout(() => banner.classList.remove('show'), 1500);
  }

  // ==================== SHOOTING ====================
  function tryShoot() {
    if (!S.player.alive || S.player.cd > 0) return;
    const w = WEAPONS[S.player.weapon];
    const name = S.player.weapon;
    if (name !== 'pistol' && S.player.ammo[name] <= 0) {
      switchWeapon('pistol');
      return;
    }
    S.player.cd = w.cd;
    S.player.lastShotFlash = 90;
    if (name !== 'pistol') S.player.ammo[name]--;
    const base = S.player.angle;
    for (let i = 0; i < w.pellets; i++) {
      const a = base + (w.pellets > 1 ? rand(-w.spread, w.spread) : (Math.random() - 0.5) * w.spread * 2);
      S.bullets.push({
        x: S.player.x + Math.cos(base) * (S.player.r + 6),
        y: S.player.y + Math.sin(base) * (S.player.r + 6),
        vx: Math.cos(a) * w.speed,
        vy: Math.sin(a) * w.speed,
        r: w.size,
        dmg: w.dmg,
        color: w.color,
        life: w.range / w.speed,
        explosive: !!w.explosive,
        radius: w.radius || 0,
        weapon: name,
        prevX: 0, prevY: 0,
      });
    }
    if (name === 'pistol')  sfx.pistol();
    if (name === 'uzi')     sfx.uzi();
    if (name === 'shotgun') sfx.shotgun();
    if (name === 'rocket')  sfx.rocket();

    // muzzle juice
    const mx = S.player.x + Math.cos(base) * (S.player.r + 20);
    const my = S.player.y + Math.sin(base) * (S.player.r + 20);
    const drift = { x: Math.cos(base) * 0.7, y: Math.sin(base) * 0.7 };
    if (name === 'shotgun') { puffSmoke(mx, my, 6, 7, drift); spark(mx, my, Math.cos(base), Math.sin(base), 10); }
    else if (name === 'rocket') { puffSmoke(mx, my, 9, 9, drift); puffSmoke(S.player.x - Math.cos(base) * 14, S.player.y - Math.sin(base) * 14, 6, 8, { x: -drift.x, y: -drift.y }); }
    else if (name === 'uzi') { if (Math.random() < 0.4) puffSmoke(mx, my, 1, 3.5, drift); spark(mx, my, Math.cos(base), Math.sin(base), 2); }
    else { puffSmoke(mx, my, 2, 4.5, drift); spark(mx, my, Math.cos(base), Math.sin(base), 4); }
    if (name !== 'rocket') ejectCasing(S.player);

    if (S.settings.shake) {
      if (name === 'shotgun') S.shake = Math.max(S.shake, 7);
      else if (name === 'rocket') S.shake = Math.max(S.shake, 6);
      else if (name === 'pistol') S.shake = Math.max(S.shake, 2.2);
      else S.shake = Math.max(S.shake, 1.4);
    }
    updateHUD();
  }

  // ==================== EXPLOSIONS ====================
  function explode(x, y, radius, dmg, source) {
    S.explosions.push({ x, y, r: 4, maxR: radius, life: 24 });
    if (S.settings.shake) S.shake = Math.max(S.shake, 20);
    sfx.boom();
    shockwave(x, y, radius * 1.5);
    puffSmoke(x, y, 14, 16);
    spark(x, y, rand(-1, 1), rand(-1, 1), 22);
    S.hitStop = Math.max(S.hitStop, 55);
    S.flashBang = Math.max(S.flashBang, 0.45);
    for (const e of S.enemies) {
      const d = dist({ x, y }, e);
      if (d < radius) { e.hp -= dmg * (1 - d / radius); e.hitFlash = 6; }
    }
    if (S.player.alive) {
      const pd = dist({ x, y }, S.player);
      if (pd < radius) damagePlayer(dmg * (1 - pd / radius) * (source === 'enemy' ? 1 : 0.28));
    }
    if (S.settings.blood) {
      // fire embers
      for (let i = 0; i < 30; i++) {
        S.particles.push({
          x, y,
          vx: Math.cos(i / 30 * Math.PI * 2) * rand(1.8, 6.0),
          vy: Math.sin(i / 30 * Math.PI * 2) * rand(1.8, 6.0),
          life: rand(22, 46), r: rand(2, 5),
          color: ['#F5844A', '#FFB050', '#E36B3E', '#FFD070'][Math.floor(Math.random() * 4)],
        });
      }
      // scorch + blood ring from anything caught in it
      addDecal(x, y, radius * 0.35, 0.55);
      for (let i = 0; i < 14; i++) {
        const a = rand(0, Math.PI * 2), d = rand(radius * 0.2, radius * 0.9);
        addDecal(x + Math.cos(a) * d, y + Math.sin(a) * d, rand(4, 12), rand(0.3, 0.65));
      }
      spawnGibs(x, y, '#7A1418', 12, 1.6);
    }
  }

  function damagePlayer(amount) {
    if (!S.player.alive) return;
    S.player.hp -= amount;
    S.player.hitFlash = 12;
    sfx.hurt();
    if (S.settings.shake) S.shake = Math.max(S.shake, 8);
    spawnScreenBlood(Math.min(14, 4 + Math.floor(amount / 3)));
    if (S.settings.blood) {
      for (let i = 0; i < 10; i++) {
        const a = rand(0, Math.PI * 2), sp = rand(1, 4);
        S.particles.push({
          x: S.player.x, y: S.player.y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: rand(14, 30), r: rand(1.4, 3.2),
          color: bloodColor(), blood: true,
        });
      }
      addDecal(S.player.x, S.player.y, rand(4, 9), 0.55);
    }
    if (S.player.hp <= 0) {
      S.player.hp = 0;
      S.player.alive = false;
      onGameOver();
    }
    updateHUD();
  }

  function onGameOver() {
    sfx.gameover();
    music.stop();
    if (S.score > S.best) { S.best = S.score; try { localStorage.setItem('rk_best', String(S.best)); } catch (e) {} }
    document.getElementById('over-wave').textContent = S.wave;
    document.getElementById('over-score').textContent = S.score;
    document.getElementById('over-best').textContent = S.best;
    gameoverOverlay.classList.add('active');
  }

  // ==================== PICKUPS ====================
  function dropPickup(x, y) {
    const roll = Math.random();
    let type = null;
    if      (roll < 0.32) type = { kind: 'uzi',     amount: 60, color: '#FFD070', label: 'UZI' };
    else if (roll < 0.58) type = { kind: 'shotgun', amount: 14, color: '#FF8A50', label: 'SHT' };
    else if (roll < 0.68) type = { kind: 'rocket',  amount: 2,  color: '#FF5030', label: 'RKT' };
    else if (roll < 0.85) type = { kind: 'hp',      amount: 30, color: '#7BC59A', label: 'MED' };
    else return;
    S.pickups.push({ x, y, r: 12, life: 1200, ...type });
  }

  // ==================== AI (smarter) ====================
  function stepEnemy(e, dt) {
    const p = S.player;
    const dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    let dirX = dx / d, dirY = dy / d;

    // Organic wobble
    const wx = Math.cos(e.wobble) * 0.14;
    const wy = Math.sin(e.wobble * 1.3) * 0.14;
    dirX += wx; dirY += wy;
    const dm = Math.hypot(dirX, dirY) || 1;
    dirX /= dm; dirY /= dm;

    const step = e.speed * dt;
    const look = e.r + step * 2 + 6;

    // Obstacle look-ahead: if forward is blocked, rotate around until we find a clear direction
    let tries = [0];
    if (collidesObstacles(e.x + dirX * look, e.y + dirY * look, e.r)) {
      tries = [-0.5, 0.5, -1.0, 1.0, -1.5, 1.5, -2.0, 2.0, -2.5, 2.5, Math.PI];
    }
    let chosenX = dirX, chosenY = dirY, found = false;
    for (const rot of tries) {
      const c = Math.cos(rot), s = Math.sin(rot);
      const rx = dirX * c - dirY * s;
      const ry = dirX * s + dirY * c;
      if (!collidesObstacles(e.x + rx * look, e.y + ry * look, e.r)) {
        chosenX = rx; chosenY = ry;
        found = true;
        break;
      }
    }
    if (!found) return;

    // Stuck-jitter override: force perpendicular hop for a beat
    if (e.stuck.jitterMs > 0) {
      const c = Math.cos(Math.PI / 2 * e.stuck.perp);
      const s = Math.sin(Math.PI / 2 * e.stuck.perp);
      chosenX = dirX * c - dirY * s;
      chosenY = dirX * s + dirY * c;
      e.stuck.jitterMs -= dt * 16.67;
    }

    // Move with axis-slide
    const nx = e.x + chosenX * step;
    const ny = e.y + chosenY * step;
    const canX = !collidesObstacles(nx, e.y, e.r) && (!S.mapData.bounds || inWorldBounds(nx, e.y, e.r));
    const canY = !collidesObstacles(e.x, ny, e.r) && (!S.mapData.bounds || inWorldBounds(e.x, ny, e.r));
    if (canX) e.x = nx;
    if (canY) e.y = ny;

    // Keep in-world for maps without .bounds
    e.x = clamp(e.x, e.r + 2, S.mapData.worldW - e.r - 2);
    e.y = clamp(e.y, e.r + 2, S.mapData.worldH - e.r - 2);

    // Stuck detection: if hardly moved over ~500ms, force jitter
    e.stuck.timer += dt * 16.67;
    if (e.stuck.timer > 500) {
      const moved = Math.hypot(e.x - e.stuck.lastX, e.y - e.stuck.lastY);
      if (moved < 10) {
        e.stuck.jitterMs = 350;
        e.stuck.perp = Math.random() < 0.5 ? -1 : 1;
      }
      e.stuck.lastX = e.x; e.stuck.lastY = e.y; e.stuck.timer = 0;
    }

    e.angle = Math.atan2(dy, dx);
  }

  // ==================== UPDATE ====================
  function update(dtMs) {
    if (!S.running || S.paused || !S.player.alive) return;
    const dt = dtMs / 16.67;

    // Wave control
    if (!S.waveActive) {
      S.interWaveTimer -= dtMs;
      if (S.interWaveTimer <= 0) beginWave();
    } else {
      if (S.spawnBudget > 0) {
        S.spawnTimer -= dtMs;
        if (S.spawnTimer <= 0) {
          spawnEnemyAtEdge();
          S.spawnBudget--;
          S.spawnTimer = clamp(700 - S.wave * 22, 150, 700);
        }
      }
      if (S.spawnBudget === 0 && S.enemies.length === 0) {
        S.waveActive = false;
        S.interWaveTimer = 3000;
        const bonus = S.wave * 60;
        showBanner('Wave Clear', '+' + bonus + ' bonus');
        sfx.waveClear();
        S.score += bonus;
      }
    }

    // Combo timer decay
    if (S.combo > 0) {
      S.comboTimer -= dtMs;
      if (S.comboTimer <= 0) { S.combo = 0; hud.combo.classList.remove('show'); }
    }

    // ---- Player
    const p = S.player;
    let vx = 0, vy = 0;
    if (S.keys['w'] || S.keys['arrowup'])    vy -= 1;
    if (S.keys['s'] || S.keys['arrowdown'])  vy += 1;
    if (S.keys['a'] || S.keys['arrowleft'])  vx -= 1;
    if (S.keys['d'] || S.keys['arrowright']) vx += 1;
    let mag = Math.hypot(vx, vy);
    if (mag > 0) { vx /= mag; vy /= mag; mag = 1; }
    // The move stick is analog and outranks the keys when pushed: vx/vy
    // carry its magnitude, so a half-push walks at half speed.
    const stickMag = Math.hypot(S.touch.moveX, S.touch.moveY);
    if (stickMag > 0.12) {
      vx = S.touch.moveX;
      vy = S.touch.moveY;
      mag = Math.min(1, stickMag);
    }
    const sprinting = ((S.keys['shift'] || S.touch.sprint) && p.sprint > 0 && mag > 0);
    p.sprinting = sprinting;
    const speed = sprinting ? SPRINT_SPEED : BASE_SPEED;
    if (sprinting) p.sprint = Math.max(0, p.sprint - dtMs);
    else p.sprint = Math.min(SPRINT_BUDGET_MS, p.sprint + dtMs * SPRINT_REGEN);

    // Animation phases
    p.idlePhase += 0.06 * dt;
    if (mag > 0) p.walkPhase += (sprinting ? 0.42 : 0.28) * dt;
    else p.walkPhase += (p.walkPhase % (Math.PI * 2) > 0.05 ? 0.18 * dt : 0);

    let nx = p.x + vx * speed * dt;
    let ny = p.y + vy * speed * dt;
    if (!collidesObstacles(nx, p.y, p.r) && inWorldBounds(nx, p.y, p.r)) p.x = nx;
    if (!collidesObstacles(p.x, ny, p.r) && inWorldBounds(p.x, ny, p.r)) p.y = ny;

    // Camera + aim
    S.cam.zoom += (S.cam.targetZoom - S.cam.zoom) * 0.15;
    const camLag = 0.13;
    S.cam.x += (p.x - S.cam.x) * camLag;
    S.cam.y += (p.y - S.cam.y) * camLag;
    const viewW = W / S.cam.zoom, viewH = H / S.cam.zoom;
    const bx0 = S.mapData.bounds ? S.mapData.bounds.x : 0;
    const by0 = S.mapData.bounds ? S.mapData.bounds.y : 0;
    const bx1 = S.mapData.bounds ? S.mapData.bounds.x + S.mapData.bounds.w : S.mapData.worldW;
    const by1 = S.mapData.bounds ? S.mapData.bounds.y + S.mapData.bounds.h : S.mapData.worldH;
    S.cam.x = clamp(S.cam.x, bx0 + viewW / 2, bx1 - viewW / 2);
    S.cam.y = clamp(S.cam.y, by0 + viewH / 2, by1 - viewH / 2);

    recomputeWorldMouse();
    if (S.touch.active) {
      // Aim stick sets the facing directly; let go and the angle holds,
      // rather than snapping back to a stale mouse position.
      if (S.touch.aiming) p.angle = Math.atan2(S.touch.aimY, S.touch.aimX);
    } else {
      p.angle = Math.atan2(S.mouseY - p.y, S.mouseX - p.x);
    }

    // Fire
    if (p.cd > 0) p.cd -= dtMs;
    if (p.lastShotFlash > 0) p.lastShotFlash -= dtMs;
    if (S.mouseDown || S.touch.firing) {
      const w = WEAPONS[p.weapon];
      if (w.auto || p.cd <= 0) tryShoot();
    }

    // ---- Bullets
    for (let i = S.bullets.length - 1; i >= 0; i--) {
      const b = S.bullets[i];
      b.prevX = b.x; b.prevY = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let dead = false;
      if (b.life <= 0) dead = true;
      if (!dead && collidesObstacles(b.x, b.y, b.r)) {
        if (b.explosive) explode(b.x, b.y, b.radius, b.dmg, 'player');
        else { sfx.ricochet(); spark(b.x, b.y, -b.vx, -b.vy, 5); puffSmoke(b.x, b.y, 1, 3); }
        dead = true;
      }
      if (!dead && !inWorldBounds(b.x, b.y, b.r)) dead = true;
      if (!dead) {
        for (let j = 0; j < S.enemies.length; j++) {
          const e = S.enemies[j];
          if (dist(b, e) < b.r + e.r) {
            if (b.explosive) explode(b.x, b.y, b.radius, b.dmg, 'player');
            else {
              const crit = Math.random() < 0.12;
              const dealt = crit ? b.dmg * 2 : b.dmg;
              e.hp -= dealt;
              e.hitFlash = crit ? 10 : 6;
              sfx.fleshHit();
              damageNumber(e.x, e.y, dealt, crit);
              if (crit) {
                spark(b.x, b.y, b.vx, b.vy, 8);
                S.hitStop = Math.max(S.hitStop, 26);
                if (S.settings.shake) S.shake = Math.max(S.shake, 4);
              }
              if (S.settings.blood) spawnBlood(b.x, b.y, b.vx, b.vy, e.color, crit ? 22 : 14);
            }
            dead = true;
            break;
          }
        }
      }
      // tracer for uzi
      if (WEAPONS[b.weapon].tracer && !dead) S.tracers.push({ x1: b.prevX, y1: b.prevY, x2: b.x, y2: b.y, life: 8, color: b.color });
      if (dead) S.bullets.splice(i, 1);
    }

    // ---- Enemies
    for (let i = S.enemies.length - 1; i >= 0; i--) {
      const e = S.enemies[i];
      e.wobble += 0.16 * dt;
      if (e.hitFlash > 0) e.hitFlash -= dt;
      if (e.attackCd > 0) e.attackCd -= dtMs;
      stepEnemy(e, dt);

      if (dist(e, p) < e.r + p.r) {
        if (e.explosive) {
          explode(e.x, e.y, e.radius, e.dmg, 'enemy');
          killEnemy(i, false);
          continue;
        } else if (e.attackCd <= 0) {
          damagePlayer(e.dmg);
          e.attackCd = 550;
        }
      }
      if (e.hp <= 0) killEnemy(i, true);
    }

    // ---- Pickups (life decay + magnet + collect)
    for (let i = S.pickups.length - 1; i >= 0; i--) {
      const pk = S.pickups[i];
      pk.life -= dt;
      const d = dist(pk, p);
      if (d < 90) {
        // Magnet toward player
        const dx = p.x - pk.x, dy = p.y - pk.y;
        const inv = 1 / Math.max(1, d);
        pk.x += dx * inv * 3.2 * dt;
        pk.y += dy * inv * 3.2 * dt;
      }
      if (d < pk.r + p.r) {
        if (pk.kind === 'hp') {
          p.hp = Math.min(p.maxHp, p.hp + pk.amount);
          sfx.pickupHP();
        } else {
          p.ammo[pk.kind] += pk.amount;
          sfx.pickupAmmo();
          if (p.weapon === 'pistol' || (p.ammo[p.weapon] <= 0 && p.weapon !== 'pistol')) {
            switchWeapon(pk.kind);
          }
        }
        updateHUD();
        S.pickups.splice(i, 1);
        continue;
      }
      if (pk.life <= 0) S.pickups.splice(i, 1);
    }

    // ---- Particles (blood droplets settle into decals)
    for (let i = S.particles.length - 1; i >= 0; i--) {
      const pt = S.particles[i];
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vx *= 0.93; pt.vy *= 0.93;
      pt.life -= dt;
      if (pt.life <= 0) {
        // Blood that stops moving leaves a stain
        if (pt.blood && Math.random() < 0.55) addDecal(pt.x, pt.y, pt.r * rand(0.8, 1.8), rand(0.3, 0.65));
        S.particles.splice(i, 1);
      }
    }

    // ---- Gibs (bounce, trail, then splat)
    for (let i = S.gibs.length - 1; i >= 0; i--) {
      const g = S.gibs[i];
      const gx = g.x + g.vx * dt;
      const gy = g.y + g.vy * dt;
      if (!collidesObstacles(gx, g.y, g.r)) g.x = gx; else g.vx *= -0.45;
      if (!collidesObstacles(g.x, gy, g.r)) g.y = gy; else g.vy *= -0.45;
      g.vx *= 0.955; g.vy *= 0.955;
      g.rot += g.vrot * dt;
      g.life -= dt;
      // smear a trail while it's still moving fast
      g.trail -= dt;
      if (g.trail <= 0 && Math.hypot(g.vx, g.vy) > 0.7) {
        addDecal(g.x, g.y, g.r * rand(0.5, 1.0), rand(0.2, 0.45));
        g.trail = 3;
      }
      if (g.life <= 0) {
        addDecal(g.x, g.y, g.r * rand(1.2, 2.2), rand(0.45, 0.8));
        S.gibs.splice(i, 1);
      }
    }

    // ---- Decals age out very slowly
    for (let i = S.decals.length - 1; i >= 0; i--) {
      const dcl = S.decals[i];
      dcl.life -= dt;
      if (dcl.life <= 0) S.decals.splice(i, 1);
      else if (dcl.life < 300) dcl.a *= 0.995;
    }

    // ---- Screen blood drips down and fades
    for (let i = S.screenBlood.length - 1; i >= 0; i--) {
      const sb = S.screenBlood[i];
      sb.life -= dt;
      sb.y += 0.06 * dt; // slow drip
      if (sb.life <= 0) S.screenBlood.splice(i, 1);
    }

    // ---- Corpses leak a pool over time
    for (const c of S.corpses) {
      if (!c.pooled && c.life < 200) {
        c.pooled = true;
        spawnGorePool(c.x, c.y, c.r * 0.8);
      }
    }

    // ---- Tracers
    for (let i = S.tracers.length - 1; i >= 0; i--) {
      S.tracers[i].life -= dt;
      if (S.tracers[i].life <= 0) S.tracers.splice(i, 1);
    }

    // ---- Explosions
    for (let i = S.explosions.length - 1; i >= 0; i--) {
      const ex = S.explosions[i];
      ex.r += (ex.maxR - ex.r) * 0.35;
      ex.life -= dt;
      if (ex.life <= 0) S.explosions.splice(i, 1);
    }

    // ---- Corpses
    for (let i = S.corpses.length - 1; i >= 0; i--) {
      S.corpses[i].life -= dt;
      if (S.corpses[i].life <= 0) S.corpses.splice(i, 1);
    }

    // ---- Casings (skitter and settle)
    for (let i = S.casings.length - 1; i >= 0; i--) {
      const c = S.casings[i];
      c.x += c.vx * dt; c.y += c.vy * dt;
      c.vx *= 0.90; c.vy *= 0.90;
      c.rot += c.vrot * dt;
      c.vrot *= 0.93;
      c.life -= dt;
      if (c.life <= 0) S.casings.splice(i, 1);
    }

    // ---- Smoke (rises, expands, fades)
    for (let i = S.smoke.length - 1; i >= 0; i--) {
      const sm = S.smoke[i];
      sm.x += sm.vx * dt; sm.y += sm.vy * dt;
      sm.vx *= 0.97; sm.vy *= 0.97;
      sm.r += sm.grow * dt;
      sm.life -= dt;
      if (sm.life <= 0) S.smoke.splice(i, 1);
    }

    // ---- Sparks
    for (let i = S.sparks.length - 1; i >= 0; i--) {
      const sp = S.sparks[i];
      sp.x += sp.vx * dt; sp.y += sp.vy * dt;
      sp.vx *= 0.88; sp.vy *= 0.88;
      sp.life -= dt;
      if (sp.life <= 0) S.sparks.splice(i, 1);
    }

    // ---- Damage numbers
    for (let i = S.damageNums.length - 1; i >= 0; i--) {
      const dn = S.damageNums[i];
      dn.y += dn.vy * dt;
      dn.vy *= 0.95;
      dn.life -= dt;
      if (dn.life <= 0) S.damageNums.splice(i, 1);
    }

    // ---- Shockwaves
    for (let i = S.shockwaves.length - 1; i >= 0; i--) {
      const sw = S.shockwaves[i];
      sw.r += (sw.maxR - sw.r) * 0.18 * dt;
      sw.life -= dt;
      if (sw.life <= 0) S.shockwaves.splice(i, 1);
    }

    // ---- Ambient zombie groans
    S.groanTimer -= dtMs;
    if (S.groanTimer <= 0) {
      if (S.enemies.length > 0) sfx.zombieGroan();
      S.groanTimer = rand(1400, 3800) / (1 + S.enemies.length * 0.05);
    }

    // ---- Low-health heartbeat
    if (S.player.hp < 30 && S.player.alive) {
      S.lowHpTimer -= dtMs;
      if (S.lowHpTimer <= 0) {
        sfx.lowHealth();
        S.lowHpTimer = 380 + (S.player.hp / 30) * 500;
      }
    }

    // ---- Music intensity follows the pressure on screen
    music.setIntensity(clamp(S.wave / 14 + S.enemies.length / 30, 0, 1));

    // ---- Shake / hitstop / flash decay
    if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 0.9);
    if (S.flashBang > 0) S.flashBang = Math.max(0, S.flashBang - dt * 0.06);

    updateHUD();
  }

  function killEnemy(i, awardPoints) {
    const e = S.enemies[i];
    if (awardPoints) {
      S.score += e.points;
      S.combo++;
      S.comboTimer = COMBO_WINDOW;
      if (S.combo >= 2) {
        hud.combo.classList.add('show');
        hud.comboNum.textContent = S.combo;
        sfx.combo(S.combo);
        // score multiplier kicks in on long streaks
        if (S.combo % 5 === 0) {
          S.score += S.combo * 10;
          showBanner(S.combo + 'x STREAK', '+' + (S.combo * 10));
          S.flashBang = Math.max(S.flashBang, 0.2);
        }
      }
      if (Math.random() < e.drop) dropPickup(e.x, e.y);
      sfx.zombieDeath(e.type);
      if (S.settings.blood) {
        const big = e.type === 'brute';
        if (big) sfx.gib(); else sfx.splat();
        // burst of blood in all directions
        for (let k = 0; k < (big ? 46 : 26); k++) {
          const a = rand(0, Math.PI * 2);
          const sp = rand(1.2, big ? 8 : 6);
          S.particles.push({
            x: e.x, y: e.y,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: rand(20, 55), r: rand(1.6, big ? 5.5 : 4.2),
            color: bloodColor(), blood: true,
          });
        }
        spawnGibs(e.x, e.y, e.color, big ? 14 : 8, big ? 1.4 : 1);
        spawnGorePool(e.x, e.y, e.r * (big ? 1.5 : 1));
      }
    }
    // corpse
    S.corpses.push({ x: e.x, y: e.y, r: e.r, color: e.color, angle: e.angle, life: 220, pooled: false });
    S.enemies.splice(i, 1);
  }

  // ==================== JUICE / FX ====================
  function ejectCasing(p) {
    const side = p.angle + Math.PI / 2;
    S.casings.push({
      x: p.x + Math.cos(p.angle) * 8,
      y: p.y + Math.sin(p.angle) * 8,
      vx: Math.cos(side) * rand(1.4, 3) - Math.cos(p.angle) * 0.6,
      vy: Math.sin(side) * rand(1.4, 3) - Math.sin(p.angle) * 0.6,
      rot: rand(0, Math.PI * 2),
      vrot: rand(-0.4, 0.4),
      life: rand(50, 90),
      len: p.weapon === 'shotgun' ? 4.5 : 3,
    });
    if (S.casings.length > 90) S.casings.shift();
  }

  function puffSmoke(x, y, count, size, drift) {
    for (let i = 0; i < count; i++) {
      S.smoke.push({
        x: x + rand(-3, 3), y: y + rand(-3, 3),
        vx: rand(-0.4, 0.4) + (drift ? drift.x : 0),
        vy: rand(-0.4, 0.4) + (drift ? drift.y : 0),
        r: rand(size * 0.5, size),
        grow: rand(0.06, 0.16),
        life: rand(28, 62),
        maxLife: 62,
        tint: 200 + Math.floor(rand(-40, 30)),
      });
    }
    if (S.smoke.length > 160) S.smoke.splice(0, S.smoke.length - 160);
  }

  function spark(x, y, dirX, dirY, count = 7) {
    for (let i = 0; i < count; i++) {
      const a = Math.atan2(dirY, dirX) + rand(-1.1, 1.1);
      const sp = rand(2, 6.5);
      S.sparks.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(8, 20),
        color: ['#FFE9A8', '#FFC24D', '#FF8A2B'][Math.floor(Math.random() * 3)],
      });
    }
  }

  function damageNumber(x, y, amount, crit) {
    S.damageNums.push({
      x: x + rand(-6, 6), y: y - 8,
      vy: -0.85,
      life: 46, maxLife: 46,
      text: String(Math.round(amount)),
      crit: !!crit,
    });
    if (S.damageNums.length > 40) S.damageNums.shift();
  }

  function shockwave(x, y, maxR, color) {
    S.shockwaves.push({ x, y, r: 6, maxR, life: 26, maxLife: 26, color: color || 'rgba(255,190,110,' });
  }

  // ==================== GORE ====================
  const BLOOD = ['#8E0F14', '#A3131A', '#B81A20', '#6E0A10', '#C42128'];
  const bloodColor = () => BLOOD[Math.floor(Math.random() * BLOOD.length)];

  const MAX_DECALS = 420;

  // Directional blood spray from a bullet impact.
  function spawnBlood(x, y, vx, vy, tint, count = 14) {
    if (!S.settings.blood) return;
    const sp = Math.hypot(vx, vy) || 1;
    const dirX = vx / sp, dirY = vy / sp;
    for (let i = 0; i < count; i++) {
      const spread = rand(-0.7, 0.7);
      const c = Math.cos(spread), s = Math.sin(spread);
      const rx = dirX * c - dirY * s;
      const ry = dirX * s + dirY * c;
      const speed = rand(1.5, 6.5);
      S.particles.push({
        x: x + rand(-2, 2), y: y + rand(-2, 2),
        vx: rx * speed + rand(-1, 1),
        vy: ry * speed + rand(-1, 1),
        life: rand(18, 46),
        r: rand(1.4, 4.2),
        color: bloodColor(),
        blood: true,
      });
    }
    // a few backsplash droplets
    for (let i = 0; i < Math.floor(count * 0.3); i++) {
      S.particles.push({
        x, y,
        vx: -dirX * rand(0.5, 2.5) + rand(-1.5, 1.5),
        vy: -dirY * rand(0.5, 2.5) + rand(-1.5, 1.5),
        life: rand(12, 28), r: rand(1, 2.6),
        color: bloodColor(), blood: true,
      });
    }
    addDecal(x, y, rand(3, 7), 0.5);
  }

  // Ground splatter that persists.
  function addDecal(x, y, radius, alpha = 0.75) {
    if (!S.settings.blood) return;
    S.decals.push({
      x: x + rand(-3, 3), y: y + rand(-3, 3),
      r: radius,
      a: alpha,
      color: bloodColor(),
      squish: rand(0.6, 1.0),
      rot: rand(0, Math.PI * 2),
      life: 3600,
    });
    if (S.decals.length > MAX_DECALS) S.decals.splice(0, S.decals.length - MAX_DECALS);
  }

  // Big pool + ring of splatter where something died.
  function spawnGorePool(x, y, size) {
    if (!S.settings.blood) return;
    addDecal(x, y, size * rand(0.9, 1.3), 0.8);
    for (let i = 0; i < 9; i++) {
      const a = rand(0, Math.PI * 2);
      const d = rand(size * 0.4, size * 2.1);
      addDecal(x + Math.cos(a) * d, y + Math.sin(a) * d, rand(size * 0.2, size * 0.6), rand(0.35, 0.7));
    }
  }

  // Flying chunks of meat.
  function spawnGibs(x, y, tint, count = 7, force = 1) {
    if (!S.settings.blood) return;
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(1.6, 6.5) * force;
      S.gibs.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: rand(2.2, 5.5),
        rot: rand(0, Math.PI * 2),
        vrot: rand(-0.35, 0.35),
        life: rand(50, 110),
        color: Math.random() < 0.45 ? tint : bloodColor(),
        trail: 0,
      });
    }
  }

  // Blood flecks on the camera lens when the player takes a hit.
  function spawnScreenBlood(count = 8) {
    if (!S.settings.blood) return;
    for (let i = 0; i < count; i++) {
      S.screenBlood.push({
        x: rand(0, W), y: rand(0, H),
        r: rand(4, 22),
        a: rand(0.25, 0.6),
        squish: rand(0.5, 1),
        rot: rand(0, Math.PI * 2),
        life: rand(180, 420),
        maxLife: 420,
        color: bloodColor(),
      });
    }
  }

  // ==================== RENDER ====================
  function draw() {
    // Screen shake (screen-space)
    const sx = S.shake ? rand(-S.shake, S.shake) : 0;
    const sy = S.shake ? rand(-S.shake, S.shake) : 0;

    // Clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#04060A';
    ctx.fillRect(0, 0, W, H);

    if (!S.mapData) return;

    // World transform: translate so cam center → screen center, then scale
    ctx.setTransform(S.cam.zoom, 0, 0, S.cam.zoom, W/2 - S.cam.x * S.cam.zoom + sx, H/2 - S.cam.y * S.cam.zoom + sy);

    drawFloorAndGrid();
    drawDecals();
    drawMapBorder();
    drawObstacles();
    drawCasings();
    drawCorpses();
    drawGibs();
    drawParticles();
    drawSparks();
    drawTracers();
    drawPickups();
    drawEnemies();
    if (S.player) drawPlayer(S.player);
    drawBullets();
    drawExplosions();
    drawShockwaves();
    drawSmoke();
    drawDamageNumbers();

    // Screen-space overlays
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawFlashBang();
    drawVignette();
    drawHitFlash();
    drawLowHealthPulse();
    drawScreenBlood();
    drawOffscreenIndicators();
    drawMinimap();
  }

  function drawDecals() {
    const view = visibleWorldRect();
    for (const d of S.decals) {
      if (d.x + d.r < view.x || d.x - d.r > view.x + view.w) continue;
      if (d.y + d.r < view.y || d.y - d.r > view.y + view.h) continue;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      ctx.globalAlpha = d.a;
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, d.r, d.r * d.squish, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawCasings() {
    for (const c of S.casings) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.globalAlpha = clamp(c.life / 30, 0, 1);
      ctx.fillStyle = '#C9A227';
      ctx.fillRect(-c.len / 2, -1, c.len, 2);
      ctx.fillStyle = '#8A6E12';
      ctx.fillRect(-c.len / 2, -1, 1.2, 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawSparks() {
    ctx.lineCap = 'round';
    for (const sp of S.sparks) {
      ctx.globalAlpha = clamp(sp.life / 18, 0, 1);
      ctx.strokeStyle = sp.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(sp.x - sp.vx * 1.6, sp.y - sp.vy * 1.6);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
  }

  function drawSmoke() {
    for (const sm of S.smoke) {
      const a = clamp(sm.life / sm.maxLife, 0, 1) * 0.30;
      ctx.globalAlpha = a;
      const g = ctx.createRadialGradient(sm.x, sm.y, 0, sm.x, sm.y, sm.r);
      g.addColorStop(0, 'rgba(' + sm.tint + ',' + sm.tint + ',' + sm.tint + ',0.55)');
      g.addColorStop(1, 'rgba(' + sm.tint + ',' + sm.tint + ',' + sm.tint + ',0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sm.x, sm.y, sm.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawShockwaves() {
    for (const sw of S.shockwaves) {
      const t = sw.life / sw.maxLife;
      ctx.globalAlpha = t * 0.7;
      ctx.strokeStyle = 'rgba(255,190,110,' + t + ')';
      ctx.lineWidth = (2 + t * 4) / S.cam.zoom;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawDamageNumbers() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const dn of S.damageNums) {
      const t = dn.life / dn.maxLife;
      ctx.globalAlpha = clamp(t * 1.4, 0, 1);
      const size = dn.crit ? 16 : 11;
      ctx.font = 'bold ' + size + 'px "Black Ops One", Impact, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(dn.text, dn.x, dn.y);
      ctx.fillStyle = dn.crit ? '#FFD84D' : '#FFFFFF';
      ctx.fillText(dn.text, dn.x, dn.y);
      if (dn.crit) {
        ctx.font = 'bold 8px "Black Ops One", Impact, sans-serif';
        ctx.strokeText('CRIT', dn.x, dn.y - 12);
        ctx.fillStyle = '#FF7A3D';
        ctx.fillText('CRIT', dn.x, dn.y - 12);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawFlashBang() {
    if (S.flashBang <= 0) return;
    ctx.fillStyle = 'rgba(255,235,200,' + Math.min(0.5, S.flashBang) + ')';
    ctx.fillRect(0, 0, W, H);
  }

  function drawGibs() {
    for (const g of S.gibs) {
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.rot);
      ctx.globalAlpha = clamp(g.life / 40, 0, 1);
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(1, 1.5, g.r, g.r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      // meat chunk
      ctx.fillStyle = g.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, g.r, g.r * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawScreenBlood() {
    for (const sb of S.screenBlood) {
      const fade = clamp(sb.life / sb.maxLife, 0, 1);
      ctx.save();
      ctx.translate(sb.x, sb.y);
      ctx.rotate(sb.rot);
      ctx.globalAlpha = sb.a * fade;
      ctx.fillStyle = sb.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, sb.r, sb.r * sb.squish, 0, 0, Math.PI * 2);
      ctx.fill();
      // a couple of satellite droplets
      ctx.globalAlpha = sb.a * fade * 0.7;
      ctx.beginPath();
      ctx.arc(sb.r * 0.9, sb.r * 0.5, sb.r * 0.22, 0, Math.PI * 2);
      ctx.arc(-sb.r * 0.7, sb.r * 0.8, sb.r * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawLowHealthPulse() {
    if (!S.player || !S.player.alive || S.player.hp > 35) return;
    const t = performance.now() / 1000;
    const intensity = (1 - S.player.hp / 35) * 0.4;
    const pulse = (Math.sin(t * 5) * 0.5 + 0.5) * intensity;
    const g = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.25, W/2, H/2, Math.max(W,H)*0.7);
    g.addColorStop(0, 'rgba(160,20,20,0)');
    g.addColorStop(1, 'rgba(160,20,20,' + pulse + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawFloorAndGrid() {
    const m = S.mapData;
    const bounds = m.bounds || { x: 0, y: 0, w: m.worldW, h: m.worldH };
    // Floor
    ctx.fillStyle = m.floor;
    ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
    // Second floor tint (checker feel) — very subtle
    ctx.fillStyle = m.floor2;
    ctx.globalAlpha = 0.35;
    const tile = 120;
    const view = visibleWorldRect();
    const x0 = Math.floor(Math.max(bounds.x, view.x) / tile) * tile;
    const x1 = Math.min(bounds.x + bounds.w, view.x + view.w) + tile;
    const y0 = Math.floor(Math.max(bounds.y, view.y) / tile) * tile;
    const y1 = Math.min(bounds.y + bounds.h, view.y + view.h) + tile;
    for (let ty = y0; ty < y1; ty += tile) {
      for (let tx = x0; tx < x1; tx += tile) {
        if (((tx / tile) + (ty / tile)) % 2 === 0) {
          const dw = Math.min(tile, bounds.x + bounds.w - tx);
          const dh = Math.min(tile, bounds.y + bounds.h - ty);
          if (dw > 0 && dh > 0) ctx.fillRect(tx, ty, dw, dh);
        }
      }
    }
    ctx.globalAlpha = 1;

    // Grid
    ctx.strokeStyle = m.line;
    ctx.lineWidth = 1 / S.cam.zoom;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    const g = 60;
    const gx0 = Math.floor(Math.max(bounds.x, view.x) / g) * g;
    const gx1 = Math.min(bounds.x + bounds.w, view.x + view.w) + g;
    const gy0 = Math.floor(Math.max(bounds.y, view.y) / g) * g;
    const gy1 = Math.min(bounds.y + bounds.h, view.y + view.h) + g;
    for (let x = gx0; x <= gx1; x += g) { ctx.moveTo(x, gy0); ctx.lineTo(x, gy1); }
    for (let y = gy0; y <= gy1; y += g) { ctx.moveTo(gx0, y); ctx.lineTo(gx1, y); }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawMapBorder() {
    const m = S.mapData;
    if (m.bounds) {
      const b = m.bounds;
      ctx.strokeStyle = m.accent;
      ctx.lineWidth = 4 / S.cam.zoom;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
    } else {
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 6 / S.cam.zoom;
      ctx.strokeRect(0, 0, m.worldW, m.worldH);
    }
  }

  function drawObstacles() {
    const view = visibleWorldRect();
    for (const o of S.mapData.obstacles) {
      if (o.x + o.w < view.x || o.x > view.x + view.w) continue;
      if (o.y + o.h < view.y || o.y > view.y + view.h) continue;
      ctx.fillStyle = o.tone;
      ctx.fillRect(o.x, o.y, o.w, o.h);
      // top highlight
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(o.x, o.y, o.w, 3);
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(o.x, o.y + o.h - 3, o.w, 3);
      // outline
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1.2 / S.cam.zoom;
      ctx.strokeRect(o.x + 0.5, o.y + 0.5, o.w - 1, o.h - 1);
    }
  }

  function drawCorpses() {
    for (const c of S.corpses) {
      const a = clamp(c.life / 220, 0, 1);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.angle);
      // dark shadow
      ctx.globalAlpha = a * 0.55;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(1, 2, c.r + 3, c.r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      // collapsed body — squashed, with sprawled limbs
      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, c.r * 0.95, c.r * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // splayed arms
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(2, -3); ctx.lineTo(c.r * 0.9, -c.r * 0.75);
      ctx.moveTo(2, 3);  ctx.lineTo(c.r * 0.85, c.r * 0.8);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  function drawParticles() {
    for (const pt of S.particles) {
      ctx.globalAlpha = clamp(pt.life / 30, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawTracers() {
    for (const t of S.tracers) {
      ctx.globalAlpha = clamp(t.life / 8, 0, 1);
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 1.5 / S.cam.zoom;
      ctx.beginPath();
      ctx.moveTo(t.x1, t.y1);
      ctx.lineTo(t.x2, t.y2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawPickups() {
    for (const pk of S.pickups) {
      const pulse = 0.75 + Math.sin(pk.life * 0.14) * 0.25;
      const alpha = pk.life < 200 ? clamp(pk.life / 200, 0.25, 1) : 1;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.arc(pk.x + 1, pk.y + 2, pk.r + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pk.color;
      ctx.beginPath();
      ctx.arc(pk.x, pk.y, pk.r * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.4 / S.cam.zoom;
      ctx.stroke();
      ctx.fillStyle = '#08090C';
      ctx.font = 'bold 10px "Black Ops One", Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pk.label, pk.x, pk.y + 1);
    }
    ctx.globalAlpha = 1;
  }

  function drawBullets() {
    for (const b of S.bullets) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(Math.atan2(b.vy, b.vx));
      ctx.fillStyle = b.color;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 8 / S.cam.zoom;
      ctx.fillRect(-b.r * 2, -b.r / 2, b.r * 4, b.r);
      ctx.restore();
    }
    ctx.shadowBlur = 0;
  }

  function drawExplosions() {
    for (const ex of S.explosions) {
      const t = ex.life / 24;
      ctx.globalAlpha = clamp(t, 0, 1);
      const grad = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, ex.r);
      grad.addColorStop(0, 'rgba(255,220,120,0.9)');
      grad.addColorStop(0.4, 'rgba(255,120,50,0.7)');
      grad.addColorStop(1, 'rgba(180,40,20,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, ex.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawEnemies() {
    const view = visibleWorldRect();
    for (const e of S.enemies) {
      if (e.x < view.x - 60 || e.x > view.x + view.w + 60) continue;
      if (e.y < view.y - 60 || e.y > view.y + view.h + 60) continue;
      drawEnemy(e);
    }
  }

  // ============================================================
  // ZOMBIE SPRITE
  // Hunched, shoulder-heavy silhouette with both arms reaching
  // forward. Head is a single skull set into the shoulders — no
  // floating circles.
  // ============================================================
  function drawEnemy(e) {
    const lurch = Math.sin(e.wobble);
    const SH = e.r * 1.05;      // half shoulder width
    const CH = e.r * 0.74;      // half chest depth
    const flash = e.hitFlash > 0;
    const body = flash ? '#FFFFFF' : e.color;
    const limb = flash ? '#FFFFFF' : e.armColor;
    const rot  = flash ? '#FFFFFF' : shade(e.color, -0.28);

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);

    // ---- shadow
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.beginPath();
    ctx.ellipse(1, 3, CH + 4, SH + 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // ---- dragging legs (shambling, out of sync)
    ctx.strokeStyle = rot;
    ctx.lineCap = 'round';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-1, -SH * 0.45);
    ctx.lineTo(3 + lurch * 3, -SH * 0.75);
    ctx.moveTo(-1, SH * 0.45);
    ctx.lineTo(3 - lurch * 3, SH * 0.75);
    ctx.stroke();
    ctx.lineCap = 'butt';

    // ---- ARMS reaching forward (grasping, swaying)
    drawZombieArm(e,  1, CH * 0.2, -SH * 0.72, -0.26 + lurch * 0.10, limb, rot, flash);
    drawZombieArm(e, -1, CH * 0.2,  SH * 0.72,  0.26 - lurch * 0.10, limb, rot, flash);

    // ---- TORSO: hunched trapezoid, wide at the shoulders
    ctx.fillStyle = body;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(CH * 0.55, -SH * 0.78);          // front-left shoulder
    ctx.quadraticCurveTo(CH + 2, 0, CH * 0.55, SH * 0.78);   // chest bulge
    ctx.lineTo(-CH * 0.75, SH * 0.60);          // back-right
    ctx.quadraticCurveTo(-CH - 2.5, 0, -CH * 0.75, -SH * 0.60);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // rotted flank shading
    ctx.fillStyle = rot;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(-CH * 0.75, SH * 0.60);
    ctx.quadraticCurveTo(-CH - 2.5, 0, -CH * 0.75, -SH * 0.60);
    ctx.quadraticCurveTo(-CH * 0.2, 0, -CH * 0.75, SH * 0.60);
    ctx.fill();
    ctx.globalAlpha = 1;

    // torn shirt scraps
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(CH * 0.1, -SH * 0.5);
    ctx.lineTo(-CH * 0.3, -SH * 0.15);
    ctx.lineTo(CH * 0.05, SH * 0.2);
    ctx.lineTo(-CH * 0.35, SH * 0.55);
    ctx.stroke();

    // exposed ribs (bone flecks)
    ctx.fillStyle = flash ? '#FFF' : '#C9BFA6';
    ctx.globalAlpha = 0.65;
    for (const ry of [-SH * 0.34, -SH * 0.08, SH * 0.18]) {
      ctx.fillRect(CH * 0.25, ry, 3.4, 1.2);
    }
    ctx.globalAlpha = 1;

    // ---- HEAD: set low into the shoulders, tilted
    const headX = CH * 0.72;
    const headR = e.r * 0.50;
    const tilt = lurch * 0.16;
    ctx.save();
    ctx.translate(headX, tilt * 3);
    ctx.rotate(tilt);

    // neck stump
    ctx.fillStyle = rot;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(-headR * 0.9, -headR * 0.5, headR * 1.2, headR, 1.5);
    ctx.fill();
    ctx.stroke();

    // skull
    ctx.fillStyle = flash ? '#FFF' : shade(e.color, 0.16);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(0, 0, headR * 1.06, headR * 0.94, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // temple rot patch
    ctx.fillStyle = rot;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.ellipse(-headR * 0.35, -headR * 0.3, headR * 0.45, headR * 0.35, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // sunken eye sockets
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.beginPath();
    ctx.ellipse(headR * 0.34, -headR * 0.40, headR * 0.36, headR * 0.30, -0.25, 0, Math.PI * 2);
    ctx.ellipse(headR * 0.34,  headR * 0.40, headR * 0.36, headR * 0.30,  0.25, 0, Math.PI * 2);
    ctx.fill();
    // glowing eyes
    ctx.fillStyle = e.eye;
    ctx.beginPath();
    ctx.arc(headR * 0.42, -headR * 0.40, headR * 0.17, 0, Math.PI * 2);
    ctx.arc(headR * 0.42,  headR * 0.40, headR * 0.17, 0, Math.PI * 2);
    ctx.fill();
    // eye glow bloom
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(headR * 0.42, -headR * 0.40, headR * 0.34, 0, Math.PI * 2);
    ctx.arc(headR * 0.42,  headR * 0.40, headR * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // hanging jaw with teeth
    const jawDrop = headR * (0.52 + Math.abs(lurch) * 0.18);
    ctx.fillStyle = 'rgba(10,4,4,0.85)';
    ctx.beginPath();
    ctx.ellipse(headR * 0.86, 0, headR * 0.34, jawDrop, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = flash ? '#FFF' : '#D8CDB4';
    for (let t = -1; t <= 1; t++) {
      ctx.fillRect(headR * 0.80, t * (jawDrop * 0.5) - 0.7, 2.4, 1.5);
    }
    ctx.restore();

    // ---- Bomber warning ring
    if (e.explosive) {
      const pulse = 0.35 + Math.abs(Math.sin(e.wobble * 4)) * 0.5;
      ctx.strokeStyle = 'rgba(255,90,45,' + pulse + ')';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(0, 0, e.r + 5, 0, Math.PI * 2);
      ctx.stroke();
      // sizzling core
      ctx.fillStyle = 'rgba(255,140,60,' + (pulse * 0.5) + ')';
      ctx.beginPath();
      ctx.arc(0, 0, e.r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- Brute armor plating
    if (e.type === 'brute') {
      ctx.strokeStyle = flash ? '#FFF' : '#6B6F7E';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, e.r * 0.62, -Math.PI * 0.42, Math.PI * 0.42);
      ctx.stroke();
      ctx.fillStyle = flash ? '#FFF' : '#4C5160';
      ctx.beginPath();
      ctx.roundRect(-CH * 0.2, -SH * 0.5, 4, SH, 1.5);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }

    ctx.restore();

    // ---- Brute HP bar (world space, unrotated)
    if (e.type === 'brute' && e.hp < e.maxHp) {
      const w = e.r * 2.4;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(e.x - w/2 - 1, e.y - e.r - 11, w + 2, 6);
      ctx.fillStyle = '#3A0E0C';
      ctx.fillRect(e.x - w/2, e.y - e.r - 10, w, 4);
      ctx.fillStyle = '#E36B3E';
      ctx.fillRect(e.x - w/2, e.y - e.r - 10, w * (e.hp / e.maxHp), 4);
    }
  }

  // One grasping arm: upper → elbow → forearm → clawed hand.
  function drawZombieArm(e, side, sx, sy, splay, limb, rot, flash) {
    const reach = e.r * 0.95;
    const sag = Math.sin(e.wobble * 2.3 + side) * 2.2;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(splay);

    ctx.lineCap = 'round';
    // upper arm
    ctx.strokeStyle = limb;
    ctx.lineWidth = 5.6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(reach * 0.62, sag * 0.5);
    ctx.stroke();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(reach * 0.62, sag * 0.5);
    ctx.stroke();

    // forearm (rotted, thinner)
    ctx.strokeStyle = rot;
    ctx.lineWidth = 4.4;
    ctx.beginPath();
    ctx.moveTo(reach * 0.62, sag * 0.5);
    ctx.lineTo(reach * 1.42, sag);
    ctx.stroke();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    ctx.moveTo(reach * 0.62, sag * 0.5);
    ctx.lineTo(reach * 1.42, sag);
    ctx.stroke();
    ctx.lineCap = 'butt';

    // exposed forearm bone
    ctx.strokeStyle = flash ? '#FFF' : 'rgba(215,205,180,0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(reach * 0.85, sag * 0.7);
    ctx.lineTo(reach * 1.20, sag * 0.9);
    ctx.stroke();

    // clawed hand
    const hx = reach * 1.42, hy = sag;
    ctx.fillStyle = rot;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(hx, hy, 3.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // three curled fingers
    ctx.strokeStyle = flash ? '#FFF' : '#1A1210';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    for (const fo of [-2.4, 0, 2.4]) {
      ctx.beginPath();
      ctx.moveTo(hx + 1.5, hy + fo * 0.6);
      ctx.quadraticCurveTo(hx + 5, hy + fo * 0.85, hx + 6.2, hy + fo * 1.5);
      ctx.stroke();
    }
    // claw tips catching the light
    ctx.strokeStyle = e.eye;
    ctx.lineWidth = 1;
    for (const fo of [-2.4, 0, 2.4]) {
      ctx.beginPath();
      ctx.moveTo(hx + 5.4, hy + fo * 1.2);
      ctx.lineTo(hx + 6.6, hy + fo * 1.6);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';

    ctx.restore();
  }

  // Lighten (+) or darken (-) a hex colour.
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else          { r *= (1 + amt); g *= (1 + amt); b *= (1 + amt); }
    return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
  }

  // Palette for the RoboKyle sprite
  const SKIN      = '#D9A97A';
  const SKIN_DARK = '#B3855A';
  const SKIN_LINE = '#7A5636';
  const TANK      = '#15171F';
  const TANK_HI   = '#262A36';
  const METAL     = '#C9CFDA';
  const METAL_MID = '#9AA2B2';
  const METAL_DK  = '#5A6070';
  const HAIR      = '#F2C75E';
  const HAIR_DK   = '#C99A31';

  // ============================================================
  // ROBOKYLE SPRITE
  // Top-down, facing +X. Built shoulder-heavy and tapered so he
  // reads as a hulking soldier, not a circle. Both arms converge
  // forward onto the weapon so the gun is actually *held*.
  // ============================================================
  function drawPlayer(p) {
    const recoilAmt = p.lastShotFlash > 0 ? (p.lastShotFlash / 90) : 0;
    const recoil = recoilAmt * (p.weapon === 'rocket' ? 4 : p.weapon === 'shotgun' ? 3.5 : 2);
    const walk = Math.sin(p.walkPhase);
    const breathe = Math.sin(p.idlePhase) * 0.4;

    // Torso proportions: wide across the shoulders, shallow front-to-back.
    const SH = p.r * 1.16;              // half shoulder width (across body)
    const CH = p.r * 0.80;              // half chest depth (along facing)

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.translate(-recoil, 0);

    // ---------- ground shadow ----------
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(1, 3, CH + 5, SH + 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // ---------- LEGS (behind torso) ----------
    drawLeg(-1, -SH * 0.55, -0.30,  walk, p);
    drawLeg(-1,  SH * 0.55,  0.30, -walk, p);

    // ---------- TORSO ----------
    // Deltoid mass first (skin), forming a wide yoke across the shoulders
    ctx.fillStyle = SKIN;
    ctx.strokeStyle = SKIN_LINE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(-1, 0, CH + 1.5, SH + breathe * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Lat taper — darker wedge narrowing toward the back
    ctx.fillStyle = SKIN_DARK;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(-CH - 1, -SH * 0.75);
    ctx.quadraticCurveTo(-CH - 5, 0, -CH - 1, SH * 0.75);
    ctx.quadraticCurveTo(-CH + 2, 0, -CH - 1, -SH * 0.75);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Black tank top — narrower than the deltoids so skin shows at the shoulders
    ctx.fillStyle = TANK;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(-2, 0, CH, SH * 0.74 + breathe * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Tank fabric highlight
    ctx.fillStyle = TANK_HI;
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.ellipse(-3, -SH * 0.26, CH * 0.62, SH * 0.24, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Pec split
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(CH * 0.55, -SH * 0.34);
    ctx.lineTo(CH * 0.30, 0);
    ctx.lineTo(CH * 0.55, SH * 0.34);
    ctx.stroke();

    // Dog tags swinging on the chest
    const tagSway = Math.sin(p.walkPhase * 1.1) * 1.4;
    ctx.strokeStyle = '#9AA0AD';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(CH * 0.45, -3.2);
    ctx.quadraticCurveTo(CH * 0.95, tagSway * 0.4, CH * 0.55, 3.4 + tagSway);
    ctx.stroke();
    ctx.fillStyle = METAL;
    ctx.strokeStyle = METAL_DK;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.roundRect(CH * 0.42, 2.6 + tagSway, 3.2, 2.1, 0.7);
    ctx.fill();
    ctx.stroke();

    // ---------- ARMS ----------
    // Both converge forward onto the grip point where the weapon sits.
    const grip = weaponGrip(p);          // {x, y} in local space
    // Flesh arm (lower shoulder) → fore-grip
    drawFleshArm(-1, SH * 0.80, grip.x - 3, grip.y + 3.5, recoilAmt);
    // Mech arm (upper shoulder) → trigger hand
    drawMechArm(-1, -SH * 0.80, grip.x - 1, grip.y - 3.0, recoilAmt);

    // ---------- WEAPON (held at the grip point) ----------
    drawWeapon(p, grip);

    // ---------- HEAD ----------
    drawHead(CH * 0.45, 0, p);

    // ---------- hit tint ----------
    if (p.hitFlash > 0) {
      ctx.fillStyle = 'rgba(255,70,55,' + Math.min(0.45, p.hitFlash / 26) + ')';
      ctx.beginPath();
      ctx.ellipse(-1, 0, CH + 4, SH + 3, 0, 0, Math.PI * 2);
      ctx.fill();
      p.hitFlash -= 0.4;
    }

    ctx.restore();

    // ---------- sprint dust (world space) ----------
    if (p.sprinting && Math.random() < 0.4) {
      S.particles.push({
        x: p.x - Math.cos(p.angle) * 12 + rand(-4, 4),
        y: p.y - Math.sin(p.angle) * 12 + rand(-4, 4),
        vx: rand(-0.5, 0.5) - Math.cos(p.angle) * 0.4,
        vy: rand(-0.5, 0.5) - Math.sin(p.angle) * 0.4,
        life: rand(10, 20), r: rand(1.6, 3.4),
        color: 'rgba(170,165,158,0.45)',
      });
    }
  }

  // A leg: thigh wedge + boot, swinging along the facing axis.
  function drawLeg(ox, oy, splay, swing, p) {
    const reach = 7 + swing * 3.4;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(splay + swing * 0.10);
    // thigh (cargo pants)
    ctx.fillStyle = '#2A3140';
    ctx.strokeStyle = '#0D1017';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.roundRect(-2, -3.2, reach + 4, 6.4, 3);
    ctx.fill();
    ctx.stroke();
    // knee pad
    ctx.fillStyle = '#1B2029';
    ctx.beginPath();
    ctx.roundRect(reach - 1, -2.6, 3.4, 5.2, 1.4);
    ctx.fill();
    // boot
    ctx.fillStyle = '#15181F';
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.roundRect(reach + 2, -3.4, 6.2, 6.8, 2.2);
    ctx.fill();
    ctx.stroke();
    // boot tread highlight
    ctx.fillStyle = '#333A47';
    ctx.fillRect(reach + 3, -3.0, 4.2, 1.1);
    ctx.restore();
  }

  // Organic arm: bicep → forearm → fist, elbow bending outward.
  function drawFleshArm(sx, sy, hx, hy, recoilAmt) {
    const ex = (sx + hx) / 2 + 1.5;              // elbow bows outward/back
    const ey = (sy + hy) / 2 + 5.5;
    const jitter = recoilAmt * 1.6;

    ctx.lineCap = 'round';
    // bicep
    ctx.strokeStyle = SKIN;
    ctx.lineWidth = 7.4;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey + jitter);
    ctx.stroke();
    ctx.strokeStyle = SKIN_LINE;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey + jitter);
    ctx.stroke();
    // bicep bulge shading
    ctx.strokeStyle = SKIN_DARK;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx + 1, sy + 2.2);
    ctx.lineTo(ex - 0.5, ey + 2 + jitter);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // forearm
    ctx.strokeStyle = SKIN;
    ctx.lineWidth = 6.2;
    ctx.beginPath();
    ctx.moveTo(ex, ey + jitter);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.strokeStyle = SKIN_LINE;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(ex, ey + jitter);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.lineCap = 'butt';
    // fist wrapped on the grip
    ctx.fillStyle = SKIN_DARK;
    ctx.strokeStyle = SKIN_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // knuckle line
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(hx - 1.5, hy - 2.4);
    ctx.lineTo(hx + 1.8, hy - 1.4);
    ctx.stroke();
  }

  // Cybernetic arm: pauldron → piston upper → elbow → forearm → claw hand.
  function drawMechArm(sx, sy, hx, hy, recoilAmt) {
    const ex = (sx + hx) / 2 + 1;
    const ey = (sy + hy) / 2 - 5.5;
    const jitter = recoilAmt * 2.2;

    // --- shoulder pauldron
    ctx.save();
    ctx.translate(sx, sy);
    ctx.fillStyle = METAL;
    ctx.strokeStyle = METAL_DK;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 7.6, 6.6, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // layered plating
    ctx.fillStyle = METAL_MID;
    ctx.beginPath();
    ctx.ellipse(-0.6, -1.4, 6.2, 4.4, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = METAL_DK;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-5.4, -2.6); ctx.lineTo(4.6, -3.6);
    ctx.moveTo(-5.8, 0.4);  ctx.lineTo(5.2, -0.6);
    ctx.stroke();
    // glowing actuator core
    ctx.fillStyle = '#2C3240';
    ctx.beginPath(); ctx.arc(0.5, 0.5, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6FBFCB';
    ctx.beginPath(); ctx.arc(0.5, 0.5, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(111,191,203,0.35)';
    ctx.beginPath(); ctx.arc(0.5, 0.5, 2.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.lineCap = 'round';
    // --- upper arm (thick hydraulic)
    ctx.strokeStyle = METAL_MID;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey - jitter);
    ctx.stroke();
    ctx.strokeStyle = METAL_DK;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey - jitter);
    ctx.stroke();
    // piston rails along the upper arm
    const ux = ex - sx, uy = (ey - jitter) - sy;
    const ul = Math.hypot(ux, uy) || 1;
    const pnx = -uy / ul, pny = ux / ul;
    ctx.strokeStyle = '#7C8494';
    ctx.lineWidth = 1.1;
    for (const off of [-1.9, 1.9]) {
      ctx.beginPath();
      ctx.moveTo(sx + pnx * off + ux * 0.22, sy + pny * off + uy * 0.22);
      ctx.lineTo(sx + pnx * off + ux * 0.82, sy + pny * off + uy * 0.82);
      ctx.stroke();
    }

    // --- elbow joint
    ctx.fillStyle = METAL;
    ctx.strokeStyle = METAL_DK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(ex, ey - jitter, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = METAL_DK;
    ctx.beginPath();
    ctx.arc(ex, ey - jitter, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // --- forearm
    ctx.strokeStyle = METAL;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(ex, ey - jitter);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.strokeStyle = METAL_DK;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(ex, ey - jitter);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    // vent slots on the forearm
    const fx = hx - ex, fy = hy - (ey - jitter);
    const fl = Math.hypot(fx, fy) || 1;
    const fnx = -fy / fl, fny = fx / fl;
    ctx.strokeStyle = '#454C5C';
    ctx.lineWidth = 1;
    for (const t of [0.35, 0.52, 0.69]) {
      const bx = ex + fx * t, by = (ey - jitter) + fy * t;
      ctx.beginPath();
      ctx.moveTo(bx + fnx * 2, by + fny * 2);
      ctx.lineTo(bx - fnx * 2, by - fny * 2);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';

    // --- mechanical grip hand
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(Math.atan2(fy, fx));
    ctx.fillStyle = METAL;
    ctx.strokeStyle = METAL_DK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-3, -3.4, 6.5, 6.8, 1.8);
    ctx.fill();
    ctx.stroke();
    // finger plates closing on the grip
    ctx.fillStyle = METAL_MID;
    ctx.beginPath(); ctx.roundRect(0.5, -3.8, 3.2, 2.0, 0.8); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(0.5,  1.8, 3.2, 2.0, 0.8); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // Head: skull, swept-back spiked blonde hair, scowl, steel eyes.
  function drawHead(hx, hy, p) {
    const HEAD_R = 6.9;
    ctx.save();
    ctx.translate(hx, hy);

    // neck shade under the jaw
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(-1.5, 0, HEAD_R * 0.9, HEAD_R * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();

    // skull
    ctx.fillStyle = SKIN;
    ctx.strokeStyle = SKIN_LINE;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(0, 0, HEAD_R * 0.95, HEAD_R, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // jaw / cheek shading toward the back
    ctx.fillStyle = SKIN_DARK;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.ellipse(-2, 0, HEAD_R * 0.7, HEAD_R * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // hair mass — covers the back 60% of the skull
    ctx.fillStyle = HAIR;
    ctx.strokeStyle = HAIR_DK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(-1.6, 0, HEAD_R * 0.82, HEAD_R * 0.96, 0, Math.PI * 0.40, Math.PI * 1.60);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // spikes fanning backward
    ctx.fillStyle = HAIR;
    ctx.strokeStyle = HAIR_DK;
    ctx.lineWidth = 0.8;
    const spikes = [
      [-3.0, -5.4, -7.6, -7.4],
      [-4.4, -2.4, -9.6, -3.4],
      [-4.8,  0.4, -10.4, 0.4],
      [-4.4,  2.8, -9.6,  3.8],
      [-3.0,  5.4, -7.6,  7.4],
    ];
    for (const [x1, y1, x2, y2] of spikes) {
      ctx.beginPath();
      ctx.moveTo(x1, y1 - 1.3);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x1, y1 + 1.3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // heavy brow ridge (angry)
    ctx.strokeStyle = '#5A3C20';
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(2.6, -4.2); ctx.lineTo(5.4, -2.4);
    ctx.moveTo(2.6,  4.2); ctx.lineTo(5.4,  2.4);
    ctx.stroke();
    ctx.lineCap = 'butt';

    // eyes
    ctx.fillStyle = '#EDF3F7';
    ctx.beginPath();
    ctx.ellipse(4.6, -2.4, 1.8, 1.15, -0.3, 0, Math.PI * 2);
    ctx.ellipse(4.6,  2.4, 1.8, 1.15,  0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#37647B';
    ctx.beginPath();
    ctx.arc(5.3, -2.4, 0.9, 0, Math.PI * 2);
    ctx.arc(5.3,  2.4, 0.9, 0, Math.PI * 2);
    ctx.fill();

    // stubbled jawline hint
    ctx.strokeStyle = 'rgba(90,60,32,0.5)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(1.5, 0, HEAD_R * 0.86, Math.PI * 1.72, Math.PI * 0.28);
    ctx.stroke();

    ctx.restore();
  }

  // Where the weapon sits relative to the body — the hands go here.
  function weaponGrip(p) {
    const base = p.r * 0.92;
    if (p.weapon === 'rocket')  return { x: base + 3, y: -2.5 };
    if (p.weapon === 'shotgun') return { x: base + 2, y: -0.5 };
    if (p.weapon === 'uzi')     return { x: base + 1, y: 0 };
    return { x: base, y: 0 };
  }

  // ============================================================
  // WEAPONS — drawn from the grip point outward.
  // ============================================================
  function drawWeapon(p, grip) {
    const GUNMETAL = '#252B38';
    const GUN_MID  = '#39414F';
    const GUN_HI   = '#5A6374';
    const WOOD     = '#6A4728';
    const WOOD_DK  = '#4A3019';

    ctx.save();
    ctx.translate(grip.x, grip.y);
    ctx.strokeStyle = '#080A0E';
    ctx.lineWidth = 1.1;

    if (p.weapon === 'shotgun') {
      // stock tucked back toward the shoulder
      ctx.fillStyle = WOOD;
      ctx.beginPath(); ctx.moveTo(-13, -1); ctx.lineTo(-4, -3); ctx.lineTo(-4, 3.4); ctx.lineTo(-12, 3.4); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = WOOD_DK;
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(-13, -1); ctx.lineTo(-4, -3); ctx.lineTo(-4, -1); ctx.closePath();
      ctx.fill(); ctx.globalAlpha = 1;
      // receiver
      ctx.fillStyle = GUNMETAL;
      ctx.beginPath(); ctx.roundRect(-4, -4, 12, 8, 1.6); ctx.fill(); ctx.stroke();
      // ejection port
      ctx.fillStyle = '#12161E';
      ctx.beginPath(); ctx.roundRect(-1, -3.2, 5, 2.2, 0.7); ctx.fill();
      // twin barrels
      ctx.fillStyle = GUN_MID;
      ctx.beginPath(); ctx.roundRect(8, -3.8, 17, 3.3, 1.2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.roundRect(8,  0.5, 17, 3.3, 1.2); ctx.fill(); ctx.stroke();
      // barrel sheen
      ctx.fillStyle = GUN_HI;
      ctx.fillRect(10, -3.4, 13, 0.9);
      ctx.fillRect(10,  0.9, 13, 0.9);
      // pump grip (where the flesh hand lands)
      ctx.fillStyle = WOOD;
      ctx.beginPath(); ctx.roundRect(11, -1.2, 7, 2.6, 1); ctx.fill(); ctx.stroke();
      // bead sight
      ctx.fillStyle = GUN_HI;
      ctx.fillRect(23, -5, 1.4, 1.8);

    } else if (p.weapon === 'rocket') {
      // launch tube
      ctx.fillStyle = '#333B49';
      ctx.beginPath(); ctx.roundRect(-13, -6, 34, 12, 3.5); ctx.fill(); ctx.stroke();
      // tube ribbing
      ctx.strokeStyle = '#1B2028';
      ctx.lineWidth = 0.9;
      for (const rx of [-6, 0, 6]) {
        ctx.beginPath(); ctx.moveTo(rx, -5.6); ctx.lineTo(rx, 5.6); ctx.stroke();
      }
      ctx.strokeStyle = '#080A0E';
      ctx.lineWidth = 1.1;
      // rear blast vent
      ctx.fillStyle = '#101319';
      ctx.beginPath(); ctx.roundRect(-17, -4.4, 5, 8.8, 1.6); ctx.fill(); ctx.stroke();
      // hazard band
      ctx.fillStyle = '#F0C56A';
      ctx.fillRect(9, -6, 3.4, 12);
      ctx.fillStyle = '#1A1D24';
      ctx.fillRect(9, -6, 1.2, 12);
      // warhead
      ctx.fillStyle = '#DA3F2B';
      ctx.beginPath();
      ctx.moveTo(21, -6); ctx.lineTo(30, 0); ctx.lineTo(21, 6);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#F2705A';
      ctx.beginPath();
      ctx.moveTo(21, -6); ctx.lineTo(30, 0); ctx.lineTo(24, -1.5);
      ctx.closePath(); ctx.fill();
      // optic on top
      ctx.fillStyle = GUN_MID;
      ctx.beginPath(); ctx.roundRect(-2, -9.5, 8, 4, 1.2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#6FBFCB';
      ctx.beginPath(); ctx.arc(4.5, -7.5, 1.3, 0, Math.PI * 2); ctx.fill();
      // fore grip
      ctx.fillStyle = '#1B2028';
      ctx.beginPath(); ctx.roundRect(-3, 5.4, 4.5, 5, 1.4); ctx.fill(); ctx.stroke();

    } else if (p.weapon === 'uzi') {
      // receiver
      ctx.fillStyle = GUNMETAL;
      ctx.beginPath(); ctx.roundRect(-6, -3.4, 17, 6.8, 1.8); ctx.fill(); ctx.stroke();
      // top rail + sight
      ctx.fillStyle = GUN_MID;
      ctx.fillRect(-3, -5, 9, 1.8);
      ctx.fillStyle = GUN_HI;
      ctx.fillRect(4.5, -6.2, 1.4, 1.6);
      // barrel + shroud
      ctx.fillStyle = GUN_MID;
      ctx.beginPath(); ctx.roundRect(11, -2.2, 6, 4.4, 1.2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = GUN_HI;
      ctx.beginPath(); ctx.roundRect(17, -1.3, 4, 2.6, 1); ctx.fill(); ctx.stroke();
      // curved magazine (fore-grip is the mag on an uzi)
      ctx.fillStyle = '#1D222C';
      ctx.beginPath(); ctx.roundRect(0.5, 3, 4.6, 10, 1.4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2E3542';
      ctx.fillRect(1.4, 5, 2.8, 1);
      ctx.fillRect(1.4, 7.6, 2.8, 1);
      // stock stub
      ctx.fillStyle = '#1B2028';
      ctx.beginPath(); ctx.roundRect(-11, -2, 5.5, 4, 1.2); ctx.fill(); ctx.stroke();

    } else {
      // heavy combat pistol
      ctx.fillStyle = GUNMETAL;
      ctx.beginPath(); ctx.roundRect(-4, -3, 15, 5.6, 1.4); ctx.fill(); ctx.stroke();
      // slide serrations
      ctx.strokeStyle = GUN_HI;
      ctx.lineWidth = 0.8;
      for (const sxp of [-2.4, -0.9, 0.6]) {
        ctx.beginPath(); ctx.moveTo(sxp, -2.4); ctx.lineTo(sxp, 2); ctx.stroke();
      }
      ctx.strokeStyle = '#080A0E';
      ctx.lineWidth = 1.1;
      // muzzle
      ctx.fillStyle = GUN_MID;
      ctx.beginPath(); ctx.roundRect(11, -1.9, 5, 3.6, 1.1); ctx.fill(); ctx.stroke();
      // sights
      ctx.fillStyle = GUN_HI;
      ctx.fillRect(-3, -4.2, 1.6, 1.4);
      ctx.fillRect(9.4, -4.2, 1.4, 1.4);
      // grip angled down-back
      ctx.fillStyle = '#1D222C';
      ctx.beginPath();
      ctx.moveTo(-3, 2.4); ctx.lineTo(2.4, 2.4); ctx.lineTo(0.6, 10); ctx.lineTo(-4.6, 9.4);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // grip texture
      ctx.strokeStyle = '#39414F';
      ctx.lineWidth = 0.7;
      for (const gy of [4.6, 6.2, 7.8]) {
        ctx.beginPath(); ctx.moveTo(-3.4, gy); ctx.lineTo(1.4, gy - 0.4); ctx.stroke();
      }
      // trigger guard
      ctx.strokeStyle = GUNMETAL;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(3.4, 3.6, 2.6, Math.PI * 0.1, Math.PI * 0.95);
      ctx.stroke();
    }

    // ---- muzzle flash ----
    if (p.lastShotFlash > 0) {
      const a = p.lastShotFlash / 90;
      const mz = p.weapon === 'rocket' ? 31 : p.weapon === 'shotgun' ? 26 : p.weapon === 'uzi' ? 22 : 17;
      const size = (p.weapon === 'shotgun' ? 10 : p.weapon === 'rocket' ? 11 : p.weapon === 'uzi' ? 6 : 7) + Math.random() * 3;
      const grad = ctx.createRadialGradient(mz, 0, 0, mz, 0, size);
      grad.addColorStop(0,   'rgba(255,255,225,' + a + ')');
      grad.addColorStop(0.35,'rgba(255,196,96,' + (a * 0.9) + ')');
      grad.addColorStop(1,   'rgba(255,110,35,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(mz, 0, size, 0, Math.PI * 2);
      ctx.fill();
      // cross spikes
      ctx.strokeStyle = 'rgba(255,228,160,' + (a * 0.85) + ')';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(mz - size * 0.8, 0); ctx.lineTo(mz + size * 1.35, 0);
      ctx.moveTo(mz, -size * 0.7);    ctx.lineTo(mz, size * 0.7);
      ctx.stroke();
      // smoke puff
      if (Math.random() < 0.5) {
        ctx.fillStyle = 'rgba(190,190,190,' + (a * 0.22) + ')';
        ctx.beginPath();
        ctx.arc(mz + rand(2, 7), rand(-3, 3), rand(2.5, 5), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }


  function drawVignette() {
    // Heavy dark vignette
    const vg = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.32, W/2, H/2, Math.max(W,H)*0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(0.7, 'rgba(8,3,3,0.42)');
    vg.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // Hell-glow creeping in from the bottom, breathing with intensity
    const heat = 0.10 + Math.min(0.30, S.wave * 0.018) + (S.enemies.length / 200);
    const flick = 1 + Math.sin(performance.now() / 420) * 0.10;
    const hg = ctx.createLinearGradient(0, H, 0, H * 0.42);
    hg.addColorStop(0, 'rgba(150,26,20,' + (heat * flick) + ')');
    hg.addColorStop(1, 'rgba(150,26,20,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, W, H);

    // Subtle scanlines for the CRT/arcade feel
    ctx.globalAlpha = 0.055;
    ctx.fillStyle = '#000';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    ctx.globalAlpha = 1;
  }

  function drawHitFlash() {
    if (S.player && S.player.hitFlash > 0) {
      const flash = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.3, W/2, H/2, Math.max(W,H)*0.7);
      flash.addColorStop(0, 'rgba(196,69,62,0)');
      flash.addColorStop(1, 'rgba(196,69,62,' + Math.min(0.55, S.player.hitFlash / 14) + ')');
      ctx.fillStyle = flash;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawOffscreenIndicators() {
    if (!S.player) return;
    const pad = 26;
    for (const e of S.enemies) {
      const s = worldToScreen(e.x, e.y);
      if (s.x >= 0 && s.x <= W && s.y >= 0 && s.y <= H) continue;
      // Direction from screen center to enemy
      const dx = s.x - W/2, dy = s.y - H/2;
      const angle = Math.atan2(dy, dx);
      // Clip to edge inside pad
      const halfW = W/2 - pad, halfH = H/2 - pad;
      const t = Math.min(halfW / Math.abs(Math.cos(angle) || 0.001), halfH / Math.abs(Math.sin(angle) || 0.001));
      const ix = W/2 + Math.cos(angle) * t;
      const iy = H/2 + Math.sin(angle) * t;
      // Triangle
      ctx.save();
      ctx.translate(ix, iy);
      ctx.rotate(angle);
      ctx.fillStyle = e.explosive ? '#FF5030' : (e.type === 'brute' ? '#E36B3E' : 'rgba(230,80,60,0.85)');
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(8, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  function drawMinimap() {
    if (!S.mapData) return;
    const m = S.mapData;
    const mmW = mini.width, mmH = mini.height;
    const scaleX = mmW / m.worldW;
    const scaleY = mmH / m.worldH;
    const scale = Math.min(scaleX, scaleY);
    const offX = (mmW - m.worldW * scale) / 2;
    const offY = (mmH - m.worldH * scale) / 2;

    mctx.clearRect(0, 0, mmW, mmH);
    // BG
    mctx.fillStyle = m.floor;
    mctx.fillRect(offX, offY, m.worldW * scale, m.worldH * scale);
    // Bounds (rooftop)
    if (m.bounds) {
      const b = m.bounds;
      mctx.strokeStyle = m.accent;
      mctx.lineWidth = 1;
      mctx.strokeRect(offX + b.x * scale, offY + b.y * scale, b.w * scale, b.h * scale);
    }
    // Obstacles
    mctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (const o of m.obstacles) {
      mctx.fillRect(offX + o.x * scale, offY + o.y * scale, Math.max(1, o.w * scale), Math.max(1, o.h * scale));
    }
    // Enemies
    for (const e of S.enemies) {
      mctx.fillStyle = e.explosive ? '#FF5030' : (e.type === 'brute' ? '#E36B3E' : '#C4453E');
      mctx.beginPath();
      mctx.arc(offX + e.x * scale, offY + e.y * scale, 2, 0, Math.PI * 2);
      mctx.fill();
    }
    // Player
    if (S.player) {
      mctx.fillStyle = '#F0C56A';
      mctx.beginPath();
      mctx.arc(offX + S.player.x * scale, offY + S.player.y * scale, 3, 0, Math.PI * 2);
      mctx.fill();
      mctx.strokeStyle = '#000';
      mctx.lineWidth = 1;
      mctx.stroke();
    }
    // Viewport rect
    const view = visibleWorldRect();
    mctx.strokeStyle = 'rgba(230,230,230,0.6)';
    mctx.lineWidth = 1;
    mctx.strokeRect(offX + view.x * scale, offY + view.y * scale, view.w * scale, view.h * scale);
  }

  function visibleWorldRect() {
    const w = W / S.cam.zoom, h = H / S.cam.zoom;
    return { x: S.cam.x - w/2, y: S.cam.y - h/2, w, h };
  }

  // ==================== HUD ====================
  function updateHUD() {
    if (!S.player) return;
    hud.hp.textContent = Math.max(0, Math.ceil(S.player.hp));
    hud.hpBar.style.width = Math.max(0, S.player.hp) + '%';
    hud.sprintBar.style.width = Math.round((S.player.sprint / SPRINT_BUDGET_MS) * 100) + '%';
    hud.wave.textContent = S.wave;
    hud.score.textContent = S.score;
    const w = WEAPONS[S.player.weapon];
    hud.weapon.textContent = w.name;
    hud.ammo.innerHTML = S.player.weapon === 'pistol' ? '&infin;' : String(S.player.ammo[S.player.weapon]);
    updateTouchWeapons();
  }

  // ==================== LOOP ====================
  function loop(t) {
    if (!S.running) return;
    let dtMs = Math.min(48, t - S.lastTime);
    S.lastTime = t;
    // Hit-stop: briefly slow time on heavy impacts for weight
    if (S.hitStop > 0) {
      S.hitStop = Math.max(0, S.hitStop - dtMs);
      dtMs *= 0.25;
    }
    if (!S.paused) update(dtMs);
    draw();
    requestAnimationFrame(loop);
  }

  // ==================== BOOT ====================
  show('title');
})();
