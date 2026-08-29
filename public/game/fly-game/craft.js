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

/* ==================================================================
   The fighter, and the default.

   A single engine low wing monoplane with a crew of two, which is the
   shape that lets both of them be seen: the wing passes under the
   fuselage rather than across the top of it, so the cockpits sit on the
   spine with nothing over them, and the pilot sits over the wing rather
   than out in front of it. The front seat is set higher than the back
   one on purpose. From a chase camera the gunner is the nearer of the
   two, and level seats would put his ears through the pilot's face.
   ================================================================== */

function buildPlane() {
  const g = new THREE.Group();

  const redMat   = mat(PAINT.red);
  const creamMat = mat(PAINT.cream);
  const darkMat  = mat(PAINT.dark);
  const steelMat = mat(PAINT.steel);

  /* --- Fuselage: a barrel, a long taper aft, a cowl and a spinner. --- */

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.72, 3.4, 6, 16), redMat);
  body.rotation.x = Math.PI / 2;
  g.add(body);

  // Rear fuselage. A cylinder with two radii is the cheapest taper there
  // is, and the taper is most of what makes this read as a fighter rather
  // than as a tube with wings.
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.72, 1.9, 14), redMat);
  boom.rotation.x = Math.PI / 2;
  boom.position.z = 2.55;
  g.add(boom);

  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.60, 1.5, 16), redMat);
  cowl.rotation.x = Math.PI / 2;
  cowl.position.z = -2.35;
  g.add(cowl);

  const cowlLip = new THREE.Mesh(new THREE.TorusGeometry(0.60, 0.075, 8, 20), creamMat);
  cowlLip.position.z = -3.08;
  g.add(cowlLip);

  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.95, 16), creamMat);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -3.55;
  g.add(spinner);

  // Exhaust stacks down both sides of the cowl. Six a side, which is what
  // twelve cylinders gives you, and they say engine louder than the cowl
  // they are stuck to does.
  const stackGeo = new THREE.BoxGeometry(0.12, 0.11, 0.16);
  for (const sx of [-0.58, 0.58]) {
    for (let i = 0; i < 6; i++) {
      const st = new THREE.Mesh(stackGeo, darkMat);
      st.position.set(sx, 0.24, -2.85 + i * 0.24);
      g.add(st);
    }
  }

  // Oil cooler under the nose and the radiator bath behind the wing, both
  // of which every liquid cooled fighter of the period wore somewhere.
  const oilCooler = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.30, 0.55), darkMat);
  oilCooler.position.set(0, -0.62, -2.3);
  g.add(oilCooler);

  const radiator = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.44, 1.35), creamMat);
  radiator.position.set(0, -0.70, 0.15);
  g.add(radiator);
  const radLip = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.46, 0.10), darkMat);
  radLip.position.set(0, -0.70, -0.5);
  g.add(radLip);

  /* --- Propeller: three blades, because two reads as a trainer. --- */

  const prop = new THREE.Group();
  prop.position.z = -3.95;
  const bladeGeo = new THREE.BoxGeometry(0.2, 3.1, 0.08);
  const bladeMat = mat(PAINT.navy);
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.rotation.z = (i * Math.PI * 2) / 3;
    prop.add(blade);
  }
  g.add(prop);

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.62, 24),
    new THREE.MeshBasicMaterial({ color: 0xDCE6EE, transparent: true, opacity: 0.16, side: THREE.DoubleSide })
  );
  disc.position.z = -3.98;
  g.add(disc);

  /* --- Wing.

     One symmetric polygon across the whole span rather than a panel
     mirrored twice: a mirrored mesh has its winding inverted and can
     render inside out, and a single shape cannot. Tapered, with rounded
     tips. Laid flat, the extrude depth becomes the thickness. --- */

  const plan = new THREE.Shape();
  plan.moveTo(-4.30, 1.50);
  plan.lineTo(-4.25, 1.78);
  plan.lineTo(-3.55, 2.02);
  plan.lineTo(0, 2.30);
  plan.lineTo(3.55, 2.02);
  plan.lineTo(4.25, 1.78);
  plan.lineTo(4.30, 1.50);
  plan.lineTo(4.25, 1.28);
  plan.lineTo(3.55, 1.04);
  plan.lineTo(0, 0.30);
  plan.lineTo(-3.55, 1.04);
  plan.lineTo(-4.25, 1.28);
  plan.closePath();

  const wing = new THREE.Mesh(
    new THREE.ExtrudeGeometry(plan, { depth: 0.18, bevelEnabled: false }),
    creamMat
  );
  wing.rotation.x = -Math.PI / 2;
  wing.position.y = -0.30;
  g.add(wing);

  // Root fillet, blending the wing into the belly the way a fairing does.
  const fillet = new THREE.Mesh(new THREE.SphereGeometry(0.92, 14, 10), redMat);
  fillet.scale.set(1.05, 0.42, 1.5);
  fillet.position.set(0, -0.28, -1.3);
  g.add(fillet);

  // Gear doors, closed. The wheels are up, because a fighter with its
  // legs down in cruise is a fighter about to be shot at.
  const doorGeo = new THREE.BoxGeometry(0.72, 0.06, 1.15);
  for (const sx of [-1.15, 1.15]) {
    const door = new THREE.Mesh(doorGeo, mat(0xE3DCC8));
    door.position.set(sx, -0.33, -1.5);
    g.add(door);
  }

  /* --- Tail. --- */

  const tail = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.16, 1.05), creamMat);
  tail.position.set(0, 0.16, 2.85);
  g.add(tail);

  /* Control surfaces, hinged and worked the way the real ones are.

     Each one hangs off a pivot sitting on its hinge line with the surface
     itself set behind that pivot, so rotating the pivot swings the
     trailing edge and leaves the leading edge where it is. Rotating the
     box about its own middle instead would make it slide rather than
     hinge, which is the tell that stops it looking mechanical.

     Signs are the aerodynamics, not a preference. Elevator trailing edge
     up pushes the tail down and the nose up, so a nose up command deflects
     them up. Rudder trailing edge goes the way the nose is going. Ailerons
     work in opposition, and the one on the inside of the turn goes up:
     less lift that side, so that wing drops and the aircraft rolls into
     the turn rather than out of it. */
  const surfMat = mat(0xE9E2D2);
  const elevators = [];
  for (const sx of [-0.82, 0.82]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx, 0.16, 3.12);
    const surf = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.1, 0.36), surfMat);
    surf.position.z = 0.18;
    pivot.add(surf);
    g.add(pivot);
    elevators.push(pivot);
  }

  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.15, 1.30), redMat);
  fin.position.set(0, 0.75, 2.95);
  g.add(fin);

  const rudder = new THREE.Group();
  rudder.position.set(0, 0.68, 3.35);
  const rudderSurf = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.95, 0.42), creamMat);
  rudderSurf.position.z = 0.21;
  rudder.add(rudderSurf);
  g.add(rudder);

  // Ailerons, outboard on the trailing edge. The wing tapers, so the hinge
  // line out here is further forward than it is at the root.
  const ailerons = [];
  for (const sx of [-2.85, 2.85]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx, -0.21, -0.92);
    const surf = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.09, 0.34), surfMat);
    surf.position.z = 0.17;
    pivot.add(surf);
    g.add(pivot);
    ailerons.push(pivot);
  }

  const tailLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.28, 6), steelMat);
  tailLeg.position.set(0, -0.46, 3.15);
  g.add(tailLeg);
  const tailWheel = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.06, 6, 10), darkMat);
  tailWheel.position.set(0, -0.63, 3.15);
  tailWheel.rotation.y = Math.PI / 2;
  g.add(tailWheel);

  /* --- Markings and seams. --- */

  const seamMat = mat(0xC9553F);
  for (const z of [-1.15, 0.5, 1.6]) {
    const seam = new THREE.Mesh(new THREE.TorusGeometry(0.735, 0.03, 5, 18), seamMat);
    seam.position.z = z;
    g.add(seam);
  }

  const band = new THREE.Mesh(new THREE.TorusGeometry(0.70, 0.07, 6, 18), creamMat);
  band.position.z = 2.1;
  g.add(band);

  // Roundels: on top of both wings and on both flanks. The wing pair sit
  // a hair proud of the surface so they cannot fight it for depth.
  const roundelOuter = mat(PAINT.navy);
  const roundelInner = mat(PAINT.red);
  for (const sx of [-2.3, 2.3]) {
    const outer = new THREE.Mesh(new THREE.CircleGeometry(0.44, 20), roundelOuter);
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(sx, -0.105, -1.45);
    g.add(outer);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.19, 16), roundelInner);
    inner.rotation.x = -Math.PI / 2;
    inner.position.set(sx, -0.10, -1.45);
    g.add(inner);
  }
  for (const side of [-1, 1]) {
    const flank = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.05, 18), roundelOuter);
    flank.rotation.z = Math.PI / 2;
    flank.position.set(side * 0.68, 0.02, 1.85);
    g.add(flank);
    const pip = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 14), creamMat);
    pip.rotation.z = Math.PI / 2;
    pip.position.set(side * 0.70, 0.02, 1.85);
    g.add(pip);
  }

  // Navigation lights, red to port and green to starboard, and a pitot
  // under the right wing.
  const lampGeo = new THREE.SphereGeometry(0.13, 8, 6);
  const lampL = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xFF4438 }));
  lampL.position.set(-4.3, -0.2, -1.55); g.add(lampL);
  const lampR = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0x46E06A }));
  lampR.position.set(4.3, -0.2, -1.55); g.add(lampR);

  const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 6), steelMat);
  pitot.rotation.x = Math.PI / 2;
  pitot.position.set(2.7, -0.34, -2.5);
  g.add(pitot);

  /* Wingtip vortices.

     Air spilling round the end of a wing rolls into a corkscrew and trails
     behind it, tight at the tip and spreading as it goes, which is why
     these are cones with the narrow end forward rather than tubes. Two per
     side: a bright core and a wider, fainter sheath around it.

     They come and go with load, not with speed, which is the real
     behaviour and also the more useful one: they are barely there in
     cruise and they stream off both tips in a hard turn, so the aircraft
     tells you how hard you are pulling without a gauge. */
  const vortexMat = new THREE.MeshBasicMaterial({
    color: 0xFFFFFF, transparent: true, opacity: 0, depthWrite: false,
    side: THREE.DoubleSide,
  });
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xEAF4FF, transparent: true, opacity: 0, depthWrite: false,
    side: THREE.DoubleSide,
  });
  const streams = [];
  for (const sx of [-4.28, 4.28]) {
    const trail = new THREE.Group();
    trail.position.set(sx, -0.2, -1.35);

    const sheath = new THREE.Mesh(new THREE.ConeGeometry(0.5, 7.4, 7, 1, true), vortexMat);
    // A cone points along +Y; a quarter turn about X lays it down the
    // fuselage, tip forward at the wingtip and mouth trailing aft.
    sheath.rotation.x = -Math.PI / 2;
    sheath.position.z = 3.7;
    trail.add(sheath);

    const core = new THREE.Mesh(new THREE.ConeGeometry(0.17, 5.4, 6, 1, true), coreMat);
    core.rotation.x = -Math.PI / 2;
    core.position.z = 2.7;
    trail.add(core);

    trail.userData.side = Math.sign(sx);
    g.add(trail);
    streams.push(trail);
  }

  /* --- Front office.

     Open, and sat over the wing rather than ahead of it. No glass roof
     over either seat: on a model this size a closed canopy hides the
     crew, and the crew is the point. --- */

  const coaming = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.075, 6, 18), mat(PAINT.brown));
  coaming.rotation.x = Math.PI / 2;
  coaming.position.set(0, 0.58, -1.3);
  g.add(coaming);

  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.44, 0.06),
    mat(PAINT.glass, { transparent: true, opacity: 0.5 })
  );
  screen.position.set(0, 1.06, -1.82);
  screen.rotation.x = 0.32;
  g.add(screen);

  const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.14), mat(PAINT.brown));
  headrest.position.set(0, 1.12, -0.94);
  g.add(headrest);

  // Turtledeck between the two cockpits, kept low enough to pass under
  // the guns when they are level.
  const deck = new THREE.Mesh(new THREE.SphereGeometry(0.44, 12, 8), redMat);
  deck.scale.set(0.95, 0.45, 1.5);
  deck.position.set(0, 0.52, -0.7);
  g.add(deck);

  const pilot = buildCat({ scarf: PAINT.red });
  pilot.group.position.set(0, 0.52, -1.3);
  pilot.group.scale.setScalar(1.35);
  g.add(pilot.group);

  /* --- Back office.

     The guns ride a ring the whole seat turns with, so the gunner swings
     round with them and stays behind the sights. The barrels are short
     on purpose: long enough to read as guns, short enough that pointing
     them straight ahead stops them well behind the pilot. --- */

  const gunRing = new THREE.Mesh(new THREE.TorusGeometry(0.50, 0.07, 6, 18), mat(PAINT.brown));
  gunRing.rotation.x = Math.PI / 2;
  gunRing.position.set(0, 0.50, 1.0);
  g.add(gunRing);

  const turret = new THREE.Group();      // yaw, the ring turning
  turret.position.set(0, 0.36, 1.0);
  g.add(turret);

  const gunner = buildCat({ scarf: PAINT.gold, jacket: PAINT.navy });
  gunner.group.scale.setScalar(1.35);
  turret.add(gunner.group);

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.58, 6), darkMat);
  post.position.set(0, 0.41, -0.55);
  turret.add(post);

  const mount = new THREE.Group();       // pitch, the guns in the ring
  mount.position.set(0, 0.68, -0.55);
  turret.add(mount);

  // A twin flexible mount, the way the rear station on these actually
  // was: two guns side by side on one yoke, firing alternately.
  const gunBodyGeo = new THREE.BoxGeometry(0.15, 0.16, 0.50);
  const barrelGeo  = new THREE.CylinderGeometry(0.05, 0.05, 0.75, 8);
  const drumGeo    = new THREE.CylinderGeometry(0.15, 0.15, 0.08, 12);
  for (const sx of [-0.16, 0.16]) {
    const gunBody = new THREE.Mesh(gunBodyGeo, darkMat);
    gunBody.position.set(sx, 0, 0.02);
    mount.add(gunBody);
    const barrel = new THREE.Mesh(barrelGeo, darkMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(sx, 0, -0.45);
    mount.add(barrel);
    const drum = new THREE.Mesh(drumGeo, steelMat);
    drum.position.set(sx, 0.17, 0.08);
    mount.add(drum);
  }
  const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.09, 0.16), darkMat);
  mount.add(yoke);
  const sight = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 5, 12), steelMat);
  sight.rotation.x = Math.PI / 2;
  sight.position.set(0, 0.15, -0.42);
  mount.add(sight);
  const grips = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.16, 0.09), mat(PAINT.brown));
  grips.position.set(0, -0.13, 0.25);
  mount.add(grips);

  /* --- What fires, and from where. --- */

  // Everything the aircraft fires comes off this mount, and the mount
  // moves, so these cannot be the constants a wing gun would be.
  // update() rewrites them from the two pivots each frame and fire()
  // reads them back out, which is what keeps the tracer leaving the
  // barrel that is pointing at the thing. They start level and forward.
  // Eased control positions, and the eased load the vortices read.
  const surf = { pitch: 0, yaw: 0, pull: 0 };

  const gunMuzzles = [new THREE.Vector3(-0.16, 1.04, -0.375), new THREE.Vector3(0.16, 1.04, -0.375)];
  const ejectAt = new THREE.Vector3(0.3, 1.04, 0.63);
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

      /* The surfaces follow the stick. Eased, because a control surface
         has a pilot on the end of it rather than a switch, and because
         snapping to the input makes them flicker on a shaky cursor. */
      const px = s.pitch || 0, yx = s.yaw || 0;
      const ck = Math.min(1, 11 * dt);
      surf.pitch += (px - surf.pitch) * ck;
      surf.yaw += (yx - surf.yaw) * ck;

      for (const e of elevators) e.rotation.x = -surf.pitch * 0.44;
      rudder.rotation.y = surf.yaw * 0.4;
      ailerons[0].rotation.x = -surf.yaw * 0.4;    // port, down in a right turn
      ailerons[1].rotation.x = surf.yaw * 0.4;     // starboard, up in one

      // Vortices. Load is what draws them, with a floor that comes up a
      // little with speed so they never vanish outright at pace.
      const fast = Math.min(1, (s.speed || 0) / 150);
      const load = Math.min(1, Math.abs(surf.pitch) * 0.85 + Math.abs(surf.yaw) * 0.95);
      surf.pull += (load - surf.pull) * Math.min(1, 5 * dt);
      const show = Math.min(0.5, 0.015 + fast * 0.05 + surf.pull * 0.42);
      vortexMat.opacity = show;
      coreMat.opacity = show * 1.5;
      for (const trail of streams) {
        trail.scale.z = 0.6 + fast * 0.5 + surf.pull * 0.5;
        // A trail cannot turn as fast as the wing it came off, so it hangs
        // back a little on the outside of a turn.
        trail.rotation.y = surf.yaw * 0.1;
        trail.rotation.x = -surf.pitch * 0.07;
      }

      // The guns go where the cursor is. s.aim arrives already in the
      // aircraft's own frame, so this is two angles and no projection:
      // yaw swings the ring, pitch lifts the barrels inside it. Eased
      // rather than snapped, because a gun on a pintle has weight. The
      // limits are the two things it must not shoot: its own tail, and
      // its own deck on the way down.
      if (s.aim) {
        const k = Math.min(1, 9 * dt);
        const wantYaw   = Math.atan2(-s.aim.x, -s.aim.z);
        const wantPitch = Math.asin(clamp(s.aim.y, -1, 1));
        turret.rotation.y += (clamp(wantYaw, -1.15, 1.15) - turret.rotation.y) * k;
        mount.rotation.x  += (clamp(wantPitch, -0.32, 0.85) - mount.rotation.x) * k;
      }

      // Both barrel tips and the ejection port, back through the two
      // pivots into the aircraft's frame.
      gunMuzzles[0].copy(_local(-0.16, 0, -0.825));
      gunMuzzles[1].copy(_local(0.16, 0, -0.825));
      ejectAt.copy(_local(0.30, 0, 0.18));
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
    name: 'Fighter',
    blurb: 'Two seats and a cat on the gun. Turns wide, holds a line.',
    build: buildPlane,
    handling: { turn: 1.0, cruise: 71, top: 110, lift: 1.0, scale: 1.2 },
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
