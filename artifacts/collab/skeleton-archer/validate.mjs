import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const modelFile = path.join(here, 'model', 'skeleton-archer.glb');
const evidenceDirectory = path.join(here, 'evidence');
const previewUrl = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5207/';
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
page.on('pageerror', error => pageErrors.push(error.message));

try {
  await page.goto(previewUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__skeletonArcher?.ready);

  const loaded = await page.evaluate(async base64 => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const gltf = await window.__skeletonArcher.reloadGlb(bytes.buffer);
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
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(object => {
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
          for (const component of ['X', 'Y', 'Z', 'W']) maxSkinIndex = Math.max(maxSkinIndex, skinIndex[`get${component}`](index));
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
      .filter(material => material.map && material.roughnessMap && material.metalnessMap && material.normalMap)
      .map(material => material.name);
    const rest = new Map(bones.map(bone => [bone.name, {
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
      scale: bone.scale.clone(),
    }]));
    const mixer = window.__skeletonArcher.createMixer(gltf.scene);
    const actions = new Map(gltf.animations.map(clip => [clip.name, mixer.clipAction(clip)]));
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
    const sampleBones = () => bones.map(bone => ({
      name: bone.name,
      position: bone.position.toArray(),
      quaternion: bone.quaternion.toArray(),
      scale: bone.scale.toArray(),
    }));
    const bone = name => bones.find(item => item.name === name);

    reset();
    const restBounds = bounds();
    const hiddenAtRest = Object.fromEntries(
      ['FireArrow', 'StuckArrow', 'NockedArrow', 'BurnFlame0', 'DebrisSkull']
        .map(name => [name, bone(name).scale.x])
    );
    seek('shoot', 1.45);
    const shootState = { scale: bone('FireArrow').scale.x, position: bone('FireArrow').position.toArray() };
    seek('flinch_burning', .60);
    const burningState = Object.fromEntries(
      ['StuckArrow', 'BurnFlame0', 'BurnFlame1', 'Ash0']
        .map(name => [name, bone(name).scale.x])
    );

    let maxPositionError = 0;
    let maxQuaternionError = 0;
    let maxScaleError = 0;
    for (let index = 0; index <= 140; index++) {
      const time = index / 140 * 1.4;
      seek('dead', time);
      const dead = sampleBones();
      seek('reviveRise', 1.4 - time);
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
      for (let index = 0; index <= 28; index++) {
        seek(name, index / 28 * 1.4);
        minY = Math.min(minY, bounds().min[1]);
      }
      ground[name] = { sampleCount: 29, minY, maxPenetrationMeters: Math.max(0, -minY) };
    }
    seek('dead', 1.4);
    const deadBounds = bounds();
    seek('reviveRise', 1.4);
    const revivedBounds = bounds();

    const animations = gltf.animations.map(clip => ({
      name: clip.name,
      duration: clip.duration,
      tracks: clip.tracks.length,
      finite: clip.tracks.every(track => [...track.times, ...track.values].every(Number.isFinite)),
      targetsExist: clip.tracks.every(track => gltf.scene.getObjectByName(track.name.split('.')[0])),
      maxQuaternionNormalizationError: Math.max(0, ...clip.tracks.filter(track => track.name.endsWith('.quaternion')).flatMap(track => {
        const errors = [];
        for (let index = 0; index < track.values.length; index += 4) {
          const length = Math.hypot(...track.values.slice(index, index + 4));
          errors.push(Math.abs(length - 1));
        }
        return errors;
      })),
    }));

    return {
      bones: bones.length,
      meshes: meshes.length,
      skinnedMeshes: meshes.filter(mesh => mesh.isSkinnedMesh).length,
      skins: skins.size,
      jointsPerSkin: [...skins].map(skeleton => skeleton.bones.length),
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
      animations,
      rootMotion: gltf.animations.some(clip => clip.tracks.some(track => track.name.startsWith('Root.'))),
      restBounds,
      hiddenAtRest,
      shootState,
      burningState,
      reverse: { sampleCount: 141, maxPositionError, maxQuaternionError, maxScaleError },
      ground,
      deadBounds,
      revivedBounds,
    };
  }, buffer.toString('base64'));

  const sourceValidation = await page.evaluate(() => window.__skeletonArcher.validate());
  const stats = await page.evaluate(() => window.__skeletonArcher.stats);
  const textureCount = await page.evaluate(() => window.__skeletonArcher.textureCount);

  const controls = await page.locator('[data-clip]').evaluateAll(buttons => buttons.map(button => button.dataset.clip));
  const controlResults = {};
  for (const name of controls) {
    controlResults[name] = await page.evaluate(clip => {
      document.querySelector(`[data-clip="${clip}"]`).click();
      return window.__skeletonArcher.getState().current;
    }, name);
  }
  const oneShotReturnWallMilliseconds = {};
  for (const name of ['shoot', 'flinch_burning']) {
    const started = Date.now();
    await page.locator(`[data-clip="${name}"]`).click();
    await page.waitForFunction(() => window.__skeletonArcher.getState().current === 'idle', null, { timeout: 10000 });
    oneShotReturnWallMilliseconds[name] = Date.now() - started;
  }

  const captures = [];
  const capture = async (file, clip, time, view = 'front', stageOnly = false) => {
    await page.evaluate(({ clip, time, view }) => {
      window.__skeletonArcher.setView(view);
      window.__skeletonArcher.seek(clip, time);
    }, { clip, time, view });
    await page.screenshot({ path: path.join(evidenceDirectory, file), fullPage: !stageOnly });
    captures.push({ file: `evidence/${file}`, clip, time, view });
  };
  await capture('preview-idle.png', 'idle', 1.60);
  await capture('preview-face.png', 'idle', .55, 'face', true);
  await capture('preview-shoot-draw.png', 'shoot', .95);
  await capture('preview-fire-arrow.png', 'shoot', 1.45, 'projectile');
  await capture('preview-fire-arrow-front.png', 'shoot', 1.45);
  await capture('preview-flinch.png', 'flinch', .25);
  await capture('preview-arrow-in-back.png', 'flinch_burning', .85, 'back');
  await capture('preview-arrow-in-back-side.png', 'flinch_burning', .85, 'side');
  await capture('preview-burning.png', 'burn', 1.0, 'back');
  await capture('preview-dead-scattered.png', 'dead', 1.40);
  await capture('preview-revive-reassembling.png', 'reviveRise', .45);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  mobile.on('pageerror', error => pageErrors.push(`mobile: ${error.message}`));
  await mobile.goto(previewUrl, { waitUntil: 'networkidle' });
  await mobile.waitForFunction(() => window.__skeletonArcher?.ready);
  await mobile.evaluate(() => window.__skeletonArcher.seek('idle', 1.6));
  await mobile.screenshot({ path: path.join(evidenceDirectory, 'preview-mobile-390.png'), fullPage: true });
  const mobileMetrics = await mobile.evaluate(() => {
    const canvas = document.querySelector('#stage canvas');
    return {
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      canvasCssSize: [canvas.clientWidth, canvas.clientHeight],
      animationButtons: document.querySelectorAll('[data-clip]').length,
    };
  });
  await mobile.close();
  captures.push({ file: 'evidence/preview-mobile-390.png', viewport: '390x844' });

  const renderer = await page.evaluate(() => window.__skeletonArcher.getState().renderer);
  const externalResources = json.buffers.some(item => item.uri) || json.images.some(item => item.uri);
  const checks = {
    glbHeader: header.magic === 'glTF' && header.version === 2 && header.declaredLength === header.fileLength,
    embeddedResources: !externalResources && json.images.length > 0,
    skeletonAndWeights: loaded.bones === 53 && loaded.skinnedMeshes === loaded.meshes && loaded.skins > 0 && loaded.invalidWeights === 0 && loaded.maxSkinIndex < loaded.jointsPerSkin[0],
    animationClips: loaded.animations.length === 8 && loaded.animations.every(clip => clip.finite && clip.targetsExist && clip.maxQuaternionNormalizationError < .0001),
    embeddedPbrMaps: loaded.pbrMaterials.length === 6 && loaded.loadedTextures === 24,
    groundedFeet: Math.abs(loaded.restBounds.min[1]) < .0001,
    deathGroundContact: loaded.ground.dead.maxPenetrationMeters < .0001 && loaded.ground.reviveRise.maxPenetrationMeters < .0001,
    reverseAnimation: loaded.reverse.maxPositionError < .000001 && loaded.reverse.maxQuaternionError < .000001 && loaded.reverse.maxScaleError < .000001,
    restoredBounds: loaded.restBounds.size.every((value, axis) => Math.abs(value - loaded.revivedBounds.size[axis]) < .000001),
    fireArrowLaunch: loaded.shootState.scale === 1 && loaded.shootState.position[2] > .7,
    embeddedArrowAndFire: loaded.burningState.StuckArrow === 1 && loaded.burningState.BurnFlame0 > 0 && loaded.burningState.Ash0 > 0,
    hiddenEffectsAtRest: Object.values(loaded.hiddenAtRest).every(scale => scale < .001),
    noRootMotion: !loaded.rootMotion,
    allPreviewControls: controls.length === 8 && Object.entries(controlResults).every(([name, current]) => name === current),
    oneShotReturnsToIdle: Object.values(oneShotReturnWallMilliseconds).every(value => value > 1000 && value < 10000),
    mobileNoHorizontalOverflow: !mobileMetrics.horizontalOverflow && mobileMetrics.animationButtons === 8,
    noPageErrors: pageErrors.length === 0,
    glbSizeTarget4Mb: buffer.length < 4 * 1024 * 1024,
    triangleTarget65k: loaded.triangles <= 65000,
  };

  const validation = {
    schemaVersion: 1,
    generatedOn: new Date().toISOString(),
    scope: 'visual-assets-only',
    asset: {
      file: 'model/skeleton-archer.glb',
      bytes: buffer.length,
      megabytes: buffer.length / 1000000,
      mebibytes: buffer.length / 1048576,
      sha256,
      ...header,
      declaredLengthMatchesFileLength: header.declaredLength === header.fileLength,
      externalResources,
      embeddedImages: json.images.length,
    },
    model: {
      heightMeters: loaded.restBounds.size[1],
      widthMeters: loaded.restBounds.size[0],
      depthMeters: loaded.restBounds.size[2],
      restBounds: loaded.restBounds,
      upAxis: '+Y',
      forwardAxis: '+Z',
      footY: loaded.restBounds.min[1],
      rootMotion: loaded.rootMotion,
      ...loaded,
      animations: undefined,
      modelDrawCalls: loaded.meshes,
    },
    animations: Object.fromEntries(loaded.animations.map(clip => [clip.name, { duration: clip.duration, tracks: clip.tracks }])),
    gltfLoaderReload: {
      passed: checks.skeletonAndWeights && checks.animationClips && checks.embeddedPbrMaps,
      bones: loaded.bones,
      meshes: loaded.meshes,
      skinnedMeshes: loaded.skinnedMeshes,
      skins: loaded.skins,
      materials: loaded.materials,
      textures: loaded.loadedTextures,
      triangles: loaded.triangles,
      vertices: loaded.vertices,
      animationValidation: loaded.animations,
    },
    sourcePreviewValidation: sourceValidation,
    previewRegression: {
      passed: checks.allPreviewControls && checks.oneShotReturnsToIdle && checks.noPageErrors,
      animationControls: controls,
      controlResults,
      oneShotReturnWallMilliseconds,
      pageErrors,
      renderer,
    },
    mobilePreview: { ...mobileMetrics, evidence: 'evidence/preview-mobile-390.png' },
    finalCaptureSamples: captures,
    checks,
    limitations: [
      'Polished procedural stylization; not a photorealistic scanned or externally generated character.',
      'No external generation service or API credential was used.',
      'The GLB is below 4 MB but contains 69,486 triangles, slightly above the approximately 65,000-triangle recommendation to preserve anatomical detail and the death-scatter bone groups.',
      'Gameplay rules, shared character registration, asynchronous runtime loading and production CharacterRig integration are intentionally excluded.',
    ],
  };
  delete validation.model.animations;
  fs.writeFileSync(path.join(evidenceDirectory, 'validation.json'), `${JSON.stringify(validation, null, 2)}\n`);
  console.log(JSON.stringify({ asset: validation.asset, checks, loaded: { bones: loaded.bones, triangles: loaded.triangles, textures: loaded.loadedTextures }, reverse: loaded.reverse, ground: loaded.ground, pageErrors, stats, textureCount }, null, 2));
  if (Object.entries(checks).some(([name, passed]) => !passed && name !== 'triangleTarget65k')) process.exitCode = 1;
} finally {
  await browser.close();
}
