/**
 * Aura 云端知识图谱的连通性与数据核对脚本（开发/部署验证用）。
 *
 * 用途：
 *   1. 验证容器/本机能否真正连上 Neo4j Aura（不是静默降级到 JSON）。
 *   2. 统计 KnowledgeNode / KNOWS 关系数量，用于「教师删除数据 -> 云端是否联动删除」的对照。
 *
 * 用法：
 *   node scripts/check-aura-graph.js count     # 打印节点/关系数
 *   node scripts/check-aura-graph.js bundle <bundleId>   # 打印某个 bundle 在云端的节点
 *   node scripts/check-aura-graph.js list                  # 列出所有 bundleId 及其节点数
 *
 * 依赖：仅使用 neo4j-driver（项目已装）。
 */
const fs = require('node:fs');
const path = require('node:path');

function loadEnv() {
  // 容器里环境变量已注入；本地运行时从 .env.local 兜底读取
  const candidates = [
    path.join(process.cwd(), '.env.local'),
    path.join(__dirname, '..', '.env.local'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      // 已被外部注入的优先，不覆盖
      if (process.env[key] === undefined) {
        process.env[key] = trimmed.slice(eq + 1).trim();
      }
    }
  }
}

loadEnv();

const URI = process.env.NEO4J_URI;
const USER = process.env.NEO4J_USER;
const PASSWORD = process.env.NEO4J_PASSWORD;
// Aura Free 的库名就是实例 id（如 4660732a），不是默认的 neo4j。
// 实际值优先取 NEO4J_DATABASE 环境变量。
const DATABASE = process.env.NEO4J_DATABASE || '4660732a';

if (!URI || !USER || !PASSWORD) {
  console.error('缺少 NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD，无法连接 Aura。');
  process.exit(2);
}

const command = process.argv[2] || 'count';
const arg = process.argv[3];

async function main() {
  // 动态 require：未安装 neo4j-driver 时给出明确提示，而不是让脚本崩在栈里
  let neo4j;
  try {
    neo4j = require('neo4j-driver');
  } catch (err) {
    console.error('无法加载 neo4j-driver：', err.message);
    process.exit(2);
  }

  const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD), {
    maxConnectionPoolSize: 5,
    connectionAcquisitionTimeout: 20000,
  });

  try {
    await driver.verifyConnectivity();
    console.log(`✓ 已连接 Aura: ${URI} (database=${DATABASE})`);

    if (command === 'count') {
      const res = await driver.executeQuery(
        'MATCH (n:KnowledgeNode) RETURN count(n) AS nodes',
        {},
        { database: DATABASE },
      );
      const nodes = res.records[0]?.get('nodes')?.toNumber() ?? 0;

      const relRes = await driver.executeQuery(
        'MATCH ()-[r:KNOWS]->() RETURN count(r) AS rels',
        {},
        { database: DATABASE },
      );
      const rels = relRes.records[0]?.get('rels')?.toNumber() ?? 0;

      console.log(`KnowledgeNode 节点数: ${nodes}`);
      console.log(`KNOWS 关系数: ${rels}`);
    } else if (command === 'bundle') {
      if (!arg) {
        console.error('用法: node scripts/check-aura-graph.js bundle <bundleId>');
        process.exit(2);
      }
      const res = await driver.executeQuery(
        'MATCH (n:KnowledgeNode) WHERE n.compositeId STARTS WITH $prefix RETURN n.compositeId AS id, n.title AS title ORDER BY id',
        { prefix: `${arg}::` },
        { database: DATABASE },
      );
      console.log(`bundle ${arg} 在云端的节点数: ${res.records.length}`);
      for (const r of res.records) {
        console.log(`  - ${r.get('id')}  ${r.get('title') ?? ''}`);
      }
    } else if (command === 'list') {
      const res = await driver.executeQuery(
        `MATCH (n:KnowledgeNode)
         WITH split(n.compositeId, '::')[0] AS bundle, count(*) AS cnt
         RETURN bundle, cnt ORDER BY cnt DESC`,
        {},
        { database: DATABASE },
      );
      console.log(`共 ${res.records.length} 个 bundle:`);
      for (const r of res.records) {
        console.log(`  ${r.get('bundle')}\t${r.get('cnt').toNumber()} 节点`);
      }
    } else {
      console.error(`未知命令: ${command}`);
      process.exit(2);
    }
  } catch (err) {
    console.error('✗ Aura 操作失败:', err.message);
    process.exit(1);
  } finally {
    await driver.close();
  }
}

main();
