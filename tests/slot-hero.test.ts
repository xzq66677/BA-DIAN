/**
 * 老虎机侠（Issue #72）规则回归
 *
 * 覆盖：抽奖花费与卷面、符号奖励表（金钱/攻击/炸弹/钥匙）、
 * 炸弹引信与跟随、扔炸弹、4 炸弹特殊能力、4 钥匙「废人弱」、
 * 钥匙封印、扔机与落地伤害、踹机、AI 决策。
 */

import { describe, it, expect } from 'vitest';
import { makeGame, playThrows, actQueue } from '../shared/src/testcases/helpers.js';
import type { Game } from '../shared/src/engine.js';
import { slotSymbolOf, slotHeroAi, type SlotState } from '../shared/src/characters/slot-hero.js';
import { sealedAction } from '../shared/src/effects.js';
import { addStatus } from '../shared/src/player-statuses.js';

const R = { A: 'rock', B: 'scissors' } as const;

function st(g: Game, pid = 'A'): SlotState {
  return g.charState(pid) as unknown as SlotState;
}

/** 固定随机流：让抽奖得到指定卷面 */
function forceDigits(g: Game, digits: number[]): void {
  const queue = [...digits];
  (g.rng as unknown as { int: (n: number) => number }).int = () => {
    const d = queue.shift();
    if (d === undefined) throw new Error('随机流已耗尽');
    return d;
  };
}

/** 让 A 赢下初次判定，进入行动阶段 */
function toAct(g: Game): void {
  playThrows(g, [R]);
  expect(g.phase).toBe('act');
  const cur = g.currentActor();
  expect(cur).toBe('A');
}

function spin(g: Game, type: 'slotSpin3' | 'slotSpin4'): { ok: boolean; error?: string } {
  const cur = g.currentActor()!;
  return g.submitAction(cur, { type });
}

/** 进入下一个回合的行动阶段（A 赢下判定） */
function nextAct(g: Game): void {
  playThrows(g, [R]);
  expect(g.phase).toBe('act');
  expect(g.currentActor()).toBe('A');
}

/** 推进若干个完整回合（A 每回合赢下判定，行动一律跳过） */
function advanceRounds(g: Game, n: number): void {
  for (let i = 0; i < n; i++) {
    if (g.phase === 'over') return;
    playThrows(g, [R]);
    actQueue(g, {});
  }
}

describe('老虎机侠 · 基础', () => {
  it('初始 4 血 / 0 攻击 / 5 块钱', () => {
    const g = makeGame([{ id: 'A', char: 'slot-hero' }, { id: 'B', char: 'default' }], 1);
    expect(g.players.A.maxHp).toBe(4);
    expect(g.players.A.hp).toBe(4);
    expect(g.charDef('A').attack).toBe(0);
    expect(st(g).money).toBe(5);
    expect(st(g).keys).toBe(0);
  });

  it('数字到符号的映射', () => {
    expect(slotSymbolOf(0)).toBe('key');
    expect(slotSymbolOf(1)).toBe('money');
    expect(slotSymbolOf(3)).toBe('money');
    expect(slotSymbolOf(4)).toBe('bomb');
    expect(slotSymbolOf(7)).toBe('bomb');
    expect(slotSymbolOf(8)).toBe('attack');
    expect(slotSymbolOf(9)).toBe('attack');
  });

  it('抽 4 格：扣 5 块、卷面公开、累计投入', () => {
    const g = makeGame([{ id: 'A', char: 'slot-hero' }, { id: 'B', char: 'default' }], 2);
    forceDigits(g, [1, 2, 0, 5]);
    toAct(g);
    expect(spin(g, 'slotSpin4').ok).toBe(true);
    const s = st(g);
    // 5 - 5 花掉 + 2 金钱奖励 = 2
    expect(s.money).toBe(2);
    expect(s.machine.invested).toBe(5);
    expect(s.reels).toEqual([1, 2, 0, 5]);
    expect(g.logs.find(log => log.data?.actionName === 'slotSpin4')?.data?.presentation)
      .toEqual({ reels: [1, 2, 0, 5], reelCount: 4 });
    const snap = g.snapshot() as unknown as { players: { id: string; char: { reels: number[] } }[] };
    expect(snap.players.find((p) => p.id === 'A')!.char.reels).toEqual([1, 2, 0, 5]);
  });

  it('钱不够时拒绝抽奖且不消耗行动', () => {
    const g = makeGame([{ id: 'A', char: 'slot-hero' }, { id: 'B', char: 'default' }], 3);
    st(g).money = 4;
    toAct(g);
    expect(g.snapshot().actionDisabledReasons).toMatchObject({
      slotSpin4: expect.stringContaining('钱不够'),
      slotKey: expect.stringContaining('没有钥匙'),
      slotThrowSmall: '手里没有小炸弹',
      slotThrowMachine: expect.stringContaining('余额需归零'),
      slotKick: '老虎机还没有落地',
    });
    expect(g.snapshot().actionDisabledReasons?.slotSpin3).toBeUndefined();
    const before = g.stats.A.actions;
    const r = spin(g, 'slotSpin4');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('钱不够');
    expect(g.stats.A.actions).toBe(before);
    expect(g.currentActor()).toBe('A');
    // 4 块够抽 3 格
    forceDigits(g, [0, 4, 9]);
    expect(spin(g, 'slotSpin3').ok).toBe(true);
    expect(g.logs.find(log => log.data?.actionName === 'slotSpin3')?.data?.presentation)
      .toEqual({ reels: [0, 4, 9], reelCount: 3 });
  });
});

describe('老虎机侠 · 奖励表', () => {
  const spinWith = (digits: number[], seed = 5): { g: Game; s: SlotState; drawRound: number } => {
    const g = makeGame([{ id: 'A', char: 'slot-hero' }, { id: 'B', char: 'default' }], seed);
    forceDigits(g, digits);
    toAct(g);
    const drawRound = g.roundNo;
    expect(spin(g, 'slotSpin4').ok).toBe(true);
    return { g, s: st(g), drawRound };
  };

  it('金钱 2/3/4 个 → +2 / +6 / +9999', () => {
    expect(spinWith([1, 2, 5, 6]).s.money).toBe(5 - 5 + 2);   // 2 money
    expect(spinWith([1, 2, 3, 9]).s.money).toBe(5 - 5 + 6);   // 3 money
    expect(spinWith([1, 2, 3, 1]).s.money).toBe(5 - 5 + 9999); // 4 money
  });

  it('攻击 2/3/4 个 → +1 / +3 / +999999（永久）', () => {
    expect(spinWith([9, 8, 1, 5]).s.attackBonus).toBe(1);
    expect(spinWith([9, 8, 9, 5]).s.attackBonus).toBe(3);
    expect(spinWith([9, 8, 9, 8]).s.attackBonus).toBe(999999);
  });

  it('炸弹 2 个 → 手持小炸弹（引信为抽出回合 +3）', () => {
    const { g, s, drawRound } = spinWith([4, 5, 1, 9]);
    expect(s.bombs.length).toBe(1);
    expect(s.bombs[0].kind).toBe('small');
    expect(s.bombs[0].at).toBe(drawRound + 3);
    expect(g.deferred.some((d) => d.kind === 'slot-hero-bomb')).toBe(true);
  });

  it('炸弹 3 个 → 手持大伊万', () => {
    const { s } = spinWith([4, 5, 6, 1]);
    expect(s.bombs[0].kind).toBe('ivan');
  });

  it('炸弹 4 个 → 永久解锁特殊大伊万，不进入手持', () => {
    const { s } = spinWith([4, 5, 6, 7]);
    expect(s.bigIvan).toBe(true);
    expect(s.bombs.length).toBe(0);
  });

  it('钥匙 3 个 → +3 把钥匙', () => {
    const { s } = spinWith([0, 0, 0, 5]);
    expect(s.keys).toBe(3);
  });

  it('钥匙 4 个 → 场上其他人变「废人弱」，不包括自己', () => {
    const { g, s } = spinWith([0, 0, 0, 0]);
    expect(g.players.A.statuses?.some((x) => x.kind === 'crippled') ?? false).toBe(false);
    expect(g.players.B.statuses?.some((x) => x.kind === 'crippled')).toBe(true);
    expect(s.keys).toBe(0);
  });
});

describe('老虎机侠 · 炸弹', () => {
  it('手持小炸弹：第 3 回合末在持有者房间爆炸，命中自己与其他玩家（3 伤）', () => {
    const g = makeGame([{ id: 'A', char: 'slot-hero' }, { id: 'B', char: 'default', hp: 50 }], 7);
    g.players.B.maxHp = 50;
    g.players.B.room = g.players.A.room; // 同房间：AOE 应当命中双方
    forceDigits(g, [4, 5, 1, 2]);
    toAct(g);
    expect(spin(g, 'slotSpin4').ok).toBe(true);
    expect(st(g).bombs[0].at).toBe(4);
    const room = g.players.A.room;
    expect(g.players.B.room).toBe(room);

    advanceRounds(g, 3); // 结束于第 4 回合末
    expect(st(g).bombs.length).toBe(0);
    expect(g.players.A.hp).toBe(1);   // 4 - 3，自伤
    expect(g.players.B.hp).toBe(47);  // 50 - 3
  });

  it('可以消耗行动把手持炸弹扔到别的房间（引信不重置）', () => {
    const g = makeGame([{ id: 'A', char: 'slot-hero' }, { id: 'B', char: 'default' }], 8);
    forceDigits(g, [4, 5, 1, 2]);
    toAct(g);
    expect(spin(g, 'slotSpin4').ok).toBe(true);
    const bomb = st(g).bombs[0];
    const at = bomb.at;
    nextAct(g); // 抽出炸弹的回合已结束，下一回合的行动阶段再扔
    const target = g.roomIds.find((r) => r !== g.players.A.room)!;
    expect(g.submitAction('A', { type: 'slotThrowSmall', room: target }).ok).toBe(true);
    expect(st(g).bombs[0].room).toBe(target);
    expect(st(g).bombs[0].at).toBe(at);
    nextAct(g);
    expect(g.snapshot().actionDisabledReasons?.slotThrowSmall).toBe('手里没有小炸弹');
    expect(g.submitAction('A', { type: 'slotThrowSmall', room: target }).ok).toBe(false);
  });

  it('4 炸弹能力：指定房间立刻 999999 AOE，且能炸到自己', () => {
    const g = makeGame([{ id: 'A', char: 'slot-hero' }, { id: 'B', char: 'default', hp: 20 }], 9);
    g.players.B.maxHp = 20;
    g.players.B.room = g.players.A.room;
    st(g).bigIvan = true;
    toAct(g);
    expect(g.submitAction('A', { type: 'slotBigIvan', room: g.players.A.room }).ok).toBe(true);
    expect(g.players.A.alive).toBe(false);
    expect(g.players.B.alive).toBe(false);
  });
});

describe('老虎机侠 · 废人弱与钥匙', () => {
  it('废人弱：初次判定判负即当回合自爆淘汰', () => {
    const g = makeGame([{ id: 'A', char: 'slot-hero' }, { id: 'B', char: 'default' }], 10);
    addStatus(g as never, 'B', { kind: 'crippled', label: '废人弱' });
    // B 出剪刀，A 出石头 → B 判负
    playThrows(g, [R]);
    expect(g.players.B.alive).toBe(false);
    expect(g.isOver()).toBe(true);
    expect(g.winner).toBe('A');
  });

  it('钥匙：封印任意一人除攻击外的一个行动', () => {
    const g = makeGame([{ id: 'A', char: 'slot-hero' }, { id: 'B', char: 'default' }], 11);
    st(g).keys = 2;
    toAct(g);
    const r = g.submitAction('A', { type: 'slotKey', targetId: 'B', params: { action: 'move' } });
    expect(r.ok).toBe(true);
    expect(st(g).keys).toBe(1);
    expect(sealedAction(g, 'B', 'move')?.action).toBe('move');
    // 攻击永远不可封印
    const bad = g.submitAction('A', { type: 'slotKey', targetId: 'B', params: { action: 'attack' } });
    expect(bad.ok).toBe(false);
  });

  it('没有钥匙时无法使用封印', () => {
    const g = makeGame([{ id: 'A', char: 'slot-hero' }, { id: 'B', char: 'default' }], 12);
    toAct(g);
    const r = g.submitAction('A', { type: 'slotKey', targetId: 'B', params: { action: 'move' } });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('没有钥匙');
  });
});

describe('老虎机侠 · 老虎机', () => {
  it('余额未归零不能扔机', () => {
    const g = makeGame([{ id: 'A', char: 'slot-hero' }, { id: 'B', char: 'default' }], 13);
    toAct(g);
    const r = g.submitAction('A', { type: 'slotThrowMachine', room: g.roomIds[1] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('归零');
  });

  it('扔机 → 第 3 回合末落地，造成累计投入伤害；落地前不能踹', () => {
    const g = makeGame([{ id: 'A', char: 'slot-hero' }, { id: 'B', char: 'default', hp: 50 }], 14);
    g.players.B.maxHp = 50;
    st(g).money = 0;
    st(g).machine.invested = 8;
    const target = g.roomIds.find((r) => r !== g.players.A.room)!;
    g.players.B.room = target;
    toAct(g);
    const throwRound = g.roundNo;
    expect(g.submitAction('A', { type: 'slotThrowMachine', room: target }).ok).toBe(true);
    expect(st(g).machine.thrown).toBe(true);
    expect(st(g).machine.at).toBe(throwRound + 3);
    // 未落地：踹机不可用
    advanceRounds(g, 3);
    expect(st(g).machine.landed).toBe(true);
    expect(g.players.B.hp).toBe(42); // 50 - 8
  });

  it('落地后同房间踹一脚 +1 块，不同房间不行', () => {
    const g = makeGame([{ id: 'A', char: 'slot-hero' }, { id: 'B', char: 'default' }], 15);
    const s = st(g);
    s.money = 0;
    s.machine = { room: g.players.A.room, thrown: true, landed: true, at: null, invested: 0 };
    toAct(g);
    expect(g.submitAction('A', { type: 'slotKick' }).ok).toBe(true);
    expect(st(g).money).toBe(1);

    // 换到别的房间后无法踹
    const g2 = makeGame([{ id: 'A', char: 'slot-hero' }, { id: 'B', char: 'default' }], 16);
    const s2 = st(g2);
    s2.money = 0;
    s2.machine = { room: g2.roomIds.find((r) => r !== g2.players.A.room) ?? g2.roomIds[0], thrown: true, landed: true, at: null, invested: 0 };
    toAct(g2);
    const bad = g2.submitAction('A', { type: 'slotKick' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('同房间');
  });

  it('扔出后必须与老虎机同房间才能抽奖', () => {
    const g = makeGame([{ id: 'A', char: 'slot-hero' }, { id: 'B', char: 'default' }], 17);
    const s = st(g);
    s.money = 5;
    s.machine = { room: g.roomIds.find((r) => r !== g.players.A.room) ?? g.roomIds[0], thrown: true, landed: true, at: null, invested: 0 };
    toAct(g);
    const r = spin(g, 'slotSpin4');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('同房间');
    g.players.A.room = s.machine.room!;
    expect(spin(g, 'slotSpin4').ok).toBe(true);
    expect(s.machine.invested).toBe(0);
  });
});

describe('老虎机侠 · AI', () => {
  const aiCtx = (g: Game) => ({
    game: g,
    difficulty: 'normal' as const,
    pid: 'A',
    me: g.players.A,
    st: g.charState('A'),
    members: g.roomMembers(g.players.A.room),
    alive: g.aliveIds(),
  });

  it('有钱先抽 4 格', () => {
    const g = makeGame([{ id: 'A', char: 'slot-hero' }, { id: 'B', char: 'default' }], 18);
    expect(slotHeroAi(aiCtx(g) as never)?.type).toBe('slotSpin4');
  });

  it('手里有炸弹就扔到人多的房间', () => {
    const g = makeGame([{ id: 'A', char: 'slot-hero' }, { id: 'B', char: 'default' }], 19);
    const s = st(g);
    s.money = 0;
    s.bombs.push({ id: 'b1', kind: 'small', at: g.roundNo + 3, room: null });
    const req = slotHeroAi(aiCtx(g) as never);
    expect(req?.type).toBe('slotThrowSmall');
    expect(req?.room).toBeTruthy();
  });

  it('没钱没炸弹 → 扔老虎机', () => {
    const g = makeGame([{ id: 'A', char: 'slot-hero' }, { id: 'B', char: 'default' }], 20);
    const s = st(g);
    s.money = 0;
    expect(slotHeroAi(aiCtx(g) as never)?.type).toBe('slotThrowMachine');
  });
});
