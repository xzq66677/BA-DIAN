# 拔典 · 部署与更新指南

## 一、自动更新（默认开启，推荐）

服务器上已安装定时器 `badian-autodeploy.timer`：**每 2 分钟**检查 GitHub 仓库 `origin/main`。

- 你把改动推到 `main`（GitHub 网页编辑、本地 push、其他工具推送都可以）
- 2 分钟内服务器自动：拉取 → 构建 → 重启服务
- 无需你登录服务器

查看自动部署日志：
```bash
tail -f /var/log/badian-deploy.log
```

查看定时器状态：
```bash
systemctl list-timers badian-autodeploy.timer
```

## 二、手动更新（立即生效）

在服务器上执行一条命令：

```bash
cd ~/zcode-workspace/badian-game
npm run deploy          # 等价于 bash scripts/deploy.sh
```

脚本做的事：
1. 检查工作区是否干净（有未提交改动会中止，避免覆盖）
2. `git pull --ff-only origin main`
3. 若 `package.json` 有变更 → `npm ci`
4. `npm run build`（服务端 tsc + 客户端 vite）
5. 重启服务（优先 systemctl，无免密权限时结束进程由 systemd 自动拉起）
6. 健康检查 `http://127.0.0.1:3100/api/health`
7. 打印线上地址（来自 `TUNNEL_URL.txt`）

指定分支：
```bash
DEPLOY_BRANCH=main bash scripts/deploy.sh
```

## 三、服务与地址

| 项 | 说明 |
|---|---|
| 游戏服务 | systemd `badian`（开机自启、崩溃自动重启、`Restart=always`） |
| 公网隧道 | systemd `badian-tunnel`（开机自启、崩溃自动重启） |
| 当前公网地址 | 见项目根目录 `TUNNEL_URL.txt`（隧道重启后地址会变，文件自动更新） |
| 服务日志 | `journalctl -u badian -n 100` 或 `/var/log/badian.log` |
| 隧道日志 | `/var/log/badian-tunnel.log` |

## 四、常见问题

**Q：推了代码但线上没变？**
1. 看日志 `tail -20 /var/log/badian-deploy.log`
2. 若显示「工作区有未提交改动」→ 服务器上有未提交修改，先在服务器 `git status` 查看
3. 若显示「pull 失败（分叉）」→ 服务器上有本地提交未推送，先在服务器 `git push`
4. 也可手动执行 `npm run deploy` 立即部署

**Q：隧道地址变了？**
`cat TUNNEL_URL.txt` 读取新地址；隧道服务由 systemd 托管，无需手动启动。

**Q：如何关闭自动更新？**
```bash
sudo systemctl disable --now badian-autodeploy.timer
```
