#!/bin/zsh
# 本地 OpenMAIC 服务托管脚本。
#
# 为什么需要它：直接 `nohup node server.js &` 的进程会随终端会话结束被回收，
# 表现为「刚启动还能访问，关掉命令就没了」。launchd 由系统守护，不受会话影响。
#
# 用法：
#   bash scripts/local-server.sh start|stop|restart|status|logs

set -euo pipefail

PROJECT_DIR="/Volumes/D盘/Documents/Obsidian/资料/代码模型/OpenMAIC"
STANDALONE="$PROJECT_DIR/.next/standalone"
RUN_DIR=/private/tmp/openmaic-run
LOG=/tmp/openmaic-local.log
ENV_FILE="$PROJECT_DIR/.env.local"
PLIST="$HOME/Library/LaunchAgents/local.openmaic.plist"
PORT=3000

if [ ! -f "$ENV_FILE" ]; then
  echo "找不到 $ENV_FILE"
  exit 1
fi

# 环境变量要在 plist 生成时就展开：launchd 不读 .env 文件，
# 且 Next 的配置在进程启动阶段一次性读取。
write_plist() {
  mkdir -p "$HOME/Library/LaunchAgents"
  local env_block
  env_block=$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | while IFS= read -r line; do
    # 跳过注释与空行；值里含空格/引号的用双引号包起来
    printf '    <key>%s</key>\n    <string>%s</string>\n' \
      "${line%%=*}" "$(printf '%s' "${line#*=}" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')"
  done)
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.openmaic</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>$RUN_DIR/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$RUN_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>PORT</key><string>$PORT</string>
    <key>HOSTNAME</key><string>127.0.0.1</string>
$env_block
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
  echo "已生成 $PLIST"
}

load() {
  # bootout 可能因未加载而报错，忽略
  launchctl bootout "gui/$(id -u)/local.openmaic" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  launchctl kickstart -k "gui/$(id -u)/local.openmaic" 2>/dev/null || true
}

# 把 .next/standalone 产物同步到 RUN_DIR。
# 为什么每次 start 都要跑：RUN_DIR 在 /private/tmp 下，系统清理后目录会消失，
# launchd 因 WorkingDirectory 不存在而 spawn 失败（表现为空日志 + 启动超时）。
deploy() {
  if [ ! -f "$STANDALONE/server.js" ]; then
    echo "缺少 $STANDALONE/server.js，先执行: pnpm build"
    exit 1
  fi
  mkdir -p "$RUN_DIR"
  rsync -a --delete "$STANDALONE/" "$RUN_DIR/"
  # standalone 输出不含静态资源与 public，需手动补
  mkdir -p "$RUN_DIR/.next"
  rsync -a --delete "$PROJECT_DIR/.next/static/" "$RUN_DIR/.next/static/"
  rsync -a "$PROJECT_DIR/public/" "$RUN_DIR/public/"
  echo "已部署 standalone 到 $RUN_DIR"
}

wait_ready() {
  for i in $(seq 1 20); do
    sleep 2
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:$PORT/" 2>/dev/null)" = "200" ]; then
      echo "✓ 服务就绪：http://127.0.0.1:$PORT"
      return 0
    fi
  done
  echo "✗ 启动超时，日志尾部："
  tail -15 "$LOG"
  return 1
}

case "${1:-status}" in
  start)
    deploy; write_plist; load; wait_ready
    ;;
  restart)
    deploy; write_plist; load; wait_ready
    ;;
  stop)
    launchctl bootout "gui/$(id -u)/local.openmaic" 2>/dev/null && echo "已停止" || echo "未在运行"
    ;;
  status)
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:$PORT/" 2>/dev/null)" = "200" ]; then
      echo "✓ 运行中 — http://127.0.0.1:$PORT"
    else
      echo "✗ 未运行"
    fi
    ;;
  logs)
    tail -"${2:-40}" "$LOG"
    ;;
  *)
    echo "用法: bash scripts/local-server.sh start|stop|restart|status|logs"
    exit 1
    ;;
esac
