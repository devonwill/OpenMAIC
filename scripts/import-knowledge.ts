/** Offline importer: reads data only; never executes SKILL.md or repository code. */
import { readFile, realpath, lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { knowledgeBundleSchema, type KnowledgeBundle } from '../lib/knowledge/schema';

const args = process.argv.slice(2);
function option(name: string) {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
}
const paper = option('--paper');
const graph = option('--graph');
const id = option('--id');
const title = option('--title');
if ((!paper && !graph) || (paper && graph) || !id || !title) {
  console.error(
    'Usage: pnpm exec tsx scripts/import-knowledge.ts (--paper DIRECTORY | --graph FILE) --id ID --title TITLE [--out DIRECTORY]',
  );
  process.exit(1);
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function readBounded(filename: string, root?: string) {
  const resolved = await realpath(filename);
  if (root && !resolved.startsWith(root + path.sep))
    throw new Error('Source escapes package directory');
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20 * 1024 * 1024)
    throw new Error('Invalid or oversized source');
  return readFile(resolved);
}
async function main() {
  let bundle: KnowledgeBundle;
  if (paper) {
    const root = await realpath(paper);
    const nodes: KnowledgeBundle['nodes'] = [];
    for (const filename of ['paper.md', 'supplement.md']) {
      let bytes: Buffer;
      try {
        bytes = await readBounded(path.join(root, 'references', filename), root);
      } catch (error) {
        if (filename === 'supplement.md' && (error as NodeJS.ErrnoException).code === 'ENOENT')
          continue;
        throw error;
      }
      const sections = bytes
        .toString('utf8')
        .split(/(?=^#{1,6} )/m)
        .filter((text) => text.trim());
      for (let section = 0; section < sections.length; section++) {
        const text = sections[section];
        const heading = text
          .split('\n')[0]
          .replace(/^#+\s*/, '')
          .slice(0, 200);
        for (let offset = 0; offset < text.length; offset += 10000) {
          nodes.push({
            id: `${filename.replace('.md', '')}-${section + 1}-${offset / 10000 + 1}`,
            name: heading || title!,
            aliases: [title!],
            category: '论文段落',
            content: text.slice(offset, offset + 10000),
            source: {
              title: title!,
              locator: `references/${filename} · 段落 ${section + 1} · 字符 ${offset + 1}`,
              sha256: hash(bytes),
            },
          });
        }
      }
    }
    bundle = knowledgeBundleSchema.parse({
      version: 1,
      id,
      title,
      kind: 'paper',
      reviewStatus: 'unreviewed',
      nodes,
      links: [],
    });
  } else {
    const bytes = await readBounded(graph!);
    const raw = JSON.parse(bytes.toString('utf8'));
    const data = raw.data || raw;
    if (!Array.isArray(data.nodes) || !Array.isArray(data.links))
      throw new Error('Expected nodes and links arrays');
    bundle = knowledgeBundleSchema.parse({
      version: 1,
      id,
      title,
      kind: 'graph',
      reviewStatus: 'unreviewed',
      nodes: data.nodes.map((node: Record<string, unknown>) => {
        if (node.id === undefined || node.id === null)
          throw new Error('Every node needs a stable ID');
        return {
          id: String(node.id),
          name: node.name_ch || node.name,
          aliases: Array.isArray(node.aliases)
            ? node.aliases
            : node.name_ch && node.name
              ? [node.name]
              : [],
          category: String(node.category || '知识点'),
          content: [node.definition, node.explanation, node.content]
            .filter((value) => typeof value === 'string')
            .join('\n'),
          source: { title, locator: `图谱节点 ${node.id}`, sha256: hash(bytes) },
        };
      }),
      links: data.links.map((link: Record<string, unknown>) => {
        if (link.source == null || link.target == null)
          throw new Error('Relationship endpoint missing');
        return {
          source: String(link.source),
          target: String(link.target),
          relation: String(link.relation_name || link.relation || link.name || '相关'),
        };
      }),
    });
  }
  if (!bundle.nodes.length) throw new Error('Empty knowledge package');
  const output = path.resolve(option('--out') || 'data/knowledge');
  await mkdir(output, { recursive: true });
  const filename = path.join(output, `${bundle.id}.json`);
  await writeFile(filename, JSON.stringify(bundle, null, 2) + '\n', { flag: 'wx' });
  console.log(
    `Imported ${bundle.nodes.length} nodes and ${bundle.links.length} relationships: ${filename}\nReview status: unreviewed. No source instructions or code were executed.`,
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
