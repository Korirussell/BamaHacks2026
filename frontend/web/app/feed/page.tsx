'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, Search } from 'lucide-react';
import { toast } from 'sonner';
import { copy, copy2 } from '@/lib/copy';
import { notifications, wishlist } from '@/lib/data';
import { WhyPanel } from '@/components/WhyPanel';
import { useDemo, useMockLoad } from '@/lib/store';
import type { Listing } from '@/lib/types';
import { ListingCard, ListingCardSkeleton } from '@/components/ListingCard';
import { InterestSheet } from '@/components/InterestSheet';
import { ChipRow, EmptyState, ErrorState, PageTitle, PillLink } from '@/components/ui';

type Chip = (typeof copy.chips)[number];

export default function Feed() {
  const { listings, scrapeTick } = useDemo();
  const { status, retry } = useMockLoad();
  const [chip, setChip] = useState<Chip>('All');
  const [q, setQ] = useState('');
  const [want, setWant] = useState<Listing | null>(null);
  const [view, setView] = useState<'all' | 'foryou'>('all');
  useEffect(() => { if (new URLSearchParams(window.location.search).get('view') === 'foryou') setView('foryou'); }, []);
  const [why, setWhy] = useState<(typeof wishlist.for_you)[number] | null>(null);
  const [wish, setWish] = useState<string | null>(null);
  const forYou = wishlist.for_you
    .filter(f => !wish || f.wishlist_id === wish)
    .map(f => ({ f, l: listings.find(l => l.id === f.listing_id)! }))
    .filter(x => x.l);
  const unread = notifications.filter(n => !n.read).length;

  const shown = useMemo(() => {
    let l = listings;
    if (chip === 'From Instagram') l = l.filter(x => x.status === 'ghost' || x.source.channel === 'instagram');
    if (chip === 'Marketplace') l = l.filter(x => ['textbook', 'lab_supplies', 'dorm', 'bike', 'other'].includes(x.category));
    if (chip === 'Tickets') l = l.filter(x => x.category === 'ticket');
    if (chip === 'Rides' || chip === 'Tutoring') l = [];
    if (q.trim()) l = l.filter(x => (x.title + ' ' + (x.tag ?? '') + ' ' + x.description).toLowerCase().includes(q.toLowerCase()));
    // Ghost listings first: they're the hook.
    return [...l].sort((a, b) => Number(b.status === 'ghost') - Number(a.status === 'ghost'));
  }, [listings, chip, q]);

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageTitle
        title={copy.feed.title}
        sub={copy.feed.sub}
        right={
          <Link href="/notifications" aria-label={`Notifications, ${unread} unread`} className="press relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-[2.5px] border-ink bg-card shadow-[3px_3px_0_var(--shadow)]">
            <Bell size={20} strokeWidth={2.4} />
            {unread > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-ink bg-accent px-1 text-[11px] font-extrabold text-on-accent">{unread}</span>}
          </Link>
        }
      />
      <div role="tablist" className="mb-4 inline-flex rounded-full border-[2.5px] border-ink bg-card p-1 shadow-[3px_3px_0_var(--shadow)]">
        {([['foryou', `✨ ${copy2.foryou.title}`], ['all', 'Everything']] as const).map(([v, l]) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`label rounded-full px-4 py-2 ${view === v ? 'bg-ink text-bg' : ''}`}>{l}</button>
        ))}
      </div>
      {view === 'foryou' ? (
        <div>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-2 pt-1">
            {wishlist.items.map(w => (
              <button key={w.id} onClick={() => setWish(wish === w.id ? null : w.id)} aria-pressed={wish === w.id} className={`press shrink-0 rounded-full border-2 border-ink px-3.5 py-2 text-[12.5px] font-extrabold shadow-[3px_3px_0_var(--shadow)] ${wish === w.id ? 'bg-butter text-dark-ink' : 'bg-card'}`}>
                {w.label} · {w.match_count}
              </button>
            ))}
            <button onClick={() => toast('Wishlist editing is coming soon')} className="shrink-0 rounded-full border-2 border-dashed border-ink px-3.5 py-2 text-[12.5px] font-extrabold">＋ Add</button>
          </div>
          <p className="mt-2 text-[13px] font-semibold text-soft">Ranked from your wishlist, budget, schedule and where you walk.</p>
          <div className="mt-4">
            {status === 'loading' ? (
              <div className="grid grid-cols-2 gap-[14px] sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] sm:gap-[18px]">{Array.from({ length: 5 }, (_, i) => <ListingCardSkeleton key={i} />)}</div>
            ) : status === 'error' ? <ErrorState onRetry={retry} /> : forYou.length === 0 ? <EmptyState line="No matches for that one yet. We'll ping you." /> : (
              <div className="grid grid-cols-2 gap-[14px] sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] sm:gap-[18px]">
                {forYou.map(({ f, l }, i) => (
                  <motion.div key={l.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="h-full">
                    <ListingCard listing={l} reasonText={f.reason} onWhy={() => setWhy(f)} className="h-full" />
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (<>
      <label className="flex items-center gap-2.5 rounded-full border-[2.5px] border-ink bg-card px-4 py-3 shadow-[3px_3px_0_var(--shadow)] focus-within:shadow-[4px_4px_0_var(--shadow)]">
        <Search size={18} strokeWidth={2.4} className="text-soft" />
        <span className="sr-only">Search</span>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={copy.search.placeholder} className="w-full bg-transparent text-[15px] font-medium outline-none placeholder:text-soft" />
      </label>
      <div className="mt-4"><ChipRow items={copy.chips} value={chip} onChange={setChip} /></div>

      <div className="mt-4">
        {status === 'error' ? (
          <ErrorState onRetry={retry} />
        ) : status === 'loading' ? (
          <div className="grid grid-cols-2 gap-[14px] sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] sm:gap-[18px]">
            {Array.from({ length: 8 }, (_, i) => <ListingCardSkeleton key={i} />)}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState line={copy.empty.feed} action={<PillLink href="/post" size="sm">Post something</PillLink>} />
        ) : (
          <motion.div layout className="grid grid-cols-2 gap-[14px] sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] sm:gap-[18px]">
            <AnimatePresence initial={false}>
              {shown.map((l, i) => (
                <motion.div
                  key={`${l.id}-${l.status === 'ghost' ? scrapeTick : 0}`}
                  layout
                  initial={{ opacity: 0, y: 16, scale: l.status === 'ghost' && scrapeTick ? 0.6 : 1 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ delay: Math.min(i, 8) * 0.03, type: 'spring', stiffness: 260, damping: 22 }}
                  className="h-full"
                >
                  <ListingCard listing={l} onWant={setWant} className="h-full" />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
      </>)}
      <InterestSheet listing={want} onClose={() => setWant(null)} />
      <WhyPanel item={why} listing={why ? listings.find(l => l.id === why.listing_id) : undefined} onClose={() => setWhy(null)} />
    </div>
  );
}
