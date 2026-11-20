/**
 * 超时兜底边界测试
 *
 * 规则（用户确认 2026-11-20）：超时的唯一意义是「别让别人干等你」。
 * - 单人 vs AI：没有任何人在等 → 不布防，绝不代掷/自动跳过
 * - ≥2 名真人：布防（一人挂机会拖死整桌）
 * - 单设备多人（local）：所有人同一块屏 → 不布防
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Room } from '../server/src/room.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const rooms: Room[] = [];
function makeRoom(types: ('human' | 'ai' | 'local')[], timeouts?: { submitTimeoutMs?: number; turnTimeoutMs?: number }) {
  const room = new Room('TO', {
    submitTimeoutMs: timeouts?.submitTimeoutMs ?? 40,
    turnTimeoutMs: timeouts?.turnTimeoutMs ?? 40,
  });
  types.forEach((t, i) => room.addSeat(`P${i + 1}`, 'default', t));
  rooms.push(room);
  return room;
}

const hasTimeoutLog = (room: Room) => room.game!.logs.some((l) => l.text.includes('超时'));

afterEach(() => {
  for (const r of rooms.splice(0)) r.dispose();
});

describe('超时兜底只在「有人等」时布防', () => {
  it('单人 vs AI：出拳不接受超时代掷', async () => {
    const room = makeRoom(['human', 'ai']);
    room.start(11);
    expect(room.game!.phase).toBe('rps1');

    await sleep(180);
    expect(room.game!.phase).toBe('rps1'); // 仍在等本人出拳
    expect(hasTimeoutLog(room)).toBe(false);
  });

  it('单人 vs AI：行动不接受超时跳过', async () => {
    const room = makeRoom(['human', 'ai']);
    room.start(11);
    const me = room.seats.find((s) => s.type === 'human')!.playerId;
    room.submitThrow(me, 'rock');

    // 若当前行动者是 AI，kickAI 已即时走完，轮到本人
    if (room.game!.phase === 'act' && room.game!.currentActor() === me) {
      const queueBefore = [...room.game!.queue];
      await sleep(180);
      expect(room.game!.phase).toBe('act');
      expect(room.game!.currentActor()).toBe(me);
      expect(room.game!.queue).toEqual(queueBefore);
    }
  });

  it('两名真人：出拳超时仍代掷（不破坏原有行为）', async () => {
    const room = makeRoom(['human', 'human']);
    room.start(11);
    expect(room.game!.phase).toBe('rps1');

    await sleep(180);
    expect(hasTimeoutLog(room)).toBe(true);
  });

  it('单设备多人（local）：不布防', async () => {
    const room = makeRoom(['local', 'local']);
    room.start(11);

    await sleep(180);
    expect(room.game!.phase).toBe('rps1');
    expect(hasTimeoutLog(room)).toBe(false);
  });

  it('两名真人 + AI 混合房：仍布防（AI 的存在不关闭超时）', async () => {
    const room = makeRoom(['human', 'human', 'ai']);
    room.start(11);
    expect(room.game!.phase).toBe('rps1');

    await sleep(180);
    expect(hasTimeoutLog(room)).toBe(true);
  });

  it('AI 驱动被打断时由看门狗自动恢复（不再依赖超时代打）', async () => {
    const room = makeRoom(['human', 'ai']);
    room.start(11);
    const g = room.game!;
    expect(g.submittedIds.length).toBeGreaterThan(0); // AI 开局即出拳

    // 人为抹掉已提交记录，模拟「kickAI 中途被异常打断」的卡死现场
    g.submittedIds = [];
    g.pendingThrows = {};
    await sleep(1700);

    // 看门狗只补驱动 AI，不替真人出拳
    expect(g.submittedIds.length).toBeGreaterThan(0);
    expect(g.phase).toBe('rps1');
  });
});
