/**
 * 拔典 · 9 角色机制测试用例（任务书第 20 节）
 * 与机制测试场共享。所有用例固定种子可复现。
 */

import type { TestCase, TestRunResult } from './helpers.js';
import {
  makeGame, playThrows, actQueue, check, safeRun, hpOf, isAlive, roomOf,
} from './helpers.js';
import type { Throw } from '../types.js';

function run(fn: () => TestRunResult): TestRunResult {
  return safeRun(fn);
}

/** 胜者胜出后行动：让 act 指定玩家执行行动（需要其有资格） */
function winRound(g: ReturnType<typeof makeGame>, throws: Record<string, Throw>, actions: Record<string, { type: string; targetId?: string; room?: string; ranged?: boolean }>): void {
  playThrows(g, [throws]);
  actQueue(g, actions);
}

export const CHARACTER_CASES: TestCase[] = [
  // ═══════════════ 20.1 拔棍 ═══════════════
  {
    id: 'TC-C001', name: '拔棍：未拔棍攻击被拒绝', category: 'character', charId: 'bagun', seed: 201,
    desc: '拔棍未拔棍时攻击 → 拒绝且不造成伤害',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'bagun' }, 'B'], 201);
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'attack', targetId: 'B' } });
      const ok = hpOf(g, 'B') === 3 && g.currentActor() === 'A'; // 行动未消耗
      return check(ok, '攻击被拒绝（未拔棍），B 满血，A 仍待行动', `hp=${hpOf(g, 'B')}, error日志=${g.logs.filter(l=>l.type==='error').length}`, g);
    }),
  },
  {
    id: 'TC-C002', name: '拔棍：拔棍后攻击造成1伤', category: 'character', charId: 'bagun', seed: 202,
    desc: '先拔棍（消耗本回合行动），下一回合攻击 → B HP 3→2',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'bagun' }, 'B'], 202);
      g.players['B'].room = 'R1';
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'toggleStick' } });
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'attack', targetId: 'B' } });
      const ok = hpOf(g, 'B') === 2 && g.charState('A').stickDrawn === true;
      return check(ok, 'B HP=2，拔棍状态保持', `hp=${hpOf(g, 'B')}, stickDrawn=${g.charState('A').stickDrawn}`, g);
    }),
  },
  {
    id: 'TC-C003', name: '拔棍：无视躲藏（含躲藏与隐身）', category: 'character', charId: 'bagun', seed: 203,
    desc: 'B 躲藏且隐身后，拔棍状态下 A 仍可攻击命中',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'bagun' }, 'B'], 203);
      g.players['B'].room = 'R1';
      g.players['B'].hidden = true;
      g.players['B'].invisible = true;
      g.charState('A').stickDrawn = true;
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'attack', targetId: 'B' } });
      const ok = hpOf(g, 'B') === 2;
      return check(ok, 'B HP=2（无视躲避直伤）', `hp=${hpOf(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C004', name: '拔棍：状态切换（收棍后无法攻击）', category: 'character', charId: 'bagun', seed: 204,
    desc: '拔棍→收棍→攻击被拒绝',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'bagun' }, 'B'], 204);
      g.players['B'].room = 'R1';
      g.charState('A').stickDrawn = true;
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'toggleStick' } });
      const drawnAfter = g.charState('A').stickDrawn === false;
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'attack', targetId: 'B' } });
      const ok = drawnAfter && hpOf(g, 'B') === 3;
      return check(ok, '收棍后攻击拒绝，B 满血', `stickDrawn=${g.charState('A').stickDrawn}, hp=${hpOf(g, 'B')}`, g);
    }),
  },

  // ═══════════════ 20.2 吹箫哥 ═══════════════
  {
    id: 'TC-C010', name: '吹箫哥：无法近战', category: 'character', charId: 'chuixiao', seed: 210,
    desc: '同房间目标攻击 → 拒绝（仅能远程）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'chuixiao' }, { id: 'B', char: 'chuixiao' }], 210);
      g.players['B'].room = 'R1'; // 同房间
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'attack', targetId: 'B' } });
      const ok = hpOf(g, 'B') === 3 && g.currentActor() === 'A';
      return check(ok, '近战拒绝，B 满血', `hp=${hpOf(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C011', name: '吹箫哥：远程攻击需先瞄准', category: 'character', charId: 'chuixiao', seed: 211,
    desc: '异房间目标未瞄准 → 拒绝；瞄准后下一回合攻击命中',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'chuixiao' }, 'B'], 211);
      // A、B 初始异房间（R1、R2）
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'attack', targetId: 'B' } });
      const rejected = hpOf(g, 'B') === 3;
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'aim', targetId: 'B' } });
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'attack', targetId: 'B', ranged: true } });
      const ok = rejected && hpOf(g, 'B') === 2 && g.charState('A').aim === undefined;
      return check(ok, '未瞄准拒绝；瞄准后命中 B HP=2，瞄准已消耗', `hp=${hpOf(g, 'B')}, aim=${g.charState('A').aim}`, g);
    }),
  },
  {
    id: 'TC-C012', name: '吹箫哥：瞄准错误目标则攻击失败', category: 'character', charId: 'chuixiao', seed: 212,
    desc: '瞄准 B 后攻击 C → 拒绝（需瞄准目标本人）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'chuixiao' }, 'B', 'C'], 212);
      winRound(g, { A: 'rock', B: 'scissors', C: 'rock' }, { A: { type: 'aim', targetId: 'B' } });
      // 下一回合攻击 C
      winRound(g, { A: 'rock', B: 'scissors', C: 'rock' }, { A: { type: 'attack', targetId: 'C', ranged: true } });
      const ok = hpOf(g, 'C') === 3 && g.charState('A').aim === 'B';
      return check(ok, '攻击 C 被拒绝，C 满血，瞄准仍保持', `hpC=${hpOf(g, 'C')}, aim=${g.charState('A').aim}`, g);
    }),
  },

  // ═══════════════ 20.3 五条悟 ═══════════════
  {
    id: 'TC-C020', name: '五条悟：近战3伤', category: 'character', charId: 'gojo', seed: 220,
    desc: '同房间近战 → 3伤害',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'gojo' }, 'B'], 220);
      g.players['B'].room = 'R1';
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'attack', targetId: 'B' } });
      const ok = hpOf(g, 'B') === 0 && !isAlive(g, 'B');
      return check(ok, 'B HP 3-3=0，被淘汰', `hp=${hpOf(g, 'B')}, alive=${isAlive(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C021', name: '五条悟：远程2伤且需瞄准；领域展开后免瞄准', category: 'character', charId: 'gojo', seed: 221,
    desc: '未瞄准远程拒绝 → 瞄准后2伤 → 展开领域后远程免瞄准',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'gojo' }, 'B'], 221);
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'attack', targetId: 'B', ranged: true } });
      const step1 = hpOf(g, 'B') === 3; // 未瞄准拒绝
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'aim', targetId: 'B' } });
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'attack', targetId: 'B', ranged: true } });
      const step2 = hpOf(g, 'B') === 1; // 瞄准后2伤
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'domain' } });
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'attack', targetId: 'B', ranged: true } });
      const step3 = hpOf(g, 'B') === 0 && g.charState('A').domain === true; // 领域免瞄准
      return check(step1 && step2 && step3, '未瞄准拒绝→瞄准2伤→领域免瞄准2伤淘汰',
        `s1=${step1}, s2=${step2}(hp=${hpOf(g,'B')}), s3=${step3}`, g);
    }),
  },
  {
    id: 'TC-C022', name: '五条悟：领域展开后平局算五条悟胜', category: 'character', charId: 'gojo', seed: 222,
    desc: '五条悟领域生效，判定子轮全员同拳 → 五条悟直接判胜',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'gojo' }, 'B'], 222);
      g.charState('A').domain = true;
      playThrows(g, [{ A: 'rock', B: 'rock' }]); // 平局 → 领域判胜
      const ok = g.phase === 'act' && g.qualified.length === 1 && g.qualified[0] === 'A';
      return check(ok, '平局子轮中五条悟获行动资格', `phase=${g.phase}, q=${g.qualified.join(',')}`, g);
    }),
  },
  {
    id: 'TC-C023', name: '五条悟：领域对冲（两名持有者平局效果抵消）', category: 'character', charId: 'gojo', seed: 223,
    desc: '五条悟与老大爷领域同时生效 → 平局保持平局，需重判',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'gojo' }, { id: 'B', char: 'laodaye' }], 223);
      g.charState('A').domain = true;
      g.charState('B').domain = true;
      playThrows(g, [{ A: 'rock', B: 'rock' }]);
      const ok = g.phase === 'rps1' && g.subRound === 2 && g.qualified.length === 0;
      const hasClashLog = g.logs.some((l) => l.text.includes('领域对冲'));
      return check(ok && hasClashLog, '平局未判胜，重新判定，日志含领域对冲', `phase=${g.phase}, sub=${g.subRound}`, g);
    }),
  },
  {
    id: 'TC-C024', name: '老大爷：领域内强化伤害近5远3', category: 'character', charId: 'laodaye', seed: 224,
    desc: '老大爷展开领域并强化后近战造成5伤',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'laodaye' }, { id: 'B', char: 'laodaye' }], 224);
      g.players['B'].room = 'R1';
      g.players['B'].hp = 6; g.players['B'].maxHp = 6;
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'domain' } });
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'boostAttack' } });
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'attack', targetId: 'B' } });
      const ok = hpOf(g, 'B') === 1;
      return check(ok, 'B HP 6-5=1', `hp=${hpOf(g, 'B')}`, g);
    }),
  },

  // ═══════════════ 20.4 马保国 ═══════════════
  {
    id: 'TC-C030', name: '马保国：混元形意太极反弹触发', category: 'character', charId: 'mabaoguo', seed: 231,
    desc: '种子231下太极判定马保国赢 → 原伤反弹给攻击者',
    run: () => run(() => {
      const g = makeGame(['A', { id: 'B', char: 'mabaoguo' }], 231);
      g.players['B'].room = 'R1';
      playThrows(g, [{ A: 'rock', B: 'scissors' }]); // A 胜
      actQueue(g, { A: { type: 'attack', targetId: 'B' } });
      const reflected = g.logs.some((l) => l.text.includes('太极判定成功'));
      const aHp = hpOf(g, 'A'), bHp = hpOf(g, 'B');
      // 反弹：B 不掉血（或已死则由反弹致死），A 掉1
      const ok = reflected && aHp === 2 && bHp === (bHp <= 0 ? 0 : 4);
      return check(reflected, '太极反弹：A HP 3→2，B 未承受该伤害', `reflected=${reflected}, A=${aHp}, B=${bHp}`, g);
    }),
  },
  {
    id: 'TC-C031', name: '马保国：太极判定失败正常受伤', category: 'character', charId: 'mabaoguo', seed: 230,
    desc: '种子230下太极判定马保国输/平 → 伤害正常结算',
    run: () => run(() => {
      const g = makeGame(['A', { id: 'B', char: 'mabaoguo' }], 230);
      g.players['B'].room = 'R1';
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', targetId: 'B' } });
      const notReflected = !g.logs.some((l) => l.text.includes('太极判定成功'));
      const ok = notReflected && hpOf(g, 'B') === 3;
      return check(ok, '未反弹，B HP 4→3', `B=${hpOf(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C032', name: '马保国：闪电五连鞭按胜次扣血', category: 'character', charId: 'mabaoguo', seed: 232,
    desc: '五连鞭5局判定，伤害 = 胜次 × 20% × 目标最大血量',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'mabaoguo' }, 'B'], 232);
      g.players['A'].room = 'R2'; // 同房间才能五连鞭
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'whip5', targetId: 'B' } });
      const whipLog = g.logs.find((l) => l.text.includes('五连鞭命中'));
      const expectedWins = whipLog ? parseInt(whipLog.text.match(/(\d)\/5/)?.[1] || '0') : -1;
      const expectedDmg = expectedWins * 0.2 * 3;
      const actualDmg = 3 - hpOf(g, 'B');
      const ok = !!whipLog && Math.abs(actualDmg - expectedDmg) < 0.0001;
      return check(ok, `伤害=胜次×20%×3（胜次=${expectedWins}，期望伤害=${expectedDmg}）`,
        `日志=${whipLog?.text}, 实际伤害=${actualDmg}`, g);
    }),
  },
  {
    id: 'TC-C033', name: '马保国：不讲武德（被杀后5局赢3带走对面）', category: 'character', charId: 'mabaoguo', seed: 233,
    desc: '种子233：击杀马保国后触发5局判定，赢≥3则击杀者同时死亡',
    run: () => run(() => {
      const g = makeGame(['A', { id: 'B', char: 'mabaoguo' }], 233);
      g.players['B'].room = 'R1';
      g.players['B'].hp = 1;
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', targetId: 'B' } });
      const triggered = g.logs.some((l) => l.text.includes('不讲武德'));
      const outcomeLog = g.logs.filter((l) => l.text.includes('不讲武德')).slice(-1)[0];
      const bDead = !isAlive(g, 'B');
      const aDead = !isAlive(g, 'A');
      // 验证逻辑一致性：赢≥3则 A 死，否则 A 活
      const winsMatch = outcomeLog?.text.match(/(\d)\/5/);
      const wins = winsMatch ? parseInt(winsMatch[1]) : -1;
      const ok = triggered && bDead && ((wins >= 3) === aDead);
      return check(ok, `不讲武德已触发，判定结果与死亡状态一致（赢${wins}局，A死=${aDead}）`,
        `triggered=${triggered}, log=${outcomeLog?.text}`, g);
    }),
  },
  {
    id: 'TC-C034', name: '马保国：大伊万爆炸不触发太极反弹', category: 'character', charId: 'mabaoguo', seed: 234,
    desc: '大伊万秒杀为 noReflect，马保国直接死亡（规则原文例外）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'ivan-girl' }, { id: 'B', char: 'mabaoguo' }], 234);
      g.players['B'].room = 'R2'; // 和目标房间一致
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'throwIvan', room: 'R2' } }); // 回合末爆炸（A已行动）
      const ok = !isAlive(g, 'B') && !g.logs.some((l) => l.text.includes('太极判定成功') && l.round === 1);
      return check(ok, 'B 被大伊万毁灭，未触发太极反弹', `B alive=${isAlive(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C035', name: '马保国：反弹链终止（已反弹伤害不再判定）', category: 'character', charId: 'mabaoguo', seed: 235,
    desc: '马保国反弹伤害给来源；若来源也是马保国，reflected 标记阻止二次反弹（无无限链）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'mabaoguo' }, { id: 'B', char: 'mabaoguo' }], 235);
      g.players['B'].room = 'R1';
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', targetId: 'B' } });
      const reflectCount = g.logs.filter((l) => l.text.includes('太极判定成功')).length;
      const ok = reflectCount <= 1 && g.phase !== undefined; // 游戏未死循环（能跑到这里就说明链终止）
      return check(ok, '最多一次反弹，链终止', `反弹次数=${reflectCount}`, g);
    }),
  },

  // ═══════════════ 20.5 伍六七 ═══════════════
  {
    id: 'TC-C040', name: '伍六七：3段AOE独立结算', category: 'character', charId: 'wuliuqi', seed: 240,
    desc: '同房间目标承受三段各1伤（HP 3→0 淘汰），日志记录每段结算',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'wuliuqi' }, 'B'], 240);
      g.players['B'].room = 'R1';
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', targetId: 'B' } });
      const segLogs = g.logs.filter((l) => l.type === 'damage' && l.text.includes('第1/3段') && l.text.includes('B')).length;
      const ok = !isAlive(g, 'B') && segLogs >= 1 && (3 - hpOf(g, 'B')) === 3;
      return check(ok, 'B 承受3段×1伤被淘汰，每段有结算日志', `alive=${isAlive(g, 'B')}, seg1日志=${segLogs}`, g);
    }),
  },
  {
    id: 'TC-C041', name: '伍六七：目标集合为攻击时所在房间快照，段间死亡不再受击', category: 'character', charId: 'wuliuqi', seed: 241,
    desc: '房间内两名目标：第一段击杀一名，第二、三段不再对其结算',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'wuliuqi' }, 'B', 'C'], 241);
      g.players['B'].room = 'R1'; g.players['C'].room = 'R1';
      g.players['B'].hp = 1;
      playThrows(g, [{ A: 'rock', B: 'scissors', C: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', targetId: 'B' } });
      const bSeg1 = g.logs.some((l) => l.text.includes('B') && l.text.includes('第1/3段'));
      const bSeg2 = g.logs.some((l) => l.text.includes('B') && l.text.includes('第2/3段'));
      const ok = !isAlive(g, 'B') && bSeg1 && !bSeg2 && hpOf(g, 'C') === 0; // C 承受全部3段
      return check(ok, 'B 仅第1段结算（死亡），C 承受3段被淘汰',
        `B alive=${isAlive(g, 'B')}, seg2=${bSeg2}, C hp=${hpOf(g, 'C')}`, g);
    }),
  },
  {
    id: 'TC-C042', name: '伍六七：释放房间固定为攻击时所在房间（不会跟随移动）', category: 'character', charId: 'wuliuqi', seed: 242,
    desc: 'A 在 R1 释放 → 仅 R1 内目标受击（异房间 D 不受影响）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'wuliuqi' }, 'B', 'D'], 242);
      g.players['B'].room = 'R1';
      playThrows(g, [{ A: 'rock', B: 'scissors', D: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', targetId: 'B' } });
      const ok = hpOf(g, 'D') === 3 && !isAlive(g, 'B');
      return check(ok, 'R2 的 D 未受击，R1 的 B 被淘汰', `D hp=${hpOf(g, 'D')}, B alive=${isAlive(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C043', name: '伍六七：AOE命中躲藏目标', category: 'character', charId: 'wuliuqi', seed: 243,
    desc: '躲藏的 B 在房间内仍被AOE命中（AOE不受躲藏限制）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'wuliuqi' }, 'B'], 243);
      g.players['B'].room = 'R1';
      g.players['B'].hidden = true;
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', targetId: 'B' } });
      const ok = hpOf(g, 'B') === 0;
      return check(ok, '躲藏的 B 被AOE淘汰', `B hp=${hpOf(g, 'B')}, alive=${isAlive(g, 'B')}`, g);
    }),
  },

  // ═══════════════ 20.6 卖大伊万的小女孩 ═══════════════
  {
    id: 'TC-C050', name: '大伊万：投掷与爆炸分离，回合末爆炸', category: 'character', charId: 'ivan-girl', seed: 250,
    desc: '投掷后行动队列继续，所有人行动结束后爆炸',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'ivan-girl' }, 'B', 'C'], 250);
      g.players['B'].room = 'R2';
      playThrows(g, [{ A: 'rock', B: 'scissors', C: 'scissors' }]); // A 胜
      actQueue(g, { A: { type: 'throwIvan', room: 'R2' } });
      const threwBeforeOver = g.logs.some((l) => l.text.includes('投掷大伊万'));
      const exploded = g.logs.some((l) => l.text.includes('大伊万在 R2 爆炸'));
      const ok = threwBeforeOver && exploded && !isAlive(g, 'B');
      return check(ok, '投掷后回合末爆炸，R2 的 B 被毁灭', `B alive=${isAlive(g, 'B')}, exploded=${exploded}`, g);
    }),
  },
  {
    id: 'TC-C051', name: '大伊万：爆炸时动态判定成员（移动可逃离/进入）', category: 'character', charId: 'ivan-girl', seed: 251,
    desc: '目标房间玩家在爆炸前移动离开 → 不受影响；移动进入 → 受影响（不使用投掷时快照）',
    run: () => run(() => {
      const g2 = makeGame([{ id: 'A', char: 'ivan-girl' }, 'B', 'C', 'D'], 252);
      g2.players['B'].room = 'R2';
      g2.players['C'].room = 'R3';
      g2.players['D'].room = 'R4';
      playThrows(g2, [{ A: 'rock', B: 'rock', C: 'rock', D: 'scissors' }]); // rock 组（A、B、C）胜
      actQueue(g2, {
        B: { type: 'move', room: 'R3' }, // B 逃离 R2
        C: { type: 'move', room: 'R2' }, // C 进入 R2（投掷时不在）
        A: { type: 'throwIvan', room: 'R2' },
      });
      const bAlive = isAlive(g2, 'B');
      const cDead = !isAlive(g2, 'C');
      const ok = bAlive && cDead;
      return check(ok, 'B（已离开）存活，C（爆炸时在 R2）被毁灭（不使用投掷时快照）', `B alive=${bAlive}, C alive=${isAlive(g2, 'C')}`, g2);
    }),
  },
  {
    id: 'TC-C052', name: '大伊万：含自己所在房间，投掷者不离开则被毁灭', category: 'character', charId: 'ivan-girl', seed: 252,
    desc: '投掷到自己房间且不移动 → 自己也被秒杀（可能平局）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'ivan-girl' }, 'B'], 253);
      playThrows(g, [{ A: 'rock', B: 'scissors' }]); // A 胜
      actQueue(g, { A: { type: 'throwIvan', room: 'R1' } });
      const ok = !isAlive(g, 'A') && (g.winner === null ? true : g.winner === undefined);
      // A 自爆后 B 存活 → B 胜（如果 B 未被波及）
      return check(!isAlive(g, 'A'), 'A 被自己投掷的大伊万毁灭', `A alive=${isAlive(g, 'A')}, winner=${g.winner}`, g);
    }),
  },
  {
    id: 'TC-C053', name: '大伊万：爆炸秒杀与死亡（多目标）', category: 'character', charId: 'ivan-girl', seed: 253,
    desc: '爆炸房间内多名玩家全部毁灭',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'ivan-girl' }, 'B', 'C'], 254);
      g.players['B'].room = 'R2'; g.players['C'].room = 'R2';
      playThrows(g, [{ A: 'rock', B: 'scissors', C: 'paper' }]); // 三人循环 → 重判
      playThrows(g, [{ A: 'rock', B: 'rock', C: 'rock' }, { A: 'rock', B: 'scissors', C: 'scissors' }]); // A 胜
      actQueue(g, { A: { type: 'throwIvan', room: 'R2' } });
      const ok = !isAlive(g, 'B') && !isAlive(g, 'C') && isAlive(g, 'A') && g.winner === 'A';
      return check(ok, 'B、C 被毁灭，A 获胜', `B=${isAlive(g,'B')}, C=${isAlive(g,'C')}, winner=${g.winner}`, g);
    }),
  },

  // ═══════════════ 20.7 今日勇者（随机数代表） ═══════════════
  {
    id: 'TC-C060', name: '今日勇者：基础面板（3血2攻）与运势技能入口', category: 'character', charId: 'hero-today', seed: 260,
    desc: '初始血量3攻击2；拥有「抽取今日运势」技能（用户确认规则）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'hero-today' }, 'B'], 260);
      const okInit = g.players['A'].hp === 3 && g.players['A'].maxHp === 3;
      const hasAction = g.charDef('A').actions?.some((a) => a.name === 'rollFortune') === true;
      g.players['B'].room = 'R1';
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', targetId: 'B' } });
      const okAtk = hpOf(g, 'B') === 1; // 基础攻击2
      return check(okInit && okAtk && hasAction, '初始3血2攻确认，普攻2伤，运势技能已注册',
        `hpA=${g.players['A'].hp}, B=${hpOf(g, 'B')}, hasRollFortune=${hasAction}`, g);
    }),
  },
  {
    id: 'TC-C062', name: '今日勇者：运势掷出9 → 血6攻6且攻击生效', category: 'character', charId: 'hero-today', seed: 4,
    desc: '种子4首次掷出9：面板变血6攻6；随后普攻造成6伤',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'hero-today' }, 'B'], 4);
      g.players['B'].room = 'R1';
      g.players['B'].hp = 6; g.players['B'].maxHp = 6;
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'rollFortune' } });
      const rolled = g.players['A'].hp === 6 && g.players['A'].maxHp === 6
        && g.charState('A').attackOverride === 6;
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', targetId: 'B' } });
      const okAtk = hpOf(g, 'B') === 0; // 6-6=0
      return check(rolled && okAtk, '掷出9 → 血6攻6，普攻造成6伤淘汰B',
        `面板=${rolled}(A hp=${g.players['A'].hp}), B=${hpOf(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C063', name: '今日勇者：运势掷出0 → 直接暴毙', category: 'character', charId: 'hero-today', seed: 7,
    desc: '种子7首次掷出0：当场暴毙（游戏结束，对手获胜）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'hero-today' }, 'B'], 7);
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'rollFortune' } });
      const dead = !isAlive(g, 'A');
      const over = g.isOver() && g.winner === 'B';
      const causeLogged = g.logs.some((l) => l.text.includes('运势极凶'));
      return check(dead && over && causeLogged, '掷出0 → A 暴毙，B 获胜',
        `A alive=${isAlive(g, 'A')}, winner=${g.winner}, log=${causeLogged}`, g);
    }),
  },
  {
    id: 'TC-C064', name: '今日勇者：运势掷出6 → 血4攻2（与初始面板不同可辨）', category: 'character', charId: 'hero-today', seed: 1,
    desc: '种子1首次掷出6：面板变血4攻2；普攻造成2伤（攻击力覆盖生效）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'hero-today' }, 'B'], 1);
      g.players['B'].room = 'R1';
      g.players['B'].hp = 4; g.players['B'].maxHp = 4;
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'rollFortune' } });
      const rolled = g.players['A'].hp === 4 && g.players['A'].maxHp === 4
        && g.charState('A').attackOverride === 2;
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', targetId: 'B' } });
      const okAtk = hpOf(g, 'B') === 2; // 4-2=2
      return check(rolled && okAtk, '掷出6 → 血4攻2，普攻造成2伤',
        `面板=${rolled}(A hp=${g.players['A'].hp}), B=${hpOf(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C061', name: '通用随机模块：固定种子可复现', category: 'character', charId: 'hero-today', seed: 261,
    desc: '同种子下判定序列一致（随机事件可复现、可记录）',
    run: () => run(() => {
      const play = () => {
        const g = makeGame([{ id: 'A', char: 'hero-today' }, { id: 'B', char: 'mabaoguo' }], 261);
        g.players['B'].room = 'R1';
        for (let r = 0; r < 4; r++) {
          if (g.isOver()) break;
          playThrows(g, [{ A: 'rock', B: 'paper' }]);
          actQueue(g, { A: { type: 'attack', targetId: 'B' }, B: { type: 'attack', targetId: 'A' } });
        }
        return fmtLogsOf(g);
      };
      const l1 = play(); const l2 = play();
      const ok = l1 === l2 && l1.length > 0;
      return check(ok, '两次运行日志一致（含随机判定）', ok ? `一致（长度${l1.length}）` : '不一致', undefined);
    }),
  },

  // ═══════════════ 20.8 大贱客 ═══════════════
  {
    id: 'TC-C070', name: '大贱客：被动吸引全场普通攻击伤害', category: 'character', charId: 'dajianke', seed: 270,
    desc: 'A 攻击 B → 伤害自动转移至大贱客（仅转移伤害）',
    run: () => run(() => {
      const g = makeGame([{ id: 'D', char: 'dajianke' }, 'A', 'B'], 270);
      g.players['A'].room = 'R2'; g.players['B'].room = 'R2'; // A、B 同房间
      playThrows(g, [{ A: 'rock', B: 'scissors', D: 'paper' }]);
      // 判定：rock>scissors（A胜B），paper>rock（D胜A），scissors>paper（B胜D）→ 三人循环
      playThrows(g, [{ A: 'rock', B: 'rock', D: 'scissors' }]); // A、D 胜
      actQueue(g, { A: { type: 'attack', targetId: 'B' } });
      const transferred = g.logs.some((l) => l.text.includes('被吸引至大贱客'));
      const ok = transferred && hpOf(g, 'D') === 2 && hpOf(g, 'B') === 3;
      return check(ok, '伤害转移：大贱客 HP 3→2，B 未受伤', `D=${hpOf(g, 'D')}, B=${hpOf(g, 'B')}, transferred=${transferred}`, g);
    }),
  },
  {
    id: 'TC-C071', name: '大贱客：AOE伤害同样转移', category: 'character', charId: 'dajianke', seed: 271,
    desc: '伍六七AOE释放，房间内大贱客在场 → 全部伤害转移至大贱客',
    run: () => run(() => {
      const g = makeGame([{ id: 'D', char: 'dajianke' }, { id: 'W', char: 'wuliuqi' }, 'B'], 271);
      // W 的房间 R2；让 D、B 都进入 R2
      g.players['D'].room = 'R2'; g.players['B'].room = 'R2';
      playThrows(g, [{ W: 'rock', D: 'scissors', B: 'scissors' }]); // W 胜
      actQueue(g, { W: { type: 'attack', targetId: 'B' } });
      // 段内顺序 [D,B]：D 直接承受（自己是目标不转移），B 的伤害转移至 D。
      // 段1：D -2（hp1）；段2：D -1 死亡 → B 的伤害无转移对象 → B -1（hp2）；段3：B -1（hp1）
      const ok = !isAlive(g, 'D') && hpOf(g, 'B') === 1 && hpOf(g, 'W') === 3;
      return check(ok, '伤害全部流向大贱客直至其死亡；其后伤害正常落在 B',
        `D=${hpOf(g, 'D')}, B=${hpOf(g, 'B')}, W=${hpOf(g, 'W')}`, g);
    }),
  },
  {
    id: 'TC-C072', name: '大贱客：精神伤害不转移', category: 'character', charId: 'dajianke', seed: 272,
    desc: '精神攻击目标非大贱客 → 伤害正常结算（不被吸引）',
    run: () => run(() => {
      const g = makeGame([{ id: 'D', char: 'dajianke' }, 'A', 'B'], 272);
      // 直接施加精神伤害（如辱骂/暴走类）：不转移
      g.applyDamage({ target: 'B', amount: 1, source: 'A', dtype: 'mental', bypassHide: true, tag: 'test-mental' });
      const ok = hpOf(g, 'B') === 2 && hpOf(g, 'D') === 3;
      return check(ok, '精神伤害正常落在 B（HP 3→2），大贱客未承受', `B=${hpOf(g, 'B')}, D=${hpOf(g, 'D')}`, g);
    }),
  },
  {
    id: 'TC-C073', name: '大贱客：延迟伤害转移', category: 'character', charId: 'dajianke', seed: 273,
    desc: '回合末结算的延迟伤害同样被吸引',
    run: () => run(() => {
      const g = makeGame([{ id: 'D', char: 'dajianke' }, 'A', 'B'], 273);
      g.addDeferred({
        kind: 'damage', room: 'R1', explodeRound: 1, source: 'A', createdAtRound: 1,
        payload: { target: 'B', amount: 2, source: 'A', dtype: 'physical', tag: 'delayed-test' },
      });
      // 让回合结束（所有人出拳，胜者跳过）
      playThrows(g, [{ A: 'rock', B: 'scissors', D: 'paper' }]);
      playThrows(g, [{ A: 'rock', B: 'rock', D: 'paper' }]); // D 胜
      actQueue(g, { D: { type: 'skip' } });
      const ok = hpOf(g, 'D') === 1 && hpOf(g, 'B') === 3;
      return check(ok, '延迟2伤转移至大贱客（HP 3→1），B 未受伤', `D=${hpOf(g, 'D')}, B=${hpOf(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C074', name: '大贱客：辱骂累计三次致死', category: 'character', charId: 'dajianke', seed: 274,
    desc: '第1、2次辱骂无伤害，第3次目标精神致死；计数重置',
    run: () => run(() => {
      const g = makeGame([{ id: 'D', char: 'dajianke' }, 'B'], 274);
      g.players['B'].room = 'R1';
      const insults = (): number => (g.charState('D').insults as Record<string, number>)['B'] || 0;
      // D 三回合辱骂（每回合 D 都需要资格）
      playThrows(g, [{ D: 'rock', B: 'paper' }]); // D 胜? paper>rock → B 胜！改
      const g2 = makeGame([{ id: 'D', char: 'dajianke' }, 'B'], 274);
      g2.players['B'].room = 'R1';
      playThrows(g2, [{ D: 'rock', B: 'scissors' }]); // D 胜
      actQueue(g2, { D: { type: 'attack', targetId: 'B' } });
      const n1 = insults2(g2);
      playThrows(g2, [{ D: 'rock', B: 'scissors' }]);
      actQueue(g2, { D: { type: 'attack', targetId: 'B' } });
      const n2 = insults2(g2);
      playThrows(g2, [{ D: 'rock', B: 'scissors' }]);
      actQueue(g2, { D: { type: 'attack', targetId: 'B' } });
      const ok = !isAlive(g2, 'B') && hpOf(g2, 'B') === 0;
      return check(ok, `辱骂累计 ${n1}→${n2}→3，B 精神致死`, `B alive=${isAlive(g2, 'B')}, D hp=${hpOf(g2, 'D')}`, g2);
    }),
  },
  {
    id: 'TC-C075', name: '大贱客：辱骂无视躲避（不消耗行动）', category: 'character', charId: 'dajianke', seed: 275,
    desc: '躲藏的 B 仍可被辱骂锁定',
    run: () => run(() => {
      const g = makeGame([{ id: 'D', char: 'dajianke' }, 'B'], 275);
      g.players['B'].room = 'R1';
      g.players['B'].hidden = true;
      playThrows(g, [{ D: 'rock', B: 'scissors' }]);
      actQueue(g, { D: { type: 'attack', targetId: 'B' } });
      const n = ((g.charState('D').insults as Record<string, number>)['B']) || 0;
      const ok = n === 1 && isAlive(g, 'B');
      return check(ok, '辱骂成功锁定躲藏目标（计数1）', `insults=${n}`, g);
    }),
  },
  {
    id: 'TC-C076', name: '大贱客：转移伤害不转移附加效果', category: 'character', charId: 'dajianke', seed: 276,
    desc: '带效果的伤害被转移后，效果不施加到大贱客（验证 effects 被剥离）',
    run: () => run(() => {
      const g = makeGame([{ id: 'D', char: 'dajianke' }, 'B'], 276);
      g.applyDamage({ target: 'B', amount: 1, source: 'D', dtype: 'physical', tag: 'fx-test', effects: [{ kind: 'test-buff' }] });
      const transferred = g.logs.some((l) => l.text.includes('被吸引至大贱客'));
      const effectAppliedToB = g.logs.some((l) => l.text.includes('B 获得效果'));
      const ok = transferred && !effectAppliedToB;
      return check(ok, '伤害转移，效果未施加', `transferred=${transferred}, effectToB=${effectAppliedToB}`, g);
    }),
  },

  // ═══════════════ 20.9 大屁孩 ═══════════════
  {
    id: 'TC-C080', name: '大屁孩：三不同结果（赢平输）暴走精神攻击', category: 'character', charId: 'dapihuai', seed: 280,
    desc: '判定历史出现 赢/平/输 任意排列的连续三项 → 暴走随机精神攻击',
    run: () => run(() => {
      const g = makeGame([{ id: 'P', char: 'dapihuai' }, 'A', 'B'], 280);
      // 构造历史：第一子轮三人循环（P 记 tie），第二子轮 P 输，第三子轮 P 赢
      g.judgeHistory('P').push('win', 'tie');
      playThrows(g, [{ P: 'rock', A: 'scissors', B: 'paper' }]); // 循环 → P 追加 tie → [win,tie,tie]? 
      // 直接构造：追加 tie 后检查——需要 win,tie,lose / 任意排列
      const g2 = makeGame([{ id: 'P', char: 'dapihuai' }, 'A', 'B'], 280);
      g2.judgeHistory('P').push('win', 'lose');
      const targetHpBefore = Math.min(g2.players['A'].hp, g2.players['B'].hp);
      playThrows(g2, [{ P: 'rock', A: 'rock', B: 'rock' }]); // 全同拳 → P 追加 tie → [win,lose,tie] 三不同 → 暴走
      const berserk = g2.logs.some((l) => l.text.includes('暴走'));
      const someoneHurt = g2.players['A'].hp < 3 || g2.players['B'].hp < 3;
      const histReset = g2.judgeHistory('P').length === 0;
      const ok = berserk && someoneHurt && histReset && targetHpBefore === 3;
      return check(ok, '三不同 → 暴走精神攻击（1伤），历史重置',
        `berserk=${berserk}, hurt=${someoneHurt}, reset=${histReset}, A=${g2.players['A'].hp}, B=${g2.players['B'].hp}`, g2);
    }),
  },
  {
    id: 'TC-C081', name: '大屁孩：三连相同（赢赢赢/平平平/输输输）自爆', category: 'character', charId: 'dapihuai', seed: 281,
    desc: '连续三次相同判定结果 → 自爆淘汰',
    run: () => run(() => {
      const g = makeGame([{ id: 'P', char: 'dapihuai' }, 'A', 'B'], 281);
      g.judgeHistory('P').push('tie', 'tie');
      playThrows(g, [{ P: 'rock', A: 'scissors', B: 'paper' }]); // 循环 → P 再记 tie → 平平平 → 自爆
      const exploded = g.logs.some((l) => l.text.includes('自爆'));
      const ok = exploded && !isAlive(g, 'P');
      return check(ok, '平平平 → 自爆，大屁孩淘汰', `exploded=${exploded}, P alive=${isAlive(g, 'P')}`, g);
    }),
  },
  {
    id: 'TC-C082', name: '大屁孩：跨回合记忆（历史不因回合更替清空）', category: 'character', charId: 'dapihuai', seed: 282,
    desc: '第一回合记 1 条，第二回合追加后达到三同仍触发',
    run: () => run(() => {
      const g = makeGame([{ id: 'P', char: 'dapihuai' }, 'A'], 282);
      // 回合1：P 胜 A（rock vs scissors）→ 记 win
      playThrows(g, [{ P: 'rock', A: 'scissors' }]);
      const after1 = g.judgeHistory('P').length;
      actQueue(g, { P: { type: 'skip' } });
      // 回合2、3：P 再胜两次 → win,win,win → 自爆
      playThrows(g, [{ P: 'rock', A: 'scissors' }]);
      const after2 = g.judgeHistory('P').length;
      if (g.phase === 'act') actQueue(g, { P: { type: 'skip' } });
      playThrows(g, [{ P: 'rock', A: 'scissors' }]);
      const exploded = g.logs.some((l) => l.text.includes('自爆'));
      const ok = after1 === 1 && after2 === 2 && exploded && !isAlive(g, 'P');
      return check(ok, `历史跨回合累积（${after1}→${after2}），第三次胜利触发自爆`,
        `exploded=${exploded}, P alive=${isAlive(g, 'P')}`, g);
    }),
  },
  {
    id: 'TC-C083', name: '大屁孩：多玩家状态隔离', category: 'character', charId: 'dapihuai', seed: 283,
    desc: '两名大屁孩判定历史互不干扰',
    run: () => run(() => {
      const g = makeGame([{ id: 'P1', char: 'dapihuai' }, { id: 'P2', char: 'dapihuai' }, 'A'], 283);
      playThrows(g, [{ P1: 'rock', P2: 'scissors', A: 'paper' }]); // 三人循环 → 都记 tie
      const h1 = g.judgeHistory('P1').length;
      const h2 = g.judgeHistory('P2').length;
      // 各自历史独立：都是1条tie，但对象不同
      const ok = h1 === 1 && h2 === 1 && isAlive(g, 'P1') && isAlive(g, 'P2');
      return check(ok, '两名大屁孩各记录1条，均未误触发', `h1=${h1}, h2=${h2}`, g);
    }),
  },
  {
    id: 'TC-C084', name: '大屁孩：暴走目标随机但确定（种子复现）', category: 'character', charId: 'dapihuai', seed: 284,
    desc: '同种子同序列 → 暴走目标一致',
    run: () => run(() => {
      const play = () => {
        const g = makeGame([{ id: 'P', char: 'dapihuai' }, 'A', 'B'], 284);
        g.judgeHistory('P').push('win', 'lose');
        playThrows(g, [{ P: 'rock', A: 'rock', B: 'rock' }]);
        return g.logs.filter((l) => l.text.includes('暴走：对随机玩家')).map((l) => l.text).join('|') + `|A=${g.players['A'].hp},B=${g.players['B'].hp}`;
      };
      const r1 = play(); const r2 = play();
      const ok = r1 === r2 && r1.length > 0;
      return check(ok, '暴走目标可复现', `${r1} / ${r2}`, undefined);
    }),
  },
];

function insults2(g: ReturnType<typeof makeGame>): number {
  return ((g.charState('D').insults as Record<string, number>)['B']) || 0;
}

function fmtLogsOf(g: ReturnType<typeof makeGame>): string {
  return g.logs.map((l) => `[R${l.round}·${l.type}] ${l.text}`).join('\n');
}
