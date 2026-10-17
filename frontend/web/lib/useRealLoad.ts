'use client';
// Loader for real-mode pages: same { status, retry } shape as useMockLoad, plus the data.
// No session (UNAUTHENTICATED) sends the user to /signin.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from './real';

export function useRealLoad<T>(load: () => Promise<T>, deps: unknown[] = [], enabled = true) {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setStatus('loading');
    load().then(
      d => { if (live) { setData(d); setStatus('ready'); } },
      (e: ApiError) => {
        if (!live) return;
        if (e.code === 'UNAUTHENTICATED') { router.replace('/signin'); return; }
        setError(e); setStatus('error');
      },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, enabled, ...deps]);
  const retry = useCallback(() => setN(x => x + 1), []);
  return { data, status, error, retry };
}
