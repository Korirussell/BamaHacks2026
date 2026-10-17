// Local-AI endpoints (docs/API_CONTRACT.md: haggle, listing-review, ai/status). JEV-9B and Gemma 4 run on
// the laptop worker; the API falls back to rules when it's offline, and `engine` says which answered.
import { USE_MOCKS, delay } from './api';
import { request } from './real';

export type Decision = { pick: string; value: number; probabilities: Record<string, number> };
export type HaggleAction = 'accept' | 'counter' | 'hold_firm' | 'reply' | 'warn' | 'ignore';
export type HaggleRes = {
  intent: string; amount_cents: number | null; action: HaggleAction; price_cents: number | null; reply: string;
  scam_flags: string[]; reported: boolean; seriousness: number; engine: 'jev' | 'rules';
  decisions?: Record<string, Decision>; proposed_offer: { id: string; amount_cents: number } | null;
};
export type HaggleTurn = { from: 'buyer' | 'seller'; text: string };
export type ReviewRes = { allowed: boolean; blocked_reasons: string[]; warnings: string[]; suggested_category: string | null; engine: 'jev' | 'none' };
export type AiStatus = { online: boolean; kinds: string[]; models: Record<string, string>; last_seen_at: string | null };

const API = (process.env.NEXT_PUBLIC_API_BASE ?? '') + '/api/v1';

/** Mock-mode stand-in so the demo flow works without the API. */
function mockHaggle(message: string, ask: number, last: number | null): HaggleRes {
  const m = message.match(/\$?\s?(\d{1,5})/);
  const amount = m ? Number(m[1]) * 100 : null;
  const scam = /zelle|cash ?app|venmo|gift ?card|ship (it )?to/i.test(message) ? ['off_platform_payment'] : [];
  const standing = last ?? ask;
  const floor = Math.round(ask * 0.75);
  const base = { intent: amount ? 'offer' : 'question', amount_cents: amount, scam_flags: scam, reported: false, seriousness: 3, engine: 'rules' as const, proposed_offer: null };
  if (scam.length) return { ...base, action: 'warn', price_cents: null, reply: "Heads up: let's keep payment and the meetup inside the app." };
  if (amount === null) return { ...base, action: 'reply', price_cents: null, reply: "Good question, I'll get the seller to answer that." };
  if (amount >= floor) return { ...base, action: 'accept', price_cents: Math.min(amount, standing), reply: `Deal at $${Math.min(amount, standing) / 100}! Sending you the offer to confirm.` };
  const counter = Math.max(floor, Math.ceil((standing - (standing - floor) * 0.5) / 100) * 100);
  return { ...base, action: 'counter', price_cents: counter, reply: `Can't go that low, but I could do $${counter / 100}.` };
}

export async function haggle(listingId: string, body: { message: string; history: HaggleTurn[]; last_counter_cents: number | null }, askCents: number): Promise<HaggleRes> {
  if (USE_MOCKS) { await delay(700); return mockHaggle(body.message, askCents, body.last_counter_cents); }
  return (await request<HaggleRes>(`/listings/${listingId}/haggle`, { method: 'POST', body: { ...body, place_offer: true } })).data;
}

export async function reviewListing(body: { title: string; description: string; category: string; price_cents: number }): Promise<ReviewRes> {
  if (USE_MOCKS) { await delay(400); return { allowed: true, blocked_reasons: [], warnings: [], suggested_category: null, engine: 'none' }; }
  return (await request<ReviewRes>('/ai/listing-review', { method: 'POST', body })).data;
}

/** Public: whether the laptop worker is online and which models it runs. */
export async function aiStatus(): Promise<AiStatus | null> {
  if (USE_MOCKS) return null;
  try {
    const r = await fetch(`${API}/ai/status`, { headers: { 'ngrok-skip-browser-warning': '1' } });
    return r.ok ? (await r.json()).data : null;
  } catch { return null; }
}
