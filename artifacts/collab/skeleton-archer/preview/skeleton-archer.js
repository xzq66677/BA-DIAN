import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const EPS = 0.0001;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DOWN = V(0, -1, 0);
const FORWARD = V(0, 0, 1);
const clamp = (value) => Math.max(0, Math.min(1, value));
const ease = (value) => { const t = clamp(value); return t * t * (3 - 2 * t); };

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
      const grain = (random() - .5) * 18;
      const wave = Math.sin(x * .21 + y * .13) * 2.5;
      image.data[index] = Math.max(0, Math.min(255, base.r * 255 + grain + wave));
      image.data[index + 1] = Math.max(0, Math.min(255, base.g * 255 + grain + wave));
      image.data[index + 2] = Math.max(0, Math.min(255, base.b * 255 + grain + wave));
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
      const value = kind === 'roughness' ? 150 + grain * 80 : 205 + grain * 50;
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
    map: canvasTexture(color, seed),
    roughness: options.roughness ?? .7,
    roughnessMap: scalarTexture('roughness', seed + 17),
    metalness: options.metalness ?? 0,
    metalnessMap: scalarTexture('metalness', seed + 31),
    normalMap: scalarTexture('normal', seed + 47),
    normalScale: new THREE.Vector2(options.normal ?? .16, options.normal ?? .16),
    clearcoat: options.clearcoat ?? 0,
    clearcoatRoughness: .55,
  });
  material.map.colorSpace = THREE.SRGBColorSpace;
  return material;
}

function createMaterials() {
  return {
    bone: pbrMaterial('aged_ivory_bone', '#d8c69d', { seed: 3, roughness: .68, clearcoat: .08, normal: .12 }),
    boneDark: pbrMaterial('scorched_bone', '#a58e68', { seed: 7, roughness: .78, normal: .2 }),
    leather: pbrMaterial('cracked_leather', '#4a251c', { seed: 11, roughness: .9, normal: .28 }),
    wood: pbrMaterial('yew_bow_wood', '#5b301f', { seed: 17, roughness: .62, normal: .2 }),
    iron: pbrMaterial('blackened_iron', '#343b40', { seed: 23, roughness: .34, metalness: .82, normal: .12 }),
    string: pbrMaterial('bowstring_hemp', '#b7a47f', { seed: 29, roughness: .92, normal: .1 }),
    socket: new THREE.MeshStandardMaterial({ name: 'deep_eye_socket', color: '#100d0c', roughness: .96 }),
    flameOuter: new THREE.MeshStandardMaterial({ name: 'fire_outer', color: '#ff5b0a', emissive: '#ff2600', emissiveIntensity: 2.8, roughness: .45, transparent: true, opacity: .86, depthWrite: false }),
    flameInner: new THREE.MeshStandardMaterial({ name: 'fire_inner', color: '#ffd35a', emissive: '#ff9d1c', emissiveIntensity: 2.4, roughness: .35, transparent: true, opacity: .92, depthWrite: false }),
    ash: new THREE.MeshStandardMaterial({ name: 'burning_ash', color: '#392c28', emissive: '#7a1d08', emissiveIntensity: .45, roughness: 1, transparent: true, opacity: .38, depthWrite: false }),
  };
}

function sculptedSkullGeometry() {
  const geometry = new THREE.SphereGeometry(.17, 32, 24);
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index);
    const y = position.getY(index);
    let z = position.getZ(index);
    const front = THREE.MathUtils.smoothstep(z, .025, .12);
    for (const eyeX of [-.081, .081]) {
      const dx = (x - eyeX) / .074;
      const dy = (y + .012) / .068;
      const cavity = Math.max(0, 1 - dx * dx - dy * dy);
      z -= .092 * Math.pow(cavity, 1.25) * front;
    }
    const nasal = Math.exp(-(x * x / .0007 + (y - .005) * (y - .005) / .003));
    z -= .028 * nasal * front;
    const face = Math.max(0, 1 - x * x / .0225) * Math.max(0, 1 - (y - .025) * (y - .025) / .04);
    z -= .024 * face * front;
    position.setZ(index, z);
  }
  const sourceIndex = geometry.index.array;
  const faceIndex = [];
  for (let offset = 0; offset < sourceIndex.length; offset += 3) {
    const a = sourceIndex[offset];
    const b = sourceIndex[offset + 1];
    const c = sourceIndex[offset + 2];
    const x = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
    const y = (position.getY(a) + position.getY(b) + position.getY(c)) / 3;
    const z = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
    const browLine = .105 - .045 * Math.pow(Math.abs(x) / .145, 2);
    if (!(z > .032 && y < browLine && y > -.165 && Math.abs(x) < .145)) faceIndex.push(a, b, c);
  }
  geometry.setIndex(faceIndex);
  geometry.computeVertexNormals();
  return geometry;
}

function flameGeometry(height = .2, radius = .06, bend = 0) {
  const points = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(radius * .72, height * .12),
    new THREE.Vector2(radius, height * .34),
    new THREE.Vector2(radius * .72, height * .58),
    new THREE.Vector2(radius * .38, height * .78),
    new THREE.Vector2(0, height),
  ];
  const geometry = new THREE.LatheGeometry(points, 10);
  if (bend !== 0) {
    const position = geometry.attributes.position;
    for (let index = 0; index < position.count; index++) {
      const progress = position.getY(index) / height;
      position.setX(index, position.getX(index) + bend * progress * progress);
      position.setZ(index, position.getZ(index) + bend * .22 * Math.sin(progress * Math.PI));
    }
    geometry.computeVertexNormals();
  }
  return geometry;
}

function plateGeometry(points, holes = [], depth = .014) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index++) shape.lineTo(points[index][0], points[index][1]);
  shape.closePath();
  for (const hole of holes) {
    const path = new THREE.Path();
    path.absellipse(hole[0], hole[1], hole[2], hole[3], 0, TAU, true);
    shape.holes.push(path);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: .003, bevelThickness: .003, bevelSegments: 1, curveSegments: 8 });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function quaternionTrack(name, times, quaternions) {
  return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, quaternions.flatMap((quaternion) => quaternion.toArray()));
}

function vectorTrack(name, times, vectors) {
  return new THREE.VectorKeyframeTrack(`${name}.position`, times, vectors.flatMap((vector) => vector.toArray()));
}

function scaleTrack(name, times, scales) {
  return new THREE.VectorKeyframeTrack(`${name}.scale`, times, scales.flatMap((scale) => (Array.isArray(scale) ? scale : [scale, scale, scale])));
}

function reverseClip(clip) {
  const tracks = clip.tracks.map((track) => {
    const stride = track.values.length / track.times.length;
    const times = [...track.times].reverse().map((time) => clip.duration - time);
    const values = [];
    for (let index = track.values.length - stride; index >= 0; index -= stride) {
      values.push(...track.values.slice(index, index + stride));
    }
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
  const upperWorld = new THREE.Quaternion().setFromUnitVectors(DOWN, upperDirection);
  const lowerWorld = new THREE.Quaternion().setFromUnitVectors(DOWN, lowerDirection);
  const upperLocal = parentRest.clone().invert().multiply(upperWorld);
  const lowerLocal = upperWorld.clone().invert().multiply(lowerWorld);
  const handWorld = new THREE.Quaternion();
  const handLocal = lowerWorld.clone().invert().multiply(handWorld);
  return { upper: upperLocal, forearm: lowerLocal, hand: handLocal };
}

function stringPose(nockLocal) {
  const top = V(0, .38, .10);
  const bottom = V(0, -.38, .10);
  const restNock = V(0, 0, -.12);
  const solve = (tip) => {
    const restDirection = restNock.clone().sub(tip);
    const desiredDirection = nockLocal.clone().sub(tip);
    return {
      quaternion: new THREE.Quaternion().setFromUnitVectors(restDirection.clone().normalize(), desiredDirection.clone().normalize()),
      scale: desiredDirection.length() / restDirection.length(),
    };
  };
  return { upper: solve(top), lower: solve(bottom) };
}

export function createSkeletonArcher() {
  const materials = createMaterials();
  const root = new THREE.Group();
  root.name = 'SkeletonArcher';
  root.userData = {
    visualId: 'skeleton-archer-v1',
    suggestedCharId: 'skeleton-archer',
    upAxis: '+Y',
    forwardAxis: '+Z',
    units: 'meters',
    author: 'HungerG local procedural asset pipeline',
    license: 'project-internal procedural source',
    externalCredentialsUsed: false,
  };

  const bones = [];
  const boneMap = new Map();
  const addBone = (name, parent, position, scale = 1) => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.copy(position);
    bone.scale.setScalar(scale);
    parent.add(bone);
    bones.push(bone);
    boneMap.set(name, bone);
    return bone;
  };

  const Root = addBone('Root', root, V(0, 0, 0));
  const Pelvis = addBone('Pelvis', Root, V(0, .92, 0));
  const Spine = addBone('Spine', Pelvis, V(0, .18, 0));
  const Chest = addBone('Chest', Spine, V(0, .22, 0));
  const Neck = addBone('Neck', Chest, V(0, .27, 0));
  const Head = addBone('Head', Neck, V(0, .12, 0));
  Head.scale.setScalar(.55);
  const Jaw = addBone('Jaw', Head, V(0, .015, .025));
  const UpperArmL = addBone('UpperArmL', Chest, V(-.32, .18, 0));
  const ForearmL = addBone('ForearmL', UpperArmL, V(0, -.29, 0));
  const HandL = addBone('HandL', ForearmL, V(0, -.27, 0));
  const UpperArmR = addBone('UpperArmR', Chest, V(.32, .18, 0));
  const ForearmR = addBone('ForearmR', UpperArmR, V(0, -.29, 0));
  const HandR = addBone('HandR', ForearmR, V(0, -.27, 0));
  const ThighL = addBone('ThighL', Pelvis, V(-.125, -.04, 0));
  const ShinL = addBone('ShinL', ThighL, V(0, -.38, 0));
  const FootL = addBone('FootL', ShinL, V(0, -.41436, .02));
  const ThighR = addBone('ThighR', Pelvis, V(.125, -.04, 0));
  const ShinR = addBone('ShinR', ThighR, V(0, -.38, 0));
  const FootR = addBone('FootR', ShinR, V(0, -.41436, .02));

  const HeadFlames = [0, 1, 2, 3].map((index) => addBone(`HeadFlame${index}`, Head, V((index - 1.5) * .055, index === 1 || index === 2 ? .33 : .30, index === 3 ? .055 : -.015)));
  const StringUpper = addBone('StringUpper', HandL, V(0, .38, .10));
  const StringLower = addBone('StringLower', HandL, V(0, -.38, .10));
  const NockedArrow = addBone('NockedArrow', Root, V(-.34, .8, .2));
  const FireArrow = addBone('FireArrow', Root, V(-.18, 1.42, .5));
  const ProjectileFlame = addBone('ProjectileFlame', FireArrow, V(0, 0, .36));
  const StuckArrow = addBone('StuckArrow', Chest, V(.04, .06, -.24));
  StuckArrow.rotation.y = Math.PI;
  const BurnFlames = [0, 1, 2, 3].map((index) => addBone(`BurnFlame${index}`, Chest, V((index - 1.5) * .07, .16 - index * .055, -.19)));
  const Ash = [0, 1].map((index) => addBone(`Ash${index}`, Chest, V((index ? 1 : -1) * .08, .24, -.22)));

  root.updateMatrixWorld(true);
  const debrisMap = new Map([
    ['Pelvis', 'DebrisPelvis'], ['Spine', 'DebrisSpine'], ['Chest', 'DebrisRibcage'], ['Neck', 'DebrisNeck'],
    ['Head', 'DebrisSkull'], ['Jaw', 'DebrisJaw'],
    ['UpperArmL', 'DebrisUpperArmL'], ['ForearmL', 'DebrisForearmL'], ['HandL', 'DebrisHandL'],
    ['UpperArmR', 'DebrisUpperArmR'], ['ForearmR', 'DebrisForearmR'], ['HandR', 'DebrisHandR'],
    ['ThighL', 'DebrisThighL'], ['ShinL', 'DebrisShinL'], ['FootL', 'DebrisFootL'],
    ['ThighR', 'DebrisThighR'], ['ShinR', 'DebrisShinR'], ['FootR', 'DebrisFootR'],
    ['StringUpper', 'DebrisHandL'], ['StringLower', 'DebrisHandL'],
    ...HeadFlames.map((bone) => [bone.name, 'DebrisSkull']),
  ]);
  const debrisBones = [];
  for (const [sourceName, debrisName] of debrisMap) {
    if (debrisBones.some((bone) => bone.name === debrisName)) continue;
    const source = boneMap.get(sourceName);
    debrisBones.push(addBone(debrisName, Root, source.getWorldPosition(new THREE.Vector3())));
  }

  const parts = [];
  const part = (parent, boneName, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], duplicate = true) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${boneName}_part_${parts.length}`;
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.scale.set(...scale);
    parent.add(mesh);
    parts.push({ mesh, boneName, duplicate });
    return mesh;
  };
  const rounded = (width, height, depth, radius = .02) => new RoundedBoxGeometry(width, height, depth, 2, radius);
  const segment = (parent, boneName, start, end, radiusStart, radiusEnd, material, sides = 10, duplicate = true) => {
    const direction = end.clone().sub(start);
    const geometry = new THREE.CylinderGeometry(radiusEnd, radiusStart, direction.length(), sides, 1, false);
    const mesh = part(parent, boneName, geometry, material, start.clone().add(end).multiplyScalar(.5).toArray(), [0, 0, 0], [1, 1, 1], duplicate);
    mesh.quaternion.setFromUnitVectors(V(0, 1, 0), direction.clone().normalize());
    return mesh;
  };
  const tube = (parent, boneName, points, radius, material, duplicate = true, segments = 16) => part(parent, boneName, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, radius, 6, false), material, [0, 0, 0], [0, 0, 0], [1, 1, 1], duplicate);
  const joint = (parent, boneName, position, radius, material = materials.bone, duplicate = true) => part(parent, boneName, new THREE.SphereGeometry(radius, 8, 6), material, position, [0, 0, 0], [1, 1, 1], duplicate);
  const longBone = (parent, boneName, start, end, radius, material = materials.bone) => {
    segment(parent, boneName, start, end, radius * .82, radius * .62, material, 10);
    part(parent, boneName, new THREE.IcosahedronGeometry(radius * 1.12, 0), material, start.toArray(), [0, 0, 0], [1.18, .86, 1]);
    part(parent, boneName, new THREE.IcosahedronGeometry(radius * 1.02, 0), material, end.toArray(), [0, 0, 0], [1.2, .88, 1]);
    for (const side of [-1, 1]) joint(parent, boneName, end.clone().add(V(side * radius * .56, 0, 0)).toArray(), radius * .48, material);
  };
  const addFlame = (parent, boneName, position, height, radius, rotation = [0, 0, 0], duplicate = true, bend = 0) => {
    part(parent, boneName, flameGeometry(height, radius, bend), materials.flameOuter, position, rotation, [1, 1, 1], duplicate);
    part(parent, boneName, flameGeometry(height * .62, radius * .48, bend * .7), materials.flameInner, [position[0], position[1] + height * .03, position[2]], rotation, [1, 1, 1], duplicate);
  };

  part(Pelvis, 'Pelvis', plateGeometry([[-.045, .08], [.045, .08], [.03, -.085], [0, -.13], [-.03, -.085]], [], .028), materials.boneDark, [0, .02, -.072], [.12, 0, 0]);
  for (const side of [-1, 1]) {
    const wing = [
      [side * .015, .135], [side * .068, .18], [side * .135, .17], [side * .18, .085],
      [side * .16, -.015], [side * .125, -.07], [side * .108, -.045], [side * .10, -.105],
      [side * .025, -.13], [side * .012, -.055],
    ];
    part(Pelvis, 'Pelvis', plateGeometry(wing, [[side * .066, -.074, .033, .03]], .024), materials.bone, [0, 0, -.005], [0, side * .12, side * -.05]);
    tube(Pelvis, 'Pelvis', [V(side * .018, .14, .005), V(side * .074, .18, .008), V(side * .135, .165, .002), V(side * .175, .088, -.006)], .012, materials.bone, true, 12);
    tube(Pelvis, 'Pelvis', [V(side * .018, -.125, .045), V(side * .06, -.15, .065), V(side * .105, -.11, .065), V(side * .125, -.045, .035)], .017, materials.boneDark, true, 12);
    part(Pelvis, 'Pelvis', new THREE.IcosahedronGeometry(.052, 1), materials.boneDark, [side * .125, -.015, .012], [0, 0, 0], [.92, 1, .72]);
    part(Pelvis, 'Pelvis', new THREE.TorusGeometry(.035, .008, 6, 14), materials.bone, [side * .125, -.015, .025], [0, Math.PI / 2, 0], [1, 1.08, 1]);
  }
  segment(Pelvis, 'Pelvis', V(-.018, -.125, .055), V(.018, -.125, .055), .018, .018, materials.boneDark, 8);

  for (let index = 0; index < 5; index++) {
    const y = -.085 + index * .043;
    part(Spine, 'Spine', new THREE.CylinderGeometry(.031, .034, .03, 9), index % 2 ? materials.bone : materials.boneDark, [0, y, -.018]);
    for (const side of [-1, 1]) segment(Spine, 'Spine', V(side * .02, y, -.025), V(side * .062, y - .006, -.035), .009, .006, materials.bone, 6);
    segment(Spine, 'Spine', V(0, y, -.04), V(0, y - .018, -.083), .010, .006, materials.boneDark, 6);
  }

  for (let index = 0; index < 12; index++) {
    const y = -.105 + index * .0305;
    part(Chest, 'Chest', new THREE.CylinderGeometry(.026 - index * .0004, .029 - index * .0004, .024, 8), index % 2 ? materials.boneDark : materials.bone, [0, y, -.067]);
    for (const side of [-1, 1]) segment(Chest, 'Chest', V(side * .02, y, -.072), V(side * .052, y - .004, -.078), .007, .005, materials.bone, 5);
    segment(Chest, 'Chest', V(0, y, -.082), V(0, y - .02, -.112), .008, .005, materials.boneDark, 5);
    const width = index < 3 ? .12 + index * .016 : index < 8 ? .157 + (index - 3) * .013 : .224 - (index - 8) * .016;
    for (const side of [-1, 1]) {
      const front = index < 7 ? V(side * .018, y - .018, .143) : V(side * width * .27, y - .035, .088);
      tube(Chest, 'Chest', [V(side * .025, y + .006, -.068), V(side * width * .68, y + .024, -.028), V(side * width, y - .004, .026), V(side * width * .61, y - .024, .112), front], .0095 + Math.sin(index / 11 * Math.PI) * .003, materials.bone, true, 12);
    }
  }
  part(Chest, 'Chest', rounded(.072, .052, .026, .008), materials.bone, [0, .218, .139]);
  for (let index = 0; index < 4; index++) part(Chest, 'Chest', rounded(.028 - index * .002, .037, .023, .005), index % 2 ? materials.boneDark : materials.bone, [0, .169 - index * .043, .143]);
  part(Chest, 'Chest', new THREE.ConeGeometry(.018, .052, 5), materials.boneDark, [0, -.035, .139], [0, 0, Math.PI], [1, 1, .45]);
  for (const side of [-1, 1]) {
    const scapula = [[side * .07, .205], [side * .27, .175], [side * .23, -.015], [side * .11, .035]];
    part(Chest, 'Chest', plateGeometry(scapula, [], .012), materials.boneDark, [0, 0, -.098], [0, side * -.10, 0]);
    tube(Chest, 'Chest', [V(side * .085, .15, -.112), V(side * .18, .165, -.124), V(side * .29, .18, -.082)], .011, materials.bone, true, 10);
    tube(Chest, 'Chest', [V(side * .022, .224, .112), V(side * .15, .242, .082), V(side * .27, .205, .035), V(side * .33, .18, .008)], .016, materials.bone, true, 12);
    segment(Chest, 'Chest', V(side * .29, .19, -.055), V(side * .35, .175, .005), .019, .015, materials.boneDark, 8);
    part(Chest, 'Chest', new THREE.IcosahedronGeometry(.045, 1), materials.bone, [side * .32, .18, 0], [0, 0, 0], [1.08, .92, 1]);
  }

  for (let index = 0; index < 3; index++) part(Neck, 'Neck', new THREE.CylinderGeometry(.032, .038, .045, 10), materials.boneDark, [0, -.04 + index * .045, 0]);

  part(Head, 'Head', sculptedSkullGeometry(), materials.bone, [0, .16, -.005], [0, 0, 0], [.88, 1.24, .82]);
  for (const side of [-1, 1]) {
    const socket = [
      [side * .031, .143], [side * .088, .160], [side * .101, .143], [side * .058, .119],
    ];
    part(Head, 'Head', plateGeometry(socket, [], .002), materials.socket, [0, 0, -.012]);
    segment(Head, 'Head', V(side * .018, .198, .091), V(side * .116, .168, .082), .013, .008, materials.bone, 7);
    tube(Head, 'Head', [V(side * .101, .137, .073), V(side * .122, .088, .061), V(side * .086, .031, .084)], .009, materials.bone, true, 10);
  }
  segment(Head, 'Head', V(0, .143, .084), V(0, .065, .092), .010, .006, materials.bone, 7);
  part(Head, 'Head', new THREE.ConeGeometry(.021, .062, 3), materials.socket, [0, .073, .045], [0, 0, Math.PI], [1, 1, .22]);
  part(Head, 'Head', rounded(.155, .048, .078, .012), materials.bone, [0, .015, .078]);
  part(Head, 'Head', rounded(.125, .020, .018, .005), materials.socket, [0, -.026, .116]);
  for (let index = 0; index < 6; index++) part(Head, 'Head', rounded(.018, .030, .020, .003), materials.bone, [(index - 2.5) * .024, .018, .123]);
  tube(Jaw, 'Jaw', [V(-.105, .015, .07), V(-.085, -.075, .11), V(0, -.115, .135), V(.085, -.075, .11), V(.105, .015, .07)], .020, materials.bone);
  for (const side of [-1, 1]) {
    segment(Jaw, 'Jaw', V(side * .105, .015, .07), V(side * .118, .14, .018), .018, .014, materials.boneDark, 8);
    part(Jaw, 'Jaw', new THREE.IcosahedronGeometry(.025, 1), materials.bone, [side * .105, .015, .07], [0, 0, 0], [1, 1.15, .8]);
  }
  segment(Jaw, 'Jaw', V(-.105, .015, .07), V(.105, .015, .07), .016, .016, materials.boneDark, 8);
  for (let index = 0; index < 5; index++) part(Jaw, 'Jaw', rounded(.017, .024, .019, .003), materials.bone, [(index - 2) * .029, -.035, .132]);

  HeadFlames.forEach((bone, index) => {
    const height = [.32, .46, .38, .28][index];
    addFlame(bone, bone.name, [0, 0, 0], height, [.058, .074, .062, .048][index], [0, 0, (index - 1.5) * .10], true, (index - 1.5) * .026);
  });

  for (const side of [-1, 1]) {
    const upper = side < 0 ? UpperArmL : UpperArmR;
    const forearm = side < 0 ? ForearmL : ForearmR;
    const hand = side < 0 ? HandL : HandR;
    longBone(upper, upper.name, V(0, 0, 0), forearm.position, .032, materials.bone);
    part(forearm, forearm.name, new THREE.IcosahedronGeometry(.026, 1), materials.boneDark, [0, .018, -.014], [0, 0, 0], [1, 1.25, .9]);
    longBone(forearm, forearm.name, V(-.013, 0, .003), hand.position.clone().add(V(-.010, 0, .003)), .015, materials.bone);
    longBone(forearm, forearm.name, V(.016, 0, -.004), hand.position.clone().add(V(.013, 0, -.004)), .013, materials.boneDark);
    for (let row = 0; row < 2; row++) {
      for (let index = 0; index < 4; index++) part(hand, hand.name, new THREE.IcosahedronGeometry(.0095 - row * .0008, 0), index % 2 ? materials.boneDark : materials.bone, [(index - 1.5) * .017, -.016 - row * .016, .002], [0, 0, (index - 1.5) * .08], [1, .8, .75]);
    }
    const lengths = [.068, .079, .075, .060];
    for (let index = 0; index < 4; index++) {
      const x = (index - 1.5) * .017;
      const start = V(x * 1.2, -.043, .003);
      const knuckle = V(x * 1.48, -.043 - lengths[index], .008);
      longBone(hand, hand.name, start, knuckle, .0062, materials.bone);
      let previous = knuckle;
      for (let phalanx = 0; phalanx < 3; phalanx++) {
        const next = previous.clone().add(V(x * .10, -(.024 - phalanx * .003), .004));
        segment(hand, hand.name, previous, next, .0046 - phalanx * .0005, .0038 - phalanx * .0005, materials.bone, 6);
        joint(hand, hand.name, previous.toArray(), .0052 - phalanx * .0004, materials.boneDark);
        previous = next;
      }
    }
    const thumbSign = -side;
    const thumbBase = V(thumbSign * .027, -.025, .008);
    const thumbJoint = V(thumbSign * .055, -.059, .020);
    const thumbTip = V(thumbSign * .065, -.085, .027);
    longBone(hand, hand.name, thumbBase, thumbJoint, .007, materials.bone);
    segment(hand, hand.name, thumbJoint, thumbTip, .005, .0038, materials.bone, 6);
    joint(hand, hand.name, thumbJoint.toArray(), .0058, materials.boneDark);
  }

  for (const side of [-1, 1]) {
    const thigh = side < 0 ? ThighL : ThighR;
    const shin = side < 0 ? ShinL : ShinR;
    const foot = side < 0 ? FootL : FootR;
    longBone(thigh, thigh.name, V(0, 0, 0), shin.position, .041, materials.bone);
    part(thigh, thigh.name, new THREE.IcosahedronGeometry(.032, 1), materials.boneDark, [0, -.29, .031], [.12, 0, 0], [.82, 1.08, .48]);
    longBone(shin, shin.name, V(-.014, 0, .004), foot.position.clone().add(V(-.012, .012, .004)), .025, materials.bone);
    longBone(shin, shin.name, V(.027, -.008, -.006), foot.position.clone().add(V(.022, .014, -.006)), .014, materials.boneDark);
    part(foot, foot.name, new THREE.IcosahedronGeometry(.034, 1), materials.boneDark, [0, -.052, -.032], [0, 0, 0], [.9, .82, 1.18]);
    const tarsals = [[0, -.061, .012, .027], [side * .025, -.065, .044, .022], [-side * .022, -.064, .061, .021], [0, -.067, .080, .024]];
    for (const [x, y, z, radius] of tarsals) part(foot, foot.name, new THREE.IcosahedronGeometry(radius, 0), materials.bone, [x, y, z], [0, 0, 0], [1, .72, 1.1]);
    for (let index = 0; index < 5; index++) {
      const x = (index - 2) * .022 * side;
      const length = index === 0 ? .079 : .068 - Math.abs(index - 2) * .006;
      const start = V(x * .55, -.067, .078);
      const end = V(x, -.078, .078 + length);
      longBone(foot, foot.name, start, end, index === 0 ? .010 : .008, materials.bone);
      let previous = end;
      const phalanges = index === 0 ? 2 : 3;
      for (let phalanx = 0; phalanx < phalanges; phalanx++) {
        const next = previous.clone().add(V(0, -.001, index === 0 ? .031 - phalanx * .004 : .024 - phalanx * .003));
        segment(foot, foot.name, previous, next, .0065 - phalanx * .0008, .005 - phalanx * .0008, materials.bone, 6);
        joint(foot, foot.name, previous.toArray(), .0065 - phalanx * .0006, materials.boneDark);
        previous = next;
      }
    }
  }

  const quiver = new THREE.Group();
  quiver.position.set(.15, .04, -.22);
  quiver.rotation.set(-.12, 0, -.20);
  Chest.add(quiver);
  part(quiver, 'Chest', new THREE.CylinderGeometry(.092, .068, .40, 12), materials.leather);
  part(quiver, 'Chest', new THREE.TorusGeometry(.092, .012, 6, 16), materials.leather, [0, .20, 0], [Math.PI / 2, 0, 0]);
  part(quiver, 'Chest', new THREE.CylinderGeometry(.068, .068, .018, 12), materials.leather, [0, -.20, 0]);
  for (let index = 0; index < 5; index++) {
    const angle = index / 5 * TAU;
    const x = Math.cos(angle) * .052;
    const z = Math.sin(angle) * .052;
    segment(quiver, 'Chest', V(x, .13, z), V(x * 1.12, .43 + (index % 2) * .035, z * 1.12), .007, .006, materials.wood, 6);
    part(quiver, 'Chest', rounded(.036, .075, .006, .002), materials.boneDark, [x * 1.12, .39 + (index % 2) * .035, z * 1.12], [0, angle, .12]);
  }
  tube(Chest, 'Chest', [V(.23, .23, .13), V(.08, .10, .175), V(-.12, -.08, .18), V(-.20, -.22, .11)], .016, materials.leather);
  tube(Chest, 'Chest', [V(.23, .23, -.10), V(.06, .08, -.18), V(-.14, -.10, -.17), V(-.20, -.22, -.08)], .014, materials.leather);

  tube(HandL, 'HandL', [V(0, .38, .10), V(0, .25, .045), V(0, 0, 0), V(0, -.25, .045), V(0, -.38, .10)], .018, materials.wood, true, 24);
  part(HandL, 'HandL', new THREE.CylinderGeometry(.029, .029, .14, 10), materials.leather);
  joint(HandL, 'HandL', [0, .38, .10], .023, materials.iron);
  joint(HandL, 'HandL', [0, -.38, .10], .023, materials.iron);
  segment(HandL, 'StringUpper', V(0, .38, .10), V(0, 0, -.12), .0028, .0028, materials.string, 5);
  segment(HandL, 'StringLower', V(0, -.38, .10), V(0, 0, -.12), .0028, .0028, materials.string, 5);

  const arrow = (parent, boneName, options = {}) => {
    const length = options.length ?? .66;
    const start = options.stuck ? -length + .08 : -length / 2;
    const end = options.stuck ? .08 : length / 2;
    segment(parent, boneName, V(0, 0, start), V(0, 0, end - .06), .008, .006, materials.wood, 7, false);
    part(parent, boneName, new THREE.ConeGeometry(.026, .09, 6), materials.iron, [0, 0, end - .015], [Math.PI / 2, 0, 0], [1, 1, 1], false);
    for (const side of [-1, 1]) part(parent, boneName, rounded(.055, .075, .006, .002), materials.boneDark, [side * .022, 0, start + .06], [0, 0, side * .22], [1, 1, 1], false);
    if (options.fire !== false) {
      part(parent, boneName, flameGeometry(.14, .035), materials.flameOuter, [0, 0, end + .02], [Math.PI / 2, 0, 0], [1, 1, 1], false);
      part(parent, boneName, flameGeometry(.085, .019), materials.flameInner, [0, 0, end + .025], [Math.PI / 2, 0, 0], [1, 1, 1], false);
    }
  };
  arrow(NockedArrow, 'NockedArrow');
  arrow(FireArrow, 'FireArrow');
  part(ProjectileFlame, 'ProjectileFlame', flameGeometry(.24, .045), materials.flameOuter, [0, 0, -.08], [-Math.PI / 2, 0, 0], [1, 1, 1], false);
  part(ProjectileFlame, 'ProjectileFlame', flameGeometry(.15, .024), materials.flameInner, [0, 0, -.06], [-Math.PI / 2, 0, 0], [1, 1, 1], false);
  arrow(StuckArrow, 'StuckArrow', { length: .64, stuck: true });
  BurnFlames.forEach((bone, index) => {
    addFlame(bone, bone.name, [0, 0, 0], .16 + (index % 2) * .07, .042 + (index % 2) * .01, [(index - 1.5) * .12, 0, (index - 1.5) * .1], false);
  });
  Ash.forEach((bone, index) => {
    part(bone, bone.name, new THREE.SphereGeometry(.035 + index * .012, 10, 8), materials.ash, [0, 0, 0], [0, 0, 0], [1, 1.4, 1], false);
  });

  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const hiddenBoneNames = new Set(['NockedArrow', 'FireArrow', 'ProjectileFlame', 'StuckArrow', ...BurnFlames.map((bone) => bone.name), ...Ash.map((bone) => bone.name), ...debrisBones.map((bone) => bone.name)]);
  const boneIndices = new Map(bones.map((bone, index) => [bone.name, index]));
  const geometryGroups = new Map();
  const addGeometry = (geometry, material, boneName) => {
    if (!geometryGroups.has(material)) geometryGroups.set(material, []);
    geometryGroups.get(material).push({ geometry, boneName });
  };
  for (const item of parts) {
    let geometry = item.mesh.geometry.clone();
    if (geometry.index) geometry = geometry.toNonIndexed();
    for (const attribute of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'uv'].includes(attribute)) geometry.deleteAttribute(attribute);
    }
    if (!geometry.attributes.uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
    geometry.applyMatrix4(item.mesh.matrixWorld);
    const indexedGeometry = mergeVertices(geometry, 1e-5);
    geometry.dispose();
    item.worldGeometry = indexedGeometry.clone();
    addGeometry(indexedGeometry, item.mesh.material, item.boneName);
    const debrisName = debrisMap.get(item.boneName);
    if (item.duplicate && debrisName) addGeometry(indexedGeometry.clone(), item.mesh.material, debrisName);
    item.mesh.removeFromParent();
  }
  for (const bone of bones) if (hiddenBoneNames.has(bone.name)) bone.scale.setScalar(EPS);
  root.updateMatrixWorld(true);

  const specialBones = new Set(['NockedArrow', 'FireArrow', 'ProjectileFlame', 'StuckArrow', ...BurnFlames.map((bone) => bone.name), ...Ash.map((bone) => bone.name)]);
  const bodyBones = bones.filter((bone) => bone.name !== 'Root' && !specialBones.has(bone.name) && !bone.name.startsWith('Debris'));
  const random = randomSource(0x51a7e);
  const debrisLayouts = new Map();
  for (const bone of debrisBones) {
    const rest = bone.position.clone();
    const angle = random() * TAU;
    const radius = .28 + random() * .62;
    const dx = Math.cos(angle) * radius;
    const dz = Math.sin(angle) * radius;
    const yaw = random() * TAU;
    const longBone = /UpperArm|Forearm|Hand|Thigh|Shin|Foot|Spine|Neck/.test(bone.name);
    const lay = longBone
      ? new THREE.Quaternion().setFromEuler(new THREE.Euler((random() - .5) * .22, 0, (random() < .5 ? -1 : 1) * (1.38 + random() * .16)))
      : new THREE.Quaternion().setFromEuler(new THREE.Euler(1.18 + random() * .34, 0, (random() - .5) * .55));
    const finalQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)).multiply(lay);
    let minY = Infinity;
    for (const item of parts) {
      if (!item.duplicate || debrisMap.get(item.boneName) !== bone.name) continue;
      const geometry = item.worldGeometry.clone();
      geometry.translate(-rest.x, -rest.y, -rest.z);
      geometry.applyQuaternion(finalQuaternion);
      geometry.translate(rest.x + dx, rest.y, rest.z + dz);
      geometry.computeBoundingBox();
      minY = Math.min(minY, geometry.boundingBox.min.y);
      geometry.dispose();
    }
    const dy = Number.isFinite(minY) ? -minY + .008 : 0;
    debrisLayouts.set(bone.name, { rest, final: V(rest.x + dx, rest.y + dy, rest.z + dz), quaternion: finalQuaternion, arc: .10 + random() * .34 });
  }

  let triangles = 0;
  let vertices = 0;
  for (const [material, entries] of geometryGroups) {
    const geometries = entries.map((entry) => {
      const geometry = entry.geometry.clone();
      const count = geometry.attributes.position.count;
      const skinIndices = new Uint8Array(count * 4);
      const skinWeights = new Uint8Array(count * 4);
      const boneIndex = boneIndices.get(entry.boneName);
      for (let index = 0; index < count; index++) {
        skinIndices[index * 4] = boneIndex;
        skinWeights[index * 4] = 255;
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
    mesh.name = `SkeletonArcher_${material.name}`;
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

  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root, true);
  const restPose = new Map(bones.map((bone) => [bone.name, { position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }]));
  const clips = createClips({ bones, boneMap, bodyBones, debrisBones, debrisLayouts, restPose, HeadFlames, BurnFlames, Ash, UpperArmL, UpperArmR, ForearmL, ForearmR, HandL, HandR });
  return {
    root,
    skeleton,
    bones,
    clips,
    materials: Object.values(materials),
    restPose,
    stats: {
      meshes: geometryGroups.size,
      materials: geometryGroups.size,
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
  const { bones, boneMap, bodyBones, debrisBones, debrisLayouts, restPose, HeadFlames, BurnFlames, Ash, UpperArmL, UpperArmR, ForearmL, ForearmR, HandL, HandR } = context;
  const clips = [];
  const idleTimes = [0, 1, 2, 3, 4];
  const flameTimes = Array.from({ length: 17 }, (_, index) => index / 4);
  clips.push(new THREE.AnimationClip('idle', 4, [
    quaternionTrack('Chest', idleTimes, [[0, 0, 0], [.012, .018, 0], [0, 0, 0], [-.008, -.014, 0], [0, 0, 0]].map((rotation) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)))),
    quaternionTrack('Head', idleTimes, [[0, 0, 0], [-.02, .045, .015], [0, 0, 0], [.01, -.035, -.01], [0, 0, 0]].map((rotation) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)))),
    quaternionTrack('Jaw', idleTimes, [[0, 0, 0], [.035, 0, 0], [0, 0, 0], [.02, 0, 0], [0, 0, 0]].map((rotation) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)))),
    vectorTrack('Pelvis', idleTimes, [V(0, .92, 0), V(0, .924, 0), V(0, .92, 0), V(0, .919, 0), V(0, .92, 0)]),
    ...HeadFlames.flatMap((bone, index) => [
      scaleTrack(bone.name, flameTimes, flameTimes.map((time) => {
        const value = 1 + Math.sin(time * 13 + index * 1.7) * .14 + Math.sin(time * 23 + index) * .06;
        return [value * (1 + Math.sin(time * 17 + index) * .08), value * (.92 + Math.cos(time * 19 + index) * .09), value];
      })),
      quaternionTrack(bone.name, flameTimes, flameTimes.map((time) => new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(time * 11 + index) * .34, Math.sin(time * 15 + index) * .24, Math.cos(time * 18 + index) * .16)))),
    ]),
  ]));

  const walkTimes = Array.from({ length: 9 }, (_, index) => index / 8);
  const stride = walkTimes.map((time) => Math.sin(time * TAU));
  const q = (rotation) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
  clips.push(new THREE.AnimationClip('walk', 1, [
    quaternionTrack('ThighL', walkTimes, stride.map((value) => q([value * .42, 0, 0]))),
    quaternionTrack('ThighR', walkTimes, stride.map((value) => q([-value * .42, 0, 0]))),
    quaternionTrack('ShinL', walkTimes, stride.map((value) => q([Math.max(0, -value) * .58, 0, 0]))),
    quaternionTrack('ShinR', walkTimes, stride.map((value) => q([Math.max(0, value) * .58, 0, 0]))),
    quaternionTrack('FootL', walkTimes, stride.map((value) => q([-value * .18, 0, 0]))),
    quaternionTrack('FootR', walkTimes, stride.map((value) => q([value * .18, 0, 0]))),
    quaternionTrack('UpperArmL', walkTimes, stride.map((value) => q([-value * .25, 0, -.03]))),
    quaternionTrack('UpperArmR', walkTimes, stride.map((value) => q([value * .25, 0, .03]))),
    quaternionTrack('Chest', walkTimes, stride.map((value) => q([.025, value * .05, 0]))),
    vectorTrack('Pelvis', walkTimes, walkTimes.map((time) => V(0, .92 + Math.abs(Math.sin(time * TAU)) * .025, 0))),
    ...HeadFlames.flatMap((bone, index) => [
      scaleTrack(bone.name, walkTimes, walkTimes.map((time, key) => { const value = .96 + Math.sin(time * TAU * 2 + index) * .09; return [value * 1.03, value * .95, value]; })),
      quaternionTrack(bone.name, walkTimes, walkTimes.map((time, key) => q([Math.sin(time * TAU * 1.4 + index) * .26, Math.sin(time * TAU + index) * .14, Math.cos(time * TAU * 1.3 + index) * .08]))),
    ]),
  ]));

  const leftRest = HandL.getWorldPosition(new THREE.Vector3());
  const rightRest = HandR.getWorldPosition(new THREE.Vector3());
  const leftAim = V(-.18, 1.42, .50);
  const shootKeys = [
    { time: 0, left: leftRest, right: rightRest },
    { time: .35, left: leftAim, right: V(.03, 1.43, .34) },
    { time: .70, left: leftAim, right: V(.035, 1.45, .17) },
    { time: .95, left: leftAim, right: V(.04, 1.46, .015) },
    { time: 1.08, left: leftAim, right: V(.04, 1.46, .015) },
    { time: 1.17, left: leftAim, right: V(.15, 1.40, -.035) },
    { time: 1.45, left: V(-.25, 1.30, .34), right: V(.25, 1.10, .12) },
    { time: 2.20, left: leftRest, right: rightRest },
  ];
  const identity = new THREE.Quaternion();
  const armPoses = shootKeys.map((key, index) => {
    if (index === 0 || index === shootKeys.length - 1) {
      return { left: { upper: identity, forearm: identity, hand: identity }, right: { upper: identity, forearm: identity, hand: identity }, string: stringPose(V(0, 0, -.12)) };
    }
    const left = solveArm(UpperArmL, ForearmL, HandL, key.left, V(-.4, -.6, .2));
    const right = solveArm(UpperArmR, ForearmR, HandR, key.right, V(.7, -.35, .25));
    return { left, right, string: stringPose(key.right.clone().sub(key.left)) };
  });
  const shootTimes = shootKeys.map((key) => key.time);
  const arrowDirection = leftAim.clone().sub(V(.04, 1.46, .015)).normalize();
  const arrowQuaternion = new THREE.Quaternion().setFromUnitVectors(FORWARD, arrowDirection);
  const fireStart = leftAim.clone().addScaledVector(arrowDirection, .06);
  const firePositions = [V(0, 0, 0), V(0, 0, 0), V(0, 0, 0), V(0, 0, 0), fireStart, fireStart.clone().addScaledVector(arrowDirection, .20), fireStart.clone().addScaledVector(arrowDirection, .85), fireStart.clone().addScaledVector(arrowDirection, 1.85), fireStart.clone().addScaledVector(arrowDirection, 2.6)];
  const fireTimes = [0, .35, .70, .95, 1.08, 1.17, 1.45, 1.75, 2.2];
  clips.push(new THREE.AnimationClip('shoot', 2.2, [
    quaternionTrack('UpperArmL', shootTimes, armPoses.map((pose) => pose.left.upper)),
    quaternionTrack('ForearmL', shootTimes, armPoses.map((pose) => pose.left.forearm)),
    quaternionTrack('HandL', shootTimes, armPoses.map((pose) => pose.left.hand)),
    quaternionTrack('UpperArmR', shootTimes, armPoses.map((pose) => pose.right.upper)),
    quaternionTrack('ForearmR', shootTimes, armPoses.map((pose) => pose.right.forearm)),
    quaternionTrack('HandR', shootTimes, armPoses.map((pose) => pose.right.hand)),
    quaternionTrack('StringUpper', shootTimes, armPoses.map((pose) => pose.string.upper.quaternion)),
    quaternionTrack('StringLower', shootTimes, armPoses.map((pose) => pose.string.lower.quaternion)),
    scaleTrack('StringUpper', shootTimes, armPoses.map((pose) => pose.string.upper.scale)),
    scaleTrack('StringLower', shootTimes, armPoses.map((pose) => pose.string.lower.scale)),
    vectorTrack('NockedArrow', shootTimes, shootKeys.map((key) => key.left.clone().add(key.right).multiplyScalar(.5))),
    quaternionTrack('NockedArrow', shootTimes, shootKeys.map((key) => new THREE.Quaternion().setFromUnitVectors(FORWARD, key.left.clone().sub(key.right).normalize()))),
    scaleTrack('NockedArrow', shootTimes, [EPS, 1, 1, 1, 1, EPS, EPS, EPS]),
    vectorTrack('FireArrow', fireTimes, firePositions),
    quaternionTrack('FireArrow', fireTimes, fireTimes.map(() => arrowQuaternion)),
    scaleTrack('FireArrow', fireTimes, [EPS, EPS, EPS, EPS, 1, 1, 1, EPS, EPS]),
    scaleTrack('ProjectileFlame', fireTimes, [1, 1, 1, 1, 1.15, .88, 1.1, 1, 1]),
    quaternionTrack('Chest', shootTimes, shootKeys.map((key, index) => q([index > 3 && index < 6 ? -.06 : 0, index > 2 && index < 6 ? -.09 : 0, 0]))),
    quaternionTrack('Head', shootTimes, shootKeys.map((key, index) => q([index > 1 && index < 6 ? -.05 : 0, index > 1 && index < 6 ? -.08 : 0, 0]))),
    ...HeadFlames.flatMap((bone, index) => [
      scaleTrack(bone.name, shootTimes, shootTimes.map((time, key) => { const value = 1 + Math.sin(time * 17 + index) * .10; return [value, value * .94, value]; })),
      quaternionTrack(bone.name, shootTimes, shootTimes.map((time, key) => q([Math.sin(time * 15 + index) * .30, Math.sin(time * 13 + index) * .15, Math.cos(time * 11 + index) * .08]))),
    ]),
  ]));

  const flinchTimes = [0, .12, .30, .75];
  clips.push(new THREE.AnimationClip('flinch', .75, [
    quaternionTrack('Chest', flinchTimes, [q([0, 0, 0]), q([-.20, .16, .10]), q([.04, -.04, -.03]), q([0, 0, 0])]),
    quaternionTrack('Head', flinchTimes, [q([0, 0, 0]), q([.24, -.22, -.10]), q([-.04, .06, .02]), q([0, 0, 0])]),
    quaternionTrack('UpperArmL', flinchTimes, [q([0, 0, 0]), q([-.42, 0, -.30]), q([.08, 0, 0]), q([0, 0, 0])]),
    quaternionTrack('UpperArmR', flinchTimes, [q([0, 0, 0]), q([-.30, 0, .34]), q([.06, 0, 0]), q([0, 0, 0])]),
    vectorTrack('Pelvis', flinchTimes, [V(0, .92, 0), V(0, .88, -.02), V(0, .915, 0), V(0, .92, 0)]),
  ]));

  const burnHitTimes = [0, .10, .22, .48, .82, 1.20, 1.40];
  const burnHitFlame = burnHitTimes.map((time, index) => {
    const value = index < 2 ? EPS : .92 + Math.sin(time * 19) * .16;
    return [value, value * (.9 + Math.sin(time * 23) * .12), value];
  });
  clips.push(new THREE.AnimationClip('flinch_burning', 1.4, [
    quaternionTrack('Chest', burnHitTimes, [q([0, 0, 0]), q([-.27, .20, .13]), q([-.10, .08, .04]), q([.03, -.03, -.02]), q([-.04, .02, .01]), q([0, 0, 0]), q([0, 0, 0])]),
    quaternionTrack('Head', burnHitTimes, [q([0, 0, 0]), q([.30, -.28, -.14]), q([.12, -.12, -.05]), q([-.04, .05, .02]), q([.02, -.02, 0]), q([0, 0, 0]), q([0, 0, 0])]),
    quaternionTrack('UpperArmL', burnHitTimes, [q([0, 0, 0]), q([-.55, 0, -.38]), q([-.20, 0, -.15]), q([.05, 0, 0]), q([0, 0, 0]), q([0, 0, 0]), q([0, 0, 0])]),
    quaternionTrack('UpperArmR', burnHitTimes, [q([0, 0, 0]), q([-.42, 0, .42]), q([-.15, 0, .18]), q([.04, 0, 0]), q([0, 0, 0]), q([0, 0, 0]), q([0, 0, 0])]),
    scaleTrack('StuckArrow', burnHitTimes, [EPS, EPS, 1, 1, 1, 1, 1]),
    ...BurnFlames.flatMap((bone, index) => [
      scaleTrack(bone.name, burnHitTimes, burnHitFlame.map((scale, key) => [scale[0] * (1 + index * .03), scale[1] * (1 + key % 2 * .05), scale[2]])),
      quaternionTrack(bone.name, burnHitTimes, burnHitTimes.map((time, key) => q([Math.sin(time * 15 + index) * .12, Math.cos(time * 17 + index) * .14, Math.sin(time * 13 + index) * .10]))),
    ]),
    scaleTrack('Ash0', burnHitTimes, [EPS, EPS, .7, 1, .8, .6, EPS]),
    scaleTrack('Ash1', burnHitTimes, [EPS, EPS, EPS, .7, 1, .7, EPS]),
    vectorTrack('Ash0', burnHitTimes, burnHitTimes.map((time) => V(-.08, .24 + Math.max(0, time - .22) * .28, -.22))),
    vectorTrack('Ash1', burnHitTimes, burnHitTimes.map((time) => V(.08, .24 + Math.max(0, time - .35) * .24, -.22))),
  ]));

  const burnTimes = Array.from({ length: 17 }, (_, index) => index / 8);
  clips.push(new THREE.AnimationClip('burn', 2, [
    quaternionTrack('Chest', burnTimes, burnTimes.map((time) => q([Math.sin(time * TAU * 2) * .018, 0, Math.sin(time * TAU * 3) * .012]))),
    scaleTrack('StuckArrow', burnTimes, burnTimes.map(() => 1)),
    ...HeadFlames.flatMap((bone, index) => [
      scaleTrack(bone.name, burnTimes, burnTimes.map((time) => { const value = 1.04 + Math.sin(time * TAU * 4 + index) * .17; return [value * 1.06, value * .91, value]; })),
      quaternionTrack(bone.name, burnTimes, burnTimes.map((time) => q([Math.sin(time * TAU * 3 + index) * .38, Math.cos(time * TAU * 5 + index) * .26, Math.sin(time * TAU * 4 + index) * .18]))),
    ]),
    ...BurnFlames.flatMap((bone, index) => [
      scaleTrack(bone.name, burnTimes, burnTimes.map((time) => { const value = .92 + Math.sin(time * TAU * 3 + index) * .14; return [value, value * (.92 + Math.sin(time * TAU * 4 + index) * .1), value]; })),
      quaternionTrack(bone.name, burnTimes, burnTimes.map((time) => q([Math.sin(time * TAU * 2 + index) * .13, Math.cos(time * TAU * 3 + index) * .16, Math.sin(time * TAU * 4 + index) * .11]))),
    ]),
    scaleTrack('Ash0', burnTimes, burnTimes.map((time) => .45 + (Math.sin(time * Math.PI) * .5 + .5) * .55)),
    scaleTrack('Ash1', burnTimes, burnTimes.map((time) => .35 + (Math.sin(time * Math.PI + 1) * .5 + .5) * .55)),
    vectorTrack('Ash0', burnTimes, burnTimes.map((time) => V(-.08 + Math.sin(time * TAU) * .03, .24 + time * .32, -.22))),
    vectorTrack('Ash1', burnTimes, burnTimes.map((time) => V(.08 + Math.cos(time * TAU) * .03, .24 + ((time + .5) % 2) * .28, -.22))),
  ]));

  const deathDuration = 1.4;
  const deathTimes = [0, .07, .20, .38, .58, .78, 1].map((time) => time * deathDuration);
  const deathTracks = [];
  for (const bone of bodyBones) {
    const restScale = restPose.get(bone.name).scale.toArray();
    deathTracks.push(scaleTrack(bone.name, [0, .07 * deathDuration, deathDuration], [restScale, [EPS, EPS, EPS], [EPS, EPS, EPS]]));
  }
  for (const bone of debrisBones) {
    const layout = debrisLayouts.get(bone.name);
    const positions = deathTimes.map((time) => {
      const progress = clamp((time / deathDuration - .07) / .93);
      return V(
        layout.rest.x + (layout.final.x - layout.rest.x) * progress,
        layout.rest.y + (layout.final.y - layout.rest.y) * progress + Math.sin(progress * Math.PI) * layout.arc,
        layout.rest.z + (layout.final.z - layout.rest.z) * progress,
      );
    });
    const quaternions = deathTimes.map((time) => {
      const progress = ease((time / deathDuration - .07) / .93);
      return restPose.get(bone.name).quaternion.clone().slerp(layout.quaternion, progress);
    });
    deathTracks.push(vectorTrack(bone.name, deathTimes, positions));
    deathTracks.push(quaternionTrack(bone.name, deathTimes, quaternions));
    deathTracks.push(scaleTrack(bone.name, [0, .07 * deathDuration, deathDuration], [EPS, 1, 1]));
  }
  for (const name of ['NockedArrow', 'FireArrow', 'StuckArrow', ...BurnFlames.map((bone) => bone.name), ...Ash.map((bone) => bone.name)]) {
    deathTracks.push(scaleTrack(name, [0, deathDuration], [EPS, EPS]));
  }
  const dead = new THREE.AnimationClip('dead', deathDuration, deathTracks);
  clips.push(dead);
  const revive = reverseClip(dead);
  revive.name = 'reviveRise';
  clips.push(revive);
  return clips;
}
