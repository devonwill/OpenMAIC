'use client';

import { CheckCircle2, Clock3, FileText, Loader2, RotateCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { UploadItemStatus } from '@/lib/hooks/use-knowledge';

export interface UploadQueueItem {
  file: File;
  status: UploadItemStatus;
  detail?: string;
}

interface UploadQueueProps {
  items: UploadQueueItem[];
  retryingIndex: number | null;
  onRetry: (index: number) => void;
}

const STATUS_TEXT: Record<UploadItemStatus, string> = {
  waiting: '等待中',
  extracting: '抽取中…',
  done: '完成',
  error: '失败',
};

function QueueProgress({ status }: { status: UploadItemStatus }) {
  if (status === 'done') return <Progress value={100} />;
  if (status === 'extracting') {
    return (
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/70" />
      </div>
    );
  }
  if (status === 'error') {
    return <div className="h-1.5 w-full rounded-full bg-destructive/30" />;
  }
  return <Progress value={0} className="opacity-60" />;
}

export function UploadQueue({ items, retryingIndex, onRetry }: UploadQueueProps) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-2 rounded-lg border border-border p-3">
      {items.map((item, index) => (
        <li key={`${item.file.name}-${index}`} className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate" title={item.file.name}>
              {item.file.name}
            </span>
            {item.status === 'waiting' && (
              <Clock3 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            {item.status === 'extracting' && (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
            )}
            {item.status === 'done' && (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            )}
            {item.status === 'error' && (
              <XCircle className="size-4 shrink-0 text-destructive" aria-hidden />
            )}
            <span
              className={`shrink-0 text-xs ${
                item.status === 'error'
                  ? 'text-destructive'
                  : item.status === 'done'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-muted-foreground'
              }`}
            >
              {STATUS_TEXT[item.status]}
            </span>
            {item.status === 'error' && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="shrink-0"
                disabled={retryingIndex !== null}
                onClick={() => onRetry(index)}
              >
                <RotateCw className="size-3" aria-hidden />
                {retryingIndex === index ? '重试中…' : '重试'}
              </Button>
            )}
          </div>
          <QueueProgress status={item.status} />
          {item.detail && (
            <p
              className={`pl-6 text-xs ${
                item.status === 'error' ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              {item.detail}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
