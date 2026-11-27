# 鬼影 GLB 交接

鬼影采用深尖兜帽、棱角裂纹面具、细长手指、破碎披风和向后卷曲的雾尾。附身时沿宿主的局部 `-Z` 滑到背后，保留侧向距离以便辨认。吸血以青色能量从宿主方向收回胸前表现。受伤时肩部和头部向后甩动，死亡时躯体在原地收缩，化成六缕纤细的青烟，向上卷散。

资产位于 `artifacts/collab/ghost/`，正式角色 ID 为 `ghost`。运行时接线见 [四角色资产、规则与战斗演出接入](../../../docs/FOUR_CHARACTER_INTEGRATION.md)。

| 文件 | 用途 |
| --- | --- |
| `model/ghost.glb` | 模型和六段动画，GLB 共 477,532 字节、10,734 三角面、10 材质 |
| `asset-spec.json` | 坐标、挂点、动画、预算和 SHA-256 |
| `src/generate.mjs` | 仅依赖项目 Three.js 的可复现生成源 |
| `src/attachment.mjs` | 通用宿主跟随接口，带类型文档 |
| `src/ghost-visual.mjs` | 鬼影 GLB 实例化、动画采样、透明度和资源释放 |
| `preview/index.html` | 动作和宿主切换预览，两种宿主都可移动 |
| `evidence/validation.json` | 可复现核验结果 |

静态模型高约 1.91 米，脚底基准为 `y=0`，`+Y` 向上、`+Z` 向前。GLB 使用可独立编辑的关节节点和烘焙的平移、旋转、缩放轨道。烟化几何和吸取能量轨道已经随 GLB 封装，透明度曲线由 `ghost-visual.mjs` 在运行时叠加。多实例各自持有可变材质，GLB 缓存持有共享几何。

## 通用附身接口

```js
const visual = createGhostVisual(preloadedGltf);
const binding = createAttachment(visual, { duration: 0.72, opacity: 0.36 });
scene.add(visual.root);

// 默认使用宿主的 +Z 朝向，负 Z 为背后。
binding.attach({ root: hostRig.root });

// 可选挂点可随宿主骨架运动，offset 在此挂点的局部坐标系下计算。
binding.attach({ root: hostRig.root, anchor: customAnchor, offset: [0.42, 0.15, -0.87] });

// 每帧先完成宿主的位置与骨架更新，再调用一次 update，单位为秒。
const entryProgress = binding.update(deltaSeconds);
if (binding.active && entryProgress < 1) visual.sample('attach', entryProgress);
if (binding.active && entryProgress === 1) visual.sample('attached_idle', (timeSeconds % 2.5) / 2.5);

// 在结束附身、切换模式、销毁场景时解除挂载。
binding.detach();
visual.dispose();
```

`createAttachment` 接受任何提供 `root` 与 `setOpacity(multiplier)` 的角色。默认背后偏移为 `[0.38, 0.12, -0.86]` 米，入场完成时将现有材质透明度乘以 `0.36`。同一宿主重复调用保持进度，换宿主时从当前世界变换和透明度滑过去。解除时保留当前世界位置并恢复透明度，宿主或挂点离开对应层级时自动解除。场景可从该位置继续驱动角色移动，或按权威快照恢复泊位。

正式适配时由公开事件或快照提供宿主 PID，按场景角色表解析宿主根节点。上面的帧循环仅说明附身过渡，吸血、受击和死亡可继续调用 `binding.update(deltaSeconds)`，同时优先采样 `drain`、`flinch` 或 `dead`。释放 GLB 缓存前先销毁其全部角色实例。

## 复现

从仓库根目录执行下列命令。`verify.mjs` 检查 GLB、挂点跟随、独立透明度、特效状态和资源释放。默认同时运行桌面和移动 Chromium 验证，`--asset-only` 可独立跑资产与接口检查。

```powershell
node artifacts/collab/ghost/src/generate.mjs
node artifacts/collab/ghost/src/verify.mjs
npx vite --host 127.0.0.1 --port 5177
```

预览入口为 `/artifacts/collab/ghost/preview/`。Chromium 安装在自定义位置时可用环境变量 `GHOST_BROWSER_PATH` 指向其可执行文件。已有本机预览服务时，可用 `GHOST_PREVIEW_URL` 指向该入口。

专项资产和接口核验通过。实际 Chromium 在 `1280×860` 与 `390×844` 上通过宿主切换、跟随、鼠标、键盘与移动触控检查。重复播放时已预热的渲染资源数量稳定，错误日志为空。证据见 [验证报告](evidence/validation.json) 和 [青烟关键帧](evidence/05-smoke.png)。
