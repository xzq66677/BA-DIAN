/**
 * 死亡表现注册表（Issue #79）：死因 cause → 表现。
 *
 * 引擎在 `eliminate` 日志的 data.cause 给出死因（damage.ts 用伤害 tag；
 * 回合前触发统一用 `selfdestruct`，如大屁孩/老虎机三同自爆）。此前所有
 * 淘汰都渲染成通用「💀 淘汰」——自爆没有爆炸演出。2D 盖章、3D 淘汰演出、
 * 音效统一从这里读映射：新增爆炸类死因只在此登记，UI 主流程不写死因分支。
 */

/** 爆炸类死因：淘汰时以爆炸演出（火球+冲击波 / 💥 自爆盖章 / boom 音效）呈现 */
export const EXPLOSION_DEATHS: ReadonlySet<string> = new Set(['selfdestruct']);

export interface DeathStampView { text: string; cls: string }

/** 2D 死亡盖章：爆炸类死因 → 💥 自爆；其余 → 💀 淘汰 */
export function deathStamp(cause?: string): DeathStampView {
  if (cause && EXPLOSION_DEATHS.has(cause)) return { text: '💥 自爆', cls: 'death-stamp is-boom' };
  return { text: '💀 淘汰', cls: 'death-stamp' };
}

/** 是否以爆炸演出淘汰（3D 火球+冲击波、音效 boom） */
export function isExplosionDeath(cause?: string): boolean {
  return !!cause && EXPLOSION_DEATHS.has(cause);
}
