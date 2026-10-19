import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readKnowledgeSelection,
  sanitizeKnowledgeSelection,
  storeKnowledgeSelection,
} from '@/lib/knowledge/selection';

type FakeWindow = { localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void; data: Map<string, string> } };

function stubWindow(): FakeWindow['localStorage'] {
  const data = new Map<string, string>();
  const localStorage = {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
  vi.stubGlobal('window', { localStorage });
  return localStorage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sanitizeKnowledgeSelection', () => {
  it('drops non-string ids and keeps valid ones', () => {
    const result = sanitizeKnowledgeSelection({ bundleIds: ['a', 1, null, ' b ', {}, ''] });
    expect(result.bundleIds).toEqual(['a', 'b']);
  });

  it('fills a partial quota with picker defaults and total 100 is enforced by the server', () => {
    const result = sanitizeKnowledgeSelection({ bundleIds: [], quota: { local: 60 } });
    expect(result.quota).toEqual({ local: 60, web: 20, model: 20 });
  });

  it('returns an empty selection for garbage payloads', () => {
    expect(sanitizeKnowledgeSelection(null)).toEqual({ bundleIds: [] });
    expect(sanitizeKnowledgeSelection('x')).toEqual({ bundleIds: [] });
    expect(sanitizeKnowledgeSelection({ bundleIds: 'abc' })).toEqual({ bundleIds: [] });
    expect(sanitizeKnowledgeSelection({ bundleIds: [], quota: { local: 'high' } })).toEqual({
      bundleIds: [],
    });
  });
});

describe('read/storeKnowledgeSelection', () => {
  it('round-trips the picker selection through localStorage', () => {
    const storage = stubWindow();
    storeKnowledgeSelection({ bundleIds: ['robotics'], quota: { local: 80, web: 10, model: 10 } });
    expect(storage.data.has('knowledgeSelection')).toBe(true);
    expect(readKnowledgeSelection()).toEqual({
      bundleIds: ['robotics'],
      quota: { local: 80, web: 10, model: 10 },
    });
  });

  it('falls back to the empty selection when storage or JSON is broken', () => {
    stubWindow();
    expect(readKnowledgeSelection()).toEqual({ bundleIds: [] });
    vi.stubGlobal('window', {
      localStorage: { getItem: () => '{oops' },
    });
    expect(readKnowledgeSelection()).toEqual({ bundleIds: [] });
    // 服务端（无 window）读取也必须安全返回空选择。
    vi.unstubAllGlobals();
    expect(readKnowledgeSelection()).toEqual({ bundleIds: [] });
  });
});
