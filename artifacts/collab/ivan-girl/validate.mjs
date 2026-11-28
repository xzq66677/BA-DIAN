import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const modelFile = path.join(here, 'model', 'ivan-girl.glb');
const evidenceDirectory = path.join(here, 'evidence');
const previewUrl = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5211/';
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
  await page.waitForFunction(() => window.__ivanGirl?.ready, null, { timeout: 90000 });
  const sourceStats = await page.evaluate(() => window.__ivanGirl.stats);
  const rendererBeforeReload = await page.evaluate(() => window.__ivanGirl.getState().renderer);

  const loaded = await page.evaluate(async base64 => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const gltf = await window.__ivanGirl.reloadGlb(bytes.buffer);
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
      position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone(),
    }]));
    const animationMixer = window.__ivanGirl.createMixer(gltf.scene);
    const actions = new Map(gltf.animations.map(clip => [clip.name, animationMixer.clipAction(clip)]));
    const reset = () => {
      animationMixer.stopAllAction();
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
      animationMixer.update(0);
      action.paused = true;
      gltf.scene.updateMatrixWorld(true);
    };
    const bounds = () => window.__ivanGirl.measureSkinnedBounds(gltf.scene);
    const bone = name => bones.find(item => item.name === name);
    const sampleBones = () => bones.map(item => ({
      name: item.name, position: item.position.toArray(), quaternion: item.quaternion.toArray(), scale: item.scale.toArray(),
    }));
    const gripDistance = side => {
      const hand = bone(`Hand${side}`);
      const held = bone('HeldBomb');
      return hand.getWorldPosition(new held.position.constructor()).distanceTo(held.localToWorld(new held.position.constructor(side === 'L' ? -.132 : .132, -.025, .035)));
    };

    reset();
    const restBounds = bounds();
    const projectileRestScale = bone('ThrownBomb').scale.x;
    seek('throw', .88);
    const throwGrip = { left: gripDistance('L'), right: gripDistance('R'), heldScale: bone('HeldBomb').scale.x };
    seek('throw', 1.45);
    const projectile = { scale: bone('ThrownBomb').scale.x, position: bone('ThrownBomb').position.toArray(), sparkScale: bone('FuseSpark').scale.x };
    seek('throw', 1.30);
    const released = { heldScale: bone('HeldBomb').scale.x, thrownScale: bone('ThrownBomb').scale.x };
    seek('victory', 1.30);
    const victory = { bombHeight: bone('HeldBomb').getWorldPosition(bone('HeldBomb').position.clone()).y, leftGrip: gripDistance('L'), rightGrip: gripDistance('R') };

    let maxPositionError = 0;
    let maxQuaternionError = 0;
    let maxScaleError = 0;
    for (let index = 0; index <= 140; index++) {
      const time = index / 140 * 1.25;
      seek('dead', time);
      const dead = sampleBones();
      seek('reviveRise', 1.25 - time);
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
      for (let index = 0; index <= 50; index++) {
        seek(name, index / 50 * 1.25);
        minY = Math.min(minY, bounds().min[1]);
      }
      ground[name] = { sampleCount: 51, minY, maxPenetrationMeters: Math.max(0, -minY) };
    }
    seek('dead', 1.25);
    const deadBounds = bounds();
    seek('reviveRise', 1.25);
    const revivedBounds = bounds();

    seek('idle', 1.52);
    const blinkClosed = { left: bone('EyelidL').scale.y, right: bone('EyelidR').scale.y };
    seek('idle', 1.43);
    const blinkOpen = { left: bone('EyelidL').scale.y, right: bone('EyelidR').scale.y };
    const animations = gltf.animations.map(clip => ({
      name: clip.name,
      duration: clip.duration,
      tracks: clip.tracks.length,
      secondaryBoneTracks: clip.tracks.filter(track => /^(Pigtail[LR][123]|Eyelid[LR]|Eye[LR]|Mouth)\./.test(track.name)).map(track => track.name),
      finite: clip.tracks.every(track => [...track.times, ...track.values].every(Number.isFinite)),
      targetsExist: clip.tracks.every(track => gltf.scene.getObjectByName(track.name.split('.')[0])),
      maxQuaternionNormalizationError: Math.max(0, ...clip.tracks.filter(track => track.name.endsWith('.quaternion')).flatMap(track => {
        const errors = [];
        for (let index = 0; index < track.values.length; index += 4) errors.push(Math.abs(Math.hypot(...track.values.slice(index, index + 4)) - 1));
        return errors;
      })),
    }));
    let horizontalRootMotion = 0;
    for (const clip of gltf.animations) for (const track of clip.tracks) {
      if (track.name !== 'Root.position') continue;
      for (let index = 0; index < track.values.length; index += 3) horizontalRootMotion = Math.max(horizontalRootMotion, Math.abs(track.values[index]), Math.abs(track.values[index + 2]));
    }
    return {
      bones: bones.length, meshes: meshes.length, skinnedMeshes: meshes.filter(mesh => mesh.isSkinnedMesh).length,
      skins: skins.size, jointsPerSkin: [...skins].map(skeleton => skeleton.bones.length),
      triangles, vertices, materials: materials.size, pbrMaterials, loadedTextures: textures.size,
      embeddedImageDimensions: Object.fromEntries(images), maxSkinIndex, minWeightSum: minWeight, maxWeightSum: maxWeight,
      invalidWeights, animations, blinkClosed, blinkOpen, horizontalRootMotion, restBounds, projectileRestScale, throwGrip, projectile, released, victory,
      reverse: { sampleCount: 141, maxPositionError, maxQuaternionError, maxScaleError },
      ground, deadBounds, revivedBounds,
    };
  }, buffer.toString('base64'));

  const rendererAfterReload = await page.evaluate(async base64 => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const gltf = await window.__ivanGirl.reloadGlb(bytes.buffer);
    return window.__ivanGirl.measureReloadRenderer(gltf);
  }, buffer.toString('base64'));

  const controls = await page.locator('[data-clip]').evaluateAll(buttons => buttons.map(button => button.dataset.clip));
  const controlResults = {};
  for (const name of controls) {
    controlResults[name] = await page.evaluate(clip => {
      document.querySelector(`[data-clip="${clip}"]`).click();
      return window.__ivanGirl.getState().current;
    }, name);
  }
  const oneShotReturnWallMilliseconds = {};
  for (const name of ['throw', 'victory', 'flinch']) {
    const started = Date.now();
    await page.locator(`[data-clip="${name}"]`).click();
    await page.waitForFunction(() => window.__ivanGirl.getState().current === 'idle', null, { timeout: 30000 });
    oneShotReturnWallMilliseconds[name] = Date.now() - started;
  }

  const captures = [];
  const capture = async (file, clip, time, view = 'front', stageOnly = false) => {
    await page.evaluate(({ clip, time, view }) => { window.__ivanGirl.setView(view); window.__ivanGirl.seek(clip, time); }, { clip, time, view });
    await page.screenshot({ path: path.join(evidenceDirectory, file), fullPage: !stageOnly });
    captures.push({ file: `evidence/${file}`, clip, time, view });
  };
  await capture('preview-idle.png', 'idle', 1.60);
  await capture('preview-face.png', 'idle', .55, 'face', true);
  await capture('preview-hair.png', 'idle', 1.60, 'hair', true);
  await capture('preview-blink.png', 'idle', 1.52, 'face', true);
  await capture('preview-throw-windup.png', 'throw', .88);
  await capture('preview-throw-projectile.png', 'throw', 1.40, 'projectile');
  await capture('preview-flinch.png', 'flinch', .16);
  await capture('preview-victory.png', 'victory', 1.30);
  await capture('preview-walk-side.png', 'walk', .60, 'side');
  await capture('preview-throw-side.png', 'throw', 1.10, 'side');
  await capture('preview-dead-ground.png', 'dead', 1.25, 'side');
  await capture('preview-revive.png', 'reviveRise', .45, 'side');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  mobile.on('pageerror', error => pageErrors.push(`mobile: ${error.message}`));
  await mobile.goto(previewUrl, { waitUntil: 'networkidle' });
  await mobile.waitForFunction(() => window.__ivanGirl?.ready, null, { timeout: 90000 });
  await mobile.evaluate(() => window.__ivanGirl.seek('idle', 1.6));
  await mobile.screenshot({ path: path.join(evidenceDirectory, 'preview-mobile-390.png'), fullPage: true });
  const mobileMetrics = await mobile.evaluate(() => {
    const canvas = document.querySelector('#stage canvas');
    return {
      viewportWidth: innerWidth, viewportHeight: innerHeight, documentScrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      canvasCssSize: [canvas.clientWidth, canvas.clientHeight], animationButtons: document.querySelectorAll('[data-clip]').length,
    };
  });
  await mobile.close();
  captures.push({ file: 'evidence/preview-mobile-390.png', viewport: '390x844' });

  const externalResources = json.buffers.some(item => item.uri) || json.images.some(item => item.uri);
  const checks = {
    glbHeader: header.magic === 'glTF' && header.version === 2 && header.declaredLength === header.fileLength,
    embeddedResources: !externalResources && json.images.length > 0,
    skeletonAndWeights: loaded.bones === sourceStats.bones && loaded.skinnedMeshes === loaded.meshes && loaded.skins > 0 && loaded.invalidWeights === 0 && loaded.maxSkinIndex < loaded.jointsPerSkin[0],
    animationClips: loaded.animations.length === 7 && loaded.animations.every(clip => clip.finite && clip.targetsExist && clip.maxQuaternionNormalizationError < .0001),
    embeddedPbrMaps: loaded.pbrMaterials.length === 12 && loaded.loadedTextures === 48,
    refinedHairAndSkinning: sourceStats.hairLocks >= 150 && sourceStats.blendedVertices >= 3000,
    facialBlink: loaded.blinkClosed.left < .1 && loaded.blinkClosed.right < .1 && loaded.blinkOpen.left > .99 && loaded.blinkOpen.right > .99,
    secondaryHairMotion: ['idle', 'walk', 'throw', 'flinch', 'victory', 'dead', 'reviveRise'].every(name => {
      const clip = loaded.animations.find(item => item.name === name);
      return ['PigtailL1', 'PigtailL2', 'PigtailL3', 'PigtailR1', 'PigtailR2', 'PigtailR3'].every(bone => clip.secondaryBoneTracks.includes(`${bone}.quaternion`));
    }),
    groundedFeet: Math.abs(loaded.restBounds.min[1]) < .0001,
    deathGroundContact: loaded.ground.dead.maxPenetrationMeters < .0001 && loaded.ground.reviveRise.maxPenetrationMeters < .0001,
    reverseAnimation: loaded.reverse.maxPositionError < .000001 && loaded.reverse.maxQuaternionError < .000001 && loaded.reverse.maxScaleError < .000001,
    restoredBounds: loaded.restBounds.size.every((value, axis) => Math.abs(value - loaded.revivedBounds.size[axis]) < .000001),
    throwGripContact: loaded.throwGrip.left < .005 && loaded.throwGrip.right < .005 && loaded.throwGrip.heldScale === 1,
    bombRelease: loaded.released.heldScale < .001 && loaded.released.thrownScale === 1,
    projectileFlight: loaded.projectile.scale === 1 && loaded.projectile.position[2] > 1 && loaded.projectile.sparkScale > 0,
    victoryGripContact: loaded.victory.leftGrip < .005 && loaded.victory.rightGrip < .005 && loaded.victory.bombHeight > 1.35,
    hiddenProjectileAtRest: loaded.projectileRestScale < .001,
    noHorizontalRootMotion: loaded.horizontalRootMotion === 0,
    allPreviewControls: controls.length === 7 && Object.entries(controlResults).every(([name, current]) => name === current),
    oneShotReturnsToIdle: Object.values(oneShotReturnWallMilliseconds).every(value => value > 500 && value < 30000),
    mobileNoHorizontalOverflow: !mobileMetrics.horizontalOverflow && mobileMetrics.animationButtons === 7,
    noPageErrors: pageErrors.length === 0,
    glbSizeTarget4Mb: buffer.length < 4 * 1024 * 1024,
    triangleTarget65k: loaded.triangles <= 65000,
    modelDrawCallTarget20: loaded.meshes <= 20,
  };

  const validation = {
    schemaVersion: 1,
    generatedOn: new Date().toISOString(),
    scope: 'visual-assets-only',
    provider: { name: 'local-procedural', tripoCredentials: 'MISSING', externalGenerationUsed: false },
    asset: {
      file: 'model/ivan-girl.glb', bytes: buffer.length, megabytes: buffer.length / 1000000, mebibytes: buffer.length / 1048576,
      sha256, ...header, declaredLengthMatchesFileLength: header.declaredLength === header.fileLength,
      externalResources, embeddedImages: json.images.length,
    },
    sourceStats,
    model: {
      heightMeters: loaded.restBounds.size[1], widthMeters: loaded.restBounds.size[0], depthMeters: loaded.restBounds.size[2],
      restBounds: loaded.restBounds, upAxis: '+Y', forwardAxis: '+Z', footY: loaded.restBounds.min[1],
      horizontalRootMotion: loaded.horizontalRootMotion, bones: loaded.bones, meshes: loaded.meshes,
      skinnedMeshes: loaded.skinnedMeshes, skins: loaded.skins, jointsPerSkin: loaded.jointsPerSkin,
      triangles: loaded.triangles, vertices: loaded.vertices, materials: loaded.materials, pbrMaterials: loaded.pbrMaterials,
      loadedTextures: loaded.loadedTextures, embeddedImageDimensions: loaded.embeddedImageDimensions,
      maxSkinIndex: loaded.maxSkinIndex, minWeightSum: loaded.minWeightSum, maxWeightSum: loaded.maxWeightSum,
      invalidWeights: loaded.invalidWeights, modelDrawCalls: loaded.meshes,
    },
    animations: Object.fromEntries(loaded.animations.map(clip => [clip.name, { duration: clip.duration, tracks: clip.tracks }])),
    animationEvidence: { throwGrip: loaded.throwGrip, released: loaded.released, projectile: loaded.projectile, victory: loaded.victory, blinkClosed: loaded.blinkClosed, blinkOpen: loaded.blinkOpen, reverse: loaded.reverse, ground: loaded.ground, deadBounds: loaded.deadBounds, revivedBounds: loaded.revivedBounds },
    rendererDiagnostics: { beforeReload: rendererBeforeReload, afterReload: rendererAfterReload },
    previewRegression: { passed: checks.allPreviewControls && checks.oneShotReturnsToIdle && checks.noPageErrors, animationControls: controls, controlResults, oneShotReturnWallMilliseconds, pageErrors },
    mobilePreview: { ...mobileMetrics, evidence: 'evidence/preview-mobile-390.png' },
    finalCaptureSamples: captures,
    checks,
    limitations: [
      'Polished procedural stylization; not a photorealistic scanned or externally generated character.',
      'Tripo credentials were missing; no external generation service or paid task was used.',
      'The bomb projectile is visual only; explosion, damage, authoritative hit timing and gameplay rules remain scene/server responsibilities.',
      'Gameplay registration, asynchronous runtime loading and production CharacterRig integration are intentionally excluded.',
    ],
  };
  fs.writeFileSync(path.join(evidenceDirectory, 'validation.json'), `${JSON.stringify(validation, null, 2)}\n`);
  console.log(JSON.stringify({ asset: validation.asset, checks, model: validation.model, animationEvidence: validation.animationEvidence, rendererDiagnostics: validation.rendererDiagnostics, pageErrors }, null, 2));
  if (Object.values(checks).some(passed => !passed)) process.exitCode = 1;
} finally {
  await browser.close();
}
