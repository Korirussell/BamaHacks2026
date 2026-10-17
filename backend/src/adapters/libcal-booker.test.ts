import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkoutError, endOptionValue, gridColumnKey, libcalPlaywrightBooker } from "./libcal-booker.js";
import { manualRoomBooker } from "./stubs.js";

describe("libcal playwright booker", () => {
  it("maps an instant to the grid's Chicago-time column and end option", () => {
    const threePmCdt = Date.parse("2026-10-18T20:00:00Z");
    assert.equal(gridColumnKey(threePmCdt), "2026-10-18T15:00:00");
    assert.equal(endOptionValue(threePmCdt + 3_600_000), "2026-10-18 16:00:00");
  });

  it("reads LibCal's checkout refusal", () => {
    assert.equal(
      checkoutError("<p>Gorgas Team Work Space 2: Sorry, this exceeds the 1 booking per day limit in this category.</p>"),
      "Gorgas Team Work Space 2: Sorry, this exceeds the 1 booking per day limit in this category.",
    );
    assert.equal(checkoutError(""), "LibCal didn't accept the booking");
  });

  it("without a free room it doesn't open a browser and falls back to the link", async () => {
    const booker = libcalPlaywrightBooker({ profileDir: "/nonexistent", fallback: manualRoomBooker("https://lib.example/") });
    const out = await booker.book({ schoolId: "s", start: "2026-10-18T20:00:00Z", end: "2026-10-18T21:00:00Z", partySize: 3, room: null });
    assert.deepEqual(out, { status: "manual_required", room: null, bookingUrl: "https://lib.example/" });
  });
});
