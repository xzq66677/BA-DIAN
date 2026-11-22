# AGENTS.md — 给 AI Agent 的工作区须知

任何 AI Agent 在本工作区开始工作前，先读本文件。

## 工作区地图（worktree / 分支）

> 完整可视化：[docs/WORKTREE-MAP.html](docs/WORKTREE-MAP.html)（浏览器打开，交互式树图）
> 以下为 2026-11-22 git 快照的文字版；分支变化后以 `git worktree list` / `git branch -a` 为准。

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

## 常用命令

```bash
npm install          # 安装依赖（Node >= 20，验证用 v24）
npm test             # 约 185 项测试
npm run build        # tsc + vite 构建
npm run dev:server   # 游戏服务 :3100
npm start            # 启动服务（systemd: badian）
```

联机验证在服务器 `neufree`（104.208.72.163:443）：本地 push 后服务器 `git pull`
→ `npm run build` → `sudo systemctl restart badian`。
