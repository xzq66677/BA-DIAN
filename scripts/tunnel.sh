#!/bin/bash
# 拔典 · 公网快速隧道（trycloudflare）自动守护
# 将当前 URL 写入 TUNNEL_URL.txt（服务器重启后地址会变，读此文件即可）
URL_FILE="/home/xzq666/zcode-workspace/badian-game/TUNNEL_URL.txt"
/etc/sing-box/cloudflared tunnel --url http://localhost:3100 --no-autoupdate --protocol http2 2>&1 | while IFS= read -r line; do
  url=$(printf '%s' "$line" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1)
  if [ -n "$url" ] && [ "$url" != "$(cat "$URL_FILE" 2>/dev/null)" ]; then
    echo "$url" > "$URL_FILE"
    echo "$(date '+%F %T') tunnel url -> $url"
  fi
done
