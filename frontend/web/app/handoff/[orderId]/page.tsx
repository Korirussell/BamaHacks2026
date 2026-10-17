'use client';
import { use, useState } from 'react';
import { motion } from 'framer-motion';
import { Star } from 'lucide-react';
import { toast } from 'sonner';
import { copy } from '@/lib/copy';
import { meetups, placeById } from '@/lib/data';
import { useDemo } from '@/lib/store';
import { RotatingQR, codeFor, tokenFor, useMinute } from '@/components/RotatingQR';
import { Pill, PillLink } from '@/components/ui';

export default function Handoff({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const { lockedMeetupId, handedOff, set, celebrate } = useDemo();
  const [role, setRole] = useState<'kayla' | 'kori'>('kayla');
  const [code, setCode] = useState('');
  const [stars, setStars] = useState(0);
  const { minute } = useMinute();
  const spot = meetups.find(m => m.id === lockedMeetupId) ?? meetups[0];
  const place = placeById(spot.place_id);

  const confirm = () => {
    set(s => ({ ...s, handedOff: true, order: { ...s.order, status: 'completed' } }));
    celebrate({ kind: 'touchdown', title: copy.celebrate.td, line: copy.celebrate.tdDone });
  };
  const tryCode = (v: string) => {
    setCode(v);
    if (v.length === 6) {
      const ok = [minute, minute - 1].some(m => codeFor(tokenFor(orderId, m)) === v);
      if (ok) confirm(); else toast("That code doesn't match. Ask Kayla to show it again.");
    }
  };

  return (
    <div className="mx-auto max-w-[620px]">
      <p className="label text-[11.5px] text-accent-text">{place.name} · {spot.start_label}</p>
      <h1 className="font-display mt-1 text-[30px] font-bold">Make the handoff</h1>

      <div role="tablist" className="mt-5 inline-flex rounded-full border-[2.5px] border-ink bg-card p-1 shadow-[3px_3px_0_var(--shadow)]">
        {(['kayla', 'kori'] as const).map(r => (
          <button key={r} role="tab" aria-selected={role === r} onClick={() => setRole(r)} className={`label rounded-full px-4 py-2 ${role === r ? 'bg-ink text-bg' : ''}`}>
            {r === 'kayla' ? "I'm Kayla (seller)" : "I'm Kori (buyer)"}
          </button>
        ))}
      </div>

      {handedOff ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="stk mt-8 rounded-[24px] bg-card p-6 text-center">
          <p className="text-5xl">🤝</p>
          <h2 className="font-display mt-3 text-[24px] font-bold">Handed off!</h2>
          <p className="mt-1 font-semibold text-soft">How was the trade with {role === 'kori' ? 'Kayla' : 'Kori'}?</p>
          <div className="mt-4 flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} aria-label={`${n} stars`} onClick={() => { setStars(n); toast('Thanks! Reliability updated.'); }}>
                <Star size={36} strokeWidth={2.2} className={n <= stars ? 'fill-[#FFD84D] text-ink' : 'text-soft'} />
              </button>
            ))}
          </div>
          <div className="mt-6 flex justify-center gap-3">
            <PillLink href="/feed" variant="neutral">Back to feed</PillLink>
            <Pill variant="neutral" onClick={() => set(s => ({ ...s, handedOff: false }))}>Run it again</Pill>
          </div>
        </motion.div>
      ) : role === 'kayla' ? (
        <div className="stk mt-8 rounded-[24px] bg-card p-6 text-center">
          <h2 className="font-display text-[22px] font-bold">{copy.qr.giver}</h2>
          <p className="mt-1 text-[13px] font-semibold text-soft">The code changes every minute so nobody can screenshot it.</p>
          <div className="mt-5"><RotatingQR orderId={orderId} /></div>
        </div>
      ) : (
        <div className="stk mt-8 rounded-[24px] bg-card p-6">
          <h2 className="font-display text-center text-[22px] font-bold">{copy.qr.receiver}</h2>
          <div className="relative mx-auto mt-5 aspect-square w-full max-w-[300px] overflow-hidden rounded-[20px] bg-[#1A1414]">
            {[['left-3 top-3', 'border-l-4 border-t-4'], ['right-3 top-3', 'border-r-4 border-t-4'], ['bottom-3 left-3', 'border-b-4 border-l-4'], ['bottom-3 right-3', 'border-b-4 border-r-4']].map(([pos, b]) => (
              <span key={pos} className={`absolute h-10 w-10 rounded-[6px] border-[#FFD84D] ${pos} ${b}`} />
            ))}
            <motion.span className="absolute inset-x-6 h-[3px] rounded-full bg-[#FFD84D]" animate={{ top: ['15%', '85%', '15%'] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }} />
            <p className="absolute inset-x-0 bottom-6 text-center text-[12px] font-bold text-white/70">Point at Kayla&apos;s QR</p>
          </div>
          <label className="mx-auto mt-5 block max-w-[300px]">
            <span className="label text-[11px] text-soft">Or type the 6-digit code</span>
            <input value={code} inputMode="numeric" maxLength={6} onChange={e => tryCode(e.target.value.replace(/\D/g, ''))} className="font-display mt-1.5 w-full rounded-full border-[2.5px] border-ink bg-bg px-4 py-3 text-center text-[24px] font-bold tracking-[0.3em] outline-none" placeholder="••••••" />
          </label>
          <Pill variant="butter" size="lg" className="mx-auto mt-5 flex w-full max-w-[300px]" onClick={confirm}>{copy.qr.override}</Pill>
          <p className="mt-3 text-center text-[12px] font-semibold text-soft">🔒 Kayla gets paid the second this confirms.</p>
        </div>
      )}
    </div>
  );
}
