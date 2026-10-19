'use client';

import { useAuth } from '@/lib/hooks/use-auth';
import { ResourceSharingDialog } from '@/components/sharing/resource-sharing-dialog';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Clapperboard,
  Code2,
  Copy,
  Image as ImageIcon,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { DocumentsPanel } from '@/components/knowledge/documents-panel';
import { SearchPanel, type SearchPanelProps } from '@/components/knowledge/search-panel';
import type { KnowledgeResponse } from '@/lib/hooks/use-knowledge';

export interface ResourceViewProps {
  /** useKnowledge 的完整响应：SearchPanel 原 props 保持不变，原样消费。 */
  data: KnowledgeResponse | null;
  bundleId: string;
  editable: boolean;
  /** 当前库审核状态：下载学习材料时写入状态标注，不能传空串。 */
  reviewStatus: string;
  /** 数据加载态：SearchPanel 依赖它防止请求期间误清空已选节点。 */
  loading: boolean;
  searchQuery: string;
  onSearchQuery: (value: string) => void;
  nodeId: string;
  onNodeSelect: (id: string) => void;
  /** 打开节点编辑器：浮层状态仍在 page.tsx，本层只透传。 */
  onEditNode: SearchPanelProps['onEditNode'];
  refreshNonce: number;
  /**
   * 文档段直接复用 page.tsx 已算好的当前库对象（documentsLibrary memo）：
   * 与资料库视图同一数据源，避免在两处各自拼装导致字段漂移。
   */
  documentsLibrary: Parameters<typeof DocumentsPanel>[0]['library'] | null;
  /** DocumentsPanel 写操作完成后的刷新（页面 nonce + 1）。 */
  onChanged: () => void;
  /**
   * 触发顶部「上传资料」的文件选择。handlePickFiles 绑定在隐藏 input 上，
   * 真实入口是 ref.click()，因此下传的是触发器而不是事件处理函数本身。
   */
  onUploadDocs: () => void;
  /**
   * 打开「索引代码」Dialog。handleIndexCode 在 Dialog 提交时才执行，
   * 页面级入口是 setIndexOpen(true)，故下传该入口。
   */
  onIndexCode: () => void;
  /** 同步图谱（page.tsx 的 handleSync 原样触发）。 */
  onSync: () => void;
}

/** GET /api/materials?scope=owner 返回的 publicMaterial 投影（多余字段忽略）。 */
export interface OwnerMaterial {
  materialId: string;
  resourceType?: 'asset' | 'material';
  bytesUrl?: string;
  canEdit?: boolean;
  visibility?: 'private' | 'public';
  sharedWithMe?: boolean;
  /** 素材来源只有 source/web，不能用来区分图片与视频（spec 决策 Q6）。 */
  kind: 'source' | 'web';
  mime?: string;
  bytes: number;
  originalName?: string;
  createdAt: string;
}

/** 素材排序口径（spec §6：时间 / 名称 / 大小）。 */
export type MaterialSort = 'time' | 'name' | 'size';

/** 类型分段与设计稿 §6 对齐（Task 5 骨架沿用中文标签，语义等价于计划草稿的 Seg 枚举）。 */
const SEGMENTS = ['全部', '文档', '图片', '视频', '音频'] as const;

const SORT_OPTIONS: { key: MaterialSort; label: string }[] = [
  { key: 'time', label: '时间' },
  { key: 'name', label: '名称' },
  { key: 'size', label: '大小' },
];

/**
 * 上传大小上限提示文案。page.tsx 上传对话框没有既有校验文案（已核实），
 * 此处按 lib/server/agent-runtime/config.ts 的 maxDocumentBytes = 50MB 自拟，
 * 后端 413 仍是最终裁决，前端只做提示。
 */
const UPLOAD_LIMIT_HINT = '单个文件不超过 50 MB';

/**
 * 按 mime 前缀给素材分类：kind 字段只有 source/web，图片/视频只能看 mime
 * （spec 决策 Q6）。非图片非视频（如文档类素材）归为 other，由 knowledge
 * 文档区承担展示，避免同一文档在两个数据源里重复出现。
 */
export function classifyMaterial(material: OwnerMaterial): 'image' | 'video' | 'audio' | 'other' {
  // 统一小写再比前缀：mime 理论上是小写，但客户端提交的记录大小写不保证，
  // 分类错判会把图片当成 other 静默丢掉，代价远高于一次 toLowerCase
  const mime = (material.mime ?? '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'other';
}

/** 按 mime 把 owner 级素材拆成图片 / 视频两组；other 类直接丢弃（见 classifyMaterial 注释）。 */
export function splitMaterials(materials: OwnerMaterial[]): {
  images: OwnerMaterial[];
  videos: OwnerMaterial[];
} {
  const images: OwnerMaterial[] = [];
  const videos: OwnerMaterial[] = [];
  for (const material of materials) {
    const category = classifyMaterial(material);
    if (category === 'image') images.push(material);
    else if (category === 'video') videos.push(material);
  }
  return { images, videos };
}

/**
 * 素材按文件名与 MIME 过滤（spec §6 ②）：无 originalName 的记录回落 materialId，
 * 保证任何记录都有可匹配的键；空词原样返回，避免无谓的数组拷贝。
 */
export function filterMaterials(materials: OwnerMaterial[], query: string): OwnerMaterial[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return materials;
  return materials.filter((material) => {
    const name = (material.originalName ?? material.materialId).toLowerCase();
    const mime = (material.mime ?? '').toLowerCase();
    return name.includes(keyword) || mime.includes(keyword);
  });
}

/** 排序不改原数组（渲染层可能持有旧引用做乐观更新回滚），返回新数组。 */
export function sortMaterials(materials: OwnerMaterial[], order: MaterialSort): OwnerMaterial[] {
  // createdAt 非法时按 0（最早）处理：宁可排到最后也不要把 NaN 写进比较器
  const timeOf = (material: OwnerMaterial) => {
    const time = Date.parse(material.createdAt);
    return Number.isNaN(time) ? 0 : time;
  };
  const byId = (a: OwnerMaterial, b: OwnerMaterial) => a.materialId.localeCompare(b.materialId);
  const list = [...materials];
  list.sort((a, b) => {
    if (order === 'name') {
      const name = (a.originalName ?? a.materialId).localeCompare(
        b.originalName ?? b.materialId,
        'zh-Hans-CN',
      );
      return name !== 0 ? name : byId(a, b);
    }
    if (order === 'size') {
      return b.bytes - a.bytes || byId(a, b);
    }
    // 时间默认新在前；同值回落 materialId，保证顺序稳定可复现
    return timeOf(b) - timeOf(a) || byId(a, b);
  });
  return list;
}

/** 文件大小格式化：B 取整，KB 及以上保留 1 位小数（卡片信息密度优先，超范围值给占位符）。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/** 时间格式化：无效日期回退原串，绝不把 NaN 上屏。 */
export function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * 资源管理视图：顶部分段（全部 / 文档 / 图片 / 视频）。
 * 数据源两套：文档走 knowledge API（按当前库），图片视频走 materials API（owner 级全局），
 * 因此分段是本地 state，素材列表在本组件内直接请求。
 */
export function ResourceView(props: ResourceViewProps) {
  const { user } = useAuth();
  const [segment, setSegment] = useState<(typeof SEGMENTS)[number]>('全部');
  const [sort, setSort] = useState<MaterialSort>('time');
  const [materialFilter, setMaterialFilter] = useState('');
  const [materials, setMaterials] = useState<OwnerMaterial[]>([]);
  const [materialsLoaded, setMaterialsLoaded] = useState(false);
  const [materialsError, setMaterialsError] = useState<string | null>(null);
  const [preview, setPreview] = useState<OwnerMaterial | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<OwnerMaterial | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OwnerMaterial | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadMaterials = useCallback(async () => {
    try {
      const response = await fetch('/api/resources/media', { cache: 'no-store' });
      // 404 是 plain text、其余错误是 apiError JSON：统一按状态码给原因，不解析信封
      if (!response.ok) throw new Error(`素材列表加载失败（HTTP ${response.status}）`);
      const payload = (await response.json()) as { materials?: OwnerMaterial[] };
      setMaterials(payload.materials ?? []);
      setMaterialsError(null);
    } catch (reason) {
      // 计划草稿是裸 throw，但 effect 里 void 调用会变成 unhandled rejection；
      // 改为记状态 + toast 把原因透出，既不吞异常也不污染控制台
      const message = reason instanceof Error ? reason.message : '素材列表加载失败';
      setMaterialsError(message);
      toast.error(message);
    } finally {
      setMaterialsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadMaterials();
  }, [loadMaterials, props.refreshNonce]);

  const { images, videos } = useMemo(() => splitMaterials(materials), [materials]);
  const audios = useMemo(() => materials.filter((item) => classifyMaterial(item) === 'audio'), [materials]);
  const documentCount = props.data?.documents.length ?? 0;

  // 文档与语义检索同进退：全部 / 文档段展示（文档按当前库，knowledge API）
  const showKnowledge = segment === '全部' || segment === '文档';
  // 图片 / 视频段与全部段展示素材区（owner 级全局，不随知识库切换）
  const showMaterials = segment !== '文档';

  const visibleMaterials = useMemo(() => {
    const base =
      segment === '图片' ? images : segment === '视频' ? videos : segment === '音频' ? audios : [...images, ...videos, ...audios];
    return sortMaterials(filterMaterials(base, materialFilter), sort);
  }, [segment, images, videos, audios, materialFilter, sort]);

  const baseCount = segment === '图片' ? images.length : segment === '视频' ? videos.length : segment === '音频' ? audios.length : images.length + videos.length + audios.length;

  // 空态引导链（计划 9.3）：素材与文档都为空才出现；两侧数据未到齐时不判空，避免闪一下引导链
  const showGuide = !props.loading && materialsLoaded && materials.length === 0 && documentCount === 0;

  async function handleRename() {
    const target = renameTarget;
    if (!target || renaming) return;
    const name = renameDraft.trim();
    // 与后端 PATCH 校验同口径（1-512），先在前端拦掉再发请求
    if (name.length < 1 || name.length > 512) {
      toast.error('文件名需为 1-512 字符');
      return;
    }
    const previousName = target.originalName;
    if (name === (previousName ?? '')) {
      setRenameTarget(null);
      return;
    }
    setRenaming(true);
    // 乐观更新：先上屏新名字，请求失败再回滚，慢网络下 UI 不卡旧值
    setMaterials((list) =>
      list.map((material) =>
        material.materialId === target.materialId ? { ...material, originalName: name } : material,
      ),
    );
    try {
      const response = await fetch(`/api/materials/${target.materialId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalName: name }),
      });
      // 失败体可能是 apiError JSON，404 又是 plain text：json().catch 回退到状态码文案
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        material?: OwnerMaterial;
      } | null;
      if (!response.ok) throw new Error(body?.error || `重命名失败（HTTP ${response.status}）`);
      setRenameTarget(null);
      toast.success(`已重命名为「${body?.material?.originalName ?? name}」`);
    } catch (reason) {
      // 失败回滚 + toast 带原因，异常原样透出
      setMaterials((list) =>
        list.map((material) =>
          material.materialId === target.materialId
            ? { ...material, originalName: previousName }
            : material,
        ),
      );
      toast.error(reason instanceof Error ? reason.message : '重命名失败');
    } finally {
      setRenaming(false);
    }
  }

  async function handleDelete() {
    const target = deleteTarget;
    if (!target || deleting) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/materials/${target.materialId}`, {
        method: 'DELETE',
        cache: 'no-store',
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || `删除失败（HTTP ${response.status}）`);
      setMaterials((list) => list.filter((material) => material.materialId !== target.materialId));
      // 素材可能正在灯箱 / 播放中：删除成功后一并收掉，避免残留指向已删素材的预览
      setPreview((current) =>
        current?.materialId === target.materialId ? null : current,
      );
      setPlayingId((current) => (current === target.materialId ? null : current));
      setDeleteTarget(null);
      toast.success(`已删除「${target.originalName ?? target.materialId}」`);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  }

  async function handleCopyReference(material: OwnerMaterial) {
    try {
      await navigator.clipboard.writeText(
        new URL(material.bytesUrl ?? `/api/materials/${material.materialId}/bytes`, window.location.origin).href,
      );
      toast.success('素材引用地址已复制');
    } catch (reason) {
      // 剪贴板在非 HTTPS / 权限被拒时会抛异常，给出原因而不是静默失败
      toast.error(reason instanceof Error ? reason.message : '复制失败：浏览器拒绝了剪贴板访问');
    }
  }

  const searchPanel = (
    <SearchPanel
      key={props.bundleId}
      data={props.data}
      bundleId={props.bundleId}
      reviewStatus={props.reviewStatus}
      loading={props.loading}
      query={props.searchQuery}
      nodeId={props.nodeId}
      onSubmitQuery={props.onSearchQuery}
      onNodeSelect={props.onNodeSelect}
      editable={props.editable}
      onEditNode={props.onEditNode}
      refreshNonce={props.refreshNonce}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex w-fit gap-1 rounded-lg border p-1" role="tablist" aria-label="资源类型">
        {SEGMENTS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={segment === item}
            onClick={() => setSegment(item)}
            className={`rounded-md px-3 py-1.5 text-xs transition ${
              segment === item
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      {materialsError && (
        <p
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {materialsError}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => {
              setMaterialsError(null);
              void loadMaterials();
            }}
          >
            重试
          </button>
        </p>
      )}

      {/* 空态引导链：素材与文档都没有时，给出「上传 → 索引 → 同步」的最小上手路径 */}
      {showGuide && (
        <div className="space-y-3 rounded-lg border border-dashed p-5 text-center">
          <p className="text-sm text-muted-foreground">
            当前库暂无文档、账号下暂无图片 / 视频素材，按下面的顺序把资源接进来：
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button size="sm" onClick={props.onUploadDocs}>
              <Upload className="size-4" aria-hidden />
              上传文档
            </Button>
            <span aria-hidden className="text-muted-foreground">
              →
            </span>
            <Button size="sm" variant="outline" onClick={props.onIndexCode}>
              <Code2 className="size-4" aria-hidden />
              索引代码
            </Button>
            <span aria-hidden className="text-muted-foreground">
              →
            </span>
            <Button size="sm" variant="outline" onClick={props.onSync}>
              <RefreshCw className="size-4" aria-hidden />
              同步图谱
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {UPLOAD_LIMIT_HINT}（.json / .md / .txt / .pdf）
          </p>
        </div>
      )}

      {/* 语义检索 + 文档区（全部 / 文档段，数据源 knowledge API，按当前库过滤） */}
      {showKnowledge && searchPanel}
      {showKnowledge && props.documentsLibrary && (
        <DocumentsPanel library={props.documentsLibrary} onChanged={props.onChanged} />
      )}

      {/* 素材区（全部 / 图片 / 视频段，数据源 materials API，owner 级全局、不绑定库） */}
      {showMaterials && (
        <section className="space-y-3" aria-label="图片与视频素材">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">
              {segment === '图片' ? '图片素材' : segment === '视频' ? '视频素材' : segment === '音频' ? '音频素材' : '图片 / 视频 / 音频素材'}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                来自素材库，不随知识库切换
              </span>
            </h2>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {baseCount > 0 && (
                <>
                  <label className="sr-only" htmlFor="material-filter">
                    筛选素材
                  </label>
                  <Input
                    id="material-filter"
                    value={materialFilter}
                    onChange={(event) => setMaterialFilter(event.target.value)}
                    placeholder="筛选：文件名 / MIME"
                    maxLength={200}
                    className="h-8 w-44 text-xs"
                  />
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span>排序</span>
                    {SORT_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        aria-pressed={sort === option.key}
                        onClick={() => setSort(option.key)}
                        className={`rounded px-2 py-1 transition ${
                          sort === option.key
                            ? 'bg-muted font-medium text-foreground'
                            : 'hover:bg-muted/60'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {baseCount === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              账号下暂无
              {segment === '图片' ? '图片' : segment === '视频' ? '视频' : segment === '音频' ? '音频' : '图片 / 视频 / 音频'}
              素材。
            </p>
          ) : visibleMaterials.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              没有匹配当前筛选的素材。
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visibleMaterials.map((material) => {
                const name = material.originalName ?? material.materialId;
                const category = classifyMaterial(material);
                const bytesUrl = material.bytesUrl ?? `/api/materials/${material.materialId}/bytes`;
                const playing = playingId === material.materialId;
                return (
                  <li key={material.materialId} className="space-y-2 rounded-lg border p-3">
                    {category === 'image' ? (
                      // 图片卡整体可点：点击开灯箱（计划 9.2）
                      <button
                        type="button"
                        onClick={() => setPreview(material)}
                        aria-label={`预览 ${name}`}
                        className="block w-full"
                      >
                        <img
                          src={bytesUrl}
                          alt={name}
                          loading="lazy"
                          className="h-36 w-full cursor-zoom-in rounded-md bg-muted object-cover"
                          onError={() =>
                            toast.error(`图片「${name}」加载失败，素材可能已被删除`)
                          }
                        />
                      </button>
                    ) : category === 'audio' ? (<audio controls preload="none" src={bytesUrl} className="w-full" aria-label={`播放 ${name}`} />) : playing ? (
                      // 视频点击后内嵌 <controls> 播放（计划 9.2），收起后回到缩略卡
                      <div className="space-y-1">
                        <video
                          src={bytesUrl}
                          controls
                          autoPlay
                          className="h-36 w-full rounded-md bg-black object-contain"
                          onEnded={() => setPlayingId(null)}
                          onError={() => {
                            setPlayingId(null);
                            toast.error(`视频「${name}」加载失败，素材可能已被删除`);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setPlayingId(null)}
                          className="w-full rounded-md bg-muted py-1 text-xs text-muted-foreground transition hover:bg-muted/70"
                        >
                          收起播放
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPlayingId(material.materialId)}
                        aria-label={`播放 ${name}`}
                        className="grid h-36 w-full place-items-center gap-1 rounded-md bg-muted text-muted-foreground transition hover:bg-muted/70"
                      >
                        <Clapperboard className="size-8" aria-hidden />
                        <span className="text-xs">点击播放</span>
                      </button>
                    )}

                    <div className="space-y-1">
                      <p className="truncate text-sm font-medium" title={name}>
                        {name}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <Badge variant="outline">
                          {category === 'image' ? (
                            <ImageIcon className="size-3" aria-hidden />
                          ) : (
                            <Clapperboard className="size-3" aria-hidden />
                          )}
                          {category === 'image' ? '图片' : category === 'audio' ? '音频' : '视频'}
                        </Badge>
                        <span>{formatBytes(material.bytes)}</span>
                        <span>{formatTime(material.createdAt)}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{material.sharedWithMe ? '分享给我' : material.visibility === 'public' ? '公开' : '私有'}</Badge>
                      {material.resourceType === 'asset' && <Badge variant="secondary">生成媒体</Badge>}
                      {material.canEdit && user?.role === 'teacher' && <ResourceSharingDialog kind={material.resourceType ?? 'material'} id={material.materialId} title={name} onChanged={() => void loadMaterials()} />}
                      <Button variant="ghost" size="sm" onClick={() => void handleCopyReference(material)}>复制引用</Button>
                    </div>
                    {/* 素材操作整体按 editable 门控（计划 9.2） */}
                    {material.canEdit && material.resourceType !== 'asset' && (
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setRenameTarget(material);
                            setRenameDraft(name);
                          }}
                        >
                          <Pencil className="size-3.5" aria-hidden />
                          重命名
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => void handleCopyReference(material)}
                        >
                          <Copy className="size-3.5" aria-hidden />
                          复制引用
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(material)}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                          删除
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* 图片灯箱：Dialog 大图 + 关闭（计划 9.2） */}
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.originalName ?? '图片预览'}</DialogTitle>
            <DialogDescription>
              {preview ? `${formatBytes(preview.bytes)} · ${formatTime(preview.createdAt)}` : ''}
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <img
              src={preview.bytesUrl ?? `/api/materials/${preview.materialId}/bytes`}
              alt={preview.originalName ?? preview.materialId}
              className="max-h-[70vh] w-full rounded-md bg-muted object-contain"
              onError={() => {
                toast.error('图片加载失败，素材可能已被删除');
                setPreview(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* 重命名：Dialog Input → PATCH，乐观更新失败回滚（计划 9.2） */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          // 请求进行中不放行关闭，避免半途留下回滚与 UI 不一致的状态
          if (!open && !renaming) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名素材</DialogTitle>
            <DialogDescription>修改素材展示名，素材地址（materialId）不变。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="material-rename">文件名</Label>
            <Input
              id="material-rename"
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              maxLength={512}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">1–512 字符。</p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameTarget(null)}
              disabled={renaming}
            >
              取消
            </Button>
            <Button onClick={() => void handleRename()} disabled={renaming || !renameDraft.trim()}>
              {renaming && <Loader2 className="size-4 animate-spin" aria-hidden />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认：确认弹层 → DELETE → 从 state 移除（计划 9.2） */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除素材「{deleteTarget?.originalName ?? deleteTarget?.materialId}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              删除后素材地址立即失效，引用该地址的页面将无法再加载。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                // 阻止默认关闭：删除成功才收弹层，失败留在弹层里让用户看到 toast 原因
                event.preventDefault();
                void handleDelete();
              }}
            >
              {deleting && <Loader2 className="size-4 animate-spin" aria-hidden />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
