import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import { HandoffRow, ShipmentRow, toHandoff, toShipment } from "../db/fulfillment.js";
import { toUserPublic } from "../db/mappers.js";
import { ProfileRow, SchoolRow } from "../db/rows.js";
import type { TokenVerifier } from "../middleware/auth.js";
import { agreeToProposal, handoffSecret } from "../services/handoff.js";
import { ApiError } from "../lib/errors.js";

const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const schoolId = "33333333-3333-4333-8333-333333333333";
const zoneId = "44444444-4444-4444-8444-444444444444";
const school = { id: schoolId, name: "UA", domain: "ua.edu", center_lat: 33.2, center_lng: -87.5, timezone: "America/Chicago", campus_mail_supported: true, tutor_min_grade: "A-" };
const profile = (userId: string) => ({ id: userId, school_id: schoolId, email: "x@ua.edu", display_name: "X", major: null, grad_year: null, phone: null, budget_cents: null, mail_stop_code: null, tutor_opt_in: false, location_sharing: "during_handoffs" as const, notification_prefs: { push: true, email: true, wishlist_alerts: true, tutor_requests: true }, stripe_status: "none" as const, payouts_enabled: false, google_connected: false, completed_count: 0, no_show_count: 0 });
const user = (userId: string) => toUserPublic(ProfileRow.parse(profile(userId)), SchoolRow.parse(school), null);
const zone = { id: zoneId, school_id: schoolId, name: "Library", kind: "library" as const, lat: 33.2, lng: -87.5, radius_m: 50, hours: [], hours_note: null, active: true };

test("fulfillment mappers produce contract objects with Z timestamps", () => {
  const handoff = HandoffRow.parse({
    id, school_id: schoolId, context_type: "order", context_id: other, giver_id: id, receiver_id: other, suggestions: [],
    proposed_by: null, proposed_start: null, proposed_zone_id: null,
    agreed_start: "2026-10-17T12:00:00+00:00", agreed_end: "2026-10-17T12:10:00+00:00", safe_zone_id: zoneId, status: "agreed",
    giver_nearby: false, receiver_nearby: true, giver_at: null, receiver_at: null, item_ok: null,
    updated_at: "2026-10-17T11:00:00+00:00", safe_zone: zone,
  });
  const users = new Map([[id, user(id)], [other, user(other)]]);
  const out = toHandoff(handoff, users);
  assert.equal(out.agreed?.safe_zone.name, "Library");
  assert.equal(out.agreed?.start, "2026-10-17T12:00:00.000Z");
  const shipment = ShipmentRow.parse({
    id, school_id: schoolId, order_id: other, label_code: "ABC23456", label_media_id: null, to_name: "Buyer", to_mail_stop_code: "123",
    drop_off_point_id: zoneId, status: "label_created", dropped_off_at: null, drop_off_proof_media_id: null, received_at: null,
    auto_complete_at: null, drop_off: { ...zone, instructions: "Desk" },
  });
  assert.equal(toShipment(shipment).drop_off.instructions, "Desk");
});

test("fulfillment routes require a token and unknown paths remain 404", async () => {
  const fake: TokenVerifier = async () => null;
  const app = createApp({ verify: fake, log: false });
  const paths = [
    "/api/v1/handoffs/11111111-1111-4111-8111-111111111111/suggest",
    "/api/v1/handoffs/11111111-1111-4111-8111-111111111111/propose",
    "/api/v1/handoffs/11111111-1111-4111-8111-111111111111/agree",
    "/api/v1/handoffs/11111111-1111-4111-8111-111111111111/location",
    "/api/v1/handoffs/11111111-1111-4111-8111-111111111111/code",
    "/api/v1/handoffs/11111111-1111-4111-8111-111111111111/confirm",
    "/api/v1/handoffs/11111111-1111-4111-8111-111111111111",
    "/api/v1/orders/11111111-1111-4111-8111-111111111111/shipment",
    "/api/v1/shipments/11111111-1111-4111-8111-111111111111/dropped-off",
    "/api/v1/shipments/11111111-1111-4111-8111-111111111111/received",
    "/api/v1/shipments/11111111-1111-4111-8111-111111111111",
  ];
  for (const path of paths) {
    const method = path.endsWith(id) ? "GET" : "POST";
    const init = method === "GET" ? { method } : { method, body: "{}" };
    assert.equal((await app.request(path, init)).status, 401, path);
  }
  assert.equal((await app.request("/api/v1/not-a-route")).status, 404);
});

test("only the other party can agree to the exact proposed time and zone", () => {
  const proposal = { status: "proposing" as const, proposedBy: id, proposedStart: "2026-10-17T12:00:00.000Z", proposedZoneId: zoneId };
  agreeToProposal(proposal, other, { start: proposal.proposedStart, safeZoneId: proposal.proposedZoneId });
  // Postgres returns "+00:00"; the same instant must still match.
  agreeToProposal({ ...proposal, proposedStart: "2026-10-17T12:00:00+00:00" }, other, { start: "2026-10-17T12:00:00Z", safeZoneId: zoneId });
  assert.throws(() => agreeToProposal({ ...proposal, proposedBy: null }, other, { start: proposal.proposedStart, safeZoneId: zoneId }), (error: unknown) => error instanceof ApiError && error.status === 409);
  assert.throws(() => agreeToProposal({ ...proposal, status: "agreed" }, other, { start: proposal.proposedStart, safeZoneId: zoneId }), (error: unknown) => error instanceof ApiError && error.status === 409);
  assert.throws(() => agreeToProposal(proposal, id, { start: proposal.proposedStart, safeZoneId: proposal.proposedZoneId }), (error: unknown) => error instanceof ApiError && error.status === 409);
  assert.throws(() => agreeToProposal(proposal, other, { start: "2026-10-17T12:10:00.000Z", safeZoneId: zoneId }), (error: unknown) => error instanceof ApiError && error.status === 409);
});

test("handoff code secret is required and at least 32 characters", () => {
  assert.throws(() => handoffSecret({}), (error: unknown) => error instanceof ApiError && error.status === 500 && error.code === "INTERNAL");
  assert.equal(handoffSecret({ HANDOFF_SECRET: "x".repeat(32) }), "x".repeat(32));
});
