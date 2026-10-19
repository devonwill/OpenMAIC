/**
 * 看（知识图谱）层：图谱是索引/视图，不是独立存储。
 *
 * - 默认后端：把所有 bundle（知识 + 代码）合并成一张 JSON 图，
 *   节点用复合 id `${bundleId}::${nodeId}`，crossRefs 渲染成跨包边。
 * - 可选后端：NEO4J_URI 配置门禁 → 动态 import neo4j-driver →
 *   把 bundle 同步进本地 Neo4j（节点属性带 ownerId / kb_refs / code_refs）。
 *   未配置或出错一律降级 JSON，绝不阻断课堂链路。
 */
import type { KnowledgeBundle, KnowledgeNode } from './schema';
import { loadKnowledge } from './server';
import { createLogger } from '@/lib/logger';
const log = createLogger('KnowledgeGraph');

export interface MergedGraphNode {
  /** Composite id: `${bundleId}::${nodeId}`. */
  id: string;
  bundleId: string;
  nodeId: string;
  name: string;
  category: string;
  kind: KnowledgeBundle['kind'];
  reviewStatus: KnowledgeBundle['reviewStatus'];
  ownerId?: string;
  /** 知识库引用（节点自身的来源定位）。 */
  kbRefs: { title: string; locator: string };
}

export interface MergedGraphLink {
  source: string;
  target: string;
  relation: string;
  bundleId: string;
  /** true = 跨包边（如 代码 → 知识）。 */
  cross: boolean;
}

export interface MergedGraph {
  nodes: MergedGraphNode[];
  links: MergedGraphLink[];
  truncated: boolean;
}

const MAX_MERGED_NODES = 400;
const MAX_MERGED_LINKS = 800;

export function compositeNodeId(bundleId: string, nodeId: string): string {
  return `${bundleId}::${nodeId}`;
}

export function buildMergedGraph(
  bundles: KnowledgeBundle[],
  options: { bundleIds?: string[] } = {},
): MergedGraph {
  const scoped = options.bundleIds?.length
    ? bundles.filter((bundle) => options.bundleIds!.includes(bundle.id))
    : bundles;
  const nodes: MergedGraphNode[] = [];
  const links: MergedGraphLink[] = [];
  const nodeIndex = new Map<string, MergedGraphNode>();
  let truncated = false;

  for (const bundle of scoped) {
    for (const node of bundle.nodes) {
      if (nodes.length >= MAX_MERGED_NODES) {
        truncated = true;
        break;
      }
      const view: MergedGraphNode = {
        id: compositeNodeId(bundle.id, node.id),
        bundleId: bundle.id,
        nodeId: node.id,
        name: node.name,
        category: node.category,
        kind: bundle.kind,
        reviewStatus: bundle.reviewStatus,
        ownerId: bundle.ownerId,
        kbRefs: { title: node.source.title, locator: node.source.locator },
      };
      nodeIndex.set(view.id, view);
      nodes.push(view);
    }
  }

  const visible = (bundleId: string, nodeId: string) =>
    nodeIndex.has(compositeNodeId(bundleId, nodeId));

  for (const bundle of scoped) {
    for (const link of bundle.links) {
      if (links.length >= MAX_MERGED_LINKS) {
        truncated = true;
        break;
      }
      if (!visible(bundle.id, link.source) || !visible(bundle.id, link.target)) continue;
      links.push({
        source: compositeNodeId(bundle.id, link.source),
        target: compositeNodeId(bundle.id, link.target),
        relation: link.relation,
        bundleId: bundle.id,
        cross: false,
      });
    }
    for (const ref of bundle.crossRefs) {
      if (links.length >= MAX_MERGED_LINKS) {
        truncated = true;
        break;
      }
      if (!visible(bundle.id, ref.node)) continue;
      links.push({
        source: compositeNodeId(bundle.id, ref.node),
        target: compositeNodeId(ref.targetBundleId, ref.targetNodeId),
        relation: ref.relation,
        bundleId: bundle.id,
        cross: true,
      });
    }
  }

  return { nodes, links, truncated };
}

export interface GraphIntegrityReport {
  checked: number;
  issues: string[];
}

/**
 * 跨存储引用完整性：crossRefs 指向的包/节点必须真实存在。
 * JSON 与 Neo4j 共用同一份 bundle 事实，这里做一次全量核对。
 */
export function checkGraphIntegrity(bundles: KnowledgeBundle[]): GraphIntegrityReport {
  const bundleById = new Map(bundles.map((bundle) => [bundle.id, bundle]));
  const issues: string[] = [];
  let checked = 0;
  for (const bundle of bundles) {
    for (const ref of bundle.crossRefs) {
      checked += 1;
      const target = bundleById.get(ref.targetBundleId);
      if (!target) {
        issues.push(
          `${bundle.id}: 目标包 ${ref.targetBundleId} 不存在（${ref.node} → ${ref.targetNodeId}）`,
        );
        continue;
      }
      if (!target.nodes.some((node) => node.id === ref.targetNodeId)) {
        issues.push(
          `${bundle.id}: 目标节点 ${ref.targetBundleId}::${ref.targetNodeId} 不存在（起点 ${ref.node}）`,
        );
      }
    }
  }
  return { checked, issues };
}

// ---------------------------------------------------------------------------
// Neo4j 可选后端（配置门禁 + 动态加载 + 降级）
// ---------------------------------------------------------------------------

export interface GraphBackendStatus {
  backend: 'neo4j' | 'json';
  configured: boolean;
  /** 部署位置：cloud=Aura/Neo4j Cloud 等托管；local=本地自建；unknown 表示未配置。 */
  deployment: 'cloud' | 'local' | 'unknown';
  warning?: string;
}

function neo4jConfig(): { uri: string; user: string; password: string; database?: string } | null {
  const uri = process.env.NEO4J_URI;
  if (!uri) return null;
  return {
    uri,
    user: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || '',
    // Aura 托管实例的数据库名常被改成自定义名（如 Robotics），不显式指定时
    // driver 会连默认库 neo4j 并报 "database does not exist"。
    database: process.env.NEO4J_DATABASE || undefined,
  };
}

interface Neo4jRecord {
  get(key: string): unknown;
}
export interface GraphTransaction {
  run(query: string, params?: Record<string, unknown>): Promise<{ records: Neo4jRecord[] }>;
}
interface Neo4jSession extends GraphTransaction {
  executeWrite<T>(body: (tx: GraphTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
interface Neo4jDriver {
  verifyConnectivity(): Promise<unknown>;
  session(options?: unknown): Neo4jSession;
  close(): Promise<void>;
}
interface Neo4jModule {
  driver(uri: string, auth: unknown): Neo4jDriver;
  auth: { basic(user: string, password: string): unknown };
}

let neo4jModule: Promise<Neo4jModule | null> | null = null;
let cachedDriver: Neo4jDriver | null = null;

/**
 * 动态 import neo4j-driver：包未安装 / 未配置 / 加载失败都返回 null，
 * 调用方降级 JSON。用 Function 构造器规避打包器静态分析。
 */
async function loadNeo4jModule(): Promise<Neo4jModule | null> {
  if (!neo4jModule) {
    neo4jModule = (async () => {
      const specifier = 'neo4j-driver';
      try {
        const dynamicImport = new Function('s', 'return import(s)') as (
          s: string,
        ) => Promise<unknown>;
        const mod = (await dynamicImport(specifier)) as Partial<Neo4jModule> & {
          default?: Partial<Neo4jModule>;
        };
        const candidate = (mod.driver ? mod : mod.default) as Partial<Neo4jModule> | undefined;
        if (!candidate || typeof candidate.driver !== 'function' || !candidate.auth) {
          return null;
        }
        return candidate as Neo4jModule;
      } catch {
        return null;
      }
    })();
  }
  return neo4jModule;
}

async function getNeo4jDriver(): Promise<Neo4jDriver | null> {
  const config = neo4jConfig();
  if (!config) return null;
  if (cachedDriver) return cachedDriver;
  const mod = await loadNeo4jModule();
  if (!mod) return null;
  const driver = mod.driver(config.uri, mod.auth.basic(config.user, config.password));
  try {
    await driver.verifyConnectivity();
    cachedDriver = driver;
    return driver;
  } catch {
    await driver.close().catch(() => undefined);
    return null;
  }
}

/**
 * Aura / Neo4j Cloud URI 形如 `neo4j+s://xxx.databases.neo4j.io:7687`，
 * `neo4j+ssc://...` 也属于托管端（TLS 自签证书）。
 * 其它方案（neo4j://, bolt://, bolt+s://）默认视为本地或自建。
 */
function classifyDeployment(uri: string): 'cloud' | 'local' | 'unknown' {
  const lower = uri.toLowerCase();
  if (lower.includes('databases.neo4j.io')) return 'cloud';
  if (lower.includes('+s://') || lower.includes('+ssc://')) return 'cloud';
  return 'local';
}

/**
 * 打开一个 session。Aura 实例可能不是默认库，需要带上 NEO4J_DATABASE。
 */
function openSession(driver: Neo4jDriver): Neo4jSession {
  const { database } = neo4jConfig() ?? {};
  return database ? driver.session({ database }) : driver.session();
}

export async function getGraphBackendStatus(): Promise<GraphBackendStatus> {
  const config = neo4jConfig();
  if (!config) return { backend: 'json', configured: false, deployment: 'unknown' };
  const driver = await getNeo4jDriver();
  if (!driver) {
    return {
      backend: 'json',
      configured: true,
      deployment: classifyDeployment(config.uri),
      warning: 'NEO4J_URI 已配置但连接/驱动不可用，图谱已降级为 JSON。',
    };
  }
  return { backend: 'neo4j', configured: true, deployment: classifyDeployment(config.uri) };
}

/**
 * Neo4j Ego 查询：返回 depth 跳内邻居的**库内 id**（剥离 `${bundleId}::` 前缀）。
 * driver 未配置返回 null（调用方走 JSON 兜底）；depth 白名单防注入。
 */
export async function queryNeo4jNeighbors(
  bundleId: string,
  nodeId: string,
  depth: 1 | 2,
): Promise<string[] | null> {
  const driver = await getNeo4jDriver();
  if (!driver) return null;
  // hops 只允许 1/2：用白名单三元展开而非字符串拼接，杜绝 Cypher 注入。
  const hops = depth === 2 ? 2 : 1;
  const session = openSession(driver);
  try {
    const result = await session.run(
      `MATCH (c:KnowledgeNode {compositeId: $center, bundleId: $bundleId})
       MATCH (c)-[:KNOWS*1..${hops}]-(n:KnowledgeNode {bundleId: $bundleId})
       RETURN collect(DISTINCT n.compositeId) AS ids`,
      { center: compositeNodeId(bundleId, nodeId), bundleId },
    );
    const ids = result.records[0]?.get('ids') as string[] | undefined;
    return (ids ?? []).map((id) =>
      id.startsWith(`${bundleId}::`) ? id.slice(bundleId.length + 2) : id,
    );
  } finally {
    await session.close();
  }
}

export interface GraphSyncResult {
  synced: boolean;
  backend: 'neo4j' | 'json';
  nodes: number;
  relationships: number;
  skippedCrossRefs: number;
  warning?: string;
}

function toSyncRows(bundle: KnowledgeBundle) {
  const crossByNode = new Map<
    string,
    { targetBundleId: string; targetNodeId: string; relation: string }[]
  >();
  for (const ref of bundle.crossRefs) {
    const list = crossByNode.get(ref.node) ?? [];
    list.push({
      targetBundleId: ref.targetBundleId,
      targetNodeId: ref.targetNodeId,
      relation: ref.relation,
    });
    crossByNode.set(ref.node, list);
  }
  const nodes = bundle.nodes.map((node: KnowledgeNode) => ({
    compositeId: compositeNodeId(bundle.id, node.id),
    bundleId: bundle.id,
    nodeId: node.id,
    name: node.name,
    category: node.category,
    content: node.content.slice(0, 4000),
    sourceTitle: node.source.title,
    sourceLocator: node.source.locator,
    kind: bundle.kind,
    reviewStatus: bundle.reviewStatus,
    ownerId: bundle.ownerId ?? '',
    // 图谱节点属性回链“读/用”两库：知识来源 + （代码包的）实现引用。
    kbRefs: `${node.source.title}｜${node.source.locator}`,
    codeRefs: JSON.stringify(crossByNode.get(node.id) ?? []),
  }));
  const relationships = [
    ...bundle.links.map((link) => ({
      source: compositeNodeId(bundle.id, link.source),
      target: compositeNodeId(bundle.id, link.target),
      relation: link.relation,
      bundleId: bundle.id,
      cross: false,
    })),
    ...bundle.crossRefs.map((ref) => ({
      source: compositeNodeId(bundle.id, ref.node),
      target: compositeNodeId(ref.targetBundleId, ref.targetNodeId),
      relation: ref.relation,
      bundleId: bundle.id,
      cross: true,
    })),
  ];
  return { nodes, relationships };
}

/** All nodes precede all edges, so forward and cyclic cross-bundle refs work. */
export async function writeGraphSnapshot(tx: GraphTransaction, bundles: KnowledgeBundle[]) {
  const rows = bundles.map(toSyncRows);
  const ids = rows.flatMap((row) => row.nodes.map((node) => node.compositeId));
  await tx.run('MATCH (n:KnowledgeNode) WHERE NOT n.compositeId IN $ids DETACH DELETE n', { ids });
  // Keep node identities and replace properties, including removed optional fields.
  for (const { nodes } of rows) {
    for (let i = 0; i < nodes.length; i += 200) {
      await tx.run(
        'UNWIND $rows AS row MERGE (n:KnowledgeNode {compositeId: row.compositeId}) SET n = row',
        { rows: nodes.slice(i, i + 200) },
      );
    }
  }
  await tx.run('MATCH (:KnowledgeNode)-[r:KNOWS]->(:KnowledgeNode) DELETE r');
  let relationships = 0;
  let skippedCrossRefs = 0;
  for (const row of rows) {
    for (let i = 0; i < row.relationships.length; i += 300) {
      const batch = row.relationships.slice(i, i + 300);
      const result = await tx.run(
        `UNWIND $rows AS row
         MATCH (a:KnowledgeNode {compositeId: row.source})
         MATCH (b:KnowledgeNode {compositeId: row.target})
         CREATE (a)-[r:KNOWS {relation: row.relation, bundleId: row.bundleId, cross: row.cross}]->(b)
         RETURN count(r) AS created`,
        { rows: batch },
      );
      const created = Number(result.records[0]?.get('created') ?? 0);
      relationships += created;
      skippedCrossRefs += batch.length - created;
    }
  }
  return { nodes: ids.length, relationships, skippedCrossRefs };
}

/** JSON is authoritative: reload after taking the graph lock, never apply an old request snapshot. */
export async function syncBundleToGraph(bundle: KnowledgeBundle): Promise<GraphSyncResult> {
  log.debug('Synchronizing saved knowledge bundle:', bundle.id);
  return syncKnowledgeToGraph();
}

export async function syncKnowledgeToGraph(): Promise<
  GraphSyncResult & { integrity: GraphIntegrityReport }
> {
  const empty = {
    nodes: 0,
    relationships: 0,
    skippedCrossRefs: 0,
    integrity: { checked: 0, issues: [] as string[] },
  };
  if (!neo4jConfig()) return { synced: false, backend: 'json', ...empty };
  let session: Neo4jSession | undefined;
  try {
    const driver = await getNeo4jDriver();
    if (!driver) throw new Error('Neo4j 驱动或连接不可用');
    session = openSession(driver);
    await session.run(
      'CREATE CONSTRAINT openmaic_knowledge_node IF NOT EXISTS FOR (n:KnowledgeNode) REQUIRE n.compositeId IS UNIQUE',
    );
    // Constraint makes the lock node unique even on a concurrent cold start.
    await session.run(
      'CREATE CONSTRAINT openmaic_knowledge_sync IF NOT EXISTS FOR (n:KnowledgeSyncLock) REQUIRE n.id IS UNIQUE',
    );
    const result = await session.executeWrite(async (tx) => {
      await tx.run(
        "MERGE (lock:KnowledgeSyncLock {id: 'snapshot'}) SET lock.revision = coalesce(lock.revision, 0) + 1",
      );
      const { bundles, warnings } = await loadKnowledge();
      // Do not delete graph data merely because a source file could not be read.
      if (warnings.length) throw new Error(warnings.join('; '));
      const counts = await writeGraphSnapshot(tx, bundles);
      return { ...counts, integrity: checkGraphIntegrity(bundles) };
    });
    return {
      synced: true,
      backend: 'neo4j',
      ...result,
      ...(result.skippedCrossRefs
        ? { warning: `${result.skippedCrossRefs} 条跨包引用目标缺失，已跳过。` }
        : {}),
    };
  } catch (error) {
    log.warn('Graph synchronization failed; JSON remains authoritative:', error);
    return {
      synced: false,
      backend: 'json',
      ...empty,
      warning: '图谱同步失败，资料已保存在 JSON 中，请稍后重新同步。',
    };
  } finally {
    await session?.close().catch(() => undefined);
  }
}
