'use client';

import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function ResourceSharingDialog({ kind, id, title, onChanged }: {
  kind: 'knowledge' | 'asset' | 'material'; id: string; title: string; onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'private' | 'public' | 'students'>('private');
  const [emails, setEmails] = useState('');
  const [busy, setBusy] = useState(false);
  async function show() {
    setBusy(true);
    try {
      const response = await fetch(`/api/resources/sharing?${new URLSearchParams({ kind, id })}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '读取分享设置失败');
      setMode(data.visibility === 'public' ? 'public' : data.students.length ? 'students' : 'private');
      setEmails(data.students.map((student: { email: string }) => student.email).join('\n'));
      setOpen(true);
    } catch (error) { toast.error(error instanceof Error ? error.message : '读取失败'); }
    finally { setBusy(false); }
  }
  async function save() {
    setBusy(true);
    try {
      const studentEmails = mode === 'students' ? [...new Set(emails.split(/[\s,，;；]+/).filter(Boolean))] : [];
      if (mode === 'students' && !studentEmails.length) throw new Error('请至少填写一位学生的注册邮箱');
      const response = await fetch('/api/resources/sharing', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, visibility: mode === 'public' ? 'public' : 'private', studentEmails }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '保存失败');
      toast.success(mode === 'private' ? '已设为私有，其他用户的访问权限已撤销' : '发布与分享设置已保存');
      setOpen(false); onChanged();
    } catch (error) { toast.error(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  }
  return <>
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void show()}><Share2 className="size-4" />发布与分享</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>发布与分享：{title}</DialogTitle><DialogDescription>分享授予查看和使用权限，只有你能修改资源。设置为私有会撤销已有分享；已下载的副本不受影响。</DialogDescription></DialogHeader>
        <fieldset className="space-y-3" disabled={busy}>
          <legend className="mb-2 text-sm font-medium">谁可以访问</legend>
          {([['private', '仅自己（私有）'], ['public', '平台内所有已登录用户（公开）'], ['students', '指定学生']] as const).map(([value,label]) =>
            <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" name={`sharing-${kind}-${id}`} checked={mode === value} onChange={() => setMode(value)} />{label}</label>)}
          {mode === 'students' && <div className="space-y-2"><Label htmlFor={`students-${kind}-${id}`}>学生的注册邮箱</Label><Textarea id={`students-${kind}-${id}`} value={emails} onChange={(event) => setEmails(event.target.value)} placeholder="每行一个邮箱，最多 100 位学生" rows={5} /><p className="text-xs text-muted-foreground">学生登录后可在知识库或资源管理中查看。移除邮箱即可撤销对应授权。</p></div>}
        </fieldset>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>取消</Button><Button disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存设置'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
