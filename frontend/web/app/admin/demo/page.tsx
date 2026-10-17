'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { Camera, Copy, ExternalLink, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { copy } from '@/lib/copy';
import { listings as seedListings, bids as seedBids } from '@/lib/data';
import { useDemo, type DmStatus } from '@/lib/store';
import { ApiError, USE_MOCKS, getAdminIngestionFeed, type IngestionPost } from '@/lib/api';
import { PageTitle, Pill, StickerCard } from '@/components/ui';

const STATUS_BG: Record<DmStatus, string> = { queued: 'bg-card', sent: 'bg-butter text-dark-ink', clicked: 'bg-mint text-dark-ink', claimed: 'bg-accent text-on-accent' };

export default function DemoPanel() {
  const { dm, mockMode, set, reset, celebrate, listings, zoe, maya } = useDemo();
  const { setTheme } = useTheme();
  const [scraping, setScraping] = useState(false);
  const [liveSources, setLiveSources] = useState<IngestionPost[]>([]);
  const bike = listings.find(l => l.id === 'l_bike');

  const scrape = async () => {
    if (!USE_MOCKS) {
      setScraping(true);
      try { setLiveSources(await getAdminIngestionFeed()); }
      catch (error) { toast.error(error instanceof ApiError && error.code === 'FORBIDDEN' ? 'Sign in as the seeded admin to view live sources.' : error instanceof Error ? error.message : 'Could not load live sources'); }
      finally { setScraping(false); }
      return;
    }
    setScraping(true);
    setTimeout(() => {
      const seedBike = structuredClone(seedListings.find(l => l.id === 'l_bike')!);
      set(s => ({
        ...s,
        listings: [seedBike, ...s.listings.filter(l => l.id !== 'l_bike')],
        bids: [...s.bids.filter(b => b.listing_id !== 'l_bike'), ...structuredClone(seedBids)],
        dm: s.dm.map(d => ({ ...d, status: 'queued' })),
        scrapeTick: s.scrapeTick + 1,
      }));
      setScraping(false);
      toast('1 new post from @jackson.rides');
    }, 1500);
  };

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageTitle title="Demo panel" sub="Backstage. Judges don't see this." right={<span className="rounded-full border-2 border-ink bg-butter px-3 py-1 text-[11px] font-extrabold uppercase text-dark-ink">Mock mode {mockMode ? 'on' : 'off'}</span>} />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 [&>*]:min-w-0">
        <StickerCard className="p-5">
          <h2 className="font-display text-[21px] font-bold">Instagram scraper</h2>
          <p className="mt-1 text-[13.5px] font-semibold text-soft">Pulls the latest UA buy/sell posts and turns them into ghost listings.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Pill onClick={() => void scrape()} disabled={scraping}>
              {scraping ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} strokeWidth={2.4} />}
              {scraping ? 'Scraping…' : 'Run Instagram scrape'}
            </Pill>
            <Link href="/feed" className="text-[13px] font-extrabold text-accent-text hover:underline">Open feed →</Link>
          </div>
          <p className="mt-3 text-[12.5px] font-semibold text-soft">Bike: <b className="text-ink">{bike?.status}</b> · 🔥 {bike?.interest?.count ?? 0} want it</p>
          {!USE_MOCKS && <div className="mt-3 space-y-1 text-[12px] font-semibold text-soft">{liveSources.length ? liveSources.slice(0, 5).map((post) => <p key={post.id}>@{post.author_handle} · {post.status} · {post.listing?.title || post.caption}</p>) : 'Sign in as admin, then load the real ingestion feed.'}</div>}
        </StickerCard>

        <StickerCard className="p-5">
          <h2 className="font-display text-[21px] font-bold">Fire a celebration</h2>
          <p className="mt-1 text-[13.5px] font-semibold text-soft">For practice. Katelyn&apos;s touchdown and field goal.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Pill variant="butter" onClick={() => celebrate({ kind: 'touchdown', title: copy.celebrate.td, line: copy.celebrate.tdPaid })}>Touchdown</Pill>
            <Pill variant="butter" onClick={() => celebrate({ kind: 'fieldgoal', title: copy.celebrate.fg, line: copy.celebrate.fgLocked })}>Field goal</Pill>
          </div>
        </StickerCard>

        <StickerCard className="p-5">
          <h2 className="font-display text-[21px] font-bold">Flow A · Maya</h2>
          <p className="mt-1 text-[13.5px] font-semibold text-soft">Request: <b className="text-ink">{maya}</b></p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Pill onClick={() => { set(s => ({ ...s, maya: 'requested' })); toast('Maya wants your mouse · $25'); }}>Send Maya&apos;s buy request</Pill>
            <Link href="/requests/br1" className="self-center text-[13px] font-extrabold text-accent-text hover:underline">Open request →</Link>
          </div>
        </StickerCard>

        <StickerCard className="p-5">
          <h2 className="font-display text-[21px] font-bold">Flow B · Zoe&apos;s locker</h2>
          <p className="mt-1 text-[13.5px] font-semibold text-soft">Stage: <b className="text-ink">{zoe}</b></p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Pill
              onClick={() => {
                set(s => ({ ...s, zoe: 'dropped', zoeSpot: s.zoeSpot ?? 'mz1' }));
                toast('Your Owala is ready · Locker 14 · code 4821');
              }}
            >
              Simulate locker drop-off
            </Pill>
            <Link href="/orders/o_owala" className="self-center text-[13px] font-extrabold text-accent-text hover:underline">Open chat →</Link>
          </div>
        </StickerCard>

        <StickerCard className="p-5 md:col-span-2">
          <h2 className="font-display text-[21px] font-bold">DM log</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13.5px]">
              <thead>
                <tr className="label text-[11px] text-soft">
                  <th className="pb-2">Handle</th><th className="pb-2">Message</th><th className="pb-2">Status</th><th className="pb-2">Claim link</th>
                </tr>
              </thead>
              <tbody>
                {dm.map(d => (
                  <tr key={d.handle} className="border-t-2 border-dashed border-ink/30 align-top">
                    <td className="py-3 pr-3 font-extrabold">{d.handle}</td>
                    <td className="max-w-[320px] py-3 pr-3 font-medium">{d.message}</td>
                    <td className="py-3 pr-3">
                      <span className={`inline-flex rounded-full border-2 border-ink px-2.5 py-0.5 text-[11px] font-extrabold uppercase ${STATUS_BG[d.status]}`}>{d.status}</span>
                    </td>
                    <td className="py-3">
                      <div className="flex gap-2">
                        <a href={d.link} target="_blank" rel="noreferrer" className="press inline-flex items-center gap-1 rounded-full border-2 border-ink bg-card px-2.5 py-1 text-[11px] font-extrabold uppercase shadow-[2px_2px_0_var(--shadow)]"><ExternalLink size={12} /> Open</a>
                        <button
                          onClick={() => { navigator.clipboard?.writeText(window.location.origin + d.link).catch(() => {}); toast('Claim link copied'); }}
                          className="press inline-flex items-center gap-1 rounded-full border-2 border-ink bg-card px-2.5 py-1 text-[11px] font-extrabold uppercase shadow-[2px_2px_0_var(--shadow)]"
                        >
                          <Copy size={12} /> Copy
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StickerCard>

        <StickerCard className="p-5">
          <h2 className="font-display text-[21px] font-bold">Theme</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            <Pill variant="neutral" onClick={() => setTheme('light')}>Force light</Pill>
            <Pill variant="ink" onClick={() => setTheme('dark')}>Force dark</Pill>
            <Pill variant="neutral" size="sm" onClick={() => setTheme('system')}>System</Pill>
          </div>
        </StickerCard>

        <StickerCard className="p-5">
          <h2 className="font-display text-[21px] font-bold">Data</h2>
          <label className="mt-3 flex items-center gap-3 text-[14px] font-bold">
            <input type="checkbox" checked={mockMode} onChange={e => set(s => ({ ...s, mockMode: e.target.checked }))} className="h-5 w-5 accent-[var(--accent)]" />
            Mock mode (seed data, never fails)
          </label>
          <Pill className="mt-4" onClick={() => { reset(); toast('Demo reset. Everything is back to seed data.'); }}>
            <RotateCcw size={16} strokeWidth={2.4} /> Reset demo
          </Pill>
        </StickerCard>
      </div>
      <div className="mt-8 flex flex-wrap gap-2 text-[12.5px] font-bold">
        {[['/claim/abc123', 'Claim page'], ['/listings/l_bike', 'Ghost bike'], ['/meetup/o_fridge', 'Meetup'], ['/handoff/o_fridge', 'Handoff QR'], ['/post', 'Screenshot → listing'], ['/offers/t_fridge', 'Haggle (web)'], ['/feed?view=foryou', 'For you'], ['/listings/l_owala', 'Owala'], ['/history', 'History']].map(([h, l]) => (
          <Link key={h} href={h} className="rounded-full border-2 border-ink bg-card px-3 py-1.5 hover:bg-butter hover:text-dark-ink">{l}</Link>
        ))}
      </div>
    </div>
  );
}
