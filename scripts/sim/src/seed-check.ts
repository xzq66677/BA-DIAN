/**
 * 3-seed 稳健性复核：对关键头对头组合，用 3 个独立种子各跑 N 局，
 * 输出每个 seed 的胜率与支配率，验证单 seed 的平衡结论是否稳定。
 * 用法：node seed-check.js [每 seed 每组合局数，默认 5000]
 * 输出：seed-check.json 写到当前目录
 */
import fs from 'node:fs';
import { DEFAULT_CONFIG } from './config.js';
import { makeSpec, runMatch } from './driver.js';

const perSeed = Math.max(100, Number(process.argv[2] ?? 5000));
const seeds = [20261128, 31415926, 27182818];
const pairs: [string, string][] = [
  ['default', 'wild-hunt'],
  ['default', 'mabaoguo'],
  ['gojo', 'slot-hero'],
  ['hero-today', 'wild-hunt'],
  ['chuixiao', 'hunchback-archer'],
  ['dajianke', 'mabaoguo'],
];

const cfg = { ...DEFAULT_CONFIG, mapId: 'floatingRuins' as const };
type Row = { pair: string; seed: number; matches: number; winsA: number; winsB: number; draws: number; stall: number; rateA: number };
const rows: Row[] = [];

for (const [a, b] of pairs) {
  for (const seed of seeds) {
    let winsA = 0, winsB = 0, draws = 0, stall = 0;
    for (let i = 0; i < perSeed; i++) {
      const out = runMatch(makeSpec(cfg, [a, b], (seed + i * 2654435761) >>> 0, 3, { hashLogs: false }));
      if (out.endKind === 'stall') stall++;
      else if (out.winnerChar === a) winsA++;
      else if (out.winnerChar === b) winsB++;
      else draws++;
    }
    const decided = winsA + winsB;
    rows.push({
      pair: `${a} vs ${b}`, seed, matches: perSeed, winsA, winsB, draws, stall,
      rateA: decided > 0 ? +(winsA / decided).toFixed(4) : 0,
    });
    console.log(`[seed-check] ${a} vs ${b} seed=${seed} A胜率=${rows[rows.length - 1].rateA} STALL=${stall}`);
  }
}

const byPair = new Map<string, number[]>();
for (const r of rows) {
  if (!byPair.has(r.pair)) byPair.set(r.pair, []);
  byPair.get(r.pair)!.push(r.rateA);
}
const stability = [...byPair.entries()].map(([pair, rates]) => ({
  pair, rates, spread: +(Math.max(...rates) - Math.min(...rates)).toFixed(4),
  stable3: Math.max(...rates) - Math.min(...rates) <= 0.05,
}));

const result = { perSeed, seeds, rows, stability, allStable: stability.every((s) => s.stable3) };
fs.writeFileSync('./seed-check.json', JSON.stringify(result, null, 2) + '\n');
console.log(`[seed-check] allStable=${result.allStable} -> ./seed-check.json`);
