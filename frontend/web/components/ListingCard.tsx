'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Listing } from '@/lib/types';
import { money } from '@/lib/money';
import { userById } from '@/lib/data';
import { GhostBadge, ItemTile, ReasonChip, Tag } from './ui';

export function ListingCard({ listing, onWant, className = '', static: isStatic }: { listing: Listing; onWant?: (l: Listing) => void; className?: string; static?: boolean }) {
  const router = useRouter();
  const ghost = listing.status === 'ghost';
  const seller = userById(listing.seller_id);
  const meta = ghost
    ? `${listing.source.author_handle} · ${listing.source.posted_ago}`
    : [seller?.display_name, listing.location_label].filter(Boolean).join(' · ');
  const action = ghost ? 'I want this' : listing.negotiable ? 'Offer' : 'Buy';
  return (
    <article className={`${ghost ? 'ghost-stk' : 'stk'} ${isStatic ? '' : 'press'} relative flex flex-col overflow-hidden rounded-[20px] bg-card ${className}`}>
      <Link href={`/listings/${listing.id}`} className="absolute inset-0 z-0" aria-label={listing.title} tabIndex={isStatic ? -1 : 0} />
      <ItemTile listing={listing} size={58} className="pointer-events-none aspect-[4/3]">
        <div className="absolute left-2.5 top-2.5 flex gap-1.5">
          {ghost && listing.source.author_handle ? <GhostBadge handle={listing.source.author_handle} /> : listing.tag ? <Tag>{listing.tag}</Tag> : null}
        </div>
        {ghost && listing.interest && (
          <span className="absolute bottom-2 right-2.5 rounded-full border-2 border-[#1A1414] bg-white px-2 py-0.5 text-[11px] font-extrabold text-[#1A1414]">🔥 {listing.interest.count} want it</span>
        )}
      </ItemTile>
      <div className="pointer-events-none flex flex-1 flex-col gap-1.5 p-3">
        <div className="min-h-[20px]"><ReasonChip reason={listing.reason} /></div>
        <h3 className="font-display text-[15px] font-bold leading-tight">{listing.title}</h3>
        <p className="truncate text-[12px] font-semibold text-soft">{meta || ' '}</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <span className="font-display text-[19px] font-bold">{money(listing.price_cents)}</span>
          <button
            tabIndex={isStatic ? -1 : 0}
            onClick={e => {
              e.preventDefault();
              if (ghost && onWant) onWant(listing);
              else router.push(`/listings/${listing.id}`);
            }}
            className={`pointer-events-auto relative z-10 rounded-full border-2 border-ink px-3 py-1.5 text-[11px] font-extrabold uppercase shadow-[2px_2px_0_var(--shadow)] ${ghost ? 'bg-butter text-dark-ink' : listing.negotiable ? 'bg-card text-ink' : 'bg-accent text-on-accent'}`}
          >
            {action}
          </button>
        </div>
      </div>
    </article>
  );
}

export function ListingCardSkeleton() {
  return (
    <div className="stk overflow-hidden rounded-[20px] bg-card">
      <div className="skel aspect-[4/3] rounded-none" />
      <div className="space-y-2 p-3">
        <div className="skel h-4 w-16 rounded-full" />
        <div className="skel h-4 w-3/4 rounded-md" />
        <div className="skel h-3 w-1/2 rounded-md" />
        <div className="skel h-6 w-full rounded-full" />
      </div>
    </div>
  );
}
