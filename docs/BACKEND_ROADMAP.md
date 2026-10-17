# Backend roadmap: two demo moments

The goal is to make **Demo 1 (tutor match → schedule → library)** and **Demo 2 (Instagram post → matched buyer → claim → in-person or campus-mail fulfilment)** work on the real backend. The exact call sequences are in [API_CONTRACT.md → Demo flows](API_CONTRACT.md#demo-flows-call-sequences).

Each step ends with something you can check with `curl` or the app, and is small enough to merge on its own. **🧑 = needs a human** (an account, a key, or a decision).

## Already done

| | What | Where |
|---|---|---|
| ✅ | API contract covering both demos | `docs/API_CONTRACT.md` |
| ✅ | Hono server, error format, `/health`, `/auth/check-email` (.edu check only) | `backend/src/index.ts`, `routes/auth.ts` |
| ✅ | Domain logic, unit tested: schedules → free time, walk-time slots, tutor matching, session counter/accept, meetup suggestions, rotating handoff codes + geofence, order state machine + fees/payout, offers + auto-accept, claim tokens + DM text, course-material matching, ISBN, campus-mail label/drop-off/receipt | `backend/src/services/*` (`pnpm test`) |
| ✅ | Database schema + UA seed (migrations checked locally) | `supabase/` |
| ✅ | Interfaces + stubs for everything external (scraper, Claude vision, course materials, DMs, UA directory, library booking, label PDF) | `backend/src/adapters/*` |

The services are **pure functions**: they take plain data in and return decisions, and they never touch the database. Each route loads rows from Supabase, calls a service, and writes the result back. That keeps the hard logic testable now, before Supabase exists.

## Steps

### 1. Supabase project + database schema 🧑
- ✅ `supabase/migrations/0001_core.sql` (schools, profiles, buildings, safe zones, drop-off points, courses, course materials, class records, class meetings, media, jobs, idempotency keys), `0002_market.sql` (ingested posts, listings, listing courses/media, seller invites, offers, orders, handoffs, shipments, notifications), `0003_tutoring.sql` (tutor profiles/courses, sessions, reviews, `tutor_stats` view). RLS on every table. Locations are lat/lng columns (no PostGIS); distances are computed in `services/geo.ts`.
- ✅ Checked against a local Postgres (PGlite): migrations apply, the seed re-runs cleanly, constraints reject bad states, and RLS scopes rows to their parties.
- 🧑 Create the hosted project and apply the migrations: [`supabase/README.md`](../supabase/README.md).
- **Done when:** the tables show up in the dashboard's Table Editor.

### 2. Seed data for UA
- ✅ `supabase/seed.sql`: UA (`ua.edu` + `crimson.ua.edu`, `America/Chicago`, `tutor_min_grade: A-`), 15 buildings, 5 safe zones with opening hours, the campus-mail drop-off, 10 courses, and ISBN ↔ course rows (the Demo 2 chem book is used by CH 101 *and* CH 102). Fixed UUIDs.
- 🧑 Check the coordinates on a map (they're approximate; the safe-zone and drop-off radii are what the geofence enforces) and confirm the real campus-mail drop.
- Demo personas (a tutoring student, 2–3 tutors with verified grades and schedules, a CH 101 buyer, the Instagram seller) go in `pnpm seed:demo` after step 3, because users have to be created through the Supabase admin API.
- **Done when:** `GET /safe-zones` and `GET /buildings` return seed rows (after step 4).

### 3. Server foundations
- `src/config.ts`: check env vars with Zod at boot and fail fast if any are missing.
- `src/lib/supabase.ts`: an admin client (service role) plus a per-request client built from the user's token, so RLS applies.
- `src/middleware/auth.ts`: verify the Supabase JWT and set `c.var.user = { id, schoolId }`; otherwise reply `UNAUTHENTICATED`.
- `src/lib/validate.ts`: a Zod body/query helper that maps errors to `VALIDATION` with `field_errors`.
- `src/middleware/idempotency.ts`: stores `Idempotency-Key` + response for money and handoff calls.
- 🧑 Pick Railway or Fly. Deploy, then share the base URL with the frontend.
- **Done when:** the deployed `/api/v1/health` is green and `GET /me` with no token returns `401 UNAUTHENTICATED`.

### 4. .edu auth + profile
- ✅ `0004_auth.sql`: `hook_before_user_created` + `auth.users` triggers (stamp `school_id`, create the profile, keep `profiles.email` in sync). Checked in PGlite. ✅ `POST /auth/check-email` looks up `schools.email_domains`. ✅ `GET/PATCH /me`. ✅ `pnpm seed:demo` (personas) and `pnpm seed:demo otp <name>` (sign-in code, no email sent).
- A Supabase **before-user-created auth hook** (SQL function): reject non-`.edu` and unknown domains, and set `school_id` in `app_metadata`. A trigger creates the `profiles` row.
- 🧑 In the Supabase dashboard, turn on email OTP (6-digit code) and enable the hook. Custom SMTP (Resend) is optional for the demo; the built-in mailer allows only a few emails per hour.
- `POST /auth/check-email` looks schools up by domain. Add `GET /me` and `PATCH /me` (including `mail_stop_code` and `tutor_opt_in`).
- **Done when:** a `@crimson.ua.edu` address gets an OTP and `GET /me` returns `Me`, while a `@gmail.com` address is refused by the hook.

### 5. Media uploads
- `POST /media/upload-url`: a signed Supabase Storage upload URL for `public-media` or `private-docs` that writes a `media` row.
- **Done when:** the app can upload a photo and get back a `media_id` that resolves to a URL.

### 6. Academics + schedule
- ✅ Done (Codex, `routes/academics.ts`, `routes/schedule.ts`).
- `GET /courses`, `GET /buildings`, `GET/POST/DELETE /me/classes` (grades entered by hand are `self_reported`; the seed marks demo tutors as verified).
- `GET/PUT /me/class-schedule` maps rows to `MeetingInput`. `GET /me/availability` wires `expandMeetings` and `freeBlocks`.
- Transcript and schedule import (Claude) can wait: the demo uses seeded or hand-entered schedules.
- **Done when:** the demo student's `GET /me/availability` shows real free blocks around their classes.

### 7. 🎯 Demo 1: tutor matching + sessions ✅
> Done in `routes/tutoring.ts`. Realtime goes through rows in `notifications` (type `tutoring.updated`, see `lib/notify.ts`); clients subscribe to Postgres changes on their own rows rather than a `user:{id}` broadcast. Set `ROOM_BOOKER=demo` to show a booked room on stage. Still open: `/pay` (step 10), tutor availability overrides (`PUT /me/tutor-availability`), `POST /tutoring/requests`.

- `PUT /me/tutor-profile` and `GET /me/tutor-eligibility` (using `meetsThreshold`).
- `GET /tutors`: load candidates, both schedules and the library location, call `findTutorMatches`, and join `UserPublic` and `TutorProfile`.
- `POST /tutoring/sessions`, `/counter`, `/accept`, `/decline` use `counterSession`/`acceptSession` and `priceFor`.
- On accept with `library_room`, call `RoomBooker` (stub returns `manual_required` + a booking URL) and store `room_booking`.
- Realtime: a `tutoring.updated` broadcast on `user:{id}` for both sides.
- **Done when:** the full Demo 1 script runs against seeded personas.

### 8. Demo 2a: ingest → listing → "your class needs this" ✅
> Done: `routes/admin.ts` + `workers/ingest.ts` (runs inline; the job row records the result), `routes/listings.ts` (`/feed`, `/explore/listings`, `/listings`, `/me/listings`), `routes/notifications.ts`. Media must be uploaded to `public-media` (purpose `listing`) to show on the listing. Still open: `PATCH /listings/{id}`, Claude vision identifier (caption parsing only for now), job queue, wishlist.

- `POST /admin/ingested-posts` (admin key header) stores the post and queues an `ingest_classify` job.
- Job runner: start with an in-process queue (a `jobs` table plus a polling loop) and move to Inngest or pg_cron later. The job uses `TextbookIdentifier` (stub, then Claude vision), `normalizeIsbn` and `CourseMaterialsLookup`, then creates a `Listing` with `external_seller` and `source.claimed=false`.
- Then `interestedStudents` sends `material.match` + a notification to each matching student. `GET /feed` returns `reason: your_class` + `reason_course`.
- **Done when:** posting a fake Instagram post makes it appear in the CH 101 buyer's feed with "You're in CH 101".

### 9. Demo 2b: offers + claim link ✅
> Done: `routes/offers.ts`, `routes/claims.ts`, `/admin/seller-invites`. Cash offers only (trades later). Still open: rate limits on `/claims`, offer expiry job.

- `POST /listings/{id}/offers` uses `openOffer`. The first offer on an unclaimed listing creates a `SellerInvite` (`newClaimToken`, `sellerInviteMessage`).
- `GET /admin/seller-invites` shows the DM text to copy-paste from the team Instagram, and `/sent` marks it sent.
- `GET /claims/{token}` (public preview) and `POST /claims/{token}` (signed in): attach the listings to the user and run `afterClaim` on their offers.
- `/offers/{id}/accept|decline|counter|withdraw` use `actOnOffer`. Accepting creates the `Order` with `splitAmount`.
- **Done when:** buyer offers → the invite appears → the seller opens the link, signs in, sees the offer, accepts → an order exists.

### 10. Demo 2c: Stripe escrow 🧑
> Demo stand-in done: `PAYMENTS=demo` marks the order paid and opens the handoff (`routes/orders.ts`), plus `/orders/{id}`, `/me/orders`, `/orders/{id}/cancel`. Real Stripe below is still to do.

- 🧑 Create a Stripe account in test mode, enable Connect (Express), and add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PUBLISHABLE_KEY`.
- `POST /orders/{id}/pay` creates a PaymentIntent on the platform (separate charges and transfers) and returns `client_secret`.
- `POST /webhooks/stripe`: on `payment_intent.succeeded`, run `nextOrderStatus(…, "payment_succeeded")` and create the `Handoff` or wait for a shipment.
- Payout: once an order is `completed`, call `payoutFor`. If the status is `released`, make a Stripe transfer to the seller's account.
- `POST /payments/onboard` and `GET /payments/status` cover Express onboarding.
- **Done when:** a test card pays, the order turns `paid`, and the money is held on the platform balance.

### 11. Demo 2d: in-person handoff
- `POST /handoffs/{id}/suggest` loads both schedules and the safe zones, then calls `suggestMeetups`. Add `/propose` and `/agree` (order becomes `scheduled`).
- `/location` broadcasts presence. `/code` is giver-only and needs the giver inside the zone, which sets `giver_at`.
- `/confirm` calls `confirmHandoff`, which completes the order (and releases the payout) or opens a dispute.
- Realtime: `handoff.updated`, `handoff.presence`, `handoff.completed`.
- **Done when:** two phones at Ferguson complete the QR scan and the seller's payout shows `released`.

### 12. Demo 2e: campus mail
- `GET /mail/drop-off-points`. `POST /orders/{id}/shipment` calls `buildLabel` + `LabelRenderer` (stub; real PDF later with pdfkit or similar, which will need your OK as a new dependency).
- `/dropped-off` calls `verifyDropOff` (order becomes `in_transit`), and `/received` calls `verifyReceived` (order becomes `completed`).
- Timer: auto-complete when `auto_complete_at` passes.
- **Done when:** the seller prints a label, "drops off" inside the geofence with a photo, the buyer types the code, and the order completes.

### 13. Demo hardening
- `pnpm seed:demo` resets to a known state. A rehearsal script hits every call in both demo flows in order.
- Rate limits on public endpoints (`/claims`, `/auth/check-email`).
- Generate the OpenAPI spec from the Zod schemas (adds `@hono/zod-openapi`, which needs your OK as a dependency) so the Swift and web clients get typed SDKs.

## Later (external integrations)

| Stub now | Real thing later |
|---|---|
| `POST /admin/ingested-posts` by hand | Instagram: share-sheet or screenshot flow (scraping breaks Instagram's terms; see the open questions in the contract) |
| `captionTextbookIdentifier` | Claude vision with a JSON schema (`ANTHROPIC_API_KEY`) |
| `staticCourseMaterials` / seeded table | UA bookstore list |
| `manualOutreach` (copy-paste DM) | Automated DM, or sellers tagging us |
| `noDirectory` (buyer types their mail stop) | UA directory lookup |
| `manualRoomBooker` (link to booking page) | Library booking API, if UA's system has one |
| `placeholderLabelRenderer` | PDF label generation |
