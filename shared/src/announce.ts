/**
 * 拔典 · 全局播报（Global Announce）
 *
 * 目标（Issue #39 / TASKS.md T-6.0.1）：
 *  「每个动作都所有人可见，并且有反馈时间」——不再需要翻战斗日志才知道场上发生了什么。
 *
 * 设计约束：
 *  1. **零规则侵入**：播报完全由引擎已产出的 `LogEntry` 派生，不改数值、不改结算顺序，
 *     只读 `type` / `text` / `data` / `important` 这些对外公开字段。
 *  2. **服务端权威**：服务端把增量日志一次性转成 `AnnounceItem[]` 随 `room:update` 广播，
 *     同一房间所有座位拿到**同一份**播报（内容、顺序、`ts` 完全一致），因此「所有人可见」。
 *  3. **有反馈时间**：每条播报带 `ts`（服务端毫秒时刻）与 `ttlMs`（建议展示时长）；
 *     客户端用 `fmtAnnounceClock()` 显示 `HH:MM:SS`，并在抽屉里标注展示时长。
 *  4. **可复用接口**：新增动作/技能只要引擎写了日志，就会自动被兜底规则接住；
 *     需要定制图标/优先级/文案时，用 `registerAnnounceRule()` 插一条规则即可，
 *     服务端与客户端都不需要改代码（详见 README「全局播报」）。
 *
 * 纯函数、零外部依赖，可同时在 Node 服务端与浏览器客户端运行。
 */

export const ANNOUNCE_VERSION = 1;

/** 播报色调：决定横幅/列表的配色（前端只认这几种，未知值降级为 info） */
export type AnnounceTone = 'info' | 'action' | 'combat' | 'danger' | 'reward' | 'system';

/**
 * 播报优先级：
 *  - high   ：淘汰 / 终局 / 领域 / 致命伤害 —— 横幅必播，拥堵时保留
 *  - normal ：普通动作 / 伤害 / 移动 / 回复 —— 横幅按序播放
 *  - low    ：阶段提示 / 未命中 / 系统信息 —— 只进播报抽屉，不抢镜头
 */
export type AnnouncePriority = 'high' | 'normal' | 'low';

export const ANNOUNCE_PRIORITY_RANK: Record<AnnouncePriority, number> = {
  high: 3,
  normal: 2,
  low: 1,
};

/** 单批播报上限（有界历史：广播层与客户端都按此截断，防止刷屏拖垮长局） */
export const ANNOUNCE_MAX_ITEMS = 80;

/** 单条播报文本上限（横幅单行展示，超出截断；完整内容仍在战斗日志里） */
export const ANNOUNCE_MAX_TEXT = 64;

/** 各档建议展示时长（ms）。排队播放的总时长由队首逐条累计。 */
export const ANNOUNCE_TTL = {
  /** 阶段 / 低价值提示 */
  brief: 1000,
  /** 普通动作 */
  action: 1500,
  /** 战斗结果（伤害 / 回复 / 移动） */
  combat: 1700,
  /** 重大事件（淘汰 / 领域 / 复活 / 终局） */
  major: 2400,
  /** 里程碑（喝牛奶 / 今日运势这类「全场都在看」的事件） */
  spotlight: 2200,
} as const;

/** 一条已成型、可直接渲染的播报 */
export interface AnnounceItem {
  /** 稳定唯一 id（`a-<seq>`，seq 跨局单调递增，客户端据此去重） */
  id: string;
  /** 来源日志序号（同一房间跨局续接，全局单调） */
  seq: number;
  /** 服务端生成时刻（ms）。客户端显示 HH:MM:SS —— 即「反馈时间」 */
  ts: number;
  round: number;
  sub: number;
  phase?: string;
  icon: string;
  /** 纯文本（不含图标；图标单独给 icon） */
  text: string;
  tone: AnnounceTone;
  priority: AnnouncePriority;
  /** 建议展示时长（ms） */
  ttlMs: number;
  /** 命中的规则 id（可复用接口：前端可据此埋点/定制，未知时按 tone 渲染） */
  rule: string;
  /** 行动者 / 目标 / 房间（可选，供后续「点击播报定位」类增强使用） */
  actorId?: string;
  targetId?: string;
  room?: string;
}

/** 播报只需要日志的公开只读字段（LogEntry / SnapLog / 测试构造的日志都满足） */
export interface AnnounceLogLike {
  seq: number;
  round?: number;
  sub?: number;
  phase?: string;
  /** LogType；旧数据可能缺省 */
  type?: string;
  text?: string;
  important?: boolean;
  data?: Record<string, unknown>;
}

export interface AnnounceContext {
  /** 玩家名映射（pid → 显示名）；缺失时播报用 pid 兜底 */
  names?: Record<string, string>;
  /** 生成时刻（服务端传 `Date.now()`；测试可注入固定值以获得确定性） */
  now?: number;
  /** 单批上限（默认 ANNOUNCE_MAX_ITEMS） */
  limit?: number;
}

/** 规则产出的播报草案（尚未带 id/ts/round 等批次字段） */
export interface AnnounceDraft {
  icon: string;
  text: string;
  tone: AnnounceTone;
  priority: AnnouncePriority;
  ttlMs: number;
  actorId?: string;
  targetId?: string;
  room?: string;
}

/**
 * 规则命中结果：
 *  - `AnnounceDraft`：生成播报
 *  - `'skip'`：这条日志**故意不播报**（例如与另一条结构化日志重复），且阻止兜底规则接管
 *  - `null`：不匹配，继续尝试下一条规则
 */
export type AnnounceMatch = AnnounceDraft | 'skip' | null;

export type NameOf = (id?: string) => string;

export interface AnnounceRule {
  /** 规则 id（稳定标识，会写进 AnnounceItem.rule） */
  id: string;
  /** 一行说明（README / 调试面板用） */
  summary?: string;
  match: (log: AnnounceLogLike, nameOf: NameOf) => AnnounceMatch;
}

// ─── 工具 ────────────────────────────────────────────────────

function data(log: AnnounceLogLike): Record<string, unknown> {
  return log.data ?? {};
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * 去掉日志文本开头的 emoji / 装饰符，避免与播报图标重复。
 * 只剥离开头的非文字字符（保留「（ 等中文排版符号）。
 */
export function stripLogIcon(text: string): string {
  return text.replace(/^[^\p{L}\p{N}「（(]+/u, '').trim();
}

/** 截断过长文本（按字符计，中文友好） */
export function clampAnnounceText(text: string, max = ANNOUNCE_MAX_TEXT): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** 播报时间戳 → `HH:MM:SS`（本地时区；服务端 ts 与客户端时钟无关，展示的是房间时间线） */
export function fmtAnnounceClock(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '--:--:--';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 展示时长 → `1.7s`（播报抽屉里标注「这条横幅会停留多久」） */
export function fmtAnnounceTtl(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── 内置规则表 ──────────────────────────────────────────────
//
// 顺序敏感：特殊事件在前，通用动作在后，兜底规则永远最后。
// 新增规则请用 registerAnnounceRule()，不要直接改这个数组（内置表是「默认行为」的快照）。

const FX_ICON: Record<string, string> = {
  attack: '⚔️', heal: '💊', move: '🚶', milk: '🥛',
  skill: '✨', aim: '🎯', hide: '🙈', seek: '🔍', skip: '⏭',
};

const BUILTIN_RULES: AnnounceRule[] = [
  {
    id: 'milk',
    summary: '喝牛奶：全场可见的嘲讽动作（无实际效果，但有仪式感）',
    match(log, nameOf) {
      if (log.type !== 'action') return null;
      const d = data(log);
      if (d.fx !== 'milk') return null;
      const pid = str(d.pid);
      if (!pid) return null;
      return {
        icon: '🥛',
        text: `${nameOf(pid)} 喝了一口牛奶，向全场发出嘲讽！`,
        tone: 'action',
        priority: 'normal',
        ttlMs: ANNOUNCE_TTL.spotlight,
        actorId: pid,
      };
    },
  },
  {
    id: 'fortune',
    summary: '今日勇者抽取运势（掷点 / 面板转换 / 暴毙）',
    match(log, nameOf) {
      if (log.type !== 'trigger') return null;
      const d = data(log);
      if (d.fortune !== true) return null;
      const pid = str(d.pid);
      const roll = num(d.roll);
      const detail = log.text ? stripLogIcon(log.text) : '';
      // 日志文本已含完整结果（含暴毙 / 面板转换），优先原样播报，保证与规则一致
      const text = detail || `${nameOf(pid)} 抽取今日运势：掷出 ${roll ?? '?'}`;
      return {
        icon: '🎰',
        text: clampAnnounceText(text),
        tone: 'reward',
        priority: 'high',
        ttlMs: ANNOUNCE_TTL.major,
        ...(pid ? { actorId: pid } : {}),
      };
    },
  },
  {
    id: 'domain',
    summary: '领域展开 / 领域覆盖（重大事件，全场聚焦）',
    match(log, nameOf) {
      if (log.type !== 'trigger') return null;
      const d = data(log);
      if (d.domain !== true) return null;
      const pid = str(d.pid);
      const text = log.text ? stripLogIcon(log.text) : `${nameOf(pid)} 展开领域！`;
      return {
        icon: '🌀',
        text: clampAnnounceText(text),
        tone: 'danger',
        priority: 'high',
        ttlMs: ANNOUNCE_TTL.major,
        ...(pid ? { actorId: pid } : {}),
      };
    },
  },
  {
    id: 'revive',
    summary: '命数消耗复活（五条悟等）',
    match(log, nameOf) {
      if (log.type !== 'trigger') return null;
      const d = data(log);
      const pid = str(d.pid);
      const lives = num(d.livesLeft);
      if (!pid || lives === undefined) return null;
      return {
        icon: '✨',
        text: clampAnnounceText(log.text ? stripLogIcon(log.text) : `${nameOf(pid)} 复活（剩余 ${lives} 条命）`),
        tone: 'reward',
        priority: 'high',
        ttlMs: ANNOUNCE_TTL.major,
        actorId: pid,
      };
    },
  },
  {
    id: 'eliminate',
    summary: '淘汰（含击杀者与原因）',
    match(log, nameOf) {
      if (log.type !== 'eliminate') return null;
      const d = data(log);
      const pid = str(d.pid);
      if (!pid) return null;
      const killer = str(d.killer);
      const cause = str(d.cause);
      const tail = killer ? `，击杀者 ${nameOf(killer)}` : cause ? `（${cause}）` : '';
      return {
        icon: '☠',
        text: `${nameOf(pid)} 被淘汰${tail}`,
        tone: 'danger',
        priority: 'high',
        ttlMs: ANNOUNCE_TTL.major,
        actorId: pid,
      };
    },
  },
  {
    id: 'damage',
    summary: '攻击宣告 / 未命中 / 实际扣血（三态，阈值与演出层同源）',
    match(log, nameOf) {
      if (log.type !== 'damage' && log.type !== 'state') return null;
      const d = data(log);
      const target = str(d.target);
      const source = str(d.source);
      // 攻击宣告（出手意向）
      if (d.declared === true) {
        if (!source || !target) return null;
        const amount = num(d.amount);
        return {
          icon: '⚔️',
          text: `${nameOf(source)} 向 ${nameOf(target)} 出手${amount !== undefined ? `（${amount} 点）` : ''}`,
          tone: 'combat',
          priority: 'normal',
          ttlMs: ANNOUNCE_TTL.brief,
          actorId: source,
          targetId: target,
          ...(str(d.room) ? { room: str(d.room) } : {}),
        };
      }
      // 未命中 / 被抵消
      if (d.missed === true) {
        if (!target) return null;
        return {
          icon: '💨',
          text: `${nameOf(target)} 躲开了${source ? `${nameOf(source)} 的` : ''}攻击`,
          tone: 'info',
          priority: 'low',
          ttlMs: ANNOUNCE_TTL.brief,
          ...(source ? { actorId: source } : {}),
          targetId: target,
        };
      }
      // 实际扣血（演出层的唯一权威来源）
      const amount = num(d.amount);
      if (!target || amount === undefined) return null;
      const hpBefore = num(d.hpBefore);
      const hpAfter = num(d.hpAfter);
      const lethal = d.lethal === true || hpAfter === 0;
      const hp = hpBefore !== undefined && hpAfter !== undefined ? `（HP ${hpBefore}→${hpAfter}）` : '';
      return {
        icon: lethal ? '💥' : '⚔️',
        text: `${source ? `${nameOf(source)} → ` : ''}${nameOf(target)} 受到 ${amount} 点伤害${hp}${lethal ? '，致命！' : ''}`,
        tone: lethal ? 'danger' : 'combat',
        priority: lethal ? 'high' : 'normal',
        ttlMs: lethal ? ANNOUNCE_TTL.major : ANNOUNCE_TTL.combat,
        ...(source ? { actorId: source } : {}),
        targetId: target,
        ...(str(d.room) ? { room: str(d.room) } : {}),
      };
    },
  },
  {
    id: 'heal',
    summary: '回复（含满血无消耗的提示）',
    match(log, nameOf) {
      if (log.type !== 'heal') return null;
      const d = data(log);
      const target = str(d.target);
      if (!target) return null;
      const amount = num(d.amount);
      const hpBefore = num(d.hpBefore);
      const hpAfter = num(d.hpAfter);
      const hp = hpBefore !== undefined && hpAfter !== undefined ? `（HP ${hpBefore}→${hpAfter}）` : '';
      return {
        icon: '💚',
        text: amount !== undefined
          ? `${nameOf(target)} 回复 ${amount} 点${hp}`
          : `${nameOf(target)} 回复${hp}`,
        tone: 'reward',
        priority: 'normal',
        ttlMs: ANNOUNCE_TTL.combat,
        ...(str(d.source) ? { actorId: str(d.source) } : {}),
        targetId: target,
      };
    },
  },
  {
    id: 'move',
    summary: '房间移动（from → to）',
    match(log, nameOf) {
      if (log.type !== 'move') return null;
      const d = data(log);
      const pid = str(d.pid);
      const from = str(d.from);
      const to = str(d.to);
      if (!pid || !from || !to) return null;
      return {
        icon: '🚶',
        text: `${nameOf(pid)} 从 ${from} 移动到 ${to}`,
        tone: 'action',
        priority: 'normal',
        ttlMs: ANNOUNCE_TTL.combat,
        actorId: pid,
        room: to,
      };
    },
  },
  {
    id: 'deferred',
    summary: '延迟事件：大伊万投掷 / 爆炸',
    match(log, nameOf) {
      if (log.type !== 'deferred') return null;
      const d = data(log);
      const room = str(d.room);
      const pid = str(d.pid);
      const source = str(d.source);
      if (pid && room) {
        return {
          icon: '💣',
          text: `${nameOf(pid)} 把大伊万丢向 ${room}（第 ${num(d.explodeRound) ?? '?'} 回合末爆炸）`,
          tone: 'danger',
          priority: 'high',
          ttlMs: ANNOUNCE_TTL.major,
          actorId: pid,
          room,
        };
      }
      if (room) {
        return {
          icon: '💥',
          text: `大伊万在 ${room} 爆炸！`,
          tone: 'danger',
          priority: 'high',
          ttlMs: ANNOUNCE_TTL.major,
          ...(source ? { actorId: source } : {}),
          room,
        };
      }
      return null;
    },
  },
  {
    id: 'judge',
    summary: '判定过程与结果（揭示台已展示，播报留档）',
    match(log) {
      if (log.type !== 'judge') return null;
      if (!log.text) return null;
      return {
        icon: '🎲',
        text: clampAnnounceText(stripLogIcon(log.text)),
        tone: 'info',
        priority: log.important ? 'normal' : 'low',
        ttlMs: ANNOUNCE_TTL.brief,
      };
    },
  },
  {
    id: 'order',
    summary: '行动顺序（二次判定结果）',
    match(log) {
      if (log.type !== 'order') return null;
      if (!log.text) return null;
      return {
        icon: '🔀',
        text: clampAnnounceText(stripLogIcon(log.text)),
        tone: 'system',
        priority: 'normal',
        ttlMs: ANNOUNCE_TTL.action,
      };
    },
  },
  {
    id: 'result',
    summary: '回合小结 / 终局判定',
    match(log) {
      if (log.type !== 'result') return null;
      if (!log.text) return null;
      return {
        icon: '🏁',
        text: clampAnnounceText(stripLogIcon(log.text)),
        tone: 'reward',
        priority: 'high',
        ttlMs: ANNOUNCE_TTL.major,
      };
    },
  },
  {
    id: 'trigger',
    summary: '其它技能 / 被动触发（原文播报）',
    match(log) {
      if (log.type !== 'trigger') return null;
      if (!log.text) return null;
      return {
        icon: '✨',
        text: clampAnnounceText(stripLogIcon(log.text)),
        tone: 'action',
        priority: log.important ? 'normal' : 'low',
        ttlMs: ANNOUNCE_TTL.action,
        ...(str(data(log).pid) ? { actorId: str(data(log).pid) } : {}),
      };
    },
  },
  {
    id: 'action',
    summary: '通用行动（攻击 / 技能 / 瞄准 / 躲藏 / 寻找 / 跳过）',
    match(log, nameOf) {
      if (log.type !== 'action') return null;
      const d = data(log);
      const pid = str(d.pid);
      // 旧格式（无结构化 data）：不播报，交给后续兜底也只会重复噪声；
      // 引擎对同一动作会同时写一条带 data 的 action 日志，这里直接跳过。
      if (!pid) return 'skip';
      const fx = str(d.fx) ?? 'skill';
      // 移动 / 回复 / 喝牛奶有更结构化的专用日志，避免同动作播报两次
      if (fx === 'move' || fx === 'heal' || fx === 'milk') return 'skip';
      const label = str(d.label) ?? '行动';
      const target = str(d.targetId);
      const room = str(d.room);
      const tail = room && fx === 'move' ? `（${room}）` : '';
      return {
        icon: FX_ICON[fx] ?? '✨',
        text: `${nameOf(pid)} ${label}${target ? ` → ${nameOf(target)}` : ''}${tail}`,
        tone: fx === 'attack' ? 'combat' : 'action',
        priority: 'normal',
        ttlMs: ANNOUNCE_TTL.action,
        actorId: pid,
        ...(target ? { targetId: target } : {}),
        ...(room ? { room } : {}),
      };
    },
  },
  {
    id: 'phase',
    summary: '阶段推进 / 等待某人行动（低优先级，只进播报抽屉）',
    match(log) {
      if (log.type !== 'phase') return null;
      if (!log.text) return null;
      return {
        icon: '⏱️',
        text: clampAnnounceText(stripLogIcon(log.text)),
        tone: 'system',
        priority: 'low',
        ttlMs: ANNOUNCE_TTL.brief,
      };
    },
  },
  {
    id: 'error',
    summary: '引擎错误（必须可见）',
    match(log) {
      if (log.type !== 'error') return null;
      return {
        icon: '❌',
        text: clampAnnounceText(log.text ? stripLogIcon(log.text) : '引擎异常'),
        tone: 'danger',
        priority: 'high',
        ttlMs: ANNOUNCE_TTL.major,
      };
    },
  },
  {
    id: 'fallback',
    summary: '兜底：任何带文本的日志都至少进播报（保证「每个动作可见」）',
    match(log) {
      if (!log.text) return null;
      return {
        icon: log.important ? '❗' : '·',
        text: clampAnnounceText(stripLogIcon(log.text)),
        tone: log.important ? 'action' : 'info',
        priority: log.important ? 'normal' : 'low',
        ttlMs: ANNOUNCE_TTL.brief,
      };
    },
  },
];

/** 运行期规则表（内置 + 各模块通过 registerAnnounceRule 追加） */
let registry: AnnounceRule[] = [...BUILTIN_RULES];

/**
 * 注册一条播报规则（可复用扩展点）。
 *
 * 用法：
 * ```ts
 * const off = registerAnnounceRule({
 *   id: 'my-skill',
 *   summary: '我的新技能',
 *   match: (log, nameOf) => (log.data?.mySkill ? { icon: '🔥', text: '…', tone: 'danger', priority: 'high', ttlMs: 2000 } : null),
 * });
 * // 不再需要时 off() 撤销（测试/热重载干净）
 * ```
 *
 * 默认插在规则表**最前**（新注册的专用规则优先于内置通用规则，符合直觉）；
 * 需要让内置规则先匹配时，用 `opts.before` 指定位置（如 `before: 'fallback'`）。
 *
 * @param rule   规则；`id` 重复会替换旧规则（避免同一技能被注册两次）
 * @param opts.before 插到某条规则之前（内置：milk/fortune/domain/revive/eliminate/
 *        damage/heal/move/deferred/judge/order/result/trigger/action/phase/error/fallback）
 * @returns 撤销函数
 */
export function registerAnnounceRule(rule: AnnounceRule, opts: { before?: string } = {}): () => void {
  const prev = registry;
  const next = registry.filter((r) => r.id !== rule.id);
  const at = opts.before ? next.findIndex((r) => r.id === opts.before) : 0;
  if (at >= 0) next.splice(at, 0, rule);
  else next.push(rule);
  registry = next;
  return () => {
    // 只回滚本次注册（若期间别人又改过规则表，保留他们的改动）
    registry = registry.filter((r) => r.id !== rule.id);
    for (const r of prev) if (!registry.some((x) => x.id === r.id)) registry.push(r);
  };
}

/** 当前生效的规则表（只读快照，顺序即匹配顺序） */
export function listAnnounceRules(): AnnounceRule[] {
  return [...registry];
}

/** 恢复内置规则表（测试与运行时重置用） */
export function resetAnnounceRules(): void {
  registry = [...BUILTIN_RULES];
}

/** 对单条日志跑一遍规则表；返回 null 表示不播报 */
function matchAnnounce(log: AnnounceLogLike, nameOf: NameOf): (AnnounceDraft & { rule: string }) | null {
  for (const rule of registry) {
    const m = rule.match(log, nameOf);
    if (m === 'skip') return null;
    if (m) return { ...m, text: clampAnnounceText(m.text), rule: rule.id };
  }
  return null;
}

/**
 * 把一批日志转成播报项（服务端广播 / 回放 / 离线降级共用）。
 *
 * - 同一 `seq` 只产出一次（幂等：重复推送同一批日志不会重复播报）
 * - 保持日志原始顺序（= 场上发生顺序）
 * - 超出 `limit` 时保留最新的一批（旧播报已被抽屉滚走，横幅只关心近况）
 */
export function buildAnnouncements(
  logs: readonly AnnounceLogLike[],
  ctx: AnnounceContext = {},
): AnnounceItem[] {
  const now = ctx.now ?? Date.now();
  const limit = Math.max(1, ctx.limit ?? ANNOUNCE_MAX_ITEMS);
  const names = ctx.names ?? {};
  const nameOf: NameOf = (id) => (id ? names[id] ?? id : '');
  const out: AnnounceItem[] = [];
  const seen = new Set<number>();
  for (const log of logs) {
    if (!log || typeof log.seq !== 'number' || seen.has(log.seq)) continue;
    const m = matchAnnounce(log, nameOf);
    if (!m) continue;
    seen.add(log.seq);
    out.push({
      id: `a-${log.seq}`,
      seq: log.seq,
      ts: now,
      round: log.round ?? 0,
      sub: log.sub ?? 0,
      ...(log.phase ? { phase: log.phase } : {}),
      icon: m.icon,
      text: m.text,
      tone: m.tone,
      priority: m.priority,
      ttlMs: m.ttlMs,
      rule: m.rule,
      ...(m.actorId ? { actorId: m.actorId } : {}),
      ...(m.targetId ? { targetId: m.targetId } : {}),
      ...(m.room ? { room: m.room } : {}),
    });
  }
  return out.length > limit ? out.slice(-limit) : out;
}

/** 按 seq 合并两批播报（客户端增量累积用）：去重 + 保序 + 截断 */
export function mergeAnnouncements(
  prev: readonly AnnounceItem[],
  next: readonly AnnounceItem[],
  limit = 200,
): AnnounceItem[] {
  if (next.length === 0) return prev as AnnounceItem[];
  const have = new Set(prev.map((a) => a.seq));
  const add = next.filter((a) => !have.has(a.seq));
  if (add.length === 0) return prev as AnnounceItem[];
  const merged = [...prev, ...add];
  return merged.length > limit ? merged.slice(-limit) : merged;
}

/**
 * 横幅队列压缩（拥堵策略）：
 * 播报是「实时动态」，积压时旧的中低价值条目已经过时，继续排队只会让人看到过时消息。
 * 规则：
 *  - 队首 1 条保留（马上就要播，打断它反而闪烁）；
 *  - 其余只保留 high（淘汰/致命/领域/终局这类不能丢）；
 *  - 追加新到达的（已过滤 low），按 seq 去重，超出 max 时保留最新。
 */
export function condenseAnnounceQueue(
  queued: readonly AnnounceItem[],
  incoming: readonly AnnounceItem[],
  max = 6,
): AnnounceItem[] {
  const head = queued.length > 0 ? [queued[0]] : [];
  const kept = queued.slice(1).filter((a) => a.priority === 'high');
  const have = new Set([...head, ...kept].map((a) => a.seq));
  const add = incoming.filter((a) => !have.has(a.seq) && a.priority !== 'low');
  const merged = [...head, ...kept, ...add];
  if (merged.length <= max) return merged;
  // 超长时保留队首（正在等播）与最新的尾部，丢弃最早的积压
  const rest = merged.slice(head.length);
  return [...head, ...rest.slice(-Math.max(0, max - head.length))];
}

/** 横幅候选：high / normal 才上横幅，low 只留在抽屉里（不抢镜头） */
export function isBannerCandidate(a: AnnounceItem): boolean {
  return a.priority !== 'low';
}
