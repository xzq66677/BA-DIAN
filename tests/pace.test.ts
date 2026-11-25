// @vitest-environment node
/**
 * 演出节奏档位（Pace）回归测试
 *
 * 背景（用户反馈）：AI 行动「太快、看不清」。根因不在单个时长数字，而在拥堵判定：
 * AI 由服务端批量驱动，一次广播就带来一整轮 AI 行动（十几条事件），按「估算时长」判积压时
 * 6~10 人局天然超过 9s 预算 → 每一批都被压成 fast 档 260ms/条。
 *
 * 因此这里的守护重点是：
 *  1. 档位表完整、默认档比基线慢，且 `?pace=` 解析安全；
 *  2. 典型 AI 批次（十几条）在默认档下**不会**被判定为积压；
 *  3. 真正的洪水（上百条）仍然会被压缩，避免演出追不上。
 */

import { describe, it, expect } from 'vitest';
import {
  PACE_PROFILES, DEFAULT_PACE, resolvePace, eventMs, assembleClusters,
  BattleEventQueue, type Speed,
} from '../client/src/battle/queue.js';
import { parseBattleEvent, type LogLike } from '../client/src/battle/events.js';
import { resolvePresentationPace } from '../client/src/battle/pace-policy.js';

/** 造一批「一次 AI 回合」形态的日志：攻击/伤害/移动/回复交替 */
function aiBurst(rounds: number, seqStart = 1): LogLike[] {
  const out: LogLike[] = [];
  let seq = seqStart;
  const kinds: Array<() => LogLike> = [
    () => ({ seq: seq++, type: 'action', text: '攻击', data: { pid: 'A', fx: 'attack', label: '攻击 B', targetId: 'B' } }),
    () => ({ seq: seq++, type: 'damage', text: '受伤', data: { target: 'B', source: 'A', amount: 1, hpBefore: 3, hpAfter: 2 } }),
    () => ({ seq: seq++, type: 'action', text: '移动', data: { pid: 'C', fx: 'move', label: '移动到 R2', room: 'R2' } }),
    () => ({ seq: seq++, type: 'move', text: '移动', data: { pid: 'C', from: 'R1', to: 'R2' } }),
    () => ({ seq: seq++, type: 'action', text: '回复', data: { pid: 'D', fx: 'heal', label: '回复' } }),
    () => ({ seq: seq++, type: 'heal', text: '回复', data: { target: 'D', amount: 1, hpBefore: 2, hpAfter: 3 } }),
  ];
  for (let i = 0; i < rounds; i++) for (const k of kinds) out.push(k());
  return out;
}

describe('演出节奏档位', () => {
  it('四个档位齐全，且越往后越慢', () => {
    const ids = ['current', 'relaxed', 'cinematic', 'slow'] as const;
    for (const id of ids) expect(PACE_PROFILES[id].id).toBe(id);
    const order = ids.map((id) => PACE_PROFILES[id].base.damage);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('默认档为 slow：比基线慢且是四档里最慢的一档', () => {
    expect(DEFAULT_PACE).toBe('slow');
    const base = PACE_PROFILES.current.base.damage;
    const d = PACE_PROFILES[DEFAULT_PACE];
    expect(d.base.damage).toBeGreaterThan(base);
    for (const id of ['current', 'relaxed', 'cinematic'] as const) {
      expect(d.base.damage).toBeGreaterThanOrEqual(PACE_PROFILES[id].base.damage);
    }
  });

  it('单次攻击总时长 = 行动 + 出手 + 伤害，各档单调递增', () => {
    const atk = (id: keyof typeof PACE_PROFILES) => {
      const p = PACE_PROFILES[id];
      return p.base.action + p.base.attackDecl + p.base.damage;
    };
    expect(atk('relaxed')).toBeGreaterThan(atk('current'));
    expect(atk('cinematic')).toBeGreaterThan(atk('relaxed'));
    expect(atk('slow')).toBeGreaterThan(atk('cinematic'));
  });

  it('?pace= 解析：未知值回退默认，合法值生效', () => {
    expect(resolvePace('slow').id).toBe('slow');
    expect(resolvePace('cinematic').id).toBe('cinematic');
    expect(resolvePace('nonsense').id).toBe(DEFAULT_PACE);
    expect(resolvePace(null).id).toBe(DEFAULT_PACE);
    expect(resolvePace('').id).toBe(DEFAULT_PACE);
  });

  it('eventMs：fast 档用压缩时长，normal 档按档位缩放，speed 整除', () => {
    const e = parseBattleEvent({ seq: 1, type: 'damage', text: 'x', important: false, data: { target: 'A', source: 'B', amount: 1 } })!;
    const normal = eventMs(e, 'normal', 1 as Speed, false, PACE_PROFILES.relaxed);
    expect(normal).toBe(PACE_PROFILES.relaxed.base.damage);
    expect(eventMs(e, 'normal', 2 as Speed, false, PACE_PROFILES.relaxed)).toBe(Math.round(normal / 2));
    expect(eventMs(e, 'fast', 1 as Speed, false, PACE_PROFILES.relaxed)).toBe(PACE_PROFILES.relaxed.fastMs);
  });

  it('典型 AI 回合批次（18 条事件）不被判为积压 → 保持 normal 原速', () => {
    const logs = aiBurst(3); // 18 条
    const events = logs.map((l) => parseBattleEvent(l)).filter(Boolean);
    expect(events.length).toBeGreaterThanOrEqual(15);

    const states: string[] = [];
    const q = new BattleEventQueue({ onState: (s) => states.push(s.mode) }, PACE_PROFILES[DEFAULT_PACE]);
    q.pushLogs(logs);
    expect(states[states.length - 1]).toBe('normal');
    q.dispose();
  });

  it('真正的洪水（≥160 条事件）仍然压缩为 fast，演出不会追不上', () => {
    const logs = aiBurst(30); // 180 条
    const states: string[] = [];
    const q = new BattleEventQueue({ onState: (s) => states.push(s.mode) }, PACE_PROFILES[DEFAULT_PACE]);
    q.pushLogs(logs);
    expect(states[states.length - 1]).toBe('fast');
    q.dispose();
  });

  it('分簇结果与档位无关（档位只改时长，不改演出结构）', () => {
    const events = aiBurst(3).map((l) => parseBattleEvent(l)).filter(Boolean);
    const clusters = assembleClusters(events as never);
    const leadCount = clusters.filter((c) => c.lead).length;
    expect(leadCount).toBe(9); // 3 轮 × 3 个 action 簇首
  });
});

describe('座位组成节奏策略（Issue #61）', () => {
  const mixed = [{ type: 'human' }, { type: 'ai' }, { type: 'ai' }];
  const localMixed = [{ type: 'local' }, { type: 'ai' }];
  const pureAi = [{ type: 'ai' }, { type: 'ai' }];
  const pureHuman = [{ type: 'human' }, { type: 'human' }];

  it('真人 + AI 混合局：无 ?pace= 时强制慢速', () => {
    expect(resolvePresentationPace(mixed, '').id).toBe('slow');
    expect(resolvePresentationPace(localMixed, '?entrance=classic').id).toBe('slow');
  });

  it('显式合法 ?pace= 是调试覆盖：混合局也尊重', () => {
    expect(resolvePresentationPace(mixed, '?pace=current').id).toBe('current');
    expect(resolvePresentationPace(mixed, '?pace=relaxed').id).toBe('relaxed');
    expect(resolvePresentationPace(mixed, '?pace=cinematic').id).toBe('cinematic');
  });

  it('未知/原型键 ?pace= 不生效：混合局仍回慢速', () => {
    expect(resolvePresentationPace(mixed, '?pace=nonsense').id).toBe('slow');
    expect(resolvePresentationPace(mixed, '?pace=__proto__').id).toBe('slow');
    expect(resolvePresentationPace(mixed, '?pace=constructor').id).toBe('slow');
  });

  it('纯 AI / 纯真人局不强制：跟随 URL 或默认档', () => {
    expect(resolvePresentationPace(pureAi, '?pace=current').id).toBe('current');
    expect(resolvePresentationPace(pureHuman, '?pace=relaxed').id).toBe('relaxed');
    expect(resolvePresentationPace(pureAi, '').id).toBe(DEFAULT_PACE);
    expect(resolvePresentationPace([], '').id).toBe(DEFAULT_PACE);
  });

  it('混合局队列：典型 AI 批次保持 normal，且状态暴露 pace=slow', () => {
    const pace = resolvePresentationPace(mixed, '');
    const states: Array<{ mode: string; pace: string }> = [];
    const q = new BattleEventQueue({ onState: (s) => states.push({ mode: s.mode, pace: s.pace }) }, pace);
    q.pushLogs(aiBurst(3));
    expect(q.getPace().id).toBe('slow');
    expect(q.getState().pace).toBe('slow');
    expect(states[states.length - 1].mode).toBe('normal');
    q.dispose();
  });

  it('setPace 动态切换会同步进队列状态（座位变化 → 重算档位）', () => {
    const q = new BattleEventQueue({}, PACE_PROFILES.current);
    expect(q.getState().pace).toBe('current');
    q.setPace(resolvePresentationPace(mixed, ''));
    expect(q.getState().pace).toBe('slow');
    q.dispose();
  });
});
