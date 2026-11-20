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
│  engine.ts  Game 类：阶段机 rps1→act→roundEnd→over、行动校验、伤害管线、淘汰、胜利  │
│  judge.ts   初次判定（分组递归）+ 二次判定排序（输者先，递归分组）                   │
│  rng.ts     mulberry32 种子随机（全对局随机性唯一来源，可复现）                      │
│  chardef.ts 角色接口（钩子/技能/修饰器），characters/ 注册表（10+1 角色实现）        │
│  types.ts   全部类型与 RuleConfig（规则开关，如 ivanExplodeTiming）                 │
│  testcases/ 测试用例数据（vitest 与网页测试场共用同一份）                            │
└───────────────────────────────────────────────────────────────────────────────────┘
```

## 关键设计

### 1. 规则引擎独立于前端与网络
- `shared/src` 不依赖 express/socket.io/react；浏览器（测试场）与服务端运行同一份引擎代码。
- 所有游戏结果（出拳判定/行动顺序/伤害/淘汰/胜利）由引擎产生；客户端只做展示与请求；AI 也只通过 `submitThrow`/`submitAction` 提交，不直接改状态。

### 2. 阶段状态机
```
rps1 ──全部提交──▶ resolveJudgeSubRound ──平局/循环──▶ 下一子轮（重出拳）
  │                      └─分出胜负──▶ 二次判定（服务端代掷）──▶ act
  │                                                              │逐个行动
  └──checkWin（自爆/暴走等可在判定阶段致终局）                    ▼
over ◀──checkWin── roundEnd（延迟事件：ivan/damage）◀──队列耗尽──┘
```

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
6. HP≤0 → `eliminate`（移出房间、清状态、死亡钩子链深度保护、checkWin）。

### 5. 角色系统（配置与基础规则分离）
- `CharDef`：基础面板（hp/attack/attackType/ rangedCapable/ rangedNeedsAim…）+ 钩子（onBeforeDamage + damageHookStage、onDeath、onRoundEnd、onJudgeAppend、validateAttack、onAttackAction、dynamicDamage）+ 技能 `actions` + 领域标记。
- 新增角色 = 注册一个 CharDef，无需改引擎（禁止 if/else 硬编码）。
- 角色私有状态存于 `player.char`（隔离于玩家/房间/全局状态）。

### 6. 随机数与复现
- 全部随机性来自 `Game.rng`（mulberry32，种子随开局固定）；AI 出拳亦走 `game.rng`，服务端代掷/技能判定同理。
- 同种子 + 同操作序列 = 完全一致的对局日志（有测试保证）。

### 7. 房间与联机（server/src）
- 房间：4 位邀请码、房主、座位（human/local/ai）、令牌（token，仅下发一次）。
- 事件：room:create/join/reconnect/leave/setChar/addAI/removeSeat/start/restart；game:throw/action/state。
- 断线重连：token 验证 → 重绑 socketId → 下发完整快照；重连不绕过行动限制（提交仍校验当前行动者与令牌）。
- 超时：出拳 30s 代掷、行动 45s 跳过（可配置；0=关闭）。**只在房间内有 ≥2 名真人时布防**（`Room.needsTimeout()`）：单人 vs AI 时 AI 即时应答、无人等待，超时只会打断本人思考，因此不布防；单设备多人同理。
- AI 兜底：`kickAI` 的候选行动链保证 AI 永不因非法决策卡住；另有 `startAIWatchdog()`（1.2s，`state==='playing'` 期间运行，`disarmAll` 清理）在「仍等 AI 出拳 / 仍轮到 AI 行动」时补驱动一次，只动 AI、不动真人。
- 广播：`room:update` = 大厅快照 + 游戏快照 + 增量日志（按 seq 去重）+ `you`。

### 8. 机制测试场
- `shared/src/testcases` 为唯一测试数据源：103 个用例（编号 TC-E/TC-C/TC-X）。
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
