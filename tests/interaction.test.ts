/**
 * 局内小互动（丢番茄）测试
 * 纯娱乐：不影响规则，只受冷却与目标存活约束。
 */

import { describe, it, expect } from 'vitest';
import { Room, INTERACT_COOLDOWN_MS } from '../server/src/room.js';

function makeRoom(players = ['A', 'B']) {
  const room = new Room('TEST', { submitTimeoutMs: 0, turnTimeoutMs: 0 });
  const seats = players.map((n) => room.addSeat(n, 'default', 'human'));
  return { room, seats };
}

describe('局内小互动（丢番茄）', () => {
  it('对局中可丢番茄，计数与广播数据正确', () => {
    const { room, seats } = makeRoom();
    expect(room.start(1).ok).toBe(true);
    const r = room.interact(seats[0].playerId, seats[1].playerId, 'tomato');
    expect(r.ok).toBe(true);
    expect(room.interactions).toHaveLength(1);
    expect(room.interactions[0].kind).toBe('tomato');
    expect(room.interactions[0].fromName).toBe('A');

    const snap = room.lobbySnapshot() as unknown as {
      interactions: { kind: string }[];
      interactionCounts: Record<string, { given: number; got: number }>;
    };
    expect(snap.interactions).toHaveLength(1);
    expect(snap.interactionCounts[seats[0].playerId].given).toBe(1);
    expect(snap.interactionCounts[seats[1].playerId].got).toBe(1);
    expect(INTERACT_COOLDOWN_MS).toBeGreaterThan(0);
  });

  it('冷却生效：连续丢第二次被拒绝，且不影响对局状态', () => {
    const { room, seats } = makeRoom();
    room.start(1);
    const hpBefore = room.game!.players[seats[1].playerId].hp;
    expect(room.interact(seats[0].playerId, seats[1].playerId, 'tomato').ok).toBe(true);
    const second = room.interact(seats[0].playerId, seats[1].playerId, 'egg');
    expect(second.ok).toBe(false);
    expect(second.error).toBeTruthy();
    expect(room.interactions).toHaveLength(1);
    expect(room.game!.players[seats[1].playerId].hp).toBe(hpBefore);
    // 互动不写入战斗日志
    expect(room.game!.logs.some((l) => l.text.includes('番茄'))).toBe(false);
  });

  it('不能丢自己、不能丢已淘汰目标、对局未开始/已结束不可互动', () => {
    const { room, seats } = makeRoom();
    expect(room.interact(seats[0].playerId, seats[1].playerId, 'tomato').ok).toBe(false); // 未开始

    room.start(1);
    expect(room.interact(seats[0].playerId, seats[0].playerId, 'tomato').ok).toBe(false);

    room.game!.players[seats[1].playerId].alive = false;
    expect(room.interact(seats[0].playerId, seats[1].playerId, 'tomato').ok).toBe(false);

    // 结束对局后不可互动
    room.game!.players[seats[1].playerId].alive = true;
    room.game!.phase = 'over';
    expect(room.interact(seats[0].playerId, seats[1].playerId, 'tomato').ok).toBe(false);
  });

  it('互动列表有上限，不会无限增长', () => {
    const { room, seats } = makeRoom(['A', 'B', 'C']);
    room.start(1);
    for (let i = 0; i < 60; i++) {
      room.interactions.push({
        id: i + 1, from: seats[0].playerId, fromName: 'A',
        to: seats[1].playerId, kind: 'tomato', ts: Date.now(),
      });
    }
    room.interactions = room.interactions.slice(-40);
    expect(room.interactions.length).toBeLessThanOrEqual(40);
    room.dispose();
  });
});
