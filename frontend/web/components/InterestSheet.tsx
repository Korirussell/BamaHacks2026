'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { Minus, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { copy } from '@/lib/copy';
import { money } from '@/lib/money';
import { useDemo } from '@/lib/store';
import type { Listing } from '@/lib/types';
import { Pill } from './ui';

export function InterestSheet({ listing, onClose }: { listing: Listing | null; onClose: () => void }) {
  const { addInterest } = useDemo();
  const [amount, setAmount] = useState(20000);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (listing) { setAmount(listing.price_cents); setMsg(''); }
  }, [listing]);
  useEffect(() => {
    if (!listing) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [listing, onClose]);
  const handle = listing?.source.author_handle ?? '@seller';
  return (
    <AnimatePresence>
      {listing && (
        <motion.div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button aria-label="Close" className="absolute inset-0 bg-[#1A1414]/50" onClick={onClose} />
          <motion.form
            role="dialog"
            aria-modal="true"
            aria-label="I want this"
            onSubmit={async e => {
              e.preventDefault();
              try { await addInterest(listing.id, amount, msg); toast(copy.ghost.toast); onClose(); }
              catch (error) { toast.error(error instanceof Error ? error.message : 'Could not make offer'); }
            }}
            className="relative w-full max-w-[460px] rounded-t-[28px] border-[2.5px] border-ink bg-card p-6 pb-8 shadow-[5px_5px_0_var(--shadow)] sm:rounded-[28px]"
            initial={{ y: 400 }}
            animate={{ y: 0 }}
            exit={{ y: 500 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          >
            <div className="mx-auto -mt-2 mb-4 h-1.5 w-12 rounded-full bg-ink/25 sm:hidden" />
            <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-full p-1.5 hover:bg-sunk"><X size={20} /></button>
            <p className="label text-[11.5px] text-accent-text">🔥 {listing.interest?.count ?? 0} people want this</p>
            <h2 className="font-display mt-1 text-[21px] font-bold">{listing.title}</h2>

            <div className="mt-5 flex items-center justify-between rounded-full border-[2.5px] border-ink bg-bg p-1.5">
              <button type="button" aria-label="Lower offer" onClick={() => setAmount(a => Math.max(500, a - 500))} className="press flex h-11 w-11 items-center justify-center rounded-full border-2 border-ink bg-card shadow-[2px_2px_0_var(--shadow)]"><Minus size={18} strokeWidth={2.6} /></button>
              <span className="font-display text-[30px] font-bold tabular-nums" aria-live="polite">{money(amount)}</span>
              <button type="button" aria-label="Raise offer" onClick={() => setAmount(a => a + 500)} className="press flex h-11 w-11 items-center justify-center rounded-full border-2 border-ink bg-card shadow-[2px_2px_0_var(--shadow)]"><Plus size={18} strokeWidth={2.6} /></button>
            </div>

            <label className="mt-4 block">
              <span className="label text-[11px] text-soft">Message (optional)</span>
              <input value={msg} onChange={e => setMsg(e.target.value)} placeholder="Can meet after class" className="mt-1.5 w-full rounded-full border-[2.5px] border-ink bg-card px-4 py-3 text-[15px] font-medium outline-none placeholder:text-soft focus:shadow-[3px_3px_0_var(--shadow)]" />
            </label>

            <Pill type="submit" variant="butter" className="mt-5 w-full">I want this · {money(amount)}</Pill>
            <p className="mt-3 text-center text-[12.5px] font-semibold text-soft">We&apos;ll DM {handle} · {copy.ghost.fineprint.split('. ')[1]}</p>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
