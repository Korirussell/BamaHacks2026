import { z } from "zod";
import { Cents, Uuid } from "./common.js";
import { Listing } from "./listings.js";
import { Course } from "./schedule.js";

const Category = z.enum(["textbook", "lab_supplies", "dorm", "ticket", "other"]);
const Shared = { max_price_cents: Cents.nullish(), alert: z.boolean().default(true) };

// Flat body as in the contract; the kind decides which target field is required.
export const CreateWishlistReq = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("isbn"), isbn: z.string().min(1), ...Shared }),
  z.object({ kind: z.literal("course_materials"), course_id: Uuid, ...Shared }),
  z.object({ kind: z.literal("keyword"), keyword: z.string().trim().min(2).max(100), ...Shared }),
  z.object({ kind: z.literal("category"), category: Category, ...Shared }),
]);

export const WishlistItem = z.object({
  id: Uuid,
  kind: z.enum(["isbn", "course_materials", "keyword", "category"]),
  isbn: z.string().nullable(),
  course: Course.nullable(),
  keyword: z.string().nullable(),
  category: Category.nullable(),
  max_price_cents: Cents.nullable(),
  alert: z.boolean(),
  match_count: z.number().int().nonnegative(),
});

export const SuggestedTrade = z.object({
  their_listing: Listing,
  my_listings: z.array(Listing),
  cash_delta_cents: Cents,
  score: z.number(),
});

export type CreateWishlistReq = z.infer<typeof CreateWishlistReq>;
export type WishlistItem = z.infer<typeof WishlistItem>;
export type SuggestedTrade = z.infer<typeof SuggestedTrade>;
