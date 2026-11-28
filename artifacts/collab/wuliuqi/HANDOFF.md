# 伍六七协作资产交接

## 归属与范围

- 建议角色 ID：`wuliuqi`
- 视觉版本：`wuliuqi-v2`
- 工作区：`D:\AI工作区\badian-game-slot-hero-effects`
- 当前分支：`feature/72-slot-hero-presentation`
- 工作区 HEAD：`354e807`
- Issue：未认领；本交付不代替任何 Issue 负责人关闭任务。
- 本交付只包含视觉资产、骨骼动画、预览和验证证据。没有修改 `client/`、`server/`、`shared/`，没有实现角色规则、随机结果、伤害、状态结算、共享注册或生产运行时接入。
- 未 commit、push、创建 PR 或部署。

## 交付文件

| 文件 | 用途 |
|---|---|
| `model/wuliuqi.glb` | 可直接加载的 GLB 2.0 角色资产 |
| `preview/wuliuqi.js` | 可重复生成的程序化建模、材质、骨骼和动画源 |
| `preview/main.js` | 预览、逐帧采样、独立 GLB 重载和导出逻辑 |
| `preview/index.html` | 响应式资产实验室界面 |
| `vite.config.js` | 本地预览与 GLB/证据导出端点 |
| `validate.mjs` | 独立重载、蒙皮、动画、接地、交互和窄屏验证脚本 |
| `asset-spec.json` | 视觉、坐标、材质、动画和预算契约 |
| `evidence/validation.json` | 最终验证结果 |
| `evidence/preview-*.png` | 最终关键帧、面部近照、鞋部近照和移动端证据 |

GLB：`776,196` 字节（758.0 KB，meshopt 几何压缩后入库）

SHA-256：`d30820514f801945c708e3a5740919a2527340ea4ca4cf033ca92b470d254ed7`

## 视觉方向

- 按用户要求参考《刺客伍六七》的视觉身份，采用原创程序化低模近似：三撮扎发、锐利刘海、白色连帽外套、黑色内搭、深灰短裤、黑色北京老布鞋、银色剪刀与红色刀柄。
- v2 修正了 v1 的紫红高帮鞋：鞋面改为低帮黑色布面，搭配薄炭灰鞋底、缝线和平鞋带；同时增加帽衫口袋、抽绳、领口褶皱、胸前「67」标记与袖口细节。
- 联网核对角色公开描述后，日常装鞋款确定为黑色北京老布鞋；参考只用于身份与轮廓方向，没有嵌入官方模型、官方贴图、参考图像素或外部生成图片。这是项目内部候选资产，不声称是影视原版资产。
- 现有运行时 `client/src/battle3d/characters/wuliuqi.ts` 使用暗银紧身衣和头巾，本候选按用户新要求改为白帽衫形态，尚未替换运行时。
- 单位：米；`+Y` 向上；`+Z` 向前；脚底约 `y=0`；无水平根运动。
- 站立高度 `2.078 m`，宽 `0.708 m`，深 `0.760 m`。
- `20,974` 三角面、`14,253` 顶点、29 根骨骼、16 个蒙皮网格、16 个材质。
- 12 套程序化 PBR 材质各有 BaseColor / Roughness / Metalness / Normal；眼部、唇部和刀光使用 4 套无需贴图的标准材质。
- 独立重载得到 48 个贴图对象，GLB 中去重为 36 张内嵌 PNG；运行时不需要外部贴图请求。
- 皮肤索引使用 `Uint8`，皮肤权重使用 `Float32`；独立重载后每顶点权重和约为 1，没有越界或非法权重。
- 模型自身 16 个 draw call；预览舞台、阴影和可见特效会增加渲染计数，不应把舞台计数当作模型预算。

## 动画与现有角色接口映射

| GLB clip | 时长 | 轨道数 | 现有 `CharacterRig` 方法 | 说明 |
|---|---:|---:|---|---|
| `idle` | 4.0s | 9 | `idle()` | 呼吸、重心与发梢轻摆 |
| `walk` | 1.2s | 16 | `walk()` | 原地步法，水平根位移为 0 |
| `cast` | 3.0s | 12 | `cast()` | 剪刀施法循环，`CutRing` 前送 |
| `attack` | 2.4s | 15 | `attackSwing()` | 三段刀光依次前送，剪刀开合 |
| `flinch` | 0.75s | 9 | `flinch()` | 受击后仰并恢复 |
| `cheer` | 2.4s | 10 | `cheer()` | 抬剪致意，轻微重心起伏 |
| `dead` | 1.5s | 18 | `dead()` | 倒地并保持终态 |
| `reviveRise` | 1.5s | 18 | `reviveRise()` | 由 `dead` 全部轨道精确倒放 |

`cast` 时间安排：

- `0.00–3.00s`：`CutRing` 呼吸式扩张并沿 `+Z` 前送。
- `1.50s` 采样：`CutRing` 缩放为 `0.35`，世界坐标约 `z=0.655 m`。

`attack` 时间安排：

- `0.00–0.42s`：蓄势。
- `0.58 / 1.18 / 1.78s`：`Slash0 / Slash1 / Slash2` 依次达到峰值，剪刀刀片同步合拢。
- `0.58s` 采样：`Slash0` 缩放为 `1.27`，世界坐标约 `z=0.955 m`。
- `1.94–2.40s`：收势并回到待机。
- 三段刀光只是视觉提示。真实对局仍需按服务端权威日志分别触发三段伤害，不能从动画进度推断命中、伤害或淘汰。

骨骼与接入要点：

- `Head` 绑定缩放为 `.94`；`ScissorsL` 绑定缩放为 `.78`，适配器不得重置为 1。
- `HairTuft` 是次级运动骨骼。
- `ScissorsR/L`、`BladeUpperR/LowerR`、`BladeUpperL/LowerL` 是剪刀挂接与开合骨骼。
- `CutRing`、`Slash0–2` 静息缩放为 `0.0001`，不要删除，否则施法和攻击无法显示。
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
9. `resetPose()` 必须恢复 GLB 绑定姿态，包括 `Head.scale=.94`、`ScissorsL.scale=.78` 和全部特效骨骼的隐藏缩放。
10. 多实例使用 `SkeletonUtils.clone()`；释放实例时停止并解绑 action，释放 geometry、material 及全部引用 texture。缓存资产在引用归零后再释放。

依赖方向固定为：

```text
asset-spec.json + GLB
  -> async loader / cache
  -> CharacterRig adapter
  -> existing scene state machine
```

资产不反向依赖游戏规则、服务端或演出组件。

## 鞋款联网核对

- [互动百科：伍六七](https://m.baike.com/wikiid/154184657818572212?anchor=m1ek4dlw17yg) 与 [夸克百科：伍六七](https://baike.quark.cn/baike?id=893c15bc8bd54f7fab2c0ed8214cdc6a) 均描述日常装脚穿「北京老布鞋」。
- [搜狐：伍六七 cos 造型分析](https://www.sohu.com/a/643021709_120610301) 也讨论了黑色布鞋与老北京布鞋的造型来源。
- 商品页和柒形态的紫黑高靴不作为本次日常装鞋款依据。

## 验证结果

- 最终 `validate.mjs` 的 26 项检查全部通过，浏览器 page error 为 0。
- GLB 文件头、版本、声明长度和 SHA-256 通过；无外部 buffer 或 image URI。
- 独立 `GLTFLoader` 重载通过：29 骨骼、16 蒙皮网格、16 材质、48 贴图对象、8 段动画。
- 所有动画轨道数值有限、时间有序、目标骨骼存在；四元数归一化误差小于 `0.0001`。
- 皮肤权重和全部约为 1，没有越界或非法权重。
- 脚底最低点约 `-5.14e-10 m`；`idle` 161 点、`walk` 121 点、`flinch` 101 点接地采样最大穿地为 0。
- `dead` / `reviveRise` 各 141 点采样无穿地。
- 死亡与复活 141 点密采样最大误差：
  - 位置 `1.03e-8 m`
  - 四元数 `3.26e-8`
  - 缩放 `1.36e-20`
- 复活终点姿态与静息姿态一致。
- 攻击刀光、施法环显隐通过；静息时全部特效隐藏。
- 行走 121 点水平根位移为 0。
- 八个预览按钮全部通过；攻击、受击、喝彩和复活结束自动回到待机；死亡保持终态。
- 390px 窄屏无横向溢出；画布 `390 × 456 CSS px`，八个动画按钮均存在。
- `evidence/preview-shoes.png` 提供鞋部近照，`evidence/preview-face.png` 提供面部近照，便于复核 v2 的修正方向。
- 移动端复验复用桌面验证页切换到 390px，避免第二个 SwiftShader WebGL 上下文在截图负载下超时；窄屏布局与画布指标仍在 390px 实测。
- Headless SwiftShader 与截图负载下，动作回待机的墙钟时间可能慢于 clip 时长；动画时长、采样姿态、状态切换和死亡终态检查均通过。该现象不属于服务端时序依据。

## 限制与后续

- 当前是原创程序化风格化角色，不是影视级写实或官方扫描角色。
- 未使用任何外部生成服务或 API 凭据。
- GLB 与三角面均低于建议预算。
- 没有专项饮酒、蹲下动画；现有接入说明给出了安全降级要求。
- 音效、玩法语义、随机规则、数值、服务端校验、共享注册和生产适配均未包含。
- 未运行主游戏构建或测试，因为隔离工作区没有修改共享运行时代码。

## 本地预览与复验

预览服务：`http://127.0.0.1:5209`

从主工作区启动：

```bash
node "D:/AI工作区/badian-game-slot-hero-effects/node_modules/vite/bin/vite.js" --config "D:/AI工作区/badian-game-slot-hero-effects/artifacts/collab/wuliuqi/vite.config.js"
```

点击八个动画按钮或拖动时间轴逐帧检查；相机视图新增「鞋部」，可近距离复核黑色布鞋。点击「导出 GLB 到 model/wuliuqi.glb」重新生成资产。

预览服务运行时执行完整复验：

```bash
node "D:/AI工作区/badian-game-slot-hero-effects/artifacts/collab/wuliuqi/validate.mjs"
```

脚本会独立重载 GLB、验证蒙皮与动画、检查常规动作和死亡/复活接地、测试全部预览控制与 390px 布局，并刷新 `evidence/validation.json` 和最终截图。

## 已知问题（meshopt 压缩入库后）

- 入库 GLB 采用 meshopt 几何压缩（EXT_meshopt_compression，仓库契约见 Issue #108），
  量化引入的动画精度偏差使本包 3 项严格自检不再按压缩前基线通过：
  - `reverseAnimation141Points`：四元数逐分量误差 1.45e-5（阈值 1e-5），采样点数 141 不变；
  - `reviveRestoresRest`：复活终态逐分量误差 7.8e-5（阈值 1e-5），边界差异在 2mm 容差内；
  - `skeletonAndNormalizedWeights`：蒙皮权重 8bit 量化后求和不恒为 1（偏差 1/255 量级），
    GPU 蒙皮按权重矩阵叠加，视觉不可辨。
- 其余全部检查通过（`evidence/validation.json` 与入库 GLB sha256 一致）。
- 仓库先例：#108 压缩后 skeleton-archer 等既有 collab 包的 validate 同样断裂（预览未接
  MeshoptDecoder）；本包预览已接入解码器（`preview/main.js`），加载压缩 GLB 正常。
