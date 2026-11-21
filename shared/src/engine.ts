/**
 * 拔典 · 核心规则引擎
 * 独立于前端与网络层。所有游戏结果由本引擎统一判定。
 *
 * 阶段机：rps1（隐藏出拳→判定，可能多子轮）→ act（行动队列依次行动）→ roundEnd（回合末事件）→ 下一回合 / over
 */

import {
  type PlayerId, type RoomId, type Throw, type JudgeStep, type GamePhase,
  type PlayerState, type DamageRequest, type AppliedDamage, type LogEntry,
  type LogType, type DeferredEvent, type JudgeRoundRecord, type ActionRequest,
  type ActionResult, type GamePlayerConfig, type RuleConfig, type CharRuntimeState,
  type RevealInfo, type PlayerStats, emptyStats,
  type BattleFxKind, type AttackDeclEventData, type DamageEventData,
  type HealEventData, type MoveEventData, type EliminateEventData, type ReviveEventData,
  type ActionEventData,
  DEFAULT_RULES, fmtNum,
} from './types.js';
import { RNG, randomThrow } from './rng.js';
import { resolveSubRound, resolveActionOrder, appendHistoryForRound, rollThrows } from './judge.js';
import type { CharDef, GameLike, CharActionContext } from './chardef.js';

export interface GameConfig {
  players: GamePlayerConfig[];
  seed?: number;
  rules?: Partial<RuleConfig>;
  /** 角色注册表（id → CharDef） */
  chars: Record<string, CharDef>;
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
  roundNo = 1;
  subRound = 1;
  phase: GamePhase = 'rps1';
  pendingThrows: Partial<Record<PlayerId, Throw>> = {};
  submittedIds: PlayerId[] = [];
  qualified: PlayerId[] = [];
  queue: PlayerId[] = [];
  actIndex = 0;
  entrantOrder: PlayerId[] = [];
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
  /** 正在结算回合末延迟事件（endRound 循环期间置位）：期间淘汰不触发终局判定，结算完统一判 */
  private settlingDeferred = false;
  /** 事件组计数（AOE/多段/延迟伤害的演出分组标识） */
  private eventGroupSeq = 0;
  /**
   * 本回合的回合级判定是否已分出胜负。
   * 平局（同拳/三人循环）算一个完整回合但不分胜负 → false；
   * 分出胜负（含领域 tieWin、含胜者全灭无人行动）→ true。回合翻页时重置。
   * 大伊万等延迟事件据此只在「分出胜负的回合」末引爆。
   */
  private roundResolved = false;
  /** 最近一次已结算的判定记录（跨回合保留）：平局回合翻页清空 judgeRecords 后，揭示台仍能显示上一轮出拳 */
  private lastReveal: JudgeRoundRecord | null = null;

  constructor(config: GameConfig) {
    this.seed = config.seed ?? (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    this.rng = new RNG(this.seed);
    // 日志序号可续接上一局（同房间多局时保证单调递增，见 GameConfig.logSeqOffset）
    this.logSeq = config.logSeqOffset ?? 0;
    this.rules = { ...DEFAULT_RULES, ...(config.rules || {}) };
    this.chars = config.chars;
    config.players.forEach((pc, i) => {
      const cd = this.chars[pc.charId] || this.chars['default'];
      const maxHp = cd.hp ?? this.rules.defaultMaxHp;
      const room: RoomId = `R${i + 1}`;
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
        char: { ...(cd.init ? cd.init() : {}), livesLeft: cd.lives ?? 1 },
      };
      this.playerIds.push(pc.id);
      this.roomIds.push(room);
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
   *
   * 领域一旦生成即持续保留，不因回合推进 / 判定重来 / 普通胜负被清除。
   */
  openDomain(pid: PlayerId): ActionResult {
    const p = this.players[pid];
    if (!p || !p.alive) return { ok: false, error: '玩家不存在或已淘汰' };
    const cd = this.charDef(pid);
    if (!cd.domainTieWin) return { ok: false, error: '该角色没有领域' };
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
   * 领域平局算胜：返回本子轮生效的领域持有者（无则 null）。
   *
   * 判定顺序：
   *  1. 权威来源是 domainHolder（全场唯一，由 openDomain 维护覆盖关系）；
   *  2. 若持有者已淘汰或 domain 被清，则领域自然失效并清理；
   *  3. 兼容直接写入 char.domain 的场景（测试/工具）：归一为唯一持有者，
   *     多人同时为 true 时保留座次靠前者，避免出现"永久对冲"。
   */
  tieWinHolder(candidates: PlayerId[]): PlayerId | null {
    const holder = this.domainHolder;
    if (holder) {
      const hp = this.players[holder];
      const stillHasDomain = !!hp && this.charState(holder).domain === true;
      if (!hp || !hp.alive || !stillHasDomain) {
        // 持有者淘汰 / 状态被外部清除 → 领域失效
        if (hp) hp.char.domain = false;
        this.domainHolder = null;
        this.log('trigger', '🌀 领域消失：持有者已淘汰或领域状态被清除', undefined, true);
      } else if (this.charDef(holder).domainTieWin && candidates.includes(holder)) {
        return holder;
      } else {
        // 持有者不在本子轮候选（理论上不会发生，防御性处理）
        return null;
      }
    }

    // 兼容路径：从未调用 openDomain 就直接置位 char.domain
    const manual = candidates.filter((pid) =>
      this.players[pid]?.alive && this.charDef(pid).domainTieWin && this.charState(pid).domain === true);
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
    this.log('heal', `${p.name} 回复 ${fmtNum(amount)}：${fmtNum(before)} → ${fmtNum(p.hp)}`, data as unknown as Record<string, unknown>);
  }

  /**
   * 生成一个新的事件组标识（AOE / 多段 / 延迟伤害演出分组用）。
   * 同一次行动产生的全部伤害应共享同一 groupId。
   */
  nextGroupId(): string {
    return `GRP-${this.roundNo}-${++this.eventGroupSeq}`;
  }

  appendJudgeHistory(pid: PlayerId, step: JudgeStep, stage: 'rps1' | 'rps2', sub: number): void {
    this.histories[pid].push(step);
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
    const tieWin = (cands: PlayerId[]) => this.tieWinHolder(cands);
    const outcome = resolveSubRound(this.pendingThrows, entrants, tieWin);
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
      if (this.domainHolder) {
        this.log('judge', `领域说明：三人循环不属于「平局」，${this.players[this.domainHolder].name} 的领域本回合不触发`);
      }
      appendHistoryForRound(this, outcome, entrants, 'rps1', this.subRound);
      this.roundSummary.push('回合判定平局（三人循环）');
      this.roundResolved = false;
      this.endRoundAfterJudge();
      return;
    }
    if (outcome.status === 'alltie') {
      this.log('judge', `回合判定（${throwsDesc}）：同拳平局——本回合无人获得行动资格，回合结束`);
      if (this.domainHolder) {
        this.log('judge', `领域说明：${this.players[this.domainHolder].name} 的领域本回合未生效（不在本回合候选或不具备平局算胜）`);
      }
      appendHistoryForRound(this, outcome, entrants, 'rps1', this.subRound);
      this.roundSummary.push('回合判定平局（同拳平局）');
      this.roundResolved = false;
      this.endRoundAfterJudge();
      return;
    }
    if (outcome.status === 'tieWin') {
      this.log('judge', `回合判定（${throwsDesc}）：平局，但${this.players[outcome.winners[0]].name}领域生效判胜`);
      appendHistoryForRound(this, outcome, entrants, 'rps1', this.subRound);
    } else {
      this.log('judge', `回合判定（${throwsDesc}）：分出胜负`);
      appendHistoryForRound(this, outcome, entrants, 'rps1', this.subRound);
    }
    this.roundResolved = true;

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
      if (outcome.status === 'cycle' || outcome.status === 'alltie') st.throwTie++;
      else if (win.has(pid)) st.throwWin++;
      else if (lose.has(pid)) st.throwLose++;
      else st.throwTie++;
    }
  }

  // ─── 二次判定与行动队列 ───────────────────────────────────────

  private beginActionPhase(winners: PlayerId[]): void {
    // 只有一名资格者时无需排序：直接入队（不额外掷拳、不产生空排序记录）
    if (winners.length === 1) {
      const only = winners[0];
      this.qualified = [only];
      this.queue = [only];
      this.actIndex = 0;
      this.log('order', `⭐ 行动顺序：仅 ${this.players[only].name} 获得行动资格，直接行动`, undefined, true);
      this.phase = 'act';
      this.advanceQueue(true);
      return;
    }

    const roll = (pids: PlayerId[]) => rollThrows(pids, this.rng);
    const tieWin = (cands: PlayerId[]) => this.tieWinHolder(cands);
    const { order, rounds } = resolveActionOrder(winners, roll, tieWin, {
      append: (pid, step, stage, sub) => this.appendJudgeHistory(pid, step, stage, sub),
    });
    this.judgeRecords.push(...rounds);
    for (const r of rounds) r.round = this.roundNo;
    if (rounds.length > 0) this.lastReveal = rounds[rounds.length - 1];
    if (this.phase === 'over') return; // 排序判定过程中可能触发自爆等导致终局
    const aliveOrder = order.filter((pid) => this.players[pid].alive);
    this.qualified = winners.filter((pid) => this.players[pid].alive);
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
      } else if (r.outcome === 'tieWin') {
        this.log('judge', `行动排序（子轮${r.sub}）：平局，${w} 领域生效判胜 → 其余优先行动`);
      } else {
        this.log('judge', `行动排序（子轮${r.sub}）：${r.outcome === 'cycle' ? '三人循环' : '同拳平局'}，重新排序`);
      }
    }
    this.log('order', `⭐ 行动顺序（二次判定胜负决定，输者先动）：${aliveOrder.map(nameOf).join(' → ')}`, undefined, true);
    this.phase = 'act';
    this.advanceQueue(true);
  }

  /** 推进行动队列（跳过死亡者） */
  private advanceQueue(initial = false): void {
    if (this.phase !== 'act') return;
    while (this.actIndex < this.queue.length && !this.players[this.queue[this.actIndex]].alive) {
      this.actIndex++;
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
    this.log('action', `${p.name} 执行行动：${this.actionLabel(req)}`, actionData as unknown as Record<string, unknown>, true);
    this.roundSummary.push(`${p.name} ${this.actionLabel(req)}`);
    if ((this.phase as GamePhase) === 'over') return { ok: true };
    this.actIndex++;
    this.advanceQueue();
    return { ok: true };
  }

  /** 超时强制跳过（服务端调用） */
  forceSkipAction(pid: PlayerId): ActionResult {
    return this.submitAction(pid, { type: 'skip' });
  }

  private actionLabel(req: ActionRequest): string {
    switch (req.type) {
      case 'move': return `移动到 ${req.room}`;
      case 'attack': return `攻击 ${req.targetId ? this.players[req.targetId].name : '?'}`;
      case 'heal': return '回复';
      case 'hide': return '躲藏';
      case 'seek': return `找出来（${req.targetId ? this.players[req.targetId].name : '?'}）`;
      case 'aim': return `瞄准（${req.targetId ? this.players[req.targetId].name : '?'}）`;
      case 'milk': return '喝牛奶（嘲讽）';
      case 'skip': return '跳过';
      default: {
        const cd = this.charDef(this.currentActor() || this.playerIds[0]);
        const act = cd.actions?.find((a) => a.name === req.type);
        return act ? act.label : req.type;
      }
    }
  }

  private executeAction(pid: PlayerId, req: ActionRequest): ActionResult {
    const p = this.players[pid];
    const cd = this.charDef(pid);
    switch (req.type) {
      case 'move': return this.actMove(pid, req);
      case 'attack': return this.actAttack(pid, req);
      case 'heal': return this.actHeal(pid, req);
      case 'hide': return this.actHide(pid, req);
      case 'seek': return this.actSeek(pid, req);
      case 'aim': return this.actAim(pid, req);
      case 'milk': return this.actMilk(pid);
      case 'skip': {
        if (!this.rules.allowSkip) return { ok: false, error: '本局不允许跳过' };
        return { ok: true };
      }
      default: {
        const act = cd.actions?.find((a) => a.name === req.type);
        if (!act) return { ok: false, error: `未知行动：${req.type}` };
        const ctx: CharActionContext = { game: this, actor: pid, params: req };
        if (act.validate) {
          const err = act.validate(ctx);
          if (err) return { ok: false, error: err };
        }
        act.execute(ctx);
        return { ok: true };
      }
    }
  }

  private actMove(pid: PlayerId, req: ActionRequest): ActionResult {
    const p = this.players[pid];
    const room = req.room as RoomId;
    if (!room || !this.roomIds.includes(room)) return { ok: false, error: `非法目标房间：${room}` };
    const from = p.room;
    p.room = room;
    if (p.hidden) {
      p.hidden = false;
      this.log('state', `${p.name} 移动后现身（离开躲藏）`);
    }
    const moveData: MoveEventData = { pid, from, to: room };
    this.log('move', `${p.name} 从 ${from} 移动到 ${room}`, moveData as unknown as Record<string, unknown>, true);
    return { ok: true };
  }

  private actAttack(pid: PlayerId, req: ActionRequest): ActionResult {
    const cd = this.charDef(pid);
    const targetId = req.targetId;
    if (!targetId || !this.players[targetId]) return { ok: false, error: '目标不存在' };
    const tp = this.players[targetId];
    if (!tp.alive) return { ok: false, error: '目标已淘汰' };
    if (targetId === pid && !cd.allowSelfAttack) return { ok: false, error: '默认不允许攻击自己' };

    // 角色完全接管攻击（如伍六七AOE、大贱客辱骂）
    if (cd.onAttackAction) {
      return cd.onAttackAction({ game: this, actor: pid, params: req }, targetId, !!req.ranged);
    }

    const sameRoom = this.isSameRoom(pid, targetId);
    const ranged = req.ranged ?? !sameRoom;
    const at = cd.attackType || 'both';
    // 远程能力：默认角色仅近战；远程需要角色具备 rangedCapable（吹箫哥/五条悟/老大爷等）
    if (ranged && !cd.rangedCapable) return { ok: false, error: '该角色无法远程攻击' };
    if (!ranged && (at === 'ranged' || at === 'none')) return { ok: false, error: '该角色无法近战攻击' };

    // 瞄准要求
    if (ranged && cd.rangedNeedsAim && !(cd.aimExemptWhenDomain && this.charState(pid).domain === true)) {
      const aim = this.charState(pid).aim;
      if (aim !== targetId) return { ok: false, error: '需要先瞄准该目标（使用「瞄准」行动）' };
      this.charState(pid).aim = undefined;
    }

    if (cd.validateAttack) {
      const err = cd.validateAttack({ game: this, actor: pid, target: targetId, ranged });
      if (err) return { ok: false, error: err };
    }

    // 躲藏目标校验（指向性攻击无法锁定躲藏者）
    if ((tp.hidden || tp.invisible) && !cd.ignoreHide) {
      return { ok: false, error: '目标正在躲藏/隐身，无法锁定（AOE 或无视躲避的攻击除外）' };
    }

    const amount = cd.dynamicDamage?.({ game: this, actor: pid, ranged })
      ?? (ranged
        ? (cd.rangedDamage ?? cd.attack ?? this.rules.defaultAttack)
        : (cd.meleeDamage ?? cd.attack ?? this.rules.defaultAttack));
    const decl: AttackDeclEventData = { declared: true, source: pid, target: targetId, amount, ranged, room: tp.room };
    this.log('damage', `${this.players[pid].name} ${ranged ? '远程' : '近战'}攻击 ${tp.name}（伤害 ${fmtNum(amount)}）`, decl as unknown as Record<string, unknown>, true);
    this.applyDamage({
      target: targetId,
      amount,
      source: pid,
      dtype: cd.attackDtype || 'physical',
      ignoreHide: cd.ignoreHide,
    });
    return { ok: true };
  }

  private actHeal(pid: PlayerId, _req: ActionRequest): ActionResult {
    const p = this.players[pid];
    const before = p.hp;
    p.hp = p.maxHp;
    const data: HealEventData = {
      target: pid,
      amount: Math.round((p.hp - before) * 10000) / 10000,
      hpBefore: before, hpAfter: p.hp,
    };
    this.log('heal', `${p.name} 回复：${fmtNum(before)} → ${fmtNum(p.hp)}（满血）`, data as unknown as Record<string, unknown>, true);
    return { ok: true };
  }

  private actHide(pid: PlayerId, _req: ActionRequest): ActionResult {
    const p = this.players[pid];
    if (!this.rules.allowHide) return { ok: false, error: '本局不允许躲藏' };
    if (p.hidden) return { ok: false, error: '已在躲藏状态' };
    p.hidden = true;
    this.log('state', `${p.name} 进入躲藏（指向性攻击无法锁定，AOE 与无视躲避攻击仍可命中）`);
    return { ok: true };
  }

  private actSeek(pid: PlayerId, req: ActionRequest): ActionResult {
    const targetId = req.targetId;
    if (!this.rules.allowSeek) return { ok: false, error: '本局不允许找出来' };
    if (!targetId || !this.players[targetId] || !this.players[targetId].alive) return { ok: false, error: '目标不存在或已淘汰' };
    if (!this.isSameRoom(pid, targetId)) return { ok: false, error: '只能找出同房间内躲藏的玩家' };
    const tp = this.players[targetId];
    if (!tp.hidden) return { ok: false, error: '目标未躲藏' };
    tp.hidden = false;
    this.log('state', `${this.players[pid].name} 将 ${tp.name} 找了出来（现身）`);
    return { ok: true };
  }

  /** 瞄准（基础行动）：远程需瞄准的角色使用 */
  private actAim(pid: PlayerId, req: ActionRequest): ActionResult {
    const cd = this.charDef(pid);
    if (!cd.rangedNeedsAim) return { ok: false, error: '该角色无需瞄准' };
    const targetId = req.targetId;
    if (!targetId || !this.players[targetId] || !this.players[targetId].alive) return { ok: false, error: '瞄准目标不存在或已淘汰' };
    if (targetId === pid) return { ok: false, error: '不能瞄准自己' };
    this.charState(pid).aim = targetId;
    this.log('state', `${this.players[pid].name} 瞄准了 ${this.players[targetId].name}`);
    return { ok: true };
  }

  /** 喝牛奶：嘲讽性质，无实际作用（用户确认） */
  private actMilk(pid: PlayerId): ActionResult {
    this.log('action', `${this.players[pid].name} 喝了一口牛奶，向在场所有人发出嘲讽 🥛（无实际效果）`, undefined, true);
    return { ok: true };
  }

  // ─── 伤害管线 ────────────────────────────────────────────────

  applyDamage(req: DamageRequest): AppliedDamage {
    const applied: AppliedDamage = {
      target: req.target, finalTarget: req.target, amount: req.amount,
      lethal: false, missed: false, reflected: false, transferred: false,
    };

    // 1. 转移阶段钩子（大贱客吸引全场伤害）
    const transferHooks = this.aliveIds()
      .map((pid) => ({ pid, cd: this.charDef(pid) }))
      .filter(({ cd }) => cd.onBeforeDamage && cd.damageHookStage === 'transfer');
    for (const { pid, cd } of transferHooks) {
      const r = cd.onBeforeDamage!({ game: this, req, owner: pid });
      if (r === 'skip') {
        const cancelData: DamageEventData = {
          target: req.target, source: req.source, missed: true,
          dtype: req.dtype, tag: req.tag, aoe: req.aoe,
          ...(req.groupId ? { groupId: req.groupId } : {}),
        };
        this.log('state', `伤害被完全抵消（目标 ${this.players[req.target]?.name}）`, cancelData as unknown as Record<string, unknown>);
        applied.missed = true;
        return applied;
      }
    }

    let tp = this.players[req.target];
    if (!tp || !tp.alive) {
      applied.missed = true;
      return applied;
    }
    applied.transferred = !!req.transferred;
    applied.finalTarget = req.target;

    // 2. 躲避判定：指向性攻击无法命中躲藏/隐身目标
    if ((tp.hidden || tp.invisible) && !req.aoe && !req.ignoreHide && !req.bypassHide) {
      const missData: DamageEventData = {
        target: tp.id, source: req.source, missed: true,
        dtype: req.dtype, tag: req.tag, aoe: req.aoe, room: tp.room,
        ...(req.groupId ? { groupId: req.groupId } : {}),
      };
      this.log('state', `${tp.name} 处于躲藏/隐身，${req.source ? this.players[req.source].name + ' 的' : ''}攻击未命中`, missData as unknown as Record<string, unknown>);
      applied.missed = true;
      return applied;
    }

    // 3. 防御阶段钩子（马保国太极反弹等）——按座次顺序分派全部存活角色的防御钩子
    const defenseHooks = this.aliveIds()
      .map((pid) => ({ pid, cd: this.charDef(pid) }))
      .filter(({ cd }) => cd.onBeforeDamage && (!cd.damageHookStage || cd.damageHookStage === 'defense'));
    for (const { pid, cd } of defenseHooks) {
      const r = cd.onBeforeDamage!({ game: this, req, owner: pid });
      if (r === 'skip') {
        const cancelData2: DamageEventData = {
          target: req.target, source: req.source, missed: true,
          dtype: req.dtype, tag: req.tag, aoe: req.aoe,
          ...(req.groupId ? { groupId: req.groupId } : {}),
        };
        this.log('state', `伤害被完全抵消（目标 ${this.players[req.target]?.name}）`, cancelData2 as unknown as Record<string, unknown>);
        applied.missed = true;
        return applied;
      }
      tp = this.players[req.target];
      if (!tp || !tp.alive) {
        applied.missed = true;
        return applied;
      }
    }
    applied.reflected = !!req.reflected;
    applied.finalTarget = req.target;

    // 4. 结算
    const before = tp.hp;
    tp.hp = Math.max(0, Math.round((tp.hp - req.amount) * 10000) / 10000);
    const dmgData: DamageEventData = {
      target: tp.id, source: req.source, amount: req.amount,
      hpBefore: before, hpAfter: tp.hp, lethal: tp.hp <= 0,
      dtype: req.dtype, tag: req.tag, segment: req.segment,
      aoe: req.aoe, room: tp.room,
      reflected: !!req.reflected, transferred: !!req.transferred,
      ...(req.groupId ? { groupId: req.groupId } : {}),
    };
    this.log('damage', `${tp.name} 受到 ${fmtNum(req.amount)} 伤害（${req.dtype === 'mental' ? '精神' : req.dtype === 'special' ? '特殊' : '物理'}${req.tag ? `·${req.tag}` : ''}${req.segment ? `·第${req.segment.index}/${req.segment.total}段` : ''}）：${fmtNum(before)} → ${fmtNum(tp.hp)}${req.source ? `（来源 ${this.players[req.source].name}）` : ''}`, dmgData as unknown as Record<string, unknown>, true);

    // 战绩：实际掉血量
    const dealt = Math.max(0, before - tp.hp);
    if (this.stats[tp.id]) this.stats[tp.id].damageTaken += dealt;
    if (req.source && req.source !== tp.id && this.stats[req.source]) this.stats[req.source].damageDealt += dealt;

    // 5. 附加效果（转移伤害不随转移）
    if (req.effects && req.effects.length > 0 && !req.transferred) {
      this.applyDamageEffects(tp.id, req.effects);
    }

    // 6. 淘汰判定
    if (tp.hp <= 0) {
      applied.lethal = true;
      this.eliminate(tp.id, req.tag || 'damage', req.source);
    }
    return applied;
  }

  private applyDamageEffects(target: PlayerId, effects: { kind: string }[]): void {
    for (const ef of effects) {
      this.log('state', `${this.players[target].name} 获得效果：${ef.kind}`);
    }
  }

  // ─── 淘汰与胜负 ──────────────────────────────────────────────

  eliminate(pid: PlayerId, cause: string, killer?: PlayerId): void {
    const p = this.players[pid];
    if (!p || !p.alive) return;

    // 命数机制（如五条悟2条命）：致死时消耗一条命并满血复活；被房主踢出/主动退出不触发
    const livesLeft = typeof p.char.livesLeft === 'number' ? (p.char.livesLeft as number) : 1;
    if (livesLeft > 1 && cause !== 'kicked' && cause !== 'left') {
      p.char.livesLeft = livesLeft - 1;
      p.hp = p.maxHp;
      p.hidden = false;
      p.invisible = false;
      const reviveData: ReviveEventData = { pid, livesLeft: livesLeft - 1 };
      this.log('trigger', `💫 ${p.name} 消耗一条命（剩余 ${livesLeft - 1} 条），以 ${fmtNum(p.maxHp)} HP 复活！`, reviveData as unknown as Record<string, unknown>, true);
      return;
    }

    p.alive = false;
    p.hidden = false;
    p.invisible = false;
    p.hp = 0;
    // 领域随持有者退场而消失（游戏中唯一会"自然失效"的路径；不含被覆盖）
    if (this.domainHolder === pid) {
      this.domainHolder = null;
      p.char.domain = false;
      this.log('trigger', `🌀 ${p.name} 的领域随其退场消失`, { pid }, true);
    }
    if (killer && killer !== pid && this.stats[killer]) this.stats[killer].kills++;
    const elimData: EliminateEventData = { pid, cause, ...(killer && killer !== pid ? { killer } : {}) };
    this.log('eliminate', `💀 ${p.name}（${this.charName(pid)}）被淘汰（原因：${cause}${killer ? `，击杀者 ${this.players[killer]?.name}` : ''}）`, elimData as unknown as Record<string, unknown>, true);
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

  checkWin(): boolean {
    if (this.phase === 'over') return true;
    // 炸弹先结算、后判胜（Issue #6）：存在已激活（explodeRound<=roundNo）、待本回合末引爆的大伊万时，
    // 延迟终局判定——让本回合完整走完，回合末延迟事件结算后再做最终胜负判断（最后一人在房内可被同归于尽）。
    // settlingDeferred：延迟事件结算循环期间不定胜负——同一发爆炸连杀两人时，第一人淘汰后剩余人数
    // 可能为 1，若当场定胜负会错误产生「幸存者」（其随后也会被同一发炸死，应为平局）。
    // endRound 的延迟事件结算会把 due 伊万移除并在循环结束后复位 settlingDeferred，
    // 因此 endRound 末尾的最终 checkWin 到达此处时两项条件必为 false，最终判定正常执行。
    if (this.settlingDeferred || this.hasArmedIvan()) return false;
    const alive = this.aliveIds();
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

    // 延迟事件（大伊万爆炸 / 通用延迟伤害）：动态判定结算时状态。
    // settlingDeferred 期间淘汰不定胜负（同一发爆炸连杀两人时须统一判平局，见 checkWin）
    const due = this.deferred.filter((d) => d.explodeRound <= this.roundNo);
    this.settlingDeferred = true;
    for (const ev of due) {
      // 大伊万只在「分出胜负」的回合末引爆：平局回合跳过（事件保留，顺延至下一个分出胜负回合）
      if (ev.kind === 'ivan' && !this.roundResolved) continue;
      this.deferred = this.deferred.filter((d) => d.id !== ev.id);
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
    this.judgeRecords = [];
    this.entrantOrder = this.aliveIds();
    this.roundSummary = [];
    // 注意：领域（char.domain / domainHolder）是场地状态，跨回合持续保留，
    // 这里**不清除**；只有被其他领域覆盖或持有者淘汰时才失效。
    this.phase = 'rps1';
    this.log('phase', `—— 第 ${this.roundNo} 回合 · 隐藏出拳 ——`, undefined, true);
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
    const rps1 = this.judgeRecords.filter((r) => r.stage === 'rps1');
    const rec = rps1.length > 0 ? rps1[rps1.length - 1]
      : (this.judgeRecords.length > 0 ? this.judgeRecords[this.judgeRecords.length - 1] : this.lastReveal);
    if (!rec) return null;
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

  snapshot(): Record<string, unknown> {
    const players = this.playerIds.map((pid) => {
      const p = this.players[pid];
      return {
        id: p.id, name: p.name, charId: p.charId, charName: this.charName(pid),
        hp: p.hp, maxHp: p.maxHp, room: p.room, originRoom: p.originRoom,
        alive: p.alive, type: p.type, hidden: p.hidden, invisible: p.invisible,
        char: { ...p.char }, // 判定历史单独剥离
      };
    });
    return {
      seed: this.seed,
      roundNo: this.roundNo,
      subRound: this.subRound,
      phase: this.phase,
      players,
      roomIds: this.roomIds,
      submittedIds: this.submittedIds.filter((pid) => this.players[pid]?.alive),
      pendingCount: Object.keys(this.pendingThrows).length,
      qualified: this.qualified,
      queue: this.queue,
      actIndex: this.actIndex,
      currentActor: this.currentActor(),
      deferred: this.deferred.map((d) => ({ ...d })),
      judgeRecords: this.judgeRecords.map((r) => ({ ...r, throws: { ...r.throws } })),
      /** 已揭示的出拳（全员可见）；提交阶段为 null，不泄露任何拳种 */
      reveal: this.revealInfo(),
      /** 局内战绩（每人一份，纯统计） */
      stats: Object.fromEntries(this.playerIds.map((pid) => [pid, { ...this.stats[pid] }])),
      /** 领域持有者（全场唯一；null 表示当前无领域生效） */
      domainHolder: this.domainHolder,
      // 日志通过增量（newLogs）下发，快照不再重复携带（带宽优化：长对局不随每次状态同步重发全量日志）
      winner: this.winner ?? null,
      aliveCount: this.aliveIds().length,
    };
  }
}
