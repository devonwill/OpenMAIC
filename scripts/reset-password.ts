/**
 * 管理员密码重置：无邮件服务时的忘记密码处置路径（spec §10）。
 * 用法：pnpm tsx scripts/reset-password.ts user@example.com newPassword123
 */
import { Pool } from 'pg';
import type { Queryable } from '@openmaic/storage/document/pg';
import { hashPassword } from '../lib/server/auth/password';
import { getUserByEmail, updateUserPassword, ensureAuthSchema } from '../lib/server/auth/store';

/**
 * 重置核心（CLI 与单测共用）：改哈希后吊销该用户全部会话，防止旧会话残留。
 * 返回 false 表示邮箱不存在——由调用方决定报错文案与退出码。
 */
export async function resetPasswordForEmail(
  queryable: Queryable, email: string, newPassword: string,
): Promise<boolean> {
  const user = await getUserByEmail(queryable, email);
  if (!user) return false;
  await updateUserPassword(queryable, user.id, await hashPassword(newPassword));
  await queryable.query('DELETE FROM user_sessions WHERE user_id = $1', [user.id]);
  return true;
}

async function main(): Promise<void> {
  const [email, newPassword] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!email || !newPassword || !url) {
    process.stderr.write('usage: DATABASE_URL=... pnpm tsx scripts/reset-password.ts <email> <newPassword>\n');
    process.exitCode = 1;
    return;
  }
  if (newPassword.length < 8) {
    process.stderr.write('password must be at least 8 characters\n');
    process.exitCode = 1;
    return;
  }
  const pool = new Pool({ connectionString: url });
  try {
    await ensureAuthSchema(pool);
    const done = await resetPasswordForEmail(pool, email, newPassword);
    if (!done) {
      process.stderr.write(`no user with email ${email}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`password reset for ${email}\n`);
  } finally {
    await pool.end();
  }
}

// 只有直接执行本脚本时才跑 CLI：单测会导入上面的核心函数，不能触发 CLI 副作用。
// tsx 按 CommonJS 运行本文件（package.json 无 "type":"module"），require.main 可判；
// typeof 前缀保证在 vitest 的 ESM 作用域里引用 require 不报错。
const isDirectRun =
  (typeof require !== 'undefined' && require.main === module) ||
  process.argv[1]?.endsWith('reset-password.ts') === true;
if (isDirectRun) {
  void main().catch((error: unknown) => {
    // 连库/更新失败不静默吞：打印原因并以非 0 退出，方便脚本化检测
    process.stderr.write(`reset failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
