const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Real Google Calendar template link (features-v2 §1). 15-minute event. */
export function googleCalendarUrl({ title, startIso, place, details }: { title: string; startIso: string; place: string; details?: string }) {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + 15 * 60_000);
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${fmt(start)}/${fmt(end)}`,
    location: `${place}, University of Alabama, Tuscaloosa, AL`,
    details: details ?? 'Made with Handoff. Money is held until it\'s in your hands.',
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
