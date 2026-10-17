'use client';
import Link from 'next/link';
import { extras, listings } from '@/lib/data';
import { SimpleList } from '@/components/SimpleList';
import { PillLink, StickerCard } from '@/components/ui';

export default function Tickets() {
  const ticket = listings.find(l => l.category === 'ticket');
  return (
    <>
      <SimpleList
        title="Tickets & rides"
        sub="Student tickets, transferred safely. Money held until it's in your app."
        items={extras.events}
        empty="No games coming up."
        render={e => (
          <StickerCard key={e.id} className="p-5">
            <p className="text-3xl">🎟️</p>
            <p className="font-display mt-2 text-[21px] font-bold">{e.name}</p>
            <p className="text-[13.5px] font-semibold text-soft">{e.when} · {e.tickets} student tickets</p>
            <div className="mt-4">
              {ticket && e.id === 'e2' ? <PillLink href={`/listings/${ticket.id}`} size="sm">See tickets</PillLink> : <PillLink href="/feed" variant="neutral" size="sm">Browse</PillLink>}
            </div>
          </StickerCard>
        )}
      />
      <p className="mx-auto mt-8 max-w-[900px] text-[13.5px] font-bold">Need a ride instead? <Link href="/rides" className="text-accent-text underline">See rides →</Link></p>
    </>
  );
}
