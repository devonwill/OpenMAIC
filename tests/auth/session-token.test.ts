import { assert, describe, expect, it } from 'vitest';
import { createSessionToken, verifySessionToken } from '@/lib/server/auth/session-token';
import { verifySessionTokenEdge } from '@/lib/server/auth/session-token-edge';

const SECRET = 'a'.repeat(64);
const SESSION_ID = '0f0e0d0c-0b0a-4000-8000-000000000001';

describe('session token', () => {
  it('round-trips in Node', () => {
    const token = createSessionToken(SESSION_ID, SECRET);
    assert(token !== null);
    expect(verifySessionToken(token, SECRET)).toBe(SESSION_ID);
  });

  it('rejects a wrong secret', () => {
    const token = createSessionToken(SESSION_ID, SECRET);
    assert(token !== null);
    expect(verifySessionToken(token, 'b'.repeat(64))).toBeNull();
  });

  it('rejects non-uuid session ids', () => {
    expect(verifySessionToken(`not-a-uuid.${'a'.repeat(64)}`, SECRET)).toBeNull();
    expect(createSessionToken('nope', SECRET)).toBeNull();
  });

  it('rejects tampered signatures', () => {
    const token = createSessionToken(SESSION_ID, SECRET);
    assert(token !== null);
    expect(verifySessionToken(`${SESSION_ID}.${'0'.repeat(64)}`, SECRET)).toBeNull();
    expect(verifySessionToken(token.replace('.', '..x'), SECRET)).toBeNull();
  });

  it('Edge verifier agrees with the Node one', async () => {
    const token = createSessionToken(SESSION_ID, SECRET);
    assert(token !== null);
    expect(await verifySessionTokenEdge(token, SECRET)).toBe(SESSION_ID);
    expect(await verifySessionTokenEdge(token, 'c'.repeat(64))).toBeNull();
  });
});
