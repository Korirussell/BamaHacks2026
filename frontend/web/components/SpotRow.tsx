'use client';
import { placeById } from '@/lib/data';
import type { MeetupSuggestion } from '@/lib/types';

export function SpotRow({ s, i, selected, onSelect }: { s: MeetupSuggestion; i: number; selected: boolean; onSelect: () => void }) {
  const p = placeById(s.place_id);
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full items-center gap-3 rounded-[18px] border-2 px-3.5 py-3 text-left transition-all duration-150 ${selected ? 'border-ink bg-butter text-dark-ink shadow-[4px_4px_0_var(--shadow)]' : 'border-transparent hover:border-ink hover:bg-card'}`}
    >
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-ink text-[12px] font-extrabold ${selected ? 'bg-white text-[#1A1414]' : 'bg-accent text-on-accent'}`}>{i + 1}</span>
      <span className="w-[70px] shrink-0 text-[14.5px] font-extrabold tabular-nums">{s.start_label}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-extrabold">{p.name}{p.is_safe_zone && ' 🛡'}</span>
        <span className={`block text-[11px] font-semibold ${selected ? 'opacity-75' : 'text-soft'}`}>{s.reason}</span>
      </span>
      <span className={`shrink-0 text-right text-[11.5px] font-bold ${selected ? '' : 'text-soft'}`}>
        {s.walk_minutes.me} min / {s.walk_minutes.them} min
      </span>
    </button>
  );
}
