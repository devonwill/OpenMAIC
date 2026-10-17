'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useAuth } from '@/lib/hooks/use-auth';

export function UserMenu() {
  const { t } = useI18n();
  const { user, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <span className="max-w-24 truncate font-medium">{user.displayName}</span>
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
        <div className="absolute right-0 mt-1 w-36 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1">
          <button
            type="button"
            onClick={() => {
              void logout();
              setOpen(false);
            }}
            className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            {t('auth.logout')}
          </button>
        </div>
      )}
    </div>
  );
}
