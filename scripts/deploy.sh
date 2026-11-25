#!/usr/bin/env bash
# 拔典 · 一键部署：拉取仓库最新代码 → 安装依赖（如需）→ 验证 → 构建 → 重启服务 → 健康检查
# 用法：bash scripts/deploy.sh     或     npm run deploy
set -uo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }

log "===== 开始部署 ====="
BRANCH="${DEPLOY_BRANCH:-main}"

# 0. 工作区必须干净（避免覆盖未提交改动）
if [ -n "$(git status --porcelain)" ]; then
  log "⚠ 工作区有未提交改动，已中止（请先 commit/stash）"
  exit 1
fi

# 1. 拉取
log "[1/6] 拉取 origin/$BRANCH"
git fetch --prune origin || { log "✗ fetch 失败"; exit 1; }
OLD=$(git rev-parse HEAD) || exit 1
NEW=$(git rev-parse "origin/$BRANCH") || exit 1
if [ -n "${DEPLOY_REVISION:-}" ] && [ "$NEW" != "$DEPLOY_REVISION" ]; then
  log "远端提交已更新，等待下一次部署巡检"
  exit 1
fi
if ! git merge-base --is-ancestor "$OLD" "$NEW"; then
  log "✗ 当前 HEAD 不是目标提交的祖先，已中止部署"
  exit 1
fi
DEPLOYED_FILE=$(git rev-parse --git-path badian-deployed) || exit 1
# 首次接入时以现有版本初始化。测试或健康检查失败后继续保留旧版本号。
if [ ! -f "$DEPLOYED_FILE" ]; then
  printf '%s\n' "$OLD" > "$DEPLOYED_FILE" || exit 1
fi
if [ "$OLD" = "$NEW" ]; then
  log "已是最新提交 ${OLD:0:7}（仍将重建以确保一致）"
else
  git merge --ff-only "$NEW" || { log "✗ pull 失败（可能有本地提交分叉）"; exit 1; }
  log "更新：${OLD:0:7} → ${NEW:0:7}"
fi

# 2. 仅在上次成功安装的依赖版本相同时跳过安装。
DEP_HASH=$(git rev-parse "HEAD:package.json" "HEAD:package-lock.json") || exit 1
DEP_FILE=$(git rev-parse --git-path badian-installed-deps)
if [ ! -d node_modules ] || [ "$(cat "$DEP_FILE" 2>/dev/null)" != "$DEP_HASH" ]; then
  log "[2/6] 安装依赖"
  npm ci --no-audit --no-fund || { log "✗ 依赖安装失败"; exit 1; }
  printf '%s\n' "$DEP_HASH" > "$DEP_FILE" || exit 1
else
  log "[2/6] 依赖未变更"
fi

log "[3/6] 运行部署回归测试"
npm test -- --exclude tests/ui/e2e.test.ts --maxWorkers=2 --minWorkers=1 ||
  { log "✗ 回归测试失败，跳过构建和重启"; exit 1; }

# 4. 构建
log "[4/6] 构建服务端 + 客户端"
npm run build || { log "✗ 构建失败（服务保持旧版本运行）"; exit 1; }

# 5. 重启服务
#    优先免密 systemctl；不可用时降级为结束进程（systemd Restart=always 会自动拉起）
log "[5/6] 重启 badian 服务"
if sudo -n systemctl restart badian 2>/dev/null; then
  log "已通过 systemctl 重启"
else
  log "无免密 sudo，使用进程重启（systemd 自动拉起）"
  pkill -TERM -f "server/dist/server/src/index.js" 2>/dev/null || { log "✗ 未能重启服务"; exit 1; }
  # 等待旧进程退出、systemd 拉起新进程
  for i in $(seq 1 20); do
    sleep 1
    if curl -fsS --max-time 3 http://127.0.0.1:3100/api/health >/dev/null 2>&1; then break; fi
  done
fi

# 6. 健康检查
log "[6/6] 健康检查"
sleep 2
if curl -fsS --max-time 8 http://127.0.0.1:3100/api/health >/dev/null; then
  printf '%s\n' "$NEW" > "$DEPLOYED_FILE.tmp" && mv -f "$DEPLOYED_FILE.tmp" "$DEPLOYED_FILE" || exit 1
  URL=$(cat "$APP_DIR/TUNNEL_URL.txt" 2>/dev/null || echo '(见 TUNNEL_URL.txt)')
  log "✅ 部署成功 · $(git log -1 --format='%h %s')"
  log "   线上地址：$URL"
else
  log "✗ 健康检查失败，请查看：journalctl -u badian -n 50"
  exit 1
fi
