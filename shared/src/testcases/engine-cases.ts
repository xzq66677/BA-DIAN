/**
 * 拔典 · 核心规则引擎测试用例
 * 覆盖任务书第 26 节「核心规则」1-27 项。
 */

import type { TestCase, TestRunResult } from './helpers.js';
import {
  makeGame, playThrows, actQueue, act, check, safeRun, hpOf, isAlive, roomOf, fmtLogs,
} from './helpers.js';
import type { Throw } from '../types.js';

const T = (rock: string, scissors: string, paper: string) => ({ rock, scissors, paper }) as unknown as Array<Record<string, Throw>>;

function run(fn: () => TestRunResult): TestRunResult {
  return safeRun(fn);
}

export const ENGINE_CASES: TestCase[] = [
  // ─── 初次判定 ───────────────────────────────────────────────
  {
    id: 'TC-E001', name: '两名玩家初次判定明确胜负', category: 'engine', seed: 1,
    desc: '石头胜剪刀：石头方获得行动资格，剪刀方无资格',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 1);
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      // A=rock B=scissors → A 胜
      const qualified = g.qualified.slice();
      const ok = qualified.length === 1 && qualified[0] === 'A' && g.phase === 'act';
      return check(ok, 'A 获得行动资格，进入行动阶段', `qualified=${JSON.stringify(qualified)}, phase=${g.phase}`, g);
    }),
  },
  {
    id: 'TC-E002', name: '三名玩家判定多名胜者', category: 'engine', seed: 2,
    desc: '两人石头一人剪刀 → 两名石头玩家均有行动资格',
    run: () => run(() => {
      const g = makeGame(['A', 'B', 'C'], 2);
      playThrows(g, [{ A: 'rock', B: 'rock', C: 'scissors' }]);
      const q = g.qualified.slice().sort();
      const ok = q.join(',') === 'A,B' && g.phase === 'act';
      return check(ok, 'A、B 均获得行动资格', `qualified=${q.join(',')}`, g);
    }),
  },
  {
    id: 'TC-E003', name: '初次判定平局全员重新判定', category: 'engine', seed: 3,
    desc: '全员同拳 → 平局，不产生资格，进入下一子轮重新提交',
    run: () => run(() => {
      const g = makeGame(['A', 'B', 'C'], 3);
      playThrows(g, [{ A: 'rock', B: 'rock', C: 'rock' }]);
      const ok1 = g.phase === 'rps1' && g.subRound === 2 && g.qualified.length === 0;
      const ok2 = g.judgeHistory('A').length === 1 && g.judgeHistory('A')[0] === 'tie';
      // 第二子轮分出胜负
      playThrows(g, [{ A: 'rock', B: 'rock', C: 'scissors' }]);
      const ok3 = g.phase === 'act' && g.qualified.sort().join(',') === 'A,B';
      return check(ok1 && ok2 && ok3,
        '平局后子轮+1、无资格、历史记 tie；重判后 A、B 获得资格',
        `subRound=${g.subRound}, phase=${g.phase}, q=${g.qualified.join(',')}, hist=${JSON.stringify(g.judgeHistory('A'))}`, g);
    }),
  },
  {
    id: 'TC-E004', name: '初次判定三人循环全员重判（不随机）', category: 'engine', seed: 4,
    desc: '三人各出不同拳（循环）→ 全员重新判定，不随机决定胜者',
    run: () => run(() => {
      const g = makeGame(['A', 'B', 'C'], 4);
      playThrows(g, [{ A: 'rock', B: 'scissors', C: 'paper' }]);
      const ok1 = g.phase === 'rps1' && g.subRound === 2 && g.qualified.length === 0;
      const hist = g.judgeHistory('A');
      const ok2 = hist.length === 1 && hist[0] === 'tie';
      playThrows(g, [{ A: 'paper', B: 'paper', C: 'paper' }, { A: 'rock', B: 'scissors', C: 'rock' }]);
      const ok3 = g.phase === 'act';
      return check(ok1 && ok2 && ok3,
        '三人循环 → 重判子轮、全员记 tie、重判后可分出胜负',
        `subRound=${g.subRound}, phase=${g.phase}, hist=${JSON.stringify(hist)}`, g);
    }),
  },
  {
    id: 'TC-E005', name: '五名玩家混合判定', category: 'engine', seed: 5,
    desc: '5人：3布2石头 → 3名布玩家获资格',
    run: () => run(() => {
      const g = makeGame(['A', 'B', 'C', 'D', 'E'], 5);
      playThrows(g, [{ A: 'paper', B: 'paper', C: 'paper', D: 'rock', E: 'rock' }]);
      const q = g.qualified.slice().sort();
      const ok = q.join(',') === 'A,B,C';
      return check(ok, 'A、B、C（布）获得资格，D、E 无资格', `qualified=${q.join(',')}`, g);
    }),
  },
  {
    id: 'TC-E006', name: '淘汰玩家不参与判定', category: 'engine', seed: 6,
    desc: '三人中一人先被淘汰（模拟），判定只由存活者参与',
    run: () => run(() => {
      const g = makeGame(['A', 'B', 'C'], 6);
      g.eliminate('C', 'test');
      playThrows(g, [{ A: 'rock', B: 'scissors', C: 'paper' }]);
      const ok = g.phase === 'act' && g.qualified.length === 1 && g.qualified[0] === 'A';
      return check(ok, '仅 A、B 判定，A 获得资格', `phase=${g.phase}, qualified=${g.qualified.join(',')}`, g);
    }),
  },
  {
    id: 'TC-E007', name: '非法出拳被拒绝', category: 'engine', seed: 7,
    desc: '提交非法拳种 → 拒绝且不修改状态',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 7);
      const r = g.submitThrow('A', 'banana' as Throw);
      const ok = !r.ok && g.submittedIds.length === 0;
      return check(ok, '拒绝非法出拳，提交状态不变', `ok=${r.ok}, error=${r.error}`, g);
    }),
  },
  {
    id: 'TC-E008', name: '重复提交被拒绝', category: 'engine', seed: 8,
    desc: '同一子轮重复提交 → 拒绝，保留首次出拳',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 8);
      g.submitThrow('A', 'rock');
      const r = g.submitThrow('A', 'paper');
      const ok = !r.ok && g.pendingThrows['A'] === 'rock';
      return check(ok, '拒绝重复提交，保留首次出拳', `ok=${r.ok}, pending=${g.pendingThrows['A']}`, g);
    }),
  },

  // ─── 二次判定与行动顺序 ──────────────────────────────────────
  {
    id: 'TC-E009', name: '二次判定：输者优先行动', category: 'engine', seed: 100,
    desc: '两名胜者中二次判定输者排在行动队列前面',
    run: () => run(() => {
      // 种子固定：种子100下 A、B 的排序掷拳结果固定。这里验证排序性质：
      // 队列包含两名玩家各一次；且记录中有 rps2 子轮
      const g = makeGame(['A', 'B', 'C'], 100);
      playThrows(g, [{ A: 'rock', B: 'rock', C: 'scissors' }]); // A、B 双胜
      const ok1 = g.phase === 'act' && g.queue.length === 2;
      const order = g.queue.join(',');
      const rps2Records = g.judgeRecords.filter((r) => r.stage === 'rps2');
      const ok2 = rps2Records.length >= 1;
      // 排序性质：若某子轮 A 输给 B，则 A 在 B 前
      let ok3 = true;
      for (const r of rps2Records) {
        if (r.winners && r.losers && r.winners.length === 1 && r.losers.length === 1) {
          const [w] = r.winners, [l] = r.losers;
          if (g.queue.indexOf(l) > g.queue.indexOf(w)) ok3 = false;
        }
      }
      return check(ok1 && ok2 && ok3,
        '队列含两名胜者各一次，二次判定输者先行动',
        `order=${order}, rps2轮数=${rps2Records.length}`, g);
    }),
  },
  {
    id: 'TC-E010', name: '二次判定不剥夺行动资格', category: 'engine', seed: 101,
    desc: '多名胜者全部出现在行动队列中（判定只排序）',
    run: () => run(() => {
      const g = makeGame(['A', 'B', 'C', 'D'], 101);
      playThrows(g, [{ A: 'paper', B: 'paper', C: 'rock', D: 'rock' }]);
      const sorted = g.queue.slice().sort();
      const ok = sorted.join(',') === 'A,B' && g.qualified.length === 2;
      return check(ok, '所有初次胜者 A、B 都在队列中', `queue=${g.queue.join(',')}`, g);
    }),
  },
  {
    id: 'TC-E011', name: '二次判定平局/循环重新判定直至完整顺序', category: 'engine', seed: 102,
    desc: '多名胜者排序时出现同拳或三人循环 → 重判，最终队列完整且不重复',
    run: () => run(() => {
      const g = makeGame(['A', 'B', 'C', 'D'], 102);
      playThrows(g, [
        { A: 'rock', B: 'rock', C: 'rock', D: 'rock' },
        { A: 'paper', B: 'paper', C: 'paper', D: 'paper' },
        { A: 'rock', B: 'paper', C: 'paper', D: 'paper' },
      ]);
      // 初次：平局重判两次后 B、C、D（布组）胜
      const q = g.qualified.length;
      const uniq = new Set(g.queue);
      const ok = q === 3 && uniq.size === 3 && g.queue.length === 3 && g.phase === 'act';
      return check(ok, '3名胜者全部在队列中且顺序完整', `qualified=${q}, queue=${g.queue.join(',')}`, g);
    }),
  },

  // ─── 行动与移动 ──────────────────────────────────────────────
  {
    id: 'TC-E012', name: '非当前玩家操作被拒绝', category: 'engine', seed: 103,
    desc: '行动阶段只有队列当前玩家可提交行动',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 103);
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      const cur = g.currentActor();
      const other = cur === 'A' ? 'B' : 'A';
      const r = g.submitAction(other, { type: 'skip' });
      return check(!r.ok, `非当前行动者(${other})提交被拒绝`, `ok=${r.ok}, error=${r.error}, cur=${cur}`, g);
    }),
  },
  {
    id: 'TC-E013', name: '正常移动与房间状态同步', category: 'engine', seed: 104,
    desc: 'A 移动到 B 的初始房间，房间成员动态变化',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 104);
      playThrows(g, [{ A: 'rock', B: 'scissors' }]); // A 胜
      actQueue(g, { A: { type: 'move', room: 'R2' } });
      const ok = roomOf(g, 'A') === 'R2' && g.roomMembers('R2').sort().join(',') === 'A,B' && g.roomMembers('R1').length === 0;
      return check(ok, 'A 位于 R2，R2 成员为 A、B，R1 空', `A.room=${roomOf(g, 'A')}, R2=${g.roomMembers('R2').join(',')}, R1=${g.roomMembers('R1').length}`, g);
    }),
  },
  {
    id: 'TC-E014', name: '移动到自己的初始房间（允许）', category: 'engine', seed: 105,
    desc: '玩家可以返回自己的初始位置',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 105);
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'move', room: 'R1' } });
      const ok = roomOf(g, 'A') === 'R1';
      return check(ok, 'A 可移动回 R1', `A.room=${roomOf(g, 'A')}`, g);
    }),
  },
  {
    id: 'TC-E015', name: '移动到被淘汰玩家的初始位置（位置保留）', category: 'engine', seed: 106,
    desc: 'C 被淘汰后其初始位置 R3 仍然存在，A 可移动过去',
    run: () => run(() => {
      const g = makeGame(['A', 'B', 'C'], 106);
      g.eliminate('C', 'test');
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'move', room: 'R3' } });
      const ok = roomOf(g, 'A') === 'R3' && isAlive(g, 'C') === false;
      return check(ok, 'A 成功移动到被淘汰者 C 的初始位置 R3', `A.room=${roomOf(g, 'A')}`, g);
    }),
  },
  {
    id: 'TC-E016', name: '移动到非法房间被拒绝', category: 'engine', seed: 107,
    desc: '不存在的房间号 → 拒绝，位置不变，行动不消耗',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 107);
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      const r = g.submitAction('A', { type: 'move', room: 'R999' });
      const ok = !r.ok && roomOf(g, 'A') === 'R1' && g.currentActor() === 'A';
      return check(ok, '拒绝非法房间，A 仍在 R1 且仍待行动', `ok=${r.ok}, room=${roomOf(g, 'A')}, error=${r.error}`, g);
    }),
  },
  {
    id: 'TC-E017', name: '重复进入同一房间（允许）', category: 'engine', seed: 108,
    desc: '玩家可以反复进入同一房间',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 108);
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'move', room: 'R2' } });
      // 下一回合 A 再次移动到 R2
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'move', room: 'R2' } });
      const ok = roomOf(g, 'A') === 'R2';
      return check(ok, 'A 连续两回合移动到 R2 成功', `A.room=${roomOf(g, 'A')}`, g);
    }),
  },

  // ─── 攻击 ────────────────────────────────────────────────────
  {
    id: 'TC-E018', name: '单体攻击：同房间伤害1并正确结算', category: 'engine', seed: 109,
    desc: 'A 攻击同房间 B：B HP 3→2',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 109);
      g.players['B'].room = 'R1';
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', targetId: 'B' } });
      const ok = hpOf(g, 'B') === 2 && isAlive(g, 'B');
      return check(ok, 'B HP=2', `B.hp=${hpOf(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-E019', name: '攻击不同房间目标被拒绝（默认近战）', category: 'engine', seed: 110,
    desc: '默认角色无法攻击异房间玩家',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 110);
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      const r = g.submitAction('A', { type: 'attack', targetId: 'B', ranged: true });
      const ok = !r.ok && hpOf(g, 'B') === 3;
      return check(ok, '拒绝异房间近战攻击，B 未受伤', `ok=${r.ok}, error=${r.error}`, g);
    }),
  },
  {
    id: 'TC-E020', name: '攻击已淘汰目标被拒绝', category: 'engine', seed: 111,
    desc: '目标不存在或已淘汰 → 拒绝',
    run: () => run(() => {
      const g = makeGame(['A', 'B', 'C'], 111);
      g.eliminate('C', 'test');
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      const r = g.submitAction('A', { type: 'attack', targetId: 'C' });
      const ok = !r.ok;
      return check(ok, '拒绝攻击已淘汰目标', `ok=${r.ok}, error=${r.error}`, g);
    }),
  },
  {
    id: 'TC-E021', name: 'HP归零立即淘汰并移出房间成员', category: 'engine', seed: 112,
    desc: 'B HP 1 被攻击 → 立即淘汰，从 R2 成员移除，初始位置保留',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 112);
      g.players['B'].room = 'R1';
      g.players['B'].hp = 1;
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', targetId: 'B' } });
      const ok = !isAlive(g, 'B') && g.roomMembers('R2').length === 0 && g.players['B'].originRoom === 'R2' && g.winner === 'A';
      return check(ok, 'B 淘汰，A 获胜，游戏结束', `B.alive=${isAlive(g, 'B')}, winner=${g.winner}`, g);
    }),
  },
  {
    id: 'TC-E022', name: '行动期间被淘汰后跳过其行动', category: 'engine', seed: 113,
    desc: '队列 [A,B]：B 行动前因判定触发死亡（模拟已死），A 行动后回合正常结束',
    run: () => run(() => {
      const g = makeGame(['A', 'B', 'C'], 113);
      playThrows(g, [{ A: 'rock', B: 'rock', C: 'scissors' }]); // A、B 胜
      g.eliminate('B', 'test'); // B 在行动前被淘汰
      actQueue(g, { A: { type: 'skip' } });
      const ok = g.phase !== 'act' && isAlive(g, 'A');
      return check(ok, 'B 被跳过，回合结束进入下一阶段', `phase=${g.phase}`, g);
    }),
  },

  // ─── 回复 ────────────────────────────────────────────────────
  {
    id: 'TC-E023', name: '正常回复至满血', category: 'engine', seed: 114,
    desc: 'B HP 1 → 回复后为满血 3',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 114);
      g.players['A'].hp = 1;
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'heal' } });
      const ok = hpOf(g, 'A') === 3;
      return check(ok, 'A HP=3（满血）', `A.hp=${hpOf(g, 'A')}`, g);
    }),
  },
  {
    id: 'TC-E024', name: '满血回复仍为合法行动', category: 'engine', seed: 115,
    desc: '满血时回复 → 仍为3（规则允许满血回复）',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 115);
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      const r = g.submitAction('A', { type: 'heal' });
      const ok = r.ok && hpOf(g, 'A') === 3;
      return check(ok, '满血回复合法，HP 仍为 3', `ok=${r.ok}, hp=${hpOf(g, 'A')}`, g);
    }),
  },
  {
    id: 'TC-E025', name: '回复没有次数限制（每回合一次，跨回合可重复）', category: 'engine', seed: 116,
    desc: 'A 连续两回合回复均合法',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 116);
      g.players['A'].hp = 1;
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'heal' } });
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'heal' } });
      const ok = hpOf(g, 'A') === 3;
      return check(ok, '跨回合重复回复成功', `hp=${hpOf(g, 'A')}`, g);
    }),
  },

  // ─── 躲藏/找出来 ─────────────────────────────────────────────
  {
    id: 'TC-E026', name: '躲藏后指向性攻击无法锁定', category: 'engine', seed: 117,
    desc: 'B 躲藏后 A 攻击被拒绝',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 117);
      g.players['B'].hidden = true;
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      const r = g.submitAction('A', { type: 'attack', targetId: 'B' });
      const ok = !r.ok && hpOf(g, 'B') === 3;
      return check(ok, '躲藏目标无法被锁定，B 未受伤', `ok=${r.ok}, error=${r.error}`, g);
    }),
  },
  {
    id: 'TC-E027', name: '找出来使躲藏玩家现身', category: 'engine', seed: 118,
    desc: 'A 对同房间躲藏的 B 使用「找出来」→ B 现身',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 118);
      g.players['B'].hidden = true;
      g.players['B'].room = 'R1'; // 与 A 同房间
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'seek', targetId: 'B' } });
      const hiddenAfter = g.players['B'].hidden as boolean;
      const ok = hiddenAfter === false;
      return check(ok, 'B 现身（hidden=false）', `hidden=${hiddenAfter}`, g);
    }),
  },
  {
    id: 'TC-E028', name: '移动后现身（离开躲藏）', category: 'engine', seed: 119,
    desc: '躲藏玩家移动 → 自动现身（规则假设：移动视为公开行动）',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 119);
      g.players['A'].hidden = true;
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'move', room: 'R2' } });
      const hiddenAfter = g.players['A'].hidden as boolean;
      const ok = hiddenAfter === false;
      return check(ok, 'A 移动后现身', `hidden=${hiddenAfter}`, g);
    }),
  },

  // ─── 游戏结束 ────────────────────────────────────────────────
  {
    id: 'TC-E029', name: '游戏结束后禁止继续提交行动', category: 'engine', seed: 120,
    desc: '只剩一人时游戏结束，普通行动被拒绝',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 120);
      g.players['B'].room = 'R1';
      g.players['B'].hp = 1;
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', targetId: 'B' } });
      const over = g.phase === 'over' && g.winner === 'A';
      const r = g.submitAction('A', { type: 'heal' });
      const t = g.submitThrow('A', 'rock');
      const ok = over && !r.ok && !t.ok;
      return check(ok, '游戏结束后行动与出拳均被拒绝', `phase=${g.phase}, action=${r.error}, throw=${t.error}`, g);
    }),
  },
  {
    id: 'TC-E030', name: '同房间多人成员动态变化', category: 'engine', seed: 121,
    desc: '3 人中 2 人进入同一房间，死亡后成员集合立即更新',
    run: () => run(() => {
      const g2 = makeGame(['A', 'B', 'C'], 121);
      playThrows(g2, [{ A: 'rock', B: 'scissors', C: 'rock' }]); // A、C（石头）胜
      actQueue(g2, { A: { type: 'move', room: 'R2' }, C: { type: 'move', room: 'R2' } });
      const ok1 = g2.roomMembers('R2').sort().join(',') === 'A,B,C';
      g2.eliminate('C', 'test');
      const ok2 = g2.roomMembers('R2').sort().join(',') === 'A,B';
      return check(ok1 && ok2, 'R2 成员先为 A,B,C，C 淘汰后为 A,B',
        `after=${g2.roomMembers('R2').join(',')}`, g2);
    }),
  },

  // ─── 随机数与复现 ────────────────────────────────────────────
  {
    id: 'TC-E031', name: '固定随机种子完全可复现', category: 'engine', seed: 123,
    desc: '同种子同操作序列 → 两局日志完全一致',
    run: () => run(() => {
      const play = () => {
        const g = makeGame(['A', 'B'], 123);
        for (let r = 0; r < 6; r++) {
          if (g.isOver()) break;
          playThrows(g, [{ A: 'rock', B: 'paper' }, { A: 'scissors', B: 'paper' }]);
          actQueue(g, { A: { type: 'attack', targetId: 'B' }, B: { type: 'heal' } });
        }
        return fmtLogs(g).join('\n');
      };
      const l1 = play();
      const l2 = play();
      const ok = l1 === l2 && l1.length > 0;
      return check(ok, '两次运行日志一致', ok ? '一致' : '不一致', undefined);
    }),
  },
  {
    id: 'TC-E032', name: '随机数生成过程记录', category: 'engine', seed: 124,
    desc: '引擎日志记录判定出拳明细（随机数与判定对应）',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 124);
      g.players['B'].charId = 'mabaoguo';
      g.players['B'].room = 'R1';
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', targetId: 'B' } });
      const hasJudgeDetail = g.logs.some((l) => l.type === 'judge' && l.text.includes('太极') && l.text.includes('vs'));
      return check(hasJudgeDetail, '太极判定日志包含双方出拳明细', hasJudgeDetail ? '包含' : '缺失', g);
    }),
  },

  // ─── 非法操作补充 ────────────────────────────────────────────
  {
    id: 'TC-E033', name: '出拳阶段提交行动被拒绝', category: 'engine', seed: 125,
    desc: '阶段校验：rps1 阶段不能行动',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 125);
      const r = g.submitAction('A', { type: 'skip' });
      const ok = !r.ok;
      return check(ok, '拒绝', `error=${r.error}`, g);
    }),
  },
  {
    id: 'TC-E034', name: '已淘汰玩家提交出拳被拒绝', category: 'engine', seed: 126,
    desc: '淘汰玩家不参与判定',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 126);
      g.eliminate('B', 'test');
      const r = g.submitThrow('B', 'rock');
      const ok = !r.ok;
      return check(ok, '拒绝', `error=${r.error}`, g);
    }),
  },
  {
    id: 'TC-E035', name: '胜利判定：最后一名存活玩家获胜', category: 'engine', seed: 127,
    desc: '4人局最后仅一人存活 → 游戏结束并显示胜者',
    run: () => run(() => {
      const g = makeGame(['A', 'B', 'C', 'D'], 127);
      g.eliminate('B', 'test');
      g.eliminate('C', 'test');
      g.eliminate('D', 'test');
      g.checkWin();
      const ok = g.phase === 'over' && g.winner === 'A';
      const resultLog = g.logs.find((l) => l.type === 'result');
      return check(ok && !!resultLog, 'A 获胜，日志包含胜利结果', `winner=${g.winner}, log=${resultLog?.text}`, g);
    }),
  },
];
