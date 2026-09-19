import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const FLOOR_Y = -8;

// Renderer, camera, lights and the render loop. `onFrame(dt)` runs before every render.
export function createScene(canvas, onFrame) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 300);
  camera.position.set(15, 15, 54);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 5, 0);
  controls.enableDamping = true;
  controls.minDistance = 18;
  controls.maxDistance = 90;

  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(14, 30, 22);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -20, right: 20, top: 30, bottom: -12 });
  const rim = new THREE.DirectionalLight(0x7fb2ff, 1.6);
  rim.position.set(-18, 12, -20);
  scene.add(key, rim, new THREE.HemisphereLight(0xdfe8ff, 0x1a1d24, 1.8));

  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.ShadowMaterial({ opacity: 0.35 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  const grid = new THREE.GridHelper(80, 40, 0x3a4150, 0x232833);
  grid.position.y = FLOOR_Y;
  scene.add(floor, grid);

  // The canvas is full-window on desktop and a strip above the panels on a phone,
  // so the renderer follows the canvas's own size.
  let width = 0;
  let height = 0;
  function fitCanvas() {
    if (canvas.clientWidth === width && canvas.clientHeight === height) return;
    ({ clientWidth: width, clientHeight: height } = canvas);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const timer = new THREE.Timer();
  renderer.setAnimationLoop((time) => {
    fitCanvas();
    timer.update(time);
    onFrame(timer.getDelta() * 1000);
    controls.update();
    renderer.render(scene, camera);
  });

  return scene;
}
