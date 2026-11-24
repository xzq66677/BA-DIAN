/**
 * 连判进度（judgeStreak）：公开快照回归
 *
 * 大屁孩的整套机制依赖「最近三次判定结果」，但完整判定历史不下发客户端；
 * 快照只暴露最近至多 3 条**已结算**结果，供行动坞展示「连判」进度。
 */

import { describe, it, expect } from 'vitest';
import { makeGame } from '../shared/src/testcases/helpers.js';
import { serializeSnapshot } from '../shared/src/snapshot.js';

describe('连判进度：公开快照', () => {
  it('按玩家下发最近判定结果，且不泄露未结算出拳', () => {
    const g = makeGame([{ id: 'P', char: 'dapihuai' }, 'A'], 901);
    g.judgeHistory('P').push('win', 'lose');
    const snap = serializeSnapshot(g);
    const p = snap.players.find((x) => x.id === 'P')!;
    expect(p.judgeStreak).toEqual(['win', 'lose']);
    const json = JSON.stringify(snap);
    expect(json).not.toContain('"rock"'); // 提交阶段不泄露拳种
    expect(json).not.toContain('"scissors"');
    expect(json).not.toContain('"paper"');
  });

  it('超过 3 条时只保留最近 3 条', () => {
    const g = makeGame([{ id: 'P', char: 'dapihuai' }, 'A'], 902);
    g.judgeHistory('P').push('win', 'win', 'tie', 'lose', 'win');
    const p = serializeSnapshot(g).players.find((x) => x.id === 'P')!;
    expect(p.judgeStreak).toEqual(['tie', 'lose', 'win']);
  });

  it('触发暴走后历史清零，进度随之清空', () => {
    const g = makeGame([{ id: 'P', char: 'dapihuai' }, 'A', 'B'], 903);
    g.judgeHistory('P').push('win', 'lose');
    for (const pid of g.aliveIds()) g.submitThrow(pid, 'rock'); // 三不同 → 暴走
    expect(g.logs.some((l) => l.text.includes('暴走'))).toBe(true);
    const p = serializeSnapshot(g).players.find((x) => x.id === 'P')!;
    expect(p.judgeStreak).toEqual([]);
  });
});
