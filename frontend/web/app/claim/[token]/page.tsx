'use client';
import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Lock, ShieldCheck, MapPin } from 'lucide-react';
import { copy } from '@/lib/copy';
import { money } from '@/lib/money';
import { claim } from '@/lib/data';
import { useDemo, useMockLoad } from '@/lib/store';
import { BidBubbles } from '@/components/BidBubbles';
import { Logo } from '@/components/Shell';
import { EmptyState, ErrorState, LoadingState, Pill, PillLink, Sticker } from '@/components/ui';

const DEMO_CODE = '428913';

function Band() {
  return (
    <div className="flex items-center justify-between border-b-[2.5px] border-ink bg-accent px-5 py-4 text-on-accent">
      <Logo glyphSize={32} onAccent />
      <span className="label text-[11px] opacity-90">Claim your listing</span>
    </div>
  );
}

function Otp({ onVerified }: { onVerified: () => void }) {
  const [sent, setSent] = useState(false);
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [busy, setBusy] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [sent]);
  const full = digits.every(Boolean);

  const fillDemo = () => {
    DEMO_CODE.split('').forEach((d, i) => setTimeout(() => setDigits(p => { const n = [...p]; n[i] = d; return n; }), i * 90));
  };

  return (
    <motion.div ref={box} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="stk rounded-[22px] bg-card p-5">
      <h2 className="font-display text-[22px] font-bold">Verify you&apos;re a UA student</h2>
      <p className="mt-1 text-[13.5px] font-semibold text-soft">We only let .edu emails sell on Handoff.</p>
      <label className="mt-4 block">
        <span className="label text-[11px] text-soft">School email</span>
        <input defaultValue="jackson@crimson.ua.edu" className="mt-1.5 w-full rounded-full border-[2.5px] border-ink bg-bg px-4 py-3 text-[15px] font-semibold outline-none" />
      </label>
      {!sent ? (
        <Pill className="mt-4 w-full" onClick={() => setSent(true)}>Send my code</Pill>
      ) : (
        <>
          <p className="mt-4 text-[13px] font-semibold text-soft">Enter the 6-digit code we sent you.</p>
          <div className="mt-2 flex justify-between gap-2">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={el => { refs.current[i] = el; }}
                value={d}
                inputMode="numeric"
                maxLength={1}
                aria-label={`Digit ${i + 1}`}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, '').slice(-1);
                  setDigits(p => { const n = [...p]; n[i] = v; return n; });
                  if (v && i < 5) refs.current[i + 1]?.focus();
                }}
                onKeyDown={e => e.key === 'Backspace' && !d && i > 0 && refs.current[i - 1]?.focus()}
                className={`font-display h-14 w-full min-w-0 rounded-[14px] border-[2.5px] border-ink text-center text-[24px] font-bold outline-none ${d ? 'bg-butter text-dark-ink shadow-[2px_2px_0_var(--shadow)]' : 'bg-bg'}`}
              />
            ))}
          </div>
          <button onClick={fillDemo} className="mt-3 text-[13px] font-extrabold text-accent-text underline-offset-2 hover:underline">Use demo code</button>
          <Pill
            className="mt-4 w-full"
            disabled={!full || busy}
            onClick={() => { setBusy(true); setTimeout(onVerified, 700); }}
          >
            {busy ? 'Verifying…' : 'Verify & claim'}
          </Pill>
        </>
      )}
    </motion.div>
  );
}

export default function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const { listings, bids, bumpDm, claimGhost, celebrate } = useDemo();
  const { status, retry } = useMockLoad([token]);
  const [step, setStep] = useState<'pitch' | 'otp'>('pitch');
  const valid = token === claim.token;

  useEffect(() => { if (valid) bumpDm('clicked'); }, [valid, bumpDm]);

  const bike = listings.find(l => l.id === claim.listing_id)!;
  const claimBids = bids.filter(b => b.listing_id === 'l_bike');
  const top = Math.max(...claimBids.map(b => b.amount_cents));
  const alreadyClaimed = bike.status !== 'ghost';

  return (
    <div className="min-h-screen bg-bg">
      <Band />
      <main className="mx-auto max-w-[480px] px-4 pb-16 pt-6">
        {status === 'loading' ? (
          <LoadingState />
        ) : status === 'error' ? (
          <ErrorState onRetry={retry} />
        ) : !valid ? (
          <EmptyState emoji="🤔" line="This claim link doesn't look right, or it already expired." action={<PillLink href="/feed" size="sm">Browse Handoff</PillLink>} />
        ) : (
          <>
            <div className="relative">
              <h1 className="font-display pr-20 text-[34px] font-bold sm:text-[38px]">{copy.claim.headline}</h1>
              <Sticker rotate={8} className="absolute -top-1 right-0 flex-col items-center !px-3 !py-2 leading-tight">
                <span className="text-[10px] uppercase">Top offer</span>
                <span className="font-display text-[22px]">{money(top)}</span>
              </Sticker>
            </div>
            <p className="mt-3 text-[15.5px] font-semibold text-soft">{copy.claim.sub}</p>

            <div className="mt-6 rounded-[20px] p-[3px] ig-grad">
              <div className="rounded-[17px] bg-card p-4">
                <span className="label text-[10.5px] text-soft">Your post</span>
                <p className="mt-1 text-[16px] font-semibold italic">&ldquo;{bike.source.post_caption}&rdquo;</p>
                <p className="mt-1 text-[13px] font-extrabold">{bike.source.author_handle} <span className="font-semibold text-soft">· {bike.source.posted_ago}</span></p>
              </div>
            </div>

            <div className="stk mt-5 overflow-hidden rounded-[22px] bg-card">
              <div className="flex items-center gap-2 border-b-[2.5px] border-ink bg-mint px-4 py-2.5 text-dark-ink">
                <span className="label text-[11px]">✨ We already wrote your listing</span>
              </div>
              <div className="flex gap-4 p-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[16px] border-2 border-ink bg-butter text-[44px]">{bike.emoji}</div>
                <div className="min-w-0">
                  <h2 className="font-display text-[20px] font-bold">{bike.title}</h2>
                  <p className="font-display mt-1 text-[22px] font-bold">{money(bike.price_cents)}</p>
                  {bike.fair_price && <p className="text-[12.5px] font-semibold text-soft">Fair price {money(bike.fair_price.low_cents)}–{money(bike.fair_price.high_cents)} · Good condition</p>}
                </div>
              </div>
              <p className="px-4 pb-4 text-[14.5px] font-medium">{bike.description}</p>
            </div>

            <h2 className="font-display mt-7 text-[21px] font-bold">Who wants it</h2>
            <div className="mt-4"><BidBubbles bids={claimBids} /></div>

            <div className="mt-7 flex flex-wrap justify-center gap-x-4 gap-y-2 rounded-[18px] border-2 border-dashed border-ink px-3 py-3 text-[12px] font-bold text-soft">
              <span className="inline-flex items-center gap-1"><ShieldCheck size={14} /> .edu students only</span>
              <span className="inline-flex items-center gap-1"><Lock size={14} /> Money held until handoff</span>
              <span className="inline-flex items-center gap-1"><MapPin size={14} /> Meet at safe zones</span>
            </div>
            <span className="sr-only">{copy.claim.trust}</span>

            <div className="mt-6">
              <AnimatePresence initial={false}>
                {alreadyClaimed ? (
                  <PillLink key="done" href="/listings/l_bike" size="lg" className="w-full">See your live listing →</PillLink>
                ) : step === 'pitch' ? (
                  <motion.div key="cta">
                    <Pill size="lg" className="w-full" onClick={() => setStep('otp')}>{copy.claim.cta}</Pill>
                  </motion.div>
                ) : (
                  <Otp
                    key="otp"
                    onVerified={() => {
                      claimGhost();
                      celebrate({ kind: 'fieldgoal', title: copy.celebrate.fg, line: copy.celebrate.fgClaimed, onDone: () => router.push('/listings/l_bike') });
                    }}
                  />
                )}
              </AnimatePresence>
            </div>
            <button className="mx-auto mt-6 block text-[13px] font-bold text-soft underline-offset-2 hover:underline" onClick={() => router.push('/')}>{copy.claim.optout}</button>
          </>
        )}
      </main>
    </div>
  );
}
