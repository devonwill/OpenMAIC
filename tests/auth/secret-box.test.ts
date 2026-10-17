import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '@/lib/server/auth/secret-box';

const KEY = Buffer.alloc(32, 7).toString('base64'); // 32 字节测试密钥

describe('secret box (AES-256-GCM)', () => {
  it('round-trips a string', () => {
    const sealed = encryptSecret('sk-very-secret', KEY);
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain('sk-very-secret');
    expect(decryptSecret(sealed, KEY)).toBe('sk-very-secret');
  });

  it('uses a fresh IV every time', () => {
    expect(encryptSecret('x', KEY)).not.toBe(encryptSecret('x', KEY));
  });

  it('fails on tampered ciphertext', () => {
    const sealed = encryptSecret('x', KEY);
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tamper').toString('base64');
    expect(() => decryptSecret(parts.join('.'), KEY)).toThrow();
  });

  it('fails with wrong key', () => {
    const other = Buffer.alloc(32, 9).toString('base64');
    expect(() => decryptSecret(encryptSecret('x', KEY), other)).toThrow();
  });
});
