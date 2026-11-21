/**
 * 拔典 3D 战场 · 程序化人形骨架（低多边形原创）
 *
 * 每名玩家一个 Humanoid 实例：头/躯干/双臂/双腿/手部道具挂点，
 * 全部由基础几何拼装，无外部模型资产（原创，无版权风险）。
 * 提供程序化动作：待机呼吸 / 行走循环 / 攻击挥击 / 受击后仰 / 淘汰倒地 /
 * 复活起身 / 施法举手 / 喝牛奶碰杯 / 躲藏下蹲。
 *
 * 坐标约定：+Z 为面朝方向（面向桌心），y=0 为脚底。
 */

import * as THREE from 'three';

export type HumanoidPose = 'idle' | 'walk' | 'attack' | 'flinch' | 'dead' | 'cast' | 'drink' | 'crouch' | 'cheer';

interface Limb {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
}

export interface HumanoidColors {
  /** 主色（衣服） */
  main: number;
  /** 辅色（头部/装饰） */
  accent: number;
  /** 肤色 */
  skin: number;
  /** 腿/鞋 */
  dark: number;
}

const SKIN = 0xe8c49a;
const DARK = 0x2e2822;

export class Humanoid {
  readonly root = new THREE.Group();
  readonly hips = new THREE.Group();
  readonly torso = new THREE.Group();
  private headGrp = new THREE.Group();
  private legL: Limb;
  private legR: Limb;
  readonly armL: Limb;
  readonly armR: Limb;
  readonly handR = new THREE.Group();
  private headMesh: THREE.Mesh;
  readonly mats: THREE.MeshStandardMaterial[] = [];
  /** 头顶挂点（帽子/骰子等） */
  readonly headTop = new THREE.Group();
  /** 背后挂点（太极盘） */
  readonly back = new THREE.Group();

  constructor(colors: HumanoidColors, opts: { scale?: number } = {}) {
    const scale = opts.scale ?? 1;
    const matMain = new THREE.MeshStandardMaterial({ color: colors.main, roughness: 0.62, metalness: 0.06 });
    const matAccent = new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.55, metalness: 0.08 });
    const matSkin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7 });
    const matDark = new THREE.MeshStandardMaterial({ color: colors.dark ?? DARK, roughness: 0.8 });
    this.mats.push(matMain, matAccent, matSkin, matDark);

    // ── 腿（髋部枢轴） ──
    const legGeo = new THREE.CylinderGeometry(0.09, 0.08, 0.5, 8);
    legGeo.translate(0, -0.25, 0);
    this.legL = { pivot: new THREE.Group(), mesh: new THREE.Mesh(legGeo, matDark), mat: matDark };
    this.legR = { pivot: new THREE.Group(), mesh: new THREE.Mesh(legGeo.clone(), matDark), mat: matDark };
    this.legL.pivot.position.set(-0.13, 0.56, 0);
    this.legR.pivot.position.set(0.13, 0.56, 0);
    this.legL.pivot.add(this.legL.mesh);
    this.legR.pivot.add(this.legR.mesh);

    // ── 躯干 ──
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.28), matMain);
    chest.position.y = 0.25;
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.09, 0.3), matAccent);
    belt.position.y = 0.03;
    this.torso.add(chest, belt);
    this.torso.position.y = 0.56;

    // ── 手臂（肩部枢轴） ──
    const armGeo = new THREE.CylinderGeometry(0.065, 0.06, 0.46, 8);
    armGeo.translate(0, -0.23, 0);
    this.armL = { pivot: new THREE.Group(), mesh: new THREE.Mesh(armGeo.clone(), matMain), mat: matMain };
    this.armR = { pivot: new THREE.Group(), mesh: new THREE.Mesh(armGeo.clone(), matMain), mat: matMain };
    this.armL.pivot.position.set(-0.27, 0.42, 0);
    this.armR.pivot.position.set(0.27, 0.42, 0);
    // 手（肤色小球在臂端）
    const handGeo = new THREE.SphereGeometry(0.075, 8, 8);
    const handL = new THREE.Mesh(handGeo, matSkin);
    handL.position.y = -0.48;
    const handRm = new THREE.Mesh(handGeo.clone(), matSkin);
    handRm.position.y = -0.48;
    this.armL.pivot.add(handL);
    this.armR.pivot.add(handRm);
    this.torso.add(this.armL.pivot, this.armR.pivot);

    // 右手挂点（道具）
    this.handR.position.set(0, -0.5, 0.05);
    this.armR.pivot.add(this.handR);

    // ── 头（含面部朝向） ──
    this.headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 12), matAccent);
    const eyeGeo = new THREE.SphereGeometry(0.032, 6, 6);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.4 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.08, 0.03, 0.185);
    const eyeR = new THREE.Mesh(eyeGeo.clone(), eyeMat);
    eyeR.position.set(0.08, 0.03, 0.185);
    this.headGrp.add(this.headMesh, eyeL, eyeR);
    this.headGrp.position.y = 1.04;
    this.headTop.position.y = 0.2;
    this.headGrp.add(this.headTop);
    this.torso.add(this.headGrp);

    // 背部挂点
    this.back.position.set(0, 0.3, -0.22);
    this.torso.add(this.back);

    // 组装：hips(root) 承载腿 + 躯干
    this.hips.add(this.legL.pivot, this.legR.pivot, this.torso);
    this.root.add(this.hips);
    this.root.scale.setScalar(scale);
  }

  /** 所有材质（死亡灰化/透明度控制用） */
  materials(): THREE.MeshStandardMaterial[] {
    return this.mats;
  }

  setOpacity(o: number): void {
    for (const m of this.mats) {
      m.transparent = o < 1;
      m.opacity = o;
    }
  }

  /** 头顶高度（名牌定位用） */
  headHeight(): number {
    return 1.28 * this.root.scale.x;
  }

  // ── 程序化动作（每帧调用；phase 为全局时间，walkSpeed 0..1） ──

  /** 待机呼吸 + 轻微重心摆动 */
  idle(t: number, phase = 0): void {
    const s = Math.sin(t * 2 + phase);
    this.hips.position.y = s * 0.012;
    this.torso.rotation.x = 0.02 + Math.sin(t * 1.6 + phase) * 0.015;
    this.torso.rotation.z = Math.sin(t * 1.1 + phase) * 0.02;
    this.armL.pivot.rotation.x = Math.sin(t * 1.6 + phase) * 0.06;
    this.armR.pivot.rotation.x = Math.sin(t * 1.6 + phase + 0.6) * 0.06;
    this.armL.pivot.rotation.z = 0.12;
    this.armR.pivot.rotation.z = -0.12;
    this.headGrp.rotation.y = Math.sin(t * 0.7 + phase) * 0.14;
    this.legL.pivot.rotation.x = 0;
    this.legR.pivot.rotation.x = 0;
    this.hips.rotation.x = 0;
  }

  /** 行走循环：双腿摆动 + 反向摆臂 + 上下起伏 */
  walk(t: number, intensity = 1): void {
    const w = t * 9;
    const amp = 0.62 * intensity;
    this.legL.pivot.rotation.x = Math.sin(w) * amp;
    this.legR.pivot.rotation.x = -Math.sin(w) * amp;
    this.armL.pivot.rotation.x = -Math.sin(w) * amp * 0.8;
    this.armR.pivot.rotation.x = Math.sin(w) * amp * 0.8;
    this.armL.pivot.rotation.z = 0.18;
    this.armR.pivot.rotation.z = -0.18;
    this.hips.position.y = Math.abs(Math.sin(w)) * 0.045 * intensity;
    this.hips.rotation.x = 0.06;
    this.torso.rotation.x = 0.05;
    this.torso.rotation.z = Math.sin(w) * 0.04;
    this.headGrp.rotation.y = 0;
  }

  /** 攻击挥击：右臂高举后劈下（t: 0..1 单次动作） */
  attackSwing(t: number): void {
    const lift = Math.min(1, t / 0.4);
    const swing = t < 0.4 ? 0 : Math.min(1, (t - 0.4) / 0.25);
    const settle = t < 0.65 ? 0 : Math.min(1, (t - 0.65) / 0.35);
    this.armR.pivot.rotation.x = -2.5 * lift + 2.9 * swing + 0;
    this.armR.pivot.rotation.z = -0.3;
    this.armL.pivot.rotation.x = 0.5 * lift * (1 - swing);
    this.torso.rotation.x = 0.12 * lift - 0.22 * swing + 0.1 * settle;
    this.hips.position.y = 0.06 * lift * (1 - swing);
    this.legL.pivot.rotation.x = 0.3 * lift - 0.3 * swing;
    this.legR.pivot.rotation.x = -0.2 * lift + 0.3 * swing;
  }

  /** 受击后仰（t: 0..1 单次） */
  flinch(t: number): void {
    const k = Math.sin(Math.PI * Math.min(1, t));
    this.torso.rotation.x = -0.42 * k;
    this.armL.pivot.rotation.x = -0.9 * k;
    this.armR.pivot.rotation.x = -0.7 * k;
    this.headGrp.rotation.x = -0.3 * k;
    this.hips.position.y = 0;
  }

  /** 施法/举手（持续姿态，t 全局时间） */
  cast(t: number): void {
    this.armL.pivot.rotation.x = -2.4 + Math.sin(t * 3) * 0.1;
    this.armR.pivot.rotation.x = -2.4 - Math.sin(t * 3) * 0.1;
    this.armL.pivot.rotation.z = 0.35;
    this.armR.pivot.rotation.z = -0.35;
    this.headGrp.rotation.y = 0;
    this.torso.rotation.x = -0.05;
  }

  /** 喝牛奶（双手举杯） */
  drink(t: number): void {
    const k = Math.min(1, t * 2);
    this.armL.pivot.rotation.x = -2.2 * k;
    this.armR.pivot.rotation.x = -2.2 * k;
    this.armL.pivot.rotation.z = 0.5;
    this.armR.pivot.rotation.z = -0.5;
    this.headGrp.rotation.x = -0.35 * k;
  }

  /** 躲藏下蹲 */
  crouch(t: number): void {
    const k = Math.min(1, t * 2.5);
    this.hips.position.y = -0.22 * k;
    this.torso.rotation.x = 0.35 * k;
    this.armL.pivot.rotation.x = 0.7 * k;
    this.armR.pivot.rotation.x = 0.7 * k;
    this.headGrp.rotation.x = 0.2 * k;
  }

  /** 胜利欢呼（终局） */
  cheer(t: number): void {
    this.armL.pivot.rotation.x = -2.8 + Math.sin(t * 5) * 0.15;
    this.armR.pivot.rotation.x = -2.8 - Math.sin(t * 5) * 0.15;
    this.hips.position.y = Math.abs(Math.sin(t * 5)) * 0.1;
    this.headGrp.rotation.x = -0.15;
  }

  /** 复活起身（t: 0..1） */
  reviveRise(t: number): void {
    // 从倒地到站立
    this.hips.rotation.x = (1 - t) * -Math.PI / 2;
    this.hips.position.y = (1 - t) * -0.55 + t * 0;
    this.armL.pivot.rotation.x = (1 - t) * 1.2;
    this.armR.pivot.rotation.x = (1 - t) * 1.2;
  }

  /** 重置到默认（复位全部关节） */
  resetPose(): void {
    this.hips.position.y = 0;
    this.hips.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.headGrp.rotation.set(0, 0, 0);
    this.legL.pivot.rotation.set(0, 0, 0);
    this.legR.pivot.rotation.set(0, 0, 0);
    this.armL.pivot.rotation.set(0, 0, 0);
    this.armR.pivot.rotation.set(0, 0, 0);
    this.armL.pivot.rotation.z = 0.12;
    this.armR.pivot.rotation.z = -0.12;
  }
}

/** 角色专属道具（挂在右手/头顶/背后） */
export function buildProp(kind: string): { hand?: THREE.Object3D; headTop?: THREE.Object3D; back?: THREE.Object3D; stick?: THREE.Object3D } {
  const std = (c: number, rough = 0.5, metal = 0.2) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });
  let hand: THREE.Object3D | undefined;
  let headTop: THREE.Object3D | undefined;
  let back: THREE.Object3D | undefined;
  let stick: THREE.Object3D | undefined;

  switch (kind) {
    case 'stick': {
      stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.15, 8), std(0x9a7346, 0.7, 0.05));
      stick.position.set(0, 0.32, 0.1);
      stick.rotation.x = 0.5;
      stick.visible = false;
      hand = stick;
      break;
    }
    case 'flute': {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.62, 8), std(0x5fae8f, 0.55, 0.1));
      f.rotation.x = Math.PI / 2.3;
      f.position.set(0, 0.05, 0.14);
      hand = f;
      break;
    }
    case 'scissors': {
      const g = new THREE.Group();
      const bl = (rot: number) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.5, 0.02), std(0xc0c8d8, 0.25, 0.7));
        m.rotation.z = rot;
        return m;
      };
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 6, 14), std(0x8a2f28, 0.5));
      ring.position.y = -0.22;
      g.add(bl(0.35), bl(-0.35), ring);
      g.rotation.x = Math.PI / 2.6;
      hand = g;
      break;
    }
    case 'bomb': {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), std(0x2a2620, 0.45));
      const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 6), std(0xd8b04a, 0.6));
      fuse.position.y = 0.17;
      g.add(b, fuse);
      hand = g;
      break;
    }
    case 'dice': {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.17), std(0xf0ead8, 0.35));
      d.name = 'spin';
      headTop = d;
      break;
    }
    case 'taiji': {
      const g = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.035, 22), std(0xefe6d8, 0.35));
      disc.rotation.x = Math.PI / 2;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), std(0x2a2620, 0.4));
      dot.position.set(0, 0.09, 0.1);
      g.add(disc, dot);
      g.name = 'spin';
      back = g;
      break;
    }
    case 'hat': {
      const h = new THREE.Group();
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.04, 14), std(0xd8c88f, 0.7, 0));
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.2, 12), std(0xc9b37e, 0.7, 0));
      top.position.y = 0.1;
      h.add(brim, top);
      headTop = h;
      break;
    }
    case 'magnet': {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.035, 8, 20), std(0xc23a30, 0.35, 0.5));
      m.rotation.x = Math.PI / 2.2;
      m.name = 'spin';
      headTop = m;
      break;
    }
    case 'band': {
      const b = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 8, 18), std(0xe8ecff, 0.4));
      b.rotation.x = Math.PI / 2.15;
      b.position.y = 0.08;
      headTop = b;
      break;
    }
    default: break;
  }
  return { hand, headTop, back, stick };
}
