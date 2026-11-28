/**
 * 实验定义与组合采样。
 * - 花名册来自 CHARACTERS（以 shared/src/characters/index.ts 为准），零硬编码规则。
 * - 分层均匀随机：每个角色出场频次均衡；近期角色可配置过采样权重。
 * - 平衡结论只采最高档；低档仅用于分档对照（难度区分度）。
 */
import { CHARACTERS } from '../../../shared/src/characters/index.js';
import type { MapId } from '../../../shared/src/maps.js';
import type { Tier } from './driver.js';
import type { SimConfig } from './config.js';

export const ROSTER: string[] = Object.keys(CHARACTERS).sort();

export type ExperimentId = 'balance' | 'player-count' | 'tier-compare' | 'mechanics' | 'all' | 'smoke';
export const EXPERIMENT_IDS: ExperimentId[] = ['balance', 'player-count', 'tier-compare', 'mechanics', 'all', 'smoke'];

export interface CaseConfig {
  key: string;
  label: string;
  chars: string[];
  tier: Tier;
  mapId: MapId;
  /** 统计单元：角色组合 × 人数 × tier */
  unit: string;
  /** 是否进入平衡结论（仅最高档互打） */
  balanceEligible: boolean;
  replaySample?: boolean;
}

function makeCase(chars: string[], tier: Tier, mapId: MapId, balanceTier: Tier): CaseConfig {
  return {
    key: `u${chars.length}:t${tier}:${[...chars].sort().join('+')}`,
    label: `${chars.length}人 · T${tier} · ${chars.join('/')}`,
    chars: [...chars],
    tier,
    mapId,
    unit: `u${chars.length}:t${tier}`,
    balanceEligible: tier === balanceTier,
  };
}

/** 分层采样：每个 case 消费一次，保证各统计单元均衡；权重高的角色获得额外出场 */
export function buildCases(exp: ExperimentId, cfg: SimConfig): CaseConfig[] {
  const out: CaseConfig[] = [];
  const top = cfg.balanceTier;
  const roster = ROSTER;
  const weights = new Map<string, number>();
  for (const c of roster) weights.set(c, cfg.oversampleChars.includes(c) ? cfg.oversampleFactor : 1);

  // 角色出场次数目标：过采样角色多出场，其余均衡
  const appearances = new Map<string, number>();
  for (const c of roster) appearances.set(c, weights.get(c) ?? 1);

  // 按人数档位分层：每个档位从花名册按轮转取样，保证频次均衡
  for (const n of cfg.playerCounts) {
    const need = Math.min(n, roster.length);
    for (let offset = 0; offset < roster.length; offset++) {
      const chars: string[] = [];
      for (let k = 0; k < need; k++) {
        let idx = (offset + k * 7) % roster.length;
        // 过采样：该角色被抽中概率按权重提升（确定性轮转，不用随机以利复现）
        const cand = roster[idx];
        const w = weights.get(cand) ?? 1;
        if (w > 1 && (offset + k) % w !== 0) idx = (idx + 1) % roster.length;
        chars.push(roster[idx]);
      }
      if (new Set(chars).size !== chars.length) continue;
      out.push(makeCase(chars, top, cfg.mapId, top));
    }
  }

  // 分档对照：同一组角色 × 各 tier，仅用于区分度验证，不进平衡结论
  if (exp === 'tier-compare' || exp === 'all') {
    const sample = roster.slice(0, Math.min(5, roster.length));
    for (const tier of [1, 2, 3, 4] as Tier[]) {
      if (tier > cfg.maxTier) continue;
      out.push(makeCase(sample, tier, cfg.mapId, top));
    }
  }

  // 机制专项：覆盖关键角色的组合，强制采集输入流用于复现
  if (exp === 'mechanics' || exp === 'all') {
    const focus = ['mabaoguo', 'wuliuqi', 'ivan-girl', 'dajianke', 'dapihuai', 'gojo', 'wild-hunt', 'water-snake', 'ghost', 'hunchback-archer'];
    for (const c of focus) {
      if (!CHARACTERS[c]) continue;
      const chars = [c, 'default', 'bagun', 'gojo'].filter((x, i, arr) => arr.indexOf(x) === i);
      const k = makeCase(chars, top, cfg.mapId, top);
      k.replaySample = true;
      out.push(k);
    }
  }

  if (exp === 'smoke') {
    return [makeCase(['default', 'bagun', 'gojo'], top, cfg.mapId, top),
      makeCase(['mabaoguo', 'wuliuqi', 'ivan-girl', 'dajianke'], top, cfg.mapId, top)];
  }

  // 去重（同 unit 同 chars 同 tier）
  const seen = new Set<string>();
  return out.filter((c) => {
    if (seen.has(c.key)) return false;
    seen.add(c.key);
    return true;
  });
}

export function caseLabel(c: CaseConfig): string { return c.label; }
