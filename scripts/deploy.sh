#!/usr/bin/env bash
# 拔典 · 一键部署：拉取仓库最新代码 → 安装依赖（如需）→ 构建 → 重启服务 → 健康检查
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
log "[1/5] 拉取 origin/$BRANCH"
git fetch --prune origin || { log "✗ fetch 失败"; exit 1; }
OLD=$(git rev-parse HEAD)
NEW=$(git rev-parse "origin/$BRANCH")
if [ "$OLD" = "$NEW" ]; then
  log "已是最新提交 ${OLD:0:7}（仍将重建以确保一致）"
else
  git pull --ff-only "origin" "$BRANCH" || { log "✗ pull 失败（可能有本地提交分叉）"; exit 1; }
  log "更新：${OLD:0:7} → ${NEW:0:7}"
fi

# 2. 依赖（package 变动才装）
if git diff --name-only "$OLD" "$NEW" 2>/dev/null | grep -qE '^package(-lock)?\.json$'; then
  log "[2/5] 依赖有变更，安装中…"
  npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund || { log "✗ 依赖安装失败"; exit 1; }
else
  log "[2/5] 依赖未变更，跳过安装"
fi

# 3. 构建
log "[3/5] 构建服务端 + 客户端"
npm run build || { log "✗ 构建失败（服务保持旧版本运行）"; exit 1; }

# 4. 重启服务
#    优先免密 systemctl；不可用时降级为结束进程（systemd Restart=always 会自动拉起）
log "[4/5] 重启 badian 服务"
if sudo -n systemctl restart badian 2>/dev/null; then
  log "已通过 systemctl 重启"
else
  log "无免密 sudo，使用进程重启（systemd 自动拉起）"
  pkill -TERM -f "server/dist/server/src/index.js" 2>/dev/null
  # 等待旧进程退出、systemd 拉起新进程
  for i in $(seq 1 20); do
    sleep 1
    if curl -fsS --max-time 3 http://127.0.0.1:3100/api/health >/dev/null 2>&1; then break; fi
  done
fi

# 5. 健康检查
log "[5/5] 健康检查"
sleep 2
if curl -fsS --max-time 8 http://127.0.0.1:3100/api/health >/dev/null; then
  URL=$(cat "$APP_DIR/TUNNEL_URL.txt" 2>/dev/null || echo '(见 TUNNEL_URL.txt)')
  log "✅ 部署成功 · $(git log -1 --format='%h %s')"
  log "   线上地址：$URL"
else
  log "✗ 健康检查失败，请查看：journalctl -u badian -n 50"
  exit 1
fi
