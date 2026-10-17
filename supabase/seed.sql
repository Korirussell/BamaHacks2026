-- Reference data for the University of Alabama demo. Safe to re-run.
-- Fixed UUIDs so demo scripts and tests can refer to rows directly.
--
-- ⚠ Coordinates are approximate (good to ~100 m). Before the demo, check each one on a map,
--   especially the safe zones and the mail drop-off: their radius is what the geofence enforces.
-- ⚠ ISBNs are real editions picked for the demo, not UA's official book list.
--
-- Demo users (tutors, buyer, Instagram seller) are created by `pnpm seed:demo` through the
-- Supabase admin API, because users must exist in auth.users first (see BACKEND_ROADMAP step 2).

-- ---------------------------------------------------------------- school

insert into public.schools (id, name, domain, email_domains, center_lat, center_lng, timezone, campus_mail_supported, tutor_min_grade)
values ('00000000-0000-4000-a000-000000000001', 'The University of Alabama', 'ua.edu',
        '{ua.edu,crimson.ua.edu}', 33.2114, -87.5401, 'America/Chicago', true, 'A-')
on conflict (id) do update set
  name = excluded.name, email_domains = excluded.email_domains, center_lat = excluded.center_lat,
  center_lng = excluded.center_lng, campus_mail_supported = excluded.campus_mail_supported,
  tutor_min_grade = excluded.tutor_min_grade;

-- ---------------------------------------------------------------- buildings

insert into public.buildings (id, school_id, code, name, lat, lng) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001', 'NERC',   'North Engineering Research Center', 33.2147, -87.5446),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000001', 'LLOYD',  'Lloyd Hall',                        33.2123, -87.5438),
  ('00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000001', 'SHELBY', 'Shelby Hall',                       33.2149, -87.5398),
  ('00000000-0000-4000-b000-000000000004', '00000000-0000-4000-a000-000000000001', 'FERG',   'Ferguson Student Center',           33.2145, -87.5463),
  ('00000000-0000-4000-b000-000000000005', '00000000-0000-4000-a000-000000000001', 'GORGAS', 'Amelia Gayle Gorgas Library',       33.2112, -87.5462),
  ('00000000-0000-4000-b000-000000000006', '00000000-0000-4000-a000-000000000001', 'RODGRS', 'Rodgers Library',                   33.2155, -87.5423),
  ('00000000-0000-4000-b000-000000000007', '00000000-0000-4000-a000-000000000001', 'BIDGD',  'Bidgood Hall',                      33.2105, -87.5480),
  ('00000000-0000-4000-b000-000000000008', '00000000-0000-4000-a000-000000000001', 'ALSTON', 'Alston Hall',                       33.2111, -87.5486),
  ('00000000-0000-4000-b000-000000000009', '00000000-0000-4000-a000-000000000001', 'SMITH',  'Smith Hall',                        33.2103, -87.5446),
  ('00000000-0000-4000-b000-00000000000a', '00000000-0000-4000-a000-000000000001', 'HOUSER', 'Houser Hall',                       33.2147, -87.5425),
  ('00000000-0000-4000-b000-00000000000b', '00000000-0000-4000-a000-000000000001', 'GORDNP', 'Gordon Palmer Hall',                33.2155, -87.5443),
  ('00000000-0000-4000-b000-00000000000c', '00000000-0000-4000-a000-000000000001', 'MORGAN', 'Morgan Hall',                       33.2108, -87.5465),
  ('00000000-0000-4000-b000-00000000000d', '00000000-0000-4000-a000-000000000001', 'TENHR',  'Ten Hoor Hall',                     33.2116, -87.5432),
  ('00000000-0000-4000-b000-00000000000e', '00000000-0000-4000-a000-000000000001', 'HEWSON', 'Hewson Hall',                       33.2135, -87.5390),
  ('00000000-0000-4000-b000-00000000000f', '00000000-0000-4000-a000-000000000001', 'REC',    'Student Recreation Center',         33.2071, -87.5296)
on conflict (id) do update set code = excluded.code, name = excluded.name, lat = excluded.lat, lng = excluded.lng;

-- ---------------------------------------------------------------- safe zones

insert into public.safe_zones (id, school_id, name, kind, lat, lng, radius_m, hours, hours_note) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-a000-000000000001',
   'UAPD lobby', 'police', 33.2084, -87.5383, 60,
   '[{"days":["mon","tue","wed","thu","fri","sat","sun"],"open":"00:00","close":"23:59"}]',
   'Open 24/7; camera-monitored exchange spot'),
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-a000-000000000001',
   'Ferguson Center main entrance', 'student_center', 33.2145, -87.5463, 60,
   '[{"days":["mon","tue","wed","thu","fri"],"open":"07:00","close":"23:00"},{"days":["sat","sun"],"open":"10:00","close":"22:00"}]',
   null),
  ('00000000-0000-4000-c000-000000000003', '00000000-0000-4000-a000-000000000001',
   'Gorgas Library front steps', 'library', 33.2112, -87.5462, 50,
   '[{"days":["mon","tue","wed","thu"],"open":"07:30","close":"23:59"},{"days":["fri"],"open":"07:30","close":"18:00"},{"days":["sun"],"open":"12:00","close":"23:59"}]',
   'Hours vary during finals'),
  ('00000000-0000-4000-c000-000000000004', '00000000-0000-4000-a000-000000000001',
   'Rodgers Library lobby', 'library', 33.2155, -87.5423, 50,
   '[{"days":["mon","tue","wed","thu"],"open":"07:30","close":"23:59"},{"days":["fri"],"open":"07:30","close":"18:00"},{"days":["sun"],"open":"13:00","close":"23:59"}]',
   null),
  ('00000000-0000-4000-c000-000000000005', '00000000-0000-4000-a000-000000000001',
   'Student Rec Center front desk', 'other', 33.2071, -87.5296, 60,
   '[{"days":["mon","tue","wed","thu","fri"],"open":"06:00","close":"23:00"},{"days":["sat","sun"],"open":"09:00","close":"21:00"}]',
   null)
on conflict (id) do update set name = excluded.name, kind = excluded.kind, lat = excluded.lat, lng = excluded.lng,
  radius_m = excluded.radius_m, hours = excluded.hours, hours_note = excluded.hours_note;

-- ---------------------------------------------------------------- campus mail

insert into public.drop_off_points (id, school_id, name, lat, lng, radius_m, hours, instructions) values
  ('00000000-0000-4000-d000-000000000001', '00000000-0000-4000-a000-000000000001',
   'Crimson Mail & Shipping window, Student Center', 33.2141, -87.5470, 40,
   '[{"days":["mon","tue","wed","thu","fri"],"open":"08:00","close":"16:30"}]',
   'Student Center, 1st floor, behind Starbucks. Ship it USPS at the Crimson Mail & Shipping window to the buyer''s campus address (name + MSC); Campus Mail puts it in their locker. Handed in after 3:00 pm = next business day. Closed on University holidays.')
on conflict (id) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng,
  radius_m = excluded.radius_m, hours = excluded.hours, instructions = excluded.instructions;

-- ---------------------------------------------------------------- courses

insert into public.courses (id, school_id, code, title, department) values
  ('00000000-0000-4000-e000-000000000001', '00000000-0000-4000-a000-000000000001', 'CH 101',  'General Chemistry I',                   'Chemistry'),
  ('00000000-0000-4000-e000-000000000002', '00000000-0000-4000-a000-000000000001', 'CH 102',  'General Chemistry II',                  'Chemistry'),
  ('00000000-0000-4000-e000-000000000003', '00000000-0000-4000-a000-000000000001', 'MATH 125','Calculus I',                            'Mathematics'),
  ('00000000-0000-4000-e000-000000000004', '00000000-0000-4000-a000-000000000001', 'MATH 126','Calculus II',                           'Mathematics'),
  ('00000000-0000-4000-e000-000000000005', '00000000-0000-4000-a000-000000000001', 'CS 100',  'CS I for Majors',                       'Computer Science'),
  ('00000000-0000-4000-e000-000000000006', '00000000-0000-4000-a000-000000000001', 'CS 101',  'CS II for Majors',                      'Computer Science'),
  ('00000000-0000-4000-e000-000000000007', '00000000-0000-4000-a000-000000000001', 'BSC 114', 'Principles of Biology I',               'Biological Sciences'),
  ('00000000-0000-4000-e000-000000000008', '00000000-0000-4000-a000-000000000001', 'EC 110',  'Principles of Microeconomics',          'Economics'),
  ('00000000-0000-4000-e000-000000000009', '00000000-0000-4000-a000-000000000001', 'PH 105',  'General Physics with Calculus I',       'Physics & Astronomy'),
  ('00000000-0000-4000-e000-00000000000a', '00000000-0000-4000-a000-000000000001', 'EN 101',  'English Composition I',                 'English')
on conflict (id) do update set code = excluded.code, title = excluded.title, department = excluded.department;

-- ---------------------------------------------------------------- course materials (ISBN ↔ course)

insert into public.course_materials (id, school_id, course_id, isbn, title, authors, edition, required) values
  -- Demo 2 book: CH 101 and CH 102 both use it, so one Instagram post matches two classes.
  ('00000000-0000-4000-f000-000000000001', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e000-000000000001',
   '9780134414232', 'Chemistry: The Central Science', '{Theodore L. Brown,H. Eugene LeMay,Bruce E. Bursten}', '14th', true),
  ('00000000-0000-4000-f000-000000000002', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e000-000000000002',
   '9780134414232', 'Chemistry: The Central Science', '{Theodore L. Brown,H. Eugene LeMay,Bruce E. Bursten}', '14th', true),
  ('00000000-0000-4000-f000-000000000003', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e000-000000000003',
   '9781337613927', 'Calculus: Early Transcendentals', '{James Stewart,Daniel Clegg,Saleem Watson}', '9th', true),
  ('00000000-0000-4000-f000-000000000004', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e000-000000000004',
   '9781337613927', 'Calculus: Early Transcendentals', '{James Stewart,Daniel Clegg,Saleem Watson}', '9th', true),
  ('00000000-0000-4000-f000-000000000005', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e000-000000000007',
   '9780135188743', 'Campbell Biology', '{Lisa A. Urry,Michael L. Cain,Steven A. Wasserman}', '12th', true),
  ('00000000-0000-4000-f000-000000000006', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e000-000000000008',
   '9780357133491', 'Principles of Microeconomics', '{N. Gregory Mankiw}', '9th', true)
on conflict (id) do update set isbn = excluded.isbn, title = excluded.title, authors = excluded.authors,
  edition = excluded.edition, required = excluded.required;
