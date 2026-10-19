import { randomUUID } from 'node:crypto';
import {
  readdir,
  readFile,
  lstat,
  mkdir,
  rename,
  unlink,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { knowledgeBundleSchema, upgradeBundleToV2, type KnowledgeBundle } from './schema';

export class KnowledgeStorageError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function knowledgeDir(): string {
  return path.resolve(
    process.env.KNOWLEDGE_DATA_DIR || path.join(process.cwd(), 'data', 'knowledge'),
  );
}
function codeDir(): string {
  return path.resolve(process.env.CODE_DATA_DIR || path.join(process.cwd(), 'data', 'code-repos'));
}

async function readBundleDirectory(directory: string): Promise<{
  bundles: KnowledgeBundle[];
  warnings: string[];
}> {
  const bundles: KnowledgeBundle[] = [];
  const warnings: string[] = [];
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { bundles, warnings };
    throw error;
  }
  const ids = new Set<string>();
  let totalBytes = 0;
  for (const name of names.filter((name) => name.endsWith('.json')).sort()) {
    try {
      const filename = path.join(directory, name);
      const stat = await lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20 * 1024 * 1024)
        throw new Error('Invalid file');
      totalBytes += stat.size;
      if (totalBytes > 50 * 1024 * 1024) {
        throw new KnowledgeStorageError('知识库目录超过 50 MB 容量上限，请清理或迁移数据。', 413);
      }
      const parsed = knowledgeBundleSchema.parse(JSON.parse(await readFile(filename, 'utf8')));
      const bundle = upgradeBundleToV2(parsed, stat.mtime.toISOString());
      if (ids.has(bundle.id)) throw new Error('Duplicate bundle ID');
      ids.add(bundle.id);
      bundles.push(bundle);
    } catch (error) {
      if (error instanceof KnowledgeStorageError) throw error;
      warnings.push(`知识包 ${name} 未通过校验，已跳过。`);
    }
  }
  return { bundles, warnings };
}

export async function loadKnowledge(): Promise<{ bundles: KnowledgeBundle[]; warnings: string[] }> {
  const directory = path.resolve(
    process.env.KNOWLEDGE_DATA_DIR || path.join(process.cwd(), 'data', 'knowledge'),
  );
  const codeDirectory = path.resolve(
    process.env.CODE_DATA_DIR || path.join(process.cwd(), 'data', 'code-repos'),
  );
  const knowledgePart = await readBundleDirectory(directory);
  const codePart =
    codeDirectory === directory
      ? { bundles: [], warnings: [] }
      : await readBundleDirectory(codeDirectory);
  const all = [...knowledgePart.bundles, ...codePart.bundles];
  if (new Set(all.map((bundle) => bundle.id)).size !== all.length) {
    throw new KnowledgeStorageError('知识库与代码库存在重复 id，请先修复数据。', 409);
  }
  return {
    bundles: all,
    warnings: [...knowledgePart.warnings, ...codePart.warnings],
  };
}

/**
 * Short, cross-process commit lock. Never steal a lock from a possibly live writer.
 * After a hard process crash, an operator must remove .write-lock only after
 * stopping all writers. Failing closed is preferable to silently losing edits.
 */
async function withWriteLock<T>(body: () => Promise<T>): Promise<T> {
  const directory = knowledgeDir();
  await mkdir(directory, { recursive: true });
  const lock = path.join(directory, '.write-lock');
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new KnowledgeStorageError('知识库正在保存，请稍后重试。', 409);
    }
    throw error;
  }
  try {
    return await body();
  } finally {
    await rmdir(lock);
  }
}

async function findBundle(
  id: string,
): Promise<{ filename: string; bundle: KnowledgeBundle } | null> {
  for (const directory of new Set([knowledgeDir(), codeDir()])) {
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const name of names.filter((name) => name.endsWith('.json'))) {
      const filename = path.join(directory, name);
      const stat = await lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20 * 1024 * 1024) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(filename, 'utf8'));
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
      if (raw && typeof raw === 'object' && 'id' in raw && raw.id === id) {
        return {
          filename,
          bundle: upgradeBundleToV2(knowledgeBundleSchema.parse(raw), stat.mtime.toISOString()),
        };
      }
    }
  }
  return null;
}

function assertExpected(current: KnowledgeBundle | undefined, expected?: KnowledgeBundle): void {
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new KnowledgeStorageError('资料已被其他请求修改，请刷新后重试。', 409);
  }
}

/** expected is the untouched snapshot read before editing; absent means create-only. */
export async function saveKnowledgeBundle(
  bundle: KnowledgeBundle,
  expected?: KnowledgeBundle,
): Promise<string> {
  const parsed = knowledgeBundleSchema.parse(bundle);
  const content = JSON.stringify(parsed, null, 2);
  const bytes = Buffer.byteLength(content);
  if (bytes > 20 * 1024 * 1024) throw new KnowledgeStorageError('知识包超过 20 MB 上限。', 413);
  return withWriteLock(async () => {
    const current = await findBundle(parsed.id);
    assertExpected(current?.bundle, expected);
    const directory = current
      ? path.dirname(current.filename)
      : parsed.kind === 'code'
        ? codeDir()
        : knowledgeDir();
    await mkdir(directory, { recursive: true });
    const filename = current?.filename ?? path.join(directory, `${parsed.id}.json`);
    let totalBytes = bytes;
    for (const name of await readdir(directory)) {
      const file = path.join(directory, name);
      if (!name.endsWith('.json') || file === filename) continue;
      const stat = await lstat(file);
      if (stat.isFile()) totalBytes += stat.size;
    }
    if (totalBytes > 50 * 1024 * 1024)
      throw new KnowledgeStorageError('知识库目录超过 50 MB 容量上限。', 413);
    const temporary = path.join(directory, `.${parsed.id}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await rename(temporary, filename);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    return filename;
  });
}

export async function deleteKnowledgeBundle(expected: KnowledgeBundle): Promise<void> {
  await withWriteLock(async () => {
    const current = await findBundle(expected.id);
    assertExpected(current?.bundle, expected);
    await unlink(current!.filename);
  });
}
