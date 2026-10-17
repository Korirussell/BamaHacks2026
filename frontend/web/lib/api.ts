import { bids, claim, listings, meetups, notifications, screenshotResult } from './data';
import { adaptFeed, adaptListing, adaptNotification, adaptOrder, type ApiFeedItem, type ApiListing, type ApiNotification, type ApiOrder } from './api-adapters';
import type { Listing, Notification, Order } from './types';

export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS !== 'false';
const BASE = (process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8788/api/v1').replace(/\/$/, '');
const SESSION_KEY = 'handoff-demo-session';
export const delay = (ms = 300 + Math.random() * 500) => new Promise((resolve) => setTimeout(resolve, ms));

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly fieldErrors?: Record<string, string>) { super(message); }
}
export type IngestionPost = { id: string; channel: string; author_handle: string; caption: string; status: string; listing: { id: string; title: string; price_cents: number; status: string } | null };
type Session = { access_token: string; refresh_token: string; expires_at: number; user_id: string; email: string };
type Envelope<T> = { data: T };
type ErrorEnvelope = { error: { code: string; message: string; field_errors?: Record<string, string> } };
let session: Session | null = null;
const storedSession = (): Session | null => {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(window.localStorage.getItem(SESSION_KEY) ?? 'null') as Session | null; } catch { return null; }
};
const saveSession = (next: Session | null) => {
  session = next;
  if (typeof window === 'undefined') return;
  if (next) window.localStorage.setItem(SESSION_KEY, JSON.stringify(next)); else window.localStorage.removeItem(SESSION_KEY);
};
async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  let active = session ?? storedSession();
  if (auth && active && active.expires_at <= Math.floor(Date.now() / 1000) + 30) {
    await demoLogin(active.email);
    active = session ?? storedSession();
  }
  const headers = new Headers(init.headers);
  headers.set('ngrok-skip-browser-warning', '1');
  headers.set('accept', 'application/json');
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (auth && active) headers.set('authorization', `Bearer ${active.access_token}`);
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const body = await response.json().catch((): ErrorEnvelope | Envelope<T> | null => null);
  if (!response.ok) {
    const error = body && 'error' in body ? body.error : { code: 'HTTP_ERROR', message: `Request failed (${response.status})` };
    throw new ApiError(response.status, error.code, error.message, error.field_errors);
  }
  if (!body || !('data' in body)) throw new ApiError(response.status, 'INVALID_RESPONSE', 'The API returned no data envelope');
  return body.data;
}
export async function demoLogin(email: string): Promise<void> {
  const next = await request<Omit<Session, 'email'>>('/dev/login', { method: 'POST', body: JSON.stringify({ email }) }, false);
  saveSession({ ...next, email });
}
export const demoSession = () => session ?? storedSession();
export const demoLogout = () => saveSession(null);
export async function getFeed(): Promise<Listing[]> { if (USE_MOCKS) { await delay(); return listings; } return adaptFeed(await request<ApiFeedItem[]>('/feed')); }
export async function getListing(id: string): Promise<Listing | undefined> { if (USE_MOCKS) { await delay(); return listings.find((listing) => listing.id === id); } const data = await request<{ listing: ApiListing }>(`/listings/${id}`); return adaptListing(data.listing); }
export async function getBids(id: string) { if (USE_MOCKS) { await delay(); return bids.filter((bid) => bid.listing_id === id); } return []; }
export async function getClaim(token: string) { if (USE_MOCKS) { await delay(); return token === claim.token ? claim : null; } return request<unknown>(`/claims/${token}`); }
export async function getMeetups(orderId: string) { if (USE_MOCKS) { await delay(); return meetups; } return request<unknown>(`/orders/${orderId}/meetup-suggestions`); }
export async function getNotifications(): Promise<Notification[]> { if (USE_MOCKS) { await delay(); return notifications; } return (await request<ApiNotification[]>('/me/notifications')).map(adaptNotification); }
export async function makeOffer(listingId: string, amountCents: number, message: string) {
  const data = await request<{ offer: { id: string }; order: ApiOrder | null }>(`/listings/${listingId}/offers`, { method: 'POST', body: JSON.stringify({ kind: 'cash', amount_cents: amountCents, trade_listing_ids: [], fulfillment: 'in_person', message: message || undefined }) });
  return { offerId: data.offer.id, order: data.order ? adaptOrder(data.order) : null };
}
export async function acceptOffer(offerId: string): Promise<Order> { const data = await request<{ order: ApiOrder }>(`/offers/${offerId}/accept`, { method: 'POST' }); return adaptOrder(data.order); }
export async function payOrder(orderId: string): Promise<void> { await request<{ client_secret?: string }>(`/orders/${orderId}/pay`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } }); }
export async function getAdminIngestionFeed(): Promise<IngestionPost[]> { return request<IngestionPost[]>('/admin/ingestion/feed'); }
export async function runScreenshotJob() { await delay(2400); return screenshotResult; }
