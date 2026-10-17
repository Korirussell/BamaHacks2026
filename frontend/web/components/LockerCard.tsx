'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { copy2 } from '@/lib/copy';
import { locker, placeById } from '@/lib/data';
import { Pill } from './ui';

const hms = (s: number) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':');

export function LockerCard({ onPickedUp }: { onPickedUp: () => void }) {
  const [left, setLeft] = useState(locker.expires_in_seconds);
  useEffect(() => { const i = setInterval(() => setLeft(l => Math.max(0, l - 1)), 1000); return () => clearInterval(i); }, []);
  const place = placeById(locker.place_id);
  return (
    <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 20 }} className="stk overflow-hidden rounded-[24px] bg-card">
      <div className="flex items-center justify-between border-b-[2.5px] border-ink bg-mint px-5 py-3 text-dark-ink">
        <span className="label text-[11.5px]">🔐 {copy2.locker.ready}</span>
        <span className="text-[12px] font-bold">{place.name}</span>
      </div>
      <div className="p-5">
        <div className="flex items-center gap-5">
          <div className="text-center">
            <p className="label text-[10.5px] text-soft">Locker</p>
            <p className="font-display text-[64px] font-bold leading-none">{locker.locker_number}</p>
          </div>
          <div className="flex-1">
            <p className="label text-[10.5px] text-soft">{copy2.locker.code}</p>
            <div className="mt-1.5 flex gap-2">
              {locker.pickup_code.split('').map((d, i) => (
                <motion.span key={i} initial={{ rotateX: 90 }} animate={{ rotateX: 0 }} transition={{ delay: 0.2 + i * 0.1 }} className={`font-display flex h-[60px] w-12 items-center justify-center rounded-[12px] border-[2.5px] border-ink text-[40px] font-bold sm:w-14 sm:text-[44px] ${i === 0 ? 'bg-butter text-dark-ink' : 'bg-bg'}`}>{d}</motion.span>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[12.5px] font-bold text-soft">
          <span>Code expires in <span className="tabular-nums text-ink">{hms(left)}</span></span>
          <button onClick={() => { navigator.clipboard?.writeText(locker.pickup_code).catch(() => {}); toast('Code copied'); }} className="inline-flex items-center gap-1 rounded-full border-2 border-ink px-2.5 py-1 text-[11px] font-extrabold uppercase text-ink"><Copy size={12} /> Copy code</button>
        </div>
        <Pill size="lg" className="mt-5 w-full" onClick={onPickedUp}>{copy2.locker.done}</Pill>
      </div>
    </motion.div>
  );
}
