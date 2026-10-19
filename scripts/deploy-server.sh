#!/bin/bash
# 腾讯云 4GB 小机器的 OpenMAIC 部署脚本。
#
# 单独存在这个脚本，是因为 `next build`（Turbopack）的峰值内存会逼近宿主的
# 物理内存上限，4GB 机器上会连带把 sshd / nginx 拖进 thrashing —— 表现是
# "TCP 22 握手成功，但 SSH banner 一直超时"，看起来像网络断了，其实是
# 内存耗尽导致 sshd fork 不出子进程。
#
# 因此这里做三件事：
#   1. 准备 swap，让内存峰值有兜底（避免直接触发 OOM killer）。
#   2. 构建阶段停掉 postgres，把这 200MB 让给构建。
#   3. 给 buildkit 和构建容器加内存上限，避免单个构建进程吃光宿主内存。
#
# 用法：bash scripts/deploy-server.sh [build|up|status]

set -uo pipefail

ACTION="${1:-build}"
APP_DIR="${APP_DIR:-$HOME/OpenMAIC}"
SWAP_SIZE="${SWAP_SIZE:-4G}"

log() { echo "[deploy] $*"; }

# ---- 1. swap 兜底 -------------------------------------------------------
# 4GB 机器跑 Next 构建必须要有 swap。没有 swap 时内核只能直接回收甚至
# OOM kill，sshd / nginx 会同时失去 fork 能力。
ensure_swap() {
  local existing
  existing="$(free -m | awk '/^Swap:/ {print $2}')"
  if [ "${existing:-0}" -ge 2048 ]; then
    log "swap 已有 ${existing}MB，跳过"
    return 0
  fi

  log "创建 ${SWAP_SIZE} swap 文件（需要 root）"
  sudo fallocate -l "$SWAP_SIZE" /swapfile 2>/dev/null \
    || sudo dd if=/dev/zero of=/swapfile bs=1M count=4096 status=none
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null 2>&1 || true
  sudo swapon /swapfile 2>/dev/null || true

  # 重启后仍生效
  if ! grep -q '/swapfile' /etc/fstab 2>/dev/null; then
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  fi
  log "swap 状态: $(free -m | awk '/^Swap:/ {print $2"MB total / "$3"MB used"}')"
}

# ---- 2. 构建前腾出内存 --------------------------------------------------
free_memory_for_build() {
  log "停止 postgres 与已有应用容器，为构建腾内存"
  docker compose -f "$APP_DIR/docker-compose.yml" --profile server-persistence \
    stop postgres 2>/dev/null || true
  docker stop "$(docker ps -q --filter name=openmaic)" 2>/dev/null || true

  # 清理上一轮失败的构建缓存和悬空镜像
  docker builder prune -af 2>/dev/null | tail -1
  docker image prune -af 2>/dev/null | tail -1

  log "当前内存: $(free -m | awk '/^Mem:/ {print $3"MB used / "$2"MB"}')"
}

# ---- 3. 构建 -------------------------------------------------------------
do_build() {
  ensure_swap
  free_memory_for_build

  cd "$APP_DIR" || exit 1
  set -a
  # NEXT_PUBLIC_* 是编译期变量，必须与服务端 .env.local 保持一致
  # shellcheck disable=SC1091
  source ./.env.local 2>/dev/null
  set +a

  export NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
  export ALPINE_MIRROR="${ALPINE_MIRROR:-mirrors.tuna.tsinghua.edu.cn}"
  # buildkit 默认不限制内存，让它跟着物理内存走 -> 宿主被吃满。
  # 显式压到 2.5GB，OOM 时只死构建进程，不影响宿主的 sshd / nginx。
  export DOCKER_BUILDKIT=1
  export BUILDKIT_STEP_LOG_MAX_SIZE=-1

  log "开始构建（内存上限 2.5G / V8 堆 1536MB）"
  docker compose --profile server-persistence build --progress plain 2>&1 | tail -40
  local rc=${PIPESTATUS[0]}
  log "build 退出码: $rc"
  return $rc
}

# ---- 4. 启动 -------------------------------------------------------------
do_up() {
  cd "$APP_DIR" || exit 1
  set -a
  # shellcheck disable=SC1091
  source ./.env.local 2>/dev/null
  set +a

  log "启动容器"
  docker compose --profile server-persistence up -d 2>&1 | tail -10
  log "容器状态:"
  docker compose --profile server-persistence ps
}

do_status() {
  echo "--- 内存 ---"
  free -m
  echo "--- 容器 ---"
  docker ps --format '{{.Names}}\t{{.Status}}' 2>/dev/null
  echo "--- 负载 ---"
  cat /proc/loadavg
  echo "--- 图谱后端 ---"
  curl -s -m 15 http://127.0.0.1:3000/api/knowledge 2>/dev/null \
    | grep -o '"graphBackend":{[^}]*}' || echo "(接口无响应)"
}

case "$ACTION" in
  build)  do_build ;;
  up)     do_up ;;
  swap)   ensure_swap ;;
  status) do_status ;;
  *) echo "用法: $0 [build|up|swap|status]"; exit 1 ;;
esac
