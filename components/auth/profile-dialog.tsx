'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, Eye, EyeOff, Loader2, Lock, Save, User as UserIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { AVATAR_OPTIONS, isValidAvatar, type AuthUser } from '@/lib/auth-client';

const DISPLAY_NAME_MAX = 32;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

type Tab = 'profile' | 'password';

interface ProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: AuthUser;
  onProfileSaved: (user: AuthUser) => void;
}

/**
 * 个人信息面板：头像（卡通可选 + 上传）+ 昵称 + 修改密码。
 * 大模型设置保留在应用的“设置”对话框中，个人资料面板只处理账户信息。
 */
export function ProfileDialog({ open, onOpenChange, user, onProfileSaved }: ProfileDialogProps) {
  const { t } = useI18n();

  const [tab, setTab] = useState<Tab>('profile');

  // profile form state
  const [displayName, setDisplayName] = useState(user.displayName);
  const [avatar, setAvatar] = useState<string>(user.avatar ?? AVATAR_OPTIONS[0]);
  const [savingProfile, setSavingProfile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // 打开时把表单状态重置为最新 user，避免上一次未保存的修改"幽灵保留"。
  useEffect(() => {
    if (!open) return;
    setDisplayName(user.displayName);
    setAvatar(user.avatar ?? AVATAR_OPTIONS[0]);
    setTab('profile');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPassword(false);
  }, [open, user.displayName, user.avatar]);

  const handlePickPreset = (value: string) => {
    setAvatar(value);
  };

  // 上传 → 读为 data URL。限制 ≤ 200KB（与后端 isValidAvatar 一致），
  // 超过则报错让用户换图；data URL 走 PATCH /api/auth/me 持久化到 DB。
  const handleUpload = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        toast.error(t('profileDialog.avatarTypeError'));
        return;
      }
      // 200KB 上限对应 data URL ≈ 200 * 4/3 ≈ 270KB，但前端先按二进制大小把关更直观。
      if (file.size > 200 * 1024) {
        toast.error(t('profileDialog.avatarSizeError'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => toast.error(t('profileDialog.avatarReadError'));
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : null;
        if (!result) return;
        if (!isValidAvatar(result)) {
          toast.error(t('profileDialog.avatarTypeError'));
          return;
        }
        setAvatar(result);
      };
      reader.readAsDataURL(file);
    },
    [t],
  );

  const saveProfile = async () => {
    const trimmed = displayName.trim();
    if (trimmed.length === 0 || trimmed.length > DISPLAY_NAME_MAX) {
      toast.error(t('profileDialog.displayNameError', { max: DISPLAY_NAME_MAX }));
      return;
    }
    setSavingProfile(true);
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: trimmed,
          phone: null,
          avatar,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.user) {
        toast.error(data?.message ?? t('profileDialog.saveFailed'));
        return;
      }
      onProfileSaved(data.user as AuthUser);
      toast.success(t('profileDialog.saveSuccess'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('profileDialog.saveFailed'));
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async () => {
    if (newPassword.length < PASSWORD_MIN || newPassword.length > PASSWORD_MAX) {
      toast.error(
        t('profileDialog.passwordLengthError', { min: PASSWORD_MIN, max: PASSWORD_MAX }),
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t('auth.passwordMismatch'));
      return;
    }
    if (newPassword === currentPassword) {
      toast.error(t('profileDialog.passwordSameError'));
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.message ?? t('profileDialog.saveFailed'));
        return;
      }
      toast.success(t('profileDialog.passwordSuccess'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('profileDialog.saveFailed'));
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 block overflow-hidden">
        <DialogTitle className="sr-only">{t('profileDialog.title')}</DialogTitle>

        {/* tabs */}
        <div className="flex border-b bg-muted/30">
          <TabButton active={tab === 'profile'} onClick={() => setTab('profile')}>
            <UserIcon className="size-3.5" />
            {t('profileDialog.tabProfile')}
          </TabButton>
          <TabButton active={tab === 'password'} onClick={() => setTab('password')}>
            <Lock className="size-3.5" />
            {t('profileDialog.tabPassword')}
          </TabButton>
        </div>

        {tab === 'profile' && (
          <div className="p-5 space-y-5">
            <div className="flex flex-col items-center gap-3">
              <AvatarPreview src={avatar} alt={displayName || user.displayName} />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="user"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUpload(file);
                  // reset value so picking the same file twice still fires onChange
                  e.target.value = '';
                }}
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-1.5"
                >
                  <Camera className="size-3.5" />
                  {t('profileDialog.uploadAvatar')}
                </Button>
                {avatar !== AVATAR_OPTIONS[0] &&
                  !AVATAR_OPTIONS.includes(avatar as (typeof AVATAR_OPTIONS)[number]) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setAvatar(AVATAR_OPTIONS[0])}
                    >
                      {t('profileDialog.resetAvatar')}
                    </Button>
                  )}
              </div>
              <p className="text-[11px] text-muted-foreground/70 text-center">
                {t('profileDialog.avatarHint')}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                {t('profileDialog.presetAvatars')}
              </p>
              <div className="grid grid-cols-7 gap-2">
                {AVATAR_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => handlePickPreset(opt)}
                    className={cn(
                      'size-10 rounded-full ring-2 transition-all overflow-hidden',
                      avatar === opt
                        ? 'ring-primary scale-105'
                        : 'ring-transparent hover:ring-muted-foreground/40',
                    )}
                    aria-label={opt}
                  >
                    <img src={opt} alt="" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-displayName" className="text-xs">
                {t('auth.displayName')}
              </Label>
              <Input
                id="profile-displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={DISPLAY_NAME_MAX}
              />
              <p className="text-[11px] text-muted-foreground/70 text-right">
                {displayName.trim().length}/{DISPLAY_NAME_MAX}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t('auth.email')}</Label>
              <Input value={user.email} disabled />
            </div>

            <div className="flex justify-end pt-1">
              <Button
                onClick={saveProfile}
                disabled={savingProfile}
                size="sm"
                className="gap-1.5"
              >
                {savingProfile ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                {t('common.save')}
              </Button>
            </div>
          </div>
        )}

        {tab === 'password' && (
          <div className="p-5 space-y-4">
            <PasswordField
              id="profile-currentPassword"
              label={t('profileDialog.currentPassword')}
              value={currentPassword}
              onChange={setCurrentPassword}
              show={showPassword}
            />
            <PasswordField
              id="profile-newPassword"
              label={t('profileDialog.newPassword')}
              value={newPassword}
              onChange={setNewPassword}
              show={showPassword}
            />
            <PasswordField
              id="profile-confirmPassword"
              label={t('profileDialog.confirmNewPassword')}
              value={confirmPassword}
              onChange={setConfirmPassword}
              show={showPassword}
            />
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                {showPassword ? t('profileDialog.hidePassword') : t('profileDialog.showPassword')}
              </button>
              <Button
                onClick={savePassword}
                disabled={savingPassword}
                size="sm"
                className="gap-1.5"
              >
                {savingPassword ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Lock className="size-3.5" />
                )}
                {t('profileDialog.updatePassword')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 px-3 py-2.5 text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors',
        active ? 'text-foreground border-b-2 border-primary bg-background' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function AvatarPreview({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="size-20 rounded-full overflow-hidden ring-2 ring-border/40 bg-muted">
      {src ? (
        <img src={src} alt={alt} className="size-full object-cover" />
      ) : (
        <div className="size-full flex items-center justify-center text-muted-foreground/60">
          <UserIcon className="size-8" />
        </div>
      )}
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  show,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
    </div>
  );
}
