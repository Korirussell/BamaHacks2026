'use client';
import { motion } from 'framer-motion';
import { money } from '@/lib/money';
import { userById } from '@/lib/data';
import type { Bid } from '@/lib/types';

export function BidBubbles({ bids, onAccept }: { bids: Bid[]; onAccept?: (b: Bid) => void }) {
  return (
    <ul className="flex flex-col gap-3">
      {bids.map((b, i) => {
        const mine = b.user_id === 'u_kori';
        const u = userById(b.user_id);
        return (
          <motion.li
            key={b.id}
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: i * 0.06, type: 'spring', stiffness: 300, damping: 22 }}
            className={`flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''}`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-card text-lg" aria-hidden>{mine ? '🧑🏾‍💻' : u?.avatar_emoji}</span>
            <div className={`max-w-[78%] rounded-[18px] border-2 border-ink px-3.5 py-2.5 shadow-[3px_3px_0_var(--shadow)] ${mine ? 'rounded-br-[6px] bg-mint text-dark-ink' : 'rounded-bl-[6px] bg-card'}`}>
              <div className="flex items-center gap-2 text-[11.5px] font-extrabold opacity-75">
                <span>{mine ? 'You' : u?.display_name}</span>
                {b.amount_cents > 0 && <span className="rounded-full bg-butter px-1.5 text-dark-ink">{money(b.amount_cents)}</span>}
              </div>
              <p className="mt-0.5 text-[14.5px] font-semibold">{b.message}</p>
              <div className="mt-1.5 flex items-center gap-3 text-[12px] font-bold opacity-80">
                {b.reactions.fire > 0 && <span>🔥 {b.reactions.fire}</span>}
                {b.reactions.eyes > 0 && <span>👀 {b.reactions.eyes}</span>}
                {onAccept && b.amount_cents > 0 && !mine && (
                  <button onClick={() => onAccept(b)} className="press ml-auto rounded-full border-2 border-ink bg-accent px-3 py-1 text-[11px] font-extrabold uppercase text-on-accent shadow-[2px_2px_0_var(--shadow)]">
                    Accept
                  </button>
                )}
              </div>
            </div>
          </motion.li>
        );
      })}
    </ul>
  );
}
