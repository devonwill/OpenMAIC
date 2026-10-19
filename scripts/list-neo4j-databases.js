/**
 * 列出当前 Neo4j（Aura）实例上所有可见的数据库及其状态。
 *
 * 用途：托管实例（Aura / Neo4j Cloud）的数据库名常被改写成自定义名字，
 * 不先确认实际库名就写死 session database 会直接报
 * "Unable to get a routing table for database 'X' because this database does not exist"。
 *
 * 用法：node scripts/list-neo4j-databases.js
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

async function main() {
  const neo4j = require('neo4j-driver');
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD),
  );

  try {
    // system 数据库是 Aura 上唯一能列出所有库的地方
    const session = driver.session({ database: 'system' });
    const res = await session.run('SHOW DATABASES');
    console.log('实例上的数据库:');
    for (const r of res.records) {
      const name = r.get('name');
      const type = r.get('type');
      const currentStatus = r.get('currentStatus');
      const isDefault = r.get('default');
      console.log(
        `  - ${name}  type=${type}  status=${currentStatus}  default=${isDefault}`,
      );
    }
    await session.close();
  } catch (err) {
    console.error('列出数据库失败:', err.message);
  } finally {
    await driver.close();
  }
}

main();
