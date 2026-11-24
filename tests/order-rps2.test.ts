/**
 * 二次判定（行动排序）：玩家亲自出拳
 *
 * 规则（2026-11-21 改造）：
 *  - 初次判定的资格者 ≥2 时，进入 rps2 阶段，资格者**亲自出拳**逐子轮递归排序；
 *  - 输者整组先动、赢者整组靠后，同侧继续判定；平局（同拳 / 三人循环）同组重掷，不消耗回合；
 *  - **领域不参与二次判定**（平局就是平局）；
 *  - **大屁孩等角色的判定历史只记录回合判定（rps1）**，二次判定不写历史，因此暴走/自爆与排序无关；
 *  - 只有 1 名资格者时跳过排序直接行动（不额外出拳）。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Game } from '../shared/src/engine.js';
import { CHARACTERS } from '../shared/src/characters/index.js';
import { Room } from '../server/src/room.js';
import type { PlayerId, Throw } from '../shared/src/types.js';

function makeGame(players: { id: string; char?: string }[], seed = 1, mode: 'player' | 'serverRoll' = 'player'): Game {
  return new Game({
    seed,
    chars: CHARACTERS,
    rules: { secondJudgeMode: mode },
    players: players.map((p) => ({ id: p.id, name: p.id, charId: p.char ?? 'default', type: 'local' as const })),
  });
}

/** 提交一轮 rps1 出拳（全员存活者） */
function throwRound(game: Game, m: Record<string, Throw>): void {
  for (const pid of game.aliveIds()) if (m[pid]) game.submitThrow(pid, m[pid]);
}

/** 按当前排序子轮名单提交 */
function submitOrder(game: Game, m: Record<string, Throw>): void {
  for (const pid of game.currentOrderGroup()) {
    if (m[pid]) game.submitOrderThrow(pid, m[pid]);
  }
}

const rooms: Room[] = [];
afterEach(() => {
  for (const r of rooms.splice(0)) r.dispose();
});

describe('二次判定：资格者亲自出拳', () => {
  it('两名资格者：先进入 rps2，出拳后才按「输者先动」落成队列', () => {
    const g = makeGame([{ id: 'A' }, { id: 'B' }, { id: 'C' }]);
    throwRound(g, { A: 'rock', B: 'rock', C: 'scissors' });

    expect(g.phase).toBe('rps2');
    expect(g.currentOrderGroup().sort()).toEqual(['A', 'B']);
    expect(g.qualified.sort()).toEqual(['A', 'B']);
    expect(g.queue).toEqual([]); // 排序未完成，行动队列还没建立
    expect(g.snapshot().orderGroup).toEqual(expect.arrayContaining(['A', 'B']));

    submitOrder(g, { A: 'paper', B: 'rock' }); // A 胜 B 负 → B 先动

    expect(g.phase).toBe('act');
    expect(g.queue).toEqual(['B', 'A']);
    const rps2 = g.judgeRecords.filter((r) => r.stage === 'rps2');
    expect(rps2).toHaveLength(1);
    expect(rps2[0].outcome).toBe('resolved');
    expect(rps2[0].round).toBe(1);

    // 行动阶段仍能取到排序子轮的揭示（用于解释「为什么是 B 先动」）
    const snap = g.snapshot() as unknown as { orderReveal: { stage: string; outcome: string; winners: string[]; losers: string[] } | null };
    expect(snap.orderReveal?.stage).toBe('rps2');
    expect(snap.orderReveal?.outcome).toBe('resolved');
    expect(snap.orderReveal?.winners).toEqual(['A']);
    expect(snap.orderReveal?.losers).toEqual(['B']);
  });

  it('三名资格者：第一层分出「输组/赢组」后，第二层继续亲自出拳（递归）', () => {
    const g = makeGame([{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }]);
    throwRound(g, { A: 'rock', B: 'rock', C: 'rock', D: 'scissors' });
    expect(g.phase).toBe('rps2');
    expect(g.currentOrderGroup().sort()).toEqual(['A', 'B', 'C']);

    // C 单独成输组 → 直接确定在队首；A/B 赢组需要再掷一轮
    submitOrder(g, { A: 'rock', B: 'rock', C: 'scissors' });
    expect(g.phase).toBe('rps2');
    expect(g.snapshot().orderResult).toEqual(['C']);
    expect(g.currentOrderGroup().sort()).toEqual(['A', 'B']);
    expect(g.orderSub).toBe(1);

    submitOrder(g, { A: 'paper', B: 'rock' }); // A 胜 B 负 → B 先于 A
    expect(g.phase).toBe('act');
    expect(g.queue).toEqual(['C', 'B', 'A']);
    expect(g.judgeRecords.filter((r) => r.stage === 'rps2')).toHaveLength(2);
  });

  it('同拳平局：同组重掷，子轮 +1，不消耗回合', () => {
    const g = makeGame([{ id: 'A' }, { id: 'B' }, { id: 'C' }]);
    throwRound(g, { A: 'rock', B: 'rock', C: 'scissors' });
    const roundBefore = g.roundNo;

    submitOrder(g, { A: 'rock', B: 'rock' }); // 同拳平局
    expect(g.phase).toBe('rps2');
    expect(g.orderSub).toBe(1);
    expect(g.roundNo).toBe(roundBefore);
    expect(g.judgeRecords.filter((r) => r.stage === 'rps2')[0].outcome).toBe('alltie');
    expect(g.currentOrderGroup().sort()).toEqual(['A', 'B']);

    submitOrder(g, { A: 'rock', B: 'paper' }); // B 胜 A 负 → A 先
    expect(g.phase).toBe('act');
    expect(g.queue).toEqual(['A', 'B']);
  });

  it('三人循环：同组重掷，不产生胜者', () => {
    const g = makeGame([{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }]);
    throwRound(g, { A: 'rock', B: 'rock', C: 'rock', D: 'scissors' });

    submitOrder(g, { A: 'rock', B: 'scissors', C: 'paper' }); // 三拳齐全
    expect(g.phase).toBe('rps2');
    expect(g.judgeRecords.filter((r) => r.stage === 'rps2')[0].outcome).toBe('cycle');
    expect(g.snapshot().orderResult).toEqual([]);
    expect(g.currentOrderGroup().sort()).toEqual(['A', 'B', 'C']);
  });

  it('只有一名资格者：跳过排序，不进入 rps2、不产生排序记录', () => {
    const g = makeGame([{ id: 'A' }, { id: 'B' }]);
    throwRound(g, { A: 'rock', B: 'scissors' });
    expect(g.phase).toBe('act');
    expect(g.queue).toEqual(['A']);
    expect(g.judgeRecords.filter((r) => r.stage === 'rps2')).toHaveLength(0);
  });

  it('非本组玩家 / 重复提交 / 非法拳种都被拒绝', () => {
    const g = makeGame([{ id: 'A' }, { id: 'B' }, { id: 'C' }]);
    throwRound(g, { A: 'rock', B: 'rock', C: 'scissors' });

    expect(g.submitOrderThrow('C', 'rock').ok).toBe(false); // 未获资格，不在本组
    expect(g.submitOrderThrow('A', 'bomb' as Throw).ok).toBe(false); // 非法拳种
    expect(g.submitOrderThrow('A', 'rock').ok).toBe(true);
    expect(g.submitOrderThrow('A', 'paper').ok).toBe(false); // 本子轮重复提交
    expect(g.phase).toBe('rps2');
  });

  it('超时兜底：forceFillOrderThrows 补掷后完成排序', () => {
    const g = makeGame([{ id: 'A' }, { id: 'B' }, { id: 'C' }]);
    throwRound(g, { A: 'rock', B: 'rock', C: 'scissors' });
    g.forceFillOrderThrows();
    // 平局可能重掷，补掷到排序结束（最多 20 次防死循环）
    let guard = 0;
    while (g.phase === 'rps2' && guard++ < 20) g.forceFillOrderThrows();
    expect(g.phase).toBe('act');
    expect(g.queue.length).toBe(2);
    expect(g.logs.some((l) => l.text.includes('超时，系统代掷排序出拳'))).toBe(true);
  });
});

describe('二次判定：领域与角色判定历史不参与', () => {
  it('领域持有者平局不参与排序：同拳就是平局，同组重掷', () => {
    const g = makeGame([{ id: 'A', char: 'gojo' }, { id: 'B' }, { id: 'C' }]);
    g.openDomain('A'); // 五条悟领域
    expect(g.domainHolder).toBe('A');
    throwRound(g, { A: 'rock', B: 'rock', C: 'scissors' }); // A/B 获得资格

    submitOrder(g, { A: 'rock', B: 'rock' }); // 若领域生效应为 tieAct；二次判定不传领域，应 alltie
    const rps2 = g.judgeRecords.filter((r) => r.stage === 'rps2');
    expect(rps2).toHaveLength(1);
    expect(rps2[0].outcome).toBe('alltie');
    expect(rps2.some((r) => r.outcome === 'tieAct' || r.outcome === 'tieWin')).toBe(false);
    expect(g.phase).toBe('rps2');
    expect(g.orderSub).toBe(1);
  });

  it('大屁孩：二次判定不写判定历史，连续同拳也不会自爆', () => {
    const g = makeGame([{ id: 'A', char: 'dapihuai' }, { id: 'B' }, { id: 'C' }]);
    throwRound(g, { A: 'rock', B: 'rock', C: 'scissors' }); // A/B 获得资格
    expect(g.phase).toBe('rps2');
    const historyAfterRps1 = g.judgeHistory('A').length;
    expect(historyAfterRps1).toBe(1); // 只有回合判定那一步

    // 连续 4 次同拳平局：若 rps2 写历史，大屁孩早就「三连相同 → 自爆」了
    for (let i = 0; i < 4; i++) {
      submitOrder(g, { A: 'rock', B: 'rock' });
      expect(g.phase).toBe('rps2');
    }
    expect(g.judgeHistory('A').length).toBe(historyAfterRps1);
    expect(g.players.A.alive).toBe(true);
    expect(g.players.A.hp).toBe(g.players.A.maxHp);
    const rps2Logs = g.logs.filter((l) => l.text.includes('自爆') || l.text.includes('暴走'));
    expect(rps2Logs).toHaveLength(0);
  });
});

describe('二次判定：房间与服务端集成', () => {
  function makeRoom(names: string[], opts: { submitTimeoutMs?: number } = {}) {
    const room = new Room('R2', {
      submitTimeoutMs: opts.submitTimeoutMs ?? 0,
      turnTimeoutMs: 0,
    });
    const seats = names.map((n) => room.addSeat(n, 'default', 'human'));
    rooms.push(room);
    return { room, seats };
  }

  it('真人房间：rps1 后进入 rps2，提交排序出拳后才进入行动阶段', () => {
    const { room, seats } = makeRoom(['A', 'B', 'C']);
    room.start(21);
    const [a, b, c] = seats.map((s) => s.playerId);
    room.submitThrow(a, 'rock');
    room.submitThrow(b, 'rock');
    room.submitThrow(c, 'scissors');

    expect(room.game!.phase).toBe('rps2');
    expect(room.game!.snapshot().orderGroup).toEqual(expect.arrayContaining([a, b]));

    const r1 = room.submitThrow(a, 'paper'); // 同一入口按阶段路由
    expect(r1.ok).toBe(true);
    const r2 = room.submitThrow(b, 'rock');
    expect(r2.ok).toBe(true);
    expect(room.game!.phase).toBe('act');
    expect(room.game!.queue).toEqual([b, a]);
  });

  it('AI 房间：kickAI 自动补完 AI 的排序出拳，真人只需出自己那份', () => {
    const room = new Room('RA', { submitTimeoutMs: 0, turnTimeoutMs: 0 });
    rooms.push(room);
    const me = room.addSeat('我', 'default', 'human');
    room.addSeat('AI1', 'default', 'ai');
    room.addSeat('AI2', 'default', 'ai');
    room.start(22);

    // 反复驱动：rps1 真人出拳后，排序阶段的 AI 由 kickAI 即时补完
    let guard = 0;
    while (room.game!.phase !== 'act' && !room.game!.isOver() && guard++ < 40) {
      const g = room.game!;
      if (g.phase === 'rps1' && !g.submittedIds.includes(me.playerId)) {
        room.submitThrow(me.playerId, 'rock');
      } else if (g.phase === 'rps2' && g.currentOrderGroup().includes(me.playerId)) {
        room.submitThrow(me.playerId, 'rock');
      } else {
        break;
      }
    }
    expect(room.game!.isOver() || room.game!.phase === 'act').toBe(true);
  });

  it('两名真人：排序阶段超时由服务端代掷', async () => {
    const room = new Room('RT', { submitTimeoutMs: 40, turnTimeoutMs: 0 });
    rooms.push(room);
    const a = room.addSeat('A', 'default', 'human');
    const b = room.addSeat('B', 'default', 'human');
    const c = room.addSeat('C', 'default', 'human');
    room.start(23);
    room.submitThrow(a.playerId, 'rock');
    room.submitThrow(b.playerId, 'rock');
    room.submitThrow(c.playerId, 'scissors');
    expect(room.game!.phase).toBe('rps2');

    await new Promise<void>((r) => setTimeout(r, 260));
    expect(room.game!.phase === 'act' || room.game!.isOver()).toBe(true);
    expect(room.game!.logs.some((l) => l.text.includes('超时'))).toBe(true);
  });
});
