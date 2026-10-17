import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { ApiError } from "../lib/errors.js";
import { parseBody } from "../lib/validate.js";
import { AdminIngestPostReq } from "./claims.js";
import { ConfirmReq, AgreeReq, CodeReq, LocationReq, ProposeReq } from "./handoffs.js";
import { CreateListingReq, ExploreQuery, PatchListingReq } from "./listings.js";
import { PatchMeReq } from "./me.js";
import { CounterOfferReq, CreateOfferReq } from "./offers.js";
import { CreateShipmentReq, DroppedOffReq, ReceivedReq } from "./orders.js";
import { CounterSessionReq, CreateSessionReq, PutTutorProfileReq, TutorsQuery } from "./tutoring.js";

const id = "123e4567-e89b-12d3-a456-426614174000";
const time = "2026-10-17T17:00:00.000Z";
const location = { lat: 33.2148, lng: -87.5458 };

function invalid(schema: { safeParse(value: unknown): { success: boolean } }, value: unknown): void {
  assert.equal(schema.safeParse(value).success, false);
}

test("request schemas accept contract examples and reject invalid examples", () => {
  assert.deepEqual(PatchMeReq.parse({ display_name: "Alex", budget_cents: 2500 }), { display_name: "Alex", budget_cents: 2500 });
  invalid(PatchMeReq, { budget_cents: -1 });

  const listing = { category: "textbook", title: "Calculus", description: "Clean copy", price_cents: 3500, negotiable: true, condition: "good", media_ids: [id], course_ids: [id], fulfillment: ["in_person"], publish: true };
  assert.equal(CreateListingReq.parse(listing).title, "Calculus");
  invalid(CreateListingReq, { ...listing, condition: "mint" });
  assert.deepEqual(PatchListingReq.parse({ price_cents: 3000 }), { price_cents: 3000 });
  invalid(PatchListingReq, { price_cents: -1 });
  assert.equal(ExploreQuery.parse({ min_cents: "100", within_budget: "true" }).within_budget, true);
  invalid(ExploreQuery, { within_budget: "sometimes" });

  const offer = { kind: "cash", amount_cents: 3500, trade_listing_ids: [], fulfillment: "campus_mail" };
  assert.equal(CreateOfferReq.parse(offer).amount_cents, 3500);
  invalid(CreateOfferReq, { ...offer, fulfillment: "digital_transfer" });
  assert.equal(CounterOfferReq.parse({ amount_cents: 3000 }).amount_cents, 3000);
  invalid(CounterOfferReq, { amount_cents: -1 });

  assert.deepEqual(CreateShipmentReq.parse({}), {});
  invalid(CreateShipmentReq, { drop_off_point_id: "not-a-uuid" });
  assert.equal(DroppedOffReq.parse({ location, accuracy_m: 8, photo_media_id: id }).accuracy_m, 8);
  invalid(DroppedOffReq, { location, accuracy_m: 8 });
  assert.equal(ReceivedReq.parse({ label_code: "BOX-123", item_ok: true }).item_ok, true);
  invalid(ReceivedReq, { label_code: "BOX-123" });

  const proposal = { start: time, safe_zone_id: id };
  assert.equal(ProposeReq.parse(proposal).safe_zone_id, id);
  invalid(ProposeReq, { ...proposal, start: "tomorrow" });
  assert.equal(AgreeReq.parse(proposal).start, time);
  invalid(AgreeReq, { safe_zone_id: id });
  const nearby = { location, accuracy_m: 5 };
  assert.equal(LocationReq.parse(nearby).accuracy_m, 5);
  invalid(LocationReq, { location, accuracy_m: 1.5 });
  assert.equal(CodeReq.parse(nearby).location.lat, location.lat);
  invalid(CodeReq, { location: { lat: "33", lng: -87 }, accuracy_m: 5 });
  assert.equal(ConfirmReq.parse({ ...nearby, item_ok: true, short_code: "123456" }).item_ok, true);
  invalid(ConfirmReq, { ...nearby, item_ok: "true" });

  const ingest = { channel: "instagram", external_url: "https://instagram.com/p/example", author_handle: "seller", caption: "Calc book", media_ids: [id], posted_at: time };
  assert.equal(AdminIngestPostReq.parse(ingest).channel, "instagram");
  invalid(AdminIngestPostReq, { ...ingest, channel: "x" });

  const profile = { enabled: true, course_ids: [id], hourly_rate_cents: 2500, modes: ["virtual"], open_to_requests: true };
  assert.equal(PutTutorProfileReq.parse(profile).enabled, true);
  invalid(PutTutorProfileReq, { ...profile, hourly_rate_cents: -1 });
  const session = { tutor_id: id, course_id: id, start: time, end: "2026-10-17T18:00:00.000Z", location_pref: "library_room" };
  assert.equal(CreateSessionReq.parse(session).tutor_id, id);
  invalid(CreateSessionReq, { ...session, location_pref: "home" });
  assert.equal(CounterSessionReq.parse({ start: time, end: session.end }).end, session.end);
  invalid(CounterSessionReq, { start: time, end: "later" });
});

test("TutorsQuery applies documented defaults and coercions", () => {
  const from = "2026-10-17T00:00:00.000Z";
  const parsed = TutorsQuery.parse({ course_id: id, from, max_rate_cents: "3000" });
  assert.equal(parsed.to, "2026-10-24T00:00:00.000Z");
  assert.equal(parsed.duration_min, 60);
  assert.equal(parsed.include_unverified, false);
  assert.equal(parsed.sort, "match");
  assert.equal(parsed.max_rate_cents, 3000);
  assert.equal(TutorsQuery.parse({ course_id: id, from, include_unverified: "true" }).include_unverified, true);
  invalid(TutorsQuery, { course_id: id, from, include_unverified: "yes" });
});

test("parseBody maps nested Zod paths to field_errors", async () => {
  const app = new Hono();
  app.post("/", async (c) => {
    try {
      await parseBody(c, CreateListingReq);
      return c.json({ ok: true });
    } catch (error: unknown) {
      assert.ok(error instanceof ApiError);
      return c.json(error.fieldErrors, error.status);
    }
  });
  const response = await app.request("http://localhost/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ media_ids: ["bad"] }) });
  assert.equal(response.status, 400);
  const errors: unknown = await response.json();
  assert.equal((errors as Record<string, string>)["media_ids.0"], "Invalid UUID");
});
