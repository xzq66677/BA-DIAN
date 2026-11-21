# 结构化事件绑定规范

服务器先结算并广播快照/增量日志。按 `LogEntry.kind` → 客户端 `SnapLog.type` → [解析](../../client/src/battle/events.ts) → [队列](../../client/src/battle/queue.ts) 和展示桶 → [3D adapter](../../client/src/battle3d/pres-adapter.ts) → 场景方法核对。下表是 **VERIFIED（源码契约）**；最后一列仅表示五条悟专项实战覆盖。

| 需求名称 | 实际日志/权威状态 | 表现与场景 | 五条悟样本 |
|---|---|---|---|
| attack | `damage{declared:true,source,target}`；另有 `action{pid,fx:'attack',targetId?}` | `attackDecl → playAttackDecl` 与 `action → playAction`；可触发同一语义姿势，不是两次伤害 | VERIFIED 近战，单帧不能区分两入口 |
| hit / damage / miss | 实伤 `damage{target,source?,amount,hpBefore?,hpAfter?,lethal?,room?}`；`state{missed:true,target}`，也兼容 `damage.missed` | `damage → hit → playHit` 使用实际目标；`miss → playMiss`，不触发受击 | VERIFIED 普通命中；miss、反弹/转移 UNVERIFIED |
| multi-hit | 无独立日志；多笔 `damage` 可携 `groupId`、`segment`，某些多次判定汇总一笔 | 沿用 `damage → hit`；不承诺全都产出 N 个动作 | UNVERIFIED |
| heal | `heal{target,amount,hpBefore,hpAfter}` | `heal → playHeal`；展示 HP 端点不从 amount 猜；治疗 action 可另有提示 | UNVERIFIED |
| move | `move{pid,from,to}` | `move → playWalk`；快照控制房间归属，不能按日志 from 重建实体历史 | VERIFIED 两次移动 |
| aoe | 无独立日志；实际分组伤害的 `groupId`/`room` 可派生告警 | `zoneAlert → playRoomAlert`；告警不是目标名单，同提交命中命令在告警前 | UNVERIFIED |
| eliminate | `eliminate{pid,cause,killer?}`；权威 `alive=false` | `eliminate → death → playEliminate`；快照也可先启动倒地 | VERIFIED |
| revive | `trigger{pid,livesLeft}`；满血保持 `alive=true`，不发相应 `eliminate` | `revive → playRevive`；`lethal` 不等于最终淘汰 | VERIFIED |
| domain | `trigger{pid,domain:true}`；持续领域取快照 | `domain` → 展示桶 `domainDecl` → `playDomain`；房间穹顶独立，不是五条悟专属动作 | UNVERIFIED |
| ivan | 投掷 `deferred{pid,room,explodeRound}`、引爆 `deferred{room,source}`；待爆取快照 | `ivanThrow → playIvanThrow`、`ivanBoom → playIvanBoom`；伤害走实际 `damage`，不重播伊万告警 | UNVERIFIED |
| terminal | 终局快照 `phase=over/winner`，`result` 不被解析为表现事件 | 无 `terminal` 命令；胜者欢呼/镜头意图和 UI 终局门控分别处理，不等待 GPU | VERIFIED 结算与胜者欢呼样本；正确聚焦 UNVERIFIED |

规则阶段 `rps1 / act / roundEnd / over` 不等于播放阶段。队列按批和 `action` 分簇，可将簇尾行动提示提前；adapter 按桶和 key diff，桶内相同 key 不重发。同一次提交按源码顺序：宣告、行动、命中/治疗/未命中、淘汰/复活、移动、伊万、房间告警、领域，不是全局 seq 调度。首包不播历史；重开/水合、快进或丢弃装饰后以快照收敛。不能修改事件数据、结算顺序或协议来弥补视觉缺口。缺结构化字段安全降级，不读日志文本推断事件。

已有风险另立回归：队列跳过不保证撤回 Three 补间；领域展示桶过期、长日志窗口、重连和胜者 PID/房间聚焦均需要定向验证。现有专项没有证明所有拥堵、时序与重联路径。
