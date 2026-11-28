/**
 * 跨次合并：多个结果目录增量、幂等合并为总 summary（亿级 = 多次运行叠加，支持续跑）。
 * 幂等键 = runId；同一 runId 重复合并不重复计数。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Snapshot } from './stats.js';

// CLI: node merge.js <dir1> <dir2> ... --out <outputDir>
const cliArgs = process.argv.slice(2);
if (cliArgs.length > 0 && cliArgs[0] !== '--help') {
  const outIdx = cliArgs.indexOf('--out');
  const outDir = outIdx >= 0 ? cliArgs[outIdx + 1] : './merged';
  const dirs = cliArgs.filter((a, i) => a !== '--out' && i !== outIdx + 1);
  const inputs = dirs.map((d) => readResult(d)).filter((x): x is MergeInput => x !== null);
  if (inputs.length === 0) {
    console.error('没有可合并的结果目录（需含 checkpoint.json）');
    process.exit(1);
  }
  const r = mergeAll(inputs, outDir);
  console.log(JSON.stringify({
    mergedRuns: r.runs, skippedDuplicateRunIds: r.skipped,
    totalMatches: r.snapshot.totalMatches,
    finishedMatches: r.snapshot.totalFinished,
    unitCount: Object.keys(r.snapshot.buckets).length,
    output: path.resolve(outDir, 'merged-summary.json'),
  }, null, 2));
}


export interface MergeInput {
  dir: string;
  runId: string;
  snapshot: Snapshot;
}

function atomicWrite(file: string, data: string): void {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** 从结果目录读取 checkpoint（含 runId 与 snapshot） */
export function readResult(dir: string): MergeInput | null {
  const cp = path.join(dir, 'checkpoint.json');
  if (!fs.existsSync(cp)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(cp, 'utf8')) as { runId?: string; snapshot?: Snapshot };
    if (!j.snapshot) return null;
    return { dir, runId: j.runId ?? path.basename(dir), snapshot: j.snapshot };
  } catch { return null; }
}

export function mergeAll(inputs: MergeInput[], outputDir: string): { snapshot: Snapshot; runs: string[]; skipped: string[] } {
  const seen = new Set<string>();
  const skipped: string[] = [];
  const runs: string[] = [];
  const merged: Snapshot = {
    buckets: {}, totalMatches: 0, totalFinished: 0, totalStall: 0, totalError: 0, totalDraws: 0,
  };

  for (const input of inputs) {
    if (seen.has(input.runId)) { skipped.push(input.runId); continue; }
    seen.add(input.runId);
    runs.push(input.runId);
    const s = input.snapshot;
    for (const [key, b] of Object.entries(s.buckets)) {
      const t = merged.buckets[key];
      if (!t) { merged.buckets[key] = structuredClone(b); continue; }
      for (const k of ['matches', 'finished', 'wins', 'draws', 'stall', 'error', 'roundsSum', 'roundsSqSum', 'stepsSum', 'aliveSum'] as const) {
        t[k] += b[k];
      }
      for (const [k, v] of Object.entries(b.winnerByChar)) t.winnerByChar[k] = (t.winnerByChar[k] ?? 0) + v;
      for (const [k, v] of Object.entries(b.actionCounts)) t.actionCounts[k] = (t.actionCounts[k] ?? 0) + v;
      for (const [k, v] of Object.entries(b.mechanics)) {
        const mm = t.mechanics as unknown as Record<string, number>;
        mm[k] = (mm[k] ?? 0) + v;
      }
    }
    merged.totalMatches += s.totalMatches;
    merged.totalFinished += s.totalFinished;
    merged.totalStall += s.totalStall;
    merged.totalError += s.totalError;
    merged.totalDraws += s.totalDraws;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  atomicWrite(path.join(outputDir, 'merged-summary.json'), JSON.stringify({
    _schema: 'BA-DIAN merged summary; key=runId idempotent; fields mirror checkpoint snapshot',
    generatedAt: new Date().toISOString(),
    runIds: runs,
    skippedDuplicateRunIds: skipped,
    snapshot: merged,
  }, null, 2));
  return { snapshot: merged, runs, skipped };
}
