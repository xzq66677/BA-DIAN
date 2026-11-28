/**
 * 漩涡吸附曲线（Issue #99）：水蛇「吸」的目标落点演出。
 *
 * 覆盖：
 *  - t=0 从起点出发、t=1 精确落在落点槽位；
 *  - 半径单调收敛（螺旋吸入、不回弹）；
 *  - 中途抬升有界且绕行超过一圈（漩涡观感）；
 *  - 极近距离（塔内转移等）返回 undefined，调用方回退原路径。
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { vortexPull } from '../../client/src/battle3d/collaboration-props.js';

describe('漩涡吸附曲线 vortexPull（Issue #99）', () => {
  const to = new THREE.Vector3(0, 0.55, 0);
  const curve = vortexPull(new THREE.Vector3(3, 0.55, 0), to)!;

  it('长距离生成曲线；t=0 从起点出发、t=1 精确落在落点', () => {
    expect(curve).toBeTruthy();
    const start = curve(0);
    expect(start.x).toBeCloseTo(3, 6);
    expect(start.z).toBeCloseTo(0, 6);
    expect(start.y).toBeCloseTo(to.y, 6);
    const end = curve(1);
    expect(end.x).toBeCloseTo(to.x, 6);
    expect(end.y).toBeCloseTo(to.y, 6);
    expect(end.z).toBeCloseTo(to.z, 6);
  });

  it('半径单调收敛（螺旋吸入，不回弹）', () => {
    let prev = Infinity;
    for (let t = 0; t <= 1.001; t += 0.05) {
      const p = curve(Math.min(1, t));
      const r = Math.hypot(p.x - to.x, p.z - to.z);
      expect(r).toBeLessThanOrEqual(prev + 1e-9);
      prev = r;
    }
  });

  it('抬升有界，且绕行超过一圈（漩涡观感）', () => {
    const lift = Math.min(.45, 3 * .18);
    let prevAngle = Math.atan2(curve(0).z - to.z, curve(0).x - to.x);
    let total = 0;
    for (let t = 0.05; t <= 1.001; t += 0.05) {
      const p = curve(Math.min(1, t));
      expect(p.y - to.y).toBeLessThanOrEqual(lift * Math.sin(Math.PI * Math.min(1, t)) + 1e-9);
      const a = Math.atan2(p.z - to.z, p.x - to.x);
      let d = a - prevAngle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      total += d;
      prevAngle = a;
    }
    expect(total).toBeGreaterThan(Math.PI); // turns = 1.25 圈
  });

  it('极近距离（塔内转移）返回 undefined，调用方回退原始路径', () => {
    const p = new THREE.Vector3(1, 0.55, 1);
    expect(vortexPull(p, p.clone())).toBeUndefined();
  });
});
