import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getAuthDb } from '@/lib/server/auth/db';
import { updateUserProfile } from '@/lib/server/auth/store';
import { userView } from '@/lib/server/auth/session-cookie';
import { currentUser } from '@/lib/server/auth/current-user';
import { isValidAvatar } from '@/lib/auth-client';

export async function GET() {
  let found;
  try {
    found = await currentUser({ throwOnUnavailable: true });
  } catch {
    return apiError('INTERNAL_ERROR', 503, 'Authentication service unavailable');
  }
  // 未登录返回 200 + {user:null}：客户端按「游客」处理，与访问码/匿名路径共存。
  if (!found) return apiSuccess({ user: null });
  const { user } = found;
  return apiSuccess({
    user: userView(
      user.id, user.email, user.role, user.displayName, user.phone, user.avatar,
    ),
  });
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
  // 只允许改 displayName/phone/avatar：邮箱是登录标识与唯一索引，改邮箱需走验证流程，这里不开放。
  const { displayName, phone, avatar } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof displayName !== 'string' ||
    displayName.trim().length === 0 ||
    displayName.trim().length > 32
  ) {
    return apiError('INVALID_REQUEST', 400, 'displayName must be 1-32 characters');
  }
  const phoneValue = phone === null || phone === undefined || phone === '' ? null : phone;
  if (
    phoneValue !== null &&
    (typeof phoneValue !== 'string' || !/^1[3-9]\d{9}$/.test(phoneValue))
  ) {
    return apiError('INVALID_REQUEST', 400, 'phone must be a valid Chinese mobile number');
  }
  // avatar：null 表示清除；字符串必须是允许的形式（内置路径 / http(s) URL / data URL），
  // 长度上限由 isValidAvatar 统一约束，避免把超大 base64 直接写进数据库。
  const avatarValue: string | null =
    avatar === null || avatar === undefined || avatar === ''
      ? null
      : typeof avatar === 'string' && isValidAvatar(avatar)
        ? avatar
        : undefined as never;
  if (avatarValue === (undefined as never)) {
    return apiError('INVALID_REQUEST', 400, 'avatar must be a built-in path, http(s) URL, or small data URL');
  }

  const db = await getAuthDb();
  if (!db) return apiError('INTERNAL_ERROR', 503, 'user accounts require DATABASE_URL');
  await updateUserProfile(db, found.user.id, {
    displayName: displayName.trim(),
    phone: phoneValue,
    avatar: avatarValue,
  });
  return apiSuccess({
    user: userView(
      found.user.id,
      found.user.email,
      found.user.role,
      displayName.trim(),
      phoneValue,
      avatarValue,
    ),
  });
}
