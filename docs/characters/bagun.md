# 拔棍 · bagun-v1 · 角色记录

按 plugins/character-pipeline 九步工作流执行。基线 `e4cef57` + laodaye 改动。2026-11-21。

## 规格（1）

- charId `bagun`：血3攻1；需先「拔棍」才能造成伤害；拔棍状态攻击无视躲避。行为字段：`char.stickDrawn`。
- 剪影信号：利落短打 + 宽腰带 + 发髻 + 右手木棍（拔出/收回切换）。
- 必需动作：通用全套 + 棍可见性切换；非目标：不做拔棍专属动作（可见性即状态）。

## 资产/标准化（2-3）

- 程序化源 `client/src/battle3d/characters/bagun.ts`；共享 kit.ts。站高 1.361（palette scale 1），reset 脚底 0.025。
- 工厂暴露 `stick`（Object3D，初始不可见）：`createCharacterAsset` 读取 rig 同名属性返回 `asset.stick`，场景 `scene.ts:826` 按快照驱动 visible——与 legacy Humanoid 的 stick 契约一致。

## 接入/动画/事件（4-6）

- models 注册 `bagun → bagun-v1`。事件链无新增（攻击走既有 playAction；stickDrawn 是快照同步字段）。

## 测试（7）VERIFIED

- `npx vitest run tests/ui/character-assets.test.ts tests/ui/gojo-lifecycle.test.ts` → 38 passed。
- 资产套件断言 `root.getObjectByName('stick')` 存在；生命周期"换角保棍"用例改为断言 `asset.id === 'bagun-v1'` 且 stick 可见性随快照切换（原断言 bagun 为 Humanoid 已随专属化收窄），unknown 回退仍为 Humanoid。

## 视觉验收（8）

- 39 原始帧归档 `docs/screenshots-characters/2026-11-21-bagun/`（含 `bagun-stick-drawn.png` 拔棍状态、gojo 同屏 lineup）。
- 迭代：① kit 默认 headY .64→.53 修复断颈（bagun 自身显式 headY 一并移除）；② 自制横扫攻击读不出挥击 → 改用通用劈砍（gojo/laodaye 已验证观感），辨识交给棍体；③ 棍与腰带垂带剪影重合 → 去垂带、棍加深色并加握纹。
- **UNVERIFIED**：盲测人工辨识、真机、实战对局帧（收官统一补）。

## 交付（9）

- 改动：新增 `bagun.ts`；修改 `characters/index.ts`（工厂 stick 暴露）、`client/char-harness.html`（stick 参数 + 标注）、`scripts/char-shots.ts`（stick 帧）、`tests/ui/gojo-lifecycle.test.ts`、`tests/ui/character-assets.test.ts`。
- 未提交、未部署（等待用户授权）。

**实战对局证据（2026-11-21 补）**：隔离服务（PORT=3277，CLIENT_DIST=新构建）AI 对局观察到 \`bagun-v1\` 正确挂载与入场/行走/受击演出，帧归档 \`docs/screenshots-characters/2026-11-21-realmatch/\`，无页面 JS 报错。
