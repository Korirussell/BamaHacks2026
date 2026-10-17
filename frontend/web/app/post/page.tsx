'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ImagePlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { copy } from '@/lib/copy';
import { money } from '@/lib/money';
import { screenshotResult } from '@/lib/data';
import { useDemo } from '@/lib/store';
import type { Listing } from '@/lib/types';
import { ErrorState, PageTitle, Pill } from '@/components/ui';

type Phase = 'idle' | 'running' | 'done' | 'failed';
const CONDS = [['new', 'New'], ['like_new', 'Like new'], ['good', 'Good'], ['fair', 'Fair']] as const;

function JobProgress({ step }: { step: number }) {
  return (
    <ol className="mt-5 space-y-3">
      {copy.job.steps.map((s, i) => {
        const done = step > i, active = step === i;
        return (
          <motion.li key={s} initial={{ opacity: 0, x: -10 }} animate={{ opacity: step >= i ? 1 : 0.4, x: 0 }} className="flex items-center gap-3">
            <span className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink ${done ? 'bg-mint text-dark-ink' : active ? 'bg-butter text-dark-ink' : 'bg-card'}`}>
              {done ? <Check size={16} strokeWidth={3} /> : active ? <Loader2 size={16} className="animate-spin" /> : <span className="text-[12px] font-extrabold">{i + 1}</span>}
            </span>
            <span className="text-[15px] font-bold">{s}</span>
          </motion.li>
        );
      })}
    </ol>
  );
}

export default function Post() {
  const router = useRouter();
  const { publishListing } = useDemo();
  const [img, setImg] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [step, setStep] = useState(0);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const r = screenshotResult;
  const [form, setForm] = useState({ title: r.title, price: r.price_cents / 100, condition: '', description: r.description });

  const run = useCallback(() => {
    setPhase('running');
    setStep(0);
    const fail = new URLSearchParams(window.location.search).get('fail') === '1';
    setTimeout(() => setStep(1), 800);
    setTimeout(() => setStep(2), 1600);
    setTimeout(() => { setStep(3); setPhase(fail ? 'failed' : 'done'); setTimeout(() => document.getElementById('ai-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350); }, 2400);
  }, []);

  const take = useCallback((file: File | null | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    setImg(URL.createObjectURL(file));
    run();
  }, [run]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find(x => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); take(f); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [take]);

  const publish = () => {
    const l: Listing = {
      id: `l_new_${Date.now()}`, title: form.title, description: form.description, category: r.category as Listing['category'],
      price_cents: Math.round(form.price * 100), negotiable: true, condition: (form.condition || 'good') as Listing['condition'],
      emoji: '💡', tile: 'peach', tag: 'New', location_label: 'Tutwiler', status: 'active', seller_id: 'u_kori',
      source: { channel: 'screenshot', author_handle: r.author_handle, claimed: true }, fair_price: r.fair_price, reason: 'new',
      created_at: new Date().toISOString(),
    };
    publishListing(l);
    toast('Live on the feed');
    router.push('/feed');
  };

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageTitle title="Post something" sub="Three ways in. The screenshot one is magic." />
      <div className="grid gap-5 md:grid-cols-[1fr_1.6fr_1fr]">
        <button onClick={() => toast('Photo upload is on the iOS app for now 📱')} className="stk press order-2 flex flex-col items-start gap-2 rounded-[22px] bg-card p-5 text-left md:order-1">
          <span className="text-4xl">📸</span>
          <span className="font-display text-[21px] font-bold">Photos</span>
          <span className="text-[13.5px] font-semibold text-soft">Snap it, price it, post it.</span>
        </button>

        <div
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); take(e.dataTransfer.files?.[0]); }}
          className={`stk order-1 rounded-[22px] bg-butter p-5 text-dark-ink transition-transform md:order-2 ${drag ? 'scale-[1.02]' : ''}`}
        >
          <div className="flex items-center gap-2">
            <span className="text-4xl">🖼️</span>
            <span className="rounded-full border-2 border-[#1A1414] bg-white px-2 py-0.5 text-[10.5px] font-extrabold uppercase">AI</span>
          </div>
          <h2 className="font-display mt-2 text-[24px] font-bold">Screenshot → listing</h2>
          {!img ? (
            <button onClick={() => fileRef.current?.click()} className={`mt-4 flex w-full flex-col items-center gap-2 rounded-[18px] border-[2.5px] border-dashed border-[#1A1414] px-4 py-10 text-center ${drag ? 'bg-white' : 'bg-white/50'}`}>
              <ImagePlus size={30} strokeWidth={2.2} />
              <span className="text-[14.5px] font-bold">{copy.post.screenshot}</span>
            </button>
          ) : (
            <div className="mt-4 flex gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img} alt="Your screenshot" className="h-36 w-28 shrink-0 rounded-[14px] border-[2.5px] border-[#1A1414] object-cover" />
              <div className="min-w-0 flex-1">
                <JobProgress step={step} />
              </div>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => take(e.target.files?.[0])} />
          {!img && (
            <button onClick={() => { setImg('data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="280" height="360"><rect width="280" height="360" fill="#FFE3D6"/><text x="140" y="170" font-size="90" text-anchor="middle">💡</text><text x="140" y="250" font-family="sans-serif" font-size="16" text-anchor="middle">@sarah.sells</text></svg>')); run(); }} className="mt-3 text-[12.5px] font-extrabold underline underline-offset-2">
              No screenshot handy? Use a sample
            </button>
          )}
        </div>

        <button onClick={() => toast('Textbook scanning is coming soon 📚')} className="stk press order-3 flex flex-col items-start gap-2 rounded-[22px] bg-card p-5 text-left">
          <span className="text-4xl">📚</span>
          <span className="font-display text-[21px] font-bold">Scan textbook</span>
          <span className="text-[13.5px] font-semibold text-soft">ISBN in, fair price out.</span>
        </button>
      </div>

      <AnimatePresence>
        {phase === 'failed' && (
          <motion.div id="ai-result" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <ErrorState line="Couldn't read that one. Fill it in yourself?" onRetry={run} />
          </motion.div>
        )}
        {phase === 'done' && (
          <motion.form
            id="ai-result"
            onSubmit={e => { e.preventDefault(); publish(); }}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            className="stk mt-8 rounded-[24px] bg-card p-5 sm:p-7"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-[24px] font-bold">Here&apos;s your listing</h2>
              <div className="flex items-center gap-2">
                <span className="label text-[11px] text-soft">AI confidence</span>
                <div className="h-3 w-28 overflow-hidden rounded-full border-2 border-ink bg-sunk">
                  <motion.div className="h-full bg-mint" initial={{ width: 0 }} animate={{ width: `${r.confidence * 100}%` }} transition={{ duration: 0.8 }} />
                </div>
                <span className="font-display text-[18px] font-bold">{Math.round(r.confidence * 100)}%</span>
              </div>
            </div>
            <p className="mt-1 text-[13px] font-semibold text-soft">Read from a post by {r.author_handle}. Fair price {money(r.fair_price.low_cents)}–{money(r.fair_price.high_cents)}.</p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="label text-[11px] text-soft">Title</span>
                <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="mt-1.5 w-full rounded-full border-[2.5px] border-ink bg-bg px-4 py-3 font-semibold outline-none" />
              </label>
              <label className="block">
                <span className="label text-[11px] text-soft">Price</span>
                <div className="mt-1.5 flex items-center rounded-full border-[2.5px] border-ink bg-bg px-4">
                  <span className="font-bold">$</span>
                  <input type="number" min={1} value={form.price} onChange={e => setForm({ ...form, price: Number(e.target.value) })} className="w-full bg-transparent px-1 py-3 font-semibold outline-none" />
                </div>
              </label>
              <fieldset className="block">
                <legend className="label text-[11px] text-soft">Condition {r.missing_fields.includes('condition') && !form.condition && <span className="text-accent-text">· we couldn&apos;t tell</span>}</legend>
                <div className={`mt-1.5 flex flex-wrap gap-2 rounded-[20px] p-1.5 ${r.missing_fields.includes('condition') && !form.condition ? 'border-[2.5px] border-dashed border-ink bg-butter/60' : ''}`}>
                  {CONDS.map(([v, l]) => (
                    <button type="button" key={v} onClick={() => setForm({ ...form, condition: v })} className={`rounded-full border-2 border-ink px-3 py-1.5 text-[12.5px] font-extrabold ${form.condition === v ? 'bg-ink text-bg' : 'bg-card text-ink'}`}>{l}</button>
                  ))}
                </div>
              </fieldset>
              <label className="block sm:col-span-2">
                <span className="label text-[11px] text-soft">Description</span>
                <textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="mt-1.5 w-full rounded-[18px] border-[2.5px] border-ink bg-bg px-4 py-3 font-medium outline-none" />
              </label>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Pill type="submit" size="lg">Publish to the feed →</Pill>
              <Pill type="button" variant="neutral" size="lg" onClick={() => { setImg(null); setPhase('idle'); }}>Start over</Pill>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
