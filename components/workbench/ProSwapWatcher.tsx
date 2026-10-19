/**
 * 本文件：路由到达监视器（无 UI）。
 * 职责：挂在根 layout 中监听 pathname 变化，向 pro-swap 状态机上报
 * 「目标路由已渲染」，从而结束换页动画。
 * 关键点：发起换页的组件随页面卸载，必须由常驻组件代为上报到达。
 */
'use client';

/**
 * Reports route arrivals to `pro-swap`, from the root layout.
 *
 * The Pro swap has to know when the destination route has rendered, and the
 * component that started it (a badge on the page that is leaving) is gone by
 * then. This one is mounted in `app/layout.tsx`, above `children`, so it
 * survives every navigation and can be the one that says "we are there".
 *
 * Renders nothing.
 */
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { proSwapArrived } from '@/lib/workbench/pro-swap';

// 渲染 null，仅在路由变化时上报一次到达事件。
export function ProSwapWatcher() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname) proSwapArrived(pathname);
  }, [pathname]);

  return null;
}
