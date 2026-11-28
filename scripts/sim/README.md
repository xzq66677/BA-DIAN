# BA-DIAN 离线蒙特卡洛模拟系统 v2

零依赖、离线、可拷贝到学校机房 Windows 电脑运行。60 分钟定时停止。所有对局数据只报实测值。

## 目录结构

```
运行包/
├── node/node.exe         便携 Node.js 22（无需装机）
├── sim/sim.js            主程序（零依赖单文件，内含引擎/AI/模拟器）
├── sim/verify.js         正确性闸门（单文件）
├── sim/replay.js         异常复现工具（单文件）
├── sim/merge.js          跨次合并工具（单文件）
├── 一键启动.bat          启动 → 闸门 → 基准 → 全量 → 报告
└── README.md
```

## 无网装机步骤

1. 把 zip 完整解压到任意目录（路径建议不含中文与空格，如 `D:\badian-sim`）。
2. 双击 `一键启动.bat`。脚本自动按顺序执行：正确性闸门 → 自动基准 → 全量 60 分钟 → 生成报告。
3. 结果写入 `results/`，`report.html` 会自动打开。
4. 没有 Python、没有 npm install、不需要网络。全部依赖已打包。

## 手动运行与参数

```
node\node.exe sim\sim.js --experiment all --duration 3600 --workers 11 --out results
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `--duration` | 3600 | 运行秒数，上限按机房要求 60 分钟 |
| `--workers` | 物理核−1 | 本机 24 逻辑/12 物理 → 默认 11 |
| `--experiment` | all | balance / player-count / tier-compare / mechanics / all / smoke |
| `--seed` | 时间戳 | 基础种子；每局种子 = hash(runId, workerId, gameIndex) |
| `--max-rounds` | 200 | 单局回合上限，超过判 STALL |
| `--map` | floatingRuins | 悬浮遗迹 |
| `--balance-tier` | 4 | 平衡结论只采该档（默认宗师=角色专属策略）；低档仅用于分档对照 |
| `--batch` | 2000 | 上报批次 |
| `--out` | ./sim-out | 输出目录 |
| `--matches` | 0 | 指定总对局数（0 = 按时间跑） |

## 正确性闸门（verify.js）

- 规则参数必须是 `DEFAULT_RULES`（`skillJudgeMode='player'`、`secondJudgeMode='player'`、默认命数）
- 1000 局固定 seed：零 ERROR
- 60 样本同 seed 两次跑：全程日志序列 SHA-256 逐字一致
- 30 样本输入流重放：hash 逐字一致
- 144 个共享 testcase 全过

任一失败即退出码 1，一键脚本会终止，不会进入全量。

## 输出文件（均带 schema 注释）

- `summary.json`：总对局、吞吐、版本 commit+dirty、CPU、种子、CI 汇总、OUTLIER
- `balance.csv`：一行 = 统计单元 × 档位 × 人数，含胜率、95% Wilson CI、低置信标记、平均回合、存活
- `matchups.csv`：一行 = 角色组合 × 人数 × 档位（只取最高档）
- `failures.jsonl`：ERROR / ASSERT / STALL 分类，每行带最小重放载荷（seed + 配置 + tier + 完整输入流）
- `benchmark.json`：运行前单进程吞吐、单局耗时、内存曲线、机器信息
- `experiment-config.json`：全部参数、代码版本、tier 契约
- `report.html`：零依赖静态汇总页

## 异常复现

```
node\node.exe sim\replay.js results\failures.jsonl <seed> --hash
```

输出 `replayOk:true` 且两个 hash 相同即复现成功。

## 跨次合并（亿级 = 多次运行叠加）

```
node\node.exe sim\merge.js <结果目录1> <结果目录2> ... --out merged
```

幂等键为 `runId`，重复合并同一 run 不重复计数。

## 规则边界

- 源码层只 `import` 真实模块（`shared/src/`、`server/src/ai.ts`），零规则代码复制。
- 规则参数、判定、角色机制全部来自引擎；模拟器只驱动 AI 座位，不改任何规则语义。
- 统计埋点只读扫描 `log.data`，不写日志、不改引擎。
- 不涉及 MAP101–105 与任何 3D 渲染代码。

## 资源占用

基准脚本会实测并记录：CPU 型号/逻辑核/物理核、内存、Node 版本、单进程吞吐、单局耗时、内存曲线。实际数字见每次运行的 `benchmark.json`，不在本文档预估。

## 已知限制

- tier 4（宗师）已接入：`config.ts` 映射到 `expert` 档，即 PR #119 交付的角色专属策略注册表（`shared/src/characters/ai-expert.ts`，16 角色各一套打法）；`tier4Ready:true`。
- 单文件包运行时会在输出目录生成一个隐藏 `.worker.cjs` 临时文件（Windows Worker 句柄限制，无法在退出前删除）；多次运行覆盖同一文件，不影响结果，回收目录时一并清理即可。
