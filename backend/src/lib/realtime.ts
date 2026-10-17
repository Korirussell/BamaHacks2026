// Supabase Realtime "broadcast from the server" over REST:
// POST {SUPABASE_URL}/realtime/v1/api/broadcast  { messages: [{ topic, event, payload, private }] }.
// Private topics are authorised by Realtime RLS policies on realtime.messages.

/**
 * Best effort: never throws, logs on failure, no-op when Supabase env is missing.
 * Payloads must be the same for every subscriber, so never put per-viewer or location data in them.
 */
export async function broadcast(topic: string, event: string, payload: object): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic, event, payload, private: true }] }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) console.error("broadcast failed", topic, event, res.status);
  } catch (error) {
    console.error("broadcast failed", topic, event, error instanceof Error ? error.message : error);
  }
}
