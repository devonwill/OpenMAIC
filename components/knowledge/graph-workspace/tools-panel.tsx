'use client';

// 左工具面板（240px）：搜索 → 类型筛选 → 四算法 → 统计仪表盘（spec §4.1 自上而下）。
// 算法不在本组件执行：回调上收到 workspace，这里只负责触发与结果展示。
import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { PieChart } from 'echarts/charts';
import { LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useTheme } from '@/lib/hooks/use-theme';
import type { FullNode } from '@/lib/hooks/use-knowledge';
import type { PageRankTop } from '@/lib/knowledge/graph-workspace';
import { NODE_TYPE_LABEL, searchNodes, typeCounts } from '@/lib/knowledge/graph-workspace';
import { NODE_COLOR, nodeColor } from '@/lib/knowledge/graph-visuals';
import { KNOWLEDGE_NODE_TYPES, type KnowledgeNodeType } from '@/lib/knowledge/schema';

// 按需注册（照抄 usage-dashboard 模式）：只引饼图与图例/提示，避免全量打包。
echarts.use([PieChart, TitleComponent, LegendComponent, TooltipComponent, SVGRenderer]);

export interface ToolsPanelStats {
  nodes: number;
  links: number;
  /** 社区发现未运行时为 null，仪表盘显示「—」。 */
  communities: number | null;
}

export interface ToolsPanelProps {
  /** 筛选后的有效节点：搜索源与饼图口径（与画布所见一致）。 */
  nodes: FullNode[];
  /** 截断后的全量节点：类型勾选行显示「本类还有多少节点」，即使被隐藏也要可见。 */
  allNodes: FullNode[];
  stats: ToolsPanelStats;
  searchText: string;
  onSearchText: (value: string) => void;
  /** 搜索点选 / Enter 首条命中：更新右栏并经 focusNodeId 让画布平移缩放聚焦（Task 8）。 */
  onLocate: (node: FullNode) => void;
  enabledTypes: Set<KnowledgeNodeType>;
  onToggleType: (type: KnowledgeNodeType) => void;
  onRunPageRank: () => void;
  onRunPath: () => void;
  onRunCommunity: () => void;
  onRunEgo: (depth: 1 | 2) => void;
  onResetAlgo: () => void;
  /** 最短路径两段式拾取状态：按钮与提示文案据此切换。 */
  pathState: 'idle' | 'pick-start' | 'pick-end';
  /** 算法激活态：按钮高亮用（四算法可叠加，清除结果一键复位）。 */
  active: { pagerank: boolean; community: boolean; path: boolean; ego: boolean };
  pageRankTop: PageRankTop[];
  pathLabel: string | null;
  egoLabel: string | null;
  /** 调试信息（原骨架底部调试行按计划移入本面板小字展示）。 */
  bundleId: string;
  changedNonce: number;
}

export function ToolsPanel({
  nodes,
  allNodes,
  stats,
  searchText,
  onSearchText,
  onLocate,
  enabledTypes,
  onToggleType,
  onRunPageRank,
  onRunPath,
  onRunCommunity,
  onRunEgo,
  onResetAlgo,
  pathState,
  active,
  pageRankTop,
  pathLabel,
  egoLabel,
  bundleId,
  changedNonce,
}: ToolsPanelProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  // 搜索下拉只在聚焦且有输入时展开；点选后清空输入并收起。
  const [searchOpen, setSearchOpen] = useState(false);
  const matches = useMemo(() => searchNodes(nodes, searchText, 8), [nodes, searchText]);
  const showDropdown = searchOpen && searchText.trim().length > 0;

  const effectiveCounts = useMemo(() => typeCounts(nodes), [nodes]);
  const allCounts = useMemo(() => typeCounts(allNodes), [allNodes]);

  // 饼图数据：只统计非零类型（全部为 0 时由空态文案兜底）。
  const pieData = useMemo(
    () =>
      KNOWLEDGE_NODE_TYPES.filter((type) => effectiveCounts[type] > 0).map((type) => ({
        name: NODE_TYPE_LABEL[type],
        value: effectiveCounts[type],
        itemStyle: { color: NODE_COLOR[type] },
      })),
    [effectiveCounts],
  );

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    if (!chartInstance.current) {
      chartInstance.current = echarts.init(el, undefined, { renderer: 'svg' });
    }
    const chart = chartInstance.current;
    const labelColor = isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.65)';
    chart.setOption(
      {
        tooltip: { trigger: 'item' },
        legend: {
          orient: 'vertical',
          right: 0,
          top: 'center',
          itemWidth: 10,
          itemHeight: 10,
          textStyle: { color: labelColor, fontSize: 11 },
        },
        series: [
          {
            type: 'pie',
            radius: ['38%', '64%'],
            // 240px 窄栏：圆心靠左给右侧图例让位
            center: ['28%', '50%'],
            label: { show: false },
            data: pieData,
          },
        ],
      },
      // notMerge：类型被全部筛掉时旧扇区必须清掉，不能残留。
      true,
    );
    chart.resize();
  }, [pieData, isDark]);

  useEffect(() => {
    const onResize = () => chartInstance.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, []);

  function handlePick(node: FullNode) {
    onLocate(node);
    onSearchText('');
    setSearchOpen(false);
  }

  const algoButtonClass = (isActive: boolean) =>
    `h-7 justify-start px-2 text-xs ${isActive ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''}`;

  return (
    <Card className="lg:h-fit">
      <CardContent className="space-y-4 p-4">
        {/* 1. 搜索框：输入即过滤，下拉前 8 条 */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchText}
            onChange={(event) => onSearchText(event.target.value)}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setSearchOpen(false)}
            onKeyDown={(event) => {
              // Enter 直接定位首条命中，省一次鼠标移动
              if (event.key === 'Enter' && matches[0]) {
                event.preventDefault();
                handlePick(matches[0]);
              }
            }}
            placeholder="搜索节点 / 别名 / 分类"
            aria-label="搜索节点"
            className="h-8 pl-7 text-xs"
          />
          {showDropdown && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-md border bg-popover shadow-md">
              {matches.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">无匹配节点</p>
              ) : (
                matches.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    // 阻止默认聚焦转移，否则 input 先失焦收起下拉，click 根本到不了
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handlePick(node)}
                    className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs hover:bg-accent"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: nodeColor(node.nodeType) }}
                    />
                    <span className="truncate">{node.name}</span>
                    <span className="ml-auto shrink-0 text-muted-foreground">
                      {NODE_TYPE_LABEL[node.nodeType]}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* 2. 类型筛选：5 类复选 + 色点图例 + 计数 */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">类型筛选</p>
          {KNOWLEDGE_NODE_TYPES.map((type) => (
            <label
              key={type}
              className="flex cursor-pointer items-center gap-2 text-xs"
            >
              <Checkbox
                checked={enabledTypes.has(type)}
                onCheckedChange={() => onToggleType(type)}
                aria-label={`筛选 ${NODE_TYPE_LABEL[type]}`}
              />
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: NODE_COLOR[type] }}
              />
              <span className="flex-1">{NODE_TYPE_LABEL[type]}</span>
              <span className="tabular-nums text-muted-foreground">{allCounts[type]}</span>
            </label>
          ))}
        </div>

        {/* 3. 图算法工具：四算法可叠加，再点一次即撤销；一键清除全部 */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">图算法</p>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              variant={active.pagerank ? 'default' : 'outline'}
              size="sm"
              className={algoButtonClass(active.pagerank)}
              onClick={onRunPageRank}
            >
              PageRank
            </Button>
            <Button
              variant={active.path || pathState !== 'idle' ? 'default' : 'outline'}
              size="sm"
              className={algoButtonClass(active.path || pathState !== 'idle')}
              onClick={onRunPath}
            >
              最短路径
            </Button>
            <Button
              variant={active.community ? 'default' : 'outline'}
              size="sm"
              className={algoButtonClass(active.community)}
              onClick={onRunCommunity}
            >
              社区发现
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 justify-start px-2 text-xs"
              onClick={onResetAlgo}
            >
              清除结果
            </Button>
            <Button
              variant={active.ego ? 'default' : 'outline'}
              size="sm"
              className={algoButtonClass(active.ego)}
              onClick={() => onRunEgo(1)}
            >
              子图·1 跳
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 justify-start px-2 text-xs"
              onClick={() => onRunEgo(2)}
            >
              子图·2 跳
            </Button>
          </div>
          {pathState !== 'idle' && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {pathState === 'pick-start'
                ? '点击画布上的节点作为起点'
                : '起点已定，再点击一个节点作为终点'}
            </p>
          )}
        </div>

        {/* 4. 统计仪表盘：三数卡 + 四算法结果区 + 类型分布饼图 */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">统计仪表盘</p>
          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded-md border px-2 py-1.5 text-center">
              <p className="text-sm font-semibold tabular-nums">{stats.nodes}</p>
              <p className="text-[10px] text-muted-foreground">节点</p>
            </div>
            <div className="rounded-md border px-2 py-1.5 text-center">
              <p className="text-sm font-semibold tabular-nums">{stats.links}</p>
              <p className="text-[10px] text-muted-foreground">关系</p>
            </div>
            <div className="rounded-md border px-2 py-1.5 text-center">
              <p className="text-sm font-semibold tabular-nums">
                {stats.communities ?? '—'}
              </p>
              <p className="text-[10px] text-muted-foreground">社区</p>
            </div>
          </div>

          {/* 算法结果区：Top-N / 路径 / 子图，未运行的块不占位 */}
          {active.pagerank && pageRankTop.length > 0 && (
            <div className="rounded-md border p-2">
              <p className="mb-1 text-[10px] text-muted-foreground">PageRank Top {pageRankTop.length}</p>
              <ol className="space-y-0.5">
                {pageRankTop.map((item, index) => (
                  <li key={item.id} className="flex items-center gap-1.5 text-xs">
                    <span className="w-3 shrink-0 tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {Math.round(item.score * 100)}%
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {pathLabel && (
            <p className="rounded-md border px-2 py-1.5 text-xs">{pathLabel}</p>
          )}
          {egoLabel && (
            <p className="rounded-md border px-2 py-1.5 text-xs">{egoLabel}</p>
          )}

          {pieData.length > 0 ? (
            <div ref={chartRef} style={{ width: '100%', height: 130 }} />
          ) : (
            <div className="grid h-[80px] place-items-center rounded-md border text-xs text-muted-foreground">
              当前筛选下无节点
            </div>
          )}
        </div>

        {/* 原骨架底部调试行按计划移入此处（小字，不占三栏布局） */}
        <p className="break-all border-t pt-2 text-[10px] leading-relaxed text-muted-foreground">
          bundleId: {bundleId} · 重新加载：{changedNonce}
        </p>
      </CardContent>
    </Card>
  );
}
