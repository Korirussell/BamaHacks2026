'use client';
import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Lock, Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { copy } from '@/lib/copy';
import { money } from '@/lib/money';
import { listings, order, thread, userById } from '@/lib/data';
import { useDemo } from '@/lib/store';
import type { ThreadMessage } from '@/lib/types';
import { EmptyState, Pill, PillLink, ReliabilityBadge } from '@/components/ui';

const now = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });

// Web fallback of the iOS haggle star (frontend-build.md §11.4). Scripted: $55 → $70 → $62 → $65 accepted.
export default function OfferThread({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { set } = useDemo();
  const listing = listings.find(l => l.id === thread.listing_id)!;
  const kayla = userById(thread.seller_id)!;
  const [msgs, setMsgs] = useState<ThreadMessage[]>([]);
  const [amount, setAmount] = useState(5500);
  const [typing, setTyping] = useState(false);
  const [round, setRound] = useState(0);
  const [agreed, setAgreed] = useState<number | null>(null);
  const [paySheet, setPaySheet] = useState(false);
  const [paying, setPaying] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, typing]);

  if (id !== thread.id) return <EmptyState emoji="💬" line="That offer thread doesn't exist anymore." action={<PillLink href="/feed" size="sm">Back to the feed</PillLink>} />;

  const send = () => {
    if (typing || agreed) return;
    const scripted = thread.messages.find(m => m.from === 'me' && m.amount_cents === amount);
    setMsgs(m => [...m, { id: `me${Date.now()}`, from: 'me', kind: 'offer', amount_cents: amount, text: scripted?.text ?? `How about ${money(amount)}?`, at: now() }]);
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      if (amount >= 6500) {
        accept(amount);
        return;
      }
      const counter = round === 0 ? 7000 : 6500;
      const scriptedCounter = thread.messages.find(m => m.from === 'them' && m.amount_cents === counter);
      setMsgs(m => [...m, { id: `them${Date.now()}`, from: 'them', kind: 'counter', amount_cents: counter, text: scriptedCounter?.text ?? `${money(counter)}?`, at: now() }]);
      setRound(r => r + 1);
      if (counter === 6500) setTimeout(() => accept(6500), 900);
      else setAmount(6200);
    }, 1200);
  };

  const accept = (cents: number) => {
    setAgreed(cents);
    setMsgs(m => [...m, { id: `sys${Date.now()}`, from: 'system', kind: 'accepted', amount_cents: cents, text: `Kayla accepted ${money(cents)} ✓`, at: now() }]);
  };

  const fee = Math.round((agreed ?? order.amount_cents) * 0.05);
  const total = (agreed ?? order.amount_cents) + fee;

  const pay = () => {
    setPaying(true);
    setTimeout(() => {
      setPaying(false);
      setPaySheet(false);
      set(s => ({ ...s, order: { ...s.order, amount_cents: agreed ?? 6500, fee_cents: fee, total_cents: total, status: 'paid' } }));
      toast(`${money(agreed ?? 6500)} held 🔒`);
      router.push(`/meetup/${order.id}`);
    }, 1200);
  };

  return (
    <div className="mx-auto flex max-w-[640px] flex-col">
      <div className="stk flex items-center gap-3 rounded-[20px] bg-card p-3.5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] border-2 border-ink bg-mint text-3xl">{listing.emoji}</div>
        <div className="min-w-0">
          <h1 className="font-display truncate text-[18px] font-bold">{listing.title}</h1>
          <p className="text-[12.5px] font-semibold text-soft">Listed at {money(listing.price_cents)} · {kayla.display_name}</p>
          <div className="mt-1"><ReliabilityBadge r={kayla.reliability} /></div>
        </div>
      </div>

      <p className="label mt-5 text-center text-[11px] text-soft">{copy.thread.expiry}</p>

      <div className="mt-4 flex min-h-[300px] flex-col gap-3 pb-40">
        {msgs.length === 0 && <p className="mt-10 text-center text-[14px] font-semibold text-soft">Make an offer. Kayla usually answers in a minute.</p>}
        <AnimatePresence initial={false}>
          {msgs.map(m =>
            m.from === 'system' ? (
              <motion.div key={m.id} initial={{ y: -40, opacity: 0, rotate: 0 }} animate={{ y: 0, opacity: 1, rotate: -3 }} transition={{ type: 'spring', stiffness: 380, damping: 12 }} className="my-3 self-center rounded-full border-[2.5px] border-[#1A1414] bg-butter px-5 py-2.5 font-display text-[20px] font-bold text-dark-ink shadow-[4px_4px_0_var(--shadow)]">
                {m.text}
              </motion.div>
            ) : (
              <motion.div key={m.id} initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} className={`flex flex-col ${m.from === 'me' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[78%] rounded-[18px] border-2 border-ink px-4 py-2.5 shadow-[3px_3px_0_var(--shadow)] ${m.from === 'me' ? 'rounded-br-[6px] bg-mint text-dark-ink' : 'rounded-bl-[6px] bg-card'}`}>
                  {m.kind === 'counter' && <span className="mb-0.5 block text-[10px] font-extrabold uppercase opacity-60">counter</span>}
                  <p className="text-[15px] font-semibold">{m.text}</p>
                </div>
                <span className="mt-1 px-1 text-[10.5px] font-bold text-soft">{m.at}</span>
              </motion.div>
            ),
          )}
        </AnimatePresence>
        {typing && (
          <div className="flex items-center gap-2 text-[12.5px] font-bold text-soft">
            <span className="flex gap-1 rounded-full border-2 border-ink bg-card px-3 py-2">
              {[0, 1, 2].map(i => <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-ink" animate={{ y: [0, -4, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.12 }} />)}
            </span>
            Kayla is typing…
          </div>
        )}
        <div ref={end} />
      </div>

      <div className="fixed inset-x-0 bottom-[68px] z-30 border-t-[2.5px] border-ink bg-bg px-4 py-3 min-[900px]:bottom-0 min-[900px]:pl-[100px] min-[900px]:pr-[72px]">
        <div className="mx-auto max-w-[640px]">
          {agreed ? (
            <Pill size="lg" className="w-full" onClick={() => setPaySheet(true)}>{agreed === 6500 ? copy.pay.cta : `Pay ${money(agreed)} · held until handoff 🔒`}</Pill>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex flex-1 items-center justify-between rounded-full border-[2.5px] border-ink bg-card p-1">
                <button aria-label="Lower" onClick={() => setAmount(a => Math.max(100, a - 100))} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-sunk"><Minus size={18} strokeWidth={2.6} /></button>
                <span className="font-display text-[22px] font-bold tabular-nums">{money(amount)}</span>
                <button aria-label="Raise" onClick={() => setAmount(a => a + 100)} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-sunk"><Plus size={18} strokeWidth={2.6} /></button>
              </div>
              <Pill onClick={send} disabled={typing}>Send offer</Pill>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {paySheet && (
          <motion.div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button aria-label="Close" className="absolute inset-0 bg-[#1A1414]/50" onClick={() => !paying && setPaySheet(false)} />
            <motion.div role="dialog" aria-modal="true" aria-label="Pay" initial={{ y: 400 }} animate={{ y: 0 }} exit={{ y: 500 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }} className="relative w-full max-w-[440px] rounded-t-[28px] border-[2.5px] border-ink bg-card p-6 pb-8 shadow-[5px_5px_0_var(--shadow)] sm:rounded-[28px]">
              <h2 className="font-display text-[21px] font-bold">Checkout</h2>
              <dl className="mt-4 space-y-2 text-[15px] font-semibold">
                <div className="flex justify-between"><dt>Item</dt><dd>{money(agreed ?? 6500, true)}</dd></div>
                <div className="flex justify-between text-soft"><dt>Service fee</dt><dd>{money(fee, true)}</dd></div>
                <div className="flex justify-between border-t-2 border-dashed border-ink/40 pt-2 text-[17px] font-extrabold"><dt>Total</dt><dd>{money(total, true)}</dd></div>
              </dl>
              <p className="mt-4 flex items-center gap-2 rounded-[14px] bg-mint px-3 py-2 text-[13px] font-bold text-dark-ink"><Lock size={14} /> Money&apos;s held until it&apos;s in your hands.</p>
              <button onClick={pay} disabled={paying} className="stk-btn mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-[#1A1414] px-5 py-3.5 text-[15px] font-extrabold text-white dark:border-white">
                {paying ? <Loader2 size={18} className="animate-spin" /> : <>Pay with  Pay</>}
              </button>
              <Pill variant="neutral" className="mt-3 w-full" onClick={pay} disabled={paying}>Pay with card</Pill>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
