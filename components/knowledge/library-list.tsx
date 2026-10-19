'use client';

import { useAuth } from '@/lib/hooks/use-auth';
import { ResourceSharingDialog } from '@/components/sharing/resource-sharing-dialog';
import { useState } from 'react';
import { toast } from 'sonner';
import { Code2, FileText, FolderPlus, Loader2, Network, Plus, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { knowledgeApi, type CatalogItem } from '@/lib/hooks/use-knowledge';

interface LibraryListProps {
  catalog: CatalogItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  onChanged: () => void;
  /** 页面级操作进行中时禁用卡片选择、审核选择器与删除入口。 */
  busy?: boolean;
  /** 审核状态变更；失败时 reject（页面负责 toast），选择器保持原值。共享包（无 ownerId）同样可用。 */
  onReview?: (id: string, reviewStatus: string) => Promise<void>;
  /** 删除整库；仅 ownerId 存在的卡片会显示入口。失败时 reject，确认框保持打开。 */
  onDeleteLibrary?: (item: CatalogItem) => Promise<void>;
}

const REVIEW_OPTIONS = [
  { value: 'unreviewed', label: '待审核' },
  { value: 'reviewed', label: '已审核' },
  { value: 'demo', label: '演示数据' },
] as const;

const KIND_META: Record<string, { label: string; icon: typeof FileText }> = {
  paper: { label: '资料', icon: FileText },
  code: { label: '代码', icon: Code2 },
  graph: { label: '图谱', icon: Network },
};

function kindMeta(kind: string): { label: string; icon: typeof FileText } {
  return KIND_META[kind] ?? { label: kind, icon: FileText };
}

function ReviewBadge({ reviewStatus }: { reviewStatus: string }) {
  if (reviewStatus === 'reviewed') {
    return (
      <Badge className="bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400">
        已审核
      </Badge>
    );
  }
  if (reviewStatus === 'demo') {
    return <Badge variant="secondary">演示数据</Badge>;
  }
  return (
    <Badge
      variant="outline"
      className="border-amber-500/40 text-amber-700 dark:text-amber-400"
    >
      待审核
    </Badge>
  );
}

export function LibraryList({
  catalog,
  selectedId,
  onSelect,
  onChanged,
  busy = false,
  onReview,
  onDeleteLibrary,
}: LibraryListProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openDialog() {
    setTitle('');
    setDescription('');
    setOpen(true);
  }

  async function handleCreate() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || submitting) return;
    setSubmitting(true);
    try {
      await knowledgeApi.createLibrary(trimmedTitle, description.trim());
      toast.success('资料库已创建');
      setOpen(false);
      onChanged();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '创建资料库失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      {catalog.map((item) => {
        const { label: kindLabel, icon: KindIcon } = kindMeta(item.kind);
        const selected = item.id === selectedId;
        return (
          <Card
            key={item.id}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-disabled={busy}
            onClick={() => {
              if (!busy) onSelect(item.id);
            }}
            onKeyDown={(event) => {
              if (busy) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(item.id);
              }
            }}
            className={`cursor-pointer transition-colors ${
              selected ? 'bg-muted ring-2 ring-primary' : 'hover:bg-muted/50'
            } ${busy ? 'opacity-60' : ''}`}
          >
            <CardHeader className="gap-2">
              <CardTitle className="flex items-start gap-2 text-sm leading-5">
                <KindIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="line-clamp-2">{item.title}</span>
              </CardTitle>
              {item.description && (
                <CardDescription className="line-clamp-2 text-xs">
                  {item.description}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{kindLabel}</Badge>
                <ReviewBadge reviewStatus={item.reviewStatus} />
                <Badge variant="outline">{item.sharedWithMe ? '分享给我' : item.visibility === 'public' ? '公开' : '私有'}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                文档 {item.documentCount} · 知识点 {Math.max(0, item.nodeCount - item.termCount)} ·
                术语 {item.termCount}
              </p>
              {onReview && item.canEdit && (
                <div
                  className="flex items-center gap-1.5 border-t pt-2"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Select
                    value={item.reviewStatus}
                    disabled={busy}
                    onValueChange={(value) => {
                      void onReview(item.id, value).catch(() => undefined);
                    }}
                  >
                    <SelectTrigger
                      className="h-7 min-w-0 flex-1 text-xs"
                      aria-label={`${item.title} 的审核状态`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REVIEW_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {item.ownerId && onDeleteLibrary && (
                    <AlertDialog
                      open={pendingDeleteId === item.id}
                      onOpenChange={(open) => {
                        if (!deleting && !open) setPendingDeleteId(null);
                      }}
                    >
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          disabled={busy}
                          aria-label={`删除资料库 ${item.title}`}
                          onClick={() => setPendingDeleteId(item.id)}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>删除资料库「{item.title}」？</AlertDialogTitle>
                          <AlertDialogDescription>
                            将删除整个资料库及其全部文档、知识点与关系，该操作不可恢复。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            disabled={deleting}
                            onClick={(event) => {
                              event.preventDefault();
                              if (deleting) return;
                              setDeleting(true);
                              void onDeleteLibrary(item)
                                .then(() => setPendingDeleteId(null))
                                .catch(() => undefined)
                                .finally(() => setDeleting(false));
                            }}
                          >
                            {deleting ? (
                              <>
                                <Loader2 className="size-4 animate-spin" aria-hidden />
                                删除中…
                              </>
                            ) : (
                              '确认删除'
                            )}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              )}
              {item.canEdit && user?.role === 'teacher' && <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                <ResourceSharingDialog kind="knowledge" id={item.id} title={item.title} onChanged={onChanged} />
              </div>}
            </CardContent>
          </Card>
        );
      })}

      <Card
        className="rounded-xl border border-dashed border-border shadow-none ring-0"
        size="sm"
      >
        <CardContent className="p-2">
          <Button variant="ghost" className="w-full text-muted-foreground" onClick={openDialog}>
            <FolderPlus className="size-4" aria-hidden />
            新建资料库
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="size-4" aria-hidden />
              新建资料库
            </DialogTitle>
            <DialogDescription>
              资料库可容纳多篇文档，AI 会自动提取知识点与关键名词并合并成图。
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="library-title">标题</Label>
              <Input
                id="library-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：机器人运动学资料"
                maxLength={300}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="library-description">描述（可选）</Label>
              <Textarea
                id="library-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="这个资料库打算收集哪些内容？"
                maxLength={500}
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                取消
              </Button>
              <Button type="submit" disabled={submitting || !title.trim()}>
                {submitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
                创建
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
