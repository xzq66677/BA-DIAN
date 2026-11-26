// @vitest-environment node
/**
 * BattleEventQueue 单元测试（任务书 §5 / §9.2）
 * 覆盖：事件解析与旧数据兼容、seq 幂等去重、分簇顺序、AOE 分组、
 *       快进/跳过/拥堵降级、重连初始化不回放、局切换清理。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BattleEventQueue, assembleClusters, PACE_PROFILES, type PaceProfile } from '../../client/src/battle/queue.js';
import { parseBattleEvent, type LogLike, type BattleEvent } from '../../client/src/battle/events.js';
import type { QueueState } from '../../client/src/battle/queue.js';

/**
 * 拥堵判定的「小号」档位：把条数/时长阈值缩到几十条量级，
 * 好在单测里几秒内跑出「压缩 / 丢弃旧积压」的效果。
 * 压缩逻辑与线上完全一致，只是阈值数值不同（阈值本身只是数据）。
 */
const CROWD_PACE: PaceProfile = {
  ...PACE_PROFILES.current,
  fastPendingEvents: 8,
  turboPendingEvents: 18,
  fastBacklogMs: 2500,
  turboBacklogMs: 5000,
};

function log(seq: number, type: string, data?: Record<string, unknown>, important = false): LogLike {
  return { seq, type, text: `t${seq}`, important, data };
}

/** 收集事件启动序列 */
function collect(pace?: PaceProfile) {
  const started: BattleEvent[] = [];
  const flushes: number[] = [];
  const states: QueueState[] = [];
  const q = new BattleEventQueue({
    onEventStart: (e) => started.push(e),
    onFlush: () => flushes.push(Date.now()),
    onState: (s) => states.push({ ...s }),
  }, pace);
  return { q, started, flushes, states };
}

/** 等待队列播完（轮询 idle） */
async function drain(q: BattleEventQueue, timeoutMs = 6000): Promise<void> {
  const t0 = Date.now();
  while (q.isBusy()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('队列播放超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => { vi.useRealTimers(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('日志 → 演出事件解析（结构化字段，旧数据兼容）', () => {
  it('伤害事件：携带目标/来源/数值/HP 流程/致命/段信息', () => {
    const e = parseBattleEvent(log(1, 'damage', {
      target: 'B', source: 'A', amount: 2, hpBefore: 3, hpAfter: 1,
      lethal: false, dtype: 'physical', tag: 'whip', segment: { index: 2, total: 5 }, room: 'R2', groupId: 'GRP-1-1',
    }, true))!;
    expect(e.kind).toBe('damage');
    expect(e.targetId).toBe('B');
    expect(e.sourceId).toBe('A');
    expect(e.amount).toBe(2);
    expect(e.hpBefore).toBe(3);
    expect(e.hpAfter).toBe(1);
    expect(e.segment).toEqual({ index: 2, total: 5 });
    expect(e.groupId).toBe('GRP-1-1');
  });

  it('致命伤害事件：HP 归零后 lethal 自动为真', () => {
    const e = parseBattleEvent(log(2, 'damage', { target: 'B', amount: 999999, hpBefore: 3, hpAfter: 0 }))!;
    expect(e.lethal).toBe(true);
  });

  it('未命中事件：miss 且不产生伤害数值', () => {
    const e = parseBattleEvent(log(3, 'state', { target: 'B', source: 'A', missed: true }))!;
    expect(e.kind).toBe('miss');
    expect(e.amount).toBeUndefined();
  });

  it('旧格式伤害（只有 target/source）降级为来源卡攻击提示', () => {
    const e = parseBattleEvent(log(4, 'damage', { target: 'B', source: 'A' }))!;
    expect(e.kind).toBe('action');
    expect(e.pid).toBe('A');
    expect(e.fx).toBe('attack');
  });

  it('无 data 的伤害日志不演出（跳过）', () => {
    expect(parseBattleEvent(log(5, 'damage'))).toBeNull();
  });

  it('回复/移动/淘汰/复活事件解析', () => {
    const h = parseBattleEvent(log(6, 'heal', { target: 'B', amount: 1, hpBefore: 1, hpAfter: 2 }))!;
    expect(h.kind).toBe('heal');
    const m = parseBattleEvent(log(7, 'move', { pid: 'A', from: 'R1', to: 'R2' }))!;
    expect(m.kind).toBe('move');
    expect(m.fromRoom).toBe('R1');
    expect(m.toRoom).toBe('R2');
    const el = parseBattleEvent(log(8, 'eliminate', { pid: 'B', cause: 'damage', killer: 'A' }))!;
    expect(el.kind).toBe('eliminate');
    expect(el.targetId).toBe('B');
    const rv = parseBattleEvent(log(9, 'trigger', { pid: 'G', livesLeft: 1 }, true))!;
    expect(rv.kind).toBe('revive');
    expect(rv.livesLeft).toBe(1);
  });

  it('旧格式 move（只有 pid）降级为移动者提示；判定/阶段日志不演出', () => {
    const m = parseBattleEvent(log(10, 'move', { pid: 'A' }))!;
    expect(m.kind).toBe('action');
    expect(m.fx).toBe('move');
    expect(parseBattleEvent(log(11, 'judge', { x: 1 }))).toBeNull();
    expect(parseBattleEvent(log(12, 'phase'))).toBeNull();
  });

  it('大伊万：投掷/爆炸结构化事件解析；旧格式（无 data）不演出', () => {
    // 投掷：pid + room → ivanThrow
    const thr = parseBattleEvent(log(10, 'deferred', { pid: 'A', room: 'R2', explodeRound: 2 }, true))!;
    expect(thr.kind).toBe('ivanThrow');
    expect(thr.pid).toBe('A');
    expect(thr.room).toBe('R2');
    // 爆炸：room + source → ivanBoom
    const boom = parseBattleEvent(log(11, 'deferred', { room: 'R2', source: 'A' }, true))!;
    expect(boom.kind).toBe('ivanBoom');
    expect(boom.room).toBe('R2');
    expect(boom.sourceId).toBe('A');
    // 旧格式（无 data）：跳过演出，日志面板照常显示
    expect(parseBattleEvent(log(12, 'deferred'))).toBeNull();
    // 通用延迟伤害（无 room）：跳过演出
    expect(parseBattleEvent(log(13, 'deferred', { label: '延迟伤害' }))).toBeNull();
  });

  it('攻击宣告与行动日志解析', () => {
    const d = parseBattleEvent(log(13, 'damage', { declared: true, source: 'A', target: 'B', amount: 1, room: 'R1' }))!;
    expect(d.kind).toBe('attackDecl');
    expect(d.sourceId).toBe('A');
    const a = parseBattleEvent(log(14, 'action', { pid: 'A', fx: 'heal', label: '回复' }, true))!;
    expect(a.kind).toBe('action');
    expect(a.fx).toBe('heal');
    expect(a.pid).toBe('A');
  });
});

describe('分簇组装', () => {
  it('action 日志收尾 → 作为下一簇簇首（行动 fx 先播）', () => {
    const events = [
      parseBattleEvent(log(1, 'damage', { declared: true, source: 'A', target: 'B', amount: 1 }))!,
      parseBattleEvent(log(2, 'damage', { target: 'B', source: 'A', amount: 1, hpBefore: 2, hpAfter: 1 }))!,
      parseBattleEvent(log(3, 'action', { pid: 'A', fx: 'attack', label: '攻击 B' }))!,
      parseBattleEvent(log(4, 'heal', { target: 'C', amount: 1, hpBefore: 1, hpAfter: 2 }))!,
      parseBattleEvent(log(5, 'action', { pid: 'C', fx: 'heal', label: '回复' }))!,
    ];
    const clusters = assembleClusters(events);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].lead?.kind).toBe('action');
    expect(clusters[0].lead?.seq).toBe(3);
    expect(clusters[0].events.map((e) => e.seq)).toEqual([1, 2]);
    expect(clusters[1].lead?.seq).toBe(5);
    expect(clusters[1].events.map((e) => e.seq)).toEqual([4]);
  });

  it('无 action 日志的判定阶段事件单独成簇（顺序保留）', () => {
    const events = [
      parseBattleEvent(log(1, 'trigger', { pid: 'X' }))!,
      parseBattleEvent(log(2, 'damage', { target: 'Y', amount: 1, hpBefore: 1, hpAfter: 0 }))!,
      parseBattleEvent(log(3, 'eliminate', { pid: 'Y', cause: 'damage' }))!,
    ];
    const clusters = assembleClusters(events);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].lead).toBeUndefined();
    expect(clusters[0].events.map((e) => e.kind)).toEqual(['trigger', 'damage', 'eliminate']);
  });
});

describe('队列播放', () => {
  it('seq 幂等：重复推送同一批日志只演出一次', async () => {
    const { q, started } = collect();
    const logs = [
      log(1, 'heal', { target: 'B', amount: 1, hpBefore: 1, hpAfter: 2 }),
      log(2, 'action', { pid: 'B', fx: 'heal', label: '回复' }),
    ];
    q.pushLogs(logs);
    q.pushLogs(logs); // 重复推送（乱序/重播广播）
    q.pushLogs([logs[1], logs[0]]); // 乱序重复
    await drain(q);
    const seqs = started.map((e) => e.seq);
    expect(seqs.filter((s) => s === 1)).toHaveLength(1);
    expect(seqs.filter((s) => s === 2)).toHaveLength(1);
  });

  it('簇内顺序：行动 fx 先播，伤害随后；多簇按序', async () => {
    const { q, started } = collect();
    q.pushLogs([
      log(1, 'damage', { target: 'B', source: 'A', amount: 1, hpBefore: 2, hpAfter: 1 }),
      log(2, 'action', { pid: 'A', fx: 'attack', label: '攻击 B' }),
      log(3, 'move', { pid: 'A', from: 'R1', to: 'R2' }),
      log(4, 'action', { pid: 'A', fx: 'move', label: '移动' }),
    ]);
    await drain(q);
    expect(started.map((e) => e.kind)).toEqual(['action', 'damage', 'action', 'move']);
    expect(started[0].seq).toBe(2);
    expect(started[1].seq).toBe(1);
  });

  it('大伊万链：爆炸先于逐目标结算演出（同簇顺序保留）', async () => {
    const { q, started } = collect();
    q.pushLogs([
      log(1, 'deferred', { room: 'R2', source: 'A' }, true),
      log(2, 'damage', { target: 'B', source: 'A', amount: 999999, hpBefore: 3, hpAfter: 0, instakill: true, tag: 'ivan', room: 'R2', groupId: 'GRP-1-1' }, true),
      log(3, 'damage', { target: 'C', source: 'A', amount: 999999, hpBefore: 3, hpAfter: 0, instakill: true, tag: 'ivan', room: 'R2', groupId: 'GRP-1-1' }, true),
    ]);
    await drain(q);
    expect(started.map((e) => e.kind)).toEqual(['ivanBoom', 'damage', 'damage']);
    // 投掷→行动簇：投掷物飞行在行动者 fx 之后播（簇首=行动 fx）
    const { q: q2, started: s2 } = collect();
    q2.pushLogs([
      log(10, 'deferred', { pid: 'A', room: 'R3', explodeRound: 2 }, true),
      log(11, 'action', { pid: 'A', fx: 'skill', label: '投掷大伊万' }),
    ]);
    await drain(q2);
    expect(s2.map((e) => e.kind)).toEqual(['action', 'ivanThrow']);
  });

  it('AOE 分组：事件按段序播放且全部演出', async () => {
    const { q, started } = collect();
    q.setSpeed(4);
    const logs: LogLike[] = [log(1, 'action', { pid: 'A', fx: 'attack', label: '三段AOE' })];
    let seq = 1;
    for (let seg = 1; seg <= 3; seg++) {
      for (const t of ['B', 'C']) {
        logs.push(log(++seq, 'damage', {
          target: t, source: 'A', amount: 1, hpBefore: 3, hpAfter: 3 - seg,
          segment: { index: seg, total: 3 }, aoe: true, groupId: 'GRP-1-1', room: 'R1',
        }));
      }
    }
    q.pushLogs(logs);
    await drain(q);
    const damages = started.filter((e) => e.kind === 'damage');
    expect(damages).toHaveLength(6);
    expect(damages.map((e) => e.segment?.index)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('setSpeed(4) 明显快于 setSpeed(1)', async () => {
    const logs = Array.from({ length: 4 }, (_, i) => log(i + 1, 'trigger', { pid: 'X' }));
    const a = collect();
    a.q.pushLogs(logs);
    const t1 = Date.now();
    await drain(a.q);
    const slow = Date.now() - t1;

    const b = collect();
    b.q.setSpeed(4);
    b.q.pushLogs(logs);
    const t2 = Date.now();
    await drain(b.q);
    const fast = Date.now() - t2;
    expect(fast).toBeLessThan(slow / 2);
  });

  it('skipCurrent 跳过当前簇，下一簇继续播放', async () => {
    const { q, started } = collect();
    q.pushLogs([
      log(1, 'damage', { target: 'B', amount: 1, hpBefore: 2, hpAfter: 1 }),
      log(2, 'action', { pid: 'A', fx: 'attack', label: '攻击' }),
      log(3, 'heal', { target: 'C', amount: 1, hpBefore: 1, hpAfter: 2 }),
      log(4, 'action', { pid: 'C', fx: 'heal', label: '回复' }),
    ]);
    // 等第一个事件开始后跳过当前簇
    await new Promise((r) => setTimeout(r, 30));
    q.skipCurrent();
    await drain(q);
    expect(started.some((e) => e.seq === 3)).toBe(true);
    expect(started.some((e) => e.seq === 4)).toBe(true);
  });

  it('skipAll 清空队列并触发 onFlush', async () => {
    const { q, started, flushes } = collect();
    q.pushLogs([
      log(1, 'damage', { target: 'B', amount: 1, hpBefore: 2, hpAfter: 1 }),
      log(2, 'action', { pid: 'A', fx: 'attack', label: '攻击' }),
      log(3, 'heal', { target: 'C', amount: 1, hpBefore: 1, hpAfter: 2 }),
      log(4, 'action', { pid: 'C', fx: 'heal', label: '回复' }),
    ]);
    await new Promise((r) => setTimeout(r, 20));
    q.skipAll();
    expect(q.pendingEvents()).toBe(0);
    expect(flushes.length).toBe(1);
    const countBefore = started.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(started.length).toBe(countBefore); // 不再演出剩余事件
  });

  it('拥堵自动压缩：超过阈值进入 fast（丢弃低重要度事件）', { timeout: 30000 }, async () => {
    const { q, started, states } = collect(CROWD_PACE);
    const logs: LogLike[] = [];
    let seq = 0;
    for (let i = 0; i < 10; i++) {
      logs.push(log(++seq, 'damage', { declared: true, source: 'A', target: 'B', amount: 1 }));
      logs.push(log(++seq, 'damage', { target: 'B', source: 'A', amount: 1, hpBefore: 3, hpAfter: 2 }));
      logs.push(log(++seq, 'action', { pid: 'A', fx: 'attack', label: '攻击' }));
    }
    q.pushLogs(logs);
    expect(states[states.length - 1].mode).toBe('fast');
    await drain(q, 12000);
    const kinds = new Set(started.map((e) => e.kind));
    expect(kinds.has('damage')).toBe(true);
    expect(kinds.has('action')).toBe(true);
    expect(kinds.has('attackDecl')).toBe(false); // fast 模式丢弃低重要度事件
  });

  it('极端拥堵保留重大簇：淘汰/复活/大伊万不被积压丢弃（Phase D）', { timeout: 30000 }, async () => {
    const { q, started } = collect(CROWD_PACE);
    const logs: LogLike[] = [];
    let seq = 0;
    // 大量普通伤害积压（> turbo 阈值）+ 夹杂一次淘汰与一次复活
    for (let i = 0; i < 20; i++) {
      logs.push(log(++seq, 'damage', { target: `T${i}`, source: 'A', amount: 1, hpBefore: 3, hpAfter: 2 }));
      logs.push(log(++seq, 'action', { pid: 'A', fx: 'attack', label: '攻击' }));
      if (i === 7) logs.push(log(++seq, 'eliminate', { pid: 'T7' }, true));
      if (i === 13) logs.push(log(++seq, 'trigger', { pid: 'T13', livesLeft: 2 }, true));
    }
    q.pushLogs(logs);
    await drain(q, 15000);
    // 重大事件必须被演出（普通伤害被丢弃是允许的）
    expect(started.some((e) => e.kind === 'eliminate' && e.targetId === 'T7')).toBe(true);
    expect(started.some((e) => e.kind === 'revive' && e.targetId === 'T13')).toBe(true);
  });

  it('极端拥堵保留致命一击簇（lethal damage 不被丢弃）', { timeout: 30000 }, async () => {
    const { q, started } = collect(CROWD_PACE);
    const logs: LogLike[] = [];
    let seq = 0;
    for (let i = 0; i < 20; i++) {
      logs.push(log(++seq, 'damage', { target: `T${i}`, source: 'A', amount: 1, hpBefore: 3, hpAfter: 2 }));
      logs.push(log(++seq, 'action', { pid: 'A', fx: 'attack', label: '攻击' }));
      if (i === 10) logs.push(log(++seq, 'damage', { target: 'T10', source: 'A', amount: 3, hpBefore: 3, hpAfter: 0, lethal: true }, true));
    }
    q.pushLogs(logs);
    await drain(q, 15000);
    const lethal = started.filter((e) => e.kind === 'damage' && e.lethal);
    expect(lethal.some((e) => e.targetId === 'T10')).toBe(true);
  });

  it('极端拥堵：丢弃最旧积压、保留最新事件（最新事件不丢演出）', { timeout: 30000 }, async () => {
    const { q, started, flushes } = collect(CROWD_PACE);
    const logs: LogLike[] = [];
    let seq = 0;
    for (let i = 0; i < 20; i++) {
      logs.push(log(++seq, 'damage', { target: `T${i}`, source: 'A', amount: 1, hpBefore: 3, hpAfter: 2 }));
      logs.push(log(++seq, 'action', { pid: 'A', fx: 'attack', label: '攻击' }));
    }
    q.pushLogs(logs);
    // 40 簇超过 turbo 阈值：旧积压被丢弃，新批次以 fast 入队（不整场冲刷）
    expect(q.isBusy()).toBe(true);
    expect(flushes.length).toBe(0);
    // 播完后：最新的事件（最后几个目标的伤害）必须被演出过
    await drain(q, 8000);
    const damageTargets = started.filter((e) => e.kind === 'damage').map((e) => e.targetId);
    expect(damageTargets).toContain('T19');
    expect(damageTargets).toContain('T18');
    // 丢弃的最旧事件不应演出
    expect(damageTargets).not.toContain('T0');
    // 冲刷路径仍保留给显式跳过：skipAll 触发 onFlush
    q.pushLogs([log(++seq, 'heal', { target: 'C', amount: 1, hpBefore: 1, hpAfter: 2 })]);
    q.skipAll();
    expect(flushes.length).toBe(1);
    expect(q.pendingEvents()).toBe(0);
  });

  it('initFromLogs：重连补发的历史日志只推进游标，不回放特效', async () => {
    const { q, started } = collect();
    const history = [
      log(1, 'damage', { target: 'B', source: 'A', amount: 1, hpBefore: 2, hpAfter: 1 }),
      log(2, 'action', { pid: 'A', fx: 'attack', label: '攻击' }),
      log(3, 'eliminate', { pid: 'B', cause: 'damage' }),
    ];
    q.initFromLogs(history);
    q.pushLogs(history); // 同一批：全部被游标挡住
    await new Promise((r) => setTimeout(r, 60));
    expect(started).toHaveLength(0);
    // 新日志照常演出
    q.pushLogs([log(4, 'heal', { target: 'C', amount: 1, hpBefore: 1, hpAfter: 2 })]);
    await drain(q);
    expect(started.map((e) => e.seq)).toEqual([4]);
  });

  it('dispose→revive：StrictMode 双调用兼容，游标保留不回放', async () => {
    const { q, started } = collect();
    const history = [
      log(1, 'damage', { target: 'B', source: 'A', amount: 1, hpBefore: 2, hpAfter: 1 }),
      log(2, 'action', { pid: 'A', fx: 'attack', label: '攻击' }),
    ];
    q.initFromLogs(history);
    // StrictMode：setup → cleanup(dispose) → setup(revive)
    q.dispose();
    q.revive();
    // dispose 前的日志不回放（游标保留）
    q.pushLogs(history);
    await new Promise((r) => setTimeout(r, 60));
    expect(started).toHaveLength(0);
    // 新日志照常演出
    q.pushLogs([log(3, 'heal', { target: 'C', amount: 1, hpBefore: 1, hpAfter: 2 })]);
    await drain(q);
    expect(started.map((e) => e.seq)).toEqual([3]);
    // revive 后播放管线正常：能继续接收并演出后续事件
    q.pushLogs([log(4, 'action', { pid: 'A', fx: 'skill', label: '技能' })]);
    await drain(q);
    expect(started.map((e) => e.seq)).toEqual([3, 4]);
  });

  it('clear：局切换清空队列与游标，触发 onFlush', () => {
    const { q, flushes } = collect();
    q.pushLogs([log(1, 'action', { pid: 'A', fx: 'attack' })]);
    q.clear();
    expect(q.pendingEvents()).toBe(0);
    expect(flushes.length).toBe(1);
    // 游标已重置：新局日志（seq 从头计）可以演出
    const { started } = collect();
    void started;
    q.pushLogs([log(1, 'action', { pid: 'A', fx: 'attack' })]);
    expect(q.pendingEvents()).toBeGreaterThan(0);
  });
});
