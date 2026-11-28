/**
 * 拔典 · 角色卡素材与文案映射
 * 卡面立绘来自用户提供的原创角色卡（游戏王风格，client/public/cards/）。
 * 除入池角色外，还收录了尚未实装入局角色的卡面（Issue #95 四角色图片包）：
 * 这类条目用 name / panel 提供卡面名与面板显示，引擎花名册接入后即自动切换为花名册数据。
 */

export interface CardMeta {
  /** 卡面大图（webp，440×760） */
  img?: string;
  /** 缩略图（高360） */
  thumb?: string;
  /** 卡号 No.01~09 */
  no: string;
  /** 卡面名（仅未入池角色需要；入池角色名以引擎花名册为准） */
  name?: string;
  /** 未入池角色的面板显示（如「HP ? / 攻 1」）；入池角色由花名册推导 */
  panel?: string;
  /** 卡面技能名（文案清单） */
  skills: string;
  /** 机制简述（文案清单） */
  mech: string;
  /** 台词 */
  quote: string;
}

export const CARD_META: Record<string, CardMeta> = {
  default: {
    img: './cards/default.webp', thumb: './cards/default-thumb.webp', no: '09',
    skills: '【无被动】·【默认角色】',
    mech: '无被动、无技能；未选上角色者默认使用此角色。血量2，攻击1（原稿攻击栏为「-」，按默认1处理）。',
    quote: '别人挑剩下的，就站我这儿。',
  },
  laodaye: {
    img: './cards/laodaye.webp', thumb: './cards/laodaye-thumb.webp', no: '58',
    skills: '【近3远2】·【领域展开】·【平局行动】',
    mech: '血量1.5，攻击3。近战3伤、远程2伤（默认免瞄准）；领域展开后即完全体：近战5伤、远程3伤，且平局回合可行动（平局结果不变）。领域全场唯一，与五条悟的领域互相覆盖（后展开者生效，被覆盖后可再展开夺回）。（原稿「完全体领域内远程必中」未实装）',
    quote: '年轻，进了这圈平局归我，近战还得再添两分。',
  },
  bagun: {
    img: './cards/bagun.webp', thumb: './cards/bagun-thumb.webp', no: '01',
    skills: '【未拔】·【洞悉】',
    mech: '须先拔棍，攻击才造成伤害；无视隐身与躲藏，躲到哪儿都照打不误。',
    quote: '棍还没拔，你倒是先藏好了。',
  },
  chuixiao: {
    img: './cards/chuixiao.webp', thumb: './cards/chuixiao-thumb.webp', no: '02',
    skills: '【远音】',
    mech: '只能远程攻击异房间目标，伤害1；无需瞄准，直接选人开吹；贴身近战一概打不出来。',
    quote: '离这么近干嘛，我吹的又不是贴脸曲。',
  },
  gojo: {
    img: './cards/gojo.webp', thumb: './cards/gojo-thumb.webp', no: '03',
    skills: '【无量空处】·【领域展开】',
    mech: '2条命：首次致死消耗一条命并满血复活。近战1伤；远程2伤、需瞄准。领域展开（无量空处）后远程免瞄准，且判定平局（同拳或三种不同出拳的三人循环）时五条悟可在该平局回合行动——平局仍是平局。领域全场唯一，后展开覆盖先展开，被覆盖后可再次展开夺回。',
    quote: '平局？在我领域里，平局也归我出手。',
  },
  mabaoguo: {
    img: './cards/mabaoguo.webp', thumb: './cards/mabaoguo-thumb.webp', no: '04',
    skills: '【混元形意太极】·【闪电五连鞭】',
    mech: '普攻1。受到伤害时判定，判定赢则原伤反弹；闪电五连鞭平局重判、不计局数，累计5次分出胜负后按胜次扣血；不讲武德死后5局赢3以精神攻击（无视躲藏/命数，不可反弹）带走对面。',
    quote: '年轻人不讲武德，来骗来偷袭，这伤原样还你。',
  },
  wuliuqi: {
    img: './cards/wuliuqi.webp', thumb: './cards/wuliuqi-thumb.webp', no: '05',
    skills: '【三段剪】',
    mech: '攻击=立刻前往任意房间，下一回合末在该房间砍出三刀（1×3，不打自己；命中躲藏/隐身）。目标按刀落瞬间的房间成员动态判定，三刀先于大伊万爆炸；蓄力回合不能进行其他行动。',
    quote: '一刀三段，别急着倒，账要一笔一笔算。',
  },
  'ivan-girl': {
    img: './cards/ivan-girl.webp', thumb: './cards/ivan-girl-thumb.webp', no: '06',
    skills: '【延迟引爆】',
    mech: '可向任意房间投掷大伊万，包括自己脚下。扔出当回合引信未开；投掷后第一个分出胜负的回合末爆炸，平局回合顺延不消耗。按爆炸那一刻的房间成员动态判定——躲藏也算，炸完才判胜负（可同归于尽）。',
    quote: '现在跑没用，我等大家散场了才拆礼物。',
  },
  'hero-today': {
    img: './cards/hero-today.webp', thumb: './cards/hero-today-thumb.webp', no: '07',
    skills: '【今日运势】',
    mech: '初始3血攻击1。技能「抽取今日运势」：掷0-9——0/1暴毙；2/3血1攻1；4/5血3攻1；6血4攻2；7血5攻3；8血6攻4；9血6攻6。变身即满血（当前血量=新上限），并给出运势反馈；不限回合，全局一次。',
    quote: '今天勇不勇，第一回合见分晓。',
  },
  dajianke: {
    img: './cards/dajianke.webp', thumb: './cards/dajianke-thumb.webp', no: '08',
    skills: '【转嫁】·【嘴臭】',
    mech: '被动只转移伤害（含范围与延迟伤害，不转状态与控制；精神伤害不转）。辱骂是精神攻击：无视距离、躲藏与命数，同一目标累计三次直接击杀。',
    quote: '伤害你替我挨，附加状态你自己留着。',
  },
  'slot-hero': {
    img: './cards/slot-hero.webp', thumb: './cards/slot-hero-thumb.webp', no: '106',
    skills: '【抽老虎机】·【钥匙封印】·【炸弹】',
    mech: '初始4血攻击0，开局5块钱（唯一持有货币的角色）。消耗一次行动抽老虎机：5块抽4格 / 1块抽3格；数字→0钥匙、1–3金钱、4–7炸弹、8–9攻击，同种符号2/3/4个触发奖励。钱花光后可扔出老虎机，第3回合末落地砸出累计投入伤害，之后同房间可踹机+1块。',
    quote: '再拉一次，这回一定是四个炸弹。',
  },
  dapihuai: {
    img: './cards/dapihuai.webp', thumb: './cards/dapihuai-thumb.webp', no: '09',
    skills: '【连判】·【暴走】·【自爆】',
    mech: '血量20、攻击0。跨回合记住每次判定：连续三次不同 → 回合最前暴走，本人指定任意玩家（精神攻击·秒杀·无视躲藏/命数）；连续三次相同 → 回合最前自爆。多人同时暴走先二次判定排序。',
    quote: '赢赢赢我炸，赢平输我更炸。',
  },
  'hunchback-archer': {
    no: '—',
    skills: '【燃烧箭】·【骷髅身躯】·【箭袋】',
    mech: '远程攻击 1 伤并点燃（每回合 0.5，无限持续，直到目标消耗一次行动扑灭；可打同房间）。精神/燃烧之外的伤害致死不会死亡：完整缺席 1 回合（仍参与猜拳）后以半血复原；燃烧致死才彻底死亡；无法主动回复。同房间燃烧者能引燃它；同房间敌人可花 2 次行动取燃烧箭、再花 1 次行动近战（1 伤+点燃，攻击一次后失效），取箭途中被它攻击会中断。',
    quote: '骨头会散，箭不会。',
  },
  ghost: {
    img: './cards/ghost.webp', thumb: './cards/ghost-thumb.webp', no: '36',
    skills: '【附身】·【折磨】·【操控】·【主动脱离】',
    mech: '血量2、普攻1.5；单次受伤最多0.5，精神秒杀可无视上限。免疫燃烧，无法主动回复。花一次行动移到目标所在房间并附身，期间随宿主移动，无法普攻、独立移动或躲藏。宿主每回合受到1点吸血伤害（附身当回合跳过），鬼影可额外折磨或操控宿主。鬼影可主动脱离，宿主也可驱逐，两者都消耗一次行动。',
    quote: '你以为你在走，其实是我在走。',
  },
  'wild-hunt': {
    img: './cards/wild-hunt.webp', thumb: './cards/wild-hunt-thumb.webp', no: '69',
    skills: '【受击判定】·【骑乘突进】·【猎杀成长】',
    mech: '血量4、攻击1。受到攻击时与来源**亲自出拳**判定（平局再来一把，直到分出胜负）：赢则抵消伤害并反击——未骑乘反击1伤+上马1回合，已骑乘反击改为6伤、用后下马；输则正常受伤（燃烧/爆炸/精神攻击不触发）。骑乘期间攻击无视距离并带位移、伤害×2，最后一回合攻击变为6伤单体（可叠加击杀加成）；可花一次行动主动上马2回合。每次击杀敌人后攻击×1.5（可叠加）。',
    quote: '追到天涯，也只是我马蹄下的一步。',
  },
  'water-snake': {
    img: './cards/water-snake.webp', thumb: './cards/water-snake-thumb.webp', no: '73',
    skills: '【玄武岩高塔】·【吸/吹】·【亡魂】',
    mech: '血量3、攻击1.5，无法主动回复。消耗一次行动造玄武岩高塔（需2次行动，塔6血）：建成后自动进入塔内，塔内外隔绝、算作新房间；高塔吸收所在房间的房间级伤害（含大伊万爆炸），塔内玩家不受该次效果伤害，塔血归零坍塌并弹出塔内玩家。塔内外的同房间玩家都可攻击高塔。与敌人同处塔内时，敌人行动前双方亲自出拳判定——胜则正常行动、平局本次无效、输了攻击自己。吸/吹各消耗一次行动、可指定多个目标，每人只移动一格：吸=其他房间→自己房间 / 自己房间→塔内；吹=塔内→自己房间 / 自己房间→其他房间。死后化为亡魂：不可被攻击，仍参与猜拳并使用吸/吹。',
    quote: '塔里塔外，都是我的水。',
  },
  // 未实装入局角色：卡面先行收录（Issue #95 飞天水蛭双形态——水蛭 Q 版）。
  // 文案按《飞天水蛭_Q版文案清单》照录；入册实装后以花名册数据为准。
  leech: {
    img: './cards/leech.webp', thumb: './cards/leech-thumb.webp', no: '70',
    name: '水蛭', panel: 'HP ? / 攻 -',
    skills: '【多根缠吸】·【禁疗】·【收舌回满】',
    mech: '攻击吐舌头缠绕敌人，每回合造成 1 伤，可吐多根；无法回血；收回舌头（含尸体）时回满。原稿未标血量与攻击，卡面按 HP ? 显示（Q 版衍生卡：机制与数值沿用第 6 批精修版，不覆盖原版卡）。',
    quote: '缠几根是几根，收回来那一口，连尸体都算补。',
  },
};

export function cardMeta(charId: string): CardMeta | undefined {
  return CARD_META[charId];
}

/** 大厅角色选择用缩略图 */
export function thumbOf(charId: string): string | undefined {
  return CARD_META[charId]?.thumb;
}

/** 未入池（引擎花名册之外）但已收录卡面的角色 id——卡池墙补位展示用 */
export function extraCardIds(rosterIds: Iterable<string>): string[] {
  const inRoster = new Set(rosterIds);
  return Object.keys(CARD_META).filter((id) => !inRoster.has(id));
}
