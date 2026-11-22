import * as THREE from 'three';
import { TABLE, type RoomAnchor, type Vec2 } from './layout.js';

/**
 * MAP-101 石材与遗迹细化：统一「冷灰蓝岩体 + 暖铜嵌线 + 遗物青」色彩体系。
 * 保留既有构图与锚点，只提升材质层次、遗迹轮廓与细节密度；
 * 所有装饰都在角色站立面（y ≥ 1.22）与步行弧线（r ≈ 3.2, y ≈ 1.3+）之外或之下。
 */
export const RUINS_COLORS = {
  sky: 0x0f1724,        // 深空背景（雾同色，天穹地平线与其衔接）
  bronze: 0xcda26a,     // 暖铜嵌线
  footings: 0x2b3346,   // 深层基石
  ashlar: 0x606878,     // 砌石台身（scene.ts 台体读取）
  seam: 0x39465a,       // 层间缝色 / 桥体阴影层
  capStone: 0x8a8f9c,   // 凿刻基座圈梁（承接台体的受光浅色）
  strataWarm: 0x5d6373, // 上层岩
  strataDeep: 0x3a4358, // 中层岩
  strataVoid: 0x252d40, // 底层岩（沉入雾色）
  glyphTeal: 0x5fb6c9,  // 遗物青（浮岩 / 晶簇呼应）
} as const;

interface StoneOpts { roughness?: number; metalness?: number; vertexColors?: boolean }

const stone = (color: number, opts: StoneOpts = {}) => new THREE.MeshStandardMaterial({
  color, flatShading: true,
  roughness: opts.roughness ?? 0.93,
  metalness: opts.metalness ?? 0,
  vertexColors: opts.vertexColors ?? false,
});

const frac = (n: number) => n - Math.floor(n);
/** 确定性伪随机（种子绑定，构建结果稳定可复现） */
const hash = (a: number, b: number) => frac(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);

/**
 * MAP-101 石材质感：非索引化后按面写入明度扰动。
 * 朝上略亮、朝下偏暗（烘焙遮蔽），叠加高度衰减与面级杂色，
 * 让平直着色的低模呈现凿刻岩面的纹理变化 —— 零纹理与运行时开销。
 */
function mottle(geometry: THREE.BufferGeometry, seed: number, strength = 0.09): THREE.BufferGeometry {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox!;
  const span = Math.max(1e-4, max.y - min.y);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const a = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (let f = 0; f < pos.count; f += 3) {
    a.fromBufferAttribute(pos, f);
    nrm.copy(ab.fromBufferAttribute(pos, f + 1).sub(a))
      .cross(ac.fromBufferAttribute(pos, f + 2).sub(a)).normalize();
    const jitter = 1 + (hash(f, seed) - 0.5) * 2 * strength;
    for (let v = 0; v < 3; v++) {
      const h = (pos.getY(f + v) - min.y) / span;
      // 面朝向遮蔽 × 高度衰减 × 面级杂色
      const shade = Math.min(1.25, Math.max(0.55,
        jitter * (0.9 + 0.1 * h) * (0.92 + 0.08 * nrm.y)));
      colors.set([shade, shade, shade], 3 * (f + v));
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * 阶梯岩层托起独立台面（MAP-101：五层锥度 + 凿刻基座圈梁 + 层缝碎岩）。
 * 顶层作为平台基座圈梁略宽于台体，向下逐层收窄成浮空岩锥；
 * 深层错位旋转与微倾角营造断层地层感。每个子树资源独立，可随房间释放。
 */
export function island(radius: number, seed: number, height: number): THREE.Group {
  const group = new THREE.Group();
  const layers = [
    { top: 1.065, bottom: 0.97, depth: 0.3, color: RUINS_COLORS.capStone, rough: 0.88 },  // 凿刻基座
    { top: 0.95, bottom: 0.8, depth: 0.42, color: RUINS_COLORS.strataWarm },              // 上岩层
    { top: 0.78, bottom: 0.55, depth: 0.55, color: RUINS_COLORS.footings },               // 中岩层
    { top: 0.53, bottom: 0.3, depth: height * 0.38, color: RUINS_COLORS.strataDeep },     // 深岩层
    { top: 0.28, bottom: 0.06, depth: height * 0.4, color: RUINS_COLORS.strataVoid },     // 底岩尖
  ];
  let y = 0.05;
  for (const [i, layer] of layers.entries()) {
    const mesh = new THREE.Mesh(
      mottle(new THREE.CylinderGeometry(radius * layer.top, radius * layer.bottom, layer.depth, 6), seed + i, 0.08),
      stone(layer.color, { roughness: layer.rough ?? 0.95, vertexColors: true }),
    );
    const tilt = i < 2 ? 0 : (hash(i, seed) - 0.5) * 0.1;
    mesh.rotation.set(
      Math.sin(seed + i) * tilt * 0.5,
      Math.PI / 6 + (i < 2 ? 0 : Math.sin(seed + i * 2.3) * 0.16),
      Math.cos(seed * 1.7 + i) * tilt * 0.5,
    );
    mesh.position.set(i < 2 ? 0 : Math.cos(seed) * i * 0.12, y - layer.depth / 2, 0);
    group.add(mesh);
    y -= layer.depth;
  }
  // 层缝碎岩：从中层岩缝隙探出的棱角岩块（实例化，1 次绘制调用）
  const chunks = new THREE.InstancedMesh(
    mottle(new THREE.DodecahedronGeometry(1), seed + 9, 0.12),
    stone(RUINS_COLORS.strataDeep, { vertexColors: true }), 6);
  const transform = new THREE.Object3D();
  for (let i = 0; i < chunks.count; i++) {
    const angle = hash(i * 3, seed) * Math.PI * 2;
    const r = radius * (0.72 + hash(i, seed + 4) * 0.18);
    const size = 0.16 + hash(i * 7, seed + 2) * 0.17;
    transform.position.set(Math.sin(angle) * r, -0.52 - hash(i * 5, seed) * 0.72, Math.cos(angle) * r);
    transform.rotation.set(hash(i, seed) * Math.PI, hash(i * 2, seed) * Math.PI, hash(i * 4, seed) * Math.PI);
    transform.scale.set(size, size * (0.8 + hash(i * 6, seed) * 0.7), size);
    transform.updateMatrix();
    chunks.setMatrixAt(i, transform.matrix);
  }
  group.add(chunks);
  return group;
}

/** 三段式天空渐变顶点色：深渊黑 → 雾青地平线 → 天顶深蓝 */
function skyDome(): THREE.Mesh {
  const R = 70;
  const geo = new THREE.SphereGeometry(R, 24, 12);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const stops: [number, number][] = [
    [-1, 0x05080f], [-0.35, 0x0e1622], [0, 0x141f2e], [0.55, 0x0b1420], [1, 0x070c16],
  ];
  const at = (t: number): number => {
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, c0] = stops[i - 1];
        const [t1, c1] = stops[i];
        const k = (t - t0) / (t1 - t0);
        const r = ((c0 >> 16) & 255) + (((c1 >> 16) & 255) - ((c0 >> 16) & 255)) * k;
        const g = ((c0 >> 8) & 255) + (((c1 >> 8) & 255) - ((c0 >> 8) & 255)) * k;
        const b = (c0 & 255) + ((c1 & 255) - (c0 & 255)) * k;
        return (r << 16) | (g << 8) | Math.round(b);
      }
    }
    return stops[stops.length - 1][1];
  };
  for (let i = 0; i < pos.count; i++) {
    const c = at(Math.min(1, Math.max(-1, pos.getY(i) / R)));
    colors.set([((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255], 3 * i);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    side: THREE.BackSide, vertexColors: true, fog: false, depthWrite: false,
  }));
  dome.renderOrder = -1;
  return dome;
}

export function createRuinsEnvironment(): { root: THREE.Group; motes: THREE.Points; relic: THREE.Mesh } {
  const root = new THREE.Group();
  root.add(skyDome());
  // 光照保持三盏静态灯：暖主光定受光面，冷轮廓光勾边缘，半球光统一环境调
  const hemi = new THREE.HemisphereLight(0xb8d3ff, 0x3d4c5c, 1.48);
  const sun = new THREE.DirectionalLight(0xffd9a2, 2.5);
  sun.position.set(7, 12, 5);
  const rim = new THREE.DirectionalLight(0x719ddd, 1.0);
  rim.position.set(-9, 5, -9);
  root.add(hemi, sun, rim);

  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0x9ad8e6, emissive: 0x2e7f95, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.1, flatShading: true,
  });

  const core = new THREE.Group();
  core.position.y = 0.46;
  core.add(island(TABLE.coreRadius * 1.2, 7, 3.8));
  const deck = new THREE.Mesh(
    mottle(new THREE.CylinderGeometry(2.88, 3.14, 0.43, 12), 5, 0.07),
    stone(RUINS_COLORS.capStone, { roughness: 0.9, vertexColors: true }));
  deck.position.y = 0.12;
  core.add(deck);
  const inlayMaterial = new THREE.MeshBasicMaterial({ color: RUINS_COLORS.bronze, transparent: true, opacity: 0.85 });
  for (const radius of [2.58, 2.08, 0.93]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.024, 4, 12), inlayMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.345;
    core.add(ring);
  }
  const spokes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.018, 0.43), inlayMaterial, 12);
  const transform = new THREE.Object3D();
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    transform.position.set(Math.sin(angle) * 1.74, 0.35, Math.cos(angle) * 1.74);
    transform.rotation.y = angle;
    transform.updateMatrix();
    spokes.setMatrixAt(i, transform.matrix);
  }
  core.add(spokes);
  const relic = new THREE.Mesh(new THREE.OctahedronGeometry(0.64),
    new THREE.MeshStandardMaterial({ color: 0x95cadc, emissive: 0x367f8f, emissiveIntensity: 0.65, roughness: 0.32, metalness: 0.38 }));
  relic.position.y = 1.56;
  core.add(relic);

  // 断柱环阵（MAP-101 遗迹轮廓）：8 根残柱立于台缘岩座上，避开局 bridge 轴向
  // 与步行弧线（柱顶 ≤ 1.0 < 弧线 1.3）。实例化残柱 + 柱头，仅 2 次绘制调用。
  const stumps = new THREE.InstancedMesh(
    mottle(new THREE.CylinderGeometry(0.17, 0.24, 1.1, 7), 11, 0.08),
    stone(0x707684, { vertexColors: true }), 8);
  const capitals = new THREE.InstancedMesh(
    mottle(new THREE.BoxGeometry(0.5, 0.11, 0.5), 13, 0.06),
    stone(RUINS_COLORS.capStone, { vertexColors: true, roughness: 0.88 }), 8);
  for (let i = 0; i < 8; i++) {
    const angle = ((i + 0.5) / 8) * Math.PI * 2;
    const r = 3.2 + hash(i, 17) * 0.1;
    const broken = i % 3 === 2;
    const h = broken ? 0.2 + hash(i, 23) * 0.22 : 0.72 + hash(i, 29) * 0.22;
    const lean = broken ? 0 : (hash(i, 31) - 0.5) * 0.12;
    transform.position.set(Math.sin(angle) * r, 0.05 + h * 0.55, Math.cos(angle) * r);
    transform.rotation.set(Math.sin(angle) * lean, angle + hash(i, 37) * 0.4, Math.cos(angle) * lean);
    transform.scale.set(1, h, 1);
    transform.updateMatrix();
    stumps.setMatrixAt(i, transform.matrix);
    if (!broken) {
      transform.position.set(Math.sin(angle) * r, 0.05 + h * 1.1 + 0.05, Math.cos(angle) * r);
      transform.rotation.set(0, angle + 0.35, 0);
      transform.scale.setScalar(1);
    } else {
      transform.scale.setScalar(0); // 断柱不放柱头
    }
    transform.updateMatrix();
    capitals.setMatrixAt(i, transform.matrix);
  }
  // 倒伏残柱：占用一处断柱槽位横躺在台缘缺口处，补足「坍塌神庙」叙事
  // （复用残柱几何，无额外绘制调用；断柱槽位无柱头，不会留下悬空柱头）
  transform.position.set(Math.sin(Math.PI / 4 + 0.06) * 3.3, 0.24, Math.cos(Math.PI / 4 + 0.06) * 3.3);
  transform.rotation.set(0.1, Math.PI / 4, Math.PI / 2 - 0.18);
  transform.scale.set(1, 0.7, 1);
  transform.updateMatrix();
  stumps.setMatrixAt(2, transform.matrix);
  core.add(stumps, capitals);
  // 台缘碎砾：散落在外圈嵌线与台沿之间（实例化，1 次绘制调用）
  const rubble = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1), stone(0x767c8a), 6);
  for (let i = 0; i < rubble.count; i++) {
    const angle = ((i + 0.5) / rubble.count) * Math.PI * 2 + hash(i, 41) * 0.4;
    const r = 2.66 + hash(i * 3, 43) * 0.16;
    const size = 0.05 + hash(i * 5, 47) * 0.06;
    transform.position.set(Math.sin(angle) * r, 0.36, Math.cos(angle) * r);
    transform.rotation.set(hash(i, 53) * Math.PI, hash(i * 2, 53) * Math.PI, 0);
    transform.scale.set(size, size * 0.75, size);
    transform.updateMatrix();
    rubble.setMatrixAt(i, transform.matrix);
  }
  core.add(rubble);

  // 核心岛底部晶簇（MAP-101 主题呼应）：遗物青悬浮晶，低角度环视时可见
  const crystals = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.34), crystalMat, 5);
  for (let i = 0; i < crystals.count; i++) {
    const angle = ((i + 0.5) / crystals.count) * Math.PI * 2;
    const r = 0.42 + hash(i, 59) * 0.6;
    transform.position.set(Math.sin(angle) * r, -4.05 - hash(i * 3, 61) * 0.5, Math.cos(angle) * r);
    transform.rotation.set(hash(i, 67) * 0.8, hash(i * 2, 67), hash(i * 4, 67) * 0.8);
    transform.scale.set(0.5 + hash(i, 71) * 0.4, 1.3 + hash(i * 3, 71) * 1.1, 0.5 + hash(i, 71) * 0.4);
    transform.updateMatrix();
    crystals.setMatrixAt(i, transform.matrix);
  }
  core.add(crystals);
  root.add(core);

  // 遗物伴生浮岩：挂在遗物节点下，随遗物自转与浮动（复用既有动画，零新增逻辑）
  const shards = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.12), crystalMat, 7);
  for (let i = 0; i < shards.count; i++) {
    const angle = ((i + 0.5) / shards.count) * Math.PI * 2;
    const r = 1.0 + hash(i, 73) * 0.34;
    transform.position.set(Math.sin(angle) * r, -0.32 + hash(i * 3, 79) * 0.72, Math.cos(angle) * r);
    transform.rotation.set(hash(i, 83) * Math.PI, hash(i * 2, 83) * Math.PI, 0);
    transform.scale.setScalar(0.5 + hash(i, 89) * 0.8);
    transform.updateMatrix();
    shards.setMatrixAt(i, transform.matrix);
  }
  relic.add(shards);

  // Fragmented silhouettes below the fighting plane.
  const fragments = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1), stone(RUINS_COLORS.strataDeep, { roughness: 0.96 }), 30);
  for (let i = 0; i < fragments.count; i++) {
    const a = i * 2.39996;
    const r = 9 + (i * 17 % 31) * 0.6;
    const size = 0.21 + (i * 7 % 19) * 0.065;
    transform.position.set(Math.sin(a) * r, -3.5 - (i * 13 % 17) * 0.34, Math.cos(a) * r);
    transform.rotation.set(a * 0.72, a, a * 0.38);
    transform.scale.set(size, size * 1.25, size * 0.72);
    transform.updateMatrix();
    fragments.setMatrixAt(i, transform.matrix);
  }
  root.add(fragments);
  const dust = new Float32Array(72 * 3);
  for (let i = 0; i < 72; i++) {
    const r = 3 + (i * 23 % 59) * 0.34;
    const a = i * 2.39996;
    dust.set([Math.sin(a) * r, -2.5 + (i * 17 % 19) * 0.21, Math.cos(a) * r], 3 * i);
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dust, 3));
  const motes = new THREE.Points(dustGeometry,
    new THREE.PointsMaterial({ color: 0x9ed2de, size: 0.095, transparent: true, opacity: 0.53, depthWrite: false }));
  root.add(motes);
  return { root, motes, relic };
}

export function buildBridge(anchor: RoomAnchor, destination: Vec2, destinationRadius: number): THREE.Group {
  const origin = new THREE.Vector3(anchor.center.x, 0, anchor.center.z);
  const target = new THREE.Vector3(destination.x, 0, destination.z);
  const direction = target.clone().sub(origin).normalize();
  const start = origin.addScaledVector(direction, anchor.radius - 0.14);
  const end = target.addScaledVector(direction, -destinationRadius + 0.12);
  const bridge = new THREE.Group();
  const span = start.distanceTo(end);
  if (span < 0.25) return bridge;
  bridge.position.copy(start).lerp(end, 0.5);
  bridge.rotation.y = Math.atan2(direction.x, direction.z);
  const deck = new THREE.Mesh(
    mottle(new THREE.BoxGeometry(1.23, 0.31, span), span * 13, 0.09),
    stone(RUINS_COLORS.strataWarm, { vertexColors: true }));
  deck.position.y = 0.43;
  bridge.add(deck);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.1, span), stone(RUINS_COLORS.seam));
  trim.position.y = 0.23;
  bridge.add(trim);
  const count = Math.max(2, Math.ceil(span / 0.56));
  const blocks = new THREE.InstancedMesh(
    mottle(new THREE.BoxGeometry(1.06, 0.05, (span / count) * 0.89), span * 29, 0.07),
    stone(RUINS_COLORS.capStone, { vertexColors: true, roughness: 0.88 }), count);
  const t = new THREE.Matrix4();
  for (let i = 0; i < count; i++) blocks.setMatrixAt(i, t.makeTranslation(0, 0.61, span * ((i + 0.5) / count - 0.5)));
  bridge.add(blocks);
  // 断续护栏（MAP-101 桥体轮廓）：两侧矮柱按确定性缺失模式排布，
  // 柱顶 ≤ 0.82，低于步行弧线（≈1.3），实例化仅 1 次绘制调用。
  const postGeo = new THREE.CylinderGeometry(0.045, 0.06, 0.24, 5);
  const rows = Math.max(2, Math.ceil(span / 0.85));
  const posts = new THREE.InstancedMesh(postGeo, stone(0x767c8a, { roughness: 0.9 }), rows * 2);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scaleV = new THREE.Vector3();
  const posV = new THREE.Vector3();
  let index = 0;
  for (let i = 0; i < rows; i++) {
    for (const side of [-0.56, 0.56]) {
      const missing = hash(i * 2 + (side > 0 ? 1 : 0), span * 31) < 0.3;
      if (missing) {
        posts.setMatrixAt(index, m.makeScale(0, 0, 0));
      } else {
        const z = span * ((i + 0.5) / rows - 0.5);
        const lean = (hash(i * 5, span * 37) - 0.5) * 0.18;
        posV.set(side, 0.705, z);
        euler.set(side > 0 ? lean : -lean, 0, (hash(i * 7, span * 41) - 0.5) * 0.18);
        q.setFromEuler(euler);
        scaleV.set(1, 1, 1);
        posts.setMatrixAt(index, m.compose(posV, q, scaleV));
      }
      index++;
    }
  }
  bridge.add(posts);
  return bridge;
}
