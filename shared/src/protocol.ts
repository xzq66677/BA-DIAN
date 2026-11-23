import type { AnnounceItem } from './announce.js';
import type { RuinsConditions } from './floating-ruins.js';
import type {
  AiDifficulty, DeferredEvent, GamePhase, InteractionEvent, JudgeRoundRecord,
  LogEntry, PlayerState, PlayerStats, ReplaySummary, RevealInfo, SkillJudgeView,
} from './types.js';

/** Missing version fields identify the legacy wire format. Version 1 is additive. */
export const PROTOCOL_VERSION = 1;
export const REPLAY_FORMAT_VERSION = 1;

export function supportsProtocol(version: unknown): boolean {
  return version === undefined || version === PROTOCOL_VERSION;
}

export function supportsReplayFormat(version: unknown): boolean {
  return version === undefined || version === REPLAY_FORMAT_VERSION;
}

export type SnapPlayer = PlayerState & { charName: string };
export type SnapLog = LogEntry;
export type RoomState = 'lobby' | 'playing' | 'over';
export interface ChatMessage { name: string; text: string; ts: number }

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
  state: RoomState;
  /** 第几局（1 起，重开累加）：变化即代表新一局，战斗日志需清空重来 */
  gameNo?: number;
  hostSeat: string | null;
  seats: LobbySeat[];
  chat: ChatMessage[];
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

export interface RoomListEntry {
  code: string;
  state: RoomState;
  seatCount: number;
  humans: number;
  hostName: string;
  updatedAt: number;
}

export interface GameSnapshot {
  v?: number;
  seed: number;
  roundNo: number;
  subRound: number;
  phase: GamePhase;
  players: SnapPlayer[];
  roomIds: string[];
  ruins?: RuinsConditions;
  submittedIds: string[];
  pendingCount: number;
  qualified: string[];
  queue: string[];
  actIndex: number;
  currentActor: string | null;
  deferred: DeferredEvent[];
  judgeRecords: JudgeRoundRecord[];
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
  winner: string | null;
  aliveCount: number;
}

export interface RoomUpdate {
  v?: number;
  lobby: LobbyState;
  game: GameSnapshot | null;
  newLogs: SnapLog[];
  /**
   * 全局播报增量（与 newLogs 同批、所有座位同一份）。
   * 旧服务端不发送该字段时为 undefined —— 客户端按「无播报」安全降级。
   */
  announces?: AnnounceItem[];
  catchUp?: boolean;
  you: string | null;
}
