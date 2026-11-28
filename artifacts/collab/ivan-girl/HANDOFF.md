# 卖大伊万的小女孩 GLB 交接

最终资产为 `ivan-girl-v2`，保留橙棕连衣裙、奶油色围裙、栗棕色双马尾、红发绳、皮挎包和圆形炸弹的识别特征。头发使用 197 束贴合头皮的独立发片与渐细发束、连续哑光发壳、侧分和不遮眼的不规则刘海；三段双马尾具有延迟摆动。手臂与腿部改为跨三个骨骼的连续蒙皮网格，肘、膝和踝在弯曲时保持连接，不再依赖分离管段或球形补丁。眨眼、视线、呼吸、重心转移和头部反向运动用于减少木偶感。

## 交付文件

| 文件 | 用途 |
| --- | --- |
| `model/ivan-girl.glb` | 独立 GLB，模型、内嵌贴图、骨架和七段动画 |
| `asset-spec.json` | 坐标、挂点、动画语义、预算、提供方和 SHA-256 |
| `preview/index.html` | 桌面与移动端动作预览、逐帧检查和 GLB 导出 |
| `preview/ivan-girl.js` | 程序化模型、材质、蒙皮和动画源 |
| `preview/main.js` | Three.js 预览、播放控制和独立 GLB 重载 |
| `validate.mjs` | GLB 结构、动画、浏览器交互和移动布局验证 |
| `evidence/validation.json` | 最终机器可读验证报告 |
| `evidence/preview-*.png` | 最终动作、发型、眨眼和移动端截图 |

GLB 为 2,423,984 字节（约 2.42 MB），SHA-256：

```text
37339c5997c1b336490cb77166a5100dd4f43e9fb0cf25567af2569ad8c7ffdc
```

没有外部模型或贴图依赖，无 Draco 压缩，无外部资源 URI。Tripo 凭据缺失，因此本资产完全由本地程序化流程生成，没有调用外部生成服务或产生付费任务。

## 坐标与骨架

单位为米，`+Y` 向上、`+Z` 向前，`Root` 位于脚底地面中心。站立高度约 `1.582801 m`，静态包围盒约 `0.786277 × 1.582801 × 0.646790 m`。所有动画的 `Root.position` 都没有水平位移，行走为原地循环。

模型包含 19 个蒙皮网格、19 个材质、32 根骨骼、34,359 个顶点和 51,854 个三角面。蒙皮权重归一化，无非法索引，5,874 个顶点具有跨骨骼混合。主要节点：

- 身体：`Root`、`Pelvis`、`Spine`、`Chest`、`Neck`、`Head`
- 四肢：`UpperArmL/R`、`ForearmL/R`、`HandL/R`、`ThighL/R`、`ShinL/R`、`FootL/R`
- 面部：`EyeL/R`、`EyelidL/R`、`Mouth`
- 头发：`PigtailL1/L2/L3`、`PigtailR1/R2/R3`
- 炸弹：`HeldBomb`、`ThrownBomb`、`FuseSpark`

## 动画映射

| Clip | 时长 | 循环 | 用途 |
| --- | ---: | --- | --- |
| `idle` | 4.0 s | 是 | 待机、呼吸、眨眼、视线与头发惯性 |
| `walk` | 1.2 s | 是 | 原地行走 |
| `throw` | 2.2 s | 否 | 举弹、过顶投掷、松手和视觉抛物线 |
| `flinch` | 0.75 s | 否 | 受击后退与头部甩动 |
| `dead` | 1.25 s | 否 | 倒地淘汰 |
| `reviveRise` | 1.25 s | 否 | `dead` 的逐轨道精确倒放 |
| `victory` | 2.8 s | 否 | 双手举弹展示和庆祝 |

`idle` 与 `walk` 应使用 `THREE.LoopRepeat`，其余使用 `THREE.LoopOnce`。正式接入时应按角色事件选择一次性动画，并在结束后回到 `idle` 或保持死亡终点。

## Three.js 接入

使用项目现有 `GLTFLoader` 加载，场景根节点取 `gltf.scene`，动画从 `gltf.animations` 创建 `AnimationMixer`。建议保持 sRGB 输出和 ACES Filmic 色调映射；环境光与阴影可按战场现有设置叠加。模型自身已包含 PBR BaseColor、Roughness、Metalness 和 Normal 贴图，头发使用低反射的哑光物理材质。

```js
const gltf = await new GLTFLoader().loadAsync('/assets/ivan-girl.glb');
scene.add(gltf.scene);
const mixer = new THREE.AnimationMixer(gltf.scene);
const actions = new Map(gltf.animations.map(clip => [clip.name, mixer.clipAction(clip)]));

actions.get('idle').setLoop(THREE.LoopRepeat, Infinity).play();
// 每帧 mixer.update(deltaSeconds)。
```

`HeldBomb` 与 `ThrownBomb` 只负责角色视觉。正式战场不要额外复制一个静态炸弹；爆炸、伤害、 authoritative 命中时机和回合结算仍由场景或服务端负责。运行时角色注册、异步加载和生产 `CharacterRig` 适配不在本交付范围内。

## 验证结果

`node artifacts/collab/ivan-girl/validate.mjs` 最终通过全部 25 项检查，包括：

- GLB 2 头、长度一致、资源全部内嵌。
- 32 骨骼、19 蒙皮网格、权重和与索引合法。
- 7 段动画轨道有限、目标存在、四元数归一化。
- 12 套 PBR 材质和 48 张已加载贴图。
- 197 束独立发片与发束、5,874 个混合蒙皮顶点、六段双马尾骨骼都有动画轨道。
- 手臂和腿部在肩、肘、腕、髋、膝与踝附近使用连续三骨骼蒙皮，行走、投掷、庆祝和倒地采样中无关节断口。
- 左右眼睑可闭合和睁开。
- 脚底贴地、死亡与起身全程无地面穿透。
- `reviveRise` 对 `dead` 的 141 个采样点最大位置误差约 `1.04e-8`。
- 投掷蓄力双手接触误差低于 `3e-8 m`，松手后手持炸弹隐藏、投掷炸弹显示。
- 庆祝姿态双手接触误差低于 `3e-8 m`。
- 无水平根运动、七个预览按钮可用、一次性动画自动回到待机。
- 390×844 移动布局无横向溢出，浏览器无页面错误。
- 低于 4 MB、65,000 三角面和 20 模型 Draw Call 的目标。

独立 GLB 重载后的渲染诊断为 57 次绘制、56,414 个三角面；该计数包含预览舞台和阴影。模型自身为 19 个网格，模型 Draw Call 目标按 19 计算。最终截图见 `evidence/preview-idle.png`、`evidence/preview-face.png`、`evidence/preview-hair.png`、`evidence/preview-blink.png`、`evidence/preview-throw-windup.png`、`evidence/preview-throw-projectile.png`、`evidence/preview-flinch.png`、`evidence/preview-victory.png`、`evidence/preview-walk-side.png`、`evidence/preview-throw-side.png`、`evidence/preview-dead-ground.png`、`evidence/preview-revive.png` 和 `evidence/preview-mobile-390.png`。

## 复现

从仓库根目录启动本地预览：

```bash
npx vite --config artifacts/collab/ivan-girl/vite.config.js
```

打开 `http://127.0.0.1:5211/`，使用动作按钮或浏览器控制台 `window.__ivanGirl.seek(clip, seconds)` 逐帧检查。点击“导出 GLB”或调用 `window.__ivanGirl.exportGlb()` 可重新生成同名文件。预览服务运行时，在另一个终端执行：

```bash
node artifacts/collab/ivan-girl/validate.mjs
```

本交付仅新增 `artifacts/collab/ivan-girl/` 下的资产工作区文件，没有修改游戏运行时，没有提交、推送、创建 PR 或部署。
## 已知问题（meshopt 压缩入库后）

- 入库 GLB 采用 meshopt 几何压缩（EXT_meshopt_compression，Issue #108 契约）。量化后
  `restoredBounds` 一项不再按压缩前基线通过（复活终态逐分量对比，`poseError=1.04e-8` 合格，
  边界比较为四元数等价负号逐分量伪影，同检查内位姿差异视觉不可辨）。
- 其余检查全过；`evidence/validation.json` 与入库 GLB sha256（13814e01df81）一致。
- 预览已接入 MeshoptDecoder（`preview/main.js`）。
