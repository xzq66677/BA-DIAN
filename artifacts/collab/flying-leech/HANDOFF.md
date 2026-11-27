# 飞天水蛭 GLB 资产交接

飞天水蛭采用 Q 版造型。圆脑袋上有奶白眼白、蓝莓色虹膜、圆瞳和双高光，配淡粉腮红和微笑。软紫翼鳍、发光触角和带尾吸盘的分节躯体构成飞天水蛭的剪影。玄武岩塔参考用户给出的古塔照片，采用五层逐渐收窄的八角围廊、青灰瓦面、上翘檐角、赭色石墙和细长铜色塔刹。高塔砸下时，落点卷起螺旋气流，飞天水蛭与对方沿同一旋向被拉向塔心。

| 文件 | 内容 | 三角面 | 大小 |
| --- | --- | ---: | ---: |
| [flying-leech.glb](model/flying-leech.glb) | Q 版活体角色，含待机、移动、施法、吸入、吹出、受击与淘汰等 12 段动作 | 26,812 | 288,624 B |
| [flying-leech-spectral.glb](model/flying-leech-spectral.glb) | Q 版灵体，内置 40% 不透明度，含淘汰过渡、灵体待机和复活 | 26,812 | 245,900 B |
| [basalt-tower.glb](model/basalt-tower.glb) | 五层八角翘檐玄武岩塔，含逐层升起和砸落动画 | 34,788 | 986,528 B |
| [wind-vortex.glb](model/wind-vortex.glb) | 五条气流带与十枚流向粒子，含落点捕捉，以及吸入和吹出的对手位移动画 | 680 | 96,524 B |

四个文件均为独立二进制 glTF 2.0。网格、材质和动画均为原创，封装在各自的 GLB 内。关节使用命名节点与 TRS 动画。 [生成源码](src/generate.mjs) · [Khronos glTF 2.0 规范](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)

## 坐标与播放

单位为米，`+Y` 向上，`+Z` 向前。飞行角色根节点在地面基准 `y=0`，网格留有悬空距离。角色动画原地采样，战场位移由场景驱动。完整尺寸、动画时长和 SHA-256 见 [资产规格](asset-spec.json)。

| 演出 | 资产动画和挂点 |
| --- | --- |
| 造塔 | 飞天水蛭播放 `cast`，高塔在当前房间播放 `build` |
| 投塔 | 角色播放 `attack`，高塔播放 `strike`。本地轨迹沿 `+Z`，落点距塔起点约 3.18 米，示例命中点为 0.93 秒 |
| 双人卷入 | 高塔触地时在落点的 `VortexAnchor` 播放 `capture`，旋转和缩放见规格中的 `vortexCapture`。两名角色同步沿螺旋向塔心收拢，缩小并消失在石塔后方 |
| 吸入对手 | 施术者和气流同时播放 `inhale`。目标跟随气流 GLB 的 `WindTargetMotion`，从远处被卷起并拉至水蛭面前 |
| 吹出对手 | 施术者和气流同时播放 `exhale`。目标跟随同一个 `WindTargetMotion`，从近处被顶起、抛远并落地 |
| 淘汰灵体 | 活体和灵体同步采样 `dead`，在过渡段交叉淡入淡出。结束后灵体持续保持 40% 不透明度，可循环 `dead_idle` |

高塔的投掷距离与命中时间是资产预览设定。正式适配应以权威事件中的房间、双方 PID、落点和结果为准，按实际方向和距离映射局部轨迹。伤害、回合状态与房间变更由权威规则结算。战场接入按现有工作流预加载 GLB、按实例隔离可变材质，再适配 `CharacterRig` 与公开演出事件。正式角色 ID 为 `water-snake`，资产目录沿用 `flying-leech`。

定向气流从飞天水蛭的 `WindOrigin` 指向对手。对手轨迹在局部 `+Z` 轴上移动，`X` 为侧向偏移，`Y` 从对手所在的地面高度算起。预览使用石偶作为对手，可分别点「吸入对手」「吹出对手」播放。两段动作均已在 Chromium 中验证起点、空中翻摆与落地。正式对局的角色、有效位移与落点由权威快照提供。 [吸入动图](evidence/inhale-opponent.gif) · [吹出动图](evidence/exhale-opponent.gif)

## 复现与预览

```powershell
node artifacts/collab/flying-leech/src/generate.mjs
node artifacts/collab/flying-leech/src/verify.mjs
npx vite --host 127.0.0.1 --port 5177
```

预览路径为 `/artifacts/collab/flying-leech/preview/`，可连续播放、选择动作或拖动进度。验证脚本支持 `--asset-only`，也可用 `FLYING_LEECH_BROWSER_PATH` 指定 Chromium 可执行文件。 [验证报告](evidence/validation.json)

四个 GLB 均通过加载、哈希、动画和材质检查。桌面 Chromium（1280×800）复测了键盘启动投塔、落点漩涡驱动双方同步收拢、最终消失及灵体材质。390×844 触屏视口复测了点击、减少动态效果和布局。最终卷入镜头调整了对手的轨迹，以便两名角色在漩涡两侧同时入镜。 [角色特写](evidence/01-idle.png) · [双人卷入](evidence/04-capture.png) · [灵体](evidence/07-spectral.png)

正式对局的造塔和吸吹接线见 [四角色资产、规则与战斗演出接入](../../../docs/FOUR_CHARACTER_INTEGRATION.md)。
