/**
 * 拔典 · 角色卡素材与文案映射
 * 卡面立绘来自用户提供的原创 9 角色卡（游戏王风格，client/public/cards/）。
 */

export interface CardMeta {
  /** 卡面大图（webp，440×760） */
  img?: string;
  /** 缩略图（高360） */
  thumb?: string;
  /** 卡号 No.01~09 */
  no: string;
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
    mech: '普攻1。受到伤害时判定，判定赢则原伤反弹；闪电五连鞭5场判定按胜次扣血；不讲武德死后5局赢3以精神攻击（无视躲藏/命数，不可反弹）带走对面。',
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
  dapihuai: {
    img: './cards/dapihuai.webp', thumb: './cards/dapihuai-thumb.webp', no: '09',
    skills: '【连判】·【暴走】·【自爆】',
    mech: '血量20、攻击0。跨回合记住每次判定：连续三次不同 → 回合最前暴走，本人指定任意玩家（精神攻击·秒杀·无视躲藏/命数）；连续三次相同 → 回合最前自爆。多人同时暴走先二次判定排序。',
    quote: '赢赢赢我炸，赢平输我更炸。',
  },
};

export function cardMeta(charId: string): CardMeta | undefined {
  return CARD_META[charId];
}

/** 大厅角色选择用缩略图 */
export function thumbOf(charId: string): string | undefined {
  return CARD_META[charId]?.thumb;
}
