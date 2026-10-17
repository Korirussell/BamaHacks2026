'use client';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { copy2 } from '@/lib/copy';
import { money } from '@/lib/money';
import { photoResult as r } from '@/lib/data';

function Step({ n, title, children, i }: { n: string; title: string; children: React.ReactNode; i: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.15 + i * 0.35, type: 'spring', stiffness: 220, damping: 22 }}
      className="relative pl-12"
    >
      <span className="font-display absolute left-0 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border-[2.5px] border-ink bg-butter text-[17px] font-bold text-dark-ink">{n}</span>
      <div className="stk-sm rounded-[18px] bg-card p-4">
        <h3 className="label text-[11.5px] text-accent-text">{title}</h3>
        <div className="mt-2">{children}</div>
      </div>
    </motion.div>
  );
}

function Typed({ text, delay }: { text: string; delay: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let i = 0;
    let iv: ReturnType<typeof setInterval>;
    const t = setTimeout(() => { iv = setInterval(() => { i += 2; setN(i); if (i >= text.length) clearInterval(iv); }, 18); }, delay);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, [text, delay]);
  return <>{text.slice(0, n)}{n < text.length && <span className="animate-pulse">▍</span>}</>;
}

/** "How Handoff priced this" (features-v2 §5.2). `img` is the user's photo; `price` is the chosen price in cents. */
export function PricingPipeline({ img, price, onPrice }: { img?: string | null; price: number; onPrice?: (c: number) => void }) {
  const pm = r.price_model;
  const maxComp = Math.max(...r.comps.map(c => c.price_cents));
  const days = Math.round(pm.fast_days + ((price - pm.fast_cents) / (pm.max_cents - pm.fast_cents)) * (pm.max_days - pm.fast_days));
  const box = r.detected.box;
  return (
    <section aria-label={copy2.ai.priced}>
      <h2 className="font-display text-[24px] font-bold">{copy2.ai.priced}</h2>
      <div className="relative mt-4 space-y-4">
        <span className="absolute bottom-6 left-[17px] top-6 border-l-[2.5px] border-dashed border-ink" aria-hidden />

        <Step n="1" title="Vision" i={0}>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative h-36 w-full shrink-0 overflow-hidden rounded-[12px] border-2 border-ink bg-sunk sm:w-44">
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img} alt="Your photo" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-6xl">{r.emoji}</div>
              )}
              <motion.div
                className="absolute rounded-[6px] border-[3px] border-accent"
                style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
                initial={{ opacity: 0, scale: 1.3 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5, duration: 0.4 }}
              >
                <span className="absolute -top-6 left-0 whitespace-nowrap rounded-full bg-accent px-2 py-0.5 text-[10px] font-extrabold text-on-accent">{r.detected.label} · {Math.round(r.detected.confidence * 100)}%</span>
              </motion.div>
            </div>
            <div>
              <div className="flex flex-wrap gap-1.5">
                {r.attributes.map((a, i) => (
                  <motion.span key={a} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 + i * 0.08 }} className="rounded-full border-2 border-ink bg-mint px-2 py-0.5 text-[11.5px] font-extrabold text-dark-ink">{a}</motion.span>
                ))}
              </div>
              <p className="mt-2 text-[13.5px] font-semibold">→ condition <b>Like new</b></p>
            </div>
          </div>
        </Step>

        <Step n="2" title="Comps" i={1}>
          <div className="space-y-2">
            {r.comps.map((c, i) => (
              <div key={c.source} className="flex items-center gap-2 text-[12.5px] font-bold">
                <span className="w-[42%] shrink-0 truncate text-soft sm:w-48">{c.source}</span>
                <div className="h-5 flex-1">
                  <motion.div className="h-full rounded-[5px] border-2 border-ink bg-accent" initial={{ width: 0 }} animate={{ width: `${(c.price_cents / maxComp) * 100}%` }} transition={{ delay: 0.8 + i * 0.1, duration: 0.6 }} />
                </div>
                <span className="w-10 text-right tabular-nums">{money(c.price_cents)}</span>
              </div>
            ))}
          </div>
        </Step>

        <Step n="3" title="Campus demand" i={2}>
          <p className="text-[13.5px] font-semibold">{r.demand.wishlisted_this_week} people wishlisted a mouse this week · {r.demand.seasonal_note}</p>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-4 flex-1 overflow-hidden rounded-full border-2 border-ink bg-sunk">
              <motion.div className="h-full bg-butter" initial={{ width: 0 }} animate={{ width: `${r.demand.score}%` }} transition={{ delay: 1.2, duration: 0.7 }} />
            </div>
            <span className="font-display text-[18px] font-bold">{r.demand.score}/100</span>
          </div>
        </Step>

        <Step n="4" title="Price model" i={3}>
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[12px] font-bold">
            {[`${money(pm.base_cents)} comps`, `× ${pm.condition_factor} like-new`, `× ${pm.student_discount} student discount`, `× ${pm.demand_factor} demand`].map(t => (
              <span key={t} className="rounded-full border-2 border-ink bg-bg px-2 py-0.5">{t}</span>
            ))}
            <span className="rounded-full border-2 border-ink bg-butter px-2 py-0.5 text-dark-ink">= {money(pm.raw_cents, true)}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {[[pm.fast_cents, copy2.sell.fast], [pm.max_cents, copy2.sell.max]].map(([c, l]) => (
              <button key={String(c)} type="button" onClick={() => onPrice?.(c as number)} className={`rounded-full border-2 border-ink px-2 py-2 text-[12px] font-extrabold ${price === c ? 'bg-ink text-bg' : 'bg-card'}`}>{l}</button>
            ))}
          </div>
          <label className="mt-3 block">
            <span className="sr-only">Price</span>
            <input type="range" min={pm.fast_cents} max={pm.max_cents} step={100} value={price} onChange={e => onPrice?.(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
          </label>
          <p className="text-[13px] font-bold">{money(price)} · expected to sell in ~{days} day{days === 1 ? '' : 's'}</p>
        </Step>

        <Step n="5" title="Listing writer" i={4}>
          <p className="font-display text-[17px] font-bold"><Typed text={r.title} delay={1900} /></p>
          <p className="mt-1 text-[13.5px] font-medium"><Typed text={r.description} delay={2300} /></p>
          <div className="mt-2 flex flex-wrap gap-1.5">{r.tags.map(t => <span key={t} className="rounded-full border-2 border-ink px-2 py-0.5 text-[11px] font-bold">#{t}</span>)}</div>
        </Step>
      </div>
      <p className="mt-4 inline-flex rounded-full border-2 border-ink bg-sunk px-3 py-1 text-[11.5px] font-bold text-soft">Model: {r.model_note}</p>
    </section>
  );
}
