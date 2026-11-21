# 测试规范

| 层级 | 必验 | 证据上限 |
|---|---|---|
| 类型与构建 | 客户端/服务端 `tsc --noEmit`；按影响单独构建再跑全量 | 类型与包的检查不能证明 GPU 渲染。 |
| 单元 | [资产专项](../../tests/ui/gojo-asset.test.ts)：模型尺寸/可见网格矩阵、姿态复位、材质隔离、通用回退 | 对象和变换，不是像素或人眼判断。 |
| 集成 | [生命周期专项](../../tests/ui/gojo-lifecycle.test.ts)：同步快照、换房换角、离场重入、材质复位、余命与淘汰、迟到命令及释放；共享契约变动加队列/adapter 回归 | jsdom 里的场景替身与 Three 对象 `dispose` 事件，不是 GPU 泄漏检查。 |
| E2E | [浏览器套件](../../tests/ui/e2e.test.ts) 保留通用玩法断言；[角色真实对局脚本](../../scripts/v50b-match.ts) 对照权威日志、真实画布、换房、重开、2D | 两者分别运行，不能以泛用 E2E 通过代替角色在 3D 可见。 |
| 视觉 | 原帧 + 整页 + 同 PID 日志及称述的环境，按 [视觉 QA](VISUAL_QA_SPEC.md) 封板 | 视口模拟不是真机，像素采样不是玩家辨识。 |

## 隔离执行

命令分两档。**任务书是执行白名单**：只跑明确列出的档位与命令；没有安装授权就不安装，现有依赖缺失或不匹配时停止运行并回报。新建授权的忽略目录，复制当前在用的 `client`、`server`、`shared` 源及配置、`tests`、`scripts`、根 package/lock/TS/Vitest 配置（含未提交文件）；排除旧 `dist*`、截图和缓存。安装未获授权时，复用经锁文件路径及版本核验的本地依赖副本。Windows Git Bash 将 `TMP`、`TEMP`、`TMPDIR` 与 `npm_config_cache` 指向隔离目录中的可写绝对路径，保留仓库的 `allowScripts` 配置。

### 专项执行

从隔离源码根运行任务书指定的用例；五条悟示例的唯一专项命令如下：

```sh
npm test -- tests/ui/gojo-asset.test.ts tests/ui/gojo-lifecycle.test.ts
```

### 合并前全量验证

全量验证、类型检查和构建应由主 Agent 或获明确授权的验证 Agent 执行。全量已包含专项，不需再跑一次来增加计数；独立交接或验证特定修复时另计为专项运行。

```sh
node node_modules/typescript/bin/tsc --noEmit -p client/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p server/tsconfig.json
npm run build
npm test
```

全量测试在副本中运行，因 `e2e.test.ts` 的 `beforeAll` 自行 Vite 构建并清空**测试文件所在副本**的 `client/dist-e2e`，随后覆盖 `CLIENT_DIST`。只在仓库设置环境变量不会隔离这次写入。测试前后比较原产物清单、哈希和修改时间；不碰部署、默认开发服务或产物。

角色对局：确认独立空闲 URL（五条悟原验收使用 3251），由自己的隔离客户端产物和服务端产物提供服务，显式传 `CLIENT_DIST`。从隔离副本执行 `node node_modules/tsx/dist/cli.mjs scripts/v50b-match.ts http://127.0.0.1:<PORT>`（替换端口）。脚本按时间在其源码副本下写 `docs/screenshots-v50b/`，不指向原归档，不能依赖其默认 URL。记录通过/失败/跳过、运行环境、命令、源码身份与结果路径；失败不要降断言，保留复现并补修。
