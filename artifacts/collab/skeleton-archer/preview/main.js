import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSkeletonArcher } from './skeleton-archer.js';

const stage = document.querySelector('#stage');
const status = document.querySelector('#status');
const progressBar = document.querySelector('#progressBar');
const timeLabel = document.querySelector('#timeLabel');
const timeline = document.querySelector('#timeline');
if (window.__skeletonArcherRenderer) {
  window.__skeletonArcherRenderer.setAnimationLoop(null);
  window.__skeletonArcherRenderer.dispose();
}
stage.querySelectorAll('canvas').forEach((canvas) => canvas.remove());

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
window.__skeletonArcherRenderer = renderer;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(stage.clientWidth, stage.clientHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0d0b0b');
scene.fog = new THREE.FogExp2('#0d0b0b', .06);
const camera = new THREE.PerspectiveCamera(33, stage.clientWidth / stage.clientHeight, .05, 40);
camera.position.set(3.0, 2.25, 4.3);
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
scene.environmentIntensity = .75;
pmrem.dispose();
scene.add(new THREE.HemisphereLight('#d9c7a8', '#24120d', 1.25));
const key = new THREE.DirectionalLight('#ffe0ad', 4.0);
key.position.set(-3.5, 5.5, 4);
key.castShadow = true;
key.shadow.mapSize.set(1536, 1536);
key.shadow.camera.left = key.shadow.camera.bottom = -2.8;
key.shadow.camera.right = key.shadow.camera.top = 2.8;
key.shadow.camera.near = .5;
key.shadow.camera.far = 13;
key.shadow.bias = -.00035;
key.shadow.normalBias = .025;
scene.add(key);
const rim = new THREE.DirectionalLight('#ff5b22', 3.3);
rim.position.set(3, 3.2, -3);
scene.add(rim);
const fireLight = new THREE.PointLight('#ff6a18', 13, 4, 2);
fireLight.position.set(0, 1.95, .05);
scene.add(fireLight);

const floor = new THREE.Mesh(new THREE.CircleGeometry(4.5, 80), new THREE.MeshStandardMaterial({ color: '#171211', roughness: .94, metalness: .08 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -.012;
floor.receiveShadow = true;
scene.add(floor);
const plinth = new THREE.Mesh(new THREE.CylinderGeometry(.82, .90, .08, 64), new THREE.MeshStandardMaterial({ color: '#2a1b17', roughness: .58, metalness: .32 }));
plinth.position.y = -.04;
plinth.receiveShadow = true;
scene.add(plinth);
for (const radius of [.93, 1.22, 1.75, 2.45]) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, radius === .93 ? .012 : .004, 5, 96), new THREE.MeshBasicMaterial({ color: radius === .93 ? '#b56c32' : '#4a2d23', transparent: true, opacity: radius === .93 ? .8 : .45 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = .006;
  scene.add(ring);
}
for (let index = 0; index < 32; index++) {
  const angle = index / 32 * Math.PI * 2;
  const tick = new THREE.Mesh(new THREE.BoxGeometry(.012, .004, index % 4 === 0 ? .14 : .065), new THREE.MeshBasicMaterial({ color: index % 4 === 0 ? '#c17a3b' : '#533326' }));
  tick.position.set(Math.sin(angle) * 1.05, .008, Math.cos(angle) * 1.05);
  tick.rotation.y = angle;
  scene.add(tick);
}

const asset = createSkeletonArcher();
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
const play = (name, loop = name === 'idle' || name === 'walk' || name === 'burn') => {
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
    shoot: '拉弓 → 火矢离弦 → 余焰随箭飞行',
    flinch: '普通受击：骨骼后仰、双臂失衡',
    flinch_burning: '火箭插背：箭矢留驻、背部燃起火焰',
    burn: '持续燃烧：火舌、灰烬与轻微抽搐循环',
    dead: '死亡散架：骨骼逐件落地',
    reviveRise: '倒放复活：散落骨骼重新拼合',
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
  action.reset();
  action.play();
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
  if (!['idle', 'walk', 'burn'].includes(currentName)) play('idle');
});

document.querySelectorAll('[data-clip]').forEach((button) => button.addEventListener('click', () => play(button.dataset.clip)));
controls.addEventListener('start', () => { controls.autoRotate = false; });
timeline.addEventListener('pointerdown', () => { scrubbing = true; mixer.stopAllAction(); });
timeline.addEventListener('input', () => {
  const clip = actions.get(currentName)?.getClip();
  if (!clip) return;
  seek(currentName, Number(timeline.value) / 1000 * clip.duration);
});
window.addEventListener('pointerup', () => { scrubbing = false; });

const exportGlb = async () => {
  if (exportInProgress) throw new Error('Export already in progress');
  exportInProgress = true;
  try {
    mixer.stopAllAction();
    resetRest();
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
const debrisBounds = () => {
  asset.root.updateMatrixWorld(true);
  asset.skeleton.update();
  const boxes = new Map();
  const vertex = new THREE.Vector3();
  asset.root.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const position = mesh.geometry.attributes.position;
    const skinIndex = mesh.geometry.attributes.skinIndex;
    for (let index = 0; index < position.count; index++) {
      const boneName = mesh.skeleton.bones[skinIndex.getX(index)]?.name;
      if (!boneName?.startsWith('Debris')) continue;
      vertex.fromBufferAttribute(position, index);
      mesh.applyBoneTransform(index, vertex);
      if (!boxes.has(boneName)) boxes.set(boneName, new THREE.Box3());
      boxes.get(boneName).expandByPoint(vertex);
    }
  });
  return Object.fromEntries([...boxes].map(([name, box]) => [name, { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new THREE.Vector3()).toArray() }]));
};
const validate = () => {
  const clipSummary = Object.fromEntries(asset.clips.map((clip) => [clip.name, { duration: clip.duration, tracks: clip.tracks.length }]));
  resetRest();
  const restBounds = measuredBounds();
  const hiddenAtRest = Object.fromEntries(['FireArrow', 'StuckArrow', 'NockedArrow', 'BurnFlame0', 'DebrisSkull'].map((name) => [name, asset.bones.find((bone) => bone.name === name).scale.x]));
  seek('shoot', 1.20);
  const fireArrow = asset.bones.find((bone) => bone.name === 'FireArrow');
  const shootState = { scale: fireArrow.scale.x, position: fireArrow.position.toArray() };
  seek('flinch_burning', .60);
  const burningState = Object.fromEntries(['StuckArrow', 'BurnFlame0', 'BurnFlame1', 'Ash0'].map((name) => [name, asset.bones.find((bone) => bone.name === name).scale.x]));
  const reverseErrors = [];
  for (let index = 0; index <= 20; index++) {
    const time = index / 20 * 1.4;
    seek('dead', time);
    const dead = sampleBones();
    seek('reviveRise', 1.4 - time);
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
    let maxY = -Infinity;
    for (let index = 0; index <= 28; index++) {
      seek(name, index / 28 * 1.4);
      const bounds = measuredBounds();
      minY = Math.min(minY, bounds.min[1]);
      maxY = Math.max(maxY, bounds.min[1]);
    }
    ground[name] = { minY, maxY, maxPenetrationMeters: Math.max(0, -minY) };
  }
  seek('dead', 1.4);
  const deadBounds = measuredBounds();
  const debrisFinalBounds = debrisBounds();
  seek('reviveRise', 1.4);
  const revivedBounds = measuredBounds();
  return {
    clips: clipSummary,
    restBounds,
    hiddenAtRest,
    shootState,
    burningState,
    reverse: {
      sampleCount: reverseErrors.length,
      maxPositionError: Math.max(...reverseErrors.map((sample) => sample.maxPositionError)),
      maxQuaternionError: Math.max(...reverseErrors.map((sample) => sample.maxQuaternionError)),
      maxScaleError: Math.max(...reverseErrors.map((sample) => sample.maxScaleError)),
    },
    ground,
    deadBounds,
    debrisFinalBounds,
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
  fireLight.intensity = 12.5 + Math.sin(clock.elapsedTime * 11) * 1.2 + Math.sin(clock.elapsedTime * 17) * .6;
  controls.update();
  renderer.render(scene, camera);
});

window.__skeletonArcher = {
  ready: true,
  stats: asset.stats,
  textureCount: textures.size,
  reloadGlb: (buffer) => new GLTFLoader().parseAsync(buffer, ''),
  createMixer: (root) => new THREE.AnimationMixer(root),
  play,
  seek,
  capture,
  validate,
  debrisBounds,
  exportGlb,
  resetCamera: () => { camera.position.set(3.0, 2.25, 4.3); controls.target.set(0, 1.05, 0); controls.update(); },
  setView: (view = 'front') => {
    controls.autoRotate = false;
    controls.minDistance = view === 'face' ? .35 : 2.4;
    if (view === 'back') camera.position.set(-2.7, 2.15, -4.1);
    else if (view === 'side') camera.position.set(4.3, 1.95, .15);
    else if (view === 'projectile') camera.position.set(1.8, 1.9, 3.6);
    else if (view === 'face') camera.position.set(.50, 1.89, 1.05);
    else camera.position.set(3.0, 2.25, 4.3);
    controls.target.copy(view === 'projectile' ? new THREE.Vector3(-.25, 1.35, .9) : view === 'face' ? new THREE.Vector3(0, 1.86, .02) : new THREE.Vector3(0, 1.05, 0));
    controls.update();
  },
  getState: () => ({
    camera: { position: camera.position.toArray(), target: controls.target.toArray(), quaternion: camera.quaternion.toArray() },
    current: currentName,
    time: current?.time ?? 0,
    running: current?.isRunning() ?? false,
    renderer: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
    bounds: measuredBounds(),
  }),
};
setStatus('模型就绪。可逐帧拖动时间轴，或导出内嵌贴图与动画的 GLB。');
play('idle');
