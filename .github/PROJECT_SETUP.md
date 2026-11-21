# Projects 看板设置（新版 GitHub Projects）

> 适用于 GitHub 当前的 **Projects v2** 界面（左侧有 Fields / Status 的那版）。
> 过期写法：旧版靠"三列 + label 筛选"自动分列——v2 不是那样，请勿照旧版操作。

## 一、看板位置（你截图里的其实是对的）

Projects 可以建在**个人主页**下，也可以建在**仓库**下，两者都能用。
关键是在 **Settings → Default repository** 里关联到 `xzq66677/BA-DIAN`——
这样从该仓库的 Issue/PR 才能方便加入项目。

截图里 `BA-DIAN 任务看板` 的 Default repository 已经是 `xzq66677/BA-DIAN`，
所以这个看板是有效的，不用重建。

其他两个 `@xzq66677's untitled project` 是误点 "New project" 建出来的空项目，
删掉即可：点进去 → 右上 `...` → **Settings** → 最底 **Danger Zone → Delete**。

## 二、核心：Status 字段（不是 label）

新版 Projects 用 **Fields** 管理任务状态，左侧 `Fields → Status` 是内置字段。
看板的列 = Status 字段的取值，不再用 label 来分列。

1. 左侧点 **Status** 字段，确认取值。默认通常是：
   - `Todo`
   - `In Progress`
   - `Done`
2. 点字段值的 `...` 可改名 / 增删。建议改成这套（和 CONTRIBUTING.md 对应）：
   - `📥 可认领`（Todo）
   - `🔄 进行中`（In Progress）
   - `👀 待审核`（可新增）
   - `✅ 已完成`（Done）

## 三、建立 Board 视图

1. 项目顶部 **Views** → 新建视图，类型选 **Board**
2. 分组依据（Group by）选 **Status** 字段
3. 这样每个 Status 值就成一列，拖卡片即可改状态

## 四、筛选视图（可选）

可以再建几个 Table 视图，用 Filter 配置，例如：

- `我的任务`：Filter → Assignee = 当前用户
- `阻塞中`：Filter → Status = Blocked
- `P0`：Filter → 自定义 Priority 字段 = P0

要加自定义字段（如 Priority），点左侧 **Fields** 区域的 `+` 新建。

## 五、把 Issue 加入项目

两种方式：

1. **项目里**：右上角 **Add item** → 选仓库 → 选 Issue
2. **Issue 里**：Issue 右侧 **Projects** 栏 → 选 `BA-DIAN 任务看板`

加入后，把 Status 设为 `📥 可认领`。

## 六、自动化（推荐开启）

项目 **Settings → Automation**（或视图里的自动化），建议打开：

- **Item added to project** → 自动设 Status 为 `Todo`
- **Pull request merged** → 自动设 Status 为 `Done`

这样 PR 合并后卡片自动进"已完成"，不用手动拖。

## 七、label 与 Project Status 的关系

仓库里的 `status: *` label 和项目里的 Status 字段是**两套并行机制**：

| 机制 | 作用范围 | 用途 |
|---|---|---|
| `status: ready` 等 label | 仓库 Issue 列表 / 跨仓库搜索 | 快速筛选、Agent 用 `git`/API 读取 |
| Project Status 字段 | 仅该项目看板 | 可视化拖拽流转 |

**认领动作以 CONTRIBUTING.md 为准**：设 Assignee + 改 label 为 `status: in-progress`。
改完 label 后，再到项目里把卡片 Status 拖到 `🔄 进行中`，两边保持一致。
（若嫌麻烦，可以只用其中一套——但 Agent 读不到 Project 字段，所以 label 那套必须保留。）

## 八、初始化步骤总结

```text
1. 合并治理 PR（CONTRIBUTING.md + 标签 + 模板 + workflow）
2. Actions → Initialize Governance → Run workflow  → 自动建标签 + 初始 Issue
3. 在已有的「BA-DIAN 任务看板」里配好 Status 字段取值 + 建 Board 视图
4. 删掉两个 untitled project
5. 之后每个任务：设 Assignee + 改 status label + 拖 Project 卡片
```
