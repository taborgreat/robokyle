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
  { x: 13.0, z: 0 },
  { x: 7.0, z: -2.8 }, { x: 7.0, z: 2.8 },
  { x: 2.0, z: 0 },
  { x: -6.2, z: -2.8 }, { x: -6.2, z: 2.8 },
  { x: -16.0, z: 0 },
];

// Roughly one ship in five is hostile, up from one in ten. At one in ten
// you could fly a long way without meeting anything that fired back, which
// left the flak and the gunner with nothing to do.
const ENEMY_SHARE = 0.2;

// Where the hillside actually is, at a horizontal distance d from the middle
// of an island of radius r and height h.
//
// The hill is a cone scaled by (r, h, r) and sat at y = h/2 - 2, so its base
// is at -2 and its tip at h - 2, and the surface at distance d is
// h * (1 - d / r) - 2. Placement used to multiply by 0.82 instead of
// subtracting the 2, which on a hundred unit hill buried a house sixteen
// units into the slope.
//
// The cone is fourteen sided now rather than nine, both because it reads
// less like a die from the air and because the extra vertices are what the
// ground texture has to work with. Between vertices the real surface sits lower
// than the ideal cone by cos(pi/9). Working in that inscribed radius means a
// building is always on or a little into the ground and never floating over
// a notch, which is the failure that looks worse.
const CONE_FACES = 14;
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
  hill:   new THREE.ConeGeometry(1, 1, CONE_FACES, 4),
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
function piece(geo, color, x, y, z, sx, sy, sz, rotY, rotX, rotZ, uvPer) {
  // XYZ order, so Z is applied first, then Y. A palm frond droops about Z
  // and is then swung around the trunk about Y, which is exactly that order.
  _e.set(rotX || 0, rotY || 0, rotZ || 0);
  _q.setFromEuler(_e);
  _v.set(x, y, z);
  _s.set(sx, sy, sz);
  _m.compose(_v, _q, _s);

  // toNonIndexed() on an already non-indexed geometry warns and hands back
  // the same object, so ask first and clone only when it is not needed.
  const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(_m);
  const n = g.attributes.position.count;
  const col = new THREE.Color(color);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));

  // Ground keeps its UVs so a grain map has something to sit on, and they
  // are rescaled to tile every uvPer world units rather than once across
  // the object: without that a small island and a big one wear the same
  // number of tiles and the texture size gives the scale away. The round
  // count matters on the u axis, which wraps: a fractional one leaves a
  // seam straight down one side of the hill.
  if (uvPer) {
    const uv = g.attributes.uv;
    const rad = Math.max(Math.abs(sx), Math.abs(sz));
    const ku = Math.max(1, Math.round((2 * Math.PI * rad) / uvPer));
    const kv = Math.max(1, Math.hypot(rad, Math.abs(sy)) / uvPer);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ku, uv.getY(i) * kv);
  } else {
    // Everything else drops them, because merge needs one set of attributes
    // and scenery has no use for a map.
    g.deleteAttribute('uv');
  }
  return g;
}

// How far apart the ground texture tiles, in world units.
const GROUND_UV = 42;

/* ===== rubble =====

   Every structure has one. A house that simply vanishes on the last round
   leaves a bald patch of hillside, and then knocking it down means nothing
   the next time you fly over. The pile is built from the same palette as
   the thing that was standing there, so it reads as that building's
   remains rather than as generic debris: a scorch mark, a low mound, a
   broken wall or two still up, and slabs and beams thrown flat. */

function rubbleGeo(rnd, opts) {
  const { r, wall, roof, beam = 0x4A3A2A, stubs = 2, tall = 0 } = opts;
  const parts = [
    // Scorch first, flat on the ground and wider than the building was.
    piece(GEO.box, 0x33302B, 0, 0.1, 0, r * 2.1, 0.2, r * 2.1, rnd() * 6.28),
    // The mound, low and spread.
    piece(GEO.rock, wall, 0, r * 0.16, 0, r * 0.85, r * 0.3, r * 0.8, rnd() * 6.28),
    piece(GEO.rock, roof, r * 0.22, r * 0.14, -r * 0.18, r * 0.55, r * 0.24, r * 0.5, rnd() * 6.28),
  ];

  // Walls left standing, leaning. A stump is what tells you at a glance
  // that something was here rather than that something was spilled here.
  for (let i = 0; i < stubs; i++) {
    const a = (i / Math.max(1, stubs)) * Math.PI * 2 + rnd();
    const d = r * (0.4 + rnd() * 0.3);
    const hgt = r * (0.45 + rnd() * 0.5) + tall;
    parts.push(piece(GEO.box, wall,
      Math.cos(a) * d, hgt * 0.5, Math.sin(a) * d,
      r * (0.28 + rnd() * 0.3), hgt, r * 0.2,
      a, 0, (rnd() - 0.5) * 0.32));
  }

  const bits = 8 + Math.floor(rnd() * 5);
  for (let i = 0; i < bits; i++) {
    const a = rnd() * Math.PI * 2;
    const d = r * (0.25 + rnd() * 1.0);
    parts.push(piece(GEO.box, [wall, roof, beam, 0x9C9384][i % 4],
      Math.cos(a) * d, 0.3 + rnd() * r * 0.14, Math.sin(a) * d,
      r * (0.16 + rnd() * 0.32), r * (0.05 + rnd() * 0.1), r * (0.12 + rnd() * 0.28),
      rnd() * 6.28, (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6));
  }
  return mergeGeometries(parts);
}

/* ===== things you can knock down =====

   These cannot go into the merged chunk mesh: the whole point of merging is
   that a chunk is one object, and one object cannot lose a house. So each
   one is its own mesh, merged internally so it is still a single draw call,
   and they all share the vertex coloured material. */

function houseGeo(rnd) {
  const wall = rnd() < 0.5 ? 0xF2E7D2 : 0xE6D6B8;
  const roof = [0xC1462F, 0x40708C, 0x7A4A3A][Math.floor(rnd() * 3)];
  const wreck = rubbleGeo(rnd, { r: 5.4, wall, roof, beam: 0x6B4A2F, stubs: 2 });
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
  return { geo: mergeGeometries(parts), rubble: wreck, r: 5.4, hp: 1 };
}

function hutGeo(rnd) {
  const wreck = rubbleGeo(rnd, { r: 3.7, wall: 0xD8C39A, roof: 0x8A6236, beam: 0x7A5230, stubs: 1 });
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
  return { geo: mergeGeometries(parts), rubble: wreck, r: 3.7, hp: 1 };
}

function windmillGeo(rnd) {
  // A snapped tower and one sail arm lying across the pile.
  const wreck = rubbleGeo(rnd, { r: 4.8, wall: 0xEFE6D2, roof: 0xC1462F, stubs: 2, tall: 1.6 });
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
  return { geo: mergeGeometries(parts), rubble: wreck, r: 4.8, hp: 1 };
}

function lighthouseGeo(rnd) {
  // Towers do not spread, they snap: a taller stump and a shorter spill.
  const wreck = rubbleGeo(rnd, { r: 3.6, wall: 0xF6F1E6, roof: 0xC1462F, beam: 0x37414A, stubs: 1, tall: 5.5 });
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
  return { geo: mergeGeometries(parts), rubble: wreck, r: 3.6, hp: 1 };
}

function churchGeo(rnd) {
  const wreck = rubbleGeo(rnd, { r: 6.4, wall: 0xF2EDE0, roof: 0x8A5A3A, beam: 0x8A5A3A, stubs: 3, tall: 2.5 });
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
  return { geo: mergeGeometries(parts), rubble: wreck, r: 6.4, hp: 1 };
}

function barnGeo(rnd) {
  const red = rnd() < 0.5 ? 0xA63A2A : 0x8C4030;
  const wreck = rubbleGeo(rnd, { r: 6.2, wall: red, roof: 0x5C5148, beam: 0x6B4A2F, stubs: 2 });
  const parts = [
    piece(GEO.box,  red,      0, 3.0, 0, 8.0, 6.0, 11.0, 0),
    piece(GEO.roof, 0x5C5148, 0, 7.6, 0, 7.4, 3.4, 9.4, Math.PI / 4),
    piece(GEO.box,  0xEFE6D2, 0, 6.4, 5.55, 3.0, 2.0, 0.2, 0),
    piece(GEO.box,  0xD9CDB4, 0, 2.4, 5.55, 4.6, 4.8, 0.25, 0),
    piece(GEO.box,  red,      0, 2.4, 5.7, 0.4, 4.8, 0.2, 0),
    piece(GEO.box,  0xEFE6D2, -4.05, 3.4, 2.4, 0.25, 1.8, 1.8, 0),
    piece(GEO.box,  0xEFE6D2, 4.05, 3.4, 2.4, 0.25, 1.8, 1.8, 0),
  ];
  return { geo: mergeGeometries(parts), rubble: wreck, r: 6.2, hp: 1 };
}

function waterTowerGeo(rnd) {
  // The tank comes down whole and splits: one big pale slab in the middle.
  const wreck = rubbleGeo(rnd, { r: 4.0, wall: 0x9FB0BC, roof: 0x5C5148, beam: 0x6B4A2F, stubs: 1, tall: 1.2 });
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
  return { geo: mergeGeometries(parts), rubble: wreck, r: 4.0, hp: 1 };
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
    piece(GEO.box, dark, -0.5, 1.0, 0, 21, 2.2, 5.4, 0),
    piece(GEO.box, wood, -0.5, 3.0, 0, 21, 2.6, 5.8, 0),
    piece(GEO.box, trim, -0.5, 4.15, 0, 21.2, 0.5, 6.0, 0),

    piece(GEO.roof, wood, 11.6, 2.2, 0, 3.0, 5.2, 3.0, 0, Math.PI / 4, -Math.PI / 2),
    piece(GEO.box,  trim, 9.6, 4.3, 0, 3.6, 0.5, 3.8, 0),

    piece(GEO.box, wood, -6.2, 5.4, 0, 4.6, 3.0, 5.2, 0),
    piece(GEO.box, wood, -7.4, 7.4, 0, 3.0, 1.6, 4.6, 0),
    piece(GEO.box, trim, -6.2, 7.0, 0, 4.8, 0.4, 5.4, 0),
    piece(GEO.box, 0xE8B444, -8.35, 6.0, 0, 0.3, 1.2, 2.4, 0),

    piece(GEO.box, 0x7C5735, 0.5, 4.4, 0, 13.5, 0.35, 4.6, 0),

    piece(GEO.cyl, trim, 14.0, 4.4, 0, 0.34, 6.0, 0.34, 0, 0, -Math.PI / 2.6),
  ];

  for (const sz of [-2.9, 2.9]) {
    parts.push(piece(GEO.box, wood, -0.5, 5.0, sz, 20.6, 1.2, 0.35, 0));
    for (let i = -4; i <= 4; i++) {
      parts.push(piece(GEO.box, dark, i * 2.1 - 0.5, 3.0, sz + (sz > 0 ? 0.12 : -0.12), 1.1, 1.1, 0.2, 0));
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

  return { geo: mergeGeometries(parts), r: 13, hp: 7 };
}

// A working steamer.
//
// Lengthened, because the deck run of containers was longer than the hull
// they sat on and the forward stack hung off the bow into open air. The
// hull is thirty two now and the cargo is laid out inside it with the
// forecastle left clear.
function cargoShipGeo(rnd) {
  const hull = [0x3E4A57, 0x4A3A32, 0x2F4A44][Math.floor(rnd() * 3)];
  const parts = [
    piece(GEO.box, 0x22262B, -1.0, 1.0, 0, 32, 2.4, 6.4, 0),
    piece(GEO.box, hull,     -1.0, 3.2, 0, 32, 2.2, 6.8, 0),
    piece(GEO.box, 0xC9C2B0, -1.0, 4.4, 0, 32.2, 0.4, 7.0, 0),
    // bow, sitting at the very end of the hull rather than short of it
    piece(GEO.roof, hull, 16.6, 2.3, 0, 3.4, 5.6, 3.4, 0, Math.PI / 4, -Math.PI / 2),
    piece(GEO.box, 0xC9C2B0, 14.6, 4.5, 0, 4.0, 0.4, 4.4, 0),
    // deckhouse and funnel, right aft
    piece(GEO.box, 0xE4DED0, -11.0, 6.4, 0, 6.0, 4.0, 5.8, 0),
    piece(GEO.box, 0xC9C2B0, -11.0, 8.6, 0, 6.4, 0.5, 6.2, 0),
    piece(GEO.box, 0x2B3138, -11.0, 6.9, 3.0, 4.6, 1.3, 0.3, 0),
    piece(GEO.box, 0x2B3138, -11.0, 6.9, -3.0, 4.6, 1.3, 0.3, 0),
    piece(GEO.cyl, 0xB8452F, -13.8, 10.8, 0, 1.6, 5.0, 1.6, 0),
    piece(GEO.cyl, 0x22262B, -13.8, 13.4, 0, 1.7, 0.6, 1.7, 0),
    piece(GEO.cyl, 0xC9C2B0, -6.6, 8.2, 0, 0.25, 7.4, 0.25, 0),
    piece(GEO.box, 0x8A8577, 0.5, 4.7, 0, 28, 0.3, 5.4, 0),
  ];
  // Containers, kept between the forecastle and the deckhouse.
  const crates = [0xC1462F, 0x2F6E8C, 0xE8B444, 0x5A8A4A, 0x8A6236];
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 2; j++) {
      const stack = rnd() < 0.4 ? 2 : 1;
      for (let k = 0; k < stack; k++) {
        parts.push(piece(GEO.box, crates[Math.floor(rnd() * crates.length)],
          -6.4 + i * 2.7, 5.5 + k * 2.0, -1.5 + j * 3.0, 2.4, 1.9, 2.8, 0));
      }
    }
  }
  // gunwales
  for (const sz of [-3.3, 3.3]) {
    parts.push(piece(GEO.box, hull, -1.0, 5.2, sz, 31, 1.2, 0.3, 0));
  }
  return { geo: mergeGeometries(parts), r: 17, hp: 8 };
}

// Turrets and a mast, in a friendly grey. Tough, and it never shoots back.
function battleshipGeo(rnd) {
  const hull = 0x5A6672;
  const deck = 0x76818B;
  const dark = 0x2B3138;
  const parts = [
    piece(GEO.box, dark, -1.0, 1.0, 0, 38, 2.4, 7.0, 0),
    piece(GEO.box, hull, -1.0, 3.2, 0, 38, 2.2, 7.4, 0),
    piece(GEO.box, deck, -1.0, 4.4, 0, 38.2, 0.4, 7.6, 0),
    piece(GEO.roof, hull, 19.6, 2.3, 0, 3.7, 6.0, 3.7, 0, Math.PI / 4, -Math.PI / 2),
    // bridge, stepped, amidships
    piece(GEO.box, deck, -2.4, 6.8, 0, 7.0, 4.4, 5.8, 0),
    piece(GEO.box, deck, -2.4, 9.8, 0, 4.6, 2.2, 4.4, 0),
    piece(GEO.box, dark, -2.4, 11.4, 0, 3.0, 1.0, 3.0, 0),
    piece(GEO.cyl, dark, -2.4, 15.0, 0, 0.35, 7.6, 0.35, 0),
    piece(GEO.box, dark, -2.4, 17.0, 0, 0.3, 0.3, 3.2, 0),
    piece(GEO.cyl, 0x8A8F94, -8.4, 8.6, 0, 1.5, 4.4, 1.5, 0),
    piece(GEO.cyl, 0x8A8F94, -12.4, 8.2, 0, 1.3, 3.6, 1.3, 0),
  ];
  // two turrets forward, two aft, stepped so they read as a battle line
  for (const t of [{ x: 10.4, s: 1 }, { x: 5.2, s: 0.9 }, { x: -11.0, s: 0.9 }, { x: -15.6, s: 0.85 }]) {
    parts.push(piece(GEO.cyl, deck, t.x, 5.3, 0, 2.7 * t.s, 1.6, 2.7 * t.s, 0));
    parts.push(piece(GEO.box, deck, t.x, 6.4, 0, 4.2 * t.s, 2.0, 3.6 * t.s, 0));
    for (const bz of [-0.9, 0.9]) {
      parts.push(piece(GEO.cyl, dark, t.x + 3.6 * t.s, 6.6, bz, 0.3, 5.4 * t.s, 0.3, 0, 0, -Math.PI / 2));
    }
  }
  for (const sz of [-3.6, 3.6]) {
    parts.push(piece(GEO.box, hull, -1.0, 5.2, sz, 37, 1.2, 0.3, 0));
  }
  return { geo: mergeGeometries(parts), r: 20, hp: 12 };
}

// The one that shoots back. Same length of hull, darker paint, red
// markings, and flak mounts where its shells actually come from.
function enemyShipGeo(rnd) {
  const hull = 0x3A3F46;
  const deck = 0x4C525A;
  const dark = 0x1E2227;
  const mark = 0xB8332A;
  const parts = [
    piece(GEO.box, dark, -1.0, 1.0, 0, 38, 2.4, 7.0, 0),
    piece(GEO.box, hull, -1.0, 3.2, 0, 38, 2.2, 7.4, 0),
    piece(GEO.box, mark, -1.0, 4.35, 0, 38.2, 0.5, 7.6, 0),
    piece(GEO.roof, hull, 19.6, 2.3, 0, 3.7, 6.0, 3.7, 0, Math.PI / 4, -Math.PI / 2),
    piece(GEO.box, deck, -2.4, 7.0, 0, 7.4, 4.8, 6.0, 0),
    piece(GEO.box, deck, -2.4, 10.2, 0, 4.8, 2.4, 4.6, 0),
    piece(GEO.box, mark, -2.4, 11.8, 0, 3.2, 0.7, 3.2, 0),
    piece(GEO.cyl, dark, -2.4, 15.4, 0, 0.35, 8.0, 0.35, 0),
    piece(GEO.cyl, 0x6A7078, -9.0, 8.8, 0, 1.6, 4.6, 1.6, 0),
    piece(GEO.box, mark, -9.0, 11.4, 0, 3.4, 0.9, 3.4, 0),
    piece(GEO.cyl, 0x6A7078, -13.4, 8.2, 0, 1.3, 3.6, 1.3, 0),
  ];
  for (const g of ENEMY_GUNS) {
    parts.push(piece(GEO.cyl, dark, g.x, 5.0, g.z, 1.8, 1.4, 1.8, 0));
    parts.push(piece(GEO.cyl, deck, g.x, 5.9, g.z, 1.2, 1.2, 1.2, 0));
    for (const off of [-0.4, 0.4]) {
      parts.push(piece(GEO.cyl, dark, g.x + 0.8, 7.2, g.z + off, 0.24, 3.8, 0.24, 0, 0, -0.9));
    }
  }
  for (const sz of [-3.6, 3.6]) {
    parts.push(piece(GEO.box, hull, -1.0, 5.2, sz, 37, 1.2, 0.3, 0));
  }

  return { geo: mergeGeometries(parts), r: 20, hp: 14 };
}

const PROPS = [houseGeo, houseGeo, houseGeo, hutGeo, hutGeo,
               windmillGeo, lighthouseGeo, churchGeo, barnGeo, waterTowerGeo];

export function createWorld(scene) {
  const landMat  = new THREE.MeshLambertMaterial({ vertexColors: true });

  /* The ground gets a texture; nothing else does.

     A grain map, deliberately colourless, so it multiplies whatever vertex
     colour is underneath and one texture serves as grass on the hills and
     as sand on the beaches. Flat unbroken green is what made these read as
     toys from low down: there was nothing on the slope for the eye to fix
     on, so no sense of size or of speed over it.

     It needs UVs, and UVs cannot be merged with geometry that lacks them,
     which is why terrain and scenery are now two meshes per chunk instead
     of one. Three draw calls a chunk rather than two. */
  function grainTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#FFFFFF';
    g.fillRect(0, 0, 256, 256);

    // Soft blotches: variation big enough to still be there from altitude.
    for (let i = 0; i < 110; i++) {
      const v = Math.random() < 0.5 ? 20 : 255;
      g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' +
                    (0.05 + Math.random() * 0.09).toFixed(3) + ')';
      g.beginPath();
      g.arc(Math.random() * 256, Math.random() * 256, 5 + Math.random() * 28, 0, 6.2832);
      g.fill();
    }
    // Fine speckle, which is what you actually see on a low pass.
    for (let i = 0; i < 3200; i++) {
      const v = Math.random() < 0.5 ? 45 : 240;
      g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.11)';
      g.fillRect(Math.random() * 256, Math.random() * 256,
                 1 + Math.random() * 2.4, 1 + Math.random() * 2.4);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  }

  const groundMat = new THREE.MeshLambertMaterial({
    vertexColors: true, map: grainTexture(),
  });
  // Lambert alone leaves the underside of a cloud picking up the green
  // bounce off the hemisphere light and reading as grey. A strong pale
  // emissive floors the shaded side at something still cloud coloured.
  const cloudMat = new THREE.MeshLambertMaterial({
    color: 0xFFFFFF, emissive: 0xBBD6EA, emissiveIntensity: 0.8,
    transparent: true, opacity: 0.97,
  });

  const chunks = new Map();        // "cx,cz" -> { ground, land, cloud, ... }
  const balloons = [];             // live, shootable
  const islands  = [];             // live, for the ground check
  const targets  = [];             // live, shootable and destructible
  const burning  = [];             // rubble that is still alight
  const sinking  = [];             // hulls on their way down

  // Handed in after construction, because the effects pool is built after
  // the world is. Everything that goes on burning is driven from here
  // rather than from the flight code: the world already knows what it has
  // wrecked and where, and it is already walking that list every frame.
  let fx = null;

  const _p = new THREE.Vector3();

  const _s1 = new THREE.Vector3();
  const _s2 = new THREE.Vector3();
  const _s3 = new THREE.Vector3();
  const _s4 = new THREE.Vector3();

  // Distance from a sphere centre to the segment ab. The path of a round
  // is a curve, so it has to be tested a piece at a time rather than as
  // one ray, and each piece is a segment.
  function segDist(ax, ay, az, bx, by, bz, c) {
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const apx = c.x - ax, apy = c.y - ay, apz = c.z - az;
    const ab2 = abx * abx + aby * aby + abz * abz;
    let t = ab2 > 0 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // Distance along a unit ray to the near side of a sphere, or -1 if it
  // misses or the sphere is behind.
  function raySphere(from, dir, c, r) {
    const px = c.x - from.x, py = c.y - from.y, pz = c.z - from.z;
    const t = px * dir.x + py * dir.y + pz * dir.z;
    if (t <= 0) return -1;
    const dx = px - dir.x * t, dy = py - dir.y * t, dz = pz - dir.z * t;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r * r) return -1;
    return Math.max(0, t - Math.sqrt(r * r - d2));
  }

  function groundHeight(x, z) {
    let h = SEA_LEVEL;
    for (const isl of islands) {
      const dx = x - isl.x, dz = z - isl.z;
      // One test throws out every island you are not over, which is
      // nearly all of them on nearly every call, so the lobes cost
      // nothing until you are actually above one.
      if (dx * dx + dz * dz > isl.reach * isl.reach) continue;
      const d = Math.hypot(dx, dz);
      if (d < isl.r) {
        const local = isl.h * (1 - d / isl.r);
        if (local > h) h = local;
      }
      for (const lb of isl.lobes) {
        const ld = Math.hypot(x - lb.x, z - lb.z);
        if (ld < lb.r) {
          const local = lb.h * (1 - ld / lb.r);
          if (local > h) h = local;
        }
      }
    }
    return h;
  }



  // Chunks waiting to be built, nearest first. See update() for why.
  const pending = [];
  const queued  = new Set();

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

    const groundParts = [];         // hills and beaches, textured
    const landParts = [];           // trees and rocks, flat colour
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
      // Height from the radius rather than rolled on its own. Rolling them
      // separately is what produced the spikes: a 55 wide island could come
      // out 110 tall, which is a traffic cone, and a 185 wide one 25 tall,
      // which is a pancake. Tied together they come out as land.
      const h  = r * (0.17 + rnd() * 0.3);

      const hillRot = rnd() * 6.28;

      // Shallows first, a flat pale ring standing just proud of the sea.
      // It has to sit above the water, not below it: the sea is an opaque
      // plane and anything under it is simply gone.
      groundParts.push(piece(GEO.beach, 0x6FC3D8, ix, 0.18, iz, r * 1.62, 0.5, r * 1.62, 0, 0, 0, GROUND_UV));
      groundParts.push(piece(GEO.beach, C.sand, ix, -3, iz, r * 1.2, 8, r * 1.2, 0, 0, 0, GROUND_UV));
      groundParts.push(piece(GEO.hill, rnd() < 0.5 ? C.grass : C.grass2,
                             ix, h / 2 - 2, iz, r, h, r, hillRot, 0, 0, GROUND_UV));

      /* Lobes.

         One cone is a traffic cone. Two or three overlapping ones at
         different heights and offsets read as a ridge with shoulders,
         which is most of the difference between this and a party hat.

         They go into the island record as well as into the mesh. heightAt
         has to know about anything you can fly into, and the old second
         peak went into neither: it was drawn and then forgotten, so you
         could pass straight through it. */
      const lobes = [];
      const lobeCount = 2 + Math.floor(rnd() * 3);
      for (let k = 0; k < lobeCount; k++) {
        const la = rnd() * Math.PI * 2;
        const ld = r * (0.18 + rnd() * 0.5);
        const lr = r * (0.3 + rnd() * 0.34);
        const lh = h * (0.34 + rnd() * 0.52);
        const lx = ix + Math.cos(la) * ld;
        const lz = iz + Math.sin(la) * ld;
        groundParts.push(piece(GEO.hill, k % 2 ? C.grass2 : C.grass,
                               lx, lh / 2 - 2, lz, lr, lh, lr, rnd() * 6.28, 0, 0, GROUND_UV));
        lobes.push({ x: lx, z: lz, r: lr, h: lh });
      }

      const trees = 3 + Math.floor(rnd() * 7);
      for (let t = 0; t < trees; t++) {
        const a = rnd() * Math.PI * 2;
        const d = r * (0.25 + rnd() * 0.6);
        const tx = ix + Math.cos(a) * d;
        const tz = iz + Math.sin(a) * d;
        // Sit the tree on the cone's slope rather than at sea level.
        const ty = Math.max(0.5, islandSurface(h, r, d, a, hillRot) - 0.6);
        const th = (11 + rnd() * 11) * 0.576; // palms: two twenty per cent cuts, then ten more

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

      // reach is the furthest anything on this island sticks out, so the
      // ground check can skip the whole island with one distance test and
      // only walk the lobes for the one you are actually over.
      let reach = r;
      for (const lb of lobes) reach = Math.max(reach, Math.hypot(lb.x - ix, lb.z - iz) + lb.r);
      localIslands.push({ x: ix, z: iz, r, h, lobes, reach });

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
        const t = {
          mesh: m, kind: 'prop', r: def.r * BUILT_SCALE + 5, hp: def.hp, alive: true,
          // Kept so the mesh can become its own ruin in place rather than
          // being deleted, and so the fire on it is sized to the building.
          rubble: def.rubble || null, baseR: def.r * BUILT_SCALE,
        };
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
        alive: true, bob: rnd() * 6.28, baseY: 1.2, puff: rnd() * 0.6, stack: false,
        // Counts down from the last time it fired, so the threat arrow
        // knows which hostiles are actually engaging rather than merely
        // floating about.
        engaging: 0,
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

    const ground = groundParts.length
      ? new THREE.Mesh(mergeGeometries(groundParts), groundMat) : null;
    if (ground) { ground.frustumCulled = true; scene.add(ground); }

    const land = landParts.length
      ? new THREE.Mesh(mergeGeometries(landParts), landMat) : null;
    if (land) { land.frustumCulled = true; scene.add(land); }

    const cloud = cloudParts.length
      ? new THREE.Mesh(mergeGeometries(cloudParts), cloudMat) : null;
    if (cloud) { cloud.frustumCulled = true; scene.add(cloud); }

    for (const isl of localIslands) islands.push(isl);

    return { ground, land, cloud, islands: localIslands, balloons: localBalloons, targets: localTargets };
  }

  function dropChunk(key) {
    const c = chunks.get(key);
    if (!c) return;
    if (c.ground) { scene.remove(c.ground); c.ground.geometry.dispose(); }
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
      // A dead one is no longer in targets, but its mesh is very much still
      // in the scene: rubble stays put and a hull is on its way down. Only
      // one that has finished sinking has already gone.
      if (!t.gone) { scene.remove(t.mesh); t.mesh.geometry.dispose(); }
      const i = targets.indexOf(t);
      if (i >= 0) targets.splice(i, 1);
      const bi = burning.indexOf(t); if (bi >= 0) burning.splice(bi, 1);
      const si = sinking.indexOf(t); if (si >= 0) sinking.splice(si, 1);
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

      /* Chunk building, spread out.

         This is the only thing in here that costs real time, and it used to
         happen all at once: crossing a chunk boundary asks for a new column
         of seven, and building seven took 25 to 35 ms in one frame against
         a budget of 16.7. Two dropped frames, every boundary, which is the
         stutter that turns up "from time to time" and has nothing to do
         with what you are flying over.

         So they queue instead, nearest first, and a couple get built each
         frame. Nothing pops in where you can see it: seven frames is a
         tenth of a second and the far ring of the grid is past the fog
         anyway. The first frame of all is the exception, and takes enough
         to put ground under the aircraft before anything else. */
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        for (let dz = -RADIUS; dz <= RADIUS; dz++) {
          const key = (cx + dx) + ',' + (cz + dz);
          if (!chunks.has(key) && !queued.has(key)) {
            queued.add(key);
            pending.push({ key, cx: cx + dx, cz: cz + dz });
          }
        }
      }

      if (pending.length) {
        pending.sort((a, b) =>
          (Math.abs(a.cx - cx) + Math.abs(a.cz - cz)) -
          (Math.abs(b.cx - cx) + Math.abs(b.cz - cz)));
        let budget = chunks.size === 0 ? 9 : 2;
        while (budget > 0 && pending.length) {
          const job = pending.shift();
          queued.delete(job.key);
          // It may have gone out of range while it sat in the queue.
          if (Math.abs(job.cx - cx) > RADIUS || Math.abs(job.cz - cz) > RADIUS) continue;
          chunks.set(job.key, buildChunk(job.cx, job.cz));
          budget--;
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

      let smokers = 0;
      for (const t of targets) {
        if (!t.alive || t.kind !== 'ship') continue;
        t.bob += dt * 0.8;
        t.mesh.position.y = t.baseY + Math.sin(t.bob) * 0.7;
        t.mesh.rotation.z = Math.sin(t.bob * 0.7) * 0.045;

        // Live smoke off a hostile's stacks, close in. The plume built into
        // the hull is what you spot from range; this is what it looks like
        // once you are near enough for the built one to look painted on.
        if (!fx || !t.hostile || smokers > 6) continue;
        if (Math.abs(t.mesh.position.x - pos.x) > 2300 ||
            Math.abs(t.mesh.position.z - pos.z) > 2300) continue;
        t.puff -= dt;
        if (t.puff > 0) continue;
        // Alternating stacks rather than both at once: same plume, half the
        // particles, and the two columns stay out of step the way real ones
        // do. It has to do the whole job now that the hull carries none.
        t.puff = 0.34;
        t.stack = !t.stack;
        smokers++;
        const ry = t.mesh.rotation.y;
        const lx = (t.stack ? -9.4 : -13.8) * BUILT_SCALE;
        _p.set(t.mesh.position.x + Math.cos(ry) * lx,
               t.mesh.position.y + (t.stack ? 13.2 : 11.8) * BUILT_SCALE,
               t.mesh.position.z - Math.sin(ry) * lx);
        fx.smoke(_p, t.stack ? 4.4 : 3.6, 0x24242C, 14);
      }

      /* Wrecks that are still going.

         Both lists are walked whether or not they are near, because the
         motion has to keep running; only the particles are held back by
         distance, and only a few sites are allowed to emit in one frame.
         A levelled island otherwise spends the whole budget on scenery and
         leaves nothing for the guns. */
      let emitters = 0;

      for (let i = sinking.length - 1; i >= 0; i--) {
        const t = sinking[i];
        t.sink += dt;
        const k = Math.min(1, t.sink / 7.5);
        // Squared, so she settles slowly and then goes, which is the shape
        // of it. Down past 26 puts the masthead under an opaque sea.
        t.mesh.position.y = t.baseY - 26 * k * k;
        t.mesh.rotation.z = t.roll * k;
        t.mesh.rotation.x = t.pitchOver * k;

        if (k >= 1) {
          scene.remove(t.mesh);
          t.mesh.geometry.dispose();
          t.gone = true;
          sinking.splice(i, 1);
          continue;
        }
        if (!fx || t.sink > 6 || emitters > 6) continue;
        if (Math.abs(t.mesh.position.x - pos.x) > 1800 ||
            Math.abs(t.mesh.position.z - pos.z) > 1800) continue;
        t.puff -= dt;
        if (t.puff > 0) continue;
        t.puff = 0.1;
        emitters++;
        _p.set(t.mesh.position.x + (Math.random() - 0.5) * 30,
               Math.max(1.5, t.mesh.position.y + 6),
               t.mesh.position.z + (Math.random() - 0.5) * 12);
        fx.smoke(_p, 5.5, 0x33333A, 11);
        if (Math.random() < 0.55) fx.fire(_p, 4.5);
      }

      for (const t of burning) {
        t.burn += dt;
        if (!fx || emitters > 8) continue;
        if (Math.abs(t.mesh.position.x - pos.x) > 1100 ||
            Math.abs(t.mesh.position.z - pos.z) > 1100) continue;
        const r = t.baseR;
        // Flames for the first stretch, then it is a smoking ruin for as
        // long as the chunk lives. Flying back over an island you worked
        // over half an hour ago and finding it still smoking is worth more
        // than a bigger fire for ten seconds.
        const alight = t.burn < 16;
        t.puff -= dt;
        if (t.puff > 0) continue;
        t.puff = alight ? 0.1 : 0.5;
        emitters++;
        _p.set(t.mesh.position.x + (Math.random() - 0.5) * r * 1.3,
               t.mesh.position.y + r * 0.3,
               t.mesh.position.z + (Math.random() - 0.5) * r * 1.3);
        if (alight && Math.random() < 0.7) fx.fire(_p, r * 0.42);
        fx.smoke(_p, r * (alight ? 0.5 : 0.36), alight ? 0x3E3A36 : 0x6A665F, alight ? 9 : 6);
      }
    },

    // The effects pool is built after the world, so it arrives late.
    attachEffects(effects) { fx = effects; },

    // Returns 'miss', 'hit' or 'destroyed'. A ship takes several rounds; a
    // building comes down on the first.
    damage(t, amount) {
      if (!t || !t.alive) return 'miss';
      t.hp -= amount;
      if (t.hp > 0) return 'hit';
      t.alive = false;
      const i = targets.indexOf(t);
      if (i >= 0) targets.splice(i, 1);

      if (t.kind === 'ship') {
        // A ship goes down; it does not stop existing. Same mesh, rolling
        // over and settling, and burning the whole way.
        t.sink = 0;
        t.puff = 0;
        t.roll = (Math.random() < 0.5 ? -1 : 1) * (0.55 + Math.random() * 0.5);
        t.pitchOver = (Math.random() < 0.5 ? -1 : 1) * (0.18 + Math.random() * 0.3);
        sinking.push(t);
      } else if (t.rubble) {
        // A building becomes its own ruin, in place, still smoking.
        t.mesh.geometry.dispose();
        t.mesh.geometry = t.rubble;
        t.rubble = null;
        t.burn = 0;
        t.puff = 0;
        burning.push(t);
      } else {
        scene.remove(t.mesh);
        t.mesh.geometry.dispose();
        t.gone = true;
      }
      return 'destroyed';
    },

    // Ground height under a point. The islands are cones, so this is just the
    // cone profile, and it is what keeps you from flying through a hill.
    heightAt: groundHeight,

    /* How far along a ray before it meets something solid.

       The gun pipper needs to know where a round would actually end up,
       and only the world knows what is in the way. Targets and balloons
       are spheres and have a closed form. The ground is a field of
       overlapping cones and has no useful one, so it is marched and then
       bisected: eight halvings put the answer inside a tenth of a unit,
       which is far finer than a pixel at any range this matters at.

       Returns max when it meets nothing, so the caller gets a usable
       point either way rather than having to handle a miss. */
    /* Where a round actually ends up.

       Not a ray. A round falls, and over these distances it falls a long
       way: five units at four hundred, twenty six at nine hundred, sixty
       three at fourteen hundred, by which point a straight line answer is
       not in the same part of the sky. So this flies the thing, with the
       same gravity the real round gets, and reports the first place it
       meets the world.

       Stepped at a twenty sixth of a second, which is about twenty three
       units a step at muzzle speed, and every step is tested as the
       segment it covered rather than as the point it ended at, so nothing
       thinner than a step can be passed through. The crossing is then
       bisected along that last segment, which is straight enough over
       twenty three units for the interpolation to be exact to a fraction
       of a unit. */
    shotHit(from, vel, grav, maxTime, out) {
      const STEP = 1 / 26;
      out.copy(from);

      // Only what is within reach can be struck, and on any given frame
      // almost nothing is. One distance test each up here saves sixty odd
      // segment tests each down there, which over a hundred targets and a
      // frame budget is the difference between free and noticeable.
      const reach = vel.length() * maxTime + 40;
      const near = [];
      for (const tg of targets) {
        if (!tg.alive) continue;
        const r = reach + tg.r;
        if (tg.mesh.position.distanceToSquared(from) < r * r) near.push(tg);
      }
      const nearBalloons = [];
      for (const b of balloons) {
        if (!b.alive) continue;
        const r = reach + b.r + 3;
        if (b.mesh.position.distanceToSquared(from) < r * r) nearBalloons.push(b);
      }
      _s1.copy(from);            // where the round is
      _s2.copy(vel);             // how fast, and which way
      let t = 0;

      while (t < maxTime) {
        _s3.copy(_s1);           // where it was
        _s2.y -= grav * STEP;
        _s1.addScaledVector(_s2, STEP);
        t += STEP;

        // Anything solid, tested against the whole step.
        let struck = null, radius = 0;
        for (const tg of near) {
          if (segDist(_s3.x, _s3.y, _s3.z, _s1.x, _s1.y, _s1.z, tg.mesh.position) <= tg.r) {
            struck = tg.mesh.position; radius = tg.r; break;
          }
        }
        if (!struck) {
          for (const b of nearBalloons) {
            if (segDist(_s3.x, _s3.y, _s3.z, _s1.x, _s1.y, _s1.z, b.mesh.position) <= b.r + 3) {
              struck = b.mesh.position; radius = b.r + 3; break;
            }
          }
        }
        if (struck) {
          // Walk back down the step to where it went in, so the mark sits
          // on the near face rather than somewhere inside.
          let lo = 0, hi = 1;
          for (let k = 0; k < 9; k++) {
            const mid = (lo + hi) * 0.5;
            _s4.lerpVectors(_s3, _s1, mid);
            if (_s4.distanceTo(struck) <= radius) hi = mid; else lo = mid;
          }
          return out.lerpVectors(_s3, _s1, hi);
        }

        if (_s1.y <= groundHeight(_s1.x, _s1.z)) {
          let lo = 0, hi = 1;
          for (let k = 0; k < 9; k++) {
            const mid = (lo + hi) * 0.5;
            _s4.lerpVectors(_s3, _s1, mid);
            if (_s4.y <= groundHeight(_s4.x, _s4.z)) hi = mid; else lo = mid;
          }
          return out.lerpVectors(_s3, _s1, hi);
        }

        out.copy(_s1);
      }
      return out;
    },

    rayHit(from, dir, max) {
      let range = max;

      for (const t of targets) {
        if (!t.alive) continue;
        const d = raySphere(from, dir, t.mesh.position, t.r);
        if (d >= 0 && d < range) range = d;
      }
      for (const b of balloons) {
        if (!b.alive) continue;
        const d = raySphere(from, dir, b.mesh.position, b.r + 3);
        if (d >= 0 && d < range) range = d;
      }

      /* The ground, stepped by how much room there is.

         A fixed step cannot be trusted here. At twenty six units it
         walked straight over the top of a narrow ridge and reported the
         sea two hundred and fifty units beyond it, which for a gunsight
         is worse than useless: it says the rounds clear a hill they are
         about to hit.

         So step by the clearance instead, divided by the fastest that
         clearance can possibly close. The ray falls at most 1 unit per
         unit travelled, and the steepest ground this world can build is a
         lobe at 1.35 (a main cone reaches 0.47, and a lobe is up to 0.86
         of that height across 0.3 of the radius), so clearance closes at
         no more than 2.35 per unit. Stepping by clearance over 2.4 can
         therefore never pass through anything. It is also faster than the
         fixed step was: long strides up high, short ones down among the
         hills, which is where they are needed. */
      const CLOSING = 2.4;
      let prev = 0, d = 0, guard = 0;
      while (d < range && guard++ < 300) {
        const y = from.y + dir.y * d;
        const g = groundHeight(from.x + dir.x * d, from.z + dir.z * d);
        if (d > 0 && y <= g) {
          let lo = prev, hi = d;
          for (let k = 0; k < 9; k++) {
            const mid = (lo + hi) * 0.5;
            if (from.y + dir.y * mid <= groundHeight(from.x + dir.x * mid, from.z + dir.z * mid)) hi = mid;
            else lo = mid;
          }
          return hi;
        }
        prev = d;
        d += Math.max(2.5, Math.min(90, (y - g) / CLOSING));
      }
      return range;
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
