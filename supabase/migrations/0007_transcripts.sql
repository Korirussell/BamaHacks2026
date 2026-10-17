-- Transcript imports (POST /transcripts). The API parses an uploaded transcript into `parsed`
-- (status needs_review); the user reviews it and POST /transcripts/{id}/confirm writes class_records.
-- Clients read their own rows; every write goes through the API with the service role.

create table public.transcripts (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools (id),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  media_id     uuid not null references public.media (id),
  job_id       uuid references public.jobs (id) on delete set null,
  status       text not null default 'parsing' check (status in ('parsing', 'needs_review', 'confirmed', 'failed')),
  parsed       jsonb,                                     -- services/transcript.ts ParsedTranscript, incl. `section`
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  confirmed_at timestamptz
);
create index transcripts_user_idx on public.transcripts (user_id, created_at desc);
create trigger transcripts_updated_at before update on public.transcripts
  for each row execute function public.set_updated_at();

alter table public.transcripts enable row level security;

create policy transcripts_own_read on public.transcripts for select to authenticated
  using (user_id = auth.uid());
-- No insert/update/delete policies: writes are service role only.
