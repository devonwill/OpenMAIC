import { describe, expect, it } from 'vitest';
import {
  ASR_NOT_CONFIGURED_MESSAGE,
  toChineseAsrError,
} from '@/lib/audio/asr-error-message';

describe('toChineseAsrError', () => {
  it.each([
    // Plan Task 14 Step 2 — five canonical cases.
    [
      'No enabled ASR provider is configured',
      '未配置可用的语音识别服务，请在设置中选择',
    ],
    ['Invalid API Key', '语音识别服务鉴权失败（API Key 无效）'],
    [
      'Xiaomi MiMo ASR API error (404)',
      '语音识别模型或接口不可用，请检查 ASR 模型设置',
    ],
    ['audio format', '音频格式不被支持，请重试'],
    ['其它', '其它'],
    // Added: 403 must be treated as an auth failure, not a model/endpoint one.
    [
      'Forbidden (403): token is not allowed to call this API',
      '语音识别服务鉴权失败（API Key 无效）',
    ],
  ])('%s → %s', (input, expected) => {
    expect(toChineseAsrError(input)).toBe(expected);
  });

  it('maps the real MiMo upstream 400 audio-format payload', () => {
    const raw =
      'Xiaomi MiMo ASR API error (400): {"error":{"code":"400","message":"Param Incorrect","param":"invalid audio format, only mp3/flac/m4a/wav/ogg are supported","type":""}}';
    expect(toChineseAsrError(raw)).toBe('音频格式不被支持，请重试');
  });

  it('maps 401 responses to the auth message', () => {
    expect(toChineseAsrError('Upstream returned 401 Unauthorized')).toBe(
      '语音识别服务鉴权失败（API Key 无效）',
    );
  });

  it('maps 405 / model-not-found responses to the model message', () => {
    expect(toChineseAsrError('MiMo ASR API error (405): Method Not Allowed')).toBe(
      '语音识别模型或接口不可用，请检查 ASR 模型设置',
    );
    expect(toChineseAsrError('model not found: mimo-v2.5-asrr')).toBe(
      '语音识别模型或接口不可用，请检查 ASR 模型设置',
    );
  });

  it('maps a missing client/server API key to the not-configured message', () => {
    expect(toChineseAsrError('API key required for ASR provider: xiaomi-asr')).toBe(
      ASR_NOT_CONFIGURED_MESSAGE,
    );
  });

  it('passes already-Chinese messages and blank input through untouched', () => {
    expect(toChineseAsrError('语音识别失败，请重试')).toBe('语音识别失败，请重试');
    expect(toChineseAsrError('')).toBe('');
  });
});
