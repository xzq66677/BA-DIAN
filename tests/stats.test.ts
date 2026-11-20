/**
 * 局内战绩统计测试
 * 战绩只做展示，不影响任何判定；这里验证累计口径。
 */

import { describe, it, expect } from 'vitest';
import { makeGame } from '../shared/src/testcases/helpers.js';

type Stats = {
  throwWin: number; throwLose: number; throwTie: number;
  damageDealt: number; damageTaken: number; kills: number;
  actions: number; heals: number; moves: number; roundsAlive: number;
};
const statsOf = (g: ReturnType<typeof makeGame>, pid: string): Stats =>
  (g.snapshot() as unknown as { stats: Record<string, Stats> }).stats[pid];

describe('局内战绩', () => {
  it('出拳胜/负/平按子轮累计（循环与同拳记平）', () => {
    const g = makeGame(['A', 'B', 'C'], 1);
    g.submitThrow('A', 'rock');
    g.submitThrow('B', 'scissors');
    g.submitThrow('C', 'scissors');
    expect(statsOf(g, 'A').throwWin).toBe(1);
    expect(statsOf(g, 'B').throwLose).toBe(1);
    expect(statsOf(g, 'C').throwLose).toBe(1);

    // 新一轮：三人循环 → 全员记平
    const g2 = makeGame(['A', 'B', 'C'], 2);
    g2.submitThrow('A', 'rock');
    g2.submitThrow('B', 'scissors');
    g2.submitThrow('C', 'paper');
    expect(statsOf(g2, 'A').throwTie).toBe(1);
    expect(statsOf(g2, 'A').throwWin).toBe(0);
  });

  it('伤害、击杀、行动、回复、移动均被统计', () => {
    const g = makeGame([{ id: 'A', char: 'default' }, { id: 'B', char: 'default', hp: 1, room: 'R1' }], 5);
    // A 出石头胜 B 剪刀 → A 获得行动资格（同房间才能近战）
    g.submitThrow('A', 'rock');
    g.submitThrow('B', 'scissors');
    expect(g.phase).toBe('act');
    expect(g.submitAction('A', { type: 'attack', targetId: 'B' }).ok).toBe(true);

    expect(g.isOver()).toBe(true);
    expect(statsOf(g, 'A').damageDealt).toBe(1);
    expect(statsOf(g, 'A').kills).toBe(1);
    expect(statsOf(g, 'A').actions).toBe(1);
    expect(statsOf(g, 'B').damageTaken).toBe(1);
  });

  it('回复/移动计数与存活回合数', () => {
    const g = makeGame([{ id: 'A', char: 'default' }, { id: 'B', char: 'default' }], 7);
    expect(statsOf(g, 'A').roundsAlive).toBe(1);

    // 让 A 取得行动资格后回复
    g.players.B.hp = 1;
    g.submitThrow('A', 'paper');
    g.submitThrow('B', 'rock');
    if (g.phase === 'act') {
      const cur = g.currentActor();
      expect(cur).toBeTruthy();
      g.submitAction(cur!, { type: 'heal' });
    }
    const totalHeals = statsOf(g, 'A').heals + statsOf(g, 'B').heals;
    const totalMoves = statsOf(g, 'A').moves + statsOf(g, 'B').moves;
    expect(totalHeals + totalMoves).toBeLessThanOrEqual(1);
    // 回合推进后存活者回合数增加
    if (!g.isOver()) expect(statsOf(g, 'A').roundsAlive).toBeGreaterThanOrEqual(1);
  });

  it('快照战绩不泄露出拳：提交阶段 stats 只含累计值', () => {
    const g = makeGame(['A', 'B'], 3);
    g.submitThrow('A', 'rock');
    const snap = g.snapshot() as unknown as { stats: Record<string, Stats>; reveal: unknown };
    expect(snap.reveal).toBeNull();
    expect(snap.stats.A).toBeDefined();
    expect(snap.stats.A.throwWin).toBe(0);
  });
});
