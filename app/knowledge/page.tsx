'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Code2,
  FileText,
  Library as LibraryIcon,
  Loader2,
  Plus,
  RefreshCw,
  Share2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DocumentsPanel } from '@/components/knowledge/documents-panel';
import { GraphWorkspace } from '@/components/knowledge/graph-workspace/page';
import { AddLinkDialog, LinkEditorPopover } from '@/components/knowledge/link-editor';
import { LibraryList } from '@/components/knowledge/library-list';
import { NodeEditorDialog } from '@/components/knowledge/node-editor';
import { NavRail, parseViewParam, type KnowledgeView } from '@/components/knowledge/nav-rail';
import { ResourceView } from '@/components/knowledge/resource-view';
import { SharingDialog } from '@/components/knowledge/sharing-dialog';
import { StatBar } from '@/components/knowledge/stat-bar';
import { UploadQueue, type UploadQueueItem } from '@/components/knowledge/upload-queue';
import { StudentLearningSpace } from '@/components/knowledge/student-learning-space';
import { useAuth } from '@/lib/hooks/use-auth';
import {
  knowledgeApi,
  useKnowledge,
  type CatalogItem,
  type FullLink,
  type FullNode,
  type UploadItemCallback,
  type UploadResult,
} from '@/lib/hooks/use-knowledge';

const REVIEW_OPTION_LABELS: Record<string, string> = {
  unreviewed: '待审核',
  reviewed: '已审核',
  demo: '演示数据',
};

/** 无 libraryId 的直接上传响应：抽取返回 stats/warnings，JSON 导入返回 bundle。 */
interface DirectUploadResponse {
  error?: string;
  stats?: { nodes?: number; links?: number };
  warnings?: string[];
}

/** indexCode 响应。 */
interface IndexCodeResponse {
  error?: string;
  stats?: { nodes?: number; links?: number };
}

/** Radix Select 不接受空字符串 value：「新建知识库」选项的哨兵值。 */
const NEW_LIBRARY_SENTINEL = '__new__';

export default function KnowledgePage() {
  const { user, loading } = useAuth();

  if (loading) {
    return <main className="min-h-screen bg-[#f7f9fc]" aria-busy="true" />;
  }

  return user?.role === 'student' ? (
    <StudentLearningSpace userName={user.displayName} />
  ) : (
    <TeacherKnowledgePage />
  );
}

function TeacherKnowledgePage() {
  const [selectedId, setSelectedId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [nonce, setNonce] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const busy = busyKey !== null;

  // 顶部工具条：代码库索引 Dialog
  const [indexOpen, setIndexOpen] = useState(false);
  const [indexPath, setIndexPath] = useState('');
  const [indexTitle, setIndexTitle] = useState('');
  // 顶部工具条：多文件上传对话框（多选 + 选择目标知识库 + 进度条）
  const directUploadRef = useRef<HTMLInputElement>(null);
  const appendUploadRef = useRef<HTMLInputElement>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadTarget, setUploadTarget] = useState('');
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [uploadRetrying, setUploadRetrying] = useState<number | null>(null);
  const uploading = busyKey === 'upload';
  // 队列全部进入终态（成功/失败）即视为本轮上传结束：主按钮锁定为「已上传」，
  // 避免整批重复上传；失败项走单项重试。追加/移除文件或切换目标库会清空队列从而解锁。
  const uploadSettled =
    uploadQueue.length > 0 &&
    !uploading &&
    uploadQueue.every((item) => item.status === 'done' || item.status === 'error');
  const uploadHasError = uploadQueue.some((item) => item.status === 'error');

  // 图谱编辑浮层状态
  const [nodeEditorOpen, setNodeEditorOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<FullNode | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<FullLink | null>(null);
  const [linkPos, setLinkPos] = useState({ x: 0, y: 0 });
  const [addLinkOpen, setAddLinkOpen] = useState(false);
  // 共享对话框：仅对自有库开放（服务端还会再校验一次 owner）
  const [sharingOpen, setSharingOpen] = useState(false);

  const refresh = () => setNonce((value) => value + 1);

  const [view, setView] = useState<KnowledgeView>('library');

  // 地址栏同步：初始化读 ?view=，切换 pushState。规避 useSearchParams 的 Suspense 约束。
  useEffect(() => {
    const read = () => {
      setView(parseViewParam(new URLSearchParams(window.location.search).get('view')));
    };
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);

  const changeView = useCallback((next: KnowledgeView) => {
    setView(next);
    // library 是缺省视图，不写参数保持 URL 简洁；其余视图写 ?view= 支持直链分享
    const url = new URL(window.location.href);
    if (next === 'library') url.searchParams.delete('view');
    else url.searchParams.set('view', next);
    window.history.pushState(null, '', url);
  }, []);

  // 单一数据源：无选中库时返回全量 catalog；选中后按当前视图决定 full / q / node。
  const { data, loading, error } = useKnowledge({
    bundle: selectedId || undefined,
    full: view === 'graph',
    q: view === 'resources' && searchQuery ? searchQuery : undefined,
    node: view === 'resources' && nodeId ? nodeId : undefined,
    nonce,
  });

  const catalog = useMemo(() => data?.catalog ?? [], [data?.catalog]);
  const selectedItem = useMemo(
    () => catalog.find((item) => item.id === selectedId) ?? null,
    [catalog, selectedId],
  );
  const editable = selectedItem?.canEdit === true;

  // 图谱视图下 GET ?full=1 返回 FullNode；其余视图为浏览态 BrowseNode，需收窄。
  const graphNodes = useMemo(
    () => (data?.graph.nodes ?? []).filter((node): node is FullNode => 'nodeType' in node),
    [data],
  );
  const graphLinks = data?.graph.links ?? [];

  const documentsLibrary = useMemo(() => {
    if (!selectedItem) return null;
    return {
      id: selectedItem.id,
      title: selectedItem.title,
      description: selectedItem.description,
      ownerId: selectedItem.ownerId,
      reviewStatus: selectedItem.reviewStatus,
      documents: data?.documents ?? [],
    };
  }, [selectedItem, data]);

  function handleSelectLibrary(id: string) {
    if (busy || id === selectedId) return;
    setSelectedId(id);
    setNodeId('');
    setSearchQuery('');
  }

  // ---- 顶部工具条：多文件上传（新建库模式逐个 POST；并库模式走 uploadFiles）----
  function patchUploadItem(index: number, patch: Partial<UploadQueueItem>) {
    setUploadQueue((previous) =>
      previous.map((item, current) => (current === index ? { ...item, ...patch } : item)),
    );
  }

  /** 无目标库：单文件直接导入（JSON 原样导入 / md·txt·pdf 抽取为独立知识包）。 */
  async function uploadAsNewLibrary(file: File): Promise<UploadResult> {
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/knowledge', {
        method: 'POST',
        body: form,
        cache: 'no-store',
      });
      const body = (await response.json().catch(() => ({}))) as DirectUploadResponse;
      if (!response.ok) {
        return {
          filename: file.name,
          ok: false,
          error: body.error || `上传失败（HTTP ${response.status}）`,
        };
      }
      return {
        filename: file.name,
        ok: true,
        documentId: '',
        stats: { nodes: body.stats?.nodes ?? 0, links: body.stats?.links ?? 0 },
      };
    } catch (reason) {
      return {
        filename: file.name,
        ok: false,
        error: reason instanceof Error ? reason.message : '上传失败',
      };
    }
  }

  /** 统一上传入口：target 为空 → 逐文件新建库；否则并入指定知识库。 */
  async function runUpload(
    files: File[],
    target: string,
    onItem: UploadItemCallback,
  ): Promise<UploadResult[]> {
    if (target) return knowledgeApi.uploadFiles(target, files, onItem);
    const results: UploadResult[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      onItem(index, 'waiting');
      onItem(index, 'extracting');
      const result = await uploadAsNewLibrary(file);
      results.push(result);
      onItem(index, result.ok ? 'done' : 'error', result.ok ? undefined : result.error);
    }
    return results;
  }

  function summarizeUpload(results: UploadResult[]) {
    const successCount = results.filter((result) => result.ok).length;
    const failureCount = results.length - successCount;
    if (failureCount === 0) {
      toast.success(`上传完成：${successCount} 个文件全部成功`);
    } else if (successCount > 0) {
      toast.warning(`上传结束：成功 ${successCount} 个，失败 ${failureCount} 个`);
    } else {
      toast.error(`上传失败：${failureCount} 个文件均未成功，可逐项重试`);
    }
    return successCount;
  }

  async function handleStartUpload() {
    if (busy || uploadFiles.length === 0 || uploadSettled) return;
    const target = uploadTarget === NEW_LIBRARY_SENTINEL ? '' : uploadTarget;
    setBusyKey('upload');
    setUploadQueue(uploadFiles.map((file) => ({ file, status: 'waiting' as const })));
    try {
      const results = await runUpload(uploadFiles, target, (index, status, detail) =>
        patchUploadItem(index, { status, detail }),
      );
      if (summarizeUpload(results) > 0) refresh();
    } finally {
      setBusyKey(null);
    }
  }

  async function handleUploadRetry(index: number) {
    const item = uploadQueue[index];
    if (!item || uploadRetrying !== null || busy) return;
    setUploadRetrying(index);
    setBusyKey('upload');
    patchUploadItem(index, { status: 'extracting', detail: undefined });
    try {
      const target = uploadTarget === NEW_LIBRARY_SENTINEL ? '' : uploadTarget;
      const results = await runUpload([item.file], target, (_, status, detail) =>
        patchUploadItem(index, { status, detail }),
      );
      const result = results[0];
      if (result?.ok) {
        toast.success(`「${item.file.name}」重新上传成功`);
        refresh();
      } else if (result) {
        toast.error(`「${item.file.name}」仍然失败：${result.error}`);
      }
    } finally {
      setUploadRetrying(null);
      setBusyKey(null);
    }
  }

  function handlePickFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setUploadFiles(files);
    setUploadQueue([]);
    setUploadTarget(NEW_LIBRARY_SENTINEL);
    setUploadOpen(true);
  }

  /** 弹窗内「继续添加」：追加到已选清单，按 名称+大小 去重。 */
  function handleAppendFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (picked.length === 0) return;
    setUploadFiles((previous) => {
      const seen = new Set(previous.map((file) => `${file.name}:${file.size}`));
      const merged = [...previous];
      for (const file of picked) {
        const key = `${file.name}:${file.size}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(file);
      }
      return merged;
    });
    setUploadQueue([]);
  }

  function removeUploadFile(index: number) {
    setUploadFiles((previous) => previous.filter((_, position) => position !== index));
    setUploadQueue([]);
  }

  // ---- 顶部工具条：代码仓库索引（逻辑搬迁自旧版 indexRepo）----
  async function handleIndexCode() {
    if (busy) return;
    const path = indexPath.trim();
    if (!path) {
      toast.error('请填写仓库路径');
      return;
    }
    if (path.includes('..')) {
      toast.error('仓库路径不允许包含 ..');
      return;
    }
    setBusyKey('index');
    try {
      const response = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'indexCode', path, title: indexTitle.trim() || undefined }),
      });
      const body = (await response.json().catch(() => ({}))) as IndexCodeResponse;
      if (!response.ok) {
        const fallback =
          response.status === 403
            ? '无权创建同名代码知识包'
            : response.status === 500
              ? '索引失败，请检查仓库路径'
              : '代码仓库索引失败';
        toast.error(body.error || fallback);
        return;
      }
      toast.success(
        body.stats
          ? `代码仓库索引完成：${body.stats.nodes ?? 0} 个知识点、${body.stats.links ?? 0} 条关系`
          : '代码仓库索引完成',
      );
      setIndexOpen(false);
      setIndexPath('');
      setIndexTitle('');
      refresh();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '代码仓库索引失败');
    } finally {
      setBusyKey(null);
    }
  }

  // ---- 顶部工具条：同步图谱 ----
  async function handleSync() {
    if (busy) return;
    setBusyKey('sync');
    try {
      const result = await knowledgeApi.sync();
      const parts = [
        result.synced === false ? '图谱未同步' : '图谱同步完成',
        `后端：${result.backend ?? '-'}`,
      ];
      if (typeof result.created === 'number') parts.push(`新建 ${result.created} 个节点`);
      if (result.warning) parts.push(result.warning);
      if (result.synced === false) toast.error(parts.join('；'));
      else toast.success(parts.join('；'));
      refresh();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '图谱同步失败');
    } finally {
      setBusyKey(null);
    }
  }

  // ---- 左栏：审核状态（共享包无 ownerId 也可改，保持旧版语义）----
  async function handleReview(id: string, reviewStatus: string): Promise<void> {
    if (busy) throw new Error('操作进行中，请稍候');
    setBusyKey(`review:${id}`);
    try {
      await knowledgeApi.setReview(id, reviewStatus);
      const label = REVIEW_OPTION_LABELS[reviewStatus] ?? reviewStatus;
      const title = catalog.find((item) => item.id === id)?.title ?? id;
      toast.success(`「${title}」审核状态已切换为${label}`);
      refresh();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '审核状态更新失败');
      throw reason;
    } finally {
      setBusyKey(null);
    }
  }

  // ---- 左栏：删除整库（仅 ownerId 存在时卡片显示入口）----
  async function handleDeleteLibrary(item: CatalogItem): Promise<void> {
    if (busy) throw new Error('操作进行中，请稍候');
    setBusyKey(`delete:${item.id}`);
    try {
      await knowledgeApi.deleteBundle(item.id);
      toast.success(`已删除「${item.title}」`);
      if (selectedId === item.id) {
        setSelectedId('');
        setNodeId('');
        setSearchQuery('');
      }
      refresh();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '知识包删除失败');
      throw reason;
    } finally {
      setBusyKey(null);
    }
  }

  // ---- 图谱：节点 / 边编辑入口（共享 / 演示只读库不响应）----
  function handleEditNode(node: FullNode | null) {
    if (!editable) return;
    setEditingNode(node);
    setNodeEditorOpen(true);
  }

  function handleEditLink(link: FullLink, x: number, y: number) {
    if (!editable) return;
    setEditingLink(link);
    setLinkPos({ x, y });
    setLinkOpen(true);
  }

  return (
    <main className="min-h-screen bg-muted/30 py-4 md:py-7">
      <div className="mx-auto max-w-[1680px] space-y-5 px-4 md:px-7">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border/70 bg-card px-6 py-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-primary">教师工作台 · 知识资产</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">知识库资源</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              拖动图谱节点梳理知识关系，检索知识点详情并就地修改，为课堂准备可追溯的学习材料。
            </p>
          </div>
          <Link
            className="rounded-xl border bg-background px-4 py-2 text-sm font-medium shadow-sm transition hover:border-primary/40 hover:text-primary"
            href="/"
          >
            返回课堂首页
          </Link>
        </header>

        <StatBar
          catalog={catalog}
          backend={
            data?.graphBackend ?? {
              backend: 'json',
              configured: false,
              deployment: 'unknown' as const,
            }
          }
          integrityCount={data?.integrity.issues.length ?? 0}
        />

        <Card className="border-border/70 bg-card shadow-sm">
          <CardContent className="flex flex-wrap items-center gap-2 p-4 md:p-5">
            <Button
              variant="outline"
              onClick={() => directUploadRef.current?.click()}
              disabled={busy}
            >
              {busyKey === 'upload' ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Upload aria-hidden />
              )}
              上传资料
            </Button>
            <input
              ref={directUploadRef}
              type="file"
              multiple
              accept=".json,.md,.txt,.pdf"
              className="hidden"
              onChange={handlePickFiles}
            />
            <Button variant="outline" onClick={() => setIndexOpen(true)} disabled={busy}>
              <Code2 aria-hidden />
              索引代码仓库
            </Button>
            <Button
              variant="outline"
              onClick={() => setSharingOpen(true)}
              disabled={busy || !editable}
              title={editable ? '共享当前资料库' : '请先选择自己拥有的资料库'}
            >
              <Share2 aria-hidden />
              共享
            </Button>
            <Button variant="outline" onClick={() => void handleSync()} disabled={busy}>
              {busyKey === 'sync' ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <RefreshCw aria-hidden />
              )}
              同步图谱
            </Button>
            <p className="w-full text-xs text-muted-foreground sm:ml-auto sm:w-auto">
              可一次多选上传：.json 知识包导入，.md / .txt / .pdf
              自动抽取；上传前可指定目标知识库；单个文件不超过 50 MB
            </p>
          </CardContent>
        </Card>

        <p className="rounded-2xl border border-primary/10 bg-primary/5 p-3 text-sm text-muted-foreground">
          支持多文件上传并指定目标知识库；课堂自动引用
          {data?.classroomEnabled ? '已开启，仅使用已审核知识包' : '未开启'}。
        </p>

        {data?.warnings.map((warning) => (
          <p
            key={warning}
            role="status"
            className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {warning}
          </p>
        ))}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {loading && (
          <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            正在加载…
          </p>
        )}

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(72px,280px)_minmax(0,1fr)]">
          <div className="sticky top-5">
            <NavRail
              view={view}
              onViewChange={changeView}
              catalog={catalog}
              selectedId={selectedId}
              onSelectLibrary={handleSelectLibrary}
              busy={busy}
              libraryList={
                view === 'library' ? (
                  <LibraryList
                    catalog={catalog}
                    selectedId={selectedId}
                    onSelect={handleSelectLibrary}
                    onChanged={refresh}
                    busy={busy}
                    onReview={handleReview}
                    onDeleteLibrary={handleDeleteLibrary}
                  />
                ) : undefined
              }
            />
          </div>

          <section className="min-w-0 rounded-3xl" aria-busy={loading}>
            {selectedItem ? (
              view === 'library' ? (
                // 资料库视图 = 原「文档」Tab 内容原样搬入
                documentsLibrary ? (
                  <DocumentsPanel library={documentsLibrary} onChanged={refresh} />
                ) : null
              ) : view === 'graph' ? (
                <GraphWorkspace
                  nodes={graphNodes}
                  links={graphLinks}
                  editable={editable}
                  bundleId={selectedItem.id}
                  changedNonce={nonce}
                  onRefresh={refresh}
                  loading={loading}
                  onEditNode={handleEditNode}
                  onEditLink={handleEditLink}
                  onAddLink={() => setAddLinkOpen(true)}
                  backend={data?.neo4jConfigured ? 'neo4j' : 'json'}
                />
              ) : (
                <ResourceView
                  data={data}
                  bundleId={selectedItem.id}
                  editable={editable}
                  reviewStatus={selectedItem.reviewStatus}
                  loading={loading}
                  searchQuery={searchQuery}
                  onSearchQuery={(value) => {
                    setSearchQuery(value);
                    setNodeId('');
                  }}
                  nodeId={nodeId}
                  onNodeSelect={setNodeId}
                  onEditNode={handleEditNode}
                  refreshNonce={nonce}
                  documentsLibrary={documentsLibrary}
                  onChanged={refresh}
                  onUploadDocs={() => directUploadRef.current?.click()}
                  onIndexCode={() => setIndexOpen(true)}
                  onSync={() => void handleSync()}
                />
              )
            ) : (
              <Card>
                <CardContent className="flex min-h-[320px] flex-col items-center justify-center gap-3 p-6 text-center">
                  <LibraryIcon className="size-10 text-muted-foreground" aria-hidden />
                  <p className="text-sm text-muted-foreground">从左侧选择资料库，或新建一个开始</p>
                </CardContent>
              </Card>
            )}
          </section>
        </div>

        {/* 代码仓库索引 Dialog */}
        <Dialog
          open={indexOpen}
          onOpenChange={(open) => {
            if (!busy) setIndexOpen(open);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>索引代码仓库</DialogTitle>
              <DialogDescription>
                索引服务器可访问目录中的代码，生成可检索的代码知识包。
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void handleIndexCode();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="repo-path">仓库路径</Label>
                <Input
                  id="repo-path"
                  value={indexPath}
                  onChange={(event) => setIndexPath(event.target.value)}
                  placeholder="仓库路径（服务器可访问的目录）"
                  maxLength={500}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="repo-title">知识包标题</Label>
                <Input
                  id="repo-title"
                  value={indexTitle}
                  onChange={(event) => setIndexTitle(event.target.value)}
                  placeholder="标题（可选）"
                  maxLength={200}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIndexOpen(false)}
                  disabled={busy}
                >
                  取消
                </Button>
                <Button type="submit" disabled={busy}>
                  {busyKey === 'index' && <Loader2 className="animate-spin" aria-hidden />}
                  开始索引
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* 多文件上传 Dialog：多选文件 + 指定目标知识库 + 总进度条 */}
        <Dialog
          open={uploadOpen}
          onOpenChange={(open) => {
            if (!uploading) setUploadOpen(open);
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>上传资料</DialogTitle>
              <DialogDescription>
                已选择 {uploadFiles.length}{' '}
                个文件，可一次多选或点「继续添加」追加，指定目标知识库后统一上传。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>已选文件（{uploadFiles.length}）</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => appendUploadRef.current?.click()}
                    disabled={uploading || uploadRetrying !== null}
                  >
                    <Plus aria-hidden />
                    继续添加文件
                  </Button>
                </div>
                <input
                  ref={appendUploadRef}
                  type="file"
                  multiple
                  accept=".json,.md,.txt,.pdf"
                  className="hidden"
                  onChange={handleAppendFiles}
                />
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                  {uploadFiles.map((file, index) => (
                    <li
                      key={`${file.name}:${file.size}:${index}`}
                      className="flex items-center gap-2 text-sm"
                    >
                      <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate" title={file.name}>
                        {file.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {(file.size / 1024).toFixed(1)} KB
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`移除 ${file.name}`}
                        disabled={uploading || uploadRetrying !== null}
                        onClick={() => removeUploadFile(index)}
                      >
                        <X aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <Label htmlFor="upload-target">目标知识库</Label>
                <Select
                  value={uploadTarget}
                  onValueChange={(value) => {
                    // 更改目标知识库 = 更改上传资料：清空进度，重新允许「开始上传」
                    setUploadTarget(value);
                    setUploadQueue([]);
                  }}
                  disabled={uploading || uploadRetrying !== null}
                >
                  <SelectTrigger id="upload-target" className="w-full">
                    <SelectValue placeholder="选择目标知识库" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW_LIBRARY_SENTINEL}>
                      新建知识库（每个文件单独一个）
                    </SelectItem>
                    {catalog.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {uploadTarget && uploadTarget !== NEW_LIBRARY_SENTINEL
                    ? '文件将经 AI 抽取后并入所选知识库（.md / .txt / .pdf）。'
                    : '每个文件将导入/抽取为独立知识库，上传后可在左栏审核。'}
                </p>
              </div>

              {uploadQueue.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>总进度</span>
                    <span>
                      {
                        uploadQueue.filter(
                          (item) => item.status === 'done' || item.status === 'error',
                        ).length
                      }
                      /{uploadQueue.length}
                    </span>
                  </div>
                  <Progress
                    value={
                      uploadQueue.length
                        ? (uploadQueue.filter(
                            (item) => item.status === 'done' || item.status === 'error',
                          ).length /
                            uploadQueue.length) *
                          100
                        : 0
                    }
                  />
                  <UploadQueue
                    items={uploadQueue}
                    retryingIndex={uploadRetrying}
                    onRetry={(index) => void handleUploadRetry(index)}
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setUploadOpen(false)}
                disabled={uploading || uploadRetrying !== null}
              >
                {uploadQueue.length > 0 ? '关闭' : '取消'}
              </Button>
              <Button
                onClick={() => void handleStartUpload()}
                disabled={busy || uploadFiles.length === 0 || uploadSettled}
              >
                {uploading && <Loader2 className="animate-spin" aria-hidden />}
                {uploading
                  ? '上传中…'
                  : uploadSettled
                    ? uploadHasError
                      ? '上传结束（可单项重试）'
                      : '已上传'
                    : `开始上传（${uploadFiles.length} 个文件）`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 图谱节点 / 边编辑器：仅选中自有库时可交互 */}
        {selectedItem && (
          <>
            <NodeEditorDialog
              open={nodeEditorOpen}
              libraryId={selectedItem.id}
              node={editingNode}
              onOpenChange={setNodeEditorOpen}
              onSaved={refresh}
            />
            <LinkEditorPopover
              open={linkOpen}
              x={linkPos.x}
              y={linkPos.y}
              link={editingLink}
              libraryId={selectedItem.id}
              onOpenChange={setLinkOpen}
              onSaved={refresh}
            />
            <AddLinkDialog
              open={addLinkOpen}
              libraryId={selectedItem.id}
              nodes={graphNodes}
              onOpenChange={setAddLinkOpen}
              onSaved={refresh}
            />
            <SharingDialog
              open={sharingOpen}
              libraryId={selectedItem.id}
              libraryTitle={selectedItem.title}
              onOpenChange={setSharingOpen}
            />
          </>
        )}
      </div>
    </main>
  );
}
