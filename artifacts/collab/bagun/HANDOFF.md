# 拔棍 · bagun-v1 · GLB 交接

最终资产为 `bagun-v1`：蓝紫蒙面、棕色短打、深色腰带与长裤、发髻、红头带和红穗，右手持木棍，左手自然空出。按反馈将头部从球体改为方圆过渡、下颌收直的块面轮廓，避免过度圆润。

## 交付文件

| 文件 | 用途 |
| --- | --- |
| `model/bagun.glb` | 独立 GLB，模型、内嵌贴图、骨架和七段动画 |
| `asset-spec.json` | 坐标、挂点、动画语义、预算、提供方和 SHA-256 |
| `preview/index.html` | 桌面与移动端动作预览、逐帧检查、收棍切换和 GLB 导出 |
| `preview/bagun.js` | 程序化模型、PBR 材质、蒙皮和动画源 |
| `preview/main.js` | Three.js 预览、播放控制和独立 GLB 重载 |
| `validate.mjs` | GLB 结构、动画、浏览器交互和移动布局验证 |
| `evidence/validation.json` | 最终机器可读验证报告 |
| `evidence/preview-*.png` | 最终动作、面部、倒地、起身和移动端截图 |

GLB 为 1,136,108 字节（约 1.14 MB），SHA-256：

```text
aef699797e61ae16da907fafc0cfcf19cb78a8b39755e1f2ec82a04245147f67
```

没有外部模型或贴图依赖，无 Draco 压缩，无外部资源 URI。Tripo 凭据缺失，因此资产完全由本地程序化流程生成，没有调用外部生成服务或产生付费任务。

## 坐标、骨架与木棍契约

单位为米，`+Y` 向上、`+Z` 向前，`Root` 位于脚底地面中心。站立高度约 `2.256744 m`，静态包围盒约 `1.040763 × 2.256744 × 0.669879 m`。所有动画的 `Root.position` 都没有水平位移，行走为原地循环。

模型包含 15 个蒙皮网格、12 个材质、23 根骨骼、10,178 个顶点和 14,596 个三角面。蒙皮权重归一化，无非法索引。手臂和腿部使用跨三个骨骼的连续蒙皮，避免肘、膝和踝断开。

关键节点：

- 身体：`Root`、`Pelvis`、`Spine`、`Chest`、`Neck`、`Head`
- 四肢：`UpperArmL/R`、`ForearmL/R`、`HandL/R`、`ThighL/R`、`ShinL/R`、`FootL/R`
- 服饰：`CoatTail`、`SashTail`
- 木棍：`StickPivot` 是 `HandR` 的子骨骼，`StickGrip` 与右手零偏移
- 可见性：`stick` 是独立分组，包含 5 个木棍网格批次

生产环境必须使用节点名 `stick` 控制显隐，不要复制静态木棍：

```js
const stick = gltf.scene.getObjectByName('stick');
stick.visible = Boolean(snapshot.char.stickDrawn);
```

木棍由右手骨骼驱动，任意动画时刻都保持握点附着。GLB 默认导出为可见状态。

## 动画映射

| Clip | 时长 | 循环 | 用途 |
| --- | ---: | --- | --- |
| `idle` | 4.0 s | 是 | 待机、呼吸、头部和衣摆跟随 |
| `walk` | 1.0 s | 是 | 原地行走，右手携棍 |
| `swing` | 2.2 s | 否 | 右手蓄力、横扫和收势 |
| `flinch` | 0.75 s | 否 | 受击后撤与回防 |
| `dead` | 1.25 s | 否 | 倒地淘汰，木棍不离手 |
| `reviveRise` | 1.25 s | 否 | `dead` 的逐轨道精确倒放 |
| `victory` | 2.8 s | 否 | 竖棍亮相和庆祝 |

`idle` 与 `walk` 使用 `THREE.LoopRepeat`，其余使用 `THREE.LoopOnce`。一次性动作结束后可回到 `idle`，死亡动作保持终点。项目没有单独的拔棍动作，`char.stickDrawn` 只控制木棍可见性；伤害、无视躲避和命中时机仍由规则层负责。

## Three.js 接入

```js
const gltf = await new GLTFLoader().loadAsync('/assets/bagun.glb');
scene.add(gltf.scene);

const mixer = new THREE.AnimationMixer(gltf.scene);
const actions = new Map(gltf.animations.map(clip => [clip.name, mixer.clipAction(clip)]));
actions.get('idle').setLoop(THREE.LoopRepeat, Infinity).play();

const stick = gltf.scene.getObjectByName('stick');
stick.visible = Boolean(snapshot.char.stickDrawn);

// 每帧调用 mixer.update(deltaSeconds)。
```

建议保持 sRGB 输出和 ACES Filmic 色调映射。模型自身包含 BaseColor、Roughness、Metalness 和 Normal 贴图，可离线加载。运行时角色注册、异步生产加载和 `CharacterRig` 适配不在本交付范围内。

## 验证结果

`node artifacts/collab/bagun/validate.mjs` 最终通过全部 30 项检查，包括：

- GLB 2 头、长度一致、资源全部内嵌。
- 23 骨骼、15 蒙皮网格、权重和与索引合法。
- 7 段动画轨道有限、目标存在、四元数归一化。
- 12 套 PBR 材质、48 个已加载贴图。
- `stick` 节点默认可见，隐藏时可关闭其全部 5 个网格批次。
- 右手与 `StickGrip` 在横扫采样中的最大误差为 `0 m`。
- `reviveRise` 对 `dead` 的 141 个采样点最大位置误差约 `1.27e-8`。
- 站立脚底约 `-0.0005 m`，死亡与起身全程最大穿透约 `0.0005 m`。
- 无水平根运动、七个预览按钮可用、一次性动画自动回到待机。
- 390×844 移动布局无横向溢出，浏览器无页面错误。
- 低于 4 MB、65,000 三角面和 20 模型 Draw Call 的目标。

最终截图见 `evidence/preview-idle.png`、`preview-face.png`、`preview-back.png`、`preview-walk.png`、`preview-swing-windup.png`、`preview-swing-sweep.png`、`preview-flinch.png`、`preview-victory.png`、`preview-dead.png`、`preview-revive.png` 和 `preview-mobile-390.png`。

## 复现

从仓库根目录启动本地预览：

```bash
npx vite --config artifacts/collab/bagun/vite.config.js
```

打开 `http://127.0.0.1:5212/`，使用动作按钮或浏览器控制台 `window.__bagun.seek(clip, seconds)` 逐帧检查。点击“导出 GLB”或调用 `window.__bagun.exportGlb()` 可重新生成同名文件。预览服务运行时，在另一个终端执行：

```bash
node artifacts/collab/bagun/validate.mjs
```

本交付仅新增 `artifacts/collab/bagun/` 下的资产工作区文件，没有修改游戏运行时，没有提交、推送、创建 PR 或部署。
