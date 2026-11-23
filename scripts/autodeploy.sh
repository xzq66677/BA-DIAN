#!/usr/bin/env bash
# 拔典 · 自动部署巡检（供 systemd timer 每 2 分钟调用）
# 仓库有新提交 → 自动拉取构建重启；否则静默退出
set -uo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
LOG=/var/log/badian-deploy.log
exec 9>/tmp/.badian-autodeploy.lock
flock -n 9 || exit 0                      # 防并发
[ -n "$(git status --porcelain)" ] && exit 0   # 有本地改动→跳过

git fetch --quiet --prune origin || exit 0
DEPLOYED_FILE=$(git rev-parse --git-path badian-deployed)
LOCAL=$(cat "$DEPLOYED_FILE" 2>/dev/null || git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main 2>/dev/null) || exit 0
[ "$LOCAL" = "$REMOTE" ] && exit 0        # 无新提交

mkdir -p "$(dirname "$LOG")" 2>/dev/null
echo "$(date '+%F %T') 检测到新提交 ${LOCAL:0:7} → ${REMOTE:0:7}，开始自动部署" >> "$LOG" 2>/dev/null
DEPLOY_REVISION="$REMOTE" bash "$APP_DIR/scripts/deploy.sh" >> "$LOG" 2>&1
