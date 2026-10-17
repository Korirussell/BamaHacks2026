-- Local AI worker queue. The deployed API never runs a model: it writes an ai_tasks row and waits.
-- A laptop worker (ai-worker/) runs Gemma 4 (vision) and JEV-9B (typed decisions) locally, claims
-- rows, and writes the result back. ai_workers holds its heartbeat, so the API skips the queue
-- (and falls back) when no worker is online. Service role only: no RLS policies.

create table public.ai_tasks (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('gemma_vision', 'jev_decide')),
  payload     jsonb not null,
  status      text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  result      jsonb,
  error       text,
  worker_id   text,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index ai_tasks_queued_idx on public.ai_tasks (kind, created_at) where status = 'queued';
create trigger ai_tasks_updated_at before update on public.ai_tasks
  for each row execute function public.set_updated_at();
alter table public.ai_tasks enable row level security;

create table public.ai_workers (
  id           text primary key,
  kinds        text[] not null,
  models       jsonb not null default '{}',
  last_seen_at timestamptz not null default now()
);
alter table public.ai_workers enable row level security;

-- Claims the oldest fresh queued task of the given kinds. Tasks older than 2 minutes are skipped:
-- the API has already given up on them, so a laptop waking from sleep doesn't chew a backlog.
create or replace function public.claim_ai_task(p_worker text, p_kinds text[])
returns setof public.ai_tasks
language sql
security definer
set search_path = public
as $$
  update public.ai_tasks t
     set status = 'running', worker_id = p_worker, claimed_at = now()
   where t.id = (
     select id from public.ai_tasks
      where status = 'queued' and kind = any (p_kinds) and created_at > now() - interval '2 minutes'
      order by created_at
      limit 1
      for update skip locked
   )
  returning t.*;
$$;
revoke all on function public.claim_ai_task(text, text[]) from public, anon, authenticated;
