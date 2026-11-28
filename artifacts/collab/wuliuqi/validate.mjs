import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const modelFile = path.join(here, 'model', 'wuliuqi.glb');
const evidenceDirectory = path.join(here, 'evidence');
const previewUrl = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5209/';
const expectedClips = [
  ['idle', 4], ['walk', 1.2], ['cast', 3], ['attack', 2.4],
  ['flinch', .75], ['cheer', 2.4], ['dead', 1.5], ['reviveRise', 1.5],
];
const expectedClipNames = expectedClips.map(([name]) => name).sort();
const effectNames = ['CutRing', 'Slash0', 'Slash1', 'Slash2'];
const expectedTexturedMaterials = 12;
const expectedUntexturedMaterials = 4;
const expectedTextures = 48;
const requiredApi = [
  'ready', 'stats', 'textureCount', 'reloadGlb', 'createMixer', 'play', 'seek', 'capture',
  'validate', 'exportGlb', 'resetCamera', 'setView', 'getState',
];
const checkNames = [
  'glbHeaderAndChunks', 'embeddedResources', 'skeletonAndNormalizedWeights',
  'animationClips', 'pbrMaterialMaps', 'loadedTextureObjects', 'groundedRestFeet',
  'denseRegularGroundContact', 'deathGroundContact141Points', 'reverseAnimation141Points',
  'reviveRestoresRest', 'attackSlash0VisibleAndForward', 'castCutRingVisible',
  'effectsHiddenAtRest', 'walkHasNoHorizontalRootDisplacement', 'allEightAnimationButtons',
  'oneShotReturnsToIdle', 'deadKeepsTerminalPose', 'mobile390NoHorizontalOverflow',
  'noPageErrors', 'glbUnder4MiB', 'trianglesAtMost65000', 'sourceStatsMatchReload',
  'previewApiContract', 'validationEndpointWritable', 'fatalError',
];
const checks = Object.fromEntries(checkNames.map((name) => [name, false]));
const captures = [];
const pageErrors = [];
const report = {
  schemaVersion: 2,
  generatedOn: new Date().toISOString(),
  scope: 'visual-assets-only',
  previewUrl,
  asset: { file: 'model/wuliuqi.glb' },
  model: {},
  animations: {},
  gltfLoaderReload: {},
  sourcePreviewValidation: {},
  previewRegression: {},
  mobilePreview: {},
  finalCaptureSamples: captures,
  checks,
  failedChecks: [],
  limitations: [
    '该报告只验证伍六七视觉资产、动画、预览交互与 GLB 结构，不覆盖游戏规则或生产角色注册。',
    '接地采样允许 6mm 数值容差；截图与数值采样不能替代人工造型、节奏和美术质量评审。',
  ],
};

function near(actual, expected, tolerance = .002) {
  return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance;
}
function writeLocalReport() {
  fs.writeFileSync(path.join(evidenceDirectory, 'validation.json'), `${JSON.stringify(report, null, 2)}\n`);
}
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
  if (jsonLength < 2 || 20 + jsonLength > bytes.length) throw new Error('Invalid GLB JSON chunk length');
  if (jsonChunkType !== 0x4e4f534a) throw new Error('First GLB chunk is not JSON');
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trim().replace(/\0+$/, ''));
  let offset = 20 + jsonLength;
  const chunks = [{ type: jsonChunkType, length: jsonLength, offset: 20 }];
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error('Truncated GLB chunk header');
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + length > bytes.length) throw new Error('Truncated GLB chunk payload');
    chunks.push({ type, length, offset: offset + 8 });
    offset += 8 + length;
  }
  if (offset !== bytes.length) throw new Error('GLB chunk lengths do not consume the file');
  return { header, json, jsonLength, jsonChunkType, chunks };
}
function readAccessor(bytes, parsed, accessorIndex) {
  const accessor = parsed.json.accessors?.[accessorIndex];
  if (!accessor || accessor.sparse) throw new Error(`Unsupported or missing accessor ${accessorIndex}`);
  const view = parsed.json.bufferViews?.[accessor.bufferView];
  if (!view) throw new Error(`Missing bufferView for accessor ${accessorIndex}`);
  const bin = parsed.chunks.find((chunk) => chunk.type === 0x004e4942);
  if (!bin) throw new Error('GLB has no BIN chunk');
  const componentSize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type];
  if (!componentSize || !components) throw new Error(`Unknown accessor format ${accessorIndex}`);
  const stride = view.byteStride ?? componentSize * components;
  const base = bin.offset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const values = [];
  for (let index = 0; index < accessor.count; index++) {
    for (let component = 0; component < components; component++) {
      const offset = base + index * stride + component * componentSize;
      if (offset < bin.offset || offset + componentSize > bin.offset + bin.length) throw new Error('Accessor exceeds BIN chunk');
      let value;
      if (accessor.componentType === 5126) value = bytes.readFloatLE(offset);
      else if (accessor.componentType === 5125) value = bytes.readUInt32LE(offset);
      else if (accessor.componentType === 5123) value = bytes.readUInt16LE(offset);
      else if (accessor.componentType === 5122) value = bytes.readInt16LE(offset);
      else if (accessor.componentType === 5121) value = bytes.readUInt8(offset);
      else value = bytes.readInt8(offset);
      values.push(value);
    }
  }
  return { values, components, count: accessor.count };
}
function validateRawSkin(bytes, parsed) {
  const issues = [];
  let verticesChecked = 0;
  const skins = parsed.json.skins ?? [];
  for (const skin of skins) {
    const joints = skin.joints ?? [];
    if (!joints.length || joints.some((joint) => !Number.isInteger(joint) || !parsed.json.nodes?.[joint])) {
      issues.push('Skin joint list is empty or references a missing node');
    }
    if (skin.inverseBindMatrices !== undefined) {
      const matrices = readAccessor(bytes, parsed, skin.inverseBindMatrices);
      if (matrices.count !== joints.length || !matrices.values.every(Number.isFinite)) issues.push('Invalid inverse bind matrices');
    }
  }
  for (const mesh of parsed.json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.mode !== undefined && primitive.mode !== 4) issues.push('Non-triangle primitive topology');
      if (primitive.indices !== undefined
        && (!Number.isInteger(primitive.indices) || !readAccessor(bytes, parsed, primitive.indices).values.every(Number.isInteger))) {
        issues.push('Mesh has invalid indices');
      }
      const attributes = primitive.attributes ?? {};
      if (!Number.isInteger(attributes.POSITION)) continue;
      const positions = readAccessor(bytes, parsed, attributes.POSITION);
      if (!positions.values.every(Number.isFinite)) issues.push('Mesh has non-finite positions');
      const skinIndex = parsed.json.meshes.indexOf(mesh);
      const skinnedNode = parsed.json.nodes?.find((node) => node.mesh === skinIndex && Number.isInteger(node.skin));
      if (skinnedNode || Number.isInteger(attributes.JOINTS_0)) {
        if (!Number.isInteger(attributes.JOINTS_0) || !Number.isInteger(attributes.WEIGHTS_0)) {
          issues.push('Skinned primitive lacks JOINTS_0 or WEIGHTS_0');
          continue;
        }
        const nodeSkin = skinnedNode?.skin;
        if (!Number.isInteger(nodeSkin)) {
          issues.push('Skinned primitive node lacks skin reference');
          continue;
        }
        const jointCount = parsed.json.skins?.[nodeSkin]?.joints?.length ?? 0;
        const indices = readAccessor(bytes, parsed, attributes.JOINTS_0);
        const weights = readAccessor(bytes, parsed, attributes.WEIGHTS_0);
        if (indices.count !== positions.count || weights.count !== positions.count) {
          issues.push('Skin attribute vertex counts differ');
          continue;
        }
        verticesChecked += positions.count;
        for (let vertex = 0; vertex < positions.count; vertex++) {
          let sum = 0;
          for (let component = 0; component < 4; component++) {
            const index = vertex * 4 + component;
            if (!Number.isInteger(indices.values[index]) || indices.values[index] < 0 || indices.values[index] >= jointCount) {
              issues.push('Skin index outside joint range');
              break;
            }
            const weight = weights.values[index];
            if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
              issues.push('Skin weight is non-finite or outside [0,1]');
              break;
            }
            sum += weight;
          }
          if (Math.abs(sum - 1) > .0001) issues.push('Skin weights are not normalized');
          if (issues.length > 30) return { passed: false, issues: [...new Set(issues)], verticesChecked };
        }
      }
    }
  }
  return { passed: issues.length === 0 && verticesChecked > 0, issues: [...new Set(issues)], verticesChecked };
}

fs.mkdirSync(evidenceDirectory, { recursive: true });
let browser;
let buffer;
try {
  buffer = fs.readFileSync(modelFile);
  const parsed = parseGlb(buffer);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const json = parsed.json;
  const externalBuffers = (json.buffers ?? []).filter((item) => item.uri);
  const externalImages = (json.images ?? []).filter((item) => item.uri);
  const binChunk = parsed.chunks.find((chunk) => chunk.type === 0x004e4942);
  const rawSkin = validateRawSkin(buffer, parsed);
  Object.assign(report.asset, {
    bytes: buffer.length,
    megabytes: buffer.length / 1000000,
    mebibytes: buffer.length / 1048576,
    sha256,
    ...parsed.header,
    jsonBytes: parsed.jsonLength,
    jsonChunkType: parsed.jsonChunkType.toString(16),
    chunks: parsed.chunks,
    externalResources: externalBuffers.length > 0 || externalImages.length > 0,
    embeddedImages: json.images?.length ?? 0,
    rawSkin,
  });
  checks.glbHeaderAndChunks = parsed.header.magic === 'glTF'
    && parsed.header.version === 2
    && parsed.header.declaredLength === parsed.header.fileLength
    && parsed.jsonChunkType === 0x4e4f534a
    && Boolean(binChunk)
    && parsed.chunks[0]?.type === 0x4e4f534a
    && parsed.chunks[1]?.type === 0x004e4942
    && parsed.chunks.length === 2;
  checks.embeddedResources = externalBuffers.length === 0
    && externalImages.length === 0
    && (json.images?.length ?? 0) > 0
    && json.images.every((image) => Number.isInteger(image.bufferView)
      && image.bufferView >= 0 && image.bufferView < (json.bufferViews?.length ?? 0))
    && (json.buffers ?? []).some((item) => !item.uri && item.byteLength > 0)
    && (json.buffers ?? []).every((item) => item.byteLength <= (binChunk?.length ?? 0));
  checks.glbUnder4MiB = buffer.length < 4 * 1024 * 1024;

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => pageErrors.push(`desktop: ${error.message}`));
  await page.goto(previewUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__wuliuqi?.ready === true, null, { timeout: 30000 });

  const loaded = await page.evaluate(async ({ base64, expectedClips: clipContract, effectNames: effects }) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const gltf = await window.__wuliuqi.reloadGlb(bytes.buffer);
    const meshes = [];
    const bones = [];
    const materials = new Set();
    const textures = new Set();
    const skins = new Set();
    const imageDimensions = new Set();
    let triangles = 0;
    let vertices = 0;
    let invalidWeights = 0;
    let invalidSkinIndices = 0;
    let invalidTopology = 0;
    let minWeight = Infinity;
    let maxWeight = -Infinity;

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
          if (!weights.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
            || !indices.every((value) => Number.isInteger(value) && value >= 0 && value < object.skeleton.bones.length)
            || Math.abs(sum - 1) > .0001) invalidWeights++;
          if (indices.some((value) => value >= object.skeleton.bones.length)) invalidSkinIndices++;
        }
      }
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material) continue;
        materials.add(material);
        for (const [slot, value] of Object.entries(material)) {
          if (!value?.isTexture) continue;
          textures.add(value);
          const image = value.image;
          if (image) imageDimensions.add(`${slot}:${image.width || image.videoWidth || 0}x${image.height || image.videoHeight || 0}`);
        }
      }
    });
    const materialList = [...materials];
    const standardMaterials = materialList.filter((material) => material.isMeshStandardMaterial);
    const pbrMaterials = standardMaterials.filter((material) =>
      material.map && material.roughnessMap && material.metalnessMap && material.normalMap);
    const untexturedMaterials = standardMaterials.filter((material) =>
      !Object.values(material).some((value) => value?.isTexture));
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
      const expected = clipContract.find(([name]) => name === clip.name)?.[1];
      return {
        name: clip.name, duration: clip.duration, tracks: clip.tracks.length, expectedDuration: expected,
        finite: clip.tracks.length > 0 && clip.tracks.every((track) =>
          track.times.length > 0 && track.values.length > 0
          && [...track.times, ...track.values].every(Number.isFinite)),
        orderedTimes: clip.tracks.every((track) => track.times.every((time, index, times) =>
          Number.isFinite(time) && time >= 0 && time <= clip.duration + .0001
          && (index === 0 || time >= times[index - 1]))),
        targetsExist: clip.tracks.every((track) => {
          const separator = track.name.lastIndexOf('.');
          return separator > 0 && gltf.scene.getObjectByName(track.name.slice(0, separator));
        }),
        validBindings: clip.tracks.every((track) => /\.(position|quaternion|scale|morphTargetInfluences)$/.test(track.name)),
        maxQuaternionNormalizationError: quaternionSamples ? maxQuaternionNormalizationError : null,
        rootTracks: clip.tracks.filter((track) => track.name.startsWith('Root.')).map((track) => track.name),
      };
    });

    const animatedRootTrack = animations.flatMap((clip) => clip.rootTracks)[0];
    const rootNode = gltf.scene.getObjectByName(animatedRootTrack?.slice(0, animatedRootTrack.lastIndexOf('.')))
      ?? gltf.scene.children.find((object) => object.isObject3D)
      ?? gltf.scene;
    const poseNodes = [];
    gltf.scene.traverse((object) => {
      if (object === gltf.scene) return;
      poseNodes.push(object);
    });
    const rest = new Map(poseNodes.map((node) => [node, {
      position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(),
    }]));
    const rootRest = { position: rootNode.position.clone(), quaternion: rootNode.quaternion.clone(), scale: rootNode.scale.clone() };
    const mixer = window.__wuliuqi.createMixer(gltf.scene);
    const actions = new Map(gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
    const reset = () => {
      mixer.stopAllAction();
      for (const [node, pose] of rest) {
        node.position.copy(pose.position);
        node.quaternion.copy(pose.quaternion);
        node.scale.copy(pose.scale);
      }
      gltf.scene.updateMatrixWorld(true);
    };
    const seek = (name, time) => {
      const action = actions.get(name);
      if (!action) throw new Error(`Reloaded GLB is missing clip ${name}`);
      reset();
      action.reset().play();
      action.clampWhenFinished = true;
      action.time = Math.max(0, Math.min(action.getClip().duration, time));
      mixer.update(0);
      action.paused = true;
      gltf.scene.updateMatrixWorld(true);
    };
    const bounds = () => {
      const Vector3 = gltf.scene.position.constructor;
      const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      const point = new Vector3();
      const include = (candidate) => {
        for (let axis = 0; axis < 3; axis++) {
          box.min[axis] = Math.min(box.min[axis], candidate.getComponent(axis));
          box.max[axis] = Math.max(box.max[axis], candidate.getComponent(axis));
        }
      };
      for (const mesh of meshes) {
        if (!mesh.geometry.attributes.position) continue;
        if (mesh.isSkinnedMesh) {
          mesh.skeleton.update();
          mesh.computeBoundingBox();
        } else mesh.geometry.computeBoundingBox();
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
      return { ...box, size: box.max.map((value, axis) => value - box.min[axis]) };
    };
    const sampleBones = () => bones.map((bone) => ({
      name: bone.name, position: bone.position.toArray(), quaternion: bone.quaternion.toArray(), scale: bone.scale.toArray(),
    }));
    const effectStates = () => Object.fromEntries(effects.map((name) => {
      const bone = bones.find((item) => item.name === name);
      if (!bone) return [name, null];
      const worldScale = bone.getWorldScale(new gltf.scene.position.constructor());
      return [name, {
        scale: bone.scale.toArray(), maxScale: Math.max(...bone.scale.toArray().map(Math.abs)),
        position: bone.position.toArray(), worldPosition: bone.getWorldPosition(new gltf.scene.position.constructor()).toArray(),
        maxWorldScale: Math.max(...worldScale.toArray().map(Math.abs)),
      }];
    }));
    const quaternionError = (left, right) => {
      let direct = 0;
      let equivalent = 0;
      for (let axis = 0; axis < 4; axis++) {
        direct += (left[axis] - right[axis]) ** 2;
        equivalent += (left[axis] + right[axis]) ** 2;
      }
      return Math.sqrt(Math.min(direct, equivalent));
    };

    reset();
    const restBounds = bounds();
    const restPose = sampleBones();
    const hiddenAtRest = effectStates();
    seek('attack', .58);
    const attack = effectStates();
    seek('cast', 1.5);
    const cast = effectStates();
    const reverse = { sampleCount: 141, maxPositionError: 0, maxQuaternionError: 0, maxScaleError: 0 };
    for (let index = 0; index <= 140; index++) {
      const time = index / 140 * 1.5;
      seek('dead', time);
      const dead = sampleBones();
      seek('reviveRise', 1.5 - time);
      const revive = sampleBones();
      if (dead.length !== revive.length) throw new Error('Bone count changed between clips');
      for (let boneIndex = 0; boneIndex < dead.length; boneIndex++) {
        if (dead[boneIndex].name !== revive[boneIndex].name) throw new Error('Bone order changed between clips');
        for (let axis = 0; axis < 3; axis++) {
          reverse.maxPositionError = Math.max(reverse.maxPositionError, Math.abs(dead[boneIndex].position[axis] - revive[boneIndex].position[axis]));
          reverse.maxScaleError = Math.max(reverse.maxScaleError, Math.abs(dead[boneIndex].scale[axis] - revive[boneIndex].scale[axis]));
        }
        reverse.maxQuaternionError = Math.max(reverse.maxQuaternionError, quaternionError(dead[boneIndex].quaternion, revive[boneIndex].quaternion));
      }
    }
    const ground = {};
    for (const name of ['dead', 'reviveRise']) {
      let minY = Infinity;
      let closestToGround = Infinity;
      for (let index = 0; index <= 140; index++) {
        seek(name, index / 140 * 1.5);
        const footY = bounds().min[1];
        minY = Math.min(minY, footY);
        closestToGround = Math.min(closestToGround, Math.abs(footY));
      }
      ground[name] = { sampleCount: 141, minY, closestToGround, maxPenetrationMeters: Math.max(0, -minY) };
    }
    const regularGround = {};
    for (const [name, duration, count] of [['idle', 4, 160], ['walk', 1.2, 120], ['flinch', .75, 100]]) {
      let minY = Infinity;
      let closestToGround = Infinity;
      for (let index = 0; index <= count; index++) {
        seek(name, index / count * duration);
        const footY = bounds().min[1];
        minY = Math.min(minY, footY);
        closestToGround = Math.min(closestToGround, Math.abs(footY));
      }
      regularGround[name] = { sampleCount: count + 1, minY, closestToGround, maxPenetrationMeters: Math.max(0, -minY) };
    }
    seek('reviveRise', 1.5);
    const revivedBounds = bounds();
    const revivedPose = sampleBones();
    let revivedPoseError = 0;
    for (let boneIndex = 0; boneIndex < restPose.length; boneIndex++) {
      if (restPose[boneIndex].name !== revivedPose[boneIndex].name) throw new Error('Bone order changed on revival');
      for (let axis = 0; axis < 3; axis++) {
        revivedPoseError = Math.max(
          revivedPoseError,
          Math.abs(restPose[boneIndex].position[axis] - revivedPose[boneIndex].position[axis]),
          Math.abs(restPose[boneIndex].scale[axis] - revivedPose[boneIndex].scale[axis]),
        );
      }
      revivedPoseError = Math.max(revivedPoseError, quaternionError(restPose[boneIndex].quaternion, revivedPose[boneIndex].quaternion));
    }
    const walkRoot = { sampleCount: 121, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (let index = 0; index <= 120; index++) {
      seek('walk', index / 120 * 1.2);
      walkRoot.minX = Math.min(walkRoot.minX, rootNode.position.x);
      walkRoot.maxX = Math.max(walkRoot.maxX, rootNode.position.x);
      walkRoot.minZ = Math.min(walkRoot.minZ, rootNode.position.z);
      walkRoot.maxZ = Math.max(walkRoot.maxZ, rootNode.position.z);
    }
    walkRoot.xRange = walkRoot.maxX - walkRoot.minX;
    walkRoot.zRange = walkRoot.maxZ - walkRoot.minZ;
    walkRoot.maxHorizontalOffset = Math.max(
      Math.abs(walkRoot.minX - rootRest.position.x), Math.abs(walkRoot.maxX - rootRest.position.x),
      Math.abs(walkRoot.minZ - rootRest.position.z), Math.abs(walkRoot.maxZ - rootRest.position.z),
    );
    reset();
    return {
      bones: bones.length, meshes: meshes.length, skinnedMeshes: meshes.filter((mesh) => mesh.isSkinnedMesh).length,
      skins: skins.size, jointsPerSkin: [...skins].map((skeleton) => skeleton.bones.length),
      triangles, vertices, invalidTopology, materials: materials.size,
      standardMaterials: standardMaterials.length,
      pbrMaterials: pbrMaterials.map((material) => material.name || '(unnamed PBR material)'),
      untexturedMaterials: untexturedMaterials.map((material) => material.name || '(unnamed standard material)'),
      loadedTextures: textures.size, embeddedImageDimensions: [...imageDimensions],
      minWeightSum: minWeight, maxWeightSum: maxWeight, invalidWeights, invalidSkinIndices,
      animations, rootNodeName: rootNode.name, rootRestPosition: rootRest.position.toArray(),
      restBounds, hiddenAtRest, attackSlash0: attack.Slash0, castCutRing: cast.CutRing,
      reverse, ground, regularGround, revivedBounds, revivedPoseError, walkRoot,
    };
  }, { base64: buffer.toString('base64'), expectedClips, effectNames });

  report.model = {
    upAxis: '+Y', forwardAxis: '+Z',
    heightMeters: loaded.restBounds.size[1], widthMeters: loaded.restBounds.size[0],
    depthMeters: loaded.restBounds.size[2], footY: loaded.restBounds.min[1],
    ...loaded, animations: undefined,
  };
  report.animations = Object.fromEntries(loaded.animations.map((clip) => [clip.name, {
    duration: clip.duration, tracks: clip.tracks, finite: clip.finite,
    targetsExist: clip.targetsExist, orderedTimes: clip.orderedTimes,
  }]));
  report.gltfLoaderReload = {
    passed: false, bones: loaded.bones, meshes: loaded.meshes, skinnedMeshes: loaded.skinnedMeshes,
    skins: loaded.skins, materials: loaded.materials, textures: loaded.loadedTextures,
    triangles: loaded.triangles, vertices: loaded.vertices, animationValidation: loaded.animations,
  };
  checks.skeletonAndNormalizedWeights = loaded.bones > 0 && loaded.skinnedMeshes > 0 && loaded.skins > 0
    && loaded.jointsPerSkin.every((count) => count > 0) && loaded.invalidWeights === 0
    && loaded.invalidSkinIndices === 0 && loaded.invalidTopology === 0
    && near(loaded.minWeightSum, 1, .0001) && near(loaded.maxWeightSum, 1, .0001)
    && rawSkin.passed;
  const actualClipNames = loaded.animations.map((clip) => clip.name).sort();
  checks.animationClips = JSON.stringify(actualClipNames) === JSON.stringify(expectedClipNames)
    && loaded.animations.every((clip) => near(clip.duration, clip.expectedDuration, .0001)
      && clip.finite && clip.orderedTimes && clip.targetsExist && clip.validBindings
      && (clip.maxQuaternionNormalizationError === null || clip.maxQuaternionNormalizationError < .0001));
  checks.pbrMaterialMaps = loaded.pbrMaterials.length === expectedTexturedMaterials
    && loaded.untexturedMaterials.length === expectedUntexturedMaterials
    && loaded.standardMaterials === loaded.materials
    && loaded.materials === expectedTexturedMaterials + expectedUntexturedMaterials;
  checks.loadedTextureObjects = loaded.loadedTextures === expectedTextures;
  checks.groundedRestFeet = near(loaded.restBounds.min[1], 0, .006);
  checks.denseRegularGroundContact = Object.entries(loaded.regularGround).every(([name, sample]) =>
    name === 'idle' || name === 'walk' || name === 'flinch')
    && Object.values(loaded.regularGround).every((sample) => Number.isFinite(sample.minY)
      && sample.minY >= -.006 && sample.closestToGround <= .012);
  checks.deathGroundContact141Points = ['dead', 'reviveRise'].every((name) =>
    loaded.ground[name]?.sampleCount === 141 && Number.isFinite(loaded.ground[name].minY)
    && loaded.ground[name].minY >= -.006 && loaded.ground[name].closestToGround <= .012);
  checks.reverseAnimation141Points = loaded.reverse.sampleCount === 141
    && loaded.reverse.maxPositionError < .00001 && loaded.reverse.maxQuaternionError < .00001
    && loaded.reverse.maxScaleError < .00001;
  checks.reviveRestoresRest = loaded.revivedPoseError < .00001
    && loaded.restBounds.min.every((value, axis) => near(value, loaded.revivedBounds.min[axis], .002))
    && loaded.restBounds.max.every((value, axis) => near(value, loaded.revivedBounds.max[axis], .002))
    && loaded.restBounds.size.every((value, axis) => near(value, loaded.revivedBounds.size[axis], .002));
  checks.attackSlash0VisibleAndForward = Boolean(loaded.attackSlash0)
    && loaded.attackSlash0.maxWorldScale > .01
    && loaded.hiddenAtRest.Slash0 !== null
    && loaded.attackSlash0.worldPosition[2] > loaded.hiddenAtRest.Slash0.worldPosition[2] + .1;
  checks.castCutRingVisible = Boolean(loaded.castCutRing) && loaded.castCutRing.maxWorldScale > .01;
  checks.effectsHiddenAtRest = Object.keys(loaded.hiddenAtRest).length === effectNames.length
    && Object.values(loaded.hiddenAtRest).every((effect) => effect && effect.maxScale < .001);
  checks.walkHasNoHorizontalRootDisplacement = loaded.walkRoot.xRange < .0001
    && loaded.walkRoot.zRange < .0001 && loaded.walkRoot.maxHorizontalOffset < .0001;
  checks.trianglesAtMost65000 = loaded.triangles <= 65000;
  report.gltfLoaderReload.passed = checks.skeletonAndNormalizedWeights
    && checks.animationClips && checks.pbrMaterialMaps;

  const previewApi = await page.evaluate((required) => ({
    ready: window.__wuliuqi?.ready === true,
    functionsPresent: required.filter((name) => name !== 'ready' && name !== 'stats' && name !== 'textureCount')
      .every((name) => typeof window.__wuliuqi?.[name] === 'function'),
    dataPresent: ['ready', 'stats', 'textureCount'].every((name) => window.__wuliuqi?.[name] !== undefined),
    missing: required.filter((name) => window.__wuliuqi?.[name] === undefined),
  }), requiredApi);
  const stats = await page.evaluate(() => window.__wuliuqi.stats);
  const textureCount = await page.evaluate(() => window.__wuliuqi.textureCount);
  const requiredStats = ['meshes', 'materials', 'bones', 'triangles', 'vertices', 'height', 'width', 'depth', 'footY'];
  const sourceClips = Array.isArray(stats?.clips) ? stats.clips : [];
  checks.sourceStatsMatchReload = requiredStats.every((name) => Number.isFinite(stats?.[name]))
    && stats.meshes === loaded.meshes && stats.materials === loaded.materials
    && stats.bones === loaded.bones && stats.triangles === loaded.triangles && stats.vertices === loaded.vertices
    && near(stats.height, loaded.restBounds.size[1], .0001)
    && near(stats.width, loaded.restBounds.size[0], .0001)
    && near(stats.depth, loaded.restBounds.size[2], .0001)
    && near(stats.footY, loaded.restBounds.min[1], .0001)
    && textureCount === expectedTextures && textureCount === loaded.loadedTextures
    && sourceClips.length === expectedClipNames.length
    && sourceClips.every((clip) => {
      const expected = expectedClips.find(([name]) => name === clip.name);
      const reloaded = loaded.animations.find((animation) => animation.name === clip.name);
      return expected && reloaded && near(clip.duration, expected[1], .0001)
        && clip.tracks === reloaded.tracks && Number.isFinite(clip.duration) && Number.isInteger(clip.tracks);
    });
  checks.previewApiContract = previewApi.ready && previewApi.functionsPresent && previewApi.dataPresent;
  report.sourcePreviewValidation = await page.evaluate(() => window.__wuliuqi.validate());
  report.previewRegression = { api: previewApi, stats, textureCount, pageErrors };

  const controls = await page.locator('[data-clip]').evaluateAll((buttons) => buttons.map((button) => button.dataset.clip));
  const controlResults = {};
  for (const name of expectedClipNames) {
    controlResults[name] = await page.evaluate((clip) => {
      document.querySelector(`[data-clip="${clip}"]`).click();
      return window.__wuliuqi.getState().current;
    }, name);
  }
  checks.allEightAnimationButtons = controls.length === 8
    && JSON.stringify([...controls].sort()) === JSON.stringify(expectedClipNames)
    && Object.entries(controlResults).every(([name, current]) => name === current);

  const oneShotReturnWallMilliseconds = {};
  let oneShotReturns = true;
  for (const [name] of expectedClips.filter(([clipName]) =>
    ['attack', 'flinch', 'cheer', 'reviveRise'].includes(clipName))) {
    const started = Date.now();
    await page.locator(`[data-clip="${name}"]`).click();
    await page.waitForFunction(() => window.__wuliuqi.getState().current === 'idle', null, { timeout: 12000 });
    const elapsed = Date.now() - started;
    oneShotReturnWallMilliseconds[name] = elapsed;
    if (elapsed <= 0 || elapsed > 12000) oneShotReturns = false;
  }
  checks.oneShotReturnsToIdle = oneShotReturns;

  const deadStarted = Date.now();
  await page.locator('[data-clip="dead"]').click();
  await page.waitForFunction(() => {
    const state = window.__wuliuqi.getState();
    return state.current === 'dead' && state.time >= state.duration - .0001;
  }, null, { timeout: 6000 });
  const deadTerminalMilliseconds = Date.now() - deadStarted;
  const deadTerminalState = await page.evaluate(() => window.__wuliuqi.getState());
  await page.waitForTimeout(350);
  const deadHeldState = await page.evaluate(() => window.__wuliuqi.getState());
  checks.deadKeepsTerminalPose = deadTerminalMilliseconds >= 1000
    && deadHeldState.current === 'dead'
    && deadHeldState.time >= deadHeldState.duration - .0001
    && near(deadHeldState.time, deadTerminalState.time, .00001)
    && deadHeldState.bounds.min.every((value, axis) => near(value, deadTerminalState.bounds.min[axis], .00001))
    && deadHeldState.bounds.max.every((value, axis) => near(value, deadTerminalState.bounds.max[axis], .00001));
  report.previewRegression.animationControls = controls;
  report.previewRegression.controlResults = controlResults;
  report.previewRegression.oneShotReturnWallMilliseconds = oneShotReturnWallMilliseconds;
  report.previewRegression.deadTerminalMilliseconds = deadTerminalMilliseconds;
  report.previewRegression.deadTerminalState = {
    current: deadHeldState.current, time: deadHeldState.time,
    duration: deadHeldState.duration, running: deadHeldState.running,
  };

  const capture = async (file, clip, time, view = 'front', stageOnly = false) => {
    await page.evaluate(async ({ clip: clipName, time: sampleTime, view: viewName }) => {
      window.__wuliuqi.setView(viewName);
      window.__wuliuqi.seek(clipName, sampleTime);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, { clip, time, view });
    await (stageOnly ? page.locator('#stage') : page).screenshot({
      path: path.join(evidenceDirectory, file), fullPage: !stageOnly,
    });
    captures.push({ file: `evidence/${file}`, clip, time, view, stageOnly });
  };
  await capture('preview-idle.png', 'idle', 1.6);
  await capture('preview-face.png', 'idle', .55, 'face', true);
  await capture('preview-shoes.png', 'idle', 1.6, 'feet', true);
  await capture('preview-walk.png', 'walk', .6);
  await capture('preview-cast.png', 'cast', 1.5);
  await capture('preview-attack.png', 'attack', .58);
  await capture('preview-flinch.png', 'flinch', .3);
  await capture('preview-cheer.png', 'cheer', 1.2);
  await capture('preview-dead.png', 'dead', 1.5);
  await capture('preview-revive.png', 'reviveRise', .75);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    window.__wuliuqi.seek('idle', 1.6);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: path.join(evidenceDirectory, 'preview-mobile-390.png'), fullPage: true });
  captures.push({ file: 'evidence/preview-mobile-390.png', viewport: '390x844' });
  const mobileMetrics = await page.evaluate(() => {
    const canvas = document.querySelector('#stage canvas');
    return {
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth,
      canvasCssSize: [canvas?.clientWidth ?? 0, canvas?.clientHeight ?? 0],
      animationButtons: document.querySelectorAll('[data-clip]').length,
    };
  });
  report.mobilePreview = { ...mobileMetrics, evidence: 'evidence/preview-mobile-390.png' };
  checks.mobile390NoHorizontalOverflow = mobileMetrics.viewportWidth === 390
    && !mobileMetrics.horizontalOverflow && mobileMetrics.animationButtons === 8
    && mobileMetrics.canvasCssSize[0] > 0 && mobileMetrics.canvasCssSize[1] > 0;
  checks.noPageErrors = pageErrors.length === 0;
  report.previewRegression.pageErrors = pageErrors;
  report.previewRegression.renderer = await page.evaluate(() => window.__wuliuqi.getState().renderer);
  checks.fatalError = true;
} catch (error) {
  report.fatalError = error instanceof Error ? error.message : String(error);
  checks.fatalError = false;
  console.error(error);
}

try {
  const response = await fetch(new URL('/__validation', previewUrl), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report),
  });
  let endpointResult;
  try { endpointResult = await response.json(); } catch { endpointResult = { status: response.status }; }
  report.endpoints = { validation: { ok: response.ok, ...endpointResult } };
  checks.validationEndpointWritable = response.ok;
} catch (error) {
  report.endpoints = { validation: { ok: false, error: error instanceof Error ? error.message : String(error) } };
  checks.validationEndpointWritable = false;
}
report.failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
writeLocalReport();
console.log(JSON.stringify({
  asset: report.asset,
  loaded: report.gltfLoaderReload,
  checks,
  failedChecks: report.failedChecks,
  pageErrors,
  fatalError: report.fatalError ?? null,
  report: 'evidence/validation.json',
}, null, 2));
if (report.failedChecks.length > 0) process.exitCode = 1;
await browser?.close();
