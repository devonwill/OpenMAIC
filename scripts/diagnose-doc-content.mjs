/**
 * 通过真实 API 拉取教师已上传文档的原文，检查 Streamdown 渲染产物是否含
 * 「<p> 内含块级元素」的非法嵌套 —— 这是学生端 hydration 报错的直接原因。
 *
 * 与前面的静态扫描不同：这里走 HTTP，读的是线上真实内容（含 MinerU 解析结果）。
 */

import { parseMarkdownIntoBlocks } from 'streamdown';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:3000';

// ---- 1) 直接读磁盘上所有知识包，把 documents[].content 全量导出统计 ----
function walk(dir) {
  const acc = [];
  let entries = [];
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    const p = `${dir}/${e}`;
    try {
      if (statSync(p).isDirectory()) acc.push(...walk(p));
      else if (e.endsWith('.json')) acc.push(p);
    } catch { /* skip */ }
  }
  return acc;
}

const BLOCK = /<(\/?)(div|table|tbody|tr|td|th|section|article|figure|img|p|ul|ol|li|h[1-6]|blockquote|pre)\b[^>]*>/i;

function findProblems(content) {
  const problems = [];
  const blocks = parseMarkdownIntoBlocks(content);
  for (const [bi, b] of blocks.entries()) {
    const lines = b.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const cur = lines[i];
      const prev = lines[i - 1];
      if (!BLOCK.test(cur)) continue;
      // 上一行是普通文字，本行是 HTML 标签 → Markdown 会把两者放进同一个段落
      const prevText = prev && prev.trim() && !BLOCK.test(prev);
      if (prevText) {
        problems.push({
          kind: '段落文字 + HTML 块相邻',
          block: bi,
          prev: prev.trim().slice(0, 60),
          cur: cur.trim().slice(0, 60),
        });
      }
    }
  }
  return { blockCount: blocks.length, problems };
}

let docs = 0;
let bad = 0;
const report = [];

for (const f of walk('data/knowledge')) {
  let obj;
  try { obj = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  for (const d of obj?.documents ?? []) {
    const content = String(d?.content ?? '');
    if (!content.trim()) continue;
    docs++;
    const r = findProblems(content);
    if (r.problems.length) {
      bad++;
      report.push({ file: f.split('/').pop(), title: d.title, ...r, head: content.slice(0, 200) });
    }
  }
}

console.log(`磁盘知识包文档: ${docs} 份，命中风险: ${bad} 份`);
for (const r of report.slice(0, 5)) {
  console.log(`\n── ${r.title} [${r.file}] 分块 ${r.blockCount}`);
  console.log(`   原文开头: ${r.head.replace(/\s+/g, ' ').slice(0, 160)}`);
  for (const p of r.problems.slice(0, 3)) {
    console.log(`   【${p.kind}】前: ${p.prev}`);
    console.log(`            触: ${p.cur}`);
  }
}

// ---- 2) 顺带确认服务可达 ----
try {
  const res = await fetch(`${BASE}/api/knowledge`, { headers: { cookie: '' } });
  console.log(`\n服务可达: HTTP ${res.status}`);
} catch (e) {
  console.log(`\n服务不可达: ${e.message}`);
}
