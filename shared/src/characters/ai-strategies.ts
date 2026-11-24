import type { CharacterAiContext } from '../chardef.js';
import type { ActionRequest } from '../types.js';

type Strategy = (ctx: CharacterAiContext) => ActionRequest | undefined;

const firstInRoom: Strategy = ({ members }) =>
  members.length > 0 ? { type: 'attack', targetId: members[0] } : undefined;

export const characterAi = {
  bagun(ctx) {
    if (!ctx.st.stickDrawn) return { type: 'toggleStick' };
    return firstInRoom(ctx);
  },
  chuixiao({ game, pid, alive, difficulty }) {
    if (difficulty === 'hard') return;
    const targets = alive.filter((p) => !game.isSameRoom(pid, p)
      && !(game.players[p].hidden || game.players[p].invisible));
    const weakest = targets.sort((a, b) => game.players[a].hp - game.players[b].hp)[0];
    if (weakest) return { type: 'attack', targetId: weakest, ranged: true };
  },
  gojo({ game, pid, st, members, alive, difficulty }) {
    if (st.domain !== true) return { type: 'domain' };
    if (difficulty === 'hard') return;
    const visibleMembers = members.filter((p) => !(game.players[p].hidden || game.players[p].invisible));
    if (visibleMembers.length > 0) {
      return { type: 'attack', targetId: visibleMembers[0], ranged: !game.isSameRoom(pid, visibleMembers[0]) };
    }
    const target = alive.find((p) => !(game.players[p].hidden || game.players[p].invisible));
    if (target) return { type: 'attack', targetId: target, ranged: true };
  },
  mabaoguo(ctx) {
    if (ctx.members.some((id) => ctx.game.players[id].maxHp >= 3)) {
      return { type: 'whip5', targetId: ctx.members[0] };
    }
    return firstInRoom(ctx);
  },
  ivan({ game, me, difficulty }) {
    const best = game.roomIds.filter((room) => room !== me.room)
      .map((room) => ({ room, count: game.roomMembers(room).length }))
      .sort((a, b) => b.count - a.count)[0];
    const min = difficulty === 'hard' ? 2 : 1;
    if (best && best.count >= min) return { type: 'throwIvan', room: best.room };
  },
  hero({ game, me, st }) {
    if (game.roundNo === 1 && me.hp <= 1 && st.fortuneUsed !== true) return { type: 'rollFortune' };
  },
  firstInRoom,
  wuliuqi({ game, pid }) {
    // 三刀是延迟 AOE：优先选「其他存活玩家最多」的房间蓄力（含原地）
    const best = game.roomIds
      .map((room) => ({ room, count: game.roomMembers(room).filter((p) => p !== pid && game.players[p].alive).length }))
      .sort((a, b) => b.count - a.count)[0];
    if (!best) return { type: 'skip' };
    return { type: 'attack', room: best.room };
  },
} satisfies Record<string, Strategy>;
