/**
 * ASR error message localization.
 *
 * The transcription route returns the upstream failure verbatim in the
 * `details` field of its error JSON (see app/api/transcription/route.ts).
 * Those strings are English vendor text ("Invalid API Key", HTTP status
 * numbers, "invalid audio format", …) and useless to end users. This mapper
 * turns the known failure classes into Chinese guidance; anything unmatched
 * is returned unchanged so novel upstream errors stay diagnosable instead of
 * being hidden behind a generic message.
 */

export const ASR_NOT_CONFIGURED_MESSAGE = '未配置可用的语音识别服务，请在设置中选择';
export const ASR_AUTH_FAILED_MESSAGE = '语音识别服务鉴权失败（API Key 无效）';
export const ASR_MODEL_UNAVAILABLE_MESSAGE = '语音识别模型或接口不可用，请检查 ASR 模型设置';
export const ASR_FORMAT_UNSUPPORTED_MESSAGE = '音频格式不被支持，请重试';

interface AsrErrorRule {
  pattern: RegExp;
  message: string;
}

// Order matters: the first matching rule wins. In particular, 401/403 must be
// classified as auth failures before the broader model/endpoint rule runs, and
// a missing local API key reads as "not configured", not "invalid key".
const ERROR_RULES: AsrErrorRule[] = [
  // No backend at all: route MISSING_PROVIDER, client preflight, or a
  // provider that requires a key while neither client nor server has one.
  {
    pattern: /no enabled asr provider|not?\s+configured|api key required|未配置/i,
    message: ASR_NOT_CONFIGURED_MESSAGE,
  },
  // Upstream/key auth failures.
  {
    pattern: /invalid[ _-]?api[ _-]?key|unauthori[sz]ed|forbidden|\b401\b|\b403\b/i,
    message: ASR_AUTH_FAILED_MESSAGE,
  },
  // Wrong model id, missing route, or wrong HTTP method.
  {
    pattern: /\b404\b|\b405\b|model(?:\s+not)?\s*(?:not\s+)?(?:found|exist|unavailable)/i,
    message: ASR_MODEL_UNAVAILABLE_MESSAGE,
  },
  // Rejected audio container/codec (e.g. webm sent to a wav-only endpoint).
  {
    pattern: /audio format|invalid[ _-]?format|unsupported[ _-]?format|format/i,
    message: ASR_FORMAT_UNSUPPORTED_MESSAGE,
  },
];

/**
 * Map a raw ASR error string to a user-facing Chinese message.
 * Returns the input untouched when no known pattern matches.
 */
export function toChineseAsrError(raw: string): string {
  if (!raw) return raw;
  for (const rule of ERROR_RULES) {
    if (rule.pattern.test(raw)) return rule.message;
  }
  return raw;
}
