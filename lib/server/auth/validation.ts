import type { UserRole } from './store';

export interface RegistrationInput {
  role: UserRole;
  email: string;
  password: string;
  displayName: string;
  phone: string | null;
  inviteCode: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^1[3-9]\d{9}$/;

/** 返回错误消息（英文短句，与现有 apiError 文案风格一致）；合法返回 null。 */
export function validateRegistration(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return 'request body must be a JSON object';
  const { role, email, password, displayName, phone, inviteCode } = body as Record<string, unknown>;
  if (role !== 'teacher' && role !== 'student') return 'role must be teacher or student';
  if (typeof email !== 'string' || !EMAIL_RE.test(email) || email.length > 254) {
    return 'a valid email is required';
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return 'password must be 8-128 characters';
  }
  if (typeof displayName !== 'string' || displayName.trim().length === 0 || displayName.trim().length > 32) {
    return 'displayName must be 1-32 characters';
  }
  if (phone !== undefined && phone !== null && phone !== '') {
    if (typeof phone !== 'string' || !PHONE_RE.test(phone)) return 'phone must be a valid Chinese mobile number';
  }
  if (inviteCode !== undefined && inviteCode !== null && typeof inviteCode !== 'string') {
    return 'inviteCode must be a string';
  }
  return null;
}

export function toRegistrationInput(body: Record<string, unknown>): RegistrationInput {
  const phone = body.phone;
  return {
    role: body.role as UserRole,
    email: body.email as string,
    password: body.password as string,
    displayName: (body.displayName as string).trim(),
    phone: typeof phone === 'string' && phone !== '' ? phone : null,
    inviteCode: typeof body.inviteCode === 'string' && body.inviteCode !== '' ? body.inviteCode : null,
  };
}
