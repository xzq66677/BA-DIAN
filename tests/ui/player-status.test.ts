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
      char: { domain: true, boosted: true, livesLeft: 2, attackOverride: 4.5, aim: 'B' },
    });
    const items = playerStatusItems(p, [player(), player({ id: 'B', name: '目标 B' })]);
    expect(items.map((item) => item.key)).toEqual(expect.arrayContaining([
      'alive', 'hidden', 'invisible', 'domain', 'boosted', 'lives', 'aim', 'attack-override',
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
});
