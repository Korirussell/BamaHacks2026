'use client';
import type { ReactNode } from 'react';
import { useMockLoad } from '@/lib/store';
import { EmptyState, ErrorState, PageTitle, Skeleton } from './ui';

export function SimpleList<T>({ title, sub, items, empty, render }: { title: string; sub: string; items: T[]; empty: string; render: (t: T) => ReactNode }) {
  const { status, retry } = useMockLoad();
  return (
    <div className="mx-auto max-w-[900px]">
      <PageTitle title={title} sub={sub} />
      {status === 'error' ? <ErrorState onRetry={retry} /> : status === 'loading' ? (
        <div className="grid gap-4 sm:grid-cols-2">{[0, 1].map(i => <Skeleton key={i} className="h-32" />)}</div>
      ) : items.length === 0 ? <EmptyState line={empty} /> : <div className="grid gap-5 sm:grid-cols-2">{items.map(render)}</div>}
    </div>
  );
}
