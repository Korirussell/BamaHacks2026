'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { USE_MOCKS, demoLogin, demoLogout, demoSession } from '@/lib/api';

const PERSONAS = [
  ['Student', 'bamahacks.student@crimson.ua.edu'],
  ['Ava', 'bamahacks.ava@crimson.ua.edu'],
  ['Buyer', 'bamahacks.buyer@crimson.ua.edu'],
] as const;

export function DemoLoginPicker() {
  const [active, setActive] = useState(() => demoSession()?.email ?? '');
  const [pending, setPending] = useState(false);
  if (USE_MOCKS) return null;
  const login = async (email: string) => {
    setPending(true);
    try { await demoLogin(email); setActive(email); toast(`Live demo: ${email.split('@')[0]}`); window.location.reload(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Demo login failed'); }
    finally { setPending(false); }
  };
  return (
    <div className="fixed right-4 top-4 z-[70] flex items-center gap-1 rounded-full border-2 border-ink bg-butter p-1 text-[11px] font-extrabold text-dark-ink shadow-[2px_2px_0_var(--shadow)]">
      {PERSONAS.map(([label, email]) => <button key={email} disabled={pending} onClick={() => void login(email)} className={`rounded-full px-2 py-1 ${active === email ? 'bg-ink text-bg' : ''}`}>{label}</button>)}
      {active && <button onClick={() => { demoLogout(); setActive(''); }} className="rounded-full px-2 py-1">×</button>}
    </div>
  );
}
