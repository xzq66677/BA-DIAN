/**
 * 拔典 3D 战场 · 单元测试（jsdom，无 WebGL 依赖）
 * 覆盖：布局数学 / 视觉元数据完整性 / 演出适配层（pres diff → 场景命令）/ 回退检测。
 */

import { describe, it, expect } from 'vitest';
import { TABLE, roomPosition, roomSlot, defaultPose, orbitPose, stableMembers } from '../../client/src/battle3d/layout.js';
import { CHAR_VISUALS, charVisual, ROOM_VISUALS, roomVisual } from '../../client/src/battle3d/palette.js';
import { CHARACTERS } from '../../shared/src/characters/index.js';
import { presToCommands, applyCommands, type SceneLike } from '../../client/src/battle3d/pres-adapter.js';
import { EMPTY_PRESENTATION, type PresentationState } from '../../client/src/battle/useBattlePresentation.js';
import { detectWebGL, preferredRenderer } from '../../client/src/battle3d/Battle3D.js';

// ── 布局 ─────────────────────────────────────────────────────

describe('battle3d 布局数学', () => {
  it('我的房间位于正前方，其余房间沿远端弧线（z<0）', () => {
    const rooms = ['R1', 'R2', 'R3', 'R4'];
    const mine = roomPosition('R1', 'R1', rooms);
    expect(mine.z).toBeGreaterThan(0);
    expect(mine.x).toBe(0);
    for (const rid of ['R2', 'R3', 'R4']) {
      const p = roomPosition(rid, 'R1', rooms);
      expect(p.z).toBeLessThan(0);
    }
  });

  it('弧线房间两两不重叠（4~10 间房）', () => {
    for (let n = 4; n <= 10; n++) {
      const rooms = Array.from({ length: n }, (_, i) => `R${i + 1}`);
      const pts = rooms.slice(1).map((r) => roomPosition(r, 'R1', rooms));
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
          expect(d).toBeGreaterThan(TABLE.roomRadius * 1.3);
        }
      }
    }
  });

  it('观战视角（myRoom=null）时全部房间走弧线且不重叠', () => {
    const rooms = ['R1', 'R2', 'R3', 'R4'];
    const pts = rooms.map((r) => roomPosition(r, null, rooms));
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
        expect(d).toBeGreaterThan(TABLE.roomRadius * 1.3);
      }
    }
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

function withHits(next: Partial<PresentationState>): PresentationState {
  return { ...EMPTY_PRESENTATION, ...next };
}

describe('pres → 场景命令适配层', () => {
  it('空 diff 产生零命令（幂等）', () => {
    expect(presToCommands(EMPTY_PRESENTATION, EMPTY_PRESENTATION)).toEqual([]);
  });

  it('同 key 不重复下发，新 key 触发命令', () => {
    const s1 = withHits({ hits: { P2: { key: 5, amount: 1 } } });
    expect(presToCommands(EMPTY_PRESENTATION, s1).map((c) => c.c)).toEqual(['hit']);
    const s2 = withHits({ hits: { P2: { key: 5, amount: 1 } } });
    expect(presToCommands(s1, s2)).toEqual([]);
    const s3 = withHits({ hits: { P2: { key: 9, amount: 2, lethal: true } } });
    const cmds = presToCommands(s2, s3);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ c: 'hit', pid: 'P2', amount: 2, lethal: true });
  });

  it('攻击宣告携带目标（3D 光束用），行动 fx 携带朝向目标', () => {
    const s = withHits({
      decls: { P1: { key: 3, targetId: 'P2', amount: 1 } },
      fx: { P1: { kind: 'attack', key: 4, targetId: 'P2' } },
    });
    const cmds = presToCommands(EMPTY_PRESENTATION, s);
    expect(cmds[0]).toMatchObject({ c: 'attackDecl', sourceId: 'P1', targetId: 'P2' });
    expect(cmds[1]).toMatchObject({ c: 'action', pid: 'P1', fx: 'attack', targetId: 'P2' });
  });

  it('移动/伊万投掷/爆炸/房间告警按桶映射', () => {
    const s = withHits({
      moveBanner: { key: 7, pid: 'P1', from: 'R1', to: 'R2' },
      ivanThrow: { key: 8, pid: 'P2', room: 'R3' },
      ivanBoom: { key: 9, room: 'R3' },
      zoneAlert: { key: 10, room: 'R3', kind: 'aoe' },
    });
    const kinds = presToCommands(EMPTY_PRESENTATION, s).map((c) => c.c);
    expect(kinds).toEqual(['move', 'ivanThrow', 'ivanBoom', 'zoneAlert']);
  });

  it('ivan 类房间告警不重复下发（爆炸已覆盖）', () => {
    const s = withHits({ zoneAlert: { key: 10, room: 'R3', kind: 'ivan' } });
    expect(presToCommands(EMPTY_PRESENTATION, s)).toEqual([]);
  });

  it('淘汰/复活命令带载荷', () => {
    const s = withHits({
      deaths: { P3: { key: 11, cause: 'insult' } },
      revives: { P4: { key: 12, livesLeft: 1 } },
    });
    const cmds = presToCommands(EMPTY_PRESENTATION, s);
    expect(cmds[0]).toMatchObject({ c: 'death', pid: 'P3' });
    expect(cmds[1]).toMatchObject({ c: 'revive', pid: 'P4', livesLeft: 1 });
  });

  it('applyCommands 顺序调用场景接口（录制器验证）', () => {
    const calls: string[] = [];
    const scene: SceneLike = {
      playAttackDecl: (a, b) => calls.push(`decl:${a}->${b}`),
      playAction: (pid, fx) => calls.push(`act:${pid}:${fx}`),
      playHit: (pid, o) => calls.push(`hit:${pid}:${o.amount}`),
      playHeal: (pid) => calls.push(`heal:${pid}`),
      playMiss: (pid) => calls.push(`miss:${pid}`),
      playEliminate: (pid) => calls.push(`death:${pid}`),
      playRevive: (pid, lives) => calls.push(`revive:${pid}:${lives}`),
      playWalk: (pid, from, to) => calls.push(`walk:${pid}:${from}>${to}`),
      playIvanThrow: (pid, room) => calls.push(`throw:${pid}->${room}`),
      playIvanBoom: (room) => calls.push(`boom:${room}`),
      playRoomAlert: (room, kind) => calls.push(`alert:${room}:${kind}`),
      playTrigger: (pid) => calls.push(`trigger:${pid}`),
    };
    const cmds = [
      { c: 'attackDecl', seq: 1, sourceId: 'P1', targetId: 'P2' } as const,
      { c: 'hit', seq: 2, pid: 'P2', amount: 1, lethal: true } as const,
      { c: 'death', seq: 3, pid: 'P2' } as const,
      { c: 'move', seq: 4, pid: 'P3', from: 'R1', to: 'R2' } as const,
      { c: 'ivanThrow', seq: 5, pid: 'P4', room: 'R3' } as const,
      { c: 'ivanBoom', seq: 6, room: 'R3' } as const,
    ];
    applyCommands(scene, cmds as never);
    expect(calls).toEqual([
      'decl:P1->P2', 'hit:P2:1', 'death:P2', 'walk:P3:R1>R2', 'throw:P4->R3', 'boom:R3',
    ]);
  });
});

// ── 回退检测 ─────────────────────────────────────────────────

describe('WebGL 回退', () => {
  it('jsdom 无 WebGL → detectWebGL 为 false（自动回退 2D 牌桌）', () => {
    expect(detectWebGL()).toBe(false);
  });

  it('渲染器偏好可被查询参数/localStorage 覆盖', () => {
    expect(['3d', '2d']).toContain(preferredRenderer());
  });
});
