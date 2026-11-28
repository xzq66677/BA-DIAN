/**
 * 机制统计埋点：只读扫描引擎已有 log.data，绝不修改引擎语义、不写日志。
 * 所有字段来自 shared/src/types.ts 的 DamageEventData / 结构化事件负载。
 */
import { CHARACTERS } from '../../../shared/src/characters/index.js';
import type { Game } from '../../../shared/src/engine.js';

export interface Mechanics {
  damage_events: number;
  damage_reflected: number;
  damage_transferred: number;
  ivan_explosion: number;
  wuliuqi_slash_segment: number;
  segmented_damage: number;
  rps_resolved: number;
  rps_tie: number;
  rps_alltie: number;
  rps_cycle: number;
  rps_tieAct: number;
  bujiangwude: number;
  whip5: number;
  insult_kill: number;
  hide: number;
  seek: number;
  tower_judge: number;
  parry_wildhunt: number;
  possess: number;
  tower_build: number;
}

export function emptyMechanics(): Mechanics {
  return {
    damage_events: 0, damage_reflected: 0, damage_transferred: 0,
    ivan_explosion: 0, wuliuqi_slash_segment: 0, segmented_damage: 0,
    rps_resolved: 0, rps_tie: 0, rps_alltie: 0, rps_cycle: 0, rps_tieAct: 0,
    bujiangwude: 0, whip5: 0, insult_kill: 0,
    hide: 0, seek: 0, tower_judge: 0, parry_wildhunt: 0, possess: 0, tower_build: 0,
  };
}

type LooseData = Record<string, unknown>;

function dataOf(log: { data?: unknown }): LooseData {
  return log.data && typeof log.data === 'object' ? (log.data as LooseData) : {};
}

export function aggregateMechanics(game: Game): Mechanics {
  const m = emptyMechanics();
  for (const log of game.logs) {
    const d = dataOf(log);
    if (log.type === 'damage') {
      m.damage_events++;
      if (d.reflected === true) m.damage_reflected++;
      if (d.transferred === true) m.damage_transferred++;
      const seg = d.segment as { index?: number; total?: number } | undefined;
      if (seg && typeof seg.total === 'number' && seg.total > 1) {
        m.segmented_damage++;
        if (seg.total === 3) m.wuliuqi_slash_segment++;
      }
      if (d.tag === 'ivan' || d.tag === 'ivanExplosion') m.ivan_explosion++;
      if (d.tag === 'whip') m.whip5++;
      if (d.tag === 'insult') m.insult_kill++;
      if (d.tag === 'bujiangwude') m.bujiangwude++;
    }
    if (d.ivanExplosion === true) m.ivan_explosion++;
    if (d.tieAct === true || d.domainActsOnTie === true) m.rps_tieAct++;
    if (d.kind === 'tower' || d.towerJudge === true || d.towerCollapse === true) m.tower_judge++;
    if (d.kind === 'wildhunt' || d.counter === true) m.parry_wildhunt++;
    if (d.kind === 'possess' || d.ghost !== undefined) m.possess++;
    if (d.kind === 'buildTower' || d.towerBuild === true) m.tower_build++;
    // 高塔建成日志携带 towerBaseRoom（飞天水螅 buildTower 完成时的 trigger 日志）
    if (typeof d.towerBaseRoom === 'string') m.tower_build++;
    // 行动日志数据字段为 actionName（引擎 ActionEventData）；兼容旧字段 action
    const action = d.actionName ?? d.action;
    if (action === 'hide') m.hide++;
    if (action === 'seek') m.seek++;
  }
  // 判定记录：引擎权威 judgeRecords（outcome 是权威枚举，不与日志重复计数）
  for (const rec of game.judgeRecords) {
    m.rps_resolved++;
    if (rec.outcome === 'alltie') m.rps_alltie++;
    if (rec.outcome === 'cycle') m.rps_cycle++;
    if (rec.outcome === 'tieAct') m.rps_tieAct++;
  }
  // 角色注册表仅用于诊断对照，不参与计数
  void CHARACTERS;
  return m;
}
