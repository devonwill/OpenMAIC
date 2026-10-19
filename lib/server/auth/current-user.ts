import { cookies } from 'next/headers';
import { createLogger } from '@/lib/logger';
import { verifySessionToken } from './session-token';
import { getAuthDb } from './db';
import { getSessionWithUser } from './store';
import type { UserRecord, UserSessionRecord } from './store';
import { SESSION_COOKIE } from './identity';

const log = createLogger('AuthCurrentUser');

/**
 * 解析当前登录用户（me / model-config 等路由复用，避免从 route 文件横向 import）。
 * 返回 store 的 {session, user} 原始记录；未登录/无库/验签失败一律 null，
 * 与 identity.resolveAuthenticatedOwnerId 同一语义——认证故障不升级成 API 500。
 * 但查库异常记 warn 而不是静默吞掉，便于排查库故障。
 */
export async function currentUser(
  options: { throwOnUnavailable?: boolean } = {},
): Promise<{ session: UserSessionRecord; user: UserRecord } | null> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sessionId = token ? verifySessionToken(token, secret) : null;
  if (!sessionId) return null;
  try {
    const db = await getAuthDb();
    if (!db) {
      if (options.throwOnUnavailable) throw new Error('Authentication storage unavailable');
      return null;
    }
    return await getSessionWithUser(db, sessionId);
  } catch (error) {
    log.warn('Failed to resolve current user:', error);
    if (options.throwOnUnavailable) throw error;
    return null;
  }
}
