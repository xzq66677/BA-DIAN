import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const EPS = .0001;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DOWN = V(0, -1, 0);
const UP = V(0, 1, 0);
const FORWARD = V(0, 0, 1);
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
      const grain = (random() - .5) * 16;
      const wave = Math.sin(x * .19 + y * .17) * 2.2;
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
    skin: pbrMaterial('warm_skin', '#b97b54', { seed: 3, roughness: .72, normal: .12 }),
    cloth: pbrMaterial('brown_jacket', '#65422c', { seed: 7, roughness: .88, normal: .22 }),
    clothDark: pbrMaterial('dark_indigo_pants', '#252b3c', { seed: 11, roughness: .9, normal: .2 }),
    accent: pbrMaterial('red_sash_and_tassel', '#a33427', { seed: 17, roughness: .82, normal: .18 }),
    mask: pbrMaterial('indigo_ninja_mask', '#293852', { seed: 19, roughness: .86, normal: .18 }),
    leather: pbrMaterial('dark_leather', '#3b261e', { seed: 23, roughness: .78, normal: .26 }),
    wood: pbrMaterial('staff_wood', '#603722', { seed: 29, roughness: .58, normal: .22, clearcoat: .12 }),
    metal: pbrMaterial('blackened_iron', '#343b3d', { seed: 37, roughness: .34, metalness: .82, normal: .12 }),
    gold: pbrMaterial('aged_brass', '#a47a36', { seed: 41, roughness: .38, metalness: .76, normal: .1 }),
    hair: pbrMaterial('dark_hair', '#211b18', { seed: 47, roughness: .86, normal: .16 }),
    ink: pbrMaterial('facial_ink', '#171513', { seed: 53, roughness: .95, normal: .05 }),
    white: pbrMaterial('eye_white', '#e8d9bd', { seed: 59, roughness: .55, normal: .04 }),
  };
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

function limbGeometry(points, radiusStops, segments = 36, sides = 12) {
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
    const chainWeights = t <= split ? [1 - smoothFirst, smoothFirst, 0] : [0, 1 - smoothSecond, smoothSecond];
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
  return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, quaternions.flatMap((quaternion) => quaternion.toArray()));
}

function vectorTrack(name, times, vectors) {
  return new THREE.VectorKeyframeTrack(`${name}.position`, times, vectors.flatMap((vector) => vector.toArray()));
}

function scaleTrack(name, times, scales) {
  return new THREE.VectorKeyframeTrack(`${name}.scale`, times, scales.flatMap((scale) => (Array.isArray(scale) ? scale : typeof scale === 'number' ? [scale, scale, scale] : scale.toArray())));
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

function solveArm(upper, forearm, hand, target, bendDirection, restPose, handWorld = new THREE.Quaternion()) {
  const shoulder = upper.getWorldPosition(new THREE.Vector3());
  const parentRest = upper.parent.getWorldQuaternion(new THREE.Quaternion());
  const upperLength = forearm.position.length();
  const lowerLength = hand.position.length();
  const toTarget = target.clone().sub(shoulder);
  const targetDistance = Math.min(toTarget.length(), upperLength + lowerLength - .00001);
  const distance = targetDistance;
  const direction = toTarget.normalize();
  const reachableTarget = shoulder.clone().addScaledVector(direction, distance);
  const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const bend = bendDirection.clone().addScaledVector(direction, -bendDirection.dot(direction)).normalize();
  const elbow = shoulder.clone().addScaledVector(direction, along).addScaledVector(bend, height);
  const upperDirection = elbow.clone().sub(shoulder).normalize();
  const lowerDirection = reachableTarget.clone().sub(elbow).normalize();
  const upperRest = restPose.get(upper.name);
  const lowerRest = restPose.get(forearm.name);
  const upperBaseWorld = parentRest.clone().multiply(upperRest.quaternion);
  const upperOffset = forearm.position.clone().applyQuaternion(upperBaseWorld).normalize();
  const upperWorld = new THREE.Quaternion().setFromUnitVectors(upperOffset, upperDirection).multiply(upperBaseWorld);
  const upperLocal = parentRest.clone().invert().multiply(upperWorld);
  const lowerBaseWorld = upperWorld.clone().multiply(lowerRest.quaternion);
  const lowerOffset = hand.position.clone().applyQuaternion(lowerBaseWorld).normalize();
  const lowerWorld = new THREE.Quaternion().setFromUnitVectors(lowerOffset, lowerDirection).multiply(lowerBaseWorld);
  const lowerLocal = upperWorld.clone().invert().multiply(lowerWorld);
  const handLocal = lowerWorld.clone().invert().multiply(handWorld);
  return { upper: upperLocal, forearm: lowerLocal, hand: handLocal, target: reachableTarget };
}

function buildSkinnedMeshes(root, bones, entries, prefix) {
  const boneIndices = new Map(bones.map((bone, index) => [bone.name, index]));
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.container ? `${entry.material.uuid}:${entry.container.uuid}` : entry.material.uuid;
    if (!groups.has(key)) groups.set(key, { material: entry.material, container: entry.container, items: [] });
    groups.get(key).items.push(entry);
  }
  const meshes = [];
  const skeleton = new THREE.Skeleton(bones);
  let triangles = 0;
  let vertices = 0;
  for (const { material, container, items } of groups.values()) {
    const geometries = items.map((item) => {
      const geometry = item.geometry.clone();
      const count = geometry.attributes.position.count;
      const skinIndices = new Uint8Array(count * 4);
      const skinWeights = new Uint8Array(count * 4);
      if (item.chain) {
        const chain = item.chain.map((name) => boneIndices.get(name));
        const source = geometry.attributes.chainWeights;
        for (let index = 0; index < count; index++) {
          const weights = [source.getX(index), source.getY(index), source.getZ(index)];
          for (let slot = 0; slot < 3; slot++) {
            skinIndices[index * 4 + slot] = chain[slot];
            skinWeights[index * 4 + slot] = Math.round(weights[slot] * 255);
          }
        }
      } else {
        const boneIndex = boneIndices.get(item.bone);
        for (let index = 0; index < count; index++) {
          skinIndices[index * 4] = boneIndex;
          skinWeights[index * 4] = 255;
        }
      }
      geometry.deleteAttribute('chainWeights');
      geometry.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(skinIndices, 4));
      geometry.setAttribute('skinWeight', new THREE.Uint8BufferAttribute(skinWeights, 4, true));
      return geometry;
    });
    const geometry = mergeGeometries(geometries, false);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = `${prefix}_${material.name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    (container ?? root).add(mesh);
    mesh.bind(skeleton, new THREE.Matrix4());
    triangles += geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
    vertices += geometry.attributes.position.count;
    meshes.push(mesh);
    geometries.forEach((item) => item.dispose());
    items.forEach((item) => item.geometry.dispose());
  }
  return { meshes, skeleton, triangles, vertices };
}

export function createBagun() {
  const materials = createMaterials();
  const root = new THREE.Group();
  root.name = 'Bagun';
  root.userData = {
    visualId: 'bagun-v1',
    suggestedCharId: 'bagun',
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
  const Pelvis = addBone('Pelvis', Root, V(0, .94, 0));
  const Spine = addBone('Spine', Pelvis, V(0, .18, 0));
  const Chest = addBone('Chest', Spine, V(0, .22, 0));
  const Neck = addBone('Neck', Chest, V(0, .25, 0));
  const Head = addBone('Head', Neck, V(0, .10, 0));
  const UpperArmL = addBone('UpperArmL', Chest, V(-.30, .15, 0));
  const ForearmL = addBone('ForearmL', UpperArmL, V(0, -.29, 0));
  const HandL = addBone('HandL', ForearmL, V(0, -.27, 0));
  const UpperArmR = addBone('UpperArmR', Chest, V(.30, .15, 0));
  const ForearmR = addBone('ForearmR', UpperArmR, V(0, -.29, 0));
  const HandR = addBone('HandR', ForearmR, V(0, -.27, 0));
  const ThighL = addBone('ThighL', Pelvis, V(-.125, -.04, 0));
  const ShinL = addBone('ShinL', ThighL, V(0, -.40, 0));
  const FootL = addBone('FootL', ShinL, V(0, -.42, 0));
  const ThighR = addBone('ThighR', Pelvis, V(.125, -.04, 0));
  const ShinR = addBone('ShinR', ThighR, V(0, -.40, 0));
  const FootR = addBone('FootR', ShinR, V(0, -.42, 0));
  const CoatTail = addBone('CoatTail', Chest, V(0, -.20, -.14));
  const SashTail = addBone('SashTail', Pelvis, V(.15, -.02, -.10));
  const stick = new THREE.Group();
  stick.name = 'stick';
  root.add(stick);
  const FreeHandAnchor = addBone('FreeHandAnchor', HandL, V(0, 0, 0));
  const StickGrip = addBone('StickGrip', HandR, V(0, 0, 0));

  root.updateMatrixWorld(true);
  const initialRest = new Map(bones.map((bone) => [bone.name, { position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }]));
  const leftGrip = solveArm(UpperArmL, ForearmL, HandL, V(-.28, 1.02, .18), V(-.8, -.45, .55), initialRest);
  const rightGrip = solveArm(UpperArmR, ForearmR, HandR, V(.24, 1.28, .32), V(.8, -.45, .55), initialRest);
  for (const [bone, pose] of [[UpperArmL, leftGrip], [ForearmL, leftGrip], [HandL, leftGrip], [UpperArmR, rightGrip], [ForearmR, rightGrip], [HandR, rightGrip]]) {
    bone.quaternion.copy(bone.name.startsWith('Upper') ? pose.upper : bone.name.startsWith('Fore') ? pose.forearm : pose.hand);
  }
  root.updateMatrixWorld(true);
  const restLeft = HandL.getWorldPosition(new THREE.Vector3());
  const restRight = HandR.getWorldPosition(new THREE.Vector3());
  const restStickQuaternion = q([.12, 0, -.24]);
  const StickPivot = addBone('StickPivot', HandR, HandR.worldToLocal(restRight.clone().add(UP.clone().applyQuaternion(restStickQuaternion).multiplyScalar(.10))));
  StickPivot.quaternion.copy(HandR.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(restStickQuaternion));
  FreeHandAnchor.position.set(0, 0, 0);
  StickGrip.position.set(0, 0, 0);
  root.updateMatrixWorld(true);

  const entries = [];
  const part = (bone, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.scale.set(...scale);
    bone.add(mesh);
    entries.push({ mesh, bone: bone.name, material });
    return mesh;
  };
  const stickPart = (geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) => {
    const mesh = part(StickPivot, geometry, material, position, rotation, scale);
    entries[entries.length - 1].container = stick;
    return mesh;
  };
  const stickTube = (points, radius, material, segments = 14) => {
    const mesh = tube(StickPivot, points, radius, material, segments);
    entries[entries.length - 1].container = stick;
    return mesh;
  };
  const rounded = (width, height, depth, radius = .02) => new RoundedBoxGeometry(width, height, depth, 2, radius);
  const segment = (bone, start, end, radiusStart, radiusEnd, material, sides = 10) => {
    const direction = end.clone().sub(start);
    const mesh = part(bone, new THREE.CylinderGeometry(radiusEnd, radiusStart, direction.length(), sides), material, start.clone().add(end).multiplyScalar(.5).toArray());
    mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
    return mesh;
  };
  const tube = (bone, points, radius, material, segments = 14) => part(bone, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, radius, 6, false), material);
  const chain = (names, points, radii, material) => {
    const geometry = limbGeometry(points, radii.map((radius, index) => [index / (radii.length - 1), radius]), 36, 12);
    entries.push({ geometry, material, chain: names });
  };

  part(Pelvis, new THREE.CylinderGeometry(.225, .20, .20, 10), materials.clothDark, [0, -.02, 0], [0, 0, 0], [1, 1, .72]);
  part(Pelvis, new THREE.CylinderGeometry(.235, .235, .085, 12), materials.leather, [0, .055, 0], [0, 0, 0], [1, 1, .72]);
  part(Pelvis, rounded(.085, .07, .035, .008), materials.gold, [0, .055, .17]);
  part(Pelvis, rounded(.052, .038, .012, .004), materials.leather, [0, .055, .193]);
  part(Spine, new THREE.CylinderGeometry(.265, .205, .46, 10), materials.cloth, [0, .03, 0], [0, 0, 0], [1, 1, .65]);
  part(Chest, plateGeometry([[-.18, .18], [0, .10], [.18, .18], [.15, -.16], [0, -.22], [-.15, -.16]], [], .018), materials.accent, [0, .015, .158]);
  part(Chest, plateGeometry([[-.055, .17], [0, .09], [.055, .17], [.038, -.13], [0, -.17], [-.038, -.13]], [], .012), materials.clothDark, [0, .02, .176]);
  tube(Chest, [V(-.20, .19, .12), V(-.10, .10, .18), V(0, .055, .19), V(.10, .10, .18), V(.20, .19, .12)], .012, materials.gold, 16);
  part(Neck, new THREE.CylinderGeometry(.075, .085, .16, 12), materials.skin, [0, -.015, 0]);

  part(Head, rounded(.34, .38, .30, .065), materials.skin, [0, .14, 0]);
  part(Head, rounded(.135, .095, .115, .028), materials.skin, [0, .035, .035], [0, 0, 0], [1, 1, .9]);
  for (const side of [-1, 1]) {
    part(Head, new THREE.SphereGeometry(.038, 12, 8), materials.skin, [side * .171, .13, 0], [0, 0, 0], [.55, 1, .65]);
    part(Head, new THREE.SphereGeometry(.038, 12, 8), materials.white, [side * .064, .17, .157], [0, 0, side * -.06], [1, .56, .28]);
    part(Head, new THREE.SphereGeometry(.014, 10, 6), materials.ink, [side * .059, .168, .174], [0, 0, 0], [.85, 1, .35]);
    part(Head, rounded(.078, .018, .022, .005), materials.hair, [side * .066, .211, .161], [0, 0, side * .16]);
    part(Head, rounded(.022, .055, .018, .006), materials.mask, [side * .105, .095, .145], [0, 0, side * -.18]);
  }
  part(Head, new THREE.ConeGeometry(.026, .072, 4), materials.skin, [0, .105, .181], [Math.PI / 2, 0, 0], [1, 1, .8]);
  part(Head, rounded(.30, .17, .305, .05), materials.mask, [0, .045, .018]);
  part(Head, rounded(.11, .018, .018, .006), materials.mask, [0, .103, .166]);
  part(Head, new THREE.SphereGeometry(.196, 24, 12, 0, TAU, 0, Math.PI * .52), materials.hair, [0, .20, -.008], [0, 0, 0], [.91, 1, .89]);
  part(Head, new THREE.SphereGeometry(.058, 14, 10), materials.hair, [0, .405, -.025], [0, 0, 0], [1, 1.15, .9]);
  part(Head, new THREE.CylinderGeometry(.012, .012, .19, 8), materials.gold, [0, .414, -.025], [0, 0, Math.PI / 2]);
  part(Head, new THREE.TorusGeometry(.176, .017, 6, 28), materials.accent, [0, .225, 0], [Math.PI / 2, 0, 0], [.93, 1, .90]);
  part(Head, rounded(.045, .06, .025, .008), materials.accent, [.165, .22, -.035], [0, 0, -.2]);

  for (const side of [-1, 1]) {
    const upper = side < 0 ? UpperArmL : UpperArmR;
    const forearm = side < 0 ? ForearmL : ForearmR;
    const hand = side < 0 ? HandL : HandR;
    chain([upper.name, forearm.name, hand.name], [upper.getWorldPosition(new THREE.Vector3()), forearm.getWorldPosition(new THREE.Vector3()), hand.getWorldPosition(new THREE.Vector3())], [.102, .086, .060], materials.cloth);
    part(upper, rounded(.19, .11, .22, .035), materials.leather, [0, -.035, 0], [0, 0, side * .08]);
    part(upper, rounded(.15, .035, .225, .012), materials.gold, [0, -.08, 0], [0, 0, side * .08]);
    part(forearm, new THREE.CylinderGeometry(.069, .063, .075, 10), materials.leather, [0, -.225, 0]);
    part(hand, new THREE.SphereGeometry(.064, 14, 10), materials.skin, [0, -.035, .005], [0, 0, 0], [.78, 1.12, .62]);
    for (let index = 0; index < 4; index++) part(hand, new THREE.CylinderGeometry(.010, .008, .065, 7), materials.skin, [(index - 1.5) * .018, -.086, .008], [.12, 0, 0]);
  }

  for (const side of [-1, 1]) {
    const thigh = side < 0 ? ThighL : ThighR;
    const shin = side < 0 ? ShinL : ShinR;
    const foot = side < 0 ? FootL : FootR;
    chain([thigh.name, shin.name, foot.name], [thigh.getWorldPosition(new THREE.Vector3()), shin.getWorldPosition(new THREE.Vector3()), foot.getWorldPosition(new THREE.Vector3())], [.122, .098, .072], materials.clothDark);
    part(shin, new THREE.CylinderGeometry(.083, .076, .20, 10), materials.leather, [0, -.30, 0]);
    part(shin, new THREE.TorusGeometry(.081, .012, 6, 14), materials.gold, [0, -.205, 0], [Math.PI / 2, 0, 0], [1, 1, .9]);
    part(foot, rounded(.18, .10, .30, .035), materials.leather, [0, -.03, .07]);
    part(foot, rounded(.185, .025, .305, .01), materials.clothDark, [0, -.068, .07]);
  }

  part(CoatTail, plateGeometry([[-.20, .02], [.20, .02], [.17, -.40], [0, -.48], [-.17, -.40]], [], .016), materials.cloth, [0, 0, 0], [.08, 0, 0]);
  part(CoatTail, plateGeometry([[-.17, -.02], [.17, -.02], [.14, -.35], [0, -.42], [-.14, -.35]], [], .008), materials.accent, [0, 0, .018], [.08, 0, 0]);
  part(SashTail, plateGeometry([[-.045, 0], [.045, 0], [.06, -.34], [-.025, -.40]], [], .012), materials.accent, [0, 0, 0], [0, 0, -.08]);
  tube(Pelvis, [V(-.20, .04, -.10), V(-.10, -.04, -.17), V(.08, -.08, -.16), V(.20, -.02, -.08)], .014, materials.accent, 14);

  stickPart( new THREE.CylinderGeometry(.032, .037, 1.66, 12), materials.wood);
  for (const end of [-1, 1]) {
    stickPart( new THREE.CylinderGeometry(.041, .041, .11, 12), materials.metal, [0, end * .82, 0]);
    stickPart( new THREE.TorusGeometry(.041, .008, 6, 14), materials.gold, [0, end * .765, 0], [Math.PI / 2, 0, 0]);
    stickPart( new THREE.SphereGeometry(.043, 12, 8), materials.gold, [0, end * .882, 0], [0, 0, 0], [1, .65, 1]);
  }
  for (const offset of [-.13, .13]) stickPart( new THREE.TorusGeometry(.035, .006, 6, 14), materials.leather, [0, offset, 0], [Math.PI / 2, 0, 0]);
  stickPart( plateGeometry([[-.025, 0], [.025, 0], [.035, -.13], [0, -.18], [-.035, -.13]], [], .008), materials.accent, [0, -.89, 0]);
  for (const offset of [-.027, 0, .027]) {
    stickTube( [V(offset, -.89, 0), V(offset * 1.8, -.96, .012), V(offset * 2.2, -1.025, .018)], .008, materials.accent, 7);
  }

  root.updateMatrixWorld(true);
  for (const entry of entries) {
    let geometry = entry.geometry ?? entry.mesh.geometry.clone();
    if (!entry.chain && geometry.index) geometry = geometry.toNonIndexed();
    for (const attribute of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'uv', 'chainWeights'].includes(attribute)) geometry.deleteAttribute(attribute);
    }
    if (!geometry.attributes.uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
    if (!entry.chain) geometry.applyMatrix4(entry.mesh.matrixWorld);
    const indexed = mergeVertices(geometry, 1e-5);
    geometry.dispose();
    entry.geometry = indexed;
    entry.mesh?.removeFromParent();
  }
  const built = buildSkinnedMeshes(root, bones, entries, 'Bagun');
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root, true);
  const restPose = new Map(bones.map((bone) => [bone.name, { position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }]));
  const clips = createClips({ root, boneMap, restPose, restStickQuaternion });
  return {
    root,
    skeleton: built.skeleton,
    bones,
    clips,
    materials: Object.values(materials),
    restPose,
    stats: {
      meshes: built.meshes.length,
      materials: new Set(entries.map((entry) => entry.material)).size,
      bones: bones.length,
      triangles: built.triangles,
      vertices: built.vertices,
      height: bounds.max.y - bounds.min.y,
      width: bounds.max.x - bounds.min.x,
      depth: bounds.max.z - bounds.min.z,
      footY: bounds.min.y,
      clips: clips.map((clip) => ({ name: clip.name, duration: clip.duration, tracks: clip.tracks.length })),
    },
  };
}

function createClips(context) {
  const { root, boneMap, restPose, restStickQuaternion } = context;
  const bones = [...boneMap.values()];
  const worldPosition = (name) => boneMap.get(name).getWorldPosition(new THREE.Vector3());
  const restLeft = worldPosition('HandL');
  const restRight = worldPosition('HandR');
  const restHandWorld = boneMap.get('HandR').getWorldQuaternion(new THREE.Quaternion());
  const clips = [];

  const armTracks = (keys, solve = true) => {
    const pose = (side, key, index) => {
      if (!solve || index === 0 || index === keys.length - 1) {
        return {
          upper: restPose.get(`UpperArm${side}`).quaternion.clone(),
          forearm: restPose.get(`Forearm${side}`).quaternion.clone(),
          hand: restPose.get(`Hand${side}`).quaternion.clone(),
          target: key[side === 'L' ? 'left' : 'right'].clone(),
        };
      }
      const handWorld = side === 'R' && key.stickQuaternion
        ? key.stickQuaternion.clone().multiply(restStickQuaternion.clone().invert()).multiply(restHandWorld)
        : new THREE.Quaternion();
      return solveArm(boneMap.get(`UpperArm${side}`), boneMap.get(`Forearm${side}`), boneMap.get(`Hand${side}`), key[side === 'L' ? 'left' : 'right'], V(side === 'L' ? -.8 : .8, -.45, .55), restPose, handWorld);
    };
    const times = keys.map((key) => key.time);
    for (let index = 0; index < keys.length; index++) {
      keys[index].left = pose('L', keys[index], index).target;
      keys[index].right = pose('R', keys[index], index).target;
    }
    return [
      quaternionTrack('UpperArmL', times, keys.map((key, index) => pose('L', key, index).upper)),
      quaternionTrack('ForearmL', times, keys.map((key, index) => pose('L', key, index).forearm)),
      quaternionTrack('HandL', times, keys.map((key, index) => pose('L', key, index).hand)),
      quaternionTrack('UpperArmR', times, keys.map((key, index) => pose('R', key, index).upper)),
      quaternionTrack('ForearmR', times, keys.map((key, index) => pose('R', key, index).forearm)),
      quaternionTrack('HandR', times, keys.map((key, index) => pose('R', key, index).hand)),
    ];
  };

  const idleTimes = [0, 1, 2, 3, 4];
  const idleKeys = idleTimes.map((time, index) => {
    const breath = index === 0 || index === 4 ? 0 : Math.sin(index / 4 * TAU);
    return {
      time,
      left: restLeft.clone().add(V(breath * .008, breath * .012, breath * .006)),
      right: restRight.clone().add(V(-breath * .006, breath * .014, breath * .008)),
      stickQuaternion: q([.12 + breath * .012, 0, -.24 + breath * .018]),
    };
  });
  clips.push(new THREE.AnimationClip('idle', 4, [
    ...armTracks(idleKeys),
    vectorTrack('Pelvis', idleTimes, idleTimes.map((time, index) => V(0, restPose.get('Pelvis').position.y + (index === 0 || index === 4 ? 0 : Math.sin(index / 4 * TAU) * .008), 0))),
    quaternionTrack('Chest', idleTimes, idleTimes.map((time, index) => q(index === 0 || index === 4 ? [0, 0, 0] : [breathEuler(index), 0, 0]))),
    quaternionTrack('Head', idleTimes, idleTimes.map((time, index) => q(index === 0 || index === 4 ? [0, 0, 0] : [Math.sin(index * 1.7) * .018, Math.sin(index / 4 * TAU) * .055, 0]))),
    quaternionTrack('CoatTail', idleTimes, idleTimes.map((time, index) => q(index === 0 || index === 4 ? [0, 0, 0] : [Math.sin(index / 4 * TAU * 2) * .035, 0, Math.sin(index / 4 * TAU) * .025]))),
    quaternionTrack('SashTail', idleTimes, idleTimes.map((time, index) => q(index === 0 || index === 4 ? [0, 0, 0] : [Math.sin(index / 4 * TAU * 3) * .06, 0, Math.cos(index / 4 * TAU) * .04]))),
  ]));

  const walkTimes = Array.from({ length: 9 }, (_, index) => index / 8);
  const stride = walkTimes.map((time) => Math.sin(time * TAU));
  const walkKeys = walkTimes.map((time, index) => ({
    time,
    left: restLeft.clone().add(V(stride[index] * .075, Math.abs(Math.cos(time * TAU)) * .025, -stride[index] * .06)),
    right: restRight.clone().add(V(-stride[index] * .075, Math.abs(Math.cos(time * TAU)) * .025, stride[index] * .06)),
    stickQuaternion: q([.12 - stride[index] * .035, stride[index] * .025, -.24 + stride[index] * .045]),
  }));
  clips.push(new THREE.AnimationClip('walk', 1, [
    ...armTracks(walkKeys),
    quaternionTrack('ThighL', walkTimes, stride.map((value) => q([value * .38, 0, 0]))),
    quaternionTrack('ThighR', walkTimes, stride.map((value) => q([-value * .38, 0, 0]))),
    quaternionTrack('ShinL', walkTimes, stride.map((value) => q([Math.max(0, -value) * .52, 0, 0]))),
    quaternionTrack('ShinR', walkTimes, stride.map((value) => q([Math.max(0, value) * .52, 0, 0]))),
    quaternionTrack('FootL', walkTimes, stride.map((value) => q([-value * .16, 0, 0]))),
    quaternionTrack('FootR', walkTimes, stride.map((value) => q([value * .16, 0, 0]))),
    vectorTrack('Pelvis', walkTimes, walkTimes.map((time) => V(0, restPose.get('Pelvis').position.y + Math.abs(Math.sin(time * TAU)) * .022, 0))),
    quaternionTrack('Chest', walkTimes, stride.map((value) => q([.02, value * .035, 0]))),
    quaternionTrack('CoatTail', walkTimes, walkTimes.map((time) => q([.08 + Math.sin(time * TAU) * .07, 0, Math.sin(time * TAU) * .045]))),
    quaternionTrack('SashTail', walkTimes, walkTimes.map((time) => q([Math.sin(time * TAU * 2) * .12, 0, Math.cos(time * TAU) * .08]))),
  ]));

  const swingTimes = [0, .35, .70, 1.05, 1.40, 1.80, 2.20];
  const swingKeys = [
    { time: 0, left: restLeft.clone(), right: restRight.clone(), stickQuaternion: restStickQuaternion.clone() },
    { time: .35, left: V(-.34, 1.34, .28), right: V(.25, 1.48, .31), stickQuaternion: q([.25, 0, -.55]) },
    { time: .70, left: V(-.46, 1.50, .18), right: V(.37, 1.64, .15), stickQuaternion: q([.15, 0, -1.15]) },
    { time: 1.05, left: V(-.40, 1.34, .36), right: V(.49, 1.29, .56), stickQuaternion: q([.55, .25, 1.15]) },
    { time: 1.40, left: V(-.30, 1.12, .44), right: V(.53, 1.04, .66), stickQuaternion: q([.75, .35, 1.45]) },
    { time: 1.80, left: V(-.24, 1.06, .34), right: V(.31, 1.10, .39), stickQuaternion: q([.25, 0, .55]) },
    { time: 2.20, left: restLeft.clone(), right: restRight.clone(), stickQuaternion: restStickQuaternion.clone() },
  ];
  clips.push(new THREE.AnimationClip('swing', 2.2, [
    ...armTracks(swingKeys),
    quaternionTrack('Head', swingTimes, swingKeys.map((key, index) => q(index < 3 ? [0, -.16 + index * .05, -.025] : index < 5 ? [.06, .16, .035] : [0, 0, 0]))),
    quaternionTrack('CoatTail', swingTimes, swingKeys.map((key, index) => q([index < 3 ? -.12 + index * .04 : .16 - index * .035, 0, Math.sin(index * 1.3) * .09]))),
    quaternionTrack('SashTail', swingTimes, swingKeys.map((key, index) => q([Math.sin(index * 1.8) * .16, 0, Math.cos(index * 1.4) * .12]))),
  ]));

  const flinchTimes = [0, .12, .30, .75];
  const flinchKeys = [
    { time: 0, left: restLeft.clone(), right: restRight.clone() },
    { time: .12, left: restLeft.clone().add(V(-.08, -.04, -.10)), right: restRight.clone().add(V(.09, -.02, -.08)) },
    { time: .30, left: restLeft.clone().add(V(-.03, -.02, -.04)), right: restRight.clone().add(V(.04, -.01, -.03)) },
    { time: .75, left: restLeft.clone(), right: restRight.clone() },
  ];
  clips.push(new THREE.AnimationClip('flinch', .75, [
    ...armTracks(flinchKeys),
    quaternionTrack('Head', flinchTimes, [q([0, 0, 0]), q([.22, -.20, -.12]), q([-.04, .06, .03]), q([0, 0, 0])]),
    vectorTrack('Pelvis', flinchTimes, [V(0, restPose.get('Pelvis').position.y, 0), V(0, restPose.get('Pelvis').position.y - .045, -.025), V(0, restPose.get('Pelvis').position.y - .015, -.008), V(0, restPose.get('Pelvis').position.y, 0)]),
    quaternionTrack('CoatTail', flinchTimes, [q([0, 0, 0]), q([-.18, 0, -.08]), q([.06, 0, .03]), q([0, 0, 0])]),
  ]));

  const deathTimes = [0, .07, .20, .38, .58, .78, 1].map((time) => time * 1.25);
  const deathProgress = deathTimes.map((time) => clamp(time / 1.25));
  const deathTracks = [
    vectorTrack('Root', deathTimes, deathProgress.map((progress) => V(0, .37 * ease(progress), 0))),
    quaternionTrack('Root', deathTimes, deathProgress.map((progress) => q([0, 0, 1.47 * ease(progress)]))),
    quaternionTrack('Head', deathTimes, deathProgress.map((progress) => q([-.10 * Math.sin(progress * Math.PI), .06 * Math.sin(progress * Math.PI), 0]))),
    quaternionTrack('CoatTail', deathTimes, deathProgress.map((progress) => q([.12 * Math.sin(progress * Math.PI), 0, 0]))),
  ];
  const dead = new THREE.AnimationClip('dead', 1.25, deathTracks);
  clips.push(dead);
  const revive = reverseClip(dead);
  revive.name = 'reviveRise';
  clips.push(revive);

  const victoryTimes = [0, .45, 1.0, 1.65, 2.15, 2.8];
  const victoryRight = [
    restRight.clone(),
    V(.30, 1.48, .24),
    V(.30, 1.78, .16),
    V(.30, 1.82, .14),
    V(.31, 1.58, .20),
    restRight.clone(),
  ];
  const victoryLeft = [
    restLeft.clone(),
    V(-.34, 1.22, .20),
    V(-.32, 1.16, .20),
    V(-.34, 1.20, .18),
    V(-.30, 1.14, .22),
    restLeft.clone(),
  ];
  const victoryKeys = victoryTimes.map((time, index) => ({
    time,
    left: victoryLeft[index],
    right: victoryRight[index],
    stickQuaternion: index === 0 || index === victoryTimes.length - 1
      ? restStickQuaternion.clone()
      : q([0, 0, -.08 * Math.sin(index)]),
  }));
  clips.push(new THREE.AnimationClip('victory', 2.8, [
    ...armTracks(victoryKeys),
    quaternionTrack('Chest', victoryTimes, victoryTimes.map((time, index) => q(index === 0 || index === 5 ? [0, 0, 0] : [-.055, 0, Math.sin(index * 1.2) * .025]))),
    quaternionTrack('Head', victoryTimes, victoryTimes.map((time, index) => q(index === 0 || index === 5 ? [0, 0, 0] : [-.10, 0, 0]))),
    quaternionTrack('CoatTail', victoryTimes, victoryTimes.map((time, index) => q([Math.sin(index * 1.4) * .09, 0, Math.sin(index) * .04]))),
    quaternionTrack('SashTail', victoryTimes, victoryTimes.map((time, index) => q([Math.sin(index * 1.8) * .16, 0, Math.cos(index) * .08]))),
  ]));

  return clips;
}

function breathEuler(index) {
  return Math.sin(index / 4 * TAU) * .012;
}
