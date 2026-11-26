# TASKS.md · 拔典开发任务追踪

> 原始开发记录：2026-11-19 15:19 — 16:16（约 1 小时）。

## 未完成任务汇总

2026-11-23 核对 GitHub `main`（`b1fa2d0`）、Issue 和 PR。历史明细按原章节顺序接续，历史轮次标题记录当时的状态。 [云端提交](https://github.com/xzq66677/BA-DIAN/commit/b1fa2d0b801e164afc712fee717b749a844cdb91) · [开放 Issue](https://github.com/xzq66677/BA-DIAN/issues?q=is%3Aissue+is%3Aopen)

| 编号 | 未完成事项 | 状态 | 剩余工作及来源 |
|---|---|---|---|
| T-13 / #43 | 本地多人无法攻击 1P、单人局 AI 五连鞭要求玩家代判 | TODO（P0） | 复现两个场景，核对目标选择和判定参与者，确认是否同源。 [Issue #43](https://github.com/xzq66677/BA-DIAN/issues/43) |
| T-11 / #23 | 完善五条悟技能和机制 | IN_PROGRESS（MMR12345） | 2026-11-24 已定案并落地：近战始终 1 伤、领域平局含三人循环、**领域只给平局回合行动权（不把平局改判为胜）**、无量=领域展开、被覆盖后可再展开；「血量≥20 叠伤×2」「完全体领域远程必中」暂缓（见 CHANGELOG 2026-11-24）。 [Issue #23](https://github.com/xzq66677/BA-DIAN/issues/23) |
| T-12 / #31 | 完善精神攻击定义与逻辑 | TODO（P1） | 统一核对大贱客、大屁孩、马保国的精神攻击语义及太极反弹优先级。 [Issue #31](https://github.com/xzq66677/BA-DIAN/issues/31) |
| T-10 / #16 | 完善躲藏机制 | TODO（P1） | 确认目标锁定、解除条件、范围伤害及无视躲藏例外。 [Issue #16](https://github.com/xzq66677/BA-DIAN/issues/16) |
| #28 | 落地每局最多 10 人并确认代判规则 | TODO（P1） | 2026-11-23 用户确认最多 10 人。云端 `main` 的加入房间与添加 AI 仍按 20 人判断，待统一服务端容量、前端选项及规则文档。代判起始人数与适用判定待决定。 [服务端实现](https://github.com/xzq66677/BA-DIAN/blob/b1fa2d0b801e164afc712fee717b749a844cdb91/server/src/index.ts#L167-L241) · [Issue #28](https://github.com/xzq66677/BA-DIAN/issues/28) |
| #11 | 核对角色默认血量与大伊万例外 | 待规则确认 | 大屁孩和伍六七在 `main` 为 3 血，小女孩按已关闭的 #6 定为 2 血。需确认 #11 的默认 3 血要求如何适用。 [Issue #6](https://github.com/xzq66677/BA-DIAN/issues/6) · [Issue #11](https://github.com/xzq66677/BA-DIAN/issues/11) |
| #18 | 排查九位初始角色机制 | TODO | 逐角色核对规则与实现，并在 Issue 登记已检查名单。 [Issue #18](https://github.com/xzq66677/BA-DIAN/issues/18) |
| #2 | 排查其他角色机制并复核新增角色接口 | TODO | 小女孩的爆炸逻辑已由 #6 落地。剩余角色逻辑与新增角色规则接口仍待排查。 [Issue #2](https://github.com/xzq66677/BA-DIAN/issues/2) |
| MAP-102 | 10 人同房名牌重叠 | TODO | 显示层补测中，三种视口均可通过键盘选中房间和角色。名牌在桌面、手机竖屏和手机横屏分别有 3、8、3 对重叠。 [地图任务清单](MAP_TASKS.md#验收与回滚) |
| MAP-103 | 精简模式移动端硬件验收 | 待手机实测 | 桌面 Intel UHD 已跑两局，像素比均从 1.55 降至 1，重开资源计数未增长。目标手机上的帧耗时、分辨率与资源趋势仍待实测。 [地图任务清单](MAP_TASKS.md#验收与回滚) |
| MAP-104 | 触屏安全区域和缩放 | TODO | 已支持单指拖拽与滚轮。仍缺双指缩放、屏幕安全区和手机横竖屏验收。 [地图任务清单](MAP_TASKS.md#后续待领) |
| MAP-006 | 首图天气、泥潭与泄水闸手机验收 | 待手机实测 | 记录天气和泥潭在精简模式的可读性、触控选房、开闸和切换 2D。 [地图任务清单](MAP_TASKS.md#核心交付) |
| MAP-106 | 第二主题配置样例 | BLOCKED | 等待首发地图的硬件与人工验收。 [地图任务清单](MAP_TASKS.md#后续待领) |
| V5.0-B | 正常镜头下的角色辨识度与手机真机 | 待人工验收 | 在桌面及手机默认镜头下辨认五条悟，检查名牌、揭示栏遮挡和触控反馈。 [角色 QA](plugins/character-pipeline/examples/first-character/character-qa.md) |
| V4.3 / B-031 | 3D 长局稳定性、真实触控和演出节奏 | 待真机验收 | 验证手机和桌面 GPU 的 WebGL 长局稳定性及降级，检查顶栏触摸、横竖屏切换和镜头手势，观察高频战局演出时长。 [原验收遗留](#v43-遗留与下一阶段建议) |
| T-1924 | 躲藏提示和密集名牌验收 | 待验收 | 补测躲藏提示的端到端场景。多人同房的名牌可读性见 MAP-102。 [V4.4 验收记录](#二十四轮--v443d-战场体验迭代用户-11-项需求2026-11-21) |
| T-613 | 3D 聚焦镜头与全局播报横幅 | 待真机验收 | 目视复验真实设备上的横幅层级，并观察超长局的播报队列延迟。 [PR #42](https://github.com/xzq66677/BA-DIAN/pull/42) |
| P2-2 | 观战模式 | TODO | 支持无座位加入并实时查看公开战场和日志。 [优化路线图](docs/OPTIMIZATION_PLAN.md#二后续路线图p2-待实施按价值排序) |
| P2-3 | 按速查表扩充角色库 | TODO | 按规则完整度分批补充角色。 [优化路线图](docs/OPTIMIZATION_PLAN.md#二后续路线图p2-待实施按价值排序) |
| P2-5 | 稳定公网地址 | 待部署核实 | 核实现有公网入口是否已固定，原方案为 Cloudflare 命名隧道。 [优化路线图](docs/OPTIMIZATION_PLAN.md#二后续路线图p2-待实施按价值排序) |
| P2-7 | 房间状态持久化 | TODO | 服务重启后恢复未结束的对局。 [优化路线图](docs/OPTIMIZATION_PLAN.md#二后续路线图p2-待实施按价值排序) |
| P2-8 | 跨局角色战绩统计 | TODO | 汇总角色胜率和对局数并落盘。T-704 已完成独立的局内面板。 [优化路线图](docs/OPTIMIZATION_PLAN.md#二后续路线图p2-待实施按价值排序) |
| P2-9 | 移动端卡牌手势 | TODO | 横屏布局已有实现（T-702、V4.2）。路线图仍有卡牌拖动选目标的手势项，地图镜头触控见 MAP-104。 [优化路线图](docs/OPTIMIZATION_PLAN.md#二后续路线图p2-待实施按价值排序) |

T-407 已由 T-415 解除阻塞。Issue #39 已随 PR #42 合并，真机复验见 T-613。云端开放的 #13 是标为 `status: done` 的治理记录。对局回放已实现，按 T-805 暂停开放。 [Issue #13](https://github.com/xzq66677/BA-DIAN/issues/13) · [Issue #39](https://github.com/xzq66677/BA-DIAN/issues/39)

## V5.0-B · 五条悟 3D 与角色工作流

| 范围 | 状态 | 证据 |
|---|---|---|
| 单角色资产、五动作、清理、3D/2D 连局 | DONE | [实战报告](docs/V5.0-B.md)：最终 `L8VS` 连续两局各六回合；五帧同一 PID；重开几何和纹理均未增长。双端类型检查、隔离构建、311/311 测试通过。 |
| Character Development Pipeline V1.0 | DONE（五条悟专项交接） | [工作流入口（ZCode 插件）](plugins/character-pipeline/README.md)；两轮独立交接各 27/27，修订、差异与验证上限见[交接记录](plugins/character-pipeline/examples/first-character/handoff-validation.md)。 |
| 正常镜头下的玩家辨识度与手机真机 | 待人工验收 | 390×844 样本中行动坞与角色投影框相交 100% → 0%；名牌及揭示栏仍局部相交。见[角色 QA](plugins/character-pipeline/examples/first-character/character-qa.md)。未开启 V5.0-C。 |

## 阶段0 · 检查与规划

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-000 | 工作区/环境检查（Node 24、无冲突进程、无端口冲突） | DONE | Node v24.21.0，npm 11.19.0 |
| T-001 | 读取角色速查表 xlsx（拔典1、拔典2） | DONE | 导出 `docs/角色速查表-原始数据.md`，9 优先角色数据齐全 |
| T-002 | 创建 TASKS.md / git 仓库 / 目录结构 | DONE | badian-game/ |
| T-003 | 规则假设清单整理 | DONE | docs/GAME_RULES.md（假设 A-01~A-15 + 待确认 8 项） |

## 阶段1 · 核心规则引擎（shared/src）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-100 | 类型系统 types.ts | DONE | 玩家/房间/伤害/日志/规则配置 |
| T-101 | 随机数模块 rng.ts | DONE | mulberry32 种子可复现 |
| T-102 | 初次判定 judge.ts（平局递归/三人循环/多名胜者） | DONE | 不随机决定胜者 |
| T-103 | 二次判定行动排序（输者先，递归分组） | DONE | 2026-11-21 改为**玩家亲自出拳**（`player` 默认，rps2 交互阶段）；`serverRoll` 仅自动化用例使用 |
| T-104 | 伤害管线 damage（转移/躲避/反弹/秒杀/多段钩子） | DONE | 两阶段钩子设计 |
| T-105 | 游戏引擎 engine.ts（阶段机/队列/淘汰/胜利/回合末事件/日志） | DONE | |
| T-106 | 引擎单元测试 TC-E001~E035 | DONE | 35 用例全过 |

## 阶段2 · 角色系统（shared/src/characters）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-200 | 角色注册表 + 无业游民默认角色 | DONE | 钩子式架构，无 if/else 硬编码 |
| T-201 | 拔棍（拔棍状态/无视躲避） | DONE | TC-C001~004 |
| T-202 | 吹箫哥（仅远程；瞄准规则后续废止） | DONE | TC-C010~012；现行规则默认免瞄准，见 T-520 |
| T-203 | 五条悟（近3远2/领域/平局算胜/对冲） | DONE | TC-C020~023 |
| T-203b | 老大爷（领域对冲验证用） | DONE | TC-C024 |
| T-204 | 马保国（太极反弹/五连鞭/不讲武德） | DONE | TC-C030~035 |
| T-205 | 伍六七（3段AOE/快照/独立结算） | DONE | TC-C040~043 |
| T-206 | 卖大伊万的小女孩（投掷/动态成员爆炸） | DONE | TC-C050~053；爆炸时机可配置 |
| T-207 | 今日勇者（3血2攻，正文缺失标记） | DONE | TC-C060~061；不编造技能 |
| T-208 | 大贱客（全场吸引/辱骂三次致死） | DONE | TC-C070~076 |
| T-209 | 大屁孩（三不同暴走/三同自爆/跨回合） | DONE | TC-C080~084 |
| T-210 | 复杂交互测试 TC-X001~X014 | DONE | 反弹×多段/秒杀×反弹/爆炸×回合序等 |
| T-211 | 今日勇者运势技能（用户确认表：0/1暴毙、2/3血1攻1…9血6攻6） | DONE | TC-C062~064；触发时机为假设A-16 |
| T-212 | 喝牛奶行动（嘲讽，无实际作用——用户确认） | DONE | TC-E036 |
| T-213 | 日志分层：重点标记/图标/重点过滤/回合小结 | DONE | 前端「⭐重点」过滤器 |

## 阶段3 · 联机服务端（server/）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-300 | Socket.IO 服务端 + 房间管理 | DONE | 邀请码/房主/座位/令牌 |
| T-301 | 隐藏提交 | DONE | 快照不含拳种（TC-X010） |
| T-302 | 断线重连 | DONE | token 恢复身份与状态 |
| T-303 | AI 模块 | DONE | 同一引擎接口提交；走游戏随机流可复现 |
| T-304 | 单设备多人 | DONE | 同 socket 多身份/隐私遮罩 |
| T-305 | 联机集成测试 | DONE | 6 用例（真实 socket.io-client） |

## 阶段4 · 前端（client/）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-400 | 首页（创建/加入/单人/单设备多人/测试场入口） | DONE | vite build 通过 |
| T-401 | 大厅页（邀请码/座位/角色选择/AI/开始） | DONE | |
| T-402 | 游戏页（回合/阶段/玩家/房间/行动面板/判定记录/日志） | DONE | 真实引擎快照渲染验证 |
| T-403 | 单设备多人隐私交互 | DONE | 交设备遮罩/提交后不回显 |
| T-404 | 机制测试场页 | DONE | 与 vitest 同源数据 |
| T-405 | 前端构建验证 | DONE | 2.53s，75 模块 |
| T-406 | UI 组件测试（jsdom） | DONE | 4 用例（含测试场页全量运行 89 用例全 PASS） |
| T-407 | 真实 Chromium 端到端点击测试 | DONE | 初次尝试缺少系统库，安装后由 T-415 补测通过。云端 PR #42 的回归包含 5 个真实 Chromium 用例。 |
| T-14 / #51 | 血量数值与角色状态详情 | DONE | 2D/3D 血条显示当前/最大生命，点击血条打开公开状态弹窗；白名单展示躲藏、隐身、领域等真实状态，不暴露隐藏出拳或判定历史。状态类型、读取器与 UI 已分层，后续负面状态扩展契约写入 `AGENTS.md`。`npm test` 36 文件 / 591 用例全过（含真实 Chromium 双模式验收），`npm run build` 通过。 |

## 阶段5 · 测试修复与回归

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-500 | 全量 vitest 运行与修复 | DONE | **120 用例全部通过**（九轮：+解散/退出/一房一人/昵称必填） |
| T-501 | 复杂交互测试 | DONE | 14 用例 |
| T-502 | AI 自动对局回归 | DONE | 4 用例（3人×5种子/10人×2种子/可复现/日志可解释） |
| T-503 | 服务端生产模式冒烟（:3100 health/静态/API） | DONE | curl 验证 |

## 三轮 · AI 选角 + 真实浏览器E2E + systemd（2026-11-19 深夜）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-414 | AI 角色选择：随机（默认）/ 房主手动指定 / 房主改已有AI角色 | DONE | socket 集成测试覆盖 |
| T-415 | 真实 Chromium E2E（sudo 安装系统库解锁） | DONE | 4 用例：首页卡池加载/单人开局出拳/AI推进/大厅选角聊天/测试场 |
| T-416 | systemd 服务 badian.service（开机自启/崩溃3秒重启/日志 /var/log/badian.log） | DONE | sudo 配置 |
| T-417 | B-014：Lobby 修改未重建导致 dist 陈旧（测试与线上行为不一致） | FIXED | 构建后再跑测试确认 |

## 二轮 · TCG 卡桌风格升级（2026-11-19 晚）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-300b | 大厅房间列表广播（lobby:rooms）+ 房间聊天 | DONE | socket 集成测试覆盖 |
| T-408 | 游戏王风角色卡素材入库（9张原创卡，21MB→346KB webp） | DONE | client/public/cards/ |
| T-409 | 今日勇者运势改为第一回合限一次（用户确认） | DONE | TC-C065 |
| T-410 | 战场桌面 UI：房间场地/角色卡（动态HP攻）/技能卡行动坞/目标高亮/确认流程/伤害闪烁/卡牌详情弹层 | DONE | Game.tsx 重写 |
| T-411 | 大厅/房间等待页卡桌化（卡池展示墙/座位卡槽/房间列表/聊天/规则弹窗） | DONE | Home/Lobby 重写 |
| T-412 | 移动端适配（窄屏分区、场地横滑、日志折叠） | DONE | tcg.css 响应式 |
| T-413 | UI 组件测试更新（新锚点）+ 聊天/列表集成测试 | DONE | 109 用例全过 |

## 四轮 · 自我优化（2026-11-20）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-500b | 断线自动重连恢复座位绑定（真实缺陷修复） | DONE | socket 集成测试 |
| T-504 | 快照日志瘦身：增量下发（seq 去重/重连补发300条） | DONE | TC-E037 |
| T-505 | 出拳状态徽章 + 伤害飘字动画 | DONE | 前端 |
| T-506 | AI 击杀优先策略 | DONE | 单元测试 |
| T-507 | 隧道 systemd 化（badian-tunnel，URL 写入 TUNNEL_URL.txt） | DONE | |
| T-508 | E2E 构建前置固化（B-014 复发防护） | DONE | e2e 内置 build |
| T-509 | docs/OPTIMIZATION_PLAN.md 完整路线图（P2 backlog 10 项） | DONE | |

## 五轮 · 手机端修复（2026-11-20）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-510 | **B-015：tcg.css 从未被打包**（样式导入写错文件，静默失败）→ 卡桌视觉整体缺失，手机上表现为"没有开始界面/房间联机" | FIXED | 根因+修复+全界面截图验证 |
| T-511 | 手机端布局：grid min-width 收敛、防横向溢出、chip/卡牌紧凑化 | DONE | 390px 视口零溢出（首页/大厅/游戏） |
| T-512 | 手机端截图回归（Playwright iPhone 视口：首页/大厅/出拳/行动阶段） | DONE | |

## 六轮 · 手机直连入口 + 仓库准备（2026-11-20）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-513 | 端口可达性诊断（iptables/NSG/外部探测） | DONE | 443=SSH伪装、8881-8892+11937 为 NSG 放行段、8882被NSG拦 |
| T-514 | 游戏挂载到 11937 nginx `/badian/` 子路径（含WebSocket反代） | DONE | 备份+nginx -t+热加载，不动原有代理配置 |
| T-515 | 客户端子路径适配（vite base './'+socket.io路径自适应+卡面相对路径） | DONE | 根路径部署同样兼容 |
| T-516 | 手机直连全链路验证（IP:11937/badian/ 单人开局对战） | DONE | 9卡池+对战推进+零溢出+零JS错误 |
| T-517 | 仓库推送准备（无远程凭据，bundle+命令就绪） | DONE | 待用户提供仓库地址/令牌 |

## 七轮 · 修复（2026-11-20）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-518 | 撤销 IP:11937 直连入口（用户指出暴露服务器） | DONE | nginx 恢复原配置（有备份），回到隧道访问 |
| T-519 | 无立绘角色卡占位（无业游民/老大爷不再显示破图） | DONE | 卡池/座位占位样式 |
| T-520 | 远程攻击默认免瞄准（用户确认）；需瞄准角色在描述中注明 | DONE | 攻击卡描述动态标注+TC-C025 |
| T-520c / #26 | 统一远程瞄准文档与残留描述 | DONE | 规则表删除吹箫哥需瞄准示例；明确 `rangedNeedsAim` 为 opt-in，当前仅五条默认需要瞄准。同步代码注释、用例说明与历史测试记录。 |

## 八轮 · 动作可视化/局内发言/踢人/五条悟排查（2026-11-20）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-520b | 无业游民/老大爷新卡入库（用户卡面），无业游民 HP 修正为 2（速查表原稿+卡面确认） | DONE | 24条测试预期联动修正 |
| T-521 | 行动可视化：卡牌动作特效（⚔️攻击红/💊回复绿/🚶移动蓝/✨技能紫/🥛牛奶），引擎日志携带 pid+fx | DONE | Playwright 实测 fx-anim 挂载 |
| T-522 | 局内发言：对局中聊天弹层（服务端复用 room:chat，全状态可用） | DONE | 浏览器实测收发 |
| T-523 | 房主踢人：room:kick（对局中=引擎淘汰+移除座位；大厅=移除），卡牌详情弹层加踢出按钮 | DONE | socket 集成测试 |
| T-524 | 五条悟领域展开排查 | DONE | 结论：引擎逻辑正常（免瞄准/平局算胜/对冲 3 项测试全过）；实际问题是 UI——领域展开后攻击卡仍显示"需先瞄准" → 已修为领域状态自适应 |
| T-525 | B-016：App.tsx 日志映射丢失 data 字段导致特效不触发 | FIXED | 日志携带 type+data |

## 九轮 · 房间管理完善（2026-11-20）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-530 | 房主解散房间（全员通知 room:dissolved + 销毁 + 清理绑定） | DONE | 集成测试 |
| T-531 | 玩家退出房间：对局中退出=引擎淘汰+移除（不再留僵尸） | DONE | 集成测试（观察员视角） |
| T-532 | 一人（同浏览器会话）不可加入多个房间 | DONE | 服务端守卫+集成测试 |
| T-533 | 昵称必填（服务端+客户端双校验，按钮禁用） | DONE | 集成测试 |
| T-534 | 同设备记忆昵称（localStorage 预填） | DONE | |
| T-535 | 胜负判定明显化：全屏胜负弹层（胜者卡面立绘+大字+再来一局/离开/查看战场） | DONE | |
| T-536 | B-017：waitForGame 稳健等待器消除 ack/广播竞态类测试脆弱性 | DONE | 替代裸 once |

## 十轮 · 仓库上传（2026-11-20）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-540 | 推送至 GitHub `xzq66677/BA-DIAN`（SSH Deploy Key，保留远程 MIT LICENSE） | DONE | 20 提交 / 73 文件；合并远程初始提交，README 采用项目文档 |
| T-541 | 部署密钥配置（~/.ssh/badian_deploy，仅该仓库写权限） | DONE | 后续 `git push` 免密 |

## 十一轮 · 吹箫哥瞄准可发现性 + 发言入口（2026-11-20）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-550 | 历史：吹箫哥瞄准为强制规则（引擎实测未瞄准→拒绝、瞄准后→命中） | SUPERSEDED | 2026-11-20 后续用户确认已废止：吹箫哥无需瞄准，见 T-520 / Issue #26 |
| T-551 | 修复目标过滤：远程-only 角色不再显示同房间目标（此前会选中后被拒） | FIXED | validTargets 按 attackType 过滤 |
| T-552 | 瞄准状态条：需瞄准角色显示「🎯 需先瞄准 / 已瞄准：X / 领域免瞄准」 | DONE | 行动坞顶部 |
| T-553 | 局内发言增强：右下角浮动按钮 + 未读消息徽章（原顶栏按钮保留） | DONE | Playwright 实测收发 |
| T-554 | 缓存控制：index.html no-cache、带 hash 资源 immutable（避免玩家看到旧包） | DONE | 响应头验证 |

## 十二轮 · 局内发言常驻底部（2026-11-20）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-560 | 局内发言改为底部常驻面板（实时滚动、可收起、计数） | DONE | 双人真实浏览器实测双向实时 |
| T-561 | 攻击确认条：需瞄准角色选异房目标时显示警告 + 「一键瞄准该目标」 | DONE | 回应玩家「为啥攻击还要瞄准」 |
| T-562 | 清理悬浮按钮/弹层方案，避免重复入口 | DONE | |

## 阶段6 · 文档与交付

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-600 | README.md | DONE | 启动/玩法/角色/结构 |
| T-601 | docs/GAME_RULES.md | DONE | 正式规则+假设A-01~A-15+待确认8项 |
| T-602 | docs/ARCHITECTURE.md | DONE | 架构/管线/协议 |
| T-603 | docs/TEST_REPORT.md | DONE | 103 用例明细+运行验证记录 |
| T-604 | docs/KNOWN_ISSUES.md | DONE | 限制/环境问题 |
| T-605 | 最终交付报告 | DONE | 见对话输出 |

## 阶段7 · 交互与观察层（2026-11-20）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-700 | 出拳揭示全员可见 | DONE | 结算后公开拳种/胜负，提交阶段仍只暴露「已提交」（tests/reveal.test.ts 4 例） |
| T-701 | 斗地主式牌桌布局 | DONE | 座位条 / 中央揭示台 / 底部手牌 / 右侧日志 |
| T-702 | 横屏适配 | DONE | `@media (orientation:landscape) and (max-height:560px)` + `useCompactLandscape`，844×390 全要素一屏 |
| T-703 | 手机竖屏适配 | DONE | `useNarrowScreen` + 牌桌内滚 + 手牌常驻，出拳按钮一屏可见 |
| T-704 | 局内战绩面板 | DONE | `stats` 引擎累计 + 顶栏「📊 战绩」（tests/stats.test.ts 4 例） |
| T-705 | 丢番茄小互动 | DONE | 🍅/🥚/🌹 广播动画 + 2.2s 冷却，不写日志不改血（tests/interaction.test.ts 4 例） |
| T-706 | AI 难度分级 | DONE | easy/normal/hard，大厅房主可调（tests/integration/ai-difficulty.test.ts 10 例） |
| T-707 | 对局回放 | DONE | 状态帧录制去重 + `client/src/pages/Replay.tsx` 播放器（0.5–4× 倍速、导出 JSON）（tests/replay.test.ts 3 例） |
| T-708 | 文档同步 | DONE | README 新增「AI 难度」「局外功能对规则的影响」；GAME_RULES 新增第四节 |

## 阶段8 · 判定与领域规则修订（2026-11-20）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-800 | 领域唯一化与覆盖 | DONE | 新增 `Game.domainHolder` + `openDomain()`：后展开覆盖先展开，原持有者失效；废止「领域对冲」 |
| T-801 | 平局判胜边界 | DONE | 仅「全员同拳」判领域胜；三人循环仍重判并输出说明日志；两组出拳领域不介入 |
| T-802 | 领域持续性 | DONE | 跨回合/重判/普通胜负/命数复活均保留；仅被覆盖或持有者退场时失效（tests/domain.test.ts 20 例） |
| T-803 | 二次判定顺序 | DONE | 顺序完全由判定胜负决定（输者先/赢者后递归），逐层日志；单人资格跳过排序 |
| T-804 | 今日勇者限次 | DONE | 取消「仅第一回合」，改为全局仅一次、不限回合（TC-C065 / 065b） |
| T-805 | 回放暂停启用 | DONE | `REPLAY_ENABLED = false` 关闭两处入口；录制与播放器代码保留、测试保留 |
| T-806 | 领域可见性 | DONE | 座位角标 ✨、我的席位「领域生效中」、卡牌详情领域说明（紫色脉冲徽标） |

## 阶段9 · 操作体验修正（2026-11-20 第二轮反馈）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-900 | 自身技能不再要求选目标 | DONE | 客户端把 `targetHint: 'none'` 归一化为「无目标」：领域展开 / 抽取今日运势 / 领域强化 / 拔棍开关 选中即出现可点的「确认发动」，不再提示「点击战场高亮卡牌」，技能卡也不再标「🎯 需选择目标」（UI 测试 3 例） |
| T-901 | 单人 vs AI 取消超时 | DONE | 新增 `Room.needsTimeout()`：只有 ≥2 名真人才布防出拳/行动超时；单人 vs AI、单设备多人不布防，不再代掷/自动跳过（tests/timeout.test.ts 6 例） |
| T-902 | AI 看门狗（取消超时后的兜底） | DONE | `startAIWatchdog()` 每 1.2s 检查「仍等 AI 出拳 / 仍轮到 AI」，补驱动一次；只驱动 AI、不替真人操作，对局结束/重开/销毁时清理 |

## 阶段10 · 同房间多局日志（2026-11-20 第三轮反馈）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-1000 | 日志 seq 跨局单调递增 | DONE | `GameConfig.logSeqOffset` + `Room.logSeqCursor`（`syncLogSeqCursor()` 在每次状态变更与 restart 前推进），第二局 seq 从上一局最大值续接 |
| T-1001 | 新局清空上一局日志 | DONE | `lobbySnapshot().gameNo` 逐局 +1，客户端 `App.tsx` 检测到变化即清空本地日志，避免两局日志首尾相接、回合号重复 |
| T-1002 | 回归测试 | DONE | `tests/room-logseq.test.ts` 6 例：seq 递增、客户端去重后第二局全部可见、连打三局不回退、gameNo 递增、默认不影响单局、AI 局同样续接 |

## 发现并修复的 Bug（全部有回归测试覆盖）

| 编号 | 描述 | 状态 |
|---|---|---|
| B-001 | 二次判定全员同拳死循环风险 → 子轮重掷+安全上限 | FIXED |
| B-002 | 大屁孩自爆后行动队列含死者 → 推进跳过死者 | FIXED |
| B-003 | 伍六七 AOE 段间死亡仍受击 → 每段存活检查 | FIXED |
| B-004 | 双马保国反弹无限链 → reflected 标记终止 | FIXED |
| B-005 | 断线玩家阻塞出拳 → 服务端超时代掷 | FIXED |
| B-006 | 单设备多人提交后回显拳种泄露 → ack/快照均不含拳种 | FIXED |
| B-007 | 默认角色可远程攻击 → rangedCapable 能力位 | FIXED |
| B-008 | 五条悟无瞄准入口 → 瞄准提升为引擎基础行动 | FIXED |
| B-009 | 已行动者淘汰导致后续玩家被跳过 → 淘汰不移位队列 | FIXED |
| B-010 | 躲藏目标被选中攻击浪费回合 → 前置校验拒绝 | FIXED |
| B-011 | 测试驱动器行动被拒后死循环 → 失败即停 | FIXED |
| B-012 | 横屏 844×390 手牌被挤出视野（top 386 > 视口 390）→ 外壳全高 flex + 两行网格 + 日志/发言改抽屉 | FIXED |
| B-013 | 横屏房间场地 R3 被裁（移动端 `overflow-x` 继承盖掉网格）→ `.zones` 覆盖为 grid + 栏宽 0.78/1.22 | FIXED |
| B-014 | 回放弹层底部控制条被发言面板遮住（z-index 95 同级后绘制）→ 发言 z-index 降到 40 | FIXED |
| B-015 | 桌面牌桌被压缩到 589px（flex 内 `margin:auto` + `width:auto`）→ `width:100%` | FIXED |
| B-016 | 桌面 1440×900 需滚动 / 手机竖屏看不到出拳按钮 → 两行网格各自内滚 + 窄屏默认收起侧栏 | FIXED |
| B-017 | 多领域并存时互相抵消（对冲）→ 平局永不判胜，用户体感"领域没用" → 改为全场唯一持有者 + 后展开覆盖 | FIXED |
| B-018 | 领域可能被误清（缺少显式保证与回归）→ 明确持续性语义并加 6 例持续/失效测试 | FIXED |
| B-019 | 今日勇者被限制在第一回合 → 改为全局仅一次、不限回合 | FIXED |
| B-020 | 仅 1 名玩家有资格时仍走一遍排序流程、消耗随机流 → 跳过排序直接行动 | FIXED |
| B-021 | `targetHint: 'none'`（自身技能）被前端当作"需要目标" → 确认条显示「点击战场高亮卡牌」且按钮置灰，领域/运势类技能无法直接发动 | FIXED |
| B-022 | 单人 vs AI 也布防 30s/45s 超时 → 出拳被代掷、行动被自动跳过（AI 即时应答，无人等待） | FIXED |
| B-023 | 同房间第二局战斗日志不再更新：引擎 `logSeq` 每局从 1 重算，与上一局 seq 撞号 → 服务端增量过滤与客户端去重把新日志全当旧日志丢弃。改为 `Room` 维护跨局游标 `logSeqCursor` 作为 `GameConfig.logSeqOffset`，并下发 `gameNo` 让客户端在新局清空日志 | FIXED |
| B-030 | E2E 测试构建直接重建 `client/dist`，而本机 systemd 生产实例恰好静态服务该目录 → 跑一次 `npm test` = 无意间更新生产内容（本轮实测复现：3100 服务 hash 被替换）。修复：e2e 构建隔离到 `client/dist-e2e` 并以 `CLIENT_DIST` 指向，测试与生产彻底解耦；事故期间被覆盖的生产内容已通过 HEAD 重建完整恢复 | FIXED |

## 十二轮 · Arena 视觉升级与专项核查（2026-11-20，进行中）

### 阶段0 · 专项核查结论（以当前仓库实际代码为准）

| 编号 | 核查项 | 结论 | 证据 |
|---|---|---|---|
| C-01 | `_lastLogSeq` 生命周期 | 基本正确，两处待改进 | `server/src/index.ts` broadcastRoom：每次广播推进游标、重连重置为 0 → 重连客户端补发最近 300 条（客户端按 seq 去重）。改进点：① 游标是「房间级单游标」，重连重置会让**所有**客户端重复收到 300 条（去重后无害但浪费带宽）→ 改为按 socket 定向补发；② 通过 `(room as any)._lastLogSeq` 隐藏字段挂载，应收编为 Room 正式字段 |
| C-02 | `slice(-300)` 截断 | 安全，有界历史策略成立 | 服务端 `newLogs` 取增量后最多 300 条；快照始终权威，截断只影响日志历史展示，不影响状态一致性。同房间多局 seq 续接已由 T-1000/T-1002 修复并有 6 例回归 |
| C-03 | seq 单调性/去重 | 正确 | 引擎 `logSeq` 私有自增；`Room.logSeqCursor` 跨局续接（restart 前先 syncLogSeqCursor）；room-logseq.test.ts 6 例全过 |
| C-04 | Snapshot 与 newLogs 一致性 | 正确 | 快照已不携带日志（带宽优化），日志唯一通道是增量；重连补发覆盖断线窗口 |
| C-05 | 快照差分猜测事件 | **确认存在（违反任务书要求）** | `Game.tsx` `flashMap` 用 `prevHp` ref 差分猜测伤害（受击闪烁+飘字）；heal 无反馈；move 无 from/to 反馈。修复：引擎补结构化字段，演出改由事件驱动 |
| C-06 | `data.fx` 规范化 | 需规范化 | 引擎在 action 日志注入 `fx`（attack/move/heal/milk/skill），客户端还有 `l.type==='damage'&&d.source?'attack'` 之类的猜测回退。规范化为类型化 payload，淘汰猜测回退 |
| C-07 | 演出与快照不一致/重复播放 | **确认存在** | ① fx key `${pid}-${fx}` 不含事件号 → 同类事件连续触发不重播动画；② `setTimeout(setActionFx({}),1400)` 全局清空所有 fx；③ `flashMap` 950ms 内第二次受击不重播、被击杀者(`!p.alive`)完全不闪；④ AOE 9 段伤害瞬时落定无分组演出；⑤ 重连后 `lastFxSeq=0` 会把补发的 300 条历史日志全部重播特效。→ 由 BattleEventQueue 统一解决 |
| C-08 | 隐藏信息泄漏 | 未发现泄漏 | 快照不含 pendingThrows/histories；reveal 仅结算后子轮；日志无隐私内容；`char` 运行时字段（aim/stickDrawn/domain/insults/attackOverride/fortuneUsed）均为公开信息且已有公开日志 |
| C-09 | Arena UI 功能保留 | 全部在位 | 卡牌/牌桌/揭示台/日志/丢番茄/战绩/横竖屏均在 Game.tsx + tcg.css，本任务只增不删 |
| C-10 | CSS 体系复用 | 复用扩展 | tcg.css 变量/动画/组件体系完整，只追加新动画与降级规则，不推翻重建 |
| C-11 | Replay 关闭 | 保持关闭 | `Game.tsx:78 REPLAY_ENABLED = false`，不改 |
| C-12 | 测试数字以实测为准 | **实测 185/185 全过**（13 文件，含真实 Chromium E2E 4 例） | 本轮 `npm test` 实跑结果，README 数字与实测一致 |

### 阶段0 补充发现

| 编号 | 描述 | 状态 |
|---|---|---|
| B-024 | `Game.tsx` fx/flash 动画不可重播（React key 不含事件标识），同玩家连续同类动作第二次动画不播 | FIXED（演出队列接管，key=事件 seq） |
| B-025 | 重连补发的历史日志会按 fx 规则重播特效（`lastFxSeq` 初始为 0），违反「重连后不重复播放」 | FIXED（`initFromLogs` 以接收水位初始化游标） |
| B-026 | `App.tsx` `enterSession` 不重置 `gameNoRef`，跨房间加入时可能跳过一次新局清空 | FIXED（enterSession/exitSession 重置） |
| B-027 | **E2E 构建把 React 开发版打进生产 bundle**：vitest 进程内 `NODE_ENV=test` 执行 `vite build`，dev React + StrictMode 双调用 effect（setup→cleanup→setup）会让演出队列被 cleanup 误杀。修复：E2E 构建强制 `NODE_ENV=production`（部署脚本 systemd 环境无 NODE_ENV，不受影响）；同时队列增加 `revive()` 兼容 StrictMode | FIXED（E2E 5/5 + revive 回归测试） |
| B-028 | 拥堵策略两轮修正：① 按簇数判拥堵会把 AI 局正常节奏误判为拥堵并冲刷全部演出（正是任务书要解决的「瞬间刷完」）→ 改按**积压时长**判定；② 快速对局的整场日志一次性到达会触发全量冲刷 → 改为**丢弃最旧、保留最新**（最新事件永不丢演出） | FIXED（battle-queue.test.ts 21 例覆盖） |

### P0-P2 实施记录（全部实测验证）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-1200 | 结构化事件 schema（P0） | DONE | `types.ts` 新增 `BattleFxKind/AttackDeclEventData/DamageEventData/HealEventData/MoveEventData/EliminateEventData/ReviveEventData/ActionEventData`；`DamageRequest` 增 `groupId`；引擎补齐 攻击宣告/扣血(amount/hpBefore/hpAfter/lethal/room/groupId)/回复/移动(from/to)/淘汰(pid/cause/killer)/复活(livesLeft)/行动(fx+targetId+room) 全量结构化 data；旧数据客户端安全降级。回归：tests/battle-events.test.ts 14 例 |
| T-1201 | 服务端广播游标收编（P0） | DONE | `_lastLogSeq` 从 index.ts 的 as-any 隐藏字段改为 `Room.broadcastLogSeq` + `takeNewLogs()/catchUpLogs()`；断线重连改为**按 socket 定向补发最近 300 条**（不再重置全局游标——否则其它客户端重复收历史）。回归：tests/broadcast-cursor.test.ts 4 例 |
| T-1202 | BattleEventQueue（P0） | DONE | `client/src/battle/`：events.ts（日志→类型化演出事件，旧数据降级）+ queue.ts（分簇/幂等游标/分组/积压时长拥堵策略/倍速 1×2×4×/跳过本段/跳过全部/reduced-motion 时长收敛/StrictMode revive）。回归：tests/ui/battle-queue.test.ts 21 例 |
| T-1203 | 演出 UI 集成（P0/P1/P2） | DONE | Game.tsx 删除快照差分 flashMap 与 fx 猜测逻辑，全部改由演出队列驱动：受击斩击（弹出+斜向斩击线+冲击闪光+震动+伤害飘字+HP条延迟平滑下降）、回复（柔光+上升数字+HP条上升）、移动（FLIP 卡片跨房间飞行+目标房间高亮+from→to 横幅）、淘汰（印章+灰化收尾）、复活（金色爆发）、AOE/伊万（房间脉冲告警+分组顺序）、未命中（不触发受击）。演出控制条（倍速/跳过本段/全部跳过，演出中浮现，不锁输入）。揭示卡逐张翻开节奏。CSS：斩击/治疗/死亡/复活/房间告警 keyframes + `prefers-reduced-motion` 全面降级 |
| T-1204 | 浏览器实测（P3） | DONE | Playwright E2E 5/5（新增「战斗演出」用例：hitcut/dmg-float/控制条/HP条/无JS错误）；截图实测：斩击红闪+斜向斩击线+HP条下降（scripts/visual-check.ts、scripts/visual-hitcut.ts 可复跑） |
| T-1205 | 回归测试 | DONE | **npm test：16 文件 / 225 用例全部通过**（原 185 + 新增 40：battle-events 14 + battle-queue 21 + broadcast-cursor 4 + e2e 演出 1）；`npm run build` 双端通过 |

## 十三轮 · 房间退出/占用系统修复（2026-11-21，B-029）

用户报告：退出对局后首页卡死在「你已在房间 97FR 中，请先退出该房间」，且房间列表显示「暂无房间」。

### 根因（三缺陷叠加）

1. **单设备多人退出只移除主身份**：`room:leave` 仅移除发起退出的 playerId，同 socket 的其余本机身份（P2/P3）残留在服务端并保持绑定 → 之后创建/加入房间被 `socketActiveRoom` 守卫永久拒绝（截图中的卡死）
2. **对局中退出不处理引擎**：残留的本机身份在引擎里仍是活人（无超时布防的房间行动队列永久卡死）
3. **同房间重复加入被放行**：`room:join` 对 `active.code === data.code` 不拒绝 → `addSeat` 产生「两个自己」
4. **僵尸房**：只剩 AI（无真人）的房间永远占用房间列表

### 修复（新语义）

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-1300 | 整台设备退出 | DONE | `room:leave` 移除发起 socket 绑定的**全部**身份；对局中在引擎内淘汰并日志公示；房主移交逻辑不变 |
| T-1301 | 无真人默认解散 | DONE | leave/kick/removeSeat 之后房间内无真人（空/只剩 AI）→ 默认解散（`dissolveRoom`：广播 room:dissolved + 清绑定 + 销毁）。仍有其他真人则房间继续（多真人房不受影响） |
| T-1302 | 重复加入拒绝 | DONE | 同 socket join 同房间 → 拒绝并提示「刷新页面即可回到房间」（不再产生两个自己）；跨房间占用拒绝携带 `activeCode` |
| T-1303 | `room:detach` 逃生口 | DONE | 以 socket 为凭证（无需 token——只有持有连接的人能操作自己的座位），移除全部绑定身份并按同样规则解散 |
| T-1304 | 客户端统一退出 | DONE | `App.exitSession` 统一通知服务端退出（所有「退出/离开」入口都走它）；GamePage/Lobby 退出按钮只调 onExit，避免双份 leave |
| T-1305 | 首页占用逃生口 | DONE | create/join 被拒（activeCode）时展示：**↩ 回到房间**（本地 session 匹配则令牌恢复）/ **🚪 退出旧房间并继续**（detach） |
| T-1306 | 回归测试 | DONE | `tests/integration/room-exit.test.ts` 7 例（多身份退出解散/重复加入拒绝/对局中退出淘汰+房主移交/唯一真人退出解散/detach/大厅多身份退出/踢人规则）+ `tests/ui/exit-guard.test.tsx`（逃生口 UI 渲染） |
| T-1307 | 浏览器实测 | DONE | Playwright 复现用户场景：单设备 3 人开局 → 对局中退出 → 再次创建**直接成功**（修复前永久卡死）；`npm run deploy` 后线上 socket 验证结构化事件与退出语义 |

实测：`npm test` **18 文件 / 233 用例全部通过**；双端 build 通过。

## 十四轮 · Cinematic Battlefield V3.0（2026-11-21，已完成）

> 实测汇总：`npm test` **19 文件 / 241 用例全部通过**；`tsc --noEmit` 双端 0 错误；三视口（1440×900 / 390×844 / 844×390）自动对局 0 JS 错误；前后截图证据 18 张见 `docs/screenshots-v3/`。开发实例 :3200（dist-dev），生产 :3100 全程保持 HEAD 构建未被部署（B-030 事故已恢复并修复根源）。

### 阶段0 · 环境与基线审查（以当前仓库实际代码为准）

| 编号 | 核查项 | 结论 | 证据 |
|---|---|---|---|
| V3-001 | 运行环境 | DONE | Node v24.21.0；3100=systemd 生产实例（不动），开发实例 3200（CLIENT_DIST=client/dist-dev）；`npm test` 基线 232/233（唯一失败 e2e「战斗演出」120s 超时，与并行 vite build 争 CPU 相关，需单独复跑确认） |
| V3-002 | 基线截图 | DONE | scripts/baseline-shots.ts：桌面 1440×900 / 窄屏 390×844 / 横屏 844×390 三视口自动打完一局（3 AI），0 JS 错误，11 张基线截图存 /tmp/badian-shots/base-*.png |
| V3-003 | 全屏星形粒子核查 | **当前代码不存在** | Game.tsx/tcg.css 无全屏粒子层；常驻动画仅 cbadge-acting/glow-green/seat-domain 脉冲（均有明确语义）。任务书截图中的粒子属旧版本，本轮保持无常驻粒子原则 |
| V3-004 | BattleEventQueue/结构化事件 | 在位完好 | client/src/battle/{events,queue,useBattlePresentation}.ts + tests/ui/battle-queue.test.ts 21 例；本轮只增不改核心 |
| V3-005 | 大伊万事件数据 | **演出链缺失** | 投掷日志 `deferred`（characters/index.ts:287）与爆炸日志（engine.ts:916）均无结构化 data（仅文本）；快照已含 `deferred` 数组（kind/room/explodeRound/source）可用于持续警示；伤害事件有 tag:'ivan'+groupId+room |

### 阶段0 · 视觉诊断清单（基于基线截图逐张审稿）

| 编号 | 问题 | 严重度 | 截图证据 | 处置 |
|---|---|---|---|---|
| D-01 | 终局弹层静态单薄：金框+卡面+按钮，无氛围聚焦/完成感；关闭后仅剩窄横幅 | P0 | base-win-overlay.png | 重设计终局舞台（见 T-1400） |
| D-02 | act 阶段揭示台大空洞：仅一行判定结果却占战场 ~1/4 高度 | P0 | base-act-phase.png | act 阶段收缩为紧凑状态条 |
| D-03 | 空房间等大虚线框视觉重量过大；终局 3/4 战场是空框 | P0 | base-over-table.png | 空房间轻量化+终局弱化 |
| D-04 | 大伊万演出链缺失：无投掷物/飞行/爆炸落点演出，无待爆警示 | P0 | 代码核查 V3-005 | 结构化事件+完整演出链（见 T-1420） |
| D-05 | 房间孤立矩形平铺，无空间关系/主题区分 | P1 | base-table-rps.png | 房间主题化+层级微调 |
| D-06 | 顶栏座位条与战场卡信息重复，占据视觉权重 | P1 | base-table-rps.png | 弱化为辅助条 |
| D-07 | BA DIAN 水印 alpha 0.035 几乎不可见（既不提供氛围也不可读） | P2 | 代码 | 微调或移除 |
| D-08 | 终局后 battle-ctl（演出控制条）仍残留显示 | P2 | base-over-table.png | phase over 时隐藏 |
| D-09 | 窄屏胜利弹层卡面占 ~55% 高度，按钮区拥挤 | P2 | base-narrow-win.png | 移动端弹层适配 |

### 实施记录

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-1400 | 终局演出重新设计（P0） | DONE | `win-modal` v2：聚光光柱（一次性 conic-gradient 展开）+ 12 粒一次性金色光屑（1.8s 内全部结束，不循环）+ 卡面光柱入场 + 金渐层胜者名 + 结果摘要（回合/出局/存活）+ `.draw` 平局变体（冷灰、无金光、明确区分胜利）+ 关闭弹层后 `winner-banner` 升级（胜者名高亮+角色+回合）；战场终局态 `battlefield.is-over`（空房间弱化+胜者房间金辉）+ 胜者卡 `.is-winner` 金环+👑徽章 |
| T-1401 | 战场主舞台升级（P0） | DONE | act 阶段揭示台收缩为单行状态条 `.reveal-board.compact`（判定结果+出牌顺序保留，空间让给战场，rps/重判阶段仍完整展开）；空房间轻量化（去大虚线框→斜纹底+小字，34px）；行动房间呼吸金边 `zone-acting-breath`；对手座位条弱化（44→36px 头像）；水印 alpha 0.035→0.05+字距放宽；终局后 battle-ctl 不再残留 |
| T-1402 | 视觉噪声审稿收尾（P0） | DONE | 结论：当前无常驻粒子/全屏动效（任务书截图中的星形粒子属旧版本）；常驻动画仅 行动者徽章/目标绿光/领域脉冲/行动房间呼吸 四项，全部有明确语义且 reduced-motion 下静止；本轮新增的金屑/聚光/爆炸/飞行全部一次性 forwards 且可跳过 |
| T-1410 | 大伊万结构化事件（P0 引擎侧） | DONE | 投掷日志补 `data {pid, room, explodeRound}`（characters/index.ts）；爆炸日志补 `data {room, source}`（engine.ts）；均为公开信息不泄漏隐藏状态；旧格式（无 data）客户端安全降级不演出 |
| T-1411 | 大伊万完整演出链（P0 前端侧） | DONE | `events.ts` 新增 ivanThrow/ivanBoom 解析；`queue.ts` 时长（飞行 1000ms/爆炸 1100ms，非 fast 可丢弃项）；`useBattlePresentation` 叠加态+过期清理；`IvanProjectile` 投掷物 DOM 测量飞行（来源卡→目标房间，1.05s 弧线+旋转+橙色辉光）；`zone-pending-ivan` 待爆警示（快照 deferred 驱动：房间橙虚线+「💣 第 N 回合末爆炸」脉冲标签）；`ivan-boom-fx` 落点冲击波（1.1s 一次性）；爆炸→逐目标斩击→淘汰按簇顺序（battle-queue.test.ts 回归） |
| T-1412 | 轻量原创音效系统（P1） | DONE | `client/src/audio/sfx.ts`：WebAudio 实时合成（振荡器+噪声缓冲），零素材/零网络/零许可风险；事件绑定 hit/heal/move/eliminate/revive/throw/boom/decl/victory；拥堵(fast)只保留重大事件音效；reduced-motion 只留 淘汰/爆炸/胜利；顶栏 🔊/🔇 开关（localStorage 持久化，默认开、音量 0.22）；无 AudioContext 环境全静默不抛错（tests/ui/sfx.test.ts 3 例） |
| T-1413 | 横屏终局弹层适配（P0 移动端） | DONE | 844×390 下弹层整体压缩：art 26vh/名字 23px/按钮 6px gap——实测按钮完整可见（modalBottom 352 < vh 390，fit=true）；390×844 竖屏按钮区不溢出（bottom 685 < 844） |
| T-1414 | 类型卫生（遗留 3 个 TS 错误清零） | DONE | LogLike.type 改可选（旧日志无 type 合法）；Home.tsx 两处 `as unknown as RoomOpResult`；`tsc --noEmit` 双端 0 错误（此前 HEAD 存在 3 个） |
| T-1415 | **B-030：E2E 构建污染生产内容** | FIXED | 发现：本机 systemd 生产实例（:3100）静态服务 `client/dist`，而 e2e.test.ts beforeAll 直接 `vite build client` 重建该目录 → 跑一次标准测试 = 无意间更新生产内容（实测 3100 服务 hash 从 Bi6T5qus 变为 BEGrRTsY）。修复：e2e 构建改到独立 `client/dist-e2e` + `process.env.CLIENT_DIST` 指向之；`.gitignore` 补录。修复后跑 e2e/全量测试，3100 hash 恒为 Bi6T5qus（HEAD 构建）。事故期间生产内容已被新构建短暂覆盖 → 已通过 stash+HEAD 重建完整恢复并验证 |
| T-1420 | 截图对比迭代（P0） | DONE | base → v3a → v3b 三轮截图（桌面/窄屏/横屏 × 出拳/行动/终局/伊万），发现并修复：横屏终局按钮裁切（T-1413）；炸弹起飞阶段偏小 → 42px+双辉光；过程截图见 /tmp/badian-shots/（base-*/v3a-*/v3b-*） |
| T-1430 | 回归测试 + build | DONE | **npm test：19 文件 / 241 用例全部通过**（233 基线 + 组件 3 + 队列 2 + 音效 3）；e2e 单独复跑 5/5（早前超时确认为并行构建争 CPU）；`tsc --noEmit` 双端清零；vite build 通过；B-030 修复后复跑全量 241/241 且生产 3100 hash 恒为 HEAD 构建（Bi6T5qus） |
| T-1440 | 移动端/Reduced Motion 验证 | DONE | Playwright `reducedMotion: 'reduce'` 实测：win-rays/particles/art animationName 全部为 none，静态画面信息完整（rm-win.png）；窄屏/横屏 0 JS 错误；窄屏揭示台 compact、待爆警示 jsdom 断言+实测 |

### 大伊万演出链实测时间线（scripts/visual-ivan2.ts，100ms 采样）

```
t+316ms  投掷物出现（.ivan-bomb=1，从投掷者卡面起飞）
t+1306ms 飞行结束（持续 ≈1.0s，弧线+旋转）
t+1526ms 爆炸落点（.ivan-boom-fx=1，目标房间橙色冲击波）
t+2667ms 冲击波结束（持续 ≈1.1s）；随后逐目标 斩击+伤害飘字+淘汰印章（有目标时）
```
- 空房爆炸（AI 走出房间）→ 只播冲击波、无受击演出（引擎行为正确，演出与数据一致）
- 同归爆炸 → 平局弹层（冷灰变体）正确出现，不误用胜利金色
- 待爆警示：投掷为回合内最后行动时窗口≈0（AI 即时应答）；真人局/下一轮爆炸（nextRoundEnd 配置）时全程可见；jsdom 用例锁定渲染逻辑

## 十五轮 · Battlefield Reimagining V2.0（2026-11-21，进行中）

> 任务书要求：不默认沿用旧布局；≥3 个真实可运行视觉架构原型比较后选择；视觉架构 × 战斗节奏 × 事件可理解性 × 终局延迟呈现统一实施；规则立即权威结算、演出按节奏呈现、终局 UI 不抢断关键事件链。

### Phase A · 基线审查（以 commit 89360e2 为准，工作区干净）

| 编号 | 核查项 | 结论 | 证据 |
|---|---|---|---|
| R2-001 | 仓库状态 | 基线 = `89360e2`（用户已将上轮 V3.0 提交并部署）；工作区干净，无用户未提交改动需要保护 | git log/status |
| R2-002 | 生产隔离核查 | :3100 = systemd 实例（新 pid 1094415），服务 `client/dist`（hash Bz5ntx2t = V3.0 构建，用户部署动作）；B-030 隔离（e2e→dist-e2e）已在位；本轮所有实验构建一律输出 dist-dev/dist-proto，不触碰 client/dist 与 server/dist | curl + ss |
| R2-003 | 基线测试 | `npm test` **241/241 全过**（15 文件 e2e 5 例含内） | 后台实跑 |
| R2-004 | 基线截图 | 三视口 × 出拳/行动/终局 10 张（v2base-*，/tmp/badian-shots） | scripts/baseline-shots.ts |
| R2-005 | 基线视觉诊断（V3.0 后残留问题） | ① 布局本质仍是「面板拼贴」：座位条/揭示台/房间网格/行动坞/日志是五个并列区块，战场只是其中一块；② 房间等宽网格无空间关系（R1-R4 纯标签）；③ 行动坞与战场分离，操作目标需在两个区域间往返；④ 终局弹层立即覆盖战场——致命事件链（爆炸/淘汰）可能被弹层抢断（V3.0 已优化演出链但未做终局延迟）；⑤ 事件焦点与房间位置关联弱（高亮叠加在网格上，无空间指向性） | v2base-* + 代码 |
| R2-006 | 上轮成果保护 | BattleEventQueue/结构化事件/伊万演出链/终局舞台/音效/reduced-motion 全部保留并作为本轮地基，不重建 | 代码审查 |

### Phase B · 三原型设计探索与决策

共享运行时（R2-100 DONE）：`client/src/proto/`——浏览器内直接运行真实引擎（伍六七 AOE / 伊万酱 / 马保国 / 五条悟 4 人 4 房间），自动驱动器+玩家可接管行动坞，日志流入与正式对局相同的演出管线（含终局延迟呈现）。入口 `?proto=A|B|C`，截图 `scripts/proto-shots.ts`。

| 原型 | 构图 | 实测结论（桌面 1440×900，截图 proto-{A,B,C}-*.png） |
|---|---|---|
| A 中央竞技场 | 房间为环绕中央事件核心的 12/3/6/9 点位据点；核心显示阶段/回合/事件流，事件时向房间投射光束 | ✅运行。核心焦点与光束指向极强（「哪里发生」最清楚）；但四角大量空白（桌面利用率最低），环形方位与 R1-R4 无语义关联，移动端绝对定位适配成本高 |
| B 空间地图 | 2×2 地图块+可见走廊连接，房间有地形图腾（🏔🌲🏘🏰）；移动画虚线路线；行动坞左下浮动面板 | ✅运行（修复了自动网格错位/日志收起态拉伸）。空间关系最明确、移动路线可读；但地图块本身大而空（房间内容密度低），「竞技感」弱，走廊在窄屏拥挤 |
| C 沉浸牌桌 | 整屏一张带透视的桌面：远端房间呈弧形、中央椭圆桌融合揭示+事件播报+出牌顺序、我的席位与手牌扇融合桌面下沿；日志=右侧账本 | ✅运行。战场即整屏、操作区融合桌面（视线无需跨区）、弧形天然表达「围桌竞技」、竖屏天然适配（弧形变横排+手牌常驻）；中央椭圆有空间承载事件飞行物 |

**决策（R2-104）：采用 C 沉浸牌桌式为主架构**，理由：①「战场=主舞台」完成度最高——整屏桌面、操作融合、无独立面板感；②操作流最短（目标就在桌面上）；③移动端天然适配；④对既有演出管线/FLIP/终局组件的复用成本最低。同时**吸收** A 的「中央事件播报聚焦」（act 阶段中央桌显示当前事件流）与 B 的「地形图腾房间标识」（超越颜色编码的房间身份）。

| 编号 | 任务 | 状态 |
|---|---|---|
| R2-100 | 共享原型运行时 | DONE |
| R2-101 | 原型 A | DONE（实测+截图） |
| R2-102 | 原型 B | DONE（实测+截图，修复网格/日志） |
| R2-103 | 原型 C | DONE（实测+截图） |
| R2-104 | 对比与决策 | DONE（选 C，吸收 A/B 亮点） |

## 十六轮 · BA-DIAN V4.1 · 3D 战场直接落地（2026-11-21，进行中）

> 任务书：BA-DIAN V4.1「3D 直接落地」。目标：把已选定的 C「沉浸牌桌」升级为真正可运行、可联机、可承载全部规则/角色机制的 3D 战场主体；2D UI 退居操作与信息层。不推倒规则/联机/AI/结构化事件/BattleEventQueue。

### Phase A · 工作区与安全基线（以当前工作区实际状态为准）

| 编号 | 核查项 | 结论 | 证据 |
|---|---|---|---|
| D3-001 | 工作区状态 | HEAD=`89360e2`（V3.0）；工作区含上一轮 V2.0 原型探索的**未提交修改**（client/src/pages/Game.tsx、tcg.css、useBattlePresentation.ts、App.tsx、battle/flip.ts、proto/*、finale-gate.test.tsx 等）——本轮全部保护，不覆盖不重置 | git status/diff |
| D3-002 | 基线测试 | `npm test` **20 文件 / 247 用例全部通过**（含未提交工作区新增的 finale-gate 6 例） | 实跑 95.6s |
| D3-003 | 生产隔离 | :3100 = systemd 生产实例（client/dist，不动）；e2e 隔离 dist-e2e（B-030 在位）；本轮构建一律 dist-dev（:3200 开发实例），不触碰 client/dist 与 server/dist（服务端验证用 tsx 源码运行 + tsc --noEmit） | ss + 配置审查 |
| D3-004 | 无头浏览器 WebGL | headless Chromium 支持 **WebGL2**（SwiftShader）→ E2E 可真实进入 3D 模式；jsdom 无 WebGL → 2D 回退，既有 UI 测试不受影响 | scripts 实测 |
| D3-005 | 事件/演出地基审查 | BattleEventQueue / 结构化事件 / useBattlePresentation（fx/hits/heals/misses/deaths/revives/zoneAlert/moveBanner/ivanThrow/ivanBoom）/ 终局延迟呈现 全部在位且为 3D 可复用的统一事件源；事件已携带空间信息（room/from/to/groupId/source） | 代码审查 |
| D3-006 | 角色清单提取 | 11 角色（default/bagun/chuixiao/gojo/laodaye/mabaoguo/wuliuqi/ivan-girl/hero-today/dajianke/dapihuai）+ 全部技能/机制，见 Phase D 覆盖矩阵 | characters/index.ts |
| D3-007 | 技术选型 | **Three.js 0.187（vanilla）+ 薄 React 封装**。理由：①仅引入 `three` 一个依赖，移动端体积可控；②演出队列是命令式时序模型，与 imperative scene API 天然契合；③React 仅做状态→命令桥接，渲染循环/资源释放完全自主可控；④无 WebGL 环境可整体回退现有 2D 牌桌（测试/低端机安全） | 决策记录 |

## 十七轮 · BA-DIAN V4.2 · 3D持续开发（2026-11-21，已完成）

> 承接十六轮 V4.1（HEAD=`eaec5f9`，battle3d 场景已提交）。本轮以真实运行画面为依据完成两轮实质迭代、演出矩阵取证与工程验收。全程未提交、未推送、未部署；工作区上一轮未提交修改（dist-dev 构建产物 + docs/screenshots-v3 截图）全部保留。

### Phase 0 · 接手审查（以实际运行为准，不以文档标记为准）

| 编号 | 核查项 | 结论 | 证据 |
|---|---|---|---|
| V4-001 | 工作区状态 | HEAD=`eaec5f9`；未提交改动仅 dist-dev 构建产物与 v3 截图（上轮产物，保护不清理） | git status |
| V4-002 | 环境 | 本机为全新复制环境：node_modules 缺失 → `npm install` + esbuild postinstall 批准重建；无 systemd 生产实例（3100/3200 均空闲，可安全起开发实例） | 实装过程 |
| V4-003 | 基线 TS | client/server `tsc --noEmit` 双 0 错误 | 实跑 |
| V4-004 | 基线测试 | 260 通过 / 5 跳过；e2e 1 文件因环境（esbuild 时序）失败，修复 esbuild 后复跑通过 | npm test 实跑 |
| V4-005 | 基线实机 | :3200（dist-dev）自动对局 0 JS 错误；3D 战场真实呈现：六棱石台房间+台阶+界柱+主题图腾+石径、低模人形（姿态/朝向）、中央事件舞台+徽记、出拳揭示、行动坞、终局舞台、伊万投掷/爆炸、淘汰印章、复活爆发、领域穹顶、镜头聚焦/轨道/重置 | shot3d.ts 抓帧 10 张 + 0 JS 错误 |
| V4-006 | 基线缺口（视觉审稿） | ① 桌面默认机位裁切「我的房间」（近端平台被底边+行动坞切掉）；② 揭示台 640px 遮挡远端弧线房间；③ 中央舞台空置；④ 死者名牌全尺寸悬浮抢眼；⑤ 移动端视口未验证；⑥ playDomain 为死代码（领域展开 trigger 被映射为通用 playTrigger，爆发/ticker/聚焦从未触发）；⑦ WebGL 上下文丢失（后详，B-031） | d3-01~10 逐张审稿 + 代码核查 |

### 迭代 1（P0 视觉与健壮性，全部实测验证）

| 编号 | 任务 | 说明 |
|---|---|---|
| T-1700 | 桌面默认机位重取景 | `layout.ts defaultPose`：桌面 radius 4.2→5.0 / height 12.8→14.4 / look.z 1.5→1.7 / fov 51——避开顶部揭示台（~130px）与底部行动坞（~190px）两块 UI 遮挡区，「我的房间」整体可见（修复前后截图对比：d3-01 新版我的房间+角色+底座完整入画） |
| T-1701 | 揭示台收紧 | 3D 模式揭示面板 640→520px、字号 12px、背景透明度 0.78，远端房间遮挡减少 |
| T-1702 | 中央事件核心升级 | 徽记八面体 0.5→0.68 + emissive 提升 + 极淡加色光柱（一次性常驻旋转呼吸，reduced-motion 静止）——待机阶段中央空场有「事件核心」存在感 |
| T-1703 | 死者名牌弱化 | `.b3-plate.is-dead`：透明度 0.62 + 缩放 0.86（经内联 transform 追加 `scale(var(--dead-scale))`，避免被投影定位覆盖） |
| T-1704 | **B-031 兜底：WebGL 上下文丢失自动回退 2D** | `webglcontextlost` 监听（preventDefault + 500ms 恢复等待）：恢复→继续；未恢复→`onContextLost` → Battle3D `setFailed` → 整体回退 2D 牌桌。实测：上下文丢失后 2D 牌桌完整接管（房间/日志/演出控制条/发言全在位），对局 0 中断 0 JS 错误（mx-*-battlefield-over 截图为证） |
| T-1705 | 空闲降帧渲染 | 无补间/特效/行走/镜头运动时按 20fps 渲染，活动期恢复满帧；相机趋近过程保持满帧（`camMoving` 判定）——降低 GPU 负载与移动端耗电 |
| T-1706 | 后台标签页暂停 | `visibilitychange` hidden → 停 rAF+clock；回前台恢复（dispose 同步移除监听） |

### 迭代 2（演出覆盖矩阵 + 真实缺口修复）

| 编号 | 任务 | 说明 |
|---|---|---|
| T-1710 | 场景调试探针 | `scene.debugStats()`（fx/tweens/walks/entities/rooms）+ `window.__b3scene`（E2E 只读探针，卸载时清理） |
| T-1711 | 演出矩阵取证脚本 | `scripts/pres3d-matrix.ts`：三视口（1440×900 / 390×844 / 844×390）各跑一局真实对局，单次 evaluate 批量探测 + MutationObserver 瞬态演出记录器（`__seen`）+ 上下文丢失时刻记录器（`__ctxLostAt`：时刻/回合/阶段/ticker 现场快照）；`LINEUP=gojo` 定向布阵（全员五条悟：2 条命→复活、领域→domain） |
| T-1712 | **B-032：领域展开演出链断裂修复（playDomain 死代码）** | 引擎：两处领域 trigger 日志补结构化标记 `data.domain=true`（shared/src/characters/index.ts）；events.ts：trigger 解析分支 domain→`{kind:'domain'}`（旧数据安全降级为普通 trigger）；queue.ts：`BASE_MS.domain=850`、不进 fast 可丢弃名单；useBattlePresentation：`domainDecl` 叠加态 + 110ms 过期 + sfx major；pres-adapter：`{c:'domain'}` 命令 + `scene.playDomain(pid)` 接线。实测：三视口 `✨ 领域展开！` ticker + 爆发 + 聚焦全部触发（`seen.domainTicker` 18~204 次/局，截图 mx-*-domainTicker） |
| T-1713 | 软件渲染器降级 | 检测 SwiftShader/llvmpipe（WEBGL_debug_renderer_info）→ `antialias:false` + `pixelRatio:1`（MSAA 在软件渲染下极贵）；硬件 GPU 保持全质量 |
| T-1714 | **B-033：3D 面板 backdrop-filter 逐帧模糊移除** | 揭示台/日志/行动坞三处 `backdrop-filter: blur` 悬浮在持续渲染的 WebGL 画布上 → 软件/低端 GPU 每帧全屏模糊合成（实测 SwiftShader 环境反复 GL 上下文丢失的相关因素之一）；提高底色不透明度替代（0.9~0.93），硬件 GPU 同样省电 |
| T-1715 | powerPreference 收敛 | 移除 `powerPreference:'high-performance'`（混合 GPU/驱动重评估可致运行中丢上下文；稳定性优先，改后桌面连续 2 局全程 3D 存活） |

### 迭代 3（移动端真实可玩布局，三视口实测）

| 编号 | 任务 | 说明 |
|---|---|---|
| T-1720 | 横屏机位 | 844×390：radius 6.2 / height 14.5 / fov 50——近端房间不被行动坞裁切、远端房间+名牌完整（mx-landscape-hitFloat 实测） |
| T-1721 | 窄屏揭示面板与视角按钮重叠修复 | <900px：揭示面板左对齐 `width: calc(100% - 104px)`，右上角留出「视角/2D」按钮组（修复前两者叠压，修复后干净分离，mx-narrow-attackBeam 实测） |
| T-1722 | 横屏揭示面板让位 | 横屏矮视口：面板收窄至 min(62%, 470px) 靠左，远端中央房间不被遮挡 |
| T-1723 | 3D 窄屏顶栏紧凑化 | gap/padding/字号收敛，顶栏高度明显下降（修复前 3 行占屏 ~1/3） |

### B-031 · WebGL 上下文丢失（✅ 根因已定位并修复；残余风险已策略化兜底）

排查过程（全部留证）：
- 触发：对局中 `webglcontextlost`（无 JS 错误、页面不崩溃），3D 画布白屏 → T-1704 兜底自动回退 2D，对局继续无感。
- 波及：本机 SwiftShader（headless）与 Intel UHD D3D11（headed 硬件 GPU）均复现；窄屏/横屏更频繁。
- 排除项：空闲场景 40s 存活；单类演出高压循环（12 类 × 60 次）全部存活；40 次连续截图存活；FX dispose 无泄漏（disposeObj 全量释放 geometry/material）。
- 特征：多发生在回合 2~5 的安静阶段（出拳/行动等待期，tickers='' floats=0），非负载峰值时刻——后成为定位根因的关键线索。

**根因（十八轮 Phase C 定位并修复）**：`detectWebGL()` 每次调用都创建真实 WebGL 上下文，而 `useState(!detectWebGL())` 在**每次渲染**都会执行（函数组件体随渲染重复运行）——高频快照广播的对局里每渲染泄漏一个探测上下文；Chromium 对存活 WebGL 上下文数量有上限，**触顶时驱逐最旧存活上下文**，主游戏画布一旦成为最旧者即被驱逐。这完美解释「安静阶段丢失」（渲染越频繁泄漏越快）与「FX 压测却存活」（单页挂载后泄漏停止）。

### 十八轮 · Phase C · B-031 根因修复 + GL 会话降级策略（2026-11-21，与十七轮同日接续）

| 编号 | 任务 | 说明 |
|---|---|---|
| T-1800 | **B-031 根因修复** | ① `Battle3D.tsx`：`useState(() => !detectWebGL())` 懒初始化（只执行一次）；② `detectWebGL()` 与场景软件渲染探测的探测上下文用 `WEBGL_lose_context.loseContext()` 显式释放。实测复现路径消除 |
| T-1801 | `gl-policy.ts` 会话降级策略 | 每次丢失计数（sessionStorage，跨 Game 页挂载存活）；会话累计 ≥3 次，或 60s 内连续 ≥2 次 → **本会话持久降级 2D**（防「重建 3D → 再丢失」循环）；用户 UI 主动切回 3D 清除标记（`clearSessionDegraded`）；策略纯函数化，jsdom 单测 9 例 |
| T-1802 | `gllog.ts` 诊断日志 | 丢失/恢复/降级/场景初始化全程留痕（附带回合/阶段/`debugStats()` 上下文；只读，不参与游戏逻辑） |
| T-1803 | 上下文恢复窗口优化 | 500ms → 4000ms（GPU 进程重启/驱动恢复通常秒级，过短易误降级）；新增 `onContextRestored` 分级处理（恢复成功但已达阈值 → 仍主动降级，宁可 2D 不冒重建循环风险） |
| T-1804 | 演出覆盖矩阵 B-031 项闭环 | 「3D→2D 回退」取证保留；根因修复后复验 |
| T-1805 | **B-035：e2e「战斗演出」用例双模式兼容 + 驱动加固** | HP 条断言扩为 `.ccard-hpbar, .b3-hpbar`（3D 名牌 HP 条）；驱动点击改原生 DOM click（React 高频重渲染下 Playwright actionability 超时 → 驱动静默停滞 → 无事件可采样的偶发失败根因）。复跑两轮 5/5 稳定 |

### 演出覆盖矩阵（三视口真实对局取证汇总）

| 演出类别 | 3D 呈现 | 取证 | 视口 |
|---|---|---|---|
| 攻击宣告 | 攻击姿态 + 蓝色预警光束 + 镜头聚焦 | mx-*-attackBeam ×3 视口 | 全 |
| 普通攻击/受击 | 前扑 + 斩击 + 伤害飘字 + HP 条 | mx-*-hitFloat ×3 | 全 |
| 多段伤害 | 斩击序列 + 分组飘字 | mx-landscape-slashCombo | 横屏 |
| 回复 | 施法姿态 + 治疗环 + 上升数字 | mx-landscape-healRing | 横屏 |
| 移动 | 弧线行走 + 行走姿态 + 尘土 + 落点聚焦 | mx-*-walk3d ×3 | 全 |
| 未命中 | 闪避侧移 + 「未命中」浮层 | 代码路径 + battle3d.test.ts 适配层用例；随机对局未自然触发（B-010 前置校验使 miss 罕见），如实标注 | — |
| AOE | 房间脉冲告警环 + 分组顺序 | mx-narrow-zoneAlert | 窄屏 |
| 淘汰 | 印章 + 红环 + 闪光 + 震屏 + 倒地 + 名牌弱化 | mx-*-deathStamp ×2 + d3-08 | 全 |
| 复活 | 金色爆发 + 起身 + 「N 命复活」 | mx-*-reviveBurst ×2（gojo 布阵 9~12 次/局） | 全 |
| 领域展开 | 爆发 + 闪光 + ticker + 聚焦 + 穹顶（B-032 修复后） | mx-*-domainTicker ×3 | 全 |
| 大伊万 | 投掷物弧线飞行 + 落点冲击波 + 待爆警示 | d3-03/04（V3 链路沿用）+ mx-narrow-ivanTicker/boomTicker | 桌面+窄屏 |
| 终局 | 演出链播完 → 聚光舞台 + 胜者卡 + 摘要；战场终局态 | mx-*-finale-modal + battlefield-over ×3 | 全 |
| 3D→2D 回退 | 上下文丢失自动回退，2D 全功能接管 | mx-*-battlefield-over（回退后画面） | 全 |

### 工程验收

| 编号 | 项 | 结果 |
|---|---|---|
| T-1730 | tsc --noEmit | client/server 双 0 错误（多轮复验） |
| T-1731 | npm test | **21 文件 / 282 用例全部通过**（含真实 Chromium E2E 5 例；两轮复跑均全过） |
| T-1732 | 生产构建隔离 | 本轮构建全部输出 dist-dev（:3200），e2e 走 dist-e2e（B-030 隔离在位）；client/dist 与 server/dist 仅因 server 端 domain 标记重建（B-032 需要，tsc 全量重编译，内容与 HEAD 等价+新标记） |
| T-1733 | 保护用户修改 | 未提交、未推送、未部署、未动生产配置；工作区继承的上轮未提交内容（dist-dev 旧产物、screenshots-v3）原样保留 |
| T-1734 | **B-034：e2e 断言不兼容 3D 模式** | 「单人开局→战场渲染」用例断言 `.ccard-art img`（2D 房间卡）——3D 模式下战场卡牌由场景与名牌头像（`.b3-av img`）取代，WebGL 环境必然 0 张失败（HEAD=eaec5f9 已引入；V4.1 记录的 247 通过为 3D 集成前的基线）。修复：断言扩为 `.ccard-art img, .b3-av img, .ms-art img`（双模式兼容，意图不变：卡面图至少 1 张真实加载） |
| T-1806 | 测试分布核实 | 282 = 共享用例 108 + 领域 20 + 战斗演出事件 14 + 演出队列 23 + 广播游标 4 + 退出/占用 7 + AI 回归与难度 15 + 联机集成 11 + 超时兜底 6 + 隐藏出拳 4 + 战绩 4 + 互动 4 + 回放 3 + 多局日志 6 + 音效 3 + UI 组件 11 + 退出逃生口 1 + battle3d 27 + 终局延迟呈现 6 + E2E 5（逐文件实测核对） |

### 十九轮 · 二次判定亲自出拳（交互层改造，2026-11-21）

| 编号 | 任务 | 说明 |
|---|---|---|
| T-1900 | 引擎 `rps2` 交互阶段 | `GamePhase` 新增 `rps2`；新增 `orderQueue/orderGroup/orderOrder/orderPending/orderSubmittedIds/orderSub` 状态；公开 `submitOrderThrow` / `forceFillOrderThrows` / `currentOrderGroup()`；递归分组改为「待排序组队列」迭代实现，保留 10000 子轮安全上限 |
| T-1901 | 领域不参与二次判定 | `resolveOrderSubRound` 不传 tieWin：排序子轮同拳即平局并重掷（此前会「平局算胜」）；`serverRoll` 分支同步移除 tieWin |
| T-1902 | 大屁孩判定与二次判定解耦 | 不再向 `judgeHistory` 写 rps2 子轮：连续同拳不会触发「三同自爆」，暴走/自爆只受回合判定（rps1）影响 |
| T-1903 | 服务端配套 | `game:throw` 按阶段路由；`kickAI` 处理 rps2；出拳超时（30s，仅 ≥2 真人布防）覆盖 rps2；AI 看门狗现场签名纳入排序提交数；房间默认规则 `secondJudgeMode: 'player'` |
| T-1904 | 客户端交互 | 行动坞排序出拳面板（复用交设备遮罩 `ThrowPrivacy`，`stage='rps2'`）与等待态文案；揭示台按「初次判定 / 排序判定·子轮 N」呈现并给出排序结论；顶栏阶段文案 |
| T-1905 | 测试 | 新增 `tests/order-rps2.test.ts` 12 例（递归/平局重掷/领域不参与/大屁孩历史/超时/房间集成）；既有用例显式 `serverRoll`；socket 集成驱动补 rps2 分支 |
| T-1906 | 工程验收 | `npm test` **22 文件 / 294 用例全过**；`npm run build`（server tsc + client vite）通过；client / server `tsc --noEmit` 双 0 错误 |
| T-1907 | **修复：单设备多人出拳遮罩概率性白屏**（用户实测） | `ThrowPrivacy` 用数组下标追踪出拳身份，提交后名单收缩导致 `myIds[idx]` 为 undefined → 渲染抛 TypeError → React 卸载整棵树（所有面板消失）；触发与否取决于「广播 vs ack」到达顺序。改按 `playerId` 追踪 + 身份消失回退遮罩 + 提交异常兜底 |
| T-1908 | 全局错误边界 | 新增 `client/src/ErrorBoundary.tsx`，`main.tsx` 包裹 `<App/>`：渲染异常显示可读提示 + 重新载入，不再白屏 |
| T-1909 | 回归与复核 | 新增 `tests/ui/throw-privacy.test.tsx` 4 例；`npm test` **23 文件 / 300 用例全过**（合并 main 的 V4.3/V4.4 后 +2）；Playwright 实跑本机 3 人局（点第 3 个身份）不白屏、无 console 报错 |




---

## 二十三轮 · V4.3：3D 战场稳定性与体验闭环（2026-11-21）

> 承接 V4.2（HEAD=db9cf08 前的工作区，用户随后将 B-031 根因修复与 GL 会话降级连同 V4.2 内容提交为 db9cf08）。本轮目标：B-031 根因定位与修复、长局可靠性验证、演出节奏分级、移动端复验。全程未提交、未推送、未部署；构建全部输出 dist-dev（:3200），e2e 走 dist-e2e，client/dist 与 server/dist 未触碰。

### B-031 根因定论与修复（本轮核心成果）

| 编号 | 项 | 内容 | 证据 |
|---|---|---|---|
| T-1901 | **根因实证** | `Battle3D.tsx` 的 `useState(!detectWebGL())` 非懒初始化：Battle3D 作为函数被 GameInner 每次渲染调用，`detectWebGL()` 每次同步创建一个**不释放的 WebGL 探测上下文**；AI 局广播频繁 → 存活上下文数累计触达 Chromium 上限（16）→「驱逐最旧存活上下文」，GC 已回收旧探测画布时被驱逐的正是主游戏画布。完美解释 B-031 全部既有特征：无 JS 错误、与 GPU 负载无关（SwiftShader/硬件 GPU 都复现）、非确定性、多发于快照广播期 | 探针实证：对局中等价调用 24 次后主画布 `webglcontextlost` + 控制台 `Too many active WebGL contexts`（.tmp-build/probe-ctx2.ts）；修复后完整对局 getContext(webgl) 调用数恒为 4（挂载期），全程 0 丢失 0 警告 |
| T-1902 | **根因修复** | ① `useState(() => !detectWebGL())` 懒初始化（只执行一次）；② `detectWebGL()` 与 scene.ts 构造器探针用 `WEBGL_lose_context.loseContext()` 即时释放 | A/B 对比实测（见 T-1901） |
| T-1903 | **Phase C 会话降级策略**（gl-policy.ts） | 每次上下文丢失计数（sessionStorage，跨 Game 挂载存活）：会话累计 ≥3 次或 60s 内 ≥2 次 → 本会话持续降级 2D（防重建循环崩溃）；恢复窗口 500ms→4000ms（GPU 进程重启秒级，500ms 易误降级）；恢复成功但已达阈值 → 主动降级（宁可 2D 不再冒循环风险）；用户在 UI 主动切 3D → 清除降级标记重新计数 | gl-policy 单测 5 例 + 端到端注入三场景全过（A 恢复路径/4s 超时回退/重载持久降级，.tmp-build/soak-ctx.ts） |
| T-1904 | **Phase A 诊断日志**（gllog.ts） | 环形缓冲（240 条）记录 scene-init（渲染器/软件渲染/像素比）/ctx-lost/ctx-restored（含恢复耗时）/ctx-lost-timeout/fallback-2d/degrade-after-restore/scene-disposed，每条带时间戳/回合/阶段/场景统计；`window.__b3log` 取证探针；只读观测，不影响游戏逻辑 | 单测 4 例；注入测试 gllog 留痕完整核对 |
| T-1905 | **恢复后状态一致性** | three r187 在 `webglcontextrestored` 自动重建 GL 资源（源码核对 `onContextRestore→initGLContext`）；场景层再强制一次 `resize()` 重建绘制缓冲 | 注入测试 A：恢复后 entities 4→4 一致、继续渲染 |

### 渲染器切换生命周期修复（审查发现）

| 编号 | 项 | 内容 | 证据 |
|---|---|---|---|
| T-1906 | **3D↔2D 切换资源泄漏** | 原实现：挂载 effect 依赖 `[failed]`，切 2D 后 view div 卸载但 scene 不 dispose（raf 循环 + WebGL 上下文持续空转）；2D 模式无任何切回 3D 的入口。修复：Battle3D 增加 `active` 生命周期参数（false → dispose）；场景重建以 epoch 代数驱动快照/演出/高亮/reduced-motion 立即水合（不等下一次广播）；2D 模式提供「3D」按钮（对称闭环） | soak-toggle.ts：切 2D → scene 卸载 + bt-table 接管；切回 3D → entities/rooms 立即恢复 4/4，gllog 记录 disposed→created；0 JS 错误 |

### Phase B 长局压力验证（soak3d.ts，新增脚本）

| 场景 | 结果 |
|---|---|
| 多局连续对局（restart→大厅→再开局） | g1 182 事件/15 回合 + g2 连续局 108 事件/10 回合 + g3 gojo 473 事件/48 回合，三局全部完整结束、场景复用无重建 |
| 后台暂停/恢复 | document.hidden 模拟：暂停中 0 fps，恢复后帧率与暂停前一致（12→13fps；随后 29fps 为演出期空闲降帧解除的正常表现，无双启动特征） |
| WebGL 上下文丢失注入 | 恢复路径（2s 后 restoreContext → 继续渲染状态一致）/不恢复路径（4s 窗口超时 → fallback-2d → 2D 牌桌推进 8 个动作）/会话持久降级（标记 → 重载直接 2D）三场景全过 |
| 资源观测量 | 三局 heap 12~13MB 稳定；DOM 节点随事件数正常波动（377~1110）；全程 **0 JS 错误 / 0 上下文丢失 / 0 "Too many contexts" 警告** |

### Phase D 演出分级与节奏

| 编号 | 项 | 内容 |
|---|---|---|
| T-1907 | **镜头聚焦三级优先级** | S 级（终局/大伊万链/领域/复活）> A 级（淘汰/AOE）> B 级（攻击宣告/移动/行动者切换）；高优先级保持期内忽略低优先级请求（防争抢）；聚焦令牌化（新聚焦使旧衰减定时器失效，防旧定时器提前压低新聚焦）。B 级聚焦权重/时长收敛（宣告 0.42/800ms→0.34/700ms，移动 0.3/900→0.24/650ms） |
| T-1908 | **复活聚焦补全** | playRevive 此前无聚焦（S 级事件缺镜头价值）→ 补 S 级聚焦 0.6/1100ms；队列 revive 时长 700→820ms 对齐金色爆发+起身可读时长 |
| T-1909 | **拥堵丢弃保留 S/A 级簇**（本轮 Phase D 实质改进） | 时间线探针发现：AI 局后半段日志批量涌入（实测 131~473 条一瞬到达）→ 旧策略「丢弃全部旧积压」把大伊万/淘汰/领域也丢掉 → 终局前几乎无演出。改进：turbo 丢弃只清 B 级簇（eliminate/revive/domain/ivanThrow/ivanBoom/lethal damage 保留）；fast 模式重大事件时长 260→420ms 下限（可辨认）；保留上限循环优先丢非重大簇。验证：终局窗口演出活动从 0~3 浮层提升至 5~7 持续；gojo 矩阵 reviveBurst ×9 / domainTicker 36~69 次捕获恢复 | 

### Phase E 打击感

| 编号 | 项 | 内容 |
|---|---|---|
| T-1910 | 受击挤压（squash & stretch） | 受击瞬间 260ms 体积脉冲（y 压缩 16% / xz 膨胀 9%），基准缩放取实体创建值（连续受击不累积漂移）；reduced-motion 时禁用 |
| T-1911 | 致命/重击微慢动作 | lethal 或 amount≥3 时全体演出 90ms 慢速一拍（dt×0.15，纯视觉；结算与演出队列时序不受影响）；reduced-motion 时禁用 |

### Phase F 移动端验证（mobile3d-check.ts，新增脚本；模拟视口）

| 视口 | 结果 |
|---|---|
| 390×844（竖屏） | 无横向溢出；**发现并修复：揭示板与「视角/2D」按钮组重叠 12px**（CSS 预留 104px < 按钮组实际 108px → 预留改 116px，复测重叠=false）；受击/淘汰演出捕获 ✓；触摸轨道拖拽（pointer 事件）0 错误 ✓；2D 回退 ✓；行动坞占战场高 46%（设计内） |
| 844×390（横屏） | 全部检查通过（重叠=false、行动坞占 25%、无溢出、0 JS 错误、2D 回退 ✓） |
| ⚠️ 标注 | 本验证为 Playwright 设备视口模拟（无真实触屏/GPU/浏览器内核差异）；顶栏按钮高 23px 为 V4.2 有意紧凑化，实机触摸体验建议真机复核 |

### 演出矩阵回归（pres3d-matrix.ts，随机 + gojo 双轮）

| 视口 | 随机轮 | gojo 轮 | JS 错误 / ctxLost |
|---|---|---|---|
| desktop 1440×900 | attackBeam, walk3d | attackBeam, domainTicker, hitFloat, **reviveBurst**（seen: domain 36 + revive 9） | 0 / 0 |
| narrow 390×844 | attackBeam, walk3d | attackBeam, domainTicker, hitFloat（seen: domain 41） | 0 / 0 |
| landscape 844×390 | attackBeam, domainTicker | attackBeam, domainTicker（seen: domain 69） | 0 / 0 |

- 随机轮早期 captured 偏少 → 时间线探针定性为对局日志「批量涌入 + 旧拥堵策略丢全部积压」所致（非演出链回归）→ T-1909 修复后 S 级捕获恢复。矩阵截图见 `docs/screenshots-v4/v43/`。

### 工程验收

| 编号 | 项 | 结果 |
|---|---|---|
| T-1912 | tsc --noEmit | client/server 双 0 错误（多轮复验） |
| T-1913 | npm test | **21 文件 / 284 用例全部通过**（含真实 Chromium E2E 5 例；V4.2 基线 282 + 队列保留策略 2 + battle3d gl-policy/gllog 9 - 分布重核；逐项跑通无跳过） |
| T-1914 | 构建隔离 | dist-dev 多轮构建（:3200 开发实例验证用）；e2e 独立 dist-e2e（B-030 在位）；client/dist 与 server/dist 零触碰 |
| T-1915 | 交付边界 | 未提交、未推送、未部署、未动生产配置。注：用户在会话中自行将 B-031 根因修复/GL 会话降级/切换修复之前的部分连同 V4.2 内容提交（db9cf08），本轮其余增量（切换生命周期/D/E/F/拥堵保留/脚本/截图）保留在工作区未提交 |
| T-1916 | 新增文件 | client/src/battle3d/gllog.ts、gl-policy.ts；scripts/soak3d.ts、mobile3d-check.ts；docs/screenshots-v4/v43/（15 张取证） |

### V4.3 遗留与下一阶段建议

1. **真实环境复核**：B-031 根因修复后需在真机（手机/桌面硬件浏览器）长局观察确认零丢失；会话降级策略在真实驱动崩溃场景的表现待实机反馈。
2. **降级阈值可调**：B3D_MAX_LOST=3 / 60s 窗口为经验值，如真实环境出现过早降级可参数化暴露。
3. **演出时长分级再校准**：fast 模式重大事件 420ms 下限在极高频对局（gojo 12+ 复活/局）的累计停留时长可再观察。
4. **顶栏触摸热区**：23px 高的顶栏按钮在真机上的可点性待反馈（V4.2 紧凑化决策，本轮未动）。
5. 本轮验证均为模拟视口/无头 Chromium；实机横竖屏切换、真实触控轨道手感未覆盖。


---

## 二十四轮 · V4.4：3D 战场体验迭代（用户 11 项需求，2026-11-21）

> 用户实测反馈 11 项（含 2 张真实游玩截图）。原则同前：不动规则/数值/结算；构建全部 dist-dev；未提交未推送未部署。

| # | 需求 | 实现 | 验证 |
|---|---|---|---|
| 1 | 移动房间要有行走动画 | **根因修复**：快照与演出同批到达时，快照 effect 先于演出 effect → 实体已被 syncEntity **瞬移**到新房间，随后的 playWalk 起终点相同 → 动画不可见。修复：抽出 startWalkTo 共用，syncEntity 房间迁移改为「从当前位置平滑走到新槽位」（快照权威=终态，视觉=过渡）；playWalk 复用同一函数保留尘土+聚焦 | 三局实测 debugStats.walks>0（AI 移动可见行走） |
| 2 | 点战场房间直接选房，不要下拉 | 3D 选房行动时：全部房间石台绿光高亮（edge/beacon 变绿）；confirm-bar 用 `.room-pick-hint` 提示替代 select 下拉；**3D 模式不预填房间**（防误确认移动到默认房），确认按钮在选择前禁用；2D 牌桌保留下拉 | E2E：下拉=0、提示联动、点击 R2 → 已选+确认可用（两回合复验） |
| 3 | 看板太大挡视线 | 3D 揭示板：顶部居中 → **左上角**（width min(56%,470px)）；隐藏长说明文案；等待列表/揭示卡/判定行密度收紧 | E2E：x=8、宽 37%，不再遮挡远端房间 |
| 4 | 死亡尸体及时回收 | killPose 后 2.6s 淡出（0.8s tween）→ rig.root.visible=false；名牌保留「淘汰」徽标；复活 standUp 恢复可见 | debugStats 新增 bodiesHidden 计数，实测峰值 3 |
| 5 | 建模优化+打击感 | rig 剪影细节：肩部块/发型块（accent 色）/鞋块；打击感：受击**击退位移**（沿攻击来源方向推开回弹）+ 命中**白闪→红闪两段**（先白一瞬再红）；叠加 V4.3 squash/hitstop | 三局 0 错误；截图目视轮廓更分明 |
| 6 | 房内直接再来一局 | 服务端 `restart({autoStart})`：重置后立即以原座位开局（一次广播，不回大厅中间态）；`room:restart` handler 传 autoStart:true；**无参 restart 行为不变**（回大厅），存量测试全兼容 | E2E：「再来一局」→ 0s 内进入新局（无 .seat-slot 大厅闪现）→ 新局健康运行（logs 86~154） |
| 7 | 喝牛奶/今日运势全局播报 | 播报链路：pres 新增 announce 桶 → 战场中央上方 `.global-announce` 横幅（3D/2D 共用，2.1s 自动消失）；milk 由既有 action fx 触发；**引擎 fortune trigger 日志补结构化 data {pid,fortune,roll}**（同 B-032 手法，不动规则） | E2E：运势/牛奶横幅均捕获；queue BASE_MS.fortune=900、fortune 入拥堵保留名单 |
| 8 | 躲藏目标点不了要说原因 | pickTargetOrDetail 四分支原因提示：👻隐身 / 🙈躲藏（注明 AOE 与无视躲藏仍可命中）/ ⚔异房间近战不可及 / 🎯远程需先瞄准 | 逻辑实现+TS 通过；端到端机会性验证未稳定复现（依赖 AI 躲藏行为），如实标注 |
| 9 | 运势用后技能卡灰化 | 快照 `char.fortuneUsed`（引擎已有状态，全量下发）→ options 标记 used → scard `is-used` 灰化+disabled+「🚫 本局已使用」 | E2E 诊断：is-used 类与 disabled property 均在（初判误报系 React 用 DOM property 渲染 disabled，getAttribute 为 null） |
| 10 | 两人 UI 重叠 | 名牌按房间成员序水平错开（58px×slot，updateOverlay 应用）；房间标签外移（1.7→2.0 半径）下移避让 | 截图复核：同房间 3 人名牌横向分散清晰 |
| 11 | 看不到日志 | 顶栏「📜 日志」加**未读徽标**（抽屉收起时新增日志计数；挂载时已有日志不计入——修复 useRef 初始值竞态）；金色 badge 数字 | E2E：主循环捕获徽标「4」；调试日志证实 seen/unread 计算正确 |

### 工程验收

| 编号 | 项 | 结果 |
|---|---|---|
| T-1920 | tsc --noEmit | client/server 双 0 错误 |
| T-1921 | npm test | **21 文件 / 284 用例全部通过**（含 E2E 5；restart 无参语义不变→存量 restart 测试零改动兼容） |
| T-1922 | 新增文件 | .tmp-build/verify-v44*.ts（验证脚本，临时）；取证截图 D:/tmp/badian-shots/v44-*.png |
| T-1923 | 交付边界 | 未提交/未推送/未部署；client/dist、server/dist、部署配置零触碰 |
| T-1924 | 遗留 | ⑧躲藏提示的端到端机会性验证（依赖 AI 行为频率）；名牌错开 58px 步长在极端人数（6 人同房）下的观感待真机反馈；restart 直达开局后「返回房间大厅」入口仍保留在终局面板 |


## 二十五轮 · 马保国三种判定改为玩家亲自出拳（Issue #10，2026-11-22）

用户要求：混元形意太极 / 闪电五连鞭 / 不讲武德都改为**玩家自己猜拳判定**；不讲武德攻击类型定义为**精神攻击**；五连鞭伤害公式的最大血量改为**当前血量**、伤害保持**单次总量**。

| 编号 | 任务 | 说明 |
|---|---|---|
| T-2500 | 引擎 judge 阶段 + 判定队列 | GamePhase 新增 judge；新增 judgeQueue / activeJudge / judgeResume / deferredDamage；公开 `requestJudge` / `deferDamageJudge` / `submitJudgeThrow` / `forceFillJudgeThrows` / `skillJudgeView()`；判定在行动后或回合末的安全点暂停收拳，结算完再恢复（`resumeAfterJudges`） |
| T-2501 | 太极改为双方出拳 | 受伤时**挂起伤害**（`deferredDamage` + `req.judgeResolved`），双方各出一拳；赢则原伤反弹、平局/输则补结算正常受伤；反弹链仍由 `reflected` 终止；大伊万/肉山 `noReflect` 例外不变 |
| T-2502 | 五连鞭改为双方出拳 + 当前血量 | 5 局逐局提交/揭牌；伤害改为 胜次 × 20% × 目标当前血量，仍为**单次总量**（一条伤害事件） |
| T-2503 | 不讲武德改为双方出拳 + 精神攻击 | 死后 5 局判定；赢 ≥3 局对击杀者发动 dtype: 'mental' 伤害（伤害 = 其当前血量，`noReflect`、`bypassHide`）；checkWin 在存在待结算不讲武德时延迟判胜，保留同归于尽语义 |
| T-2504 | 兼容模式 | skillJudgeMode: 'serverRoll' 保留旧的种子代掷即结算路径；共享用例助手与 AI 模拟用例显式使用该模式，避免 474 条存量用例被交互流程污染 |
| T-2505 | 服务端与客户端 | game:throw 按阶段路由（rps1/rps2/judge）；kickAI 即刻代出判定出拳；超时代掷与 AI 看门狗覆盖 judge；游戏页新增技能判定出拳面板（交设备遮罩、等待态、局数/胜负提示）、座位已出拳角标 |
| T-2506 | 测试与验收 | 新增 `tests/skill-judge.test.ts`（12）+ `tests/ui/skill-judge-ui.test.tsx`（2）；`npm test` **28 文件 / 488 用例全过**；client/server `tsc --noEmit` 双 0 错误；`npm run build` 通过 |
| T-2507 | 文档 | GAME_RULES（马保国条目、阶段流程、A-03、待确认 4、伤害管线）、KNOWN_ISSUES、ARCHITECTURE（阶段机）、README（角色表/测试数）、CONTRIBUTING、CHANGELOG、docs/characters/mabaoguo.md 同步 |

## 二十六轮 · 全局播报机制代替日志翻找（Issue #39 / T-6.0.1，2026-11-22）

用户要求：每个动作都像喝牛奶一样所有人可见，并且有反馈时间；用全局播报代替翻日志。

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-6.0.1 | 播报规则表 | DONE | 新增 `shared/src/announce.ts`：16 条内置规则（milk/fortune/domain/revive/eliminate/damage/heal/move/deferred/judge/order/result/trigger/action/phase/error）＋兜底，保证「引擎写了日志就一定有播报」；`registerAnnounceRule()` 可插拔扩展（默认插最前、返回撤销函数）；`buildAnnouncements/mergeAnnouncements/condenseAnnounceQueue` 纯函数 |
| T-6.0.2 | 服务端权威广播 | DONE | `Room.toAnnouncements()` / `catchUpAnnouncements()`；`room:update` 新增 `announces`（与 `newLogs` 同批、所有座位同一份、含服务端 `ts`）；重连补发同窗口（最近 300 条日志） |
| T-6.0.3 | 客户端横幅与抽屉 | DONE | `client/src/battle/announce-view.tsx`：通用横幅（icon＋文本＋`HH:MM:SS`＋停留秒数，动画时长按 `ttlMs` 内联）；「📣 播报」抽屉（时间倒序／⭐ 重点过滤／空态／未读徽标）；`useBattlePresentation` 独立播报队列（seq 去重、首帧补发不回放、局号变化清空、拥堵保留队首＋high） |
| T-6.0.4 | 测试与验收 | DONE | 新增 `tests/announce.test.ts`（25）+ `tests/ui/announce-ui.test.tsx`（8）；`npm test` **32 文件 / 553 用例全过**（含 e2e 5 真实 Chromium）；client/server `tsc --noEmit` 双 0 错误；`vite build` 通过 |
| T-6.0.5 | 文档 | DONE | README「全局播报」章节（接口表＋扩展示例＋协议字段＋优先级语义）、CHANGELOG、TASKS.md 登记 |

### 工程边界与遗留

| 编号 | 项 | 说明 |
|---|---|---|
| T-611 | 规则侵入性 | 零：只读 `LogEntry` 的 `type/text/data/important`，不动数值、结算顺序、隐藏出拳语义（提交阶段日志无拳种） |
| T-612 | 兼容性 | 新增字段可选：旧客户端忽略 `announces`；旧服务端不发送时客户端按无播报降级；`useBattlePresentation` 第 5 参数可选，proto/存量测试零改动 |
| T-613 | 遗留 | 横幅按 `ttlMs` 串行播放，超长局（一次广播几十条）仍会排队；已用「队首＋high」压缩策略缓解。真机上 3D 聚焦镜头与横幅层级（top 13%）需目视复验 |

## 二十七轮 · 真人对 AI 慢速演出 + AI 找出来策略（Issue #61，2026-11-24）

用户要求：真人和 AI 打时演出也要慢速；检查并优化 AI 对躲藏目标的「找出来」策略。先提 Issue 再 PR。

| 编号 | 任务 | 状态 | 说明 |
|---|---|---|---|
| T-61.1 | 座位组成节奏策略 | DONE | 新增 `client/src/battle/pace-policy.ts`：`resolvePresentationPace(seats, search)` —— 真人/本机 + AI 混合局默认 `slow`；显式合法 `?pace=` 保留调试覆盖（`Object.hasOwn` 防原型键）；纯 AI/纯真人跟随 URL 或默认档。`Game.tsx` 以 `useMemo(lobby.seats)` 计算并传入 `useBattlePresentation` 第 6 参 |
| T-61.2 | 队列档位可观测 | DONE | `QueueState` 新增 `pace`；构造/setPace/emitState 同步；`.battlefield` 输出 `data-pace`（常驻，不依赖演出队列），e2e 断言混合局为 `slow` |
| T-61.3 | AI 找出来策略 | DONE | `server/src/ai.ts` 新增 `seekTargets`/`shouldSeekHidden`；三档难度在同房间只剩躲藏者时优先 seek（普通按残血、硬核按威胁排序），候选链兜底含 seek；`allowSeek=false`/隐身/异房间/已淘汰不产生 seek；无视躲藏（拔棍）、AOE/辱骂接管、纯远程、零攻击角色不浪费 seek |
| T-61.4 | 角色特化修正 | DONE | `ai-strategies.ts`：`firstInRoom` 去掉难度门槛（硬核伍六七/大剑客可直接打躲藏者）；五条悟普通难度先过滤可见成员，不再盲打躲藏者 |
| T-61.5 | 测试与验收 | DONE | `tests/pace.test.ts` +6（座位策略/覆盖/原型键/队列 pace 状态）；`tests/integration/ai-difficulty.test.ts` +10（三档 seek 首选/候选链/真实落地/规则关闭/隐身/异房间/淘汰/角色豁免/伍六七 AOE/五条悟）；e2e 混合局 `data-pace=slow` 断言 |
| T-61.6 | 文档 | DONE | AGENTS.md「演出节奏与 AI 策略扩展点」、README 测试摘要、TASKS.md 登记 |

## 二十八轮 · 新角色：佝偻弓箭手（Issue #71，2026-11-26，本地待评审）

认领：Issue #71（4 位新角色）已指派给 wkdjdjskaksj、标签 status: in-progress；本轮只实现「佝偻弓箭手」，其余三位按用户后续指令处理。按要求**只在本地提交，不推送 GitHub**。

| 编号 | 任务 | 说明 |
|---|---|---|
| T-2600 | 状态系统基础设施 | 新增 `shared/src/statuses.ts` 注册表（tick/actions/cleanup）与 `PlayerState.effects` 权威状态；引擎 `addStatus/removeStatus/getStatus/hasStatus/tickStatuses`、回合末统一结算（含平局回合）、死亡清理；快照只投影 `PublicStatusEffect`（kind/severity/remainingRounds/stacks/source）。 |
| T-2601 | 附加行动框架 | `Game.extraActionsFor` 聚合「状态提供的行动 + 在场角色为他人提供的行动」，`submitAction` 统一校验/执行，快照 `extraActions` 下发当前行动者；客户端行动坞直接渲染（服务端权威），UI 不写死角色名。 |
| T-2602 | 角色扩展点 | `CharDef` 新增 `traits / attackEffects / onLethalDamage / onRoundStart / skipsAction / onAttackLanded / extraActionsForOthers`；引擎在伤害结算、队列推进、回合开始、普攻命中处调用。 |
| T-2603 | 佝偻弓箭手本体 | 血 3 远程 1；普攻点燃（燃烧 0.5/回合、无限、平局计入、点燃/扑灭当回合不结算）；骷髅身躯（非精神/非燃烧致死→倒地1回合、仍参与猜拳、不可行动、下一回合半血复原；燃烧致死永久死亡；精神致死正常死亡）；同房间燃烧者引燃骷髅；同房间敌人取箭2次+燃烧箭近战（1伤+点燃），取箭被其攻击中断。 |
| T-2604 | 客户端 | 状态读取器新增「燃烧」（`status-readers.ts`，2D/3D 通用）；行动坞渲染 `extraActions`；`cards.ts` 占位卡面与文案；`palette.ts/rig.ts` 骨弓道具与配色。 |
| T-2605 | 测试 | `tests/character-hunchback.test.ts` 13 例（点燃/结算/扑灭/引燃/取箭/中断/倒地复原/精神与燃烧致死/快照公开字段）；共享用例 TC-C098~C100；状态读取器 +2 例。`npm test` **45 文件 / 697 用例全过**，双端 `tsc` 0 错误，`npm run build` 通过。 |
| T-2606 | 文档 | `docs/characters/hunchback-archer.md` 新增；GAME_RULES（角色条目 + A-20/A-21/A-22 假设）、README（角色表 / 3D 说明 / 测试数 697）、CHANGELOG 同步。 |
| T-2607 | 交付边界 | 本地分支 + 本地提交，**未推送、未开 PR**；等待用户下一步指令（其余三位角色 / 后续调整）。 |
### 用户反馈调整（2026-11-26 同日，本地）

| 编号 | 调整 | 说明 |
|---|---|---|
| T-2608 | 倒地时长改为「完整缺席 1 回合」 | 倒地当回合之后的那个回合整回合不能行动（仍参与猜拳、平局计入），再下一回合开始时以生命上限一半复原；角色测试与共享用例 TC-C099 同步 |
| T-2609 | 远程攻击可打同房间目标 | `CharDef.rangedSameRoom`；`base-actions` 放开同房间远程校验；客户端目标列表与 `ranged: true` 标记同步；AI 策略纳入同房间目标 |
| T-2610 | 燃烧箭攻击一次后失效 | 攻击后 `pendingArrow` 清空，需重新取箭；测试覆盖「第二次使用被拒绝 + 只提供取箭」 |
| T-2611 | 骷髅无法主动「回复」回满血 | `CharDef.blockBaseActions = ['heal']`；引擎拒绝该行动、客户端隐藏「回复」；测试与共享用例 TC-C101 覆盖 |
| T-2612 | 验收 | `npm test` 45 文件 / 697 用例全过；双端 `tsc` 0 错误；`npm run build` 通过；仍为本地分支，未推送 GitHub |
## 二十九轮 · 新角色：鬼影（Issue #71，2026-11-26，本地待评审）

| 编号 | 任务 | 说明 |
|---|---|---|
| T-2900 | 鬼影本体 | 血 2 / 攻 1.5；单次受伤上限 0.5（`onBeforeDamage` 压缩并清除秒杀）；无法主动回复（`blockBaseActions: ['heal']`）。 |
| T-2901 | 附身机制 | `possess` 行动：无视距离移动 + 附身（不可锁定躲藏/隐身）；宿主获得 `possessed`、鬼影获得 `possessing`；附身期间鬼影 `invisible`。 |
| T-2902 | 附身伤害与回血 | `possessed` 每回合末 1 伤（含平局回合，附身/驱赶当回合不结算），伤害等量 `heal` 给鬼影（上限截断）。 |
| T-2903 | 胜利额外行动 | 赢下判定后可用一次行动「折磨宿主」（+1 伤、等量回血）或「操控宿主」（用宿主攻击力攻击其同房间目标）。 |
| T-2904 | 解除附身 | 宿主可花一次行动「驱逐鬼影」；宿主死亡/鬼影死亡自动解除并现形；两个状态互解清理防递归。 |
| T-2905 | AI / 客户端 | `aiStrategy`（未附身优先附身、已附身折磨）+ `ai.ts` 自动追加无目标附加行动；`status-readers` 新增被附身/附身中；`cards/palette/rig` 鬼影占位卡与幽光道具；修正客户端近战目标未过滤隐身。 |
| T-2906 | 测试 | `tests/character-ghost.test.ts` 10 例；共享用例 TC-C102~C104；状态读取器鬼影用例。`npm test` **46 文件 / 714 用例全过**，双端 `tsc` 0 错误，`npm run build` 通过。 |
| T-2907 | 文档 | `docs/characters/ghost.md`；GAME_RULES 角色条目 + A-23/A-24；README 角色表/3D 说明/测试数；CHANGELOG 同步。 |
| T-2908 | 交付边界 | 本地分支 + 本地提交，**未推送、未开 PR**；等待用户下一步指令（狂猎 / 飞天水螅 / 调整）。 |
### 用户反馈调整（2026-11-26 同日）

| 编号 | 调整 | 说明 |
|---|---|---|
| T-2909 | 受伤上限口径 | 普通伤害（物理/特殊，含大伊万 999999、AOE）仍压到 0.5；**秒杀类精神攻击无视上限**（`dtype: 'mental'` + `instakill`：大屁孩暴走/大贱客辱骂/不讲武德直接淘汰）。角色测试与共享用例 TC-C102 同步，文档 A-23 已更新。 |