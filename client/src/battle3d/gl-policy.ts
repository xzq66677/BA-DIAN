/**
 * 拔典 3D 战场 · WebGL 上下文丢失的会话级降级策略（Phase C）
 *
 * 背景（B-031）：上下文丢失根因已定位（每渲染泄漏探测上下文 → Chromium 驱逐最旧
 * 存活上下文，实测复现）；本模块是残余风险的兜底策略——修复后若仍发生丢失
 * （驱动崩溃 / GPU 进程异常等环境因素），保证玩家对局不被反复打断：
 *
 *  - 每次丢失（无论是否恢复成功）都会计数（sessionStorage，跨 Game 页挂载存活）；
 *  - 会话累计丢失 ≥ 3 次，或 60s 内连续 ≥ 2 次 → 本会话持续降级 2D
 *    （sessionStorage 标记，避免「重建 3D → 再丢失」的循环崩溃）；
 *  - 用户在 UI 主动切回 3D 时清除降级标记（明确选择优先）；
 *  - 策略纯函数化，jsdom 可单测；不触碰游戏规则与结算。
 */

export const B3D_SESSION_KEY = 'badian-b3d-degraded';
export const B3D_LOST_COUNT_KEY = 'badian-b3d-lost';
/** 会话内允许的上下文丢失上限（第 3 次丢失即持久降级） */
export const B3D_MAX_LOST = 3;
/** 紧迫降级窗口：窗口内连续两次丢失 → 立即持久降级 */
export const B3D_DEGRADE_WINDOW_MS = 60_000;
/** 上下文丢失后的恢复等待窗口（GPU 进程重启/驱动恢复通常秒级，500ms 过短易误降级） */
export const B3D_RESTORE_WAIT_MS = 4000;

function safeGet(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, v: string): void {
  try { sessionStorage.setItem(key, v); } catch { /* ignore */ }
}
function safeDel(key: string): void {
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
}

/** 本会话是否已持久降级 2D */
export function isSessionDegraded(): boolean {
  return safeGet(B3D_SESSION_KEY) === '1';
}

/** 标记本会话持续降级（之后所有新挂载的 Game 页直接 2D） */
export function markSessionDegraded(): void {
  safeSet(B3D_SESSION_KEY, '1');
}

/** 用户主动切回 3D：清除降级标记（重新开始计数） */
export function clearSessionDegraded(): void {
  safeDel(B3D_SESSION_KEY);
}

export interface LostVerdict {
  /** 本会话累计丢失次数（含本次） */
  count: number;
  /** 是否应触发会话持久降级 */
  degrade: boolean;
  /** 降级原因（取证日志用；count=窗口连续 / total=累计上限） */
  reason: '' | 'rapid' | 'total';
}

/**
 * 记录一次上下文丢失，返回降级判定。
 * 已持久降级的会话不再累计（verdict 固定 degrade=true 保持语义一致）。
 */
export function recordContextLost(now = Date.now()): LostVerdict {
  if (isSessionDegraded()) return { count: readLostCount(), degrade: true, reason: 'total' };
  const count = readLostCount() + 1;
  safeSet(B3D_LOST_COUNT_KEY, String(count));
  // 紧迫窗口：近 60s 内已有另一次丢失 → 连续两次即降级
  try {
    const times: number[] = JSON.parse(safeGet('badian-b3d-lost-times') || '[]');
    const recent = times.filter((t) => now - t < B3D_DEGRADE_WINDOW_MS);
    recent.push(now);
    safeSet('badian-b3d-lost-times', JSON.stringify(recent.slice(-8)));
    if (recent.length >= 2) return finish(count, true, 'rapid');
  } catch { /* 时间窗判定失败时仅按累计数兜底 */ }
  return finish(count, count >= B3D_MAX_LOST, count >= B3D_MAX_LOST ? 'total' : '');
}

function finish(count: number, degrade: boolean, reason: LostVerdict['reason']): LostVerdict {
  if (degrade) markSessionDegraded();
  return { count, degrade, reason };
}

function readLostCount(): number {
  const v = Number(safeGet(B3D_LOST_COUNT_KEY) || '0');
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}
