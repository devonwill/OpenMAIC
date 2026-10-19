/**
 * AI 教师默认声音 = 已注册的克隆声音（settings v5）：
 * - 新用户默认 useMyCloneVoice: true，音色留空由 CloneVoiceDefaultSync 选择；
 * - v4 及更早的存档（旧的 opt-in 默认 false）在 migrate 时翻转为 true；
 * - v5 之后用户主动关闭不会被再次翻回。
 *
 * 与 settings-agent-voice-overrides.test.ts 同一套真持久化 harness：localStorage
 * 打桩、按测试重置模块，种子 blob 经 KVStore `account` scope 写入，走真实
 * rehydrate（含 migrate）路径。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserKVStore } from '@openmaic/storage';

const storage = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
  clear: () => void storage.clear(),
  key: () => null,
  length: 0,
};
vi.stubGlobal('localStorage', localStorageStub);
vi.stubGlobal('window', { localStorage: localStorageStub });

const persistKv = new BrowserKVStore({ storage: localStorageStub as unknown as Storage });

// Realistic v4 blob: existing users always carry an audio config. Without it
// the migrate ladder assigns getDefaultAudioConfig() over the blob, which
// would reset the clone fields before the v4→v5 flip and mask what this
// file is asserting.
const V4_AUDIO_CONFIG = {
  ttsProvidersConfig: { 'browser-native-tts': { enabled: false } },
  asrProvidersConfig: { 'browser-native': { enabled: true } },
};

async function freshStore(persistedState?: Record<string, unknown>, version = 5) {
  vi.resetModules();
  storage.clear();
  if (persistedState) {
    await persistKv.set('settings-storage', { state: persistedState, version }, 'account');
  }
  const { useSettingsStore } = await import('@/lib/store/settings');
  await useSettingsStore.persist.rehydrate();
  return useSettingsStore;
}

describe('克隆声音开关默认开启', () => {
  beforeEach(() => storage.clear());

  it('新用户默认开启，音色与 provider 留空待同步组件选择', async () => {
    const store = await freshStore();
    expect(store.getState().useMyCloneVoice).toBe(true);
    expect(store.getState().myCloneVoiceId).toBe('');
    expect(store.getState().myCloneVoiceProvider).toBe('');
  });

  it('v4 存档（旧默认 false）经 migrate 翻转为 true', async () => {
    const store = await freshStore(
      { ...V4_AUDIO_CONFIG, useMyCloneVoice: false, myCloneVoiceId: '', myCloneVoiceProvider: '' },
      4,
    );
    expect(store.getState().useMyCloneVoice).toBe(true);
  });

  it('v4 存档已选中的克隆音色在迁移后原样保留', async () => {
    const store = await freshStore(
      {
        ...V4_AUDIO_CONFIG,
        useMyCloneVoice: true,
        myCloneVoiceId: 'qwen-clone-1',
        myCloneVoiceProvider: 'qwen-tts',
      },
      4,
    );
    expect(store.getState().useMyCloneVoice).toBe(true);
    expect(store.getState().myCloneVoiceId).toBe('qwen-clone-1');
    expect(store.getState().myCloneVoiceProvider).toBe('qwen-tts');
  });

  it('v5 存档中用户主动关闭不会被翻回，音色保留', async () => {
    const store = await freshStore(
      {
        useMyCloneVoice: false,
        myCloneVoiceId: 'voxcpm:profile:abc',
        myCloneVoiceProvider: 'voxcpm-tts',
      },
      5,
    );
    expect(store.getState().useMyCloneVoice).toBe(false);
    expect(store.getState().myCloneVoiceId).toBe('voxcpm:profile:abc');
    expect(store.getState().myCloneVoiceProvider).toBe('voxcpm-tts');
  });
});
