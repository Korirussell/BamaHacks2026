// Real-mode API client (NEXT_PUBLIC_USE_MOCKS=false). Talks to `${NEXT_PUBLIC_API_BASE}/api/v1`
// with the Supabase access token, and adapts contract shapes (docs/API_CONTRACT.md) to the web types.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Listing, UserPublic } from './types';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public fieldErrors?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
  }
}

let sb: SupabaseClient | null = null;
/** Lazy so mock-mode builds never need the Supabase env vars. */
export function supabase() {
  if (!sb) sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '');
  return sb;
}

const API = (process.env.NEXT_PUBLIC_API_BASE ?? '') + '/api/v1';

export async function request<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<{ data: T; next_cursor?: string }> {
  const { data: { session } } = await supabase().auth.getSession();
  if (!session) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  let r: Response;
  try {
    r = await fetch(API + path, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${session.access_token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError('NETWORK', "Couldn't reach the server.", 0);
  }
  const json = await r.json().catch(() => null);
  if (!r.ok) {
    const e = json?.error;
    throw new ApiError(e?.code ?? 'INTERNAL', e?.message ?? `Request failed (${r.status})`, r.status, e?.field_errors);
  }
  return json;
}

// ---- Contract types (only the fields the web reads) ----
type CUser = { id: string; display_name: string; avatar_url?: string | null; major?: string | null; grad_year?: number | null; school: { id: string }; reliability: UserPublic['reliability']; mutual_friend_count: number };
type CListing = {
  id: string; seller: CUser | null; external_seller?: { channel: string; handle: string; profile_url?: string | null } | null;
  category: string; title: string; description: string; price_cents: number; negotiable: boolean; condition: Listing['condition'];
  media: { url: string; kind: string }[]; status: string; source: { channel: string; external_url?: string | null; claimed: boolean }; created_at: string;
};
export type COrder = {
  id: string; listing: CListing; buyer: CUser; seller: CUser; amount_cents: number; fee_cents: number;
  status: string; payment: { status: 'requires_payment' | 'succeeded' | 'failed' | 'refunded'; paid_at?: string | null }; created_at: string;
};
export type PayResult = { client_secret: string | null; payment_intent_id: string; demo?: boolean; order?: COrder };

// ---- Adapters ----
const LOOK: Record<string, { emoji: string; tile: Listing['tile'] }> = {
  textbook: { emoji: '📚', tile: 'butter' },
  lab_supplies: { emoji: '🧪', tile: 'mint' },
  dorm: { emoji: '🛋️', tile: 'peach' },
  ticket: { emoji: '🎟️', tile: 'butter' },
  other: { emoji: '📦', tile: 'mint' },
};

export const toUser = (u: CUser): UserPublic => ({
  id: u.id, display_name: u.display_name, avatar_emoji: '🎓', major: u.major ?? undefined, grad_year: u.grad_year ?? undefined,
  school_id: u.school?.id, reliability: u.reliability, mutual_friend_count: u.mutual_friend_count ?? 0,
});

export function toListing(l: CListing, reason?: Listing['reason']): Listing {
  const look = LOOK[l.category] ?? LOOK.other;
  const channel = (['native', 'screenshot', 'instagram'] as const).find(c => c === l.source.channel) ?? 'instagram';
  return {
    id: l.id, title: l.title, description: l.description,
    category: (l.category in LOOK ? l.category : 'other') as Listing['category'],
    price_cents: l.price_cents, negotiable: l.negotiable, condition: l.condition, emoji: look.emoji, tile: look.tile,
    images: l.media.filter(m => m.kind === 'image').map(m => m.url),
    // The web's "ghost" is a demo-only state; real unclaimed listings render as normal active ones.
    status: l.status === 'pending' ? 'pending' : l.status === 'sold' || l.status === 'removed' ? 'sold' : 'active',
    seller_id: l.seller?.id ?? null,
    source: { channel, author_handle: l.external_seller?.handle, post_url: l.source.external_url ?? undefined, claimed: l.source.claimed },
    reason, created_at: l.created_at,
  };
}

// ---- Endpoints ----
export async function realFeed(): Promise<Listing[]> {
  const { data } = await request<{ type: string; item: CListing; reason?: Listing['reason'] }[]>('/feed');
  return data.filter(f => f.type === 'listing').map(f => toListing(f.item, f.reason));
}

export type RealListing = { listing: Listing; seller: UserPublic | null; isMine: boolean };
export async function realListing(id: string): Promise<RealListing> {
  const { data } = await request<{ listing: CListing; is_mine: boolean }>(`/listings/${id}`);
  return { listing: toListing(data.listing), seller: data.listing.seller ? toUser(data.listing.seller) : null, isMine: data.is_mine };
}

export async function realOffer(listingId: string, amount_cents: number) {
  const { data } = await request<{ offer: { id: string }; order?: COrder }>(`/listings/${listingId}/offers`, {
    method: 'POST', body: { kind: 'cash', amount_cents, trade_listing_ids: [], fulfillment: 'in_person' },
  });
  return data;
}

export const realOrder = async (id: string) => (await request<COrder>(`/orders/${id}`)).data;
export const realPay = async (id: string, idempotencyKey: string) =>
  (await request<PayResult>(`/orders/${id}/pay`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } })).data;
