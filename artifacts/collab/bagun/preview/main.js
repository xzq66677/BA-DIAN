import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createBagun } from './bagun.js';

const stage = document.querySelector('#stage');
const status = document.querySelector('#status');
const progressBar = document.querySelector('#progressBar');
const timeLabel = document.querySelector('#timeLabel');
const timeline = document.querySelector('#timeline');
window.__bagunRenderer?.setAnimationLoop(null);
window.__bagunRenderer?.dispose();
stage.querySelectorAll('canvas').forEach((canvas) => canvas.remove());

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
window.__bagunRenderer = renderer;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(stage.clientWidth, stage.clientHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#111310');
scene.fog = new THREE.FogExp2('#111310', .055);
const camera = new THREE.PerspectiveCamera(33, stage.clientWidth / stage.clientHeight, .05, 40);
camera.position.set(3.15, 2.3, 4.45);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.05, 0);
controls.enableDamping = true;
controls.dampingFactor = .07;
controls.minDistance = 2.4;
controls.maxDistance = 7;
controls.maxPolarAngle = Math.PI * .49;
controls.autoRotate = true;
controls.autoRotateSpeed = .5;
controls.update();

const pmrem = new THREE.PMREMGenerator(renderer);
const environment = pmrem.fromScene(new RoomEnvironment(), .04);
scene.environment = environment.texture;
scene.environmentIntensity = .72;
pmrem.dispose();
scene.add(new THREE.HemisphereLight('#e6d7b8', '#25231a', 1.3));
const key = new THREE.DirectionalLight('#ffe2ad', 4.0);
key.position.set(-3.5, 5.5, 4);
key.castShadow = true;
key.shadow.mapSize.set(1536, 1536);
key.shadow.camera.left = key.shadow.camera.bottom = -3;
key.shadow.camera.right = key.shadow.camera.top = 3;
key.shadow.camera.near = .5;
key.shadow.camera.far = 13;
key.shadow.bias = -.00035;
key.shadow.normalBias = .025;
scene.add(key);
const rim = new THREE.DirectionalLight('#d5a34f', 3.0);
rim.position.set(3, 3.2, -3);
scene.add(rim);

const floor = new THREE.Mesh(new THREE.CircleGeometry(4.5, 80), new THREE.MeshStandardMaterial({ color: '#181a15', roughness: .94, metalness: .06 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -.012;
floor.receiveShadow = true;
scene.add(floor);
const plinth = new THREE.Mesh(new THREE.CylinderGeometry(.84, .91, .08, 64), new THREE.MeshStandardMaterial({ color: '#2c2a20', roughness: .6, metalness: .28 }));
plinth.position.y = -.04;
plinth.receiveShadow = true;
scene.add(plinth);
for (const radius of [.95, 1.25, 1.78, 2.45]) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, radius === .95 ? .012 : .004, 5, 96), new THREE.MeshBasicMaterial({ color: radius === .95 ? '#b58a45' : '#51462f', transparent: true, opacity: radius === .95 ? .8 : .42 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = .006;
  scene.add(ring);
}
for (let index = 0; index < 32; index++) {
  const angle = index / 32 * Math.PI * 2;
  const tick = new THREE.Mesh(new THREE.BoxGeometry(.012, .004, index % 4 === 0 ? .14 : .065), new THREE.MeshBasicMaterial({ color: index % 4 === 0 ? '#c49a55' : '#564a31' }));
  tick.position.set(Math.sin(angle) * 1.07, .008, Math.cos(angle) * 1.07);
  tick.rotation.y = angle;
  scene.add(tick);
}

const asset = createBagun();
scene.add(asset.root);
const mixer = new THREE.AnimationMixer(asset.root);
const actions = new Map(asset.clips.map((clip) => [clip.name, mixer.clipAction(clip)]));
let current = null;
let currentName = 'idle';
let exportInProgress = false;
let scrubbing = false;

const setStatus = (message) => { status.textContent = message; };
const markActive = (name) => document.querySelectorAll('[data-clip]').forEach((button) => button.classList.toggle('active', button.dataset.clip === name));
const resetRest = () => {
  for (const bone of asset.bones) {
    const rest = asset.restPose.get(bone.name);
    bone.position.copy(rest.position);
    bone.quaternion.copy(rest.quaternion);
    bone.scale.copy(rest.scale);
  }
  asset.root.updateMatrixWorld(true);
};
const updateTimeline = (time, duration) => {
  const progress = duration ? Math.min(1, time / duration) : 0;
  progressBar.style.width = `${progress * 100}%`;
  timeline.value = String(Math.round(progress * 1000));
  timeLabel.textContent = `${time.toFixed(2)} / ${duration.toFixed(2)}s`;
};
const play = (name, loop = name === 'idle' || name === 'walk') => {
  if (!actions.has(name)) throw new Error(`Unknown animation: ${name}`);
  current?.fadeOut(.14);
  resetRest();
  current = actions.get(name);
  current.reset();
  current.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  current.clampWhenFinished = !loop;
  current.fadeIn(.14);
  current.play();
  currentName = name;
  markActive(name);
  const labels = {
    swing: '握棍蓄力 → 横扫 → 收势，命中由规则层结算',
    flinch: '普通受击：重心后撤、棍势回防',
    dead: '倒地淘汰：保持棍不离手',
    reviveRise: '起身：dead 的逐轨道精确倒放',
    victory: '竖棍亮相：肩背展开、衣摆回落',
  };
  setStatus(labels[name] ?? `正在播放：${name}`);
  updateTimeline(0, current.getClip().duration);
  return name;
};
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
  updateTimeline(action.time, action.getClip().duration);
  setStatus(`正在检查：${name} · ${action.time.toFixed(2)}s`);
  renderer.render(scene, camera);
  return action.time;
};
mixer.addEventListener('finished', (event) => {
  if (event.action !== current || currentName === 'dead') return;
  if (!['idle', 'walk'].includes(currentName)) play('idle');
});
document.querySelectorAll('[data-clip]').forEach((button) => button.addEventListener('click', () => play(button.dataset.clip)));
controls.addEventListener('start', () => { controls.autoRotate = false; });
timeline.addEventListener('pointerdown', () => { scrubbing = true; mixer.stopAllAction(); });
timeline.addEventListener('input', () => {
  const clip = actions.get(currentName)?.getClip();
  if (clip) seek(currentName, Number(timeline.value) / 1000 * clip.duration);
});
window.addEventListener('pointerup', () => { scrubbing = false; });

const exportGlb = async () => {
  if (exportInProgress) throw new Error('Export already in progress');
  exportInProgress = true;
  try {
    mixer.stopAllAction();
    resetRest();
    asset.root.getObjectByName('stick').visible = true;
    asset.root.updateMatrixWorld(true);
    const result = await new GLTFExporter().parseAsync(asset.root, { binary: true, animations: asset.clips, onlyVisible: true, maxTextureSize: 128 });
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
document.querySelector('#toggleStick').addEventListener('click', () => {
  const stick = asset.root.getObjectByName('stick');
  stick.visible = !stick.visible;
  const button = document.querySelector('#toggleStick');
  button.setAttribute('aria-pressed', String(stick.visible));
  button.textContent = stick.visible ? '收棍 · stick 隐藏' : '拔棍 · stick 显示';
  setStatus(stick.visible ? 'stickDrawn=true：右手木棍已拔出' : 'stickDrawn=false：木棍已收起');
});
document.querySelector('#export').addEventListener('click', async () => {
  try { await exportGlb(); } catch (error) { setStatus(`导出失败：${error.message}`); }
});

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

const sampleBones = () => asset.bones.map((bone) => ({
  name: bone.name,
  position: bone.position.toArray(),
  quaternion: bone.quaternion.toArray(),
  scale: bone.scale.toArray(),
}));
const measuredBounds = () => {
  asset.root.updateMatrixWorld(true);
  asset.root.traverse((object) => { if (object.isSkinnedMesh) object.computeBoundingBox(); });
  const box = new THREE.Box3().setFromObject(asset.root, true);
  return { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new THREE.Vector3()).toArray() };
};
const gripDistances = () => {
  asset.root.updateMatrixWorld(true);
  const handR = asset.root.getObjectByName('HandR').getWorldPosition(new THREE.Vector3());
  const gripR = asset.root.getObjectByName('StickGrip').getWorldPosition(new THREE.Vector3());
  return [handR.distanceTo(gripR)];
};
const validate = () => {
  const clipSummary = Object.fromEntries(asset.clips.map((clip) => [clip.name, { duration: clip.duration, tracks: clip.tracks.length }]));
  resetRest();
  const restBounds = measuredBounds();
  const swingGripErrors = [];
  for (const time of [0, .35, .7, 1.05, 1.4, 1.8, 2.2]) {
    seek('swing', time);
    swingGripErrors.push({ time, distances: gripDistances() });
  }
  const reverseErrors = [];
  for (let index = 0; index <= 20; index++) {
    const time = index / 20 * 1.25;
    seek('dead', time);
    const dead = sampleBones();
    seek('reviveRise', 1.25 - time);
    const revive = sampleBones();
    let maxPositionError = 0;
    let maxQuaternionError = 0;
    let maxScaleError = 0;
    for (let boneIndex = 0; boneIndex < dead.length; boneIndex++) {
      for (let axis = 0; axis < 3; axis++) {
        maxPositionError = Math.max(maxPositionError, Math.abs(dead[boneIndex].position[axis] - revive[boneIndex].position[axis]));
        maxQuaternionError = Math.max(maxQuaternionError, Math.abs(dead[boneIndex].quaternion[axis] - revive[boneIndex].quaternion[axis]));
        maxScaleError = Math.max(maxScaleError, Math.abs(dead[boneIndex].scale[axis] - revive[boneIndex].scale[axis]));
      }
    }
    reverseErrors.push({ time, maxPositionError, maxQuaternionError, maxScaleError });
  }
  const ground = {};
  for (const name of ['dead', 'reviveRise']) {
    let minY = Infinity;
    for (let index = 0; index <= 25; index++) {
      seek(name, index / 25 * 1.25);
      minY = Math.min(minY, measuredBounds().min[1]);
    }
    ground[name] = { sampleCount: 26, minY, maxPenetrationMeters: Math.max(0, -minY) };
  }
  seek('dead', 1.25);
  const deadBounds = measuredBounds();
  seek('reviveRise', 1.25);
  const revivedBounds = measuredBounds();
  return {
    clips: clipSummary,
    restBounds,
    swingGripErrors,
    maxSwingGripError: Math.max(...swingGripErrors.flatMap((sample) => sample.distances)),
    reverse: {
      sampleCount: reverseErrors.length,
      maxPositionError: Math.max(...reverseErrors.map((sample) => sample.maxPositionError)),
      maxQuaternionError: Math.max(...reverseErrors.map((sample) => sample.maxQuaternionError)),
      maxScaleError: Math.max(...reverseErrors.map((sample) => sample.maxScaleError)),
    },
    ground,
    deadBounds,
    revivedBounds,
    renderer: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
  };
};

const capture = (name, time) => {
  seek(name, time);
  return renderer.domElement.toDataURL('image/png');
};
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  if (!scrubbing) mixer.update(delta);
  if (current && !current.loop && current.isRunning()) updateTimeline(current.time, current.getClip().duration);
  controls.update();
  renderer.render(scene, camera);
});

window.__bagun = {
  ready: true,
  stats: asset.stats,
  textureCount: textures.size,
  reloadGlb: (buffer) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, ''),
  createMixer: (root) => new THREE.AnimationMixer(root),
  play,
  seek,
  capture,
  validate,
  gripDistances,
  meshBounds: () => {
    asset.root.updateMatrixWorld(true);
    const result = [];
    asset.root.traverse((object) => {
      if (!object.isSkinnedMesh) return;
      object.computeBoundingBox();
      const box = new THREE.Box3().setFromObject(object, true);
      result.push({ name: object.name, min: box.min.toArray(), max: box.max.toArray() });
    });
    return result;
  },
  setStickVisible: (visible) => { asset.root.getObjectByName('stick').visible = Boolean(visible); },
  exportGlb,
  resetCamera: () => { camera.position.set(3.15, 2.3, 4.45); controls.target.set(0, 1.05, 0); controls.update(); },
  setView: (view = 'front') => {
    controls.autoRotate = false;
    controls.minDistance = view === 'face' ? .35 : 2.4;
    if (view === 'back') camera.position.set(-2.9, 2.2, -4.35);
    else if (view === 'side') camera.position.set(4.6, 2.05, .12);
    else if (view === 'staff') camera.position.set(2.1, 1.9, 3.5);
    else if (view === 'face') camera.position.set(.48, 1.9, 1.05);
    else camera.position.set(3.15, 2.3, 4.45);
    controls.target.copy(view === 'staff' ? new THREE.Vector3(0, 1.25, .15) : view === 'face' ? new THREE.Vector3(0, 1.9, .02) : new THREE.Vector3(0, 1.05, 0));
    controls.update();
  },
  getState: () => ({
    camera: { position: camera.position.toArray(), target: controls.target.toArray() },
    current: currentName,
    time: current?.time ?? 0,
    running: current?.isRunning() ?? false,
    renderer: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
    bounds: measuredBounds(),
  }),
};
setStatus('模型就绪。可逐帧拖动时间轴，或导出内嵌贴图与动画的 GLB。');
play('idle');
