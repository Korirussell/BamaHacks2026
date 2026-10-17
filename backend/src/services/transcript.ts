// Parses the UA Banner "Academic Transcript" page (myBama → Student Profile → Academic Transcript,
// printed to PDF). Input is the PDF's rows as cells (see services/pdf.ts); output is the contract's
// `parsed` shape plus a little extra the confirm step needs. Pure: no I/O.

export type TranscriptSection = "transfer" | "institution" | "in_progress";

export interface ParsedClass {
  course_code: string;
  title: string;
  credits: number;
  grade: string | null;
  matched_course_id: string | null;
}

export interface ParsedTerm {
  term: string;
  /** Not in the contract response; tells the confirm step (and app) past vs current. */
  section: TranscriptSection;
  classes: ParsedClass[];
}

export interface ParsedTranscript {
  student_name: string | null;
  terms: ParsedTerm[];
  gpa: number | null;
}

export class UnrecognizedTranscriptError extends Error {}

const SUBJECT = /^[A-Z]{1,5}$/;
const NUMBER = /^\d{3}[A-Z]?$/;
const LEVEL = /^(UG|GR|LW|PR|CE|ND)$/;
const DECIMAL = /^\d+\.\d{3}$/;
const GRADE = /^([A-F][+-]?|P|S|U|W|WF|WP|I|IP|NG|NC|CR|AU|T|X)$/;
const TERM = /^(Fall|Spring|Summer|Winter|Interim|May)( Session)? \d{4}$/i;
// Banner page chrome that the PDF repeats on every page.
const isChrome = (cell: string) => cell === "©" || /Ellucian|All rights reserved|^https?:\/\/|^\d+\/\d+$|^\d{1,2}\/\d{1,2}\/\d{2},/.test(cell);

const num = (s: string) => Number.parseFloat(s);

/** Course rows: SUBJ NUM [LEVEL] Title… [GRADE] CREDITS [QUALITY_POINTS] [REPEAT]. */
function parseCourseRow(cells: string[], withGrade: boolean): (ParsedClass & { repeat: string | null }) | null {
  const [subject, number, ...rest] = cells;
  if (!subject || !number || !SUBJECT.test(subject) || !NUMBER.test(number)) return null;
  let i = 0;
  if (rest[i] && LEVEL.test(rest[i]!)) i++;
  // Walk from the right: [repeat] [quality points] credits [grade].
  let end = rest.length;
  let repeat: string | null = null;
  if (end > i && /^[A-Z]$/.test(rest[end - 1]!) && DECIMAL.test(rest[end - 2] ?? "")) repeat = rest[--end]!;
  const decimals: string[] = [];
  while (end > i && DECIMAL.test(rest[end - 1]!)) decimals.unshift(rest[--end]!);
  if (decimals.length === 0) return null;
  let grade: string | null = null;
  if (withGrade) {
    if (end <= i || !GRADE.test(rest[end - 1]!)) return null;
    grade = rest[--end]!;
  }
  const title = rest.slice(i, end).join(" ").trim();
  if (!title) return null;
  return { course_code: `${subject} ${number}`, title, credits: num(decimals[0]!), grade, matched_course_id: null, repeat };
}

export function parseBannerTranscript(rows: string[][]): ParsedTranscript {
  const clean = rows.map((r) => r.map((c) => c.trim()).filter((c) => c && !isChrome(c))).filter((r) => r.length);
  const text = clean.map((r) => r.join(" "));
  if (!text.some((t) => /Academic Transcript/i.test(t)) || !text.some((t) => /^Subject Course/.test(t))) {
    throw new UnrecognizedTranscriptError("Not a Banner academic transcript");
  }

  let studentName: string | null = null;
  let gpa: number | null = null;
  let section: TranscriptSection | null = null;
  let current: ParsedTerm | null = null;
  const terms: ParsedTerm[] = [];

  const openTerm = (label: string, sec: TranscriptSection) => {
    current = terms.find((t) => t.term === label && t.section === sec) ?? null;
    if (!current) {
      current = { term: label, section: sec, classes: [] };
      terms.push(current);
    }
  };

  for (let r = 0; r < clean.length; r++) {
    const row = clean[r]!;
    const line = text[r]!;

    if (line === "Name" && !studentName) {
      studentName = text[r + 1] ?? null;
      continue;
    }
    if (/^Transfer Credit Accepted by Institution/.test(line)) {
      section = "transfer";
      continue;
    }
    if (line === "Institution Credit") {
      section = "institution";
      continue;
    }
    if (/^Course\(s\) in Progress$/.test(line)) {
      section = "in_progress";
      continue;
    }
    if (row[0] === "Total Institution") {
      const last = row[row.length - 1];
      if (last && DECIMAL.test(last)) gpa = num(last);
      continue;
    }

    const termMatch = line.match(/^Term : (.+)$/);
    if (termMatch && section && section !== "transfer") {
      openTerm(termMatch[1]!.trim(), section);
      continue;
    }
    // Transfer blocks: "Adv Place : Advanced Placement", "Spring 2025 : CLEP credit", "Summer 2026 : Jefferson State CC".
    const transferMatch = section === "transfer" ? line.match(/^(.+?) : (.+)$/) : null;
    if (transferMatch && !/^Term$/.test(transferMatch[1]!)) {
      const [, left, right] = transferMatch;
      openTerm(TERM.test(left!.trim()) ? left!.trim() : `Transfer: ${right!.trim()}`, "transfer");
      continue;
    }

    const termNow = current as ParsedTerm | null;
    if (!termNow) continue;
    const course = parseCourseRow(row, termNow.section !== "in_progress");
    if (!course) continue;
    // NG = the zero-credit companion row Banner prints next to the graded one; E = repeat excluded.
    if (course.grade === "NG" || course.repeat === "E") continue;
    const { repeat: _repeat, ...cls } = course;
    termNow.classes.push(cls);
  }

  return { student_name: studentName, terms: terms.filter((t) => t.classes.length), gpa };
}

/** Contract `parsed` shape (drops the internal `section`). */
export const toContractParsed = (p: ParsedTranscript) => ({
  student_name: p.student_name,
  terms: p.terms.map((t) => ({ term: t.term, classes: t.classes })),
  gpa: p.gpa,
});
