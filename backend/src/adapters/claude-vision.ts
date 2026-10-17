import { z } from "zod";
import { normalizeIsbn } from "../services/materials.js";
import { ITEM_SCHEMA, itemGuess, itemPrompt } from "./local-ai.js";
import type { KnownBook, TextbookGuess, TextbookIdentifier } from "./ports.js";

// Claude vision as the TextbookIdentifier: reads the post's photos + caption (any item, not just books),
// picks which of the school's required books it is when it's a textbook, and estimates a resale price.
// Raw fetch to the Messages API with structured outputs (output_config.format), so the reply is schema-valid
// JSON. Shares ITEM_SCHEMA / itemPrompt with the Gemma adapter. (Forced tool_choice 400s on current models.)

const Answer = z.object({
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
const Reply = z.object({ stop_reason: z.string().nullable().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })) });

/** Turns Claude's answer into a guess, trusting only checksummed ISBNs and known books. */
export function toGuess(a: Pick<z.infer<typeof Answer>, "is_textbook" | "known_isbn" | "isbn" | "title" | "authors" | "edition" | "price_usd" | "condition" | "confidence" | "evidence">, knownBooks: KnownBook[], fallback: TextbookGuess): TextbookGuess {
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
            max_tokens: 4096,
            output_config: { effort: "low", format: { type: "json_schema", schema: ITEM_SCHEMA } },
            messages: [{
              role: "user",
              content: [
                ...input.imageUrls.slice(0, 4).map((url) => ({ type: "image", source: { type: "url", url } })),
                { type: "text", text: itemPrompt(input.caption, knownBooks) },
              ],
            }],
          }),
        });
        if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const reply = Reply.parse(await res.json());
        if (reply.stop_reason === "refusal") throw new Error("Claude declined to read this image");
        const text = reply.content.find((c) => c.type === "text")?.text ?? "";
        const guess = itemGuess(JSON.parse(text), knownBooks, fallback, "Claude");
        if (!guess) throw new Error("Claude's answer didn't match the schema");
        return guess;
      } catch (err) {
        console.error("Claude vision failed; using the caption parser", err instanceof Error ? err.message : err);
        return fallback;
      }
    },
  };
}
