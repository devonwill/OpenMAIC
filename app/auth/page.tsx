'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useAuth } from '@/lib/hooks/use-auth';
import { cn } from '@/lib/utils';

type Mode = 'login' | 'register';
type Role = 'student' | 'teacher';

export default function AuthPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { refresh } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [role, setRole] = useState<Role>('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 按实际错误码 + HTTP 状态映射用户可读文案。
  // 后端错误码取值见 lib/server/api-response.ts：
  //   INVALID_CREDENTIALS(401 登录凭证错 / 403 教师邀请码错)、
  //   INVALID_REQUEST(400 表单校验 / 409 邮箱重复)、
  //   RATE_LIMITED(429，带 Retry-After 头)、INTERNAL_ERROR(500/503)。
  function mapError(status: number, errorCode: string | undefined, retryAfter: string | null): string {
    if (status === 429 || errorCode === 'RATE_LIMITED') {
      const seconds = Number(retryAfter) > 0 ? Number(retryAfter) : 60;
      return t('auth.errorRateLimited', { seconds });
    }
    if (status === 409) return t('auth.errorEmailTaken');
    if (status === 403) return t('auth.errorInviteCode');
    if (status === 401) return t('auth.errorInvalidCredentials');
    if (status === 400) return t('auth.errorInvalidRequest');
    // 500/503 及未知状态统一归为服务端异常，避免暴露内部细节
    return t('auth.errorServer');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (mode === 'register' && password !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setLoading(true);
    try {
      const url = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload =
        mode === 'login'
          ? { email, password }
          : {
              role,
              email,
              password,
              displayName,
              ...(phone ? { phone } : {}),
              ...(role === 'teacher' ? { inviteCode } : {}),
            };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(mapError(res.status, data?.errorCode, res.headers.get('Retry-After')));
        return;
      }
      await refresh();
      // 教师注册后直接回到首页，不在注册页停留做"配置大模型"引导——
      // 教师会在首次使用生成/工作台等依赖大模型的功能时，由 onFeatureUsed
      // 拦截器弹出系统设置对话框（延迟引导比注册时打断更友好）。
      router.push('/');
    } catch {
      setError(t('auth.errorNetwork'));
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-8">
        <div className="flex gap-2 mb-6">
          {(['login', 'register'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError('');
              }}
              className={cn(
                'flex-1 py-2 rounded-lg text-sm font-medium transition-colors',
                mode === m
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
              )}
            >
              {t(m === 'login' ? 'auth.loginTab' : 'auth.registerTab')}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === 'register' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {(['student', 'teacher'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={cn(
                        'rounded-lg border p-3 text-left transition-colors',
                        role === r
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950'
                          : 'border-gray-200 dark:border-gray-700'
                      )}
                    >
                      <div className="text-sm font-medium">
                        {t(r === 'student' ? 'auth.roleStudent' : 'auth.roleTeacher')}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {t(r === 'student' ? 'auth.roleStudentDesc' : 'auth.roleTeacherDesc')}
                      </div>
                    </button>
                  ))}
                </div>
                <input
                  className={inputClass}
                  placeholder={t('auth.displayName')}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  maxLength={32}
                />
                {role === 'teacher' && (
                  <input
                    className={inputClass}
                    placeholder={t('auth.inviteCode')}
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    required
                  />
                )}
              </>
            )}
            <input
              className={inputClass}
              type="email"
              placeholder={t('auth.email')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
              autoComplete="email"
            />
            <input
              className={inputClass}
              type="password"
              placeholder={t('auth.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'register' ? 8 : 1}
              maxLength={128}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
            {mode === 'register' && (
              <>
                <input
                  className={inputClass}
                  type="password"
                  placeholder={t('auth.confirmPassword')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                />
                <div>
                  <input
                    className={inputClass}
                    placeholder={t('auth.phone')}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    inputMode="numeric"
                    pattern="1[3-9][0-9]{9}"
                    maxLength={11}
                  />
                  <p className="text-xs text-gray-400 mt-1">{t('auth.phoneHint')}</p>
                </div>
                {role === 'student' && (
                  <div>
                    {/* 微信扫码注册置灰预留：不做真实集成，仅占位并提示「即将开放」 */}
                    <button
                      type="button"
                      disabled
                      className="w-full py-2 rounded-lg border border-green-500 text-green-600 text-sm opacity-50 cursor-not-allowed"
                    >
                      {t('auth.wechatRegister')}
                    </button>
                    <p className="text-xs text-gray-400 mt-1">{t('auth.wechatComingSoon')}</p>
                  </div>
                )}
              </>
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
            >
              {loading ? '…' : t(mode === 'login' ? 'auth.loginButton' : 'auth.registerButton')}
            </button>
          </form>

        <div className="mt-6 text-center space-y-1">
          {mode === 'login' ? (
            <>
              {/* 同页切换模式，用按钮而非 Link，避免同路由跳转导致多余导航 */}
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError('');
                }}
                className="text-xs text-gray-500 underline"
              >
                {t('auth.noAccount')}
              </button>
              <p className="text-xs text-gray-400">{t('auth.forgotPassword')}</p>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
              }}
              className="text-xs text-gray-500 underline"
            >
              {t('auth.hasAccount')}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
