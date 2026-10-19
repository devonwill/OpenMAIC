import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyPassword } from '@/lib/server/auth/password';
import {
  createUser,
  ensureAuthSchema,
  getSessionWithUser,
  getUserByEmail,
} from '@/lib/server/auth/store';
import { resetPasswordForEmail } from '@/scripts/reset-password';

class PGlitePool {
  constructor(readonly db: PGlite) {}
  async connect() {
    return { query: this.query.bind(this), release() {} };
  }
  query<TRow>(text: string, params?: unknown[]) {
    return this.db.query<TRow>(text, params);
  }
}

let db: PGlite;
let pool: PGlitePool;

beforeEach(async () => {
  db = new PGlite();
  pool = new PGlitePool(db);
  await ensureAuthSchema(pool);
});
afterEach(async () => {
  await db.close();
});

const OLD_HASH = 'ab'.repeat(16) + '$' + 'cd'.repeat(32);
const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'reset@example.com',
  passwordHash: OLD_HASH,
  role: 'student' as const,
  displayName: '张三',
};
const OTHER = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'other@example.com',
  passwordHash: OLD_HASH,
  role: 'teacher' as const,
  displayName: '李四',
};

async function insertSession(id: string, userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO user_sessions (id, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
    [id, userId],
  );
}

describe('admin password reset (scripts/reset-password.ts)', () => {
  it('reports "not found" for an unknown email without touching the DB', async () => {
    expect(await resetPasswordForEmail(pool, 'nobody@example.com', 'brandNewPass123')).toBe(false);
  });

  it('updates the hash and revokes every session of that user only', async () => {
    await createUser(pool, USER);
    await createUser(pool, OTHER);
    await insertSession('33333333-3333-4333-8333-333333333333', USER.id);
    await insertSession('44444444-4444-4444-8444-444444444444', USER.id);
    await insertSession('55555555-5555-4555-8555-555555555555', OTHER.id);

    expect(await resetPasswordForEmail(pool, USER.email, 'brandNewPass123')).toBe(true);

    // 新密码生效、旧哈希作废
    const found = await getUserByEmail(pool, USER.email);
    expect(found?.passwordHash).not.toBe(OLD_HASH);
    expect(await verifyPassword('brandNewPass123', found!.passwordHash)).toBe(true);
    // 邮箱大小写不敏感命中（与登录口径一致）
    expect(await resetPasswordForEmail(pool, 'RESET@example.com', 'anotherPass456')).toBe(true);

    // 该用户两条会话全部吊销
    expect(await getSessionWithUser(pool, '33333333-3333-4333-8333-333333333333')).toBeNull();
    expect(await getSessionWithUser(pool, '44444444-4444-4444-8444-444444444444')).toBeNull();
    // 其他用户会话不受影响
    expect(await getSessionWithUser(pool, '55555555-5555-4555-8555-555555555555')).not.toBeNull();

    // 资料字段不被改动
    expect(found?.displayName).toBe(USER.displayName);
    expect(found?.role).toBe(USER.role);
  });
  it('rolls the password back if session revocation fails and releases the client', async () => {
    await createUser(pool, USER);
    await insertSession('33333333-3333-4333-8333-333333333333', USER.id);
    const release = vi.fn();
    const failingPool = {
      query: pool.query.bind(pool),
      async connect() {
        return {
          query: async <T>(sql: string, params?: unknown[]) => {
            if (sql.startsWith('DELETE FROM user_sessions'))
              throw new Error('revocation unavailable');
            return pool.query<T>(sql, params);
          },
          release,
        };
      },
    };
    await expect(resetPasswordForEmail(failingPool, USER.email, 'newPassword123')).rejects.toThrow(
      'revocation unavailable',
    );
    expect((await getUserByEmail(pool, USER.email))?.passwordHash).toBe(OLD_HASH);
    expect(await getSessionWithUser(pool, '33333333-3333-4333-8333-333333333333')).not.toBeNull();
    expect(release).toHaveBeenCalledOnce();
  });
});
