/**
 * 联机集成测试：真实 Socket.IO 连接
 * 覆盖：创建/加入房间、隐藏提交、AI 添加、开始游戏、状态同步、断线重连、行动提交。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

import { PROTOCOL_VERSION } from '../../shared/src/protocol.js';

import { startTestServer, type TestServer } from '../support/test-server.js';

let server: TestServer;

beforeAll(async () => {
  const mod = await import('../../server/src/index.js');
  server = await startTestServer(mod);
});

afterAll(async () => {
  await server?.close();
});

function connect(protoVer?: number): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(server.url, { transports: ['websocket'], transportOptions: { websocket: { agent: server.agent } }, auth: { protoVer } });
    s.once('connect', () => resolve(s));
    s.once('connect_error', (error) => { s.disconnect(); reject(error); });
  });
}

function emit<T = Record<string, unknown>>(s: ClientSocket, event: string, data: unknown): Promise<T> {
  return new Promise((resolve) => {
    s.emit(event, data, (r: T) => resolve(r));
  });
}

/** 等到收到携带对局状态（game 非空）的 room:update —— 消除 ack/广播竞态 */
function waitForGame(s: ClientSocket, timeoutMs = 8000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { s.off('room:update', h); reject(new Error('等待对局状态超时')); }, timeoutMs);
    const h = (u: Record<string, unknown>) => {
      if (u.game) { clearTimeout(t); s.off('room:update', h); resolve(u); }
    };
    s.on('room:update', h);
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
  it('接受当前版本与旧客户端，拒绝不兼容版本', async () => {
    const legacy = await connect();
    const current = await connect(PROTOCOL_VERSION);
    try {
      const update = waitFor(current, 'room:update');
      await emit(current, 'room:create', { name: '版本测试' });
      expect(await update).toMatchObject({ v: PROTOCOL_VERSION });
      await expect(connect(PROTOCOL_VERSION + 1)).rejects.toMatchObject({
        data: { code: 'PROTOCOL_VERSION', supported: [PROTOCOL_VERSION] },
      });
    } finally {
      legacy.disconnect();
      current.disconnect();
    }
  });

  it('加入房间只返回本设备的座位凭证，房主保留所有本地座位凭证', async () => {
    type Seat = { playerId: string; name: string; token: string };
    type Result = { ok: boolean; code: string; seats: Seat[] };
    const host = await connect();
    const guest = await connect();
    const guest2 = await connect();
    const resumed = await connect();
    try {
      const created = await emit<Result>(host, 'room:create', { name: '房主', localPlayers: ['房主', '本地玩家'] });
      expect(created.ok).toBe(true);
      expect(created.seats.map((s) => s.name)).toEqual(['房主', '本地玩家']);
      expect(created.seats.every((s) => !!s.token)).toBe(true);

      const joined = await emit<Result>(guest, 'room:join', { code: created.code, name: '客人' });
      expect(joined.ok).toBe(true);
      expect(joined.seats).toHaveLength(1);
      expect(joined.seats[0].name).toBe('客人');
      expect(joined.seats[0].token).toBeTruthy();
      for (const seat of created.seats) expect(JSON.stringify(joined)).not.toContain(seat.token);

      const joined2 = await emit<Result>(guest2, 'room:join', { code: created.code, name: '客人二' });
      expect(joined2.ok).toBe(true);
      expect(joined2.seats).toHaveLength(1);
      expect(joined2.seats[0].name).toBe('客人二');
      expect(joined2.seats[0].token).toBeTruthy();
      for (const seat of [...created.seats, ...joined.seats]) expect(JSON.stringify(joined2)).not.toContain(seat.token);

      const reconnect = await emit<{ ok: boolean }>(resumed, 'room:reconnect', {
        code: created.code, playerId: joined.seats[0].playerId, token: joined.seats[0].token,
      });
      expect(reconnect.ok).toBe(true);
    } finally {
      host.disconnect(); guest.disconnect(); guest2.disconnect(); resumed.disconnect();
    }
  });

  it.each([true, false])('创建房间的天气开关 %s 同步给房客并作用于对局', async (weather) => {
    const host = await connect();
    const guest = await connect();
    try {
      const map = { id: 'floating-ruins', mechanics: { weather } };
      const created = await emit<{ ok: boolean; code: string; seats: { playerId: string; token: string }[] }>(host, 'room:create', { name: '房主', map });
      expect(created.ok).toBe(true);
      const joinedUpdate = waitFor(guest, 'room:update');
      expect((await emit<{ ok: boolean }>(guest, 'room:join', { code: created.code, name: '房客' })).ok).toBe(true);
      const lobby = (await joinedUpdate).lobby as { config: { map: unknown } };
      expect(lobby.config.map).toEqual(map);
      const started = waitForGame(guest);
      expect((await emit<{ ok: boolean }>(host, 'room:start', { code: created.code, ...created.seats[0], seed: 1 })).ok).toBe(true);
      const game = (await started).game as { ruins?: unknown };
      expect(Boolean(game.ruins)).toBe(weather);
    } finally { host.disconnect(); guest.disconnect(); }
  });

  it('拒绝未知地图和无效天气选项', async () => {
    const host = await connect();
    try {
      for (const map of [{ id: 'unknown', mechanics: { weather: true } }, { id: 'floating-ruins', mechanics: { weather: 'false' } }]) {
        expect((await emit<{ ok: boolean }>(host, 'room:create', { name: '房主', map })).ok).toBe(false);
      }
    } finally { host.disconnect(); }
  });

  it('创建房间 → 第二名玩家加入 → 广播座位同步', async () => {
    const host = await connect();
    const createRes = await emit<{ ok: boolean; code: string; seats: { playerId: string; token: string }[] }>(
      host, 'room:create', { name: '房主' },
    );
    expect(createRes.ok).toBe(true);
    expect(createRes.code).toHaveLength(4);

    const guest = await connect();
    const updatePromise = waitFor(host, 'room:update');
    const joinRes = await emit<{ ok: boolean; code: string }>(guest, 'room:join', { code: createRes.code, name: '客人' });
    expect(joinRes.ok).toBe(true);

    const update = await updatePromise;
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

  it('添加AI → 开始 → AI自动完成对局到游戏结束', { timeout: 60000 }, async () => {
    const host = await connect();
    const createRes = await emit<{ ok: boolean; code: string; seats: { playerId: string; token: string }[] }>(
      host, 'room:create', { name: '勇者' },
    );
    const code = createRes.code;
    const me = createRes.seats[0];
    // AI 角色固定为 default（对局时长确定，避免随机角色组合偶发拖过 50s 等待；
    // 「随机选角」行为由下方「AI 角色选择」用例专项覆盖）
    await emit(host, 'room:addAI', { code, playerId: me.playerId, token: me.token, count: 2, charId: 'default' });

    // 先注册监听器再开始游戏（避免错过首条广播造成驱动死锁）
    const overPromise = waitFor(host, 'game:over', 50000);
    // 单人 vs AI 房间不再布防超时（T-901），因此驱动必须自身健壮：
    // 以最近一次快照为准，事件触发 + 400ms 心跳双重驱动；行动被拒时回退跳过，避免永久卡死。
    let lastGame: Record<string, unknown> | null = null;
    const drive = () => {
      const game = lastGame;
      if (!game) return;
      if (game.phase === 'rps1') {
        const throws = ['rock', 'scissors', 'paper'];
        host.emit('game:throw', { code, playerId: me.playerId, token: me.token, throw: throws[Math.floor(Math.random() * 3)] }, () => {});
      } else if (game.phase === 'rps2') {
        // 二次判定（行动排序）：只有当前子轮参与组里的本机身份需要出拳
        const group = (game.orderGroup as string[] | undefined) ?? [];
        const done = (game.orderSubmittedIds as string[] | undefined) ?? [];
        if (!group.includes(me.playerId) || done.includes(me.playerId)) return;
        const throws = ['rock', 'scissors', 'paper'];
        host.emit('game:throw', { code, playerId: me.playerId, token: me.token, throw: throws[Math.floor(Math.random() * 3)] }, () => {});
      } else if (game.phase === 'act') {
        const cur = game.currentActor as string | null;
        if (cur !== me.playerId) return;
        const players = game.players as { id: string; alive: boolean; room: string; hidden: boolean }[];
        const meP = players.find((p) => p.id === me.playerId);
        const sameRoom = players.filter((p) => p.alive && p.id !== me.playerId && p.room === meP?.room && !p.hidden);
        const others = players.filter((p) => p.alive && p.id !== me.playerId);
        let action: Record<string, unknown>;
        if (sameRoom.length > 0) action = { type: 'attack', targetId: sameRoom[0].id };
        else if (others.length > 0) action = { type: 'move', room: others[0].room };
        else action = { type: 'skip' };
        const send = (act: Record<string, unknown>, retry: boolean) => {
          host.emit('game:action', { code, playerId: me.playerId, token: me.token, action: act }, (res?: { ok?: boolean }) => {
            if (retry && res && res.ok === false) send({ type: 'skip' }, false);
          });
        };
        send(action, true);
      }
    };
    host.on('room:update', (u: Record<string, unknown>) => {
      lastGame = (u.game as Record<string, unknown> | null) ?? null;
      drive();
    });
    const heartbeat = setInterval(drive, 400);
    try {
      // 监听就绪后再开始
      const startRes = await emit<{ ok: boolean }>(host, 'room:start', { code, playerId: me.playerId, token: me.token, seed: 777 });
      expect(startRes.ok).toBe(true);
      const over = await overPromise;
      expect(over).toBeTruthy();
    } finally {
      clearInterval(heartbeat);
    }
    host.disconnect();
  });

  it('AI 角色选择：随机 / 手动指定 / 房主改角色', async () => {
    const host = await connect();
    const createRes = await emit<{ ok: boolean; code: string; seats: { playerId: string; token: string }[] }>(
      host, 'room:create', { name: 'AI选角测试' },
    );
    const code = createRes.code;
    const me = createRes.seats[0];

    // 随机角色 AI
    await emit(host, 'room:addAI', { code, playerId: me.playerId, token: me.token, count: 2, charId: 'random' });
    // 指定角色 AI
    await emit(host, 'room:addAI', { code, playerId: me.playerId, token: me.token, count: 1, charId: 'gojo' });
    // 广播随 addAI 已发；此时注册监听，用 game:state 触发一次广播取最新座位表
    const upd2Promise = new Promise<Record<string, unknown>>((resolve) => host.once('room:update', resolve));
    await emit(host, 'game:state', { code });
    const upd2 = await upd2Promise;
    const seats = (upd2.lobby as { seats: { charId: string; type: string }[] }).seats;
    const aiSeats = seats.filter((x) => x.type === 'ai');
    expect(aiSeats).toHaveLength(3);
    expect(aiSeats.filter((x) => x.charId === 'gojo').length).toBeGreaterThanOrEqual(1); // 随机也可能抽中五条悟
    // 随机的两个都应是注册表内的合法角色
    const { CHARACTERS } = await import('../../shared/src/characters/index.js');
    for (const a of aiSeats) expect(CHARACTERS[a.charId]).toBeTruthy();

    // 房主为已有 AI 改角色
    const aiId = (upd2.lobby as { seats: { playerId: string; type: string }[] }).seats
      .filter((x) => x.type === 'ai')[0].playerId;
    const upd3Promise = new Promise<Record<string, unknown>>((resolve) => host.once('room:update', resolve));
    const setRes = await emit<{ ok: boolean }>(host, 'room:setChar', { code, playerId: me.playerId, token: me.token, charId: 'dajianke', targetId: aiId });
    expect(setRes.ok).toBe(true);
    const upd3 = await upd3Promise;
    const changed = (upd3.lobby as { seats: { playerId: string; charId: string }[] }).seats.find((x) => x.playerId === aiId);
    expect(changed?.charId).toBe('dajianke');

    // 非房主不能为 AI 改角色（本房间只有房主一人，直接测错误令牌）
    const badSet = await emit<{ ok: boolean }>(host, 'room:setChar', { code, playerId: me.playerId, token: 'bad', charId: 'gojo', targetId: aiId });
    expect(badSet.ok).toBe(false);
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

  it('重连后只有新连接能使用该座位进行房主操作', async () => {
    const original = await connect();
    const replacement = await connect();
    try {
      const created = await emit<{ code: string; seats: { playerId: string; token: string }[] }>(
        original, 'room:create', { name: '主座位' },
      );
      const auth = { code: created.code, ...created.seats[0] };
      expect(await emit(original, 'room:addAI', { ...auth, token: 'invalid' })).toMatchObject({ ok: false });
      expect(await emit(replacement, 'room:reconnect', auth)).toMatchObject({ ok: true });
      expect(await emit(original, 'room:addAI', auth)).toMatchObject({ ok: false });
      expect(await emit(replacement, 'room:addAI', auth)).toMatchObject({ ok: true });
      expect(await emit(original, 'room:start', auth)).toMatchObject({ ok: false });
      expect(await emit(replacement, 'room:start', auth)).toMatchObject({ ok: true });
      expect(await emit(original, 'room:restart', auth)).toMatchObject({ ok: false });
    } finally {
      original.disconnect();
      replacement.disconnect();
    }
  });

  it('未结算的输入不随回放下发，终局输入仅供有凭证的参赛者读取', async () => {
    const host = await connect();
    const guest = await connect();
    const observer = await connect();
    try {
      type Membership = { code: string; seats: { playerId: string; token: string }[] };
      type ReplayList = { live: string | null; replays: { id: string }[] };
      const created = await emit<Membership>(host, 'room:create', { name: '对局甲' });
      const { code } = created;
      const joined = await emit<Membership>(guest, 'room:join', { code, name: '对局乙' });
      const hostAuth = { code, ...created.seats[0] };
      expect(await emit(host, 'room:start', { ...hostAuth, seed: 7 })).toMatchObject({ ok: true });
      expect(await emit(host, 'game:throw', { ...hostAuth, throw: 'paper' })).toMatchObject({ ok: true });
      const live = await emit<ReplayList>(host, 'replay:list', { code });
      expect(live.live).toBeTruthy();
      const active = await emit<{ ok: boolean; replay: object }>(host, 'replay:get', { ...hostAuth, id: live.live });
      expect(active.ok).toBe(true);
      expect(active.replay).not.toHaveProperty('simulation');
      expect(JSON.stringify(active.replay)).not.toContain('paper');

      expect(await emit(guest, 'room:leave', { code, ...joined.seats[0] })).toMatchObject({ ok: true });
      const finished = await emit<ReplayList>(host, 'replay:list', { code });
      const id = finished.replays[0].id;
      const publicResult = await emit<{ ok: boolean; replay: object }>(observer, 'replay:get', { code, id });
      expect(publicResult.ok).toBe(true);
      expect(publicResult.replay).not.toHaveProperty('simulation');
      const privateResult = await emit<{ ok: boolean; replay: object }>(host, 'replay:get', { ...hostAuth, id });
      expect(privateResult.ok).toBe(true);
      expect(privateResult.replay).toHaveProperty('simulation');
    } finally {
      host.disconnect();
      guest.disconnect();
      observer.disconnect();
    }
  });

  it('断线重连后广播恢复（自动重绑定座位）', async () => {
    const host = await connect();
    const createRes = await emit<{ ok: boolean; code: string; seats: { playerId: string; token: string }[] }>(
      host, 'room:create', { name: '重连恢复测试' },
    );
    const code = createRes.code;
    const me = createRes.seats[0];

    // 主动断开（服务器清除 socketId）
    host.disconnect();
    await new Promise((r) => setTimeout(r, 400));
    // 同一 client 重连（模拟 socket.io 自动重连）
    host.connect();
    await new Promise<void>((resolve) => host.once('connect', () => resolve()));
    // 客户端重新绑定座位（与前端 net.ts 断线自动重连行为一致）
    const recRes = await emit<{ ok: boolean }>(host, 'room:reconnect', { code, playerId: me.playerId, token: me.token });
    expect(recRes.ok).toBe(true);

    // 注册监听后再触发广播
    const updPromise = new Promise<Record<string, unknown>>((resolve) => host.once('room:update', resolve));
    const chatRes = await emit<{ ok: boolean }>(host, 'room:chat', { code, playerId: me.playerId, token: me.token, text: '重连后还能收到' });
    expect(chatRes.ok).toBe(true);
    const upd = await updPromise;
    const chat = ((upd.lobby as { chat: { text: string }[] }).chat || []).map((c) => c.text);
    expect(chat).toContain('重连后还能收到');
    host.disconnect();
  });

  it('房主踢人：对局中踢人=淘汰+移除；非房主拒绝', async () => {
    const host = await connect();
    const createRes = await emit<{ ok: boolean; code: string; seats: { playerId: string; token: string }[] }>(
      host, 'room:create', { name: '踢人测试' },
    );
    const code = createRes.code;
    const me = createRes.seats[0];
    await emit(host, 'room:addAI', { code, playerId: me.playerId, token: me.token, count: 2, charId: 'random' });
    // 注册监听再开始
    const updPromise = new Promise<Record<string, unknown>>((resolve) => host.once('room:update', resolve));
    await emit(host, 'room:start', { code, playerId: me.playerId, token: me.token, seed: 900 });

    // 出拳阶段先踢一个 AI（对局中 → 引擎内淘汰）
    const lobby0 = (await updPromise).lobby as { seats: { playerId: string; name: string }[] };
    const aiId = lobby0.seats.find((x) => x.name.startsWith('AI'))!.playerId;
    const upd2Promise = new Promise<Record<string, unknown>>((resolve) => host.once('room:update', resolve));
    const kickRes = await emit<{ ok: boolean }>(host, 'room:kick', { code, playerId: me.playerId, token: me.token, targetId: aiId });
    expect(kickRes.ok).toBe(true);
    const upd2 = await upd2Promise;
    const game = upd2.game as { players: { id: string; alive: boolean }[] } | null;
    expect(game).toBeTruthy();
    expect(game!.players.find((p) => p.id === aiId)?.alive).toBe(false);
    // 座位已移除
    const lobby1 = upd2.lobby as { seats: { playerId: string }[] };
    expect(lobby1.seats.find((s2) => s2.playerId === aiId)).toBeUndefined();

    // 非房主令牌踢人被拒
    const badKick = await emit<{ ok: boolean }>(host, 'room:kick', { code, playerId: me.playerId, token: 'bad', targetId: me.playerId });
    expect(badKick.ok).toBe(false);
    host.disconnect();
  });

  it('解散房间 / 对局中退出=淘汰 / 一人一房间 / 名字必填', { timeout: 20000 }, async () => {
    // —— 名字必填 ——
    const anon = await connect();
    const noName = await emit<{ ok: boolean; error?: string }>(anon, 'room:create', { name: '  ' });
    expect(noName.ok).toBe(false);
    expect(noName.error).toContain('昵称');
    anon.disconnect();

    // —— 一人一房间 ——
    const host = await connect();
    const c1 = await emit<{ ok: boolean; code: string; seats: { playerId: string; token: string }[] }>(host, 'room:create', { name: '房主甲' });
    const code1 = c1.code;
    const guard = await emit<{ ok: boolean; error?: string }>(host, 'room:join', { code: 'ZZZZ', name: '房主甲' });
    expect(guard.ok).toBe(false);
    expect(guard.error).toContain('你已在房间');
    host.disconnect();

    // —— 解散房间：成员收到 dissolved，房间从列表消失 ——
    const owner = await connect();
    const c2 = await emit<{ ok: boolean; code: string; seats: { playerId: string; token: string }[] }>(owner, 'room:create', { name: '解散测试' });
    const code2 = c2.code;
    const member = await connect();
    await emit(member, 'room:join', { code: code2, name: '成员乙' });
    const dissolvedPromise = new Promise<{ code: string }>((resolve) => member.once('room:dissolved', resolve));
    // 非房主解散被拒
    const badDissolve = await emit<{ ok: boolean }>(member, 'room:dissolve', { code: code2, playerId: 'x', token: 'y' });
    expect(badDissolve.ok).toBe(false);
    // 房主解散
    const dissolveRes = await emit<{ ok: boolean }>(owner, 'room:dissolve', { code: code2, playerId: c2.seats[0].playerId, token: c2.seats[0].token });
    expect(dissolveRes.ok).toBe(true);
    const dissolved = await dissolvedPromise;
    expect(dissolved.code).toBe(code2);
    // 房间从列表消失
    const listRes = await emit<{ ok: boolean; rooms: { code: string }[] }>(owner, 'lobby:roomsReq', {});
    expect(listRes.rooms.find((r) => r.code === code2)).toBeUndefined();
    owner.disconnect();
    member.disconnect();

    // —— 对局中退出 = 淘汰（由留在房间的成员观察） ——
    const host2 = await connect();
    const c3 = await emit<{ ok: boolean; code: string; seats: { playerId: string; token: string }[] }>(host2, 'room:create', { name: '退出测试' });
    const code3 = c3.code;
    const h2 = c3.seats[0];
    const guest = await connect();
    await emit(guest, 'room:join', { code: code3, name: '观察员' });
    await emit(host2, 'room:addAI', { code: code3, playerId: h2.playerId, token: h2.token, count: 1, charId: 'random' });
    const startUpdate = waitForGame(guest);
    await emit(host2, 'room:start', { code: code3, playerId: h2.playerId, token: h2.token, seed: 950 });
    const upd = await startUpdate;
    expect((upd.game as { phase: string }).phase).toBe('rps1');
    // 房主退出 → 引擎内淘汰 → 观察员收到广播
    const upd2Promise = waitForGame(guest);
    const leaveRes = await emit<{ ok: boolean }>(host2, 'room:leave', { code: code3, playerId: h2.playerId, token: h2.token });
    expect(leaveRes.ok).toBe(true);
    const upd2 = await upd2Promise;
    const game = upd2.game as { players: { id: string; alive: boolean }[] };
    expect(game.players.find((p) => p.id === h2.playerId)?.alive).toBe(false);
    // 座位已移除
    const lobby1 = upd2.lobby as { seats: { playerId: string }[] };
    expect(lobby1.seats.find((x) => x.playerId === h2.playerId)).toBeUndefined();
    host2.disconnect();
    guest.disconnect();
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

describe('房间人数上限（10 人）', () => {
  it('创建房间：本机人数超过 10 直接拒绝，不留僵尸房间', async () => {
    const host = await connect();
    const r = await emit<{ ok: boolean; error?: string }>(host, 'room:create', {
      name: '超限测试专用房主', localPlayers: Array.from({ length: 11 }, (_, i) => `本机${i + 1}`),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('10');
    const list = await emit<{ ok: boolean; rooms: { hostName: string }[] }>(host, 'lobby:roomsReq', {});
    expect(list.rooms.some((x) => x.hostName === '超限测试专用房主')).toBe(false);
    host.disconnect();
  });

  it('加入房间：满 10 人后拒绝新玩家', async () => {
    const host = await connect();
    const c = await emit<{ ok: boolean; code: string; seats: { playerId: string; token: string }[] }>(host, 'room:create', {
      name: '满房房主', localPlayers: Array.from({ length: 10 }, (_, i) => `P${i + 1}`),
    });
    expect(c.ok).toBe(true);
    expect(c.seats).toHaveLength(10);
    const guest = await connect();
    const j = await emit<{ ok: boolean; error?: string }>(guest, 'room:join', { code: c.code, name: '后来者' });
    expect(j.ok).toBe(false);
    expect(j.error).toContain('已满');
    guest.disconnect();
    host.disconnect();
  });

  it('添加 AI：请求 20 个也只补到 10 人', async () => {
    const host = await connect();
    const c = await emit<{ ok: boolean; code: string; seats: { playerId: string; token: string }[] }>(host, 'room:create', { name: 'AI 房主' });
    const me = c.seats[0];
    const a = await emit<{ ok: boolean }>(host, 'room:addAI', { code: c.code, playerId: me.playerId, token: me.token, count: 20 });
    expect(a.ok).toBe(true);
    const list = await emit<{ ok: boolean; rooms: { code: string; seatCount: number }[] }>(host, 'lobby:roomsReq', {});
    expect(list.rooms.find((x) => x.code === c.code)?.seatCount).toBe(10);
    host.disconnect();
  });
});
