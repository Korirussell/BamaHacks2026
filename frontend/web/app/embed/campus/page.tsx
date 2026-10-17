'use client';
/**
 * iOS embed route (map-plan.md §3): client-only, full-viewport, no rail/nav/padding.
 * Renders the same <Campus3D> as /history and the meetup picker, driven entirely by
 * query params on load and by window.handoffMap afterwards.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Campus3DBoundary } from '@/components/campus3d/Campus3DBoundary';
import type { Pillar3D, Pin3D } from '@/components/campus3d/Campus3D';
import { PLACE_LABEL } from '@/components/campus3d/placeMap';
import type { MeetupSuggestion } from '@/lib/types';
import meetupsMayaJson from '@/mocks/v2/meetups_maya.json';
import meetupsZoeJson from '@/mocks/v2/meetups_zoe.json';
import historyJson from '@/mocks/v2/history.json';
import { sendToHost, type HandoffMapAPI, type Pillar, type Pin } from './bridge';

const Campus3D = dynamic(() => import('@/components/campus3d/Campus3D'), { ssr: false });

type Mode = 'meetup' | 'history' | 'focus';
type DataKey = 'meetups_maya' | 'meetups_zoe' | 'history';
type Replay = { fromPlaceId: string; toPlaceId: string; key: number };

const buildingLabel = (placeId: string) => PLACE_LABEL[placeId] ?? placeId;

function pillarsFromSuggestions(items: MeetupSuggestion[], selectedId: string | null): Pillar3D[] {
  return items.map((m, i) => ({
    id: m.id,
    placeId: m.place_id,
    rank: i + 1,
    label: `${m.method === 'locker' ? '🔐 ' : ''}${buildingLabel(m.place_id)}`,
    selected: selectedId ? m.id === selectedId : undefined,
  }));
}

function pinsFromHistory(items: typeof historyJson.items): Pin3D[] {
  const byPlace = new Map<string, Pin3D>();
  for (const h of items) {
    const existing = byPlace.get(h.place_id);
    if (existing) existing.count = (existing.count ?? 1) + 1;
    else byPlace.set(h.place_id, { id: h.place_id, placeId: h.place_id, label: `${h.title} · ${h.partner} · ${h.date}`, emoji: h.emoji, count: 1 });
  }
  return [...byPlace.values()];
}

function EmbedCampus() {
  const params = useSearchParams();
  const mode = (params.get('mode') as Mode | null) ?? 'meetup';
  const dataKey = (params.get('data') as DataKey | null) ?? (mode === 'history' ? 'history' : mode === 'meetup' ? 'meetups_maya' : null);
  const initialFocus = params.get('focus');
  const initialSelected = params.get('selected');

  const [theme, setTheme] = useState<'light' | 'dark'>(params.get('theme') === 'dark' ? 'dark' : 'light');
  const [interactive, setInteractive] = useState(params.get('interactive') !== '0');
  const [showLabels] = useState(params.get('labels') !== '0');
  const [focusPlaceId, setFocusPlaceId] = useState<string | null>(initialFocus);
  const [replay, setReplay] = useState<Replay | null>(null);

  const [pillars, setPillars] = useState<Pillar3D[]>(() => {
    if (mode !== 'meetup') return [];
    const src = dataKey === 'meetups_zoe' ? (meetupsZoeJson as MeetupSuggestion[]) : (meetupsMayaJson as MeetupSuggestion[]);
    return pillarsFromSuggestions(src, initialSelected);
  });
  const [pins, setPins] = useState<Pin3D[]>(() => {
    if (mode === 'history') return pinsFromHistory(historyJson.items);
    if (mode === 'focus' && initialFocus) return [{ id: `focus_${initialFocus}`, placeId: initialFocus, label: buildingLabel(initialFocus) }];
    return [];
  });

  // Force the theme regardless of the host app's system preference / stored next-themes state,
  // since this route is a standalone WKWebView page driven only by `theme`/setTheme (map-plan.md §3).
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);

  const readySent = useRef(false);
  const handleReady = useCallback(() => {
    if (readySent.current) return;
    readySent.current = true;
    sendToHost('ready');
  }, []);
  const handleError = useCallback((message: string) => sendToHost('error', { message }), []);
  const handlePinClick = useCallback((id: string) => {
    setFocusPlaceId(id);
    sendToHost('pinTap', { id });
  }, []);
  const handlePillarClick = useCallback((id: string) => {
    setPillars(prev => prev.map(p => ({ ...p, selected: p.id === id })));
    sendToHost('pillarTap', { id });
  }, []);
  const handleReplayEnd = useCallback(() => {
    setReplay(prev => {
      if (prev) sendToHost('replayEnd', { fromPlaceId: prev.fromPlaceId, toPlaceId: prev.toPlaceId });
      return null;
    });
  }, []);

  useEffect(() => {
    const api: HandoffMapAPI = {
      setTheme: t => setTheme(t === 'dark' ? 'dark' : 'light'),
      setPillars: (next: Pillar[]) => setPillars(next as Pillar3D[]),
      selectPillar: id => setPillars(prev => prev.map(p => ({ ...p, selected: p.id === id }))),
      setPins: (next: Pin[]) => setPins(next as Pin3D[]),
      focusPlace: placeId => setFocusPlaceId(placeId),
      replay: (fromPlaceId, toPlaceId) => setReplay({ fromPlaceId, toPlaceId, key: Date.now() }),
      setInteractive: on => setInteractive(on),
    };
    window.handoffMap = api;
    return () => { delete window.handoffMap; };
  }, []);

  const bg = theme === 'dark' ? '#161213' : '#E8F7EE';
  const fallback = useMemo(
    () => (
      <div className="flex h-full w-full items-center justify-center text-[13px] font-extrabold uppercase" style={{ color: theme === 'dark' ? '#F7EFE6' : '#1A1414' }}>
        Map unavailable
      </div>
    ),
    [theme],
  );

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: bg }}>
      <Campus3DBoundary fallback={fallback} onError={handleError}>
        <Campus3D
          mode={mode}
          pins={pins}
          pillars={pillars}
          focusPlaceId={focusPlaceId}
          onPinClick={handlePinClick}
          onPillarClick={handlePillarClick}
          replay={replay}
          onReplayEnd={handleReplayEnd}
          theme={theme}
          interactive={interactive}
          showLabels={showLabels}
          shadowMapSize={1024}
          embedded
          onReady={handleReady}
          onError={handleError}
          fallback={fallback}
        />
      </Campus3DBoundary>
    </div>
  );
}

export default function EmbedCampusPage() {
  return (
    <Suspense fallback={null}>
      <EmbedCampus />
    </Suspense>
  );
}
