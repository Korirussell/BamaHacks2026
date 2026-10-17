import type { ExternalPost, TextbookGuess } from "../adapters/ports.js";
import { normalizeIsbn } from "./materials.js";

/** A course_materials row for the identified ISBN. */
export interface KnownMaterial {
  courseId: string;
  title: string;
  authors: string[];
  edition: string | null;
}

export interface IngestDraft {
  category: NonNullable<TextbookGuess["category"]>;
  status: "active" | "draft";
  title: string;
  description: string;
  priceCents: number;
  condition: "new" | "like_new" | "good" | "fair" | "poor";
  isbn: string | null;
  textbookTitle: string | null;
  authors: string[];
  edition: string | null;
  courseIds: string[];
  externalHandle: string;
  externalProfileUrl: string | null;
  /** Why it stayed a draft, when it did. */
  missing: string[];
}

/** "@Bama_Books " → "bama_books" (how listings.external_handle is stored). */
export const normalizeHandle = (raw: string) => raw.trim().replace(/^@+/, "").toLowerCase();

const PROFILE_URL: Record<ExternalPost["channel"], ((h: string) => string) | null> = {
  instagram: (h) => `https://www.instagram.com/${h}/`,
  facebook: null,
  groupme: null,
  snapchat: (h) => `https://www.snapchat.com/add/${h}`,
};

/**
 * Turns an external post + what the identifier saw into a listing draft. The bookstore record
 * (course_materials) wins over the guess for title/authors/edition, since it's the canonical book.
 * Only a known ISBN with a price goes live; anything else waits as a draft for a human.
 */
export function draftFromPost(
  post: Pick<ExternalPost, "channel" | "authorHandle" | "caption">,
  guess: TextbookGuess,
  materialsFor: (isbn: string) => KnownMaterial[],
): IngestDraft {
  const isbn = guess.isbn ? normalizeIsbn(guess.isbn) : null;
  const materials = isbn ? materialsFor(isbn) : [];
  const known = materials[0];
  const handle = normalizeHandle(post.authorHandle);
  // Gemma can name non-book items (a fridge in a story); those list without an ISBN. Books still need one.
  const category = isbn ? "textbook" : guess.category && guess.category !== "textbook" && guess.confidence >= 0.5 ? guess.category : "other";
  const needsIsbn = !isbn && category === "other";
  const missing = [...(needsIsbn ? ["isbn"] : []), ...(guess.priceCents === null ? ["price"] : [])];
  const title = known?.title ?? guess.title;
  return {
    category,
    status: missing.length ? "draft" : "active",
    title: known?.edition ? `${known.title} (${known.edition} ed.)` : title,
    description: post.caption.trim(),
    priceCents: guess.priceCents ?? 0,
    condition: guess.condition ?? "good",
    isbn,
    textbookTitle: isbn ? title : null,
    authors: known?.authors ?? guess.authors,
    edition: known?.edition ?? guess.edition,
    courseIds: [...new Set(materials.map((m) => m.courseId))],
    externalHandle: handle,
    externalProfileUrl: PROFILE_URL[post.channel]?.(handle) ?? null,
    missing,
  };
}
