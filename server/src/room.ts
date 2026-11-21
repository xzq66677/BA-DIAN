/**
 * 拔典 · 联机房间管理
 * 房间创建/加入/邀请码/房主/座位/AI/开始游戏/断线重连。
 * 所有游戏状态由服务端管理，客户端只负责展示与请求。
 *
 * 除规则引擎外，本层还负责三件「不进入规则」的事：
 *  1. AI 难度分级（休闲 / 普通 / 硬核）：AI 与真人使用同一引擎接口；
 *  2. 局内小互动（丢番茄/鸡蛋/献花）：带冷却的纯娱乐广播；
 *  3. 对局回放：按状态变化录制帧，对局结束归档最近若干局。
 */

import { Game } from '../../shared/src/engine.js';
import { CHARACTERS } from '../../shared/src/characters/index.js';
import type {
  PlayerId, ActionRequest, Throw, GamePlayerConfig, RuleConfig, AiDifficulty,
  InteractionEvent, InteractionKind, ReplayFrame, ReplayRecord, ReplaySummary, ReplayPlayer,
  LogEntry,
} from '../../shared/src/types.js';
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
  aiDifficulty?: AiDifficulty;
}

export type RoomState = 'lobby' | 'playing' | 'over';

export interface ChatMessage {
  name: string;
  text: string;
  ts: number;
}

/** 互动冷却（毫秒）：防止刷屏 */
export const INTERACT_COOLDOWN_MS = 2200;
/** 每个房间保留的回放局数 */
export const MAX_REPLAYS = 5;
/** 单局最多录制帧数（保护内存） */
export const MAX_REPLAY_FRAMES = 1500;

const AI_DIFFICULTIES: AiDifficulty[] = ['easy', 'normal', 'hard'];

export class Room {
  code: string;
  hostSeat: PlayerId | null = null;
  seats: Seat[] = [];
  state: RoomState = 'lobby';
  config: RoomConfig;
  game: Game | null = null;
  createdAt = Date.now();
  /** 房间聊天记录（等待界面交流用） */
  chat: ChatMessage[] = [];
  /** AI 难度（房主可调，整局统一） */
  aiDifficulty: AiDifficulty = 'normal';
  /** 局内小互动（最近的保留，客户端按 id 增量播放动画） */
  interactions: InteractionEvent[] = [];
  /** 互动计数（给 / 收），用于座位角标与战绩面板 */
  interactionCounts: Record<PlayerId, { given: number; got: number }> = {};
  /** 已完成对局回放（最新在前） */
  replays: ReplayRecord[] = [];
  /** 出拳/行动超时定时器 */
  private submitTimer: ReturnType<typeof setTimeout> | null = null;
  private actTimer: ReturnType<typeof setTimeout> | null = null;
  /** AI 看门狗（进行中才运行，结束时清理） */
  private aiWatchdog: ReturnType<typeof setInterval> | null = null;
  /** 看门狗：上一次尝试的现场签名与连续无效次数（防止同一现场无限重试刷广播） */
  private aiWatchdogSig = '';
  private aiWatchdogTries = 0;
  /** 事件回调（由 ServerHost 注入） */
  onBroadcast: (room: Room) => void = () => {};
  onGameOver: (room: Room) => void = () => {};
  private interactSeq = 0;
  private lastInteractAt: Record<PlayerId, number> = {};
  private replaySeq = 0;
  /** 正在录制的对局 */
  private recording: ReplayRecord | null = null;
  private lastFrameSig = '';
  private lastFrameLogSeq = 0;
  /**
   * 房间内日志序号游标（跨局单调递增）。
   *
   * 引擎的 `logSeq` 是**每局**从 1 开始的；同一房间连打多局时若直接复用，
   * 第二局的 seq 会与第一局撞号，服务端增量与客户端去重都会把新日志当旧日志丢掉
   * （表现为「第二局之后战斗日志不再更新」，bug B-023）。
   * 因此每开一局把上一局的最大 seq 作为新局的起点。
   */
  private logSeqCursor = 0;
  /** 第几局（1 起；重开累加。客户端据此清空上一局日志） */
  private gameNo = 0;
  /**
   * 广播游标：已经通过 room:update 增量下发过的最大日志 seq。
   * 广播是房间级的（所有座位同一份 newLogs），因此游标挂在房间上；
   * 断线重连的补发走 catchUpLogs（按 socket 定向补发最近 N 条），不重置本游标，
   * 避免其它在线客户端重复收到历史日志。
   */
  private broadcastLogSeq = 0;
  /** 单次增量广播最多下发的日志条数（有界历史；快照始终权威，截断只影响日志展示） */
  static readonly MAX_BROADCAST_LOGS = 300;
  /** 断线重连时补发的最近日志条数 */
  static readonly RECONNECT_CATCHUP_LOGS = 300;

  constructor(code: string, config?: Partial<RoomConfig>) {
    this.code = code;
    this.config = {
      turnTimeoutMs: 45000,
      submitTimeoutMs: 30000,
      ...config,
    };
    if (config?.aiDifficulty && AI_DIFFICULTIES.includes(config.aiDifficulty)) {
      this.aiDifficulty = config.aiDifficulty;
    }
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

  /** 设置 AI 难度（房主） */
  setAiDifficulty(level: string): { ok: boolean; error?: string } {
    if (!AI_DIFFICULTIES.includes(level as AiDifficulty)) return { ok: false, error: '未知难度' };
    this.aiDifficulty = level as AiDifficulty;
    this.onBroadcast(this);
    return { ok: true };
  }

  /** 开始游戏：构造引擎（2人以上） */
  start(seed?: number): { ok: boolean; error?: string } {
    if (this.state === 'playing') return { ok: false, error: '游戏已在进行中' };
    if (this.seats.length < 2) return { ok: false, error: '至少需要 2 名玩家' };
    const players: GamePlayerConfig[] = this.seats.map((s) => ({
      id: s.playerId, name: s.name, charId: s.charId, type: s.type,
    }));
    const usedSeed = seed ?? this.config.seed ?? (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    this.gameNo++;
    this.game = new Game({
      seed: usedSeed, players, chars: CHARACTERS, rules: this.config.rules,
      // 续接上一局的日志序号，保证同一房间内 seq 单调递增（否则第二局日志会被当成重复丢弃）
      logSeqOffset: this.logSeqCursor,
    });
    this.state = 'playing';
    this.interactions = [];
    this.interactionCounts = {};
    this.lastInteractAt = {};
    this.startRecording();
    // AI 自动出拳
    this.kickAI();
    this.syncLogSeqCursor();
    // 有 AI 才需要看门狗（真人局不存在等待 AI 的场景）
    if (this.seats.some((s) => s.type === 'ai')) this.startAIWatchdog();
    this.armSubmitTimeout();
    this.captureFrame();
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

  /** 游戏状态变化后的统一处理：AI 驱动、录像、超时布防、广播 */
  private afterGameMutation(): void {
    if (!this.game) return;
    this.kickAI();
    this.syncLogSeqCursor();
    this.captureFrame();
    if (this.game.isOver()) {
      this.state = 'over';
      this.disarmAll();
      this.finishRecording();
      this.onBroadcast(this);
      this.onGameOver(this);
      return;
    }
    if (this.game.phase === 'rps1') this.armSubmitTimeout();
    if (this.game.phase === 'act') this.armActTimeout();
    this.onBroadcast(this);
  }

  /** 把游标推到本局当前最大日志序号（只增不减），供下一局续接 */
  private syncLogSeqCursor(): void {
    const logs = this.game?.logs;
    if (!logs || logs.length === 0) return;
    const last = logs[logs.length - 1].seq;
    if (last > this.logSeqCursor) this.logSeqCursor = last;
  }

  /**
   * 取走待广播的增量日志（seq 大于上次广播游标的部分，最多 MAX_BROADCAST_LOGS 条），
   * 并推进广播游标。每场广播只调用一次，所有座位共用同一份增量。
   */
  takeNewLogs(): LogEntry[] {
    const logs = this.game?.logs ?? [];
    const fresh = logs.filter((l) => l.seq > this.broadcastLogSeq);
    if (logs.length > 0) {
      this.broadcastLogSeq = Math.max(this.broadcastLogSeq, logs[logs.length - 1].seq);
    }
    return fresh.slice(-Room.MAX_BROADCAST_LOGS);
  }

  /**
   * 断线重连补发：最近 N 条日志（不推进广播游标，仅对该 socket 定向下发）。
   * 客户端按 seq 去重，快照始终权威，日志只作展示与演出素材。
   */
  catchUpLogs(limit: number = Room.RECONNECT_CATCHUP_LOGS): LogEntry[] {
    const logs = this.game?.logs ?? [];
    return logs.slice(-limit);
  }

  /** AI 行动驱动（AI 与真人使用同一引擎接口，难度决定决策质量） */
  kickAI(): void {
    if (!this.game || this.game.isOver()) return;
    let guard = 0;
    while (guard++ < 800) {
      const g = this.game;
      if (g.isOver()) break;
      if (g.phase === 'rps1') {
        const aiSeats = this.seats.filter((s) => s.type === 'ai' && g.players[s.playerId]?.alive);
        const pending = aiSeats.filter((s) => !g.submittedIds.includes(s.playerId));
        if (pending.length === 0) break;
        for (const s of pending) {
          const t = aiThrow(g, s.playerId, this.aiDifficulty);
          g.submitThrow(s.playerId, t);
          this.captureFrame();
        }
        continue;
      }
      if (g.phase === 'act') {
        const cur = g.currentActor();
        if (!cur) break;
        const seat = this.seatOf(cur);
        if (!seat || seat.type !== 'ai') break;
        // 依次尝试候选行动，保证 AI 永远不会因非法决策卡住对局
        let done = false;
        for (const act of aiDecideActions(g, cur, this.aiDifficulty)) {
          if (g.submitAction(cur, act).ok) { done = true; break; }
        }
        if (!done) g.submitAction(cur, { type: 'skip' });
        this.captureFrame();
        continue;
      }
      break;
    }
  }

  /**
   * AI 看门狗：房间进行中每 1.2s 检查一次「是否仍在等 AI 决策」。
   *
   * 正常情况下 kickAI 在每次状态变更后已经把 AI 走完，这里永远是空转。
   * 但只要有一次驱动被异常打断（广播/录像抛错、极端重入），旧行为就会靠 30s/45s 超时兜底；
   * 而单人 vs AI 房间不再布防超时（见 needsTimeout），一旦卡住就永久卡住。
   * 因此加一层只驱动 AI、绝不替真人行动的兜底泵。
   */
  private startAIWatchdog(): void {
    if (this.aiWatchdog) return;
    this.aiWatchdog = setInterval(() => {
      try {
        const g = this.game;
        if (!g || this.state !== 'playing' || g.isOver()) return;
        const pendingAIThrow = g.phase === 'rps1'
          && this.seats.some((s) => s.type === 'ai' && g.players[s.playerId]?.alive && !g.submittedIds.includes(s.playerId));
        const cur = g.currentActor();
        const aiTurn = g.phase === 'act' && !!cur && this.seatOf(cur)?.type === 'ai';
        // 现场签名：同一现场连续 3 次驱动都推不动就不再重试，避免刷广播
        const sig = `${g.phase}|${g.roundNo}|${g.subRound}|${g.submittedIds.length}|${g.actIndex}|${g.queue.length}`;
        if (!pendingAIThrow && !aiTurn) {
          this.aiWatchdogSig = sig;
          this.aiWatchdogTries = 0;
          return;
        }
        if (sig === this.aiWatchdogSig) {
          if (this.aiWatchdogTries >= 3) return;
          this.aiWatchdogTries++;
        } else {
          this.aiWatchdogSig = sig;
          this.aiWatchdogTries = 1;
        }
        // 复用统一变更收口：kickAI + 录帧 + 终局判定 + 超时布防 + 广播
        this.afterGameMutation();
      } catch (e) {
        console.error('[room] AI 看门狗异常：', e);
      }
    }, 1200);
    (this.aiWatchdog as unknown as { unref?: () => void }).unref?.();
  }

  private stopAIWatchdog(): void {
    if (this.aiWatchdog) { clearInterval(this.aiWatchdog); this.aiWatchdog = null; }
  }

  /**
   * 是否布防「出拳/行动超时」。
   *
   * 超时的存在意义只有一个：别让别人干等你。所以只在**房间里还有别人在等**时才布防：
   * - ≥2 名真人 → 布防（一人挂机会拖死全桌）
   * - 单人 vs AI（1 真人 + N AI）→ 不布防。AI 是即时应答的，没有任何人在等你，
   *   超时代掷 / 自动跳过只会打断你自己的思考（用户确认 2026-11-20）
   * - 单设备多人（type: 'local'）→ 不布防，所有人都在同一块屏幕上，不存在网络等待
   */
  private needsTimeout(): boolean {
    return this.seats.filter((s) => s.type === 'human').length >= 2;
  }

  /** 出拳超时：系统代掷（不泄露原选择——本来就没有） */
  private armSubmitTimeout(): void {
    this.disarmSubmitTimeout();
    if (this.config.submitTimeoutMs <= 0 || !this.needsTimeout()) return;
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

  /** 行动超时：自动跳过（同样只在有人等的时候布防） */
  private armActTimeout(): void {
    this.disarmActTimeout();
    if (this.config.turnTimeoutMs <= 0 || !this.needsTimeout()) return;
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
    this.stopAIWatchdog();
  }

  /**
   * 重置房间（重开游戏）。
   * @param autoStart true = 重置后立即以原座位开局（对局结束「再来一局」直达新局，
   *                  无需回大厅再点开始）；缺省保持旧行为（回大厅等待房主开始）。
   *                  自动开局只广播一次 playing 态，客户端不闪大厅中间页。
   */
  restart(opts?: { autoStart?: boolean }): { ok: boolean; error?: string } {
    if (this.state === 'lobby') return { ok: false, error: '房间尚未开始过' };
    // 丢弃本局前先把日志游标推到本局最大 seq，下一局续接，避免 seq 回退撞号
    this.syncLogSeqCursor();
    this.broadcastLogSeq = this.logSeqCursor;
    this.state = 'lobby';
    this.game = null;
    this.recording = null;
    this.lastFrameSig = '';
    this.lastFrameLogSeq = 0;
    this.interactions = [];
    this.interactionCounts = {};
    this.disarmAll();
    if (opts?.autoStart) {
      const started = this.start();
      return started.ok ? { ok: true } : started;
    }
    this.onBroadcast(this);
    return { ok: true };
  }

  dispose(): void {
    this.disarmAll();
  }

  // ═══════════════ 局内小互动（丢番茄等，纯娱乐） ═══════════════

  /**
   * 丢番茄 / 鸡蛋 / 献花。不消耗行动、不影响任何规则判定，
   * 只受「每人 2.2 秒一次」与目标存活约束。
   */
  interact(from: PlayerId, to: PlayerId, kind: InteractionKind): { ok: boolean; error?: string } {
    if (!this.game) return { ok: false, error: '对局未开始' };
    if (this.game.isOver()) return { ok: false, error: '对局已结束' };
    const seat = this.seatOf(from);
    if (!seat) return { ok: false, error: '座位不存在' };
    if (from === to) return { ok: false, error: '不能对自己出手' };
    const target = this.game.players[to];
    if (!target) return { ok: false, error: '目标不存在' };
    if (!target.alive) return { ok: false, error: '目标已被淘汰，手下留情' };
    const k = kind === 'egg' || kind === 'flower' ? kind : 'tomato';
    const now = Date.now();
    if (now - (this.lastInteractAt[from] ?? 0) < INTERACT_COOLDOWN_MS) {
      return { ok: false, error: '手速太快了，歇一会儿再扔' };
    }
    this.lastInteractAt[from] = now;
    this.interactions.push({ id: ++this.interactSeq, from, fromName: seat.name, to, kind: k, ts: now });
    if (this.interactions.length > 40) this.interactions = this.interactions.slice(-40);
    const g1 = (this.interactionCounts[from] ??= { given: 0, got: 0 });
    g1.given++;
    const g2 = (this.interactionCounts[to] ??= { given: 0, got: 0 });
    g2.got++;
    this.onBroadcast(this);
    return { ok: true };
  }

  // ═══════════════ 对局回放（状态帧录制） ═══════════════

  private startRecording(): void {
    if (!this.game) return;
    this.recording = {
      id: `RP${Date.now().toString(36)}-${++this.replaySeq}`,
      ts: Date.now(),
      seed: this.game.seed,
      winner: null,
      winnerName: null,
      rounds: 1,
      frameCount: 0,
      players: this.game.playerIds.map((pid) => ({
        id: pid,
        name: this.game!.players[pid].name,
        charId: this.game!.players[pid].charId,
        charName: this.game!.charName(pid),
      })),
      frames: [],
    };
    this.lastFrameSig = '';
    this.lastFrameLogSeq = 0;
  }

  /** 未结束的对局也能看（回放进行中） */
  currentReplay(): ReplayRecord | null {
    return this.recording;
  }

  /** 录制一帧（状态无变化则跳过，避免重复帧） */
  private captureFrame(): void {
    const g = this.game;
    const rec = this.recording;
    if (!g || !rec) return;
    if (rec.frames.length >= MAX_REPLAY_FRAMES) return;
    const players: ReplayPlayer[] = g.playerIds.map((pid) => {
      const p = g.players[pid];
      return {
        id: p.id, name: p.name, charId: p.charId, charName: g.charName(pid),
        hp: p.hp, maxHp: p.maxHp, room: p.room, alive: p.alive,
        hidden: p.hidden, invisible: p.invisible, type: p.type,
        stats: { ...g.stats[pid] },
      };
    });
    const reveal = g.revealInfo();
    const submitted = g.submittedIds.filter((pid) => g.players[pid]?.alive);
    const winner = g.winner ?? null;
    const sig = [
      g.roundNo, g.subRound, g.phase, g.currentActor() ?? '-', g.actIndex, winner ?? '-',
      submitted.length, reveal ? `${reveal.sub}/${reveal.outcome}` : '-',
      players.map((p) => `${p.id}:${p.hp}:${p.room}:${p.alive ? 1 : 0}:${p.hidden ? 1 : 0}:${p.invisible ? 1 : 0}`).join(','),
    ].join('|');
    if (sig === this.lastFrameSig) return;
    this.lastFrameSig = sig;
    const logs = g.logs.filter((l) => l.seq > this.lastFrameLogSeq).map((l) => ({
      seq: l.seq, type: l.type, text: l.text, important: l.important,
    }));
    if (g.logs.length > 0) this.lastFrameLogSeq = g.logs[g.logs.length - 1].seq;
    const frame: ReplayFrame = {
      i: rec.frames.length,
      roundNo: g.roundNo,
      phase: g.phase,
      subRound: g.subRound,
      players,
      roomIds: [...g.roomIds],
      reveal,
      currentActor: g.currentActor(),
      queue: [...g.queue],
      actIndex: g.actIndex,
      aliveCount: g.aliveIds().length,
      winner,
      logs,
    };
    rec.frames.push(frame);
    rec.rounds = g.roundNo;
    rec.winner = winner;
    rec.frameCount = rec.frames.length;
  }

  private finishRecording(): void {
    const rec = this.recording;
    if (!rec) return;
    this.captureFrame();
    rec.rounds = this.game?.roundNo ?? rec.rounds;
    rec.frameCount = rec.frames.length;
    const w = rec.winner ?? null;
    rec.winnerName = w ? (rec.players.find((p) => p.id === w)?.name ?? null) : null;
    this.replays.unshift(rec);
    if (this.replays.length > MAX_REPLAYS) this.replays = this.replays.slice(0, MAX_REPLAYS);
    this.recording = null;
  }

  replayList(): ReplaySummary[] {
    const list: ReplaySummary[] = this.replays.map((r) => ({
      id: r.id, ts: r.ts, seed: r.seed, winner: r.winner, winnerName: r.winnerName,
      rounds: r.rounds, frameCount: r.frameCount, players: r.players,
    }));
    return list;
  }

  replayGet(id: string): ReplayRecord | null {
    const done = this.replays.find((r) => r.id === id);
    if (done) return done;
    if (this.recording && this.recording.id === id) return this.recording;
    return null;
  }

  /** 大厅快照（不含令牌） */
  lobbySnapshot(): Record<string, unknown> {
    return {
      code: this.code,
      state: this.state,
      /** 第几局（重开累加）：客户端据此清空上一局战斗日志 */
      gameNo: this.gameNo,
      hostSeat: this.hostSeat,
      seats: this.seats.map((s) => ({
        playerId: s.playerId, name: s.name, charId: s.charId, type: s.type,
        connected: s.connected,
      })),
      chat: this.chat.slice(-50),
      config: { submitTimeoutMs: this.config.submitTimeoutMs, turnTimeoutMs: this.config.turnTimeoutMs },
      aiDifficulty: this.aiDifficulty,
      interactions: this.interactions.slice(-30),
      interactionCounts: this.interactionCounts,
      replays: this.replayList(),
    };
  }

  /** 大厅房间列表条目（公开信息） */
  listEntry(): Record<string, unknown> {
    const host = this.seats.find((s) => s.playerId === this.hostSeat);
    return {
      code: this.code,
      state: this.state,
      seatCount: this.seats.length,
      humans: this.seats.filter((s) => s.type !== 'ai').length,
      hostName: host?.name || '?',
      updatedAt: Date.now(),
    };
  }

  addChat(name: string, text: string): void {
    this.chat.push({ name, text: text.slice(0, 200), ts: Date.now() });
    if (this.chat.length > 50) this.chat = this.chat.slice(-50);
  }
}

// ═══════════════════ AI 决策（与规则引擎分离，只提交合法行动） ═══════════════════

/** 某出拳的克制拳（用于硬核 AI 反制） */
const COUNTER: Record<Throw, Throw> = { rock: 'paper', scissors: 'rock', paper: 'scissors' };

/**
 * AI 出拳。
 *  - easy / normal：随机（引擎种子流，可复现）
 *  - hard：统计对手历史出拳频率反制（30% 随机扰动，避免被读牌）
 */
export function aiThrow(g: Game, pid: PlayerId, difficulty: AiDifficulty = 'normal'): Throw {
  if (difficulty !== 'hard') return randomThrow(g.rng);
  const counts: Record<Throw, number> = { rock: 0, scissors: 0, paper: 0 };
  for (const [other, list] of Object.entries(g.throwHistory ?? {})) {
    if (other === pid) continue;
    for (const t of list.slice(-4)) counts[t] = (counts[t] ?? 0) + 1;
  }
  const total = counts.rock + counts.scissors + counts.paper;
  if (total < 3) return randomThrow(g.rng);
  if (g.rng.next() < 0.3) return randomThrow(g.rng);
  const mostCommon = (Object.keys(counts) as Throw[]).sort((a, b) => counts[b] - counts[a])[0];
  return COUNTER[mostCommon];
}

/** 威胁评分：攻击力 + 血量（硬核 AI 用来挑「最危险的对手」） */
function threatOf(g: Game, pid: PlayerId): number {
  const p = g.players[pid];
  const cd = g.charDef(pid);
  const atk = cd.meleeDamage ?? cd.attack ?? g.rules.defaultAttack;
  return atk * 2 + p.hp;
}

/** 简单可解释的 AI 行动策略（普通难度，保留原行为以便回归） */
export function aiDecideAction(g: Game, pid: PlayerId, difficulty: AiDifficulty = 'normal'): ActionRequest {
  return aiDecideActions(g, pid, difficulty)[0];
}

/**
 * 返回按优先级排列的候选行动。
 * 调用方（Room.kickAI）依次尝试，第一份被引擎接受的即为 AI 本回合行动 —— 
 * 这样即使某个角色有额外限制，AI 也不会卡住对局。
 */
export function aiDecideActions(g: Game, pid: PlayerId, difficulty: AiDifficulty = 'normal'): ActionRequest[] {
  const primary = difficulty === 'easy' ? easyDecide(g, pid)
    : difficulty === 'hard' ? hardDecide(g, pid)
      : normalDecide(g, pid);
  const chain: ActionRequest[] = [primary];
  const push = (a: ActionRequest) => {
    if (!chain.some((x) => JSON.stringify(x) === JSON.stringify(a))) chain.push(a);
  };
  // 回退链：保证一定有一个能被接受的行动（最差为跳过）
  const me = g.players[pid];
  const sameRoom = g.roomMembers(me.room).filter((p) => p !== pid && !g.players[p].hidden && !g.players[p].invisible);
  for (const t of sameRoom) push({ type: 'attack', targetId: t });
  if (me.hp < me.maxHp) push({ type: 'heal' });
  const otherRoom = g.roomIds.find((r) => r !== me.room && g.roomMembers(r).length > 0);
  if (otherRoom) push({ type: 'move', room: otherRoom });
  if (g.rules.allowHide && !me.hidden) push({ type: 'hide' });
  push({ type: 'skip' });
  return chain;
}

/** 休闲：随性而为，常常做些没用的事 */
function easyDecide(g: Game, pid: PlayerId): ActionRequest {
  const me = g.players[pid];
  const members = g.roomMembers(me.room).filter((p) => p !== pid);
  const visible = members.filter((m) => !(g.players[m].hidden || g.players[m].invisible));
  const roll = g.rng.next();
  if (roll < 0.18 && g.rules.allowHide && !me.hidden) return { type: 'hide' };
  if (roll < 0.28) return { type: 'skip' };
  if (roll < 0.4 && me.hp < me.maxHp) return { type: 'heal' };
  if (visible.length > 0 && roll < 0.8) {
    return { type: 'attack', targetId: g.rng.pick(visible) };
  }
  if (visible.length > 0) return { type: 'attack', targetId: visible[0] };
  const rooms = g.roomIds.filter((r) => r !== me.room);
  if (rooms.length > 0) return { type: 'move', room: g.rng.pick(rooms) };
  return { type: 'skip' };
}

/** 普通：原策略（残血回复 → 角色特化 → 击杀优先 → 补给/移动 → 躲藏） */
function normalDecide(g: Game, pid: PlayerId): ActionRequest {
  const me = g.players[pid];
  const cd = g.charDef(pid);
  const members = g.roomMembers(me.room).filter((p) => p !== pid);
  const alive = g.aliveIds().filter((p) => p !== pid);

  // 血量低且同房间有威胁 → 优先回复
  if (me.hp < me.maxHp && me.hp <= 1 && members.length > 0) {
    return { type: 'heal' };
  }

  const st = g.charState(pid);
  switch (cd.id) {
    case 'bagun':
      if (!st.stickDrawn) return { type: 'toggleStick' };
      if (members.length > 0) return { type: 'attack', targetId: members[0] };
      break;
    case 'chuixiao': {
      // 仅远程、无需瞄准：直接攻击异房间可见目标
      const targets = alive.filter((p) => !g.isSameRoom(pid, p) && !(g.players[p].hidden || g.players[p].invisible));
      if (targets.length > 0) {
        const weakest = targets.sort((a, b) => g.players[a].hp - g.players[b].hp)[0];
        return { type: 'attack', targetId: weakest, ranged: true };
      }
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
    case 'hero-today': {
      // 绝境时赌运势：第一回合且血量≤1 时抽取（20%暴毙 vs 80%获得更好面板）
      if (g.roundNo === 1 && me.hp <= 1 && st.fortuneUsed !== true) return { type: 'rollFortune' };
      break;
    }
    case 'dapihuai':
    case 'laodaye':
    case 'default':
      break;
  }

  // 通用策略：同房间有目标 → 优先攻击可击杀目标（目标血量≤我的攻击力），否则攻击血量最低者；
  // 满血且无目标 → 移向人多房间；否则回复/躲藏
  if (members.length > 0) {
    const visible = members.filter((m) => !(g.players[m].hidden || g.players[m].invisible));
    const myAtk = cd.meleeDamage ?? cd.attack ?? g.rules.defaultAttack;
    const killable = visible
      .filter((m) => g.players[m].hp <= myAtk)
      .sort((a, b) => g.players[a].hp - g.players[b].hp)[0];
    const target = killable || visible.sort((a, b) => g.players[a].hp - g.players[b].hp)[0];
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

/**
 * 硬核：
 *  - 先算「能不能杀人」：同房间可击杀者优先，远程可击杀者也优先（必要时先瞄准）；
 *  - 残血且本房间有人能一击带走自己 → 先把自己救回来（回复/撤离）；
 *  - 无击杀机会时挑威胁最高的目标打，而不是随手打第一个；
 *  - 满血无事可做才移动/躲藏，绝不空过有输出机会的回合。
 */
function hardDecide(g: Game, pid: PlayerId): ActionRequest {
  const me = g.players[pid];
  const cd = g.charDef(pid);
  const st = g.charState(pid);
  const sameRoom = g.roomMembers(me.room).filter((p) => p !== pid);
  const aliveOthers = g.aliveIds().filter((p) => p !== pid);
  const visibleSame = sameRoom.filter((p) => !(g.players[p].hidden || g.players[p].invisible));
  const myAtk = cd.meleeDamage ?? cd.attack ?? g.rules.defaultAttack;
  const domainExempt = cd.aimExemptWhenDomain && st.domain === true;

  // 角色开场能力优先（领域/拔棍/运势）
  if (cd.id === 'bagun' && !st.stickDrawn) return { type: 'toggleStick' };
  if (cd.id === 'gojo' && st.domain !== true) return { type: 'domain' };
  if (cd.id === 'hero-today' && g.roundNo === 1 && me.hp <= 1 && st.fortuneUsed !== true) return { type: 'rollFortune' };
  if (cd.id === 'mabaoguo' && sameRoom.some((m) => g.players[m].maxHp >= 3)) {
    return { type: 'whip5', targetId: sameRoom[0] };
  }
  if (cd.id === 'ivan-girl') {
    const best = g.roomIds
      .filter((r) => r !== me.room)
      .map((r) => ({ r, n: g.roomMembers(r).length }))
      .sort((a, b) => b.n - a.n)[0];
    if (best && best.n >= 2) return { type: 'throwIvan', room: best.r };
  }

  // 1) 能一击带走的目标（同房间）
  const killableNow = visibleSame.filter((m) => g.players[m].hp <= myAtk);
  if (killableNow.length > 0) {
    const target = killableNow.sort((a, b) => threatOf(g, b) - threatOf(g, a))[0];
    return { type: 'attack', targetId: target };
  }

  // 2) 自身危险：同房间有人能一击带走我 → 先保命
  const danger = visibleSame.some((m) => {
    const mcd = g.charDef(m);
    const atk = mcd.meleeDamage ?? mcd.attack ?? g.rules.defaultAttack;
    return atk >= me.hp;
  });
  if (danger && me.hp < me.maxHp) return { type: 'heal' };
  if (danger && sameRoom.length > 0) {
    const safe = g.roomIds.find((r) => r !== me.room && g.roomMembers(r).length === 0);
    if (safe) return { type: 'move', room: safe };
  }

  // 3) 远程击杀（吹箫哥/五条悟等）：能立刻杀掉异房间残血目标则出手
  if (cd.rangedCapable) {
    const rangedDamage = cd.rangedDamage ?? cd.attack ?? g.rules.defaultAttack;
    const rangedTargets = aliveOthers.filter((p) => !g.isSameRoom(pid, p) && !(g.players[p].hidden || g.players[p].invisible));
    const remoteKill = rangedTargets.filter((p) => g.players[p].hp <= rangedDamage);
    const pickRemote = remoteKill.sort((a, b) => threatOf(g, b) - threatOf(g, a))[0];
    if (pickRemote) {
      if (cd.rangedNeedsAim && !domainExempt && st.aim !== pickRemote) {
        return { type: 'aim', targetId: pickRemote };
      }
      return { type: 'attack', targetId: pickRemote, ranged: true };
    }
  }

  // 4) 打房间里威胁最高的目标
  if (visibleSame.length > 0) {
    const target = visibleSame.sort((a, b) => threatOf(g, b) - threatOf(g, a))[0];
    return { type: 'attack', targetId: target };
  }

  // 5) 房间空了：补血后主动找人（优先人多且有残血的房间）
  if (me.hp < me.maxHp) return { type: 'heal' };
  const rooms = g.roomIds
    .filter((r) => r !== me.room)
    .map((r) => {
      const mem = g.roomMembers(r);
      const weak = mem.filter((m) => g.players[m].hp <= myAtk).length;
      return { r, n: mem.length, weak };
    })
    .filter((x) => x.n > 0)
    .sort((a, b) => (b.weak - a.weak) || (b.n - a.n));
  if (rooms.length > 0) return { type: 'move', room: rooms[0].r };
  if (g.rules.allowHide && !me.hidden) return { type: 'hide' };
  return { type: 'skip' };
}
