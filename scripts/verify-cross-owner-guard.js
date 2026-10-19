/**
 * 权限隔离验证：A 教师尝试删除 B 教师的知识包。
 *
 * 期望：
 *   1. 删除接口返回 403（无权删除他人的知识包）。
 *   2. Aura 云端该 bundle 的节点数**不变**（失败的删除不能触碰云端数据）。
 *
 * 用法：node scripts/verify-cross-owner-guard.js
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

const BASE = 'http://127.0.0.1:3000';
const INVITE = process.env.TEACHER_INVITE_CODE || '';
const NEO4J_DATABASE = process.env.NEO4J_DATABASE || '4660732a';

async function makeSession(email) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'Passw0rd!2026',
      role: 'teacher',
      displayName: email.split('@')[0],
      inviteCode: INVITE,
    }),
  });
  if (res.status >= 400) {
    throw new Error(`注册失败 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const jar = new Map();
  for (const raw of res.headers.getSetCookie?.() || []) {
    const pair = raw.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return {
    cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
  };
}

async function auraBundleNodes(bundleId) {
  const neo4j = require('neo4j-driver');
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD),
  );
  try {
    const session = driver.session({ database: NEO4J_DATABASE });
    const res = await session.run(
      'MATCH (n:KnowledgeNode) WHERE n.compositeId STARTS WITH $prefix RETURN count(n) AS c',
      { prefix: `${bundleId}::` },
    );
    await session.close();
    return res.records[0]?.get('c')?.toNumber() ?? 0;
  } finally {
    await driver.close();
  }
}

async function main() {
  const stamp = Date.now();

  // A 教师：上传一个知识包
  const a = await makeSession(`owner-a-${stamp}@example.com`);
  const form = new FormData();
  const content = [
    '# 机械臂 DH 参数标定',
    '',
    '关节零位标定使用激光跟踪仪采集，标定后 DH 参数误差应小于 0.1 mm。',
    '',
    '## 标定流程',
    '',
    '1. 固定基座与末端工具，安装测量靶球。',
    '2. 采集 20 组以上不同位姿的关节角与靶球坐标。',
    '3. 用最小二乘法求解 DH 参数并做残差检验。',
    '',
    '## 常见问题',
    '',
    '若残差偏大，通常是关节零位未归零或工具坐标系未标定。',
  ].join('\n');
  form.append('file', new Blob([Buffer.from(content, 'utf8')], { type: 'text/markdown' }), 'owner-a.md');
  form.append('title', 'A教师的私有包');
  const up = await fetch(`${BASE}/api/knowledge`, {
    method: 'POST',
    headers: { cookie: a.cookie },
    body: form,
  });
  if (up.status >= 400) throw new Error(`上传失败 ${up.status}: ${(await up.text()).slice(0, 200)}`);
  const bundleId = (await up.json())?.bundle?.id;
  console.log('[guard] A 教师已上传, bundleId =', bundleId);

  const before = await auraBundleNodes(bundleId);
  console.log('[guard] Aura 中该 bundle 节点数（越权删除前）:', before);

  // B 教师：尝试删除 A 的包
  const b = await makeSession(`owner-b-${stamp}@example.com`);
  const del = await fetch(`${BASE}/api/knowledge`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', cookie: b.cookie },
    body: JSON.stringify({ id: bundleId }),
  });
  const text = await del.text();
  console.log('[guard] B 教师越权删除 ->', del.status, text.slice(0, 200));

  const after = await auraBundleNodes(bundleId);
  console.log('[guard] Aura 中该 bundle 节点数（越权删除后）:', after);

  console.log('\n===== 结论 =====');
  const forbidden = del.status === 403;
  const cloudIntact = after === before && before > 0;
  console.log(forbidden ? '✅ 越权删除被 403 拒绝' : `❌ 越权删除未被拒绝（status=${del.status}）`);
  console.log(cloudIntact ? '✅ 失败的删除未触碰 Aura 云端数据' : '❌ 云端数据被错误修改');
  process.exit(forbidden && cloudIntact ? 0 : 1);
}

main().catch((err) => {
  console.error('验证异常:', err.message);
  process.exit(1);
});
