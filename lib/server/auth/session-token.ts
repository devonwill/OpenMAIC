import { createHmac, timingSafeEqual } from 'node:crypto';
import { isSessionIdValid, isSignatureFormatValid } from './session-token-shared';

/** 签发 `{sessionId}.{hmac}`；sessionId 非法返回 null（不签垃圾）。 */
export function createSessionToken(sessionId: string, secret: string): string | null {
  if (!isSessionIdValid(sessionId)) return null;
  const signature = createHmac('sha256', secret).update(sessionId).digest('hex');
  return `${sessionId}.${signature}`;
}

/** 验签并返回 sessionId，失败返回 null。 */
export function verifySessionToken(token: string, secret: string): string | null {
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const sessionId = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!isSessionIdValid(sessionId) || !isSignatureFormatValid(signature)) return null;
  const expected = createHmac('sha256', secret).update(sessionId).digest('hex');
  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b) ? sessionId : null;
}
