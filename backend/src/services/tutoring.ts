import type { LatLng } from "../schemas/common.js";
import { totalMinutes } from "./availability.js";
import { gradePoints, meetsThreshold } from "./grades.js";
import { mutualSlots, type MutualSlot, type Party } from "./slots.js";
import { ApiError } from "../lib/errors.js";
import { iso } from "./time.js";

export interface TutorCandidate {
  userId: string;
  enabled: boolean;
  courseIds: string[];
  hourlyRateCents: number;
  rating: number;
  reviewCount: number;
  sessionsCompleted: number;
  /** The tutor's past record for the requested course. */
  record: { grade: string | null; verified: boolean; term: string } | null;
  party: Party;
}

export interface TutorMatchOut {
  user_id: string;
  grade: string;
  grade_verified: boolean;
  term_taken: string;
  rating: number;
  review_count: number;
  hourly_rate_cents: number;
  mutual_slots: Array<{ start: string; end: string; kind: "free" }>;
  match: { score: number; mutual_minutes: number; reasons: string[] };
}

/** Tutor eligibility + ranking for `GET /tutors` (contract: Tutor eligibility rule). */
export function findTutorMatches(input: {
  courseId: string;
  student: Party & { userId: string };
  candidates: TutorCandidate[];
  minGrade: string;
  meetingPlace: LatLng | null;
  durationMin: number;
  now: number;
  maxRateCents?: number;
  includeUnverified?: boolean;
  sort?: "match" | "rating" | "price" | "grade";
}): TutorMatchOut[] {
  const out: TutorMatchOut[] = [];
  for (const c of input.candidates) {
    if (c.userId === input.student.userId || !c.enabled || !c.courseIds.includes(input.courseId)) continue;
    if (!c.record?.grade || !meetsThreshold(c.record.grade, input.minGrade)) continue;
    if (!c.record.verified && !input.includeUnverified) continue;
    if (input.maxRateCents !== undefined && c.hourlyRateCents > input.maxRateCents) continue;

    const slots: MutualSlot[] = mutualSlots(input.student, c.party, input.meetingPlace, input.durationMin, {
      notBefore: input.now,
    });
    const mutual = totalMinutes(slots);
    const reasons: string[] = [`Got ${c.record.grade} in ${c.record.term}${c.record.verified ? " (verified)" : ""}`];
    if (slots.length) reasons.push(`${slots.length} times you're both free`);
    if (c.reviewCount) reasons.push(`${c.rating.toFixed(1)}★ from ${c.reviewCount} reviews`);

    const score =
      (gradePoints(c.record.grade) ?? 0) * 10 +
      (c.reviewCount ? c.rating * 6 : 15) +
      Math.min(slots.length, 6) * 4 +
      (c.record.verified ? 5 : 0) -
      c.hourlyRateCents / 500;

    out.push({
      user_id: c.userId,
      grade: c.record.grade,
      grade_verified: c.record.verified,
      term_taken: c.record.term,
      rating: c.rating,
      review_count: c.reviewCount,
      hourly_rate_cents: c.hourlyRateCents,
      mutual_slots: slots.map((s) => ({ start: iso(s.start), end: iso(s.end), kind: "free" as const })),
      match: { score: Math.round(score * 10) / 10, mutual_minutes: mutual, reasons },
    });
  }
  const by = {
    match: (x: TutorMatchOut, y: TutorMatchOut) => y.match.score - x.match.score,
    rating: (x: TutorMatchOut, y: TutorMatchOut) => y.rating - x.rating,
    price: (x: TutorMatchOut, y: TutorMatchOut) => x.hourly_rate_cents - y.hourly_rate_cents,
    grade: (x: TutorMatchOut, y: TutorMatchOut) => (gradePoints(y.grade) ?? 0) - (gradePoints(x.grade) ?? 0),
  }[input.sort ?? "match"];
  return out.sort(by);
}

// ---- session proposal state machine ------------------------------------------------------

export type Side = "tutor" | "student";
export type SessionStatus = "requested" | "accepted" | "paid" | "completed" | "cancelled" | "no_show";

export interface SessionState {
  status: SessionStatus;
  waitingOn: Side | null;
  start: string;
  end: string;
  hourlyRateCents: number;
}

export function priceFor(hourlyRateCents: number, start: string, end: string): number {
  const minutes = (Date.parse(end) - Date.parse(start)) / 60_000;
  return Math.round((hourlyRateCents * minutes) / 60);
}

export function counterSession(s: SessionState, by: Side, start: string, end: string): SessionState {
  if (s.status !== "requested") throw new ApiError(409, "INVALID_STATE", `Can't counter a ${s.status} session`);
  if (s.waitingOn !== by) throw new ApiError(409, "INVALID_STATE", "It's the other person's turn");
  if (Date.parse(end) <= Date.parse(start)) throw new ApiError(400, "VALIDATION", "end must be after start");
  return { ...s, start, end, waitingOn: by === "tutor" ? "student" : "tutor" };
}

export function acceptSession(s: SessionState, by: Side): SessionState {
  if (s.status !== "requested") throw new ApiError(409, "INVALID_STATE", `Can't accept a ${s.status} session`);
  if (s.waitingOn !== by) throw new ApiError(409, "INVALID_STATE", "It's the other person's turn");
  return { ...s, status: "accepted", waitingOn: null };
}

export function declineSession(s: SessionState, by: Side): SessionState {
  if (s.status !== "requested") throw new ApiError(409, "INVALID_STATE", `Can't decline a ${s.status} session`);
  if (s.waitingOn !== by) throw new ApiError(409, "INVALID_STATE", "It's the other person's turn");
  return { ...s, status: "cancelled", waitingOn: null };
}

/** Either side can cancel before the session happens. */
export function cancelSession(s: SessionState): SessionState {
  if (s.status !== "requested" && s.status !== "accepted" && s.status !== "paid") {
    throw new ApiError(409, "INVALID_STATE", `Can't cancel a ${s.status} session`);
  }
  return { ...s, status: "cancelled", waitingOn: null };
}

/** Marks a session done once it has started. */
export function completeSession(s: SessionState, now: number): SessionState {
  if (s.status !== "accepted" && s.status !== "paid") throw new ApiError(409, "INVALID_STATE", `Can't complete a ${s.status} session`);
  if (now < Date.parse(s.start)) throw new ApiError(409, "INVALID_STATE", "The session hasn't started yet");
  return { ...s, status: "completed", waitingOn: null };
}

// ---- eligibility -------------------------------------------------------------------------

export interface GradeRecord {
  courseId: string;
  term: string;
  status: "current" | "past" | "planned";
  grade: string | null;
  verified: boolean;
}

export interface Eligibility {
  courseId: string;
  grade: string;
  term: string;
  verified: boolean;
  eligible: boolean;
  reason: string | null;
}

/**
 * Best past grade per course and whether it unlocks tutoring (contract: Tutor eligibility rule).
 * Verified beats unverified, then the higher grade wins.
 */
export function tutorEligibility(records: GradeRecord[], minGrade: string): Map<string, Eligibility> {
  const best = new Map<string, GradeRecord & { grade: string }>();
  for (const r of records) {
    if (r.status !== "past" || !r.grade || gradePoints(r.grade) === null) continue;
    const cur = best.get(r.courseId);
    const better =
      !cur ||
      (r.verified && !cur.verified) ||
      (r.verified === cur.verified && (gradePoints(r.grade) ?? 0) > (gradePoints(cur.grade) ?? 0));
    if (better) best.set(r.courseId, { ...r, grade: r.grade });
  }
  const out = new Map<string, Eligibility>();
  for (const r of best.values()) {
    const meets = meetsThreshold(r.grade, minGrade);
    const reason = !meets ? `Needs ${minGrade} or better` : !r.verified ? "Upload a transcript to verify this grade" : null;
    out.set(r.courseId, { courseId: r.courseId, grade: r.grade, term: r.term, verified: r.verified, eligible: meets && r.verified, reason });
  }
  return out;
}
