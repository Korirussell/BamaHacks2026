'use client';
import { toast } from 'sonner';
import { extras, userById } from '@/lib/data';
import { money } from '@/lib/money';
import { SimpleList } from '@/components/SimpleList';
import { Pill, StickerCard } from '@/components/ui';

export default function Rides() {
  return (
    <SimpleList
      title="Rides"
      sub="Verified student drivers. Split the gas, skip the GroupMe."
      items={extras.rides}
      empty="No rides posted yet."
      render={r => {
        const u = userById(r.driver_id)!;
        return (
          <StickerCard key={r.id} className="p-5">
            <p className="font-display text-[22px] font-bold">{r.from} → {r.to}</p>
            <p className="mt-1 text-[13.5px] font-semibold text-soft">{r.when} · {u.display_name} {u.avatar_emoji}</p>
            <div className="mt-4 flex items-center justify-between">
              <span className="rounded-full border-2 border-ink bg-mint px-2.5 py-0.5 text-[11.5px] font-extrabold text-dark-ink">{r.seats_left} of {r.seats_total} seats left</span>
              <Pill size="sm" onClick={() => toast(`Seat requested from ${u.display_name}`)}>{money(r.price_cents)} · Request</Pill>
            </div>
          </StickerCard>
        );
      }}
    />
  );
}
