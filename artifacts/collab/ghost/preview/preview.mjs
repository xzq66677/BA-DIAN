import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createAttachment } from '../src/attachment.mjs';
import { createGhostVisual } from '../src/ghost-visual.mjs';

const stage = document.querySelector('#stage');
const status = document.querySelector('#status');
const actions = [...document.querySelectorAll('[data-action]')];
const hostButtons = [...document.querySelectorAll('[data-host]')];
const move = document.querySelector('#move');
for (const button of [...actions, ...hostButtons, move]) button.disabled = true;

const scene = new T.Scene();
scene.background = new T.Color(0x152731);
scene.fog = new T.FogExp2(0x152731, 0.082);
const camera = new T.PerspectiveCamera(35, 1, 0.1, 36);
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.38;
stage.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.minDistance = 2;
controls.maxDistance = 12;
controls.maxPolarAngle = Math.PI / 2 - 0.04;

scene.add(new T.HemisphereLight(0xcefff2, 0x5c466f, 2.05));
function light(color, intensity, position) {
  const source = new T.DirectionalLight(color, intensity);
  source.position.set(...position);
  scene.add(source);
}
light(0xffdaa9, 2.4, [-3, 6, 3]);
light(0x75cbff, 4.4, [1, 3, -4]);

function surface(color, emissive = 0, metalness = 0) {
  return new T.MeshStandardMaterial({ color, emissive, metalness, flatShading: true, roughness: 0.85 });
}

function object(parent, geometry, material, xyz, scale = [1, 1, 1]) {
  const mesh = new T.Mesh(geometry, material);
  mesh.position.set(...xyz);
  mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
}

const basalt = surface(0x202f42);
const edge = surface(0x1c212a);
const grout = surface(0x54646b, 0x152b33);
const rune = surface(0x367c79, 0x174942);
const metal = surface(0x695d49, 0x1d1b13, 0.5);
object(scene, new T.CylinderGeometry(2.39, 2.36, 0.23, 16), edge, [0, -0.194, 0]);
object(scene, new T.CylinderGeometry(2.28, 2.39, 0.099, 16), basalt, [0, -0.05, 0]);
for (const [radius, count, material] of [[1.75, 64, grout], [2.095, 16, metal], [1.92, 16, rune]]) {
  const disc = object(scene, new T.RingGeometry(radius, radius + 0.014, count), material, [0, 0.001, 0]);
  disc.rotation.x = -Math.PI / 2;
  disc.rotation.z = -Math.PI / 2;
}
const runeShape = new T.BoxGeometry(0.075, 0.009, 0.15);
for (let i = 0; i < 16; i++) {
  const angle = i * Math.PI / 8;
  const o = object(scene, runeShape, i % 4 === 0 ? rune : grout, [1.99 * Math.sin(angle), 0.003, 1.99 * Math.cos(angle)]);
  o.rotation.y = angle - 0.32;
}
object(scene, new T.CircleGeometry(16, 40), surface(0x111c26), [0, -0.44, 0]).rotation.x = -Math.PI / 2;

const hostRoot = new T.Group();
const guard = new T.Group();
const idol = new T.Group();
hostRoot.add(guard, idol);
scene.add(hostRoot);
const stone = new T.DodecahedronGeometry(1);
const plates = surface(0x9b7a58);
const uniform = surface(0x535247);
const leather = surface(0x312f32);
const fire = surface(0xffcf76, 0xff8736);
const square = new T.BoxGeometry(1, 1, 1);
const visor = object(guard, square, leather, [0, 1.4, 0.133], [0.22, 0.072, 0.024]);
visor.renderOrder = 1;
object(guard, stone, plates, [0, 1.41, 0.013], [0.171, 0.202, 0.155]);
object(guard, stone, uniform, [0, 1.005, 0], [0.286, 0.326, 0.19]);
object(guard, square, leather, [0, 0.77, 0.009], [0.353, 0.103, 0.25]);
object(guard, square, plates, [0, 0.77, 0.15], [0.07, 0.069, 0.028]);
for (const side of [-1, 1]) {
  object(guard, stone, plates, [side * 0.272, 1.17, 0], [0.125, 0.117, 0.158]);
  object(guard, stone, leather, [side * 0.285, 0.968, 0.026], [0.069, 0.178, 0.071]);
  object(guard, stone, plates, [side * 0.298, 0.818, 0.038], [0.081, 0.115, 0.09]);
  object(guard, stone, uniform, [side * 0.112, 0.564, -0.019], [0.108, 0.253, 0.123]);
  object(guard, stone, plates, [side * 0.115, 0.3, 0.014], [0.095, 0.216, 0.098]);
  object(guard, stone, leather, [side * 0.12, 0.071, 0.053], [0.111, 0.111, 0.172]);
  object(guard, square, fire, [side * 0.047, 1.401, 0.151], [0.034, 0.01, 0.014]);
}
const rock = surface(0x56546b);
const amberStone = surface(0x9d846b, 0x3c2315);
object(idol, stone, rock, [0, 1.27, 0], [0.34, 0.39, 0.262]);
object(idol, stone, amberStone, [0, 1.79, -0.005], [0.218, 0.252, 0.193]);
object(idol, square, fire, [0, 1.79, 0.18], [0.125, 0.028, 0.015]);
for (const side of [-1, 1]) {
  object(idol, stone, rock, [side * 0.314, 1.235, -0.02], [0.263, 0.24, 0.25]);
  object(idol, stone, rock, [side * 0.36, 0.9, 0.057], [0.165, 0.25, 0.187]);
  object(idol, stone, rock, [side * 0.16, 0.569, -0.01], [0.172, 0.358, 0.176]);
  object(idol, stone, rock, [side * 0.166, 0.18, 0.064], [0.205, 0.218, 0.26]);
}
const idolAnchor = new T.Group();
idolAnchor.position.set(0.12, 0.28, -0.12);
idol.add(idolAnchor);
const hosts = {
  guard: { root: guard },
  idol: { root: idol, anchor: idolAnchor, offset: [0.42, 0.15, -0.87] },
};

const gltf = await new GLTFLoader().loadAsync(new URL('../model/ghost.glb', import.meta.url).href).catch((error) => {
  status.value = '鬼影模型加载失败';
  throw error;
});
const ghost = createGhostVisual(gltf);
const attachment = createAttachment(ghost);
scene.add(ghost.root);
const clips = new Map(gltf.animations.map((clip) => [clip.name, clip.duration]));
const names = { idle: '待机', attach: '附身中', attached_idle: '已附身', drain: '吸取能量', flinch: '受伤', dead: '烟化消散' };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let host = 'guard';
let action = 'idle';
let time = 0;
let moving = false;
let travel = 0;
let frozen = false;
let frame;

function selectHost(id) {
  host = id;
  guard.visible = host === 'guard';
  idol.visible = host === 'idol';
  hostButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.host === host)));
}

function setAction(next) {
  action = next;
  time = 0;
  const selected = action === 'attached_idle' ? 'attach' : action;
  for (const button of actions) button.setAttribute('aria-pressed', String(button.dataset.action === selected));
  status.value = names[action];
}

function shot(wide) {
  const mobile = stage.clientWidth < 550;
  if (wide) {
    controls.target.set(0.25, 0.9, -0.1);
    camera.position.set(mobile ? 5.7 : 4.25, mobile ? 3.25 : 2.75, mobile ? 5.0 : 3.85);
  } else {
    controls.target.set(0, 0.82, -0.15);
    camera.position.set(mobile ? 2.9 : 2.45, 1.97, mobile ? 5.85 : 4.03);
  }
  controls.update();
}

function hostMotion() {
  hostRoot.position.set(-0.20 + 0.48 * Math.sin(travel), 0, 0.18 - 0.35 * Math.sin(travel * 1.31));
  hostRoot.rotation.y = 0.16 + 0.68 * Math.sin(travel * 1.25);
}

function reset() {
  attachment.detach();
  travel = 0;
  moving = false;
  move.setAttribute('aria-pressed', 'false');
  hostMotion();
  hostRoot.visible = false;
  ghost.root.position.set(0, 0, 0);
  ghost.root.rotation.set(0, 0.03, 0);
  setAction('idle');
  shot(false);
}

function mount() {
  if (action === 'dead') reset();
  hostRoot.visible = true;
  if (!attachment.active) {
    ghost.root.position.set(1.16, 0, 0.02);
    ghost.root.rotation.set(0, -0.54, 0);
  }
  attachment.attach(hosts[host]);
  setAction('attach');
  shot(true);
}

function play(next) {
  frozen = false;
  if (next === 'idle') reset();
  else if (next === 'attach') mount();
  else {
    if (action === 'dead') reset();
    if (next === 'drain' && !attachment.active) {
      mount();
      attachment.update(clips.get('attach'));
    }
    setAction(next);
  }
}

function resize() {
  camera.aspect = stage.clientWidth / stage.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(stage.clientWidth, stage.clientHeight, false);
}
const observer = new ResizeObserver(resize);
observer.observe(stage);
selectHost(host);
resize();
reset();
for (const button of actions) button.addEventListener('click', () => play(button.dataset.action));
for (const button of hostButtons) button.addEventListener('click', () => {
  const changed = host !== button.dataset.host;
  selectHost(button.dataset.host);
  if (changed && attachment.active) mount();
});
move.addEventListener('click', () => {
  frozen = false;
  if (!hostRoot.visible) mount();
  moving = !moving;
  move.setAttribute('aria-pressed', String(moving));
});
for (const button of [...actions, ...hostButtons, move]) button.disabled = false;

function render(fraction) {
  ghost.sample(action, fraction);
  controls.update();
  renderer.render(scene, camera);
}

let previous = performance.now();
function tick(now) {
  frame = requestAnimationFrame(tick);
  const delta = Math.min(0.06, (now - previous) / 1000);
  previous = now;
  if (frozen) return;
  time += delta;
  if (moving && !reducedMotion.matches) {
    travel += delta * 1.22;
    hostMotion();
  }
  const finish = reducedMotion.matches;
  const progress = attachment.update(finish ? 5 : delta);
  const loop = action === 'idle' || action === 'attached_idle';
  let fraction = time / clips.get(action);
  if (action === 'attach') fraction = progress;
  if (loop) fraction = finish ? 0 : fraction % 1;
  else if (fraction >= 1 || finish) {
    if (action === 'dead') {
      fraction = 1;
    } else {
      const next = attachment.active ? 'attached_idle' : 'idle';
      setAction(next);
      fraction = 0;
    }
  }
  render(Math.min(1, fraction));
}
frame = requestAnimationFrame(tick);

// Allows deterministic frame captures of the same player exercised by the controls.
window.ghostPreview = {
  seek(next, fraction, target) {
    reset();
    frozen = true;
    if (target) {
      selectHost(target);
      mount();
      attachment.update(clips.get('attach') * (next === 'attach' ? fraction : 1));
    }
    setAction(next);
    render(fraction);
  },
  read() {
    return {
      action, host, progress: attachment.progress, attached: attachment.active,
      follower: ghost.root.getWorldPosition(new T.Vector3()).toArray(),
      hostLocal: (hosts[host].anchor ?? hosts[host].root).worldToLocal(ghost.root.getWorldPosition(new T.Vector3())).toArray(),
      render: { ...renderer.info.render }, memory: { ...renderer.info.memory },
    };
  },
};

window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  cancelAnimationFrame(frame);
  observer.disconnect();
  controls.dispose();
  attachment.detach();
  ghost.dispose();
  const geometries = new Set();
  const materials = new Set();
  for (const group of [scene, gltf.scene]) group.traverse((o) => {
    if (!o.isMesh) return;
    geometries.add(o.geometry);
    materials.add(o.material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  renderer.dispose();
});
