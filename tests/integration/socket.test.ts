/**
 * 联机集成测试：真实 Socket.IO 连接
 * 覆盖：创建/加入房间、隐藏提交、AI 添加、开始游戏、状态同步、断线重连、行动提交。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

let serverUrl: string;
let httpServer: import('node:http').Server;

beforeAll(async () => {
  const mod = await import('../../server/src/index.js');
  httpServer = (mod as { httpServer: import('node:http').Server }).httpServer;
  (mod as { startServer: (port?: number) => void }).startServer(0);
  await new Promise<void>((resolve) => httpServer.once('listening', () => resolve()));
  const addr = httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 3100;
  serverUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
    setTimeout(resolve, 500);
  });
});

function connect(): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(serverUrl, { transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

function emit<T = Record<string, unknown>>(s: ClientSocket, event: string, data: unknown): Promise<T> {
  return new Promise((resolve) => {
    s.emit(event, data, (r: T) => resolve(r));
  });
}

function waitFor(s: ClientSocket, event: string, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`等待事件 ${event} 超时`)), timeoutMs);
    s.once(event, (r: Record<string, unknown>) => {
      clearTimeout(t);
      resolve(r);
    });
  });
}

describe('拔典联机系统', () => {
  it('创建房间 → 第二名玩家加入 → 广播座位同步', async () => {
    const host = await connect();
    const createRes = await emit<{ ok: boolean; code: string; seats: { playerId: string; token: string }[] }>(
      host, 'room:create', { name: '房主' },
    );
    expect(createRes.ok).toBe(true);
    expect(createRes.code).toHaveLength(4);

    const guest = await connect();
    const joinRes = await emit<{ ok: boolean; code: string }>(guest, 'room:join', { code: createRes.code, name: '客人' });
    expect(joinRes.ok).toBe(true);

    const update = await waitFor(host, 'room:update');
    const lobby = update.lobby as { seats: { name: string }[] };
    expect(lobby.seats.map((s) => s.name).sort()).toEqual(['客人', '房主']);
    host.disconnect();
    guest.disconnect();
  });

  it('隐藏出拳：提交后广播不含出拳值，全部提交后判定揭示', async () => {
    const host = await connect();
    const createRes = await emit<{ ok: boolean; code: string; seats: { playerId: string; token: string }[] }>(
      host, 'room:create', { name: '甲' },
    );
    const code = createRes.code;
    const hostSeat = createRes.seats[0];
    const guest = await connect();
    const joinRes = await emit<{ ok: boolean }>(guest, 'room:join', { code, name: '乙' });
    expect(joinRes.ok).toBe(true);

    // host 开始（两名真人直接开局）
    const startRes = await emit<{ ok: boolean; error?: string }>(host, 'room:start', { code, playerId: hostSeat.playerId, token: hostSeat.token });
    expect(startRes.ok).toBe(true);

    // guest 先注册监听，再由 host 提交出拳（避免竞态）
    const updPromise = new Promise<Record<string, unknown>>((resolve) => guest.once('room:update', resolve));
    const throwRes = await emit<{ ok: boolean }>(host, 'game:throw', { code, playerId: hostSeat.playerId, token: hostSeat.token, throw: 'rock' });
    expect(throwRes.ok).toBe(true);
    const upd = await updPromise;
    const snap = JSON.stringify(upd.game);
    expect(snap).not.toContain('"rock"');
    expect(snap).not.toContain('"scissors"');
    expect(snap).not.toContain('"paper"');

    host.disconnect();
    guest.disconnect();
  });

  it('添加AI → 开始 → AI自动完成对局到游戏结束', { timeout: 30000 }, async () => {
    const host = await connect();
    const createRes = await emit<{ ok: boolean; code: string; seats: { playerId: string; token: string }[] }>(
      host, 'room:create', { name: '勇者' },
    );
    const code = createRes.code;
    const me = createRes.seats[0];
    await emit(host, 'room:addAI', { code, playerId: me.playerId, token: me.token, count: 2 });

    // 先注册监听器再开始游戏（避免错过首条广播造成驱动死锁）
    const overPromise = waitFor(host, 'game:over', 25000);
    host.on('room:update', (u: Record<string, unknown>) => {
      const game = u.game as Record<string, unknown> | null;
      if (!game) return;
      if (game.phase === 'rps1') {
        const throws = ['rock', 'scissors', 'paper'];
        host.emit('game:throw', { code, playerId: me.playerId, token: me.token, throw: throws[Math.floor(Math.random() * 3)] }, () => {});
      } else if (game.phase === 'act') {
        const cur = game.currentActor as string | null;
        if (cur === me.playerId) {
          const players = game.players as { id: string; alive: boolean; room: string; hidden: boolean }[];
          const meP = players.find((p) => p.id === me.playerId)!;
          const sameRoom = players.filter((p) => p.alive && p.id !== me.playerId && p.room === meP.room && !p.hidden);
          const others = players.filter((p) => p.alive && p.id !== me.playerId);
          let action: Record<string, unknown>;
          if (sameRoom.length > 0) action = { type: 'attack', targetId: sameRoom[0].id };
          else if (others.length > 0) action = { type: 'move', room: others[0].room };
          else action = { type: 'skip' };
          host.emit('game:action', { code, playerId: me.playerId, token: me.token, action }, () => {});
        }
      }
    });
    // 监听就绪后再开始
    const startRes = await emit<{ ok: boolean }>(host, 'room:start', { code, playerId: me.playerId, token: me.token, seed: 777 });
    expect(startRes.ok).toBe(true);
    const over = await overPromise;
    expect(over).toBeTruthy();
    host.disconnect();
  });

  it('断线重连：令牌恢复身份与房间状态', async () => {
    const host = await connect();
    const createRes = await emit<{ ok: boolean; code: string; seats: { playerId: string; token: string }[] }>(
      host, 'room:create', { name: '重连测试' },
    );
    const code = createRes.code;
    const me = createRes.seats[0];

    host.disconnect();
    const reconnected = await connect();
    const recRes = await emit<{ ok: boolean; playerId: string; name: string }>(
      reconnected, 'room:reconnect', { code, playerId: me.playerId, token: me.token },
    );
    expect(recRes.ok).toBe(true);
    expect(recRes.name).toBe('重连测试');

    // 错误令牌被拒绝
    const bad = await connect();
    const badRes = await emit<{ ok: boolean }>(bad, 'room:reconnect', { code, playerId: me.playerId, token: 'wrong' });
    expect(badRes.ok).toBe(false);
    bad.disconnect();
    reconnected.disconnect();
  });

  it('大厅房间列表与房间聊天', async () => {
    const host = await connect();
    const createRes = await emit<{ ok: boolean; code: string; seats: { playerId: string; token: string }[] }>(
      host, 'room:create', { name: '列表测试' },
    );
    const code = createRes.code;
    const me = createRes.seats[0];

    // 请求房间列表
    const listRes = await emit<{ ok: boolean; rooms: { code: string; hostName: string }[] }>(host, 'lobby:roomsReq', {});
    expect(listRes.ok).toBe(true);
    expect(listRes.rooms.some((r) => r.code === code && r.hostName === '列表测试')).toBe(true);

    // 先注册监听再发聊天（避免竞态漏掉广播）
    const updPromise = new Promise<Record<string, unknown>>((resolve) => host.once('room:update', resolve));
    // 聊天
    const chatRes = await emit<{ ok: boolean }>(host, 'room:chat', { code, playerId: me.playerId, token: me.token, text: '大家好！' });
    expect(chatRes.ok).toBe(true);
    // 错误令牌聊天被拒绝
    const badChat = await emit<{ ok: boolean }>(host, 'room:chat', { code, playerId: me.playerId, token: 'bad', text: 'hack' });
    expect(badChat.ok).toBe(false);
    // 空消息被拒绝
    const emptyChat = await emit<{ ok: boolean }>(host, 'room:chat', { code, playerId: me.playerId, token: me.token, text: '  ' });
    expect(emptyChat.ok).toBe(false);

    // room:update 携带聊天记录
    const upd = await updPromise;
    const chat = ((upd.lobby as { chat: { text: string }[] }).chat || []).map((c) => c.text);
    expect(chat).toContain('大家好！');

    host.disconnect();
  });

  it('非法操作：非当前行动者提交被拒绝、令牌校验失败', async () => {
    const host = await connect();
    const createRes = await emit<{ ok: boolean; code: string; seats: { playerId: string; token: string }[] }>(
      host, 'room:create', { name: '校验测试' },
    );
    const code = createRes.code;
    const me = createRes.seats[0];
    // 未开始时提交行动 → 拒绝
    const actRes = await emit<{ ok: boolean; error?: string }>(host, 'game:action', { code, playerId: me.playerId, token: me.token, action: { type: 'skip' } });
    expect(actRes.ok).toBe(false);
    // 错误令牌出拳 → 拒绝
    const badThrow = await emit<{ ok: boolean; error?: string }>(host, 'game:throw', { code, playerId: me.playerId, token: 'bad', throw: 'rock' });
    expect(badThrow.ok).toBe(false);
    host.disconnect();
  });

  it('单设备多人：同一连接绑定多个身份，各自提交', async () => {
    const host = await connect();
    const createRes = await emit<{ ok: boolean; code: string; seats: { playerId: string; token: string }[] }>(
      host, 'room:create', { name: '大侠', localPlayers: ['大侠', '二侠'] },
    );
    const code = createRes.code;
    expect(createRes.seats).toHaveLength(2);
    const me = createRes.seats[0];
    const me2 = createRes.seats[1];
    // 加1个AI后开始
    await emit(host, 'room:addAI', { code, playerId: me.playerId, token: me.token, count: 1 });
    const startRes = await emit<{ ok: boolean }>(host, 'room:start', { code, playerId: me.playerId, token: me.token, seed: 888 });
    expect(startRes.ok).toBe(true);
    // 两个身份都可提交出拳
    const t1 = await emit<{ ok: boolean }>(host, 'game:throw', { code, playerId: me.playerId, token: me.token, throw: 'rock' });
    const t2 = await emit<{ ok: boolean }>(host, 'game:throw', { code, playerId: me2.playerId, token: me2.token, throw: 'paper' });
    expect(t1.ok).toBe(true);
    expect(t2.ok).toBe(true);
    host.disconnect();
  });
});
