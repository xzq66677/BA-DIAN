/**
 * 对局回放测试
 * 服务端按状态变化录制帧，对局结束归档；回放只包含「已结算」的公开信息。
 */

import { describe, it, expect } from 'vitest';
import { Room } from '../server/src/room.js';
import { CHARACTERS } from '../shared/src/characters/index.js';
import type { Throw } from '../shared/src/types.js';

function makeRoom(names: string[]) {
  const room = new Room('RP', { submitTimeoutMs: 0, turnTimeoutMs: 0 });
  const seats = names.map((n) => room.addSeat(n, 'default', 'human'));
  return { room, seats };
}

/** 两玩家对局：A 连续用必胜拳击杀 B（A 血量 3、攻击 1） */
function playToWin(room: Room, aId: string, bId: string): void {
  // 近战需要同房间（默认角色无远程能力）
  room.game!.players[bId].room = room.game!.players[aId].room;
  const combos: [Throw, Throw][] = [['rock', 'scissors'], ['paper', 'rock'], ['rock', 'scissors']];
  for (const [ta, tb] of combos) {
    room.submitThrow(aId, ta);
    room.submitThrow(bId, tb);
    if (room.game!.isOver()) break;
    if (room.game!.phase === 'act') {
      expect(room.game!.currentActor()).toBe(aId);
      room.submitAction(aId, { type: 'attack', targetId: bId });
    }
  }
}

describe('对局回放', () => {
  it('对局中持续录帧，结束后归档可查询', () => {
    const { room, seats } = makeRoom(['A', 'B']);
    room.start(42);
    const live = room.currentReplay();
    expect(live).not.toBeNull();
    expect(live!.frames.length).toBeGreaterThan(0);
    expect(live!.frames[0].phase).toBe('rps1');
    expect(room.replayList()).toHaveLength(0); // 未结束不归档

    playToWin(room, seats[0].playerId, seats[1].playerId);
    expect(room.game!.isOver()).toBe(true);

    const list = room.replayList();
    expect(list).toHaveLength(1);
    expect(list[0].winnerName).toBe('A');
    expect(list[0].rounds).toBeGreaterThanOrEqual(1);
    expect(room.currentReplay()).toBeNull();

    const rec = room.replayGet(list[0].id);
    expect(rec).not.toBeNull();
    const frames = rec!.frames;
    expect(frames.length).toBeGreaterThanOrEqual(4);
    expect(frames.map((f) => f.i)).toEqual(frames.map((_, i) => i));
    expect(frames[frames.length - 1].phase).toBe('over');
    expect(frames[frames.length - 1].winner).toBe(seats[0].playerId);

    // 帧日志拼接应覆盖整局关键事件
    const text = frames.flatMap((f) => f.logs.map((l) => l.text)).join('\n');
    expect(text).toContain('游戏结束');
    expect(text).toContain('获得行动资格');

    // 每帧都带玩家血量/房间，且战绩随帧推进
    const last = frames[frames.length - 1];
    expect(last.players).toHaveLength(2);
    const a = last.players.find((p) => p.id === seats[0].playerId)!;
    expect(a.stats?.kills).toBe(1);
    expect(a.stats?.damageDealt).toBeGreaterThan(0);

    // 不存在的回放返回 null
    expect(room.replayGet('RP-NOPE')).toBeNull();
    room.dispose();
  });

  it('回放帧包含出拳揭示（仅结算后），不泄露提交中的拳种', () => {
    const { room, seats } = makeRoom(['A', 'B']);
    room.start(7);
    room.submitThrow(seats[0].playerId, 'rock');
    // 只有一方提交：最后一帧 reveal 必须为空
    const rec0 = room.currentReplay()!;
    const last0 = rec0.frames[rec0.frames.length - 1];
    expect(last0.reveal).toBeNull();

    room.submitThrow(seats[1].playerId, 'scissors');
    const rec1 = room.currentReplay()!;
    const last1 = rec1.frames[rec1.frames.length - 1];
    expect(last1.reveal).not.toBeNull();
    expect(last1.reveal!.throws[seats[0].playerId]).toBe('rock');
    expect(last1.reveal!.throws[seats[1].playerId]).toBe('scissors');
    room.dispose();
  });

  it('重开房间清除录制，历史归档保留；AI 对局也能录制', () => {
    const room = new Room('AI', { submitTimeoutMs: 0, turnTimeoutMs: 0 });
    room.addSeat('房主', 'default', 'human');
    const ai = room.addSeat('AI_2', CHARACTERS['gojo'] ? 'gojo' : 'default', 'ai');
    room.addSeat('AI_3', 'default', 'ai');
    room.start(123);
    // AI 自动出拳 → 帧应多于 1
    expect(room.currentReplay()!.frames.length).toBeGreaterThan(1);
    expect(room.game!.submittedIds).toContain(ai.playerId);

    room.restart();
    expect(room.currentReplay()).toBeNull();
    expect(room.game).toBeNull();
    expect(room.replayList()).toHaveLength(0);
    room.dispose();
  });
});
