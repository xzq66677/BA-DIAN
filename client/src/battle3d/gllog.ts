/**
 * 拔典 3D 战场 · GL 诊断日志（B-031 诊断体系）
 *
 * 职责：
 *  - 以环形缓冲记录 3D 渲染管线的关键生命周期事件（初始化 / 上下文丢失与恢复 /
 *    回退决策 / 资源释放 / 错误），每条自带时间戳、对局回合/阶段与场景统计；
 *  - 纯只读观测：不参与任何游戏逻辑、不订阅高频事件，对性能零感知级影响；
 *  - window.__b3log 暴露给取证脚本（entries / dump / clear）。
 */

export interface GlLogEntry {
  /** 真实时间戳（Date.now） */
  t: number;
  /** 页面加载起的毫秒（performance.now，便于与取证脚本对齐） */
  p: number;
  /** 事件名 */
  ev: string;
  /** 当前对局回合（未知为 -1） */
  round: number;
  /** 对局阶段（未知为 ''） */
  phase: string;
  /** 附加信息（渲染器 / 丢失计数 / 场景统计等） */
  info?: Record<string, unknown>;
}

const MAX_ENTRIES = 240;
const buffer: GlLogEntry[] = [];

/** 上下文提供方（由 Battle3D 注入：回合/阶段） */
let ctxProvider: () => { round: number; phase: string } = () => ({ round: -1, phase: '' });
/** 场景统计提供方（由 Battle3D 注入：debugStats + 渲染器） */
let statsProvider: () => Record<string, unknown> | null = () => null;

function perfNow(): number {
  try { return Math.round(performance.now()); } catch { return -1; }
}

/** 记录一条诊断事件。major=true 时同步输出到控制台（重大事件：丢失/恢复/回退/错误） */
function push(ev: string, info?: Record<string, unknown>, major = false): void {
  try {
    const { round, phase } = ctxProvider();
    const entry: GlLogEntry = { t: Date.now(), p: perfNow(), ev, round, phase, info };
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES) buffer.shift();
    if (major) {
      const stats = statsProvider();
      console.info(`[b3d] ${ev}`, info ?? '', `round=${round} phase=${phase}`, stats ? `scene=${JSON.stringify(stats)}` : '');
    }
  } catch { /* 诊断日志永不影响游戏 */ }
}

/** 环形缓冲快照（取证脚本用） */
function entries(): GlLogEntry[] {
  return buffer.slice();
}

/** 一行一条的文本导出（取证报告用） */
function dump(): string {
  return buffer.map((e) => {
    const info = e.info && Object.keys(e.info).length > 0 ? ` ${JSON.stringify(e.info)}` : '';
    return `${new Date(e.t).toISOString()} +${e.p}ms r${e.round} ${e.phase || '-'} ${e.ev}${info}`;
  }).join('\n');
}

function clear(): void {
  buffer.length = 0;
}

function setContext(p: () => { round: number; phase: string }): void {
  ctxProvider = p;
}

function setStats(p: () => Record<string, unknown> | null): void {
  statsProvider = p;
}

/** 取证探针（只读；不参与游戏逻辑） */
const probe = { entries, dump, clear };

if (typeof window !== 'undefined') {
  (window as unknown as { __b3log?: typeof probe }).__b3log = probe;
}

export const gllog = { push, entries, dump, clear, setContext, setStats };
