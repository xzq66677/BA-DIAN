# 吹箫哥协作资产交接

## 归属与范围

- 建议角色 ID：`chuixiao`
- 视觉版本：`chuixiao-v1`
- 工作区：`D:\AI工作区\badian-game-slot-hero-effects`
- 当前分支：`feature/72-slot-hero-presentation`
- 工作区 HEAD：`354e807`
- Issue：未认领；本交付不代替任何 Issue 负责人关闭任务。
- 本交付只包含视觉资产、骨骼动画、预览和验证证据。没有修改 `client/`、`server/`、`shared/`，没有实现角色规则、随机结果、伤害、状态结算、共享注册或生产运行时接入。
- 未 commit、push、创建 PR 或部署。

## 交付文件

| 文件 | 用途 |
|---|---|
| `model/chuixiao.glb` | 可直接加载的 GLB 2.0 角色资产 |
| `preview/chuixiao.js` | 可重复生成的程序化建模、材质、骨骼和动画源 |
| `preview/main.js` | 预览、逐帧采样、独立 GLB 重载和导出逻辑 |
| `preview/index.html` | 响应式资产实验室界面 |
| `vite.config.js` | 本地预览与 GLB/证据导出端点 |
| `validate.mjs` | 独立重载、蒙皮、动画、接地、交互和窄屏验证脚本 |
| `asset-spec.json` | 视觉、坐标、材质、动画和预算契约 |
| `evidence/validation.json` | 最终验证结果 |
| `evidence/preview-*.png` | 最终关键帧、面部近照和移动端证据 |

GLB：`753,384` 字节（735.7 KB，meshopt 几何压缩后入库）

SHA-256：`aafd92cc939cb35b5980cde6f2379a3fc03886d3de78438776fa45192cf4dae2`

## 视觉与资产契约

- 原创风格化吹箫哥：青衫墨冠、米白内衬、玉箫、束发与青玉音环。造型参考既有角色卡和运行时视觉，仅用于身份与轮廓方向，没有嵌入参考图片或外部网格。
- 单位：米；`+Y` 向上；`+Z` 向前；脚底约 `y=0`；无水平根运动。
- 站立高度 `2.168 m`，宽 `0.932 m`，深 `0.775 m`。
- `17,532` 三角面、`11,241` 顶点、29 根骨骼、16 个蒙皮网格、16 个材质。
- 12 套程序化 PBR 材质各有 BaseColor / Roughness / Metalness / Normal；眼部、唇部和音效使用 4 套无需贴图的标准材质。
- 独立重载得到 48 个贴图对象，GLB 中去重为 36 张内嵌 PNG；运行时不需要外部贴图请求。
- 皮肤索引使用 `Uint8`，皮肤权重使用归一化 `Uint8`；独立重载后每顶点权重和均为 1，最大皮肤索引为 28。
- 模型自身 16 个 draw call；预览舞台、阴影和可见特效会增加渲染计数，不应把舞台计数当作模型预算。

## 动画与现有角色接口映射

| GLB clip | 时长 | 轨道数 | 现有 `CharacterRig` 方法 | 说明 |
|---|---:|---:|---|---|
| `idle` | 4.0s | 14 | `idle()` | 呼吸、重心、衣袂与发梢轻摆 |
| `walk` | 1.2s | 19 | `walk()` | 原地步法，水平根位移为 0 |
| `cast` | 3.0s | 15 | `cast()` | 吹箫施法循环，箫气与三段音环前送 |
| `attack` | 2.4s | 19 | `attackSwing()` | 蓄势后三枚音符与音环前送，再收势 |
| `flinch` | 0.75s | 14 | `flinch()` | 受击后仰并恢复 |
| `cheer` | 2.4s | 14 | `cheer()` | 抚箫致意，衣袂轻扬 |
| `dead` | 1.5s | 22 | `dead()` | 倒地并保持终态 |
| `reviveRise` | 1.5s | 22 | `reviveRise()` | 由 `dead` 全部轨道精确倒放 |

`cast` 的时间安排：

- `0.00–3.00s`：`Qi` 持续脉冲，三段音环按相位差循环扩张并沿 `+Z` 前送。
- `1.50s` 采样：`SoundRing0` 缩放为 `1.25`，位置约 `z=1.03 m`。

`attack` 的时间安排：

- `0.00–0.92s`：蓄势，箫气增强。
- `1.02 / 1.12 / 1.22s`：三枚音符依次显现并前送。
- `1.25s` 采样：`Note0` 缩放为 `1`，位置约 `z=0.8445 m`。
- `2.04–2.40s`：特效收束，动作回待机。

骨骼与接入要点：

- 头部骨骼 `Head` 的绑定缩放为 `.92`，适配器不得重置为 1。
- 长袍下摆跟随 `Pelvis`，中段混合 `Pelvis/Spine`，上段混合 `Spine/Chest`。
- `SashTailL`、`SashTailR`、`HairTail` 是独立的次级运动骨骼。
- `Flute` 是挂接骨骼；`Qi`、`SoundRing0–2`、`Note0–2` 是演出特效骨骼。
- 上述特效骨骼静息缩放为 `0.0001`，不要删除，否则施法和攻击无法显示。
- `idle`、`walk`、`flinch`、`dead`、`reviveRise` 的 `Root.position.y` 用于垂直贴地修正；水平根位移始终为 0。

## 接入建议

当前 `createCharacterAsset(charId)` 是同步工厂，而 `GLTFLoader.loadAsync()` 是异步的，因此这份 GLB 不是可直接塞进现有同步注册表的 drop-in 资产。由玩法/集成负责人在明确授权后：

1. 进入选人/战斗前预加载并缓存 GLB。
2. 用 `AnimationMixer` 建立八个 clip action，再包装成完整 `CharacterRig`。
3. `attackSwing(t)` 的 `t∈[0,1]` 映射到 `attack` 的 `t×2.4s`；`flinch/dead/reviveRise` 同样按进度映射。
4. `cast` 使用场景时钟循环；`idle`、`walk` 也按循环处理。
5. `drink`、`crouch` 没有专项 clip，应显式降级到安全待机姿态。
6. 服务端权威规则决定命中、伤害和淘汰；资产只负责表现，不得从动画推断结果或结算时机。
7. 适配器必须实现 `materials()`、`setOpacity()`、`headHeight()`、`resetPose()` 和全部姿态方法。
8. 现有场景每帧调用姿态方法，没有逐帧 `update` 钩子。适配器应在每次方法调用中设置 action 时间、采样并暂停 action，不能依赖 mixer 自动播放。
9. `resetPose()` 必须恢复 GLB 绑定姿态，包括 `Head.scale=.92` 和全部特效骨骼的隐藏缩放。
10. 多实例使用 `SkeletonUtils.clone()`；释放实例时停止并解绑 action，释放 geometry、material 及全部引用 texture。缓存资产在引用归零后再释放。

依赖方向固定为：

```text
asset-spec.json + GLB
  -> async loader / cache
  -> CharacterRig adapter
  -> existing scene state machine
```

资产不反向依赖游戏规则、服务端或演出组件。

## 验证结果

- 最终 `validate.mjs` 的 25 项检查全部通过，浏览器 page error 为 0。
- GLB 文件头、版本、声明长度和 SHA-256 通过；无外部 buffer 或 image URI。
- 独立 `GLTFLoader` 重载通过：29 骨骼、16 蒙皮网格、16 材质、48 贴图对象、8 段动画。
- 所有动画轨道数值有限、时间有序、目标骨骼存在；四元数归一化误差小于 `0.0001`。
- 皮肤权重和全部为 1，没有越界或非法权重。
- 脚底最低点约 `-5.36e-9 m`；`idle` 161 点、`walk` 122 点、`flinch` 101 点接地采样最大穿地均小于 `0.002 m`。
- `dead` / `reviveRise` 各 141 点采样无穿地，最大数值误差约 `5.36e-9 m`。
- 死亡与复活 141 点密采样最大误差：
  - 位置 `1.26e-8 m`
  - 四元数 `3.25e-8`
  - 缩放 `1.36e-20`
- 复活终点姿态与静息姿态一致。
- 攻击音符、施法音环显隐通过；静息时全部特效隐藏。
- 行走 121 点水平根位移为 0。
- 八个预览按钮全部通过；攻击、受击、喝彩和复活结束自动回到待机；死亡保持终态。
- 390px 窄屏无横向溢出；画布 `390 × 473 CSS px`，八个动画按钮均存在。

## 限制与后续

- 当前是精致的程序化风格化角色，不是影视级写实扫描角色。
- 未使用任何外部生成服务或 API 凭据。
- GLB 与三角面均低于建议预算。
- 没有专项饮酒、蹲下动画；现有接入说明给出了安全降级要求。
- 音效、玩法语义、随机规则、数值、服务端校验、共享注册和生产适配均未包含。
- 未运行主游戏构建或测试，因为隔离工作区没有修改共享运行时代码。

## 本地预览与复验

预览服务：`http://127.0.0.1:5208`

从主工作区启动：

```bash
node "D:/AI工作区/badian-game/node_modules/vite/bin/vite.js" --config "D:/AI工作区/badian-game-slot-hero-effects/artifacts/collab/chuixiao/vite.config.js"
```

点击八个动画按钮或拖动时间轴逐帧检查；点击「导出 GLB 到 model/」重新生成资产。

预览服务运行时执行完整复验：

```bash
node "D:/AI工作区/badian-game-slot-hero-effects/artifacts/collab/chuixiao/validate.mjs"
```

脚本会独立重载 GLB、验证蒙皮与动画、检查常规动作和死亡/复活接地、测试全部预览控制与 390px 布局，并刷新 `evidence/validation.json` 和最终截图。

## 已知问题（meshopt 压缩入库后）

- 入库 GLB 采用 meshopt 几何压缩（EXT_meshopt_compression，仓库契约见 Issue #108），
  量化引入的动画精度偏差使本包 2 项严格自检不再按压缩前基线通过：
  - `reverseAnimation141Points`：四元数逐分量误差 1.24e-5（阈值 1e-5），采样点数 141 不变；
  - `reviveRestoresBoundary`：`revivedPoseError=1.698` 为四元数等价负号（q 与 -q 同旋转）的
    逐分量对比伪影；同检查内的 rest/revive 边界差异 < 1e-5 米，视觉完全一致。
- 其余全部检查通过（`evidence/validation.json` 与入库 GLB sha256 一致）。
- 仓库先例：#108 压缩后 skeleton-archer 等既有 collab 包的 validate 同样断裂（预览未接
  MeshoptDecoder）；本包预览已接入解码器（`preview/main.js`），加载压缩 GLB 正常。
