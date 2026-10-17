'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Send, ShieldAlert, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { aiStatus, haggle, type AiStatus, type HaggleRes, type HaggleTurn } from '@/lib/ai';
import { money } from '@/lib/money';
import type { Listing } from '@/lib/types';
import { Pill } from './ui';

// Haggle with the seller's agent. JEV-9B (on the laptop) reads each message and answers typed questions;
// a fixed price rule picks the counter, so the seller's floor is never crossed. "Why" shows JEV's odds.

const ACTION: Record<HaggleRes['action'], { label: string; cls: string }> = {
  accept: { label: 'Deal', cls: 'bg-mint' },
  counter: { label: 'Counter', cls: 'bg-butter' },
  hold_firm: { label: 'Firm', cls: 'bg-peach' },
  reply: { label: 'Reply', cls: 'bg-sunk' },
  warn: { label: 'Safety', cls: 'bg-[#FFB4B4]' },
  ignore: { label: 'Ignored', cls: 'bg-sunk' },
};
const LABEL: Record<string, string> = {
  intent: 'What the message is doing', seriousness: 'Buyer seriousness (0–5)', lowball: 'Lowball?',
  off_platform_payment: 'Pay outside the app?', urgency_pressure: 'Pressure to rush?', meetup_change: 'Odd meetup / shipping?', phishing: 'Phishing?',
};

type Msg = HaggleTurn & { res?: HaggleRes };

function Why({ res }: { res: HaggleRes }) {
  const [open, setOpen] = useState(false);
  if (!res.decisions) return null;
  return (
    <div className="mt-1.5">
      <button type="button" onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-1 text-[11.5px] font-extrabold text-soft hover:text-ink">
        Why (JEV-9B) <ChevronDown size={13} className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 rounded-[14px] border-2 border-ink bg-bg p-2.5">
          {Object.entries(res.decisions).map(([k, d]) => {
            const pct = k === 'seriousness' ? d.value / 5 : k === 'intent' ? d.value : d.value;
            return (
              <div key={k}>
                <div className="flex justify-between gap-2 text-[11px] font-semibold"><span>{LABEL[k] ?? k}</span><span className="tabular-nums">{k === 'intent' ? d.pick : k === 'seriousness' ? d.value.toFixed(1) : `${Math.round(d.value * 100)}%`}</span></div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-sunk"><div className={`h-full ${pct >= 0.7 && k !== 'intent' && k !== 'seriousness' ? 'bg-accent' : 'bg-mint'}`} style={{ width: `${Math.round(pct * 100)}%` }} /></div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function HaggleSheet({ listing, onClose }: { listing: Listing | null; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastCounter, setLastCounter] = useState<number | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!listing) return;
    setMsgs([{ from: 'seller', text: `Hey! It's ${money(listing.price_cents)}. Make me an offer.` }]);
    setText(''); setLastCounter(null);
    aiStatus().then(setStatus);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [listing, onClose]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  const send = async () => {
    if (!listing || !text.trim() || busy) return;
    const message = text.trim();
    const history = msgs.map(({ from, text }) => ({ from, text }));
    setMsgs(m => [...m, { from: 'buyer', text: message }]);
    setText(''); setBusy(true);
    try {
      const res = await haggle(listing.id, { message, history, last_counter_cents: lastCounter }, listing.price_cents);
      if ((res.action === 'counter' || res.action === 'hold_firm') && res.price_cents !== null) setLastCounter(res.price_cents);
      if (res.action !== 'ignore') setMsgs(m => [...m, { from: 'seller', text: res.reply, res }]);
      if (res.proposed_offer) toast(`Offer sent at ${money(res.proposed_offer.amount_cents)}. The seller just has to tap accept.`);
    } catch (e) {
      toast((e as Error).message);
      setMsgs(m => m.slice(0, -1));
      setText(message);
    } finally { setBusy(false); }
  };

  const jevOnline = status?.kinds.includes('jev_decide');
  return (
    <AnimatePresence>
      {listing && (
        <motion.div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button aria-label="Close" className="absolute inset-0 bg-[#1A1414]/50" onClick={onClose} />
          <motion.div
            role="dialog" aria-modal="true" aria-label="Haggle"
            className="relative flex max-h-[86vh] w-full max-w-[480px] flex-col rounded-t-[28px] border-[2.5px] border-ink bg-card shadow-[5px_5px_0_var(--shadow)] sm:rounded-[28px]"
            initial={{ y: 400 }} animate={{ y: 0 }} exit={{ y: 500 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          >
            <div className="border-b-2 border-ink/15 p-5 pb-3">
              <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-full p-1.5 hover:bg-sunk"><X size={20} /></button>
              <p className="label text-[11.5px] text-accent-text">Haggle · seller&apos;s agent</p>
              <h2 className="font-display mt-1 pr-8 text-[19px] font-bold">{listing.title}</h2>
              <p className="mt-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-soft">
                <span className={`inline-block h-2 w-2 rounded-full ${jevOnline ? 'bg-mint' : 'bg-soft'}`} />
                {jevOnline ? 'JEV-9B running locally on our laptop' : status ? 'AI offline, using rules' : 'Rule-based agent'}
              </p>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {msgs.map((m, i) => (
                <div key={i} className={`flex ${m.from === 'buyer' ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[82%]">
                    {m.res?.scam_flags.length ? (
                      <div className="mb-1.5 flex items-start gap-1.5 rounded-[14px] border-2 border-ink bg-[#FFB4B4] px-3 py-2 text-[12px] font-bold text-dark-ink">
                        <ShieldAlert size={15} className="mt-px shrink-0" /> Flagged: {m.res.scam_flags.map(f => f.replace(/_/g, ' ')).join(', ')}{m.res.reported ? ' · reported' : ''}
                      </div>
                    ) : null}
                    <div className={`rounded-[18px] border-2 border-ink px-3.5 py-2.5 text-[14.5px] font-medium ${m.from === 'buyer' ? 'bg-ink text-bg' : 'bg-bg text-ink'}`}>{m.text}</div>
                    {m.res && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full border-2 border-ink px-2 py-0.5 text-[10.5px] font-extrabold text-dark-ink ${ACTION[m.res.action].cls}`}>{ACTION[m.res.action].label}{m.res.price_cents !== null && m.res.action !== 'warn' ? ` · ${money(m.res.price_cents)}` : ''}</span>
                        <span className="text-[10.5px] font-semibold text-soft">{m.res.engine === 'jev' ? 'JEV-9B' : 'rules'}</span>
                      </div>
                    )}
                    {m.res && <Why res={m.res} />}
                  </div>
                </div>
              ))}
              {busy && <div className="text-[12.5px] font-semibold text-soft">Agent is thinking…</div>}
              <div ref={end} />
            </div>

            <form onSubmit={e => { e.preventDefault(); send(); }} className="flex gap-2 border-t-2 border-ink/15 p-4">
              <input value={text} onChange={e => setText(e.target.value)} placeholder="would you do $40 if I grab it today?" aria-label="Message"
                className="min-w-0 flex-1 rounded-full border-[2.5px] border-ink bg-bg px-4 py-3 text-[14.5px] font-medium outline-none placeholder:text-soft" />
              <Pill type="submit" disabled={busy || !text.trim()} aria-label="Send"><Send size={17} /></Pill>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
