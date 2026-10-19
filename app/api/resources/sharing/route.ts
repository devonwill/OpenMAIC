import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/server/auth/current-user';
import { getAuthDb } from '@/lib/server/auth/db';
import { loadKnowledge, saveKnowledgeBundle, KnowledgeStorageError } from '@/lib/knowledge/storage';
import { readMediaPolicy, saveMediaPolicy } from '@/lib/sharing/media-store';
import type { ResourcePolicy } from '@/lib/sharing/policy';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
const targetSchema = z.object({ kind: z.enum(['knowledge', 'asset', 'material']), id: z.string().min(1).max(180) });
const updateSchema = targetSchema.extend({
  visibility: z.enum(['private', 'public']),
  studentEmails: z.array(z.string().trim().email().max(254)).max(100).default([]),
});
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

async function handle(request: NextRequest, update: boolean) {
  try {
    const auth = await currentUser({ throwOnUnavailable: true });
    if (!auth) return reply({ error: '请先登录' }, 401);
    if (auth.user.role !== 'teacher') return reply({ error: '仅教师可以管理资源分享' }, 403);
    const db = await getAuthDb();
    if (!db) return reply({ error: '账号服务暂不可用' }, 503);
    const ownerId = `user:${auth.user.id}`;
    const input = update ? updateSchema.parse(await request.json()) : targetSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const bundle = input.kind === 'knowledge' ? (await loadKnowledge()).bundles.find((item) => item.id === input.id) : undefined;
    const policy: ResourcePolicy | null | undefined = input.kind === 'knowledge' ? bundle : await readMediaPolicy(db, input.kind, input.id);
    if (!policy || policy.ownerId !== ownerId) return reply({ error: '资源不存在或无权管理' }, 404);
    if (update) {
      const patch = updateSchema.parse(input);
      const emails = [...new Set(patch.studentEmails.map((email) => email.toLowerCase()))];
      const students = emails.length ? (await db.query<{ id: string; email: string; display_name: string }>(
        `SELECT id,email,display_name FROM users WHERE role='student' AND lower(email)=ANY($1::text[])`, [emails])).rows : [];
      if (students.length !== emails.length) return reply({ error: '部分邮箱未注册为学生账号，请核对后重试' }, 400);
      const updated = { ownerId, visibility: patch.visibility, sharedWithUserIds: students.map((student) => student.id) };
      if (bundle) await saveKnowledgeBundle({ ...bundle, ...updated, updatedAt: new Date().toISOString() }, bundle);
      else if (input.kind !== 'knowledge') await saveMediaPolicy(db, input.kind, input.id, updated);
      return reply({ ok: true });
    }
    const ids = policy.sharedWithUserIds ?? [];
    const students = ids.length ? (await db.query<{ id: string; email: string; display_name: string }>(
      `SELECT id,email,display_name FROM users WHERE role='student' AND id::text=ANY($1::text[]) ORDER BY email`, [ids])).rows : [];
    return reply({ visibility: policy.visibility ?? 'private', students: students.map((s) => ({ id: s.id, email: s.email, displayName: s.display_name })) });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return reply({ error: '分享设置格式无效，最多可指定 100 位学生' }, 400);
    if (error instanceof KnowledgeStorageError) return reply({ error: error.message }, error.status);
    console.error('Resource sharing failed:', error);
    return reply({ error: '无法保存或读取分享设置，请稍后重试' }, 503);
  }
}
export const GET = (request: NextRequest) => handle(request, false);
export const PATCH = (request: NextRequest) => handle(request, true);
