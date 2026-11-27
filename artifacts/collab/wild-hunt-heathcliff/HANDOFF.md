# 狂猎资产交接

正式角色 ID 为 `wild-hunt`，视觉版本为 `wild-hunt-heathcliff-wraith`。当前交付为 [最终 GLB](model/wild-hunt-heathcliff-wraith.glb)、[离线动作预览](model/wild-hunt-heathcliff-wraith-preview.html)、[骑乘与颈部近景](model/wild-hunt-heathcliff-wraith-poses.png) 和 [资产规格](asset-spec.json)。规格记录哈希、体积、挂点和所有 clip 的时长。

骑手使用同一套骨骼网格完成徒步、上马、骑乘和下马。幽马用独立骨骼，马颈与马身连续相接，向上逐渐雾化。透明马头和边缘雾丝通过 `DullahanSpirit` 的两条 morph 轨道随各动作播放。

本版骑手沿用工作区提供的 AI 生成徒步网格，经减面、材质简化及重新绑定。幽马、动画与雾化几何在协作资产上重制。本包提供最终发布模型和可独立验证的离线预览。最终美术迭代没有保留完整 DCC 工程或可复建 GLB 的源流水线。早期高模、生成参考和旧版本不作为这一版的运行输入。

## 绑定和验证

- 通用 `idle`、`walk`、`attackSwing`、`flinch`、`dead`、`reviveRise`、`cheer` 可按同名语义接入。上马、骑乘待机、骑乘冲锋、下马使用 `mount`、`mountedIdle`、`mountedAttack`、`dismount`。
- `ChargeOffset` 在冲锋内沿局部 +Z 走 2.55 米。演出层只采样一次这条位移，服务端通过权威事件和快照决定实际房间、目标和结果。上马结束和下马起始使用同一骑乘姿态。
- `Saddle`、`HorseRoot`、`HandR` 和 `Head` 可用于场景挂点。保留 `DullahanSpirit` 的透明材质与 morph 轨道。实例切换材质透明度时保留各材质的初始透明度。
- 使用浏览器打开离线预览，检查 11 段动画，点击「连续演示上下马」验证上马、骑乘待机、冲锋和下马。此前在 Chromium 检查了侧面、俯视和冲锋近景，并验证了 2.55 米位移与无回跳的连播。
- 已接入的游戏事件、规则和 `CharacterRig` 映射见 [四角色接入交接](../../../docs/FOUR_CHARACTER_INTEGRATION.md)。
