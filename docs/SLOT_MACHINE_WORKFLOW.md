# 老虎机侠资产与互动特效工作流

> 适用范围：Issue #72「老虎机侠加入」的**视觉资产、动画、手动拉杆演出和丢老虎机特效**。
> 玩法、随机结果、数值、角色注册与服务端结算归 Issue 负责人 MMR12345；没有明确分工时不要重复实现。

## 0. 后续 Agent 调用范式

这份文档同时是**接口契约**和**分工模板**。后续 agent 先选择角色，再只修改该角色拥有的文件；不要同时改规则、资产和演出。

| 角色 | 输入 | 允许修改 | 必须输出 | 禁止修改 |
|---|---|---|---|---|
| 美术资产 agent | 视觉方向、`asset-spec.json`、现有 `CharacterRig` | `artifacts/collab/<asset>/` | GLB、可复现源、预览、SHA-256、验证证据、`HANDOFF.md` | `client/`、`server/`、`shared/` |
| 演出逻辑 agent | 结构化日志契约、演出注册表、场景生命周期 | `client/src/battle/`、`client/src/battle3d/`、对应测试与预览 | 注册项、UI/场景 presenter、降级行为、测试与浏览器证据 | 角色注册表、技能规则、数值、服务端结算 |
| 玩法集成 agent | 已验收资产 + 已验收演出 + Issue 明确授权 | 共享角色定义、异步资产适配器、服务端事件 |  authoritative 行动日志、资产适配器、规则测试 | 覆盖其他 agent 未交接的临时文件 |

依赖方向只有两条，不允许反向耦合：

```text
服务端 authoritative action log
  -> action-presentation registry
  -> DOM overlay / 3D presenter
  -> 玩家可见演出

asset-spec.json + GLB
  -> async loader / cache
  -> CharacterRig adapter
  -> 现有角色场景状态机
```

- 美术 agent 不 import 游戏运行时；演出 agent 不 import `artifacts/` 下的模型或贴图。
- `client/src/battle3d/slot-machine-model.ts` 是**运行时演出几何**，不是角色 GLB；它由特效模块自包含生成。
- 角色 GLB 在集成负责人完成异步加载适配前保留在 `artifacts/collab/`，不要直接塞进同步角色注册表。
- 演出只消费公开事件，不读取资产内部骨骼，也不反过来决定随机结果、伤害或角色注册。

可直接复用的调用接口：

```ts
registerActionPresentation(actionName, {
  fx, mode: 'manual' | 'automatic', durationMs, major,
});
registerFxOverlay(fx, OverlayComponent);
registerActionPresenter(fx, (scene, pid, room, durationMs) => { /* scene command */ });
slotMachineDropFx(target, { duration, reducedMotion, lowEffects, seed });
```

新 agent 的任务提示词应包含以下六项，缺失时先澄清而不是猜测：

```text
你负责【美术资产 / 演出逻辑 / 玩法集成】之一。
输入：<Issue、基线 commit、契约文件、已有证据>
只修改：<明确路径>；不得修改：<规则、注册表、其他 agent 文件>
接口：<action name / fx / CharacterRig / FxInstance>
完成标准：<测试、浏览器输入、性能预算、资源释放>
交付：<分支、文件清单、验证结果、已知限制>
授权：<是否允许 commit / push / PR；默认不允许>
```

## 1. 先做隔离与归属检查

1. 阅读当前工作区的 `AGENTS.md`，执行 `git status --short --branch`、`git worktree list`。
2. 查看 Issue 的 Assignee、标签和最新讨论。已有 Assignee 时只做明确的协作子任务，不抢认领、不覆盖同分支文件。
3. 主工作区若处于 rebase、merge、detached 或存在冲突，保留现场，另建 worktree。不要用 `reset --hard`、`clean` 或删除陌生文件“恢复环境”。
4. 从最新 `origin/main` 创建视觉/特效协作分支，记录基线 commit、工作区路径和允许修改的文件。
5. 默认不提交、不推送；用户明确要求后再操作。凭据不得进入客户端、Git、构建产物或浏览器可见配置。

本次参考基线：

| 工作区 | 分支 | 范围 |
|---|---|---|
| `D:\AI工作区\badian-game-slot-hero-assets` | `feature/72-slot-hero-assets` | GLB、程序化源、预览与证据 |
| `D:\AI工作区\badian-game-slot-hero-effects` | `feature/72-slot-hero-presentation` | 通用演出注册表、中央拉杆、3D 掉落特效 |

## 2. 先定资产契约，再生成模型

### 视觉方向

- 装饰艺术机械侠，酒红珐琅、黄铜、象牙陶瓷、深青信号色。
- 胸窗三滚轮、777 灯箱、右肩不对称拉杆，轮廓必须一眼可辨。
- 滚轮符号只承担演出，不在客户端推算其玩法效果。

### 统一坐标与预算

- 单位米，`+Y` 向上，`+Z` 向前，脚底 `y=0`， pivot 在脚底中心，无根运动。
- 角色目标高度约 1.9m；老虎机道具约 1.35m 宽、1.8m 高、0.85m 深。
- 角色 GLB 目标小于 4MB、最多约 65,000 三角面；若几何数据导致超预算，优先记录取舍，不牺牲骨骼链与接触精度。
- 道具模型目标：不超过 45 个 mesh、18,000 三角面、35 个 geometry、12 个材质；完整一次性特效约 60 draw call 或更少。
- 纹理内嵌，运行时不需要外部贴图请求。

### 资产来源

- 明确使用程序化资产时无需探测外部凭据。
- 若需要外部生成，先按已加载的 `threejs-game-director` skill 运行凭据探测；只输出 SET/MISSING，不打印密钥。
- 有凭据时先生成/检查代表角色和高质量表面，再绑定与动画；超时不能直接认定服务不可用，先检查任务回执和产物。
- 无凭据时使用项目内程序化源，并明确这是风格化资产，不声称影视级写实扫描质量。

## 3. 角色骨骼、动画与现有接口

当前资产源位于：

`artifacts/collab/slot-hero/preview/slot-hero.js`

导出文件：

`artifacts/collab/slot-hero/model/slot-hero.glb`

动画映射：

| GLB clip | 时长 | `CharacterRig` 方法 |
|---|---:|---|
| `idle` | 4.0s | `idle()` |
| `walk` | 1.0s | `walk()` |
| `slot_pull` | 2.6s | `attackSwing()` |
| `flinch` | 0.85s | `flinch()` |
| `dead` | 1.0s | `dead()` |
| `reviveRise` | 1.0s | `reviveRise()` |
| `victory` | 2.8s | `cheer()` |

关键骨骼：`Lever`、`Reel.1/2/3`、`UpperArm.R`、`Forearm.R`、`Hand.R`。GLTFLoader 可能把 `Hand.R` 规范化为 `HandR`，查找时同时处理原名与规范名。

接入规则：

1. `GLTFLoader.loadAsync()` 是异步的，现有 `createCharacterAsset()` 是同步工厂。必须先预加载并缓存，再由玩法负责人实现适配器。
2. 适配器实现完整 `CharacterRig`：`materials()`、`setOpacity()`、`headHeight()`、`resetPose()` 以及全部姿态方法。
3. 场景每帧调用姿态方法，不会自动调用 mixer update。适配器要在方法内设置 action 时间、采样并暂停 action。
4. `attackSwing(t)` 将 `t∈[0,1]` 映射到 `slot_pull` 的 `t×2.6s`；生产切换仍由场景 pose 状态机决定。
5. `cast/drink/crouch` 没有专项动画时显式降级到安全待机姿态，不保留空实现。
6. 多实例使用 `SkeletonUtils.clone()`；释放时解绑 action，并释放 geometry、material 及其引用的 texture。
7. 不把 2.6 秒动画直接当作服务端结算延迟。动画节奏与规则时序分开设计。

当前 GLB：8,090,180 字节，44,000 三角面，22 骨骼，11 蒙皮网格，18 张内嵌 PNG。SHA-256：

`3a17f9e6c95026a6fa84d7fbc0958b6024496e31b7c19426b30da824be3a2e75`

## 4. 手动拉杆演出

### 交互契约

- 玩家选择技能并完成目标/房间校验后，战场中央出现独立老虎机，不直接提交行动。
- 拉杆支持鼠标与触摸向下拖动，也支持点击和键盘激活。
- 拉杆命中区域至少 44×44 CSS px；使用 Pointer Events 与 pointer capture。
- 完整处理 `pointerdown/move/up/cancel/lostpointercapture`，以及窗口 blur、页面隐藏。
- 未达到拖动阈值时回弹；点击无拖动时可直接完成；取消不发送网络请求。
- 提交中防止重复触发。只有拉杆成功完成后才调用既有 `net.submitAction()`。
- 状态至少包含 idle、pulling、spinning、result；卷轴结果只是演出，不覆盖快照或生成伤害。
- reduced-motion 停止旋转/掉落等非必要运动，保留明确状态反馈。

### 通用注册表

不要在 `Game.tsx` 或 `scene.ts` 堆具体角色分支。新增演出走三层注册：

| 层 | 文件 | 键 | 职责 |
|---|---|---|---|
| 行动配置 | `client/src/battle/action-presentation.ts` | 服务端 action name | fx 名、manual/automatic、时长、是否重大事件 |
| DOM 演出 | `client/src/battle/fx-overlays.tsx` + `slot-machine-overlay.tsx` | 结构化 `data.fx` | 2D/3D 共用中央 UI、手动输入 |
| 3D 演出 | `client/src/battle3d/action-presenters.ts` + presenter | 结构化 `data.fx` | 将事件转换为场景命令 |

当前注册：

```ts
registerActionPresentation('slotPull', {
  fx: 'slotPull', mode: 'manual', durationMs: 2600, major: true,
});
registerActionPresentation('slotDrop', {
  fx: 'slotDrop', mode: 'automatic', durationMs: 2200, major: true,
});
```

新增技能时优先注册新 action name/fx，不修改共享 `CharActionDef`，也不把视觉字段塞进规则类型。未知 fx 必须安全回退或忽略，不能让旧日志导致页面崩溃。

## 5. 丢老虎机从天而降

### 事件时序

1. warning：目标房间预警，0–12%。
2. falling：从约 7.5m 高空加速下落，12–62%。
3. impact：62% 附近落地，触发冲击环、必要闪光与镜头反馈。
4. settled：短暂停留、淡出并清理。
5. dispose：移除 scene 节点，释放 geometry、material、texture。

默认约 2.2 秒。随机碎屑使用可复现 seed，禁止 `Math.random()`。同一 seed 与 duration 必须产生相同状态序列。

### 降级与性能

- reduced-motion：直接出现在落点，不坠落、不旋转、不出碎屑或闪光。
- low-effects：去掉高成本碎屑、额外灯光与镜头抖动，保留清晰落点和冲击反馈。
- 掉落目标房间不存在时安全忽略，不制造新的房间或规则状态。
- 使用现有 `FxInstance` 生命周期、`spawnFx()`、`resetPresentation()` 和 `dispose()`，避免自建无法清理的 RAF/定时器。
- 镜头聚焦和震动必须尊重 reduced-motion 与 low-effects。

## 6. 服务端事件与演出解耦

演出只能由服务端权威事件驱动，不从 HP 差分、日志文本或 UI 动画推断结果。结构化 action 日志的最小公开形状：

```ts
{
  seq: number,
  type: 'action',
  data: {
    pid: string,
    fx: 'slotPull' | 'slotDrop',
    label?: string,
    targetId?: string,
    room?: string,
  },
}
```

- `slotPull` 的 manual gate 只负责“先演出，再提交”；成功与失败仍以服务端响应为准。
- `slotDrop` 由服务端日志触发；`room` 是视觉落点，不代表客户端执行伤害。
- 实际伤害、治疗、淘汰、随机结果继续使用各自结构化日志与共享类型。
- 手动 gate 不能让 AI 或非本地播放者等待人工输入；只有本机行动确认流程使用 manual 模式。

## 7. 验证清单

### 单元与组件测试

```bash
npm install
npx vitest run tests/ui/slot-machine-overlay.test.tsx
npx vitest run tests/ui/slot-drop-fx.test.ts
npm run typecheck:client
npm test
npm run build
```

至少覆盖：

- 注册、未知 fx 降级、时长与重大事件保护。
- 点击成功、拖动成功、短拖动回弹、pointer cancel、blur、键盘、取消不提交。
- 服务端失败后允许重新操作，提交中不重复发送。
- 掉落 warning/falling/impact/settled 状态与高度曲线。
- 相同 seed 的确定性、reduced-motion、low-effects、dispose 资源释放。
- 地图 playback 优先调用 presenter，未知 fx 回退到原 `playAction()`。

### 浏览器验证

使用生产组件建立独立预览入口，不能只用示意图代替。桌面与 390px 移动端均需检查：

- 中央老虎机不遮挡关键操作；无横向溢出；拉杆触摸区域足够大。
- 实际 pointer 拖动、点击、键盘、取消、窗口失焦与 visibility 清理。
- 2D 掉落和 3D 掉落完整时序；reduced-motion 立即落地。
- console/page/network 错误为零；记录 renderer calls、triangles、geometry、texture。
- 保存关键帧、短动作序列、验证 JSON 和缺陷记录。截图不能替代输入与状态测试。

资产实验室可用：

```bash
node "D:/AI工作区/badian-game/node_modules/vite/bin/vite.js" --config "D:/AI工作区/badian-game-slot-hero-assets/artifacts/collab/slot-hero/vite.config.js"
```

## 8. 交接要求

交付时明确列出：

- 工作区、分支、基线、修改文件与未修改的规则模块。
- GLB 路径、SHA-256、动画映射、预算与已知限制。
- 哪个 action name/fx 触发哪层演出，服务端需发出的结构化字段。
- 运行过的命令、测试数量、浏览器输入与截图证据。
- 尚未完成项，以及玩法负责人需要决定的结算时机/符号语义。
- 默认“未提交、未推送”，除非用户另有明确授权。

## 9. PR 分包与集成顺序

本次交付拆成两个独立 PR，均以最新 `origin/main` 为基线：

| PR | 分支 | 内容 | 不包含 |
|---|---|---|---|
| 美术资产 | `feature/72-slot-hero-assets` | `artifacts/collab/slot-hero/`：GLB、生成源、预览、规格与证据 | 游戏运行时、角色注册、规则 |
| 演出逻辑 | `feature/72-slot-hero-presentation` | 注册表、中央拉杆、2D/3D 掉落、测试、预览与本文档 | 角色 GLB、共享角色定义、服务端结算 |

两个 PR 可以独立评审、独立合并；演出逻辑不依赖资产 PR 的文件路径。集成负责人在两者验收后再添加异步加载与 `CharacterRig` 适配器。

PR 描述使用 `Refs #72`，不使用 `Closes #72`：Issue 仍归 MMR12345，协作 PR 不代替负责人关闭任务。每个 PR 必须写清：

1. 只修改了哪些路径，哪些规则/注册模块明确未改。
2. 输入契约、输出接口和未知/旧数据的降级方式。
3. 实际运行的命令、测试数量、浏览器证据与性能数据。
4. 已知限制和需要玩法负责人决定的语义。
5. 资产 PR 附 GLB SHA-256；演出 PR 附 renderer 资源释放基线。

推荐集成顺序：先合并资产与演出 PR，再由 Issue 负责人实现异步资产缓存、角色适配器和权威 `slotPull` / `slotDrop` 日志；不要为了让单个 PR “可玩”而越界实现玩法。
