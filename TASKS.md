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
| T-103 | 二次判定行动排序（输者先，递归分组） | DONE | serverRoll 模式（假设A-02） |
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

## 遗留事项

见 docs/KNOWN_ISSUES.md（今日勇者技能缺失、真实浏览器端到端受限、二次判定手动出拳 UI 未做等）。
