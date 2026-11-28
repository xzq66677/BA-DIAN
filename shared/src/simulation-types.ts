import type { MapId } from './maps.js';
import type { ActionRequest, GamePlayerConfig, PlayerId, RuleConfig, Throw } from './types.js';

/**
 * 输入流版本策略（与 wire 协议一致，见 protocol.ts「Version 1 is additive」）：
 * v1 内增量 —— 新增 kind 不 bump 版本号；但未知 kind 必须大声失败
 * （simulation.ts 的 applyInput 会 throw），不允许静默吞掉或静默错乱。
 */
export const SIMULATION_VERSION = 1;

export type MatchInput =
  | { kind: 'throw'; playerId: PlayerId; value: Throw; source: 'player' | 'ai' | 'departure' }
  | { kind: 'action'; playerId: PlayerId; action: ActionRequest; source: 'player' | 'ai' }
  | { kind: 'berserk'; playerId: PlayerId; targetId: PlayerId; source: 'player' | 'ai' }
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
