'use client';
// Seller payout setup (Stripe Connect Express). Stripe onboarding sends sellers back here with
// ?stripe=return (refetch status) or ?stripe=refresh (link expired: start onboarding again).
// docs/FRONTEND_NOTES.md → "Card payments (Stripe)" §2.
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { USE_MOCKS } from '@/lib/api';
import { realOnboard, realPaymentsStatus, type PayoutStatus } from '@/lib/real';
import { useRealLoad } from '@/lib/useRealLoad';
import { ErrorState, Pill, Skeleton, StickerCard } from '@/components/ui';

// "individual.verification.document" → "Verification document"
const humanize = (req: string) => {
  const s = (req.split('.').slice(-2).join(' ')).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function Row({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t-2 border-dashed border-ink/30 py-3 first:border-t-0">
      <p className="font-extrabold">{label}</p>
      <span className={`rounded-full border-2 border-ink px-3 py-1 text-[12px] font-extrabold uppercase ${on ? 'bg-mint text-dark-ink' : 'bg-sunk'}`}>{on ? 'On' : 'Off'}</span>
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md py-8">
      <StickerCard className="p-6">
        <h1 className="font-display text-[24px] font-bold">Get paid</h1>
        <p className="mt-1 text-[14px] font-semibold text-soft">Payouts go to your bank through Stripe once a handoff is done.</p>
        {children}
      </StickerCard>
      <p className="mt-4 text-center text-[12.5px] font-medium text-meta"><Link href="/profile" className="hover:underline">← Profile</Link></p>
    </div>
  );
}

function StatusView({ s, onSetup, busy, err, justReturned }: { s: PayoutStatus; onSetup: () => void; busy: boolean; err: string; justReturned: boolean }) {
  const needsInfo = s.requirements_due.length > 0;
  const started = s.charges_enabled || needsInfo;
  return (
    <>
      {s.payouts_enabled ? (
        <p role="status" className="mt-5 flex items-center gap-2 rounded-[14px] bg-mint px-3 py-2 text-[14px] font-bold text-dark-ink">
          <CheckCircle2 size={16} /> Payouts are on{justReturned ? '. Anything waiting is on its way.' : '.'}
        </p>
      ) : justReturned && !needsInfo ? (
        <p role="status" className="mt-5 rounded-[14px] bg-butter px-3 py-2 text-[14px] font-bold text-dark-ink">Thanks! Stripe is checking your details. This usually takes a minute.</p>
      ) : null}
      <div className="mt-5">
        <Row label="Card payments" on={s.charges_enabled} />
        <Row label="Payouts" on={s.payouts_enabled} />
      </div>
      {needsInfo && (
        <div className="mt-4 rounded-[14px] border-2 border-ink bg-peach px-3 py-2 text-dark-ink">
          <p className="text-[14px] font-extrabold">Stripe needs a bit more info</p>
          <ul className="mt-1 list-disc pl-5 text-[13px] font-semibold">
            {s.requirements_due.map(r => <li key={r}>{humanize(r)}</li>)}
          </ul>
        </div>
      )}
      {(!s.payouts_enabled || needsInfo) && (
        <Pill className="mt-5 w-full" onClick={onSetup} disabled={busy}>
          {busy ? 'Opening Stripe…' : started ? 'Finish setup' : 'Set up payouts'}
        </Pill>
      )}
      {err && <p role="alert" className="mt-3 text-[13px] font-bold text-accent-text">{err}</p>}
    </>
  );
}

function RealPayments() {
  const stripe = useSearchParams().get('stripe');
  const refreshing = stripe === 'refresh';
  const [busy, setBusy] = useState(refreshing);
  const [err, setErr] = useState('');
  const started = useRef(false);

  const onboard = async () => {
    setBusy(true); setErr('');
    try {
      window.location.assign((await realOnboard()).onboarding_url);
    } catch (e) {
      setErr((e as Error).message); setBusy(false);
    }
  };

  // ?stripe=refresh: the onboarding link expired, so get a fresh one and go straight back.
  useEffect(() => {
    if (!refreshing || started.current) return;
    started.current = true;
    onboard();
  }, [refreshing]);

  const { data, status, error, retry } = useRealLoad(realPaymentsStatus, [stripe]);

  if (refreshing && busy) return <Frame><p role="status" className="mt-5 flex items-center gap-2 font-bold"><Loader2 size={18} className="animate-spin" /> Taking you back to Stripe…</p></Frame>;
  if (status === 'error') return <ErrorState onRetry={retry} line={error?.message} />;
  if (status === 'loading' || !data) return <Frame><Skeleton className="mt-5 h-24 w-full rounded-2xl" /></Frame>;
  return <Frame><StatusView s={data} onSetup={onboard} busy={busy} err={err} justReturned={stripe === 'return'} /></Frame>;
}

function MockPayments() {
  const [on, setOn] = useState(false);
  const s: PayoutStatus = { charges_enabled: on, payouts_enabled: on, requirements_due: [] };
  return (
    <Frame>
      <StatusView s={s} busy={false} err="" justReturned={on} onSetup={() => { setOn(true); toast('Payouts are on'); }} />
    </Frame>
  );
}

export default function PaymentsSettings() {
  if (USE_MOCKS) return <MockPayments />;
  return <Suspense fallback={null}><RealPayments /></Suspense>;
}
