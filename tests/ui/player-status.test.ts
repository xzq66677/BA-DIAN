// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { SnapPlayer } from '../../shared/src/protocol.js';
import { PLAYER_STATUS_READERS, playerStatusItems } from '../../client/src/battle/status-readers.js';
import { formatHp } from '../../client/src/battle/status-types.js';

function player(overrides: Partial<SnapPlayer> = {}): SnapPlayer {
  return {
    id: 'A', name: 'A', charId: 'gojo', charName: '五条悟', hp: 2, maxHp: 3,
    room: 'R1', originRoom: 'R1', alive: true, type: 'human', hidden: false, invisible: false,
    char: {}, ...overrides,
  };
}

describe('角色公开状态', () => {
  it('格式化小数血量且只保留两位小数', () => {
    expect(formatHp(3)).toBe('3');
    expect(formatHp(1.234)).toBe('1.23');
  });

  it('汇总躲藏、领域、复活与攻击变化等公开状态', () => {
    const p = player({
      hidden: true,
      invisible: true,
      char: { domain: true, livesLeft: 2, attackOverride: 4.5, aim: 'B' },
    });
    const items = playerStatusItems(p, [player(), player({ id: 'B', name: '目标 B' })]);
    expect(items.map((item) => item.key)).toEqual(expect.arrayContaining([
      'alive', 'hidden', 'invisible', 'domain', 'lives', 'aim', 'attack-override',
    ]));
    expect(items.find((item) => item.key === 'aim')?.value).toBe('目标 B');
    expect(items.find((item) => item.key === 'attack-override')?.value).toBe('攻击力 4.5');
    expect(PLAYER_STATUS_READERS.length).toBeGreaterThan(0);
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
  });

  it('淘汰后不展示仅存活时生效的状态', () => {
    const items = playerStatusItems(player({ alive: false, hp: 0, hidden: true, char: { domain: true } }));
    expect(items.map((item) => item.key)).toEqual(['alive']);
    expect(items[0]).toMatchObject({ value: '已淘汰', tone: 'bad' });
  });

  it('不展示未揭示出拳或未知私有字段', () => {
    const items = playerStatusItems(player({ char: { history: ['rock', 'paper'], pendingThrow: 'scissors', secret: 42 } }));
    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain('rock');
    expect(serialized).not.toContain('paper');
    expect(serialized).not.toContain('scissors');
    expect(serialized).not.toContain('secret');
  });

  it('燃烧状态：展示每回合伤害与来源，忽略未知状态与私有字段', () => {
    const p = player({
      effects: [
        { kind: 'burning', severity: 0.5, remainingRounds: null, source: 'B' },
        { kind: 'unknown-future-status', severity: 3 },
      ],
    });
    const items = playerStatusItems(p, [player(), player({ id: 'B', name: '弓箭手 B' })]);
    const burning = items.find((item) => item.key === 'status-burning');
    expect(burning).toBeTruthy();
    expect(burning!.value).toBe('每回合 0.5 伤害');
    expect(burning!.detail).toContain('弓箭手 B');
    expect(burning!.tone).toBe('bad');
    // 未知状态安全忽略，且不泄漏未知 kind
    expect(JSON.stringify(items)).not.toContain('unknown-future-status');
  });

  it('淘汰后不展示燃烧等持续状态（死亡清理后的快照）', () => {
    const p = player({ alive: false, hp: 0, effects: [{ kind: 'burning', severity: 0.5 }] });
    const items = playerStatusItems(p);
    expect(items.map((item) => item.key)).toEqual(['alive']);
  });

  it('鬼影附身：展示被附身来源与附身中宿主', () => {
    const host = player({ effects: [{ kind: 'possessed', severity: 1, source: 'G' }] });
    const ghost = player({
      id: 'G', name: '鬼影', char: { possessing: 'A' },
      effects: [{ kind: 'possessing', severity: 0 }],
    });
    const hostItems = playerStatusItems(host, [host, ghost]);
    const possessed = hostItems.find((item) => item.key === 'status-possessed');
    expect(possessed).toBeTruthy();
    expect(possessed!.value).toBe('每回合 1 伤害');
    expect(possessed!.detail).toContain('鬼影');
    expect(possessed!.tone).toBe('bad');

    const ghostItems = playerStatusItems(ghost, [host, ghost]);
    const possessing = ghostItems.find((item) => item.key === 'status-possessing');
    expect(possessing).toBeTruthy();
    expect(possessing!.value).toBe('无法被锁定');
    expect(possessing!.detail).toContain('折磨');
  });

  it('骑乘中：展示剩余回合与攻击强化', () => {
    const p = player({ charId: 'wild-hunt', effects: [{ kind: 'mounted', severity: 0, remainingRounds: 2 }] });
    const items = playerStatusItems(p, [p]);
    const mounted = items.find((item) => item.key === 'status-mounted');
    expect(mounted).toBeTruthy();
    expect(mounted!.value).toContain('剩余 2 回合');
    expect(mounted!.detail).toContain('6 伤');
    expect(mounted!.tone).toBe('good');
  });
});
