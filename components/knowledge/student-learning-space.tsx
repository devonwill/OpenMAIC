'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FileText,
  Image as ImageIcon,
  Library,
  LockKeyhole,
  Network,
  PlayCircle,
  Search,
  Sparkles,
  Tag,
  Volume2,
} from 'lucide-react';
import { GraphCanvas } from '@/components/knowledge/graph-canvas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  knowledgeApi,
  useKnowledge,
  type CatalogItem,
  type FullNode,
  type FullLink,
} from '@/lib/hooks/use-knowledge';
import { StreamdownMarkdown } from '@/components/knowledge/streamdown-markdown';

type SharedMedia = {
  materialId: string;
  resourceType?: 'asset' | 'material';
  bytesUrl?: string;
  mime?: string;
  originalName?: string;
  createdAt: string;
};

/**
 * Student-only knowledge surface. Data is deliberately restricted to entries
 * the server marks as readable by the current owner; mutation controls are never
 * rendered. Server-side ownership checks remain the authority for every API request.
 */
export function StudentLearningSpace({ userName }: { userName: string }) {
  const [view, setView] = useState<'learning' | 'graph' | 'resources'>('learning');
  const [collapsed, setCollapsed] = useState(false);
  const [libraryId, setLibraryId] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [query, setQuery] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [document, setDocument] = useState<string | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [media, setMedia] = useState<SharedMedia[]>([]);
  // search 提交状态：只有按 Enter / 点搜索按钮才把 q 传到服务端。
  // 持续打字时用纯客户端 filter 反馈，避免每次按键都重发请求。
  const [committedQuery, setCommittedQuery] = useState('');
  const { data, loading, error, reload } = useKnowledge({
    bundle: libraryId || undefined,
    full: true,
    node: nodeId || undefined,
    q: committedQuery || undefined,
  });

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/resources/media', { cache: 'no-store' })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as { materials?: SharedMedia[] })
          : { materials: [] },
      )
      .then((payload) => {
        if (!cancelled) setMedia(payload.materials ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 学生可见的资料库：后端 bundles 已经按 canRead 过滤过（server 是 single source of truth），
  // 这里再排除「自己建的」（canEdit=true）即可——教师公开 / 显式分享给学生的都应该出现。
  const sharedLibraries = useMemo(
    () => (data?.catalog ?? []).filter((item) => item.canEdit !== true),
    [data?.catalog],
  );

  useEffect(() => {
    if (libraryId || !sharedLibraries[0]) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first allowed library seeds the next authenticated fetch.
    setLibraryId(sharedLibraries[0].id);
  }, [libraryId, sharedLibraries]);

  // Defaults are derived, not written from an effect: first paint needs no
  // follow-up state update and a revoked share simply falls back to the next
  // allowed library.
  const activeLibraryId = sharedLibraries.some((item) => item.id === libraryId)
    ? libraryId
    : (sharedLibraries[0]?.id ?? '');
  const library = sharedLibraries.find((item) => item.id === activeLibraryId) ?? null;
  const nodes = useMemo(
    () => (data?.graph.nodes ?? []).filter((node): node is FullNode => 'nodeType' in node),
    [data?.graph.nodes],
  );
  const links = useMemo<FullLink[]>(() => data?.graph.links ?? [], [data?.graph.links]);

  // 服务端返回的 hits 已经是按 q 搜过的命中节点（高优先）；客户端 filter 是兜底
  // —— 学生在「我的学习」视图里 typed 实时搜索时立刻给反馈，无需等服务端。
  const localMatches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return nodes;
    return nodes.filter((node) => {
      const hay =
        `${node.name} ${node.category} ${node.aliases?.join(' ') ?? ''} ${node.content}`.toLowerCase();
      return hay.includes(normalized);
    });
  }, [nodes, query]);
  // 服务端 hits 优先（带命中字段），按 score 排序；
  // 没有服务端 q 时回退到客户端 filter 实时结果。
  const matchedNodes = useMemo(() => {
    if (!committedQuery) return localMatches;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const seen = new Set<string>();
    const out: FullNode[] = [];
    for (const hit of data?.hits ?? []) {
      const node = byId.get(hit.node.id);
      if (node && !seen.has(node.id)) {
        seen.add(node.id);
        out.push(node);
      }
    }
    for (const node of localMatches) {
      if (!seen.has(node.id) && out.length < 24) {
        seen.add(node.id);
        out.push(node);
      }
    }
    return out;
  }, [committedQuery, data?.hits, nodes, localMatches]);

  // selectedNode 必须从当前图谱的 nodes 里查，避免「切到 A 库后仍展示 B 库的 detail」。
  const selectedNode = useMemo(() => {
    if (!nodeId) return null;
    return nodes.find((node) => node.id === nodeId) ?? data?.detail ?? null;
  }, [nodeId, nodes, data?.detail]);

  // 节点「邻居」计数（连入 + 连出）—— 在节点详情卡片里给出一个量化的「关联强度」。
  const neighborCount = useMemo(() => {
    if (!selectedNode) return 0;
    return links.filter(
      (link) => link.source === selectedNode.id || link.target === selectedNode.id,
    ).length;
  }, [links, selectedNode]);

  const activeDocumentId = data?.documents.some((item) => item.id === documentId)
    ? documentId
    : (data?.documents[0]?.id ?? '');

  useEffect(() => {
    if (!activeLibraryId || !activeDocumentId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marks the asynchronous document request as pending.
    setDocumentLoading(true);
    void knowledgeApi
      .getDocument(activeLibraryId, activeDocumentId)
      .then((content) => {
        if (!cancelled) setDocument(content);
      })
      .catch(() => {
        if (!cancelled) setDocument(null);
      })
      .finally(() => {
        if (!cancelled) setDocumentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeLibraryId, activeDocumentId]);

  const pickLibrary = (next: CatalogItem) => {
    setLibraryId(next.id);
    setNodeId('');
    setDocumentId('');
    setDocument(null);
  };

  const submitSearch = (event?: React.FormEvent) => {
    event?.preventDefault();
    const nextQuery = query.trim();
    setCommittedQuery(nextQuery);
    setNodeId('');
    if (nextQuery) setView('graph');
  };

  return (
    <main className="min-h-screen bg-brand-soft text-slate-900 selection:bg-accent-orange/25">
      <div
        className={`mx-auto grid min-h-screen max-w-[1680px] ${collapsed ? 'lg:grid-cols-[76px_minmax(0,1fr)]' : 'lg:grid-cols-[228px_minmax(0,1fr)]'} transition-[grid-template-columns] duration-200`}
      >
        <aside
          className={`relative hidden border-r border-brand/10 bg-white/85 py-7 lg:flex lg:flex-col ${collapsed ? 'px-3' : 'px-4'}`}
        >
          <Link
            href="/"
            className={`flex items-center gap-3 px-2 text-brand ${collapsed ? 'justify-center' : ''}`}
          >
            <span className="grid size-10 place-items-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/20">
              <BookOpen className="size-5" />
            </span>
            {!collapsed ? (
              <span>
                <b className="block text-base">学习空间</b>
                <small className="text-xs text-slate-500">老师共享知识库</small>
              </span>
            ) : null}
          </Link>
          <nav className="mt-12 space-y-2 text-sm font-medium">
            <NavButton
              active={view === 'learning'}
              collapsed={collapsed}
              onClick={() => setView('learning')}
              icon={<Sparkles className="size-4" />}
              label="我的学习"
              hint="课程媒体资源"
            />
            <NavButton
              active={view === 'graph'}
              collapsed={collapsed}
              onClick={() => setView('graph')}
              icon={<Network className="size-4" />}
              label="知识图谱"
              hint="查询与节点信息"
            />
            <NavButton
              active={view === 'resources'}
              collapsed={collapsed}
              onClick={() => setView('resources')}
              icon={<Library className="size-4" />}
              label="共享资料"
              hint="文本、图片和视频"
            />
          </nav>
          {!collapsed ? (
            <div className="mt-auto rounded-2xl bg-brand-soft p-4 text-xs leading-5 text-brand">
              <CircleHelp className="mb-2 size-4 text-accent-orange" />
              所有资料均由老师授权共享。你可以搜索、阅读和播放，但不能修改原始内容。
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="absolute -right-3 top-8 grid size-6 place-items-center rounded-full border border-brand/15 bg-white text-brand shadow-sm hover:border-accent-orange"
            aria-label={collapsed ? '展开主目录' : '收缩主目录'}
          >
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </button>
        </aside>

        <section className="min-w-0 px-4 py-5 sm:px-7 lg:px-9">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-brand/10 pb-5">
            <div>
              <p className="text-sm font-medium text-accent-orange">你好，{userName}同学</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-brand">
                {view === 'learning' ? '我的学习' : view === 'graph' ? '知识图谱' : '共享资料'}
              </h1>
            </div>
            <div className="flex items-center gap-3 rounded-full bg-white px-4 py-2 text-xs text-slate-500 shadow-sm">
              <span className="size-2 rounded-full bg-accent-orange" /> 只读学习模式
            </div>
          </header>

          <form onSubmit={submitSearch} className="mt-5 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[250px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-10 rounded-xl border-brand/15 bg-white pl-10 pr-20 shadow-sm"
                placeholder="搜索概念、主题或内容…"
                aria-label="搜索节点"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              className="h-10 rounded-xl bg-brand px-4 text-white shadow-sm hover:bg-brand-deep"
            >
              搜索
            </Button>
            <div className="relative">
              <select
                aria-label="选择老师分享的知识库"
                value={activeLibraryId}
                onChange={(event) => {
                  const next = sharedLibraries.find((item) => item.id === event.target.value);
                  if (next) pickLibrary(next);
                }}
                className="h-10 appearance-none rounded-xl border border-brand/15 bg-white py-2 pl-3 pr-9 text-sm text-brand shadow-sm"
              >
                <option value="">选择共享知识库</option>
                {sharedLibraries.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-3 size-4 text-brand" />
            </div>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setCommittedQuery('');
                setNodeId('');
              }}
              className="h-10 rounded-xl border border-brand/15 bg-white px-3 text-xs text-slate-500 shadow-sm hover:border-accent-orange hover:text-brand"
              aria-label="清空搜索"
            >
              清空
            </button>
          </form>

          {error ? (
            <p className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
          {!loading && sharedLibraries.length === 0 ? (
            <EmptySharedLibraries onRetry={reload} />
          ) : null}
          {library && view === 'learning' ? (
            <StudentLearningOverview
              library={library}
              documentCount={data?.documents.length ?? 0}
              onOpenGraph={() => setView('graph')}
              onOpenResources={() => setView('resources')}
            />
          ) : null}
          {library && view === 'resources' ? (
            <StudentResourceShelf
              documents={data?.documents ?? []}
              activeDocumentId={activeDocumentId}
              document={document}
              documentLoading={documentLoading}
              media={media}
              onDocument={setDocumentId}
            />
          ) : null}
          {library && view === 'graph' ? (
            <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)]">
              <section className="overflow-hidden rounded-3xl border border-brand/10 bg-white shadow-[0_16px_45px_-28px_rgba(0,58,120,.45)]">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-brand/10 px-5 py-4">
                  <div>
                    <p className="text-xs font-medium text-accent-orange">知识图谱</p>
                    <h2 className="mt-1 font-semibold text-brand">{library.title}</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      探索概念之间的关系，找到你的学习线索。
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand">
                    <LockKeyhole className="size-3" /> 教师共享 · 只读
                  </span>
                </div>
                <div className="p-3">
                  <GraphCanvas
                    nodes={nodes}
                    links={links}
                    editable={false}
                    onEditNode={() => {}}
                    onEditLink={() => {}}
                    onAddLink={() => {}}
                    focusNodeId={nodeId || null}
                    onSelectNode={(node) => setNodeId(node?.id ?? '')}
                  />
                </div>
              </section>

              <GraphInfoPanel
                library={library}
                node={selectedNode}
                neighborCount={neighborCount}
                linkCount={links.length}
              />
            </div>
          ) : null}

          {library && view === 'graph' && (query.trim() || committedQuery) ? (
            <SearchResultsPanel
              nodes={matchedNodes.slice(0, 24)}
              onPick={(next) => setNodeId(next)}
              total={matchedNodes.length}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}

function NavButton({
  active,
  collapsed,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${active ? 'bg-brand text-white shadow-sm' : 'text-slate-500 hover:bg-brand-soft hover:text-brand'} ${collapsed ? 'justify-center px-2' : ''}`}
    >
      {icon}
      {!collapsed ? (
        <span>
          <span className="block">{label}</span>
          <small
            className={`block pt-0.5 text-[10px] font-normal ${active ? 'text-white/70' : 'text-slate-400'}`}
          >
            {hint}
          </small>
        </span>
      ) : null}
    </button>
  );
}

function StudentLearningOverview({
  library,
  documentCount,
  onOpenGraph,
  onOpenResources,
}: {
  library: CatalogItem;
  documentCount: number;
  onOpenGraph: () => void;
  onOpenResources: () => void;
}) {
  return (
    <div className="mt-5 space-y-5">
      <section className="rounded-3xl bg-brand p-7 text-white shadow-xl shadow-brand/15">
        <p className="text-sm text-white/70">当前课程资料库</p>
        <h2 className="mt-1 text-2xl font-semibold">{library.title}</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75">
          {library.description ||
            '老师已为你整理课程媒体、知识图谱和可阅读资料。按自己的节奏开始学习。'}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <span className="rounded-full bg-white/15 px-3 py-1.5 text-sm">
            {documentCount} 份学习资料
          </span>
          <span className="rounded-full bg-white/15 px-3 py-1.5 text-sm">
            {library.nodeCount} 个知识节点
          </span>
        </div>
      </section>
      <div className="grid gap-5 md:grid-cols-2">
        <button
          type="button"
          onClick={onOpenGraph}
          className="rounded-3xl border border-brand/10 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-accent-orange"
        >
          <Network className="size-7 text-accent-orange" />
          <h3 className="mt-5 font-semibold text-brand">沿着知识图谱学习</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            查看整体关系，搜索概念，并打开节点中的老师讲解。
          </p>
        </button>
        <button
          type="button"
          onClick={onOpenResources}
          className="rounded-3xl border border-brand/10 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-accent-orange"
        >
          <PlayCircle className="size-7 text-accent-orange" />
          <h3 className="mt-5 font-semibold text-brand">打开课程媒体与资料</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            集中查看老师分享的 Markdown 文本、图片、视频和音频。
          </p>
        </button>
      </div>
    </div>
  );
}

function StudentResourceShelf({
  documents,
  activeDocumentId,
  document,
  documentLoading,
  media,
  onDocument,
}: {
  documents: { id: string; title: string }[];
  activeDocumentId: string;
  document: string | null;
  documentLoading: boolean;
  media: SharedMedia[];
  onDocument: (id: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const matches = media.filter((item) =>
    `${item.originalName ?? ''} ${item.mime ?? ''}`
      .toLowerCase()
      .includes(filter.trim().toLowerCase()),
  );
  const matchingDocuments = documents.filter((item) =>
    item.title.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-[310px_minmax(0,1fr)]">
      <aside className="rounded-3xl border border-brand/10 bg-white p-4 shadow-sm">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="h-9 pl-9 text-sm"
            placeholder="查询图片、视频、音频"
          />
        </div>
        <p className="mt-5 px-2 text-xs font-semibold text-slate-500">老师共享的媒体</p>
        <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
          {matches.map((item) => (
            <a
              key={`${item.resourceType}-${item.materialId}`}
              href={item.bytesUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-xl p-3 text-sm hover:bg-brand-soft"
            >
              {item.mime?.startsWith('video/') ? (
                <PlayCircle className="size-4 shrink-0 text-accent-orange" />
              ) : item.mime?.startsWith('audio/') ? (
                <Volume2 className="size-4 shrink-0 text-accent-orange" />
              ) : (
                <ImageIcon className="size-4 shrink-0 text-accent-orange" />
              )}
              <span className="line-clamp-2">{item.originalName || '未命名媒体'}</span>
            </a>
          ))}
          {matches.length === 0 ? (
            <p className="p-3 text-xs text-slate-400">暂无匹配的共享媒体</p>
          ) : null}
        </div>
        <p className="mt-5 px-2 text-xs font-semibold text-slate-500">Markdown 文本资料</p>
        <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
          {matchingDocuments.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => onDocument(item.id)}
              className={`flex w-full items-center gap-2 rounded-xl p-3 text-left text-sm ${activeDocumentId === item.id ? 'bg-brand-soft text-brand' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <FileText className="size-4 shrink-0 text-accent-orange" />
              <span className="line-clamp-2">{item.title}</span>
            </button>
          ))}
          {matchingDocuments.length === 0 ? (
            <p className="p-3 text-xs text-slate-400">暂无匹配的文本资料</p>
          ) : null}
        </div>
      </aside>
      <article className="min-h-[620px] rounded-3xl border border-brand/10 bg-white p-6 shadow-sm">
        {documentLoading ? (
          <p className="py-24 text-center text-sm text-slate-400">正在解析 Markdown 学习资料…</p>
        ) : document ? (
          <StreamdownMarkdown markdown={document} className="student-markdown" />
        ) : (
          <p className="py-24 text-center text-sm text-slate-400">请选择一份文本资料开始阅读</p>
        )}
      </article>
    </div>
  );
}

function SearchResultsPanel({
  nodes,
  onPick,
  total,
}: {
  nodes: FullNode[];
  onPick: (id: string) => void;
  total: number;
}) {
  if (nodes.length === 0) {
    return (
      <section className="mt-5 rounded-2xl border border-brand/10 bg-white p-5 text-sm text-slate-500">
        没有找到与该关键词相关的节点，试试换个更短的词或在图谱里直接点选概念。
      </section>
    );
  }
  return (
    <section className="mt-5 rounded-2xl border border-brand/10 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-sm font-semibold text-brand">与你的搜索相关</p>
        <span className="text-xs text-slate-400">
          显示 {nodes.length} / {total} 个结果
        </span>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {nodes.map((node) => (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onPick(node.id)}
              className="group flex w-full flex-col items-start gap-1 rounded-2xl border border-brand/10 bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-accent-orange hover:shadow-md"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-brand">
                <Tag className="size-3.5 text-accent-orange" />
                {node.name}
              </span>
              {node.category ? (
                <span className="text-[11px] text-slate-500">{node.category}</span>
              ) : null}
              {node.content ? (
                <p className="line-clamp-2 text-xs text-slate-500">
                  {node.content
                    .replace(/[#>*_`\-\[\]\(\)!]/g, ' ')
                    .trim()
                    .slice(0, 80)}
                </p>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GraphInfoPanel({
  library,
  node,
  neighborCount,
  linkCount,
}: {
  library: CatalogItem;
  node: FullNode | null;
  neighborCount: number;
  linkCount: number;
}) {
  return (
    <article className="min-h-[620px] overflow-hidden rounded-3xl border border-brand/10 bg-white shadow-[0_16px_45px_-28px_rgba(0,58,120,.45)]">
      <div className="border-b border-brand/10 bg-brand-soft px-6 py-4">
        <p className="flex items-center gap-2 text-xs font-medium text-brand">
          <Network className="size-3.5 text-accent-orange" />
          图谱信息与节点操作
        </p>
      </div>
      <div className="px-6 py-5">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <Stat label="图谱节点" value={library.nodeCount} />
          <Stat label="关系连线" value={linkCount} />
          <Stat label="图谱类型" value={library.kind || '知识图谱'} />
          <Stat label="当前状态" value="只读探索" />
        </div>
        {node ? (
          <NodeReader node={node} neighborCount={neighborCount} />
        ) : (
          <div className="py-24 text-center">
            <Network className="mx-auto mb-3 size-8 text-accent-orange" />
            <h2 className="font-semibold text-brand">选择一个知识节点</h2>
            <p className="mt-2 text-sm text-slate-500">
              点击图谱节点，或在顶部搜索并选择结果，查看节点属性和关联关系。
            </p>
          </div>
        )}
      </div>
    </article>
  );
}

function NodeReader({ node, neighborCount }: { node: FullNode; neighborCount: number }) {
  const attributeEntries = Object.entries(node.attributes ?? {}).filter(
    ([, value]) => value !== '' && value != null,
  );
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-1 text-xs font-medium text-accent-orange">{node.category || '概念'}</p>
        <h2 className="text-2xl font-semibold text-brand">{node.name}</h2>
        {node.aliases?.length ? (
          <p className="mt-2 text-xs text-slate-500">又名：{node.aliases.join('、')}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
        <Stat label="关联节点" value={neighborCount} />
        <Stat label="节点类型" value={node.nodeType} />
        <Stat label="别名数量" value={node.aliases?.length ?? 0} />
      </div>

      {attributeEntries.length ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">属性</p>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {attributeEntries.map(([key, value]) => (
              <div
                key={key}
                className="rounded-xl border border-brand/10 bg-brand-soft/60 px-3 py-2 text-xs"
              >
                <dt className="text-slate-500">{key}</dt>
                <dd className="mt-0.5 font-medium text-brand">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {node.content ? (
        <div className="rounded-2xl border border-brand/10 bg-brand-soft/40 p-4">
          <p className="text-xs font-semibold text-slate-500">节点说明</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
            {node.content.replace(/[#>*_`\-\[\]\(\)!]/g, ' ').trim()}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-brand/10 bg-white px-3 py-2">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="mt-1 text-base font-semibold text-brand">{value}</dd>
    </div>
  );
}

function EmptySharedLibraries({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto mt-12 max-w-md rounded-3xl border border-dashed border-brand/20 bg-white p-10 text-center">
      <Library className="mx-auto size-9 text-accent-orange" />
      <h2 className="mt-4 font-semibold text-brand">还没有可学习的共享资料</h2>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        当老师把知识库分享给你或设为公开后，它会自动出现在这里。如果老师已经分享但列表仍为空，请点击下面的按钮重新加载，或检查网络后重试。
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-9 items-center rounded-xl border border-brand/20 bg-white px-4 text-sm font-medium text-brand shadow-sm hover:border-accent-orange"
        >
          重新加载
        </button>
        <Link
          href="/"
          className="inline-flex text-sm font-medium text-brand underline underline-offset-4"
        >
          返回课堂首页
        </Link>
      </div>
    </div>
  );
}
