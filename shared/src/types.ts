/**
 * 拔典 · 核心类型定义
 * 规则引擎完全独立于前端与网络层。
 */

import type { MatchTranscript } from './simulation-types.js';

export type Throw = 'rock' | 'scissors' | 'paper';

export type PlayerId = string;
export type RoomId = string;

/** 判定单步结果：赢 / 平 / 输 */
export type JudgeStep = 'win' | 'tie' | 'lose';

export type PlayerType = 'human' | 'ai' | 'local';

/**
 * 对局阶段：
 * - `rps1`：初回合判定（全员隐藏出拳）
 * - `rps2`：二次判定 / 行动排序（**资格者亲自出拳**，多子轮递归；领域不参与）
 * - `act`：行动阶段（行动队列依次行动）
 * - `judge`：技能内判定（马保国太极 / 五连鞭 / 不讲武德等）：**双方亲自出拳**，对局暂停等待
 * - `roundEnd`：回合末结算（延迟事件）
 * - `over`：终局
 */
export type GamePhase = 'rps1' | 'rps2' | 'trigger' | 'act' | 'judge' | 'roundEnd' | 'over';

export interface CharRuntimeState {
  [key: string]: unknown;
}

/**
/**
 * 行动封印（钥匙类来源）：被封印的行动无法执行。
 * 生命周期：施加 → 生效 → 到期/移除 → 死亡清理。当前规则为永久封印，
 * 移除路径为「持有人淘汰」与对局重置；新增限时封印时增加 `remainingRounds` 即可。
 */
export interface ActionLock {
  /** 被封禁的行动名（BASE_ACTIONS / 地图行动 / 角色 actions 的 name；`attack` 不可封印） */
  action: string;
  /** 展示用标签（封印瞬间记录，避免后续改名影响历史日志） */
  label: string;
  /** 施加者（可无） */
  source?: PlayerId;
  /** 施加回合（展示用） */
  round: number;
  /** 剩余回合数：undefined = 永久（当前规则） */
  remainingRounds?: number;
}

/**
 * 通用玩家状态（公开）：可以施加在任何角色身上。
 * 生命周期：施加 → 生效 → 到期/移除 → 死亡清理（见 shared/src/player-statuses.ts）。
 */
export interface PlayerStatus {
  /** 状态种类（如 `crippled`）；行为由注册的处理器决定，UI 由状态读取器白名单渲染 */
  kind: string;
  /** 展示文案（施加时记录） */
  label?: string;
  /** 施加者 */
  source?: PlayerId;
  /** 施加回合 */
  round: number;
  /** 剩余回合数：undefined = 永久 */
  remainingRounds?: number;
  /** 是否允许重复叠加（默认 false） */
  stackable?: boolean;
  /** 附加公开数据 */
  data?: Record<string, unknown>;
}

/**
 * 公开状态效果（下发客户端的最小投影）。
 * 只包含展示与规则解释所需的公开字段：`kind`、`severity`、`remainingRounds`、
 * `stacks` 和必要的公开来源；内部生命周期字段（如施加回合）只留在引擎侧。
 */
export interface PublicStatusEffect {
  kind: string;
  /** 严重度（例：燃烧每回合伤害 0.5） */
  severity?: number;
  /** 剩余回合数；null = 无限持续，直到主动移除 */
  remainingRounds?: number | null;
  stacks?: number;
  /** 公开来源（点燃者等） */
  source?: PlayerId;
}

/**
 * 引擎权威状态效果：在公开投影之外携带生命周期数据。
 * 新增负面状态必须走状态注册表（shared/src/statuses.ts），并实现
 * 施加 / 回合推进 / 到期或移除 / 死亡清理的完整生命周期。
 */
export interface ActiveStatusEffect extends PublicStatusEffect {
  /** 施加该状态的回合（用于「施加当回合不结算」等规则） */
  appliedRound: number;
  /** 状态私有数据（不下发快照） */
  data?: Record<string, unknown>;
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
  /** 权威状态效果（燃烧等持续效果）；快照只投影公开字段 */
  effects?: ActiveStatusEffect[];
  /** 角色私有运行状态（拔棍状态、领域、瞄准、辱骂层数、判定历史等） */
  char: CharRuntimeState;
  /** 行动封印（公开信息：谁被封了什么，场上所有人都能看到） */
  actionLocks?: ActionLock[];
  /** 通用状态（公开：废人弱、中毒、燃烧等后续状态走这里） */
  statuses?: PlayerStatus[];
}

/** 技能内判定（马保国系能力）的类别 */
export type SkillJudgeKind = 'taiji' | 'whip5' | 'bujiangwude' | 'wildhunt' | 'tower';

/** 一次技能内判定的请求（由角色钩子发起，引擎负责暂停对局收拳与逐局结算） */
export interface SkillJudgeOptions {
  kind: SkillJudgeKind;
  /** 判定发起者（「己方」：太极/五连鞭/不讲武德/狂猎受击判定） */
  owner: PlayerId;
  /** 对手（伤害来源 / 五连鞭目标 / 击杀者） */
  opponent: PlayerId;
  /** 需要判定的局数：太极 1 局；五连鞭、不讲武德 5 局 */
  rounds: number;
  /** 日志与界面标题，如「太极判定」「五连鞭第 3 鞭」 */
  label: string;
  /** 平局是否立即重赛（不消耗局数）：狂猎受击判定「再来一把」 */
  rerollTie?: boolean;
  /** 全部局数结算后的回调（wins = 己方获胜局数；lastResult = 最后一局结果） */
  resolve: (wins: number, rounds: number, lastResult?: 'win' | 'lose' | 'tie') => void;
}

/** 进行中的判定（快照下发，供客户端渲染出拳面板） */
export interface SkillJudgeView {
  kind: SkillJudgeKind;
  label: string;
  owner: PlayerId;
  opponent: PlayerId;
  /** 当前第几局（1-based） */
  round: number;
  rounds: number;
  /** 己方已胜局数 */
  wins: number;
  /** 本局已提交出拳的玩家（不含拳种） */
  submittedIds: PlayerId[];
  /** 本局还在等待出拳的玩家 */
  waitingIds: PlayerId[];
  /** 最近一局已揭示的结果（提交阶段之外展示） */
  last: { round: number; ownerThrow: Throw; opponentThrow: Throw; result: 'win' | 'lose' | 'tie' } | null;
}

/** 技能内判定的一局记录（日志/展示用） */
export interface SkillJudgeRoundRecord {
  kind: SkillJudgeKind;
  label: string;
  round: number;
  owner: PlayerId;
  opponent: PlayerId;
  ownerThrow: Throw;
  opponentThrow: Throw;
  result: 'win' | 'lose' | 'tie';
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
  /**
   * 无视命数：本次伤害致死不触发「消耗一条命满血复活」（五条悟式命数），直接淘汰。
   * 用于秒杀类精神攻击（如大屁孩暴走）。
   */
  ignoreLives?: boolean;
  /**
   * 秒杀：结算时按目标**当前血量**计算伤害（而不是发起时的 amount），
   * 因此判定挂起期间目标回血也无法抵消。用于精神攻击。
   */
  instakill?: boolean;
  /** 不触发「受伤判定反弹」类被动（大伊万爆炸、肉山坐） */
  noReflect?: boolean;
  /** 已是反弹伤害（终止反弹链） */
  reflected?: boolean;
  /** 已被转移（大贱客吸引） */
  transferred?: boolean;
  /** 已完成技能判定（太极）：补结算时不再重复触发判定 */
  judgeResolved?: boolean;
  /** 伤害标签（ivan/insult/whip/berserk/selfdestruct...） */
  tag?: string;
  /**
   * 是否为「攻击」造成的伤害（普攻 / 燃烧箭 / 被操控的攻击）。
   * 受击判定类被动（如狂猎的猜拳反击）只对攻击生效，不响应燃烧/爆炸/精神攻击等。
   */
  isAttack?: boolean;
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
  /** 结算被挂起（等待玩家出拳判定，如太极）：此刻尚未扣血，判定结束后再补结算 */
  deferred?: boolean;
}

export type LogType =
  | 'phase' | 'judge' | 'order' | 'action' | 'damage' | 'heal' | 'move'
  | 'eliminate' | 'trigger' | 'state' | 'deferred' | 'error' | 'result' | 'info';

export interface LogEntry {
  v?: number;
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
  /** Public context for synchronizing the declared attack pose with its resolved movement. */
  presentation?: Record<string, unknown>;
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
  /** 秒杀类伤害（按结算时目标当前血量结算） */
  instakill?: boolean;
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
  presentation?: { moves: PlayerRelocation[] };
}

export interface PlayerRelocation {
  pid: PlayerId;
  fromRoom: RoomId;
  toRoom: RoomId;
  tower?: 'enter' | 'exit';
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
  /** 服务端权威行动名；演出层据此解析角色注册的 fx，不修改规则枚举。 */
  actionName?: string;
  fx: BattleFxKind;
  label: string;
  targetId?: PlayerId;
  room?: RoomId;
  /** 已由玩法层确认可公开的角色演出数据。 */
  presentation?: Record<string, unknown>;
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
  /**
   * - `tieAct`：平局（同拳 / 三人循环）且领域持有者获得**平局回合的行动资格**；
   *   判定结果仍是平局，不改变胜负（`tieWin` 为旧数据保留值，新对局不再产生）。
   */
  outcome: 'cycle' | 'alltie' | 'resolved' | 'tieAct' | 'tieWin';
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

/**
 * AI 难度分级（四档）：
 *  - easy 休闲（随性）/ normal 普通（默认策略）/ hard 硬核（反制与收益最大化）；
 *  - expert 宗师：第四档，按角色注册表走「每个角色单独编写的专属策略」
 *    （见 shared/src/characters/ai-expert.ts），未注册的未知角色安全降级为硬核。
 */
export type AiDifficulty = 'easy' | 'normal' | 'hard' | 'expert';

export const AI_DIFFICULTY_LABEL: Record<AiDifficulty, string> = {
  easy: '休闲',
  normal: '普通',
  hard: '硬核',
  expert: '宗师',
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
  logs: { seq: number; type: LogType; text: string; important?: boolean; data?: Record<string, unknown> }[];
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
  v?: number;
  truncated?: boolean;
  /** Finished matches may contain private inputs that have since been resolved. */
  simulation?: MatchTranscript;
  frames: ReplayFrame[];
}

export interface ActionRequest {
  type: string;
  targetId?: PlayerId;
  /** 多目标行动（如飞天水螅的吸/吹）：一次行动可指定多名玩家 */
  targetIds?: PlayerId[];
  room?: RoomId;
  /** 是否声明为远程攻击（默认按房间关系自动判定） */
  ranged?: boolean;
  params?: Record<string, unknown>;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  /**
   * 行动附带的**公开**演出数据（角色插件用）：引擎把它原样写进 action 日志的
   * `presentation` 字段，角色注册的 fx 插件据此渲染，不需要改引擎或演出层。
   */
  presentation?: Record<string, unknown>;
}

/**
 * 由状态 / 其他角色提供的附加行动（快照下发当前行动者的可用列表）。
 * 客户端只负责展示与选择，合法性由服务端重新校验。
 */
export interface ExtraActionView {
  key: string;
  label: string;
  desc: string;
  typeLabel: string;
  targetHint?: 'anyPlayer' | 'sameRoomPlayer' | 'sameRoomOrTowerPlayer' | 'otherRoomPlayer';
  roomHint?: boolean;
  roomExcludeCurrent?: boolean;
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
  /**
   * 二次判定（行动排序）的出拳方式：
   * - `player`（默认，线上对局）：资格者**亲自出拳**，逐子轮递归提交，服务端只负责结算；
   * - `serverRoll`：服务端种子代掷（保留给自动化用例 / 机制测试场等无人交互场景）。
   */
  secondJudgeMode: 'player' | 'serverRoll';
  /** 默认初始血量（角色未指定时） */
  defaultMaxHp: number;
  /** 默认攻击力 */
  defaultAttack: number;
  /**
   * 技能内判定（马保国太极 / 闪电五连鞭 / 不讲武德等）的出拳方式：
   * - `player`（默认，线上对局）：**双方玩家亲自出拳**，对局暂停进入 `judge` 阶段，
   *   全部提交后逐局结算；AI 由服务端即刻代出，房间内 ≥2 名真人时按出拳超时代掷；
   * - `serverRoll`：服务端种子代掷（保留给自动化用例 / 机制测试场等无人交互场景）。
   */
  skillJudgeMode: 'player' | 'serverRoll';
}

export const DEFAULT_RULES: RuleConfig = {
  allowHide: true,
  allowSeek: true,
  allowSkip: true,
  secondJudgeMode: 'player',
  defaultMaxHp: 3,
  defaultAttack: 1,
  skillJudgeMode: 'player',
};

export function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}
