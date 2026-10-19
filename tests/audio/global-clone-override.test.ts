/**
 * Global "use my cloned voice for every AI teacher" override: the picked clone
 * wins only while the switch is on and its provider is among the enabled
 * providers; otherwise resolution returns null and callers keep their normal
 * resolved/fallback voice.
 */
import { describe, expect, it } from 'vitest';
import {
  resolveGlobalCloneOverride,
  type ProviderWithVoices,
} from '@/lib/audio/voice-resolver';

const providers: ProviderWithVoices[] = [
  {
    providerId: 'xiaomi-tts' as never,
    providerName: 'MiMo',
    voices: [{ id: 'clone-me', name: '我的声音' }],
    modelGroups: [],
  },
];

it('开关关闭返回 null', () => {
  expect(
    resolveGlobalCloneOverride(
      { useMyCloneVoice: false, myCloneVoiceId: 'clone-me', myCloneVoiceProvider: 'xiaomi-tts' },
      providers,
    ),
  ).toBeNull();
});

it('开启且 provider enabled 返回覆盖音色', () => {
  expect(
    resolveGlobalCloneOverride(
      { useMyCloneVoice: true, myCloneVoiceId: 'clone-me', myCloneVoiceProvider: 'xiaomi-tts' },
      providers,
    ),
  ).toEqual({ providerId: 'xiaomi-tts', voiceId: 'clone-me' });
});

it('所选 provider 不在 enabled 列表返回 null', () => {
  expect(
    resolveGlobalCloneOverride(
      { useMyCloneVoice: true, myCloneVoiceId: 'x', myCloneVoiceProvider: 'qwen-tts' },
      providers,
    ),
  ).toBeNull();
});

describe('resolveGlobalCloneOverride 字段守卫', () => {
  it('开启但音色或 provider 为空时返回 null', () => {
    expect(
      resolveGlobalCloneOverride(
        { useMyCloneVoice: true, myCloneVoiceId: '  ', myCloneVoiceProvider: 'xiaomi-tts' },
        providers,
      ),
    ).toBeNull();
    expect(
      resolveGlobalCloneOverride(
        { useMyCloneVoice: true, myCloneVoiceId: 'clone-me', myCloneVoiceProvider: '' },
        providers,
      ),
    ).toBeNull();
  });
});
