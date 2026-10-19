import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAND } from '@/lib/brand/brand-config';

describe('DEFAULT_BRAND (single-brand build)', () => {
  it('uses the OpenRobotics identity for full chrome', () => {
    expect(DEFAULT_BRAND.productName).toBe('OpenRobotics');
    expect(DEFAULT_BRAND.shortName).toBe('OpenRobotics');
    expect(DEFAULT_BRAND.markSrc).toBe('/openrobotics-mark.svg');
    // 品牌蓝取自 logo 实测色，须与 app/globals.css 的 --brand 保持同一色相。
    expect(DEFAULT_BRAND.themeColor).toBe('#044192');
  });

  it('marks its horizontal logo as already containing the wordmark', () => {
    expect(DEFAULT_BRAND.logoHasWordmark).toBe(true);
    expect(DEFAULT_BRAND.logoSrc).toBe('/logo-horizontal.svg');
  });
});
