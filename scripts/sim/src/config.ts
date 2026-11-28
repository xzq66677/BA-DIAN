/**
 * BA-DIAN 离线蒙特卡洛参数表（默认值与规格书一致）
 * 规则零改动：所有规则参数直接来自 shared/src/types.ts 的 DEFAULT_RULES。
 */
import os from 'node:os';
import { DEFAULT_RULES, type AiDifficulty, type RuleConfig } from '../../../shared/src/types.js';
import type { MapId } from '../../../shared/src/maps.js';
import { slotHeroChar } from '../../../shared/src/characters/slot-hero.js';

export const HARNESS_VERSION = '2.0.0';

/**
 * tier 契约：模拟层只认 tier，不感知策略实现。
 * 第四档（宗师）已接入：映射到 shared/src/characters/ai-expert.ts 的角色专属策略注册表。
 */
export const TIER_TO_DIFFICULTY: Record<1 | 2 | 3 | 4, AiDifficulty> = {
  1: 'easy',
  2: 'normal',
  3: 'hard',
  4: 'expert',
};
export const TIER4_READY = true;

/** 近期新增角色（过采样权重 ×2，可用 --oversample-chars 覆盖） */
export const RECENT_CHARACTERS: readonly string[] = [
  'hunchback-archer', 'ghost', 'wild-hunt', 'water-snake', slotHeroChar.id,
];

export interface SimConfig {
  playerCounts: number[];
  rules: RuleConfig;
  mapId: MapId;
  /** 平衡结论只采最高档 */
  balanceTier: 1 | 2 | 3 | 4;
  maxTier: 1 | 2 | 3 | 4;
  maxRounds: number;
  durationSec: number;
  workers: number;
  batchSize: number;
  checkpointSec: number;
  oversampleFactor: number;
  oversampleChars: string[];
  ciZ: number;
  ciMaxHalfWidth: number;
  hashMode: 'full' | 'light';
  seed: number;
  runId: string;
  outDir: string;
  targetMatches: number;
}

const physicalCores = Math.max(1, Math.floor(os.cpus().length / 2));

export const DEFAULT_CONFIG: SimConfig = {
  playerCounts: [2, 3, 4, 6, 10],
  rules: { ...DEFAULT_RULES },
  mapId: 'floatingRuins',
  balanceTier: 4,
  maxTier: 4,
  maxRounds: 200,
  durationSec: 3600,
  workers: Math.max(1, physicalCores - 1),
  batchSize: 2000,
  checkpointSec: 30,
  oversampleFactor: 2,
  oversampleChars: [...RECENT_CHARACTERS],
  ciZ: 1.96,
  ciMaxHalfWidth: 0.03,
  hashMode: 'light',
  seed: Date.now() >>> 0,
  runId: '',
  outDir: './sim-out',
  targetMatches: 0,
};

/** runId 参与种子派生：跨次运行不重复 */
export function makeRunId(now = Date.now()): string {
  return `${new Date(now).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${(now % 100000).toString(36).padStart(4, '0')}`;
}

/** FNV-1a 32bit：种子派生与轻量指纹共用，确定性且与 Node 版本无关 */
export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function deriveSeed(runId: string, workerId: number, gameIndex: number, baseSeed: number): number {
  return fnv1a32(`${baseSeed >>> 0}|${runId}|${workerId}|${gameIndex}`);
}
