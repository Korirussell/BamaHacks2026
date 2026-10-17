// Mock/real switch (frontend-build.md §10.1). UI reads live demo state from lib/store;
// these typed functions are the seam for swapping endpoints in one at a time.
import { bids, claim, listings, meetups, notifications, screenshotResult } from './data';

export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS !== 'false';
const BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';
export const delay = (ms = 300 + Math.random() * 500) => new Promise(r => setTimeout(r, ms));
async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

export async function getFeed() { if (USE_MOCKS) { await delay(); return listings; } return get('/feed'); }
export async function getListing(id: string) { if (USE_MOCKS) { await delay(); return listings.find(l => l.id === id); } return get(`/listings/${id}`); }
export async function getBids(id: string) { if (USE_MOCKS) { await delay(); return bids.filter(b => b.listing_id === id); } return get(`/listings/${id}/interests`); }
export async function getClaim(token: string) { if (USE_MOCKS) { await delay(); return token === claim.token ? claim : null; } return get(`/claim/${token}`); }
export async function getMeetups(orderId: string) { if (USE_MOCKS) { await delay(); return meetups; } return get(`/orders/${orderId}/meetup-suggestions`); }
export async function getNotifications() { if (USE_MOCKS) { await delay(); return notifications; } return get('/notifications'); }
export async function runScreenshotJob() { await delay(2400); return screenshotResult; }
