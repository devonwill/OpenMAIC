import { verifySessionToken } from './session-token';
import { getAuthDb } from './db';
import { getSessionWithUser, touchSession } from './store';

export const SESSION_COOKIE = 'openmaic_session';

function readCookie(headers: Headers, name: string): string | undefined {
  const encoded = headers.get('cookie');
  if (!encoded) return undefined;
  for (const item of encoded.split(';')) {
    const sep = item.indexOf('=');
    if (sep < 0 || item.slice(0, sep).trim() !== name) continue;
    try { return decodeURIComponent(item.slice(sep + 1).trim()); } catch { return undefined; }
  }
  return undefined;
}

// last_seen_at 距今超过该间隔才写库续期，避免每个请求都 UPDATE。
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 从 session cookie 解析登录用户并返回 `user:{id}` owner。
 * 任何一步失败都回退 undefined（匿名/访问码路径照旧），绝不让认证
 * 故障升级成 API 500。
 */
export async function resolveAuthenticatedOwnerId(
  req: Pick<Request, 'headers'>,
): Promise<string | undefined> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return undefined;
  const token = readCookie(req.headers, SESSION_COOKIE);
  if (!token) return undefined;

  const sessionId = verifySessionToken(token, secret);
  if (!sessionId) return undefined;

  try {
    const db = await getAuthDb();
    if (!db) return undefined;
    const found = await getSessionWithUser(db, sessionId);
    if (!found) return undefined;
    if (Date.now() - found.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await touchSession(db, sessionId).catch(() => {});
    }
    return `user:${found.user.id}`;
  } catch {
    return undefined;
  }
}
