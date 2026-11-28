import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const clamp = (value) => Math.max(0, Math.min(1, value));
const ease = (value) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const q = (rotation) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));

function randomSource(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

function canvasTexture(color, seed, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  const random = randomSource(seed);
  const base = new THREE.Color(color).convertLinearToSRGB();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = (y * size + x) * 4;
    const grain = (random() - .5) * 24;
    const weave = ((x % 4 === 0 ? -5 : 0) + (y % 4 === 0 ? 4 : 0));
    image.data[index] = Math.max(0, Math.min(255, base.r * 255 + grain + weave));
    image.data[index + 1] = Math.max(0, Math.min(255, base.g * 255 + grain + weave));
    image.data[index + 2] = Math.max(0, Math.min(255, base.b * 255 + grain + weave));
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.anisotropy = 4;
  return texture;
}

function scalarTexture(kind, seed, size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  const random = randomSource(seed);
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = (y * size + x) * 4;
    const grain = random();
    heights[y * size + x] = grain;
    const value = kind === 'roughness' ? 145 + grain * 95 : 205 + grain * 50;
    image.data[index] = image.data[index + 1] = image.data[index + 2] = value;
    image.data[index + 3] = 255;
  }
  if (kind === 'normal') for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const left = heights[y * size + (x + size - 1) % size];
    const right = heights[y * size + (x + 1) % size];
    const up = heights[((y + size - 1) % size) * size + x];
    const down = heights[((y + 1) % size) * size + x];
    const normal = V((left - right) * 1.6, (up - down) * 1.6, 1).normalize();
    const index = (y * size + x) * 4;
    image.data[index] = (normal.x * .5 + .5) * 255;
    image.data[index + 1] = (normal.y * .5 + .5) * 255;
    image.data[index + 2] = (normal.z * .5 + .5) * 255;
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.anisotropy = 4;
  return texture;
}

function pbrMaterial(name, color, options = {}) {
  const seed = options.seed ?? 1;
  return new THREE.MeshPhysicalMaterial({
    name,
    color: 0xffffff,
    map: canvasTexture(color, seed),
    roughness: options.roughness ?? .8,
    roughnessMap: scalarTexture('roughness', seed + 17),
    metalness: options.metalness ?? 0,
    metalnessMap: scalarTexture('metalness', seed + 31),
    normalMap: scalarTexture('normal', seed + 47),
    normalScale: new THREE.Vector2(options.normal ?? .22, options.normal ?? .22),
    clearcoat: options.clearcoat ?? 0,
    clearcoatRoughness: .6,
  });
}

function createMaterials() {
  return {
    robe: pbrMaterial('ink_blue_crane_robe', '#25313a', { seed: 101, roughness: .93, normal: .3 }),
    robeDark: pbrMaterial('robe_shadow_folds', '#161e25', { seed: 105, roughness: .96, normal: .28 }),
    trim: pbrMaterial('antique_gold_trim', '#9b7a43', { seed: 109, roughness: .52, metalness: .58, normal: .18 }),
    skin: pbrMaterial('aged_warm_skin', '#c99c7d', { seed: 113, roughness: .84, normal: .18 }),
    hair: pbrMaterial('silver_white_hair', '#ddd9cc', { seed: 117, roughness: .88, normal: .24 }),
    trousers: pbrMaterial('ivory_trousers', '#d6d0bf', { seed: 121, roughness: .96, normal: .28 }),
    leather: pbrMaterial('dark_cloth_shoes', '#1b1d1e', { seed: 125, roughness: .92, normal: .32 }),
    jade: pbrMaterial('domain_jade', '#5f9b83', { seed: 129, roughness: .34, normal: .12, clearcoat: .35 }),
    gold: pbrMaterial('domain_ring_gold', '#a8864d', { seed: 133, roughness: .4, metalness: .78, normal: .16 }),
    ink: pbrMaterial('facial_marks', '#2a211d', { seed: 137, roughness: .9, normal: .08 }),
    white: pbrMaterial('eye_white', '#e9e3d4', { seed: 141, roughness: .56, normal: .05 }),
    sole: pbrMaterial('shoe_sole', '#4a443b', { seed: 145, roughness: .98, normal: .3 }),
  };
}

function plateGeometry(points, depth = .012) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index++) shape.lineTo(points[index][0], points[index][1]);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: .0025, bevelThickness: .0025, bevelSegments: 1, curveSegments: 6 });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function taperedTube(points, radii, segments = 22, sides = 9) {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(segments, false);
  const positions = [], uvs = [], indices = [];
  for (let row = 0; row <= segments; row++) {
    const t = row / segments;
    const center = curve.getPointAt(t);
    const scaled = t * (radii.length - 1);
    const index = Math.min(radii.length - 2, Math.floor(scaled));
    const radius = THREE.MathUtils.lerp(radii[index], radii[index + 1], scaled - index);
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * TAU;
      const point = center.clone().addScaledVector(frames.normals[row], Math.cos(angle) * radius).addScaledVector(frames.binormals[row], Math.sin(angle) * radius);
      positions.push(point.x, point.y, point.z);
      uvs.push(side / sides, t);
    }
  }
  for (let row = 0; row < segments; row++) for (let side = 0; side < sides; side++) {
    const a = row * (sides + 1) + side, b = a + sides + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function limbGeometry(points, radiusStops, segments = 36, sides = 12, options = {}) {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(segments, false);
  const split = points[0].distanceTo(points[1]) / curve.getLength();
  const positions = [], uvs = [], weights = [], indices = [];
  for (let row = 0; row <= segments; row++) {
    const t = row / segments, center = curve.getPointAt(t);
    let radius = radiusStops[radiusStops.length - 1][1];
    for (let index = 0; index < radiusStops.length - 1; index++) {
      const [startT, startRadius] = radiusStops[index], [endT, endRadius] = radiusStops[index + 1];
      if (t >= startT && t <= endT) { radius = THREE.MathUtils.lerp(startRadius, endRadius, (t - startT) / Math.max(.00001, endT - startT)); break; }
    }
    const firstBlend = t < split ? t / split : 1, secondBlend = t > split ? (t - split) / (1 - split) : 0;
    const chainWeights = t <= split ? [1 - ease(firstBlend), ease(firstBlend), 0] : [0, 1 - ease(secondBlend), ease(secondBlend)];
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * TAU;
      const fold = 1 + (options.folds ?? 0) * Math.sin(angle * 7 + t * 11) * Math.sin(Math.PI * t);
      const point = center.clone().addScaledVector(frames.normals[row], Math.cos(angle) * radius * fold).addScaledVector(frames.binormals[row], Math.sin(angle) * radius * fold);
      positions.push(point.x, point.y, point.z);
      uvs.push(side / sides, t);
      weights.push(...chainWeights);
    }
  }
  for (let row = 0; row < segments; row++) for (let side = 0; side < sides; side++) {
    const a = row * (sides + 1) + side, b = a + sides + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('chainWeights', new THREE.Float32BufferAttribute(weights, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function ringSurfaceGeometry(rings, segments = 24, folds = 0) {
  const positions = [], uvs = [], indices = [];
  for (let row = 0; row < rings.length; row++) {
    const ring = rings[row], t = row / (rings.length - 1);
    for (let side = 0; side <= segments; side++) {
      const angle = side / segments * TAU;
      const fold = 1 + folds * Math.sin(angle * 8 + t * 5) * (.35 + t * .65);
      positions.push(Math.sin(angle) * ring.rx * fold, ring.y, (ring.z ?? 0) + Math.cos(angle) * ring.rz * fold);
      uvs.push(side / segments, t);
    }
  }
  for (let row = 0; row < rings.length - 1; row++) for (let side = 0; side < segments; side++) {
    const a = row * (segments + 1) + side, b = a + segments + 1;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function robePanelGeometry(side) {
  const rings = [
    { y: -.60, rx: .40, rz: .30 }, { y: -.48, rx: .36, rz: .275 },
    { y: -.30, rx: .32, rz: .235 }, { y: -.10, rx: .275, rz: .20 },
    { y: .04, rx: .245, rz: .175 }, { y: .14, rx: .23, rz: .165 },
  ];
  const positions = [], uvs = [], indices = [], segments = 22;
  for (let row = 0; row < rings.length; row++) {
    const ring = rings[row], t = row / (rings.length - 1);
    for (let sideIndex = 0; sideIndex <= segments; sideIndex++) {
      const phi = sideIndex / segments * Math.PI;
      const fold = 1 + (.025 + t * .05) * Math.sin(phi * 8 + .3) + .016 * Math.sin(phi * 13 - t * 2);
      const hem = (1 - t) ** 3 * Math.sin(phi * 5) * .012;
      positions.push(-side * .13 + side * ring.rx * Math.sin(phi) * fold, ring.y + hem, .12 + ring.rz * Math.cos(phi) * fold);
      uvs.push(sideIndex / segments, t);
    }
  }
  for (let row = 0; row < rings.length - 1; row++) for (let sideIndex = 0; sideIndex < segments; sideIndex++) {
    const a = row * (segments + 1) + sideIndex, b = a + segments + 1;
    if (side > 0) indices.push(a, a + 1, b, b, a + 1, b + 1);
    else indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function shoeUpperGeometry() {
  const sections = [
    { z: -.105, width: .065, height: .055, y: -.005 }, { z: -.07, width: .082, height: .075, y: -.005 },
    { z: .02, width: .091, height: .065, y: -.015 }, { z: .15, width: .098, height: .045, y: -.030 },
    { z: .225, width: .070, height: .028, y: -.045 }, { z: .24, width: .025, height: .015, y: -.052 },
  ];
  const positions = [], uvs = [], indices = [], sides = 14;
  for (let row = 0; row < sections.length; row++) {
    const section = sections[row];
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * TAU;
      positions.push(Math.cos(angle) * section.width, section.y + Math.sin(angle) * section.height, section.z);
      uvs.push(side / sides, row / (sections.length - 1));
    }
  }
  for (let row = 0; row < sections.length - 1; row++) for (let side = 0; side < sides; side++) {
    const a = row * (sides + 1) + side, b = a + sides + 1;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function shoeSoleGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-.062, -.105); shape.lineTo(.062, -.105); shape.lineTo(.078, -.055);
  shape.lineTo(.098, .105); shape.quadraticCurveTo(.10, .235, .025, .248);
  shape.quadraticCurveTo(0, .255, -.025, .248); shape.quadraticCurveTo(-.10, .235, -.098, .105);
  shape.lineTo(-.078, -.055); shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: .018, bevelEnabled: true, bevelSize: .003, bevelThickness: .002, bevelSegments: 1, curveSegments: 8 });
  geometry.rotateX(Math.PI / 2); geometry.translate(0, -.058, 0);
  return geometry;
}

const quaternionTrack = (name, times, values) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values.flatMap((value) => value.toArray()));
const vectorTrack = (name, times, values) => new THREE.VectorKeyframeTrack(`${name}.position`, times, values.flatMap((value) => value.toArray()));
const scaleTrack = (name, times, values) => new THREE.VectorKeyframeTrack(`${name}.scale`, times, values.flatMap((value) => [value, value, value]));

function reverseClip(clip) {
  const tracks = clip.tracks.map((track) => {
    const stride = track.values.length / track.times.length;
    const times = [...track.times].reverse().map((time) => clip.duration - time);
    const values = [];
    for (let index = track.values.length - stride; index >= 0; index -= stride) values.push(...track.values.slice(index, index + stride));
    return new track.constructor(track.name, times, values);
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function solveArm(upper, forearm, hand, target, bendDirection, restPose, handWorld = new THREE.Quaternion()) {
  const shoulder = upper.getWorldPosition(new THREE.Vector3());
  const parentRest = upper.parent.getWorldQuaternion(new THREE.Quaternion());
  const upperLength = forearm.position.length(), lowerLength = hand.position.length();
  const toTarget = target.clone().sub(shoulder);
  const distance = Math.min(toTarget.length(), upperLength + lowerLength - .00001);
  const direction = toTarget.normalize(), reachable = shoulder.clone().addScaledVector(direction, distance);
  const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const bend = bendDirection.clone().addScaledVector(direction, -bendDirection.dot(direction)).normalize();
  const elbow = shoulder.clone().addScaledVector(direction, along).addScaledVector(bend, height);
  const upperDirection = elbow.clone().sub(shoulder).normalize(), lowerDirection = reachable.clone().sub(elbow).normalize();
  const upperRest = restPose.get(upper.name), lowerRest = restPose.get(forearm.name);
  const upperBaseWorld = parentRest.clone().multiply(upperRest.quaternion);
  const upperOffset = forearm.position.clone().applyQuaternion(upperBaseWorld).normalize();
  const upperWorld = new THREE.Quaternion().setFromUnitVectors(upperOffset, upperDirection).multiply(upperBaseWorld);
  const upperLocal = parentRest.clone().invert().multiply(upperWorld);
  const lowerBaseWorld = upperWorld.clone().multiply(lowerRest.quaternion);
  const lowerOffset = hand.position.clone().applyQuaternion(lowerBaseWorld).normalize();
  const lowerWorld = new THREE.Quaternion().setFromUnitVectors(lowerOffset, lowerDirection).multiply(lowerBaseWorld);
  return { upper: upperLocal, forearm: upperWorld.clone().invert().multiply(lowerWorld), hand: lowerWorld.clone().invert().multiply(handWorld), target: reachable };
}

function buildSkinnedMeshes(root, bones, entries) {
  const boneIndices = new Map(bones.map((bone, index) => [bone.name, index]));
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.material.uuid;
    if (!groups.has(key)) groups.set(key, { material: entry.material, items: [] });
    groups.get(key).items.push(entry);
  }
  const skeleton = new THREE.Skeleton(bones);
  let triangles = 0, vertices = 0;
  for (const { material, items } of groups.values()) {
    const geometries = items.map((item) => {
      const geometry = item.geometry.clone(), count = geometry.attributes.position.count;
      const skinIndices = new Uint8Array(count * 4), skinWeights = new Uint8Array(count * 4);
      if (item.chain) {
        const chain = item.chain.map((name) => boneIndices.get(name)), source = geometry.attributes.chainWeights;
        for (let index = 0; index < count; index++) {
          const weights = [source.getX(index), source.getY(index), source.getZ(index)];
          const rounded = weights.map((weight) => Math.round(weight * 255));
          rounded[rounded.indexOf(Math.max(...rounded))] += 255 - rounded.reduce((sum, weight) => sum + weight, 0);
          for (let slot = 0; slot < 3; slot++) { skinIndices[index * 4 + slot] = chain[slot]; skinWeights[index * 4 + slot] = rounded[slot]; }
        }
      } else {
        const boneIndex = boneIndices.get(item.bone);
        skinIndices.fill(boneIndex);
        for (let index = 0; index < count; index++) skinWeights[index * 4] = 255;
      }
      geometry.deleteAttribute('chainWeights');
      geometry.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(skinIndices, 4));
      geometry.setAttribute('skinWeight', new THREE.Uint8BufferAttribute(skinWeights, 4, true));
      return geometry;
    });
    const geometry = mergeGeometries(geometries, false);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = `Laodaye_${material.name}`;
    mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
    root.add(mesh); mesh.bind(skeleton, new THREE.Matrix4());
    triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
    vertices += geometry.attributes.position.count;
    geometries.forEach((item) => item.dispose());
    items.forEach((item) => item.geometry.dispose());
  }
  return { skeleton, triangles, vertices, meshes: groups.size };
}

export function createLaodaye() {
  const materials = createMaterials();
  const root = new THREE.Group(); root.name = 'Laodaye';
  root.userData = { visualId: 'laodaye', suggestedCharId: 'laodaye', upAxis: '+Y', forwardAxis: '+Z', units: 'meters', externalCredentialsUsed: false };
  const bones = [], boneMap = new Map();
  const addBone = (name, parent, position) => {
    const bone = new THREE.Bone(); bone.name = name; bone.position.copy(position); parent.add(bone); bones.push(bone); boneMap.set(name, bone); return bone;
  };
  const Root = addBone('Root', root, V(0, .02, 0));
  const Pelvis = addBone('Pelvis', Root, V(0, .88, 0));
  const Spine = addBone('Spine', Pelvis, V(0, .16, 0));
  const Chest = addBone('Chest', Spine, V(0, .23, 0));
  const Neck = addBone('Neck', Chest, V(0, .23, .035));
  const Head = addBone('Head', Neck, V(0, .13, .045));
  const UpperArmL = addBone('UpperArmL', Chest, V(-.29, .12, 0));
  const ForearmL = addBone('ForearmL', UpperArmL, V(0, -.31, 0));
  const HandL = addBone('HandL', ForearmL, V(0, -.28, 0));
  const UpperArmR = addBone('UpperArmR', Chest, V(.29, .12, 0));
  const ForearmR = addBone('ForearmR', UpperArmR, V(0, -.31, 0));
  const HandR = addBone('HandR', ForearmR, V(0, -.28, 0));
  const DomainPivot = addBone('DomainPivot', Chest, V(0, .06, -.27));
  const ThighL = addBone('ThighL', Pelvis, V(-.13, -.04, 0));
  const ShinL = addBone('ShinL', ThighL, V(0, -.38, 0));
  const FootL = addBone('FootL', ShinL, V(0, -.38, 0));
  const ThighR = addBone('ThighR', Pelvis, V(.13, -.04, 0));
  const ShinR = addBone('ShinR', ThighR, V(0, -.38, 0));
  const FootR = addBone('FootR', ShinR, V(0, -.38, 0));
  const RobeTailL = addBone('RobeTailL', Pelvis, V(-.13, -.02, -.12));
  const RobeTailR = addBone('RobeTailR', Pelvis, V(.13, -.02, -.12));
  const SleeveL = addBone('SleeveL', UpperArmL, V(0, -.17, 0));
  const SleeveR = addBone('SleeveR', UpperArmR, V(0, -.17, 0));
  const CollarL = addBone('CollarL', Chest, V(-.10, .17, .02));
  const CollarR = addBone('CollarR', Chest, V(.10, .17, .02));

  root.updateMatrixWorld(true);
  const initialRest = new Map(bones.map((bone) => [bone.name, { position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }]));
  const leftGrip = solveArm(UpperArmL, ForearmL, HandL, V(-.36, .74, -.02), V(-.8, -.2, .45), initialRest);
  const rightGrip = solveArm(UpperArmR, ForearmR, HandR, V(.37, .78, .16), V(.8, -.2, .45), initialRest);
  for (const [bone, pose] of [[UpperArmL, leftGrip], [ForearmL, leftGrip], [HandL, leftGrip], [UpperArmR, rightGrip], [ForearmR, rightGrip], [HandR, rightGrip]]) bone.quaternion.copy(bone.name.startsWith('Upper') ? pose.upper : bone.name.startsWith('Fore') ? pose.forearm : pose.hand);
  Spine.rotation.x = .09; Chest.rotation.x = .05; Neck.rotation.x = -.10; Head.rotation.x = -.02; Head.rotation.z = -.035;
  ThighL.rotation.x = -.02; ShinL.rotation.x = .04; ThighR.rotation.x = .02; ShinR.rotation.x = .07;
  CollarL.rotation.set(-.04, -.18, -.20); CollarR.rotation.set(-.04, .18, .20);
  root.updateMatrixWorld(true);
  const restLeft = HandL.getWorldPosition(new THREE.Vector3()), restRight = HandR.getWorldPosition(new THREE.Vector3());

  const entries = [];
  const part = (bone, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); mesh.rotation.set(...rotation); mesh.scale.set(...scale); bone.add(mesh); entries.push({ mesh, bone: bone.name, material, geometry: geometry.clone() }); return mesh;
  };
  const tube = (bone, points, radii, material, segments = 20, sides = 9) => part(bone, taperedTube(points, radii, segments, sides), material);
  const chain = (names, points, radii, material, options = {}) => entries.push({ geometry: limbGeometry(points, radii.map((radius, index) => [index / (radii.length - 1), radius]), options.segments ?? 36, options.sides ?? 12, options), material, chain: names });
  const rounded = (width, height, depth, radius = .02) => new RoundedBoxGeometry(width, height, depth, 2, radius);
  const sphere = (radius = 1) => new THREE.SphereGeometry(radius, 18, 12);

  part(Neck, new THREE.CylinderGeometry(.068, .076, .16, 16), materials.skin, [0, .035, 0]);
  part(Pelvis, sphere(), materials.trousers, [0, -.02, 0], [0, 0, 0], [.23, .16, .15]);
  part(Chest, ringSurfaceGeometry([
    { y: -.27, rx: .215, rz: .145 }, { y: -.19, rx: .235, rz: .16 },
    { y: -.06, rx: .275, rz: .18 }, { y: .09, rx: .305, rz: .185 },
    { y: .18, rx: .29, rz: .16 }, { y: .245, rx: .19, rz: .115 },
  ], 28, .018), materials.robe);
  part(Chest, new THREE.CylinderGeometry(.247, .25, .07, 24), materials.robeDark, [0, -.19, 0], [0, 0, 0], [1, 1, .72]);
  part(Chest, sphere(.033), materials.trim, [0, -.19, .184], [0, 0, 0], [1.1, .8, .5]);
  part(Chest, plateGeometry([[-.085, .10], [.085, .10], [.055, -.04], [0, -.085], [-.055, -.04]], .01), materials.trousers, [0, .155, .148]);
  part(Chest, rounded(.032, .39, .014, .004), materials.trim, [0, -.025, .184]);
  part(CollarL, plateGeometry([[0, .07], [-.12, .12], [-.16, -.03], [-.03, -.10]], .014), materials.robeDark, [0, 0, 0], [0, -.15, 0]);
  part(CollarR, plateGeometry([[0, .07], [.12, .12], [.16, -.03], [.03, -.10]], .014), materials.robeDark, [0, 0, 0], [0, .15, 0]);
  tube(CollarL, [V(-.015, .065, .012), V(-.105, .085, .012), V(-.145, -.02, .012)], [.005, .006, .004], materials.trim, 10, 5);
  tube(CollarR, [V(.015, .065, .012), V(.105, .085, .012), V(.145, -.02, .012)], [.005, .006, .004], materials.trim, 10, 5);
  for (const offset of [-.115, .115]) {
    tube(Chest, [V(offset, -.13, .159), V(offset * .88, -.04, .183), V(offset * .72, .075, .17)], [.004, .006, .003], materials.robeDark, 12, 5);
  }
  tube(Chest, [V(-.10, .18, .13), V(-.03, .02, .19), V(.10, -.20, .15)], [.009, .008, .006], materials.trim, 12, 5);
  part(Chest, new THREE.TorusGeometry(.045, .010, 6, 18), materials.gold, [0, -.20, .18]);
  part(Chest, sphere(.036), materials.jade, [0, -.255, .18], [0, 0, 0], [.8, 1.15, .45]);
  for (const side of [-1, 1]) {
    const tail = side < 0 ? RobeTailL : RobeTailR;
    part(tail, robePanelGeometry(side), materials.robe);
    const hemPoints = Array.from({ length: 17 }, (_, index) => {
      const phi = index / 16 * Math.PI;
      return V(-side * .13 + side * .403 * Math.sin(phi), -.596 + Math.sin(phi * 5) * .012, .12 + .303 * Math.cos(phi));
    });
    part(tail, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hemPoints), 32, .005, 5, false), materials.trim);
    for (const phi of [.42, 1.12, 1.72, 2.30, 2.72]) {
      const foldPoints = [
        V(-side * .13 + side * .238 * Math.sin(phi), .10, .12 + .17 * Math.cos(phi)),
        V(-side * .13 + side * .28 * Math.sin(phi), -.12, .12 + .205 * Math.cos(phi)),
        V(-side * .13 + side * .365 * Math.sin(phi), -.47, .12 + .278 * Math.cos(phi)),
      ];
      part(tail, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(foldPoints), 16, .0045, 5, false), materials.robeDark);
    }
  }

  for (const [radius, thickness] of [[.46, .012], [.56, .009], [.66, .006]]) {
    part(DomainPivot, new THREE.TorusGeometry(radius, thickness, 6, 72), materials.gold);
  }
  for (let index = 0; index < 8; index++) {
    const angle = index / 8 * TAU;
    part(DomainPivot, sphere(index % 2 ? .014 : .020), index % 2 ? materials.gold : materials.jade, [Math.sin(angle) * .56, Math.cos(angle) * .56, 0]);
  }
  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    part(DomainPivot, rounded(.055, .018, .012, .003), materials.trim, [Math.sin(angle) * .66, Math.cos(angle) * .66, 0], [0, 0, -angle]);
  }

  part(Head, sphere(), materials.skin, [0, .10, .01], [0, 0, 0], [.16, .215, .15]);
  part(Head, sphere(), materials.skin, [0, -.02, .045], [0, 0, 0], [.125, .095, .115]);
  for (const side of [-1, 1]) {
    part(Head, sphere(.034), materials.skin, [side * .155, .09, .005], [0, 0, 0], [.55, 1.15, .7]);
    part(Head, sphere(.029), materials.white, [side * .058, .13, .139], [0, 0, side * .05], [1, .34, .27]);
    part(Head, sphere(.010), materials.ink, [side * .057, .129, .152], [0, 0, 0], [.75, .82, .35]);
    tube(Head, [V(side * .10, .18, .125), V(side * .06, .195, .148), V(side * .022, .18, .15)], [.014, .018, .006], materials.hair, 8, 6);
    tube(Head, [V(side * .13, .15, .06), V(side * .155, .08, .065), V(side * .15, .015, .05)], [.026, .022, .008], materials.hair, 8, 6);
  }
  tube(Head, [V(0, .08, .15), V(0, .025, .205), V(0, -.01, .225)], [.030, .027, .020], materials.skin, 12, 7);
  tube(Head, [V(-.075, -.035, .14), V(-.025, -.025, .17), V(0, -.035, .18)], [.010, .014, .008], materials.hair, 8, 5);
  tube(Head, [V(.075, -.035, .14), V(.025, -.025, .17), V(0, -.035, .18)], [.010, .014, .008], materials.hair, 8, 5);
  tube(Head, [V(-.045, -.075, .13), V(-.025, -.20, .11), V(-.055, -.27, .08)], [.020, .017, .004], materials.hair, 12, 6);
  tube(Head, [V(.045, -.075, .13), V(.025, -.20, .11), V(.055, -.27, .08)], [.020, .017, .004], materials.hair, 12, 6);
  tube(Head, [V(0, -.08, .145), V(0, -.18, .13), V(0, -.24, .10)], [.022, .018, .004], materials.hair, 12, 6);
  part(Head, new THREE.SphereGeometry(.168, 22, 12, 0, TAU, 0, Math.PI * .50), materials.hair, [0, .16, -.01], [0, 0, 0], [.98, .92, .96]);
  part(Head, sphere(.065), materials.hair, [0, .31, -.035], [0, 0, 0], [.8, 1.1, .8]);
  tube(Head, [V(-.11, .30, -.02), V(.11, .32, -.02)], [.008, .008], materials.trim, 4, 6);

  for (const side of [-1, 1]) {
    const upper = side < 0 ? UpperArmL : UpperArmR, forearm = side < 0 ? ForearmL : ForearmR, hand = side < 0 ? HandL : HandR, sleeve = side < 0 ? SleeveL : SleeveR;
    entries.push({
      geometry: limbGeometry(
        [upper.getWorldPosition(new THREE.Vector3()), forearm.getWorldPosition(new THREE.Vector3()), hand.getWorldPosition(new THREE.Vector3())],
        [[0, .135], [.18, .160], [.50, .205], [.78, .140], [1, .070]],
        42,
        16,
        { folds: .08 }
      ),
      material: materials.robe,
      chain: [upper.name, forearm.name, hand.name]
    });
    part(upper, sphere(), materials.robe, [0, -.025, 0], [0, 0, 0], [.145, .13, .145]);
    tube(upper, [V(-.10, .035, .085), V(0, .07, .115), V(.10, .035, .085)], [.005, .007, .005], materials.robeDark, 12, 5);
    part(sleeve, new THREE.CylinderGeometry(.155, .205, .20, 18), materials.robe, [0, -.055, .008], [0, 0, 0], [1, 1, .92]);
    for (const offset of [-.085, 0, .085]) {
      tube(sleeve, [V(offset, .035, .125), V(offset * 1.15, -.06, .165), V(offset * 1.35, -.145, .14)], [.004, .006, .003], materials.robeDark, 10, 5);
    }
    part(forearm, new THREE.CylinderGeometry(.070, .064, .036, 18), materials.trim, [0, -.252, 0]);
    part(forearm, new THREE.TorusGeometry(.066, .003, 5, 20), materials.trim, [0, -.268, 0], [Math.PI / 2, 0, 0]);
    part(hand, rounded(.098, .108, .056, .018), materials.skin, [0, -.038, .006], [0, 0, side * .04]);
    for (let finger = 0; finger < 4; finger++) {
      const x = (finger - 1.5) * .021, length = [.062, .077, .073, .058][finger];
      tube(hand, [V(x, -.078, .012), V(x + side * .003, -.078 - length * .55, .018), V(x + side * .006, -.078 - length, .010)], [.0105, .009, .006], materials.skin, 8, 6);
      part(hand, sphere(.0105), materials.skin, [x, -.077, .01], [0, 0, 0], [1, .8, .9]);
    }
    tube(hand, [V(-side * .043, -.018, .008), V(-side * .066, -.043, .022), V(-side * .060, -.072, .018)], [.014, .012, .008], materials.skin, 9, 6);
  }
  part(HandR, new THREE.TorusGeometry(.052, .009, 6, 20), materials.jade, [0, -.098, .02], [Math.PI / 2, 0, 0]);
  part(HandR, rounded(.026, .032, .012, .005), materials.jade, [.043, -.098, .035], [0, 0, -.18]);

  for (const side of [-1, 1]) {
    const thigh = side < 0 ? ThighL : ThighR, shin = side < 0 ? ShinL : ShinR, foot = side < 0 ? FootL : FootR;
    chain([thigh.name, shin.name, foot.name], [thigh.getWorldPosition(new THREE.Vector3()), shin.getWorldPosition(new THREE.Vector3()), foot.getWorldPosition(new THREE.Vector3())], [.112, .102, .089, .074], materials.trousers, { segments: 40, sides: 14, folds: .035 });
    tube(thigh, [V(-.035, -.08, .096), V(0, -.18, .104), V(.035, -.08, .096)], [.004, .006, .004], materials.trousers, 10, 5);
    part(shin, new THREE.CylinderGeometry(.082, .074, .10, 14), materials.trousers, [0, -.30, 0]);
    for (const y of [-.20, -.255]) {
      tube(shin, [V(-.055, y + .018, .066), V(0, y, .082), V(.055, y + .018, .066)], [.0035, .005, .0035], materials.trousers, 9, 5);
    }
    part(foot, shoeUpperGeometry(), materials.leather);
    part(foot, shoeSoleGeometry(), materials.sole);
    part(foot, rounded(.118, .042, .075, .009), materials.sole, [0, -.043, -.062]);
    tube(foot, [V(-.075, .005, .125), V(0, .020, .142), V(.075, .005, .125)], [.004, .005, .004], materials.sole, 12, 5);
    tube(foot, [V(-.082, -.005, -.035), V(-.088, -.010, .08), V(-.072, -.020, .195)], [.003, .004, .0025], materials.sole, 14, 5);
    tube(foot, [V(.082, -.005, -.035), V(.088, -.010, .08), V(.072, -.020, .195)], [.003, .004, .0025], materials.sole, 14, 5);
  }

  root.updateMatrixWorld(true);
  for (const entry of entries) {
    let geometry = entry.geometry ?? entry.mesh.geometry.clone();
    for (const attribute of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv', 'chainWeights'].includes(attribute)) geometry.deleteAttribute(attribute);
    if (!geometry.attributes.uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
    if (!entry.chain) geometry.applyMatrix4(entry.mesh.matrixWorld);
    const indexed = mergeVertices(geometry, 1e-5); geometry.dispose(); entry.geometry = indexed; entry.mesh?.removeFromParent();
  }
  const built = buildSkinnedMeshes(root, bones, entries);
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root, true);
  const restPose = new Map(bones.map((bone) => [bone.name, { position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }]));
  const clips = createClips({ root, boneMap, restPose, restLeft, restRight });
  return {
    root, skeleton: built.skeleton, bones, clips, materials: Object.values(materials), restPose,
    stats: { meshes: built.meshes, materials: Object.keys(materials).length, bones: bones.length, triangles: built.triangles, vertices: built.vertices, height: bounds.max.y - bounds.min.y, width: bounds.max.x - bounds.min.x, depth: bounds.max.z - bounds.min.z, footY: bounds.min.y, clips: clips.map((clip) => ({ name: clip.name, duration: clip.duration, tracks: clip.tracks.length })) },
  };
}

function createClips(context) {
  const { restPose } = context;
  const clips = [];
  const idleTimes = [0, 1, 2, 3, 4];
  clips.push(new THREE.AnimationClip('idle', 4, [
    vectorTrack('Spine', idleTimes, idleTimes.map((_, index) => V(0, restPose.get('Spine').position.y + (index === 0 || index === 4 ? 0 : Math.sin(index / 4 * TAU) * .007), 0))),
    quaternionTrack('Head', idleTimes, idleTimes.map((_, index) => index === 0 || index === 4 ? restPose.get('Head').quaternion.clone() : q([-.02 + Math.sin(index * 1.2) * .012, Math.sin(index / 4 * TAU) * .03, -.035]))),
    quaternionTrack('DomainPivot', idleTimes, idleTimes.map((time) => q([0, time * .16, Math.sin(time * .8) * .015]))),
    quaternionTrack('RobeTailL', idleTimes, idleTimes.map((_, index) => q([Math.sin(index / 4 * TAU * 2) * .015, 0, 0]))),
    quaternionTrack('RobeTailR', idleTimes, idleTimes.map((_, index) => q([Math.cos(index / 4 * TAU * 2) * .012, 0, 0]))),
  ]));

  const walkTimes = Array.from({ length: 9 }, (_, index) => index / 8), stride = walkTimes.map((time) => Math.sin(time * TAU));
  clips.push(new THREE.AnimationClip('walk', 1, [
    quaternionTrack('ThighL', walkTimes, stride.map((value) => q([value * .20, 0, -.02]))), quaternionTrack('ThighR', walkTimes, stride.map((value) => q([-value * .20, 0, .02]))),
    quaternionTrack('ShinL', walkTimes, stride.map((value) => q([Math.max(0, -value) * .26, 0, 0]))), quaternionTrack('ShinR', walkTimes, stride.map((value) => q([Math.max(0, value) * .26, 0, 0]))),
    quaternionTrack('FootL', walkTimes, stride.map((value) => q([-value * .07, 0, 0]))), quaternionTrack('FootR', walkTimes, stride.map((value) => q([value * .07, 0, 0]))),
    vectorTrack('Pelvis', walkTimes, walkTimes.map((time) => V(0, restPose.get('Pelvis').position.y + Math.abs(Math.sin(time * TAU)) * .010, 0))),
    quaternionTrack('Spine', walkTimes, stride.map((value) => q([.09, value * .02, value * .012]))),
    quaternionTrack('DomainPivot', walkTimes, walkTimes.map((time) => q([0, time * .35, Math.sin(time * TAU) * .02]))),
    quaternionTrack('SleeveL', walkTimes, stride.map((value) => q([value * .04, 0, .02]))), quaternionTrack('SleeveR', walkTimes, stride.map((value) => q([-value * .04, 0, -.02]))),
    quaternionTrack('RobeTailL', walkTimes, stride.map((value) => q([value * .045, 0, value * .012]))), quaternionTrack('RobeTailR', walkTimes, stride.map((value) => q([-value * .045, 0, -value * .012]))),
  ]));

  const swingTimes = [0, .35, .70, 1.05, 1.40, 1.80, 2.20];
  clips.push(new THREE.AnimationClip('swing', 2.2, [
    quaternionTrack('Head', swingTimes, swingTimes.map((_, index) => q(index < 3 ? [-.08, -.14, -.05] : index < 5 ? [.02, .12, .03] : [-.02, 0, -.035]))),
    quaternionTrack('Spine', swingTimes, swingTimes.map((_, index) => q(index < 3 ? [.12, -.06, -.02] : index < 5 ? [.06, .07, .02] : [.09, 0, 0]))),
    quaternionTrack('UpperArmR', swingTimes, swingTimes.map((_, index) => q(index >= 2 && index <= 4 ? [-.75, 0, -.42] : [0, 0, 0]))),
    quaternionTrack('ForearmR', swingTimes, swingTimes.map((_, index) => q(index >= 2 && index <= 4 ? [-.45, 0, 0] : [0, 0, 0]))),
    quaternionTrack('DomainPivot', swingTimes, swingTimes.map((time, index) => q([0, time * .4, index >= 2 && index <= 4 ? .08 : 0]))),
    quaternionTrack('RobeTailL', swingTimes, swingTimes.map((_, index) => q([index >= 2 && index <= 4 ? -.035 : 0, 0, index >= 2 && index <= 4 ? -.012 : 0]))),
    quaternionTrack('RobeTailR', swingTimes, swingTimes.map((_, index) => q([index >= 2 && index <= 4 ? .025 : 0, 0, index >= 2 && index <= 4 ? .01 : 0]))),
  ]));

  const castTimes = [0, .45, 1.0, 1.55, 2.1, 2.7], castScale = [1, 1.08, 1.18, 1.26, 1.12, 1];
  clips.push(new THREE.AnimationClip('cast', 2.7, [
    quaternionTrack('Head', castTimes, castTimes.map((_, index) => q(index > 0 && index < 5 ? [-.14, 0, -.02] : [-.02, 0, -.035]))),
    quaternionTrack('UpperArmL', castTimes, castTimes.map((_, index) => q(index > 0 && index < 5 ? [-.70, 0, .35] : [0, 0, 0]))),
    quaternionTrack('UpperArmR', castTimes, castTimes.map((_, index) => q(index > 0 && index < 5 ? [-.70, 0, -.35] : [0, 0, 0]))),
    quaternionTrack('ForearmL', castTimes, castTimes.map((_, index) => q(index > 0 && index < 5 ? [-.55, 0, 0] : [0, 0, 0]))),
    quaternionTrack('ForearmR', castTimes, castTimes.map((_, index) => q(index > 0 && index < 5 ? [-.55, 0, 0] : [0, 0, 0]))),
    quaternionTrack('DomainPivot', castTimes, castTimes.map((time) => q([0, time * .9, 0]))),
    scaleTrack('DomainPivot', castTimes, castScale),
  ]));

  const flinchTimes = [0, .12, .30, .75];
  clips.push(new THREE.AnimationClip('flinch', .75, [
    quaternionTrack('Head', flinchTimes, [restPose.get('Head').quaternion.clone(), q([.16, -.16, -.10]), q([.04, .04, .01]), restPose.get('Head').quaternion.clone()]),
    vectorTrack('Pelvis', flinchTimes, [V(0, restPose.get('Pelvis').position.y, 0), V(0, restPose.get('Pelvis').position.y - .035, -.025), V(0, restPose.get('Pelvis').position.y - .01, -.008), V(0, restPose.get('Pelvis').position.y, 0)]),
    quaternionTrack('DomainPivot', flinchTimes, [q([0, 0, 0]), q([-.10, -.18, -.08]), q([.03, .04, .02]), q([0, 0, 0])]),
  ]));

  const deathTimes = [0, .0875, .25, .475, .725, .975, 1.25], progress = deathTimes.map((time) => time / 1.25);
  const dead = new THREE.AnimationClip('dead', 1.25, [
    vectorTrack('Root', deathTimes, progress.map((value) => V(0, restPose.get('Root').position.y + .34 * ease(value), 0))),
    quaternionTrack('Root', deathTimes, progress.map((value) => q([0, 0, -1.44 * ease(value)]))),
    quaternionTrack('Head', deathTimes, progress.map((value) => q([-.02 - .10 * Math.sin(value * Math.PI), 0, -.035]))),
    quaternionTrack('UpperArmR', deathTimes, progress.map((value) => restPose.get('UpperArmR').quaternion.clone().multiply(q([-1.2 * ease(value), 0, 0])))),
    quaternionTrack('RobeTailR', deathTimes, progress.map((value) => restPose.get('RobeTailR').quaternion.clone().multiply(q([-.4 * ease(value), 0, 0])))),
    quaternionTrack('DomainPivot', deathTimes, progress.map((value) => q([0, value * .8, .12 * Math.sin(value * Math.PI)]))),
  ]);
  clips.push(dead); const revive = reverseClip(dead); revive.name = 'reviveRise'; clips.push(revive);

  const victoryTimes = [0, .45, 1.0, 1.65, 2.15, 2.8];
  clips.push(new THREE.AnimationClip('victory', 2.8, [
    quaternionTrack('Head', victoryTimes, victoryTimes.map((_, index) => q(index > 0 && index < 5 ? [-.10, -.06, -.02] : [-.02, 0, -.035]))),
    quaternionTrack('UpperArmL', victoryTimes, victoryTimes.map((_, index) => q(index > 0 && index < 5 ? [-1.15, 0, .28] : [0, 0, 0]))),
    quaternionTrack('ForearmL', victoryTimes, victoryTimes.map((_, index) => q(index > 0 && index < 5 ? [-.45, 0, 0] : [0, 0, 0]))),
    quaternionTrack('DomainPivot', victoryTimes, victoryTimes.map((time) => q([0, time * .45, 0]))),
  ]));
  return clips;
}
