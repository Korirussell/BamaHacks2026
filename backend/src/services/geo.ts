import type { LatLng } from "../schemas/common.js";

const EARTH_RADIUS_M = 6_371_000;
// ~1.3 m/s walking, with a 1.3× detour factor for campus paths instead of straight lines.
const WALK_M_PER_MIN = 80;
const DETOUR = 1.3;

export function distanceM(a: LatLng, b: LatLng): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function walkMinutes(a: LatLng, b: LatLng): number {
  return Math.ceil((distanceM(a, b) * DETOUR) / WALK_M_PER_MIN);
}

/**
 * True when `at` is inside a circle of `radiusM`. GPS accuracy is allowed to widen the circle,
 * capped at 50 m so a phone reporting "±2 km" can't confirm from across campus.
 */
export function withinRadius(at: LatLng, center: LatLng, radiusM: number, accuracyM = 0): boolean {
  return distanceM(at, center) <= radiusM + Math.min(Math.max(accuracyM, 0), 50);
}
