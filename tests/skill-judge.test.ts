/**
 * 技能内判定「双方亲自出拳」（Issue #10，player 模式）
 *
 * 覆盖马保国三种能力：
 *  - 混元形意太极：受伤时暂停对局、双方各出一拳，赢则原伤反弹（伤害先挂起，判定后补结算）
 *  - 闪电五连鞭：5 局判定，按胜次造成目标**当前血量** 20/40/60/80/100% 的伤害（单次总量）
 *  - 不讲武德：被击杀后 5 局判定，赢 ≥3 局以**精神攻击**带走击杀者
 *
 * 另覆盖：出拳保密（提交阶段不下发拳种）、越权/重复提交拒绝、AI 代出、≥2 真人超时代掷，
 * 以及 serverRoll 兼容模式仍保持旧的即时结算行为。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Game } from '../shared/src/engine.js';
import { CHARACTERS } from '../shared/src/characters/index.js';
import { Room } from '../server/src/room.js';
import { makeGame } from '../shared/src/testcases/helpers.js';
import type { PlayerId, Throw, RuleConfig } from '../shared/src/types.js';

const PLAYER_RULES: Partial<RuleConfig> = { skillJudgeMode: 'player', secondJudgeMode: 'serverRoll' };

/** 造一局：指定角色，默认 player 模式技能判定 */
function game2(specs: { id: string; char?: string }[], seed = 7, rules: Partial<RuleConfig> = PLAYER_RULES): Game {
  return new Game({
    seed,
    chars: CHARACTERS,
    rules,
    players: specs.map((s) => ({ id: s.id, name: s.id, charId: s.char ?? 'default', type: 'local' as const })),
  });
}

/** 提交一轮 rps1 出拳 */
function throws(g: Game, m: Record<string, Throw>): void {
  for (const pid of g.aliveIds()) if (m[pid]) g.submitThrow(pid, m[pid]);
}

/** 让 A 拿到唯一行动资格（A 石头 / B 剪刀 → 只有 A 有资格，直接进入 act） */
function soloTurn(g: Game, a: PlayerId, b: PlayerId): void {
  throws(g, { [a]: 'rock', [b]: 'scissors' } as Record<string, Throw>);
}

/** 当前判定里给双方各出拳并推进：pairs 为每局的 [己方, 对手] 出拳 */
function driveJudge(g: Game, owner: PlayerId, opponent: PlayerId, rounds: Array<[Throw, Throw]>): void {
  for (const [own, opp] of rounds) {
    if (g.phase !== 'judge') break;
    g.submitJudgeThrow(owner, own);
    g.submitJudgeThrow(opponent, opp);
  }
}

const rooms: Room[] = [];
afterEach(() => {
  for (const r of rooms.splice(0)) r.dispose();
});

describe('闪电五连鞭：5 局亲自出拳 + 当前血量伤害', () => {
  it('进入 judge 阶段，双方各出 5 拳，按胜次 × 当前血量结算一次', () => {
    const g = game2([{ id: 'A', char: 'mabaoguo' }, { id: 'B' }]);
    g.players.B.room = g.players.A.room;
    g.players.B.maxHp = 3;
    g.players.B.hp = 3;
    soloTurn(g, 'A', 'B');
    expect(g.phase).toBe('act');

    const r = g.submitAction('A', { type: 'whip5', targetId: 'B' });
    expect(r.ok).toBe(true);
    expect(g.phase).toBe('judge');
    const view = g.skillJudgeView()!;
    expect(view.kind).toBe('whip5');
    expect(view.rounds).toBe(5);
    expect(view.round).toBe(1);
    expect(view.waitingIds.sort()).toEqual(['A', 'B']);

    // 提交阶段不泄露拳种
    const snap = g.snapshot() as unknown as { judge: { last: unknown } | null };
    expect(snap.judge?.last).toBeNull();

    // 5 局：A 全胜 → 伤害 = 5 × 20% × 当前血量(3) = 3
    driveJudge(g, 'A', 'B', [['rock', 'scissors'], ['rock', 'scissors'], ['rock', 'scissors'], ['rock', 'scissors'], ['rock', 'scissors']]);
    expect(g.players.B.hp).toBe(0);
    expect(g.players.B.alive).toBe(false);
    // 单次总量：只有一条带 whip 标签的伤害日志
    const whipDamageLogs = g.logs.filter((l) => l.type === 'damage' && l.data?.tag === 'whip');
    expect(whipDamageLogs).toHaveLength(1);
    expect(String(whipDamageLogs[0].data?.amount)).toBe('3');
  });

  it('伤害按「当前血量」而非最大血量（先扣血再打鞭）', () => {
    const g = game2([{ id: 'A', char: 'mabaoguo' }, { id: 'B' }]);
    g.players.B.room = g.players.A.room;
    g.players.B.hp = 1; // 当前血量 1 / 最大 3
    soloTurn(g, 'A', 'B');
    g.submitAction('A', { type: 'whip5', targetId: 'B' });
    // 2 胜 → 2 × 20% × 当前血量(1) = 0.4
    driveJudge(g, 'A', 'B', [['rock', 'scissors'], ['rock', 'scissors'], ['paper', 'scissors'], ['paper', 'scissors'], ['paper', 'scissors']]);
    const log = g.logs.filter((l) => l.type === 'damage' && l.data?.tag === 'whip').pop()!;
    expect(String(log.data?.amount)).toBe('0.4');
    expect(g.players.B.hp).toBeCloseTo(0.6, 4);
  });

  it('0 胜：只写日志、不产生伤害事件', () => {
    const g = game2([{ id: 'A', char: 'mabaoguo' }, { id: 'B' }]);
    g.players.B.room = g.players.A.room;
    soloTurn(g, 'A', 'B');
    g.submitAction('A', { type: 'whip5', targetId: 'B' });
    driveJudge(g, 'A', 'B', [['scissors', 'rock'], ['scissors', 'rock'], ['scissors', 'rock'], ['scissors', 'rock'], ['scissors', 'rock']]);
    expect(g.players.B.hp).toBe(g.players.B.maxHp);
    expect(g.logs.some((l) => l.text.includes('五连鞭 0/5 命中'))).toBe(true);
  });

  it('越权/重复提交被拒绝', () => {
    const g = game2([{ id: 'A', char: 'mabaoguo' }, { id: 'B' }, { id: 'C' }]);
    g.players.B.room = g.players.A.room;
    g.players.C.room = g.players.A.room;
    // A 石头胜 B/C 剪刀 → 只有 A 有行动资格
    throws(g, { A: 'rock', B: 'scissors', C: 'scissors' });
    expect(g.phase).toBe('act');
    g.submitAction('A', { type: 'whip5', targetId: 'B' });
    expect(g.phase).toBe('judge');
    expect(g.submitJudgeThrow('C', 'rock').ok).toBe(false); // 不在名单
    expect(g.submitJudgeThrow('A', 'bomb' as Throw).ok).toBe(false);
    expect(g.submitJudgeThrow('A', 'rock').ok).toBe(true);
    expect(g.submitJudgeThrow('A', 'paper').ok).toBe(false); // 同局重复
    expect(g.phase).toBe('judge');
    expect(g.skillJudgeView()!.waitingIds).toEqual(['B']);
  });
});

describe('混元形意太极：受伤时暂停、双方出拳、赢则反弹', () => {
  it('太极判定赢 → 原伤反弹给攻击者，马保国不掉血', () => {
    const g = game2([{ id: 'A' }, { id: 'B', char: 'mabaoguo' }]);
    g.players.A.room = g.players.B.room;
    g.players.A.maxHp = 3;
    g.players.A.hp = 3;
    soloTurn(g, 'A', 'B');
    // A 攻击 B（马保国）→ 伤害进入判定，对局暂停
    const r = g.submitAction('A', { type: 'attack', targetId: 'B' });
    expect(r.ok).toBe(true);
    expect(g.phase).toBe('judge');
    expect(g.skillJudgeView()!.kind).toBe('taiji');
    expect(g.skillJudgeView()!.rounds).toBe(1);
    expect(g.players.B.hp).toBe(4); // 判定前不扣血

    // 双方各出一拳：B 石头 / A 剪刀 → B 胜 → 反弹 1 点给 A
    driveJudge(g, 'B', 'A', [['rock', 'scissors']]);
    expect(g.players.B.hp).toBe(4);
    expect(g.players.A.hp).toBe(2); // 3 - 1
  });

  it('太极判定输 → 伤害正常落在马保国身上', () => {
    const g = game2([{ id: 'A' }, { id: 'B', char: 'mabaoguo' }]);
    g.players.A.room = g.players.B.room;
    g.players.A.maxHp = 3;
    g.players.A.hp = 3;
    soloTurn(g, 'A', 'B');
    g.submitAction('A', { type: 'attack', targetId: 'B' });
    expect(g.phase).toBe('judge');
    driveJudge(g, 'B', 'A', [['scissors', 'rock']]); // B 输
    expect(g.players.B.hp).toBe(3);
    expect(g.players.A.hp).toBe(3);
    expect(g.logs.some((l) => l.text.includes('太极判定未成功'))).toBe(true);
  });

  it('平局不反弹（不算赢）', () => {
    const g = game2([{ id: 'A' }, { id: 'B', char: 'mabaoguo' }]);
    g.players.A.room = g.players.B.room;
    g.players.A.maxHp = 3;
    g.players.A.hp = 3;
    soloTurn(g, 'A', 'B');
    g.submitAction('A', { type: 'attack', targetId: 'B' });
    driveJudge(g, 'B', 'A', [['paper', 'paper']]);
    expect(g.players.B.hp).toBe(3);
    expect(g.players.A.hp).toBe(3);
  });
});

describe('不讲武德：死后 5 局、精神攻击带走击杀者', () => {
  it('赢 ≥3 局 → 击杀者受到精神伤害死亡', () => {
    const g = game2([{ id: 'A' }, { id: 'B', char: 'mabaoguo' }]);
    g.players.A.room = g.players.B.room;
    g.players.A.maxHp = 3;
    g.players.A.hp = 3;
    g.players.B.hp = 1;
    soloTurn(g, 'A', 'B');
    g.submitAction('A', { type: 'attack', targetId: 'B' });
    // 第一段：太极判定 —— B 故意输，伤害落地后马保国死亡
    expect(g.phase).toBe('judge');
    expect(g.skillJudgeView()!.kind).toBe('taiji');
    driveJudge(g, 'B', 'A', [['scissors', 'rock']]);
    expect(g.players.B.alive).toBe(false);
    // 第二段：不讲武德 5 局（死者仍可出拳）
    expect(g.phase).toBe('judge');
    expect(g.skillJudgeView()!.kind).toBe('bujiangwude');
    expect(g.skillJudgeView()!.rounds).toBe(5);

    driveJudge(g, 'B', 'A', [
      ['rock', 'scissors'], ['rock', 'scissors'], ['rock', 'scissors'],
      ['paper', 'scissors'], ['paper', 'scissors'],
    ]);
    expect(g.players.A.alive).toBe(false);
    const mental = g.logs.filter((l) => l.type === 'damage' && l.data?.tag === 'bujiangwude');
    expect(mental).toHaveLength(1);
    expect(String(mental[0].data?.dtype)).toBe('mental');
    expect(g.phase).toBe('over'); // 双方死亡 → 平局终局
    expect(g.winner).toBeNull();
  });

  it('赢 <3 局 → 击杀者存活', () => {
    const g = game2([{ id: 'A' }, { id: 'B', char: 'mabaoguo' }]);
    g.players.A.room = g.players.B.room;
    g.players.A.maxHp = 3;
    g.players.A.hp = 3;
    g.players.B.hp = 1;
    soloTurn(g, 'A', 'B');
    g.submitAction('A', { type: 'attack', targetId: 'B' });
    driveJudge(g, 'B', 'A', [['scissors', 'rock']]); // 太极输 → B 死
    expect(g.players.B.alive).toBe(false);
    driveJudge(g, 'B', 'A', [['rock', 'scissors'], ['rock', 'scissors'], ['paper', 'paper'], ['paper', 'paper'], ['paper', 'paper']]);
    expect(g.players.A.alive).toBe(true);
    expect(g.logs.some((l) => l.text.includes('不讲武德失败'))).toBe(true);
  });
});

describe('兼容：serverRoll 模式下仍是即时结算（无 judge 阶段）', () => {
  it('五连鞭立即扣血、不进入 judge', () => {
    const g = makeGame([{ id: 'A', char: 'mabaoguo' }, 'B'], 11); // helpers 默认 serverRoll
    g.players.B.room = g.players.A.room;
    soloTurn(g, 'A', 'B');
    g.submitAction('A', { type: 'whip5', targetId: 'B' });
    expect(g.phase).not.toBe('judge');
    expect(g.logs.some((l) => l.text.includes('五连鞭命中') || l.text.includes('五连鞭 0/5'))).toBe(true);
  });
});

describe('房间层：AI 代出与真人超时', () => {
  function makeRoom(opts: { submitTimeoutMs?: number } = {}) {
    const room = new Room('SJ', { submitTimeoutMs: opts.submitTimeoutMs ?? 0, turnTimeoutMs: 0 });
    rooms.push(room);
    return room;
  }

  it('AI 马保国由服务端即时代出，真人只需出自己的拳', () => {
    const room = makeRoom();
    const me = room.addSeat('我', 'default', 'human');
    const ai = room.addSeat('AI马', 'mabaoguo', 'ai');
    room.start(31);
    // 直到拿到行动权：出拳阶段真人补拳；进入 act 且轮到我 → 攻击 AI 马保国
    let guard = 0;
    while (!room.game!.isOver() && guard++ < 40) {
      const g = room.game!;
      if (g.phase === 'rps1' && !g.submittedIds.includes(me.playerId)) {
        room.submitThrow(me.playerId, 'rock');
      } else if (g.phase === 'act' && g.currentActor() === me.playerId) {
        const b = room.game!.players[ai.playerId];
        b.room = g.players[me.playerId].room;
        room.submitAction(me.playerId, { type: 'attack', targetId: ai.playerId });
        // AI 份已由 kickAI 代出，真人出自己那份
        const view = g.skillJudgeView();
        if (!view) continue;
        if (view.waitingIds.includes(me.playerId)) {
          g.submitJudgeThrow(me.playerId, 'rock');
        }
      } else if (g.phase === 'judge') {
        const view = g.skillJudgeView()!;
        if (view.waitingIds.includes(me.playerId)) g.submitJudgeThrow(me.playerId, 'rock');
        else break; // 只等 AI → kickAI 会处理，交给下一次循环
      } else {
        break;
      }
    }
    // 关键断言：AI 的马保国判定不会把对局卡死在 judge（要么推进，要么终局）
    expect(room.game!.phase).not.toBe('judge');
  });

  it('两名真人：判定出拳超时由服务端代掷', async () => {
    const room = makeRoom({ submitTimeoutMs: 40 });
    const a = room.addSeat('A', 'default', 'human');
    const b = room.addSeat('B', 'mabaoguo', 'human');
    room.start(32);
    room.submitThrow(a.playerId, 'rock');
    room.submitThrow(b.playerId, 'scissors');
    expect(room.game!.phase).toBe('act');
    room.game!.players[b.playerId].room = room.game!.players[a.playerId].room;
    room.submitAction(a.playerId, { type: 'attack', targetId: b.playerId });
    expect(room.game!.phase).toBe('judge');
    await new Promise<void>((r) => setTimeout(r, 300));
    expect(room.game!.phase).not.toBe('judge');
    expect(room.game!.logs.some((l) => l.text.includes('超时，系统代掷判定出拳'))).toBe(true);
  });
});
