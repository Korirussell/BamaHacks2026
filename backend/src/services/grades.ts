const POINTS: Record<string, number> = {
  "A+": 4.3, A: 4.0, "A-": 3.7,
  "B+": 3.3, B: 3.0, "B-": 2.7,
  "C+": 2.3, C: 2.0, "C-": 1.7,
  "D+": 1.3, D: 1.0, "D-": 0.7,
  F: 0,
};

/** Letter grade → points; null for P/W/I or anything we don't rank. */
export function gradePoints(grade: string | null | undefined): number | null {
  if (!grade) return null;
  return POINTS[grade.trim().toUpperCase()] ?? null;
}

export function meetsThreshold(grade: string | null | undefined, minGrade: string): boolean {
  const g = gradePoints(grade);
  const min = gradePoints(minGrade);
  return g !== null && min !== null && g >= min;
}
