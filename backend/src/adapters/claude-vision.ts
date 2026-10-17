import { z } from "zod";
import { normalizeIsbn } from "../services/materials.js";
import type { KnownBook, TextbookGuess, TextbookIdentifier } from "./ports.js";

// Claude vision as the TextbookIdentifier: looks at the post's photos + caption and, when it can,
// picks which of the school's required books it is (so a cover photo with no ISBN still lists).
// Raw fetch to the Messages API with a forced tool call, so the answer is always structured JSON.

const TOOL = {
  name: "record_textbook",
  description: "Record which textbook (if any) this marketplace post is selling.",
  input_schema: {
    type: "object",
    properties: {
      is_textbook: { type: "boolean" },
      known_isbn: { type: ["string", "null"], description: "ISBN from the known-books list if the item is clearly one of them, else null" },
      isbn: { type: ["string", "null"], description: "ISBN printed in the photo or caption, if any" },
      title: { type: "string" },
      authors: { type: "array", items: { type: "string" } },
      edition: { type: ["string", "null"], description: "Edition number only, e.g. \"14\"" },
      price_usd: { type: ["number", "null"], description: "Asking price from the caption, null if none" },
      condition: { type: ["string", "null"], enum: ["new", "like_new", "good", "fair", "poor", null] },
      confidence: { type: "number", description: "0 to 1" },
      evidence: { type: "string", description: "One short sentence: what in the photo/caption identified it" },
    },
    required: ["is_textbook", "known_isbn", "isbn", "title", "authors", "edition", "price_usd", "condition", "confidence", "evidence"],
  },
} as const;

export const Answer = z.object({
  is_textbook: z.boolean(),
  known_isbn: z.string().nullable(),
  isbn: z.string().nullable(),
  title: z.string(),
  authors: z.array(z.string()),
  edition: z.string().nullable(),
  price_usd: z.number().nullable(),
  condition: z.enum(["new", "like_new", "good", "fair", "poor"]).nullable(),
  confidence: z.number(),
  evidence: z.string(),
});
const Reply = z.object({ content: z.array(z.object({ type: z.string(), name: z.string().optional(), input: z.unknown().optional() })) });

export function visionPrompt(caption: string, knownBooks: KnownBook[]): string {
  const books = knownBooks.slice(0, 150).map((b) => `- ${b.isbn}: ${b.title}${b.edition ? `, ${b.edition} ed.` : ""}${b.authors.length ? ` (${b.authors.join(", ")})` : ""}`).join("\n");
  return [
    "A University of Alabama student posted this on Instagram. Work out whether they're selling a textbook and which one.",
    "Read the cover, spine and any barcode/ISBN in the photos, plus the caption. Pull the asking price from the caption.",
    books ? `Books UA classes require this term (use known_isbn only if the cover clearly matches, edition included):\n${books}` : "",
    `Caption:\n"""${caption.slice(0, 2000)}"""`,
  ].filter(Boolean).join("\n\n");
}

/** Turns Claude's answer into a guess, trusting only checksummed ISBNs and known books. */
export function toGuess(a: z.infer<typeof Answer>, knownBooks: KnownBook[], fallback: TextbookGuess): TextbookGuess {
  const known = a.known_isbn ? knownBooks.find((b) => b.isbn === normalizeIsbn(a.known_isbn!)) : undefined;
  const isbn = known?.isbn ?? (a.isbn ? normalizeIsbn(a.isbn) : null) ?? fallback.isbn;
  return {
    isbn: a.is_textbook || fallback.isbn ? isbn : null,
    title: known?.title ?? (a.title || fallback.title),
    authors: known?.authors ?? a.authors,
    edition: known?.edition ?? a.edition ?? fallback.edition,
    priceCents: a.price_usd !== null ? Math.round(a.price_usd * 100) : fallback.priceCents,
    condition: a.condition ?? fallback.condition,
    confidence: Math.max(0, Math.min(1, a.confidence)),
    source: "vision",
    evidence: a.evidence,
  };
}

export function claudeTextbookIdentifier(opts: {
  apiKey: string;
  model: string;
  fallback: TextbookIdentifier;
  fetch?: typeof fetch;
}): TextbookIdentifier {
  const doFetch = opts.fetch ?? fetch;
  return {
    async identify(input) {
      const fallback = await opts.fallback.identify(input);
      const knownBooks = input.knownBooks ?? [];
      try {
        const res = await doFetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal: AbortSignal.timeout(30_000),
          headers: { "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: opts.model,
            max_tokens: 1024,
            tools: [TOOL],
            tool_choice: { type: "tool", name: TOOL.name },
            messages: [{
              role: "user",
              content: [
                ...input.imageUrls.slice(0, 4).map((url) => ({ type: "image", source: { type: "url", url } })),
                { type: "text", text: visionPrompt(input.caption, knownBooks) },
              ],
            }],
          }),
        });
        if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const call = Reply.parse(await res.json()).content.find((c) => c.type === "tool_use" && c.name === TOOL.name);
        return toGuess(Answer.parse(call?.input), knownBooks, fallback);
      } catch (err) {
        console.error("Claude vision failed; using the caption parser", err instanceof Error ? err.message : err);
        return fallback;
      }
    },
  };
}
