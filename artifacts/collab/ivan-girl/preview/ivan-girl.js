import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const EPS = 0.0001;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (value) => Math.max(0, Math.min(1, value));
const ease = (value) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const q = (rotation) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));

function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function canvasTexture(color, seed, kind = 'paint', size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  const random = randomSource(seed);
  const base = new THREE.Color(color).convertLinearToSRGB();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const grain = (random() - .5) * (kind === 'fabric' ? 22 : 9);
      const weave = kind === 'fabric' ? ((x % 4 === 0 ? 5 : 0) - (y % 4 === 0 ? 5 : 0)) : 0;
      const wave = Math.sin(x * .27 + Math.sin(y * .11) * 1.7) * (kind === 'metal' ? 5 : 1.5);
      const strands = kind === 'hair' ? Math.sin(x * 2.6 + Math.sin(y * .07) * .6) * 2.5 + Math.sin(x * .55) * 1.2 : 0;
      image.data[index] = Math.max(0, Math.min(255, base.r * 255 + grain + wave + weave + strands));
      image.data[index + 1] = Math.max(0, Math.min(255, base.g * 255 + grain + wave + weave + strands * .72));
      image.data[index + 2] = Math.max(0, Math.min(255, base.b * 255 + grain + wave + weave + strands * .5));
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === 'fabric' ? 3 : 2, kind === 'fabric' ? 3 : 2);
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
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const grain = random();
      heights[y * size + x] = grain;
      const value = kind === 'roughness' ? 145 + grain * 80 : 205 + grain * 50;
      if (kind !== 'normal') image.data[index] = image.data[index + 1] = image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
  }
  if (kind === 'normal') {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const left = heights[y * size + (x + size - 1) % size];
        const right = heights[y * size + (x + 1) % size];
        const up = heights[((y + size - 1) % size) * size + x];
        const down = heights[((y + 1) % size) * size + x];
        const normal = V((left - right) * 1.4, (up - down) * 1.4, 1).normalize();
        const index = (y * size + x) * 4;
        image.data[index] = (normal.x * .5 + .5) * 255;
        image.data[index + 1] = (normal.y * .5 + .5) * 255;
        image.data[index + 2] = (normal.z * .5 + .5) * 255;
      }
    }
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
  const material = new THREE.MeshPhysicalMaterial({
    name,
    color: 0xffffff,
    map: canvasTexture(color, seed, options.kind),
    roughness: options.roughness ?? .65,
    roughnessMap: scalarTexture('roughness', seed + 17),
    metalness: options.metalness ?? 0,
    metalnessMap: scalarTexture('metalness', seed + 31),
    normalMap: scalarTexture('normal', seed + 47),
    normalScale: new THREE.Vector2(options.normal ?? .16, options.normal ?? .16),
    clearcoat: options.clearcoat ?? 0,
    clearcoatRoughness: .5,
    anisotropy: options.anisotropy ?? 0,
    anisotropyRotation: options.anisotropyRotation ?? 0,
    side: options.kind === 'hair' ? THREE.DoubleSide : THREE.FrontSide,
  });
  return material;
}

function createMaterials() {
  return {
    dress: pbrMaterial('ochre_cotton_dress', '#a96328', { seed: 3, kind: 'fabric', roughness: .88, normal: .26 }),
    dressDark: pbrMaterial('dress_seam_and_hem', '#71431f', { seed: 7, kind: 'fabric', roughness: .9, normal: .2 }),
    apron: pbrMaterial('warm_linen_apron', '#ead7ad', { seed: 11, kind: 'fabric', roughness: .92, normal: .24 }),
    apronSeam: pbrMaterial('apron_stitching', '#bca47b', { seed: 13, kind: 'fabric', roughness: .94 }),
    skin: pbrMaterial('warm_skin', '#efc5a1', { seed: 17, roughness: .64, clearcoat: .06, normal: .08 }),
    hair: pbrMaterial('chestnut_hair', '#573421', { seed: 19, kind: 'hair', roughness: .78, clearcoat: .025, anisotropy: .16, anisotropyRotation: Math.PI / 2, normal: .06 }),
    hairDark: pbrMaterial('chestnut_hair_shadow', '#382317', { seed: 21, kind: 'hair', roughness: .84, clearcoat: .015, anisotropy: .12, anisotropyRotation: Math.PI / 2 }),
    hairLight: pbrMaterial('hair_highlights', '#754a2c', { seed: 23, kind: 'hair', roughness: .74, clearcoat: .035, anisotropy: .18, anisotropyRotation: Math.PI / 2 }),
    leather: pbrMaterial('satchel_leather', '#5b3424', { seed: 29, kind: 'fabric', roughness: .78, normal: .24 }),
    shoe: pbrMaterial('mary_jane_leather', '#39281f', { seed: 31, kind: 'fabric', roughness: .42, clearcoat: .28 }),
    iron: pbrMaterial('bomb_painted_iron', '#303b35', { seed: 37, kind: 'metal', roughness: .36, metalness: .72, clearcoat: .24, normal: .12 }),
    brass: pbrMaterial('aged_brass', '#c69b50', { seed: 41, kind: 'metal', roughness: .3, metalness: .88, normal: .1 }),
    ribbon: new THREE.MeshStandardMaterial({ name: 'red_hair_ribbon', color: '#b83831', roughness: .68 }),
    eye: new THREE.MeshStandardMaterial({ name: 'dark_brown_eyes', color: '#241811', roughness: .28 }),
    eyeWhite: new THREE.MeshStandardMaterial({ name: 'warm_eye_white', color: '#fff1d9', roughness: .4 }),
    blush: new THREE.MeshStandardMaterial({ name: 'soft_blush', color: '#d98b78', roughness: .82 }),
    mouth: new THREE.MeshStandardMaterial({ name: 'smile', color: '#914f45', roughness: .72 }),
    warning: new THREE.MeshStandardMaterial({ name: 'warning_yellow', color: '#e7bd55', roughness: .48, metalness: .25 }),
    ember: new THREE.MeshStandardMaterial({ name: 'fuse_ember', color: '#ffcf65', emissive: '#ff5a0a', emissiveIntensity: 3.2, roughness: .3 }),
  };
}

function rounded(width, height, depth, radius = .02) {
  return new RoundedBoxGeometry(width, height, depth, 2, radius);
}

function loft(rings, sides = 20) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row < rings.length; row++) {
    const [y, rx, rz, z = 0] = rings[row];
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * TAU;
      positions.push(Math.cos(angle) * rx, y, Math.sin(angle) * rz + z);
      uvs.push(side / sides, row / (rings.length - 1));
    }
  }
  for (let row = 0; row < rings.length - 1; row++) {
    for (let side = 0; side < sides; side++) {
      const a = row * (sides + 1) + side;
      const b = a + sides + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  for (const [row, reverse] of [[0, true], [rings.length - 1, false]]) {
    const center = positions.length / 3;
    positions.push(0, rings[row][0], rings[row][3] ?? 0);
    uvs.push(.5, .5);
    for (let side = 0; side < sides; side++) {
      const a = row * (sides + 1) + side;
      if (reverse) indices.push(center, a + 1, a);
      else indices.push(center, a, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function plate(points, depth = .008) {
  const shape = new THREE.Shape();
  shape.moveTo(...points[0]);
  points.slice(1).forEach((point) => shape.lineTo(...point));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: .002, bevelThickness: .002, bevelSegments: 1 });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function hairCapPoint(theta, phi, lift = 0) {
  const sine = Math.sin(theta);
  const ripple = 1 + Math.sin(phi * 3 + theta * 5) * .004 + Math.sin(phi * 7 - theta * 4) * .002;
  const point = V(
    Math.cos(phi) * sine * .202 * ripple - .010 * (1 - sine),
    .108 + Math.cos(theta) * .194 + Math.sin(phi * 2) * sine * .003,
    -.008 + Math.sin(phi) * sine * .204 * ripple - .004 * Math.max(0, -Math.sin(phi)),
  );
  return point.add(V(point.x, point.y - .108, point.z + .008).normalize().multiplyScalar(lift));
}

function hairCapGeometry() {
  const rows = 42;
  const columns = 64;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row <= rows; row++) {
    const theta = row / rows * 1.84;
    for (let column = 0; column <= columns; column++) {
      const phi = column / columns * TAU;
      const point = hairCapPoint(theta, phi);
      positions.push(point.x, point.y, point.z);
      uvs.push(column / columns, row / rows);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column;
      const b = a + columns + 1;
      const center = hairCapPoint((row + .5) / rows * 1.84, (column + .5) / columns * TAU);
      if (!(center.z > .022 && center.y < .180)) indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function taperedLock(points, startRadius, endRadius = .0015, segments = 16, sides = 8, flatten = .72) {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(segments, false);
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row <= segments; row++) {
    const t = row / segments;
    const center = curve.getPointAt(t);
    const radius = startRadius * Math.pow(1 - t, .68) + endRadius * t;
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * TAU;
      const point = center.clone()
        .addScaledVector(frames.normals[row], Math.cos(angle) * radius)
        .addScaledVector(frames.binormals[row], Math.sin(angle) * radius * flatten);
      positions.push(point.x, point.y, point.z);
      uvs.push(side / sides, t);
    }
  }
  for (let row = 0; row < segments; row++) {
    for (let side = 0; side < sides; side++) {
      const a = row * (sides + 1) + side;
      const b = a + sides + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function hairRibbonGeometry(points, width, segments = 18) {
  const curve = new THREE.CatmullRomCurve3(points);
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row <= segments; row++) {
    const t = row / segments;
    const center = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const normal = center.clone().sub(V(0, .108, -.008));
    normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
    if (normal.lengthSq() < .1) normal.set(0, 0, 1);
    const across = new THREE.Vector3().crossVectors(tangent, normal).normalize();
    const taper = width * (1 - .84 * t) * (.92 + .08 * Math.sin(t * Math.PI));
    for (let column = 0; column < 3; column++) {
      const offset = column - 1;
      const point = center.clone()
        .addScaledVector(across, offset * taper)
        .addScaledVector(normal, .0035 * (1 - offset * offset));
      positions.push(point.x, point.y, point.z);
      uvs.push(column / 2, t);
    }
  }
  for (let row = 0; row < segments; row++) {
    for (let column = 0; column < 2; column++) {
      const a = row * 3 + column;
      const b = a + 3;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function limbGeometry(points, radiusStops, range = [0, 1], segments = 40, sides = 14) {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(segments, false);
  const split = points[0].distanceTo(points[1]) / curve.getLength();
  const positions = [];
  const uvs = [];
  const weights = [];
  const indices = [];
  for (let row = 0; row <= segments; row++) {
    const t = row / segments;
    const center = curve.getPointAt(t);
    let radius = radiusStops[radiusStops.length - 1][1];
    for (let index = 0; index < radiusStops.length - 1; index++) {
      const [startT, startRadius] = radiusStops[index];
      const [endT, endRadius] = radiusStops[index + 1];
      if (t >= startT && t <= endT) {
        radius = THREE.MathUtils.lerp(startRadius, endRadius, (t - startT) / Math.max(.00001, endT - startT));
        break;
      }
    }
    const firstBlend = t < split ? t / split : 1;
    const secondBlend = t > split ? (t - split) / (1 - split) : 0;
    const smoothFirst = ease(firstBlend);
    const smoothSecond = ease(secondBlend);
    const chainWeights = t <= split
      ? [1 - smoothFirst, smoothFirst, 0]
      : [0, 1 - smoothSecond, smoothSecond];
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * TAU;
      const point = center.clone()
        .addScaledVector(frames.normals[row], Math.cos(angle) * radius)
        .addScaledVector(frames.binormals[row], Math.sin(angle) * radius);
      positions.push(point.x, point.y, point.z);
      uvs.push(side / sides, t);
      weights.push(...chainWeights);
    }
  }
  for (let row = 0; row < segments; row++) {
    const midpoint = (row + .5) / segments;
    if (midpoint < range[0] || midpoint > range[1]) continue;
    for (let side = 0; side < sides; side++) {
      const a = row * (sides + 1) + side;
      const b = a + sides + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('chainWeights', new THREE.Float32BufferAttribute(weights, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function quaternionTrack(name, times, quaternions) {
  return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, quaternions.flatMap((value) => value.toArray()));
}

function vectorTrack(name, times, vectors) {
  return new THREE.VectorKeyframeTrack(`${name}.position`, times, vectors.flatMap((value) => value.toArray()));
}

function scaleTrack(name, times, scales) {
  return new THREE.VectorKeyframeTrack(`${name}.scale`, times, scales.flatMap((value) => Array.isArray(value) ? value : typeof value === 'number' ? [value, value, value] : value.toArray()));
}

function reverseClip(clip) {
  const tracks = clip.tracks.map((track) => {
    const stride = track.values.length / track.times.length;
    const times = [...track.times].reverse().map((time) => clip.duration - time);
    const values = [];
    for (let index = track.values.length - stride; index >= 0; index -= stride) values.push(...track.values.slice(index, index + stride));
    return new track.constructor(track.name, times, values);
  });
  const reversed = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  return reversed;
}

function solveArm(context, side, target, bendDirection, parentPosition, parentQuaternion) {
  const { upper, forearm, hand } = context[side];
  const { restPose } = context;
  const shoulder = upper.position.clone().applyQuaternion(parentQuaternion).add(parentPosition);
  const upperRest = restPose.get(upper.name);
  const lowerRest = restPose.get(forearm.name);
  const upperLength = forearm.position.length();
  const lowerLength = hand.position.length();
  const toTarget = target.clone().sub(shoulder);
  const distance = Math.min(toTarget.length(), upperLength + lowerLength - .00001);
  const direction = toTarget.normalize();
  const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const bend = bendDirection.clone().addScaledVector(direction, -bendDirection.dot(direction)).normalize();
  const elbow = shoulder.clone().addScaledVector(direction, along).addScaledVector(bend, height);
  const upperDirection = elbow.clone().sub(shoulder).normalize();
  const lowerDirection = target.clone().sub(elbow).normalize();
  const upperBaseWorld = parentQuaternion.clone().multiply(upperRest.quaternion);
  const upperOffset = forearm.position.clone().normalize().applyQuaternion(upperBaseWorld).normalize();
  const upperWorld = new THREE.Quaternion().setFromUnitVectors(upperOffset, upperDirection).multiply(upperBaseWorld);
  const upperLocal = parentQuaternion.clone().invert().multiply(upperWorld);
  const lowerBaseWorld = upperWorld.clone().multiply(lowerRest.quaternion);
  const lowerOffset = hand.position.clone().normalize().applyQuaternion(lowerBaseWorld).normalize();
  const lowerWorld = new THREE.Quaternion().setFromUnitVectors(lowerOffset, lowerDirection).multiply(lowerBaseWorld);
  const lowerLocal = upperWorld.clone().invert().multiply(lowerWorld);
  const desiredHandWorld = parentQuaternion.clone();
  const handLocal = lowerWorld.clone().invert().multiply(desiredHandWorld);
  return { upper: upperLocal, forearm: lowerLocal, hand: handLocal };
}

export function skinnedBounds(root) {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  root.updateMatrixWorld(true);
  root.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    mesh.skeleton.update();
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    for (let index = 0; index < position.count; index++) {
      const point = new THREE.Vector3().fromBufferAttribute(position, index);
      mesh.applyBoneTransform(index, point);
      point.applyMatrix4(mesh.matrixWorld);
      min.min(point);
      max.max(point);
    }
  });
  return { min, max, size: max.clone().sub(min) };
}

export function createIvanGirl() {
  const materials = createMaterials();
  const root = new THREE.Group();
  root.name = 'IvanGirl';
  root.userData = {
    visualId: 'ivan-girl-v2', suggestedCharId: 'ivan-girl', upAxis: '+Y', forwardAxis: '+Z', units: 'meters',
    author: 'HungerG local procedural asset pipeline', license: 'project-internal procedural source', externalCredentialsUsed: false,
  };
  const bones = [];
  const boneMap = new Map();
  const addBone = (name, parent, position) => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.copy(position);
    parent.add(bone);
    bones.push(bone);
    boneMap.set(name, bone);
    return bone;
  };
  const Root = addBone('Root', root, V(0, 0, 0));
  const Pelvis = addBone('Pelvis', Root, V(0, .70, 0));
  const Spine = addBone('Spine', Pelvis, V(0, .12, 0));
  const Chest = addBone('Chest', Spine, V(0, .17, 0));
  const Neck = addBone('Neck', Chest, V(0, .19, 0));
  const Head = addBone('Head', Neck, V(0, .10, 0));
  Head.rotation.set(-.018, .025, -.028);
  const PigtailL1 = addBone('PigtailL1', Head, V(-.172, .15, -.018));
  const PigtailL2 = addBone('PigtailL2', PigtailL1, V(-.018, -.115, .006));
  const PigtailL3 = addBone('PigtailL3', PigtailL2, V(-.014, -.108, .008));
  const PigtailR1 = addBone('PigtailR1', Head, V(.172, .15, -.018));
  const PigtailR2 = addBone('PigtailR2', PigtailR1, V(.018, -.115, .006));
  const PigtailR3 = addBone('PigtailR3', PigtailR2, V(.014, -.108, .008));
  PigtailL1.rotation.z = -.10;
  PigtailR1.rotation.z = .13;
  PigtailL2.rotation.z = -.08;
  PigtailR2.rotation.z = .05;
  const EyeL = addBone('EyeL', Head, V(-.061, .125, .166));
  const EyeR = addBone('EyeR', Head, V(.061, .125, .166));
  const EyelidL = addBone('EyelidL', Head, V(-.061, .143, .186));
  const EyelidR = addBone('EyelidR', Head, V(.061, .143, .186));
  EyelidL.scale.y = EyelidR.scale.y = .07;
  const Mouth = addBone('Mouth', Head, V(0, .044, .175));
  const HeldBomb = addBone('HeldBomb', Chest, V(-.012, -.02, .25));
  const ThrownBomb = addBone('ThrownBomb', Root, V(0, 0, 0));
  const FuseSpark = addBone('FuseSpark', ThrownBomb, V(.047, .205, .015));
  const armContext = {};
  for (const side of ['L', 'R']) {
    const sign = side === 'L' ? -1 : 1;
    const upper = addBone(`UpperArm${side}`, Chest, V(sign * .195, .095, 0));
    const forearm = addBone(`Forearm${side}`, upper, V(0, -.215, 0));
    const hand = addBone(`Hand${side}`, forearm, V(0, -.195, 0));
    armContext[side] = { upper, forearm, hand };
  }
  const legContext = {};
  for (const side of ['L', 'R']) {
    const sign = side === 'L' ? -1 : 1;
    const thigh = addBone(`Thigh${side}`, Pelvis, V(sign * .098, -.02, 0));
    const shin = addBone(`Shin${side}`, thigh, V(0, -.29, 0));
    const foot = addBone(`Foot${side}`, shin, V(0, -.3195, .012));
    legContext[side] = { thigh, shin, foot };
  }

  root.updateMatrixWorld(true);
  const initialRest = new Map(bones.map((bone) => [bone.name, { position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }]));
  const gripLocal = { L: V(-.132, -.025, .035), R: V(.132, -.025, .035) };
  const bombWorld = HeldBomb.getWorldPosition(new THREE.Vector3());
  const chestWorld = Chest.getWorldPosition(new THREE.Vector3());
  const chestQuaternion = Chest.getWorldQuaternion(new THREE.Quaternion());
  for (const side of ['L', 'R']) {
    const target = gripLocal[side].clone().add(bombWorld).sub(chestWorld).add(chestWorld);
    const pose = solveArm({ ...armContext, restPose: initialRest }, side, target, V(side === 'L' ? -.8 : .8, -.4, .5), chestWorld, chestQuaternion);
    armContext[side].upper.quaternion.copy(pose.upper);
    armContext[side].forearm.quaternion.copy(pose.forearm);
    armContext[side].hand.quaternion.copy(pose.hand);
  }
  root.updateMatrixWorld(true);
  const restPose = new Map(bones.map((bone) => [bone.name, { position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }]));

  const parts = [];
  let hairLockCount = 0;
  const part = (parent, boneName, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], skin = null) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${boneName}_part_${parts.length}`;
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.scale.set(...scale);
    parent.add(mesh);
    parts.push({ mesh, boneName, skin });
    return mesh;
  };
  const segment = (parent, boneName, start, end, radiusStart, radiusEnd, material, sides = 14, skin = null) => {
    const direction = end.clone().sub(start);
    const mesh = part(parent, boneName, new THREE.CylinderGeometry(radiusEnd, radiusStart, direction.length(), sides), material, start.clone().add(end).multiplyScalar(.5).toArray(), [0, 0, 0], [1, 1, 1], skin);
    mesh.quaternion.setFromUnitVectors(V(0, 1, 0), direction.clone().normalize());
    return mesh;
  };
  const tube = (parent, boneName, points, radius, material, segments = 16) => part(parent, boneName, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, radius, 6, false), material);
  const hairLock = (parent, boneName, points, radius, material, skin = null, endRadius = .0015, segments = 16, sides = 8) => {
    hairLockCount++;
    return part(parent, boneName, taperedLock(points, radius, endRadius, segments, sides), material, [0, 0, 0], [0, 0, 0], [1, 1, 1], skin);
  };
  const hairRibbon = (points, width, material, segments = 18) => {
    hairLockCount++;
    return part(Head, 'Head', hairRibbonGeometry(points, width, segments), material);
  };
  const combedPoints = (startTheta, startPhi, endTheta, endPhi, lift, bend = 0) => {
    const delta = Math.atan2(Math.sin(endPhi - startPhi), Math.cos(endPhi - startPhi));
    return Array.from({ length: 7 }, (_, index) => {
      const t = index / 6;
      return hairCapPoint(
        THREE.MathUtils.lerp(startTheta, endTheta, t),
        startPhi + delta * t + bend * Math.sin(t * Math.PI),
        lift + Math.sin(t * Math.PI) * .001,
      );
    });
  };

  part(Pelvis, 'Pelvis', loft([[.09, .14, .115], [.015, .165, .13], [-.09, .205, .15], [-.22, .248, .175], [-.33, .274, .19]], 24), materials.dress);
  part(Pelvis, 'Pelvis', loft([[.09, .142, .117], [-.325, .277, .193], [-.342, .279, .192]], 24), materials.dressDark);
  part(Spine, 'Spine', loft([[-.04, .132, .105], [.08, .142, .112], [.16, .15, .116]], 20), materials.dress);
  part(Spine, 'Spine', new THREE.CylinderGeometry(.148, .165, .18, 20), materials.dress, [0, -.015, 0], [0, 0, 0], [1, 1, .76]);
  part(Chest, 'Chest', loft([[-.12, .142, .112], [.04, .158, .12], [.13, .145, .108]], 20), materials.dress);
  part(Chest, 'Chest', plate([[-.075, .12], [.075, .12], [.09, -.12], [-.09, -.12]], .009), materials.apron, [0, -.015, .122]);
  part(Pelvis, 'Pelvis', plate([[-.115, .02], [.115, .02], [.175, -.29], [-.175, -.29]], .01), materials.apron, [0, -.015, .181]);
  for (const side of [-1, 1]) {
    part(Chest, 'Chest', rounded(.022, .25, .012, .005), materials.apron, [side * .078, .005, .135], [0, 0, side * -.08]);
    part(Pelvis, 'Pelvis', rounded(.012, .27, .012, .004), materials.apronSeam, [side * .155, -.16, .193], [0, 0, side * -.12]);
    part(Pelvis, 'Pelvis', rounded(.13, .018, .012, .004), materials.apronSeam, [side * .084, -.305, .2], [0, 0, side * .05]);
  }
  part(Pelvis, 'Pelvis', rounded(.17, .115, .025, .018), materials.apron, [0, -.145, .198]);
  part(Pelvis, 'Pelvis', rounded(.15, .012, .012, .003), materials.apronSeam, [0, -.09, .215]);
  for (let index = 0; index < 3; index++) part(Chest, 'Chest', new THREE.SphereGeometry(.012, 10, 8), materials.brass, [0, .055 - index * .065, .139], [0, 0, 0], [1, 1, .45]);
  part(Neck, 'Neck', new THREE.CylinderGeometry(.048, .055, .11, 14), materials.skin);
  part(Chest, 'Chest', plate([[-.10, .11], [-.025, .15], [0, .10], [.025, .15], [.10, .11], [.045, .065], [-.045, .065]], .008), materials.apron, [0, .10, .116]);

  for (const side of ['L', 'R']) {
    const sign = side === 'L' ? -1 : 1;
    const { upper, forearm, hand } = armContext[side];
    const armPoints = [V(0, 0, 0), forearm.position.clone(), hand.position.clone().add(forearm.position)];
    const armBones = [upper.name, forearm.name, hand.name];
    part(upper, upper.name, new THREE.SphereGeometry(.082, 16, 12), materials.dress, [0, -.018, 0], [0, 0, 0], [1.08, 1.18, 1]);
    part(upper, upper.name, limbGeometry(armPoints, [[0, .082], [.34, .054], [.52, .041], [1, .030]], [0, .40]), materials.dress, [0, 0, 0], [0, 0, 0], [1, 1, 1], { names: armBones });
    part(upper, upper.name, limbGeometry(armPoints, [[0, .080], [.34, .047], [.52, .040], [1, .029]], [.34, 1]), materials.skin, [0, 0, 0], [0, 0, 0], [1, 1, 1], { names: armBones });
    part(upper, upper.name, new THREE.TorusGeometry(.052, .008, 6, 16), materials.apronSeam, [0, -.158, 0], [Math.PI / 2, 0, 0]);
    part(hand, hand.name, new THREE.SphereGeometry(.041, 14, 10), materials.skin, [0, -.012, .006], [0, 0, 0], [.85, 1.15, .7]);
    for (let index = 0; index < 3; index++) part(hand, hand.name, rounded(.012, .037, .014, .005), materials.skin, [(index - 1) * .016, -.042, .012], [0, 0, (index - 1) * .06]);
    part(hand, hand.name, new THREE.SphereGeometry(.016, 10, 8), materials.skin, [-sign * .029, -.018, .014], [0, 0, sign * .45], [.8, 1.25, .8]);
  }

  for (const side of ['L', 'R']) {
    const { thigh, shin, foot } = legContext[side];
    const legPoints = [V(0, 0, 0), shin.position.clone(), foot.position.clone().add(shin.position)];
    const legBones = [thigh.name, shin.name, foot.name];
    part(thigh, thigh.name, limbGeometry(legPoints, [[0, .052], [.48, .047], [.58, .044], [1, .037]], [0, .58]), materials.skin, [0, 0, 0], [0, 0, 0], [1, 1, 1], { names: legBones });
    part(thigh, thigh.name, limbGeometry(legPoints, [[0, .051], [.48, .046], [.58, .043], [1, .037]], [.50, 1]), materials.apron, [0, 0, 0], [0, 0, 0], [1, 1, 1], { names: legBones });
    part(shin, shin.name, new THREE.TorusGeometry(.043, .009, 6, 16), materials.apronSeam, [0, -.115, 0], [Math.PI / 2, 0, 0]);
    part(foot, foot.name, rounded(.125, .09, .225, .035), materials.shoe, [0, -.018, .06]);
    part(foot, foot.name, rounded(.13, .025, .23, .01), materials.dressDark, [0, -.058, .06]);
    part(foot, foot.name, rounded(.105, .018, .055, .008), materials.shoe, [0, .025, .075], [.12, 0, 0]);
    part(foot, foot.name, rounded(.026, .012, .012, .004), materials.brass, [foot === legContext.L.foot ? -.052 : .052, .027, .085]);
  }

  part(Head, 'Head', new THREE.SphereGeometry(.175, 32, 24), materials.skin, [0, .105, .012], [0, 0, 0], [1, 1.08, .94]);
  for (const side of [-1, 1]) part(Head, 'Head', new THREE.SphereGeometry(.034, 14, 10), materials.skin, [side * .17, .105, .005], [0, 0, 0], [.65, 1, .8]);
  part(Head, 'Head', hairCapGeometry(), materials.hair);
  const hairPalette = [materials.hair, materials.hair, materials.hair, materials.hairLight];
  for (let index = 0; index < 44; index++) {
    const startTheta = .30 + (index % 4) * .035;
    const startPhi = 2.82 + Math.sin(index * 1.71) * .08;
    const endTheta = .62 + ((index * 7) % 11) / 11 * .62;
    const endPhi = index / 44 * TAU + Math.sin(index * 2.13) * .025;
    const direction = Math.sign(Math.atan2(Math.sin(endPhi - startPhi), Math.cos(endPhi - startPhi)) || 1);
    hairRibbon(combedPoints(startTheta, startPhi, endTheta, endPhi, .005, direction * .065), .0095 + (index % 4) * .0012, hairPalette[index % hairPalette.length]);
  }
  for (let index = 0; index < 26; index++) {
    const startTheta = .48 + (index % 3) * .045;
    const startPhi = 2.86 + Math.sin(index * 1.37) * .10;
    const endTheta = 1.28 + (index % 5) * .095;
    const endPhi = Math.PI + index / 26 * Math.PI;
    hairRibbon(combedPoints(startTheta, startPhi, endTheta, endPhi, .006, -.05), .0115 + (index % 3) * .0015, hairPalette[(index + 1) % hairPalette.length]);
  }
  for (let index = 0; index < 38; index++) {
    const t = index / 37;
    const x = (t - .5) * .34;
    const arch = Math.sin(t * Math.PI);
    const startTheta = .42 + Math.abs(x) * 1.4;
    const startPhi = Math.acos(THREE.MathUtils.clamp(x * .65 / (.202 * Math.sin(startTheta)), -1, 1));
    const sweep = .022 + .035 * (1 - t);
    const endX = THREE.MathUtils.clamp(x + sweep, -.185, .185);
    const variation = Math.sin(index * 2.17) * .065 + Math.sin(index * .71) * .035;
    const endTheta = THREE.MathUtils.clamp(.92 + arch * .20 + variation, .84, 1.16);
    const endPhi = Math.acos(THREE.MathUtils.clamp(endX / (.202 * Math.sin(endTheta)), -1, 1));
    hairRibbon(combedPoints(startTheta, startPhi, endTheta, endPhi, .007, .07 * (1 - t)), .0095 + arch * .004, hairPalette[index % hairPalette.length]);
    if (index % 2 === 0) {
      hairRibbon(combedPoints(startTheta - .025, startPhi + .012, endTheta + .015, endPhi - .018, .010, .07 * (1 - t)), .0026, materials.hairLight, 16);
    }
  }
  for (const side of [-1, 1]) {
    for (let index = 0; index < 9; index++) {
      const startPhi = side > 0 ? .05 + index * .055 : Math.PI - .05 - index * .055;
      const endPhi = side > 0 ? -.25 + index * .07 : Math.PI + .25 - index * .07;
      hairRibbon(combedPoints(.62 + index * .035, startPhi, 1.69 + Math.sin(index) * .04, endPhi, .006, side * .035), .0105 + (index % 3) * .0015, hairPalette[(index + (side > 0 ? 1 : 2)) % hairPalette.length]);
    }
  }
  for (const side of [-1, 1]) {
    const first = side < 0 ? PigtailL1 : PigtailR1;
    const second = side < 0 ? PigtailL2 : PigtailR2;
    const third = side < 0 ? PigtailL3 : PigtailR3;
    hairLock(first, first.name, [V(0, .008, 0), V(side * .012, -.052, .004), V(side * .022, -.120, .008)], .036, materials.hairDark, { childBone: second.name, direction: 'down', maxWeight: .52 }, .014, 14, 7);
    hairLock(second, second.name, [V(0, .004, 0), V(side * .014, -.056, .005), V(side * .024, -.116, .008)], .031, materials.hair, { childBone: third.name, direction: 'down', maxWeight: .58 }, .012, 14, 7);
    hairLock(third, third.name, [V(0, .002, 0), V(side * .018, -.070, .006), V(side * .030, -.144, .010), V(side * .042, -.208, .014)], .026, materials.hairDark, null, .0015, 16, 7);
    part(first, first.name, new THREE.TorusGeometry(.047, .010, 7, 18), materials.ribbon, [0, 0, 0], [Math.PI / 2, 0, 0]);
    part(first, first.name, new THREE.SphereGeometry(.031, 12, 8), materials.ribbon, [side * .035, -.008, .014], [0, 0, side * .35], [1.25, .70, .55]);
    part(first, first.name, new THREE.SphereGeometry(.029, 12, 8), materials.ribbon, [-side * .027, .012, .010], [0, 0, -side * .25], [1.20, .66, .52]);
    part(first, first.name, plate([[0, 0], [side * .032, -.072], [side * .010, -.060]], .005), materials.ribbon, [side * .018, -.018, .022], [0, side * .18, side * -.12]);
    part(first, first.name, plate([[0, 0], [side * .045, -.052], [side * .020, -.044]], .005), materials.ribbon, [-side * .012, -.014, .026], [0, -side * .22, side * .16]);

    for (let index = 0; index < 6; index++) {
      const angle = index / 6 * TAU;
      const spread = .014 + (index % 2) * .006;
      hairLock(first, first.name, [
        V(Math.cos(angle) * .022, .006, Math.sin(angle) * .018),
        V(side * .010 + Math.cos(angle) * spread, -.055, Math.sin(angle) * spread),
        V(side * .018 + Math.cos(angle) * .020, -.118, .006 + Math.sin(angle) * .019),
      ], .026, [materials.hair, materials.hairDark, materials.hairLight][index % 3], { childBone: second.name, direction: 'down', maxWeight: .58 }, .010, 13, 7);
    }
    for (let index = 0; index < 7; index++) {
      const angle = index / 7 * TAU + .2;
      const spread = .020 + (index % 3) * .006;
      hairLock(second, second.name, [
        V(Math.cos(angle) * .018, .004, Math.sin(angle) * .016),
        V(side * .012 + Math.cos(angle) * spread, -.052, .004 + Math.sin(angle) * spread),
        V(side * .014 + Math.cos(angle) * .026, -.112, .008 + Math.sin(angle) * .024),
      ], .025, [materials.hairLight, materials.hair, materials.hairDark][index % 3], { childBone: third.name, direction: 'down', maxWeight: .64 }, .008, 13, 7);
    }
    for (let index = 0; index < 9; index++) {
      const fan = (index - 4) / 4;
      const angle = index * 2.399;
      hairLock(third, third.name, [
        V(Math.cos(angle) * .016, .002, Math.sin(angle) * .014),
        V(side * (.014 + Math.abs(fan) * .016) + Math.cos(angle) * .018, -.070, .008 + Math.sin(angle) * .020),
        V(side * (.030 + Math.abs(fan) * .050) + Math.cos(angle) * .012, -.148 - (index % 3) * .014, .014 + fan * .034),
        V(side * (.046 + Math.abs(fan) * .068), -.205 - (index % 4) * .012, .020 + fan * .046),
      ], .023, [materials.hair, materials.hairLight, materials.hairDark, materials.hair][index % 4], null, .0012, 17, 7);
    }
  }
  for (const side of [-1, 1]) {
    const eye = side < 0 ? EyeL : EyeR;
    const eyelid = side < 0 ? EyelidL : EyelidR;
    part(eye, eye.name, new THREE.SphereGeometry(.031, 18, 12), materials.eyeWhite, [0, 0, 0], [0, 0, side * -.04], [1, 1.18, .35]);
    part(eye, eye.name, new THREE.SphereGeometry(.015, 16, 10), materials.eye, [side * .002, -.002, .013], [0, 0, 0], [.90, 1.10, .35]);
    part(eye, eye.name, new THREE.SphereGeometry(.0045, 8, 6), materials.eyeWhite, [-.004, .005, .019]);
    hairLock(Head, 'Head', [V(side * .030, .174, .158), V(side * .062, .180, .164), V(side * .098, .169, .151)], .0062, materials.hairDark, null, .0012, 10, 5);
    for (let index = 0; index < 3; index++) tube(eye, eye.name, [V(side * (.012 + index * .004), .014 - index * .003, .014), V(side * (.026 + index * .003), .019 - index * .004, .010)], .0014, materials.hairDark, 5);
    part(eyelid, eyelid.name, new THREE.SphereGeometry(1, 18, 12), materials.skin, [0, 0, 0], [0, 0, 0], [.034, .040, .008]);
    part(Head, 'Head', new THREE.SphereGeometry(.023, 12, 8), materials.blush, [side * .102, .077, .147], [0, 0, 0], [1.25, .55, .22]);
  }
  part(Head, 'Head', new THREE.SphereGeometry(.016, 14, 10), materials.skin, [0, .086, .184], [0, 0, 0], [.85, 1, .9]);
  tube(Mouth, 'Mouth', [V(-.027, .005, -.009), V(0, -.005, 0), V(.027, .005, -.009)], .0038, materials.mouth, 12);

  tube(Chest, 'Chest', [V(-.14, .13, .12), V(-.08, .015, .14), V(.05, -.12, .14), V(.17, -.20, .10)], .014, materials.leather, 18);
  part(Pelvis, 'Pelvis', rounded(.15, .18, .09, .025), materials.leather, [.205, -.04, .055], [0, -.12, -.08]);
  part(Pelvis, 'Pelvis', rounded(.12, .07, .012, .012), materials.leather, [.205, -.015, .105], [0, -.12, -.08]);
  part(Pelvis, 'Pelvis', rounded(.035, .045, .014, .006), materials.brass, [.205, -.015, .114], [0, -.12, -.08]);
  part(Pelvis, 'Pelvis', new THREE.TorusGeometry(.024, .005, 6, 14), materials.brass, [.205, -.10, .107]);

  const addBomb = (parent, boneName, withLitFuse) => {
    part(parent, boneName, new THREE.SphereGeometry(.158, 28, 20), materials.iron, [0, 0, 0], [0, 0, 0], [1, 1.06, 1]);
    part(parent, boneName, new THREE.CylinderGeometry(.159, .159, .034, 28), materials.brass, [0, 0, 0]);
    part(parent, boneName, new THREE.CylinderGeometry(.052, .061, .045, 16), materials.brass, [0, .164, 0]);
    tube(parent, boneName, [V(0, .183, 0), V(.012, .205, .005), V(.037, .211, .012), V(.054, .202, .02)], .009, materials.leather, 12);
    if (withLitFuse) part(parent, boneName, new THREE.SphereGeometry(.013, 10, 8), materials.ember, [.054, .204, .02]);
    part(parent, boneName, new THREE.TorusGeometry(.028, .006, 6, 18), materials.warning, [0, .005, .156]);
    for (let index = 0; index < 3; index++) {
      const angle = index / 3 * TAU - Math.PI / 2;
      const sector = new THREE.CircleGeometry(.024, 10, angle - .45, .9);
      part(parent, boneName, sector, materials.warning, [Math.cos(angle) * .045, .005 + Math.sin(angle) * .045, .158]);
    }
    part(parent, boneName, new THREE.SphereGeometry(.009, 8, 6), materials.warning, [0, .005, .16]);
  };
  addBomb(HeldBomb, 'HeldBomb', true);
  addBomb(ThrownBomb, 'ThrownBomb', false);
  part(FuseSpark, 'FuseSpark', new THREE.IcosahedronGeometry(.022, 1), materials.ember, [0, 0, 0], [0, 0, 0], [.7, 1.4, .7]);
  for (let index = 0; index < 3; index++) part(FuseSpark, 'FuseSpark', new THREE.SphereGeometry(.005, 6, 4), materials.ember, [Math.cos(index * 2.1) * .027, .02 + index * .012, Math.sin(index * 2.1) * .027]);

  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const boneIndices = new Map(bones.map((bone, index) => [bone.name, index]));
  const geometryGroups = new Map();
  for (const item of parts) {
    let geometry = item.mesh.geometry.clone();
    if (geometry.index) geometry = geometry.toNonIndexed();
    for (const attribute of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv', 'chainWeights'].includes(attribute)) geometry.deleteAttribute(attribute);
    if (!geometry.attributes.uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
    let blendValues = null;
    if (item.skin && !item.skin.names) {
      geometry.computeBoundingBox();
      const { min, max } = geometry.boundingBox;
      const position = geometry.attributes.position;
      blendValues = new Float32Array(position.count);
      for (let index = 0; index < position.count; index++) {
        const along = item.skin.direction === 'down' ? max.y - position.getY(index) : position.getY(index) - min.y;
        const t = clamp(along / Math.max(.00001, max.y - min.y));
        blendValues[index] = t * t * (3 - 2 * t) * item.skin.maxWeight;
      }
      geometry.setAttribute('skinBlend', new THREE.Float32BufferAttribute(blendValues, 1));
    }
    geometry.applyMatrix4(item.mesh.matrixWorld);
    const indexed = mergeVertices(geometry, 1e-5);
    const blend = indexed.getAttribute('skinBlend')?.array ?? null;
    const chainWeights = indexed.getAttribute('chainWeights')?.array ?? null;
    indexed.deleteAttribute('skinBlend');
    indexed.deleteAttribute('chainWeights');
    geometry.dispose();
    if (!geometryGroups.has(item.mesh.material)) geometryGroups.set(item.mesh.material, []);
    geometryGroups.get(item.mesh.material).push({ geometry: indexed, boneName: item.boneName, childBone: item.skin?.childBone, blend, chainNames: item.skin?.names, chainWeights });
    item.mesh.removeFromParent();
  }
  ThrownBomb.scale.setScalar(EPS);
  restPose.get('ThrownBomb').scale.setScalar(EPS);
  root.updateMatrixWorld(true);
  let triangles = 0;
  let vertices = 0;
  let blendedVertices = 0;
  for (const [material, entries] of geometryGroups) {
    const geometries = entries.map((entry) => {
      const geometry = entry.geometry.clone();
      const count = geometry.attributes.position.count;
      const skinIndices = new Uint8Array(count * 4);
      const skinWeights = new Uint8Array(count * 4);
      const boneIndex = boneIndices.get(entry.boneName);
      const childIndex = entry.childBone ? boneIndices.get(entry.childBone) : boneIndex;
      for (let index = 0; index < count; index++) {
        if (entry.chainNames) {
          let weightSum = 0;
          let strongest = 0;
          for (let chainIndex = 0; chainIndex < 3; chainIndex++) {
            skinIndices[index * 4 + chainIndex] = boneIndices.get(entry.chainNames[chainIndex]);
            const weight = Math.round(entry.chainWeights[index * 3 + chainIndex] * 255);
            skinWeights[index * 4 + chainIndex] = weight;
            weightSum += weight;
            if (weight > skinWeights[index * 4 + strongest]) strongest = chainIndex;
          }
          skinWeights[index * 4 + strongest] += 255 - weightSum;
          if (skinWeights[index * 4] < 255 || skinWeights[index * 4 + 1] > 0) blendedVertices++;
        } else {
          const secondary = entry.blend ? Math.round(entry.blend[index] * 255) : 0;
          skinIndices[index * 4] = boneIndex;
          skinIndices[index * 4 + 1] = childIndex;
          skinWeights[index * 4] = 255 - secondary;
          skinWeights[index * 4 + 1] = secondary;
          if (secondary > 0) blendedVertices++;
        }
      }
      if (!material.map) geometry.deleteAttribute('uv');
      geometry.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(skinIndices, 4));
      geometry.setAttribute('skinWeight', new THREE.Uint8BufferAttribute(skinWeights, 4, true));
      return geometry;
    });
    const geometry = mergeGeometries(geometries, false);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = `IvanGirl_${material.name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    root.add(mesh);
    mesh.bind(skeleton, new THREE.Matrix4());
    triangles += geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
    vertices += geometry.attributes.position.count;
    geometries.forEach((item) => item.dispose());
    entries.forEach((entry) => entry.geometry.dispose());
  }

  const restQuat = (name) => restPose.get(name).quaternion.clone();
  const deltaQuat = (name, rotation) => restQuat(name).multiply(q(rotation));
  const bombRest = HeldBomb.position.clone();
  const chestRest = Chest.position.clone().add(Spine.position.clone()).add(Pelvis.position.clone());
  const gripPoses = (bombPosition, bombRotation, chestPosition = chestRest, chestRotation = q([0, 0, 0])) => {
    const bombQuaternion = bombRotation ?? restPose.get('HeldBomb').quaternion;
    const matrix = new THREE.Matrix4().compose(bombPosition, bombQuaternion, V(1, 1, 1));
    const chestMatrix = new THREE.Matrix4().compose(chestPosition, chestRotation, V(1, 1, 1));
    return Object.fromEntries(['L', 'R'].map((side) => {
      const target = gripLocal[side].clone().applyMatrix4(matrix).applyMatrix4(chestMatrix);
      return [side, solveArm({ ...armContext, restPose }, side, target, V(side === 'L' ? -.8 : .8, -.4, .5), chestPosition, chestRotation)];
    }));
  };
  const addGripTracks = (clip, times, bombPositions, bombRotations, chestPositions, chestRotations, startWithRest = true, endWithRest = false) => {
    const poses = times.map((time, index) => {
      if ((startWithRest && index === 0) || (endWithRest && index === times.length - 1)) {
        return Object.fromEntries(['L', 'R'].map((side) => [side, { upper: restQuat(`UpperArm${side}`), forearm: restQuat(`Forearm${side}`), hand: restQuat(`Hand${side}`) }]));
      }
      return gripPoses(bombPositions[index], bombRotations?.[index], chestPositions?.[index], chestRotations?.[index]);
    });
    for (const side of ['L', 'R']) {
      clip.tracks.push(quaternionTrack(`UpperArm${side}`, times, poses.map((pose) => pose[side].upper)));
      clip.tracks.push(quaternionTrack(`Forearm${side}`, times, poses.map((pose) => pose[side].forearm)));
      clip.tracks.push(quaternionTrack(`Hand${side}`, times, poses.map((pose) => pose[side].hand)));
    }
  };

  const addHairMotion = (clip, times, phase = 0, intensity = 1) => {
    for (const side of ['L', 'R']) {
      const offset = side === 'L' ? 0 : 1.7;
      for (let level = 1; level <= 3; level++) {
        const lag = (level - 1) * .58 + offset;
        clip.tracks.push(quaternionTrack(`Pigtail${side}${level}`, times, times.map((time) => deltaQuat(`Pigtail${side}${level}`, [
          Math.sin((time + phase - lag) * TAU) * .035 * intensity * level,
          Math.sin((time + phase - lag) * TAU * 2 + .8) * .022 * intensity * level,
          Math.sin((time + phase - lag) * TAU * 3) * (.038 + level * .016) * intensity,
        ]))));
      }
    }
  };
  const addEyeGaze = (clip, times, yaw = .05, pitch = 0, motionTimes = times) => {
    for (const side of ['L', 'R']) {
      clip.tracks.push(quaternionTrack(`Eye${side}`, times, motionTimes.map((time) => deltaQuat(`Eye${side}`, [pitch + Math.sin(time * TAU) * .012, yaw * Math.sin(time * TAU + (side === 'L' ? 0 : .15)), 0]))));
    }
  };
  const addBlink = (clip, times, openness) => {
    for (const side of ['L', 'R']) clip.tracks.push(scaleTrack(`Eyelid${side}`, times, openness.map((value) => V(1, value, 1))));
  };

  const clips = [];
  const idleTimes = Array.from({ length: 33 }, (_, index) => index / 8);
  const idlePhase = idleTimes.map((time) => time / 4);
  const idleClip = new THREE.AnimationClip('idle', 4, [
    quaternionTrack('Chest', idleTimes, idlePhase.map((phase) => deltaQuat('Chest', [Math.sin(phase * TAU) * .012, Math.sin(phase * TAU + .6) * .018, Math.sin(phase * TAU + .6) * .012]))),
    quaternionTrack('Spine', idleTimes, idlePhase.map((phase) => deltaQuat('Spine', [Math.sin(phase * TAU - .5) * .010, Math.sin(phase * TAU + .2) * .012, 0]))),
    quaternionTrack('Head', idleTimes, idlePhase.map((phase) => deltaQuat('Head', [-.012 + Math.sin(phase * TAU - .7) * .018, Math.sin(phase * TAU + .9) * .038, -Math.sin(phase * TAU + .4) * .022]))),
    quaternionTrack('Pelvis', idleTimes, idlePhase.map((phase) => deltaQuat('Pelvis', [0, Math.sin(phase * TAU) * .012, Math.sin(phase * TAU + .6) * .014]))),
    vectorTrack('Pelvis', idleTimes, idlePhase.map((phase) => V(Math.sin(phase * TAU + .6) * .007, .70 + Math.sin(phase * TAU) * .005, Math.sin(phase * TAU) * .003))),
    vectorTrack('Chest', idleTimes, idlePhase.map((phase) => Chest.position.clone().add(V(Math.sin(phase * TAU + .2) * .003, Math.sin(phase * TAU) * .004, 0)))),
    scaleTrack('Mouth', idleTimes, idlePhase.map((phase) => V(1 + Math.sin(phase * TAU) * .04, 1 + Math.sin(phase * TAU + .4) * .05, 1))),
  ]);
  addHairMotion(idleClip, idleTimes, 0, .72);
  addEyeGaze(idleClip, idleTimes, .065, -.01, idlePhase);
  addBlink(idleClip, [0, 1.35, 1.43, 1.52, 1.61, 2.95, 3.03, 3.12, 3.21, 4], [.07, .07, 1, .07, 1, .07, 1, .07, .07, .07]);
  clips.push(idleClip);

  const walkTimes = Array.from({ length: 25 }, (_, index) => index / 20);
  const walkPhase = walkTimes.map((time) => time / 1.2);
  const stride = walkPhase.map((phase) => Math.sin(phase * TAU));
  const walkClip = new THREE.AnimationClip('walk', 1.2, [
    quaternionTrack('ThighL', walkTimes, stride.map((value) => deltaQuat('ThighL', [value * .30, 0, -.018]))),
    quaternionTrack('ThighR', walkTimes, stride.map((value) => deltaQuat('ThighR', [-value * .30, 0, .018]))),
    quaternionTrack('ShinL', walkTimes, stride.map((value) => deltaQuat('ShinL', [Math.max(0, -value) * .42, 0, 0]))),
    quaternionTrack('ShinR', walkTimes, stride.map((value) => deltaQuat('ShinR', [Math.max(0, value) * .42, 0, 0]))),
    quaternionTrack('FootL', walkTimes, stride.map((value) => deltaQuat('FootL', [-value * .13, 0, 0]))),
    quaternionTrack('FootR', walkTimes, stride.map((value) => deltaQuat('FootR', [value * .13, 0, 0]))),
    quaternionTrack('Pelvis', walkTimes, walkPhase.map((phase) => deltaQuat('Pelvis', [0, Math.sin(phase * TAU) * .055, Math.sin(phase * TAU) * .018]))),
    vectorTrack('Pelvis', walkTimes, walkPhase.map((phase) => V(Math.sin(phase * TAU) * .018, .70 + Math.abs(Math.sin(phase * TAU)) * .020, 0))),
    quaternionTrack('Chest', walkTimes, walkPhase.map((phase) => deltaQuat('Chest', [.015 + Math.sin(phase * TAU * 2) * .012, -Math.sin(phase * TAU) * .042, -Math.sin(phase * TAU) * .014]))),
    quaternionTrack('Spine', walkTimes, walkPhase.map((phase) => deltaQuat('Spine', [Math.sin(phase * TAU * 2 + .4) * .014, -Math.sin(phase * TAU) * .020, 0]))),
    quaternionTrack('Head', walkTimes, walkPhase.map((phase) => deltaQuat('Head', [-.025 + Math.sin(phase * TAU * 2) * .014, Math.sin(phase * TAU) * .026, Math.sin(phase * TAU) * .012]))),
    scaleTrack('Mouth', walkTimes, walkPhase.map((phase) => V(1.04, .92 + Math.sin(phase * TAU) * .04, 1))),
  ]);
  addHairMotion(walkClip, walkTimes, 0, 1.15);
  addEyeGaze(walkClip, walkTimes, .035, -.02, walkPhase);
  addBlink(walkClip, [0, .72, .78, .85, .93, 1.2], [.07, .07, 1, .07, .07, .07]);
  clips.push(walkClip);

  const throwTimes = [0, .32, .62, .88, 1.06, 1.18, 1.48, 1.82, 2.2];
  const throwBombPositions = [bombRest, V(0, .10, .27), V(0, .35, .18), V(0, .49, .015), V(0, .45, .16), V(0, .25, .32), V(.04, .10, .28), bombRest, bombRest];
  const throwBombRotations = throwTimes.map((time, index) => q([index <= 4 ? -.18 - index * .07 : .15, 0, index === 3 || index === 4 ? -.08 : 0]));
  const throwChestAngles = [[0, 0, 0], [-.02, .06, -.02], [-.05, .12, -.05], [-.09, .16, -.07], [-.04, .08, -.02], [.10, -.15, .09], [.04, -.06, .03], [0, 0, 0], [0, 0, 0]];
  const throwSpineAngles = [[0, 0, 0], [.03, -.04, .02], [.06, -.08, .04], [.10, -.12, .06], [.04, -.05, .02], [-.08, .12, -.07], [-.03, .04, -.02], [0, 0, 0], [0, 0, 0]];
  const throwClip = new THREE.AnimationClip('throw', 2.2, [
    vectorTrack('HeldBomb', throwTimes, throwBombPositions),
    quaternionTrack('HeldBomb', throwTimes, throwBombRotations),
    scaleTrack('HeldBomb', throwTimes, [1, 1, 1, 1, 1, EPS, EPS, EPS, EPS]),
    vectorTrack('ThrownBomb', [0, 1.06, 1.20, 1.40, 1.60, 1.80, 2.02, 2.2], [V(0, 0, 0), V(0, 1.44, .16), V(0, 1.72, .54), V(0, 1.74, 1.02), V(0, 1.52, 1.52), V(0, 1.14, 2.02), V(0, .72, 2.48), V(0, .52, 2.78)]),
    quaternionTrack('ThrownBomb', [0, 1.06, 1.20, 1.40, 1.60, 1.80, 2.02, 2.2], [q([0, 0, 0]), q([0, 0, 0]), q([.5, .2, 0]), q([1.2, .5, .2]), q([2.1, .9, .5]), q([3.0, 1.3, .8]), q([4.0, 1.7, 1.1]), q([4.8, 2.0, 1.4])]),
    scaleTrack('ThrownBomb', [0, 1.06, 1.20, 1.80, 2.02, 2.2], [EPS, EPS, 1, 1, EPS, EPS]),
    scaleTrack('FuseSpark', [0, 1.06, 1.20, 1.40, 1.60, 1.80, 2.02, 2.2], [1, 1, 1.2, .8, 1.35, .9, 1.1, 1]),
    quaternionTrack('Head', throwTimes, [[0, 0, 0], [-.08, 0, 0], [-.15, 0, 0], [-.12, .04, 0], [.08, -.04, 0], [.04, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]].map((value, index) => index === 0 || index === throwTimes.length - 1 ? restQuat('Head') : deltaQuat('Head', value))),
    quaternionTrack('ThighR', [0, .88, 1.10, 1.40, 2.2], [restQuat('ThighR'), deltaQuat('ThighR', [.22, 0, 0]), deltaQuat('ThighR', [-.34, 0, 0]), deltaQuat('ThighR', [.12, 0, 0]), restQuat('ThighR')]),
    quaternionTrack('ShinR', [0, .88, 1.10, 1.40, 2.2], [restQuat('ShinR'), deltaQuat('ShinR', [.1, 0, 0]), deltaQuat('ShinR', [.35, 0, 0]), deltaQuat('ShinR', [.08, 0, 0]), restQuat('ShinR')]),
    vectorTrack('Pelvis', [0, .88, 1.10, 1.40, 2.2], [V(0, .70, 0), V(0, .69, -.025), V(0, .72, .035), V(0, .70, 0), V(0, .70, 0)]),
    quaternionTrack('Chest', throwTimes, throwChestAngles.map((value, index) => index === 0 || index === throwTimes.length - 1 ? restQuat('Chest') : deltaQuat('Chest', value))),
    quaternionTrack('Spine', throwTimes, throwSpineAngles.map((value, index) => index === 0 || index === throwTimes.length - 1 ? restQuat('Spine') : deltaQuat('Spine', value))),
    scaleTrack('Mouth', [0, .88, 1.18, 1.48, 2.2], [V(1, 1, 1), V(.82, 1.35, 1), V(.68, 1.65, 1), V(1, 1, 1), V(1, 1, 1)]),
  ]);
  addGripTracks(throwClip, throwTimes, throwBombPositions, throwBombRotations, null, null, true, true);
  addHairMotion(throwClip, throwTimes, 0, 1.45);
  addEyeGaze(throwClip, throwTimes, .10, -.09);
  addBlink(throwClip, [0, .62, .68, .75, 2.2], [.07, .07, 1, .07, .07]);
  clips.push(throwClip);

  const flinchTimes = [0, .12, .30, .75];
  const flinchChestPositions = [chestRest, chestRest.clone().add(V(0, -.018, -.018)), chestRest.clone().add(V(0, -.006, -.005)), chestRest];
  const flinchChestRotations = [q([0, 0, 0]), q([-.18, .14, .08]), q([.04, -.03, -.02]), q([0, 0, 0])];
  const flinchClip = new THREE.AnimationClip('flinch', .75, [
    quaternionTrack('Chest', flinchTimes, flinchChestRotations.map((value, index) => index === 0 || index === 3 ? restQuat('Chest') : value)),
    quaternionTrack('Head', flinchTimes, [restQuat('Head'), deltaQuat('Head', [.22, -.18, -.08]), deltaQuat('Head', [-.04, .05, .02]), restQuat('Head')]),
    quaternionTrack('Spine', flinchTimes, [restQuat('Spine'), deltaQuat('Spine', [.12, -.08, -.05]), deltaQuat('Spine', [-.04, .03, .02]), restQuat('Spine')]),
    vectorTrack('Pelvis', flinchTimes, [V(0, .70, 0), V(0, .682, -.012), V(0, .697, 0), V(0, .70, 0)]),
    scaleTrack('EyeL', flinchTimes, [V(1, 1, 1), V(1.06, 1.20, 1), V(1, 1.08, 1), V(1, 1, 1)]),
    scaleTrack('EyeR', flinchTimes, [V(1, 1, 1), V(1.06, 1.20, 1), V(1, 1.08, 1), V(1, 1, 1)]),
    scaleTrack('Mouth', flinchTimes, [V(1, 1, 1), V(.78, 1.45, 1), V(1.05, .80, 1), V(1, 1, 1)]),
  ]);
  addGripTracks(flinchClip, flinchTimes, flinchTimes.map(() => bombRest), null, flinchChestPositions, flinchChestRotations, true, true);
  addHairMotion(flinchClip, flinchTimes, .1, 1.8);
  addBlink(flinchClip, flinchTimes, [.07, .035, .05, .07]);
  clips.push(flinchClip);

  const victoryTimes = [0, .38, .82, 1.30, 1.82, 2.30, 2.8];
  const victoryBombPositions = [bombRest, V(0, .20, .24), V(0, .42, .10), V(0, .45, .06), V(0, .43, .09), V(0, .30, .20), bombRest];
  const victoryBombRotations = victoryTimes.map((time, index) => index === 0 || index === 6 ? restPose.get('HeldBomb').quaternion.clone() : q([Math.sin(time * 4) * .05, Math.sin(time * 2.5) * .08, 0]));
  const victoryChestRotations = victoryTimes.map((time, index) => index === 0 || index === 6 ? q([0, 0, 0]) : q([-.08 - Math.sin((time - .38) * 3) * .025, 0, 0]));
  const victoryClip = new THREE.AnimationClip('victory', 2.8, [
    vectorTrack('HeldBomb', victoryTimes, victoryBombPositions),
    quaternionTrack('HeldBomb', victoryTimes, victoryBombRotations),
    quaternionTrack('Chest', victoryTimes, victoryChestRotations.map((value, index) => index === 0 || index === 6 ? restQuat('Chest') : value)),
    quaternionTrack('Head', victoryTimes, victoryTimes.map((time, index) => index === 0 || index === 6 ? restQuat('Head') : deltaQuat('Head', [-.13, Math.sin(time * 2.2) * .07, .065 + Math.sin(time * 1.7) * .025]))),
    quaternionTrack('Spine', victoryTimes, victoryTimes.map((time, index) => index === 0 || index === 6 ? restQuat('Spine') : deltaQuat('Spine', [.035, Math.sin(time * 1.8) * .025, -.025]))),
    vectorTrack('Pelvis', victoryTimes, [V(0, .70, 0), V(0, .715, 0), V(0, .728, 0), V(0, .72, 0), V(0, .726, 0), V(0, .708, 0), V(0, .70, 0)]),
    scaleTrack('Mouth', victoryTimes, [V(1, 1, 1), V(1.12, .82, 1), V(1.18, .72, 1), V(1.15, .76, 1), V(1.12, .82, 1), V(1.06, .92, 1), V(1, 1, 1)]),
  ]);
  addGripTracks(victoryClip, victoryTimes, victoryBombPositions, victoryBombRotations, victoryTimes.map((time, index) => index === 0 || index === 6 ? chestRest : chestRest.clone().add(V(0, .01, 0))), victoryChestRotations, true, true);
  addHairMotion(victoryClip, victoryTimes, .2, 1.05);
  addEyeGaze(victoryClip, victoryTimes, -.07, -.16);
  addBlink(victoryClip, [0, 1.02, 1.09, 1.17, 2.8], [.07, .07, 1, .07, .07]);
  clips.push(victoryClip);

  const deadDuration = 1.25;
  const groundTimes = Array.from({ length: 51 }, (_, index) => index / 50);
  const deadClip = new THREE.AnimationClip('dead', deadDuration, [
    quaternionTrack('Root', [0, .32, deadDuration], [restQuat('Root'), q([.38, 0, .03]), q([Math.PI / 2, 0, 0])]),
    quaternionTrack('Head', [0, .45, deadDuration], [restQuat('Head'), deltaQuat('Head', [-.12, .10, 0]), deltaQuat('Head', [-.20, .14, 0])]),
    quaternionTrack('ThighL', [0, .50, deadDuration], [restQuat('ThighL'), deltaQuat('ThighL', [-.16, 0, -.06]), deltaQuat('ThighL', [.08, 0, -.10])]),
    quaternionTrack('ThighR', [0, .50, deadDuration], [restQuat('ThighR'), deltaQuat('ThighR', [.12, 0, .08]), deltaQuat('ThighR', [-.10, 0, .12])]),
    quaternionTrack('PigtailL1', [0, .55, deadDuration], [restQuat('PigtailL1'), deltaQuat('PigtailL1', [.12, -.08, -.14]), deltaQuat('PigtailL1', [.22, -.12, -.20])]),
    quaternionTrack('PigtailL2', [0, .68, deadDuration], [restQuat('PigtailL2'), deltaQuat('PigtailL2', [.18, .06, -.18]), deltaQuat('PigtailL2', [.30, .10, -.26])]),
    quaternionTrack('PigtailL3', [0, .82, deadDuration], [restQuat('PigtailL3'), deltaQuat('PigtailL3', [.22, .08, -.20]), deltaQuat('PigtailL3', [.34, .14, -.30])]),
    quaternionTrack('PigtailR1', [0, .55, deadDuration], [restQuat('PigtailR1'), deltaQuat('PigtailR1', [.10, .08, .16]), deltaQuat('PigtailR1', [.20, .12, .22])]),
    quaternionTrack('PigtailR2', [0, .68, deadDuration], [restQuat('PigtailR2'), deltaQuat('PigtailR2', [.16, -.06, .20]), deltaQuat('PigtailR2', [.28, -.10, .28])]),
    quaternionTrack('PigtailR3', [0, .82, deadDuration], [restQuat('PigtailR3'), deltaQuat('PigtailR3', [.20, -.08, .22]), deltaQuat('PigtailR3', [.32, -.14, .32])]),
    scaleTrack('EyelidL', [0, .72, deadDuration], [V(1, .07, 1), V(1, .07, 1), V(1, 1, 1)]),
    scaleTrack('EyelidR', [0, .72, deadDuration], [V(1, .07, 1), V(1, .07, 1), V(1, 1, 1)]),
    scaleTrack('EyeL', [0, deadDuration], [V(1, 1, 1), V(1, .62, 1)]),
    scaleTrack('EyeR', [0, deadDuration], [V(1, 1, 1), V(1, .62, 1)]),
    scaleTrack('Mouth', [0, .60, deadDuration], [V(1, 1, 1), V(1.10, .75, 1), V(.82, .55, 1)]),
    scaleTrack('ThrownBomb', [0, deadDuration], [EPS, EPS]),
  ]);
  const resetPose = () => {
    for (const bone of bones) {
      const pose = restPose.get(bone.name);
      bone.position.copy(pose.position);
      bone.quaternion.copy(pose.quaternion);
      bone.scale.copy(pose.scale);
    }
    root.updateMatrixWorld(true);
  };
  const supportTrack = vectorTrack('Root', groundTimes.map((time) => time * deadDuration), groundTimes.map(() => V(0, 0, 0)));
  deadClip.tracks.push(supportTrack);
  for (let pass = 0; pass < 3; pass++) {
    resetPose();
    const groundMixer = new THREE.AnimationMixer(root);
    const groundAction = groundMixer.clipAction(deadClip);
    groundAction.play();
    for (let index = 0; index < groundTimes.length; index++) {
      groundAction.time = groundTimes[index] * deadDuration;
      groundMixer.update(0);
      const minY = skinnedBounds(root).min.y;
      supportTrack.values[index * 3 + 1] += .001 - minY;
    }
    groundMixer.stopAllAction();
  }
  resetPose();
  clips.push(deadClip);
  const revive = reverseClip(deadClip);
  revive.name = 'reviveRise';
  clips.push(revive);

  root.updateMatrixWorld(true);
  const bounds = skinnedBounds(root);
  return {
    root, skeleton, bones, clips, materials: Object.values(materials), restPose,
    stats: {
      meshes: geometryGroups.size, materials: geometryGroups.size, bones: bones.length, triangles, vertices,
      hairLocks: hairLockCount, blendedVertices,
      height: bounds.size.y, width: bounds.size.x, depth: bounds.size.z, footY: bounds.min.y,
      clips: clips.map((clip) => ({ name: clip.name, duration: clip.duration, tracks: clip.tracks.length })),
    },
  };
}
