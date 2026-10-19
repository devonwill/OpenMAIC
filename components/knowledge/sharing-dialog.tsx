'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertCircle, Loader2, Trash2, UserPlus } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const MAX_STUDENTS = 100;

export interface SharingStudent {
  id: string;
  email: string;
  displayName: string;
}

interface SharingState {
  visibility: 'private' | 'public';
  students: SharingStudent[];
}

export interface SharingDialogProps {
  open: boolean;
  libraryId: string;
  libraryTitle: string;
  onOpenChange: (open: boolean) => void;
}

/**
 * 教师端资料库共享对话框。
 *
 * 后端 /api/resources/sharing 以「学生邮箱」为输入：服务端校验每个邮箱都已注册为
 * 学生账号，再解析成内部 user id 落库。因此这里只维护邮箱串，不自行判断角色。
 */
export function SharingDialog({
  open,
  libraryId,
  libraryTitle,
  onOpenChange,
}: SharingDialogProps) {
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [students, setStudents] = useState<SharingStudent[]>([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // 对话框内常驻的错误条：toast 会自动消失，共享失败必须让教师看清是哪封邮箱有问题
  const [error, setError] = useState<{ title: string; detail?: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ kind: 'knowledge', id: libraryId });
      const res = await fetch(`/api/resources/sharing?${query}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`读取共享设置失败（HTTP ${res.status}）`);
      const data = (await res.json()) as SharingState;
      setVisibility(data.visibility === 'public' ? 'public' : 'private');
      setStudents(Array.isArray(data.students) ? data.students : []);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '读取共享设置失败';
      setError({ title: '无法读取当前共享设置', detail: message });
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [libraryId]);

  useEffect(() => {
    if (!open) return;
    setEmail('');
    void load();
  }, [open, load]);

  const addStudent = () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setError({ title: '邮箱格式不正确', detail: `「${normalized}」不是有效的邮箱地址。` });
      return;
    }
    if (students.some((item) => item.email === normalized)) {
      setError({ title: '重复添加', detail: `${normalized} 已在共享名单中。` });
      return;
    }
    if (students.length >= MAX_STUDENTS) {
      setError({
        title: `最多可共享给 ${MAX_STUDENTS} 位学生`,
        detail: '请先移除部分学生后再添加。',
      });
      return;
    }
    // 输入合法即视为教师已修正意图，清掉上一条错误
    setError(null);
    setStudents((prev) => [
      ...prev,
      { id: '', email: normalized, displayName: normalized.split('@')[0] },
    ]);
    setEmail('');
  };

  const save = async () => {
    const emails = students.map((item) => item.email);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/resources/sharing', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'knowledge',
          id: libraryId,
          visibility,
          studentEmails: emails,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        const message = body?.error || `保存失败（HTTP ${res.status}）`;
        // 服务端只说「部分邮箱未注册为学生账号」，不点名具体哪几封。把本次提交的
        // 名单一并列出，教师可以对着核对，而不必一个一个试。
        if (message.includes('未注册')) {
          setError({
            title: '保存失败：名单中有邮箱未注册为学生账号',
            detail: `本次提交的 ${emails.length} 个邮箱：${emails.join('、')}。请确认每个地址都已用学生身份注册，或从名单中移除。`,
          });
          return;
        }
        setError({ title: '保存失败', detail: message });
        return;
      }
      setError(null);
      toast.success('共享设置已保存');
      onOpenChange(false);
      await load();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '保存失败';
      setError({ title: '保存失败', detail: message });
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>共享资料库</DialogTitle>
          <DialogDescription>
            {libraryTitle} — 选择可见范围与学生名单。学生只能浏览，不能编辑或删除。
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertTitle>{error.title}</AlertTitle>
            {error.detail && <AlertDescription>{error.detail}</AlertDescription>}
          </Alert>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sharing-visibility">可见范围</Label>
            <Select
              value={visibility}
              onValueChange={(value) => setVisibility(value === 'public' ? 'public' : 'private')}
            >
              <SelectTrigger id="sharing-visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">仅指定学生可见</SelectItem>
                <SelectItem value="public">所有登录用户可见</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sharing-email">学生邮箱</Label>
            <div className="flex gap-2">
              <Input
                id="sharing-email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addStudent();
                  }
                }}
                placeholder="student@example.edu.cn"
                type="email"
                maxLength={254}
                disabled={loading || saving}
              />
              <Button
                type="button"
                variant="outline"
                onClick={addStudent}
                disabled={loading || saving}
              >
                <UserPlus aria-hidden />
                添加
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              邮箱必须已注册为学生账号，否则保存时会被服务端拒绝。
            </p>
          </div>

          <div className="space-y-2">
            <Label>已选学生（{students.length}）</Label>
            {loading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                加载中…
              </p>
            ) : students.length === 0 ? (
              <p className="text-sm text-muted-foreground">尚未添加学生</p>
            ) : (
              <ul className="max-h-48 space-y-2 overflow-y-auto">
                {students.map((student) => (
                  <li
                    key={student.email}
                    className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">{student.email}</span>
                    <Badge variant="secondary">学生</Badge>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`移除 ${student.email}`}
                      disabled={saving}
                      onClick={() => {
                        setError(null);
                        setStudents((prev) => prev.filter((item) => item.email !== student.email));
                      }}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={loading || saving}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
