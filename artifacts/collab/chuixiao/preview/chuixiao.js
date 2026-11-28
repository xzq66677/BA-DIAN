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
      const grain = (random() - .5) * 15;
      const weave = Math.sin(x * .31 + y * .17) * 2.2 + Math.sin(y * .43) * 1.4;
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
      const value = kind === 'roughness' ? 165 + grain * 70 : 225 + grain * 30;
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
        const normal = V((left - right) * 1.1, (up - down) * 1.1, 1).normalize();
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
    normalScale: new THREE.Vector2(options.normal ?? .14, options.normal ?? .14),
    clearcoat: options.clearcoat ?? 0,
    clearcoatRoughness: .6,
    sheen: options.sheen ?? 0,
    sheenColor: new THREE.Color(options.sheenColor ?? color),
    sheenRoughness: .8,
  });
  material.map.colorSpace = THREE.SRGBColorSpace;
  return material;
}

function createMaterials() {
  return {
    robe: pbrMaterial('celadon_outer_robe', '#3f7563', { seed: 3, roughness: .86, normal: .18, sheen: .35, sheenColor: '#8bb9a3' }),
    robeDark: pbrMaterial('deep_bamboo_trim', '#285447', { seed: 7, roughness: .82, normal: .16, sheen: .2 }),
    inner: pbrMaterial('rice_linen_inner_robe', '#d8ddc9', { seed: 11, roughness: .94, normal: .2, sheen: .18 }),
    sash: pbrMaterial('pale_jade_sash', '#a4cfb7', { seed: 17, roughness: .78, normal: .14, sheen: .3 }),
    bamboo: pbrMaterial('green_bamboo_flute', '#a8b982', { seed: 23, roughness: .56, normal: .12, clearcoat: .16 }),
    bambooDark: pbrMaterial('bamboo_nodes', '#567457', { seed: 29, roughness: .68, normal: .14 }),
    hair: pbrMaterial('ink_black_hair', '#171d1a', { seed: 37, roughness: .48, normal: .1, clearcoat: .12 }),
    hairLight: pbrMaterial('hair_strand_highlights', '#2c352e', { seed: 41, roughness: .56, normal: .1 }),
    skin: pbrMaterial('warm_skin', '#d5aa8c', { seed: 53, roughness: .66, normal: .08, clearcoat: .04 }),
    pants: pbrMaterial('dark_linen_trousers', '#263e35', { seed: 61, roughness: .9, normal: .18, sheen: .15 }),
    boots: pbrMaterial('black_green_cloth_boots', '#20352e', { seed: 67, roughness: .82, normal: .2 }),
    jade: pbrMaterial('carved_jade', '#74b99c', { seed: 73, roughness: .28, normal: .08, clearcoat: .5 }),
    eyeWhite: new THREE.MeshStandardMaterial({ name: 'warm_eye_white', color: '#d9d6c7', roughness: .52 }),
    eyeDark: new THREE.MeshStandardMaterial({ name: 'dark_iris', color: '#141a17', roughness: .3 }),
    lip: new THREE.MeshStandardMaterial({ name: 'closed_lips', color: '#936b5b', roughness: .72 }),
    sound: new THREE.MeshStandardMaterial({ name: 'resonant_jade_sound', color: '#a5ffe1', emissive: '#54d9b1', emissiveIntensity: 2.2, roughness: .28, transparent: true, opacity: .72, depthWrite: false }),
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

function ribbonGeometry(points, width) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    positions.push(point[0] - width / 2, point[1], point[2], point[0] + width / 2, point[1], point[2]);
    uvs.push(0, index / (points.length - 1), 1, index / (points.length - 1));
    if (index < points.length - 1) {
      const offset = index * 2;
      indices.push(offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
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

function tubeGeometry(points, radius, segments = 16, radial = 7) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, radius, radial, false);
}

function eyeGeometry(width, height) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.quadraticCurveTo(0, height / 2, width / 2, 0);
  shape.quadraticCurveTo(0, -height / 2, -width / 2, 0);
  return new THREE.ShapeGeometry(shape, 10);
}

function sculptedHeadGeometry() {
  const geometry = new THREE.SphereGeometry(1, 32, 24);
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const jaw = 1 - Math.max(0, -y) * .24;
    const cheek = 1 + Math.exp(-Math.pow((y + .05) * 5, 2)) * .045;
    position.setXYZ(index, x * .145 * jaw * cheek, .12 + y * .205, z * .134 * (1 - Math.max(0, -y) * .1));
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

function solveArm(upper, forearm, hand, target, bendDirection) {
  const shoulder = upper.getWorldPosition(new THREE.Vector3());
  const parentRest = upper.parent.getWorldQuaternion(new THREE.Quaternion());
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
  const upperWorld = new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), upperDirection);
  const lowerWorld = new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), lowerDirection);
  return {
    upper: parentRest.clone().invert().multiply(upperWorld),
    forearm: upperWorld.clone().invert().multiply(lowerWorld),
    hand: lowerWorld.clone().invert(),
  };
}

export function createChuixiao() {
  const materials = createMaterials();
  const root = new THREE.Group();
  root.name = 'Chuixiao';
  root.userData = {
    visualId: 'chuixiao-v1',
    suggestedCharId: 'chuixiao',
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
  const Pelvis = addBone('Pelvis', Root, V(0, 1, 0));
  const Spine = addBone('Spine', Pelvis, V(0, .18, 0));
  const Chest = addBone('Chest', Spine, V(0, .22, 0));
  const Neck = addBone('Neck', Chest, V(0, .25, 0));
  const Head = addBone('Head', Neck, V(0, .11, 0));
  Head.scale.setScalar(.92);
  const UpperArmL = addBone('UpperArmL', Chest, V(-.245, .17, 0));
  const ForearmL = addBone('ForearmL', UpperArmL, V(0, -.29, 0));
  const HandL = addBone('HandL', ForearmL, V(0, -.26, 0));
  const UpperArmR = addBone('UpperArmR', Chest, V(.245, .17, 0));
  const ForearmR = addBone('ForearmR', UpperArmR, V(0, -.29, 0));
  const HandR = addBone('HandR', ForearmR, V(0, -.26, 0));
  const ThighL = addBone('ThighL', Pelvis, V(-.115, -.02, 0));
  const ShinL = addBone('ShinL', ThighL, V(0, -.44, 0));
  const FootL = addBone('FootL', ShinL, V(0, -.45, .02));
  const ThighR = addBone('ThighR', Pelvis, V(.115, -.02, 0));
  const ShinR = addBone('ShinR', ThighR, V(0, -.44, 0));
  const FootR = addBone('FootR', ShinR, V(0, -.45, .02));
  const SashTailL = addBone('SashTailL', Pelvis, V(-.045, -.015, .165));
  const SashTailR = addBone('SashTailR', Pelvis, V(.045, -.015, .165));
  const HairTail = addBone('HairTail', Head, V(0, .29, -.075));
  const Flute = addBone('Flute', Head, V(0, .005, .145));
  Flute.rotation.set(0, -.12, -.18);
  const Qi = addBone('Qi', Flute, V(.035, .018, .035));
  const SoundRings = [0, 1, 2].map((index) => addBone(`SoundRing${index}`, Root, V(0, 1.79, .3 + index * .12)));
  const Notes = [0, 1, 2].map((index) => addBone(`Note${index}`, Root, V(.02, 1.76, .35 + index * .1)));
  const effectBoneNames = ['Qi', ...SoundRings.map((bone) => bone.name), ...Notes.map((bone) => bone.name)];

  root.updateMatrixWorld(true);
  const leftTarget = Flute.localToWorld(V(.18, -.005, 0));
  const rightTarget = Flute.localToWorld(V(.43, -.005, 0));
  const leftArm = solveArm(UpperArmL, ForearmL, HandL, leftTarget, V(-.65, -.8, .35));
  const rightArm = solveArm(UpperArmR, ForearmR, HandR, rightTarget, V(.65, -.8, .35));
  UpperArmL.quaternion.copy(leftArm.upper);
  ForearmL.quaternion.copy(leftArm.forearm);
  HandL.quaternion.copy(leftArm.hand);
  UpperArmR.quaternion.copy(rightArm.upper);
  ForearmR.quaternion.copy(rightArm.forearm);
  HandR.quaternion.copy(rightArm.hand);
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
  const robeWeights = (position) => {
    const y = position.y;
    if (y < .98) return [['Pelvis', 1]];
    if (y < 1.2) return [['Pelvis', 1 - (y - .98) / .22], ['Spine', (y - .98) / .22]];
    if (y < 1.42) return [['Spine', 1 - (y - 1.2) / .22], ['Chest', (y - 1.2) / .22]];
    return [['Chest', 1]];
  };

  const robeRings = [
    { y: .14, rx: .30, rz: .215 }, { y: .24, rx: .292, rz: .21 }, { y: .44, rx: .272, rz: .198 },
    { y: .68, rx: .248, rz: .184 }, { y: .92, rx: .218, rz: .165 }, { y: 1.08, rx: .196, rz: .15 },
    { y: 1.26, rx: .208, rz: .153 }, { y: 1.43, rx: .242, rz: .142 }, { y: 1.52, rx: .208, rz: .125 },
    { y: 1.58, rx: .098, rz: .082 },
  ];
  part(root, 'Robe', loftGeometry(robeRings, 40, .022), materials.robe, { weights: robeWeights });
  const panelRows = [
    { y: .17, width: .095, rx: .30, rz: .215 }, { y: .34, width: .088, rx: .284, rz: .205 },
    { y: .58, width: .078, rx: .26, rz: .19 }, { y: .82, width: .068, rx: .232, rz: .173 },
    { y: 1.06, width: .058, rx: .198, rz: .151 }, { y: 1.28, width: .061, rx: .21, rz: .154 },
    { y: 1.47, width: .072, rx: .235, rz: .14 }, { y: 1.56, width: .052, rx: .15, rz: .105 },
  ];
  part(root, 'InnerRobe', frontPanelGeometry(panelRows, 10), materials.inner, { weights: robeWeights });
  part(root, 'HemTrim', new THREE.TubeGeometry(ellipseCurve(.301, .217, .155), 64, .009, 6, true), materials.robeDark, { weights: () => [['Pelvis', 1]] });
  part(root, 'CollarL', tubeGeometry([V(-.075, 1.585, .085), V(-.115, 1.49, .125), V(-.07, 1.34, .157), V(0, 1.13, .171)], .012, 20), materials.sash, { weights: () => [['Chest', 1]] });
  part(root, 'CollarR', tubeGeometry([V(.075, 1.585, .085), V(.115, 1.49, .125), V(.07, 1.34, .157), V(0, 1.13, .171)], .012, 20), materials.sash, { weights: () => [['Chest', 1]] });
  part(root, 'SashBand', loftGeometry([{ y: 1.045, rx: .202, rz: .156 }, { y: 1.125, rx: .204, rz: .157 }], 40, 0), materials.sash, { weights: () => [['Pelvis', 1]] });
  part(root, 'Pelvis', new THREE.SphereGeometry(1, 16, 10), materials.sash, { position: [0, 1.085, .174], scale: [.055, .038, .028] });
  part(SashTailL, 'SashTailL', ribbonGeometry([[0, 0, 0], [.018, -.12, .012], [-.012, -.25, .018], [.014, -.39, .008]], .048), materials.sash);
  part(SashTailR, 'SashTailR', ribbonGeometry([[0, 0, 0], [-.018, -.1, .01], [.015, -.23, .02], [-.012, -.34, .006]], .043), materials.sash);
  for (const [boneName, x] of [['SashTailL', .014], ['SashTailR', -.012]]) {
    const parent = boneMap.get(boneName);
    const endY = boneName === 'SashTailL' ? -.39 : -.34;
    part(parent, boneName, new THREE.CylinderGeometry(.012, .008, .055, 8), materials.jade, { position: [x, endY - .02, .008] });
  }

  for (const side of [-1, 1]) {
    const upper = side < 0 ? UpperArmL : UpperArmR;
    const forearm = side < 0 ? ForearmL : ForearmR;
    part(upper, upper.name, loftGeometry([{ y: .015, rx: .105, rz: .10 }, { y: -.09, rx: .128, rz: .12 }, { y: -.22, rx: .158, rz: .145 }, { y: -.30, rx: .175, rz: .158 }], 24, .008, false), materials.robe);
    part(forearm, forearm.name, loftGeometry([{ y: .015, rx: .164, rz: .15 }, { y: -.10, rx: .15, rz: .137 }, { y: -.225, rx: .112, rz: .102 }, { y: -.255, rx: .086, rz: .078 }], 24, .006, false), materials.robe);
    part(forearm, forearm.name, new THREE.TorusGeometry(.084, .009, 6, 24), materials.inner, { position: [0, -.252, 0], rotation: [Math.PI / 2, 0, 0], scale: [1, .92, 1] });
    const thigh = side < 0 ? ThighL : ThighR;
    const shin = side < 0 ? ShinL : ShinR;
    const foot = side < 0 ? FootL : FootR;
    part(thigh, thigh.name, new THREE.CylinderGeometry(.073, .062, .42, 12), materials.pants, { position: [0, -.21, 0] });
    part(shin, shin.name, new THREE.CylinderGeometry(.06, .045, .42, 12), materials.pants, { position: [0, -.21, 0] });
    part(foot, foot.name, rounded(.17, .09, .30, .025), materials.boots, { position: [0, -.045, .07] });
    part(foot, foot.name, rounded(.175, .018, .305, .006), materials.robeDark, { position: [0, -.081, .07] });
  }

  part(Neck, 'Neck', new THREE.CylinderGeometry(.052, .058, .15, 14), materials.skin, { position: [0, .035, 0] });
  part(Head, 'Head', sculptedHeadGeometry(), materials.skin);
  for (const side of [-1, 1]) {
    ellipsoid(Head, 'Head', materials.skin, [side * .143, .115, -.005], [.025, .043, .018]);
    const eye = part(Head, 'Head', eyeGeometry(.056, .023), materials.eyeWhite, { position: [side * .056, .151, .126], rotation: [0, side * .08, side * -.07] });
    eye.material.side = THREE.DoubleSide;
    ellipsoid(Head, 'Head', materials.eyeDark, [side * .054, .15, .1305], [.0085, .009, .003], 12);
    part(Head, 'Head', tubeGeometry([V(side * .024, .194, .122), V(side * .057, .201, .119), V(side * .094, .208, .103)], .0065, 10, 6), materials.hair);
    part(Head, 'Head', tubeGeometry([V(side * .024, .174, .124), V(side * .057, .177, .126), V(side * .091, .17, .113)], .003, 10, 5), materials.lip);
  }
  ellipsoid(Head, 'Head', materials.skin, [0, .103, .128], [.012, .042, .017]);
  ellipsoid(Head, 'Head', materials.skin, [0, .066, .146], [.019, .014, .022]);
  part(Head, 'Head', tubeGeometry([V(-.038, .018, .13), V(0, .012, .139), V(.038, .018, .13)], .0045, 12, 6), materials.lip);
  part(Head, 'Head', new THREE.SphereGeometry(1, 28, 18, 0, TAU, 0, 1.47), materials.hair, { position: [0, .13, -.013], scale: [.153, .216, .143] });
  for (let index = -2; index <= 2; index++) {
    const x = index * .038;
    part(Head, 'Head', tubeGeometry([V(x * .78, .272, .096), V(x, .326, .047), V(x * .55, .372, -.045)], .0028, 12, 5), materials.hairLight);
  }
  for (const side of [-1, 1]) {
    part(Head, 'Head', tubeGeometry([V(side * .12, .245, .025), V(side * .147, .16, -.015), V(side * .132, .045, -.062), V(side * .105, -.035, -.072)], .018, 18, 7), materials.hair);
    part(Head, 'Head', tubeGeometry([V(side * .105, .267, .062), V(side * .124, .215, .094), V(side * .118, .14, .102)], .008, 12, 6), materials.hairLight);
  }
  ellipsoid(Head, 'Head', materials.hair, [0, .355, -.025], [.072, .088, .068]);
  part(Head, 'Head', new THREE.TorusGeometry(.058, .009, 6, 20), materials.jade, { position: [0, .323, -.025], rotation: [Math.PI / 2, 0, 0] });
  part(Head, 'Head', new THREE.CylinderGeometry(.006, .006, .22, 8), materials.bamboo, { position: [0, .385, -.025], rotation: [0, 0, Math.PI / 2] });
  part(HairTail, 'HairTail', tubeGeometry([V(0, 0, 0), V(.025, -.12, -.035), V(-.018, -.27, -.055), V(.035, -.40, -.025)], .034, 22, 8), materials.hair);
  part(HairTail, 'HairTail', tubeGeometry([V(.012, -.03, -.005), V(.05, -.17, -.04), V(.02, -.32, -.06), V(.055, -.43, -.02)], .009, 18, 6), materials.hairLight);

  part(Flute, 'Flute', new THREE.CylinderGeometry(.017, .018, .58, 12), materials.bamboo, { position: [.29, 0, 0], rotation: [0, 0, -Math.PI / 2] });
  for (const x of [.09, .27, .45]) part(Flute, 'Flute', new THREE.TorusGeometry(.0185, .003, 5, 14), materials.bambooDark, { position: [x, 0, 0], rotation: [0, Math.PI / 2, 0] });
  for (const x of [.16, .23, .31, .39, .47]) ellipsoid(Flute, 'Flute', materials.bambooDark, [x, .009, .015], [.0042, .0042, .002], 8);
  part(Flute, 'Flute', tubeGeometry([V(.575, 0, 0), V(.615, -.055, .008), V(.63, -.105, .012)], .0035, 10, 5), materials.sash);
  ellipsoid(Flute, 'Flute', materials.jade, [.63, -.12, .012], [.015, .022, .012], 10);
  part(Flute, 'Flute', new THREE.ConeGeometry(.014, .065, 8), materials.sash, { position: [.63, -.165, .012], rotation: [0, 0, Math.PI] });

  for (const [hand, grip, side] of [[HandL, .18, -1], [HandR, .43, 1]]) {
    const palm = Flute.localToWorld(V(grip, -.041, -.006));
    ellipsoid(root, hand.name, materials.skin, palm.toArray(), [.043, .057, .025]);
    for (let finger = 0; finger < 4; finger++) {
      const offset = (finger - 1.5) * .014;
      const points = [
        Flute.localToWorld(V(grip + offset, -.052, -.004)),
        Flute.localToWorld(V(grip + offset, -.026, .023)),
        Flute.localToWorld(V(grip + offset, .004, .027)),
        Flute.localToWorld(V(grip + offset, .019, .009)),
      ];
      part(root, hand.name, tubeGeometry(points, .0068 - finger * .00025, 12, 6), materials.skin);
    }
    const thumb = [
      Flute.localToWorld(V(grip + side * .036, -.038, -.012)),
      Flute.localToWorld(V(grip + side * .046, -.012, .014)),
      Flute.localToWorld(V(grip + side * .025, .006, .025)),
    ];
    part(root, hand.name, tubeGeometry(thumb, .008, 12, 6), materials.skin);
  }

  ellipsoid(Qi, 'Qi', materials.sound, [0, 0, 0], [.04, .04, .04], 12);
  SoundRings.forEach((bone) => part(bone, bone.name, new THREE.TorusGeometry(.12, .0055, 6, 40), materials.sound));
  Notes.forEach((bone) => {
    ellipsoid(bone, bone.name, materials.sound, [-.028, 0, 0], [.032, .022, .012], 12);
    part(bone, bone.name, new THREE.CylinderGeometry(.005, .005, .14, 7), materials.sound, { position: [.015, .072, 0] });
    part(bone, bone.name, ribbonGeometry([[.015, .14, 0], [.065, .115, 0], [.052, .075, 0]], .026), materials.sound);
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
    const skinWeights = new Uint8Array(count * 4);
    const position = indexed.attributes.position;
    for (let index = 0; index < count; index++) {
      const weights = item.weights ? item.weights(V(position.getX(index), position.getY(index), position.getZ(index))) : [[item.boneName, 1]];
      const total = weights.reduce((sum, entry) => sum + entry[1], 0) || 1;
      for (let slot = 0; slot < 4; slot++) {
        const entry = weights[slot];
        skinIndices[index * 4 + slot] = entry ? boneIndices.get(entry[0]) : 0;
        skinWeights[index * 4 + slot] = entry ? Math.round(entry[1] / total * 255) : 0;
      }
    }
    indexed.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(skinIndices, 4));
    indexed.setAttribute('skinWeight', new THREE.Uint8BufferAttribute(skinWeights, 4, true));
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
    mesh.name = `Chuixiao_${material.name}`;
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
  const clips = createClips({ bones, boneMap, meshes, restPose, effectBoneNames, SoundRings, Notes, Qi, SashTailL, SashTailR, HairTail });
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
  const { bones, boneMap, meshes, restPose, effectBoneNames, SoundRings, Notes, Qi, SashTailL, SashTailR, HairTail } = context;
  const Root = boneMap.get('Root');
  const Pelvis = boneMap.get('Pelvis');
  const Spine = boneMap.get('Spine');
  const Chest = boneMap.get('Chest');
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
    const times = [...new Set(clip.tracks.flatMap((track) => [...track.times]))].sort((a, b) => a - b);
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
  const clips = [];
  const hiddenTracks = (times) => effectBoneNames.map((name) => scaleTrack(name, times, times.map(() => EPS)));
  const swayTracks = (times, amount = 1) => [
    quaternionTrack('SashTailL', times, times.map((time) => q([Math.sin(time * 3.1) * .07 * amount, 0, Math.sin(time * 2.4) * .06 * amount]))),
    quaternionTrack('SashTailR', times, times.map((time) => q([Math.sin(time * 3.1 + 1.2) * .07 * amount, 0, Math.sin(time * 2.4 + .8) * .06 * amount]))),
    quaternionTrack('HairTail', times, times.map((time) => q([Math.sin(time * 2.2 + .4) * .045 * amount, Math.sin(time * 1.7) * .04 * amount, Math.cos(time * 2.6) * .035 * amount]))),
  ];

  const idleTimes = [0, 1, 2, 3, 4];
  const idle = new THREE.AnimationClip('idle', 4, [
    quaternionTrack('Chest', idleTimes, idleTimes.map((time) => q([Math.sin(time / 4 * TAU) * .009, Math.sin(time / 4 * TAU * 2) * .006, 0]))),
    quaternionTrack('Head', idleTimes, idleTimes.map((time) => q([Math.sin(time / 4 * TAU + .5) * .008, Math.sin(time / 4 * TAU) * .012, 0]))),
    vectorTrack('Pelvis', idleTimes, idleTimes.map((time) => V(0, 1 + Math.sin(time / 4 * TAU) * .003, 0))),
    ...swayTracks(idleTimes, .8),
    ...hiddenTracks(idleTimes),
  ]);
  clips.push(groundCorrect(idle));

  const walkTimes = Array.from({ length: 13 }, (_, index) => index / 12 * 1.2);
  const stride = walkTimes.map((time) => Math.sin(time / 1.2 * TAU));
  const walk = new THREE.AnimationClip('walk', 1.2, [
    quaternionTrack('ThighL', walkTimes, stride.map((value) => q([value * .24, 0, 0]))),
    quaternionTrack('ThighR', walkTimes, stride.map((value) => q([-value * .24, 0, 0]))),
    quaternionTrack('ShinL', walkTimes, stride.map((value) => q([Math.max(0, -value) * .34, 0, 0]))),
    quaternionTrack('ShinR', walkTimes, stride.map((value) => q([Math.max(0, value) * .34, 0, 0]))),
    quaternionTrack('FootL', walkTimes, stride.map((value) => q([-value * .12, 0, 0]))),
    quaternionTrack('FootR', walkTimes, stride.map((value) => q([value * .12, 0, 0]))),
    quaternionTrack('Chest', walkTimes, stride.map((value) => q([.018, value * .028, 0]))),
    vectorTrack('Pelvis', walkTimes, walkTimes.map((time) => V(0, 1 + Math.abs(Math.sin(time / 1.2 * TAU)) * .018, 0))),
    ...swayTracks(walkTimes, 1.5),
    ...hiddenTracks(walkTimes),
  ]);
  clips.push(groundCorrect(walk));

  const castTimes = Array.from({ length: 25 }, (_, index) => index / 24 * 3);
  const castTracks = [
    quaternionTrack('Chest', castTimes, castTimes.map((time) => q([-.035 + Math.sin(time * 2.1) * .008, Math.sin(time * 1.3) * .012, 0]))),
    quaternionTrack('Head', castTimes, castTimes.map((time) => q([-.045 + Math.sin(time * 2.1 + .4) * .009, 0, 0]))),
    scaleTrack('Qi', castTimes, castTimes.map((time) => .72 + Math.sin(time * 4.2) * .18)),
  ];
  SoundRings.forEach((bone, index) => {
    const phase = castTimes.map((time) => (time / 3 + index / 3) % 1);
    castTracks.push(vectorTrack(bone.name, castTimes, phase.map((value) => V(0, 1.79, .28 + value * 1.5))));
    castTracks.push(scaleTrack(bone.name, castTimes, phase.map((value) => Math.max(EPS, Math.sin(value * Math.PI) * 1.25))));
  });
  Notes.forEach((bone) => castTracks.push(scaleTrack(bone.name, castTimes, castTimes.map(() => EPS))));
  clips.push(new THREE.AnimationClip('cast', 3, [...castTracks, ...swayTracks(castTimes, .65)]));

  const attackTimes = [0, .35, .65, .9, 1.05, 1.25, 1.6, 1.95, 2.4];
  const breath = attackTimes.map((time) => ease(time / .65) * (1 - ease((time - .9) / .65)));
  const attackTracks = [
    quaternionTrack('Chest', attackTimes, attackTimes.map((time, index) => q([-.13 * breath[index], -.035 * breath[index], 0]))),
    quaternionTrack('Head', attackTimes, attackTimes.map((time, index) => q([-.09 * breath[index], -.02 * breath[index], 0]))),
    vectorTrack('Pelvis', attackTimes, attackTimes.map((time, index) => V(0, 1 + .008 * breath[index], 0))),
    scaleTrack('Qi', attackTimes, [EPS, .35, .85, 1.2, .75, EPS, EPS, EPS, EPS]),
  ];
  SoundRings.forEach((bone, index) => {
    const launch = .92 + index * .09;
    const positions = attackTimes.map((time) => V(0, 1.79, time < launch ? .28 : .28 + (time - launch) * 2.25));
    const scales = attackTimes.map((time) => time < launch || time > launch + .72 ? EPS : Math.sin(clamp((time - launch) / .72) * Math.PI) * 1.45 + .15);
    attackTracks.push(vectorTrack(bone.name, attackTimes, positions));
    attackTracks.push(scaleTrack(bone.name, attackTimes, scales));
  });
  Notes.forEach((bone, index) => {
    const launch = 1.02 + index * .1;
    const positions = attackTimes.map((time) => V(.02 + index * .025, 1.76 + Math.sin(time * 3 + index) * .035, time < launch ? .35 : .35 + (time - launch) * 2.15));
    const scales = attackTimes.map((time) => time < launch || time > launch + .82 ? EPS : Math.min(1, (time - launch) * 8) * (1 - ease((time - launch - .62) / .2)));
    attackTracks.push(vectorTrack(bone.name, attackTimes, positions));
    attackTracks.push(scaleTrack(bone.name, attackTimes, scales));
  });
  clips.push(new THREE.AnimationClip('attack', 2.4, [...attackTracks, ...swayTracks(attackTimes, .8)]));

  const flinchTimes = [0, .12, .3, .75];
  const flinch = new THREE.AnimationClip('flinch', .75, [
    quaternionTrack('Chest', flinchTimes, [q([0, 0, 0]), q([-.18, .12, .08]), q([.035, -.03, -.02]), q([0, 0, 0])]),
    quaternionTrack('Head', flinchTimes, [q([0, 0, 0]), q([.2, -.16, -.08]), q([-.03, .04, .015]), q([0, 0, 0])]),
    vectorTrack('Pelvis', flinchTimes, [V(0, 1, 0), V(0, .965, -.018), V(0, .995, 0), V(0, 1, 0)]),
    ...hiddenTracks(flinchTimes),
    ...swayTracks(flinchTimes, 1.8),
  ]);
  clips.push(groundCorrect(flinch));

  const cheerTimes = [0, .45, .9, 1.4, 1.9, 2.4];
  clips.push(new THREE.AnimationClip('cheer', 2.4, [
    quaternionTrack('Chest', cheerTimes, [q([0, 0, 0]), q([-.06, 0, 0]), q([-.1, -.04, 0]), q([-.04, .03, 0]), q([0, 0, 0]), q([0, 0, 0])]),
    quaternionTrack('Head', cheerTimes, [q([0, 0, 0]), q([-.08, .02, 0]), q([-.12, -.03, 0]), q([-.04, .04, 0]), q([.02, 0, 0]), q([0, 0, 0])]),
    quaternionTrack('ForearmL', cheerTimes, cheerTimes.map((time, index) => restPose.get('ForearmL').quaternion.clone().multiply(q([0, 0, index === 2 ? -.22 : index === 3 ? .12 : 0])))),
    vectorTrack('Pelvis', cheerTimes, cheerTimes.map((time, index) => V(0, 1 + [0, .006, .012, .008, .002, 0][index], 0))),
    ...hiddenTracks(cheerTimes),
    ...swayTracks(cheerTimes, 1.1),
  ]));

  const deadDuration = 1.5;
  const deadTimes = Array.from({ length: 46 }, (_, index) => index / 45 * deadDuration);
  const deadPositions = { Root: [], Pelvis: [] };
  const deadQuaternions = new Map(['Root', 'Pelvis', 'Spine', 'Chest', 'Head', 'UpperArmL', 'UpperArmR', 'ForearmL', 'ForearmR', 'ThighL', 'ThighR', 'ShinL', 'ShinR'].map((name) => [name, []]));
  const vertex = new THREE.Vector3();
  for (const time of deadTimes) {
    for (const bone of bones) {
      const rest = restPose.get(bone.name);
      bone.position.copy(rest.position);
      bone.quaternion.copy(rest.quaternion);
      bone.scale.copy(rest.scale);
    }
    const fall = ease((time - .12) / (deadDuration - .12));
    const bend = Math.sin(fall * Math.PI);
    Root.quaternion.copy(q([-1.52 * fall, 0, 0]));
    Root.position.set(0, 0, 0);
    Pelvis.position.y = 1 - bend * .09;
    Spine.quaternion.multiply(q([bend * .08, 0, 0]));
    Chest.quaternion.multiply(q([bend * .14, bend * .04, 0]));
    boneMap.get('Head').quaternion.multiply(q([bend * .08, -bend * .06, 0]));
    for (const name of ['UpperArmL', 'UpperArmR', 'ForearmL', 'ForearmR']) boneMap.get(name).quaternion.multiply(q([bend * .12, 0, (name.endsWith('L') ? -1 : 1) * bend * .08]));
    for (const name of ['ThighL', 'ThighR']) boneMap.get(name).quaternion.multiply(q([-bend * .14, 0, 0]));
    for (const name of ['ShinL', 'ShinR']) boneMap.get(name).quaternion.multiply(q([bend * .28, 0, 0]));
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

  for (const bone of bones) {
    const rest = restPose.get(bone.name);
    bone.position.copy(rest.position);
    bone.quaternion.copy(rest.quaternion);
    bone.scale.copy(rest.scale);
  }
  Root.parent.updateMatrixWorld(true);
  return clips;
}
