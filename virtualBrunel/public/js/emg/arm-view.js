import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const DEG = Math.PI / 180;
const EASE = 0.2; // share of the remaining rotation covered per frame
// Share of the wheel's roll / pitch the forearm shows, so it stays inside the narrow frame.
const SWING_SHOWN = 0.55;
const PITCH_SHOWN = 0.5;

// The wearer's view down onto the arm. The shoulder is fixed off one bottom corner and
// the upper arm never moves; the forearm swings from the elbow (the origin) to point
// where the grip wheel's pointer goes. The flexor pad faces the body, the extensor pad
// and the pod face out.
const SHOULDER_SIDE = 1; // 1: shoulder bottom-right, -1: bottom-left
const UPPER_ARM = 9;
const FOREARM = 10;
const STRAP_Y = 3.9;
const radiusAt = (y) => 1.9 - 0.065 * y; // forearm radius, y measured from the elbow

export const SENSOR_COLORS = { flex: '#ff7a1a', ext: '#3aa0ff' };

// A slice of the tapered forearm between two heights, `pad` thicker than the skin.
function sleeve(from, to, pad, material) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusAt(to) + pad, radiusAt(from) + pad, to - from, 40), material);
  mesh.position.y = (from + to) / 2;
  return mesh;
}

// An electrode pad that lights up with effort: emissive face plus an additive halo.
function sensor(side, color) {
  const group = new THREE.Group();
  group.position.set(side * (radiusAt(STRAP_Y) + 0.3), STRAP_Y, 0);

  const face = new THREE.MeshStandardMaterial({ color: 0x15171b, emissive: color, emissiveIntensity: 0, roughness: 0.6 });
  const glow = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  group.add(
    new THREE.Mesh(new RoundedBoxGeometry(0.55, 2, 1.5, 3, 0.18), face),
    new THREE.Mesh(new THREE.SphereGeometry(1.5, 24, 16), glow),
  );

  return {
    group,
    // level: effort 0–1; active: past the ON threshold.
    light(level, active) {
      face.emissiveIntensity = level * (active ? 3 : 1.2);
      glow.opacity = level * (active ? 0.55 : 0.2);
    },
  };
}

// Built along +Y from the elbow. Body side is +X * SHOULDER_SIDE, outer side the opposite.
function buildForearm(materials) {
  const forearm = new THREE.Group();
  const end = new THREE.Mesh(new THREE.SphereGeometry(radiusAt(FOREARM), 32, 16), materials.skin);
  end.position.y = FOREARM;
  forearm.add(
    sleeve(0, FOREARM, 0, materials.skin),
    end,
    sleeve(0, 6.8, 0.1, materials.fabric),
    sleeve(STRAP_Y - 0.8, STRAP_Y + 0.8, 0.2, materials.strap),
  );

  const sensors = { flex: sensor(SHOULDER_SIDE, SENSOR_COLORS.flex), ext: sensor(-SHOULDER_SIDE, SENSOR_COLORS.ext) };
  forearm.add(sensors.flex.group, sensors.ext.group);
  return { forearm, sensors };
}

// Runs from the elbow back and up to the shoulder, with the pod on its outer face.
function buildUpperArm(materials) {
  const along = new THREE.Vector3(0.55 * SHOULDER_SIDE, 0.5, 0.65).normalize();
  const outward = new THREE.Vector3(-along.z, 0, along.x).multiplyScalar(SHOULDER_SIDE).normalize();
  const upperArm = new THREE.Group();
  upperArm.applyMatrix4(new THREE.Matrix4().makeBasis(outward, along, new THREE.Vector3().crossVectors(outward, along)));

  const limb = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.05, UPPER_ARM, 40), materials.fabric);
  limb.position.y = UPPER_ARM / 2;
  const pod = new THREE.Mesh(new RoundedBoxGeometry(0.7, 2.4, 2, 3, 0.25), materials.plastic);
  pod.position.set(2.5, 3.4, 0);
  upperArm.add(limb, pod);
  return upperArm;
}

// Renders on demand: call draw() from the owner's frame loop.
export function createArmView(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 1, 100);
  camera.position.set(0, 22, 8);
  camera.lookAt(0, 0, -3.2);

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 12, 6);
  scene.add(key, new THREE.HemisphereLight(0xdfe8ff, 0x20242c, 1.6));

  const materials = {
    skin: new THREE.MeshStandardMaterial({ color: 0xd9a582, roughness: 0.75 }),
    fabric: new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.95 }),
    strap: new THREE.MeshStandardMaterial({ color: 0x2e3138, roughness: 0.9 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.35 }),
  };

  const upperArm = buildUpperArm(materials);
  const elbow = new THREE.Mesh(new THREE.SphereGeometry(radiusAt(0) + 0.15, 32, 16), materials.fabric);
  const { forearm, sensors } = buildForearm(materials);
  const swing = new THREE.Group(); // elbow joint: yaw on the group, pitch on the forearm inside it
  swing.add(forearm);
  const cable = new THREE.Mesh(new THREE.BufferGeometry(), materials.plastic);
  scene.add(upperArm, elbow, swing, cable);

  // The cable leaves the pod, rounds the outside of the elbow and ends at the strap, so
  // it has to be re-laid whenever the forearm moves.
  function layCable() {
    scene.updateMatrixWorld(true);
    const out = -SHOULDER_SIDE;
    const path = new THREE.CatmullRomCurve3([
      upperArm.localToWorld(new THREE.Vector3(2.55, 2.2, 0)),
      upperArm.localToWorld(new THREE.Vector3(2.35, 0.6, 0.3)),
      forearm.localToWorld(new THREE.Vector3(out * 2.05, 1.4, 0.5)),
      forearm.localToWorld(new THREE.Vector3(out * (radiusAt(STRAP_Y) + 0.25), STRAP_Y - 0.9, 0.2)),
    ]);
    cable.geometry.dispose();
    cable.geometry = new THREE.TubeGeometry(path, 32, 0.09, 8);
  }

  let width = 0;
  let height = 0;
  let roll = 0;
  let pitch = 0;
  let posed = false;

  return {
    // effort (0–1) and active (past the ON threshold) are keyed by channel: flex, ext.
    // orientation is the { roll, pitch } in degrees that also drives the grip wheel.
    draw({ effort, active, orientation }) {
      if (!canvas.clientWidth) return;
      if (canvas.clientWidth !== width || canvas.clientHeight !== height) {
        ({ clientWidth: width, clientHeight: height } = canvas);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }

      const moving = Math.abs(orientation.roll - roll) + Math.abs(orientation.pitch - pitch) > 0.05;
      if (moving || !posed) {
        posed = true;
        roll += (orientation.roll - roll) * EASE;
        pitch += (orientation.pitch - pitch) * EASE;
        swing.rotation.y = -roll * SWING_SHOWN * DEG; // pointer right swings the forearm right
        forearm.rotation.x = (pitch * PITCH_SHOWN - 90) * DEG; // lying flat, pointing away; pitch lifts the far end
        layCable();
      }

      for (const [channel, pad] of Object.entries(sensors)) pad.light(effort[channel], active[channel]);
      renderer.render(scene, camera);
    },
  };
}
