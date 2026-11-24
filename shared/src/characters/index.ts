/**
 * 拔典 · 角色注册表
 * 9 个首轮验证角色 + 老大爷（领域覆盖验证用）+ 默认角色（无业游民）
 *
 * 数据来源：docs/角色速查表-原始数据.md（拔典1/拔典2 OCR 整理表）
 * OCR 存疑或资料缺失处均在 desc/dataMissing 中标注，并写入 docs/GAME_RULES.md 规则假设。
 */

import { characterAi } from './ai-strategies.js';
import type { CharDef } from '../chardef.js';
import { mentalKill } from '../mental.js';
import { fmtNum } from '../types.js';

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
  name: '老大爷',
  desc: '血量3。近战3伤远程2伤；领域展开后平局回合可行动（平局结果不变）、近战5伤远程3伤。领域全场唯一，与五条悟的领域互相覆盖（后展开者生效）。',
  hp: 3,
  attack: 3,
  meleeDamage: 3,
  rangedDamage: 2,
  attackType: 'both',
  rangedCapable: true,
  domainActsOnTie: true,
  init: () => ({ domain: false, boosted: false }),
  dynamicDamage: ({ game, actor, ranged }) => {
    const st = game.charState(actor);
    if (st.domain === true && st.boosted === true) return ranged ? 3 : 5;
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
    {
      name: 'boostAttack',
      label: '领域强化',
      desc: '领域内近战5伤/远程3伤（开关）。',
      targetHint: 'none',
      validate: (ctx) => ctx.game.charState(ctx.actor).domain ? null : '需先展开领域',
      execute: (ctx) => {
        const st = ctx.game.charState(ctx.actor);
        st.boosted = !st.boosted;
        ctx.game.log('trigger', `${ctx.game.getPlayer(ctx.actor).name} ${st.boosted ? '强化' : '取消强化'}领域攻击（近5/远3）`, undefined, true);
      },
    },
  ],
};

/** 4. 马保国：混元形意太极（受伤判定反弹）、闪电五连鞭、不讲武德 */
const mabaoguo: CharDef = {
  id: 'mabaoguo',
  aiStrategy: characterAi.mabaoguo,
  name: '马保国',
  desc: '血量4攻击1。混元形意太极：除大伊万爆、肉山坐外，受到伤害时与来源各出一拳判定，赢则原伤反弹（可选）。闪电五连鞭：对同房间敌人进行5局判定（双方各出5拳），按胜次造成其**当前血量** 20/40/60/80/100% 的伤害（单次总量）。不讲武德：被击杀后与击杀者进行5局判定，赢3局则以精神攻击带走对面（同时死亡）。',
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
      desc: '对同房间一名敌人进行5局判定（双方各出5拳），按胜次造成其「当前血量」20/40/60/80/100% 的伤害（单次总量）。',
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
          for (let i = 1; i <= 5; i++) {
            if (game.rollJudge(actor, t, `五连鞭第${i}鞭`) === 'win') wins++;
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

/** 5. 伍六七（五六七）：3段AOE，每段对攻击时所在房间所有玩家造成1伤，段独立结算 */
const wuliuqi: CharDef = {
  id: 'wuliuqi',
  aiStrategy: characterAi.firstInRoom,
  name: '伍六七',
  desc: '血量3。攻击为3段AOE：每段对攻击发动时所在房间内所有玩家（默认不含自己）造成1伤；释放房间固定为攻击时所在房间；每段独立结算。',
  hp: 3,
  attack: 1,
  attackType: 'both',
  init: () => ({ hitSelf: false }),
  onAttackAction: (ctx, targetId) => {
    const game = ctx.game;
    const actor = ctx.actor;
    if (!game.isSameRoom(actor, targetId)) {
      return { ok: false, error: '伍六七的AOE以当前房间为释放房间，需指定同房间目标确认释放' };
    }
    const st = game.charState(actor);
    const room = game.getPlayer(actor).room;
    const targets = game.roomMembers(room).filter((pid) => {
      if (pid === actor && st.hitSelf !== true) return false;
      return true;
    });
    game.log('damage', `⚔️ 伍六七释放三段AOE！释放房间 ${room}（攻击时固定），目标：${targets.map((pid) => game.players[pid].name).join('、') || '无'}`, undefined, true);
    const aoeGroup = game.nextGroupId();
    for (let seg = 1; seg <= 3; seg++) {
      for (const pid of targets) {
        if (!game.players[pid].alive) continue; // 每段独立结算，段间死亡不再受击
        game.applyDamage({
          target: pid,
          amount: 1,
          source: actor,
          dtype: 'physical',
          aoe: true,
          segment: { index: seg, total: 3 },
          tag: 'wuliuqi-aoe',
          groupId: aoeGroup,
        });
        if (game.isOver()) return { ok: true };
      }
    }
    return { ok: true };
  },
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
  desc: '血量3攻击2（初始面板）。技能「抽取今日运势」：掷 0-9 随机数——0/1 直接暴毙；2/3→血1攻1；4/5→血3攻1；6→血4攻2；7→血5攻3；8→血6攻4；9→血6攻6。全局仅可使用一次，不限回合。',
  hp: 3,
  attack: 2,
  attackType: 'melee',
  init: () => ({ attackOverride: undefined as number | undefined, fortuneUsed: false }),
  /** 运势转换后的攻击力覆盖（仅近战；未抽取时用基础攻击2） */
  dynamicDamage: ({ game, actor, ranged }) => {
    const st = game.charState(actor);
    if (!ranged && typeof st.attackOverride === 'number') return st.attackOverride;
    return undefined;
  },
  actions: [
    {
      name: 'rollFortune',
      label: '抽取今日运势',
      desc: '掷 0-9 随机数转换面板：0/1 暴毙；2/3→血1攻1；4/5→血3攻1；6→血4攻2；7→血5攻3；8→血6攻4；9→血6攻6。全局仅可使用一次，不限回合。',
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
        if (r.death) {
          game.log('trigger', `🎰 今日勇者抽取运势：掷出 ${n} —— 运势极凶，当场暴毙！`, { pid: ctx.actor, fortune: true, roll: n }, true);
          game.eliminate(ctx.actor, 'fortune-death');
          return;
        }
        const before = me.hp;
        me.maxHp = r.hp!;
        me.hp = r.hp!;
        game.charState(ctx.actor).attackOverride = r.atk!;
        game.log('trigger', `🎰 今日勇者抽取运势：掷出 ${n} —— 面板转换：血量 ${before}→${r.hp}，攻击→${r.atk}`, { pid: ctx.actor, fortune: true, roll: n }, true);
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
};

export const CHARACTER_LIST: CharDef[] = Object.values(CHARACTERS);
