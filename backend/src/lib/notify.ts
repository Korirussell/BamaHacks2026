import { adminClient } from "./supabase.js";

export interface NotificationInput {
  schoolId: string;
  userId: string;
  /** Realtime event name from the contract, e.g. `tutoring.updated`. */
  type: string;
  title: string;
  body: string;
  deepLink: string;
  data?: Record<string, unknown>;
}

/**
 * Stores an in-app notification; clients get it live through Supabase Realtime on `notifications`.
 * Best effort: a failed notification never fails the request that caused it.
 */
export async function notify(n: NotificationInput): Promise<void> {
  const { error } = await adminClient().from("notifications").insert({
    school_id: n.schoolId, user_id: n.userId, type: n.type, title: n.title, body: n.body, deep_link: n.deepLink, data: n.data ?? {},
  });
  if (error) console.error("notify failed", n.type, error.message);
}
