/**
 * Worker：只做确定性对局与增量上报。
 * 种子 = hash(runId, workerId, gameIndex)，跨次运行不重复。
 * 上报 dropped 用「增量」而非累计值，避免主控重复累加（旧版 bug）。
 */
import { parentPort, workerData } from 'node:worker_threads';
import { deriveSeed, type SimConfig } from './config.js';
import { makeSpec, replayPayload, runMatch, type MatchOutcome } from './driver.js';
import { Aggregator, BoundedFailures, type FailureRecord, type Snapshot } from './stats.js';
import type { CaseConfig } from './experiments.js';

export interface WorkerCfg {
  cfg: SimConfig;
  cases: CaseConfig[];
  workerId: number;
  runId: string;
  endedAt: number;
}

interface UpMsg {
  type: 'batch' | 'done';
  workerId: number;
  gameIndex: number;
  snapshot: Snapshot;
  failures: FailureRecord[];
  droppedDelta: number;
}

const wc = workerData as WorkerCfg;
const { cfg, cases, workerId, runId, endedAt } = wc;
const agg = new Aggregator(new Map(cases.map((c) => [c.key, { unit: c.unit, balanceEligible: c.balanceEligible }])));
const bounded = new BoundedFailures(64, 2);
const caseMeta = new Map(cases.map((c) => [c.key, c]));

let gameIndex = 0;
let stopped = false;
let lastDropped = 0;
let totalMatches = 0;

parentPort?.on('message', (m: { type: string }) => { if (m?.type === 'stop') stopped = true; });

function emit(type: 'batch' | 'done'): void {
  const msg: UpMsg = {
    type, workerId, gameIndex, snapshot: agg.drain(),
    failures: bounded.drain(),
    droppedDelta: Math.max(0, bounded.dropped.value - lastDropped),
  };
  lastDropped = bounded.dropped.value;
  parentPort?.postMessage(msg);
}

function failureOf(caseKey: string, out: MatchOutcome): FailureRecord {
  const c = caseMeta.get(caseKey);
  // 同 seed 位级确定性 → 异常时用同配置重跑一次采集完整输入流，热路径不受影响
  const captureSpec = makeSpec(cfg, out.charIds, out.seed, out.tier, {
    mapId: out.mapId, rules: cfg.rules, maxRounds: cfg.maxRounds,
    telemetry: false, hashLogs: false, captureTranscript: true,
  });
  const captured = runMatch(captureSpec).transcript;
  return {
    ts: new Date().toISOString(),
    runId,
    caseKey,
    unit: c?.unit ?? 'unknown',
    tier: c?.tier ?? 0,
    reason: out.endKind === 'stall' ? 'STALL' : 'ERROR',
    seed: out.seed,
    charIds: out.charIds,
    mapId: out.mapId,
    rounds: out.rounds,
    steps: out.steps,
    winner: out.winnerChar,
    aliveCount: out.aliveCount,
    error: out.error,
    replay: captured ? replayPayload({ ...out, transcript: captured }, captureSpec) : null,
  };
}

while (!stopped && Date.now() < endedAt && (cfg.targetMatches === 0 || totalMatches < Math.ceil(cfg.targetMatches / cfg.workers))) {
  const inBatch = Math.min(cfg.batchSize, cfg.targetMatches > 0 ? Math.ceil(cfg.targetMatches / cfg.workers) - totalMatches : cfg.batchSize);
  for (let i = 0; i < inBatch && !stopped && Date.now() < endedAt; i++, gameIndex++) {
    // 分层轮转：每个 worker 从不同 case 起点开始，保证统计单元覆盖均衡
    const c = cases[(gameIndex + workerId * 7) % cases.length];
    if (!c) break;
    const seed = deriveSeed(runId, workerId, gameIndex, cfg.seed);
    const spec = makeSpec(cfg, c.chars, seed, c.tier, {
      mapId: c.mapId,
      telemetry: true,
      hashLogs: false,
      captureTranscript: false, // 热路径不采输入流；异常时用同 seed 重跑一次采集
    });
    const out = runMatch(spec);
    agg.add(c.key, out);
    totalMatches++;
    if (out.endKind !== 'finished') bounded.push(failureOf(c.key, out));
  }
  if (inBatch > 0) emit('batch');
}
emit('done');
