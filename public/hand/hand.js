/* ============================================================
   Robo Kyle — HAND: the 3D arm.

   Builds a right arm from the shoulder to the fingertips out of plain
   three.js geometry (no model files), then lets you pull it about:

     drag a finger      curls that finger        (Shift: spread it)
     drag the thumb     curls the thumb          (Shift: swing it out)
     drag the palm      flexes the wrist         (Shift: tilts it)
     drag the forearm   bends the elbow          (Shift: turns the palm)
     drag the upper arm aims the shoulder        (Shift: rolls it)
     drag empty space   orbits the camera

   Bones are meshes parented to joint nodes, so posing is just setting
   joint angles. Muscles and nerves are tubes rebuilt from waypoints on
   those bones every time the pose changes, so they stretch and slide
   with the skeleton instead of floating beside it.

   Everything anatomical (sizes, ranges, paths, text) is in anatomy.js.
   The page exposes window.RoboHand so that later — when real sensors
   exist — a signal can drive a joint directly. Nothing here reads any
   recorded EMG or SNC data; this is a demonstration of the interface.
   ============================================================ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  FINGERS, THUMB, ARM, CARPALS, BONE_TEXT, JOINT_TEXT,
  MUSCLES, MUSCLE_GROUPS, NERVES, PRESETS,
} from './anatomy.js';

const DEG = Math.PI / 180;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ============================================================ scene */

const stage = $('#hand-stage');
const broken = setTimeout(() => stage.classList.add('is-broken'), 5000);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0a0e15, 110, 200);

const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 400);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.domElement.setAttribute('aria-label', 'Interactive 3D model of a human arm and hand');
renderer.domElement.tabIndex = -1;
stage.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 8;
controls.maxDistance = 160;
controls.maxPolarAngle = Math.PI * 0.92;
controls.autoRotateSpeed = 0.6;

scene.add(new THREE.HemisphereLight(0x9fb7c8, 0x2a1a14, 0.55));
const key = new THREE.DirectionalLight(0xfff0dc, 2.4);
key.position.set(30, 45, 40);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 10;
key.shadow.camera.far = 160;
key.shadow.camera.left = key.shadow.camera.bottom = -60;
key.shadow.camera.right = key.shadow.camera.top = 60;
key.shadow.bias = -0.0008;
key.shadow.normalBias = 0.04;
scene.add(key);
const fill = new THREE.DirectionalLight(0x7fb0c8, 0.8);
fill.position.set(-40, 10, 30);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xff9a6a, 1.3);
rim.position.set(10, 22, -45);
scene.add(rim);

const FLOOR_Y = -24;
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(90, 72),
  new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.38 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = FLOOR_Y;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(160, 32, 0x24303f, 0x161d27);
grid.position.y = FLOOR_Y + 0.02;
grid.material.transparent = true;
grid.material.opacity = 0.45;
scene.add(grid);

/* ============================================================ materials */

const COL = {
  bone: 0xefe6d0,
  muscle: 0xa6303b,
  tendon: 0xe6dcc6,
  nerve: 0xf3d55b,
  joint: 0x6fbfcb,
  skin: 0xd9a68c,
};

function boneMaterial() {
  return new THREE.MeshStandardMaterial({ color: COL.bone, roughness: 0.58, metalness: 0.02 });
}
function tubeMaterial(roughness = 0.42) {
  return new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness, metalness: 0.04 });
}
function nerveMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0.0,
    emissive: 0x7a5d12, emissiveIntensity: 0.32 });
}
function jointMaterial() {
  return new THREE.MeshStandardMaterial({ color: COL.joint, roughness: 0.3, metalness: 0.1,
    emissive: 0x1f8a99, emissiveIntensity: 0.9, transparent: true, opacity: 0.9 });
}

/* Translucent skin: a fresnel glow with no lighting, so the arm reads as a
   ghost around the working parts rather than hiding them. */
const skinMaterial = new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color(COL.skin) }, opacity: { value: 0.28 } },
  vertexShader: `
    varying vec3 vN; varying vec3 vV;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = -mv.xyz;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 color; uniform float opacity;
    varying vec3 vN; varying vec3 vV;
    void main() {
      float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.6);
      vec3 c = mix(color * 0.55, color * 1.35 + 0.18, f);
      gl_FragColor = vec4(c, opacity * (0.28 + 1.1 * f));
    }`,
  transparent: true,
  depthWrite: false,
  side: THREE.FrontSide,
});

/* ============================================================ geometry */

const bump = (t, c, w) => Math.exp(-(((t - c) / w) ** 2));

/* A long bone as a surface of revolution: rounded proximal end, narrow
   shaft, rounded distal end, laid along +X with the proximal end at 0. */
function longBoneGeometry(len, rP, rS, rD, segments = 20) {
  const pts = [new THREE.Vector2(0, 0)];
  const N = 26;
  const e = 0.045;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let r = rS + (rP - rS) * bump(t, 0.07, 0.11) + (rD - rS) * bump(t, 0.92, 0.12);
    if (t < e) r *= Math.sqrt(Math.max(0, 1 - ((e - t) / e) ** 2));
    if (t > 1 - e) r *= Math.sqrt(Math.max(0, 1 - ((t - (1 - e)) / e) ** 2));
    pts.push(new THREE.Vector2(Math.max(r, 0.02), t * len));
  }
  pts.push(new THREE.Vector2(0, len));
  const g = new THREE.LatheGeometry(pts, segments);
  g.rotateZ(-Math.PI / 2);          // lathe axis Y -> bone axis X
  g.computeVertexNormals();
  return g;
}

function capsuleX(r, len, radial = 14) {
  const g = new THREE.CapsuleGeometry(r, Math.max(len, 0.1), 6, radial);
  g.rotateZ(-Math.PI / 2);
  g.translate(len / 2, 0, 0);
  return g;
}

/* A tube whose vertices are rewritten in place whenever the pose changes.
   Vertex colours run from tendon-pale where the tube is thin to muscle-red
   where it is thick, so a belly and its tendon are one continuous strand. */
class Tube {
  constructor(segments, radial, material) {
    this.segments = segments;
    this.radial = radial;
    const n = (segments + 1) * (radial + 1);
    this.pos = new Float32Array(n * 3);
    this.nor = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    const idx = [];
    for (let s = 0; s < segments; s++) {
      for (let r = 0; r < radial; r++) {
        const a = s * (radial + 1) + r;
        const b = a + radial + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setIndex(idx);
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  update(points, radiusAt, colorThin, colorThick, rMin, rMax) {
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
    const T = new THREE.Vector3(), Nn = new THREE.Vector3(), B = new THREE.Vector3();
    const P = new THREE.Vector3(), up = new THREE.Vector3();
    const c = new THREE.Color();
    let k = 0;
    for (let s = 0; s <= this.segments; s++) {
      const t = s / this.segments;
      curve.getPoint(t, P);
      curve.getTangent(t, T).normalize();
      if (s === 0) {
        up.set(Math.abs(T.y) < 0.9 ? 0 : 1, Math.abs(T.y) < 0.9 ? 1 : 0, 0);
        Nn.crossVectors(up, T).normalize();
      } else {
        Nn.addScaledVector(T, -Nn.dot(T));
        if (Nn.lengthSq() < 1e-8) { up.set(0, 0, 1); Nn.crossVectors(up, T); }
        Nn.normalize();
      }
      B.crossVectors(T, Nn);
      const r = radiusAt(t);
      const mix = smooth(clamp((r - rMin) / Math.max(rMax - rMin, 1e-6), 0, 1));
      c.copy(colorThin).lerp(colorThick, mix);
      for (let j = 0; j <= this.radial; j++) {
        const a = (j / this.radial) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const nx = Nn.x * ca + B.x * sa, ny = Nn.y * ca + B.y * sa, nz = Nn.z * ca + B.z * sa;
        this.pos[k] = P.x + nx * r; this.pos[k + 1] = P.y + ny * r; this.pos[k + 2] = P.z + nz * r;
        this.nor[k] = nx; this.nor[k + 1] = ny; this.nor[k + 2] = nz;
        this.col[k] = c.r; this.col[k + 1] = c.g; this.col[k + 2] = c.b;
        k += 3;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
}

/* Piecewise-linear radius profile from [[t, r], ...], smoothed. */
function radiusProfile(keys) {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const u = (t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
        return lerp(keys[i - 1][1], keys[i][1], smooth(u));
      }
    }
    return keys[keys.length - 1][1];
  };
}

/* ============================================================ skeleton */

const root = new THREE.Group();
root.position.set(-31, 12, -3);
scene.add(root);

const frames = new Map();       // frame id -> { node, len }
const joints = [];              // Joint instances, in order
const jointsById = new Map();
const structures = [];          // everything you can click on
const structById = new Map();
let poseDirty = true;

const _q = new THREE.Quaternion();

class Joint {
  constructor(id, node, dofs, text, rest = null) {
    this.id = id;
    this.node = node;
    this.dofs = dofs.map(d => ({ value: d.rest ?? 0, ...d, axis: new THREE.Vector3(...d.axis) }));
    this.text = text;
    this.rest = rest ? rest.clone() : new THREE.Quaternion();
    joints.push(this);
    jointsById.set(id, this);
  }
  dof(key) { return this.dofs.find(d => d.key === key); }
  get(key) { return this.dof(key).value; }
  set(key, v) {
    const d = this.dof(key);
    const nv = clamp(v, d.min, d.max);
    if (nv !== d.value) { d.value = nv; poseDirty = true; }
  }
  apply() {
    const q = this.node.quaternion.copy(this.rest);
    for (const d of this.dofs) q.multiply(_q.setFromAxisAngle(d.axis, d.value * DEG));
  }
}

function frame(id, node, len = 0) { frames.set(id, { node, len }); return node; }

function addStructure(s) {
  s.meshes = s.meshes || [];
  s.mats = s.mats || s.meshes.map(m => m.material);
  for (const m of s.meshes) m.userData.structure = s;
  structures.push(s);
  structById.set(s.id, s);
  return s;
}

function boneMesh(geometry, scaleZ = 1) {
  const m = new THREE.Mesh(geometry, boneMaterial());
  m.scale.z = scaleZ;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function jointMarker(parent, position, radius) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 18, 14), jointMaterial());
  m.position.copy(position);
  m.userData.layer = 'joints';
  parent.add(m);
  return m;
}

/* --- upper arm --- */
const shoulderNode = new THREE.Object3D();
root.add(shoulderNode);
frame('humerus', shoulderNode, ARM.humerus);
const humerusMesh = boneMesh(longBoneGeometry(ARM.humerus, 1.35, 1.05, 1.75));
const humeralHead = boneMesh(new THREE.SphereGeometry(2.3, 22, 16));
humeralHead.position.set(-0.7, 0.3, 0.2);
shoulderNode.add(humerusMesh, humeralHead);
addStructure({ id: 'humerus', kind: 'bone', name: BONE_TEXT.humerus.name, info: BONE_TEXT.humerus,
  meshes: [humerusMesh, humeralHead], drag: { type: 'shoulder' } });
new Joint('shoulder', shoulderNode, [
  { key: 'swing', label: 'Swing (forward / back)', axis: [0, 1, 0], min: -70, max: 70, rest: 14 },
  { key: 'elev', label: 'Raise / lower', axis: [0, 0, 1], min: -75, max: 85, rest: -16 },
  { key: 'twist', label: 'Roll', axis: [1, 0, 0], min: -70, max: 70, rest: 0 },
], JOINT_TEXT.shoulder);
addStructure({ id: 'j-shoulder', kind: 'joint', name: JOINT_TEXT.shoulder.name, info: JOINT_TEXT.shoulder,
  joint: 'shoulder', meshes: [jointMarker(root, new THREE.Vector3(0, 0, 0), 1.5)] });

/* --- forearm (elbow flexion + pronation on one node) --- */
const forearmNode = new THREE.Object3D();
forearmNode.position.set(ARM.humerus, 0, 0);
shoulderNode.add(forearmNode);
frame('forearm', forearmNode, ARM.wristAt);
new Joint('elbow', forearmNode, [
  { key: 'flex', label: 'Elbow flexion', axis: [0, -1, 0], min: 0, max: 145, rest: 38 },
  { key: 'twist', label: 'Pronation ⟷ supination', axis: [1, 0, 0], min: -85, max: 75, rest: 0 },
], JOINT_TEXT.elbow);
addStructure({ id: 'j-elbow', kind: 'joint', name: JOINT_TEXT.elbow.name, info: JOINT_TEXT.elbow,
  joint: 'elbow', meshes: [jointMarker(shoulderNode, new THREE.Vector3(ARM.humerus, 0, 0), 1.25)] });
addStructure({ id: 'j-pronation', kind: 'joint', name: JOINT_TEXT.pronation.name, info: JOINT_TEXT.pronation,
  joint: 'elbow', meshes: [jointMarker(forearmNode, new THREE.Vector3(2.2, 1.6, 0), 0.7), jointMarker(forearmNode, new THREE.Vector3(24.4, -0.6, 0), 0.6)] });

const ulnaMesh = boneMesh(longBoneGeometry(27.5, 1.45, 0.62, 0.62));
ulnaMesh.position.set(-1.5, -1.3, -0.2);
const radiusMesh = boneMesh(longBoneGeometry(ARM.radius, 0.85, 0.6, 1.35));
radiusMesh.position.set(1.5, 1.6, 0);
forearmNode.add(ulnaMesh, radiusMesh);
addStructure({ id: 'ulna', kind: 'bone', name: BONE_TEXT.ulna.name, info: BONE_TEXT.ulna, meshes: [ulnaMesh], drag: { type: 'elbow' } });
addStructure({ id: 'radius', kind: 'bone', name: BONE_TEXT.radius.name, info: BONE_TEXT.radius, meshes: [radiusMesh], drag: { type: 'elbow' } });

/* --- wrist and carpus --- */
const wristNode = new THREE.Object3D();
wristNode.position.set(ARM.wristAt, 0, 0);
forearmNode.add(wristNode);
frame('wrist', wristNode, 3.4);
new Joint('wrist', wristNode, [
  { key: 'dev', label: 'Radial ⟷ ulnar deviation', axis: [0, 0, 1], min: -32, max: 18, rest: 0 },
  { key: 'flex', label: 'Wrist flexion ⟷ extension', axis: [0, -1, 0], min: -70, max: 72, rest: 0 },
], JOINT_TEXT.wrist);
addStructure({ id: 'j-wrist', kind: 'joint', name: JOINT_TEXT.wrist.name, info: JOINT_TEXT.wrist,
  joint: 'wrist', meshes: [jointMarker(forearmNode, new THREE.Vector3(ARM.wristAt, 0, 0), 1.0)] });

for (const c of CARPALS) {
  const m = boneMesh(new THREE.IcosahedronGeometry(1, 2));
  m.scale.set(...c.r);
  m.position.set(...c.pos);
  wristNode.add(m);
  addStructure({ id: c.id, kind: 'bone', name: c.name, info: { text: c.text, articulates: 'Neighbouring carpals; the proximal row meets the radius, the distal row carries the metacarpals.' },
    meshes: [m], drag: { type: 'wrist' } });
}

/* --- fingers --- */
const FINGER = {};   // key -> { mc, mcp, pip, dip, tip, lens }
for (const f of FINGERS) {
  const mcNode = new THREE.Object3D();
  mcNode.position.set(...f.base);
  mcNode.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), f.splay * DEG);
  wristNode.add(mcNode);
  frame(f.key, mcNode, f.mc);
  frame(`mc${f.id}`, mcNode, f.mc);          // same frame under its bone name
  const mcMesh = boneMesh(longBoneGeometry(f.mc, 0.72, 0.45, 0.66), 0.9);
  mcNode.add(mcMesh);
  addStructure({ id: `mc${f.id}`, kind: 'bone', name: `${f.label} — metacarpal`, info: BONE_TEXT.mc, meshes: [mcMesh], drag: { type: 'wrist' } });

  const mcp = new THREE.Object3D(); mcp.position.set(f.mc, 0, 0); mcNode.add(mcp);
  frame(`pp${f.id}`, mcp, f.pp);
  new Joint(`mcp${f.id}`, mcp, [
    { key: 'abd', label: 'Spread', axis: [0, 0, 1], min: -22, max: 22, rest: 0 },
    { key: 'flex', label: 'Knuckle flexion', axis: [0, -1, 0], min: -25, max: 90, rest: 0 },
  ], JOINT_TEXT.mcp);
  const ppMesh = boneMesh(longBoneGeometry(f.pp, 0.66, 0.42, 0.52), 0.85);
  mcp.add(ppMesh);
  addStructure({ id: `pp${f.id}`, kind: 'bone', name: `${f.label} — proximal phalanx`, info: BONE_TEXT.pp, meshes: [ppMesh], drag: { type: 'finger', finger: f.key } });
  addStructure({ id: `j-mcp${f.id}`, kind: 'joint', name: `${f.label} — ${JOINT_TEXT.mcp.name}`, info: JOINT_TEXT.mcp, joint: `mcp${f.id}`,
    meshes: [jointMarker(mcNode, new THREE.Vector3(f.mc, 0, 0), 0.52)] });

  const pip = new THREE.Object3D(); pip.position.set(f.pp, 0, 0); mcp.add(pip);
  frame(`mp${f.id}`, pip, f.mp);
  new Joint(`pip${f.id}`, pip, [{ key: 'flex', label: 'Middle joint flexion', axis: [0, -1, 0], min: -5, max: 102, rest: 0 }], JOINT_TEXT.pip);
  const mpMesh = boneMesh(longBoneGeometry(f.mp, 0.52, 0.36, 0.46), 0.85);
  pip.add(mpMesh);
  addStructure({ id: `mp${f.id}`, kind: 'bone', name: `${f.label} — middle phalanx`, info: BONE_TEXT.mp, meshes: [mpMesh], drag: { type: 'finger', finger: f.key } });
  addStructure({ id: `j-pip${f.id}`, kind: 'joint', name: `${f.label} — ${JOINT_TEXT.pip.name}`, info: JOINT_TEXT.pip, joint: `pip${f.id}`,
    meshes: [jointMarker(mcp, new THREE.Vector3(f.pp, 0, 0), 0.42)] });

  const dip = new THREE.Object3D(); dip.position.set(f.mp, 0, 0); pip.add(dip);
  frame(`dp${f.id}`, dip, f.dp);
  new Joint(`dip${f.id}`, dip, [{ key: 'flex', label: 'Fingertip joint flexion', axis: [0, -1, 0], min: -10, max: 72, rest: 0 }], JOINT_TEXT.dip);
  const dpMesh = boneMesh(longBoneGeometry(f.dp, 0.45, 0.33, 0.42), 0.75);
  dip.add(dpMesh);
  addStructure({ id: `dp${f.id}`, kind: 'bone', name: `${f.label} — distal phalanx`, info: BONE_TEXT.dp, meshes: [dpMesh], drag: { type: 'finger', finger: f.key } });
  addStructure({ id: `j-dip${f.id}`, kind: 'joint', name: `${f.label} — ${JOINT_TEXT.dip.name}`, info: JOINT_TEXT.dip, joint: `dip${f.id}`,
    meshes: [jointMarker(pip, new THREE.Vector3(f.mp, 0, 0), 0.36)] });

  FINGER[f.key] = { id: f.id, label: f.label, mcNode, mcp: jointsById.get(`mcp${f.id}`), pip: jointsById.get(`pip${f.id}`), dip: jointsById.get(`dip${f.id}`), tipNode: dip, lens: f };
}

/* --- thumb --- */
const thumbBase = new THREE.Object3D();
thumbBase.position.set(...THUMB.base);
{
  const x = new THREE.Vector3(...THUMB.dir).normalize();
  const z = new THREE.Vector3(0, 0, 1).addScaledVector(x, -x.z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  thumbBase.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
wristNode.add(thumbBase);
const cmc1 = new THREE.Object3D(); thumbBase.add(cmc1);
frame('mc1', cmc1, THUMB.mc);
new Joint('cmc1', cmc1, [
  { key: 'abd', label: 'Palmar abduction', axis: [0, -1, 0], min: -22, max: 45, rest: 0 },
  { key: 'flex', label: 'Flexion across the palm', axis: [0, 0, -1], min: -15, max: 45, rest: 0 },
], JOINT_TEXT.cmc1);
const mc1Mesh = boneMesh(longBoneGeometry(THUMB.mc, 0.85, 0.56, 0.78), 0.9);
cmc1.add(mc1Mesh);
addStructure({ id: 'mc1', kind: 'bone', name: BONE_TEXT.mc1.name, info: BONE_TEXT.mc1, meshes: [mc1Mesh], drag: { type: 'thumb' } });
addStructure({ id: 'j-cmc1', kind: 'joint', name: JOINT_TEXT.cmc1.name, info: JOINT_TEXT.cmc1, joint: 'cmc1',
  meshes: [jointMarker(wristNode, new THREE.Vector3(...THUMB.base), 0.6)] });

const mcp1 = new THREE.Object3D(); mcp1.position.set(THUMB.mc, 0, 0); cmc1.add(mcp1);
frame('pp1', mcp1, THUMB.pp);
new Joint('mcp1', mcp1, [{ key: 'flex', label: 'Thumb knuckle flexion', axis: [0, -1, 0], min: -12, max: 58, rest: 0 }], JOINT_TEXT.mcp1);
const pp1Mesh = boneMesh(longBoneGeometry(THUMB.pp, 0.7, 0.48, 0.58), 0.85);
mcp1.add(pp1Mesh);
addStructure({ id: 'pp1', kind: 'bone', name: BONE_TEXT.pp1.name, info: BONE_TEXT.pp1, meshes: [pp1Mesh], drag: { type: 'thumb' } });
addStructure({ id: 'j-mcp1', kind: 'joint', name: JOINT_TEXT.mcp1.name, info: JOINT_TEXT.mcp1, joint: 'mcp1',
  meshes: [jointMarker(cmc1, new THREE.Vector3(THUMB.mc, 0, 0), 0.5)] });

const ip1 = new THREE.Object3D(); ip1.position.set(THUMB.pp, 0, 0); mcp1.add(ip1);
frame('dp1', ip1, THUMB.dp);
new Joint('ip1', ip1, [{ key: 'flex', label: 'Thumb tip flexion', axis: [0, -1, 0], min: -15, max: 82, rest: 0 }], JOINT_TEXT.ip1);
const dp1Mesh = boneMesh(longBoneGeometry(THUMB.dp, 0.52, 0.38, 0.48), 0.75);
ip1.add(dp1Mesh);
addStructure({ id: 'dp1', kind: 'bone', name: BONE_TEXT.dp1.name, info: BONE_TEXT.dp1, meshes: [dp1Mesh], drag: { type: 'thumb' } });
addStructure({ id: 'j-ip1', kind: 'joint', name: JOINT_TEXT.ip1.name, info: JOINT_TEXT.ip1, joint: 'ip1',
  meshes: [jointMarker(mcp1, new THREE.Vector3(THUMB.pp, 0, 0), 0.42)] });

const THUMB_CHAIN = { cmc: jointsById.get('cmc1'), mcp: jointsById.get('mcp1'), ip: jointsById.get('ip1'), tipNode: ip1 };

/* ============================================================ skin */

const skinMeshes = [];
function skin(parent, geometry, position = null, scale = null) {
  const m = new THREE.Mesh(geometry, skinMaterial);
  if (position) m.position.copy(position);
  if (scale) m.scale.copy(scale);
  m.renderOrder = 10;
  m.userData.layer = 'skin';
  m.userData.skin = true;
  parent.add(m);
  skinMeshes.push(m);
  return m;
}
skin(shoulderNode, longBoneGeometry(ARM.humerus + 1.5, 4.9, 4.3, 3.9, 28), new THREE.Vector3(-1.0, 0, 0), new THREE.Vector3(1, 1, 0.9));
skin(forearmNode, longBoneGeometry(ARM.wristAt + 0.5, 4.1, 3.5, 2.7, 28), new THREE.Vector3(-0.3, 0.1, 0), new THREE.Vector3(1, 1, 0.82));
skin(wristNode, new THREE.SphereGeometry(1, 24, 18), new THREE.Vector3(1.4, 0, 0.1), new THREE.Vector3(2.6, 3.0, 1.85));
skin(wristNode, new THREE.SphereGeometry(1, 28, 20), new THREE.Vector3(5.2, -0.1, 0.25), new THREE.Vector3(5.6, 4.9, 1.65));
skin(thumbBase, new THREE.SphereGeometry(1, 20, 14), new THREE.Vector3(1.6, -0.6, 0.2), new THREE.Vector3(2.6, 1.9, 1.7));
for (const f of FINGERS) {
  const s = f.id <= 3 ? 1 : f.id === 4 ? 0.94 : 0.85;
  skin(frames.get(`pp${f.id}`).node, capsuleX(0.86 * s, f.pp - 0.5), new THREE.Vector3(0.1, 0, 0.02), new THREE.Vector3(1, 1, 0.9));
  skin(frames.get(`mp${f.id}`).node, capsuleX(0.76 * s, f.mp - 0.5), new THREE.Vector3(0.1, 0, 0), new THREE.Vector3(1, 1, 0.9));
  skin(frames.get(`dp${f.id}`).node, capsuleX(0.66 * s, f.dp - 0.3), new THREE.Vector3(0.05, 0, 0), new THREE.Vector3(1, 1, 0.82));
}
skin(cmc1, capsuleX(1.15, THUMB.mc - 0.8), new THREE.Vector3(0.3, 0, 0.05), new THREE.Vector3(1, 1, 0.9));
skin(mcp1, capsuleX(0.98, THUMB.pp - 0.5), new THREE.Vector3(0.1, 0, 0), new THREE.Vector3(1, 1, 0.9));
skin(ip1, capsuleX(0.84, THUMB.dp - 0.3), new THREE.Vector3(0.05, 0, 0), new THREE.Vector3(1, 1, 0.82));

/* ============================================================ soft tissue */

const tubes = [];   // { tube, points(frame refs), radiusAt, colors, rMin, rMax }

function resolveX(expr, len) {
  if (typeof expr === 'number') return expr;
  if (expr.startsWith('len-')) return len - parseFloat(expr.slice(4));
  if (expr.startsWith('len*')) return len * parseFloat(expr.slice(4));
  return parseFloat(expr);
}

/* Below rMin the strand is drawn as tendon, above rMax as muscle belly;
   the same absolute thresholds for every strand, so a thin intrinsic
   muscle still reads as muscle and a tendon never turns red. */
function makeStrand(strand, material, thin, thick, rMin = 0.26, rMax = 0.5) {
  const refs = strand.pts.map(([fr, x, y, z]) => {
    const f = frames.get(fr);
    if (!f) throw new Error(`unknown frame ${fr}`);
    return { node: f.node, local: new THREE.Vector3(resolveX(x, f.len), y, z) };
  });
  const thickest = Math.max(...strand.r.map(k => k[1]));
  const segments = clamp(refs.length * 8, 24, 56);
  const radial = thickest > 0.6 ? 14 : 9;
  const tube = new Tube(segments, radial, material);
  const entry = { tube, refs, radiusAt: radiusProfile(strand.r), thin, thick, rMin, rMax,
    points: refs.map(() => new THREE.Vector3()) };
  tubes.push(entry);
  scene.add(tube.mesh);
  return tube.mesh;
}

function updateSoftTissue() {
  for (const t of tubes) {
    for (let i = 0; i < t.refs.length; i++) t.refs[i].node.localToWorld(t.points[i].copy(t.refs[i].local));
    t.tube.update(t.points, t.radiusAt, t.thin, t.thick, t.rMin, t.rMax);
  }
}

const TENDON = new THREE.Color(COL.tendon);
for (const m of MUSCLES) {
  const material = tubeMaterial();
  const thick = new THREE.Color(MUSCLE_GROUPS[m.group].color);
  const meshes = m.strands.map(s => { const mesh = makeStrand(s, material, TENDON, thick); mesh.userData.layer = `m:${m.group}`; return mesh; });
  addStructure({ id: m.id, kind: 'muscle', group: m.group, name: m.name, info: m, meshes, mats: [material] });
}
const NERVE = new THREE.Color(COL.nerve);
for (const n of NERVES) {
  const material = nerveMaterial();
  const meshes = n.strands.map(s => { const mesh = makeStrand(s, material, NERVE, NERVE, 0, 0); mesh.userData.layer = 'nerves'; return mesh; });
  addStructure({ id: n.id, kind: 'nerve', name: n.name, info: n, meshes, mats: [material] });
}
for (const s of structures) {
  if (s.kind === 'bone') for (const m of s.meshes) m.userData.layer = 'bones';
}

/* ============================================================ posing */

const CURL = {
  finger: { mcp: 85, pip: 100, dip: 65 },
  thumb: { flex: 35, mcp: 50, ip: 72 },
};
const SPREAD = { index: 8, middle: 1, ring: -6, little: -12 };

function setCurl(key, c) {
  if (key === 'thumb') {
    THUMB_CHAIN.cmc.set('flex', CURL.thumb.flex * c);
    THUMB_CHAIN.mcp.set('flex', CURL.thumb.mcp * c);
    THUMB_CHAIN.ip.set('flex', CURL.thumb.ip * c);
    return;
  }
  const f = FINGER[key];
  f.mcp.set('flex', CURL.finger.mcp * c);
  f.pip.set('flex', CURL.finger.pip * c);
  f.dip.set('flex', CURL.finger.dip * c);
}
function getCurl(key) {
  if (key === 'thumb') return THUMB_CHAIN.ip.get('flex') / CURL.thumb.ip;
  return FINGER[key].pip.get('flex') / CURL.finger.pip;
}

function applyPose() {
  for (const j of joints) j.apply();
  root.updateMatrixWorld(true);
}

/* Fingertip angle (in the metacarpal's plane) for each curl value, so a
   pointer position can be turned back into a curl: "put the tip here". */
const curlTables = {};
function buildCurlTable(key) {
  const chain = key === 'thumb'
    ? { base: thumbBase, tip: THUMB_CHAIN.tipNode, tipLen: THUMB.dp, offset: 0, dofs: [THUMB_CHAIN.cmc, THUMB_CHAIN.mcp, THUMB_CHAIN.ip] }
    : { base: FINGER[key].mcNode, tip: FINGER[key].tipNode, tipLen: FINGER[key].lens.dp, offset: FINGER[key].lens.mc, dofs: [FINGER[key].mcp, FINGER[key].pip, FINGER[key].dip] };
  const saved = chain.dofs.map(j => j.dofs.map(d => d.value));
  const angles = [], curls = [];
  const tip = new THREE.Vector3();
  for (let c = -0.25; c <= 1.0001; c += 0.025) {
    setCurl(key, c);
    applyPose();
    tip.set(chain.tipLen, 0, 0);
    chain.tip.localToWorld(tip);
    chain.base.worldToLocal(tip);
    let a = Math.atan2(tip.z, tip.x - chain.offset) / DEG;
    if (a < -100) a += 360;
    angles.push(a); curls.push(c);
  }
  chain.dofs.forEach((j, i) => j.dofs.forEach((d, k) => { d.value = saved[i][k]; }));
  poseDirty = true;
  curlTables[key] = { key, angles, curls, ...chain };
}
function curlFromAngle(key, angle) {
  const t = curlTables[key];
  if (angle < -100) angle += 360;
  if (angle <= t.angles[0]) return t.curls[0];
  for (let i = 1; i < t.angles.length; i++) {
    if (angle <= t.angles[i]) {
      const u = (angle - t.angles[i - 1]) / (t.angles[i] - t.angles[i - 1] || 1);
      return lerp(t.curls[i - 1], t.curls[i], u);
    }
  }
  return t.curls[t.curls.length - 1];
}

applyPose();
for (const k of ['index', 'middle', 'ring', 'little', 'thumb']) buildCurlTable(k);
applyPose();
updateSoftTissue();

/* Smooth transitions between poses. */
let tween = null;
function snapshotPose() {
  const out = {};
  for (const j of joints) for (const d of j.dofs) out[`${j.id}.${d.key}`] = d.value;
  return out;
}
function tweenTo(target, ms = 520) {
  const from = snapshotPose();
  const keys = Object.keys(target).filter(k => Math.abs(target[k] - from[k]) > 1e-3);
  if (!keys.length) return;
  if (REDUCED || ms <= 0) { applySnapshot(target); return; }
  tween = { from, to: target, keys, t0: performance.now(), ms };
}
function applySnapshot(snap) {
  for (const k in snap) {
    const [jid, key] = k.split('.');
    jointsById.get(jid)?.set(key, snap[k]);
  }
}
function stepTween(now) {
  if (!tween) return;
  const u = smooth(clamp((now - tween.t0) / tween.ms, 0, 1));
  for (const k of tween.keys) {
    const [jid, key] = k.split('.');
    jointsById.get(jid).set(key, lerp(tween.from[k], tween.to[k], u));
  }
  if (u >= 1) tween = null;
}

function applyPreset(name, animate = true) {
  const p = PRESETS[name];
  if (!p) return;
  const before = snapshotPose();
  for (const k in p.curl) setCurl(k, p.curl[k]);
  if (p.spread != null) for (const k in SPREAD) FINGER[k].mcp.set('abd', SPREAD[k] * p.spread);
  if (p.thumbAbd != null) THUMB_CHAIN.cmc.set('abd', p.thumbAbd);
  if (p.wrist != null) jointsById.get('wrist').set('flex', p.wrist);
  const target = snapshotPose();
  applySnapshot(before);
  poseDirty = true;
  if (animate) tweenTo(target); else applySnapshot(target);
}

function resetPose(animate = true) {
  const before = snapshotPose();
  for (const j of joints) for (const d of j.dofs) d.value = d.rest ?? 0;
  const target = snapshotPose();
  applySnapshot(before);
  poseDirty = true;
  if (animate) tweenTo(target); else applySnapshot(target);
}

/* ============================================================ layers & looks */

const layerState = { skin: true, bones: true, joints: true, nerves: true, 'm:arm': true, 'm:flexors': true, 'm:extensors': true, 'm:hand': true };
let muscleOpacity = 1;
let isolate = false;
let selected = null;
let hovered = null;

function layerOf(mesh) { return mesh.userData.layer; }
function applyLayers() {
  scene.traverse(o => { if (o.isMesh && o.userData.layer) o.visible = layerState[o.userData.layer] !== false; });
  applyLooks();
}

function applyLooks() {
  for (const s of structures) {
    const isSel = s === selected;
    const isHov = s === hovered && !isSel;
    let dim = 1;
    if (isolate && selected && !isSel) dim = s.kind === 'bone' || s.kind === 'joint' ? 0.35 : 0.1;
    if ((s.kind === 'muscle') && muscleOpacity < 1) dim *= muscleOpacity;
    for (const mat of s.mats) {
      if (s.kind === 'joint') {
        mat.opacity = 0.9 * dim;
        mat.emissiveIntensity = isSel ? 2.2 : isHov ? 1.6 : 0.9;
      } else {
        mat.transparent = dim < 1;
        mat.opacity = dim;
        mat.depthWrite = dim >= 0.5;
        const base = s.kind === 'nerve' ? 0.32 : 0;
        if (isSel) { mat.emissive.setHex(s.kind === 'bone' ? 0x2d6a78 : s.kind === 'nerve' ? 0xc9a020 : 0x7a1e28); mat.emissiveIntensity = s.kind === 'muscle' ? 0.9 : 0.8; }
        else if (isHov) { mat.emissive.setHex(s.kind === 'bone' ? 0x1e4b55 : s.kind === 'nerve' ? 0xb08a1a : 0x5a1620); mat.emissiveIntensity = 0.7; }
        else { mat.emissive.setHex(s.kind === 'nerve' ? 0x7a5d12 : 0x000000); mat.emissiveIntensity = base || 1; }
      }
    }
  }
}

/* ============================================================ picking & dragging */

const raycaster = new THREE.Raycaster();
raycaster.params.Line.threshold = 0.4;
const pointer = new THREE.Vector2();
const plane = new THREE.Plane();
const hitPt = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
let pointerMoved = false;
let lastPointer = { x: 0, y: 0 };

function setPointer(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  lastPointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  pointerMoved = true;
}

const pickables = [];
function refreshPickables() {
  pickables.length = 0;
  for (const s of structures) for (const m of s.meshes) if (m.visible) pickables.push(m);
}

function pick() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickables, false);
  return hits.length ? hits[0] : null;
}

function planeHit(pointWorld, normalWorld) {
  plane.setFromNormalAndCoplanarPoint(normalWorld, pointWorld);
  return raycaster.ray.intersectPlane(plane, hitPt);
}
function worldAxis(node, axis) {
  return tmpV.set(axis === 'y' ? 0 : axis === 'z' ? 0 : 1, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0).transformDirection(node.matrixWorld).normalize();
}

let drag = null;

function beginDrag(struct, e) {
  const d = struct.drag;
  const shift = e.shiftKey;
  drag = { type: d.type, finger: d.finger, shift, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
  raycaster.setFromCamera(pointer, camera);
  if (d.type === 'finger' || d.type === 'thumb') {
    const key = d.type === 'thumb' ? 'thumb' : d.finger;
    const t = curlTables[key];
    drag.key = key;
    drag.pivot = t.base.localToWorld(new THREE.Vector3(t.offset, 0, 0));
    drag.normal = worldAxis(t.base, 'y').clone();
    drag.startCurl = getCurl(key);
    drag.startAngleCurl = angleCurlAt(t) ?? drag.startCurl;
    drag.startAbd = key === 'thumb' ? THUMB_CHAIN.cmc.get('abd') : FINGER[key].mcp.get('abd');
  } else if (d.type === 'wrist') {
    drag.pivot = wristNode.getWorldPosition(new THREE.Vector3());
    drag.normal = worldAxis(forearmNode, 'y').clone();
    const j = jointsById.get('wrist');
    drag.startFlex = j.get('flex');
    drag.startDev = j.get('dev');
    drag.offset = drag.startFlex - (hingeAngle(forearmNode, wristNode.position) ?? drag.startFlex);
  } else if (d.type === 'elbow') {
    drag.pivot = forearmNode.getWorldPosition(new THREE.Vector3());
    drag.normal = worldAxis(shoulderNode, 'y').clone();
    const j = jointsById.get('elbow');
    drag.startFlex = j.get('flex');
    drag.startTwist = j.get('twist');
    drag.offset = drag.startFlex - (hingeAngle(shoulderNode, forearmNode.position) ?? drag.startFlex);
  } else if (d.type === 'shoulder') {
    drag.pivot = root.getWorldPosition(new THREE.Vector3());
    drag.normal = camera.getWorldDirection(new THREE.Vector3());
    const j = jointsById.get('shoulder');
    drag.startTwist = j.get('twist');
    drag.startDir = new THREE.Vector3(1, 0, 0).applyQuaternion(shoulderNode.quaternion);
    if (planeHit(drag.pivot, drag.normal)) drag.startHit = root.worldToLocal(hitPt.clone()).normalize();
    else drag.startHit = drag.startDir.clone();
  }
}

function angleCurlAt(t) {
  if (!planeHit(t.base.localToWorld(tmpV2.set(t.offset, 0, 0)), worldAxis(t.base, 'y'))) return null;
  t.base.worldToLocal(hitPt);
  return curlFromAngle(t.key, Math.atan2(hitPt.z, hitPt.x - t.offset) / DEG);
}
function hingeAngle(parentNode, pivotLocal) {
  const pivotWorld = parentNode.localToWorld(tmpV2.copy(pivotLocal));
  if (!planeHit(pivotWorld, worldAxis(parentNode, 'y'))) return null;
  parentNode.worldToLocal(hitPt);
  hitPt.sub(pivotLocal);
  return Math.atan2(hitPt.z, hitPt.x) / DEG;
}

function moveDrag(e) {
  if (!drag) return;
  const dx = e.clientX - drag.lastX, dy = e.clientY - drag.lastY;
  drag.lastX = e.clientX; drag.lastY = e.clientY;
  if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 3) drag.moved = true;
  raycaster.setFromCamera(pointer, camera);

  if (drag.type === 'finger' || drag.type === 'thumb') {
    const key = drag.key;
    if (drag.shift) {
      if (key === 'thumb') THUMB_CHAIN.cmc.set('abd', THUMB_CHAIN.cmc.get('abd') - dy * 0.35);
      else FINGER[key].mcp.set('abd', FINGER[key].mcp.get('abd') - dy * 0.25);
      return;
    }
    const a = angleCurlAt(curlTables[key]);
    if (a == null) return;
    setCurl(key, clamp(drag.startCurl + (a - drag.startAngleCurl), -0.25, 1));
  } else if (drag.type === 'wrist') {
    const j = jointsById.get('wrist');
    if (drag.shift) { j.set('dev', j.get('dev') - dy * 0.3); return; }
    const a = hingeAngle(forearmNode, wristNode.position);
    if (a != null) j.set('flex', a + drag.offset);
  } else if (drag.type === 'elbow') {
    const j = jointsById.get('elbow');
    if (drag.shift) { j.set('twist', j.get('twist') + dx * 0.5); return; }
    const a = hingeAngle(shoulderNode, forearmNode.position);
    if (a != null) j.set('flex', a + drag.offset);
  } else if (drag.type === 'shoulder') {
    const j = jointsById.get('shoulder');
    if (drag.shift) { j.set('twist', j.get('twist') + dx * 0.5); return; }
    if (!planeHit(drag.pivot, drag.normal)) return;
    const hitDir = root.worldToLocal(hitPt.clone()).normalize();
    tmpQ.setFromUnitVectors(drag.startHit, hitDir);
    const dir = drag.startDir.clone().applyQuaternion(tmpQ);
    // +X pointed by Ry(swing) * Rz(elev): dir = (cos e cos s, sin e, -cos e sin s)
    j.set('elev', Math.asin(clamp(dir.y, -1, 1)) / DEG);
    j.set('swing', Math.atan2(-dir.z, dir.x) / DEG);
  }
}

/* Pointer events: capture phase on the stage so a drag on a bone is
   claimed before OrbitControls sees it; everything else orbits. */
let downInfo = null;
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  if (e.target !== renderer.domElement) return;
  stopDemo();
  setPointer(e);
  const hit = pick();
  downInfo = { x: e.clientX, y: e.clientY, struct: hit ? hit.object.userData.structure : null };
  if (hit && hit.object.userData.structure.drag) {
    controls.enabled = false;
    beginDrag(hit.object.userData.structure, e);
    try { renderer.domElement.setPointerCapture(e.pointerId); } catch (_) { /* no capture, still fine */ }
    stage.classList.add('is-dragging');
    e.stopImmediatePropagation();
  }
}, { capture: true });

stage.addEventListener('pointermove', (e) => {
  setPointer(e);
  if (drag) moveDrag(e);
});

function endDrag(e) {
  if (downInfo && !(drag && drag.moved) && Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y) < 4) {
    select(downInfo.struct, false);
  }
  if (drag) {
    drag = null;
    controls.enabled = true;
    stage.classList.remove('is-dragging');
    try { renderer.domElement.releasePointerCapture(e.pointerId); } catch (_) { /* not captured */ }
  }
  downInfo = null;
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('pointerleave', () => { if (!drag) { hovered = null; tip.hidden = true; applyLooks(); } });

/* ============================================================ UI: tooltip, info, index */

const tip = $('#hand-tip');
const infoEmpty = $('#info-empty');
const infoBody = $('#info-body');
const indexList = $('#index-list');

function updateHover() {
  if (drag) return;
  const hit = pick();
  const s = hit ? hit.object.userData.structure : null;
  if (s !== hovered) {
    hovered = s;
    applyLooks();
    renderer.domElement.style.cursor = s ? (s.drag ? 'grab' : 'pointer') : '';
    $$('#index-list [data-id]').forEach(el => el.classList.toggle('is-hover', s && el.dataset.id === s.id));
  }
  if (s) {
    tip.textContent = s.name;
    tip.hidden = false;
    const r = stage.getBoundingClientRect();
    const x = clamp(lastPointer.x + 16, 8, r.width - tip.offsetWidth - 8);
    const y = clamp(lastPointer.y - 12, 8, r.height - 40);
    tip.style.transform = `translate(${x}px, ${y}px)`;
  } else {
    tip.hidden = true;
  }
}

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

const KIND_LABEL = { bone: 'Bone', joint: 'Joint', muscle: 'Muscle', nerve: 'Nerve' };

function renderInfo(s) {
  if (!s) { infoEmpty.hidden = false; infoBody.hidden = true; return; }
  infoEmpty.hidden = true; infoBody.hidden = false;
  const i = s.info;
  let rows = '';
  const row = (k, v) => (v ? `<div class="info-row"><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '');
  if (s.kind === 'muscle') {
    rows = row('Origin', i.origin) + row('Insertion', i.insertion) + row('Action', i.action) + row('Nerve', i.nerve);
  } else if (s.kind === 'nerve') {
    rows = row('Roots', i.roots) + row('Course', i.course) + row('Motor', i.motor) + row('Sensory', i.sensory);
  } else if (s.kind === 'joint') {
    rows = row('Type', i.type) + row('Movement', i.motion);
  } else if (s.kind === 'bone') {
    rows = row('Articulates with', i.articulates);
  }
  const group = s.kind === 'muscle' ? ` · ${MUSCLE_GROUPS[s.group].label}` : '';
  let sliders = '';
  const chain = jointChainFor(s);
  if (chain.length) {
    sliders = `<div class="info-joints"><h4>Move it</h4>${chain.map(j => j.dofs.map(d => sliderHTML(j, d)).join('')).join('')}</div>`;
  }
  infoBody.innerHTML = `
    <span class="info-kind kind-${s.kind}">${KIND_LABEL[s.kind]}${esc(group)}</span>
    <h3>${esc(s.name)}</h3>
    <p>${esc(i.text)}</p>
    ${rows ? `<dl class="info-rows">${rows}</dl>` : ''}
    ${sliders}`;
  bindSliders(infoBody);
}

function jointChainFor(s) {
  if (s.kind === 'joint') return [jointsById.get(s.joint)];
  if (s.kind !== 'bone' || !s.drag) return [];
  const d = s.drag;
  if (d.type === 'finger') { const f = FINGER[d.finger]; return [f.mcp, f.pip, f.dip]; }
  if (d.type === 'thumb') return [THUMB_CHAIN.cmc, THUMB_CHAIN.mcp, THUMB_CHAIN.ip];
  if (d.type === 'wrist') return [jointsById.get('wrist')];
  if (d.type === 'elbow') return [jointsById.get('elbow')];
  if (d.type === 'shoulder') return [jointsById.get('shoulder')];
  return [];
}

function sliderHTML(j, d) {
  const id = `${j.id}.${d.key}`;
  return `<label class="jslider"><span>${esc(d.label)}</span>
    <input type="range" data-dof="${id}" min="${d.min}" max="${d.max}" step="1" value="${Math.round(d.value)}">
    <output data-out="${id}">${Math.round(d.value)}°</output></label>`;
}
function bindSliders(rootEl) {
  $$('input[data-dof]', rootEl).forEach(inp => {
    inp.addEventListener('input', () => {
      stopDemo();
      const [jid, key] = inp.dataset.dof.split('.');
      jointsById.get(jid).set(key, parseFloat(inp.value));
    });
  });
}
function syncSliders() {
  $$('input[data-dof]').forEach(inp => {
    if (document.activeElement === inp) return;
    const [jid, key] = inp.dataset.dof.split('.');
    const v = Math.round(jointsById.get(jid).get(key));
    if (String(v) !== inp.value) { inp.value = v; }
    const out = $(`output[data-out="${inp.dataset.dof}"]`);
    if (out) out.textContent = `${v}°`;
  });
  $$('input[data-curl]').forEach(inp => {
    if (document.activeElement === inp) return;
    const v = Math.round(getCurl(inp.dataset.curl) * 100);
    if (String(v) !== inp.value) { inp.value = v; inp.nextElementSibling.textContent = `${v}%`; }
  });
}

function select(s, focus = true) {
  selected = s || null;
  applyLooks();
  renderInfo(selected);
  $$('#index-list [data-id]').forEach(el => el.classList.toggle('is-selected', selected && el.dataset.id === selected.id));
  if (selected && focus) frameStructure(selected);
  if (selected && matchMedia('(max-width: 860px)').matches) openPanel('info');
}

function buildIndex() {
  const groups = [
    { title: 'Bones', items: structures.filter(s => s.kind === 'bone') },
    { title: 'Joints', items: structures.filter(s => s.kind === 'joint') },
    ...Object.keys(MUSCLE_GROUPS).map(g => ({ title: `Muscles — ${MUSCLE_GROUPS[g].label}`, items: structures.filter(s => s.kind === 'muscle' && s.group === g) })),
    { title: 'Nerves', items: structures.filter(s => s.kind === 'nerve') },
  ];
  indexList.innerHTML = groups.map(g => `
    <details class="index-group" open>
      <summary>${esc(g.title)} <span class="rs-num">${g.items.length}</span></summary>
      <ul>${g.items.map(s => `<li><button type="button" data-id="${s.id}" data-name="${esc(s.name.toLowerCase())}">${esc(s.name)}</button></li>`).join('')}</ul>
    </details>`).join('');
  indexList.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    stopDemo();
    select(structById.get(b.dataset.id), true);
  });
  indexList.addEventListener('pointerover', (e) => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    hovered = structById.get(b.dataset.id);
    applyLooks();
  });
  indexList.addEventListener('pointerleave', () => { hovered = null; applyLooks(); });
  $('#index-search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$('#index-list li').forEach(li => { li.hidden = q && !li.querySelector('button').dataset.name.includes(q); });
    $$('#index-list details').forEach(d => { d.open = true; d.hidden = q && !$$('li:not([hidden])', d).length; });
  });
  $('#count-bones').textContent = groups[0].items.length;
  $('#count-joints').textContent = groups[1].items.length;
  $('#count-muscles').textContent = structures.filter(s => s.kind === 'muscle').length;
  $('#count-nerves').textContent = structures.filter(s => s.kind === 'nerve').length;
}

/* ============================================================ camera */

const box = new THREE.Box3();
let camTween = null;
function frameStructure(s) {
  box.makeEmpty();
  for (const m of s.meshes) box.expandByObject(m);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const dist = clamp(size * 1.9 + 6, 14, 90);
  const dir = camera.position.clone().sub(controls.target).normalize();
  moveCamera(center, center.clone().addScaledVector(dir, dist));
}
function moveCamera(target, position, ms = 650) {
  if (REDUCED) { controls.target.copy(target); camera.position.copy(position); return; }
  camTween = { t0: performance.now(), ms, fromT: controls.target.clone(), toT: target.clone(), fromP: camera.position.clone(), toP: position.clone() };
}
function stepCamera(now) {
  if (!camTween) return;
  const u = smooth(clamp((now - camTween.t0) / camTween.ms, 0, 1));
  controls.target.lerpVectors(camTween.fromT, camTween.toT, u);
  camera.position.lerpVectors(camTween.fromP, camTween.toP, u);
  if (u >= 1) camTween = null;
}
function homeView(animate = true) {
  applyPose();
  const wrist = wristNode.getWorldPosition(new THREE.Vector3());
  const knuckle = FINGER.middle.mcp.node.getWorldPosition(new THREE.Vector3());
  const target = wrist.lerp(knuckle, 0.55);
  const pos = target.clone().add(new THREE.Vector3(7, 9, 46));
  if (animate) moveCamera(target, pos); else { controls.target.copy(target); camera.position.copy(pos); }
}
function armView() {
  const shoulder = root.getWorldPosition(new THREE.Vector3());
  const wrist = wristNode.getWorldPosition(new THREE.Vector3());
  const target = shoulder.lerp(wrist, 0.55);
  moveCamera(target, target.clone().add(new THREE.Vector3(4, 20, 100)));
}

/* ============================================================ demo */

let demo = null;
const DEMO_SEQ = ['open', 'relaxed', 'fist', 'point', 'pinch', 'thumbsup', 'peace', 'ok', 'open'];
function startDemo() {
  stopDemo();
  let i = 0;
  const tick = () => { applyPreset(DEMO_SEQ[i % DEMO_SEQ.length]); i++; };
  tick();
  demo = setInterval(tick, 1900);
  $('#btn-demo').setAttribute('aria-pressed', 'true');
}
function stopDemo() {
  if (!demo) return;
  clearInterval(demo);
  demo = null;
  $('#btn-demo').setAttribute('aria-pressed', 'false');
}

/* ============================================================ panels & controls */

function openPanel(which) {
  $$('.hand-panel').forEach(p => p.classList.toggle('is-open', p.dataset.panel === which));
  $$('[data-open-panel]').forEach(b => b.setAttribute('aria-expanded', b.dataset.openPanel === which ? 'true' : 'false'));
}
$$('[data-open-panel]').forEach(b => b.addEventListener('click', () => {
  const p = $(`.hand-panel[data-panel="${b.dataset.openPanel}"]`);
  openPanel(p.classList.contains('is-open') ? '' : b.dataset.openPanel);
}));
$$('.hand-panel .panel-close').forEach(b => b.addEventListener('click', () => openPanel('')));

$$('input[data-layer]').forEach(inp => {
  inp.checked = layerState[inp.dataset.layer] !== false;
  inp.addEventListener('change', () => { layerState[inp.dataset.layer] = inp.checked; applyLayers(); refreshPickables(); });
});
$('#muscle-opacity').addEventListener('input', (e) => { muscleOpacity = parseFloat(e.target.value); applyLooks(); });
$('#skin-opacity').addEventListener('input', (e) => { skinMaterial.uniforms.opacity.value = parseFloat(e.target.value); });
$('#chk-isolate').addEventListener('change', (e) => { isolate = e.target.checked; applyLooks(); });
$('#chk-autorotate').addEventListener('change', (e) => { controls.autoRotate = e.target.checked; });
$$('button[data-preset]').forEach(b => b.addEventListener('click', () => { stopDemo(); applyPreset(b.dataset.preset); }));
$('#btn-reset-pose').addEventListener('click', () => { stopDemo(); resetPose(); });
$('#btn-demo').addEventListener('click', () => (demo ? stopDemo() : startDemo()));
$('#btn-home').addEventListener('click', () => homeView());
$('#btn-frame-arm').addEventListener('click', () => armView());
$('#btn-clear').addEventListener('click', () => select(null));

/* Pose panel: one curl slider per digit, plus the big joints. */
{
  const pose = $('#pose-sliders');
  const digits = [['thumb', 'Thumb'], ['index', 'Index'], ['middle', 'Middle'], ['ring', 'Ring'], ['little', 'Little']];
  pose.innerHTML = digits.map(([k, l]) => `<label class="jslider"><span>${l} curl</span>
      <input type="range" data-curl="${k}" min="-25" max="100" step="1" value="0"><output>0%</output></label>`).join('')
    + [['wrist', 'flex'], ['wrist', 'dev'], ['elbow', 'flex'], ['elbow', 'twist'], ['shoulder', 'elev'], ['shoulder', 'swing']]
      .map(([jid, key]) => sliderHTML(jointsById.get(jid), jointsById.get(jid).dof(key))).join('');
  bindSliders(pose);
  $$('input[data-curl]', pose).forEach(inp => inp.addEventListener('input', () => {
    stopDemo();
    setCurl(inp.dataset.curl, parseFloat(inp.value) / 100);
    inp.nextElementSibling.textContent = `${inp.value}%`;
  }));
  const all = $('#joint-sliders');
  all.innerHTML = joints.map(j => `<div class="jgroup"><h5>${esc(jointsById.get(j.id).text?.name || j.id)}</h5>${j.dofs.map(d => sliderHTML(j, d)).join('')}</div>`).join('');
  bindSliders(all);
}

/* Keyboard: R resets, 1–8 presets, Esc clears. Only when the stage has focus. */
stage.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  const presets = Object.keys(PRESETS);
  if (e.key === 'r' || e.key === 'R') { stopDemo(); resetPose(); }
  else if (e.key === 'Escape') select(null);
  else if (/^[1-8]$/.test(e.key) && presets[+e.key - 1]) { stopDemo(); applyPreset(presets[+e.key - 1]); }
});

/* ============================================================ public API
   For the day real sensors arrive: window.RoboHand.setJoint('mcp2', 'flex', 45)
   or window.RoboHand.setCurl('index', 0.7). Angles are degrees, curl is 0–1. */
const listeners = new Set();
window.RoboHand = {
  joints: () => joints.map(j => ({ id: j.id, name: j.text?.name || j.id, dofs: j.dofs.map(d => ({ key: d.key, label: d.label, min: d.min, max: d.max, value: d.value })) })),
  getJoint: (id, key) => jointsById.get(id)?.get(key),
  setJoint: (id, key, deg) => { stopDemo(); jointsById.get(id)?.set(key, deg); },
  setCurl: (digit, c) => { stopDemo(); setCurl(digit, clamp(c, -0.25, 1)); },
  getCurl,
  pose: (name) => applyPreset(name),
  reset: () => resetPose(),
  snapshot: snapshotPose,
  apply: (snap) => { stopDemo(); applySnapshot(snap); },
  select: (id) => select(structById.get(id) || null),
  structures: () => structures.map(s => ({ id: s.id, kind: s.kind, name: s.name })),
  onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
};

/* ============================================================ loop */

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
new ResizeObserver(resize).observe(stage);
resize();

buildIndex();
applyLayers();
refreshPickables();
renderInfo(null);
homeView(false);

/* Deep links: hand.html?pose=fist&view=arm&zoom=0.7&select=median */
{
  const q = new URLSearchParams(location.search);
  if (q.get('pose') && PRESETS[q.get('pose')]) applyPreset(q.get('pose'), false);
  applyPose();
  if (q.get('view') === 'arm') { armView(); if (camTween) { controls.target.copy(camTween.toT); camera.position.copy(camTween.toP); camTween = null; } }
  else homeView(false);
  const zoom = parseFloat(q.get('zoom'));
  if (zoom > 0) camera.position.sub(controls.target).multiplyScalar(zoom).add(controls.target);
  if (q.get('select') && structById.has(q.get('select'))) select(structById.get(q.get('select')), false);
}

let syncAt = 0;
renderer.setAnimationLoop((now) => {
  stepTween(now);
  stepCamera(now);
  if (poseDirty) {
    applyPose();
    updateSoftTissue();
    poseDirty = false;
    if (now - syncAt > 80) { syncSliders(); syncAt = now; for (const fn of listeners) fn(); }
  }
  if (pointerMoved) { updateHover(); pointerMoved = false; }
  controls.update();
  renderer.render(scene, camera);
});

clearTimeout(broken);
stage.classList.add('is-ready');
