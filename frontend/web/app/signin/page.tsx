'use client';
// Real mode only. Two ways in: email → 6-8 digit code (Supabase OTP length setting), or email +
// password (accounts that have one, e.g. demo personas set with `pnpm demo:password <persona>`).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { USE_MOCKS } from '@/lib/api';
import { supabase } from '@/lib/real';
import { Pill, StickerCard } from '@/components/ui';

const field = 'w-full rounded-full border-[2.5px] border-ink bg-card px-4 py-3 text-[15px] font-medium outline-none';
const link = 'w-full text-center text-[13px] font-semibold text-soft hover:text-ink';

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'email' | 'code' | 'password'>('email');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (USE_MOCKS) return <p className="mx-auto max-w-md py-10 text-center font-semibold text-soft">Sign-in is only used in real mode. The demo needs no account.</p>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const auth = supabase().auth;
    const { error } = step === 'email'
      ? await auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } })
      : step === 'code'
        ? await auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
        : await auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setErr(error.message);
    if (step === 'email') setStep('code');
    else router.replace('/feed');
  };

  const back = () => { setStep('email'); setCode(''); setPassword(''); setErr(''); };
  const subtitle = step === 'email' ? 'Use your campus email. We will send a sign-in code.'
    : step === 'code' ? `Enter the code sent to ${email}.`
      : 'Sign in with your email and password.';

  return (
    <div className="mx-auto max-w-md py-8">
      <StickerCard className="p-6">
        <h1 className="font-display text-[24px] font-bold">Sign in</h1>
        <p className="mt-1 text-[14px] font-semibold text-soft">{subtitle}</p>
        <form onSubmit={submit} className="mt-5 space-y-4">
          {step !== 'code' && (
            <input type="email" required autoFocus={step === 'email'} autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@crimson.ua.edu" aria-label="Email" className={field} />
          )}
          {step === 'code' && (
            <input inputMode="numeric" pattern="[0-9]{6,8}" maxLength={8} required autoFocus value={code} onChange={e => setCode(e.target.value)} placeholder="123456" aria-label="Sign-in code" className={`${field} text-center text-[20px] font-bold tracking-[0.4em]`} />
          )}
          {step === 'password' && (
            <input type="password" required autoFocus autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" aria-label="Password" className={field} />
          )}
          {err && <p role="alert" className="text-[13px] font-bold text-accent-text">{err}</p>}
          <Pill type="submit" className="w-full" disabled={busy}>{busy ? 'One sec…' : step === 'email' ? 'Send code' : 'Sign in'}</Pill>
          {step === 'email' && (
            <>
              <button type="button" onClick={() => { setStep('password'); setErr(''); }} className={link}>Use a password instead</button>
              <button type="button" onClick={() => { if (email.trim()) { setStep('code'); setErr(''); } else setErr('Enter your email first'); }} className={link}>I already have a code</button>
            </>
          )}
          {step !== 'email' && <button type="button" onClick={back} className={link}>{step === 'code' ? 'Use a different email' : 'Email me a code instead'}</button>}
        </form>
      </StickerCard>
    </div>
  );
}
