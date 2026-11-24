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
      const ok = hpOf(g, 'B') === 2 && g.currentActor() === 'A'; // 行动未消耗
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
      const ok = hpOf(g, 'B') === 1 && g.charState('A').stickDrawn === true;
      return check(ok, 'B HP=1，拔棍状态保持', `hp=${hpOf(g, 'B')}, stickDrawn=${g.charState('A').stickDrawn}`, g);
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
      const ok = hpOf(g, 'B') === 1;
      return check(ok, 'B HP=1（无视躲避直伤）', `hp=${hpOf(g, 'B')}`, g);
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
      const ok = drawnAfter && hpOf(g, 'B') === 2;
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
      const ok = hpOf(g, 'B') === 3 && g.currentActor() === 'A'; // B 是吹箫哥（血量3）
      return check(ok, '近战拒绝，B 满血', `hp=${hpOf(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C011', name: '吹箫哥：远程无需瞄准，直接攻击异房间目标', category: 'character', charId: 'chuixiao', seed: 211,
    desc: '用户确认（2026-11-20）：吹箫哥不需要瞄准，直接选人远程攻击；仅不能近战',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'chuixiao' }, 'B'], 211);
      // A(R1)、B(R2) 异房间
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'attack', targetId: 'B' } });
      const ok = hpOf(g, 'B') === 1 && g.charDef('A').rangedNeedsAim !== true;
      return check(ok, '无需瞄准直接命中（B HP 2→1）', `hp=${hpOf(g, 'B')}, needAim=${g.charDef('A').rangedNeedsAim}`, g);
    }),
  },
  {
    id: 'TC-C011b', name: '吹箫哥：同房间目标无法近战', category: 'character', charId: 'chuixiao', seed: 213,
    desc: '仅能远程：同房间攻击被拒绝且不消耗行动',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'chuixiao' }, 'B'], 213);
      g.players['B'].room = 'R1';
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      const r = g.submitAction('A', { type: 'attack', targetId: 'B' });
      const ok = !r.ok && hpOf(g, 'B') === 2 && g.currentActor() === 'A';
      return check(ok, '同房间近战被拒绝，目标满血，行动未消耗', `ok=${r.ok}, err=${r.error}`, g);
    }),
  },
  {
    id: 'TC-C011c', name: '吹箫哥：同房间不能打「远程」', category: 'character', charId: 'chuixiao', seed: 214,
    desc: '显式 ranged:true 指向同房间目标 → 拒绝（远程只能打异房间），不消耗行动、不掉血（Issue #65）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'chuixiao' }, 'B'], 214);
      g.players['B'].room = 'R1'; // 同房间
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      const r = g.submitAction('A', { type: 'attack', targetId: 'B', ranged: true });
      const ok = !r.ok && (r.error || '').includes('异房间') && hpOf(g, 'B') === 2 && g.currentActor() === 'A';
      return check(ok, '同房间远程被拒绝，B 满血，行动未消耗', `ok=${r.ok}, err=${r.error}, hp=${hpOf(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C012', name: '吹箫哥：无需瞄准即可攻击任意异房间目标', category: 'character', charId: 'chuixiao', seed: 212,
    desc: '直接攻击异房间的 C 命中（无需先瞄准）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'chuixiao' }, 'B', 'C'], 212);
      winRound(g, { A: 'rock', B: 'scissors', C: 'rock' }, { A: { type: 'attack', targetId: 'C', ranged: true } });
      const ok = hpOf(g, 'C') === 1;
      return check(ok, '直接命中 C（HP 2→1），无需瞄准', `hpC=${hpOf(g, 'C')}`, g);
    }),
  },

  // ═══════════════ 20.3 五条悟 ═══════════════
  {
    id: 'TC-C020', name: '五条悟：近战1伤（领域内也是1伤）', category: 'character', charId: 'gojo', seed: 220,
    desc: '同房间近战 → 1伤害；展开领域后近战伤害仍为1（2026-11-24 用户确认：近战始终为1伤）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'gojo' }, 'B'], 220);
      g.players['B'].hp = 4; g.players['B'].maxHp = 4;
      g.players['B'].room = 'R1';
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'attack', targetId: 'B' } });
      const melee1 = hpOf(g, 'B') === 3 && isAlive(g, 'B');
      g.openDomain('A');
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'attack', targetId: 'B' } });
      const meleeInDomain = hpOf(g, 'B') === 2;
      return check(melee1 && meleeInDomain, 'B HP 4→3→2，领域内近战仍1伤',
        `s1=${melee1}, s2=${meleeInDomain}(hp=${hpOf(g, 'B')})`, g);
    }),
  },
  {
    id: 'TC-C021', name: '五条悟：远程2伤且需瞄准；领域展开后免瞄准', category: 'character', charId: 'gojo', seed: 221,
    desc: '未瞄准远程拒绝 → 瞄准后2伤 → 展开领域后远程免瞄准',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'gojo' }, 'B'], 221);
      g.players['B'].hp = 4; g.players['B'].maxHp = 4;
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'attack', targetId: 'B', ranged: true } });
      const step1 = hpOf(g, 'B') === 4; // 未瞄准拒绝
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'aim', targetId: 'B' } });
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'attack', targetId: 'B', ranged: true } });
      const step2 = hpOf(g, 'B') === 2; // 瞄准后2伤
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'domain' } });
      winRound(g, { A: 'rock', B: 'scissors' }, { A: { type: 'attack', targetId: 'B', ranged: true } });
      const step3 = hpOf(g, 'B') === 0 && g.charState('A').domain === true; // 领域免瞄准
      return check(step1 && step2 && step3, '未瞄准拒绝→瞄准2伤→领域免瞄准2伤淘汰',
        `s1=${step1}, s2=${step2}(hp=${hpOf(g,'B')}), s3=${step3}`, g);
    }),
  },
  {
    id: 'TC-C022', name: '五条悟：领域让其在平局回合行动（平局不变）', category: 'character', charId: 'gojo', seed: 222,
    desc: '五条悟领域生效，判定子轮全员同拳 → 平局不变，五条悟获得平局回合的行动资格',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'gojo' }, 'B'], 222);
      g.charState('A').domain = true;
      playThrows(g, [{ A: 'rock', B: 'rock' }]); // 平局 → 领域让五条悟在平局回合行动
      const rec = g.judgeRecords.find((r) => r.stage === 'rps1');
      const ok = g.phase === 'act' && g.qualified.length === 1 && g.qualified[0] === 'A'
        && rec?.outcome === 'tieAct' && g.judgeHistory('A').at(-1) === 'tie';
      return check(ok, '平局回合中五条悟获行动资格，判定仍记平',
        `phase=${g.phase}, q=${g.qualified.join(',')}, outcome=${rec?.outcome}`, g);
    }),
  },
  {
    id: 'TC-C022b', name: '五条悟：领域平局包含三人循环', category: 'character', charId: 'gojo', seed: 228,
    desc: '三拳齐全（三人循环）同样算平局 → 领域持有者获得平局行动资格；无领域时仍是平局回合（2026-11-24 用户确认）',
    run: () => run(() => {
      const withDomain = makeGame([{ id: 'A', char: 'gojo' }, 'B', 'C'], 228);
      withDomain.openDomain('A');
      playThrows(withDomain, [{ A: 'rock', B: 'paper', C: 'scissors' }]);
      const rec = withDomain.judgeRecords.find((r) => r.stage === 'rps1');
      const judgeOk = rec?.outcome === 'tieAct' && withDomain.qualified.length === 1 && withDomain.qualified[0] === 'A'
        && withDomain.judgeHistory('A').at(-1) === 'tie';

      const plain = makeGame([{ id: 'A', char: 'gojo' }, 'B', 'C'], 228);
      playThrows(plain, [{ A: 'rock', B: 'paper', C: 'scissors' }]);
      const plainCycle = plain.revealInfo()?.outcome === 'cycle'
        && plain.roundNo === 2 && plain.qualified.length === 0;

      return check(judgeOk && plainCycle, '有领域→三人循环获得平局行动；无领域→平局回合翻页',
        `outcome=${rec?.outcome}, q=${withDomain.qualified.join(',')}, plainCycle=${plainCycle}`, withDomain);
    }),
  },
  {
    id: 'TC-C020b', name: '五条悟：同房间不能打「远程」（避免 1 伤变 2 伤）', category: 'character', charId: 'gojo', seed: 219,
    desc: '领域生效时显式 ranged:true 指向同房间目标 → 拒绝；改走近战仍为 1 伤（Issue #65）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'gojo' }, 'B'], 219);
      g.players['B'].hp = 4; g.players['B'].maxHp = 4;
      g.players['B'].room = 'R1'; // 同房间
      g.openDomain('A'); // 领域内远程免瞄准，最容易被用来「同房间远程」
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      const rejected = g.submitAction('A', { type: 'attack', targetId: 'B', ranged: true });
      const noDamage = hpOf(g, 'B') === 4 && g.currentActor() === 'A';
      const melee = g.submitAction('A', { type: 'attack', targetId: 'B' });
      const ok = !rejected.ok && (rejected.error || '').includes('异房间') && noDamage
        && melee.ok && hpOf(g, 'B') === 3; // 近战 1 伤
      return check(ok, '同房间远程被拒绝；近战 1 伤（4→3）',
        `ok=${rejected.ok}, err=${rejected.error}, hp=${hpOf(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C026', name: '五条悟：2条命——首次致死满血复活，第二次致死淘汰', category: 'character', charId: 'gojo', seed: 226,
    desc: '用户确认（2026-11-20）：五条悟有2条命；首次 HP 归零消耗一条命并满血复活，第二次才真正淘汰',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'gojo' }, { id: 'K', char: 'default' }], 226);
      g.players['K'].room = 'R1';
      // 第一次致死：用引擎直接施加致死伤害（模拟）
      g.applyDamage({ target: 'A', amount: 99, source: 'K', dtype: 'physical', tag: 'test-lethal-1' });
      const firstAlive = isAlive(g, 'A');
      const firstHp = hpOf(g, 'A');
      const livesAfter = g.charState('A').livesLeft;
      const revLog = g.logs.some((l) => l.text.includes('消耗一条命'));
      // 第二次致死：真正淘汰
      g.applyDamage({ target: 'A', amount: 99, source: 'K', dtype: 'physical', tag: 'test-lethal-2' });
      const dead = !isAlive(g, 'A');
      const ok = firstAlive && firstHp === 3 && livesAfter === 1 && revLog && dead;
      return check(ok, '第一次：满血复活（HP3，剩余1命）；第二次：淘汰',
        `firstAlive=${firstAlive}, hp=${firstHp}, lives=${livesAfter}, dead=${dead}`, g);
    }),
  },
  {
    id: 'TC-C023', name: '领域覆盖：后展开者覆盖先展开者，平局算后展开者胜', category: 'character', charId: 'gojo', seed: 223,
    desc: '用户确认（2026-11-20）：领域为全场唯一场地状态，后展开覆盖先展开；平局回合由当前持有者行动（平局不变）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'gojo' }, { id: 'B', char: 'laodaye' }], 223);
      g.openDomain('A');
      const firstOk = g.domainHolder === 'A' && g.charState('A').domain === true;
      g.openDomain('B'); // 老大爷后展开 → 覆盖五条悟领域
      const covered = g.domainHolder === 'B' && g.charState('A').domain === false && g.charState('B').domain === true;
      const coverLog = g.logs.some((l) => l.text.includes('领域覆盖'));
      playThrows(g, [{ A: 'rock', B: 'rock' }]); // 同拳平局 → 当前持有者 B 在平局回合行动
      const ok = firstOk && covered && coverLog && g.phase === 'act'
        && g.qualified.length === 1 && g.qualified[0] === 'B';
      return check(ok, '五条悟领域被覆盖并失效，老大爷领域生效并获得平局行动资格',
        `firstOk=${firstOk}, covered=${covered}, log=${coverLog}, phase=${g.phase}, q=${g.qualified.join(',')}`, g);
    }),
  },
  {
    id: 'TC-C023b', name: '领域覆盖：自己重复展开被拒绝，不影响其他玩家', category: 'character', charId: 'gojo', seed: 227,
    desc: '同一持有者再次使用「领域展开」→ 被拒绝且不消耗行动；他人领域不受影响',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'gojo' }, 'B'], 227);
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'domain' } });
      const opened = g.domainHolder === 'A';
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      const r = g.submitAction('A', { type: 'domain' });
      const ok = opened && !r.ok && (r.error || '').includes('领域已展开') && g.domainHolder === 'A' && g.currentActor() === 'A';
      return check(ok, '重复展开被拒绝，领域持有者不变，行动未消耗',
        `opened=${opened}, ok=${r.ok}, error=${r.error}, holder=${g.domainHolder}`, g);
    }),
  },
  {
    id: 'TC-C023c', name: '领域：被覆盖后可再次展开夺回（反复展开）', category: 'character', charId: 'gojo', seed: 229,
    desc: '五条悟领域被老大爷覆盖后，可以再次展开反向覆盖夺回；夺回后平局仍判五条悟胜（2026-11-24 用户确认）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'gojo' }, { id: 'B', char: 'laodaye' }], 229);
      g.openDomain('A');
      g.openDomain('B');
      const covered = g.domainHolder === 'B' && g.charState('A').domain === false;
      g.openDomain('A');
      const back = g.domainHolder === 'A' && g.charState('A').domain === true && g.charState('B').domain === false;
      playThrows(g, [{ A: 'rock', B: 'rock' }]);
      const ok = covered && back && g.phase === 'act' && g.qualified.length === 1 && g.qualified[0] === 'A';
      return check(ok, '被覆盖→再次展开夺回→平局仍判五条悟胜',
        `covered=${covered}, back=${back}, q=${g.qualified.join(',')}`, g);
    }),
  },
  {
    id: 'TC-C025', name: '老大爷：远程攻击默认免瞄准（用户确认规则）', category: 'character', charId: 'laodaye', seed: 225,
    desc: '远程攻击（异房间）无需瞄准直接命中；仅显式 rangedNeedsAim 角色需要瞄准，当前为五条悟',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'laodaye' }, 'B'], 225);
      g.players['B'].hp = 3; g.players['B'].maxHp = 3;
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', targetId: 'B', ranged: true } });
      const ok = hpOf(g, 'B') === 1; // 3 - 2(远程) = 1，未被瞄准拦截
      return check(ok, '远程直接命中（无瞄准要求），B HP 3→1', `B=${hpOf(g, 'B')}`, g);
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
      const expectedDmg = expectedWins * 0.2 * 2;
      const actualDmg = 2 - hpOf(g, 'B');
      const ok = !!whipLog && Math.abs(actualDmg - expectedDmg) < 0.0001;
      return check(ok, `伤害=胜次×20%×2（胜次=${expectedWins}，期望伤害=${expectedDmg}）`,
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
    desc: '大伊万极高伤害为 noReflect，马保国直接死亡（规则原文例外）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'ivan-girl' }, { id: 'B', char: 'mabaoguo' }], 234);
      g.players['B'].room = 'R2'; // 和目标房间一致
      playThrows(g, [{ A: 'rock', B: 'scissors' }]); // 第1回合 A 胜，投掷
      actQueue(g, { A: { type: 'throwIvan', room: 'R2' } });
      const boomR1 = g.logs.some((l) => l.text.includes('大伊万在 R2 爆炸'));
      playThrows(g, [{ A: 'rock', B: 'scissors' }]); // 第2回合 A 再胜（引爆回合）
      actQueue(g, { A: { type: 'skip' } }); // 行动结束 → 回合末爆炸
      const ok = boomR1 === false && !isAlive(g, 'B')
        && !g.logs.some((l) => l.text.includes('太极判定成功'));
      return check(ok, '第2回合末爆炸毁灭 B，全程未触发太极反弹', `B alive=${isAlive(g, 'B')}, boomR1=${boomR1}`, g);
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
    id: 'TC-C040', name: '伍六七：攻击=前往房间蓄力，下一回合末砍出三刀', category: 'character', charId: 'wuliuqi', seed: 240,
    desc: '攻击时立刻移动到目标房间，本回合无伤害；下一回合末三刀各 1 伤（不打自己）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'wuliuqi' }, 'B'], 240);
      g.players['B'].room = 'R2';
      playThrows(g, [{ A: 'rock', B: 'scissors' }]); // A 赢
      actQueue(g, { A: { type: 'attack', room: 'R2' } });
      const moved = g.players['A'].room === 'R2';
      const noDamageYet = hpOf(g, 'B') === 2;
      // 下一回合：蓄力回合（即使 A 赢下判定也不能行动），回合末三刀落下
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      const seg1 = g.logs.some((l) => l.type === 'damage' && l.text.includes('B') && l.text.includes('第1/3段'));
      const seg2 = g.logs.some((l) => l.type === 'damage' && l.text.includes('B') && l.text.includes('第2/3段'));
      const ok = moved && noDamageYet && seg1 && seg2 && !isAlive(g, 'B') && hpOf(g, 'A') === 3;
      return check(ok, '立即移动；本回合不掉血；下一回合末三刀击杀 B（A 自身不受伤）',
        `moved=${moved}, before=${noDamageYet}, B alive=${isAlive(g, 'B')}, A hp=${hpOf(g, 'A')}`, g);
    }),
  },
  {
    id: 'TC-C041', name: '伍六七：刀落瞬间动态判定房间成员（走开的不挨、进来的挨）', category: 'character', charId: 'wuliuqi', seed: 241,
    desc: '蓄力时 B 在房间但刀落前离开 → 不受击；C 刀落前进入 → 被三刀击杀',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'wuliuqi' }, 'B', 'C'], 241);
      g.players['B'].room = 'R2';
      playThrows(g, [{ A: 'rock', B: 'scissors', C: 'scissors' }]); // A 赢
      actQueue(g, { A: { type: 'attack', room: 'R2' } });
      g.players['B'].room = 'R3'; // 刀落前离开
      g.players['C'].room = 'R2'; // 刀落前进入
      playThrows(g, [{ A: 'rock', B: 'scissors', C: 'scissors' }]); // 蓄力回合
      const ok = hpOf(g, 'B') === 2 && !isAlive(g, 'C');
      return check(ok, 'B 已离开不受击；C 进入后吃满三刀',
        `B hp=${hpOf(g, 'B')}, C alive=${isAlive(g, 'C')}`, g);
    }),
  },
  {
    id: 'TC-C042', name: '伍六七：蓄力回合赢下判定也不能行动', category: 'character', charId: 'wuliuqi', seed: 242,
    desc: '有刀待落的回合，伍六七被移出行动队列，日志提示蓄力中',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'wuliuqi' }, 'B'], 242);
      g.players['B'].room = 'R2';
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', room: 'R2' } });
      playThrows(g, [{ A: 'rock', B: 'scissors' }]); // A 本应获得行动资格
      const actingAgain = g.logs.some((l) => l.type === 'action' && l.round === 2 && l.text.includes('A'));
      const chargeHint = g.logs.some((l) => l.text.includes('蓄力中不能进行其他行动'));
      const ok = !actingAgain && chargeHint && !isAlive(g, 'B');
      return check(ok, 'A 第二回合未行动，三刀照常落下',
        `actingAgain=${actingAgain}, chargeHint=${chargeHint}, B alive=${isAlive(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C043', name: '伍六七：三刀命中躲藏/隐身目标', category: 'character', charId: 'wuliuqi', seed: 243,
    desc: '躲藏+隐身的 B 在目标房间内仍被三刀击杀（AOE 不受躲藏限制）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'wuliuqi' }, 'B'], 243);
      g.players['B'].room = 'R2';
      g.players['B'].hidden = true;
      g.players['B'].invisible = true;
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', room: 'R2' } });
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      const ok = !isAlive(g, 'B');
      return check(ok, '躲藏+隐身的 B 被三刀淘汰', `B alive=${isAlive(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C044', name: '伍六七：三刀不打自己', category: 'character', charId: 'wuliuqi', seed: 244,
    desc: 'A 与目标同处一室：三刀只打 B，A 血量不变',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'wuliuqi' }, 'B'], 244);
      g.players['B'].room = 'R2';
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', room: 'R2' } });
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      const ok = hpOf(g, 'A') === 3 && !isAlive(g, 'B');
      return check(ok, 'A 血量不变，B 被三刀击杀', `A hp=${hpOf(g, 'A')}, B alive=${isAlive(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C045', name: '伍六七：五条悟复活后不吃同一批剩余刀', category: 'character', charId: 'wuliuqi', seed: 245,
    desc: 'G 以 2 血被第一/二刀打死 → 消耗一条命满血复活；第三刀跳过复活后的 G',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'wuliuqi' }, { id: 'G', char: 'gojo' }], 245);
      g.players['G'].room = 'R2';
      g.players['G'].hp = 2; // 2 血 2 条命
      playThrows(g, [{ A: 'rock', G: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', room: 'R2' } });
      playThrows(g, [{ A: 'rock', G: 'scissors' }]);
      const ok = isAlive(g, 'G') && hpOf(g, 'G') === 3 && g.charState('G').livesLeft === 1;
      return check(ok, 'G 复活后为 3 血、剩余 1 条命（第三刀未再扣血）',
        `alive=${isAlive(g, 'G')}, hp=${hpOf(g, 'G')}, lives=${g.charState('G').livesLeft}`, g);
    }),
  },
  {
    id: 'TC-C046', name: '伍六七：平局回合也落刀', category: 'character', charId: 'wuliuqi', seed: 246,
    desc: '刀落回合全员同拳平局（无人行动），三刀仍然结算',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'wuliuqi' }, 'B'], 246);
      g.players['B'].room = 'R2';
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', room: 'R2' } });
      playThrows(g, [{ A: 'rock', B: 'rock' }]); // 平局
      const ok = !isAlive(g, 'B');
      return check(ok, '平局回合三刀照常落下，B 被淘汰', `phase=${g.phase}, B alive=${isAlive(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C047', name: '伍六七：三刀先于大伊万爆炸结算', category: 'character', charId: 'wuliuqi', seed: 247,
    desc: '同一回合末同时有伍六七三刀与大伊万：三刀日志先出现（作者确认的结算顺序）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'wuliuqi' }, { id: 'V', char: 'ivan-girl' }, 'B'], 247);
      g.players['B'].room = 'R2';
      playThrows(g, [{ A: 'rock', B: 'scissors', V: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', room: 'R2' } });
      // 手动排入一个同一回合末引爆的大伊万事件，验证排序
      g.addDeferred({ kind: 'ivan', room: 'R2', source: 'V', explodeRound: g.roundNo, createdAtRound: g.roundNo });
      playThrows(g, [{ A: 'rock', B: 'scissors', V: 'scissors' }]);
      const slashIdx = g.logs.findIndex((l) => l.text.includes('三刀落于'));
      const ivanIdx = g.logs.findIndex((l) => l.text.includes('💥 大伊万在'));
      const ok = slashIdx >= 0 && (ivanIdx < 0 || slashIdx < ivanIdx);
      return check(ok, `三刀先于大伊万（slash=${slashIdx}, ivan=${ivanIdx}）`, `slash=${slashIdx}, ivan=${ivanIdx}`, g);
    }),
  },

  // ═══════════════ 20.6 卖大伊万的小女孩 ═══════════════
  {
    id: 'TC-C050', name: '大伊万：投掷与爆炸分离，投掷后第一个分出胜负回合末爆炸', category: 'character', charId: 'ivan-girl', seed: 250,
    desc: '投掷回合引信未开（投掷后行动队列继续、回合末不爆）；下一回合分出胜负，其回合末爆炸',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'ivan-girl' }, 'B', 'C'], 250);
      g.players['B'].room = 'R2';
      playThrows(g, [{ A: 'rock', B: 'scissors', C: 'scissors' }]); // 第1回合 A 胜
      actQueue(g, { A: { type: 'throwIvan', room: 'R2' } });
      const boomR1 = g.logs.some((l) => l.text.includes('大伊万在 R2 爆炸'));
      playThrows(g, [{ A: 'rock', B: 'scissors', C: 'scissors' }]); // 第2回合 A 再胜（引爆回合）
      actQueue(g, { A: { type: 'skip' } }); // 行动结束 → 回合末爆炸
      const threw = g.logs.some((l) => l.text.includes('投掷大伊万'));
      const ok = threw && boomR1 === false && !isAlive(g, 'B') && isAlive(g, 'A') && isAlive(g, 'C');
      return check(ok, '投掷回合不炸，第2回合末爆炸毁灭 R2 的 B（A、C 不受影响）',
        `boomR1=${boomR1}, B alive=${isAlive(g, 'B')}, A=${isAlive(g, 'A')}, C=${isAlive(g, 'C')}`, g);
    }),
  },
  {
    id: 'TC-C051', name: '大伊万：爆炸时动态判定成员（引爆回合内移动可逃离/进入）', category: 'character', charId: 'ivan-girl', seed: 251,
    desc: '引燃回合内目标房间玩家移动离开 → 不受影响；移动进入 → 受影响（不使用投掷时快照）',
    run: () => run(() => {
      const g2 = makeGame([{ id: 'A', char: 'ivan-girl' }, 'B', 'C', 'D'], 251);
      g2.players['B'].room = 'R2';
      g2.players['C'].room = 'R3';
      g2.players['D'].room = 'R4';
      playThrows(g2, [{ A: 'rock', B: 'scissors', C: 'scissors', D: 'scissors' }]); // 第1回合 A 胜
      actQueue(g2, { A: { type: 'throwIvan', room: 'R2' } });
      playThrows(g2, [{ A: 'rock', B: 'rock', C: 'rock', D: 'scissors' }]); // 第2回合 A、B、C 胜（引爆回合）
      actQueue(g2, {
        B: { type: 'move', room: 'R3' }, // B 逃离 R2
        C: { type: 'move', room: 'R2' }, // C 进入 R2（投掷时不在）
        A: { type: 'skip' },
      }); // 行动结束 → 回合末按爆炸时成员结算
      const boomR1 = g2.logs.some((l) => l.text.includes('大伊万在 R2 爆炸') && l.round === 1);
      const bAlive = isAlive(g2, 'B');
      const cDead = !isAlive(g2, 'C');
      const ok = boomR1 === false && bAlive && cDead;
      return check(ok, '第1回合不爆；引燃回合末 B（已离开）存活，C（爆炸时在 R2）被毁灭',
        `boomR1=${boomR1}, B alive=${bAlive}, C alive=${isAlive(g2, 'C')}`, g2);
    }),
  },
  {
    id: 'TC-C052', name: '大伊万：含自己所在房间，投掷者不离开则被毁灭', category: 'character', charId: 'ivan-girl', seed: 252,
    desc: '投掷到自己房间且不移动 → 引燃回合末自己也被秒杀；异房间他人不受影响（同归于尽场景见 TC-C058）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'ivan-girl' }, 'B'], 252); // B 在 R2，不受 R1 爆炸影响
      playThrows(g, [{ A: 'rock', B: 'scissors' }]); // 第1回合 A 胜
      actQueue(g, { A: { type: 'throwIvan', room: 'R1' } });
      const boomR1 = g.logs.some((l) => l.text.includes('大伊万在 R1 爆炸'));
      playThrows(g, [{ A: 'rock', B: 'scissors' }]); // 第2回合 A 再胜（引爆回合）
      actQueue(g, { A: { type: 'skip' } }); // 行动结束 → 回合末爆炸
      const ok = boomR1 === false && !isAlive(g, 'A') && isAlive(g, 'B') && g.winner === 'B';
      return check(ok, '第2回合末 A 被自己投掷的大伊万毁灭，B（R2）存活并获胜',
        `A alive=${isAlive(g, 'A')}, B alive=${isAlive(g, 'B')}, winner=${g.winner}`, g);
    }),
  },
  {
    id: 'TC-C053', name: '大伊万：爆炸秒杀与死亡（多目标）', category: 'character', charId: 'ivan-girl', seed: 253,
    desc: '爆炸房间内多名玩家全部毁灭',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'ivan-girl' }, 'B', 'C'], 253);
      g.players['B'].room = 'R2'; g.players['C'].room = 'R2';
      playThrows(g, [{ A: 'rock', B: 'scissors', C: 'paper' }]); // 第1回合三人循环 → 平局回合翻页
      playThrows(g, [{ A: 'rock', B: 'scissors', C: 'scissors' }]); // 第2回合 A 胜，投掷
      actQueue(g, { A: { type: 'throwIvan', room: 'R2' } });
      playThrows(g, [{ A: 'rock', B: 'scissors', C: 'scissors' }]); // 第3回合 A 再胜（引爆回合）
      actQueue(g, { A: { type: 'skip' } }); // 行动结束 → 回合末爆炸
      const ok = !isAlive(g, 'B') && !isAlive(g, 'C') && isAlive(g, 'A') && g.winner === 'A';
      return check(ok, 'B、C 被毁灭，A 获胜', `B=${isAlive(g,'B')}, C=${isAlive(g,'C')}, winner=${g.winner}`, g);
    }),
  },
  {
    id: 'TC-C056', name: '大伊万：平局回合顺延引爆（不消耗炸弹）', category: 'character', charId: 'ivan-girl', seed: 285,
    desc: '投掷后下一回合若为平局 → 不爆且炸弹保留；再下一个分出胜负回合末才爆',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'ivan-girl' }, { id: 'B', char: 'default', room: 'R2' }], 285);
      playThrows(g, [{ A: 'rock', B: 'scissors' }]); // 第1回合 A 胜
      actQueue(g, { A: { type: 'throwIvan', room: 'R2' } });
      playThrows(g, [{ A: 'rock', B: 'rock' }]); // 第2回合平局 → 顺延
      const boomR2 = g.logs.some((l) => l.text.includes('大伊万在 R2 爆炸'));
      const kept = g.deferred.length === 1;
      playThrows(g, [{ A: 'rock', B: 'scissors' }]); // 第3回合 A 胜（引爆回合）
      actQueue(g, { A: { type: 'skip' } }); // 行动结束 → 回合末引爆
      const ok = boomR2 === false && kept && !isAlive(g, 'B') && g.winner === 'A';
      return check(ok, '平局回合不爆且炸弹保留，第3回合末引爆毁灭 B', `boomR2=${boomR2}, kept=${kept}, B alive=${isAlive(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C057', name: '大伊万：爆炸命中躲藏目标（AOE 不受躲藏限制）', category: 'character', charId: 'ivan-girl', seed: 286,
    desc: '爆炸时目标房间内躲藏的玩家仍被毁灭（卡片原文「毁灭此房所有生物」；「若赢可离开躲避」指移动逃生）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'ivan-girl' }, { id: 'B', char: 'default', room: 'R2', hidden: true }], 286);
      playThrows(g, [{ A: 'rock', B: 'scissors' }]); // 第1回合 A 胜
      actQueue(g, { A: { type: 'throwIvan', room: 'R2' } });
      playThrows(g, [{ A: 'rock', B: 'scissors' }]); // 第2回合 A 再胜（引爆回合）
      actQueue(g, { A: { type: 'skip' } }); // 行动结束 → 回合末爆炸
      const missed = g.logs.some((l) => l.text.includes('未命中'));
      const ok = !isAlive(g, 'B') && isAlive(g, 'A') && g.winner === 'A' && !missed;
      return check(ok, '躲藏在 R2 的 B 被爆炸毁灭', `B alive=${isAlive(g, 'B')}, winner=${g.winner}, missedLog=${missed}`, g);
    }),
  },
  {
    id: 'TC-C058', name: '大伊万：炸弹先结算后判胜（可同归于尽）', category: 'character', charId: 'ivan-girl', seed: 287,
    desc: '激活回合内行动打死最后一人 → 行动阶段不提前终局 → 回合末炸弹照样引爆 → 全灭平局',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'ivan-girl', hp: 1 }, { id: 'B', char: 'default', room: 'R1' }], 287); // 两人同在 R1
      playThrows(g, [{ A: 'rock', B: 'scissors' }]); // 第1回合 A 胜
      actQueue(g, { A: { type: 'throwIvan', room: 'R1' } }); // 扔进自己房间
      playThrows(g, [{ A: 'scissors', B: 'rock' }]); // 第2回合 B 胜（引爆回合）
      actQueue(g, { B: { type: 'attack', targetId: 'A' } }); // B 打死 A（hp1），行动阶段不提前终局
      const boomR2 = g.logs.some((l) => l.text.includes('大伊万在 R1 爆炸'));
      const ok = boomR2 && !isAlive(g, 'A') && !isAlive(g, 'B') && g.winner === null && g.phase === 'over';
      return check(ok, 'B 击杀 A 后炸弹仍引爆并带走 B → 同归于尽平局',
        `A alive=${isAlive(g, 'A')}, B alive=${isAlive(g, 'B')}, winner=${g.winner}`, g);
    }),
  },
  {
    id: 'TC-C059', name: '大伊万：投掷者死亡后炸弹照常引爆', category: 'character', charId: 'ivan-girl', seed: 288,
    desc: '投掷后在引燃回合被击杀 → 炸弹仍于该回合末爆炸，毁灭爆炸时房间内成员',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'ivan-girl', hp: 1 }, { id: 'B', char: 'default', room: 'R1' }, { id: 'C', char: 'default', room: 'R2' }], 288);
      playThrows(g, [{ A: 'rock', B: 'scissors', C: 'scissors' }]); // 第1回合 A 胜
      actQueue(g, { A: { type: 'throwIvan', room: 'R2' } }); // C 在 R2
      playThrows(g, [{ A: 'scissors', B: 'rock', C: 'rock' }]); // 第2回合 B、C 胜（引爆回合）
      actQueue(g, { B: { type: 'attack', targetId: 'A' }, C: { type: 'skip' } }); // B 杀死 A（行动阶段不提前终局）
      const boomR2 = g.logs.some((l) => l.text.includes('大伊万在 R2 爆炸'));
      const ok = boomR2 && !isAlive(g, 'A') && !isAlive(g, 'C') && isAlive(g, 'B') && g.winner === 'B';
      return check(ok, 'A 先死，第2回合末炸弹仍毁灭 R2 的 C，B 获胜',
        `A alive=${isAlive(g, 'A')}, C alive=${isAlive(g, 'C')}, B alive=${isAlive(g, 'B')}, winner=${g.winner}`, g);
    }),
  },
  {
    id: 'TC-C066', name: '大伊万：同发爆炸连杀两人 → 平局（结算期间不定胜负）', category: 'character', charId: 'ivan-girl', seed: 289,
    desc: '爆炸时两人都活着 → 依次淘汰 → 全场 0 存活判平局（不会错误产生幸存者）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'ivan-girl' }, { id: 'B', char: 'default', room: 'R1' }], 289); // 两人同在 R1，血量均 2
      playThrows(g, [{ A: 'rock', B: 'scissors' }]); // 第1回合 A 胜
      actQueue(g, { A: { type: 'throwIvan', room: 'R1' } }); // 扔进自己房间
      playThrows(g, [{ A: 'scissors', B: 'rock' }]); // 第2回合 B 胜（引燃回合）
      actQueue(g, { B: { type: 'attack', targetId: 'A' } }); // B 打 A 一刀：2→1 未死；行动阶段不提前终局
      const boomR2 = g.logs.some((l) => l.text.includes('大伊万在 R1 爆炸'));
      const ok = boomR2 && !isAlive(g, 'A') && !isAlive(g, 'B') && g.winner === null && g.phase === 'over';
      return check(ok, '爆炸连杀两人 → 同归于尽平局（无幸存者）',
        `A alive=${isAlive(g, 'A')}, B alive=${isAlive(g, 'B')}, winner=${g.winner}`, g);
    }),
  },

  // ═══════════════ 20.7 今日勇者（随机数代表） ═══════════════
  {
    id: 'TC-C060', name: '今日勇者：基础面板（3血1攻）与运势技能入口', category: 'character', charId: 'hero-today', seed: 260,
    desc: '初始血量3攻击1；拥有「抽取今日运势」技能（用户确认规则）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'hero-today' }, 'B'], 260);
      g.players['B'].hp = 3; g.players['B'].maxHp = 3;
      const okInit = g.players['A'].hp === 3 && g.players['A'].maxHp === 3 && g.charDef('A').attack === 1;
      const hasAction = g.charDef('A').actions?.some((a) => a.name === 'rollFortune') === true;
      g.players['B'].room = 'R1';
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', targetId: 'B' } });
      const okAtk = hpOf(g, 'B') === 2; // 基础攻击1
      return check(okInit && okAtk && hasAction, '初始3血1攻确认，普攻1伤，运势技能已注册',
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
      const feedback = g.logs.some((l) => l.text.includes('抽中 9 点') && l.text.includes('中头奖了'));
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', targetId: 'B' } });
      const okAtk = hpOf(g, 'B') === 0; // 6-6=0
      return check(rolled && okAtk && feedback, '掷出9 → 血6攻6（满血），反馈「中头奖」，普攻6伤淘汰B',
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
      const causeLogged = g.logs.some((l) => l.text.includes('抽中 0 点') && l.text.includes('运势极凶'));
      return check(dead && over && causeLogged, '掷出0 → A 暴毙，B 获胜',
        `A alive=${isAlive(g, 'A')}, winner=${g.winner}, log=${causeLogged}`, g);
    }),
  },
  {
    id: 'TC-C065', name: '今日勇者：取消第一回合限制，第二回合仍可抽取', category: 'character', charId: 'hero-today', seed: 1,
    desc: '用户确认（2026-11-20）：不再限定第一回合，改为全局仅可使用一次、不限具体回合',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'hero-today' }, 'B'], 1);
      g.players['B'].room = 'R1';
      g.players['B'].hp = 4; g.players['B'].maxHp = 4;
      // 第一回合先不用技能
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'skip' } });
      // 第二回合抽取运势 → 应被接受（种子1 → 掷6：血4攻2）
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      const r = g.submitAction('A', { type: 'rollFortune' });
      const used = g.charState('A').fortuneUsed === true;
      const panel = g.players['A'].maxHp === 4 && g.charState('A').attackOverride === 2;
      const ok = r.ok && used && panel && isAlive(g, 'A');
      return check(ok, '第二回合抽取成功（血4攻2），已标记使用',
        `ok=${r.ok}, error=${r.error}, used=${used}, hp=${g.players['A'].hp}, atk=${g.charState('A').attackOverride}`, g);
    }),
  },
  {
    id: 'TC-C065b', name: '今日勇者：全局仅一次，抽取后再次使用被拒绝', category: 'character', charId: 'hero-today', seed: 4,
    desc: '已抽取过运势后再提交 → 拒绝且不消耗行动（跨回合依然不可用）',
    run: () => run(() => {
      const g = makeGame([{ id: 'A', char: 'hero-today' }, 'B'], 4);
      g.players['B'].room = 'R1';
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'rollFortune' } }); // 种子4 → 掷9：血6攻6
      const usedOnce = g.charState('A').fortuneUsed === true && isAlive(g, 'A');
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      const r = g.submitAction('A', { type: 'rollFortune' });
      const ok = usedOnce && !r.ok && (r.error || '').includes('仅限使用一次') && g.currentActor() === 'A';
      return check(ok, '第二次抽取被拒绝，行动未消耗',
        `used=${usedOnce}, ok=${r.ok}, error=${r.error}, actor=${g.currentActor()}`, g);
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
      const feedback = g.logs.some((l) => l.text.includes('抽中 6 点') && l.text.includes('小有斩获'));
      playThrows(g, [{ A: 'rock', B: 'scissors' }]);
      actQueue(g, { A: { type: 'attack', targetId: 'B' } });
      const okAtk = hpOf(g, 'B') === 2; // 4-2=2
      return check(rolled && okAtk && feedback, '掷出6 → 血4攻2（满血），反馈「小有斩获」，普攻2伤',
        `面板=${rolled}(A hp=${g.players['A'].hp}), B=${hpOf(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C067', name: '今日勇者：变身即满血（当前血量=新上限）与运势反馈', category: 'character', charId: 'hero-today', seed: 12,
    desc: '掷2/3 → 血1攻1（当前=上限），反馈「时运不济」；掷8 → 血6攻4，反馈「鸿运当头」',
    run: () => run(() => {
      const play = (seed: number) => {
        const g = makeGame([{ id: 'A', char: 'hero-today' }, 'B'], seed);
        playThrows(g, [{ A: 'rock', B: 'scissors' }]);
        actQueue(g, { A: { type: 'rollFortune' } });
        return g;
      };
      const low = play(12); // 掷2 → 血1攻1
      const lowFull = low.players['A'].hp === low.players['A'].maxHp && low.players['A'].maxHp === 1;
      const lowMsg = low.logs.some((l) => l.text.includes('抽中 2 点') && l.text.includes('时运不济'));
      const high = play(30); // 掷8 → 血6攻4
      const highFull = high.players['A'].hp === high.players['A'].maxHp && high.players['A'].maxHp === 6;
      const highMsg = high.logs.some((l) => l.text.includes('抽中 8 点') && l.text.includes('鸿运当头'));
      const ok = lowFull && lowMsg && highFull && highMsg;
      return check(ok, '变身后面板满血（当前血量=上限），并给出对应运势反馈',
        `low=${low.players['A'].hp}/${low.players['A'].maxHp}, high=${high.players['A'].hp}/${high.players['A'].maxHp}`, low);
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
      const ok = transferred && hpOf(g, 'D') === 2 && hpOf(g, 'B') === 2;
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
      actQueue(g, { W: { type: 'attack', room: 'R2' } });
      playThrows(g, [{ W: 'rock', D: 'scissors', B: 'scissors' }]); // 刀落回合
      // 三刀属于「回合末瞬时爆发」：D 直接承受自身份额，B 的每一段都被 D 吸收（含 D 阵亡后的遗体吸收）
      const ok = !isAlive(g, 'D') && hpOf(g, 'B') === 2 && hpOf(g, 'W') === 3;
      return check(ok, '三刀全部由 D 承担（遗体也吸收），B 不受损；W 不受伤',
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
      const ok = hpOf(g, 'B') === 1 && hpOf(g, 'D') === 3;
      return check(ok, '精神伤害正常落在 B（HP 2→1），大贱客未承受', `B=${hpOf(g, 'B')}, D=${hpOf(g, 'D')}`, g);
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
      const ok = hpOf(g, 'D') === 1 && hpOf(g, 'B') === 2;
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
    id: 'TC-C075', name: '大贱客：辱骂无视躲藏', category: 'character', charId: 'dajianke', seed: 275,
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
  {
    id: 'TC-C085', name: '大贱客：辱骂无视距离（跨房间命中计数）', category: 'character', charId: 'dajianke', seed: 290,
    desc: '辱骂可指定任意房间的目标（作者定案 2026-11-21：无视距离）——跨房间辱骂计数成功',
    run: () => run(() => {
      const g = makeGame([{ id: 'D', char: 'dajianke' }, { id: 'B', char: 'default', room: 'R2' }], 290);
      playThrows(g, [{ D: 'rock', B: 'scissors' }]); // D 胜
      const r = g.submitAction('D', { type: 'attack', targetId: 'B' }); // B 在 R2：跨房间辱骂
      const n = ((g.charState('D').insults as Record<string, number>)['B']) || 0;
      const ok = r.ok && n === 1 && isAlive(g, 'B');
      return check(ok, '跨房间辱骂成功（计数1，B 存活）', `ok=${r.ok}, insults=${n}`, g);
    }),
  },
  {
    id: 'TC-C086', name: '大贱客：转移伤害视为直击，无视自身躲藏', category: 'character', charId: 'dajianke', seed: 291,
    desc: '大贱客躲藏时，被吸引的伤害仍命中他（作者确认 2026-11-21：转移后无视其自身躲藏/隐身）',
    run: () => run(() => {
      const g = makeGame([
        { id: 'D', char: 'dajianke', hidden: true, room: 'R1' },
        { id: 'A', char: 'default', room: 'R1' },
        { id: 'B', char: 'default', room: 'R1' },
      ], 291); // 三人同在 R1，大贱客躲藏
      playThrows(g, [{ A: 'rock', B: 'scissors', D: 'scissors' }]); // A 胜
      actQueue(g, { A: { type: 'attack', targetId: 'B' } }); // A 打 B → 转移 → 命中躲藏中的 D
      const ok = hpOf(g, 'D') === 2 && hpOf(g, 'B') === 2 && isAlive(g, 'D');
      return check(ok, '躲藏的大贱客仍被转移伤害命中（3→2），B 无损', `D hp=${hpOf(g, 'D')}, B hp=${hpOf(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C087', name: '大贱客：回合末瞬时爆发全部吸收（阵亡后同批伤害仍转移）', category: 'character', charId: 'dajianke', seed: 292,
    desc: '大伊万炸两人：大贱客吸第一发致死，同批第二发仍由其（阵亡）吸收——被波及目标不受损（作者确认 2026-11-21）',
    run: () => run(() => {
      const g = makeGame([
        { id: 'D', char: 'dajianke', room: 'R1' },
        { id: 'A', char: 'ivan-girl', room: 'R2' },
        { id: 'X', char: 'default', room: 'R2' },
        { id: 'Y', char: 'default', room: 'R2' },
      ], 292);
      playThrows(g, [{ A: 'rock', D: 'scissors', X: 'scissors', Y: 'scissors' }]); // 第1回合 A 胜
      actQueue(g, { A: { type: 'throwIvan', room: 'R2' } }); // 炸 R2（X、Y 在房内，D 在 R1）
      playThrows(g, [{ A: 'rock', D: 'scissors', X: 'scissors', Y: 'scissors' }]); // 第2回合 A 再胜（引爆回合）
      actQueue(g, { A: { type: 'skip' } }); // 第2回合末爆炸
      const absorbed = g.logs.some((l) => l.text.includes('大贱客（已阵亡）仍吸收'));
      const ok = !isAlive(g, 'D') && isAlive(g, 'X') && isAlive(g, 'Y')
        && hpOf(g, 'X') === 2 && hpOf(g, 'Y') === 2 && absorbed;
      return check(ok, 'D 阵亡吸收全部爆发：X、Y 满血无损', `D alive=${isAlive(g, 'D')}, X=${hpOf(g, 'X')}, Y=${hpOf(g, 'Y')}, absorbed=${absorbed}`, g);
    }),
  },

  // ═══════════════ 20.9 大屁孩 ═══════════════
  {
    id: 'TC-C080', name: '大屁孩：三不同 → 暴走（回合最前，由本人指定目标）', category: 'character', charId: 'dapihuai', seed: 280,
    desc: '判定历史三不同后进入「回合前触发」阶段，由大屁孩指定任意其他玩家，精神攻击秒杀（血量20、攻击0）',
    run: () => run(() => {
      const g = makeGame([{ id: 'P', char: 'dapihuai' }, 'A', 'B'], 280);
      g.judgeHistory('P').push('win', 'lose');
      playThrows(g, [{ P: 'rock', A: 'rock', B: 'rock' }]); // 平 → [win,lose,tie] 三不同
      const trig = g.triggerView();
      const inTrigger = g.phase === 'trigger' && trig?.kind === 'berserk' && trig.actor === 'P';
      const r = g.submitBerserk('P', 'A'); // 本人指定 A
      const pickedDead = !isAlive(g, 'A') && isAlive(g, 'B');
      const histReset = g.judgeHistory('P').length === 0;
      const statsOk = g.charDef('P').hp === 20 && g.charDef('P').attack === 0;
      const ok = inTrigger && r.ok && pickedDead && histReset && statsOk;
      return check(ok, '触发阶段指定 A → 只有 A 被秒杀；血量20/攻击0；历史重置',
        `trigger=${inTrigger}, ok=${r.ok}, A=${isAlive(g, 'A')}, B=${isAlive(g, 'B')}, hp=${g.players.P.maxHp}`, g);
    }),
  },
  {
    id: 'TC-C081', name: '大屁孩：三连相同（赢赢赢/平平平/输输输）自爆', category: 'character', charId: 'dapihuai', seed: 281,
    desc: '连续三次相同判定结果 → 自爆（回合最前结算，自身淘汰）',
    run: () => run(() => {
      const g = makeGame([{ id: 'P', char: 'dapihuai' }, 'A', 'B'], 281);
      g.judgeHistory('P').push('tie', 'tie');
      playThrows(g, [{ P: 'rock', A: 'scissors', B: 'paper' }]); // 循环 → P 再记 tie → 平平平
      const exploded = g.logs.some((l) => l.text.includes('自爆'));
      const ok = exploded && !isAlive(g, 'P');
      return check(ok, '平平平 → 自爆，大屁孩淘汰', `exploded=${exploded}, P alive=${isAlive(g, 'P')}`, g);
    }),
  },
  {
    id: 'TC-C082', name: '大屁孩：跨回合记忆（历史不因回合更替清空）', category: 'character', charId: 'dapihuai', seed: 282,
    desc: '第一回合记 1 条，第三回合达到三同触发自爆',
    run: () => run(() => {
      const g = makeGame([{ id: 'P', char: 'dapihuai' }, 'A'], 282);
      playThrows(g, [{ P: 'rock', A: 'scissors' }]);
      const after1 = g.judgeHistory('P').length;
      actQueue(g, { P: { type: 'skip' } });
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
      const ok = h1 === 1 && h2 === 1 && isAlive(g, 'P1') && isAlive(g, 'P2');
      return check(ok, '两名大屁孩各记录1条，均未误触发', `h1=${h1}, h2=${h2}`, g);
    }),
  },
  {
    id: 'TC-C084', name: '大屁孩：暴走目标由本人指定（不随机）', category: 'character', charId: 'dapihuai', seed: 284,
    desc: '同一局面分别指定 A / B，被指定者必死、另一人不受影响',
    run: () => run(() => {
      const play = (target: string) => {
        const g = makeGame([{ id: 'P', char: 'dapihuai' }, 'A', 'B'], 284);
        g.judgeHistory('P').push('win', 'lose');
        playThrows(g, [{ P: 'rock', A: 'rock', B: 'rock' }]);
        g.submitBerserk('P', target);
        return `${target}:${g.players.A.alive ? 'A活' : 'A死'},${g.players.B.alive ? 'B活' : 'B死'}`;
      };
      const r1 = play('A'); const r2 = play('B');
      const ok = r1 === 'A:A死,B活' && r2 === 'B:A活,B死';
      return check(ok, '指定谁就杀谁（不随机）', `${r1} / ${r2}`, undefined);
    }),
  },
  {
    id: 'TC-C088', name: '大屁孩：阵亡后不再触发暴走（尸体不参与结算）', category: 'character', charId: 'dapihuai', seed: 285,
    desc: '两名大屁孩同时持有暴走权时先做二次判定；先手秒杀后手，后手不得再以尸体身份暴走',
    run: () => run(() => {
      const g = makeGame([{ id: 'P1', char: 'dapihuai' }, { id: 'P2', char: 'dapihuai' }], 285);
      g.judgeHistory('P1').push('win', 'lose');
      g.judgeHistory('P2').push('win', 'lose');
      playThrows(g, [{ P1: 'rock', P2: 'rock' }]); // 两人都记 tie → 各自三不同
      const view = g.triggerView();
      const actor = view?.actor ?? '';
      const other = actor === 'P1' ? 'P2' : 'P1';
      const ordered = view?.kind === 'berserk' && (actor === 'P1' || actor === 'P2');
      if (actor) g.submitBerserk(actor, other);
      const otherDead = !g.players[other].alive;
      const corpseBerserk = g.logs.some((l) => l.text.includes(`${other} 暴走：`));
      const ok = ordered && otherDead && !corpseBerserk;
      return check(ok, '先手暴走秒杀后手；后手阵亡后不再暴走',
        `ordered=${ordered}, actor=${actor}, otherDead=${otherDead}, corpseBerserk=${corpseBerserk}`, g);
    }),
  },
  {
    id: 'TC-C089', name: '大屁孩：暴走秒杀无视命数（五条悟不消耗命数复活）', category: 'character', charId: 'dapihuai', seed: 286,
    desc: '指定五条悟释放暴走：直接淘汰，不触发「消耗一条命满血复活」',
    run: () => run(() => {
      const g = makeGame([{ id: 'P', char: 'dapihuai' }, { id: 'G', char: 'gojo' }], 286);
      g.judgeHistory('P').push('win', 'lose');
      playThrows(g, [{ P: 'rock', G: 'rock' }]);
      g.submitBerserk('P', 'G');
      const dead = !isAlive(g, 'G');
      const livesIntact = g.charState('G').livesLeft === 2;
      const revived = g.logs.some((l) => l.text.includes('消耗一条命'));
      const instakill = g.logs.some((l) => l.text.includes('精神攻击（秒杀'));
      const ok = dead && livesIntact && !revived && instakill;
      return check(ok, 'G 直接淘汰、命数仍为 2、无复活日志',
        `dead=${dead}, lives=${g.charState('G').livesLeft}, revived=${revived}, instakill=${instakill}`, g);
    }),
  },
  // ═══════════════ 精神攻击（独立词条）：无视躲藏 / 无视命数 ═══════════════
  {
    id: 'TC-C090', name: '精神攻击·辱骂：无视命数（五条悟不复活）', category: 'character', charId: 'dajianke', seed: 293,
    desc: '辱骂累计 3 次改为精神攻击结算：目标直接淘汰，不触发五条悟式命数复活',
    run: () => run(() => {
      const g = makeGame([{ id: 'D', char: 'dajianke' }, { id: 'G', char: 'gojo' }], 293);
      for (let i = 0; i < 3 && !g.isOver(); i++) {
        playThrows(g, [{ D: 'rock', G: 'scissors' }]); // D 胜获得资格
        actQueue(g, { D: { type: 'attack', targetId: 'G' } });
      }
      const dead = !isAlive(g, 'G');
      const lives = g.charState('G').livesLeft;
      const revived = g.logs.some((l) => l.text.includes('消耗一条命'));
      const mentalKill = g.logs.some((l) => l.text.includes('精神攻击击杀'));
      const ok = dead && lives === 2 && !revived && mentalKill;
      return check(ok, 'G 直接淘汰、命数仍为 2、无复活日志',
        `dead=${dead}, lives=${lives}, revived=${revived}, mentalKill=${mentalKill}`, g);
    }),
  },
  {
    id: 'TC-C091', name: '精神攻击·辱骂：无视躲藏与隐身', category: 'character', charId: 'dajianke', seed: 294,
    desc: '躲藏且隐身的对手仍被辱骂锁定，累计 3 次精神击杀',
    run: () => run(() => {
      const g = makeGame([{ id: 'D', char: 'dajianke' }, 'B'], 294);
      g.players['B'].room = 'R1';
      g.players['B'].hidden = true;
      g.players['B'].invisible = true;
      for (let i = 0; i < 3 && !g.isOver(); i++) {
        playThrows(g, [{ D: 'rock', B: 'scissors' }]);
        actQueue(g, { D: { type: 'attack', targetId: 'B' } });
      }
      const ok = !isAlive(g, 'B');
      return check(ok, '躲藏+隐身的 B 仍被精神攻击击杀', `alive=${isAlive(g, 'B')}`, g);
    }),
  },
  {
    id: 'TC-C092', name: '精神攻击·不讲武德：无视命数（五条悟不复活）', category: 'character', charId: 'mabaoguo', seed: 295,
    desc: '击杀马保国后被「不讲武德」带走：直接淘汰，不触发命数复活（种子扫描找到判定成功的一局）',
    run: () => run(() => {
      let g = makeGame([{ id: 'A', char: 'gojo' }, { id: 'B', char: 'mabaoguo' }], 1);
      let found = false;
      for (let seed = 1; seed <= 120 && !found; seed++) {
        g = makeGame([{ id: 'A', char: 'gojo' }, { id: 'B', char: 'mabaoguo' }], seed);
        g.players['B'].hp = 1;
        g.eliminate('B', 'test', 'A'); // 直接淘汰马保国（绕过太极），触发不讲武德判定
        if (g.phase === 'judge') { for (let i = 0; i < 5; i++) { g.submitJudgeThrow('B', 'rock'); g.submitJudgeThrow('A', 'paper'); } }
        found = !g.players['A'].alive;
      }
      const lives = g.charState('A').livesLeft;
      const revived = g.logs.some((l) => l.text.includes('消耗一条命'));
      const ok = found && !isAlive(g, 'A') && lives === 2 && !revived;
      return check(ok, '不讲武德带走五条悟：直接淘汰、命数仍为 2、无复活日志',
        `found=${found}, lives=${lives}, revived=${revived}`, g);
    }),
  },
  {
    id: 'TC-C093', name: '精神攻击·暴走：无视躲藏与隐身', category: 'character', charId: 'dapihuai', seed: 296,
    desc: '指定躲藏+隐身的对手释放暴走：仍被秒杀',
    run: () => run(() => {
      const g = makeGame([{ id: 'P', char: 'dapihuai' }, 'A'], 296);
      g.players['A'].hidden = true;
      g.players['A'].invisible = true;
      g.judgeHistory('P').push('win', 'lose');
      playThrows(g, [{ P: 'rock', A: 'rock' }]);
      g.submitBerserk('P', 'A');
      const ok = !isAlive(g, 'A');
      return check(ok, '躲藏+隐身的 A 仍被暴走击杀', `alive=${isAlive(g, 'A')}`, g);
    }),
  },
  {
    id: 'TC-C094', name: '大屁孩：自爆在回合最前结算（先于行动阶段）', category: 'character', charId: 'dapihuai', seed: 297,
    desc: '第三连胜触发自爆时，行动阶段尚未开始：大屁孩先自爆，对手直接获胜',
    run: () => run(() => {
      const g = makeGame([{ id: 'P', char: 'dapihuai' }, 'A'], 297);
      playThrows(g, [{ P: 'rock', A: 'scissors' }]);
      actQueue(g, { P: { type: 'skip' } });
      playThrows(g, [{ P: 'rock', A: 'scissors' }]);
      actQueue(g, { P: { type: 'skip' } });
      playThrows(g, [{ P: 'rock', A: 'scissors' }]); // 第三胜 → 三同 → 自爆
      const explodedLog = g.logs.some((l) => l.text.includes('自爆'));
      const thirdRoundActions = g.logs.filter((l) => l.type === 'action' && l.round === g.roundNo).length;
      const ok = explodedLog && !isAlive(g, 'P') && thirdRoundActions === 0;
      return check(ok, '第三回合自爆先于行动，本回合没有行动记录',
        `exploded=${explodedLog}, P=${isAlive(g, 'P')}, 第三回合行动=${thirdRoundActions}`, g);
    }),
  },
  {
    id: 'TC-C095', name: '大屁孩：多名大屁孩同时暴走 → 二次判定决定顺序', category: 'character', charId: 'dapihuai', seed: 298,
    desc: '两名大屁孩同时持有暴走权：先按二次判定排序，再依次指定目标释放',
    run: () => run(() => {
      const g = makeGame([{ id: 'P1', char: 'dapihuai' }, { id: 'P2', char: 'dapihuai' }, 'A'], 298);
      g.judgeHistory('P1').push('win', 'lose');
      g.judgeHistory('P2').push('win', 'lose');
      playThrows(g, [{ P1: 'rock', P2: 'rock', A: 'rock' }]); // 三人都记 tie → 两名大屁孩同时三不同
      const orderLog = g.logs.find((l) => l.text.includes('暴走顺序'))?.text ?? '';
      const first = g.triggerView()?.actor ?? '';
      if (first) g.submitBerserk(first, 'A');
      const second = g.triggerView()?.actor ?? '';
      if (second) g.submitBerserk(second, first);
      const ok = orderLog.length > 0 && first.length > 0 && second.length > 0 && second !== first
        && !isAlive(g, 'A') && !g.players[first].alive;
      return check(ok, '二次判定给出暴走顺序，两人依次释放',
        `order="${orderLog}", first=${first}, second=${second}, A=${isAlive(g, 'A')}`, g);
    }),
  },
  {
    id: 'TC-C096', name: '大屁孩：暴走可指定任意房间目标', category: 'character', charId: 'dapihuai', seed: 299,
    desc: '目标在异房间也照杀（精神攻击无视距离/躲藏）',
    run: () => run(() => {
      const g = makeGame([{ id: 'P', char: 'dapihuai' }, 'A'], 299);
      g.players['A'].room = 'R4';
      g.judgeHistory('P').push('win', 'lose');
      playThrows(g, [{ P: 'rock', A: 'rock' }]);
      const targetRoom = g.players['A'].room;
      g.submitBerserk('P', 'A');
      const ok = !isAlive(g, 'A');
      return check(ok, `异房间（${targetRoom}）目标仍被暴走击杀`, `alive=${isAlive(g, 'A')}`, g);
    }),
  },
  {
    id: 'TC-C097', name: '大屁孩：暴走目标校验（不能选自己/已淘汰）', category: 'character', charId: 'dapihuai', seed: 300,
    desc: '非法目标被拒绝，合法目标正常释放',
    run: () => run(() => {
      const g = makeGame([{ id: 'P', char: 'dapihuai' }, 'A', 'B'], 300);
      g.judgeHistory('P').push('win', 'lose');
      playThrows(g, [{ P: 'rock', A: 'rock', B: 'rock' }]);
      const self = g.submitBerserk('P', 'P');
      g.eliminate('B', 'test');
      const deadTarget = g.submitBerserk('P', 'B');
      const ok = !self.ok && !deadTarget.ok && g.phase === 'trigger';
      return check(ok, '选自己/已淘汰目标都被拒绝，仍停在触发阶段',
        `self=${self.error}, dead=${deadTarget.error}`, g);
    }),
  },
];

function insults2(g: ReturnType<typeof makeGame>): number {
  return ((g.charState('D').insults as Record<string, number>)['B']) || 0;
}

function fmtLogsOf(g: ReturnType<typeof makeGame>): string {
  return g.logs.map((l) => `[R${l.round}·${l.type}] ${l.text}`).join('\n');
}
