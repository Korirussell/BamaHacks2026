import { z } from "zod";
import { adminClient } from "../lib/supabase.js";
import { toUserPublic } from "./mappers.js";
import { MediaRef, ProfileRow, SchoolRow } from "./rows.js";
import { friendStatsFor } from "./social.js";
import type { FriendStats } from "../services/social.js";

const PublicRow = ProfileRow.extend({ school: SchoolRow, avatar: MediaRef.nullable() });

export type UserPublicOut = ReturnType<typeof toUserPublic>;

/**
 * UserPublic for each id that exists in `schoolId`, keyed by id.
 * With `viewerId`, is_friend and mutual_friend_count are relative to that user; without, they stay false / 0.
 */
export async function loadUsersPublic(ids: string[], schoolId: string, viewerId?: string): Promise<Map<string, UserPublicOut>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const [{ data, error }, stats] = await Promise.all([
    adminClient()
      .from("profiles")
      .select("*, school:schools(*), avatar:media!profiles_avatar_media_fk(bucket, path)")
      .eq("school_id", schoolId)
      .in("id", unique),
    viewerId ? friendStatsFor(viewerId, unique, schoolId) : Promise.resolve(new Map<string, FriendStats>()),
  ]);
  if (error) throw error;
  return new Map(z.array(PublicRow).parse(data).map((p) => [p.id, toUserPublic(p, p.school, p.avatar, stats.get(p.id))]));
}
