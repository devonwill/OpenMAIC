/**
 * 「教师删除数据 -> Aura 云端知识图谱是否联动删除」的端到端验证脚本。
 *
 * 流程：
 *   1. 注册（或登录）一个教师账号，拿到会话 cookie。
 *   2. 上传一个 md 知识包，触发 LLM 抽取 -> 生成 KnowledgeNode -> 同步到 Aura。
 *   3. 记录 Aura 云端该 bundle 的节点数（删除前基线）。
 *   4. 调用 DELETE /api/knowledge 删除该 bundle。
 *   5. 再查 Aura 云端该 bundle 的节点数（应为 0），并对比全库节点总数是否下降。
 *
 * 用法（在服务器容器内或本机均可）：
 *   node scripts/verify-cloud-delete.js \
 *     --base http://127.0.0.1:3000 \
 *     --email teacher@example.com --password Passw0rd! \
 *     --invite BIOBOT-TEACHER-2026 \
 *     --title "删除联动验证包" \
 *     --content "# 机械臂 DH 参数标定\n\n关节标定流程说明。"
 */
const fs = require('node:fs');
const path = require('node:path');

function loadEnv() {
  for (const file of [
    path.join(process.cwd(), '.env.local'),
    path.join(__dirname, '..', '.env.local'),
  ]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (process.env[key] === undefined) {
        process.env[key] = trimmed.slice(eq + 1).trim();
      }
    }
  }
}
loadEnv();

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const BASE = arg('base', 'http://127.0.0.1:3000');
const EMAIL = arg('email', `teacher-${Date.now()}@example.com`);
const PASSWORD = arg('password', 'Passw0rd!2026');
const INVITE = arg('invite', process.env.TEACHER_INVITE_CODE || '');
const TITLE = arg('title', '删除联动验证包');
const CONTENT = arg(
  'content',
  '# 机械臂 DH 参数标定\n\n关节零位标定使用激光跟踪仪采集，标定后 DH 参数误差应小于 0.1 mm。',
);

function log(...args) {
  console.log('[verify]', ...args);
}

// 统一的 cookie 罐：会话 + 匿名身份都要带，否则写操作的 ownerId 会对不上
const cookies = new Map();

function cookieHeader() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function request(url, options = {}) {
  const res = await fetch(`${BASE}${url}`, {
    ...options,
    redirect: 'manual',
    headers: {
      ...(options.headers || {}),
      ...(cookies.size ? { cookie: cookieHeader() } : {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  for (const raw of setCookie) {
    const pair = raw.split(';')[0];
    const name = pair.slice(0, pair.indexOf('='));
    // 会话 cookie（openmaic_session）与匿名身份 cookie（openmaic_anon）都要留，
    // 否则删除接口会因为 ownerId 不匹配而返回 403。
    if (name === 'openmaic_session' || name === 'openmaic_anon') {
      cookies.set(name, pair.slice(pair.indexOf('=') + 1));
    }
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json, headers: res.headers };
}

// ---- Aura 查询 ----------------------------------------------------------
const NEO4J_URI = process.env.NEO4J_URI;
const NEO4J_USER = process.env.NEO4J_USER;
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD;
const NEO4J_DATABASE = process.env.NEO4J_DATABASE || '4660732a';

async function queryAura(cypher, params = {}) {
  const neo4j = require('neo4j-driver');
  const driver = neo4j.driver(
    NEO4J_URI,
    neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD),
  );
  try {
    const session = driver.session({ database: NEO4J_DATABASE });
    const res = await session.run(cypher, params);
    await session.close();
    return res.records;
  } finally {
    await driver.close();
  }
}

async function auraTotalNodes() {
  const records = await queryAura('MATCH (n:KnowledgeNode) RETURN count(n) AS c');
  return records[0]?.get('c')?.toNumber() ?? 0;
}

async function auraBundleNodes(bundleId) {
  const records = await queryAura(
    'MATCH (n:KnowledgeNode) WHERE n.compositeId STARTS WITH $prefix RETURN count(n) AS c',
    { prefix: `${bundleId}::` },
  );
  return records[0]?.get('c')?.toNumber() ?? 0;
}

async function main() {
  if (!NEO4J_URI) {
    console.error('缺少 NEO4J_URI，无法核对云端数据');
    process.exit(2);
  }

  // 1. 教师登录 / 注册
  log('登录教师账号:', EMAIL);
  let res = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (res.status >= 400) {
    log('登录失败，尝试注册:', res.status, JSON.stringify(res.json).slice(0, 160));
    res = await request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: EMAIL,
        password: PASSWORD,
        role: 'teacher',
        displayName: '删除验证教师',
        inviteCode: INVITE,
      }),
    });
    if (res.status >= 400) {
      console.error('注册失败:', res.status, JSON.stringify(res.json).slice(0, 300));
      process.exit(1);
    }
    log('注册成功');
  } else {
    log('登录成功');
  }

  // 2. 上传知识包
  const before = await auraTotalNodes();
  log('Aura 节点总数（上传前）:', before);

  const form = new FormData();
  form.append(
    'file',
    new Blob([Buffer.from(CONTENT, 'utf8')], { type: 'text/markdown' }),
    'verify-delete.md',
  );
  form.append('title', TITLE);
  log('上传知识包...');
  res = await request('/api/knowledge', { method: 'POST', body: form });
  if (res.status >= 400) {
    console.error('上传失败:', res.status, JSON.stringify(res.json).slice(0, 400));
    process.exit(1);
  }
  const bundleId = res.json?.bundle?.id || res.json?.id;
  log('上传成功，bundleId =', bundleId);
  log('X-Knowledge-Graph-Sync =', res.headers.get('x-knowledge-graph-sync'));

  // 3. 删除前基线
  const bundleNodesBefore = await auraBundleNodes(bundleId);
  const totalBefore = await auraTotalNodes();
  log('该 bundle 在 Aura 的节点数（删除前）:', bundleNodesBefore);
  log('Aura 节点总数（删除前）:', totalBefore);

  if (bundleNodesBefore === 0) {
    log('⚠️ 删除前云端没有该 bundle 的节点，无法验证联动删除（可能是抽取未产生节点）');
  }

  // 4. 删除
  log('调用 DELETE /api/knowledge ...');
  res = await request('/api/knowledge', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: bundleId }),
  });
  if (res.status >= 400) {
    console.error('删除失败:', res.status, JSON.stringify(res.json).slice(0, 300));
    process.exit(1);
  }
  log('删除接口返回:', JSON.stringify(res.json));

  // 5. 删除后核对
  // 全量重建是异步触发的，稍等一下让 sync 落地
  await new Promise((r) => setTimeout(r, 3000));
  const bundleNodesAfter = await auraBundleNodes(bundleId);
  const totalAfter = await auraTotalNodes();
  log('该 bundle 在 Aura 的节点数（删除后）:', bundleNodesAfter);
  log('Aura 节点总数（删除后）:', totalAfter);

  console.log('\n===== 结论 =====');
  const ok =
    bundleNodesAfter === 0 &&
    (bundleNodesBefore === 0 || totalAfter < totalBefore);
  console.log(ok ? '✅ 云端联动删除验证通过' : '❌ 云端联动删除未生效');
  console.log(`   bundle 节点: ${bundleNodesBefore} -> ${bundleNodesAfter}`);
  console.log(`   全库节点:   ${totalBefore} -> ${totalAfter}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('验证脚本异常:', err);
  process.exit(1);
});
