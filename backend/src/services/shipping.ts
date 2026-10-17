import { randomInt } from "node:crypto";
import type { LatLng } from "../schemas/common.js";
import { ApiError } from "../lib/errors.js";
import { withinRadius } from "./geo.js";
import { addDays, localDate, localTime, weekdayOf, zonedToUtc, type Weekday } from "./time.js";

// UA Campus Mail (campusmail.ua.edu, Student Mail Portal on myBama):
// - Every student has a permanent 6-digit mailstop code (MSC); packages are matched by name + MSC.
// - Student packages must arrive through USPS (or another carrier), so the seller ships at the
//   Crimson Mail & Shipping window in the Student Center; Campus Mail then puts it in the
//   buyer's locker. Items handed in after 3:00 pm enter the mail stream the next business day.
// - Lockers hold a package 3–5 days, then the Service Center holds it 10 more before returning it.

/** Days after the package enters the mail stream before the order completes on its own. */
export const MAIL_AUTO_COMPLETE_DAYS = 7;
/** Hand-offs after this local time count from the next business day. */
export const MAIL_STREAM_CUTOFF = "15:00";

/** UA's official campus mailing address for students (same for every carrier). */
export const UA_CAMPUS_MAIL_ADDRESS = { street: "1831 UNIVERSITY STATION", cityStateZip: "TUSCALOOSA, AL 35487-0002" } as const;

/** "123456", "MSC 123456", "msc# 123 456" → "123456"; anything that isn't 6 digits → null. */
export function normalizeMsc(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/^\s*msc\s*#?\s*/i, "").replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** Address block exactly as the Student Mail Portal shows it. */
export function campusAddressLines(name: string, msc: string): string[] {
  return [name.trim().toUpperCase(), UA_CAMPUS_MAIL_ADDRESS.street, `MSC ${msc}`, UA_CAMPUS_MAIL_ADDRESS.cityStateZip];
}

export interface OpeningHours {
  days: Weekday[];
  open: string; // HH:MM local
  close: string;
}

/** Whether a drop-off point is open at `now` (local time in `tz`). */
export function isOpen(hours: OpeningHours[], now: number, tz: string): boolean {
  const day = weekdayOf(localDate(now, tz));
  const time = localTime(now, tz);
  return hours.some((h) => h.days.includes(day) && time >= h.open && time < h.close);
}

/** Local date the package enters the mail stream: today before the cutoff on an open day, else the next open day. */
export function mailStreamDate(hours: OpeningHours[], now: number, tz: string, cutoff = MAIL_STREAM_CUTOFF): string {
  const today = localDate(now, tz);
  const openDays = new Set(hours.flatMap((h) => h.days));
  if (openDays.has(weekdayOf(today)) && localTime(now, tz) < cutoff) return today;
  for (let i = 1; i <= 14; i++) {
    const d = addDays(today, i);
    if (openDays.size === 0 || openDays.has(weekdayOf(d))) return d;
  }
  return addDays(today, 1);
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

/** Short code printed on the label as text + QR; the buyer scans/types it on receipt. */
export function newLabelCode(): string {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

export interface LabelData {
  order_id: string;
  label_code: string;
  to: { name: string; mail_stop_code: string };
  /** Printed on the package: name, 1831 University Station, MSC, city/state/ZIP. */
  address_lines: string[];
  from: { name: string };
  item_title: string;
  drop_off: { name: string; instructions: string };
}

export function buildLabel(input: {
  orderId: string;
  buyer: { name: string; mailStopCode: string | null };
  sellerName: string;
  itemTitle: string;
  dropOff: { name: string; instructions: string };
}): LabelData {
  if (!/\S+\s+\S+/.test(input.buyer.name.trim())) {
    throw new ApiError(409, "MAIL_INFO_REQUIRED", "The buyer hasn't added their first and last name for campus mail yet");
  }
  const msc = normalizeMsc(input.buyer.mailStopCode);
  if (!msc) {
    throw new ApiError(409, "MAIL_INFO_REQUIRED", "The buyer hasn't added their 6-digit campus mail stop (MSC) yet");
  }
  return {
    order_id: input.orderId,
    label_code: newLabelCode(),
    to: { name: input.buyer.name, mail_stop_code: msc },
    address_lines: campusAddressLines(input.buyer.name, msc),
    from: { name: input.sellerName },
    item_title: input.itemTitle,
    drop_off: input.dropOff,
  };
}

/** Drop-off proof: seller is inside the drop-off point's radius and attached a photo. */
export function verifyDropOff(input: {
  status: "label_created" | "dropped_off" | "received";
  at: LatLng;
  accuracyM: number;
  point: { location: LatLng; radiusM: number; hours?: OpeningHours[]; name?: string };
  photoMediaId: string | null;
  now: number;
  /** School timezone; with point.hours, enforces opening hours and the 3 pm cutoff. */
  tz?: string;
}) {
  if (input.status !== "label_created") throw new ApiError(409, "INVALID_STATE", `Shipment is ${input.status}`);
  if (!input.photoMediaId) throw new ApiError(400, "VALIDATION", "Add a photo of the package", { photo_media_id: "Required" });
  if (!withinRadius(input.at, input.point.location, input.point.radiusM, input.accuracyM)) {
    throw new ApiError(403, "NOT_NEARBY", "You need to be at the drop-off point");
  }
  const hours = input.point.hours;
  if (hours?.length && input.tz && !isOpen(hours, input.now, input.tz)) {
    throw new ApiError(409, "INVALID_STATE", `${input.point.name ?? "The drop-off point"} is closed right now`);
  }
  const autoCompleteAt = hours?.length && input.tz
    ? zonedToUtc(addDays(mailStreamDate(hours, input.now, input.tz), MAIL_AUTO_COMPLETE_DAYS), MAIL_STREAM_CUTOFF, input.tz)
    : input.now + MAIL_AUTO_COMPLETE_DAYS * 86_400_000;
  return {
    status: "dropped_off" as const,
    dropped_off_at: new Date(input.now).toISOString(),
    auto_complete_at: new Date(autoCompleteAt).toISOString(),
  };
}

export function verifyReceived(input: { status: string; expectedCode: string; givenCode: string }) {
  if (input.status !== "dropped_off") throw new ApiError(409, "INVALID_STATE", `Shipment is ${input.status}`);
  if (input.givenCode.trim().toUpperCase() !== input.expectedCode) {
    throw new ApiError(400, "VALIDATION", "That code doesn't match this package", { label_code: "Check the label" });
  }
  return { status: "received" as const };
}

/** What the seller does with the package, in order. Shown in the app next to the address block. */
export function dropOffSteps(input: { labelCode: string; dropOffName: string; hours: OpeningHours[]; cutoff?: string }): string[] {
  const cutoff = input.cutoff ?? MAIL_STREAM_CUTOFF;
  const hours = input.hours.map((h) => `${dayRange(h.days)} ${to12h(h.open)}–${to12h(h.close)}`).join(", ");
  return [
    "Write or print the address block on the top of the package (or tape the printed label on).",
    `Write the code ${input.labelCode} on the package too; the buyer types it in when they pick it up.`,
    `Take it to ${input.dropOffName}${hours ? ` (${hours})` : ""} and pay the USPS postage at the window.`,
    `Packages handed in after ${to12h(cutoff)} go out the next business day.`,
    "Still at the window, tap \"Dropped off\" in the app and take a photo of the package.",
  ];
}

const DAY_NAMES: Record<Weekday, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const ORDER: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
function dayRange(days: Weekday[]): string {
  const sorted = ORDER.filter((d) => days.includes(d));
  const contiguous = sorted.every((d, i) => i === 0 || ORDER.indexOf(d) === ORDER.indexOf(sorted[i - 1]!) + 1);
  return contiguous && sorted.length > 2 ? `${DAY_NAMES[sorted[0]!]}–${DAY_NAMES[sorted[sorted.length - 1]!]}` : sorted.map((d) => DAY_NAMES[d]).join("/");
}
function to12h(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, "0")} ${suffix}` : `${hour} ${suffix}`;
}
