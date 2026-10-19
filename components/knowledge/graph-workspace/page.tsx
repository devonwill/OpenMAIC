'use client';

// 图谱管理三栏工作区：左工具栏 / 中画布 / 右属性卡（spec §4）。
// 交互态与算法结果全部上收本层：统计、画布、详情三处共用同一份过滤结果，口径不会打架。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, PanelRightOpen } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { GraphCanvas, type GraphCanvasExportApi } from '@/components/knowledge/graph-canvas';
import { DetailsPanel } from '@/components/knowledge/graph-workspace/details-panel';
import { ToolsPanel, type ToolsPanelStats } from '@/components/knowledge/graph-workspace/tools-panel';
import { knowledgeApi, type FullLink, type FullNode } from '@/lib/hooks/use-knowledge';
import {
  computePageRank,
  detectCommunities,
  extractEgoSubgraph,
  shortestPath,
} from '@/lib/knowledge/graph-algorithms';
import {
  applyRenderCap,
  filterVisibleGraph,
  mergeById,
  normalizeRanks,
  pathLinkIds,
  RENDER_NODE_CAP,
  topPageRank,
} from '@/lib/knowledge/graph-workspace';
import { KNOWLEDGE_NODE_TYPES, type KnowledgeNodeType } from '@/lib/knowledge/schema';

export interface GraphWorkspaceProps {
  nodes: FullNode[];
  links: FullLink[];
  editable: boolean;
  bundleId: string;
  changedNonce: number;
  /** 重新加载入口：数据刷新后由页面递增 nonce（保留接口，本层暂未使用）。 */
  onRefresh: () => void;
  /** 数据刷新中：中栏画布盖遮罩（沿用原图谱 Tab 的 loading 表现）。 */
  loading: boolean;
  /** 编辑回调仍由 page.tsx 持有浮层状态，本层只透传（见计划 Step 7.4）。 */
  onEditNode: (node: FullNode | null) => void;
  onEditLink: (link: FullLink, x: number, y: number) => void;
  onAddLink: () => void;
  /** 后端标识：json 时右栏 Cypher 预览标注「需配置 NEO4J_URI」。 */
  backend?: 'neo4j' | 'json';
}

/** 四算法开关：可叠加生效，再点同按钮撤销，「清除结果」一键复位。 */
interface AlgoState {
  pagerank: boolean;
  community: boolean;
  path: { from: string; to: string } | null;
  ego: { centerId: string; depth: 1 | 2 } | null;
}

const INITIAL_ALGOS: AlgoState = { pagerank: false, community: false, path: null, ego: null };

/** 最短路径两段式拾取：startId 只在等终点阶段存在，类型上直接排除「end 却无起点」。 */
type PathPick = { stage: 'start'; startId: null } | { stage: 'end'; startId: string };

// 模块级稳定空表：算法未运行时传给画布的 props 引用不变，避免无意义的重渲染
const EMPTY_RANKS = new Map<string, number>();
const EMPTY_COMMUNITY = new Map<string, string>();

export function GraphWorkspace({
  nodes,
  links,
  editable,
  bundleId,
  changedNonce,
  loading,
  onEditNode,
  onEditLink,
  onAddLink,
  backend = 'json',
}: GraphWorkspaceProps) {
  const [selectedNode, setSelectedNode] = useState<FullNode | null>(null);
  const [selectedLink, setSelectedLink] = useState<FullLink | null>(null);
  const [searchText, setSearchText] = useState('');
  const [enabledTypes, setEnabledTypes] = useState<Set<KnowledgeNodeType>>(
    () => new Set(KNOWLEDGE_NODE_TYPES),
  );
  const [algos, setAlgos] = useState<AlgoState>(INITIAL_ALGOS);
  const [pathPick, setPathPick] = useState<PathPick | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(true);

  // ---- Task 8：Ego 懒加载展开 / 搜索聚焦 / 800 上限 / 导出 ----
  // 累计懒加载回来的邻居：与库内全量节点分开存，合并去重后才进画布
  const [expandedNodes, setExpandedNodes] = useState<FullNode[]>([]);
  const [expandedLinks, setExpandedLinks] = useState<FullLink[]>([]);
  /** 展开请求带回的 Cypher 预览：记录来源 nodeId，仅当选中节点仍是它时才透传右栏。 */
  const [expandCypher, setExpandCypher] = useState<{ nodeId: string; preview: string } | null>(
    null,
  );
  const [expandBackend, setExpandBackend] = useState<'neo4j' | 'json' | null>(null);
  /** 展开模式开关：开启时点选画布节点直接懒加载邻居而非仅选中。 */
  const [expandMode, setExpandMode] = useState(false);
  /** 搜索定位目标：画布据其平移聚焦，随即由下方 effect 归零，保证同节点可重复触发。 */
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  /** 超 800 节点默认按度数截断渲染，用户可点「强制全量渲染」跳过截断。 */
  const [forceFull, setForceFull] = useState(false);
  // 导出能力通过 ref 暴露给右栏：不外泄 svgRef，序列化逻辑内聚在画布组件里
  const svgApiRef = useRef<GraphCanvasExportApi | null>(null);
  /** 展开请求防重入：连点只发一次，避免并发写合并状态。 */
  const expandBusyRef = useRef(false);

  // 知识包切换或数据刷新后，已展开的邻居可能过期——清空防止旧数据残留
  useEffect(() => {
    setExpandedNodes([]);
    setExpandedLinks([]);
    setExpandCypher(null);
    setExpandBackend(null);
  }, [bundleId, changedNonce]);

  // 先 merge 再 cap：截断结果 render* 喂给所有下游（统计/算法/画布/右栏），
  // 保证「截断后再算」的口径与画布所见一致（计划 Step 8.4）
  const mergedNodes = useMemo(() => mergeById(nodes, expandedNodes), [nodes, expandedNodes]);
  const mergedLinks = useMemo(() => mergeById(links, expandedLinks), [links, expandedLinks]);
  const { nodes: renderNodes, links: renderLinks, capped } = useMemo(
    () =>
      forceFull
        ? { nodes: mergedNodes, links: mergedLinks, capped: false }
        : applyRenderCap(mergedNodes, mergedLinks),
    [mergedNodes, mergedLinks, forceFull],
  );

  // 子图提取基于全量图计算（中心邻域不应被类型筛选截断），显示时再与筛选取交集
  const egoIds = useMemo(() => {
    if (!algos.ego) return null;
    return extractEgoSubgraph(renderNodes, renderLinks, algos.ego.centerId, algos.ego.depth);
  }, [algos.ego, renderNodes, renderLinks]);

  // 统一口径：统计/搜索/算法全部走 enabledTypes ∩ visibleIds，与画布所见一致
  const { nodes: effectiveNodes, links: effectiveLinks } = useMemo(
    () => filterVisibleGraph(renderNodes, renderLinks, { enabledTypes, visibleIds: egoIds }),
    [renderNodes, renderLinks, enabledTypes, egoIds],
  );

  // 以下四个 useMemo 的依赖都含 effective*：筛选一变算法即重算（800 节点规模，单次 <10ms）
  const pagerankRanks = useMemo(
    () =>
      algos.pagerank
        ? normalizeRanks(computePageRank(effectiveNodes, effectiveLinks))
        : EMPTY_RANKS,
    [algos.pagerank, effectiveNodes, effectiveLinks],
  );
  const communityLabels = useMemo(
    () =>
      algos.community ? detectCommunities(effectiveNodes, effectiveLinks) : EMPTY_COMMUNITY,
    [algos.community, effectiveNodes, effectiveLinks],
  );
  // 路径按筛选后的图求：保证路径全程可见；筛选变化导致断链则高亮自动消失
  const pathSeq = useMemo(() => {
    if (!algos.path) return null;
    return shortestPath(effectiveNodes, effectiveLinks, algos.path.from, algos.path.to);
  }, [algos.path, effectiveNodes, effectiveLinks]);
  const pathIds = useMemo(
    () => (pathSeq ? pathLinkIds(renderLinks, pathSeq) : null),
    [pathSeq, renderLinks],
  );

  const nameOf = useMemo(
    () => new Map(renderNodes.map((node) => [node.id, node.name])),
    [renderNodes],
  );

  const stats = useMemo<ToolsPanelStats>(
    () => ({
      nodes: effectiveNodes.length,
      links: effectiveLinks.length,
      communities: algos.community ? new Set(communityLabels.values()).size : null,
    }),
    [effectiveNodes, effectiveLinks, algos.community, communityLabels],
  );

  const pageRankTop = useMemo(
    () => topPageRank(pagerankRanks, effectiveNodes, 5),
    [pagerankRanks, effectiveNodes],
  );

  const pathLabel = useMemo(() => {
    if (!algos.path) return null;
    const fromName = nameOf.get(algos.path.from) ?? algos.path.from;
    const toName = nameOf.get(algos.path.to) ?? algos.path.to;
    if (!pathSeq) return `${fromName} → ${toName}：当前筛选下不连通`;
    return `${fromName} → ${toName}（${pathSeq.length - 1} 跳）`;
  }, [algos.path, pathSeq, nameOf]);

  const egoLabel = useMemo(() => {
    if (!algos.ego) return null;
    const center = nameOf.get(algos.ego.centerId) ?? algos.ego.centerId;
    return `以 ${center} 为中心的 ${algos.ego.depth} 跳子图（${egoIds?.size ?? 0} 节点）`;
  }, [algos.ego, nameOf, egoIds]);

  // ---- 左栏回调 ----

  function handleToggleType(type: KnowledgeNodeType) {
    setEnabledTypes((previous) => {
      const next = new Set(previous);
      // 至少保留一类的约束不做硬拦截：全不勾 = 空图，统计与空态文案会如实反映
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function handleRunPageRank() {
    setAlgos((previous) => ({ ...previous, pagerank: !previous.pagerank }));
  }

  function handleRunCommunity() {
    setAlgos((previous) => ({ ...previous, community: !previous.community }));
  }

  function handleRunPath() {
    // 已有结果或拾取中再点 = 取消；否则进入起点拾取
    if (algos.path || pathPick) {
      setAlgos((previous) => ({ ...previous, path: null }));
      setPathPick(null);
      return;
    }
    setPathPick({ stage: 'start', startId: null });
  }

  function handleRunEgo(depth: 1 | 2) {
    if (!selectedNode) {
      toast.warning('先在画布选择中心节点');
      return;
    }
    setAlgos((previous) => ({
      ...previous,
      // 同参数再点 = 撤销子图；换参数 = 换中心/深度
      ego:
        previous.ego?.centerId === selectedNode.id && previous.ego.depth === depth
          ? null
          : { centerId: selectedNode.id, depth },
    }));
  }

  function handleResetAlgo() {
    setAlgos(INITIAL_ALGOS);
    setPathPick(null);
  }

  // ---- 选中回调（画布 / 搜索 / 邻接列表共用） ----

  // 画布节点回调：无选中态时只同步详情；拾取态时充当路径端点选择器。
  // 用 useCallback 稳定引用：GraphCanvas 内部 window 监听 effect 依赖本回调。
  const handleSelectNode = useCallback(
    (node: FullNode | null) => {
      setSelectedNode(node);
      if (!pathPick) return;
      // 拾取中点空白 = 取消拾取（画布背景 mousedown 会无条件回调 null）
      if (!node) {
        setPathPick(null);
        return;
      }
      if (pathPick.stage === 'start') {
        setPathPick({ stage: 'end', startId: node.id });
        return;
      }
      if (pathPick.startId === node.id) {
        toast.warning('终点不能与起点相同');
        return;
      }
      const seq = shortestPath(effectiveNodes, effectiveLinks, pathPick.startId, node.id);
      if (!seq) {
        // 不连通：保持 pick-end 让用户换终点重试，而不是取消整个流程
        toast.warning('两点不连通');
        return;
      }
      setAlgos((previous) => ({ ...previous, path: { from: pathPick.startId, to: node.id } }));
      setPathPick(null);
    },
    [pathPick, effectiveNodes, effectiveLinks],
  );

  const handleSelectLink = useCallback((link: FullLink | null) => {
    setSelectedLink(link);
  }, []);

  // 懒加载展开：邻居合并入图（去重保位由画布 idsKey 变化触发 mergeLayout）；
  // warnings 是 JSON/降级提示，失败把真实错误原因报给用户，不吞异常
  const expandNode = useCallback(
    async (nodeId: string, depth: 1 | 2) => {
      if (expandBusyRef.current) return;
      expandBusyRef.current = true;
      try {
        const result = await knowledgeApi.fetchNeighbors(bundleId, nodeId, depth); // 单次点选 ≤1 请求（验收 ④）
        setExpandedNodes((previous) => mergeById(previous, result.nodes));
        setExpandedLinks((previous) => mergeById(previous, result.links));
        setExpandCypher({ nodeId, preview: result.cypherPreview });
        setExpandBackend(result.backend);
        if (result.warnings.length > 0) toast.warning(result.warnings.join('；'));
      } catch (error) {
        toast.error(`展开失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        expandBusyRef.current = false;
      }
    },
    [bundleId],
  );

  // 展开模式下画布点选：同步右栏选中态并就地懒加载 1 跳邻居
  const handleExpandNode = useCallback(
    (node: FullNode, depth: 1 | 2) => {
      setSelectedNode(node);
      setSelectedLink(null);
      void expandNode(node.id, depth);
    },
    [expandNode],
  );

  // 搜索下拉 / 邻接列表点选：更新右栏详情 + 置 focus 触发画布平移聚焦（Task 8 Step 8.3）
  function handleLocate(node: FullNode) {
    setSelectedNode(node);
    setSelectedLink(null);
    setFocusNodeId(node.id);
  }

  // focus 归零：React 子 effect 先于父 effect 执行，画布已消费本次 focus 后再复位，
  // 同一节点重复点选才能再次触发聚焦（canvas 侧 lastFocusRef 只防 positions 变化误触发）
  useEffect(() => {
    if (focusNodeId !== null) setFocusNodeId(null);
  }, [focusNodeId]);

  const pathState: 'idle' | 'pick-start' | 'pick-end' =
    pathPick === null ? 'idle' : pathPick.stage === 'start' ? 'pick-start' : 'pick-end';
  const active = {
    pagerank: algos.pagerank,
    community: algos.community,
    path: algos.path !== null,
    ego: algos.ego !== null,
  };

  return (
    <div className="space-y-3">
      {/* 两个完整字面量类名三元：Tailwind JIT 要求任意值类名以完整形式出现在源码里 */}
      <div
        className={`grid gap-3 ${
          detailsOpen ? 'lg:grid-cols-[240px_1fr_320px]' : 'lg:grid-cols-[240px_1fr]'
        }`}
      >
        <ToolsPanel
          nodes={effectiveNodes}
          allNodes={renderNodes}
          stats={stats}
          searchText={searchText}
          onSearchText={setSearchText}
          onLocate={handleLocate}
          enabledTypes={enabledTypes}
          onToggleType={handleToggleType}
          onRunPageRank={handleRunPageRank}
          onRunPath={handleRunPath}
          onRunCommunity={handleRunCommunity}
          onRunEgo={handleRunEgo}
          onResetAlgo={handleResetAlgo}
          pathState={pathState}
          active={active}
          pageRankTop={pageRankTop}
          pathLabel={pathLabel}
          egoLabel={egoLabel}
          bundleId={bundleId}
          changedNonce={changedNonce}
        />

        <div className="min-w-0 space-y-2">
          {/* 800 上限提示条（计划 Step 8.4）：提示已截断并提供强制全量入口 */}
          {capped && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
              <span>
                当前库 {mergedNodes.length} 个节点，已按度数保留前 {RENDER_NODE_CAP} 个渲染，
                建议先用类型筛选或搜索定位。
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 shrink-0 text-xs"
                onClick={() => setForceFull(true)}
              >
                强制全量渲染
              </Button>
            </div>
          )}
          <div className="relative">
            {/* 右栏收起后的展开入口：画布顶部右侧空闲区（工具条已移底部） */}
            {!detailsOpen && (
              <Button
                variant="outline"
                size="icon"
                className="absolute right-2 top-2 z-10 size-8 bg-background/90 backdrop-blur"
                aria-label="展开属性卡"
                onClick={() => setDetailsOpen(true)}
              >
                <PanelRightOpen className="size-4" />
              </Button>
            )}
            {/* 画布始终收截断后的全量 render* + 各过滤集合：画布内部过滤才不会打乱布局保位 */}
            <GraphCanvas
              nodes={renderNodes}
              links={renderLinks}
              editable={editable}
              onEditNode={onEditNode}
              onEditLink={onEditLink}
              onAddLink={onAddLink}
              changedNonce={changedNonce}
              onSelectNode={handleSelectNode}
              onSelectLink={handleSelectLink}
              enabledTypes={enabledTypes}
              radiusOverride={pagerankRanks}
              communityOf={communityLabels}
              visibleIds={egoIds}
              pathIds={pathIds}
              expandMode={expandMode}
              onToggleExpand={setExpandMode}
              onExpandNode={handleExpandNode}
              focusNodeId={focusNodeId}
              svgApiRef={svgApiRef}
            />
            {loading && (
              <div
                className="absolute inset-0 grid place-items-center rounded-xl bg-background/60"
                aria-hidden
              >
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
          {!editable && (
            <p className="text-xs text-muted-foreground">
              共享 / 演示知识包为只读：可浏览图谱，不能编辑节点与关系。
            </p>
          )}
        </div>

        {detailsOpen && (
          <DetailsPanel
            selectedNode={selectedNode}
            selectedLink={selectedLink}
            nodes={renderNodes}
            links={renderLinks}
            bundleId={bundleId}
            editable={editable}
            cypherPreview={
              expandCypher && expandCypher.nodeId === selectedNode?.id
                ? expandCypher.preview
                : undefined
            }
            backend={expandBackend ?? backend}
            onLocate={handleLocate}
            onEditNode={onEditNode}
            onCollapse={() => setDetailsOpen(false)}
            onExpand={(depth) => {
              // 右栏「展开二级」等按钮入口：仅节点上下文可展开
              if (selectedNode) void expandNode(selectedNode.id, depth);
            }}
            svgApiRef={svgApiRef}
          />
        )}
      </div>
    </div>
  );
}
