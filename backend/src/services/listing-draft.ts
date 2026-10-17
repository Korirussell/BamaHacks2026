import type { TextbookGuess } from "../adapters/ports.js";
import type { CreateListingReq } from "../schemas/listings.js";
import type { KnownMaterial } from "./ingest.js";
import { normalizeIsbn } from "./materials.js";

// Pure pieces of screenshot → listing and identify-textbook: what the identifier saw becomes the
// job_result the client shows (a pre-filled POST /listings body, or the book it recognised).

export interface ScreenshotDraftResult {
  draft: CreateListingReq;
  confidence: number;
  /** POST /listings fields the seller still has to fill before publishing. */
  missing_fields: string[];
  /** Where price_cents came from: the screenshot's own text, similar listings here, or Gemma's estimate. */
  price_source: "screenshot" | "comparable_listings" | "ai_estimate" | null;
  price_reason?: string;
}

/** Asking price in the screenshot wins, then the median of similar listings, then the model's estimate. */
export function pickPrice(guess: TextbookGuess, comparablePrices: number[]): { cents: number | null; source: ScreenshotDraftResult["price_source"] } {
  if (guess.priceCents !== null) return { cents: guess.priceCents, source: "screenshot" };
  const median = suggestedPrice(comparablePrices);
  if (median !== null) return { cents: median, source: "comparable_listings" };
  if (guess.estimatedPriceCents) return { cents: Math.round(guess.estimatedPriceCents / 100) * 100, source: "ai_estimate" };
  return { cents: null, source: null };
}

/** A pre-filled POST /listings body. Never published: the seller reviews it first. */
export function draftFromScreenshot(guess: TextbookGuess, materials: KnownMaterial[], mediaIds: string[], comparablePrices: number[] = []): ScreenshotDraftResult {
  const isbn = guess.isbn ? normalizeIsbn(guess.isbn) : null;
  const known = materials[0];
  const baseTitle = known?.title ?? guess.title.trim();
  const edition = known?.edition ?? guess.edition;
  const title = isbn && edition ? `${baseTitle} (${edition} ed.)` : baseTitle;
  const price = pickPrice(guess, comparablePrices);
  const missing = [
    ...(title ? [] : ["title"]),
    ...(price.cents === null ? ["price_cents"] : []),
    ...(guess.condition === null ? ["condition"] : []),
    ...(guess.isbn && !isbn ? ["isbn"] : []),
  ];
  return {
    draft: {
      category: isbn ? "textbook" : guess.category && guess.category !== "textbook" ? guess.category : "other",
      title,
      description: (guess.evidence ?? "").replace(/^(Gemma|Claude): /, ""),
      price_cents: price.cents ?? 0,
      negotiable: true,
      condition: guess.condition ?? "good",
      media_ids: mediaIds,
      ...(isbn ? { isbn } : {}),
      course_ids: [...new Set(materials.map((m) => m.courseId))],
      fulfillment: ["in_person"],
      publish: false,
    },
    confidence: guess.confidence,
    missing_fields: missing,
    price_source: price.source,
    ...(price.source === "ai_estimate" && guess.priceReason ? { price_reason: guess.priceReason } : {}),
  };
}

/** Median asking price of other listings for the same book, as a price hint. Null without any. */
export function suggestedPrice(prices: number[]): number | null {
  const sorted = prices.filter((p) => Number.isInteger(p) && p > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(median / 100) * 100; // whole dollars
}
