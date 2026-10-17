import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

// N=16384/r=8/p=1 是 OWASP 对 scrypt 的最低推荐档；16 字节盐 + 32 字节派生键。
// 格式 `salt$hash`（hex），校验用 timingSafeEqual 防时序侧信道。
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 32);
  return `${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const dollarIndex = stored.indexOf('$');
  if (dollarIndex !== 32) return false;
  const saltHex = stored.slice(0, dollarIndex);
  const hashHex = stored.slice(dollarIndex + 1);
  if (!/^[0-9a-f]{64}$/.test(hashHex) || !/^[0-9a-f]{32}$/.test(saltHex)) return false;
  const derived = await scryptAsync(password, Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
