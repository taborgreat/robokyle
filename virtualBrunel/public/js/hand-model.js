import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const DEG = Math.PI / 180;
const ACCENT = 0xff7a1a;
const ALERT = 0xff2d2d;

// Dimensions in cm. Right hand: fingers along +Y, palm facing +Z, thumb on +X.
const PALM = { width: 8.4, height: 8, depth: 2.6 };
const DEPTH = 1.7; // finger thickness at the knuckle

// x/y place the knuckle, splay fans the finger out (degrees about Z), lengths run
// knuckle to tip, maxDeg is the flexion range the API reports in /finger/range.
const FINGERS = {
  index: { x: 3.15, y: 8.6, splay: -4, width: 1.75, lengths: [4.2, 2.6, 2.2], maxDeg: 95 },
  middle: { x: 1.05, y: 8.9, splay: 0, width: 1.8, lengths: [4.6, 2.9, 2.3], maxDeg: 93 },
  ring: { x: -1.05, y: 8.5, splay: 4, width: 1.7, lengths: [4.2, 2.7, 2.2], maxDeg: 90 },
  pinky: { x: -3.1, y: 7.8, splay: 9, width: 1.55, lengths: [3.4, 2.1, 1.9], maxDeg: 85 },
};
// Share of a finger's flexion taken by each joint, knuckle to tip.
const CURL = [0.95, 1, 0.5];

// The thumb sits on a rotator at the palm's edge. Opposition swings it about Y from
// lateral to in front of the palm while rolling it about its own axis (twist, lateral →
// opposed) so it flexes towards the fingertips; its joints flex by up to `curl` degrees.
// Solved numerically so 'pinch' (thumb 70, index 80) meets tip to tip.
const THUMB = { x: 4.2, y: 1.2, z: 0.6, splay: -70, swing: 70, twist: [-80, -40], width: 1.9, lengths: [2.7, 2.3, 2], curl: [20, 30, 60] };

function box(width, height, depth, material) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 3, Math.min(width, height, depth) * 0.3), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(radiusTop, radiusBottom, height, material) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 40), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// A chain of phalanges, each hanging off a pivot with a visible hinge pin.
// Returns the root group and the pivots to rotate, knuckle first.
function buildDigit({ width, lengths }, materials) {
  const root = new THREE.Group();
  const pivots = [];
  let parent = root;

  lengths.forEach((length, i) => {
    const taper = 1 - i * 0.09;
    const pivot = new THREE.Group();
    pivot.position.y = i ? lengths[i - 1] : 0;

    const pin = cylinder(DEPTH * 0.46 * taper, DEPTH * 0.46 * taper, width * taper + 0.2, materials.accent);
    pin.rotation.z = 90 * DEG;

    const phalanx = box(width * taper, length - 0.2, DEPTH * taper, materials.body);
    phalanx.position.y = length / 2;
    pivot.add(pin, phalanx);

    if (i === lengths.length - 1) {
      const pad = box(width * taper * 0.8, length * 0.6, 0.4, materials.pad);
      pad.position.set(0, length * 0.55, (DEPTH * taper) / 2);
      pivot.add(pad);
    }

    parent.add(pivot);
    pivots.push(pivot);
    parent = pivot;
  });

  return { root, pivots };
}

function buildPalm(materials) {
  const palm = new THREE.Group();

  const body = box(PALM.width, PALM.height, PALM.depth, materials.body);
  body.position.y = PALM.height / 2;
  const backPlate = box(PALM.width * 0.72, PALM.height * 0.62, 0.4, materials.plate);
  backPlate.position.set(-0.3, PALM.height * 0.52, -PALM.depth / 2);
  const palmPad = box(PALM.width * 0.6, PALM.height * 0.45, 0.4, materials.pad);
  palmPad.position.set(-0.6, PALM.height * 0.5, PALM.depth / 2);

  const wrist = cylinder(2.9, 3.2, 2.4, materials.body);
  wrist.position.y = -1;
  const cuff = cylinder(3.35, 3.35, 0.5, materials.accent);
  cuff.position.y = -2.3;
  const socket = cylinder(3.2, 3.9, 5.6, materials.plate);
  socket.position.y = -5.2;
  for (const part of [wrist, cuff, socket]) part.scale.z = 0.72;

  palm.add(body, backPlate, palmPad, wrist, cuff, socket);
  return palm;
}

// Returns { group, setPose, setAlert }. A pose maps the API's joints
// (five fingers plus thumb_rotator) to 0–100 %.
export function createHandModel() {
  const materials = {
    body: new THREE.MeshStandardMaterial({ color: 0x4a515e, roughness: 0.5, metalness: 0.25 }),
    plate: new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.4, metalness: 0.4 }),
    pad: new THREE.MeshStandardMaterial({ color: 0x8a919c, roughness: 0.9 }),
    accent: new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.35, metalness: 0.3 }),
  };

  const group = new THREE.Group();
  group.add(buildPalm(materials));

  const fingers = {};
  for (const [name, spec] of Object.entries(FINGERS)) {
    const digit = buildDigit(spec, materials);
    digit.root.position.set(spec.x, spec.y, 0);
    digit.root.rotation.z = spec.splay * DEG;

    // Housing that carries the knuckle down into the palm.
    const housing = box(spec.width + 0.3, spec.y - PALM.height + 1.6, PALM.depth * 0.9, materials.body);
    housing.position.set(spec.x, (spec.y + PALM.height - 1.6) / 2, 0);

    group.add(digit.root, housing);
    fingers[name] = { pivots: digit.pivots, maxDeg: spec.maxDeg };
  }

  const thumb = buildDigit(THUMB, materials);
  const splay = new THREE.Group();
  splay.rotation.z = THUMB.splay * DEG;
  splay.add(thumb.root);
  const swing = new THREE.Group();
  swing.position.set(THUMB.x, THUMB.y, THUMB.z);
  swing.add(splay);
  const mount = cylinder(1.3, 1.3, 2, materials.plate);
  mount.position.copy(swing.position);
  group.add(swing, mount);

  return {
    group,

    setPose(pose) {
      for (const [name, { pivots, maxDeg }] of Object.entries(fingers)) {
        const flexion = (pose[name] / 100) * maxDeg * DEG;
        pivots.forEach((pivot, i) => (pivot.rotation.x = flexion * CURL[i]));
      }
      const opposition = pose.thumb_rotator / 100;
      const [lateral, opposed] = THUMB.twist;
      swing.rotation.y = -opposition * THUMB.swing * DEG;
      thumb.root.rotation.y = (lateral + (opposed - lateral) * opposition) * DEG;
      thumb.pivots.forEach((pivot, i) => (pivot.rotation.x = (pose.thumb / 100) * THUMB.curl[i] * DEG));
    },

    // ESTOP turns the hinge pins and cuff red.
    setAlert(on) {
      materials.accent.color.set(on ? ALERT : ACCENT);
      materials.accent.emissive.set(on ? ALERT : 0x000000);
      materials.accent.emissiveIntensity = on ? 0.6 : 0;
    },
  };
}
