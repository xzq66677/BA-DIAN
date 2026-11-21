# Agent 任务书 · GJ-QA-01 · 修订版

只复核五条悟资产、生命周期和已归档的实际对局。按 README → AI_AGENT_GUIDE → 资产/集成/测试/视觉规范 → 本任务书的顺序读入；以当前工作区（含未提交源）和本目录角色规格为输入。

- 允许读取项目源、测试、归档和文档；本次复测只可写新的忽略目录 `.tmp-build/pipeline-agent-retest/`。其中 `work/` 为隔离副本，`tmp/` 和 `npm-cache/` 存临时数据。禁止改源、规范、已有归档或产物、安装依赖、操作服务、提交/推送/部署。不得写回首轮的 `.tmp-build/pipeline-agent-trial/`。
- 按[隔离规范](../../TESTING_SPEC.md#隔离执行)复制当前源码，包含未提交文件，排除 `dist*`、截图和旧缓存。把核验路径及版本均符合锁文件的本地依赖复制进 `work/`；缺包或不匹配时停测试、记录缺项，可以继续归档核验。将 `TMP`、`TEMP`、`TMPDIR`、`npm_config_cache` 分别设为白名单内对应绝对路径。测试前后各记录一次 HEAD、Git 状态与原 `client/dist`、`client/dist-e2e`、`server/dist` 文件清单、SHA-256 和修改时间。
- 从 `work/` 只执行 `npm test -- tests/ui/gojo-asset.test.ts tests/ui/gojo-lifecycle.test.ts`。验收：资产 21、生命周期 6，全通过，记录环境、退出码、耗时和日志。不跑类型检查、构建、全量、浏览器或服务。
- 查 [最终对局](../../../../docs/screenshots-v50b/2026-11-21T14-47-11-623Z/match.json) 与[实战报告](../../../../docs/V5.0-B.md)。列同一 PID 五态在同局/回合关联的日志、探针和原帧，另核对同房重开和第二局 2D。只用已有 PNG；能核验解码与尺寸但看不到原图时，分开标为“归档核证 VERIFIED / 人工目视 UNVERIFIED”。不重抓，不把回合关联当逐帧 seq 绑定，不把归档核证称作盲测。
- 回传一份结果：实际执行和原产物比对、历史证据及其上限、未覆盖、仍需主 Agent 的决定。无须再按动画说明重复列证据。若权限或输入不足，记录并停止受影响步骤。
