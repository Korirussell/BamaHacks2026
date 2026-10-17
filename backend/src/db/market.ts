import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { adminClient, publicMediaUrl } from "../lib/supabase.js";
import { Listing } from "../schemas/listings.js";
import { Offer } from "../schemas/offers.js";
import { Order, Shipment } from "../schemas/orders.js";
import { CourseRow, OpeningHoursRow, toCourse } from "./academics.js";
import { loadUsersPublic, type UserPublicOut } from "./users.js";

const ts = z.string().transform((v) => new Date(v).toISOString());
const tsNull = ts.nullable();
const Channel = z.enum(["instagram", "groupme", "facebook", "snapchat"]);
const Fulfillment = z.enum(["in_person", "campus_mail", "digital_transfer"]);

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

// ---------------------------------------------------------------- listings

export const ListingRow = z.object({
  id: z.guid(), school_id: z.guid(), seller_id: z.guid().nullable(),
  external_channel: Channel.nullable(), external_handle: z.string().nullable(), external_profile_url: z.string().nullable(),
  category: z.enum(["textbook", "lab_supplies", "dorm", "ticket", "other"]),
  title: z.string(), description: z.string(), price_cents: z.number().int(), negotiable: z.boolean(),
  floor_price_cents: z.number().int().nullable(), condition: z.enum(["new", "like_new", "good", "fair", "poor"]),
  isbn: z.string().nullable(), textbook_title: z.string().nullable(), authors: z.array(z.string()), edition: z.string().nullable(),
  fulfillment: z.array(Fulfillment), status: z.enum(["draft", "active", "pending", "sold", "removed"]),
  source_channel: z.enum(["native", "screenshot", "instagram", "groupme", "facebook", "snapchat"]),
  external_url: z.string().nullable(), ingested_post_id: z.guid().nullable(), claimed: z.boolean(), created_at: ts,
  listing_courses: z.array(z.object({ course: CourseRow })),
  listing_media: z.array(z.object({
    position: z.number().int(),
    media: z.object({
      id: z.guid(), bucket: z.string(), path: z.string(), kind: z.enum(["image", "pdf", "ics"]),
      width: z.number().int().nullable(), height: z.number().int().nullable(), uploaded: z.boolean(),
    }),
  })),
});
export type ListingRow = z.infer<typeof ListingRow>;

export const LISTING_SELECT =
  "*, listing_courses(course:courses(*)), listing_media(position, media:media(id, bucket, path, kind, width, height, uploaded))";

/** What the viewer is enrolled in (current or planned), for `course_match` and the feed's `your_class`. */
export interface Viewer {
  id: string;
  courses: Map<string, CourseRow>;
}

export async function loadViewer(userId: string, schoolId: string): Promise<Viewer> {
  const data = check(
    await adminClient().from("class_records").select("course:courses(*)")
      .eq("school_id", schoolId).eq("user_id", userId).in("status", ["current", "planned"]),
  );
  const rows = z.array(z.object({ course: CourseRow })).parse(data);
  return { id: userId, courses: new Map(rows.map((r) => [r.course.id, r.course])) };
}

/** The first of the listing's courses the viewer is taking, if any. */
export function courseMatch(row: ListingRow, viewer: Viewer | null): CourseRow | null {
  if (!viewer || row.seller_id === viewer.id) return null;
  return row.listing_courses.map((lc) => lc.course).find((c) => viewer.courses.has(c.id)) ?? null;
}

export function toListing(row: ListingRow, users: Map<string, UserPublicOut>, viewer: Viewer | null) {
  const courses = row.listing_courses.map((lc) => lc.course).sort((a, b) => a.code.localeCompare(b.code));
  const media = row.listing_media
    .filter((lm) => lm.media.uploaded && lm.media.bucket === "public-media" && lm.media.kind === "image")
    .sort((a, b) => a.position - b.position)
    .map(({ media: m }) => ({ id: m.id, url: publicMediaUrl(m.bucket, m.path), kind: "image" as const, width: m.width, height: m.height }));
  const match = courseMatch(row, viewer);
  return Listing.parse({
    id: row.id,
    seller: row.seller_id ? users.get(row.seller_id) ?? null : null,
    external_seller: row.external_channel && row.external_handle
      ? { channel: row.external_channel, handle: row.external_handle, profile_url: row.external_profile_url }
      : null,
    category: row.category,
    title: row.title,
    description: row.description,
    price_cents: row.price_cents,
    negotiable: row.negotiable,
    // Only the seller sees their floor (auto-bargain negotiates against it).
    floor_price_cents: viewer && row.seller_id === viewer.id ? row.floor_price_cents : null,
    condition: row.condition,
    media,
    textbook: row.category === "textbook" && row.isbn
      ? { isbn: row.isbn, title: row.textbook_title ?? row.title, authors: row.authors, edition: row.edition, courses: courses.map(toCourse) }
      : null,
    ticket: null,
    fulfillment: row.fulfillment,
    status: row.status,
    source: { channel: row.source_channel, external_url: row.external_url, claimed: row.claimed },
    course_match: match ? toCourse(match) : null,
    created_at: row.created_at,
  });
}

export async function loadListingRows(ids: string[], schoolId: string): Promise<Map<string, ListingRow>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const data = check(await adminClient().from("listings").select(LISTING_SELECT).eq("school_id", schoolId).in("id", unique));
  return new Map(z.array(ListingRow).parse(data).map((l) => [l.id, l]));
}

export async function loadListingRow(id: string, schoolId: string): Promise<ListingRow> {
  const row = (await loadListingRows([id], schoolId)).get(id);
  if (!row) throw new ApiError(404, "NOT_FOUND", "Listing not found");
  return row;
}

/** Listing objects in the given order, with sellers joined. */
export async function listingsOut(rows: ListingRow[], schoolId: string, viewer: Viewer | null) {
  const users = await loadUsersPublic(rows.flatMap((r) => (r.seller_id ? [r.seller_id] : [])), schoolId);
  return rows.map((r) => toListing(r, users, viewer));
}

// ---------------------------------------------------------------- offers

export const OfferRow = z.object({
  id: z.guid(), school_id: z.guid(), listing_id: z.guid(), buyer_id: z.guid(), seller_id: z.guid().nullable(),
  kind: z.enum(["cash", "trade", "cash_plus_trade"]), amount_cents: z.number().int(), trade_listing_ids: z.array(z.guid()),
  fulfillment: Fulfillment, message: z.string().nullable(), counter_of: z.guid().nullable(), auto_generated: z.boolean(),
  made_by: z.enum(["buyer", "seller"]), status: z.enum(["pending", "countered", "accepted", "declined", "withdrawn", "expired"]),
  waiting_on: z.enum(["buyer", "seller", "seller_claim"]).nullable(), seller_notified_at: tsNull, expires_at: ts, updated_at: z.string(),
});
export type OfferRow = z.infer<typeof OfferRow>;

export function toOffer(row: OfferRow, users: Map<string, UserPublicOut>) {
  const buyer = users.get(row.buyer_id);
  if (!buyer) throw new Error(`Offer ${row.id} references a missing buyer`);
  return Offer.parse({
    id: row.id, listing_id: row.listing_id, buyer, seller: row.seller_id ? users.get(row.seller_id) ?? null : null,
    kind: row.kind, amount_cents: row.amount_cents, trade_listing_ids: row.trade_listing_ids, fulfillment: row.fulfillment,
    message: row.message, counter_of: row.counter_of, auto_generated: row.auto_generated, made_by: row.made_by,
    status: row.status, waiting_on: row.waiting_on, seller_notified_at: row.seller_notified_at, expires_at: row.expires_at,
  });
}

export async function offersOut(rows: OfferRow[], schoolId: string) {
  const users = await loadUsersPublic(rows.flatMap((r) => [r.buyer_id, ...(r.seller_id ? [r.seller_id] : [])]), schoolId);
  return rows.map((r) => toOffer(r, users));
}

export async function loadOfferRow(id: string, schoolId: string): Promise<OfferRow> {
  const data = check(await adminClient().from("offers").select("*").eq("school_id", schoolId).eq("id", id).maybeSingle());
  if (!data) throw new ApiError(404, "NOT_FOUND", "Offer not found");
  return OfferRow.parse(data);
}

// ---------------------------------------------------------------- orders

export const OrderRow = z.object({
  id: z.guid(), school_id: z.guid(), listing_id: z.guid(), buyer_id: z.guid(), seller_id: z.guid(), offer_id: z.guid().nullable(),
  amount_cents: z.number().int(), fee_cents: z.number().int(), seller_payout_cents: z.number().int(), fulfillment: Fulfillment,
  status: z.enum(["awaiting_payment", "paid", "scheduled", "handing_off", "in_transit", "completed", "cancelled", "disputed", "refunded"]),
  payment_status: z.enum(["requires_payment", "succeeded", "failed", "refunded"]), payment_intent_id: z.string().nullable(), paid_at: tsNull,
  payout_status: z.enum(["held", "awaiting_onboarding", "released", "reversed"]), released_at: tsNull,
  handoff_id: z.guid().nullable(), cancel_reason: z.string().nullable(), created_at: ts, updated_at: z.string(),
});
export type OrderRow = z.infer<typeof OrderRow>;

const DropOffRow = z.object({
  id: z.guid(), name: z.string(), lat: z.number(), lng: z.number(), radius_m: z.number().int(), hours: z.array(OpeningHoursRow), instructions: z.string(),
});
const ShipmentRow = z.object({
  id: z.guid(), order_id: z.guid(), label_code: z.string(), label_media_id: z.guid().nullable(), to_name: z.string(), to_mail_stop_code: z.string(),
  status: z.enum(["label_created", "dropped_off", "received"]), dropped_off_at: tsNull, drop_off_proof_media_id: z.guid().nullable(),
  received_at: tsNull, auto_complete_at: tsNull, drop_off: DropOffRow,
});
type ShipmentRow = z.infer<typeof ShipmentRow>;

const toShipment = (s: ShipmentRow) => Shipment.parse({
  id: s.id, order_id: s.order_id, label_pdf_url: `about:blank#label-${s.label_code}`, label_code: s.label_code,
  to: { name: s.to_name, mail_stop_code: s.to_mail_stop_code },
  drop_off: {
    id: s.drop_off.id, name: s.drop_off.name, location: { lat: s.drop_off.lat, lng: s.drop_off.lng },
    radius_m: s.drop_off.radius_m, hours: s.drop_off.hours, instructions: s.drop_off.instructions,
  },
  status: s.status, dropped_off_at: s.dropped_off_at, drop_off_proof_media_id: s.drop_off_proof_media_id,
  received_at: s.received_at, auto_complete_at: s.auto_complete_at,
});

export async function loadOrderRow(id: string, userId: string, schoolId: string): Promise<OrderRow> {
  const data = check(await adminClient().from("orders").select("*").eq("school_id", schoolId).eq("id", id).maybeSingle());
  const row = data ? OrderRow.parse(data) : null;
  if (!row || (row.buyer_id !== userId && row.seller_id !== userId)) throw new ApiError(404, "NOT_FOUND", "Order not found");
  return row;
}

/** Order objects with listing, both parties and shipment joined. */
export async function ordersOut(rows: OrderRow[], schoolId: string, viewer: Viewer | null) {
  if (!rows.length) return [];
  const [listings, users, shipments] = await Promise.all([
    loadListingRows(rows.map((r) => r.listing_id), schoolId),
    loadUsersPublic(rows.flatMap((r) => [r.buyer_id, r.seller_id]), schoolId),
    adminClient().from("shipments").select("*, drop_off:drop_off_points(*)").in("order_id", rows.map((r) => r.id)),
  ]);
  const byOrder = new Map(z.array(ShipmentRow).parse(check(shipments)).map((s) => [s.order_id, s]));
  return rows.map((r) => {
    const listing = listings.get(r.listing_id);
    const buyer = users.get(r.buyer_id);
    const seller = users.get(r.seller_id);
    if (!listing || !buyer || !seller) throw new Error(`Order ${r.id} references missing rows`);
    const shipment = byOrder.get(r.id);
    return Order.parse({
      id: r.id, listing: toListing(listing, users, viewer), buyer, seller, offer_id: r.offer_id,
      amount_cents: r.amount_cents, fee_cents: r.fee_cents, seller_payout_cents: r.seller_payout_cents, fulfillment: r.fulfillment,
      status: r.status, payment: { status: r.payment_status, paid_at: r.paid_at }, payout: { status: r.payout_status, released_at: r.released_at },
      handoff_id: r.handoff_id, shipment: shipment ? toShipment(shipment) : null, created_at: r.created_at,
    });
  });
}

export async function orderOut(row: OrderRow, viewer: Viewer | null) {
  const [order] = await ordersOut([row], row.school_id, viewer);
  if (!order) throw new Error(`Order ${row.id} could not be built`);
  return order;
}
