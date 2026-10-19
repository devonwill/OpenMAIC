#!/bin/zsh
# 本机「启动 + 验证」一键脚本：学生端 4 项修复 + 头像 + 视觉迁移。
# 在沙箱外的本机终端粘到 OpenMAIC 仓库根目录执行。

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

log()  { printf '\033[1;34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '\033[1;33m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die()  { printf '\033[1;31m[%s] 失败：%s\033[0m\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

# 0. 准备工作目录
[ -f .env.local ] || die ".env.local 不存在，请先按仓库 README 配置 DATABASE_URL / NEO4J_* / COOKIE_SECURE=0"

# 1. 起 Postgres（brew 守护 / Docker 二选一）
if command -v brew >/dev/null && brew services list 2>/dev/null | grep -q postgresql; then
  if ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    log "启动 Postgres (brew services)"
    brew services start postgresql@16 2>/dev/null || brew services start postgresql 2>/dev/null || true
    sleep 2
  fi
fi
pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 || die "Postgres 未监听 127.0.0.1:5432，请先启动"

# 2. 起 Neo4j（brew 守护 / Docker 二选一）
if ! nc -z 127.0.0.1 7687 2>/dev/null; then
  if command -v neo4j >/dev/null; then
    log "启动 Neo4j (neo4j start)"
    neo4j start || true
    sleep 5
  elif command -v docker >/dev/null; then
    log "启动 Neo4j (docker compose)"
    (cd "$ROOT" && [ -f docker-compose.yml ] && docker compose up -d neo4j) || true
    sleep 8
  fi
fi
nc -z 127.0.0.1 7687 2>/dev/null || die "Neo4j 未监听 127.0.0.1:7687，请先启动"

# 3. 起 Next dev（用项目自带的 launchd 托管脚本，不在沙箱里所以 OK）
log "启动 Next dev (scripts/local-server.sh start)"
bash scripts/local-server.sh start
# 等待服务可用
for i in {1..30}; do
  if curl -sf -o /dev/null http://127.0.0.1:3000/; then
    log "Next dev 已就绪 (尝试 $i)"
    break
  fi
  sleep 1
  if [ $i -eq 30 ]; then
    die "Next dev 启动超时，看 /tmp/openmaic-local.log 排查"
  fi
done

# 4. 跑端到端验证
log "跑学生端修复验证"
node scripts/verify-student-fixes.mjs http://127.0.0.1:3000

# 5. 浏览器手测清单
cat <<'EOF'

\033[1;36m==== 浏览器手测清单 ====\033[0m
1. http://127.0.0.1:3000  →  注册教师（邀请码 BIOBOT-TEACHER-2026）
2. 知识库页 → 上传一份含图片行 + 紧贴图注的 PDF/Markdown
3. 分享设置 → 把库分享给你的另一个邮箱（visibility=private 或 public）
4. 换隐身窗口注册学生 → 打开 http://127.0.0.1:3000/knowledge
   - 共享资料下拉框能看到该库
   - 知识图谱可看、可拖动
   - 点击节点 → 右侧出现属性/关联/别名
   - 搜索框输入关键词 → 「与你的搜索相关」出现候选
   - 顶部「搜索」按钮 → 后端 hits 命中
   - Console 应无 <div> cannot be a descendant of <p>

\033[1;36m==== 收尾 ====\033[0m
- 看日志：tail -f /tmp/openmaic-local.log
- 停服务：bash scripts/local-server.sh stop
- 状态：  bash scripts/local-server.sh status
EOF
