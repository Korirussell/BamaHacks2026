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
