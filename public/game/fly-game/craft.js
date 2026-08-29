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

/* ===== The crew =====

   Two of them, and they are the same cat twice with different kit, which
   is deliberate: building one animal well and reusing it keeps them
   looking like they came off the same shelf. Same primitives as
   everything else, so they sit in the world rather than on top of it.
   ================================================================== */

const FUR = {
  coat:   0xF2913C,
  light:  0xFFD9A8,   // muzzle, chest, paws
  stripe: 0xD4762A,
  inner:  0xF2A7A0,   // ears
  nose:   0xE8756B,
  eye:    0x2A2622,
  lens:   0x9FD2E8,
  strap:  0x4A3A2A,
};

// Origin at the seat, facing forward along -Z, about 0.8 tall.
function buildCat({ scarf = null, jacket = PAINT.brown } = {}) {
  const c = new THREE.Group();

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), mat(jacket));
  chest.scale.set(1, 1.05, 0.86);
  chest.position.y = 0.19;
  c.add(chest);

  // Paws up on whatever is in front of them, which reads as busy rather
  // than as a passenger.
  const pawGeo = new THREE.SphereGeometry(0.075, 8, 6);
  for (const sx of [-0.15, 0.15]) {
    const paw = new THREE.Mesh(pawGeo, mat(FUR.light));
    paw.position.set(sx, 0.3, -0.21);
    c.add(paw);
  }

  let scarfTail = null;
  if (scarf) {
    const s1 = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.055, 6, 14), mat(scarf));
    s1.rotation.x = Math.PI / 2;
    s1.position.y = 0.36;
    c.add(s1);
    // The trailing end, streaming back. It rides high enough to clear the
    // deck of whatever they are sitting in, or it just vanishes into the hull.
    scarfTail = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.5), mat(scarf));
    scarfTail.position.set(0.05, 0.42, 0.3);
    scarfTail.rotation.x = -0.25;
    c.add(scarfTail);
  }

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.215, 12, 10), mat(FUR.coat));
  head.scale.set(1, 0.95, 0.95);
  head.position.y = 0.55;
  c.add(head);

  // Cheeks, because a round head alone reads as a bear.
  for (const sx of [-0.12, 0.12]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), mat(FUR.light));
    cheek.position.set(sx, 0.48, -0.15);
    c.add(cheek);
  }
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mat(FUR.light));
  muzzle.position.set(0, 0.51, -0.19);
  c.add(muzzle);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), mat(FUR.nose));
  nose.position.set(0, 0.53, -0.235);
  c.add(nose);

  const eyeGeo = new THREE.SphereGeometry(0.042, 8, 6);
  for (const sx of [-0.085, 0.085]) {
    const eye = new THREE.Mesh(eyeGeo, mat(FUR.eye));
    eye.position.set(sx, 0.59, -0.185);
    c.add(eye);
  }

  // Ears: a cone for the ear and a smaller one inside it. Each pair hangs off
  // its own group so the whole ear can pin back in the slipstream, which is
  // most of what sells the idea that they are actually up there.
  const ears = [];
  for (const sx of [-0.125, 0.125]) {
    const e = new THREE.Group();
    e.position.set(sx, 0.63, 0.01);
    e.rotation.z = sx < 0 ? 0.3 : -0.3;
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.16, 5), mat(FUR.coat));
    ear.position.set(0, 0.08, 0.01);
    e.add(ear);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.1, 5), mat(FUR.inner));
    inner.position.set(0, 0.07, -0.025);
    e.add(inner);
    c.add(e);
    ears.push(e);
  }

  // Tabby stripes over the crown.
  for (const z of [0.0, 0.09]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.04), mat(FUR.stripe));
    stripe.position.set(0, 0.735, z);
    c.add(stripe);
  }

  // Goggles, pushed up on the forehead. Both of them wear them.
  const strapBand = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.04), mat(FUR.strap));
  strapBand.position.set(0, 0.655, -0.145);
  strapBand.rotation.x = -0.2;
  c.add(strapBand);
  for (const sx of [-0.1, 0.1]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.022, 6, 12), mat(FUR.strap));
    rim.position.set(sx, 0.655, -0.175);
    rim.rotation.x = -0.2;
    c.add(rim);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.055, 12), mat(FUR.lens));
    lens.position.set(sx, 0.655, -0.183);
    lens.rotation.x = -0.2;
    c.add(lens);
  }

  // The parts worth animating, handed back rather than hunted for later.
  c.userData.ears = ears;
  c.userData.scarfTail = scarfTail;
  return c;
}

/* ===== A sport plane, the default =====

   It carries the pair of them, so it is laid out around the two cockpits
   rather than the other way round: a longer fuselage than a single seater
   needs, the wing pushed forward off their heads, and a gun ring on the
   back for the one who is not flying.
   ================================================================== */

function buildPlane() {
  const g = new THREE.Group();

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 3.5, 6, 14), mat(PAINT.red));
  body.rotation.x = Math.PI / 2;
  g.add(body);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.1, 14), mat(PAINT.red));
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -2.62;
  g.add(nose);

  // High wing, the shape that reads most clearly as a friendly aeroplane. It
  // sits well forward, because parked over the cockpits it hides the crew
  // from exactly the camera angle you spend the whole game looking from.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.18, 1.4), mat(PAINT.cream));
  wing.position.set(0, 0.5, -1.25);
  g.add(wing);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.06, 0.34), mat(PAINT.red));
  stripe.position.set(0, 0.61, -1.6);
  g.add(stripe);

  const strutL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.14), mat(PAINT.cream));
  strutL.position.set(-1.5, 0.24, -1.25);
  g.add(strutL);
  const strutR = strutL.clone(); strutR.position.x = 1.5; g.add(strutR);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.16, 0.9), mat(PAINT.cream));
  tail.position.set(0, 0.2, 2.45);
  g.add(tail);

  // The fin is shorter in chord and sits further back than it otherwise would,
  // to leave the rear gun somewhere to point.
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.15, 0.85), mat(PAINT.red));
  fin.position.set(0, 0.75, 2.62);
  g.add(fin);

  // Propeller: a blurred disc plus blades. The disc is what sells motion at
  // speed, the blades are what stop it looking like a plate when slow.
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), mat(PAINT.navy));
  hub.position.z = -3.22;
  g.add(hub);

  const prop = new THREE.Group();
  prop.position.z = -3.24;
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
  disc.position.z = -3.26;
  g.add(disc);

  // Engine cowling: a ring at the front so the nose is not just a smooth cone.
  const cowl = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.11, 8, 18), mat(PAINT.cream));
  cowl.position.z = -2.95;
  g.add(cowl);

  const exhaustGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.6, 6);
  const exhaustMat = mat(PAINT.dark);
  for (const sx of [-0.42, 0.42]) {
    const ex = new THREE.Mesh(exhaustGeo, exhaustMat);
    ex.rotation.x = Math.PI / 2;
    ex.position.set(sx, -0.22, -2.4);
    g.add(ex);
  }

  /* --- Two cockpits, both open ---

     Open on purpose. The goggles and the scarf are the whole reason for
     putting anyone in there, and a canopy would drop a sheet of grey glass
     over both of them. */

  const FRONT = -0.05;
  const REAR = 1.15;

  // A coaming ring of radius 0.34 lands flush on a fuselage of radius 0.62 at
  // this height, so the rim sits in the skin instead of hovering over it.
  const rimGeo = new THREE.TorusGeometry(0.34, 0.05, 6, 18);
  for (const z of [FRONT, REAR]) {
    const rim = new THREE.Mesh(rimGeo, mat(PAINT.brown));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 0.56, z);
    g.add(rim);
  }

  // Windscreen: half a cone, open toward the nose, so it wraps the pilot
  // rather than standing up in front of him like a pane.
  const screen = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.36, 0.34, 14, 1, true, Math.PI / 2, Math.PI),
    new THREE.MeshLambertMaterial({
      color: PAINT.glass, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
    })
  );
  screen.position.set(0, 0.68, FRONT - 0.39);
  screen.rotation.x = -0.16;
  g.add(screen);

  const pilot = buildCat({ scarf: PAINT.cream, jacket: PAINT.brown });
  pilot.position.set(0, 0.24, FRONT);
  g.add(pilot);

  /* --- The gunner's ring ---

     A rail around the rear cockpit with the gun riding it on a pintle, and
     the gunner parented to the same mount, so he turns bodily with the
     weapon instead of watching it swing past him. He gets no scarf: facing
     aft, the tail of one would stream forward, which looks wrong in a way
     you notice immediately. */

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 6, 20), mat(PAINT.steel));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, 0.58, REAR);
  g.add(ring);

  const mount = new THREE.Group();
  mount.position.set(0, 0.24, REAR);
  g.add(mount);

  const gunner = buildCat({ jacket: PAINT.navy });
  mount.add(gunner);

  // The pintle rides the rail at its full radius. That offset is what makes
  // the sweep read as the gun travelling round the ring rather than spinning
  // on a spot in mid air.
  const pintle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.34, 6), mat(PAINT.steel));
  pintle.position.set(0, 0.3, -0.34);
  mount.add(pintle);

  const barrels = new THREE.Group();
  barrels.position.set(0, 0.44, -0.34);
  mount.add(barrels);

  const breech = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.42), mat(PAINT.dark));
  barrels.add(breech);

  const rearGunGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.95, 6);
  for (const sx of [-0.055, 0.055]) {
    const barrel = new THREE.Mesh(rearGunGeo, mat(PAINT.dark));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(sx, 0.02, -0.63);
    barrels.add(barrel);
  }

  // Pan magazine on top. One small part, and the gun stops being two pipes.
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.055, 12), mat(PAINT.steel));
  drum.position.set(0, 0.12, -0.24);
  barrels.add(drum);

  // Grips, put where the paws already are so he is holding the thing.
  const gripGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.14, 5);
  for (const sx of [-0.15, 0.15]) {
    const grip = new THREE.Mesh(gripGeo, mat(PAINT.brown));
    grip.position.set(sx, -0.08, 0.16);
    grip.rotation.x = 0.4;
    barrels.add(grip);
  }

  // Panel seams down the fuselage, kept out of the two cockpit bays.
  const seamMat = mat(0xC9553F);
  for (const z of [-2.0, 0.55, 1.9]) {
    const seam = new THREE.Mesh(new THREE.TorusGeometry(0.63, 0.025, 5, 16), seamMat);
    seam.position.z = z;
    g.add(seam);
  }

  // Navigation lights: red on the left wing, green on the right, which is
  // the way round they actually go.
  const lampGeo = new THREE.SphereGeometry(0.11, 8, 6);
  const lampL = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xFF4438 }));
  lampL.position.set(-3.66, 0.5, -1.25); g.add(lampL);
  const lampR = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0x46E06A }));
  lampR.position.set(3.66, 0.5, -1.25); g.add(lampR);

  // A torus lies in the XY plane by default, which puts the wheel across the
  // aircraft like a barrel. Turned a quarter about Y so the axle runs side to
  // side and the wheel rolls the way the aircraft travels.
  const wheelGeo = new THREE.TorusGeometry(0.24, 0.1, 6, 12);
  const wheelMat = mat(PAINT.dark);
  const wL = new THREE.Mesh(wheelGeo, wheelMat);
  wL.position.set(-0.8, -0.72, -1.2); wL.rotation.y = Math.PI / 2; g.add(wL);
  const wR = new THREE.Mesh(wheelGeo, wheelMat);
  wR.position.set(0.8, -0.72, -1.2); wR.rotation.y = Math.PI / 2; g.add(wR);

  // Gear legs, so the wheels are attached to something.
  const legGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.6, 5);
  for (const sx of [-0.8, 0.8]) {
    const leg = new THREE.Mesh(legGeo, mat(PAINT.steel));
    leg.position.set(sx, -0.42, -1.2);
    leg.rotation.z = sx < 0 ? 0.25 : -0.25;
    g.add(leg);
  }

  // Tail wheel.
  const tailWheel = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.055, 5, 10), wheelMat);
  tailWheel.position.set(0, -0.42, 2.6);
  tailWheel.rotation.y = Math.PI / 2;
  g.add(tailWheel);

  // The guns the muzzle flash comes out of, tucked under the wing.
  const gunGeo = new THREE.CylinderGeometry(0.055, 0.055, 1.1, 6);
  for (const sx of [-1.1, 1.1]) {
    const gun = new THREE.Mesh(gunGeo, mat(PAINT.dark));
    gun.rotation.x = Math.PI / 2;
    gun.position.set(sx, 0.36, -1.7);
    g.add(gun);
  }

  let t = 0;

  return {
    group: g,
    muzzle: new THREE.Vector3(0, 0.36, -2.3),
    guns: [new THREE.Vector3(-1.1, 0.36, -2.3), new THREE.Vector3(1.1, 0.36, -2.3)],
    eject: new THREE.Vector3(0.6, 0.2, -1.4),
    update(dt, s) {
      t += dt;
      prop.rotation.z += (16 + s.throttle * 40) * dt;
      disc.material.opacity = 0.1 + s.throttle * 0.22;

      // The gunner works the ring on his own. Two sines rather than one, so
      // the sweep never settles into a rhythm you can predict.
      const yaw = Math.sin(t * 0.5) * 0.75 + Math.sin(t * 0.21) * 0.3;
      mount.rotation.y = Math.PI + yaw;

      // And he does not shoot the fin off. The fin only blocks a narrow arc,
      // about a tenth of a turn either side of dead astern, but inside it the
      // barrels have to ride steeply high to clear the top; past it they swing
      // wide of the tail on their own and can come back down. The window is
      // deliberately wider than the arc that is actually blocked, because the
      // twin barrels sit off the centre line and one of them stays over the
      // fin for longer than the mount does.
      const astern = Math.max(0, 1 - Math.abs(yaw) / 0.85);
      barrels.rotation.x = 0.28 + astern * 0.82 + Math.sin(t * 0.7) * 0.06;

      // Both of them lean into the turn, which means against the aircraft's
      // own lean. The gunner is mounted backwards, so his lean is too.
      const lean = Math.max(-0.32, Math.min(0.32, -(s.roll || 0) * 0.55));
      pilot.rotation.z = lean;
      gunner.rotation.z = -lean * 0.6;

      // Head down over the sight while the guns are going.
      const duck = s.firing ? 0.1 : 0;
      pilot.rotation.x += (duck - pilot.rotation.x) * Math.min(1, 8 * dt);

      // Ears and scarf in the slipstream. Flat out pins the ears back; the
      // scarf keeps snapping about at any speed, which is the bit of movement
      // that stops the pair of them reading as ornaments.
      const rush = Math.min(1, (s.speed || 0) / 110);
      for (const cat of [pilot, gunner]) {
        for (const ear of cat.userData.ears) {
          ear.rotation.x = rush * 0.5 + Math.sin(t * 11 + ear.position.x * 9) * 0.05 * rush;
        }
        const sc = cat.userData.scarfTail;
        if (sc) {
          sc.rotation.x = -0.25 - rush * 0.35;
          sc.rotation.y = Math.sin(t * 7.5) * 0.22 * (0.3 + rush);
        }
      }
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
    handling: { turn: 1.0, cruise: 71, top: 110, lift: 1.0, scale: 1.15 },
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
