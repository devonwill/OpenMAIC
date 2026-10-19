import { describe, expect, it } from 'vitest';
import { parseViewParam } from '@/components/knowledge/nav-rail';

describe('parseViewParam', () => {
  it('accepts the two non-default view values from the URL', () => {
    expect(parseViewParam('graph')).toBe('graph');
    expect(parseViewParam('resources')).toBe('resources');
  });

  it('falls back to library for missing, empty, or unknown values', () => {
    // 地址栏是外部输入：手改 URL、旧链接、拼写错误都必须回落到缺省视图而不是白屏
    expect(parseViewParam(null)).toBe('library');
    expect(parseViewParam('')).toBe('library');
    expect(parseViewParam('documents')).toBe('library');
    expect(parseViewParam('GRAPH')).toBe('library');
    expect(parseViewParam('graph?x=1')).toBe('library');
  });
});
