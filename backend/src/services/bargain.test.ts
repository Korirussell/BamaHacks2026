import assert from "node:assert/strict";
import test from "node:test";
import { STYLES, negotiate, sellerFloor, type BargainStyle } from "./bargain.js";

const styles = Object.keys(STYLES) as BargainStyle[];

test("overlapping ranges find a deal between the floor and the buyer's max", () => {
  for (const style of styles) {
    const r = negotiate({ askCents: 6000, floorCents: 4000, maxCents: 5000, style });
    assert.equal(r.status, "deal_found", style);
    assert.ok(r.priceCents !== null && r.priceCents >= 4000 && r.priceCents <= 5000, `${style}: ${r.priceCents}`);
  }
});

test("a max below the floor ends with no deal after every round", () => {
  for (const style of styles) {
    const r = negotiate({ askCents: 6000, floorCents: 5000, maxCents: 4999, style });
    assert.equal(r.status, "no_deal");
    assert.equal(r.priceCents, null);
    assert.equal(r.rounds.length, STYLES[style].rounds * 2);
  }
});

test("neither agent ever crosses its limit, and both move monotonically", () => {
  for (const style of styles) {
    for (const [ask, floor, max] of [[6000, 4000, 4500], [10000, 9000, 9999], [2500, 1000, 900], [999, 1, 998]] as const) {
      const r = negotiate({ askCents: ask, floorCents: floor, maxCents: max, style });
      const bids = r.rounds.filter((x) => x.by === "buyer_agent").map((x) => x.amount_cents);
      const asks = r.rounds.filter((x) => x.by === "seller_agent").map((x) => x.amount_cents);
      assert.ok(bids.every((b) => b <= max), `bids over max: ${bids}`);
      assert.ok(asks.every((a) => a >= floor && a <= ask), `asks out of range: ${asks}`);
      assert.deepEqual(bids, [...bids].sort((a, b) => a - b));
      assert.deepEqual(asks, [...asks].sort((a, b) => b - a));
      assert.equal(r.status, max >= floor ? "deal_found" : "no_deal", `${style} ${ask}/${floor}/${max}`);
    }
  }
});

test("rounds alternate buyer then seller, and patient takes longer than quick", () => {
  const r = negotiate({ askCents: 10000, floorCents: 6000, maxCents: 6000, style: "patient" });
  r.rounds.forEach((x, i) => assert.equal(x.by, i % 2 === 0 ? "buyer_agent" : "seller_agent"));
  const quick = negotiate({ askCents: 10000, floorCents: 6000, maxCents: 6000, style: "quick" });
  assert.ok(r.rounds.length > quick.rounds.length);
  assert.equal(r.priceCents, 6000);
});

test("a max at or above the asking price pays the asking price in one round", () => {
  const r = negotiate({ askCents: 3000, floorCents: 2000, maxCents: 3500, style: "balanced" });
  assert.deepEqual(r, { status: "deal_found", rounds: [{ by: "buyer_agent", amount_cents: 3000 }], priceCents: 3000 });
});

test("is deterministic", () => {
  const input = { askCents: 7300, floorCents: 5100, maxCents: 6100, style: "balanced" as const };
  assert.deepEqual(negotiate(input), negotiate(input));
});

test("the floor is the asking price for firm listings or when the seller set none", () => {
  assert.equal(sellerFloor({ price_cents: 5000, negotiable: true, floor_price_cents: 4000 }), 4000);
  assert.equal(sellerFloor({ price_cents: 5000, negotiable: false, floor_price_cents: 4000 }), 5000);
  assert.equal(sellerFloor({ price_cents: 5000, negotiable: true, floor_price_cents: null }), 5000);
});
