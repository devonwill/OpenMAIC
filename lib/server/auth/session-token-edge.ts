import { isSessionIdValid, isSignatureFormatValid } from './session-token-shared';

function encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Edge 版验签（同 access-token-edge 的模式）：不查库，吊销交给 API 层。 */
export async function verifySessionTokenEdge(
  token: string,
  secret: string,
): Promise<string | null> {
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const sessionId = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!isSessionIdValid(sessionId) || !isSignatureFormatValid(signature)) return null;
  const key = await crypto.subtle.importKey(
    'raw',
    encode(secret).buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = bufToHex(
    await crypto.subtle.sign('HMAC', key, encode(sessionId).buffer as ArrayBuffer),
  );
  if (signature.length !== expected.length) return null;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i += 1) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0 ? sessionId : null;
}
