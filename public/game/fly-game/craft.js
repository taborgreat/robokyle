/* ==================================================================
   Fly Game, the things you fly.

   Built from primitives on purpose. The look we are after is bright,
   rounded and readable at a glance rather than realistic, so smooth
   shaded capsules and boxes in flat colours get closer to it than a
   detailed model would, and they cost nothing to load.

   Each craft returns a group plus an update() for whatever moves on
   it: a propeller disc, a pair of wings, an afterburner. The flight
   numbers live here too, because how a thing handles is part of what
   it is.
   ================================================================== */

import * as THREE from 'three';

const mat = (color, opts = {}) =>
  new THREE.MeshLambertMaterial({ color, ...opts });

const PAINT = {
  red:    0xE2402F,
  cream:  0xF7F1E3,
  navy:   0x2C3E68,
  glass:  0x2A3F55,
  steel:  0xB9C4CC,
  gold:   0xE8B444,
  brown:  0x6B4A2F,
  tan:    0xB98A55,
  jet:    0x5B6670,
  dark:   0x37414A,
  flame:  0xFFB13D,
};

/* ===== A sport plane, the default ===== */

function buildPlane() {
  const g = new THREE.Group();

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 2.5, 6, 14), mat(PAINT.red));
  body.rotation.x = Math.PI / 2;
  g.add(body);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.1, 14), mat(PAINT.red));
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -2.1;
  g.add(nose);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), mat(PAINT.glass));
  canopy.scale.set(1, 0.72, 1.7);
  canopy.position.set(0, 0.46, -0.15);
  g.add(canopy);

  // High wing, the shape that reads most clearly as a friendly aeroplane.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.18, 1.5), mat(PAINT.cream));
  wing.position.set(0, 0.5, -0.1);
  g.add(wing);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.06, 0.34), mat(PAINT.red));
  stripe.position.set(0, 0.61, -0.5);
  g.add(stripe);

  const strutL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.14), mat(PAINT.cream));
  strutL.position.set(-1.5, 0.24, 0);
  g.add(strutL);
  const strutR = strutL.clone(); strutR.position.x = 1.5; g.add(strutR);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.16, 0.9), mat(PAINT.cream));
  tail.position.set(0, 0.2, 1.85);
  g.add(tail);

  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.15, 1.0), mat(PAINT.red));
  fin.position.set(0, 0.75, 2.0);
  g.add(fin);

  // Propeller: a blurred disc plus blades. The disc is what sells motion at
  // speed, the blades are what stop it looking like a plate when slow.
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), mat(PAINT.navy));
  hub.position.z = -2.7;
  g.add(hub);

  const prop = new THREE.Group();
  prop.position.z = -2.72;
  const bladeGeo = new THREE.BoxGeometry(0.16, 2.5, 0.06);
  const bladeMat = mat(PAINT.navy);
  const b1 = new THREE.Mesh(bladeGeo, bladeMat);
  const b2 = new THREE.Mesh(bladeGeo, bladeMat);
  b2.rotation.z = Math.PI / 2;
  prop.add(b1, b2);
  g.add(prop);

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.3, 20),
    new THREE.MeshBasicMaterial({ color: 0xDCE6EE, transparent: true, opacity: 0.16, side: THREE.DoubleSide })
  );
  disc.position.z = -2.74;
  g.add(disc);

  // Engine cowling: a ring at the front so the nose is not just a smooth cone.
  const cowl = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.11, 8, 18), mat(PAINT.cream));
  cowl.position.z = -2.4;
  g.add(cowl);

  const exhaustGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.6, 6);
  const exhaustMat = mat(PAINT.dark);
  for (const sx of [-0.42, 0.42]) {
    const ex = new THREE.Mesh(exhaustGeo, exhaustMat);
    ex.rotation.x = Math.PI / 2;
    ex.position.set(sx, -0.22, -1.7);
    g.add(ex);
  }

  // A pilot, visible through the canopy. One of those details you only
  // notice when it is missing.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), mat(0xE8C49A));
  head.position.set(0, 0.42, -0.05);
  g.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(PAINT.brown));
  cap.position.set(0, 0.46, -0.05);
  g.add(cap);

  // Navigation lights: red on the left wing, green on the right, which is
  // the way round they actually go.
  const lampGeo = new THREE.SphereGeometry(0.11, 8, 6);
  const lampL = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xFF4438 }));
  lampL.position.set(-3.66, 0.5, -0.1); g.add(lampL);
  const lampR = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0x46E06A }));
  lampR.position.set(3.66, 0.5, -0.1); g.add(lampR);

  // Panel seams down the fuselage.
  const seamMat = mat(0xC9553F);
  for (const z of [-1.2, 0.1, 1.2]) {
    const seam = new THREE.Mesh(new THREE.TorusGeometry(0.63, 0.025, 5, 16), seamMat);
    seam.position.z = z;
    g.add(seam);
  }

  const wheelGeo = new THREE.TorusGeometry(0.24, 0.1, 6, 12);
  const wheelMat = mat(PAINT.dark);
  const wL = new THREE.Mesh(wheelGeo, wheelMat); wL.position.set(-0.8, -0.72, -0.5); g.add(wL);
  const wR = new THREE.Mesh(wheelGeo, wheelMat); wR.position.set(0.8, -0.72, -0.5); g.add(wR);

  // Gear legs, so the wheels are attached to something.
  const legGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.6, 5);
  for (const sx of [-0.8, 0.8]) {
    const leg = new THREE.Mesh(legGeo, mat(PAINT.steel));
    leg.position.set(sx, -0.42, -0.5);
    leg.rotation.z = sx < 0 ? 0.25 : -0.25;
    g.add(leg);
  }

  // Tail wheel.
  const tailWheel = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.055, 5, 10), wheelMat);
  tailWheel.position.set(0, -0.42, 2.0);
  g.add(tailWheel);

  // The guns the muzzle flash comes out of.
  const gunGeo = new THREE.CylinderGeometry(0.055, 0.055, 1.1, 6);
  for (const sx of [-1.1, 1.1]) {
    const gun = new THREE.Mesh(gunGeo, mat(PAINT.dark));
    gun.rotation.x = Math.PI / 2;
    gun.position.set(sx, 0.42, -1.0);
    g.add(gun);
  }

  return {
    group: g,
    muzzle: new THREE.Vector3(0, 0.42, -1.6),
    guns: [new THREE.Vector3(-1.1, 0.42, -1.6), new THREE.Vector3(1.1, 0.42, -1.6)],
    eject: new THREE.Vector3(0.5, 0.1, -0.6),
    update(dt, s) {
      prop.rotation.z += (16 + s.throttle * 40) * dt;
      disc.material.opacity = 0.1 + s.throttle * 0.22;
    },
  };
}

/* ===== An eagle ===== */

function buildEagle() {
  const g = new THREE.Group();

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.52, 1.9, 6, 12), mat(PAINT.brown));
  body.rotation.x = Math.PI / 2;
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), mat(PAINT.cream));
  head.position.set(0, 0.18, -1.5);
  g.add(head);

  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.6, 8), mat(PAINT.gold));
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.08, -2.0);
  g.add(beak);

  const eyeGeo = new THREE.SphereGeometry(0.07, 8, 6);
  const eyeMat = mat(0x1A1A1A);
  const eL = new THREE.Mesh(eyeGeo, eyeMat); eL.position.set(-0.2, 0.28, -1.72); g.add(eL);
  const eR = new THREE.Mesh(eyeGeo, eyeMat); eR.position.set(0.2, 0.28, -1.72); g.add(eR);

  // Wings pivot at the shoulder so the flap reads as a hinge, not a slide.
  const wingGeo = new THREE.BoxGeometry(3.6, 0.13, 1.5);
  const wingMat = mat(PAINT.tan);

  const shoulderL = new THREE.Group();
  shoulderL.position.set(-0.4, 0.22, -0.2);
  const wingL = new THREE.Mesh(wingGeo, wingMat);
  wingL.position.x = -1.8;
  shoulderL.add(wingL);
  g.add(shoulderL);

  const shoulderR = new THREE.Group();
  shoulderR.position.set(0.4, 0.22, -0.2);
  const wingR = new THREE.Mesh(wingGeo, wingMat);
  wingR.position.x = 1.8;
  shoulderR.add(wingR);
  g.add(shoulderR);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.11, 1.3), mat(PAINT.cream));
  tail.position.set(0, 0.05, 1.7);
  g.add(tail);

  let phase = 0;
  return {
    group: g,
    muzzle: new THREE.Vector3(0, 0, -2.2),
    update(dt, s) {
      // Flaps hard under power and holds a glide when the throttle drops,
      // which is the whole difference between a bird and an aeroplane.
      phase += dt * (1.6 + s.throttle * 4.2);
      const flap = Math.sin(phase) * (0.12 + s.throttle * 0.5);
      shoulderL.rotation.z = -flap;
      shoulderR.rotation.z = flap;
    },
  };
}

/* ===== A fighter jet ===== */

function buildJet() {
  const g = new THREE.Group();

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.46, 4.2, 6, 12), mat(PAINT.jet));
  body.rotation.x = Math.PI / 2;
  g.add(body);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.46, 1.9, 12), mat(PAINT.jet));
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -3.0;
  g.add(nose);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), mat(PAINT.glass));
  canopy.scale.set(1, 0.7, 2.1);
  canopy.position.set(0, 0.36, -1.1);
  g.add(canopy);

  // Delta wing, made from a triangle so the planform is a real delta rather
  // than a box pretending to be one.
  const delta = new THREE.Shape();
  delta.moveTo(0, -1.9);
  delta.lineTo(3.3, 1.9);
  delta.lineTo(0, 1.1);
  const wingGeo = new THREE.ExtrudeGeometry(delta, { depth: 0.14, bevelEnabled: false });
  const wingMat = mat(PAINT.jet);

  const wingR = new THREE.Mesh(wingGeo, wingMat);
  wingR.rotation.x = -Math.PI / 2;
  wingR.position.set(0, 0.07, 0.4);
  g.add(wingR);

  const wingL = new THREE.Mesh(wingGeo, wingMat);
  wingL.rotation.x = -Math.PI / 2;
  wingL.scale.x = -1;
  wingL.position.set(0, 0.07, 0.4);
  g.add(wingL);

  const finGeo = new THREE.BoxGeometry(0.12, 1.0, 1.1);
  const finL = new THREE.Mesh(finGeo, mat(PAINT.dark));
  finL.position.set(-0.5, 0.6, 2.0); finL.rotation.z = 0.2; g.add(finL);
  const finR = new THREE.Mesh(finGeo, mat(PAINT.dark));
  finR.position.set(0.5, 0.6, 2.0); finR.rotation.z = -0.2; g.add(finR);

  const intakeGeo = new THREE.BoxGeometry(0.5, 0.42, 1.6);
  const intakeL = new THREE.Mesh(intakeGeo, mat(PAINT.dark)); intakeL.position.set(-0.6, -0.1, 0.2); g.add(intakeL);
  const intakeR = new THREE.Mesh(intakeGeo, mat(PAINT.dark)); intakeR.position.set(0.6, -0.1, 0.2); g.add(intakeR);

  const burnMat = new THREE.MeshBasicMaterial({ color: PAINT.flame, transparent: true, opacity: 0.85 });
  const burn = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.6, 10), burnMat);
  burn.rotation.x = Math.PI / 2;
  burn.position.z = 3.2;
  g.add(burn);

  return {
    group: g,
    muzzle: new THREE.Vector3(0, -0.2, -3.6),
    update(dt, s) {
      const t = 0.35 + s.throttle;
      burn.scale.set(t, 1, t);
      burn.position.z = 2.9 + s.throttle * 0.9;
      burnMat.opacity = 0.35 + s.throttle * 0.55;
    },
  };
}

/* ==================================================================
   The roster

   `handling` is what the flight model reads. turn is how hard it
   answers the cursor, cruise and top are speed in game units a
   second, and lift is how much the nose holds altitude on its own.
   ================================================================== */

export const CRAFT = {
  plane: {
    name: 'Sport plane',
    blurb: 'Steady and forgiving. Turns wide, holds a line.',
    build: buildPlane,
    handling: { turn: 1.0, cruise: 62, top: 96, lift: 1.0, scale: 1 },
  },
  eagle: {
    name: 'Eagle',
    blurb: 'Turns on a coin. Slower, and it never quite sits still.',
    build: buildEagle,
    handling: { turn: 1.45, cruise: 48, top: 74, lift: 1.25, scale: 1.05 },
  },
  jet: {
    name: 'Fighter jet',
    blurb: 'Fast and heavy. Plan the turn before you need it.',
    build: buildJet,
    handling: { turn: 0.72, cruise: 108, top: 175, lift: 0.85, scale: 1 },
  },
};

export function buildCraft(key) {
  const def = CRAFT[key] || CRAFT.plane;
  const made = def.build();
  made.group.scale.setScalar(def.handling.scale);
  made.handling = def.handling;
  made.key = key;
  return made;
}
