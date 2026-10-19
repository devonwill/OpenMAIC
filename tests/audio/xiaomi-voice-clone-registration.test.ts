import { afterEach, describe, expect, it } from 'vitest';

import { XIAOMI_TTS_VOICE_CLONE_MODEL } from '@/lib/audio/constants';
import { QwenVoiceCloneError } from '@/lib/audio/qwen-voice-clone';
import { InvalidReferenceAudioError } from '@/lib/audio/wav-validate';
import {
  readXiaomiVoiceReferenceDataUrl,
  removeXiaomiVoiceReferenceForTests,
  xiaomiVoiceCloneRegistrationAdapter,
} from '@/lib/audio/xiaomi-voice-clone-registration';

// The stateless clone model has no server-side voice registry, so the adapter
// persists the validated reference clip locally — these tests round-trip it
// through the real filesystem (`data/voice-refs/xiaomi/`, gitignored).
function pcmWav(seconds = 1): Uint8Array {
  const dataBytes = 24_000 * seconds * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24_000, true);
  view.setUint32(28, 48_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return bytes;
}

const cfg = { baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', apiKey: 'k' };
const VOICE_ID = 'vitest_xiaomi_clone';
const base64Of = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

afterEach(async () => {
  await removeXiaomiVoiceReferenceForTests(VOICE_ID);
  await removeXiaomiVoiceReferenceForTests(`${VOICE_ID}_missing`);
  await removeXiaomiVoiceReferenceForTests('../escape');
});

describe('xiaomi voice-clone registration', () => {
  it('reports registration support with a fixed clone model', () => {
    expect(xiaomiVoiceCloneRegistrationAdapter.supportsRegistration()).toBe(true);
    // A real reference sample is mandatory; there is no design-time bootstrap.
    expect(xiaomiVoiceCloneRegistrationAdapter.supportsBootstrapReferenceClip).toBe(false);
    expect(
      xiaomiVoiceCloneRegistrationAdapter.resolveRegistrationModel('mimo-v2.5-tts'),
    ).toBe(XIAOMI_TTS_VOICE_CLONE_MODEL);
    expect(xiaomiVoiceCloneRegistrationAdapter.resolveRegistrationModel()).toBe(
      XIAOMI_TTS_VOICE_CLONE_MODEL,
    );
  });

  it('persists the validated reference clip and reads it back as a DataURL', async () => {
    const wav = pcmWav();
    const encoded = base64Of(wav);

    const id = await xiaomiVoiceCloneRegistrationAdapter.registerVoice(cfg, {
      voiceId: VOICE_ID,
      referenceAudioBase64: encoded,
      mimeType: 'audio/wav',
      refText: '参考文本',
    });

    expect(id).toBe(VOICE_ID);
    expect(await xiaomiVoiceCloneRegistrationAdapter.voiceExists(cfg, VOICE_ID)).toBe(true);
    expect(await readXiaomiVoiceReferenceDataUrl(VOICE_ID)).toBe(`data:audio/wav;base64,${encoded}`);
  });

  it('answers unknown voices from the local store', async () => {
    expect(await xiaomiVoiceCloneRegistrationAdapter.voiceExists(cfg, `${VOICE_ID}_missing`)).toBe(
      false,
    );
    expect(await readXiaomiVoiceReferenceDataUrl(`${VOICE_ID}_missing`)).toBeUndefined();
  });

  it('rejects reference audio that is not a valid 24 kHz mono WAV', async () => {
    await expect(
      xiaomiVoiceCloneRegistrationAdapter.registerVoice(cfg, {
        voiceId: VOICE_ID,
        referenceAudioBase64: base64Of(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
      }),
    ).rejects.toThrow(InvalidReferenceAudioError);
    expect(await xiaomiVoiceCloneRegistrationAdapter.voiceExists(cfg, VOICE_ID)).toBe(false);
  });

  it('keeps path-traversal voice ids inside the reference directory', async () => {
    const wav = pcmWav();
    await xiaomiVoiceCloneRegistrationAdapter.registerVoice(cfg, {
      voiceId: '../escape',
      referenceAudioBase64: base64Of(wav),
    });
    expect(await xiaomiVoiceCloneRegistrationAdapter.voiceExists(cfg, '../escape')).toBe(true);
    expect(await readXiaomiVoiceReferenceDataUrl('../escape')).toBe(
      `data:audio/wav;base64,${base64Of(wav)}`,
    );
  });

  it('refuses design bootstrap — the provider needs a real sample', async () => {
    await expect(
      xiaomiVoiceCloneRegistrationAdapter.bootstrapReferenceClip(cfg, {
        design: { identity: 'teacher', texture: 'warm', delivery: 'calm' },
      }),
    ).rejects.toMatchObject({
      code: 'QWEN_VC_BOOTSTRAP_UNSUPPORTED',
      httpStatus: 400,
    });
    await expect(
      xiaomiVoiceCloneRegistrationAdapter.bootstrapReferenceClip(cfg, {
        design: { identity: 'teacher', texture: 'warm', delivery: 'calm' },
      }),
    ).rejects.toBeInstanceOf(QwenVoiceCloneError);
  });
});
