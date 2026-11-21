/**
 * 服务端日志增量广播游标（takeNewLogs / catchUpLogs）
 *
 * 广播是房间级的：同一份 newLogs 发给所有在线座位，游标挂在房间上。
 * 断线重连改为按 socket 定向补发最近 N 条（catchUpLogs），
 * 不再重置游标——否则其它在线客户端会重复收到整段历史日志。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Room } from '../server/src/room.js';

const rooms: Room[] = [];
function makeRoom(types: ('human' | 'ai' | 'local')[]) {
  const room = new Room('BC', { submitTimeoutMs: 0, turnTimeoutMs: 0 });
  types.forEach((t, i) => room.addSeat(`P${i + 1}`, 'default', t));
  rooms.push(room);
  return room;
}

afterEach(() => {
  for (const r of rooms.splice(0)) r.dispose();
});

describe('广播增量游标', () => {
  it('第一次取走全部日志，第二次取走为空，状态变化后只有新增', () => {
    const room = makeRoom(['human', 'human']);
    room.start(11);
    const first = room.takeNewLogs();
    expect(first.length).toBe(room.game!.logs.length);
    expect(first[0].seq).toBe(1);

    expect(room.takeNewLogs()).toHaveLength(0);

    // 状态变化产生新日志
    const before = room.game!.logs.length;
    room.submitThrow('P1', 'rock');
    const fresh = room.takeNewLogs();
    expect(fresh.length).toBe(room.game!.logs.length - before);
    expect(fresh.every((l) => l.seq > first[first.length - 1].seq)).toBe(true);
  });

  it('catchUpLogs 返回最近 N 条且不推进广播游标', () => {
    const room = makeRoom(['human', 'human']);
    room.start(12);
    room.takeNewLogs(); // 游标推进到当前最大
    const [p1, p2] = room.seats.map((s) => s.playerId);
    room.submitThrow(p1, 'rock');
    room.submitThrow(p2, 'paper');

    const all = room.game!.logs;
    const catchUp = room.catchUpLogs(2);
    expect(catchUp).toHaveLength(2);
    expect(catchUp[1].seq).toBe(all[all.length - 1].seq);
    // 不推进游标：takeNewLogs 仍能取到 catchUp 覆盖的新日志
    const fresh = room.takeNewLogs();
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.some((l) => l.seq === catchUp[0].seq)).toBe(true);
  });

  it('单次增量超过上限时只发最近 MAX_BROADCAST_LOGS 条（有界历史）', () => {
    const room = makeRoom(['human', 'ai']);
    room.start(13);
    // 直接往引擎塞大量日志模拟突发
    const g = room.game!;
    for (let i = 0; i < Room.MAX_BROADCAST_LOGS + 50; i++) {
      g.log('info', `突发日志 ${i}`);
    }
    const fresh = room.takeNewLogs();
    expect(fresh).toHaveLength(Room.MAX_BROADCAST_LOGS);
    // 取的是最近的一段（最后一条 = 全量最后一条）
    expect(fresh[fresh.length - 1].seq).toBe(g.logs[g.logs.length - 1].seq);
  });

  it('重开局后广播游标续接：新日志全部可见，不因 restart 丢增量', () => {
    const room = makeRoom(['human', 'human']);
    room.start(14);
    for (let i = 0; i < 4; i++) room.takeNewLogs();
    const g1Max = room.game!.logs[room.game!.logs.length - 1].seq;
    room.takeNewLogs(); // 清空增量
    room.restart();
    room.start(15);
    const fresh = room.takeNewLogs();
    expect(fresh.length).toBeGreaterThan(0);
    // 第二局 seq 从上一局最大值之后续接（跨局单调），全部出现在增量里
    expect(fresh[0].seq).toBeGreaterThan(g1Max);
    const seen = new Set(fresh.map((l) => l.seq));
    expect(seen.size).toBe(fresh.length);
    expect(room.game!.logs.every((l) => seen.has(l.seq))).toBe(true);
  });
});
