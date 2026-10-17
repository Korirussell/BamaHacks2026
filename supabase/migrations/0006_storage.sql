-- Storage buckets and direct-client access policies for media uploads.

insert into storage.buckets (id, name, public)
values
  ('public-media', 'public-media', true),
  ('private-docs', 'private-docs', false)
on conflict (id) do nothing;

-- Keep existing media purposes usable while allowing the names accepted by the upload API.
alter table public.media drop constraint media_purpose_check;
alter table public.media add constraint media_purpose_check check (
  purpose in (
    'listing', 'listing_photo', 'avatar', 'transcript', 'syllabus', 'schedule',
    'screenshot', 'label', 'drop_off_proof', 'handoff_proof', 'ingested'
  )
);

-- Public media can be fetched by anyone, but authenticated users can only manage
-- objects in their own top-level directory (<auth.uid()>/...).
create policy public_media_read on storage.objects for select to public
  using (bucket_id = 'public-media');

create policy public_media_write_own on storage.objects for all to authenticated
  using (
    bucket_id = 'public-media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'public-media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- Private documents are visible and writable only to the user named by the
-- first path component.
create policy private_docs_own on storage.objects for all to authenticated
  using (
    bucket_id = 'private-docs'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'private-docs'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
