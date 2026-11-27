import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createSlotHero } from './slot-hero.js';

const stage = document.querySelector('#stage');
const status = document.querySelector('#status');
const progressBar = document.querySelector('#progressBar');
if (window.__slotHeroRenderer) {
  window.__slotHeroRenderer.setAnimationLoop(null);
  window.__slotHeroRenderer.dispose();
}
stage.querySelectorAll('canvas').forEach((canvas) => canvas.remove());
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
window.__slotHeroRenderer = renderer;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#071719');
scene.fog = new THREE.FogExp2('#071719', .055);
const camera = new THREE.PerspectiveCamera(34, stage.clientWidth / stage.clientHeight, .05, 40);
camera.position.set(3.15, 2.25, 4.4);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.02, 0);
controls.enableDamping = true;
controls.dampingFactor = .07;
controls.minDistance = 2.5;
controls.maxDistance = 7;
controls.maxPolarAngle = Math.PI * .49;
controls.autoRotate = true;
controls.autoRotateSpeed = .55;
controls.update();

const pmrem = new THREE.PMREMGenerator(renderer);
const environment = pmrem.fromScene(new RoomEnvironment(), .04);
scene.environment = environment.texture;
scene.environmentIntensity = .85;
pmrem.dispose();

scene.add(new THREE.HemisphereLight('#b7eee1', '#182126', 1.35));
const key = new THREE.DirectionalLight('#ffe3ad', 4.2);
key.position.set(-3.5, 5.5, 4);
key.castShadow = true;
key.shadow.mapSize.set(1536, 1536);
key.shadow.camera.left = key.shadow.camera.bottom = -2.7;
key.shadow.camera.right = key.shadow.camera.top = 2.7;
key.shadow.camera.near = .5;
key.shadow.camera.far = 13;
key.shadow.bias = -.00035;
key.shadow.normalBias = .025;
scene.add(key);
const rim = new THREE.DirectionalLight('#57d9d0', 3.2);
rim.position.set(3, 3.4, -3);
scene.add(rim);
const fill = new THREE.PointLight('#e66b55', 18, 7, 2);
fill.position.set(-2, 1.2, 1.3);
scene.add(fill);

const floor = new THREE.Mesh(new THREE.CircleGeometry(4.5, 80), new THREE.MeshStandardMaterial({ color: '#0c2425', roughness: .9, metalness: .12 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -.012;
floor.receiveShadow = true;
scene.add(floor);
const plinth = new THREE.Mesh(new THREE.CylinderGeometry(.82, .9, .08, 64), new THREE.MeshStandardMaterial({ color: '#173b37', roughness: .42, metalness: .55 }));
plinth.position.y = -.04;
plinth.receiveShadow = true;
scene.add(plinth);
for (const radius of [.93, 1.22, 1.75, 2.45]) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, radius === .93 ? .012 : .004, 5, 96), new THREE.MeshBasicMaterial({ color: radius === .93 ? '#a47a3d' : '#31534c', transparent: true, opacity: radius === .93 ? .8 : .45 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = .006;
  scene.add(ring);
}
for (let index = 0; index < 32; index++) {
  const angle = index / 32 * Math.PI * 2;
  const tick = new THREE.Mesh(new THREE.BoxGeometry(.012, .004, index % 4 === 0 ? .14 : .065), new THREE.MeshBasicMaterial({ color: index % 4 === 0 ? '#bd9250' : '#41645b' }));
  tick.position.set(Math.sin(angle) * 1.05, .008, Math.cos(angle) * 1.05);
  tick.rotation.y = angle;
  scene.add(tick);
}

const asset = createSlotHero();
scene.add(asset.root);
const restPose = new Map(asset.bones.map((bone) => [bone.name, { position: bone.position.clone(), quaternion: bone.quaternion.clone() }]));
const resetRest = () => {
  for (const bone of asset.bones) {
    const rest = restPose.get(bone.name);
    bone.position.copy(rest.position);
    bone.quaternion.copy(rest.quaternion);
  }
};
const mixer = new THREE.AnimationMixer(asset.root);
const actions = new Map(asset.clips.map((clip) => [clip.name, mixer.clipAction(clip)]));
let current = null;
let currentName = 'idle';
let exportInProgress = false;

const setStatus = (message) => { status.textContent = message; };
const markActive = (name) => {
  document.querySelectorAll('[data-clip]').forEach((button) => button.classList.toggle('active', button.dataset.clip === name));
};
const play = (name, loop = name === 'idle' || name === 'walk') => {
  if (!actions.has(name)) throw new Error(`Unknown animation: ${name}`);
  current?.fadeOut(.16);
  current = actions.get(name);
  current.reset();
  current.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  current.clampWhenFinished = !loop;
  current.fadeIn(.16);
  current.play();
  currentName = name;
  markActive(name);
  setStatus(name === 'slot_pull' ? '拉杆压下 → 三滚轮旋转 → 回弹待机' : name === 'victory' ? '胜利庆祝 → 双手举起 → 滚轮开奖 → 回待机' : `正在播放：${name}`);
  progressBar.style.width = '0%';
  return name;
};
mixer.addEventListener('finished', (event) => {
  if ((event.action === actions.get('slot_pull') || event.action === actions.get('victory')) && currentName === event.action.getClip().name) play('idle');
});

document.querySelector('#pull').addEventListener('click', () => play('slot_pull', false));
document.querySelectorAll('[data-clip]').forEach((button) => button.addEventListener('click', () => play(button.dataset.clip, button.dataset.clip === 'idle' || button.dataset.clip === 'walk')));
controls.addEventListener('start', () => { controls.autoRotate = false; });

const exportGlb = async () => {
  if (exportInProgress) throw new Error('Export already in progress');
  exportInProgress = true;
  try {
    mixer.stopAllAction();
    resetRest();
    asset.root.updateMatrixWorld(true);
    const result = await new GLTFExporter().parseAsync(asset.root, { binary: true, animations: asset.clips, onlyVisible: true, maxTextureSize: 512 });
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
setStatus('模型就绪。点击拉杆或切换动作；导出会恢复绑定姿态并内嵌全部贴图。');
play('idle');

const clock = new THREE.Clock();
let elapsed = 0;
renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  elapsed += delta;
  mixer.update(delta);
  if (current && !current.loop && current.isRunning()) progressBar.style.width = `${Math.min(100, (current.time / current.getClip().duration) * 100)}%`;
  controls.update();
  renderer.render(scene, camera);
});

window.__slotHero = {
  ready: true,
  stats: asset.stats,
  textureCount: textures.size,
  play,
  exportGlb,
  resetCamera: () => { camera.position.set(3.15, 2.25, 4.4); controls.target.set(0, 1.02, 0); controls.update(); },
  getState: () => ({
    current: currentName,
    time: current?.time ?? 0,
    running: current?.isRunning() ?? false,
    elapsed,
    renderer: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
    bounds: new THREE.Box3().setFromObject(asset.root, true).getSize(new THREE.Vector3()).toArray(),
    handKnobDistance: asset.bones.find((bone) => bone.name === 'Hand.R').getWorldPosition(new THREE.Vector3()).distanceTo(
      asset.bones.find((bone) => bone.name === 'Lever').localToWorld(new THREE.Vector3(.16, .32, .06)),
    ),
  }),
};

const resize = () => {
  camera.aspect = stage.clientWidth / stage.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(stage.clientWidth, stage.clientHeight);
};
window.addEventListener('resize', resize);
