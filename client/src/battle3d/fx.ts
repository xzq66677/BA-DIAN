/**
 * 拔典 3D 战场 · 一次性特效构建器
 *
 * 每个 FxInstance 是一个自管理生命周期的一次性演出对象：
 *  - update(dt, elapsed) 返回 false 表示演出结束（调用方从场景移除并 dispose）；
 *  - 全部为程序化几何 + 基础材质，无纹理/模型资产，移动端可承受；
 *  - 特效服务于可读性（谁、对谁、哪里、结果），不做无意义的粒子堆砌。
 */

import * as THREE from 'three';

export interface FxInstance {
  /** 返回 false 表示演出结束 */
  update(dt: number, elapsed: number): boolean;
  dispose(): void;
  /** 挂载对象（Group），调用方加入场景并设置位置 */
  object: THREE.Object3D;
}

/** 基础材质工厂：全部半透明/自发光，不投影不接收阴影，depthWrite 关闭避免排序问题 */
function fxMat(color: number, opacity: number, additive = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

function disposeObj(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as unknown as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

// ── 斩击（受击）：两道交叉斜线快速划过 ───────────────────────
export function slashFx(lethal: boolean): FxInstance {
  const g = new THREE.Group();
  const dur = lethal ? 0.5 : 0.42;
  const mk = (rot: number): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> => {
    const geo = new THREE.PlaneGeometry(1.5, 0.085);
    const mesh = new THREE.Mesh(geo, fxMat(lethal ? 0xff3b26 : 0xffe9e2, 0.95, true));
    mesh.rotation.z = rot;
    return mesh;
  };
  const a = mk(-0.5);
  const b = mk(0.35);
  b.scale.setScalar(0.7);
  g.add(a, b);
  return {
    object: g,
    update(dt, el) {
      const t = clamp01(el / dur);
      const sweep = easeOut(t);
      a.scale.x = 0.3 + sweep * 1.2;
      a.material.opacity = 0.95 * (1 - easeIn(t));
      b.scale.x = (0.3 + sweep * 1.0) * 0.7;
      b.material.opacity = 0.7 * (1 - easeIn(t * 1.2));
      return t < 1;
    },
    dispose() { disposeObj(g); },
  };
}

// ── 冲击环（AOE 告警 / 爆炸冲击波 / 复活） ───────────────────
export function ringBurst(color: number, maxR: number, dur: number, opts: { y?: number; tube?: number; additive?: boolean } = {}): FxInstance {
  const geo = new THREE.TorusGeometry(1, opts.tube ?? 0.07, 10, 40);
  const mat = fxMat(color, 0.9, opts.additive ?? true);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  const y = opts.y ?? 0.1;
  mesh.position.y = y;
  const g = new THREE.Group();
  g.add(mesh);
  return {
    object: g,
    update(_dt, el) {
      const t = clamp01(el / dur);
      const s = 0.25 + easeOut(t) * maxR;
      mesh.scale.set(s, s, 1);
      mat.opacity = 0.9 * (1 - t);
      return t < 1;
    },
    dispose() { disposeObj(g); },
  };
}

// ── 光束（攻击宣告 / 瞄准 / 吸引）：从 A 到 B 的细圆柱 ─────────
export function beamFx(from: THREE.Vector3, to: THREE.Vector3, color: number, dur = 0.4, thick = 0.05): FxInstance {
  const dir = to.clone().sub(from);
  const len = Math.max(0.1, dir.length());
  const geo = new THREE.CylinderGeometry(thick, thick, len, 8, 1, true);
  geo.translate(0, len / 2, 0);
  const mat = fxMat(color, 0.85, true);
  const mesh = new THREE.Mesh(geo, mat);
  const g = new THREE.Group();
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  g.add(mesh);
  return {
    object: g,
    update(_dt, el) {
      const t = clamp01(el / dur);
      mat.opacity = 0.85 * (1 - t) * (t < 0.15 ? t / 0.15 : 1);
      return t < 1;
    },
    dispose() { disposeObj(g); },
  };
}

// ── 投掷物（大伊万 / 吹箫哥远程音波 / 普通远程弹） ────────────
export interface ProjectileOpts {
  color: number;
  radius: number;
  dur: number;
  /** 弧线高度 */
  arc?: number;
  spin?: boolean;
  /** 拖尾残影数量 */
  trail?: number;
  /** 附加子物体（如炸弹引信） */
  build?: (g: THREE.Group) => void;
}
export function projectileFx(from: THREE.Vector3, to: THREE.Vector3, opts: ProjectileOpts): FxInstance {
  const g = new THREE.Group();
  const mat = fxMat(opts.color, 0.95, true);
  const body = new THREE.Mesh(new THREE.SphereGeometry(opts.radius, 14, 12), mat);
  g.add(body);
  opts.build?.(g);
  const trailN = opts.trail ?? 0;
  const trailMats: THREE.MeshBasicMaterial[] = [];
  const trailMeshes: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = [];
  for (let i = 0; i < trailN; i++) {
    const tm = fxMat(opts.color, 0.25 * (1 - i / trailN), true);
    const tmesh = new THREE.Mesh(new THREE.SphereGeometry(opts.radius * (0.75 - i * 0.12), 8, 6), tm);
    trailMats.push(tm);
    trailMeshes.push(tmesh);
    g.add(tmesh);
  }
  const mid = from.clone().add(to).multiplyScalar(0.5);
  mid.y += opts.arc ?? 1.4;
  const qA = from.clone(), qB = mid.clone(), qC = to.clone();
  const trailPts: THREE.Vector3[] = [];
  return {
    object: g,
    update(_dt, el) {
      const t = clamp01(el / opts.dur);
      // 二次贝塞尔
      const p = qA.clone().multiplyScalar((1 - t) * (1 - t))
        .add(qB.clone().multiplyScalar(2 * (1 - t) * t))
        .add(qC.clone().multiplyScalar(t * t));
      g.position.copy(p);
      if (opts.spin) g.rotation.z += 0.22;
      // 拖尾：延迟采样历史位置
      trailPts.unshift(p.clone());
      if (trailPts.length > 24) trailPts.pop();
      for (let i = 0; i < trailMeshes.length; i++) {
        const idx = Math.min(trailPts.length - 1, (i + 1) * 5);
        if (idx >= 0 && trailPts[idx]) {
          trailMeshes[i].position.copy(trailPts[idx]).sub(p);
        }
        trailMats[i].opacity = 0.22 * (1 - i / trailMeshes.length) * (t < 0.9 ? 1 : (1 - t) * 10);
        trailMeshes[i].visible = trailPts.length > (i + 1) * 5;
      }
      return t < 1;
    },
    dispose() {
      disposeObj(g);
      for (const m of trailMeshes) { m.geometry.dispose(); m.material.dispose(); }
    },
  };
}

// ── 爆炸（大伊万落点 / 自爆）：火球 + 冲击波 + 火花 ───────────
export function explosionFx(color = 0xff8830): FxInstance {
  const g = new THREE.Group();
  const dur = 1.1;
  // 火球
  const fireMat = fxMat(color, 0.9, true);
  const fire = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), fireMat);
  g.add(fire);
  // 冲击波
  const ringGeo = new THREE.TorusGeometry(1, 0.09, 10, 44);
  const ringMat = fxMat(0xffc890, 0.9, true);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  g.add(ring);
  // 火花（少量、短命，服务可读性）
  const sparks: { m: THREE.Mesh; v: THREE.Vector3; mat: THREE.MeshBasicMaterial }[] = [];
  for (let i = 0; i < 10; i++) {
    const mat = fxMat(0xffb060, 0.95, true);
    const m = new THREE.Mesh(new THREE.TetrahedronGeometry(0.09), mat);
    const ang = (i / 10) * Math.PI * 2 + Math.random() * 0.5;
    const speed = 2.2 + Math.random() * 1.6;
    sparks.push({
      m, mat,
      v: new THREE.Vector3(Math.cos(ang) * speed, 3.2 + Math.random() * 1.8, Math.sin(ang) * speed),
    });
    g.add(m);
  }
  return {
    object: g,
    update(dt, el) {
      const t = clamp01(el / dur);
      // 火球：快速膨胀再收缩消散
      const fs = t < 0.3 ? 0.5 + t * 3.4 : 1.5 * (1 - (t - 0.3) / 0.7) + 0.35;
      fire.scale.setScalar(Math.max(0.01, fs));
      fireMat.opacity = 0.9 * (1 - t * 0.9);
      fire.position.y = 0.5 * easeOut(t);
      // 冲击波
      const rs = 0.4 + easeOut(t) * 4.4;
      ring.scale.set(rs, rs, 1);
      ringMat.opacity = 0.85 * (1 - t);
      // 火花抛物线
      for (const s of sparks) {
        s.v.y -= 7.5 * dt;
        s.m.position.addScaledVector(s.v, dt);
        s.mat.opacity = 0.95 * (1 - t);
      }
      return t < 1;
    },
    dispose() { disposeObj(g); },
  };
}

// ── 治疗环 + 十字上升 ────────────────────────────────────────
export function healFx(): FxInstance {
  const g = new THREE.Group();
  const dur = 0.9;
  const ring = ringBurst(0x4ade80, 0.85, dur, { y: 0.15, tube: 0.045 });
  g.add(ring.object);
  // 十字
  const crossMat = fxMat(0x9ff2b8, 0.95, true);
  const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.02), crossMat);
  const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.3, 0.02), crossMat);
  const cross = new THREE.Group();
  cross.add(c1, c2);
  cross.position.y = 0.6;
  g.add(cross);
  return {
    object: g,
    update(dt, el) {
      const aliveRing = ring.update(dt, el);
      const t = clamp01(el / dur);
      cross.position.y = 0.6 + t * 0.9;
      cross.rotation.y += dt * 2.4;
      crossMat.opacity = 0.95 * (1 - t);
      return aliveRing || t < 1;
    },
    dispose() {
      ring.dispose();
      disposeObj(cross);
    },
  };
}

// ── 技能/触发光柱（角色技能宣告） ────────────────────────────
export function skillAuraFx(color = 0xb27ce8): FxInstance {
  const dur = 0.7;
  const geo = new THREE.CylinderGeometry(0.42, 0.62, 1.7, 18, 1, true);
  geo.translate(0, 0.85, 0);
  const mat = fxMat(color, 0.4, true);
  const pillar = new THREE.Mesh(geo, mat);
  const g = new THREE.Group();
  g.add(pillar);
  return {
    object: g,
    update(_dt, el) {
      const t = clamp01(el / dur);
      mat.opacity = 0.42 * Math.sin(Math.PI * Math.min(1, t));
      pillar.scale.x = pillar.scale.z = 1 + t * 0.35;
      return t < 1;
    },
    dispose() { disposeObj(g); },
  };
}

// ── 点光脉冲（命中/爆炸的全场光感，跟随 reduced-motion 降级） ──
export function flashLightFx(pos: THREE.Vector3, color: number, intensity: number, dur: number): FxInstance {
  const light = new THREE.PointLight(color, intensity, 9, 1.6);
  light.position.copy(pos).add(new THREE.Vector3(0, 1.4, 0));
  const g = new THREE.Group();
  g.add(light);
  return {
    object: g,
    update(_dt, el) {
      const t = clamp01(el / dur);
      light.intensity = intensity * (1 - t);
      return t < 1;
    },
    dispose() { disposeObj(g); },
  };
}

// ── 尘土（移动落点，克制的接地反馈） ─────────────────────────
export function dustFx(): FxInstance {
  const dur = 0.5;
  const g = new THREE.Group();
  const puffs: { m: THREE.Mesh; mat: THREE.MeshBasicMaterial; dir: THREE.Vector3 }[] = [];
  for (let i = 0; i < 4; i++) {
    const mat = fxMat(0xb8b2a4, 0.5);
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat);
    const ang = Math.random() * Math.PI * 2;
    puffs.push({ m, mat, dir: new THREE.Vector3(Math.cos(ang), 0.5, Math.sin(ang)).multiplyScalar(0.7) });
    g.add(m);
  }
  return {
    object: g,
    update(dt, el) {
      const t = clamp01(el / dur);
      for (const p of puffs) {
        p.m.position.addScaledVector(p.dir, dt);
        p.m.scale.setScalar(1 + t * 1.8);
        p.mat.opacity = 0.5 * (1 - t);
      }
      return t < 1;
    },
    dispose() { disposeObj(g); },
  };
}

// ── 领域展开穹顶脉冲（紫） ───────────────────────────────────
export function domainBurstFx(): FxInstance {
  const dur = 0.9;
  const geo = new THREE.SphereGeometry(1.5, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  const mat = fxMat(0x9a6ae0, 0.35, true);
  const dome = new THREE.Mesh(geo, mat);
  dome.scale.setScalar(0.2);
  const g = new THREE.Group();
  g.add(dome);
  return {
    object: g,
    update(_dt, el) {
      const t = clamp01(el / dur);
      dome.scale.setScalar(0.2 + easeOut(t) * 0.85);
      mat.opacity = 0.35 * (1 - t);
      return t < 1;
    },
    dispose() { disposeObj(g); },
  };
}
