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
    shirt: pbrMaterial('unbleached_cotton_shirt', '#d8d3c3', { seed: 51, roughness: .96, normal: .32 }),
    shirtShadow: pbrMaterial('shirt_folds_and_seams', '#b9b6aa', { seed: 55, roughness: .98, normal: .28 }),
    trousers: pbrMaterial('faded_slate_trousers', '#59636b', { seed: 59, roughness: .95, normal: .3 }),
    skin: pbrMaterial('pale_tired_skin', '#d7b69b', { seed: 63, roughness: .82, normal: .16 }),
    hair: pbrMaterial('ash_silver_hair', '#bfc3bd', { seed: 67, roughness: .86, normal: .26 }),
    leather: pbrMaterial('black_cloth_shoes', '#292c2b', { seed: 71, roughness: .93, normal: .34 }),
    paper: pbrMaterial('blank_role_placard', '#e7dfc8', { seed: 75, roughness: .92, normal: .2 }),
    ink: pbrMaterial('charcoal_marks', '#343735', { seed: 79, roughness: .9, normal: .08 }),
    white: pbrMaterial('eye_white', '#e8e3d6', { seed: 83, roughness: .58, normal: .05 }),
    thread: pbrMaterial('mended_red_thread', '#86564d', { seed: 87, roughness: .94, normal: .22 }),
    sole: pbrMaterial('worn_shoe_sole', '#6b675d', { seed: 91, roughness: .98, normal: .3 }),
    shadow: pbrMaterial('under_eye_shadow', '#9c8273', { seed: 95, roughness: .92, normal: .1 }),
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

function shirtPanelGeometry(side) {
  const rings = [
    { y: -.10, rx: .205, rz: .135 }, { y: -.04, rx: .220, rz: .150 },
    { y: .06, rx: .235, rz: .160 }, { y: .16, rx: .215, rz: .150 },
  ];
  const positions = [], uvs = [], indices = [], segments = 20;
  for (let row = 0; row < rings.length; row++) {
    const ring = rings[row], t = row / (rings.length - 1);
    for (let sideIndex = 0; sideIndex <= segments; sideIndex++) {
      const phi = sideIndex / segments * Math.PI;
      const fold = 1 + (.018 + t * .035) * Math.sin(phi * 7 + .4) + .012 * Math.sin(phi * 11 - t * 2);
      const hem = (1 - t) ** 3 * Math.sin(phi * 5) * .008;
      positions.push(-side * .11 + side * ring.rx * Math.sin(phi) * fold, ring.y + hem, .11 + ring.rz * Math.cos(phi) * fold);
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
    mesh.name = `Nobody_${material.name}`;
    mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
    root.add(mesh); mesh.bind(skeleton, new THREE.Matrix4());
    triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
    vertices += geometry.attributes.position.count;
    geometries.forEach((item) => item.dispose());
    items.forEach((item) => item.geometry.dispose());
  }
  return { skeleton, triangles, vertices, meshes: groups.size };
}

export function createNobody() {
  const materials = createMaterials();
  const root = new THREE.Group(); root.name = 'Nobody';
  root.userData = { visualId: 'nobody', suggestedCharId: 'nobody', upAxis: '+Y', forwardAxis: '+Z', units: 'meters', externalCredentialsUsed: false };
  const bones = [], boneMap = new Map();
  const addBone = (name, parent, position) => {
    const bone = new THREE.Bone(); bone.name = name; bone.position.copy(position); parent.add(bone); bones.push(bone); boneMap.set(name, bone); return bone;
  };
  const Root = addBone('Root', root, V(0, .021, 0));
  const Pelvis = addBone('Pelvis', Root, V(0, .90, 0));
  const Spine = addBone('Spine', Pelvis, V(0, .15, 0));
  const Chest = addBone('Chest', Spine, V(0, .22, 0));
  const Neck = addBone('Neck', Chest, V(0, .22, .035));
  const Head = addBone('Head', Neck, V(0, .13, .045));
  const UpperArmL = addBone('UpperArmL', Chest, V(-.255, .12, 0));
  const ForearmL = addBone('ForearmL', UpperArmL, V(0, -.30, 0));
  const HandL = addBone('HandL', ForearmL, V(0, -.27, 0));
  const UpperArmR = addBone('UpperArmR', Chest, V(.255, .12, 0));
  const ForearmR = addBone('ForearmR', UpperArmR, V(0, -.30, 0));
  const HandR = addBone('HandR', ForearmR, V(0, -.27, 0));
  const PlacardPivot = addBone('PlacardPivot', Chest, V(0, -.14, .18));
  const ThighL = addBone('ThighL', Pelvis, V(-.12, -.04, 0));
  const ShinL = addBone('ShinL', ThighL, V(0, -.39, 0));
  const FootL = addBone('FootL', ShinL, V(0, -.39, 0));
  const ThighR = addBone('ThighR', Pelvis, V(.12, -.04, 0));
  const ShinR = addBone('ShinR', ThighR, V(0, -.39, 0));
  const FootR = addBone('FootR', ShinR, V(0, -.39, 0));
  const CoatTailL = addBone('CoatTailL', Pelvis, V(-.11, -.02, -.10));
  const CoatTailR = addBone('CoatTailR', Pelvis, V(.11, -.02, -.10));
  const SleeveL = addBone('SleeveL', UpperArmL, V(0, -.16, 0));
  const SleeveR = addBone('SleeveR', UpperArmR, V(0, -.16, 0));
  const CollarL = addBone('CollarL', Chest, V(-.085, .16, .02));
  const CollarR = addBone('CollarR', Chest, V(.085, .16, .02));

  root.updateMatrixWorld(true);
  const initialRest = new Map(bones.map((bone) => [bone.name, { position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }]));
  const leftGrip = solveArm(UpperArmL, ForearmL, HandL, V(-.30, .76, .07), V(-.8, -.2, .45), initialRest);
  const rightGrip = solveArm(UpperArmR, ForearmR, HandR, V(.31, .77, .09), V(.8, -.2, .45), initialRest);
  for (const [bone, pose] of [[UpperArmL, leftGrip], [ForearmL, leftGrip], [HandL, leftGrip], [UpperArmR, rightGrip], [ForearmR, rightGrip], [HandR, rightGrip]]) bone.quaternion.copy(bone.name.startsWith('Upper') ? pose.upper : bone.name.startsWith('Fore') ? pose.forearm : pose.hand);
  Spine.rotation.x = .07; Chest.rotation.x = .045; Neck.rotation.x = -.08; Head.rotation.x = .04; Head.rotation.z = -.025;
  ThighL.rotation.x = -.025; ShinL.rotation.x = .045; ThighR.rotation.x = .035; ShinR.rotation.x = .085;
  CollarL.rotation.set(-.05, -.12, -.16); CollarR.rotation.set(-.05, .12, .16);
  root.updateMatrixWorld(true);
  const restLeft = HandL.getWorldPosition(new THREE.Vector3()), restRight = HandR.getWorldPosition(new THREE.Vector3());

  const entries = [];
  const part = (bone, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); mesh.rotation.set(...rotation); mesh.scale.set(...scale); bone.add(mesh); entries.push({ mesh, bone: bone.name, material, geometry: geometry.clone() }); return mesh;
  };
  const tube = (bone, points, radii, material, segments = 20, sides = 9) => part(bone, taperedTube(points, radii, segments, sides), material);
  const chain = (names, points, radii, material, options = {}) => entries.push({
    geometry: limbGeometry(
      points,
      Array.isArray(radii[0]) ? radii : radii.map((radius, index) => [index / (radii.length - 1), radius]),
      options.segments ?? 36,
      options.sides ?? 12,
      options
    ),
    material,
    chain: names
  });
  const rounded = (width, height, depth, radius = .02) => new RoundedBoxGeometry(width, height, depth, 2, radius);
  const sphere = (radius = 1) => new THREE.SphereGeometry(radius, 18, 12);

  part(Neck, new THREE.CylinderGeometry(.054, .062, .14, 16), materials.skin, [0, .035, 0]);
  part(Pelvis, sphere(), materials.trousers, [0, -.02, 0], [0, 0, 0], [.225, .16, .15]);
  part(Chest, ringSurfaceGeometry([
    { y: -.30, rx: .215, rz: .140 }, { y: -.22, rx: .235, rz: .155 },
    { y: -.08, rx: .250, rz: .165 }, { y: .08, rx: .255, rz: .160 },
    { y: .18, rx: .225, rz: .140 }, { y: .25, rx: .145, rz: .100 },
  ], 26, .012), materials.shirt);
  part(Chest, rounded(.024, .35, .012, .004), materials.shirtShadow, [0, -.035, .163]);
  for (const y of [.12, -.02, -.15]) part(Chest, sphere(.010), materials.shirtShadow, [0, y, .174], [0, 0, 0], [1, 1, .45]);
  for (const offset of [-.115, .115]) {
    tube(Chest, [V(offset, -.18, .142), V(offset * .92, -.04, .171), V(offset * .78, .10, .151)], [.0035, .005, .0025], materials.shirtShadow, 12, 5);
  }
  part(CollarL, plateGeometry([[0, .06], [-.09, .10], [-.12, -.04], [-.02, -.08]], .012), materials.shirt, [0, 0, 0], [0, -.12, 0]);
  part(CollarR, plateGeometry([[0, .06], [.09, .10], [.12, -.04], [.02, -.08]], .012), materials.shirt, [0, 0, 0], [0, .12, 0]);
  tube(CollarL, [V(-.012, .052, .010), V(-.085, .068, .010), V(-.105, -.02, .010)], [.003, .004, .0025], materials.shirtShadow, 9, 5);
  tube(CollarR, [V(.012, .052, .010), V(.085, .068, .010), V(.105, -.02, .010)], [.003, .004, .0025], materials.shirtShadow, 9, 5);

  tube(Chest, [V(-.075, .15, .12), V(-.105, .02, .17), V(-.09, -.10, .18)], [.006, .005, .004], materials.ink, 10, 5);
  tube(Chest, [V(.075, .15, .12), V(.105, .02, .17), V(.09, -.10, .18)], [.006, .005, .004], materials.ink, 10, 5);
  part(PlacardPivot, rounded(.25, .30, .018, .008), materials.paper, [0, -.14, .01], [0, 0, -.025]);
  part(PlacardPivot, rounded(.085, .014, .006, .003), materials.ink, [0, -.14, .024], [0, 0, -.025]);
  part(PlacardPivot, sphere(.006), materials.ink, [-.09, -.015, .024], [0, 0, 0], [1, 1, .4]);
  part(PlacardPivot, sphere(.006), materials.ink, [.09, -.015, .024], [0, 0, 0], [1, 1, .4]);

  for (const side of [-1, 1]) {
    const tail = side < 0 ? CoatTailL : CoatTailR;
    part(tail, shirtPanelGeometry(side), materials.shirt);
    const hemPoints = Array.from({ length: 15 }, (_, index) => {
      const phi = index / 14 * Math.PI;
      return V(-side * .11 + side * .205 * Math.sin(phi), -.10 + Math.sin(phi * 5) * .008, .11 + .135 * Math.cos(phi));
    });
    part(tail, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hemPoints), 26, .0035, 5, false), materials.shirtShadow);
    for (const phi of [.48, 1.18, 1.88, 2.58]) {
      const foldPoints = [
        V(-side * .11 + side * .15 * Math.sin(phi), .14, .11 + .105 * Math.cos(phi)),
        V(-side * .11 + side * .19 * Math.sin(phi), .02, .11 + .13 * Math.cos(phi)),
        V(-side * .11 + side * .225 * Math.sin(phi), -.08, .11 + .145 * Math.cos(phi)),
      ];
      part(tail, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(foldPoints), 12, .003, 5, false), materials.shirtShadow);
    }
  }

  part(Head, sphere(), materials.skin, [0, .10, .01], [0, 0, 0], [.155, .205, .145]);
  part(Head, sphere(), materials.skin, [0, -.02, .04], [0, 0, 0], [.12, .09, .11]);
  for (const side of [-1, 1]) {
    part(Head, sphere(.032), materials.skin, [side * .15, .09, .005], [0, 0, 0], [.55, 1.15, .7]);
    part(Head, sphere(.030), materials.white, [side * .057, .125, .137], [0, 0, side * .06], [1, .40, .28]);
    part(Head, sphere(.010), materials.ink, [side * .056, .124, .151], [0, 0, 0], [.75, .8, .35]);
    part(Head, sphere(.022), materials.shadow, [side * .059, .095, .139], [0, 0, 0], [1.2, .28, .25]);
    tube(Head, [V(side * .09, .163, .13), V(side * .057, .17, .148), V(side * .025, .16, .145)], [.008, .010, .006], materials.hair, 7, 5);
  }
  tube(Head, [V(-.052, -.035, .139), V(0, -.045, .15), V(.05, -.032, .138)], [.007, .009, .006], materials.ink, 9, 5);
  part(Head, sphere(.022), materials.skin, [0, .055, .151], [0, 0, 0], [.65, 1.1, .8]);
  part(Head, new THREE.SphereGeometry(.163, 22, 12, 0, TAU, 0, Math.PI * .52), materials.hair, [0, .15, -.005], [0, 0, 0], [.98, .95, .96]);
  for (const side of [-1, 1]) tube(Head, [V(side * .12, .16, .04), V(side * .145, .10, .055), V(side * .15, .035, .04)], [.025, .022, .008], materials.hair, 8, 6);
  tube(Head, [V(-.09, .22, .08), V(-.025, .25, .11), V(.055, .22, .12)], [.028, .022, .005], materials.hair, 10, 6);

  for (const side of [-1, 1]) {
    const upper = side < 0 ? UpperArmL : UpperArmR, forearm = side < 0 ? ForearmL : ForearmR, hand = side < 0 ? HandL : HandR, sleeve = side < 0 ? SleeveL : SleeveR;
    chain(
      [upper.name, forearm.name, hand.name],
      [upper.getWorldPosition(new THREE.Vector3()), forearm.getWorldPosition(new THREE.Vector3()), hand.getWorldPosition(new THREE.Vector3())],
      [[0, .094], [.18, .106], [.50, .090], [.78, .063], [1, .048]],
      materials.shirt,
      { segments: 40, sides: 14, folds: .045 }
    );
    part(upper, sphere(), materials.shirt, [0, -.025, 0], [0, 0, 0], [.104, .115, .104]);
    part(sleeve, new THREE.CylinderGeometry(.090, .078, .15, 16), materials.shirt, [0, -.035, 0], [0, 0, 0], [1, 1, .96]);
    for (const offset of [-.060, 0, .060]) {
      tube(sleeve, [V(offset, .030, .080), V(offset * 1.15, -.035, .092), V(offset * 1.25, -.095, .074)], [.003, .004, .0025], materials.shirtShadow, 9, 5);
    }
    part(forearm, new THREE.CylinderGeometry(.052, .047, .038, 16), materials.shirtShadow, [0, -.242, 0]);
    part(forearm, new THREE.TorusGeometry(.050, .003, 5, 18), materials.shirt, [0, -.258, 0], [Math.PI / 2, 0, 0]);
    part(hand, new THREE.CylinderGeometry(.032, .035, .052, 12), materials.skin, [0, .008, 0]);
    part(hand, sphere(), materials.skin, [0, -.032, .005], [0, 0, 0], [.050, .068, .042]);
    for (let finger = 0; finger < 4; finger++) {
      const x = (finger - 1.5) * .017, length = [.040, .052, .049, .038][finger];
      tube(hand, [V(x, -.070, .008), V(x + side * .002, -.070 - length * .55, .012), V(x + side * .004, -.070 - length, .008)], [.0075, .0065, .0045], materials.skin, 7, 5);
    }
    tube(hand, [V(-side * .040, -.020, .006), V(-side * .058, -.038, .014), V(-side * .052, -.060, .010)], [.010, .008, .0055], materials.skin, 8, 5);
  }
  part(Chest, rounded(.07, .045, .008, .004), materials.thread, [-.14, -.12, .15], [0, 0, -.18]);

  for (const side of [-1, 1]) {
    const thigh = side < 0 ? ThighL : ThighR, shin = side < 0 ? ShinL : ShinR, foot = side < 0 ? FootL : FootR;
    chain(
      [thigh.name, shin.name, foot.name],
      [thigh.getWorldPosition(new THREE.Vector3()), shin.getWorldPosition(new THREE.Vector3()), foot.getWorldPosition(new THREE.Vector3())],
      [[0, .108], [.22, .104], [.52, .088], [.78, .072], [1, .064]],
      materials.trousers,
      { segments: 38, sides: 14, folds: .022 }
    );
    tube(thigh, [V(-.038, -.08, .093), V(0, -.18, .101), V(.038, -.08, .093)], [.0035, .005, .0035], materials.trousers, 10, 5);
    part(shin, new THREE.CylinderGeometry(.074, .069, .11, 14), materials.trousers, [0, -.30, 0]);
    for (const y of [-.20, -.255]) {
      tube(shin, [V(-.050, y + .018, .060), V(0, y, .075), V(.050, y + .018, .060)], [.003, .004, .003], materials.shirtShadow, 9, 5);
    }
    part(shin, new THREE.CylinderGeometry(.069, .067, .055, 14), materials.trousers, [0, -.35, 0]);
    part(foot, sphere(), materials.leather, [0, -.022, .072], [0, 0, 0], [.094, .056, .166]);
    part(foot, rounded(.188, .022, .306, .008), materials.sole, [0, -.065, .072]);
    part(foot, rounded(.142, .034, .070, .008), materials.sole, [0, -.043, -.060]);
    tube(foot, [V(-.070, .002, .120), V(0, .016, .137), V(.070, .002, .120)], [.0035, .0045, .0035], materials.sole, 12, 5);
    tube(foot, [V(-.078, -.006, -.030), V(-.084, -.012, .075), V(-.068, -.020, .188)], [.0025, .0035, .002], materials.shirtShadow, 12, 5);
    tube(foot, [V(.078, -.006, -.030), V(.084, -.012, .075), V(.068, -.020, .188)], [.0025, .0035, .002], materials.shirtShadow, 12, 5);
    if (side > 0) part(shin, new THREE.CylinderGeometry(.068, .066, .045, 14), materials.shirtShadow, [0, -.365, 0]);
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
    vectorTrack('Spine', idleTimes, idleTimes.map((_, index) => V(0, restPose.get('Spine').position.y + (index === 0 || index === 4 ? 0 : Math.sin(index / 4 * TAU) * .006), 0))),
    quaternionTrack('Head', idleTimes, idleTimes.map((_, index) => index === 0 || index === 4 ? restPose.get('Head').quaternion.clone() : q([.04 + Math.sin(index * 1.4) * .012, Math.sin(index / 4 * TAU) * .035, -.025]))),
    quaternionTrack('PlacardPivot', idleTimes, idleTimes.map((_, index) => q([Math.sin(index / 4 * TAU * 2) * .018, 0, Math.sin(index / 4 * TAU) * .012]))),
    quaternionTrack('CoatTailL', idleTimes, idleTimes.map((_, index) => q([Math.sin(index / 4 * TAU * 2) * .012, 0, 0]))),
    quaternionTrack('CoatTailR', idleTimes, idleTimes.map((_, index) => q([Math.cos(index / 4 * TAU * 2) * .01, 0, 0]))),
  ]));

  const walkTimes = Array.from({ length: 9 }, (_, index) => index / 8), stride = walkTimes.map((time) => Math.sin(time * TAU));
  clips.push(new THREE.AnimationClip('walk', 1, [
    quaternionTrack('ThighL', walkTimes, stride.map((value) => q([value * .24, 0, -.02]))), quaternionTrack('ThighR', walkTimes, stride.map((value) => q([-value * .24, 0, .02]))),
    quaternionTrack('ShinL', walkTimes, stride.map((value) => q([Math.max(0, -value) * .32, 0, 0]))), quaternionTrack('ShinR', walkTimes, stride.map((value) => q([Math.max(0, value) * .32, 0, 0]))),
    quaternionTrack('FootL', walkTimes, stride.map((value) => q([-value * .08, 0, 0]))), quaternionTrack('FootR', walkTimes, stride.map((value) => q([value * .08, 0, 0]))),
    vectorTrack('Pelvis', walkTimes, walkTimes.map((time) => V(0, restPose.get('Pelvis').position.y + Math.abs(Math.sin(time * TAU)) * .012, 0))),
    quaternionTrack('Spine', walkTimes, stride.map((value) => q([.07, value * .025, value * .015]))),
    quaternionTrack('PlacardPivot', walkTimes, stride.map((value) => q([-.04 + value * .035, 0, value * .025]))),
    quaternionTrack('UpperArmL', walkTimes, stride.map((value) => q([value * .10, 0, .08]))), quaternionTrack('UpperArmR', walkTimes, stride.map((value) => q([-value * .10, 0, -.08]))),
    quaternionTrack('SleeveL', walkTimes, stride.map((value) => q([value * .035, 0, value * .012]))), quaternionTrack('SleeveR', walkTimes, stride.map((value) => q([-value * .035, 0, -value * .012]))),
    quaternionTrack('CoatTailL', walkTimes, stride.map((value) => q([value * .045, 0, value * .010]))), quaternionTrack('CoatTailR', walkTimes, stride.map((value) => q([-value * .045, 0, -value * .010]))),
  ]));

  const swingTimes = [0, .35, .70, 1.05, 1.40, 1.80, 2.20];
  clips.push(new THREE.AnimationClip('swing', 2.2, [
    quaternionTrack('Head', swingTimes, swingTimes.map((_, index) => q(index < 3 ? [.09, -.16, -.06] : index < 5 ? [-.02, .12, .03] : [.04, 0, -.025]))),
    quaternionTrack('Spine', swingTimes, swingTimes.map((_, index) => q(index < 3 ? [.10, -.05, -.02] : index < 5 ? [.04, .06, .02] : [.07, 0, 0]))),
    quaternionTrack('UpperArmR', swingTimes, swingTimes.map((_, index) => q(index >= 2 && index <= 4 ? [-.55, 0, -.35] : [0, 0, 0]))),
    quaternionTrack('ForearmR', swingTimes, swingTimes.map((_, index) => q(index >= 2 && index <= 4 ? [-.65, 0, 0] : [0, 0, 0]))),
    quaternionTrack('PlacardPivot', swingTimes, swingTimes.map((_, index) => q([Math.sin(index) * .035, 0, Math.sin(index * .8) * .03]))),
    quaternionTrack('SleeveR', swingTimes, swingTimes.map((_, index) => q(index >= 2 && index <= 4 ? [-.08, 0, -.025] : [0, 0, 0]))),
    quaternionTrack('CoatTailL', swingTimes, swingTimes.map((_, index) => q([Math.sin(index * .9) * .025, 0, 0]))),
    quaternionTrack('CoatTailR', swingTimes, swingTimes.map((_, index) => q([Math.cos(index * .9) * .025, 0, 0]))),
  ]));

  const castTimes = [0, .45, 1.0, 1.55, 2.1, 2.7];
  clips.push(new THREE.AnimationClip('cast', 2.7, [
    quaternionTrack('Head', castTimes, castTimes.map((_, index) => q(index > 0 && index < 5 ? [.20, 0, -.04] : [.04, 0, -.025]))),
    quaternionTrack('UpperArmL', castTimes, castTimes.map((_, index) => q(index > 0 && index < 5 ? [-.45, 0, .18] : [0, 0, 0]))),
    quaternionTrack('UpperArmR', castTimes, castTimes.map((_, index) => q(index > 0 && index < 5 ? [-.45, 0, -.18] : [0, 0, 0]))),
    quaternionTrack('ForearmL', castTimes, castTimes.map((_, index) => q(index > 0 && index < 5 ? [-.75, 0, 0] : [0, 0, 0]))),
    quaternionTrack('ForearmR', castTimes, castTimes.map((_, index) => q(index > 0 && index < 5 ? [-.75, 0, 0] : [0, 0, 0]))),
    quaternionTrack('PlacardPivot', castTimes, castTimes.map((_, index) => q([index > 0 && index < 5 ? -.08 : 0, 0, 0]))),
  ]));

  const flinchTimes = [0, .12, .30, .75];
  clips.push(new THREE.AnimationClip('flinch', .75, [
    quaternionTrack('Head', flinchTimes, [restPose.get('Head').quaternion.clone(), q([.20, -.18, -.12]), q([.08, .05, .02]), restPose.get('Head').quaternion.clone()]),
    vectorTrack('Pelvis', flinchTimes, [V(0, restPose.get('Pelvis').position.y, 0), V(0, restPose.get('Pelvis').position.y - .035, -.025), V(0, restPose.get('Pelvis').position.y - .01, -.008), V(0, restPose.get('Pelvis').position.y, 0)]),
    quaternionTrack('PlacardPivot', flinchTimes, [q([0, 0, 0]), q([-.20, 0, -.10]), q([.04, 0, .02]), q([0, 0, 0])]),
  ]));

  const deathTimes = [0, .0875, .25, .475, .725, .975, 1.25], progress = deathTimes.map((time) => time / 1.25);
  const dead = new THREE.AnimationClip('dead', 1.25, [
    vectorTrack('Root', deathTimes, progress.map((value) => V(0, restPose.get('Root').position.y + .34 * ease(value), 0))),
    quaternionTrack('Root', deathTimes, progress.map((value) => q([0, 0, -1.46 * ease(value)]))),
    quaternionTrack('Head', deathTimes, progress.map((value) => q([.04 - .10 * Math.sin(value * Math.PI), 0, -.025]))),
    quaternionTrack('PlacardPivot', deathTimes, progress.map((value) => q([.16 * Math.sin(value * Math.PI), 0, .08 * Math.sin(value * Math.PI)]))),
    quaternionTrack('UpperArmR', deathTimes, progress.map((value) => restPose.get('UpperArmR').quaternion.clone().multiply(q([-1.05 * ease(value), 0, 0])))),
    quaternionTrack('CoatTailR', deathTimes, progress.map((value) => restPose.get('CoatTailR').quaternion.clone().multiply(q([-.38 * ease(value), 0, 0])))),
  ]);
  clips.push(dead); const revive = reverseClip(dead); revive.name = 'reviveRise'; clips.push(revive);

  const victoryTimes = [0, .45, 1.0, 1.65, 2.15, 2.8];
  clips.push(new THREE.AnimationClip('victory', 2.8, [
    quaternionTrack('Head', victoryTimes, victoryTimes.map((_, index) => q(index > 0 && index < 5 ? [-.06, -.08, -.03] : [.04, 0, -.025]))),
    quaternionTrack('UpperArmR', victoryTimes, victoryTimes.map((_, index) => q(index > 0 && index < 5 ? [-1.55, 0, -.30] : [0, 0, 0]))),
    quaternionTrack('ForearmR', victoryTimes, victoryTimes.map((_, index) => q(index > 0 && index < 5 ? [-.55 + Math.sin(index * 2) * .15, 0, 0] : [0, 0, 0]))),
    quaternionTrack('PlacardPivot', victoryTimes, victoryTimes.map((_, index) => q([Math.sin(index) * .025, 0, Math.sin(index * .7) * .02]))),
  ]));
  return clips;
}
