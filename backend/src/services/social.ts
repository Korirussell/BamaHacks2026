// Pure friend-graph logic (module 14). The DB layer (db/social.ts) loads friendship rows; this works them out.

export interface FriendPair { user_a: string; user_b: string }
export interface FriendStats { is_friend: boolean; mutual_friend_count: number }

/** A friendship row's key: ids lower-cased and ordered so user_a < user_b (as the table requires). */
export function friendPair(x: string, y: string): FriendPair {
  const a = x.toLowerCase();
  const b = y.toLowerCase();
  return a < b ? { user_a: a, user_b: b } : { user_a: b, user_b: a };
}

export function adjacency(pairs: FriendPair[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const add = (from: string, to: string) => {
    const set = adj.get(from) ?? new Set<string>();
    set.add(to);
    adj.set(from, set);
  };
  for (const p of pairs) {
    add(p.user_a, p.user_b);
    add(p.user_b, p.user_a);
  }
  return adj;
}

export const friendsOf = (userId: string, pairs: FriendPair[]) => [...(adjacency(pairs).get(userId) ?? [])];

/** Friends the viewer and `otherId` have in common. `pairs` must include every friendship of both. */
export function mutualIds(viewerId: string, otherId: string, pairs: FriendPair[]): string[] {
  if (viewerId === otherId) return [];
  const adj = adjacency(pairs);
  const mine = adj.get(viewerId) ?? new Set<string>();
  return [...(adj.get(otherId) ?? [])].filter((id) => id !== viewerId && mine.has(id));
}

/** UserPublic friend fields per target. `pairs` must include every friendship of the viewer and of each target. */
export function friendStats(viewerId: string, targetIds: string[], pairs: FriendPair[]): Map<string, FriendStats> {
  const adj = adjacency(pairs);
  const mine = adj.get(viewerId) ?? new Set<string>();
  return new Map(targetIds.map((id) => {
    if (id === viewerId) return [id, { is_friend: false, mutual_friend_count: 0 }];
    const theirs = adj.get(id) ?? new Set<string>();
    let mutual = 0;
    for (const f of theirs) if (f !== viewerId && mine.has(f)) mutual++;
    return [id, { is_friend: mine.has(id), mutual_friend_count: mutual }];
  }));
}

export interface SuggestionInput {
  me: string;
  friendIds: string[];
  /** Users with an open request to or from me. */
  pendingIds: string[];
  /** Other user → course ids they share with me (current or past). */
  sharedCourses: Map<string, string[]>;
  /** Every friendship of my friends (rows touching any of `friendIds`). */
  friendPairs: FriendPair[];
}

export interface Suggestion { userId: string; courseIds: string[]; mutuals: number }

/** Shared classes first, then mutual friends; never me, my friends or anyone with an open request. */
export function rankSuggestions(input: SuggestionInput, limit = 20): Suggestion[] {
  const { me } = input;
  const friends = new Set(input.friendIds);
  const excluded = new Set([me, ...input.friendIds, ...input.pendingIds]);
  const mutuals = new Map<string, number>();
  for (const p of input.friendPairs) {
    for (const [f, other] of [[p.user_a, p.user_b], [p.user_b, p.user_a]] as const) {
      if (friends.has(f) && !excluded.has(other)) mutuals.set(other, (mutuals.get(other) ?? 0) + 1);
    }
  }
  const candidates = new Set([...input.sharedCourses.keys(), ...mutuals.keys()]);
  return [...candidates]
    .filter((id) => !excluded.has(id))
    .map((userId) => ({ userId, courseIds: [...new Set(input.sharedCourses.get(userId) ?? [])], mutuals: mutuals.get(userId) ?? 0 }))
    .filter((s) => s.courseIds.length > 0 || s.mutuals > 0)
    .sort((a, b) => b.courseIds.length - a.courseIds.length || b.mutuals - a.mutuals || (a.userId < b.userId ? -1 : 1))
    .slice(0, limit);
}

export type RequestOutcome = { kind: "create" } | { kind: "existing"; id: string } | { kind: "incoming"; id: string } | { kind: "friends" };

/** What POST /friend-requests does given the pair's current state (open requests are between me and them only). */
export function requestOutcome(me: string, alreadyFriends: boolean, open: { id: string; from_id: string }[]): RequestOutcome {
  if (alreadyFriends) return { kind: "friends" };
  const mine = open.find((r) => r.from_id === me);
  if (mine) return { kind: "existing", id: mine.id };
  const theirs = open[0];
  return theirs ? { kind: "incoming", id: theirs.id } : { kind: "create" };
}
