/**
 * 宗师档（AI 第四档）：每个角色单独编写的专属策略注册表。
 *
 * 与通用策略（server/src/ai.ts 的 easy/normal/hard）分层：
 *  - 通用策略只按「行动收益」通用规则决策，不出现角色名分支（工程规范）；
 *  - 本注册表按角色 id 提供专属打法，server 侧只查表、不认识具体角色；
 *  - 未注册的未知/未来角色安全降级为硬核策略（见 ai.ts 的 expertDecide）。
 *
 * 打法依据 2026-11-28 离线蒙特卡洛 90 分钟实验（7,271,000 局，tier3 互打，
 * Wilson 95% CI，见 D:/AI工作区/badian-game-sim/BA-DIAN-90分钟实验结果-中文版.zip）：
 *  - 支配端：佝偻弓箭手 2p 98.1%、狂猎 2p 94.3%、马保国 2p/3p ≈78%；
 *  - 受压制端：吹箫哥 2p/10p 0 胜、大贱客 6p/10p 0 胜、无业游民 10p 0 胜、
 *    卖大伊万的小女孩 10p 0.00%、伍六七 10p 0.22%；
 *  - 宗师策略针对压制根因（行动可达性、目标锁定、定位）逐角色修正打法。
 */

import type { CharacterAiContext } from '../chardef.js';
import type { ActionRequest, PlayerId } from '../types.js';
import { BURNING_KIND, POSSESSED_KIND } from '../statuses.js';
import { sealableActions } from '../effects.js';
import { slotHeroAi, type SlotState } from './slot-hero.js';

export type ExpertStrategy = (ctx: CharacterAiContext) => ActionRequest | undefined;

// ─── 共享小工具（只依赖 ctx 公开面，不 import server） ───────────

/** 目标可见（未躲藏且未隐身） */
function visibleOf(game: CharacterAiContext['game'], pid: PlayerId): boolean {
  const p = game.players[pid];
  return !p.hidden && !p.invisible;
}

/** 单次攻击伤害（近战口径；远程伤害由调用方按需取 rangedDamage） */
function attackOf(ctx: CharacterAiContext, pid: PlayerId): number {
  const cd = ctx.game.charDef(pid);
  return cd.meleeDamage ?? cd.attack ?? ctx.game.rules.defaultAttack;
}

/** 威胁评分：攻击力×2 + 血量（与 server 通用策略口径一致） */
function threatOf(ctx: CharacterAiContext, pid: PlayerId): number {
  return attackOf(ctx, pid) * 2 + ctx.game.players[pid].hp;
}

function byThreat(ctx: CharacterAiContext) {
  return (a: PlayerId, b: PlayerId) => threatOf(ctx, b) - threatOf(ctx, a);
}

function byHp(game: CharacterAiContext['game']) {
  return (a: PlayerId, b: PlayerId) => game.players[a].hp - game.players[b].hp;
}

function byHpDesc(game: CharacterAiContext['game']) {
  return (a: PlayerId, b: PlayerId) => game.players[b].hp - game.players[a].hp;
}

/** 还能回复（未被封印且未满血） */
function canHeal(ctx: CharacterAiContext): boolean {
  return !ctx.game.charDef(ctx.pid).blockBaseActions?.includes('heal')
    && ctx.me.hp < ctx.me.maxHp;
}

/** 同房间是否有能一击带走自己的可见敌人 */
function inMeleeDanger(ctx: CharacterAiContext): boolean {
  const me = ctx.me;
  return ctx.members.some((p) => {
    if (!visibleOf(ctx.game, p)) return false;
    return attackOf(ctx, p) >= me.hp;
  });
}

/**
 * 同房间只剩躲藏者时是否值得「找出来」：
 * 需要近战可输出（远程/无攻击/无视躲藏的角色另有打法，不浪费行动）。
 */
function worthSeeking(ctx: CharacterAiContext): boolean {
  const cd = ctx.game.charDef(ctx.pid);
  if (cd.ignoreHide || cd.onAttackAction) return false;
  if (cd.attackType === 'ranged' || cd.attackType === 'none') return false;
  return attackOf(ctx, ctx.pid) > 0;
}

/** 通用移动评分：优先「残血可补刀多、敌人少」的房间（孤立决斗，减少围殴） */
function bestRoom(ctx: CharacterAiContext): ActionRequest | undefined {
  const { game, pid } = ctx;
  const myAtk = attackOf(ctx, pid);
  const scored = game.roomIds
    .filter((r) => r !== game.players[pid].room && !game.isMoveBlocked(pid, r))
    .map((r) => {
      const others = game.roomMembers(r).filter((p) => p !== pid && game.players[p].hp > 0);
      return {
        room: r,
        weak: others.filter((p) => game.players[p].hp <= myAtk).length,
        enemies: others.length,
      };
    });
  const best = scored.filter((x) => x.enemies > 0)
    .sort((a, b) => (b.weak - a.weak) || (a.enemies - b.enemies))[0];
  if (best) return { type: 'move', room: best.room };
  return undefined;
}

/**
 * 无特化的通用宗师打法（无业游民 / 今日勇者抽取运势后共用）：
 * 补刀 → 找出来 → 回复 → 孤立移动 → 躲藏；返回 undefined 时交给通用回退链。
 */
function vanillaExpert(ctx: CharacterAiContext): ActionRequest | undefined {
  const { game, pid, me, members } = ctx;
  const myAtk = attackOf(ctx, pid);
  const visibleSame = members.filter((p) => visibleOf(game, p));

  // 残血且房间内有威胁 → 先回复（回复是回满血）
  if (me.hp <= 1 && visibleSame.length > 0 && canHeal(ctx)) return { type: 'heal' };

  // 补刀：能一击带走的目标优先
  const killable = visibleSame.filter((p) => game.players[p].hp <= myAtk).sort(byHp(game))[0];
  if (killable) return { type: 'attack', targetId: killable };

  // 同房间只剩躲藏者 → 找出来
  const hidden = members.filter((p) => !visibleOf(game, p));
  if (visibleSame.length === 0 && hidden.length > 0 && worthSeeking(ctx)) {
    return { type: 'seek', targetId: hidden.sort(byThreat(ctx))[0] };
  }

  // 打威胁最高者
  if (visibleSame.length > 0) {
    return { type: 'attack', targetId: visibleSame.sort(byThreat(ctx))[0] };
  }

  if (canHeal(ctx)) return { type: 'heal' };

  // 无目标 → 移向可补刀多、敌人少的房间
  const move = bestRoom(ctx);
  if (move) return move;

  if (game.rules.allowHide && !me.hidden) return { type: 'hide' };
  return undefined;
}

// ─── 飞天水螅运行时状态（结构见 characters/index.ts） ───────────

interface WaterSnakeState {
  towerBaseRoom: string | null;
  towerHp: number;
  buildProgress: number;
  inTower: boolean;
  posthumous: boolean;
}

/** 钥匙封印：基础行动不值得浪费钥匙，只封角色/地图专属行动 */
const NOT_WORTH_SEALING = new Set(['hide', 'seek', 'skip', 'move', 'heal', 'milk', 'aim']);

function bestSeal(ctx: CharacterAiContext): ActionRequest | undefined {
  const { game, alive } = ctx;
  const target = alive.filter((p) => p !== ctx.pid && game.players[p].hp > 0).sort(byThreat(ctx))[0];
  if (!target) return undefined;
  // 运行时传入的是完整引擎对象（CharacterAiContext 只声明了只读公开面）
  const specials = sealableActions(game as unknown as Parameters<typeof sealableActions>[0], target)
    .filter((x) => !NOT_WORTH_SEALING.has(x.action));
  if (specials.length === 0) return undefined;
  // 取清单末尾（角色专属行动排在基础行动之后），封掉最核心的技能
  return { type: 'slotKey', targetId: target, params: { action: specials[specials.length - 1].action } };
}

// ─── 16 角色专属策略 ───────────────────────────────────────────

export const characterExpertAi: Record<string, ExpertStrategy> = {
  /** 无业游民：无被动白板——比硬核更强调「孤立决斗 + 补刀」，避免 10 人局被围殴消耗（实验 10p 0 胜） */
  default: vanillaExpert,

  /** 拔棍：未拔棍先拔棍；拔棍后无视躲避直击，补刀优先，被一击线威胁时先回满血（拔棍不消耗） */
  bagun(ctx) {
    const { game, pid, me, st, members } = ctx;
    if (st.stickDrawn !== true) return { type: 'toggleStick' };
    // 拔棍攻击无视躲避（含隐身、躲藏）：同房间所有存活者都是合法目标
    const targets = members.filter((p) => game.players[p].hp > 0);
    if (targets.length > 0) {
      const kill = targets.filter((p) => game.players[p].hp <= attackOf(ctx, pid)).sort(byHp(game))[0];
      if (kill) return { type: 'attack', targetId: kill };
      if (canHeal(ctx) && inMeleeDanger(ctx)) return { type: 'heal' };
      return { type: 'attack', targetId: targets.sort(byThreat(ctx))[0] };
    }
    if (canHeal(ctx)) return { type: 'heal' };
    return undefined;
  },

  /**
   * 吹箫哥：只能远程（异房间）——同房间时完全无法输出，是实验 2p/10p 0 胜的根因。
   * 宗师打法：能狙击先狙击 → 与可见敌人同房间立刻撤到空房放风筝 → 残血回复 → 点射威胁最高者
   * → 同房间只剩躲藏者先找出来（揭示后下一回合就能狙击）→ 全场隐匿时靠近人群找视野。
   */
  chuixiao(ctx) {
    const { game, pid, me, alive } = ctx;
    const cd = game.charDef(pid);
    const rangedDmg = cd.rangedDamage ?? attackOf(ctx, pid);
    const crossVisible = alive.filter((p) => !game.isSameRoom(pid, p) && visibleOf(game, p));
    const sameRoomOthers = game.roomMembers(me.room).filter((p) => p !== pid && game.players[p].hp > 0);
    const sameVisible = sameRoomOthers.filter((p) => visibleOf(game, p));
    const sameHidden = sameRoomOthers.filter((p) => !visibleOf(game, p));

    // 1) 跨房间斩杀线 → 立刻狙击（远程位安全）
    const kill = crossVisible.filter((p) => game.players[p].hp <= rangedDmg).sort(byThreat(ctx))[0];
    if (kill) return { type: 'attack', targetId: kill, ranged: true };

    // 2) 与可见敌人同房间 → 撤到没有敌人的房间（吹箫哥无法近战，贴脸=零输出+挨打）
    if (sameVisible.length > 0) {
      const safe = game.roomIds
        .filter((r) => r !== me.room && !game.isMoveBlocked(pid, r))
        .map((r) => ({ r, n: game.roomMembers(r).filter((p) => p !== pid && game.players[p].hp > 0).length }))
        .sort((a, b) => a.n - b.n)[0];
      if (safe && safe.n === 0) return { type: 'move', room: safe.r };
    }

    // 3) 残血回复（远程位安全，回满血不亏）
    if (canHeal(ctx) && me.hp <= rangedDmg) return { type: 'heal' };

    // 4) 持续点射跨房间威胁最高者
    const chip = crossVisible.sort(byThreat(ctx))[0];
    if (chip) return { type: 'attack', targetId: chip, ranged: true };

    // 5) 同房间只剩躲藏者 → 找出来（吹箫哥无法近战，但揭示后下一回合即可离房狙击）
    if (sameHidden.length > 0 && game.rules.allowSeek) {
      return { type: 'seek', targetId: sameHidden.sort(byHp(game))[0] };
    }

    // 6) 全场隐匿 → 靠近人数最多的房间找视野
    const crowded = game.roomIds
      .filter((r) => r !== me.room && !game.isMoveBlocked(pid, r))
      .map((r) => ({ r, n: game.roomMembers(r).filter((p) => p !== pid && game.players[p].hp > 0).length }))
      .sort((a, b) => (b.n - a.n) || (game.roomIds.indexOf(a.r) - game.roomIds.indexOf(b.r)))[0];
    if (crowded && crowded.n > 0) return { type: 'move', room: crowded.r };
    return undefined;
  },

  /** 五条悟：领域先手（免瞄准远程2伤+平局回合行动权），有领域后全程远程狙击、补刀优先，残血激进（有两条命） */
  gojo(ctx) {
    const { game, pid, me, st, alive, members } = ctx;
    if (st.domain !== true) return { type: 'domain' };
    const crossVisible = alive.filter((p) => !game.isSameRoom(pid, p) && visibleOf(game, p));
    const sameVisible = members.filter((p) => visibleOf(game, p));

    const rangedKill = crossVisible.filter((p) => game.players[p].hp <= 2).sort(byThreat(ctx))[0];
    if (rangedKill) return { type: 'attack', targetId: rangedKill, ranged: true };
    const meleeKill = sameVisible.filter((p) => game.players[p].hp <= 1)[0];
    if (meleeKill) return { type: 'attack', targetId: meleeKill };

    if (canHeal(ctx) && me.hp <= 1) return { type: 'heal' };
    const chip = crossVisible.sort(byThreat(ctx))[0];
    if (chip) return { type: 'attack', targetId: chip, ranged: true };
    if (sameVisible.length > 0) return { type: 'attack', targetId: sameVisible.sort(byThreat(ctx))[0] };
    if (canHeal(ctx)) return { type: 'heal' };
    return undefined;
  },

  /** 老大爷：领域先手（近5远3+平局行动权）；血量1.5极脆——回复优先，斩杀线内优先远程（安全），近战只在能收割时用 */
  laodaye(ctx) {
    const { game, pid, me, st, alive, members } = ctx;
    if (st.domain !== true) return { type: 'domain' };
    const crossVisible = alive.filter((p) => !game.isSameRoom(pid, p) && visibleOf(game, p));
    const sameVisible = members.filter((p) => visibleOf(game, p));

    // 远程 3 伤：跨房间斩杀线（无暴露风险）
    const rangedKill = crossVisible.filter((p) => game.players[p].hp <= 3).sort(byThreat(ctx))[0];
    if (rangedKill) return { type: 'attack', targetId: rangedKill, ranged: true };
    // 近战 5 伤：同房间大目标收割
    const meleeKill = sameVisible.filter((p) => game.players[p].hp <= 5).sort(byThreat(ctx))[0];
    if (meleeKill) return { type: 'attack', targetId: meleeKill };

    if (canHeal(ctx)) return { type: 'heal' };
    const chip = crossVisible.sort(byThreat(ctx))[0];
    if (chip) return { type: 'attack', targetId: chip, ranged: true };
    if (sameVisible.length > 0) return { type: 'attack', targetId: sameVisible.sort(byThreat(ctx))[0] };
    return undefined;
  },

  /**
   * 马保国：太极反弹/不讲武德都是被动（引擎自动结算）。
   * 主动输出只有两式：普通攻击（1伤）与闪电五连鞭（胜次×20%×目标当前血量）——
   * 斩杀线内直接打；否则五连鞭挑当前血量最高的目标（百分比伤害收益最大）。实验 2p/3p ≈78% 的强度来源即五连鞭。
   */
  mabaoguo(ctx) {
    const { game, pid, me, members } = ctx;
    const sameVisible = members.filter((p) => visibleOf(game, p));
    if (sameVisible.length > 0) {
      const kill = sameVisible.filter((p) => game.players[p].hp <= attackOf(ctx, pid)).sort(byHp(game))[0];
      if (kill) return { type: 'attack', targetId: kill };
      return { type: 'whip5', targetId: [...sameVisible].sort(byHpDesc(game))[0] };
    }
    if (canHeal(ctx) && me.hp <= 2) return { type: 'heal' };
    return undefined;
  },

  /**
   * 伍六七：攻击=选房间蓄力，下回合末 3 刀对房间内所有其他存活者各 1 伤（命中躲藏）。
   * 宗师打法：优先选「存在 hp<=3 必杀目标」的房间，其次人数最多、总血量最低者（实验 10p 0.22%——蓄力房间选择是关键）。
   */
  wuliuqi(ctx) {
    const { game, pid } = ctx;
    const scored = game.roomIds
      .map((room) => {
        const others = game.roomMembers(room).filter((p) => p !== pid && game.players[p].hp > 0);
        return {
          room,
          lethal: others.filter((p) => game.players[p].hp <= 3).length,
          n: others.length,
          hpSum: others.reduce((s, p) => s + game.players[p].hp, 0),
        };
      })
      .sort((a, b) => (b.lethal - a.lethal) || (b.n - a.n) || (a.hpSum - b.hpSum));
    const best = scored[0];
    if (best && best.n > 0) return { type: 'attack', room: best.room };
    return { type: 'skip' };
  },

  /**
   * 卖大伊万的小女孩：攻击 0，唯一输出是大伊万（投掷无冷却）。
   * 宗师打法：持续把炸弹扔进人最多的异房间；异房间没人时——同房间 ≥2 敌人同归于尽换掉一群，
   * 恰 1 敌人先撤离（1 换 1 不划算），无处可撤才同归于尽（实验 10p 0.00% 的定位修复）。
   */
  'ivan-girl'(ctx) {
    const { game, pid, me } = ctx;
    const rooms = game.roomIds.map((room) => ({
      room,
      n: game.roomMembers(room).filter((p) => p !== pid && game.players[p].hp > 0).length,
    }));
    const foreign = rooms.filter((x) => x.room !== me.room).sort((a, b) => b.n - a.n)[0];
    const own = rooms.find((x) => x.room === me.room);
    if (foreign && foreign.n > 0) return { type: 'throwIvan', room: foreign.room };
    if (own && own.n >= 2) return { type: 'throwIvan', room: me.room };
    if (own && own.n === 1) {
      const empty = rooms.filter((x) => x.room !== me.room && x.n === 0)
        .sort((a, b) => game.roomIds.indexOf(a.room) - game.roomIds.indexOf(b.room))[0];
      if (empty) return { type: 'move', room: empty.room };
      return { type: 'throwIvan', room: me.room };
    }
    return undefined;
  },

  /**
   * 今日勇者：运势是一次性豪赌（20% 暴毙 / 20% 血1 / 40% 大幅强化）。
   * 只在血量见底（无可再输）或大乱斗前期（≥6 人，强化收益高）时抽取；其余按白板宗师打法。
   */
  'hero-today'(ctx) {
    const { game, me, st } = ctx;
    if (st.fortuneUsed !== true && (me.hp <= 1 || (game.roundNo <= 2 && game.playerIds.length >= 6))) {
      return { type: 'rollFortune' };
    }
    return vanillaExpert(ctx);
  },

  /**
   * 大贱客：被动吸引全场非精神伤害（实验 6p/10p 0 胜——活不长），
   * 主动输出是辱骂：同一目标累计 3 次即精神击杀（无视血量/距离/躲藏）。
   * 宗师打法：锁定一个目标打满三连（优先已骂 1-2 次的），残血先回满血保命。
   */
  dajianke(ctx) {
    const { game, pid, me, st, alive } = ctx;
    const candidates = alive.filter((p) => p !== pid);
    if (candidates.length === 0) return undefined;
    const insults = (st.insults ?? {}) as Record<string, number>;
    const inProgress = candidates
      .filter((p) => (insults[p] ?? 0) > 0)
      .sort((a, b) => ((insults[b] ?? 0) - (insults[a] ?? 0)) || (threatOf(ctx, b) - threatOf(ctx, a)))[0];
    // 辱骂无视距离与躲藏（attackAllRooms + ignoreHide）：全场任何存活者都可锁定
    const target = inProgress ?? candidates.sort(byThreat(ctx))[0];
    if (canHeal(ctx) && me.hp <= 1.5) return { type: 'heal' };
    return { type: 'attack', targetId: target };
  },

  /** 大屁孩：攻击 0，唯一输出是暴走被动（引擎回合前自动结算）。宗师打法：保持满血、保持不可锁定，绝不浪费行动输出 */
  dapihuai(ctx) {
    const { game, me } = ctx;
    if (canHeal(ctx)) return { type: 'heal' };
    if (game.rules.allowHide && !me.hidden) return { type: 'hide' };
    return { type: 'skip' };
  },

  /**
   * 佝偻弓箭手：实验支配端（2p 98.1%）。宗师打法微调：
   * 自燃且残血先扑灭（燃烧致死=彻底死亡，不可复原）→ 补刀（立即击杀优先于放血）
   * → 火种扩散（优先点燃未燃烧的威胁最高者）→ 全在烧则补最低血 → 同房间只剩躲藏者找出来。
   */
  'hunchback-archer'(ctx) {
    const { game, pid, me, members, alive } = ctx;
    if (game.hasStatus(pid, BURNING_KIND) && me.hp <= 1.5) return { type: 'extinguish' };
    // rangedSameRoom：同房间与跨房间都能射；rangedDamage 1 + 点燃
    const pool = [
      ...members.filter((p) => visibleOf(game, p)),
      ...alive.filter((p) => !game.isSameRoom(pid, p) && visibleOf(game, p)),
    ];
    const kill = pool.filter((p) => game.players[p].hp <= 1).sort(byThreat(ctx))[0];
    if (kill) return { type: 'attack', targetId: kill, ranged: true };
    const fresh = pool.filter((p) => !game.hasStatus(p, BURNING_KIND));
    if (fresh.length > 0) return { type: 'attack', targetId: fresh.sort(byThreat(ctx))[0], ranged: true };
    const burning = pool.sort(byHp(game))[0];
    if (burning) return { type: 'attack', targetId: burning, ranged: true };
    const hidden = members.filter((p) => !visibleOf(game, p));
    if (hidden.length > 0) return { type: 'seek', targetId: hidden.sort(byThreat(ctx))[0] };
    return undefined;
  },

  /** 鬼影：附身期间不可被锁定——附身最大威胁者持续放血；已附身则折磨宿主 */
  ghost(ctx) {
    const { game, pid, alive } = ctx;
    if (game.hasStatus(pid, 'possessing')) return { type: 'possessStrike' };
    const candidates = alive.filter((p) => p !== pid && visibleOf(game, p) && !game.hasStatus(p, POSSESSED_KIND));
    const target = candidates.sort(byThreat(ctx))[0];
    if (target) return { type: 'possess', targetId: target };
    return undefined;
  },

  /**
   * 狂猎：实验支配端（2p 94.3%）。骑乘状态机精确化：
   * 未骑乘——斩杀线内直接打（省出上马行动），否则上马；
   * 骑乘中——按当回合伤害（普通 ×2 / 最后一回合 6 伤 ×击杀加成）挑斩杀线内威胁最高者，
   * 无斩杀则压最高威胁（位移跟着目标走，天然追击）。
   */
  'wild-hunt'(ctx) {
    const { game, pid, st, members, alive } = ctx;
    const kills = typeof st.kills === 'number' ? st.kills : 0;
    const mult = Math.pow(1.5, kills);
    const reachable = (p: PlayerId) => !game.towerWallBetween(pid, p);

    if (st.mounted !== true) {
      const sameVisible = members.filter((p) => visibleOf(game, p) && reachable(p));
      const kill = sameVisible.filter((p) => game.players[p].hp <= mult).sort(byThreat(ctx))[0];
      if (kill) return { type: 'attack', targetId: kill };
      return { type: 'mount' };
    }
    const expires = typeof st.mountExpiresRound === 'number' ? st.mountExpiresRound : 0;
    const finalRound = game.roundNo >= expires;
    const dmg = (finalRound ? 6 : 2) * mult;
    const pool = alive.filter((p) => visibleOf(game, p) && reachable(p));
    const kill = pool.filter((p) => game.players[p].hp <= dmg).sort(byThreat(ctx))[0];
    if (kill) return { type: 'attack', targetId: kill };
    if (pool.length > 0) return { type: 'attack', targetId: pool.sort(byThreat(ctx))[0] };
    return undefined;
  },

  /**
   * 飞天水螅：塔是攻防一体的核心（塔内判定输=敌人自己打自己）。
   * 没塔先造塔；塔成/亡魂后持续把敌人吸向自己——先吸同房间塔外者（下一吸直接进塔），
   * 再吸异房间者；同房间者按「血量最低、攻击最高」排序（自刀快、自刀疼）；塔残血告急把塔内敌人吹出去保塔。
   */
  'water-snake'(ctx) {
    const { game, pid, st, alive } = ctx;
    const snake = st as unknown as WaterSnakeState;
    const visiblePool = alive.filter((p) => visibleOf(game, p));

    if (snake.towerBaseRoom != null || snake.posthumous === true) {
      const myRoom = game.players[pid].room;
      const outsideSameRoom = visiblePool.filter((p) => game.players[p].room === myRoom
        && game.players[p].char.inTower !== true);
      const crossRoom = visiblePool.filter((p) => game.players[p].room !== myRoom);
      const pool = outsideSameRoom.length > 0 ? outsideSameRoom : crossRoom;
      if (pool.length > 0) {
        const target = [...pool].sort((a, b) => (game.players[a].hp - game.players[b].hp)
          || (attackOf(ctx, b) - attackOf(ctx, a)))[0];
        return { type: 'inhale', targetId: target };
      }
      // 塔残血告急且塔内还有敌人（塔内外都能打塔）→ 吹出去保塔
      const towerHp = typeof snake.towerHp === 'number' ? snake.towerHp : 0;
      const insider = visiblePool.find((p) => game.players[p].char.inTower === true);
      if (insider && towerHp <= 3) {
        const destination = game.roomIds.find((r) => r !== myRoom);
        if (destination) return { type: 'blow', targetId: insider, room: destination };
      }
      return undefined;
    }
    // 没塔：先造塔（2 次行动，塔壁先吸收伤害）
    return { type: 'buildTower' };
  },

  /**
   * 老虎机侠：经济/抽奖引擎已有基础策略（slotHeroAi）。
   * 宗师升级：持有钥匙时优先封印全场威胁最高者的核心技能（基础行动不值得浪费钥匙）。
   */
  'slot-hero'(ctx) {
    const s = ctx.st as unknown as SlotState;
    if (s.keys > 0) {
      const seal = bestSeal(ctx);
      if (seal) return seal;
    }
    return slotHeroAi(ctx);
  },
};

/** 角色数守卫用的清单（测试断言注册表覆盖全部在册角色） */
export const EXPERT_REGISTRY_IDS = Object.keys(characterExpertAi).sort();
