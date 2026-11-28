/**
 * replay <case>：从 failures.jsonl 读取一条最小重放载荷，精确复现单案例。
 * 用法：node scripts/sim/src/replay.js <failures.jsonl> <seed|行号> [--hash]
 */
import fs from 'node:fs';
import { replay, logSequenceHash, runMatch, makeSpec } from './driver.js';
import { DEFAULT_CONFIG } from './config.js';
import type { MatchTranscript } from '../../../shared/src/simulation-types.js';

const file = process.argv[2] ?? './failures.jsonl';
const key = process.argv[3];
const withHash = process.argv.includes('--hash');

const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
const recs = lines.map((l, i) => ({ i, j: JSON.parse(l) as { seed: number; replay: Record<string, unknown> | null } }));
const found = key ? recs.filter((r) => String(r.j.seed) === key || String(r.i) === key) : recs.slice(0, 1);
if (!found.length) { console.error('未找到案例', key); process.exit(1); }

for (const { i, j } of found.slice(0, 5)) {
  const payload = j.replay as unknown as {
    seed: number; chars: string[]; tier: 1 | 2 | 3 | 4; mapId: 'floatingRuins' | 'classic';
    rules: typeof DEFAULT_CONFIG.rules; maxRounds: number; transcript: MatchTranscript;
  } | null;
  if (!payload) { console.log(`#${i} seed=${j.seed} 无重放载荷`); continue; }
  let ok = true;
  let replayHash = '';
  let freshHash = '';
  try {
    const g = replay(payload.transcript);
    replayHash = withHash ? logSequenceHash(g.logs) : '';
    const spec = makeSpec({ ...DEFAULT_CONFIG, ...payload }, payload.chars, payload.seed, payload.tier, {
      mapId: payload.mapId, rules: payload.rules, maxRounds: payload.maxRounds,
      hashLogs: withHash, captureTranscript: false,
    });
    const fresh = runMatch(spec);
    freshHash = fresh.logHash ?? '';
    // STALL 局：引擎未 isOver()，由回合上限截断；重放只需日志 hash + winner 一致
    ok = replayHash === freshHash && (g.winner ?? null) === (fresh.winner ?? null) && g.roundNo === fresh.rounds;
  } catch (e) { ok = false; replayHash = String(e); }
  console.log(JSON.stringify({
    line: i, seed: payload.seed, chars: payload.chars, tier: payload.tier,
    steps: payload.transcript.inputs.length, replayOk: ok,
    replayHash, freshHash, replayOver: undefined,
  }));
}
