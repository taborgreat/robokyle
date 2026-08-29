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

    /* Brass out of the breech. */
    casing(pos, vel) {
      spawn('box', {
        pos, color: 0xD8A94B,
        vel, grav: 26, spin: rand(-22, 22),
        from: 0.24, to: 0.24,
        life: 1.4, opacity: 1,
      });
    },

    /* A dot of light left behind a round in flight. Spawned every few
       metres rather than every frame, so the trail is a dashed streak with
       a readable length instead of a solid tube. */
    tracer(pos) {
      spawn('sphere', {
        pos, color: 0xFFDE8A,
        from: 0.85, to: 0.08,
        life: 0.3, opacity: 0.95, fadePow: 1.5,
      });
    },

    /* The flash at the muzzle. Short, because a long one reads as a fire. */
    muzzle(pos) {
      // Small. At the old size the outer sphere grew to five units across,
      // which at chase camera distance is wider than the aircraft, and with
      // the guns firing ten times a second one was always alive: the result
      // was a permanent translucent disc sitting over the whole plane.
      spawn('sphere', { pos, color: 0xFFF3C8, from: 0.22, to: 0.85, life: 0.05, opacity: 1 });
      spawn('sphere', { pos, color: 0xFFA83C, from: 0.4, to: 1.5, life: 0.075, opacity: 0.7 });
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
