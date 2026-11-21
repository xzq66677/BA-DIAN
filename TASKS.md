# TASKS.md · 拔典开发任务追踪

> 自动维护。状态：TODO / IN_PROGRESS / DONE / BLOCKED
> 开发时间：2026-11-19 15:19 — 16:16（约 1 小时实际执行，远未到 10 小时窗口，全部任务提前完成）

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
| T-202 | 吹箫哥（仅远程/瞄准） | DONE | TC-C010~012；瞄准为基础行动 |
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
| T-407 | 真实 Chromium 端到端点击测试 | BLOCKED | 服务器缺图形系统库且无 sudo；已尝试 Playwright |

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
| T-550 | 排查确认：吹箫哥瞄准为强制规则（引擎实测未瞄准→拒绝、瞄准后→命中） | VERIFIED | 非缺陷 |
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


