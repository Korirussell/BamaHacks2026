import { Hono } from "hono";
import { z } from "zod";
import { EVENT_COLUMNS, EventRow, loadEventRow } from "../db/events.js";
import {
  LISTING_SELECT, ListingRow, listingsOut, loadListingRow, loadOrderRow, loadViewer, orderOut, sellerPayoutsEnabled, transitionOrder,
} from "../db/market.js";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { one, page } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { idempotent, type IdempotencyStore } from "../middleware/idempotency.js";
import { EventsQuery } from "../schemas/listings.js";
import { TicketSentReq } from "../schemas/orders.js";
import { settleOrder } from "../services/escrow.js";
import { nextOrderStatus } from "../services/orders.js";
import { assertAppTransfer } from "../services/tickets.js";

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

const parseId = (raw: string, what: string) => {
  const id = z.guid().safeParse(raw);
  if (!id.success) throw new ApiError(404, "NOT_FOUND", `${what} not found`);
  return id.data;
};

/** The order and its ticket listing; only app-transfer tickets use these endpoints. */
async function loadTicketOrder(rawId: string, userId: string, schoolId: string) {
  const order = await loadOrderRow(parseId(rawId, "Order"), userId, schoolId);
  const listing = await loadListingRow(order.listing_id, schoolId);
  assertAppTransfer(listing);
  return { order, listing };
}

export const eventsRoutes = (verify: TokenVerifier, idempotency: IdempotencyStore) => new Hono<AuthEnv>()
  .use("/events", requireUser(verify))
  .use("/events/*", requireUser(verify))
  .use("/orders/:id/ticket-sent", requireUser(verify))
  .use("/orders/:id/ticket-received", requireUser(verify))

  .get("/events", async (c) => {
    const q = parseQuery(c, EventsQuery);
    let query = adminClient().from("events").select(EVENT_COLUMNS).eq("school_id", c.var.user.schoolId)
      .gte("starts_at", q.from ?? new Date().toISOString());
    if (q.kind) query = query.eq("kind", q.kind);
    return c.json(page(z.array(EventRow).parse(check(await query.order("starts_at").limit(100)))));
  })

  .get("/events/:id/tickets", async (c) => {
    const { id: userId, schoolId } = c.var.user;
    const event = await loadEventRow(parseId(c.req.param("id"), "Event"), schoolId);
    const data = check(
      await adminClient().from("listings").select(LISTING_SELECT).eq("school_id", schoolId).eq("event_id", event.id)
        .eq("category", "ticket").eq("status", "active").order("price_cents", { ascending: true }).limit(100),
    );
    const rows = z.array(ListingRow).parse(data);
    return c.json(page(await listingsOut(rows, schoolId, await loadViewer(userId, schoolId))));
  })

  .post("/orders/:id/ticket-sent", idempotent(idempotency), async (c) => {
    const { proof_media_id } = await parseBody(c, TicketSentReq);
    const { id: userId, schoolId } = c.var.user;
    const { order, listing } = await loadTicketOrder(c.req.param("id"), userId, schoolId);
    if (order.seller_id !== userId) throw new ApiError(403, "FORBIDDEN", "Only the seller sends the ticket");
    const status = nextOrderStatus(order.status, "ticket_sent");
    if (proof_media_id) {
      const photo = check(await adminClient().from("media").select("id").eq("id", proof_media_id).eq("school_id", schoolId).eq("owner_id", userId).maybeSingle());
      if (!photo) throw new ApiError(400, "VALIDATION", "Invalid request", { proof_media_id: "Upload the transfer screenshot first" });
    }

    const moved = await transitionOrder(order, { status, ticket_sent_at: new Date().toISOString(), ticket_proof_media_id: proof_media_id ?? null });
    await notify({
      schoolId, userId: order.buyer_id, type: "order.updated", title: "Ticket sent",
      body: `${listing.title}: check your ticket app, then confirm you got it.`, deepLink: `/orders/${order.id}`, data: { order_id: order.id, status },
    });
    return c.json(one(await orderOut(moved, await loadViewer(userId, schoolId))));
  })

  .post("/orders/:id/ticket-received", idempotent(idempotency), async (c) => {
    const { id: userId, schoolId } = c.var.user;
    const { order, listing } = await loadTicketOrder(c.req.param("id"), userId, schoolId);
    if (order.buyer_id !== userId) throw new ApiError(403, "FORBIDDEN", "Only the buyer confirms the ticket arrived");
    nextOrderStatus(order.status, "received");

    const moved = await settleOrder(order, "completed", { reason: "ticket_received", sellerPayoutsEnabled: await sellerPayoutsEnabled(order.seller_id, schoolId) });
    await notify({
      schoolId, userId: order.seller_id, type: "order.updated", title: "Order completed",
      body: `${listing.title}: the buyer got the ticket.`, deepLink: `/orders/${order.id}`, data: { order_id: order.id, status: moved.status },
    });
    return c.json(one(await orderOut(moved, await loadViewer(userId, schoolId))));
  });
