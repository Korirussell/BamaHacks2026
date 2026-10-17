'use client';
// Real mode: pick a class → tutors with an A who are free when you are → request a slot →
// the tutor accepts (books a library room) → the student pays.
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { money } from '@/lib/money';
import { demoSession } from '@/lib/api';
import {
  acceptSession, declineSession, findTutors, getMyClasses, mySessions, paySession, requestSession,
  type LiveClass, type LiveSession, type LiveSlot, type LiveTutorMatch,
} from '@/lib/live-tutoring';
import { EmptyState, PageTitle, Pill, Skeleton, StickerCard, Tag } from '@/components/ui';

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

function RoomLine({ s }: { s: LiveSession }) {
  const b = s.room_booking;
  if (b.status === 'booked') return <p className="text-[13px] font-bold">📍 Room booked: {b.room?.name}</p>;
  if (b.status === 'manual_required' || b.status === 'failed') {
    return (
      <p className="text-[13px] font-bold">
        📍 {b.room?.name ?? 'Library room'} {b.booking_url && <a className="underline" href={b.booking_url} target="_blank" rel="noreferrer">Book it</a>}
      </p>
    );
  }
  if (b.status === 'pending') return <p className="text-[13px] font-semibold text-soft">📍 Room gets booked when the tutor accepts</p>;
  return s.location.name ? <p className="text-[13px] font-semibold text-soft">📍 {s.location.name}</p> : null;
}

function SessionCard({ s, role, onChange }: { s: LiveSession; role: 'student' | 'tutor'; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const other = role === 'tutor' ? s.student.display_name : s.tutor.display_name;
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); toast(done); onChange(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <StickerCard className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-[18px] font-bold">{s.course.code} with {other}</p>
          <p className="text-[13px] font-semibold text-soft">{when(s.start)} · {money(s.price_cents)}</p>
        </div>
        <Tag>{s.status === 'paid' ? 'paid 🔒' : s.status}</Tag>
      </div>
      <div className="mt-2"><RoomLine s={s} /></div>
      <div className="mt-3 flex flex-wrap gap-2">
        {role === 'tutor' && s.status === 'requested' && (
          <>
            <Pill size="sm" disabled={busy} onClick={() => void act(() => acceptSession(s.id), 'Accepted. Booking a library room…')}>{busy ? 'Booking…' : 'Accept'}</Pill>
            <Pill size="sm" variant="neutral" disabled={busy} onClick={() => void act(() => declineSession(s.id), 'Declined')}>Decline</Pill>
          </>
        )}
        {role === 'student' && s.status === 'accepted' && (
          <Pill size="sm" disabled={busy} onClick={() => void act(() => paySession(s.id), 'Paid. Held until the session happens 🔒')}>Pay {money(s.price_cents)}</Pill>
        )}
        {role === 'student' && s.status === 'requested' && <p className="text-[13px] font-semibold text-soft">Waiting for {other} to accept</p>}
      </div>
    </StickerCard>
  );
}

function TutorCard({ m, courseId, onRequested }: { m: LiveTutorMatch; courseId: string; onRequested: () => void }) {
  const [busy, setBusy] = useState('');
  const pick = async (slot: LiveSlot) => {
    setBusy(slot.start);
    try {
      await requestSession(m.tutor.id, courseId, slot);
      toast(`Request sent to ${m.tutor.display_name} for ${when(slot.start)}`);
      onRequested();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(''); }
  };
  return (
    <StickerCard className="p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-ink bg-mint text-xl font-bold">{m.tutor.display_name.slice(0, 1)}</span>
        <div>
          <p className="font-display text-[20px] font-bold">{m.tutor.display_name}</p>
          <p className="text-[13px] font-semibold text-soft">
            Got an {m.grade} {m.grade_verified && '✓ verified'} · {m.rating ? `★ ${m.rating.toFixed(1)} (${m.review_count})` : 'New'} · {money(m.hourly_rate_cents)}/hr
          </p>
        </div>
      </div>
      <ul className="mt-3 space-y-1">
        {m.match.reasons.map((r) => <li key={r} className="text-[13px] font-semibold">✨ {r}</li>)}
      </ul>
      <p className="mt-4 text-[12px] font-bold uppercase tracking-wide text-soft">You're both free</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {m.mutual_slots.slice(0, 6).map((slot) => (
          <Pill key={slot.start} size="sm" variant={slot.library_room ? undefined : 'neutral'} disabled={!!busy} onClick={() => void pick(slot)}>
            {busy === slot.start ? 'Sending…' : `${when(slot.start)}${slot.library_room ? ` · ${slot.library_room.name}` : ''}`}
          </Pill>
        ))}
        {m.mutual_slots.length === 0 && <p className="text-[13px] font-semibold text-soft">No shared free time this week.</p>}
      </div>
    </StickerCard>
  );
}

export function LiveTutoring() {
  const [classes, setClasses] = useState<LiveClass[]>([]);
  const [courseId, setCourseId] = useState('');
  const [tutors, setTutors] = useState<LiveTutorMatch[] | null>(null);
  const [asStudent, setAsStudent] = useState<LiveSession[]>([]);
  const [asTutor, setAsTutor] = useState<LiveSession[]>([]);
  const [err, setErr] = useState('');
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => setSignedIn(!!demoSession()), []);

  const loadSessions = useCallback(async () => {
    const [s, t] = await Promise.all([mySessions('student'), mySessions('tutor')]);
    const open = (x: LiveSession) => !['completed', 'cancelled', 'no_show'].includes(x.status);
    setAsStudent(s.filter(open)); setAsTutor(t.filter(open));
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    getMyClasses().then((c) => { setClasses(c); if (c[0]) setCourseId(c[0].course.id); }).catch((e) => setErr(errMsg(e)));
    loadSessions().catch((e) => setErr(errMsg(e)));
  }, [signedIn, loadSessions]);

  useEffect(() => {
    if (!courseId) return;
    setTutors(null);
    findTutors(courseId).then(setTutors).catch((e) => { setErr(errMsg(e)); setTutors([]); });
  }, [courseId]);

  if (signedIn === null) return null;
  if (!signedIn) return <EmptyState line="Sign in to find a tutor." action={<a className="underline font-bold" href="/signin">Sign in</a>} />;

  return (
    <div className="mx-auto max-w-[900px]">
      <PageTitle title="Tutoring" sub="Students who got an A in your class, free when you are, with a library room." />
      {err && <p className="mb-4 text-[13px] font-bold text-accent-text">{err}</p>}

      {asTutor.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 font-display text-[20px] font-bold">Requests for you</h2>
          <div className="grid gap-5 sm:grid-cols-2">{asTutor.map((s) => <SessionCard key={s.id} s={s} role="tutor" onChange={() => void loadSessions()} />)}</div>
        </section>
      )}
      {asStudent.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 font-display text-[20px] font-bold">Your sessions</h2>
          <div className="grid gap-5 sm:grid-cols-2">{asStudent.map((s) => <SessionCard key={s.id} s={s} role="student" onChange={() => void loadSessions()} />)}</div>
        </section>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        {classes.map((c) => (
          <Pill key={c.course.id} size="sm" variant={c.course.id === courseId ? undefined : 'neutral'} onClick={() => setCourseId(c.course.id)}>{c.course.code}</Pill>
        ))}
      </div>
      {tutors === null ? (
        <div className="grid gap-4 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-48" />)}</div>
      ) : tutors.length === 0 ? <EmptyState line="No tutors for this class yet." /> : (
        <div className="grid gap-5 sm:grid-cols-2">{tutors.map((m) => <TutorCard key={m.tutor.id} m={m} courseId={courseId} onRequested={() => void loadSessions()} />)}</div>
      )}
    </div>
  );
}
