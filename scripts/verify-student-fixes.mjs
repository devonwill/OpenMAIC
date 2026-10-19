#!/usr/bin/env node
/**
 * 本地端到端验证脚本：学生端 4 项修复 + 头像 + 视觉迁移一并跑通。
 *
 * 前提（沙箱外手工执行）：
 *   1. Postgres 已启，DATABASE_URL 指向 127.0.0.1:5432
 *   2. Neo4j 已启，bolt://127.0.0.1:7687 可连
 *   3. Next dev / start 已在 127.0.0.1:3000 跑起来
 *   4. 项目的 .env.local 已配 DATABASE_URL + NEO4J_* + COOKIE_SECURE=0
 *   5. 教师邀请码：环境变量 TEACHER_INVITE_CODE（默认 BIOBOT-TEACHER-2026）
 *
 * 跑法：
 *   node scripts/verify-student-fixes.mjs [baseUrl]
 *
 * 检查项：
 *   ① 教师注册 → 资料库建库 → 写一份含「图注：紧贴图行的文字」+ 普通段落的样本文档
 *   ② 上传文档 → 抽取节点（学生端要用的「含图注文档」样本）
 *   ③ 教师通过 sharing API 把库分享给学生
 *   ④ 学生注册 → 访问 /api/knowledge，断言：
 *       a. 共享资料列表能看到该库（catalog 过滤 canEdit 后的结果）
 *       b. /api/knowledge?bundle=...&full=1 能拿到 nodes
 *       c. /api/knowledge?bundle=...&q=<关键词>&full=1 hits 命中
 *       d. 节点详情（neighbors/attributes）接口可达
 *   ⑤ 教师侧 PATCH 自己库的 sharedWithUserIds 验证「公开 visibility」也让学生看到
 *   ⑥ 教师把 visibility=public 验证「公开库」学生能看到
 *
 * 跑完会打印「通过 X/6」与每个 check 的简明结果。
 */

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const TEACHER_INVITE = process.env.TEACHER_INVITE_CODE || 'BIOBOT-TEACHER-2026';
const PASSWORD = 'Passw0rd!test';
const stamp = Date.now().toString(36);
const teacher = { email: `t-fix-${stamp}@test.local`, password: PASSWORD, displayName: '测试教师' };
const student = { email: `s-fix-${stamp}@test.local`, password: PASSWORD, displayName: '测试学生' };

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  const tag = pass ? '✓' : '✗';
  console.log(`${tag} ${name}${detail ? ` — ${detail}` : ''}`);
}

function newJar() { return new Map(); }
function readSetCookies(res) {
  const arr = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const map = newJar();
  for (const raw of arr) {
    const [pair] = raw.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) map.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  return map;
}
function cookieHeader(jar) {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}
function mergeJar(target, src) { for (const [k, v] of src) target.set(k, v); }

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
  return { status: res.status, jar: readSetCookies(res), body: await res.json().catch(() => null) };
}

async function api(path, { jar, method = 'GET', body, multipart } = {}) {
  const headers = {};
  if (jar && jar.size) headers.cookie = cookieHeader(jar);
  let payload = undefined;
  if (multipart) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(multipart)) fd.append(k, v);
    payload = fd;
  } else if (body) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  // 让 Set-Cookie 自动累积（auth/me 路由也会写 session）
  if (jar) mergeJar(jar, readSetCookies(res));
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  console.log(`目标：${BASE}\n`);

  // ① 注册教师
  const tea = await register(teacher, true);
  check('教师注册', tea.status === 201 && tea.body?.user?.role === 'teacher', `HTTP ${tea.status}`);

  // ② 注册学生
  const stu = await register(student, false);
  check('学生注册', stu.status === 201 && stu.body?.user?.role === 'student', `HTTP ${stu.status}`);

  // ③ 教师建库
  const created = await api('/api/knowledge', {
    jar: tea.jar,
    method: 'POST',
    body: { action: 'createLibrary', title: `学生修复验证-${stamp}`, description: '端到端测试' },
  });
  const libId = created.body?.bundle?.id ?? created.body?.id;
  check('教师建库', created.status === 201 && Boolean(libId), `HTTP ${created.status}, id=${libId}`);

  if (!libId) return finish();

  // ④ 上传一份含「图注紧贴图片行」+ 关键词「机器人学」的 markdown 文档
  const md = `# 机器人学引论\n\n本课介绍机器人学的核心概念。\n\n![机器人平台](../assets/svg/robot.svg)\n*图注：开放式机器人平台示意*\n\n## 关键概念\n\n- 关节与连杆\n- 正逆运动学\n- 传感器融合\n\n搜索关键词：机器人学、运动学、传感器。\n`;
  const tmp = `/tmp/verify-md-${stamp}.md`;
  const fs = await import('node:fs/promises');
  await fs.writeFile(tmp, md, 'utf-8');
  const fileBuffer = await fs.readFile(tmp);

  const form = new FormData();
  // Node 18+ FormData 接受 Blob
  form.append('file', new Blob([fileBuffer], { type: 'text/markdown' }), `robotics-${stamp}.md`);

  const upRes = await fetch(`${BASE}/api/knowledge?libraryId=${encodeURIComponent(libId)}`, {
    method: 'POST',
    headers: { cookie: cookieHeader(tea.jar) },
    body: form,
  });
  const upBody = await upRes.json().catch(() => null);
  mergeJar(tea.jar, readSetCookies(upRes));
  const first = Array.isArray(upBody?.results) ? upBody.results[0] : null;
  check('上传并抽取文档', upRes.status === 200 && first?.ok === true, `HTTP ${upRes.status}, ok=${first?.ok}, stats=${JSON.stringify(first?.stats)}`);

  // ⑤ 教师把库分享给学生
  const share = await api('/api/resources/sharing', {
    jar: tea.jar,
    method: 'PATCH',
    body: { kind: 'knowledge', id: libId, visibility: 'private', studentEmails: [student.email] },
  });
  check('教师通过 sharing API 共享资料库', share.status === 200, `HTTP ${share.status} ${JSON.stringify(share.body)}`);

  // ⑥ 学生看目录（核心修复点：canRead 通过 sharedWithUserIds）
  const stuCatalog = await api('/api/knowledge', { jar: stu.jar });
  const visible = (stuCatalog.body?.catalog ?? []).find((x) => x.id === libId);
  check(
    'a. 学生目录能看到该库（sharedWithMe 或 visibility）',
    Boolean(visible),
    visible ? `sharedWithMe=${visible.sharedWithMe}, visibility=${visible.visibility}` : '未出现',
  );

  // ⑦ 学生拿全量图谱（节点搜索依赖 full=1 + q 路径）
  const graph = await api(`/api/knowledge?bundle=${libId}&full=1`, { jar: stu.jar });
  const g = graph.body?.graph;
  check(
    'b. 学生拿到全量图谱（full=1）',
    graph.status === 200 && Array.isArray(g?.nodes) && g.nodes.length > 0,
    `HTTP ${graph.status}, nodes=${g?.nodes?.length ?? 'n/a'}`,
  );

  // ⑧ 搜索节点：服务端 hits 路径
  const search = await api(`/api/knowledge?bundle=${libId}&q=${encodeURIComponent('机器人学')}&full=1`, { jar: stu.jar });
  const hits = search.body?.hits ?? [];
  check(
    'c. 学生用 q 搜索触发服务端 hits',
    search.status === 200 && hits.length > 0,
    `HTTP ${search.status}, hits=${hits.length}, top=${hits[0]?.node?.name ?? '无'}`,
  );

  // ⑨ 节点详情：detail 字段
  const firstNodeId = g?.nodes?.[0]?.id;
  if (firstNodeId) {
    const detail = await api(`/api/knowledge?bundle=${libId}&node=${encodeURIComponent(firstNodeId)}`, { jar: stu.jar });
    const d = detail.body?.detail;
    check(
      'd. 学生可读节点详情（含 name/category/content/aliases）',
      detail.status === 200 && d?.id === firstNodeId && typeof d?.content === 'string',
      `HTTP ${detail.status}, name=${d?.name ?? '无'}`,
    );
  }

  // ⑩ 公开库路径：教师把库设为 public，学生也能看到
  const publicShare = await api('/api/resources/sharing', {
    jar: tea.jar,
    method: 'PATCH',
    body: { kind: 'knowledge', id: libId, visibility: 'public', studentEmails: [] },
  });
  check('教师把库设为公开', publicShare.status === 200, `HTTP ${publicShare.status}`);

  const stuAfterPublic = await api('/api/knowledge', { jar: stu.jar });
  const stillVisible = (stuAfterPublic.body?.catalog ?? []).find((x) => x.id === libId);
  check(
    'e. 学生也能看到公开库（visibility=public 路径）',
    Boolean(stillVisible),
    stillVisible ? `visibility=${stillVisible.visibility}` : '公开库也未出现',
  );

  // ⑪ 头像校验：student-learning-space 渲染会调 user-profile，但不直接拉 avatar 池。
  // 这里只静态确认 /avatars/teacher-3.png 等新资源 200。
  const expectedAvatars = [
    'teacher-3.png', 'teacher-4.png', 'teacher-5.png', 'teacher-6.png',
    'teacher-7.png', 'teacher-8.png', 'teacher-9.png', 'teacher-10.png',
    ...Array.from({ length: 24 }, (_, i) => `student${i + 4}.png`),
  ];
  const missing = [];
  for (const name of expectedAvatars) {
    const res = await fetch(`${BASE}/avatars/${name}`, { method: 'HEAD' });
    if (res.status !== 200) missing.push(`${name}=${res.status}`);
  }
  check(
    'f. 32 个新卡通头像全部可达',
    missing.length === 0,
    missing.length ? `缺 ${missing.length} 个：${missing.slice(0, 5).join(', ')}…` : `${expectedAvatars.length}/32 OK`,
  );

  finish();
}

function finish() {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('验证脚本异常：', e.message);
  process.exit(2);
});
