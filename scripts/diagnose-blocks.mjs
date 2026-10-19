/**
 * 定位 Streamdown 产出 `<div>` 嵌在 `<p>` 内的确切 Markdown 形态。
 *
 * 思路：用 Streamdown 自己的分块函数切块，再用项目里实际用的 react-markdown
 * 渲染每一块（Streamdown 底层就是它），检查产物是否出现 <p> 内含块级元素。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { parseMarkdownIntoBlocks } from 'streamdown';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';

const proc = unified().use(remarkParse).use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw).use(rehypeStringify);

function toHtml(md) {
  try {
    return String(proc.processSync(md));
  } catch {
    return '';
  }
}

function illegal(html) {
  const out = [];
  const re = /<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(html))) {
    const b = m[1].match(/<(div|table|ul|ol|pre|blockquote|section|figure)\b/i);
    if (b) out.push({ tag: b[1], inner: m[1].slice(0, 120) });
  }
  return out;
}

// 收集所有节点的原始 Markdown
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

const corpus = [];
for (const f of walk('data/knowledge')) {
  let obj;
  try { obj = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  for (const n of obj?.nodes ?? []) {
    const c = String(n.content ?? '');
    if (c.trim()) corpus.push({ name: n.name ?? '?', file: f.split('/').pop(), content: c });
  }
}

console.log(`语料: ${corpus.length} 个节点\n`);

let badNodes = 0;
const samples = [];
for (const item of corpus) {
  const blocks = parseMarkdownIntoBlocks(item.content);
  for (const b of blocks) {
    const html = toHtml(b);
    const bad = illegal(html);
    if (bad.length) {
      badNodes++;
      if (samples.length < 4) samples.push({ ...item, block: b, bad: bad[0] });
      break;
    }
  }
}

console.log(`产出非法嵌套的节点: ${badNodes}/${corpus.length}\n`);
for (const s of samples) {
  console.log(`✗ ${s.name} [${s.file}]  <p> 内含 <${s.bad.tag}>`);
  console.log(`  片段: ${s.bad.inner.replace(/\s+/g, ' ')}`);
  console.log(`  块原文: ${s.block.slice(0, 200).replace(/\s+/g, ' ')}`);
  console.log('');
}
if (!badNodes) {
  console.log('语料本身不触发。需要看 document 内容（教师上传的资料正文）—— 那才是报错路径。');
}
