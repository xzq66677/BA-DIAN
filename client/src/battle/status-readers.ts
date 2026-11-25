import type { SnapPlayer } from '../../../shared/src/protocol.js';
import {
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

export const PLAYER_STATUS_READERS = [
  readLife,
  readStealth,
  readDomain,
  readCharacter,
  readInsults,
] as const satisfies readonly PlayerStatusReader[];

export function playerStatusItems(
  player: SnapPlayer,
  players: readonly SnapPlayer[] = [],
): PlayerStatusItem[] {
  const context: PlayerStatusContext = { players };
  return PLAYER_STATUS_READERS.flatMap((read) => read(player, context));
}
