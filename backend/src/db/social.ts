import { z } from "zod";
import { adminClient } from "../lib/supabase.js";
import { friendStats, friendsOf, mutualIds, type FriendPair, type FriendStats } from "../services/social.js";

const PairRow = z.object({ user_a: z.guid(), user_b: z.guid() });

/** Every friendship in `schoolId` that involves any of `ids`. */
export async function pairsTouching(ids: string[], schoolId: string): Promise<FriendPair[]> {
  const unique = [...new Set(ids.map((id) => id.toLowerCase()))];
  if (!unique.length) return [];
  const list = unique.join(",");
  const { data, error } = await adminClient().from("friendships").select("user_a, user_b")
    .eq("school_id", schoolId).or(`user_a.in.(${list}),user_b.in.(${list})`);
  if (error) throw error;
  return z.array(PairRow).parse(data);
}

export const friendIdsOf = async (userId: string, schoolId: string) => friendsOf(userId, await pairsTouching([userId], schoolId));

export async function mutualFriendIds(viewerId: string, otherId: string, schoolId: string) {
  return mutualIds(viewerId, otherId, await pairsTouching([viewerId, otherId], schoolId));
}

/** is_friend / mutual_friend_count for each target, from one query. */
export async function friendStatsFor(viewerId: string, targetIds: string[], schoolId: string): Promise<Map<string, FriendStats>> {
  if (!targetIds.length) return new Map();
  const viewer = viewerId.toLowerCase();
  const targets = targetIds.map((id) => id.toLowerCase());
  return friendStats(viewer, targets, await pairsTouching([viewer, ...targets], schoolId));
}
