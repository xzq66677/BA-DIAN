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
  addDeferred(ev: Omit<import('./types.js').DeferredEvent, 'id'>): void;
  /** 生成新的事件组标识（AOE/多段演出分组用；同一次行动的全部伤害共享同一组） */
  nextGroupId(): string;
  /** 展开领域（全场唯一场地状态；他人已持有则覆盖） */
  openDomain(pid: PlayerId): import('./types.js').ActionResult;
  /** 当前领域持有者（无则 null） */
  domainHolder: PlayerId | null;
  queue: PlayerId[];
  actIndex: number;
  entrantOrder: PlayerId[];
}

export interface CharActionContext {
  game: GameLike;
  actor: PlayerId;
  params: ActionRequest;
}

export interface CharActionResult {
  ok: boolean;
  error?: string;
}

export interface CharActionDef {
  name: string;
  label: string;
  desc: string;
  /** 需要目标玩家（同房间/任意） */
  targetHint?: 'anyPlayer' | 'sameRoomPlayer' | 'otherRoomPlayer' | 'none';
  /** 需要房间选择（如大伊万投掷） */
  roomHint?: boolean;
  validate?(ctx: CharActionContext): string | null;
  execute(ctx: CharActionContext): void;
}

export interface DamageHookCtx {
  game: GameLike;
  req: DamageRequest;
  /** 钩子所属角色玩家 */
  owner: PlayerId;
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
  game: Pick<GameLike, 'roundNo' | 'players' | 'roomIds' | 'roomMembers' | 'isSameRoom'>;
  difficulty: 'normal' | 'hard';
  pid: PlayerId;
  me: PlayerState;
  st: CharRuntimeState;
  members: PlayerId[];
  alive: PlayerId[];
}

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
  /** 角色自定义攻击说明（客户端行动坞展示用；设置后覆盖默认文案） */
  attackDesc?: string;
  /** 是否具备远程攻击能力（默认角色不具备，仅近战） */
  rangedCapable?: boolean;
  /** 远程攻击是否需要先瞄准（opt-in；默认 false，即免瞄准） */
  rangedNeedsAim?: boolean;
  /** 领域生效后远程免瞄准（五条悟） */
  aimExemptWhenDomain?: boolean;
  /** 是否允许攻击自己（默认否） */
  allowSelfAttack?: boolean;
  /** 资料缺失标记（UI 展示） */
  dataMissing?: string[];
  /** 初始化角色运行状态 */
  init?(): Record<string, unknown>;
  /** 伤害钩子可修改 req、返回 'skip' 取消，或返回 deferTo 等待出拳后再结算。 */
  onBeforeDamage?(ctx: DamageHookCtx): DamageRequest | 'skip' | { deferTo: SkillJudgeOptions } | void;
  /** 伤害钩子阶段：transfer=转移（先执行），defense=防御（后执行，仅对自身） */
  damageHookStage?: 'transfer' | 'defense';
  /** 死亡钩子 */
  onDeath?(ctx: DeathHookCtx): void;
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
