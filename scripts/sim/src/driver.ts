/**
 * 核心驱动：只 import 真实引擎 / AI / 模拟模块，零规则代码复制、零规则语义改动。
 *
 * 驱动循环与 server/src/room.ts 的 kickAI 同构：所有座位都是 AI，
 * 判定仍走引擎本身（rules = DEFAULT_RULES，即 skillJudgeMode/secondJudgeMode 均为 'player'）。
 * MatchRecorder 记录每一步输入 + RNG 跨步消耗，使单案例可精确重放。
 */
import { createHash } from 'node:crypto';
import { Game } from '../../../shared/src/engine.js';
import { CHARACTERS } from '../../../shared/src/characters/index.js';
import { aiThrow, aiDecideActions, aiBerserkTarget } from '../../../server/src/ai.js';
import { MatchRecorder, replayMatch } from '../../../shared/src/simulation.js';
import type { MatchInput, MatchSetup, MatchTranscript } from '../../../shared/src/simulation-types.js';
import type { AiDifficulty, GamePlayerConfig, PlayerId, ActionRequest, Throw } from '../../../shared/src/types.js';
import type { MapId } from '../../../shared/src/maps.js';
import { TIER_TO_DIFFICULTY, type SimConfig } from './config.js';
import { aggregateMechanics, emptyMechanics, type Mechanics } from './telemetry.js';

export type Tier = 1 | 2 | 3 | 4;

export interface MatchSpec {
  seed: number;
  charIds: string[];
  tier: Tier;
  mapId: MapId;
  rules: SimConfig['rules'];
  maxRounds: number;
  /** 是否采集机制埋点（只读扫描 log.data） */
  telemetry: boolean;
  /** 是否计算日志序列 hash（位级 oracle，仅校验/复现时开启） */
  hashLogs: boolean;
  /** 是否保留完整输入流（异常案例复现用） */
  captureTranscript: boolean;
}

export interface MatchOutcome {
  seed: number;
  charIds: string[];
  tier: Tier;
  difficulty: AiDifficulty;
  mapId: MapId;
  winner: PlayerId | null | undefined;
  winnerChar: string | null;
  rounds: number;
  steps: number;
  /** 正常终局 / STALL / ERROR */
  endKind: 'finished' | 'stall' | 'error';
  error?: string;
  aliveCount: number;
  logHash: string | null;
  logCount: number;
  rngDraws: number;
  stats: Record<string, { actions: number; damageDealt: number; damageTaken: number; kills: number; heals: number; moves: number; throwWin: number; throwLose: number; throwTie: number }>;
  actionCounts: Record<string, number>;
  mechanics: Mechanics;
  transcript: MatchTranscript | null;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** 全程日志序列 hash —— 位级确定性 oracle；忽略日志序号起点，其余字段全部纳入 */
export function logSequenceHash(logs: readonly { seq: number }[]): string {
  const normalized = logs.map((l) => {
    const { seq: _seq, ...rest } = l;
    return rest;
  });
  return createHash('sha256').update(stableStringify(normalized)).digest('hex');
}

function playersFor(charIds: string[]): GamePlayerConfig[] {
  return charIds.map((charId, i) => ({
    id: `AI${i + 1}` as PlayerId,
    name: `AI${i + 1}`,
    charId,
    type: 'ai' as const,
  }));
}

export function makeSpec(cfg: SimConfig, charIds: string[], seed: number, tier: Tier, opts: Partial<MatchSpec> = {}): MatchSpec {
  return {
    seed: seed >>> 0,
    charIds: [...charIds],
    tier,
    mapId: cfg.mapId,
    rules: { ...cfg.rules },
    maxRounds: cfg.maxRounds,
    telemetry: true,
    hashLogs: false,
    captureTranscript: false,
    ...opts,
  };
}

/** 跑一局：零 I/O、零日志输出，可在 Worker 中高频调用 */
export function runMatch(spec: MatchSpec): MatchOutcome {
  const difficulty: AiDifficulty = TIER_TO_DIFFICULTY[spec.tier];
  const players = playersFor(spec.charIds);
  const setup: MatchSetup = {
    seed: spec.seed >>> 0,
    players,
    rules: { ...spec.rules },
    mapId: spec.mapId,
    logSeqOffset: 0,
  };
  const game = new Game({ ...setup, chars: CHARACTERS });
  const recorder = new MatchRecorder(game, setup);

  let steps = 0;
  let endKind: MatchOutcome['endKind'] = 'finished';
  let error: string | undefined;
  let stalled = false;
  const actionCounts: Record<string, number> = {};
  const DRIVE_GUARD = 20000;

  try {
    let guard = 0;
    while (!game.isOver() && guard++ < DRIVE_GUARD) {
      if (game.roundNo > spec.maxRounds) { stalled = true; endKind = 'stall'; break; }
      const g = game;
      const advance = (input: MatchInput): void => { recorder.apply(input); steps++; };

      if (g.phase === 'rps1') {
        const pending = g.playerIds.filter((pid) => g.players[pid]?.alive && !g.submittedIds.includes(pid));
        if (pending.length === 0) break;
        for (const pid of pending) {
          const t = aiThrow(g, pid, difficulty);
          advance({ kind: 'throw', source: 'ai', playerId: pid, value: t });
        }
        continue;
      }
      if (g.phase === 'rps2') {
        const group = g.currentOrderGroup();
        const pending = group.filter((pid) => !g.orderSubmittedIds.includes(pid));
        if (pending.length === 0) break;
        for (const pid of pending) {
          const t = aiThrow(g, pid, difficulty);
          advance({ kind: 'throw', source: 'ai', playerId: pid, value: t });
        }
        continue;
      }
      if (g.phase === 'trigger') {
        const view = g.triggerView();
        if (!view) break;
        // 与 room.kickAI 同构：暴走选目标按当前档位（宗师档选全场威胁最高者）
        const target = aiBerserkTarget(g, view.actor, difficulty);
        if (!target) break;
        advance({ kind: 'berserk', source: 'ai', playerId: view.actor, targetId: target });
        continue;
      }
      if (g.phase === 'judge') {
        const view = g.skillJudgeView();
        if (!view) break;
        if (view.waitingIds.length === 0) break;
        for (const pid of view.waitingIds) {
          const t = aiThrow(g, pid, difficulty);
          advance({ kind: 'throw', source: 'ai', playerId: pid, value: t });
        }
        continue;
      }
      if (g.phase === 'act') {
        const cur = g.currentActor();
        if (!cur) break;
        let done = false;
        for (const act of aiDecideActions(g, cur, difficulty)) {
          if (recorder.apply({ kind: 'action', source: 'ai', playerId: cur, action: act }).ok) {
            steps++; done = true; break;
          }
        }
        if (!done) {
          advance({ kind: 'action', source: 'ai', playerId: cur, action: { type: 'skip' } });
        }
        continue;
      }
      break;
    }
    if (guard >= DRIVE_GUARD && !game.isOver()) { stalled = true; endKind = 'stall'; }
  } catch (e) {
    endKind = 'error';
    error = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  }

  for (const l of game.logs) {
    // 引擎行动日志数据字段为 actionName（见 engine.ts 的 ActionEventData）；
    // 兼容旧字段 action / type，避免静默归零
    const d = l.data as { actionName?: string; action?: string; type?: string } | undefined;
    const a = d?.actionName ?? d?.action ?? (l.type === 'action' ? d?.type : undefined);
    if (typeof a === 'string') actionCounts[a] = (actionCounts[a] ?? 0) + 1;
  }

  const stats: MatchOutcome['stats'] = {};
  for (const pid of game.playerIds) {
    const s = game.stats[pid];
    if (!s) continue;
    stats[pid] = {
      actions: s.actions, damageDealt: s.damageDealt, damageTaken: s.damageTaken,
      kills: s.kills, heals: s.heals, moves: s.moves,
      throwWin: s.throwWin, throwLose: s.throwLose, throwTie: s.throwTie,
    };
  }

  const winner = game.winner;
  const winnerChar = winner && game.players[winner] ? spec.charIds[game.playerIds.indexOf(winner)] ?? null : null;

  return {
    seed: spec.seed,
    charIds: [...spec.charIds],
    tier: spec.tier,
    difficulty,
    mapId: spec.mapId,
    winner: winner ?? null,
    winnerChar,
    rounds: game.roundNo,
    steps,
    endKind,
    error,
    aliveCount: game.aliveIds().length,
    logHash: spec.hashLogs ? logSequenceHash(game.logs) : null,
    logCount: game.logs.length,
    rngDraws: game.rng.drawCount,
    stats,
    actionCounts,
    mechanics: spec.telemetry ? aggregateMechanics(game) : emptyMechanics(),
    transcript: spec.captureTranscript && !recorder.transcript.truncated ? recorder.transcript : null,
  };
}

/** 从输入流重放单案例，返回重放后的引擎（用于对照日志序列） */
export function replay(transcript: MatchTranscript): Game {
  return replayMatch(transcript);
}

/** 最小重放载荷：种子 + 配置 + tier + 完整输入流 */
export function replayPayload(outcome: MatchOutcome, spec: MatchSpec): Record<string, unknown> | null {
  if (!outcome.transcript) return null;
  return {
    seed: spec.seed,
    chars: spec.charIds,
    tier: spec.tier,
    difficulty: outcome.difficulty,
    mapId: spec.mapId,
    rules: spec.rules,
    maxRounds: spec.maxRounds,
    transcript: outcome.transcript,
  };
}
