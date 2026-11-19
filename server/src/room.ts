/**
 * 拔典 · 联机房间管理
 * 房间创建/加入/邀请码/房主/座位/AI/开始游戏/断线重连。
 * 所有游戏状态由服务端管理，客户端只负责展示与请求。
 */

import { Game } from '../../shared/src/engine.js';
import { CHARACTERS } from '../../shared/src/characters/index.js';
import type { PlayerId, ActionRequest, Throw, GamePlayerConfig, RuleConfig } from '../../shared/src/types.js';
import { randomThrow, RNG } from '../../shared/src/rng.js';

export interface Seat {
  playerId: PlayerId;
  name: string;
  charId: string;
  type: 'human' | 'ai' | 'local';
  /** 人类玩家的重连令牌（AI 无） */
  token?: string;
  socketId?: string;
  connected: boolean;
}

export interface RoomConfig {
  rules?: Partial<RuleConfig>;
  seed?: number;
  turnTimeoutMs: number;
  submitTimeoutMs: number;
}

export type RoomState = 'lobby' | 'playing' | 'over';

export class Room {
  code: string;
  hostSeat: PlayerId | null = null;
  seats: Seat[] = [];
  state: RoomState = 'lobby';
  config: RoomConfig;
  game: Game | null = null;
  createdAt = Date.now();
  /** 出拳/行动超时定时器 */
  private submitTimer: ReturnType<typeof setTimeout> | null = null;
  private actTimer: ReturnType<typeof setTimeout> | null = null;
  /** 事件回调（由 ServerHost 注入） */
  onBroadcast: (room: Room) => void = () => {};
  onGameOver: (room: Room) => void = () => {};

  constructor(code: string, config?: Partial<RoomConfig>) {
    this.code = code;
    this.config = {
      turnTimeoutMs: 45000,
      submitTimeoutMs: 30000,
      ...config,
    };
  }

  genToken(): string {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  addSeat(name: string, charId: string, type: 'human' | 'ai' | 'local'): Seat {
    const playerId = `P${this.seats.length + 1}-${Math.random().toString(36).slice(2, 6)}`;
    const seat: Seat = {
      playerId,
      name,
      charId: CHARACTERS[charId] ? charId : 'default',
      type,
      connected: type === 'ai',
      token: type !== 'ai' ? this.genToken() : undefined,
    };
    this.seats.push(seat);
    if (this.hostSeat === null) this.hostSeat = playerId;
    return seat;
  }

  removeSeat(playerId: PlayerId): void {
    this.seats = this.seats.filter((s) => s.playerId !== playerId);
    if (this.hostSeat === playerId) {
      this.hostSeat = this.seats.find((s) => s.type === 'human')?.playerId ?? null;
    }
  }

  seatOf(playerId: PlayerId): Seat | undefined {
    return this.seats.find((s) => s.playerId === playerId);
  }

  seatBySocket(socketId: string): Seat[] {
    return this.seats.filter((s) => s.socketId === socketId);
  }

  isHost(playerId: PlayerId): boolean {
    return this.hostSeat === playerId;
  }

  humanSeats(): Seat[] {
    return this.seats.filter((s) => s.type !== 'ai');
  }

  /** 开始游戏：构造引擎（2人以上） */
  start(seed?: number): { ok: boolean; error?: string } {
    if (this.state === 'playing') return { ok: false, error: '游戏已在进行中' };
    if (this.seats.length < 2) return { ok: false, error: '至少需要 2 名玩家' };
    const players: GamePlayerConfig[] = this.seats.map((s) => ({
      id: s.playerId, name: s.name, charId: s.charId, type: s.type,
    }));
    const usedSeed = seed ?? this.config.seed ?? (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    this.game = new Game({ seed: usedSeed, players, chars: CHARACTERS, rules: this.config.rules });
    this.state = 'playing';
    // AI 自动出拳
    this.kickAI();
    this.armSubmitTimeout();
    this.onBroadcast(this);
    return { ok: true };
  }

  /** 玩家提交出拳（服务端统一入口，隐藏提交） */
  submitThrow(playerId: PlayerId, t: Throw): { ok: boolean; error?: string } {
    if (!this.game) return { ok: false, error: '游戏未开始' };
    const r = this.game.submitThrow(playerId, t);
    if (!r.ok) return r;
    this.disarmSubmitTimeout();
    this.afterGameMutation();
    return r;
  }

  submitAction(playerId: PlayerId, req: ActionRequest): { ok: boolean; error?: string } {
    if (!this.game) return { ok: false, error: '游戏未开始' };
    const r = this.game.submitAction(playerId, req);
    if (!r.ok) return r;
    this.disarmActTimeout();
    this.afterGameMutation();
    return r;
  }

  /** 游戏状态变化后的统一处理：AI 驱动、超时布防、广播 */
  private afterGameMutation(): void {
    if (!this.game) return;
    this.kickAI();
    if (this.game.isOver()) {
      this.state = 'over';
      this.disarmAll();
      this.onBroadcast(this);
      this.onGameOver(this);
      return;
    }
    if (this.game.phase === 'rps1') this.armSubmitTimeout();
    if (this.game.phase === 'act') this.armActTimeout();
    this.onBroadcast(this);
  }

  /** AI 行动驱动（AI 与真人使用同一引擎接口） */
  kickAI(): void {
    if (!this.game || this.game.isOver()) return;
    let guard = 0;
    while (guard++ < 500) {
      const g = this.game;
      if (g.isOver()) break;
      if (g.phase === 'rps1') {
        const aiSeats = this.seats.filter((s) => s.type === 'ai' && g.players[s.playerId]?.alive);
        const pending = aiSeats.filter((s) => !g.submittedIds.includes(s.playerId));
        if (pending.length === 0) break;
        for (const s of pending) {
          g.submitThrow(s.playerId, randomThrow(g.rng)); // AI 使用游戏随机流，保证对局可复现
        }
        continue;
      }
      if (g.phase === 'act') {
        const cur = g.currentActor();
        if (!cur) break;
        const seat = this.seatOf(cur);
        if (!seat || seat.type !== 'ai') break;
        g.submitAction(cur, aiDecideAction(g, cur));
        continue;
      }
      break;
    }
  }

  /** 出拳超时：系统代掷（不泄露原选择——本来就没有） */
  private armSubmitTimeout(): void {
    this.disarmSubmitTimeout();
    if (this.config.submitTimeoutMs <= 0) return;
    this.submitTimer = setTimeout(() => {
      if (this.game && this.game.phase === 'rps1') {
        this.game.forceFillThrows();
        this.afterGameMutation();
      }
    }, this.config.submitTimeoutMs);
  }

  private disarmSubmitTimeout(): void {
    if (this.submitTimer) { clearTimeout(this.submitTimer); this.submitTimer = null; }
  }

  /** 行动超时：自动跳过 */
  private armActTimeout(): void {
    this.disarmActTimeout();
    if (this.config.turnTimeoutMs <= 0) return;
    this.actTimer = setTimeout(() => {
      if (this.game && this.game.phase === 'act') {
        const cur = this.game.currentActor();
        if (cur) {
          this.game.forceSkipAction(cur);
          this.afterGameMutation();
        }
      }
    }, this.config.turnTimeoutMs);
  }

  private disarmActTimeout(): void {
    if (this.actTimer) { clearTimeout(this.actTimer); this.actTimer = null; }
  }

  private disarmAll(): void {
    this.disarmSubmitTimeout();
    this.disarmActTimeout();
  }

  /** 重置房间（重开游戏） */
  restart(): { ok: boolean; error?: string } {
    if (this.state === 'lobby') return { ok: false, error: '房间尚未开始过' };
    this.state = 'lobby';
    this.game = null;
    this.disarmAll();
    this.onBroadcast(this);
    return { ok: true };
  }

  dispose(): void {
    this.disarmAll();
  }

  /** 大厅快照（不含令牌） */
  lobbySnapshot(): Record<string, unknown> {
    return {
      code: this.code,
      state: this.state,
      hostSeat: this.hostSeat,
      seats: this.seats.map((s) => ({
        playerId: s.playerId, name: s.name, charId: s.charId, type: s.type,
        connected: s.connected,
      })),
      config: { submitTimeoutMs: this.config.submitTimeoutMs, turnTimeoutMs: this.config.turnTimeoutMs },
    };
  }
}

// ═══════════════════ AI 决策（与规则引擎分离，只提交合法行动） ═══════════════════

/** 简单可解释的 AI 行动策略 */
export function aiDecideAction(g: Game, pid: PlayerId): ActionRequest {
  const me = g.players[pid];
  const cd = g.charDef(pid);
  const members = g.roomMembers(me.room).filter((p) => p !== pid);
  const alive = g.aliveIds().filter((p) => p !== pid);

  // 血量低且同房间有威胁 → 优先回复
  if (me.hp < me.maxHp && me.hp <= 1 && members.length > 0) {
    return { type: 'heal' };
  }

  // 角色特化
  const st = g.charState(pid);
  switch (cd.id) {
    case 'bagun':
      if (!st.stickDrawn) return { type: 'toggleStick' };
      if (members.length > 0) return { type: 'attack', targetId: members[0] };
      break;
    case 'chuixiao': {
      const aim = st.aim as string | undefined;
      const aimValid = aim && g.players[aim]?.alive && !g.isSameRoom(pid, aim);
      if (aimValid) return { type: 'attack', targetId: aim!, ranged: true };
      const targets = alive.filter((p) => !g.isSameRoom(pid, p) && !(g.players[p].hidden || g.players[p].invisible));
      if (targets.length > 0) return { type: 'aim', targetId: g.rng.pick(targets) };
      if (members.length > 0) return { type: 'move', room: g.roomIds.find((r) => r !== me.room && g.roomMembers(r).length === 0) || me.room };
      break;
    }
    case 'gojo':
      if (st.domain !== true) return { type: 'domain' };
      if (members.length > 0) {
        return { type: 'attack', targetId: members[0], ranged: !g.isSameRoom(pid, members[0]) };
      }
      {
        const targets = alive.filter((p) => !(g.players[p].hidden || g.players[p].invisible));
        if (targets.length > 0) return { type: 'attack', targetId: targets[0], ranged: true };
      }
      break;
    case 'mabaoguo':
      if (members.length > 0 && members.some((m) => g.players[m].maxHp >= 3)) {
        return { type: 'whip5', targetId: members[0] };
      }
      if (members.length > 0) return { type: 'attack', targetId: members[0] };
      break;
    case 'wuliuqi':
      if (members.length > 0) return { type: 'attack', targetId: members[0] };
      break;
    case 'ivan-girl': {
      const fullRooms = g.roomIds.filter((r) => g.roomMembers(r).length >= 1 && r !== me.room);
      const best = fullRooms.sort((a, b) => g.roomMembers(b).length - g.roomMembers(a).length)[0];
      if (best && g.roomMembers(best).length >= 1) return { type: 'throwIvan', room: best };
      break;
    }
    case 'dajianke':
      if (members.length > 0) return { type: 'attack', targetId: members[0] };
      break;
    case 'dapihuai':
    case 'hero-today':
    case 'laodaye':
    case 'default':
      break;
  }

  // 通用策略：同房间有目标 → 攻击血量最低者；满血且无目标 → 移向人多房间；否则回复/躲藏
  if (members.length > 0) {
    const target = members.filter((m) => !(g.players[m].hidden || g.players[m].invisible))
      .sort((a, b) => g.players[a].hp - g.players[b].hp)[0];
    if (target) return { type: 'attack', targetId: target };
  }
  if (me.hp < me.maxHp) return { type: 'heal' };
  const roomScores = g.roomIds
    .filter((r) => r !== me.room)
    .map((r) => ({ r, n: g.roomMembers(r).length }))
    .sort((a, b) => b.n - a.n);
  if (roomScores.length > 0 && roomScores[0].n > 0) {
    return { type: 'move', room: roomScores[0].r };
  }
  if (g.rules.allowHide && !me.hidden) return { type: 'hide' };
  return { type: 'skip' };
}
