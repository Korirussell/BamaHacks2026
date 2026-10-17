import { z } from "zod";
import { Cents, Timestamp, Uuid } from "./common.js";
import { UserPublic } from "./me.js";
import { Order } from "./orders.js";

export const Offer = z.object({
  id: Uuid, listing_id: Uuid, buyer: UserPublic, seller: UserPublic.nullable(), kind: z.enum(["cash", "trade", "cash_plus_trade"]),
  amount_cents: Cents, trade_listing_ids: z.array(Uuid), fulfillment: z.enum(["in_person", "campus_mail", "digital_transfer"]),
  message: z.string().nullable(), counter_of: Uuid.nullable(), auto_generated: z.boolean(), made_by: z.enum(["buyer", "seller"]),
  status: z.enum(["pending", "countered", "accepted", "declined", "withdrawn", "expired"]), waiting_on: z.enum(["buyer", "seller", "seller_claim"]).nullable(), seller_notified_at: Timestamp.nullable(), expires_at: Timestamp,
});
export const CreateOfferReq = z.object({ kind: z.enum(["cash", "trade", "cash_plus_trade"]), amount_cents: Cents, trade_listing_ids: z.array(Uuid), fulfillment: z.enum(["in_person", "campus_mail"]), message: z.string().optional() });
export const CounterOfferReq = z.object({ amount_cents: Cents, message: z.string().optional() });

export const CreateOfferRes = z.object({ offer: Offer, order: Order.optional() });

export type Offer = z.infer<typeof Offer>;
export type CreateOfferReq = z.infer<typeof CreateOfferReq>;
export type CounterOfferReq = z.infer<typeof CounterOfferReq>;
export type CreateOfferRes = z.infer<typeof CreateOfferRes>;
