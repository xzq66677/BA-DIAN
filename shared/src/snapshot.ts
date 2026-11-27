import type { Game } from './engine.js';
import { PROTOCOL_VERSION, type GameSnapshot } from './protocol.js';
import { publicStatusEffects } from './statuses.js';

/** Public state for clients and the test arena. Pending throw values stay in the engine. */
export function serializeSnapshot(game: Game, mapFields?: Pick<GameSnapshot, 'ruins'>): GameSnapshot {
  const players = game.playerIds.map((pid) => {
    const p = game.players[pid];
    return {
      id: p.id, name: p.name, charId: p.charId, charName: game.charName(pid),
      hp: p.hp, maxHp: p.maxHp, room: p.room, originRoom: p.originRoom,
      alive: p.alive, type: p.type, hidden: p.hidden, invisible: p.invisible,
      /** 持续状态：只投影公开字段（内部生命周期字段不下发） */
      effects: publicStatusEffects(p.effects),
      char: { ...p.char }, // 判定历史（完整记录）单独剥离，只下发最近 3 条公开结果
      judgeStreak: game.judgeHistory(pid).slice(-3),
      /** 行动封印：公开信息（谁被封了什么行动），UI 据此置灰行动 */
      actionLocks: (p.actionLocks ?? []).map((l) => ({ ...l })),
      /** 通用状态：公开信息，UI 通过状态读取器白名单渲染 */
      statuses: (p.statuses ?? []).map((s) => ({ ...s })),
    };
  });
  return {
    v: PROTOCOL_VERSION,
    seed: game.seed,
    roundNo: game.roundNo,
    subRound: game.subRound,
    phase: game.phase,
    players,
    roomIds: [...game.roomIds],
    ...mapFields,
    submittedIds: game.submittedIds.filter((pid) => game.players[pid]?.alive),
    pendingCount: Object.keys(game.pendingThrows).length,
    qualified: [...game.qualified],
    queue: [...game.queue],
    actIndex: game.actIndex,
    currentActor: game.currentActor(),
    deferred: game.deferred.map((d) => ({ ...d })),
    judgeRecords: game.judgeRecords.map((r) => ({ ...r, throws: { ...r.throws } })),
    /** 已揭示的出拳（全员可见）；提交阶段为 null，不泄露任何拳种 */
    reveal: game.revealInfo(),
    /** 本回合最近一次排序子轮的揭示（行动阶段用来解释行动顺序来源） */
    orderReveal: game.orderRevealInfo(),
    /** 技能内判定（马保国系）：进行中的出拳面板数据；非判定阶段为 null */
    judge: game.skillJudgeView(),
    /** 当前行动者由状态 / 在场角色提供的附加行动（服务端权威，客户端只展示） */
    extraActions: game.extraActionViews(game.currentActor()),
    /** 二次判定（rps2）：当前子轮等待出拳的玩家 / 已提交玩家 / 已确定顺序前缀 / 子轮号 */
    orderGroup: game.currentOrderGroup(),
    orderSubmittedIds: [...game.orderSubmittedIds],
    orderResult: [...game.orderOrder],
    orderSub: game.orderSub,
    /** 二次判定用途（行动排序 / 暴走权排序） */
    orderPurpose: game.orderPurposeKind(),
    /** 回合前触发（大屁孩暴走）：等待谁指定目标、后续持有者 */
    trigger: game.triggerView(),
    /** 局内战绩（每人一份，纯统计） */
    stats: Object.fromEntries(game.playerIds.map((pid) => [pid, { ...game.stats[pid] }])),
    /** 领域持有者（全场唯一；null 表示当前无领域生效） */
    domainHolder: game.domainHolder,
    // 日志通过增量（newLogs）下发，快照不再重复携带（带宽优化：长对局不随每次状态同步重发全量日志）
    winner: game.winner ?? null,
    aliveCount: game.aliveIds().length,
  };
}
