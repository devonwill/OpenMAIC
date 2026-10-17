import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM 静态加密。格式 `v1.{iv}.{tag}.{ciphertext}`（各段 base64）。
// tag 是 GCM 的认证标签：篡改任何一段解密都会抛错，无需另行校验。

function parseKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to 32 bytes (base64)');
  }
  return key;
}

export function encryptSecret(plaintext: string, base64Key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', parseKey(base64Key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
}

export function decryptSecret(sealed: string, base64Key: string): string {
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('malformed sealed secret');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    parseKey(base64Key),
    Buffer.from(parts[1], 'base64'),
  );
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[3], 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
