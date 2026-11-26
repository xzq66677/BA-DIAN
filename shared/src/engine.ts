/**
 * 拔典 · 核心规则引擎
 * 独立于前端与网络层。所有游戏结果由本引擎统一判定。
 *
 * 阶段机：rps1（隐藏出拳→判定）→ rps2（二次判定：资格者亲自出拳→排序）→ act（行动队列依次行动）
 *        → roundEnd（回合末事件）→ 下一回合 / over
 */

import {
  type PlayerId, type RoomId, type Throw, type JudgeStep, type GamePhase,
  type PlayerState, type DamageRequest, type AppliedDamage, type LogEntry,
  type LogType, type DeferredEvent, type JudgeRoundRecord, type ActionRequest,
  type ActionResult, type GamePlayerConfig, type RuleConfig, type CharRuntimeState,
  type RevealInfo, type PlayerStats, emptyStats,
  type SkillJudgeOptions, type SkillJudgeView, type SkillJudgeRoundRecord,
  type ActiveStatusEffect, type ExtraActionView, type PublicStatusEffect,
  type BattleFxKind, type HealEventData, type EliminateEventData, type ReviveEventData,
  type ActionEventData,
  DEFAULT_RULES, fmtNum,
} from './types.js';
import { PROTOCOL_VERSION, type GameSnapshot } from './protocol.js';
import { RNG, randomThrow } from './rng.js';
import type { RuinsConditions } from './floating-ruins.js';
import { MAPS, type BattleMap, type MapId } from './maps.js';
import { BASE_ACTIONS } from './base-actions.js';
import { resolveDamage } from './damage.js';
import { mentalKill } from './mental.js';
import { serializeSnapshot } from './snapshot.js';
import { STATUS_REGISTRY, publicStatusEffects, statusDef } from './statuses.js';
import { resolveSubRound, resolveActionOrder, appendHistoryForRound, rollThrows, beats, type SubRoundOutcome } from './judge.js';
import type { CharDef, GameLike, CharActionContext, CharActionDef } from './chardef.js';

/** 引擎内部的「进行中判定」状态（带逐局进度） */
interface ActiveJudge extends SkillJudgeOptions {
  /** 当前第几局（1-based） */
  round: number;
  /** 己方已胜局数 */
  wins: number;
  /** 本局已提交的出拳（结算前不外泄） */
  pending: Partial<Record<PlayerId, Throw>>;
  /** 本局已提交的玩家 */
  submitted: PlayerId[];
  /** 最近一局结果（供快照展示） */
  last: SkillJudgeView['last'];
  /** 全部局次的判定记录 */
  records: SkillJudgeRoundRecord[];
}

export interface GameConfig {
  players: GamePlayerConfig[];
  seed?: number;
  rules?: Partial<RuleConfig>;
  /** 角色注册表（id → CharDef） */
  chars: Record<string, CharDef>;
  mapId?: MapId;
  floatingRuins?: boolean;
  /**
   * 日志序号起点（默认 0，即本局日志 seq 从 1 开始）。
   *
   * 同一房间连打多局时，服务端会把上一局的最大 seq 传进来，保证**整个房间内 seq 单调递增**。
   * 客户端与服务端都靠 `seq > lastSeq` 做增量与去重，若每局从 1 重新计数，
   * 第二局的日志会被全部当成「已收到」而丢弃（bug B-023）。
   */
  logSeqOffset?: number;
}

export class Game implements GameLike {
  rng: RNG;
  seed: number;
  rules: RuleConfig;
  chars: Record<string, CharDef>;
  players: Record<PlayerId, PlayerState> = {};
  playerIds: PlayerId[] = [];
  roomIds: RoomId[] = [];
  private readonly map: BattleMap;
  roundNo = 1;
  subRound = 1;
  phase: GamePhase = 'rps1';
  pendingThrows: Partial<Record<PlayerId, Throw>> = {};
  submittedIds: PlayerId[] = [];
  qualified: PlayerId[] = [];
  queue: PlayerId[] = [];
  actIndex = 0;
  entrantOrder: PlayerId[] = [];
  // ─── 二次判定（行动排序）交互状态（player 模式；每回合重置） ───
  /** 待排序组的队列：队首即当前子轮的参与组（递归排序用迭代方式实现） */
  orderQueue: PlayerId[][] = [];
  /** 当前子轮的参与组（空数组表示当前不在出拳等待中） */
  orderGroup: PlayerId[] = [];
  /** 已经确定的顺序前缀（完整排序由 finishOrdering 落成 action queue） */
  orderOrder: PlayerId[] = [];
  /** 当前子轮已提交的出拳（结算前不外泄，与 rps1 的 pendingThrows 同语义） */
  orderPending: Partial<Record<PlayerId, Throw>> = {};
  /** 当前子轮已提交的玩家（公开信息：用于「已出拳 x/y」展示） */
  orderSubmittedIds: PlayerId[] = [];
  /** 二次判定子轮计数（每回合重置，写入 JudgeRoundRecord.sub） */
  orderSub = 0;
  // ─── 技能内判定（player 模式：马保国太极 / 五连鞭 / 不讲武德） ───
  /** 待处理的技能判定队列（按触发顺序结算） */
  private judgeQueue: SkillJudgeOptions[] = [];
  /** 正在进行的判定（含逐局进度） */
  private activeJudge: ActiveJudge | null = null;
  /** 判定结束后从哪里继续（行动后 / 回合末） */
  private judgeResume: 'afterAction' | 'endRound' | null = null;
  /**
   * 判定中断恢复钩子：判定结算途中（判定历史入史 → 暴走 → 伤害 → 太极挂起 / 不讲武德排队）
   * 可能排入新的技能判定，此时把「当前流程的收尾」存成闭包，等判定全部结束后再执行。
   */
  private judgeResumeHook: (() => void) | null = null;
  /**
   * 回合前触发（大屁孩「暴走 / 自爆」）：判定结束后、行动阶段开始前统一结算。
   * triggerQueue 为已排好序的暴走权持有者；triggerActor 为当前要选择目标的人。
   */
  private triggerQueue: PlayerId[] = [];
  private triggerActor: PlayerId | null = null;
  private triggerResume: (() => void) | null = null;
  /** 当前二次判定的用途：行动排序 / 暴走权排序 */
  private orderPurpose: 'act' | 'berserk' = 'act';
  /** 判定计数（仅用于日志/标识） */
  private judgeSeq = 0;
  histories: Record<PlayerId, JudgeStep[]> = {};
  /** 已结算出拳的历史记录（跨回合，供硬核 AI 反制；只记录已揭示的拳种） */
  throwHistory: Record<PlayerId, Throw[]> = {};
  deferred: DeferredEvent[] = [];
  logs: LogEntry[] = [];
  private logSeq = 0;
  winner: PlayerId | null | undefined;
  judgeRecords: JudgeRoundRecord[] = [];
  /** 局内战绩（纯统计，不影响判定；快照下发给前端展示） */
  stats: Record<PlayerId, PlayerStats> = {};
  /**
   * 领域持有者（全场唯一）。领域是"场地状态"，同一时刻只能有一人生效：
   * 首次展开成为持有者；他人再展开则**覆盖**前者（原持有者领域失效）。
   * 领域不会因回合推进、判定重来或普通胜负被清除；仅当被覆盖、或持有者淘汰时失效。
   */
  domainHolder: PlayerId | null = null;
  /** 本回合重点事件摘要（回合末输出小结） */
  roundSummary: string[] = [];
  private deferredSeq = 0;
  private deathChainDepth = 0;
  private removingParticipants = false;
  /** 正在结算回合末延迟事件（endRound 循环期间置位）：期间淘汰不触发终局判定，结算完统一判；
   *  对角色钩子可见（GameLike）——大贱客阵亡后在窗口内继续吸收同批爆发伤害（作者确认 2026-11-21） */
  settlingDeferred = false;
  /** 事件组计数（AOE/多段/延迟伤害的演出分组标识） */
  private eventGroupSeq = 0;
  /**
   * 本回合的回合级判定是否已分出胜负。
   * 平局（同拳/三人循环）算一个完整回合但不分胜负 → false；**领域只让持有者在平局回合行动，
   * 不会把平局变成胜负**，因此这类回合同样是 false。
   * 分出胜负（含胜者全灭无人行动）→ true。回合翻页时重置。
   * 大伊万等延迟事件据此只在「分出胜负的回合」末引爆。
   */
  private roundResolved = false;
  /** 最近一次已结算的判定记录（跨回合保留）：平局回合翻页清空 judgeRecords 后，揭示台仍能显示上一轮出拳 */
  private lastReveal: JudgeRoundRecord | null = null;

  constructor(config: GameConfig) {
    this.seed = config.seed ?? (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    this.rng = new RNG(this.seed);
    const mapId = config.mapId ?? (config.floatingRuins ? 'floatingRuins' : 'classic');
    this.map = MAPS[mapId](this.seed, config.players.length);
    this.roomIds = [...this.map.layout.rooms];
    // 日志序号可续接上一局（同房间多局时保证单调递增，见 GameConfig.logSeqOffset）
    this.logSeq = config.logSeqOffset ?? 0;
    this.rules = { ...DEFAULT_RULES, ...(config.rules || {}) };
    this.chars = config.chars;
    config.players.forEach((pc, i) => {
      const cd = this.chars[pc.charId] || this.chars['default'];
      const maxHp = cd.hp ?? this.rules.defaultMaxHp;
      const room: RoomId = this.map.layout.spawn[i];
      this.players[pc.id] = {
        id: pc.id,
        name: pc.name,
        charId: pc.charId,
        hp: maxHp,
        maxHp,
        room,
        originRoom: room,
        alive: true,
        type: pc.type,
        hidden: false,
        invisible: false,
        effects: [],
        char: { ...(cd.init ? cd.init() : {}), livesLeft: cd.lives ?? 1 },
      };
      this.playerIds.push(pc.id);
      this.histories[pc.id] = [];
      this.stats[pc.id] = emptyStats();
      this.throwHistory[pc.id] = [];
    });
    this.entrantOrder = this.aliveIds();
    for (const pid of this.playerIds) this.stats[pid].roundsAlive = 1;
    this.log('phase', `游戏开始：${this.playerIds.length} 名玩家，随机种子 ${this.seed}`, undefined, true);
    for (const pid of this.playerIds) {
      const p = this.players[pid];
      this.log('info', `${p.name}（${this.charName(pid)}）初始位置 ${p.originRoom}，血量 ${fmtNum(p.maxHp)}`);
    }
    this.log('phase', `—— 第 ${this.roundNo} 回合 · 隐藏出拳 ——`, undefined, true);
  }

  // ─── 基础查询 ────────────────────────────────────────────────

  charDef(pid: PlayerId): CharDef {
    const p = this.players[pid];
    return this.chars[p.charId] || this.chars['default'];
  }

  charName(pid: PlayerId): string {
    return this.charDef(pid).name;
  }

  getPlayer(pid: PlayerId): PlayerState {
    return this.players[pid];
  }

  charState(pid: PlayerId): CharRuntimeState {
    return this.players[pid].char;
  }

  aliveIds(): PlayerId[] {
    return this.playerIds.filter((pid) => this.players[pid].alive);
  }

  roomMembers(room: RoomId): PlayerId[] {
    return this.aliveIds().filter((pid) => this.players[pid].room === room);
  }

  isSameRoom(a: PlayerId, b: PlayerId): boolean {
    return this.players[a].room === this.players[b].room;
  }

  isOver(): boolean {
    return this.phase === 'over';
  }

  log(type: LogType, text: string, data?: Record<string, unknown>, important = false): void {
    this.logs.push({
      v: PROTOCOL_VERSION,
      seq: ++this.logSeq,
      round: this.roundNo,
      sub: this.subRound,
      phase: this.phase,
      type,
      text,
      important,
      data,
    });
  }

  /**
   * 展开领域（角色「领域展开」技能统一入口）。
   *
   * 领域是全场唯一的场地状态：同一时刻只允许一名持有者。
   * - 无人持有 → 成为持有者；
   * - 他人持有 → **覆盖**旧领域（旧持有者 domain 置 false，日志记录覆盖）；
   * - 自己已持有 → 幂等（技能 validate 会先拦截重复展开）。
   * - **被覆盖后可以再次展开**：原持有者 domain 已置 false，再展开即覆盖当前持有者（用户确认 2026-11-24）。
   *
   * 领域一旦生成即持续保留，不因回合推进 / 判定重来 / 普通胜负被清除。
   */
  openDomain(pid: PlayerId): ActionResult {
    const p = this.players[pid];
    if (!p || !p.alive) return { ok: false, error: '玩家不存在或已淘汰' };
    const cd = this.charDef(pid);
    if (!cd.domainActsOnTie) return { ok: false, error: '该角色没有领域' };
    const prev = this.domainHolder;
    if (prev === pid && p.char.domain === true) return { ok: true }; // 幂等，不重复写日志
    if (prev && prev !== pid) {
      const pp = this.players[prev];
      if (pp) {
        const wasAlive = pp.alive;
        pp.char.domain = false;
        if (wasAlive) {
          this.log('trigger', `🌀 领域覆盖：${p.name} 的领域覆盖了 ${pp.name} 的领域（原领域失效）`, { pid, prev }, true);
        }
      }
    }
    p.char.domain = true;
    this.domainHolder = pid;
    return { ok: true };
  }

  /**
   * 领域平局行动：返回本子轮可行动的领域持有者（无则 null）。
   *
   * 语义（用户确认 2026-11-24）：领域**不改变平局结果**，只是让持有者获得
   * 「平局回合的行动资格」——判定仍是平局（大伊万顺延、大屁孩记平都不受影响）。
   *
   * 判定顺序：
   *  1. 权威来源是 domainHolder（全场唯一，由 openDomain 维护覆盖关系）；
   *  2. 若持有者已淘汰或 domain 被清，则领域自然失效并清理；
   *  3. 兼容直接写入 char.domain 的场景（测试/工具）：归一为唯一持有者，
   *     多人同时为 true 时保留座次靠前者，避免出现"永久对冲"。
   */
  drawActorHolder(candidates: PlayerId[]): PlayerId | null {
    const holder = this.domainHolder;
    if (holder) {
      const hp = this.players[holder];
      const stillHasDomain = !!hp && this.charState(holder).domain === true;
      if (!hp || !hp.alive || !stillHasDomain) {
        // 持有者淘汰 / 状态被外部清除 → 领域失效
        if (hp) hp.char.domain = false;
        this.domainHolder = null;
        this.log('trigger', '🌀 领域消失：持有者已淘汰或领域状态被清除', undefined, true);
      } else if (this.charDef(holder).domainActsOnTie && candidates.includes(holder)) {
        return holder;
      } else {
        // 持有者不在本子轮候选（理论上不会发生，防御性处理）
        return null;
      }
    }

    // 兼容路径：从未调用 openDomain 就直接置位 char.domain
    const manual = candidates.filter((pid) =>
      this.players[pid]?.alive && this.charDef(pid).domainActsOnTie && this.charState(pid).domain === true);
    if (manual.length === 0) return null;
    const keep = manual[0];
    for (const pid of manual) {
      if (pid !== keep && this.players[pid]) this.players[pid].char.domain = false;
    }
    this.domainHolder = keep;
    if (manual.length > 1) {
      this.log('trigger', `🌀 领域归一：检测到 ${manual.length} 个领域同时生效（非正常路径），保留座次靠前的 ${this.players[keep].name}`, undefined, true);
    }
    return keep;
  }

  // ─── 判定历史（大屁孩等角色使用） ─────────────────────────────

  judgeHistory(pid: PlayerId): JudgeStep[] {
    return this.histories[pid];
  }

  /** JudgeHistorySink 适配（供判定算法回调） */
  append(pid: PlayerId, step: JudgeStep, stage: 'rps1' | 'rps2', sub: number): void {
    this.appendJudgeHistory(pid, step, stage, sub);
  }

  /** 回复指定血量（上限截断）。角色修改回复效果时可调用 */
  heal(pid: PlayerId, amount: number): void {
    const p = this.players[pid];
    if (!p || !p.alive) return;
    const before = p.hp;
    p.hp = Math.min(p.maxHp, Math.round((p.hp + amount) * 10000) / 10000);
    const data: HealEventData = { target: pid, amount, hpBefore: before, hpAfter: p.hp };
    this.log('heal', `${p.name} 回复 ${fmtNum(amount)}：${fmtNum(before)} → ${fmtNum(p.hp)}`, { ...data });
  }

  /**
   * 生成一个新的事件组标识（AOE / 多段 / 延迟伤害演出分组用）。
   * 同一次行动产生的全部伤害应共享同一 groupId。
   */
  nextGroupId(): string {
    return `GRP-${this.roundNo}-${++this.eventGroupSeq}`;
  }

  // ─── 状态效果（持续效果统一生命周期） ────────────────────────

  /** 施加状态；同 kind 重复施加时刷新生命周期数据（例如重新点燃会重置「点燃回合」） */
  addStatus(
    pid: PlayerId,
    effect: Omit<ActiveStatusEffect, 'appliedRound'> & { appliedRound?: number },
  ): ActiveStatusEffect {
    const p = this.players[pid];
    const next: ActiveStatusEffect = { ...effect, appliedRound: effect.appliedRound ?? this.roundNo };
    if (!p) return next;
    p.effects = p.effects ?? [];
    const existing = p.effects.find((e) => e.kind === next.kind);
    if (existing) Object.assign(existing, next);
    else p.effects.push(next);
    this.log('state', `✨ ${p.name} 获得状态：${statusDef(next.kind)?.label ?? next.kind}`,
      { pid, effect: next.kind, severity: next.severity ?? null, remainingRounds: next.remainingRounds ?? null }, false);
    return existing ?? next;
  }

  /** 移除指定状态并执行清理 */
  removeStatus(pid: PlayerId, kind: string): boolean {
    const p = this.players[pid];
    if (!p || !p.effects) return false;
    const idx = p.effects.findIndex((e) => e.kind === kind);
    if (idx < 0) return false;
    const [removed] = p.effects.splice(idx, 1);
    statusDef(kind)?.cleanup?.({ game: this, owner: pid, effect: removed });
    return true;
  }

  getStatus(pid: PlayerId, kind: string): ActiveStatusEffect | undefined {
    return this.players[pid]?.effects?.find((e) => e.kind === kind);
  }

  hasStatus(pid: PlayerId, kind: string): boolean {
    return !!this.getStatus(pid, kind);
  }

  /**
   * 回合末结算所有持续状态（含平局回合，由 endRound 统一调用）。
   * 到期状态（remainingRounds 递减到 0）自动移除。
   */
  tickStatuses(): void {
    for (const pid of [...this.aliveIds()]) {
      const p = this.players[pid];
      if (!p?.alive) continue;
      for (const effect of [...(p.effects ?? [])]) {
        if (!this.players[pid]?.alive) break;
        STATUS_REGISTRY[effect.kind]?.tick?.({ game: this, owner: pid, effect });
        if (typeof effect.remainingRounds === 'number') {
          effect.remainingRounds -= 1;
          if (effect.remainingRounds <= 0) this.removeStatus(pid, effect.kind);
        }
      }
    }
  }

  /** 状态提供的附加行动（拥有者视角） */
  private statusActions(pid: PlayerId): CharActionDef[] {
    const out: CharActionDef[] = [];
    for (const effect of this.players[pid]?.effects ?? []) {
      const def = STATUS_REGISTRY[effect.kind];
      if (def?.actions) out.push(...def.actions({ game: this, owner: pid, effect }));
    }
    return out;
  }

  /**
   * 玩家可用的全部附加行动：状态提供的行动 + 其他角色为在场者提供的环境行动。
   * 引擎与客户端共用同一份列表（快照下发 `extraActions`），避免 UI 写死角色名。
   */
  extraActionsFor(pid: PlayerId): CharActionDef[] {
    const out = this.statusActions(pid);
    for (const owner of this.playerIds) {
      if (owner === pid || !this.players[owner]?.alive) continue;
      const cd = this.charDef(owner);
      if (cd.extraActionsForOthers) out.push(...cd.extraActionsForOthers({ game: this, owner, viewer: pid }));
    }
    return out;
  }

  /** 附加行动的快照视图（当前行动者） */
  extraActionViews(pid: PlayerId | null): ExtraActionView[] {
    if (!pid) return [];
    return this.extraActionsFor(pid).map((action) => ({
      key: action.name,
      label: action.label,
      desc: action.desc,
      typeLabel: action.typeLabel ?? '环境',
      ...(action.targetHint && action.targetHint !== 'none' ? { targetHint: action.targetHint } : {}),
      ...(action.roomHint ? { roomHint: true } : {}),
    }));
  }

  appendJudgeHistory(pid: PlayerId, step: JudgeStep, stage: 'rps1' | 'rps2', sub: number): void {
    this.histories[pid].push(step);
    // 已淘汰的玩家不再触发判定钩子：同一子轮内先阵亡者（如被另一名大屁孩暴走秒杀）
    // 仍会被追加历史，但不能再以「尸体」身份触发暴走/自爆等角色结算。
    if (!this.players[pid]?.alive) return;
    // 分发给该玩家角色的 onJudgeAppend 钩子（如大屁孩）
    const cd = this.charDef(pid);
    if (cd.onJudgeAppend) {
      cd.onJudgeAppend({ game: this, player: pid, step, stage, sub });
    }
  }

  // ─── 初次判定（隐藏提交） ─────────────────────────────────────

  /** 玩家提交出拳（隐藏）。全部提交后自动判定。 */
  submitThrow(pid: PlayerId, t: Throw): ActionResult {
    if (this.phase !== 'rps1') return { ok: false, error: '当前不是出拳阶段' };
    const p = this.players[pid];
    if (!p || !p.alive) return { ok: false, error: '玩家不存在或已淘汰' };
    if (this.submittedIds.includes(pid)) return { ok: false, error: '本子轮已提交出拳，不能重复提交' };
    if (!['rock', 'scissors', 'paper'].includes(t)) return { ok: false, error: '非法出拳' };
    this.pendingThrows[pid] = t;
    this.submittedIds.push(pid);
    const need = this.aliveIds();
    if (this.submittedIds.filter((x) => this.players[x].alive).length >= need.length) {
      this.resolveJudgeSubRound();
    }
    return { ok: true };
  }

  /** 超时强制：为未提交者代掷（服务端调用，不泄露给客户端） */
  forceFillThrows(): void {
    if (this.phase !== 'rps1') return;
    for (const pid of this.aliveIds()) {
      if (!this.submittedIds.includes(pid)) {
        this.submitThrow(pid, randomThrow(this.rng));
        this.log('info', `${this.players[pid].name} 超时，系统代掷出拳`);
      }
    }
  }

  /** 解析当前回合判定（全员提交完毕后调用） */
  private resolveJudgeSubRound(): void {
    if (this.phase !== 'rps1') return;
    const entrants = this.aliveIds();
    const drawActor = (cands: PlayerId[]) => this.drawActorHolder(cands);
    const outcome = resolveSubRound(this.pendingThrows, entrants, drawActor);
    const rec: JudgeRoundRecord = {
      stage: 'rps1', sub: this.subRound, round: this.roundNo,
      throws: { ...this.pendingThrows },
      outcome: outcome.status,
      winners: outcome.winners, losers: outcome.losers,
    };
    this.judgeRecords.push(rec);
    this.lastReveal = rec;
    this.recordThrowStats(entrants, outcome);
    // 已结算出拳进入历史（AI 反制与回放统计用，不含未结算数据）
    for (const pid of entrants) {
      const t = this.pendingThrows[pid];
      if (t) (this.throwHistory[pid] ??= []).push(t);
    }

    const throwsDesc = entrants.map((pid) => `${this.players[pid].name}:${this.throwName(this.pendingThrows[pid]!)}`).join('，');
    // 平局（同拳平局 / 三人循环）算一个完整回合：本回合无人获得行动资格，就地进入回合末结算并翻页，
    // 下一回合重新进行一轮完整的回合判定（不再有「同回合内重判子轮」的概念）。
    if (outcome.status === 'cycle') {
      this.log('judge', `回合判定（${throwsDesc}）：三人循环，平局——本回合无人获得行动资格，回合结束`);
      appendHistoryForRound(this, outcome, entrants, 'rps1', this.subRound);
      this.roundSummary.push('回合判定平局（三人循环）');
      this.roundResolved = false;
      // 判定历史入史可能触发大屁孩暴走/自爆 → 伤害 → 太极挂起 / 不讲武德排队：
      // 先把判定结算完，再结算回合前触发，最后收尾（否则平局会停在 rps1 卡死）。
      const next = () => this.continueAfterJudge(() => this.endRoundAfterJudge());
      if (this.pauseForPendingJudges(next)) return;
      next();
      return;
    }
    if (outcome.status === 'alltie') {
      this.log('judge', `回合判定（${throwsDesc}）：同拳平局——本回合无人获得行动资格，回合结束`);
      if (this.domainHolder) {
        this.log('judge', `领域说明：${this.players[this.domainHolder].name} 的领域本回合未生效（不在本回合候选或不具备平局行动）`);
      }
      appendHistoryForRound(this, outcome, entrants, 'rps1', this.subRound);
      this.roundSummary.push('回合判定平局（同拳平局）');
      this.roundResolved = false;
      const next2 = () => this.continueAfterJudge(() => this.endRoundAfterJudge());
      if (this.pauseForPendingJudges(next2)) return;
      next2();
      return;
    }
    // 领域平局行动：判定结果仍是平局（大伊万顺延、判定历史记平），
    // 只有领域持有者获得本回合的行动资格，行动完照常进入回合末。
    if (outcome.status === 'tieAct') {
      const holder = outcome.winners[0];
      const holderName = this.players[holder]?.name ?? holder;
      this.log('judge', `回合判定（${throwsDesc}）：平局——${holderName} 的领域生效，本回合仍是平局，但其获得平局回合的行动资格`);
      appendHistoryForRound(this, outcome, entrants, 'rps1', this.subRound);
      this.roundSummary.push(`回合判定平局（${holderName} 领域行动）`);
      this.roundResolved = false;
      const tail = () => this.continueAfterJudge(() => {
        if ((this.phase as GamePhase) === 'over') return;
        if (!this.players[holder]?.alive) {
          this.endRoundAfterJudge();
          return;
        }
        this.beginActionPhase([holder]);
      });
      if (this.pauseForPendingJudges(tail)) return;
      tail();
      return;
    }
    this.log('judge', `回合判定（${throwsDesc}）：分出胜负`);
    appendHistoryForRound(this, outcome, entrants, 'rps1', this.subRound);
    this.roundResolved = true;

    const tail = () => this.continueAfterJudge(() => this.finishResolvedJudge(outcome));
    if (this.pauseForPendingJudges(tail)) return;
    tail();
  }

  /** 分出胜负后的收尾：公告资格 → 终局判定 → 进入行动阶段 */
  private finishResolvedJudge(outcome: SubRoundOutcome): void {
    if ((this.phase as GamePhase) === 'over') return; // 判定过程中可能触发自爆等导致终局

    // 胜者获得行动资格（过滤判定过程中死亡者）
    const winnersAlive = outcome.winners.filter((pid) => this.players[pid].alive);
    const losersDesc = outcome.losers.filter((pid) => this.players[pid].alive)
      .map((pid) => this.players[pid].name).join('、');
    this.log('judge', `⭐ 初次判定结果：${winnersAlive.map((pid) => this.players[pid].name).join('、')} 获得行动资格${losersDesc ? `；${losersDesc} 无资格` : ''}`, undefined, true);
    this.roundSummary.push(`${winnersAlive.map((pid) => this.players[pid].name).join('、')} 获得行动资格`);

    if (this.checkWin()) return;

    if (winnersAlive.length === 0) {
      this.log('info', '无人获得行动资格，回合直接结束');
      this.endRound();
      return;
    }

    this.beginActionPhase(winnersAlive);
  }

  // ─── 回合前触发（大屁孩：暴走 / 自爆） ───────────────────────

  /** 判定已结算完毕：先结算回合前触发（暴走/自爆），再执行 next（行动阶段 / 回合收尾） */
  private continueAfterJudge(next: () => void): void {
    this.triggerResume = next;
    this.runRoundTriggers();
  }

  /**
   * 结算本回合标记的暴走/自爆。顺序：
   *  1. 自爆先结算（自身淘汰、不伤他人）；
   *  2. 存活的暴走持有者：1 人直接选目标；≥2 人先做二次判定决定暴走权顺序。
   * 触发结算期间可能排入技能判定（暴走被太极挂起 / 击杀马保国触发不讲武德），
   * 一律先暂停，等判定结束再继续。
   */
  private runRoundTriggers(): void {
    if (this.phase === 'over') { this.triggerResume = null; return; }
    const boom = this.aliveIds().filter((pid) => (this.charState(pid) as { pendingTrigger?: string }).pendingTrigger === 'selfdestruct');
    for (const pid of boom) {
      (this.charState(pid) as { pendingTrigger?: string | null }).pendingTrigger = null;
      this.log('trigger', `💥 ${this.players[pid].name} 自爆！`, { pid, trigger: 'selfdestruct' }, true);
      this.roundSummary.push(`${this.players[pid].name} 自爆`);
      this.eliminate(pid, 'selfdestruct');
      if ((this.phase as GamePhase) === 'over') { this.triggerResume = null; return; }
      if (this.judgeQueue.length > 0 && this.pauseForPendingJudges(() => this.runRoundTriggers())) return;
    }
    const berserk = this.aliveIds().filter((pid) => (this.charState(pid) as { pendingTrigger?: string }).pendingTrigger === 'berserk');
    if (berserk.length === 0) { this.finishTriggers(); return; }
    if (berserk.length === 1) { this.startTriggerSelection([berserk[0]]); return; }
    this.beginBerserkOrder(berserk);
  }

  /** 进入「暴走选择目标」阶段：按给定顺序逐个等待持有者指定目标 */
  private startTriggerSelection(order: PlayerId[]): void {
    this.triggerQueue = [...order];
    this.triggerActor = null;
    this.phase = 'trigger';
    this.nextTriggerActor();
  }

  private nextTriggerActor(): void {
    if (this.phase === 'over') { this.triggerResume = null; return; }
    this.triggerActor = null;
    while (this.triggerQueue.length > 0) {
      const pid = this.triggerQueue.shift()!;
      if (!this.players[pid]?.alive) continue;
      if ((this.charState(pid) as { pendingTrigger?: string }).pendingTrigger !== 'berserk') continue;
      this.triggerActor = pid;
      this.phase = 'trigger';
      this.log('phase', `🌀 ${this.players[pid].name} 获得暴走权：选择任意一名其他玩家释放精神攻击`, undefined, true);
      return;
    }
    this.finishTriggers();
  }

  private finishTriggers(): void {
    this.triggerActor = null;
    const next = this.triggerResume;
    this.triggerResume = null;
    if (this.phase === 'over') return;
    next?.();
  }

  /** 暴走权：持有者指定任意一名其他存活玩家（任意房间；无视躲藏/命数） */
  submitBerserk(pid: PlayerId, targetId: PlayerId): ActionResult {
    if (this.phase !== 'trigger' || this.triggerActor !== pid) {
      return { ok: false, error: '当前不是你的暴走选择时机' };
    }
    const tp = this.players[targetId];
    if (!tp || !tp.alive) return { ok: false, error: '目标不存在或已淘汰' };
    if (targetId === pid) return { ok: false, error: '不能对自己释放暴走' };
    (this.charState(pid) as { pendingTrigger?: string | null }).pendingTrigger = null;
    this.log('trigger', `🌀 ${this.players[pid].name} 暴走：对 ${tp.name} 发动精神攻击（秒杀·无视躲藏/命数）`, { pid, target: targetId, trigger: 'berserk' }, true);
    this.roundSummary.push(`${this.players[pid].name} 暴走 ${tp.name}`);
    this.triggerActor = null;
    mentalKill(this, { target: targetId, source: pid, tag: 'berserk' });
    if ((this.phase as GamePhase) === 'over') { this.triggerResume = null; return { ok: true }; }
    if (this.judgeQueue.length > 0 && this.pauseForPendingJudges(() => this.nextTriggerActor())) return { ok: true };
    this.nextTriggerActor();
    return { ok: true };
  }

  /** 多名大屁孩同时暴走：先做二次判定（与行动排序同一套规则：输者先）决定暴走权顺序 */
  private beginBerserkOrder(pids: PlayerId[]): void {
    const orderLabel = (order: PlayerId[]) =>
      `⭐ 暴走顺序（二次判定胜负决定，输者先暴走）：${order.map((pid) => this.players[pid].name).join(' → ')}`;
    // 服务端代掷模式（自动化用例 / 机制测试场）：直接按种子结算排序
    if (this.rules.secondJudgeMode === 'serverRoll') {
      const { order, rounds } = resolveActionOrder([...pids], (group) => rollThrows(group, this.rng));
      this.judgeRecords.push(...rounds);
      for (const r of rounds) r.round = this.roundNo;
      if (rounds.length > 0) this.lastReveal = rounds[rounds.length - 1];
      const aliveOrder = order.filter((pid) => this.players[pid].alive);
      this.log('order', orderLabel(aliveOrder), undefined, true);
      this.startTriggerSelection(aliveOrder);
      return;
    }
    this.orderPurpose = 'berserk';
    this.phase = 'rps2';
    this.orderQueue = [[...pids]];
    this.orderOrder = [];
    this.orderGroup = [];
    this.orderPending = {};
    this.orderSubmittedIds = [];
    this.orderSub = 0;
    this.log('phase', `—— 第 ${this.roundNo} 回合 · 暴走权排序判定（多名大屁孩同时暴走）——`, undefined, true);
    this.log('info', `暴走权：${pids.map((pid) => this.players[pid].name).join('、')} 进行二次判定，输者先获得暴走权`);
    this.startOrderSubRound();
  }

  /** 当前回合前触发视图（供服务端驱动 AI / 快照下发） */
  triggerView(): { kind: 'berserk'; actor: PlayerId; queue: PlayerId[] } | null {
    if (this.phase !== 'trigger' || !this.triggerActor) return null;
    return { kind: 'berserk', actor: this.triggerActor, queue: [...this.triggerQueue] };
  }

  /** 二次判定用途（行动排序 / 暴走权排序），供快照与 UI 标注 */
  orderPurposeKind(): 'act' | 'berserk' {
    return this.orderPurpose;
  }

  /**
   * 平局回合收尾：判定历史入史可能触发死亡钩子（如大屁孩三同自爆），
   * 若终局则止；否则进入回合末（延迟事件照常结算、回合翻页）。
   */
  private endRoundAfterJudge(): void {
    if (this.phase === 'over') return;
    // 判定历史入史可能触发死亡钩子（如大屁孩三同自爆）；终局判定在有已激活炸弹时延迟（见 checkWin），
    // 让回合走到回合末、炸弹结算完再定胜负。
    if (this.aliveIds().length <= 1 && !this.hasArmedIvan()) {
      this.checkWin();
      return;
    }
    this.endRound();
  }

  private throwName(t: Throw): string {
    return t === 'rock' ? '石头' : t === 'scissors' ? '剪刀' : '布';
  }

  /** 战绩：记录本子轮出拳胜负（循环/同拳平局记平，不偏向任何一方） */
  private recordThrowStats(entrants: PlayerId[], outcome: { status: string; winners: PlayerId[]; losers: PlayerId[] }): void {
    const win = new Set(outcome.winners);
    const lose = new Set(outcome.losers);
    for (const pid of entrants) {
      const st = this.stats[pid];
      if (!st) continue;
      if (outcome.status === 'cycle' || outcome.status === 'alltie' || outcome.status === 'tieAct') st.throwTie++;
      else if (win.has(pid)) st.throwWin++;
      else if (lose.has(pid)) st.throwLose++;
      else st.throwTie++;
    }
  }

  // ─── 二次判定与行动队列 ───────────────────────────────────────

  private beginActionPhase(winners: PlayerId[]): void {
    this.orderPurpose = 'act';
    // 蓄力回合（本回合末有三刀要落）的伍六七不能进行其他行动：即使赢下判定也不入队列
    const aliveWinners = winners.filter((pid) => {
      if (!this.players[pid].alive) return false;
      if (this.hasSlashDue(pid)) {
        this.log('info', `🗡️ ${this.players[pid].name} 本回合末有刀要落，蓄力中不能进行其他行动`);
        return false;
      }
      return true;
    });
    // 只有一名资格者时无需排序：直接入队（不额外出拳、不产生空排序记录）
    if (aliveWinners.length === 1) {
      const only = aliveWinners[0];
      this.qualified = [only];
      this.queue = [only];
      this.actIndex = 0;
      this.log('order', `⭐ 行动顺序：仅 ${this.players[only].name} 获得行动资格，直接行动`, undefined, true);
      this.phase = 'act';
      this.advanceQueue(true);
      return;
    }
    if (aliveWinners.length === 0) {
      this.log('info', '无人获得行动资格，回合直接结束');
      this.endRound();
      return;
    }
    if (this.rules.secondJudgeMode === 'serverRoll') {
      this.beginActionPhaseServerRoll(aliveWinners);
      return;
    }
    // ── player 模式：资格者**亲自出拳**，逐子轮递归排序 ──
    this.phase = 'rps2';
    this.qualified = aliveWinners;
    this.orderQueue = [aliveWinners];
    this.orderOrder = [];
    this.orderGroup = [];
    this.orderPending = {};
    this.orderSubmittedIds = [];
    this.orderSub = 0;
    this.log('phase', `—— 第 ${this.roundNo} 回合 · 行动排序判定（二次判定：资格者亲自出拳）——`, undefined, true);
    this.log('info', '二次判定只决定行动先后、不剥夺行动资格；输者整组先动、赢者整组靠后，同侧继续判定');
    this.startOrderSubRound();
  }

  /**
   * 服务端代掷排序（`secondJudgeMode: 'serverRoll'`，自动化用例 / 机制测试场使用）。
   *
   * 与交互版严格同源的两条约定：
   *  1. **领域不参与二次判定**（不传 tieWin：平局就是平局，重掷）；
   *  2. **不写判定历史**（不传 history sink：大屁孩等只受回合判定影响）。
   */
  private beginActionPhaseServerRoll(winners: PlayerId[]): void {
    const roll = (pids: PlayerId[]) => rollThrows(pids, this.rng);
    const { order, rounds } = resolveActionOrder(winners, roll);
    this.judgeRecords.push(...rounds);
    for (const r of rounds) r.round = this.roundNo;
    if (rounds.length > 0) this.lastReveal = rounds[rounds.length - 1];
    if (this.phase === 'over') return; // 排序判定过程中可能触发自爆等导致终局
    const aliveOrder = order.filter((pid) => this.players[pid].alive);
    this.qualified = aliveOrder;
    this.queue = aliveOrder;
    this.actIndex = 0;

    // 行动顺序由二次判定的胜负结果决定：输者先动、赢者靠后，同侧继续判定。
    // 每一层都记日志，保证顺序可追溯、可复现。
    const nameOf = (pid: PlayerId) => (this.players[pid] ? this.players[pid].name : pid);
    for (const r of rounds) {
      const w = (r.winners ?? []).filter((pid) => this.players[pid]?.alive).map(nameOf).join('、');
      const l = (r.losers ?? []).filter((pid) => this.players[pid]?.alive).map(nameOf).join('、');
      if (r.outcome === 'resolved') {
        this.log('judge', `行动排序（子轮${r.sub}）：${w} 胜出 → ${l} 优先行动`);
      } else if (r.outcome === 'tieAct' || r.outcome === 'tieWin') {
        // tieWin 仅用于兼容旧回放数据；新对局的二次判定不会产生领域结果（不传 drawActor）
        this.log('judge', `行动排序（子轮${r.sub}）：平局，${w} 领域生效 → 其余优先行动`);
      } else {
        this.log('judge', `行动排序（子轮${r.sub}）：${r.outcome === 'cycle' ? '三人循环' : '同拳平局'}，重新排序`);
      }
    }
    this.log('order', `⭐ 行动顺序（二次判定胜负决定，输者先动）：${aliveOrder.map(nameOf).join(' → ')}`, undefined, true);
    this.phase = 'act';
    this.advanceQueue(true);
  }

  // ─── 二次判定（行动排序）：玩家亲自出拳（player 模式） ────────

  /** 当前排序子轮等待出拳的玩家（非 rps2 阶段为空数组） */
  currentOrderGroup(): PlayerId[] {
    return this.phase === 'rps2' ? [...this.orderGroup] : [];
  }

  /**
   * 二次判定出拳（隐藏提交，与 rps1 同语义）。
   *
   * 只有「当前子轮参与组」内、尚存活且本子轮未提交的玩家能出拳；
   * 全组提交完毕后立即结算该子轮。领域不参与判定，也不写角色判定历史。
   */
  submitOrderThrow(pid: PlayerId, t: Throw): ActionResult {
    if (this.phase !== 'rps2') return { ok: false, error: '当前不是行动排序出拳阶段' };
    const p = this.players[pid];
    if (!p || !p.alive) return { ok: false, error: '玩家不存在或已淘汰' };
    if (!this.orderGroup.includes(pid)) return { ok: false, error: '不在本子轮的出拳名单内' };
    if (this.orderSubmittedIds.includes(pid)) return { ok: false, error: '本子轮已出拳，不能重复提交' };
    if (!['rock', 'scissors', 'paper'].includes(t)) return { ok: false, error: '非法出拳' };
    this.orderPending[pid] = t;
    this.orderSubmittedIds.push(pid);
    const waiting = this.orderGroup.filter((x) => this.players[x].alive && !this.orderSubmittedIds.includes(x));
    if (waiting.length === 0) this.resolveOrderSubRound();
    return { ok: true };
  }

  /** 超时兜底：为当前排序子轮未提交者代掷（服务端调用，不泄露给客户端） */
  forceFillOrderThrows(): void {
    if (this.phase !== 'rps2') return;
    for (const pid of [...this.orderGroup]) {
      if (this.phase !== 'rps2') return;
      if (!this.players[pid].alive) continue;
      if (this.orderSubmittedIds.includes(pid)) continue;
      this.submitOrderThrow(pid, randomThrow(this.rng));
      this.log('info', `${this.players[pid].name} 超时，系统代掷排序出拳`);
    }
  }

  /** 取下一个待出拳的组；组内只剩 0/1 人时直接确定顺序，全部排完则进入行动阶段 */
  private startOrderSubRound(): void {
    if (this.phase !== 'rps2') return;
    while (this.orderQueue.length > 0) {
      const group = this.orderQueue.shift()!;
      const alive = group.filter((pid) => this.players[pid].alive);
      if (alive.length <= 1) {
        this.orderOrder.push(...alive);
        continue;
      }
      this.orderGroup = alive;
      this.orderPending = {};
      this.orderSubmittedIds = [];
      const names = alive.map((pid) => this.players[pid].name).join('、');
      this.log('phase', `行动排序出拳（子轮 ${this.orderSub + 1}）：等待 ${names} 出拳`, undefined, true);
      return;
    }
    this.finishOrdering();
  }

  /**
   * 结算当前排序子轮。
   *
   * 领域（tieWin）**不参与**二次判定；判定历史也不写 rps2（大屁孩的攻击/自爆只看回合判定）。
   * 胜负决定顺序：输者整组排前、赢者整组排后；平局（同拳 / 三人循环）同组重掷。
   */
  private resolveOrderSubRound(): void {
    if (this.phase !== 'rps2') return;
    const group = this.orderGroup.filter((pid) => this.players[pid].alive);
    this.orderGroup = [];
    if (group.length <= 1) {
      this.orderOrder.push(...group);
      this.orderPending = {};
      this.orderSubmittedIds = [];
      this.startOrderSubRound();
      return;
    }
    const sub = ++this.orderSub;
    if (sub > 10000) throw new Error('二次判定子轮数超出安全上限');
    const outcome = resolveSubRound(this.orderPending, group);
    const rec: JudgeRoundRecord = {
      stage: 'rps2', sub, round: this.roundNo,
      throws: { ...this.orderPending },
      outcome: outcome.status,
      winners: outcome.winners, losers: outcome.losers,
    };
    this.judgeRecords.push(rec);
    this.lastReveal = rec;
    const throwsDesc = group
      .map((pid) => `${this.players[pid].name}:${this.throwName(this.orderPending[pid]!)}`)
      .join('，');
    const names = (ids: PlayerId[]) => ids.map((pid) => this.players[pid].name).join('、');
    if (outcome.status === 'resolved') {
      this.log('judge', `行动排序（子轮 ${sub}，${throwsDesc}）：${names(outcome.winners)} 胜出 → ${names(outcome.losers)} 优先行动`);
      // 递归：输者整组先排、赢者整组后排（队列 FIFO，先放赢者再放输者）
      this.orderQueue.unshift(outcome.winners);
      this.orderQueue.unshift(outcome.losers);
    } else {
      this.log('judge', `行动排序（子轮 ${sub}，${throwsDesc}）：${outcome.status === 'cycle' ? '三人循环' : '同拳平局'}，重新出拳`);
      this.orderQueue.unshift(group);
    }
    this.orderPending = {};
    this.orderSubmittedIds = [];
    this.startOrderSubRound();
  }

  /** 排序完成：落成行动队列并进入行动阶段 */
  private finishOrdering(): void {
    this.orderGroup = [];
    this.orderPending = {};
    this.orderSubmittedIds = [];
    const aliveOrder = this.orderOrder.filter((pid) => this.players[pid].alive);
    // 暴走权排序：按同一套规则（输者先）给出顺序后，进入「选择暴走目标」阶段
    if (this.orderPurpose === 'berserk') {
      this.orderPurpose = 'act';
      this.log('order', `⭐ 暴走顺序（二次判定胜负决定，输者先暴走）：${aliveOrder.map((pid) => this.players[pid].name).join(' → ')}`, undefined, true);
      this.startTriggerSelection(aliveOrder);
      return;
    }
    this.qualified = aliveOrder;
    this.queue = aliveOrder;
    this.actIndex = 0;
    this.log('order', `⭐ 行动顺序（二次判定胜负决定，输者先动）：${aliveOrder.map((pid) => this.players[pid].name).join(' → ')}`, undefined, true);
    this.phase = 'act';
    this.advanceQueue(true);
  }

  // ─── 技能内判定：双方亲自出拳（马保国太极 / 五连鞭 / 不讲武德） ───
  //
  // 设计：角色钩子只负责「发起判定」，引擎负责暂停对局收拳、逐局结算、结束后再回调结算效果。
  // 太极是反应型（在别人的行动里触发），所以它的伤害会被挂起，
  // 等判定结束再补结算——这样不需要把伤害管线改成异步。

  /** 发起一次技能内判定（player 模式）：引擎在安全点暂停对局收拳 */
  requestJudge(opts: SkillJudgeOptions): void {
    this.judgeQueue.push(opts);
  }

  /** 判定参与者（己方 + 对手，去重、只保留存在的玩家） */
  private judgeParticipants(j: ActiveJudge): PlayerId[] {
    const out: PlayerId[] = [];
    for (const pid of [j.owner, j.opponent]) {
      if (pid && this.players[pid] && !out.includes(pid)) out.push(pid);
    }
    return out;
  }

  private judgeWaiters(j: ActiveJudge): PlayerId[] {
    return this.judgeParticipants(j).filter((pid) => !j.submitted.includes(pid));
  }

  /** 有排队判定时进入 judge 阶段；返回是否已进入 */
  private enterJudgeIfPending(resume: 'afterAction' | 'endRound'): boolean {
    if (this.judgeQueue.length === 0) return false;
    this.judgeResume = resume;
    this.judgeResumeHook = null;
    return this.startNextJudge();
  }

  /**
   * 判定结算途中排入判定时暂停当前收尾流程：把 tail 存为恢复钩子并启动判定。
   * 返回 true 表示调用方应立即 return（对局暂停在 judge 阶段）。
   */
  private pauseForPendingJudges(tail: () => void): boolean {
    if (this.phase === 'over') return false;
    if (this.judgeQueue.length === 0) return false;
    this.judgeResume = null;
    this.judgeResumeHook = tail;
    return this.startNextJudge();
  }

  private startNextJudge(): boolean {
    if (this.activeJudge) return true;
    const opts = this.judgeQueue.shift();
    if (!opts) return false;
    const j: ActiveJudge = { ...opts, round: 1, wins: 0, pending: {}, submitted: [], last: null, records: [] };
    this.activeJudge = j;
    this.phase = 'judge';
    this.judgeSeq++;
    const names = this.judgeParticipants(j).map((pid) => this.players[pid].name).join('、');
    this.log('phase', `⚡ ${j.label}（第 1/${j.rounds} 局）：等待 ${names} 出拳`, undefined, true);
    return true;
  }

  /** 判定出拳（隐藏提交，与 rps1 同语义） */
  submitJudgeThrow(pid: PlayerId, t: Throw): ActionResult {
    if (this.phase !== 'judge' || !this.activeJudge) return { ok: false, error: '当前不是技能判定阶段' };
    const j = this.activeJudge;
    if (!this.judgeParticipants(j).includes(pid)) return { ok: false, error: '你不在本次判定的出拳名单内' };
    if (j.submitted.includes(pid)) return { ok: false, error: '本局已出拳，不能重复提交' };
    if (!['rock', 'scissors', 'paper'].includes(t)) return { ok: false, error: '非法出拳' };
    j.pending[pid] = t;
    j.submitted.push(pid);
    if (this.judgeWaiters(j).length === 0) this.resolveJudgeRound();
    return { ok: true };
  }

  /** 超时兜底：为该局未出拳者代掷（服务端调用，不泄露给客户端） */
  forceFillJudgeThrows(): void {
    if (this.phase !== 'judge' || !this.activeJudge) return;
    for (const pid of this.judgeWaiters(this.activeJudge)) {
      if (this.phase !== 'judge' || !this.activeJudge) return;
      const name = this.players[pid].name;
      this.submitJudgeThrow(pid, randomThrow(this.rng));
      if (!this.activeJudge) return; // 已结算完
      this.log('info', `${name} 超时，系统代掷判定出拳`);
    }
  }

  /** 结算当前一局；全部局数结束后回调角色并继续对局 */
  private resolveJudgeRound(): void {
    const j = this.activeJudge;
    if (!j) return;
    const ot = j.pending[j.owner];
    const pt = j.pending[j.opponent];
    const result: 'win' | 'lose' | 'tie' = !ot || !pt ? 'tie' : beats(ot, pt) ? 'win' : beats(pt, ot) ? 'lose' : 'tie';
    if (result === 'win') j.wins++;
    // 平局重赛：五连鞭「平局不计局数」、狂猎受击判定「平局再来一把」均不推进局数
    const replayTie = result === 'tie' && (j.kind === 'whip5' || j.rerollTie === true);
    j.last = { round: j.round, ownerThrow: ot as Throw, opponentThrow: pt as Throw, result };
    j.records.push({
      kind: j.kind, label: j.label, round: j.round, owner: j.owner, opponent: j.opponent,
      ownerThrow: ot as Throw, opponentThrow: pt as Throw, result,
    });
    const on = this.players[j.owner].name;
    const pn = this.players[j.opponent]?.name ?? '?';
    const verdict = result === 'win' ? `${on} 胜` : result === 'lose' ? `${pn} 胜` : replayTie ? '平局（不计局数，本局重判）' : '平局';
    this.log('judge', `⚡ ${j.label}（第 ${j.round}/${j.rounds} 局）：${on}[${this.throwName(ot as Throw)}] vs ${pn}[${this.throwName(pt as Throw)}] → ${verdict}`,
      { kind: j.kind, round: j.round, rounds: j.rounds, owner: j.owner, opponent: j.opponent, ownerThrow: ot, opponentThrow: pt, result }, true);
    j.pending = {};
    j.submitted = [];

    if (replayTie || j.round < j.rounds) {
      if (!replayTie) j.round++;
      const names = this.judgeParticipants(j).map((pid) => this.players[pid].name).join('、');
      this.log('phase', `⚡ ${j.label}（第 ${j.round}/${j.rounds} 局）：等待 ${names} 出拳`, undefined, true);
      return;
    }

    // 全部局数结束 → 回调角色结算（wins 为己方胜局数）
    const wins = j.wins;
    const rounds = j.rounds;
    this.activeJudge = null;
    try {
      j.resolve(wins, rounds);
    } catch (e) {
      this.log('error', `判定结算异常：${(e as Error)?.message ?? String(e)}`);
    }
    if (this.phase === 'over') return;
    // 结算可能又触发新的判定（例：五连鞭打在马保国身上 → 太极）
    if (this.startNextJudge()) return;
    this.resumeAfterJudges();
  }

  /** 判定全部结束后继续对局 */
  private resumeAfterJudges(): void {
    // 判定途中被打断的收尾流程优先恢复（如平局收尾 / 行动阶段开始）
    const hook = this.judgeResumeHook;
    if (hook) {
      this.judgeResumeHook = null;
      this.judgeResume = null;
      if (this.phase === 'over') return;
      hook();
      return;
    }
    const resume = this.judgeResume;
    this.judgeResume = null;
    if (this.phase === 'over') return;
    if (resume === 'endRound') {
      this.phase = 'roundEnd';
      this.finishEndRound();
      return;
    }
    // afterAction（默认）：本回合行动已消耗，推进队列
    this.phase = 'act';
    this.actIndex++;
    this.advanceQueue();
  }

  /** 当前判定视图（快照下发；非判定阶段为 null） */
  skillJudgeView(): SkillJudgeView | null {
    const j = this.activeJudge;
    if (!j || this.phase !== 'judge') return null;
    const parts = this.judgeParticipants(j);
    return {
      kind: j.kind, label: j.label, owner: j.owner, opponent: j.opponent,
      round: j.round, rounds: j.rounds, wins: j.wins,
      submittedIds: [...j.submitted],
      waitingIds: parts.filter((pid) => !j.submitted.includes(pid)),
      last: j.last ? { ...j.last } : null,
    };
  }

  /** 推进行动队列（跳过死亡者与无法行动者，如倒地） */
  private advanceQueue(initial = false): void {
    if (this.phase !== 'act') return;
    while (this.actIndex < this.queue.length) {
      const pid = this.queue[this.actIndex];
      const p = this.players[pid];
      if (!p.alive) {
        this.actIndex++;
        continue;
      }
      if (this.charDef(pid).skipsAction?.({ game: this, player: pid })) {
        this.log('phase', `💀 ${p.name} 当前无法行动，本回合行动跳过`, { pid }, true);
        this.actIndex++;
        continue;
      }
      break;
    }
    if (this.actIndex >= this.queue.length) {
      this.endRound();
      return;
    }
    const cur = this.queue[this.actIndex];
    this.log('phase', `等待 ${this.players[cur].name}（${this.charName(cur)}，位于 ${cur}）行动`);
    if (!initial && this.players[cur].type === 'ai') {
      // AI 行动由服务端驱动；此处仅真人等待
    }
  }

  currentActor(): PlayerId | null {
    if (this.phase !== 'act') return null;
    if (this.actIndex >= this.queue.length) return null;
    const pid = this.queue[this.actIndex];
    return this.players[pid].alive ? pid : null;
  }

  // ─── 行动提交 ────────────────────────────────────────────────

  submitAction(pid: PlayerId, req: ActionRequest): ActionResult {
    if (this.phase !== 'act') return { ok: false, error: '当前不是行动阶段' };
    const cur = this.currentActor();
    if (!cur) return { ok: false, error: '当前没有待行动玩家' };
    if (pid !== cur) return { ok: false, error: `当前轮到 ${this.players[cur].name} 行动` };
    const p = this.players[pid];
    if (!p.alive) return { ok: false, error: '已淘汰玩家不能行动' };
    // 倒地/被控制等无法行动状态：拒绝行动（正常流程中 advanceQueue 已跳过）
    if (this.charDef(pid).skipsAction?.({ game: this, player: pid })) {
      return { ok: false, error: `${p.name} 当前无法行动` };
    }

    const res = this.executeAction(pid, req);
    if (!res.ok) return res; // 非法行动：不修改状态、不消耗行动
    const st = this.stats[pid];
    if (st) {
      st.actions++;
      if (req.type === 'heal') st.heals++;
      if (req.type === 'move') st.moves++;
    }
    const fx: BattleFxKind = req.type === 'attack' ? 'attack'
      : req.type === 'move' ? 'move'
      : req.type === 'heal' ? 'heal'
      : req.type === 'milk' ? 'milk'
      : req.type === 'aim' ? 'aim'
      : req.type === 'hide' ? 'hide'
      : req.type === 'seek' ? 'seek'
      : req.type === 'skip' ? 'skip'
      : 'skill';
    const actionData: ActionEventData = {
      pid, fx, label: this.actionLabel(req),
      ...(req.targetId ? { targetId: req.targetId } : {}),
      ...(req.room ? { room: req.room } : {}),
    };
    this.log('action', `${p.name} 执行行动：${this.actionLabel(req)}`, { ...actionData }, true);
    this.roundSummary.push(`${p.name} ${this.actionLabel(req)}`);
    if ((this.phase as GamePhase) === 'over') return { ok: true };
    // 技能内判定（马保国五连鞭等）：先暂停收拳，等判定结算完再消耗行动/推进队列
    if (this.enterJudgeIfPending('afterAction')) return { ok: true };
    this.actIndex++;
    this.advanceQueue();
    return { ok: true };
  }

  /** 超时强制跳过（服务端调用） */
  forceSkipAction(pid: PlayerId): ActionResult {
    return this.submitAction(pid, { type: 'skip' });
  }

  private actionLabel(req: ActionRequest): string {
    const base = BASE_ACTIONS.get(req.type);
    if (base) return base.label(this, req);
    const mapAction = this.map.actions?.get(req.type);
    if (mapAction) return mapAction.label;
    const actor = this.currentActor() ?? this.playerIds[0];
    const cd = this.charDef(actor);
    return cd.actions?.find((action) => action.name === req.type)?.label
      ?? this.extraActionsFor(actor).find((action) => action.name === req.type)?.label
      ?? req.type;
  }

  private executeAction(pid: PlayerId, req: ActionRequest): ActionResult {
    // 角色禁用的基础行动（如骷髅无法主动「回复」回满血）
    if (this.charDef(pid).blockBaseActions?.includes(req.type)) {
      return { ok: false, error: `${this.players[pid].name} 无法使用该行动` };
    }
    const base = BASE_ACTIONS.get(req.type);
    if (base) return base.execute(this, pid, req, this.map);
    const mapAction = this.map.actions?.get(req.type);
    if (mapAction) {
      const { note, ...result } = mapAction.execute(this.players[pid], req);
      if (note) this.log('info', note, undefined, true);
      return result;
    }
    const act = this.charDef(pid).actions?.find((a) => a.name === req.type)
      ?? this.extraActionsFor(pid).find((a) => a.name === req.type);
    if (!act) return { ok: false, error: `未知行动：${req.type}` };
    const ctx: CharActionContext = { game: this, actor: pid, params: req };
    const error = act.validate?.(ctx);
    if (error) return { ok: false, error };
    act.execute(ctx);
    return { ok: true };
  }

  // ─── 伤害管线 ────────────────────────────────────────────────

  applyDamage(req: DamageRequest): AppliedDamage {
    return resolveDamage(this, this.stats, req);
  }

  // ─── 淘汰与胜负 ──────────────────────────────────────────────

  eliminate(pid: PlayerId, cause: string, killer?: PlayerId, opts?: { ignoreLives?: boolean }): void {
    const p = this.players[pid];
    if (!p || !p.alive) return;

    // 命数机制（如五条悟2条命）：致死时消耗一条命并满血复活；被房主踢出/主动退出不触发。
    // 秒杀类精神攻击（ignoreLives，如大屁孩暴走）无视命数：直接淘汰，不消耗命数、不复活。
    const livesLeft = typeof p.char.livesLeft === 'number' ? (p.char.livesLeft as number) : 1;
    const ignoreLives = opts?.ignoreLives === true;
    if (!ignoreLives && livesLeft > 1 && cause !== 'kicked' && cause !== 'left') {
      p.char.livesLeft = livesLeft - 1;
      p.hp = p.maxHp;
      p.hidden = false;
      p.invisible = false;
      const reviveData: ReviveEventData = { pid, livesLeft: livesLeft - 1 };
      this.log('trigger', `💫 ${p.name} 消耗一条命（剩余 ${livesLeft - 1} 条），以 ${fmtNum(p.maxHp)} HP 复活！`, { ...reviveData }, true);
      return;
    }

    p.alive = false;
    p.hidden = false;
    p.invisible = false;
    p.hp = 0;
    // 死亡清理：状态效果随持有者退场全部移除（生命周期要求）
    if (p.effects && p.effects.length > 0) {
      for (const effect of [...p.effects]) statusDef(effect.kind)?.cleanup?.({ game: this, owner: pid, effect });
      p.effects = [];
    }
    // 领域随持有者退场而消失（游戏中唯一会"自然失效"的路径；不含被覆盖）
    if (this.domainHolder === pid) {
      this.domainHolder = null;
      p.char.domain = false;
      this.log('trigger', `🌀 ${p.name} 的领域随其退场消失`, { pid }, true);
    }
    if (killer && killer !== pid && this.stats[killer]) {
      this.stats[killer].kills++;
      // 击杀钩子（如狂猎击杀后攻击 ×1.5）
      const killerDef = this.charDef(killer);
      if (killerDef.onKill) killerDef.onKill({ game: this, killer, target: pid, cause });
    }
    const elimData: EliminateEventData = { pid, cause, ...(killer && killer !== pid ? { killer } : {}) };
    this.log('eliminate', `💀 ${p.name}（${this.charName(pid)}）被淘汰（原因：${cause}${killer ? `，击杀者 ${this.players[killer]?.name}` : ''}）`, { ...elimData }, true);
    this.roundSummary.push(`${p.name} 被淘汰（${cause}）`);
    this.qualified = this.qualified.filter((x) => x !== pid);
    // 注意：queue 不在此处过滤——已行动过的索引不应因淘汰而移位；
    // 推进队列时会跳过死亡玩家（advanceQueue）。

    // 死亡钩子（如马保国不讲武德）——链深度保护
    if (this.deathChainDepth < 5) {
      this.deathChainDepth++;
      const cd = this.charDef(pid);
      if (cd.onDeath) {
        cd.onDeath({ game: this, player: pid, killer, cause });
      }
      this.deathChainDepth--;
    } else {
      this.log('error', '死亡连锁超过安全深度，跳过后续死亡触发');
    }

    this.checkWin();
  }

  /** 将整台设备的退场作为一次外部输入，统一清理等待项后再判胜。 */
  removeParticipants(ids: PlayerId[], reason: 'left' | 'kicked' | 'removed', host?: PlayerId): void {
    if (this.isOver()) return;
    this.removingParticipants = true;
    try {
      for (const id of ids) {
        const player = this.players[id];
        if (!player) continue;
        if (player.alive) {
          if (reason === 'left') this.log('info', `🚪 ${player.name} 主动退出对局`, { pid: id }, true);
          if (reason === 'kicked') this.log('info', `⚖ ${player.name} 被房主踢出对局`, { pid: id }, true);
          this.eliminate(id, reason === 'left' ? 'left' : 'kicked', host);
        }
        delete this.pendingThrows[id];
        delete this.orderPending[id];
      }
    } finally {
      this.removingParticipants = false;
    }
    if (this.checkWin()) return;
    if (this.phase === 'rps1' && this.aliveIds().every((id) => this.pendingThrows[id])) {
      this.resolveJudgeSubRound();
    } else if (this.phase === 'rps2') {
      const group = this.orderGroup.filter((id) => this.players[id].alive);
      if (group.length <= 1 || group.every((id) => this.orderSubmittedIds.includes(id))) {
        this.resolveOrderSubRound();
      }
    } else if (this.phase === 'act' && !this.currentActor()) {
      this.advanceQueue();
    }
  }

  checkWin(): boolean {
    if (this.phase === 'over') return true;
    if (this.removingParticipants) return false;
    // 炸弹先结算、后判胜（Issue #6）：存在已激活（explodeRound<=roundNo）、待本回合末引爆的大伊万时，
    // 延迟终局判定——让本回合完整走完，回合末延迟事件结算后再做最终胜负判断（最后一人在房内可被同归于尽）。
    // settlingDeferred：延迟事件结算循环期间不定胜负——同一发爆炸连杀两人时，第一人淘汰后剩余人数
    // 可能为 1，若当场定胜负会错误产生「幸存者」（其随后也会被同一发炸死，应为平局）。
    // endRound 的延迟事件结算会把 due 伊万移除并在循环结束后复位 settlingDeferred，
    // 因此 endRound 末尾的最终 checkWin 到达此处时两项条件必为 false，最终判定正常执行。
    if (this.settlingDeferred) return false;
    // 只在本回合**已分出胜负**时为炸弹让路：平局回合的炸弹会顺延、本回合不会引爆，
    // 若此时仍让路，「只剩 1 人 + 待爆炸弹 + 连续平局」会让对局永远无法终局（AI 自动对局回归暴露）。
    if (this.hasArmedIvan() && this.roundResolved) return false;
    const alive = this.aliveIds();
    // 待判定的「不讲武德」可能带走最后一名幸存者（如击杀马保国者）：先让判定结算完再定胜负，
    // 否则会先判胜、判定被 phase==='over' 短路（守旧行为：双方同时死亡 → 平局）。
    if (alive.length === 1 && this.hasPendingBujiangwude(alive[0])) return false;
    if (alive.length === 1) {
      this.phase = 'over';
      this.winner = alive[0];
      if (this.stats[alive[0]]) this.stats[alive[0]].roundsAlive++;
      this.log('result', `🏆 游戏结束：${this.players[alive[0]].name}（${this.charName(alive[0])}）获得胜利！`, undefined, true);
      this.cancelDeferredOnGameOver();
      return true;
    }
    if (alive.length === 0) {
      this.phase = 'over';
      this.winner = null;
      this.log('result', '游戏结束：所有玩家同时淘汰，平局', undefined, true);
      this.cancelDeferredOnGameOver();
      return true;
    }
    return false;
  }

  /** 是否存在待结算的「不讲武德」判定（对手为 survivor） */
  private hasPendingBujiangwude(survivor: PlayerId): boolean {
    const hit = (j?: SkillJudgeOptions | null) => !!j && j.kind === 'bujiangwude' && j.opponent === survivor;
    return this.judgeQueue.some((j) => hit(j)) || hit(this.activeJudge);
  }

  private cancelDeferredOnGameOver(): void {
    if (this.deferred.length > 0) {
      this.log('info', `游戏结束时取消 ${this.deferred.length} 个未结算的延迟事件`);
      this.deferred = [];
    }
  }

  /** 是否存在已激活、待本回合末引爆的大伊万（用于把终局判定延迟到炸弹结算之后） */
  private hasArmedIvan(): boolean {
    return this.deferred.some((d) => d.kind === 'ivan' && d.explodeRound <= this.roundNo);
  }

  /** 本回合末是否有待落的三刀（伍六七蓄力回合不能进行其他行动） */
  private hasSlashDue(pid: PlayerId): boolean {
    return this.deferred.some((d) => d.kind === 'wuliuqi-slash' && d.source === pid && d.explodeRound <= this.roundNo);
  }

  /**
   * 伍六七三刀：对「刀落瞬间」目标房间内的存活玩家逐段 1 伤（不打自己）。
   * 同一批内被致死但消耗命数复活者（五条悟）不再吃剩余刀。
   */
  private resolveSlash(ev: DeferredEvent): void {
    const source = ev.source;
    const room = ev.room;
    const excluded = new Set<PlayerId>();
    if (source) excluded.add(source); // 不打自己
    const gid = this.nextGroupId();
    const names = this.roomMembers(room).filter((pid) => !excluded.has(pid)).map((pid) => this.players[pid].name);
    this.log('deferred', `🗡️ 伍六七三刀落于 ${room}（本批目标：${names.join('、') || '无'}）`, { room, source: source ?? null, groupId: gid }, true);
    for (let seg = 1; seg <= 3; seg++) {
      const targets = this.roomMembers(room).filter((pid) => !excluded.has(pid) && this.players[pid].alive);
      for (const pid of targets) {
        if ((this.phase as GamePhase) === 'over') return;
        const applied = this.applyDamage({
          target: pid, amount: 1, source,
          dtype: 'physical', aoe: true,
          segment: { index: seg, total: 3 }, tag: 'wuliuqi-slash', groupId: gid,
        });
        // 本段致死但人还活着 = 消耗命数复活（五条悟）：剩余刀跳过该玩家
        if (applied.lethal && this.players[pid]?.alive) excluded.add(pid);
      }
    }
  }

  // ─── 回合末（延迟事件结算） ───────────────────────────────────

  private endRound(): void {
    if (this.phase === 'over') return;
    this.phase = 'roundEnd';
    if (this.roundSummary.length > 0) {
      this.log('info', `📋 第 ${this.roundNo} 回合小结：${this.roundSummary.join('；')}`, undefined, true);
    } else {
      this.log('info', `📋 第 ${this.roundNo} 回合小结：无人获得行动资格，平稳度过`, undefined, true);
    }
    this.log('phase', `第 ${this.roundNo} 回合行动结束，进入回合末结算`);

    // 角色回合末钩子
    for (const pid of this.aliveIds()) {
      const cd = this.charDef(pid);
      if (cd.onRoundEnd) cd.onRoundEnd({ game: this });
    }
    if ((this.phase as GamePhase) === 'over') return;

    // 延迟事件：伍六七三刀 → 其他延迟伤害 → 大伊万爆炸（作者确认的结算顺序）。
    // settlingDeferred 期间淘汰不定胜负（同一发爆炸连杀两人时须统一判平局，见 checkWin）
    const priority = (kind: string) => (kind === 'wuliuqi-slash' ? 0 : kind === 'ivan' ? 2 : 1);
    const due = this.deferred
      .filter((d) => d.explodeRound <= this.roundNo)
      .sort((a, b) => priority(a.kind) - priority(b.kind));
    this.settlingDeferred = true;
    for (const ev of due) {
      // 大伊万只在「分出胜负」的回合末引爆：平局回合跳过（事件保留，顺延至下一个分出胜负回合）
      if (ev.kind === 'ivan' && !this.roundResolved) continue;
      this.deferred = this.deferred.filter((d) => d.id !== ev.id);
      // 伍六七三刀：对刀落瞬间房间内的存活玩家逐段 1 伤（平局回合同样落刀）
      if (ev.kind === 'wuliuqi-slash') {
        this.resolveSlash(ev);
        if ((this.phase as GamePhase) === 'over') break;
        continue;
      }
      if (ev.kind === 'damage' && ev.payload) {
        this.log('deferred', `延迟伤害结算：${String((ev.payload as { label?: string }).label || '')}`);
        this.applyDamage(ev.payload as DamageRequest & { label?: string });
      } else if (ev.kind === 'ivan') {
        const members = this.roomMembers(ev.room);
        // 结构化 data（V3 演出链）：爆炸房间 + 投掷来源，供落点/冲击波演出
        this.log('deferred', `💥 大伊万在 ${ev.room} 爆炸！爆炸时房间内成员：${members.length ? members.map((pid) => this.players[pid].name).join('、') : '（无存活玩家）'}`,
          { room: ev.room, source: ev.source ?? null }, true);
        const ivanGroup = this.nextGroupId();
        for (const pid of members) {
          this.applyDamage({
            target: pid,
            // 极高伤害数值替代专用秒杀机制（作者确认，Issue #6）：对当前血量体系等效即死，
            // 走普通扣血管线（HP 归零淘汰，战绩按实际损失血量计）
            amount: 999999,
            source: ev.source,
            dtype: 'special',
            aoe: true, // 房间级毁灭：躲藏/隐身不提供保护（卡片原文「毁灭此房所有生物」；同伍六七 AOE 语义）
            noReflect: true,
            tag: 'ivan',
            groupId: ivanGroup,
          });
        }
      }
    }
    this.settlingDeferred = false;

    // 持续状态结算（燃烧等）：所有回合都结算，包含平局回合与延迟事件之后
    this.tickStatuses();
    if ((this.phase as GamePhase) === 'over') return;

    // 回合末触发的技能判定（例：大伊万炸死马保国 → 不讲武德）：先暂停收拳，结算完再收尾
    if (this.enterJudgeIfPending('endRound')) return;
    this.finishEndRound();
  }

  /** 回合末收尾：判定队列清空后继续（胜负判定 → 翻页 → 新回合） */
  private finishEndRound(): void {
    if (this.phase === 'over') return;
    if (this.checkWin()) return;

    this.roundNo++;
    this.subRound = 1;
    this.roundResolved = false; // 新回合尚未判定，重置「本回合已分出胜负」标记
    for (const pid of this.aliveIds()) {
      if (this.stats[pid]) this.stats[pid].roundsAlive++;
    }
    this.pendingThrows = {};
    this.submittedIds = [];
    this.qualified = [];
    this.queue = [];
    this.actIndex = 0;
    // 二次判定（排序）交互状态：每回合重置
    this.orderQueue = [];
    this.orderGroup = [];
    this.orderOrder = [];
    this.orderPending = {};
    this.orderSubmittedIds = [];
    this.orderSub = 0;
    // 技能判定（太极/五连鞭/不讲武德）状态：新回合不应残留
    this.judgeQueue = [];
    this.activeJudge = null;
    this.judgeResume = null;
    this.judgeResumeHook = null;
    this.triggerQueue = [];
    this.triggerActor = null;
    this.triggerResume = null;
    this.orderPurpose = 'act';
    this.judgeRecords = [];
    this.entrantOrder = this.aliveIds();
    this.roundSummary = [];
    // 回合开始钩子（倒地复活、回合开始的角色结算等）——在出拳阶段之前
    for (const pid of this.aliveIds()) {
      this.charDef(pid).onRoundStart?.({ game: this, player: pid });
    }
    if ((this.phase as GamePhase) === 'over') return;
    // 注意：领域（char.domain / domainHolder）是场地状态，跨回合持续保留，
    // 这里**不清除**；只有被其他领域覆盖或持有者淘汰时才失效。
    this.phase = 'rps1';
    this.log('phase', `—— 第 ${this.roundNo} 回合 · 隐藏出拳 ——`, undefined, true);
    for (const note of this.map.advance?.(this.roundNo) ?? []) {
      this.log('info', note, undefined, true);
    }
  }

  addDeferred(ev: Omit<DeferredEvent, 'id'>): void {
    this.deferred.push({ ...ev, id: `DEF-${++this.deferredSeq}` });
  }

  // ─── 技能内判定（服务端种子代掷） ─────────────────────────────

  rollJudgeThrows(a: PlayerId, b: PlayerId): { a: Throw; b: Throw; result: 'win' | 'lose' | 'tie' } {
    const ta = randomThrow(this.rng);
    const tb = randomThrow(this.rng);
    let result: 'win' | 'lose' | 'tie' = 'tie';
    const beats = (x: Throw, y: Throw) =>
      (x === 'rock' && y === 'scissors') || (x === 'scissors' && y === 'paper') || (x === 'paper' && y === 'rock');
    if (ta === tb) result = 'tie';
    else if (beats(ta, tb)) result = 'win';
    else result = 'lose';
    return { a: ta, b: tb, result };
  }

  rollJudge(a: PlayerId, b: PlayerId, label: string): 'win' | 'lose' | 'tie' {
    const r = this.rollJudgeThrows(a, b);
    this.log('judge', `${label}：${this.players[a].name}[${this.throwName(r.a)}] vs ${this.players[b].name}[${this.throwName(r.b)}] → ${r.result === 'win' ? this.players[a].name + ' 胜' : r.result === 'lose' ? this.players[b].name + ' 胜' : '平局'}`);
    return r.result;
  }

  // ─── 快照（供客户端展示，隐藏未揭示出拳） ─────────────────────

  /**
   * 出拳揭示（对局公开信息）。
   * 只取**已经结算完成**的判定记录：提交阶段的 pendingThrows 永不外泄，
   * 因此全员都能看到彼此出了什么，同时不破坏隐藏出拳的公平性。
   * 优先返回本回合最近一次回合判定（行动阶段仍保留展示），其次本回合排序判定，
   * 最后跨回合回退到上一轮判定（平局回合翻页后，揭示台仍显示上一轮出拳）。
   */
  revealInfo(): RevealInfo | null {
    // rps2 阶段优先揭示「最近一次已结算的排序子轮」：玩家每出完一轮出拳就能看到彼此的手势；
    // 尚未结算任何排序子轮时回退到回合判定（仍展示获得资格的那次判定结果）。
    if (this.phase === 'rps2') {
      const rps2 = this.judgeRecords.filter((r) => r.stage === 'rps2');
      if (rps2.length > 0) return this.toRevealInfo(rps2[rps2.length - 1]);
    }
    const rps1 = this.judgeRecords.filter((r) => r.stage === 'rps1');
    const rec = rps1.length > 0 ? rps1[rps1.length - 1]
      : (this.judgeRecords.length > 0 ? this.judgeRecords[this.judgeRecords.length - 1] : this.lastReveal);
    return rec ? this.toRevealInfo(rec) : null;
  }

  private toRevealInfo(rec: JudgeRoundRecord): RevealInfo {
    return {
      round: rec.round ?? this.roundNo,
      stage: rec.stage,
      sub: rec.sub,
      throws: { ...rec.throws } as Record<PlayerId, Throw>,
      outcome: rec.outcome,
      winners: [...(rec.winners ?? [])],
      losers: [...(rec.losers ?? [])],
    };
  }

  /**
   * 本回合最近一次已结算的**排序子轮**。
   * 行动阶段仍需要它来解释「为什么是这个行动顺序」（排序通常一子轮就结束，
   * 若只依赖 revealInfo 的 rps1 优先策略，玩家几乎看不到排序判定的拳种与胜负）。
   */
  orderRevealInfo(): RevealInfo | null {
    const rps2 = this.judgeRecords.filter((r) => r.stage === 'rps2' && (r.round ?? this.roundNo) === this.roundNo);
    const rec = rps2.length > 0 ? rps2[rps2.length - 1]
      : (this.lastReveal && this.lastReveal.stage === 'rps2' ? this.lastReveal : null);
    return rec ? this.toRevealInfo(rec) : null;
  }

  ruinsConditions(): RuinsConditions | undefined {
    return this.map.snapshot?.().ruins;
  }

  isMoveBlocked(pid: PlayerId, room: RoomId): boolean {
    return !!this.map.movementError?.(this.players[pid].room, room);
  }

  snapshot(): GameSnapshot {
    return serializeSnapshot(this, this.map.snapshot?.());
  }
}
