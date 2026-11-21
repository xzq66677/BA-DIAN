# 战场集成规范

- `Game.tsx` → `Battle3D.tsx` → `BattleScene.syncSnapshot()` 消费权威快照；`Battle3D` 保留现有可见性、水合、3D/2D 切换与 WebGL 回退。角色不能拥有额外相机、渲染循环或独立 canvas。
- `room Group → entity Group (pid) → rig.root`。`layout.ts` 给房间与泊位，`palette.ts` 给旧视觉配置，场景控制定位、世界朝向、地影、选取、名牌、状态环、相机和世界补间；角色 rig 仅写局部关节及道具。换房要检查世界到局部转换和最终房间；选择沿用现有 UI 和目标校验。
- [注册与工厂](../../client/src/battle3d/characters/index.ts) 按 `charId` 选视觉，实例由实体持有。`createCharacterAsset` 返回 `{ id, rig, stick, dispose }`。仅 `gojo` 对应 `gojo-v1`；无专属注册的角色沿用 `Humanoid`，未知 ID 使用默认视觉。现有同步工厂不是异步错误回退 API。
- 同 PID/charId 同时存在时复用；换房保留资产；换角、离场、销毁释放。淘汰隐藏不是释放，余命起身需可复用。实例拥有自己的可变资源；清实体补间，分离根节点，遍历子树去重释放几何/材质，`dispose()` 幂等。受击结束或复活时恢复实例原材质，不用固定下标。用 Three `dispose` 事件验证对象释放，用重开前后绘制计数另验稳态。
- **DEPRECATED**：用材质槽下标恢复颜色，或让无归属的迟到淡出隐藏已复活角色；分别改为按实际材质保存和按当前生命周期/场景时钟更新。
- **UNVERIFIED**：异步导入、共享贴图与资源池。试点需先设计场景代、实体/PID、角色和请求代的校验，以及加载失败回退、监听注销、资源引用与 GPU 清理；不得直接沿用当前实例独占型 `dispose`。整场房间/领域/炸弹资源不由角色工厂负责，角色测试不覆盖它们的释放。

关键实现：[场景](../../client/src/battle3d/scene.ts)、[布局](../../client/src/battle3d/layout.ts)、[生命周期测试](../../tests/ui/gojo-lifecycle.test.ts)。
