import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createWuliuqi } from './wuliuqi.js';

const EXPECTED_CLIPS = Object.freeze([
  ['idle', 4], ['walk', 1.2], ['cast', 3], ['attack', 2.4],
  ['flinch', .75], ['cheer', 2.4], ['dead', 1.5], ['reviveRise', 1.5],
]);
const LOOP_CLIPS = new Set(['idle', 'walk', 'cast']);
const ONE_SHOT_CLIPS = new Set(['attack', 'flinch', 'cheer', 'reviveRise']);
const EFFECT_NAMES = Object.freeze(['CutRing', 'Slash0', 'Slash1', 'Slash2']);
const stage = document.querySelector('#stage');
const status = document.querySelector('#status');
const timeline = document.querySelector('#timeline');
const timeLabel = document.querySelector('#timeLabel');
const progressBar = document.querySelector('#progressBar');
const DEFAULT_CAMERA = new THREE.Vector3(3.15, 2.45, 4.6);
const DEFAULT_TARGET = new THREE.Vector3(0, 1.25, 0);

window.__wuliuqiRenderer?.setAnimationLoop(null);
window.__wuliuqiRenderer?.dispose();
window.__wuliuqiEnvironment?.dispose();
window.__wuliuqiControls?.dispose();
stage.querySelectorAll('canvas').forEach((canvas) => canvas.remove());

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
window.__wuliuqiRenderer = renderer;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(Math.max(1, stage.clientWidth), Math.max(1, stage.clientHeight), false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#111214');
scene.fog = new THREE.FogExp2('#111214', .042);
const camera = new THREE.PerspectiveCamera(32, Math.max(1, stage.clientWidth) / Math.max(1, stage.clientHeight), .05, 40);
camera.position.copy(DEFAULT_CAMERA);
const controls = new OrbitControls(camera, renderer.domElement);
window.__wuliuqiControls = controls;
controls.target.copy(DEFAULT_TARGET);
controls.enableDamping = true;
controls.dampingFactor = .07;
controls.minDistance = 2.4;
controls.maxDistance = 8;
controls.maxPolarAngle = Math.PI * .49;
controls.update();

const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const environment = pmrem.fromScene(room, .04);
window.__wuliuqiEnvironment = environment;
scene.environment = environment.texture;
scene.environmentIntensity = .85;
room.dispose?.();
pmrem.dispose();
scene.add(new THREE.HemisphereLight('#ffffff', '#27232a', 1.6));
const key = new THREE.DirectionalLight('#fff8ee', 4.2);
key.position.set(-3.5, 5.5, 4.5);
key.castShadow = true;
key.shadow.mapSize.set(1536, 1536);
key.shadow.camera.left = key.shadow.camera.bottom = -3;
key.shadow.camera.right = key.shadow.camera.top = 3;
key.shadow.camera.near = .5;
key.shadow.camera.far = 14;
key.shadow.bias = -.00035;
key.shadow.normalBias = .025;
scene.add(key);
const rim = new THREE.DirectionalLight('#d9e5ff', 3);
rim.position.set(3, 3.2, -3);
scene.add(rim);
const redAccent = new THREE.PointLight('#b8c8e0', 2.2, 4, 2);
redAccent.position.set(-.8, 1.6, .7);
scene.add(redAccent);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(4.5, 80),
  new THREE.MeshStandardMaterial({ color: '#19191c', roughness: .96, metalness: .05 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -.012;
floor.receiveShadow = true;
scene.add(floor);
const plinth = new THREE.Mesh(
  new THREE.CylinderGeometry(.86, .94, .08, 64),
  new THREE.MeshStandardMaterial({ color: '#303034', roughness: .55, metalness: .38 }),
);
plinth.position.y = -.04;
plinth.receiveShadow = true;
scene.add(plinth);
for (const radius of [.97, 1.25, 1.8, 2.5]) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, radius === .97 ? .012 : .004, 5, 96),
    new THREE.MeshBasicMaterial({
      color: radius === .97 ? '#e5e2dc' : '#5a5557',
      transparent: true,
      opacity: radius === .97 ? .8 : .45,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = .006;
  scene.add(ring);
}
for (let index = 0; index < 32; index++) {
  const angle = index / 32 * Math.PI * 2;
  const tick = new THREE.Mesh(
    new THREE.BoxGeometry(.012, .004, index % 4 === 0 ? .14 : .065),
    new THREE.MeshBasicMaterial({ color: index % 4 === 0 ? '#e4e1dc' : '#4d484b' }),
  );
  tick.position.set(Math.sin(angle) * 1.1, .008, Math.cos(angle) * 1.1);
  tick.rotation.y = angle;
  scene.add(tick);
}

const asset = createWuliuqi();
if (!asset?.root || !Array.isArray(asset.bones) || !Array.isArray(asset.clips)) {
  throw new Error('createWuliuqi() must return root, bones and clips');
}
scene.add(asset.root);
const mixer = new THREE.AnimationMixer(asset.root);
const actions = new Map(asset.clips.map((clip) => [clip.name, mixer.clipAction(clip)]));
const meshes = [];
const textures = new Set();
const materials = new Set();
asset.root.traverse((object) => {
  if (object.isMesh) meshes.push(object);
  for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
    if (!material) continue;
    materials.add(material);
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
  }
});
const effectBones = EFFECT_NAMES.map((name) => asset.bones.find((bone) => bone.name === name) ?? null);
const poseNodes = new Set([asset.root, ...asset.bones]);
for (const clip of asset.clips) {
  for (const track of clip.tracks) {
    const separator = track.name.lastIndexOf('.');
    const node = asset.root.getObjectByName(track.name.slice(0, separator));
    if (node?.isObject3D) poseNodes.add(node);
  }
}
const restTransforms = new Map([...poseNodes].map((node) => [node, {
  position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(),
}]));
const rootRestPosition = asset.root.position.clone();
const rootRestQuaternion = asset.root.quaternion.clone();
const rootRestScale = asset.root.scale.clone();
let current = null;
let currentName = 'idle';
let scrubbing = false;
let sampling = false;
let exporting = false;

const setStatus = (message) => { status.textContent = message; };
const markActive = (name) => {
  document.querySelectorAll('[data-clip]').forEach((button) => {
    button.classList.toggle('active', button.dataset.clip === name);
  });
};
const resetRest = () => {
  for (const [node, rest] of restTransforms) {
    node.position.copy(rest.position);
    node.quaternion.copy(rest.quaternion);
    node.scale.copy(rest.scale);
  }
  asset.root.updateMatrixWorld(true);
};
const updateTimeline = (time, duration) => {
  const progress = duration ? Math.min(1, Math.max(0, time / duration)) : 0;
  progressBar.style.width = `${progress * 100}%`;
  timeline.value = String(Math.round(progress * 1000));
  timeline.setAttribute('aria-valuetext', `${time.toFixed(3)} / ${duration.toFixed(2)} 秒`);
  timeLabel.textContent = `${time.toFixed(2)} / ${duration.toFixed(2)}s`;
};
const sampleAt = (name, time) => {
  const action = actions.get(name);
  if (!action) throw new Error(`Unknown animation: ${name}`);
  mixer.stopAllAction();
  resetRest();
  action.reset();
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const duration = action.getClip().duration;
  action.time = Math.max(0, Math.min(duration, Number.isFinite(time) ? time : 0));
  sampling = true;
  try { mixer.update(0); } finally { sampling = false; }
  action.paused = true;
  asset.root.updateMatrixWorld(true);
  current = action;
  currentName = name;
  markActive(name);
  updateTimeline(action.time, duration);
  return action.time;
};
const play = (name, loop = LOOP_CLIPS.has(name)) => {
  const action = actions.get(name);
  if (!action) throw new Error(`Unknown animation: ${name}`);
  mixer.stopAllAction();
  resetRest();
  action.reset();
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  action.clampWhenFinished = !loop;
  action.play();
  current = action;
  currentName = name;
  markActive(name);
  const labels = {
    idle: '静立：黑白帽衫，银色剪刀收起',
    walk: '行走：原地步法，水平根位移为零',
    cast: '施法：CutRing 在 1.50 秒显现',
    attack: '攻击：Slash0 在 0.58 秒沿 +Z 前送',
    flinch: '受击：短暂停顿后回到待机',
    cheer: '喝彩：银剪翻动，红色刀柄点缀',
    dead: '倒下：保持死亡终态',
    reviveRise: '起身：死亡动作的 141 点精确倒放',
  };
  setStatus(labels[name] ?? `正在播放：${name}`);
  updateTimeline(0, action.getClip().duration);
  return name;
};
const seek = (name, time) => {
  const sampledTime = sampleAt(name, time);
  setStatus(`逐帧检查：${name} · ${sampledTime.toFixed(3)}s`);
  renderer.render(scene, camera);
  return sampledTime;
};
mixer.addEventListener('finished', (event) => {
  if (sampling || event.action !== current || currentName === 'dead') return;
  if (ONE_SHOT_CLIPS.has(currentName)) play('idle');
});
document.querySelectorAll('[data-clip]').forEach((button) => {
  button.addEventListener('click', () => play(button.dataset.clip));
});
controls.addEventListener('start', () => { controls.autoRotate = false; });
timeline.addEventListener('pointerdown', () => { scrubbing = true; });
timeline.addEventListener('input', () => {
  const duration = actions.get(currentName)?.getClip().duration;
  if (duration) seek(currentName, Number(timeline.value) / 1000 * duration);
});
window.addEventListener('pointerup', () => { scrubbing = false; });
window.addEventListener('pointercancel', () => { scrubbing = false; });

const exportGlb = async () => {
  if (exporting) throw new Error('Export already in progress');
  exporting = true;
  try {
    mixer.stopAllAction();
    resetRest();
    // Hidden effects must remain in the file so reloaded geometry/stats match source.
    const result = await new GLTFExporter().parseAsync(asset.root, {
      binary: true, animations: asset.clips, onlyVisible: false, maxTextureSize: 256,
    });
    if (!(result instanceof ArrayBuffer)) throw new Error('Exporter did not return binary GLB');
    const response = await fetch('/__export', {
      method: 'POST', headers: { 'Content-Type': 'model/gltf-binary' }, body: result,
    });
    if (!response.ok) throw new Error(`Export endpoint HTTP ${response.status}`);
    const saved = await response.json();
    play('idle');
    setStatus(`GLB 已保存：${saved.file} · ${(saved.bytes / 1024 / 1024).toFixed(2)} MB · SHA-256 ${saved.sha256.slice(0, 12)}…`);
    return saved;
  } finally {
    exporting = false;
  }
};
document.querySelector('#export').addEventListener('click', async () => {
  try { await exportGlb(); } catch (error) { setStatus(`导出失败：${error.message}`); }
});

const measuredBounds = () => {
  asset.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const local = new THREE.Box3();
  for (const mesh of meshes) {
    if (!mesh.geometry.attributes.position) continue;
    if (mesh.isSkinnedMesh) {
      mesh.skeleton.update();
      mesh.computeBoundingBox();
    } else {
      mesh.geometry.computeBoundingBox();
    }
    local.copy(mesh.isSkinnedMesh ? mesh.boundingBox : mesh.geometry.boundingBox);
    local.applyMatrix4(mesh.matrixWorld);
    box.union(local);
  }
  return { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new THREE.Vector3()).toArray() };
};
const sampleBones = () => asset.bones.map((bone) => ({
  name: bone.name, position: bone.position.toArray(), quaternion: bone.quaternion.toArray(), scale: bone.scale.toArray(),
}));
const effectStates = () => Object.fromEntries(EFFECT_NAMES.map((name, index) => {
  const bone = effectBones[index];
  if (!bone) return [name, null];
  const worldScale = bone.getWorldScale(new THREE.Vector3());
  return [name, {
    scale: bone.scale.toArray(), maxScale: Math.max(...bone.scale.toArray().map(Math.abs)),
    position: bone.position.toArray(), worldPosition: bone.getWorldPosition(new THREE.Vector3()).toArray(),
    maxWorldScale: Math.max(...worldScale.toArray().map(Math.abs)),
  }];
}));
const validate = () => {
  const clips = Object.fromEntries(asset.clips.map((clip) => [clip.name, { duration: clip.duration, tracks: clip.tracks.length }]));
  resetRest();
  const restBounds = measuredBounds();
  const restPose = sampleBones();
  const hiddenAtRest = effectStates();
  sampleAt('attack', .58);
  const attack = effectStates();
  sampleAt('cast', 1.5);
  const cast = effectStates();
  let maxPositionError = 0;
  let maxQuaternionError = 0;
  let maxScaleError = 0;
  for (let index = 0; index <= 140; index++) {
    const time = index / 140 * 1.5;
    sampleAt('dead', time);
    const dead = sampleBones();
    sampleAt('reviveRise', 1.5 - time);
    const revive = sampleBones();
    for (let boneIndex = 0; boneIndex < dead.length; boneIndex++) {
      if (dead[boneIndex].name !== revive[boneIndex].name) throw new Error('Bone order changed between clips');
      for (let axis = 0; axis < 3; axis++) {
        maxPositionError = Math.max(maxPositionError, Math.abs(dead[boneIndex].position[axis] - revive[boneIndex].position[axis]));
        maxScaleError = Math.max(maxScaleError, Math.abs(dead[boneIndex].scale[axis] - revive[boneIndex].scale[axis]));
      }
      let direct = 0;
      let equivalent = 0;
      for (let axis = 0; axis < 4; axis++) {
        direct += (dead[boneIndex].quaternion[axis] - revive[boneIndex].quaternion[axis]) ** 2;
        equivalent += (dead[boneIndex].quaternion[axis] + revive[boneIndex].quaternion[axis]) ** 2;
      }
      maxQuaternionError = Math.max(maxQuaternionError, Math.sqrt(Math.min(direct, equivalent)));
    }
  }
  const ground = {};
  for (const name of ['dead', 'reviveRise']) {
    let minY = Infinity;
    for (let index = 0; index <= 140; index++) {
      sampleAt(name, index / 140 * 1.5);
      minY = Math.min(minY, measuredBounds().min[1]);
    }
    ground[name] = { sampleCount: 141, minY, maxPenetrationMeters: Math.max(0, -minY) };
  }
  const regularGround = {};
  for (const [name, duration, count] of [['idle', 4, 160], ['walk', 1.2, 120], ['flinch', .75, 100]]) {
    let minY = Infinity;
    for (let index = 0; index <= count; index++) {
      sampleAt(name, index / count * duration);
      minY = Math.min(minY, measuredBounds().min[1]);
    }
    regularGround[name] = { sampleCount: count + 1, minY, maxPenetrationMeters: Math.max(0, -minY) };
  }
  sampleAt('reviveRise', 1.5);
  const revivedBounds = measuredBounds();
  const revivedPose = sampleBones();
  let revivedPoseError = 0;
  for (let boneIndex = 0; boneIndex < restPose.length; boneIndex++) {
    for (let axis = 0; axis < 3; axis++) {
      revivedPoseError = Math.max(
        revivedPoseError,
        Math.abs(restPose[boneIndex].position[axis] - revivedPose[boneIndex].position[axis]),
        Math.abs(restPose[boneIndex].scale[axis] - revivedPose[boneIndex].scale[axis]),
      );
    }
    let direct = 0;
    let equivalent = 0;
    for (let axis = 0; axis < 4; axis++) {
      direct += (restPose[boneIndex].quaternion[axis] - revivedPose[boneIndex].quaternion[axis]) ** 2;
      equivalent += (restPose[boneIndex].quaternion[axis] + revivedPose[boneIndex].quaternion[axis]) ** 2;
    }
    revivedPoseError = Math.max(revivedPoseError, Math.sqrt(Math.min(direct, equivalent)));
  }
  let walkMinX = Infinity;
  let walkMaxX = -Infinity;
  let walkMinZ = Infinity;
  let walkMaxZ = -Infinity;
  for (let index = 0; index <= 120; index++) {
    sampleAt('walk', index / 120 * 1.2);
    walkMinX = Math.min(walkMinX, asset.root.position.x);
    walkMaxX = Math.max(walkMaxX, asset.root.position.x);
    walkMinZ = Math.min(walkMinZ, asset.root.position.z);
    walkMaxZ = Math.max(walkMaxZ, asset.root.position.z);
  }
  sampleAt('idle', 0);
  return {
    clips, expectedDurations: Object.fromEntries(EXPECTED_CLIPS), restBounds, restPoseError: revivedPoseError,
    hiddenAtRest, attackSlash0: attack.Slash0, castCutRing: cast.CutRing,
    reverse: { sampleCount: 141, maxPositionError, maxQuaternionError, maxScaleError },
    ground, regularGround, revivedBounds, revivedPoseError,
    walkRoot: {
      xRange: walkMaxX - walkMinX, zRange: walkMaxZ - walkMinZ,
      maxHorizontalOffset: Math.max(
        Math.abs(walkMinX - rootRestPosition.x), Math.abs(walkMaxX - rootRestPosition.x),
        Math.abs(walkMinZ - rootRestPosition.z), Math.abs(walkMaxZ - rootRestPosition.z),
      ),
    },
    renderer: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
  };
};

const resetCamera = () => {
  controls.minDistance = 2.4;
  camera.position.copy(DEFAULT_CAMERA);
  controls.target.copy(DEFAULT_TARGET);
  controls.update();
};
const setView = (view = 'front') => {
  controls.autoRotate = false;
  controls.minDistance = view === 'face' || view === 'feet' ? .35 : 2.4;
  if (view === 'back') camera.position.set(-2.7, 2.45, -4.3);
  else if (view === 'side') camera.position.set(4.5, 2.15, .15);
  else if (view === 'face') {
    controls.target.set(0, asset.stats.height * .78, .03);
    camera.position.set(.42, asset.stats.height * .78 + .04, 1.0);
  } else if (view === 'feet') {
    controls.target.set(0, .16, .10);
    camera.position.set(.48, .30, 1.18);
  } else {
    camera.position.copy(DEFAULT_CAMERA);
    controls.target.copy(DEFAULT_TARGET);
  }
  controls.update();
};
const capture = (name, time, view = 'front') => {
  if (view) setView(view);
  seek(name, time);
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/png');
};

for (const [name, duration] of EXPECTED_CLIPS) {
  const clip = actions.get(name)?.getClip();
  if (!clip || Math.abs(clip.duration - duration) > .0001) throw new Error(`Model clip contract mismatch: ${name} (expected ${duration}s)`);
}
if (asset.clips.length !== EXPECTED_CLIPS.length) throw new Error(`Model must export exactly ${EXPECTED_CLIPS.length} clips`);
if (effectBones.some((bone) => !bone)) throw new Error(`Missing effect bones: ${EFFECT_NAMES.join(', ')}`);

const fillStats = () => {
  document.querySelector('#triangles').textContent = asset.stats.triangles.toLocaleString();
  document.querySelector('#vertices').textContent = asset.stats.vertices.toLocaleString();
  document.querySelector('#bones').textContent = String(asset.stats.bones);
  document.querySelector('#meshes').textContent = `${asset.stats.meshes} / ${asset.stats.materials}`;
  document.querySelector('#height').textContent = `${asset.stats.height.toFixed(3)} m`;
  document.querySelector('#dimensions').textContent = `${asset.stats.width.toFixed(3)} / ${asset.stats.depth.toFixed(3)} m`;
  document.querySelector('#footY').textContent = asset.stats.footY.toFixed(6);
  document.querySelector('#clips').textContent = `${asset.clips.length} / ${textures.size}`;
};
fillStats();
window.__wuliuqi = {
  ready: true,
  stats: asset.stats,
  textureCount: textures.size,
  reloadGlb: (buffer) => {
    if (typeof buffer === 'string') {
      const binary = atob(buffer);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer, '');
    }
    return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
  },
  createMixer: (root) => new THREE.AnimationMixer(root),
  play, seek, capture, validate, exportGlb, resetCamera, setView,
  getState: () => ({
    camera: {
      position: camera.position.toArray(), target: controls.target.toArray(), quaternion: camera.quaternion.toArray(),
    },
    current: currentName, time: current?.time ?? 0, duration: current?.getClip().duration ?? 0,
    running: current?.isRunning() ?? false,
    rootPosition: asset.root.position.toArray(),
    rootQuaternion: asset.root.quaternion.toArray(),
    rootScale: asset.root.scale.toArray(),
    effects: effectStates(), bounds: measuredBounds(),
    renderer: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
  }),
};
const resizeObserver = new ResizeObserver(() => {
  const width = Math.max(1, stage.clientWidth);
  const height = Math.max(1, stage.clientHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
});
resizeObserver.observe(stage);
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  if (!scrubbing) mixer.update(delta);
  if (current) updateTimeline(current.time, current.getClip().duration);
  controls.update();
  renderer.render(scene, camera);
});
setStatus('模型就绪。可逐帧检查剪刀特效，或导出内嵌贴图与动画的 GLB。');
play('idle');
