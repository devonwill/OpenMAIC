/**
 * 用（代码库）— indexes a local code repository into a `kind: 'code'`
 * knowledge bundle so code becomes first-class retrieval evidence and can
 * link into the 看/读 layers:
 *
 *   - file nodes   (`f:<relpath>`)            → browsable units
 *   - symbol nodes (`s:<relpath>#<name>@<n>`) → functions/classes with snippets
 *   - local links  symbol → file, file → file (imports)
 *   - crossRefs    code symbol/file → knowledge nodes (shared terminology)
 *
 * v1 is lookup/citation only: nothing here executes the code. Deterministic
 * regex extraction — no LLM, no runtime deps — so offline indexing always works.
 */
import { canReadKnowledge } from '@/lib/knowledge/access';
import { saveKnowledgeBundle } from '@/lib/knowledge/storage';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  knowledgeBundleSchema,
  type KnowledgeBundle,
  type KnowledgeNode,
} from '@/lib/knowledge/schema';
import { loadKnowledge } from '@/lib/knowledge/server';

const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.venv',
  'venv',
  '__pycache__',
  'coverage',
  '.cache',
  '.turbo',
  '.idea',
  '.vscode',
  'target',
  'vendor',
]);

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.java',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.go',
  '.rs',
]);
const DOC_EXTENSIONS = new Set(['.md', '.txt', '.rst']);

const MAX_FILES = 2000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_NODES = 9000; // bundle schema caps at 10000
const MAX_LINKS = 29000; // bundle schema caps at 30000
const MAX_CROSS_REFS = 400; // per repo, schema caps at 5000
const SNIPPET_LINES = 40;

export interface CodeIndexOptions {
  ownerId: string;
  /** Absolute path of the repository on the server machine. */
  repoPath: string;
  title?: string;
  bundleId?: string;
}

export interface CodeIndexResult {
  bundle: KnowledgeBundle;
  stats: {
    files: number;
    symbols: number;
    links: number;
    crossRefs: number;
    skipped: number;
  };
  warnings: string[];
}

interface SymbolRule {
  category: string;
  pattern: RegExp;
}

const SYMBOL_RULES: Record<string, SymbolRule[]> = {
  '.py': [
    { category: '函数', pattern: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/m },
    { category: '类', pattern: /^\s*class\s+([A-Za-z_]\w*)\s*[:(]/m },
  ],
  '.go': [
    { category: '函数', pattern: /^func\s+(?:\([^)]*\)\s+)?([A-Za-z_]\w*)\s*\(/m },
    { category: '类型', pattern: /^type\s+([A-Za-z_]\w*)\s+/m },
  ],
  '.rs': [
    { category: '函数', pattern: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/m },
    { category: '结构体', pattern: /^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)/m },
  ],
  '.java': [
    { category: '类', pattern: /^\s*(?:public\s+)?(?:abstract\s+)?(?:final\s+)?class\s+([A-Za-z_]\w*)/m },
    { category: '接口', pattern: /^\s*(?:public\s+)?interface\s+([A-Za-z_]\w*)/m },
  ],
};

const JS_RULES: SymbolRule[] = [
  { category: '函数', pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/m },
  { category: '类', pattern: /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/m },
  { category: '函数', pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/m },
];
const C_RULES: SymbolRule[] = [
  { category: '类', pattern: /^\s*(?:template\s*<[^>]*>\s*)?(?:class|struct)\s+([A-Za-z_]\w*)\s*(?:final\s*)?[:{]/m },
  {
    category: '函数',
    pattern: /^(?:[\w:<>*&]+\s+)+(?:[\w:<>~]+\s+)*([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?[{;]\s*$/m,
  },
];

function rulesFor(extension: string): SymbolRule[] {
  if (extension === '.ts' || extension === '.tsx' || extension === '.js' ||
      extension === '.jsx' || extension === '.mjs' || extension === '.cjs')
    return JS_RULES;
  if (extension === '.c' || extension === '.cc' || extension === '.cpp' ||
      extension === '.h' || extension === '.hpp')
    return C_RULES;
  return SYMBOL_RULES[extension] ?? [];
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^\w./#:@-]/g, '_').slice(0, 150);
}

/** camelCase / snake_case → matching terms, length ≥ 3, lowercased. */
function identifierTerms(value: string): string[] {
  const parts = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_./#:-]+/)
    .map((part) => part.toLowerCase())
    .filter((part) => part.length >= 3);
  return [...new Set(parts)].slice(0, 12);
}

async function walkFiles(root: string): Promise<{ files: string[]; skipped: number }> {
  const files: string[] = [];
  let skipped = 0;
  const queue: string[] = [root];
  while (queue.length && files.length < MAX_FILES) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      skipped += 1;
      continue;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) queue.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!CODE_EXTENSIONS.has(extension) && !DOC_EXTENSIONS.has(extension)) continue;
      try {
        const info = await stat(full);
        if (info.size > MAX_FILE_BYTES) {
          skipped += 1;
          continue;
        }
      } catch {
        skipped += 1;
        continue;
      }
      files.push(full);
    }
  }
  return { files: files.sort(), skipped };
}

function extractSymbols(
  relativePath: string,
  extension: string,
  content: string,
  warnings: string[],
): { nodes: KnowledgeNode[]; symbolNames: string[] } {
  const lines = content.split('\n');
  const nodes: KnowledgeNode[] = [];
  const symbolNames: string[] = [];
  for (const rule of rulesFor(extension)) {
    // Reset lastIndex: rules are module-level regexes used with /g-free semantics,
    // but exec loops below rely on a fresh match per anchor line.
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;
    let guard = 0;
    while ((match = pattern.exec(content)) !== null && guard < 300) {
      guard += 1;
      const name = match[1];
      if (!name) break;
      const line = content.slice(0, match.index).split('\n').length;
      const snippet = lines.slice(Math.max(0, line - 1), line - 1 + SNIPPET_LINES).join('\n');
      const id = sanitizeIdPart(`s:${relativePath}#${name}@${line}`);
      nodes.push({
        id,
        name,
        aliases: [],
        category: rule.category,
        content: snippet.slice(0, 16000),
        source: { title: path.basename(relativePath), locator: `${relativePath}:${line}` },
      });
      symbolNames.push(name);
      if (pattern.lastIndex <= match.index) pattern.lastIndex = match.index + 1;
      // Only the first match per rule anchor is enough for a library index;
      // multi-function files still get every match via the loop, bounded by guard.
    }
    if (guard >= 300) warnings.push(`${relativePath}: 符号提取达到单文件上限 300。`);
  }
  // De-duplicate (same name/line from overlapping rules).
  const seen = new Set<string>();
  return {
    nodes: nodes.filter((node) => (seen.has(node.id) ? false : (seen.add(node.id), true))),
    symbolNames: [...new Set(symbolNames)],
  };
}

/** Resolve relative import specifiers against the indexed file set. */
function resolveImport(fromFile: string, specifier: string, indexed: Set<string>): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path
    .normalize(path.join(path.dirname(fromFile), specifier))
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  const candidates = [
    base,
    ...['.ts', '.tsx', '.js', '.jsx', '.py', '.c', '.cpp', '.h', '.hpp', '.java', '.go', '.rs'].map(
      (ext) => `${base}${ext}`,
    ),
    ...['index.ts', 'index.js', 'index.tsx', 'index.jsx', '__init__.py'].map((idx) =>
      path.join(base, idx).replace(/\\/g, '/'),
    ),
  ];
  return candidates.find((candidate) => indexed.has(candidate)) ?? null;
}

function importSpecifiers(content: string, extension: string): string[] {
  const found: string[] = [];
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(extension)) {
    for (const match of content.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
      found.push(match[1]);
    }
  } else if (extension === '.py') {
    for (const match of content.matchAll(/^\s*(?:from\s+([\w.]+)|import\s+([\w.]+))/gm)) {
      const modulePath = (match[1] ?? match[2]).replace(/\./g, '/');
      if (modulePath) found.push(`./${modulePath}`);
    }
  } else if (extension === '.c' || extension === '.cpp' || extension === '.h' || extension === '.hpp') {
    for (const match of content.matchAll(/#include\s+"([^"]+)"/g)) found.push(`./${match[1]}`);
  }
  return found.slice(0, 60);
}

/** Link code nodes to knowledge nodes by shared terminology (deterministic). */
async function buildCrossRefs(
  ownerId: string,
  codeNodes: KnowledgeNode[],
): Promise<{ crossRefs: KnowledgeBundle['crossRefs']; warnings: string[] }> {
  const warnings: string[] = [];
  const crossRefs: NonNullable<KnowledgeBundle['crossRefs']> = [];
  let knowledgeBundles: KnowledgeBundle[] = [];
  try {
    const loaded = await loadKnowledge();
    knowledgeBundles = loaded.bundles.filter(
      (bundle) => bundle.kind !== 'code' && canReadKnowledge(bundle, ownerId),
    );
  } catch {
    return { crossRefs, warnings: ['知识库不可用，跳过代码↔知识关联。'] };
  }
  // Knowledge-side token index: term → up to 8 candidate nodes.
  const termIndex = new Map<string, { bundleId: string; nodeId: string; name: string }[]>();
  for (const bundle of knowledgeBundles) {
    for (const node of bundle.nodes) {
      const terms = new Set(
        [node.name, ...node.aliases].flatMap((value) => identifierTerms(value)),
      );
      for (const term of terms) {
        const bucket = termIndex.get(term) ?? [];
        if (bucket.length < 8) bucket.push({ bundleId: bundle.id, nodeId: node.id, name: node.name });
        termIndex.set(term, bucket);
      }
    }
  }
  for (const codeNode of codeNodes) {
    if (crossRefs.length >= MAX_CROSS_REFS) break;
    const terms = identifierTerms(codeNode.name);
    if (terms.length === 0) continue;
    const votes = new Map<string, { bundleId: string; nodeId: string; score: number }>();
    for (const term of terms) {
      for (const candidate of termIndex.get(term) ?? []) {
        const key = `${candidate.bundleId}::${candidate.nodeId}`;
        const entry = votes.get(key) ?? {
          bundleId: candidate.bundleId,
          nodeId: candidate.nodeId,
          score: 0,
        };
        entry.score += 1;
        votes.set(key, entry);
      }
    }
    for (const [key, entry] of votes) {
      if (crossRefs.length >= MAX_CROSS_REFS) break;
      // ≥2 shared terms, or the code symbol IS the knowledge node name.
      const exactName = terms.length === 1 && key.endsWith(`::${terms[0]}`);
      if (entry.score < 2 && !exactName) continue;
      crossRefs.push({
        node: codeNode.id,
        targetBundleId: entry.bundleId,
        targetNodeId: entry.nodeId,
        relation: '代码实现',
      });
      void key;
    }
  }
  if (crossRefs.length >= MAX_CROSS_REFS)
    warnings.push(`代码↔知识关联达到单仓库上限 ${MAX_CROSS_REFS}。`);
  return { crossRefs, warnings };
}

export async function indexCodeRepo(options: CodeIndexOptions): Promise<CodeIndexResult> {
  const warnings: string[] = [];
  const root = path.resolve(options.repoPath);
  const info = await stat(root).catch(() => null);
  if (!info || !info.isDirectory()) throw new Error(`仓库路径不存在或不是目录: ${root}`);

  const { files, skipped: initialSkipped } = await walkFiles(root);
  let skipped = initialSkipped;
  const indexedPaths = new Set(
    files.map((file) => path.relative(root, file).replace(/\\/g, '/')),
  );

  const nodes: KnowledgeNode[] = [];
  const links: KnowledgeBundle['links'] = [];
  const symbolNodes: KnowledgeNode[] = [];
  let fileCount = 0;

  for (const file of files) {
    if (nodes.length >= MAX_NODES || links.length >= MAX_LINKS) {
      warnings.push('节点/关系数达到上限，剩余文件已跳过。');
      break;
    }
    const relativePath = path.relative(root, file).replace(/\\/g, '/');
    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      skipped += 1;
      continue;
    }
    if (content.includes('\u0000')) {
      skipped += 1; // binary despite extension
      continue;
    }
    fileCount += 1;
    const extension = path.extname(relativePath).toLowerCase();
    const { nodes: extracted, symbolNames } = extractSymbols(
      relativePath,
      extension,
      content,
      warnings,
    );
    const fileId = sanitizeIdPart(`f:${relativePath}`);
    const preview = content.slice(0, 1200);
    nodes.push({
      id: fileId,
      name: relativePath,
      aliases: [],
      category: '文件',
      content: symbolNames.length
        ? `${preview}\n\n包含符号: ${symbolNames.slice(0, 40).join(', ')}`
        : preview,
      source: { title: path.basename(relativePath), locator: relativePath },
    });
    for (const symbol of extracted) {
      if (nodes.length >= MAX_NODES) break;
      nodes.push(symbol);
      symbolNodes.push(symbol);
      links.push({ source: symbol.id, target: fileId, relation: '定义于' });
    }
    // Import edges file → file.
    for (const specifier of importSpecifiers(content, extension)) {
      if (links.length >= MAX_LINKS) break;
      const resolved = resolveImport(relativePath, specifier, indexedPaths);
      if (resolved && resolved !== relativePath) {
        links.push({
          source: fileId,
          target: sanitizeIdPart(`f:${resolved}`),
          relation: '导入',
        });
      }
    }
  }

  const { crossRefs, warnings: crossWarnings } = await buildCrossRefs(options.ownerId, [
    ...symbolNodes,
    ...nodes.filter((node) => node.id.startsWith('f:')),
  ]);
  warnings.push(...crossWarnings);

  const bundleId =
    options.bundleId ?? `code-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const bundle = knowledgeBundleSchema.parse({
    version: 1,
    id: bundleId,
    title: options.title?.trim() || path.basename(root) || '代码库',
    kind: 'code',
    reviewStatus: 'reviewed', // deterministic local index; content is the repo itself
    ownerId: options.ownerId,
    nodes,
    links,
    crossRefs,
  });

  return {
    bundle,
    stats: {
      files: fileCount,
      symbols: symbolNodes.length,
      links: links.length,
      crossRefs: crossRefs.length,
      skipped,
    },
    warnings,
  };
}

/** Persist an indexed bundle into the code-repo directory (owner-checked on overwrite). */
export async function saveCodeBundle(bundle: KnowledgeBundle): Promise<string> {
  const { bundles } = await loadKnowledge();
  const existing = bundles.find((item) => item.id === bundle.id);
  if (existing && (!existing.ownerId || existing.ownerId !== bundle.ownerId)) {
    throw new Error('同名代码库属于其他用户，禁止覆盖。');
  }
  return saveKnowledgeBundle(bundle, existing);
}
