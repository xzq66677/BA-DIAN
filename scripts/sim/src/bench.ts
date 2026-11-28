/**
 * 运行前基准：单进程吞吐、单局平均回合/耗时、内存曲线、机器信息。
 * 预热不计入；所有数字实测。
 */
import os from 'node:os';
import { makeSpec, runMatch } from './driver.js';
import type { SimConfig } from './config.js';
import { ROSTER } from './experiments.js';

export interface BenchResult {
  timestamp: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  cpuModel: string;
  logicalCores: number;
  physicalCores: number;
  totalMemoryMB: number;
  freeMemoryMB: number;
  trialsPerScenario: number;
  scenarios: { name: string; players: number; tier: number; matches: number; elapsedMs: number; matchesPerSec: number; avgRounds: number; avgMsPerMatch: number; abnormal: number }[];
  memoryCurveMB: { atMatch: number; rss: number; heapUsed: number }[];
  note: string;
}

export function runBenchmark(cfg: SimConfig, trials = 300): BenchResult {
  const scenarios: BenchResult['scenarios'] = [];
  const memoryCurveMB: BenchResult['memoryCurveMB'] = [];
  for (let i = 0; i < 30; i++) {
    const s = makeSpec(cfg, ROSTER.slice(0, 3), 777 + i, cfg.balanceTier, { telemetry: false });
    runMatch(s);
  }
  for (const n of [3, 5, 10]) {
    const chars = ROSTER.slice(0, Math.min(n, ROSTER.length));
    const t0 = performance.now();
    let rounds = 0, abnormal = 0;
    const startMem = process.memoryUsage();
    for (let i = 0; i < trials; i++) {
      const out = runMatch(makeSpec(cfg, chars, 9000 + i, cfg.balanceTier, { telemetry: false }));
      rounds += out.rounds;
      if (out.endKind !== 'finished') abnormal++;
      if (i % 50 === 49) {
        const mu = process.memoryUsage();
        memoryCurveMB.push({ atMatch: i + 1, rss: Math.round(mu.rss / 1048576), heapUsed: Math.round(mu.heapUsed / 1048576) });
      }
    }
    const elapsedMs = performance.now() - t0;
    const endMem = process.memoryUsage();
    memoryCurveMB.push({ atMatch: trials, rss: Math.round(endMem.rss / 1048576), heapUsed: Math.round(endMem.heapUsed / 1048576) });
    void startMem;
    scenarios.push({
      name: `${n}p-T${cfg.balanceTier}`, players: n, tier: cfg.balanceTier,
      matches: trials, elapsedMs: Math.round(elapsedMs),
      matchesPerSec: Math.round(trials / (elapsedMs / 1000)),
      avgRounds: Math.round((rounds / trials) * 100) / 100,
      avgMsPerMatch: Math.round((elapsedMs / trials) * 10000) / 10000,
      abnormal,
    });
  }
  return {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    logicalCores: os.cpus().length,
    physicalCores: Math.max(1, Math.floor(os.cpus().length / 2)),
    totalMemoryMB: Math.round(os.totalmem() / 1048576),
    freeMemoryMB: Math.round(os.freemem() / 1048576),
    trialsPerScenario: trials,
    scenarios, memoryCurveMB,
    note: '单线程、真实引擎与 AI、DEFAULT_RULES(player/player)、悬浮遗迹；预热 30 局不计入。',
  };
}
