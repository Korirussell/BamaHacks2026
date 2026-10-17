import { GraphApiError, type InstagramGraph } from "../adapters/instagram.js";
import { dmWindow, type DmWindow } from "./instagram.js";

// Stories mode's DMs from our account to the seller. Meta only lets us message the seller within
// 24 h of the seller's last message to us, and there's no public webhook here, so we read the
// window off our own conversation with them (Conversations API). We never send anything to keep
// the window open: a person opens it by DMing us, and when it's closed we refuse to send.

/** How many messages we look up one by one (Instagram only gives details for the 20 most recent). */
const MAX_MESSAGE_LOOKUPS = 20;
/** Without a known IGSID, how many conversations we check for the seller. */
const MAX_CONVERSATIONS = 10;
// Meta's "outside the allowed window" errors on the Messenger Platform. Unverified for Instagram Login.
const WINDOW_ERROR_CODES = new Set([10, 551]);

export interface DmWindowState extends DmWindow {
  /** The seller's Instagram-scoped id as our account sees it (cached once found). */
  seller_igsid: string | null;
  checked_at: string | null;
  last_error: string | null;
}

export class DmWindowClosedError extends Error {}

export interface SellerDms {
  /** The last known window, with `open` re-worked out against the clock. */
  window(): DmWindowState;
  /** Re-reads our conversation with the seller. Never throws; failures land in `last_error`. */
  refresh(): Promise<DmWindowState>;
  /** DMs the seller, or throws DmWindowClosedError when the window is closed. */
  send(text: string): Promise<{ message_id: string }>;
  /** Why a send would be refused, for events and 409s. */
  closedReason(): Promise<string>;
}

export function sellerDms(deps: {
  platform: InstagramGraph;
  sellerUsername: () => Promise<string>;
  sellerIgsid?: string | undefined;
  now?: () => number;
}): SellerDms {
  const now = deps.now ?? Date.now;
  let state: DmWindowState = { ...dmWindow(null), seller_igsid: deps.sellerIgsid ?? null, checked_at: null, last_error: null };

  const window = (): DmWindowState => ({ ...state, ...dmWindow(state.last_inbound_at, now()) });

  /** Newest inbound message from the seller, learning their IGSID on the way if we don't have it. */
  async function lastInbound(): Promise<{ igsid: string | null; at: string | null }> {
    const me = await deps.platform.me();
    const seller = (await deps.sellerUsername()).replace(/^@+/, "").toLowerCase();
    const ours = (p: { id: string; username?: string | undefined }) => p.id === me.id || p.username?.toLowerCase() === me.username.toLowerCase();
    let igsid = state.seller_igsid;
    const conversations = igsid ? (await deps.platform.conversations(igsid)).slice(0, 1) : (await deps.platform.conversations()).slice(0, MAX_CONVERSATIONS);
    let lookups = 0;
    for (const conversation of conversations) {
      const known = igsid !== null; // filtered by user_id, so this is the seller's conversation
      const messages = (await deps.platform.messages(conversation.id))
        .sort((a, b) => (b.created_time ? Date.parse(b.created_time) : 0) - (a.created_time ? Date.parse(a.created_time) : 0));
      for (const m of messages) {
        if (lookups++ >= MAX_MESSAGE_LOOKUPS) return { igsid, at: null };
        const detail = await deps.platform.message(m.id);
        if (!ours(detail.from)) {
          if (!known && detail.from.username?.toLowerCase() !== seller) break; // someone else's conversation
          return { igsid: igsid ?? detail.from.id, at: detail.created_time ?? m.created_time };
        }
        if (!known) {
          const to = detail.to.find((p) => p.username?.toLowerCase() === seller);
          if (!to) break;
          igsid = to.id; // our message to the seller: right conversation, keep looking for theirs
        }
      }
      if (igsid && !known) return { igsid, at: null };
    }
    return { igsid, at: null };
  }

  async function refresh(): Promise<DmWindowState> {
    try {
      const found = await lastInbound();
      state = { ...dmWindow(found.at, now()), seller_igsid: found.igsid, checked_at: new Date(now()).toISOString(), last_error: null };
    } catch (err) {
      state = { ...state, checked_at: new Date(now()).toISOString(), last_error: err instanceof Error ? err.message : String(err) };
    }
    return window();
  }

  async function closedReason() {
    const seller = `@${(await deps.sellerUsername().catch(() => "the seller")).replace(/^@+/, "")}`;
    const w = window();
    const ask = `Ask ${seller} to DM us first`;
    if (w.last_error) return `Couldn't check the DM window (${w.last_error}). ${ask}`;
    if (!w.seller_igsid) return `No DM conversation with ${seller} yet. ${ask}`;
    if (w.expires_at) return `The 24-hour DM window closed at ${w.expires_at}. ${ask}`;
    return `${seller} hasn't DMed us. ${ask}`;
  }

  return {
    window,
    refresh,
    closedReason,
    async send(text) {
      let w = window();
      if (!w.open || !w.seller_igsid) w = await refresh(); // they may have just written
      if (!w.open || !w.seller_igsid) throw new DmWindowClosedError(await closedReason());
      try {
        return await deps.platform.sendMessage(w.seller_igsid, text);
      } catch (err) {
        if (err instanceof GraphApiError && err.code !== null && WINDOW_ERROR_CODES.has(err.code)) {
          state = { ...state, ...dmWindow(null), last_error: err.message };
          throw new DmWindowClosedError(await closedReason());
        }
        throw err;
      }
    },
  };
}
