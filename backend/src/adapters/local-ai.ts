import { z } from "zod";
import { adminClient } from "../lib/supabase.js";
import { toDecisions, toWire } from "../services/decisions.js";
import { toGuess } from "./claude-vision.js";
import { captionTextbookIdentifier } from "./stubs.js";
import type { Decider, KnownBook, TextbookGuess, TextbookIdentifier } from "./ports.js";

// The laptop AI worker (ai-worker/) as adapters. The API never runs a model: it writes an ai_tasks row,
// the worker on the laptop runs Gemma 4 (vision) or JEV-9B (decisions) and writes the answer back.
// When no worker has checked in lately, run() returns null at once and callers fall back.

export type AiTaskKind = "gemma_vision" | "jev_decide";

export interface AiQueue {
  /** The worker's answer, or null when it's offline, failed, or took longer than `timeoutMs`. */
  run(kind: AiTaskKind, payload: Record<string, unknown>, timeoutMs: number): Promise<unknown | null>;
  /** Whether a worker serving `kind` checked in within the heartbeat window, and which models it runs. */
  status(): Promise<{ online: boolean; kinds: string[]; models: Record<string, unknown>; last_seen_at: string | null }>;
}

const HEARTBEAT_WINDOW_MS = 20_000;
const Task = z.object({ status: z.enum(["queued", "running", "succeeded", "failed"]), result: z.unknown().nullable(), error: z.string().nullable() });
const Worker = z.object({ id: z.string(), kinds: z.array(z.string()), models: z.record(z.string(), z.unknown()), last_seen_at: z.string() });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function supabaseAiQueue(opts: { pollMs?: number; now?: () => number } = {}): AiQueue {
  const pollMs = opts.pollMs ?? 350;
  const now = opts.now ?? Date.now;
  let cached: { at: number; workers: z.infer<typeof Worker>[] } | null = null;

  async function workers() {
    if (cached && now() - cached.at < 3_000) return cached.workers;
    const since = new Date(now() - HEARTBEAT_WINDOW_MS).toISOString();
    const r = await adminClient().from("ai_workers").select("id, kinds, models, last_seen_at").gte("last_seen_at", since);
    const list = r.error ? [] : z.array(Worker).parse(r.data);
    if (r.error) console.error("ai_workers lookup failed", r.error.message);
    cached = { at: now(), workers: list };
    return list;
  }

  return {
    async status() {
      const list = await workers();
      const newest = [...list].sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at))[0];
      return {
        online: list.length > 0,
        kinds: [...new Set(list.flatMap((w) => w.kinds))],
        models: Object.assign({}, ...list.map((w) => w.models)),
        last_seen_at: newest?.last_seen_at ?? null,
      };
    },

    async run(kind, payload, timeoutMs) {
      try {
        if (!(await workers()).some((w) => w.kinds.includes(kind))) return null;
        const db = adminClient();
        const inserted = await db.from("ai_tasks").insert({ kind, payload }).select("id").single();
        if (inserted.error) throw inserted.error;
        const id = (inserted.data as { id: string }).id;
        const deadline = now() + timeoutMs;
        while (now() < deadline) {
          await sleep(pollMs);
          const r = await db.from("ai_tasks").select("status, result, error").eq("id", id).single();
          if (r.error) throw r.error;
          const task = Task.parse(r.data);
          if (task.status === "succeeded") return task.result;
          if (task.status === "failed") {
            console.error(`Local AI ${kind} failed: ${task.error}`);
            return null;
          }
        }
        // Give up, and make sure a late worker doesn't pick it up.
        await db.from("ai_tasks").update({ status: "failed", error: "API stopped waiting" }).eq("id", id).in("status", ["queued", "running"]);
        console.error(`Local AI ${kind} timed out after ${timeoutMs} ms`);
        return null;
      } catch (err) {
        console.error(`Local AI ${kind} errored`, err instanceof Error ? err.message : err);
        return null;
      }
    },
  };
}

/** No worker at all (tests, or AI=off): every call falls back. */
export const offlineAiQueue: AiQueue = {
  run: async () => null,
  status: async () => ({ online: false, kinds: [], models: {}, last_seen_at: null }),
};

// ---------------------------------------------------------------- JEV

const DecideResult = z.object({ answers: z.record(z.string(), z.array(z.number())) });

/** JEV-9B on the laptop. Returns null (→ rules) when the worker is offline or slow. */
export function jevDecider(queue: AiQueue, timeoutMs = 10_000): Decider {
  return {
    async decide(state, questions) {
      if (!questions.length) return {};
      const wire = questions.map(toWire);
      const raw = await queue.run("jev_decide", { state: state.slice(0, 6000), questions: wire }, timeoutMs);
      const parsed = DecideResult.safeParse(raw);
      if (!parsed.success) return null;
      return toDecisions(wire, parsed.data.answers);
    },
  };
}

/** No decision model: callers use their rule-based fallback. */
export const noDecider: Decider = { decide: async () => null };

// ---------------------------------------------------------------- Gemma vision

const CATEGORIES = ["textbook", "lab_supplies", "dorm", "ticket", "other"] as const;

/** JSON schema Ollama constrains Gemma's output to. */
export const ITEM_SCHEMA = {
  type: "object",
  properties: {
    is_textbook: { type: "boolean" },
    known_isbn: { type: ["string", "null"] },
    isbn: { type: ["string", "null"] },
    category: { type: "string", enum: CATEGORIES },
    title: { type: "string" },
    authors: { type: "array", items: { type: "string" } },
    edition: { type: ["string", "null"] },
    price_usd: { type: ["number", "null"] },
    estimated_price_usd: { type: ["number", "null"] },
    price_reason: { type: "string" },
    condition: { anyOf: [{ type: "string", enum: ["new", "like_new", "good", "fair", "poor"] }, { type: "null" }] },
    confidence: { type: "number" },
    evidence: { type: "string" },
  },
  required: ["is_textbook", "known_isbn", "isbn", "category", "title", "authors", "edition", "price_usd", "estimated_price_usd", "price_reason", "condition", "confidence", "evidence"],
  additionalProperties: false,
} as const;

const ItemAnswer = z.object({
  is_textbook: z.boolean(),
  known_isbn: z.string().nullable(),
  isbn: z.string().nullable(),
  category: z.enum(CATEGORIES).catch("other"),
  title: z.string(),
  authors: z.array(z.string()).catch([]),
  edition: z.string().nullable().catch(null),
  price_usd: z.number().nullable().catch(null),
  estimated_price_usd: z.number().nullable().catch(null),
  price_reason: z.string().catch(""),
  condition: z.enum(["new", "like_new", "good", "fair", "poor"]).nullable().catch(null),
  confidence: z.number().catch(0.5),
  evidence: z.string().catch(""),
});

export function itemPrompt(caption: string, knownBooks: KnownBook[]): string {
  const books = knownBooks.slice(0, 120).map((b) => `- ${b.isbn}: ${b.title}${b.edition ? `, ${b.edition} ed.` : ""}`).join("\n");
  return [
    "A University of Alabama student wants to sell what's in these images on a campus marketplace. The images may be photos of the item or a screenshot of an Instagram story / post about it.",
    "Identify the item: a short listing title (brand + model when visible), the category, and its condition from visible wear. If it's a textbook, read the cover, spine and any barcode/ISBN.",
    "price_usd: the asking price written in the screenshot text or caption, else null. estimated_price_usd: what a student would realistically pay for it used on campus, with a one-line price_reason.",
    "Categories: textbook, lab_supplies (lab coats, goggles, calculators, clickers), dorm (furniture, fridges, decor), ticket (game/concert tickets), other.",
    books ? `Books UA classes require this term (set known_isbn only if the cover clearly matches, edition included):\n${books}` : "",
    caption ? `Caption:\n"""${caption.slice(0, 2000)}"""` : "",
    "evidence: one short sentence on what in the image identified it. confidence: 0 to 1.",
  ].filter(Boolean).join("\n\n");
}

/** A vision model's ITEM_SCHEMA answer → a guess (null if it doesn't parse). Shared by Gemma and Claude. */
export function itemGuess(json: unknown, knownBooks: KnownBook[], fallback: TextbookGuess, by: string): TextbookGuess | null {
  const parsed = ItemAnswer.safeParse(json);
  if (!parsed.success) return null;
  const a = parsed.data;
  const guess = toGuess(a, knownBooks, fallback);
  return {
    ...guess,
    evidence: a.evidence ? `${by}: ${a.evidence}` : `Read by ${by}`,
    category: guess.isbn ? "textbook" : a.category === "textbook" ? "other" : a.category,
    estimatedPriceCents: a.estimated_price_usd !== null && a.estimated_price_usd > 0 ? Math.round(a.estimated_price_usd * 100) : null,
    ...(a.price_reason ? { priceReason: a.price_reason } : {}),
  };
}

/** Gemma 4 on the laptop reads any item (not just books) and estimates a price. Falls back when offline. */
export function gemmaIdentifier(opts: { queue: AiQueue; fallback: TextbookIdentifier; timeoutMs?: number }): TextbookIdentifier {
  return {
    async identify(input) {
      // The fallback (Claude, or the caption parser) only runs when Gemma didn't answer.
      if (!input.imageUrls.length && !input.caption.trim()) return opts.fallback.identify(input);
      const knownBooks = input.knownBooks ?? [];
      const raw = await opts.queue.run("gemma_vision", {
        image_urls: input.imageUrls.slice(0, 4),
        prompt: itemPrompt(input.caption, knownBooks),
        schema: ITEM_SCHEMA,
      }, opts.timeoutMs ?? 45_000);
      const guess = raw ? itemGuess((raw as { json?: unknown }).json, knownBooks, await captionTextbookIdentifier.identify(input), "Gemma") : null;
      return guess ?? opts.fallback.identify(input);
    },
  };
}
