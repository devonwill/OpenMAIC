/**
 * 诊断学生端 Markdown 的 hydration 报错根因。
 *
 * 报错：`<div>` cannot be a descendant of `<p>`
 * 怀疑：知识内容里混入了块级 HTML，段落被 <p> 包裹后内部再塞 div，形成非法嵌套。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';

const DATA_DIR = 'data/knowledge';

function walk(dir) {
  const acc = [];
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = `${dir}/${e}`;
    try {
      if (statSync(p).isDirectory()) acc.push(...walk(p));
      else if (e.endsWith('.json')) acc.push(p);
    } catch {
      /* 跨设备或权限问题，跳过 */
    }
  }
  return acc;
}

const bundles = walk(DATA_DIR);
console.log('知识包文件:', bundles.length);

const BLOCK_TAG = /<\/?(div|table|tbody|tr|td|th|section|article|ul|ol|li|pre|blockquote|h[1-6]|img|p|figure)\b[^>]*>/i;

let withHtml = 0;
const samples = [];
let totalNodes = 0;

for (const f of bundles) {
  let obj;
  try {
    obj = JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    continue;
  }
  for (const n of obj?.nodes ?? []) {
    totalNodes++;
    const c = String(n.content ?? '');
    if (!c || !BLOCK_TAG.test(c)) continue;
    withHtml++;
    if (samples.length < 6) {
      const tags = [...new Set(c.match(/<[^>]+>/g) ?? [])].slice(0, 6);
      samples.push({
        file: f.split('/').pop(),
        node: n.name ?? '(未命名)',
        tags,
        head: c.slice(0, 140).replace(/\s+/g, ' '),
      });
    }
  }
}

console.log('节点总数:', totalNodes);
console.log('内容含块级 HTML 的节点:', withHtml);
console.log('');

for (const s of samples) {
  console.log(`── ${s.node}  [${s.file}]`);
  console.log(`   标签: ${s.tags.join(' ')}`);
  console.log(`   开头: ${s.head}`);
  console.log('');
}

// 同时看数据库里的 documents（学生点的资料原文走 document.content）
try {
  const cnt = execSync(
    `PGPASSWORD=openmaic psql -h 127.0.0.1 -U openmaic -d openmaic -t -A -c "select count(*) from documents" 2>/dev/null || echo "无 documents 表"`,
  ).toString().trim();
  console.log('documents 表:', cnt);
} catch {
  console.log('documents 表: 查询失败');
}
