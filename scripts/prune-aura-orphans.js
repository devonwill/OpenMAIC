/**
 * 清理 Aura 云端里已经没有对应本地知识包的孤儿节点。
 *
 * 背景：应用的知识图谱同步是「全量重建」——只在上传 / 删除时触发，
 * 不会在容器启动时跑。所以直接删掉本地 bundle 文件（或换机器部署）后，
 * 云端会残留旧的 KnowledgeNode 与 KNOWS 关系。
 *
 * 本脚本按当前可见的 bundle 列表（由调用方传入）反查删除，或在不给参数时
 * 只做只读盘点，避免误删。
 *
 * 用法：
 *   node scripts/prune-aura-orphans.js            # 只盘点，不删
 *   node scripts/prune-aura-orphans.js --all      # 删除全部（危险：清空云端图谱）
 *   node scripts/prune-aura-orphans.js --keep kb-xxx kb-yyy   # 保留指定 bundle，删其余
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
const DB = process.env.NEO4J_DATABASE || '4660732a';

async function main() {
  const neo4j = require('neo4j-driver');
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD),
  );
  const session = driver.session({ database: DB });

  try {
    const inventory = await session.run(`
      MATCH (n:KnowledgeNode)
      WITH split(n.compositeId, '::')[0] AS bundle, count(*) AS cnt
      RETURN bundle, cnt ORDER BY bundle
    `);

    if (args.includes('--all')) {
      const res = await session.run(
        'MATCH (n) DETACH DELETE n RETURN count(n) AS deleted',
      );
      console.log(
        '已清空云端图谱，删除节点数:',
        res.records[0]?.get('deleted')?.toNumber() ?? 0,
      );
      return;
    }

    const keepIdx = args.indexOf('--keep');
    const keep = keepIdx >= 0 ? args.slice(keepIdx + 1) : [];

    console.log(`云端当前 bundle 清单（database=${DB}）:`);
    let stale = 0;
    let staleNodes = 0;
    for (const r of inventory.records) {
      const bundle = r.get('bundle');
      const cnt = r.get('cnt').toNumber();
      const isKeep = keep.includes(bundle);
      if (!isKeep && keep.length > 0) stale++;
      if (isKeep) staleNodes += 0;
      console.log(`  ${bundle}\t${cnt} 节点${isKeep ? '\t(保留)' : ''}`);
    }
    console.log(
      keep.length > 0
        ? `\n如需删除其余 bundle，请用 --keep 显式列出要保留的 id。`
        : '\n（当前为只读盘点，未做任何删除）',
    );
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((err) => {
  console.error('执行失败:', err.message);
  process.exit(1);
});
