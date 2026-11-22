/**
 * 拔典 · 测试用例辅助工具
 * 测试与机制测试场共享。所有用例使用固定种子，可复现。
 */

import { Game } from '../engine.js';
import { CHARACTERS } from '../characters/index.js';
import type { Throw, ActionRequest, RuleConfig, PlayerId, GamePhase } from '../types.js';
import type { CharDef } from '../chardef.js';

export interface TestRunResult {
  pass: boolean;
  expected: string;
  actual: string;
  error?: string;
  logs: string[];
}

export interface TestCase {
  id: string;
  name: string;
  category: 'engine' | 'character' | 'complex';
  charId?: string;
  desc: string;
  seed?: number;
  run(): TestRunResult;
}

/** 快捷构造游戏。players: [id, charId] 或对象 */
export interface PlayerSpec {
  id: string;
  char: string;
  hp?: number;
  room?: string;
  hidden?: boolean;
}

export function makeGame(
  players: (PlayerSpec | string)[],
  seed = 1,
  rules?: Partial<RuleConfig>,
): Game {
  const specs: PlayerSpec[] = players.map((p) =>
    typeof p === 'string' ? { id: p, char: 'default' } : p,
  );
  const game = new Game({
    seed,
    // 自动化用例不驱动「二次判定 / 技能判定亲自出拳」的交互流程：默认改用服务端代掷，
    // 与线上规则同源、只是出拳来源不同。需要验证交互判定的用例显式传 rules 覆盖即可。
    rules: { secondJudgeMode: 'serverRoll', skillJudgeMode: 'serverRoll', ...(rules || {}) },
    chars: CHARACTERS,
    players: specs.map((s) => ({ id: s.id, name: s.id, charId: s.char, type: 'local' as const })),
  });
  for (const s of specs) {
    const p = game.players[s.id];
    if (!p) continue;
    if (s.hp !== undefined) { p.hp = s.hp; p.maxHp = Math.max(s.hp, p.maxHp); }
    if (s.room) { p.room = s.room; }
    if (s.hidden) { p.hidden = true; }
  }
  return game;
}

/** 提交一轮出拳（仅提交存活玩家）。返回是否已分出胜负 */
export function throwSub(game: Game, m: Record<string, Throw>): boolean {
  const before = game.phase;
  for (const pid of game.aliveIds()) {
    if (m[pid] !== undefined) game.submitThrow(pid, m[pid]);
  }
  return game.phase !== before || game.phase !== 'rps1';
}

/** 依次提交多轮出拳（处理平局重判）。分出胜负后停止。 */
export function playThrows(game: Game, rounds: Array<Record<string, Throw>>): void {
  for (const r of rounds) {
    if (game.phase !== 'rps1') break;
    throwSub(game, r);
  }
}

/** 当前行动者执行行动 */
export function act(game: Game, pid: PlayerId, req: ActionRequest): { ok: boolean; error?: string } {
  return game.submitAction(pid, req);
}

/** 按行动队列依次执行：actionsByPid 中提供行动，未提供的默认跳过；行动被拒绝时停止 */
export function actQueue(game: Game, actionsByPid: Record<string, ActionRequest>): void {
  let guard = 0;
  while (game.phase === 'act' && guard++ < 100) {
    const cur = game.currentActor();
    if (!cur) break;
    const req = actionsByPid[cur] || { type: 'skip' };
    const r = game.submitAction(cur, req);
    if (!r.ok) break; // 非法行动：不消耗行动，停止驱动（保持现场供断言）
  }
}

export function hpOf(game: Game, pid: PlayerId): number {
  return game.players[pid].hp;
}

export function isAlive(game: Game, pid: PlayerId): boolean {
  return game.players[pid]?.alive ?? false;
}

export function roomOf(game: Game, pid: PlayerId): string {
  return game.players[pid].room;
}

export function fmtLogs(game: Game): string[] {
  return game.logs.map((l) => `[R${l.round}·${l.type}] ${l.text}`);
}

/** 断言工具：通过/失败 + 期望/实际说明 */
export function check(pass: boolean, expected: string, actual: string, game?: Game, error?: string): TestRunResult {
  return {
    pass,
    expected,
    actual,
    error,
    logs: game ? fmtLogs(game) : [],
  };
}

/** 运行一个函数并捕获异常作为失败 */
export function safeRun(fn: () => TestRunResult): TestRunResult {
  try {
    return fn();
  } catch (e) {
    return { pass: false, expected: '正常执行', actual: `异常：${(e as Error).message}`, error: (e as Error).stack, logs: [] };
  }
}

export function phaseName(p: GamePhase): string {
  return p === 'rps1' ? '出拳阶段' : p === 'act' ? '行动阶段' : p === 'roundEnd' ? '回合末' : '游戏结束';
}
