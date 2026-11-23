# V5.0 电影感入口上线说明

## 一句话

未登录访问根路径，现在先看到 V5.0 四段电影感入口（开场竞技场 → 主菜单 → 作战室 → 选角 → 战场交接），选完角色「确认出战」即带入真实房间进入对局；旧的卡桌首页保留为 `?entrance=classic`。

## 三种入口模式

| 访问方式 | 呈现 | 用途 |
|---|---|---|
| `/` | V5.0 电影感入口（默认） | 正式游客态 |
| `/?stage=<id>` | 入口 + 指定地图 | 换图/天气评审，`v6-floating-ruins` / `demo-crystal-arena` / `map006-weather` |
| `/?entrance=classic` | 原卡桌首页（拔典 / 角色卡池 / 房间列表） | 回退入口，也是自动化 E2E 使用的入口 |
| `/?proto=A\|B\|C` | 真实引擎对局的三种视觉架构原型 | 设计探索，不受入口模式影响 |

入口页右上角常驻「经典入口」按钮，等价于 `?entrance=classic`。

## 架构与边界

- **视觉层**：`client/public/entrance/` 是一套自包含 HTML/CSS/Three.js 原型（由 `visual-prototype/prototypes/` 归档资产拷贝而来），用同源 iframe 加载，原型内部代码零改动。
- **桥接层**：`client/src/pages/Entrance.tsx` 在 iframe 加载完成后挂接三个按钮：
  - `createBtn` → 标记「创建房间」意图
  - `joinBtn` → 弹邀请码输入，标记「加入房间」意图
  - `confirmBtn` → 读取 `window.__flow.state().sel`（选中角色 ID），转场后 `postMessage` 给宿主
- **宿主**：`Entrance.tsx` 只接受同源 `message`，调用真实 `net.createRoom` / `net.joinRoom`，成功后交 `App` 的 `enterSession` 进入真实 lobby/game。选中角色 ID 一并传给服务端，因此「选角带入战场」是真实生效的，不是演示。
- **地图机制**：创建房间时选角确认后可选择开启或关闭悬浮遗迹的天气与泥潭，选择随建房请求提交并在真实大厅显示；加入房间沿用房主配置。经典入口也提供同一选项。
- **未触碰**：lobby / game / arena / 协议 / 状态机 / 角色 rig 源码均未改；原型内部的「作战室 9 5 X 4 / 猜拳对手」仍是 Demo 展示数据，真实对局在确认出战后由服务端驱动。

## 为什么用 iframe

原型是独立可运行的 HTML + 1.9MB Three.js bundle，自带渲染循环、相机、角色动画与地图适配层。同源 iframe 让它**原样上线**，不把原型的状态机与 React 应用的状态管理耦合，也不改动已归档资产；宿主只承担「读意图 → 调真实网络接口」这一件事。这样后续地图/造型原型更新，只需替换 `public/entrance/` 资产，不动运行时代码。

## 安全与回退

- 桥接只处理 `origin === location.origin` 的 `message`，忽略其他来源。
- 创建/加入失败（房间码错误、已被占用等）会在入口层显示错误与「切到经典入口」逃生口，不阻断用户回到原流程。
- 昵称沿用 `localStorage.badian-name`，未填时用默认「棋手」。
- 房间被占用时（服务端返回 `activeCode`）提示用户走经典入口回到原房间。

## 验证

- `npm test`：560/560 PASS（33 文件）。
- `scripts/verify-entrance-online.mjs`：12/12 PASS，页面报错 0（需先 `npm run build:client && build:server` 并启动服务，`PLAYWRIGHT_URL` 可覆盖默认地址）。
- E2E 5 处首页用例改用 `?entrance=classic`，保持原卡桌测试语义。
