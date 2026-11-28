import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const modelFile = path.join(here, 'model', 'bagun.glb');
const evidenceDirectory = path.join(here, 'evidence');
const previewUrl = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5212/';
const buffer = fs.readFileSync(modelFile);
const header = {
  magic: buffer.toString('ascii', 0, 4),
  version: buffer.readUInt32LE(4),
  declaredLength: buffer.readUInt32LE(8),
  fileLength: buffer.length,
};
const jsonLength = buffer.readUInt32LE(12);
const json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).trim());
const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

const checks = [];
const check = (name, passed, details) => checks.push({ name, passed: Boolean(passed), details });
const screenshot = async (name, clip, time, view) => {
  const data = await page.evaluate(async ({ name, clip, time, view }) => {
    window.__bagun.setView(view);
    const png = window.__bagun.capture(clip, time);
    const response = await fetch('/__evidence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data: png }) });
    if (!response.ok) throw new Error(`Evidence save failed: ${response.status}`);
    return response.json();
  }, { name, clip, time, view });
  return data;
};

try {
  await page.goto(previewUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__bagun?.ready);

  const loaded = await page.evaluate(async (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const gltf = await window.__bagun.reloadGlb(bytes.buffer);
    const meshes = [];
    const bones = [];
    const materials = new Set();
    const textures = new Set();
    const skins = new Set();
    const images = new Map();
    let triangles = 0;
    let vertices = 0;
    let maxSkinIndex = -1;
    let minWeight = Infinity;
    let maxWeight = -Infinity;
    let invalidWeights = 0;
    let invalidSkinIndices = 0;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((object) => {
      if (object.isBone) bones.push(object);
      if (!object.isMesh) return;
      meshes.push(object);
      const geometry = object.geometry;
      triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
      vertices += geometry.attributes.position.count;
      if (object.isSkinnedMesh) {
        skins.add(object.skeleton);
        const skinIndex = geometry.attributes.skinIndex;
        const skinWeight = geometry.attributes.skinWeight;
        for (let index = 0; index < skinIndex.count; index++) {
          const sum = skinWeight.getX(index) + skinWeight.getY(index) + skinWeight.getZ(index) + skinWeight.getW(index);
          minWeight = Math.min(minWeight, sum);
          maxWeight = Math.max(maxWeight, sum);
          if (Math.abs(sum - 1) > .0001) invalidWeights++;
          for (const component of ['X', 'Y', 'Z', 'W']) {
            const value = skinIndex[`get${component}`](index);
            maxSkinIndex = Math.max(maxSkinIndex, value);
            if (value >= object.skeleton.bones.length) invalidSkinIndices++;
          }
        }
      }
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const [key, value] of Object.entries(material)) {
          if (!value?.isTexture) continue;
          textures.add(value);
          const image = value.image;
          if (!image) continue;
          const dimensions = `${key}:${image.width || image.videoWidth || 0}x${image.height || image.videoHeight || 0}`;
          images.set(dimensions, (images.get(dimensions) || 0) + 1);
        }
      }
    });
    const pbrMaterials = [...materials]
      .filter((material) => material.map && material.roughnessMap && material.metalnessMap && material.normalMap)
      .map((material) => material.name);
    const rest = new Map(bones.map((bone) => [bone.name, {
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
      scale: bone.scale.clone(),
    }]));
    const mixer = window.__bagun.createMixer(gltf.scene);
    const actions = new Map(gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
    const reset = () => {
      mixer.stopAllAction();
      for (const bone of bones) {
        const pose = rest.get(bone.name);
        bone.position.copy(pose.position);
        bone.quaternion.copy(pose.quaternion);
        bone.scale.copy(pose.scale);
      }
      gltf.scene.updateMatrixWorld(true);
    };
    const seek = (name, time) => {
      reset();
      const action = actions.get(name);
      action.reset().play();
      action.time = Math.max(0, Math.min(action.getClip().duration, time));
      mixer.update(0);
      action.paused = true;
      gltf.scene.updateMatrixWorld(true);
      for (const mesh of meshes) {
        if (!mesh.isSkinnedMesh) continue;
        mesh.skeleton.update();
        mesh.computeBoundingBox();
      }
    };
    const bounds = () => {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const mesh of meshes) {
        if (!mesh.isSkinnedMesh) continue;
        mesh.skeleton.update();
        mesh.computeBoundingBox();
        const local = mesh.boundingBox;
        for (const x of [local.min.x, local.max.x]) {
          for (const y of [local.min.y, local.max.y]) {
            for (const z of [local.min.z, local.max.z]) {
              const point = new gltf.scene.position.constructor(x, y, z).applyMatrix4(mesh.matrixWorld);
              for (let axis = 0; axis < 3; axis++) {
                min[axis] = Math.min(min[axis], point.getComponent(axis));
                max[axis] = Math.max(max[axis], point.getComponent(axis));
              }
            }
          }
        }
      }
      return { min, max, size: max.map((value, axis) => value - min[axis]) };
    };
    const sampleBones = () => bones.map((bone) => ({
      name: bone.name,
      position: bone.position.toArray(),
      quaternion: bone.quaternion.toArray(),
      scale: bone.scale.toArray(),
    }));
    const bone = (name) => bones.find((item) => item.name === name);
    const gripDistances = () => {
      gltf.scene.updateMatrixWorld(true);
      return [
        bone('HandR').getWorldPosition(new gltf.scene.position.constructor()).distanceTo(bone('StickGrip').getWorldPosition(new gltf.scene.position.constructor())),
      ];
    };

    reset();
    const restBounds = bounds();
    const deadDuration = actions.get('dead').getClip().duration;
    const swingDuration = actions.get('swing').getClip().duration;
    const gripSamples = [];
    for (const ratio of [0, .16, .32, .48, .64, .82, 1]) {
      seek('swing', ratio * swingDuration);
      gripSamples.push({ time: ratio * swingDuration, distances: gripDistances() });
    }
    let maxPositionError = 0;
    let maxQuaternionError = 0;
    let maxScaleError = 0;
    for (let index = 0; index <= 140; index++) {
      const time = index / 140 * deadDuration;
      seek('dead', time);
      const dead = sampleBones();
      seek('reviveRise', deadDuration - time);
      const revive = sampleBones();
      for (let boneIndex = 0; boneIndex < dead.length; boneIndex++) {
        for (let axis = 0; axis < 3; axis++) {
          maxPositionError = Math.max(maxPositionError, Math.abs(dead[boneIndex].position[axis] - revive[boneIndex].position[axis]));
          maxQuaternionError = Math.max(maxQuaternionError, Math.abs(dead[boneIndex].quaternion[axis] - revive[boneIndex].quaternion[axis]));
          maxScaleError = Math.max(maxScaleError, Math.abs(dead[boneIndex].scale[axis] - revive[boneIndex].scale[axis]));
        }
      }
    }
    const ground = {};
    for (const name of ['dead', 'reviveRise']) {
      let minY = Infinity;
      for (let index = 0; index <= 25; index++) {
        seek(name, index / 25 * deadDuration);
        minY = Math.min(minY, bounds().min[1]);
      }
      ground[name] = { sampleCount: 26, minY, maxPenetrationMeters: Math.max(0, -minY) };
    }
    seek('dead', deadDuration);
    const deadBounds = bounds();
    seek('reviveRise', deadDuration);
    const revivedBounds = bounds();
    const animations = gltf.animations.map((clip) => ({
      name: clip.name,
      duration: clip.duration,
      tracks: clip.tracks.length,
      finite: clip.tracks.every((track) => [...track.times, ...track.values].every(Number.isFinite)),
      targetsExist: clip.tracks.every((track) => gltf.scene.getObjectByName(track.name.split('.')[0])),
      maxQuaternionNormalizationError: Math.max(0, ...clip.tracks.filter((track) => track.name.endsWith('.quaternion')).flatMap((track) => {
        const errors = [];
        for (let index = 0; index < track.values.length; index += 4) {
          errors.push(Math.abs(Math.hypot(...track.values.slice(index, index + 4)) - 1));
        }
        return errors;
      })),
    }));
    const rootTracks = gltf.animations.map((clip) => {
      const track = clip.tracks.find((item) => item.name === 'Root.position');
      if (!track) return { name: clip.name, horizontalTravel: 0 };
      let horizontalTravel = 0;
      for (let index = 0; index < track.values.length; index += 3) {
        horizontalTravel = Math.max(horizontalTravel, Math.hypot(track.values[index] - track.values[0], track.values[index + 2] - track.values[2]));
      }
      return { name: clip.name, horizontalTravel };
    });
    const stickNode = gltf.scene.getObjectByName('stick');
    const stickMeshes = [];
    stickNode?.traverse((object) => { if (object.isMesh) stickMeshes.push(object); });
    const effectivelyVisible = (object) => {
      for (let current = object; current; current = current.parent) if (!current.visible) return false;
      return true;
    };
    const stickVisible = stickNode?.visible ?? false;
    if (stickNode) stickNode.visible = false;
    const stickHidden = stickMeshes.length > 0 && stickMeshes.every((mesh) => !effectivelyVisible(mesh));
    if (stickNode) stickNode.visible = true;
    return {
      stickNode: Boolean(stickNode),
      stickVisible,
      stickMeshCount: stickMeshes.length,
      stickToggleWorks: stickHidden,
      bones: bones.length,
      boneNames: bones.map((item) => item.name),
      meshes: meshes.length,
      skinnedMeshes: meshes.filter((mesh) => mesh.isSkinnedMesh).length,
      skins: skins.size,
      jointsPerSkin: [...skins].map((skeleton) => skeleton.bones.length),
      triangles,
      vertices,
      materials: materials.size,
      pbrMaterials,
      loadedTextures: textures.size,
      embeddedImageDimensions: Object.fromEntries(images),
      maxSkinIndex,
      minWeightSum: minWeight,
      maxWeightSum: maxWeight,
      invalidWeights,
      invalidSkinIndices,
      restBounds,
      gripSamples,
      maxGripError: Math.max(...gripSamples.flatMap((sample) => sample.distances)),
      reverse: { sampleCount: 141, maxPositionError, maxQuaternionError, maxScaleError },
      ground,
      deadBounds,
      revivedBounds,
      animations,
      rootTracks,
    };
  }, buffer.toString('base64'));

  check('GLB 2 header and declared length', header.magic === 'glTF' && header.version === 2 && header.declaredLength === header.fileLength, header);
  check('All glTF resources embedded', json.buffers.every((item) => item.uri === undefined) && json.images.every((item) => item.uri === undefined || item.uri.startsWith('data:')), { buffers: json.buffers.length, images: json.images?.length ?? 0 });
  check('GLB under 4 MiB', buffer.length < 4 * 1024 * 1024, { bytes: buffer.length, megabytes: buffer.length / 1000000 });
  check('Triangle budget under 65000', loaded.triangles <= 65000, { triangles: loaded.triangles });
  check('Expected animation set', ['idle', 'walk', 'swing', 'flinch', 'dead', 'reviveRise', 'victory'].every((name) => loaded.animations.some((clip) => clip.name === name)), loaded.animations.map((clip) => clip.name));
  check('Humanoid skeleton and paired limbs', loaded.bones >= 20 && ['HandL', 'HandR', 'FootL', 'FootR', 'StickGrip', 'StickPivot'].every((name) => loaded.boneNames.includes(name)), { bones: loaded.bones });
  check('Production stick visibility node exists', loaded.stickNode, { stickNode: loaded.stickNode });
  check('Production stick toggle controls its mesh batch', loaded.stickVisible && loaded.stickToggleWorks && loaded.stickMeshCount >= 3, { visible: loaded.stickVisible, meshes: loaded.stickMeshCount, toggleWorks: loaded.stickToggleWorks });
  check('All meshes skinned with complete joint sets', loaded.skinnedMeshes === loaded.meshes && loaded.jointsPerSkin.every((count) => count === loaded.bones), { meshes: loaded.meshes, skinnedMeshes: loaded.skinnedMeshes, jointsPerSkin: loaded.jointsPerSkin });
  check('Skin indices and normalized weights valid', loaded.invalidWeights === 0 && loaded.invalidSkinIndices === 0 && Math.abs(loaded.minWeightSum - 1) < .0001 && Math.abs(loaded.maxWeightSum - 1) < .0001, loaded);
  check('Animation tracks finite and targets exist', loaded.animations.every((clip) => clip.finite && clip.targetsExist && clip.maxQuaternionNormalizationError < .0001), loaded.animations);
  check('No horizontal root motion', loaded.rootTracks.every((clip) => clip.horizontalTravel < .000001), loaded.rootTracks);
  check('PBR maps present on all model materials', loaded.pbrMaterials.length === loaded.materials && loaded.pbrMaterials.length >= 6, loaded.pbrMaterials);
  check('Rest pose grounded and upright', Math.abs(loaded.restBounds.min[1]) < .01 && loaded.restBounds.size[1] > 1.5 && loaded.restBounds.size[1] < 2.5, loaded.restBounds);
  check('Right-hand staff grip stays attached', loaded.maxGripError < .0001, loaded.gripSamples);
  check('Revive is exact reverse of death', loaded.reverse.maxPositionError < .000001 && loaded.reverse.maxQuaternionError < .000001 && loaded.reverse.maxScaleError < .000001, loaded.reverse);
  check('Death and revive do not penetrate ground', loaded.ground.dead.maxPenetrationMeters < .01 && loaded.ground.reviveRise.maxPenetrationMeters < .01, loaded.ground);

  const sourceValidation = await page.evaluate(() => window.__bagun.validate());
  check('Source preview validation matches exported behavior', sourceValidation.maxSwingGripError < .0001 && sourceValidation.reverse.maxPositionError < .000001, sourceValidation);

  const clipNames = ['idle', 'walk', 'swing', 'flinch', 'dead', 'reviveRise', 'victory'];
  for (const name of clipNames) {
    await page.evaluate((clip) => window.__bagun.play(clip), name);
    await page.waitForTimeout(80);
    const state = await page.evaluate(() => window.__bagun.getState());
    check(`Preview button plays ${name}`, state.current === name, { current: state.current, time: state.time });
  }
  await page.evaluate(() => window.__bagun.play('swing'));
  await page.waitForFunction(() => window.__bagun.getState().current === 'idle', null, { timeout: 10000 });
  check('One-shot swing returns to idle', true);
  await page.evaluate(() => {
    const timeline = document.querySelector('#timeline');
    timeline.value = '500';
    timeline.dispatchEvent(new Event('input', { bubbles: true }));
  });
  check('Timeline scrubbing seeks current clip', (await page.evaluate(() => window.__bagun.getState().time)) > .5);

  const evidence = [];
  evidence.push(await screenshot('preview-idle.png', 'idle', 0, 'front'));
  evidence.push(await screenshot('preview-face.png', 'idle', 0, 'face'));
  evidence.push(await screenshot('preview-back.png', 'idle', 0, 'back'));
  evidence.push(await screenshot('preview-walk.png', 'walk', .5, 'side'));
  evidence.push(await screenshot('preview-swing-windup.png', 'swing', .7, 'staff'));
  evidence.push(await screenshot('preview-swing-sweep.png', 'swing', 1.18, 'staff'));
  evidence.push(await screenshot('preview-flinch.png', 'flinch', .25, 'front'));
  evidence.push(await screenshot('preview-victory.png', 'victory', 1.4, 'front'));
  evidence.push(await screenshot('preview-dead.png', 'dead', 1.25, 'front'));
  evidence.push(await screenshot('preview-revive.png', 'reviveRise', .62, 'front'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.__bagun.setView('front'));
  await page.waitForTimeout(100);
  const mobile = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, canvas: document.querySelector('canvas').getBoundingClientRect().toJSON() }));
  check('390px mobile layout has no horizontal overflow', mobile.scrollWidth <= mobile.innerWidth, mobile);
  const mobileEvidence = await page.evaluate(async () => {
    const png = document.querySelector('canvas').toDataURL('image/png');
    const response = await fetch('/__evidence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'preview-mobile-390.png', data: png }) });
    if (!response.ok) throw new Error(`Evidence save failed: ${response.status}`);
    return response.json();
  });
  evidence.push(mobileEvidence);
  check('Evidence screenshots saved', evidence.every((item) => fs.existsSync(path.join(here, item.file)) && fs.statSync(path.join(here, item.file)).size > 10000), evidence);
  check('No browser page errors', pageErrors.length === 0, pageErrors);

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    asset: 'bagun-v1',
    provider: { name: 'local-procedural', tripoCredentials: 'MISSING', externalGenerationUsed: false },
    file: { file: 'model/bagun.glb', bytes: buffer.length, megabytes: buffer.length / 1000000, sha256, glbHeader: header },
    loaded,
    sourceValidation,
    mobile,
    pageErrors,
    checks,
    summary: { passed: checks.filter((item) => item.passed).length, total: checks.length, passedAll: checks.every((item) => item.passed) },
    evidence,
  };
  await page.evaluate(async (value) => {
    const response = await fetch('/__validation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    if (!response.ok) throw new Error(`Validation save failed: ${response.status}`);
  }, report);
  console.log(JSON.stringify(report.summary, null, 2));
  for (const item of checks.filter((entry) => !entry.passed)) console.error(`FAIL ${item.name}: ${JSON.stringify(item.details)}`);
  if (!report.summary.passedAll) process.exitCode = 1;
} finally {
  await browser.close();
}
