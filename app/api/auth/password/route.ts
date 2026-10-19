import { apiError, apiSuccess } from '@/lib/server/api-response';
import { hashPassword, verifyPassword } from '@/lib/server/auth/password';
import { getAuthDb } from '@/lib/server/auth/db';
import { updateUserPassword } from '@/lib/server/auth/store';
import { currentUser } from '@/lib/server/auth/current-user';
import { createLogger } from '@/lib/logger';

const log = createLogger('AuthPassword');

// 与注册保持同一套规则；不能更弱，否则变成"短密码绕过登录强度"的旁路。
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

export async function POST(request: Request) {
  const found = await currentUser();
  if (!found) return apiError('UNAUTHENTICATED', 401, 'login required');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'invalid JSON body');
  }
  const { currentPassword, newPassword } = (body ?? {}) as Record<string, unknown>;
  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    return apiError('INVALID_REQUEST', 400, 'currentPassword is required');
  }
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    return apiError(
      'INVALID_REQUEST',
      400,
      `newPassword must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    return apiError(
      'INVALID_REQUEST',
      400,
      `newPassword must be at most ${MAX_PASSWORD_LENGTH} characters`,
    );
  }
  if (newPassword === currentPassword) {
    return apiError('INVALID_REQUEST', 400, 'new password must differ from current password');
  }

  const db = await getAuthDb();
  if (!db) return apiError('INTERNAL_ERROR', 503, 'user accounts require DATABASE_URL');

  // 校验旧密码：失败返回 INVALID_CREDENTIALS 而不是 INVALID_REQUEST，
  // 让客户端能区分"当前密码错"与"格式不合规"。
  const ok = await verifyPassword(currentPassword, found.user.passwordHash);
  if (!ok) {
    return apiError('INVALID_CREDENTIALS', 403, 'current password is incorrect');
  }

  try {
    const newHash = await hashPassword(newPassword);
    await updateUserPassword(db, found.user.id, newHash);
    // 仅刷新当前会话（保活当前浏览器）：吊销其他会话会强制用户在每个设备重登，
    // 跟"自助重置密码"的预期不符 —— 旧设备若仍在线将保留旧密码的会话直到过期/登出。
    return apiSuccess({ updatedAt: new Date().toISOString() });
  } catch (error) {
    log.error('Failed to update password:', error);
    return apiError('INTERNAL_ERROR', 500, 'failed to update password');
  }
}