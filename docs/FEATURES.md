# 拔典 · 功能与实现细节

> README 只保留上手与总览；这里存放各功能的实现细节、参数表和验收记录。

## 局外功能对规则的影响

战绩、丢番茄互动（以及暂未启用的回放）均为**只读观察层**，不进入判定：

- 战绩字段由引擎在结算时累计（`PlayerStats`），只做展示，不参与任何伤害/胜负计算
- 互动事件只走广播通道，不写 `game.logs`、不改 hp、不占行动次数
- 回放（暂未启用）是「状态帧录制」——服务端在状态签名变化时记一帧（每局上限 1500 帧、每房间保留最近 5 局），播放端只渲染帧，不回放隐藏出拳（`reveal` 字段始终来自已结算记录）

## 操作与超时

- **自身技能不需要选目标**：`targetHint: 'none'` 的技能（领域展开 / 抽取今日运势 / 领域强化 / 拔棍开关）选中后，确认条只剩「已选【技能】· 确认发动 · 取消」，不再要求点战场高亮卡牌，「确认发动」也不会因为没有目标而置灰。只有指向性技能（攻击 / 瞄准 / 找出来 / 五连鞭 / 投掷大伊万）才需要选目标或房间。
- **超时只在「有人等」时生效**：出拳 30s 代掷、行动 45s 跳过（可配置），但**仅当房间内有 ≥2 名真人**才布防。单人 vs AI 没有超时这回事——AI 是即时应答的，没有任何人在等你，你的回合不会被系统代掷或自动跳过；单设备多人（同一块屏幕）同样不布防。
- **AI 永不卡局**：AI 决策本身走「候选行动链」（非法就换下一个，最差 `skip`）；房间另有 1.2s 的 AI 看门狗，只要还停在该 AI 出拳/行动，就补驱动一次——它只驱动 AI、绝不替真人操作，因此取消超时也不会让对局僵死。
- **同一房间连打多局**：重开时战斗日志清空重来（服务端下发 `gameNo`，客户端据此清空），日志序号 `seq` 整个房间内单调递增（不随每局归零），因此第二局之后增量推送与去重都正常，不会出现「第二局日志不再更新」。

## 全局播报（每个动作都可见 + 反馈时间）

> 不用再翻日志找「刚才谁干了什么」。

一条链路：**引擎日志 → `shared/src/announce.ts` 规则表 → `AnnounceItem` → 服务端一次广播（所有座位同一份）→ 战场横幅 + 「📣 播报」抽屉**。

- **每个动作都可见**：攻击 / 技能 / 瞄准 / 躲藏 / 找出来 / 跳过 / 移动 / 回复 / 喝牛奶 / 今日运势 / 淘汰 / 复活 / 领域 / 大伊万 / 判定 / 行动顺序 / 回合小结 / 终局全部有播报；未知的新日志类型由 `fallback` 兜底——不存在「引擎写了日志但没人看见」。
- **有反馈时间**：每条播报带 `ts`（服务端生成时刻）与 `ttlMs`（横幅停留时长）。横幅显示 `HH:MM:SS`（房间时间线）并在右侧标注停留秒数；抽屉每行是「时间 · 图标 · 文本 · 停留时长」，可切「⭐ 重点」只看战斗/淘汰类。
- **重要信息 vs 次要信息（V2）**：**移动 / 攻击 / 技能 / 回血 / 躲藏**是重要信息（`priority: high`，横幅必播、拥堵保留、时长上调）；**胜负 / 回合 / 阶段 / 顺序 / 未命中**是次要信息（`priority: low`，只进抽屉、时长缩短）；淘汰 / 领域 / 复活 / 致命仍是最高规格的重大瞬间。详见下方[信息分级与时长](#信息分级与时长v2)。
- **不同类型的视觉表现不同**：每条播报带 `kind` 字段（8 类），横幅与抽屉按类型给出不同的形状、配色与动效——攻击=红色尖角+红光、技能=紫色斜角+光晕、回血=绿色胶囊、移动=蓝色虚线+滑入、躲藏=灰色虚线半透明、战果=金色双线、回合=小号灰条；横幅左侧还有「战斗 / 技能 / 回复 …」类型短标签。
- **文案精简**：`ANNOUNCE_MAX_TEXT` 从 64 收紧到 48，结构化规则用短句（如 `张三 R1→R2`、`李四 +1 HP（2→3）`、`张三 淘汰 李四`、`张三 获胜`），完整内容仍在战斗日志里可追溯。
- **优先级不抢镜头**：积压时保留队首与 `high`，其余过时的中低价值条目直接丢弃（`condenseAnnounceQueue`），避免播到过时消息。
- **零规则侵入**：播报只读 `LogEntry` 的 `type/text/data/important`，不改数值、不改结算顺序，也不影响隐藏出拳（提交阶段的日志里没有拳种）。所以「所有人可见」不会变成「提前泄露」。

### 信息分级与时长（V2）

| 信息类型 | `kind` | 优先级 | 停留时长 | 表现 |
|---|---|---|---|---|
| 移动 / 技能 / 回血 / 躲藏 | `move` / `skill` / `heal` / `hide` | `high` | `action` 1900ms | 各自独立配色与形状 |
| 攻击宣告 / 命中 / 伤害 | `attack` | `high`（未命中 `low`） | `combat` 2200ms（宣告 1900ms） | 红色尖角 + 红光 |
| 淘汰 / 领域 / 复活 / 致命 | `outcome` / `skill` | `high` | `major` 2600ms | 金色双线 / 危险红 |
| 胜负 / 回合 / 阶段 / 顺序 | `outcome` / `round` | `low` | `brief` 800ms | 小号灰条，只进抽屉 |
| 系统 / 错误 / 兜底 | `system` | 视重要性 | `brief` 或 `major` | 中性蓝灰 |

`ANNOUNCE_TTL` 常量：`brief 800` / `action 1900` / `combat 2200` / `major 2600` / `spotlight 2100`（毫秒）。`ANNOUNCE_VERSION = 2`。

### 扩展点（以后新事件怎么加）

引擎只要写了日志，新动作**默认就会出现在播报里**（兜底规则）。要定制图标/优先级/文案时，注册一条规则即可，服务端与客户端都不用改：

```ts
import { registerAnnounceRule } from './shared/src/announce.js';

const off = registerAnnounceRule({
  id: 'my-skill',
  summary: '我的新技能',
  match: (log, nameOf) => (log.data?.mySkill === true
    ? { icon: '🔥', text: `${nameOf(String(log.data.pid))} 点燃了战场`, tone: 'danger', kind: 'skill', priority: 'high', ttlMs: 3000 }
    : null),
}, { before: 'fallback' });   // 默认插在规则表最前；before 可指定插入位置
// 返回撤销函数：测试 / 热重载用完即撤
```

| 接口 | 说明 |
|---|---|
| `AnnounceItem.ts` / `ttlMs` | 服务端时刻与建议展示时长（即「反馈时间」） |
| `AnnounceItem.priority` | `high` / `normal` / `low`：决定是否上横幅、拥堵时是否保留 |
| `AnnounceItem.kind` | `move`/`attack`/`skill`/`heal`/`hide`/`outcome`/`round`/`system`：决定前端差异化表现形式 |
| `AnnounceItem.rule` | 命中的规则 id（埋点/定制渲染用；未知值按 `tone` 降级） |
| `buildAnnouncements(logs, { names, now })` | 纯函数：日志批次 → 播报项（幂等、保序、有界） |
| `mergeAnnouncements(prev, next)` | 客户端增量累积（seq 去重 + 截断） |
| `condenseAnnounceQueue(queue, incoming)` | 拥堵压缩：保留队首与 `high` |
| `simplifyAnnounceText(text)` / `clampAnnounceText(text)` | 精简日志原文（剥图标 + 短句替换）/ 截断到 48 字 |
| `fmtAnnounceClock(ts)` / `fmtAnnounceTtl(ms)` | `HH:MM:SS` / `0.8s` |

协议层：`room:update` 新增 `announces?: AnnounceItem[]`，与 `newLogs` 同批、所有座位完全一致；断线重连随 `catchUp` 补发最近 300 条日志对应的播报。旧客户端忽略该字段即可；旧服务端不发送时客户端按「无播报」安全降级。

## 战斗演出节奏（Pace）

> 反馈：AI 行动「太快、看不清」。演出时长原本散落在 `queue.ts` 与 `useBattlePresentation.ts` 十几处，调一次要改很多地方，所以抽成**档位表**。

一条链路：**引擎日志 → `parseBattleEvent` → `assembleClusters` 分簇 → `BattleEventQueue` 按档位时长逐条播 → 3D 特效/受击动画**。

- **四档可在运行时切换**：URL 加 `?pace=current` / `relaxed` / `cinematic` / `slow`（未知值回退默认）。默认档由 `DEFAULT_PACE` 一行决定，当前为 `slow`（慢速）。
- **座位组成策略**：`resolvePresentationPace(seats, search)`（`client/src/battle/pace-policy.ts`）按房间座位计算档位——**真人/本机玩家 + AI 混合局强制 `slow`**，保证人机对局也看得清每一击；纯 AI / 纯真人局跟随 URL 或默认档。显式合法 `?pace=` 仍是最优先的调试覆盖。档位经 `QueueState.pace` 暴露到 `.battlefield` 的 `data-pace`，便于验收与调试。
- **所有数字集中在一处**：`PACE_PROFILES`（`client/src/battle/queue.ts`）——每种事件的基础时长、`fast` 压缩时长、簇间呼吸间隔、多段伤害/致命伤害停留、拥堵阈值，改档即可整体变快变慢，不用翻代码。
- **拥堵判定改看「条数」**：AI 由服务端 `kickAI()` 同步批量驱动，一次广播就带来**一整轮 AI 行动**（十几到几十条）。原先按「估算播放时长 > 9s」判积压，6~10 人局天然超标 → 每一批都被压成 `fast` 档 260ms/条，这才是「AI 太快」的根因。现在主判据是待播条数（`fastPendingEvents 60` / `turboPendingEvents 160`），正常回合按原速播，只有真正的洪水（重连补发、整局回放）才压缩。
- **演出预算对得上动画长度**：基线「一次攻击」= 行动 340 + 出手 200 + 伤害 640 = **1180ms**，而 3D 受击动画 `HIT_MS` 1250ms、出手 `FX_MS` 1400ms——动画还没播完就被下一条盖掉，观感自然偏急。各档把单次攻击拉到 1.18s / 1.71s / 2.18s / 2.71s，恢复「动作走完再下一条」。

| 档位 | `?pace=` | 缩放 | 单次攻击 | 18 条 AI 行动整段 | 适用 |
|---|---|---|---|---|---|
| 现有速度 | `current` | 1.00× | 1.18s | 8.8s | 原线上表现（对照基线） |
| 舒缓 | `relaxed` | 1.45× | 1.71s | 12.7s | 手机/普通对局，一眼看清「谁打谁、掉多少血」 |
| 从容 | `cinematic` | 1.85× | 2.18s | 16.2s | 大屏、旁观、直播 |
| **慢速（默认）** | `slow` | 2.30× | 2.71s | 20.2s | 逐帧讲解/复盘 |

API：

| 符号 | 用途 |
|---|---|
| `PACE_PROFILES` | 四档完整参数表（含 `base` / `fastMs` / `gapMs` / 阈值） |
| `DEFAULT_PACE` | 默认档位 id（改手感只改这一行） |
| `resolvePace(raw)` / `paceFromLocation()` | `?pace=` 解析（未知值安全回退） |
| `resolvePresentationPace(seats, search)` | 座位组成策略：人机混合局默认慢速，显式 `?pace=` 优先（`pace-policy.ts`） |
| `queue.setPace(profile)` | 局内即时切换（只影响后续事件） |
| `eventMs(e, mode, speed, reduced, pace)` | 单事件时长（导出供分析脚本/测试复用） |

节奏对照材料（同一场真实对局、四档各录一条 + 并排对比）见交付目录 `pace/`。

---

## 角色 3D 视觉（全员专属）与新增角色指引

首 11 名角色有专属程序化 3D rig；第 12~15 名「佝偻弓箭手」「鬼影」「狂猎」「飞天水螅」暂用 legacy Humanoid + 专属配色/道具（未做专属 rig，符合「新增角色不需要等 3D」）。逐角色规格/QA/取证帧：

| 角色 | 记录 | 角色 | 记录 |
|---|---|---|---|
| 老大爷 | [characters/laodaye.md](characters/laodaye.md) | 卖大伊万的小女孩 | [characters/ivan-girl.md](characters/ivan-girl.md) |
| 拔棍 | [characters/bagun.md](characters/bagun.md) | 今日勇者 | [characters/hero-today.md](characters/hero-today.md) |
| 吹箫哥 | [characters/chuixiao.md](characters/chuixiao.md) | 大贱客 | [characters/dajianke.md](characters/dajianke.md) |
| 伍六七 | [characters/wuliuqi.md](characters/wuliuqi.md) | 大屁孩 | [characters/dapihuai.md](characters/dapihuai.md) |
| 马保国 | [characters/mabaoguo.md](characters/mabaoguo.md) | 无业游民 | [characters/nobody.md](characters/nobody.md) |
| 五条悟 | 交接样例见 `plugins/character-pipeline/examples/first-character/`（已验收 V5.0-B） | 佝偻弓箭手 | [characters/hunchback-archer.md](characters/hunchback-archer.md) |
| 鬼影 | [characters/ghost.md](characters/ghost.md) | 狂猎 | [characters/wild-hunt.md](characters/wild-hunt.md) |
| 飞天水螅 | [characters/water-snake.md](characters/water-snake.md) | | |

**新增角色时不需要等 3D**：把角色加进 `shared/src/characters/` 即可正常入局——客户端自动回退 legacy Humanoid（调色板未收录时用默认灰蓝、无道具）。后续要 3D 化时三步接入（见 `client/src/battle3d/characters/index.ts` 的 `registerCharacterRig`）：

1. `client/src/battle3d/palette.ts` → `CHAR_VISUALS` 加主色/辅色/道具/相对身高；
2. `client/src/battle3d/characters/<charId>.ts` 写专属 rig（复用 `kit.ts` 骨架套件）；
3. `characters/index.ts` 一行注册：`registerCharacterRig(charId, '<charId>-v1', createXxxRig)`。

视觉验收用 `npx tsx scripts/char-shots.ts <charId>`（配合 `client/char-harness.html` 隔离渲染）出全姿态原帧。

### 低模发型增强层

全员 rig 在 `head` / `headTop` 挂点上统一叠加一层程序化低模发型几何（`client/src/battle3d/characters/hair-style.ts`），补足束发、鬓角、后脑发量、短发发际线与刘海体积，让正面/侧面/背面与战场俯视下都更容易辨认。脸、服装、道具、动作与脚底锁定一概不动，几何随头/头顶关节同步；沿用原发色与顶点色平面着色，无新增贴图或外部模型，随材质一起淡入淡出与释放。

- 三名样板：吹箫哥（束发髻 + 鬓角 + 后脑，绿袍/竹箫/抬箫保持）、拔棍（短发发际线 + 后脑轮廓，收棍态只看头部站姿可辨）、大伊万（刘海 + 两侧体积，脸与橙衣轮廓拉开，怀里炸弹保留）；其余角色按束发/短发/强发量/配件优先/大头比例推广，详见 [造型标准](CHARACTER_HAIR_STYLE.md)。
- 工厂统一挂接（`characters/index.ts` 的 `createCharacterAsset`），幂等；无 3D 兜底的 legacy Humanoid 不受影响。
- 需要新旧对照时可整体开关：`setCharacterHairStyle(rig, false)` 关闭、`true` 恢复。

## V6.1 · 飞天水螅战术增强

- **指定房间吹飞**：「吹」现在需要同时选择**一名或多名目标**与**落点房间**。塔内或同房间的可见敌人会被统一吹到指定其他房间；塔内目标同时离开高塔。缺少落点、落点为当前房间/不存在房间、或目标不在身边时，服务端会拒绝行动。
- **交互同步**：2D 牌桌、3D 战场与原型入口均支持“目标 + 房间”组合选择；AI 使用「吹」时会自动挑选合法落点。
- **通用扩展**：新增 `sameRoomOrTowerPlayer` 目标提示与 `roomExcludeCurrent` 房间选择约束，后续特殊空间/落点行动无需在引擎或 UI 主流程写角色名字分支。

---

## V6.0 · 地图（悬浮遗迹）/ MAP 任务进展

V5 悬浮遗迹地图的任务分工与验收边界见 [MAP_TASKS.md](../MAP_TASKS.md)、设计见 [MAP_DESIGN.md](MAP_DESIGN.md)、架构见 [MAP_ARCHITECTURE.md](MAP_ARCHITECTURE.md)、端到端验收见 [MAP_ACCEPTANCE.md](MAP_ACCEPTANCE.md)。核心 Phase 0–5（MAP-000~005）已完成；后续独立任务状态如下：

| 任务 | 状态 | 交付要点 | 取证 / 记录 |
|---|---|---|---|
| MAP-101 石材与遗迹细化 | ✅ 完成 | 五层浮岛岩层 + 顶点色凿刻纹理、断柱环阵、渐变天穹；绘制调用 169→189、三角形 11,664→14,424 | [screenshots-map101](screenshots-map101/)（before/after 同机位） |
| MAP-102 密集名牌与危险标识 | ✅ 完成 | 名牌按房间分批布局（≤4 逐个 / 5–10 三列 / >6 紧凑）、淘汰名牌保留灰章、待爆警示增强；三种分辨率键盘选取记录 | [screenshots-map102](screenshots-map102/) |
| MAP-103 精简模式性能采样 | ✅ 完成 | 双模式×两局帧耗时/上下文/资源对账、功能保留检查；**硬件验收未完成**（本机 SwiftShader 软渲染，pixelRatio 锁 1） | [MAP103_REPORT.md](screenshots-map103/MAP103_REPORT.md) · [map103-samples.json](screenshots-map103/map103-samples.json) · [对照截图](screenshots-map103/) |
| MAP-104 触屏安全区域和缩放 | ⏳ 待领 | 前置 MAP-002、串行于 MAP-102 | — |
| MAP-105 自动化边角案例 | ✅ 完成 | 未命中 / 同归于尽平局 / 重复播报 2×·4× / WebGL 上下文恢复；仅测试与脚本改动 | [screenshots-map105](screenshots-map105/) |
| MAP-106 第二主题配置样例 | ⏳ 待领 | 前置硬件与人工验收，串行于 MAP-101、MAP-103 | — |

复现命令（在仓库根目录）：

```bash
node scripts/map-sample.mjs map103   # MAP-103 双模式采样，输出 docs/screenshots-map103/
npx tsx scripts/map-match.ts         # 地图对局端到端验收（含边角场景）
npx vitest run tests/ui/battle3d.test.ts tests/ui/map-playback.test.ts
```

> **版本说明**：以上 MAP 系列提交（`V5-MAP` → `MAP-101` → `MAP-102` → `MAP-105` → `MAP-103`）已随 **V6.0** 合并进 `main`，与马保国「亲自出拳」判定链共存；线上部署跟随 `main`，因此已包含悬浮遗迹地图。地图相关改动均已进入 `main`，不再保留独立开发分支。