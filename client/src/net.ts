/**
 * 拔典 · 网络层（Socket.IO 客户端封装）
 */

import { io, type Socket } from 'socket.io-client';

export interface Identity {
  playerId: string;
  name: string;
  token: string;
}

export interface LobbySeat {
  playerId: string;
  name: string;
  charId: string;
  type: 'human' | 'ai' | 'local';
  connected: boolean;
}

export interface LobbyState {
  code: string;
  state: 'lobby' | 'playing' | 'over';
  hostSeat: string | null;
  seats: LobbySeat[];
  chat: { name: string; text: string; ts: number }[];
  config: { submitTimeoutMs: number; turnTimeoutMs: number };
}

export interface RoomListEntry {
  code: string;
  state: 'lobby' | 'playing' | 'over';
  seatCount: number;
  humans: number;
  hostName: string;
  updatedAt: number;
}

export interface SnapPlayer {
  id: string; name: string; charId: string; charName: string;
  hp: number; maxHp: number; room: string; originRoom: string;
  alive: boolean; type: 'human' | 'ai' | 'local';
  hidden: boolean; invisible: boolean;
  char: Record<string, unknown>;
}

export interface SnapLog {
  seq: number; round: number; sub: number;
  phase: string; type: string; text: string;
  important?: boolean;
}

export interface GameSnapshot {
  seed: number;
  roundNo: number;
  subRound: number;
  phase: 'rps1' | 'act' | 'roundEnd' | 'over';
  players: SnapPlayer[];
  roomIds: string[];
  submittedIds: string[];
  pendingCount: number;
  qualified: string[];
  queue: string[];
  actIndex: number;
  currentActor: string | null;
  deferred: { id: string; kind: string; room: string; explodeRound: number; source?: string }[];
  judgeRecords: { stage: string; sub: number; throws: Record<string, string>; outcome: string; winners?: string[]; losers?: string[] }[];
  logs: SnapLog[];
  winner: string | null;
  aliveCount: number;
}

export interface RoomUpdate {
  lobby: LobbyState;
  game: GameSnapshot | null;
  newLogs: SnapLog[];
  you: string;
}

class Net {
  private socket: Socket | null = null;
  identities: Identity[] = [];
  /** 当前房间码（断线重连时用于自动恢复座位绑定） */
  currentCode: string | null = null;
  listeners: ((u: RoomUpdate) => void)[] = [];
  reconnectListeners: (() => void)[] = [];
  lobbyRoomsListeners: ((rooms: RoomListEntry[]) => void)[] = [];
  connected = false;

  connect(): Promise<void> {
    if (this.socket && this.connected) return Promise.resolve();
    // 部署在子路径（如 nginx /badian/）时，socket.io 路径自适应
    const inSubPath = window.location.pathname.startsWith('/badian');
    const socketPath = (inSubPath ? '/badian' : '') + '/socket.io';
    return new Promise((resolve, reject) => {
      this.socket = io({ transports: ['websocket', 'polling'], path: socketPath });
      this.socket.on('connect', () => {
        const first = !this.connected;
        this.connected = true;
        resolve();
        // 断线自动重连后：重新绑定座位（服务器 disconnect 时清除了 socketId）
        if (!first && this.currentCode && this.identities.length > 0) {
          const main = this.identities[0];
          this.socket!.emit('room:reconnect', { code: this.currentCode, playerId: main.playerId, token: main.token }, () => {
            for (const fn of this.reconnectListeners) fn();
          });
        }
      });
      this.socket.on('disconnect', () => { this.connected = false; });
      this.socket.on('room:update', (u: RoomUpdate) => {
        for (const fn of this.listeners) fn(u);
      });
      this.socket.on('lobby:rooms', (r: { rooms: RoomListEntry[] }) => {
        for (const fn of this.lobbyRoomsListeners) fn(r.rooms);
      });
      setTimeout(() => reject(new Error('连接超时')), 8000);
    });
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
      if (!this.socket) { resolve({ ok: false, error: '未连接' }); return; }
      this.socket.emit(event, data, (r: Record<string, unknown>) => resolve(r || { ok: true }));
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
  addAI(code: string, playerId: string, token: string, count: number, charId?: string) {
    return this.emit('room:addAI', { code, playerId, token, count, charId });
  }
  removeSeat(code: string, playerId: string, token: string, targetId: string) {
    return this.emit('room:removeSeat', { code, playerId, token, targetId });
  }
  start(code: string, playerId: string, token: string, seed?: number) {
    return this.emit('room:start', { code, playerId, token, seed });
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
  submitThrow(code: string, playerId: string, token: string, t: string) {
    return this.emit('game:throw', { code, playerId, token, throw: t });
  }
  submitAction(code: string, playerId: string, token: string, action: Record<string, unknown>) {
    return this.emit('game:action', { code, playerId, token, action });
  }
}

export const net = new Net();
