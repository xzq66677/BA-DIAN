# BA-DIAN 入口视觉原型（可复用地图适配层）

这是**纯视觉原型资产**，不是运行时游戏代码。它演示 V5.0/V6.0 入口的完整四段流程（开场 → 主菜单 → 大厅 → 选角 → 战场/猜拳），复用项目原生 Three.js 低模角色，并把「地图相关的一切」收敛到可替换的适配层，使后续地图（含天气系统）改动时原型主体无需改一字。

## 为什么在这里

- 入口视觉、角色造型、地图适配属于**视觉原型**范畴，与主仓库的运行时规则/战场 Scene/WebGL 生命周期解耦。
- 放在 `visual-prototype/` 下，不参与客户端构建，不影响线上版本；需要时以 `?stage=<id>` 打开评审。
- 角色身份、席位、准备态、猜拳结果均为 **Demo 示例数据**，不代表真实接口字段或联机协议。

## 本地打开

直接用浏览器打开（需支持 WebGL）：

```
visual-prototype/prototypes/v5-entrance.html
```

切换地图用 URL 参数：

```
v5-entrance.html?stage=v6-floating-ruins   # 默认，V6 悬浮遗迹
v5-entrance.html?stage=demo-crystal-arena   # 换图验证样例
v5-entrance.html?stage=map006-weather       # MAP-006 天气版
```

自动化接口 `window.__flow`（`skip/create/ready/toSelect/select/rotate/confirm/reselect/punch/setWeather/state`）用于演示录制与回归验证。造型评审页：`prototypes/v5-character-design.html`（三名样板三视图旧/新对照、收棍/拔棍两态、全角色总览）。

回归脚本在 `scripts/`：`verify-stage-adapter.mjs`（换图/机位）、`verify-weather-stage.mjs`（天气四态/泥潭/回归）。脚本从仓库根加载 playwright；若工作树无 `node_modules`，用环境变量指定依赖位置，例如 `PLAYWRIGHT_URL=file:///D:/AI工作区/badian-game/node_modules/playwright/index.mjs node scripts/verify-weather-stage.mjs`。

## 目录结构

```
visual-prototype/
├── README.md                 本说明
├── prototypes/
│   ├── v5-entrance.html      四段入口原型（主文件）
│   ├── v5-character-design.html  造型评审页
│   ├── stage-adapter.js      地图适配层（核心，见 docs/地图适配指南.md）
│   ├── hair-style-kit.js     低模发型增强层（独立原型版）
│   ├── menu-bundle.js        打包的角色 rig + Three.js（window.BA）
│   ├── entrance.css / menu.css
├── assets/
│   ├── logo-*.svg / emblem-hex.svg
│   └── characters3d/         11 名角色透明底立绘 PNG
├── docs/
│   ├── 地图适配指南.md        接口契约 + 三张地图 + 天气版移植说明
│   └── 角色造型标准.md        三名样板锚点 + 全角色推广规则
└── screenshots/              验收取证（三视图、换图对照、天气四态、泥潭两态）
```

## 三张地图

| id | floorY | 形态 | 用途 |
|---|---|---|---|
| `v6-floating-ruins` | 1.22 | 六棱石台 + 栈桥 + 暖金齿轮纹 | 默认，对齐线上 V6 |
| `demo-crystal-arena` | 0.8 | 四方晶格台 + 青绿冷调 | 证明「换地图不改原型主体」 |
| `map006-weather` | 1.22 | 复用 V6 几何 + 四态天气 + 泥潭预警 | 证明「地图新增动态系统不改原型主体」 |

三图均跑通完整四段流程，页面报错 0。换图后机位/落地/几何/灯光/天气全随适配器切换，原型主体未改一字。

## 边界

- 原型内天气/发型/几何是独立自洽实现，用于接口验证与视觉评审；线上以 `client/src/battle3d/ruins-weather.ts` 与角色 rig 源码为准。详见 `docs/地图适配指南.md` 的线上契约对照表。
- 不提供可编辑 3D 工程、骨骼文件或引擎侧 UI 组件配置。
- 录制视频/截图是连续演示与取证，不是可剪辑工程。
