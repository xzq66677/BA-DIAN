import type { SnapPlayer } from '../../../shared/src/protocol.js';

export type StatusTone = 'good' | 'warn' | 'bad' | 'neutral';

export interface PlayerStatusItem {
  key: string;
  icon: string;
  label: string;
  value: string;
  detail: string;
  tone: StatusTone;
}

export interface PlayerStatusContext {
  players: readonly SnapPlayer[];
}

export type PlayerStatusReader = (
  player: SnapPlayer,
  context: PlayerStatusContext,
) => PlayerStatusItem[];

export function formatHp(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
