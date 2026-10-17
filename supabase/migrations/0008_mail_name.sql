-- Name for campus mail labels. UA Campus Mail matches packages by name + 6-digit MSC, so this is the
-- student's first and last name as on their UA record (display_name can be a nickname).
alter table public.profiles add column mail_name text;
