import { cookies } from 'next/headers';
import type { Queryable } from '@openmaic/storage/document/pg';
import { createSessionToken } from './session-token';
import { createSession, SESSION_MAX_AGE_SECONDS } from './store';
import { SESSION_COOKIE } from './identity';
import { anonymousCookieSecure } from '@/lib/server/agent-runtime/owner';

export { SESSION_MAX_AGE_SECONDS };

// 与 store 的 UserRecord 字段口径一致（id/email/role/displayName/phone/avatar），
// 对外只暴露视图对象，不把 passwordHash 泄漏到 API 响应里。
export interface AuthUserView {
  id: string; email: string; role: 'teacher' | 'student';
  displayName: string; phone: string | null; avatar: string | null;
}

export function userView(
  id: string, email: string, role: 'teacher' | 'student',
  displayName: string, phone: string | null, avatar: string | null,
): AuthUserView {
  return { id, email, role, displayName, phone, avatar };
}

/**
 * 签发会话行 + HMAC cookie（登录/注册共用）。
 * 库里只存 sessionId，token（sessionId.mac）仅存在于 cookie，泄漏库也拿不到可用会话。
 * SESSION_SECRET 缺失时直接抛错：宁可 500 也不签发无法验签的会话。
 */
export async function setSessionCookie(userId: string, db: Queryable): Promise<void> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  const session = await createSession(db, userId);
  const token = createSessionToken(session.id, secret);
  if (!token) throw new Error('failed to sign session token');
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
    // 与访问码 cookie 同一开关：COOKIE_SECURE=0 的 plain-HTTP 部署必须去掉
    // Secure，否则浏览器拒存、登录假成功。
    secure: anonymousCookieSecure(),
  });
}

/** 清 cookie（登出用）；cookie 名集中在 identity 常量，避免两处漂移。 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
