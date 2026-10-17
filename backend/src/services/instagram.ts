import type { ExternalPost } from "../adapters/ports.js";

// Pure pieces of the Instagram pipeline: which tagged posts are new, what they become, and the
// public replies we leave on them. Instagram's rules: we only read posts that tag our business
// account, and we only answer in public (a business can't DM someone who hasn't written first).
// Stories mode reads the seller account's own stories and DMs the seller, but only inside the
// 24 h window the seller opened by messaging us first.

/** A post that tagged our account, as the Graph API returns it. */
export interface TaggedMedia {
  id: string;
  caption: string;
  permalink: string;
  username: string;
  timestamp: string;
  imageUrls: string[];
}

/** One step of an ingest, for the admin "live sources" feed. */
export interface PipelineEvent {
  at: string;
  step: "detected" | "photos_saved" | "identified" | "matched_courses" | "listed" | "notified" | "replied" | "reply_failed" | "failed"
    | "dm_sent" | "dm_failed" | "dm_window_closed";
  text: string;
}

export const pipelineEvent = (step: PipelineEvent["step"], text: string, at = new Date()): PipelineEvent => ({ at: at.toISOString(), step, text });

/** Tagged posts we haven't ingested yet, oldest first so the feed fills in order. */
export function unseenMedia(tagged: TaggedMedia[], seenUrls: ReadonlySet<string>): TaggedMedia[] {
  return tagged.filter((m) => m.permalink && !seenUrls.has(m.permalink)).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export function toExternalPost(m: TaggedMedia): ExternalPost {
  return { channel: "instagram", externalUrl: m.permalink, authorHandle: m.username, caption: m.caption, imageUrls: m.imageUrls, postedAt: new Date(m.timestamp).toISOString() };
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;

/** The public reply right after we list someone's post. */
export function listedReply(input: { handle: string; title: string; priceCents: number; courseCodes: string[]; notified: number; appName: string }): string {
  const classes = input.courseCodes.length ? ` for ${input.courseCodes.slice(0, 3).join(" / ")}` : "";
  const people = input.notified === 1 ? "1 student" : `${input.notified} students`;
  const told = input.notified > 0 ? ` ${people} who need it${classes} just got a heads-up.` : "";
  return `@${input.handle} We listed your ${input.title} (${dollars(input.priceCents)}) on ${input.appName}.${told} We'll reply here when someone makes an offer.`;
}

/** The public reply when the first offer comes in; it carries the claim link. */
export function offerReply(input: { handle: string; offerCents: number | null; courseCode: string | null; url: string }): string {
  const offer = input.offerCents !== null ? ` offered ${dollars(input.offerCents)}` : " wants it";
  const who = input.courseCode ? `A ${input.courseCode} student` : "A UA student";
  return `@${input.handle} ${who}${offer}! Claim your listing with your UA email to accept and get paid: ${input.url}`;
}

/** The same text as a DM: no leading @handle, since it goes straight to the seller. */
export const asDm = (reply: string) => reply.replace(/^@\S+\s+/, "");

/** Meta lets a business message someone only within 24 hours of that person's last message to it. */
export const DM_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface DmWindow {
  open: boolean;
  last_inbound_at: string | null;
  expires_at: string | null;
}

/** Open while the seller's last message to us is under 24 h old. Our own messages don't extend it. */
export function dmWindow(lastInboundAt: string | null, now = Date.now()): DmWindow {
  const at = lastInboundAt ? Date.parse(lastInboundAt) : NaN;
  if (!Number.isFinite(at)) return { open: false, last_inbound_at: null, expires_at: null };
  const expires = at + DM_WINDOW_MS;
  return { open: now < expires, last_inbound_at: new Date(at).toISOString(), expires_at: new Date(expires).toISOString() };
}
