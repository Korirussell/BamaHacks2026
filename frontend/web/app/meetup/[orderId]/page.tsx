'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { CalendarPlus } from 'lucide-react';
import { toast } from 'sonner';
import { copy } from '@/lib/copy';
import { meetups, placeById } from '@/lib/data';
import { useDemo, useMockLoad } from '@/lib/store';
import { StickerMap } from '@/components/StickerMap';
import { SpotRow } from '@/components/SpotRow';
import { ErrorState, Pill, PillLink, Skeleton } from '@/components/ui';

export default function Meetup({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const { lockedMeetupId, set, celebrate } = useDemo();
  const { status, retry } = useMockLoad([orderId]);
  const [sel, setSel] = useState(lockedMeetupId ?? meetups[0].id);
  const spot = meetups.find(m => m.id === sel)!;
  const locked = lockedMeetupId != null;

  const lock = () => {
    const p = placeById(spot.place_id);
    set(s => ({ ...s, lockedMeetupId: spot.id, order: { ...s.order, status: 'scheduled' } }));
    celebrate({ kind: 'fieldgoal', title: copy.celebrate.fg, line: `Locked in: ${p.name} · ${spot.start_label}` });
  };

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="mb-5">
        <p className="label text-[11.5px] text-accent-text">Mini fridge · with Kayla R.</p>
        <h1 className="font-display mt-1 text-[30px] font-bold">Meet in the gap</h1>
      </div>
      {status === 'error' ? (
        <ErrorState onRetry={retry} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          {status === 'loading' ? (
            <Skeleton className="aspect-[4/3] w-full rounded-[24px] lg:aspect-auto lg:min-h-[520px]" />
          ) : (
            <StickerMap spots={meetups} selected={sel} onSelect={id => !locked && setSel(id)} className="aspect-[4/3] w-full lg:aspect-auto lg:min-h-[520px]" />
          )}
          <motion.section
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            className="rounded-[28px] border-[2.5px] border-ink bg-card p-5 shadow-[5px_5px_0_var(--shadow)] sm:p-6"
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-ink/25" aria-hidden />
            <p className="text-[11.5px] font-extrabold uppercase tracking-wide text-accent-text">{copy.meetup.kicker}</p>
            <h2 className="font-display mt-1 text-[21px] font-bold">{copy.meetup.title}</h2>
            <div className="mt-4 space-y-1.5">
              {status === 'loading'
                ? [0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)
                : meetups.map((m, i) => <SpotRow key={m.id} s={m} i={i} selected={sel === m.id} onSelect={() => !locked && setSel(m.id)} />)}
            </div>
            {!locked ? (
              <Pill size="lg" className="mt-5 w-full" onClick={lock} disabled={status !== 'ready'}>{copy.meetup.lock(spot.start_label.replace(/ [AP]M$/, ''))}</Pill>
            ) : (
              <div className="mt-5 space-y-3">
                <div className="rounded-[18px] border-2 border-dashed border-ink px-4 py-3 text-[13.5px] font-bold">
                  ✅ Locked: {placeById(spot.place_id).name} · {spot.start_label} Monday
                </div>
                <div className="flex flex-wrap gap-3">
                  <Pill variant="neutral" onClick={() => toast('Added')}><CalendarPlus size={16} strokeWidth={2.4} /> Add to calendar</Pill>
                  <PillLink href={`/handoff/${orderId}`}>Go to handoff →</PillLink>
                </div>
                <button onClick={() => set(s => ({ ...s, lockedMeetupId: null }))} className="text-[12.5px] font-bold text-soft hover:underline">Pick a different spot</button>
              </div>
            )}
            <p className="mt-4 text-[12px] font-semibold text-soft">Based on both your class schedules. 🛡 = campus safe zone. <Link href="/feed" className="underline">Back to feed</Link></p>
          </motion.section>
        </div>
      )}
    </div>
  );
}
