'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { Heart } from 'lucide-react';
import type { Listing } from '@/lib/types';
import { money } from '@/lib/money';
import { categoryIconFor, GhostBadge, Tag, timeAgo } from './ui';

const COND: Record<string, string> = { new: 'New', like_new: 'Like new', good: 'Good', fair: 'Fair', poor: 'Poor' };

export function ListingCard({ listing, className = '', static: isStatic, reasonText, onWhy, priority }: { listing: Listing; onWant?: (l: Listing) => void; className?: string; static?: boolean; reasonText?: string; onWhy?: () => void; priority?: boolean }) {
  const [saved, setSaved] = useState(false);
  const ghost = listing.status === 'ghost';
  const soldOut = listing.status === 'sold' || listing.status === 'pending';
  const images = listing.images ?? [];
  const dropped = listing.original_price_cents && listing.original_price_cents > listing.price_cents;
  const Icon = categoryIconFor(listing);

  const meta = ghost
    ? `🔥 ${listing.interest?.count ?? 0} want this · Not on Handoff yet`
    : [COND[listing.condition], listing.location_label, timeAgo(listing.created_at)].filter(Boolean).join(' · ');

  const badge = reasonText ? null
    : ghost && listing.source.author_handle ? <GhostBadge handle={listing.source.author_handle} />
    : listing.reason === 'your_class' ? <Tag>Your class</Tag>
    : listing.reason === 'wishlist_match' ? <Tag>Wishlist match</Tag>
    : dropped ? <Tag className="text-price-drop">Price drop</Tag>
    : listing.reason === 'new' ? <Tag>New</Tag>
    : null;

  return (
    <article className={`group relative flex flex-col ${isStatic ? '' : 'cursor-pointer'} ${className}`}>
      <Link href={`/listings/${listing.id}`} className="absolute inset-0 z-0 rounded-xl" aria-label={listing.title} tabIndex={isStatic ? -1 : 0} />
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-xl bg-img-bg">
        {images[0] ? (
          <>
            <Image
              src={images[0]}
              alt={listing.title}
              fill
              priority={priority}
              sizes="(max-width: 768px) 50vw, 20vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
            {images[1] && (
              <Image
                src={images[1]}
                alt=""
                fill
                sizes="(max-width: 768px) 50vw, 20vw"
                className="object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              />
            )}
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-meta">
            <Icon size={28} strokeWidth={1.75} aria-hidden />
          </div>
        )}

        {soldOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="glass-badge rounded-full px-3 py-1 text-[12px] font-semibold uppercase tracking-wide">{listing.status === 'sold' ? 'Sold' : 'Pending'}</span>
          </div>
        )}

        <div className="pointer-events-none absolute left-2 top-2 flex gap-1.5">
          {reasonText ? (
            <span className="pointer-events-auto inline-flex items-center gap-1">
              <span className="glass-badge inline-flex rounded-full px-2.5 py-1 text-[11.5px] font-semibold">{reasonText}</span>
              {onWhy && (
                <button onClick={e => { e.preventDefault(); onWhy(); }} aria-label="Why you're seeing this" className="glass-badge relative z-10 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold">i</button>
              )}
            </span>
          ) : badge}
        </div>

        {images.length > 1 && (
          <div className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            {images.map((_, i) => (
              <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === 0 ? 'bg-white' : 'bg-white/50'}`} />
            ))}
          </div>
        )}

        <button
          tabIndex={isStatic ? -1 : 0}
          onClick={e => { e.preventDefault(); setSaved(s => !s); }}
          aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
          aria-pressed={saved}
          className="glass-badge pointer-events-auto absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full transition-transform active:scale-90"
        >
          <Heart size={16} strokeWidth={2.2} className={saved ? 'scale-110 fill-accent text-accent transition-transform' : 'text-ink transition-transform'} />
        </button>
      </div>

      <div className="pointer-events-none flex flex-1 flex-col gap-0.5 pt-2.5">
        <div className="flex items-baseline gap-1.5 text-[16px] font-bold tabular-nums">
          <span style={dropped ? { color: 'var(--price-drop)' } : undefined}>{money(listing.price_cents)}</span>
          {dropped && <span className="text-[13px] font-semibold text-meta line-through">{money(listing.original_price_cents!)}</span>}
        </div>
        <h3 className="truncate text-[14px] font-medium text-ink">{listing.title}</h3>
        <p className="truncate text-[12.5px] font-normal text-meta">{meta}</p>
      </div>
    </article>
  );
}

export function ListingCardSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="skel aspect-[4/5] rounded-xl" />
      <div className="space-y-1.5">
        <div className="skel h-4 w-14 rounded-md" />
        <div className="skel h-3.5 w-3/4 rounded-md" />
        <div className="skel h-3 w-1/2 rounded-md" />
      </div>
    </div>
  );
}
