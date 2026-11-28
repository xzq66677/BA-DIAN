/**
 * 主控：参数解析 → 运行前基准 → Worker 并行 → 定时停止 → 原子落盘 → 报告。
 * 一键脚本流程由 run.bat 串联：verify(1000 局) → bench → 全量 → 定时 → 报告。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  DEFAULT_CONFIG, HARNESS_VERSION, TIER4_READY, TIER_TO_DIFFICULTY, makeRunId, type SimConfig,
} from './config.js';
import { buildCases, EXPERIMENT_IDS, type ExperimentId } from './experiments.js';
import { Aggregator, BoundedFailures, derive, isOutlier, wilsonCI, type FailureRecord, type Snapshot } from './stats.js';
import { runBenchmark, type BenchResult } from './bench.js';
import type { WorkerCfg } from './worker.js';
import { WORKER_CODE } from './_worker-embedded.js';
import { BUILD_VERSION } from './_build-version.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function argNum(name: string, fallback: number): number {
  const v = Number(arg(name, String(fallback)));
  return Number.isFinite(v) ? v : fallback;
}

function gitInfo(): { commit: string; dirty: boolean } {
  // 优先用构建时冻结的版本（干净包无 .git）；源码直跑时再读 git
  if (BUILD_VERSION.commit !== 'unknown') return { ...BUILD_VERSION };
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).trim();
    return { commit, dirty: status.length > 0 };
  } catch { return { commit: 'unknown', dirty: false }; }
}

function atomicWrite(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function csv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => {
    const s = String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n') + '\n';
}

function parseConfig(): { cfg: SimConfig; exp: ExperimentId; benchOnly: boolean } {
  const expRaw = arg('experiment', 'all') as ExperimentId;
  const exp = EXPERIMENT_IDS.includes(expRaw) ? expRaw : 'all';
  const runId = arg('run-id', '') || makeRunId();
  const cfg: SimConfig = {
    ...DEFAULT_CONFIG,
    playerCounts: arg('player-counts', DEFAULT_CONFIG.playerCounts.join(',')).split(',').map(Number).filter((n) => n >= 2 && n <= 10),
    mapId: arg('map', DEFAULT_CONFIG.mapId) as SimConfig['mapId'],
    balanceTier: Math.min(4, Math.max(1, argNum('balance-tier', DEFAULT_CONFIG.balanceTier))) as SimConfig['balanceTier'],
    maxTier: Math.min(4, Math.max(1, argNum('max-tier', DEFAULT_CONFIG.maxTier))) as SimConfig['maxTier'],
    maxRounds: argNum('max-rounds', DEFAULT_CONFIG.maxRounds),
    durationSec: argNum('duration', DEFAULT_CONFIG.durationSec),
    workers: Math.max(1, argNum('workers', DEFAULT_CONFIG.workers)),
    batchSize: Math.max(1, argNum('batch', DEFAULT_CONFIG.batchSize)),
    checkpointSec: Math.max(1, argNum('checkpoint', DEFAULT_CONFIG.checkpointSec)),
    seed: argNum('seed', DEFAULT_CONFIG.seed) >>> 0,
    oversampleFactor: argNum('oversample', DEFAULT_CONFIG.oversampleFactor),
    hashMode: arg('hash', DEFAULT_CONFIG.hashMode) as SimConfig['hashMode'],
    runId,
    outDir: arg('out', DEFAULT_CONFIG.outDir),
    targetMatches: Math.max(0, argNum('matches', 0)),
  };
  return { cfg, exp, benchOnly: process.argv.includes('--bench-only') };
}

async function main(): Promise<void> {
  const { cfg, exp, benchOnly } = parseConfig();
  const cases = buildCases(exp, cfg);
  const meta = new Map(cases.map((c) => [c.key, { unit: c.unit, balanceEligible: c.balanceEligible }]));
  const startedAt = Date.now();
  const endedAt = startedAt + cfg.durationSec * 1000;
  const git = gitInfo();
  fs.mkdirSync(cfg.outDir, { recursive: true });

  // 1) 运行前基准
  console.log('[bench] 单进程基准…');
  const bench = runBenchmark(cfg);
  atomicWrite(path.join(cfg.outDir, 'benchmark.json'), JSON.stringify({
    _schema: 'BA-DIAN benchmark v2; measured only; fields: timestamp/machine/scenarios/memoryCurve',
    ...bench,
  }, null, 2));
  console.log(`[bench] ${bench.scenarios.map((s) => `${s.name}=${s.matchesPerSec}/s`).join(' · ')}`);
  if (benchOnly) return;

  atomicWrite(path.join(cfg.outDir, 'experiment-config.json'), JSON.stringify({
    _schema: 'BA-DIAN experiment config v2; all defaults explicit; rules from DEFAULT_RULES (player/player)',
    harnessVersion: HARNESS_VERSION,
    code: { repo: 'xzq66677/BA-DIAN', commit: git.commit, dirty: git.dirty },
    experiment: { id: exp, caseCount: cases.length },
    config: cfg,
    // tier 契约直接取自 config 映射表，避免与实现漂移
    tierContract: { mapping: TIER_TO_DIFFICULTY, tier4Ready: TIER4_READY },
    environment: bench,
    startedAt: new Date(startedAt).toISOString(),
  }, null, 2));

  // 2) Worker 并行
  const aggregate = new Aggregator(meta);
  const bounded = new BoundedFailures(128, 4);
  let droppedFailures = 0;
  let failuresWritten = 0;
  const failureStream = fs.createWriteStream(path.join(cfg.outDir, 'failures.jsonl'), { flags: 'w' });
  failureStream.write('# schema: BA-DIAN failure v2; reason=ERROR|ASSERT|STALL; replay=最小重放载荷(seed+config+tier+输入流)\n');
  const workers: Worker[] = [];
  let finalized = false;

  // 单文件运行包：worker 源码内联，运行时落临时文件后用文件模式启动 Worker
  // （eval Worker 在 ESM 主包 + CJS worker 组合下无法正确初始化 parentPort）
  const useEmbedded = WORKER_CODE.length > 0;
  const workerFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'worker.js');
  let workerPath = fs.existsSync(workerFile) ? workerFile : path.join(path.dirname(fileURLToPath(import.meta.url)), 'worker.ts');
  let tempWorkerPath = '';
  if (useEmbedded) {
    // 固定隐藏文件名：多次运行覆盖，不产生随 runId 增长的残留
    tempWorkerPath = path.resolve(cfg.outDir, '.worker.cjs');
    workerPath = tempWorkerPath;
    fs.writeFileSync(workerPath, WORKER_CODE);
    process.on('exit', () => {
      if (tempWorkerPath) { try { fs.unlinkSync(tempWorkerPath); } catch { /* 已清理 */ } }
    });
  }

  function writeCheckpoint(): void {
    const snap = aggregate.snapshot();
    atomicWrite(path.join(cfg.outDir, 'checkpoint.json'), JSON.stringify({
      _schema: 'BA-DIAN checkpoint v2; runId is merge-idempotency key; snapshot mirrors summary',
      runId: cfg.runId,
      generatedAt: new Date().toISOString(),
      snapshot: snap,
    }, null, 2));
  }

  function finalize(): void {
    if (finalized) return;
    finalized = true;
    // 先终止所有 Worker，释放临时 worker 文件句柄（Windows 必需）
    for (const s of slots) { try { void s.worker.terminate(); } catch { /* 已退出 */ } }
    const sec = (Date.now() - startedAt) / 1000;
    const snap = aggregate.snapshot();
    writeCheckpoint();

    for (const f of bounded.drain()) {
      failuresWritten++;
      failureStream.write(JSON.stringify(f) + '\n');
    }
    failureStream.end();
    // finalize 中 drain 不再重复计数（Worker 上报的已计入）

    const buckets = Object.values(snap.buckets).map((b) => derive(b, cfg));
    const eligible = buckets.filter((b) => b.balanceEligible);
    const outliers = eligible.filter(isOutlier).map((b) => ({ key: b.key, winRate: b.winRate, matches: b.matches }));
    const lowConfidence = buckets.filter((b) => b.lowConfidence).map((b) => ({ key: b.key, ciHalf: b.ciHalf, matches: b.matches }));

    atomicWrite(path.join(cfg.outDir, 'summary.json'), JSON.stringify({
      _schema: 'BA-DIAN summary v2; all counts measured; no estimates; CI=Wilson95',
      version: { harness: HARNESS_VERSION, code: git, rulesSource: 'import shared/src + server/src/ai (no copy)', rulesModified: false },
      environment: {
        cpuModel: bench.cpuModel, logicalCores: bench.logicalCores, physicalCores: bench.physicalCores,
        totalMemoryMB: bench.totalMemoryMB, nodeVersion: bench.nodeVersion, platform: bench.platform,
      },
      run: {
        runId: cfg.runId, experiment: exp, startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date().toISOString(), requestedDurationSec: cfg.durationSec,
        actualDurationSec: Math.round(sec * 100) / 100, workers: cfg.workers,
        seed: cfg.seed, batchSize: cfg.batchSize, maxRounds: cfg.maxRounds,
        mapId: cfg.mapId, balanceTier: cfg.balanceTier,
        totalMatches: snap.totalMatches, finishedMatches: snap.totalFinished,
        draws: snap.totalDraws, stall: snap.totalStall, error: snap.totalError,
        matchesPerSec: sec > 0 ? Math.round(snap.totalMatches / sec) : 0,
        failuresWritten, droppedFailureRecords: droppedFailures,
      },
      statistics: {
        ciMethod: 'Wilson score 95%', ciMaxHalfWidth: cfg.ciMaxHalfWidth,
        lowConfidenceUnits: lowConfidence, outliers,
        unitCount: buckets.length, eligibleUnitCount: eligible.length,
      },
    }, null, 2));

    // balance.csv：一行 = 角色 × 档位 × 人数（胜率、CI、平均回合、存活）
    // 胜率 = 该角色获胜局 / 该角色参与局（winnerByChar / matches），Wilson 95% CI
    const balRows: (string | number)[][] = [['# schema: char,tier,player_count,participated,wins,win_rate,ci_low,ci_hi,ci_half,low_confidence,avg_rounds,avg_alive,balance_eligible']];
    balRows.push(['char', 'tier', 'player_count', 'participated', 'wins', 'win_rate', 'ci_low', 'ci_hi', 'ci_half', 'low_confidence', 'avg_rounds', 'avg_alive', 'balance_eligible']);
    const charAgg = new Map<string, { participated: number; wins: number; roundsSum: number; aliveSum: number; eligible: boolean }>();
    for (const [key, b] of Object.entries(snap.buckets)) {
      const tier = Number(key.split(':')[1]?.replace('t', '') ?? 0);
      const playerCount = Number(key.split(':')[0]?.replace('u', '') ?? 0);
      const chars = key.split(':').pop()?.split('+') ?? [];
      for (const ch of chars) {
        const rowKey = `${ch}|t${tier}|u${playerCount}|${b.balanceEligible}`;
        let x = charAgg.get(rowKey);
        if (!x) { x = { participated: 0, wins: 0, roundsSum: 0, aliveSum: 0, eligible: b.balanceEligible }; charAgg.set(rowKey, x); }
        x.participated += b.matches;
        x.wins += b.winnerByChar[ch] ?? 0;
        x.roundsSum += b.roundsSum;
        x.aliveSum += b.aliveSum;
      }
    }
    for (const [rowKey, x] of charAgg) {
      const [ch, tierS, countS, eligibleS] = rowKey.split('|');
      const losses = Math.max(0, x.participated - x.wins);
      const ci = wilsonCI(x.wins, x.wins + losses, cfg.ciZ);
      const wr = x.wins + losses > 0 ? x.wins / (x.wins + losses) : 0;
      const lowConf = ci.half > cfg.ciMaxHalfWidth || x.wins + losses < 100;
      balRows.push([ch, tierS.replace('t', ''), countS.replace('u', ''), x.participated, x.wins,
        wr.toFixed(4), ci.low.toFixed(4), ci.high.toFixed(4), ci.half.toFixed(4),
        lowConf ? 'true' : 'false',
        (x.roundsSum / Math.max(1, x.participated)).toFixed(2),
        (x.aliveSum / Math.max(1, x.participated)).toFixed(2),
        eligibleS]);
    }
    atomicWrite(path.join(cfg.outDir, 'balance.csv'), csv(balRows));

    // matchups.csv：一行 = 角色组合 × 人数 × 档位（只取 balanceEligible）
    const muRows: (string | number)[][] = [['# schema: case_key,unit,tier,matches,finished,a_wins,b_wins,draws,win_rate']];
    muRows.push(['case_key', 'unit', 'tier', 'matches', 'finished', 'a_wins', 'b_wins', 'draws', 'win_rate']);
    for (const [key, b] of Object.entries(snap.buckets)) {
      if (!b.balanceEligible || b.wins + b.draws === 0) continue;
      const chars = key.split(':').pop()?.split('+') ?? [];
      if (chars.length !== 2) continue;
      const a = b.winnerByChar[chars[0]] ?? 0;
      const bb = b.winnerByChar[chars[1]] ?? 0;
      const tier = Number(key.split(':')[1]?.replace('t', '') ?? 0);
      muRows.push([key, b.unit, tier, b.matches, b.finished, a, bb, b.draws, (a / (a + bb || 1)).toFixed(4)]);
    }
    atomicWrite(path.join(cfg.outDir, 'matchups.csv'), csv(muRows));

    // report.html：纯静态零依赖
    const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>BA-DIAN 模拟报告</title>
<style>body{font:14px/1.6 system-ui;max-width:960px;margin:32px auto;color:#222}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px 8px;text-align:left}th{background:#f4f4f4}.warn{color:#b00}</style>
<h1>BA-DIAN 离线模拟报告</h1><p>runId ${cfg.runId} · ${git.commit}${git.dirty ? ' (dirty)' : ''} · ${cfg.workers} workers · ${cfg.durationSec}s</p>
<h2>规模</h2><table><tr><td>总对局</td><td>${snap.totalMatches.toLocaleString()}</td></tr><tr><td>吞吐</td><td>${Math.round(snap.totalMatches / sec).toLocaleString()} 局/秒</td></tr>
<tr><td>正常终局</td><td>${snap.totalFinished.toLocaleString()}</td></tr><tr><td>STALL / ERROR</td><td>${snap.totalStall} / ${snap.totalError}</td></tr></table>
<h2>统计单元（节选，前 40）</h2><table><tr><th>单元</th><th>样本</th><th>胜率</th><th>95% CI</th><th>低置信</th></tr>
${buckets.slice(0, 40).map((b) => `<tr><td>${b.key}</td><td>${b.matches}</td><td>${(b.winRate * 100).toFixed(1)}%</td><td>[${(b.ciLow * 100).toFixed(1)}, ${(b.ciHigh * 100).toFixed(1)}]</td><td class="${b.lowConfidence ? 'warn' : ''}">${b.lowConfidence ? '是' : '否'}</td></tr>`).join('')}</table>
<h2>离群（胜率 &gt;70%，高置信）</h2><p>${outliers.length ? outliers.map((o) => `${o.key} ${(o.winRate * 100).toFixed(1)}% (n=${o.matches})`).join('<br>') : '无'}</p></html>`;
    atomicWrite(path.join(cfg.outDir, 'report.html'), html);

    console.log(`[done] ${snap.totalMatches} 局 / ${Math.round(sec)}s = ${Math.round(snap.totalMatches / sec)} 局/秒`);
    console.log(`[done] 正常 ${snap.totalFinished} · 平局 ${snap.totalDraws} · STALL ${snap.totalStall} · ERROR ${snap.totalError}`);
    console.log(`[done] 异常记录 ${failuresWritten} · 低置信单元 ${lowConfidence.length} · OUTLIER ${outliers.length}`);
    console.log(`[done] 输出 ${cfg.outDir}`);
    // 清理运行时生成的临时 worker 文件（单文件包的产物）
    if (tempWorkerPath) { try { fs.unlinkSync(tempWorkerPath); } catch { /* 已清理 */ } }
    process.exit(0);
  }

  const slots: { worker: Worker; done: boolean }[] = [];
  for (let i = 0; i < cfg.workers; i++) {
    const w = new Worker(workerPath, {
      workerData: { cfg, cases, workerId: i, runId: cfg.runId, endedAt } as WorkerCfg,
      ...(workerPath.endsWith('.ts') ? { execArgv: ['--import', 'tsx'] } : {}),
    });
    w.on('message', (m: { type: 'batch' | 'done'; snapshot: Snapshot; failures: FailureRecord[]; droppedDelta: number }) => {
      aggregate.merge(m.snapshot);
      droppedFailures += m.droppedDelta;
      for (const f of m.failures) { failuresWritten++; failureStream.write(JSON.stringify(f) + '\n'); }
      if (m.type === 'done') {
        const slot = slots.find((s) => s.worker === w);
        if (slot) slot.done = true;
        if (slots.every((s) => s.done)) finalize();
      }
    });
    w.on('error', (e: Error) => { console.error(`[worker ${i}] error`, e.message, e.stack ?? ''); });
    w.on('exit', () => {
      const slot = slots.find((s) => s.worker === w);
      if (slot) slot.done = true;
      if (slots.every((s) => s.done)) finalize();
    });
    slots.push({ worker: w, done: false });
  }

  const timer = setInterval(() => {
    if (finalized) { clearInterval(timer); return; }
    if (Date.now() >= endedAt || cfg.targetMatches > 0) {
      for (const s of slots) s.worker.postMessage({ type: 'stop' });
      clearInterval(timer);
      setTimeout(() => { for (const s of slots) s.worker.terminate(); finalize(); }, 8000).unref();
    } else {
      writeCheckpoint();
      const snap = aggregate.snapshot();
      console.log(`[progress] ${snap.totalMatches} 局 · STALL ${snap.totalStall} · ERROR ${snap.totalError}`);
    }
  }, cfg.checkpointSec * 1000);

  process.on('SIGINT', () => {
    for (const s of slots) s.worker.postMessage({ type: 'stop' });
    clearInterval(timer);
    setTimeout(() => finalize(), 3000).unref();
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
