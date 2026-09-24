import type { UIMessage } from 'ai';
import { readdir, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { knowledgeBundleSchema, type KnowledgeBundle } from './schema';
import { searchKnowledge, formatKnowledgeEvidence } from './retrieval';

export async function loadKnowledge(): Promise<{ bundles: KnowledgeBundle[]; warnings: string[] }> {
  const directory = process.env.KNOWLEDGE_DATA_DIR || path.join(process.cwd(), 'data', 'knowledge');
  const bundles: KnowledgeBundle[] = [];
  const warnings: string[] = [];
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return { bundles, warnings: ['知识目录尚不可用，请检查服务端配置。'] };
  }
  const ids = new Set<string>();
  let totalBytes = 0;
  for (const name of names
    .filter((name) => name.endsWith('.json'))
    .sort()
    .slice(0, 50)) {
    try {
      const filename = path.join(directory, name);
      const stat = await lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20 * 1024 * 1024)
        throw new Error('Invalid file');
      totalBytes += stat.size;
      if (totalBytes > 50 * 1024 * 1024) {
        warnings.push('知识目录超出试点版本的 50 MB 加载上限。');
        break;
      }
      const bundle = knowledgeBundleSchema.parse(JSON.parse(await readFile(filename, 'utf8')));
      if (ids.has(bundle.id)) throw new Error('Duplicate bundle ID');
      ids.add(bundle.id);
      bundles.push(bundle);
    } catch {
      warnings.push(`知识包 ${name} 未通过校验，已跳过。`);
    }
  }
  return { bundles, warnings };
}

export async function getClassroomKnowledge(query: string): Promise<string> {
  if (process.env.KNOWLEDGE_CLASSROOM_ENABLED !== 'true' || !query.trim()) return '';
  try {
    const { bundles } = await loadKnowledge();
    // Imported and demo content must never silently become authoritative classroom context.
    return formatKnowledgeEvidence(
      searchKnowledge(
        bundles.filter((bundle) => bundle.reviewStatus === 'reviewed'),
        query,
        4,
      ),
    );
  } catch {
    return '';
  } // Optional knowledge must not prevent an existing classroom from running.
}

/** Shared by the classic and Pi classroom routes. Leaves stored client messages intact. */
export async function attachClassroomKnowledge<T extends UIMessage>(messages: T[]): Promise<T[]> {
  const index = messages.findLastIndex((message) => message.role === 'user');
  if (index < 0) return messages;
  const parts = messages[index].parts ?? [];
  const question = parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ');
  const evidence = await getClassroomKnowledge(question);
  if (!evidence) return messages;
  return messages.map((message, i) =>
    i === index
      ? { ...message, parts: [...parts, { type: 'text' as const, text: evidence }] }
      : message,
  );
}
