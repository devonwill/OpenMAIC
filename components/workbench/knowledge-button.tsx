'use client';

/**
 * 知识库选择按钮 —— 首页生成工具栏的知识库弹层，在专业模式 composer 的对应件。
 *
 * 为什么自己持状态而不是走 props：知识库勾选的权威存储是 localStorage 的
 * `knowledgeSelection`（lib/knowledge/selection.ts），首页写、聊天请求发出前读。
 * 这里读写同一个 key，两端即刻互通，不必给 WorkbenchChat 增加一条 prop 穿透链；
 * 勾选与配额在每次点击时已持久化，弹层没有「应用」按钮，关掉即生效。
 */
import { useCallback, useEffect, useState } from 'react';
import { Brain } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { KnowledgeQuota, KnowledgeSelection } from '@/lib/knowledge/quota';
import { readKnowledgeSelection, storeKnowledgeSelection } from '@/lib/knowledge/selection';

type KnowledgeBundle = { id: string; title: string; kind: string };

/** kind → 文案键；未知 kind 落到论文，与首页徽标同一兜底口径。 */
const KIND_LABEL_KEYS: Record<string, string> = {
  code: 'proMode.knowledgeKindCode',
  graph: 'proMode.knowledgeKindGraph',
  paper: 'proMode.knowledgeKindPaper',
};

function clampPart(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function KnowledgeButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<KnowledgeSelection>({ bundleIds: [] });
  const [bundles, setBundles] = useState<KnowledgeBundle[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const loadBundles = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const res = await fetch('/api/knowledge', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        catalog?: Array<{ id: string; title: string; kind: string; reviewStatus?: string }>;
      };
      // 只列已审核的库：未审核的即使勾选也不会被检索命中，展示出来是误导。
      const nextBundles = (data.catalog ?? [])
        .filter((item) => item.reviewStatus === 'reviewed')
        .map(({ id, title, kind }) => ({ id, title, kind }));
      setBundles(nextBundles);
      // 悬空勾选（库被删除、重新抽取后退回未审核、或重新导入换了 id）在列表里
      // 看不到对应勾选，却会让角标多计 1；服务端也会按「选定了不存在的库」过滤，
      // 导致本地证据直接落空。以目录为准就地清掉并写回，显示与检索恢复一致。
      const validIds = new Set(nextBundles.map((bundle) => bundle.id));
      const current = readKnowledgeSelection();
      const keptIds = current.bundleIds.filter((id) => validIds.has(id));
      if (keptIds.length !== current.bundleIds.length) {
        const next = { ...current, bundleIds: keptIds };
        storeKnowledgeSelection(next);
        setSelection(next);
      }
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // localStorage 只在客户端可读：挂载后再同步，SSR 首屏与客户端首屏一致。
  // 同时拉一次目录：不打开弹层也要让角标反映真实选中数（清掉悬空勾选）。
  useEffect(() => {
    setSelection(readKnowledgeSelection());
    void loadBundles();
  }, [loadBundles]);

  const commit = useCallback((next: KnowledgeSelection) => {
    setSelection(next);
    storeKnowledgeSelection(next);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        // 每次打开都重读：首页可能刚改过勾选，弹层不能拿着旧快照覆盖它。
        setSelection(readKnowledgeSelection());
        void loadBundles();
      }
    },
    [loadBundles],
  );

  const toggleBundle = useCallback(
    (id: string) => {
      const next = new Set(selection.bundleIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      commit({ ...selection, bundleIds: [...next] });
    },
    [commit, selection],
  );

  const quotaLocal = clampPart(selection.quota?.local ?? 70);
  const quotaWeb = clampPart(selection.quota?.web ?? 20);
  // 模型占比是残差：三条证据路径合计恒为 100，本地/联网上调多少就从模型扣回多少。
  const quotaModel = Math.max(0, 100 - quotaLocal - quotaWeb);

  const setQuotaPart = useCallback(
    (patch: Partial<KnowledgeQuota>) => {
      const local = clampPart(patch.local ?? quotaLocal);
      const web = clampPart(patch.web ?? quotaWeb);
      // local + web 永不超过 100 —— 被拖动的那一条吃下限制，另一条保持不动。
      const localFinal = patch.local !== undefined ? Math.min(local, 100 - web) : local;
      const webFinal = patch.web !== undefined ? Math.min(web, 100 - localFinal) : web;
      commit({
        ...selection,
        quota: {
          local: localFinal,
          web: webFinal,
          model: Math.max(0, 100 - localFinal - webFinal),
        },
      });
    },
    [commit, quotaLocal, quotaWeb, selection],
  );

  const active = selection.bundleIds.length > 0 || selection.quota !== undefined;

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="workbench-knowledge-button"
              // 与发送键同规则：pointerdown 不能被 slash/@ 菜单的外部关闭吃掉。
              data-mention-keep-open=""
              aria-label={t('proMode.knowledge')}
              aria-pressed={active}
              className={cn(
                'relative inline-flex size-8 items-center justify-center rounded-lg transition-colors',
                active
                  ? 'text-blue-600 hover:bg-muted dark:text-blue-400'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Brain className="size-4" />
              {selection.bundleIds.length > 0 && (
                <span className="absolute right-0.5 top-0.5 flex min-w-3 items-center justify-center rounded-full bg-blue-600 px-0.5 text-[9px] font-medium leading-3 text-white">
                  {selection.bundleIds.length}
                </span>
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {t('proMode.knowledge')}
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        collisionPadding={12}
        className="w-72 space-y-3 p-3"
      >
        <div className="text-xs font-medium">{t('proMode.knowledge')}</div>

        {/* Bundle multi-select */}
        <div className="-mx-1 max-h-40 space-y-1 overflow-y-auto px-1">
          {loading ? (
            <p className="py-2 text-xs text-muted-foreground">{t('proMode.knowledgeLoading')}</p>
          ) : loadFailed ? (
            <p className="py-2 text-xs text-destructive">{t('proMode.knowledgeLoadFailed')}</p>
          ) : bundles.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">{t('proMode.knowledgeEmpty')}</p>
          ) : (
            bundles.map((bundle) => {
              const checked = selection.bundleIds.includes(bundle.id);
              return (
                <label
                  key={bundle.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors',
                    checked
                      ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/20'
                      : 'border-border hover:bg-muted/60',
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-3.5 shrink-0 accent-blue-600"
                    checked={checked}
                    onChange={() => toggleBundle(bundle.id)}
                  />
                  <span className="min-w-0 flex-1 truncate" title={bundle.title}>
                    {bundle.title}
                  </span>
                  <span className="shrink-0 rounded border px-1 py-0.5 text-[9px] text-muted-foreground">
                    {t(KIND_LABEL_KEYS[bundle.kind] ?? KIND_LABEL_KEYS.paper)}
                  </span>
                </label>
              );
            })
          )}
        </div>

        {/* Three-route citation quota: evidence shares, not content ratios. */}
        <div className="space-y-2 border-t pt-2">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{t('proMode.knowledgeQuota')}</span>
            <span>
              {t('proMode.knowledgeQuotaSummary', {
                local: quotaLocal,
                web: quotaWeb,
                model: quotaModel,
              })}
            </span>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <span className="w-8 shrink-0 text-muted-foreground">
              {t('proMode.knowledgeQuotaLocal')}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={quotaLocal}
              onChange={(event) => setQuotaPart({ local: Number(event.target.value) })}
              className="flex-1 accent-blue-600"
            />
            <span className="w-8 text-right tabular-nums">{quotaLocal}%</span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="w-8 shrink-0 text-muted-foreground">
              {t('proMode.knowledgeQuotaWeb')}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={quotaWeb}
              onChange={(event) => setQuotaPart({ web: Number(event.target.value) })}
              className="flex-1 accent-blue-600"
            />
            <span className="w-8 text-right tabular-nums">{quotaWeb}%</span>
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}
