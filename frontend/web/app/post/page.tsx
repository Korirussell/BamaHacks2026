'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Camera, Check, ImagePlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { copy, copy2 } from '@/lib/copy';
import { money } from '@/lib/money';
import { photoResult, screenshotResult } from '@/lib/data';
import { PricingPipeline } from '@/components/PricingPipeline';
import { useDemo } from '@/lib/store';
import type { Listing } from '@/lib/types';
import { ErrorState, PageTitle, Pill } from '@/components/ui';

type Phase = 'idle' | 'running' | 'done' | 'failed';
const CONDS = [['new', 'New'], ['like_new', 'Like new'], ['good', 'Good'], ['fair', 'Fair']] as const;

function JobProgress({ step, steps = copy.job.steps }: { step: number; steps?: readonly string[] }) {
  return (
    <ol className="mt-5 space-y-3">
      {steps.map((s, i) => {
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
  const { publishListing, set } = useDemo();
  const [img, setImg] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<'photo' | 'screenshot'>('photo');
  const [photoPrice, setPhotoPrice] = useState(photoResult.price_model.fast_cents);
  const photoRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const r = screenshotResult;
  const [form, setForm] = useState({ title: r.title, price: r.price_cents / 100, condition: '', description: r.description });

  const run = useCallback((m: 'photo' | 'screenshot' = 'screenshot') => {
    setMode(m);
    setPhase('running');
    setStep(0);
    const fail = new URLSearchParams(window.location.search).get('fail') === '1';
    const n = m === 'photo' ? 4 : 3, per = 2400 / n;
    for (let i = 1; i < n; i++) setTimeout(() => setStep(i), per * i);
    setTimeout(() => { setStep(n); setPhase(fail ? 'failed' : 'done'); setTimeout(() => document.getElementById('ai-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350); }, 2400);
  }, []);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const take = useCallback((file: File | null | undefined, m?: 'photo' | 'screenshot') => {
    if (!file || !file.type.startsWith('image/')) return;
    setImg(URL.createObjectURL(file));
    run(m ?? modeRef.current);
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
      emoji: '💡', tile: 'peach', tag: 'New', location_label: 'Tutwiler', images: ['/listings/l_lamp-1.webp', '/listings/l_lamp-2.webp'], status: 'active', seller_id: 'u_kori',
      source: { channel: 'screenshot', author_handle: r.author_handle, claimed: true }, fair_price: r.fair_price, reason: 'new',
      created_at: new Date().toISOString(),
    };
    publishListing(l);
    toast('Live on the feed');
    router.push('/feed');
  };

  const publishPhoto = () => {
    const r = photoResult;
    publishListing({
      id: 'l_mouse', title: r.title, description: r.description, category: 'tech', price_cents: photoPrice, negotiable: false,
      condition: 'like_new', emoji: r.emoji, tile: 'mint', tag: 'Tech', location_label: 'Bevill', images: ['/listings/l_mouse-1.webp', '/listings/l_mouse-2.webp'], status: 'active', seller_id: 'u_kori',
      source: { channel: 'native', claimed: true }, fair_price: { low_cents: r.price_model.fast_cents, high_cents: r.price_model.max_cents }, reason: 'new',
      created_at: new Date().toISOString(),
    });
    toast(copy2.sell.posted);
    // Flow A (mock): Maya asks for it ~4 s later.
    setTimeout(() => {
      set(s => (s.maya === 'none' ? { ...s, maya: 'requested' } : s));
      toast('Maya wants your mouse · $25', { action: { label: 'Open', onClick: () => router.push('/requests/br1') }, duration: 8000 });
    }, 4000);
    router.push('/feed');
  };

  const SAMPLE_MOUSE = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#E9DFD0"/><rect y="210" width="400" height="90" fill="#C9B79C"/><ellipse cx="200" cy="230" rx="120" ry="14" fill="#00000022"/><text x="200" y="200" font-size="150" text-anchor="middle">🖱️</text></svg>');

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageTitle title="Post something" sub="Three clicks: snap it, check it, post it." />
      <div className="grid gap-5 md:grid-cols-[1fr_1.6fr_1fr]">
        <div className={`stk order-1 rounded-[22px] p-5 md:order-1 ${mode === 'photo' ? 'bg-butter text-dark-ink' : 'bg-card'}`}>
          <span className="text-4xl">📸</span>
          <h2 className="font-display mt-2 text-[24px] font-bold">{copy2.sell.snap}</h2>
          <p className={`text-[13.5px] font-semibold ${mode === 'photo' ? 'opacity-75' : 'text-soft'}`}>{copy2.sell.snapSub}</p>
          <button onClick={() => { setMode('photo'); photoRef.current?.click(); }} className="stk-btn label mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-3 text-on-accent"><Camera size={16} strokeWidth={2.4} /> Take a photo</button>
          <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => take(e.target.files?.[0], 'photo')} />
          <button onClick={() => { setImg(SAMPLE_MOUSE); run('photo'); }} className="mt-3 text-[12.5px] font-extrabold underline underline-offset-2">Use the sample mouse</button>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); take(e.dataTransfer.files?.[0], 'screenshot'); }}
          onClick={() => setMode('screenshot')}
          className={`stk order-2 rounded-[22px] p-5 transition-transform md:order-2 ${mode === 'screenshot' ? 'bg-butter text-dark-ink' : 'bg-card'} ${drag ? 'scale-[1.02]' : ''}`}
        >
          <div className="flex items-center gap-2">
            <span className="text-4xl">🖼️</span>
            <span className="rounded-full border-2 border-[#1A1414] bg-white px-2 py-0.5 text-[10.5px] font-extrabold uppercase">AI</span>
          </div>
          <h2 className="font-display mt-2 text-[24px] font-bold">Screenshot → listing</h2>
          {!img || mode !== 'screenshot' ? (
            <button onClick={() => { setMode('screenshot'); fileRef.current?.click(); }} className={`mt-4 flex w-full flex-col items-center gap-2 rounded-[18px] border-[2.5px] border-dashed border-current px-4 py-8 text-center ${drag ? 'bg-white text-[#1A1414]' : 'bg-white/40'}`}>
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
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => take(e.target.files?.[0], 'screenshot')} />
          {(!img || mode !== 'screenshot') && (
            <button onClick={() => { setImg('data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="280" height="360"><rect width="280" height="360" fill="#FFE3D6"/><text x="140" y="170" font-size="90" text-anchor="middle">💡</text><text x="140" y="250" font-family="sans-serif" font-size="16" text-anchor="middle">@sarah.sells</text></svg>')); run('screenshot'); }} className="mt-3 text-[12.5px] font-extrabold underline underline-offset-2">
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

      {mode === 'photo' && img && phase === 'running' && (
        <div className="stk mt-8 flex flex-col gap-5 rounded-[24px] bg-card p-5 sm:flex-row">
          <div className="relative h-48 w-full shrink-0 overflow-hidden rounded-[16px] border-[2.5px] border-ink sm:w-64">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt="Your photo" className="h-full w-full object-cover" />
            <motion.span className="absolute inset-x-0 h-[3px] bg-accent" animate={{ top: ['5%', '95%', '5%'] }} transition={{ duration: 1.6, repeat: Infinity }} />
            {step >= 1 && <motion.div initial={{ opacity: 0, scale: 1.2 }} animate={{ opacity: 1, scale: 1 }} className="absolute rounded-[6px] border-[3px] border-accent" style={{ left: '18%', top: '22%', width: '62%', height: '52%' }} />}
          </div>
          <div className="flex-1"><JobProgress step={step} steps={copy2.job.photo} /></div>
        </div>
      )}

      <AnimatePresence>
        {mode === 'photo' && phase === 'done' && (
          <motion.div id="ai-result" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.15fr]">
            <div className="lg:sticky lg:top-8 lg:self-start">
              <div className="stk overflow-hidden rounded-[22px] bg-card">
                <div className="relative flex aspect-[4/3] items-center justify-center border-b-[2.5px] border-ink bg-mint">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <span className="text-7xl">{photoResult.emoji}</span>}
                  <span className="absolute left-3 top-3 rounded-full border-2 border-[#1A1414] bg-white px-2 py-0.5 text-[10.5px] font-extrabold uppercase text-[#1A1414]">Tech · Like new</span>
                </div>
                <div className="p-5">
                  <h2 className="font-display text-[22px] font-bold">{photoResult.title}</h2>
                  <p className="font-display mt-1 text-[30px] font-bold">{money(photoPrice)}</p>
                  <p className="mt-2 text-[14px] font-medium">{photoResult.description}</p>
                  <p className="mt-3 text-[12.5px] font-bold text-soft">AI confidence {Math.round(photoResult.confidence * 100)}% · nothing missing</p>
                  <Pill size="lg" className="mt-5 w-full" onClick={publishPhoto}>{copy2.sell.post} →</Pill>
                </div>
              </div>
            </div>
            <PricingPipeline img={img} price={photoPrice} onPrice={setPhotoPrice} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {phase === 'failed' && (
          <motion.div id="ai-result" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <ErrorState line="Couldn't read that one. Fill it in yourself?" onRetry={() => run(mode)} />
          </motion.div>
        )}
        {mode === 'screenshot' && phase === 'done' && (
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
