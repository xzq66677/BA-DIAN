import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createGojoAsset } from './gojo.js';

const $ = (selector) => document.querySelector(selector);
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#080d1b');
scene.fog = new THREE.FogExp2('#080d1b', .045);
const camera = new THREE.PerspectiveCamera(33, stage.clientWidth / stage.clientHeight, .03, 30);
camera.position.set(2.75, 1.95, 4.15);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.02, 0);
controls.enableDamping = true;
controls.dampingFactor = .075;
controls.minDistance = 1.15;
controls.maxDistance = 7;
controls.maxPolarAngle = Math.PI * .49;
controls.autoRotate = true;
controls.autoRotateSpeed = .45;
controls.update();

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
scene.environmentIntensity = .72;
pmrem.dispose();
scene.add(new THREE.HemisphereLight('#c8dcff', '#111326', 1.5));
const key = new THREE.DirectionalLight('#fff1dc', 4.4);
key.position.set(-3, 5, 4);
key.castShadow = true;
key.shadow.mapSize.set(1536, 1536);
key.shadow.camera.left = key.shadow.camera.bottom = -2.4;
key.shadow.camera.right = key.shadow.camera.top = 2.4;
key.shadow.camera.near = .2;
key.shadow.camera.far = 12;
key.shadow.bias = -.00025;
key.shadow.normalBias = .018;
scene.add(key);
const rim = new THREE.DirectionalLight('#58c9ff', 3.5);
rim.position.set(3, 3.2, -3);
scene.add(rim);
const eyeFill = new THREE.PointLight('#8be9ff', 3.2, 3, 2);
eyeFill.position.set(0, 1.72, 1.1);
scene.add(eyeFill);

const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 80), new THREE.MeshStandardMaterial({ color: '#10182b', roughness: .9, metalness: .12 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -.012;
floor.receiveShadow = true;
scene.add(floor);
const plinth = new THREE.Mesh(new THREE.CylinderGeometry(.72, .82, .07, 64), new THREE.MeshStandardMaterial({ color: '#1c2945', roughness: .4, metalness: .58 }));
plinth.position.y = -.035;
plinth.receiveShadow = true;
scene.add(plinth);
for (const radius of [.84, 1.18, 1.72]) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, radius === .84 ? .009 : .0035, 5, 96), new THREE.MeshBasicMaterial({ color: radius === .84 ? '#73d7ee' : '#354c70', transparent: true, opacity: radius === .84 ? .72 : .42 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = .004;
  scene.add(ring);
}

const asset = createGojoAsset();
scene.add(asset.root);
asset.root.traverse((object) => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
let mixer = new THREE.AnimationMixer(asset.root);
let actions = new Map(asset.clips.map((clip) => [clip.name, mixer.clipAction(clip)]));
let current = null;
let currentName = 'idle';
let exportInProgress = false;
const looping = (name) => ['idle', 'walk', 'cast', 'domain_idle'].includes(name);
const status = (message) => { $('#status').textContent = message; };
const markActive = (name) => document.querySelectorAll('[data-clip]').forEach((button) => button.classList.toggle('active', button.dataset.clip === name));
const onFinished = (event) => {
  const name = event.action.getClip().name;
  if (name === currentName && name === 'domain_expand') play('domain_idle');
  else if (name === currentName && !looping(name)) play('idle');
};
mixer.addEventListener('finished', onFinished);

function play(name) {
  if (!asset.clips.some((clip) => clip.name === name)) throw new Error(`Unknown clip: ${name}`);
  mixer.stopAllAction();
  mixer = new THREE.AnimationMixer(asset.root);
  mixer.addEventListener('finished', onFinished);
  actions = new Map(asset.clips.map((clip) => [clip.name, mixer.clipAction(clip)]));
  asset.resetPose();
  current = actions.get(name);
  current.reset();
  current.setLoop(looping(name) ? THREE.LoopRepeat : THREE.LoopOnce, looping(name) ? Infinity : 1);
  current.clampWhenFinished = !looping(name);
  current.fadeIn(.14).play();
  currentName = name;
  markActive(name);
  status(name === 'domain_expand' ? '领域展开：抬手结印 → 双指术式起手' : name === 'domain_idle' ? '领域持续：双指术式起手，眼罩保持佩戴' : `正在播放：${name}`);
  $('#progressBar').style.width = '0%';
}

$('#domain').addEventListener('click', () => play('domain_expand'));
document.querySelectorAll('[data-clip]').forEach((button) => button.addEventListener('click', () => play(button.dataset.clip)));
$('#face').addEventListener('click', () => {
  controls.autoRotate = false;
  camera.position.set(0, 1.69, 2.05);
  controls.target.set(0, 1.62, .02);
  controls.update();
});
$('#resetCamera').addEventListener('click', () => {
  camera.position.set(2.75, 1.95, 4.15);
  controls.target.set(0, 1.02, 0);
  controls.update();
});
controls.addEventListener('start', () => { controls.autoRotate = false; });

function meshesOf(root) {
  const result = [];
  root.traverse((object) => { if (object.isSkinnedMesh) result.push(object); });
  return result;
}
function rendererDiagnostics() {
  return {
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
  };
}
function boundsOf(root) {
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  root.updateMatrixWorld(true);
  for (const mesh of meshesOf(root)) {
    mesh.skeleton.update();
    const positions = mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i);
      mesh.applyBoneTransform(i, point);
      mesh.localToWorld(point);
      box.expandByPoint(point);
    }
  }
  return box;
}
function eyeVisibility(root, head) {
  const meshes = meshesOf(root);
  const raycaster = new THREE.Raycaster();
  return [-1, 1].map((side) => {
    const origin = head.localToWorld(new THREE.Vector3(side * .068, .029, .8));
    const target = head.localToWorld(new THREE.Vector3(side * .068, .029, .16));
    raycaster.set(origin, target.sub(origin).normalize());
    const hit = raycaster.intersectObjects(meshes, false)[0];
    return { side, firstHit: hit?.object.name ?? null, clear: Boolean(hit && /EyeWhite|Iris|Pupil|Highlight/.test(hit.object.name)) };
  });
}
function poseAt(targetAsset, name, time) {
  const targetMixer = new THREE.AnimationMixer(targetAsset.root);
  const action = targetMixer.clipAction(targetAsset.clips.find((clip) => clip.name === name));
  action.play();
  action.paused = true;
  action.time = time;
  targetMixer.update(0);
  targetAsset.root.updateMatrixWorld(true);
}
function validateAsset(targetAsset, label) {
  const clipReports = targetAsset.clips.map((clip) => {
    let minY = Infinity, maxY = -Infinity, finite = true;
    for (const progress of [0, .25, .5, .75, 1]) {
      poseAt(targetAsset, clip.name, clip.duration * progress);
      const box = boundsOf(targetAsset.root);
      minY = Math.min(minY, box.min.y);
      maxY = Math.max(maxY, box.max.y);
      for (const bone of targetAsset.bones) {
        const values = [...bone.position.toArray(), ...bone.quaternion.toArray(), ...bone.scale.toArray()];
        if (!values.every(Number.isFinite)) finite = false;
      }
    }
    return { name: clip.name, duration: clip.duration, tracks: clip.tracks.length, minY, maxY, finite, grounded: minY >= -.012 };
  });
  const blindfoldSnapshot = () => ({
    position: targetAsset.Blindfold.position.toArray(),
    quaternion: targetAsset.Blindfold.quaternion.toArray(),
    scale: targetAsset.Blindfold.scale.toArray(),
  });
  const sameBlindfold = (sample) => sample.position.every((value, index) => Math.abs(value - restBlindfold.position[index]) < 1e-5) &&
    sample.quaternion.every((value, index) => Math.abs(value - restBlindfold.quaternion[index]) < 1e-5) &&
    sample.scale.every((value, index) => Math.abs(value - restBlindfold.scale[index]) < 1e-5);
  targetAsset.resetPose();
  const restBlindfold = blindfoldSnapshot();
  const masked = eyeVisibility(targetAsset.root, targetAsset.Head);
  const domainSamples = [];
  for (const time of [.4, 1.2, 2.2]) {
    poseAt(targetAsset, 'domain_expand', time);
    const eyes = eyeVisibility(targetAsset.root, targetAsset.Head);
    domainSamples.push({ time, eyes, eyesBlocked: eyes.every((eye) => !eye.clear && eye.firstHit === 'BlindfoldCloth'), blindfoldFixed: sameBlindfold(blindfoldSnapshot()) });
  }
  poseAt(targetAsset, 'domain_idle', 2);
  const heldEyes = eyeVisibility(targetAsset.root, targetAsset.Head);
  const heldBlindfoldFixed = sameBlindfold(blindfoldSnapshot());
  const fingerDirection = (name) => {
    let bone = targetAsset.root.getObjectByName(name) ?? targetAsset.root.getObjectByName(name.replace('L', '.L'));
    const quaternion = new THREE.Quaternion();
    while (bone && bone.name !== 'HandL' && bone.name !== 'Hand.L') {
      quaternion.premultiply(bone.quaternion);
      bone = bone.parent;
    }
    return new THREE.Vector3(0, -1, 0).applyQuaternion(quaternion).toArray();
  };
  const heldHandSeal = {
    index: fingerDirection('IndexL'), indexTip: fingerDirection('IndexTipL'),
    middle: fingerDirection('MiddleL'), middleTip: fingerDirection('MiddleTipL'),
    ring: fingerDirection('RingL'), ringTip: fingerDirection('RingTipL'),
    pinky: fingerDirection('PinkyL'), pinkyTip: fingerDirection('PinkyTipL'),
    pass: fingerDirection('IndexL')[1] < -.8 && fingerDirection('MiddleL')[1] < -.8 &&
      fingerDirection('IndexTipL')[1] < -.8 && fingerDirection('MiddleTipL')[1] < -.8 &&
      fingerDirection('RingL')[1] > -.65 && fingerDirection('PinkyL')[1] > -.65 &&
      fingerDirection('RingTipL')[1] > -.65 && fingerDirection('PinkyTipL')[1] > -.65,
  };
  targetAsset.resetPose();
  const weightsValid = meshesOf(targetAsset.root).every((mesh) => {
    const weights = mesh.geometry.attributes.skinWeight;
    for (let i = 0; i < weights.count; i++) if (Math.abs(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i) - 1) > 1e-5) return false;
    return true;
  });
  const bounds = boundsOf(targetAsset.root);
  return {
    label,
    clips: clipReports,
    stats: targetAsset.stats,
    weightsValid,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray(), size: bounds.getSize(new THREE.Vector3()).toArray() },
    maskedEyes: masked,
    domainSamples,
    heldEyes,
    heldBlindfoldFixed,
    heldHandSeal,
    pass: clipReports.every((clip) => clip.finite && clip.grounded) && weightsValid &&
      masked.every((eye) => !eye.clear && eye.firstHit === 'BlindfoldCloth') &&
      domainSamples.every((sample) => sample.eyesBlocked && sample.blindfoldFixed) &&
      heldEyes.every((eye) => !eye.clear && eye.firstHit === 'BlindfoldCloth') && heldBlindfoldFixed && heldHandSeal.pass,
  };
}

async function exportGlb() {
  if (exportInProgress) throw new Error('Export already in progress');
  exportInProgress = true;
  try {
    mixer.stopAllAction();
    asset.resetPose();
    asset.root.updateMatrixWorld(true);
    const result = await new GLTFExporter().parseAsync(asset.root, { binary: true, animations: asset.clips, onlyVisible: true, maxTextureSize: 256 });
    const response = await fetch('/__export', { method: 'POST', headers: { 'Content-Type': 'model/gltf-binary' }, body: result });
    if (!response.ok) throw new Error(`Export endpoint HTTP ${response.status}`);
    const saved = await response.json();
    status(`GLB 已保存：${saved.file} · ${(saved.bytes / 1024 / 1024).toFixed(2)} MB · SHA-256 ${saved.sha256.slice(0, 12)}…`);
    play('idle');
    return saved;
  } finally {
    exportInProgress = false;
  }
}
$('#export').addEventListener('click', async () => { try { await exportGlb(); } catch (error) { status(`导出失败：${error.message}`); } });

function loadedStats(root, bones, meshes) {
  let triangles = 0, vertices = 0;
  const materials = new Set();
  const textures = new Set();
  for (const mesh of meshes) {
    triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
    vertices += mesh.geometry.attributes.position.count;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  }
  const bounds = boundsOf(root);
  root.updateMatrixWorld(true);
  return {
    triangles, vertices, bones: bones.length, meshes: meshes.length,
    materials: materials.size, textures: textures.size,
    height: bounds.max.y, width: bounds.max.x - bounds.min.x, depth: bounds.max.z - bounds.min.z,
  };
}
async function validateSaved() {
  const response = await fetch('/model/gojo.glb');
  if (!response.ok) throw new Error(`Saved GLB HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
  const root = gltf.scene;
  const bones = [];
  root.traverse((object) => { if (object.isBone) bones.push(object); });
  const meshes = meshesOf(root);
  const loaded = {
    root, bones, meshes, clips: gltf.animations,
    Head: root.getObjectByName('Head'), Blindfold: root.getObjectByName('Blindfold'), handL: root.getObjectByName('HandL'),
    resetPose() {
      const rest = root.userData.restPose;
      for (const bone of bones) {
        const pose = rest.get(bone.name);
        bone.position.copy(pose.position); bone.quaternion.copy(pose.quaternion); bone.scale.copy(pose.scale);
      }
      root.updateMatrixWorld(true);
    },
    stats: loadedStats(root, bones, meshes),
  };
  root.userData.restPose = new Map(bones.map((bone) => [bone.name, { position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }]));
  renderer.render(scene, camera);
  const sourceRenderer = rendererDiagnostics();
  const sourceReport = validateAsset(asset, 'source');
  const loadedReport = validateAsset(loaded, 'independent-glb-reload');
  const importRenderer = new THREE.WebGLRenderer({ antialias: false });
  importRenderer.setSize(512, 512);
  importRenderer.outputColorSpace = THREE.SRGBColorSpace;
  const importScene = new THREE.Scene();
  importScene.background = new THREE.Color('#080d1b');
  importScene.add(new THREE.HemisphereLight('#c8dcff', '#111326', 1.5));
  const importLight = new THREE.DirectionalLight('#fff1dc', 3);
  importLight.position.set(-3, 5, 4);
  importScene.add(importLight, root);
  const importCamera = new THREE.PerspectiveCamera(33, 1, .03, 30);
  importCamera.position.set(2.75, 1.95, 4.15);
  importCamera.lookAt(0, 1.02, 0);
  importRenderer.render(importScene, importCamera);
  const loadedRenderer = {
    calls: importRenderer.info.render.calls,
    triangles: importRenderer.info.render.triangles,
    geometries: importRenderer.info.memory.geometries,
    textures: importRenderer.info.memory.textures,
  };
  importRenderer.dispose();
  importRenderer.forceContextLoss();
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    externalCredentialsUsed: false,
    renderer: { source: sourceRenderer, independentGlbReload: loadedRenderer },
    source: sourceReport,
    loaded: loadedReport,
    pass: sourceReport.pass && loadedReport.pass,
  };
  await fetch('/__validation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
  status(report.pass ? '独立 GLB 重载验证通过：蒙皮、接地、眼罩固定与双指手势检测全部通过。' : '验证存在失败项，请查看 evidence/validation.json。');
  return report;
}
$('#validate').addEventListener('click', async () => { try { await validateSaved(); } catch (error) { status(`验证失败：${error.message}`); } });

async function capture(name) {
  renderer.render(scene, camera);
  const data = renderer.domElement.toDataURL('image/png');
  const response = await fetch('/__evidence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data }) });
  if (!response.ok) throw new Error(`Evidence HTTP ${response.status}`);
  return response.json();
}

for (const [id,key] of [['triangles','triangles'],['bones','bones'],['meshes','meshes'],['height','height'],['clips','clips']]) {
  $(`#${id}`).textContent = key === 'clips' ? asset.clips.length : key === 'height' ? `${asset.stats.height.toFixed(3)} m` : asset.stats[key].toLocaleString();
}
$('#textures').textContent = `${asset.stats.textures}（内嵌织物 PBR）`;
status('模型就绪。点击「领域展开 · 术式起手」检查抬手、结印与眼罩固定。');
play('idle');

const clock = new THREE.Clock();
let elapsed = 0;
renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  elapsed += delta;
  mixer.update(delta);
  if (current && !looping(currentName) && current.isRunning()) $('#progressBar').style.width = `${Math.min(100, current.time / current.getClip().duration * 100)}%`;
  controls.update();
  renderer.render(scene, camera);
});

window.__gojo = {
  ready: true, stats: asset.stats, play, exportGlb, validateSaved, capture,
  seek(name, time) {
    mixer.stopAllAction();
    asset.resetPose();
    const seekMixer = new THREE.AnimationMixer(asset.root);
    const action = seekMixer.clipAction(asset.clips.find((clip) => clip.name === name));
    action.play(); action.paused = true; action.time = time; seekMixer.update(0);
    current = action; currentName = name; markActive(name);
    asset.root.updateMatrixWorld(true);
    const eyes = eyeVisibility(asset.root, asset.Head);
    return { name, time, eyes, bandPosition: asset.Blindfold.getWorldPosition(new THREE.Vector3()).toArray(), handPosition: asset.handL.getWorldPosition(new THREE.Vector3()).toArray(), bounds: boundsOf(asset.root).getSize(new THREE.Vector3()).toArray() };
  },
  getState() {
    const eyes = eyeVisibility(asset.root, asset.Head);
    const band = asset.Blindfold.getWorldPosition(new THREE.Vector3());
    const eyeCenters = [-1,1].map((side) => asset.Head.localToWorld(new THREE.Vector3(side*.068,.029,.17)));
    const fingerDirection = (bone) => new THREE.Vector3(0,-1,0).applyQuaternion(bone.quaternion).toArray();
    const jointDirection = (bone, tip) => new THREE.Vector3(0,-1,0).applyQuaternion(bone.quaternion.clone().multiply(tip.quaternion)).toArray();
    const index = fingerDirection(asset.indexL), middle = fingerDirection(asset.middleL);
    const ring = fingerDirection(asset.ringL), pinky = fingerDirection(asset.pinkyL);
    const indexTip = jointDirection(asset.indexL,asset.indexTipL), middleTip = jointDirection(asset.middleL,asset.middleTipL);
    const ringTip = jointDirection(asset.ringL,asset.ringTipL), pinkyTip = jointDirection(asset.pinkyL,asset.pinkyTipL);
    return {
      current: currentName, time: current?.time ?? 0, running: current?.isRunning() ?? false, elapsed, eyes,
      eyesBlocked: eyes.every((eye) => !eye.clear && eye.firstHit === 'BlindfoldCloth'),
      blindfoldFixed: asset.Blindfold.position.distanceTo(new THREE.Vector3(0,.034,.002)) < 1e-5 &&
        asset.Blindfold.quaternion.angleTo(new THREE.Quaternion()) < 1e-5 && asset.Blindfold.scale.distanceTo(new THREE.Vector3(1,1,1)) < 1e-5,
      handSeal: index[1] < -.8 && middle[1] < -.8 && indexTip[1] < -.8 && middleTip[1] < -.8 &&
        ring[1] > -.65 && pinky[1] > -.65 && ringTip[1] > -.65 && pinkyTip[1] > -.65,
      blindfoldMinEyeDistance: Math.min(...eyeCenters.map((eye) => eye.distanceTo(band))),
      handBlindfoldDistance: asset.handL.getWorldPosition(new THREE.Vector3()).distanceTo(band),
      renderer: rendererDiagnostics(),
      bounds: boundsOf(asset.root).getSize(new THREE.Vector3()).toArray(),
    };
  },
  resetCamera() { camera.position.set(2.75, 1.95, 4.15); controls.target.set(0, 1.02, 0); controls.update(); },
};
const resize = () => {
  camera.aspect = stage.clientWidth / stage.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(stage.clientWidth, stage.clientHeight);
};
window.addEventListener('resize', resize);
