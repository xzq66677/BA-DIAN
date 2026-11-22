# 悬浮遗迹任务清单

主开发负责 Phase 0–3。后续任务相互独立，按下列文件边界验收。涉及规则、事件协议或 Camera Director 设计的变更交回主开发。

## 核心交付

| 编号 | 负责人 | 状态 | 验收记录 |
| --- | --- | --- | --- |
| MAP-000 | 主开发 | 完成 | Git 基线、场景与规则审计，保留改造前浏览器证据 |
| MAP-001 | 主开发 | 完成 | ID 锚点、2–20 房间边界、20 个同房泊位和真实移动校验 |
| MAP-002 | 主开发 | 完成 | 房间选择、目标确认、键盘入口、桌面与窄屏 |
| MAP-003 | 主开发 | 完成 | 悬浮遗迹、石桥、主题图腾、环境动效和精简模式 |
| MAP-004 | 主开发 | 完成 | 自动镜头优先级、拖动/缩放、总览、胜者和平局预设 |
| MAP-005 | 主开发 | 完成 | 结构化事件与 HP、房间危险和终局联动，四人及 AI 跑至终局 |

完整命令、实测记录和设备覆盖见 [验收记录](docs/MAP_ACCEPTANCE.md)。

## 后续待领

| 任务 | 负责人 / 状态 | 前置条件 | 可改范围及禁改范围 |
| --- | --- | --- | --- |
| MAP-101 石材与遗迹细化 | 后续 Agent · 待领 | MAP-003 | 可改 `battle3d/ruins.ts`、`battle3d/palette.ts`。锁定布局锚点、场景选取和事件文件 |
| MAP-102 密集名牌与危险标识 | 后续 Agent · 待领 | MAP-002 | 可改 `battle3d/battle3d.css` 与 `scene.ts` 的覆盖层定位段。锁定泊位、规则和调度 |
| MAP-103 精简模式性能采样 | 后续 Agent · 待领 | MAP-003、串行于 MAP-101 | 可改 `battle3d/ruins.ts` 与 `scripts/map-sample.mjs`。锁定角色 rig、镜头及队列 |
| MAP-104 触屏安全区域和缩放 | 后续 Agent · 待领 | MAP-002、串行于 MAP-102 | 可改响应式 `battle3d/battle3d.css` 和独立触控适配。锁定动作提交、镜头优先级和事件协议 |
| MAP-105 自动化边角案例 | 后续 Agent · 待领 | MAP-005 | 可改 `scripts/map-match.ts`、`tests/ui/map-playback.test.ts`。锁定生产代码 |
| MAP-106 第二主题配置样例 | 后续 Agent · 待领 | 首发地图经硬件与人工验收，串行于 MAP-101、MAP-103 | 可新增程序化主题定义和对应素材验收。锁定现有主题、默认入口、引擎、队列和 Camera Director |

### 验收与回滚

- **MAP-101** 提升石面辨识度和遗迹轮廓，角色轮廓优先。运行 `npm run build`、`node scripts/map-sample.mjs`，提交同构图前后截图和绘制次数；用独立主题美术补丁回滚。
- **MAP-102** 在 390 × 844、844 × 390 和 1440 × 900 记录 6 人及 20 人同房的交互情况。运行 `npx vitest run tests/ui/battle3d.test.ts` 和 `npx tsx scripts/map-match.ts`，提交覆盖层截图及键盘选取录像或事件记录；回退覆盖层补丁。
- **MAP-103** 在实测目标设备跑至少两局，比较标准与精简模式的帧耗时、上下文峰值和多局资源计数。运行 `node scripts/map-sample.mjs` 和 `npx tsx scripts/map-match.ts`，附 JSON、硬件和浏览器信息；回退采样或环境表现补丁。
- **MAP-104** 在手机上完成拖拽和双指缩放，并验证弹层、行动坞与可选房间触控。运行 `npm run build` 和 `npx tsx scripts/map-match.ts`，附两种朝向截图和手势录屏；回退触控和 CSS 补丁。
- **MAP-105** 增补实际未命中、同归于尽平局、恢复 WebGL 上下文及 2×/4× 播报的浏览器覆盖。运行 `npx vitest run tests/ui/map-playback.test.ts` 和 `npx tsx scripts/map-match.ts`，附权威日志和展示顺序；撤销新增用例。
- **MAP-106** 在专用演示入口验证同一套 ID、泊位和锚点接口可加载另一主题。运行 `npm run build` 和地图单测，附双主题同机位截图、资源来源和许可；删除本任务的独立主题与演示入口。
