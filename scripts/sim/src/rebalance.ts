/**
 * 从已落盘 checkpoint 重新生成角色维度 balance.csv（不重跑对局）。
 * 用法：node rebalance.js <结果目录>
 */
import fs from 'node:fs';
import path from 'node:path';
import { wilsonCI, type Snapshot } from './stats.js';
import { DEFAULT_CONFIG } from './config.js';

const dir = process.argv[2] ?? './results';
const cp = JSON.parse(fs.readFileSync(path.join(dir, 'checkpoint.json'), 'utf8')) as { snapshot: Snapshot };
const cfg = DEFAULT_CONFIG;

const rows: (string | number)[][] = [
  ['# schema: char,tier,player_count,participated,wins,win_rate,ci_low,ci_hi,ci_half,low_confidence,avg_rounds,avg_alive,balance_eligible'],
  ['char', 'tier', 'player_count', 'participated', 'wins', 'win_rate', 'ci_low', 'ci_hi', 'ci_half', 'low_confidence', 'avg_rounds', 'avg_alive', 'balance_eligible'],
];
const agg = new Map<string, { participated: number; wins: number; roundsSum: number; aliveSum: number; eligible: boolean }>();
for (const [key, b] of Object.entries(cp.snapshot.buckets)) {
  const tier = Number(key.split(':')[1]?.replace('t', '') ?? 0);
  const count = Number(key.split(':')[0]?.replace('u', '') ?? 0);
  const chars = key.split(':').pop()?.split('+') ?? [];
  for (const ch of chars) {
    const rk = `${ch}|${tier}|${count}|${b.balanceEligible}`;
    let x = agg.get(rk);
    if (!x) { x = { participated: 0, wins: 0, roundsSum: 0, aliveSum: 0, eligible: b.balanceEligible }; agg.set(rk, x); }
    x.participated += b.matches;
    x.wins += b.winnerByChar[ch] ?? 0;
    x.roundsSum += b.roundsSum;
    x.aliveSum += b.aliveSum;
  }
}
for (const [rk, x] of agg) {
  const [ch, tier, count, eligible] = rk.split('|');
  const losses = Math.max(0, x.participated - x.wins);
  const ci = wilsonCI(x.wins, x.wins + losses, cfg.ciZ);
  const wr = x.wins + losses > 0 ? x.wins / (x.wins + losses) : 0;
  rows.push([ch, tier, count, x.participated, x.wins, wr.toFixed(4),
    ci.low.toFixed(4), ci.high.toFixed(4), ci.half.toFixed(4),
    ci.half > cfg.ciMaxHalfWidth || x.wins + losses < 100 ? 'true' : 'false',
    (x.roundsSum / Math.max(1, x.participated)).toFixed(2),
    (x.aliveSum / Math.max(1, x.participated)).toFixed(2), eligible]);
}
const csv = rows.map((r) => r.map((c) => {
  const s = String(c);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(',')).join('\n') + '\n';
fs.writeFileSync(path.join(dir, 'balance.csv'), csv);

// 同步重算 OUTLIER：以「单一角色拿走 >70% 胜局」为支配信号，而非「有胜者比例」
const summaryPath = path.join(dir, 'summary.json');
if (fs.existsSync(summaryPath)) {
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as {
    statistics: { outliers: { key: string; winRate: number; matches: number }[] };
  };
  const outliers: { key: string; winRate: number; matches: number }[] = [];
  for (const [key, b] of Object.entries(cp.snapshot.buckets)) {
    if (!b.balanceEligible) continue;
    const wins = Object.values(b.winnerByChar ?? {});
    const total = wins.reduce((a, n) => a + n, 0);
    if (total < 100 || wins.length < 2) continue;
    const top = Math.max(...wins) / total;
    if (top > 0.70) outliers.push({ key, winRate: top, matches: b.matches });
  }
  outliers.sort((a, b) => b.winRate - a.winRate);
  summary.statistics.outliers = outliers;
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  console.log(`[rebalance] OUTLIER ${outliers.length} 个（支配率口径）写入 summary.json`);
}
console.log(`[rebalance] ${agg.size} 角色统计单元写入 ${path.join(dir, 'balance.csv')}`);
