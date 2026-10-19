'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { LogOut, User as UserIcon } from 'lucide-react';
import { toast } from 'sonner';

import { useI18n } from '@/lib/hooks/use-i18n';
import { useAuth } from '@/lib/hooks/use-auth';
import { AVATAR_OPTIONS, type AuthUser } from '@/lib/auth-client';
import { ProfileDialog } from './profile-dialog';

export function UserMenu() {
  const { t } = useI18n();
  const { user, loading, logout, setUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点击菜单外部时收起下拉，避免遮挡页面其他区域
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  if (loading) return null;

  if (!user) {
    return (
      <Link
        href="/auth"
        className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
      >
        {t('auth.loginTab')} / {t('auth.registerTab')}
      </Link>
    );
  }

  const avatarSrc = user.avatar || AVATAR_OPTIONS[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <span className="size-7 rounded-full overflow-hidden ring-1 ring-border/40 shrink-0 bg-muted">
          <img src={avatarSrc} alt={user.displayName} className="size-full object-cover" />
        </span>
        <span className="max-w-24 truncate font-medium hidden sm:inline">{user.displayName}</span>
        <span
          className={
            user.role === 'teacher'
              ? 'px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
              : 'px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
          }
        >
          {t(user.role === 'teacher' ? 'auth.roleTeacher' : 'auth.roleStudent')}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1 z-50">
          {/* 用户信息头部（点开菜单就能看到姓名 + 邮箱，不必打开对话框） */}
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <div className="size-9 rounded-full overflow-hidden ring-1 ring-border/40 shrink-0 bg-muted">
                <img src={avatarSrc} alt="" className="size-full object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold truncate">{user.displayName}</div>
                <div className="text-[11px] text-muted-foreground truncate">{user.email}</div>
              </div>
            </div>
          </div>

          <MenuItem
            icon={<UserIcon className="size-3.5" />}
            onClick={() => {
              setOpen(false);
              setProfileOpen(true);
            }}
          >
            {t('userMenu.profile')}
          </MenuItem>
          {/*
            教师还可能想改密码——但修改密码入口已经整合在 ProfileDialog 的"密码"标签页里，
            这里不再单独列一项，避免一个菜单出现两个"改密码"按钮。
          */}
          <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
          <MenuItem
            icon={<LogOut className="size-3.5" />}
            onClick={() => {
              void logout().catch((error: unknown) =>
                toast.error(error instanceof Error ? error.message : '退出登录失败'),
              );
              setOpen(false);
            }}
            danger
          >
            {t('auth.logout')}
          </MenuItem>
        </div>
      )}

      <ProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        user={user}
        onProfileSaved={(next: AuthUser) => setUser(next)}
      />
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        danger
          ? 'w-full text-left px-3 py-2 text-xs text-destructive hover:bg-destructive/10 inline-flex items-center gap-2'
          : 'w-full text-left px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 inline-flex items-center gap-2'
      }
    >
      {icon}
      {children}
    </button>
  );
}
