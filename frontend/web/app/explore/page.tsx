'use client';
import Link from 'next/link';
import { PageTitle, StickerCard } from '@/components/ui';

const CATS = [
  ['📘', 'Textbooks', '/feed', 'peach'], ['🧪', 'Lab supplies', '/feed', 'mint'], ['🛋️', 'Dorm gear', '/feed', 'butter'],
  ['🎟️', 'Tickets', '/tickets', 'peach'], ['🚗', 'Rides', '/rides', 'mint'], ['🧑‍🏫', 'Tutoring', '/tutoring', 'butter'],
  ['📸', 'From Instagram', '/feed', 'peach'], ['🖼️', 'Screenshot → listing', '/post', 'mint'],
] as const;

export default function Explore() {
  return (
    <div className="mx-auto max-w-[1000px]">
      <PageTitle title="Explore" sub="University of Alabama · cross-campus with Auburn for tickets and rides" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {CATS.map(([e, l, h, t]) => (
          <Link key={l} href={h}>
            <StickerCard className="press flex h-full flex-col gap-3 p-4">
              <span className="flex h-14 w-14 items-center justify-center rounded-[16px] border-2 border-ink text-3xl" style={{ background: `var(--${t})` }}>{e}</span>
              <span className="font-display text-[17px] font-bold">{l}</span>
            </StickerCard>
          </Link>
        ))}
      </div>
    </div>
  );
}
