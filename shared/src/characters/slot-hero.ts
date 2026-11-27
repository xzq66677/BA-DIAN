/**
 * 老虎机侠（Issue #72）
 *
 * 规则（2026-11-27 作者口述定案）：
 *  - 初始 4 血 / 0 攻击 / 5 块钱（货币只有本角色拥有）；攻击为近战。
 *  - 抽奖：5 块抽 4 格，1 块抽 3 格，消耗一次行动。老虎机随身携带，随时可抽；
 *    扔出（余额归零时的唯一能力，仅一次）后必须先与老虎机同房间才能继续抽。
 *  - 数字 → 符号：`0` 钥匙、`1–3` 金钱、`4–7` 炸弹、`8–9` 攻击。
 *  - 奖励按**本次**同种符号个数结算：
 *      金钱 2/3/4 → +2 / +6 / +9999 块
 *      攻击 2/3/4 → 攻击力永久 +1 / +3 / +999999
 *      炸弹 2/3/4 → 手持小炸弹（3 伤）/ 手持大伊万（999999 伤）/ 永久解锁「指定房间 999999」
 *      钥匙 2/3/4 → 1 把 / 3 把 / 场上其他人全部「废人弱」
 *  - 炸弹：抽出后第 3 个回合末（平局也计时）在持有者所在房间 AOE 爆炸，会自伤；
 *    可消耗行动扔到任意房间（引信不重置）；被淘汰时掉在死亡房间继续倒计时。
 *  - 钥匙：消耗一把钥匙 + 一次行动，永久封印任意一人一个**除攻击之外**的行动（任意距离、无视躲藏）。
 *  - 废人弱：被动，初次判定（rps1）判负当回合立即自爆淘汰（复用大屁孩的回合前结算）。
 *  - 扔机：余额归零后才能扔（仅一次），第 3 回合末落地，对房内所有人造成「累计投入金额」伤害；
 *    落地后与之同房间可踹一脚 +1 块（消耗行动）。
 */

import type { CharActionContext, CharActionDef, CharDef, CharacterAiContext } from '../chardef.js';
import type { ActionRequest, ActionResult, DamageRequest, DeferredEvent, PlayerId, RoomId } from '../types.js';
import { fmtNum } from '../types.js';
import { sealAction, sealableActions, sealedAction } from '../effects.js';
import { registerDeferredKind } from '../deferred-registry.js';
import { addStatus, hasStatus, registerStatusJudgeHandler, statusesOf } from '../player-statuses.js';

export const SLOT_CHAR_ID = 'slot-hero';

/** 抽奖花费（按格数） */
const SPIN_COST = { 3: 1, 4: 5 } as const;
/** 引信：抽出/扔出后第 3 个回合末（平局也计时） */
const FUSE_ROUNDS = 3;
const SMALL_BOMB_DAMAGE = 3;
/** 必死伤害（与既有大伊万同一量纲，作者确认用 999999） */
const IVAN_DAMAGE = 999999;
const MONEY_REWARD: Record<number, number> = { 2: 2, 3: 6, 4: 9999 };
const ATTACK_REWARD: Record<number, number> = { 2: 1, 3: 3, 4: 999999 };
const KEY_REWARD: Record<number, number> = { 2: 1, 3: 3 };

export type SlotSymbol = 'key' | 'money' | 'bomb' | 'attack';

export function slotSymbolOf(digit: number): SlotSymbol {
  if (digit === 0) return 'key';
  if (digit <= 3) return 'money';
  if (digit <= 7) return 'bomb';
  return 'attack';
}

export interface SlotBomb {
  id: string;
  kind: 'small' | 'ivan';
  /** 应爆炸的回合号 */
  at: number;
  /** 所在房间；null = 跟随持有者（手持） */
  room: RoomId | null;
}

export interface SlotState {
  money: number;
  /** 最近一次卷面（演出用，公开） */
  reels: number[] | null;
  attackBonus: number;
  keys: number;
  /** 4 炸弹解锁：永久可用的「指定房间 999999」 */
  bigIvan: boolean;
  bombs: SlotBomb[];
  bombSeq: number;
  machine: {
    /** 扔出后落点房间 */
    room: RoomId | null;
    thrown: boolean;
    landed: boolean;
    /** 落地回合 */
    at: number | null;
    /** 累计投入金额（落地伤害） */
    invested: number;
  };
}

function st(game: CharActionContext['game'], pid: PlayerId): SlotState {
  return game.charState(pid) as unknown as SlotState;
}

const BOMB_DAMAGE: Record<SlotBomb['kind'], number> = {
  small: SMALL_BOMB_DAMAGE,
  ivan: IVAN_DAMAGE,
};

/** 房间 AOE 伤害（含躲藏/隐身、可命中自己；不触发太极类反弹，与大伊万一致） */
function roomBlast(
  ctx: { game: CharActionContext['game'] },
  room: RoomId,
  amount: number,
  source: PlayerId | undefined,
  tag: string,
  label: string,
): void {
  const game = ctx.game;
  const gid = game.nextGroupId();
  const members = game.roomMembers(room);
  game.log('deferred', `${label}：${room} 内成员 ${members.length ? members.map((pid) => game.getPlayer(pid).name).join('、') : '（无）'}`, { room, source: source ?? null }, true);
  for (const pid of members) {
    const req: DamageRequest = {
      target: pid,
      amount,
      dtype: 'special',
      aoe: true,
      noReflect: true,
      tag,
      groupId: gid,
      ...(source ? { source } : {}),
    };
    game.applyDamage(req);
  }
}

// ─── 抽奖 ────────────────────────────────────────────────────

function canSpinHere(game: CharActionContext['game'], pid: PlayerId): string | null {
  const s = st(game, pid);
  if (!s.machine.thrown) return null;
  if (!s.machine.landed) return '老虎机正在坠落中，落地后才能再抽';
  const room = game.getPlayer(pid).room;
  if (room !== s.machine.room) return `必须和老虎机同房间才能抽奖（它在 ${s.machine.room}）`;
  return null;
}

function validateSpin(ctx: CharActionContext, count: 3 | 4): string | null {
  const s = st(ctx.game, ctx.actor);
  const cost = SPIN_COST[count];
  if (s.money < cost) return `钱不够：抽 ${count} 格需要 ${cost} 块（当前 ${fmtNum(s.money)} 块）`;
  return canSpinHere(ctx.game, ctx.actor);
}

function drawBombs(
  game: CharActionContext['game'],
  actor: PlayerId,
  count: number,
): { presentation: Record<string, unknown> } {
  const s = st(game, actor);
  const digits: number[] = [];
  for (let i = 0; i < count; i++) digits.push(game.rng.int(10));
  s.reels = digits;

  const tally: Record<SlotSymbol, number> = { key: 0, money: 0, bomb: 0, attack: 0 };
  for (const d of digits) tally[slotSymbolOf(d)]++;
  const name = game.getPlayer(actor).name;
  const detail: string[] = [];

  // 金钱
  if (tally.money >= 2) {
    const gain = MONEY_REWARD[Math.min(tally.money, 4)];
    s.money += gain;
    detail.push(`${tally.money} 金钱 → +${gain} 块`);
  }
  // 攻击
  if (tally.attack >= 2) {
    const gain = ATTACK_REWARD[Math.min(tally.attack, 4)];
    s.attackBonus += gain;
    detail.push(`${tally.attack} 攻击 → 攻击力 +${gain}`);
  }
  // 钥匙
  if (tally.key === 4) {
    const others = game.aliveIds().filter((pid) => pid !== actor);
    for (const pid of others) {
      const applied = addStatus(game, pid, { kind: 'crippled', label: '废人弱', source: actor });
      if (applied) {
        game.log('trigger', `🔑 ${name} 抽出四把钥匙：${game.getPlayer(pid).name} 变成「废人弱」（每回合判定输即自爆）`, { pid, crippled: true }, true);
      }
    }
    detail.push('4 钥匙 → 场上其他人全部「废人弱」');
  } else if (tally.key >= 2) {
    const gain = KEY_REWARD[tally.key];
    s.keys += gain;
    detail.push(`${tally.key} 钥匙 → +${gain} 把钥匙`);
  }
  // 炸弹
  if (tally.bomb === 4) {
    s.bigIvan = true;
    detail.push('4 炸弹 → 永久获得「指定房间 999999」能力');
  } else if (tally.bomb >= 2) {
    const kind: SlotBomb['kind'] = tally.bomb === 3 ? 'ivan' : 'small';
    const bomb: SlotBomb = {
      id: `slot-bomb-${++s.bombSeq}`,
      kind,
      at: game.roundNo + FUSE_ROUNDS,
      room: null,
    };
    s.bombs.push(bomb);
    game.addDeferred({
      kind: 'slot-hero-bomb',
      room: game.getPlayer(actor).room,
      explodeRound: bomb.at,
      source: actor,
      createdAtRound: game.roundNo,
      payload: { owner: actor, bombId: bomb.id },
    });
    detail.push(`${tally.bomb} 炸弹 → 手持${kind === 'ivan' ? '大伊万' : '小炸弹'}（第 ${bomb.at} 回合末爆炸）`);
  }

  game.log(
    'trigger',
    `🎰 ${name} 抽取老虎机（${count} 格，花费 ${SPIN_COST[count as 3 | 4]} 块）：${digits.join(' · ')}${detail.length ? `　→　${detail.join('；')}` : '　→　无奖励'}`,
    { pid: actor, slot: true, reels: digits, reelCount: count, rewards: detail },
    true,
  );
  return { presentation: { reels: digits, reelCount: count } };
}

function spinAction(count: 3 | 4): CharActionDef {
  return {
    name: count === 3 ? 'slotSpin3' : 'slotSpin4',
    label: count === 3 ? '抽老虎机（3 格）' : '抽老虎机（4 格）',
    desc: `花 ${SPIN_COST[count]} 块钱抽 ${count} 个数值。符号：0 钥匙、1–3 金钱、4–7 炸弹、8–9 攻击；同种符号 2/3/4 个触发奖励。`,
    targetHint: 'none',
    validate: (ctx) => validateSpin(ctx, count),
    execute: (ctx) => {
      const s = st(ctx.game, ctx.actor);
      s.money -= SPIN_COST[count];
      if (!s.machine.thrown) s.machine.invested += SPIN_COST[count];
      return drawBombs(ctx.game, ctx.actor, count);
    },
  };
}

// ─── 炸弹投掷 ────────────────────────────────────────────────

function throwBombAction(kind: SlotBomb['kind']): CharActionDef {
  const label = kind === 'ivan' ? '扔大伊万' : '扔小炸弹';
  return {
    name: kind === 'ivan' ? 'slotThrowIvan' : 'slotThrowSmall',
    label,
    desc: `把手中的${kind === 'ivan' ? '大伊万（999999 伤）' : '小炸弹（3 伤）'}丢到任意房间，引信不重置。`,
    roomHint: true,
    validate: (ctx) => {
      const s = st(ctx.game, ctx.actor);
      if (!s.bombs.some((b) => b.kind === kind)) return `手里没有${kind === 'ivan' ? '大伊万' : '小炸弹'}`;
      const room = ctx.params.room;
      if (!room || !ctx.game.roomIds.includes(room)) return `非法目标房间：${room}`;
      return null;
    },
    execute: (ctx) => {
      const s = st(ctx.game, ctx.actor);
      const bomb = s.bombs.find((b) => b.kind === kind)!;
      const room = ctx.params.room!;
      bomb.room = room; // 引信不重置
      ctx.game.log('deferred', `💣 ${ctx.game.getPlayer(ctx.actor).name} 把${kind === 'ivan' ? '大伊万' : '小炸弹'}扔到 ${room}（第 ${bomb.at} 回合末爆炸）`, { pid: ctx.actor, room }, true);
    },
  };
}

// ─── 钥匙 ────────────────────────────────────────────────────

/** 从行动参数里取要封印的行动名 */
function sealedNameOf(req: ActionRequest): string | undefined {
  const p = req.params as { action?: unknown } | undefined;
  return typeof p?.action === 'string' ? p.action : undefined;
}

// ─── 角色定义 ────────────────────────────────────────────────

const slotHero: CharDef = {
  id: SLOT_CHAR_ID,
  name: '老虎机侠',
  desc: '血量4攻击0。初始 5 块钱（唯一持有货币的角色）。消耗一次行动抽老虎机：5 块抽 4 格 / 1 块抽 3 格；数字 → 0 钥匙、1–3 金钱、4–7 炸弹、8–9 攻击，同种符号 2/3/4 个触发奖励（钱 / 攻击力 / 炸弹 / 钥匙，四钥匙让场上其他人「废人弱」）。钥匙可封印任意一人除攻击外的一个行动；炸弹手持，第 3 回合末在所在房间爆炸（会自伤）；钱花光后可扔出老虎机（仅一次），第 3 回合末落地砸出累计投入的伤害，之后同房间可踹机 +1 块。',
  hp: 4,
  attack: 0,
  attackType: 'melee',
  aiStrategy: (ctx) => slotHeroAi(ctx),
  init: (): Record<string, unknown> => ({
    money: 5,
    reels: null,
    attackBonus: 0,
    keys: 0,
    bigIvan: false,
    bombs: [],
    bombSeq: 0,
    machine: { room: null, thrown: false, landed: false, at: null, invested: 0 },
  }) as unknown as Record<string, unknown>,

  /** 攻击力 = 基础 0 + 抽奖加成（永久） */
  dynamicDamage: ({ game, actor }) => st(game, actor).attackBonus,

  /** 被淘汰时：手持炸弹掉在死亡房间，继续倒计时 */
  onDeath: (ctx) => {
    const { game, player } = ctx;
    const s = st(game, player);
    const room = game.getPlayer(player).room;
    let dropped = false;
    for (const b of s.bombs) {
      if (b.room === null) { b.room = room; dropped = true; }
    }
    if (dropped) game.log('deferred', `💣 ${game.getPlayer(player).name} 倒下，手持炸弹掉在 ${room} 继续倒计时`, { pid: player, room }, true);
  },

  actions: [
    spinAction(3),
    spinAction(4),
    {
      name: 'slotKey',
      label: '使用钥匙（封印）',
      desc: '消耗一把钥匙，永久封印任意一人一个「除攻击之外」的行动（任意距离、无视躲藏）。',
      targetHint: 'anyPlayer',
      validate: (ctx) => {
        const s = st(ctx.game, ctx.actor);
        if (s.keys <= 0) return '没有钥匙（抽奖出现 2 个及以上钥匙符号可获得）';
        const t = ctx.params.targetId;
        if (!t || !ctx.game.players[t]) return '目标不存在';
        if (!ctx.game.players[t].alive) return '目标已淘汰';
        if (t === ctx.actor) return '不能对自己使用（封印自己）';
        const action = sealedNameOf(ctx.params);
        if (!action) return '请选择要封印的行动';
        const list = sealableActions(ctx.game, t);
        if (!list.some((a) => a.action === action)) return '该行动无法被封印';
        if (sealedAction(ctx.game, t, action)) return `「${list.find((a) => a.action === action)?.label}」已经被封印`;
        return null;
      },
      execute: (ctx) => {
        const s = st(ctx.game, ctx.actor);
        const t = ctx.params.targetId!;
        const action = sealedNameOf(ctx.params)!;
        const label = sealableActions(ctx.game, t).find((a) => a.action === action)?.label ?? action;
        const res: ActionResult = sealAction(ctx.game, t, action, ctx.actor);
        if (!res.ok) return;
        s.keys -= 1;
        ctx.game.log('trigger', `🔒 ${ctx.game.getPlayer(ctx.actor).name} 用钥匙封印了 ${ctx.game.getPlayer(t).name} 的「${label}」（剩余钥匙 ${s.keys}）`, { pid: ctx.actor, target: t, sealed: action }, true);
      },
    },
    throwBombAction('small'),
    throwBombAction('ivan'),
    {
      name: 'slotBigIvan',
      label: '特殊大伊万（4 炸弹）',
      desc: '永久能力：消耗一次行动，指定任意房间立刻产生 999999 伤害的 AOE 爆炸（会炸到自己）。',
      roomHint: true,
      validate: (ctx) => {
        const s = st(ctx.game, ctx.actor);
        if (!s.bigIvan) return '尚未获得该能力（抽奖出现 4 个炸弹符号解锁）';
        const room = ctx.params.room;
        if (!room || !ctx.game.roomIds.includes(room)) return `非法目标房间：${room}`;
        return null;
      },
      execute: (ctx) => {
        const room = ctx.params.room!;
        ctx.game.log('trigger', `💥 ${ctx.game.getPlayer(ctx.actor).name} 发动特殊大伊万：指定 ${room}！`, { pid: ctx.actor, room }, true);
        roomBlast(ctx, room, IVAN_DAMAGE, ctx.actor, 'slot-ivan', '💥 特殊大伊万爆炸');
      },
    },
    {
      name: 'slotThrowMachine',
      label: '扔出老虎机（余额归零后·仅一次）',
      desc: '把钱花光后才能使用（仅一次）：把老虎机扔到任意房间，第 3 回合末落地，对该房间所有人造成「累计投入金额」的伤害。落地后可与之同房间踹机 +1 块。',
      roomHint: true,
      validate: (ctx) => {
        const s = st(ctx.game, ctx.actor);
        if (s.machine.thrown) return '老虎机已经扔出去了（仅一次）';
        if (s.money > 0) return `余额需归零才能扔出老虎机（当前 ${fmtNum(s.money)} 块）`;
        const room = ctx.params.room;
        if (!room || !ctx.game.roomIds.includes(room)) return `非法目标房间：${room}`;
        return null;
      },
      execute: (ctx) => {
        const s = st(ctx.game, ctx.actor);
        const room = ctx.params.room!;
        const at = ctx.game.roundNo + FUSE_ROUNDS;
        s.machine.thrown = true;
        s.machine.room = room;
        s.machine.at = at;
        s.machine.landed = false;
        ctx.game.addDeferred({
          kind: 'slot-hero-machine',
          room,
          explodeRound: at,
          source: ctx.actor,
          createdAtRound: ctx.game.roundNo,
          payload: { owner: ctx.actor, room, damage: s.machine.invested },
        });
        ctx.game.log('deferred', `🎰 ${ctx.game.getPlayer(ctx.actor).name} 扔出老虎机，飞向 ${room}：第 ${at} 回合末落地（投入 ${fmtNum(s.machine.invested)} 块 → 落地伤害）`, { pid: ctx.actor, room, explodeRound: at }, true);
      },
    },
    {
      name: 'slotKick',
      label: '踹老虎机（+1 块）',
      desc: '老虎机落地后，与之同房间时踹一脚获得 1 块钱（消耗一次行动）。',
      targetHint: 'none',
      validate: (ctx) => {
        const s = st(ctx.game, ctx.actor);
        if (!s.machine.landed) return '老虎机还没有落地';
        if (ctx.game.getPlayer(ctx.actor).room !== s.machine.room) return `需要和老虎机同房间（它在 ${s.machine.room}）`;
        return null;
      },
      execute: (ctx) => {
        const s = st(ctx.game, ctx.actor);
        s.money += 1;
        ctx.game.log('action', `🦵 ${ctx.game.getPlayer(ctx.actor).name} 踹了老虎机一脚，掉出 1 块钱（当前 ${fmtNum(s.money)} 块）`, { pid: ctx.actor, money: s.money }, true);
      },
    },
  ],
};

// ─── 状态行为 ────────────────────────────────────────────────

/**
 * 「废人弱」：初次判定（rps1）判负 → 当回合立即自爆。
 * 通过状态处理器注册，因此**任何角色**中了废人弱都生效（不只是老虎机侠）。
 */
registerStatusJudgeHandler('crippled', (game, pid, ctx) => {
  if (ctx.stage !== 'rps1' || ctx.step !== 'lose') return;
  if (!hasStatus(game, pid, 'crippled')) return;
  if (!game.players[pid]?.alive) return;
  const holder = game.charState(pid) as { pendingTrigger?: 'selfdestruct' | null };
  if (holder.pendingTrigger) return;
  holder.pendingTrigger = 'selfdestruct';
  game.log('trigger', `💥 ${game.getPlayer(pid).name} 处于「废人弱」且本回合判定输 → 立即自爆！`, { pid, trigger: 'selfdestruct' }, true);
});

// ─── 延迟事件 ────────────────────────────────────────────────

/** 手持/已扔出的炸弹在引信回合末爆炸 */
registerDeferredKind('slot-hero-bomb', (game, ev: DeferredEvent) => {
  const payload = (ev.payload ?? {}) as { owner?: PlayerId; bombId?: string };
  const owner = payload.owner;
  if (!owner || !game.players[owner]) return;
  const s = st(game as unknown as CharActionContext['game'], owner);
  const idx = s.bombs.findIndex((b) => b.id === payload.bombId);
  if (idx < 0) return;
  const bomb = s.bombs[idx];
  if (bomb.at > game.roundNo) return; // 未到期（防御性）
  s.bombs.splice(idx, 1);
  // 手持 → 持有者当前房间；已扔出 / 持有者阵亡 → 记录的房间
  const room = bomb.room ?? game.getPlayer(owner).room;
  roomBlast({ game: game as unknown as CharActionContext['game'] }, room, BOMB_DAMAGE[bomb.kind], owner, `slot-${bomb.kind}`,
    `💣 ${bomb.kind === 'ivan' ? '大伊万' : '小炸弹'}在 ${room} 爆炸`);
}, 2);

/** 老虎机落地：对房内所有人生效「累计投入」伤害，并标记可踹/可抽 */
registerDeferredKind('slot-hero-machine', (game, ev: DeferredEvent) => {
  const payload = (ev.payload ?? {}) as { owner?: PlayerId; room?: RoomId; damage?: number };
  const owner = payload.owner;
  const room = payload.room ?? ev.room;
  if (!owner || !game.players[owner]) return;
  const s = st(game as unknown as CharActionContext['game'], owner);
  s.machine.landed = true;
  s.machine.at = null;
  game.log('deferred', `🎰 老虎机砸落在 ${room}！`, { room, source: owner, pid: owner, fx: 'slotDrop', presentation: { reelCount: 4 } }, true);
  roomBlast({ game: game as unknown as CharActionContext['game'] }, room, Math.max(0, payload.damage ?? 0), owner, 'slot-machine', `🎰 老虎机落地冲击（伤害 ${fmtNum(Math.max(0, payload.damage ?? 0))}）`);
}, 2);

export const slotHeroChar = slotHero;

/** AI：先抽四次，手里有炸弹就扔，钱不够就 3 格，没钱就扔机/踹机 */
export function slotHeroAi(ctx: CharacterAiContext): ActionRequest | undefined {
  const s = ctx.st as unknown as SlotState;
  const me = ctx.me;
  const busyRoom = () =>
    ctx.game.roomIds
      .map((room) => ({ room, count: ctx.game.roomMembers(room).filter((p) => p !== ctx.pid).length }))
      .sort((a, b) => b.count - a.count)[0];

  const canSpin = !s.machine.thrown || (s.machine.landed && me.room === s.machine.room);
  if (canSpin && s.money >= SPIN_COST[4]) return { type: 'slotSpin4' };
  const bomb = s.bombs[0];
  if (bomb) {
    const best = busyRoom();
    if (best) return { type: bomb.kind === 'ivan' ? 'slotThrowIvan' : 'slotThrowSmall', room: best.room };
  }
  if (canSpin && s.money >= SPIN_COST[3]) return { type: 'slotSpin3' };
  if (s.bigIvan) {
    const best = busyRoom();
    if (best && best.count > 0) return { type: 'slotBigIvan', room: best.room };
  }
  if (s.machine.landed && s.machine.room) {
    // 落地后：同房间踹机换钱，不同房间先走过去（否则 0 攻击会僵持到天荒地老）
    return me.room === s.machine.room ? { type: 'slotKick' } : { type: 'move', room: s.machine.room };
  }
  if (!s.machine.thrown && s.money <= 0) {
    const best = busyRoom();
    if (best) return { type: 'slotThrowMachine', room: best.room };
  }
  if (s.keys > 0) return undefined; // 钥匙留给服务器通用策略（默认跳过）
  return undefined;
}
