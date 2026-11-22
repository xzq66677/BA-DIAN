/**
 * 拔典 3D 战场 · 低模发型增强层
 *
 * 在既有角色 rig 的 head / headTop 挂点上追加顶点色平面着色低模几何，
 * 补足束发、鬓角、后脑发量、短发发际线与刘海体积。脸、衣、道具、动作与
 * 脚底锁定一概不动。几何原语复用 kit.ts 的 Surface，与角色 rig 同源。
 *
 * 移植自独立视觉原型的 hair-style-kit.js；入口为 applyHairStyle(rig, charId)，
 * 在 characters/index.ts 的专用 rig 工厂路径统一挂接一次。
 * 提供 setHairStyle(rig, on) 做整体显隐，便于回退对照。
 */

import * as THREE from 'three';
import { Surface } from './kit.js';

/** 挂发型层所需的最小 rig 结构（CharacterRig 满足，避免与 index.ts 循环依赖） */
export interface HairRig {
  root: THREE.Group;
  materials(): THREE.MeshStandardMaterial[];
}

type Ring = [number, number, number, number, number];

interface Style {
  kind: string;
  color: number;
  tie?: number;
  knot?: number;
  hairline?: boolean;
}

/** 角色 ID → 发型样式；颜色沿用各 rig 原发色，未收录角色走 default 短发 */
export const HAIR_STYLES: Record<string, Style> = {
  chuixiao: { kind: 'topknot', color: 0x241f1c, tie: 0x9fd8c2, knot: 1.18 },
  bagun: { kind: 'short', color: 0x2c2620, knot: 0.92, hairline: true },
  'ivan-girl': { kind: 'twin', color: 0x5a3c26 },
  gojo: { kind: 'spiky', color: 0xf5f7ff },
  laodaye: { kind: 'elder', color: 0xe9e4d8 },
  mabaoguo: { kind: 'topknot', color: 0xdcd8ce, tie: 0x8f2f2a, knot: 0.82 },
  wuliuqi: { kind: 'short', color: 0x1f1c1a, knot: 0.8 },
  'hero-today': { kind: 'short', color: 0x2c241e, knot: 0.7 },
  dajianke: { kind: 'slick', color: 0x26201d },
  dapihuai: { kind: 'kid', color: 0x241f1b },
  default: { kind: 'short', color: 0x332c26, knot: 0.6 },
};

// ── 公共几何件 ─────────────────────────────────────────────

function backMass(g: Surface, color: number, cx: number, rx: number, top: number) {
  g.loft([
    [0, 0.015, cx, rx, 0.068],
    [0, 0.085, cx - 0.005, rx + 0.004, 0.072],
    [0, top, cx + 0.012, rx - 0.015, 0.058],
  ], 10, color);
}

function sideburns(g: Surface, color: number, x: number, z: number, r0: number, low: number) {
  for (const s of [-1, 1]) {
    g.stroke([s * x, 0.082, z], [s * (x + 0.006), low, z - 0.012], r0, r0 * 0.45, color, 6);
  }
}

function topKnot(g2: Surface, s: Style) {
  const c = s.color, k = s.knot || 1;
  g2.loft([
    [0, -0.025, -0.03, 0.05 * k, 0.048 * k],
    [0, 0.032, -0.035, 0.063 * k, 0.058 * k],
    [0, 0.078, -0.04, 0.05 * k, 0.046 * k],
    [0, 0.1, -0.042, 0.016, 0.015],
  ], 10, c);
  if (s.tie) {
    g2.loft([[0, 0.002, -0.033, 0.052 * k, 0.05 * k], [0, 0.018, -0.034, 0.052 * k, 0.05 * k]], 10, s.tie);
  }
  g2.stroke([0, 0.005, -0.035], [0, 0.12, -0.062], 0.026 * k, 0.01, c, 7);
}

// ── 各造型构造器：g 挂 head，g2 挂 headTop ──────────────────

function buildTopknot(g: Surface, g2: Surface, s: Style) {
  g.loft([
    [0, 0.105, -0.008, 0.163, 0.151],
    [0, 0.14, -0.012, 0.155, 0.143],
    [0, 0.158, -0.014, 0.132, 0.122],
  ], 12, s.color);
  backMass(g, s.color, -0.1, 0.146, 0.14);
  sideburns(g, s.color, 0.133, 0.092, 0.021, -0.018);
  topKnot(g2, s);
}

function buildShort(g: Surface, g2: Surface, s: Style) {
  g.loft([
    [0, 0.1, -0.005, 0.164, 0.152],
    [0, 0.135, -0.008, 0.156, 0.145],
    [0, 0.148, -0.01, 0.14, 0.13],
  ], 12, s.color);
  backMass(g, s.color, -0.102, 0.15, 0.138);
  sideburns(g, s.color, 0.132, 0.08, 0.015, -0.012);
  if (s.hairline) {
    g.stroke([-0.132, 0.113, 0.108], [0.132, 0.113, 0.108], 0.017, 0.017, s.color, 8);
    g.stroke([0, 0.113, 0.116], [0, 0.094, 0.144], 0.014, 0.008, s.color, 6);
  }
  if (s.knot) {
    const k = s.knot;
    g2.loft([
      [0, -0.012, -0.015, 0.046 * k, 0.044 * k],
      [0, 0.035, -0.02, 0.05 * k, 0.047 * k],
      [0, 0.07, -0.022, 0.03 * k, 0.028 * k],
    ], 9, s.color);
  }
}

function buildTwin(g: Surface, g2: Surface, s: Style) {
  g.loft([
    [0, 0.085, 0.005, 0.174, 0.16],
    [0, 0.13, 0, 0.169, 0.156],
    [0, 0.162, -0.005, 0.146, 0.136],
  ], 12, s.color);
  [-0.092, -0.031, 0.031, 0.092].forEach((x, i) => {
    g.stroke([x, 0.128, 0.128], [x * 1.06, 0.07 - (i % 2) * 0.008, 0.153], 0.023, 0.012, s.color, 6);
  });
  for (const side of [-1, 1]) {
    g.loft([
      [side * 0.164, 0.07, -0.01, 0.046, 0.05],
      [side * 0.184, 0.02, 0, 0.052, 0.056],
      [side * 0.202, -0.08, 0.015, 0.04, 0.045],
    ], 8, s.color);
  }
  backMass(g, s.color, -0.095, 0.16, 0.145);
  g2.stroke([0, 0, 0.005], [0.012, 0.062, -0.012], 0.024, 0.01, s.color, 7);
}

function buildSpiky(g: Surface, _g2: Surface, s: Style) {
  // 五条悟原发量已足，只补后脑厚度与几束背向发片，避让眼罩
  g.loft([
    [0, 0.08, -0.082, 0.19, 0.1],
    [0, 0.16, -0.1, 0.2, 0.095],
    [0, 0.23, -0.11, 0.14, 0.07],
  ], 12, s.color);
  for (const side of [-1, 1]) {
    g.stroke([side * 0.15, 0.16, -0.08], [side * 0.23, 0.26, -0.13], 0.045, 0.012, 0xe8eef8, 6);
  }
}

function buildElder(g: Surface, _g2: Surface, s: Style) {
  backMass(g, s.color, -0.095, 0.15, 0.125);
  sideburns(g, s.color, 0.146, 0.0, 0.023, -0.075);
  g.loft([[0, 0.1, -0.005, 0.16, 0.148], [0, 0.132, -0.008, 0.15, 0.14]], 12, s.color);
}

function buildSlick(g: Surface, _g2: Surface, s: Style) {
  g.loft([
    [0, 0.1, -0.005, 0.164, 0.152],
    [0, 0.138, -0.008, 0.156, 0.146],
    [0, 0.152, -0.01, 0.14, 0.132],
  ], 12, s.color);
  backMass(g, s.color, -0.1, 0.15, 0.14);
  sideburns(g, s.color, 0.132, 0.075, 0.014, -0.01);
  g.stroke([0.055, 0.145, 0.095], [0.12, 0.105, 0.055], 0.018, 0.01, s.color, 6);
}

function buildKid(g: Surface, g2: Surface, s: Style) {
  g.loft([
    [0, 0.105, 0.002, 0.192, 0.172],
    [0, 0.145, 0, 0.182, 0.162],
    [0, 0.172, -0.005, 0.142, 0.13],
  ], 12, s.color);
  backMass(g, s.color, -0.105, 0.177, 0.155);
  for (const side of [-1, 1]) {
    g.stroke([side * 0.17, 0.11, 0.06], [side * 0.19, 0.02, 0.04], 0.028, 0.014, s.color, 6);
  }
  g2.stroke([0, 0.005, 0], [0.015, 0.075, -0.01], 0.016, 0.006, s.color, 6);
}

const BUILDERS: Record<string, (g: Surface, g2: Surface, s: Style) => void> = {
  topknot: buildTopknot,
  short: buildShort,
  twin: buildTwin,
  spiky: buildSpiky,
  elder: buildElder,
  slick: buildSlick,
  kid: buildKid,
};

const applied = new WeakSet<THREE.Object3D>();
const layers = new WeakMap<THREE.Object3D, { head: THREE.Group; top: THREE.Group | null }>();

/** 网格命名，便于取证与测试定位 */
function nameMeshes(group: THREE.Group) {
  group.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) { mesh.name = 'hairStyleV2Mesh'; mesh.castShadow = true; }
  });
}

/**
 * 给一名角色 rig 挂发型增强层。幂等：同一 root 重复调用不会叠加几何。
 * 返回是否实际挂接（已挂过或缺少 head 挂点时返回 false）。
 */
export function applyHairStyle(rig: HairRig, charId: string): boolean {
  const root = rig.root;
  if (applied.has(root)) return false;
  const head = root.getObjectByName('head') as THREE.Group | undefined;
  const headTop = root.getObjectByName('headTop') as THREE.Group | undefined;
  if (!head) return false;

  const style = HAIR_STYLES[charId] ?? HAIR_STYLES.default;
  const mat = rig.materials()[0] ?? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.04 });
  const g = new Surface(), g2 = new Surface();
  (BUILDERS[style.kind] ?? buildShort)(g, g2, style);

  const headGrp = new THREE.Group(); headGrp.name = 'hairStyleV2_head';
  const topGrp = new THREE.Group(); topGrp.name = 'hairStyleV2_top';
  g.mesh(headGrp, mat);
  nameMeshes(headGrp);
  head.add(headGrp);
  // 部分角色（如老大爷、大贱客）只补发际线/后脑，头顶无新增件——跳过空网格
  let topAdded = false;
  if (headTop && !g2.isEmpty) {
    g2.mesh(topGrp, mat);
    nameMeshes(topGrp);
    headTop.add(topGrp);
    topAdded = true;
  }

  applied.add(root);
  layers.set(root, { head: headGrp, top: topAdded ? topGrp : null });
  return true;
}

/** 整体显隐发型层，便于新旧对照与回退；未挂接时静默无操作 */
export function setHairStyle(rig: HairRig, on: boolean): void {
  const layer = layers.get(rig.root);
  if (!layer) return;
  layer.head.visible = !!on;
  if (layer.top) layer.top.visible = !!on;
}
