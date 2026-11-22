# 贡献指南 / Contributing

BA-DIAN 是多 Agent 协作项目。为避免多个 Agent / 成员重复开发同一个任务，
仓库启用 **“先认领，后开发”** 机制。所有代码改动必须遵守以下流程。

---

## 一、认领任务（必须最先做）

每个任务对应一个 GitHub Issue。动手写代码前，**必须先认领**：

1. 在 Issue 右侧 **Assignees** 里把自己（或你的 Agent 账号）设为负责人。
   - 一旦有 Assignee，其他 Agent 看到后应跳过该 Issue。
2. 把标签从 `status: ready` 改为 `status: in-progress`。
   - 这两个动作合起来就是一次明确的“认领宣言”。
3. **禁止**在未认领（无 Assignee）或他人名下的 Issue 上直接提交 PR。

> 多 Agent 场景下，把 Assignee 当作“分布式锁”：
> Agent 启动任务前先检查 Assignee 字段，已被认领则直接跳过。

---

## 二、状态标签体系

| 标签 | 含义 | 何时使用 |
|---|---|---|
| `status: ready` | 可认领 | 任务已拆解、尚无人负责 |
| `status: in-progress` | 进行中 | 已设置 Assignee，正在开发 |
| `status: review` | 待审核 | 代码已提交 PR，等待合并 |
| `status: blocked` | 被阻塞 | 依赖未满足 / 需要决策 |
| `status: done` | 已完成 | 合并 PR 后关闭 Issue |
| `type: bug` | 缺陷 | 修复类任务 |
| `type: feature` | 新功能 | 新增能力 |
| `type: test` | 测试 | 测试/验证类任务 |
| `priority: p0` | 最高优先级 | 阻塞发布的问题 |
| `priority: p1` | 高优先级 | 本迭代必须完成 |
| `agent` | Agent 可承接 | 适合自动化 Agent 处理的任务 |

---

## 三、开发流程

```text
status: ready（无 Assignee）
   │  ← 设 Assignee + 改标签 = 认领
   ▼
status: in-progress（开发 + 本地测试）
   │  ← 提交 PR，关联 Issue（"Closes #N"）
   ▼
status: review（等待审核）
   │  ← 合并 PR
   ▼
status: done（关闭 Issue）
```

### 分支命名

```text
feature/<issue-number>-<short-desc>   # 新功能
fix/<issue-number>-<short-desc>       # 缺陷修复
test/<issue-number>-<short-desc>      # 测试
```

### PR 要求

- PR 描述里必须写 `Closes #<Issue 编号>`，合并后自动关闭对应 Issue。
- PR 关联一个 Issue；一个 Issue 对应一个 PR，避免交叉。
- 合并前确保 `npm test` 通过（当前 488 项测试）。

---

## 四、Projects 看板（可视化认领）

仓库建议启用 Projects 看板，设置三列：

- **📥 可认领**：`status: ready` 的 Issue
- **🔄 进行中**：`status: in-progress` 的 Issue
- **✅ 已完成**：`status: done` / 已关闭的 Issue

认领 = 把 Issue 从“可认领”拖到“进行中”。队友在看板上一目了然。

> 首次建看板的手动步骤见 `.github/PROJECT_SETUP.md`。

---

## 五、分支保护（仓库所有者配置）

在 `Settings → Branches → Branch protection rules` 对 `main` 启用：

- Require a pull request before merging（禁止直接 push 到 main）
- Require status checks to pass（要求 CI 通过）
- Require branches to be up to date before merging

这样从流程上强制“先认领、再 PR、后合并”。

---

## 六、任务来源

任务总表在本地 `TASKS.md`，Issue 从其中的 TODO / IN_PROGRESS 项生成。
新任务请先在 `TASKS.md` 登记，再创建 Issue，保持双向可追溯。

战场角色 3D 开发请使用 `plugins/character-pipeline/`（ZCode 插件"角色开发流水线"）：先读其 README 与九步工作流，再按阶段规范和任务书执行；协助者边界见其中 AI Agent 指南。

初始化标签和 Issue：在仓库 **Actions → Initialize Governance** 手动触发一次即可。
