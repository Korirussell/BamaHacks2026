// Live tutoring calls (real mode): match → request → tutor accepts (books a library room) → student pays.
import { request } from './api';

export type LiveRoom = { room_id: string; name: string; capacity: number; book_url: string };
export type LiveSlot = { start: string; end: string; library_room: LiveRoom | null };
export type LiveTutorMatch = {
  tutor: { id: string; display_name: string; major: string | null };
  grade: string; grade_verified: boolean; rating: number | null; review_count: number; hourly_rate_cents: number;
  match: { score: number; reasons: string[] };
  mutual_slots: LiveSlot[];
};
export type LiveClass = { course: { id: string; code: string; title: string }; status: string };
export type LiveSession = {
  id: string;
  tutor: { id: string; display_name: string };
  student: { id: string; display_name: string };
  course: { id: string; code: string };
  start: string; end: string; price_cents: number;
  location: { kind: string; name: string | null };
  room_booking: { status: 'not_needed' | 'pending' | 'booked' | 'manual_required' | 'failed'; room: { name: string } | null; booking_url: string | null };
  status: string;
  waiting_on: string | null;
  payment: { status: string; paid_at: string | null };
};

const post = { method: 'POST', body: JSON.stringify({}) };
const sixDays = 6 * 24 * 3600_000;

export const getMyClasses = () => request<LiveClass[]>('/me/classes?status=current');
export const findTutors = (courseId: string) => {
  const now = Date.now();
  const q = new URLSearchParams({ course_id: courseId, from: new Date(now).toISOString(), to: new Date(now + sixDays).toISOString() });
  return request<LiveTutorMatch[]>(`/tutors?${q}`);
};
export const requestSession = (tutorId: string, courseId: string, slot: LiveSlot) => request<LiveSession>('/tutoring/sessions', {
  method: 'POST',
  body: JSON.stringify({ tutor_id: tutorId, course_id: courseId, start: slot.start, end: slot.end, location_pref: 'library_room', notes: 'Booked from the demo' }),
});
export const mySessions = (role: 'student' | 'tutor') => request<LiveSession[]>(`/tutoring/sessions?role=${role}`);
export const acceptSession = (id: string) => request<LiveSession>(`/tutoring/sessions/${id}/accept`, post);
export const declineSession = (id: string) => request<LiveSession>(`/tutoring/sessions/${id}/decline`, post);
export const paySession = (id: string) => request<unknown>(`/tutoring/sessions/${id}/pay`, { ...post, headers: { 'Idempotency-Key': crypto.randomUUID() } });
