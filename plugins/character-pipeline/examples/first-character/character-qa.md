# Character QA · gojo-v1

[最终实战归档](../../../../docs/screenshots-v50b/2026-11-21T14-47-11-623Z/match.json)：Windows，Chromium 159.0.8154.6，桌面 1440×900、窄屏 390×844 CSS px，DPR 1。房间 `L8VS`，种子 `3449104997 / 3442331977`，五态观察对象 `P2-eags`。第一局 3D、重开后第二局切换 2D，均六回合结算。

| 项目 | 实际与证据 | 状态 |
|---|---|---|
| 稳定机位待机 | 首局第 1 回合 R2，[原帧](../../../../docs/screenshots-v50b/2026-11-21T14-47-11-623Z/01-idle.png)；待机本身不需要战斗日志 | VERIFIED（浏览器） |
| 普通受击 | 第 3 回合 `#29 damage`，HP `3→2`，[原帧](../../../../docs/screenshots-v50b/2026-11-21T14-47-11-623Z/04-hit.png) | VERIFIED（浏览器与权威日志） |
| 近战出手 | 第 4 回合 `#38` 宣告 / `#41 action`，[原帧](../../../../docs/screenshots-v50b/2026-11-21T14-47-11-623Z/05-attack.png)；该截图不能区分两个命令入口 | VERIFIED（浏览器与权威日志） |
| 消耗余命 | 第 5 回合 `#50` HP 到 0，`#51 trigger.livesLeft=1`；3 HP、`alive=true`，[原帧](../../../../docs/screenshots-v50b/2026-11-21T14-47-11-623Z/06-revive.png) | VERIFIED（浏览器与权威日志） |
| 最终淘汰 | 第 6 回合 `#62 eliminate`，`alive=false`，[倒地帧](../../../../docs/screenshots-v50b/2026-11-21T14-47-11-623Z/07-death.png)，随后模型隐藏；`#63 result` 是结算 | VERIFIED（浏览器与权威日志） |
| 换房、重开及 2D | 同房重用场景与 PID/资产；几何 `110→110`、纹理 `1→1`；重开时 FX/行走/补间归零，第二局正常结算 | VERIFIED（浏览器，非长期资源压力） |
| 无名牌辨识、手机真机 | 本轮无法做默认比例盲测，无实际触控、移动 GPU 帧时、热稳定和五六房证据 | UNVERIFIED |

**视觉迭代**：同为 Chromium 390×844、首局第 3 回合三人同房，[修前 C7D8](../../../../docs/screenshots-v50b/2026-11-21T14-37-32-245Z/03-mobile-viewport.png) 的行动坞与角色投影框相交 100%，改为竖屏分行且随战场容器重算镜头后，[修后 L8VS](../../../../docs/screenshots-v50b/2026-11-21T14-47-11-623Z/03-mobile-viewport.png) 不相交，角色投影框完整入镜。两次为同场景脚本的不同种子，不是严格同种子 A/B；修后名牌约 8%、揭示栏约 13% 矩形交集仍存在。桌面见[同房全景](../../../../docs/screenshots-v50b/2026-11-21T14-47-11-623Z/03-same-room-full.png)与[五态图版](../../../../docs/screenshots-v50b/2026-11-21T14-47-11-623Z/review-poses.png)。

已保留 [选目标失败](../../../../docs/screenshots-v50b/2026-11-21T14-29-51-276Z/match.json) 与 [重开取证超时](../../../../docs/screenshots-v50b/2026-11-21T14-34-41-889Z/match.json)；应按不同故障归因，不以最终通过覆盖失败证据。
