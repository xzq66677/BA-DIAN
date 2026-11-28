import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createChuixiao } from './chuixiao.js';

const stage = document.querySelector('#stage');
const status = document.querySelector('#status');
const progressBar = document.querySelector('#progressBar');
const timeLabel = document.querySelector('#timeLabel');
const timeline = document.querySelector('#timeline');
const LOOP_CLIPS = new Set(['idle', 'walk', 'cast']);
const ONE_SHOT_CLIPS = ['attack', 'flinch', 'cheer', 'dead', 'reviveRise'];
const EXPECTED_CLIPS = [
  ['idle', 4],
  ['walk', 1.2],
  ['cast', 3],
  ['attack', 2.4],
  ['flinch', .75],
  ['cheer', 2.4],
  ['dead', 1.5],
  ['reviveRise', 1.5],
];
const DEFAULT_CAMERA = new THREE.Vector3(3, 2.25, 4.3);
const DEFAULT_TARGET = new THREE.Vector3(0, 1.05, 0);

window.__chuixiaoRenderer?.setAnimationLoop(null);
window.__chuixiaoRenderer?.dispose();
window.__chuixiaoEnvironment?.dispose();
stage.querySelectorAll('canvas').forEach((canvas) => canvas.remove());

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true,
});
window.__chuixiaoRenderer = renderer;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(Math.max(1, stage.clientWidth), Math.max(1, stage.clientHeight), false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#071512');
scene.fog = new THREE.FogExp2('#071512', .045);
const camera = new THREE.PerspectiveCamera(
  33,
  Math.max(1, stage.clientWidth) / Math.max(1, stage.clientHeight),
  .05,
  40,
);
camera.position.copy(DEFAULT_CAMERA);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(DEFAULT_TARGET);
controls.enableDamping = true;
controls.dampingFactor = .07;
controls.minDistance = 2.4;
controls.maxDistance = 7;
controls.maxPolarAngle = Math.PI * .49;
controls.update();

const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const environment = pmrem.fromScene(room, .04);
window.__chuixiaoEnvironment = environment;
scene.environment = environment.texture;
scene.environmentIntensity = .7;
room.dispose?.();
pmrem.dispose();

scene.add(new THREE.HemisphereLight('#d7eee1', '#07110e', 1.35));
const key = new THREE.DirectionalLight('#e7fff2', 3.7);
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
const rim = new THREE.DirectionalLight('#65c9aa', 3.1);
rim.position.set(3, 3.2, -3);
scene.add(rim);
const jadeLight = new THREE.PointLight('#b7e6c9', 8, 4, 2);
jadeLight.position.set(-.8, 2.1, .4);
scene.add(jadeLight);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(4.5, 80),
  new THREE.MeshStandardMaterial({ color: '#0b1d18', roughness: .96, metalness: .05 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -.012;
floor.receiveShadow = true;
scene.add(floor);
const plinth = new THREE.Mesh(
  new THREE.CylinderGeometry(.82, .90, .08, 64),
  new THREE.MeshStandardMaterial({ color: '#193c32', roughness: .55, metalness: .28 }),
);
plinth.position.y = -.04;
plinth.receiveShadow = true;
scene.add(plinth);
for (const radius of [.93, 1.22, 1.75, 2.45]) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, radius === .93 ? .012 : .004, 5, 96),
    new THREE.MeshBasicMaterial({
      color: radius === .93 ? '#a9d8bd' : '#315b4c',
      transparent: true,
      opacity: radius === .93 ? .8 : .45,
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
    new THREE.MeshBasicMaterial({ color: index % 4 === 0 ? '#c1d7aa' : '#315044' }),
  );
  tick.position.set(Math.sin(angle) * 1.05, .008, Math.cos(angle) * 1.05);
  tick.rotation.y = angle;
  scene.add(tick);
}

const asset = createChuixiao();
scene.add(asset.root);
const mixer = new THREE.AnimationMixer(asset.root);
const actions = new Map(asset.clips.map((clip) => [clip.name, mixer.clipAction(clip)]));
const meshes = [];
const textures = new Set();
asset.root.traverse((object) => {
  if (object.isMesh) meshes.push(object);
  if (!object.material) return;
  for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
  }
});

const poseNodes = new Set([asset.root, ...asset.bones]);
for (const clip of asset.clips) {
  for (const track of clip.tracks) {
    const node = asset.root.getObjectByName(track.name.slice(0, track.name.lastIndexOf('.')));
    if (node?.isObject3D) poseNodes.add(node);
  }
}
const restTransforms = new Map([...poseNodes].map((node) => [node, {
  position: node.position.clone(),
  quaternion: node.quaternion.clone(),
  scale: node.scale.clone(),
}]));
const rootRestPosition = asset.root.position.clone();
const effectBoneNames = [...new Set([
  ...asset.effectBoneNames,
  'Qi',
  'SoundRing0', 'SoundRing1', 'SoundRing2',
  'Note0', 'Note1', 'Note2',
])];

let current = null;
let currentName = 'idle';
let exportInProgress = false;
let scrubbing = false;

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
  mixer.update(0);
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
    idle: '静立调息：衣袂与发梢保持自然呼吸',
    walk: '青衫步履：原地行走，无水平根位移',
    cast: '吹箫施法：音环与箫声化作青玉涟漪',
    attack: '箫锋出击：1.25 秒音符特效显现并前送',
    flinch: '受击：身形一顿，稳住气息',
    cheer: '喝彩：抚箫致意，衣袂轻扬',
    dead: '倒下：保持死亡终态，Root 仅可用于贴地修正',
    reviveRise: '起身：死亡动作的 141 点精确倒放',
  };
  setStatus(labels[name] ?? `正在播放：${name}`);
  updateTimeline(0, action.getClip().duration);
  return name;
};
const seek = (name, time) => {
  const sampledTime = sampleAt(name, time);
  setStatus(`正在检查：${name} · ${sampledTime.toFixed(3)}s`);
  renderer.render(scene, camera);
  return sampledTime;
};
mixer.addEventListener('finished', (event) => {
  if (event.action !== current || currentName === 'dead') return;
  if (ONE_SHOT_CLIPS.includes(currentName)) play('idle');
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
  if (exportInProgress) throw new Error('Export already in progress');
  exportInProgress = true;
  try {
    mixer.stopAllAction();
    resetRest();
    asset.root.updateMatrixWorld(true);
    const result = await new GLTFExporter().parseAsync(asset.root, {
      binary: true,
      animations: asset.clips,
      onlyVisible: true,
      maxTextureSize: 256,
    });
    const response = await fetch('/__export', {
      method: 'POST',
      headers: { 'Content-Type': 'model/gltf-binary' },
      body: result,
    });
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
  try {
    await exportGlb();
  } catch (error) {
    setStatus(`导出失败：${error.message}`);
  }
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
  return {
    min: box.min.toArray(),
    max: box.max.toArray(),
    size: box.getSize(new THREE.Vector3()).toArray(),
  };
};
const sampleBones = () => asset.bones.map((bone) => ({
  name: bone.name,
  position: bone.position.toArray(),
  quaternion: bone.quaternion.toArray(),
  scale: bone.scale.toArray(),
}));
const effectStates = () => Object.fromEntries(effectBoneNames.map((name) => {
  const bone = asset.bones.find((item) => item.name === name);
  if (!bone) return [name, null];
  const worldScale = bone.getWorldScale(new THREE.Vector3());
  return [name, {
    scale: bone.scale.toArray(),
    maxScale: Math.max(...bone.scale.toArray().map(Math.abs)),
    position: bone.position.toArray(),
    worldPosition: bone.getWorldPosition(new THREE.Vector3()).toArray(),
    maxWorldScale: Math.max(...worldScale.toArray().map(Math.abs)),
  }];
}));
const validate = () => {
  const clipSummary = Object.fromEntries(asset.clips.map((clip) => [clip.name, {
    duration: clip.duration,
    tracks: clip.tracks.length,
  }]));
  const expectedDurations = Object.fromEntries(EXPECTED_CLIPS);
  resetRest();
  const restBounds = measuredBounds();
  const restPose = sampleBones();
  const hiddenAtRest = effectStates();

  sampleAt('attack', 1.25);
  const attack = effectStates();
  sampleAt('cast', 1.5);
  const cast = effectStates();

  const reverseErrors = [];
  for (let index = 0; index <= 140; index++) {
    const time = index / 140 * 1.5;
    sampleAt('dead', time);
    const dead = sampleBones();
    sampleAt('reviveRise', 1.5 - time);
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
    for (let index = 0; index <= 140; index++) {
      sampleAt(name, index / 140 * 1.5);
      minY = Math.min(minY, measuredBounds().min[1]);
    }
    ground[name] = { sampleCount: 141, minY, maxPenetrationMeters: Math.max(0, -minY) };
  }

  sampleAt('reviveRise', 1.5);
  const revivedBounds = measuredBounds();
  const revivedPose = sampleBones();
  let revivedPoseError = 0;
  for (let index = 0; index < restPose.length; index++) {
    for (let axis = 0; axis < 3; axis++) {
      revivedPoseError = Math.max(
        revivedPoseError,
        Math.abs(restPose[index].position[axis] - revivedPose[index].position[axis]),
        Math.abs(restPose[index].quaternion[axis] - revivedPose[index].quaternion[axis]),
        Math.abs(restPose[index].scale[axis] - revivedPose[index].scale[axis]),
      );
    }
  }

  let walkMinX = Infinity;
  let walkMaxX = -Infinity;
  let walkMinZ = Infinity;
  let walkMaxZ = -Infinity;
  for (let index = 0; index <= 48; index++) {
    sampleAt('walk', index / 48 * 1.2);
    walkMinX = Math.min(walkMinX, asset.root.position.x);
    walkMaxX = Math.max(walkMaxX, asset.root.position.x);
    walkMinZ = Math.min(walkMinZ, asset.root.position.z);
    walkMaxZ = Math.max(walkMaxZ, asset.root.position.z);
  }

  sampleAt('idle', 0);
  return {
    clips: clipSummary,
    expectedDurations,
    restBounds,
    hiddenAtRest,
    attack: attack.Note0,
    cast: cast.SoundRing0,
    reverse: {
      sampleCount: reverseErrors.length,
      maxPositionError: Math.max(...reverseErrors.map((sample) => sample.maxPositionError)),
      maxQuaternionError: Math.max(...reverseErrors.map((sample) => sample.maxQuaternionError)),
      maxScaleError: Math.max(...reverseErrors.map((sample) => sample.maxScaleError)),
    },
    ground,
    revivedBounds,
    revivedPoseError,
    walkRoot: {
      xRange: walkMaxX - walkMinX,
      zRange: walkMaxZ - walkMinZ,
      maxHorizontalOffset: Math.max(
        Math.abs(walkMinX - rootRestPosition.x), Math.abs(walkMaxX - rootRestPosition.x),
        Math.abs(walkMinZ - rootRestPosition.z), Math.abs(walkMaxZ - rootRestPosition.z),
      ),
    },
    rootTracksByClip: Object.fromEntries(asset.clips.map((clip) => [clip.name,
      clip.tracks.filter((track) => track.name.startsWith('Root.')).map((track) => track.name),
    ])),
    renderer: {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
    },
  };
};

const capture = (name, time, view = 'front') => {
  if (view) setView(view);
  seek(name, time);
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/png');
};
const resetCamera = () => {
  controls.minDistance = 2.4;
  camera.position.copy(DEFAULT_CAMERA);
  controls.target.copy(DEFAULT_TARGET);
  controls.update();
};
const setView = (view = 'front') => {
  controls.autoRotate = false;
  controls.minDistance = view === 'face' ? .35 : 2.4;
  if (view === 'back') camera.position.set(-2.7, 2.15, -4.1);
  else if (view === 'side') camera.position.set(4.3, 1.95, .15);
  else if (view === 'face') camera.position.set(.5, 1.89, 1.05);
  else camera.position.copy(DEFAULT_CAMERA);
  controls.target.copy(view === 'face' ? new THREE.Vector3(0, 1.86, .02) : DEFAULT_TARGET);
  controls.update();
};

for (const [name, duration] of EXPECTED_CLIPS) {
  const clip = actions.get(name)?.getClip();
  if (!clip || Math.abs(clip.duration - duration) > .0001) {
    throw new Error(`Model clip contract mismatch: ${name} (expected ${duration}s)`);
  }
}
if (asset.clips.length !== EXPECTED_CLIPS.length) {
  throw new Error(`Model must export exactly ${EXPECTED_CLIPS.length} clips`);
}

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

window.__chuixiao = {
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
  play,
  seek,
  capture,
  validate,
  exportGlb,
  resetCamera,
  setView,
  getState: () => ({
    camera: {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
      quaternion: camera.quaternion.toArray(),
    },
    current: currentName,
    time: current?.time ?? 0,
    duration: current?.getClip().duration ?? 0,
    running: current?.isRunning() ?? false,
    rootPosition: asset.root.position.toArray(),
    effects: effectStates(),
    bounds: measuredBounds(),
    renderer: {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
    },
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

setStatus('模型就绪。可逐帧拖动时间轴，或导出内嵌贴图与动画的 GLB。');
play('idle');
