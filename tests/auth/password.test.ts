import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/server/auth/password';

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('salts every hash differently', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects malformed hashes without throwing', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});
