import { z } from "zod";
import { adminClient } from "../lib/supabase.js";
import { toUserPublic } from "./mappers.js";
import { MediaRef, ProfileRow, SchoolRow } from "./rows.js";

const PublicRow = ProfileRow.extend({ school: SchoolRow, avatar: MediaRef.nullable() });

export type UserPublicOut = ReturnType<typeof toUserPublic>;

/** UserPublic for each id that exists in `schoolId`, keyed by id. */
export async function loadUsersPublic(ids: string[], schoolId: string): Promise<Map<string, UserPublicOut>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const { data, error } = await adminClient()
    .from("profiles")
    .select("*, school:schools(*), avatar:media!profiles_avatar_media_fk(bucket, path)")
    .eq("school_id", schoolId)
    .in("id", unique);
  if (error) throw error;
  return new Map(z.array(PublicRow).parse(data).map((p) => [p.id, toUserPublic(p, p.school, p.avatar)]));
}
