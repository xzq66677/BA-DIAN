import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import * as T from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

globalThis.FileReader ??= class {
  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
};

const tau = 2 * Math.PI;
const vector = (point) => new T.Vector3(...point);
const orbGeometry = new T.SphereGeometry(1, 20, 12);
const crystalGeometry = new T.IcosahedronGeometry(1);
const { lerp, smoothstep } = T.MathUtils;

function group(parent, name, point = [0, 0, 0]) {
  const node = new T.Group();
  node.name = name;
  node.position.set(...point);
  parent?.add(node);
  return node;
}

function surface(name, color, options = {}) {
  return new T.MeshStandardMaterial({ name, color, roughness: 0.66, ...options });
}

function glow(name, color, opacity = 1) {
  return new T.MeshBasicMaterial({ name, color, opacity, transparent: opacity < 1,
    depthWrite: opacity === 1, side: T.DoubleSide });
}

function mesh(parent, name, geometry, material, point = [0, 0, 0], scale = [1, 1, 1]) {
  const node = new T.Mesh(geometry, material);
  node.name = name;
  node.position.set(...point);
  node.scale.set(...scale);
  parent.add(node);
  return node;
}

function orb(parent, name, material, point, scale) {
  return mesh(parent, name, orbGeometry, material, point, scale);
}

function filament(parent, name, points, material, radius, detail = 18) {
  const path = new T.CatmullRomCurve3(points.map(vector));
  const geometry = new T.TubeGeometry(path, detail, radius, 5, false);
  return mesh(parent, name, geometry, material);
}

function track(node, property, times, values) {
  if (property === 'rotation') {
    const rotations = values.map((xyz) => new T.Quaternion().setFromEuler(new T.Euler(...xyz)).toArray());
    return new T.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, rotations.flat());
  }
  return new T.VectorKeyframeTrack(`${node.name}.${property}`, times, values.flat());
}

function mothFin(parent, name, sign, length, breadth, materials) {
  const [membrane, rim, vein] = materials;
  function point(u, v) {
    const edge = Math.sin(Math.PI * u) ** 0.52;
    return [sign * length * (u + 0.045 * edge * (1 - v * v)), 0.28 * u + 0.22 * edge * (1 - v * v),
      -0.43 * length * u + breadth * edge * v];
  }
  const positions = [];
  const colors = [];
  const indices = [];
  const dark = new T.Color(0x757bd9);
  const outer = new T.Color(0xe0bafa);
  const rows = 18;
  const cols = 8;
  for (let i = 0; i <= rows; i++) {
    const u = lerp(0.002, 0.998, i / rows);
    for (let j = 0; j <= cols; j++) {
      const v = 2 * j / cols - 1;
      positions.push(...point(u, v));
      colors.push(...dark.clone().lerp(outer, 0.42 * u + 0.37 * v ** 4 + 0.16 * Math.abs(Math.sin(10 * u))).toArray());
      const a = i * (cols + 1) + j;
      const b = a + cols + 1;
      if (i < rows && j < cols) indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  mesh(parent, name, geometry, membrane);
  for (const v of [-1, -0.42, 0.32, 1]) {
    const points = Array.from({ length: 13 }, (_, i) => {
      const xyz = point(i / 12, v);
      xyz[1] += 0.009;
      return xyz;
    });
    const isRim = Math.abs(v) === 1;
    filament(parent, `${name}_ray_${v}`, points, isRim ? rim : vein, isRim ? 0.012 : 0.008, 18);
  }
}

function chibiHeadGeometry() {
  const geometry = new T.SphereGeometry(1, 40, 26);
  const position = geometry.attributes.position;
  const colors = [];
  const base = new T.Color(0x62b6cc);
  const crown = new T.Color(0x89abe2);
  const chin = new T.Color(0xc7efdf);
  const blush = new T.Color(0xf1a5b6);
  for (let i = 0; i < position.count; i++) {
    const x = Math.abs(position.getX(i));
    const y = position.getY(i);
    const z = position.getZ(i);
    const muzzle = smoothstep(z, 0.19, 0.96) * (1 - smoothstep(y, -0.56, 0.25));
    const cheekRadius = ((x - 0.57) / 0.20) ** 2 + ((y + 0.33) / 0.18) ** 2 + ((z - 0.75) / 0.25) ** 2;
    colors.push(...base.clone().lerp(crown, 0.61 * smoothstep(y, -0.09, 0.98))
      .lerp(chin, muzzle).lerp(blush, 0.97 * Math.exp(-cheekRadius)).toArray());
  }
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  return geometry;
}

function makeLeech() {
  const root = group(null, 'FlyingLeechRoot');
  const body = group(root, 'HoverPivot', [0, 1.08, 0]);
  const head = group(body, 'HeadPivot', [0, 0.235, 0.423]);
  const shell = surface('Lagoon blue body', 0x60a5c8, { roughness: 0.72 });
  const jade = surface('Mint body scallops', 0x95d9d5, { roughness: 0.58 });
  const mantle = surface('Pale mint tail pad', 0xc2eee1);
  const ice = surface('Milk-cream sclera', 0xfff4e7, { roughness: 0.49, emissive: 0x8a8479, emissiveIntensity: 0.12 });
  const iris = surface('Blueberry iris', 0x6487cd, { roughness: 0.41, emissive: 0x394c8b, emissiveIntensity: 0.14 });
  const pupil = surface('Round navy pupil', 0x263856, { roughness: 0.48 });
  const smile = surface('Soft mauve smile', 0x775572, { roughness: 0.81 });
  const opal = glow('Soft mint glow', 0xc6fff1);
  const gleam = glow('Creamy eye catchlight', 0xfff9ed);
  const peach = surface('Peach nacre antenna tips', 0xf5bfaa, { roughness: 0.59 });
  const veil = surface('Iridescent wing membranes', 0xffffff,
    { vertexColors: true, side: T.DoubleSide, roughness: 0.62, emissive: 0x34295c, emissiveIntensity: 0.23 });
  const wingEdge = surface('Periwinkle wing rims', 0xc6b9f0, { emissive: 0x7563ad, emissiveIntensity: 0.23 });
  const wingRay = surface('Soft lilac wing veins', 0x9b8ed0);
  const headSize = [0.54, 0.463, 0.49];
  const face = surface('Painted pastel cheeks', 0xffffff, { vertexColors: true, roughness: 0.74 });
  mesh(head, 'RoundedHead', chibiHeadGeometry(), face, [0, 0, 0], headSize);
  const smilePath = [[-0.102, -0.154], [-0.064, -0.192], [0, -0.206], [0.064, -0.192], [0.102, -0.154]]
    .map(([x, y]) => [x, y, headSize[2] * Math.sqrt(1 - (x / headSize[0]) ** 2 - (y / headSize[1]) ** 2) + 0.008]);
  filament(head, 'LittleSmile', smilePath, smile, 0.014);
  for (const [i, point] of [smilePath[0], smilePath.at(-1)].entries()) {
    orb(head, `SmileCorner${i}`, smile, point, [0.014, 0.014, 0.014]);
  }
  group(head, 'HeadAnchor', [0, 0.33, 0.04]);
  group(head, 'WindOrigin', [0, -0.18, 0.515]);
  group(body, 'ChestAnchor', [0, 0.12, 0.34]);
  group(body, 'BackAnchor', [0, 0.15, -0.54]);
  group(root, 'GroundAnchor');

  const wings = [];
  for (const [sign, side] of [[-1, 'L'], [1, 'R']]) {
    const socket = group(head, `Eye${side}`, [sign * 0.213, 0.032, 0.449]);
    socket.rotation.set(-0.052, sign * 0.265, -sign * 0.025);
    orb(socket, `Sclera${side}`, ice, [0, 0, 0.014], [0.146, 0.155, 0.041]);
    orb(socket, `Iris${side}`, iris, [-sign * 0.012, 0.009, 0.045], [0.104, 0.113, 0.028]);
    orb(socket, `Pupil${side}`, pupil, [-sign * 0.017, 0.014, 0.069], [0.060, 0.063, 0.012]);
    orb(socket, `EyeGlint${side}`, gleam, [-0.042 - sign * 0.012, 0.049, 0.075], [0.026, 0.027, 0.008]);
    orb(socket, `EyeSpark${side}`, gleam, [0.028 - sign * 0.012, -0.034, 0.073], [0.011, 0.011, 0.005]);

    filament(head, `LureStem${side}`, [
      [sign * 0.244, 0.348, 0.058], [sign * 0.299, 0.494, 0.065],
      [sign * 0.384, 0.576, 0.112], [sign * 0.452, 0.561, 0.158],
    ], jade, 0.031);
    orb(head, `LureCup${side}`, peach, [sign * 0.451, 0.559, 0.154], [0.081, 0.078, 0.073]);
    orb(head, `LureOpal${side}`, opal, [sign * 0.448, 0.58, 0.209], [0.040, 0.046, 0.026]);

    for (const [suffix, z, length, width] of [['Main', -0.13, 0.965, 0.45], ['Rear', -0.48, 0.65, 0.29]]) {
      const hinge = group(body, `Wing${suffix}${side}`, [sign * 0.31, 0.057, z]);
      mothFin(hinge, `Fin${suffix}${side}`, sign, length, width, [veil, wingEdge, wingRay]);
      wings.push({ hinge, sign, lag: suffix === 'Rear' ? 0.55 : 0 });
    }
  }

  const spine = group(body, 'TailPivot', [0, -0.045, 0.06]);
  const tailSections = [
    [0, 0.075, 0.373, 0.335, 0.35], [0, -0.15, 0.396, 0.356, 0.31],
    [-0.047, -0.38, 0.35, 0.309, 0.255], [-0.12, -0.57, 0.3, 0.25, 0.215],
    [-0.175, -0.73, 0.25, 0.21, 0.173], [-0.19, -0.86, 0.18, 0.151, 0.129],
    [-0.17, -0.966, 0.131, 0.123, 0.095],
  ];
  for (const [i, [x, z, rx, ry, rz]] of tailSections.entries()) {
    const y = -0.18 * Math.sin(i * Math.PI / 12) + i * i * 0.012;
    const segment = group(spine, `Segment${i + 1}`, [x, y, z]);
    segment.rotation.y = 0.24 * Math.sin(i * 0.7);
    orb(segment, `Body${i + 1}`, shell, [0, 0, 0], [rx, ry, rz]);
    orb(segment, `BackPlate${i + 1}`, jade, [0, ry * 0.45, -rz * 0.12], [rx * 0.93, ry * 0.63, rz * 0.83]);
    for (const sign of [-1, 1]) {
      orb(segment, `SideLight${i + 1}_${sign}`, i % 3 === 1 ? opal : mantle,
        [sign * rx * 0.92, ry * 0.44, -rz * 0.02], [rx * 0.13, ry * 0.13, rz * 0.24]);
    }
  }
  const tailCup = group(spine, 'TailSucker', [-0.146, 0.269, -1.026]);
  tailCup.rotation.set(0.47, -0.42, 0);
  orb(tailCup, 'TailSuckerRim', jade, [0, 0, 0], [0.12, 0.099, 0.056]);
  orb(tailCup, 'TailSuckerCap', mantle, [0, 0, -0.039], [0.079, 0.069, 0.026]);

  const zero = [0, 0, 0];
  function action(name, duration, heights, tilts, finMotion, wingSweep = 0.14) {
    const times = heights.map((_, i) => duration * i / (heights.length - 1));
    return new T.AnimationClip(name, duration, [
      track(body, 'position', times, heights.map((height) => [0, height, 0])),
      track(body, 'rotation', times, tilts),
      track(head, 'rotation', times, heights.map((_, i) => [-0.43 * tilts[i][0], 0, 0])),
      track(spine, 'rotation', times, heights.map((_, i) => [tilts[i][0] * 0.4, Math.sin(i * Math.PI / 2) * -0.09, 0])),
      ...wings.map(({ hinge, sign, lag }) => track(hinge, 'rotation', times,
        finMotion.map((flap) => [0, sign * (wingSweep - flap * 0.12), sign * (flap * (1 - lag * 0.3) - lag * 0.11)]))),
    ]);
  }

  const idle = (name, base, time) => action(name, time, [base, base + 0.066, base, base - 0.05, base],
    [zero, [0.06, 0, -0.025], zero, [-0.048, 0, 0.03], zero], [0.12, 0.49, -0.15, -0.44, 0.12]);
  const clips = [
    idle('idle', 1.08, 2.3),
    action('walk', 0.82, [1.13, 1.19, 1.13, 1.19, 1.13],
      [[-0.16, 0, 0], [-0.17, 0, 0.04], [-0.16, 0, 0], [-0.17, 0, -0.04], [-0.16, 0, 0]],
      [0.16, 0.78, 0.16, -0.58, 0.16]),
    action('cast', 1.45, [1.08, 1.16, 1.42, 1.27, 1.08],
      [zero, [-0.16, 0, 0], [-0.38, 0, 0], [-0.2, 0, 0], zero], [0.12, -0.46, 0.64, 0.33, 0.12]),
    action('attack', 1.15, [1.08, 1.35, 1.15, 0.95, 1.08],
      [zero, [-0.31, 0, 0], [0.5, 0, 0], [0.36, 0, 0], zero], [0.12, 0.68, -0.61, -0.32, 0.12]),
    action('inhale', 1.7, [1.08, 1.11, 1.22, 1.21, 1.08],
      [zero, [0.18, 0, 0], [-0.23, 0, 0], [-0.18, 0, 0], zero], [0.12, 0.45, 0.69, 0.33, 0.12]),
    action('exhale', 1.5, [1.08, 1.26, 1.13, 1.09, 1.08],
      [zero, [-0.29, 0, 0], [0.27, 0, 0], [0.17, 0, 0], zero], [0.12, 0.78, -0.49, -0.1, 0.12]),
    action('flinch', 0.6, [1.08, 1.19, 0.99, 1.08],
      [zero, [-0.3, 0.2, 0.24], [-0.08, 0, 0.13], zero], [0.12, -0.53, 0.32, 0.12]),
    action('crouch', 1.7, [0.92, 0.97, 0.92], [zero, [0.02, 0, 0], zero], [0.2, 0.34, 0.2], 0.88),
    action('cheer', 1.4, [1.08, 1.44, 1.15, 1.48, 1.08],
      [zero, [-0.25, 0.31, -0.1], zero, [-0.22, -0.31, 0.1], zero], [0.12, 0.68, -0.41, 0.73, 0.12]),
    action('dead', 1.45, [1.08, 1.0, 0.8, 0.95, 1.16],
      [zero, [0.14, 0, 0.24], [0.2, 0, 0.31], [0.1, 0, 0.15], zero], [0.12, -0.32, -0.69, -0.28, 0.12]),
    idle('dead_idle', 1.16, 3.8),
    action('revive', 0.9, [1.16, 1.37, 1.08], [zero, [-0.2, 0, 0], zero], [0.12, 0.7, 0.12]),
  ];
  return { root, clips };
}

function makeSpecter({ root, clips }) {
  const spectral = root.clone(true);
  const materials = new Map();
  const aquamarine = new T.Color(0x62e7dc);
  spectral.traverse((node) => {
    if (!node.isMesh) return;
    if (!materials.has(node.material)) {
      const ghost = node.material.clone();
      ghost.name += ' • Astral';
      ghost.color.lerp(aquamarine, 0.39);
      ghost.opacity = 0.4;
      ghost.transparent = true;
      ghost.depthWrite = false;
      materials.set(node.material, ghost);
    }
    node.material = materials.get(node.material);
  });
  return { root: spectral, clips: clips.filter(({ name }) => ['dead', 'dead_idle', 'revive'].includes(name)) };
}

function mergeTierMeshes(tier) {
  const groups = new Map();
  tier.updateWorldMatrix(true, true);
  const inverse = tier.matrixWorld.clone().invert();
  tier.traverse((node) => {
    if (!node.isMesh) return;
    const parts = groups.get(node.material) ?? [];
    const geometry = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
    geometry.deleteAttribute('uv');
    geometry.applyMatrix4(new T.Matrix4().multiplyMatrices(inverse, node.matrixWorld));
    parts.push(geometry);
    groups.set(node.material, parts);
  });
  tier.clear();
  for (const [material, parts] of groups) {
    const merged = mergeGeometries(parts);
    mesh(tier, `${tier.name}Surface${tier.children.length + 1}`, mergeVertices(merged), material);
    merged.dispose();
    for (const part of parts) part.dispose();
  }
}

const octant = tau / 8;

function octagonalBand(parent, name, material, y, height, top, bottom = top) {
  return mesh(parent, name, new T.CylinderGeometry(top, bottom, height, 8, 1, false, -octant / 2),
    material, [0, y + height / 2, 0]);
}

function addPagodaRoof(tier, radius, wallHeight, crown, palette) {
  const [tiles, seams, bronze, shadow] = palette;
  const roof = group(tier, 'UpturnedEaves', [0, wallHeight, 0]);
  // The lower courses tuck under the tiles. Their overlapping ledges read from below as well.
  octagonalBand(roof, 'RafterBed', shadow, -0.015, 0.085, radius * 0.89, radius * 0.68);
  octagonalBand(roof, 'StoneRafters', bronze, 0.045, 0.061, radius * 0.94, radius * 0.83);
  octagonalBand(roof, 'EaveFascia', shadow, 0.091, 0.057, radius * 0.965, radius * 0.91);

  const profile = [
    [crown ? 0.14 : 0.61, crown ? 0.53 : 0.34, 0.012],
    [crown ? 0.39 : 0.73, crown ? 0.36 : 0.25, 0.022],
    [crown ? 0.63 : 0.84, crown ? 0.22 : 0.18, 0.042],
    [0.9, 0.142, 0.091],
    [1, 0.156, crown ? 0.215 : 0.181],
  ];
  const divisions = 8;
  const positions = [];
  const indices = [];
  const colors = [];
  const pale = new T.Color(0xc3b7a3);
  const cool = new T.Color(0x9bafbb);
  function position(side, row, along) {
    const [reach, y, curl] = profile[row];
    const left = (side - 0.5) * octant;
    const right = (side + 0.5) * octant;
    return [
      radius * reach * lerp(Math.sin(left), Math.sin(right), along),
      y + curl * Math.abs(2 * along - 1) ** 2.8,
      radius * reach * lerp(Math.cos(left), Math.cos(right), along),
    ];
  }

  for (let side = 0; side < 8; side++) {
    const roofStart = positions.length / 3;
    for (let row = 0; row < profile.length; row++) {
      for (let j = 0; j <= divisions; j++) {
        positions.push(...position(side, row, j / divisions));
        const weather = 0.56 + 0.3 * Math.sin(row * 1.69 + j * Math.PI / divisions) ** 2;
        colors.push(...cool.clone().lerp(pale, weather).toArray());
        if (row === profile.length - 1 || j === divisions) continue;
        const a = roofStart + row * (divisions + 1) + j;
        const b = a + divisions + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    for (let j = 1; j < divisions; j++) {
      const path = profile.map((_, row) => {
        const point = position(side, row, j / divisions);
        point[1] += 0.011;
        return point;
      });
      filament(roof, 'TileRoll', path, seams, radius * 0.0072, 6);
    }
    const ridge = profile.map((_, row) => {
      const point = position(side, row, 0);
      point[1] += 0.018;
      return point;
    });
    filament(roof, 'HipRidge', ridge, bronze, radius * 0.017, 9);
    const rim = Array.from({ length: 9 }, (_, j) => position(side, profile.length - 1, j / 8));
    filament(roof, 'RaisedEaveLip', rim, bronze, radius * 0.016, 10);
    const [x, y, z] = ridge.at(-1);
    mesh(roof, 'RidgeCharm', crystalGeometry, bronze, [x * 0.978, y + 0.043, z * 0.978],
      [radius * 0.024, radius * 0.051, radius * 0.024]);
  }

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  mesh(roof, 'SweptSlate', geometry, tiles);
  return roof;
}

function addPagodaGallery(tier, radius, height, palette, level) {
  const [stone, warmStone, beam, recess] = palette;
  const bodyRadius = radius * 0.685;
  const wallDepth = bodyRadius * Math.cos(octant / 2);
  const width = 2 * bodyRadius * Math.sin(octant / 2);
  octagonalBand(tier, 'RecessShadow', recess, 0.014, height - 0.035, bodyRadius * 0.913);
  octagonalBand(tier, 'BalconySill', beam, 0, 0.072, bodyRadius * 1.15, bodyRadius * 1.2);
  octagonalBand(tier, 'GalleryPlinth', stone, 0.072, height * 0.24, bodyRadius * 1.065, bodyRadius * 1.12);
  octagonalBand(tier, 'LintelCourse', warmStone, height - 0.091, 0.083, bodyRadius * 1.045, bodyRadius * 1.055);
  for (let side = 0; side < 8; side++) {
    const angle = side * octant;
    const panel = group(tier, 'GalleryBay', [wallDepth * Math.sin(angle), 0, wallDepth * Math.cos(angle)]);
    panel.rotation.y = angle;
    for (const sign of [-1, 1]) {
      const blockedCorner = width * 0.36 * sign;
      for (let row = 0; row < 3; row++) {
        const offset = (row % 2 === 0 ? 0.011 : -0.009) * sign;
        const y = height * (0.39 + row * 0.14);
        mesh(panel, 'DressedBlock', new T.BoxGeometry(width * 0.255, height * 0.128, 0.069),
          (side + row + level + (sign === -1 ? 1 : 0)) % 3 === 0 ? warmStone : stone,
          [blockedCorner + offset, y, -0.026]);
      }
      mesh(panel, 'WindowJamb', new T.BoxGeometry(width * 0.066, height * 0.46, 0.07), beam,
        [sign * width * 0.185, height * 0.552, -0.018]);
    }
    mesh(panel, 'WindowLedge', new T.BoxGeometry(width * 0.42, 0.035, 0.099), warmStone, [0, height * 0.315, -0.002]);
    mesh(panel, 'Bracket', new T.BoxGeometry(width * 0.22, 0.044, 0.13), beam, [0, height - 0.026, 0.025]);
  }
}

function makeTower() {
  const root = group(null, 'BasaltTowerRoot');
  const body = group(root, 'TowerFlight');
  const floor = group(body, 'TowerFloor');
  const stone = surface('Weathered ochre basalt', 0x82664b, { roughness: 0.88 });
  const paleStone = surface('Worn basalt edges', 0xb19368, { roughness: 0.85 });
  const beam = surface('Dark brown eave beams', 0x5a4738, { roughness: 0.87 });
  const recess = surface('Deep window recess', 0x201b19, { roughness: 0.94 });
  const tiles = surface('Blue-grey roof tiles', 0x59606a, { roughness: 0.82, vertexColors: true, side: T.DoubleSide });
  const seam = surface('Slate tile ridges', 0x474449, { roughness: 0.73 });
  const bronze = surface('Weathered antique bronze', 0xa28255, { roughness: 0.58, metalness: 0.42 });
  const glyph = glow('Aqua rune inlay', 0x63e4cf);
  octagonalBand(floor, 'Foundation', beam, 0, 0.102, 1.58, 1.67);
  octagonalBand(floor, 'FirstStep', stone, 0.101, 0.094, 1.51, 1.56);
  octagonalBand(floor, 'UpperStep', paleStone, 0.194, 0.067, 1.42, 1.49);
  for (let i = 0; i < 8; i++) {
    const a = i * octant;
    const rune = group(floor, `FoundationSeal${i}`, [Math.sin(a) * 1.425, 0.152, Math.cos(a) * 1.425]);
    rune.rotation.y = a;
    mesh(rune, `SealFrame${i}`, crystalGeometry, bronze, [0, 0, 0], [0.071, 0.041, 0.022]);
    mesh(rune, `SealCore${i}`, crystalGeometry, glyph, [0, 0, 0.018], [0.034, 0.019, 0.01]);
  }
  const tierSizes = [
    { base: 0.245, radius: 1.87, height: 0.61 },
    { base: 1.16, radius: 1.708, height: 0.58 },
    { base: 2.045, radius: 1.558, height: 0.55 },
    { base: 2.90, radius: 1.421, height: 0.54 },
    { base: 3.745, radius: 1.296, height: 0.51 },
  ];
  const stoneTiers = tierSizes.map(({ base, radius, height }, i) => {
    const node = group(body, `TowerTier${i + 1}`, [0, base, 0]);
    const crown = i === tierSizes.length - 1;
    addPagodaGallery(node, radius, height, [stone, paleStone, beam, recess], i);
    const roof = addPagodaRoof(node, radius, height, crown, [tiles, seam, bronze, beam]);
    if (crown) {
      const spire = group(roof, 'TowerSpire', [0, 0.48, 0]);
      const profile = [
        [0.192, 0], [0.192, 0.056], [0.119, 0.082], [0.105, 0.134], [0.139, 0.177],
        [0.097, 0.226], [0.086, 0.27], [0.117, 0.306], [0.082, 0.35], [0.06, 0.402],
        [0.09, 0.455], [0.087, 0.512], [0.043, 0.561], [0.039, 0.616], [0.019, 0.68],
      ];
      mesh(spire, 'Finial', new T.LatheGeometry(profile.map((p) => new T.Vector2(...p)), 12), bronze);
      mesh(spire, 'FinialPearl', crystalGeometry, paleStone, [0, 0.695, 0], [0.045, 0.066, 0.045]);
      mesh(spire, 'FinialNeedle', new T.ConeGeometry(0.024, 0.22, 8), bronze, [0, 0.823, 0]);
      for (let j = 0; j < 4; j++) {
        const angle = (2 * j - 0.5) * octant;
        const x = radius * Math.sin(angle);
        const z = radius * Math.cos(angle);
        filament(roof, 'FinialBrace', [[0.073 * Math.sin(angle), 1.024, 0.073 * Math.cos(angle)],
          [x * 0.57, 0.61, z * 0.57], [x * 0.955, 0.389, z * 0.955]], beam, 0.008, 8);
      }
    }
    mergeTierMeshes(node);
    return node;
  });

  group(body, 'VortexAnchor', [0, 0.24, 0]);
  group(body, 'ImpactAnchor', [0, 0.12, 0]);

  const build = new T.AnimationClip('build', 1.75, [
    track(floor, 'scale', [0, 0.52, 1.75], [[0.01, 0.35, 0.01], [1.03, 1, 1.03], [1, 1, 1]]),
    ...stoneTiers.flatMap((node, i) => {
      const raise = 0.09 + i * 0.23;
      const settle = 0.62 + i * 0.23;
      const final = tierSizes[i].base;
      return [
        track(node, 'scale', [0, raise, settle, 1.75],
          [[0.001, 0.001, 0.001], [0.001, 0.001, 0.001], [1.015, 1.03, 1.015], [1, 1, 1]]),
        track(node, 'position', [0, raise, settle, 1.75], [[0, 0.17, 0], [0, 0.17, 0], [0, final, 0], [0, final, 0]]),
      ];
    }),
  ]);
  const strike = new T.AnimationClip('strike', 1.52, [
    track(body, 'position', [0, 0.29, 0.61, 0.93, 1.2, 1.52],
      [[0, 0, 0], [0, 0.78, -0.22], [0, 1.36, 1.13], [0, 0.18, 3.18], [0, 0.06, 3.18], [0, 0, 3.18]]),
    track(body, 'rotation', [0, 0.29, 0.61, 0.93, 1.2, 1.52],
      [[0, 0, 0], [-0.19, 0, 0], [0.49, 0, 0.08], [0.93, 0, -0.03], [0.34, -0.9, 0], [0, -Math.PI / 2, 0]]),
  ]);
  return { root, clips: [build, strike] };
}

function makeVortex() {
  const root = group(null, 'WindVortexRoot');
  const rotor = group(root, 'WindRotor');
  const target = group(root, 'WindTargetMotion');
  const vapor = glow('Soft cyan airflow', 0x78e9ff, 0.52);
  const bright = glow('Pale mint airflow', 0xb5ffeb, 0.74);
  const spark = glow('Wind tracers', 0xe7fff4);
  const radiusAt = (t) => 0.24 + 0.7 * t;
  for (let arm = 0; arm < 5; arm++) {
    const geometry = new T.BufferGeometry();
    const positions = [];
    const indices = [];
    const segments = 48;
    for (let i = 0; i <= segments; i++) {
      const s = i / segments;
      const t = 0.04 + 0.92 * s;
      const a = tau * (arm / 5 + 1.1 * s);
      const w = (0.003 + 0.12 * Math.sin(Math.PI * s) ** 0.8) * (1 + t * 0.38);
      for (const edge of [-1, 1]) {
        const r = radiusAt(t) + edge * w * 0.42;
        positions.push(r * Math.cos(a), r * Math.sin(a), 3.05 * t + edge * w * 0.63);
      }
      const j = i * 2;
      if (i < segments) indices.push(j, j + 2, j + 1, j + 1, j + 2, j + 3);
    }
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    mesh(rotor, `AirRibbon${arm + 1}`, geometry, arm % 2 ? bright : vapor);
  }
  const sparks = Array.from({ length: 10 }, (_, i) =>
    mesh(root, `WindTracer${i + 1}`, crystalGeometry, spark, [0, 0, 0], [0.002, 0.002, 0.002]));

  // Local X is the side-to-side drift, Y is lift above the target's floor, and +Z points away from the caster.
  const targetPaths = {
    inhale: [
      [0, [0, 0, 3.05], [0, 0, 0]],
      [0.22, [0, 0, 3.05], [-0.12, 0, 0.04]],
      [0.46, [0.19, 0.20, 2.79], [0.22, 0.09, -0.25]],
      [0.83, [-0.26, 0.45, 1.81], [0.42, -0.18, 0.29]],
      [1.18, [0.15, 0.26, 0.91], [0.23, 0.14, -0.19]],
      [1.43, [0, 0.07, 0.57], [-0.12, 0, 0.07]],
      [1.65, [0, 0, 0.64], [0, 0, 0]],
    ],
    exhale: [
      [0, [0, 0, 0.64], [0, 0, 0]],
      [0.21, [0, 0, 0.64], [0.13, 0, -0.05]],
      [0.37, [0.10, 0.20, 1.04], [-0.38, 0.08, -0.23]],
      [0.67, [-0.17, 0.66, 2.16], [-0.63, -0.10, 0.31]],
      [0.98, [0.09, 0.42, 3.04], [-0.34, 0.09, -0.14]],
      [1.23, [0, 0, 3.16], [0.15, 0, 0.05]],
      [1.47, [0, 0.05, 3.22], [-0.08, 0, -0.03]],
      [1.65, [0, 0, 3.22], [0, 0, 0]],
    ],
  };
  const clips = ['inhale', 'exhale', 'capture'].map((name) => {
    const direction = name === 'exhale' ? 1 : -1;
    const duration = name === 'capture' ? 1.82 : 1.65;
    const times = Array.from({ length: 37 }, (_, i) => i * duration / 36);
    const tracks = [
      track(rotor, 'rotation', times, times.map((t) => [0, 0, direction * t * 7.3])),
      track(rotor, 'scale', [0, 0.17, 0.32, duration - 0.31, duration], [[0.01, 0.01, 0.015], [0.76, 0.76, 0.72],
        [1, 1, 1], [0.96, 0.96, 1], [0.01, 0.01, 0.015]]),
    ];
    const targetPath = targetPaths[name];
    if (targetPath) {
      const keyTimes = targetPath.map(([t]) => t);
      tracks.push(track(target, 'position', keyTimes, targetPath.map(([, p]) => p)));
      tracks.push(track(target, 'rotation', keyTimes, targetPath.map(([, , r]) => r)));
    }
    for (const [i, node] of sparks.entries()) {
      const samples = times.map((time) => {
        const run = T.MathUtils.clamp((time - (i * 0.079)) / 0.83, 0, 1);
        const depth = direction > 0 ? run : 1 - run;
        const angle = 2.39996 * i + depth * tau * 1.08 + direction * time * 4;
        const radius = radiusAt(depth) * (0.81 + 0.13 * Math.sin(i));
        const size = 0.001 + 0.042 * Math.sin(Math.PI * run) ** 0.55;
        return { point: [radius * Math.cos(angle), radius * Math.sin(angle), depth * 3.05], size };
      });
      tracks.push(track(node, 'position', times, samples.map(({ point }) => point)));
      tracks.push(track(node, 'scale', times, samples.map(({ size }) => [size, size, size * 2.65])));
    }
    return new T.AnimationClip(name, duration, tracks);
  });
  return { root, clips };
}

const leech = makeLeech();
const assets = [
  ['flying-leech.glb', leech],
  ['flying-leech-spectral.glb', makeSpecter(leech)],
  ['basalt-tower.glb', makeTower()],
  ['wind-vortex.glb', makeVortex()],
];
const output = new URL('../model/', import.meta.url);
await mkdir(output, { recursive: true });
const manifest = [];
for (const [file, { root, clips }] of assets) {
  const result = Buffer.from(await new GLTFExporter().parseAsync(root, { binary: true, animations: clips }));
  await writeFile(new URL(file, output), result);
  const bounds = new T.Box3().setFromObject(root);
  let triangles = 0;
  let meshes = 0;
  const materials = new Set();
  root.traverse((node) => {
    if (!node.isMesh) return;
    triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
    meshes++;
    materials.add(node.material);
  });
  manifest.push({ file: `model/${file}`, bytes: result.length, sha256: createHash('sha256').update(result).digest('hex'),
    triangles, meshes, materials: materials.size,
    bounds: [bounds.min.toArray(), bounds.max.toArray()].map((point) => point.map((value) => +value.toFixed(3))),
    animations: clips.map(({ name, duration }) => ({ name, duration })) });
}

const spec = {
  schemaVersion: 1, displayName: '飞天水蛭', suggestedCharId: 'flying-leech', visualId: 'flying-leech-v2',
  source: 'src/generate.mjs', preview: 'preview/index.html', validation: 'evidence/validation.json',
  origin: 'Original procedural geometry, materials and articulated animation. No external assets.',
  coordinates: { unit: 'meter', up: '+Y', forward: '+Z', floorY: 0, characterPivot: 'ground under hover center' },
  rig: 'Animated named TRS nodes. Character clips are in place. Props have local motion.',
  textures: 0,
  characterAnchors: ['HeadAnchor', 'ChestAnchor', 'BackAnchor', 'WindOrigin', 'GroundAnchor'],
  towerAnchors: ['VortexAnchor', 'ImpactAnchor'],
  towerStyle: { tierCount: 5, sides: 8, form: 'Tapered octagonal pagoda with upturned tiled eaves and a tall finial' },
  towerImpactSeconds: 0.93,
  vortexCapture: { clip: 'capture', rotationX: -Math.PI / 2, scale: [3.82, 3.82, 0.55] },
  directionalWind: { targetNode: 'WindTargetMotion', targetLift: 'Y offset above target floor', awayAxis: '+Z' },
  spectralOpacity: 0.4,
  assets: manifest,
};
await writeFile(new URL('../asset-spec.json', import.meta.url), `${JSON.stringify(spec, null, 2)}\n`);
console.table(manifest.map(({ file, bytes, triangles, meshes }) => ({ file, bytes, triangles, meshes })));
