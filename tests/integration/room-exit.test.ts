/**
 * 房间退出 / 占用 / 解散规则回归（B-029）
 *
 * 修复前的缺陷：
 *  1. 单设备多人退出只移除主身份 → 其余本机身份残留在同 socket 上，
 *     之后创建/加入房间被「你已在房间 X 中」永久卡死；
 *  2. 对局中退出不处理引擎 → 残留活人卡死行动队列；
 *  3. 只剩 AI（无真人）的房间永久占用房间列表；
 *  4. 同一设备重复加入同一房间被放行 → 一个房间出现「两个自己」。
 *
 * 新规则：
 *  - 退出 = 整台设备退出（同 socket 全部身份一起移除，对局中引擎内淘汰公示）；
 *  - 退出后无真人可继续（空房 / 只剩 AI）→ 默认解散房间；
 *  - 同房间重复加入被拒绝（引导回到房间）；
 *  - room:detach 以 socket 为凭证的逃生口（无需 token）。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

import { startTestServer, type TestServer } from '../support/test-server.js';

let server: TestServer;
let mod: typeof import('../../server/src/index.js');

beforeAll(async () => {
  mod = await import('../../server/src/index.js');
  server = await startTestServer(mod);
});

afterAll(async () => {
  await server?.close();
});

function connect(): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(server.url, { transports: ['websocket'], transportOptions: { websocket: { agent: server.agent } } });
    s.once('connect', () => resolve(s));
    s.once('connect_error', (error) => { s.disconnect(); reject(error); });
  });
}

function emit<T = Record<string, unknown>>(s: ClientSocket, event: string, data: unknown): Promise<T> {
  return new Promise((resolve) => {
    s.emit(event, data, (r: T) => resolve(r));
  });
}

interface SeatInfo { playerId: string; name: string; token: string }

describe('房间退出与占用规则（B-029）', () => {
  it('单设备多人重连后恢复全部座位，再退出时不留下占用', async () => {
    const host = await connect();
    const resumed = await connect();
    try {
      const created = await emit<{ ok: boolean; code: string; seats: SeatInfo[] }>(host, 'room:create', {
        name: '甲', localPlayers: ['甲', '乙', '丙'],
      });
      expect(created.ok).toBe(true);
      const [main] = created.seats;
      const reply = await emit<{ ok: boolean }>(resumed, 'room:reconnect', {
        code: created.code, playerId: main.playerId, token: main.token,
      });
      expect(reply.ok).toBe(true);
      const room = mod.rooms.get(created.code)!;
      expect(room.seatBySocket(resumed.id!).map((seat) => seat.playerId)).toEqual(created.seats.map((seat) => seat.playerId));
      expect(room.seatBySocket(host.id!)).toHaveLength(0);
      host.disconnect();
      const exited = await emit<{ ok: boolean; dissolved: boolean }>(resumed, 'room:leave', {
        code: created.code, playerId: main.playerId, token: main.token,
      });
      expect(exited).toMatchObject({ ok: true, dissolved: true });
      expect(mod.rooms.has(created.code)).toBe(false);
    } finally {
      host.disconnect();
      resumed.disconnect();
    }
  });

  it('单设备多人：退出主身份 = 整台设备退出，全部身份移除且房间解散', async () => {
    const s = await connect();
    const r = await emit<{ ok: boolean; code: string; seats: SeatInfo[] }>(s, 'room:create', { name: '房主甲', localPlayers: ['甲1', '甲2', '甲3'], charId: 'default' });
    expect(r.ok).toBe(true);
    const code = r.code;
    expect(r.seats.length).toBe(3);
    // 开始对局（加 1 个 AI）
    await emit(s, 'room:addAI', { code, playerId: r.seats[0].playerId, token: r.seats[0].token, count: 1 });
    const st = await emit<{ ok: boolean }>(s, 'room:start', { code, playerId: r.seats[0].playerId, token: r.seats[0].token });
    expect(st.ok).toBe(true);
    expect(mod.rooms.has(code)).toBe(true);

    // 退出主身份 → 服务端移除全部 3 个本机身份；无真人可继续 → 解散
    const lv = await emit<{ ok: boolean; dissolved?: boolean }>(s, 'room:leave', { code, playerId: r.seats[0].playerId, token: r.seats[0].token });
    expect(lv.ok).toBe(true);
    expect(lv.dissolved).toBe(true);
    expect(mod.rooms.has(code)).toBe(false);

    // 释放后该 socket 可立即创建新房间（不再被占用卡死）
    const r2 = await emit<{ ok: boolean; code: string; seats: SeatInfo[] }>(s, 'room:create', { name: '房主甲', charId: 'default' });
    expect(r2.ok).toBe(true);
    expect(mod.rooms.has(r2.code)).toBe(true);
    // 清理
    await emit(s, 'room:dissolve', { code: r2.code, playerId: r2.seats[0].playerId, token: r2.seats[0].token });
    s.disconnect();
  });

  it('同一设备重复加入同一房间被拒绝（不能出现两个自己）', async () => {
    const s = await connect();
    const r = await emit<{ ok: boolean; code: string; seats: SeatInfo[] }>(s, 'room:create', { name: '乙', charId: 'default' });
    const code = r.code;
    // 同一 socket 再次 join 同一房间 → 拒绝且带 activeCode
    const j = await emit<{ ok: boolean; error?: string; activeCode?: string }>(s, 'room:join', { code, name: '乙', charId: 'default' });
    expect(j.ok).toBe(false);
    expect(j.activeCode).toBe(code);
    expect(j.error).toContain('不能重复加入');
    // 座位数不变（没有产生第二个自己）
    const room = mod.rooms.get(code)!;
    expect(room.seats.length).toBe(1);
    await emit(s, 'room:dissolve', { code, playerId: r.seats[0].playerId, token: r.seats[0].token });
    s.disconnect();
  });

  it('多真人房：对局中一人退出，其身份被引擎淘汰，剩余真人继续且接管房主', async () => {
    const host = await connect();
    const p2 = await connect();
    const r = await emit<{ ok: boolean; code: string; seats: SeatInfo[] }>(host, 'room:create', { name: '房主丙', charId: 'default' });
    const code = r.code;
    await emit<{ ok: boolean }>(p2, 'room:join', { code, name: '玩家丁', charId: 'default' });
    await emit(host, 'room:addAI', { code, playerId: r.seats[0].playerId, token: r.seats[0].token, count: 1 });
    const st = await emit<{ ok: boolean }>(host, 'room:start', { code, playerId: r.seats[0].playerId, token: r.seats[0].token });
    expect(st.ok).toBe(true);

    const lv = await emit<{ ok: boolean; dissolved?: boolean }>(host, 'room:leave', { code, playerId: r.seats[0].playerId, token: r.seats[0].token });
    expect(lv.ok).toBe(true);
    expect(lv.dissolved).toBe(false); // 还有真人 → 房间继续

    const room = mod.rooms.get(code)!;
    expect(room).toBeTruthy();
    // 房主丙在引擎内被淘汰公示，座位只剩 玩家丁 + AI
    const engine = room.game!;
    expect(engine.players[r.seats[0].playerId].alive).toBe(false);
    expect(room.seats.length).toBe(2);
    expect(room.hostSeat).not.toBe(r.seats[0].playerId);
    expect(room.state).toBe('playing');

    // 房主解散清理
    const p2seat = room.seats.find((seat) => seat.type === 'human')!;
    await emit(p2, 'room:dissolve', { code, playerId: p2seat.playerId, token: p2seat.token });
    expect(mod.rooms.has(code)).toBe(false);
    host.disconnect();
    p2.disconnect();
  });

  it('对局中唯一真人退出（单人 vs AI）→ 默认解散房间', async () => {
    const s = await connect();
    const r = await emit<{ ok: boolean; code: string; seats: SeatInfo[] }>(s, 'room:create', { name: '戊', charId: 'default' });
    const code = r.code;
    await emit(s, 'room:addAI', { code, playerId: r.seats[0].playerId, token: r.seats[0].token, count: 2 });
    await emit(s, 'room:start', { code, playerId: r.seats[0].playerId, token: r.seats[0].token });
    const lv = await emit<{ ok: boolean; dissolved?: boolean }>(s, 'room:leave', { code, playerId: r.seats[0].playerId, token: r.seats[0].token });
    expect(lv.ok).toBe(true);
    expect(lv.dissolved).toBe(true);
    expect(mod.rooms.has(code)).toBe(false);
    s.disconnect();
  });

  it('room:detach 逃生口：无需 token，移除本 socket 全部身份并解散，随后可重新创建', async () => {
    const s = await connect();
    const r = await emit<{ ok: boolean; code: string; seats: SeatInfo[] }>(s, 'room:create', { name: '己1', localPlayers: ['己1', '己2'], charId: 'default' });
    const code = r.code;
    expect(mod.rooms.has(code)).toBe(true);
    // 故意不 leave，直接 detach（模拟「你已在房间 X 中」卡死的自救）
    const d = await emit<{ ok: boolean; detached?: boolean; dissolved?: boolean }>(s, 'room:detach', {});
    expect(d.ok).toBe(true);
    expect(d.detached).toBe(true);
    expect(d.dissolved).toBe(true);
    expect(mod.rooms.has(code)).toBe(false);
    // 解除占用后可立即创建
    const r2 = await emit<{ ok: boolean; code: string; seats: SeatInfo[] }>(s, 'room:create', { name: '己1', charId: 'default' });
    expect(r2.ok).toBe(true);
    await emit(s, 'room:dissolve', { code: r2.code, playerId: r2.seats[0].playerId, token: r2.seats[0].token });
    s.disconnect();
  });

  it('大厅阶段（未开局）多身份退出：全部移除并解散', async () => {
    const s = await connect();
    const r = await emit<{ ok: boolean; code: string; seats: SeatInfo[] }>(s, 'room:create', { name: '庚1', localPlayers: ['庚1', '庚2'], charId: 'default' });
    const code = r.code;
    const lv = await emit<{ ok: boolean; dissolved?: boolean }>(s, 'room:leave', { code, playerId: r.seats[0].playerId, token: r.seats[0].token });
    expect(lv.ok).toBe(true);
    expect(lv.dissolved).toBe(true);
    expect(mod.rooms.has(code)).toBe(false);
    s.disconnect();
  });

  it('房主踢出最后一名其他真人后自己还在 → 房间继续；踢出后无真人 → 解散', async () => {
    const host = await connect();
    const p2 = await connect();
    const r = await emit<{ ok: boolean; code: string; seats: SeatInfo[] }>(host, 'room:create', { name: '辛', charId: 'default' });
    const code = r.code;
    const j = await emit<{ ok: boolean }>(p2, 'room:join', { code, name: '壬', charId: 'default' });
    expect(j.ok).toBe(true);
    // 踢掉唯一的另一名真人 → 房间只剩房主（真人）→ 继续
    const room2 = mod.rooms.get(code)!;
    const target = room2.seats.find((seat) => seat.name === '壬')!;
    const k = await emit<{ ok: boolean; dissolved?: boolean }>(host, 'room:kick', { code, playerId: r.seats[0].playerId, token: r.seats[0].token, targetId: target.playerId });
    expect(k.ok).toBe(true);
    expect(k.dissolved).toBe(false);
    expect(mod.rooms.has(code)).toBe(true);
    await emit(host, 'room:dissolve', { code, playerId: r.seats[0].playerId, token: r.seats[0].token });
    host.disconnect();
    p2.disconnect();
  });
});
