import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_NODE_TYPES, knowledgeNodeSchema, linkLineStyle, LINK_STYLE } from '@/lib/knowledge/schema';
import { createEmptyLibrary, upsertNode } from '@/lib/knowledge/library-store';

describe('nodeType 五类枚举', () => {
  it('五类全部通过校验', () => {
    for (const nodeType of KNOWLEDGE_NODE_TYPES) {
      const parsed = knowledgeNodeSchema.shape.nodeType.safeParse(nodeType);
      expect(parsed.success).toBe(true);
    }
    expect(KNOWLEDGE_NODE_TYPES).toEqual(['literature', 'person', 'concept', 'device', 'term']);
  });

  it('缺省回落 concept', () => {
    expect(knowledgeNodeSchema.shape.nodeType.parse(undefined)).toBe('concept');
  });

  it('拒绝枚举外取值', () => {
    expect(knowledgeNodeSchema.shape.nodeType.safeParse('author').success).toBe(false);
  });

  it('upsertNode 保留五类取值（注意返回结构解构 bundle）', () => {
    const base = createEmptyLibrary({ id: 't', title: 'T', ownerId: 'o', now: '2026-09-29T00:00:00.000Z' });
    const { bundle } = upsertNode(base, {
      name: '张三', category: '人物', content: '学者', nodeType: 'person', attributes: {},
    });
    expect(bundle.nodes[0]?.nodeType).toBe('person');
  });
});

describe('LINK_STYLE 线型判定', () => {
  it('结构类关系实线', () => {
    expect(linkLineStyle('包含')).toBe('solid');
    expect(linkLineStyle('定义于')).toBe('solid');
    expect(linkLineStyle('组成')).toBe('solid');
  });

  it('引用类关系虚线', () => {
    expect(linkLineStyle('引用')).toBe('dashed');
    expect(linkLineStyle('相关知识')).toBe('dashed');
    expect(linkLineStyle('推导出')).toBe('dashed');
  });

  it('未知关系默认实线且在表内', () => {
    expect(linkLineStyle('某种新关系')).toBe('solid');
    expect(LINK_STYLE['引用']).toBe('dashed');
  });
});
