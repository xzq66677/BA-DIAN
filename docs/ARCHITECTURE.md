# 拔典 · 技术架构

## 总体结构

```
┌─────────────────────────── client (React + Vite + TS) ───────────────────────────┐
│  Home(首页)  Lobby(大厅)  Game(游戏页)  Arena(机制测试场)                           │
│  net.ts（Socket.IO 封装：请求/状态接收，不决定任何游戏结果）                         │
│         │  ▲ 只读导入 shared 引擎与测试用例（测试场在浏览器本地跑引擎）              │
└─────────┼──┼──────────────────────────────────────────────────────────────────────┘
     socket.io  │直接 import（isomorphic）
┌─────────▼──┴──────────── server (Node + Express + Socket.IO + TS) ────────────────┐
│  index.ts（socket 事件路由/房间HTTP）  room.ts（Room 房间管理/超时/AI驱动）          │
│  ai.ts→aiDecideAction（AI 决策：只提交合法行动，与规则引擎分离）                     │
└──────────────────────────┬────────────────────────────────────────────────────────┘
                           │ 调用（唯一入口）
┌──────────────────────────▼──────────── shared（核心规则引擎，纯 TS，无 IO 依赖）────┐
│  engine.ts  Game 类：阶段机 rps1→rps2→act→judge→roundEnd→over、行动校验、伤害管线、淘汰、胜利  │
│  judge.ts   初次判定（分组递归）+ 二次判定排序（输者先，递归分组；玩家/代掷两种出拳来源）   │
│  rng.ts     mulberry32 种子随机（全对局随机性唯一来源，可复现）                      │
│  chardef.ts 角色接口（钩子/技能/修饰器），characters/ 注册表（10+1 角色实现）        │
│  types.ts   全部类型与 RuleConfig（规则开关，如 secondJudgeMode）                 │
│  testcases/ 测试用例数据（vitest 与网页测试场共用同一份）                            │
└───────────────────────────────────────────────────────────────────────────────────┘
```

## 关键设计

### 1. 规则引擎独立于前端与网络
- `shared/src` 不依赖 express/socket.io/react；浏览器（测试场）与服务端运行同一份引擎代码。
- 所有游戏结果（出拳判定/行动顺序/伤害/淘汰/胜利）由引擎产生；客户端只做展示与请求；AI 也只通过 `submitThrow`/`submitAction` 提交，不直接改状态。

### 2. 阶段状态机
```
rps1 ──全部提交──▶ 回合判定 ──平局/三人循环──▶ trigger（回合前触发：大屁孩暴走/自爆）──▶ roundEnd ──▶ 下一回合
  │                    └─分出胜负─▶ trigger ──▶ rps2（资格者亲自出拳，逐子轮递归排序）──▶ act（队列逐个行动）
  │                                                                                      │
  │        judge（马保国技能判定 / 太极反弹：双方逐局亲自出拳、AI 即刻代出）◀─────────────┘
  │           └─ 判定结束才补结算：太极挂起的伤害 / 五连鞭伤害 / 不讲武德精神攻击 → 继续 act
  ▼
over ◀──checkWin── roundEnd（延迟事件：ivan/damage）◀──队列耗尽──┘
```

- **trigger 阶段**（回合最前）：大屁孩的暴走/自爆在这里统一结算；暴走由本人指定任意其他存活玩家；多名大屁孩同时暴走时先用 rps2 排序决定暴走权顺序（`orderPurpose: 'berserk'`，快照 `trigger` 字段）。
- **判定中断与恢复**：判定结算途中（判定历史入史 → 暴走 → 伤害 → 太极挂起 / 不讲武德排队）排入的技能判定必须**立刻暂停当前收尾**，等判定全部结束再继续（`judgeResumeHook`）；否则会出现「平局卡死」或「行动先于判定」。`applyDamage` 的 `instakill` 让精神攻击在**结算时**按目标当前血量计算，判定挂起期间回血无法抵消。

### 3. 隐藏提交
- 出拳值仅存于服务端 `pendingThrows`；快照 `snapshot()` 不包含未揭示拳种，只广播 `submittedIds`（已提交者名单）。
- 判定揭示后写入 `judgeRecords`（含双方拳种）随快照下发，前端展示「本轮判定记录」。
- 单设备多人：同 socket 绑定多座位；前端逐身份「交设备遮罩」，本人点击后出拳，提交成功后返回遮罩，不回显拳种（服务端 ack 亦不含拳种）。

### 4. 伤害管线（可扩展钩子）
`applyDamage(req)`：
1. transfer 阶段钩子（大贱客吸引：改目标、剥离附加效果）；
2. 躲避拦截（`hidden/invisible` 且非 AOE/非无视 → miss）；
3. defense 阶段钩子（马保国太极：种子判定→改目标为来源并标记 `reflected`）；
4. 结算（instakill 秒杀 / 数值扣血，浮点精确到 0.25）；
5. 附加效果（已转移的伤害剥离 effects）；
6. HP≤0 → `eliminate`（移出房间、清状态、死亡钩子链深度保护、checkWin；`ignoreLives` 时不消耗命数）。

**精神攻击（独立词条）**：`shared/src/mental.ts` 的 `mentalKill()` 是唯一入口（`dtype: mental` + `bypassHide` + `ignoreLives`，伤害=目标当前血量）。角色实现只调用它，不要手拼 `applyDamage` 字段或绕过管线直接 `eliminate`——这样躲藏/命数/转移/反弹四条语义才能保持同源。

### 5. 角色系统（配置与基础规则分离）
- `CharDef`：基础面板（hp/attack/attackType/ rangedCapable/ rangedNeedsAim…）+ 钩子（onBeforeDamage + damageHookStage、onDeath、onRoundEnd、onJudgeAppend、validateAttack、onAttackAction、dynamicDamage）+ 技能 `actions` + 领域标记。
- 新增角色 = 注册一个 CharDef，无需改引擎（禁止 if/else 硬编码）。
- 角色私有状态存于 `player.char`（隔离于玩家/房间/全局状态）。

### 6. 随机数与复现
- 全部随机性来自 `Game.rng`（mulberry32，种子随开局固定）；AI 出拳亦走 `game.rng`，服务端代掷/技能判定同理。
- 房间保存开局规则、地图、角色与输入序列。真人输入、AI 输入、超时与离席均进入记录；AI 额外消耗的随机数也会保存。
- `replayMatch(transcript, toTick?)` 可从开局重演到某一步，并核对快照和日志。完成的对局由当前仍在房间内的原参与者凭令牌获取输入记录。记录随房间进程保存在内存中。
- 协议和重演输入各有版本号。修改角色规则或随机数语义时需要评估重演版本是否升级。

### 7. 房间与联机（server/src）
- 房间：4 位邀请码、房主、座位（human/local/ai）、令牌（token，仅下发一次）。
- 事件：room:create/join/reconnect/leave/setChar/addAI/removeSeat/start/restart；game:throw/action/state。
- 断线重连在验证令牌后重绑同设备座位并补发快照。写操作校验当前绑定的连接和座位令牌。
- 超时：出拳 30s 代掷、行动 45s 跳过（可配置；0=关闭）。**只在房间内有 ≥2 名真人时布防**（`Room.needsTimeout()`）：单人 vs AI 时 AI 即时应答、无人等待，超时只会打断本人思考，因此不布防；单设备多人同理。
- AI 兜底：`kickAI` 的候选行动链保证 AI 永不因非法决策卡住；另有 `startAIWatchdog()`（1.2s，`state==='playing'` 期间运行，`disarmAll` 清理）在「仍等 AI 出拳 / 仍轮到 AI 行动」时补驱动一次，只动 AI、不动真人。
- 广播：`room:update` = 大厅快照 + 游戏快照 + 增量日志（按 seq 去重）+ `you`。
  - **seq 在房间内单调递增**：引擎的 `logSeq` 每局从 1 开始，`Room` 用跨局游标 `logSeqCursor` 在开新局时作为 `GameConfig.logSeqOffset` 传入，因此同一房间第二局之后 seq 继续增长，增量过滤与客户端去重都不会把新日志误判为旧日志。
  - `lobbySnapshot().gameNo` 每开一局 +1，客户端据此清空上一局日志（否则两局日志会首尾相接、回合号重复）。
  - **广播游标与重连补发**：增量游标 `Room.broadcastLogSeq`（`takeNewLogs()` 取走增量并推进，房间级单游标，单次上限 300 条）；断线重连时向该 socket 单独补发最近 300 条（`catchUpLogs()`，不推进游标、不影响其它座位的增量）。

### 7b. 结构化战斗事件与演出队列（client/src/battle）

- **事件 schema（shared/src/types.ts）**：演出所需日志全部携带类型化 `data` —— 攻击宣告（declared/source/target/amount/ranged）、实际扣血（target/source/amount/hpBefore/hpAfter/lethal/dtype/tag/segment/aoe/room/groupId/reflected/transferred）、回复（target/amount/hpBefore/hpAfter）、移动（pid/from/to）、淘汰（pid/cause/killer）、复活（pid/livesLeft）、行动（pid/fx/label/targetId/room）。字段可缺省，旧事件客户端安全降级。
- **演出队列（BattleEventQueue）**：纯类实现，与 React 解耦。按 seq 幂等消费日志 → 解析为类型化演出事件 → 分簇（引擎一次行动的日志以 action 收尾，簇首即行动 fx，先播行动者再按序演事件）→ 顺序/分组播放（AOE/多段/延迟伤害同 groupId，先房间告警再逐目标）。
- **拥堵策略**：按「积压时长」而非簇数判定（AI 局一次广播天然携带多个行动）；积压 >9s 进入 fast 压缩（跳过低重要度事件），>22s 丢弃最旧簇、保留最新（最新事件永不丢演出，被丢内容的结果已由快照呈现）。支持 1×/2×/4× 倍速、跳过本段、跳过全部；`prefers-reduced-motion` 时长收敛。
- **权威边界**：快照（game.players）始终是显示权威；演出叠加层（斩击/飘字/HP条/飞行动画/死亡印章）只做视觉表现，由结构化事件驱动，不通过快照 HP 差分猜测，也不触发任何规则效果。重连时 `initFromLogs` 仅推进游标，不回放历史特效；局号变化 `clear()` 清空，不把旧事件演到新局。
- **HP 条**：CSS 过渡（延迟 0.26s + 0.42s 缓动）让斩击先落下、血条随后平滑变化；宽度始终来自真实快照值。

### 8. 机制测试场
- `shared/src/testcases` 为唯一测试数据源：113 个用例（编号 TC-E/TC-C/TC-X）。
- vitest 从同一数据源跑自动化回归；网页测试场（Arena 页）在浏览器内直接运行同一份用例 → PASS/FAIL、预期 vs 实际、完整结算日志、种子复现。测试场不是另一个模拟器。

## 通信协议摘要

| 方向 | 事件 | 载荷要点 |
|---|---|---|
| C→S | room:create/join | name, charId, localPlayers[]（单设备多人） |
| C→S | room:reconnect | code, playerId, token |
| C→S | game:throw | code, playerId, token, throw |
| C→S | game:action | code, playerId, token, action{type,targetId,room} |
| S→C | room:update | { lobby, game(snapshot), newLogs[], you } |
| S→C | game:over | { winner } |

所有写操作均携带 token；服务端校验身份与阶段合法性后才调用引擎。
