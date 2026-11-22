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
  /** 第几局（1 起，重开累加）：变化即代表新一局，战斗日志需清空重来 */
  gameNo?: number;
  hostSeat: string | null;
  seats: LobbySeat[];
  chat: { name: string; text: string; ts: number }[];
  config: { submitTimeoutMs: number; turnTimeoutMs: number };
  /** AI 难度（房主可调） */
  aiDifficulty?: AiDifficulty;
  /** 局内小互动（最近若干条，客户端按 id 增量播放动画） */
  interactions?: InteractionEvent[];
  /** 互动计数：给 / 收 */
  interactionCounts?: Record<string, { given: number; got: number }>;
  /** 已完成对局回放摘要 */
  replays?: ReplaySummary[];
}

export type AiDifficulty = 'easy' | 'normal' | 'hard';
export type InteractionKind = 'tomato' | 'egg' | 'flower';

export interface InteractionEvent {
  id: number;
  from: string;
  fromName: string;
  to: string;
  kind: InteractionKind;
  ts: number;
}

export interface PlayerStats {
  throwWin: number;
  throwLose: number;
  throwTie: number;
  damageDealt: number;
  damageTaken: number;
  kills: number;
  actions: number;
  heals: number;
  moves: number;
  roundsAlive: number;
}

export interface ReplayPlayer {
  id: string;
  name: string;
  charId: string;
  charName: string;
  hp: number;
  maxHp: number;
  room: string;
  alive: boolean;
  hidden: boolean;
  invisible: boolean;
  type: 'human' | 'ai' | 'local';
  stats?: PlayerStats;
}

export interface ReplayFrame {
  i: number;
  roundNo: number;
  phase: 'rps1' | 'rps2' | 'act' | 'roundEnd' | 'over';
  subRound: number;
  players: ReplayPlayer[];
  roomIds: string[];
  reveal: RevealInfo | null;
  currentActor: string | null;
  queue: string[];
  actIndex: number;
  aliveCount: number;
  winner: string | null;
  logs: { seq: number; type: string; text: string; important?: boolean }[];
}

export interface ReplaySummary {
  id: string;
  ts: number;
  seed: number;
  winner: string | null;
  winnerName: string | null;
  rounds: number;
  frameCount: number;
  players: { id: string; name: string; charId: string; charName: string }[];
}

export interface ReplayRecord extends ReplaySummary {
  frames: ReplayFrame[];
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
  data?: Record<string, unknown>;
}

/** 已揭示的出拳（判定结算后才下发，提交阶段为 null → 不泄露拳种） */
export interface RevealInfo {
  round: number;
  stage: string;
  sub: number;
  throws: Record<string, string>;
  outcome: string;
  winners: string[];
  losers: string[];
}

/** 技能内判定（马保国系）：进行中的出拳面板数据 */
export interface SkillJudgeView {
  kind: string;
  label: string;
  owner: string;
  opponent: string;
  /** 当前第几局（1-based） */
  round: number;
  rounds: number;
  /** 己方已胜局数 */
  wins: number;
  submittedIds: string[];
  waitingIds: string[];
  last: { round: number; ownerThrow: string; opponentThrow: string; result: string } | null;
}

export interface GameSnapshot {
  seed: number;
  roundNo: number;
  subRound: number;
  phase: 'rps1' | 'rps2' | 'act' | 'judge' | 'roundEnd' | 'over';
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
  /** 出拳揭示：全员可见，仅在子轮结算完成后出现 */
  reveal?: RevealInfo | null;
  /** 本回合最近一次排序子轮的揭示（行动阶段用来说明行动顺序来源；无排序则 null） */
  orderReveal?: RevealInfo | null;
  /** 技能内判定（马保国系）：进行中的出拳面板数据；非判定阶段为 null */
  judge?: SkillJudgeView | null;
  /** 二次判定（rps2）：当前子轮等待出拳的玩家 / 已提交玩家 / 已确定顺序前缀 / 子轮号 */
  orderGroup?: string[];
  orderSubmittedIds?: string[];
  orderResult?: string[];
  orderSub?: number;
  /** 局内战绩（每人一份） */
  stats?: Record<string, PlayerStats>;
  /** 领域持有者（全场唯一；null 表示当前无领域生效） */
  domainHolder?: string | null;
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
  dissolvedListeners: ((code: string) => void)[] = [];
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
      this.socket.on('room:dissolved', (r: { code: string }) => {
        for (const fn of this.dissolvedListeners) fn(r.code);
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
  addAI(code: string, playerId: string, token: string, count: number, charId?: string, difficulty?: string) {
    return this.emit('room:addAI', { code, playerId, token, count, charId, difficulty });
  }
  setAI(code: string, playerId: string, token: string, difficulty: string) {
    return this.emit('room:setAI', { code, playerId, token, difficulty });
  }
  interact(code: string, playerId: string, token: string, targetId: string, kind: InteractionKind) {
    return this.emit('game:interact', { code, playerId, token, targetId, kind });
  }
  replayList(code: string) {
    return this.emit('replay:list', { code });
  }
  replayGet(code: string, id: string) {
    return this.emit('replay:get', { code, id });
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
  submitThrow(code: string, playerId: string, token: string, t: string) {
    return this.emit('game:throw', { code, playerId, token, throw: t });
  }
  submitAction(code: string, playerId: string, token: string, action: Record<string, unknown>) {
    return this.emit('game:action', { code, playerId, token, action });
  }
}

export const net = new Net();
