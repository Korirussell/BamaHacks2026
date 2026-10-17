'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Bid, Listing, Order } from './types';
import { bids as seedBids, listings as seedListings, order as seedOrder } from './data';
import { Celebration, type CelebrationKind } from '@/components/Celebration';

export type DmStatus = 'queued' | 'sent' | 'clicked' | 'claimed';
export type DmLog = { handle: string; message: string; status: DmStatus; link: string };

type DemoState = {
  listings: Listing[];
  bids: Bid[];
  order: Order;
  lockedMeetupId: string | null;
  handedOff: boolean;
  dm: DmLog[];
  mockMode: boolean;
  scrapeTick: number;
  /** Flow B (Owala → locker) stage */
  zoe: 'none' | 'bought' | 'picked' | 'confirmed' | 'dropped' | 'done';
  zoeSpot: string | null;
  /** Flow A: Maya's buy request for the posted mouse */
  maya: 'none' | 'requested' | 'accepted' | 'picked' | 'confirmed' | 'done';
  mayaSpot: string | null;
  extraHistory: { id: string; emoji: string; title: string; partner: string; place_id: string; date: string; method: string; amount_cents: number; role: string }[];
};

const seedDm = (): DmLog[] => [
  {
    handle: '@jackson.rides',
    message: "Hey! 👋 3 UA students want to buy your Trek bike — top offer is $200. Make the handoff and get paid securely: handoff.app/claim/abc123",
    status: 'queued',
    link: '/claim/abc123',
  },
];

const seed = (): DemoState => ({
  listings: structuredClone(seedListings),
  bids: structuredClone(seedBids),
  order: structuredClone(seedOrder) as Order,
  lockedMeetupId: null,
  handedOff: false,
  dm: seedDm(),
  mockMode: true,
  scrapeTick: 0,
  zoe: 'none',
  zoeSpot: null,
  maya: 'none',
  mayaSpot: null,
  extraHistory: [],
});

const KEY = 'handoff-demo-v2';
const statusRank: DmStatus[] = ['queued', 'sent', 'clicked', 'claimed'];

type CelebrateOpts = { kind: CelebrationKind; title: string; line: string; onDone?: () => void };

type Ctx = DemoState & {
  hydrated: boolean;
  set: (fn: (s: DemoState) => DemoState) => void;
  reset: () => void;
  addInterest: (listingId: string, amount: number, message: string) => void;
  claimGhost: () => void;
  publishListing: (l: Listing) => void;
  bumpDm: (to: DmStatus) => void;
  celebrate: (o: CelebrateOpts) => void;
};

const DemoCtx = createContext<Ctx | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(seed);
  const [hydrated, setHydrated] = useState(false);
  const [cel, setCel] = useState<CelebrateOpts | null>(null);
  const skipWrite = useRef(false);

  // Persist to localStorage so the demo panel, claim tab and feed tab stay in sync.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setState({ ...seed(), ...JSON.parse(raw) });
    } catch {}
    setHydrated(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      try {
        skipWrite.current = true;
        setState(e.newValue ? { ...seed(), ...JSON.parse(e.newValue) } : seed());
      } catch {}
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (skipWrite.current) { skipWrite.current = false; return; }
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  }, [state, hydrated]);

  const set = useCallback((fn: (s: DemoState) => DemoState) => setState(fn), []);
  const reset = useCallback(() => setState(seed()), []);

  const bumpDm = useCallback((to: DmStatus) => {
    setState(s => ({
      ...s,
      dm: s.dm.map(d => (statusRank.indexOf(to) > statusRank.indexOf(d.status) ? { ...d, status: to } : d)),
    }));
  }, []);

  const addInterest = useCallback((listingId: string, amount: number, message: string) => {
    setState(s => ({
      ...s,
      listings: s.listings.map(l =>
        l.id === listingId
          ? { ...l, interest: { count: (l.interest?.count ?? 0) + 1, top_amount_cents: Math.max(l.interest?.top_amount_cents ?? 0, amount) } }
          : l,
      ),
      bids: [...s.bids, { id: `b_me_${Date.now()}`, listing_id: listingId, user_id: 'u_kori', amount_cents: amount, message: message || `${'$' + amount / 100}, I'm in`, reactions: { fire: 0, eyes: 0 } }],
      dm: s.dm.map(d => (d.status === 'queued' ? { ...d, status: 'sent' } : d)),
    }));
  }, []);

  const claimGhost = useCallback(() => {
    setState(s => ({
      ...s,
      listings: s.listings.map(l =>
        l.id === 'l_bike' ? { ...l, status: 'active', seller_id: 'u_jackson', source: { ...l.source, claimed: true } } : l,
      ),
      dm: s.dm.map(d => ({ ...d, status: 'claimed' })),
    }));
  }, []);

  const publishListing = useCallback((l: Listing) => {
    setState(s => ({ ...s, listings: [l, ...s.listings.filter(x => x.id !== l.id)] }));
  }, []);

  const celebrate = useCallback((o: CelebrateOpts) => setCel(o), []);

  return (
    <DemoCtx.Provider value={{ ...state, hydrated, set, reset, addInterest, claimGhost, publishListing, bumpDm, celebrate }}>
      {children}
      {cel && (
        <Celebration
          kind={cel.kind}
          title={cel.title}
          line={cel.line}
          onDone={() => {
            const done = cel.onDone;
            setCel(null);
            done?.();
          }}
        />
      )}
    </DemoCtx.Provider>
  );
}

export function useDemo() {
  const c = useContext(DemoCtx);
  if (!c) throw new Error('useDemo outside DemoProvider');
  return c;
}

/** Fake network latency so skeletons show. `?fail=1` in the URL forces the error state. */
export function useMockLoad(deps: unknown[] = []) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [n, setN] = useState(0);
  useEffect(() => {
    setStatus('loading');
    const fail = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fail') === '1' && n === 0;
    const t = setTimeout(() => setStatus(fail ? 'error' : 'ready'), 300 + Math.random() * 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, ...deps]);
  return { status, retry: () => setN(x => x + 1) };
}
