/**
 * 拔典 3D 战场 · 单元测试（jsdom，无 WebGL 依赖）
 * 覆盖：布局数学 / 视觉元数据完整性/ 回退检测 / 降级策略 / 诊断日志。
 */
// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { TABLE, createRuinsMap, roomSlot, defaultPose, orbitPose, stableMembers } from '../../client/src/battle3d/layout.js';
import { CHAR_VISUALS, charVisual, ROOM_VISUALS, roomVisual } from '../../client/src/battle3d/palette.js';
import { CHARACTERS } from '../../shared/src/characters/index.js';
import { detectWebGL, preferredRenderer } from '../../client/src/battle3d/Battle3D.js';
import {
  recordContextLost, markSessionDegraded, isSessionDegraded, clearSessionDegraded,
} from '../../client/src/battle3d/gl-policy.js';
import { gllog } from '../../client/src/battle3d/gllog.js';

// ── 布局 ─────────────────────────────────────────────────────

describe('battle3d 布局数学', () => {
  it('房间锚点只取决于服务器房间 ID 集合', () => {
    const ids = ['R10', 'R2', 'R1', 'R3'];
    const first = createRuinsMap(ids);
    const shuffled = createRuinsMap(['R3', 'R2', 'R1', 'R10', 'R2']);
    expect(first).toEqual(shuffled);
    expect([...first.rooms.keys()]).toEqual(['R1', 'R2', 'R3', 'R10']);
    expect(first.rooms.get('R1')?.center).toEqual({ x: 0, z: 6.35 });
  });

  it('2 至 20 个房间的石台不相交', () => {
    for (let n = 2; n <= 20; n++) {
      const ids = Array.from({ length: n }, (_, i) => `R${i + 1}`);
      const anchors = Array.from(createRuinsMap(ids).rooms.values());
      for (const [i, a] of anchors.entries()) {
        for (const b of anchors.slice(i + 1)) {
          expect(Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z)).toBeGreaterThan(a.radius + b.radius);
        }
      }
    }
  });

  it('20 人同房各有泊位', () => {
    const map = createRuinsMap(Array.from({ length: 20 }, (_, i) => `zone-${i}`));
    const spawns = map.rooms.get('zone-0')!.spawns;
    expect(new Set(spawns.map(({ x, z }) => `${x},${z}`)).size).toBe(20);
    expect(spawns.every(p => Math.hypot(p.x, p.z) < TABLE.roomRadius)).toBe(true);
  });

  it('泊位不越出石台', () => {
    for (let total = 1; total <= 6; total++) {
      for (let i = 0; i < total; i++) {
        const s = roomSlot(i, total);
        expect(Math.hypot(s.x, s.z)).toBeLessThan(TABLE.roomRadius * 0.6);
      }
    }
  });

  it('成员稳定排序不随快照抖动', () => {
    const a = stableMembers([{ id: 'P3' }, { id: 'P1' }, { id: 'P2' }]);
    expect(a.map((m) => m.id)).toEqual(['P1', 'P2', 'P3']);
  });

  it('默认机位按画幅分支且始终俯瞰（y>0）', () => {
    const poses = [
      defaultPose(0.55, 4),   // 手机竖屏
      defaultPose(0.9, 4),    // 平板
      defaultPose(1.7, 4),    // 桌面
      defaultPose(2.16, 4),   // 手机横屏
      defaultPose(1.7, 8),    // 多房间
    ];
    for (const p of poses) {
      expect(p.height).toBeGreaterThan(6);
      expect(p.fov).toBeGreaterThan(40);
      const o = orbitPose(p, 0, 0.68, 1);
      expect(o.y).toBeGreaterThan(6);
      expect(o.z).toBeGreaterThan(4); // 机位在正前方
    }
  });
});

// ── 视觉元数据 ───────────────────────────────────────────────

describe('battle3d 视觉元数据', () => {
  it('每名注册角色都有专属视觉（不落到兜底也不重复撞色）', () => {
    for (const id of Object.keys(CHARACTERS)) {
      const v = charVisual(id);
      expect(CHAR_VISUALS[id]).toBeDefined();
      expect(v.color).not.toBe(0);
    }
  });

  it('R1~R6 房间图腾一一对应且互不重色', () => {
    const totems = new Set<string>();
    const colors = new Set<number>();
    for (let i = 1; i <= 6; i++) {
      const v = roomVisual(`R${i}`);
      totems.add(v.totem);
      colors.add(v.base);
      expect(ROOM_VISUALS[`R${i}`].icon.length).toBeGreaterThan(0);
    }
    expect(totems.size).toBe(6);
    expect(colors.size).toBe(6);
  });

  it('未知房间 id 有安全兜底', () => {
    const v = roomVisual('RX99');
    expect(v.totem).toBeDefined();
    expect(v.icon).toBe('◈');
  });
});

// ── 演出适配层 ───────────────────────────────────────────────

describe('WebGL 回退', () => {
  it('jsdom 无 WebGL → detectWebGL 为 false（自动回退 2D 牌桌）', () => {
    expect(detectWebGL()).toBe(false);
  });

  it('渲染器偏好可被查询参数/localStorage 覆盖', () => {
    expect(['3d', '2d']).toContain(preferredRenderer());
  });
});

// ── 上下文丢失会话级降级策略（Phase C / B-031 兜底） ─────────

describe('gl-policy 会话降级策略', () => {
  it('单次丢失不降级；累计达上限降级', () => {
    sessionStorage.clear();
    // 累计场景：间隔 >60s，不触发 rapid 窗口
    const v1 = recordContextLost(1000);
    expect(v1).toMatchObject({ count: 1, degrade: false, reason: '' });
    const v2 = recordContextLost(1000 + 70_000);
    expect(v2).toMatchObject({ count: 2, degrade: false, reason: '' });
    const v3 = recordContextLost(1000 + 140_000);
    expect(v3).toMatchObject({ count: 3, degrade: true, reason: 'total' });
    expect(isSessionDegraded()).toBe(true);
  });

  it('60s 窗口内连续两次丢失 → 立即降级（rapid）', () => {
    sessionStorage.clear();
    const v1 = recordContextLost(10_000);
    expect(v1.degrade).toBe(false);
    const v2 = recordContextLost(10_000 + 30_000); // 30s 后第二次
    expect(v2).toMatchObject({ count: 2, degrade: true, reason: 'rapid' });
    expect(isSessionDegraded()).toBe(true);
  });

  it('降级后再次记录保持 degrade 语义一致（不崩溃）', () => {
    sessionStorage.clear();
    // 累计 3 次（间隔 >60s 不触发 rapid）→ 降级
    recordContextLost(1000);
    recordContextLost(1000 + 70_000);
    recordContextLost(1000 + 140_000);
    expect(isSessionDegraded()).toBe(true);
    const v = recordContextLost(1000 + 210_000); // 已降级后继续记录：保持 degrade 语义
    expect(v.degrade).toBe(true);
    expect(v.count).toBeGreaterThanOrEqual(3);
  });

  it('清除降级标记后解除持久降级，但累计计数继续生效', () => {
    sessionStorage.clear();
    recordContextLost(1000);
    recordContextLost(1100); // rapid → 降级
    expect(isSessionDegraded()).toBe(true);
    clearSessionDegraded();
    expect(isSessionDegraded()).toBe(false);
    // 清除只解除标记；会话累计计数仍在 → 再丢一次达 3 次 → 再次降级（total）
    const v = recordContextLost(1000 + 70_000);
    expect(v).toMatchObject({ count: 3, degrade: true, reason: 'total' });
  });

  it('preferredRenderer 在会话降级时返回 2d（?r=3d 查询参数仍可临时强制）', () => {
    sessionStorage.clear();
    markSessionDegraded();
    expect(preferredRenderer()).toBe('2d');
    sessionStorage.clear();
  });
});

// ── GL 诊断日志（Phase A） ───────────────────────────────────

describe('gllog 诊断日志', () => {
  it('记录事件并携带回合/阶段上下文', () => {
    gllog.clear();
    gllog.setContext(() => ({ round: 3, phase: 'act' }));
    gllog.push('ctx-lost', { renderer: 'test' }, true);
    gllog.push('ctx-restored', { afterMs: 120 });
    const es = gllog.entries();
    expect(es).toHaveLength(2);
    expect(es[0]).toMatchObject({ ev: 'ctx-lost', round: 3, phase: 'act', info: { renderer: 'test' } });
    expect(es[1].info).toEqual({ afterMs: 120 });
    expect(es[0].t).toBeGreaterThan(0);
  });

  it('环形缓冲有上限（240 条），最旧被丢弃', () => {
    gllog.clear();
    gllog.setContext(() => ({ round: -1, phase: '' }));
    for (let i = 0; i < 300; i++) gllog.push('tick', { i });
    expect(gllog.entries().length).toBe(240);
    expect(gllog.entries()[0].info).toEqual({ i: 60 });
  });

  it('dump 输出可读文本（含事件名与回合）', () => {
    gllog.clear();
    gllog.setContext(() => ({ round: 2, phase: 'rps1' }));
    gllog.push('scene-init', { software: true });
    expect(gllog.dump()).toContain('scene-init');
    expect(gllog.dump()).toContain('r2');
    gllog.clear();
  });

  it('取证探针挂载到 window.__b3log', () => {
    expect(typeof (window as unknown as { __b3log?: { dump(): string } }).__b3log?.dump).toBe('function');
  });
});
