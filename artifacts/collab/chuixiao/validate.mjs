import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const modelFile = path.join(here, 'model', 'chuixiao.glb');
const evidenceDirectory = path.join(here, 'evidence');
const previewUrl = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5208/';
const expectedClips = [
  ['idle', 4],
  ['walk', 1.2],
  ['cast', 3],
  ['attack', 2.4],
  ['flinch', .75],
  ['cheer', 2.4],
  ['dead', 1.5],
  ['reviveRise', 1.5],
];
const expectedTexturedPbrMaterials = 12;
const requiredApi = [
  'reloadGlb', 'createMixer', 'play', 'seek', 'capture', 'validate',
  'exportGlb', 'resetCamera', 'setView', 'getState',
];
const checkNames = [
  'glbHeader',
  'embeddedResources',
  'skeletonAndWeights',
  'animationClips',
  'embeddedPbrMaps',
  'groundedFeet',
  'regularClipGroundContact',
  'deathGroundContact',
  'reverseAnimation141Points',
  'reviveRestoresBoundary',
  'attackNoteVisible',
  'castSoundRingVisible',
  'hiddenEffectsAtRest',
  'walkHasNoHorizontalRootDisplacement',
  'allPreviewControls',
  'oneShotReturnsToIdle',
  'deadKeepsTerminalPose',
  'mobileNoHorizontalOverflow',
  'noPageErrors',
  'glbSizeUnder4MiB',
  'triangleTarget65k',
  'sourceStatsContract',
  'previewApiContract',
  'validationEndpointWritable',
  'fatalError',
];
const checks = Object.fromEntries(checkNames.map((name) => [name, false]));
const captures = [];
const pageErrors = [];
const report = {
  schemaVersion: 2,
  generatedOn: new Date().toISOString(),
  scope: 'visual-assets-only',
  previewUrl,
  asset: { file: 'model/chuixiao.glb' },
  model: {},
  animations: {},
  gltfLoaderReload: {},
  sourcePreviewValidation: {},
  previewRegression: {},
  mobilePreview: {},
  finalCaptureSamples: captures,
  checks,
  limitations: [
    '该报告只验证吹箫哥视觉资产、动画、预览交互与 GLB 结构，不覆盖游戏规则或生产角色注册。',
    'idle、walk、flinch、dead 与 reviveRise 的 Root.position 轨道用于垂直贴地修正；行走检查只约束水平根位移。',
    '截图与数值采样不能替代人工对造型、节奏和美术质量的评审。',
  ],
};

fs.mkdirSync(evidenceDirectory, { recursive: true });
let browser;
let buffer;

function parseGlb(bytes) {
  if (!bytes || bytes.length < 20) throw new Error('GLB is missing or shorter than its 20-byte header');
  const header = {
    magic: bytes.toString('ascii', 0, 4),
    version: bytes.readUInt32LE(4),
    declaredLength: bytes.readUInt32LE(8),
    fileLength: bytes.length,
  };
  const jsonLength = bytes.readUInt32LE(12);
  const jsonChunkType = bytes.readUInt32LE(16);
  if (20 + jsonLength > bytes.length) throw new Error('GLB JSON chunk exceeds file length');
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trim());
  let offset = 20 + jsonLength;
  const chunks = [];
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error('Truncated GLB chunk header');
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + length > bytes.length) throw new Error('Truncated GLB chunk payload');
    chunks.push({ type, length });
    offset += 8 + length;
  }
  return { header, json, jsonLength, jsonChunkType, chunks };
}

function near(actual, expected, tolerance = .002) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

function writeLocalReport() {
  fs.writeFileSync(path.join(evidenceDirectory, 'validation.json'), `${JSON.stringify(report, null, 2)}\n`);
}

try {
  buffer = fs.readFileSync(modelFile);
  const parsed = parseGlb(buffer);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const externalBuffers = (parsed.json.buffers ?? []).filter((item) => item.uri);
  const externalImages = (parsed.json.images ?? []).filter((item) => item.uri);
  const externalResources = externalBuffers.length > 0 || externalImages.length > 0;
  Object.assign(report.asset, {
    bytes: buffer.length,
    megabytes: buffer.length / 1000000,
    mebibytes: buffer.length / 1048576,
    sha256,
    ...parsed.header,
    jsonBytes: parsed.jsonLength,
    jsonChunkType: parsed.jsonChunkType.toString(16),
    chunks: parsed.chunks,
    externalResources,
    embeddedImages: parsed.json.images?.length ?? 0,
  });
  checks.glbHeader = parsed.header.magic === 'glTF'
    && parsed.header.version === 2
    && parsed.header.declaredLength === parsed.header.fileLength
    && parsed.jsonChunkType === 0x4e4f534a;
  checks.embeddedResources = !externalResources
    && (parsed.json.images?.length ?? 0) > 0
    && (parsed.json.buffers ?? []).some((item) => !item.uri && item.byteLength > 0)
    && parsed.json.images.every((image) => Number.isInteger(image.bufferView));
  checks.glbSizeUnder4MiB = buffer.length < 4 * 1024 * 1024;

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (error) => pageErrors.push(`desktop: ${error.message}`));
  await page.goto(previewUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__chuixiao?.ready === true, null, { timeout: 30000 });

  const loaded = await page.evaluate(async (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const gltf = await window.__chuixiao.reloadGlb(bytes.buffer);
    const meshes = [];
    const bones = [];
    const materials = new Set();
    const textures = new Set();
    const skins = new Set();
    const imageDimensions = new Map();
    let triangles = 0;
    let vertices = 0;
    let invalidWeights = 0;
    let invalidSkinIndices = 0;
    let invalidTopology = 0;
    let minWeight = Infinity;
    let maxWeight = -Infinity;
    let maxSkinIndex = -1;

    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((object) => {
      if (object.isBone) bones.push(object);
      if (!object.isMesh) return;
      meshes.push(object);
      const geometry = object.geometry;
      const position = geometry.attributes.position;
      if (!position) return;
      const primitiveCount = geometry.index?.count ?? position.count;
      triangles += primitiveCount / 3;
      vertices += position.count;
      if (primitiveCount % 3 !== 0) invalidTopology++;
      if (object.isSkinnedMesh) {
        skins.add(object.skeleton);
        const skinIndex = geometry.attributes.skinIndex;
        const skinWeight = geometry.attributes.skinWeight;
        if (!skinIndex || !skinWeight || skinIndex.count !== position.count || skinWeight.count !== position.count) {
          invalidWeights += position.count;
          return;
        }
        for (let index = 0; index < position.count; index++) {
          const weights = ['X', 'Y', 'Z', 'W'].map((axis) => skinWeight[`get${axis}`](index));
          const indices = ['X', 'Y', 'Z', 'W'].map((axis) => skinIndex[`get${axis}`](index));
          const sum = weights.reduce((total, value) => total + value, 0);
          minWeight = Math.min(minWeight, sum);
          maxWeight = Math.max(maxWeight, sum);
          if (!weights.every(Number.isFinite) || !indices.every(Number.isInteger)
            || Math.abs(sum - 1) > .0001 || indices.some((value) => value < 0 || value >= object.skeleton.bones.length)) {
            invalidWeights++;
          }
          maxSkinIndex = Math.max(maxSkinIndex, ...indices);
          if (indices.some((value) => value >= object.skeleton.bones.length)) invalidSkinIndices++;
        }
      }
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const [slot, value] of Object.entries(material)) {
          if (!value?.isTexture) continue;
          textures.add(value);
          const image = value.image;
          if (!image) continue;
          const dimensions = `${slot}:${image.width || image.videoWidth || 0}x${image.height || image.videoHeight || 0}`;
          imageDimensions.set(dimensions, (imageDimensions.get(dimensions) ?? 0) + 1);
        }
      }
    });

    const materialList = [...materials];
    const standardMaterials = materialList.filter((material) => material.isMeshStandardMaterial);
    const pbrMaterials = standardMaterials
      .filter((material) => material.map && material.roughnessMap && material.metalnessMap && material.normalMap)
      .map((material) => material.name || '(unnamed PBR material)');
    const animations = gltf.animations.map((clip) => {
      let maxQuaternionNormalizationError = 0;
      let quaternionSamples = 0;
      for (const track of clip.tracks) {
        if (!track.name.endsWith('.quaternion')) continue;
        for (let index = 0; index + 3 < track.values.length; index += 4) {
          const length = Math.hypot(...track.values.slice(index, index + 4));
          maxQuaternionNormalizationError = Math.max(maxQuaternionNormalizationError, Math.abs(length - 1));
          quaternionSamples++;
        }
      }
      return {
        name: clip.name,
        duration: clip.duration,
        tracks: clip.tracks.length,
        finite: clip.tracks.length > 0 && clip.tracks.every((track) =>
          track.times.length > 0 && track.values.length > 0
          && [...track.times, ...track.values].every(Number.isFinite)),
        orderedTimes: clip.tracks.every((track) => track.times.every((time, index, times) =>
          Number.isFinite(time) && time >= 0 && time <= clip.duration + .0001 && (index === 0 || time >= times[index - 1]))),
        targetsExist: clip.tracks.every((track) => {
          const separator = track.name.lastIndexOf('.');
          return separator > 0 && gltf.scene.getObjectByName(track.name.slice(0, separator));
        }),
        validBindings: clip.tracks.every((track) =>
          /\.(position|quaternion|scale|morphTargetInfluences)$/.test(track.name)),
        maxQuaternionNormalizationError: quaternionSamples ? maxQuaternionNormalizationError : null,
        rootTracks: clip.tracks.filter((track) => track.name.startsWith('Root.')).map((track) => track.name),
      };
    });

    const rootNode = gltf.scene.getObjectByName('Root')
      ?? gltf.scene.children.find((object) => object.isObject3D)
      ?? gltf.scene;
    const rest = new Map(bones.map((bone) => [bone.name, {
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
      scale: bone.scale.clone(),
    }]));
    const rootRest = {
      position: rootNode.position.clone(),
      quaternion: rootNode.quaternion.clone(),
      scale: rootNode.scale.clone(),
    };
    const mixer = window.__chuixiao.createMixer(gltf.scene);
    const actions = new Map(gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
    const reset = () => {
      mixer.stopAllAction();
      for (const bone of bones) {
        const pose = rest.get(bone.name);
        bone.position.copy(pose.position);
        bone.quaternion.copy(pose.quaternion);
        bone.scale.copy(pose.scale);
      }
      rootNode.position.copy(rootRest.position);
      rootNode.quaternion.copy(rootRest.quaternion);
      rootNode.scale.copy(rootRest.scale);
      gltf.scene.updateMatrixWorld(true);
    };
    const seek = (name, time) => {
      const action = actions.get(name);
      if (!action) throw new Error(`Reloaded GLB is missing clip ${name}`);
      reset();
      action.reset().play();
      action.time = Math.max(0, Math.min(action.getClip().duration, time));
      mixer.update(0);
      action.paused = true;
      gltf.scene.updateMatrixWorld(true);
    };
    const bounds = () => {
      const Vector3 = gltf.scene.position.constructor;
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      const point = new Vector3();
      const include = (candidate) => {
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], candidate.getComponent(axis));
          max[axis] = Math.max(max[axis], candidate.getComponent(axis));
        }
      };
      for (const mesh of meshes) {
        if (!mesh.geometry.attributes.position) continue;
        if (mesh.isSkinnedMesh) {
          mesh.skeleton.update();
          mesh.computeBoundingBox();
        } else {
          mesh.geometry.computeBoundingBox();
        }
        const source = mesh.isSkinnedMesh ? mesh.boundingBox : mesh.geometry.boundingBox;
        if (!source) continue;
        for (const x of [source.min.x, source.max.x]) {
          for (const y of [source.min.y, source.max.y]) {
            for (const z of [source.min.z, source.max.z]) {
              point.set(x, y, z).applyMatrix4(mesh.matrixWorld);
              include(point);
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
    const effectStates = () => Object.fromEntries([
      'Qi', 'SoundRing0', 'SoundRing1', 'SoundRing2', 'Note0', 'Note1', 'Note2',
    ].map((name) => {
      const bone = bones.find((item) => item.name === name);
      if (!bone) return [name, null];
      const worldScale = bone.getWorldScale(new gltf.scene.position.constructor());
      return [name, {
        scale: bone.scale.toArray(),
        maxScale: Math.max(...bone.scale.toArray().map(Math.abs)),
        position: bone.position.toArray(),
        worldPosition: bone.getWorldPosition(new gltf.scene.position.constructor()).toArray(),
        maxWorldScale: Math.max(...worldScale.toArray().map(Math.abs)),
      }];
    }));

    reset();
    const restBounds = bounds();
    const restPose = sampleBones();
    const hiddenAtRest = effectStates();
    seek('attack', 1.25);
    const attack = effectStates();
    seek('cast', 1.5);
    const cast = effectStates();

    let maxPositionError = 0;
    let maxQuaternionError = 0;
    let maxScaleError = 0;
    for (let index = 0; index <= 140; index++) {
      const time = index / 140 * 1.5;
      seek('dead', time);
      const dead = sampleBones();
      seek('reviveRise', 1.5 - time);
      const revive = sampleBones();
      if (dead.length !== revive.length) throw new Error('Bone count changed between death and revive');
      for (let boneIndex = 0; boneIndex < dead.length; boneIndex++) {
        if (dead[boneIndex].name !== revive[boneIndex].name) throw new Error('Bone order changed between clips');
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
      for (let index = 0; index <= 140; index++) {
        seek(name, index / 140 * 1.5);
        minY = Math.min(minY, bounds().min[1]);
      }
      ground[name] = { sampleCount: 141, minY, maxPenetrationMeters: Math.max(0, -minY) };
    }

    seek('reviveRise', 1.5);
    const revivedBounds = bounds();
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
    for (let index = 0; index <= 120; index++) {
      seek('walk', index / 120 * 1.2);
      walkMinX = Math.min(walkMinX, rootNode.position.x);
      walkMaxX = Math.max(walkMaxX, rootNode.position.x);
      walkMinZ = Math.min(walkMinZ, rootNode.position.z);
      walkMaxZ = Math.max(walkMaxZ, rootNode.position.z);
    }

    const regularGround = {};
    for (const [name, duration, count] of [['idle', 4, 160], ['walk', 1.2, 121], ['flinch', .75, 100]]) {
      let minY = Infinity;
      for (let index = 0; index <= count; index++) {
        seek(name, index / count * duration);
        minY = Math.min(minY, bounds().min[1]);
      }
      regularGround[name] = { sampleCount: count + 1, minY, maxPenetrationMeters: Math.max(0, -minY) };
    }

    return {
      bones: bones.length,
      meshes: meshes.length,
      skinnedMeshes: meshes.filter((mesh) => mesh.isSkinnedMesh).length,
      skins: skins.size,
      jointsPerSkin: [...skins].map((skeleton) => skeleton.bones.length),
      triangles,
      vertices,
      invalidTopology,
      materials: materials.size,
      standardMaterials: standardMaterials.length,
      pbrMaterials,
      loadedTextures: textures.size,
      embeddedImageDimensions: Object.fromEntries(imageDimensions),
      minWeightSum: minWeight,
      maxWeightSum: maxWeight,
      invalidWeights,
      invalidSkinIndices,
      maxSkinIndex,
      animations,
      rootNodeName: rootNode.name,
      rootRestPosition: rootRest.position.toArray(),
      rootTracksByClip: Object.fromEntries(animations.map((clip) => [clip.name, clip.rootTracks])),
      restBounds,
      hiddenAtRest,
      attackNote0: attack.Note0,
      castSoundRing0: cast.SoundRing0,
      reverse: {
        sampleCount: 141,
        maxPositionError,
        maxQuaternionError,
        maxScaleError,
      },
      ground,
      regularGround,
      revivedBounds,
      revivedPoseError,
      walkRoot: {
        sampleCount: 121,
        xRange: walkMaxX - walkMinX,
        zRange: walkMaxZ - walkMinZ,
        maxHorizontalOffset: Math.max(
          Math.abs(walkMinX - rootRest.position.x), Math.abs(walkMaxX - rootRest.position.x),
          Math.abs(walkMinZ - rootRest.position.z), Math.abs(walkMaxZ - rootRest.position.z),
        ),
      },
    };
  }, buffer.toString('base64'));

  report.model = {
    upAxis: '+Y',
    forwardAxis: '+Z',
    heightMeters: loaded.restBounds.size[1],
    widthMeters: loaded.restBounds.size[0],
    depthMeters: loaded.restBounds.size[2],
    footY: loaded.restBounds.min[1],
    ...loaded,
    animations: undefined,
  };
  report.animations = Object.fromEntries(loaded.animations.map((clip) => [clip.name, {
    duration: clip.duration,
    tracks: clip.tracks,
    finite: clip.finite,
    targetsExist: clip.targetsExist,
  }]));
  report.gltfLoaderReload = {
    passed: false,
    bones: loaded.bones,
    meshes: loaded.meshes,
    skinnedMeshes: loaded.skinnedMeshes,
    skins: loaded.skins,
    materials: loaded.materials,
    textures: loaded.loadedTextures,
    triangles: loaded.triangles,
    vertices: loaded.vertices,
    animationValidation: loaded.animations,
  };

  checks.skeletonAndWeights = loaded.bones > 0
    && loaded.skinnedMeshes > 0
    && loaded.skins > 0
    && loaded.jointsPerSkin.every((count) => count > 0)
    && loaded.invalidWeights === 0
    && loaded.invalidSkinIndices === 0
    && loaded.invalidTopology === 0
    && near(loaded.minWeightSum, 1, .0001)
    && near(loaded.maxWeightSum, 1, .0001);
  const actualClipNames = loaded.animations.map((clip) => clip.name).sort();
  const expectedClipNames = expectedClips.map(([name]) => name).sort();
  checks.animationClips = JSON.stringify(actualClipNames) === JSON.stringify(expectedClipNames)
    && loaded.animations.every((clip) => {
      const expected = expectedClips.find(([name]) => name === clip.name)?.[1];
      return near(clip.duration, expected, .0001)
        && clip.finite
        && clip.orderedTimes
        && clip.targetsExist
        && clip.validBindings
        && (clip.maxQuaternionNormalizationError === null || clip.maxQuaternionNormalizationError < .0001);
    });
  checks.embeddedPbrMaps = loaded.pbrMaterials.length === expectedTexturedPbrMaterials
    && loaded.loadedTextures >= expectedTexturedPbrMaterials * 4;
  checks.groundedFeet = near(loaded.restBounds.min[1], 0, .002);
  checks.regularClipGroundContact = Object.values(loaded.regularGround).every((sample) =>
    Number.isFinite(sample.minY) && sample.minY >= -.002);
  checks.deathGroundContact = Number.isFinite(loaded.ground.dead.minY)
    && loaded.ground.dead.minY >= -.002
    && Number.isFinite(loaded.ground.reviveRise.minY)
    && loaded.ground.reviveRise.minY >= -.002;
  checks.reverseAnimation141Points = loaded.reverse.sampleCount === 141
    && loaded.reverse.maxPositionError < .00001
    && loaded.reverse.maxQuaternionError < .00001
    && loaded.reverse.maxScaleError < .00001;
  checks.reviveRestoresBoundary = loaded.revivedPoseError < .00001
    && loaded.restBounds.min.every((value, axis) => near(value, loaded.revivedBounds.min[axis], .002))
    && loaded.restBounds.max.every((value, axis) => near(value, loaded.revivedBounds.max[axis], .002))
    && loaded.restBounds.size.every((value, axis) => near(value, loaded.revivedBounds.size[axis], .002));
  checks.attackNoteVisible = Boolean(loaded.attackNote0)
    && loaded.attackNote0.maxWorldScale > .01
    && loaded.attackNote0.worldPosition[2] > .5;
  checks.castSoundRingVisible = Boolean(loaded.castSoundRing0)
    && loaded.castSoundRing0.maxWorldScale > .01;
  checks.hiddenEffectsAtRest = Object.values(loaded.hiddenAtRest).every((effect) =>
    effect && effect.maxScale < .001);
  checks.walkHasNoHorizontalRootDisplacement = loaded.walkRoot.xRange < .0001
    && loaded.walkRoot.zRange < .0001
    && loaded.walkRoot.maxHorizontalOffset < .0001;
  checks.triangleTarget65k = loaded.triangles <= 65000;
  report.gltfLoaderReload.passed = checks.skeletonAndWeights
    && checks.animationClips
    && checks.embeddedPbrMaps;

  const previewApi = await page.evaluate((required) => ({
    ready: window.__chuixiao?.ready === true,
    functionsPresent: required.every((name) => typeof window.__chuixiao?.[name] === 'function'),
    missing: required.filter((name) => typeof window.__chuixiao?.[name] !== 'function'),
  }), requiredApi);
  const stats = await page.evaluate(() => window.__chuixiao.stats);
  const textureCount = await page.evaluate(() => window.__chuixiao.textureCount);
  const requiredStats = ['meshes', 'materials', 'bones', 'triangles', 'vertices', 'height', 'width', 'depth', 'footY'];
  checks.sourceStatsContract = requiredStats.every((name) => Number.isFinite(stats?.[name]))
    && stats.meshes === loaded.meshes
    && stats.materials === loaded.materials
    && stats.bones === loaded.bones
    && stats.triangles === loaded.triangles
    && stats.vertices === loaded.vertices
    && near(stats.height, loaded.restBounds.size[1], .0001)
    && near(stats.width, loaded.restBounds.size[0], .0001)
    && near(stats.depth, loaded.restBounds.size[2], .0001)
    && near(stats.footY, loaded.restBounds.min[1], .0001)
    && Array.isArray(stats?.clips)
    && stats.clips.length === expectedClipNames.length;
  checks.previewApiContract = previewApi.ready && previewApi.functionsPresent;
  report.sourcePreviewValidation = await page.evaluate(() => window.__chuixiao.validate());
  report.previewRegression = {
    api: previewApi,
    stats,
    textureCount,
    pageErrors,
  };

  const controls = await page.locator('[data-clip]').evaluateAll((buttons) => buttons.map((button) => button.dataset.clip));
  const controlResults = {};
  for (const name of controls) {
    controlResults[name] = await page.evaluate((clip) => {
      document.querySelector(`[data-clip="${clip}"]`).click();
      return window.__chuixiao.getState().current;
    }, name);
  }
  checks.allPreviewControls = controls.length === 8
    && JSON.stringify([...controls].sort()) === JSON.stringify(expectedClipNames)
    && Object.entries(controlResults).every(([name, current]) => name === current);

  const oneShotReturnWallMilliseconds = {};
  let oneShotReturns = true;
  for (const [name, duration] of expectedClips.filter(([clipName]) =>
    ['attack', 'flinch', 'cheer', 'reviveRise'].includes(clipName))) {
    const started = Date.now();
    await page.locator(`[data-clip="${name}"]`).click();
    await page.waitForFunction(() => window.__chuixiao.getState().current === 'idle', null, { timeout: 12000 });
    const elapsed = Date.now() - started;
    oneShotReturnWallMilliseconds[name] = elapsed;
    if (elapsed < duration * 1000 * .7 || elapsed > 12000) oneShotReturns = false;
  }
  checks.oneShotReturnsToIdle = oneShotReturns;

  const deadStarted = Date.now();
  await page.locator('[data-clip="dead"]').click();
  await page.waitForFunction(() => {
    const state = window.__chuixiao.getState();
    return state.current === 'dead' && state.time >= state.duration - .0001;
  }, null, { timeout: 6000 });
  const deadTerminalMilliseconds = Date.now() - deadStarted;
  const deadTerminalState = await page.evaluate(() => window.__chuixiao.getState());
  checks.deadKeepsTerminalPose = deadTerminalMilliseconds >= 1000
    && deadTerminalState.current === 'dead'
    && deadTerminalState.time >= deadTerminalState.duration - .0001;
  report.previewRegression.animationControls = controls;
  report.previewRegression.controlResults = controlResults;
  report.previewRegression.oneShotReturnWallMilliseconds = oneShotReturnWallMilliseconds;
  report.previewRegression.deadTerminalMilliseconds = deadTerminalMilliseconds;
  report.previewRegression.deadTerminalState = {
    current: deadTerminalState.current,
    time: deadTerminalState.time,
    duration: deadTerminalState.duration,
    running: deadTerminalState.running,
  };

  const capture = async (file, clip, time, view = 'front', stageOnly = false) => {
    await page.evaluate(async ({ clip: clipName, time: sampleTime, view: viewName }) => {
      window.__chuixiao.setView(viewName);
      window.__chuixiao.seek(clipName, sampleTime);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, { clip, time, view });
    if (stageOnly) {
      await page.locator('#stage').screenshot({ path: path.join(evidenceDirectory, file) });
    } else {
      await page.screenshot({
        path: path.join(evidenceDirectory, file),
        fullPage: true,
      });
    }
    captures.push({ file: `evidence/${file}`, clip, time, view, stageOnly });
  };
  await capture('preview-idle.png', 'idle', 1.6);
  await capture('preview-face.png', 'idle', .55, 'face', true);
  await capture('preview-walk.png', 'walk', .6);
  await capture('preview-cast.png', 'cast', 1.5);
  await capture('preview-attack.png', 'attack', 1.25);
  await capture('preview-flinch.png', 'flinch', .3);
  await capture('preview-cheer.png', 'cheer', 1.2);
  await capture('preview-dead.png', 'dead', 1.5);
  await capture('preview-revive.png', 'reviveRise', .75);

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  mobile.on('pageerror', (error) => pageErrors.push(`mobile: ${error.message}`));
  await mobile.goto(previewUrl, { waitUntil: 'networkidle' });
  await mobile.waitForFunction(() => window.__chuixiao?.ready === true, null, { timeout: 30000 });
  await mobile.evaluate(async () => {
    window.__chuixiao.seek('idle', 1.6);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await mobile.screenshot({
    path: path.join(evidenceDirectory, 'preview-mobile-390.png'),
    fullPage: true,
  });
  captures.push({ file: 'evidence/preview-mobile-390.png', viewport: '390x844' });
  const mobileMetrics = await mobile.evaluate(() => {
    const canvas = document.querySelector('#stage canvas');
    return {
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth
        || document.body.scrollWidth > innerWidth,
      canvasCssSize: [canvas?.clientWidth ?? 0, canvas?.clientHeight ?? 0],
      animationButtons: document.querySelectorAll('[data-clip]').length,
    };
  });
  await mobile.close();
  report.mobilePreview = {
    ...mobileMetrics,
    evidence: 'evidence/preview-mobile-390.png',
  };
  checks.mobileNoHorizontalOverflow = !mobileMetrics.horizontalOverflow
    && mobileMetrics.animationButtons === 8
    && mobileMetrics.canvasCssSize[0] > 0
    && mobileMetrics.canvasCssSize[1] > 0;
  checks.noPageErrors = pageErrors.length === 0;
  report.previewRegression.pageErrors = pageErrors;
  report.previewRegression.renderer = await page.evaluate(() => window.__chuixiao.getState().renderer);
  checks.fatalError = true;
} catch (error) {
  report.fatalError = error instanceof Error ? error.message : String(error);
  checks.fatalError = false;
  console.error(error);
}

try {
  const response = await fetch(new URL('/__validation', previewUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
  let endpointResult;
  try {
    endpointResult = await response.json();
  } catch {
    endpointResult = { status: response.status };
  }
  report.endpoints = { validation: { ok: response.ok, ...endpointResult } };
  checks.validationEndpointWritable = response.ok;
} catch (error) {
  report.endpoints = {
    validation: { ok: false, error: error instanceof Error ? error.message : String(error) },
  };
  checks.validationEndpointWritable = false;
}

writeLocalReport();
const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
console.log(JSON.stringify({
  asset: report.asset,
  loaded: report.gltfLoaderReload,
  checks,
  failedChecks,
  pageErrors,
  fatalError: report.fatalError ?? null,
  report: 'evidence/validation.json',
}, null, 2));
if (failedChecks.length > 0) process.exitCode = 1;

await browser?.close();
