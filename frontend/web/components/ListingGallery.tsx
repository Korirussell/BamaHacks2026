'use client';
import Image from 'next/image';
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Heart, X } from 'lucide-react';
import type { Listing } from '@/lib/types';
import { categoryIconFor } from './ui';

// cards-v3 §3: full-bleed photo gallery — main photo + thumbnails + lightbox, no sticker tilt.
export function ListingGallery({ listing, saved, onToggleSaved }: { listing: Listing; saved: boolean; onToggleSaved: () => void }) {
  const images = listing.images ?? [];
  const [i, setI] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const Icon = categoryIconFor(listing);
  const go = (d: number) => setI(n => (n + d + images.length) % images.length);

  return (
    <div>
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-img-bg">
        {images[i] ? (
          <button type="button" onClick={() => setLightbox(true)} className="absolute inset-0 h-full w-full cursor-zoom-in" aria-label="Open full-size photo">
            <Image src={images[i]} alt={listing.title} fill sizes="(max-width: 900px) 100vw, 58vw" className="object-cover" priority />
          </button>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-meta">
            <Icon size={40} strokeWidth={1.5} aria-hidden />
          </div>
        )}

        {images.length > 1 && (
          <>
            <button onClick={() => go(-1)} aria-label="Previous photo" className="glass-badge absolute left-3 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 sm:group-hover:opacity-100">
              <ChevronLeft size={18} />
            </button>
            <button onClick={() => go(1)} aria-label="Next photo" className="glass-badge absolute right-3 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 sm:group-hover:opacity-100">
              <ChevronRight size={18} />
            </button>
            <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
              {images.map((_, d) => (
                <span key={d} className={`h-1.5 w-1.5 rounded-full transition-colors ${d === i ? 'bg-white' : 'bg-white/50'}`} />
              ))}
            </div>
          </>
        )}

        <button
          onClick={onToggleSaved}
          aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
          aria-pressed={saved}
          className="glass-badge absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full active:scale-90"
        >
          <Heart size={17} strokeWidth={2.2} className={saved ? 'fill-accent text-accent' : 'text-ink'} />
        </button>
      </div>

      {images.length > 1 && (
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
          {images.map((src, d) => (
            <button
              key={src}
              onClick={() => setI(d)}
              aria-label={`Photo ${d + 1}`}
              aria-current={d === i}
              className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-[10px] ${d === i ? 'ring-2 ring-ink' : ''}`}
            >
              <Image src={src} alt="" fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      )}

      <AnimatePresence>
        {lightbox && images[i] && (
          <motion.div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightbox(false)}
          >
            <button onClick={() => setLightbox(false)} aria-label="Close" className="glass-badge absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full">
              <X size={18} />
            </button>
            <div className="relative h-full max-h-[85vh] w-full max-w-3xl">
              <Image src={images[i]} alt={listing.title} fill sizes="90vw" className="object-contain" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
