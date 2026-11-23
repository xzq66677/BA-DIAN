/**
 * 房间人数上限（用户要求：最多 10 人）
 *
 * 服务端与入口界面共用 shared/src/room-limits.ts 的 MAX_ROOM_SEATS，
 * 这里验证常量本身、剩余席位计算与 Room 的空位判定，socket 层由集成测试覆盖。
 */
import { describe, it, expect } from 'vitest';
import { MAX_ROOM_SEATS, remainingSeats } from '../shared/src/room-limits.js';
import { Room } from '../server/src/room.js';

describe('房间人数上限（10 人）', () => {
  it('上限常量为 10，剩余席位计算不会为负', () => {
    expect(MAX_ROOM_SEATS).toBe(10);
    expect(remainingSeats(0)).toBe(10);
    expect(remainingSeats(9)).toBe(1);
    expect(remainingSeats(10)).toBe(0);
    expect(remainingSeats(12)).toBe(0);
  });

  it('Room.canAddSeat：坐满 10 人后关闭，有人离开后重新开放', () => {
    const room = new Room('CAP');
    for (let i = 0; i < MAX_ROOM_SEATS; i++) {
      expect(room.canAddSeat()).toBe(true);
      room.addSeat(`P${i + 1}`, 'default', 'human');
    }
    expect(room.seats).toHaveLength(10);
    expect(room.canAddSeat()).toBe(false);
    room.removeSeat(room.seats[0].playerId);
    expect(room.canAddSeat()).toBe(true);
    room.dispose();
  });
});
