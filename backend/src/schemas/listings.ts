import { z } from "zod";
import { Cents, Timestamp, Uuid } from "./common.js";
import { UserPublic } from "./me.js";
import { Course } from "./schedule.js";

const Category = z.enum(["textbook", "lab_supplies", "dorm", "ticket", "other"]);
const Condition = z.enum(["new", "like_new", "good", "fair", "poor"]);
const Fulfillment = z.enum(["in_person", "campus_mail", "digital_transfer"]);

export const ExternalSeller = z.object({
  channel: z.enum(["instagram", "groupme", "facebook", "snapchat"]),
  handle: z.string(),
  profile_url: z.string().nullable(),
});

const Media = z.object({
  id: Uuid,
  url: z.string(),
  kind: z.enum(["image", "pdf"]),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export const Event = z.object({ id: Uuid, name: z.string(), kind: z.enum(["athletics", "concert", "other"]), starts_at: Timestamp, venue: z.string() });

const TicketTransfer = z.enum(["app_transfer", "in_person"]);
const SeatPart = z.string().trim().min(1).max(20);
export const TicketInput = z.object({
  event_id: Uuid, section: z.string().trim().min(1).max(40), row: SeatPart.nullish(), seat: SeatPart.nullish(), transfer: TicketTransfer,
});

export const Listing = z.object({
  id: Uuid,
  seller: UserPublic.nullable(),
  external_seller: ExternalSeller.nullable(),
  category: Category,
  title: z.string(),
  description: z.string(),
  price_cents: Cents,
  negotiable: z.boolean(),
  floor_price_cents: Cents.nullable(),
  condition: Condition,
  media: z.array(Media),
  textbook: z.object({ isbn: z.string(), title: z.string(), authors: z.array(z.string()), edition: z.string().nullable(), courses: z.array(Course) }).nullable(),
  ticket: z.object({ event: Event, section: z.string(), row: z.string().nullable(), seat: z.string().nullable(), transfer: TicketTransfer }).nullable(),
  fulfillment: z.array(Fulfillment),
  status: z.enum(["draft", "active", "pending", "sold", "removed"]),
  source: z.object({ channel: z.enum(["native", "screenshot", "instagram", "groupme", "facebook", "snapchat"]), external_url: z.string().nullable(), claimed: z.boolean() }),
  course_match: Course.nullable(),
  created_at: Timestamp,
});

const ListingFields = {
  category: Category,
  title: z.string(),
  description: z.string(),
  price_cents: Cents,
  negotiable: z.boolean(),
  floor_price_cents: Cents.optional(),
  condition: Condition,
  media_ids: z.array(Uuid),
  isbn: z.string().optional(),
  course_ids: z.array(Uuid),
  ticket: TicketInput.optional(),
  fulfillment: z.array(Fulfillment),
  publish: z.boolean(),
};

export const CreateListingReq = z.object(ListingFields);
export const PatchListingReq = z.object({
  category: Category.optional(), title: z.string().optional(), description: z.string().optional(), price_cents: Cents.optional(),
  negotiable: z.boolean().optional(), floor_price_cents: Cents.optional(), condition: Condition.optional(), media_ids: z.array(Uuid).optional(),
  isbn: z.string().optional(), course_ids: z.array(Uuid).optional(), ticket: ListingFields.ticket.optional(), fulfillment: z.array(Fulfillment).optional(), publish: z.boolean().optional(),
});
export const ExploreQuery = z.object({
  q: z.string().optional(), category: Category.optional(), course_id: Uuid.optional(), isbn: z.string().optional(),
  min_cents: z.coerce.number().int().nonnegative().optional(), max_cents: z.coerce.number().int().nonnegative().optional(), condition: Condition.optional(),
  fulfillment: Fulfillment.optional(), source: z.enum(["native", "screenshot", "instagram", "groupme", "facebook", "snapchat"]).optional(),
  within_budget: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  sort: z.enum(["relevance", "newest", "price_asc", "price_desc"]).optional(),
});
export const FeedItem = z.object({ type: z.enum(["listing", "tutor", "ride", "ticket", "study_group"]), item: z.object({}).passthrough(), reason: z.enum(["wishlist_match", "your_class", "friend", "nearby", "new"]), reason_course: Course.nullable() });

export const EventsQuery = z.object({ kind: Event.shape.kind.optional(), from: Timestamp.optional() });

export type ExternalSeller = z.infer<typeof ExternalSeller>;
export type Listing = z.infer<typeof Listing>;
export type CreateListingReq = z.infer<typeof CreateListingReq>;
export type PatchListingReq = z.infer<typeof PatchListingReq>;
export type ExploreQuery = z.infer<typeof ExploreQuery>;
export type FeedItem = z.infer<typeof FeedItem>;
export type Event = z.infer<typeof Event>;
export type TicketInput = z.infer<typeof TicketInput>;
