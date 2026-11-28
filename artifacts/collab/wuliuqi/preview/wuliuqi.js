import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const EPS = .0001;
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

function canvasTexture(color, seed, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  const random = randomSource(seed);
  const base = new THREE.Color(color).convertLinearToSRGB();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const grain = (random() - .5) * 13;
      const weave = Math.sin(x * .31 + y * .17) * 2 + Math.sin(y * .43) * 1.3;
      image.data[index] = Math.max(0, Math.min(255, base.r * 255 + grain + weave));
      image.data[index + 1] = Math.max(0, Math.min(255, base.g * 255 + grain + weave));
      image.data[index + 2] = Math.max(0, Math.min(255, base.b * 255 + grain + weave));
      image.data[index + 3] = 255;
    }
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
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const grain = random();
      heights[y * size + x] = grain;
      const value = kind === 'roughness' ? 160 + grain * 76 : 228 + grain * 27;
      image.data[index] = image.data[index + 1] = image.data[index + 2] = value;
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
        const normal = V((left - right) * 1.05, (up - down) * 1.05, 1).normalize();
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
    map: canvasTexture(color, seed),
    roughness: options.roughness ?? .72,
    roughnessMap: scalarTexture('roughness', seed + 17),
    metalness: options.metalness ?? 0,
    metalnessMap: scalarTexture('metalness', seed + 31),
    normalMap: scalarTexture('normal', seed + 47),
    normalScale: new THREE.Vector2(options.normal ?? .12, options.normal ?? .12),
    clearcoat: options.clearcoat ?? 0,
    clearcoatRoughness: .55,
    sheen: options.sheen ?? 0,
    sheenColor: new THREE.Color(options.sheenColor ?? color),
    sheenRoughness: .8,
  });
  material.map.colorSpace = THREE.SRGBColorSpace;
  return material;
}

function createMaterials() {
  return {
    hoodie: pbrMaterial('white_hoodie', '#e7e8e2', { seed: 3, roughness: .88, normal: .16, sheen: .22 }),
    seam: pbrMaterial('hoodie_shadow', '#aeb7b2', { seed: 7, roughness: .9, normal: .12 }),
    tee: pbrMaterial('black_tee', '#202328', { seed: 11, roughness: .94, normal: .16 }),
    shorts: pbrMaterial('charcoal_shorts', '#343842', { seed: 17, roughness: .9, normal: .14 }),
    skin: pbrMaterial('warm_skin', '#d8ab8d', { seed: 23, roughness: .68, normal: .07, clearcoat: .03 }),
    hair: pbrMaterial('ink_black_hair', '#171a1d', { seed: 29, roughness: .46, normal: .09, clearcoat: .12 }),
    hairLight: pbrMaterial('hair_highlight', '#30363d', { seed: 37, roughness: .54, normal: .08 }),
    shoe: pbrMaterial('black_cloth_shoes', '#202329', { seed: 41, roughness: .9, normal: .22, sheen: .08 }),
    sole: pbrMaterial('charcoal_cloth_sole', '#41464a', { seed: 53, roughness: .96, normal: .18 }),
    steel: pbrMaterial('scissor_steel', '#aeb9c7', { seed: 61, roughness: .3, metalness: .82, normal: .06, clearcoat: .2 }),
    edge: pbrMaterial('scissor_edge', '#e7edf2', { seed: 67, roughness: .2, metalness: .92, normal: .04, clearcoat: .25 }),
    grip: pbrMaterial('red_grip', '#9e3540', { seed: 73, roughness: .66, normal: .12 }),
    eyeWhite: new THREE.MeshStandardMaterial({ name: 'warm_eye_white', color: '#e4dfd2', roughness: .55 }),
    eyeDark: new THREE.MeshStandardMaterial({ name: 'dark_iris', color: '#191d22', roughness: .3 }),
    lip: new THREE.MeshStandardMaterial({ name: 'closed_lips', color: '#93675d', roughness: .76 }),
    slash: new THREE.MeshStandardMaterial({ name: 'slash_light', color: '#f4fbff', emissive: '#b9e8ff', emissiveIntensity: 2.4, roughness: .22, metalness: .15, transparent: true, opacity: .82, depthWrite: false, side: THREE.DoubleSide }),
  };
}

function loftGeometry(rings, segments = 32, folds = 0, cap = true) {
  rings = [...rings].sort((a, b) => a.y - b.y);
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row < rings.length; row++) {
    const ring = rings[row];
    for (let column = 0; column <= segments; column++) {
      const angle = column / segments * TAU;
      const fold = folds * (1 - row / Math.max(1, rings.length - 1) * .68) * Math.sin(angle * 9 + row * .19);
      positions.push(Math.cos(angle) * (ring.rx + fold), ring.y, Math.sin(angle) * (ring.rz + fold * .72) + (ring.z ?? 0));
      uvs.push(column / segments, row / (rings.length - 1));
    }
  }
  for (let row = 0; row < rings.length - 1; row++) {
    for (let column = 0; column < segments; column++) {
      const a = row * (segments + 1) + column;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  if (cap) {
    const bottom = positions.length / 3;
    positions.push(0, rings[0].y, rings[0].z ?? 0);
    uvs.push(.5, 0);
    const top = positions.length / 3;
    const last = rings[rings.length - 1];
    positions.push(0, last.y, last.z ?? 0);
    uvs.push(.5, 1);
    for (let column = 0; column < segments; column++) {
      indices.push(bottom, column + 1, column);
      const offset = (rings.length - 1) * (segments + 1);
      indices.push(top, offset + column, offset + column + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function frontPanelGeometry(rows, segments = 8) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row < rows.length; row++) {
    const item = rows[row];
    for (let column = 0; column <= segments; column++) {
      const across = column / segments * 2 - 1;
      const x = across * item.width;
      const z = item.rz * Math.sqrt(Math.max(.05, 1 - (x * x) / (item.rx * item.rx))) + .009;
      positions.push(x, item.y, z);
      uvs.push(column / segments, row / (rows.length - 1));
    }
  }
  for (let row = 0; row < rows.length - 1; row++) {
    for (let column = 0; column < segments; column++) {
      const a = row * (segments + 1) + column;
      const b = a + segments + 1;
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

function tubeGeometry(points, radius, segments = 16, radial = 7) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, radius, radial, false);
}

function ellipseCurve(rx, rz, y, segments = 48) {
  return new THREE.CatmullRomCurve3(Array.from({ length: segments + 1 }, (_, index) => {
    const angle = index / segments * TAU;
    return V(Math.cos(angle) * rx, y, Math.sin(angle) * rz);
  }), true);
}

function segmentGeometry(start, end, radiusStart, radiusEnd, sides = 10) {
  const direction = end.clone().sub(start);
  const geometry = new THREE.CylinderGeometry(radiusEnd, radiusStart, direction.length(), sides, 1, false);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), direction.clone().normalize()));
  geometry.translate((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
  return geometry;
}

function spikeGeometry(base, tip, radius, sides = 7) {
  const direction = tip.clone().sub(base);
  const geometry = new THREE.ConeGeometry(radius, direction.length(), sides, 1, false);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), direction.clone().normalize()));
  geometry.translate((base.x + tip.x) / 2, (base.y + tip.y) / 2, (base.z + tip.z) / 2);
  return geometry;
}

function bladeGeometry(side, length = .42, width = .05) {
  const shape = new THREE.Shape();
  shape.moveTo(-width * .42, 0);
  shape.lineTo(side * width * .16, length * .56);
  shape.lineTo(side * width * .06, length);
  shape.lineTo(-side * width * .52, length * .58);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: .012, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .003, bevelThickness: .003 });
  geometry.translate(0, 0, -.006);
  return geometry;
}

function eyeGeometry(width, height) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.quadraticCurveTo(-width * .18, height * .58, width / 2, -height * .05);
  shape.quadraticCurveTo(width * .12, -height * .72, -width / 2, 0);
  return new THREE.ShapeGeometry(shape, 10);
}

function sculptedHeadGeometry() {
  const geometry = new THREE.SphereGeometry(1, 32, 24);
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const jaw = 1 - Math.max(0, -y) * .22;
    const cheek = 1 + Math.exp(-Math.pow((y + .04) * 5, 2)) * .04;
    position.setXYZ(index, x * .142 * jaw * cheek, .12 + y * .202, z * .132 * (1 - Math.max(0, -y) * .1));
  }
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
  return new THREE.VectorKeyframeTrack(`${name}.scale`, times, scales.flatMap((value) => (Array.isArray(value) ? value : [value, value, value])));
}

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

export function createWuliuqi() {
  const materials = createMaterials();
  materials.eyeWhite.side = THREE.DoubleSide;
  const root = new THREE.Group();
  root.name = 'Wuliuqi';
  root.userData = {
    visualId: 'wuliuqi-v2',
    suggestedCharId: 'wuliuqi',
    upAxis: '+Y',
    forwardAxis: '+Z',
    units: 'meters',
    author: 'HungerG local procedural asset pipeline',
    license: 'project-internal procedural source',
    externalCredentialsUsed: false,
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
  const Pelvis = addBone('Pelvis', Root, V(0, .92, 0));
  const Spine = addBone('Spine', Pelvis, V(0, .17, 0));
  const Chest = addBone('Chest', Spine, V(0, .20, 0));
  const Neck = addBone('Neck', Chest, V(0, .23, 0));
  const Head = addBone('Head', Neck, V(0, .10, 0));
  Head.scale.setScalar(.94);
  const HairTuft = addBone('HairTuft', Head, V(0, .285, -.035));
  const UpperArmL = addBone('UpperArmL', Chest, V(-.225, .14, 0));
  const ForearmL = addBone('ForearmL', UpperArmL, V(0, -.27, 0));
  const HandL = addBone('HandL', ForearmL, V(0, -.25, 0));
  const UpperArmR = addBone('UpperArmR', Chest, V(.225, .14, 0));
  const ForearmR = addBone('ForearmR', UpperArmR, V(0, -.27, 0));
  const HandR = addBone('HandR', ForearmR, V(0, -.25, 0));
  const ThighL = addBone('ThighL', Pelvis, V(-.105, -.02, 0));
  const ShinL = addBone('ShinL', ThighL, V(0, -.40, 0));
  const FootL = addBone('FootL', ShinL, V(0, -.43, .02));
  const ThighR = addBone('ThighR', Pelvis, V(.105, -.02, 0));
  const ShinR = addBone('ShinR', ThighR, V(0, -.40, 0));
  const FootR = addBone('FootR', ShinR, V(0, -.43, .02));
  const ScissorsR = addBone('ScissorsR', HandR, V(0, -.035, .015));
  const BladeUpperR = addBone('BladeUpperR', ScissorsR, V(0, 0, 0));
  const BladeLowerR = addBone('BladeLowerR', ScissorsR, V(0, 0, 0));
  const ScissorsL = addBone('ScissorsL', HandL, V(0, -.035, .015));
  ScissorsL.scale.setScalar(.78);
  const BladeUpperL = addBone('BladeUpperL', ScissorsL, V(0, 0, 0));
  const BladeLowerL = addBone('BladeLowerL', ScissorsL, V(0, 0, 0));
  const CutRing = addBone('CutRing', Root, V(0, 1.28, .38));
  const Slashes = [0, 1, 2].map((index) => addBone(`Slash${index}`, Root, V((index - 1) * .18, 1.25, .42 + index * .08)));
  const effectBoneNames = ['CutRing', ...Slashes.map((bone) => bone.name)];

  UpperArmL.rotation.set(-.04, 0, -.12);
  ForearmL.rotation.set(-.24, 0, .03);
  HandL.rotation.set(.08, 0, -.04);
  UpperArmR.rotation.set(-.10, 0, .13);
  ForearmR.rotation.set(-.34, 0, -.04);
  HandR.rotation.set(.12, 0, .06);
  ScissorsR.rotation.set(.22, 0, -.12);
  ScissorsL.rotation.set(.14, 0, .13);
  BladeUpperR.rotation.z = .22;
  BladeLowerR.rotation.z = -.22;
  BladeUpperL.rotation.z = .18;
  BladeLowerL.rotation.z = -.18;
  root.updateMatrixWorld(true);

  const parts = [];
  const part = (parent, boneName, geometry, material, options = {}) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${boneName}_part_${parts.length}`;
    mesh.position.set(...(options.position ?? [0, 0, 0]));
    mesh.rotation.set(...(options.rotation ?? [0, 0, 0]));
    mesh.scale.set(...(options.scale ?? [1, 1, 1]));
    parent.add(mesh);
    parts.push({ mesh, boneName, weights: options.weights });
    return mesh;
  };
  const ellipsoid = (parent, boneName, material, position, scale, segments = 16) => part(parent, boneName, new THREE.SphereGeometry(1, segments, Math.max(8, segments / 2)), material, { position, scale });
  const rounded = (width, height, depth, radius = .015) => new RoundedBoxGeometry(width, height, depth, 2, radius);
  const torsoWeights = (position) => {
    const y = position.y;
    if (y < 1.02) return [['Pelvis', 1]];
    if (y < 1.20) return [['Pelvis', 1 - (y - 1.02) / .18], ['Spine', (y - 1.02) / .18]];
    if (y < 1.38) return [['Spine', 1 - (y - 1.20) / .18], ['Chest', (y - 1.20) / .18]];
    return [['Chest', 1]];
  };

  part(root, 'Hoodie', loftGeometry([
    { y: .91, rx: .178, rz: .12 }, { y: .99, rx: .186, rz: .126 }, { y: 1.16, rx: .196, rz: .134 },
    { y: 1.34, rx: .218, rz: .139 }, { y: 1.45, rx: .185, rz: .118 }, { y: 1.49, rx: .115, rz: .086 },
  ], 36, .006), materials.hoodie, { weights: torsoWeights });
  part(root, 'Tee', frontPanelGeometry([
    { y: .99, width: .068, rx: .187, rz: .127 }, { y: 1.16, width: .074, rx: .197, rz: .135 },
    { y: 1.33, width: .078, rx: .219, rz: .14 }, { y: 1.44, width: .06, rx: .186, rz: .12 },
  ], 10), materials.tee, { weights: torsoWeights });
  part(root, 'HoodieHem', new THREE.TubeGeometry(ellipseCurve(.181, .122, .935), 56, .012, 6, true), materials.seam, { weights: () => [['Pelvis', 1]] });
  for (const side of [-1, 1]) {
    part(root, 'Hoodie', tubeGeometry([V(side * .073, 1.43, .131), V(side * .078, 1.28, .148), V(side * .071, 1.02, .139)], .006, 18, 6), materials.seam, { weights: torsoWeights });
    part(root, 'Hoodie', tubeGeometry([V(side * .052, 1.43, .139), V(side * .057, 1.31, .158), V(side * .061, 1.20, .157)], .004, 14, 6), materials.hoodie, { weights: () => [['Chest', 1]] });
    part(root, 'Hoodie', new THREE.CylinderGeometry(.006, .006, .028, 8), materials.seam, { position: [side * .061, 1.185, .158], weights: () => [['Chest', 1]] });
  }
  part(root, 'Hoodie', tubeGeometry([V(-.11, 1.095, .132), V(-.08, 1.065, .147), V(0, 1.055, .153), V(.08, 1.065, .147), V(.11, 1.095, .132)], .006, 24, 6), materials.seam, { weights: () => [['Spine', 1]] });
  part(root, 'HoodiePocket', frontPanelGeometry([
    { y: .98, width: .070, rx: .184, rz: .126 }, { y: 1.03, width: .088, rx: .191, rz: .131 },
    { y: 1.13, width: .090, rx: .200, rz: .136 }, { y: 1.18, width: .074, rx: .203, rz: .137 },
  ], 12), materials.hoodie, { weights: torsoWeights });
  part(root, 'HoodiePocket', tubeGeometry([V(-.094, 1.16, .142), V(-.078, 1.08, .151), V(-.072, 1.00, .141)], .0045, 16, 5), materials.seam, { weights: torsoWeights });
  part(root, 'HoodiePocket', tubeGeometry([V(.094, 1.16, .142), V(.078, 1.08, .151), V(.072, 1.00, .141)], .0045, 16, 5), materials.seam, { weights: torsoWeights });
  part(root, 'HoodieMark', tubeGeometry([V(.043, 1.365, .133), V(.062, 1.365, .139), V(.066, 1.331, .140), V(.049, 1.319, .142), V(.039, 1.334, .143), V(.043, 1.349, .142)], .0034, 14, 5), materials.tee, { weights: () => [['Chest', 1]] });
  part(root, 'HoodieMark', tubeGeometry([V(.077, 1.365, .137), V(.102, 1.365, .133)], .0035, 4, 5), materials.tee, { weights: () => [['Chest', 1]] });
  part(root, 'HoodieMark', tubeGeometry([V(.091, 1.365, .134), V(.076, 1.319, .141)], .0035, 5, 5), materials.tee, { weights: () => [['Chest', 1]] });
  ellipsoid(Chest, 'Chest', materials.hoodie, [0, .17, -.095], [.19, .135, .085], 20);
  part(Neck, 'Neck', new THREE.TorusGeometry(.105, .030, 8, 28), materials.hoodie, { position: [0, .015, -.015], rotation: [Math.PI / 2, 0, 0], scale: [1.18, .78, 1] });
  for (const side of [-1, 1]) {
    part(Neck, 'Neck', tubeGeometry([V(side * .087, -.015, .074), V(side * .13, -.055, .037), V(side * .15, -.12, -.006)], .006, 16, 5), materials.seam, { weights: () => [['Chest', 1]] });
  }

  part(root, 'Shorts', loftGeometry([{ y: .72, rx: .19, rz: .125 }, { y: .82, rx: .205, rz: .137 }, { y: .94, rx: .178, rz: .118 }], 28, 0), materials.shorts, { weights: () => [['Pelvis', 1]] });
  for (const side of [-1, 1]) {
    const upper = side < 0 ? UpperArmL : UpperArmR;
    const forearm = side < 0 ? ForearmL : ForearmR;
    const hand = side < 0 ? HandL : HandR;
    part(upper, upper.name, loftGeometry([{ y: .025, rx: .082, rz: .078 }, { y: -.08, rx: .094, rz: .088 }, { y: -.22, rx: .083, rz: .078 }, { y: -.27, rx: .074, rz: .07 }], 24, .004, false), materials.hoodie);
    part(forearm, forearm.name, loftGeometry([{ y: .02, rx: .078, rz: .074 }, { y: -.10, rx: .073, rz: .069 }, { y: -.22, rx: .061, rz: .058 }, { y: -.25, rx: .058, rz: .055 }], 24, .003, false), materials.hoodie);
    part(forearm, forearm.name, new THREE.TorusGeometry(.058, .008, 6, 22), materials.seam, { position: [0, -.242, 0], rotation: [Math.PI / 2, 0, 0] });
    ellipsoid(hand, hand.name, materials.skin, [0, -.025, .003], [.043, .052, .034], 14);
    for (let finger = 0; finger < 4; finger++) {
      ellipsoid(hand, hand.name, materials.skin, [(finger - 1.5) * .014, -.047, .026], [.008, .024, .009], 10);
    }
    ellipsoid(hand, hand.name, materials.skin, [side * .034, -.018, .024], [.012, .027, .012], 10);

    const thigh = side < 0 ? ThighL : ThighR;
    const shin = side < 0 ? ShinL : ShinR;
    const foot = side < 0 ? FootL : FootR;
    part(thigh, thigh.name, new THREE.CylinderGeometry(.061, .052, .38, 12), materials.skin, { position: [0, -.20, 0] });
    part(thigh, thigh.name, new THREE.CylinderGeometry(.078, .071, .20, 14), materials.shorts, { position: [0, -.085, 0] });
    part(shin, shin.name, new THREE.CylinderGeometry(.052, .041, .40, 12), materials.skin, { position: [0, -.20, 0] });
    part(shin, shin.name, new THREE.CylinderGeometry(.047, .043, .20, 12), materials.tee, { position: [0, -.315, 0] });
    part(foot, foot.name, rounded(.150, .078, .280, .022), materials.shoe, { position: [0, -.020, .066] });
    part(foot, foot.name, rounded(.151, .032, .286, .010), materials.shoe, { position: [0, -.051, .068] });
    part(foot, foot.name, rounded(.155, .014, .289, .005), materials.sole, { position: [0, -.063, .068] });
    part(foot, foot.name, rounded(.148, .008, .281, .003), materials.tee, { position: [0, -.066, .068] });
    for (const side of [-1, 1]) {
      part(foot, foot.name, tubeGeometry([V(side * .067, -.012, -.043), V(side * .073, -.009, .025), V(side * .060, -.020, .117), V(side * .035, -.027, .166)], .0028, 14, 5), materials.sole);
    }
    part(foot, foot.name, tubeGeometry([V(-.055, -.014, .151), V(0, -.006, .175), V(.055, -.014, .151)], .003, 12, 5), materials.sole);
    for (let lace = 0; lace < 4; lace++) {
      const y = .002 - lace * .010;
      const z = -.020 + lace * .020;
      part(foot, foot.name, segmentGeometry(V(-.033, y, z), V(.033, y - .004, z + .012), .0024, .0024, 5), materials.sole);
    }
  }

  part(Neck, 'Neck', new THREE.CylinderGeometry(.048, .054, .14, 14), materials.skin, { position: [0, .035, 0] });
  part(Head, 'Head', sculptedHeadGeometry(), materials.skin);
  for (const side of [-1, 1]) {
    ellipsoid(Head, 'Head', materials.skin, [side * .139, .112, -.004], [.024, .041, .018]);
    const eye = part(Head, 'Head', eyeGeometry(.058, .015), materials.eyeWhite, { position: [side * .056, .151, .126], rotation: [0, side * .07, side * -.14] });
    eye.material.side = THREE.DoubleSide;
    ellipsoid(Head, 'Head', materials.eyeDark, [side * .053, .150, .1305], [.0065, .0072, .0025], 12);
    part(Head, 'Head', tubeGeometry([V(side * .018, .194, .121), V(side * .054, .199, .119), V(side * .098, .202, .102)], .0068, 10, 6), materials.hair);
    part(Head, 'Head', tubeGeometry([V(side * .024, .164, .127), V(side * .056, .164, .130), V(side * .089, .155, .116)], .0022, 10, 5), materials.lip);
  }
  ellipsoid(Head, 'Head', materials.skin, [0, .101, .127], [.011, .039, .016]);
  ellipsoid(Head, 'Head', materials.skin, [0, .064, .144], [.018, .013, .02]);
  part(Head, 'Head', tubeGeometry([V(-.034, .017, .13), V(0, .012, .138), V(.034, .017, .13)], .004, 12, 6), materials.lip);
  part(Head, 'Head', new THREE.SphereGeometry(1, 28, 18, 0, TAU, 0, 1.50), materials.hair, { position: [0, .13, -.014], scale: [.151, .211, .141] });
  for (const side of [-1, 1]) {
    part(Head, 'Head', tubeGeometry([V(side * .119, .242, .018), V(side * .145, .15, -.012), V(side * .132, .045, -.06), V(side * .106, -.025, -.07)], .021, 18, 7), materials.hair);
    part(Head, 'Head', tubeGeometry([V(side * .104, .262, .06), V(side * .123, .21, .092), V(side * .117, .14, .099)], .007, 12, 6), materials.hairLight);
  }
  const bangs = [
    [V(-.119, .251, .070), V(-.111, .119, .116), .024],
    [V(-.079, .285, .086), V(-.059, .149, .130), .026],
    [V(-.030, .303, .098), V(-.008, .171, .134), .027],
    [V(.024, .301, .098), V(.052, .145, .132), .027],
    [V(.077, .278, .079), V(.104, .116, .116), .024],
    [V(.111, .238, .054), V(.121, .089, .089), .018],
  ];
  for (const [base, tip, radius] of bangs) part(Head, 'Head', spikeGeometry(base, tip, radius, 5), materials.hair);
  part(Head, 'Head', spikeGeometry(V(-.105, .235, .096), V(-.074, .184, .127), .009, 5), materials.hairLight);
  part(Head, 'Head', spikeGeometry(V(.066, .244, .096), V(.089, .181, .121), .008, 5), materials.hairLight);
  ellipsoid(HairTuft, 'HairTuft', materials.hair, [0, .012, 0], [.045, .035, .040], 12);
  part(HairTuft, 'HairTuft', new THREE.TorusGeometry(.031, .008, 6, 14), materials.hairLight, { position: [0, .018, 0], rotation: [Math.PI / 2, 0, 0], scale: [1, 1, .82] });
  part(HairTuft, 'HairTuft', spikeGeometry(V(-.031, .030, -.005), V(-.095, .158, -.024), .031, 6), materials.hair);
  part(HairTuft, 'HairTuft', spikeGeometry(V(0, .034, -.008), V(.014, .202, -.033), .035, 6), materials.hair);
  part(HairTuft, 'HairTuft', spikeGeometry(V(.030, .029, -.004), V(.094, .147, -.020), .029, 6), materials.hairLight);

  const addScissors = (scissors, upperBlade, lowerBlade, length, width) => {
    part(scissors, scissors.name, new THREE.TorusGeometry(.034, .009, 7, 18), materials.grip, { position: [-.038, -.092, 0], scale: [.82, 1.15, 1] });
    part(scissors, scissors.name, new THREE.TorusGeometry(.034, .009, 7, 18), materials.grip, { position: [.038, -.092, 0], scale: [.82, 1.15, 1] });
    part(scissors, scissors.name, segmentGeometry(V(-.034, -.075, 0), V(0, 0, 0), .011, .014, 8), materials.grip);
    part(scissors, scissors.name, segmentGeometry(V(.034, -.075, 0), V(0, 0, 0), .011, .014, 8), materials.grip);
    part(upperBlade, upperBlade.name, bladeGeometry(1, length, width), materials.steel);
    part(lowerBlade, lowerBlade.name, bladeGeometry(-1, length, width), materials.steel);
    part(upperBlade, upperBlade.name, bladeGeometry(1, length * .96, width * .30), materials.edge, { position: [0, .008, .014] });
    part(lowerBlade, lowerBlade.name, bladeGeometry(-1, length * .96, width * .30), materials.edge, { position: [0, .008, .014] });
    part(scissors, scissors.name, new THREE.CylinderGeometry(.019, .019, .032, 12), materials.edge, { position: [0, 0, .012], rotation: [Math.PI / 2, 0, 0] });
  };
  addScissors(ScissorsR, BladeUpperR, BladeLowerR, .43, .052);
  addScissors(ScissorsL, BladeUpperL, BladeLowerL, .32, .043);

  part(CutRing, 'CutRing', new THREE.TorusGeometry(.22, .009, 6, 40), materials.slash);
  part(CutRing, 'CutRing', new THREE.TorusGeometry(.17, .004, 5, 32), materials.slash, { rotation: [0, 0, .35] });
  Slashes.forEach((bone, index) => {
    part(bone, bone.name, new THREE.TorusGeometry(.27 + index * .025, .014, 6, 36, Math.PI * 1.18), materials.slash, { rotation: [0, 0, -.55 + index * .16] });
    part(bone, bone.name, new THREE.TorusGeometry(.24 + index * .025, .004, 5, 32, Math.PI * 1.05), materials.slash, { rotation: [0, 0, -.48 + index * .16], position: [0, 0, .008] });
  });

  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const boneIndices = new Map(bones.map((bone, index) => [bone.name, index]));
  const geometryGroups = new Map();
  for (const item of parts) {
    let geometry = item.mesh.geometry.clone();
    if (geometry.index) geometry = geometry.toNonIndexed();
    for (const attribute of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'uv'].includes(attribute)) geometry.deleteAttribute(attribute);
    }
    if (!geometry.attributes.uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
    geometry.applyMatrix4(item.mesh.matrixWorld);
    const indexed = mergeVertices(geometry, 1e-5);
    geometry.dispose();
    const count = indexed.attributes.position.count;
    const skinIndices = new Uint8Array(count * 4);
    const skinWeights = new Float32Array(count * 4);
    const position = indexed.attributes.position;
    for (let index = 0; index < count; index++) {
      const weights = item.weights ? item.weights(V(position.getX(index), position.getY(index), position.getZ(index))) : [[item.boneName, 1]];
      const total = weights.reduce((sum, entry) => sum + entry[1], 0) || 1;
      const active = weights.filter((entry) => entry && entry[1] > 0).slice(0, 4);
      let assigned = 0;
      for (let slot = 0; slot < active.length; slot++) {
        const entry = active[slot];
        const weight = slot === active.length - 1 ? 1 - assigned : entry[1] / total;
        skinIndices[index * 4 + slot] = boneIndices.get(entry[0]);
        skinWeights[index * 4 + slot] = weight;
        assigned += weight;
      }
    }
    indexed.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(skinIndices, 4));
    indexed.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    if (!geometryGroups.has(item.mesh.material)) geometryGroups.set(item.mesh.material, []);
    geometryGroups.get(item.mesh.material).push(indexed);
    item.mesh.removeFromParent();
  }

  for (const bone of bones) if (effectBoneNames.includes(bone.name)) bone.scale.setScalar(EPS);
  root.updateMatrixWorld(true);
  let triangles = 0;
  let vertices = 0;
  const meshes = [];
  for (const [material, geometries] of geometryGroups) {
    const geometry = mergeGeometries(geometries, false);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = `Wuliuqi_${material.name}`;
    mesh.castShadow = !material.transparent;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    root.add(mesh);
    mesh.bind(skeleton, new THREE.Matrix4());
    meshes.push(mesh);
    triangles += geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
    vertices += geometry.attributes.position.count;
    geometries.forEach((entry) => entry.dispose());
  }

  root.updateMatrixWorld(true);
  const restPose = new Map(bones.map((bone) => [bone.name, { position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }]));
  const clips = createClips({ bones, boneMap, meshes, restPose, effectBoneNames, CutRing, Slashes, HairTuft });
  meshes.forEach((mesh) => mesh.computeBoundingBox());
  const bounds = new THREE.Box3().setFromObject(root, true);
  return {
    root,
    skeleton,
    bones,
    clips,
    materials: Object.values(materials),
    restPose,
    effectBoneNames,
    stats: {
      meshes: meshes.length,
      materials: meshes.length,
      bones: bones.length,
      triangles,
      vertices,
      height: bounds.max.y - bounds.min.y,
      width: bounds.max.x - bounds.min.x,
      depth: bounds.max.z - bounds.min.z,
      footY: bounds.min.y,
      clips: clips.map((clip) => ({ name: clip.name, duration: clip.duration, tracks: clip.tracks.length })),
    },
  };
}

function createClips(context) {
  const { bones, boneMap, meshes, restPose, effectBoneNames, CutRing, Slashes, HairTuft } = context;
  const Root = boneMap.get('Root');
  const Pelvis = boneMap.get('Pelvis');
  const Chest = boneMap.get('Chest');
  const Head = boneMap.get('Head');
  const resetBones = () => {
    for (const bone of bones) {
      const rest = restPose.get(bone.name);
      bone.position.copy(rest.position);
      bone.quaternion.copy(rest.quaternion);
      bone.scale.copy(rest.scale);
    }
    Root.parent.updateMatrixWorld(true);
  };
  const groundCorrect = (clip) => {
    const keyTimes = [...new Set(clip.tracks.flatMap((track) => [...track.times]))];
    const denseCount = Math.ceil(clip.duration * 30);
    const times = [...new Set([...keyTimes, ...Array.from({ length: denseCount + 1 }, (_, index) => index / denseCount * clip.duration)])].sort((a, b) => a - b);
    const mixer = new THREE.AnimationMixer(Root.parent);
    const action = mixer.clipAction(clip);
    const positions = [];
    const vertex = new THREE.Vector3();
    action.play();
    for (const time of times) {
      resetBones();
      action.time = time;
      mixer.update(0);
      Root.parent.updateMatrixWorld(true);
      let minY = Infinity;
      for (const mesh of meshes) {
        mesh.skeleton.update();
        const position = mesh.geometry.attributes.position;
        for (let index = 0; index < position.count; index++) {
          vertex.fromBufferAttribute(position, index);
          mesh.applyBoneTransform(index, vertex);
          minY = Math.min(minY, vertex.y);
        }
      }
      positions.push(V(0, minY < -.00001 ? -minY + .0005 : 0, 0));
    }
    mixer.stopAllAction();
    resetBones();
    clip.tracks.push(vectorTrack('Root', times, positions));
    return clip;
  };
  const hiddenTracks = (times) => effectBoneNames.map((name) => scaleTrack(name, times, times.map(() => EPS)));
  const swayTracks = (times, amount = 1) => [
    quaternionTrack('HairTuft', times, times.map((time) => q([Math.sin(time * 2.7) * .035 * amount, Math.sin(time * 2.1) * .03 * amount, Math.cos(time * 3.2) * .025 * amount]))),
  ];
  const clips = [];

  const idleTimes = [0, 1, 2, 3, 4];
  const idle = new THREE.AnimationClip('idle', 4, [
    quaternionTrack('Chest', idleTimes, idleTimes.map((time) => q([Math.sin(time / 4 * TAU) * .008, Math.sin(time / 4 * TAU * 2) * .005, 0]))),
    quaternionTrack('Head', idleTimes, idleTimes.map((time) => q([Math.sin(time / 4 * TAU + .4) * .007, Math.sin(time / 4 * TAU) * .01, 0]))),
    vectorTrack('Pelvis', idleTimes, idleTimes.map((time) => V(0, .92 + Math.sin(time / 4 * TAU) * .0025, 0))),
    ...swayTracks(idleTimes, .8),
    ...hiddenTracks(idleTimes),
  ]);
  clips.push(groundCorrect(idle));

  const walkTimes = Array.from({ length: 13 }, (_, index) => index / 12 * 1.2);
  const stride = walkTimes.map((time) => Math.sin(time / 1.2 * TAU));
  const walk = new THREE.AnimationClip('walk', 1.2, [
    quaternionTrack('ThighL', walkTimes, stride.map((value) => q([value * .25, 0, 0]))),
    quaternionTrack('ThighR', walkTimes, stride.map((value) => q([-value * .25, 0, 0]))),
    quaternionTrack('ShinL', walkTimes, stride.map((value) => q([Math.max(0, -value) * .36, 0, 0]))),
    quaternionTrack('ShinR', walkTimes, stride.map((value) => q([Math.max(0, value) * .36, 0, 0]))),
    quaternionTrack('FootL', walkTimes, stride.map((value) => q([-value * .12, 0, 0]))),
    quaternionTrack('FootR', walkTimes, stride.map((value) => q([value * .12, 0, 0]))),
    quaternionTrack('UpperArmL', walkTimes, stride.map((value) => q([-.04 + value * .08, 0, -.12]))),
    quaternionTrack('UpperArmR', walkTimes, stride.map((value) => q([-.10 - value * .08, 0, .13]))),
    quaternionTrack('Chest', walkTimes, stride.map((value) => q([.015, value * .022, 0]))),
    vectorTrack('Pelvis', walkTimes, walkTimes.map((time) => V(0, .92 + Math.abs(Math.sin(time / 1.2 * TAU)) * .014, 0))),
    ...swayTracks(walkTimes, 1.4),
    ...hiddenTracks(walkTimes),
  ]);
  clips.push(groundCorrect(walk));

  const castTimes = Array.from({ length: 25 }, (_, index) => index / 24 * 3);
  const castTracks = [
    quaternionTrack('Chest', castTimes, castTimes.map((time) => q([-.025 + Math.sin(time * 2.2) * .008, Math.sin(time * 1.4) * .012, 0]))),
    quaternionTrack('Head', castTimes, castTimes.map((time) => q([-.035 + Math.sin(time * 2.2 + .3) * .007, 0, 0]))),
    quaternionTrack('UpperArmR', castTimes, castTimes.map((time) => q([-.10 - Math.sin(time * 2.1) * .12, 0, .13 + Math.sin(time * 2.1) * .06]))),
    quaternionTrack('ForearmR', castTimes, castTimes.map((time) => q([-.34 - Math.sin(time * 2.1 + .4) * .16, 0, -.04]))),
    quaternionTrack('ScissorsR', castTimes, castTimes.map((time) => q([.22 + Math.sin(time * 2.1) * .16, 0, -.12 + Math.sin(time * 2.1) * .12]))),
    scaleTrack('BladeUpperR', castTimes, castTimes.map((time) => 1)),
    vectorTrack('CutRing', castTimes, castTimes.map((time) => V(0, 1.28, .38 + (time / 3 % 1) * .55))),
    scaleTrack('CutRing', castTimes, castTimes.map((time) => .35 + Math.sin(time / 3 * TAU) ** 2 * .85)),
    ...Slashes.flatMap((bone) => scaleTrack(bone.name, castTimes, castTimes.map(() => EPS))),
    ...swayTracks(castTimes, .7),
  ];
  clips.push(new THREE.AnimationClip('cast', 3, castTracks));

  const attackTimes = [0, .35, .58, .78, 1.02, 1.18, 1.38, 1.62, 1.78, 1.98, 2.4];
  const attackBreath = attackTimes.map((time) => ease(time / .35) * (1 - ease((time - 1.9) / .5)));
  const snap = (time, center) => Math.max(0, 1 - Math.abs(time - center) / .16);
  const attackTracks = [
    quaternionTrack('Chest', attackTimes, attackTimes.map((time, index) => q([-.10 * attackBreath[index], -.055 * attackBreath[index] + snap(time, 1.18) * .08, 0]))),
    quaternionTrack('Head', attackTimes, attackTimes.map((time) => q([-.06 * attackBreath[attackTimes.indexOf(time)], -.02, 0]))),
    quaternionTrack('UpperArmR', attackTimes, attackTimes.map((time) => q([-.10 - attackBreath[attackTimes.indexOf(time)] * .38 - snap(time, 1.18) * .28, 0, .13 - snap(time, 1.18) * .18]))),
    quaternionTrack('ForearmR', attackTimes, attackTimes.map((time) => q([-.34 - attackBreath[attackTimes.indexOf(time)] * .30 + snap(time, 1.18) * .42, 0, -.04]))),
    quaternionTrack('ScissorsR', attackTimes, attackTimes.map((time) => q([.22 + attackBreath[attackTimes.indexOf(time)] * .28 - snap(time, 1.18) * .45, 0, -.12 + snap(time, 1.18) * .22]))),
    scaleTrack('CutRing', attackTimes, attackTimes.map(() => EPS)),
    ...swayTracks(attackTimes, 1),
  ];
  for (const [index, center] of [.58, 1.18, 1.78].entries()) {
    const bone = Slashes[index];
    const progress = attackTimes.map((time) => clamp((time - (center - .16)) / .32));
    attackTracks.push(vectorTrack(bone.name, attackTimes, attackTimes.map((time, sample) => V((index - 1) * .18, 1.25 + Math.sin(time * 5 + index) * .025, .38 + progress[sample] * 1.15))));
    attackTracks.push(scaleTrack(bone.name, attackTimes, attackTimes.map((time) => time < center - .16 || time > center + .16 ? EPS : Math.sin(progress[attackTimes.indexOf(time)] * Math.PI) * 1.15 + .12)));
  }
  const openR = attackTimes.map((time) => .22 - Math.max(snap(time, .58), snap(time, 1.18), snap(time, 1.78)) * .19);
  const openL = attackTimes.map((time) => -.22 + Math.max(snap(time, .58), snap(time, 1.18), snap(time, 1.78)) * .19);
  attackTracks.push(quaternionTrack('BladeUpperR', attackTimes, openR.map((value) => q([0, 0, value]))));
  attackTracks.push(quaternionTrack('BladeLowerR', attackTimes, openL.map((value) => q([0, 0, value]))));
  clips.push(new THREE.AnimationClip('attack', 2.4, attackTracks));

  const flinchTimes = [0, .12, .3, .75];
  const flinch = new THREE.AnimationClip('flinch', .75, [
    quaternionTrack('Chest', flinchTimes, [q([0, 0, 0]), q([-.16, .10, .07]), q([.03, -.025, -.02]), q([0, 0, 0])]),
    quaternionTrack('Head', flinchTimes, [q([0, 0, 0]), q([.18, -.14, -.07]), q([-.025, .035, .012]), q([0, 0, 0])]),
    vectorTrack('Pelvis', flinchTimes, [V(0, .92, 0), V(0, .885, -.016), V(0, .915, 0), V(0, .92, 0)]),
    ...hiddenTracks(flinchTimes),
    ...swayTracks(flinchTimes, 1.7),
  ]);
  clips.push(groundCorrect(flinch));

  const cheerTimes = [0, .45, .9, 1.4, 1.9, 2.4];
  clips.push(new THREE.AnimationClip('cheer', 2.4, [
    quaternionTrack('Chest', cheerTimes, [q([0, 0, 0]), q([-.05, 0, 0]), q([-.09, -.035, 0]), q([-.035, .025, 0]), q([0, 0, 0]), q([0, 0, 0])]),
    quaternionTrack('Head', cheerTimes, [q([0, 0, 0]), q([-.07, .02, 0]), q([-.10, -.025, 0]), q([-.035, .025, 0]), q([.015, 0, 0]), q([0, 0, 0])]),
    quaternionTrack('UpperArmR', cheerTimes, cheerTimes.map((time, index) => q([-.10 - [0, .18, .34, .25, .08, 0][index], 0, .13]))),
    quaternionTrack('ForearmR', cheerTimes, cheerTimes.map((time, index) => q([-.34 - [0, .18, .30, .20, .05, 0][index], 0, -.04]))),
    vectorTrack('Pelvis', cheerTimes, cheerTimes.map((time, index) => V(0, .92 + [0, .005, .010, .007, .002, 0][index], 0))),
    ...hiddenTracks(cheerTimes),
    ...swayTracks(cheerTimes, 1.1),
  ]));

  const deadDuration = 1.5;
  const deadTimes = Array.from({ length: 46 }, (_, index) => index / 45 * deadDuration);
  const deadPositions = { Root: [], Pelvis: [] };
  const deadQuaternions = new Map(['Root', 'Pelvis', 'Chest', 'Head', 'UpperArmL', 'UpperArmR', 'ForearmL', 'ForearmR', 'ThighL', 'ThighR', 'ShinL', 'ShinR'].map((name) => [name, []]));
  const vertex = new THREE.Vector3();
  for (const time of deadTimes) {
    resetBones();
    const fall = ease((time - .12) / (deadDuration - .12));
    const bend = Math.sin(fall * Math.PI);
    Root.quaternion.copy(q([-1.52 * fall, 0, 0]));
    Root.position.set(0, 0, 0);
    Pelvis.position.y = .92 - bend * .07;
    Chest.quaternion.multiply(q([bend * .13, bend * .035, 0]));
    Head.quaternion.multiply(q([bend * .07, -bend * .05, 0]));
    for (const name of ['UpperArmL', 'UpperArmR', 'ForearmL', 'ForearmR']) boneMap.get(name).quaternion.multiply(q([bend * .11, 0, (name.endsWith('L') ? -1 : 1) * bend * .07]));
    for (const name of ['ThighL', 'ThighR']) boneMap.get(name).quaternion.multiply(q([-bend * .13, 0, 0]));
    for (const name of ['ShinL', 'ShinR']) boneMap.get(name).quaternion.multiply(q([bend * .26, 0, 0]));
    Root.parent.updateMatrixWorld(true);
    for (const mesh of meshes) mesh.skeleton.update();
    let minY = Infinity;
    for (const mesh of meshes) {
      const position = mesh.geometry.attributes.position;
      for (let index = 0; index < position.count; index++) {
        vertex.fromBufferAttribute(position, index);
        mesh.applyBoneTransform(index, vertex);
        minY = Math.min(minY, vertex.y);
      }
    }
    const correction = minY < -.00001 ? -minY + .0005 : 0;
    Root.position.y = correction;
    deadPositions.Root.push(V(0, correction, 0));
    deadPositions.Pelvis.push(Pelvis.position.clone());
    for (const [name, values] of deadQuaternions) values.push(boneMap.get(name).quaternion.clone());
  }
  const deadTracks = [
    vectorTrack('Root', deadTimes, deadPositions.Root),
    vectorTrack('Pelvis', deadTimes, deadPositions.Pelvis),
    ...[...deadQuaternions].map(([name, values]) => quaternionTrack(name, deadTimes, values)),
    ...hiddenTracks(deadTimes),
  ];
  const dead = new THREE.AnimationClip('dead', deadDuration, deadTracks);
  clips.push(dead);
  const revive = reverseClip(dead);
  revive.name = 'reviveRise';
  clips.push(revive);

  resetBones();
  return clips;
}
