import { apiError, apiSuccess } from '@/lib/server/api-response';
import { verifyPassword } from '@/lib/server/auth/password';
import { getAuthDb } from '@/lib/server/auth/db';
import { getUserByEmail } from '@/lib/server/auth/store';
import { setSessionCookie, userView } from '@/lib/server/auth/session-cookie';
import { clientIdentity, isTrustedProxyIdentity } from '@/lib/server/client-identity';
import { AccessCodeAttemptLimiter } from '@/lib/server/attempt-limiter';
import { createLogger } from '@/lib/logger';

const log = createLogger('AuthLogin');
// 与 access-code 路由同一策略：只有可信代理身份才计数；非可信身份不设共享预算，
// 避免单个攻击者把共享配额耗尽锁死所有人。
const loginAttemptLimiter = new AccessCodeAttemptLimiter();

function readEmailPassword(body: unknown): { email: string; password: string } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || typeof password !== 'string') return null;
  return { email, password };
}

export async function POST(request: Request) {
  const db = await getAuthDb();
  if (!db) return apiError('INTERNAL_ERROR', 503, 'user accounts require DATABASE_URL');
  if (!process.env.SESSION_SECRET) {
    return apiError('INTERNAL_ERROR', 503, 'SESSION_SECRET is not configured');
  }

  // 先占坑再解析 body：畸形请求同样消耗配额，与 access-code 路由的语义一致。
  const trusted = isTrustedProxyIdentity();
  const identity = clientIdentity(request);
  const limit = loginAttemptLimiter.consume(identity, trusted);
  if (limit.limited) {
    const response = apiError('RATE_LIMITED', 429, 'Too many login attempts');
    response.headers.set('Retry-After', String(limit.retryAfterSeconds));
    return response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'invalid JSON body');
  }
  const credentials = readEmailPassword(body);
  if (!credentials) return apiError('INVALID_REQUEST', 400, 'email and password are required');

  try {
    const user = await getUserByEmail(db, credentials.email);
    const ok = user ? await verifyPassword(credentials.password, user.passwordHash) : false;
    if (!user || !ok) {
      // 未知邮箱与错误密码返回完全一致的响应，不泄露邮箱是否已注册。
      return apiError('INVALID_CREDENTIALS', 401, 'invalid email or password');
    }
    loginAttemptLimiter.recordSuccess(identity, trusted);
    await setSessionCookie(user.id, db);
    return apiSuccess({ user: userView(user.id, user.email, user.role, user.displayName, user.phone) });
  } catch (error) {
    log.error('Login failed:', error);
    return apiError('INTERNAL_ERROR', 500, 'login failed');
  }
}
