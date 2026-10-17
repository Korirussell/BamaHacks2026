'use client';
import { motion } from 'framer-motion';
import { places } from '@/lib/data';
import type { MeetupSuggestion } from '@/lib/types';

// places.json positions only fill the top ~60% of the box; stretch them vertically.
const Y = 1.45;

export function StickerMap({ spots, selected, onSelect, className = '' }: { spots: MeetupSuggestion[]; selected?: string; onSelect?: (id: string) => void; className?: string }) {
  return (
    <div className={`stk map-ground relative overflow-hidden rounded-[24px] ${className}`} role="img" aria-label="Campus map with three suggested handoff spots">
      <div className="absolute inset-x-0 bottom-0 top-[44px]">
      {places.map(p => (
        <div
          key={p.id}
          className="absolute flex items-center justify-center rounded-[8px] border-2 border-ink bg-card px-1 text-center shadow-[2px_2px_0_var(--shadow)]"
          style={{ left: `${p.map.x}%`, top: `${p.map.y * Y}%`, width: `${p.map.w}%`, height: `${p.map.h * Y}%` }}
        >
          <span className="truncate text-[8px] font-extrabold uppercase tracking-wide sm:text-[9.5px]">
            {p.is_safe_zone && '🛡 '}{p.name}
          </span>
        </div>
      ))}
      {spots.map((s, i) => {
        const p = places.find(x => x.id === s.place_id)!;
        const on = selected === s.id;
        return (
          <motion.button
            key={s.id}
            onClick={() => onSelect?.(s.id)}
            aria-label={`Spot ${i + 1}: ${p.name}, ${s.start_label}`}
            className="absolute z-10 -translate-x-1/2 -translate-y-full"
            style={{ left: `${p.map.x + p.map.w / 2}%`, top: `${p.map.y * Y}%`, originY: 1 }}
            initial={{ y: -30, opacity: 0 }}
            animate={{ y: 0, opacity: 1, scale: on ? 1.15 : 1 }}
            transition={{ delay: 0.2 + i * 0.12, type: 'spring', stiffness: 400, damping: 15 }}
          >
            <svg width="34" height="44" viewBox="0 0 34 44" aria-hidden>
              <path d="M17 42 C17 42 3 26 3 16 A14 14 0 1 1 31 16 C31 26 17 42 17 42 Z" fill={on ? 'var(--butter)' : 'var(--accent)'} stroke="var(--ink)" strokeWidth="2.5" />
              <text x="17" y="21" textAnchor="middle" fontSize="15" fontWeight="800" fill={on ? '#1A1414' : '#fff'} fontFamily="var(--font-archivo)">{i + 1}</text>
            </svg>
          </motion.button>
        );
      })}
      </div>
    </div>
  );
}
