// "Hey buyer, you're in class B, and class B needs this textbook."

export interface StudentClass {
  userId: string;
  courseId: string;
  status: "current" | "past" | "planned";
}

export interface MaterialMatch {
  userId: string;
  courseId: string;
}

/**
 * Students who should hear about a listing: anyone currently in (or planning) a course that
 * requires the item, excluding the seller. One match per student (first course wins).
 */
export function interestedStudents(input: {
  requiredByCourseIds: string[];
  classes: StudentClass[];
  sellerUserId: string | null;
}): MaterialMatch[] {
  const required = new Set(input.requiredByCourseIds);
  const seen = new Set<string>();
  const out: MaterialMatch[] = [];
  for (const c of input.classes) {
    if (c.status === "past" || !required.has(c.courseId)) continue;
    if (c.userId === input.sellerUserId || seen.has(c.userId)) continue;
    seen.add(c.userId);
    out.push({ userId: c.userId, courseId: c.courseId });
  }
  return out;
}

/** Normalize ISBN-10/13 to ISBN-13 digits; null if invalid. */
export function normalizeIsbn(raw: string): string | null {
  const s = raw.replace(/[^0-9Xx]/g, "").toUpperCase();
  if (s.length === 13 && /^\d{13}$/.test(s)) {
    const sum = [...s.slice(0, 12)].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === Number(s[12]) ? s : null;
  }
  if (s.length === 10 && /^\d{9}[\dX]$/.test(s)) {
    const sum = [...s].reduce((acc, d, i) => acc + (d === "X" ? 10 : Number(d)) * (10 - i), 0);
    if (sum % 11 !== 0) return null;
    const core = "978" + s.slice(0, 9);
    const check = (10 - ([...core].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0) % 10)) % 10;
    return core + check;
  }
  return null;
}
