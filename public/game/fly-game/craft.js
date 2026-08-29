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

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

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

   Two of them, and they are the same cat twice in different kit, which
   is deliberate: building one animal well and reusing it keeps them
   looking like they came off the same shelf. The one in front flies it
   and wears the red scarf, the one behind works the gun. Same
   primitives as everything else, so they sit in the world rather than
   on top of it.
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
    // the trailing end, streaming back
    scarfTail = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.5), mat(scarf));
    scarfTail.position.set(0.05, 0.34, 0.3);
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

  // Ears: a cone for the ear and a smaller one inside it. Both hang off a
  // pivot at the base so a twitch turns the whole ear rather than sliding
  // the cone out of its lining.
  const ears = [];
  for (const sx of [-0.125, 0.125]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx, 0.64, 0.02);
    pivot.rotation.z = sx < 0 ? 0.3 : -0.3;
    pivot.userData.rest = pivot.rotation.z;
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.16, 5), mat(FUR.coat));
    ear.position.y = 0.07;
    pivot.add(ear);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.1, 5), mat(FUR.inner));
    inner.position.set(0, 0.06, -0.035);
    pivot.add(inner);
    c.add(pivot);
    ears.push(pivot);
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

  // Offset per cat so two of them never twitch on the same frame.
  let t = Math.random() * 10;

  return {
    group: c,
    update(dt, s) {
      t += dt;
      const throttle = s.throttle || 0;

      // The scarf lies flatter and whips harder the faster you go, which is
      // the cheapest way to make the airflow visible from the cockpit.
      if (scarfTail) {
        scarfTail.rotation.x = -(0.22 + throttle * 0.42) + Math.sin(t * 7.5) * 0.08;
        scarfTail.rotation.y = Math.sin(t * 4.6) * 0.14;
      }

      // Ears flick in a short burst every few seconds rather than waving on
      // a beat, because a steady wobble reads as a mechanism and a flick
      // reads as an animal.
      const flick = Math.max(0, Math.sin(t * 0.9) - 0.94) * 14;
      for (const ear of ears) {
        ear.rotation.z = ear.userData.rest + flick * 0.1 * Math.sign(ear.position.x);
      }

      // And a bob with the engine, small enough to be felt rather than seen.
      head.position.y = 0.55 + Math.sin(t * 11) * 0.006 * (0.4 + throttle);
    },
  };
}

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

  // Open cockpit, moved forward of the wing. A dome here hid the pilot
  // twice over: the glass is opaque, and the wing crosses the top of the
  // fuselage at exactly head height, so anything sitting under a canopy is
  // buried inside the wing. Cut the roof off and put the seat ahead of the
  // leading edge and the cat is the thing you actually look at.
  const coaming = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.065, 6, 16), mat(PAINT.brown));
  coaming.rotation.x = Math.PI / 2;
  coaming.position.set(0, 0.52, -1.05);
  g.add(coaming);

  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.3, 0.05),
    mat(PAINT.glass, { transparent: true, opacity: 0.55 })
  );
  screen.position.set(0, 0.72, -1.42);
  screen.rotation.x = 0.35;
  g.add(screen);

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

  // The pilot. Head and shoulders out of the coaming, paws up on the rim,
  // scarf over the wing behind.
  const pilot = buildCat({ scarf: PAINT.red });
  pilot.group.position.set(0, 0.28, -1.05);
  g.add(pilot.group);

  /* The back seat.

     The gun sits on a ring that the whole seat turns with, so the gunner
     swings round with it and stays behind the sights, rather than facing
     forward while the barrel tracks away on its own. Behind the trailing
     edge, which is the only part of the deck the wing does not cross. */
  const gunRing = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.065, 6, 16), mat(PAINT.brown));
  gunRing.rotation.x = Math.PI / 2;
  gunRing.position.set(0, 0.52, 0.95);
  g.add(gunRing);

  const turret = new THREE.Group();      // yaw, the ring turning
  turret.position.set(0, 0.28, 0.95);
  g.add(turret);

  const gunner = buildCat({ scarf: PAINT.gold, jacket: PAINT.navy });
  turret.add(gunner.group);

  const gunMetal = mat(PAINT.dark);
  const gunSteel = mat(PAINT.steel);

  // The post the whole thing swings on, so the guns are standing on the
  // ring rather than hanging in the air above it.
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.32, 6), gunMetal);
  post.position.set(0, 0.28, -0.26);
  turret.add(post);

  const mount = new THREE.Group();       // pitch, the guns in the ring
  mount.position.set(0, 0.42, -0.26);
  turret.add(mount);

  // A twin mount, the way the rear station on these actually was: two guns
  // side by side on one yoke, firing alternately.
  const bodyGeo   = new THREE.BoxGeometry(0.12, 0.13, 0.42);
  const barrelGeo = new THREE.CylinderGeometry(0.042, 0.042, 1.0, 8);
  const drumGeo   = new THREE.CylinderGeometry(0.115, 0.115, 0.065, 12);
  for (const sx of [-0.11, 0.11]) {
    const gunBody = new THREE.Mesh(bodyGeo, gunMetal);
    gunBody.position.x = sx;
    mount.add(gunBody);
    const barrel = new THREE.Mesh(barrelGeo, gunMetal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(sx, 0, -0.6);
    mount.add(barrel);
    const drum = new THREE.Mesh(drumGeo, gunSteel);
    drum.position.set(sx, 0.13, 0.04);
    mount.add(drum);
  }

  const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.07, 0.13), gunMetal);
  mount.add(yoke);
  const sight = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.014, 5, 12), gunSteel);
  sight.rotation.x = Math.PI / 2;
  sight.position.set(0, 0.11, -0.34);
  mount.add(sight);
  const grips = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.08), mat(PAINT.brown));
  grips.position.set(0, -0.05, 0.24);
  mount.add(grips);

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

  // A torus lies in the XY plane by default, which puts the wheel across the
  // aircraft like a barrel. Turned a quarter about Y so the axle runs side to
  // side and the wheel rolls the way the aircraft travels.
  const wheelGeo = new THREE.TorusGeometry(0.24, 0.1, 6, 12);
  const wheelMat = mat(PAINT.dark);
  const wL = new THREE.Mesh(wheelGeo, wheelMat);
  wL.position.set(-0.8, -0.72, -0.5); wL.rotation.y = Math.PI / 2; g.add(wL);
  const wR = new THREE.Mesh(wheelGeo, wheelMat);
  wR.position.set(0.8, -0.72, -0.5); wR.rotation.y = Math.PI / 2; g.add(wR);

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
  tailWheel.rotation.y = Math.PI / 2;
  g.add(tailWheel);

  // Everything the aircraft fires now comes off this mount, and the mount
  // moves, so these cannot be the constants the wing guns were. update()
  // rewrites them from the two pivots each frame and fire() reads them back
  // out, which is what keeps the tracer leaving the barrel that is pointing
  // at the thing. They start where the guns sit level and forward.
  const gunMuzzles = [new THREE.Vector3(-0.11, 0.7, -0.41), new THREE.Vector3(0.11, 0.7, -0.41)];
  const ejectAt = new THREE.Vector3(0.2, 0.7, 0.79);
  const _tip = new THREE.Vector3();
  const _local = (x, y, z) => _tip.set(x, y, z)
    .applyQuaternion(mount.quaternion).add(mount.position)
    .applyQuaternion(turret.quaternion).add(turret.position);

  return {
    group: g,
    muzzle: gunMuzzles[0],
    guns: gunMuzzles,
    eject: ejectAt,
    update(dt, s) {
      prop.rotation.z += (16 + s.throttle * 40) * dt;
      disc.material.opacity = 0.1 + s.throttle * 0.22;
      pilot.update(dt, s);
      gunner.update(dt, s);

      // The gun goes where the cursor is. s.aim arrives already in the
      // aircraft's own frame, so this is two angles and no projection: yaw
      // swings the ring, pitch lifts the gun inside it. Eased rather than
      // snapped, because a gun on a pintle has weight, and stopped short of
      // straight astern so the gunner never shoots through his own tail.
      if (s.aim) {
        const k = Math.min(1, 9 * dt);
        const wantYaw   = Math.atan2(-s.aim.x, -s.aim.z);
        const wantPitch = Math.asin(clamp(s.aim.y, -1, 1));
        turret.rotation.y += (clamp(wantYaw, -1.3, 1.3) - turret.rotation.y) * k;
        mount.rotation.x  += (clamp(wantPitch, -0.45, 1.0) - mount.rotation.x) * k;
      }

      // Both barrel tips and the ejection port, back through the two pivots
      // into the aircraft's frame.
      gunMuzzles[0].copy(_local(-0.11, 0, -1.1));
      gunMuzzles[1].copy(_local(0.11, 0, -1.1));
      ejectAt.copy(_local(0.22, 0, 0.12));
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
