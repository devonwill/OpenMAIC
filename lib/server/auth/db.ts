import type { Queryable } from '@openmaic/storage/document/pg';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

// auth 复用 persistence 的共享 pool（globalThis memo，单连接池），不另开连接。
// DATABASE_URL 未配置 → null，路由层据此返回 503（无库时用户体系不可用）。
export async function getAuthDb(): Promise<Queryable | null> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  const provider = await getServerPersistenceProvider(url);
  return provider.pool;
}
