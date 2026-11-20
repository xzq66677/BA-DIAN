/**
 * 出拳揭示（公平性）测试
 *
 * 需求：石头剪刀布的出拳结果，每个人都要能看到彼此出了什么（不破坏公平性）。
 *  - 提交阶段：快照里不得出现任何拳种（只暴露「谁已提交」）。
 *  - 判定结算后：快照 reveal 包含全部参与者的出拳与胜负归属。
 *  - 平局/循环重判：揭示的是上一子轮，新子轮提交期间不泄露新拳种。
 */

import { describe, it, expect } from 'vitest';
import { makeGame } from '../shared/src/testcases/helpers.js';

const snapOf = (g: ReturnType<typeof makeGame>) =>
  g.snapshot() as unknown as {
    phase: string;
    subRound: number;
    submittedIds: string[];
    reveal: { stage: string; sub: number; throws: Record<string, string>; outcome: string; winners: string[]; losers: string[] } | null;
  };

describe('出拳揭示：全员可见且不破坏公平性', () => {
  it('提交阶段不泄露任何拳种', () => {
    const g = makeGame(['A', 'B', 'C'], 1);
    g.submitThrow('A', 'rock');
    g.submitThrow('B', 'scissors');
    const snap = snapOf(g);
    expect(snap.reveal).toBeNull();
    expect(snap.submittedIds).toEqual(['A', 'B']);
    expect(snap.phase).toBe('rps1');
    // 快照里没有任何 pendingThrows 字段（隐藏提交）
    expect(Object.keys(snap as unknown as Record<string, unknown>)).not.toContain('pendingThrows');
    expect(JSON.stringify(snap.reveal)).toBe('null');
  });

  it('判定结算后全员都能看到彼此出拳与胜负', () => {
    const g = makeGame(['A', 'B', 'C'], 1);
    g.submitThrow('A', 'rock');
    g.submitThrow('B', 'scissors');
    g.submitThrow('C', 'scissors');
    const snap = snapOf(g);
    expect(snap.reveal).not.toBeNull();
    expect(snap.reveal!.stage).toBe('rps1');
    expect(snap.reveal!.throws).toEqual({ A: 'rock', B: 'scissors', C: 'scissors' });
    expect(snap.reveal!.outcome).toBe('resolved');
    expect(snap.reveal!.winners).toEqual(['A']);
    expect([...snap.reveal!.losers].sort()).toEqual(['B', 'C']);
    // 行动阶段仍保留本次揭示（方便所有人对照）
    expect(['act', 'over']).toContain(snap.phase);
    expect(snap.reveal!.throws.A).toBe('rock');
  });

  it('三人循环：揭示上一子轮，重新出拳期间不泄露新拳种', () => {
    const g = makeGame(['A', 'B', 'C'], 1);
    g.submitThrow('A', 'rock');
    g.submitThrow('B', 'scissors');
    g.submitThrow('C', 'paper');
    const s1 = snapOf(g);
    expect(s1.reveal!.outcome).toBe('cycle');
    expect(s1.reveal!.sub).toBe(1);
    expect(s1.reveal!.throws).toEqual({ A: 'rock', B: 'scissors', C: 'paper' });
    expect(s1.phase).toBe('rps1');
    expect(s1.subRound).toBe(2);

    // 子轮2：只有 A 提交，reveal 仍停留在子轮1（A 之前出的石头）
    g.submitThrow('A', 'scissors');
    const s2 = snapOf(g);
    expect(s2.reveal!.sub).toBe(1);
    expect(s2.reveal!.throws.A).toBe('rock');
    expect(s2.submittedIds).toEqual(['A']);
  });

  it('同拳平局重判：揭示仍公开且标记为 alltie', () => {
    const g = makeGame(['A', 'B'], 1);
    g.submitThrow('A', 'paper');
    g.submitThrow('B', 'paper');
    const snap = snapOf(g);
    expect(snap.reveal!.outcome).toBe('alltie');
    expect(snap.reveal!.throws).toEqual({ A: 'paper', B: 'paper' });
    expect(snap.subRound).toBe(2);
  });
});
