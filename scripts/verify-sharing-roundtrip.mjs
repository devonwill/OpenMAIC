/**
 * 教师端共享对话框的完整读写闭环验证。
 *
 * 对话框行为是「打开时 GET 读回 → 编辑 → PATCH 保存 → 重开 GET 读回」，
 * 这里按同样顺序走一遍，确认名单能正确持久化而不是只在前端内存里存在。
 */

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const INVITE = process.env.TEACHER_INVITE_CODE || 'BIOBOT-TEACHER-2026';
const stamp = Date.now().toString(36);

const results = [];
function check(name, pass, detail) {
  results.push(pass);
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function register(email, displayName, isTeacher) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'Passw0rd!test',
      displayName,
      role: isTeacher ? 'teacher' : 'student',
      ...(isTeacher ? { inviteCode: INVITE } : {}),
    }),
  });
  const jar = new Map();
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return { status: res.status, jar, body: await res.json().catch(() => null) };
}

const cookie = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

const call = (path, { jar, method = 'GET', body } = {}) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(jar ? { cookie: cookie(jar) } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

async function main() {
  const teacher = await register(`rt-t-${stamp}@test.local`, '闭环教师', true);
  const s1 = await register(`rt-s1-${stamp}@test.local`, '学生一', false);
  const s2 = await register(`rt-s2-${stamp}@test.local`, '学生二', false);
  check('教师 + 两名学生注册', teacher.status === 201 && s1.status === 201 && s2.status === 201);

  const created = await (
    await call('/api/knowledge', {
      jar: teacher.jar,
      method: 'POST',
      body: { action: 'createLibrary', title: `共享闭环-${stamp}` },
    })
  ).json();
  const libId = created?.id ?? created?.bundle?.id;
  check('创建资料库', Boolean(libId), libId);

  // 对话框打开时的初始读取
  const initial = await (
    await call(`/api/resources/sharing?kind=knowledge&id=${libId}`, { jar: teacher.jar })
  ).json();
  check(
    '对话框初始读取为 private + 空名单',
    initial?.visibility === 'private' && Array.isArray(initial?.students) && initial.students.length === 0,
    `visibility=${initial?.visibility}, students=${initial?.students?.length}`,
  );

  // 勾选两名学生后保存
  const save = await call('/api/resources/sharing', {
    jar: teacher.jar,
    method: 'PATCH',
    body: {
      kind: 'knowledge',
      id: libId,
      visibility: 'private',
      studentEmails: [s1.body.user.email, s2.body.user.email],
    },
  });
  check('保存两名学生', save.status === 200, `HTTP ${save.status}`);

  // 重新打开对话框：名单必须读回
  const reopened = await (
    await call(`/api/resources/sharing?kind=knowledge&id=${libId}`, { jar: teacher.jar })
  ).json();
  const emails = (reopened?.students ?? []).map((x) => x.email).sort();
  const want = [s1.body.user.email, s2.body.user.email].sort();
  check(
    '重开对话框读回名单（已持久化）',
    emails.length === 2 && emails.every((v, i) => v === want[i]),
    emails.join(', '),
  );

  // 可见范围切 public
  await call('/api/resources/sharing', {
    jar: teacher.jar,
    method: 'PATCH',
    body: { kind: 'knowledge', id: libId, visibility: 'public', studentEmails: want },
  });
  const pub = await (
    await call(`/api/resources/sharing?kind=knowledge&id=${libId}`, { jar: teacher.jar })
  ).json();
  check('可见范围切为 public', pub?.visibility === 'public', `visibility=${pub?.visibility}`);

  // 未注册邮箱应被服务端拒绝，且不改变已保存状态
  const bogus = await call('/api/resources/sharing', {
    jar: teacher.jar,
    method: 'PATCH',
    body: { kind: 'knowledge', id: libId, visibility: 'public', studentEmails: [...want, `ghost-${stamp}@nowhere.edu.cn`] },
  });
  const bogusBody = await bogus.json().catch(() => null);
  check('未注册邮箱被拒', bogus.status === 400, `HTTP ${bogus.status} 「${bogusBody?.error ?? ''}」`);
  check(
    '拒绝后原设置未被破坏',
    (bogusBody?.error ?? '').includes('未注册'),
    '错误文案含「未注册」，前端据此展开邮箱明细',
  );

  // 越权：学生不能改他人共享设置。
  // 服务端在角色检查处就拦下（role !== 'teacher' → 403），走不到归属检查那层 404。
  const escalate = await call('/api/resources/sharing', {
    jar: s1.jar,
    method: 'PATCH',
    body: { kind: 'knowledge', id: libId, visibility: 'public', studentEmails: [s2.body.user.email] },
  });
  check('学生不能修改他人共享设置(403)', escalate.status === 403, `HTTP ${escalate.status}`);

  // public 后未在名单里的第三方学生也应能看到
  const s3 = await register(`rt-s3-${stamp}@test.local`, '学生三', false);
  const outsider = await (await call('/api/knowledge', { jar: s3.jar })).json();
  check(
    'public 后非名单学生也可见',
    (outsider?.catalog ?? []).some((x) => x.id === libId),
    `学生三可见 ${(outsider?.catalog ?? []).length} 个库`,
  );

  const failed = results.filter((x) => !x).length;
  console.log(`\n通过 ${results.length - failed}/${results.length}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('验证异常:', e.message);
  process.exit(1);
});
