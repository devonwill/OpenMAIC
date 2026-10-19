'use client';

import { Box, Cloud, Database, FileJson, FolderOpen, HardDrive, ShieldCheck, Tags, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { CatalogItem, GraphBackendStatus } from '@/lib/hooks/use-knowledge';

interface StatBarProps {
  catalog: CatalogItem[];
  backend: GraphBackendStatus;
  integrityCount: number;
}

interface StatConfig {
  label: string;
  value: number;
  icon: typeof Database;
}

export function StatBar({ catalog, backend, integrityCount }: StatBarProps) {
  const libraryCount = catalog.length;
  const documentCount = catalog.reduce((sum, item) => sum + item.documentCount, 0);
  const conceptCount = catalog.reduce(
    (sum, item) => sum + Math.max(0, item.nodeCount - item.termCount),
    0,
  );
  const termCount = catalog.reduce((sum, item) => sum + item.termCount, 0);

  const stats: StatConfig[] = [
    { label: '资料库', value: libraryCount, icon: Database },
    { label: '文档', value: documentCount, icon: FolderOpen },
    { label: '知识点', value: conceptCount, icon: Box },
    { label: '术语', value: termCount, icon: Tags },
  ];

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
        <ul className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {stats.map(({ label, value, icon: Icon }) => (
            <li key={label} className="flex items-center gap-2">
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              <span className="text-sm">
                <span className="font-medium">{value}</span>
                <span className="ml-1 text-muted-foreground">{label}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            {backend.backend === 'neo4j' && backend.deployment === 'cloud' && (
              <>
                <Cloud className="size-3" aria-hidden />
                Aura 云端
              </>
            )}
            {backend.backend === 'neo4j' && backend.deployment !== 'cloud' && (
              <>
                <HardDrive className="size-3" aria-hidden />
                本地 Neo4j
              </>
            )}
            {backend.backend === 'json' && (
              <>
                <FileJson className="size-3" aria-hidden />
                JSON 降级
              </>
            )}
          </Badge>
          {integrityCount === 0 ? (
            <Badge className="gap-1 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400">
              <ShieldCheck className="size-3" aria-hidden />
              引用完整
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400"
            >
              <TriangleAlert className="size-3" aria-hidden />
              {integrityCount} 处问题
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
