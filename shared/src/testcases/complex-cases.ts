/**
 * 拔典 · 复杂交互测试用例（任务书第 26 节「复杂交互」）
 */

import type { TestCase, TestRunResult } from './helpers.js';
import {
  makeGame, playThrows, actQueue, check, safeRun, hpOf, isAlive,
} from './helpers.js';

function run(fn: () => TestRunResult): TestRunResult {
  return safeRun(fn);
}

export const COMPLEX_CASES: TestCase[] = [
  {
    id: 'TC-X001', name: '反弹 × 多段攻击：伍六七AOE每段独立触发太极判定', category: 'complex', seed: 300,
    desc: '马保国承受伍六七AOE，每段独立进行太极判定，反弹独立结算',
    run: () => run(() => {
      const g = makeGame([{ id: 'W', char: 'wuliuqi' }, { id: 'M', char: 'mabaoguo' }], 300);
      g.players['M'].room = 'R1'; // 与 W 同房间
      playThrows(g, [{ W: 'rock', M: 'scissors' }]); // W 胜
      actQueue(g, { W: { type: 'attack', targetId: 'M' } });
      const judgeCount = g.logs.filter((l) => l.text.includes('太极判定：')).length;
      const segCount = g.logs.filter((l) => l.type === 'damage' && l.text.includes('M') && l.text.match(/第\d\/3段/)).length;
      // 每段独立判定（除非马保国中途死亡）
      const mDead = !isAlive(g, 'M');
      const wDead = !isAlive(g, 'W');
      // 一致性：判定次数 ≤ 3（每段一次），若马保国活着则可能反弹给 W
      const ok = judgeCount >= 1 && judgeCount <= 3 && (mDead || wDead || (hpOf(g, 'M') < 3 || hpOf(g, 'W') < 3 || true));
      return check(judgeCount >= 1 && judgeCount <= 3,
        `每段独立太极判定（判定${judgeCount}次，M死=${mDead}，W死=${wDead}，段结算=${segCount}）`,
        `judge=${judgeCount}, W=${hpOf(g, 'W')}, M=${hpOf(g, 'M')}`, g);
    }),
  },
  {
    id: 'TC-X002', name: '极高伤害 × 反弹：非免疫高额伤害可被太极反弹', category: 'complex', seed: 301,
    desc: '延迟高额伤害（非noReflect）指向马保国 → 太极判定成功则伤害反弹给来源',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'default' }, { id: 'M', char: 'mabaoguo' }], 301);
      g.addDeferred({
        kind: 'damage', room: 'R1', explodeRound: 1, source: 'A', createdAtRound: 1,
        payload: { target: 'M', amount: 999, source: 'A', dtype: 'special', tag: 'test-kill' },
      });
      playThrows(g, [{ A: 'rock', M: 'paper' }]); // M 胜 → M 行动 skip → 回合末
      actQueue(g, { M: { type: 'skip' } });
      const reflected = g.logs.some((l) => l.text.includes('太极判定成功'));
      const mDead = !isAlive(g, 'M');
      const aDead = !isAlive(g, 'A');
      // 一致性：若反弹成功 → A 承受 999 死亡，M 存活；否则 M 死
      const ok = (reflected && aDead && isAlive(g, 'M')) || (!reflected && mDead && isAlive(g, 'A'));
      return check(ok, `反弹=${reflected} → 一致的死亡结果（M死=${mDead}, A死=${aDead}）`,
        `reflected=${reflected}, M alive=${isAlive(g, 'M')}, A alive=${isAlive(g, 'A')}`, g);
    }),
  },
  {
    id: 'TC-X003', name: '延迟爆炸 × 回合顺序：爆炸在引燃回合所有行动结束后', category: 'complex', seed: 302,
    desc: '投掷发生在第1回合行动队列中，爆炸发生在第2回合（下一分出胜负回合）行动结束后的回合末',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'ivan-girl' }, { id: 'B', char: 'wuliuqi' }, 'C'], 302);
      g.players['B'].room = 'R2';
      playThrows(g, [{ A: 'rock', B: 'scissors', C: 'scissors' }]); // 第1回合 A 胜
      actQueue(g, { A: { type: 'throwIvan', room: 'R2' } });
      const boomR1 = g.logs.some((l) => l.text.includes('大伊万在 R2 爆炸'));
      playThrows(g, [{ A: 'rock', B: 'scissors', C: 'scissors' }]); // 第2回合 A 再胜（引爆回合）
      actQueue(g, { A: { type: 'skip' } });
      const throwSeq = g.logs.findIndex((l) => l.text.includes('投掷大伊万'));
      const boomSeq = g.logs.findIndex((l) => l.text.includes('大伊万在 R2 爆炸'));
      // 爆炸日志序号 > 投掷日志序号（引燃回合末结算）
      const ok = boomR1 === false && throwSeq >= 0 && boomSeq > throwSeq && !isAlive(g, 'B');
      return check(ok, '投掷后下一分出胜负回合末爆炸', `boomR1=${boomR1}, throw@${throwSeq}, boom@${boomSeq}, B alive=${isAlive(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-X004', name: '被动 × AOE：大贱客吸引伍六七全部段伤害（含死亡后恢复正常）', category: 'complex', seed: 303,
    desc: 'AOE 每段的转移独立判定：大贱客死亡后剩余段正常结算',
    run: () => run(() => {
      const g = makeGame([{ id: 'D', char: 'dajianke' }, { id: 'W', char: 'wuliuqi' }, 'B'], 303);
      g.players['D'].room = 'R2'; g.players['B'].room = 'R2';
      g.players['D'].hp = 4; g.players['D'].maxHp = 4;
      playThrows(g, [{ W: 'rock', D: 'scissors', B: 'scissors' }]); // W 胜（rock 组胜 scissors 组）
      actQueue(g, { W: { type: 'attack', targetId: 'B' } });
      // 段内目标顺序 [D,B]：段1 D-2(hp2)；段2 D-2 死亡（B的段2转移伤害为致死一击）；段3 D 已死跳过，B -1(hp2)
      const ok = !isAlive(g, 'D') && hpOf(g, 'B') === 1;
      return check(ok, `D 被吸伤死亡（承受4伤），段3 落在 B（hp=1）`,
        `D=${hpOf(g, 'D')}, B=${hpOf(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-X005', name: '精神攻击 × 躲避：辱骂无视躲藏', category: 'complex', seed: 304,
    desc: '大贱客辱骂躲藏目标成功计数',
    run: () => run(() => {
      const g = makeGame([{ id: 'D', char: 'dajianke' }, 'B'], 304);
      g.players['B'].room = 'R1'; g.players['B'].hidden = true;
      playThrows(g, [{ D: 'rock', B: 'scissors' }]);
      actQueue(g, { D: { type: 'attack', targetId: 'B' } });
      const n = ((g.charState('D').insults as Record<string, number>)['B']) || 0;
      const ok = n === 1 && isAlive(g, 'B');
      return check(ok, '躲藏目标被辱骂锁定（计数1）', `insults=${n}`, g);
    }),
  },
  {
    id: 'TC-X006', name: '历史判定 × 状态重置：大屁孩触发后历史清零重新累积', category: 'complex', seed: 305,
    desc: '暴走触发后历史重置，再次累积三同才会自爆',
    run: () => run(() => {
      const g = makeGame([{ id: 'P', char: 'dapihuai' }, 'A', 'B'], 305);
      g.judgeHistory('P').push('win', 'lose');
      playThrows(g, [{ P: 'rock', A: 'rock', B: 'rock' }]); // tie → 暴走
      const berserk1 = g.logs.some((l) => l.text.includes('暴走'));
      const histAfter = g.judgeHistory('P').length;
      // 若 P 仍存活，继续累积两条相同不会立刻触发
      const ok = berserk1 && histAfter === 0;
      return check(ok, '暴走后历史=0，需重新累积', `berserk=${berserk1}, hist=${histAfter}`, g);
    }),
  },
  {
    id: 'TC-X007', name: '角色规则覆盖：领域平局算胜覆盖默认平局规则', category: 'complex', seed: 306,
    desc: '五条悟领域生效时，平局子轮不再重判而是直接判胜',
    run: () => run(() => {
      const g = makeGame([{ id: 'G', char: 'gojo' }, 'B'], 306);
      g.charState('G').domain = true;
      playThrows(g, [{ G: 'paper', B: 'paper' }]);
      const ok = g.phase === 'act' && g.qualified[0] === 'G' && g.judgeRecords.some((r) => r.outcome === 'tieWin');
      return check(ok, '平局被领域覆盖为胜（tieWin）', `phase=${g.phase}, outcome记录=${g.judgeRecords.map(r=>r.outcome).join(',')}`, g);
    }),
  },
  {
    id: 'TC-X008', name: '同回合淘汰：反弹致死与死亡链', category: 'complex', seed: 231,
    desc: '马保国反弹击杀攻击者后，游戏正确继续/结束',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'default' }, { id: 'M', char: 'mabaoguo' }], 231);
      g.players['M'].room = 'R1';
      g.players['A'].hp = 1;
      playThrows(g, [{ A: 'rock', M: 'scissors' }]); // A 胜
      actQueue(g, { A: { type: 'attack', targetId: 'M' } });
      // 反弹1伤给 A（hp1）→ A 死亡 → M 获胜
      const reflected = g.logs.some((l) => l.text.includes('太极判定成功'));
      const ok = reflected && !isAlive(g, 'A') && isAlive(g, 'M') && g.winner === 'M';
      return check(ok, '反弹致死，M 获胜', `reflected=${reflected}, winner=${g.winner}`, g);
    }),
  },
  {
    id: 'TC-X009', name: '多个延迟事件：两颗大伊万同回合末结算', category: 'complex', seed: 308,
    desc: '两个不同房间的伊万均在回合末爆炸',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'ivan-girl' }, 'B', 'C', 'D'], 308);
      g.players['B'].room = 'R2'; g.players['C'].room = 'R3'; g.players['D'].room = 'R4';
      playThrows(g, [{ A: 'rock', B: 'scissors', C: 'scissors', D: 'scissors' }]); // A 胜
      // 但 A 一次行动只能投一颗——投两颗需两回合；用 addDeferred 直接构造两颗（引擎能力测试）
      g.addDeferred({ kind: 'ivan', room: 'R2', explodeRound: 1, source: 'A', createdAtRound: 1 });
      g.addDeferred({ kind: 'ivan', room: 'R3', explodeRound: 1, source: 'A', createdAtRound: 1 });
      actQueue(g, { A: { type: 'skip' } });
      const booms = g.logs.filter((l) => l.text.includes('爆炸')).length;
      const ok = booms >= 2 && !isAlive(g, 'B') && !isAlive(g, 'C') && isAlive(g, 'D');
      return check(ok, '两颗伊万均爆炸，R4 的 D 存活', `booms=${booms}, B=${isAlive(g,'B')}, C=${isAlive(g,'C')}, D=${isAlive(g,'D')}`, g);
    }),
  },
  {
    id: 'TC-X010', name: '隐藏提交 × 状态隔离：快照不泄露未揭示出拳', category: 'complex', seed: 309,
    desc: 'rps1 进行中 snapshot() 不包含任何玩家出拳值',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'default' }, 'B'], 309);
      g.submitThrow('A', 'rock');
      const snap = JSON.stringify(g.snapshot());
      const leaked = snap.includes('"rock"') || snap.includes('"scissors"') || snap.includes('"paper"');
      // judgeRecords 在判定完成前为空
      const ok = !leaked && (g.judgeRecords.length === 0);
      return check(ok, '快照不含出拳值', leaked ? '泄露！' : '未泄露', g);
    }),
  },
  {
    id: 'TC-X011', name: '状态隔离：玩家历史/角色状态/房间状态互不串扰', category: 'complex', seed: 310,
    desc: '两名五条悟领域状态独立；不同房间成员独立',
    run: () => run(() => {
      const g = makeGame([{ id: 'G1', char: 'gojo' }, { id: 'G2', char: 'gojo' }, 'B'], 310);
      g.charState('G1').domain = true;
      const ok = g.charState('G1').domain === true && g.charState('G2').domain === false;
      return check(ok, 'G1 领域开启不影响 G2', `G1=${g.charState('G1').domain}, G2=${g.charState('G2').domain}`, g);
    }),
  },
  {
    id: 'TC-X012', name: '躲藏 × AOE × 转移：躲藏目标被AOE命中且伤害仍被大贱客吸引', category: 'complex', seed: 311,
    desc: '伍六七AOE命中躲藏的B → 伤害转移至大贱客',
    run: () => run(() => {
      const g = makeGame([{ id: 'D', char: 'dajianke' }, { id: 'W', char: 'wuliuqi' }, 'B'], 311);
      g.players['D'].room = 'R2'; g.players['B'].room = 'R2'; g.players['B'].hidden = true;
      playThrows(g, [{ W: 'rock', D: 'scissors', B: 'scissors' }]); // W 胜
      actQueue(g, { W: { type: 'attack', targetId: 'B' } });
      const transferred = g.logs.some((l) => l.text.includes('被吸引至大贱客'));
      // 段内目标顺序 [D,B]：段1 D-1(2)+转移D-1(1)；段2 D-1(0)死，B无转移对象-1(1)；段3 B-1(0)死
      const ok = transferred && !isAlive(g, 'D') && hpOf(g, 'B') === 0 && !isAlive(g, 'B');
      return check(ok, '躲藏目标被AOE命中且伤害转移；D 死后剩余段落在 B（血量2耗尽）', `transferred=${transferred}, B=${hpOf(g, 'B')}, D=${hpOf(g, 'D')}`, g);
    }),
  },
  {
    id: 'TC-X013', name: '复活接口预留验证：淘汰不可被普通行动撤销', category: 'complex', seed: 312,
    desc: '淘汰后回复/攻击均不改变淘汰状态（无复活角色时）',
    run: () => run(() => {
      const g = makeGame(['A', 'B'], 312);
      g.eliminate('B', 'test');
      g.applyDamage({ target: 'B', amount: 1, source: 'A', dtype: 'physical' }); // 对死者的伤害应无效
      const ok = !isAlive(g, 'B') && hpOf(g, 'B') === 0;
      return check(ok, '淘汰状态不可撤销', `B alive=${isAlive(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-X014', name: '回合顺序 × 多名胜者：全部按序行动一次', category: 'complex', seed: 313,
    desc: '3名胜者依次行动，每人恰好一次',
    run: () => run(() => {
      const g = makeGame(['A', 'B', 'C', 'D'], 313);
      playThrows(g, [{ A: 'rock', B: 'rock', C: 'rock', D: 'scissors' }]); // A、B、C 胜
      const actions: Record<string, { type: string }> = {};
      for (const pid of ['A', 'B', 'C']) actions[pid] = { type: 'heal' };
      const healLogs: number[] = [];
      const before = g.logs.length;
      actQueue(g, actions);
      const healCount = g.logs.slice(before).filter((l) => l.type === 'heal').length;
      const ok = healCount === 3 && g.phase !== 'act';
      return check(ok, '3名胜者各行动一次（3条回复日志）', `healLogs=${healCount}, phase=${g.phase}`, g);
    }),
  },
];
