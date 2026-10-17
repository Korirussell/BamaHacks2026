import { Hono } from "hono";
import { z } from "zod";
import type { MarketConfig } from "../db/market-actions.js";
import { loadListingRow } from "../db/market.js";
import { aiQueue, decider } from "../lib/ai.js";
import { ApiError } from "../lib/errors.js";
import { one } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { Cents } from "../schemas/common.js";
import { sellerFloor } from "../services/bargain.js";
import { summarize } from "../services/decisions.js";
import { haggleQuestions, haggleState, parseAmountCents, planHaggle, readTriage } from "../services/haggle.js";
import { gateQuestions, gateState, gateVerdict, type GateInput, type GateVerdict } from "../services/listing-gate.js";
import { suggestedPrice } from "../services/listing-draft.js";
import { comparablePrices } from "./listings.js";
import { hasOpenOffer, offerOut, placeOffer } from "./offers.js";

// Local-AI endpoints: haggle triage (JEV + the deterministic price rule), the listing gate, and the
// worker's status for the demo. Each works without the laptop too, on keyword rules.

const HaggleReq = z.object({
  message: z.string().trim().min(1).max(1000),
  history: z.array(z.object({ from: z.enum(["buyer", "seller"]), text: z.string().max(1000) })).max(20).default([]),
  /** The last price the seller's agent offered in this chat, so it never goes back up. */
  last_counter_cents: Cents.nullish(),
  /** Turn an agreed price straight into a pending offer the seller taps to accept. */
  place_offer: z.boolean().default(true),
});

const ReviewReq = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).default(""),
  category: z.enum(["textbook", "lab_supplies", "dorm", "ticket", "other"]),
  price_cents: Cents,
  isbn: z.string().nullish(),
});

const guid = (raw: string, what: string) => {
  const id = z.guid().safeParse(raw);
  if (!id.success) throw new ApiError(404, "NOT_FOUND", `${what} not found`);
  return id.data;
};

/** JEV's verdict on a listing, with the median of similar listings in its state. Used by review and publish. */
export async function reviewListing(schoolId: string, l: Omit<GateInput, "medianCents"> & { isbn?: string | null }): Promise<GateVerdict & { decisions?: ReturnType<typeof summarize> }> {
  const comps = await comparablePrices(schoolId, { isbn: l.isbn ?? null, title: l.title, category: l.category }).catch(() => []);
  const input = { ...l, medianCents: suggestedPrice(comps) };
  const d = await decider().decide(gateState(input), gateQuestions());
  return { ...gateVerdict(d, input), ...(d ? { decisions: summarize(d) } : {}) };
}

/** Files a scam report against a buyer on the seller's behalf (once a day per buyer). */
async function autoReport(schoolId: string, sellerId: string, buyerId: string, flags: string[], message: string) {
  const db = adminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recent = await db.from("reports").select("id").eq("reporter_id", sellerId).eq("target_type", "user").eq("target_id", buyerId).gte("created_at", since).limit(1);
  if (recent.error || (recent.data ?? []).length) return false;
  const r = await db.from("reports").insert({
    school_id: schoolId, reporter_id: sellerId, target_type: "user", target_id: buyerId, reason: "scam",
    details: `Auto-flagged by JEV (${flags.join(", ")}): "${message.slice(0, 500)}"`,
  });
  return !r.error;
}

export const aiRoutes = (verify: TokenVerifier, cfg: MarketConfig) => new Hono<AuthEnv>()
  // Public, so the demo screen can show the laptop going green. No task contents, just liveness.
  .get("/ai/status", async (c) => c.json(one(await aiQueue().status())))

  .use("/ai/listing-review", requireUser(verify))
  .use("/listings/:id/haggle", requireUser(verify))

  .post("/ai/listing-review", async (c) => {
    const body = await parseBody(c, ReviewReq);
    return c.json(one(await reviewListing(c.var.user.schoolId, {
      title: body.title, description: body.description, category: body.category, priceCents: body.price_cents, isbn: body.isbn ?? null,
    })));
  })

  .post("/listings/:id/haggle", async (c) => {
    const body = await parseBody(c, HaggleReq);
    const { id: buyerId, schoolId } = c.var.user;
    const listing = await loadListingRow(guid(c.req.param("id"), "Listing"), schoolId);
    if (listing.status === "draft" || listing.status === "removed") throw new ApiError(404, "NOT_FOUND", "Listing not found");
    if (listing.status !== "active") throw new ApiError(409, "INVALID_STATE", "Listing isn't available");
    if (listing.seller_id === buyerId) throw new ApiError(403, "FORBIDDEN", "You can't haggle on your own listing");

    const amountCents = parseAmountCents(body.message);
    const d = await decider().decide(
      haggleState({ title: listing.textbook_title ?? listing.title, askCents: listing.price_cents, message: body.message, history: body.history }),
      haggleQuestions(),
    );
    const triage = readTriage(d, body.message, amountCents);
    const plan = planHaggle({
      askCents: listing.price_cents, floorCents: sellerFloor(listing), negotiable: listing.negotiable,
      lastCounterCents: body.last_counter_cents ?? null, amountCents, ...triage,
    });

    const reported = plan.scamFlags.length && listing.seller_id
      ? await autoReport(schoolId, listing.seller_id, buyerId, plan.scamFlags, body.message)
      : false;

    const fulfillment = listing.fulfillment.includes("in_person") ? "in_person" : listing.fulfillment[0];
    let offer = null;
    if (plan.action === "accept" && plan.priceCents !== null && body.place_offer && fulfillment && !(await hasOpenOffer(listing.id, buyerId))) {
      const placed = await placeOffer({
        listing, buyerId, amountCents: plan.priceCents, fulfillment, cfg, autoGenerated: true,
        message: `Agreed in chat: "${body.message.slice(0, 200)}"`,
      });
      offer = await offerOut(placed.row);
    }

    return c.json(one({
      intent: plan.intent,
      amount_cents: plan.amountCents,
      action: plan.action,
      price_cents: plan.priceCents,
      reply: plan.reply,
      scam_flags: plan.scamFlags,
      reported,
      seriousness: Math.round(triage.seriousness * 10) / 10,
      engine: d ? "jev" : "rules",
      ...(d ? { decisions: summarize(d) } : {}),
      proposed_offer: offer,
    }));
  });
