# 四角色资产、规则与战斗演出接入

本交接对应 [#77](https://github.com/xzq66677/BA-DIAN/issues/77)，基于已合并 [#80](https://github.com/xzq66677/BA-DIAN/pull/80) 的 `main`（`d606d8e`）。角色规则、回合数、伤害和可行动条件以现有共享引擎为准。资产目录沿用美术交付名，战场注册使用正式角色 ID。

| 角色 | 正式 ID | 规则 | 资产 |
| --- | --- | --- | --- |
| 鬼影 | `ghost` | [附身与吸取](characters/ghost.md) | [GLB、挂点与跟随接口](../artifacts/collab/ghost/HANDOFF.md) |
| 狂猎 | `wild-hunt` | [受击判定、反击与骑乘](characters/wild-hunt.md) | [无头幽马与十一段动作](../artifacts/collab/wild-hunt-heathcliff/HANDOFF.md) |
| 佝偻弓箭手 | `hunchback-archer` | [燃烧箭、散架与复原](characters/hunchback-archer.md) | [骷髅弓箭手资产](../artifacts/collab/skeleton-archer/HANDOFF.md) |
| 飞天水螅 | `water-snake` | [造塔、塔内判定、吸吹与亡魂](characters/water-snake.md) | [飞天水蛭、高塔与气流资产](../artifacts/collab/flying-leech/HANDOFF.md) |

## 玩法 Agent 的接入顺序

1. 在 [共享角色表](../shared/src/characters/index.ts) 定义该角色的 `CharDef`，使用 `init`、`validate`、`execute` 和合适的伤害、行动、淘汰或回合钩子。目标、房间、资源及阶段通过服务端统一验证。
2. 跨回合效果登记到 [状态注册表](../shared/src/statuses.ts) 并由引擎推进和清理。可公开状态经 [快照](../shared/src/snapshot.ts) 到达客户端，由 [状态读取器](../client/src/battle/status-readers.ts) 驱动状态 UI。AI 特化走 `aiStrategy`，和玩家共用行动约束。
3. 通过 `CharActionContext.present()` 向已通过校验的行动日志附加公共演出参数。数据用确认后的 PID、房间和移动结果。客户端按实际字段解析，内部判定、隐藏信息和结算细节留在服务端。独立的伤害、治疗及淘汰日志保留现有含义。
4. 对有结果的技能测试正常、非法、重复、回合顺序、死亡清理、重连与旧回放。用引擎建最小场景，验证结果和公开日志来自同一次有效行动。

例如水螅逐个结算吸吹后，将已发生的路径写入原行动日志。

```ts
ctx.present?.({
  targetIds: ['B', 'C'],
  moves: [
    { pid: 'B', fromRoom: 'R3', toRoom: 'R2' },
    { pid: 'C', fromRoom: 'R2', toRoom: 'R2', tower: 'enter' },
  ],
});
```

## 动画和接口 Agent 的接入顺序

- 在 [行动演出配置](../client/src/battle/collaboration-presentations.ts) 登记服务端的实际 `actionName`、fx、时长和对应 clip。四角色这里用自动模式，现有的出拳界面继续处理狂猎和塔内的玩家判定。2D 可以读取同一配置，Three.js 资产仍按需加载。
- [3D presenter](../client/src/battle3d/collaboration-presenters.ts) 检查公开负载，调用场景的一次性动作和目标效果。能力、对象或资产缺失时，返回 `false` 交给通用演出。回放和实时演出消费相同日志语义。
- [GLB 适配器](../client/src/battle3d/characters/collab-assets.ts) 按参赛角色预加载。同步角色工厂负责创建骨骼和可变材质的独立实例，并提供 `CharacterRig` 的完整姿态入口。命名 clip 按场景进度采样，持续姿态按快照重建。退出、跳过、重开或切回 2D 时清理实例和临时特效。
- [地图快照投影](../client/src/battle3d/map-playback.ts) 仅用已公开路径决定什么时候播放跨房间过渡。换地图、断线、快速跳过和低动态效果都应收敛到快照中的权威位置。

## 实际动画映射

| 触发入口 | 动画与对象 |
| --- | --- |
| 鬼影 `possess` | `attach → attached_idle`。用快照中的 `char.possessing` 找宿主，宿主骨骼与位置更新后再跟随其局部背面。 |
| 鬼影 `possessStrike`、`possessControl`、回合末 `ghostSiphon` | `drain`。跟随宿主期间可继续播放。驱逐和宿主/鬼影离场通过快照解除，受击和淘汰对应 `flinch`、`dead`。 |
| 狂猎 `mount` 或反击后的骑乘状态 | `mount → mountedIdle`。骑乘到期按状态播放 `dismount`。徒步攻击播 `attackSwing`。 |
| 狂猎结构化攻击宣告 | `presentation.mounted` 选择 `mountedAttack`。跨房间使用 `fromRoom/toRoom` 驱动场景路径，同时抑制 GLB 内的重复平移。同房短冲锋从 GLB 的 `ChargeOffset` 采样。 |
| 佝偻弓箭手攻击宣告 | `shoot`，资产中约 1.08 秒离弦。普通受击为 `flinch`，弓箭手进入燃烧状态时为 `flinch_burning → burn`。 |
| 弓箭手散架、复原与淘汰 | `char.downed` 触发 `dead` 并保持散架终态，解除该标记时播 `reviveRise`。永久淘汰走通用生命状态。头部绑定缩放由 GLB 保留。 |
| 水螅 `buildTower` | 水螅 `cast`，高塔 `build`。首次显示半塔，建成显示完整塔，倒塌时按建塔轨道收回。塔模型挂到权威房间。 |
| 水螅 `inhale`、`blow` | 分别对应 `inhale`、`exhale`。每个合法目标的气流沿施术者到目标的方向播放，`WindTargetMotion` 驱动轨迹，终点使用权威房间及塔内状态。 |
| 水螅 `char.posthumous` | `dead → dead_idle`，模型材质维持 40% 透明显示倍率，仍可播 `inhale/exhale`。两个状态共用同一动画骨架。 |

美术包保留水螅投塔和漩涡捕获素材，当前正式规则实现的是原地造塔与坍塌。运行时读取已确认的高塔与移动状态。狂猎的透明马头、颈雾材质和 `DullahanSpirit` 的 morph 轨道参加普通姿态采样。

## 复验

在仓库根目录运行以下命令。资产脚本验证七个 GLB，浏览器脚本验证实装的四个战场 rig 和关键状态。

```sh
node artifacts/collab/verify-assets.mjs
node artifacts/collab/verify-runtime.mjs
npm test
npm run build
```

本机 Chromium 安装在自定义目录时设置 `PLAYWRIGHT_BROWSERS_PATH` 或 `CHROMIUM_PATH`。各角色独立预览、资产来源、三角面和保留的生成源码见各自交接。参照 [全角色演出工作流](CHARACTER_PRESENTATION_WORKFLOW.md) 继续新增角色。
