# 老大爷 · laodaye-v1 · 角色记录

按 plugins/character-pipeline 九步工作流执行。基线 `e4cef57`（V5.0-B 后）。2026-11-21。

## 1. 需求分析（规格）

- **charId**：`laodaye`（shared/src/characters/index.ts）。能力：近3远2；领域展开（平局回合可行动，不改变平局结果）、领域强化（近5远3）；领域全场唯一，与五条悟互相覆盖（后展开者生效，被覆盖后可再展开）。
- **必需动作**：idle / walk / attackSwing（近战）/ cast（领域展开、强化走 skillAura+cast）/ flinch / dead / reviveRise（血量3无复生，但接口保留）/ drink / crouch / cheer。
- **剪影信号**：宽檐斗笠 + 长白须 + 佝偻背 + 褐色宽袖短褂；领域系微光玉坠（cast 脉冲）。
- **非目标**：不改领域规则表现（穹顶/光柱是场景层）；不做强化专属姿态（走 cast + 玉坠脉冲）。
- **基线**：legacy Humanoid（palette：褐 0x6b5540 / 米 0xd8cbb0 / 斗笠 / scale 1）。

## 2-3. 资产与标准化

- 程序化源：`client/src/battle3d/characters/laodaye.ts`（无外部文件/纹理/加载依赖，原创几何拼装）。
- 共享骨架套件：`client/src/battle3d/characters/kit.ts`（Surface 烘焙原语与 gojo.ts 同款；gojo.ts 未改动）。关节帧 pelvis→body→head + 肩/肘/髋/膝；+Y 上、+Z 面向桌心、脚底 y=0。
- 测量：站姿 bbox 高 1.512（含斗笠）、headHeight() 1.512×scale；reset 脚底 min.y=0.023；palette scale=1 由场景再乘 1.4。

## 4-6. 接入 / 动画 / 事件

- 注册 `characters/index.ts` models：`laodaye → laodaye-v1`；工厂契约 `{ id, rig, stick: null, dispose }`。导出 `DEDICATED_CHAR_IDS` 供测试收窄 legacy 断言。
- 事件绑定无需新增：领域展开/强化经既有 adapter → playAction('skill')/playDomain（场景级 FX+cast 姿态）；受击/淘汰/复活走既有 playHit/playIvan 等队列。无角色专属字段。

## 7. 测试（VERIFIED，本机 node v24 / vitest 2.1.9）

- `npx vitest run tests/ui/character-assets.test.ts tests/ui/gojo-asset.test.ts` → 35 passed。
  覆盖：工厂 ID/缩放/脚底不穿不漂、11 姿态动网格+实例隔离+复位幂等、几何/材质实例独占、dispose 幂等释放。
- `npx vitest run tests/ui/gojo-lifecycle.test.ts` → 8 passed。核心生命周期参数化到 gojo+laodaye：攻击/换房/回 idle、受击闪白/隐藏/死亡淡出/复活材质恢复、释放与重入。
- 全量 `npm test`、tsc、build 在收官阶段统一跑（见交付报告）。

## 8. 视觉验收

- 取证：`npx tsx scripts/char-shots.ts laodaye`（char-harness 隔离渲染，真实 WebGL，36 原始帧 + 窄屏 2 帧 + gojo 同屏 lineup）。归档 `docs/screenshots-characters/2026-11-21-laodaye/`。
- 迭代记录（问题→修正→同条件复测）：
  1. 倒地/复活/蹲姿脚底穿台（kit 姿态量是从 gojo 硬尺寸抄的）→ kit dead 下沉量改按 `hipY-0.2` 比例、crouch 屈膝加深+下沉按髋高缩放、flinch 减小下沉 → 复测 min.y：reset 0.023 / crouch 0.037 / dead 0.041 / flinch -0.006 / walk 0.086。
  2. 斗笠悬空+锥底与檐口间环形缺口俯视可见头顶 → headTop 降至 0.13、锥底加宽与檐口同径 → 复测帽体贴合无透头。
  3. 比对 gojo 同屏偏矮偏瘦 → hipY .58→.635、躯干/四肢截面放宽 → 复测站高 1.512（gojo 含发 1.798），体型相称。
- 已知瞬态：reviveRise 中段（t≈0.25-0.5）腿部弧线最低约 -0.12，为 gojo-v1 同款公式（其原版参数同位置约 -0.2）的已验收瞬态，终帧 ≥0.041；如需零穿地需重设计倒地路径，未列入本任务。
- **UNVERIFIED**：无名牌盲测人工辨识（无第二名观察者）；真机/触屏/五六房密集同屏；默认机位实战对局帧（收官阶段用 v50b-match 补）。

## 9. 交付

- 改动：新增 `kit.ts`、`laodaye.ts`、`tests/ui/character-assets.test.ts`、`scripts/char-shots.ts`、`client/char-harness.html`；修改 `characters/index.ts`、`tests/ui/gojo-asset.test.ts`、`tests/ui/gojo-lifecycle.test.ts`。
- 双状态：代码+单测+隔离渲染 VERIFIED；人工辨识/真机/实战对局帧 UNVERIFIED（见上）。
- 未提交、未部署（等待用户授权）。

**实战对局证据（2026-11-21 补）**：隔离服务（PORT=3277，CLIENT_DIST=新构建）AI 对局观察到 \`laodaye-v1\` 正确挂载与入场/行走/受击演出，帧归档 \`docs/screenshots-characters/2026-11-21-realmatch/\`，无页面 JS 报错。
