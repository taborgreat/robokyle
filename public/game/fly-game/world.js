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
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

// Clone a shared geometry, place it, and paint every vertex one colour so a
// whole chunk can collapse into one mesh with one material.
function piece(geo, color, x, y, z, sx, sy, sz, rotY) {
  _e.set(0, rotY || 0, 0);
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

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(CHUNK * 24, CHUNK * 24, 1, 1),
    new THREE.MeshLambertMaterial({ color: C.sea })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = SEA_LEVEL;
  scene.add(sea);

  /* ===== chunk building ===== */

  function buildChunk(cx, cz) {
    const rnd = rngFrom(seedFor(cx, cz));
    const ox = cx * CHUNK;
    const oz = cz * CHUNK;

    const landParts = [];
    const cloudParts = [];
    const localIslands = [];
    const localBalloons = [];

    // Islands. Not every chunk gets one, or the sea stops being sea.
    const islandCount = rnd() < 0.62 ? 1 + (rnd() < 0.3 ? 1 : 0) : 0;
    for (let i = 0; i < islandCount; i++) {
      const ix = ox + (rnd() - 0.5) * CHUNK * 0.8;
      const iz = oz + (rnd() - 0.5) * CHUNK * 0.8;
      const r  = 55 + rnd() * 130;
      const h  = 22 + rnd() * 95;

      landParts.push(piece(GEO.beach, C.sand, ix, -3, iz, r * 1.18, 8, r * 1.18, 0));
      landParts.push(piece(GEO.hill, rnd() < 0.5 ? C.grass : C.grass2,
                           ix, h / 2 - 2, iz, r, h, r, rnd() * 6.28));

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
        const ty = Math.max(2, h * (1 - d / r) * 0.82);
        const th = 10 + rnd() * 12;
        landParts.push(piece(GEO.trunk, C.trunk, tx, ty + th * 0.3, tz, th * 0.5, th * 0.7, th * 0.5, 0));
        landParts.push(piece(GEO.leaf, rnd() < 0.5 ? C.leaf : C.leaf2,
                             tx, ty + th * 0.95, tz, th * 0.42, th * 0.9, th * 0.42, rnd() * 6.28));
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

    return { land, cloud, islands: localIslands, balloons: localBalloons };
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
    chunks.delete(key);
  }

  return {
    balloons,
    islands,
    CHUNK,
    VIEW,

    // Keep the sky and sea centred on the player so neither ever runs out,
    // and stream chunks in and out around them.
    update(pos, dt) {
      sky.position.copy(pos);
      sea.position.x = pos.x;
      sea.position.z = pos.z;

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
