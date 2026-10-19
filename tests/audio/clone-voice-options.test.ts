/**
 * toCloneVoiceOptions：克隆音色 profile → 可选项（设置弹层与默认声音同步
 * CloneVoiceDefaultSync 共用，保证两处选中的音色 id 完全一致）。
 * - 仅取 kind === 'clone'；
 * - providerId 缺省按 voxcpm-tts 处理；
 * - VoxCPM 本地 profile id 翻译为 wire voice id，Qwen/Xiaomi 直接用 enrollment id；
 * - 输入顺序保持不变（[0] 即最近注册的克隆音色）。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/utils/database', () => ({ db: {} }));

import { toCloneVoiceOptions } from '@/lib/audio/voxcpm-voices';
import type { VoiceProfileRecord } from '@/lib/utils/database';

function profile(overrides: Partial<VoiceProfileRecord>): VoiceProfileRecord {
  return {
    id: 'p-1',
    providerId: 'voxcpm-tts',
    kind: 'clone',
    name: '我的声音',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

it('过滤非 clone 记录并保持输入顺序', () => {
  const options = toCloneVoiceOptions([
    profile({ id: 'clone-new', name: '新注册', updatedAt: 200 }),
    profile({ id: 'prompt-1', kind: 'prompt', name: '提示音', updatedAt: 150 }),
    profile({ id: 'clone-old', name: '旧注册', updatedAt: 100 }),
  ]);
  expect(options.map((o) => o.id)).toEqual([
    'voxcpm:profile:clone-new',
    'voxcpm:profile:clone-old',
  ]);
  expect(options.map((o) => o.name)).toEqual(['新注册', '旧注册']);
});

it('VoxCPM 记录 providerId 为空时默认 voxcpm-tts 并翻译 wire id', () => {
  const [option] = toCloneVoiceOptions([profile({ id: 'p-9', providerId: '' })]);
  expect(option).toEqual({
    id: 'voxcpm:profile:p-9',
    name: '我的声音',
    providerId: 'voxcpm-tts',
  });
});

it('Qwen 克隆音色直接使用 enrollment id', () => {
  const [option] = toCloneVoiceOptions([
    profile({ id: 'Cherry-clone', providerId: 'qwen-tts', name: 'Cherry' }),
  ]);
  expect(option).toEqual({ id: 'Cherry-clone', name: 'Cherry', providerId: 'qwen-tts' });
});

it('没有克隆音色时返回空数组', () => {
  expect(toCloneVoiceOptions([profile({ id: 'prompt-1', kind: 'prompt' })])).toEqual([]);
  expect(toCloneVoiceOptions([])).toEqual([]);
});
