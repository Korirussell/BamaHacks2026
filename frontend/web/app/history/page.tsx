'use client';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Campus3DBoundary } from '@/components/campus3d/Campus3DBoundary';
import { Play } from 'lucide-react';
import { copy, copy2 } from '@/lib/copy';
import { history, placeById } from '@/lib/data';
import { money } from '@/lib/money';
import { useDemo, useMockLoad } from '@/lib/store';
import { HistoryMap3D, type MapPin } from '@/components/HistoryMap3D';
import { ErrorState, LoadingGlyph, PageTitle, Skeleton, StickerCard } from '@/components/ui';

const Campus3D = dynamic(() => import('@/components/campus3d/Campus3D'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-[24px] skel">
      <LoadingGlyph />
    </div>
  ),
});

export default function History() {
  const { extraHistory, celebrate } = useDemo();
  const { status, retry } = useMockLoad();
  const [focus, setFocus] = useState<string | null>(null);
  const [replay, setReplay] = useState<{ from: string; to: string; key: number } | null>(null);
  const items = useMemo(() => [...extraHistory, ...history.items], [extraHistory]);
  const stats = history.stats;
  const pins: MapPin[] = useMemo(() => {
    const m = new Map<string, MapPin>();
    items.forEach(h => { const p = m.get(h.place_id); if (p) p.count++; else m.set(h.place_id, { id: h.place_id, placeId: h.place_id, count: 1, label: h.title }); });
    return [...m.values()];
  }, [items]);

  const play = (i: number) => {
    const from = items[i].place_id;
    const to = items[(i + 1) % items.length].place_id === from ? items[(i + 2) % items.length].place_id : items[(i + 1) % items.length].place_id;
    setFocus(null);
    setReplay({ from: to, to: from, key: Date.now() });
  };

  return (
    <div className="mx-auto max-w-[1240px]">
      <PageTitle title={copy2.history.title} sub="Every handoff you've made on campus." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
        <div className="order-2 lg:order-1">
          <div className="grid grid-cols-2 gap-3">
            {[[`${stats.count + extraHistory.length}`, 'handoffs'], [money(stats.saved_cents), 'saved vs. new'], [`${stats.avg_walk_min} min`, 'avg walk'], [`${stats.no_shows}`, 'no-shows']].map(([v, l]) => (
              <StickerCard key={l} className="p-3.5">
                <p className="font-display text-[26px] font-bold">{v}</p>
                <p className="label text-[10.5px] text-soft">{l}</p>
              </StickerCard>
            ))}
          </div>
          <ul className="mt-5 space-y-2.5">
            {status === 'loading' ? [0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[68px]" />) : status === 'error' ? <ErrorState onRetry={retry} /> : items.map((h, i) => (
              <li
                key={h.id}
                onMouseEnter={() => setFocus(h.place_id)}
                onFocus={() => setFocus(h.place_id)}
                className="flex items-center gap-3 rounded-[18px] border-2 border-ink bg-card p-3 shadow-[3px_3px_0_var(--shadow)] transition-transform hover:-translate-y-0.5"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border-2 border-ink bg-peach text-2xl">{h.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-extrabold">{h.title} <span className="font-semibold text-soft">· {h.role} {h.role === 'bought' ? 'from' : 'to'} {h.partner}</span></p>
                  <p className="truncate text-[12px] font-semibold text-soft">{placeById(h.place_id).name} · {h.date}</p>
                </div>
                <span className={`hidden rounded-full border-2 border-ink px-2 py-0.5 text-[10px] font-extrabold uppercase sm:inline-flex ${h.method === 'locker' ? 'bg-mint text-dark-ink' : 'bg-butter text-dark-ink'}`}>{h.method === 'locker' ? 'Locker' : 'In person'}</span>
                <span className="w-11 text-right font-display text-[16px] font-bold">{money(h.amount_cents)}</span>
                <button onClick={() => play(i)} aria-label={`Replay ${h.title}`} className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-accent text-on-accent shadow-[2px_2px_0_var(--shadow)]">
                  <Play size={14} strokeWidth={2.8} className="ml-0.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="order-1 h-[420px] lg:order-2 lg:sticky lg:top-8 lg:h-[calc(100vh-120px)] lg:min-h-[560px]">
          {(() => {
            const onEnd = () => replay && celebrate({ kind: 'touchdown', title: copy.celebrate.td, line: copy.celebrate.tdDone, onDone: () => setReplay(null) });
            const flat = <HistoryMap3D pins={pins} focus={focus} replay={replay} onReplayEnd={onEnd} />;
            return (
              <Campus3DBoundary fallback={flat}>
                <Campus3D
                  mode="history"
                  pins={pins.map(p => { const h = items.find(x => x.place_id === p.placeId)!; return { id: p.id, placeId: p.placeId, label: `${h.title} · ${h.partner} · ${h.date}`, emoji: h.emoji, count: p.count }; })}
                  focusPlaceId={focus}
                  onPinClick={id => setFocus(f => (f === id ? null : id))}
                  replay={replay ? { fromPlaceId: replay.from, toPlaceId: replay.to, key: replay.key } : null}
                  onReplayEnd={onEnd}
                  fallback={flat}
                />
              </Campus3DBoundary>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
