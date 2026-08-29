/* ==================================================================
   Fly Game

   You steer with the cursor and the aircraft always flies forward.
   Where the cursor sits in the frame is where the nose wants to go:
   push it left and the aircraft banks left and comes round, hold it
   near the middle and it flies level. Clicking fires.

   Steering is deliberately absolute rather than relative. The nose
   follows where the cursor is, not how far it has moved since the
   last frame, so it behaves the same whatever is driving the cursor
   and never needs recentring.
   ================================================================== */

import * as THREE from 'three';
// Versioned like the script tags in index.html. Without this, bumping
// fly.js gets you a fresh fly.js that then imports whatever stale copy of
// world.js the browser already had, which is worse than not busting the
// cache at all: the two halves disagree.
import { createWorld, ENEMY_GUNS } from './world.js?v=12';
import { buildCraft, CRAFT } from './craft.js?v=12';
import { createAudio } from './audio.js?v=12';
import { createEffects } from './effects.js?v=12';

const frame  = document.getElementById('fly-frame');
const canvas = document.getElementById('fly-canvas');
const wrap   = canvas.parentElement;
const audio  = createAudio();

/* ===== Maps =====

   A map is a world and the aircraft that belongs in it, together. Only the
   islands exist so far; the second entry is listed so the shape of the menu
   is right, and it is not selectable until there is something behind it. */

const MAPS = [
  {
    id: 'islands',
    name: 'The Islands',
    craft: 'plane',
    flyer: 'Sport plane',
    blurb: 'Open water, scattered islands, and everything that floats over them.',
    ready: true,
    art: `<svg viewBox="0 0 132 84" aria-hidden="true" focusable="false">
      <defs><linearGradient id="ms1" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2E86C8"/><stop offset="1" stop-color="#BFE4F6"/>
      </linearGradient></defs>
      <rect width="132" height="84" fill="url(#ms1)"/>
      <g fill="#FFF" opacity=".9">
        <ellipse cx="26" cy="17" rx="11" ry="5"/><ellipse cx="34" cy="14" rx="8" ry="5"/>
        <ellipse cx="98" cy="24" rx="10" ry="4"/>
      </g>
      <rect y="47" width="132" height="37" fill="#2E86C8"/>
      <rect y="45" width="132" height="3" fill="#DCF0FB" opacity=".8"/>
      <g><ellipse cx="34" cy="62" rx="26" ry="6" fill="#EFDFA8"/>
         <path d="M34 45 L48 62 L20 62 Z" fill="#74C365"/></g>
      <g><ellipse cx="103" cy="54" rx="15" ry="4" fill="#EFDFA8"/>
         <path d="M103 42 L112 54 L94 54 Z" fill="#74C365"/></g>
      <g transform="translate(74 40) rotate(-12)">
        <rect x="-16" y="-1.6" width="32" height="3" rx="1.5" fill="#F7F1E3"/>
        <ellipse cx="0" cy="1" rx="3" ry="5" fill="#E2402F"/>
      </g>
    </svg>`,
  },
  {
    id: 'forest',
    name: 'The Forest',
    craft: 'eagle',
    flyer: 'Eagle',
    blurb: 'Dense canopy, close to the treetops.',
    ready: false,
    art: `<svg viewBox="0 0 132 84" aria-hidden="true" focusable="false">
      <rect width="132" height="84" fill="#2A3A2A"/>
      <rect y="46" width="132" height="38" fill="#24331F"/>
      <g fill="#31492C">
        <path d="M18 78 L28 50 L38 78 Z"/><path d="M44 80 L56 46 L68 80 Z"/>
        <path d="M74 78 L86 52 L98 78 Z"/><path d="M100 82 L112 56 L124 82 Z"/>
      </g>
    </svg>`,
  },
];

let currentMap = MAPS[0];

/* ===== Settings ===== */

const KEY = 'rk_fly_settings';
const settings = {
  craft: 'plane',
  sensitivity: 5,   // 1..10
  invertY: false,
  volume: 7,        // 0..10
};
try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {} };

/* ===== Renderer, scene, camera ===== */

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 1, 0.6, 9000);

scene.add(new THREE.HemisphereLight(0xDCF0FF, 0x4C7A4A, 1.15));
const sun = new THREE.DirectionalLight(0xFFF6E0, 1.5);
sun.position.set(-380, 700, 260);
scene.add(sun);

const world = createWorld(scene);
world.setFog(scene);
const effects = createEffects(scene);

/* ===== The aircraft ===== */

let craft = null;
// Orientation is a quaternion, not yaw/pitch/roll angles. Euler angles
// cannot go over the top: past vertical the pitch term folds back and the
// aircraft flips instead of continuing round, so a loop is impossible to
// express. A quaternion turned by body relative rotations each frame has no
// such limit and no gimbal lock.
//
// roll here is cosmetic only. It leans the model into a turn but is kept out
// of the flight orientation, so where the nose points depends purely on
// where the cursor is and nothing else.
const plane = {
  pos:    new THREE.Vector3(0, 260, 0),
  orient: new THREE.Quaternion(),
  roll:   0,
  speed:  60,
  throttle: 0.6,
};

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

function fitCraft() {
  if (craft) scene.remove(craft.group);
  craft = buildCraft(settings.craft);
  scene.add(craft.group);
}
fitCraft();

/* ===== Guns ===== */

const BULLET_LIFE = 3.4;
const BULLET_GRAVITY = 24;     // what makes the stream sag at range
const TRACER_EVERY = 0.035;    // seconds between dots left behind
const bullets = [];
// Long and thin, so a round in flight reads as a streak rather than a pea.
const bulletGeo = new THREE.CapsuleGeometry(0.28, 5.6, 4, 6);
const bulletMat = new THREE.MeshBasicMaterial({ color: 0xFFE9A0 });
let fireCooldown = 0;
let gunToggle = 0;

const _bulletAxis = new THREE.Vector3(0, 1, 0);   // capsules are built along Y
const _shotDir = new THREE.Vector3();
const _muzzleAt = new THREE.Vector3();
const _ejectAt = new THREE.Vector3();
const _ejectVel = new THREE.Vector3();

const _ndc = new THREE.Vector3();
const _aim = new THREE.Vector3();

// Where the crosshair is actually pointing, in the world.
//
// Firing along the nose made the crosshair a decoration: the nose projects
// to the middle of the frame in a chase view, so rounds always went to the
// centre no matter where the cursor sat. Unprojecting the cursor gives the
// ray the player is actually aiming down.
function aimDirection(from) {
  _ndc.set(cursor.seen ? cursor.x : 0, cursor.seen ? cursor.y : 0, 0.5);
  _ndc.unproject(camera);
  _aim.copy(_ndc).sub(camera.position).normalize().multiplyScalar(1400).add(camera.position);
  return _aim.sub(from).normalize();
}

function fire() {
  const q = craft.group.quaternion;

  // Alternate between the two guns where a craft has two, which is both how
  // it is done and half the fire rate through each barrel.
  const mounts = craft.guns || [craft.muzzle];
  const mount = mounts[gunToggle % mounts.length];
  gunToggle++;

  const cs = craft.group.scale.x;
  _muzzleAt.copy(mount).multiplyScalar(cs).applyQuaternion(q).add(plane.pos);

  const m = new THREE.Mesh(bulletGeo, bulletMat);
  m.position.copy(_muzzleAt);
  scene.add(m);

  const dir = aimDirection(_muzzleAt).clone();
  bullets.push({
    mesh: m,
    vel: dir.multiplyScalar(plane.speed + 520).clone(),
    life: BULLET_LIFE,
    trail: 0.055,   // let the round clear the nose before it starts leaving dots
  });

  effects.muzzle(_muzzleAt);

  // Brass out to the right and back, carried along by the aircraft.
  _ejectAt.copy(craft.eject || craft.muzzle).multiplyScalar(cs).applyQuaternion(q).add(plane.pos);
  _ejectVel.set(rand(6, 12), rand(1, 4), rand(4, 9)).applyQuaternion(q)
           .addScaledVector(forwardVector(), plane.speed * 0.55);
  effects.casing(_ejectAt, _ejectVel.clone());

  audio.gun();
}

const _bq = new THREE.Quaternion();
const _prev = new THREE.Vector3();

// Distance from a sphere centre to the segment the round covered this frame.
//
// A point check is not enough. Rounds leave at about 590 a second, so at
// sixty frames they jump ten units a frame and at a stutter far more, while
// a building is about seven across. Testing only where the round ended up
// meant it went straight through most things without noticing.
function segmentDistance(from, to, c) {
  const abx = to.x - from.x, aby = to.y - from.y, abz = to.z - from.z;
  const apx = c.x - from.x, apy = c.y - from.y, apz = c.z - from.z;
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 > 0 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function stepBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;

    // Drop. Gravity on the round is what turns a laser into a ballistic
    // stream you have to lead and lift for at distance.
    _prev.copy(b.mesh.position);
    b.vel.y -= BULLET_GRAVITY * dt;
    b.mesh.position.addScaledVector(b.vel, dt);

    // Point the round along where it is actually going, so the sag is
    // visible in the round itself and not just in its path.
    _shotDir.copy(b.vel).normalize();
    _bq.setFromUnitVectors(_bulletAxis, _shotDir);
    b.mesh.quaternion.copy(_bq);

    b.trail -= dt;
    if (b.trail <= 0) { b.trail = TRACER_EVERY; effects.tracer(b.mesh.position); }

    let hit = false;
    for (const balloon of world.balloons) {
      if (!balloon.alive) continue;
      if (segmentDistance(_prev, b.mesh.position, balloon.mesh.position) < balloon.r + 3) {
        effects.balloonBurst(balloon.mesh.position.clone(), balloon.colour);
        world.popBalloon(balloon);
        audio.pop();
        state.popped++;
        hit = true;
        break;
      }
    }

    // Buildings and ships. Checked before the ground, so a round that would
    // hit a hillside behind a house hits the house.
    if (!hit) {
      for (const t of world.targets) {
        if (!t.alive) continue;
        if (segmentDistance(_prev, b.mesh.position, t.mesh.position) > t.r) continue;
        const result = world.damage(t, 1);
        if (result === 'destroyed') {
          const at = t.mesh.position.clone();
          const away = at.distanceTo(plane.pos);
          if (t.kind === 'ship') { effects.wreck(at); audio.shipWreck(away); }
          else { effects.rubble(at); audio.collapse(away); }
        } else if (result === 'hit') {
          effects.impact(b.mesh.position.clone());
          audio.thud();
        }
        hit = true;
        break;
      }
    }

    // Rounds that reach the ground leave a mark on it: dirt off a hillside,
    // a ring on the water.
    if (!hit) {
      const ground = Math.max(
        world.heightAt(b.mesh.position.x, b.mesh.position.z),
        world.heightAt((b.mesh.position.x + _prev.x) / 2, (b.mesh.position.z + _prev.z) / 2)
      );
      if (ground > 1.5 && Math.min(b.mesh.position.y, _prev.y) <= ground + 0.6) {
        effects.impact(b.mesh.position.clone());
        audio.dirtHit(b.mesh.position.distanceTo(plane.pos));
        hit = true;
      } else if (ground <= 1.5 && Math.min(b.mesh.position.y, _prev.y) <= 0.6) {
        effects.ripple(b.mesh.position.clone());
        audio.waterHit(b.mesh.position.distanceTo(plane.pos));
        hit = true;
      }
    }

    if (hit || b.life <= 0) {
      scene.remove(b.mesh);
      bullets.splice(i, 1);
    }
  }
}

function clearBullets() {
  for (const b of bullets) scene.remove(b.mesh);
  bullets.length = 0;
}

function rand(a, b) { return a + Math.random() * (b - a); }

/* ===== Incoming =====

   Enemy ships fire shells on a timed fuse rather than tracking rounds. A
   gun lays a shell at where the aircraft will be in the time of flight and
   sets the fuse to burst there, so the sky ahead of you fills with puffs
   whether or not any of them were ever going to connect. That is what the
   gun camera footage looks like, and it is also how it actually worked.

   The aim is deliberately imperfect and gets worse with range. Bursts that
   are all misses look right; bursts that all connect would be miserable.
   ================================================================== */

const FLAK_RANGE = 1100;      // how far out a ship will bother
const FLAK_SPEED = 620;       // fast, so a shell is on its way before you react
// Deliberately poor shots.
//
// The point of the barrage is the spectacle of it going off all around you,
// not the threat. Someone sitting with this should be able to fly through a
// wall of it and mostly just enjoy the view, so the pattern is wide, it
// stays wide even at point blank range, and the radius that actually counts
// as a hit is small.
const FLAK_SPREAD = 46;       // how wide the pattern is at maximum range
const FLAK_SPREAD_MIN = 0.6;  // and it never tightens past this fraction
const FLAK_HURT = 15;         // burst this close and you feel it
const FLAK_AHEAD = 0.45;      // extra seconds of lead, so bursts sit in front

const flak = [];
const _gunAt = new THREE.Vector3();
const _lead = new THREE.Vector3();
const _toShip = new THREE.Vector3();
const _side = new THREE.Vector3();
const _lift = new THREE.Vector3();
const _muzzleDir = new THREE.Vector3();
const _flakVel = new THREE.Vector3();
const shellGeo = new THREE.SphereGeometry(0.45, 6, 5);
const shellMat = new THREE.MeshBasicMaterial({ color: 0x6E6A62 });

function enemyGuns(dt) {
  if (state.dead) return;

  for (const t of world.targets) {
    if (!t.alive || !t.hostile) continue;

    _toShip.copy(t.mesh.position);
    const range = _toShip.distanceTo(plane.pos);
    if (range > FLAK_RANGE) continue;

    t.cool -= dt;
    if (t.cool > 0) continue;
    // Slow, so the sky fills gradually rather than all at once. Closer in
    // they work a little harder.
    t.cool = 0.85 + Math.random() * 0.9 - (1 - range / FLAK_RANGE) * 0.45;

    // One mount per salvo, so a ship walks its fire around rather than
    // spitting five shells from the same spot.
    const mount = ENEMY_GUNS[Math.floor(Math.random() * ENEMY_GUNS.length)];
    _gunAt.set(mount.x, 6.8, mount.z)
      .multiplyScalar(t.mesh.scale.x)
      .applyQuaternion(t.mesh.quaternion)
      .add(t.mesh.position);

    // Work out where the aircraft will actually be. One pass is not enough:
    // the lead point is further away than the aircraft is now, so the time of
    // flight is longer than the first guess, so solve it twice.
    // eslint-disable-next-line no-unused-vars
    const fwdNow = forwardVector();
    let flight = range / FLAK_SPEED;
    for (let k = 0; k < 2; k++) {
      _lead.copy(fwdNow).multiplyScalar(plane.speed * flight).add(plane.pos);
      flight = _lead.distanceTo(_gunAt) / FLAK_SPEED;
    }
    // Then aim a little beyond that. Gunners lay a barrage into the path
    // rather than at the aeroplane, and a pattern centred on where you are
    // now puts half of it behind you, between the camera and the aircraft,
    // where it blocks the view and looks like nothing was aimed at all.
    _lead.addScaledVector(fwdNow, plane.speed * FLAK_AHEAD);

    // Scatter along the flight path, across it and above it separately. The
    // along track error leans forward for the same reason.
    const wobble = (FLAK_SPREAD_MIN + (1 - FLAK_SPREAD_MIN) * range / FLAK_RANGE) * FLAK_SPREAD;
    _side.crossVectors(fwdNow, _worldUp).normalize();
    _lift.crossVectors(_side, fwdNow).normalize();
    _lead.addScaledVector(fwdNow, (Math.random() * 1.5 - 0.35) * wobble);
    _lead.addScaledVector(_side, (Math.random() * 2 - 1) * wobble);
    _lead.addScaledVector(_lift, (Math.random() * 2 - 1) * wobble * 0.8);

    // Flat trajectory, no drop. These are fused to burst at a set point
    // rather than to hit, so an arc buys nothing and only makes the burst
    // land somewhere other than where the gun was pointed.
    _flakVel.copy(_lead).sub(_gunAt);
    const travel = _flakVel.length();
    _flakVel.multiplyScalar(FLAK_SPEED / Math.max(1, travel));

    const m = new THREE.Mesh(shellGeo, shellMat);
    m.position.copy(_gunAt);
    scene.add(m);
    flak.push({ mesh: m, vel: _flakVel.clone(), fuse: travel / FLAK_SPEED });

    // Point the flash out along the barrel rather than straight up.
    _muzzleDir.copy(_flakVel).normalize();
    effects.flakMuzzle(_gunAt.clone(), _muzzleDir.clone());
    audio.flakFire(range);
  }
}

function stepFlak(dt) {
  for (let i = flak.length - 1; i >= 0; i--) {
    const f = flak[i];
    f.mesh.position.addScaledVector(f.vel, dt);
    f.fuse -= dt;

    const hitWater = f.mesh.position.y <= 1;
    if (f.fuse > 0 && !hitWater) continue;

    const at = f.mesh.position.clone();
    const away = at.distanceTo(plane.pos);

    effects.flak(at);
    audio.flakBurst(away);

    // Close ones rattle the aircraft. They cannot bring it down yet.
    if (away < FLAK_HURT && !state.dead) {
      const bite = 1 - away / FLAK_HURT;
      // Gentle. It should read as being rattled, not as the camera coming
      // loose: the old figure moved the view further than the aircraft is wide.
      state.shake = Math.min(0.34, state.shake + 0.07 + bite * 0.2);
      audio.shrapnelHit(bite);
      flashEl.className = 'fly-flash is-hit';
      void flashEl.offsetWidth;
      flashEl.classList.add('is-on');
    }

    scene.remove(f.mesh);
    flak.splice(i, 1);
  }
}

function clearFlak() {
  for (const f of flak) scene.remove(f.mesh);
  flak.length = 0;
}

/* ===== Cursor ===== */

// Where the cursor sits in the frame, as -1 to 1 on each axis. Nothing else
// in the game reads the pointer directly.
const cursor = { x: 0, y: 0, seen: false, down: false, sx: 0, sy: 0 };

function readCursor(e) {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return;
  cursor.sx = e.clientX - r.left;
  cursor.sy = e.clientY - r.top;
  cursor.x = (cursor.sx / r.width) * 2 - 1;
  cursor.y = -((cursor.sy / r.height) * 2 - 1);
  cursor.seen = true;
  if (reticle) reticle.style.transform = 'translate(' + cursor.sx + 'px,' + cursor.sy + 'px)';
}

/* ===== Flight ===== */

const _fwd = new THREE.Vector3();
const _spin = new THREE.Quaternion();
const _bodyUp = new THREE.Vector3();
const _wasAt = new THREE.Vector3();
const _midAt = new THREE.Vector3();
const _bodyRight = new THREE.Vector3();
const _rollQ = new THREE.Quaternion();
const _bodyQ = new THREE.Quaternion();

function forwardVector() {
  return _fwd.set(0, 0, -1).applyQuaternion(plane.orient).clone();
}

const MAX_ROLL = 1.15;      // how far it leans, cosmetic only
const PITCH_RATE = 2.35;    // radians a second at full deflection
const YAW_RATE = 1.95;
const ROLL_PER_RATE = 0.95;
const LEVEL_GAIN = 3.4;     // how hard the wings find level again

function flight(dt) {
  const h = craft.handling;
  const sens = 0.6 + settings.sensitivity * 0.16;

  // A small dead zone so resting near the centre is genuinely level, and a
  // mild curve rather than a squared one. Squaring made the middle two
  // thirds of the frame do almost nothing.
  const dead = 0.03;
  const shaped = v => {
    const sg = Math.sign(v);
    const a = Math.max(0, Math.abs(v) - dead) / (1 - dead);
    return sg * Math.pow(a, 1.2);
  };

  const cx = cursor.seen ? shaped(cursor.x) : 0;
  const cy = cursor.seen ? shaped(cursor.y) * (settings.invertY ? -1 : 1) : 0;

  // The cursor is a rate on both axes, applied about the aircraft's own axes
  // rather than the world's. Holding the cursor at the top of the frame keeps
  // pitching the nose up and it goes right over the top into a loop, which an
  // attitude limit could never do. There is no clamp anywhere here on purpose:
  // this answers the cursor before it answers physics.
  const pitchRate = cy * PITCH_RATE * h.turn * sens;
  const yawRate = -cx * YAW_RATE * h.turn * sens;

  _spin.setFromAxisAngle(AXIS_X, pitchRate * dt);
  plane.orient.multiply(_spin);
  _spin.setFromAxisAngle(AXIS_Y, yawRate * dt);
  plane.orient.multiply(_spin);

  // Pitching and yawing at the same time accumulates roll, because rotations
  // do not commute: hold a climbing turn for a few seconds and the horizon
  // ends up tilted, and centring the cursor does not undo it because nothing
  // was ever asked for. Measured at about fifty degrees of drift in a ten
  // second turn.
  //
  // So the wings look for level on their own, about the body's forward axis,
  // which cannot change where the nose points. It is switched off once past
  // the vertical, or it would fight its way out of a loop instead of going
  // over the top.
  _bodyUp.set(0, 1, 0).applyQuaternion(plane.orient);
  if (_bodyUp.y > 0.05) {
    _bodyRight.set(1, 0, 0).applyQuaternion(plane.orient);
    _spin.setFromAxisAngle(AXIS_Z, -_bodyRight.y * LEVEL_GAIN * _bodyUp.y * dt);
    plane.orient.multiply(_spin);
  }

  plane.orient.normalize();

  const wantRoll = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, yawRate * ROLL_PER_RATE));
  plane.roll += (wantRoll - plane.roll) * Math.min(1, 7 * dt);

  // Diving trades height for speed and climbing gives it back, but not
  // symmetrically. Charging the climb at the same rate as the dive rewards
  // meant a sustained climb bled speed down to a crawl, which is realistic
  // and no fun. Climbing costs about a third of what diving pays, and there
  // is a floor under it so it never feels like stalling. Read off the
  // forward vector now rather than a pitch angle, because there no longer is
  // one and because it stays correct upside down.
  const lean = -forwardVector().y;
  // Squared rather than linear, so the curve is flat near level. Straight
  // multiplication meant a nine degree nose down jumped the speed by a third
  // and you were in the sea before it felt like a dive had started. Squared,
  // that same nose down is worth about four miles an hour, while pointing it
  // properly down still builds all the way up.
  const bend = Math.sign(lean) * lean * lean;
  const swing = (h.top - h.cruise) * (lean >= 0 ? 3.4 : 0.5);
  const target = h.cruise + bend * swing;
  plane.speed += (target - plane.speed) * Math.min(1, 0.55 * dt);
  // The remaining ceiling is not about balance, it is about not covering more
  // ground between two frames than a hillside is thick.
  plane.speed = Math.max(h.cruise * 0.62, Math.min(h.top * 2.6, plane.speed));
  plane.throttle = Math.max(0, Math.min(1,
    (plane.speed - h.cruise * 0.4) / (h.top - h.cruise * 0.4)));

  const fwd = forwardVector();
  _wasAt.copy(plane.pos);
  plane.pos.addScaledVector(fwd, plane.speed * dt);

  // Diving at three hundred a second a frame covers fifteen units, which is
  // more than some hills are thick, so check the halfway point too or a steep
  // dive passes straight through a summit without touching it.
  _midAt.copy(_wasAt).add(plane.pos).multiplyScalar(0.5);
  const midGround = world.heightAt(_midAt.x, _midAt.z);
  if (midGround > 1.5 && _midAt.y <= midGround + 4.5) {
    plane.pos.copy(_midAt);
    crash('land');
    return;
  }

  // The siren winds up with how steeply and how fast you are going down.
  audio.dive(Math.max(0, lean) * Math.min(1, plane.speed / (h.top * 1.5)));

  // Ground. Land and water end the flight, and differently: one is a
  // fireball, the other is a splash.
  const ground = world.heightAt(plane.pos.x, plane.pos.z);
  if (ground > 1.5) {
    if (plane.pos.y <= ground + 4.5) { crash('land'); return; }
  } else if (plane.pos.y <= 3.5) {
    crash('water'); return;
  }

  // The ceiling just pushes back down. It does not touch the orientation:
  // nudging the nose there would fight the cursor, and fighting the cursor is
  // exactly what this control scheme must never do. Going up through it in a
  // loop is fine, you simply come back down.
  if (plane.pos.y > 1400) {
    plane.pos.y += (1400 - plane.pos.y) * Math.min(1, 2 * dt);
  }

  // The lean is applied to the model only, on top of the flight orientation.
  _rollQ.setFromAxisAngle(AXIS_Z, plane.roll);
  craft.group.quaternion.copy(plane.orient).multiply(_rollQ);
  craft.group.position.copy(plane.pos);
  craft.update(dt, { throttle: plane.throttle, speed: plane.speed });
}

/* ===== Camera ===== */

const _camWant = new THREE.Vector3();
const _look = new THREE.Vector3();
const _up = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

const _camUpQ = new THREE.Quaternion();

function chase(dt) {
  // On a crash the camera stops following the aircraft, which no longer
  // exists, and pulls back to a vantage that can actually see the wreck.
  // Left where it was it ends up inside the fireball looking at grey.
  if (state.dead && state.crashAt) {
    _camWant.copy(state.crashAt)
      .addScaledVector(state.crashDir, -62)
      .add(_worldUp.clone().multiplyScalar(26));
    camera.position.lerp(_camWant, Math.min(1, 2.6 * dt));
    camera.up.copy(_worldUp);
    camera.lookAt(state.crashAt);
    return;
  }

  // Behind and above, in the aircraft's own frame, so the view rolls a little
  // with it. Only a little: fully welded to the roll makes the horizon spin
  // and is the quickest way to make someone put it down.
  _camWant.set(0, 3.9, 13.5).applyQuaternion(plane.orient).add(plane.pos);
  camera.position.lerp(_camWant, Math.min(1, 7 * dt));

  // A near miss shakes the camera rather than the aircraft, so being rattled
  // never costs you control of where the nose is pointing.
  if (state.shake > 0.001) {
    const k = state.shake;
    camera.position.x += (Math.random() * 2 - 1) * k;
    camera.position.y += (Math.random() * 2 - 1) * k;
    camera.position.z += (Math.random() * 2 - 1) * k * 0.5;
    state.shake *= Math.max(0, 1 - 6.5 * dt);
  }

  _look.copy(forwardVector()).multiplyScalar(34).add(plane.pos);
  camera.lookAt(_look);

  // Up comes from the flight orientation, which carries pitch and heading but
  // not the cosmetic lean. That keeps the horizon steady through a turn while
  // still following the aircraft over the top of a loop, where blending
  // toward world up would flip the view inside out.
  _camUpQ.setFromAxisAngle(AXIS_Z, plane.roll * 0.32);
  _up.set(0, 1, 0).applyQuaternion(_bodyQ.copy(plane.orient).multiply(_camUpQ));
  camera.up.copy(_up).normalize();
}

/* ===== State and screens ===== */

const state = { screen: 'title', flying: false, paused: false, popped: 0,
                dead: false, deadKind: null, deadTimer: 0,
                crashAt: null, crashDir: null, shake: 0 };

const hudSpeed = document.getElementById('hud-speed');
const hudAlt   = document.getElementById('hud-alt');
const reticle  = document.getElementById('reticle');
const pauseEl  = document.getElementById('fly-pause');
const flashEl  = document.getElementById('fly-flash');

function show(name) {
  state.screen = name;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.body.classList.toggle('is-flying', name === 'fly');
  if (name === 'fly') resize();
}

function startFlight() {
  audio.resume();
  settings.craft = currentMap.craft;
  fitCraft();
  plane.pos.set(0, 260, 0);
  plane.orient.identity();
  plane.roll = 0;
  plane.speed = craft.handling.cruise;
  state.flying = true;
  state.paused = false;
  state.popped = 0;
  state.dead = false;
  state.shake = 0;
  effects.clear();
  clearBullets();
  clearFlak();
  craft.group.visible = true;
  flashEl.className = 'fly-flash';
  pauseEl.hidden = true;
  show('fly');
}

function crash(kind) {
  if (state.dead) return;
  state.dead = true;
  state.deadKind = kind;
  state.shake = 0;
  state.deadTimer = kind === 'land' ? 2.6 : 2.3;
  state.crashAt = plane.pos.clone();
  state.crashDir = forwardVector();

  craft.group.visible = false;
  clearBullets();

  if (kind === 'land') {
    effects.explosion(plane.pos.clone());
    audio.explosion(0, 1);
  } else {
    effects.splash(plane.pos.clone());
    audio.bigSplash();
  }

  // One soft tint, not a strobe.
  flashEl.className = 'fly-flash is-' + kind;
  void flashEl.offsetWidth;          // restart the animation if it is mid run
  flashEl.classList.add('is-on');
}

// Endless world, so there is no level to reload: put the aircraft back at a
// clear patch of sky and carry on.
function respawn() {
  state.dead = false;
  state.deadKind = null;
  effects.clear();
  clearBullets();
  clearFlak();
  state.shake = 0;

  const ground = world.heightAt(0, 0);
  plane.pos.set(0, Math.max(260, ground + 180), 0);
  plane.orient.identity();
  plane.roll = 0;
  plane.speed = craft.handling.cruise;

  craft.group.position.copy(plane.pos);
  craft.group.quaternion.identity();
  craft.group.visible = true;

  // Put the camera behind it rather than letting it fly in from the wreck.
  camera.position.set(0, plane.pos.y + 4, plane.pos.z + 14);

  flashEl.className = 'fly-flash';
}

function togglePause() {
  if (!state.flying) return;
  state.paused = !state.paused;
  pauseEl.hidden = !state.paused;
  // The loop stops calling flight() while paused, and the engine gain would
  // otherwise hold its last value and keep droning behind the menu.
  if (state.paused) audio.idle();
}

/* ===== Sizing ===== */

let DPR = 1;
function resize() {
  const r = wrap.getBoundingClientRect();
  // A hidden wrapper measures 0x0; keep the last good size rather than
  // rebuilding the drawing buffer at some meaningless floor.
  if (r.width < 2 || r.height < 2) return;
  DPR = Math.min(2, window.devicePixelRatio || 1);
  renderer.setPixelRatio(DPR);
  renderer.setSize(Math.round(r.width), Math.round(r.height), false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(wrap);
addEventListener('resize', resize);

/* ===== Loop ===== */

let last = performance.now();
let hudTick = 0;

function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state.screen === 'fly' && state.flying && !state.paused) {
    if (!state.dead) {
      flight(dt);

      fireCooldown -= dt;
      if (cursor.down && fireCooldown <= 0) { fire(); fireCooldown = 0.09; }

      audio.flight(plane.throttle, Math.min(1, plane.speed / craft.handling.top));

      hudTick -= dt;
      if (hudTick <= 0) {
        hudTick = 0.1;
        hudSpeed.textContent = Math.round(plane.speed * 1.6);
        hudAlt.textContent = Math.round(plane.pos.y * 3.28);
      }
    } else {
      // Let the wreck play out, then put the aircraft back.
      audio.idle();
      state.deadTimer -= dt;
      if (state.deadTimer <= 0) respawn();
    }

    // These keep running through a crash: the debris has to fall somewhere
    // and the camera has to stay pointed at it.
    world.update(plane.pos, dt);
    enemyGuns(dt);
    stepFlak(dt);
    stepBullets(dt);
    effects.update(dt);
    chase(dt);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

/* ===== Wiring ===== */

canvas.addEventListener('pointermove', readCursor, { passive: true });
canvas.addEventListener('pointerdown', e => { readCursor(e); cursor.down = true; audio.resume(); });
addEventListener('pointerup', () => { cursor.down = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'escape' && state.screen === 'fly') togglePause();
  if (k === ' ' && state.screen === 'fly') { cursor.down = true; e.preventDefault(); }
});
addEventListener('keyup', e => { if (e.key === ' ') cursor.down = false; });

// A first gesture anywhere is enough to start the audio context, so the menu
// sounds work before you have ever clicked into the game itself.
addEventListener('pointerdown', () => audio.resume(), { once: true });

// Every button in the frame, including the ones built at runtime, so the map
// and aircraft cards are covered without wiring each by hand.
frame.addEventListener('pointerover', e => {
  const b = e.target.closest('button');
  if (b && !b.disabled && frame.contains(b)) audio.uiHover();
});
frame.addEventListener('pointerdown', e => {
  const b = e.target.closest('button');
  if (b && !b.disabled) audio.uiClick();
});

document.getElementById('btn-play').addEventListener('click', () => show('maps'));
document.getElementById('btn-settings').addEventListener('click', () => show('settings'));
document.getElementById('btn-resume').addEventListener('click', togglePause);
document.getElementById('btn-quit').addEventListener('click', () => {
  state.flying = false;
  state.paused = false;
  pauseEl.hidden = true;
  audio.idle();
  show('title');
});
document.querySelectorAll('[data-goto]').forEach(b =>
  b.addEventListener('click', () => show(b.dataset.goto)));

const mapList = document.getElementById('map-list');
for (const map of MAPS) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'map-card' + (map.ready ? '' : ' is-soon');
  btn.disabled = !map.ready;
  btn.innerHTML =
    '<span class="shot">' + map.art + '</span>' +
    '<span class="txt"><b></b><span class="who"></span><small></small></span>';
  btn.querySelector('b').textContent = map.name;
  btn.querySelector('.who').textContent = map.flyer;
  btn.querySelector('small').textContent = map.blurb;
  if (!map.ready) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'Not built yet';
    btn.querySelector('.txt').appendChild(tag);
  } else {
    btn.addEventListener('click', () => { currentMap = map; startFlight(); });
  }
  li.appendChild(btn);
  mapList.appendChild(li);
}

const craftList = document.getElementById('craft-list');
Object.entries(CRAFT).forEach(([key, def]) => {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'craft-card' + (settings.craft === key ? ' is-on' : '');
  btn.dataset.craft = key;
  btn.innerHTML = '<b></b><small></small>';
  btn.querySelector('b').textContent = def.name;
  btn.querySelector('small').textContent = def.blurb;
  btn.addEventListener('click', () => {
    settings.craft = key;
    save();
    craftList.querySelectorAll('.craft-card').forEach(c =>
      c.classList.toggle('is-on', c.dataset.craft === key));
  });
  li.appendChild(btn);
  craftList.appendChild(li);
});

function bindRange(id, key, after) {
  const el = document.getElementById(id);
  el.value = settings[key];
  el.addEventListener('input', () => { settings[key] = +el.value; save(); if (after) after(); });
}
function bindCheck(id, key) {
  const el = document.getElementById(id);
  el.checked = !!settings[key];
  el.addEventListener('change', () => { settings[key] = el.checked; save(); });
}

bindRange('opt-sens', 'sensitivity');
bindRange('opt-vol', 'volume', () => audio.setVolume(settings.volume / 10));
bindCheck('opt-invert', 'invertY');

audio.setVolume(settings.volume / 10);
resize();
requestAnimationFrame(loop);

// A read only window into the running game, behind ?debug so it is not part
// of the normal page. Handy for checking that the world really is streaming
// and that nothing is growing without bound over a long flight.
if (location.search.includes('debug')) {
  // Where a world point lands on screen, as a fraction of the canvas. Lets a
  // test put the cursor exactly on something and check the shot goes there.
  window.flyProject = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { fx: (v.x + 1) / 2, fy: (1 - v.y) / 2, infront: v.z < 1 };
  };
  window.flyDebug = () => ({
    x: Math.round(plane.pos.x), y: Math.round(plane.pos.y), z: Math.round(plane.pos.z),
    yaw: +Math.atan2(-forwardVector().x, -forwardVector().z).toFixed(3),
    climb: +forwardVector().y.toFixed(3),
    upY: +(new THREE.Vector3(0,1,0).applyQuaternion(plane.orient).y).toFixed(3),
    // wings level when this is zero; upY alone cannot tell roll from pitch
    rightY: +(new THREE.Vector3(1,0,0).applyQuaternion(plane.orient).y).toFixed(3),
    roll: +plane.roll.toFixed(3), speed: Math.round(plane.speed),
    dead: state.dead, deadKind: state.deadKind,
    bullets: bullets.length,
    flakInAir: flak.length,
    enemyShips: world.targets.filter(t => t.hostile && t.alive).length,
    shake: +state.shake.toFixed(2),
    balloons: world.balloons.length,
    islands: world.islands.length,
    targets: world.targets.length,
    ships: world.targets.filter(t => t.kind === 'ship').length,
    props: world.targets.filter(t => t.kind === 'prop').length,
    bulletList: bullets.map(b => ({
      x: Math.round(b.mesh.position.x), y: Math.round(b.mesh.position.y), z: Math.round(b.mesh.position.z),
    })),
    targetList: world.targets.slice(0, 60).map(t => ({
      kind: t.kind, hp: t.hp, hostile: !!t.hostile,
      x: Math.round(t.mesh.position.x), y: Math.round(t.mesh.position.y),
      z: Math.round(t.mesh.position.z),
      d: Math.round(t.mesh.position.distanceTo(plane.pos)),
    })),
    nearestTarget: (() => {
      let best = null, bd = Infinity;
      for (const t of world.targets) {
        const d = t.mesh.position.distanceTo(plane.pos);
        if (d < bd) { bd = d; best = t; }
      }
      return best ? { kind: best.kind, hp: best.hp,
                      x: Math.round(best.mesh.position.x), y: Math.round(best.mesh.position.y),
                      z: Math.round(best.mesh.position.z), d: Math.round(bd) } : null;
    })(),
    nearestBalloon: (() => {
      let best = null, bd = Infinity;
      for (const b of world.balloons) {
        const d = b.mesh.position.distanceTo(plane.pos);
        if (d < bd) { bd = d; best = b; }
      }
      return best ? { x: Math.round(best.mesh.position.x), y: Math.round(best.mesh.position.y),
                      z: Math.round(best.mesh.position.z), d: Math.round(bd) } : null;
    })(),
    ground: Math.round(world.heightAt(plane.pos.x, plane.pos.z)),
    nearestIsland: (() => {
      let best = null, bd = Infinity;
      for (const i of world.islands) {
        const d = Math.hypot(i.x - plane.pos.x, i.z - plane.pos.z);
        if (d < bd) { bd = d; best = i; }
      }
      return best ? { x: Math.round(best.x), z: Math.round(best.z),
                      r: Math.round(best.r), h: Math.round(best.h), d: Math.round(bd) } : null;
    })(),
    sceneChildren: scene.children.length,
  });
}
