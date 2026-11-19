/**
 * 拔典 · 联机服务端
 * Express + Socket.IO。房间制联机、隐藏提交、断线重连、单设备多人。
 * 客户端只负责展示/输入/请求/状态接收，一切游戏结果由服务端规则引擎决定。
 */

import express from 'express';
import { createServer } from 'http';
import { Server, type Socket } from 'socket.io';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Room } from './room.js';
import { CHARACTERS } from '../../shared/src/characters/index.js';
import type { PlayerId, ActionRequest, Throw } from '../../shared/src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3100);

/** 兼容源码布局（server/src）与编译布局（server/dist/server/src）的客户端静态目录查找 */
function findClientDist(): string {
  const candidates = [
    path.resolve(__dirname, '../../client/dist'),
    path.resolve(__dirname, '../../../../client/dist'),
  ];
  for (const c of candidates) {
    if (existsSync(path.join(c, 'index.html'))) return c;
  }
  return candidates[0];
}
const CLIENT_DIST = process.env.CLIENT_DIST || findClientDist();

const app = express();
app.use(express.static(CLIENT_DIST));
app.get('/api/health', (_req, res) => res.json({ ok: true, game: 'badian', time: Date.now() }));
app.get('/api/characters', (_req, res) => {
  res.json(Object.values(CHARACTERS).map((c) => ({
    id: c.id, name: c.name, desc: c.desc, hp: c.hp, attack: c.attack,
    dataMissing: c.dataMissing ?? [],
  })));
});
app.get('*', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const rooms = new Map<string, Room>();

function genRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? genRoomCode() : code;
}

function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

/** 广播房间状态（大厅 + 游戏快照 + 增量日志） */
/** 向全部客户端广播房间列表（大厅房间列表用） */
function broadcastLobby(): void {
  const list = [...rooms.values()].map((r) => r.listEntry());
  io.emit('lobby:rooms', { rooms: list });
}

function broadcastRoom(room: Room): void {
  const lastLogSeq = (room as unknown as { _lastLogSeq?: number })._lastLogSeq ?? 0;
  const snap = room.game ? room.game.snapshot() : null;
  let newLogs: unknown[] = [];
  if (snap) {
    const logs = (snap.logs as { seq: number; round: number; type: string; text: string }[]) || [];
    newLogs = logs.filter((l) => l.seq > lastLogSeq);
    if (logs.length > 0) (room as unknown as { _lastLogSeq?: number })._lastLogSeq = logs[logs.length - 1].seq;
  }
  for (const seat of room.seats) {
    if (!seat.socketId) continue;
    io.to(seat.socketId).emit('room:update', {
      lobby: room.lobbySnapshot(),
      game: snap,
      newLogs,
      you: seat.playerId,
    });
  }
}

io.on('connection', (socket: Socket) => {
  // ── 创建房间 ──
  socket.on('room:create', (data: { name: string; charId?: string; localPlayers?: string[] }, ack?: (r: unknown) => void) => {
    try {
      const code = genRoomCode();
      const room = new Room(code);
      rooms.set(code, room);
      room.onBroadcast = broadcastRoom;
      room.onGameOver = () => io.to(code).emit('game:over', { winner: room.game?.winner ?? null });
      const names = data.localPlayers && data.localPlayers.length > 0 ? data.localPlayers : [data.name || '玩家1'];
      const first = room.addSeat(names[0], data.charId || 'default', 'human');
      first.socketId = socket.id;
      first.connected = true;
      // 单设备多人：同一 socket 绑定多个本地身份
      for (let i = 1; i < names.length; i++) {
        const seat = room.addSeat(names[i], data.charId || 'default', 'local');
        seat.socketId = socket.id;
        seat.connected = true;
      }
      socket.join(code);
      socket.data.roomCode = code;
      ack?.({ ok: true, code, seats: room.seats.map((s) => ({ playerId: s.playerId, name: s.name, token: s.token })) });
      broadcastRoom(room);
      broadcastLobby();
    } catch (e) {
      ack?.({ ok: false, error: (e as Error).message });
    }
  });

  // ── 加入房间 ──
  socket.on('room:join', (data: { code: string; name: string; charId?: string }, ack?: (r: unknown) => void) => {
    const room = getRoom(data.code || '');
    if (!room) { ack?.({ ok: false, error: '房间不存在' }); return; }
    if (room.state !== 'lobby') { ack?.({ ok: false, error: '游戏已开始，无法加入' }); return; }
    if (room.seats.length >= 20) { ack?.({ ok: false, error: '房间已满' }); return; }
    const seat = room.addSeat(data.name || `玩家${room.seats.length + 1}`, data.charId || 'default', 'human');
    seat.socketId = socket.id;
    seat.connected = true;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    ack?.({ ok: true, code: room.code, seats: room.seats.map((s) => ({ playerId: s.playerId, name: s.name, token: s.token })) });
    broadcastRoom(room);
    broadcastLobby();
  });

  // ── 断线重连（令牌恢复身份） ──
  socket.on('room:reconnect', (data: { code: string; playerId: PlayerId; token: string }, ack?: (r: unknown) => void) => {
    const room = getRoom(data.code || '');
    if (!room) { ack?.({ ok: false, error: '房间不存在' }); return; }
    const seat = room.seatOf(data.playerId);
    if (!seat || seat.token !== data.token) { ack?.({ ok: false, error: '身份验证失败' }); return; }
    seat.socketId = socket.id;
    seat.connected = true;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    ack?.({ ok: true, code: room.code, playerId: seat.playerId, name: seat.name });
    // 重连后权限检查：状态照常下发，禁止通过重连绕过行动限制（提交仍校验当前行动者）
    broadcastRoom(room);
    broadcastLobby();
  });

  // ── 大厅操作 ──
  socket.on('room:setChar', (data: { code: string; playerId: PlayerId; token: string; charId: string }, ack?: (r: unknown) => void) => {
    const room = getRoom(data.code || '');
    if (!room) { ack?.({ ok: false, error: '房间不存在' }); return; }
    const seat = room.seatOf(data.playerId);
    if (!seat || seat.token !== data.token) { ack?.({ ok: false, error: '身份验证失败' }); return; }
    if (CHARACTERS[data.charId]) seat.charId = data.charId;
    ack?.({ ok: true });
    broadcastRoom(room);
  });

  socket.on('room:addAI', (data: { code: string; playerId: PlayerId; token: string; count?: number }, ack?: (r: unknown) => void) => {
    const room = getRoom(data.code || '');
    if (!room) { ack?.({ ok: false, error: '房间不存在' }); return; }
    const seat = room.seatOf(data.playerId);
    if (!seat || !room.isHost(data.playerId)) { ack?.({ ok: false, error: '仅房主可添加AI' }); return; }
    const count = Math.min(data.count ?? 1, 20 - room.seats.length);
    for (let i = 0; i < count; i++) room.addSeat(`AI_${room.seats.length + 1}`, 'default', 'ai');
    ack?.({ ok: true });
    broadcastRoom(room);
  });

  socket.on('room:removeSeat', (data: { code: string; playerId: PlayerId; token: string; targetId: PlayerId }, ack?: (r: unknown) => void) => {
    const room = getRoom(data.code || '');
    if (!room) { ack?.({ ok: false, error: '房间不存在' }); return; }
    const seat = room.seatOf(data.playerId);
    if (!seat || !room.isHost(data.playerId)) { ack?.({ ok: false, error: '仅房主可移除玩家' }); return; }
    if (data.targetId === data.playerId) { ack?.({ ok: false, error: '不能移除自己' }); return; }
    room.removeSeat(data.targetId);
    ack?.({ ok: true });
    broadcastRoom(room);
  });

  socket.on('room:start', (data: { code: string; playerId: PlayerId; token: string; seed?: number }, ack?: (r: unknown) => void) => {
    const room = getRoom(data.code || '');
    if (!room) { ack?.({ ok: false, error: '房间不存在' }); return; }
    if (!room.isHost(data.playerId)) { ack?.({ ok: false, error: '仅房主可开始游戏' }); return; }
    const r = room.start(data.seed);
    if (!r.ok) { ack?.(r); return; }
    ack?.({ ok: true, seed: room.game?.seed });
    broadcastRoom(room);
    broadcastLobby();
  });

  socket.on('room:restart', (data: { code: string; playerId: PlayerId; token: string }, ack?: (r: unknown) => void) => {
    const room = getRoom(data.code || '');
    if (!room) { ack?.({ ok: false, error: '房间不存在' }); return; }
    if (!room.isHost(data.playerId)) { ack?.({ ok: false, error: '仅房主可重开游戏' }); return; }
    const r = room.restart();
    ack?.(r);
    broadcastRoom(room);
    broadcastLobby();
  });

  socket.on('room:leave', (data: { code: string; playerId: PlayerId; token: string }, ack?: (r: unknown) => void) => {
    const room = getRoom(data.code || '');
    if (!room) { ack?.({ ok: false, error: '房间不存在' }); return; }
    const seat = room.seatOf(data.playerId);
    if (!seat || seat.token !== data.token) { ack?.({ ok: false, error: '身份验证失败' }); return; }
    room.removeSeat(data.playerId);
    socket.leave(room.code);
    // 房主离开且无人可继任 → 解散
    if (room.seats.length === 0) {
      room.dispose();
      rooms.delete(room.code);
      ack?.({ ok: true, dissolved: true });
      broadcastLobby();
      return;
    }
    // 游戏中离开：该玩家标记断线（对局继续，超时自动代打）
    if (room.game && room.state === 'playing') {
      const gp = room.game.players[data.playerId];
      if (gp) gp.type = gp.type; // 状态不变，由超时机制兜底
    }
    ack?.({ ok: true });
    broadcastRoom(room);
  });

  // ── 游戏操作 ──
  socket.on('game:throw', (data: { code: string; playerId: PlayerId; token: string; throw: Throw }, ack?: (r: unknown) => void) => {
    const room = getRoom(data.code || '');
    if (!room || !room.game) { ack?.({ ok: false, error: '对局不存在' }); return; }
    const seat = room.seatOf(data.playerId);
    if (!seat || seat.token !== data.token) { ack?.({ ok: false, error: '身份验证失败' }); return; }
    const r = room.submitThrow(data.playerId, data.throw);
    ack?.(r.ok ? { ok: true } : r);
  });

  socket.on('game:action', (data: { code: string; playerId: PlayerId; token: string; action: ActionRequest }, ack?: (r: unknown) => void) => {
    const room = getRoom(data.code || '');
    if (!room || !room.game) { ack?.({ ok: false, error: '对局不存在' }); return; }
    const seat = room.seatOf(data.playerId);
    if (!seat || seat.token !== data.token) { ack?.({ ok: false, error: '身份验证失败' }); return; }
    const r = room.submitAction(data.playerId, data.action);
    ack?.(r.ok ? { ok: true } : r);
  });

  socket.on('game:state', (data: { code: string }, ack?: (r: unknown) => void) => {
    const room = getRoom(data.code || '');
    if (!room) { ack?.({ ok: false, error: '房间不存在' }); return; }
    broadcastRoom(room);
    ack?.({ ok: true });
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode as string | undefined;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    for (const seat of room.seatBySocket(socket.id)) {
      seat.connected = false;
      seat.socketId = undefined;
    }
    broadcastRoom(room);
  });

  // ── 大厅房间列表请求 ──
  socket.on('lobby:roomsReq', (_data: unknown, ack?: (r: unknown) => void) => {
    ack?.({ ok: true, rooms: [...rooms.values()].map((r) => r.listEntry()) });
  });

  // ── 房间聊天（等待界面交流） ──
  socket.on('room:chat', (data: { code: string; playerId: PlayerId; token: string; text: string }, ack?: (r: unknown) => void) => {
    const room = getRoom(data.code || '');
    if (!room) { ack?.({ ok: false, error: '房间不存在' }); return; }
    const seat = room.seatOf(data.playerId);
    if (!seat || seat.token !== data.token) { ack?.({ ok: false, error: '身份验证失败' }); return; }
    const text = (data.text || '').trim();
    if (!text) { ack?.({ ok: false, error: '消息为空' }); return; }
    room.addChat(seat.name, text);
    ack?.({ ok: true });
    broadcastRoom(room);
  });

  // 新客户端连接时推送房间列表
  socket.emit('lobby:rooms', { rooms: [...rooms.values()].map((r) => r.listEntry()) });
});

/** 启动监听（作为主模块运行时自动调用；测试可手动调用） */
export function startServer(port: number = PORT): void {
  httpServer.listen(port, () => {
    console.log(`[拔典] 服务端已启动: http://localhost:${port}`);
  });
}

// 仅在直接运行本文件时自动启动（被测试导入时不监听）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}

export { rooms, io, httpServer };
