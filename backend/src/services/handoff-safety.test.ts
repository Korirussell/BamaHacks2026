import assert from "node:assert/strict";
import test from "node:test";
import { HandoffRow, trackingFor, toHandoff } from "../db/fulfillment.js";
import {
  OVERDUE_MS, checkNoShow, decideOverdue, decideTap, mayShareDistance, presenceAfterPing, readZone, roundDistance, sharingWindow,
  tapExpiresAt, tapStillValid, type Zone,
} from "./handoff.js";

const zone: Zone = { location: { lat: 33.2, lng: -87.5 }, radiusM: 50 };
// ~1 degree lat = 111,195 m, so 0.0001 deg ≈ 11.1 m.
const at = (metersNorth: number) => ({ lat: 33.2 + metersNorth / 111_195, lng: -87.5 });
const T = Date.parse("2026-10-17T12:00:00Z");
const MIN = 60_000;

test("roundDistance rounds to the nearest 10 m", () => {
  assert.equal(roundDistance(14), 10);
  assert.equal(roundDistance(15), 20);
  assert.equal(roundDistance(0), 0);
});

test("readZone: inside, outside with edge distance, and bad accuracy", () => {
  assert.deepEqual(readZone({ location: at(10), accuracyM: 5 }, zone), { accuracyOk: true, inside: true, distanceToZoneM: 0 });
  const out = readZone({ location: at(200), accuracyM: 5 }, zone);
  assert.equal(out.inside, false);
  assert.equal(out.distanceToZoneM, 150);
  const bad = readZone({ location: at(0), accuracyM: 101 }, zone);
  assert.deepEqual(bad, { accuracyOk: false, inside: false, distanceToZoneM: null });
  assert.equal(readZone({ location: at(0), accuracyM: 100 }, zone).inside, true);
});

test("accuracy widens the zone but only up to 50 m", () => {
  assert.equal(readZone({ location: at(95), accuracyM: 50 }, zone).inside, true); // 50 + 50
  assert.equal(readZone({ location: at(105), accuracyM: 100 }, zone).inside, false); // slack capped at 50
});

test("presenceAfterPing: a poor fix leaves the flag alone", () => {
  const bad = readZone({ location: at(500), accuracyM: 300 }, zone);
  assert.equal(presenceAfterPing(true, bad), true);
  assert.equal(presenceAfterPing(false, bad), false);
  assert.equal(presenceAfterPing(true, readZone({ location: at(500), accuracyM: 5 }, zone)), false);
  assert.equal(presenceAfterPing(false, readZone({ location: at(0), accuracyM: 5 }, zone)), true);
});

test("sharing window is start-30min to end+30min, inclusive, and needs the setting and a live status", () => {
  const start = T;
  const end = T + 10 * MIN;
  const w = sharingWindow(start, end);
  assert.equal(w.startsAt, start - 30 * MIN);
  assert.equal(w.endsAt, end + 30 * MIN);
  const base = { status: "agreed" as const, agreedStart: start, agreedEnd: end, sharerSetting: "during_handoffs" as const };
  assert.equal(mayShareDistance({ ...base, now: w.startsAt }), true);
  assert.equal(mayShareDistance({ ...base, now: w.startsAt - 1 }), false);
  assert.equal(mayShareDistance({ ...base, now: w.endsAt }), true);
  assert.equal(mayShareDistance({ ...base, now: w.endsAt + 1 }), false);
  assert.equal(mayShareDistance({ ...base, now: T, sharerSetting: "off" }), false);
  assert.equal(mayShareDistance({ ...base, now: T, status: "completed" }), false);
  assert.equal(mayShareDistance({ ...base, now: T, status: "proposing" }), false);
});

const tap = (offsetMs: number, north = 0, acc = 5) => ({ at: T + offsetMs, location: at(north), accuracyM: acc });

test("decideTap: pairs when both taps are within 60 s, close together and inside the zone", () => {
  assert.deepEqual(decideTap(tap(0), tap(-30_000, 3), zone), { outcome: "paired" });
  assert.deepEqual(decideTap(tap(0), tap(-60_000, 3), zone), { outcome: "paired" });
});

test("decideTap: waits with no other tap, a stale tap, far apart taps, outside zone or poor accuracy", () => {
  assert.deepEqual(decideTap(tap(0), null, zone), { outcome: "waiting", reason: "no_other_tap" });
  assert.deepEqual(decideTap(tap(0), tap(-60_001), zone), { outcome: "waiting", reason: "expired" });
  // both inside the 50 m zone but on opposite edges: ~90 m apart > 50 + 5
  assert.deepEqual(decideTap(tap(0, 45), tap(-1000, -45), zone), { outcome: "waiting", reason: "far_apart" });
  assert.deepEqual(decideTap(tap(0, 200), tap(-1000), zone), { outcome: "waiting", reason: "outside_zone" });
  assert.deepEqual(decideTap(tap(0, 0, 150), tap(-1000), zone), { outcome: "waiting", reason: "outside_zone" });
});

test("decideTap: separation allowance grows with accuracy but is capped at 50 + 50", () => {
  // 80 m apart inside the zone; accuracies of 40 → 50 + 40 = 90 allows it, 5 → 55 does not.
  assert.equal(decideTap(tap(0, 40, 40), tap(-1000, -40, 40), zone).outcome, "paired");
  assert.equal(decideTap(tap(0, 40, 5), tap(-1000, -40, 5), zone).outcome, "waiting");
});

test("tap expiry helpers", () => {
  assert.equal(tapExpiresAt(T), T + 60_000);
  assert.equal(tapStillValid(T, T + 60_000), true);
  assert.equal(tapStillValid(T, T + 60_001), false);
  assert.equal(tapStillValid(null, T), false);
});

test("checkNoShow: timing, location and the other person's arrival", () => {
  const base = {
    status: "agreed" as const, now: T + 15 * MIN, agreedStart: T, reporter: { location: at(0), accuracyM: 10 }, zone,
    otherNearby: false, otherTapped: false,
  };
  assert.deepEqual(checkNoShow(base), { ok: true });
  assert.deepEqual(checkNoShow({ ...base, now: T + 15 * MIN - 1 }), { ok: false, reason: "too_early" });
  assert.deepEqual(checkNoShow({ ...base, reporter: { location: at(0), accuracyM: 150 } }), { ok: false, reason: "bad_accuracy" });
  assert.deepEqual(checkNoShow({ ...base, reporter: { location: at(500), accuracyM: 5 } }), { ok: false, reason: "not_in_zone" });
  assert.deepEqual(checkNoShow({ ...base, otherNearby: true }), { ok: false, reason: "other_arrived" });
  assert.deepEqual(checkNoShow({ ...base, otherTapped: true }), { ok: false, reason: "other_arrived" });
  assert.deepEqual(checkNoShow({ ...base, status: "completed" }), { ok: false, reason: "wrong_state" });
});

test("decideOverdue: wait, no-show against the absent party, reschedule, or notify", () => {
  const end = T;
  const base = { now: end + OVERDUE_MS + 1, agreedEnd: end };
  assert.deepEqual(decideOverdue({ ...base, now: end + OVERDUE_MS, giverArrived: true, receiverArrived: false }), { action: "wait" });
  assert.deepEqual(decideOverdue({ ...base, giverArrived: true, receiverArrived: false }), { action: "no_show", absent: "receiver" });
  assert.deepEqual(decideOverdue({ ...base, giverArrived: false, receiverArrived: true }), { action: "no_show", absent: "giver" });
  assert.deepEqual(decideOverdue({ ...base, giverArrived: false, receiverArrived: false }), { action: "reschedule" });
  assert.deepEqual(decideOverdue({ ...base, giverArrived: true, receiverArrived: true }), { action: "notify_both" });
});

// ---- viewer-relative tracking never leaks coordinates

const ID_G = "11111111-1111-4111-8111-111111111111";
const ID_R = "22222222-2222-4222-8222-222222222222";
const SCHOOL = "33333333-3333-4333-8333-333333333333";
const ZONE = "44444444-4444-4444-8444-444444444444";
const row = (extra: Record<string, unknown> = {}) => HandoffRow.parse({
  id: ID_G, school_id: SCHOOL, context_type: "tutoring_session", context_id: ZONE, giver_id: ID_G, receiver_id: ID_R, suggestions: [],
  proposed_by: null, proposed_start: null, proposed_zone_id: null,
  agreed_start: new Date(T).toISOString(), agreed_end: new Date(T + 10 * MIN).toISOString(), safe_zone_id: ZONE, status: "arriving",
  giver_nearby: false, receiver_nearby: true, giver_at: null, receiver_at: null, item_ok: null, updated_at: new Date(T).toISOString(),
  safe_zone: { id: ZONE, school_id: SCHOOL, name: "Library", kind: "library", lat: 33.2, lng: -87.5, radius_m: 50, hours: [], hours_note: null, active: true },
  giver_lat: at(200).lat, giver_lng: at(200).lng, giver_accuracy_m: 5, giver_seen_at: new Date(T - MIN).toISOString(),
  receiver_lat: 33.2, receiver_lng: -87.5, receiver_accuracy_m: 5, receiver_seen_at: new Date(T).toISOString(),
  ...extra,
});

test("trackingFor: receiver sees giver distance (rounded) and own inside flag, no coordinates", () => {
  const t = trackingFor(row(), { id: ID_R, now: T, sharing: new Map([[ID_G, "during_handoffs"], [ID_R, "during_handoffs"]]) });
  assert.equal(t.me?.inside_zone, true);
  assert.equal(t.other.arrived, false);
  assert.equal(t.other.distance_m, 150);
  assert.equal(t.other.last_seen_at, new Date(T - MIN).toISOString());
  assert.ok(!JSON.stringify(t).includes("lat"));
});

test("trackingFor: sharing off or outside the window hides distance but keeps arrived", () => {
  const off = trackingFor(row(), { id: ID_R, now: T, sharing: new Map([[ID_G, "off"]]) });
  assert.deepEqual(off.other, { arrived: false, distance_m: null, last_seen_at: null });
  const late = trackingFor(row(), { id: ID_R, now: T + 41 * MIN, sharing: new Map([[ID_G, "during_handoffs"]]) });
  assert.equal(late.other.distance_m, null);
  const giverView = trackingFor(row(), { id: ID_G, now: T, sharing: new Map([[ID_R, "off"]]) });
  assert.equal(giverView.other.arrived, true);
  assert.equal(giverView.other.distance_m, null);
});

test("trackingFor: poor stored accuracy gives accuracy_ok false and no distance", () => {
  const t = trackingFor(row({ giver_accuracy_m: 400 }), { id: ID_R, now: T, sharing: new Map([[ID_G, "during_handoffs"]]) });
  assert.equal(t.other.distance_m, null);
  const mine = trackingFor(row({ receiver_accuracy_m: 400 }), { id: ID_R, now: T, sharing: new Map() });
  assert.deepEqual(mine.me, { inside_zone: false, distance_to_zone_m: null, accuracy_ok: false });
});

test("trackingFor: finished handoffs expose nothing and old rows without tracking columns still parse", () => {
  const done = trackingFor(row({ status: "completed", giver_lat: null, giver_lng: null, receiver_lat: null, receiver_lng: null }), { id: ID_R, now: T, sharing: new Map([[ID_G, "during_handoffs"]]) });
  assert.equal(done.me, null);
  assert.equal(done.other.distance_m, null);
  const legacy = HandoffRow.parse({ ...row(), giver_lat: undefined, giver_tap_at: undefined, no_show_party: undefined });
  assert.equal(legacy.giver_tap_at, null);
  assert.ok(toHandoff);
});
