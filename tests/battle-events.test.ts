/**
 * 结构化战斗事件回归（任务书 §4.1 / §9.2）
 *
 * 演出层只信任日志的结构化 data 字段，不通过快照差分或文本猜测。
 * 本文件验证引擎对 每类事件 都产出完整、可演出、可安全降级的结构化数据：
 *   攻击宣告 → 实际扣血（amount/hpBefore/hpAfter/lethal）→ 行动 fx
 *   移动 from/to、回复、AOE 分组（groupId+segment）、延迟爆炸、
 *   致命衔接淘汰、反弹、未命中、命数复活。
 *
 * 注意：默认角色「无业游民」HP=2；三人出拳需避免构成三人循环。
 */

import { describe, it, expect } from 'vitest';
import { makeGame, playThrows, type PlayerSpec } from '../shared/src/testcases/helpers.js';
import type { LogEntry, DamageEventData, MoveEventData, HealEventData, EliminateEventData, ReviveEventData } from '../shared/src/types.js';

function spec(id: string, char: string, extra?: Partial<PlayerSpec>): PlayerSpec {
  return { id, char, ...extra };
}

/** 提交一轮出拳（避免三人循环的组合由用例自行保证） */
function toActionPhase(game: ReturnType<typeof makeGame>, throws: Record<string, 'rock' | 'scissors' | 'paper'>) {
  playThrows(game, [throws]);
}

function logsOf(game: ReturnType<typeof makeGame>, type: string): LogEntry[] {
  return game.logs.filter((l) => l.type === type);
}

function damageData(l: LogEntry): DamageEventData {
  return l.data as unknown as DamageEventData;
}

function realDamageLogs(game: ReturnType<typeof makeGame>): LogEntry[] {
  return game.logs.filter(realDamageLogsFilter);
}

describe('结构化事件：普通攻击链', () => {
  it('攻击产出 [宣告 → 扣血 → 行动fx] 三段日志，扣血带 amount/hpBefore/hpAfter', () => {
    const g = makeGame([spec('A', 'default', { hp: 3 }), spec('B', 'default', { hp: 3 })], 101);
    g.players.A.room = 'R1';
    g.players.B.room = 'R1';
    toActionPhase(g, { A: 'rock', B: 'scissors' });
    expect(g.phase).toBe('act');
    const r = g.submitAction('A', { type: 'attack', targetId: 'B' });
    expect(r.ok).toBe(true);

    const decl = g.logs.filter((l) => (l.data as unknown as { declared?: boolean })?.declared === true);
    expect(decl.length).toBe(1);
    const dd = realDamageLogs(g);
    expect(dd.length).toBe(1);
    const d = damageData(dd[0]);
    expect(d.target).toBe('B');
    expect(d.source).toBe('A');
    expect(d.amount).toBe(1);
    expect(d.hpBefore).toBe(3);
    expect(d.hpAfter).toBe(2);
    expect(d.lethal).toBe(false);
    expect(d.room).toBe('R1');

    const acts = logsOf(g, 'action');
    const last = acts[acts.length - 1];
    const ad = last.data as unknown as { pid: string; fx: string; label: string; targetId?: string };
    expect(ad.pid).toBe('A');
    expect(ad.fx).toBe('attack');
    expect(ad.targetId).toBe('B');
    // 顺序：宣告在前、扣血居中、行动 fx 收尾（演出分簇依据）
    expect(decl[0].seq).toBeLessThan(dd[0].seq);
    expect(dd[0].seq).toBeLessThan(last.seq);
  });

  it('致命伤害：lethal=true，随后 eliminate 事件带 pid/cause/killer', () => {
    const g = makeGame([spec('A', 'default', { hp: 3 }), spec('B', 'default', { hp: 1 })], 102);
    g.players.A.room = 'R1';
    g.players.B.room = 'R1';
    toActionPhase(g, { A: 'rock', B: 'scissors' });
    const r = g.submitAction('A', { type: 'attack', targetId: 'B' });
    expect(r.ok).toBe(true);
    expect(g.players.B.alive).toBe(false);

    const dd = realDamageLogs(g);
    const d = damageData(dd[dd.length - 1]);
    expect(d.lethal).toBe(true);
    expect(d.hpAfter).toBe(0);

    const elims = logsOf(g, 'eliminate');
    expect(elims.length).toBe(1);
    const ed = elims[0].data as unknown as EliminateEventData;
    expect(ed.pid).toBe('B');
    expect(ed.cause).toBe('damage');
    expect(ed.killer).toBe('A');
    // 致命伤害与淘汰衔接：damage.seq < eliminate.seq
    expect(dd[dd.length - 1].seq).toBeLessThan(elims[0].seq);
  });

  it('远程攻击：declared 带 ranged 标记，扣血事件同样结构化', () => {
    const g = makeGame([spec('A', 'chuixiao'), spec('B', 'default', { hp: 3 })], 103);
    toActionPhase(g, { A: 'rock', B: 'scissors' });
    const r = g.submitAction('A', { type: 'attack', targetId: 'B', ranged: true });
    expect(r.ok).toBe(true);
    const decl = g.logs.filter((l) => (l.data as unknown as { declared?: boolean })?.declared === true);
    const dr = decl[decl.length - 1].data as unknown as { ranged?: boolean; room?: string };
    expect(dr.ranged).toBe(true);
    expect(dr.room).toBe(g.players.B.room);
    const dd = realDamageLogs(g);
    expect(dd.length).toBe(1);
    expect(damageData(dd[0]).hpAfter).toBe(2);
  });
});

describe('结构化事件：移动与回复', () => {
  it('移动事件带 pid/from/to（演出据此播放路径反馈）', () => {
    const g = makeGame([spec('A', 'default'), spec('B', 'default')], 104);
    toActionPhase(g, { A: 'rock', B: 'scissors' });
    g.submitAction('A', { type: 'move', room: g.roomIds[1] });
    const moves = logsOf(g, 'move');
    expect(moves.length).toBe(1);
    const md = moves[0].data as unknown as MoveEventData;
    expect(md.pid).toBe('A');
    expect(md.from).toBe('R1');
    expect(md.to).toBe('R2');
  });

  it('基础回复行动：事件带 target/amount/hpBefore/hpAfter', () => {
    const g = makeGame([spec('A', 'default'), spec('B', 'default')], 105);
    g.players.A.hp = 1;
    toActionPhase(g, { A: 'rock', B: 'scissors' });
    g.submitAction('A', { type: 'heal' });
    const heals = logsOf(g, 'heal');
    expect(heals.length).toBe(1);
    const hd = heals[0].data as unknown as HealEventData;
    expect(hd.target).toBe('A');
    expect(hd.amount).toBe(1);
    expect(hd.hpBefore).toBe(1);
    expect(hd.hpAfter).toBe(2);
  });

  it('角色技能回复（engine.heal）同样产出结构化数据', () => {
    const g = makeGame([spec('A', 'default'), spec('B', 'default')], 106);
    g.players.B.hp = 1;
    g.heal('B', 1);
    const heals = logsOf(g, 'heal');
    const hd = heals[heals.length - 1].data as unknown as HealEventData;
    expect(hd.target).toBe('B');
    expect(hd.hpBefore).toBe(1);
    expect(hd.hpAfter).toBe(2);
  });
});

describe('结构化事件：AOE / 多段分组', () => {
  it('伍六七三刀：全部扣血事件共享 groupId 且段序完整', () => {
    // A、B 同房间；A 攻击指定房间（原地蓄力）→ 下一回合末三刀落下
    const g = makeGame([spec('A', 'wuliuqi'), spec('B', 'default', { hp: 3 })], 107);
    g.players.B.room = 'R1';
    toActionPhase(g, { A: 'rock', B: 'scissors' });
    expect(g.phase).toBe('act');
    const r = g.submitAction('A', { type: 'attack', room: 'R1' });
    expect(r.ok).toBe(true);
    playThrows(g, [{ A: 'rock', B: 'rock' }]); // 刀落回合（平局也落刀）

    const dd = realDamageLogs(g);
    // 3 段 × 房间内 1 名目标（不含自己）= 3 条
    expect(dd.length).toBe(3);
    const groups = new Set(dd.map((l) => damageData(l).groupId));
    expect(groups.size).toBe(1);
    const gid = [...groups][0]!;
    expect(gid).toMatch(/^GRP-/);
    expect(dd.map((l) => damageData(l).segment?.index)).toEqual([1, 2, 3]);
    expect(dd.every((l) => damageData(l).aoe === true)).toBe(true);
    expect(dd.every((l) => damageData(l).room === 'R1')).toBe(true);
  });

  it('伍六七三刀多目标：同组事件覆盖刀落瞬间房间内的目标（含段间死亡剔除）', () => {
    const g = makeGame([spec('A', 'wuliuqi'), spec('B', 'default', { hp: 2 }), spec('C', 'default', { hp: 2 })], 117);
    g.players.B.room = 'R1';
    g.players.C.room = 'R1';
    toActionPhase(g, { A: 'rock', B: 'scissors', C: 'scissors' });
    const r = g.submitAction('A', { type: 'attack', room: 'R1' });
    expect(r.ok).toBe(true);
    playThrows(g, [{ A: 'rock', B: 'rock', C: 'rock' }]); // 平局回合也落刀
    const dd = realDamageLogs(g);
    // B、C 各 HP2：第 2 段后 HP 归零淘汰，第 3 段跳过死者 → 2+2=4 条（A 不含自己）
    const targets = dd.map((l) => damageData(l).target);
    expect(targets.filter((t) => t === 'B').length).toBe(2);
    expect(targets.filter((t) => t === 'C').length).toBe(2);
    // 全部共享同一 groupId
    expect(new Set(dd.map((l) => damageData(l).groupId)).size).toBe(1);
  });

  it('大伊万爆炸：秒杀事件带 instakill/lethal 与共享 groupId', () => {
    const g = makeGame([spec('A', 'ivan-girl'), spec('B', 'default', { hp: 3 }), spec('C', 'default', { hp: 3 })], 108);
    g.players.B.room = 'R2';
    g.players.C.room = 'R2';
    toActionPhase(g, { A: 'rock', B: 'rock', C: 'scissors' });
    const r = g.submitAction('A', { type: 'throwIvan', room: 'R2' });
    expect(r.ok).toBe(true);
    // 投掷回合引信未开：走完本回合行动（B 也有资格）不爆炸，进入第 2 回合
    let guard = 0;
    while (g.phase === 'act' && guard++ < 20) {
      const cur = g.currentActor();
      if (!cur) break;
      g.submitAction(cur, { type: 'skip' });
    }
    expect(g.phase).toBe('rps1');
    // 第 2 回合：分出胜负并走完行动 → 引燃回合结束，回合末爆炸
    toActionPhase(g, { A: 'rock', B: 'rock', C: 'scissors' });
    guard = 0;
    while (g.phase === 'act' && guard++ < 20) {
      const cur = g.currentActor();
      if (!cur) break;
      g.submitAction(cur, { type: 'skip' });
    }
    expect(g.phase).toBe('over');
    const dd = realDamageLogs(g);
    expect(dd.length).toBe(2);
    const groups = new Set(dd.map((l) => damageData(l).groupId));
    expect(groups.size).toBe(1);
    for (const l of dd) {
      const d = damageData(l);
      expect(d.amount).toBe(999999);
      expect(d.lethal).toBe(true);
      expect(d.tag).toBe('ivan');
      expect(d.room).toBe('R2');
    }
    expect(g.players.B.alive).toBe(false);
    expect(g.players.C.alive).toBe(false);
  });
});

describe('结构化事件：反弹 / 未命中 / 复活', () => {
  it('马保国太极反弹（种子扫描复现）：扣血事件带 reflected 且目标为来源', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const g = makeGame([spec('A', 'default', { hp: 3 }), spec('B', 'mabaoguo')], seed);
      g.players.A.room = 'R1';
      g.players.B.room = 'R1';
      toActionPhase(g, { A: 'rock', B: 'scissors' });
      const before = g.logs.length;
      const r = g.submitAction('A', { type: 'attack', targetId: 'B' });
      if (!r.ok) continue;
      const dd = g.logs.slice(before).filter(realDamageLogsFilter);
      const reflected = dd.find((l) => damageData(l).reflected === true);
      if (reflected) {
        const d = damageData(reflected);
        expect(d.target).toBe('A');
        expect(d.source).toBe('A'); // 反弹后来源仍是原攻击者
        expect(d.transferred).toBe(false);
        expect(d.hpBefore).toBe(3);
        return;
      }
    }
    throw new Error('60 个种子内未复现太极反弹（应不可能）');
  });

  it('躲藏目标被闪电五连鞭命中判定：applyDamage 躲避分支产出 missed 事件', () => {
    // 指向性攻击在 actAttack 校验就被拒；引擎的 missed 事件来自伤害管线内的躲避分支
    //（AOE/技能伤害绕过 actAttack 目标校验时）。用马保国五连鞭打躲藏目标触发。
    const g = makeGame([spec('A', 'mabaoguo'), spec('B', 'default', { hp: 3, hidden: true })], 118);
    g.players.A.room = 'R1';
    g.players.B.room = 'R1';
    toActionPhase(g, { A: 'rock', B: 'scissors' });
    const r = g.submitAction('A', { type: 'whip5', targetId: 'B' });
    expect(r.ok).toBe(true);
    const missed = g.logs.filter((l) => (l.data as unknown as { missed?: boolean })?.missed === true);
    expect(missed.length).toBe(1);
    const md = missed[0].data as unknown as DamageEventData;
    expect(md.target).toBe('B');
    expect(md.amount).toBeUndefined();
    // 没有任何实际扣血
    expect(realDamageLogs(g).length).toBe(0);
    expect(g.players.B.hp).toBe(3);
  });

  it('五条悟命数复活：revive 事件带 livesLeft', () => {
    const g = makeGame([spec('A', 'gojo'), spec('B', 'default', { hp: 3 })], 111);
    g.players.A.room = 'R1';
    g.players.B.room = 'R1';
    g.players.A.hp = 1;
    toActionPhase(g, { A: 'scissors', B: 'rock' }); // B 胜，B 行动
    const r = g.submitAction('B', { type: 'attack', targetId: 'A' });
    expect(r.ok).toBe(true);
    expect(g.players.A.alive).toBe(true); // 消耗一条命复活
    expect(g.players.A.hp).toBe(3);
    const revives = g.logs.filter((l) => l.type === 'trigger' && (l.data as unknown as { livesLeft?: number })?.livesLeft !== undefined);
    expect(revives.length).toBe(1);
    const rd = revives[0].data as unknown as ReviveEventData;
    expect(rd.pid).toBe('A');
    expect(rd.livesLeft).toBe(1);
  });
});

describe('结构化事件：多局续接与隐藏信息', () => {
  it('logSeqOffset 续接后，结构化事件在第二局照常产出（跨局不丢演出）', () => {
    const g1 = makeGame([spec('A', 'default', { hp: 3 }), spec('B', 'default', { hp: 3 })], 112);
    g1.players.A.room = 'R1';
    g1.players.B.room = 'R1';
    toActionPhase(g1, { A: 'rock', B: 'scissors' });
    g1.submitAction('A', { type: 'attack', targetId: 'B' });
    const maxSeq = g1.logs[g1.logs.length - 1].seq;
    const g2 = makeGame([spec('C', 'default', { hp: 3 }), spec('D', 'default', { hp: 3 })], 113);
    (g2 as unknown as { logSeq: number }).logSeq = maxSeq; // 模拟 Room.logSeqOffset 续接
    g2.players.C.room = 'R1';
    g2.players.D.room = 'R1';
    toActionPhase(g2, { C: 'rock', D: 'scissors' });
    g2.submitAction('C', { type: 'attack', targetId: 'D' });
    const dd = realDamageLogs(g2);
    expect(dd.length).toBe(1);
    expect(dd[0].seq).toBeGreaterThan(maxSeq);
    expect(damageData(dd[0]).amount).toBe(1);
  });

  it('结构化数据不含未提交的拳种（提交阶段无泄露路径）', () => {
    const g = makeGame([spec('A', 'default'), spec('B', 'default')], 114);
    g.submitThrow('A', 'rock');
    // 提交后未结算：所有日志/数据里不允许出现 'rock'
    for (const l of g.logs) {
      expect(JSON.stringify(l.data ?? {})).not.toContain('rock');
    }
    const snap = g.snapshot() as unknown as Record<string, unknown>;
    expect(JSON.stringify(snap)).not.toContain('"rock"');
  });
});

function realDamageLogsFilter(l: LogEntry): boolean {
  const d = l.data as unknown as { declared?: boolean; target?: string } | undefined;
  return l.type === 'damage' && d?.declared !== true && typeof d?.target === 'string';
}
