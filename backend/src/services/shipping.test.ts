import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLabel, campusAddressLines, dropOffSteps, isOpen, mailStreamDate, normalizeMsc, verifyDropOff } from "./shipping.js";
import { zonedToUtc } from "./time.js";

const TZ = "America/Chicago";
const WINDOW = [{ days: ["mon", "tue", "wed", "thu", "fri"] as const, open: "08:00", close: "16:30" }].map((h) => ({ ...h, days: [...h.days] }));
const at = (date: string, time: string) => zonedToUtc(date, time, TZ);
const point = { location: { lat: 33.2141, lng: -87.547 }, radiusM: 40, hours: WINDOW, name: "Crimson Mail & Shipping window" };
const drop = (now: number) => verifyDropOff({ status: "label_created", at: point.location, accuracyM: 5, point, photoMediaId: "m", now, tz: TZ });

describe("UA campus mail", () => {
  it("normalizes 6-digit MSCs and rejects anything else", () => {
    assert.equal(normalizeMsc("123456"), "123456");
    assert.equal(normalizeMsc("MSC 123456"), "123456");
    assert.equal(normalizeMsc("msc# 123-456"), "123456");
    for (const bad of ["12345", "1234567", "Box 870123A", "", null]) assert.equal(normalizeMsc(bad), null);
  });

  it("prints the official campus address block", () => {
    assert.deepEqual(campusAddressLines("Jordan Sample", "123456"), ["JORDAN SAMPLE", "1831 UNIVERSITY STATION", "MSC 123456", "TUSCALOOSA, AL 35487-0002"]);
  });

  it("needs first + last name and a 6-digit MSC on the label", () => {
    const base = { orderId: "o", sellerName: "S", itemTitle: "Book", dropOff: { name: "Mail", instructions: "" } };
    assert.throws(() => buildLabel({ ...base, buyer: { name: "Jordan", mailStopCode: "123456" } }), /first and last name/);
    assert.throws(() => buildLabel({ ...base, buyer: { name: "Jordan Sample", mailStopCode: "12345" } }), /MSC/);
    const label = buildLabel({ ...base, buyer: { name: "Jordan Sample", mailStopCode: "MSC 123456" } });
    assert.equal(label.to.mail_stop_code, "123456");
    assert.equal(label.address_lines[2], "MSC 123456");
  });

  it("only accepts drop-offs while the window is open", () => {
    assert.equal(isOpen(WINDOW, at("2026-10-19", "10:00"), TZ), true); // Monday
    assert.equal(isOpen(WINDOW, at("2026-10-19", "16:45"), TZ), false);
    assert.equal(isOpen(WINDOW, at("2026-10-18", "10:00"), TZ), false); // Sunday
    assert.throws(() => drop(at("2026-10-18", "10:00")), /closed/);
  });

  it("counts from the next business day after the 3 pm cutoff, then 7 days", () => {
    assert.equal(mailStreamDate(WINDOW, at("2026-10-19", "14:59"), TZ), "2026-10-19");
    assert.equal(mailStreamDate(WINDOW, at("2026-10-19", "15:00"), TZ), "2026-10-20");
    assert.equal(mailStreamDate(WINDOW, at("2026-10-23", "16:00"), TZ), "2026-10-26"); // Friday after cutoff → Monday
    assert.equal(drop(at("2026-10-19", "10:00")).auto_complete_at, new Date(at("2026-10-26", "15:00")).toISOString());
    assert.equal(drop(at("2026-10-23", "16:00")).auto_complete_at, new Date(at("2026-11-02", "15:00")).toISOString());
  });

  it("lists drop-off steps with the code, hours and cutoff", () => {
    const steps = dropOffSteps({ labelCode: "ABCD2345", dropOffName: "Crimson Mail & Shipping window", hours: WINDOW });
    assert.ok(steps.some((s) => s.includes("ABCD2345")));
    assert.ok(steps.some((s) => s.includes("Mon–Fri 8 am–4:30 pm")));
    assert.ok(steps.some((s) => s.includes("after 3 pm")));
  });
});
