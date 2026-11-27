/**
 * 拔典 · 角色注册表
 * 9 个首轮验证角色 + 老大爷（领域覆盖验证用）+ 默认角色（无业游民）
 *
 * 数据来源：docs/角色速查表-原始数据.md（拔典1/拔典2 OCR 整理表）
 * OCR 存疑或资料缺失处均在 desc/dataMissing 中标注，并写入 docs/GAME_RULES.md 规则假设。
 */

import { characterAi } from './ai-strategies.js';
import type { CharActionDef, CharDef, GameLike } from '../chardef.js';
import { mentalKill } from '../mental.js';
import { fmtNum, type PlayerId } from '../types.js';

/** 默认角色：无业游民（无被动，未选上角色者默认此角色）。血量2——速查表原稿+用户卡面确认 */
const defaultChar: CharDef = {
  id: 'default',
  name: '无业游民',
  desc: '无被动（原稿：未选上角色者默认此角色）。血量2，攻击1（原稿攻击栏「-」，按默认1处理）。',
  hp: 2,
};

/** 1. 拔棍：需先拔棍才能造成伤害；无视躲避（含隐身、躲藏）直伤 */
const bagun: CharDef = {
  id: 'bagun',
  aiStrategy: characterAi.bagun,
  name: '拔棍',
  desc: '血量3攻击1。需先「拔棍」才能造成伤害；拔棍状态下攻击无视躲避（含隐身、躲藏）。',
  hp: 3,
  attack: 1,
  attackType: 'melee',
  ignoreHide: true,
  init: () => ({ stickDrawn: false }),
  validateAttack: (ctx) => {
    if (!ctx.game.charState(ctx.actor).stickDrawn) return '未拔棍，无法造成伤害（先使用「拔棍」行动）';
    return null;
  },
  actions: [
    {
      name: 'toggleStick',
      label: '拔棍/收棍',
      desc: '切换拔棍状态。未拔棍时攻击无法造成伤害。',
      targetHint: 'none',
      execute: (ctx) => {
        const st = ctx.game.charState(ctx.actor);
        st.stickDrawn = !st.stickDrawn;
        ctx.game.log('state', `${ctx.game.getPlayer(ctx.actor).name} ${st.stickDrawn ? '拔出了棍子' : '收回了棍子'}`);
      },
    },
  ],
};

/** 2. 吹箫哥：仅能远程攻击，默认免瞄准，无法近战 */
const chuixiao: CharDef = {
  id: 'chuixiao',
  aiStrategy: characterAi.chuixiao,
  name: '吹箫哥',
  desc: '血量3攻击1。仅能远程攻击（异房间），可直接选择目标远程攻击，无需瞄准；无法近战。',
  hp: 3,
  attack: 1,
  attackType: 'ranged',
  rangedCapable: true,
};

/** 3. 五条悟：近战1伤；远程需瞄准2伤；领域展开后远程免瞄准、平局回合获得行动资格（平局仍是平局）；领域全场唯一，后展开覆盖 */
const gojo: CharDef = {
  id: 'gojo',
  aiStrategy: characterAi.gojo,
  name: '五条悟',
  desc: '血量3、2条命（首次致死消耗一条命满血复活）。近战1伤；远程2伤需瞄准。领域展开（无量空处）后：远程免瞄准；判定平局（同拳或三拳循环）时五条悟可在平局回合行动（平局结果不变）。领域全场唯一，后展开覆盖先展开，被覆盖后可再次展开。',
  hp: 3,
  lives: 2,
  attack: 1,
  meleeDamage: 1,
  rangedDamage: 2,
  attackType: 'both',
  rangedCapable: true,
  rangedNeedsAim: true,
  aimExemptWhenDomain: true,
  domainActsOnTie: true,
  init: () => ({ domain: false }),
  actions: [
    {
      name: 'domain',
      label: '领域展开',
      desc: '展开领域·无量空处（持续生效，全场唯一）：远程攻击免瞄准；判定平局（含三种不同出拳的三拳循环）时五条悟获得该平局回合的行动资格，但平局仍然是平局（不改变胜负）。他人的领域会覆盖本领域；被覆盖后可再次展开夺回（后展开者生效）。',
      targetHint: 'none',
      validate: (ctx) => ctx.game.charState(ctx.actor).domain ? '领域已展开' : null,
      execute: (ctx) => {
        ctx.game.openDomain(ctx.actor);
        ctx.game.log('trigger', `✨ ${ctx.game.getPlayer(ctx.actor).name} 展开领域！远程免瞄准，平局回合可行动（领域持续保留，直至被覆盖）`, { pid: ctx.actor, domain: true }, true);
      },
    },
  ],
};

/** 3b. 老大爷：与五条悟同体系（近3远2；领域内近5远3，平局回合获得行动资格） */
const laodaye: CharDef = {
  id: 'laodaye',
  aiStrategy: characterAi.laodaye,
  name: '老大爷',
  desc: '血量1.5。近战3伤远程2伤（默认免瞄准）；领域展开后近战5伤远程3伤，且平局回合可行动（平局结果不变）。领域全场唯一，与五条悟的领域互相覆盖（后展开者生效，被覆盖后可再展开夺回）。',
  hp: 1.5,
  attack: 3,
  meleeDamage: 3,
  rangedDamage: 2,
  attackType: 'both',
  rangedCapable: true,
  domainActsOnTie: true,
  init: () => ({ domain: false }),
  /** 领域一开即进入完全体：近战 5 / 远程 3（无需额外强化动作） */
  dynamicDamage: ({ game, actor, ranged }) => {
    const st = game.charState(actor);
    if (st.domain === true) return ranged ? 3 : 5;
    return undefined;
  },
  actions: [
    {
      name: 'domain',
      label: '领域展开',
      desc: '展开领域（全场唯一）：平局回合可行动（平局结果不变）；领域内近战5伤远程3伤。后展开的领域会覆盖先展开的领域。',
      targetHint: 'none',
      validate: (ctx) => ctx.game.charState(ctx.actor).domain ? '领域已展开' : null,
      execute: (ctx) => {
        ctx.game.openDomain(ctx.actor);
        ctx.game.log('trigger', `✨ ${ctx.game.getPlayer(ctx.actor).name} 展开领域！近战5伤远程3伤，平局回合可行动`, { pid: ctx.actor, domain: true }, true);
      },
    },
  ],
};

/** 4. 马保国：混元形意太极（受伤判定反弹）、闪电五连鞭、不讲武德 */
const mabaoguo: CharDef = {
  id: 'mabaoguo',
  aiStrategy: characterAi.mabaoguo,
  name: '马保国',
  desc: '血量4攻击1。混元形意太极：除大伊万爆、肉山坐外，受到伤害时与来源各出一拳判定，赢则原伤反弹（可选）。闪电五连鞭：对同房间敌人累计进行5局有效判定（平局不计局数并重判），按胜次造成其**当前血量** 20/40/60/80/100% 的伤害（单次总量）。不讲武德：被击杀后与击杀者进行5局判定，赢3局则以精神攻击带走对面（同时死亡）。',
  hp: 4,
  attack: 1,
  attackType: 'melee',
  init: () => ({ taijiAuto: true }),
  damageHookStage: 'defense',
  onBeforeDamage: (ctx) => {
    const { game, req, owner } = ctx;
    const self = owner;
    if (req.target !== self) return; // 仅对指向自己的伤害进行太极判定
    const st = game.charState(self);
    if (st.taijiAuto === false) return; // 可选：选择不触发
    if (req.noReflect || req.reflected || req.judgeResolved) return; // 大伊万爆/肉山坐/已反弹/已判定过的伤害不再判定
    if (!req.source || req.source === self) return;
    if (!game.players[req.source] || !game.players[req.source].alive) return;

    const source = req.source;
    // 精神攻击（秒杀）反弹 = 反杀：来源改为马保国、保留秒杀/无视命数语义，
    // 结算时按对方当前血量计伤害（不能用马保国的血量当伤害值）。
    const mental = req.dtype === 'mental' || req.instakill === true;
    const reflect = () => {
      req.target = source;
      req.reflected = true;
      req.transferred = false;
      if (mental) {
        req.source = self;
        req.instakill = true;
        req.ignoreLives = true;
        game.log('trigger', `⚡ 太极判定成功！精神攻击被反弹 → 反杀 ${game.players[source].name}（无视命数）`, undefined, true);
      } else {
        game.log('trigger', `⚡ 太极判定成功！原伤 ${fmtNum(req.amount)} 反弹给 ${game.players[source].name}`, undefined, true);
      }
    };
    const settle = (wins: number) => {
      if (wins > 0) {
        reflect();
      } else {
        game.log('trigger', `⚡ 太极判定未成功，${game.players[self].name} 正常承受${req.instakill ? '（秒杀）' : ` ${fmtNum(req.amount)}`} 伤害`, undefined, true);
      }
      game.applyDamage(req);
    };

    if (game.rules.skillJudgeMode === 'serverRoll') {
      game.log('trigger', `⚡ 马保国混元形意太极：${game.players[source].name} 的伤害需进行判定`, undefined, true);
      if (game.rollJudge(self, source, '太极判定') === 'win') reflect();
      return;
    }

    // player 模式：挂起伤害，等双方各出一拳后结算（补结算时不再进入本钩子）
    req.judgeResolved = true;
    game.log('trigger', `⚡ 马保国混元形意太极：${game.players[source].name} 的伤害进入判定（双方出拳）`, undefined, true);
    return { deferTo: {
      kind: 'taiji', owner: self, opponent: source, rounds: 1, label: '太极判定',
      resolve: settle,
    } };
  },
  onDeath: (ctx) => {
    const { game, player, killer, cause } = ctx;
    if (!killer || !game.players[killer] || !game.players[killer].alive) return;
    if (cause === 'bujiangwude') return; // 不讲武德造成的死亡不再触发
    const victim = player;
    const settle = (wins: number) => {
      if (wins >= 3) {
        const kp = game.players[killer];
        if (!kp || !kp.alive) return;
        // 精神攻击（独立词条）：无视躲藏/命数；noReflect —— 不可被太极反弹
        mentalKill(game, {
          target: killer, source: victim, tag: 'bujiangwude', noReflect: true,
          note: `⚡ 不讲武德成功（${wins}/5局）！精神攻击带走 ${kp.name}（无视躲藏/命数，不可反弹）`,
        });
      } else {
        game.log('trigger', `⚡ 不讲武德失败（${wins}/5局），${game.players[killer].name} 存活`, undefined, true);
      }
    };
    game.log('trigger', `⚡ 不讲武德！${game.players[victim].name} 被击杀，与 ${game.players[killer].name} 进行 5 局判定`, undefined, true);

    if (game.rules.skillJudgeMode === 'serverRoll') {
      let wins = 0;
      for (let i = 1; i <= 5; i++) {
        const r = game.rollJudge(victim, killer, `不讲武德第${i}局`);
        if (r === 'win') wins++;
      }
      settle(wins);
      return;
    }
    game.requestJudge({
      kind: 'bujiangwude', owner: victim, opponent: killer, rounds: 5, label: '不讲武德',
      resolve: (wins) => settle(wins),
    });
  },
  actions: [
    {
      name: 'whip5',
      label: '闪电五连鞭',
      desc: '对同房间一名敌人累计进行5局有效判定（平局不计局数并重判），按胜次造成其「当前血量」20/40/60/80/100% 的伤害（单次总量）。',
      targetHint: 'sameRoomPlayer',
      validate: (ctx) => {
        const t = ctx.params.targetId;
        if (!t || !ctx.game.players[t]) return '目标不存在';
        if (!ctx.game.players[t].alive) return '目标已淘汰';
        if (!ctx.game.isSameRoom(ctx.actor, t)) return '闪电五连鞭需与目标同房间';
        if (t === ctx.actor) return '不能对自己使用';
        return null;
      },
      execute: (ctx) => {
        const game = ctx.game;
        const actor = ctx.actor;
        const t = ctx.params.targetId!;
        const tp = game.players[t];
        game.log('trigger', `⚡ ${game.players[actor].name} 对 ${tp.name} 发动闪电五连鞭！`, undefined, true);

        const settle = (wins: number) => {
          // 伤害 = 胜次 × 20% × 目标**当前血量**（结算时取当前值），保持单次总量
          const target = game.players[t];
          const dmg = target ? Math.round(wins * 0.2 * target.hp * 10000) / 10000 : 0;
          if (dmg > 0 && target) {
            game.log('damage', `⚡ 五连鞭命中 ${wins}/5，造成 ${fmtNum(dmg)} 伤害（${wins * 20}% 当前血量）`, undefined, true);
            game.applyDamage({ target: t, amount: dmg, source: actor, dtype: 'physical', tag: 'whip' });
          } else {
            game.log('damage', `五连鞭 0/5 命中，未造成伤害`);
          }
        };

        if (game.rules.skillJudgeMode === 'serverRoll') {
          let wins = 0;
          let judged = 0;
          for (let i = 1; judged < 5; i++) {
            const result = game.rollJudge(actor, t, `五连鞭第${i}鞭`);
            if (result === 'tie') {
              game.log('info', '⚡ 五连鞭平局，不计局数，本局重判');
              continue;
            }
            judged++;
            if (result === 'win') wins++;
          }
          settle(wins);
          return;
        }
        game.requestJudge({
          kind: 'whip5', owner: actor, opponent: t, rounds: 5, label: '闪电五连鞭',
          resolve: (wins) => settle(wins),
        });
      },
    },
  ],
};

/** 5. 伍六七（五六七）：攻击=前往任意房间，下一回合末在该房间砍出三刀（1×3 AOE，不打自己） */
const wuliuqi: CharDef = {
  id: 'wuliuqi',
  aiStrategy: characterAi.wuliuqi,
  name: '伍六七',
  desc: '血量3。攻击：立刻前往任意指定房间（可原地），下一回合末在该房间砍出三刀——每刀对刀落瞬间房间内所有其他存活玩家造成1伤（AOE 命中躲藏/隐身，不打自己），三刀独立结算、同一批内被命数复活者不再吃剩余刀；刀落排在所有行动之后、大伊万爆炸之前（平局回合同样落刀）。蓄力回合无论是否赢下判定，伍六七都不能进行其他行动。',
  hp: 3,
  attack: 1,
  attackType: 'melee',
  attackDesc: '前往任意房间，下一回合末在该房间砍出三刀（1×3，不打自己）',
  attackRoomHint: true,
};

/** 6. 卖大伊万的小女孩：掷大伊万至任意房间（含自己），投掷后第一个分出胜负回合末爆炸（平局回合顺延），动态判定成员 */
const xiaonuhai: CharDef = {
  id: 'ivan-girl',
  aiStrategy: characterAi.ivan,
  name: '卖大伊万的小女孩',
  desc: '掷一颗大伊万至任意房间（含自己所在房间）。扔出当回合引信未开；投掷后第一个分出胜负的回合引信激活，该回合末检测目标房间内存活者（含躲藏/隐身）全部毁灭（极高伤害，不触发反弹类被动）；平局回合顺延不消耗。炸弹先结算后判胜，可同归于尽。',
  hp: 2, // 原稿血量栏「-」，作者确认血量 2（2026-11-21，Issue #6）
  attack: 0, // 原稿攻击栏「-」，作者确认攻击 0（2026-11-21）
  attackType: 'melee',
  actions: [
    {
      name: 'throwIvan',
      label: '投掷大伊万',
      desc: '向任意房间（含自己所在房间）投掷大伊万。投掷回合不炸；投掷后第一个分出胜负的回合末爆炸（平局回合顺延），毁灭爆炸时房间内所有玩家（躲藏也算）。',
      roomHint: true,
      validate: (ctx) => {
        const room = ctx.params.room;
        if (!room || !ctx.game.roomIds.includes(room)) return `非法目标房间：${room}`;
        return null;
      },
      execute: (ctx) => {
        const game = ctx.game;
        const room = ctx.params.room!;
        // 最早可能引爆回合：投掷当回合引信未开，投掷后第一个分出胜负的回合末引爆；
        // 中间的平局回合会在结算处顺延（endRound 只在 roundResolved 时引燃伊万），无法提前算准具体回合。
        const explodeRound = game.roundNo + 1;
        game.addDeferred({
          kind: 'ivan', room, explodeRound,
          source: ctx.actor, createdAtRound: game.roundNo,
        });
        // 结构化 data（V3 演出链）：投掷者/目标房间/最早爆炸回合公开可见，不涉隐藏信息
        game.log('deferred', `💣 ${game.getPlayer(ctx.actor).name} 向 ${room} 投掷大伊万！预计第 ${explodeRound} 回合末爆炸（若中间出现平局回合则顺延）`,
          { pid: ctx.actor, room, explodeRound }, true);
      },
    },
  ],
};

/** 7. 今日勇者：抽取今日运势（用户确认规则）——随机数决定面板，0/1 暴毙；全局仅一次，不限回合 */
const jinriyongzhe: CharDef = {
  id: 'hero-today',
  aiStrategy: characterAi.hero,
  name: '今日勇者',
  desc: '血量3攻击1（初始面板）。技能「抽取今日运势」：掷 0-9 随机数——0/1 直接暴毙；2/3→血1攻1；4/5→血3攻1；6→血4攻2；7→血5攻3；8→血6攻4；9→血6攻6。转换时当前血量与上限同时变为掷出值（满血），并给出运势反馈。全局仅可使用一次，不限回合。',
  hp: 3,
  attack: 1,
  attackType: 'melee',
  init: () => ({ attackOverride: undefined as number | undefined, fortuneUsed: false }),
  /** 运势转换后的攻击力覆盖（仅近战；未抽取时用基础攻击1） */
  dynamicDamage: ({ game, actor, ranged }) => {
    const st = game.charState(actor);
    if (!ranged && typeof st.attackOverride === 'number') return st.attackOverride;
    return undefined;
  },
  actions: [
    {
      name: 'rollFortune',
      label: '抽取今日运势',
      desc: '掷 0-9 随机数转换面板：0/1 暴毙；2/3→血1攻1；4/5→血3攻1；6→血4攻2；7→血5攻3；8→血6攻4；9→血6攻6。转换时血量与上限同时变为掷出值（满血），并给出运势反馈。全局仅可使用一次，不限回合。',
      targetHint: 'none',
      validate: (ctx) => {
        if (ctx.game.charState(ctx.actor).fortuneUsed === true) return '「抽取今日运势」全局仅限使用一次';
        return null;
      },
      execute: (ctx) => {
        const game = ctx.game;
        const me = game.getPlayer(ctx.actor);
        game.charState(ctx.actor).fortuneUsed = true;
        const n = game.rng.int(10); // 0-9（游戏随机流，可复现）
        const table: Array<{ hp?: number; atk?: number; death?: boolean }> = [
          { death: true }, { death: true },
          { hp: 1, atk: 1 }, { hp: 1, atk: 1 },
          { hp: 3, atk: 1 }, { hp: 3, atk: 1 },
          { hp: 4, atk: 2 },
          { hp: 5, atk: 3 },
          { hp: 6, atk: 4 },
          { hp: 6, atk: 6 },
        ];
        const r = table[n];
        // 运势反馈（玩家可见的语气文案）
        const feedback = r.death
          ? '运势极凶，当场暴毙！'
          : n === 9 ? '中头奖了，今日勇者势不可挡！'
          : n === 8 ? '鸿运当头，气势如虹！'
          : n === 7 ? '运势不错，渐入佳境。'
          : n === 6 ? '小有斩获，渐入佳境。'
          : n === 5 || n === 4 ? '平平无奇，凑合能用。'
          : '时运不济，聊胜于无…';
        if (r.death) {
          game.log('trigger', `🎰 今日勇者抽取运势：抽中 ${n} 点 —— ${feedback}`, { pid: ctx.actor, fortune: true, roll: n, feedback, jackpot: false }, true);
          game.eliminate(ctx.actor, 'fortune-death');
          return;
        }
        const before = me.hp;
        const atkBefore = game.charDef(ctx.actor).attack;
        me.maxHp = r.hp!;
        me.hp = r.hp!; // 当前血量直接变为新上限（满血）
        game.charState(ctx.actor).attackOverride = r.atk!;
        game.log('trigger', `🎰 今日勇者抽取运势：抽中 ${n} 点 —— ${feedback} 面板转换：血量 ${before}→${r.hp}（满血），攻击 ${atkBefore}→${r.atk}`, { pid: ctx.actor, fortune: true, roll: n, feedback, jackpot: n === 9 }, true);
      },
    },
  ],
};

/** 8. 大贱客：在场自动吸引全场伤害（仅伤害，不转移效果；精神伤害不转移）；辱骂三次致死 */
const dajianke: CharDef = {
  id: 'dajianke',
  aiStrategy: characterAi.firstInRoom,
  name: '大贱客',
  desc: '血量3。被动：在场时自动吸引全场非精神伤害（含AOE与延迟伤害）——伤害转移至大贱客，仅转移伤害数值，不转移附加效果。精神伤害不转移。攻击为辱骂（精神）：无视距离与躲藏，同一目标累计3次致死。',
  hp: 3,
  attack: 1,
  attackType: 'both',
  attackDtype: 'mental',
  ignoreHide: true, // 辱骂无视躲藏/隐身（作者确认 2026-11-21，A-06 定案）
  attackAllRooms: true, // 辱骂无视距离：任意房间的目标均可选（作者确认 2026-11-21）
  attackDesc: '辱骂（精神攻击）：无视距离与躲藏，同一目标累计3次直接精神致死',
  damageHookStage: 'transfer',
  init: () => ({ insults: {} as Record<string, number> }),
  onBeforeDamage: (ctx) => {
    const { game, req } = ctx;
    const me = game.playerIds.find((pid) => game.charDef(pid).id === 'dajianke');
    if (!me) return;
    const dAlive = game.players[me].alive;
    // 阵亡后仅在回合末延迟事件结算窗口内继续吸收（瞬间溢出的回合末爆发，作者确认 2026-11-21）：
    // 同批剩余伤害全部由其（遗体）承担，被波及目标不受损。
    // 行动阶段的多段独立结算伤害（如伍六七三段）不在此列：大贱客死亡即停止吸收。
    if (!dAlive && game.settlingDeferred !== true) return;
    if (req.target === me) return; // 已指向自己的伤害不转移
    if (req.dtype === 'mental') return; // 精神伤害不转移
    if (req.transferred) return; // 已转移伤害不再转移
    if (dAlive) {
      game.log('trigger', `🧲 大贱客被动：${game.players[req.target].name} 承受的 ${fmtNum(req.amount)} 伤害（${req.tag || '普通'}）被吸引至大贱客（不转移附加效果）`, undefined, true);
    } else {
      game.log('trigger', `🧲 大贱客（已阵亡）仍吸收本次回合末爆发的伤害：${game.players[req.target].name} 承受的 ${fmtNum(req.amount)} 伤害（${req.tag || '普通'}）由其承担，目标不受损`, undefined, true);
    }
    req.target = me;
    req.transferred = true;
    req.ignoreHide = true; // 转移后视为直击大贱客——无视其自身躲藏/隐身（作者确认 2026-11-21）
    req.effects = undefined; // 仅转移伤害，不转移效果
  },
  onAttackAction: (ctx, targetId) => {
    const game = ctx.game;
    const actor = ctx.actor;
    const tp = game.players[targetId];
    // 辱骂无视距离（任意房间目标均可）与躲藏/隐身（作者确认 2026-11-21，A-06 定案）
    const st = game.charState(actor) as { insults: Record<string, number> };
    st.insults[targetId] = (st.insults[targetId] || 0) + 1;
    const n = st.insults[targetId];
    game.log('damage', `${game.players[actor].name} 辱骂 ${tp.name}（精神攻击，累计 ${n}/3）`, undefined, true);
    if (n >= 3) {
      st.insults[targetId] = 0; // 状态重置
      // 精神攻击（独立词条）：无视躲藏/隐身与命数，可被太极判定反弹
      mentalKill(game, {
        target: targetId, source: actor, tag: 'insult',
        note: `💀 ${game.players[actor].name} 辱骂累计 3 次，${tp.name} 被精神攻击击杀（无视躲藏/命数）`,
      });
    }
    return { ok: true };
  },
};

/** 9. 大屁孩：判定历史三不同→暴走（回合前结算、本人指定目标）；三同→自爆；跨回合记忆 */
const dapihuai: CharDef = {
  id: 'dapihuai',
  name: '大屁孩',
  desc: '血量20、攻击0：唯一的输出是判定被动。连续三次判定出现三种不同结果（赢平输任意组合）→ 暴走：**回合最靠前**结算，由本人指定任意一名其他玩家，对其释放精神攻击（秒杀·无视躲藏/命数）；连续三次相同（赢赢赢/平平平/输输输）→ 自爆（同样在回合最靠前结算）。多名大屁孩同时暴走时，先做二次判定决定暴走权顺序。判定历史跨回合记忆，触发后清零。',
  hp: 20,
  attack: 0,
  attackType: 'melee',
  init: () => ({ pendingTrigger: null }),
  onJudgeAppend: (ctx) => {
    const { game, player } = ctx;
    if (!game.getPlayer(player).alive) return; // 双重保险：阵亡者不触发
    const st = game.charState(player) as { pendingTrigger?: 'berserk' | 'selfdestruct' | null };
    if (st.pendingTrigger) return; // 本回合已标记，等待回合前统一结算
    const h = game.judgeHistory(player);
    if (h.length < 3) return;
    const last3 = h.slice(-3);
    const distinct = new Set(last3);
    if (distinct.size === 3) {
      game.judgeHistory(player).length = 0; // 触发后重置历史
      st.pendingTrigger = 'berserk';
      game.log('trigger', `🌀 ${game.getPlayer(player).name} 判定历史 [${last3.join(',')}] 三种不同结果 → 暴走待结算（回合最靠前，本人指定目标）`, { pid: player, trigger: 'berserk' }, true);
      return;
    }
    if (distinct.size === 1) {
      game.judgeHistory(player).length = 0;
      st.pendingTrigger = 'selfdestruct';
      game.log('trigger', `💥 ${game.getPlayer(player).name} 判定历史 [${last3.join(',')}] 三连相同结果 → 自爆待结算（回合最靠前）`, { pid: player, trigger: 'selfdestruct' }, true);
    }
  },
};

/**
 * 12. 佝偻弓箭手：骷髅弓手（Issue #71）
 *
 * 规则要点：
 * - 远程攻击造成 1 点伤害并**点燃**目标（可射击同房间目标）：燃烧每回合 0.5 伤害（含平局回合），
 *   无限持续，直到目标消耗一次行动「扑灭」；点燃当回合与扑灭当回合不结算；
 * - 骷髅身躯：非精神、非燃烧伤害致死时**不会死亡**——完整缺席 1 回合（仍参与猜拳、平局也计入，
 *   但整回合不能行动），再下一回合开始时以生命上限一半复原；燃烧致死则彻底死亡
 *   （燃烧期间受到其他伤害仍可复原）；
 * - 无法主动「回复」回满血（只能靠复原机制回血）；
 * - 同房间的**燃烧敌人**可消耗一次行动引燃它；
 * - 同房间的**任何敌人**可消耗 2 次行动取出燃烧箭，再消耗 1 次行动以燃烧箭近战攻击
 *   （1 伤 + 点燃，攻击一次后箭失效）；取箭期间被它攻击会中断（进度清零）。
 */
const hunchbackArcher: CharDef = {
  id: 'hunchback-archer',
  name: '佝偻弓箭手',
  desc: '血量3。远程攻击（可打同房间目标）造成1点伤害并点燃：燃烧每回合0.5伤害（平局回合同样结算、持续到目标消耗一次行动扑灭；点燃当回合与扑灭当回合不结算）。骷髅身躯：精神伤害以外的伤害导致血量归零时不会死亡，而是完整缺席1回合（仍参与猜拳、平局也计入，但整回合无法行动），再下一回合开始时以生命上限一半复原；因燃烧导致血量归零则彻底死亡（燃烧期间受到其他伤害仍可复原）。无法主动「回复」回满血。同房间的燃烧敌人可消耗一次行动引燃它；同房间的任何敌人都可消耗两次行动取出燃烧箭、再消耗一次行动用其近战攻击（1伤+点燃，攻击一次后箭失效），取箭期间被它攻击会中断。',
  hp: 3,
  attack: 1,
  attackType: 'ranged',
  rangedCapable: true,
  rangedDamage: 1,
  /** 可射击同房间目标（近距离放箭） */
  rangedSameRoom: true,
  /** 骷髅无法主动回复：只能靠「倒地复原」机制回血 */
  blockBaseActions: ['heal'],
  traits: ['skeleton'],
  init: () => ({ downed: false, downedAtRound: 0, pendingArrow: null }),
  /** 普攻（远程）命中后点燃目标 */
  attackEffects: [{ kind: 'burning', severity: 0.5 }],
  aiStrategy: ({ game, pid, alive }) => {
    const targets = alive
      .filter((p) => p !== pid && !(game.players[p].hidden || game.players[p].invisible))
      .sort((a, b) => game.players[a].hp - game.players[b].hp);
    const target = targets[0];
    return target ? { type: 'attack', targetId: target, ranged: true } : undefined;
  },
  onLethalDamage: ({ game, player, req }) => {
    const p = game.getPlayer(player);
    const st = game.charState(player);
    // 精神伤害：骷髅也会被震慑（正常死亡）
    if (req.dtype === 'mental') return 'die';
    // 燃烧致死：彻底焚毁（不可复原）
    if (req.tag === 'burn') {
      game.log('trigger', `🔥 ${p.name} 的骷髅被燃烧彻底焚毁`, { pid: player, cause: 'burn' }, true);
      return 'die';
    }
    if (st.downed === true) {
      p.hp = 0;
      return 'prevent';
    }
    // 其余伤害：骨架散落，完整缺席 1 回合，再下一回合开始复原
    st.downed = true;
    st.downedAtRound = game.roundNo;
    p.hp = 0;
    const reviveHp = Math.round(p.maxHp * 0.5 * 10000) / 10000;
    const reviveRound = game.roundNo + 2;
    game.log('trigger', `🦴 ${p.name} 的骨架散落——不会死亡，完整缺席 1 回合（仍参与猜拳、不能行动），第 ${reviveRound} 回合开始以 ${fmtNum(reviveHp)} HP 复原`,
      { pid: player, downed: true, reviveHp, reviveRound, downedAtRound: st.downedAtRound }, true);
    game.roundSummary.push(`${p.name} 倒地（完整缺席 1 回合后复原）`);
    return 'prevent';
  },
  skipsAction: ({ game, player }) => game.charState(player).downed === true,
  onRoundStart: ({ game, player }) => {
    const st = game.charState(player);
    if (st.downed !== true) return;
    const downedAtRound = typeof st.downedAtRound === 'number' ? st.downedAtRound : game.roundNo - 1;
    // 完整缺席 1 回合：倒地当回合之后的那个回合仍然缺席，再下一回合开始才复原
    if (game.roundNo < downedAtRound + 2) {
      game.log('phase', `🦴 ${game.getPlayer(player).name} 仍在复原中（完整缺席本回合行动，仍可参与猜拳）`, { pid: player, downed: true }, true);
      return;
    }
    st.downed = false;
    st.downedAtRound = 0;
    const p = game.getPlayer(player);
    if (!p.alive) return;
    p.hp = Math.round(p.maxHp * 0.5 * 10000) / 10000;
    game.log('trigger', `🦴 ${p.name} 重新拼合骨架，以 ${fmtNum(p.hp)} HP 复原（生命上限一半）`, { pid: player, hp: p.hp }, true);
  },
  onAttackLanded: ({ game, actor, target }) => {
    const st = game.charState(target);
    const pending = st.pendingArrow as { from: PlayerId; progress: number } | null | undefined;
    if (!pending || pending.from !== actor || pending.progress <= 0) return;
    st.pendingArrow = null;
    game.log('trigger', `🏹 ${game.players[target].name} 取箭途中被 ${game.players[actor].name} 击中，燃烧箭脱手（取箭进度清零）`,
      { pid: target, by: actor }, true);
  },
  extraActionsForOthers: ({ game, owner, viewer }) => {
    const archer = game.players[owner];
    if (!archer?.alive) return [];
    if (!game.isSameRoom(owner, viewer)) return [];
    const viewerState = game.charState(viewer);
    const pending = viewerState.pendingArrow as { from: PlayerId; progress: number } | null | undefined;
    const progress = pending && pending.from === owner ? pending.progress : 0;
    const list: CharActionDef[] = [];

    if (progress < 2) {
      list.push({
        name: 'takeArrow',
        label: '取出燃烧箭',
        desc: `消耗本次行动，从 ${archer.name} 的箭袋取一支燃烧箭（共需 2 次行动取出；取箭期间被它攻击会中断）。`,
        typeLabel: '环境',
        targetHint: 'none',
        validate: (ctx) => {
          if (!ctx.game.players[owner]?.alive) return '弓箭手已不在场';
          if (!ctx.game.isSameRoom(ctx.actor, owner)) return '需要与弓箭手同房间';
          const st = ctx.game.charState(ctx.actor);
          const cur = st.pendingArrow as { from: PlayerId; progress: number } | null | undefined;
          const curProgress = cur && cur.from === owner ? cur.progress : 0;
          if (curProgress >= 2) return '已取出燃烧箭，先用它攻击';
          return null;
        },
        execute: (ctx) => {
          const st = ctx.game.charState(ctx.actor);
          const cur = st.pendingArrow as { from: PlayerId; progress: number } | null | undefined;
          const curProgress = cur && cur.from === owner ? cur.progress : 0;
          const next = Math.min(2, curProgress + 1);
          st.pendingArrow = { from: owner, progress: next };
          ctx.game.log('action', `🏹 ${ctx.game.players[ctx.actor].name} 从 ${archer.name} 的箭袋取箭（${next}/2）`,
            { pid: ctx.actor, from: owner, progress: next }, true);
          if (next >= 2) {
            ctx.game.log('trigger', `🏹 ${ctx.game.players[ctx.actor].name} 已取出燃烧箭——下一次行动可近战攻击（1 伤 + 点燃）`,
              { pid: ctx.actor, from: owner }, true);
          }
        },
      });
    } else {
      list.push({
        name: 'fireArrow',
        label: '燃烧箭近战',
        desc: '消耗本次行动，用取出的燃烧箭近战攻击同房间目标：造成 1 点伤害并点燃（与弓箭手普攻效果相同）。',
        typeLabel: '环境',
        targetHint: 'sameRoomPlayer',
        validate: (ctx) => {
          const targetId = ctx.params.targetId;
          if (!targetId || !ctx.game.players[targetId]?.alive) return '目标不存在或已淘汰';
          if (targetId === ctx.actor) return '不能攻击自己';
          if (!ctx.game.isSameRoom(ctx.actor, targetId)) return '只能近战攻击同房间目标';
          const tp = ctx.game.players[targetId];
          if (tp.hidden || tp.invisible) return '目标正在躲藏/隐身，无法命中';
          const st = ctx.game.charState(ctx.actor);
          const cur = st.pendingArrow as { from: PlayerId; progress: number } | null | undefined;
          if (!cur || cur.from !== owner || cur.progress < 2) return '还没有取出燃烧箭';
          return null;
        },
        execute: (ctx) => {
          const targetId = ctx.params.targetId!;
          ctx.game.charState(ctx.actor).pendingArrow = null;
          ctx.game.log('damage', `🏹 ${ctx.game.players[ctx.actor].name} 用燃烧箭近战刺向 ${ctx.game.players[targetId].name}`,
            { pid: ctx.actor, target: targetId, arrow: true }, true);
          ctx.game.applyDamage({
            target: targetId,
            amount: 1,
            source: ctx.actor,
            dtype: 'physical',
            tag: 'arrow',
            isAttack: true,
            effects: [{ kind: 'burning', severity: 0.5 }],
          });
        },
      });
    }
    return list;
  },
};

/**
 * 13. 鬼影：附身型幽灵（Issue #71）
 *
 * - 血量 2、攻击 1.5；**单次受伤上限 0.5**（任何单次伤害最多 0.5，含秒杀）；无法主动「回复」；
 * - 消耗一次行动，**无视距离**移动到目标所在房间并附身（无法锁定躲藏/隐身者）；
 * - 被附身者每回合受到 1 点伤害（含平局回合；附身当回合与驱赶当回合不结算）；
 * - 鬼影赢下判定后，可用一次行动「折磨宿主」（+1 伤害）或「操控宿主」行动一次；
 * - 附身期间造成的伤害等量回血给鬼影；附身期间鬼影类似于躲藏，无法被敌人锁定（AOE 仍可命中）；
 * - 被附身者可消耗一次行动「驱逐鬼影」解除附身。
 */
const ghost: CharDef = {
  id: 'ghost',
  name: '鬼影',
  desc: '血量2、攻击1.5；普通单次伤害最多 0.5（大伊万等高伤也压到0.5，但大屁孩暴走/辱骂/不讲武德等秒杀类精神攻击无视上限），无法主动回复。消耗一次行动可无视距离移动到目标房间并附身（不能锁定躲藏/隐身者）：被附身者每回合受到1点伤害（平局回合也结算，附身当回合与驱赶当回合不结算）；鬼影赢下判定后可用一次行动额外折磨（+1伤害）或操控宿主行动一次；附身期间造成的伤害等量回血给鬼影，且鬼影类似躲藏无法被敌人锁定（AOE仍可命中）。被附身者可消耗一次行动驱逐鬼影。',
  hp: 2,
  attack: 1.5,
  attackType: 'both',
  rangedCapable: true,
  traits: ['undead'],
  /** 无法主动回血：只能靠附身期间造成的伤害回血 */
  blockBaseActions: ['heal'],
  init: () => ({ possessing: null }),
  /** 单次受伤上限 0.5（秒杀类精神攻击无视上限；大伊万等高伤普通攻击仍被压到 0.5） */
  onBeforeDamage: ({ game, req, owner }) => {
    if (req.target !== owner) return;
    // 精神攻击秒杀（大屁孩暴走 / 大贱客辱骂 / 不讲武德…）：无视受伤上限
    if (req.dtype === 'mental' && req.instakill) return;
    if (req.amount <= 0.5 && !req.instakill) return;
    const before = req.instakill ? '秒杀' : fmtNum(req.amount);
    req.amount = 0.5;
    if (req.instakill) req.instakill = false;
    game.log('state', `🌫 ${game.players[owner].name} 的单次受伤上限为 0.5（原伤害 ${before}）`, { pid: owner, capped: 0.5 }, false);
  },
  aiStrategy: ({ game, pid, alive }) => {
    if (game.hasStatus(pid, 'possessing')) return { type: 'possessStrike' };
    const target = alive.find((p) => p !== pid && !game.players[p].hidden && !game.players[p].invisible);
    return target ? { type: 'possess', targetId: target } : undefined;
  },
  actions: [
    {
      name: 'possess',
      label: '附身',
      desc: '消耗本次行动，无视距离移动到目标所在房间并附身：被附身者每回合受到 1 点伤害（附身当回合不结算），期间鬼影无法被锁定。',
      targetHint: 'anyPlayer',
      validate: (ctx) => {
        const t = ctx.params.targetId;
        if (!t || !ctx.game.players[t]) return '目标不存在';
        if (!ctx.game.players[t].alive) return '目标已淘汰';
        if (t === ctx.actor) return '不能附身自己';
        if (ctx.game.hasStatus(ctx.actor, 'possessing')) return '已经处于附身中';
        const target = ctx.game.players[t];
        if (target.hidden || target.invisible) return '无法锁定躲藏/隐身的玩家';
        return null;
      },
      execute: (ctx) => {
        const targetId = ctx.params.targetId!;
        const p = ctx.game.getPlayer(ctx.actor);
        const target = ctx.game.players[targetId];
        p.room = target.room; // 无视距离移动到目标房间
        if (p.hidden) p.hidden = false;
        p.invisible = true; // 附身期间类似躲藏：无法被敌人锁定
        ctx.game.charState(ctx.actor).possessing = targetId;
        ctx.game.addStatus(targetId, {
          kind: 'possessed', severity: 1, remainingRounds: null, source: ctx.actor,
          data: { ghost: ctx.actor },
        });
        ctx.game.addStatus(ctx.actor, {
          kind: 'possessing', severity: 0, remainingRounds: null,
          data: { host: targetId },
        });
        ctx.game.log('trigger', `👻 ${p.name} 附身了 ${target.name}（移动到 ${target.room}；附身期间无法被锁定）`,
          { ghost: ctx.actor, host: targetId, room: target.room }, true);
      },
    },
  ],
};

/** 狂猎骑乘：上马 rounds 回合（当回合不消耗，下一回合起生效；最后一回合为爆发回合） */
function mountWildHunt(game: GameLike, owner: PlayerId, rounds: number): void {
  const st = game.charState(owner);
  st.mounted = true;
  st.mountExpiresRound = game.roundNo + rounds;
  // remainingRounds 交给引擎回合末递减：+1 保证当回合不被立刻扣掉
  game.addStatus(owner, { kind: 'mounted', severity: 0, remainingRounds: rounds + 1 });
  game.log('trigger', `🐎 ${game.players[owner].name} 上马 ${rounds} 回合（骑乘：攻击×2/带位移；最后一回合攻击变为 6 伤单体）`,
    { pid: owner, rounds, expiresRound: st.mountExpiresRound }, true);
}

/**
 * 14. 狂猎（Issue #71）
 *
 * - 血量 4、攻击 1；
 * - 受到**攻击**时与来源猜拳判定（平局重掷直到分出胜负）：
 *   赢 → 抵消本次伤害并反击（未骑乘：反击 1 伤并上马 1 回合；已骑乘：反击改为 6 伤，使用后下马）；
 *   输 → 正常受伤；
 * - 骑乘期间攻击无视距离并带位移（攻击后移动到目标房间）、伤害 ×2；
 *   骑乘的**最后一回合**攻击变为 6 伤单体；
 * - 可消耗一次行动主动上马 2 回合；
 * - 每次击杀敌人后攻击 ×1.5（可叠加）。
 */
const wildHunt: CharDef = {
  id: 'wild-hunt',
  name: '狂猎',
  desc: '血量4、攻击1。受到攻击时与来源猜拳判定（双方亲自出拳，平局重掷直到分出胜负）：赢则抵消本次伤害并反击——未骑乘时反击1伤并上马1回合，已骑乘时反击改为6伤、用后下马；输则正常受伤。骑乘期间攻击无视距离并带位移（攻击后移动到目标房间）、伤害×2；骑乘的最后一回合攻击变为6伤单体（可叠加击杀加成）。可消耗一次行动主动上马2回合。每次击杀敌人后攻击×1.5（可叠加）。',
  hp: 4,
  attack: 1,
  attackType: 'melee',
  attackDesc: '近战攻击同房间目标（伤害 1）；骑乘期间可跨房间突进（攻击后移动到目标房间）、伤害×2，骑乘最后一回合攻击变为 6 伤单体（可叠加击杀加成）',
  traits: ['hunter'],
  init: () => ({ mounted: false, mountExpiresRound: 0, kills: 0 }),
  /** 受击判定：只响应普通攻击（普攻/燃烧箭/操控攻击），不响应燃烧、爆炸、精神攻击等 */
  onBeforeDamage: ({ game, req, owner }) => {
    if (req.target !== owner) return;
    if (!req.isAttack) return;
    if (req.judgeResolved) return; // 判定后补结算：不再触发受击判定
    const source = req.source;
    if (!source || source === owner || !game.players[source]?.alive) return;
    const st = game.charState(owner);
    const self = owner;
    const throwName = (t: string) => (t === 'rock' ? '石头' : t === 'scissors' ? '剪刀' : '布');

    /** 判定成功：本次伤害完全抵消 + 反击（未骑乘 1 伤+上马；已骑乘 6 伤+下马） */
    const parryWin = (detail: string, ties: number) => {
      const mountedNow = st.mounted === true;
      const counterAmount = mountedNow ? 6 : 1;
      game.log('trigger', `⚔ ${game.players[self].name} 受击判定成功：${detail} → 抵消伤害并反击 ${fmtNum(counterAmount)} 点${mountedNow ? '（用后下马）' : '（上马 1 回合）'}`,
        { pid: self, source, counter: counterAmount, mounted: mountedNow, ties }, true);
      game.log('damage', '狂猎反击', { declared: true, source: self, target: source, room: game.players[source].room,
        presentation: { mounted: mountedNow, counter: true } });
      // 反击：无视躲藏/隐身（反击不是普通攻击，不触发对方的受击判定）
      game.applyDamage({
        target: source,
        amount: counterAmount,
        source: self,
        dtype: 'physical',
        tag: 'counter',
        ignoreHide: true,
      });
      if (mountedNow) game.removeStatus(self, 'mounted');
      else mountWildHunt(game, self, 1);
    };

    if (game.rules.skillJudgeMode === 'serverRoll') {
      // 即时结算（AI 对局 / 测试场）：平局重掷，直到分出胜负（安全上限防死循环）
      let result: 'win' | 'lose' | 'tie' = 'tie';
      let ties = 0;
      let guard = 0;
      let last = { a: 'rock', b: 'rock' };
      while (result === 'tie' && guard++ < 50) {
        const roll = game.rollJudgeThrows(self, source);
        last = { a: roll.a, b: roll.b };
        result = roll.result;
        if (result === 'tie') ties++;
      }
      const detail = `狂猎 ${throwName(last.a)} vs ${throwName(last.b)}${ties > 0 ? `（平局重掷 ${ties} 次）` : ''}`;
      if (result !== 'win') {
        game.log('trigger', `⚔ ${game.players[self].name} 受击判定失败：${detail} → 正常受伤`, { pid: self, source, result, ties }, true);
        return; // 正常承伤
      }
      parryWin(detail, ties);
      return 'skip'; // 本次攻击伤害被完全抵消
    }

    // player 模式（对局默认）：挂起本次伤害，双方**亲自出拳**；平局自动重赛（再来一把）
    req.judgeResolved = true;
    game.log('trigger', `⚔ ${game.players[self].name} 受到 ${game.players[source].name} 攻击，进入受击判定（双方亲自出拳，平局再来一把）`,
      { pid: self, source, isAttack: true }, true);
    return {
      deferTo: {
        kind: 'wildhunt',
        owner: self,
        opponent: source,
        rounds: 1,
        rerollTie: true,
        label: '狂猎受击判定',
        resolve: (wins: number) => {
          if (wins > 0) {
            parryWin('猜拳胜利', 0);
            return;
          }
          game.log('trigger', `⚔ ${game.players[self].name} 受击判定失败 → 正常受伤`, { pid: self, source }, true);
          game.applyDamage(req); // req.judgeResolved 已置 true，补结算不会再触发判定
        },
      },
    };
  },
  onAttackAction: ({ game, actor }, targetId) => {
    const p = game.getPlayer(actor);
    const target = game.players[targetId];
    if (!target?.alive) return { ok: false, error: '目标已淘汰' };
    if (targetId === actor) return { ok: false, error: '不能攻击自己' };
    const st = game.charState(actor);
    const mounted = st.mounted === true;
    if (!mounted && !game.isSameRoom(actor, targetId)) {
      return { ok: false, error: '未骑乘时只能近战同房间目标' };
    }
    if (target.hidden || target.invisible) return { ok: false, error: '目标正在躲藏/隐身，无法锁定' };

    const fromRoom = p.room;
    if (mounted) p.room = target.room; // 攻击带位移：突进到目标房间
    const expires = typeof st.mountExpiresRound === 'number' ? st.mountExpiresRound : 0;
    const finalRound = mounted && game.roundNo >= expires;
    const kills = typeof st.kills === 'number' ? st.kills : 0;
    const cd = game.charDef(actor);
    // 击杀加成 1.5^kills；骑乘 ×2；骑乘最后一回合 6 伤单体（同样吃击杀加成）
    const amount = finalRound
      ? Math.round(6 * Math.pow(1.5, kills) * 10000) / 10000
      : Math.round((cd.attack ?? 1) * (mounted ? 2 : 1) * Math.pow(1.5, kills) * 10000) / 10000;
    game.log('damage', `🌪 ${p.name} ${mounted ? (finalRound ? '在骑乘最后一回合发动致命冲锋' : '骑乘突进') : '攻击'} ${target.name}（伤害 ${fmtNum(amount)}${mounted ? '，位移至目标房间' : ''}）`,
      { pid: actor, declared: true, source: actor, target: targetId, amount, mounted, finalRound, room: target.room,
        presentation: { mounted, fromRoom, toRoom: target.room } }, true);
    const applied = game.applyDamage({
      target: targetId,
      amount,
      source: actor,
      dtype: cd.attackDtype || 'physical',
      isAttack: true,
    });
    if (!applied.missed && !applied.deferred && applied.finalTarget !== actor) {
      cd.onAttackLanded?.({ game, actor, target: applied.finalTarget });
    }
    return { ok: true };
  },
  aiStrategy: ({ game, pid, alive, st }) => {
    if (st.mounted !== true) return { type: 'mount' };
    const target = alive
      .filter((p) => p !== pid && !(game.players[p].hidden || game.players[p].invisible))
      .sort((a, b) => game.players[a].hp - game.players[b].hp)[0];
    return target ? { type: 'attack', targetId: target } : undefined;
  },
  onKill: ({ game, killer }) => {
    const st = game.charState(killer);
    const kills = (typeof st.kills === 'number' ? st.kills : 0) + 1;
    st.kills = kills;
    const mult = Math.pow(1.5, kills);
    game.log('trigger', `🩸 ${game.players[killer].name} 击杀敌人，攻击提升至 ×${fmtNum(mult)}（可叠加）`, { pid: killer, kills, mult }, true);
  },
  actions: [
    {
      name: 'mount',
      label: '上马',
      desc: '消耗本次行动主动上马 2 回合：骑乘期间攻击无视距离并带位移、伤害×2；骑乘最后一回合攻击变为 6 伤单体。',
      targetHint: 'none',
      validate: (ctx) => (ctx.game.hasStatus(ctx.actor, 'mounted') ? '已经处于骑乘中' : null),
      execute: (ctx) => { mountWildHunt(ctx.game, ctx.actor, 2); },
    },
  ],
};

type WaterSnakeState = {
  /** 高塔所在的原房间（null = 未建成） */
  towerBaseRoom: string | null;
  /** 高塔剩余耐久（建成时 6，归零坍塌） */
  towerHp: number;
  /** 造塔进度：0/1/2 */
  buildProgress: number;
  /** 是否位于高塔内部 */
  inTower: boolean;
  /** 死后化为亡魂：不可被攻击，仍参与猜拳并使用吸/吹 */
  posthumous: boolean;
};

function waterSnakeState(game: GameLike, pid: PlayerId): WaterSnakeState {
  return game.charState(pid) as unknown as WaterSnakeState;
}

/** 行动目标（兼容单目标 targetId 与多目标 targetIds） */
function actionTargetIds(req: { targetId?: PlayerId; targetIds?: PlayerId[] }): PlayerId[] {
  return [...new Set([...(req.targetIds ?? []), ...(req.targetId ? [req.targetId] : [])])];
}

/** 高塔坍塌：塔内所有玩家被弹出塔外，塔回到未建造状态 */
function collapseTower(game: GameLike, owner: PlayerId): void {
  const st = waterSnakeState(game, owner);
  const base = st.towerBaseRoom;
  if (!base) return;
  for (const pid of game.playerIds) {
    if (game.players[pid].char.inTower === true && game.players[pid].room === base) {
      game.players[pid].char.inTower = false;
      game.log('trigger', `🗼 高塔坍塌：${game.players[pid].name} 被弹出塔外`, { pid, tower: base }, true);
    }
  }
  st.towerBaseRoom = null;
  st.towerHp = 0;
  st.buildProgress = 0;
  st.inTower = false;
  game.log('trigger', `🗼 ${base} 的玄武岩高塔坍塌！`, { tower: base }, true);
}

/**
 * 15. 飞天水螅（Issue #71）
 *
 * - 血量 3、攻击 1.5；
 * - 消耗一次行动造玄武岩高塔（需 2 次行动造完）：塔内外隔绝、算作新房间（塔 6 点耐久，暂不可被摧毁）；
 * - 自身与敌人同处塔内时，敌人行动前须判定：胜→正常行动、平→本次行动无效、负→攻击自己；
 * - 吸/吹各消耗一次行动：
 *   吸 = 其他房间→自己房间 / 自己房间→塔内；吹 = 塔内或自己房间→指定其他房间；
 * - 死后化为亡魂：不可被攻击，仍参与猜拳、可使用吸/吹。
 */
const waterSnake: CharDef = {
  id: 'water-snake',
  name: '飞天水螅',
  desc: '血量3、攻击1.5。消耗一次行动在当前房间造玄武岩高塔（需2次行动造完）：塔内外隔绝、算作新房间。自身与敌人同处塔内时，敌人行动前须判定——胜则正常行动、平局本次不行动、输了攻击自己。吸/吹各消耗一次行动：吸把其他房间的敌人吸到自己房间、再吸进塔内；吹把塔内或自己房间的敌人统一吹到指定的其他房间。死后化为亡魂：不可被攻击，仍参与猜拳并使用吸/吹。',
  hp: 3,
  attack: 1.5,
  attackType: 'melee',
  attackDesc: '近战攻击同房间目标（伤害 1.5）；高塔内外隔绝，无法直接攻击塔壁另一端的目标',
  traits: ['tower'],
  init: () => ({ towerBaseRoom: null, towerHp: 0, buildProgress: 0, inTower: false, posthumous: false }),
  /** 亡魂免疫：化为亡魂后不再受到伤害（也避免了被反复击杀） */
  onBeforeDamage: ({ game, req, owner }) => {
    if (req.target !== owner) return;
    const st = waterSnakeState(game, owner);
    if (st.posthumous === true) return 'skip';
  },
  /** 首次致死 → 化为亡魂（不死亡，继续参与对局） */
  onLethalDamage: ({ game, player }) => {
    const st = waterSnakeState(game, player);
    const p = game.getPlayer(player);
    if (st.posthumous === true) {
      p.hp = 0;
      return 'prevent';
    }
    st.posthumous = true;
    p.hp = 0;
    p.invisible = true;
    game.log('trigger', `👻 ${p.name} 被杀后化为亡魂：不可被攻击，仍参与猜拳并使用吸/吹`, { pid: player, posthumous: true }, true);
    return 'prevent';
  },
  /** 亡魂状态只能使用吸/吹（或跳过） */
  validateAction: ({ game, player, action }) => {
    const st = waterSnakeState(game, player);
    if (st.posthumous !== true) return null;
    if (action.type === 'inhale' || action.type === 'blow' || action.type === 'skip') return null;
    return '亡魂状态只能使用吸/吹（或跳过）';
  },
  /** 塔内压制：与飞天水螅同处塔内的敌人行动前须判定（胜=正常、平=无效、负=打自己） */
  onBeforeAction: ({ game, owner, player }) => {
    if (!game.players[owner]?.alive) return;
    const snake = waterSnakeState(game, owner);
    if (snake.towerBaseRoom == null || snake.inTower !== true) return;
    const actor = game.players[player];
    if (actor.char.inTower !== true) return;
    if (actor.room !== snake.towerBaseRoom) return;

    // player 模式（对局默认）：双方亲自出拳，判定结束后再由引擎继续本次行动
    if (game.rules.skillJudgeMode !== 'serverRoll') {
      return {
        judge: { kind: 'tower', owner, opponent: player, rounds: 1, label: '塔内压制判定' },
        onResult: (result: 'win' | 'lose' | 'tie') => (result === 'win' ? 'selfAttack' : result === 'lose' ? 'normal' : 'block'),
      };
    }

    // serverRoll（AI 对局/测试场）：即时单掷，不重掷
    const throwName = (t: string) => (t === 'rock' ? '石头' : t === 'scissors' ? '剪刀' : '布');
    const roll = game.rollJudgeThrows(player, owner); // 敌人视角：win=敌人胜
    const detail = `${actor.name} ${throwName(roll.a)} vs ${game.players[owner].name} ${throwName(roll.b)}`;
    if (roll.result === 'win') {
      game.log('trigger', `🗼 塔内判定：${detail} → ${actor.name} 正常行动`, { pid: player, owner, ...roll }, true);
      return;
    }
    if (roll.result === 'tie') {
      game.log('trigger', `🗼 塔内判定：${detail} → 平局，${actor.name} 本次行动无效`, { pid: player, owner, ...roll }, true);
      return 'block';
    }
    game.log('trigger', `🗼 塔内判定：${detail} → ${actor.name} 输了，攻击自己`, { pid: player, owner, ...roll }, true);
    return 'selfAttack';
  },
  /** 为同房间的其他玩家提供「攻击高塔」环境行动（塔内、塔外都能打） */
  extraActionsForOthers: ({ game, owner, viewer }) => {
    const snake = waterSnakeState(game, owner);
    if (snake.towerBaseRoom == null) return [];
    if (game.players[viewer]?.room !== snake.towerBaseRoom) return [];
    const base = snake.towerBaseRoom;
    return [{
      name: 'attackTower',
      label: '攻击高塔',
      desc: `消耗本次行动攻击 ${base} 的玄武岩高塔（当前 ${fmtNum(typeof snake.towerHp === 'number' ? snake.towerHp : 0)}/6 血）；塔血归零会坍塌，塔内玩家被弹出。`,
      typeLabel: '环境',
      targetHint: 'none',
      validate: (ctx) => {
        const st = waterSnakeState(ctx.game, owner);
        if (st.towerBaseRoom == null) return '高塔已经不存在';
        if (ctx.game.players[ctx.actor].room !== st.towerBaseRoom) return '需要与高塔同房间';
        return null;
      },
      execute: (ctx) => {
        const st = waterSnakeState(ctx.game, owner);
        const baseRoom = st.towerBaseRoom;
        if (!baseRoom) return;
        const def = ctx.game.charDef(ctx.actor);
        const amount = def.meleeDamage ?? def.attack ?? ctx.game.rules.defaultAttack;
        const before = typeof st.towerHp === 'number' ? st.towerHp : 0;
        st.towerHp = Math.max(0, Math.round((before - amount) * 10000) / 10000);
        ctx.game.log('damage', `🗼 ${ctx.game.players[ctx.actor].name} 攻击高塔：${fmtNum(before)} → ${fmtNum(st.towerHp)} 血`,
          { pid: ctx.actor, tower: baseRoom, hp: st.towerHp }, true);
        if (st.towerHp <= 0) collapseTower(ctx.game, owner);
      },
    }];
  },
  aiStrategy: ({ game, pid, alive, st }) => {
    const snake = st as unknown as WaterSnakeState;
    const visible = alive.filter((p) => p !== pid && !(game.players[p].hidden || game.players[p].invisible));
    if (snake.posthumous === true || snake.towerBaseRoom != null) {
      const outsider = visible.find((p) => game.players[p].room === game.players[pid].room && game.players[p].char.inTower !== true);
      if (outsider) return { type: 'inhale', targetId: outsider };
      const insider = visible.find((p) => game.players[p].char.inTower === true);
      const destination = game.roomIds.find((room) => room !== game.players[pid].room);
      if (insider && destination) return { type: 'blow', targetId: insider, room: destination };
      if (visible[0]) return { type: 'inhale', targetId: visible[0] };
      return undefined;
    }
    return { type: 'buildTower' };
  },
  actions: [
    {
      name: 'buildTower',
      label: '造玄武岩高塔',
      desc: '消耗本次行动建造高塔（需 2 次行动造完）：塔内外隔绝、算作新房间；建成后自身进入塔内。',
      targetHint: 'none',
      validate: (ctx) => {
        const st = waterSnakeState(ctx.game, ctx.actor);
        if (st.towerBaseRoom != null) return '高塔已经建成';
        if (st.posthumous === true) return '亡魂状态无法造塔';
        return null;
      },
      execute: (ctx) => {
        const st = waterSnakeState(ctx.game, ctx.actor);
        const p = ctx.game.getPlayer(ctx.actor);
        st.buildProgress += 1;
        if (st.buildProgress < 2) {
          ctx.game.log('action', `🗼 ${p.name} 开始建造玄武岩高塔（1/2，需再消耗一次行动）`, { pid: ctx.actor, progress: 1 }, true);
          return;
        }
        st.buildProgress = 2;
        st.towerBaseRoom = p.room;
        st.towerHp = 6;
        st.inTower = true;
        ctx.game.log('trigger', `🗼 ${p.name} 在 ${p.room} 建成玄武岩高塔并进入塔内（塔内外隔绝、算作新房间）`,
          { pid: ctx.actor, room: p.room, towerBaseRoom: p.room }, true);
      },
    },
    {
      name: 'inhale',
      label: '吸',
      desc: '消耗本次行动，把一名或多名敌人吸近一格：其他房间 → 自己房间；自己房间 → 高塔内部。',
      targetHint: 'anyPlayer',
      multiTarget: true,
      validate: (ctx) => {
        const st = waterSnakeState(ctx.game, ctx.actor);
        const ids = actionTargetIds(ctx.params);
        const p = ctx.game.getPlayer(ctx.actor);
        if (ids.length === 0) return '请选择至少一个目标';
        for (const targetId of ids) {
          const target = ctx.game.players[targetId];
          if (!target?.alive) return '目标不存在或已淘汰';
          if (targetId === ctx.actor) return '不能吸自己';
          if (target.hidden || target.invisible) return '无法锁定躲藏/隐身的玩家';
          if (target.char.inTower === true) return '目标已经在塔内';
          if (target.room === p.room && (st.towerBaseRoom == null || st.towerBaseRoom !== p.room)) {
            return '当前房间没有高塔，无法把人吸进塔内';
          }
        }
        return null;
      },
      execute: (ctx) => {
        const ids = actionTargetIds(ctx.params);
        const p = ctx.game.getPlayer(ctx.actor);
        const moves: { pid: string; fromRoom: string; toRoom: string; tower?: 'enter' | 'exit' }[] = [];
        for (const targetId of ids) {
          const target = ctx.game.players[targetId];
          if (!target) continue;
          if (target.room !== p.room) {
            const from = target.room;
            target.room = p.room;
            moves.push({ pid: targetId, fromRoom: from, toRoom: p.room });
            ctx.game.log('trigger', `🌀 ${p.name} 一吸：${target.name} 被从 ${from} 吸到 ${p.room}（拉近一格）`, { pid: targetId, source: ctx.actor, from, to: p.room }, true);
            continue;
          }
          target.char.inTower = true;
          moves.push({ pid: targetId, fromRoom: target.room, toRoom: target.room, tower: 'enter' });
          ctx.game.log('trigger', `🌀 ${p.name} 一吸：${target.name} 被吸进高塔内部（塔内外隔绝）`, { pid: targetId, source: ctx.actor }, true);
        }
        ctx.present?.({ targetIds: ids, moves });
      },
    },
    {
      name: 'blow',
      label: '吹',
      desc: '消耗本次行动，把一名或多名塔内或同房间敌人统一吹到指定的其他房间。',
      targetHint: 'sameRoomOrTowerPlayer',
      roomHint: true,
      roomExcludeCurrent: true,
      multiTarget: true,
      validate: (ctx) => {
        const ids = actionTargetIds(ctx.params);
        const p = ctx.game.getPlayer(ctx.actor);
        const destination = ctx.params.room;
        if (!destination) return '请选择吹飞落点房间';
        if (!ctx.game.roomIds.includes(destination)) return '吹飞落点房间不存在';
        if (destination === p.room) return '吹飞落点不能是当前房间';
        if (ids.length === 0) return '请选择至少一个目标';
        for (const targetId of ids) {
          const target = ctx.game.players[targetId];
          if (!target?.alive) return '目标不存在或已淘汰';
          if (targetId === ctx.actor) return '不能吹自己';
          if (target.hidden || target.invisible) return '无法锁定躲藏/隐身的玩家';
          if (target.room !== p.room) return '只能吹塔内或自己房间里的敌人';
        }
        return null;
      },
      execute: (ctx) => {
        const ids = actionTargetIds(ctx.params);
        const p = ctx.game.getPlayer(ctx.actor);
        const destination = ctx.params.room as string;
        const moves: { pid: string; fromRoom: string; toRoom: string; tower?: 'enter' | 'exit' }[] = [];
        for (const targetId of ids) {
          const target = ctx.game.players[targetId];
          if (!target) continue;
          const from = target.room;
          const wasInTower = target.char.inTower === true;
          target.char.inTower = false;
          target.room = destination;
          moves.push({ pid: targetId, fromRoom: from, toRoom: destination, ...(wasInTower ? { tower: 'exit' as const } : {}) });
          ctx.game.log('trigger', `🌪 ${p.name} 一吹：${target.name} 被从 ${wasInTower ? '塔内' : from} 吹到 ${destination}`, { pid: targetId, source: ctx.actor, from, to: destination, tower: wasInTower ? 'exit' : undefined }, true);
        }
        ctx.present?.({ targetIds: ids, room: destination, moves });
      },
    },
  ],
};

export const CHARACTERS: Record<string, CharDef> = {
  default: defaultChar,
  bagun,
  chuixiao,
  gojo,
  laodaye,
  mabaoguo,
  wuliuqi,
  'ivan-girl': xiaonuhai,
  'hero-today': jinriyongzhe,
  dajianke,
  dapihuai,
  'hunchback-archer': hunchbackArcher,
  ghost,
  'wild-hunt': wildHunt,
  'water-snake': waterSnake,
};

export const CHARACTER_LIST: CharDef[] = Object.values(CHARACTERS);
