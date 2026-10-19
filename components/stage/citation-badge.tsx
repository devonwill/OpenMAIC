'use client';

import { useState } from 'react';
import { BookOpen, TriangleAlert, X } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';
import type { CitationAudit, CitationInvalidReason } from '@/lib/knowledge/citation';

const REASON_KEYS: Record<CitationInvalidReason, string> = {
  'not-found': 'generation.citationReasonNotFound',
  'not-reviewed': 'generation.citationReasonNotReviewed',
  'out-of-scope': 'generation.citationReasonOutOfScope',
};

/**
 * 课堂画布左下角的“本页引用”角标 + 引用清单面板。
 *
 * 数据来自生成时 scene-actions 路由写入的 scene.citationAudit：有效引用
 * 列出知识库/节点名，无效引用（编造/未审核/越界）整体标红并给出原因。
 * 无引用（total 0）时不渲染——没有引用不等于引用违规。
 */
export function CitationBadge({ audit }: { audit: CitationAudit }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  if (!audit || audit.total === 0) return null;
  const hasInvalid = audit.invalid.length > 0;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="absolute bottom-3 left-3 z-[106]" onClick={stop}>
      {open && (
        <div className="mb-2 w-72 max-h-64 overflow-y-auto rounded-lg border border-gray-200/80 dark:border-gray-700/80 bg-white/95 dark:bg-gray-900/95 backdrop-blur shadow-lg p-3 text-left">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
              {t('generation.citationsTitle')}
            </span>
            <button
              onClick={() => setOpen(false)}
              className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"
              aria-label="close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {audit.valid.length > 0 && (
            <div className="mb-2">
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mb-1">
                {t('generation.citationsValid').replace('{{count}}', String(audit.valid.length))}
              </div>
              <ul className="space-y-1">
                {audit.valid.map((ref) => (
                  <li key={ref.citation} className="text-[11px] leading-snug">
                    <span className="text-gray-700 dark:text-gray-200 font-medium">
                      {ref.nodeName}
                    </span>
                    <span className="text-gray-400 dark:text-gray-500"> · {ref.bundleTitle}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasInvalid && (
            <div>
              <div className="text-[11px] text-red-600 dark:text-red-400 mb-1 font-medium">
                {t('generation.citationsInvalid').replace(
                  '{{count}}',
                  String(audit.invalid.length),
                )}
              </div>
              <ul className="space-y-1">
                {audit.invalid.map((issue) => (
                  <li key={issue.citation} className="text-[11px] leading-snug text-red-500 dark:text-red-400">
                    <span className="font-mono break-all">{issue.citation}</span>
                    <span className="block text-red-400/80 dark:text-red-500/80">
                      {t(REASON_KEYS[issue.reason])}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium shadow-sm',
          'bg-white/90 dark:bg-gray-900/90 backdrop-blur border transition-colors',
          hasInvalid
            ? 'border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'
            : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800',
        )}
        aria-expanded={open}
      >
        {hasInvalid ? (
          <TriangleAlert className="w-3.5 h-3.5" />
        ) : (
          <BookOpen className="w-3.5 h-3.5" />
        )}
        {t('generation.citationsTitle')}
        <span className="tabular-nums">{audit.total}</span>
      </button>
    </div>
  );
}
