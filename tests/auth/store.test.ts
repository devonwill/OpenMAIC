import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createUser, deleteSession, ensureAuthSchema, getSessionWithUser,
  getTeacherModelConfig, getUserByEmail, saveTeacherModelConfig,
  touchSession, updateUserProfile, EmailTakenError,
} from '@/lib/server/auth/store';

class PGlitePool {
  constructor(readonly db: PGlite) {}
  query<TRow>(text: string, params?: unknown[]) { return this.db.query<TRow>(text, params); }
}

let db: PGlite;
let pool: PGlitePool;

beforeEach(async () => {
  db = new PGlite();
  pool = new PGlitePool(db);
  await ensureAuthSchema(pool);
});
afterEach(async () => { await db.close(); });

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'Teacher@Example.com',
  passwordHash: 'ab'.repeat(16) + '$' + 'cd'.repeat(32),
  role: 'teacher' as const,
  displayName: '王老师',
  phone: '13800138000',
};

describe('auth store', () => {
  it('creates a user and finds it case-insensitively', async () => {
    await createUser(pool, USER);
    const found = await getUserByEmail(pool, 'teacher@example.com');
    expect(found?.id).toBe(USER.id);
    expect(found?.role).toBe('teacher');
  });

  it('rejects duplicate emails (23505 → EmailTakenError)', async () => {
    await createUser(pool, USER);
    await expect(
      createUser(pool, { ...USER, id: '22222222-2222-4222-8222-222222222222' }),
    ).rejects.toBeInstanceOf(EmailTakenError);
  });

  it('session round-trip: create → read → touch → delete', async () => {
    await createUser(pool, USER);
    const sid = '33333333-3333-4333-8333-333333333333';
    await pool.query(
      `INSERT INTO user_sessions (id, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
      [sid, USER.id],
    );
    const live = await getSessionWithUser(pool, sid);
    // createUser 将邮箱归一化为小写存储（大小写不敏感唯一索引的配套设计）
    expect(live?.user.email).toBe(USER.email.toLowerCase());
    expect(live?.session.id).toBe(sid);

    await touchSession(pool, sid);
    // 已过期会话读不到
    await pool.query(`UPDATE user_sessions SET expires_at = now() - interval '1s' WHERE id = $1`, [sid]);
    expect(await getSessionWithUser(pool, sid)).toBeNull();
    // 吊销（登出）
    await pool.query(`UPDATE user_sessions SET expires_at = now() + interval '1 day' WHERE id = $1`, [sid]);
    await deleteSession(pool, sid);
    expect(await getSessionWithUser(pool, sid)).toBeNull();
  });

  it('teacher model config upsert round-trip', async () => {
    await createUser(pool, USER);
    expect(await getTeacherModelConfig(pool, USER.id)).toBeNull();
    await saveTeacherModelConfig(pool, USER.id, 'v1.AAAA.BBBB.CCCC');
    await saveTeacherModelConfig(pool, USER.id, 'v1.DDDD.EEEE.FFFF');
    expect(await getTeacherModelConfig(pool, USER.id)).toBe('v1.DDDD.EEEE.FFFF');
  });

  it('updates profile fields', async () => {
    await createUser(pool, USER);
    await updateUserProfile(pool, USER.id, { displayName: '王老师2', phone: '13900139000', avatar: null });
    const found = await getUserByEmail(pool, USER.email);
    expect(found?.displayName).toBe('王老师2');
    expect(found?.phone).toBe('13900139000');
  });
});
