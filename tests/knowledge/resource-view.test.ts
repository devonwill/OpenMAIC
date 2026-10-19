import { describe, expect, it } from 'vitest';
import {
  classifyMaterial,
  filterMaterials,
  formatBytes,
  formatTime,
  sortMaterials,
  splitMaterials,
  type OwnerMaterial,
} from '@/components/knowledge/resource-view';

/**
 * ResourceView 的纯逻辑单测（Task 9 TDD）：
 * JSX 交互以 tsc 收口，这里只覆盖可纯函数化的部分——mime 分类分组、
 * 筛选、排序、大小/时间格式化，避免这些口径悄悄漂移。
 */
function material(patch: Partial<OwnerMaterial> = {}): OwnerMaterial {
  return {
    materialId: 'm-default',
    kind: 'source',
    bytes: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

describe('classifyMaterial：按 mime 前缀分类，kind 不参与', () => {
  it('image/* 归为图片、video/* 归为视频', () => {
    expect(classifyMaterial(material({ mime: 'image/png' }))).toBe('image');
    expect(classifyMaterial(material({ mime: 'IMAGE/JPEG' }))).toBe('image');
    expect(classifyMaterial(material({ mime: 'video/mp4' }))).toBe('video');
  });

  it('kind=web 的图片仍然是图片（kind 只有 source/web，不表达媒体类型）', () => {
    expect(classifyMaterial(material({ kind: 'web', mime: 'image/webp' }))).toBe('image');
  });

  it('无 mime 或非图片视频（如 PDF）归为 other', () => {
    expect(classifyMaterial(material())).toBe('other');
    expect(classifyMaterial(material({ mime: 'application/pdf' }))).toBe('other');
  });
});

describe('splitMaterials：拆图片/视频两组，other 丢弃', () => {
  it('按 mime 分组，文档类素材不进任何一组（由 knowledge 文档区承担）', () => {
    const image = material({ materialId: 'i1', mime: 'image/png' });
    const video = material({ materialId: 'v1', mime: 'video/mp4' });
    const pdf = material({ materialId: 'd1', mime: 'application/pdf' });
    const result = splitMaterials([image, video, pdf]);
    expect(result.images).toEqual([image]);
    expect(result.videos).toEqual([video]);
  });

  it('空数组返回两个空组', () => {
    expect(splitMaterials([])).toEqual({ images: [], videos: [] });
  });
});

describe('filterMaterials：文件名与 MIME 匹配', () => {
  it('空词（含纯空格）原样返回同一引用，避免无谓拷贝', () => {
    const list = [material()];
    expect(filterMaterials(list, '')).toBe(list);
    expect(filterMaterials(list, '   ')).toBe(list);
  });

  it('大小写不敏感，匹配 originalName 与 mime', () => {
    const target = material({ materialId: 'm1', originalName: 'RobotArm.png', mime: 'image/png' });
    const other = material({ materialId: 'm2', originalName: 'demo.mp4', mime: 'video/mp4' });
    const list = [target, other];
    expect(filterMaterials(list, 'ROBOT')).toEqual([target]);
    expect(filterMaterials(list, 'video/')).toEqual([other]);
  });

  it('无 originalName 的记录回落 materialId 参与匹配', () => {
    const target = material({ materialId: 'mat-abc-123' });
    expect(filterMaterials([target], 'abc-123')).toEqual([target]);
  });
});

describe('sortMaterials：时间/名称/大小三种口径，不改原数组', () => {
  it('时间口径新在前', () => {
    const old = material({ materialId: 'old', createdAt: '2026-01-01T00:00:00.000Z' });
    const recent = material({ materialId: 'new', createdAt: '2026-06-01T00:00:00.000Z' });
    expect(sortMaterials([old, recent], 'time').map((m) => m.materialId)).toEqual(['new', 'old']);
  });

  it('名称口径升序（ASCII 文件名），同名回落 materialId 保证稳定', () => {
    const b = material({ materialId: 'b', originalName: 'beta.png' });
    const a2 = material({ materialId: 'z', originalName: 'alpha.png' });
    const a1 = material({ materialId: 'a', originalName: 'alpha.png' });
    const sorted = sortMaterials([b, a2, a1], 'name');
    // alpha 在前；同名时按 materialId：a < z
    expect(sorted.map((m) => m.materialId)).toEqual(['a', 'z', 'b']);
  });

  it('大小口径降序，bytes 相同回落 materialId', () => {
    const big = material({ materialId: 'big', bytes: 2048 });
    const small = material({ materialId: 'small', bytes: 10 });
    const alsoBig = material({ materialId: 'aaa', bytes: 2048 });
    expect(sortMaterials([small, big, alsoBig], 'size').map((m) => m.materialId)).toEqual([
      'aaa',
      'big',
      'small',
    ]);
  });

  it('createdAt 非法按 0（最旧）处理，不产生 NaN 比较', () => {
    const broken = material({ materialId: 'broken', createdAt: 'not-a-date' });
    const valid = material({ materialId: 'valid', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(sortMaterials([broken, valid], 'time').map((m) => m.materialId)).toEqual([
      'valid',
      'broken',
    ]);
  });

  it('排序返回新数组，原数组引用与内容不变', () => {
    const list = [material({ materialId: 'b' }), material({ materialId: 'a' })];
    const snapshot = [...list];
    const sorted = sortMaterials(list, 'name');
    expect(sorted).not.toBe(list);
    expect(list).toEqual(snapshot);
  });
});

describe('formatBytes：B 取整，KB 及以上保留 1 位小数', () => {
  it('常规值', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1048576)).toBe('1.0 MB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50.0 MB');
    expect(formatBytes(1024 ** 4)).toBe('1.0 TB');
  });

  it('非法值（负数/NaN/Infinity）给占位符，不上屏 NaN', () => {
    expect(formatBytes(-1)).toBe('-');
    expect(formatBytes(Number.NaN)).toBe('-');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('-');
  });
});

describe('formatTime：无效日期回退原串', () => {
  it('有效时间等于 toLocaleString', () => {
    const iso = '2026-01-01T00:00:00.000Z';
    expect(formatTime(iso)).toBe(new Date(iso).toLocaleString());
  });

  it('无效输入原样返回，不显示 Invalid Date', () => {
    expect(formatTime('not-a-date')).toBe('not-a-date');
  });
});
