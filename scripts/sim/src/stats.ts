/**
 * 流式统计：固定数量聚合桶 + 有界异常缓冲，内存与对局数无关。
 * 每个统计单元输出样本量与 95% CI；不足 ±3% 标记 low-confidence，不参与平衡结论。
 */
import type { MatchOutcome } from './driver.js';
import type { Mechanics } from './telemetry.js';

export interface Bucket {
  key: string;
  unit: string;
  balanceEligible: boolean;
  matches: number;
  finished: number;
  wins: number;
  draws: number;
  stall: number;
  error: number;
  roundsSum: number;
  roundsSqSum: number;
  stepsSum: number;
  aliveSum: number;
  winnerByChar: Record<string, number>;
  actionCounts: Record<string, number>;
  mechanics: Mechanics;
}

export interface FailureRecord {
  ts: string;
  runId: string;
  caseKey: string;
  unit: string;
  tier: number;
  reason: 'ERROR' | 'ASSERT' | 'STALL';
  seed: number;
  charIds: string[];
  mapId: string;
  rounds: number;
  steps: number;
  winner: string | null;
  aliveCount: number;
  error?: string;
  /** 最小重放载荷（种子+配置+tier+完整输入流） */
  replay: Record<string, unknown> | null;
}

export interface Snapshot {
  buckets: Record<string, Bucket>;
  totalMatches: number;
  totalFinished: number;
  totalStall: number;
  totalError: number;
  totalDraws: number;
}

export function emptyBucket(key: string, unit: string, balanceEligible: boolean): Bucket {
  return {
    key, unit, balanceEligible,
    matches: 0, finished: 0, wins: 0, draws: 0, stall: 0, error: 0,
    roundsSum: 0, roundsSqSum: 0, stepsSum: 0, aliveSum: 0,
    winnerByChar: {}, actionCounts: {},
    mechanics: {
      damage_events: 0, damage_reflected: 0, damage_transferred: 0,
      ivan_explosion: 0, wuliuqi_slash_segment: 0, segmented_damage: 0,
      rps_resolved: 0, rps_tie: 0, rps_alltie: 0, rps_cycle: 0, rps_tieAct: 0,
      bujiangwude: 0, whip5: 0, insult_kill: 0,
      hide: 0, seek: 0, tower_judge: 0, parry_wildhunt: 0, possess: 0, tower_build: 0,
    },
  };
}

function bump(o: Record<string, number>, k: string, n = 1): void { o[k] = (o[k] ?? 0) + n; }

export class Aggregator {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly caseMeta: Map<string, { unit: string; balanceEligible: boolean }>) {}

  add(caseKey: string, out: MatchOutcome): void {
    const meta = this.caseMeta.get(caseKey) ?? { unit: 'unknown', balanceEligible: false };
    let b = this.buckets.get(caseKey);
    if (!b) {
      b = emptyBucket(caseKey, meta.unit, meta.balanceEligible);
      this.buckets.set(caseKey, b);
    }
    b.matches++;
    if (out.endKind === 'stall') b.stall++;
    else if (out.endKind === 'error') b.error++;
    else {
      b.finished++;
      if (out.winner) { b.wins++; bump(b.winnerByChar, out.winnerChar ?? 'unknown'); }
      else b.draws++;
    }
    b.roundsSum += out.rounds;
    b.roundsSqSum += out.rounds * out.rounds;
    b.stepsSum += out.steps;
    b.aliveSum += out.aliveCount;
    for (const [k, v] of Object.entries(out.actionCounts)) bump(b.actionCounts, k, v);
    for (const [k, v] of Object.entries(out.mechanics)) {
      (b.mechanics as unknown as Record<string, number>)[k] = ((b.mechanics as unknown as Record<string, number>)[k] ?? 0) + v;
    }
  }

  merge(s: Snapshot): void {
    for (const [key, src] of Object.entries(s.buckets)) {
      let b = this.buckets.get(key);
      if (!b) { b = emptyBucket(key, src.unit, src.balanceEligible); this.buckets.set(key, b); }
      for (const k of ['matches', 'finished', 'wins', 'draws', 'stall', 'error', 'roundsSum', 'roundsSqSum', 'stepsSum', 'aliveSum'] as const) {
        b[k] += src[k];
      }
      for (const [ck, v] of Object.entries(src.winnerByChar)) bump(b.winnerByChar, ck, v);
      for (const [ck, v] of Object.entries(src.actionCounts)) bump(b.actionCounts, ck, v);
      for (const [ck, v] of Object.entries(src.mechanics)) {
        (b.mechanics as unknown as Record<string, number>)[ck] = ((b.mechanics as unknown as Record<string, number>)[ck] ?? 0) + v;
      }
    }
  }

  snapshot(): Snapshot {
    const buckets: Record<string, Bucket> = {};
    let totalMatches = 0, totalFinished = 0, totalStall = 0, totalError = 0, totalDraws = 0;
    for (const [k, b] of this.buckets) {
      buckets[k] = structuredClone(b);
      totalMatches += b.matches;
      totalFinished += b.finished;
      totalStall += b.stall;
      totalError += b.error;
      totalDraws += b.draws;
    }
    return { buckets, totalMatches, totalFinished, totalStall, totalError, totalDraws };
  }

  /**
   * 取走自上次 drain 以来的增量并清空本地桶。Worker 每批调用本方法上报 delta，
   * 主进程用 merge 累加。禁止用 snapshot() 上报——那会重复累加历史批次。
   */
  drain(): Snapshot {
    const out = this.snapshot();
    for (const [key, b] of this.buckets) {
      this.buckets.set(key, emptyBucket(key, b.unit, b.balanceEligible));
    }
    return out;
  }
}

/** 有界异常采样：按 (caseKey, reason) 分类限量，drain 不重置配额 */
export class BoundedFailures {
  private items: FailureRecord[] = [];
  private readonly seen = new Map<string, number>();
  readonly dropped = { value: 0 };
  constructor(private readonly capacity = 128, private readonly perGroup = 4) {}

  push(r: FailureRecord): void {
    const g = `${r.caseKey}|${r.reason}`;
    const n = this.seen.get(g) ?? 0;
    if (n >= this.perGroup || this.items.length >= this.capacity) { this.dropped.value++; return; }
    this.seen.set(g, n + 1);
    this.items.push(r);
  }
  drain(): FailureRecord[] { const x = this.items; this.items = []; return x; }
}

/** Wilson score 95% 置信区间（二项比例，小样本稳健） */
export function wilsonCI(wins: number, total: number, z = 1.96): { low: number; high: number; half: number } {
  if (total <= 0) return { low: 0, high: 0, half: 0 };
  const p = wins / total;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const spread = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom;
  const low = Math.max(0, center - spread);
  const high = Math.min(1, center + spread);
  return { low, high, half: (high - low) / 2 };
}

export interface DerivedBucket {
  key: string;
  unit: string;
  balanceEligible: boolean;
  matches: number;
  finished: number;
  wins: number;
  draws: number;
  stall: number;
  error: number;
  winRate: number;
  ciLow: number;
  ciHigh: number;
  ciHalf: number;
  lowConfidence: boolean;
  avgRounds: number;
  stdRounds: number;
  avgAlive: number;
  winnerByChar: Record<string, number>;
  actionCounts: Record<string, number>;
  mechanics: Mechanics;
}

export function derive(b: Bucket, cfg: { ciZ: number; ciMaxHalfWidth: number }): DerivedBucket {
  const ci = wilsonCI(b.wins, b.wins + b.draws, cfg.ciZ);
  const avg = b.finished > 0 ? b.roundsSum / b.finished : 0;
  const variance = b.finished > 1
    ? Math.max(0, (b.roundsSqSum - (b.roundsSum * b.roundsSum) / b.finished) / (b.finished - 1))
    : 0;
  return {
    key: b.key, unit: b.unit, balanceEligible: b.balanceEligible,
    matches: b.matches, finished: b.finished, wins: b.wins, draws: b.draws,
    stall: b.stall, error: b.error,
    winRate: b.wins + b.draws > 0 ? b.wins / (b.wins + b.draws) : 0,
    ciLow: ci.low, ciHigh: ci.high, ciHalf: ci.half,
    lowConfidence: ci.half > cfg.ciMaxHalfWidth || b.wins + b.draws < 100,
    avgRounds: avg, stdRounds: Math.sqrt(variance),
    avgAlive: b.matches > 0 ? b.aliveSum / b.matches : 0,
    winnerByChar: b.winnerByChar, actionCounts: b.actionCounts, mechanics: b.mechanics,
  };
}

/** OUTLIER：胜率 >70% 单独汇总，不算 failure */
export function isOutlier(d: DerivedBucket): boolean {
  if (!d.balanceEligible || d.lowConfidence) return false;
  // 多人局「有胜者比例」天然接近 1，不能当失衡信号。
  // 真正的 OUTLIER = 单一角色拿走该组合 >70% 的胜局（支配），且有足够样本。
  const wins = Object.values(d.winnerByChar ?? {});
  const total = wins.reduce((a, b) => a + b, 0);
  if (total < 100 || wins.length < 2) return false;
  return Math.max(...wins) / total > 0.70;
}
