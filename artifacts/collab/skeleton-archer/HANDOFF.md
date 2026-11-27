# 骷髅弓箭手协作资产交接

正式角色 ID 为 `hunchback-archer`，视觉版本为 `skeleton-archer-v1`。运行时接线见 [四角色资产、规则与战斗演出接入](../../../docs/FOUR_CHARACTER_INTEGRATION.md)。

## 交付文件

| 文件 | 用途 |
|---|---|
| `model/skeleton-archer.glb` | 可直接加载的 GLB 2.0 角色资产 |
| `preview/skeleton-archer.js` | 可重复生成的程序化建模、材质、骨骼和动画源 |
| `preview/main.js` | 预览、逐帧采样、独立 GLB 重载和导出逻辑 |
| `preview/index.html` | 响应式资产实验室界面 |
| `vite.config.js` | 本地预览与 GLB/证据导出端点 |
| `validate.mjs` | 独立重载、蒙皮、动画、接地、交互和窄屏验证脚本 |
| `asset-spec.json` | 视觉、坐标、材质、动画和预算契约 |
| `evidence/validation.json` | 最终验证结果 |
| `evidence/preview-*.png` | 最终关键帧、面部近照和移动端证据 |

GLB：`3,406,836` 字节（3.41 MB / 3.25 MiB）

SHA-256：`255863251f270513b3e65db416c9b791ada0aed7c8b55d5918940c07dfcf2c37`

## 视觉与资产契约

- 原创风格化骷髅弓箭手：余烬火焰、真实凹陷的空眼窝、愤怒眉弓、瘦长解剖骨架、背挂箭袋、紫杉长弓与燃烧箭矢。
- 用户提供的解剖骨架参考仅用于比例和结构方向，没有嵌入参考图像或外部扫描网格。
- 单位：米；`+Y` 向上；`+Z` 向前；脚底约 `y=0`；无根运动。
- 站立高度 `2.145 m`，宽 `0.737 m`，深 `0.847 m`。
- `69,486` 三角面、`62,816` 顶点、53 根骨骼、10 个蒙皮网格、10 个材质。
- 24 个加载后贴图对象，GLB 内去重为 18 张 PNG：6 张 128px BaseColor，12 张 64px Roughness/Metalness/Normal。
- 皮肤索引使用 `Uint8`，皮肤权重使用归一化 `Uint8`；独立重载后每顶点权重和均为 1。
- 模型自身 10 个 draw call；预览舞台和阴影合计 58 个。

## 动画与现有角色接口映射

| GLB clip | 时长 | 现有 `CharacterRig` 方法 | 说明 |
|---|---:|---|---|
| `idle` | 4.0s | `idle()` | 呼吸、重心与动态头火 |
| `walk` | 1.0s | `walk()` | 行走循环 |
| `shoot` | 2.2s | `attackSwing()` | 拉弓、火矢离弦、回势 |
| `flinch` | 0.75s | `flinch()` | 普通受击 |
| `flinch_burning` | 1.4s | 演出专用 | 火箭留驻背部、燃起火焰与灰烬 |
| `burn` | 2.0s | 演出/状态专用 | 持续燃烧循环 |
| `dead` | 1.4s | `dead()` | 骨架缩放隐藏，18 组碎骨散落 |
| `reviveRise` | 1.4s | `reviveRise()` | 由 `dead` 轨道精确倒放生成 |

`shoot` 的时间安排：

- `0.00–0.95s`：双手拉开弓弦，搭箭。
- `0.95–1.08s`：蓄势释放。
- `1.08–1.75s`：`FireArrow` 显示并沿攻击方向飞行，箭尖与尾焰可见。
- `1.75–2.20s`：手臂和弓弦恢复待机姿态。

`flinch_burning` 的时间安排：

- `0.00–0.22s`：普通受击后仰。
- `0.22s` 起：`StuckArrow` 留驻背部，`BurnFlame0–3` 与灰烬出现。
- `0.22–1.40s`：背部燃烧、灰烬上升，头火持续动态。

骨骼要点：

- 头部骨骼 `Head` 的绑定缩放为 `.55`，适配器不得重置为 1。
- `StringUpper` / `StringLower` 是独立弓弦骨骼。
- `FireArrow` / `ProjectileFlame` 是飞行火矢，`StuckArrow` 是留驻火箭。
- `HeadFlame0–3` 是头顶火舌，`BurnFlame0–3` 是背部火舌，`Ash0–1` 是灰烬。
- `NockedArrow`、`FireArrow`、`ProjectileFlame`、`StuckArrow`、背部火焰、灰烬和全部 `Debris*` 骨骼在静息时缩放为 `0.0001`，不要删除这些骨骼，否则动画无法显示。

## 接入建议

当前 `createCharacterAsset(charId)` 是同步工厂，而 `GLTFLoader.loadAsync()` 是异步的，因此这份 GLB 不是可直接塞进现有同步注册表的 drop-in 资产。由玩法/集成负责人在明确授权后：

1. 进入选人/战斗前预加载并缓存 GLB。
2. 用 `AnimationMixer` 建立八个 clip action，再包装成完整 `CharacterRig`。
3. `attackSwing(t)` 的 `t∈[0,1]` 映射到 `shoot` 的 `t×2.2s`；`flinch/dead/reviveRise` 同样按进度映射。
4. `flinch_burning` 和 `burn` 不属于现有通用受击接口。应由公开演出事件或可选适配能力显式触发；未知事件安全回退普通 `flinch` 或待机，不在通用主流程写角色名分支。
5. 服务端权威规则决定普通受击、火箭命中、持续燃烧、伤害与到期；资产只负责表现，不得从动画推断命中或伤害。
6. 适配器必须实现 `materials()`、`setOpacity()`、`headHeight()`、`resetPose()` 和全部姿态方法。`cast()`、`drink()`、`crouch()`、`cheer()` 没有专项 clip，应显式降级到安全姿态。
7. 现有场景每帧调用姿态方法，没有逐帧 `update` 钩子。适配器应在每次方法调用中设置 action 时间、采样并暂停 action，不能依赖 mixer 自动播放。
8. `resetPose()` 必须恢复 GLB 绑定姿态，包括 `Head.scale=.55` 和所有特效骨骼的隐藏缩放。
9. 多实例使用 `SkeletonUtils.clone()`；释放实例时停止并解绑 action，释放 geometry、material 及全部引用 texture。缓存资产在引用归零后再释放。
10. 不要把 `shoot` 的 2.2 秒演出时长等同于服务端命中或结算延迟；两者应分开设计。

依赖方向固定为：

```text
asset-spec.json + GLB
  -> async loader / cache
  -> CharacterRig adapter
  -> existing scene state machine
```

资产不反向依赖游戏规则、服务端或演出组件。

## 验证结果

- GLB 文件头、版本、声明长度和 SHA-256 通过；无外部 buffer 或 image URI。
- 独立 `GLTFLoader` 重载通过：53 骨骼、10 蒙皮网格、10 材质、24 贴图、8 段动画。
- 所有动画轨道数值有限、目标骨骼存在；四元数长度误差小于 `0.0001`。
- 皮肤权重和全部为 1，最大皮肤索引 52，没有越界或非法权重。
- 脚底最低点约 `4.56e-6 m`；`dead` / `reviveRise` 各 29 点采样无穿地。
- 死亡与复活 141 点密采样最大误差：
  - 位置 `4.31e-8 m`
  - 四元数 `3.06e-8`
  - 缩放 `3.85e-7`
- 复活终点包围盒与静息包围盒一致。
- 火矢离弦、插背火箭、背部火焰和灰烬显隐通过；静息时全部特效隐藏。
- 八个预览按钮全部通过；技能与燃烧受击结束自动回到待机。
- 390px 窄屏无横向溢出；画布 `390 × 490 CSS px`，八个动画按钮均存在。
- 浏览器 page error 为零。

## 限制与后续

- 当前是精致的程序化风格化角色，不是影视级写实扫描角色。
- 未使用任何外部生成服务或 API 凭据。
- GLB 低于 4 MB 建议目标；`69,486` 三角面略高于约 `65,000` 的建议值，用于保留肋骨、椎骨、骨盆、手部和碎骨结构。若上线预算更严格，可在 integrator 侧评估网格简化或 meshopt，不要删除死亡/复活所需的碎骨骨骼。
- 没有专项胜利、施法、饮酒、蹲下动画；现有接入说明给出了安全降级要求。
- 音效、玩法语义、随机规则、数值、服务端校验、共享注册和生产适配均未包含。
- 未运行主游戏构建或测试，因为隔离工作区没有修改共享运行时代码。

## 本地预览与复验

从仓库根目录启动预览，访问 `http://127.0.0.1:5207/`。另一个终端运行验证脚本。

```sh
npx vite --config artifacts/collab/skeleton-archer/vite.config.js --host 127.0.0.1 --port 5207
node artifacts/collab/skeleton-archer/validate.mjs
```
