import type { Decision, DecisionKind, DecisionQuestion, Decisions } from "../adapters/ports.js";

// Pure halves of JEV's decision mode: the question shapes the worker accepts, and its raw
// probabilities turned into picks and values the product code can branch on.

export const NOUL_OPTIONS = ["false", "true"];
export const SCORE_OPTIONS = ["0", "1", "2", "3", "4", "5"];
const MAX_CHOICES = 16;

export interface WireQuestion {
  key: string;
  kind: DecisionKind;
  question: string;
  options: string[];
}

/** The fixed option lists JEV expects for noul and score; choice keeps 2–16 of its own. */
export function toWire(q: DecisionQuestion): WireQuestion {
  if (q.kind === "noul") return { key: q.key, kind: q.kind, question: q.question, options: NOUL_OPTIONS };
  if (q.kind === "score") return { key: q.key, kind: q.kind, question: q.question, options: SCORE_OPTIONS };
  const options = (q.options ?? []).slice(0, MAX_CHOICES);
  if (options.length < 2) throw new Error(`Choice question "${q.key}" needs at least 2 options`);
  return { key: q.key, kind: q.kind, question: q.question, options };
}

/** Raw per-question probabilities from the worker → Decisions. Questions with a malformed answer are dropped. */
export function toDecisions(questions: WireQuestion[], raw: Record<string, unknown>): Decisions {
  const out: Decisions = {};
  for (const q of questions) {
    const p = raw[q.key];
    if (!Array.isArray(p) || p.length !== q.options.length || !p.every((x) => typeof x === "number" && Number.isFinite(x))) continue;
    const sum = (p as number[]).reduce((a, b) => a + b, 0) || 1;
    const probabilities = (p as number[]).map((x) => x / sum);
    const best = probabilities.indexOf(Math.max(...probabilities));
    const value = q.kind === "noul"
      ? probabilities[1]!
      : q.kind === "score"
        ? probabilities.reduce((acc, x, level) => acc + x * level, 0)
        : probabilities[best]!;
    out[q.key] = { kind: q.kind, options: q.options, probabilities, pick: q.options[best]!, value } satisfies Decision;
  }
  return out;
}

/** P(true) of a noul answer, or null when JEV didn't answer it. */
export const yes = (d: Decisions | null, key: string): number | null => d?.[key]?.kind === "noul" ? d[key]!.value : null;

/** Compact form for API responses and the demo's probability bars. */
export function summarize(d: Decisions): Record<string, { pick: string; value: number; probabilities: Record<string, number> }> {
  return Object.fromEntries(Object.entries(d).map(([key, v]) => [key, {
    pick: v.pick,
    value: Math.round(v.value * 1000) / 1000,
    probabilities: Object.fromEntries(v.options.map((o, i) => [o, Math.round(v.probabilities[i]! * 1000) / 1000])),
  }]));
}
