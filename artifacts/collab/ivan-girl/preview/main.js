import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createIvanGirl, skinnedBounds } from './ivan-girl.js';

const TAU = Math.PI * 2;
const stage = document.querySelector('#stage');
const status = document.querySelector('#status');
const progressBar = document.querySelector('#progressBar');
if (window.__ivanGirlRenderer) {
  window.__ivanGirlRenderer.setAnimationLoop(null);
  window.__ivanGirlRenderer.dispose();
}
stage.querySelectorAll('canvas').forEach((canvas) => canvas.remove());
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
window.__ivanGirlRenderer = renderer;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#171713');
scene.fog = new THREE.FogExp2('#171713', .045);
const camera = new THREE.PerspectiveCamera(33, stage.clientWidth / stage.clientHeight, .05, 40);
camera.position.set(2.75, 1.95, 4.15);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, .88, 0);
controls.enableDamping = true;
controls.dampingFactor = .07;
controls.minDistance = 1.4;
controls.maxDistance = 7;
controls.maxPolarAngle = Math.PI * .49;
controls.autoRotate = true;
controls.autoRotateSpeed = .5;
controls.update();

const pmrem = new THREE.PMREMGenerator(renderer);
const environment = pmrem.fromScene(new RoomEnvironment(), .04);
scene.environment = environment.texture;
scene.environmentIntensity = .82;
pmrem.dispose();
scene.add(new THREE.HemisphereLight('#ffe8bd', '#25271e', 1.4));
const key = new THREE.DirectionalLight('#ffdda1', 4.1);
key.position.set(-3.4, 5.2, 4.2);
key.castShadow = true;
key.shadow.mapSize.set(1536, 1536);
key.shadow.camera.left = key.shadow.camera.bottom = -2.6;
key.shadow.camera.right = key.shadow.camera.top = 2.6;
key.shadow.camera.near = .5;
key.shadow.camera.far = 12;
key.shadow.bias = -.00035;
key.shadow.normalBias = .02;
scene.add(key);
const rim = new THREE.DirectionalLight('#d56d3b', 3.0);
rim.position.set(3, 3.2, -3);
scene.add(rim);
const fill = new THREE.PointLight('#8fb5b0', 15, 7, 2);
fill.position.set(-2, 1.4, 1.5);
scene.add(fill);

const floor = new THREE.Mesh(new THREE.CircleGeometry(4.5, 80), new THREE.MeshStandardMaterial({ color: '#24251d', roughness: .92, metalness: .08 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -.012;
floor.receiveShadow = true;
scene.add(floor);
const plinth = new THREE.Mesh(new THREE.CylinderGeometry(.78, .86, .07, 64), new THREE.MeshStandardMaterial({ color: '#51422c', roughness: .48, metalness: .5 }));
plinth.position.y = -.038;
plinth.receiveShadow = true;
scene.add(plinth);
for (const radius of [.88, 1.16, 1.72, 2.4]) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, radius === .88 ? .011 : .004, 5, 96), new THREE.MeshBasicMaterial({ color: radius === .88 ? '#d6a45b' : '#65543b', transparent: true, opacity: radius === .88 ? .8 : .4 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = .004;
  scene.add(ring);
}
for (let index = 0; index < 32; index++) {
  const angle = index / 32 * TAU;
  const tick = new THREE.Mesh(new THREE.BoxGeometry(.01, .003, index % 4 === 0 ? .13 : .06), new THREE.MeshBasicMaterial({ color: index % 4 === 0 ? '#d6a45b' : '#6d5b40' }));
  tick.position.set(Math.sin(angle) * 1.0, .006, Math.cos(angle) * 1.0);
  tick.rotation.y = angle;
  scene.add(tick);
}

const asset = createIvanGirl();
scene.add(asset.root);
const resetRest = () => {
  for (const bone of asset.bones) {
    const rest = asset.restPose.get(bone.name);
    bone.position.copy(rest.position);
    bone.quaternion.copy(rest.quaternion);
    bone.scale.copy(rest.scale);
  }
  asset.root.updateMatrixWorld(true);
};
const mixer = new THREE.AnimationMixer(asset.root);
const actions = new Map(asset.clips.map((clip) => [clip.name, mixer.clipAction(clip)]));
let current = null;
let currentName = 'idle';
let exportInProgress = false;
const setStatus = (message) => { status.textContent = message; };
const markActive = (name) => document.querySelectorAll('[data-clip]').forEach((button) => button.classList.toggle('active', button.dataset.clip === name));
const play = (name, loop = name === 'idle' || name === 'walk') => {
  if (!actions.has(name)) throw new Error(`Unknown animation: ${name}`);
  current?.fadeOut(.14);
  current = actions.get(name);
  current.reset();
  current.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  current.clampWhenFinished = !loop;
  current.fadeIn(.14);
  current.play();
  currentName = name;
  markActive(name);
  const messages = {
    throw: '抱弹举起 → 过顶投掷 → 引信火星 → 抛物线飞出',
    victory: '双手举弹展示 → 轻微摇摆 → 回到待机',
    reviveRise: '倒地动画精确倒放：从地面起身',
  };
  setStatus(messages[name] ?? `正在播放：${name}`);
  progressBar.style.width = '0%';
  return name;
};
mixer.addEventListener('finished', (event) => {
  if (currentName === event.action.getClip().name) play('idle');
});
document.querySelectorAll('[data-clip]').forEach((button) => button.addEventListener('click', () => play(button.dataset.clip, button.dataset.clip === 'idle' || button.dataset.clip === 'walk')));
controls.addEventListener('start', () => { controls.autoRotate = false; });

const seek = (name, time) => {
  if (!actions.has(name)) throw new Error(`Unknown animation: ${name}`);
  mixer.stopAllAction();
  resetRest();
  const action = actions.get(name);
  action.reset().play();
  action.time = Math.max(0, Math.min(action.getClip().duration, time));
  mixer.update(0);
  action.paused = true;
  asset.root.updateMatrixWorld(true);
  current = action;
  currentName = name;
  markActive(name);
  setStatus(`逐帧检查：${name} @ ${time.toFixed(3)}s`);
  progressBar.style.width = `${time / action.getClip().duration * 100}%`;
};
const setView = (view) => {
  controls.autoRotate = false;
  const views = {
    front: [[2.75, 1.95, 4.15], [0, .88, 0]],
    side: [[4.25, 1.65, .15], [0, .88, 0]],
    back: [[-2.4, 1.85, -4.0], [0, .88, 0]],
    face: [[.45, 1.48, 1.65], [0, 1.40, .03]],
    projectile: [[2.9, 2.0, 4.7], [0, 1.0, .85]],
    hair: [[1.05, 1.62, -1.38], [0, 1.34, -.04]],
  };
  const [position, target] = views[view] ?? views.front;
  camera.position.set(...position);
  controls.target.set(...target);
  controls.update();
};
const exportGlb = async () => {
  if (exportInProgress) throw new Error('Export already in progress');
  exportInProgress = true;
  try {
    mixer.stopAllAction();
    resetRest();
    const result = await new GLTFExporter().parseAsync(asset.root, { binary: true, animations: asset.clips, onlyVisible: true, maxTextureSize: 256 });
    const response = await fetch('/__export', { method: 'POST', headers: { 'Content-Type': 'model/gltf-binary' }, body: result });
    if (!response.ok) throw new Error(`Export endpoint HTTP ${response.status}`);
    const saved = await response.json();
    play('idle');
    setStatus(`GLB 已保存：${saved.file} · ${(saved.bytes / 1024 / 1024).toFixed(2)} MB · SHA-256 ${saved.sha256.slice(0, 12)}…`);
    return saved;
  } finally {
    exportInProgress = false;
  }
};
document.querySelector('#export').addEventListener('click', async () => {
  try { await exportGlb(); } catch (error) { setStatus(`导出失败：${error.message}`); }
});

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const reloadGlb = async (buffer) => loader.parseAsync(buffer, '');
const measureReloadRenderer = (gltf) => {
  asset.root.visible = false;
  scene.add(gltf.scene);
  renderer.render(scene, camera);
  const result = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
  gltf.scene.removeFromParent();
  asset.root.visible = true;
  renderer.render(scene, camera);
  return result;
};
const textures = new Set();
asset.root.traverse((object) => {
  if (!object.material) return;
  for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
  }
});
document.querySelector('#triangles').textContent = asset.stats.triangles.toLocaleString();
document.querySelector('#bones').textContent = asset.stats.bones;
document.querySelector('#meshes').textContent = `${asset.stats.meshes} / ${asset.stats.materials}`;
document.querySelector('#height').textContent = `${asset.stats.height.toFixed(3)} m`;
document.querySelector('#clips').textContent = asset.clips.length;
document.querySelector('#textures').textContent = textures.size;
setStatus('本地程序化 PBR 模型就绪；Tripo 凭据缺失，未调用外部生成服务。');
play('idle');

const clock = new THREE.Clock();
let elapsed = 0;
renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  elapsed += delta;
  mixer.update(delta);
  if (current && !current.loop && current.isRunning()) progressBar.style.width = `${Math.min(100, current.time / current.getClip().duration * 100)}%`;
  controls.update();
  renderer.render(scene, camera);
});

window.__ivanGirl = {
  ready: true,
  stats: asset.stats,
  textureCount: textures.size,
  play,
  seek,
  setView,
  exportGlb,
  reloadGlb,
  createMixer: (object) => new THREE.AnimationMixer(object),
  measureReloadRenderer,
  measureSkinnedBounds: (object = asset.root) => {
    const bounds = skinnedBounds(object);
    return { min: bounds.min.toArray(), max: bounds.max.toArray(), size: bounds.size.toArray() };
  },
  getBoneState: (name) => {
    const bone = asset.bones.find((item) => item.name === name);
    return bone ? { position: bone.position.toArray(), quaternion: bone.quaternion.toArray(), scale: bone.scale.toArray() } : null;
  },
  getClipTrack: (clipName, trackName) => {
    const track = asset.clips.find((clip) => clip.name === clipName)?.tracks.find((item) => item.name === trackName);
    return track ? { times: [...track.times], values: [...track.values] } : null;
  },
  resetCamera: () => setView('front'),
  getState: () => ({
    current: currentName,
    time: current?.time ?? 0,
    running: current?.isRunning() ?? false,
    elapsed,
    renderer: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
    bounds: new THREE.Box3().setFromObject(asset.root, true).getSize(new THREE.Vector3()).toArray(),
    bombHeight: asset.bones.find((bone) => bone.name === 'HeldBomb').getWorldPosition(new THREE.Vector3()).y,
    handGripDistances: ['L', 'R'].map((side) => {
      const hand = asset.bones.find((bone) => bone.name === `Hand${side}`);
      const bomb = asset.bones.find((bone) => bone.name === 'HeldBomb');
      const offset = new THREE.Vector3(side === 'L' ? -.132 : .132, -.025, .035);
      return hand.getWorldPosition(new THREE.Vector3()).distanceTo(bomb.localToWorld(offset));
    }),
  }),
};
const resize = () => {
  camera.aspect = stage.clientWidth / stage.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(stage.clientWidth, stage.clientHeight);
};
window.addEventListener('resize', resize);
