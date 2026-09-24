'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { KnowledgeHit, KnowledgeNode } from '@/lib/knowledge/schema';

type Catalog = {
  id: string;
  title: string;
  kind: string;
  reviewStatus: string;
  nodeCount: number;
  linkCount: number;
};
type Graph = {
  nodes: Pick<KnowledgeNode, 'id' | 'name' | 'category'>[];
  links: { source: string; target: string; relation: string }[];
};
type ResponseData = {
  catalog: Catalog[];
  hits: KnowledgeHit[];
  detail: KnowledgeNode | null;
  graph: Graph;
  warnings: string[];
  classroomEnabled: boolean;
};
const labels: Record<string, string> = {
  demo: '演示数据 · 不用于课堂依据',
  unreviewed: '待教师审核 · 不用于课堂依据',
  reviewed: '已审核',
};

export default function KnowledgePage() {
  const [bundle, setBundle] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [node, setNode] = useState('');
  const [responseData, setData] = useState<ResponseData | null>(null);
  const [error, setError] = useState('');
  const [loadedKey, setLoadedKey] = useState('');
  const requestKey = new URLSearchParams({ bundle, q: search, node }).toString();
  const loading = loadedKey !== requestKey;
  const data =
    loading && responseData
      ? { ...responseData, detail: null, hits: [], graph: { nodes: [], links: [] } }
      : responseData;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/knowledge?${requestKey}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 401 ? '请返回首页输入站点访问码，再打开知识库。' : '知识库加载失败',
          );
        return response.json() as Promise<ResponseData>;
      })
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value);
          setError('');
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setData((previous) =>
            previous
              ? { ...previous, detail: null, hits: [], graph: { nodes: [], links: [] } }
              : null,
          );
          setError(reason.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadedKey(requestKey);
      });
    return () => controller.abort();
  }, [requestKey]);
  const selected = data?.catalog.find((item) => item.id === bundle);
  const positions = new Map(
    data?.graph.nodes.map((item, i, all) => [
      item.id,
      {
        x: 340 + 240 * Math.cos((i * 2 * Math.PI) / all.length),
        y: 230 + 165 * Math.sin((i * 2 * Math.PI) / all.length),
      },
    ]) ?? [],
  );
  function downloadMaterial() {
    if (!data?.detail || !selected) return;
    const item = data.detail;
    const text = `# ${item.name}\n\n状态：${labels[selected.reviewStatus]}\n\n${item.content}\n\n来源：${item.source.title} / ${item.source.locator}\n引用：[知识来源:${selected.id}/${item.id}]\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${selected.id}-${item.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <main className="mx-auto max-w-7xl p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">知识与论文资源</h1>
          <p className="text-sm text-muted-foreground mt-2">
            浏览知识关系、检索论文片段，为课堂准备可追溯的学习材料。
          </p>
        </div>
        <Link className="underline" href="/">
          返回课堂首页
        </Link>
      </header>
      <p className="rounded-lg border p-3 text-sm">
        机器人学图谱当前提供演示数据。Paper2Agent
        阅读包已导入文本，图表仍需结合原材料核对。课堂自动引用
        {data?.classroomEnabled ? '已开启，仅使用已审核知识包' : '未开启'}。
      </p>
      <form
        className="flex flex-wrap gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(query);
          setNode('');
        }}
      >
        <label className="sr-only" htmlFor="knowledge-query">
          搜索知识或论文
        </label>
        <input
          id="knowledge-query"
          className="min-w-48 flex-1 rounded border bg-background p-2"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索：正运动学、Paper2Agent、MCP…"
          maxLength={500}
        />
        <button className="rounded bg-primary px-5 py-2 text-primary-foreground" type="submit">
          搜索
        </button>
      </form>
      {error && !loading && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {data?.warnings.map((warning) => (
        <p key={warning} role="status">
          {warning}
        </p>
      ))}
      {loading && <p role="status">正在加载…</p>}
      <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-3">
          <button
            className="underline"
            onClick={() => {
              setBundle('');
              setNode('');
            }}
          >
            搜索全部资料
          </button>
          {data?.catalog.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setBundle(item.id);
                setNode('');
              }}
              className={`block w-full rounded-lg border p-3 text-left ${bundle === item.id ? 'border-primary bg-muted' : ''}`}
            >
              <strong className="block">{item.title}</strong>
              <span className="block text-xs mt-2">{labels[item.reviewStatus]}</span>
              <span className="text-xs text-muted-foreground">
                {item.nodeCount} 个条目 · {item.linkCount} 条关系
              </span>
            </button>
          ))}
        </aside>
        <section className="space-y-4 min-w-0" aria-busy={loading}>
          {!bundle && !search && <p>选择左侧知识包，或搜索全部资料。</p>}
          {selected?.kind === 'graph' && (
            <div className="rounded-lg border p-3">
              <p className="text-sm">点击节点查看内容；最多显示 60 个节点、120 条关系。</p>
              <svg viewBox="0 0 680 460" className="w-full" role="img" aria-label="知识关系图">
                <defs>
                  <marker
                    id="knowledge-arrow"
                    viewBox="0 0 10 10"
                    refX="18"
                    refY="5"
                    markerWidth="8"
                    markerHeight="8"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                  </marker>
                </defs>
                {data?.graph.links.map((link, i) => {
                  const a = positions.get(link.source);
                  const b = positions.get(link.target);
                  return a && b ? (
                    <g key={i}>
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke="currentColor"
                        markerEnd="url(#knowledge-arrow)"
                        opacity="0.25"
                      />
                      <text
                        x={(a.x + b.x) / 2}
                        y={(a.y + b.y) / 2}
                        textAnchor="middle"
                        fontSize="10"
                        fill="currentColor"
                      >
                        {link.relation}
                      </text>
                    </g>
                  ) : null;
                })}
                {data?.graph.nodes.map((item) => {
                  const p = positions.get(item.id)!;
                  return (
                    <g
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`查看 ${item.name}`}
                      onClick={() => setNode(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setNode(item.id);
                        }
                      }}
                      className="cursor-pointer"
                    >
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r="21"
                        fill={node === item.id ? '#0f766e' : '#2563eb'}
                      />
                      <text
                        x={p.x}
                        y={p.y + 38}
                        textAnchor="middle"
                        fontSize="12"
                        fill="currentColor"
                      >
                        {item.name.slice(0, 20)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
          {search && !loading && !data?.hits.length && (
            <p>没有匹配结果；请尝试概念名或英文关键词。</p>
          )}
          {(search
            ? data?.hits.map((hit) => ({
                id: hit.node.id,
                name: hit.node.name,
                bundleId: hit.bundleId,
              }))
            : data?.graph.nodes.map((item) => ({ ...item, bundleId: bundle }))
          )?.map((item) => (
            <button
              key={`${item.bundleId}/${item.id}`}
              className="block text-left underline underline-offset-4"
              onClick={() => {
                setBundle(item.bundleId);
                setNode(item.id);
              }}
            >
              {item.name}
            </button>
          ))}
          {data?.detail && (
            <article className="rounded-lg border p-5 space-y-3">
              <h2 className="text-xl font-semibold">{data.detail.name}</h2>
              <p className="text-sm">{selected && labels[selected.reviewStatus]}</p>
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7">
                {data.detail.content}
              </pre>
              <p className="text-sm text-muted-foreground">
                来源：{data.detail.source.title} / {data.detail.source.locator}
              </p>
              <code className="block break-all text-xs">
                [知识来源:{bundle}/{data.detail.id}]
              </code>
              <button className="rounded border px-3 py-2" onClick={downloadMaterial}>
                下载本段学习材料
              </button>
              <p className="text-xs text-muted-foreground">
                可在首页作为课程材料上传；待审核和演示内容需先由教师核对。
              </p>
            </article>
          )}
        </section>
      </div>
    </main>
  );
}
