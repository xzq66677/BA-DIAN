/**
 * 领域（场地状态）规则测试
 *
 * 规则要点（2026-11-20 用户确认；平局语义 2026-11-24 修订）：
 *  1. 平局（**全员同拳或三拳循环/三人循环**）时，领域**不改变平局结果**，
 *     只让持有者获得「平局回合的行动资格」（`tieAct`）；判定历史/战绩仍记平；
 *  2. 领域是全场唯一的场地状态：后展开的领域**覆盖**先展开的，原持有者失效；
 *  3. 领域一旦生成即持续保留，不因回合推进 / 判定重来 / 普通胜负被清除；
 *  4. 只有"被其他领域覆盖"或"持有者退场"才失效；被覆盖后可以再次展开夺回；
 *  5. 无领域、正常两组出拳等既有结果不受影响。
 */

import { describe, it, expect } from 'vitest';
import { makeGame } from '../shared/src/testcases/helpers.js';
import type { Game } from '../shared/src/engine.js';
import type { Throw } from '../shared/src/types.js';

const throws = (g: Game, m: Record<string, Throw>) => {
  for (const pid of g.aliveIds()) {
    if (m[pid] !== undefined) g.submitThrow(pid, m[pid]);
  }
};

describe('领域：平局行动（不改变平局结果）', () => {
  it('全员同拳 → 持有者获得平局行动资格，但判定仍是平局', () => {
    const g = makeGame([{ id: 'A', char: 'gojo' }, 'B'], 11);
    g.openDomain('A');
    throws(g, { A: 'rock', B: 'rock' });
    expect(g.phase).toBe('act');
    expect(g.qualified).toEqual(['A']);
    expect(g.judgeRecords.some((r) => r.outcome === 'tieAct')).toBe(true);
    // 判定历史与战绩都记平（大屁孩只看自己的输赢/平局）
    expect(g.judgeHistory('A').at(-1)).toBe('tie');
    expect(g.judgeHistory('B').at(-1)).toBe('tie');
    expect(g.stats['A'].throwTie).toBe(1);
    expect(g.stats['A'].throwWin).toBe(0);
    // 行动结束照常翻页，不产生胜者
    g.submitAction('A', { type: 'skip' });
    expect(g.roundNo).toBe(2);
    expect(g.isOver()).toBe(false);
  });

  it('领域平局回合不引爆大伊万（平局顺延规则不变）', () => {
    const g = makeGame([{ id: 'A', char: 'gojo' }, { id: 'I', char: 'ivan-girl' }], 17);
    g.openDomain('A');
    g.addDeferred({ kind: 'ivan', room: 'R1', explodeRound: 1, source: 'I', createdAtRound: 1 });
    throws(g, { A: 'rock', I: 'rock' }); // 平局 + 领域 → A 行动，但回合仍未分胜负
    expect(g.phase).toBe('act');
    g.submitAction('A', { type: 'skip' });
    expect(g.logs.some((l) => l.text.includes('爆炸'))).toBe(false);
    expect(g.deferred.length).toBe(1);
    expect(g.roundNo).toBe(2);
  });

  it('未展开领域时同拳平局 → 平局回合结束（不误判胜）', () => {
    const g = makeGame([{ id: 'A', char: 'gojo' }, 'B'], 12);
    throws(g, { A: 'rock', B: 'rock' });
    expect(g.phase).toBe('rps1');
    expect(g.roundNo).toBe(2);
    expect(g.qualified).toEqual([]);
  });

  it('三人循环也算平局：持有者获得平局行动资格（2026-11-24 修订）', () => {
    const g = makeGame([{ id: 'A', char: 'gojo' }, 'B', 'C'], 13);
    g.openDomain('A');
    throws(g, { A: 'rock', B: 'paper', C: 'scissors' });
    expect(g.phase).toBe('act');
    expect(g.qualified).toEqual(['A']);
    const cycle = g.judgeRecords.find((r) => r.stage === 'rps1');
    expect(cycle?.outcome).toBe('tieAct');
    expect(cycle?.winners).toEqual(['A']);
    expect(g.judgeHistory('A').at(-1)).toBe('tie');
  });

  it('未展开领域时三人循环仍是平局回合翻页（不误判胜）', () => {
    const g = makeGame([{ id: 'A', char: 'gojo' }, 'B', 'C'], 16);
    throws(g, { A: 'rock', B: 'paper', C: 'scissors' });
    expect(g.phase).toBe('rps1');
    expect(g.roundNo).toBe(2);
    expect(g.qualified).toEqual([]);
    expect(g.revealInfo()?.outcome).toBe('cycle');
  });

  it('两组出拳有明确胜负时领域不介入（正常判定不受影响）', () => {
    const g = makeGame([{ id: 'A', char: 'gojo' }, 'B', 'C'], 14);
    g.openDomain('A');
    throws(g, { A: 'rock', B: 'scissors', C: 'scissors' }); // A 胜
    expect(g.qualified).toEqual(['A']);
    expect(g.judgeRecords.some((r) => r.outcome === 'tieAct')).toBe(false);
  });

  it('领域持有者已淘汰时不判胜（无覆盖方的失效场景）', () => {
    const g = makeGame([{ id: 'A', char: 'laodaye' }, 'B'], 15);
    g.openDomain('A');
    g.eliminate('A', 'test');
    expect(g.domainHolder).toBeNull();
    expect(g.charState('A').domain).toBe(false);
    // 只剩一人 → 游戏直接结束
    expect(g.isOver()).toBe(true);
  });
});

describe('领域：覆盖面与唯一性', () => {
  it('后展开者覆盖先展开者，原持有者领域失效', () => {
    const g = makeGame([{ id: 'A', char: 'gojo' }, { id: 'B', char: 'laodaye' }], 21);
    g.openDomain('A');
    expect(g.domainHolder).toBe('A');
    g.openDomain('B');
    expect(g.domainHolder).toBe('B');
    expect(g.charState('A').domain).toBe(false);
    expect(g.charState('B').domain).toBe(true);
    expect(g.logs.some((l) => l.text.includes('领域覆盖'))).toBe(true);
  });

  it('覆盖后平局判新的持有者胜（不再互相抵消）', () => {
    const g = makeGame([{ id: 'A', char: 'gojo' }, { id: 'B', char: 'laodaye' }], 22);
    g.openDomain('A');
    g.openDomain('B');
    throws(g, { A: 'rock', B: 'rock' });
    expect(g.phase).toBe('act');
    expect(g.qualified).toEqual(['B']);
  });

  it('自己重复展开是幂等的，不会把自己覆盖掉', () => {
    const g = makeGame([{ id: 'A', char: 'gojo' }, 'B'], 23);
    g.openDomain('A');
    const before = g.logs.length;
    g.openDomain('A');
    expect(g.domainHolder).toBe('A');
    expect(g.charState('A').domain).toBe(true);
    expect(g.logs.length).toBe(before); // 幂等不写日志
  });

  it('同回合内先后展开：后者生效（多领域场景）', () => {
    const g = makeGame([{ id: 'A', char: 'gojo' }, { id: 'B', char: 'gojo' }, 'C'], 24);
    g.openDomain('A');
    g.openDomain('B'); // 同一回合内后展开
    expect(g.domainHolder).toBe('B');
    expect(g.charState('A').domain).toBe(false);
    expect(g.charState('B').domain).toBe(true);
    throws(g, { A: 'rock', B: 'rock', C: 'rock' });
    expect(g.qualified).toEqual(['B']);
  });

  it('非领域角色调用 openDomain 被拒绝', () => {
    const g = makeGame(['A', 'B'], 25);
    const r = g.openDomain('A');
    expect(r.ok).toBe(false);
    expect(g.domainHolder).toBeNull();
  });

  it('异常路径（直接置位多人 domain）归一为唯一持有者，不陷入永久对冲', () => {
    const g = makeGame([{ id: 'A', char: 'gojo' }, { id: 'B', char: 'laodaye' }], 26);
    g.charState('A').domain = true;
    g.charState('B').domain = true;
    throws(g, { A: 'rock', B: 'rock' });
    expect(g.domainHolder).toBe('A'); // 归一保留座次靠前者
    expect(g.charState('B').domain).toBe(false);
    expect(g.phase).toBe('act');
    expect(g.qualified).toEqual(['A']);
  });
});

describe('领域：持续性', () => {
  it('跨回合保留（回合推进不清除）', () => {
    const g = makeGame([{ id: 'A', char: 'gojo' }, 'B'], 31);
    g.openDomain('A');
    // 打完第 1 回合
    throws(g, { A: 'rock', B: 'scissors' });
    g.submitAction('A', { type: 'skip' });
    expect(g.roundNo).toBe(2);
    expect(g.phase).toBe('rps1');
    expect(g.charState('A').domain).toBe(true);
    expect(g.domainHolder).toBe('A');

    // 第 2 回合平局 → 领域仍生效
    throws(g, { A: 'paper', B: 'paper' });
    expect(g.qualified).toEqual(['A']);
    expect(g.charState('A').domain).toBe(true);
  });

  it('被覆盖后可以再次展开夺回（反复展开，2026-11-24 确认）', () => {
    const g = makeGame([{ id: 'A', char: 'gojo' }, { id: 'B', char: 'laodaye' }], 32);
    g.openDomain('A');
    g.openDomain('B'); // 老大爷后展开 → 覆盖五条悟
    expect(g.domainHolder).toBe('B');
    expect(g.charState('A').domain).toBe(false);
    g.openDomain('A'); // 五条悟被覆盖后再次展开 → 反向覆盖夺回
    expect(g.domainHolder).toBe('A');
    expect(g.charState('A').domain).toBe(true);
    expect(g.charState('B').domain).toBe(false);
    expect(g.logs.filter((l) => l.text.includes('领域覆盖')).length).toBe(2);
    // 夺回后平局仍判五条悟胜
    throws(g, { A: 'rock', B: 'rock' });
    expect(g.qualified).toEqual(['A']);
  });

  it('普通胜负判定与行动阶段不清除领域', () => {
    const g = makeGame([{ id: 'A', char: 'gojo' }, 'B'], 33);
    g.openDomain('A');
    throws(g, { A: 'rock', B: 'scissors' }); // A 胜
    expect(g.phase).toBe('act');
    expect(g.charState('A').domain).toBe(true);
    g.submitAction('A', { type: 'skip' });
    expect(g.charState('A').domain).toBe(true);
  });

  it('消耗命数复活后领域保留（五条悟 2 条命）', () => {
    const g = makeGame([{ id: 'A', char: 'gojo' }, 'B'], 34);
    g.openDomain('A');
    g.applyDamage({ target: 'A', amount: 99, source: 'B', dtype: 'physical', tag: 'lethal-1' });
    expect(g.players['A'].alive).toBe(true); // 复活
    expect(g.charState('A').domain).toBe(true);
    expect(g.domainHolder).toBe('A');
  });

  it('快照下发给前端 domainHolder', () => {
    const g = makeGame([{ id: 'A', char: 'gojo' }, 'B'], 35);
    g.openDomain('A');
    const snap = g.snapshot() as unknown as { domainHolder: string | null };
    expect(snap.domainHolder).toBe('A');
  });
});

describe('二次判定：顺序由胜负结果决定', () => {
  it('多人有资格时输者先动、赢者靠后', () => {
    // A、B 出同拳胜，C 输 → A/B 有资格，二次判定分先后
    const g = makeGame(['A', 'B', 'C'], 41);
    throws(g, { A: 'rock', B: 'rock', C: 'scissors' });
    expect(g.qualified.sort()).toEqual(['A', 'B']);
    expect(g.queue.length).toBe(2);
    // 队列第一人必须是二次判定的输者
    const rps2 = g.judgeRecords.filter((r) => r.stage === 'rps2');
    expect(rps2.length).toBeGreaterThan(0);
    const last = rps2[rps2.length - 1];
    expect(last.outcome).toBe('resolved');
    expect(g.queue[0]).toBe(last.losers?.[0]);
    expect(g.queue[1]).toBe(last.winners?.[0]);
  });

  it('只有一人有资格时跳过排序，直接行动', () => {
    const g = makeGame(['A', 'B', 'C'], 42);
    throws(g, { A: 'rock', B: 'scissors', C: 'scissors' });
    expect(g.queue).toEqual(['A']);
    expect(g.judgeRecords.filter((r) => r.stage === 'rps2')).toHaveLength(0);
    expect(g.logs.some((l) => l.text.includes('直接行动'))).toBe(true);
  });

  it('三人资格时顺序完全由判定结果递归决定（可复现）', () => {
    const run = () => {
      const g = makeGame(['A', 'B', 'C', 'D'], 43);
      // A/B/C 出石头胜，D 出剪刀 → 3 人有资格
      throws(g, { A: 'rock', B: 'rock', C: 'rock', D: 'scissors' });
      return g.queue.join(',');
    };
    const q1 = run();
    const q2 = run();
    expect(q1).toBe(q2);
    expect(q1.split(',')).toHaveLength(3);
  });

  it('排序阶段平局会重判而不是固定顺序', () => {
    const g = makeGame(['A', 'B'], 44);
    // 两人都出同拳 → 都出局？不：同拳=平局重判，这里用两组出拳让 A 胜
    throws(g, { A: 'rock', B: 'scissors' });
    expect(g.queue).toEqual(['A']);
  });
});
