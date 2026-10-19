'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { knowledgeApi, type FullLink, type FullNode } from '@/lib/hooks/use-knowledge';

const CARD_W = 272;
const CARD_H = 168;
const VIEWPORT_MARGIN = 12;

export interface LinkEditorPopoverProps {
  open: boolean;
  /** 屏幕坐标（边点击位置），卡片固定定位锚点。 */
  x: number;
  y: number;
  link: FullLink | null;
  libraryId: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function LinkEditorPopover({
  open,
  x,
  y,
  link,
  libraryId,
  onOpenChange,
  onSaved,
}: LinkEditorPopoverProps) {
  const [relation, setRelation] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open && link) {
      setRelation(link.relation);
      setSaving(false);
      setDeleting(false);
    }
  }, [open, link]);

  async function handleSave() {
    if (!link || saving || deleting) return;
    const trimmed = relation.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await knowledgeApi.updateLink(libraryId, link.id, trimmed);
      toast.success('关系已更新');
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '关系保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!link || saving || deleting) return;
    setDeleting(true);
    try {
      await knowledgeApi.deleteLink(libraryId, link.id);
      toast.success('边已删除');
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '边删除失败');
    } finally {
      setDeleting(false);
    }
  }

  if (!open || !link) return null;

  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : x + CARD_W) - CARD_W - VIEWPORT_MARGIN),
  );
  const top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(y, (typeof window !== 'undefined' ? window.innerHeight : y + CARD_H) - CARD_H - VIEWPORT_MARGIN),
  );
  const busy = saving || deleting;
  const relationEmpty = relation.trim().length === 0;

  return (
    <>
      {/* 透明遮罩：点击外部关闭 */}
      <div
        className="fixed inset-0 z-40"
        aria-hidden
        onMouseDown={() => onOpenChange(false)}
      />
      <div
        role="dialog"
        aria-label="编辑关系"
        className="fixed z-50 rounded-lg border bg-popover p-4 text-popover-foreground shadow-md"
        style={{ left, top, width: CARD_W }}
      >
        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="link-relation">关系名称</Label>
            <Input
              id="link-relation"
              value={relation}
              onChange={(event) => setRelation(event.target.value)}
              maxLength={200}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !relationEmpty && !busy) void handleSave();
                if (event.key === 'Escape') onOpenChange(false);
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" type="button" disabled={busy}>
                  <Trash2 className="size-4" />
                  删除边
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认删除边</AlertDialogTitle>
                  <AlertDialogDescription>
                    将删除「{link.relation}」这条关系，删除后不可恢复。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={deleting}
                    onClick={(event) => {
                      event.preventDefault();
                      void handleDelete();
                    }}
                  >
                    {deleting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        删除中…
                      </>
                    ) : (
                      '确认删除'
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={relationEmpty || busy}
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                保存
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export interface AddLinkDialogProps {
  open: boolean;
  libraryId: string;
  nodes: FullNode[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function AddLinkDialog({
  open,
  libraryId,
  nodes,
  onOpenChange,
  onSaved,
}: AddLinkDialogProps) {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [relation, setRelation] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSource('');
      setTarget('');
      setRelation('');
      setSaving(false);
    }
  }, [open]);

  async function handleSubmit() {
    if (saving) return;
    const trimmed = relation.trim();
    if (!source || !target || !trimmed || source === target) return;
    setSaving(true);
    try {
      await knowledgeApi.addLink(libraryId, source, target, trimmed);
      toast.success('关系已新增');
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '关系新增失败');
    } finally {
      setSaving(false);
    }
  }

  const sameEndpoint = source.length > 0 && source === target;
  const canSubmit = source.length > 0 && target.length > 0 && relation.trim().length > 0 && !sameEndpoint;

  return (
    <Dialog open={open} onOpenChange={(value) => (saving ? undefined : onOpenChange(value))}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新增关系</DialogTitle>
          <DialogDescription>选择两个节点并填写它们之间的关系名称。</DialogDescription>
        </DialogHeader>

        {nodes.length < 2 ? (
          <p className="text-sm text-muted-foreground">至少需要两个节点才能新增关系。</p>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>起点节点</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择起点" />
                </SelectTrigger>
                <SelectContent>
                  {nodes.map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {node.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>终点节点</Label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择终点" />
                </SelectTrigger>
                <SelectContent>
                  {nodes.map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {node.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {sameEndpoint && (
              <p role="alert" className="text-sm text-destructive">
                起点与终点不能是同一个节点
              </p>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="add-link-relation">关系名称</Label>
              <Input
                id="add-link-relation"
                value={relation}
                onChange={(event) => setRelation(event.target.value)}
                placeholder="例如：用于 / 指示 / 导致"
                maxLength={200}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canSubmit && !saving) void handleSubmit();
                }}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            取消
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit || saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
