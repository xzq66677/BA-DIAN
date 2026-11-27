/**
 * 行动封印（钥匙类来源）回归测试
 *
 * 规则要点：
 *  - 封印在引擎「行动执行前」统一拦截，角色 / 地图行动不需要各自判断；
 *  - 攻击永远不可封印；
 *  - 超时兜底的强制跳过不受封印影响（否则对局可能无限等待）；
 *  - 封印随持有人退场清理，并通过快照公开（UI 置灰行动）。
 */

import { describe, it, expect } from 'vitest';
import { makeGame } from '../shared/src/testcases/helpers.js';
import { sealAction, sealableActions, sealedAction, clearActionLocks } from '../shared/src/effects.js';
import type { Game } from '../shared/src/engine.js';

function actPhaseGame(seed = 3): { g: Game; cur: string } {
  const g = makeGame([{ id: 'A', char: 'gojo' }, { id: 'B', char: 'gojo' }], seed);
  g.submitThrow('A', 'rock');
  g.submitThrow('B', 'scissors');
  expect(g.phase).toBe('act');
  const cur = g.currentActor();
  expect(cur).toBeTruthy();
  return { g, cur: cur! };
}

describe('行动封印', () => {
  it('封印后该行动被拒绝，且不消耗行动', () => {
    const { g, cur } = actPhaseGame();
    expect(sealAction(g, cur, 'move', 'A').ok).toBe(true);

    const before = g.stats[cur].actions;
    const res = g.submitAction(cur, { type: 'move', room: g.roomIds.find((r) => r !== g.players[cur].room)! });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('封印');
    expect(g.stats[cur].actions).toBe(before);
    expect(g.currentActor()).toBe(cur); // 行动未被消耗
  });

  it('攻击不可封印', () => {
    const { g, cur } = actPhaseGame();
    const res = sealAction(g, cur, 'attack', 'A');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('攻击');
    expect(sealedAction(g, cur, 'attack')).toBeUndefined();
  });

  it('角色专属技能可封印（五条悟领域）', () => {
    const { g, cur } = actPhaseGame();
    expect(sealableActions(g, cur).some((a) => a.action === 'domain')).toBe(true);
    expect(sealAction(g, cur, 'domain', 'A').ok).toBe(true);
    const res = g.submitAction(cur, { type: 'domain' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('领域');
  });

  it('重复封印同一行动被拒绝', () => {
    const { g, cur } = actPhaseGame();
    expect(sealAction(g, cur, 'heal', 'A').ok).toBe(true);
    const again = sealAction(g, cur, 'heal', 'A');
    expect(again.ok).toBe(false);
  });

  it('强制跳过（超时兜底）不受封印影响', () => {
    const { g, cur } = actPhaseGame();
    expect(sealAction(g, cur, 'skip', 'A').ok).toBe(true);
    expect(g.submitAction(cur, { type: 'skip' }).ok).toBe(false);
    expect(g.forceSkipAction(cur).ok).toBe(true);
  });

  it('封印随持有者退场清理', () => {
    // 用无命数的默认角色：一次致死即退场（五条悟会消耗命数复活，封印应当保留）
    const g = makeGame([{ id: 'A', char: 'default' }, { id: 'B', char: 'default' }], 11);
    g.submitThrow('A', 'rock');
    g.submitThrow('B', 'scissors');
    expect(g.phase).toBe('act');
    const cur = g.currentActor()!;
    expect(sealAction(g, cur, 'move', 'A').ok).toBe(true);
    expect(g.players[cur].actionLocks?.length).toBe(1);
    g.eliminate(cur, 'test');
    expect(g.players[cur].actionLocks?.length).toBe(0);
  });

  it('消耗命数复活时封印保留', () => {
    const { g, cur } = actPhaseGame();
    expect(sealAction(g, cur, 'move', 'A').ok).toBe(true);
    g.eliminate(cur, 'test');
    expect(g.players[cur].alive).toBe(true);
    expect(g.players[cur].actionLocks?.length).toBe(1);
  });

  it('快照公开封印信息', () => {
    const { g, cur } = actPhaseGame();
    expect(sealAction(g, cur, 'milk', 'A').ok).toBe(true);
    const snap = g.snapshot() as unknown as { players: { id: string; actionLocks?: { action: string; label: string }[] }[] };
    const me = snap.players.find((p) => p.id === cur)!;
    expect(me.actionLocks?.map((l) => l.action)).toEqual(['milk']);
    expect(me.actionLocks?.[0].label).toBe('喝牛奶');
  });

  it('不可封印清单不包含攻击，且随规则开关变化', () => {
    const g = makeGame([{ id: 'A', char: 'default' }, { id: 'B', char: 'default' }], 9, {
      allowHide: false, allowSeek: false, allowSkip: false,
    });
    const list = sealableActions(g, 'A').map((a) => a.action);
    expect(list).not.toContain('attack');
    expect(list).not.toContain('hide');
    expect(list).not.toContain('seek');
    expect(list).not.toContain('skip');
    expect(list).toContain('move');
    expect(list).toContain('heal');
  });

  it('清理后行动恢复可用', () => {
    const { g, cur } = actPhaseGame();
    expect(sealAction(g, cur, 'heal', 'A').ok).toBe(true);
    clearActionLocks(g, cur);
    expect(g.submitAction(cur, { type: 'heal' }).ok).toBe(true);
  });
});
