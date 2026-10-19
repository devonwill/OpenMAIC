/**
 * 本文件：缩略图之间的悬停插入区。
 * 职责：两个缩略图缝隙处的 8px 热区，悬停弹出「+」徽标，点击后弹出
 * 场景类型选择（幻灯片 / 测验），调用 onInsert 在该位置插入新页面。
 * 关键点：缝隙高度固定不引起布局位移；整个区域 z-20 抬升，
 * 避免相邻 Reorder.Item 的 transform 层叠上下文盖住「+」徽标。
 */
'use client';

import { ListChecks, Plus, Presentation } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { EditableSceneType } from '@/lib/edit/scene-defaults';

interface InsertionZoneProps {
  readonly label: string;
  readonly slideLabel: string;
  readonly quizLabel: string;
  readonly onInsert: (type: EditableSceneType) => void;
}

/**
 * Hover-revealed insertion affordance between two thumbs.
 *
 * The gap is a slim 8px hit zone that matches playback `SceneSidebar`'s
 * `space-y-2` density (no layout shift, ever). On hover the `+` badge
 * pops out to the right side of the gap with a small overshoot, sitting
 * on its own z-layer with a solid background + soft drop shadow so it
 * clearly floats above any adjacent violet ring.
 *
 * 中文要点：点击「+」弹出场景类型菜单，选中即在该缝隙位置插入页面。
 */
export function InsertionZone({ label, slideLabel, quizLabel, onInsert }: InsertionZoneProps) {
  // `z-20` lifts the whole zone above adjacent `Reorder.Item` siblings.
  // Without this, the next-in-DOM-order ThumbItem (which has a `transform`
  // via motion's Reorder, creating its own stacking context) paints on
  // top, and its violet ring clips through the `+` badge regardless of
  // any z-index applied inside the InsertionZone itself.
  return (
    <Popover>
      <div className="group/insert relative isolate z-20 h-2 cursor-pointer overflow-visible">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            title={label}
            data-testid="slide-nav-insert"
            className="absolute inset-0 z-10 outline-none focus-visible:opacity-100"
          >
            <span className="sr-only">{label}</span>
            <span
              aria-hidden
              className={cn(
                // Anchored at the right edge of the gap, vertically centered.
                // z-30 lifts it above the adjacent active tile's ring (z-default).
                'pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 z-30',
                'inline-flex h-5 w-5 items-center justify-center rounded-full',
                // Solid background + ring + shadow gives it real visual
                // elevation against the neighbouring violet ring zones.
                'bg-white text-blue-600 ring-1 ring-blue-200',
                'dark:bg-zinc-900 dark:text-blue-300 dark:ring-blue-400/40',
                'shadow-md shadow-blue-500/15 dark:shadow-blue-500/20',
                // Popup motion: start tiny + transparent, end full size with a
                // small overshoot. The custom cubic-bezier is a classic
                // "back-ease-out" giving it a quick, springy reveal.
                'opacity-0 scale-50',
                'group-hover/insert:opacity-100 group-hover/insert:scale-100',
                'group-focus-within/insert:opacity-100 group-focus-within/insert:scale-100',
                'transition-[opacity,transform] duration-200',
                '[transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]',
              )}
            >
              <Plus className="h-3 w-3" strokeWidth={2.5} />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="center"
          sideOffset={8}
          className="w-40 p-1.5"
          data-testid="scene-type-chooser"
        >
          <SceneTypeChoice
            type="slide"
            label={slideLabel}
            Icon={Presentation}
            onInsert={onInsert}
          />
          <SceneTypeChoice type="quiz" label={quizLabel} Icon={ListChecks} onInsert={onInsert} />
        </PopoverContent>
      </div>
    </Popover>
  );
}

function SceneTypeChoice({
  type,
  label,
  Icon,
  onInsert,
}: {
  readonly type: EditableSceneType;
  readonly label: string;
  readonly Icon: typeof Presentation;
  readonly onInsert: (type: EditableSceneType) => void;
}) {
  return (
    <PopoverClose asChild>
      <button
        type="button"
        onClick={() => onInsert(type)}
        data-testid={`scene-type-${type}`}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm',
          'text-zinc-700 outline-none transition-colors hover:bg-blue-50 hover:text-blue-700',
          'focus-visible:bg-blue-50 focus-visible:text-blue-700',
          'dark:text-zinc-200 dark:hover:bg-blue-500/10 dark:hover:text-blue-300',
          'dark:focus-visible:bg-blue-500/10 dark:focus-visible:text-blue-300',
        )}
      >
        <Icon className="h-4 w-4 text-blue-500" strokeWidth={1.8} aria-hidden="true" />
        <span>{label}</span>
      </button>
    </PopoverClose>
  );
}
