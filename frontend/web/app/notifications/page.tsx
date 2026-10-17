'use client';
import Link from 'next/link';
import { notifications as mockNotifications } from '@/lib/data';
import { useDemo, useMockLoad } from '@/lib/store';
import { USE_MOCKS, getNotifications } from '@/lib/api';
import { useRealLoad } from '@/lib/useRealLoad';
import { EmptyState, ErrorState, PageTitle, Skeleton } from '@/components/ui';

export default function Notifications() {
  const mock = useMockLoad();
  // Real mode: fresh from /me/notifications on every visit, never the mock list.
  const real = useRealLoad(getNotifications, [], !USE_MOCKS);
  const { status, retry } = USE_MOCKS ? mock : real;
  const { notificationItems } = useDemo();
  const notifications = USE_MOCKS ? (notificationItems.length ? notificationItems : mockNotifications) : real.data ?? [];
  return (
    <div className="mx-auto max-w-[760px]">
      <PageTitle title="Notifications" />
      <div className="space-y-3">
        {status === 'error' ? <ErrorState onRetry={retry} /> : status === 'loading' ? [0, 1, 2].map(i => <Skeleton key={i} className="h-[72px]" />) : notifications.length === 0 ? (
          <EmptyState emoji="🔕" line="All quiet. We'll ping you when someone wants your stuff." />
        ) : notifications.map(n => (
          <Link key={n.id} href={n.deep_link} className={`press flex items-center gap-3 rounded-[20px] border-[2.5px] border-ink p-4 shadow-[4px_4px_0_var(--shadow)] ${n.read ? 'bg-card' : 'bg-butter text-dark-ink'}`}>
            {!n.read && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
            <div className="min-w-0 flex-1">
              <p className="font-extrabold">{n.title}</p>
              <p className={`text-[13px] font-semibold ${n.read ? 'text-soft' : 'opacity-75'}`}>{n.body}</p>
            </div>
            <span className="shrink-0 text-[12px] font-bold opacity-70">{n.ago}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
