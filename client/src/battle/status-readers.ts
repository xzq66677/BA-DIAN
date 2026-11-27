import type { SnapPlayer } from '../../../shared/src/protocol.js';
import { slotMachineRoomLabel, slotMachineState } from './slot-machine-state.js';
import {
  type StatusTone,
  formatHp,
  type PlayerStatusContext,
  type PlayerStatusItem,
  type PlayerStatusReader,
} from './status-types.js';

const readLife: PlayerStatusReader = (p) => [{
  key: 'alive',
  icon: p.alive ? '💚' : '💀',
  label: '生命状态',
  value: p.alive ? '存活' : '已淘汰',
  detail: p.alive ? `生命 ${formatHp(p.hp)}/${formatHp(p.maxHp)}，位于房间 ${p.room}` : `生命归零，保留在房间 ${p.room}`,
  tone: p.alive ? 'good' : 'bad',
}];

const readStealth: PlayerStatusReader = (p) => {
  if (!p.alive) return [];
  const items: PlayerStatusItem[] = [];
  if (p.hidden) items.push({
    key: 'hidden', icon: '🙈', label: '躲藏', value: '生效中',
    detail: '指向性攻击无法锁定；范围效果与无视躲藏的攻击仍可命中。', tone: 'warn',
  });
  if (p.invisible) items.push({
    key: 'invisible', icon: '👻', label: '隐身', value: '生效中',
    detail: '当前无法被指向性行动选中。', tone: 'warn',
  });
  return items;
};

const readDomain: PlayerStatusReader = (p) => {
  if (!p.alive) return [];
  const items: PlayerStatusItem[] = [];
  if (p.char.domain === true) items.push({
    key: 'domain', icon: '✨', label: '领域', value: '生效中',
    detail: '平局回合可行动（平局结果不变）；老大爷领域内近战 5 伤、远程 3 伤。后展开的领域会覆盖先展开的领域。', tone: 'good',
  });
  if (typeof p.char.livesLeft === 'number' && p.char.livesLeft > 1) items.push({
    key: 'lives', icon: '💫', label: '复活次数', value: `剩余 ${p.char.livesLeft} 条`,
    detail: '首次致死时消耗一条命并满血复活。', tone: 'good',
  });
  return items;
};

const readCharacter: PlayerStatusReader = (p, context) => {
  const items: PlayerStatusItem[] = [];
  if (p.alive && typeof p.char.aim === 'string' && p.char.aim) {
    const target = context.players.find((other) => other.id === p.char.aim);
    items.push({
      key: 'aim', icon: '🎯', label: '瞄准', value: target?.name ?? '已锁定目标',
      detail: '远程攻击将消耗这次瞄准。', tone: 'good',
    });
  }
  if (typeof p.char.stickDrawn === 'boolean') items.push({
    key: 'stick', icon: '🥢', label: '拔棍', value: p.char.stickDrawn ? '已拔出' : '未拔出',
    detail: p.char.stickDrawn ? '攻击无视躲藏与隐身。' : '需先拔棍才能造成伤害。', tone: p.char.stickDrawn ? 'good' : 'neutral',
  });
  if (typeof p.char.attackOverride === 'number') items.push({
    key: 'attack-override', icon: '⚔', label: '攻击变化', value: `攻击力 ${formatHp(p.char.attackOverride)}`,
    detail: '当前快照中的攻击力覆盖值。', tone: p.char.attackOverride > 1 ? 'good' : 'neutral',
  });
  if (p.char.fortuneUsed === true) items.push({
    key: 'fortune', icon: '🔮', label: '今日运势', value: '本局已使用',
    detail: '抽取运势技能本局不可再次使用。', tone: 'neutral',
  });
  if (typeof p.char.taijiAuto === 'boolean') items.push({
    key: 'taiji', icon: '🛡', label: '混元形意太极', value: p.char.taijiAuto ? '自动反弹开启' : '自动反弹关闭',
    detail: p.char.taijiAuto ? '受到可判定伤害时自动进行太极判定。' : '当前不再自动触发太极反弹判定。', tone: p.char.taijiAuto ? 'good' : 'warn',
  });
  // 飞天水螅 / 高塔：塔内外隔绝、造塔进度、亡魂
  if (typeof p.char.towerBaseRoom === 'string' && p.char.towerBaseRoom) {
    const hp = typeof p.char.towerHp === 'number' ? p.char.towerHp : 0;
    items.push({
      key: 'tower-built', icon: '🗼', label: '高塔', value: `建于 ${p.char.towerBaseRoom}（${hp}/6 血）`,
      detail: '塔内外算作两个房间（隔绝）；高塔吸收所在房间的房间级伤害，塔内玩家不受该次效果伤害；同房间玩家都可攻击高塔，耐久归零会坍塌。', tone: 'neutral',
    });
  }
  if (typeof p.char.buildProgress === 'number' && p.char.buildProgress === 1) items.push({
    key: 'tower-building', icon: '🧱', label: '造塔中', value: '1/2',
    detail: '再消耗一次行动即可建成玄武岩高塔。', tone: 'neutral',
  });
  if (p.char.inTower === true) items.push({
    key: 'tower-inside', icon: '🗼', label: '塔内', value: '隔绝中',
    detail: '高塔内外隔绝：无法被外部锁定，房间级伤害由高塔吸收；可用吸/吹进出。', tone: 'warn',
  });
  if (p.char.posthumous === true) items.push({
    key: 'posthumous', icon: '👻', label: '亡魂', value: '不可被攻击',
    detail: '死后仍参与猜拳，只能使用吸/吹（或跳过）。', tone: 'bad',
  });
  return items;
};

/**
 * 公开状态效果（`PlayerState.effects`）：按 kind 白名单读取。
 * 新增状态时只需在此登记读取器，无需修改血条/弹窗组件。
 */
const readStatusEffects: PlayerStatusReader = (p, context) => {
  if (!p.alive) return [];
  const items: PlayerStatusItem[] = [];
  for (const effect of p.effects ?? []) {
    const source = effect.source ? context.players.find((other) => other.id === effect.source) : undefined;
    if (effect.kind === 'burning') {
      items.push({
        key: 'status-burning',
        icon: '🔥',
        label: '燃烧',
        value: `每回合 ${formatHp(effect.severity ?? 0.5)} 伤害`,
        detail: `无限持续，直到消耗一次行动扑灭；被点燃与扑灭的当回合不结算（平局回合同样结算）${source ? `；来源：${source.name}` : ''}。`,
        tone: 'bad',
      });
      continue;
    }
    if (effect.kind === 'possessed') {
      items.push({
        key: 'status-possessed',
        icon: '👻',
        label: '被附身',
        value: `每回合 ${formatHp(effect.severity ?? 1)} 伤害`,
        detail: `附身当回合与驱赶当回合不结算（平局回合同样结算）；可消耗一次行动「驱逐鬼影」${source ? `；来源：${source.name}` : ''}。`,
        tone: 'bad',
      });
      continue;
    }
    if (effect.kind === 'possessing') {
      const host = context.players.find(player => player.id === p.char.possessing);
      items.push({
        key: 'status-possessing',
        icon: '🌫',
        label: '附身中',
        value: '无法被锁定',
        detail: `${host ? `随宿主 ${host.name} 移动。` : '随宿主移动。'}附身中无法普攻，可折磨、操控宿主或主动脱离。`,
        tone: 'good',
      });
      continue;
    }
    if (effect.kind === 'mounted') {
      const left = typeof effect.remainingRounds === 'number' ? effect.remainingRounds : undefined;
      items.push({
        key: 'status-mounted',
        icon: '🐎',
        label: '骑乘中',
        value: left ? `剩余 ${left} 回合` : '攻击强化',
        detail: '攻击无视距离并带位移、伤害×2；骑乘最后一回合攻击变为 6 伤单体。',
        tone: 'good',
      });
      continue;
    }
    // 未知状态安全忽略
  }
  return items;
};

const readInsults: PlayerStatusReader = (p, context) => {
  if (!p.char.insults || typeof p.char.insults !== 'object') return [];
  const items: PlayerStatusItem[] = [];
  for (const [targetId, count] of Object.entries(p.char.insults as Record<string, unknown>)) {
    if (typeof count !== 'number' || count <= 0) continue;
    const target = context.players.find((other) => other.id === targetId);
    items.push({
      key: `insult-${targetId}`, icon: '🗯', label: `辱骂 · ${target?.name ?? '目标'}`,
      value: `${count}/3 次`, detail: '同一目标累计三次辱骂会被精神攻击淘汰。', tone: 'warn',
    });
  }
  return items;
};

/** 老虎机侠：货币 / 钥匙 / 炸弹 / 老虎机状态（快照 char 中为公开数据） */
const readSlotHero: PlayerStatusReader = (p) => {
  if (!p.alive || p.charId !== 'slot-hero') return [];
  const c = p.char as Record<string, unknown>;
  if (typeof c.money !== 'number') return [];
  const items: PlayerStatusItem[] = [];
  items.push({
    key: 'slot-money', icon: '🪙', label: '余额', value: `${formatHp(c.money)} 块`, inventory: true,
    detail: '抽老虎机花费：3 格 1 块、4 格 5 块。钱花光后才能扔出老虎机。', tone: 'neutral',
  });
  if (typeof c.attackBonus === 'number' && c.attackBonus > 0) items.push({
    key: 'slot-attack', icon: '⚔', label: '攻击加成', value: `+${formatHp(c.attackBonus)}`, inventory: true,
    detail: '抽奖出现 2/3/4 个攻击符号的永久加成。', tone: 'good',
  });
  if (typeof c.keys === 'number') items.push({
    key: 'slot-keys', icon: '🔑', label: '钥匙', value: `${formatHp(c.keys)} 把`, inventory: true,
    detail: '消耗一把钥匙 + 一次行动，永久封印任意一人一个除攻击外的行动。', tone: c.keys > 0 ? 'good' : 'neutral',
  });
  const bombs = Array.isArray(c.bombs) ? c.bombs as { id?: string; kind: string; at: number; room: string | null }[] : [];
  for (const [index, b] of bombs.entries()) {
    if (!b || (b.kind !== 'ivan' && b.kind !== 'small') || typeof b.at !== 'number') continue;
    const name = b.kind === 'ivan' ? '大伊万' : '小炸弹';
    items.push({
      key: `slot-bomb-${b.id ?? `${b.at}-${index}`}`, icon: '💣', label: b.room ? `已投掷${name}` : `手持${name}`, inventory: !b.room,
      value: `第 ${b.at} 回合末`, detail: b.room ? `已扔到 ${b.room}，引信不重置。` : '在持有者所在房间爆炸（会自伤）。', tone: 'bad',
    });
  }
  if (c.bigIvan === true) items.push({
    key: 'slot-bigivan', icon: '💥', label: '特殊大伊万', value: '已解锁', inventory: true,
    detail: '消耗一次行动，指定任意房间立刻产生 999999 伤害的 AOE。', tone: 'good',
  });
  const machine = slotMachineState(p);
  if (machine) items.push({
    key: 'slot-machine', icon: '🎰', label: '老虎机',
    value: `${machine.room} · ${machine.landed ? '已落地' : '飞行中'}`, inventory: true,
    detail: machine.landed
      ? `${typeof machine.invested === 'number' ? `落地伤害 ${formatHp(machine.invested)}。` : ''}同房间可踹一脚 +1 块，也可继续抽奖。`
      : slotMachineRoomLabel(machine),
    tone: machine.landed ? 'neutral' : 'warn',
  });
  return items;
};

/** 通用状态与行动封印（不绑定具体角色，任何角色中了都会显示） */
const GENERIC_STATUS_PRESENTATION: Record<string, { icon: string; detail: string; tone: StatusTone }> = {
  crippled: {
    icon: '💀',
    detail: '「废人弱」：每回合初次判定输掉即当场自爆淘汰。',
    tone: 'bad',
  },
};

const readGenericStatuses: PlayerStatusReader = (p) => {
  if (!p.alive) return [];
  const items: PlayerStatusItem[] = [];
  for (const s of p.statuses ?? []) {
    const known = GENERIC_STATUS_PRESENTATION[s.kind];
    items.push({
      key: `status-${s.kind}`,
      icon: known?.icon ?? '🔹',
      label: s.label ?? s.kind,
      value: '生效中',
      detail: known?.detail ?? '该状态正在生效。',
      tone: known?.tone ?? 'warn',
    });
  }
  for (const lock of p.actionLocks ?? []) items.push({
    key: `lock-${lock.action}`, icon: '🔒', label: `${lock.label} 被封印`, value: '永久',
    detail: '被钥匙封印，本局无法再使用该行动（攻击不受封印影响）。', tone: 'bad',
  });
  return items;
};

export const PLAYER_STATUS_READERS = [
  readLife,
  readStealth,
  readStatusEffects,
  readDomain,
  readCharacter,
  readInsults,
  readSlotHero,
  readGenericStatuses,
] as const satisfies readonly PlayerStatusReader[];

export function playerStatusItems(
  player: SnapPlayer,
  players: readonly SnapPlayer[] = [],
): PlayerStatusItem[] {
  const context: PlayerStatusContext = { players };
  return PLAYER_STATUS_READERS.flatMap((read) => read(player, context));
}
