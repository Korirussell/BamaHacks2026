import { z } from "zod";
import { Timestamp, Uuid } from "./common.js";
import { UserPublic } from "./me.js";
import { Course } from "./schedule.js";

export const CreateFriendRequestReq = z.object({ user_id: Uuid });
export const FriendRequestCreated = z.object({ id: Uuid, status: z.literal("pending") });
export const IncomingFriendRequest = z.object({ id: Uuid, from: UserPublic, created_at: Timestamp });
export const SuggestedFriend = z.object({ user: UserPublic, shared_courses: z.array(Course) });

export type CreateFriendRequestReq = z.infer<typeof CreateFriendRequestReq>;
export type FriendRequestCreated = z.infer<typeof FriendRequestCreated>;
export type IncomingFriendRequest = z.infer<typeof IncomingFriendRequest>;
export type SuggestedFriend = z.infer<typeof SuggestedFriend>;
