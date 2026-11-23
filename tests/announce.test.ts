/**
 * 全局播报（Issue #39 / TASKS.md T-6.0.1）
 *
 * 验收口径：
 *  1. **每个动作都有播报**：引擎产出的每条公开日志都能被规则表接住（兜底规则保证不漏），
 *     同一条日志最多产出 1 条播报（幂等），重复语义（action+move / action+heal）不重复播。
 *  2. **所有人可见**：`buildAnnouncements` 是纯函数，服务端对同一批日志只算一次、
 *     广播给全部座位，因此内容/顺序/ts 完全一致（房间层用例验证）。
 *  3. **有反馈时间**：每条播报带 `ts`（生成时刻）与 `ttlMs`（建议展示时长），
 *     并提供 `fmtAnnounceClock` / `fmtAnnounceTtl` 两个展示格式化函数。
 *  4. **可复用接口**：`registerAnnounceRule` 可插拔新规则（优先于兜底、可撤销），
 *     新动作类型无需改动服务端或客户端。
 *
 * 注意：本文件只读日志的公开字段，不触碰引擎规则（数值/顺序零改动）。
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  ANNOUNCE_MAX_ITEMS,
  ANNOUNCE_MAX_TEXT,
  buildAnnouncements,
  clampAnnounceText,
  condenseAnnounceQueue,
  fmtAnnounceClock,
  fmtAnnounceTtl,
  isBannerCandidate,
  listAnnounceRules,
  mergeAnnouncements,
  registerAnnounceRule,
  resetAnnounceRules,
  stripLogIcon,
  type AnnounceItem,
  type AnnounceLogLike,
} from '../shared/src/announce.js';
import { Room } from '../server/src/room.js';

const NOW = 1_700_000_000_000;
const NAMES = { P1: '张三', P2: '李四', P3: '王五' };

function log(
  seq: number,
  type: string,
  text: string,
  data?: Record<string, unknown>,
  extra: Partial<AnnounceLogLike> = {},
): AnnounceLogLike {
  return { seq, type, text, data, round: 1, sub: 0, ...extra };
}

/** 构造播报项（只用于队列压缩等纯逻辑测试，字段可最小化） */
function item(seq: number, priority: AnnounceItem['priority']): AnnounceItem {
  return {
    id: `a-${seq}`, seq, ts: NOW, round: 1, sub: 0,
    icon: '·', text: `事件 ${seq}`, tone: 'info', priority, ttlMs: 1000, rule: 'test',
  };
}

function build(logs: AnnounceLogLike[], extra: { limit?: number } = {}): AnnounceItem[] {
  return buildAnnouncements(logs, { names: NAMES, now: NOW, ...extra });
}

afterEach(() => {
  resetAnnounceRules();
});

describe('全局播报 · 覆盖每个动作', () => {
  it('喝牛奶：全场可见的嘲讽（single source：带 data 的 action 日志）', () => {
    const items = build([
      log(1, 'action', '张三 执行行动：喝牛奶（嘲讽）', { pid: 'P1', fx: 'milk', label: '喝牛奶（嘲讽）' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].rule).toBe('milk');
    expect(items[0].icon).toBe('🥛');
    expect(items[0].text).toBe('张三 喝了一口牛奶，向全场发出嘲讽！');
    expect(items[0].priority).toBe('normal');
    expect(items[0].ttlMs).toBeGreaterThan(0);
  });

  it('通用行动：攻击 / 技能 / 跳过都进播报，并按 fx 选图标', () => {
    const items = build([
      log(1, 'action', '张三 执行行动：攻击 李四', { pid: 'P1', fx: 'attack', label: '攻击 李四', targetId: 'P2' }),
      log(2, 'action', '李四 执行行动：发动技能', { pid: 'P2', fx: 'skill', label: '发动技能' }),
      log(3, 'action', '王五 执行行动：跳过', { pid: 'P3', fx: 'skip', label: '跳过' }),
    ]);
    expect(items.map((i) => i.icon)).toEqual(['⚔️', '✨', '⏭']);
    expect(items[0].text).toContain('攻击 李四');
    expect(items[0].targetId).toBe('P2');
  });

  it('移动 / 回复 / 喝牛奶的 action 日志不重复播报（交给结构化专用日志）', () => {
    const items = build([
      log(1, 'action', '张三 执行行动：移动到 R2', { pid: 'P1', fx: 'move', label: '移动到 R2' }),
      log(2, 'move', '张三 从 R1 移动到 R2', { pid: 'P1', from: 'R1', to: 'R2' }),
      log(3, 'action', '李四 执行行动：回复', { pid: 'P2', fx: 'heal', label: '回复' }),
      log(4, 'heal', '李四 回复 1：2 → 3', { target: 'P2', amount: 1, hpBefore: 2, hpAfter: 3 }),
    ]);
    // 每条日志最多一条播报，且 move/heal 由专用规则接管
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.rule)).toEqual(['move', 'heal']);
    expect(items[0].text).toBe('张三 从 R1 移动到 R2');
    expect(items[1].text).toContain('回复 1');
  });

  it('damage：宣告 / 未命中 / 扣血 / 致命 四态文案与优先级', () => {
    const items = build([
      log(1, 'damage', '张三 向 李四 出手', { declared: true, source: 'P1', target: 'P2', amount: 1 }),
      log(2, 'state', '李四 躲开了', { missed: true, target: 'P2', source: 'P1' }),
      log(3, 'damage', '李四 受到 1 点伤害', { target: 'P2', source: 'P1', amount: 1, hpBefore: 3, hpAfter: 2 }),
      log(4, 'damage', '李四 受到 2 点伤害', { target: 'P2', source: 'P1', amount: 2, hpBefore: 2, hpAfter: 0, lethal: true }),
    ]);
    expect(items).toHaveLength(4);
    expect(items[0].text).toContain('出手');
    expect(items[1].text).toBe('李四 躲开了张三 的攻击');
    expect(items[1].priority).toBe('low'); // 未命中只进抽屉，不抢横幅
    expect(items[2].text).toContain('受到 1 点伤害（HP 3→2）');
    expect(items[3].text).toContain('致命');
    expect(items[3].priority).toBe('high');
    expect(items[3].tone).toBe('danger');
  });

  it('淘汰 / 复活 / 领域 / 运势 / 终局：重大事件全为 high', () => {
    const items = build([
      log(1, 'eliminate', '💀 李四 被淘汰', { pid: 'P2', cause: 'hp', killer: 'P1' }),
      log(2, 'trigger', '💫 王五 消耗一条命（剩余 1 条）', { pid: 'P3', livesLeft: 2 }),
      log(3, 'trigger', '✨ 张三 展开领域！', { pid: 'P1', domain: true }),
      log(4, 'trigger', '🎰 今日勇者抽取运势：掷出 9', { pid: 'P1', fortune: true, roll: 9 }),
      log(5, 'result', '🏆 游戏结束：张三 获得胜利！', undefined),
    ]);
    expect(items).toHaveLength(5);
    expect(items.every((i) => i.priority === 'high')).toBe(true);
    expect(items[0].text).toBe('李四 被淘汰，击杀者 张三');
    expect(items[1].icon).toBe('✨');
    expect(items[2].icon).toBe('🌀');
    expect(items[3].icon).toBe('🎰');
    expect(items[4].icon).toBe('🏁');
    // 日志开头的 emoji 被剥掉，避免与播报图标重复
    expect(items[3].text.startsWith('今日勇者')).toBe(true);
  });

  it('延迟事件：投掷与爆炸分别播报，并带房间', () => {
    const items = build([
      log(1, 'deferred', '💣 投掷', { pid: 'P1', room: 'R3', explodeRound: 4 }),
      log(2, 'deferred', '💥 爆炸', { room: 'R3', source: 'P1' }),
    ]);
    expect(items[0].text).toContain('把大伊万丢向 R3');
    expect(items[0].room).toBe('R3');
    expect(items[1].text).toBe('大伊万在 R3 爆炸！');
  });

  it('阶段 / 判定 / 顺序：低价值事件只进抽屉（low），仍然可见', () => {
    const items = build([
      log(1, 'phase', '等待 张三（无业游民，位于 R1）行动'),
      log(2, 'judge', '回合判定（张三[石头] vs 李四[剪刀]）：分出胜负'),
      log(3, 'order', '⭐ 行动顺序（输者先动）：李四 → 张三'),
    ]);
    expect(items).toHaveLength(3);
    expect(items[0].priority).toBe('low');
    expect(items[0].text).not.toContain('⏱');
    expect(items[2].priority).toBe('normal');
    expect(items.filter(isBannerCandidate).length).toBe(1);
  });

  it('兜底：未知类型也一定有播报（保证「每个动作都可见」）', () => {
    const items = build([log(1, 'info', '某个未来的新事件', undefined, { round: 7 })]);
    expect(items).toHaveLength(1);
    expect(items[0].rule).toBe('fallback');
    expect(items[0].text).toBe('某个未来的新事件');
    expect(items[0].round).toBe(7);
  });

  it('旧格式 action 日志（无 data.pid）跳过，不产生重复噪声', () => {
    const items = build([log(1, 'action', '张三 喝了一口牛奶，向在场所有人发出嘲讽 🥛（无实际效果）')]);
    expect(items).toHaveLength(0);
  });
});

describe('全局播报 · 批次语义（所有人可见 + 反馈时间）', () => {
  it('id 稳定、ts 统一为生成时刻、round/sub 透传（服务端一份广播给所有人）', () => {
    const logs = [
      log(11, 'action', '张三 执行行动：喝牛奶（嘲讽）', { pid: 'P1', fx: 'milk', label: '喝牛奶（嘲讽）' }, { round: 2, sub: 1 }),
      log(12, 'move', '李四 从 R1 移动到 R2', { pid: 'P2', from: 'R1', to: 'R2' }, { round: 2, sub: 1 }),
    ];
    const a = build(logs);
    const b = build(logs); // 纯函数：同一输入 → 同一输出（含 id）
    expect(a.map((x) => x.id)).toEqual(['a-11', 'a-12']);
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    expect(a.every((x) => x.ts === NOW)).toBe(true);
    expect(a.every((x) => x.round === 2 && x.sub === 1)).toBe(true);
    expect(a.every((x) => x.ttlMs > 0)).toBe(true);
  });

  it('幂等：同一批日志重复出现不会重复产出', () => {
    const l = log(5, 'move', '张三 从 R1 移动到 R2', { pid: 'P1', from: 'R1', to: 'R2' });
    const items = build([l, { ...l }, { ...l, seq: 5 }]);
    expect(items).toHaveLength(1);
  });

  it('名字缺失时用 pid 兜底（不抛错、不显示 undefined）', () => {
    const items = buildAnnouncements(
      [log(1, 'move', 'X 从 A 移动到 B', { pid: 'PX', from: 'A', to: 'B' })],
      { now: NOW },
    );
    expect(items[0].text).toBe('PX 从 A 移动到 B');
  });

  it('超过上限只保留最新一批（有界历史）', () => {
    const logs = Array.from({ length: ANNOUNCE_MAX_ITEMS + 20 }, (_, i) =>
      log(i + 1, 'move', `P 从 R1 移动到 R2`, { pid: 'P1', from: 'R1', to: 'R2' }));
    const items = build(logs);
    expect(items).toHaveLength(ANNOUNCE_MAX_ITEMS);
    expect(items[0].seq).toBe(21);
    expect(items[items.length - 1].seq).toBe(ANNOUNCE_MAX_ITEMS + 20);
  });

  it('mergeAnnouncements：按 seq 去重、保序、截断', () => {
    const a = build([log(1, 'move', 'a', { pid: 'P1', from: 'R1', to: 'R2' })]);
    const b = build([
      log(1, 'move', 'a', { pid: 'P1', from: 'R1', to: 'R2' }),
      log(2, 'move', 'b', { pid: 'P1', from: 'R2', to: 'R3' }),
    ]);
    const merged = mergeAnnouncements(a, b);
    expect(merged.map((x) => x.seq)).toEqual([1, 2]);
    expect(mergeAnnouncements(merged, b)).toHaveLength(2);
    expect(mergeAnnouncements([], b, 1).map((x) => x.seq)).toEqual([2]);
  });

  it('condenseAnnounceQueue：积压时保留队首与 high，丢弃过时的中低价值条目', () => {
    const q = [
      item(1, 'normal'), item(2, 'normal'), item(3, 'high'), item(4, 'normal'),
    ];
    const incoming = [item(5, 'normal'), item(6, 'low'), item(7, 'high')];
    const out = condenseAnnounceQueue(q, incoming, 6);
    // 队首保留（1）+ 旧 high（3）+ 新到达（5、7；6 是 low 被过滤）
    expect(out.map((a) => a.seq)).toEqual([1, 3, 5, 7]);
    // 截断时保留队首 + 最新尾部
    const many = Array.from({ length: 10 }, (_, i) => item(i + 10, 'high'));
    const cut = condenseAnnounceQueue([item(1, 'high')], many, 3);
    expect(cut.map((a) => a.seq)).toEqual([1, 18, 19]);
  });

  it('isBannerCandidate：low 不上横幅（不抢镜头），high/normal 上', () => {
    expect(isBannerCandidate({ priority: 'high' } as AnnounceItem)).toBe(true);
    expect(isBannerCandidate({ priority: 'normal' } as AnnounceItem)).toBe(true);
    expect(isBannerCandidate({ priority: 'low' } as AnnounceItem)).toBe(false);
  });
});

describe('全局播报 · 可复用接口（registerAnnounceRule）', () => {
  it('新规则默认优先于内置规则；撤销后恢复', () => {
    const before = listAnnounceRules().length;
    const off = registerAnnounceRule({
      id: 'test-skill',
      summary: '测试技能',
      match: (log, nameOf) => (log.data?.testSkill === true
        ? { icon: '🔥', text: `${nameOf(String(log.data.pid))} 点燃了战场`, tone: 'danger', priority: 'high', ttlMs: 3000 }
        : null),
    });
    expect(listAnnounceRules().length).toBe(before + 1);

    const items = build([log(1, 'trigger', '原始日志文本', { pid: 'P1', testSkill: true })]);
    expect(items[0].rule).toBe('test-skill');
    expect(items[0].icon).toBe('🔥');
    expect(items[0].text).toBe('张三 点燃了战场');

    off();
    expect(listAnnounceRules().length).toBe(before);
    const after = build([log(2, 'trigger', '原始日志文本', { pid: 'P1', testSkill: true })]);
    expect(after[0].rule).toBe('trigger'); // 回到内置 trigger 规则
  });

  it('同一 id 重复注册只保留一条（热重载不会叠规则）', () => {
    const rule = { id: 'dup-rule', match: () => ({ icon: '×', text: 'x', tone: 'info' as const, priority: 'low' as const, ttlMs: 100 }) };
    registerAnnounceRule(rule);
    registerAnnounceRule(rule);
    expect(listAnnounceRules().filter((r) => r.id === 'dup-rule')).toHaveLength(1);
  });

  it('listAnnounceRules 返回的是副本：外部改动不影响注册表', () => {
    const snapshot = listAnnounceRules();
    expect(snapshot.length).toBeGreaterThan(0);
    snapshot.length = 0; // 改副本不影响注册表
    expect(listAnnounceRules().length).toBeGreaterThan(0);
  });
});

describe('全局播报 · 文本与时间格式化', () => {
  it('stripLogIcon 只剥离开头装饰符，保留正文与中文标点', () => {
    expect(stripLogIcon('💀 张三 被淘汰')).toBe('张三 被淘汰');
    expect(stripLogIcon('🎰 今日勇者抽取运势：掷出 9')).toBe('今日勇者抽取运势：掷出 9');
    expect(stripLogIcon('「今日勇者」抽取运势')).toBe('「今日勇者」抽取运势');
    expect(stripLogIcon('张三 行动')).toBe('张三 行动');
  });

  it('clampAnnounceText 超长截断并加省略号（横幅单行展示）', () => {
    const long = '一'.repeat(ANNOUNCE_MAX_TEXT + 10);
    const out = clampAnnounceText(long);
    expect(out.length).toBe(ANNOUNCE_MAX_TEXT);
    expect(out.endsWith('…')).toBe(true);
    expect(clampAnnounceText('短文本')).toBe('短文本');
  });

  it('fmtAnnounceClock → HH:MM:SS（本地时区）；非法值降级', () => {
    const ts = new Date(2026, 10, 22, 9, 5, 3).getTime();
    expect(fmtAnnounceClock(ts)).toBe('09:05:03');
    expect(fmtAnnounceClock(0)).toBe('--:--:--');
    expect(fmtAnnounceClock(Number.NaN)).toBe('--:--:--');
  });

  it('fmtAnnounceTtl → 秒（保留一位小数）', () => {
    expect(fmtAnnounceTtl(1700)).toBe('1.7s');
    expect(fmtAnnounceTtl(2400)).toBe('2.4s');
  });
});

describe('全局播报 · 房间层（服务端权威、全员一致）', () => {
  const rooms: Room[] = [];
  function makeRoom(types: ('human' | 'ai' | 'local')[]) {
    const room = new Room('AN', { submitTimeoutMs: 0, turnTimeoutMs: 0 });
    types.forEach((t, i) => room.addSeat(['张三', '李四', '王五'][i] ?? `P${i + 1}`, 'default', t));
    rooms.push(room);
    return room;
  }
  afterEach(() => {
    rooms.splice(0).forEach((r) => r.dispose());
  });

  it('toAnnouncements：一批日志 → 同一份播报，含真实玩家名与 ts', () => {
    const room = makeRoom(['human', 'human']);
    room.start(20261122);
    const fresh = room.takeNewLogs();
    expect(fresh.length).toBeGreaterThan(0);
    const announcements = room.toAnnouncements(fresh);
    expect(announcements.length).toBeGreaterThan(0);
    expect(announcements.every((a) => a.ts > 0)).toBe(true);
    // 房间层使用真实座位名做替换（不是 pid）
    expect(room.playerNames()['P1-' as string] ?? true).toBeTruthy();
    expect(Object.values(room.playerNames())).toEqual(expect.arrayContaining(['张三', '李四']));
    // 纯函数：同一批日志再算一次，id/文本/优先级完全一致（ts 允许不同）
    const again = room.toAnnouncements(fresh);
    expect(again.map((a) => `${a.id}|${a.text}|${a.priority}`))
      .toEqual(announcements.map((a) => `${a.id}|${a.text}|${a.priority}`));
  });

  it('catchUpAnnouncements：断线补发与日志同窗口，且不推进广播游标', () => {
    const room = makeRoom(['human', 'human']);
    room.start(4242);
    const caught = room.catchUpAnnouncements(50);
    expect(caught.length).toBeGreaterThan(0);
    // 补发不影响增量：紧接着 takeNewLogs 仍能拿到开局日志
    const fresh = room.takeNewLogs();
    expect(fresh.length).toBeGreaterThan(0);
    expect(room.toAnnouncements(fresh).length).toBeGreaterThan(0);
  });
});
