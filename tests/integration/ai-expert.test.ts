/**
 * 宗师档（AI 第四档）测试：每个角色单独编写的专属策略。
 * - 注册表必须覆盖全部在册角色（新角色入册时同步提醒补专属策略）；
 * - 未注册的未知角色安全降级为硬核策略（候选链仍然可落地）；
 * - 逐角色验证关键打法（依据 90 分钟离线实验的压制/支配结论）；
 * - 暴走选目标：宗师按威胁选，其他档位保持血量最低；
 * - 整局回归：宗师四档可复现、可打完。
 */

import { describe, it, expect } from 'vitest';
import { Game } from '../../shared/src/engine.js';
import { CHARACTERS } from '../../shared/src/characters/index.js';
import { characterExpertAi, EXPERT_REGISTRY_IDS } from '../../shared/src/characters/ai-expert.js';
import { aiDecideAction, aiDecideActions, aiBerserkTarget, aiThrow } from '../../server/src/room.js';
import type { ActionRequest, AiDifficulty } from '../../shared/src/types.js';

/** 全角色名册（含新增 3D 角色） */
const FULL_ROSTER = Object.keys(CHARACTERS);

function makeAiGame(seed: number, count: number, chars: string[] = FULL_ROSTER): Game {
  return new Game({
    seed,
    rules: { secondJudgeMode: 'serverRoll', skillJudgeMode: 'serverRoll' },
    chars: CHARACTERS,
    players: Array.from({ length: count }, (_, i) => ({
      id: `AI${i + 1}`, name: `AI${i + 1}`, charId: chars[i % chars.length], type: 'ai' as const,
    })),
  });
}

/** 把 AI2 拉进 AI1 的出生房间（默认 AI1=R1、AI2=R2、AI3=R3） */
function sameRoom(g: Game, target: 'AI2' | 'AI3' = 'AI2'): void {
  g.players[target].room = 'R1';
}

describe('宗师档：注册表覆盖与安全降级', () => {
  it('注册表覆盖全部在册角色（16/16）', () => {
    expect(EXPERT_REGISTRY_IDS).toEqual(FULL_ROSTER.slice().sort());
  });

  it('未知/未来角色安全降级：宗师档决策仍合法且候选链兜底为跳过', () => {
    const chars = {
      ...CHARACTERS,
      'future-char': { id: 'future-char', name: '未来角色', desc: '测试用未注册角色', hp: 3, attack: 1, attackType: 'melee' as const },
    };
    const g = new Game({
      seed: 42,
      rules: { secondJudgeMode: 'serverRoll', skillJudgeMode: 'serverRoll' },
      chars,
      players: [
        { id: 'AI1', name: 'AI1', charId: 'future-char', type: 'ai' },
        { id: 'AI2', name: 'AI2', charId: 'default', type: 'ai' },
      ],
    });
    sameRoom(g);
    const act = aiDecideAction(g, 'AI1', 'expert');
    expect(['attack', 'heal', 'move', 'hide', 'seek', 'skip']).toContain(act.type);
    const chain = aiDecideActions(g, 'AI1', 'expert');
    expect(chain[chain.length - 1]).toEqual({ type: 'skip' });
  });
});

describe('宗师档：角色专属打法（实验压制端修复）', () => {
  it('吹箫哥：与敌人同房间时撤离空房（远程角色贴脸无法输出）', () => {
    const g = makeAiGame(301, 2, ['chuixiao', 'default']);
    sameRoom(g);
    const act = aiDecideAction(g, 'AI1', 'expert');
    expect(act.type).toBe('move');
    expect(act.room).not.toBe('R1');
  });

  it('吹箫哥：跨房间残血目标直接狙击（远程免瞄准）', () => {
    const g = makeAiGame(302, 3, ['chuixiao', 'default', 'default']);
    g.players.AI2.hp = 1;
    const act = aiDecideAction(g, 'AI1', 'expert');
    expect(act).toEqual({ type: 'attack', targetId: 'AI2', ranged: true });
  });

  it('吹箫哥：同房间只剩躲藏者会找出来（揭示后即可离房狙击）', () => {
    const g = makeAiGame(303, 2, ['chuixiao', 'default']);
    sameRoom(g);
    g.players.AI2.hidden = true;
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'seek', targetId: 'AI2' });
  });

  it('大贱客：锁定已辱骂 1-2 次的目标打满三连（即使别人威胁更高）', () => {
    const g = makeAiGame(311, 3, ['dajianke', 'default', 'default']);
    g.charState('AI1').insults = { AI2: 2 };
    g.players.AI3.hp = 6; // AI3 威胁更高，但 AI2 差一次辱骂即精神击杀
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'attack', targetId: 'AI2' });
  });

  it('卖大伊万的小女孩：持续把炸弹扔进人最多的异房间', () => {
    const g = makeAiGame(321, 3, ['ivan-girl', 'default', 'default']);
    g.players.AI3.room = 'R2'; // R2 挤了两个敌人
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'throwIvan', room: 'R2' });
  });

  it('卖大伊万的小女孩：同房间恰 1 敌人先撤离（1 换 1 不划算），异房间没人可炸时才同归于尽', () => {
    const g = makeAiGame(322, 3, ['ivan-girl', 'default', 'default']);
    sameRoom(g);
    g.players.AI3.alive = false;
    const act = aiDecideAction(g, 'AI1', 'expert');
    expect(act.type).toBe('move');
    expect(act.room).not.toBe('R1');
  });

  it('无业游民：同房间残血目标优先补刀（白板宗师打法）', () => {
    const g = makeAiGame(331, 2, ['default', 'default']);
    sameRoom(g);
    g.players.AI2.hp = 1;
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'attack', targetId: 'AI2' });
  });

  it('伍六七：优先蓄力「存在 hp<=3 必杀目标」的房间（三刀 AOE 逐房间结算）', () => {
    const g = makeAiGame(341, 3, ['wuliuqi', 'default', 'default']);
    g.players.AI2.hp = 3; // R2：可被三刀带走
    g.players.AI3.hp = 10;
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'attack', room: 'R2' });
  });

  it('大屁孩：攻击 0，绝不把行动浪费在攻击上（保持满血/隐匿）', () => {
    const g = makeAiGame(351, 2, ['dapihuai', 'default']);
    sameRoom(g);
    g.players.AI1.hp = 15; // 满血 20 → 受伤先回复
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'heal' });
  });
});

describe('宗师档：角色专属打法（实验支配端精修）', () => {
  it('拔棍：未拔棍先拔棍；拔棍后无视躲避直击', () => {
    const g = makeAiGame(401, 2, ['bagun', 'default']);
    sameRoom(g);
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'toggleStick' });
    g.charState('AI1').stickDrawn = true;
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'attack', targetId: 'AI2' });
    // 拔棍攻击无视躲藏：目标躲藏也照样打（不浪费行动找出来）
    g.players.AI2.hidden = true;
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'attack', targetId: 'AI2' });
  });

  it('五条悟：领域先手；领域内远程免瞄准收割 hp<=2', () => {
    const g = makeAiGame(411, 2, ['gojo', 'default']);
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'domain' });
    g.players.AI1.char.domain = true;
    g.players.AI2.hp = 2;
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'attack', targetId: 'AI2', ranged: true });
  });

  it('老大爷：领域先手；领域内远程 3 伤斩杀线（安全优先于近战 5 伤）', () => {
    const g = makeAiGame(421, 2, ['laodaye', 'default']);
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'domain' });
    g.players.AI1.char.domain = true;
    g.players.AI2.hp = 3;
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'attack', targetId: 'AI2', ranged: true });
  });

  it('马保国：斩杀线内直接攻击；否则五连鞭挑当前血量最高者（百分比伤害收益最大）', () => {
    const g = makeAiGame(431, 3, ['mabaoguo', 'default', 'default']);
    sameRoom(g);
    g.players.AI3.room = 'R1';
    g.players.AI2.hp = 2;
    g.players.AI3.hp = 4;
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'whip5', targetId: 'AI3' });
    g.players.AI2.hp = 1; // 补刀优先于五连鞭
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'attack', targetId: 'AI2' });
  });

  it('佝偻弓箭手：自燃且残血先扑灭（燃烧致死不可复原）', () => {
    const g = makeAiGame(441, 2, ['hunchback-archer', 'default']);
    sameRoom(g);
    g.players.AI1.hp = 1;
    g.addStatus('AI1', { kind: 'burning', severity: 0.5, source: 'AI2' });
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'extinguish' });
  });

  it('佝偻弓箭手：火种扩散——优先点燃尚未燃烧的威胁最高者', () => {
    const g = makeAiGame(442, 3, ['hunchback-archer', 'default', 'default']);
    g.addStatus('AI2', { kind: 'burning', severity: 0.5, source: 'AI1' });
    g.players.AI3.hp = 6; // AI3 威胁更高（未被点燃）
    const act = aiDecideAction(g, 'AI1', 'expert');
    expect(act.type).toBe('attack');
    expect(act.ranged).toBe(true);
    expect(act.targetId).toBe('AI3');
  });

  it('狂猎：未骑乘先补刀（省出上马行动），否则上马；骑乘中按当回合伤害挑斩杀线内威胁最高者', () => {
    const g = makeAiGame(451, 2, ['wild-hunt', 'default']);
    sameRoom(g);
    g.players.AI2.hp = 4;
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'mount' });

    const st = g.charState('AI1');
    st.mounted = true;
    st.mountExpiresRound = g.roundNo + 2;
    // 骑乘普通回合 2 伤：hp4 打不死 → 压最高威胁
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'attack', targetId: 'AI2' });
    g.players.AI2.hp = 2; // 进入斩杀线
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'attack', targetId: 'AI2' });

    st.mountExpiresRound = g.roundNo; // 最后一回合 6 伤
    g.players.AI2.hp = 4;
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'attack', targetId: 'AI2' });
  });

  it('飞天水螅：没塔先造塔；塔成后把同房间敌人吸进塔（先吸残血）', () => {
    const g = makeAiGame(461, 3, ['water-snake', 'default', 'default']);
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'buildTower' });

    const st = g.charState('AI1') as unknown as { towerBaseRoom: string | null; towerHp: number };
    st.towerBaseRoom = 'R1';
    st.towerHp = 6;
    sameRoom(g); // AI2 进塔房（塔外）
    g.players.AI3.room = 'R2';
    g.players.AI3.hp = 1; // 残血优先吸
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'inhale', targetId: 'AI2' });
  });

  it('鬼影：附身全场威胁最高者；已附身则折磨宿主', () => {
    const g = makeAiGame(471, 3, ['ghost', 'default', 'default']);
    g.players.AI3.hp = 6; // AI3 威胁更高
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'possess', targetId: 'AI3' });
    g.charState('AI1').possessing = 'AI3';
    g.addStatus('AI1', { kind: 'possessing', severity: 0, data: { host: 'AI3' } });
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'possessStrike' });
  });

  it('老虎机侠：有钥匙先封印全场威胁最高者的核心技能（不浪费在基础行动上）', () => {
    const g = makeAiGame(481, 3, ['slot-hero', 'default', 'mabaoguo']);
    g.charState('AI1').keys = 1;
    const act = aiDecideAction(g, 'AI1', 'expert');
    // 威胁最高者是马保国（hp4）；封印清单里非基础行动 = 闪电五连鞭
    expect(act.type).toBe('slotKey');
    expect(act.targetId).toBe('AI3');
    expect((act.params as { action?: string }).action).toBe('whip5');
  });

  it('今日勇者：小局满血不赌运势；血量见底才抽取；抽过不再抽', () => {
    const g = makeAiGame(491, 2, ['hero-today', 'default']);
    sameRoom(g);
    g.players.AI2.hp = 1; // 有补刀可打，不该浪费行动赌运势
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'attack', targetId: 'AI2' });

    g.players.AI2.hp = 3;
    g.players.AI1.hp = 1; // 血量见底 → 无可再输，抽取
    expect(aiDecideAction(g, 'AI1', 'expert')).toEqual({ type: 'rollFortune' });

    g.charState('AI1').fortuneUsed = true;
    const act = aiDecideAction(g, 'AI1', 'expert');
    expect(['heal', 'move', 'hide', 'seek', 'skip']).toContain(act.type);
  });
});

describe('宗师档：暴走选目标与出拳', () => {
  it('暴走选目标：宗师按威胁（攻击力×2+血量），默认档保持血量最低', () => {
    const g = makeAiGame(501, 3, ['dapihuai', 'default', 'mabaoguo']);
    expect(aiBerserkTarget(g, 'AI1')).toBe('AI2'); // 默认：血量最低
    expect(aiBerserkTarget(g, 'AI1', 'expert')).toBe('AI3'); // 宗师：马保国威胁最高
  });

  it('宗师出拳：长记忆反制（6 局全石头 → 几乎必出布）', () => {
    let paper = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const g = makeAiGame(seed, 2);
      g.throwHistory['AI2'] = ['rock', 'rock', 'rock', 'rock', 'rock', 'rock'];
      if (aiThrow(g, 'AI1', 'expert') === 'paper') paper++;
    }
    expect(paper).toBeGreaterThanOrEqual(16);
  });
});

describe('宗师档：整局回归', { timeout: 180000 }, () => {
  function playExpert(seed: number, count: number) {
    const g = makeAiGame(seed, count);
    let guard = 0;
    while (!g.isOver() && g.roundNo <= 300 && guard++ < 40000) {
      if (g.phase === 'rps1') {
        for (const pid of g.aliveIds()) {
          if (!g.submittedIds.includes(pid)) g.submitThrow(pid, aiThrow(g, pid, 'expert'));
        }
      } else if (g.phase === 'trigger') {
        const view = g.triggerView();
        if (!view) break;
        const target = aiBerserkTarget(g, view.actor, 'expert');
        if (!target) break;
        g.submitBerserk(view.actor, target);
      } else if (g.phase === 'act') {
        const cur = g.currentActor();
        if (!cur) break;
        let accepted = false;
        for (const act of aiDecideActions(g, cur, 'expert') as ActionRequest[]) {
          if (g.submitAction(cur, act).ok) { accepted = true; break; }
        }
        expect(accepted, `宗师档第 ${g.roundNo} 回合无可落地行动`).toBe(true);
      } else {
        break;
      }
    }
    return { over: g.isOver(), winner: g.winner ?? null, rounds: g.roundNo, log: g.logs.map((l) => l.text).join('\n') };
  }

  it('宗师档全角色名册能打完多局（4 人局 × 3 种子）', () => {
    for (const seed of [11, 22, 33]) {
      const r = playExpert(seed, 4);
      expect(r.over, `宗师种子 ${seed} 未终局（第 ${r.rounds} 回合）\n${r.log.slice(-1200)}`).toBe(true);
    }
  });

  it('宗师档同种子完全可复现', () => {
    const a = playExpert(777, 3);
    const b = playExpert(777, 3);
    expect(a.log).toBe(b.log);
    expect(a.winner).toBe(b.winner);
  });
});
