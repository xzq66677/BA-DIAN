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

import { REPLAY_FORMAT_VERSION, type ChatMessage, type LobbyState, type RoomListEntry, type RoomState } from '../../shared/src/protocol.js';
import { MatchRecorder } from '../../shared/src/simulation.js';
import type { MatchInput, MatchSetup } from '../../shared/src/simulation-types.js';
import { Game } from '../../shared/src/engine.js';
import { CHARACTERS } from '../../shared/src/characters/index.js';
import { buildAnnouncements, type AnnounceItem } from '../../shared/src/announce.js';
import { MAX_ROOM_SEATS } from '../../shared/src/room-limits.js';
import { parseMapConfig, type MapConfig } from '../../shared/src/map-config.js';
import type {
  PlayerId, ActionRequest, Throw, GamePlayerConfig, RuleConfig, AiDifficulty,
  InteractionEvent, InteractionKind, ReplayFrame, ReplayRecord, ReplaySummary, ReplayPlayer,
  LogEntry,
} from '../../shared/src/types.js';
import { randomThrow } from '../../shared/src/rng.js';

import { aiDecideActions, aiThrow } from './ai.js';
export type { ChatMessage, RoomState } from '../../shared/src/protocol.js';
export { aiDecideAction, aiDecideActions, aiThrow } from './ai.js';

export interface Seat {
  playerId: PlayerId;
  name: string;
  charId: string;
  type: 'human' | 'ai' | 'local';
  /** 人类玩家的重连令牌（AI 无） */
  token?: string;
  socketId?: string;
  /** 原始主座位标识，断线后仍可找回同一设备上的本地席位。 */
  deviceHostId?: PlayerId;
  connected: boolean;
}

export interface RoomConfig {
  map: MapConfig;
  rules?: Partial<RuleConfig>;
  seed?: number;
  turnTimeoutMs: number;
  submitTimeoutMs: number;
  aiDifficulty?: AiDifficulty;
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
  private matchRecorder: MatchRecorder | null = null;
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
      map: parseMapConfig(config?.map),
      // 线上对局默认「二次判定 / 技能判定都由玩家亲自出拳」；显式传 serverRoll 时保留（自动化用例）
      rules: { secondJudgeMode: 'player', skillJudgeMode: 'player', ...(config?.rules ?? {}) },
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

  bindDevice(seat: Seat, socketId: string): Set<string> {
    const host = seat.deviceHostId ?? seat.playerId;
    const previous = new Set<string>();
    for (const member of this.seats) {
      if (member.playerId !== host && member.deviceHostId !== host) continue;
      if (member.socketId && member.socketId !== socketId) previous.add(member.socketId);
      member.socketId = socketId;
      member.connected = true;
    }
    return previous;
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

  /** 房间是否还有空位（服务端权威上限；socket 处理器在 addSeat 前统一调用） */
  canAddSeat(): boolean {
    return this.seats.length < MAX_ROOM_SEATS;
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
    const setup: MatchSetup = {
      seed: usedSeed, players, rules: this.config.rules ?? {},
      mapId: this.config.map.id === 'floating-ruins' && this.config.map.mechanics.weather
        ? 'floatingRuins' : 'classic',
      // 续接上一局的日志序号，保证同一房间内 seq 单调递增（否则第二局日志会被当成重复丢弃）
      logSeqOffset: this.logSeqCursor,
    };
    this.game = new Game({ ...setup, chars: CHARACTERS });
    this.matchRecorder = new MatchRecorder(this.game, setup);
    this.state = 'playing';
    this.interactions = [];
    this.interactionCounts = {};
    this.lastInteractAt = {};
    this.startRecording();
    // 捕捉 AI 首次提交前的开局状态，随后与其它输入复用同一条推进链。
    this.captureFrame();
    if (this.seats.some((s) => s.type === 'ai')) this.startAIWatchdog();
    this.afterGameMutation();
    return { ok: true };
  }

  /** 玩家提交出拳（服务端统一入口，隐藏提交；按阶段路由到回合判定 / 二次判定） */
  submitThrow(playerId: PlayerId, t: Throw): { ok: boolean; error?: string } {
    const r = this.applyMatchInput({ kind: 'throw', source: 'player', playerId, value: t });
    if (!r.ok) return r;
    this.disarmSubmitTimeout();
    this.afterGameMutation();
    return r;
  }

  submitAction(playerId: PlayerId, req: ActionRequest): { ok: boolean; error?: string } {
    const r = this.applyMatchInput({ kind: 'action', source: 'player', playerId, action: req });
    if (!r.ok) return r;
    this.disarmActTimeout();
    this.afterGameMutation();
    return r;
  }

  private applyMatchInput(input: MatchInput) {
    return this.matchRecorder?.apply(input) ?? { ok: false, error: '游戏未开始' };
  }

  /** 删除座位并移出对局。调用方负责连接解绑与房间解散。 */
  removeParticipants(ids: PlayerId[], reason: 'left' | 'kicked' | 'removed', host?: PlayerId): boolean {
    for (const id of ids) this.removeSeat(id);
    if (this.state !== 'playing' || !this.game || ids.length === 0) return false;
    this.applyMatchInput({ kind: 'remove', ids, reason, host });
    if (this.humanSeats().length > 0) {
      this.disarmSubmitTimeout();
      this.disarmActTimeout();
      this.afterGameMutation();
      return true;
    }
    return false;
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
    if (this.game.phase === 'rps1' || this.game.phase === 'rps2' || this.game.phase === 'judge') this.armSubmitTimeout();
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

  /** 当前局玩家名映射（pid → 显示名）；无对局时回退到座位名 */
  playerNames(): Record<string, string> {
    const names: Record<string, string> = {};
    for (const s of this.seats) names[s.playerId] = s.name;
    const g = this.game;
    if (g) for (const pid of Object.keys(g.players)) names[pid] = g.players[pid].name;
    return names;
  }

  /**
   * 把一批增量日志转成**全局播报**（服务端权威）。
   *
   * 关键点：同一房间所有座位收到的是这一次调用的同一份结果——
   * 内容、顺序、`ts` 完全一致，因此「所有人看到同一句播报、同一个时间」。
   * 规则表可在 shared/src/announce.ts 扩展，服务端无需改动。
   */
  toAnnouncements(logs: readonly LogEntry[]): AnnounceItem[] {
    if (logs.length === 0) return [];
    return buildAnnouncements(logs, { names: this.playerNames(), now: Date.now() });
  }

  /** 断线重连补发：最近 N 条播报（与 catchUpLogs 同窗口，定向发送） */
  catchUpAnnouncements(limit: number = Room.RECONNECT_CATCHUP_LOGS): AnnounceItem[] {
    return this.toAnnouncements(this.catchUpLogs(limit));
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
          this.applyMatchInput({ kind: 'throw', source: 'ai', playerId: s.playerId, value: t });
          this.captureFrame();
        }
        continue;
      }
      if (g.phase === 'rps2') {
        // 二次判定（行动排序）：只有「当前子轮参与组」里的 AI 需要出拳
        const group = g.currentOrderGroup();
        const pending = group.filter((pid) => !g.orderSubmittedIds.includes(pid) && this.seatOf(pid)?.type === 'ai');
        if (pending.length === 0) break;
        for (const pid of pending) {
          const t = aiThrow(g, pid, this.aiDifficulty);
          this.applyMatchInput({ kind: 'throw', source: 'ai', playerId: pid, value: t });
          this.captureFrame();
        }
        continue;
      }
      if (g.phase === 'judge') {
        // 技能内判定（太极/五连鞭/不讲武德）：只补 AI 那一份，绝不替真人出拳
        const view = g.skillJudgeView();
        if (!view) break;
        const pending = view.waitingIds.filter((pid) => this.seatOf(pid)?.type === 'ai' || !this.seatOf(pid));
        if (pending.length === 0) break;
        for (const pid of pending) {
          const seat = this.seatOf(pid);
          const value = seat ? aiThrow(g, pid, this.aiDifficulty) : randomThrow(g.rng);
          this.applyMatchInput({ kind: 'throw', source: seat ? 'ai' : 'departure', playerId: pid, value });
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
          if (this.applyMatchInput({ kind: 'action', source: 'ai', playerId: cur, action: act }).ok) { done = true; break; }
        }
        if (!done) this.applyMatchInput({ kind: 'action', source: 'ai', playerId: cur, action: { type: 'skip' } });
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
          ? this.seats.some((s) => s.type === 'ai' && g.players[s.playerId]?.alive && !g.submittedIds.includes(s.playerId))
          : g.phase === 'rps2'
            ? g.currentOrderGroup().some((pid) => this.seatOf(pid)?.type === 'ai' && !g.orderSubmittedIds.includes(pid))
            : g.phase === 'judge'
              ? (g.skillJudgeView()?.waitingIds ?? []).some((pid) => this.seatOf(pid)?.type === 'ai' || !this.seatOf(pid))
              : false;
        const cur = g.currentActor();
        const aiTurn = g.phase === 'act' && !!cur && this.seatOf(cur)?.type === 'ai';
        // 现场签名：同一现场连续 3 次驱动都推不动就不再重试，避免刷广播
        const sig = `${g.phase}|${g.roundNo}|${g.subRound}|${g.submittedIds.length}|${g.orderSubmittedIds.length}|${g.skillJudgeView()?.submittedIds.length ?? 0}|${g.actIndex}|${g.queue.length}`;
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

  /** 出拳超时：系统代掷（rps1 回合判定 / rps2 行动排序 共用同一超时配置） */
  private armSubmitTimeout(): void {
    this.disarmSubmitTimeout();
    if (this.config.submitTimeoutMs <= 0 || !this.needsTimeout()) return;
    this.submitTimer = setTimeout(() => {
      if (this.applyMatchInput({ kind: 'throwTimeout' }).ok) this.afterGameMutation();
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
          this.applyMatchInput({ kind: 'actionTimeout', playerId: cur });
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
    this.matchRecorder = null;
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
      v: REPLAY_FORMAT_VERSION,
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
    const atCapacity = rec.frames.length >= MAX_REPLAY_FRAMES;
    if (atCapacity) {
      rec.truncated = true;
      if (!g.isOver()) return;
    }
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
      i: atCapacity ? rec.frames.length - 1 : rec.frames.length,
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
    if (atCapacity) rec.frames[frame.i] = frame;
    else rec.frames.push(frame);
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
    rec.winner = this.game?.winner ?? null;
    rec.simulation = this.matchRecorder?.transcript;
    this.matchRecorder = null;
    const w = rec.winner;
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
  lobbySnapshot(): LobbyState {
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
      config: { submitTimeoutMs: this.config.submitTimeoutMs, turnTimeoutMs: this.config.turnTimeoutMs, map: this.config.map },
      aiDifficulty: this.aiDifficulty,
      interactions: this.interactions.slice(-30),
      interactionCounts: this.interactionCounts,
      replays: this.replayList(),
    };
  }

  /** 大厅房间列表条目（公开信息） */
  listEntry(): RoomListEntry {
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
