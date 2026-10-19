/**
 * 本地验证「学生学习空间」功能链路。
 *
 * 覆盖：
 *  1. 学生注册（无邀请码）→ 拿 openmaic_session
 *  2. 学生访问 /api/knowledge：只应看到教师显式共享的资料库（sharedWithMe）
 *  3. 学生不能通过 api 创建/修改/删除资料库（服务端拒绝，不是前端隐藏按钮）
 *  4. 知识图谱后端可达性（本地 Neo4j）
 *  5. 打印共享动作缺口：updateLibrary 无法设置 sharedWithUserIds
 *
 * 用法：node scripts/verify-student-learning.mjs [baseUrl]
 */

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const TEACHER_INVITE = process.env.TEACHER_INVITE_CODE || 'BIOBOT-TEACHER-2026';

const stamp = Date.now().toString(36);
const teacher = { email: `t-${stamp}@test.local`, password: 'Passw0rd!test', displayName: '测试教师' };
const student = { email: `s-${stamp}@test.local`, password: 'Passw0rd!test', displayName: '测试学生' };

/** 收集会话 cookie；注册接口的 Set-Cookie 名是 openmaic_session。 */
async function register(user, isTeacher) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      displayName: user.displayName,
      role: isTeacher ? 'teacher' : 'student',
      ...(isTeacher ? { inviteCode: TEACHER_INVITE } : {}),
    }),
  });
  const jar = new Map();
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  return { status: res.status, jar, body: await res.json().catch(() => null) };
}

const cookieHeader = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function api(path, { jar, method = 'GET', body, form } = {}) {
  const headers = {};
  if (jar && jar.size) headers.cookie = cookieHeader(jar);
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log(`目标：${BASE}\n`);

  // 1) 学生注册（不需邀请码）
  const stu = await register(student, false);
  check(
    '学生注册无需邀请码',
    stu.status === 201 && stu.body?.user?.role === 'student',
    `HTTP ${stu.status}, role=${stu.body?.user?.role}`,
  );
  if (stu.status !== 201) {
    console.log('\n学生注册失败，后续用例跳过。响应：', JSON.stringify(stu.body));
    return finish();
  }

  // 2) 教师注册（校验邀请码仍然生效）
  const tea = await register(teacher, true);
  check('教师注册凭邀请码成功', tea.status === 201, `HTTP ${tea.status}`);

  // 3) 学生看目录。本地库里可能残留其它教师测试留下的 public 库，
  // 所以只断言「此刻还不该看到本轮教师将建的库」，而不是目录必须为空。
  const stuCatalog = await api('/api/knowledge', { jar: stu.jar });
  check(
    '学生目录可正常读取',
    stuCatalog.status === 200 && Array.isArray(stuCatalog.body?.catalog),
    `HTTP ${stuCatalog.status}, 可见 ${(stuCatalog.body?.catalog ?? []).length} 个`,
  );

  // 4) 教师建库 → 学生仍不可见（private 默认）
  const created = await api('/api/knowledge', {
    jar: tea.jar,
    method: 'POST',
    body: { action: 'createLibrary', title: `机器人学资料库-${stamp}`, description: '学生空间测试' },
  });
  const libId = created.body?.bundle?.id ?? created.body?.id;
  check(
    '教师可创建资料库',
    created.status === 201 && Boolean(libId),
    `HTTP ${created.status}, id=${libId ?? '无'}`,
  );

  if (libId) {
    const after = await api('/api/knowledge', { jar: stu.jar });
    const leaked = (after.body?.catalog ?? []).some((x) => x.id === libId);
    check('private 资料库对学生不可见', after.status === 200 && !leaked, `本轮库泄漏=${leaked}`);

    // 5) 教师通过既有 sharing API 把库共享给该学生
    const share = await api('/api/resources/sharing', {
      jar: tea.jar,
      method: 'PATCH',
      body: { kind: 'knowledge', id: libId, visibility: 'private', studentEmails: [student.email] },
    });
    check(
      '教师通过 sharing API 共享资料库',
      share.status === 200,
      share.status === 200 ? 'ok' : `HTTP ${share.status} ${JSON.stringify(share.body)}`,
    );

    const afterShare = await api('/api/knowledge', { jar: stu.jar });
    const nowVisible = (afterShare.body?.catalog ?? []).find((x) => x.id === libId);
    check(
      '共享后学生目录出现该库且 sharedWithMe=true',
      Boolean(nowVisible) && nowVisible?.sharedWithMe === true,
      nowVisible ? `sharedWithMe=${nowVisible.sharedWithMe}` : '学生目录中未出现',
    );

    const graphOfShared = await api(`/api/knowledge?bundle=${libId}&full=1`, { jar: stu.jar });
    const g = graphOfShared.body?.graph;
    check(
      '学生可读取共享库图谱数据',
      graphOfShared.status === 200 && Array.isArray(g?.nodes),
      `HTTP ${graphOfShared.status}, nodes=${Array.isArray(g?.nodes) ? g.nodes.length : 'n/a'}, links=${Array.isArray(g?.links) ? g.links.length : 'n/a'}`,
    );
  }

  // 6) 学生不能改/删他人资料库（服务端授权，不是靠 UI 隐藏）
  if (libId) {
    const del = await api('/api/knowledge', { jar: stu.jar, method: 'DELETE', body: { id: libId } });
    check('学生删除他人资料库被拒(403)', del.status === 403, `HTTP ${del.status}`);

    const patch = await api('/api/knowledge', {
      jar: stu.jar,
      method: 'POST',
      body: { action: 'updateLibrary', id: libId, title: '篡改' },
    });
    check('学生修改他人资料库被拒(403)', patch.status === 403, `HTTP ${patch.status}`);
  }

  // 7) 图谱后端（状态随主路由返回，不在独立接口）
  const graph = await api('/api/knowledge?full=1', { jar: tea.jar });
  const backend = graph.body?.graphBackend ?? {};
  check(
    '图谱后端为本地 Neo4j',
    graph.status === 200 && backend.backend === 'neo4j' && backend.configured === true,
    JSON.stringify(backend),
  );

  finish();

  function finish() {
    const failed = results.filter((r) => !r.pass);
    console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
    process.exit(failed.length ? 1 : 0);
  }
}

main().catch((e) => {
  console.error('验证脚本异常：', e.message);
  process.exit(1);
});
