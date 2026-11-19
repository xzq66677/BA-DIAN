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
  config: { submitTimeoutMs: number; turnTimeoutMs: number };
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
  listeners: ((u: RoomUpdate) => void)[] = [];
  connected = false;

  connect(): Promise<void> {
    if (this.socket && this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.socket = io({ transports: ['websocket', 'polling'] });
      this.socket.on('connect', () => {
        this.connected = true;
        resolve();
      });
      this.socket.on('disconnect', () => { this.connected = false; });
      this.socket.on('room:update', (u: RoomUpdate) => {
        for (const fn of this.listeners) fn(u);
      });
      setTimeout(() => reject(new Error('连接超时')), 8000);
    });
  }

  onUpdate(fn: (u: RoomUpdate) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
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
  setChar(code: string, playerId: string, token: string, charId: string) {
    return this.emit('room:setChar', { code, playerId, token, charId });
  }
  addAI(code: string, playerId: string, token: string, count: number) {
    return this.emit('room:addAI', { code, playerId, token, count });
  }
  removeSeat(code: string, playerId: string, token: string, targetId: string) {
    return this.emit('room:removeSeat', { code, playerId, token, targetId });
  }
  start(code: string, playerId: string, token: string, seed?: number) {
    return this.emit('room:start', { code, playerId, token, seed });
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
