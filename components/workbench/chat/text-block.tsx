/**
 * 本文件：助手消息的 Markdown 渲染。
 * 职责：基于 Streamdown 渲染流式文本，叠加 KaTeX 公式、CJK 友好强调、
 * workbench 皮肤与课程链接改写四项定制。
 * 关键点：remark-cjk-friendly 必须排在 remark-gfm 之前，否则全角标点旁
 * 的 **强调** 会露出星号；指向课程的锚点升级为内联 CourseLink。
 */
'use client';

/**
 * Assistant Markdown renderer for the workbench chat.
 *
 * Streamdown owns the parse and render; four things are added:
 *
 *  - KaTeX math through Streamdown's stable math plugin configuration, with a
 *    same-parser guard that keeps ordinary currency and shell dollars literal.
 *  - `remark-cjk-friendly` BEFORE `remark-gfm`, because CommonMark's emphasis
 *    flanking rules misfire next to fullwidth CJK punctuation — e.g. `**smart**`
 *    quotes otherwise reach the user with their asterisks on (the spike's S10
 *    lesson). Streamdown's `remarkPlugins` prop REPLACES its defaults, so the
 *    defaults (`gfm`, `codeMeta`) are re-spread explicitly after the CJK plugin.
 *  - the `.wb-prose` skin (see `workbench-chat.css`), which styles Streamdown's
 *    `data-streamdown` node contract rather than its Tailwind class names.
 *  - an anchor override, so a link the agent writes to a course becomes the
 *    INLINE form of `CourseLink` — a course named mid-sentence stays in the
 *    sentence instead of chopping the transcript into cards. Only hrefs that
 *    name a course are upgraded (`/classroom/<id>`, `?course=<id>`); every other
 *    link renders exactly as it did before, and outside `/workspace` — where
 *    there is no right pane — the pill falls back to the plain anchor.
 */
import { createMathPlugin } from '@streamdown/math';
import { Streamdown, defaultRemarkPlugins } from 'streamdown';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { courseIdFromHref } from '@/lib/workbench/course-link';
import { remarkSelectiveSingleDollarMath } from '@/lib/workbench/markdown-math';
import { CourseLink } from './course-link';

// 插件顺序有意为之：CJK 插件在前、默认插件（gfm 等）显式展开在后——
// Streamdown 的 remarkPlugins 会整体替换默认值。
const REMARK_PLUGINS = [
  remarkCjkFriendly,
  remarkSelectiveSingleDollarMath,
  ...Object.values(defaultRemarkPlugins),
];

const STREAMDOWN_PLUGINS = {
  // The official tokenizer handles `$$`; the Workbench extension validates
  // single-dollar candidates before accepting them as math.
  math: createMathPlugin({ singleDollarTextMath: false }),
} as const;

// remark-math already accepts an unterminated flow fence through EOF. Generic
// dollar completion can instead turn a delimiter inside fenced code into math.
const REMEND = { katex: false } as const;

// Table chrome (fullscreen/download) is workbench-irrelevant; the code block's
// copy action stays.
const CONTROLS = { table: false } as const;

// 锚点改写：识别为课程的 href 渲染为内联 CourseLink，其余保持普通 <a>。
const COMPONENTS = {
  a: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { readonly node?: unknown }) => {
    const courseId = courseIdFromHref(href);
    // `node` is Streamdown's mdast handle; it is not a DOM attribute.
    const { node: _node, ...anchor } = rest;
    if (!courseId)
      return (
        <a href={href} {...anchor}>
          {children}
        </a>
      );
    return (
      <CourseLink
        courseId={courseId}
        variant="inline"
        label={children}
        fallback={
          <a href={href} {...anchor}>
            {children}
          </a>
        }
      />
    );
  },
} as const;

// 空文本不渲染；流式期间开启不完整 Markdown 解析，避免半截语法闪烁。
export function TextBlock({ text, streaming = false }: { text: string; streaming?: boolean }) {
  if (!text) return null;
  return (
    <div className="wb-prose">
      {/* No typewriter caret, no block animation: streaming text just streams,
          quietly. (Walkthrough verdict: the caret read as too heavy.) */}
      <Streamdown
        remarkPlugins={REMARK_PLUGINS}
        plugins={STREAMDOWN_PLUGINS}
        remend={REMEND}
        controls={CONTROLS}
        components={COMPONENTS}
        parseIncompleteMarkdown={streaming}
      >
        {text}
      </Streamdown>
    </div>
  );
}
