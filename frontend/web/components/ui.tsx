'use client';
import Image from 'next/image';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { Bike, BookOpen, Calculator, CupSoda, Glasses, Lamp, Mouse, Package, Refrigerator, RotateCw, Ticket as TicketIcon } from 'lucide-react';
import { copy } from '@/lib/copy';
import { money } from '@/lib/money';
import type { Listing, Reliability } from '@/lib/types';

// cards-v3 §5: clean buttons everywhere in the app UI — radius 12, no outline, no offset shadow.
type PillVariant = 'primary' | 'neutral' | 'butter' | 'ink';
const pillCls = (v: PillVariant = 'primary', size: 'md' | 'sm' | 'lg' = 'md') =>
  [
    'btn-clean inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold disabled:opacity-60 disabled:pointer-events-none',
    size === 'sm' ? 'px-3.5 py-2 text-[13px]' : size === 'lg' ? 'px-7 py-4 text-[15px]' : 'px-5 py-3 text-[14px]',
    v === 'primary' && 'btn-primary-clean',
    v === 'neutral' && 'btn-secondary-clean',
    v === 'butter' && 'bg-butter text-dark-ink',
    v === 'ink' && 'bg-ink text-bg',
  ]
    .filter(Boolean)
    .join(' ');

export function Pill({ variant, size, className = '', ...p }: ComponentProps<'button'> & { variant?: PillVariant; size?: 'md' | 'sm' | 'lg' }) {
  return <button {...p} className={`${pillCls(variant, size)} ${className}`} />;
}
export function PillLink({ variant, size, className = '', ...p }: ComponentProps<typeof Link> & { variant?: PillVariant; size?: 'md' | 'sm' | 'lg' }) {
  return <Link {...p} className={`${pillCls(variant, size)} ${className}`} />;
}

export function StickerCard({ className = '', children, ...p }: ComponentProps<'div'>) {
  return (
    <div {...p} className={`stk rounded-[20px] bg-card ${className}`}>
      {children}
    </div>
  );
}

export const tileBg = (t: Listing['tile']) => (t === 'mint' ? 'var(--mint)' : t === 'butter' ? 'var(--butter)' : 'var(--peach)');

export function ItemTile({ listing, size = 56, className = '', children }: { listing: Pick<Listing, 'tile' | 'emoji'>; size?: number; className?: string; children?: ReactNode }) {
  return (
    <div className={`relative flex items-center justify-center border-b-[2.5px] border-ink ${className}`} style={{ background: tileBg(listing.tile) }}>
      <span style={{ fontSize: size, lineHeight: 1 }} aria-hidden>{listing.emoji}</span>
      {children}
    </div>
  );
}

// cards-v3 §2: one glass badge max on a card photo, 11.5/600, top-left, 8px inset.
export function GhostBadge({ handle, className = '' }: { handle: string; className?: string }) {
  return (
    <span className={`glass-badge inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${className}`}>
      <span className="ig-grad h-2 w-2 shrink-0 rounded-full" aria-hidden />
      From Instagram · {handle}
    </span>
  );
}

export function ReasonChip({ reason }: { reason?: string | null }) {
  if (!reason || !copy.reason[reason] || reason === 'new') return null;
  return <span className="glass-badge inline-flex rounded-full px-2.5 py-1 text-[11.5px] font-semibold">{copy.reason[reason]}</span>;
}

export function Tag({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`glass-badge inline-flex rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${className}`}>{children}</span>;
}

// cards-v3 §4.4: category line icon, never emoji, shown when a listing has no photo.
const CATEGORY_ICON: Record<Listing['category'], typeof Bike> = {
  bike: Bike, dorm: Lamp, lab_supplies: Glasses, textbook: BookOpen, ticket: TicketIcon, tech: Mouse, other: Package,
};
export function CategoryIcon({ category, size = 28, className = '' }: { category: Listing['category']; size?: number; className?: string }) {
  const Icon = CATEGORY_ICON[category] ?? Package;
  return <Icon size={size} strokeWidth={1.75} className={className} aria-hidden />;
}
// A couple of categories read better with a more specific glyph once we know the title.
export function categoryIconFor(listing: Pick<Listing, 'category' | 'title'>) {
  const t = listing.title.toLowerCase();
  if (listing.category === 'dorm' && /fridge|refrigerator/.test(t)) return Refrigerator;
  if (listing.category === 'dorm' && /bottle|flask|owala/.test(t)) return CupSoda;
  if (listing.category === 'lab_supplies' && /calculator|ti-?84/.test(t)) return Calculator;
  return CATEGORY_ICON[listing.category] ?? Package;
}

export function timeAgo(iso: string) {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

// cards-v3 §5: chips go clean — height 34, radius 999, bg img-bg, no outline.
export function ChipRow<T extends string>({ items, value, onChange }: { items: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-2 pt-1" role="tablist">
      {items.map(i => (
        <button
          key={i}
          role="tab"
          aria-selected={value === i}
          onClick={() => onChange(i)}
          className="chip-clean shrink-0 px-4 text-[13px] font-medium h-[34px]"
        >
          {i}
        </button>
      ))}
    </div>
  );
}

export function ReliabilityBadge({ r }: { r: Reliability }) {
  const label = r.badge === 'top' ? 'Top seller' : r.badge === 'reliable' ? 'Reliable' : 'New';
  return (
    <span className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-mint px-2 py-0.5 text-[11px] font-extrabold text-dark-ink">
      {r.badge === 'new' ? '🌱' : '★'} {label}
      {r.badge !== 'new' && <span className="font-bold opacity-70">· {r.score.toFixed(1)} · {r.completed} trades</span>}
    </span>
  );
}

export function PriceTag({ listing, big }: { listing: Listing; big?: boolean }) {
  const fp = listing.fair_price;
  const good = fp && listing.price_cents <= fp.high_cents;
  const dropped = listing.original_price_cents && listing.original_price_cents > listing.price_cents;
  return (
    <div>
      <div className={`flex items-baseline gap-2 font-extrabold tabular-nums ${big ? 'text-[28px]' : 'text-[19px]'}`}>
        <span style={dropped ? { color: 'var(--price-drop)' } : undefined}>{money(listing.price_cents)}</span>
        {dropped && <span className="text-[15px] font-semibold text-meta line-through">{money(listing.original_price_cents!)}</span>}
      </div>
      {fp && (
        <div className="mt-1 text-[13px] font-semibold text-meta">
          Fair price {money(fp.low_cents)}–{money(fp.high_cents)}
          {good && ' · Good deal ✅'}
        </div>
      )}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skel rounded-[14px] ${className}`} />;
}

export function LoadingGlyph({ size = 40, className = '' }: { size?: number; className?: string }) {
  return <Image src="/brand/glyph-512.webp" alt="Loading" width={size} height={size} className={`glyph-wobble ${className}`} />;
}

export function LoadingState({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center py-10 ${className}`}>
      <LoadingGlyph />
    </div>
  );
}

export function EmptyState({ emoji = '🫙', line, action }: { emoji?: string; line: string; action?: ReactNode }) {
  return (
    <div className="stk mx-auto my-8 flex max-w-md flex-col items-center gap-3 rounded-[22px] bg-card px-6 py-10 text-center">
      <span className="text-5xl" aria-hidden>{emoji}</span>
      <p className="font-semibold text-soft">{line}</p>
      {action}
    </div>
  );
}

export function ErrorState({ onRetry, line = copy.error.generic }: { onRetry: () => void; line?: string }) {
  return (
    <div className="stk mx-auto my-8 flex max-w-md flex-col items-center gap-3 rounded-[22px] bg-card px-6 py-10 text-center" role="alert">
      <span className="text-5xl" aria-hidden>📡</span>
      <p className="font-semibold text-soft">{line}</p>
      <Pill variant="neutral" size="sm" onClick={onRetry}><RotateCw size={14} strokeWidth={2.6} /> Retry</Pill>
    </div>
  );
}

export function Sticker({ children, color = 'butter', rotate = -6, className = '' }: { children: ReactNode; color?: 'butter' | 'mint'; rotate?: number; className?: string }) {
  return (
    <span
      className={`inline-flex rounded-full border-[2.5px] border-[#1A1414] px-3.5 py-1.5 text-[13px] font-extrabold text-[#1A1414] shadow-[3px_3px_0_var(--shadow)] ${className}`}
      style={{ background: color === 'butter' ? 'var(--butter)' : 'var(--mint)', transform: `rotate(${rotate}deg)` }}
    >
      {children}
    </span>
  );
}

export function PageTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[30px] font-bold">{title}</h1>
        {sub && <p className="mt-1.5 text-[13px] font-bold text-soft">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
