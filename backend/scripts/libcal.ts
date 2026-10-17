// LibCal (Gorgas Team Workrooms) from the command line. See docs/LIBCAL_BOOKING_FLOW.md.
//
//   pnpm libcal login                       # sign into UA once in the Chrome window that opens
//   pnpm libcal rooms 2026-10-18            # free rooms that day (read-only)
//   pnpm libcal book 2026-10-18 15:00 16:00 49271 [group name]   # really books it (one per person per day)
//
// Uses LIBCAL_PROFILE_DIR (default .libcal-profile) and LIBCAL_HEADLESS (book only; default on).

import { bookLibcalRoom, openLibcalLogin } from "../src/adapters/libcal-booker.js";
import { libcalAvailability } from "../src/adapters/libcal.js";
import { zonedToUtc, localTime } from "../src/services/time.js";

const profileDir = process.env.LIBCAL_PROFILE_DIR ?? ".libcal-profile";
const headless = process.env.LIBCAL_HEADLESS !== "off";
const log = (step: string) => console.log(`[libcal ${new Date().toLocaleTimeString()}] ${step}`);
const [command, ...args] = process.argv.slice(2);
const TZ = "America/Chicago";

async function main(): Promise<number> {
  if (command === "login") {
    log(`opening Chrome with profile ${profileDir}`);
    log(await openLibcalLogin({ profileDir, log }));
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
    const result = await bookLibcalRoom({ profileDir, headless, log, roomId, start, end, ...(nick ? { nick } : {}) });
    if (result.ok) log(`BOOKED ${result.roomName}\n${result.confirmation}`);
    else log(`NOT BOOKED: ${result.reason}`);
    return result.ok ? 0 : 1;
  }
  console.log("usage: pnpm libcal login | rooms YYYY-MM-DD | book YYYY-MM-DD HH:MM HH:MM <room id> [group name]");
  return 2;
}

process.exitCode = await main();
