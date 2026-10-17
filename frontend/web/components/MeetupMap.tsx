'use client';
import dynamic from 'next/dynamic';
import { placeById } from '@/lib/data';
import type { MeetupSuggestion } from '@/lib/types';
import { StickerMap } from './StickerMap';
import { Campus3DBoundary } from './campus3d/Campus3DBoundary';
import { Skeleton } from './ui';

const Campus3D = dynamic(() => import('./campus3d/Campus3D'), { ssr: false, loading: () => <Skeleton className="h-full w-full rounded-[24px]" /> });

/** 3 suggested spots as light pillars on the 3D campus; falls back to the flat sticker map. */
export function MeetupMap({ spots, selected, onSelect, className = '' }: { spots: MeetupSuggestion[]; selected: string; onSelect: (id: string) => void; className?: string }) {
  const flat = <StickerMap spots={spots} selected={selected} onSelect={onSelect} className="h-full w-full" />;
  return (
    <div className={className}>
      <Campus3DBoundary fallback={flat}>
        <Campus3D
          mode="meetup"
          pillars={spots.map((s, i) => ({ id: s.id, placeId: s.place_id, rank: i + 1, label: `${s.start_label.replace(/^Pick up anytime after /, 'after ')} · ${placeById(s.place_id).name}`, selected: s.id === selected }))}
          onPillarClick={onSelect}
          fallback={flat}
        />
      </Campus3DBoundary>
    </div>
  );
}
