'use client';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { copy } from '@/lib/copy';
import { listings } from '@/lib/data';
import { ListingCard } from '@/components/ListingCard';
import { PillLink, Sticker } from '@/components/ui';

const fan = ['l_cs201', 'l_ti84', 'l_bike'].map(id => listings.find(l => l.id === id)!);
const fanPose = [
  { rotate: -9, x: -8, y: 30, z: 1 },
  { rotate: 4, x: 0, y: 0, z: 2 },
  { rotate: 11, x: 8, y: 40, z: 3 },
];

export default function Landing() {
  const reduce = useReducedMotion();
  return (
    <div className="mx-auto max-w-[1180px]">
      <header className="flex items-center justify-end gap-6">
        <nav className="hidden items-center gap-6 text-[13.5px] font-bold md:flex">
          <a href="#how" className="hover:text-accent-text">How it works</a>
          <a href="#how" className="hover:text-accent-text">Safety</a>
          <Link href="/claim/abc123" className="hover:text-accent-text">For sellers</Link>
        </nav>
        <button onClick={() => toast("You're in as Kori R. · kori@crimson.ua.edu")} className="stk-btn label rounded-full bg-card px-3.5 py-1.5 text-[11.5px] border-2 !shadow-[3px_3px_0_var(--shadow)]">
          {copy.cta.signin}
        </button>
      </header>

      <section className="mt-8 grid items-center gap-12 lg:mt-14 lg:grid-cols-[1.1fr_1fr]">
        <div className="relative">
          <h1 className="font-display text-[44px] font-bold sm:text-[64px] lg:text-[80px]">
            {copy.hero.titleBefore}
            <span className="relative mx-1 inline-block -rotate-2 rounded-[10px] bg-accent px-3 pb-1 text-on-accent">{copy.hero.titleHighlight}</span>
            {copy.hero.titleAfter}
          </h1>
          <p className="mt-6 max-w-[520px] text-[17px] font-medium leading-relaxed text-soft">{copy.hero.sub}</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <PillLink href="/feed" size="lg">{copy.cta.primary}</PillLink>
            <PillLink href="/feed" variant="neutral" size="lg">{copy.cta.secondary}</PillLink>
          </div>
        </div>

        <div className="relative mx-auto h-[360px] w-full max-w-[460px] sm:h-[420px]">
          <Sticker color="butter" rotate={-8} className="absolute -top-2 left-0 z-10">{copy.sticker.edu}</Sticker>
          <Sticker color="mint" rotate={7} className="absolute bottom-2 right-0 z-10">{copy.sticker.escrow}</Sticker>
          {fan.map((l, i) => (
            <motion.div
              key={l.id}
              className={`absolute top-6 w-[180px] sm:w-[200px] ${i === 0 ? 'hidden sm:block' : ''}`}
              style={{ left: `calc(${[8, 32, 56][i]}% - ${i === 0 ? 0 : 40}px)`, zIndex: fanPose[i].z }}
              initial={reduce ? false : { opacity: 0, y: 60, rotate: 0 }}
              animate={{ opacity: 1, y: fanPose[i].y, rotate: fanPose[i].rotate, x: fanPose[i].x }}
              whileHover={{ rotate: 0, y: fanPose[i].y - 18, zIndex: 5, transition: { type: 'spring', stiffness: 300, damping: 18 } }}
              transition={{ delay: 0.15 + i * 0.1, type: 'spring', stiffness: 160, damping: 16 }}
            >
              <ListingCard listing={l} static priority />
            </motion.div>
          ))}
        </div>
      </section>

      {/* Ticker tape, full-bleed */}
      <div className="relative left-1/2 mt-16 w-[100vw] -translate-x-1/2 overflow-hidden py-6">
        <div className="-rotate-[1.2deg] overflow-hidden border-y-[2.5px] border-ink bg-tape py-3 text-tape-ink">
          <div className="ticker-track flex w-max whitespace-nowrap font-display text-[16px] font-semibold">
            {[0, 1].map(k => (
              <span key={k} aria-hidden={k === 1} className="pr-8">
                {copy.ticker.split(' ✦ ').map((t, i) => (
                  <span key={i}>
                    {t}
                    <span className="mx-4 text-[#E0304E]">✦</span>
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>
      </div>

      <section id="how" className="mt-14 scroll-mt-10">
        <h2 className="font-display text-[34px] font-bold sm:text-[44px]">How it works</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {copy.steps.map((s, i) => (
            <motion.div
              key={s.title}
              className="stk rounded-[22px] bg-card p-6"
              initial={reduce ? false : { opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ delay: i * 0.08 }}
            >
              <span className="font-display flex h-11 w-11 items-center justify-center rounded-full border-[2.5px] border-[#1A1414] text-[20px] font-bold text-[#1A1414]" style={{ background: ['var(--butter)', 'var(--mint)', 'var(--peach)'][i] }}>
                {i + 1}
              </span>
              <h3 className="font-display mt-5 text-[24px] font-bold">{s.title}</h3>
              <p className="mt-2 text-[15px] font-medium leading-relaxed text-soft">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="stk mt-16 flex flex-col items-start justify-between gap-6 rounded-[24px] bg-accent px-7 py-10 text-on-accent sm:flex-row sm:items-center sm:px-10">
        <div>
          <p className="font-display text-[34px] font-bold sm:text-[44px]">Meet in the gap.</p>
          <p className="mt-2 font-semibold opacity-90">Money&apos;s held until it&apos;s in your hands.</p>
        </div>
        <PillLink href="/feed" variant="butter" size="lg">{copy.cta.primary}</PillLink>
      </section>
    </div>
  );
}
