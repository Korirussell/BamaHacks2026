import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captionTextbookIdentifier } from "../adapters/stubs.js";
import { ApiError } from "../lib/errors.js";
import { MONDAY, TERM, UA } from "../test/fixtures.js";
import { expandMeetings, freeBlocks, type MeetingInput } from "./availability.js";
import { assertClaimUsable, hashClaimToken, newClaimToken } from "./claims.js";
import { confirmHandoff, handoffCode, verifyHandoffCode } from "./handoff.js";
import { interestedStudents, normalizeIsbn } from "./materials.js";
import { suggestMeetups } from "./meetups.js";
import { actOnOffer, openOffer } from "./offers.js";
import { nextOrderStatus, payoutFor, splitAmount } from "./orders.js";
import { buildLabel, verifyDropOff, verifyReceived } from "./shipping.js";
import { localTime, zonedToUtc } from "./time.js";
import {
  acceptSession, cancelSession, completeSession, counterSession, declineSession, findTutorMatches, tutorEligibility, type TutorCandidate,
} from "./tutoring.js";

const at = (date: string, time: string) => zonedToUtc(date, time, UA.tz);
const meeting = (courseCode: string, days: MeetingInput["days"], start: string, end: string, buildingName: string, loc: { lat: number; lng: number }): MeetingInput => ({
  courseCode, days, start, end, buildingName, buildingLocation: loc, ...TERM,
});
const partyFor = (meetings: MeetingInput[], from: number, to: number) => ({
  free: freeBlocks(expandMeetings(meetings, from, to), from, to, UA.tz),
  fallback: UA.center,
});

describe("time", () => {
  it("converts Chicago wall-clock to UTC across DST", () => {
    assert.equal(zonedToUtc("2026-10-19", "09:00", UA.tz), Date.UTC(2026, 9, 19, 14, 0)); // CDT
    assert.equal(zonedToUtc("2026-12-07", "09:00", UA.tz), Date.UTC(2026, 11, 7, 15, 0)); // CST
  });
});

describe("availability", () => {
  it("expands classes and finds free blocks with neighbouring buildings", () => {
    const from = at(MONDAY, "00:00");
    const to = at("2026-10-20", "00:00");
    const busy = expandMeetings([meeting("CS 201", ["mon", "wed"], "09:00", "09:50", "NERC", UA.nerc)], from, to);
    assert.equal(busy.length, 1);
    const free = freeBlocks(busy, from, to, UA.tz);
    assert.deepEqual(free.map((b) => [localTime(b.start, UA.tz), localTime(b.end, UA.tz)]), [["08:00", "09:00"], ["09:50", "21:00"]]);
    assert.equal(free[0]!.after?.label, "CS 201 in NERC");
    assert.equal(free[1]!.before?.label, "CS 201 in NERC");
  });

  it("ignores classes outside the term", () => {
    const from = at("2026-12-14", "00:00");
    const busy = expandMeetings([meeting("CS 201", ["mon"], "09:00", "09:50", "NERC", UA.nerc)], from, from + 86_400_000);
    assert.equal(busy.length, 0);
  });
});

describe("meetups", () => {
  it("suggests a safe zone right after both people's classes", () => {
    const from = at(MONDAY, "08:00");
    const to = at("2026-10-21", "00:00");
    const me = partyFor([meeting("CS 201", ["mon"], "10:00", "10:50", "NERC", UA.nerc), meeting("MATH 227", ["mon"], "12:00", "12:50", "Shelby Hall", UA.shelby)], from, to);
    const them = partyFor([meeting("EN 102", ["mon"], "10:00", "10:50", "Lloyd Hall", UA.lloyd)], from, to);
    const out = suggestMeetups({
      me, them, tz: UA.tz, now: from,
      zones: [{ id: "ferg", name: "Ferguson Center", kind: "student_center", location: UA.ferguson, hours: [{ days: ["mon", "tue", "wed", "thu", "fri"], open: "07:00", close: "22:00" }] }],
    });
    assert.ok(out.length > 0);
    const first = out[0]!;
    assert.equal(first.safe_zone_id, "ferg");
    assert.equal(localTime(Date.parse(first.start), UA.tz) >= "10:50", true);
    assert.equal(localTime(Date.parse(first.start), UA.tz) < "12:00", true);
    assert.match(first.reason, /after your CS 201 in NERC/);
    assert.match(first.reason, /after their EN 102 in Lloyd Hall/);
  });
});

describe("tutoring", () => {
  const from = at(MONDAY, "08:00");
  const to = at("2026-10-24", "00:00");
  const student = { userId: "s", ...partyFor([meeting("CS 101", ["mon", "wed", "fri"], "09:00", "09:50", "NERC", UA.nerc)], from, to) };
  const tutor = (userId: string, grade: string, verified: boolean, enabled = true): TutorCandidate => ({
    userId, enabled, courseIds: ["cs101"], hourlyRateCents: 2000, rating: 4.8, reviewCount: 5, sessionsCompleted: 5,
    record: { grade, verified, term: "Fall 2025" },
    party: partyFor([meeting("CS 260", ["tue", "thu"], "11:00", "12:15", "Shelby Hall", UA.shelby)], from, to),
  });
  const candidates = [tutor("a", "A", true), tutor("b", "B+", true), tutor("c", "A-", false), tutor("d", "A", true, false)];

  it("only returns verified, enabled tutors at or above the threshold", () => {
    const out = findTutorMatches({ courseId: "cs101", student, candidates, minGrade: "A-", meetingPlace: UA.gorgas, durationMin: 60, now: from });
    assert.deepEqual(out.map((m) => m.user_id), ["a"]);
    assert.ok(out[0]!.mutual_slots.length > 0);
    assert.ok(out[0]!.match.reasons[0]!.includes("verified"));
  });

  it("includes unverified grades when asked", () => {
    const out = findTutorMatches({ courseId: "cs101", student, candidates, minGrade: "A-", meetingPlace: null, durationMin: 60, now: from, includeUnverified: true });
    assert.deepEqual(out.map((m) => m.user_id).sort(), ["a", "c"]);
  });

  it("runs propose → counter → accept with turn-taking", () => {
    let s = { status: "requested" as const, waitingOn: "tutor" as const, start: "2026-10-20T15:00:00Z", end: "2026-10-20T16:00:00Z", hourlyRateCents: 2000 };
    assert.throws(() => acceptSession(s, "student"), ApiError);
    const countered = counterSession(s, "tutor", "2026-10-20T17:00:00Z", "2026-10-20T18:00:00Z");
    assert.equal(countered.waitingOn, "student");
    assert.equal(acceptSession(countered, "student").status, "accepted");
  });

  it("declines on your turn only, cancels before it happens, completes once started", () => {
    const s = { status: "requested" as const, waitingOn: "tutor" as const, start: "2026-10-20T15:00:00Z", end: "2026-10-20T16:00:00Z", hourlyRateCents: 2000 };
    assert.throws(() => declineSession(s, "student"), ApiError);
    assert.equal(declineSession(s, "tutor").status, "cancelled");
    const accepted = acceptSession(s, "tutor");
    assert.throws(() => completeSession(accepted, Date.parse("2026-10-20T14:00:00Z")), /hasn't started/);
    assert.equal(completeSession(accepted, Date.parse("2026-10-20T15:30:00Z")).status, "completed");
    assert.equal(cancelSession(accepted).status, "cancelled");
    assert.throws(() => cancelSession({ ...accepted, status: "completed" }), ApiError);
  });

  it("eligibility keeps the best past grade and needs it verified", () => {
    const e = tutorEligibility([
      { courseId: "ch101", term: "Fall 2025", status: "past", grade: "B+", verified: true },
      { courseId: "ch101", term: "Spring 2026", status: "past", grade: "A", verified: true },
      { courseId: "math125", term: "Fall 2025", status: "past", grade: "A", verified: false },
      { courseId: "en101", term: "Fall 2025", status: "past", grade: "B", verified: true },
      { courseId: "cs100", term: "Fall 2026", status: "current", grade: null, verified: false },
    ], "A-");
    assert.deepEqual(e.get("ch101"), { courseId: "ch101", grade: "A", term: "Spring 2026", verified: true, eligible: true, reason: null });
    assert.equal(e.get("math125")?.eligible, false);
    assert.match(e.get("math125")?.reason ?? "", /transcript/);
    assert.match(e.get("en101")?.reason ?? "", /A- or better/);
    assert.equal(e.has("cs100"), false);
  });
});

describe("handoff", () => {
  const secret = "test-secret";
  const now = Date.UTC(2026, 9, 19, 16, 0, 30);

  it("accepts the current and previous code, rejects older ones", () => {
    const code = handoffCode(secret, "h1", now);
    assert.ok(verifyHandoffCode(secret, "h1", now, { short_code: code.short_code }));
    assert.ok(verifyHandoffCode(secret, "h1", now + 60_000, { qr_token: code.qr_token }));
    assert.ok(!verifyHandoffCode(secret, "h1", now + 120_000, { qr_token: code.qr_token }));
    assert.ok(!verifyHandoffCode(secret, "h2", now, { short_code: code.short_code }));
  });

  it("requires the receiver to be in the zone, and item_ok decides complete vs dispute", () => {
    const base = { status: "agreed" as const, zone: { location: UA.ferguson, radiusM: 60 }, accuracyM: 10, code: { short_code: handoffCode(secret, "h1", now).short_code } };
    assert.throws(() => confirmHandoff(secret, "h1", now, { ...base, receiverAt: UA.gorgas, itemOk: true }), /meetup spot/);
    assert.deepEqual(confirmHandoff(secret, "h1", now, { ...base, receiverAt: UA.ferguson, itemOk: true }), { handoff: "completed", order: "completed" });
    assert.equal(confirmHandoff(secret, "h1", now, { ...base, receiverAt: UA.ferguson, itemOk: false }).order, "disputed");
  });
});

describe("orders", () => {
  it("walks the in-person and campus-mail paths", () => {
    let s = nextOrderStatus("awaiting_payment", "payment_succeeded");
    s = nextOrderStatus(s, "meetup_agreed");
    s = nextOrderStatus(s, "both_nearby");
    assert.equal(nextOrderStatus(s, "handoff_confirmed"), "completed");

    let m = nextOrderStatus("paid", "label_created");
    m = nextOrderStatus(m, "dropped_off");
    assert.equal(m, "in_transit");
    assert.equal(nextOrderStatus(m, "received"), "completed");
    assert.throws(() => nextOrderStatus("awaiting_payment", "dropped_off"), ApiError);
  });

  it("splits fees and holds payout until onboarding", () => {
    assert.deepEqual(splitAmount(4500, 500), { amount_cents: 4500, fee_cents: 225, seller_payout_cents: 4275 });
    assert.equal(payoutFor("completed", false), "awaiting_onboarding");
    assert.equal(payoutFor("completed", true), "released");
    assert.equal(payoutFor("paid", true), "held");
  });
});

describe("offers + claims", () => {
  const now = Date.UTC(2026, 9, 19);
  it("offers on unclaimed listings wait for the claim and queue an invite", () => {
    const r = openOffer({ listing: { status: "active", priceCents: 5000, claimed: false, sellerId: null }, buyerId: "b", kind: "cash", amountCents: 4000, now });
    assert.equal(r.waitingOn, "seller_claim");
    assert.equal(r.queueSellerInvite, true);
    assert.throws(() => actOnOffer({ status: "pending", waitingOn: "seller_claim", expiresAt: r.expiresAt }, "seller", "accept", now), /claimed/);
  });

  it("an asking-price cash offer on a claimed listing auto-accepts", () => {
    const r = openOffer({ listing: { status: "active", priceCents: 5000, claimed: true, sellerId: "s" }, buyerId: "b", kind: "cash", amountCents: 5000, now });
    assert.equal(r.status, "accepted");
  });

  it("claim tokens are hashed, single-use and expire", () => {
    const t = newClaimToken(now);
    assert.equal(hashClaimToken(t.token), t.tokenHash);
    assert.doesNotThrow(() => assertClaimUsable({ status: "sent", expiresAt: t.expiresAt }, now));
    assert.throws(() => assertClaimUsable({ status: "claimed", expiresAt: t.expiresAt }, now), /expired or was already used/);
    assert.throws(() => assertClaimUsable({ status: "sent", expiresAt: t.expiresAt }, now + 8 * 86_400_000), ApiError);
  });
});

describe("materials", () => {
  it("normalizes ISBNs", () => {
    assert.equal(normalizeIsbn("0-306-40615-2"), "9780306406157");
    assert.equal(normalizeIsbn("978-0-306-40615-7"), "9780306406157");
    assert.equal(normalizeIsbn("978-0-306-40615-8"), null);
  });

  it("finds current/planned students in a requiring course, excluding the seller", () => {
    const out = interestedStudents({
      requiredByCourseIds: ["ch101"],
      sellerUserId: "seller",
      classes: [
        { userId: "u1", courseId: "ch101", status: "current" },
        { userId: "u2", courseId: "ch101", status: "past" },
        { userId: "seller", courseId: "ch101", status: "current" },
        { userId: "u3", courseId: "ch101", status: "planned" },
        { userId: "u1", courseId: "ch101", status: "planned" },
      ],
    });
    assert.deepEqual(out.map((m) => m.userId), ["u1", "u3"]);
  });

  it("the stub identifier pulls ISBN and price from a caption", async () => {
    const g = await captionTextbookIdentifier.identify({ imageUrls: [], caption: "Chemistry: The Central Science 14th ed\nISBN 978-0-13-441423-2 $60 obo" });
    assert.equal(g.isbn, "9780134414232");
    assert.equal(g.priceCents, 6000);
    assert.equal(g.edition, "14");
  });
});

describe("campus mail", () => {
  it("needs a mail stop, geofenced drop-off with photo, and the label code on receipt", () => {
    assert.throws(() => buildLabel({ orderId: "o", buyer: { name: "B", mailStopCode: null }, sellerName: "S", itemTitle: "Book", dropOff: { name: "Mail", instructions: "" } }), /mail stop/);
    const label = buildLabel({ orderId: "o", buyer: { name: "B", mailStopCode: "Box 870123" }, sellerName: "S", itemTitle: "Book", dropOff: { name: "Mail", instructions: "" } });
    assert.match(label.label_code, /^[A-Z2-9]{8}$/);
    const point = { location: UA.mailCenter, radiusM: 40 };
    assert.throws(() => verifyDropOff({ status: "label_created", at: UA.gorgas, accuracyM: 5, point, photoMediaId: "m", now: 0 }), /drop-off point/);
    assert.equal(verifyDropOff({ status: "label_created", at: UA.mailCenter, accuracyM: 5, point, photoMediaId: "m", now: 0 }).status, "dropped_off");
    assert.equal(verifyReceived({ status: "dropped_off", expectedCode: label.label_code, givenCode: label.label_code.toLowerCase() }).status, "received");
  });
});
