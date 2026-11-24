/**
 * 真实房间对局（真服务进程 + 真 Socket.IO 客户端）：
 * 五条悟展开领域 → 平局回合获得行动资格但回合仍是平局 → 大伊万顺延到分出胜负的回合末才引爆。
 *
 * 这是对 2026-11-24 规则修订（领域只给平局行动权、不改判胜负）的端到端验证：
 * 走的是正式服务端的建房 / 出拳 / 行动 / 广播链路，而不是直接调用引擎。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

import { startTestServer, type TestServer } from '../support/test-server.js';

let server: TestServer;

beforeAll(async () => {
  const mod = await import('../../server/src/index.js');
  server = await startTestServer(mod);
});

afterAll(async () => {
  await server?.close();
});

function connect(): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(server.url, {
      transports: ['websocket'],
      transportOptions: { websocket: { agent: server.agent } },
    });
    s.once('connect', () => resolve(s));
    s.once('connect_error', (error) => { s.disconnect(); reject(error); });
  });
}

function emit<T = Record<string, unknown>>(s: ClientSocket, event: string, data: unknown): Promise<T> {
  return new Promise((resolve) => s.emit(event, data, (r: T) => resolve(r)));
}

interface SeatRef { playerId: string; token: string }
interface Update {
  game: null | {
    roundNo: number; phase: string; currentActor: string | null;
    deferred: { kind: string }[];
    players: { id: string; room: string; alive: boolean; charId: string }[];
  };
  newLogs: { seq: number; round: number; text: string }[];
}

describe('五条悟领域：真实房间对局', { timeout: 30000 }, () => {
  it('平局回合可行动但仍是平局；大伊万顺延到分出胜负的回合末', async () => {
    const host = await connect();
    const guest = await connect();

    let latest: Update | null = null;
    const logsByRound = new Map<number, string[]>();
    const seen = new Set<number>();
    host.on('room:update', (u: Update) => {
      latest = u;
      for (const l of u.newLogs ?? []) {
        if (seen.has(l.seq)) continue;
        seen.add(l.seq);
        const arr = logsByRound.get(l.round) ?? [];
        arr.push(l.text);
        logsByRound.set(l.round, arr);
      }
    });

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (pred: (u: Update) => boolean, label: string, ms = 8000): Promise<Update> => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (latest && pred(latest)) return latest;
        await sleep(20);
      }
      throw new Error(`等待超时：${label}（round=${latest?.game?.roundNo}, phase=${latest?.game?.phase}）`);
    };
    const snap = () => latest!.game!;
    const logsOf = (round: number) => logsByRound.get(round) ?? [];
    const hostRoom = () => snap().players.find((p) => p.id === me.playerId)!.room;

    const created = await emit<{ ok: boolean; code: string; seats: SeatRef[] }>(host, 'room:create', {
      name: '五条悟玩家', charId: 'gojo',
    });
    expect(created.ok).toBe(true);
    const code = created.code;
    const me = created.seats[0];

    const joined = await emit<{ ok: boolean; seats: SeatRef[] }>(guest, 'room:join', {
      code, name: '伊万玩家', charId: 'ivan-girl',
    });
    expect(joined.ok).toBe(true);
    const other = joined.seats[0];

    const started = await emit<{ ok: boolean; error?: string }>(host, 'room:start', {
      code, playerId: me.playerId, token: me.token, seed: 424242,
    });
    expect(started.ok, started.error).toBe(true);
    await waitFor((u) => u.game?.phase === 'rps1', '开局');

    const throwBoth = async (h: string, g: string) => {
      expect((await emit<{ ok: boolean }>(host, 'game:throw', { code, playerId: me.playerId, token: me.token, throw: h })).ok).toBe(true);
      expect((await emit<{ ok: boolean }>(guest, 'game:throw', { code, playerId: other.playerId, token: other.token, throw: g })).ok).toBe(true);
    };
    const act = async (s: ClientSocket, seat: SeatRef, action: Record<string, unknown>) => {
      const r = await emit<{ ok: boolean; error?: string }>(s, 'game:action', { code, playerId: seat.playerId, token: seat.token, action });
      expect(r.ok, r.error).toBe(true);
    };

    // 回合 1：同拳平局（还没有领域）→ 无人行动，直接翻页
    await throwBoth('rock', 'rock');
    await waitFor((u) => u.game?.roundNo === 2, 'R1 平局翻页');
    expect(logsOf(1).some((t) => t.includes('同拳平局'))).toBe(true);
    expect(logsOf(1).some((t) => t.includes('无人获得行动资格'))).toBe(true);
    expect(logsOf(1).some((t) => t.includes('初次判定结果'))).toBe(false);

    // 回合 2：五条悟胜出并展开领域
    await throwBoth('rock', 'scissors');
    await waitFor((u) => u.game?.phase === 'act' && u.game?.currentActor === me.playerId, 'R2 行动');
    await act(host, me, { type: 'domain' });
    await waitFor((u) => u.game?.roundNo === 3, 'R2 收尾');
    expect(logsOf(2).some((t) => t.includes('展开领域'))).toBe(true);

    // 回合 3：伊万玩家胜出 → 向五条悟所在房间投一颗大伊万
    const bombRoom = hostRoom();
    await throwBoth('rock', 'paper');
    await waitFor((u) => u.game?.phase === 'act' && u.game?.currentActor === other.playerId, 'R3 行动');
    await act(guest, other, { type: 'throwIvan', room: bombRoom });
    await waitFor((u) => u.game?.roundNo === 4, 'R3 收尾');
    expect(snap().deferred.filter((d) => d.kind === 'ivan')).toHaveLength(1);

    // 回合 4：同拳平局 + 领域生效 → 五条悟获得行动资格，但回合仍是平局、炸弹不引爆
    await throwBoth('rock', 'rock');
    const r4 = await waitFor((u) => u.game?.phase === 'act' && u.game?.currentActor === me.playerId, 'R4 领域平局行动');
    expect(r4.game!.roundNo).toBe(4);
    expect(snap().deferred.filter((d) => d.kind === 'ivan')).toHaveLength(1); // 顺延
    await act(host, me, { type: 'skip' });
    await waitFor((u) => u.game?.roundNo === 5, 'R4 收尾');
    const r4Logs = logsOf(4);
    expect(r4Logs.some((t) => t.includes('平局') && t.includes('领域'))).toBe(true);
    expect(r4Logs.some((t) => t.includes('爆炸'))).toBe(false);
    expect(r4Logs.some((t) => t.includes('初次判定结果') || t.includes('分出胜负'))).toBe(false);

    // 回合 5：分出胜负 → 回合末炸弹引爆
    await throwBoth('rock', 'scissors');
    await waitFor((u) => u.game?.phase === 'act' && u.game?.currentActor === me.playerId, 'R5 行动');
    await act(host, me, { type: 'skip' });
    await waitFor(() => logsByRound.get(5)?.some((t) => t.includes('爆炸')) ?? false, 'R5 爆炸');
    expect(logsOf(5).some((t) => t.includes('爆炸'))).toBe(true);
    expect(snap().deferred.filter((d) => d.kind === 'ivan')).toHaveLength(0);

    host.disconnect();
    guest.disconnect();
  });
});
