/**
 * AI 抽取管线：原始资料文本（md / txt / pdf 抽取文本）→ knowledge bundle。
 *
 * 分块 → LLM 严格 JSON 输出 → jsonrepair 兜底解析 → 跨块按 name 合并去重 →
 * schema 终验。产物固定 `reviewStatus: 'unreviewed'`：只有人工在维护页审核
 * 置为 reviewed 后才会进入课堂检索（getClassroomKnowledge 只认 reviewed）。
 */
import { jsonrepair } from 'jsonrepair';
import { callLLM } from '@/lib/ai/llm';
import type { ResolvedModel } from '@/lib/server/resolve-model';
import { knowledgeBundleSchema, type KnowledgeBundle, type KnowledgeBundleV2 } from './schema';
import { newDocumentId, newLinkId } from './library-store';

const CHUNK_SIZE = 3000;
const MAX_CHUNKS = 40;
const MAX_NODES = 2000;
const MAX_OUTPUT_TOKENS = 8000;

const SYSTEM_PROMPT = `你是知识工程助手。从用户提供的资料片段中抽取“知识点卡片”和“关系”，输出严格 JSON（不要 markdown 代码块、不要注释、不要解释），结构：
{"nodes":[{"name":"知识点名称","aliases":["别名"],"category":"分类","content":"150字以内的准确描述","type":"term 或 concept"}],"links":[{"source":"起点name","target":"终点name","relation":"关系名"}]}
要求：
- 每个 node 必须给 type：term=关键名词实体（专业术语、方法名、器件/设备名、物理量等名词短语）；concept=需要展开讲解的知识点
- term 要覆盖资料中的核心专业名词（每份资料 5~20 个核心术语），并尽量用 links 与相关 concept 连接（关系如 属于/用于/指示/衡量/驱动）
- content 忠于原文，不编造；原文未提及的内容不要抽取
- aliases 必须尽量给出该 node 的同义词、英文原名/缩写、俗称（如 "雅可比矩阵": ["Jacobian","Jacobian matrix"]），同一概念的不同叫法都要收录，便于检索命中；确无别名时给 []
- links 的 source/target 必须逐字等于本片段中某个 node 的 name
- name 使用规范术语（标准中文译名或英文原名），同一概念只保留一个 node
- category 用 2~6 个字的中文分类（如 概念、方法、器件、定理、系统）
- 资料中没有可用知识时返回 {"nodes":[],"links":[]}`;

/** 抽取管线的可预期失败（400 类：资料本身不含知识 / 结果不合法）。 */
export class KnowledgeExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeExtractError';
  }
}

interface RawNode {
  name: string;
  aliases: string[];
  category: string;
  content: string;
  nodeType: 'concept' | 'term';
  chunk: number;
}
interface RawLink {
  source: string;
  target: string;
  relation: string;
}

export interface ExtractKnowledgeOptions {
  text: string;
  /** 由路由生成（撞 id 策略在路由侧）。 */
  bundleId: string;
  title: string;
  ownerId: string;
  kind?: Extract<KnowledgeBundle['kind'], 'graph' | 'paper'>;
  /** 节点 source.title，默认取 title。 */
  sourceTitle?: string;
  model: ResolvedModel;
}

export interface ExtractKnowledgeResult {
  bundle: KnowledgeBundleV2;
  stats: { chunks: number; nodes: number; links: number; terms: number };
  warnings: string[];
}

function chunkText(text: string): { chunks: string[]; truncated: boolean } {
  const chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < MAX_CHUNKS; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }
  return { chunks, truncated: text.length > chunks.length * CHUNK_SIZE };
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'n'
  );
}

function asString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** 别名归一：去掉与 name 重复（忽略大小写）及彼此重复的条目，上限 30。 */
function normalizeAliases(name: string, aliases: string[]): string[] {
  const seen = new Set<string>([name.toLowerCase()]);
  const out: string[] = [];
  for (const alias of aliases) {
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
    if (out.length >= 30) break;
  }
  return out;
}

/** 严格 JSON 优先，失败则 jsonrepair 后再试；形状不对返回 null。 */
function parseExtraction(raw: string): { nodes: RawNode[]; links: RawLink[] } | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    try {
      data = JSON.parse(jsonrepair(cleaned));
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as { nodes?: unknown; links?: unknown };
  if (!Array.isArray(record.nodes)) return null;

  const nodes: RawNode[] = [];
  for (const entry of record.nodes) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const name = asString(item.name, 300);
    if (!name) continue;
    const rawAliases = Array.isArray(item.aliases)
      ? item.aliases.map((alias) => asString(alias, 200)).filter(Boolean)
      : [];
    nodes.push({
      name,
      aliases: normalizeAliases(name, rawAliases),
      category: asString(item.category, 100) || '知识点',
      content: asString(item.content, 16000),
      // 旧模型输出可能没有 type：一律按 concept 处理。
      nodeType: item.type === 'term' ? 'term' : 'concept',
      chunk: 0, // 由调用方回填
    });
  }
  const links: RawLink[] = [];
  if (Array.isArray(record.links)) {
    for (const entry of record.links) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      const source = asString(item.source, 300);
      const target = asString(item.target, 300);
      const relation = asString(item.relation, 200);
      if (source && target && relation) links.push({ source, target, relation });
    }
  }
  return { nodes, links };
}

export async function extractKnowledgeBundle(
  options: ExtractKnowledgeOptions,
): Promise<ExtractKnowledgeResult> {
  const text = options.text.trim();
  if (!text) throw new KnowledgeExtractError('资料内容为空，无法抽取知识。');

  const { chunks, truncated } = chunkText(text);
  const warnings: string[] = [];
  if (truncated) {
    warnings.push(`资料过长，仅抽取前 ${MAX_CHUNKS} 个片段（约 ${MAX_CHUNKS * CHUNK_SIZE} 字）。`);
  }

  const mergedNodes = new Map<string, RawNode>();
  const rawLinks: RawLink[] = [];
  let failedChunks = 0;

  for (let i = 0; i < chunks.length; i++) {
    const { text: extracted } = await callLLM(
      {
        model: options.model.model,
        system: SYSTEM_PROMPT,
        prompt: `以下是资料片段 ${i + 1}/${chunks.length}：\n\n${chunks[i]}`,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
      'knowledge-extract',
      { retries: 1, validate: (output) => parseExtraction(output) !== null },
    );
    const parsed = parseExtraction(extracted);
    if (!parsed) {
      failedChunks += 1;
      continue;
    }
    for (const node of parsed.nodes) {
      const existing = mergedNodes.get(node.name);
      if (!existing) {
        mergedNodes.set(node.name, { ...node, chunk: i });
        continue;
      }
      // 同名概念跨块合并：保留更完整的描述并集别名。
      if (node.content.length > existing.content.length) existing.content = node.content;
      if (node.category && existing.category === '知识点') existing.category = node.category;
      // 任一片段把该名词识别为 term，则整体按 term 处理。
      if (existing.nodeType === 'concept' && node.nodeType === 'term') existing.nodeType = 'term';
      // 跨片段并集别名（忽略大小写去重，避免 "Jacobian"/"jacobian" 重复）。
      const aliasKeys = new Set(existing.aliases.map((alias) => alias.toLowerCase()));
      for (const alias of node.aliases) {
        const key = alias.toLowerCase();
        if (!aliasKeys.has(key) && existing.aliases.length < 30) {
          existing.aliases.push(alias);
          aliasKeys.add(key);
        }
      }
    }
    rawLinks.push(...parsed.links);
  }
  if (failedChunks) warnings.push(`${failedChunks} 个片段解析失败，已跳过。`);

  if (mergedNodes.size === 0) {
    throw new KnowledgeExtractError('未能从资料中抽取知识卡，请确认资料包含可学习的专业内容。');
  }
  if (mergedNodes.size > MAX_NODES) {
    warnings.push(`节点数超过上限 ${MAX_NODES}，已截断。`);
  }

  const documentId = newDocumentId();
  const uploadedAt = new Date().toISOString();
  const nameToId = new Map<string, string>();
  const nodes = [...mergedNodes.values()].slice(0, MAX_NODES).map((node, index) => {
    const id = `k${index + 1}-${slugify(node.name)}`;
    nameToId.set(node.name, id);
    return {
      id,
      name: node.name,
      aliases: node.aliases,
      category: node.category,
      content: node.content,
      nodeType: node.nodeType,
      documentIds: [documentId],
      attributes: {},
      source: {
        title: options.sourceTitle || options.title,
        locator: `片段 ${node.chunk + 1}`,
      },
    };
  });

  const seenLinks = new Set<string>();
  const links: KnowledgeBundle['links'] = [];
  for (const link of rawLinks) {
    const source = nameToId.get(link.source);
    const target = nameToId.get(link.target);
    if (!source || !target || source === target) continue;
    const key = `${source}|${target}|${link.relation}`;
    if (seenLinks.has(key)) continue;
    seenLinks.add(key);
    links.push({ id: newLinkId(), source, target, relation: link.relation });
  }

  let bundle: KnowledgeBundleV2;
  try {
    bundle = knowledgeBundleSchema.parse({
      version: 2,
      id: options.bundleId,
      title: options.title,
      description: '',
      kind: options.kind ?? 'paper',
      reviewStatus: 'unreviewed',
      ownerId: options.ownerId,
      nodes,
      links,
      crossRefs: [],
      documents: [
        {
          id: documentId,
          title: options.title,
          filename: `${options.bundleId}.md`,
          uploadedAt,
          nodeCount: nodes.length,
          // 保留原文供文档页查看/编辑（与 schema 上限一致）。
          content: options.text.slice(0, 500_000),
        },
      ],
      createdAt: uploadedAt,
      updatedAt: uploadedAt,
    }) as KnowledgeBundleV2;
  } catch (error) {
    const issues = (error as { issues?: { message?: string }[] }).issues;
    throw new KnowledgeExtractError(
      `抽取结果未通过校验：${issues?.[0]?.message ?? '未知错误'}`,
    );
  }

  return {
    bundle,
    stats: {
      chunks: chunks.length,
      nodes: nodes.length,
      links: links.length,
      terms: nodes.filter((node) => node.nodeType === 'term').length,
    },
    warnings,
  };
}
