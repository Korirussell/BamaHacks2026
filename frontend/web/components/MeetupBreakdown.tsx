'use client';
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { copy2 } from '@/lib/copy';
import { placeById, schedules } from '@/lib/data';
import type { MeetupSuggestion } from '@/lib/types';

type Block = { course: string; start: string; end: string };
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const DAY0 = 9 * 60, DAY1 = 21 * 60, SPAN = DAY1 - DAY0;
const pct = (m: number) => `${((m - DAY0) / SPAN) * 100}%`;

function freeOverlap(a: Block[], b: Block[]) {
  const busy = [...a, ...b].map(x => [toMin(x.start), toMin(x.end)] as const).sort((x, y) => x[0] - y[0]);
  const free: [number, number][] = [];
  let cur = DAY0;
  for (const [s, e] of busy) { if (s - cur >= 20) free.push([cur, s]); cur = Math.max(cur, e); }
  if (DAY1 - cur >= 20) free.push([cur, DAY1]);
  return free;
}

function Timeline({ who, blocks, free }: { who: string; blocks: Block[]; free: [number, number][] }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 shrink-0 text-[12px] font-extrabold">{who}</span>
      <div className="relative h-7 flex-1 overflow-hidden rounded-[8px] border-2 border-ink bg-mint">
        {free.map(([s, e]) => <span key={s} className="absolute inset-y-0 bg-butter" style={{ left: pct(s), width: `${((e - s) / SPAN) * 100}%` }} />)}
        {blocks.map(b => (
          <span key={b.course} title={`${b.course} ${b.start}–${b.end}`} className="absolute inset-y-0 flex items-center justify-center overflow-hidden border-x-2 border-ink bg-accent text-[9px] font-extrabold text-on-accent" style={{ left: pct(toMin(b.start)), width: `${((toMin(b.end) - toMin(b.start)) / SPAN) * 100}%` }}>
            {b.course}
          </span>
        ))}
      </div>
    </div>
  );
}

/** "How we picked these spots" (features-v2 §5.4), scoring per frontend-build.md §7.2. */
export function MeetupBreakdown({ partner, partnerBlocks, spots }: { partner: string; partnerBlocks?: Block[]; spots: MeetupSuggestion[] }) {
  const [open, setOpen] = useState(false);
  const me = schedules.u_kori;
  const them = partnerBlocks ?? schedules.u_kayla;
  const free = freeOverlap(me, them);
  return (
    <div className="rounded-[18px] border-2 border-dashed border-ink">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="font-display text-[16px] font-bold">🧠 {copy2.ai.spots}</span>
        <ChevronDown size={18} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-3 px-4 pb-4">
              <div className="flex justify-between pl-[60px] text-[10px] font-bold text-soft"><span>9 AM</span><span>12</span><span>3 PM</span><span>6</span><span>9 PM</span></div>
              <Timeline who="You" blocks={me} free={free} />
              <Timeline who={partner} blocks={them} free={free} />
              <p className="text-[11.5px] font-semibold text-soft"><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-accent align-middle" />class <span className="ml-2 mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-butter align-middle" />both free</p>
              <ul className="space-y-2">
                {spots.map(s => {
                  const p = placeById(s.place_id);
                  const { me: a, them: b } = s.walk_minutes;
                  const chips: [string, number][] = [[`walk ${a}+${b}`, -2 * (a + b)], [`fairness |${a}−${b}|`, -3 * Math.abs(a - b)]];
                  if (p.is_safe_zone) chips.push(['safe zone', 8]);
                  if (s.reason.toLowerCase().includes('get out of')) chips.push(['same class', 10]);
                  if (p.kind === 'locker') chips.push(['locker convenience', 6]);
                  return (
                    <li key={s.id} className="rounded-[14px] bg-sunk p-2.5">
                      <div className="flex items-center justify-between text-[12.5px] font-extrabold"><span>{p.name}</span><span className="font-display text-[16px]">{s.score}</span></div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {chips.map(([l, v]) => (
                          <span key={l} className={`rounded-full border-2 border-ink px-1.5 text-[10.5px] font-extrabold ${v >= 0 ? 'bg-mint text-dark-ink' : 'bg-card'}`}>{l} {v >= 0 ? '+' : ''}{v}</span>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
