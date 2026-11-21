---
name: character-pipeline
description: BA-DIAN 3D 战场角色开发流水线。为现有 Three.js 战场新增或升级单个角色的 3D 视觉（规格、资产、标准化、接入、动画、事件、测试、视觉验收、交付）时使用；接单/协助 Agent 也按本技能与任务书执行角色专项工作。不适用于批量改造角色或修改游戏规则。
---

# Character Development Pipeline · V1.0

适用范围：BA-DIAN 现有 Three.js 战场中的单角色程序化视觉升级。规范中的 `client/`、`tests/`、`docs/` 等相对路径以 BA-DIAN 仓库根为基准。

## 执行顺序

1. 读 [README](../../README.md)：版本、适用路线、证据标签（VERIFIED / UNVERIFIED / DEPRECATED）、审计与实现的关系。
2. 读[九步工作流](../../WORKFLOW.md)：需求分析 → 资产准备 → 模型标准化 → 战场接入 → 动画绑定 → 事件接入 → 测试 → 视觉验收与迭代 → 交付归档；注意每步的失效条件与主 Agent 决策项。
3. 按当前任务读对应阶段规范，不必全读：[资产](../../CHARACTER_ASSET_SPEC.md) · [集成](../../CHARACTER_INTEGRATION_SPEC.md) · [动画](../../ANIMATION_SPEC.md) · [事件](../../EVENT_BINDING_SPEC.md) · [测试](../../TESTING_SPEC.md) · [视觉 QA](../../VISUAL_QA_SPEC.md)。
4. 接单/协助 Agent 先读 [AI Agent 指南](../../AI_AGENT_GUIDE.md)（十步协议），再读填写后的任务书；任务与边界冲突时记录并交主 Agent。
5. 模板：[角色规格](../../templates/character-spec.md) · [Agent 任务书](../../templates/character-task.md) · [QA](../../templates/character-qa.md) · [交付报告](../../templates/character-report.md)。
6. 五条悟实战样例（`examples/first-character/`）：[角色规格](../../examples/first-character/character-spec.md) · [QA](../../examples/first-character/character-qa.md) · [修订版任务书](../../examples/first-character/character-task.md) · [交接验证](../../examples/first-character/handoff-validation.md)。

## 硬约束

- 不改变游戏规则、角色数值、伤害结算、胜负判定与事件顺序；动画播放失败不阻塞游戏结算。
- 一次只做一个代表性角色；未经审查的资源不进入正式角色目录。
- 证据必须标注实际验证层级；"代码能跑"不等于视觉验收，测试跳过不是通过。
- 未经用户明确授权不提交、推送、部署；保留工作区既有未提交内容。

## 协作边界

主 Agent 决定角色与范围、资产许可能否接受、共享接口、修复边界、验收门槛与是否结束迭代。可委派协助 Agent：素材核验、格式/命名/清单检查、角色级配置与动作映射、局部接入、专项测试、原始截图、日志对照与报告。人工辨识与真机结果只能由实际观察补齐。
