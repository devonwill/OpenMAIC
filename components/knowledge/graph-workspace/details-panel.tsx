'use client';

// 右详情面板（320px，可收起）：节点/边属性卡 → 邻接列表 → 懒加载展开 → Cypher 预览 → 导出。
// 与左栏同理：数据筛选、Cypher 生成等逻辑在 workspace 层，这里只做展示与回调触发。
import Link from 'next/link';
import { toast } from 'sonner';
import { Copy, PanelRightClose, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { GraphCanvasExportApi } from '@/components/knowledge/graph-canvas';
import type { FullLink, FullNode } from '@/lib/hooks/use-knowledge';
import { buildCypherPreview } from '@/lib/knowledge/graph-algorithms';
import {
  buildExportLegend,
  NODE_TYPE_LABEL,
  listNodeNeighbors,
} from '@/lib/knowledge/graph-workspace';
import { NODE_COLOR, nodeColor } from '@/lib/knowledge/graph-visuals';
import { linkLineStyle } from '@/lib/knowledge/schema';

/** 邻接列表截断上限：hub 节点可能有数百邻居，全量渲染会把 320px 面板拖垮。 */
const NEIGHBOR_LIMIT = 30;

export interface DetailsPanelProps {
  selectedNode: FullNode | null;
  selectedLink: FullLink | null;
  /** 全量节点/边：名称解析与邻接派生不随筛选变化，选中节点被筛掉也应能看详情。 */
  nodes: FullNode[];
  links: FullLink[];
  bundleId: string;
  /** 编辑权限门控：只读包隐藏「编辑」按钮（spec §4.3）。 */
  editable: boolean;
  /** neighbors 响应可带回；未请求时按 buildCypherPreview 即时生成。 */
  cypherPreview?: string;
  backend: 'neo4j' | 'json';
  /** 邻接列表点选：选中该节点并触发布局聚焦（Task 8 focusNodeId）。 */
  onLocate: (node: FullNode) => void;
  onEditNode: (node: FullNode) => void;
  onCollapse: () => void;
  /** 懒加载展开：按 depth 拉取邻居合并入图（workspace 持有请求与合并状态）。 */
  onExpand?: (depth: 1 | 2) => void;
  /** 画布导出能力：点击导出按钮时读取，序列化逻辑内聚在 GraphCanvas 内。 */
  svgApiRef?: { current: GraphCanvasExportApi | null };
}

export function DetailsPanel({
  selectedNode,
  selectedLink,
  nodes,
  links,
  bundleId,
  editable,
  cypherPreview,
  backend,
  onLocate,
  onEditNode,
  onCollapse,
  onExpand,
  svgApiRef,
}: DetailsPanelProps) {
  const nameOf = new Map(nodes.map((node) => [node.id, node.name]));
  const neighbors = selectedNode ? listNodeNeighbors(selectedNode.id, links, nodes) : [];
  const shownNeighbors = neighbors.slice(0, NEIGHBOR_LIMIT);
  const cypher =
    cypherPreview ??
    (selectedNode ? buildCypherPreview(bundleId, selectedNode.id, 1) : '');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(cypher);
      toast.success('Cypher 已复制到剪贴板');
    } catch (error) {
      // 不吞异常：非安全上下文下剪贴板 API 不可用，把真实原因报给用户
      toast.error(`复制失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 导出能力在点击时读取 ref（渲染期读 ref 拿不到稳定值）；图例文案 = 5 类节点色 + 实/虚线关系
  async function handleExportSvg() {
    if (!svgApiRef?.current) {
      toast.error('画布未就绪，无法导出');
      return;
    }
    try {
      svgApiRef.current.exportSvg(buildExportLegend());
      toast.success('SVG 已导出');
    } catch (error) {
      toast.error(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function handleExportPng() {
    if (!svgApiRef?.current) {
      toast.error('画布未就绪，无法导出');
      return;
    }
    try {
      await svgApiRef.current.exportPng(buildExportLegend());
      toast.success('PNG 已导出');
    } catch (error) {
      toast.error(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <Card className="lg:h-fit">
      <CardContent className="space-y-4 p-4">
        {/* 面板头：标题 + 收起按钮（收起后中栏变宽，展开按钮在画布右上角） */}
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">属性卡</p>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="收起属性卡"
            onClick={onCollapse}
          >
            <PanelRightClose className="size-4" />
          </Button>
        </div>

        {/* JSON 后端没有可执行的 Neo4J，Cypher 只是语法预览——先说清楚避免误复制 */}
        {backend === 'json' && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
            【需配置 NEO4J_URI】当前为 JSON 后端，下方 Cypher 仅作语法预览，不能直接执行。
          </p>
        )}

        {/* 空态：未选中任何元素 */}
        {!selectedNode && !selectedLink && (
          <p className="rounded-md border border-dashed px-2 py-6 text-center text-xs text-muted-foreground">
            点击画布中的节点或连边，这里显示其详情。
          </p>
        )}

        {/* 1. 节点卡 */}
        {selectedNode && (
          <section className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <h3 className="break-all text-sm font-semibold leading-tight">
                  {selectedNode.name}
                </h3>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    className="text-white"
                    style={{ backgroundColor: NODE_COLOR[selectedNode.nodeType] }}
                  >
                    {NODE_TYPE_LABEL[selectedNode.nodeType]}
                  </Badge>
                  {selectedNode.category && (
                    <span className="text-xs text-muted-foreground">
                      {selectedNode.category}
                    </span>
                  )}
                </div>
              </div>
              {editable && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 gap-1 px-2 text-xs"
                  onClick={() => onEditNode(selectedNode)}
                >
                  <Pencil className="size-3" />
                  编辑
                </Button>
              )}
            </div>

            {selectedNode.aliases.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selectedNode.aliases.map((alias) => (
                  <span
                    key={alias}
                    className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {alias}
                  </span>
                ))}
              </div>
            )}

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">内容摘要</p>
              <p className="line-clamp-4 text-xs leading-relaxed">
                {selectedNode.content || '（无摘要）'}
              </p>
            </div>

            {/* 来源标注：documentIds 为空 = 手动创建，非文档抽取 */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">来源</p>
              {selectedNode.documentIds.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {selectedNode.documentIds.map((docId) => (
                    <Link
                      key={docId}
                      href="/knowledge?view=library"
                      className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-primary hover:underline"
                      title={docId}
                    >
                      {docId}
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">手动创建（无关联文档）</p>
              )}
            </div>

            {/* 自定义属性键值表 */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">属性</p>
              {Object.keys(selectedNode.attributes).length === 0 ? (
                <p className="text-xs text-muted-foreground">无自定义属性</p>
              ) : (
                <dl className="divide-y rounded-md border text-xs">
                  {Object.entries(selectedNode.attributes).map(([key, value]) => (
                    <div key={key} className="flex gap-2 px-2 py-1">
                      <dt className="w-20 shrink-0 truncate text-muted-foreground" title={key}>
                        {key}
                      </dt>
                      <dd className="min-w-0 flex-1 break-all">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </section>
        )}

        {/* 2. 边卡：源 → 关系 → 目标 + 线型说明 */}
        {selectedLink && (
          <section className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">关系详情</p>
            <div className="space-y-1.5 rounded-md border p-2">
              <div className="flex items-center gap-1.5 text-xs">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: '#1d4ed8' }}
                />
                <span className="min-w-0 flex-1 truncate" title={selectedLink.source}>
                  {nameOf.get(selectedLink.source) ?? selectedLink.source}
                </span>
              </div>
              <p className="pl-3.5 text-xs font-medium text-primary">
                — {selectedLink.relation} →
              </p>
              <div className="flex items-center gap-1.5 text-xs">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: '#60a5fa' }}
                />
                <span className="min-w-0 flex-1 truncate" title={selectedLink.target}>
                  {nameOf.get(selectedLink.target) ?? selectedLink.target}
                </span>
              </div>
              <p className="border-t pt-1 text-[10px] text-muted-foreground">
                画布线型：{linkLineStyle(selectedLink.relation) === 'dashed' ? '虚线' : '实线'}（虚线表示引用/相近等弱关系）
              </p>
            </div>
          </section>
        )}

        {/* 3. 邻接列表：点选直接定位邻居 */}
        {selectedNode && (
          <section className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              邻接节点（{neighbors.length}）
            </p>
            {neighbors.length === 0 ? (
              <p className="text-xs text-muted-foreground">该节点暂无连边</p>
            ) : (
              <div className="max-h-48 space-y-0.5 overflow-auto rounded-md border p-1">
                {shownNeighbors.map((entry) => (
                  <button
                    key={entry.link.id}
                    type="button"
                    onClick={() => onLocate(entry.node)}
                    className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-accent"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: nodeColor(entry.node.nodeType) }}
                    />
                    <span className="min-w-0 flex-1 truncate">{entry.node.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {entry.relation}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {neighbors.length > NEIGHBOR_LIMIT && (
              <p className="text-[10px] text-muted-foreground">
                仅显示前 {NEIGHBOR_LIMIT} 个邻居，其余 {neighbors.length - NEIGHBOR_LIMIT} 个请在画布查看
              </p>
            )}
          </section>
        )}

        {/* 3.5 懒加载展开（Task 8）：按需拉取 2 跳邻居合并入图，避免整库刷新 */}
        {selectedNode && (
          <section className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">懒加载展开</p>
            <p className="text-[10px] text-muted-foreground">
              按需拉取该节点的邻居合并进画布（不刷新整库），旧节点保持原位。
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              disabled={!onExpand}
              onClick={() => onExpand?.(2)}
            >
              展开二级
            </Button>
          </section>
        )}

        {/* 4. Cypher 预览：仅节点上下文有意义 */}
        {selectedNode && (
          <section className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Cypher 预览</p>
              <Button
                variant="outline"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                onClick={handleCopy}
              >
                <Copy className="size-3" />
                复制
              </Button>
            </div>
            <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-relaxed">
              {cypher}
            </pre>
          </section>
        )}

        {/* 5. 导出（Task 8 实现）：经 svgApiRef 触发画布序列化，含图例 */}
        <section className="space-y-1.5 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">导出</p>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => void handleExportPng()}
            >
              导出 PNG
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => void handleExportSvg()}
            >
              导出 SVG
            </Button>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
