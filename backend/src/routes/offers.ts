import { Hono } from "hono";
import { z } from "zod";
import { createOrder, ensureSellerInvite, type MarketConfig } from "../db/market-actions.js";
import { OfferRow, loadListingRow, loadOfferRow, loadViewer, offersOut, orderOut, type ListingRow } from "../db/market.js";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { one, page } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { CounterOfferReq, CreateOfferReq } from "../schemas/offers.js";
import { OFFER_TTL_MS, actOnOffer, openOffer } from "../services/offers.js";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
const itemName = (l: ListingRow) => l.textbook_title ?? l.title;

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

const parseId = (raw: string) => {
  const id = z.guid().safeParse(raw);
  if (!id.success) throw new ApiError(404, "NOT_FOUND", "Offer not found");
  return id.data;
};

async function offerOut(row: OfferRow) {
  const [offer] = await offersOut([row], row.school_id);
  if (!offer) throw new Error(`Offer ${row.id} could not be built`);
  return offer;
}

/** Moves a pending offer on, only if nobody else changed it since we read it. */
async function transition(row: OfferRow, patch: Record<string, unknown>) {
  const data = check(
    await adminClient().from("offers").update(patch).eq("id", row.id).eq("status", "pending").eq("updated_at", row.updated_at).select("*").maybeSingle(),
  );
  if (!data) throw new ApiError(409, "INVALID_STATE", "This offer just changed; reload it");
  return OfferRow.parse(data);
}

/** Every other open offer on a listing that just sold ends as declined. */
async function declineOthers(listing: ListingRow, keepId: string) {
  const data = check(
    await adminClient().from("offers").update({ status: "declined", waiting_on: null })
      .eq("listing_id", listing.id).eq("status", "pending").neq("id", keepId).select("buyer_id, school_id"),
  );
  const rows = z.array(z.object({ buyer_id: z.guid(), school_id: z.guid() })).parse(data);
  await Promise.all(rows.map((r) => notify({
    schoolId: r.school_id, userId: r.buyer_id, type: "offer.updated",
    title: "Item sold", body: `${itemName(listing)} sold to someone else.`, deepLink: `/listings/${listing.id}`, data: { listing_id: listing.id },
  })));
}

async function acceptInto(row: OfferRow, listing: ListingRow, cfg: MarketConfig) {
  if (listing.status !== "active") throw new ApiError(409, "INVALID_STATE", "Listing isn't available");
  const order = await createOrder(row, listing, cfg);
  await declineOthers(listing, row.id);
  const notice = { schoolId: row.school_id, type: "order.updated", deepLink: `/orders/${order.id}`, data: { order_id: order.id } };
  await Promise.all([
    notify({ ...notice, userId: order.buyer_id, title: "Offer accepted", body: `Pay ${dollars(order.amount_cents)} to lock in ${itemName(listing)}.` }),
    notify({ ...notice, userId: order.seller_id, title: "Sold!", body: `${itemName(listing)} for ${dollars(order.amount_cents)}. We'll tell you when they pay.` }),
  ]);
  return order;
}

export const offersRoutes = (verify: TokenVerifier, cfg: MarketConfig) => new Hono<AuthEnv>()
  .use("/listings/*", requireUser(verify))
  .use("/offers/*", requireUser(verify))
  .use("/me/offers/*", requireUser(verify))

  .post("/listings/:id/offers", async (c) => {
    const body = await parseBody(c, CreateOfferReq);
    const { id: buyerId, schoolId } = c.var.user;
    const listingId = z.guid().safeParse(c.req.param("id"));
    if (!listingId.success) throw new ApiError(404, "NOT_FOUND", "Listing not found");
    const listing = await loadListingRow(listingId.data, schoolId);
    if (listing.status === "draft" || listing.status === "removed") throw new ApiError(404, "NOT_FOUND", "Listing not found");
    if (body.kind !== "cash" || body.trade_listing_ids.length) {
      throw new ApiError(400, "VALIDATION", "Invalid request", { kind: "Only cash offers are supported for now" });
    }
    if (!listing.fulfillment.includes(body.fulfillment)) {
      throw new ApiError(400, "VALIDATION", "Invalid request", { fulfillment: `This seller offers ${listing.fulfillment.join(" or ")}` });
    }
    const open = check(await adminClient().from("offers").select("id").eq("listing_id", listing.id).eq("buyer_id", buyerId).eq("status", "pending").limit(1));
    if ((open as unknown[]).length) throw new ApiError(409, "INVALID_STATE", "You already have an open offer on this listing");

    const now = Date.now();
    const decision = openOffer({
      listing: { status: listing.status, priceCents: listing.price_cents, claimed: listing.claimed, sellerId: listing.seller_id },
      buyerId, kind: body.kind, amountCents: body.amount_cents, now,
    });
    const row = OfferRow.parse(check(
      await adminClient().from("offers").insert({
        school_id: schoolId, listing_id: listing.id, buyer_id: buyerId, seller_id: listing.seller_id, kind: body.kind,
        amount_cents: body.amount_cents, trade_listing_ids: [], fulfillment: body.fulfillment, message: body.message ?? null,
        made_by: "buyer", status: decision.status, waiting_on: decision.waitingOn, expires_at: decision.expiresAt,
        seller_notified_at: listing.seller_id ? new Date(now).toISOString() : null,
      }).select("*").single(),
    ));

    if (decision.queueSellerInvite) await ensureSellerInvite(listing, body.amount_cents, cfg, now);
    if (decision.status === "accepted") {
      const order = await acceptInto(row, listing, cfg);
      return c.json(one({ offer: await offerOut(row), order: await orderOut(order, await loadViewer(buyerId, schoolId)) }), 201);
    }
    if (listing.seller_id) {
      await notify({
        schoolId, userId: listing.seller_id, type: "offer.created",
        title: `New offer: ${dollars(body.amount_cents)}`, body: `For ${itemName(listing)} (asking ${dollars(listing.price_cents)}).`,
        deepLink: `/listings/${listing.id}`, data: { offer_id: row.id, listing_id: listing.id },
      });
    }
    return c.json(one({ offer: await offerOut(row) }), 201);
  })

  .get("/me/offers", async (c) => {
    const q = parseQuery(c, z.object({ role: z.enum(["buyer", "seller"]).default("buyer"), status: OfferRow.shape.status.optional() }));
    const { id, schoolId } = c.var.user;
    let query = adminClient().from("offers").select("*").eq("school_id", schoolId).eq(q.role === "buyer" ? "buyer_id" : "seller_id", id);
    if (q.status) query = query.eq("status", q.status);
    const rows = z.array(OfferRow).parse(check(await query.order("created_at", { ascending: false }).limit(100)));
    return c.json(page(await offersOut(rows, schoolId)));
  })

  .post("/offers/:id/:action{counter|accept|decline|withdraw}", async (c) => {
    const action = c.req.param("action") as "counter" | "accept" | "decline" | "withdraw";
    const { id: userId, schoolId } = c.var.user;
    const row = await loadOfferRow(parseId(c.req.param("id")), schoolId);
    const actor = row.buyer_id === userId ? "buyer" : row.seller_id === userId ? "seller" : null;
    if (!actor) throw new ApiError(404, "NOT_FOUND", "Offer not found");
    const now = Date.now();
    const next = actOnOffer({ status: row.status, waitingOn: row.waiting_on, expiresAt: row.expires_at }, actor, action, now);
    const listing = await loadListingRow(row.listing_id, schoolId);
    const otherId = actor === "buyer" ? row.seller_id : row.buyer_id;
    const tell = (title: string, body: string, data: Record<string, unknown>) =>
      otherId ? notify({ schoolId, userId: otherId, type: "offer.updated", title, body, deepLink: `/listings/${listing.id}`, data }) : Promise.resolve();

    if (action === "counter") {
      const body = await parseBody(c, CounterOfferReq);
      if (body.amount_cents <= 0) throw new ApiError(400, "VALIDATION", "Invalid request", { amount_cents: "Must be above $0" });
      if (listing.status !== "active") throw new ApiError(409, "INVALID_STATE", "Listing isn't available");
      await transition(row, { status: next, waiting_on: null });
      const counter = OfferRow.parse(check(
        await adminClient().from("offers").insert({
          school_id: schoolId, listing_id: row.listing_id, buyer_id: row.buyer_id, seller_id: row.seller_id, kind: row.kind,
          amount_cents: body.amount_cents, trade_listing_ids: row.trade_listing_ids, fulfillment: row.fulfillment,
          message: body.message ?? null, counter_of: row.id, made_by: actor, status: "pending",
          waiting_on: actor === "buyer" ? "seller" : "buyer", expires_at: new Date(now + OFFER_TTL_MS).toISOString(),
          seller_notified_at: row.seller_notified_at,
        }).select("*").single(),
      ));
      await tell(`Counteroffer: ${dollars(body.amount_cents)}`, `For ${itemName(listing)}.`, { offer_id: counter.id, listing_id: listing.id });
      return c.json(one(await offerOut(counter)));
    }

    if (action === "accept") {
      if (listing.status !== "active") throw new ApiError(409, "INVALID_STATE", "Listing isn't available");
      const accepted = await transition(row, { status: next, waiting_on: null });
      const order = await acceptInto(accepted, listing, cfg);
      return c.json(one({ offer: await offerOut(accepted), order: await orderOut(order, await loadViewer(userId, schoolId)) }));
    }

    const ended = await transition(row, { status: next, waiting_on: null });
    await tell(action === "decline" ? "Offer declined" : "Offer withdrawn", `${dollars(row.amount_cents)} for ${itemName(listing)}.`, { offer_id: row.id, listing_id: listing.id });
    return c.json(one(await offerOut(ended)));
  });
