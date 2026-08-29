/* ==================================================================
   RoboKyle: Fly Game

   Scaffolding for the third title, built around one decision: the
   thing that varies is how you steer, so input is a layer with
   swappable schemes and everything downstream reads one normalised
   pair of axes. Adding head tracking, a sip and puff switch, a
   gamepad or an eye tracker later means writing a scheme, not
   touching the game.

   Every scheme drives the same craft against the same course. None
   of them is an easier mode.

   Canvas sizing follows what the other two games arrived at: a
   ResizeObserver on the element rather than a window resize
   listener, because entering fullscreen resizes the canvas without
   the window necessarily reporting it.
   ================================================================== */

import * as THREE from 'three';

const frame  = document.getElementById('fly-frame');
const canvas = document.getElementById('fly-canvas');
const wrap   = canvas.parentElement;

/* ===== Settings ===== */

const KEY = 'rk_fly_settings';

const settings = {
  scheme:   'keyboard',
  speed:    4,     // 1..10
  assist:   5,     // 1..10, how much the craft is helped toward where you point
  gate:     6,     // 1..10, gate radius
  noFail:   true,
  contrast: false,
  calm:     false,
};

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  Object.assign(settings, saved);
} catch (e) { /* first run, or storage is off */ }

function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {}
}

const prefersCalm = window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (prefersCalm) settings.calm = true;

/* ==================================================================
   Input

   Schemes report into `axis`, which is where the craft wants to be
   in its own square: x and y both run -1 to 1, centre is 0,0. A
   scheme never touches the world.
   ================================================================== */

const Input = {
  axis: { x: 0, y: 0 },
  held: false,          // single switch state
  pointer: { x: 0, y: 0, seen: false },
  keys: Object.create(null),

  label() {
    return { keyboard: 'Keyboard', pointer: 'Pointer', dwell: 'Single switch' }[settings.scheme];
  },

  // Called once a frame with seconds elapsed.
  sample(dt) {
    if (settings.scheme === 'keyboard') this.sampleKeyboard(dt);
    else if (settings.scheme === 'pointer') this.samplePointer();
    else this.sampleDwell(dt);
    this.axis.x = clamp(this.axis.x, -1, 1);
    this.axis.y = clamp(this.axis.y, -1, 1);
  },

  sampleKeyboard(dt) {
    const k = this.keys;
    let dx = 0, dy = 0;
    if (k['arrowleft']  || k['a']) dx -= 1;
    if (k['arrowright'] || k['d']) dx += 1;
    if (k['arrowup']    || k['w']) dy += 1;
    if (k['arrowdown']  || k['s']) dy -= 1;

    // Ease toward the held direction and back to centre on release, so a key
    // that is hard to hold steadily still produces a smooth line.
    const rate = 2.6 * dt;
    this.axis.x += (dx - this.axis.x) * rate;
    this.axis.y += (dy - this.axis.y) * rate;
  },

  samplePointer() {
    if (!this.pointer.seen) return;
    this.axis.x = this.pointer.x;
    this.axis.y = this.pointer.y;
  },

  // One input, two states. Held climbs, released sinks, and the craft drifts
  // across on its own so a single switch can still reach the whole gate.
  sampleDwell(dt) {
    const target = this.held ? 1 : -1;
    this.axis.y += (target - this.axis.y) * 2.2 * dt;
    this.axis.x = Math.sin(perfNow() / 1400) * 0.72;
  },
};

function bindInput() {
  addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    Input.keys[k] = true;
    if (k === ' ' || k === 'enter') Input.held = true;
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (k === 'escape' && state.screen === 'fly') togglePause();
  });
  addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    Input.keys[k] = false;
    if (k === ' ' || k === 'enter') Input.held = false;
  });

  const readPointer = e => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    Input.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    Input.pointer.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    Input.pointer.seen = true;
  };
  canvas.addEventListener('pointermove', readPointer, { passive: true });
  canvas.addEventListener('pointerdown', e => { readPointer(e); Input.held = true; });
  addEventListener('pointerup', () => { Input.held = false; });
}

/* ===== Scene ===== */

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setClearColor(0x05080d, 1);

const craft = new THREE.Group();
const gates = [];

const COURSE = {
  spacing: 26,     // world units between gates
  count: 8,        // gates alive at once
  reach: 9,        // how far off centre the craft may sit
};

function buildScene() {
  scene.fog = new THREE.Fog(0x05080d, 40, 190);

  scene.add(new THREE.HemisphereLight(0x9fd8ee, 0x0a1018, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(6, 10, 4);
  scene.add(key);

  // A floor grid gives the forward motion something to read against, which
  // matters more than it looks: without it the craft appears to hang still.
  const grid = new THREE.GridHelper(400, 80, 0x2b4657, 0x16232e);
  grid.position.y = -12;
  scene.add(grid);

  // The craft, read from behind and slightly above. Deliberately high
  // contrast against the background so it stays findable at low vision, and
  // built from a fuselage plus wings plus a fin so the silhouette still says
  // "aircraft" from the one angle the player ever sees it from.
  const skin = new THREE.MeshStandardMaterial({ color: 0xe3552b, roughness: 0.35, metalness: 0.2 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xf6f1e8, roughness: 0.5 });

  const fuselage = new THREE.Mesh(new THREE.ConeGeometry(0.44, 3.2, 12), skin);
  fuselage.rotation.x = -Math.PI / 2;
  fuselage.position.z = -0.5;
  craft.add(fuselage);

  // Swept wings as two pieces rather than one bar. From behind, a single box
  // reads as a plank; two swept panels with marked tips read as a planform.
  const wingGeo = new THREE.BoxGeometry(2.0, 0.16, 0.95);
  const wingL = new THREE.Mesh(wingGeo, skin);
  wingL.position.set(-1.0, 0, 0.5);
  wingL.rotation.y = -0.2;
  craft.add(wingL);
  const wingR = new THREE.Mesh(wingGeo, skin);
  wingR.position.set(1.0, 0, 0.5);
  wingR.rotation.y = 0.2;
  craft.add(wingR);

  const tipGeo = new THREE.BoxGeometry(0.36, 0.2, 0.55);
  const tipL = new THREE.Mesh(tipGeo, trim);
  tipL.position.set(-1.98, 0, 0.72);
  craft.add(tipL);
  const tipR = new THREE.Mesh(tipGeo, trim);
  tipR.position.set(1.98, 0, 0.72);
  craft.add(tipR);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), trim);
  canopy.scale.set(1, 0.62, 1.5);
  canopy.position.set(0, 0.26, -0.15);
  craft.add(canopy);

  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.05, 0.95), skin);
  fin.position.set(0, 0.6, 1.0);
  craft.add(fin);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.5), skin);
  tail.position.set(0, 0.06, 1.1);
  craft.add(tail);

  craft.scale.setScalar(1.45);
  scene.add(craft);

  for (let i = 0; i < COURSE.count; i++) gates.push(makeGate(-(i + 1) * COURSE.spacing));
}

function makeGate(z) {
  const g = new THREE.Group();
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(gateRadius(), 0.22, 10, 40),
    new THREE.MeshStandardMaterial({ color: 0x4fb8d8, emissive: 0x123845, roughness: 0.4 })
  );
  g.add(torus);
  g.position.set(0, 0, z);
  g.userData = { torus, passed: false };
  placeGate(g);
  scene.add(g);
  return g;
}

function gateRadius() { return 2.8 + settings.gate * 0.62; }

function placeGate(g) {
  const spread = COURSE.reach * 0.72;
  g.position.x = (Math.random() * 2 - 1) * spread;
  g.position.y = (Math.random() * 2 - 1) * spread * 0.62;
  g.userData.passed = false;
  g.userData.torus.material.color.setHex(0x4fb8d8);
}

/* ===== Sizing ===== */

let VW = 0, VH = 0, DPR = 1;

function resize() {
  const r = wrap.getBoundingClientRect();
  // A hidden wrapper measures 0x0; keep the last good size rather than
  // rebuilding the drawing buffer at some meaningless floor.
  if (r.width < 2 || r.height < 2) return;
  DPR = Math.min(2, window.devicePixelRatio || 1);
  VW = Math.round(r.width);
  VH = Math.round(r.height);
  renderer.setPixelRatio(DPR);
  renderer.setSize(VW, VH, false);
  camera.aspect = VW / VH;
  camera.updateProjectionMatrix();
}

if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(wrap);
addEventListener('resize', resize);

/* ===== Game state ===== */

const state = { screen: 'title', running: false, paused: false, gates: 0, streak: 0, t: 0 };

const hud = {
  gates:  document.getElementById('hud-gates'),
  streak: document.getElementById('hud-streak'),
  scheme: document.getElementById('hud-scheme'),
};

function show(name) {
  state.screen = name;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  if (name === 'fly') resize();
}

function startRun() {
  state.running = true;
  state.paused = false;
  state.gates = 0;
  state.streak = 0;
  craft.position.set(0, 0, 0);
  gates.forEach((g, i) => { g.position.z = -(i + 1) * COURSE.spacing; placeGate(g); });
  document.getElementById('fly-pause').hidden = true;
  show('fly');
  hintTimer = 4;
  updateHud();
}

function togglePause() {
  if (!state.running) return;
  state.paused = !state.paused;
  document.getElementById('fly-pause').hidden = !state.paused;
}

function updateHud() {
  hud.gates.textContent = state.gates;
  hud.streak.textContent = state.streak;
  hud.scheme.textContent = Input.label();
}

/* ===== Loop ===== */

let last = perfNow();
let hintTimer = 4;
const hintEl = document.getElementById('fly-hint');

function frameLoop() {
  const now = perfNow();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state.screen === 'fly' && state.running && !state.paused) step(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frameLoop);
}

function step(dt) {
  state.t += dt;

  if (hintTimer > 0) {
    hintTimer -= dt;
    if (hintTimer <= 0) hintEl.classList.add('is-gone');
  }

  Input.sample(dt);

  // Where the player is asking to be, in world units.
  const wantX = Input.axis.x * COURSE.reach;
  const wantY = Input.axis.y * COURSE.reach * 0.62;

  // Steering help is a lerp rate, not a magnet: it never moves the craft
  // somewhere the player did not ask for, it only decides how quickly it
  // gets there. At 0 the craft answers instantly and holds still only if
  // the input does.
  const ease = 3 + settings.assist * 1.6;
  craft.position.x += (wantX - craft.position.x) * Math.min(1, ease * dt);
  craft.position.y += (wantY - craft.position.y) * Math.min(1, ease * dt);

  // Bank into the turn. Purely cosmetic, and dropped in calm mode.
  const bank = settings.calm ? 0 : (wantX - craft.position.x) * 0.06;
  craft.rotation.z += (bank - craft.rotation.z) * Math.min(1, 6 * dt);

  const speed = (6 + settings.speed * 3.4) * dt;

  for (const g of gates) {
    g.position.z += speed;

    // Scored the moment the gate plane passes the craft.
    if (!g.userData.passed && g.position.z > craft.position.z - 0.5) {
      g.userData.passed = true;
      const dx = g.position.x - craft.position.x;
      const dy = g.position.y - craft.position.y;
      const through = Math.hypot(dx, dy) <= gateRadius();
      if (through) {
        state.gates++;
        state.streak++;
        g.userData.torus.material.color.setHex(0x62c98d);
      } else {
        state.streak = 0;
        g.userData.torus.material.color.setHex(0xe3552b);
        // settings.noFail is the default and the only behaviour so far: a
        // miss costs the streak and nothing else. A fail state, if it ever
        // earns its place, hangs off here.
      }
      updateHud();
    }

    // Retire once it is behind the craft. Left any later it passes through
    // the camera and fills the screen with the inside of a torus.
    if (g.position.z > craft.position.z + 7) {
      g.position.z -= COURSE.count * COURSE.spacing;
      placeGate(g);
      g.userData.torus.geometry.dispose();
      g.userData.torus.geometry = new THREE.TorusGeometry(gateRadius(), 0.22, 10, 40);
    }
  }

  // The camera trails the craft rather than being welded to it, which keeps
  // the gate ahead in frame while still showing what the player is doing.
  const camLag = settings.calm ? 2.2 : 3.4;
  camera.position.x += (craft.position.x * 0.55 - camera.position.x) * Math.min(1, camLag * dt);
  camera.position.y += (craft.position.y * 0.5 + 6.4 - camera.position.y) * Math.min(1, camLag * dt);
  camera.position.z = craft.position.z + 14;
  camera.lookAt(craft.position.x * 0.7, craft.position.y * 0.7 + 0.2, craft.position.z - 26);
}

/* ===== Menus and options ===== */

function bindUi() {
  document.getElementById('btn-play').addEventListener('click', startRun);
  document.getElementById('btn-controls').addEventListener('click', () => show('controls'));
  document.getElementById('btn-howto').addEventListener('click', () => show('howto'));
  document.getElementById('btn-resume').addEventListener('click', togglePause);
  document.getElementById('btn-quit').addEventListener('click', () => {
    state.running = false;
    document.getElementById('fly-pause').hidden = true;
    show('title');
  });
  document.querySelectorAll('[data-goto]').forEach(b =>
    b.addEventListener('click', () => show(b.dataset.goto)));

  document.querySelectorAll('input[name="scheme"]').forEach(r => {
    r.checked = r.value === settings.scheme;
    r.addEventListener('change', () => {
      if (!r.checked) return;
      settings.scheme = r.value;
      Input.axis.x = 0; Input.axis.y = 0;
      saveSettings();
      updateHud();
    });
  });

  bindRange('opt-speed',  'speed');
  bindRange('opt-assist', 'assist');
  bindRange('opt-gate',   'gate', () => {
    for (const g of gates) {
      g.userData.torus.geometry.dispose();
      g.userData.torus.geometry = new THREE.TorusGeometry(gateRadius(), 0.22, 10, 40);
    }
  });
  bindCheck('opt-nofail',   'noFail');
  bindCheck('opt-contrast', 'contrast', applyContrast);
  bindCheck('opt-calm',     'calm');
}

function bindRange(id, key, after) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = settings[key];
  el.addEventListener('input', () => {
    settings[key] = +el.value;
    saveSettings();
    if (after) after();
  });
}

function bindCheck(id, key, after) {
  const el = document.getElementById(id);
  if (!el) return;
  el.checked = !!settings[key];
  el.addEventListener('change', () => {
    settings[key] = el.checked;
    saveSettings();
    if (after) after();
  });
}

function applyContrast() {
  document.body.classList.toggle('is-contrast', settings.contrast);
}

/* ===== Boot ===== */

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function perfNow() { return performance.now(); }

buildScene();
bindInput();
bindUi();
applyContrast();
resize();
updateHud();
requestAnimationFrame(frameLoop);
