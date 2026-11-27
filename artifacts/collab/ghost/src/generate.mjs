import { mkdir, writeFile } from 'node:fs/promises';
import * as T from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// The exporter needs FileReader for its final Blob assembly. No canvas or textures are used.
globalThis.FileReader ??= class {
  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
};

const hidden = 0.001;
const root = new T.Group();
root.name = 'GhostRoot';
const vector = (xyz) => new T.Vector3(...xyz);

function joint(parent, name, xyz = [0, 0, 0]) {
  const object = new T.Group();
  object.name = name;
  object.position.set(...xyz);
  parent.add(object);
  return object;
}

function material(name, color, opacity, glow = 0, doubleSided = false) {
  return new T.MeshStandardMaterial({
    name, color, transparent: true, opacity, roughness: 0.8, metalness: 0,
    emissive: color, emissiveIntensity: glow,
    side: doubleSided ? T.DoubleSide : T.FrontSide,
  });
}

const cloth = material('Abyssal silk', 0x141c2d, 0.94, 0.12, true);
const fold = material('Storm blue silk', 0x283d4e, 0.85, 0.16, true);
const lining = material('Night lining', 0x070e15, 0.98, 0.06, true);
const porcelain = material('Weathered ash mask', 0x7c938e, 0.98, 0.12);
const trim = material('Oxidized silver', 0x48675f, 0.94, 0.16);
const shade = material('Spectral indigo', 0x222c3b, 0.94, 0.12);
const mint = material('Witchlight', 0x6df7ba, 0.98, 1.5);
const trail = material('Mist filaments', 0x4bd9ce, 0.55, 0.7);
const smoke = new T.MeshBasicMaterial({ name: 'Jade smoke', color: 0x31b38b, transparent: true, opacity: 0.67 });
const faintSmoke = new T.MeshBasicMaterial({ name: 'Jade smoke edge', color: 0x39c2a6, transparent: true, opacity: 0.45 });

function mesh(parent, name, geometry, surface, xyz = [0, 0, 0], scale = [1, 1, 1]) {
  const object = new T.Mesh(geometry, surface);
  object.name = name;
  object.position.set(...xyz);
  object.scale.set(...scale);
  parent.add(object);
  return object;
}

function stone(parent, name, surface, xyz, scale, detail = 0) {
  return mesh(parent, name, new T.IcosahedronGeometry(1, detail), surface, xyz, scale);
}

function ribbon(parent, name, surface, points, thickness, tubular = 20, radial = 5) {
  const path = new T.CatmullRomCurve3(points.map(vector));
  const geometry = new T.TubeGeometry(path, tubular, thickness, radial, false);
  const positions = geometry.attributes.position;
  const point = new T.Vector3();
  for (let ring = 0; ring <= tubular; ring++) {
    const t = ring / tubular;
    const center = path.getPointAt(t);
    const taper = 0.045 + 0.955 * Math.sin(Math.PI * t) ** 0.58;
    for (let spoke = 0; spoke <= radial; spoke++) {
      const index = ring * (radial + 1) + spoke;
      point.fromBufferAttribute(positions, index).lerp(center, 1 - taper);
      positions.setXYZ(index, point.x, point.y, point.z);
    }
  }
  geometry.computeVertexNormals();
  return mesh(parent, name, geometry, surface);
}

function rings(parent, name, surface, sections, count, pointAt, reverse = false) {
  const positions = [];
  const indices = [];
  for (let ring = 0; ring < sections.length; ring++) {
    for (let i = 0; i < count; i++) {
      positions.push(...pointAt(sections[ring], 2 * Math.PI * i / count, ring));
      if (ring === sections.length - 1) continue;
      const a = ring * count + i;
      const b = ring * count + (i + 1) % count;
      const c = a + count;
      const d = b + count;
      indices.push(...(reverse ? [a, c, b, b, c, d] : [a, b, c, b, d, c]));
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return mesh(parent, name, geometry, surface);
}

const body = joint(root, 'BodyPivot', [0, 0.93, 0]);
const head = joint(body, 'HeadPivot', [0, 0.43, 0.01]);
head.scale.set(0.84, 0.98, 0.94);
joint(head, 'HeadAnchor', [0, 0.23, 0.06]);
joint(body, 'ChestAnchor', [0, 0.14, 0.2]);
joint(body, 'BackAnchor', [0, 0.17, -0.2]);

const hoodPoint = ([z, rx, ry, cy, peak], t) => [
  Math.cos(t) * rx,
  cy + Math.sin(t) * ry + peak * Math.max(0, Math.sin(t)) ** 8,
  z + 0.052 * Math.abs(Math.cos(t)) - 0.014 * Math.sin(t),
];
const hoodLip = [0.192, 0.155, 0.216, 0.096, 0.114];
rings(head, 'PointedHood', cloth, [
  hoodLip, [0.113, 0.223, 0.249, 0.105, 0.117],
  [0.006, 0.23, 0.257, 0.102, 0.14], [-0.125, 0.186, 0.248, 0.137, 0.105],
  [-0.226, 0.09, 0.172, 0.193, 0.054], [-0.352, 0.003, 0.007, 0.275, 0.003],
], 32, hoodPoint, true);
rings(head, 'HoodInnerRim', lining, [hoodLip, [0.101, 0.15, 0.162, 0.11, 0.043],
  [0.01, 0.035, 0.05, 0.11, 0]], 32, hoodPoint);
ribbon(head, 'HoodSeam', trim,
  Array.from({ length: 19 }, (_, i) => hoodPoint(hoodLip, -0.27 + 3.12 * i / 18)), 0.011, 29);

rings(head, 'PorcelainMask', porcelain, [
  [0.257, 0.031, 0.018, 0.178], [0.221, 0.096, 0.046, 0.168],
  [0.173, 0.121, 0.051, 0.17], [0.119, 0.087, 0.083, 0.164],
  [0.055, 0.08, 0.056, 0.175], [-0.058, 0.032, 0.037, 0.188],
  [-0.106, 0.004, 0.004, 0.208],
], 10, ([y, rx, rz, z], angle) => [rx * Math.cos(angle), y, z + rz * Math.sin(angle)]);

function facet(parent, name, surface, points) {
  const shape = new T.BufferGeometry();
  shape.setAttribute('position', new T.Float32BufferAttribute(points.flat(), 3));
  shape.setIndex([0, 1, 2, 0, 2, 3]);
  shape.computeVertexNormals();
  return mesh(parent, name, shape, surface);
}

for (const side of [-1, 1]) {
  const suffix = side < 0 ? 'L' : 'R';
  const points = [
    [0.016 * side, 0.125, 0.251], [0.108 * side, 0.18, 0.218],
    [0.078 * side, 0.109, 0.234], [0.031 * side, 0.1, 0.249],
  ];
  facet(head, `EyeSocket${suffix}`, lining, side < 0 ? points : points.toReversed());
  ribbon(head, `EyeLight${suffix}`, mint, [
    [0.033 * side, 0.126, 0.257], [0.064 * side, 0.133, 0.247], [0.093 * side, 0.156, 0.229],
  ], side < 0 ? 0.005 : 0.0037, 9);
  ribbon(head, `MaskEtch${suffix}`, lining,
    [[0.075 * side, 0.104, 0.233], [0.057 * side, 0.063, 0.232],
      [0.064 * side, 0.04, 0.224], [0.035 * side, -0.041, 0.224]], 0.0045, 9);
}
ribbon(head, 'BrowFracture', lining, [[0.018, 0.245, 0.203], [0.007, 0.213, 0.221],
  [0.022, 0.186, 0.219], [-0.004, 0.148, 0.239], [0.005, 0.112, 0.25]], 0.0048, 13);

const cloak = joint(body, 'CloakPivot', [0, -0.08, 0]);
const cloakPoint = ([y, rx, rz, z, rag], t) => {
  const pleat = 1 + 0.075 * Math.cos(7 * t) + 0.045 * Math.cos(11 * t + 1);
  return [rx * Math.cos(t) * pleat, y + rag * (0.5 + 0.5 * Math.sin(5 * t)),
    z + rz * Math.sin(t) * pleat];
};
rings(cloak, 'RaggedMantle', cloth, [
  [0.36, 0.112, 0.099, 0, 0], [0.23, 0.307, 0.19, -0.018, 0.029],
  [0.01, 0.234, 0.173, -0.02, 0.026], [-0.21, 0.25, 0.161, -0.07, 0.05],
  [-0.47, 0.32, 0.131, -0.144, 0.11], [-0.733, 0.433, 0.102, -0.31, 0.29],
], 40, cloakPoint);
for (const side of [-1, 1]) {
  const suffix = side < 0 ? 'L' : 'R';
  ribbon(cloak, `MantleBorder${suffix}`, fold, [
    [side * 0.08, 0.339, 0.105], [side * (side < 0 ? 0.192 : 0.251), 0.19, 0.126],
    [side * 0.15, -0.033, 0.158], [side * 0.199, -0.227, 0.056],
    [side * 0.282, -0.47, -0.09], [side * 0.387, -0.67, -0.25],
  ], 0.025, 28);
  ribbon(cloak, `VeilFold${suffix}`, fold, [
    [side * 0.12, 0.256, -0.114], [side * 0.233, 0.082, -0.185],
    [side * 0.25, -0.23, -0.233], [side * 0.353, -0.507, -0.309],
    [side * 0.559, -0.627, -0.51], [side * 0.538, -0.565, -0.666],
  ], 0.049, 38, 7);
  facet(cloak, `TornFrontHem${suffix}`, fold, [
    [side * 0.138, -0.283, 0.109], [side * 0.289, -0.493, -0.075],
    [side * (side < 0 ? 0.424 : 0.341), -0.73, -0.264], [side * 0.194, -0.558, -0.062],
  ]);
}

const tail = joint(cloak, 'TailPivot', [0, -0.36, -0.11]);
for (let i = 0; i < 4; i++) {
  const x = (i - 1.5) * 0.115;
  ribbon(tail, `FogTail${i}`, i === 1 ? fold : trail, [
    [x, 0.0, -0.07], [x * 1.42, -0.19, -0.162], [x * 2.4, -0.365, -0.384],
    [x * 2.51 + 0.035, -0.49, -0.551], [x * 2.03 + 0.11, -0.45 + i * 0.041, -0.725 + i * 0.074],
  ], 0.081 - i * 0.009, 30, 7);
}

ribbon(body, 'MantleClasp', trim, [[0, 0.193, 0.188], [0.059, 0.13, 0.193],
  [0.002, 0.048, 0.2], [-0.055, 0.134, 0.2], [0, 0.193, 0.188]], 0.012, 15);
const core = stone(body, 'MantleLight', mint, [0, 0.125, 0.204], [0.02, 0.047, 0.018]);
ribbon(body, 'ClaspFissure', trim, [[0.002, 0.088, 0.196], [0.018, 0.01, 0.169],
  [-0.02, -0.087, 0.152], [-0.016, -0.165, 0.134]], 0.01, 14);

const arms = [-1, 1].map((side) => {
  const suffix = side < 0 ? 'L' : 'R';
  const shoulder = joint(body, `Shoulder${suffix}`, [side * 0.231, 0.145, -0.013]);
  rings(shoulder, `ArmDrape${suffix}`, cloth, [[0.084, 0.018, 0.032], [0.0, 0.102, 0.081],
    [-0.117, 0.067, 0.063], [-0.27, 0.046, 0.042], [-0.379, 0.032, 0.04]], 9,
  ([y, x, z], angle, ring) => [x * Math.cos(angle), y + (ring === 4 ? 0.06 * Math.sin(3 * angle) : 0), z * Math.sin(angle)]);
  const forearm = joint(shoulder, `Forearm${suffix}`, [0, -0.31, 0]);
  stone(forearm, `WraithForearm${suffix}`, shade, [0, -0.115, 0], [0.047, 0.182, 0.061], 1);
  ribbon(forearm, `FrayedThread${suffix}`, fold,
    [[0.037 * side, 0.025, 0.011], [0.045 * side, -0.117, 0.07],
      [0.061 * side, -0.238, 0.037], [0.041 * side, -0.334, 0.023]], 0.019, 15);
  mesh(forearm, `SilverCuff${suffix}`, new T.CylinderGeometry(0.058, 0.041, 0.067, 6), trim, [0, -0.221, 0]);
  const hand = joint(forearm, `Hand${suffix}`, [0, -0.257, 0]);
  stone(hand, `Palm${suffix}`, porcelain, [0, -0.04, 0.006], [0.047, 0.075, 0.025], 1);
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.026;
    const length = [0.11, 0.153, 0.133, 0.097][i];
    ribbon(hand, `Finger${suffix}${i}`, porcelain, [[x, -0.072, 0.005],
      [x * 1.56, -0.104 - length / 3, 0.017], [x * 1.47, -0.084 - length, 0.06]], 0.009, 9);
  }
  ribbon(hand, `Thumb${suffix}`, porcelain, [[0.038 * side, -0.013, 0],
    [0.067 * side, -0.055, 0.023], [0.064 * side, -0.099, 0.036]], 0.016, 7);
  joint(hand, `HandAnchor${suffix}`, [0, -0.08, 0.04]);
  return { side, shoulder, forearm, hand };
});

const drain = joint(root, 'DrainFX', [0, 1.15, 0.55]);
drain.scale.setScalar(hidden);
const wisps = Array.from({ length: 4 }, (_, i) => {
  const object = joint(drain, `DrainWisp${i}`);
  const phase = i * Math.PI / 2;
  const points = Array.from({ length: 10 }, (_, j) => {
    const t = j / 9;
    return [0.145 * Math.cos(phase + 4.2 * t), 0.1 * Math.sin(phase + 4.2 * t), 0.48 * (1 - t)];
  });
  ribbon(object, `EnergyRibbon${i}`, i % 2 === 0 ? mint : trail, points, 0.018, 21);
  stone(object, `EnergySpark${i}`, mint, points[6], [0.016, 0.017, 0.024]);
  return object;
});

const death = joint(root, 'SmokeFX', [0, 0.75, 0]);
death.scale.setScalar(hidden);
const plumes = Array.from({ length: 6 }, (_, i) => {
  const sway = i % 2 ? 1 : -1;
  const length = [1, 0.7, 0.91, 0.65, 0.84, 0.76][i];
  const object = joint(death, `SmokePlume${i}`);
  ribbon(object, `SmokeCurl${i}`, i % 3 ? smoke : faintSmoke, [
    [0, -0.29, 0], [0.019 * sway, -0.095, 0], [0.092 * sway, 0.12, 0.027],
    [0.078 * sway, 0.29, -0.026], [-0.048 * sway, 0.45, -0.047],
    [-0.084 * sway, 0.64, 0.015], [-0.021 * sway, 0.86, 0.067],
  ].map(([x, y, z]) => [x, y * length, z]), 0.022 + i % 3 * 0.004, 33, 7);
  return object;
});

function pose(p = {}) {
  return {
    sway: 0, hover: 0, yaw: 0, lean: 0, look: 0, cloak: 0, tail: 0,
    reach: 0, spread: 0, elbow: 0, pulse: 1, size: 1, drain: hidden,
    smoke: hidden, smokeRise: 0, drift: 0, ...p,
  };
}

const quaternion = (x, y, z) => new T.Quaternion().setFromEuler(new T.Euler(x, y, z)).toArray();
const state = (t, p) => [
  [body, 'position', [p.sway, 0.93 + p.hover, 0]],
  [body, 'quaternion', quaternion(p.lean, p.yaw, -p.sway)],
  [body, 'scale', [p.size, p.size, p.size]],
  [head, 'quaternion', quaternion(p.look, -0.35 * p.yaw, p.sway * 0.55)],
  [cloak, 'quaternion', quaternion(-p.cloak, 0, -0.9 * p.sway)],
  [tail, 'quaternion', quaternion(p.cloak * 0.45, p.tail, p.tail * 0.18)],
  [core, 'scale', [0.02 * p.pulse, 0.047 * p.pulse, 0.018 * p.pulse]],
  ...arms.flatMap(({ side, shoulder, forearm, hand }) => [
    [shoulder, 'quaternion', quaternion(-0.11 - p.reach + side * p.sway, 0.13 * side, side * (0.24 + p.spread))],
    [forearm, 'quaternion', quaternion(-0.26 - p.elbow, 0.18 * side, -0.13 * side)],
    [hand, 'quaternion', quaternion(0.11 + p.elbow * 0.45, -0.31 * side, 0)],
  ]),
  [drain, 'scale', [p.drain, p.drain, p.drain]],
  [drain, 'quaternion', quaternion(0, 0, t * 1.6)],
  ...wisps.map((object, i) => [object, 'position', [0, 0, p.drift * (1 - i * 0.12)]]),
  [death, 'position', [0, 0.75 + p.smokeRise, 0]],
  [death, 'scale', [p.smoke, p.smoke, p.smoke]],
  ...plumes.flatMap((object, i) => {
    const angle = i * 2.399963 + t * 0.7;
    return [
      [object, 'position', [Math.cos(angle) * (0.09 + 0.23 * t), 0.1 * t + 0.047 * (i % 3), Math.sin(angle) * (0.09 + 0.19 * t)]],
      [object, 'quaternion', quaternion(0.17 * Math.sin(angle), angle, 0.21 * Math.cos(angle))],
    ];
  }),
];

function clip(name, frames) {
  const times = frames.map(([time]) => time);
  const states = frames.map(([time, p]) => state(time, pose(p)));
  const tracks = states[0].map(([object, property], i) => {
    const Track = property === 'quaternion' ? T.QuaternionKeyframeTrack : T.VectorKeyframeTrack;
    return new Track(`${object.name}.${property}`, times, states.flatMap((frame) => frame[i][2]));
  });
  return new T.AnimationClip(name, -1, tracks).optimize();
}

const perched = { hover: 0.085, lean: 0.16, look: -0.085, reach: 0.25, elbow: 0.12, cloak: 0.13 };
const clips = [
  clip('idle', [[0, {}], [0.65, { sway: 0.024, hover: 0.032, yaw: 0.056, cloak: 0.05, tail: 0.126, pulse: 1.1 }],
    [1.33, { sway: -0.015, hover: 0.071, yaw: -0.036, cloak: 0.12, tail: -0.11, pulse: 1.18 }],
    [1.98, { sway: -0.029, hover: 0.03, yaw: -0.06, tail: -0.136 }], [2.64, {}]]),
  clip('attach', [[0, {}], [0.16, { hover: 0.11, lean: 0.26, look: -0.24, reach: 0.27, cloak: 0.37 }],
    [0.43, { hover: 0.19, lean: 0.37, look: -0.29, reach: 0.42, cloak: 0.32, tail: 0.26, spread: -0.12 }],
    [0.72, perched]]),
  clip('attached_idle', [[0, perched], [0.64, { ...perched, hover: 0.111, tail: 0.17, sway: 0.018 }],
    [1.22, { ...perched, hover: 0.124, tail: 0.02, look: -0.13, pulse: 1.12 }],
    [1.89, { ...perched, hover: 0.099, tail: -0.15, sway: -0.02 }], [2.5, perched]]),
  clip('drain', [[0, perched], [0.22, { ...perched, lean: -0.12, hover: 0.14, elbow: 0.48, spread: 0.38 }],
    [0.46, { ...perched, lean: 0.32, reach: 1.18, elbow: 0.35, look: -0.23, spread: -0.05, pulse: 1.3, drain: 0.78, drift: 0.22 }],
    [0.78, { ...perched, lean: 0.41, reach: 0.99, elbow: 0.54, look: -0.18, pulse: 1.72, drain: 1, drift: -0.13 }],
    [1.04, { ...perched, lean: 0.23, reach: 0.77, elbow: 0.67, pulse: 1.49, drain: 0.64, drift: -0.57 }],
    [1.34, { ...perched, reach: 0.36, elbow: 0.35, pulse: 1.09 }], [1.5, perched]]),
  clip('flinch', [[0, {}], [0.10, { sway: -0.095, lean: -0.39, yaw: 0.37, look: 0.34, hover: 0.065, spread: 0.37, reach: -0.27, tail: -0.52 }],
    [0.25, { sway: -0.054, lean: -0.22, yaw: 0.25, look: 0.17, hover: 0.11, spread: 0.28, cloak: -0.17, tail: -0.26 }],
    [0.47, { sway: 0.02, lean: 0.085, yaw: -0.093, reach: 0.05, tail: 0.18 }], [0.64, {}]]),
  clip('dead', [[0, {}], [0.18, { hover: 0.045, lean: -0.12, look: 0.08, spread: 0.35, tail: 0.26, pulse: 1.48, smoke: 0.34 }],
    [0.43, { hover: 0.18, lean: -0.22, spread: 0.45, tail: -0.33, size: 0.78, smoke: 0.86, smokeRise: 0.07 }],
    [0.72, { hover: 0.36, size: 0.23, smoke: 1.06, smokeRise: 0.19 }],
    [1.04, { hover: 0.46, size: hidden, smoke: 0.89, smokeRise: 0.38 }],
    [1.4, { hover: 0.53, size: hidden, smoke: hidden, smokeRise: 0.56 }]]),
];

// Keep the static GLB in precisely the same presentation pose as idle at t=0.
for (const [object, property, value] of state(0, pose())) object[property].fromArray(value);
const bounds = new T.Box3().setFromObject(body, true);
const ground = -bounds.min.y;
body.position.y += ground;
for (const animation of clips) {
  const track = animation.tracks.find(({ name }) => name === 'BodyPivot.position');
  for (let i = 1; i < track.values.length; i += 3) track.values[i] += ground;
}

root.userData = { visualId: 'ghost-v1', up: '+Y', forward: '+Z', units: 'meters', rootMotion: false };
const data = await new GLTFExporter().parseAsync(root, { binary: true, animations: clips, trs: true });
const directory = new URL('../model/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('ghost.glb', directory), Buffer.from(data));
console.log(`ghost.glb · ${data.byteLength} bytes · ${clips.length} animation clips`);
