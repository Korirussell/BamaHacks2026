# Handoff: payments + live deploy (from Katelyn's Claude session)

> **Paste this to your Claude to start:** "Read HANDOFF.md, docs/DEPLOY.md and docs/API_CONTRACT.md in this repo. Work on a new branch off latest main (never commit to main), keep syncing with origin/main, and don't break the API contract (additive changes only; ask first). Never print, commit or paste secrets. Start with the 'Do next' list."

Repo: `Korirussell/BamaHacks2026`. Everything below is **merged to `main`** (latest `e5ab144`) and deployed. No secrets in this file. The values are in Katelyn's team secure store (copied from the local, gitignored `backend/.env.team`).

## Live
- **Web:** https://web-navy-tau-cbiw53nkby.vercel.app (Vercel project `web`, root `frontend/web`, **real mode** in production)
- **API:** https://bamahacks-api.vercel.app/api/v1 (Vercel project `bamahacks-api`, root `backend`, health at `/health`)
- **DB:** Supabase `ovrpypgweuadygjefdmy`. All migrations through `0019` are applied, and `supabase db push --dry-run` reports it's up to date.
- **Stripe:** test mode ("Handoff sandbox" account), Connect enabled as a marketplace. The webhook endpoint `we_1UReKzFD24xt93ZLmpvAdrCE` points at `https://bamahacks-api.vercel.app/api/v1/webhooks/stripe`.
- **Docs:** `docs/DEPLOY.md` (every Vercel env var and where it comes from), `docs/FRONTEND_NOTES.md` (Card payments section), `docs/API_CONTRACT.md`.

## What was built (PRs #6–#12)
- **#6 Stripe marketplace:**
  - Escrow `PaymentProvider`: PaymentIntent on pay, Transfer to the seller on handoff, Refund on cancel/no-show.
  - `POST /webhooks/stripe` (`routes/stripe-webhook.ts`) with a signature check and `stripe_events` dedupe.
  - Connect Express onboarding: `POST /payments/onboard`, `GET /payments/status`. Seller accounts are created with **Accounts v2**, because Stripe rejects v1 creation for new platforms.
- **#7 Tutoring pay:** `POST /tutoring/sessions/{id}/pay` with escrow (migration 0019). `client_secret` is nullable in demo mode; the user approved that contract change.
- **#8 Web ↔ API, API on Vercel:**
  - `backend/api/index.js` + `backend/vercel.json`; `buildServer()` in `src/server.ts`.
  - `WEB_ORIGIN` is a comma-separated list (CORS wildcards; the first entry is the app URL in links).
  - Web real mode (`frontend/web/lib/real.ts`): sign-in, feed, listing, buy at price, Stripe Payment Element pay.
- **#9 Timers on Vercel:** `POST /internal/sweep` with a `CRON_SECRET` bearer; daily Vercel cron. It was verified on production (401 without the secret, a clean pass with it).
- **#10:** `docs/DEPLOY.md`.
- **#11 Web payouts page:** `/settings/payments` (Profile → Payouts, plus a seller banner on the order page).
- **#12 Password sign-in:** "Use a password instead" on `/signin`, plus `pnpm demo:password <persona>` (hidden prompt, only for `bamahacks.*` personas).

## Verified
- **Card payment on the branch preview:** card → webhook → order `paid`, money held in escrow.
- **Locally against test-mode Stripe:**
  - Declined card, then retry with a good card.
  - Refund after cancel.
  - Seller onboarding.
  - Both-tap and QR meetup → $19 transfer to the seller.
  - Tutoring pay, refund, and payout after onboarding ($23.75).
- **Production:** API health; the web bundle points at the prod API; CORS; the sweep; `/settings/payments` and the password sign-in option are live.

## Do next (in order)
1. **Set demo passwords (Katelyn, about 1 min, one time):**
   - From `backend/`, run `pnpm demo:password buyer` and then `pnpm demo:password seller`.
   - It prompts for the password with hidden input. Store the passwords in the team secure store.
   - During the demo: on `/signin` → **Use a password instead** → `bamahacks.buyer@crimson.ua.edu` or `bamahacks.seller@crimson.ua.edu`.
2. **Dry-run the demo on the live site:**
   - Sign in as the buyer, buy a listing, and pay with test card `4242 4242 4242 4242` (any future date and CVC).
   - Check that the order shows paid.
   - Sign in as the seller → Profile → Payouts should show **On**.
   - Nobody has done a full purchase on the production URL yet; it was done on the branch preview.
3. **iOS:** `main` points the iOS `apiBaseURL` at an ngrok tunnel. Point it at `https://bamahacks-api.vercel.app` so it works without someone's laptop.
4. **Meetup on the web:** the handoff, meetup, post, offers and tutoring screens are still mocked on the web. Completing a trade (which releases the seller payout) currently happens through the API or iOS (`/handoffs/{id}/tap` or the QR `/code` + `/confirm`).
5. **Timers:** the Vercel Hobby plan runs the cron daily only. For faster cleanup, use an external pinger: `POST https://bamahacks-api.vercel.app/api/v1/internal/sweep` with header `Authorization: Bearer $CRON_SECRET`.
6. **After the hackathon:**
   - Rotate the Stripe, Supabase, `HANDOFF_SECRET`, `TOKEN_ENCRYPTION_KEY` and `CRON_SECRET` values.
   - Delete `backend/.env.team` and `backend/.env.vercel` (local, gitignored).

## Setup on a fresh machine (teammate)
1. `git clone https://github.com/Korirussell/BamaHacks2026 && cd BamaHacks2026 && git pull origin main`
2. **Backend:**
   - `cd backend && pnpm install`. This needs pnpm 11, and `pnpm-workspace.yaml` already allows the esbuild build.
   - Create `backend/.env` from `.env.example`. The values are in the team secure store.
   - `pnpm dev` runs the API at http://localhost:8787/api/v1.
   - `pnpm -s typecheck && pnpm -s test` should show all tests passing.
3. **Web:**
   - `cd frontend/web && npm ci`.
   - For real mode locally, create `frontend/web/.env.local` with the five `NEXT_PUBLIC_*` values from `docs/DEPLOY.md`. Use `NEXT_PUBLIC_API_BASE=http://localhost:8787` or `https://bamahacks-api.vercel.app`.
   - `npm run dev` serves http://localhost:3000.
4. **Supabase CLI** (only for new migrations): `pnpm dlx supabase link --project-ref ovrpypgweuadygjefdmy`, then `pnpm dlx supabase db push --dry-run` before any real push. **Ask the team before pushing migrations to the live DB.**
5. **Stripe CLI** (only for local webhooks):
   - If `brew install` fails on macOS 26, download the binary from https://github.com/stripe/stripe-cli/releases instead.
   - Run `stripe login`.
   - Run `stripe listen --forward-to localhost:8787/api/v1/webhooks/stripe --forward-connect-to localhost:8787/api/v1/webhooks/stripe`.
   - Put the `whsec_` it prints into `backend/.env` as `STRIPE_WEBHOOK_SECRET`. This is only for local use; Vercel has its own secret.

## Vercel runbook
**Access:** both projects live under the Vercel team **korirussell's projects** (Hobby). Sign in at https://vercel.com with the account that owns it (Kori), or have Kori invite you to the team. On Hobby, the team owner may need to log in.

| Task | Where in Vercel |
|---|---|
| See deploys / why one failed | Project → **Deployments** → click the deploy → **Build Logs** (build errors) or **Logs** (runtime errors, e.g. a 500 from the API) |
| Redeploy (after changing an env var) | Project → **Deployments** → newest deploy → **⋯** → **Redeploy** (leave "Use existing Build Cache" unchecked) |
| Cancel a stuck or queued build | Deployments → the queued deploy → **⋯** → **Cancel**. Hobby builds **one at a time across the whole team**, so cancel stale ones to unblock the queue. |
| Add or change env vars | Project → **Settings → Environment Variables** → **Add Environment Variable**. You can paste a whole `KEY=value` block into the Key box and it splits into rows. Choose Production and/or Preview. Then **redeploy** that project. |
| Root Directory | Settings → **Build and Deployment** → Root Directory: `web` = `frontend/web`, `bamahacks-api` = `backend`. If this is wrong, the build fails with "Couldn't find any pages or app directory". |
| Deployment Protection | Settings → **Deployment Protection**. It is **off on `bamahacks-api`** (browsers and Stripe must reach it). On `web` it's the default (previews need a Vercel login; production is public). |
| Domains | Settings → **Domains**: `web-navy-tau-cbiw53nkby.vercel.app` (web), `bamahacks-api.vercel.app` (API). If you add a custom domain to `web`, also add it to `WEB_ORIGIN` on `bamahacks-api` (CORS) and redeploy the API. |
| Crons | `bamahacks-api` → **Settings → Cron Jobs** (defined in `backend/vercel.json`). Hobby = once a day. |

**How deploys happen:** every push to any branch builds both projects (preview). A merge to `main` builds **production** for both. PR checks "Vercel – web" and "Vercel – bamahacks-api" must be green before merging.

**Env var rules:**
- Values marked Sensitive can't be read back in Vercel. The source of truth is the team secure store.
- `NEXT_PUBLIC_*` (web) are public and baked in at build time, so redeploy `web` after changing them. Mark them "safe" if Vercel warns, because they are meant to be public.
- On `bamahacks-api`, keep `ORDER_TIMERS=off`, `INSTAGRAM=off`, `ROOM_BOOKER=manual`, and `PAYMENTS=stripe`.
- `CRON_SECRET` is set for Production only.
- To switch the web back to the scripted mock demo: delete `NEXT_PUBLIC_USE_MOCKS` from **web → Production**, then redeploy. Set it back to `false` for real mode.

**If the API returns 500 on Vercel:**
1. Check `bamahacks-api` → Logs.
2. If you see "PAYMENTS=stripe needs …", a Stripe env var is missing.
3. If you see `loadConfig` errors, check the variable it names.
4. After fixing an env var, redeploy.

**If payments stay "processing":**
1. Stripe Dashboard (test mode) → Developers → **Webhooks** → endpoint `we_1UReKzFD24xt93ZLmpvAdrCE` → check the recent deliveries.
2. A 400 there means a signature mismatch: `STRIPE_WEBHOOK_SECRET` on Vercel must equal that endpoint's signing secret (Reveal it in Stripe, paste it into Vercel, redeploy).
3. Changing the endpoint's URL keeps the same secret.

## Supabase / Stripe dashboards
- **Supabase:** https://supabase.com/dashboard/project/ovrpypgweuadygjefdmy (AlexGundrum's Org).
  - Auth → Users shows the demo personas.
  - Table Editor → `orders`, `escrow_entries`, `stripe_events`, `tutoring_sessions` shows money state.
- **Stripe** (test mode, "Handoff sandbox"): https://dashboard.stripe.com/test.
  - Payments shows PaymentIntents.
  - Connect → Connected accounts shows sellers (Sam, Ava are onboarded).
  - Developers → Webhooks / Logs.

## Accounts and access the teammate needs
- **Secrets:** ask Katelyn for the team secure-store entry (it holds every value for both Vercel projects, `backend/.env`, and the demo passwords once set).
- **Vercel:** team "korirussell's projects", owned by Kori. Project IDs: `web` = `prj_yYX7Bg9hIdKDMI8ySWwx2knpXuKr`, `bamahacks-api` = `prj_9rz1m4OI8VKLZWLh7SinhEEO7xud`.
- **Stripe:** test-mode account "Handoff sandbox" (`acct_1URdGkFD24xt93ZL`). Ask its owner to invite you under Settings → Team. Connected test sellers: Sam (seller) and Ava (tutor).
- **Supabase:** AlexGundrum's Org → project `ovrpypgweuadygjefdmy`. Ask Alex for access.
- **GitHub:** `Korirussell/BamaHacks2026`. Work on branches and open PRs; main is the deploy branch.

## Demo data on the live DB
- **Personas** (`pnpm seed:demo` resets them):
  - buyer = Riley Carter
  - seller = Sam Rivera (payouts **on**)
  - ava = Ava Thompson (tutor, payouts **on**)
  - student = Jordan Lee (no payouts yet, good for showing onboarding)
- **Listings:** 8 live listings from Sam and Ava ($8–$60), plus Sam's Iron Bowl ticket. To mint a sign-in code instead of a password, run `pnpm seed:demo otp <persona>`, then use **I already have a code**.

## Gotchas
- **Vercel Hobby builds one deploy at a time across the team.** A queue is normal; cancel stale builds.
- **`NEXT_PUBLIC_*` values are baked in at build time.** Change one, then redeploy `web`. To show the old scripted mock demo, delete `NEXT_PUBLIC_USE_MOCKS` from web Production and redeploy.
- **The Supabase built-in mailer won't email the fake persona inboxes.** Use a password or the `seed:demo otp` code.
- **The account sync isn't automatic in production.** Stripe's `account.updated` event comes from a separate "Connected accounts" webhook with its own secret. The API checks only one secret, so seller status refreshes on `GET /payments/status`, which the payouts page calls.
- **Don't break `docs/API_CONTRACT.md`** (Alex owns it). Changes must be additive, and ask first.
