/**
 * 正确性闸门：固定 seed 集 1000 局 + 共享 testcase 对照 + 位级重放一致。
 * 全部通过才允许进入全量跑；一键脚本第一步调用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeSpec, runMatch, logSequenceHash } from './driver.js';
import { DEFAULT_CONFIG } from './config.js';
import { ROSTER } from './experiments.js';
import { ALL_CASES } from '../../../shared/src/testcases/index.js';
import { Aggregator } from './stats.js';

const cfg = { ...DEFAULT_CONFIG, mapId: 'floatingRuins' as const, rules: { ...DEFAULT_CONFIG.rules } };
const N = 1000;
const results: { name: string; ok: boolean; detail: string }[] = [];

// 1) 规则参数口径：DEFAULT_RULES 必须是 player/player，与线上房间默认一致
results.push({
  name: 'rules-default-player-mode',
  ok: cfg.rules.skillJudgeMode === 'player' && cfg.rules.secondJudgeMode === 'player',
  detail: `skillJudgeMode=${cfg.rules.skillJudgeMode} secondJudgeMode=${cfg.rules.secondJudgeMode}`,
});

// 2) 1000 局固定 seed：全 tier × 人数档位，全部有确定终局（finished 或 stall），无 ERROR
let errors = 0, stalls = 0, finished = 0;
const tiers = [1, 2, 3, 4] as const; // 四档全覆盖（含宗师角色专属策略）
for (let i = 0; i < N; i++) {
  const tier = tiers[i % tiers.length];
  const n = cfg.playerCounts[i % cfg.playerCounts.length];
  const chars = ROSTER.slice((i * 3) % (ROSTER.length - n + 1), (i * 3) % (ROSTER.length - n + 1) + n);
  const out = runMatch(makeSpec(cfg, chars, 1000003 + i, tier, {
    hashLogs: i < 60, captureTranscript: false,
  }));
  if (out.endKind === 'error') errors++;
  else if (out.endKind === 'stall') stalls++;
  else finished++;
}
results.push({ name: '1000-matches-no-error', ok: errors === 0, detail: `finished=${finished} stall=${stalls} error=${errors}` });

// 3) 位级确定性：同 seed 两次跑日志 hash 逐字一致（60 个样本）
let hashMismatch = 0;
for (let i = 0; i < 60; i++) {
  const chars = ROSTER.slice(0, 3 + (i % 3));
  const spec = makeSpec(cfg, chars, 2000003 + i, 3, { hashLogs: true });
  const a = runMatch(spec), b = runMatch(spec);
  if (a.logHash !== b.logHash) hashMismatch++;
}
results.push({ name: 'bitwise-determinism', ok: hashMismatch === 0, detail: `60 样本，hash 不一致 ${hashMismatch}` });

// 4) 输入流重放：完整 transcript 重放后日志 hash 逐字一致
let replayMismatch = 0;
for (let i = 0; i < 30; i++) {
  const chars = ROSTER.slice(0, 3 + (i % 4));
  const seed = 3000003 + i;
  const spec = makeSpec(cfg, chars, seed, 3, { hashLogs: true, captureTranscript: true });
  const out = runMatch(spec);
  if (!out.transcript) { replayMismatch++; continue; }
  // 用 replay 模块重建（动态 import 避免顶层耦合）
  const { replay } = await import('./driver.js');
  const g = replay(out.transcript);
  if (logSequenceHash(g.logs) !== out.logHash) replayMismatch++;
}
results.push({ name: 'input-stream-replay', ok: replayMismatch === 0, detail: `30 样本，重放 hash 不一致 ${replayMismatch}` });

// 5) 共享 testcase 口径：直接跑 shared/src/testcases 的 130 个用例（只读，不改引擎）
let tcPass = 0, tcFail = 0;
for (const c of ALL_CASES) {
  try { if (c.run().pass) tcPass++; else tcFail++; } catch { tcFail++; }
}
results.push({ name: 'shared-testcases', ok: tcFail === 0, detail: `pass=${tcPass} fail=${tcFail}` });

// 6) Worker→主控增量聚合回归：drain 上报 delta 不得重复累加历史批次
const local = new Aggregator(new Map([['regression', { unit: 'u2', balanceEligible: true }]]));
const master = new Aggregator(new Map());
for (let i = 0; i < 5; i++) {
  local.add('regression', runMatch(makeSpec(cfg, ROSTER.slice(0, 2), 4000003 + i, 3)));
  if (i % 2 === 1) master.merge(local.drain());
}
master.merge(local.drain());
const merged = master.snapshot().totalMatches;
results.push({ name: 'delta-aggregation', ok: merged === 5, detail: `5 局分 3 批上报，合并后 ${merged} 局（应为 5）` });
void path; void fileURLToPath; void pathToFileURL; void fs;

const allOk = results.every((r) => r.ok);
console.log(JSON.stringify({ allOk, results }, null, 2));
process.exit(allOk ? 0 : 1);
