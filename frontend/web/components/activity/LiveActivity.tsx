'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { money } from '@/lib/money';
import { acceptOffer, request } from '@/lib/api';
import { ChipRow, EmptyState, PageTitle, Pill, Skeleton } from '@/components/ui';

type Person = { display_name: string };
type LiveOrder = {
  id: string; listing: { title: string }; buyer: Person; seller: Person; amount_cents: number; seller_payout_cents: number;
  status: string; payment: { status: string }; created_at: string;
};
type LiveOffer = { id: string; listing_id: string; buyer: Person; amount_cents: number; message: string | null; status: string; waiting_on: string | null };

const TABS = ['Selling', 'Buying'] as const;
const STATUS: Record<string, string> = {
  awaiting_payment: 'Waiting for payment', paid: 'Paid 🔒', scheduled: 'Meetup set', handing_off: 'Handing off',
  in_transit: 'In campus mail', completed: 'Done ✓', cancelled: 'Cancelled', disputed: 'Disputed', refunded: 'Refunded',
};

/** Real API: your sales and buys (/me/orders) and offers waiting on you (/me/offers). */
export function LiveActivity() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Selling');
  const [data, setData] = useState<{ selling: LiveOrder[]; buying: LiveOrder[]; offers: LiveOffer[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [selling, buying, offers] = await Promise.all([
      request<LiveOrder[]>('/me/orders?role=seller'),
      request<LiveOrder[]>('/me/orders?role=buyer'),
      request<LiveOffer[]>('/me/offers?role=seller&status=pending'),
    ]);
    setData({ selling, buying, offers: offers.filter(o => o.waiting_on !== 'buyer') });
  }, []);
  useEffect(() => { load().catch((e: Error) => toast(e.message)); }, [load]);

  const accept = async (id: string) => {
    setBusy(true);
    try { await acceptOffer(id); toast('Accepted. Waiting for them to pay.'); await load(); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };

  const orders = tab === 'Selling' ? data?.selling : data?.buying;
  return (
    <div className="mx-auto max-w-[760px]">
      <PageTitle title="Activity" />
      <ChipRow items={TABS} value={tab} onChange={setTab} />
      <div className="mt-5 space-y-3">
        {!data ? [0, 1, 2].map(i => <Skeleton key={i} className="h-[72px]" />) : (
          <>
            {tab === 'Selling' && data.offers.map(o => (
              <div key={o.id} className="flex items-center gap-3 rounded-[20px] border-[2.5px] border-ink bg-butter p-4 text-dark-ink shadow-[4px_4px_0_var(--shadow)]">
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold">{o.buyer.display_name} offered {money(o.amount_cents)}</p>
                  {o.message && <p className="text-[13px] font-semibold opacity-75">&ldquo;{o.message}&rdquo;</p>}
                </div>
                <Pill size="sm" disabled={busy} onClick={() => void accept(o.id)}>Accept</Pill>
              </div>
            ))}
            {orders && orders.length === 0 && (tab === 'Buying' || data.offers.length === 0) && (
              <EmptyState emoji={tab === 'Selling' ? '🏷️' : '🛍️'} line={tab === 'Selling' ? 'Nothing sold yet.' : "You haven't bought anything yet."} />
            )}
            {orders?.map(o => (
              <Link key={o.id} href={`/orders/${o.id}`} className="press flex items-center gap-3 rounded-[20px] border-[2.5px] border-ink bg-card p-4 shadow-[4px_4px_0_var(--shadow)]">
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold">{o.listing.title}</p>
                  <p className="text-[13px] font-semibold text-soft">
                    {tab === 'Selling' ? `Sold to ${o.buyer.display_name} · you get ${money(o.seller_payout_cents)}` : `From ${o.seller.display_name} · ${money(o.amount_cents)}`}
                  </p>
                </div>
                <span className="shrink-0 text-[12px] font-bold">{STATUS[o.status] ?? o.status}</span>
              </Link>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
