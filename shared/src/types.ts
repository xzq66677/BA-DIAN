/**
 * 拔典 · 核心类型定义
 * 规则引擎完全独立于前端与网络层。
 */

export type Throw = 'rock' | 'scissors' | 'paper';

export type PlayerId = string;
export type RoomId = string;

/** 判定单步结果：赢 / 平 / 输 */
export type JudgeStep = 'win' | 'tie' | 'lose';

export type PlayerType = 'human' | 'ai' | 'local';

export type GamePhase = 'rps1' | 'act' | 'roundEnd' | 'over';

export interface CharRuntimeState {
  [key: string]: unknown;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  charId: string;
  hp: number;
  maxHp: number;
  /** 当前所在房间（动态） */
  room: RoomId;
  /** 初始房间（固定，不随淘汰消失） */
  originRoom: RoomId;
  alive: boolean;
  type: PlayerType;
  /** 躲藏状态：指向性攻击无法锁定（AOE 与无视躲避的攻击除外） */
  hidden: boolean;
  /** 隐身状态（与躲藏类似但来源不同，如部分角色被动） */
  invisible: boolean;
  /** 角色私有运行状态（拔棍状态、领域、瞄准、辱骂层数、判定历史等） */
  char: CharRuntimeState;
}

export interface DamageRequest {
  target: PlayerId;
  amount: number;
  /** 伤害来源玩家（可无，如爆炸） */
  source?: PlayerId;
  /** 物理 / 精神 / 特殊 */
  dtype: 'physical' | 'mental' | 'special';
  /** AOE 伤害（可命中躲藏目标） */
  aoe?: boolean;
  /** 多段信息：第 index 段 / 共 total 段 */
  segment?: { index: number; total: number };
  /** 无视躲藏（如拔棍；大贱客转移后的直击） */
  ignoreHide?: boolean;
  /** 精神类锁定无视躲藏（如大贱客辱骂） */
  bypassHide?: boolean;
  /** 不触发「受伤判定反弹」类被动（大伊万爆炸、肉山坐） */
  noReflect?: boolean;
  /** 已是反弹伤害（终止反弹链） */
  reflected?: boolean;
  /** 已被转移（大贱客吸引） */
  transferred?: boolean;
  /** 伤害标签（ivan/insult/whip/berserk/selfdestruct...） */
  tag?: string;
  /** 原始效果附加（转移伤害时不随转移） */
  effects?: DamageEffect[];
  /**
   * 事件组标识（演出层用）：同一次行动产生的多段/AOE/延迟伤害共享一个 groupId，
   * 前端据此把多个目标组织成一次分组演出（先突出房间，再逐目标受击）。
   */
  groupId?: string;
}

/** 伤害附带效果（状态、控制等）。转移伤害时被剥离。 */
export interface DamageEffect {
  kind: string;
  [key: string]: unknown;
}

export interface AppliedDamage {
  target: PlayerId;
  finalTarget: PlayerId;
  amount: number;
  lethal: boolean;
  missed: boolean;
  reflected: boolean;
  transferred: boolean;
}

export type LogType =
  | 'phase' | 'judge' | 'order' | 'action' | 'damage' | 'heal' | 'move'
  | 'eliminate' | 'trigger' | 'state' | 'deferred' | 'error' | 'result' | 'info';

export interface LogEntry {
  seq: number;
  round: number;
  sub: number;
  phase: GamePhase;
  type: LogType;
  text: string;
  /** 重点事件（伤害/淘汰/触发/判定结果/回合小结等，前端高亮） */
  important?: boolean;
  data?: Record<string, unknown>;
}

// ─── 结构化事件负载（data 字段的类型化 schema） ────────────────
//
// 演出层（前端 BattleEventQueue）只信任这里的结构化字段，
// 不通过快照 HP 差分或日志文本猜测事件（任务书硬约束）。
// 所有字段对旧事件可缺省：前端对缺失字段安全降级。

/** 演出提示类型：引擎在 action 日志上标注的视觉反馈类别 */
export type BattleFxKind =
  | 'attack' | 'heal' | 'move' | 'milk' | 'skill'
  | 'aim' | 'hide' | 'seek' | 'skip';

/** 攻击宣告（type:'damage' 且 declared=true）：扣血事件之前的「出手意向」提示 */
export interface AttackDeclEventData {
  declared: true;
  source: PlayerId;
  target: PlayerId;
  amount: number;
  ranged?: boolean;
  room?: RoomId;
}

/** 实际扣血事件（type:'damage' 且非 declared）：受击演出的唯一权威来源 */
export interface DamageEventData {
  target: PlayerId;
  /** 来源玩家（爆炸/暴走等无来源时缺省；均为公开信息） */
  source?: PlayerId;
  /** 实际伤害量 */
  amount?: number;
  hpBefore?: number;
  hpAfter?: number;
  /** 致命伤害（后续会有 eliminate 事件衔接） */
  lethal?: boolean;
  dtype?: 'physical' | 'mental' | 'special';
  tag?: string;
  segment?: { index: number; total: number };
  aoe?: boolean;
  /** 未命中（躲藏/隐身/被完全抵消）——不触发受击演出 */
  missed?: boolean;
  /** 目标结算时所在房间（AOE 房间高亮用） */
  room?: RoomId;
  /** 事件组：AOE/多段/延迟伤害共用（同组演出分组呈现） */
  groupId?: string;
  reflected?: boolean;
  transferred?: boolean;
}

export interface HealEventData {
  target: PlayerId;
  amount: number;
  hpBefore: number;
  hpAfter: number;
  source?: PlayerId;
}

export interface MoveEventData {
  pid: PlayerId;
  from: RoomId;
  to: RoomId;
}

export interface EliminateEventData {
  pid: PlayerId;
  cause: string;
  /** 击杀者（本游戏内击杀者始终公开，与淘汰日志文本一致） */
  killer?: PlayerId;
}

/** 命数消耗复活（如五条悟 2 条命） */
export interface ReviveEventData {
  pid: PlayerId;
  livesLeft: number;
}

export interface ActionEventData {
  pid: PlayerId;
  fx: BattleFxKind;
  label: string;
  targetId?: PlayerId;
  room?: RoomId;
}

/** 延迟事件（回合末结算，如大伊万） */
export interface DeferredEvent {
  id: string;
  kind: 'ivan' | 'damage' | string;
  room: RoomId;
  /** 应引爆的回合号 */
  explodeRound: number;
  source?: PlayerId;
  createdAtRound: number;
  /** 通用延迟伤害负载（kind='damage' 时使用） */
  payload?: unknown;
}

export interface JudgeRoundRecord {
  stage: 'rps1' | 'rps2';
  sub: number;
  /** 该判定所属回合号（rps2 排序判定与回合判定同回合；平局回合的记录随翻页保留在 lastReveal） */
  round?: number;
  throws: Partial<Record<PlayerId, Throw>>;
  outcome: 'cycle' | 'alltie' | 'resolved' | 'tieWin';
  winners?: PlayerId[];
  losers?: PlayerId[];
}

/**
 * 出拳揭示信息（对局公开信息）。
 * 仅在判定子轮**结算完成后**生成：提交阶段任何拳种都不会出现在快照里，
 * 因此「全员可见彼此出拳」不会破坏隐藏出拳的公平性。
 */
export interface RevealInfo {
  round: number;
  stage: 'rps1' | 'rps2';
  sub: number;
  throws: Record<PlayerId, Throw>;
  outcome: JudgeRoundRecord['outcome'];
  winners: PlayerId[];
  losers: PlayerId[];
}

/** AI 难度分级：休闲（随性）/ 普通（默认策略）/ 硬核（反制与收益最大化） */
export type AiDifficulty = 'easy' | 'normal' | 'hard';

export const AI_DIFFICULTY_LABEL: Record<AiDifficulty, string> = {
  easy: '休闲',
  normal: '普通',
  hard: '硬核',
};

/** 局内战绩（纯统计，不影响规则判定） */
export interface PlayerStats {
  /** 初次判定出拳胜/负/平次数 */
  throwWin: number;
  throwLose: number;
  throwTie: number;
  /** 造成的伤害总量 */
  damageDealt: number;
  /** 承受的伤害总量 */
  damageTaken: number;
  /** 击杀数 */
  kills: number;
  /** 行动次数 */
  actions: number;
  /** 回复次数 */
  heals: number;
  /** 移动次数 */
  moves: number;
  /** 存活回合数 */
  roundsAlive: number;
}

export function emptyStats(): PlayerStats {
  return {
    throwWin: 0, throwLose: 0, throwTie: 0,
    damageDealt: 0, damageTaken: 0, kills: 0,
    actions: 0, heals: 0, moves: 0, roundsAlive: 0,
  };
}

/** 局内小互动（丢番茄等，纯娱乐，不进入规则引擎） */
export type InteractionKind = 'tomato' | 'egg' | 'flower';

export interface InteractionEvent {
  id: number;
  from: PlayerId;
  fromName: string;
  to: PlayerId;
  kind: InteractionKind;
  ts: number;
}

// ── 对局回放 ────────────────────────────────────────────────

/** 回放帧中的玩家状态（只保留展示所需字段） */
export interface ReplayPlayer {
  id: PlayerId;
  name: string;
  charId: string;
  charName: string;
  hp: number;
  maxHp: number;
  room: RoomId;
  alive: boolean;
  hidden: boolean;
  invisible: boolean;
  type: PlayerType;
  stats?: PlayerStats;
}

/** 回放帧：每次状态变化记录一帧（含该帧新增日志） */
export interface ReplayFrame {
  i: number;
  roundNo: number;
  phase: GamePhase;
  subRound: number;
  players: ReplayPlayer[];
  roomIds: RoomId[];
  reveal: RevealInfo | null;
  currentActor: PlayerId | null;
  queue: PlayerId[];
  actIndex: number;
  aliveCount: number;
  winner: PlayerId | null;
  logs: { seq: number; type: LogType; text: string; important?: boolean }[];
}

export interface ReplaySummary {
  id: string;
  ts: number;
  seed: number;
  winner: PlayerId | null;
  winnerName: string | null;
  rounds: number;
  frameCount: number;
  players: { id: PlayerId; name: string; charId: string; charName: string }[];
}

export interface ReplayRecord extends ReplaySummary {
  frames: ReplayFrame[];
}

export interface ActionRequest {
  type: string;
  targetId?: PlayerId;
  room?: RoomId;
  /** 是否声明为远程攻击（默认按房间关系自动判定） */
  ranged?: boolean;
  params?: Record<string, unknown>;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface GamePlayerConfig {
  id: PlayerId;
  name: string;
  charId: string;
  type: PlayerType;
}

export interface RuleConfig {
  /** 是否允许「躲藏」基础行动（原版规则要点中的行动选项2） */
  allowHide: boolean;
  /** 是否允许「找出来」基础行动 */
  allowSeek: boolean;
  /** 是否允许「跳过」 */
  allowSkip: boolean;
  /** 二次判定（行动排序）的出拳方式：serverRoll=服务端种子代掷 */
  secondJudgeMode: 'serverRoll';
  /** 默认初始血量（角色未指定时） */
  defaultMaxHp: number;
  /** 默认攻击力 */
  defaultAttack: number;
  /** 大屁孩暴走精神攻击伤害（资料未给数值，可配置） */
  berserkDamage: number;
  /** 技能内判定（五连鞭/不讲武德/太极等）出拳方式：serverRoll */
  skillJudgeMode: 'serverRoll';
}

export const DEFAULT_RULES: RuleConfig = {
  allowHide: true,
  allowSeek: true,
  allowSkip: true,
  secondJudgeMode: 'serverRoll',
  defaultMaxHp: 3,
  defaultAttack: 1,
  berserkDamage: 1,
  skillJudgeMode: 'serverRoll',
};

export function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}
