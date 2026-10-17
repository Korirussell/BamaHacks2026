-- .edu sign-up: only addresses whose domain belongs to a school may create an account.
--
-- Two layers:
--   1. hook_before_user_created: a Supabase "Before User Created" auth hook (enable it in
--      Dashboard → Authentication → Hooks). Rejects with a clean 403 the app can show.
--   2. Triggers on auth.users: stamp app_metadata.school_id (read by current_school_id() and
--      the API) and create the profiles row. They also refuse unknown domains, so the rule holds
--      even if the hook is off, but that surfaces as a generic "Database error saving new user".

-- Returns the school whose email_domains contain the address's domain, or null.
create or replace function public.school_for_email(email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.id
  from public.schools s
  where lower(split_part(email, '@', 2)) = any (s.email_domains)
  limit 1
$$;

create or replace function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  email text := lower(coalesce(event -> 'user' ->> 'email', ''));
begin
  if email !~ '@[^@]+\.edu$' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'NOT_EDU_EMAIL: use your school .edu email'));
  end if;
  if public.school_for_email(email) is null then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'SCHOOL_NOT_SUPPORTED: your school is not on the app yet'));
  end if;
  return '{}'::jsonb;
end $$;

create or replace function public.auth_user_set_school() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid := public.school_for_email(new.email);
begin
  if sid is null then
    raise exception 'SCHOOL_NOT_SUPPORTED: % is not a supported school email', new.email
      using errcode = 'check_violation';
  end if;
  new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb)
                           || jsonb_build_object('school_id', sid);
  return new;
end $$;

create or replace function public.auth_user_create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, school_id, email, display_name)
  values (
    new.id,
    (new.raw_app_meta_data ->> 'school_id')::uuid,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Keeps profiles.email in step when a user changes their address (still has to be a school domain).
create or replace function public.auth_user_sync_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_set_school on auth.users;
create trigger on_auth_user_set_school
  before insert or update of email on auth.users
  for each row execute function public.auth_user_set_school();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.auth_user_create_profile();

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.auth_user_sync_email();

-- Only Supabase Auth calls the hook; nobody calls these directly.
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.school_for_email(text) from public, anon, authenticated;
grant execute on function public.school_for_email(text) to supabase_auth_admin, service_role;
revoke execute on function public.auth_user_set_school() from public, anon, authenticated;
revoke execute on function public.auth_user_create_profile() from public, anon, authenticated;
revoke execute on function public.auth_user_sync_email() from public, anon, authenticated;
