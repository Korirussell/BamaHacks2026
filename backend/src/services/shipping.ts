import { randomInt } from "node:crypto";
import type { LatLng } from "../schemas/common.js";
import { ApiError } from "../lib/errors.js";
import { withinRadius } from "./geo.js";

export const MAIL_AUTO_COMPLETE_DAYS = 5; // open question in the contract; placeholder

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

/** Short code printed on the label as text + QR; the buyer scans/types it on receipt. */
export function newLabelCode(): string {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

export interface LabelData {
  order_id: string;
  label_code: string;
  to: { name: string; mail_stop_code: string };
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
  if (!input.buyer.mailStopCode) {
    throw new ApiError(409, "MAIL_INFO_REQUIRED", "The buyer hasn't added their campus mail stop yet");
  }
  return {
    order_id: input.orderId,
    label_code: newLabelCode(),
    to: { name: input.buyer.name, mail_stop_code: input.buyer.mailStopCode },
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
  point: { location: LatLng; radiusM: number };
  photoMediaId: string | null;
  now: number;
}) {
  if (input.status !== "label_created") throw new ApiError(409, "INVALID_STATE", `Shipment is ${input.status}`);
  if (!input.photoMediaId) throw new ApiError(400, "VALIDATION", "Add a photo of the package", { photo_media_id: "Required" });
  if (!withinRadius(input.at, input.point.location, input.point.radiusM, input.accuracyM)) {
    throw new ApiError(403, "NOT_NEARBY", "You need to be at the drop-off point");
  }
  return {
    status: "dropped_off" as const,
    dropped_off_at: new Date(input.now).toISOString(),
    auto_complete_at: new Date(input.now + MAIL_AUTO_COMPLETE_DAYS * 86_400_000).toISOString(),
  };
}

export function verifyReceived(input: { status: string; expectedCode: string; givenCode: string }) {
  if (input.status !== "dropped_off") throw new ApiError(409, "INVALID_STATE", `Shipment is ${input.status}`);
  if (input.givenCode.trim().toUpperCase() !== input.expectedCode) {
    throw new ApiError(400, "VALIDATION", "That code doesn't match this package", { label_code: "Check the label" });
  }
  return { status: "received" as const };
}
