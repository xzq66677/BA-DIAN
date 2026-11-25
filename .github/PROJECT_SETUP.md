# Projects 看板与分支保护：一次性手动设置

标签和初始 Issue 由 GitHub Actions 自动创建（见 `workflows/init-governance.yml`）。
以下两项需要仓库所有者在网页上手动设置一次（GitHub 不提供纯文本的声明式配置）。

## 一、创建 Projects 看板（约 2 分钟）

1. 打开仓库 → 顶部 **Projects** 标签 → **New project**
2. 选 **Board** 模板，命名 `BA-DIAN 任务看板`
3. 建三列（可删掉默认列）：
   - `📥 可认领` — 筛选 `label:"status: ready"`
   - `🔄 进行中` — 筛选 `label:"status: in-progress"`
   - `✅ 已完成` — 筛选 `label:"status: done"` 或直接看已关闭 Issue
4. 勾选 **Auto-add issues**（自动把符合筛选的 Issue 加入对应列）

完成后，认领 = 设 Assignee + 改标签，Issue 会自动流到“进行中”列。

## 二、开启分支保护（保护 main）

1. 仓库 → **Settings** → 左侧 **Branches**
2. **Add branch protection rule**，分支名填 `main`
3. 勾选：
   - ✅ Require a pull request before merging
   - ✅ Require status checks to pass，勾选 Test and build、Browser E2E（工作流首次运行后可选）
   - ✅ Require branches to be up to date before merging
   - ✅ Do not allow bypassing the above settings
4. **Create**

这样所有改动必须走 PR，配合 Issue 认领规则，从流程上杜绝重复开发和直接推送。

## 三、初始化步骤总结

```text
1. push 本仓库（含 .github/ 目录）
2. Actions → Initialize Governance → Run workflow  → 自动建好标签 + 初始 Issue
3. 按上面步骤手动建 Projects 看板 + 开分支保护
4. 之后每个任务：先认领（Assignee + status: in-progress）再开发
```
