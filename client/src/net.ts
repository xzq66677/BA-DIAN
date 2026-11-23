/**
 * 拔典 · 网络层（Socket.IO 客户端封装）
 */

import { io, type Socket } from 'socket.io-client';
import { PROTOCOL_VERSION, supportsProtocol } from '../../shared/src/protocol.js';
import type { Identity, RoomListEntry, RoomUpdate } from '../../shared/src/protocol.js';
import type { ActionRequest, AiDifficulty, InteractionKind, Throw } from '../../shared/src/types.js';

export type { AnnounceItem } from '../../shared/src/announce.js';
export type { Identity, LobbySeat, LobbyState, RoomListEntry, SnapPlayer, SnapLog, GameSnapshot, RoomUpdate } from '../../shared/src/protocol.js';
export type {
  AiDifficulty, InteractionKind, InteractionEvent, PlayerStats, ReplayPlayer, ReplayFrame,
  ReplaySummary, ReplayRecord, RevealInfo, SkillJudgeView,
} from '../../shared/src/types.js';

class Net {
  private socket: Socket | null = null;
  private connecting: Promise<void> | null = null;
  identities: Identity[] = [];
  /** 当前房间码（断线重连时用于自动恢复座位绑定） */
  currentCode: string | null = null;
  listeners: ((u: RoomUpdate) => void)[] = [];
  reconnectListeners: (() => void)[] = [];
  lobbyRoomsListeners: ((rooms: RoomListEntry[]) => void)[] = [];
  dissolvedListeners: ((code: string) => void)[] = [];
  connected = false;

  connect(): Promise<void> {
    if (this.socket?.connected) return Promise.resolve();
    if (this.connecting) return this.connecting;

    const socket = this.socket ?? this.createSocket();
    this.socket = socket;
    this.connecting = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(deadline);
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
      };
      const onConnect = () => { cleanup(); resolve(); };
      const onError = (error: Error & { data?: { code?: string } }) => {
        if (error.data?.code !== 'PROTOCOL_VERSION') return;
        cleanup();
        reject(new Error('游戏版本已更新，请刷新页面'));
      };
      const deadline = setTimeout(() => { cleanup(); reject(new Error('连接超时')); }, 8000);
      socket.once('connect', onConnect);
      socket.on('connect_error', onError);
      if (!socket.active) socket.connect();
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private createSocket(): Socket {
    const prefix = window.location.pathname.startsWith('/badian') ? '/badian' : '';
    const socket = io({
      autoConnect: false,
      transports: ['websocket', 'polling'],
      tryAllTransports: true,
      path: prefix + '/socket.io',
      auth: { protoVer: PROTOCOL_VERSION },
    });
    socket.on('connect', () => {
      this.connected = true;
      const code = this.currentCode;
      const main = this.identities[0];
      if (!code || !main) return;
      void this.reconnect(code, main.playerId, main.token).then((result) => {
        if (result.ok && this.currentCode === code) {
          for (const fn of this.reconnectListeners) fn();
        }
      });
    });
    socket.on('disconnect', () => { this.connected = false; });
    socket.on('room:update', (u: RoomUpdate) => {
      if (supportsProtocol(u.v) && supportsProtocol(u.game?.v)) {
        for (const fn of this.listeners) fn(u);
      }
    });
    socket.on('lobby:rooms', (r: { rooms: RoomListEntry[] }) => {
      for (const fn of this.lobbyRoomsListeners) fn(r.rooms);
    });
    socket.on('room:dissolved', (r: { code: string }) => {
      for (const fn of this.dissolvedListeners) fn(r.code);
    });
    return socket;
  }

  /** socket.io 断线重连并恢复座位后回调（用于刷新界面） */
  onResumed(fn: () => void): () => void {
    this.reconnectListeners.push(fn);
    return () => {
      this.reconnectListeners = this.reconnectListeners.filter((f) => f !== fn);
    };
  }

  onUpdate(fn: (u: RoomUpdate) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }

  onDissolved(fn: (code: string) => void): () => void {
    this.dissolvedListeners.push(fn);
    return () => {
      this.dissolvedListeners = this.dissolvedListeners.filter((f) => f !== fn);
    };
  }

  onLobbyRooms(fn: (rooms: RoomListEntry[]) => void): () => void {
    this.lobbyRoomsListeners.push(fn);
    return () => {
      this.lobbyRoomsListeners = this.lobbyRoomsListeners.filter((f) => f !== fn);
    };
  }

  chat(code: string, playerId: string, token: string, text: string) {
    return this.emit('room:chat', { code, playerId, token, text });
  }

  requestLobbyRooms() {
    return this.emit('lobby:roomsReq', {});
  }

  private emit(event: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      if (!this.socket?.connected) { resolve({ ok: false, error: '未连接' }); return; }
      this.socket.timeout(8000).emit(event, data, (error: Error | null, reply?: Record<string, unknown>) => {
        resolve(error ? { ok: false, error: '服务端响应超时' } : reply ?? { ok: true });
      });
    });
  }

  createRoom(name: string, localNames: string[], charId: string) {
    return this.emit('room:create', { name, localPlayers: localNames, charId });
  }
  joinRoom(code: string, name: string, charId: string) {
    return this.emit('room:join', { code, name, charId });
  }
  reconnect(code: string, playerId: string, token: string) {
    return this.emit('room:reconnect', { code, playerId, token });
  }
  setChar(code: string, playerId: string, token: string, charId: string, targetId?: string) {
    return this.emit('room:setChar', { code, playerId, token, charId, targetId });
  }
  addAI(code: string, playerId: string, token: string, count: number, charId?: string, difficulty?: AiDifficulty) {
    return this.emit('room:addAI', { code, playerId, token, count, charId, difficulty });
  }
  setAI(code: string, playerId: string, token: string, difficulty: AiDifficulty) {
    return this.emit('room:setAI', { code, playerId, token, difficulty });
  }
  interact(code: string, playerId: string, token: string, targetId: string, kind: InteractionKind) {
    return this.emit('game:interact', { code, playerId, token, targetId, kind });
  }
  replayList(code: string) {
    return this.emit('replay:list', { code });
  }
  replayGet(code: string, id: string) {
    const identity = this.currentCode === code ? this.identities[0] : undefined;
    return this.emit('replay:get', { code, id, playerId: identity?.playerId, token: identity?.token });
  }
  removeSeat(code: string, playerId: string, token: string, targetId: string) {
    return this.emit('room:removeSeat', { code, playerId, token, targetId });
  }
  start(code: string, playerId: string, token: string, seed?: number) {
    return this.emit('room:start', { code, playerId, token, seed });
  }
  dissolve(code: string, playerId: string, token: string) {
    return this.emit('room:dissolve', { code, playerId, token });
  }
  kick(code: string, playerId: string, token: string, targetId: string) {
    return this.emit('room:kick', { code, playerId, token, targetId });
  }
  restart(code: string, playerId: string, token: string) {
    return this.emit('room:restart', { code, playerId, token });
  }
  leave(code: string, playerId: string, token: string) {
    return this.emit('room:leave', { code, playerId, token });
  }
  /** 退出旧房间（逃生口）：以当前连接为凭证，移除本 socket 绑定的全部身份；无真人可继续时房间解散 */
  detach() {
    return this.emit('room:detach', {});
  }
  submitThrow(code: string, playerId: string, token: string, t: Throw) {
    return this.emit('game:throw', { code, playerId, token, throw: t });
  }
  submitAction(code: string, playerId: string, token: string, action: ActionRequest) {
    return this.emit('game:action', { code, playerId, token, action });
  }
}

export const net = new Net();
