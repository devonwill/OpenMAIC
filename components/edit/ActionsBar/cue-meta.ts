/**
 * 本文件：时间轴动作/提示的视觉元数据字典。
 * 职责：集中提供各动作类型的图标、i18n 标签键、着色与卡片配色，
 * 以及元素绑定类型集合，替代此前散落在多处的重复映射。
 * 关键点：标签存 i18n 键而非字面量，纯模块不依赖 React Hook。
 */
/**
 * Single source of truth for the timeline's cue/element taxonomy: per action
 * type, the icon + i18n label key + glyph tint + card accent; the set of
 * element-bound cue types; and element-type label keys. Previously these maps
 * were duplicated across ActionsBar, regenerate-tool-ui and ElementPickLayer.
 *
 * Labels are i18n KEYS (resolved by the caller via `t()`), not literals, so the
 * pure module stays hook-free while the UI text goes through `useTranslation`.
 */
import {
  Circle,
  Crosshair,
  Flag,
  Focus,
  PenLine,
  Presentation,
  Quote,
  Shapes,
  Sigma,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import { elementRefLabel } from '@/lib/workbench/element-refs';

/** Translator fn (matches useI18n's `t`) — passed in so this module stays hook-free. */
type TFn = (key: string, options?: Record<string, unknown>) => string;

export interface CueMeta {
  icon: LucideIcon;
  /** i18n key under `edit.cue.*`; resolve with `t(labelKey)`. */
  labelKey: string;
  /** glyph tint: icon color + soft disc background */
  glyph: string;
  /** top accent bar tint for the cue card */
  accent: string;
  /** dashed-border tint used by a "needs target" cue card */
  dash: string;
}

const META: Record<string, CueMeta> = {
  speech: {
    icon: Quote,
    labelKey: 'edit.cue.speech',
    glyph: 'text-primary bg-primary/10 dark:text-primary',
    accent: 'bg-primary/40',
    dash: 'border-primary/40',
  },
  spotlight: {
    icon: Focus,
    labelKey: 'edit.cue.spotlight',
    glyph: 'text-amber-600 bg-amber-500/10 dark:text-amber-400',
    accent: 'bg-amber-400/70',
    dash: 'border-amber-400/70',
  },
  laser: {
    icon: Crosshair,
    labelKey: 'edit.cue.laser',
    glyph: 'text-rose-600 bg-rose-500/10 dark:text-rose-400',
    accent: 'bg-rose-400/70',
    dash: 'border-rose-400/70',
  },
  wb_open: {
    icon: Presentation,
    labelKey: 'edit.cue.whiteboardOpen',
    glyph: 'text-sky-600 bg-sky-500/10 dark:text-sky-400',
    accent: 'bg-sky-400/70',
    dash: 'border-primary/40',
  },
  wb_draw_text: {
    icon: PenLine,
    labelKey: 'edit.cue.whiteboardText',
    glyph: 'text-sky-600 bg-sky-500/10 dark:text-sky-400',
    accent: 'bg-sky-400/70',
    dash: 'border-primary/40',
  },
  wb_draw_shape: {
    icon: Shapes,
    labelKey: 'edit.cue.whiteboardShape',
    glyph: 'text-sky-600 bg-sky-500/10 dark:text-sky-400',
    accent: 'bg-sky-400/70',
    dash: 'border-primary/40',
  },
  wb_draw_latex: {
    icon: Sigma,
    labelKey: 'edit.cue.whiteboardLatex',
    glyph: 'text-sky-600 bg-sky-500/10 dark:text-sky-400',
    accent: 'bg-sky-400/70',
    dash: 'border-primary/40',
  },
  wb_draw_table: {
    icon: Table2,
    labelKey: 'edit.cue.whiteboardTable',
    glyph: 'text-sky-600 bg-sky-500/10 dark:text-sky-400',
    accent: 'bg-sky-400/70',
    dash: 'border-primary/40',
  },
  discussion: {
    icon: Flag,
    labelKey: 'edit.cue.discussion',
    glyph: 'text-yellow-600 bg-yellow-500/10 dark:text-yellow-400',
    accent: 'bg-yellow-400/70',
    dash: 'border-primary/40',
  },
};

const FALLBACK: CueMeta = {
  icon: Circle,
  labelKey: 'edit.cue.action',
  glyph: 'text-muted-foreground bg-muted',
  accent: 'bg-muted-foreground/30',
  dash: 'border-muted-foreground/30',
};

/** 取某动作类型的视觉元数据；未知类型回退到通用样式。 */
export function cueMeta(type: string): CueMeta {
  return META[type] ?? FALLBACK;
}

/** Localized cue label; unknown types fall back to the raw type string. */
export function cueLabel(type: string, t: TFn): string {
  return META[type] ? t(META[type].labelKey) : type;
}

/** Cue types that target a canvas element (so canvas pick mode applies). */
export const ELEMENT_BOUND = new Set(['spotlight', 'laser', 'play_video']);

/** Human label for a slide element (localized type + a short content snippet). */
export function elementLabel(el: { type: string; content?: string }, t: TFn): string {
  return elementRefLabel(el, t);
}
