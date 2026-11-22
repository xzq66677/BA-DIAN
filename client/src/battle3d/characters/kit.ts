/**
 * 拔典 3D 战场 · 程序化角色骨架套件
 *
 * 与 gojo-v1 同路线的同步程序化视觉：顶点色平面着色网格 + 局部关节 Group。
 * 本套件只提供通用关节帧、烘焙原语与姿态库；每个角色文件自带剪影/颜色/道具，
 * 输出 CharacterRig 兼容对象后由 characters/index.ts 按 charId 注册。
 *
 * 坐标约定与场景一致：局部 +Y 向上、+Z 面朝方向（面向桌心），脚底 y=0。
 * 一次性动作的 t 为 0..1 归一化进度，循环动作的 t 为全局秒；同一进度重复调用不累加
 * （每个姿态函数先复位到角色 rest 姿态再改关节）。
 */

import * as THREE from 'three';

export type Point = [number, number, number];
/** 每行截面：中心 xyz + x/z 半径，自下而上列出 */
export type Ring = [number, number, number, number, number];
export const TAU = Math.PI * 2;
export const clamp = (t: number) => Math.max(0, Math.min(1, t));
export const ease = (t: number) => { t = clamp(t); return t * t * (3 - 2 * t); };

/** 把同一关节上的零件烘焙成单个顶点色平面着色网格（gojo.ts 同款原语） */
export class Surface {
  private vertices: number[] = [];
  private colors: number[] = [];
  private color = new THREE.Color();

  tri(a: Point, b: Point, c: Point, tint: number) {
    this.vertices.push(...a, ...b, ...c);
    const { r, g, b: blue } = this.color.setHex(tint);
    for (let i = 0; i < 3; i++) this.colors.push(r, g, blue);
  }

  loft(sections: Ring[], sides: number, tint: number, phase = Math.PI / sides,
    shape?: (p: Point, angle: number, row: number) => void) {
    const rows = sections.map(([x, y, z, rx, rz], row) => Array.from({ length: sides }, (_, i) => {
      const a = i * TAU / sides + phase;
      const p: Point = [x + rx * Math.sin(a), y, z + rz * Math.cos(a)];
      shape?.(p, a, row);
      return p;
    }));
    for (let k = 1; k < rows.length; k++) for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides, lo = rows[k - 1], hi = rows[k];
      this.tri(lo[i], lo[j], hi[i], tint);
      this.tri(lo[j], hi[j], hi[i], tint);
    }
    for (const k of [0, rows.length - 1]) {
      const [x, y, z] = sections[k];
      for (let i = 0; i < sides; i++) {
        const a = rows[k][i], b = rows[k][(i + 1) % sides];
        this.tri([x, y, z], k ? a : b, k ? b : a, tint);
      }
    }
  }

  /** 锥形管（斜缝滚边、弯手指、胡子绺等） */
  stroke(from: Point, to: Point, radius: number, endRadius: number, tint: number, n = 6) {
    const axis = new THREE.Vector3(...to).sub(new THREE.Vector3(...from)).normalize();
    const u = new THREE.Vector3().crossVectors(axis, Math.abs(axis.y) > .85 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u);
    const section = (center: Point, r: number) => Array.from({ length: n }, (_, i): Point => {
      const a = i * TAU / n, x = r * Math.cos(a), y = r * Math.sin(a);
      return [center[0] + u.x * x + v.x * y, center[1] + u.y * x + v.y * y, center[2] + u.z * x + v.z * y];
    });
    const lo = section(from, radius), hi = section(to, endRadius);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.tri(lo[i], lo[j], hi[i], tint); this.tri(lo[j], hi[j], hi[i], tint);
      this.tri(from, lo[j], lo[i], tint); this.tri(to, hi[i], hi[j], tint);
    }
  }

  mesh(parent: THREE.Group, mat: THREE.MeshStandardMaterial) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geo.computeVertexNormals();
    parent.add(new THREE.Mesh(geo, mat));
  }
}

export function joint(parent: THREE.Group, name: string, x = 0, y = 0, z = 0) {
  const node = new THREE.Group(); node.name = name; node.position.set(x, y, z); parent.add(node); return node;
}

export interface Frame {
  root: THREE.Group;
  pelvis: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  /** 头顶挂点（帽/骰子/磁环） */
  headTop: THREE.Group;
  armL: { upper: THREE.Group; elbow: THREE.Group };
  armR: { upper: THREE.Group; elbow: THREE.Group };
  legL: { thigh: THREE.Group; knee: THREE.Group };
  legR: { thigh: THREE.Group; knee: THREE.Group };
  hipY: number;
  /** 各段长度（手部/脚掌等收尾件的绘制基准） */
  thighLen: number;
  shinLen: number;
  upperLen: number;
}

/** 通用关节帧：pelvis → (body → head/双臂) + 双腿。位置为套件默认比例，角色可再微调。 */
export function buildFrame(root: THREE.Group, o: {
  hipY?: number; thighLen?: number; shinLen?: number;
  shoulderX?: number; shoulderY?: number; upperLen?: number; headY?: number;
} = {}): Frame {
  const hipY = o.hipY ?? 0.60, thighLen = o.thighLen ?? 0.30, shinLen = o.shinLen ?? 0.28;
  const shoulderX = o.shoulderX ?? 0.235, shoulderY = o.shoulderY ?? 0.40, upperLen = o.upperLen ?? 0.21;
  const headY = o.headY ?? 0.53; // 头底与躯干顶部衔接，不留断颈

  const pelvis = joint(root, 'pelvis', 0, hipY, 0);
  const body = joint(pelvis, 'body');
  const head = joint(body, 'head', 0, headY, 0);
  const headTop = joint(head, 'headTop', 0, 0.17, 0);
  const arm = (s: number) => {
    const upper = joint(body, s < 0 ? 'armL' : 'armR', s * shoulderX, shoulderY, 0);
    const elbow = joint(upper, s < 0 ? 'elbowL' : 'elbowR', 0, -upperLen, 0);
    return { upper, elbow };
  };
  const leg = (s: number) => {
    const thigh = joint(pelvis, s < 0 ? 'thighL' : 'thighR', s * 0.105, 0, 0);
    const knee = joint(thigh, s < 0 ? 'kneeL' : 'kneeR', 0, -thighLen, 0);
    return { thigh, knee };
  };
  return {
    root, pelvis, body, head, headTop,
    armL: arm(-1), armR: arm(1),
    legL: leg(-1), legR: leg(1),
    hipY, thighLen, shinLen, upperLen,
  };
}

export function solidMaterial() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.04 });
}

export function glowMaterial(emissive: number, intensity = 0.65) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, emissive, emissiveIntensity: intensity });
}

// ── 通用几何件（角色传截面覆盖剪影） ─────────────────────────

export interface BodyPieces {
  torso: Ring[]; head: Ring[];
  upperArm: Ring[]; forearm: Ring[];
  thigh: Ring[]; shin: Ring[];
}

/** 默认截面（普通成人体型）；角色按需替换行或整段 */
export const standardPieces: BodyPieces = {
  torso: [[0, -.14, 0, .155, .11], [0, .02, 0, .175, .115], [0, .22, 0, .185, .12], [0, .38, 0, .175, .115]],
  head: [[0, -.13, .01, .13, .12], [0, -.04, .012, .16, .145], [0, .06, .008, .165, .15], [0, .13, 0, .13, .115]],
  upperArm: [[0, -.02, 0, .055, .06], [0, -.18, 0, .05, .055]],
  forearm: [[0, 0, .01, .052, .056], [0, -.17, .02, .042, .046]],
  thigh: [[0, .01, 0, .082, .088], [0, -.28, 0, .066, .072]],
  shin: [[0, 0, 0, .06, .066], [0, -.26, 0, .048, .052]],
};

/** 双腿（thigh→knee 关节各一块网格）；foot 在 knee 空间画脚掌。sole = 膝离地高度，
 * 默认鞋底在 y=0 收口；自定义腿长时角色可传 foot 回调自绘。 */
export function bakeLegs(frame: Frame, mat: THREE.MeshStandardMaterial, o: {
  pieces: Pick<BodyPieces, 'thigh' | 'shin'>; limbTint: number; footTint: number;
  foot?: (g: Surface, sole: number) => void;
}) {
  const sole = frame.hipY - frame.thighLen;
  for (const leg of [frame.legL, frame.legR]) {
    const g = new Surface();
    g.loft(o.pieces.thigh, 9, o.limbTint);
    g.mesh(leg.thigh, mat);
    const s = new Surface();
    s.loft(o.pieces.shin, 9, o.limbTint);
    if (o.foot) o.foot(s, sole);
    else s.loft([[0, -sole + .03, .028, .05, .082], [0, -sole + .03, -.03, .048, .05], [0, -sole + .065, -.02, .046, .052]], 9, o.footTint);
    s.mesh(leg.knee, mat);
  }
}

/** 双臂（upper→elbow 关节各一块网格）；hand 在前臂末端画球形手 */
export function bakeArms(frame: Frame, mat: THREE.MeshStandardMaterial, o: {
  pieces: Pick<BodyPieces, 'upperArm' | 'forearm'>; sleeveTint: number; handTint: number;
  hand?: 'sphere' | 'none'; handR?: number;
}) {
  for (const arm of [frame.armL, frame.armR]) {
    const g = new Surface();
    g.loft(o.pieces.upperArm, 9, o.sleeveTint);
    g.mesh(arm.upper, mat);
    const s = new Surface();
    s.loft(o.pieces.forearm, 9, o.sleeveTint);
    if (o.hand !== 'none') {
      const end = o.pieces.forearm[o.pieces.forearm.length - 1][1];
      s.stroke([0, end + .01, .02], [0, end - .03, .02], o.handR ?? .055, (o.handR ?? .055) * .92, o.handTint, 7);
    }
    s.mesh(arm.elbow, mat);
  }
}

/** 躯干（body 空间） */
export function bakeTorso(frame: Frame, mat: THREE.MeshStandardMaterial, sections: Ring[], tint: number, sides = 12, shape?: (p: Point, a: number, row: number) => void) {
  const g = new Surface();
  g.loft(sections, sides, tint, Math.PI / sides, shape);
  g.mesh(frame.body, mat);
}

/** 头（head 空间）；extra 在同一网格上追加眼/须/发等细节 */
export function bakeHead(frame: Frame, mat: THREE.MeshStandardMaterial, sections: Ring[], tint: number, sides = 12, extra?: (g: Surface) => void) {
  const g = new Surface();
  g.loft(sections, sides, tint);
  extra?.(g);
  g.mesh(frame.head, mat);
}

// ── 通用姿态库 ───────────────────────────────────────────────

export interface PoseSet {
  resetPose(): void;
  idle(t: number, phase?: number): void;
  walk(t: number, intensity?: number): void;
  attackSwing(t: number): void;
  flinch(t: number): void;
  cast(t: number): void;
  drink(t: number): void;
  crouch(t: number): void;
  cheer(t: number): void;
  signalActor(t: number): void;
  dead(t: number): void;
  reviveRise(t: number): void;
}

/**
 * 通用人形姿态库。rest 由角色提供（烘焙完再调用 makePoses）；
 * 每个姿态都先 rest() 再改关节，同一进度重复调用无偏移累加。
 * 角色可在返回对象上覆盖单项（覆盖函数同样先调 rest 再改）。
 */
export function makePoses(frame: Frame, rest: () => void, opts: { hunch?: number } = {}): PoseSet {
  const hunch = opts.hunch ?? 0;

  function idle(t: number, phase = 0) {
    rest();
    const breath = Math.sin(t * 1.8 + phase), drift = Math.sin(t * .87 + phase);
    frame.pelvis.position.y += .009 * breath;
    frame.body.rotation.z += drift * .022;
    frame.body.rotation.x += hunch;
    frame.head.rotation.y += drift * .15;
    frame.head.rotation.x += breath * .025 + hunch * .8;
    frame.armL.elbow.rotation.x += -.14 - breath * .05;
    frame.armR.elbow.rotation.x += -.14 - breath * .05;
  }

  function walk(t: number, intensity = 1) {
    rest();
    const k = clamp(intensity), w = t * 8.3, stride = Math.sin(w) * k;
    frame.pelvis.position.y += .022 * Math.abs(stride) - .022 * k;
    frame.body.rotation.x += .085 * k + hunch * .6;
    frame.body.rotation.y += stride * .15;
    frame.legL.thigh.rotation.x -= stride * .58;
    frame.legR.thigh.rotation.x += stride * .58;
    frame.legL.knee.rotation.x += .58 * k * Math.max(0, Math.cos(w));
    frame.legR.knee.rotation.x += .58 * k * Math.max(0, -Math.cos(w));
    frame.armL.upper.rotation.x += stride * .44;
    frame.armR.upper.rotation.x -= stride * .21;
    frame.armR.elbow.rotation.x += .38 * k;
    frame.head.rotation.y -= stride * .08;
  }

  function attackSwing(t: number) {
    rest();
    t = clamp(t);
    const wind = ease(t / .33) * (1 - ease((t - .33) / .16));
    const snap = ease((t - .31) / .16) * (1 - ease((t - .62) / .38));
    frame.body.rotation.y += -.57 * wind + .66 * snap;
    frame.body.rotation.x += -.12 * wind + .2 * snap;
    frame.armR.upper.rotation.x += -.58 * wind - 1.12 * snap;
    frame.armR.upper.rotation.z += .3 * wind - .22 * snap;
    frame.armR.elbow.rotation.x += -.48 * wind + 1.49 * snap;
    frame.armL.upper.rotation.x += .32 * snap;
    frame.head.rotation.y += .3 * wind - .5 * snap;
    frame.pelvis.position.z += .085 * snap;
  }

  function flinch(t: number) {
    rest();
    const k = ease(t / .2) * (1 - ease((t - .2) / .8));
    frame.pelvis.position.y -= .028 * k;
    frame.body.rotation.set(-.34 * k + hunch * (1 - k), .43 * k, .16 * k);
    frame.head.rotation.x -= .23 * k;
    frame.armL.upper.rotation.x -= .66 * k;
    frame.armR.upper.rotation.z += .52 * k;
    frame.legL.knee.rotation.x += .35 * k;
  }

  function cast(t: number) {
    rest();
    const wave = Math.sin(t * 2.5);
    frame.body.rotation.y = -.38 + hunch * .4;
    frame.head.rotation.y = .34;
    frame.armR.upper.rotation.set(-1.05, -.2, .42);
    frame.armR.elbow.rotation.set(-1.68 + .07 * wave, .02, -.27);
    frame.armL.upper.rotation.set(-.55, .1, -.58);
    frame.armL.elbow.rotation.x = -1.1;
  }

  function drink(t: number) {
    rest();
    const k = ease(t * 2.6);
    frame.armR.upper.rotation.x -= .63 * k;
    frame.armR.upper.rotation.z -= .22 * k;
    frame.armR.elbow.rotation.x -= .72 * k;
    frame.head.rotation.x -= .24 * k;
  }

  function crouch(t: number) {
    rest();
    const k = ease(t * 2.7);
    // 下沉量按髋高缩放；屈膝加深使小腿折向身下，脚底不穿台面
    frame.pelvis.position.y -= .214 * Math.min(1, frame.hipY / .688) * k;
    frame.legL.thigh.rotation.x -= .91 * k;
    frame.legR.thigh.rotation.x -= .99 * k;
    frame.legL.knee.rotation.x += 2 * k;
    frame.legR.knee.rotation.x += 2.08 * k;
    frame.body.rotation.x += .45 * k + hunch * .5;
    frame.head.rotation.x -= .29 * k;
    frame.armL.upper.rotation.x -= .71 * k;
  }

  function cheer(t: number) {
    rest();
    const lift = .5 + .5 * Math.sin(t * 4.3);
    frame.pelvis.position.y += lift * .045;
    frame.armR.upper.rotation.set(-2.45 - lift * .16, 0, .53);
    frame.armR.elbow.rotation.x = -.38;
    frame.armL.upper.rotation.set(-.6, 0, -.35);
    frame.armL.elbow.rotation.x = -1.7;
    frame.head.rotation.x -= .18;
  }

  function signalActor(t: number) {
    rest();
    frame.armR.upper.rotation.x += -.5 + Math.sin(t * 4) * .12;
    frame.armR.elbow.rotation.x += -.35;
  }

  function dead(t: number) {
    rest();
    const k = ease(t), buckle = Math.sin(Math.PI * k);
    // 倒地下沉量与髋高成比例（hipY-0.2 为贴地骨盆高度），避免矮个/高个角色穿地或悬空
    frame.pelvis.rotation.x = -1.53 * k;
    frame.pelvis.rotation.z = -.13 * k;
    frame.pelvis.position.y -= (frame.hipY - .2) * k;
    frame.pelvis.position.z -= .16 * k;
    frame.body.rotation.x += .19 * buckle + hunch * (1 - k);
    frame.head.rotation.y += .49 * k;
    frame.legL.thigh.rotation.x -= .52 * buckle + .1 * k;
    frame.legL.knee.rotation.x += .99 * buckle + .18 * k;
    frame.legR.thigh.rotation.z += .17 * k;
    frame.legR.knee.rotation.x += .39 * buckle;
    frame.armL.upper.rotation.z -= .64 * k;
    frame.armR.upper.rotation.z += .69 * k;
    frame.armR.elbow.rotation.x += 1.34 * k;
  }

  function reviveRise(t: number) {
    t = clamp(t);
    dead(1 - t);
    const sweep = Math.sin(Math.PI * t);
    frame.armR.elbow.rotation.x -= .54 * sweep;
    frame.body.rotation.y += .31 * sweep;
  }

  return { resetPose: rest, idle, walk, attackSwing, flinch, cast, drink, crouch, cheer, signalActor, dead, reviveRise };
}
