// LibCal (Gorgas Team Workrooms) from the command line. See docs/LIBCAL_BOOKING_FLOW.md.
//
//   pnpm libcal browser                     # start the long-running booking Chrome (leave it open)
//   pnpm libcal login                       # sign into UA once in it (Duo once)
//   pnpm libcal rooms 2026-10-18            # free rooms that day (read-only)
//   pnpm libcal book 2026-10-18 15:00 16:00 49271 [group name]   # really books it (one per person per day)
//
// Uses the booking Chrome at LIBCAL_CDP_URL (default http://127.0.0.1:9222) when it's running, else launches
// LIBCAL_PROFILE_DIR (default .libcal-profile) itself (LIBCAL_HEADLESS, default on).

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { bookLibcalRoom, openLibcalLogin } from "../src/adapters/libcal-booker.js";
import { libcalAvailability } from "../src/adapters/libcal.js";
import { zonedToUtc, localTime } from "../src/services/time.js";

const profileDir = process.env.LIBCAL_PROFILE_DIR ?? ".libcal-profile";
const headless = process.env.LIBCAL_HEADLESS !== "off";
const log = (step: string) => console.log(`[libcal ${new Date().toLocaleTimeString()}] ${step}`);
const [command, ...args] = process.argv.slice(2);
const TZ = "America/Chicago";
const cdp = process.env.LIBCAL_CDP_URL || "http://127.0.0.1:9222";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function cdpUp(): Promise<boolean> {
  try {
    return (await fetch(`${cdp}/json/version`, { signal: AbortSignal.timeout(1_500) })).ok;
  } catch {
    return false;
  }
}

async function main(): Promise<number> {
  const cdpUrl = (await cdpUp()) ? cdp : undefined;
  if (command === "browser") {
    if (cdpUrl) {
      log(`booking Chrome already running at ${cdp}`);
      return 0;
    }
    const port = new URL(cdp).port || "9222";
    spawn(CHROME, [`--user-data-dir=${resolve(profileDir)}`, `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", "--no-first-run", "--no-default-browser-check", "https://ua.libcal.com/spaces?lid=214&gid=436"], { detached: true, stdio: "ignore" }).unref();
    for (let i = 0; i < 20 && !(await cdpUp()); i++) await new Promise((r) => setTimeout(r, 500));
    log((await cdpUp()) ? `booking Chrome is up at ${cdp}. Leave it open (minimize it). Next: pnpm libcal login` : "Chrome didn't come up");
    return 0;
  }
  log(cdpUrl ? `using the booking Chrome at ${cdpUrl}` : `no booking Chrome running; launching profile ${profileDir}`);
  if (command === "login") {
    log(await openLibcalLogin({ profileDir, cdpUrl, log }));
    return 0;
  }
  if (command === "rooms" && args[0]) {
    const slots = await libcalAvailability().freeRooms(args[0]);
    for (const s of slots) console.log(`${s.room_id.padEnd(6)} ${s.name.padEnd(28)} ${localTime(Date.parse(s.start), TZ)}-${localTime(Date.parse(s.end), TZ)}`);
    log(`${slots.length} free slots`);
    return 0;
  }
  const [date, from, to, roomId, nick] = args;
  if (command === "book" && date && from && to && roomId) {
    const start = new Date(zonedToUtc(date, from, TZ)).toISOString();
    const end = new Date(zonedToUtc(date, to, TZ)).toISOString();
    const result = await bookLibcalRoom({ profileDir, cdpUrl, headless, log, roomId, start, end, ...(nick ? { nick } : {}) });
    if (result.ok) log(`BOOKED ${result.roomName}\n${result.confirmation}`);
    else log(`NOT BOOKED: ${result.reason}`);
    return result.ok ? 0 : 1;
  }
  console.log("usage: pnpm libcal browser | login | rooms YYYY-MM-DD | book YYYY-MM-DD HH:MM HH:MM <room id> [group name]");
  return 2;
}

process.exitCode = await main();
