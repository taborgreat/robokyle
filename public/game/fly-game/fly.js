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
import { createWorld, ENEMY_GUNS } from './world.js?v=23';
import { buildCraft, CRAFT } from './craft.js?v=23';
import { createAudio } from './audio.js?v=23';
import { createEffects } from './effects.js?v=23';

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
    flyer: 'Fighter',
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
  drone: 8,         // engine and wind, 0..10
  music: 6,         // 0..10
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
// Burning rubble and sinking hulls are driven from the world, which already
// walks that list every frame and knows where the wrecks are.
world.attachEffects(effects);

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
// Every tenth round is a tracer, which is how belts were actually loaded:
// enough to see where the stream is going, not so many that the stream is
// all you can see.
const bulletHotMat = new THREE.MeshBasicMaterial({ color: 0xFF4A32 });
const TRACER_ROUND = 10;
let shots = 0;
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

  shots++;
  const hot = shots % TRACER_ROUND === 0;

  /* Alternate between the two guns where a craft has two, which is both
     how it is done and half the fire rate through each barrel.

     The tracer needs an extra step here. Ten is an even number and there
     are two barrels, so with the two counters running in lock step every
     tracer came out of the same gun, every time. That barrel is a fifth of
     a unit off the centreline and the tracer is the only round anyone can
     see, so the stream you could see sat visibly to one side of the stream
     you were actually firing. Standing the count on by one whenever a
     tracer goes puts the next one down the other barrel, and both streams
     average out where the guns are pointing. */
  const mounts = craft.guns || [craft.muzzle];
  const mount = mounts[gunToggle % mounts.length];
  gunToggle += hot ? 2 : 1;

  const cs = craft.group.scale.x;
  _muzzleAt.copy(mount).multiplyScalar(cs).applyQuaternion(q).add(plane.pos);

  const m = new THREE.Mesh(bulletGeo, hot ? bulletHotMat : bulletMat);
  m.position.copy(_muzzleAt);
  scene.add(m);

  const dir = aimDirection(_muzzleAt).clone();
  bullets.push({
    mesh: m,
    vel: dir.multiplyScalar(plane.speed + 520).clone(),
    life: BULLET_LIFE,
    trail: 0.055,   // let the round clear the nose before it starts leaving dots
    hot,
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
const _ric = new THREE.Vector3();

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

/* A round coming back off something hard.

   It carries on along the line it arrived on and climbs away: the
   horizontal heading is kept exactly as it was and only the vertical is
   replaced, which is what makes a ricochet read as a ricochet rather than
   as a firework. They spray forward along the line of fire, not away from
   it, and a stream of them stays a stream. The twist on top is small,
   enough to fan them a little and no more.

   One round in eight, and never twice. At a third of them a firing pass at
   a hillside threw up more rounds than it fired. */
const RICOCHET_CHANCE = 0.12;

function ricochet(b, surfaceY) {
  if (b.bounced || Math.random() > RICOCHET_CHANCE) return;

  const speed = b.vel.length();
  _ric.copy(b.vel).normalize();
  // The heading it came in on, kept. Only the vertical is thrown away and
  // replaced with climb, so what leaves is what arrived, going up.
  _ric.y = 0.34 + Math.random() * 0.24;
  _ric.x += (Math.random() - 0.5) * 0.07;
  _ric.z += (Math.random() - 0.5) * 0.07;
  // A fifth slower than it was: enough to still carry, not so much that a
  // bounce outruns the round that made it.
  _ric.normalize().multiplyScalar(speed * (0.53 + Math.random() * 0.4));

  // Yellow, like the round it was a moment ago. Painting them red made
  // every bounce look like a tracer, and there were a great many of them.
  const m = new THREE.Mesh(bulletGeo, bulletMat);
  // Clear of the surface, or the ground check catches it again on the very
  // next frame and it dies where it was born.
  m.position.set(b.mesh.position.x, surfaceY + 1.6, b.mesh.position.z);
  scene.add(m);
  bullets.push({
    // Long enough to watch one go. At under a second and a half they were
    // winking out mid air while still climbing, which reads as a bug
    // rather than as a round running out of energy.
    mesh: m, vel: _ric.clone(), life: 2.2 + Math.random() * 1.3,
    trail: 0.02, bounced: true,
  });
  audio.ricochet(m.position.distanceTo(plane.pos));
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
    if (b.trail <= 0) {
      // The same interval, the same dot, the same everything. A tracer is
      // an ordinary round in a different colour and nothing else: it
      // leaves the same barrel on the same line at the same speed, falls
      // at the same rate, and now leaves a streak of the same length in
      // the same place. Every time one of those stopped being true it
      // looked like a round coming from somewhere it was not.
      b.trail = TRACER_EVERY;
      effects.tracer(b.mesh.position, b.hot ? 0xFF6A44 : 0);
    }

    let hit = false;
    for (const balloon of world.balloons) {
      if (!balloon.alive) continue;
      if (segmentDistance(_prev, b.mesh.position, balloon.mesh.position) < balloon.r + 3) {
        effects.balloonBurst(balloon.mesh.position.clone(), balloon.colour);
        world.popBalloon(balloon);
        audio.pop();
        audio.hitMark();
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
        // Anything a round actually connects with, whether it came down or
        // not. The ground and the sea do not count: those are where the
        // rounds you missed with end up.
        audio.hitMark();
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
        ricochet(b, ground);
        hit = true;
      } else if (ground <= 1.5 && Math.min(b.mesh.position.y, _prev.y) <= 0.6) {
        effects.ripple(b.mesh.position.clone());
        audio.waterHit(b.mesh.position.distanceTo(plane.pos));
        ricochet(b, 0.6);
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
    if (t.engaging > 0) t.engaging -= dt;

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
    // Long enough to outlast the gap between salvos, so the arrow stays up
    // for as long as the ship keeps working rather than blinking with it.
    t.engaging = 3.4;
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
// What the stick is asking for, read by the model for its control surfaces.
const ctl = { pitch: 0, yaw: 0 };

const _rollQ = new THREE.Quaternion();
const _bodyQ = new THREE.Quaternion();
const _invQ  = new THREE.Quaternion();
const _aimLocal = new THREE.Vector3();

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

  // Hands off during the opening pan: it flies itself, straight and level,
  // while the camera does the work.
  const live = cursor.seen && !state.intro;
  const cx = live ? shaped(cursor.x) : 0;
  const cy = live ? shaped(cursor.y) * (settings.invertY ? -1 : 1) : 0;

  // Kept for the model, which moves its elevators, rudder and ailerons to
  // match. This is the commanded deflection, after inversion, which is what
  // the surfaces would actually be doing.
  ctl.pitch = cy;
  ctl.yaw = cx;

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

  // The rear gunner's gun follows the cursor, so the craft has to be told
  // where that is. Unprojecting belongs here, next to the camera it needs,
  // and handing the result over in the aircraft's own frame leaves the model
  // with nothing to do but turn two joints.
  _aimLocal.copy(aimDirection(plane.pos))
           .applyQuaternion(_invQ.copy(craft.group.quaternion).invert());
  craft.update(dt, {
    throttle: plane.throttle, speed: plane.speed, aim: _aimLocal,
    pitch: ctl.pitch, yaw: ctl.yaw,
  });
}

/* Air off the wingtips.

   Spawned here rather than in the model, because it belongs to the world:
   made at the tip and then left there, so the aircraft flies out of its
   own wake instead of dragging it round. The rate follows how hard the
   wing is working, so a level cruise leaves almost nothing and a hard turn
   lays two threads of it behind the tips. */
let wakeClock = 0;
const _wakeAt = new THREE.Vector3();

// Off for now. The wake is written and works, but it reads as too much at
// this size and it is a look problem rather than a code one, so it is
// parked behind a switch rather than deleted: turn this on to get it back.
const WING_WAKE = false;

function wingWake(dt) {
  if (!WING_WAKE) return;
  const wake = craft.wake;
  if (!wake || state.dead) return;
  const load = wake.load;
  if (load < 0.05) return;

  wakeClock -= dt;
  if (wakeClock > 0) return;
  wakeClock = 0.062 - load * 0.03;

  const cs = craft.group.scale.x;
  for (const tip of wake.tips) {
    _wakeAt.copy(tip).multiplyScalar(cs)
      .applyQuaternion(craft.group.quaternion).add(plane.pos);
    effects.vortex(_wakeAt, load);
  }
}

/* ===== Camera ===== */

const _camWant = new THREE.Vector3();
const _look = new THREE.Vector3();
const _up = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

const _camUpQ = new THREE.Quaternion();

/* The opening pan.

   Five seconds around the aeroplane before the player gets it: in from
   ahead and below, back along the flank past the wing, up over the
   shoulder to look down into both cockpits, and then out into the chase
   position. Positions and look targets are in the aircraft's own frame, so
   the whole thing travels with it and it can be flying properly underneath
   rather than parked.

   The last stretch blends into whatever the chase camera wants, which is
   what makes handing over control invisible: at the end of the path the
   camera is already exactly where the game was going to put it. */
const INTRO_TIME = 5;

/* Two splines rather than a list of legs.

   Straight legs with an ease on each one meant the camera arrived at every
   waypoint, stopped, and set off again: five separate moves rather than
   one. A centripetal Catmull-Rom through the same points is continuous in
   direction as well as position, so there are no corners to slow down for,
   and sampling it by arc length rather than by parameter keeps the speed
   even where the control points are bunched up.

   One ease over the whole path, not one per leg, and a fifth order one:
   smoothstep is continuous in velocity but not in acceleration, and at
   this length that shows up as a nudge at each end. */
const introPath = new THREE.CatmullRomCurve3([
  new THREE.Vector3(17.5, -2.0, -21.0),
  new THREE.Vector3(14.5, -0.6, -12.0),
  new THREE.Vector3(11.5,  0.9,  -2.0),
  new THREE.Vector3( 8.0,  2.1,   4.0),
  new THREE.Vector3( 4.2,  3.0,   8.2),
  new THREE.Vector3( 0.0,  3.4,  11.6),
], false, 'centripetal', 0.5);

const introAim = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0.9, -3.6),
  new THREE.Vector3(0, 1.0, -3.0),
  new THREE.Vector3(0, 1.1, -1.6),
  new THREE.Vector3(0, 1.2,  0.0),
  new THREE.Vector3(0, 1.0, -1.4),
  new THREE.Vector3(0, 0.8, -4.0),
], false, 'centripetal', 0.5);

const _ip = new THREE.Vector3();
const _il = new THREE.Vector3();
const smoothStep = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
// Zero velocity and zero acceleration at both ends.
const glide = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (u * (u * 6 - 15) + 10));

// How far back the camera sits, eased. Held outside the function so it
// follows speed smoothly rather than snapping on every throttle twitch.
let camPull = 11.6;
let camRise = 3.5;

function introCamera() {
  const u = glide(Math.min(1, state.introT / INTRO_TIME));

  introPath.getPointAt(u, _ip).applyQuaternion(plane.orient).add(plane.pos);
  introAim.getPointAt(u, _il).applyQuaternion(plane.orient).add(plane.pos);

  // Hand over across the last stretch, so control arrives with the view
  // already where the chase camera was going to put it and nothing jumps.
  const hand = smoothStep((u - 0.62) / 0.38);
  _ip.lerp(_camWant, hand);
  _il.lerp(_look, hand);

  camera.position.copy(_ip);
  camera.up.set(0, 1, 0).lerp(_up, hand).normalize();
  camera.lookAt(_il);
}

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

  /* Behind and above, in the aircraft's own frame, so the view rolls a
     little with it. Only a little: fully welded to the roll makes the
     horizon spin and is the quickest way to make someone put it down.

     How far behind depends on speed. Nothing about the aircraft changes,
     but pulling the camera out as it accelerates puts more of the world
     through the frame every second and takes the aeroplane off the middle
     of it, and both of those read as speed. Coming back in when it slows
     does the same in reverse. Eased hard, because the alternative is a
     camera that breathes in and out with every gust. */
  const h = craft.handling;
  const slow = h.cruise * 0.72;
  const fast = Math.max(0, Math.min(1.6, (plane.speed - slow) / (h.top - slow)));
  const ease = Math.min(1, 2.2 * dt);
  camPull += ((9.9 + fast * 4.6) - camPull) * ease;
  camRise += ((3.1 + fast * 0.9) - camRise) * ease;

  _camWant.set(0, camRise, camPull).applyQuaternion(plane.orient).add(plane.pos);
  _look.copy(forwardVector()).multiplyScalar(34).add(plane.pos);

  // Up comes from the flight orientation, which carries pitch and heading but
  // not the cosmetic lean. That keeps the horizon steady through a turn while
  // still following the aircraft over the top of a loop, where blending
  // toward world up would flip the view inside out.
  _camUpQ.setFromAxisAngle(AXIS_Z, plane.roll * 0.32);
  _up.set(0, 1, 0).applyQuaternion(_bodyQ.copy(plane.orient).multiply(_camUpQ));

  if (state.intro) { introCamera(); return; }

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

  camera.lookAt(_look);
  camera.up.copy(_up).normalize();
}

/* ===== State and screens ===== */

const state = { screen: 'title', flying: false, paused: false, popped: 0,
                dead: false, deadKind: null, deadTimer: 0,
                crashAt: null, crashDir: null, shake: 0,
                intro: false, introT: 0 };

const hudSpeed = document.getElementById('hud-speed');
const hudAlt   = document.getElementById('hud-alt');
const reticle  = document.getElementById('reticle');
const pauseEl  = document.getElementById('fly-pause');
const flashEl  = document.getElementById('fly-flash');
const pipEl    = document.getElementById('pipper');
const threatEl = document.getElementById('threat');
const introEl  = document.getElementById('intro-card');
const introName = document.getElementById('intro-name');
const introSub  = document.getElementById('intro-sub');

function show(name) {
  state.screen = name;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.body.classList.toggle('is-flying', name === 'fly');
  if (name === 'fly') resize();
  // Leaving mid pan, by any route, takes the pan with it.
  else if (state.intro) endIntro();
  // One track for the menus, another over the islands. Asking for the one
  // already playing is a no-op, so this can fire on every screen change.
  audio.music(name === 'fly' ? 'island' : 'menu');
}

/* The gun pipper.

   Where the rounds are actually going, which is not where the crosshair
   is and never can be.

   The crosshair belongs to the camera and the guns belong to the
   aeroplane, and the camera sits a dozen units behind and above them.
   Rounds are laid along the line from the muzzle to the point the cursor
   picks out at fourteen hundred, so at fourteen hundred the two lines
   meet exactly and the crosshair is honest. Nearer than that they have
   not converged yet, and the round passes to one side of whatever the
   crosshair is sitting on. At three hundred units that gap is most of a
   ship's length, which is what "the bullets never go where the crosshair
   is" actually was: not an error, but two lines that only meet at one
   range, which is the same reason real guns are harmonised to a distance
   and only truly correct there.

   So this marks the gun line instead of the sight line. It fires an
   imaginary round, asks the world what it would meet first, and draws a
   ring on that spot. Put the ring on the target rather than the
   crosshair and the rounds arrive.

   Drop is deliberately left out of it, as asked. At long range the real
   stream sags below this ring, and the ring is where the rounds would go
   if it did not, which is the number worth having: it is the aiming line
   itself, uncontaminated by how far the round has fallen by the time it
   gets there.

   With nothing at all in front of you the ring sits on the crosshair,
   because with nothing to converge on there is nothing to disagree
   about. That is the honest answer, not a failure to find one. */
const PIP_RANGE = 1400;        // the same distance aimDirection converges on
const _pipMid = new THREE.Vector3();
const _pipFrom = new THREE.Vector3();
const _pipDir = new THREE.Vector3();
const _pipAt = new THREE.Vector3();

function updatePipper() {
  if (!pipEl) return;
  if (state.dead || state.intro || !cursor.seen) {
    if (!pipEl.hidden) pipEl.hidden = true;
    return;
  }

  // The midpoint of the barrels rather than whichever fires next, or the
  // ring would flick from one to the other every round.
  const mounts = craft.guns || [craft.muzzle];
  _pipMid.set(0, 0, 0);
  for (const m of mounts) _pipMid.add(m);
  _pipMid.multiplyScalar(1 / mounts.length);

  _pipFrom.copy(_pipMid).multiplyScalar(craft.group.scale.x)
    .applyQuaternion(craft.group.quaternion).add(plane.pos);
  // The same call fire() makes, so the ring is on the line the next round
  // will genuinely leave along rather than on a second guess at it.
  _pipDir.copy(aimDirection(_pipFrom));

  const range = Math.max(20, world.rayHit(_pipFrom, _pipDir, PIP_RANGE));
  _pipAt.copy(_pipFrom).addScaledVector(_pipDir, range).project(camera);

  if (_pipAt.z > 1) { if (!pipEl.hidden) pipEl.hidden = true; return; }

  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const px = (_pipAt.x * 0.5 + 0.5) * r.width;
  const py = (1 - (_pipAt.y * 0.5 + 0.5)) * r.height;

  if (pipEl.hidden) pipEl.hidden = false;
  pipEl.style.transform = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px)';
}

/* Threat markers.

   One per hostile that is actually shooting at you: a marker on every
   warship on the horizon would be a map, not a warning, but stopping at
   one meant a second ship could be walking flak into you unannounced.

   In view, the marker hangs well above the ship and points down at it. It
   is aimed at a point fifty five units over the hull rather than at the
   hull itself, so the clearance holds at any range instead of being a
   pixel offset that swallows the ship when you get close, and it is high
   enough to leave the masthead alone. Off screen or behind, it rides an
   ellipse inset from the frame edge, turns to face outward, and grows:
   out at the edge it is in the corner of your eye rather than in front of
   it, and at the size that suits it hanging over a ship in the middle of
   the frame it was easy to miss entirely.

   The element in the markup is the template; the rest are clones of it,
   made once and then hidden and shown. */
const THREAT_MAX = 6;
const threatPool = [];
const threatLive = [];
const _threat = new THREE.Vector3();

function threatMarker(i) {
  if (!threatPool[i]) {
    const el = threatEl.cloneNode(true);
    el.removeAttribute('id');
    el.hidden = true;
    threatEl.parentElement.appendChild(el);
    threatPool[i] = el;
  }
  return threatPool[i];
}

function updateThreat() {
  threatLive.length = 0;
  if (!state.dead && !state.intro) {
    for (const t of world.targets) {
      if (!t.alive || !t.hostile || !(t.engaging > 0)) continue;
      threatLive.push(t);
    }
    // Nearest first, so when there are more of them than markers the ones
    // you can actually do something about get one.
    if (threatLive.length > 1) {
      threatLive.sort((a, b) =>
        a.mesh.position.distanceToSquared(plane.pos) -
        b.mesh.position.distanceToSquared(plane.pos));
    }
  }

  const r = wrap.getBoundingClientRect();
  const halfW = r.width / 2, halfH = r.height / 2;
  const shown = Math.min(THREAT_MAX, threatLive.length);

  for (let i = 0; i < shown; i++) {
    const t = threatLive[i];
    const el = threatMarker(i);

    // Well above the masthead, not on the hull.
    _threat.copy(t.mesh.position);
    _threat.y += 55;
    _threat.project(camera);

    // Behind the camera the projection comes back mirrored, so flip it and
    // treat it as off screen, which it is.
    const behind = _threat.z > 1;
    const nx = behind ? -_threat.x : _threat.x;
    const ny = behind ? -_threat.y : _threat.y;

    let px = nx * halfW, py = -ny * halfH;
    const inView = !behind && Math.abs(nx) < 0.94 && Math.abs(ny) < 0.94;
    let turn = 0;
    let size = 1;
    if (inView) {
      // A little clearance on top of the world space offset, so it still
      // sits clear when you are almost directly over the ship and the
      // perspective has flattened that offset to nothing.
      py -= 16;
    } else {
      const limX = Math.max(40, halfW - 48);
      const limY = Math.max(40, halfH - 48);
      const over = Math.max(Math.abs(px) / limX, Math.abs(py) / limY, 1e-4);
      px /= over; py /= over;
      // Drawn pointing down, so this is the turn that takes down to the
      // direction the ship lies in.
      turn = Math.atan2(-px, py);
      size = 1.9;
    }
    el.style.transform =
      'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px) rotate(' + turn.toFixed(3) +
      'rad) scale(' + size + ')';
    if (el.hidden) el.hidden = false;
  }

  for (let i = shown; i < threatPool.length; i++) {
    if (!threatPool[i].hidden) threatPool[i].hidden = true;
  }
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

  state.intro = true;
  state.introT = 0;
  wrap.classList.add('is-intro');
  introName.textContent = currentMap.name;
  introSub.textContent = currentMap.flyer;
  introEl.classList.remove('is-out');
  introEl.hidden = false;
  pipEl.hidden = true;
  for (const el of threatPool) el.hidden = true;

  show('fly');
}

// Click or key out of the pan. It does not cut: it jumps to the last part
// of the path, which is the part that eases into the chase position, so
// skipping still hands over cleanly rather than snapping.
function skipIntro() {
  if (!state.intro) return;
  state.introT = Math.max(state.introT, INTRO_TIME - 0.7);
}

function endIntro() {
  state.intro = false;
  wrap.classList.remove('is-intro');
  introEl.hidden = true;
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
  if (!state.flying || state.intro) return;
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
      if (state.intro) {
        state.introT += dt;
        if (state.introT >= INTRO_TIME - 1.1) introEl.classList.add('is-out');
        if (state.introT >= INTRO_TIME) endIntro();
      }

      flight(dt);

      fireCooldown -= dt;
      if (!state.intro && cursor.down && fireCooldown <= 0) { fire(); fireCooldown = 0.09; }

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
    wingWake(dt);
    enemyGuns(dt);
    stepFlak(dt);
    stepBullets(dt);
    effects.update(dt);
    chase(dt);
    // Both of these project into the frame, so they run after the camera
    // has been put where it belongs for this frame rather than before.
    updatePipper();
    updateThreat();
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

/* ===== Wiring ===== */

canvas.addEventListener('pointermove', readCursor, { passive: true });
canvas.addEventListener('pointerdown', e => { readCursor(e); cursor.down = true; audio.resume(); skipIntro(); });
addEventListener('pointerup', () => { cursor.down = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (state.intro && (k === 'escape' || k === ' ' || k === 'enter')) { skipIntro(); e.preventDefault(); return; }
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

/* A setting can have more than one control now: one on the settings screen
   and one in the pause menu, so sensitivity can be tuned against the
   aircraft it applies to instead of from the title screen and a guess.
   They are bound to the same value rather than duplicated, so moving
   either moves both and there is never a stale slider to find later. */
function bindRange(ids, key, after) {
  const els = ids.map(id => document.getElementById(id)).filter(Boolean);
  const sync = () => { for (const el of els) el.value = settings[key]; };
  sync();
  for (const el of els) {
    el.addEventListener('input', () => {
      settings[key] = +el.value; save(); sync(); if (after) after();
    });
  }
}
function bindCheck(ids, key) {
  const els = ids.map(id => document.getElementById(id)).filter(Boolean);
  const sync = () => { for (const el of els) el.checked = !!settings[key]; };
  sync();
  for (const el of els) {
    el.addEventListener('change', () => { settings[key] = el.checked; save(); sync(); });
  }
}

function applyVolumes() {
  audio.setVolume(settings.volume / 10);
  audio.setDrone(settings.drone / 10);
  // Music sits under everything else on purpose: it is there to be flown
  // to, not listened to, and at parity it walks all over the engine.
  audio.setMusicVolume((settings.music / 10) * 0.7);
}

bindRange(['opt-sens', 'p-sens'], 'sensitivity');
bindRange(['opt-vol', 'p-vol'], 'volume', applyVolumes);
bindRange(['opt-drone', 'p-drone'], 'drone', applyVolumes);
bindRange(['opt-music', 'p-music'], 'music', applyVolumes);
bindCheck(['opt-invert', 'p-invert'], 'invertY');

applyVolumes();
// Queued rather than played: there is no audio context until a gesture, and
// the request is held until there is one.
audio.music('menu');
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
  // Sinks the nearest ship outright, so the wreck can be watched without
  // having to fly a firing pass at it first.
  window.flyWreckNearestShip = () => {
    let best = null, bd = Infinity;
    for (const t of world.targets) {
      if (!t.alive || t.kind !== 'ship') continue;
      const d = t.mesh.position.distanceTo(plane.pos);
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) return null;
    for (let i = 0; i < 100 && best.alive; i++) world.damage(best, 1);
    const at = best.mesh.position.clone();
    effects.wreck(at);
    audio.shipWreck(at.distanceTo(plane.pos));
    return { d: Math.round(bd), x: Math.round(at.x), y: Math.round(at.y), z: Math.round(at.z) };
  };

  window.flyParticles = () => effects.count();

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
