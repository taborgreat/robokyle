/* ==================================================================
   Fly Game, effects.

   One pooled particle system behind everything that pops, bursts,
   splashes or ejects. Pooled because a crash spawns fifty pieces at
   once and allocating fifty meshes plus fifty materials mid frame is
   exactly where a smooth flight turns into a stutter.

   Each particle owns its material so it can fade on its own. That is
   the one thing worth spending memory on here: shared materials
   would mean every piece of one explosion fading in lockstep.
   ================================================================== */

import * as THREE from 'three';

const GEO = {
  box:    new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 8, 6),
  shard:  new THREE.TetrahedronGeometry(1, 0),
  ring:   new THREE.RingGeometry(0.75, 1, 24),
};

const MAX = 420;

export function createEffects(scene) {
  const pool = [];
  const live = [];

  function make(kind) {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(GEO[kind], mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh, mat, kind, life: 0 };
  }

  function take(kind) {
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].kind === kind) return pool.splice(i, 1)[0];
    }
    if (pool.length + live.length >= MAX) {
      // Budget reached: steal the oldest rather than grow without limit.
      const oldest = live.shift();
      if (oldest) { oldest.mesh.visible = false; oldest.mesh.geometry = GEO[kind]; oldest.kind = kind; return oldest; }
    }
    return make(kind);
  }

  function spawn(kind, opts) {
    const p = take(kind);
    p.mesh.geometry = GEO[kind];
    p.mat.color.setHex(opts.color);
    p.mat.opacity = opts.opacity == null ? 1 : opts.opacity;
    p.mesh.position.copy(opts.pos);
    p.mesh.rotation.set(
      opts.rot ? opts.rot.x : Math.random() * 6.28,
      opts.rot ? opts.rot.y : Math.random() * 6.28,
      opts.rot ? opts.rot.z : Math.random() * 6.28
    );
    p.vel = opts.vel || new THREE.Vector3();
    p.grav = opts.grav || 0;
    p.drag = opts.drag || 0;
    p.spin = opts.spin || 0;
    p.from = opts.from == null ? 1 : opts.from;
    p.to = opts.to == null ? p.from : opts.to;
    p.life = p.max = opts.life;
    p.flat = !!opts.flat;      // lie the ring flat on the water
    p.fadePow = opts.fadePow || 1;
    p.mesh.scale.setScalar(p.from);
    if (p.flat) p.mesh.rotation.set(-Math.PI / 2, 0, 0);
    p.mesh.visible = true;
    live.push(p);
    return p;
  }

  const _v = new THREE.Vector3();

  function rand(a, b) { return a + Math.random() * (b - a); }
  function dir(spread) {
    return new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(spread);
  }

  return {
    /* A crash into land: flash, fire, debris, and smoke that outlives it. */
    explosion(pos) {
      spawn('sphere', { pos, color: 0xFFF3C4, from: 1, to: 17, life: 0.3, opacity: 1, fadePow: 1.6 });
      spawn('sphere', { pos, color: 0xFF9A3C, from: 2, to: 26, life: 0.55, opacity: 0.9, fadePow: 1.4 });

      for (let i = 0; i < 22; i++) {
        spawn('box', {
          pos, color: i % 3 === 0 ? 0xE2402F : 0x4A4A4A,
          vel: dir(rand(14, 46)).add(_v.set(0, rand(6, 22), 0)),
          grav: 32, spin: rand(-9, 9),
          from: rand(0.5, 1.7), to: rand(0.4, 1.2),
          life: rand(1.1, 2.2),
        });
      }
      for (let i = 0; i < 14; i++) {
        spawn('sphere', {
          pos, color: 0x6E6E6E,
          vel: dir(rand(4, 16)).add(_v.set(0, rand(4, 12), 0)),
          grav: -2.5, drag: 0.9,
          from: rand(1.5, 3.5), to: rand(6, 12),
          life: rand(1.4, 2.6), opacity: 0.55,
        });
      }
      for (let i = 0; i < 10; i++) {
        spawn('sphere', {
          pos, color: 0xFFC24A,
          vel: dir(rand(8, 26)),
          grav: 6, drag: 1.4,
          from: rand(1.5, 3.5), to: 0.2,
          life: rand(0.35, 0.8),
        });
      }
    },

    /* A crash into water: a ring on the surface, a column, and spray. */
    splash(pos) {
      const at = pos.clone(); at.y = 0.6;

      spawn('ring', { pos: at, color: 0xEAF6FF, flat: true, from: 3, to: 46, life: 1.0, opacity: 0.85 });
      spawn('ring', { pos: at, color: 0xBBDFF5, flat: true, from: 2, to: 30, life: 0.7, opacity: 0.7 });

      for (let i = 0; i < 30; i++) {
        const v = dir(rand(10, 30));
        v.y = Math.abs(v.y) + rand(14, 34);
        spawn('sphere', {
          pos: at, color: i % 4 === 0 ? 0xFFFFFF : 0xCFEAF7,
          vel: v, grav: 42, drag: 0.2,
          from: rand(0.6, 2.0), to: rand(0.3, 1.0),
          life: rand(0.7, 1.5), opacity: 0.95,
        });
      }
      for (let i = 0; i < 10; i++) {
        spawn('sphere', {
          pos: at, color: 0xFFFFFF,
          vel: dir(rand(3, 12)).add(_v.set(0, rand(2, 8), 0)),
          grav: 3, drag: 1.1,
          from: rand(2, 5), to: rand(6, 13),
          life: rand(0.8, 1.6), opacity: 0.5,
        });
      }
    },

    /* A balloon giving up. */
    balloonBurst(pos, color) {
      spawn('sphere', { pos, color: 0xFFFFFF, from: 1, to: 13, life: 0.18, opacity: 0.9 });
      for (let i = 0; i < 16; i++) {
        spawn('shard', {
          pos, color,
          vel: dir(rand(10, 30)),
          grav: 16, drag: 0.6, spin: rand(-14, 14),
          from: rand(0.7, 1.9), to: rand(0.3, 0.9),
          life: rand(0.5, 1.1),
        });
      }
    },

    /* A round hitting ground: dirt thrown up, a little dust left behind. */
    impact(pos) {
      spawn('sphere', { pos, color: 0xFFF0C8, from: 0.3, to: 1.1, life: 0.06, opacity: 0.9 });

      for (let i = 0; i < 9; i++) {
        const v = dir(rand(5, 16));
        v.y = Math.abs(v.y) + rand(6, 15);        // always thrown upward
        spawn('shard', {
          pos, color: i % 3 === 0 ? 0x4E9E45 : 0x7A5230,
          vel: v, grav: 30, spin: rand(-16, 16),
          from: rand(0.25, 0.7), to: rand(0.15, 0.4),
          life: rand(0.4, 0.9),
        });
      }
      for (let i = 0; i < 5; i++) {
        spawn('sphere', {
          pos, color: 0xC7B48A,
          vel: dir(rand(2, 7)).add(_v.set(0, rand(2, 6), 0)),
          grav: 2, drag: 1.6,
          from: rand(0.5, 1.2), to: rand(2.2, 4.2),
          life: rand(0.45, 0.9), opacity: 0.5,
        });
      }
    },

    /* A round hitting water: a small ring and a few droplets. */
    ripple(pos) {
      const at = pos.clone(); at.y = 0.5;
      spawn('ring', { pos: at, color: 0xEAF6FF, flat: true, from: 0.6, to: 7, life: 0.5, opacity: 0.7 });
      for (let i = 0; i < 7; i++) {
        const v = dir(rand(3, 9));
        v.y = Math.abs(v.y) + rand(5, 12);
        spawn('sphere', {
          pos: at, color: 0xDCF0FB,
          vel: v, grav: 34,
          from: rand(0.2, 0.5), to: rand(0.1, 0.3),
          life: rand(0.3, 0.6), opacity: 0.9,
        });
      }
    },

    /* A building coming down. Planks and dust rather than a fireball. */
    rubble(pos) {
      spawn('sphere', { pos, color: 0xFFE9BE, from: 1, to: 9, life: 0.16, opacity: 0.85 });
      for (let i = 0; i < 20; i++) {
        const v = dir(rand(8, 24));
        v.y = Math.abs(v.y) + rand(6, 18);
        spawn('box', {
          pos, color: [0xF2E7D2, 0xC1462F, 0x6B4A2F, 0x9C9384][i % 4],
          vel: v, grav: 30, spin: rand(-14, 14),
          from: rand(0.3, 1.1), to: rand(0.25, 0.8),
          life: rand(0.8, 1.7),
        });
      }
      for (let i = 0; i < 8; i++) {
        spawn('sphere', {
          pos, color: 0xC7B48A,
          vel: dir(rand(3, 10)).add(_v.set(0, rand(2, 7), 0)),
          grav: 1.5, drag: 1.2,
          from: rand(1, 2.5), to: rand(5, 10),
          life: rand(0.9, 1.8), opacity: 0.5,
        });
      }
    },

    /* A ship going down: fire, timber, and the water it displaces. */
    wreck(pos) {
      const at = pos.clone(); at.y = Math.max(1.5, pos.y);
      spawn('sphere', { pos: at, color: 0xFFF3C4, from: 1, to: 16, life: 0.28, opacity: 1, fadePow: 1.6 });
      spawn('sphere', { pos: at, color: 0xFF9A3C, from: 2, to: 24, life: 0.5, opacity: 0.9, fadePow: 1.4 });
      spawn('ring', { pos: new THREE.Vector3(at.x, 0.6, at.z), color: 0xEAF6FF,
                      flat: true, from: 4, to: 40, life: 0.9, opacity: 0.8 });

      for (let i = 0; i < 20; i++) {
        const v = dir(rand(10, 30));
        v.y = Math.abs(v.y) + rand(8, 22);
        spawn('box', {
          pos: at, color: [0x5A3A22, 0x6B4A2F, 0xF4EFE2, 0x3A2A1A][i % 4],
          vel: v, grav: 30, spin: rand(-12, 12),
          from: rand(0.4, 1.5), to: rand(0.3, 1.0),
          life: rand(1.0, 2.0),
        });
      }
      for (let i = 0; i < 12; i++) {
        spawn('sphere', {
          pos: at, color: i % 2 ? 0x6E6E6E : 0xCFEAF7,
          vel: dir(rand(4, 14)).add(_v.set(0, rand(4, 12), 0)),
          grav: -1.5, drag: 1.0,
          from: rand(1.5, 3.5), to: rand(6, 12),
          life: rand(1.2, 2.2), opacity: 0.55,
        });
      }
    },

    /* Brass out of the breech. */
    casing(pos, vel) {
      spawn('box', {
        pos, color: 0xD8A94B,
        vel, grav: 26, spin: rand(-22, 22),
        from: 0.11, to: 0.11,
        life: 1.2, opacity: 1,
      });
    },

    /* A dot of light left behind a round in flight. Spawned every few
       metres rather than every frame, so the trail is a dashed streak with
       a readable length instead of a solid tube. */
    tracer(pos) {
      spawn('sphere', {
        pos, color: 0xFFDE8A,
        from: 0.4, to: 0.05,
        life: 0.22, opacity: 0.9, fadePow: 1.5,
      });
    },

    /* The flash at the muzzle. Short, because a long one reads as a fire. */
    muzzle(pos) {
      // Small. At the old size the outer sphere grew to five units across,
      // which at chase camera distance is wider than the aircraft, and with
      // the guns firing ten times a second one was always alive: the result
      // was a permanent translucent disc sitting over the whole plane.
      spawn('sphere', { pos, color: 0xFFF3C8, from: 0.1,  to: 0.34, life: 0.04,  opacity: 1 });
      spawn('sphere', { pos, color: 0xFFA83C, from: 0.16, to: 0.6,  life: 0.055, opacity: 0.62 });
    },

    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i];
        p.life -= dt;
        if (p.life <= 0) {
          p.mesh.visible = false;
          live.splice(i, 1);
          pool.push(p);
          continue;
        }
        const t = 1 - p.life / p.max;
        if (p.vel) {
          p.mesh.position.addScaledVector(p.vel, dt);
          p.vel.y -= p.grav * dt;
          if (p.drag) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
        }
        if (p.spin) { p.mesh.rotation.x += p.spin * dt; p.mesh.rotation.z += p.spin * 0.7 * dt; }
        p.mesh.scale.setScalar(p.from + (p.to - p.from) * t);
        p.mat.opacity = Math.max(0, (1 - Math.pow(t, p.fadePow)));
      }
    },

    // Called on respawn so nothing from the last life is still in the air.
    clear() {
      for (const p of live) { p.mesh.visible = false; pool.push(p); }
      live.length = 0;
    },
  };
}
