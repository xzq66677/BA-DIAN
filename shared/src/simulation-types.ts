import type { MapId } from './maps.js';
import type { ActionRequest, GamePlayerConfig, PlayerId, RuleConfig, Throw } from './types.js';

export const SIMULATION_VERSION = 1;

export type MatchInput =
  | { kind: 'throw'; playerId: PlayerId; value: Throw; source: 'player' | 'ai' | 'departure' }
  | { kind: 'action'; playerId: PlayerId; action: ActionRequest; source: 'player' | 'ai' }
  | { kind: 'throwTimeout' }
  | { kind: 'actionTimeout'; playerId: PlayerId }
  | { kind: 'remove'; ids: PlayerId[]; reason: 'left' | 'kicked' | 'removed'; host?: PlayerId };

export interface MatchSetup {
  seed: number;
  players: GamePlayerConfig[];
  rules: Partial<RuleConfig>;
  mapId: MapId;
  logSeqOffset: number;
}

export interface MatchTranscript {
  v: number;
  setup: MatchSetup;
  inputs: { input: MatchInput; rngAdvance: number; accepted: boolean }[];
  truncated?: boolean;
}
