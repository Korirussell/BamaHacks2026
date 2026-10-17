// Response envelopes from docs/API_CONTRACT.md → Conventions.
export const one = <T>(data: T) => ({ data });
export const page = <T>(data: T[], nextCursor?: string) => ({
  data,
  next_cursor: nextCursor ?? null,
});
