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
  deferred: DeferredEvent[] = [];
  logs: LogEntry[] = [];
  private logSeq = 0;
  winner: PlayerId | null | undefined;
  judgeRecords: JudgeRoundRecord[] = [];
  private deferredSeq = 0;
  private deathChainDepth = 0;

  constructor(config: GameConfig) {
    this.seed = config.seed ?? (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    this.rng = new RNG(this.seed);
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
        char: cd.init ? cd.init() : {},
      };
      this.playerIds.push(pc.id);
      this.roomIds.push(room);
      this.histories[pc.id] = [];
    });
    this.entrantOrder = this.aliveIds();
    this.log('phase', `游戏开始：${this.playerIds.length} 名玩家，随机种子 ${this.seed}`);
    for (const pid of this.playerIds) {
      const p = this.players[pid];
      this.log('info', `${p.name}（${this.charName(pid)}）初始位置 ${p.originRoom}，血量 ${fmtNum(p.maxHp)}`);
    }
    this.log('phase', `第 ${this.roundNo} 回合 · 初次判定开始（所有存活玩家隐藏出拳）`);
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

  log(type: LogType, text: string, data?: Record<string, unknown>): void {
    this.logs.push({
      seq: ++this.logSeq,
      round: this.roundNo,
      sub: this.subRound,
      phase: this.phase,
      type,
      text,
      data,
    });
  }

  /** 领域平局算胜：恰有一名领域生效者时返回该玩家，否则 null（多名=领域对冲） */
  tieWinHolder(candidates: PlayerId[]): PlayerId | null {
    const holders = candidates.filter((pid) => {
      const cd = this.charDef(pid);
      return cd.domainTieWin && this.charState(pid).domain === true && this.players[pid].alive;
    });
    if (holders.length === 1) return holders[0];
    if (holders.length >= 2) {
      this.log('trigger', '领域对冲：多名领域持有者效果抵消，平局保持平局');
      return null;
    }
    return null;
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
    this.log('heal', `${p.name} 回复 ${fmtNum(amount)}：${fmtNum(before)} → ${fmtNum(p.hp)}`);
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

  /** 解析当前判定子轮 */
  private resolveJudgeSubRound(): void {
    if (this.phase !== 'rps1') return;
    const entrants = this.aliveIds();
    const tieWin = (cands: PlayerId[]) => this.tieWinHolder(cands);
    const outcome = resolveSubRound(this.pendingThrows, entrants, tieWin);
    this.judgeRecords.push({
      stage: 'rps1', sub: this.subRound,
      throws: { ...this.pendingThrows },
      outcome: outcome.status,
      winners: outcome.winners, losers: outcome.losers,
    });

    const throwsDesc = entrants.map((pid) => `${this.players[pid].name}:${this.throwName(this.pendingThrows[pid]!)}`).join('，');
    if (outcome.status === 'cycle') {
      this.log('judge', `判定子轮${this.subRound}（${throwsDesc}）：三人循环，全员重新判定`);
      appendHistoryForRound(this, outcome, entrants, 'rps1', this.subRound);
      this.nextJudgeSubRound();
      return;
    }
    if (outcome.status === 'alltie') {
      this.log('judge', `判定子轮${this.subRound}（${throwsDesc}）：同拳平局，全员重新判定`);
      appendHistoryForRound(this, outcome, entrants, 'rps1', this.subRound);
      this.nextJudgeSubRound();
      return;
    }
    if (outcome.status === 'tieWin') {
      this.log('judge', `判定子轮${this.subRound}（${throwsDesc}）：平局，但${this.players[outcome.winners[0]].name}领域生效判胜`);
      appendHistoryForRound(this, outcome, entrants, 'rps1', this.subRound);
    } else {
      this.log('judge', `判定子轮${this.subRound}（${throwsDesc}）：分出胜负`);
      appendHistoryForRound(this, outcome, entrants, 'rps1', this.subRound);
    }

    if ((this.phase as GamePhase) === 'over') return; // 判定过程中可能触发自爆等导致终局

    // 胜者获得行动资格（过滤判定过程中死亡者）
    const winnersAlive = outcome.winners.filter((pid) => this.players[pid].alive);
    const losersDesc = outcome.losers.filter((pid) => this.players[pid].alive)
      .map((pid) => this.players[pid].name).join('、');
    this.log('judge', `初次判定结果：${winnersAlive.map((pid) => this.players[pid].name).join('、')} 获得行动资格${losersDesc ? `；${losersDesc} 本回合无资格` : ''}`);

    if (this.checkWin()) return;

    if (winnersAlive.length === 0) {
      this.log('info', '无人获得行动资格，回合直接结束');
      this.endRound();
      return;
    }

    this.beginActionPhase(winnersAlive);
  }

  private nextJudgeSubRound(): void {
    if (this.phase === 'over') return;
    // 判定过程中死亡（如自爆）者退出
    if (this.aliveIds().length <= 1) {
      this.checkWin();
      return;
    }
    this.subRound++;
    this.pendingThrows = {};
    this.submittedIds = [];
    this.log('judge', `重新判定（子轮${this.subRound}），请所有存活玩家再次出拳`);
  }

  private throwName(t: Throw): string {
    return t === 'rock' ? '石头' : t === 'scissors' ? '剪刀' : '布';
  }

  // ─── 二次判定与行动队列 ───────────────────────────────────────

  private beginActionPhase(winners: PlayerId[]): void {
    const roll = (pids: PlayerId[]) => rollThrows(pids, this.rng);
    const tieWin = (cands: PlayerId[]) => this.tieWinHolder(cands);
    const { order, rounds } = resolveActionOrder(winners, roll, tieWin, {
      append: (pid, step, stage, sub) => this.appendJudgeHistory(pid, step, stage, sub),
    });
    this.judgeRecords.push(...rounds);
    if (this.phase === 'over') return; // 排序判定过程中可能触发自爆等导致终局
    const aliveOrder = order.filter((pid) => this.players[pid].alive);
    this.qualified = winners.filter((pid) => this.players[pid].alive);
    this.queue = aliveOrder;
    this.actIndex = 0;
    this.log('order', `二次判定完成，行动顺序：${aliveOrder.map((pid) => this.players[pid].name).join(' → ')}`);
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
    this.log('action', `${p.name} 执行行动：${this.actionLabel(req)}`);
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
    this.log('move', `${p.name} 从 ${from} 移动到 ${room}`);
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
    this.log('damage', `${this.players[pid].name} ${ranged ? '远程' : '近战'}攻击 ${tp.name}（伤害 ${fmtNum(amount)}）`);
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
    this.log('heal', `${p.name} 回复：${fmtNum(before)} → ${fmtNum(p.hp)}（满血）`);
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
        this.log('state', `伤害被完全抵消（目标 ${this.players[req.target]?.name}）`);
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
      this.log('state', `${tp.name} 处于躲藏/隐身，${req.source ? this.players[req.source].name + ' 的' : ''}攻击未命中`);
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
        this.log('state', `伤害被完全抵消（目标 ${this.players[req.target]?.name}）`);
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
    if (req.instakill) {
      this.log('damage', `${tp.name} 受到秒杀效果（${req.tag || '伤害'}${req.segment ? ` 第${req.segment.index}/${req.segment.total}段` : ''}）`);
      tp.hp = 0;
    } else {
      const before = tp.hp;
      tp.hp = Math.max(0, Math.round((tp.hp - req.amount) * 10000) / 10000);
      this.log('damage', `${tp.name} 受到 ${fmtNum(req.amount)} 伤害（${req.dtype === 'mental' ? '精神' : req.dtype === 'special' ? '特殊' : '物理'}${req.tag ? `·${req.tag}` : ''}${req.segment ? `·第${req.segment.index}/${req.segment.total}段` : ''}）：${fmtNum(before)} → ${fmtNum(tp.hp)}${req.source ? `（来源 ${this.players[req.source].name}）` : ''}`);
    }

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
    p.alive = false;
    p.hidden = false;
    p.invisible = false;
    p.hp = 0;
    this.log('eliminate', `${p.name}（${this.charName(pid)}）被淘汰（原因：${cause}${killer ? `，击杀者 ${this.players[killer]?.name}` : ''}），初始位置 ${p.originRoom} 保留`);
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
    const alive = this.aliveIds();
    if (alive.length === 1) {
      this.phase = 'over';
      this.winner = alive[0];
      this.log('result', `游戏结束：${this.players[alive[0]].name}（${this.charName(alive[0])}）获得胜利！`);
      this.cancelDeferredOnGameOver();
      return true;
    }
    if (alive.length === 0) {
      this.phase = 'over';
      this.winner = null;
      this.log('result', '游戏结束：所有玩家同时淘汰，平局');
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

  // ─── 回合末（延迟事件结算） ───────────────────────────────────

  private endRound(): void {
    if (this.phase === 'over') return;
    this.phase = 'roundEnd';
    this.log('phase', `第 ${this.roundNo} 回合行动结束，进入回合末结算`);

    // 角色回合末钩子
    for (const pid of this.aliveIds()) {
      const cd = this.charDef(pid);
      if (cd.onRoundEnd) cd.onRoundEnd({ game: this });
    }
    if ((this.phase as GamePhase) === 'over') return;

    // 延迟事件（大伊万爆炸 / 通用延迟伤害）：动态判定结算时状态
    const due = this.deferred.filter((d) => d.explodeRound <= this.roundNo);
    for (const ev of due) {
      this.deferred = this.deferred.filter((d) => d.id !== ev.id);
      if (ev.kind === 'damage' && ev.payload) {
        this.log('deferred', `延迟伤害结算：${String((ev.payload as { label?: string }).label || '')}`);
        this.applyDamage(ev.payload as DamageRequest & { label?: string });
        if ((this.phase as GamePhase) === 'over') return;
      } else if (ev.kind === 'ivan') {
        const members = this.roomMembers(ev.room);
        this.log('deferred', `大伊万在 ${ev.room} 爆炸！爆炸时房间内成员：${members.length ? members.map((pid) => this.players[pid].name).join('、') : '（无存活玩家）'}`);
        for (const pid of members) {
          this.applyDamage({
            target: pid,
            amount: 999999,
            source: ev.source,
            dtype: 'special',
            instakill: true,
            noReflect: true,
            tag: 'ivan',
          });
        }
        if ((this.phase as GamePhase) === 'over') return;
      }
    }

    if (this.checkWin()) return;

    this.roundNo++;
    this.subRound = 1;
    this.pendingThrows = {};
    this.submittedIds = [];
    this.qualified = [];
    this.queue = [];
    this.actIndex = 0;
    this.judgeRecords = [];
    this.entrantOrder = this.aliveIds();
    this.phase = 'rps1';
    this.log('phase', `—— 第 ${this.roundNo} 回合 · 初次判定开始 ——`);
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
      logs: this.logs.slice(-500),
      winner: this.winner ?? null,
      aliveCount: this.aliveIds().length,
    };
  }
}
