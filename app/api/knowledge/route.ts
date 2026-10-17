import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { documentArtifactToParsedPdfContent, extractDocument } from '@/lib/document';
import { KnowledgeExtractError, extractKnowledgeBundle } from '@/lib/knowledge/extract';
import { checkGraphIntegrity, syncBundleToGraph, syncKnowledgeToGraph } from '@/lib/knowledge/graph-store';
import {
  addLink,
  createEmptyLibrary,
  deleteLink,
  deleteNode,
  ensureLinkIds,
  mergeExtractionIntoLibrary,
  newDocumentId,
  removeDocumentFromLibrary,
  replaceDocumentExtraction,
  updateLink,
  upsertNode,
  type NodeDraft,
} from '@/lib/knowledge/library-store';
import { searchKnowledge } from '@/lib/knowledge/retrieval';
import { loadKnowledge } from '@/lib/knowledge/server';
import { KNOWLEDGE_NODE_TYPES, knowledgeBundleSchema, type KnowledgeBundle, type KnowledgeBundleV2, type KnowledgeNodeType } from '@/lib/knowledge/schema';
import { resolveRequestOwnerId } from '@/lib/server/agent-runtime/owner';
import { resolveAuthenticatedOwnerId } from '@/lib/server/auth/identity';
import { indexCodeRepo, saveCodeBundle } from '@/lib/server/code-repo';
import { resolveModel } from '@/lib/server/resolve-model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['.md', '.txt']);
const BUNDLE_EXTENSIONS = new Set(['.json']);

function knowledgeDir(): string {
  return process.env.KNOWLEDGE_DATA_DIR || path.join(process.cwd(), 'data', 'knowledge');
}
function codeDir(): string {
  return process.env.CODE_DATA_DIR || path.join(process.cwd(), 'data', 'code-repos');
}
function dirFor(bundle: Pick<KnowledgeBundle, 'kind'>): string {
  return bundle.kind === 'code' ? codeDir() : knowledgeDir();
}
function candidateDirs(bundle: Pick<KnowledgeBundle, 'kind'>): string[] {
  return Array.from(new Set([dirFor(bundle), knowledgeDir(), codeDir()]));
}

/** loadKnowledge does not constrain filenames, so match by content id as well as `<id>.json`. */
async function locateBundleFile(bundle: KnowledgeBundle): Promise<string | null> {
  const dirs = candidateDirs(bundle);
  for (const dir of dirs) {
    const direct = path.join(dir, `${bundle.id}.json`);
    try {
      const raw = JSON.parse(await readFile(direct, 'utf8'));
      if (raw?.id === bundle.id) return direct;
    } catch {
      // fall through to directory scan
    }
  }
  for (const dir of dirs) {
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const file = path.join(dir, name);
        const raw = JSON.parse(await readFile(file, 'utf8'));
        if (raw?.id === bundle.id) return file;
      } catch {
        // skip unreadable files
      }
    }
  }
  return null;
}

async function writeBundle(bundle: KnowledgeBundle): Promise<string> {
  const dir = dirFor(bundle);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${bundle.id}.json`);
  await writeFile(file, JSON.stringify(bundle, null, 2), 'utf8');
  return file;
}

function generatedBundleId(): string {
  return `kb-${Date.now().toString(36)}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

interface MutationContext {
  ownerId: string;
  headers: Headers;
}

/** Owner identity + shared response headers (may carry a fresh Set-Cookie). */
async function beginMutation(request: NextRequest): Promise<MutationContext> {
  const headers = new Headers(NO_STORE);
  const ownerId = resolveRequestOwnerId(request, headers, await resolveAuthenticatedOwnerId(request));
  return { ownerId, headers };
}

function errorResponse(error: unknown, headers: Headers): NextResponse {
  if (error instanceof KnowledgeExtractError)
    return NextResponse.json({ error: error.message }, { status: 400, headers });
  if (error instanceof ZodError)
    return NextResponse.json({ error: '知识包格式校验失败', issues: error.issues }, { status: 400, headers });
  const message = error instanceof Error ? error.message : '服务器内部错误';
  // saveCodeBundle refuses to overwrite bundles that belong to another owner.
  if (message.includes('其他用户')) return NextResponse.json({ error: message }, { status: 403, headers });
  return NextResponse.json({ error: message }, { status: 500, headers });
}

async function handleImportBundle(
  payload: { bundle?: unknown },
  ctx: MutationContext,
): Promise<NextResponse> {
  const parsed = knowledgeBundleSchema.parse(payload.bundle);
  const { bundles } = await loadKnowledge();
  if (bundles.some((item) => item.id === parsed.id))
    return NextResponse.json({ error: `知识包 id 已存在：${parsed.id}` }, { status: 409, headers: ctx.headers });
  // Uploads enter as unreviewed under the uploader; review happens in 图1.
  const bundle: KnowledgeBundle = { ...parsed, ownerId: ctx.ownerId, reviewStatus: 'unreviewed' };
  await writeBundle(bundle);
  void syncBundleToGraph(bundle);
  return NextResponse.json({ bundle }, { status: 201, headers: ctx.headers });
}

async function handleIndexCode(
  payload: { path?: unknown; title?: unknown },
  ctx: MutationContext,
): Promise<NextResponse> {
  const repoPath = typeof payload.path === 'string' ? payload.path.trim() : '';
  if (!repoPath) return NextResponse.json({ error: '缺少仓库路径 path' }, { status: 400, headers: ctx.headers });
  if (repoPath.includes('..'))
    return NextResponse.json({ error: '仓库路径不允许包含 ..' }, { status: 400, headers: ctx.headers });
  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : undefined;
  const result = await indexCodeRepo({ ownerId: ctx.ownerId, repoPath, title });
  await saveCodeBundle(result.bundle);
  void syncBundleToGraph(result.bundle);
  return NextResponse.json(result, { status: 201, headers: ctx.headers });
}

async function handleCreateLibrary(
  payload: { title?: unknown; description?: unknown },
  ctx: MutationContext,
): Promise<NextResponse> {
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  if (!title)
    return NextResponse.json({ error: '请填写资料库标题' }, { status: 400, headers: ctx.headers });
  const id = `lib-${Date.now().toString(36)}-${nanoid(6)}`;
  const bundle = createEmptyLibrary({
    id,
    title,
    description: typeof payload.description === 'string' ? payload.description : '',
    ownerId: ctx.ownerId,
  });
  await writeBundle(bundle);
  return NextResponse.json({ id, title }, { status: 201, headers: ctx.headers });
}

async function handleUpdateLibrary(
  payload: { id?: unknown; title?: unknown; description?: unknown },
  ctx: MutationContext,
): Promise<NextResponse> {
  const id = typeof payload.id === 'string' ? payload.id : '';
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400, headers: ctx.headers });
  const title =
    payload.title === undefined ? undefined : typeof payload.title === 'string' ? payload.title.trim() : '';
  if (title !== undefined && !title)
    return NextResponse.json({ error: '资料库标题不能为空' }, { status: 400, headers: ctx.headers });
  const description =
    typeof payload.description === 'string' ? payload.description.trim() : undefined;
  const { bundles } = await loadKnowledge();
  const target = bundles.find((item) => item.id === id);
  if (!target) return NextResponse.json({ error: `资料库不存在：${id}` }, { status: 404, headers: ctx.headers });
  if (target.ownerId && target.ownerId !== ctx.ownerId)
    return NextResponse.json({ error: '无权修改他人的资料库' }, { status: 403, headers: ctx.headers });
  const updated: KnowledgeBundle = {
    ...target,
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    updatedAt: new Date().toISOString(),
  };
  const file = await locateBundleFile(updated);
  if (file) await writeFile(file, JSON.stringify(updated, null, 2), 'utf8');
  else await writeBundle(updated);
  return NextResponse.json({ bundle: updated }, { headers: ctx.headers });
}

type UploadResult =
  | { filename: string; ok: true; documentId: string; stats: { nodes: number; links: number } }
  | { filename: string; ok: false; error: string };

function collectUploadFiles(form: FormData): File[] {
  const files: File[] = [];
  for (const field of ['file', 'files']) {
    for (const entry of form.getAll(field)) {
      if (entry instanceof File) files.push(entry);
    }
  }
  return files;
}

async function handleUpload(
  request: NextRequest,
  ctx: MutationContext,
): Promise<NextResponse> {
  const form = await request.formData();
  const files = collectUploadFiles(form);
  if (files.length === 0)
    return NextResponse.json({ error: '缺少上传文件字段 file' }, { status: 400, headers: ctx.headers });
  const libraryId = request.nextUrl.searchParams.get('libraryId');
  const titleInput = form.get('title');
  const formTitle = typeof titleInput === 'string' && titleInput.trim() ? titleInput.trim() : '';

  // 无 libraryId：保持旧行为——单文件直接导入 / 抽取为独立知识包。
  if (!libraryId) {
    if (files.length !== 1)
      return NextResponse.json(
        { error: '直接上传仅支持单个文件；并入资料库请携带 libraryId' },
        { status: 400, headers: ctx.headers },
      );
    const file = files[0];
    if (file.size > MAX_UPLOAD_BYTES)
      return NextResponse.json({ error: '资料超过 20 MB 上限' }, { status: 400, headers: ctx.headers });
    const title = formTitle || file.name;
    const extension = path.extname(file.name).toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());

    // JSON bundles are imported verbatim (validated), documents go through AI extraction.
    if (BUNDLE_EXTENSIONS.has(extension)) {
      return handleImportBundle({ bundle: JSON.parse(buffer.toString('utf8')) }, ctx);
    }
    if (!TEXT_EXTENSIONS.has(extension) && extension !== '.pdf')
      return NextResponse.json({ error: '仅支持 .json / .md / .txt / .pdf 资料' }, { status: 400, headers: ctx.headers });

    let text: string;
    if (extension === '.pdf') {
      const artifact = await extractDocument({
        buffer,
        fileName: file.name,
        fileSize: file.size,
        mimeType: 'application/pdf',
        config: { providerId: 'unpdf' },
      });
      text = documentArtifactToParsedPdfContent(artifact).text;
    } else {
      text = buffer.toString('utf8');
    }

    let model;
    try {
      model = await resolveModel({ modelString: request.headers.get('x-model') || undefined });
    } catch {
      return NextResponse.json(
        { error: '未配置可用的大模型（请在模型设置中选择，或设置 DEFAULT_MODEL）' },
        { status: 400, headers: ctx.headers },
      );
    }

    const { bundle, stats, warnings } = await extractKnowledgeBundle({
      text,
      bundleId: generatedBundleId(),
      title,
      ownerId: ctx.ownerId,
      kind: 'paper',
      sourceTitle: title,
      model,
    });
    await writeBundle(bundle);
    void syncBundleToGraph(bundle);
    return NextResponse.json({ bundle, stats, warnings }, { status: 201, headers: ctx.headers });
  }

  // 有 libraryId：串行抽取并逐个并入内存中的同一资料库。
  const { bundles } = await loadKnowledge();
  const target = bundles.find((item) => item.id === libraryId);
  if (!target)
    return NextResponse.json({ error: `资料库不存在：${libraryId}` }, { status: 404, headers: ctx.headers });
  if (target.ownerId && target.ownerId !== ctx.ownerId)
    return NextResponse.json({ error: '无权修改他人的资料库' }, { status: 403, headers: ctx.headers });
  if (target.kind !== 'paper')
    return NextResponse.json({ error: '仅论文/资料库类型支持并入文档' }, { status: 400, headers: ctx.headers });

  let model;
  try {
    model = await resolveModel({ modelString: request.headers.get('x-model') || undefined });
  } catch {
    return NextResponse.json(
      { error: '未配置可用的大模型（请在模型设置中选择，或设置 DEFAULT_MODEL）' },
      { status: 400, headers: ctx.headers },
    );
  }

  let current: KnowledgeBundleV2 = target as KnowledgeBundleV2;
  const results: UploadResult[] = [];
  let successCount = 0;

  for (const file of files) {
    const extension = path.extname(file.name).toLowerCase();
    if (BUNDLE_EXTENSIONS.has(extension)) {
      results.push({ filename: file.name, ok: false, error: 'JSON 知识包请使用直接上传导入，不能并入资料库' });
      continue;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      results.push({ filename: file.name, ok: false, error: '资料超过 20 MB 上限' });
      continue;
    }
    if (!TEXT_EXTENSIONS.has(extension) && extension !== '.pdf') {
      results.push({ filename: file.name, ok: false, error: '仅支持 .md / .txt / .pdf 文档' });
      continue;
    }
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      let text: string;
      if (extension === '.pdf') {
        const artifact = await extractDocument({
          buffer,
          fileName: file.name,
          fileSize: file.size,
          mimeType: 'application/pdf',
          config: { providerId: 'unpdf' },
        });
        text = documentArtifactToParsedPdfContent(artifact).text;
      } else {
        text = buffer.toString('utf8');
      }
      const title = formTitle || file.name.replace(/\.[^.]+$/, '');
      const extracted = await extractKnowledgeBundle({
        text,
        bundleId: generatedBundleId(),
        title,
        ownerId: ctx.ownerId,
        kind: 'paper',
        sourceTitle: file.name,
        model,
      });
      const documentId = newDocumentId();
      const merged = mergeExtractionIntoLibrary(current, extracted.bundle, {
        documentId,
        filename: file.name,
        title,
        // 保留原文供文档页查看/编辑（与 schema 上限一致）。
        content: text.slice(0, 500_000),
      });
      current = merged.bundle;
      successCount += 1;
      results.push({
        filename: file.name,
        ok: true,
        documentId,
        stats: { nodes: extracted.stats.nodes, links: extracted.stats.links },
      });
    } catch (error) {
      results.push({
        filename: file.name,
        ok: false,
        error: error instanceof Error ? error.message : '抽取失败',
      });
    }
  }

  // 全部处理完成后只落盘一次；全部失败则不改动原库。
  if (successCount > 0) {
    await writeBundle(current);
    void syncBundleToGraph(current);
  }
  return NextResponse.json({ results }, { status: 200, headers: ctx.headers });
}

async function handlePatch(
  payload: { id?: unknown; reviewStatus?: unknown },
  ctx: MutationContext,
): Promise<NextResponse> {
  const id = typeof payload.id === 'string' ? payload.id : '';
  const reviewStatus = payload.reviewStatus;
  if (!id || (reviewStatus !== 'unreviewed' && reviewStatus !== 'reviewed' && reviewStatus !== 'demo'))
    return NextResponse.json({ error: '需要 id 与合法的 reviewStatus' }, { status: 400, headers: ctx.headers });
  const { bundles } = await loadKnowledge();
  const target = bundles.find((item) => item.id === id);
  if (!target) return NextResponse.json({ error: `知识包不存在：${id}` }, { status: 404, headers: ctx.headers });
  // Shared bundles (no ownerId) stay patchable; owned bundles only by their owner.
  if (target.ownerId && target.ownerId !== ctx.ownerId)
    return NextResponse.json({ error: '无权修改他人的知识包' }, { status: 403, headers: ctx.headers });
  const updated: KnowledgeBundle = { ...target, reviewStatus };
  const file = await locateBundleFile(updated);
  if (file) await writeFile(file, JSON.stringify(updated, null, 2), 'utf8');
  else await writeBundle(updated);
  void syncBundleToGraph(updated);
  return NextResponse.json({ bundle: updated }, { headers: ctx.headers });
}

/** PATCH updateDocument：更新文档原文（文档页查看/编辑保存），仅 owner 可改。 */
async function handleUpdateDocument(
  payload: { id?: unknown; documentId?: unknown; content?: unknown },
  ctx: MutationContext,
): Promise<NextResponse> {
  const id = typeof payload.id === 'string' ? payload.id : '';
  const documentId = typeof payload.documentId === 'string' ? payload.documentId : '';
  const content = typeof payload.content === 'string' ? payload.content : null;
  if (!id || !documentId || content === null)
    return NextResponse.json({ error: '缺少 id / documentId / content' }, { status: 400, headers: ctx.headers });
  if (content.length > 500_000)
    return NextResponse.json({ error: '文档原文超过 50 万字符上限' }, { status: 400, headers: ctx.headers });
  const { bundles } = await loadKnowledge();
  const target = bundles.find((item) => item.id === id);
  if (!target) return NextResponse.json({ error: `资料库不存在：${id}` }, { status: 404, headers: ctx.headers });
  if (!target.ownerId)
    return NextResponse.json({ error: '共享/演示知识包只读' }, { status: 403, headers: ctx.headers });
  if (target.ownerId !== ctx.ownerId)
    return NextResponse.json({ error: '无权修改他人的资料库' }, { status: 403, headers: ctx.headers });
  const ensured = ensureLinkIds(target as KnowledgeBundleV2);
  const doc = ensured.documents.find((item) => item.id === documentId);
  if (!doc)
    return NextResponse.json({ error: `文档不存在：${documentId}` }, { status: 404, headers: ctx.headers });
  // 原文真实变化才标「来源已变更」，提示图谱与文档不一致、需重新抽取。
  const changed = doc.content !== content;
  const updated: KnowledgeBundleV2 = {
    ...ensured,
    documents: ensured.documents.map((item) =>
      item.id === documentId
        ? { ...item, content, ...(changed ? { stale: true } : {}) }
        : item,
    ),
    updatedAt: new Date().toISOString(),
  };
  const file = await locateBundleFile(updated);
  if (file) await writeFile(file, JSON.stringify(updated, null, 2), 'utf8');
  else await writeBundle(updated);
  return NextResponse.json({ ok: true, id, documentId, stale: changed }, { headers: ctx.headers });
}

/**
 * PATCH reextractDocument：原文变更后按新内容重新抽取并回写图谱（摘除旧贡献、
 * 并入新抽取、清 stale、重置审核），仅 owner 可操作。
 */
async function handleReextractDocument(
  payload: { id?: unknown; documentId?: unknown },
  ctx: MutationContext,
  request: NextRequest,
): Promise<NextResponse> {
  const id = typeof payload.id === 'string' ? payload.id : '';
  const documentId = typeof payload.documentId === 'string' ? payload.documentId : '';
  if (!id || !documentId)
    return NextResponse.json({ error: '缺少 id / documentId' }, { status: 400, headers: ctx.headers });
  const { bundles } = await loadKnowledge();
  const target = bundles.find((item) => item.id === id);
  if (!target) return NextResponse.json({ error: `资料库不存在：${id}` }, { status: 404, headers: ctx.headers });
  if (!target.ownerId)
    return NextResponse.json({ error: '共享/演示知识包只读' }, { status: 403, headers: ctx.headers });
  if (target.ownerId !== ctx.ownerId)
    return NextResponse.json({ error: '无权修改他人的资料库' }, { status: 403, headers: ctx.headers });

  const ensured = ensureLinkIds(target as KnowledgeBundleV2);
  const doc = ensured.documents.find((item) => item.id === documentId);
  if (!doc)
    return NextResponse.json({ error: `文档不存在：${documentId}` }, { status: 404, headers: ctx.headers });
  if (!doc.content?.trim())
    return NextResponse.json({ error: '该文档未保留原文，无法重新抽取' }, { status: 400, headers: ctx.headers });

  let model;
  try {
    model = await resolveModel({ modelString: request.headers.get('x-model') || undefined });
  } catch {
    return NextResponse.json(
      { error: '未配置可用的大模型（请在模型设置中选择，或设置 DEFAULT_MODEL）' },
      { status: 400, headers: ctx.headers },
    );
  }

  const extracted = await extractKnowledgeBundle({
    text: doc.content,
    bundleId: generatedBundleId(),
    title: doc.title,
    ownerId: ctx.ownerId,
    kind: 'paper',
    sourceTitle: doc.filename,
    model,
  });
  const { bundle: updated } = replaceDocumentExtraction(ensured, documentId, extracted.bundle);
  const file = await locateBundleFile(updated);
  if (file) await writeFile(file, JSON.stringify(updated, null, 2), 'utf8');
  else await writeBundle(updated);
  void syncBundleToGraph(updated);
  return NextResponse.json(
    { ok: true, id, documentId, stats: extracted.stats, warnings: extracted.warnings },
    { headers: ctx.headers },
  );
}

type GraphEditAction = 'upsertNode' | 'deleteNode' | 'addLink' | 'updateLink' | 'deleteLink';

const GRAPH_EDIT_ACTIONS = new Set<GraphEditAction>([
  'upsertNode',
  'deleteNode',
  'addLink',
  'updateLink',
  'deleteLink',
]);

interface GraphEditPayload {
  action: GraphEditAction;
  id?: unknown;
  nodeId?: unknown;
  node?: unknown;
  linkId?: unknown;
  source?: unknown;
  target?: unknown;
  relation?: unknown;
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 自定义属性：必须是字符串键值对象，最多 20 对、键 ≤80、值 ≤500；非法返回 null。 */
function coerceAttributes(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 20) return null;
  const out: Record<string, string> = {};
  for (const [key, val] of entries) {
    if (key.length > 80 || typeof val !== 'string' || val.length > 500) return null;
    out[key] = val;
  }
  return out;
}

/** PATCH 图谱编辑：节点/边的增删改，仅库 owner 可操作（共享/演示包只读）。 */
async function handleGraphEdit(
  payload: GraphEditPayload,
  ctx: MutationContext,
): Promise<NextResponse> {
  const id = trimString(payload.id);
  if (!id) return NextResponse.json({ error: '缺少资料库 id' }, { status: 400, headers: ctx.headers });
  const { bundles } = await loadKnowledge();
  const target = bundles.find((item) => item.id === id);
  if (!target)
    return NextResponse.json({ error: `资料库不存在：${id}` }, { status: 404, headers: ctx.headers });
  if (!target.ownerId)
    return NextResponse.json({ error: '共享/演示知识包只读' }, { status: 403, headers: ctx.headers });
  if (target.ownerId !== ctx.ownerId)
    return NextResponse.json({ error: '无权修改他人的资料库' }, { status: 403, headers: ctx.headers });

  // 内存中先为存量边补 id，保证 update/delete 可以按 linkId 定位。
  let bundle = ensureLinkIds(target as KnowledgeBundleV2);
  let createdNodeId: string | undefined;

  try {
    switch (payload.action) {
      case 'upsertNode': {
        const input = payload.node;
        if (!input || typeof input !== 'object' || Array.isArray(input))
          return NextResponse.json({ error: 'node 必须是对象' }, { status: 400, headers: ctx.headers });
        const raw = input as Record<string, unknown>;
        const name = trimString(raw.name);
        if (!name)
          return NextResponse.json({ error: '节点名称不能为空' }, { status: 400, headers: ctx.headers });
        // 五类枚举统一校验，避免与 schema 的枚举清单出现两处硬编码漂移
        if (!(KNOWLEDGE_NODE_TYPES as readonly string[]).includes(raw.nodeType as string))
          return NextResponse.json(
            { error: `nodeType 仅支持 ${KNOWLEDGE_NODE_TYPES.join(' / ')}` },
            { status: 400, headers: ctx.headers },
          );
        const categoryRaw = trimString(raw.category);
        const content = typeof raw.content === 'string' ? raw.content : '';
        const attributes = coerceAttributes(raw.attributes);
        if (attributes === null)
          return NextResponse.json(
            { error: 'attributes 必须是字符串键值对象（最多 20 对，键 ≤80 字符，值 ≤500 字符）' },
            { status: 400, headers: ctx.headers },
          );
        const nodeId = trimString(payload.nodeId) || undefined;
        if (nodeId && !bundle.nodes.some((node) => node.id === nodeId))
          return NextResponse.json({ error: `要更新的节点不存在：${nodeId}` }, { status: 400, headers: ctx.headers });
        const draft: NodeDraft = {
          name,
          category: categoryRaw || '知识点',
          content,
          // includes 不做类型收窄；上面已用五类枚举校验通过，此处断言回联合类型
          nodeType: raw.nodeType as KnowledgeNodeType,
          attributes,
        };
        const result = upsertNode(bundle, draft, undefined, nodeId);
        bundle = result.bundle;
        if ('nodeId' in result) createdNodeId = result.nodeId;
        break;
      }
      case 'deleteNode': {
        const nodeId = trimString(payload.nodeId);
        if (!nodeId)
          return NextResponse.json({ error: '缺少 nodeId' }, { status: 400, headers: ctx.headers });
        if (!bundle.nodes.some((node) => node.id === nodeId))
          return NextResponse.json({ error: `节点不存在：${nodeId}` }, { status: 400, headers: ctx.headers });
        bundle = deleteNode(bundle, nodeId).bundle;
        break;
      }
      case 'addLink': {
        const source = trimString(payload.source);
        const targetId = trimString(payload.target);
        const relation = trimString(payload.relation);
        if (!source || !targetId || !relation)
          return NextResponse.json(
            { error: 'source、target、relation 均不能为空' },
            { status: 400, headers: ctx.headers },
          );
        bundle = addLink(bundle, source, targetId, relation).bundle;
        break;
      }
      case 'updateLink': {
        const linkId = trimString(payload.linkId);
        const relation = trimString(payload.relation);
        if (!linkId)
          return NextResponse.json({ error: '缺少 linkId' }, { status: 400, headers: ctx.headers });
        if (!bundle.links.some((link) => link.id === linkId))
          return NextResponse.json({ error: `关系不存在：${linkId}` }, { status: 400, headers: ctx.headers });
        if (!relation)
          return NextResponse.json({ error: '关系名不能为空' }, { status: 400, headers: ctx.headers });
        bundle = updateLink(bundle, linkId, relation).bundle;
        break;
      }
      case 'deleteLink': {
        const linkId = trimString(payload.linkId);
        if (!linkId)
          return NextResponse.json({ error: '缺少 linkId' }, { status: 400, headers: ctx.headers });
        if (!bundle.links.some((link) => link.id === linkId))
          return NextResponse.json({ error: `关系不存在：${linkId}` }, { status: 400, headers: ctx.headers });
        bundle = deleteLink(bundle, linkId).bundle;
        break;
      }
    }
  } catch (error) {
    // 纯函数校验失败（重名、端点缺失、自连、重复边等）统一 400；zod 兜底（超长等）同样转 400。
    if (error instanceof ZodError)
      return NextResponse.json(
        { error: '节点/关系数据校验失败', issues: error.issues },
        { status: 400, headers: ctx.headers },
      );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '图谱编辑失败' },
      { status: 400, headers: ctx.headers },
    );
  }

  // 写回前 bundle 已经过 library-store 内的 zod parse，必为合法 V2。
  const file = await locateBundleFile(bundle);
  if (file) await writeFile(file, JSON.stringify(bundle, null, 2), 'utf8');
  else await writeBundle(bundle);
  void syncBundleToGraph(bundle);
  return NextResponse.json(
    {
      ok: true,
      ...(createdNodeId ? { nodeId: createdNodeId } : {}),
      bundle: { id: bundle.id, nodes: bundle.nodes.length, links: bundle.links.length },
    },
    { status: 200, headers: ctx.headers },
  );
}

async function handleDelete(
  payload: { id?: unknown; documentId?: unknown },
  ctx: MutationContext,
): Promise<NextResponse> {
  const id = typeof payload.id === 'string' ? payload.id : '';
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400, headers: ctx.headers });
  const { bundles } = await loadKnowledge();
  const target = bundles.find((item) => item.id === id);
  if (!target) return NextResponse.json({ error: `知识包不存在：${id}` }, { status: 404, headers: ctx.headers });

  // 仅删除库内某个文档：联动清理该文档独占的节点与悬空边。
  const documentId = typeof payload.documentId === 'string' ? payload.documentId : '';
  if (documentId) {
    if (!target.ownerId)
      return NextResponse.json({ error: '共享知识包不允许修改' }, { status: 403, headers: ctx.headers });
    if (target.ownerId !== ctx.ownerId)
      return NextResponse.json({ error: '无权修改他人的知识包' }, { status: 403, headers: ctx.headers });
    const { bundle: removed } = removeDocumentFromLibrary(target as KnowledgeBundleV2, documentId);
    const file = await locateBundleFile(removed);
    if (file) await writeFile(file, JSON.stringify(removed, null, 2), 'utf8');
    else await writeBundle(removed);
    void syncBundleToGraph(removed);
    return NextResponse.json({ ok: true, id, documentId }, { headers: ctx.headers });
  }

  if (!target.ownerId)
    return NextResponse.json({ error: '共享知识包不允许删除' }, { status: 403, headers: ctx.headers });
  if (target.ownerId !== ctx.ownerId)
    return NextResponse.json({ error: '无权删除他人的知识包' }, { status: 403, headers: ctx.headers });
  const file = await locateBundleFile(target);
  if (file) await unlink(file);
  // Full rebuild clears residual Neo4j rows for the removed bundle.
  void syncKnowledgeToGraph();
  return NextResponse.json({ ok: true, id }, { headers: ctx.headers });
}

export async function GET(request: NextRequest) {
  const { bundles, warnings } = await loadKnowledge();
  const searchParams = request.nextUrl.searchParams;
  const query = (searchParams.get('q') || '').slice(0, 500);
  const selected = searchParams.get('bundle');
  const nodeId = searchParams.get('node');
  const documentId = searchParams.get('document');
  const full = searchParams.get('full') === '1';
  const bundle = bundles.find((item) => item.id === selected);
  // 边在输出前统一补 id（内存处理，不写盘），供浏览态点选与编辑态定位。
  const ensured = bundle ? ensureLinkIds(bundle as KnowledgeBundleV2) : null;
  const scoped = selected ? bundles.filter((item) => item.id === selected) : bundles;
  const hits = searchKnowledge(scoped, query, 12);

  // 文档原文查看/编辑：?bundle=&document= 单独返回该文档内容（不带图谱负载）。
  if (documentId) {
    if (!bundle || !ensured)
      return NextResponse.json({ error: '查看文档需要指定 bundle' }, { status: 400, headers: NO_STORE });
    const doc = ensured.documents.find((item) => item.id === documentId);
    if (!doc)
      return NextResponse.json({ error: `文档不存在：${documentId}` }, { status: 404, headers: NO_STORE });
    return NextResponse.json(
      {
        document: {
          id: doc.id,
          title: doc.title,
          filename: doc.filename,
          // 旧数据未保留原文 → null，前端提示可手动粘贴。
          content: doc.content ?? null,
        },
      },
      { headers: NO_STORE },
    );
  }

  const graph = (() => {
    if (full && ensured) {
      return {
        nodes: ensured.nodes.map((node) => ({
          id: node.id,
          name: node.name,
          category: node.category,
          nodeType: node.nodeType ?? 'concept',
          attributes: node.attributes ?? {},
          documentIds: node.documentIds ?? [],
          content: node.content,
          aliases: node.aliases,
        })),
        links: ensured.links.map((link) => ({
          id: link.id!,
          source: link.source,
          target: link.target,
          relation: link.relation,
        })),
      };
    }
    // 浏览态：命中节点 + 直接邻接，60 节点 / 120 边截断（逻辑保持不变，边补 id）。
    const focusIds = new Set(hits.map((hit) => hit.node.id));
    const seedIds = new Set(focusIds);
    let visibleNodes = ensured?.nodes.slice(0, 60) ?? [];
    if (ensured && query) {
      for (const link of ensured.links) {
        if (seedIds.has(link.source)) focusIds.add(link.target);
        if (seedIds.has(link.target)) focusIds.add(link.source);
        // Direct neighbors only: build links below from the bounded node selection.
      }
      visibleNodes = ensured.nodes.filter((node) => focusIds.has(node.id)).slice(0, 60);
    }
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    return {
      nodes: visibleNodes.map(({ id, name, category }) => ({ id, name, category })),
      links: (ensured?.links ?? [])
        .filter((link) => visibleIds.has(link.source) && visibleIds.has(link.target))
        .slice(0, 120)
        .map((link) => ({ id: link.id!, source: link.source, target: link.target, relation: link.relation })),
    };
  })();

  const detailNode = bundle?.nodes.find((node) => node.id === nodeId) ?? null;
  const detail = detailNode
    ? {
        ...detailNode,
        nodeType: detailNode.nodeType ?? 'concept',
        attributes: detailNode.attributes ?? {},
        documentIds: detailNode.documentIds ?? [],
      }
    : null;

  return NextResponse.json(
    {
      catalog: bundles.map((item) => ({
        id: item.id,
        title: item.title,
        kind: item.kind,
        reviewStatus: item.reviewStatus,
        ownerId: item.ownerId,
        description: item.description ?? '',
        nodeCount: item.nodes.length,
        linkCount: item.links.length,
        documentCount: item.documents?.length ?? 0,
        termCount: item.nodes.filter((node) => node.nodeType === 'term').length,
      })),
      // 当前选中库的文档面板数据；未选库时为空列表（负载轻量，非 full 也返回）。
      documents: ensured ? ensured.documents : [],
      warnings,
      classroomEnabled: process.env.KNOWLEDGE_CLASSROOM_ENABLED === 'true',
      neo4jConfigured: Boolean(process.env.NEO4J_URI),
      integrity: checkGraphIntegrity(bundles),
      hits,
      detail,
      graph,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  const ctx = await beginMutation(request);
  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) return await handleUpload(request, ctx);
    const body = await request.json();
    if (body?.action === 'importBundle') return await handleImportBundle(body, ctx);
    if (body?.action === 'indexCode') return await handleIndexCode(body, ctx);
    if (body?.action === 'createLibrary') return await handleCreateLibrary(body, ctx);
    if (body?.action === 'updateLibrary') return await handleUpdateLibrary(body, ctx);
    return NextResponse.json({ error: '未知操作 action' }, { status: 400, headers: ctx.headers });
  } catch (error) {
    return errorResponse(error, ctx.headers);
  }
}

export async function PATCH(request: NextRequest) {
  const ctx = await beginMutation(request);
  try {
    const body = await request.json();
    // 图谱编辑 action 走独立处理器；文档原文编辑其次；其余请求（审核状态变更）维持原 handlePatch 行为。
    if (body && typeof body === 'object' && GRAPH_EDIT_ACTIONS.has(body.action))
      return await handleGraphEdit(body as GraphEditPayload, ctx);
    if (body?.action === 'updateDocument') return await handleUpdateDocument(body, ctx);
    if (body?.action === 'reextractDocument') return await handleReextractDocument(body, ctx, request);
    return await handlePatch(body, ctx);
  } catch (error) {
    return errorResponse(error, ctx.headers);
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = await beginMutation(request);
  try {
    return await handleDelete(await request.json(), ctx);
  } catch (error) {
    return errorResponse(error, ctx.headers);
  }
}
