'use client';
import Link from 'next/link';
import { useState } from 'react';
import { copy } from '@/lib/copy';
import { money } from '@/lib/money';
import { meetups, placeById } from '@/lib/data';
import { useDemo, useMockLoad } from '@/lib/store';
import { ChipRow, EmptyState, ErrorState, PageTitle, PillLink, Skeleton } from '@/components/ui';

const TABS = ['Buying', 'Selling', 'Interests'] as const;
type Row = { emoji: string; title: string; sub: string; status: string; action?: { label: string; href: string } };

export default function Activity() {
  const { order, lockedMeetupId, handedOff, listings, bids } = useDemo();
  const { status, retry } = useMockLoad();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Buying');
  const spot = meetups.find(m => m.id === lockedMeetupId);
  const orderStatus = handedOff ? 'Completed' : order.status === 'scheduled' ? 'Scheduled' : order.status === 'paid' ? 'Paid' : 'Haggling';

  const buying: Row[] = [
    {
      emoji: '🧊', title: 'Mini fridge, 3.2 cu ft', status: orderStatus,
      sub: spot ? `Meet Kayla · ${placeById(spot.place_id).name} · ${spot.start_label}` : `With Kayla R. · ${money(order.amount_cents)}`,
      action: handedOff ? undefined : spot ? { label: 'Show QR', href: '/handoff/o_fridge' } : order.status === 'paid' ? { label: 'Pick a spot', href: '/meetup/o_fridge' } : { label: 'Open thread', href: '/offers/t_fridge' },
    },
  ];
  const mine = listings.filter(l => l.seller_id === 'u_kori');
  const selling: Row[] = mine.map(l => ({ emoji: l.emoji, title: l.title, sub: `${money(l.price_cents)} · just posted`, status: 'Live', action: { label: 'View', href: `/listings/${l.id}` } }));
  const interests: Row[] = bids.filter(b => b.user_id === 'u_kori').map(b => {
    const l = listings.find(x => x.id === b.listing_id);
    return { emoji: l?.emoji ?? '❓', title: l?.title ?? 'Listing', sub: `Your offer ${money(b.amount_cents)}`, status: l?.status === 'ghost' ? 'Waiting on seller' : 'Seller joined!', action: { label: 'View', href: `/listings/${b.listing_id}` } };
  });
  const rows = tab === 'Buying' ? buying : tab === 'Selling' ? selling : interests;

  return (
    <div className="mx-auto max-w-[760px]">
      <PageTitle title="Activity" sub="Everything you're buying, selling and eyeing." />
      <ChipRow items={TABS} value={tab} onChange={setTab} />
      <div className="mt-4 space-y-3">
        {status === 'error' ? <ErrorState onRetry={retry} /> : status === 'loading' ? [0, 1].map(i => <Skeleton key={i} className="h-20" />) : rows.length === 0 ? (
          <EmptyState line={tab === 'Selling' ? copy.empty.feed : 'Nothing here yet. Tap "I want this" on something you like.'} action={<PillLink href={tab === 'Selling' ? '/post' : '/feed'} size="sm">{tab === 'Selling' ? 'Post something' : 'Browse the feed'}</PillLink>} />
        ) : rows.map((r, i) => (
          <div key={i} className="stk flex items-center gap-3 rounded-[20px] bg-card p-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] border-2 border-ink bg-peach text-2xl">{r.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-extrabold">{r.title}</p>
              <p className="truncate text-[12.5px] font-semibold text-soft">{r.sub}</p>
            </div>
            <span className="hidden rounded-full border-2 border-ink bg-mint px-2.5 py-0.5 text-[11px] font-extrabold uppercase text-dark-ink sm:inline-flex">{r.status}</span>
            {r.action && <Link href={r.action.href} className="press shrink-0 rounded-full border-2 border-ink bg-butter px-3 py-1.5 text-[11px] font-extrabold uppercase text-dark-ink shadow-[2px_2px_0_var(--shadow)]">{r.action.label}</Link>}
          </div>
        ))}
      </div>
    </div>
  );
}
