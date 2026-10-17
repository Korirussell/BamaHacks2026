import { zonedToUtc } from "./time.js";

export type CourseEventKind = "exam" | "assignment" | "project" | "quiz";

export interface ParsedSyllabusEvent {
  kind: CourseEventKind;
  title: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Local HH:MM when the syllabus gave one, else null (a default time is used for due_at). */
  time: string | null;
  due_at: string;
  /** The syllabus line it came from, for the review screen. */
  source_line: string;
}

export interface ParsedSyllabus {
  events: ParsedSyllabusEvent[];
}

export interface SyllabusContext {
  /** e.g. "Fall 2026"; its year fills in dates written without one. */
  term: string;
  timezone: string;
  /** Fallback year source when the term has no year. */
  now?: number;
}

/** Turns syllabus text into dated course events. The deterministic parser below implements it; a model-backed adapter can too. */
export interface SyllabusParser {
  parse(text: string, ctx: SyllabusContext): ParsedSyllabus;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Checked in order; the first kind whose pattern matches a line wins.
const KINDS: { kind: CourseEventKind; re: RegExp; label: string }[] = [
  { kind: "exam", re: /\b(final\s+exam(?:ination)?|final(?!\s+(?:grades?|project|paper|presentation|report))|mid-?term(?:\s+exam)?|exam(?:ination)?|test\s*#?\d+)\b/i, label: "Exam" },
  { kind: "quiz", re: /\bquiz(?:zes)?\b/i, label: "Quiz" },
  { kind: "project", re: /\b(project|presentation|paper|essay)\b/i, label: "Project" },
  { kind: "assignment", re: /\b(homework|hw\s*#?\d+|hw|assignment|problem\s+set|pset|lab\s+report)\b/i, label: "Assignment" },
];

const WEEKDAY = String.raw`(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\.?,?\s+`;
const MONTH_DATE = new RegExp(String.raw`\b(?:${WEEKDAY})?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4})\b)?`, "gi");
const NUMERIC_DATE = new RegExp(String.raw`\b(?:${WEEKDAY})?(\d{1,2})/(\d{1,2})(?:/(\d{2}|\d{4}))?\b`, "gi");
const TIME_12H = /\b(\d{1,2})(?::(\d{2}))?\s*(?:[-–]\s*\d{1,2}(?::\d{2})?\s*)?([ap])\.?\s?m\.?(?![a-z])/i;
const TIME_24H = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
const NOON = /\bnoon\b/i;
const MIDNIGHT = /\bmidnight\b/i;
const DUE = /\bdue\b/i;
const EXAM_REVIEW = /\b(?:exam|midterm|final|test)\s*#?\d*\s+review\b/i;

interface DateHit { index: number; length: number; month: number; day: number; year: number | null }

const pad = (n: number) => String(n).padStart(2, "0");

function findDates(line: string): DateHit[] {
  const hits: DateHit[] = [];
  for (const m of line.matchAll(MONTH_DATE)) {
    hits.push({ index: m.index, length: m[0].length, month: MONTHS.indexOf(m[1]!.toLowerCase().slice(0, 3)) + 1, day: Number(m[2]), year: m[3] ? Number(m[3]) : null });
  }
  for (const m of line.matchAll(NUMERIC_DATE)) {
    if (hits.some((h) => m.index < h.index + h.length && h.index < m.index + m[0].length)) continue;
    const y = m[3] ? Number(m[3]) : null;
    hits.push({ index: m.index, length: m[0].length, month: Number(m[1]), day: Number(m[2]), year: y === null ? null : y < 100 ? 2000 + y : y });
  }
  return hits.filter((h) => h.month >= 1 && h.month <= 12 && h.day >= 1 && h.day <= 31).sort((a, b) => a.index - b.index);
}

function findTime(line: string): string | null {
  const t12 = TIME_12H.exec(line);
  if (t12) {
    const h = Number(t12[1]) % 12 + (t12[3]!.toLowerCase() === "p" ? 12 : 0);
    const min = Number(t12[2] ?? 0);
    if (h < 24 && min < 60) return `${pad(h)}:${pad(min)}`;
  }
  if (NOON.test(line)) return "12:00";
  if (MIDNIGHT.test(line)) return "23:59";
  const t24 = TIME_24H.exec(line);
  return t24 ? `${pad(Number(t24[1]))}:${t24[2]}` : null;
}

function termYear(ctx: SyllabusContext): { year: number; fall: boolean } {
  const y = /\b(20\d{2})\b/.exec(ctx.term);
  const year = y ? Number(y[1]) : new Date(ctx.now ?? Date.now()).getUTCFullYear();
  return { year, fall: /\bfall\b/i.test(ctx.term) };
}

function cleanTitle(line: string, dates: DateHit[], label: string): string {
  let s = line;
  for (const d of [...dates].sort((a, b) => b.index - a.index)) s = s.slice(0, d.index) + " " + s.slice(d.index + d.length);
  s = s
    .replace(new RegExp(TIME_12H.source, "gi"), " ")
    .replace(new RegExp(TIME_24H.source, "g"), " ")
    .replace(/\b(?:at|by|on)\s+(?:noon|midnight)\b/gi, " ")
    .replace(/^\s*(?:week|wk)\s*\d+\b/i, " ")
    .replace(/\b(?:due|on|by|at)\b\s*(?=[|:\-–—,]|$)/gi, " ")
    .replace(/[|\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/([:,;])(?:\s*[,;])+/g, "$1")
    .replace(/^[\s:,\-–—.]+|[\s:,\-–—]+$/g, "")
    .trim();
  return (s || label).slice(0, 160);
}

/** Pulls one event per line that names a graded item (exam, quiz, project, homework…) and a date. */
export function parseSyllabusText(text: string, ctx: SyllabusContext): ParsedSyllabus {
  const { year, fall } = termYear(ctx);
  const events: ParsedSyllabusEvent[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const kind = KINDS.find((k) => k.re.test(line));
    if (!kind || (kind.kind === "exam" && EXAM_REVIEW.test(line))) continue;
    const dates = findDates(line);
    if (!dates.length) continue;
    // "assigned Oct 1, due Oct 8" → the date after "due".
    const dueAt = DUE.exec(line)?.index;
    const pick = (dueAt !== undefined ? dates.find((d) => d.index > dueAt) : undefined) ?? dates[0]!;
    // A fall term's January/February dates fall in the next calendar year.
    const y = pick.year ?? (fall && pick.month <= 2 ? year + 1 : year);
    const probe = new Date(Date.UTC(y, pick.month - 1, pick.day));
    if (probe.getUTCMonth() !== pick.month - 1) continue;
    const date = `${y}-${pad(pick.month)}-${pad(pick.day)}`;
    const time = findTime(line);
    const fallbackTime = kind.kind === "exam" || kind.kind === "quiz" ? "08:00" : "23:59";
    const title = cleanTitle(line, dates, kind.label);
    const key = `${kind.kind}|${title.toLowerCase()}|${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({ kind: kind.kind, title, date, time, due_at: new Date(zonedToUtc(date, time ?? fallbackTime, ctx.timezone)).toISOString(), source_line: line });
  }
  return { events: events.sort((a, b) => a.due_at.localeCompare(b.due_at)) };
}

export const textSyllabusParser: SyllabusParser = { parse: parseSyllabusText };

/** PDF rows (cells per line) back to plain lines for the parser. */
export const rowsToText = (rows: string[][]) => rows.map((r) => r.join(" | ")).join("\n");
