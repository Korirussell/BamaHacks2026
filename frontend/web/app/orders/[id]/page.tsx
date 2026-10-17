'use client';
import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { CalendarPlus, Star } from 'lucide-react';
import { toast } from 'sonner';
import { copy, copy2 } from '@/lib/copy';
import { googleCalendarUrl } from '@/lib/calendar';
import { listings, locker, meetupsZoe, placeById, userById } from '@/lib/data';
import { money } from '@/lib/money';
import { useDemo } from '@/lib/store';
import { StickerMap } from '@/components/StickerMap';
import { MeetupBreakdown } from '@/components/MeetupBreakdown';
import { LockerCard } from '@/components/LockerCard';
import { EmptyState, Pill, PillLink, ReliabilityBadge } from '@/components/ui';

// Zoe's day (web-only mock addition, used for the schedule breakdown).
const ZOE_BLOCKS = [
  { course: 'NUR 210', start: '09:30', end: '10:45' },
  { course: 'BSC 215', start: '12:30', end: '13:45' },
  { course: 'NUR lab', start: '15:00', end: '16:00' },
];

const STAGES = ['none', 'bought', 'picked', 'confirmed', 'dropped', 'done'] as const;

function Sys({ children }: { children: React.ReactNode }) {
  return <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-[90%] rounded-full border-2 border-ink bg-sunk px-4 py-2 text-center text-[13px] font-bold">{children}</motion.p>;
}
function Bubble({ me, children }: { me?: boolean; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`flex ${me ? 'justify-end' : 'justify-start'}`}>
      <p className={`max-w-[78%] rounded-[18px] border-2 border-ink px-4 py-2.5 text-[15px] font-semibold shadow-[3px_3px_0_var(--shadow)] ${me ? 'rounded-br-[6px] bg-mint text-dark-ink' : 'rounded-bl-[6px] bg-card'}`}>{children}</p>
    </motion.div>
  );
}

export default function OrderChat({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { zoe, zoeSpot, set, celebrate } = useDemo();
  const [sel, setSel] = useState(meetupsZoe[0].id);
  const [stars, setStars] = useState(0);
  const [intro, setIntro] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  const owala = listings.find(l => l.id === 'l_owala')!;
  const zoeUser = userById('u_zoe')!;
  const stage = STAGES.indexOf(zoe);
  const spot = meetupsZoe.find(m => m.id === (zoeSpot ?? sel))!;
  const place = placeById(spot.place_id);
  const isLocker = spot.method === 'locker';

  // Scripted intro: z1 (0 ms), z2 (300 ms), picker (600 ms)
  useEffect(() => { const t = [setTimeout(() => setIntro(1), 0), setTimeout(() => setIntro(2), 300), setTimeout(() => setIntro(3), 600)]; return () => t.forEach(clearTimeout); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [zoe, intro]);

  // Mock drop-off ~4 s after both confirm (locker only).
  useEffect(() => {
    if (zoe !== 'confirmed' || !isLocker) return;
    const t = setTimeout(() => {
      set(s => (s.zoe === 'confirmed' ? { ...s, zoe: 'dropped' } : s));
      toast(`${copy2.locker.ready} · Locker ${locker.locker_number} · code ${locker.pickup_code}`);
    }, 4000);
    return () => clearTimeout(t);
  }, [zoe, isLocker, set]);

  if (id !== 'o_owala') return <EmptyState emoji="📦" line="We couldn't find that order." action={<PillLink href="/feed" size="sm">Back to the feed</PillLink>} />;
  if (stage < 1)
    return <EmptyState emoji="🥤" line="You haven't bought the Owala yet." action={<PillLink href="/listings/l_owala" size="sm">See the Owala</PillLink>} />;

  const pick = () => {
    set(s => ({ ...s, zoe: 'picked', zoeSpot: sel }));
    setTimeout(() => {
      set(s => (s.zoe === 'picked' ? { ...s, zoe: 'confirmed' } : s));
      const p = placeById(meetupsZoe.find(m => m.id === sel)!.place_id);
      celebrate({ kind: 'fieldgoal', title: copy.celebrate.fg, line: `Locked in: ${p.name} · ${meetupsZoe.find(m => m.id === sel)!.start_label}` });
    }, 1500);
  };

  const pickedUp = () => {
    set(s => ({
      ...s,
      zoe: 'done',
      extraHistory: [{ id: 'h_owala', emoji: '🥤', title: 'Owala FreeSip', partner: 'Zoe M.', place_id: spot.place_id, date: 'Today', method: isLocker ? 'locker' : 'in_person', amount_cents: 1500, role: 'bought' }, ...s.extraHistory.filter(h => h.id !== 'h_owala')],
    }));
    celebrate({ kind: 'touchdown', title: copy.celebrate.td, line: copy2.td.locker });
  };

  return (
    <div className="mx-auto max-w-[720px]">
      <div className="stk flex items-center gap-3 rounded-[20px] bg-card p-3.5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] border-2 border-ink bg-mint text-3xl">{owala.emoji}</div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display truncate text-[18px] font-bold">{owala.title}</h1>
          <p className="text-[12.5px] font-semibold text-soft">{money(owala.price_cents)} · held 🔒 · {zoeUser.display_name}</p>
          <div className="mt-1"><ReliabilityBadge r={zoeUser.reliability} /></div>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 pb-10">
        {intro >= 1 && <Sys>You bought Owala FreeSip 24oz for $15 ✓ Price confirmed</Sys>}
        {intro >= 2 && <Sys>{copy2.pick.you}</Sys>}

        {intro >= 3 && stage === 1 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="stk rounded-[24px] bg-card p-4 sm:p-5">
            <p className="text-[11.5px] font-extrabold uppercase tracking-wide text-accent-text">Pick the spot</p>
            <h2 className="font-display mt-1 text-[21px] font-bold">Lockers or meet up, your call</h2>
            <StickerMap spots={meetupsZoe} selected={sel} onSelect={setSel} className="mt-4 aspect-[16/10] w-full" />
            <div className="mt-4 space-y-1.5">
              {meetupsZoe.map((m, i) => {
                const p = placeById(m.place_id);
                const on = sel === m.id;
                return (
                  <button key={m.id} onClick={() => setSel(m.id)} aria-pressed={on} className={`flex w-full items-center gap-3 rounded-[18px] border-2 px-3.5 py-3 text-left transition-all ${on ? 'border-ink bg-butter text-dark-ink shadow-[4px_4px_0_var(--shadow)]' : 'border-transparent hover:border-ink'}`}>
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-ink text-[12px] font-extrabold ${on ? 'bg-white text-[#1A1414]' : 'bg-accent text-on-accent'}`}>{i + 1}</span>
                    <span className="text-xl" aria-hidden>{m.method === 'locker' ? '🔐' : '🤝'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-extrabold">{p.name}</span>
                      <span className={`block text-[11.5px] font-semibold ${on ? 'opacity-75' : 'text-soft'}`}>{m.method === 'locker' ? 'Drop off by 6:00 PM · pick up anytime' : m.start_label} · {m.reason}</span>
                    </span>
                    <span className={`shrink-0 text-[11.5px] font-bold ${on ? '' : 'text-soft'}`}>{m.walk_minutes.me} / {m.walk_minutes.them} min</span>
                  </button>
                );
              })}
            </div>
            <Pill size="lg" className="mt-4 w-full" onClick={pick}>Pick {place.name} →</Pill>
            <div className="mt-4"><MeetupBreakdown partner="Zoe" partnerBlocks={ZOE_BLOCKS} spots={meetupsZoe} /></div>
          </motion.div>
        )}

        {stage >= 2 && <Bubble me>{place.name} works for me</Bubble>}
        {stage === 2 && <p className="text-[12.5px] font-bold text-soft">Zoe is typing…</p>}
        {stage >= 3 && (
          <>
            <Bubble>{isLocker ? "I'm good 👍 dropping it after class" : "Works for me 👍 see you there"}</Bubble>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="rounded-full border-2 border-ink bg-butter px-3 py-1.5 text-[12.5px] font-extrabold text-dark-ink">{copy2.cal.addedZoe}</span>
              <a
                href={googleCalendarUrl({ title: 'Handoff: Owala FreeSip with Zoe', startIso: spot.start_iso, place: place.name })}
                target="_blank"
                rel="noreferrer"
                className="press inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-card px-3 py-1.5 text-[12px] font-extrabold uppercase shadow-[2px_2px_0_var(--shadow)]"
              >
                <CalendarPlus size={14} /> Add to Google Calendar
              </a>
            </div>
          </>
        )}
        {stage === 3 && isLocker && <p className="text-center text-[12.5px] font-bold text-soft">Waiting for Zoe to drop it off…</p>}
        {stage === 3 && !isLocker && (
          <div className="text-center"><PillLink href="/handoff/o_owala">Go to handoff →</PillLink></div>
        )}
        {stage >= 4 && <Sys>Zoe dropped it in Locker {locker.locker_number} at {place.name}</Sys>}
        {stage === 4 && <LockerCard onPickedUp={pickedUp} />}
        {stage === 5 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="stk rounded-[24px] bg-card p-6 text-center">
            <p className="text-4xl">🥤</p>
            <h2 className="font-display mt-2 text-[22px] font-bold">Got it. $15 released to Zoe.</h2>
            <p className="mt-1 font-semibold text-soft">How was it?</p>
            <div className="mt-3 flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} aria-label={`${n} stars`} onClick={() => { setStars(n); toast('Thanks! Zoe’s reliability went up.'); }}>
                  <Star size={32} strokeWidth={2.2} className={n <= stars ? 'fill-[#FFD84D] text-ink' : 'text-soft'} />
                </button>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <PillLink href="/history">See your handoff history →</PillLink>
              <Pill variant="neutral" onClick={() => set(s => ({ ...s, zoe: 'bought', zoeSpot: null }))}>Run it again</Pill>
            </div>
          </motion.div>
        )}
        <div ref={end} />
      </div>
      <p className="text-center text-[12px] font-semibold text-soft"><Link href="/feed?view=foryou" className="underline">Back to For you</Link></p>
    </div>
  );
}
