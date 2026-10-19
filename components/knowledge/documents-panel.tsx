'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  FileText,
  FileUp,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import {
  knowledgeApi,
  type DocMeta,
  type UploadResult,
} from '@/lib/hooks/use-knowledge';
import { UploadQueue, type UploadQueueItem } from '@/components/knowledge/upload-queue';

interface DocumentsPanelLibrary {
  id: string;
  title: string;
  description: string;
  ownerId?: string;
  reviewStatus: string;
  documents: DocMeta[];
}

interface DocumentsPanelProps {
  library: DocumentsPanelLibrary;
  onChanged: () => void;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function DocumentsPanel({ library, onChanged }: DocumentsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [retryingIndex, setRetryingIndex] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DocMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(library.title);
  const [editDescription, setEditDescription] = useState(library.description);
  const [savingEdit, setSavingEdit] = useState(false);
  // 文档原文查看/编辑对话框
  const [viewDoc, setViewDoc] = useState<DocMeta | null>(null);
  const [viewContent, setViewContent] = useState('');
  const [viewMissing, setViewMissing] = useState(false);
  const [viewDirty, setViewDirty] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [savingDoc, setSavingDoc] = useState(false);
  const [reextracting, setReextracting] = useState(false);
  // 打开/保存成功时的基线内容：脏判定（是否未保存）与撤销回退都相对它
  const [viewOriginal, setViewOriginal] = useState('');
  // 分段撤销栈：保存的不是每个字符，而是一段连续输入的快照
  const [undoStack, setUndoStack] = useState<string[]>([]);
  // 关闭前的「放弃修改」确认框，防止误触 X/ESC 丢失编辑
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // 上一次输入的时间戳，用于划定「连续输入段」的边界
  const lastEditAtRef = useRef(0);

  function patchItem(index: number, patch: Partial<UploadQueueItem>) {
    setQueue((previous) =>
      previous.map((item, current) => (current === index ? { ...item, ...patch } : item)),
    );
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || uploading) return;
    const files = Array.from(fileList);
    setQueue(files.map((file) => ({ file, status: 'waiting' as const })));
    setUploading(true);
    let results: UploadResult[] = [];
    try {
      results = await knowledgeApi.uploadFiles(
        library.id,
        files,
        (index, status, detail) => patchItem(index, { status, detail }),
      );
    } finally {
      setUploading(false);
    }
    const successCount = results.filter((result) => result.ok).length;
    const failureCount = results.length - successCount;
    if (failureCount === 0) {
      toast.success(`上传完成：${successCount} 个文件全部抽取成功`);
    } else if (successCount > 0) {
      toast.warning(`上传结束：成功 ${successCount} 个，失败 ${failureCount} 个`);
    } else {
      toast.error(`上传失败：${failureCount} 个文件均未成功，可逐项重试`);
    }
    if (successCount > 0) onChanged();
  }

  async function handleRetry(index: number) {
    const item = queue[index];
    if (!item || retryingIndex !== null) return;
    setRetryingIndex(index);
    patchItem(index, { status: 'extracting', detail: undefined });
    let results: UploadResult[] = [];
    try {
      results = await knowledgeApi.uploadFiles(
        library.id,
        [item.file],
        (_, status, detail) => patchItem(index, { status, detail }),
      );
    } finally {
      setRetryingIndex(null);
    }
    const result = results[0];
    if (result?.ok) {
      toast.success(`「${item.file.name}」重新上传成功`);
      onChanged();
    } else if (result) {
      toast.error(`「${item.file.name}」仍然失败：${result.error}`);
    }
  }

  /** 打开文档原文对话框并拉取内容（旧数据无原文时提示可粘贴）。 */
  async function openDocument(doc: DocMeta) {
    if (loadingDoc) return;
    setViewDoc(doc);
    setViewContent('');
    setViewOriginal('');
    setViewMissing(false);
    setViewDirty(false);
    setUndoStack([]);
    setConfirmDiscard(false);
    lastEditAtRef.current = 0;
    setLoadingDoc(true);
    try {
      const content = await knowledgeApi.getDocument(library.id, doc.id);
      if (content === null) setViewMissing(true);
      else {
        setViewContent(content);
        setViewOriginal(content);
      }
    } catch (reason) {
      setViewDoc(null);
      toast.error(reason instanceof Error ? reason.message : '读取文档失败');
    } finally {
      setLoadingDoc(false);
    }
  }

  async function handleSaveDocument() {
    if (!viewDoc || savingDoc) return;
    // 保存的是点击瞬间的内容，成功后以它为新基线，撤销与脏判定都相对它
    const content = viewContent;
    setSavingDoc(true);
    try {
      const result = await knowledgeApi.updateDocument(library.id, viewDoc.id, content);
      toast.success(`已保存「${viewDoc.filename}」`);
      setViewDirty(false);
      setViewOriginal(content);
      setViewMissing(false);
      // 内容变化时服务端会标记「来源已变更」，同步到当前对话框便于立即重新抽取。
      setViewDoc((previous) =>
        previous ? { ...previous, stale: previous.stale || result.stale } : previous,
      );
      onChanged();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '保存文档失败');
    } finally {
      setSavingDoc(false);
    }
  }

  /** 按最新原文重新抽取：服务端摘除旧贡献、并入新抽取并回写图谱。 */
  async function handleReextract() {
    if (!viewDoc || reextracting || viewDirty) return;
    setReextracting(true);
    try {
      const { stats, warnings } = await knowledgeApi.reextractDocument(library.id, viewDoc.id);
      toast.success(
        `已重新抽取「${viewDoc.filename}」：${stats.nodes} 个知识点、${stats.links} 条关系`,
      );
      if (warnings.length > 0) toast.warning(warnings[0]);
      setViewDoc(null);
      onChanged();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '重新抽取失败');
    } finally {
      setReextracting(false);
    }
  }

  /** 编辑输入：按 800ms 边界把连续输入合并成一段，撤销一次回退一整段而非单个字符。 */
  function handleContentChange(next: string) {
    const now = Date.now();
    if (now - lastEditAtRef.current > 800) {
      // 栈上限 100 段，避免超长编辑会话无限占用内存
      setUndoStack((stack) => [...stack, viewContent].slice(-100));
    }
    lastEditAtRef.current = now;
    setViewContent(next);
    // 相对基线判定脏状态：撤销回退到原文时自动恢复为「已保存」
    setViewDirty(next !== viewOriginal);
  }

  /** 撤销：回退到上一个分段快照。 */
  function handleUndo() {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    setViewContent(previous);
    setViewDirty(previous !== viewOriginal);
    // 下一次输入重新起段，避免把撤销前后的内容合并成一段
    lastEditAtRef.current = 0;
  }

  /** 关闭请求：有未保存修改时先弹确认框，避免误触 X/ESC 丢失编辑。 */
  function requestCloseView() {
    if (savingDoc || reextracting) return;
    if (viewDirty) setConfirmDiscard(true);
    else setViewDoc(null);
  }

  function openEditDialog() {
    setEditTitle(library.title);
    setEditDescription(library.description);
    setEditOpen(true);
  }

  async function handleSaveEdit() {
    const title = editTitle.trim();
    if (!title || savingEdit) return;
    setSavingEdit(true);
    try {
      await knowledgeApi.updateLibrary(library.id, {
        title,
        description: editDescription.trim(),
      });
      toast.success('资料库信息已更新');
      setEditOpen(false);
      onChanged();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '更新资料库失败');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await knowledgeApi.deleteDocument(library.id, pendingDelete.id);
      toast.success(`已删除文档「${pendingDelete.filename}」`);
      setPendingDelete(null);
      onChanged();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '删除文档失败');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-base font-medium">{library.title}</h3>
        <Button variant="outline" size="sm" onClick={openEditDialog}>
          <Pencil className="size-3.5" aria-hidden />
          编辑资料
        </Button>
        <Button
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || retryingIndex !== null}
        >
          {uploading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-3.5" aria-hidden />
          )}
          {uploading ? '上传中…' : '上传文件到本库'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".md,.txt,.pdf"
          className="hidden"
          onChange={(event) => {
            const files = event.target.files;
            event.target.value = '';
            void handleFiles(files);
          }}
        />
      </div>

      {library.description && (
        <p className="line-clamp-2 text-sm text-muted-foreground">{library.description}</p>
      )}

      <UploadQueue items={queue} retryingIndex={retryingIndex} onRetry={(i) => void handleRetry(i)} />

      {library.documents.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-12 text-center">
          <FileUp className="size-10 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            拖入或选择文件开始上传，AI 将自动提取知识点与关键名词
          </p>
        </div>
      ) : (
        <ScrollArea className="max-h-[420px] rounded-lg border border-border">
          <ul className="divide-y divide-border">
            {library.documents.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50"
              >
                <FileUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" title={doc.filename}>
                    {doc.title || doc.filename}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatTime(doc.uploadedAt)} · 贡献 {doc.nodeCount} 节点
                  </p>
                </div>
                {doc.stale && (
                  <Badge
                    variant="outline"
                    className="shrink-0 border-amber-500/40 text-amber-700 dark:text-amber-400"
                  >
                    <AlertTriangle className="size-3" aria-hidden />
                    来源已变更
                  </Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  aria-label={`打开文档 ${doc.filename}`}
                  disabled={loadingDoc || savingDoc}
                  onClick={() => void openDocument(doc)}
                >
                  <FileText className="size-3.5" aria-hidden />
                  打开
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`删除文档 ${doc.filename}`}
                  disabled={deleting}
                  onClick={() => setPendingDelete(doc)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}

      <Dialog
        open={viewDoc !== null}
        onOpenChange={(open) => {
          // 受控关闭：保存进行中不放行；有未保存修改时转为确认弹窗
          if (open || savingDoc) return;
          requestCloseView();
        }}
      >
        <DialogContent className="flex max-h-[85dvh] max-w-[92vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="shrink-0 border-b border-border px-5 pt-5 pr-12 pb-4">
            <DialogTitle className="truncate">{viewDoc?.title || viewDoc?.filename}</DialogTitle>
            <DialogDescription className="truncate">
              {viewDoc?.filename}
              {viewDoc ? ` · ${formatTime(viewDoc.uploadedAt)}` : ''}
            </DialogDescription>
          </DialogHeader>
          {/* 中段独立滚动：大文档时在对话框内部上下翻阅，窗口不再被撑出视口 */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
            {loadingDoc ? (
              <div className="grid place-items-center py-16">
                <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
              </div>
            ) : (
              <>
                {viewDoc?.stale && (
                  <p className="flex shrink-0 items-start gap-1.5 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    原文已修改，知识图谱尚未同步，二者可能不一致。保存后点击「重新抽取」按新内容更新图谱。
                  </p>
                )}
                {viewMissing && (
                  <p className="shrink-0 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    该文档为早期版本上传，未保留原文。可直接在下方粘贴正文后保存。
                  </p>
                )}
                <Textarea
                  value={viewContent}
                  onChange={(event) => handleContentChange(event.target.value)}
                  maxLength={500_000}
                  className="min-h-72 flex-1 resize-none rounded-lg px-4 py-3 font-mono text-sm leading-relaxed field-sizing-fixed"
                  placeholder="文档正文"
                  aria-label="文档正文"
                />
              </>
            )}
          </div>
          <DialogFooter className="shrink-0 items-center gap-3 border-t border-border bg-muted/40 px-5 py-3.5 sm:justify-between">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span
                  className={`size-1.5 rounded-full ${viewDirty ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  aria-hidden
                />
                {loadingDoc ? '读取中…' : viewDirty ? '有未保存修改' : '已保存'}
              </span>
              <span>{viewContent.length.toLocaleString()} 字符</span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {viewDoc?.stale && (
                <Button
                  variant="outline"
                  onClick={() => void handleReextract()}
                  disabled={reextracting || savingDoc || loadingDoc || viewDirty}
                  title={viewDirty ? '先保存修改再重新抽取' : undefined}
                >
                  {reextracting ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw className="size-4" aria-hidden />
                  )}
                  {reextracting ? '抽取中…' : '重新抽取'}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={handleUndo}
                disabled={undoStack.length === 0 || loadingDoc || savingDoc || reextracting}
                title={undoStack.length === 0 ? '暂无可撤销的修改' : undefined}
              >
                <Undo2 className="size-4" aria-hidden />
                撤销
              </Button>
              <Button
                variant="outline"
                onClick={requestCloseView}
                disabled={savingDoc || reextracting}
              >
                取消
              </Button>
              <Button
                onClick={() => void handleSaveDocument()}
                disabled={savingDoc || loadingDoc || reextracting || !viewDirty}
              >
                {savingDoc && <Loader2 className="size-4 animate-spin" aria-hidden />}
                保存
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 放弃修改确认：脏状态下的 X/ESC/取消统一走这里，避免误丢编辑内容 */}
      <AlertDialog
        open={confirmDiscard}
        onOpenChange={(open) => {
          if (!open) setConfirmDiscard(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
            <AlertDialogDescription>
              「{viewDoc?.filename}」存在未保存的编辑，关闭后本次修改将丢失。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmDiscard(false);
                setViewDoc(null);
              }}
            >
              放弃修改
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑资料库</DialogTitle>
            <DialogDescription>修改资料库的标题与描述。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-library-title">标题</Label>
              <Input
                id="edit-library-title"
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                maxLength={300}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-library-description">描述</Label>
              <Textarea
                id="edit-library-description"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                maxLength={500}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={savingEdit}>
              取消
            </Button>
            <Button onClick={() => void handleSaveEdit()} disabled={savingEdit || !editTitle.trim()}>
              {savingEdit && <Loader2 className="size-4 animate-spin" aria-hidden />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除文档「{pendingDelete?.filename}」？</AlertDialogTitle>
            <AlertDialogDescription>
              仅由本文档产生的节点将一并删除；被多篇文档共享的知识点会保留。该操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteConfirm();
              }}
            >
              {deleting && <Loader2 className="size-4 animate-spin" aria-hidden />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
