import type { BattleEvent } from '../battle/events.js';
import type { BattleScene3D, SnapLite } from './scene.js';

type Deferred = NonNullable<SnapLite['deferred']>[number];

/**
 * Display-only projection. Future move, HP and elimination beats can hold only the
 * fields they explain. Anything without a pending event converges to the snapshot.
 */
export function projectMapSnapshot(
  authority: SnapLite,
  remaining: readonly BattleEvent[],
  previous: SnapLite | null,
  event?: BattleEvent,
  revealFinale = false,
): SnapLite {
  const rooms = new Map<string, string>();
  const hp = new Map<string, number>();
  const lives = new Map<string, boolean>();
  const unplayedThrows: BattleEvent[] = [];
  const unplayedBlasts = new Map<string, number>();
  for (const next of remaining) {
    if (next.kind === 'move' && next.pid && next.fromRoom && !rooms.has(next.pid)) rooms.set(next.pid, next.fromRoom);
    if (next.targetId && !hp.has(next.targetId)) {
      if (next.hpBefore !== undefined) hp.set(next.targetId, next.hpBefore);
      if (next.kind === 'revive') hp.set(next.targetId, 0);
    }
    if (next.kind === 'eliminate' && next.targetId) lives.set(next.targetId, true);
    if (next.kind === 'ivanThrow') unplayedThrows.push(next);
    if (next.kind === 'ivanBoom' && next.room) {
      unplayedBlasts.set(next.room, (unplayedBlasts.get(next.room) ?? 0) + 1);
    }
  }

  // Directed at the known room and round in the log. No membership lookup is used.
  const deferred = new Map((authority.deferred ?? []).map(d => [d.id, d]));
  for (const pending of unplayedThrows) {
    const match = Array.from(deferred.values()).reverse().find(d => d.kind === 'ivan'
      && d.room === pending.room && (pending.explodeRound === undefined || pending.explodeRound === d.explodeRound));
    if (match) deferred.delete(match.id);
  }
  let consumedBlast = false;
  for (const entry of previous?.deferred ?? []) {
    if (entry.kind !== 'ivan' || deferred.has(entry.id)) continue;
    if (!consumedBlast && event?.kind === 'ivanBoom' && event.room === entry.room) {
      consumedBlast = true;
      continue;
    }
    const inFlight = unplayedBlasts.get(entry.room) ?? 0;
    if (inFlight > 0) {
      deferred.set(entry.id, entry);
      unplayedBlasts.set(entry.room, inFlight - 1);
    }
  }
  if (event?.kind === 'ivanThrow' && event.room && event.explodeRound !== undefined && unplayedBlasts.has(event.room)
      && !Array.from(deferred.values()).some(d => d.room === event.room && d.explodeRound === event.explodeRound)) {
    const marker: Deferred = { id: `presentation-${event.seq}`, kind: 'ivan', room: event.room, explodeRound: event.explodeRound };
    deferred.set(marker.id, marker);
  }

  return {
    ...authority,
    phase: authority.phase === 'over' && !revealFinale ? 'roundEnd' : authority.phase,
    winner: revealFinale ? authority.winner : null,
    deferred: Array.from(deferred.values()),
    players: authority.players.map(p => {
      const shownRoom = event?.kind === 'move' && event.pid === p.id ? event.toRoom : rooms.get(p.id);
      const after = event?.targetId === p.id ? event.hpAfter : undefined;
      const eliminated = event?.kind === 'eliminate' && event.targetId === p.id;
      return {
        ...p,
        room: shownRoom && authority.roomIds.includes(shownRoom) ? shownRoom : p.room,
        hp: eliminated ? 0 : after ?? hp.get(p.id) ?? p.hp,
        alive: eliminated ? false : lives.get(p.id) ?? p.alive,
      };
    }),
  };
}

export type MapPlaybackScene = Pick<BattleScene3D,
  'playAction' | 'playAttackDecl' | 'playAreaAlert' | 'playHit' | 'playHeal' | 'playMiss' |
  'playWalk' | 'playEliminate' | 'playRevive' | 'playIvanThrow' | 'playIvanBoom' | 'playDomain' | 'playTrigger'>;

export function playMapEvent(scene: MapPlaybackScene, event: BattleEvent, durationMs: number): void {
  switch (event.kind) {
    case 'action':
      if (event.pid && event.fx && event.fx !== 'move') scene.playAction(event.pid, event.fx, event.targetId);
      break;
    case 'attackDecl':
      if (event.sourceId && event.targetId) scene.playAttackDecl(event.sourceId, event.targetId);
      break;
    case 'area': scene.playAreaAlert(event.areaRooms ?? []); break;
    case 'damage':
      if (event.targetId) scene.playHit(event.targetId, { ...event, amount: event.amount ?? 0 });
      break;
    case 'heal':
      if (event.targetId) scene.playHeal(event.targetId, event);
      break;
    case 'miss':
      if (event.targetId) scene.playMiss(event.targetId);
      break;
    case 'move':
      if (event.pid && event.fromRoom && event.toRoom) scene.playWalk(event.pid, event.fromRoom, event.toRoom);
      break;
    case 'eliminate':
      if (event.targetId) scene.playEliminate(event.targetId);
      break;
    case 'revive':
      if (event.targetId) scene.playRevive(event.targetId, event.livesLeft ?? 1);
      break;
    case 'ivanThrow':
      if (event.pid && event.room) scene.playIvanThrow(event.pid, event.room, Math.max(0.12, durationMs * 0.00097));
      break;
    case 'ivanBoom':
      if (event.room) scene.playIvanBoom(event.room);
      break;
    case 'domain':
      if (event.targetId) scene.playDomain(event.targetId);
      break;
    case 'fortune':
      if (event.targetId) scene.playTrigger(event.targetId);
      break;
  }
}
