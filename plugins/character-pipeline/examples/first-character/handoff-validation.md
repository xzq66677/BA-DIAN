# GJ-QA-01 · 独立交接验证

本记录验证任务书能否独立执行。角色是否能实际游玩另见[实战报告](../../../../docs/V5.0-B.md)与[角色 QA](character-qa.md)。两轮接单由不同 Agent 完成，以仓库文档和当时工作区为输入，不需要原开发对话。第二轮新建副本，未复用首轮的源码副本或测试结论。

| 阶段 | 实际结果 | 本地记录（忽略目录，不依赖其存在才可复跑） |
|---|---|---|
| 候选稿试跑 | 资产 21/21、生命周期 6/6；退出 0，Vitest 1.60 s。原 78 个产物文件清单、SHA-256、mtime 与 Git 状态未变。归档日志、探针、PNG 解码及同 PID 五态核对通过。 | `.tmp-build/pipeline-agent-trial/`：`specialized.log`、`source.copy.json`、`protection.txt`、`archive-match.txt`、`archive-png.txt` |
| 修订版独立复测 | 两个文件 27/27，0 失败、0 跳过，退出 0；Vitest 2.17 s、墙钟 8 s。原产物及 Git 状态比对一致。归档 17 个 PNG 的实际解码、非空像素与尺寸核对通过；`match.json` 含 128 条日志、两局共 12 回合、0 页面异常。 | `.tmp-build/pipeline-agent-retest/logs/`：`gojo-special-test.log`、`gojo-special-test-meta.txt`、`artifact-compare.txt`、`archive-png-decode.txt`、`final-close.txt` |

两轮均在 Windows x64/Git Bash、Node 24.22.1、npm 11.19.0、Vitest 2.1.9 上独立复制 `649d2e18cf6aa1c887df41571ba07a26e27663d6` 所在工作区的当前源码（含未提交项）及锁定本地依赖。从各自的 `work/` 只执行 `npm test -- tests/ui/gojo-asset.test.ts tests/ui/gojo-lifecycle.test.ts`。三个受保护目录是 `client/dist`、`client/dist-e2e`、`server/dist`（25 / 25 / 28 文件）。无安装、公共服务操作、构建或全量执行；生命周期测试的 `THREE.Clock` 弃用告警不构成失败。

## 发现、修订和复测

| 首轮观察 | 主 Agent 修订 | 复测结论 |
|---|---|---|
| 规范把专项、类型检查、构建、全量连在一起，且给出可安装依赖选项；接单者要自行推导任务授权。 | [测试规范](../../TESTING_SPEC.md)分专项/全量；[任务书](character-task.md)明列唯一命令、复制排除项、依赖核对、缓存及忽略目录白名单。 | VERIFIED：可独立识别并执行唯一命令，未安装依赖。UNVERIFIED：依赖缺失分支只核查了文字，未故障注入。 |
| 基线和动作证据可被重复记录；报告文字不是第二份运行证据。 | 开工与收尾各记录一次状态，两项专项合跑一次；[任务模板](../../templates/character-task.md)只要求列一次命令和各自验收输出。 | VERIFIED：一次合跑和前后比对即可交付；全量回归另计。 |
| 看不到图像时仍可核对归档；以日志回合对齐不等于逐帧绑定 seq。 | [视觉 QA](../../VISUAL_QA_SPEC.md)把归档核证与目视分开，任务书要求明确关联层级。 | VERIFIED（结构和回合关联）：`L8VS` 的 `P2-eags` 五态、同房重开、第二局 2D 均可核对。UNVERIFIED：人工目视、帧与 seq 的直接绑定。 |

**V1.0 的验证上限**：同一已实现程序化角色的专项交接可重复执行。不是独立 Agent 从零开发角色、外部 GLB/骨骼入库、真机或所有 Agent 环境的验证。可委派专项执行、清单/哈希与证据对照；资产许可、共享接口、异常是否跨范围修复、人工门槛和下一阶段仍由主 Agent 决定。
