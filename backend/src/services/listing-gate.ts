import type { DecisionQuestion, Decisions } from "../adapters/ports.js";

// Listing gate: JEV checks a listing before it goes live. Prohibited items are blocked; an odd price
// or a wrong category comes back as a warning the seller can fix. Without JEV everything passes.

export const CATEGORIES = ["textbook", "lab_supplies", "dorm", "ticket", "other"] as const;
const CATEGORY_LABELS = [
  "textbook or course book",
  "lab or class supplies (lab coat, goggles, calculator, clicker)",
  "dorm stuff (furniture, fridge, microwave, decor, bedding)",
  "event or game ticket",
  "something else",
];

export const BLOCK_THRESHOLD = 0.85;
export const WARN_THRESHOLD = 0.6;

export interface GateInput {
  title: string;
  description: string;
  category: string;
  priceCents: number;
  /** Median price of similar listings here, if any. */
  medianCents: number | null;
}

export function gateState(l: GateInput): string {
  return [
    "A student's listing on a university campus marketplace.",
    `Title: ${l.title.slice(0, 200)}`,
    l.description ? `Description: ${l.description.slice(0, 1500)}` : "",
    `Category chosen by the seller: ${l.category}`,
    `Price: $${(l.priceCents / 100).toFixed(2)}`,
    l.medianCents !== null ? `Similar listings here sell for about $${(l.medianCents / 100).toFixed(2)}.` : "",
  ].filter(Boolean).join("\n");
}

export const gateQuestions = (): DecisionQuestion[] => [
  { key: "prohibited", kind: "noul", question: "Is this item prohibited on a university marketplace (weapons, drugs or vapes, alcohol, prescription meds, counterfeit goods, stolen items, exam answers, fake IDs)?" },
  { key: "price_unreasonable", kind: "noul", question: "Is the price unreasonable for this item used (far too high, or suspiciously low like a scam bait)?" },
  { key: "misleading", kind: "noul", question: "Is the title or description misleading, spammy, or not actually selling an item?" },
  { key: "category", kind: "choice", question: "Which category does this item belong in?", options: CATEGORY_LABELS },
];

export interface GateVerdict {
  allowed: boolean;
  /** Human-readable reasons, for the 422 or the seller's warning list. */
  blocked_reasons: string[];
  warnings: string[];
  suggested_category: (typeof CATEGORIES)[number] | null;
  engine: "jev" | "none";
}

export function gateVerdict(d: Decisions | null, l: GateInput): GateVerdict {
  if (!d) return { allowed: true, blocked_reasons: [], warnings: [], suggested_category: null, engine: "none" };
  const blocked = (d.prohibited?.value ?? 0) >= BLOCK_THRESHOLD ? ["This looks like an item that can't be sold on campus"] : [];
  const warnings = [
    ...((d.price_unreasonable?.value ?? 0) >= WARN_THRESHOLD ? [l.medianCents !== null ? `Price looks off: similar items go for about $${(l.medianCents / 100).toFixed(0)}` : "Price looks unusual for this item"] : []),
    ...((d.misleading?.value ?? 0) >= WARN_THRESHOLD ? ["The title or description may be unclear or misleading"] : []),
  ];
  const idx = d.category ? d.category.options.indexOf(d.category.pick) : -1;
  const suggested = idx >= 0 && d.category!.value >= WARN_THRESHOLD ? CATEGORIES[idx]! : null;
  if (suggested && suggested !== l.category) warnings.push(`This looks like it belongs in "${suggested}"`);
  return { allowed: !blocked.length, blocked_reasons: blocked, warnings, suggested_category: suggested, engine: "jev" };
}
