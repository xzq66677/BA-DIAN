/**
 * 同房间多局：战斗日志必须继续更新（bug B-023）
 *
 * 引擎的 log seq 是**每局从 1 开始**的，而客户端 App.tsx 与服务端增量广播
 * 都靠 `seq > lastSeq` 做去重。第二局若从 1 重新计数，所有新日志都会被当成
 * 「已收到」丢弃，表现为「第二局之后日志不再更新」。
 *
 * 修复：Room 维护跨局游标 logSeqCursor，每开一局作为新 Game 的 logSeqOffset，
 * 保证同一房间内 seq 单调递增；同时下发 gameNo，客户端据此清空上一局日志。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Room } from '../server/src/room.js';

const rooms: Room[] = [];
function makeRoom(types: ('human' | 'ai' | 'local')[]) {
  const room = new Room('LS', { submitTimeoutMs: 0, turnTimeoutMs: 0 });
  types.forEach((t, i) => room.addSeat(`P${i + 1}`, 'default', t));
  rooms.push(room);
  return room;
}

afterEach(() => {
  for (const r of rooms.splice(0)) r.dispose();
});

const seqs = (room: Room) => room.game!.logs.map((l) => l.seq);
const maxSeq = (room: Room) => Math.max(0, ...seqs(room));

/** 推进一小步，制造日志（出拳 → 进入行动/下一轮） */
function step(room: Room) {
  const g = room.game!;
  const alive = g.playerIds.filter((pid) => g.players[pid].alive);
  if (g.phase === 'rps1') {
    const throws = ['rock', 'scissors', 'paper'] as const;
    alive.forEach((pid, i) => room.submitThrow(pid, throws[i % 3]));
  } else if (g.phase === 'act') {
    const cur = g.currentActor();
    if (cur) room.submitAction(cur, { type: 'skip' });
  }
}

/** 像客户端那样按 seq 去重 */
function clientDedupe(prevSeqs: number[], incoming: number[]) {
  const have = new Set(prevSeqs);
  return incoming.filter((s) => !have.has(s));
}

describe('同房间多局日志序号单调递增', () => {
  it('第二局日志 seq 严格大于第一局最大 seq', () => {
    const room = makeRoom(['human', 'human']);
    room.start(1);
    for (let i = 0; i < 6; i++) step(room);
    const g1Max = maxSeq(room);
    expect(g1Max).toBeGreaterThan(0);

    room.restart();
    room.start(2);
    const g2 = seqs(room);
    expect(g2.length).toBeGreaterThan(0);
    expect(Math.min(...g2)).toBeGreaterThan(g1Max);
  });

  it('客户端去重后第二局日志全部可见（不会整片丢弃）', () => {
    const room = makeRoom(['human', 'human']);
    room.start(1);
    for (let i = 0; i < 6; i++) step(room);
    const g1 = seqs(room);

    room.restart();
    room.start(2);
    for (let i = 0; i < 4; i++) step(room);
    const g2 = seqs(room);

    const dropped = g2.filter((s) => new Set(g1).has(s));
    expect(dropped).toEqual([]);
    expect(clientDedupe(g1, g2)).toHaveLength(g2.length);
  });

  it('连打三局游标持续增长，不因 restart 回退', () => {
    const room = makeRoom(['human', 'human']);
    const maxes: number[] = [];
    for (let n = 1; n <= 3; n++) {
      room.start(n);
      for (let i = 0; i < 4; i++) step(room);
      maxes.push(maxSeq(room));
      room.restart();
    }
    // 每局最大值都大于上一局
    expect(maxes[1]).toBeGreaterThan(maxes[0]);
    expect(maxes[2]).toBeGreaterThan(maxes[1]);
  });

  it('gameNo 逐局递增，首局为 1', () => {
    const room = makeRoom(['human', 'human']);
    expect(room.lobbySnapshot().gameNo).toBe(0);
    room.start(1);
    expect(room.lobbySnapshot().gameNo).toBe(1);
    room.restart();
    room.start(2);
    expect(room.lobbySnapshot().gameNo).toBe(2);
  });

  it('引擎默认行为不变：不传 logSeqOffset 时 seq 仍从 1 开始', () => {
    const room = makeRoom(['human', 'human']);
    room.start(1);
    expect(Math.min(...seqs(room))).toBe(1);
  });

  it('单人 vs AI 重开也续接（AI 局同样不能丢日志）', () => {
    const room = makeRoom(['human', 'ai']);
    room.start(7);
    const g1Max = maxSeq(room);
    room.restart();
    room.start(8);
    expect(Math.min(...seqs(room))).toBeGreaterThan(g1Max);
  });
});
