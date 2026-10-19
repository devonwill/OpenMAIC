'use client';

/**
 * 适合在「只读学生视图」渲染的 markdown：
 *  - 用 `mode="static"` + `parseIncompleteMarkdown: false`，产物在 SSR/CSR 完全一致，
 *    避免 streamdown 内部把 image-wrapper 等 div 塞进 <p> 触发的 hydration 报错。
 *  - 在渲染前预处理 markdown：紧跟在「图片行 / 块级元素」之后的非空行前补空行，
 *    强制 remark 把它们分到独立 paragraph（block-level 元素才能合法嵌套块级元素）。
 *  - **不使用** Tailwind Typography 的 `.prose` 包裹：prose 默认会重置 <p> 内外边距，
 *    反而加重 streamdown <p>→<div> 的嵌套冲突。这里只暴露一个 className 给父级做
 *    排版微调（如字号、链接色），由父级自行决定要不要 prose。
 */
import { useMemo, type ReactNode } from 'react';
import { Streamdown } from 'streamdown';

export interface StreamdownMarkdownProps {
  /** 完整的 markdown 文本；空串退化为一个空 div，不渲染。 */
  markdown: string;
  /** 透传给 Streamdown 根容器的 className。 */
  className?: string;
  /** 单块 className。 */
  blockClassName?: string;
}

// 块级 markdown 元素的正则：行首匹配图片 / 围栏代码 / 缩进代码 / 标题 / 引用 / 列表 / 表格 / 水平线 / HTML 块。
// 关键点是：图片行（`![alt](url)`）若与紧跟的文本行没有空行分隔，remark 会把它们合并到一个
// 段落里，导致 streamdown 的 image-wrapper 嵌进 <p>，React 抛「div cannot be a descendant of p」。
const BLOCK_LINE = /^(```|~~~|\s{4,}>|#{1,6}\s|>|[-*+]\s|\d+\.\s|\|[^\n]*\||\s*<[a-zA-Z][\s\S]*?>\s*$|---$|!\[[^\]]*\]\([^)]*\)\s*$)/;

/**
 * 规范化 markdown：在「块级元素行」与紧随其后的「非空文本行」之间插入空行，
 * 让 remark 严格分块。`![img](...)` 后面紧跟「图注：xxx」是最常见的串段原因。
 */
function ensureBlockBoundaries(markdown: string): string {
  if (!markdown) return '';
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let inFence = false;
  const IMAGE_ONLY = /^\s*!\[[^\]]*\]\([^)]*\)\s*$/;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const prev = out[out.length - 1] ?? '';
    const isFence = /^```|^~~~/.test(line.trimStart());
    if (inFence) {
      out.push(line);
      inFence = !isFence;
      continue;
    }
    if (isFence) {
      // 围栏代码块起：与上一行间补空行
      if (prev.trim() !== '') out.push('');
      out.push(line);
      inFence = true;
      continue;
    }
    // 块级元素（标题/列表/引用/表格/水平线/HTML 块）后紧跟文本行 → 补空行
    if (BLOCK_LINE.test(line) && prev.trim() !== '' && !BLOCK_LINE.test(prev)) {
      out.push('');
    }
    out.push(line);
    // 纯图片行之后，只要下一行存在且非空、且不是围栏代码起 → 强制补一个空行，
    // 这样下面的图注、说明等文本行一定成为独立 paragraph。代价是允许多一个空行，
    // 但 remark 会把多个连续空行折叠成一个 paragraph 边界，没有视觉副作用。
    const next = lines[i + 1];
    if (IMAGE_ONLY.test(line) && next !== undefined && next.trim() !== '' && !/^```|^~~~/.test(next.trimStart())) {
      out.push('');
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

const COMPONENTS = {} as const;

export function StreamdownMarkdown({ markdown, className, blockClassName }: StreamdownMarkdownProps): ReactNode {
  const normalized = useMemo(() => ensureBlockBoundaries(markdown ?? ''), [markdown]);
  if (!normalized.trim()) return null;
  return (
    <Streamdown
      mode="static"
      parseIncompleteMarkdown={false}
      // 关闭行号、复制按钮、表格下载等互动 UI：学生视图只读，不需要悬浮工具条，
      // 也减少因 components 渲染差异导致的 hydration mismatch。
      components={COMPONENTS as never}
      className={className}
    >
      {normalized}
    </Streamdown>
  );
}
