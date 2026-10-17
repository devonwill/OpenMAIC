'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/hooks/use-auth';
import { useSettingsStore } from '@/lib/store/settings';
import type { ProvidersConfig } from '@/lib/types/settings';
import { createLogger } from '@/lib/logger';

// 教师模型配置云端同步（spec §8）：登录时远端覆盖本地（或首绑上传本地），
// 之后本地变更防抖 2s 上传。last-write-wins，不做多端合并。
// 学生/匿名完全不触发（Q9）。

const log = createLogger('TeacherConfigSync');

const SYNC_DEBOUNCE_MS = 2000;

export function TeacherConfigSync() {
  const { user } = useAuth();
  const syncedUserRef = useRef<string | null>(null);
  const applyingRemoteRef = useRef(false);

  // 登录/切换账号时的一次性同步
  useEffect(() => {
    if (!user || user.role !== 'teacher') {
      syncedUserRef.current = null;
      return;
    }
    if (syncedUserRef.current === user.id) return;
    syncedUserRef.current = user.id;

    void (async () => {
      try {
        const res = await fetch('/api/auth/me/model-config', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        // 服务端 apiSuccess 把字段摊平在顶层，这里直接取 providersConfig；
        // 类型上与 model-config 路由的 ProvidersConfig 对齐（教师配置结构同源）。
        const remote = data?.providersConfig as ProvidersConfig | null;
        if (remote && Object.keys(remote).length > 0) {
          // 远端有配置 → 覆盖本地（跨设备恢复）
          applyingRemoteRef.current = true;
          useSettingsStore.getState().setProvidersConfig(remote);
          // 等 zustand persist 写完 localStorage 再恢复自动同步
          setTimeout(() => {
            applyingRemoteRef.current = false;
          }, 100);
        } else {
          // 远端无 → 首次绑定：上传本地当前配置
          const local = useSettingsStore.getState().providersConfig;
          await fetch('/api/auth/me/model-config', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ providersConfig: local }),
          });
        }
      } catch (e) {
        // 同步失败不回滚本地配置：本地照常可用，下次登录重试。
        // 但必须留下可见日志，便于排查（不静默吞）。
        log.warn('teacher model-config initial sync failed:', e);
      }
    })();
  }, [user]);

  // 本地变更防抖上传（仅教师已同步完成后）
  useEffect(() => {
    if (!user || user.role !== 'teacher') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useSettingsStore.subscribe((state, prev) => {
      if (applyingRemoteRef.current) return;
      if (state.providersConfig === prev.providersConfig) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void fetch('/api/auth/me/model-config', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ providersConfig: useSettingsStore.getState().providersConfig }),
        }).catch((e) => {
          // 上传失败必须可见：教师以为配置已云同步、实际没传上去是最坏情况，
          // console.warn 级日志（createLogger 内部走 console.warn）。
          log.warn('teacher model-config upload failed:', e);
        });
      }, SYNC_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [user]);

  return null;
}
