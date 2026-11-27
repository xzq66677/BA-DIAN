import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const rad = (degrees) => degrees * Math.PI / 180;
const clamp = (value) => Math.max(0, Math.min(1, value));
const ease = (value) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const byte = (value) => Math.max(0, Math.min(255, value));

function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function canvasTexture(kind, seed, color, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  const random = randomSource(seed);
  const base = new THREE.Color(color).convertLinearToSRGB();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const grain = (random() - .5) * (kind === 'fabric' ? 20 : 9);
      const wave = Math.sin(x * .31 + Math.sin(y * .09) * 2) * (kind === 'metal' ? 5 : 1.5);
      const weave = kind === 'fabric' ? ((x % 4 === 0 ? 5 : 0) - (y % 4 === 0 ? 5 : 0)) : 0;
      image.data[index] = byte(base.r * 255 + grain + wave + weave);
      image.data[index + 1] = byte(base.g * 255 + grain + wave + weave);
      image.data[index + 2] = byte(base.b * 255 + grain + wave + weave);
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  if (kind === 'metal') {
    context.globalAlpha = .18;
    context.strokeStyle = '#fff6d8';
    context.lineWidth = .6;
    for (let i = 0; i < 90; i++) {
      const y = random() * size;
      context.beginPath();
      context.moveTo(random() * size * .3, y);
      context.lineTo(size * (.5 + random() * .5), y + random() * 1.5);
      context.stroke();
    }
    context.globalAlpha = 1;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === 'fabric' ? 3 : 2, kind === 'fabric' ? 3 : 2);
  texture.anisotropy = 8;
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
      const row = Math.sin(y * .43) * .5 + .5;
      heights[y * size + x] = grain + Math.sin(x * .2 + y * .13) * .08;
      let value;
      if (kind === 'roughness') value = 145 + grain * 35 + row * 8;
      else value = kind === 'metal' ? 225 + grain * 30 : 8 + grain * 12;
      if (kind !== 'normal') {
        image.data[index] = image.data[index + 1] = image.data[index + 2] = byte(value);
      }
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
        const normal = new THREE.Vector3((left - right) * 1.8, (up - down) * 1.8, 1).normalize();
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
  const material = new THREE.MeshPhysicalMaterial({
    name,
    color: 0xffffff,
    map: canvasTexture(options.kind ?? 'paint', options.seed ?? 1, color),
    roughness: options.roughness ?? .5,
    roughnessMap: scalarTexture('roughness', (options.seed ?? 1) + 11),
    metalness: options.metalness ?? .05,
    metalnessMap: scalarTexture('metalness', (options.seed ?? 1) + 23),
    normalMap: scalarTexture('normal', (options.seed ?? 1) + 37),
    normalScale: new THREE.Vector2(options.normal ?? .18, options.normal ?? .18),
    clearcoat: options.clearcoat ?? 0,
    clearcoatRoughness: options.clearcoatRoughness ?? .3,
  });
  material.map.colorSpace = THREE.SRGBColorSpace;
  return material;
}

function createMaterials() {
  return {
    enamel: pbrMaterial('enamel_teal', '#258c88', { seed: 3, kind: 'paint', roughness: .3, clearcoat: .72 }),
    enamelDark: pbrMaterial('enamel_oxblood', '#873347', { seed: 7, kind: 'paint', roughness: .38, clearcoat: .5 }),
    brass: pbrMaterial('brushed_brass', '#e3b85f', { seed: 13, kind: 'metal', roughness: .27, metalness: .92, normal: .1 }),
    fabric: pbrMaterial('burgundy_fabric', '#642c3c', { seed: 19, kind: 'fabric', roughness: .86, metalness: 0, normal: .28 }),
    ceramic: pbrMaterial('ivory_ceramic', '#f2e6c9', { seed: 23, kind: 'paint', roughness: .34, clearcoat: .28 }),
    rubber: pbrMaterial('joint_rubber', '#26383a', { seed: 29, kind: 'fabric', roughness: .92, metalness: 0, normal: .12 }),
    cyan: new THREE.MeshStandardMaterial({ name: 'signal_cyan', color: '#79f7ed', emissive: '#36cfc9', emissiveIntensity: 1.7, roughness: .24, metalness: .15 }),
    red: new THREE.MeshStandardMaterial({ name: 'signal_red', color: '#ff725e', emissive: '#d52f32', emissiveIntensity: 1.25, roughness: .32, metalness: .08 }),
    gold: new THREE.MeshStandardMaterial({ name: 'symbol_gold', color: '#ffd36c', emissive: '#7a4308', emissiveIntensity: .3, roughness: .3, metalness: .65 }),
    ink: new THREE.MeshStandardMaterial({ name: 'reel_ink', color: '#13262d', roughness: .66, metalness: .18 }),
    glass: new THREE.MeshPhysicalMaterial({ name: 'reel_glass', color: '#b9ffff', roughness: .08, metalness: 0, transparent: true, opacity: .12, clearcoat: 1, depthWrite: false }),
  };
}

function makeClip(name, duration, tracks) {
  return new THREE.AnimationClip(name, duration, tracks);
}

function quaternionTrack(bone, times, rotations) {
  const values = rotations.flatMap((rotation) => {
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
    return quaternion.toArray();
  });
  return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
}

function createClips(bones) {
  const clips = [];
  const upperLength = Math.hypot(.18, -.20);
  const lowerLength = Math.hypot(-.01, .18);
  const restUpperAngle = Math.atan2(-.20, .18);
  const restLowerAngle = Math.atan2(.18, -.01);
  const restElbow = restLowerAngle - restUpperAngle;
  const rightArmForLever = (angle) => {
    const targetX = .01 + .16 * Math.cos(angle) - .32 * Math.sin(angle);
    const targetY = -.34 + .16 * Math.sin(angle) + .32 * Math.cos(angle);
    const distance = Math.min(Math.hypot(targetX, targetY), upperLength + lowerLength - .0001);
    const elbowCosine = (distance * distance - upperLength * upperLength - lowerLength * lowerLength) / (2 * upperLength * lowerLength);
    const elbow = Math.acos(Math.max(-1, Math.min(1, elbowCosine)));
    const targetAngle = Math.atan2(targetY, targetX);
    const upper = targetAngle - Math.atan2(lowerLength * Math.sin(elbow), upperLength + lowerLength * Math.cos(elbow)) - restUpperAngle;
    return { upper: [0, 0, upper], lower: [0, 0, elbow - restElbow] };
  };
  clips.push(makeClip('idle', 4, [
    quaternionTrack('Chest', [0, 1, 2, 3, 4], [[0, 0, 0], [.012, 0, .008], [0, 0, 0], [-.01, 0, -.006], [0, 0, 0]]),
    quaternionTrack('Head', [0, 1, 2, 3, 4], [[0, 0, 0], [-.015, .045, 0], [0, 0, 0], [.01, -.035, 0], [0, 0, 0]]),
    quaternionTrack('Lever', [0, 1, 2, 3, 4], [[0, 0, 0], [0, 0, -.018], [0, 0, 0], [0, 0, .012], [0, 0, 0]]),
    new THREE.VectorKeyframeTrack('Pelvis.position', [0, 1, 2, 3, 4], [0, .82, 0, 0, .825, 0, 0, .82, 0, 0, .819, 0, 0, .82, 0]),
  ]));

  const walkTimes = Array.from({ length: 9 }, (_, index) => index / 8);
  const stride = walkTimes.map((time) => Math.sin(time * TAU));
  clips.push(makeClip('walk', 1, [
    quaternionTrack('Thigh.L', walkTimes, stride.map((value) => [-value * .48, 0, 0])),
    quaternionTrack('Thigh.R', walkTimes, stride.map((value) => [value * .48, 0, 0])),
    quaternionTrack('Shin.L', walkTimes, stride.map((value) => [Math.max(0, -value) * .58, 0, 0])),
    quaternionTrack('Shin.R', walkTimes, stride.map((value) => [Math.max(0, value) * .58, 0, 0])),
    quaternionTrack('UpperArm.L', walkTimes, stride.map((value) => [value * .38, 0, -.04])),
    quaternionTrack('Forearm.R', walkTimes, stride.map((value) => [0, 0, -value * .12])),
    quaternionTrack('Chest', walkTimes, stride.map((value) => [.035, value * .055, 0])),
    new THREE.VectorKeyframeTrack('Pelvis.position', walkTimes, walkTimes.flatMap((time) => [0, .82 + Math.abs(Math.sin(time * TAU)) * .026, 0])),
  ]));

  const pullKeys = [[0, 0], [.25, -.08], [.48, -.34], [.62, -.76], [.78, -.84], [.94, -.68], [1.12, -.36], [1.32, -.08], [1.55, 0], [1.85, 0], [2.25, 0], [2.6, 0]];
  const pullTimes = Array.from({ length: 53 }, (_, index) => index * .05);
  const leverPull = pullTimes.map((time) => {
    const next = pullKeys.findIndex(([keyTime]) => keyTime >= time);
    if (next <= 0) return pullKeys[0][1];
    const [previousTime, previousAngle] = pullKeys[next - 1];
    const [nextTime, nextAngle] = pullKeys[next];
    return THREE.MathUtils.lerp(previousAngle, nextAngle, (time - previousTime) / (nextTime - previousTime));
  });
  clips.push(makeClip('slot_pull', 2.6, [
    quaternionTrack('Lever', pullTimes, leverPull.map((value) => [0, 0, value])),
    quaternionTrack('UpperArm.R', pullTimes, leverPull.map(rightArmForLever).map((pose) => pose.upper)),
    quaternionTrack('Forearm.R', pullTimes, leverPull.map(rightArmForLever).map((pose) => pose.lower)),
    quaternionTrack('Chest', pullTimes, leverPull.map((value) => [-value * .08, value * .08, 0])),
    quaternionTrack('Head', pullTimes, leverPull.map((value) => [-value * .1, -value * .16, 0])),
    quaternionTrack('UpperArm.L', pullTimes, leverPull.map((value) => [0, 0, -value * .22])),
  ]));

  const reelTimes = [0, .58];
  const reelValues = [[0, 0, 0], [0, 0, 0]];
  for (let index = 1; index <= 18; index++) {
    const time = .58 + index * .055;
    reelTimes.push(time);
    const progress = ease((time - .58) / .99);
    reelValues.push([0, 0, 0]);
    reelValues[index + 1] = [progress * TAU * 4, 0, 0];
  }
  reelTimes.push(1.57, 2.6);
  reelValues.push([TAU * 4, 0, 0], [TAU * 4, 0, 0]);
  for (let reel = 0; reel < 3; reel++) {
    const values = reelValues.map((rotation, index) => {
      const progress = index > 1 ? ease((reelTimes[index] - .58) / .99) : 0;
      return [rotation[0] + reel * Math.PI / 2 * progress, 0, 0];
    });
    values[values.length - 1] = [TAU * 4 + reel * Math.PI / 2, 0, 0];
    clips[2].tracks.push(quaternionTrack(`Reel.${reel + 1}`, reelTimes, values));
  }

  clips.push(makeClip('flinch', .85, [
    quaternionTrack('Chest', [0, .14, .32, .85], [[0, 0, 0], [-.2, .18, .12], [.06, -.06, -.04], [0, 0, 0]]),
    quaternionTrack('Head', [0, .14, .32, .85], [[0, 0, 0], [.22, -.24, -.12], [-.05, .08, .03], [0, 0, 0]]),
    quaternionTrack('UpperArm.L', [0, .14, .32, .85], [[0, 0, 0], [-.45, 0, -.28], [.08, 0, 0], [0, 0, 0]]),
    quaternionTrack('UpperArm.R', [0, .14, .32, .85], [[0, 0, 0], [-.3, 0, .36], [.05, 0, 0], [0, 0, 0]]),
    new THREE.VectorKeyframeTrack('Pelvis.position', [0, .14, .32, .85], [0, .82, 0, 0, .78, 0, 0, .815, 0, 0, .82, 0]),
  ]));

  const fallTimes = Array.from({ length: 21 }, (_, index) => index / 20);
  const fallSupport = [0, 0.0212, 0.0393, 0.0573, 0.0752, 0.093, 0.1104, 0.1273, 0.1462, 0.1641, 0.1812, 0.1972, 0.2117, 0.2249, 0.2369, 0.2471, 0.2557, 0.2624, 0.2677, 0.3644, 0.47];
  clips.push(makeClip('dead', 1, [
    quaternionTrack('Root', [0, .35, 1], [[0, 0, 0], [.45, 0, .05], [Math.PI / 2, 0, 0]]),
    new THREE.VectorKeyframeTrack('Root.position', fallTimes, fallTimes.flatMap((_, index) => [0, fallSupport[index], 0])),
    quaternionTrack('Head', [0, .5, 1], [[0, 0, 0], [-.15, .12, 0], [-.22, .18, 0]]),
    quaternionTrack('UpperArm.L', [0, .5, 1], [[0, 0, 0], [.2, 0, -.4], [.12, 0, -.65]]),
    quaternionTrack('UpperArm.R', [0, .5, 1], [[0, 0, 0], [.15, 0, .35], [.1, 0, .55]]),
  ]));

  clips.push(makeClip('reviveRise', 1, [
    quaternionTrack('Root', [0, .4, 1], [[Math.PI / 2, 0, 0], [.35, 0, 0], [0, 0, 0]]),
    new THREE.VectorKeyframeTrack('Root.position', fallTimes, fallTimes.flatMap((_, index) => [0, fallSupport[fallSupport.length - 1 - index], 0])),
    quaternionTrack('Head', [0, .4, 1], [[-.22, .18, 0], [.08, -.08, 0], [0, 0, 0]]),
    quaternionTrack('UpperArm.L', [0, .4, 1], [[.12, 0, -.65], [-.25, 0, -.3], [0, 0, 0]]),
    quaternionTrack('UpperArm.R', [0, .4, 1], [[.1, 0, .55], [-.2, 0, .3], [0, 0, 0]]),
  ]));

  clips.push(makeClip('victory', 2.8, [
    quaternionTrack('Chest', [0, .35, .75, 1.2, 1.7, 2.2, 2.8], [[0, 0, 0], [-.12, 0, 0], [-.16, 0, 0], [-.1, 0, 0], [-.14, 0, 0], [-.06, 0, 0], [0, 0, 0]]),
    quaternionTrack('Head', [0, .35, .75, 1.2, 1.7, 2.2, 2.8], [[0, 0, 0], [-.18, .08, 0], [-.24, -.08, 0], [-.16, .1, 0], [-.22, -.06, 0], [-.08, 0, 0], [0, 0, 0]]),
    quaternionTrack('UpperArm.L', [0, .35, .75, 1.2, 1.7, 2.2, 2.8], [[0, 0, 0], [0, 0, -2.15], [0, 0, -2.3], [0, 0, -2.08], [0, 0, -2.26], [0, 0, -1.1], [0, 0, 0]]),
    quaternionTrack('UpperArm.R', [0, .35, .75, 1.2, 1.7, 2.2, 2.8], [[0, 0, 0], [0, 0, 2.15], [0, 0, 2.3], [0, 0, 2.08], [0, 0, 2.26], [0, 0, 1.1], [0, 0, 0]]),
    quaternionTrack('Forearm.L', [0, .35, .75, 1.2, 1.7, 2.2, 2.8], [[0, 0, 0], [0, 0, -.28], [0, 0, -.42], [0, 0, -.2], [0, 0, -.38], [0, 0, -.12], [0, 0, 0]]),
    quaternionTrack('Forearm.R', [0, .35, .75, 1.2, 1.7, 2.2, 2.8], [[0, 0, 0], [0, 0, .28], [0, 0, .42], [0, 0, .2], [0, 0, .38], [0, 0, .12], [0, 0, 0]]),
    quaternionTrack('Lever', [0, .35, .75, 1.2, 1.7, 2.2, 2.8], [[0, 0, 0], [0, 0, -.12], [0, 0, .08], [0, 0, -.08], [0, 0, .06], [0, 0, -.04], [0, 0, 0]]),
    new THREE.VectorKeyframeTrack('Pelvis.position', [0, .35, .75, 1.2, 1.7, 2.2, 2.8], [0, .82, 0, 0, .86, 0, 0, .9, 0, 0, .87, 0, 0, .9, 0, 0, .85, 0, 0, .82, 0]),
  ]));
  const victoryReelTimes = [0, .35, .8, 1.4, 2.8];
  for (let reel = 0; reel < 3; reel++) {
    clips[clips.length - 1].tracks.push(quaternionTrack(`Reel.${reel + 1}`, victoryReelTimes, [[0, 0, 0], [0, 0, 0], [TAU, 0, 0], [TAU * 2 + reel * Math.PI / 2, 0, 0], [TAU * 2 + reel * Math.PI / 2, 0, 0]]));
  }
  return clips;
}

export function createSlotHero() {
  const materials = createMaterials();
  const root = new THREE.Group();
  root.name = 'SlotHero';
  root.userData = {
    visualId: 'slot-hero-v1',
    suggestedCharId: 'slot-hero',
    upAxis: '+Y',
    forwardAxis: '+Z',
    units: 'meters',
    author: 'HungerG procedural asset pipeline',
    license: 'project-internal procedural source',
    externalCredentialsUsed: false,
  };

  const bones = [];
  const boneIndices = new Map();
  const addBone = (name, parent, position) => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.copy(position);
    parent.add(bone);
    boneIndices.set(name, bones.length);
    bones.push(bone);
    return bone;
  };

  const Root = addBone('Root', root, V(0, 0, 0));
  const Pelvis = addBone('Pelvis', Root, V(0, .82, 0));
  const Spine = addBone('Spine', Pelvis, V(0, .16, 0));
  const Chest = addBone('Chest', Spine, V(0, .18, 0));
  const Neck = addBone('Neck', Chest, V(0, .30, 0));
  const Head = addBone('Head', Neck, V(0, .12, 0));
  const Lever = addBone('Lever', Chest, V(.4, -.12, .02));
  const ThighL = addBone('Thigh.L', Pelvis, V(-.16, -.05, 0));
  const ShinL = addBone('Shin.L', ThighL, V(0, -.34, 0));
  const FootL = addBone('Foot.L', ShinL, V(0, -.34, 0));
  const ThighR = addBone('Thigh.R', Pelvis, V(.16, -.05, 0));
  const ShinR = addBone('Shin.R', ThighR, V(0, -.34, 0));
  const FootR = addBone('Foot.R', ShinR, V(0, -.34, 0));
  const UpperArmL = addBone('UpperArm.L', Chest, V(-.39, .22, 0));
  const ForearmL = addBone('Forearm.L', UpperArmL, V(-.07, -.24, .02));
  const HandL = addBone('Hand.L', ForearmL, V(0, -.03, 0));
  const UpperArmR = addBone('UpperArm.R', Chest, V(.39, .22, 0));
  const ForearmR = addBone('Forearm.R', UpperArmR, V(.18, -.20, .04));
  const HandR = addBone('Hand.R', ForearmR, V(-.01, .18, .04));
  const Reels = [1, 2, 3].map((index) => addBone(`Reel.${index}`, Chest, V((index - 2) * .19, .055, .265)));

  const parts = [];
  const part = (parent, boneName, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${boneName}_${parts.length}`;
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.scale.set(...scale);
    parent.add(mesh);
    parts.push({ mesh, boneName });
    return mesh;
  };
  const rounded = (width, height, depth, radius = .03) => new RoundedBoxGeometry(width, height, depth, 2, radius);
  const segment = (parent, boneName, start, end, radiusStart, radiusEnd, material, sides = 12) => {
    const direction = end.clone().sub(start);
    const geometry = new THREE.CylinderGeometry(radiusEnd, radiusStart, direction.length(), sides, 1, false);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), direction.clone().normalize());
    const mesh = part(parent, boneName, geometry, material, start.clone().add(end).multiplyScalar(.5).toArray());
    mesh.quaternion.copy(quaternion);
    return mesh;
  };
  const bolt = (parent, boneName, position, material = materials.brass, radius = .018) => part(parent, boneName, new THREE.CylinderGeometry(radius, radius, .014, 8), material, position, [Math.PI / 2, 0, 0]);

  part(Pelvis, 'Pelvis', rounded(.48, .22, .31, .055), materials.enamelDark);
  part(Pelvis, 'Pelvis', rounded(.52, .07, .33, .02), materials.brass, [0, .07, 0]);
  part(Pelvis, 'Pelvis', rounded(.13, .12, .035, .018), materials.gold, [0, .065, .177]);
  part(Pelvis, 'Pelvis', rounded(.065, .055, .02, .008), materials.ink, [0, .065, .2]);

  part(Chest, 'Chest', rounded(.70, .66, .43, .085), materials.enamel);
  part(Chest, 'Chest', rounded(.74, .08, .45, .025), materials.brass, [0, .29, 0]);
  part(Chest, 'Chest', rounded(.64, .06, .45, .02), materials.brass, [0, -.29, 0]);
  part(Chest, 'Chest', rounded(.59, .31, .045, .035), materials.ink, [0, .055, .229]);
  part(Chest, 'Chest', rounded(.63, .045, .06, .012), materials.brass, [0, .229, .247]);
  part(Chest, 'Chest', rounded(.63, .045, .06, .012), materials.brass, [0, -.119, .247]);
  for (const x of [-.307, -.095, .095, .307]) part(Chest, 'Chest', rounded(.026, .34, .065, .009), materials.brass, [x, .055, .253]);
  part(Chest, 'Chest', rounded(.56, .008, .008, .002), materials.red, [0, .055, .401]);
  part(Chest, 'Chest', rounded(.58, .285, .008, .02), materials.glass, [0, .055, .407]);
  part(Chest, 'Chest', rounded(.19, .12, .035, .018), materials.brass, [0, -.215, .232]);
  part(Chest, 'Chest', rounded(.13, .022, .018, .005), materials.ink, [0, -.21, .257]);
  part(Chest, 'Chest', rounded(.075, .075, .018, .014), materials.gold, [-.235, -.205, .238], [0, 0, .12]);
  part(Chest, 'Chest', new THREE.TorusGeometry(.025, .006, 6, 16), materials.gold, [-.235, -.205, .252]);
  for (const x of [-.285, .285]) for (const y of [-.245, .245]) bolt(Chest, 'Chest', [x, y, .235]);

  const symbolCard = (parent, boneName, position, rotation) => {
    const group = new THREE.Group();
    group.position.set(...position);
    group.rotation.set(...rotation);
    parent.add(group);
    part(group, boneName, rounded(.155, .17, .014, .012), materials.ceramic);
    return group;
  };
  const addSymbol = (group, boneName, type, accent) => {
    if (type === 0) {
      part(group, boneName, new THREE.CylinderGeometry(.047, .047, .014, 24), materials.gold, [0, .005, .017], [Math.PI / 2, 0, 0]);
      part(group, boneName, new THREE.TorusGeometry(.034, .004, 6, 20), materials.brass, [0, .005, .027]);
      part(group, boneName, rounded(.012, .043, .008, .003), materials.ink, [0, .005, .03]);
      part(group, boneName, rounded(.026, .009, .008, .002), materials.ink, [.007, -.01, .03]);
    } else if (type === 1) {
      part(group, boneName, new THREE.SphereGeometry(.047, 16, 12), materials.ink, [0, -.008, .023]);
      part(group, boneName, new THREE.TorusGeometry(.026, .004, 6, 14, Math.PI * 1.4), accent, [.018, .035, .025], [0, 0, -.6]);
      part(group, boneName, new THREE.SphereGeometry(.009, 8, 6), materials.gold, [.042, .043, .025]);
      part(group, boneName, rounded(.052, .008, .006, .002), materials.red, [-.012, -.004, .063], [0, 0, -.35]);
    } else if (type === 2) {
      const shape = new THREE.Shape();
      shape.moveTo(-.014, -.055); shape.lineTo(.014, -.055); shape.lineTo(.012, .042); shape.lineTo(0, .066); shape.lineTo(-.012, .042); shape.closePath();
      part(group, boneName, new THREE.ExtrudeGeometry(shape, { depth: .008, bevelEnabled: true, bevelSize: .002, bevelThickness: .002, bevelSegments: 1 }), accent, [0, 0, .014]);
      part(group, boneName, rounded(.075, .012, .012, .003), materials.brass, [0, -.045, .024]);
      part(group, boneName, rounded(.018, .037, .012, .004), materials.ink, [0, -.069, .02]);
    } else {
      part(group, boneName, new THREE.TorusGeometry(.025, .007, 8, 18), accent, [0, .038, .024]);
      part(group, boneName, rounded(.014, .072, .012, .004), accent, [0, -.018, .022]);
      part(group, boneName, rounded(.04, .012, .012, .003), accent, [.014, -.049, .022]);
      part(group, boneName, rounded(.026, .011, .012, .003), accent, [.006, -.03, .022]);
    }
  };

  Reels.forEach((reel, reelIndex) => {
    const boneName = reel.name;
    part(reel, boneName, new THREE.CylinderGeometry(.132, .132, .172, 24), materials.ceramic, [0, 0, 0], [0, 0, Math.PI / 2]);
    for (const x of [-.086, .086]) part(reel, boneName, new THREE.TorusGeometry(.132, .009, 6, 24), materials.brass, [x, 0, 0], [0, Math.PI / 2, 0]);
    for (let index = 0; index < 4; index++) {
      const angle = Math.PI / 2 + index * Math.PI / 2;
      const group = symbolCard(reel, boneName, [0, .132 * Math.cos(angle), .132 * Math.sin(angle)], [angle - Math.PI / 2, 0, 0]);
      addSymbol(group, boneName, (index + reelIndex) % 4, (index + reelIndex) % 4 === 1 ? materials.red : materials.gold);
    }
  });

  part(Neck, 'Neck', new THREE.CylinderGeometry(.085, .095, .14, 16), materials.rubber);
  part(Neck, 'Neck', new THREE.TorusGeometry(.092, .014, 8, 20), materials.brass, [0, -.02, 0], [Math.PI / 2, 0, 0]);
  part(Head, 'Head', rounded(.43, .37, .35, .085), materials.ceramic);
  part(Head, 'Head', rounded(.48, .055, .37, .022), materials.brass, [0, .155, 0]);
  part(Head, 'Head', rounded(.50, .12, .38, .04), materials.enamelDark, [0, .225, -.005]);
  part(Head, 'Head', rounded(.44, .082, .025, .015), materials.ink, [0, .225, .193]);
  for (const x of [-.09, .09]) {
    part(Head, 'Head', rounded(.092, .038, .025, .012), materials.cyan, [x, .04, .181]);
    part(Head, 'Head', rounded(.024, .03, .012, .006), materials.ink, [x + .012, .04, .198]);
    part(Head, 'Head', rounded(.105, .014, .018, .005), materials.brass, [x, .079, .18], [0, 0, x < 0 ? -.09 : .09]);
    part(Head, 'Head', new THREE.CylinderGeometry(.048, .048, .035, 16), materials.brass, [x < 0 ? -.235 : .235, .01, 0], [0, 0, Math.PI / 2]);
  }
  part(Head, 'Head', new THREE.SphereGeometry(.028, 12, 8), materials.brass, [0, -.005, .19], [0, 0, 0], [.7, 1, .8]);
  part(Head, 'Head', rounded(.15, .018, .012, .006), materials.ink, [0, -.09, .181]);
  for (let index = 0; index < 5; index++) part(Head, 'Head', rounded(.009, .026, .008, .002), materials.brass, [(index - 2) * .025, -.09, .19]);
  part(Head, 'Head', new THREE.SphereGeometry(.026, 12, 8), materials.red, [0, -.145, .16], [0, 0, 0], [1.4, .7, .7]);

  const seven = (x, y, z, scale, material) => {
    const segments = [[0, .052, .058, .009], [.027, .027, .009, .048], [.027, -.025, .009, .048], [0, -.052, .058, .009], [-.027, -.025, .009, .048], [-.027, .027, .009, .048], [0, 0, .058, .009]];
    [0, 1, 2].forEach((index) => {
      const [sx, sy, width, height] = segments[index];
      part(Head, 'Head', rounded(width * scale, height * scale, .009, .003), material, [x + sx * scale, y + sy * scale, z]);
    });
  };
  seven(-.12, .225, .21, .68, materials.gold);
  seven(0, .225, .21, .68, materials.gold);
  seven(.12, .225, .21, .68, materials.gold);
  for (const x of [-.205, .205]) part(Head, 'Head', new THREE.SphereGeometry(.018, 10, 8), materials.cyan, [x, .225, .19]);

  for (const side of [-1, 1]) {
    const upper = side < 0 ? UpperArmL : UpperArmR;
    const forearm = side < 0 ? ForearmL : ForearmR;
    const hand = side < 0 ? HandL : HandR;
    const upperName = upper.name;
    const forearmName = forearm.name;
    const handName = hand.name;
    part(upper, upperName, new THREE.SphereGeometry(.12, 16, 12), materials.enamelDark, [side * .015, -.015, 0], [0, 0, 0], [1.15, .8, 1]);
    part(upper, upperName, rounded(.21, .13, .25, .045), materials.enamel, [side * .035, .005, 0], [0, 0, side * .16]);
    segment(upper, upperName, V(0, 0, 0), forearm.position, .073, .062, materials.fabric);
    part(upper, upperName, new THREE.SphereGeometry(.073, 12, 10), materials.rubber, forearm.position.toArray());
    part(upper, upperName, new THREE.TorusGeometry(.071, .012, 6, 16), materials.brass, forearm.position.toArray(), [Math.PI / 2, 0, 0]);
    segment(forearm, forearmName, V(0, 0, 0), hand.position.clone().add(V(0, side < 0 ? -.03 : 0, 0)), .061, .047, materials.enamel);
    part(forearm, forearmName, rounded(.11, .13, .085, .025), materials.brass, [0, side < 0 ? -.025 : .005, .005], [0, 0, side * .12]);
    part(hand, handName, new THREE.SphereGeometry(.057, 14, 10), materials.ceramic, [0, 0, .006], [0, 0, 0], [.85, 1, .8]);
    for (let index = 0; index < 3; index++) part(hand, handName, rounded(.017, .052, .022, .007), materials.ceramic, [(index - 1) * .022, side < 0 ? -.035 : .028, .02]);
  }

  segment(Lever, 'Lever', V(0, 0, 0), V(.16, .32, .06), .018, .014, materials.brass, 12);
  part(Lever, 'Lever', new THREE.CylinderGeometry(.047, .047, .07, 16), materials.enamelDark, [0, 0, 0], [0, 0, Math.PI / 2]);
  part(Lever, 'Lever', new THREE.SphereGeometry(.066, 18, 14), materials.red, [.16, .32, .06], [0, 0, 0], [1, .9, 1]);
  part(Lever, 'Lever', new THREE.TorusGeometry(.066, .008, 6, 18), materials.brass, [.16, .32, .06], [Math.PI / 2, 0, 0]);

  for (const side of [-1, 1]) {
    const thigh = side < 0 ? ThighL : ThighR;
    const shin = side < 0 ? ShinL : ShinR;
    const foot = side < 0 ? FootL : FootR;
    segment(thigh, thigh.name, V(0, 0, 0), shin.position, .104, .075, materials.fabric, 14);
    part(thigh, thigh.name, rounded(.16, .20, .12, .035), materials.enamelDark, [0, -.13, .055], [0, 0, side * .035]);
    part(shin, shin.name, new THREE.SphereGeometry(.081, 14, 10), materials.rubber);
    part(shin, shin.name, new THREE.TorusGeometry(.079, .013, 6, 18), materials.brass, [0, 0, 0], [Math.PI / 2, 0, 0]);
    segment(shin, shin.name, V(0, 0, 0), foot.position, .073, .057, materials.enamel, 14);
    part(shin, shin.name, rounded(.13, .22, .08, .025), materials.brass, [0, -.15, .062], [0, 0, side * -.025]);
    part(shin, shin.name, rounded(.075, .15, .02, .015), materials.enamelDark, [0, -.15, .108]);
    part(foot, foot.name, rounded(.23, .11, .36, .045), materials.enamelDark, [0, -.035, .085]);
    part(foot, foot.name, rounded(.24, .035, .37, .015), materials.rubber, [0, -.0725, .085]);
    part(foot, foot.name, rounded(.16, .026, .07, .01), materials.brass, [0, .015, .19]);
  }

  part(Chest, 'Chest', new THREE.CylinderGeometry(.17, .17, .18, 20), materials.enamelDark, [0, .03, -.29], [Math.PI / 2, 0, 0]);
  part(Chest, 'Chest', new THREE.TorusGeometry(.17, .018, 8, 24), materials.brass, [0, .03, -.39]);
  for (const x of [-.09, -.03, .03, .09]) part(Chest, 'Chest', rounded(.025, .19, .018, .006), materials.brass, [x, .03, -.405]);
  part(Chest, 'Chest', new THREE.TorusGeometry(.11, .014, 8, 20, Math.PI * 1.5), materials.brass, [0, -.22, -.29], [Math.PI / 2, 0, .4]);

  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const geometryGroups = new Map();
  for (const { mesh, boneName } of parts) {
    let geometry = mesh.geometry.clone();
    if (geometry.index) geometry = geometry.toNonIndexed();
    for (const attribute of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'uv'].includes(attribute)) geometry.deleteAttribute(attribute);
    }
    if (!geometry.attributes.uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
    geometry.applyMatrix4(mesh.matrixWorld);
    const count = geometry.attributes.position.count;
    const skinIndices = new Uint16Array(count * 4);
    const skinWeights = new Float32Array(count * 4);
    const boneIndex = boneIndices.get(boneName);
    for (let index = 0; index < count; index++) {
      skinIndices[index * 4] = boneIndex;
      skinWeights[index * 4] = 1;
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    if (!geometryGroups.has(mesh.material)) geometryGroups.set(mesh.material, []);
    geometryGroups.get(mesh.material).push(geometry);
    mesh.removeFromParent();
  }

  let triangles = 0;
  let vertices = 0;
  for (const [material, geometries] of geometryGroups) {
    const geometry = mergeGeometries(geometries, false);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = `SlotHero_${material.name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    root.add(mesh);
    mesh.bind(skeleton);
    triangles += geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
    vertices += geometry.attributes.position.count;
    geometries.forEach((item) => item.dispose());
  }

  const bounds = new THREE.Box3().setFromObject(root, true);
  const clips = createClips(bones);
  return {
    root,
    skeleton,
    bones,
    clips,
    materials: Object.values(materials),
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
