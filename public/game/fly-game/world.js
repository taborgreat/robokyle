/* ==================================================================
   Fly Game, the world.

   Endless in every direction, not just forward, because you steer
   freely and can turn round and go back. So the world is a grid of
   square chunks streamed in and out around wherever you are, and a
   chunk's contents come from a hash of its coordinates rather than
   from a list. Fly east for ten minutes, turn round, and the islands
   you passed are still exactly where they were, without anything
   having been stored.

   Each chunk merges its scenery into a single mesh with vertex
   colours. Forty nine live chunks of loose cones and cylinders would
   be thousands of draw calls; merged, it is two per chunk.
   ================================================================== */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CHUNK = 600;
const RADIUS = 3;                       // chunks each way, so 7x7 live
export const VIEW = CHUNK * (RADIUS - 0.15);

const SEA_LEVEL = 0;

const C = {
  grass:  0x74C365,
  grass2: 0x5FAE52,
  sand:   0xEFDFA8,
  rock:   0x9C9384,
  trunk:  0x7A5230,
  leaf:   0x4E9E45,
  leaf2:  0x63B356,
  sea:    0x2E86C8,
  sky:    0x7FC7EE,
  // The horizon colour. The fog, the scene background and the bottom of the
  // sky gradient are all exactly this, which is what removes the seam where
  // fogged water used to meet the sky. Deeper and bluer than it was: at
  // near white the fog glared and swallowed the islands early.
  haze:   0xA8CCE4,
};

const BALLOON_COLOURS = [0xE2402F, 0xE8B444, 0x5FBF87, 0xE06FA8, 0x6FA8E0];

// Built things read small from the air, so they are scaled up as a group.
// The hit sphere is scaled with them, or shots that visibly strike a roof
// would pass through it.
const BUILT_SCALE = 1.15;

// Where an enemy ship's flak mounts sit, in its own space. The model and the
// firing code both read this, so a shell always leaves a barrel you can see.
export const ENEMY_GUNS = [
  { x: 7.6, z: -2.4 }, { x: 7.6, z: 2.4 },
  { x: -6.0, z: -2.4 }, { x: -6.0, z: 2.4 },
  { x: 1.0, z: 0 },
];

// Roughly one ship in ten is hostile.
const ENEMY_SHARE = 0.1;

// Where the hillside actually is, at a horizontal distance d from the middle
// of an island of radius r and height h.
//
// The hill is a cone scaled by (r, h, r) and sat at y = h/2 - 2, so its base
// is at -2 and its tip at h - 2, and the surface at distance d is
// h * (1 - d / r) - 2. Placement used to multiply by 0.82 instead of
// subtracting the 2, which on a hundred unit hill buried a house sixteen
// units into the slope.
//
// The cone is nine sided, so between vertices the real surface sits lower
// than the ideal cone by cos(pi/9). Working in that inscribed radius means a
// building is always on or a little into the ground and never floating over
// a notch, which is the failure that looks worse.
const CONE_FACES = 9;
const CONE_SEG = (Math.PI * 2) / CONE_FACES;
const CONE_APOTHEM = Math.cos(Math.PI / CONE_FACES);

// worldAngle is the bearing of the point from the middle of the island, in
// the same convention the placement code uses (x = cos, z = sin). hillRot is
// the random spin given to that island's cone.
function islandSurface(h, r, d, worldAngle, hillRot) {
  // three.js builds a cone with x = sin(theta), z = cos(theta), so a bearing
  // measured as atan2(x, z) is pi/2 minus the placement angle, and the mesh
  // rotation adds straight onto it.
  const theta = (Math.PI / 2 - worldAngle) - hillRot;
  let t = theta % CONE_SEG;
  if (t < 0) t += CONE_SEG;
  // Angle away from the middle of the facet we are standing on.
  const psi = t - CONE_SEG / 2;
  // A regular polygon's edge sits at apothem / cos(psi) from the middle, so
  // the radius parameter that puts the surface exactly under us is
  // d * cos(psi) / apothem.
  return h * (1 - (d * Math.cos(psi)) / (r * CONE_APOTHEM)) - 2;
}

/* ===== deterministic noise ===== */

// Same chunk coordinates always produce the same stream of numbers.
//
// Mixed sequentially, FNV style, rather than by XORing two products
// together. The previous version did the latter and collided on about one
// chunk in six across a modest span, and two chunks sharing a seed are not
// merely similar, they are the same island in the same place with the same
// trees. Sequential mixing also makes order matter, so (3, -11) and
// (-11, 3) are different places.
function seedFor(cx, cz) {
  let h = 2166136261;
  h = Math.imul(h ^ (cx & 0xffff), 16777619);
  h = Math.imul(h ^ ((cx >>> 16) & 0xffff), 16777619);
  h = Math.imul(h ^ (cz & 0xffff), 16777619);
  h = Math.imul(h ^ ((cz >>> 16) & 0xffff), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}
function rngFrom(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ===== shared geometry, cloned per placement ===== */

const GEO = {
  hill:   new THREE.ConeGeometry(1, 1, 9),
  beach:  new THREE.CylinderGeometry(1, 1, 1, 12),
  rock:   new THREE.DodecahedronGeometry(1, 0),
  trunk:  new THREE.CylinderGeometry(0.12, 0.16, 1, 6),
  leaf:   new THREE.ConeGeometry(1, 1, 7),
  puff:   new THREE.SphereGeometry(1, 8, 6),
  balloon: new THREE.SphereGeometry(1, 12, 10),
  box:    new THREE.BoxGeometry(1, 1, 1),
  roof:   new THREE.ConeGeometry(1, 1, 4),
  cyl:    new THREE.CylinderGeometry(1, 1, 1, 9),
  taper:  new THREE.CylinderGeometry(0.72, 1, 1, 10),
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

// Clone a shared geometry, place it, and paint every vertex one colour so a
// whole chunk can collapse into one mesh with one material.
function piece(geo, color, x, y, z, sx, sy, sz, rotY, rotX, rotZ) {
  // XYZ order, so Z is applied first, then Y. A palm frond droops about Z
  // and is then swung around the trunk about Y, which is exactly that order.
  _e.set(rotX || 0, rotY || 0, rotZ || 0);
  _q.setFromEuler(_e);
  _v.set(x, y, z);
  _s.set(sx, sy, sz);
  _m.compose(_v, _q, _s);

  const g = geo.clone().toNonIndexed().applyMatrix4(_m);
  const n = g.attributes.position.count;
  const col = new THREE.Color(color);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

/* ===== things you can knock down =====

   These cannot go into the merged chunk mesh: the whole point of merging is
   that a chunk is one object, and one object cannot lose a house. So each
   one is its own mesh, merged internally so it is still a single draw call,
   and they all share the vertex coloured material. */

function houseGeo(rnd) {
  const wall = rnd() < 0.5 ? 0xF2E7D2 : 0xE6D6B8;
  const roof = [0xC1462F, 0x40708C, 0x7A4A3A][Math.floor(rnd() * 3)];
  const parts = [
    piece(GEO.box,  wall,     0, 2.6, 0, 6.4, 5.2, 5.4, 0),
    piece(GEO.roof, roof,     0, 6.8, 0, 5.8, 3.8, 5.8, Math.PI / 4),
    // eaves, so the roof overhangs instead of sitting flush on the walls
    piece(GEO.box,  0xD9CDB4, 0, 5.1, 0, 7.4, 0.35, 6.4, 0),
    // door, with a step and a lintel
    piece(GEO.box,  0x6B4A2F, 0, 1.5, 2.8, 1.6, 3.0, 0.35, 0),
    piece(GEO.box,  0xD9CDB4, 0, 3.1, 2.9, 2.0, 0.3, 0.25, 0),
    piece(GEO.box,  0xB9AE96, 0, 0.15, 3.2, 2.2, 0.3, 1.0, 0),
    // framed windows on three sides
    piece(GEO.box,  0xD9CDB4, -2.1, 3.3, 2.8, 1.7, 1.7, 0.2, 0),
    piece(GEO.box,  0x8FB8D8, -2.1, 3.3, 2.9, 1.25, 1.25, 0.2, 0),
    piece(GEO.box,  0xD9CDB4, 2.1, 3.3, 2.8, 1.7, 1.7, 0.2, 0),
    piece(GEO.box,  0x8FB8D8, 2.1, 3.3, 2.9, 1.25, 1.25, 0.2, 0),
    piece(GEO.box,  0xD9CDB4, 3.25, 3.2, 0, 0.2, 1.6, 1.6, 0),
    piece(GEO.box,  0x8FB8D8, 3.32, 3.2, 0, 0.2, 1.15, 1.15, 0),
    // chimney with a cap
    piece(GEO.box,  0x9C9384, 1.9, 8.2, -1.0, 1.0, 2.8, 1.0, 0),
    piece(GEO.box,  0x7E7568, 1.9, 9.7, -1.0, 1.4, 0.3, 1.4, 0),
  ];
  for (let i = -2; i <= 2; i++) {
    parts.push(piece(GEO.box, 0xC6B79A, i * 1.5, 0.75, 4.6, 0.22, 1.5, 0.22, 0));
  }
  parts.push(piece(GEO.box, 0xC6B79A, 0, 1.15, 4.6, 6.6, 0.18, 0.16, 0));
  return { geo: mergeGeometries(parts), r: 5.4, hp: 1 };
}

function hutGeo(rnd) {
  const parts = [
    piece(GEO.cyl,  0xD8C39A, 0, 1.7, 0, 2.7, 3.4, 2.7, 0),
    piece(GEO.leaf, 0x8A6236, 0, 5.0, 0, 3.7, 3.6, 3.7, rnd() * 6.28),
    piece(GEO.cyl,  0xB8A47E, 0, 3.5, 0, 2.85, 0.3, 2.85, 0),
    piece(GEO.box,  0x6B4A2F, 0, 1.1, 2.6, 1.2, 2.2, 0.3, 0),
  ];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    parts.push(piece(GEO.cyl, 0x7A5230, Math.cos(a) * 2.1, 0.4, Math.sin(a) * 2.1, 0.24, 0.9, 0.24, 0));
  }
  parts.push(piece(GEO.cyl, 0xA9714B, 2.2, 0.5, 1.6, 0.5, 1.0, 0.5, 0));
  return { geo: mergeGeometries(parts), r: 3.7, hp: 1 };
}

function windmillGeo(rnd) {
  const parts = [
    piece(GEO.taper, 0xEFE6D2, 0, 4.6, 0, 2.4, 9.2, 2.4, 0),
    piece(GEO.box,   0xC9BDA2, 0, 3.0, 0, 2.55, 0.4, 2.55, 0),
    piece(GEO.roof,  0xC1462F, 0, 10.0, 0, 3.0, 2.0, 3.0, Math.PI / 4),
    piece(GEO.box,   0x6B4A2F, 0, 8.9, 2.5, 0.7, 0.7, 1.3, 0),
    piece(GEO.box,   0x6B4A2F, 0, 2.0, 2.2, 1.3, 2.6, 0.3, 0),
  ];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + 0.35;
    const cx = Math.cos(a) * 3.6, cy = 8.9 + Math.sin(a) * 3.6;
    parts.push(piece(GEO.box, 0x6B4A2F, cx, cy, 3.05,
      Math.abs(Math.cos(a)) * 7 + 0.4, Math.abs(Math.sin(a)) * 7 + 0.4, 0.28, 0));
    parts.push(piece(GEO.box, 0xE8DCC0, cx * 1.25, 8.9 + (cy - 8.9) * 1.25, 3.2,
      Math.abs(Math.cos(a)) * 3.4 + 0.9, Math.abs(Math.sin(a)) * 3.4 + 0.9, 0.16, 0));
  }
  return { geo: mergeGeometries(parts), r: 4.8, hp: 1 };
}

function lighthouseGeo() {
  const parts = [
    piece(GEO.cyl,   0xBDB4A2, 0, 0.6, 0, 3.4, 1.2, 3.4, 0),
    piece(GEO.taper, 0xF6F1E6, 0, 6.8, 0, 2.5, 13, 2.5, 0),
    piece(GEO.cyl,   0xC1462F, 0, 3.6, 0, 2.42, 2.2, 2.42, 0),
    piece(GEO.cyl,   0xC1462F, 0, 8.8, 0, 2.02, 2.2, 2.02, 0),
    piece(GEO.cyl,   0x37414A, 0, 13.6, 0, 2.4, 0.7, 2.4, 0),
    piece(GEO.cyl,   0xFFE9A0, 0, 14.7, 0, 1.5, 2.1, 1.5, 0),
    piece(GEO.cyl,   0x37414A, 0, 15.9, 0, 2.2, 0.4, 2.2, 0),
    piece(GEO.roof,  0x37414A, 0, 16.8, 0, 2.2, 1.6, 2.2, 0),
    piece(GEO.box,   0x6B4A2F, 0, 1.9, 2.3, 1.2, 2.6, 0.3, 0),
  ];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.push(piece(GEO.box, 0x37414A, Math.cos(a) * 2.3, 14.4, Math.sin(a) * 2.3, 0.16, 1.5, 0.16, 0));
  }
  return { geo: mergeGeometries(parts), r: 3.6, hp: 1 };
}

function churchGeo() {
  const parts = [
    piece(GEO.box,  0xF2EDE0, 0, 3.0, 0, 6.0, 6.0, 10.0, 0),
    piece(GEO.roof, 0x8A5A3A, 0, 7.6, 0, 5.6, 3.2, 8.4, Math.PI / 4),
    piece(GEO.box,  0xF2EDE0, 0, 5.0, -6.0, 4.2, 10.0, 4.2, 0),
    piece(GEO.roof, 0x8A5A3A, 0, 12.4, -6.0, 3.4, 4.6, 3.4, Math.PI / 4),
    piece(GEO.box,  0xE8B444, 0, 15.6, -6.0, 0.3, 2.2, 0.3, 0),
    piece(GEO.box,  0xE8B444, 0, 15.4, -6.0, 1.3, 0.3, 0.3, 0),
    piece(GEO.box,  0x6B4A2F, 0, 1.9, -8.15, 1.8, 3.6, 0.3, 0),
    piece(GEO.box,  0x8FB8D8, 3.05, 3.6, 2.0, 0.3, 2.4, 1.2, 0),
    piece(GEO.box,  0x8FB8D8, 3.05, 3.6, -1.0, 0.3, 2.4, 1.2, 0),
    piece(GEO.box,  0x8FB8D8, -3.05, 3.6, 2.0, 0.3, 2.4, 1.2, 0),
    piece(GEO.box,  0x8FB8D8, -3.05, 3.6, -1.0, 0.3, 2.4, 1.2, 0),
  ];
  return { geo: mergeGeometries(parts), r: 6.4, hp: 1 };
}

function barnGeo(rnd) {
  const red = rnd() < 0.5 ? 0xA63A2A : 0x8C4030;
  const parts = [
    piece(GEO.box,  red,      0, 3.0, 0, 8.0, 6.0, 11.0, 0),
    piece(GEO.roof, 0x5C5148, 0, 7.6, 0, 7.4, 3.4, 9.4, Math.PI / 4),
    piece(GEO.box,  0xEFE6D2, 0, 6.4, 5.55, 3.0, 2.0, 0.2, 0),
    piece(GEO.box,  0xD9CDB4, 0, 2.4, 5.55, 4.6, 4.8, 0.25, 0),
    piece(GEO.box,  red,      0, 2.4, 5.7, 0.4, 4.8, 0.2, 0),
    piece(GEO.box,  0xEFE6D2, -4.05, 3.4, 2.4, 0.25, 1.8, 1.8, 0),
    piece(GEO.box,  0xEFE6D2, 4.05, 3.4, 2.4, 0.25, 1.8, 1.8, 0),
  ];
  return { geo: mergeGeometries(parts), r: 6.2, hp: 1 };
}

function waterTowerGeo() {
  const parts = [
    piece(GEO.taper, 0x9FB0BC, 0, 9.4, 0, 3.2, 5.4, 3.2, 0),
    piece(GEO.roof,  0x5C5148, 0, 13.0, 0, 3.4, 2.4, 3.4, 0),
    piece(GEO.cyl,   0x7E8B96, 0, 6.6, 0, 3.3, 0.5, 3.3, 0),
  ];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const lx = Math.cos(a) * 2.4, lz = Math.sin(a) * 2.4;
    parts.push(piece(GEO.box, 0x6B4A2F, lx, 3.3, lz, 0.45, 6.8, 0.45, 0));
    parts.push(piece(GEO.box, 0x6B4A2F, lx * 0.7, 3.4, lz * 0.7, 2.6, 0.28, 2.6, a));
  }
  return { geo: mergeGeometries(parts), r: 4.0, hp: 1 };
}

// Everything afloat runs bow first along +X.
//
// A bow is a four sided cone turned a quarter about Z so it points along the
// hull, and again about its own axis so it sits flat side down. Left
// pointing straight up, as it first was, it reads as a tent on the foredeck.
function sailShipGeo(rnd) {
  const wood = rnd() < 0.5 ? 0x5A3A22 : 0x6B4A2F;
  const trim = 0x8A6236;
  const dark = 0x33251A;
  const sail = rnd() < 0.35 ? 0xE7DFCE : 0xF4EFE2;

  const parts = [
    piece(GEO.box, dark, -0.5, 1.0, 0, 15.5, 2.2, 5.2, 0),
    piece(GEO.box, wood, -0.5, 3.0, 0, 15.5, 2.6, 5.6, 0),
    piece(GEO.box, trim, -0.5, 4.15, 0, 15.6, 0.5, 5.8, 0),

    piece(GEO.roof, wood, 8.9, 2.2, 0, 2.9, 5.0, 2.9, 0, Math.PI / 4, -Math.PI / 2),
    piece(GEO.box,  trim, 7.6, 4.3, 0, 3.4, 0.5, 3.6, 0),

    piece(GEO.box, wood, -6.2, 5.4, 0, 4.6, 3.0, 5.2, 0),
    piece(GEO.box, wood, -7.4, 7.4, 0, 3.0, 1.6, 4.6, 0),
    piece(GEO.box, trim, -6.2, 7.0, 0, 4.8, 0.4, 5.4, 0),
    piece(GEO.box, 0xE8B444, -8.35, 6.0, 0, 0.3, 1.2, 2.4, 0),

    piece(GEO.box, 0x7C5735, 0.5, 4.4, 0, 13.5, 0.35, 4.6, 0),

    piece(GEO.cyl, trim, 11.2, 4.4, 0, 0.34, 5.6, 0.34, 0, 0, -Math.PI / 2.6),
  ];

  for (const sz of [-2.9, 2.9]) {
    parts.push(piece(GEO.box, wood, -0.5, 5.0, sz, 15.2, 1.2, 0.35, 0));
    for (let i = -3; i <= 3; i++) {
      parts.push(piece(GEO.box, dark, i * 2.0 - 0.5, 3.0, sz + (sz > 0 ? 0.12 : -0.12), 1.1, 1.1, 0.2, 0));
    }
  }

  const masts = [{ x: 2.6, h: 16, s: 7.6 }, { x: -3.6, h: 13, s: 6.0 }];
  for (const m of masts) {
    parts.push(piece(GEO.cyl, trim, m.x, 4.4 + m.h / 2, 0, 0.5, m.h, 0.5, 0));
    parts.push(piece(GEO.box, 0x4A3520, m.x, 4.4 + m.h * 0.78, 0, 0.5, 0.4, m.s + 1.6, 0));
    parts.push(piece(GEO.box, sail, m.x, 4.4 + m.h * 0.55, 0, 0.35, m.h * 0.42, m.s, 0));
    parts.push(piece(GEO.box, 0x4A3520, m.x, 4.4 + m.h * 0.34, 0, 0.45, 0.35, m.s * 0.8, 0));
    parts.push(piece(GEO.box, sail, m.x, 4.4 + m.h * 0.2, 0, 0.3, m.h * 0.2, m.s * 0.72, 0));
  }
  parts.push(piece(GEO.cyl, 0x4A3520, masts[0].x, 4.4 + masts[0].h * 0.9, 0, 1.1, 1.0, 1.1, 0));
  parts.push(piece(GEO.box, 0x1A1A1F, masts[0].x + 1.6, 4.4 + masts[0].h - 0.6, 0, 3.0, 1.8, 0.2, 0));
  parts.push(piece(GEO.box, 0xF4EFE2, masts[0].x + 1.4, 4.4 + masts[0].h - 0.6, 0, 0.7, 0.7, 0.28, 0));

  return { geo: mergeGeometries(parts), r: 10, hp: 6 };
}

// A working steamer. No guns, nothing to fear, just something on the water.
function cargoShipGeo(rnd) {
  const hull = [0x3E4A57, 0x4A3A32, 0x2F4A44][Math.floor(rnd() * 3)];
  const deck = 0x8A8577;
  const parts = [
    piece(GEO.box, 0x22262B, -0.5, 1.0, 0, 20, 2.4, 6.0, 0),
    piece(GEO.box, hull,     -0.5, 3.2, 0, 20, 2.2, 6.4, 0),
    piece(GEO.box, 0xC9C2B0, -0.5, 4.4, 0, 20.2, 0.4, 6.6, 0),
    piece(GEO.roof, hull, 10.6, 2.3, 0, 3.2, 4.6, 3.2, 0, Math.PI / 4, -Math.PI / 2),
    // deckhouse aft, with a funnel
    piece(GEO.box, 0xE4DED0, -6.4, 6.2, 0, 5.4, 3.6, 5.4, 0),
    piece(GEO.box, 0xC9C2B0, -6.4, 8.2, 0, 5.8, 0.5, 5.8, 0),
    piece(GEO.box, 0x2B3138, -6.4, 6.6, 2.75, 4.2, 1.2, 0.3, 0),
    piece(GEO.box, 0x2B3138, -6.4, 6.6, -2.75, 4.2, 1.2, 0.3, 0),
    piece(GEO.cyl, 0xB8452F, -8.8, 10.4, 0, 1.5, 4.6, 1.5, 0),
    piece(GEO.cyl, 0x22262B, -8.8, 12.8, 0, 1.6, 0.6, 1.6, 0),
    piece(GEO.cyl, 0xC9C2B0, -2.2, 8.0, 0, 0.25, 7.0, 0.25, 0),
  ];
  // containers stacked on the foredeck
  const crates = [0xC1462F, 0x2F6E8C, 0xE8B444, 0x5A8A4A];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 2; j++) {
      const h = rnd() < 0.35 ? 2 : 1;
      for (let k = 0; k < h; k++) {
        parts.push(piece(GEO.box, crates[Math.floor(rnd() * crates.length)],
          1.2 + i * 2.6, 5.4 + k * 2.0, -1.5 + j * 3.0, 2.3, 1.9, 2.7, 0));
      }
    }
  }
  parts.push(piece(GEO.box, deck, 0.5, 4.7, 0, 18, 0.3, 5.2, 0));
  return { geo: mergeGeometries(parts), r: 12, hp: 7 };
}

// Turrets and a mast, in a friendly grey. Tough, but it never shoots back.
function battleshipGeo(rnd) {
  const hull = 0x5A6672;
  const deck = 0x76818B;
  const dark = 0x2B3138;
  const parts = [
    piece(GEO.box, dark, -0.5, 1.0, 0, 26, 2.4, 6.6, 0),
    piece(GEO.box, hull, -0.5, 3.2, 0, 26, 2.2, 7.0, 0),
    piece(GEO.box, deck, -0.5, 4.4, 0, 26.2, 0.4, 7.2, 0),
    piece(GEO.roof, hull, 13.8, 2.3, 0, 3.5, 5.4, 3.5, 0, Math.PI / 4, -Math.PI / 2),
    // superstructure and mast
    piece(GEO.box, deck, -2.0, 6.6, 0, 6.0, 4.0, 5.4, 0),
    piece(GEO.box, deck, -2.0, 9.4, 0, 4.0, 2.0, 4.0, 0),
    piece(GEO.cyl, dark, -2.0, 13.6, 0, 0.35, 7.0, 0.35, 0),
    piece(GEO.box, dark, -2.0, 15.4, 0, 0.3, 0.3, 3.0, 0),
    piece(GEO.cyl, 0x8A8F94, -6.6, 8.4, 0, 1.4, 4.0, 1.4, 0),
  ];
  // main turrets fore and aft
  for (const tx of [6.4, -8.6]) {
    parts.push(piece(GEO.cyl, deck, tx, 5.4, 0, 2.6, 1.8, 2.6, 0));
    parts.push(piece(GEO.box, deck, tx, 6.4, 0, 4.0, 2.0, 3.4, 0));
    for (const bz of [-0.8, 0.8]) {
      parts.push(piece(GEO.cyl, dark, tx + 3.4, 6.6, bz, 0.3, 5.0, 0.3, 0, 0, -Math.PI / 2));
    }
  }
  return { geo: mergeGeometries(parts), r: 14, hp: 10 };
}

// The one that shoots back. Same hull, darker paint, red markings, and a
// row of flak mounts that are actually where the shells come from.
function enemyShipGeo(rnd) {
  const hull = 0x3A3F46;
  const deck = 0x4C525A;
  const dark = 0x1E2227;
  const mark = 0xB8332A;
  const parts = [
    piece(GEO.box, dark, -0.5, 1.0, 0, 26, 2.4, 6.6, 0),
    piece(GEO.box, hull, -0.5, 3.2, 0, 26, 2.2, 7.0, 0),
    piece(GEO.box, mark, -0.5, 4.35, 0, 26.2, 0.5, 7.2, 0),
    piece(GEO.roof, hull, 13.8, 2.3, 0, 3.5, 5.4, 3.5, 0, Math.PI / 4, -Math.PI / 2),
    piece(GEO.box, deck, -2.0, 6.8, 0, 6.4, 4.4, 5.6, 0),
    piece(GEO.box, deck, -2.0, 9.8, 0, 4.2, 2.2, 4.2, 0),
    piece(GEO.box, mark, -2.0, 11.2, 0, 3.0, 0.6, 3.0, 0),
    piece(GEO.cyl, dark, -2.0, 14.4, 0, 0.35, 7.5, 0.35, 0),
    piece(GEO.cyl, 0x6A7078, -6.8, 8.6, 0, 1.5, 4.2, 1.5, 0),
    piece(GEO.box, mark, -6.8, 11.0, 0, 3.2, 0.9, 3.2, 0),
  ];
  // flak mounts: a tub, a base and a pair of barrels angled up
  for (const g of ENEMY_GUNS) {
    parts.push(piece(GEO.cyl, dark, g.x, 5.0, g.z, 1.7, 1.4, 1.7, 0));
    parts.push(piece(GEO.cyl, deck, g.x, 5.9, g.z, 1.1, 1.2, 1.1, 0));
    for (const off of [-0.35, 0.35]) {
      parts.push(piece(GEO.cyl, dark, g.x + 0.7, 7.0, g.z + off, 0.22, 3.4, 0.22, 0, 0, -0.9));
    }
  }
  return { geo: mergeGeometries(parts), r: 14, hp: 12 };
}

const PROPS = [houseGeo, houseGeo, houseGeo, hutGeo, hutGeo,
               windmillGeo, lighthouseGeo, churchGeo, barnGeo, waterTowerGeo];

export function createWorld(scene) {
  const landMat  = new THREE.MeshLambertMaterial({ vertexColors: true });
  // Lambert alone leaves the underside of a cloud picking up the green
  // bounce off the hemisphere light and reading as grey. A strong pale
  // emissive floors the shaded side at something still cloud coloured.
  const cloudMat = new THREE.MeshLambertMaterial({
    color: 0xFFFFFF, emissive: 0xBBD6EA, emissiveIntensity: 0.8,
    transparent: true, opacity: 0.97,
  });

  const chunks = new Map();        // "cx,cz" -> { land, cloud, islands, balloons }
  const balloons = [];             // live, shootable
  const islands  = [];             // live, for the ground check
  const targets  = [];             // live, shootable and destructible

  /* ===== sky ===== */

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(6000, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top:    { value: new THREE.Color(0x2F86CE) },
        bottom: { value: new THREE.Color(C.haze) },
      },
      vertexShader: `
        varying float vH;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vH = normalize(wp.xyz - cameraPosition).y;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom; varying float vH;
        void main() {
          // Exactly the fog colour at and below the horizon, then a smooth
          // ramp upward. The old version mixed 18 per cent toward the top
          // colour at vH = 0, so the sky never quite matched the fogged sea
          // and the join read as a hard flat line right across the view.
          float t = smoothstep(0.0, 0.46, vH);
          gl_FragColor = vec4(mix(bottom, top, t), 1.0);
        }`,
    })
  );
  sky.frustumCulled = false;
  scene.add(sky);

  /* ===== sea ===== */

  // Flat colour gave no sense of height at all: at any altitude the water
  // was the same solid blue, so there was nothing to judge closeness by.
  // A tiled pattern of wave streaks fixes that through parallax. The
  // texture is pinned to world coordinates rather than to the plane, which
  // follows the player, so it slides past as you fly instead of travelling
  // with you and looking painted on.
  const SEA_TILE = 150;

  function waveTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#2E86C8';
    g.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 26; i++) {
      const y = Math.random() * 256;
      g.fillStyle = 'rgba(120,190,230,' + (0.05 + Math.random() * 0.07).toFixed(3) + ')';
      g.fillRect(0, y, 256, 6 + Math.random() * 22);
    }
    for (let i = 0; i < 170; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      const w = 8 + Math.random() * 34;
      g.strokeStyle = 'rgba(233,247,255,' + (0.06 + Math.random() * 0.16).toFixed(3) + ')';
      g.lineWidth = 0.8 + Math.random() * 1.8;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + w * 0.5, y - 2.5, x + w, y);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  }

  const seaTex = waveTexture();
  const SEA_SIZE = CHUNK * 24;
  seaTex.repeat.set(SEA_SIZE / SEA_TILE, SEA_SIZE / SEA_TILE);

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0xFFFFFF, map: seaTex })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = SEA_LEVEL;
  scene.add(sea);

  let seaDrift = 0;

  /* ===== chunk building ===== */

  function buildChunk(cx, cz) {
    const rnd = rngFrom(seedFor(cx, cz));
    const ox = cx * CHUNK;
    const oz = cz * CHUNK;

    const landParts = [];
    const cloudParts = [];
    const localIslands = [];
    const localBalloons = [];
    const localTargets = [];

    // Islands. Not every chunk gets one, or the sea stops being sea.
    const islandCount = rnd() < 0.62 ? 1 + (rnd() < 0.3 ? 1 : 0) : 0;
    for (let i = 0; i < islandCount; i++) {
      const ix = ox + (rnd() - 0.5) * CHUNK * 0.8;
      const iz = oz + (rnd() - 0.5) * CHUNK * 0.8;
      const r  = 55 + rnd() * 130;
      const h  = 22 + rnd() * 95;

      const hillRot = rnd() * 6.28;
      landParts.push(piece(GEO.beach, C.sand, ix, -3, iz, r * 1.18, 8, r * 1.18, 0));
      landParts.push(piece(GEO.hill, rnd() < 0.5 ? C.grass : C.grass2,
                           ix, h / 2 - 2, iz, r, h, r, hillRot));

      // A second, smaller peak makes the silhouette less like a traffic cone.
      if (rnd() < 0.55) {
        const px = ix + (rnd() - 0.5) * r * 0.8;
        const pz = iz + (rnd() - 0.5) * r * 0.8;
        const ph = h * (0.4 + rnd() * 0.4);
        landParts.push(piece(GEO.hill, C.grass2, px, ph / 2 - 2, pz, r * 0.5, ph, r * 0.5, rnd() * 6.28));
      }

      const trees = 3 + Math.floor(rnd() * 7);
      for (let t = 0; t < trees; t++) {
        const a = rnd() * Math.PI * 2;
        const d = r * (0.25 + rnd() * 0.6);
        const tx = ix + Math.cos(a) * d;
        const tz = iz + Math.sin(a) * d;
        // Sit the tree on the cone's slope rather than at sea level.
        const ty = Math.max(0.5, islandSurface(h, r, d, a, hillRot) - 0.6);
        const th = (11 + rnd() * 11) * 0.64;  // palms, two twenty per cent cuts

        // A palm: a leaning tapered trunk, a crown of drooping fronds, and
        // a couple of coconuts under them.
        const lean = (rnd() - 0.5) * 0.22;
        const leanDir = rnd() * Math.PI * 2;
        const crownY = ty + th;
        const cx = tx + Math.sin(lean) * th * 0.5 * Math.cos(leanDir);
        const cz = tz + Math.sin(lean) * th * 0.5 * Math.sin(leanDir);

        landParts.push(piece(GEO.taper, C.trunk,
          (tx + cx) / 2, ty + th * 0.5, (tz + cz) / 2,
          th * 0.075, th, th * 0.075, leanDir, 0, lean));

        const fronds = 6 + Math.floor(rnd() * 3);
        const frondBase = rnd() * Math.PI * 2;
        for (let f = 0; f < fronds; f++) {
          const ang = frondBase + (f / fronds) * Math.PI * 2 + (rnd() - 0.5) * 0.25;
          const droop = 0.42 + rnd() * 0.42;
          const len = th * (0.52 + rnd() * 0.24);
          const half = len * 0.5;
          landParts.push(piece(GEO.leaf, rnd() < 0.5 ? C.leaf : C.leaf2,
            cx + Math.cos(ang) * half * Math.cos(droop),
            crownY - half * Math.sin(droop) + th * 0.02,
            cz + Math.sin(ang) * half * Math.cos(droop),
            len, th * 0.13, th * 0.2,
            -ang, 0, -(Math.PI / 2) + droop));
        }

        landParts.push(piece(GEO.puff, 0x6E4A2A, cx, crownY - th * 0.03, cz,
          th * 0.09, th * 0.09, th * 0.09, 0));
        if (rnd() < 0.6) {
          landParts.push(piece(GEO.puff, 0x8A6236,
            cx + th * 0.06, crownY - th * 0.06, cz + th * 0.05,
            th * 0.055, th * 0.055, th * 0.055, 0));
        }
      }

      const rocks = Math.floor(rnd() * 4);
      for (let k = 0; k < rocks; k++) {
        const a = rnd() * Math.PI * 2;
        const d = r * (0.85 + rnd() * 0.3);
        const s = 4 + rnd() * 9;
        landParts.push(piece(GEO.rock, C.rock,
                             ix + Math.cos(a) * d, 1, iz + Math.sin(a) * d, s, s * 0.7, s, rnd() * 6.28));
      }

      localIslands.push({ x: ix, z: iz, r, h });

      // Something built on the island, sited where the slope is gentle.
      const built = r > 78 ? 1 + Math.floor(rnd() * 3) : (rnd() < 0.5 ? 1 : 0);
      for (let b = 0; b < built; b++) {
        const a = rnd() * Math.PI * 2;
        const d = r * (0.22 + rnd() * 0.45);
        const px = ix + Math.cos(a) * d;
        const pz = iz + Math.sin(a) * d;
        // Bedded in by half a unit so it never hovers on a seam.
        const py = Math.max(0.5, islandSurface(h, r, d, a, hillRot) - 0.5);
        const make = PROPS[Math.floor(rnd() * PROPS.length)];
        const def = make(rnd);
        const m = new THREE.Mesh(def.geo, landMat);
        m.position.set(px, py, pz);
        m.rotation.y = rnd() * 6.28;
        m.scale.setScalar(BUILT_SCALE);
        scene.add(m);
        // Generous on purpose. The sphere stands in for a building you are
        // strafing past at speed, and a tight one means shots that clearly
        // went through the roof do nothing.
        const t = { mesh: m, kind: 'prop', r: def.r * BUILT_SCALE + 5, hp: def.hp, alive: true };
        localTargets.push(t); targets.push(t);
      }
    }

    // Clouds sit above the height you normally cruise at. Level with it, the
    // camera ends up inside a puff constantly and a sphere clipped by the near
    // plane reads as a hard white polygon rather than as weather. You can
    // still climb into them on purpose.
    const cloudCount = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < cloudCount; i++) {
      const cxp = ox + (rnd() - 0.5) * CHUNK;
      const czp = oz + (rnd() - 0.5) * CHUNK;
      const cy  = 430 + rnd() * 470;
      const scale = 22 + rnd() * 40;
      const puffs = 4 + Math.floor(rnd() * 4);
      for (let p = 0; p < puffs; p++) {
        const px = cxp + (rnd() - 0.5) * scale * 2.4;
        const py = cy + (rnd() - 0.5) * scale * 0.5;
        const pz = czp + (rnd() - 0.5) * scale * 1.6;
        const ps = scale * (0.55 + rnd() * 0.6);
        cloudParts.push(piece(GEO.puff, 0xFFFFFF, px, py, pz, ps, ps * 0.72, ps, 0));
      }
    }

    // Ships, out in open water and clear of the beaches.
    const shipCount = rnd() < 0.45 ? 1 + (rnd() < 0.25 ? 1 : 0) : 0;
    for (let i = 0; i < shipCount; i++) {
      const sx = ox + (rnd() - 0.5) * CHUNK * 0.9;
      const sz = oz + (rnd() - 0.5) * CHUNK * 0.9;
      let clear = true;
      for (const isl of localIslands) {
        if (Math.hypot(sx - isl.x, sz - isl.z) < isl.r * 1.35 + 30) { clear = false; break; }
      }
      if (!clear) continue;
      const roll = rnd();
      const hostile = roll < ENEMY_SHARE;
      const build = hostile ? enemyShipGeo
                  : roll < 0.4 ? battleshipGeo
                  : roll < 0.72 ? cargoShipGeo
                  : sailShipGeo;
      const def = build(rnd);
      const m = new THREE.Mesh(def.geo, landMat);
      m.position.set(sx, 1.2, sz);
      m.rotation.y = rnd() * 6.28;
      m.scale.setScalar(BUILT_SCALE);
      scene.add(m);
      // A hull twenty six long does not fit a ten unit sphere.
      const t = {
        mesh: m, kind: 'ship', hostile,
        r: def.r * BUILT_SCALE + 4,
        hp: def.hp, maxHp: def.hp,
        alive: true, bob: rnd() * 6.28, baseY: 1.2,
        // Staggered so a group of ships does not fire as one volley.
        cool: 0.6 + rnd() * 2.4,
      };
      localTargets.push(t); targets.push(t);
    }

    // Balloons, the thing worth shooting at.
    const balloonCount = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < balloonCount; i++) {
      const bx = ox + (rnd() - 0.5) * CHUNK * 0.9;
      const bz = oz + (rnd() - 0.5) * CHUNK * 0.9;
      const by = 60 + rnd() * 300;
      const colour = BALLOON_COLOURS[Math.floor(rnd() * BALLOON_COLOURS.length)];
      const m = new THREE.Mesh(GEO.balloon, new THREE.MeshLambertMaterial({ color: colour }));
      m.scale.set(9, 11, 9);
      m.position.set(bx, by, bz);
      scene.add(m);
      const b = { mesh: m, x: bx, y: by, z: bz, r: 12, bob: rnd() * 6.28, alive: true, colour };
      localBalloons.push(b);
      balloons.push(b);
    }

    const land = landParts.length
      ? new THREE.Mesh(mergeGeometries(landParts), landMat) : null;
    if (land) { land.frustumCulled = true; scene.add(land); }

    const cloud = cloudParts.length
      ? new THREE.Mesh(mergeGeometries(cloudParts), cloudMat) : null;
    if (cloud) { cloud.frustumCulled = true; scene.add(cloud); }

    for (const isl of localIslands) islands.push(isl);

    return { land, cloud, islands: localIslands, balloons: localBalloons, targets: localTargets };
  }

  function dropChunk(key) {
    const c = chunks.get(key);
    if (!c) return;
    if (c.land)  { scene.remove(c.land);  c.land.geometry.dispose(); }
    if (c.cloud) { scene.remove(c.cloud); c.cloud.geometry.dispose(); }
    for (const b of c.balloons) {
      scene.remove(b.mesh);
      b.mesh.material.dispose();
      const i = balloons.indexOf(b);
      if (i >= 0) balloons.splice(i, 1);
    }
    for (const isl of c.islands) {
      const i = islands.indexOf(isl);
      if (i >= 0) islands.splice(i, 1);
    }
    for (const t of c.targets) {
      if (t.alive) { scene.remove(t.mesh); t.mesh.geometry.dispose(); }
      const i = targets.indexOf(t);
      if (i >= 0) targets.splice(i, 1);
    }
    chunks.delete(key);
  }

  return {
    balloons,
    islands,
    targets,
    CHUNK,
    VIEW,

    // Keep the sky and sea centred on the player so neither ever runs out,
    // and stream chunks in and out around them.
    update(pos, dt) {
      sky.position.copy(pos);
      sea.position.x = pos.x;
      sea.position.z = pos.z;

      // Cancel out the plane following the player so the pattern stays put
      // in the world, then add a slow drift of its own for movement.
      seaDrift += dt * 0.012;
      seaTex.offset.set(
        pos.x / SEA_TILE,
        -pos.z / SEA_TILE + seaDrift
      );

      const cx = Math.round(pos.x / CHUNK);
      const cz = Math.round(pos.z / CHUNK);

      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        for (let dz = -RADIUS; dz <= RADIUS; dz++) {
          const key = (cx + dx) + ',' + (cz + dz);
          if (!chunks.has(key)) chunks.set(key, buildChunk(cx + dx, cz + dz));
        }
      }

      for (const key of [...chunks.keys()]) {
        const [kx, kz] = key.split(',').map(Number);
        if (Math.abs(kx - cx) > RADIUS || Math.abs(kz - cz) > RADIUS) dropChunk(key);
      }

      for (const b of balloons) {
        if (!b.alive) continue;
        b.bob += dt * 0.7;
        b.mesh.position.y = b.y + Math.sin(b.bob) * 3.5;
        b.mesh.rotation.y += dt * 0.4;
      }

      for (const t of targets) {
        if (!t.alive || t.kind !== 'ship') continue;
        t.bob += dt * 0.8;
        t.mesh.position.y = t.baseY + Math.sin(t.bob) * 0.7;
        t.mesh.rotation.z = Math.sin(t.bob * 0.7) * 0.045;
      }
    },

    // Returns 'miss', 'hit' or 'destroyed'. A ship takes several rounds; a
    // building comes down on the first.
    damage(t, amount) {
      if (!t || !t.alive) return 'miss';
      t.hp -= amount;
      if (t.hp > 0) return 'hit';
      t.alive = false;
      scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      const i = targets.indexOf(t);
      if (i >= 0) targets.splice(i, 1);
      return 'destroyed';
    },

    // Ground height under a point. The islands are cones, so this is just the
    // cone profile, and it is what keeps you from flying through a hill.
    heightAt(x, z) {
      let h = SEA_LEVEL;
      for (const isl of islands) {
        const d = Math.hypot(x - isl.x, z - isl.z);
        if (d < isl.r) {
          const local = isl.h * (1 - d / isl.r);
          if (local > h) h = local;
        }
      }
      return h;
    },

    popBalloon(b) {
      if (!b.alive) return;
      b.alive = false;
      scene.remove(b.mesh);
      b.mesh.material.dispose();
      const i = balloons.indexOf(b);
      if (i >= 0) balloons.splice(i, 1);
    },

    setFog(scene2) {
      // Exponential rather than linear. Linear fog starts at a fixed
      // distance, and that start is visible as a band; exp2 has no edge to
      // see. Tuned so an island is still readable at about two chunks and
      // gone by four, which keeps some depth without hiding the world.
      scene2.fog = new THREE.FogExp2(C.haze, 0.00052);
      scene2.background = new THREE.Color(C.haze);
    },
  };
}
