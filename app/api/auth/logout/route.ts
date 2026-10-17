import { cookies } from 'next/headers';
import { apiSuccess } from '@/lib/server/api-response';
import { getAuthDb } from '@/lib/server/auth/db';
import { deleteSession } from '@/lib/server/auth/store';
import { verifySessionToken } from '@/lib/server/auth/session-token';
import { clearSessionCookie } from '@/lib/server/auth/session-cookie';
import { SESSION_COOKIE } from '@/lib/server/auth/identity';
import { createLogger } from '@/lib/logger';

const log = createLogger('AuthLogout');

export async function POST() {
  const secret = process.env.SESSION_SECRET;
  if (secret) {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    const sessionId = token ? verifySessionToken(token, secret) : null;
    if (sessionId) {
      const db = await getAuthDb();
      // 吊销失败不阻断登出：cookie 照清，宁可留一行过期会话也不把用户卡在登录态。
      // 但记 warn 而不是静默吞掉，便于排查库故障。
      if (db) await deleteSession(db, sessionId).catch((error) => log.warn('Failed to revoke session:', error));
    }
    await clearSessionCookie();
  }
  return apiSuccess({ loggedOut: true });
}
