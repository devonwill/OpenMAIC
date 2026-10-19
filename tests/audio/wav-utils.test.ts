import { describe, expect, it } from 'vitest';
import { audioBlobToWav, isWavBlob, normalizeASRUploadAudio } from '@/lib/audio/wav-utils';

describe('isWavBlob', () => {
  it('detects audio/wav MIME type', () => {
    const blob = new Blob([new Uint8Array(4)], { type: 'audio/wav' });
    expect(isWavBlob(blob)).toBe(true);
  });

  it('detects audio/x-wav MIME type', () => {
    const blob = new Blob([new Uint8Array(4)], { type: 'audio/x-wav' });
    expect(isWavBlob(blob)).toBe(true);
  });

  it('detects .wav file extension when MIME is missing', () => {
    const blob = new Blob([new Uint8Array(4)]);
    expect(isWavBlob(blob, 'recording.wav')).toBe(true);
    expect(isWavBlob(blob, 'recording.WAV')).toBe(true);
  });

  it('returns false for non-WAV blobs without a wav filename', () => {
    const blob = new Blob([new Uint8Array(4)], { type: 'audio/webm' });
    expect(isWavBlob(blob)).toBe(false);
    expect(isWavBlob(blob, 'recording.webm')).toBe(false);
  });
});

describe('normalizeASRUploadAudio', () => {
  it('passes through providers without WAV normalization unchanged', async () => {
    const input = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
    const result = await normalizeASRUploadAudio('openai-whisper', input);
    expect(result.blob).toBe(input);
    expect(result.fileName).toBe('recording.webm');
  });

  it('keeps WAV blobs unchanged for lemonade-asr', async () => {
    const input = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });
    const result = await normalizeASRUploadAudio('lemonade-asr', input);
    expect(result.blob).toBe(input);
    expect(result.fileName).toBe('recording.wav');
  });

  it('keeps WAV blobs unchanged for funasr-asr', async () => {
    const input = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });
    const result = await normalizeASRUploadAudio('funasr-asr', input);
    expect(result.blob).toBe(input);
    expect(result.fileName).toBe('recording.wav');
  });

  it('normalizes xiaomi-asr uploads to WAV (webm recordings are rejected upstream)', async () => {
    const wavInput = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });
    const wavResult = await normalizeASRUploadAudio('xiaomi-asr', wavInput);
    expect(wavResult.blob).toBe(wavInput);
    expect(wavResult.fileName).toBe('recording.wav');

    // Non-WAV input routes through the WAV converter rather than being
    // uploaded as the MediaRecorder webm container.
    const webmInput = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
    // In node there is no AudioContext, so conversion must fail loudly with
    // the browser-required error rather than silently passing webm through.
    await expect(audioBlobToWav(webmInput)).rejects.toThrow(/browser/i);
  });
});
