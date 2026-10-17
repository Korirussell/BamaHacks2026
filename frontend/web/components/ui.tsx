'use client';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { RotateCw } from 'lucide-react';
import { copy } from '@/lib/copy';
import { money } from '@/lib/money';
import type { Listing, Reliability } from '@/lib/types';

type PillVariant = 'primary' | 'neutral' | 'butter' | 'ink';
const pillCls = (v: PillVariant = 'primary', size: 'md' | 'sm' | 'lg' = 'md') =>
  [
    'stk-btn label inline-flex items-center justify-center gap-2 rounded-full whitespace-nowrap disabled:opacity-60 disabled:pointer-events-none',
    size === 'sm' ? 'px-3.5 py-1.5 text-[11.5px] !shadow-[3px_3px_0_var(--shadow)] border-2' : size === 'lg' ? 'px-7 py-4 text-[14px]' : 'px-5 py-3',
    v === 'primary' && 'bg-accent text-on-accent',
    v === 'neutral' && 'bg-card text-ink',
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

export function GhostBadge({ handle, className = '' }: { handle: string; className?: string }) {
  return <span className={`ig-grad inline-flex items-center rounded-full border-2 border-[#1A1414] px-2.5 py-1 text-[11px] font-extrabold text-white ${className}`}>{handle}</span>;
}

export function ReasonChip({ reason }: { reason?: string | null }) {
  if (!reason || !copy.reason[reason] || reason === 'new') return null;
  return <span className="inline-flex rounded-full border-2 border-ink bg-mint px-2 py-0.5 text-[10.5px] font-extrabold uppercase tracking-wide text-dark-ink">{copy.reason[reason]}</span>;
}

export function Tag({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex rounded-full border-2 border-[#1A1414] bg-white px-2 py-0.5 text-[10.5px] font-extrabold uppercase text-[#1A1414] ${className}`}>{children}</span>;
}

export function ChipRow<T extends string>({ items, value, onChange }: { items: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-2 pt-1" role="tablist">
      {items.map(i => (
        <button
          key={i}
          role="tab"
          aria-selected={value === i}
          onClick={() => onChange(i)}
          className={`press shrink-0 rounded-full border-2 border-ink px-4 py-2 text-[12.5px] font-extrabold shadow-[3px_3px_0_var(--shadow)] ${value === i ? 'bg-ink text-bg' : 'bg-card text-ink'}`}
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
  return (
    <div>
      <div className={`font-display font-bold ${big ? 'text-[40px]' : 'text-[20px]'}`}>{money(listing.price_cents)}</div>
      {fp && (
        <div className="mt-1 text-[13px] font-semibold text-soft">
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
