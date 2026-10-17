import { z } from "zod";
import { Answer, toGuess, visionPrompt } from "./claude-vision.js";
import type { TextbookIdentifier } from "./ports.js";

// Gemini vision as the TextbookIdentifier: same prompt and answer as Claude vision. Gemini can't
// fetch image URLs itself, so the photos go inline as base64. Busy models (429/503) fall through
// to the next one in the list; if every one fails, the caption parser's guess stands.

const SHAPE = [
  "Answer with one JSON object and nothing else, with exactly these keys:",
  '{"is_textbook": boolean, "known_isbn": string|null, "isbn": string|null, "title": string, "authors": string[],',
  '"edition": string|null (number only, e.g. "14"), "price_usd": number|null, "condition": "new"|"like_new"|"good"|"fair"|"poor"|null,',
  '"confidence": number 0-1, "evidence": string (one short sentence)}',
].join("\n");

const Reply = z.object({
  candidates: z.array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }) })).min(1),
});

const MAX_IMAGE_BYTES = 5_000_000;

async function inlineImage(doFetch: typeof fetch, url: string) {
  const res = await doFetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
  const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  return { inline_data: { mime_type: mime, data: bytes.toString("base64") } };
}

export function geminiTextbookIdentifier(opts: {
  apiKey: string;
  models: string[];
  fallback: TextbookIdentifier;
  fetch?: typeof fetch;
}): TextbookIdentifier {
  const doFetch = opts.fetch ?? fetch;
  return {
    async identify(input) {
      const fallback = await opts.fallback.identify(input);
      const knownBooks = input.knownBooks ?? [];
      try {
        const images = (await Promise.all(input.imageUrls.slice(0, 4).map((u) => inlineImage(doFetch, u).catch(() => null))))
          .filter((p): p is NonNullable<typeof p> => p !== null);
        const body = JSON.stringify({
          contents: [{ role: "user", parts: [...images, { text: `${visionPrompt(input.caption, knownBooks)}\n\n${SHAPE}` }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        });
        let lastError = "no model configured";
        for (const model of opts.models) {
          const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: "POST",
            signal: AbortSignal.timeout(45_000),
            headers: { "x-goog-api-key": opts.apiKey, "content-type": "application/json" },
            body,
          });
          if (res.status === 429 || res.status === 503) { lastError = `${model} busy (${res.status})`; continue; }
          if (!res.ok) throw new Error(`Gemini ${model} ${res.status}: ${(await res.text()).slice(0, 300)}`);
          const text = Reply.parse(await res.json()).candidates[0]!.content.parts.map((p) => p.text ?? "").join("");
          const json: unknown = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
          return toGuess(Answer.parse(json), knownBooks, fallback);
        }
        throw new Error(lastError);
      } catch (err) {
        console.error("Gemini vision failed; using the caption parser", err instanceof Error ? err.message : err);
        return fallback;
      }
    },
  };
}
