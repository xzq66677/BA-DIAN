# AGENTS.md — 给 AI Agent 的工作区须知

任何 AI Agent 在本工作区开始工作前，先读本文件。

## 工作区地图（worktree / 分支）

> **实时地图（推荐）**：[docs/WORKTREE-LIVE.html](docs/WORKTREE-LIVE.html) — 打开即自动拉 GitHub API，
> 实时显示远程分支、开放 PR、Issue 认领状态（无需 token，需联网）。
> 静态快照：[docs/WORKTREE-MAP.html](docs/WORKTREE-MAP.html) — 2026-11-22 交互式树图。
> 以下为 worktree 的文字版；以 `git worktree list` / `git branch -a` 实测为准。

### 活动 worktree（3 个）

| Worktree | 路径 | 分支 / HEAD | 任务 |
|---|---|---|---|
| 主工作区 | `D:\AI工作区\badian-game` | `feat/v6-hair-style` @ b358f356 | V6 全员低模发型增强层 |
| 75a3 | `E:\zcode resource\.zcode\worktrees\75a3\badian-game` | `release/v6-map` @ 5190307 | V6 悬浮遗迹大版本 |
| a926 | `E:\zcode resource\.zcode\worktrees\a926\badian-game` | detached @ 89360e2 | V3.0 基线检查点 |

### 本地分支（12）

`main`（主干/治理）、`feat/v6-hair-style`、`release/v6-map`、
`feat/3d-battlefield-v4.2`（3D 战场）、`feat/bottom-chat-dock`（局内发言）、
MAP 链：`feat/map101-stone-refinement`、`feat/map102-labels-danger`、
`feat/map103-perf-sampling`、`feat/map105-edge-tests`、`feat/v5-floating-ruins`、
`codex/v5-map-original-work`，以及 `docs/map-task-status`。

### 远程分支（origin）

`main`、`governance-setup`（认领机制 PR）、
`fix/MMR12345-ivan-girl`、`feat/MMR12345-tie-round`。

## 认领规则（防重复，必须遵守）

1. **动手前**：把 Issue 的 Assignee 设为自己，并把标签改成 `status: in-progress`。
2. 已有 Assignee 的 Issue **不要重复开发**。
3. 看板卡片拖到「进行中」列（Projects v2 的 Status 字段）。
4. PR 描述写 `Closes #<Issue 编号>`；分支命名 `feature|fix|test/<issue>-<desc>`。
5. 合并前 `npm test` 必须通过。

详见 `CONTRIBUTING.md` 和 `.github/PROJECT_SETUP.md`。

## 3D 代码的重要事实（避免误判）

`client/src/battle3d/`（scene.ts / rig.ts / fx.ts 等）与 `client/src/proto/`
的 3D 代码**真实存在且已提交到 git**（commit `eaec5f9`）。
不要用 `git ls-files` 来判断 3D 是否存在于早期快照——直接读文件系统。
基于现有 3D 代码继续开发，**不要从 V3.0 基线重做**。

## 角色公开状态与后续负面状态接口

状态展示按“引擎数据 → 公开快照 → 状态读取器 → 通用 UI”分层，后续新增燃烧、中毒、减速等状态时不要修改血条或弹窗组件：

- `shared/src/types.ts`：定义权威运行时状态与公开状态类型。持续效果必须包含生效、回合推进、到期/移除、死亡清理的生命周期，不能只存展示字段。
- `shared/src/snapshot.ts`：只序列化公开状态。推荐使用 `PlayerState.effects?: PublicStatusEffect[]`，公开字段限 `kind`、`severity`、`remainingRounds`、`stacks` 和必要的公开来源；`pendingThrows`、判定历史、内部钩子与未公开目标不得进入快照。
- `client/src/battle/status-types.ts`：统一 `PlayerStatusItem`、`PlayerStatusReader` 与数值格式；读取器是后续状态的唯一扩展接口。
- `client/src/battle/status-readers.ts`：维护公开状态白名单与 `PLAYER_STATUS_READERS`。每个读取器返回稳定且全局唯一的 `key`，并明确 `tone`、`value`、`detail`；不得遍历或直接渲染 `char` 的未知字段。
- `client/src/battle/player-status.tsx`：只负责 2D/3D 共用展示、弹窗与无障碍交互，不允许按具体状态名写分支。

新增负面状态的完成标准：

1. 在共享类型与引擎中实现权威效果及结算测试，在 `snapshot.ts` 增加最小公开投影。
2. 在 `status-readers.ts` 新增读取器并注册到 `PLAYER_STATUS_READERS`；已有 UI 无需改动。
3. 补充读取器测试，覆盖生效、层数/剩余回合、到期、淘汰清理和私有字段不泄漏。
4. 运行 `npm test` 与 `npm run build`；只有交互层级变化时才需要追加 Chromium E2E。

## 功能扩展性通用要求

新增功能必须保留后续接入能力，不能把当前角色、状态、地图、道具或规则枚举写死：优先使用共享类型、数据配置、注册表、策略或适配器扩展；公共引擎与 UI 主流程不得堆叠具体业务名称分支。新增内容应能以最小改动注册/配置后生效，并补充对应扩展点测试；未知或旧版本数据必须安全降级，不得导致对局或页面崩溃。

## 演出节奏与 AI 策略扩展点

- `client/src/battle/pace-policy.ts`：演出档位由座位组成策略计算（真人/本机 + AI 混合局默认慢速），`resolvePresentationPace(seats, search)` 是唯一入口。新增座位类型或节奏策略在此扩展，不要在页面组件里写死档位；显式 `?pace=` 保留调试覆盖；`QueueState.pace` 对外可观测（`.battlefield` 的 `data-pace`）。
- `server/src/ai.ts`：AI 决策返回按优先级排列的候选链，`Room.kickAI` 依次尝试直到引擎接受（最差跳过）。新增行动/状态时扩展候选链与 `seekTargets` / `shouldSeekHidden` 判定；角色特化走 `shared/src/characters/ai-strategies.ts` 的 `aiStrategy` 钩子，不要在通用策略里堆角色名分支。
- 后续新增「躲藏类」负面状态（隐身变体等）时：先在规则层定义能否被「找出来」解除，再同步 `seekTargets` 过滤与三档难度测试，避免 AI 对不可解除目标浪费行动。

## 常用命令

```bash
npm install          # 安装依赖（Node >= 20，验证用 v24）
npm test             # 615 项测试（含真实 Chromium E2E）
npm run build        # tsc + vite 构建
npm run dev:server   # 游戏服务 :3100
npm start            # 启动服务（systemd: badian）
```

联机验证在服务器 `neufree`（104.208.72.163:443）：本地 push 后服务器 `git pull`
→ `npm run build` → `sudo systemctl restart badian`。
