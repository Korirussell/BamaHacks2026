'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Heart, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { copy, copy2 } from '@/lib/copy';
import { money } from '@/lib/money';
import { userById } from '@/lib/data';
import { useDemo, useMockLoad } from '@/lib/store';
import { USE_MOCKS } from '@/lib/api';
import { realListing, realOffer } from '@/lib/real';
import { useRealLoad } from '@/lib/useRealLoad';
import { BidBubbles } from '@/components/BidBubbles';
import { InterestSheet } from '@/components/InterestSheet';
import { PaySheet } from '@/components/PaySheet';
import { ListingGallery } from '@/components/ListingGallery';
import { EmptyState, ErrorState, GhostBadge, Pill, PillLink, PriceTag, ReliabilityBadge, Skeleton, Tag } from '@/components/ui';

const COND: Record<string, string> = { new: 'New', like_new: 'Like new', good: 'Good', fair: 'Fair', poor: 'Poor' };

export default function ListingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { listings, bids, set } = useDemo();
  const [pay, setPay] = useState(false);
  const mock = useMockLoad([id]);
  const real = useRealLoad(() => realListing(id), [id], !USE_MOCKS);
  const { status, retry } = USE_MOCKS ? mock : real;
  const [want, setWant] = useState(false);
  const [saved, setSaved] = useState(false);
  const [buying, setBuying] = useState(false);
  const [offerSent, setOfferSent] = useState(false);
  const listing = USE_MOCKS ? listings.find(l => l.id === id) : real.data?.listing;

  // Real mode: offer at the listing price. An auto-accepted offer returns an order to pay.
  const buyReal = async () => {
    if (!listing) return;
    setBuying(true);
    try {
      const { order } = await realOffer(listing.id, listing.price_cents);
      if (order) router.push(`/orders/${order.id}`);
      else setOfferSent(true);
    } catch (e) {
      if ((e as { code?: string }).code === 'UNAUTHENTICATED') router.push('/signin');
      else toast((e as Error).message);
    } finally { setBuying(false); }
  };

  if (status === 'error') return <ErrorState onRetry={retry} />;
  if (status === 'loading')
    return (
      <div className="mx-auto grid max-w-[1100px] gap-10 min-[900px]:grid-cols-2">
        <Skeleton className="aspect-[4/5] w-full rounded-2xl" />
        <div className="space-y-4"><Skeleton className="h-10 w-3/4" /><Skeleton className="h-8 w-1/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-14 w-full rounded-xl" /></div>
      </div>
    );
  if (!listing) return <EmptyState emoji="🔎" line="That listing's gone. Maybe someone already made the handoff." action={<PillLink href="/feed" size="sm">Back to the feed</PillLink>} />;

  const ghost = listing.status === 'ghost';
  const seller = USE_MOCKS ? userById(listing.seller_id) : real.data?.seller ?? undefined;
  const listingBids = bids.filter(b => b.listing_id === listing.id);
  const claimedFromIg = !ghost && listing.source.channel === 'instagram';
  const share = () => {
    if (typeof navigator !== 'undefined' && navigator.share) navigator.share({ title: listing.title, url: window.location.href }).catch(() => {});
    else toast('Link copied');
  };

  const buyBar = (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Pill className="flex-1" disabled={!USE_MOCKS && (buying || offerSent || real.data?.isMine || listing.status !== 'active')} onClick={USE_MOCKS ? () => setPay(true) : buyReal}>
        {!USE_MOCKS ? (offerSent ? 'Offer sent' : buying ? 'Sending…' : `Buy · ${money(listing.price_cents)}`) : listing.id === 'l_owala' ? copy2.buy.cta : `Buy · ${money(listing.price_cents)}`}
      </Pill>
      {!USE_MOCKS ? null : listing.id === 'l_fridge' ? (
        <PillLink href="/offers/t_fridge" variant="neutral" className="flex-1">Make offer</PillLink>
      ) : (
        <Pill variant="neutral" className="flex-1" onClick={() => toast(`Offer sent to ${seller?.display_name ?? 'the seller'}. Thread expires in 47h.`)}>Make offer</Pill>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-[1100px] pb-24 min-[900px]:pb-0">
      <button onClick={() => router.back()} className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-soft hover:text-ink"><ArrowLeft size={16} strokeWidth={2.4} /> Back</button>
      <div className="grid gap-10 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="min-[900px]:sticky min-[900px]:top-8 min-[900px]:self-start">
          <ListingGallery listing={listing} saved={saved} onToggleSaved={() => setSaved(s => !s)} />
        </div>

        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              {ghost && listing.source.author_handle ? <GhostBadge handle={listing.source.author_handle} /> : listing.tag ? <Tag>{listing.tag}</Tag> : null}
              <h1 className="mt-2 text-[28px] font-bold text-ink">{listing.title}</h1>
            </div>
            <div className="flex shrink-0 gap-2">
              <button onClick={() => setSaved(s => !s)} aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'} aria-pressed={saved} className="flex h-10 w-10 items-center justify-center rounded-full bg-img-bg active:scale-90">
                <Heart size={17} strokeWidth={2.2} className={saved ? 'fill-accent text-accent' : 'text-ink'} />
              </button>
              <button onClick={share} aria-label="Share" className="flex h-10 w-10 items-center justify-center rounded-full bg-img-bg active:scale-90">
                <Share2 size={16} strokeWidth={2.2} />
              </button>
            </div>
          </div>

          <div className="mt-3"><PriceTag listing={listing} big /></div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-img-bg px-3 py-1 text-[12.5px] font-medium text-ink">{COND[listing.condition]}</span>
            {listing.negotiable && <span className="rounded-full bg-img-bg px-3 py-1 text-[12.5px] font-medium text-ink">Negotiable</span>}
            {listing.location_label && <span className="rounded-full bg-img-bg px-3 py-1 text-[12.5px] font-medium text-ink">📍 {listing.location_label}</span>}
          </div>

          <p className="mt-5 text-[15.5px] leading-relaxed text-ink">{listing.description}</p>

          <div className="mt-6 flex items-center gap-3 rounded-2xl bg-card-bg p-3.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-img-bg text-xl" aria-hidden>{ghost ? '📸' : seller?.avatar_emoji}</span>
            <div className="min-w-0">
              {ghost ? (
                <>
                  <p className="font-semibold text-ink">{listing.source.author_handle}</p>
                  <p className="text-[13px] font-medium text-meta">{copy.ghost.label}</p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-ink">{seller?.display_name} <span className="font-medium text-meta">· {seller?.major}</span></p>
                  {seller && <div className="mt-1"><ReliabilityBadge r={seller.reliability} /></div>}
                </>
              )}
            </div>
          </div>

          {ghost && (
            <>
              <div className="mt-6 rounded-2xl bg-card-bg p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-ink">{listing.source.author_handle} <span className="font-medium text-meta">· {listing.source.posted_ago}</span></span>
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide text-meta">Instagram post</span>
                </div>
                <p className="mt-2 text-[15px] font-medium italic text-ink">&ldquo;{listing.source.post_caption}&rdquo;</p>
                <a href={listing.source.post_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-accent-text hover:underline">View on Instagram <ExternalLink size={13} /></a>
              </div>

              <div className="mt-6 flex items-center justify-between">
                <h2 className="text-[20px] font-bold text-ink">🔥 {listing.interest?.count ?? 0} people want this</h2>
              </div>
              <div className="mt-4"><BidBubbles bids={listingBids} /></div>

              <div className="sticky bottom-[84px] z-20 mt-6 min-[900px]:bottom-6">
                <Pill variant="butter" size="lg" className="w-full" onClick={() => setWant(true)}>{copy.ghost.cta}</Pill>
              </div>
              <p className="mt-3 text-center text-[12.5px] font-medium text-meta">{copy.ghost.fineprint}</p>
            </>
          )}

          {!ghost && claimedFromIg && listingBids.length > 0 && (
            <>
              <h2 className="mt-7 text-[20px] font-bold text-ink">Offers waiting</h2>
              <div className="mt-4">
                <BidBubbles bids={listingBids} onAccept={b => toast(`Accepted ${money(b.amount_cents)} from ${userById(b.user_id)?.display_name ?? 'you'}. We'll find a spot.`)} />
              </div>
            </>
          )}

          {!ghost && <div className="mt-7 hidden min-[900px]:block">{buyBar}</div>}
          {offerSent && <p role="status" className="mt-3 rounded-2xl bg-mint px-4 py-3 text-[14px] font-bold text-dark-ink">Offer sent, waiting for the seller.</p>}
          {!ghost && (
            <p className="mt-3 text-[12.5px] font-medium text-meta">
              {!listing.negotiable && seller ? `You're agreeing to ${seller.display_name.split(' ')[0]}'s price. ` : ''}🔒 Money&apos;s held until it&apos;s in your hands.
            </p>
          )}
          <p className="mt-8 text-[12px] font-medium text-meta"><Link href="/feed" className="hover:underline">← More from University of Alabama</Link></p>
        </div>
      </div>

      {!ghost && (
        <div className="fixed inset-x-0 bottom-[68px] z-30 flex items-center gap-3 border-t border-v3-divider bg-card-bg px-4 py-3 min-[900px]:hidden">
          <div className="shrink-0">
            <div className="text-[17px] font-bold tabular-nums text-ink">{money(listing.price_cents)}</div>
            <div className="text-[11.5px] font-medium text-meta">{COND[listing.condition]}</div>
          </div>
          <div className="flex flex-1 gap-2">{buyBar}</div>
        </div>
      )}

      <InterestSheet listing={want ? listing : null} onClose={() => setWant(false)} />
      <PaySheet
        open={pay}
        amount={listing.price_cents}
        onClose={() => setPay(false)}
        onPaid={() => {
          setPay(false);
          toast(`${money(listing.price_cents)} held 🔒`);
          if (listing.id === 'l_owala') {
            set(s => ({ ...s, zoe: 'bought', zoeSpot: null }));
            router.push('/orders/o_owala');
          } else router.push('/meetup/o_fridge');
        }}
      />
    </div>
  );
}
