-- Storage buckets for media uploads.
--
-- Clients never write to Storage directly: the API creates the media row and hands out a
-- signed upload URL (POST /media/upload-url), so no storage.objects policies are needed.
-- public-media is served through its public URL; private-docs only through short-lived
-- signed URLs the API creates. With RLS on storage.objects and no policies, a client key
-- can't list, read or write either bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('public-media', 'public-media', true, 10485760,
   array['image/jpeg', 'image/png', 'image/heic', 'image/webp']),
  ('private-docs', 'private-docs', false, 10485760,
   array['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf', 'text/calendar'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Proof photos for the handoff flow join the purposes from 0001.
alter table public.media drop constraint media_purpose_check;
alter table public.media add constraint media_purpose_check check (
  purpose in ('listing', 'avatar', 'transcript', 'syllabus', 'schedule', 'screenshot', 'label',
              'drop_off_proof', 'handoff_proof', 'ingested')
);
