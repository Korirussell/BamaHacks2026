'use client';
import { toast } from 'sonner';
import { extras, userById } from '@/lib/data';
import { money } from '@/lib/money';
import { SimpleList } from '@/components/SimpleList';
import { Pill, StickerCard } from '@/components/ui';

export function MockTutoring() {
  return (
    <SimpleList
      title="Tutoring"
      sub="Tutors who got an A in the class. Transcript-verified."
      items={extras.tutors}
      empty="No tutors for this class yet."
      render={t => {
        const u = userById(t.user_id)!;
        return (
          <StickerCard key={t.id} className="p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-ink bg-mint text-2xl">{u.avatar_emoji}</span>
              <div>
                <p className="font-display text-[20px] font-bold">{t.course}</p>
                <p className="text-[13px] font-semibold text-soft">{u.display_name} · got an {t.grade} {t.verified && '✓'}</p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <p className="text-[13px] font-bold">★ {t.rating} · {t.sessions} sessions</p>
              <Pill size="sm" onClick={() => toast(`Request sent to ${u.display_name}. We'll match it to both your free time.`)}>{money(t.rate_cents)}/hr · Book</Pill>
            </div>
          </StickerCard>
        );
      }}
    />
  );
}
