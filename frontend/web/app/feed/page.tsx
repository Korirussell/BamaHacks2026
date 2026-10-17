'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, Search } from 'lucide-react';
import { copy } from '@/lib/copy';
import { notifications } from '@/lib/data';
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
      <InterestSheet listing={want} onClose={() => setWant(null)} />
    </div>
  );
}
