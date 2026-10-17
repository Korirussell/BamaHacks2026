'use client';
import { toast } from 'sonner';
import { me, userById } from '@/lib/data';
import { money } from '@/lib/money';
import { ThemeSwitch } from '@/components/Shell';
import { Pill, PillLink, ReliabilityBadge, StickerCard } from '@/components/ui';

export default function Profile() {
  const u = userById(me.user_id)!;
  return (
    <div className="mx-auto max-w-[760px]">
      <StickerCard className="flex flex-col items-center p-7 text-center sm:flex-row sm:text-left">
        <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-[2.5px] border-ink bg-butter text-5xl">{u.avatar_emoji}</span>
        <div className="mt-4 sm:ml-6 sm:mt-0">
          <h1 className="font-display text-[30px] font-bold">{u.display_name}</h1>
          <p className="text-[14px] font-semibold text-soft">{u.major} · {u.grad_year} · {me.email}</p>
          <div className="mt-2"><ReliabilityBadge r={u.reliability} /></div>
        </div>
      </StickerCard>
      <div className="mt-6 grid grid-cols-3 gap-4">
        {[[`${u.reliability.completed}`, 'trades'], [`${u.reliability.score}★`, 'rating'], [money(me.budget_cents), 'budget']].map(([v, l]) => (
          <StickerCard key={l} className="p-4 text-center">
            <p className="font-display text-[26px] font-bold">{v}</p>
            <p className="label text-[10.5px] text-soft">{l}</p>
          </StickerCard>
        ))}
      </div>
      <StickerCard className="mt-6 space-y-5 p-6">
        <div>
          <h2 className="font-display text-[21px] font-bold">Theme</h2>
          <div className="mt-3"><ThemeSwitch /></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-dashed border-ink/30 pt-5">
          <div>
            <p className="font-extrabold">Instagram</p>
            <p className="text-[13px] font-semibold text-soft">Not linked</p>
          </div>
          <Pill variant="neutral" size="sm" onClick={() => toast('Instagram linking is coming soon')}>Link</Pill>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-dashed border-ink/30 pt-5">
          <div>
            <p className="font-extrabold">Class schedule</p>
            <p className="text-[13px] font-semibold text-soft">3 classes · CS 201, MATH 237, CS 260</p>
          </div>
          <PillLink href="/meetup/o_fridge" variant="neutral" size="sm">See it in action</PillLink>
        </div>
      </StickerCard>
    </div>
  );
}
