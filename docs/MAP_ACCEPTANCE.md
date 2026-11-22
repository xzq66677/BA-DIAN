# V5 地图验收记录

交付分支为 `feat/v5-floating-ruins`，地图核心提交为 `e27796d`，基线为 GitHub `main` 的 `d55555d`。主分支的 11 个专属角色 rig、引擎和房间规则随基线纳入交付。地图变更只为重连补发包增加一个兼容标记，结算规则由原引擎执行。

## 复现

```powershell
npm run build
npx tsc -p client/tsconfig.json --noEmit
npm test
npx tsx scripts/map-match.ts
node scripts/map-sample.mjs ruins
```

本机使用 Edge 时为测试进程设置 `CHROMIUM_PATH` 指向 Edge 可执行文件，安装 Playwright Chromium 的环境可直接运行。浏览器与 Socket.IO 测试依赖本机临时回环端口。Windows 下 Vite 的 esbuild 临时文件遇到访问冲突时，浏览器测试将子进程临时目录隔离到 `.tmp-build`，构建产物继续独立写入 `client/dist-e2e`。

## 阶段与用例

| 范围 | 验收方法 | 证据 |
| --- | --- | --- |
| Phase 0 · 基线 | 核对初始工作树、GitHub 最新提交、角色资产、Socket.IO 和快照字段 | [架构审计](MAP_ARCHITECTURE.md) · [旧本地基线](screenshots-v5-map/baseline.png) · [现行主分支基线](screenshots-v5-map/baseline-main.png) |
| Phase 1 · 布局和输入 | 测试 2–20 房间与 20 个唯一泊位。浏览器操作房间选择、三人同房、空房、淘汰、换房、重开与二次行动排序出拳 | [空间证据](screenshots-v5-map/03-same-room.png) · [实战记录](screenshots-v5-map/match.json) |
| Phase 2 · 竞技场与画面 | 四位角色全景、窄屏可操作性、标准与精简开关、2D 回退、卸载后活跃上下文为零 | [全景](screenshots-v5-map/01-overview.png) · [窄屏](screenshots-v5-map/04-portrait.png) |
| Phase 3 · 导演和反馈 | 单体伤害与回复。范围预警先于伍六七各段。大伊万跨平局持续警示，房间移出后空炸、移入后实际命中，冲击先于扣血/淘汰和弹层 | [待爆](screenshots-v5-map/02-pending.png) · [范围预警](screenshots-v5-map/05-aoe.png) · [爆炸](screenshots-v5-map/06-blast.png) · [胜者](screenshots-v5-map/08-winner.png) |
| 镜头控制 | 用例覆盖优先级、重复合并、手动边界、复位、跳过及胜者和平局预设。浏览器操作拖动、滚轮、复位、自动镜头开关和全部跳过 | [镜头测试](../tests/ui/map-playback.test.ts) · [实战记录](screenshots-v5-map/match.json) |
| 联机与 AI | 双浏览器断线期间另一座位移动，重连后按快照落位，历史动画不回放，新一轮出拳广播恢复。AI 局运行至终局 | [联机与 AI 记录](screenshots-v5-map/match.json) |
| 资源 | 同房重开复用 Canvas，四次 2D/3D 来回切换峰值一个活跃上下文。主动制造真实上下文丢失，等待后落到可操作的 2D 牌桌 | [实战记录](screenshots-v5-map/match.json) |
| 规则兼容 | 上游判定、角色、联机及输入 E2E 回归。未命中、复活、平局、队列冲刷与高频增量去重由自动化覆盖 | [事件测试](../tests/battle-events.test.ts) · [地图顺序测试](../tests/ui/map-playback.test.ts) |

## 实测限制

帧率取证使用 Windows、Edge 与 SwiftShader 软件渲染。硬件 GPU、真实 iOS/Android、20 人联机长局和系统主动恢复失效的 WebGL 上下文尚未实测。桌面与窄屏的对局截图来自真浏览器。大房间容量数据来自布局和泊位测试。浏览器实战覆盖胜利终局。同归于尽和平局镜头预设由规则与镜头测试覆盖。未命中已由真实引擎事件用例检查，浏览器截图矩阵未单独录制该动作。

## 同阵容软件渲染对照

两次采样均为 1440 × 900 视窗和 1440 × 851 绘制缓冲，角色为大伊万、伍六七、两名无业游民。待机暖机后各取三个约 1.6 秒窗口，表中填中位显示速率。基线的三个丢失事件来自主动释放探测上下文。

| 指标 | `d55555d` 原始场景 | 悬浮遗迹 |
| --- | ---: | ---: |
| 待机实际绘制帧率 | 11.16 fps | 17.49 fps |
| 单帧 draw calls | 181 | 169 |
| 单帧三角形 | 14,768 | 11,664 |
| 渲染器几何计数 | 140 | 169 |
| 纹理计数 | 1 | 1 |
| 初次进局累计创建 WebGL 上下文 | 4 | 1 |

[基线样本](screenshots-v5-map/baseline-main.json) · [新版样本](screenshots-v5-map/ruins.json) · [新版同阵容截图](screenshots-v5-map/ruins.png)

基线复现时，先在独立目录构建 `d55555d`，将 `MAP_SAMPLE_REPO` 指向该目录，再运行 `node scripts/map-sample.mjs baseline-main`。工作区旧分支的早期截图与统计也一并保留。

## 最终命令结果

| 命令 | 结果 |
| --- | --- |
| `npm run build` | 服务端 TypeScript 及客户端 Vite 生产构建通过，客户端转换 118 个模块 |
| `npx tsc -p client/tsconfig.json --noEmit` | 通过 |
| `npx tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --skipLibCheck --strict scripts/map-match.ts` | 浏览器验收脚本类型检查通过 |
| `npm test` | 27 个测试文件，481 个用例全部通过，含 5 个真实浏览器 E2E 与 152 个专属角色资产用例 |
| `npx tsx scripts/map-match.ts` | 四人第 9 回合终局，重开后真实走完二次排序。双浏览器断线恢复和 AI 完整对局通过。四次渲染器来回切换的活跃上下文峰值为 1，模拟丢失后回落为 0 |

[完整对局事件和观测值](screenshots-v5-map/match.json)
