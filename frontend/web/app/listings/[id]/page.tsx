'use client';
import Link from 'next/link';
import { use, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { copy } from '@/lib/copy';
import { money } from '@/lib/money';
import { userById } from '@/lib/data';
import { useDemo, useMockLoad } from '@/lib/store';
import { BidBubbles } from '@/components/BidBubbles';
import { InterestSheet } from '@/components/InterestSheet';
import { EmptyState, ErrorState, GhostBadge, Pill, PillLink, PriceTag, ReliabilityBadge, Skeleton, Tag, tileBg } from '@/components/ui';

const COND: Record<string, string> = { new: 'New', like_new: 'Like new', good: 'Good', fair: 'Fair', poor: 'Poor' };

function TiltTile({ emoji, tile, children }: { emoji: string; tile: 'peach' | 'mint' | 'butter'; children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const rx = useSpring(useMotionValue(0), { stiffness: 200, damping: 18 });
  const ry = useSpring(useMotionValue(0), { stiffness: 200, damping: 18 });
  return (
    <motion.div
      ref={ref}
      onMouseMove={e => {
        if (reduce || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        ry.set(((e.clientX - r.left) / r.width - 0.5) * 12);
        rx.set(-((e.clientY - r.top) / r.height - 0.5) * 12);
      }}
      onMouseLeave={() => { rx.set(0); ry.set(0); }}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 900, background: tileBg(tile) }}
      className="stk relative flex aspect-square w-full items-center justify-center rounded-[24px]"
    >
      <span style={{ fontSize: 120, lineHeight: 1 }} aria-hidden>{emoji}</span>
      {children}
    </motion.div>
  );
}

export default function ListingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { listings, bids, celebrate } = useDemo();
  const { status, retry } = useMockLoad([id]);
  const [want, setWant] = useState(false);
  const listing = listings.find(l => l.id === id);

  if (status === 'error') return <ErrorState onRetry={retry} />;
  if (status === 'loading')
    return (
      <div className="mx-auto grid max-w-[1100px] gap-10 md:grid-cols-2">
        <Skeleton className="aspect-square w-full rounded-[24px]" />
        <div className="space-y-4"><Skeleton className="h-10 w-3/4" /><Skeleton className="h-8 w-1/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-14 w-full rounded-full" /></div>
      </div>
    );
  if (!listing) return <EmptyState emoji="🔎" line="That listing's gone. Maybe someone already made the handoff." action={<PillLink href="/feed" size="sm">Back to the feed</PillLink>} />;

  const ghost = listing.status === 'ghost';
  const seller = userById(listing.seller_id);
  const listingBids = bids.filter(b => b.listing_id === listing.id);
  const claimedFromIg = !ghost && listing.source.channel === 'instagram';

  return (
    <div className="mx-auto max-w-[1100px]">
      <button onClick={() => router.back()} className="label mb-5 inline-flex items-center gap-1.5 text-[12px] text-soft hover:text-ink"><ArrowLeft size={16} strokeWidth={2.6} /> Back</button>
      <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="md:sticky md:top-8 md:self-start">
          <TiltTile emoji={listing.emoji} tile={listing.tile}>
            <div className="absolute left-4 top-4">
              {ghost && listing.source.author_handle ? <GhostBadge handle={listing.source.author_handle} /> : listing.tag ? <Tag>{listing.tag}</Tag> : null}
            </div>
          </TiltTile>
        </div>

        <div className="min-w-0">
          <h1 className="font-display text-[34px] font-bold">{listing.title}</h1>
          <div className="mt-4"><PriceTag listing={listing} big /></div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border-2 border-ink bg-card px-3 py-1 text-[12px] font-extrabold">{COND[listing.condition]}</span>
            {listing.negotiable && <span className="rounded-full border-2 border-ink bg-card px-3 py-1 text-[12px] font-extrabold">Negotiable</span>}
            {listing.location_label && <span className="rounded-full border-2 border-ink bg-card px-3 py-1 text-[12px] font-extrabold">📍 {listing.location_label}</span>}
          </div>
          <p className="mt-5 text-[16px] font-medium leading-relaxed">{listing.description}</p>

          <div className="mt-6 flex items-center gap-3 rounded-[18px] border-2 border-ink bg-card p-3.5 shadow-[3px_3px_0_var(--shadow)]">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-ink bg-sunk text-2xl" aria-hidden>{ghost ? '📸' : seller?.avatar_emoji}</span>
            <div className="min-w-0">
              {ghost ? (
                <>
                  <p className="font-extrabold">{listing.source.author_handle}</p>
                  <p className="text-[13px] font-semibold text-soft">{copy.ghost.label}</p>
                </>
              ) : (
                <>
                  <p className="font-extrabold">{seller?.display_name} <span className="font-semibold text-soft">· {seller?.major}</span></p>
                  {seller && <div className="mt-1"><ReliabilityBadge r={seller.reliability} /></div>}
                </>
              )}
            </div>
          </div>

          {ghost && (
            <>
              <div className="mt-6 rounded-[20px] p-[3px] ig-grad">
                <div className="rounded-[17px] bg-card p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-extrabold">{listing.source.author_handle} <span className="font-semibold text-soft">· {listing.source.posted_ago}</span></span>
                    <span className="label text-[10.5px] text-soft">Instagram post</span>
                  </div>
                  <p className="mt-2 text-[16px] font-semibold italic">&ldquo;{listing.source.post_caption}&rdquo;</p>
                  <a href={listing.source.post_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[13px] font-extrabold text-accent-text hover:underline">View on Instagram <ExternalLink size={13} /></a>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between">
                <h2 className="font-display text-[21px] font-bold">🔥 {listing.interest?.count ?? 0} people want this</h2>
              </div>
              <div className="mt-4"><BidBubbles bids={listingBids} /></div>

              <div className="sticky bottom-[84px] z-20 mt-6 min-[900px]:bottom-6">
                <Pill variant="butter" size="lg" className="w-full" onClick={() => setWant(true)}>{copy.ghost.cta}</Pill>
              </div>
              <p className="mt-3 text-center text-[12.5px] font-semibold text-soft">{copy.ghost.fineprint}</p>
            </>
          )}

          {!ghost && claimedFromIg && listingBids.length > 0 && (
            <>
              <h2 className="font-display mt-7 text-[21px] font-bold">Offers waiting</h2>
              <div className="mt-4">
                <BidBubbles bids={listingBids} onAccept={b => toast(`Accepted ${money(b.amount_cents)} from ${userById(b.user_id)?.display_name ?? 'you'}. We'll find a spot.`)} />
              </div>
            </>
          )}

          {!ghost && (
            <div className="mt-7 flex flex-wrap gap-3">
              <Pill
                className="flex-1"
                onClick={() => celebrate({ kind: 'touchdown', title: copy.celebrate.td, line: `Paid ${money(listing.price_cents)}. It's held safe until the handoff.`, onDone: () => router.push('/meetup/o_fridge') })}
              >
                Buy now · {money(listing.price_cents)}
              </Pill>
              {listing.id === 'l_fridge' ? (
                <PillLink href="/offers/t_fridge" variant="neutral" className="flex-1">Make offer</PillLink>
              ) : (
                <Pill variant="neutral" className="flex-1" onClick={() => toast(`Offer sent to ${seller?.display_name ?? 'the seller'}. Thread expires in 47h.`)}>Make offer</Pill>
              )}
            </div>
          )}
          {!ghost && <p className="mt-3 text-[12.5px] font-semibold text-soft">🔒 Money&apos;s held until it&apos;s in your hands.</p>}
          <p className="mt-8 text-[12px] font-semibold text-soft"><Link href="/feed" className="hover:underline">← More from University of Alabama</Link></p>
        </div>
      </div>
      <InterestSheet listing={want ? listing : null} onClose={() => setWant(false)} />
    </div>
  );
}
