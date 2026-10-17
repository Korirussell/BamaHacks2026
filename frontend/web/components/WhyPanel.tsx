'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import Link from 'next/link';
import { copy2 } from '@/lib/copy';
import { wishlist } from '@/lib/data';
import type { Listing } from '@/lib/types';

type ForYou = (typeof wishlist.for_you)[number];

/** "Why you're seeing this" (features-v2 §5.3) */
export function WhyPanel({ item, listing, onClose }: { item: ForYou | null; listing?: Listing; onClose: () => void }) {
  const w = item && wishlist.items.find(x => x.id === item.wishlist_id);
  const rows = item
    ? [
        ['🎯', 'Wishlist match', `"${w?.label}" → "${listing?.title}" · semantic match ${item.breakdown.semantic_match.toFixed(2)}`],
        ['💸', 'Budget fit', item.breakdown.budget],
        ['📍', 'Distance', item.breakdown.distance],
        ['🗓️', 'Schedule overlap', item.breakdown.schedule],
        ['🤝', 'Seller trust', item.breakdown.trust],
      ]
    : [];
  return (
    <AnimatePresence>
      {item && (
        <motion.div className="fixed inset-0 z-[80] flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button aria-label="Close" className="absolute inset-0 bg-[#1A1414]/40" onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={copy2.foryou.why}
            initial={{ x: 420 }}
            animate={{ x: 0 }}
            exit={{ x: 440 }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            className="relative h-full w-full max-w-[420px] overflow-y-auto border-l-[2.5px] border-ink bg-bg p-6"
          >
            <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-full p-1.5 hover:bg-sunk"><X size={20} /></button>
            <p className="label text-[11px] text-accent-text">{copy2.foryou.why}</p>
            <h2 className="font-display mt-1 text-[24px] font-bold">{listing?.emoji} {listing?.title}</h2>
            <p className="mt-1 font-semibold text-soft">{item.reason}</p>
            <ol className="mt-5 space-y-3">
              {rows.map(([e, k, v], i) => (
                <motion.li key={k} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.08 }} className="stk-sm flex gap-3 rounded-[16px] bg-card p-3">
                  <span className="text-xl" aria-hidden>{e}</span>
                  <div>
                    <p className="label text-[10.5px] text-soft">{k}</p>
                    <p className="text-[14px] font-bold">{v}</p>
                  </div>
                </motion.li>
              ))}
            </ol>
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <span className="label text-[11px] text-soft">Final score</span>
                <span className="font-display text-[26px] font-bold">{item.score}/100</span>
              </div>
              <div className="mt-2 h-5 overflow-hidden rounded-full border-[2.5px] border-ink bg-sunk">
                <motion.div className="h-full bg-accent" initial={{ width: 0 }} animate={{ width: `${item.score}%` }} transition={{ delay: 0.5, duration: 0.8 }} />
              </div>
            </div>
            {listing && <Link href={`/listings/${listing.id}`} onClick={onClose} className="stk-btn label mt-6 flex w-full justify-center rounded-full bg-accent px-5 py-3 text-on-accent">See it →</Link>}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
