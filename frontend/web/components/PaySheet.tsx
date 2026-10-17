'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Lock } from 'lucide-react';
import { useState } from 'react';
import { money } from '@/lib/money';
import { Pill } from './ui';

/** Fake checkout (1.2 s processing). Fee = 5%. */
export function PaySheet({ open, amount, onClose, onPaid }: { open: boolean; amount: number; onClose: () => void; onPaid: () => void | Promise<void> }) {
  const [paying, setPaying] = useState(false);
  const fee = Math.round(amount * 0.05);
  const pay = async () => {
    setPaying(true);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await onPaid();
    setPaying(false);
  };
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button aria-label="Close" className="absolute inset-0 bg-[#1A1414]/50" onClick={() => !paying && onClose()} />
          <motion.div role="dialog" aria-modal="true" aria-label="Checkout" initial={{ y: 400 }} animate={{ y: 0 }} exit={{ y: 500 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }} className="relative w-full max-w-[440px] rounded-t-[28px] border-[2.5px] border-ink bg-card p-6 pb-8 shadow-[5px_5px_0_var(--shadow)] sm:rounded-[28px]">
            <h2 className="font-display text-[21px] font-bold">Checkout</h2>
            <dl className="mt-4 space-y-2 text-[15px] font-semibold">
              <div className="flex justify-between"><dt>Item</dt><dd>{money(amount, true)}</dd></div>
              <div className="flex justify-between text-soft"><dt>Service fee</dt><dd>{money(fee, true)}</dd></div>
              <div className="flex justify-between border-t-2 border-dashed border-ink/40 pt-2 text-[17px] font-extrabold"><dt>Total</dt><dd>{money(amount + fee, true)}</dd></div>
            </dl>
            <p className="mt-4 flex items-center gap-2 rounded-[14px] bg-mint px-3 py-2 text-[13px] font-bold text-dark-ink"><Lock size={14} /> Held until it&apos;s in your hands.</p>
            <button onClick={() => void pay()} disabled={paying} className="stk-btn mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-[#1A1414] px-5 py-3.5 text-[15px] font-extrabold text-white dark:border-white">
              {paying ? <Loader2 size={18} className="animate-spin" /> : <>Pay with  Pay</>}
            </button>
            <Pill variant="neutral" className="mt-3 w-full" onClick={() => void pay()} disabled={paying}>Pay with card</Pill>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
