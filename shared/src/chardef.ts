/**
 * 拔典 · 角色定义接口
 * 角色配置与基础规则分离；角色通过钩子（修饰器）改变默认规则，
 * 禁止在引擎中堆砌 if/else 硬编码角色逻辑。
 */

import type { PlayerId, RoomId, ActionRequest, CharRuntimeState, DamageRequest, PlayerState, SkillJudgeOptions, Throw } from './types.js';

/** 前置声明引擎接口，避免循环导入（运行时由 engine.ts 实现） */
export interface GameLike {
  rng: { next(): number; int(n: number): number; pick<T>(arr: readonly T[]): T; shuffle<T>(arr: readonly T[]): T[] };
  roundNo: number;
  subRound: number;
  phase: import('./types.js').GamePhase;
  players: Record<PlayerId, import('./types.js').PlayerState>;
  playerIds: PlayerId[];
  roomIds: RoomId[];
  rules: import('./types.js').RuleConfig;
  logs: import('./types.js').LogEntry[];

  /** 回合末延迟事件结算进行中（endRound 循环窗口） */
  settlingDeferred?: boolean;

  log(type: import('./types.js').LogType, text: string, data?: Record<string, unknown>, important?: boolean): void;
  aliveIds(): PlayerId[];
  getPlayer(pid: PlayerId): import('./types.js').PlayerState;
  charState(pid: PlayerId): import('./types.js').CharRuntimeState;
  charDef(pid: PlayerId): CharDef;
  roomMembers(room: RoomId): PlayerId[];
  isSameRoom(a: PlayerId, b: PlayerId): boolean;
  /** 是否位于高塔内部（塔内外隔绝） */
  isInTower(pid: PlayerId): boolean;
  isOver(): boolean;
  applyDamage(req: DamageRequest): import('./types.js').AppliedDamage;
  eliminate(pid: PlayerId, cause: string, killer?: PlayerId, opts?: { ignoreLives?: boolean }): void;
  heal(pid: PlayerId, amount: number): void;
  checkWin(): boolean;
  appendJudgeHistory(pid: PlayerId, step: import('./types.js').JudgeStep, stage: 'rps1' | 'rps2', sub: number): void;
  judgeHistory(pid: PlayerId): import('./types.js').JudgeStep[];
  /** 服务端种子代掷判定（用于技能内判定），返回胜负 */
  rollJudge(a: PlayerId, b: PlayerId, label: string): 'win' | 'lose' | 'tie';
  /** 服务端种子代掷：a 与 b 各掷一拳比较 */
  rollJudgeThrows(a: PlayerId, b: PlayerId): { a: Throw; b: Throw; result: 'win' | 'lose' | 'tie' };
  /**
   * 发起一次「玩家亲自出拳」的技能内判定（player 模式）。
   * 引擎会暂停对局进入 `judge` 阶段，双方逐局提交、AI 即刻代出；
   * 全部局数结束后回调 `resolve(wins, rounds)`（wins 为己方获胜局数）。
   */
  requestJudge(opts: import('./types.js').SkillJudgeOptions): void;
  /** 施加状态效果（燃烧等）；同 kind 重复施加会刷新生命周期数据 */
  addStatus(pid: PlayerId, effect: Omit<import('./types.js').ActiveStatusEffect, 'appliedRound'> & { appliedRound?: number }): import('./types.js').ActiveStatusEffect;
  /** 移除指定状态；返回是否移除成功 */
  removeStatus(pid: PlayerId, kind: string): boolean;
  /** 读取玩家身上的指定状态 */
  getStatus(pid: PlayerId, kind: string): import('./types.js').ActiveStatusEffect | undefined;
  hasStatus(pid: PlayerId, kind: string): boolean;
  addDeferred(ev: Omit<import('./types.js').DeferredEvent, 'id'>): void;
  /** 生成新的事件组标识（AOE/多段演出分组用；同一次行动的全部伤害共享同一组） */
  nextGroupId(): string;
  /** 展开领域（全场唯一场地状态；他人已持有则覆盖） */
  openDomain(pid: PlayerId): import('./types.js').ActionResult;
  /** 当前领域持有者（无则 null） */
  domainHolder: PlayerId | null;
  /** 本回合重点事件摘要（角色钩子可追加，如倒地/复原） */
  roundSummary: string[];
  queue: PlayerId[];
  actIndex: number;
  entrantOrder: PlayerId[];
}

export interface CharActionContext {
  game: GameLike;
  actor: PlayerId;
  params: ActionRequest;
  /** Attach validated public presentation data to the existing committed action log. */
  present?(data: Record<string, unknown>): void;
}

export interface CharActionResult {
  ok: boolean;
  error?: string;
  presentation?: Record<string, unknown>;
}

export interface CharActionDef {
  name: string;
  label: string;
  desc: string;
  /** 行动分类标签（附加行动展示用，如「状态」「环境」） */
  typeLabel?: string;
  /** 需要目标玩家（同房间/任意） */
  targetHint?: 'anyPlayer' | 'sameRoomPlayer' | 'otherRoomPlayer' | 'none';
  /** 多目标行动：一次行动可使用 targetIds 指定多名玩家（如吸/吹） */
  multiTarget?: boolean;
  /** 需要房间选择（如大伊万投掷） */
  roomHint?: boolean;
  validate?(ctx: CharActionContext): string | null;
  /** 执行行动；返回 `{ presentation }` 时引擎把它写进 action 日志（公开演出数据） */
  execute(ctx: CharActionContext): void | { presentation?: Record<string, unknown> };
}

export interface DamageHookCtx {
  game: GameLike;
  req: DamageRequest;
  /** 钩子所属角色玩家 */
  owner: PlayerId;
}

export interface RoomDamageHookCtx {
  game: GameLike;
  /** 钩子所属角色玩家 */
  owner: PlayerId;
  room: RoomId;
  amount: number;
  source?: PlayerId;
  dtype: 'physical' | 'mental' | 'special';
  tag?: string;
}

/** 致命伤害拦截上下文：角色可在自己血量归零时决定「不死亡」（倒地/复活等） */
export interface LethalDamageCtx {
  game: GameLike;
  player: PlayerId;
  req: DamageRequest;
  cause: string;
}

export interface DeathHookCtx {
  game: GameLike;
  player: PlayerId;
  killer?: PlayerId;
  cause: string;
}

export interface AttackValidateCtx {
  game: GameLike;
  actor: PlayerId;
  target: PlayerId;
  ranged: boolean;
}

export interface JudgeAppendCtx {
  game: GameLike;
  player: PlayerId;
  step: import('./types.js').JudgeStep;
  stage: 'rps1' | 'rps2';
  sub: number;
}

export interface CharacterAiContext {
  game: Pick<GameLike, 'roundNo' | 'players' | 'roomIds' | 'roomMembers' | 'isSameRoom' | 'getStatus' | 'hasStatus'>;
  difficulty: 'normal' | 'hard';
  pid: PlayerId;
  me: PlayerState;
  st: CharRuntimeState;
  members: PlayerId[];
  alive: PlayerId[];
}

/** 行动前判定的参数（双方亲自出拳；平局按各角色规则处理） */
export interface PreActionJudgeSpec {
  kind: import('./types.js').SkillJudgeKind;
  owner: PlayerId;
  opponent: PlayerId;
  rounds: number;
  label: string;
  rerollTie?: boolean;
}

/**
 * 行动前压制钩子的返回值：
 * - 'block'：本次行动无效（仍消耗行动）
 * - 'selfAttack'：该玩家改为攻击自己（仍消耗行动）
 * - `{ judge, onResult }`：进入双方亲自出拳的判定（player 模式），判定后由 onResult 决定结果
 */
export type BeforeActionHookResult =
  | 'block'
  | 'selfAttack'
  | {
    judge: PreActionJudgeSpec;
    onResult?: (result: 'win' | 'lose' | 'tie') => 'normal' | 'block' | 'selfAttack';
  }
  | void;

export interface CharDef {
  /** 可选的角色优先行动。返回 undefined 时由服务器使用通用策略。 */
  aiStrategy?(ctx: CharacterAiContext): ActionRequest | undefined;
  id: string;
  name: string;
  desc: string;
  /** 初始血量（未给则用默认3） */
  hp?: number;
  /** 命数（默认1）。>1 时致死会消耗一条命并满血复活 */
  lives?: number;
  /** 攻击力（未给则用默认1） */
  attack?: number;
  /** 攻击类型 */
  attackType?: 'melee' | 'ranged' | 'both' | 'none';
  /** 攻击伤害类型（默认物理） */
  attackDtype?: 'physical' | 'mental' | 'special';
  /** 近战伤害（默认=attack） */
  meleeDamage?: number;
  /** 远程伤害（默认=attack） */
  rangedDamage?: number;
  /** 动态伤害覆盖（如老大爷领域强化近5远3）。返回 undefined 则用静态值 */
  dynamicDamage?(ctx: { game: GameLike; actor: PlayerId; ranged: boolean }): number | undefined;
  /** 该角色的攻击无视躲藏（如拔棍） */
  ignoreHide?: boolean;
  /** 攻击无视距离：可选定任意房间的目标（如大贱客辱骂，作者确认 2026-11-21） */
  attackAllRooms?: boolean;
  /** 攻击改为「指定房间」而非指定目标（如伍六七：移动到该房间，下一回合末三刀） */
  attackRoomHint?: boolean;
  /** 角色自定义攻击说明（客户端行动坞展示用；设置后覆盖默认文案） */
  attackDesc?: string;
  /** 是否具备远程攻击能力（默认角色不具备，仅近战） */
  rangedCapable?: boolean;
  /** 远程攻击是否需要先瞄准（opt-in；默认 false，即免瞄准） */
  rangedNeedsAim?: boolean;
  /** 远程攻击可以打**同房间**目标（默认远程只能异房间，近战只能同房间） */
  rangedSameRoom?: boolean;
  /** 禁止使用的基础行动（如骷髅无法主动「回复」回满血） */
  blockBaseActions?: string[];
  /** 领域生效后远程免瞄准（五条悟） */
  aimExemptWhenDomain?: boolean;
  /** 是否允许攻击自己（默认否） */
  allowSelfAttack?: boolean;
  /** 资料缺失标记（UI 展示） */
  dataMissing?: string[];
  /** 初始化角色运行状态 */
  init?(): Record<string, unknown>;
  /** 角色标签（供状态/其他角色的通用逻辑识别，如 'skeleton'） */
  traits?: string[];
  /** 普通攻击附带的状态效果（如点燃） */
  attackEffects?: import('./types.js').DamageEffect[];
  /** 致命伤害拦截：返回 'prevent' 阻止淘汰（角色自行处理倒地/复活），'die' 确认死亡 */
  onLethalDamage?(ctx: LethalDamageCtx): 'prevent' | 'die' | void;
  /** 终局存活判定（默认按 alive）；血量归零但仍有特殊形态的角色可排除 */
  countsAsAliveForWin?(ctx: { game: GameLike; player: PlayerId }): boolean;
  /** 回合开始钩子（新回合、出拳前；倒地复活等） */
  onRoundStart?(ctx: { game: GameLike; player: PlayerId }): void;
  /** 该角色当前是否跳过行动（倒地、被控制等） */
  skipsAction?(ctx: { game: GameLike; player: PlayerId }): boolean;
  /** 普通攻击命中后的回调（如打断对方取箭） */
  onAttackLanded?(ctx: { game: GameLike; actor: PlayerId; target: PlayerId }): void;
  /**
   * 为**其他玩家**提供的附加行动（角色在场/状态环境类行动）。
   * 例：骷髅弓箭手允许同房间敌人取箭；是否可用由返回的行动自行 validate。
   */
  extraActionsForOthers?(ctx: { game: GameLike; owner: PlayerId; viewer: PlayerId }): CharActionDef[];
  /** 伤害钩子可修改 req、返回 'skip' 取消，或返回 deferTo 等待出拳后再结算。 */
  onBeforeDamage?(ctx: DamageHookCtx): DamageRequest | 'skip' | { deferTo: SkillJudgeOptions } | void;
  /** 房间级伤害吸收：返回 true 表示本次房间效果由该角色环境结构承受。 */
  absorbRoomDamage?(ctx: RoomDamageHookCtx): boolean;
  /** 伤害钩子阶段：transfer=转移（先执行），defense=防御（后执行，仅对自身） */
  damageHookStage?: 'transfer' | 'defense';
  /** 死亡钩子 */
  onDeath?(ctx: DeathHookCtx): void;
  /** 击杀钩子：killer 为本角色时触发（击杀后攻击提升等） */
  onKill?(ctx: { game: GameLike; killer: PlayerId; target: PlayerId; cause: string }): void;
  /** 行动前压制钩子：可在其他玩家行动前判定/限制（返回判定则由引擎暂停收拳） */
  onBeforeAction?(ctx: { game: GameLike; owner: PlayerId; player: PlayerId }): BeforeActionHookResult;
  /** 行动合法性附加校验（角色自身状态限制，如亡魂只能使用吸/吹） */
  validateAction?(ctx: { game: GameLike; player: PlayerId; action: ActionRequest }): string | null;
  /** 回合末钩子（所有行动完成后） */
  onRoundEnd?(ctx: { game: GameLike }): void;
  /** 判定历史追加钩子（大屁孩） */
  onJudgeAppend?(ctx: JudgeAppendCtx): void;
  /** 攻击合法性附加校验（返回错误信息或 null） */
  validateAttack?(ctx: AttackValidateCtx): string | null;
  /** 完全接管攻击行动（伍六七AOE、大贱客辱骂）。返回结果；ok=false 时不消耗行动 */
  onAttackAction?(ctx: CharActionContext, targetId: PlayerId, ranged: boolean): import('./types.js').ActionResult;
  /** 附加行动（技能） */
  actions?: CharActionDef[];
  /** 领域标记：展开后「平局回合」获得行动资格（五条悟等）。只给行动权，不改变平局结果 */
  domainActsOnTie?: boolean;
}

export const BASE_ATTACK_TYPE: CharDef['attackType'] = 'both';
