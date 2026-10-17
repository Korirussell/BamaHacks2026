import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { adminClient } from "../lib/supabase.js";

export const EventRow = z.object({
  id: z.guid(), name: z.string(), kind: z.enum(["athletics", "concert", "other"]),
  starts_at: z.string().transform((v) => new Date(v).toISOString()), venue: z.string(),
});
export type EventRow = z.infer<typeof EventRow>;

export const EVENT_COLUMNS = "id, name, kind, starts_at, venue";

export async function loadEventRow(id: string, schoolId: string): Promise<EventRow> {
  const { data, error } = await adminClient().from("events").select(EVENT_COLUMNS).eq("school_id", schoolId).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, "NOT_FOUND", "Event not found");
  return EventRow.parse(data);
}
