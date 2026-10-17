# Supabase

| File | What |
|---|---|
| `migrations/0001_core.sql` | Schools, profiles, campus places, academics, schedules, media, jobs, idempotency |
| `migrations/0002_market.sql` | Ingested posts, listings, seller claim invites, offers, orders, handoffs, shipments, notifications |
| `migrations/0003_tutoring.sql` | Tutor profiles, sessions, reviews, `tutor_stats` view |
| `seed.sql` | UA reference data (school, buildings, safe zones, mail drop-off, courses, textbooks). Safe to re-run. |

We use **one hosted project** shared by the whole team, because the demo phones need to reach it.

## Create the project (once)

1. On [supabase.com](https://supabase.com), create a new project on the free tier, in the region closest to Alabama (`us-east-1`). Save the database password in the team password manager.
2. In **Project Settings → API Keys**, copy these values into `backend/.env` (never commit that file):
   - `SUPABASE_URL`: the project URL, `https://<ref>.supabase.co`
   - `SUPABASE_ANON_KEY`: the **publishable** key (`sb_publishable_…`), or the legacy `anon` key
   - `SUPABASE_SERVICE_ROLE_KEY`: the **secret** key (`sb_secret_…`), or the legacy `service_role` key. Server only.
   - `SUPABASE_JWT_SECRET`: only if the project still uses the legacy JWT secret; otherwise leave it empty and the API verifies tokens against the project's JWKS.
3. Apply the schema and seed. **Option A** (recommended, so later migrations are one command):

   ```bash
   pnpm dlx supabase login
   ```

   ```bash
   pnpm dlx supabase init
   ```

   ```bash
   pnpm dlx supabase link --project-ref <ref>
   ```

   ```bash
   pnpm dlx supabase db push --include-seed
   ```

   Answer **no** to the VS Code/Deno prompts in `init`; it only adds `supabase/config.toml`, and that file is safe to commit.

   **Option B** (no CLI): in the dashboard's **SQL Editor**, run `0001_core.sql`, `0002_market.sql`, `0003_tutoring.sql` and then `seed.sql`, in that order.
4. Check that **Table Editor** shows `schools` with one row (The University of Alabama).

The auth hook, OTP email settings and Storage buckets come in roadmap steps 4–5.

## Changing the schema

Add a new numbered file (`0004_….sql`); never edit a migration that has already been pushed. Run `pnpm dlx supabase db push`, and update `docs/API_CONTRACT.md` in the same PR if a response shape changes.

## Turn on the .edu sign-up hook (after `db push`)

1. Dashboard → **Authentication → Hooks → Before User Created** → **Postgres** → schema `public`, function `hook_before_user_created` → Save.
2. **Authentication → Sign In / Providers → Email**: keep Email on, turn **Confirm email** on, and set **Email OTP length** to 6.
3. **Authentication → Emails → Magic Link** template: replace the link with `{{ .Token }}` so the email shows the 6-digit code.

Without step 1 the triggers still block non-school emails, but the app gets a generic "Database error saving new user" instead of a clear message.

## Demo users

`cd backend && pnpm seed:demo` creates the personas and resets their demo state (safe to re-run).
`pnpm seed:demo otp student` prints a sign-in code for a persona; no email is sent, so the fake `@crimson.ua.edu` addresses work.
