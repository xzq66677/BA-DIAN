# BA-DIAN · Character Development Pipeline

> V1.0。适用范围：现有 Three.js 战场中的单角色程序化视觉升级。已验证五条悟专项交接，未验证从零开发新角色的独立全流程。

## 协作者安装（ZCode 插件）

本目录同时是 ZCode 插件源码。在 ZCode 的"插件市场 → 添加 → 添加插件市场"粘贴本仓库的 `plugins/` 目录（内含 `marketplace.json`），添加后在"个人 → badian-plugins"找到"角色开发流水线 / character-pipeline"安装；安装后新建任务，在技能选择器中启用该技能即可按流程协助角色开发。仓库内协作者也可以直接阅读本目录文档。

从 [九步工作流](WORKFLOW.md) 进入。接单 Agent 先读 [AI Agent 指南](AI_AGENT_GUIDE.md)，再读任务指定的规范及任务书；不要从审计建议或代码注释自行扩大范围。

| 要做的事 | 对应规范 |
|---|---|
| 准备、核验、标准化资产 | [资产](CHARACTER_ASSET_SPEC.md) |
| 接入房间、镜头和资源生命周期 | [集成](CHARACTER_INTEGRATION_SPEC.md) |
| 绑定姿态、播放时钟与打断 | [动画](ANIMATION_SPEC.md)、[事件](EVENT_BINDING_SPEC.md) |
| 隔离运行和视觉验收 | [测试](TESTING_SPEC.md)、[视觉 QA](VISUAL_QA_SPEC.md) |
| 分配任务、记录验收与交付 | [角色规格](templates/character-spec.md)、[Agent 任务](templates/character-task.md)、[QA](templates/character-qa.md)、[交付](templates/character-report.md) |

实战样本：[五条悟规格](examples/first-character/character-spec.md)、[角色 QA](examples/first-character/character-qa.md)、[角色实战报告](../../docs/V5.0-B.md)。交接样本：[修订版任务书](examples/first-character/character-task.md)、[首轮问题、修订与独立复测](examples/first-character/handoff-validation.md)。角色能运行与任务书能独立执行是两项不同验收。

## 证据标签

- **VERIFIED**：仅限括号内实际通过的层级，例如源码核对、测试执行、浏览器实战、人工盲测；附命令/文件、环境及样本。源码存在不能替代运行证据。
- **UNVERIFIED**：未跑、失败未解决或证据不足。注明原因、影响和补验办法；测试跳过不是通过。
- **DEPRECATED**：曾有但已被替换的做法，写明替代入口。未实现路线不是过时路线。

## 审计与实现的关系

已查阅仓库外 `BA-DIAN-V5.0-A-audit.md`（2026-11-21，基线 `649d2e18cf6aa1c887df41571ba07a26e27663d6`）。审计建议先用 `ivan-girl` 试点 GLB，再扩展到骨骼和动作。B 阶段实际只实现了程序化 `gojo-v1`；沿用了审计中的实体内替换、旧 rig 回退、原战场/队列和独立资源释放思路。审计中的内存 GLB 冒烟和合成蒙皮克隆不是战场 GLB 验收；异步导入、共享资源、真机性能和角色盲测均不得沿用该结论。审计中的分阶段建议不自动授权开新阶段。
