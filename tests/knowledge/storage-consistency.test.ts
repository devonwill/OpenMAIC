import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createEmptyLibrary } from '@/lib/knowledge/library-store';
import { saveKnowledgeBundle, deleteKnowledgeBundle, loadKnowledge } from '@/lib/knowledge/storage';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'knowledge-storage-'));
  vi.stubEnv('KNOWLEDGE_DATA_DIR', directory);
  vi.stubEnv('CODE_DATA_DIR', path.join(directory, 'code'));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
const library = (id = 'library') => createEmptyLibrary({ id, title: id, ownerId: 'user:one' });

describe('knowledge storage consistency', () => {
  it('allows only one concurrent writer for the same snapshot and leaves valid JSON', async () => {
    await saveKnowledgeBundle(library());
    const original = (await loadKnowledge()).bundles[0];
    const writes = await Promise.allSettled([
      saveKnowledgeBundle({ ...original, title: 'first' }, original),
      saveKnowledgeBundle({ ...original, title: 'second' }, original),
    ]);
    expect(writes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(writes.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(['first', 'second']).toContain(
      JSON.parse(await readFile(path.join(directory, 'library.json'), 'utf8')).title,
    );
    await expect(
      saveKnowledgeBundle({ ...original, title: 'stale' }, original),
    ).rejects.toMatchObject({ status: 409 });
    expect(await readdir(directory)).toEqual(['library.json']);
  });
  it('preserves legacy filenames and does not resurrect deleted snapshots', async () => {
    await saveKnowledgeBundle(library());
    await rename(path.join(directory, 'library.json'), path.join(directory, 'legacy.json'));
    const original = (await loadKnowledge()).bundles[0];
    await saveKnowledgeBundle({ ...original, title: 'edited' }, original);
    expect(await readdir(directory)).toEqual(['legacy.json']);
    await expect(deleteKnowledgeBundle(original)).rejects.toMatchObject({ status: 409 });
    const latest = (await loadKnowledge()).bundles[0];
    await deleteKnowledgeBundle(latest);
    await expect(
      saveKnowledgeBundle({ ...latest, title: 'resurrected' }, latest),
    ).rejects.toMatchObject({ status: 409 });
    expect((await loadKnowledge()).bundles).toHaveLength(0);
  });
  it('loads more than 50 existing files instead of silently hiding later libraries', async () => {
    await Promise.all(
      Array.from({ length: 51 }, (_, i) =>
        writeFile(
          path.join(directory, `library-${i}.json`),
          JSON.stringify(library(`library-${i}`)),
        ),
      ),
    );
    expect((await loadKnowledge()).bundles).toHaveLength(51);
  });
  it('rejects duplicate creates, but an unrelated malformed JSON does not block a valid save', async () => {
    await writeFile(path.join(directory, 'broken.json'), '{invalid');
    await saveKnowledgeBundle(library());
    await expect(saveKnowledgeBundle(library())).rejects.toMatchObject({ status: 409 });
    expect((await loadKnowledge()).warnings).toHaveLength(1);
  });
  it('rejects an oversized update without changing the stored file', async () => {
    await saveKnowledgeBundle(library());
    const original = (await loadKnowledge()).bundles[0];
    const docs = Array.from({ length: 45 }, (_, i) => ({
      id: `doc-${i}`,
      title: 'doc',
      filename: 'doc.txt',
      uploadedAt: new Date().toISOString(),
      nodeCount: 0,
      content: 'x'.repeat(500_000),
    }));
    await expect(
      saveKnowledgeBundle({ ...original, documents: docs }, original),
    ).rejects.toMatchObject({ status: 413 });
    expect((await loadKnowledge()).bundles[0]).toEqual(original);
  });
});
