// Response envelopes from docs/API_CONTRACT.md → Conventions.
export const one = <T>(data: T) => ({ data });
export const page = <T>(data: T[], nextCursor?: string) => ({
  data,
  next_cursor: nextCursor ?? null,
});

// Offset cursor over an already-sorted in-memory list.
export function paginate<T>(items: T[], cursor: string | undefined, limit: number) {
  const offset = cursor ? Number(Buffer.from(cursor, "base64url").toString()) || 0 : 0;
  const slice = items.slice(offset, offset + limit);
  const next = offset + limit < items.length ? Buffer.from(String(offset + limit)).toString("base64url") : undefined;
  return page(slice, next);
}
