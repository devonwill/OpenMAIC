import { splitSqlStatements, type Queryable } from '@openmaic/storage/document/pg';

// 主应用内的 auth 存储（与 owner-materials.ts 同模式）：不动 @openmaic/storage
// 包的导出面，幂等建表由 server-provider 初始化时调用。

export type UserRole = 'teacher' | 'student';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  displayName: string;
  phone: string | null;
}

export interface UserSessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  lastSeenAt: Date;
}

export class EmailTakenError extends Error {
  constructor() { super('email already registered'); this.name = 'EmailTakenError'; }
}

export const AUTH_PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('teacher','student')),
  display_name TEXT NOT NULL,
  phone TEXT,
  wechat_openid TEXT,
  wechat_unionid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions (user_id);

CREATE TABLE IF NOT EXISTS teacher_model_configs (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  config_ciphertext TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function ensureAuthSchema(queryable: Queryable): Promise<void> {
  for (const sql of splitSqlStatements(AUTH_PG_SCHEMA)) {
    await queryable.query(sql);
  }
}

interface UserRow extends Record<string, unknown> {
  id: string; email: string; password_hash: string; role: string;
  display_name: string; phone: string | null;
}

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id, email: row.email, passwordHash: row.password_hash,
    role: row.role as UserRole, displayName: row.display_name, phone: row.phone,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    (error as { code?: unknown }).code === '23505';
}

export async function createUser(
  queryable: Queryable,
  input: { id: string; email: string; passwordHash: string; role: UserRole; displayName: string; phone?: string },
): Promise<void> {
  try {
    await queryable.query(
      `INSERT INTO users (id, email, password_hash, role, display_name, phone)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.id, input.email.trim().toLowerCase(), input.passwordHash,
       input.role, input.displayName, input.phone ?? null],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new EmailTakenError();
    throw error;
  }
}

export async function getUserByEmail(
  queryable: Queryable, email: string,
): Promise<UserRecord | null> {
  const result = await queryable.query<UserRow>(
    `SELECT id, email, password_hash, role, display_name, phone
       FROM users WHERE lower(email) = $1`, [email.trim().toLowerCase()],
  );
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

export async function updateUserProfile(
  queryable: Queryable, userId: string,
  patch: { displayName: string; phone: string | null },
): Promise<void> {
  await queryable.query(
    `UPDATE users SET display_name = $2, phone = $3, updated_at = now() WHERE id = $1`,
    [userId, patch.displayName, patch.phone],
  );
}

/** 会话 + 用户一次 JOIN 取回；过期/不存在返回 null。 */
export async function getSessionWithUser(
  queryable: Queryable, sessionId: string,
): Promise<{ session: UserSessionRecord; user: UserRecord } | null> {
  const result = await queryable.query<UserRow & {
    session_id: string; expires_at: Date; last_seen_at: Date;
  }>(
    `SELECT u.id, u.email, u.password_hash, u.role, u.display_name, u.phone,
            s.id AS session_id, s.expires_at, s.last_seen_at
       FROM user_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`, [sessionId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    session: { id: row.session_id, userId: row.id, expiresAt: new Date(row.expires_at), lastSeenAt: new Date(row.last_seen_at) },
    user: toUser(row),
  };
}

/** 滑动续期：30 天窗口整体前移。 */
export async function touchSession(queryable: Queryable, sessionId: string): Promise<void> {
  await queryable.query(
    `UPDATE user_sessions
        SET last_seen_at = now(), expires_at = now() + interval '30 days'
      WHERE id = $1 AND expires_at > now()`, [sessionId],
  );
}

export async function deleteSession(queryable: Queryable, sessionId: string): Promise<void> {
  await queryable.query(`DELETE FROM user_sessions WHERE id = $1`, [sessionId]);
}

export async function getTeacherModelConfig(
  queryable: Queryable, userId: string,
): Promise<string | null> {
  const result = await queryable.query<{ config_ciphertext: string }>(
    `SELECT config_ciphertext FROM teacher_model_configs WHERE user_id = $1`, [userId],
  );
  return result.rows[0]?.config_ciphertext ?? null;
}

export async function saveTeacherModelConfig(
  queryable: Queryable, userId: string, ciphertext: string,
): Promise<void> {
  await queryable.query(
    `INSERT INTO teacher_model_configs (user_id, config_ciphertext, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE
       SET config_ciphertext = EXCLUDED.config_ciphertext, updated_at = now()`,
    [userId, ciphertext],
  );
}
