import { publicMediaUrl } from "../lib/supabase.js";
import { reliability } from "../services/reliability.js";
import type { FriendStats } from "../services/social.js";
import type { ProfileRow, SchoolRow } from "./rows.js";

export const toSchool = (s: SchoolRow) => ({
  id: s.id,
  name: s.name,
  domain: s.domain,
  center: { lat: s.center_lat, lng: s.center_lng },
  timezone: s.timezone,
  campus_mail_supported: s.campus_mail_supported,
  tutor_min_grade: s.tutor_min_grade,
});

/** UserPublic. Friend fields are relative to the viewer `friend` was worked out for (false / 0 without one). */
export const toUserPublic = (
  p: ProfileRow,
  school: SchoolRow,
  avatar: { bucket: string; path: string } | null,
  friend: FriendStats = { is_friend: false, mutual_friend_count: 0 },
) => ({
  id: p.id,
  display_name: p.display_name,
  avatar_url: avatar ? publicMediaUrl(avatar.bucket, avatar.path) : null,
  major: p.major,
  grad_year: p.grad_year,
  school: toSchool(school),
  reliability: reliability(p.completed_count, p.no_show_count),
  is_friend: friend.is_friend,
  mutual_friend_count: friend.mutual_friend_count,
  can_receive_payments: p.payouts_enabled,
  is_verified_driver: false,
});
