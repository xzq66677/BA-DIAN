/**
 * 终局判定回归：延迟事件与「只剩 1 人」
 *
 * 背景（2026-11-24）：五条悟领域改为「平局回合行动」后，AI 自动对局回归暴露了
 * 一个既有隐患——只剩 1 人时若场上还挂着已到期的大伊万，`checkWin` 会一直为
 * 「炸弹先结算、后判胜」让路，而平局回合又永远不会引爆它，于是对局无限打下去。
 * 现在只在**本回合已分出胜负**时让路：平局回合里的炸弹会顺延，终局判定正常执行。
 */

import { describe, it, expect } from 'vitest';
import { makeGame } from '../shared/src/testcases/helpers.js';

describe('终局：待引爆的大伊万不阻止「只剩 1 人」的终局', () => {
  it('最后一名幸存者在平局回合产生 → 直接获胜，待爆炸弹取消', () => {
    const g = makeGame([{ id: 'A', char: 'gojo' }, { id: 'B', char: 'default' }], 51);
    g.addDeferred({ kind: 'ivan', room: 'R1', explodeRound: 1, source: 'B', createdAtRound: 1 });
    expect(g.deferred.length).toBe(1);

    g.eliminate('B', 'test');

    expect(g.isOver()).toBe(true);
    expect(g.winner).toBe('A');
    expect(g.deferred.length).toBe(0); // 游戏结束后待爆事件被取消
  });

  it('平局回合里也不会因为炸弹而无限翻页', () => {
    const g = makeGame([{ id: 'A', char: 'gojo' }, { id: 'B', char: 'default' }], 52);
    g.addDeferred({ kind: 'ivan', room: 'R1', explodeRound: 1, source: 'B', createdAtRound: 1 });
    // 平局回合：无人获得资格，回合照常翻页（炸弹顺延）
    for (const pid of g.aliveIds()) g.submitThrow(pid, 'rock');
    expect(g.roundNo).toBe(2);
    expect(g.isOver()).toBe(false);

    // 最后一名幸存者出现后立刻终局，而不是继续空转
    g.eliminate('B', 'test');
    expect(g.isOver()).toBe(true);
    expect(g.winner).toBe('A');
  });
});
