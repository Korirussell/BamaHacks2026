'use client';
import { use, useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarPlus } from 'lucide-react';
import { toast } from 'sonner';
import { copy, copy2 } from '@/lib/copy';
import { googleCalendarUrl } from '@/lib/calendar';
import { buyRequest, meetupsMaya, photoResult, placeById, userById } from '@/lib/data';
import { money } from '@/lib/money';
import { useDemo } from '@/lib/store';
import { StickerMap } from '@/components/StickerMap';
import { SpotRow } from '@/components/SpotRow';
import { MeetupBreakdown } from '@/components/MeetupBreakdown';
import { EmptyState, Pill, PillLink, ReliabilityBadge } from '@/components/ui';

// Flow A, seller side (features-v2 §2). Seller confirmed the price, so the seller picks.
export default function BuyRequest({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { maya, mayaSpot, set, celebrate } = useDemo();
  const [sel, setSel] = useState(meetupsMaya[0].id);
  const buyer = userById(buyRequest.buyer_id)!;
  const spot = meetupsMaya.find(m => m.id === (mayaSpot ?? sel))!;
  const place = placeById(spot.place_id);

  if (id !== buyRequest.id) return <EmptyState emoji="📭" line="That request is gone." action={<PillLink href="/activity" size="sm">Activity</PillLink>} />;

  const accept = () => { set(s => ({ ...s, maya: 'accepted' })); toast(copy2.req.held); };
  const pick = () => {
    set(s => ({ ...s, maya: 'picked', mayaSpot: sel }));
    setTimeout(() => {
      set(s => ({ ...s, maya: 'confirmed' }));
      const m = meetupsMaya.find(x => x.id === sel)!;
      celebrate({ kind: 'fieldgoal', title: copy.celebrate.fg, line: `Locked in: ${placeById(m.place_id).name} · ${m.start_label}` });
    }, 1500);
  };
  const handedOff = () => {
    set(s => ({
      ...s, maya: 'done',
      extraHistory: [{ id: 'h_mouse', emoji: '🖱️', title: 'Logitech mouse', partner: 'Maya T.', place_id: spot.place_id, date: 'Today', method: 'in_person', amount_cents: buyRequest.amount_cents, role: 'sold' }, ...s.extraHistory.filter(h => h.id !== 'h_mouse')],
    }));
    celebrate({ kind: 'touchdown', title: copy.celebrate.td, line: copy2.td.inpersonSeller });
  };

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="stk flex flex-col gap-4 rounded-[24px] bg-card p-5 sm:flex-row sm:items-center">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-[2.5px] border-ink bg-butter text-4xl">{buyer.avatar_emoji}</span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[26px] font-bold">{copy2.req.title}</h1>
          <p className="text-[14px] font-semibold text-soft">{photoResult.emoji} {photoResult.title} · {money(buyRequest.amount_cents)} · &ldquo;{buyRequest.message}&rdquo;</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <ReliabilityBadge r={buyer.reliability} />
            <span className="rounded-full border-2 border-ink bg-mint px-2 py-0.5 text-[11px] font-extrabold text-dark-ink">{maya === 'none' || maya === 'requested' ? copy2.req.money : copy2.req.held}</span>
          </div>
        </div>
        {(maya === 'none' || maya === 'requested') && (
          <div className="flex gap-2">
            <Pill onClick={accept}>{copy2.req.accept}</Pill>
            <Pill variant="neutral" onClick={() => toast('Declined. Maya will see it politely.')}>{copy2.req.decline}</Pill>
          </div>
        )}
      </div>

      {maya !== 'none' && maya !== 'requested' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <StickerMap spots={meetupsMaya} selected={mayaSpot ?? sel} onSelect={id => maya === 'accepted' && setSel(id)} className="aspect-[4/3] w-full" />
          <section className="rounded-[28px] border-[2.5px] border-ink bg-card p-5 shadow-[5px_5px_0_var(--shadow)]">
            <p className="text-[11.5px] font-extrabold uppercase tracking-wide text-accent-text">{copy2.pick.you}</p>
            <h2 className="font-display mt-1 text-[21px] font-bold">{copy2.pick.title}</h2>
            <div className="mt-4 space-y-1.5">
              {meetupsMaya.map((m, i) => <SpotRow key={m.id} s={m} i={i} selected={(mayaSpot ?? sel) === m.id} onSelect={() => maya === 'accepted' && setSel(m.id)} />)}
            </div>
            {maya === 'accepted' && <Pill size="lg" className="mt-5 w-full" onClick={pick}>Lock in {place.name} →</Pill>}
            {maya === 'picked' && <p className="mt-5 text-center font-bold text-soft">{copy2.pick.waiting}</p>}
            {(maya === 'confirmed' || maya === 'done') && (
              <div className="mt-5 space-y-3">
                <p className="font-bold">{copy2.pick.confirmed}</p>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border-2 border-ink bg-butter px-3 py-1.5 text-[12.5px] font-extrabold text-dark-ink">{copy2.cal.added}</span>
                  <a href={googleCalendarUrl({ title: 'Handoff: Logitech mouse with Maya', startIso: spot.start_iso, place: place.name })} target="_blank" rel="noreferrer" className="press inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-card px-3 py-1.5 text-[12px] font-extrabold uppercase shadow-[2px_2px_0_var(--shadow)]">
                    <CalendarPlus size={14} /> Add to Google Calendar
                  </a>
                </div>
                {maya === 'confirmed' ? <Pill size="lg" className="w-full" onClick={handedOff}>Mark as handed off</Pill> : <PillLink href="/history" className="w-full">See your handoff history →</PillLink>}
              </div>
            )}
            <div className="mt-4"><MeetupBreakdown partner="Maya" spots={meetupsMaya} partnerBlocks={[{ course: 'MKT 300', start: '11:00', end: '12:00' }, { course: 'MKT 321', start: '13:00', end: '14:15' }, { course: 'FI 302', start: '16:00', end: '17:15' }]} /></div>
          </section>
        </motion.div>
      )}
    </div>
  );
}
