// Deterministic auto-bargain (contract: auto-bargain rule). Two agents alternate offers: the buyer
// agent climbs from an opening bid toward the buyer's max, the seller agent comes down from the asking
// price toward the private floor. Neither ever crosses its limit, so a deal always lands in [floor, max].

export type BargainStyle = "quick" | "balanced" | "patient";
export type BargainStatus = "negotiating" | "deal_found" | "no_deal";

export interface BargainRound {
  by: "buyer_agent" | "seller_agent";
  amount_cents: number;
}

export interface BargainResult {
  status: Exclude<BargainStatus, "negotiating">;
  rounds: BargainRound[];
  /** The agreed price, when a deal was found. */
  priceCents: number | null;
}

/** Rounds per side, and where the buyer agent opens (share of the buyer's max). */
export const STYLES: Record<BargainStyle, { rounds: number; openShare: number }> = {
  quick: { rounds: 3, openShare: 0.85 },
  balanced: { rounds: 5, openShare: 0.75 },
  patient: { rounds: 8, openShare: 0.65 },
};

/** The floor the seller agent defends: the private floor, or the asking price when there's none or the price is firm. */
export function sellerFloor(listing: { price_cents: number; negotiable: boolean; floor_price_cents: number | null }): number {
  if (!listing.negotiable || listing.floor_price_cents === null) return listing.price_cents;
  return Math.min(listing.floor_price_cents, listing.price_cents);
}

export function negotiate(input: { askCents: number; floorCents: number; maxCents: number; style: BargainStyle }): BargainResult {
  const ask = Math.max(0, Math.round(input.askCents));
  const floor = Math.min(ask, Math.max(0, Math.round(input.floorCents)));
  const max = Math.max(0, Math.round(input.maxCents));
  const { rounds: n, openShare } = STYLES[input.style];
  const rounds: BargainRound[] = [];
  const deal = (priceCents: number): BargainResult => ({ status: "deal_found", rounds, priceCents });

  if (max >= ask) {
    rounds.push({ by: "buyer_agent", amount_cents: ask });
    return deal(ask);
  }

  const open = Math.min(max, Math.floor(max * openShare));
  let sellerAsk = ask;
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 1 : k / (n - 1);
    // Buyer rounds down and seller rounds up, so neither steps past its own limit; the last round hits it exactly.
    const bid = k === n - 1 ? max : Math.min(max, Math.floor(open + (max - open) * t));
    rounds.push({ by: "buyer_agent", amount_cents: bid });
    if (bid >= sellerAsk) return deal(sellerAsk);

    const counter = k === n - 1 ? floor : Math.max(floor, Math.ceil(ask - (ask - floor) * ((k + 1) / n)));
    sellerAsk = Math.min(sellerAsk, counter);
    rounds.push({ by: "seller_agent", amount_cents: sellerAsk });
    if (sellerAsk <= bid) return deal(bid);
  }
  return { status: "no_deal", rounds, priceCents: null };
}
