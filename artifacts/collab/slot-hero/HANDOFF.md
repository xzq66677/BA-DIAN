# 老虎机侠协作资产交接

## 归属与范围

- Issue：[#72「老虎机侠加入」](https://github.com/xzq66677/BA-DIAN/issues/72)
- Issue 负责人：`MMR12345`
- 本分支：`feature/72-slot-hero-assets`
- 基线：`origin/main@52db570`
- 工作区：`D:\AI工作区\badian-game-slot-hero-assets`
- 本 PR 只交付视觉资产、动画和接入说明；没有认领 Issue、修改共享角色注册表或实现玩法。演出逻辑由独立 PR `feature/72-slot-hero-presentation` 交付。

## 交付文件

| 文件 | 用途 |
|---|---|
| `model/slot-hero.glb` | 可直接加载的 GLB 2.0 角色资产 |
| `preview/slot-hero.js` | 可重复生成的程序化建模、材质、骨骼和动画源 |
| `preview/main.js` | 预览、动画控制和 GLB 导出逻辑 |
| `preview/index.html` | 响应式资产实验室界面 |
| `vite.config.js` | 本地预览与 GLB/证据导出端点 |
| `asset-spec.json` | 视觉、坐标、材质、动画和预算契约 |
| `evidence/validation.json` | 二进制、重载、动画和窄屏验证结果 |
| `evidence/preview-idle.png` | 最终待机外观 |
| `evidence/preview-lever-down.png` | 拉杆下压关键帧 |
| `evidence/preview-reel-spin.png` | 三滚轮旋转关键帧 |
| `evidence/preview-victory.png` | 胜利动作关键帧 |
| `evidence/preview-dead-ground.png` | 倒地贴地终点关键帧 |
| `evidence/preview-mobile-390.png` | 390px 窄屏布局 |

GLB：`8,090,180` 字节（8.09 MB / 7.72 MiB）

SHA-256：`3a17f9e6c95026a6fa84d7fbc0958b6024496e31b7c19426b30da824be3a2e75`

## 视觉与资产契约

- 装饰艺术机械侠：三滚轮胸窗、777 灯箱、象牙陶瓷面部、酒红珐琅、黄铜、青绿信号灯。
- 滚轮符号为金钱、炸弹、攻击、钥匙；目前只是视觉符号，没有游戏效果。
- 单位：米；`+Y` 向上；`+Z` 向前；脚底 `y=0`；无根运动。
- 站立高度 `1.865 m`，宽 `1.196 m`，深 `0.881 m`。
- `44,000` 三角面、`132,000` 顶点、22 根骨骼、11 个蒙皮网格、11 个材质。
- 24 个加载后贴图对象，GLB 内去重为 18 张 PNG：6 张 256px BaseColor，12 张 64px Roughness/Metalness/Normal。
- 材质使用 `MeshPhysicalMaterial` / `MeshStandardMaterial`；包含清漆、透明滚轮玻璃和自发光信号灯。
- 模型自身 11 个 draw call；预览舞台和阴影合计 60 个。

## 动画与现有角色接口映射

| GLB clip | 时长 | 现有 `CharacterRig` 方法 |
|---|---:|---|
| `idle` | 4.0s | `idle()` |
| `walk` | 1.0s | `walk()` |
| `slot_pull` | 2.6s | `attackSwing()` |
| `flinch` | 0.85s | `flinch()` |
| `dead` | 1.0s | `dead()` |
| `reviveRise` | 1.0s | `reviveRise()` |
| `victory` | 2.8s | `cheer()` |

`slot_pull` 的时间安排：

- `0.00–0.58s`：右手握柄，拉杆下压。
- `0.58–1.57s`：三滚轮旋转。
- `1.57–2.60s`：拉杆回弹并恢复待机姿态。

`victory` 的时间安排：

- `0.00–0.75s`：双手举起，躯干后仰。
- `0.75–2.20s`：庆祝摆动，三滚轮依次旋转并停在开奖角度。
- `2.20–2.80s`：动作收束，回到原始绑定姿态。

骨骼：`Lever`、`Reel.1`、`Reel.2`、`Reel.3`、`UpperArm.R`、`Forearm.R`、`Hand.R`。

注意：`GLTFLoader` 会把带点号的骨骼名规范化为 `HandR`、`Reel1` 等；动画轨道会同步规范化，不需要手动改轨道名。

## 接入建议

当前 `createCharacterAsset(charId)` 是同步工厂，而 `GLTFLoader.loadAsync()` 是异步的，因此这份 GLB 不是可直接塞进现有同步注册表的 drop-in 资产。建议由玩法负责人：

1. 在进入选人/战斗前预加载并缓存 GLB。
2. 用 `AnimationMixer` 建立七个 clip action，再包装成现有 `CharacterRig` 方法。
3. 将 `attackSwing()` 映射到 `slot_pull`，将 `cheer()` 映射到 `victory`。
4. 在服务端角色定义、随机结果和效果结算完成后再注册 `slot-hero`。
5. 决定技能命中/结算时机是在拉杆下压时、滚轮停止时，还是由现有通用技能提交流程统一处理。

适配器必须实现完整 `CharacterRig`，不能只暴露七个动画方法：

- `materials()` 返回去重后的材质数组；`setOpacity()` 遍历这些材质；`headHeight()` 按模型高度和 `root.scale` 计算；`resetPose()` 恢复绑定姿态。
- `cast()`、`drink()`、`crouch()` 没有专项 clip；在补齐专项动画前应显式降级到待机或安全姿态，不能留空。
- 现有场景每帧调用 `idle/walk/attackSwing/cheer/dead/reviveRise` 并传入时间，`CharacterRig` 没有逐帧 `update` 钩子。因此适配器应在每次方法调用中设置 action 时间、采样并暂停 action，不能依赖 mixer 自动播放。`attackSwing(t)` 的 `t∈[0,1]` 映射到 `slot_pull` 的 `t×2.6s`；`dead/reviveRise` 直接使用传入进度。
- 预览页的“结束自动回待机”只属于资产实验室；生产场景仍由现有 pose 状态机负责切换。
- 释放实例时停止并解绑 action，释放几何、材质及材质引用的全部贴图；缓存资产应在引用归零后再释放，多实例使用 `SkeletonUtils.clone()` 避免共享骨骼被单实例销毁。

不要把 `slot_pull` 的整段 2.6 秒强制等同于服务端结算延迟；动画表现和 authoritative gameplay timing 应分开设计。

## 验证结果

- GLB 文件头、版本、声明长度和 SHA-256 均通过。
- 独立 `GLTFLoader` 重载通过：22 骨骼、11 蒙皮网格、11 材质、24 贴图、7 段动画。
- 全部预览按钮通过；`slot_pull` 和 `victory` 结束自动回到 `idle`。
- 独立 GLB 拉杆 261 点密采样中，手与球柄最大误差 `1.26 mm`（0.58s）。
- 胜利动作双手高度采样确认先举起、再庆祝、最后回落；`cheer()` 可直接承载该动作。
- `dead` / `reviveRise` 加入地面支撑补偿；21 点密采样最大穿地 `3.7e-9 m`，仅为浮点误差。
- 预览动画时钟按真实时间推进；在软件渲染低帧率下，技能与胜利分别在约 2.86 秒、2.82 秒回到待机。
- 390px 窄屏无横向溢出；画布为 `390 × 490 CSS px`，胜利按钮存在，右侧说明自然移到画布下方。
- 最终关键帧使用无头 Edge 从页面表面重新截图，避免了 Tabbit 桌面合成层的星芒叠加。
- 浏览器 page error 为零。

## 后续 Agent 接口范式

- 资产 agent 只拥有 `artifacts/collab/slot-hero/`，输出 GLB、`asset-spec.json`、验证证据和本交接文档。
- 演出 agent 只拥有客户端演出注册表与特效，不 import 本目录的 GLB 或贴图。
- 玩法集成 agent 在 Issue 负责人明确授权后，才实现异步缓存和 `CharacterRig` 适配器。
- 依赖方向固定为 `asset-spec.json + GLB -> async loader -> CharacterRig -> 现有场景状态机`；资产不得反向依赖游戏规则或演出组件。
- 两个 PR 独立评审、独立合并。PR 使用 `Refs #72`，不代替 MMR12345 关闭 Issue。

## 限制与后续

- `TRIPO_API_KEY`、`GEMINI_API_KEY`、`ELEVENLABS_API_KEY` 均缺失，未使用外部生成服务。
- 当前是精致的程序化风格化角色，不是影视级写实扫描角色。
- GLB 超过初始 4 MB 目标，主要体积来自蒙皮几何的 position/normal/uv/skinIndex/skinWeight 数据；若上线预算更严格，可在 integrator 侧评估量化或 meshopt，不要牺牲当前拉杆贴合骨骼链。
- 金钱、炸弹、攻击、钥匙的玩法语义、随机规则、数值、服务端校验、音效和共享注册均留给 `MMR12345`。
- 未运行主游戏构建或测试，因为隔离工作区没有修改共享运行时代码。

## 本地预览

预览服务：`http://127.0.0.1:5199`

从主工作区重启：

```bash
node "D:/AI工作区/badian-game/node_modules/vite/bin/vite.js" --config "D:/AI工作区/badian-game-slot-hero-assets/artifacts/collab/slot-hero/vite.config.js"
```

点击「拉动拉杆 · 老虎机技能」查看技能动作；点击「胜利」查看双手庆祝和滚轮开奖；点击「导出 GLB 到 model/」重新生成资产。
