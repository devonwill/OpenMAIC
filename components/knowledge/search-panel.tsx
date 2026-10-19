'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bookmark, Download, GitBranch, Loader2, Pencil, Search, Tags } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { KnowledgeResponse, NodeDetail } from '@/lib/hooks/use-knowledge';

const REVIEW_LABELS: Record<string, string> = {
  demo: '演示数据 · 不用于课堂依据',
  unreviewed: '待教师审核 · 不用于课堂依据',
  reviewed: '已审核',
};

export interface SearchPanelProps {
  data: KnowledgeResponse | null;
  bundleId: string;
  reviewStatus: string;
  loading: boolean;
  /** 已提交的搜索词（页面受控，切库 / 重新提交时变化）。 */
  query: string;
  /** 当前查看详情的节点 id。 */
  nodeId: string;
  /** 提交新搜索（页面会同时清空已选节点）。 */
  onSubmitQuery: (query: string) => void;
  /** 点击结果节点查看详情；传空字符串表示清空选择。 */
  onNodeSelect: (nodeId: string) => void;
  /** 当前库是否可编辑（owner）；只读库隐藏编辑入口。 */
  editable: boolean;
  /** 打开节点编辑器（复用图谱 Tab 的 NodeEditorDialog）。 */
  onEditNode: (detail: NodeDetail) => void;
  /** 页面写操作刷新信号：刷新后若详情节点已不存在则自动取消选中。 */
  refreshNonce?: number;
}

interface RelationRow {
  key: string;
  text: string;
}

/** 下载本段学习材料：逻辑搬迁自旧版 knowledge 页面，输出格式保持不变。 */
function downloadMaterial(detail: NodeDetail, bundleId: string, reviewStatus: string): void {
  const text = `# ${detail.name}\n\n状态：${REVIEW_LABELS[reviewStatus] ?? ''}\n\n${detail.content}\n\n来源：${detail.source.title} / ${detail.source.locator}\n引用：[知识来源:${bundleId}/${detail.id}]\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${bundleId}-${detail.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SearchPanel({
  data,
  bundleId,
  reviewStatus,
  loading,
  query,
  nodeId,
  onSubmitQuery,
  onNodeSelect,
  editable,
  onEditNode,
  refreshNonce,
}: SearchPanelProps) {
  const [draft, setDraft] = useState(query);
  const detail = data?.detail ?? null;

  // 外部（切库 / 重置）导致已提交搜索词变化时同步输入框。
  useEffect(() => {
    setDraft(query);
  }, [query]);

  // 记录「当前这轮 loading 对应哪个节点」：子组件 effect 先于父级 useKnowledge 的请求 effect 执行，
  // 若直接按 !loading && !detail 判断，会在请求发出前把刚点中的节点清空，右侧详情因此永远拉不到。
  const pendingNodeRef = useRef('');
  useEffect(() => {
    if (loading) pendingNodeRef.current = nodeId;
    else if (!nodeId) pendingNodeRef.current = ''; // 选择已清空：作废上一轮记录，避免下次点同名节点被误清
  }, [loading, nodeId]);

  // 节点可能在图谱编辑中被删除：仅当该节点自身的这轮请求已完成、结果里确实没有 detail 时才取消选中。
  useEffect(() => {
    if (loading || !nodeId) return;
    if (pendingNodeRef.current === nodeId && !data?.detail) onNodeSelect('');
  }, [loading, nodeId, data?.detail, refreshNonce, onNodeSelect]);

  // 提交搜索后展示 hits；未提交时沿用旧版行为：列出当前库浏览态图谱节点。
  const resultItems = useMemo(() => {
    if (!data) return [];
    if (query) {
      return data.hits.map((hit) => ({
        id: hit.node.id,
        name: hit.node.name,
        category: hit.node.category,
      }));
    }
    return data.graph.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      category: node.category,
    }));
  }, [data, query]);

  // 关系来源：优先用浏览态图谱边（带确定 id），再用 hit.relations（名称形态）补全。
  const relations = useMemo<RelationRow[]>(() => {
    if (!detail || !data) return [];
    const rows: RelationRow[] = [];
    const seen = new Set<string>();
    const push = (source: string, relation: string, target: string) => {
      const key = `${source}|${relation}|${target}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({ key, text: `${source} —${relation}→ ${target}` });
    };
    const nameById = new Map(data.graph.nodes.map((node) => [node.id, node.name]));
    for (const link of data.graph.links) {
      if (link.source === detail.id) {
        push(detail.name, link.relation, nameById.get(link.target) ?? link.target);
      } else if (link.target === detail.id) {
        push(nameById.get(link.source) ?? link.source, link.relation, detail.name);
      }
    }
    const matchedHit = data.hits.find((hit) => hit.node.id === detail.id);
    for (const relation of matchedHit?.relations ?? []) {
      if (relation.source === detail.name) push(detail.name, relation.relation, relation.target);
      else if (relation.target === detail.name) push(relation.source, relation.relation, detail.name);
    }
    return rows;
  }, [data, detail]);

  const statusLabel = REVIEW_LABELS[reviewStatus] ?? '';
  const showNoResult = Boolean(query) && !loading && resultItems.length === 0;

  // 来源文档已改文但未重新抽取 → 该节点内容可能与文档不一致。
  const staleSource = useMemo(() => {
    if (!detail || !data) return false;
    const staleIds = new Set(data.documents.filter((doc) => doc.stale).map((doc) => doc.id));
    return detail.documentIds.some((id) => staleIds.has(id));
  }, [detail, data]);

  return (
    <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
      <Card className="min-w-0">
        <CardContent className="space-y-3 p-4">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmitQuery(draft.trim().slice(0, 500));
            }}
          >
            <label className="sr-only" htmlFor="knowledge-query">
              搜索知识或论文
            </label>
            <Input
              id="knowledge-query"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="搜索：正运动学、Paper2Agent、MCP…"
              maxLength={500}
            />
            <Button type="submit" size="sm" className="shrink-0">
              <Search className="size-4" aria-hidden />
              搜索
            </Button>
          </form>

          {loading ? (
            <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              正在加载…
            </p>
          ) : showNoResult ? (
            <p className="text-sm text-muted-foreground">
              没有匹配结果；请尝试概念名或英文关键词。
            </p>
          ) : resultItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">该库暂无可浏览的知识点，请先在文档页上传资料。</p>
          ) : (
            <>
              {/* 原生滚动容器：高度自适应视口，滚动条加宽加色常显，长列表可上下拖动翻阅 */}
              <div className="max-h-[min(30rem,calc(100dvh-14rem))] overflow-y-auto overscroll-contain rounded-md pr-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40 hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/60 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2.5">
                <ul className="space-y-1">
                  {resultItems.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => onNodeSelect(item.id)}
                        aria-pressed={item.id === nodeId}
                        className={`w-full rounded-md border px-2.5 py-2 text-left text-sm transition-colors ${
                          item.id === nodeId
                            ? 'border-primary bg-muted'
                            : 'border-transparent hover:bg-muted'
                        }`}
                      >
                        <span className="block truncate font-medium">{item.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {item.category}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              {/* 计数提示：让用户知道列表被截断、下方还有可滚动内容 */}
              <p className="text-xs text-muted-foreground">
                共 {resultItems.length} 条{query ? '搜索结果' : '知识点'}
                {resultItems.length > 1 && ' · 可上下滚动查看'}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {detail ? (
        <Card className="min-w-0">
          <CardContent className="space-y-4 p-5">
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-xl font-semibold">{detail.name}</h2>
                {editable && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => onEditNode(detail)}
                  >
                    <Pencil className="size-4" aria-hidden />
                    编辑节点
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{detail.category}</Badge>
                {detail.nodeType === 'term' && (
                  <Badge
                    variant="outline"
                    className="border-amber-500/40 text-amber-700 dark:text-amber-400"
                  >
                    关键名词
                  </Badge>
                )}
                {staleSource && (
                  <Badge
                    variant="outline"
                    className="border-amber-500/40 text-amber-700 dark:text-amber-400"
                    title="来源文档已修改，尚未重新抽取，本节点内容可能过期"
                  >
                    <AlertTriangle className="size-3" aria-hidden />
                    来源已变更
                  </Badge>
                )}
                {statusLabel && <span className="text-xs text-muted-foreground">{statusLabel}</span>}
              </div>
            </div>

            {detail.aliases.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Tags className="size-3.5 text-muted-foreground" aria-hidden />
                {detail.aliases.map((alias) => (
                  <Badge key={alias} variant="outline">
                    {alias}
                  </Badge>
                ))}
              </div>
            )}

            <p className="whitespace-pre-wrap break-words text-sm leading-7">{detail.content}</p>

            <div className="space-y-1.5">
              <h3 className="flex items-center gap-1.5 text-sm font-medium">
                <GitBranch className="size-4 text-muted-foreground" aria-hidden />
                关系
              </h3>
              {relations.length > 0 ? (
                <ul className="space-y-1">
                  {relations.map((relation) => (
                    <li key={relation.key} className="text-sm text-muted-foreground">
                      {relation.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">暂无关系</p>
              )}
            </div>

            <p className="text-sm text-muted-foreground">
              来源：{detail.source.title} / {detail.source.locator}
            </p>
            <code className="block break-all rounded bg-muted px-2 py-1 text-xs">
              [知识来源:{bundleId}/{detail.id}]
            </code>

            <div className="space-y-2">
              <Button variant="outline" size="sm" onClick={() => downloadMaterial(detail, bundleId, reviewStatus)}>
                <Download className="size-4" aria-hidden />
                下载本段学习材料
              </Button>
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Bookmark className="mt-0.5 size-3 shrink-0" aria-hidden />
                可在首页作为课程材料上传；待审核和演示内容需先由教师核对。
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="grid min-h-[240px] min-w-0 place-items-center">
          <CardContent className="p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {loading ? '正在加载节点详情…' : '点击左侧知识点查看详情，并可下载学习材料。'}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
