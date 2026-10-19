'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { GitBranch, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { FullLink, FullNode } from '@/lib/hooks/use-knowledge';
import type { KnowledgeNodeType } from '@/lib/knowledge/schema';
import {
  buildNeighborIds,
  communityColor,
  computeDegree,
  linkDashArray,
  MIN_NODE_R,
  NODE_COLOR,
  nodeColor,
  normalizeRadius,
} from '@/lib/knowledge/graph-visuals';
import { computeFocusTransform, NODE_TYPE_LABEL } from '@/lib/knowledge/graph-workspace';
// d3-force：只取力模拟，布局坐标仍由本组件 state 持有，拖拽/合并保位状态机不变（spec §4.2）
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';

const VIEW_W = 1000;
const VIEW_H = 640;
const CENTER = { x: VIEW_W / 2, y: VIEW_H / 2 };
const CLICK_THRESHOLD_PX = 4;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

interface Point {
  x: number;
  y: number;
}

export interface GraphCanvasProps {
  nodes: FullNode[];
  links: FullLink[];
  editable: boolean;
  /** null 表示点击「新增节点」。 */
  onEditNode: (node: FullNode | null) => void;
  /** 点击边时回调，x/y 为屏幕坐标（clientX/clientY），供 Popover 定位。 */
  onEditLink: (link: FullLink, x: number, y: number) => void;
  onAddLink: () => void;
  /** 外部数据变更（保存/删除后）触发整体重新布局的信号。 */
  changedNonce?: number;
  /** 节点选中回调（点击/Enter 触发）；右栏详情与搜索定位共用（Task 7 上收）。 */
  onSelectNode?: (node: FullNode | null) => void;
  /** 类型筛选（左栏 5 类勾选，缺省不筛）；替代原画布内「仅看术语」开关。 */
  enabledTypes?: Set<KnowledgeNodeType>;
  /** PageRank 归一化 0..1 覆盖（缺省按度数基础值）。 */
  radiusOverride?: Map<string, number>;
  /** 社区发现结果：节点 id → 社区代表 id，用于外圈着色。 */
  communityOf?: Map<string, string>;
  /** 选中连边回调（右栏属性卡）；点节点或空白时回传 null，与 onSelectNode 对称。 */
  onSelectLink?: (link: FullLink | null) => void;
  /**
   * 子图提取（Ego）可见集，null/缺省 = 全量。
   * 必须在画布内部过滤而非让外部传过滤后的 nodes——外部过滤会改变 idsKey，
   * 触发 mergeLayout 丢弃被隐藏节点的坐标，重新显示时节点会整体跳动重排。
   */
  visibleIds?: Set<string> | null;
  /** 最短路径涉及的边 id 集：路径边橙色加粗（spec §5.1 视觉编码）。 */
  pathIds?: Set<string> | null;
  /** 展开模式开关（工具条 Switch 受控值）；开启时点击节点即触发 Ego 展开而非选中。 */
  expandMode?: boolean;
  /** 展开模式开关的状态回写（workspace 持有状态）。 */
  onToggleExpand?: (value: boolean) => void;
  /** Ego 展开回调：点击节点 depth=1，右栏「展开二级」经 workspace 传 depth=2。 */
  onExpandNode?: (node: FullNode, depth: 1 | 2) => void;
  /** 搜索定位目标：变化时画布平移缩放到该节点并选中（用后置 null 支持同节点重复定位）。 */
  focusNodeId?: string | null;
  /**
   * 暴露导出能力：details-panel 经该 ref 触发 exportSvg/exportPng。
   * 不外泄内部 svgRef——序列化逻辑留在画布内（计划 Step 8.1 注意事项）。
   */
  svgApiRef?: { current: GraphCanvasExportApi | null };
}

/** 画布对外暴露的导出接口：legend 文案由调用方传入（buildExportLegend 生成）。 */
export interface GraphCanvasExportApi {
  exportSvg: (legend: string[]) => string;
  exportPng: (legend: string[]) => Promise<void>;
}

type DragState =
  | { kind: 'pan'; startClient: Point; startPan: Point }
  | { kind: 'node'; id: string; startClient: Point; startPos: Point; moved: boolean }
  | null;

/** 圆形均匀布局：节点按索引 cos/sin 分布，半径随节点数自适应。 */
function circularLayout(nodes: FullNode[]): Map<string, Point> {
  const count = nodes.length;
  const radius = Math.max(170, Math.min(380, 90 + count * 11));
  const map = new Map<string, Point>();
  nodes.forEach((node, index) => {
    const angle = count === 1 ? -Math.PI / 2 : (index * 2 * Math.PI) / count - Math.PI / 2;
    map.set(node.id, {
      x: CENTER.x + radius * Math.cos(angle),
      y: CENTER.y + radius * Math.sin(angle),
    });
  });
  return map;
}

/** 增删节点后的合并布局：保留存量节点（含拖拽）位置，仅为新节点补圆形位。 */
function mergeLayout(previous: Map<string, Point>, nodes: FullNode[]): Map<string, Point> {
  const count = nodes.length;
  const radius = Math.max(170, Math.min(380, 90 + count * 11));
  const next = new Map<string, Point>();
  nodes.forEach((node, index) => {
    const kept = previous.get(node.id);
    if (kept) {
      next.set(node.id, kept);
      return;
    }
    const angle = count === 1 ? -Math.PI / 2 : (index * 2 * Math.PI) / count - Math.PI / 2;
    next.set(node.id, {
      x: CENTER.x + radius * Math.cos(angle),
      y: CENTER.y + radius * Math.sin(angle),
    });
  });
  return next;
}

function idsKey(nodes: FullNode[]): string {
  return nodes.map((node) => node.id).join('|');
}

/** 可选布局：圆形 / 分层 / 力导向 / 网格，供用户在工具条切换。 */
type LayoutKind = 'circular' | 'hierarchical' | 'force' | 'grid';

const LAYOUT_OPTIONS: { value: LayoutKind; label: string }[] = [
  { value: 'circular', label: '圆形布局' },
  { value: 'hierarchical', label: '分层布局' },
  { value: 'force', label: '力导向布局' },
  { value: 'grid', label: '网格布局' },
];

/** 网格布局：按 √n 自适应行列均铺，节点多时也不重叠。 */
function gridLayout(nodes: FullNode[]): Map<string, Point> {
  const map = new Map<string, Point>();
  const count = nodes.length;
  if (!count) return map;
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const spacingX = VIEW_W / (columns + 1);
  const spacingY = VIEW_H / (rows + 1);
  nodes.forEach((node, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    map.set(node.id, { x: spacingX * (col + 1), y: spacingY * (row + 1) });
  });
  return map;
}

/** 分层布局：按连通分量 BFS 分层，层内水平均布，孤立节点收拢到最后一层。 */
function hierarchicalLayout(nodes: FullNode[], links: FullLink[]): Map<string, Point> {
  const map = new Map<string, Point>();
  const count = nodes.length;
  if (!count) return map;
  const adjacency = new Map<string, string[]>();
  nodes.forEach((node) => adjacency.set(node.id, []));
  links.forEach((link) => {
    adjacency.get(link.source)?.push(link.target);
    adjacency.get(link.target)?.push(link.source);
  });
  const layerOf = new Map<string, number>();
  const isolated: string[] = [];
  const remaining = new Set(nodes.map((node) => node.id));
  let base = 0;
  while (remaining.size) {
    // 每个分量从度数最高的节点出发，保证主干居上。
    let start = '';
    let bestDegree = -1;
    for (const id of remaining) {
      const degree = adjacency.get(id)?.length ?? 0;
      if (degree > bestDegree) {
        bestDegree = degree;
        start = id;
      }
    }
    if (bestDegree === 0) {
      // 剩余全是孤立节点，统一收进最后一层。
      isolated.push(...remaining);
      remaining.clear();
      break;
    }
    remaining.delete(start);
    layerOf.set(start, base);
    const queue = [start];
    let maxLayer = base;
    while (queue.length) {
      const id = queue.shift() as string;
      const nextLayer = (layerOf.get(id) ?? base) + 1;
      for (const next of adjacency.get(id) ?? []) {
        if (!remaining.has(next)) continue;
        remaining.delete(next);
        layerOf.set(next, nextLayer);
        maxLayer = Math.max(maxLayer, nextLayer);
        queue.push(next);
      }
    }
    base = maxLayer + 2; // 分量之间空一行，避免不同分量层号冲突。
  }
  if (isolated.length) {
    isolated.forEach((id) => layerOf.set(id, base));
  }
  const byLayer = new Map<number, string[]>();
  nodes.forEach((node) => {
    const layer = layerOf.get(node.id) ?? 0;
    const bucket = byLayer.get(layer) ?? [];
    bucket.push(node.id);
    byLayer.set(layer, bucket);
  });
  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  const spacingY = VIEW_H / (layers.length + 1);
  layers.forEach((layer, rowIndex) => {
    const bucket = byLayer.get(layer) ?? [];
    const spacingX = VIEW_W / (bucket.length + 1);
    bucket.forEach((id, colIndex) => {
      map.set(id, { x: spacingX * (colIndex + 1), y: spacingY * (rowIndex + 1) });
    });
  });
  return map;
}

/** d3-force 模拟节点：只带 id 与圆形种子坐标，其余速度/力由模拟器内部维护。 */
interface SimNode {
  id: string;
  x: number;
  y: number;
}

/** d3-force 布局：圆形种子 + 静态模拟 300 tick；坐标夹取回画布内。 */
function forceLayout(nodes: FullNode[], links: FullLink[]): Map<string, Point> {
  const seed = circularLayout(nodes);
  if (nodes.length === 0) return seed;
  const byId = new Set(nodes.map((node) => node.id));
  const simNodes: SimNode[] = nodes.map((node) => {
    const pos = seed.get(node.id) ?? CENTER;
    return { id: node.id, x: pos.x, y: pos.y };
  });
  // 构造时 source/target 用 id 字符串；d3 初始化后会改写成节点引用——只在本函数内使用，不外泄。
  const simLinks = links
    .filter((link) => byId.has(link.source) && byId.has(link.target))
    .map((link) => ({ source: link.source, target: link.target }));
  const simulation = forceSimulation<SimNode>(simNodes)
    .force(
      'link',
      forceLink<SimNode, { source: string; target: string }>(simLinks)
        .id((node) => node.id)
        .distance(90),
    )
    .force('charge', forceManyBody<SimNode>().strength(-220))
    .force('collide', forceCollide<SimNode>(MIN_NODE_R + 6))
    .force('x', forceX<SimNode>(CENTER.x).strength(0.04))
    .force('y', forceY<SimNode>(CENTER.y).strength(0.04))
    .stop();
  // 静态模拟：同步跑满 300 tick 后直接取坐标，避免逐帧 setState 重绘（计划 Step 6.3）。
  simulation.tick(300);
  const result = new Map<string, Point>();
  for (const node of simNodes) {
    result.set(node.id, {
      x: Math.max(50, Math.min(VIEW_W - 50, node.x ?? CENTER.x)),
      y: Math.max(50, Math.min(VIEW_H - 50, node.y ?? CENTER.y)),
    });
  }
  return result;
}

function computeLayout(kind: LayoutKind, nodes: FullNode[], links: FullLink[]): Map<string, Point> {
  switch (kind) {
    case 'hierarchical':
      return hierarchicalLayout(nodes, links);
    case 'force':
      return forceLayout(nodes, links);
    case 'grid':
      return gridLayout(nodes);
    default:
      return circularLayout(nodes);
  }
}

function truncateName(name: string): string {
  return name.length > 8 ? `${name.slice(0, 8)}…` : name;
}

function truncateRelation(relation: string): string {
  return relation.length > 10 ? `${relation.slice(0, 10)}…` : relation;
}

/** 导出图例的类型色点：5 类中文标签 → 画布同源 NODE_COLOR（与 nodeColor 口径一致）。 */
function legendColorOf(text: string): string {
  for (const [type, label] of Object.entries(NODE_TYPE_LABEL)) {
    if (label === text) return NODE_COLOR[type as KnowledgeNodeType];
  }
  return NODE_COLOR.concept;
}

/** 触发浏览器下载：createObjectURL + 临时 anchor；延迟 revoke，避免下载尚未开始链接就失效。 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 序列化画布为可独立打开的 SVG 文本（含图例块）。
 * 两处坑必须处理：① SVG 内的 Tailwind className 脱离页面样式表即失效 →
 * 按 `[class]` 选择器序号与原树一一对齐，把 getComputedStyle 结果内联成 fill/stroke 属性；
 * ② 仅 viewBox 无 width/height 时 PNG 栅格化 intrinsic size 错误 → 显式补 1000×640。
 */
function serializeWithLegend(svg: SVGSVGElement, legend: readonly string[]): string {
  const ns = 'http://www.w3.org/2000/svg';
  const clone = svg.cloneNode(true) as SVGSVGElement;
  // clone 尚未增删节点，两棵树结构一致，序号对齐取样式；先内联再加图例，图例不参与对齐。
  const originals = svg.querySelectorAll('[class]');
  const inlines = clone.querySelectorAll('[class]');
  originals.forEach((original, index) => {
    const target = inlines[index];
    if (!target) return;
    const style = getComputedStyle(original);
    target.setAttribute('fill', style.fill);
    // SVG 初始 stroke 为 none：非 none 才写入，避免给无描边元素画出默认黑边
    if (style.stroke && style.stroke !== 'none') target.setAttribute('stroke', style.stroke);
    target.removeAttribute('class');
  });
  clone.removeAttribute('class');
  clone.setAttribute('xmlns', ns);
  clone.setAttribute('width', String(VIEW_W));
  clone.setAttribute('height', String(VIEW_H));
  // 字体继承自页面 CSS，导出文件需显式声明，否则回落到浏览器默认衬线字体
  clone.setAttribute('font-family', getComputedStyle(svg).fontFamily || 'sans-serif');
  // 白底：图例为深色文字，PNG 在深色查看器下透明底会不可读
  const background = document.createElementNS(ns, 'rect');
  background.setAttribute('width', String(VIEW_W));
  background.setAttribute('height', String(VIEW_H));
  background.setAttribute('fill', '#ffffff');
  clone.insertBefore(background, clone.firstChild);
  // 图例块：每行高 18；类型条目画色点，实线/虚线条目画线段（虚线给 dasharray）。
  const g = document.createElementNS(ns, 'g');
  legend.forEach((text, index) => {
    const y = VIEW_H - legend.length * 18 + index * 18 + 12;
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', '38');
    label.setAttribute('y', String(y));
    label.setAttribute('font-size', '12');
    label.setAttribute('fill', '#0f172a');
    label.textContent = text;
    if (text.startsWith('实线：') || text.startsWith('虚线：')) {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', '16');
      line.setAttribute('y1', String(y - 4));
      line.setAttribute('x2', '32');
      line.setAttribute('y2', String(y - 4));
      line.setAttribute('stroke', '#475569');
      line.setAttribute('stroke-width', '2');
      if (text.startsWith('虚线：')) line.setAttribute('stroke-dasharray', '6 3');
      g.append(line, label);
      return;
    }
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', '24');
    dot.setAttribute('cy', String(y - 4));
    dot.setAttribute('r', '6');
    dot.setAttribute('fill', legendColorOf(text));
    g.append(dot, label);
  });
  clone.append(g);
  return new XMLSerializer().serializeToString(clone);
}

export function GraphCanvas({
  nodes,
  links,
  editable,
  onEditNode,
  onEditLink,
  onAddLink,
  changedNonce,
  onSelectNode,
  enabledTypes,
  radiusOverride,
  communityOf,
  onSelectLink,
  visibleIds,
  pathIds,
  expandMode,
  onToggleExpand,
  onExpandNode,
  focusNodeId,
  svgApiRef,
}: GraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [layoutKind, setLayoutKind] = useState<LayoutKind>('force');
  // 初始布局与 layoutKind 保持一致：首帧即力导向，避免「默认圆形再跳变」。
  const [positions, setPositions] = useState<Map<string, Point>>(() =>
    computeLayout('force', nodes, links),
  );
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  // 画布内选中回显（橙圈）；Task 7 由 onSelectNode 上收后仍保留，画布要自证高亮。
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [interacting, setInteracting] = useState(false);

  const dragRef = useRef<DragState>(null);
  const nodesRef = useRef(nodes);
  const linksRef = useRef(links);
  const layoutKindRef = useRef(layoutKind);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const knownIdsRef = useRef<string>(idsKey(nodes));
  const lastNonceRef = useRef<number | undefined>(changedNonce);
  // 展开开关走 ref：mouseup 是 window 级监听 effect，用 ref 读值可避免开关切换时反复重订阅
  const expandModeRef = useRef(expandMode);
  const onExpandNodeRef = useRef(onExpandNode);
  nodesRef.current = nodes;
  linksRef.current = links;
  layoutKindRef.current = layoutKind;
  panRef.current = pan;
  zoomRef.current = zoom;
  expandModeRef.current = expandMode;
  onExpandNodeRef.current = onExpandNode;

  // changedNonce 变化 → 外部数据变更，按当前选中布局整体重排；仅 nodes 身份变化（同批数据）→ 合并保位。
  useEffect(() => {
    if (changedNonce !== lastNonceRef.current) {
      lastNonceRef.current = changedNonce;
      knownIdsRef.current = idsKey(nodes);
      setPositions(computeLayout(layoutKindRef.current, nodes, linksRef.current));
      return;
    }
    const key = idsKey(nodes);
    if (key === knownIdsRef.current) return;
    knownIdsRef.current = key;
    setPositions((previous) => mergeLayout(previous, nodes));
  }, [nodes, changedNonce]);

  // 搜索定位：focusNodeId 变化 → 目标点平移到视口中心并选中（不发请求，验收④）。
  // lastFocusRef 挡住 positions 身份变化（合批补位/重排）导致的重复触发；
  // 同节点重复点选由 workspace 后置归零后再传入新值，不受此 guard 影响。
  const lastFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusNodeId) return;
    if (lastFocusRef.current === focusNodeId) return;
    const pos = positions.get(focusNodeId);
    if (!pos) return; // 布局尚未产出该节点（数据刚变更）时放弃本次定位，不阻塞后续交互
    lastFocusRef.current = focusNodeId;
    const transform = computeFocusTransform(pos, CENTER, 1.2);
    setPan(transform.pan);
    setZoom(transform.zoom);
    // 画布自证选中圈；不回调 onSelectNode——右栏路径拾取状态机由 workspace 自行管理，避免误触
    setSelectedNodeId(focusNodeId);
  }, [focusNodeId, positions]);

  const toSvgPoint = useCallback((clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const transformed = point.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  }, []);

  // 滚轮缩放必须非 passive 监听才能 preventDefault。
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const under = toSvgPoint(event.clientX, event.clientY);
      const currentZoom = zoomRef.current;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, currentZoom * factor));
      if (nextZoom === currentZoom) return;
      const currentPan = panRef.current;
      // 保持光标下的世界坐标点不动：p' = q - z' * (q - p) / z
      setPan({
        x: under.x - ((under.x - currentPan.x) * nextZoom) / currentZoom,
        y: under.y - ((under.y - currentPan.y) * nextZoom) / currentZoom,
      });
      setZoom(nextZoom);
    };
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, [toSvgPoint]);

  /**
   * 节点激活统一入口（点击/键盘）：展开模式下改为懒加载 1 跳邻居，不走选中回调链；
   * 画布内仍置选中圈——用户能立刻看到点的是哪个节点。
   */
  const activateNode = useCallback(
    (node: FullNode) => {
      setSelectedNodeId(node.id);
      if (expandModeRef.current && onExpandNodeRef.current) {
        onExpandNodeRef.current(node, 1);
      } else {
        onSelectNode?.(node);
      }
      // 节点与连边选中互斥：右栏属性卡一次只展示一种详情
      setSelectedLinkId(null);
      onSelectLink?.(null);
    },
    [onSelectNode, onSelectLink],
  );

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === 'pan') {
        const current = toSvgPoint(event.clientX, event.clientY);
        const start = toSvgPoint(drag.startClient.x, drag.startClient.y);
        setPan({ x: drag.startPan.x + current.x - start.x, y: drag.startPan.y + current.y - start.y });
        return;
      }
      const distance = Math.hypot(
        event.clientX - drag.startClient.x,
        event.clientY - drag.startClient.y,
      );
      if (!drag.moved && distance >= CLICK_THRESHOLD_PX) {
        dragRef.current = { ...drag, moved: true };
      }
      const current = toSvgPoint(event.clientX, event.clientY);
      const start = toSvgPoint(drag.startClient.x, drag.startClient.y);
      const dx = (current.x - start.x) / zoomRef.current;
      const dy = (current.y - start.y) / zoomRef.current;
      setPositions((previous) => {
        const next = new Map(previous);
        next.set(drag.id, { x: drag.startPos.x + dx, y: drag.startPos.y + dy });
        return next;
      });
    };
    const handleMouseUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      setInteracting(false);
      if (drag?.kind === 'node' && !drag.moved) {
        // 未拖动 = 点击：按展开模式分流（展开 or 选中高亮，编辑入口移交右栏详情与「新增节点」）
        const node = nodesRef.current.find((item) => item.id === drag.id);
        if (node) activateNode(node);
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [toSvgPoint, activateNode]);

  // 导出 API（计划 Step 8.5）：[] memo 保持身份稳定，父级 ref 只在挂载/卸载时写入。
  const exportApi = useMemo<GraphCanvasExportApi>(
    () => ({
      exportSvg: (legend) => {
        const svg = svgRef.current;
        if (!svg) throw new Error('画布未就绪，无法导出 SVG');
        const text = serializeWithLegend(svg, legend);
        downloadBlob(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }), 'graph.svg');
        return text;
      },
      exportPng: async (legend) => {
        const svg = svgRef.current;
        if (!svg) throw new Error('画布未就绪，无法导出 PNG');
        const svgText = serializeWithLegend(svg, legend);
        const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
        try {
          const img = new Image();
          // onerror 必须 reject 具体原因：SVG 不合法/被浏览器策略拒绝时调用方要拿到可展示的信息
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('导出图像加载失败：浏览器拒绝渲染该 SVG'));
            img.src = url;
          });
          const canvasEl = document.createElement('canvas');
          canvasEl.width = VIEW_W * 2; // 2x 清晰度
          canvasEl.height = VIEW_H * 2;
          const ctx = canvasEl.getContext('2d');
          if (!ctx) throw new Error('Canvas 2D 上下文不可用，无法导出 PNG');
          ctx.scale(2, 2);
          ctx.drawImage(img, 0, 0);
          const png = await new Promise<Blob | null>((resolve) => canvasEl.toBlob(resolve, 'image/png'));
          if (!png) throw new Error('PNG 编码失败');
          downloadBlob(png, 'graph.png');
        } finally {
          URL.revokeObjectURL(url);
        }
      },
    }),
    [],
  );

  // 挂载时把导出 API 交给父级 svgApiRef；卸载置空，防止父级持有已卸载画布的引用。
  useEffect(() => {
    if (!svgApiRef) return;
    svgApiRef.current = exportApi;
    return () => {
      svgApiRef.current = null;
    };
  }, [svgApiRef, exportApi]);

  // 类型筛选（左栏勾选）与子图提取（Ego）都在此过滤；缺省不过滤，保持全量展示。
  const visibleNodes = useMemo(
    () =>
      nodes.filter(
        (node) =>
          (!enabledTypes || enabledTypes.has(node.nodeType)) &&
          (!visibleIds || visibleIds.has(node.id)),
      ),
    [nodes, enabledTypes, visibleIds],
  );
  const visibleIdSet = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleLinks = useMemo(
    () => links.filter((link) => visibleIdSet.has(link.source) && visibleIdSet.has(link.target)),
    [links, visibleIdSet],
  );

  // 度数 → 半径基础值（PageRank 运行后由 radiusOverride 覆盖，spec §5.2）。
  const degree = useMemo(() => computeDegree(links), [links]);
  const maxDegree = useMemo(() => {
    let max = 1;
    for (const value of degree.values()) if (value > max) max = value;
    return max;
  }, [degree]);
  const radiusOf = useCallback(
    (node: FullNode): number => {
      const raw = radiusOverride?.get(node.id) ?? (degree.get(node.id) ?? 0) / maxDegree;
      return normalizeRadius(raw);
    },
    [degree, maxDegree, radiusOverride],
  );
  // 连线端点偏移也要用动态半径，否则大节点会被连线戳穿圆心。
  const radiusById = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of visibleNodes) map.set(node.id, radiusOf(node));
    return map;
  }, [visibleNodes, radiusOf]);
  // hover 源 + 直接邻居集合：无关节点/边降透明度（spec §5.2 hover 高亮）。
  const neighborIds = useMemo(
    () => (hoveredId ? buildNeighborIds(links, hoveredId) : null),
    [links, hoveredId],
  );

  function handleBackgroundMouseDown(event: ReactMouseEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    // 点空白处无条件清空双选中并同步外部：即使已是 null 也要回调——
    // workspace 依赖该回调取消最短路径的两段式拾取（未选中时也可能在拾取中）。
    setSelectedNodeId(null);
    onSelectNode?.(null);
    setSelectedLinkId(null);
    onSelectLink?.(null);
    dragRef.current = {
      kind: 'pan',
      startClient: { x: event.clientX, y: event.clientY },
      startPan: panRef.current,
    };
    setInteracting(true);
  }

  function handleNodeMouseDown(event: ReactMouseEvent<SVGGElement>, node: FullNode) {
    if (event.button !== 0) return;
    event.stopPropagation();
    const startPos = positions.get(node.id) ?? CENTER;
    dragRef.current = {
      kind: 'node',
      id: node.id,
      startClient: { x: event.clientX, y: event.clientY },
      startPos,
      moved: false,
    };
    setInteracting(true);
  }

  function handleLinkClick(event: ReactMouseEvent<SVGLineElement>, link: FullLink) {
    event.stopPropagation();
    setSelectedLinkId(link.id);
    onSelectLink?.(link);
    // 与点节点对称：清掉节点选中，右栏切到边详情
    setSelectedNodeId(null);
    onSelectNode?.(null);
    onEditLink(link, event.clientX, event.clientY);
  }

  function applyLayout(kind: LayoutKind) {
    setPositions(computeLayout(kind, nodesRef.current, linksRef.current));
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setSelectedLinkId(null);
  }

  function handleRelayout() {
    applyLayout(layoutKindRef.current);
  }

  function handleLayoutChange(value: string) {
    const kind = value as LayoutKind;
    setLayoutKind(kind);
    applyLayout(kind);
  }

  const isEmpty = nodes.length === 0;

  return (
    <div className="relative h-[560px] w-full overflow-hidden rounded-xl border bg-muted/30">
      {/* 工具条移底部（spec §4.2）：顶部不再遮挡节点 */}
      {!isEmpty && (
        <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-lg border bg-background/90 px-2 py-1.5 shadow-sm backdrop-blur">
          {editable && (
            <>
              <Button variant="outline" size="sm" onClick={() => onEditNode(null)}>
                <Plus className="size-4" />
                新增节点
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onAddLink}
                disabled={nodes.length < 2}
                title={nodes.length < 2 ? '至少需要两个节点才能新增关系' : undefined}
              >
                <GitBranch className="size-4" />
                新增关系
              </Button>
            </>
          )}
          {onToggleExpand && (
            <div className="flex items-center gap-1.5">
              <Switch
                id="graph-expand-mode"
                checked={expandMode ?? false}
                onCheckedChange={onToggleExpand}
                aria-label="展开模式"
              />
              <label
                htmlFor="graph-expand-mode"
                className="text-xs text-muted-foreground"
                title="开启后点击节点即懒加载其 1 跳邻居并合入图谱"
              >
                展开模式
              </label>
            </div>
          )}
          <Select value={layoutKind} onValueChange={handleLayoutChange}>
            <SelectTrigger className="h-8 w-[132px] text-xs" aria-label="选择图谱布局">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LAYOUT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={handleRelayout}>
            <RotateCcw className="size-4" />
            重新布局
          </Button>
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className={`h-full w-full select-none ${interacting ? 'cursor-grabbing' : 'cursor-grab'}`}
        role="img"
        aria-label="知识图谱画布"
        onMouseDown={handleBackgroundMouseDown}
      >
        <defs>
          <marker
            id="graph-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
          </marker>
          <marker
            id="graph-arrow-selected"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#0f766e" />
          </marker>
          {/* 最短路径箭头：路径整体橙色加粗，箭头色必须跟随否则断色（spec §5.1） */}
          <marker
            id="graph-arrow-path"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
          </marker>
        </defs>

        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {visibleLinks.map((link) => {
            const source = positions.get(link.source);
            const target = positions.get(link.target);
            if (!source || !target) return null;
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const length = Math.hypot(dx, dy) || 1;
            const ux = dx / length;
            const uy = dy / length;
            const selected = link.id === selectedLinkId;
            // 路径边橙色优先于普通选中色：跑路径时选中态不足以盖过路径语义
            const inPath = pathIds?.has(link.id) ?? false;
            // 端点按节点实际半径回缩，半径随度数变化后连线不再插入圆内
            const sourceR = radiusById.get(link.source) ?? MIN_NODE_R;
            const targetR = radiusById.get(link.target) ?? MIN_NODE_R;
            const lineX1 = source.x + ux * (sourceR + 2);
            const lineY1 = source.y + uy * (sourceR + 2);
            const lineX2 = target.x - ux * (targetR + 2);
            const lineY2 = target.y - uy * (targetR + 2);
            const midX = (source.x + target.x) / 2;
            const midY = (source.y + target.y) / 2;
            const label = truncateRelation(link.relation);
            const labelWidth = label.length * 11 + 10;
            // 悬停时：与悬停节点相连的边加粗 1px 保持可见，无关边降透明度让聚焦边凸显
            const touchesHovered =
              hoveredId !== null && (link.source === hoveredId || link.target === hoveredId);
            const dimmed = neighborIds !== null && !touchesHovered;
            return (
              <g key={link.id} opacity={dimmed ? 0.12 : 1}>
                {/* 透明点击热区 */}
                <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke="transparent"
                  strokeWidth={10}
                  className="cursor-pointer"
                  onClick={(event) => handleLinkClick(event, link)}
                />
                <line
                  x1={lineX1}
                  y1={lineY1}
                  x2={lineX2}
                  y2={lineY2}
                  stroke={inPath ? '#f59e0b' : selected ? '#0f766e' : '#94a3b8'}
                  strokeWidth={selected ? 3.5 : inPath ? 3 : touchesHovered ? 2.5 : 1.5}
                  // 虚线关系用 stroke-dasharray 表达线型编码（linkLineStyle）
                  strokeDasharray={linkDashArray(link.relation)}
                  markerEnd={
                    inPath
                      ? 'url(#graph-arrow-path)'
                      : selected
                        ? 'url(#graph-arrow-selected)'
                        : 'url(#graph-arrow)'
                  }
                  opacity={selected || inPath ? 1 : 0.7}
                />
                <g className="pointer-events-none">
                  <rect
                    x={midX - labelWidth / 2}
                    y={midY - 9}
                    width={labelWidth}
                    height={18}
                    rx={4}
                    className="fill-background/90 stroke-border"
                    strokeWidth={1}
                  />
                  <text
                    x={midX}
                    y={midY + 4}
                    textAnchor="middle"
                    fontSize={11}
                    className={
                      selected
                        ? 'fill-[#0f766e]'
                        : inPath
                          ? 'fill-[#f59e0b]'
                          : 'fill-muted-foreground'
                    }
                  >
                    {label}
                  </text>
                </g>
              </g>
            );
          })}

          {visibleNodes.map((node) => {
            const position = positions.get(node.id);
            if (!position) return null;
            const manual = node.documentIds.length === 0;
            const hovered = hoveredId === node.id;
            const isSelected = selectedNodeId === node.id;
            const radius = radiusOf(node);
            // 悬停时只高亮邻居集合内的节点，其余降透明度，形成聚焦层次
            const dimmed = neighborIds !== null && !neighborIds.has(node.id);
            return (
              <g
                key={node.id}
                transform={`translate(${position.x} ${position.y})`}
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                aria-label={`查看节点 ${node.name}`}
                opacity={dimmed ? 0.12 : 1}
                onMouseDown={(event) => handleNodeMouseDown(event, node)}
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() => setHoveredId((current) => (current === node.id ? null : current))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    // 键盘路径与点击一致：走 activateNode 分流（展开/选中），避免误改
                    activateNode(node);
                  }
                }}
              >
                <title>{`${node.name}｜${node.category}`}</title>
                {/* 社区外圈：半径略大于主体，颜色按社区 id 稳定取色 */}
                {communityOf?.has(node.id) && (
                  <circle
                    r={radius + 3}
                    fill="none"
                    stroke={communityColor(communityOf.get(node.id) ?? node.id)}
                    strokeWidth={3}
                    opacity={0.9}
                  />
                )}
                <circle
                  r={hovered ? radius + 2 : radius}
                  fill={nodeColor(node.nodeType)}
                  stroke={
                    isSelected
                      ? '#f59e0b'
                      : manual
                        ? '#16a34a'
                        : 'rgba(255,255,255,0.45)'
                  }
                  strokeWidth={isSelected || manual ? 2.5 : 1}
                />
                <text
                  y={radius + 16}
                  textAnchor="middle"
                  fontSize={12}
                  className="fill-foreground"
                >
                  {truncateName(node.name)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {isEmpty && (
        <div className="absolute inset-0 grid place-items-center px-6 text-center">
          <p className="text-sm text-muted-foreground">暂无图谱，请先在文档页上传资料</p>
        </div>
      )}
    </div>
  );
}
