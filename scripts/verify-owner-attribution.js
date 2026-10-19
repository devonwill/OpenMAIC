/**
 * 归属验证：确认 data/knowledge 下的每个包都归属目标教师账号，且本人可读可改。
 *
 * 走应用自己的加载与权限判定逻辑（loadKnowledge + canReadKnowledge /
 * canReadResource），而不是单纯比对 json 里的 ownerId 字符串——后者无法发现
 * 「schema 校验不过」「文件权限导致读不到」这类真实问题。
 *
 * 权限规则见 lib/sharing/policy.ts:canReadResource：
 *   可读 = ownerId 命中本人，或 visibility=public / 在 sharedWithUserIds 里
 *   可写/可删 = app/api/knowledge/route.ts 里 `ownerId !== ctx.ownerId` 才 403
 *
 * 用法：node scripts/verify-owner-attribution.js [邮箱]
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

const TARGET_EMAIL = process.argv[2] || 'weidunwen@uestc.edu.cn';

async function main() {
  const { loadKnowledge } = await import('../lib/knowledge/storage.js');
  const { canReadKnowledge } = await import('../lib/knowledge/access.js');
  const { getAuthDb } = await import('../lib/server/auth/db.js');

  const db = await getAuthDb();
  if (!db) {
    console.error('DATABASE_URL 未配置或连接池不可用');
    process.exit(2);
  }
  const res = await db.query(
    'SELECT id, email, role, display_name FROM users WHERE email = $1',
    [TARGET_EMAIL],
  );
  if (res.rows.length === 0) {
    console.error(`数据库里找不到账号: ${TARGET_EMAIL}`);
    process.exit(2);
  }
  const user = res.rows[0];
  const ownerId = `user:${user.id}`;
  console.log(`目标账号: ${user.email}  role=${user.role}  id=${user.id}`);
  console.log(`期望 ownerId: ${ownerId}\n`);

  const loaded = await loadKnowledge();
  if (loaded.warnings?.length) {
    console.log('加载告警:');
    for (const w of loaded.warnings) console.log(`  - ${w}`);
    console.log('');
  }

  const rows = [];
  let readable = 0;
  let totalNodes = 0;
  let totalLinks = 0;

  for (const bundle of loaded.bundles) {
    const canRead = canReadKnowledge(bundle, ownerId);
    if (canRead) readable++;
    totalNodes += bundle.nodes?.length ?? 0;
    totalLinks += bundle.links?.length ?? 0;
    rows.push({
      id: bundle.id,
      title: bundle.title,
      ownerId: bundle.ownerId,
      visibility: bundle.visibility ?? '(未设置)',
      shared: bundle.sharedWithUserIds?.length ?? 0,
      nodes: bundle.nodes?.length ?? 0,
      links: bundle.links?.length ?? 0,
      canRead,
      isOwner: bundle.ownerId === ownerId,
    });
  }

  console.log('包清单:');
  console.log(
    `  ${'bundleId'.padEnd(24)}${'标题'.padEnd(24)}${'归属'.padEnd(8)}${'可见'.padEnd(10)}${'节点'.padEnd(7)}${'关系'.padEnd(7)}可读 可改`,
  );
  for (const r of rows) {
    // 可写判定直接复用删除接口的规则：ownerId 相同即可写
    const canWrite = r.isOwner;
    console.log(
      `  ${r.id.padEnd(24)}${(r.title || '').slice(0, 22).padEnd(24)}` +
        `${(r.isOwner ? '本人' : '他人').padEnd(8)}${String(r.visibility).padEnd(10)}` +
        `${String(r.nodes).padEnd(7)}${String(r.links).padEnd(7)}` +
        `${r.canRead ? ' ✓ ' : ' ✗ '}${canWrite ? ' ✓' : ' ✗'}`,
    );
  }

  console.log(
    `\n共 ${rows.length} 个包，节点 ${totalNodes}，关系 ${totalLinks}；本人可读 ${readable}`,
  );
  const allOwned = rows.every((r) => r.isOwner);
  const allMutable = rows.every((r) => r.isOwner);
  console.log(allOwned ? '✅ 全部归属目标账号' : '❌ 存在归属他人的包');
  console.log(allMutable ? '✅ 全部可编辑 / 可删除' : '❌ 存在不可编辑的包');
  process.exit(allOwned && allMutable && rows.length > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('验证失败:', err);
  process.exit(1);
});
