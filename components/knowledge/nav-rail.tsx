'use client';

import { useState, type ReactNode } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, FolderOpen, Network } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** 三视图与 URL ?view= 一一对应（library 缺省时不写参数，保持可直链分享）。 */
export type KnowledgeView = 'library' | 'graph' | 'resources';

/**
 * 把 ?view= 原始串收窄为合法视图：缺省、空串或未知值一律回落 library。
 * 抽成纯函数是为了可单测——地址栏是外部输入，不能假设只出现合法值。
 */
export function parseViewParam(raw: string | null): KnowledgeView {
  return raw === 'graph' || raw === 'resources' ? raw : 'library';
}

interface NavRailProps {
  view: KnowledgeView;
  onViewChange: (view: KnowledgeView) => void;
  catalog: { id: string; title: string }[];
  selectedId: string | null;
  onSelectLibrary: (id: string) => void;
  busy: boolean;
  /** 仅 library 视图显示：资料库卡片列表（复用 LibraryList，整体搬入槽位）。 */
  libraryList?: ReactNode;
}

const NAV_ITEMS: { key: KnowledgeView; label: string; icon: typeof BookOpen }[] = [
  { key: 'library', label: '资料库', icon: BookOpen },
  { key: 'graph', label: '图谱管理', icon: Network },
  { key: 'resources', label: '资源管理', icon: FolderOpen },
];

export function NavRail({
  view,
  onViewChange,
  catalog,
  selectedId,
  onSelectLibrary,
  busy,
  libraryList,
}: NavRailProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <nav
      className={`relative rounded-3xl border border-border/70 bg-card/90 p-3 shadow-sm transition-[width] duration-200 ${collapsed ? 'w-[72px]' : 'w-full'}`}
      aria-label="知识库导航"
    >
      <div
        className={`mb-5 flex items-center gap-2 px-2 pt-1 text-primary ${collapsed ? 'justify-center' : ''}`}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <BookOpen className="size-4" />
        </span>
        {!collapsed ? (
          <span>
            <b className="block text-sm">教师知识库</b>
            <small className="block text-[10px] text-muted-foreground">管理课程知识资产</small>
          </span>
        ) : null}
      </div>
      {/* 库切换器置顶：图谱/资源视图同样需要切库，所以是全局上下文而非资料库私有 */}
      {!collapsed ? (
        <div className="space-y-1.5">
          <span className="text-muted-foreground text-xs">当前资料库</span>
          <Select
            value={selectedId ?? ''}
            onValueChange={onSelectLibrary}
            disabled={busy || catalog.length === 0}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择资料库" />
            </SelectTrigger>
            <SelectContent>
              {catalog.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {/* 平级三导航，library 缺省：三视图是并列入口而非层级关系 */}
      <ul className="space-y-1">
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
          <li key={key}>
            <button
              type="button"
              onClick={() => onViewChange(key)}
              aria-current={view === key ? 'page' : undefined}
              title={collapsed ? label : undefined}
              className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm transition ${
                view === key
                  ? 'bg-primary text-primary-foreground font-medium shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              } ${collapsed ? 'justify-center px-2' : ''}`}
            >
              <Icon className="h-4 w-4 shrink-0" /> {!collapsed ? label : null}
            </button>
          </li>
        ))}
      </ul>
      {/* 图谱/资源视图下卡片列表收起，把左栏空间让给右侧工作台 */}
      {!collapsed && view === 'library' ? (
        <div className="mt-4 border-t border-border/70 pt-4">{libraryList}</div>
      ) : null}
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="absolute -right-3 top-7 grid size-6 place-items-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-primary"
        aria-label={collapsed ? '展开侧边菜单' : '收缩侧边菜单'}
      >
        {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
      </button>
    </nav>
  );
}
