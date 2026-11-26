/**
 * 佝偻弓箭手（Issue #71，本地实现）规则回归
 *
 * 覆盖：
 *  - 远程攻击 1 伤 + 点燃；燃烧 0.5/回合（含平局回合）、无限持续；
 *  - 点燃当回合与扑灭当回合不结算；
 *  - 骷髅身躯：非精神/非燃烧致死 → 倒地 1 回合（跳过行动、仍参与猜拳）→ 下一回合半血复原；
 *    燃烧致死彻底死亡；精神伤害正常死亡；燃烧期间其他伤害致死仍可复原；
 *  - 同房间燃烧敌人可引燃骷髅；
 *  - 同房间敌人取燃烧箭（2 次行动）→ 燃烧箭近战（1 伤 + 点燃）；取箭期间被弓箭手攻击会中断；
 *  - 快照只下发状态公开字段。
 */

import { describe, it, expect } from 'vitest';
import { Game } from '../shared/src/engine.js';
import { CHARACTERS } from '../shared/src/characters/index.js';
import type { Throw } from '../shared/src/types.js';

function makeGame(
  specs: { id: string; char?: string }[],
  seed = 11,
  rules?: Record<string, unknown>,
): Game {
  return new Game({
    seed,
    chars: CHARACTERS,
    ...(rules ? { rules: rules as never } : {}),
    players: specs.map((s) => ({ id: s.id, name: s.id, charId: s.char ?? 'default', type: 'local' as const })),
  });
}

function throws(g: Game, m: Record<string, Throw>): void {
  for (const pid of g.aliveIds()) if (m[pid]) g.submitThrow(pid, m[pid]);
}

/** 弓箭手远程点燃目标：A 先手，B 在另一房间 */
function igniteTarget(): Game {
  const g = makeGame([{ id: 'A', char: 'hunchback-archer' }, { id: 'B' }]);
  g.players.A.room = 'R1';
  g.players.B.room = 'R2';
  throws(g, { A: 'rock', B: 'scissors' }); // A 获得行动资格
  expect(g.phase).toBe('act');
  const r = g.submitAction('A', { type: 'attack', targetId: 'B' });
  expect(r.ok).toBe(true);
  return g;
}

describe('燃烧：点燃 / 每回合 0.5 / 扑灭', () => {
  it('远程攻击造成 1 伤并点燃；点燃当回合不结算', () => {
    const g = igniteTarget();
    expect(g.players.B.hp).toBe(1); // 默认角色 2 血，先吃 1 点攻击伤害
    expect(g.players.B.effects?.length).toBe(1);
    expect(g.players.B.effects?.[0]).toMatchObject({ kind: 'burning', severity: 0.5, remainingRounds: null });
    // 点燃当回合（第 1 回合）回合末不结算燃烧
    expect(g.roundNo).toBe(2);
    expect(g.players.B.hp).toBe(1);
  });

  it('下一回合结算 0.5；平局回合同样结算', () => {
    const g = igniteTarget();
    throws(g, { A: 'rock', B: 'rock' }); // 同拳平局 → 本回合无人行动，但燃烧照常结算
    expect(g.roundNo).toBe(3);
    expect(g.players.B.hp).toBe(0.5);
    throws(g, { A: 'rock', B: 'rock' });
    expect(g.players.B.hp).toBe(0);
    expect(g.players.B.alive).toBe(false); // 燃烧致死
  });

  it('消耗一次行动扑灭：扑灭当回合不结算', () => {
    const g = igniteTarget();
    throws(g, { B: 'rock', A: 'scissors' }); // B 获得行动资格
    expect(g.phase).toBe('act');
    const snap = g.snapshot() as unknown as { extraActions: { key: string }[] };
    expect(snap.extraActions.map((a) => a.key)).toContain('extinguish');
    const r = g.submitAction('B', { type: 'extinguish' });
    expect(r.ok).toBe(true);
    expect(g.players.B.effects ?? []).toHaveLength(0); // 状态已移除
    expect(g.roundNo).toBe(3);
    expect(g.players.B.hp).toBe(1); // 扑灭回合不结算
  });

  it('无限持续：不扑灭就每回合继续掉血', () => {
    const g = igniteTarget();
    throws(g, { A: 'rock', B: 'rock' });
    expect(g.players.B.hp).toBe(0.5);
    // 第 3 回合再平局 → 0
    throws(g, { A: 'paper', B: 'paper' });
    expect(g.players.B.hp).toBe(0);
    expect(g.players.B.alive).toBe(false);
  });
});

describe('骷髅身躯：倒地与复原', () => {
  it('非精神/非燃烧致死 → 倒地不死，仍参与猜拳，下一回合以半血复原', () => {
    const g = makeGame([{ id: 'A', char: 'hunchback-archer' }, { id: 'B' }]);
    g.players.A.hp = 1;
    // 伤害发生在出拳阶段（等价于回合前触发/延迟伤害）：倒地后仍可出拳
    g.applyDamage({ target: 'A', amount: 5, source: 'B', dtype: 'physical', tag: 'attack' });
    expect(g.players.A.alive).toBe(true); // 不会死亡
    expect(g.players.A.hp).toBe(0);
    expect(g.charState('A').downed).toBe(true);

    // 倒地状态下继续参与猜拳（平局回合同样计入）
    throws(g, { A: 'rock', B: 'rock' });
    expect(g.roundNo).toBe(2);
    expect(g.charState('A').downed).toBe(false);
    expect(g.players.A.hp).toBe(1.5); // 生命上限 3 的一半
  });

  it('倒地期间不能行动（行动被拒绝）', () => {
    const g = makeGame([{ id: 'A', char: 'hunchback-archer' }, { id: 'B' }]);
    g.players.A.room = 'R1';
    g.players.B.room = 'R1';
    g.players.A.hp = 1;
    throws(g, { A: 'rock', B: 'scissors' }); // A 获得行动资格并轮到它
    expect(g.phase).toBe('act');
    g.applyDamage({ target: 'A', amount: 5, source: 'B', dtype: 'physical', tag: 'attack' });
    expect(g.charState('A').downed).toBe(true);
    const r = g.submitAction('A', { type: 'skip' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain('无法行动');
  });

  it('精神攻击致死 → 正常死亡（不倒地）', () => {
    const g = makeGame([{ id: 'A', char: 'hunchback-archer' }, { id: 'B' }]);
    g.players.A.hp = 1;
    const applied = g.applyDamage({ target: 'A', amount: 5, source: 'B', dtype: 'mental', tag: 'berserk' });
    expect(applied.lethal).toBe(true);
    expect(g.players.A.alive).toBe(false);
  });

  it('燃烧致死 → 彻底死亡（不可复原）', () => {
    const g = makeGame([{ id: 'A', char: 'hunchback-archer' }, { id: 'B' }]);
    g.players.A.hp = 0.5;
    g.addStatus('A', {
      kind: 'burning', severity: 0.5, remainingRounds: null, source: 'B',
      appliedRound: g.roundNo - 1, // 上一回合点燃
    });
    throws(g, { A: 'rock', B: 'rock' }); // 平局回合末结算
    expect(g.players.A.hp).toBe(0);
    expect(g.players.A.alive).toBe(false);
  });

  it('燃烧期间被其他伤害打到 0 → 仍可复原', () => {
    const g = makeGame([{ id: 'A', char: 'hunchback-archer' }, { id: 'B' }]);
    g.players.A.hp = 1;
    g.addStatus('A', { kind: 'burning', severity: 0.5, remainingRounds: null, source: 'B', appliedRound: g.roundNo });
    g.applyDamage({ target: 'A', amount: 1, source: 'B', dtype: 'physical', tag: 'attack' });
    expect(g.players.A.alive).toBe(true);
    expect(g.charState('A').downed).toBe(true);
  });
});

describe('同房间反制：引燃骷髅 / 取燃烧箭', () => {
  it('同房间的燃烧敌人可消耗一次行动引燃骷髅', () => {
    const g = igniteTarget();
    g.players.B.room = g.players.A.room; // 走近弓箭手
    throws(g, { B: 'rock', A: 'scissors' });
    expect(g.phase).toBe('act');
    const snap = g.snapshot() as unknown as { extraActions: { key: string }[] };
    expect(snap.extraActions.map((a) => a.key)).toContain('igniteSkeleton');
    const r = g.submitAction('B', { type: 'igniteSkeleton', targetId: 'A' });
    expect(r.ok).toBe(true);
    expect(g.players.A.effects?.[0]).toMatchObject({ kind: 'burning', severity: 0.5 });
    // 引燃当回合不结算
    expect(g.players.A.hp).toBe(3);
  });

  it('取箭 2 次行动 → 燃烧箭近战（1 伤 + 点燃），并消耗箭', () => {
    const g = makeGame([{ id: 'A', char: 'hunchback-archer' }, { id: 'B' }]);
    g.players.A.room = 'R1';
    g.players.B.room = 'R1';

    // 第 1 回合：取箭（1/2）
    throws(g, { B: 'rock', A: 'scissors' });
    expect(g.submitAction('B', { type: 'takeArrow' }).ok).toBe(true);
    expect((g.charState('B').pendingArrow as { progress: number }).progress).toBe(1);

    // 第 2 回合：取箭（2/2）
    throws(g, { B: 'rock', A: 'scissors' });
    const snap2 = g.snapshot() as unknown as { extraActions: { key: string }[] };
    expect(snap2.extraActions.map((a) => a.key)).toContain('takeArrow');
    expect(g.submitAction('B', { type: 'takeArrow' }).ok).toBe(true);
    expect((g.charState('B').pendingArrow as { progress: number }).progress).toBe(2);

    // 第 3 回合：燃烧箭近战
    throws(g, { B: 'rock', A: 'scissors' });
    const snap3 = g.snapshot() as unknown as { extraActions: { key: string }[] };
    expect(snap3.extraActions.map((a) => a.key)).toContain('fireArrow');
    const before = g.players.A.hp;
    expect(g.submitAction('B', { type: 'fireArrow', targetId: 'A' }).ok).toBe(true);
    expect(g.players.A.hp).toBe(before - 1);
    expect(g.players.A.effects?.[0]).toMatchObject({ kind: 'burning' });
    expect(g.charState('B').pendingArrow).toBeNull();
  });

  it('取箭期间被弓箭手攻击 → 进度清零（中断）', () => {
    const g = makeGame([{ id: 'A', char: 'hunchback-archer' }, { id: 'B' }]);
    g.players.A.room = 'R1';
    g.players.B.room = 'R1';

    // 第 1 回合：B 取箭 1 次
    throws(g, { B: 'rock', A: 'scissors' });
    expect(g.submitAction('B', { type: 'takeArrow' }).ok).toBe(true);

    // 第 2 回合：A 先手，移动到另一个房间（远程需要异房间）
    throws(g, { A: 'rock', B: 'scissors' });
    expect(g.submitAction('A', { type: 'move', room: 'R2' }).ok).toBe(true);

    // 第 3 回合：A 远程攻击 B → 打断取箭
    throws(g, { A: 'rock', B: 'scissors' });
    expect(g.submitAction('A', { type: 'attack', targetId: 'B' }).ok).toBe(true);
    expect(g.charState('B').pendingArrow).toBeNull();
  });
});

describe('状态快照：只下发公开字段', () => {
  it('effects 含 kind/severity/remainingRounds/source，不含 appliedRound 等私有字段', () => {
    const g = igniteTarget();
    const snap = g.snapshot() as unknown as { players: { id: string; effects?: Record<string, unknown>[] }[] };
    const b = snap.players.find((p) => p.id === 'B')!;
    expect(b.effects?.[0]).toMatchObject({ kind: 'burning', severity: 0.5, remainingRounds: null, source: 'A' });
    expect(b.effects?.[0]).not.toHaveProperty('appliedRound');
    expect(JSON.stringify(b.effects)).not.toContain('appliedRound');
  });
});
