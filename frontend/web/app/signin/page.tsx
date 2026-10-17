'use client';
// Real mode only: email → 6-8 digit code (Supabase OTP length setting) Demo personas have no inbox: get a code with `pnpm seed:demo otp <persona>`, then use "I already have a code".
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { USE_MOCKS } from '@/lib/api';
import { supabase } from '@/lib/real';
import { Pill, StickerCard } from '@/components/ui';

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (USE_MOCKS) return <p className="mx-auto max-w-md py-10 text-center font-semibold text-soft">Sign-in is only used in real mode. The demo needs no account.</p>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const auth = supabase().auth;
    const { error } = step === 'email'
      ? await auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } })
      : await auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) return setErr(error.message);
    if (step === 'email') setStep('code');
    else router.replace('/feed');
  };

  return (
    <div className="mx-auto max-w-md py-8">
      <StickerCard className="p-6">
        <h1 className="font-display text-[24px] font-bold">Sign in</h1>
        <p className="mt-1 text-[14px] font-semibold text-soft">{step === 'email' ? 'Use your campus email. We will send a sign-in code.' : `Enter the code sent to ${email}.`}</p>
        <form onSubmit={submit} className="mt-5 space-y-4">
          {step === 'email' ? (
            <input type="email" required autoFocus value={email} onChange={e => setEmail(e.target.value)} placeholder="you@crimson.ua.edu" aria-label="Email" className="w-full rounded-full border-[2.5px] border-ink bg-card px-4 py-3 text-[15px] font-medium outline-none" />
          ) : (
            <input inputMode="numeric" pattern="[0-9]{6,8}" maxLength={8} required autoFocus value={code} onChange={e => setCode(e.target.value)} placeholder="123456" aria-label="Sign-in code" className="w-full rounded-full border-[2.5px] border-ink bg-card px-4 py-3 text-center text-[20px] font-bold tracking-[0.4em] outline-none" />
          )}
          {err && <p role="alert" className="text-[13px] font-bold text-accent-text">{err}</p>}
          <Pill type="submit" className="w-full" disabled={busy}>{busy ? 'One sec…' : step === 'email' ? 'Send code' : 'Sign in'}</Pill>
          {step === 'email' && <button type="button" onClick={() => { if (email.trim()) { setStep('code'); setErr(''); } else setErr('Enter your email first'); }} className="w-full text-center text-[13px] font-semibold text-soft hover:text-ink">I already have a code</button>}
          {step === 'code' && <button type="button" onClick={() => { setStep('email'); setCode(''); setErr(''); }} className="w-full text-center text-[13px] font-semibold text-soft hover:text-ink">Use a different email</button>}
        </form>
      </StickerCard>
    </div>
  );
}
