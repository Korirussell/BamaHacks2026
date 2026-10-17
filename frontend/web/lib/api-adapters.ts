import type { Listing, Notification, Order } from './types';

export type ApiUser = { id: string; display_name: string; avatar_url?: string | null; major?: string | null; grad_year?: number | null };
export type ApiListing = {
  id: string; title: string; description: string; category: string; price_cents: number; negotiable: boolean; condition: Listing['condition'];
  status: string; seller: ApiUser | null; external_seller?: { channel: string; handle: string; profile_url?: string | null } | null;
  media: { url: string }[]; source: { channel: string; external_url?: string | null; claimed: boolean }; created_at: string;
};
export type ApiFeedItem = { type: string; item: ApiListing; reason?: string | null };
export type ApiOrder = { id: string; listing: ApiListing; amount_cents: number; fee_cents: number; status: Order['status'] };
export type ApiNotification = { id: string; title: string; body: string; deep_link: string; read_at: string | null; created_at: string };

const emojiFor = (listing: ApiListing) => {
  const title = listing.title.toLowerCase();
  if (listing.category === 'textbook') return '📚';
  if (listing.category === 'ticket') return '🎟️';
  if (listing.category === 'lab_supplies') return '🧪';
  if (/bike/.test(title)) return '🚲';
  if (/lamp/.test(title)) return '💡';
  if (/bottle|owala|hydro/.test(title)) return '🥤';
  return '📦';
};
const tileFor = (listing: ApiListing): Listing['tile'] => listing.category === 'ticket' ? 'butter' : listing.category === 'textbook' || listing.category === 'lab_supplies' ? 'mint' : 'peach';
const categoryFor = (category: string): Listing['category'] => (['textbook', 'lab_supplies', 'dorm', 'ticket'].includes(category) ? category : 'other') as Listing['category'];
const sourceFor = (listing: ApiListing): Listing['source'] => ({ channel: listing.source.channel === 'instagram' ? 'instagram' : listing.source.channel === 'screenshot' ? 'screenshot' : 'native', author_handle: listing.external_seller?.handle, post_url: listing.source.external_url ?? undefined, claimed: listing.source.claimed });

export const adaptListing = (listing: ApiListing, reason?: string | null): Listing => ({
  id: listing.id, title: listing.title, description: listing.description, category: categoryFor(listing.category), price_cents: listing.price_cents,
  negotiable: listing.negotiable, condition: listing.condition, emoji: emojiFor(listing), tile: tileFor(listing), images: listing.media.map((media) => media.url),
  status: listing.status === 'sold' ? 'sold' : listing.status === 'pending' ? 'pending' : listing.seller ? 'active' : 'ghost', seller_id: listing.seller?.id ?? null,
  source: sourceFor(listing), reason: reason === 'your_class' || reason === 'wishlist_match' || reason === 'friend' || reason === 'nearby' || reason === 'new' ? reason : 'new', created_at: listing.created_at,
});
export const adaptFeed = (feed: ApiFeedItem[]) => feed.filter((item) => item.type === 'listing').map((item) => adaptListing(item.item, item.reason));
export const adaptOrder = (order: ApiOrder): Order => ({ id: order.id, listing_id: order.listing.id, amount_cents: order.amount_cents, fee_cents: order.fee_cents, total_cents: order.amount_cents + order.fee_cents, status: order.status });
export const adaptNotification = (notification: ApiNotification): Notification => ({ id: notification.id, title: notification.title, body: notification.body, deep_link: notification.deep_link, ago: new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.round((new Date(notification.created_at).getTime() - Date.now()) / 3_600_000), 'hour'), read: notification.read_at !== null });
