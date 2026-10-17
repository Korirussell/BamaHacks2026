'use client';
// Real-mode order page: load GET /orders/{id}; when awaiting payment, pay via Stripe Elements
// (or skip straight through when the API runs PAYMENTS=demo). The server marks the order paid
// from Stripe's webhook, so after confirmPayment we poll the order.
import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, Lock } from 'lucide-react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { money } from '@/lib/money';
import { realOrder, realPay, supabase, type COrder } from '@/lib/real';
import { useRealLoad } from '@/lib/useRealLoad';
import { ErrorState, Pill, PillLink, Skeleton, StickerCard } from '@/components/ui';

let stripePromise: Promise<Stripe | null> | null = null;
const getStripe = () => (stripePromise ??= loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''));

const POLL_MS = 1500;
const POLL_MAX = 20; // ~30 s

/** The Payment Element form. Polls the order after confirmPayment until it leaves awaiting_payment. */
function CardForm({ orderId, onSettled }: { orderId: string; onSettled: (o: COrder) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [phase, setPhase] = useState<'idle' | 'confirming' | 'processing'>('idle');
  const [err, setErr] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const poll = async () => {
    for (let i = 0; i < POLL_MAX && alive.current; i++) {
      await new Promise(r => setTimeout(r, POLL_MS));
      try {
        const o = await realOrder(orderId);
        if (o.status !== 'awaiting_payment') return onSettled(o);
        if (o.payment.status === 'failed') { setErr("Payment didn't go through. Try another card."); return setPhase('idle'); }
      } catch (e) { setErr((e as Error).message); return setPhase('idle'); }
    }
    if (alive.current) { setErr('Still waiting on the payment. Check back in a moment.'); setPhase('idle'); }
  };

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setErr(''); setPhase('confirming');
    const { error } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
    if (error) { setErr(error.message ?? "Payment didn't go through."); return setPhase('idle'); }
    setPhase('processing');
    poll();
  };

  if (phase === 'processing') return <p role="status" className="flex items-center gap-2 font-bold"><Loader2 size={18} className="animate-spin" /> Payment processing…</p>;
  return (
    <form onSubmit={pay} className="space-y-4">
      <PaymentElement />
      {err && <p role="alert" className="text-[13px] font-bold text-accent-text">{err}</p>}
      <Pill type="submit" className="w-full" disabled={!stripe || phase !== 'idle'}>{phase === 'confirming' ? 'Paying…' : err ? 'Try again' : 'Pay'}</Pill>
    </form>
  );
}

export function RealOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, status, error, retry } = useRealLoad(async () => {
    const [order, { data: { session } }] = await Promise.all([realOrder(id), supabase().auth.getSession()]);
    return { order, me: session?.user.id };
  }, [id]);
  const [order, setOrder] = useState<COrder | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [payErr, setPayErr] = useState('');
  const [starting, setStarting] = useState(false);
  const key = useRef<string>('');

  useEffect(() => { if (data) setOrder(data.order); }, [data]);

  if (status === 'error') return <ErrorState onRetry={retry} line={error?.code === 'NOT_FOUND' ? "We can't find that order." : error?.message} />;
  if (status === 'loading' || !order) return <div className="mx-auto max-w-md space-y-4 py-8"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-40 w-full rounded-2xl" /></div>;

  const isBuyer = !!data && order.buyer.id === data.me;
  const startPay = async () => {
    key.current ||= crypto.randomUUID(); // reused on retry so a double-click can't double-charge
    setStarting(true); setPayErr('');
    try {
      const r = await realPay(id, key.current);
      if (r.demo || !r.client_secret) setOrder(r.order ?? (await realOrder(id)));
      else setSecret(r.client_secret);
    } catch (e) { setPayErr((e as Error).message); }
    finally { setStarting(false); }
  };

  return (
    <div className="mx-auto max-w-md py-8">
      <StickerCard className="p-6">
        <h1 className="font-display text-[22px] font-bold">{order.listing.title}</h1>
        <p className="mt-1 text-[28px] font-extrabold tabular-nums">{money(order.amount_cents, true)}</p>
        {order.status === 'awaiting_payment' ? (
          isBuyer ? (
            <div className="mt-5 space-y-4">
              <p className="flex items-center gap-2 rounded-[14px] bg-mint px-3 py-2 text-[13px] font-bold text-dark-ink"><Lock size={14} /> Held until it&apos;s in your hands.</p>
              {order.payment.status === 'failed' && !secret && <p role="alert" className="text-[13px] font-bold text-accent-text">Your last payment didn&apos;t go through. You can try again.</p>}
              {secret ? (
                <Elements stripe={getStripe()} options={{ clientSecret: secret }}>
                  <CardForm orderId={id} onSettled={setOrder} />
                </Elements>
              ) : (
                <Pill className="w-full" onClick={startPay} disabled={starting}>{starting ? 'One sec…' : `Pay ${money(order.amount_cents, true)}`}</Pill>
              )}
              {payErr && <p role="alert" className="text-[13px] font-bold text-accent-text">{payErr}</p>}
            </div>
          ) : <p className="mt-4 font-semibold text-soft">Waiting for the buyer to pay.</p>
        ) : (
          <div className="mt-5 space-y-3">
            <p role="status" className="rounded-[14px] bg-mint px-3 py-2 text-[14px] font-bold text-dark-ink">
              {order.status === 'paid' || order.status === 'scheduled' ? `Paid 🔒 ${money(order.amount_cents, true)} is held until the handoff.` : `Order ${order.status.replace('_', ' ')}.`}
            </p>
            <PillLink href="/feed" variant="neutral" className="w-full">Back to the feed</PillLink>
          </div>
        )}
      </StickerCard>
      <p className="mt-4 text-center text-[12.5px] font-medium text-meta"><Link href="/feed" className="hover:underline">← Feed</Link></p>
    </div>
  );
}
