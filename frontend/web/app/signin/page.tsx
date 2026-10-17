'use client';
// Demo sign-in: one tap per seeded persona, no email code (backend DEMO_AUTH=on, POST /demo/login).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { USE_MOCKS, demoLogin } from '@/lib/api';
import { Pill, StickerCard } from '@/components/ui';

const PERSONAS = [
  ['Jordan (student)', 'bamahacks.student@crimson.ua.edu'],
  ['Ava (tutor, seller)', 'bamahacks.ava@crimson.ua.edu'],
  ['Buyer', 'bamahacks.buyer@crimson.ua.edu'],
] as const;

export default function SignIn() {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  if (USE_MOCKS) return <p className="mx-auto max-w-md py-10 text-center font-semibold text-soft">Sign-in is only used in real mode. The demo needs no account.</p>;

  const signIn = async (email: string) => {
    setBusy(email); setErr('');
    try { await demoLogin(email); router.replace('/feed'); } catch (e) { setErr((e as Error).message); setBusy(''); }
  };

  return (
    <div className="mx-auto max-w-md py-8">
      <StickerCard className="p-6">
        <h1 className="font-display text-[24px] font-bold">Sign in</h1>
        <p className="mt-1 text-[14px] font-semibold text-soft">Demo mode: pick who you are.</p>
        <div className="mt-5 space-y-3">
          {PERSONAS.map(([label, email]) => (
            <Pill key={email} className="w-full" disabled={!!busy} onClick={() => void signIn(email)}>{busy === email ? 'Signing in…' : label}</Pill>
          ))}
        </div>
        {err && <p className="mt-4 text-[13px] font-bold text-accent-text">{err}</p>}
      </StickerCard>
    </div>
  );
}
