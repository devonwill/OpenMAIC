import { randomUUID, timingSafeEqual } from 'node:crypto';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { hashPassword } from '@/lib/server/auth/password';
import { getAuthDb } from '@/lib/server/auth/db';
import { createUser, EmailTakenError } from '@/lib/server/auth/store';
import { toRegistrationInput, validateRegistration } from '@/lib/server/auth/validation';
import { createLogger } from '@/lib/logger';

const log = createLogger('AuthRegister');

export async function POST(request: Request) {
  const db = await getAuthDb();
  if (!db) {
    // 无库时用户体系整体不可用，503 而不是 500：让客户端知道是服务端缺配置。
    return apiError('INTERNAL_ERROR', 503, 'user accounts require DATABASE_URL');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'invalid JSON body');
  }
  const invalid = validateRegistration(body);
  if (invalid) return apiError('INVALID_REQUEST', 400, invalid);

  const input = toRegistrationInput(body as Record<string, unknown>);

  // 教师邀请码：固定环境变量，常数时间比较，避免逐字节比对泄漏邀请码前缀。
  if (input.role === 'teacher') {
    const expected = process.env.TEACHER_INVITE_CODE;
    if (!expected || input.inviteCode === null) {
      return apiError('INVALID_CREDENTIALS', 403, 'a valid invite code is required for teacher registration');
    }
    const a = Buffer.from(input.inviteCode);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return apiError('INVALID_CREDENTIALS', 403, 'invalid invite code');
    }
  }

  try {
    const userId = randomUUID();
    const passwordHash = await hashPassword(input.password);
    await createUser(db, {
      id: userId, email: input.email, passwordHash,
      role: input.role, displayName: input.displayName, phone: input.phone ?? undefined,
    });

    // 注册即登录：直接签发会话。
    const { setSessionCookie, userView } = await import('@/lib/server/auth/session-cookie');
    await setSessionCookie(userId, db);
    return apiSuccess({ user: userView(userId, input.email, input.role, input.displayName, input.phone) }, 201);
  } catch (error) {
    if (error instanceof EmailTakenError) {
      // 并发注册撞唯一索引时也会走到这里，与预查重复邮箱共用同一响应。
      return apiError('INVALID_REQUEST', 409, 'this email is already registered');
    }
    log.error('Registration failed:', error);
    return apiError('INTERNAL_ERROR', 500, 'registration failed');
  }
}
