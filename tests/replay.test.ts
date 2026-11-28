/**
 * 对局回放测试
 * 服务端按状态变化录制帧，对局结束归档；回放只包含「已结算」的公开信息。
 */

import { describe, it, expect, vi } from 'vitest';
import { Room } from '../server/src/room.js';
import { CHARACTERS } from '../shared/src/characters/index.js';
import { replayMatch } from '../shared/src/simulation.js';
import { PROTOCOL_VERSION, REPLAY_FORMAT_VERSION } from '../shared/src/protocol.js';
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

    const actions = frames.flatMap((f) => f.logs).filter((l) => l.type === 'action');
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.data).toEqual(expect.objectContaining({
        pid: expect.any(String), actionName: expect.any(String), fx: expect.any(String),
      }));
    }

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


describe('可重演对局输入', () => {
  it('保留 AI 随机流、超时代掷和批量离席，重演快照与完整日志一致', () => {
    vi.useFakeTimers();
    const room = new Room('REPLAY', { submitTimeoutMs: 20, turnTimeoutMs: 20, aiDifficulty: 'easy' });
    const host = room.addSeat('A', 'default', 'human').playerId;
    const guest = room.addSeat('B', 'default', 'human').playerId;
    const ai = room.addSeat('AI', 'gojo', 'ai').playerId;
    try {
      room.start(42);
      expect(room.currentReplay()?.simulation).toBeUndefined();
      expect(room.game?.snapshot().v).toBe(PROTOCOL_VERSION);
      vi.advanceTimersByTime(60);
      if (!room.game!.isOver()) room.removeParticipants([guest, ai], 'left');
      expect(room.state).toBe('over');
      const record = room.replays[0];
      expect(record.v).toBe(REPLAY_FORMAT_VERSION);
      const transcript = structuredClone(record.simulation!);
      expect(transcript.inputs.some(({ input }) => input.kind === 'throwTimeout')).toBe(true);
      expect(transcript.inputs.some(({ rngAdvance }) => rngAdvance > 0)).toBe(true);
      expect(transcript.inputs.at(-1)?.input.kind).toBe('remove');
      expect(replayMatch(transcript, 0).snapshot().phase).toBe('rps1');
      const rebuilt = replayMatch(transcript);
      expect(rebuilt.snapshot()).toEqual(room.game!.snapshot());
      expect(rebuilt.logs).toEqual(room.game!.logs);
      expect(rebuilt.rng.next()).toBe(room.game!.rng.next());
      expect(rebuilt.winner).toBe(host);
      expect(() => replayMatch(transcript, transcript.inputs.length + 1)).toThrow(RangeError);
    } finally {
      room.dispose();
      vi.useRealTimers();
    }
  });

  it('含未知 kind 的 transcript：重演抛干净错误而非 TypeError（Issue #106）', () => {
    const room = new Room('GUARD', { submitTimeoutMs: 0, turnTimeoutMs: 0 });
    const a = room.addSeat('A', 'default', 'human').playerId;
    const b = room.addSeat('B', 'default', 'human').playerId;
    try {
      room.start(42);
      room.submitThrow(a, 'rock');
      room.submitThrow(b, 'scissors');
      room.removeParticipants([b], 'left'); // 终局归档后 transcript 才挂载到 replay 记录
      expect(room.state).toBe('over');
      const transcript = structuredClone(room.replays[0].simulation!);
      expect(transcript.inputs.length).toBeGreaterThan(0);
      // 模拟未来版本新增的输入 kind：版本号按「v1 内增量」策略未 bump，当前引擎不认识
      (transcript.inputs[0].input as { kind: string }).kind = 'timeTravel';
      expect(() => replayMatch(transcript, 1)).toThrow(/Unknown simulation input kind: timeTravel/);
    } finally {
      room.dispose();
    }
  });

  it('可重演技能判定的中间一拳，随后独立重演至终局', () => {
    const room = new Room('JUDGE', { submitTimeoutMs: 0, turnTimeoutMs: 0 });
    const a = room.addSeat('A', 'mabaoguo', 'human').playerId;
    const b = room.addSeat('B', 'default', 'human').playerId;
    const c = room.addSeat('C', 'default', 'human').playerId;
    try {
      room.start(7);
      const winThrow = () => {
        expect(room.submitThrow(a, 'rock').ok).toBe(true);
        expect(room.submitThrow(b, 'scissors').ok).toBe(true);
        expect(room.submitThrow(c, 'scissors').ok).toBe(true);
      };
      winThrow();
      expect(room.submitAction(a, { type: 'move', room: 'R2' }).ok).toBe(true);
      winThrow();
      expect(room.submitAction(a, { type: 'whip5', targetId: b }).ok).toBe(true);
      expect(room.submitThrow(a, 'rock').ok).toBe(true);
      const partial = room.game!.snapshot();
      expect(partial.judge).toMatchObject({ submittedIds: [a], last: null });
      for (let round = 1; round <= 5; round++) {
        if (round > 1) room.submitThrow(a, 'rock');
        room.submitThrow(b, 'scissors');
      }
      expect(room.game!.players[b].alive).toBe(false);
      room.removeParticipants([c], 'left');

      const transcript = room.replays[0].simulation!;
      const skill = transcript.inputs.findIndex(({ input }) => input.kind === 'action' && input.action.type === 'whip5');
      expect(skill).toBeGreaterThan(0);
      const duringJudge = replayMatch(transcript, skill + 2);
      expect(duringJudge.snapshot()).toEqual(partial);
      expect(replayMatch(transcript).logs).toEqual(room.game!.logs);
    } finally {
      room.dispose();
    }
  });

  it('移除排序参与者后立即推进，只产生一次终局归档与通知', () => {
    const { room, seats } = makeRoom(['A', 'B', 'C', 'D']);
    const [a, b, c, d] = seats.map((seat) => seat.playerId);
    const ended = vi.fn();
    room.onGameOver = ended;
    try {
      room.start(42);
      room.submitThrow(a, 'rock');
      room.submitThrow(b, 'rock');
      room.submitThrow(c, 'scissors');
      room.submitThrow(d, 'scissors');
      expect(room.game?.phase).toBe('rps2');
      room.removeParticipants([a], 'left');
      expect(room.game?.currentActor()).toBe(b);
      room.removeParticipants([c, d], 'left');
      expect(room.state).toBe('over');
      expect(room.replays).toHaveLength(1);
      expect(ended).toHaveBeenCalledTimes(1);
      expect(replayMatch(room.replays[0].simulation!).snapshot()).toEqual(room.game!.snapshot());
    } finally {
      room.dispose();
    }
  });

  it('动画帧达上限仍保留终局帧和完整可重演输入', () => {
    const { room, seats } = makeRoom(['A', 'B']);
    const [a, b] = seats.map((seat) => seat.playerId);
    try {
      room.start(7);
      for (let round = 0; round < 752; round++) {
        room.submitThrow(a, 'rock');
        room.submitThrow(b, 'rock');
      }
      room.removeParticipants([b], 'left');
      const [record] = room.replays;
      expect(record.truncated).toBe(true);
      expect(record.frames).toHaveLength(1500);
      expect(record.frames.at(-1)).toMatchObject({ i: 1499, phase: 'over', winner: a });
      expect(replayMatch(record.simulation!).logs).toEqual(room.game!.logs);
    } finally {
      room.dispose();
    }
  });
});
