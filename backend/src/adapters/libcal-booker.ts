import { chromium, type Locator, type Page, type Response } from "playwright-core";
import { localDate, localTime } from "../services/time.js";
import type { RoomBooker } from "./ports.js";

// ROOM_BOOKER=playwright: books a Gorgas Team Workroom on ua.libcal.com by driving the installed Chrome with a
// profile that a person signed into UA SSO once. We never see or store a password.
// Preferred: a long-running "booking Chrome" (`pnpm libcal browser`, LIBCAL_CDP_URL) that we attach to over CDP, so
// the UA session (browser-session cookies) survives between bookings and nobody re-does Duo. Chrome won't expose
// the everyday profile this way (136+), so it's a separate profile. Without LIBCAL_CDP_URL we launch the profile
// ourselves, which loses session cookies on close.
// The flow is mapped step by step in docs/LIBCAL_BOOKING_FLOW.md. LibCal allows one Team Workroom booking per
// patron per day, and the patron is whoever signed into the profile.

const BASE = "https://ua.libcal.com";
const GRID_URL = `${BASE}/spaces?lid=214&gid=436`;
const TZ = "America/Chicago";
const STEP_TIMEOUT_MS = 15_000;
const MAX_NEXT_CLICKS = 14; // LibCal books at most two weeks ahead

export type BookAttempt =
  | { ok: true; roomName: string; confirmation: string }
  | { ok: false; reason: string; needsLogin?: true };

export interface LibcalBrowserOptions {
  profileDir: string;
  /** e.g. http://127.0.0.1:9222: attach to the running booking Chrome instead of launching one. */
  cdpUrl?: string | undefined;
  headless?: boolean;
  log?: (step: string) => void;
}

/** The grid's column key for an instant: the hour header's data-date, e.g. "2026-10-18T15:00:00" (Chicago wall clock). */
export function gridColumnKey(utcMs: number): string {
  return `${localDate(utcMs, TZ)}T${localTime(utcMs, TZ).slice(0, 2)}:00:00`;
}

/** The first allowed end time at or after `want` (values sort as text), so the room covers the whole session. */
export function pickEndOption(options: string[], want: string): string | null {
  return options.filter((o) => o >= want).sort()[0] ?? null;
}

/** The end-time option LibCal puts in `bookingend_1`, e.g. "2026-10-18 16:00:00". */
export function endOptionValue(utcMs: number): string {
  return `${localDate(utcMs, TZ)} ${localTime(utcMs, TZ)}:00`;
}

/** The checkout endpoint's error body is a bit of HTML like "<p>Room: Sorry, this exceeds ...</p>". */
export function checkoutError(body: string): string {
  const text = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text || "LibCal didn't accept the booking";
}

/** Runs `fn` in a fresh tab: in the running booking Chrome (CDP), or in a Chrome we launch on the profile. */
async function withPage<T>(opts: LibcalBrowserOptions & { visible?: boolean }, fn: (page: Page) => Promise<T>): Promise<T> {
  if (opts.cdpUrl) {
    const browser = await chromium.connectOverCDP(opts.cdpUrl, { timeout: STEP_TIMEOUT_MS });
    const context = browser.contexts()[0];
    if (!context) throw new Error("The booking Chrome has no window open");
    const page = await context.newPage();
    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => undefined);
      await browser.close().catch(() => undefined); // disconnects; the booking Chrome keeps running
    }
  }
  const context = await chromium.launchPersistentContext(opts.profileDir, {
    channel: "chrome", headless: !opts.visible && (opts.headless ?? true), viewport: { width: 1400, height: 900 },
  });
  try {
    return await fn(context.pages()[0] ?? (await context.newPage()));
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * Clicks and waits for the response ending in `path`. Both are awaited together: a lone waitForResponse that
 * times out while the click is still pending is an unhandled rejection, and that kills the whole API process.
 */
async function clickAndWait(page: Page, target: Locator, path: string): Promise<Response> {
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith(path), { timeout: STEP_TIMEOUT_MS }),
    target.click({ timeout: STEP_TIMEOUT_MS }),
  ]);
  return res;
}

const onLibcal = (page: Page) => new URL(page.url()).host === new URL(BASE).host;

/**
 * Opens a visible Chrome and walks to UA's sign-in: it holds the first free slot and clicks Submit Times, which
 * sends LibCal to SSO. A person signs in by hand; once LibCal is back, it releases the held slot and closes.
 * Nothing gets booked.
 */
export async function openLibcalLogin(opts: LibcalBrowserOptions & { timeoutMs?: number }): Promise<"signed_in" | "already_signed_in"> {
  const log = opts.log ?? (() => undefined);
  return withPage({ ...opts, visible: true }, async (page) => {
    await page.bringToFront();
    await page.goto(GRID_URL);
    await page.waitForSelector("a.s-lc-eq-avail", { timeout: STEP_TIMEOUT_MS });
    await clickAndWait(page, page.locator("a.s-lc-eq-avail").first(), "/spaces/availability/booking/add");
    await page.click("#submit_times");
    await page.waitForURL((url) => url.pathname === "/spaces/auth" || url.host !== new URL(BASE).host, { timeout: STEP_TIMEOUT_MS });
    const already = onLibcal(page);
    if (!already) {
      log("Sign into UA in the Chrome window (tick Duo's \"remember me\"). It goes on by itself once you're back on LibCal.");
      await page.waitForURL((url) => url.host === new URL(BASE).host && url.pathname === "/spaces/auth", { timeout: opts.timeoutMs ?? 5 * 60_000 });
    }
    log("Signed in; releasing the slot held for sign-in");
    await page.getByRole("button", { name: "Remove" }).first().click({ timeout: STEP_TIMEOUT_MS }).catch(() => undefined);
    await page.waitForTimeout(1_000);
    return already ? "already_signed_in" : "signed_in";
  });
}

/** Marks the free cell for `roomId` that spans `offset` (0-1) into the hour `column`, with data-bh-target. False when that time isn't free. */
async function markCell(page: Page, roomId: string, column: string, offset: number): Promise<boolean> {
  const header = page.locator(`th[data-date="${column}"]`);
  if (!(await header.count())) return false;
  // The header and the lanes scroll together but animate, so measure only after the scroll has settled.
  await header.evaluate((th) => th.scrollIntoView({ inline: "center", block: "nearest" }));
  await page.waitForTimeout(500);
  return page.evaluate(({ roomId, column, offset }) => {
    document.querySelectorAll("[data-bh-target]").forEach((e) => e.removeAttribute("data-bh-target"));
    const th = document.querySelector<HTMLElement>(`th[data-date="${column}"]`);
    const lane = document.querySelector<HTMLElement>(`td.fc-timeline-lane[data-resource-id="eid_${roomId}"]`);
    if (!th || !lane) return false;
    const box = th.getBoundingClientRect();
    const left = box.left + box.width * offset;
    // Cells needn't line up with the hour headers (some rooms run 11:30-12:30), so take the one spanning the start.
    const cell = [...lane.querySelectorAll<HTMLElement>("a.s-lc-eq-avail")].find((a) => {
      const r = a.getBoundingClientRect();
      return r.left - 2 <= left && left < r.right - 2;
    });
    if (!cell) return false;
    cell.setAttribute("data-bh-target", "1");
    return true;
  }, { roomId, column, offset });
}

/** Pages the grid forward until `day` (YYYY-MM-DD) is on screen. */
async function showDay(page: Page, day: string): Promise<boolean> {
  for (let i = 0; i <= MAX_NEXT_CLICKS; i++) {
    if (await page.locator(`th[data-date^="${day}T"]`).count()) return true;
    await clickAndWait(page, page.locator("button.fc-next-button"), "/spaces/availability/grid");
  }
  return false;
}

async function bookOnPage(page: Page, input: { roomId: string; start: string; end: string; nick?: string }, log: (s: string) => void): Promise<BookAttempt> {
  const startMs = Date.parse(input.start);
  const endMs = Date.parse(input.end);
  const column = gridColumnKey(startMs);
  const offset = (startMs % 3_600_000) / 3_600_000; // how far into the hour column the session starts

  log(`1. open the Team Workrooms grid`);
  await page.goto(GRID_URL);
  await page.waitForSelector("a.s-lc-eq-avail", { timeout: STEP_TIMEOUT_MS });
  if (!(await showDay(page, column.slice(0, 10)))) return { ok: false, reason: `LibCal doesn't show ${column.slice(0, 10)} yet` };

  log(`2. pick room ${input.roomId} at ${localTime(startMs, TZ)} (${column.slice(0, 10)})`);
  if (!(await markCell(page, input.roomId, column, offset))) return { ok: false, reason: "That room isn't free then anymore" };
  if (!(await clickAndWait(page, page.locator("[data-bh-target]"), "/spaces/availability/booking/add")).ok()) return { ok: false, reason: "LibCal wouldn't hold that slot" };

  const endSelect = page.locator('#s-lc-eq-form-times select[name^="bookingend_"]').first(); // bookingend_<cart id>
  await endSelect.waitFor({ timeout: STEP_TIMEOUT_MS });
  const want = endOptionValue(endMs);
  const end = pickEndOption(await endSelect.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)), want);
  if (end) {
    log(`2b. end time ${end}`);
    await endSelect.selectOption(end);
  } else {
    log(`2b. no end time reaches ${want}; keeping LibCal's default`);
  }

  log(`3. Submit Times`);
  await page.click("#submit_times");
  await page.waitForURL((url) => url.pathname === "/spaces/auth" || url.host !== new URL(BASE).host, { timeout: STEP_TIMEOUT_MS });
  if (!onLibcal(page)) return { ok: false, reason: "The UA sign-in expired. Run `pnpm libcal login`", needsLogin: true };

  log(`4. accept the workroom terms`);
  const terms = page.locator("#terms_accept");
  if (await terms.isVisible()) await terms.click();

  log(`5. booking form`);
  await page.waitForSelector("#btn-form-submit", { state: "visible", timeout: STEP_TIMEOUT_MS });
  if (input.nick) await page.fill('#s-lc-eq-bform input[name="nick"]', input.nick);

  log(`6. Submit my Booking`);
  const res = await clickAndWait(page, page.locator("#btn-form-submit"), "/ajax/equipment/checkout");
  if (!res.ok()) {
    const reason = checkoutError(await res.text());
    log(`6. refused: ${reason}; releasing the held slot`);
    await page.getByRole("button", { name: "Remove" }).first().click().catch(() => undefined);
    return { ok: false, reason };
  }

  log(`7. confirmation`);
  await page.getByText("Booking Confirmed").first().waitFor({ timeout: STEP_TIMEOUT_MS });
  const confirmation = (await page.locator("main").innerText()).replace(/\s+/g, " ").trim();
  const roomName = confirmation.match(/Space:\s*(.+?)\s+Date:/)?.[1] ?? `Room ${input.roomId}`;
  return { ok: true, roomName, confirmation };
}

/** Books one room on LibCal. Never throws: a failure comes back as { ok: false, reason }. */
export async function bookLibcalRoom(opts: LibcalBrowserOptions & { roomId: string; start: string; end: string; nick?: string }): Promise<BookAttempt> {
  const log = opts.log ?? (() => undefined);
  try {
    return await withPage(opts, (page) => bookOnPage(page, opts, log));
  } catch (err) {
    return { ok: false, reason: `Couldn't finish the LibCal booking: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` };
  }
}

/**
 * RoomBooker that really books the free room, one booking at a time (the profile can only be open once).
 * Without a room, or when LibCal refuses, it falls back (normally to the manual link).
 */
export function libcalPlaywrightBooker(opts: LibcalBrowserOptions & { fallback: RoomBooker }): RoomBooker {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    book(input) {
      const { room } = input;
      if (!room) return opts.fallback.book(input);
      const run = queue.then(async () => {
        const attempt = await bookLibcalRoom({ ...opts, roomId: room.room_id, start: input.start, end: input.end });
        if (attempt.ok) return { status: "booked" as const, room: { id: room.room_id, name: attempt.roomName }, bookingUrl: room.book_url };
        console.warn(`LibCal booking failed (${attempt.reason}); sending people to the room's page instead`);
        return opts.fallback.book(input);
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
