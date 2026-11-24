import { PACE_PROFILES, resolvePace, type PaceId, type PaceProfile } from './queue.js';

export interface PaceSeatLike {
  type: string;
}

/** 真人/本机玩家 + AI 混合局默认慢速；显式 ?pace= 保留调试覆盖。 */
export function resolvePresentationPace(seats: readonly PaceSeatLike[], search?: string): PaceProfile {
  const query = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const explicit = new URLSearchParams(query).get('pace');
  if (explicit && Object.hasOwn(PACE_PROFILES, explicit)) return PACE_PROFILES[explicit as PaceId];
  const hasHuman = seats.some((seat) => seat.type === 'human' || seat.type === 'local');
  const hasAi = seats.some((seat) => seat.type === 'ai');
  if (hasHuman && hasAi) return PACE_PROFILES.slow;
  return resolvePace(explicit);
}