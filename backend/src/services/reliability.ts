// Placeholder rule (contract: Reliability). Tune once real handoff data exists.
export function reliability(completed: number, noShows: number) {
  const total = completed + noShows;
  const score = total === 0 ? 0 : Math.round((100 * completed) / total);
  const badge: "new" | "reliable" | "top" =
    completed < 3 ? "new" : completed >= 10 && score >= 95 ? "top" : score >= 80 ? "reliable" : "new";
  return { score, completed, no_shows: noShows, badge };
}
