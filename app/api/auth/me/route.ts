import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getAuthDb } from '@/lib/server/auth/db';
import { updateUserProfile } from '@/lib/server/auth/store';
import { userView } from '@/lib/server/auth/session-cookie';
import { currentUser } from '@/lib/server/auth/current-user';

export async function GET() {
  const found = await currentUser();
  // 未登录返回 200 + {user:null}：客户端按「游客」处理，与访问码/匿名路径共存。
  if (!found) return apiSuccess({ user: null });
  const { user } = found;
  return apiSuccess({ user: userView(user.id, user.email, user.role, user.displayName, user.phone) });
}

export async function PATCH(request: Request) {
  const found = await currentUser();
  if (!found) return apiError('UNAUTHENTICATED', 401, 'login required');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'invalid JSON body');
  }
  // 只允许改 displayName/phone：邮箱是登录标识与唯一索引，改邮箱需走验证流程，这里不开放。
  const { displayName, phone } = (body ?? {}) as Record<string, unknown>;
  if (typeof displayName !== 'string' || displayName.trim().length === 0 || displayName.trim().length > 32) {
    return apiError('INVALID_REQUEST', 400, 'displayName must be 1-32 characters');
  }
  const phoneValue = phone === null || phone === undefined || phone === ''
    ? null
    : phone;
  if (phoneValue !== null && (typeof phoneValue !== 'string' || !/^1[3-9]\d{9}$/.test(phoneValue))) {
    return apiError('INVALID_REQUEST', 400, 'phone must be a valid Chinese mobile number');
  }

  const db = await getAuthDb();
  if (!db) return apiError('INTERNAL_ERROR', 503, 'user accounts require DATABASE_URL');
  await updateUserProfile(db, found.user.id, { displayName: displayName.trim(), phone: phoneValue });
  return apiSuccess({ user: userView(found.user.id, found.user.email, found.user.role, displayName.trim(), phoneValue) });
}
