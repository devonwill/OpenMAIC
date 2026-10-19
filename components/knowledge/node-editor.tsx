'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { KNOWLEDGE_NODE_TYPES, type KnowledgeNodeType } from '@/lib/knowledge/schema';
import { knowledgeApi, type FullNode, type NodeDraft } from '@/lib/hooks/use-knowledge';

const MAX_ATTRIBUTES = 20;

/** 类型下拉显示名：值域与五类枚举一一对应，新增枚举时 TS 会强制补项。 */
const NODE_TYPE_LABEL: Record<KnowledgeNodeType, string> = {
  literature: '文献',
  person: '人物',
  concept: '概念',
  device: '设备',
  term: '术语',
};

export interface NodeEditorDialogProps {
  open: boolean;
  libraryId: string;
  /** null 且 open 时表示新增节点。 */
  node: FullNode | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

interface AttrRow {
  key: string;
  value: string;
}

function toAttrRows(attributes: Record<string, string>): AttrRow[] {
  return Object.entries(attributes).map(([key, value]) => ({ key, value }));
}

export function NodeEditorDialog({
  open,
  libraryId,
  node,
  onOpenChange,
  onSaved,
}: NodeEditorDialogProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('知识点');
  const [nodeType, setNodeType] = useState<KnowledgeNodeType>('concept');
  const [content, setContent] = useState('');
  const [attrs, setAttrs] = useState<AttrRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 打开 / 切换节点时初始化表单。
  useEffect(() => {
    if (!open) return;
    setName(node?.name ?? '');
    setCategory(node?.category || '知识点');
    setNodeType(node?.nodeType ?? 'concept');
    setContent(node?.content ?? '');
    setAttrs(toAttrRows(node?.attributes ?? {}));
    setSaving(false);
    setDeleting(false);
  }, [open, node]);

  function patchAttr(index: number, patch: Partial<AttrRow>) {
    setAttrs((previous) =>
      previous.map((row, current) => (current === index ? { ...row, ...patch } : row)),
    );
  }

  function addAttr() {
    setAttrs((previous) =>
      previous.length >= MAX_ATTRIBUTES ? previous : [...previous, { key: '', value: '' }],
    );
  }

  function removeAttr(index: number) {
    setAttrs((previous) => previous.filter((_, current) => current !== index));
  }

  function buildDraft(): NodeDraft {
    const attributes: Record<string, string> = {};
    for (const row of attrs) {
      const key = row.key.trim();
      if (key) attributes[key] = row.value;
    }
    return {
      name: name.trim(),
      category: category.trim() || '知识点',
      content,
      nodeType,
      attributes,
    };
  }

  async function handleSave() {
    if (saving || deleting) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setSaving(true);
    try {
      await knowledgeApi.upsertNode(libraryId, buildDraft(), node?.id);
      toast.success(node ? '节点已更新' : '节点已新增');
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '节点保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!node || saving || deleting) return;
    setDeleting(true);
    try {
      await knowledgeApi.deleteNode(libraryId, node.id);
      toast.success('节点已删除');
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '节点删除失败');
    } finally {
      setDeleting(false);
    }
  }

  const nameEmpty = name.trim().length === 0;
  const busy = saving || deleting;

  return (
    <Dialog open={open} onOpenChange={(value) => (busy ? undefined : onOpenChange(value))}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{node ? '编辑节点' : '新增节点'}</DialogTitle>
          <DialogDescription>
            {node
              ? '修改知识点 / 关键名词的名称、描述与自定义属性。'
              : '手动添加的节点不归属任何文档，绿色描边标识。'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[60vh] gap-4 overflow-y-auto pr-1">
          <div className="grid gap-2">
            <Label htmlFor="node-name">名称</Label>
            <Input
              id="node-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：雅可比矩阵"
              maxLength={300}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="node-category">分类</Label>
              <Input
                id="node-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="知识点"
                maxLength={100}
              />
            </div>
            <div className="grid gap-2">
              <Label>类型</Label>
              <Select
                value={nodeType}
                // 选项全部由 KNOWLEDGE_NODE_TYPES 渲染，取值必属五类，断言安全
                onValueChange={(value) => setNodeType(value as KnowledgeNodeType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KNOWLEDGE_NODE_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {NODE_TYPE_LABEL[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="node-content">描述</Label>
            <Textarea
              id="node-content"
              rows={6}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="该节点的讲解内容、定义或备注"
              maxLength={16000}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>自定义属性</Label>
              <span className="text-xs text-muted-foreground">{attrs.length}/{MAX_ATTRIBUTES}</span>
            </div>
            <div className="space-y-2">
              {attrs.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={row.key}
                    onChange={(event) => patchAttr(index, { key: event.target.value })}
                    placeholder="属性名"
                    maxLength={80}
                    className="flex-1"
                  />
                  <Input
                    value={row.value}
                    onChange={(event) => patchAttr(index, { value: event.target.value })}
                    placeholder="属性值"
                    maxLength={500}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeAttr(index)}
                    aria-label="删除属性"
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={addAttr}
              disabled={attrs.length >= MAX_ATTRIBUTES || busy}
            >
              <Plus className="size-4" />
              添加属性
            </Button>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {node ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" type="button" disabled={busy}>
                  <Trash2 className="size-4" />
                  删除节点
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认删除节点</AlertDialogTitle>
                  <AlertDialogDescription>
                    将删除节点「{node.name}」及其全部连边，该操作不可恢复。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(event) => {
                      event.preventDefault();
                      void handleDelete();
                    }}
                    disabled={deleting}
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
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              取消
            </Button>
            <Button type="button" onClick={handleSave} disabled={nameEmpty || busy}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
