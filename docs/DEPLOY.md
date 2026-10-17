# Deploy (Vercel)

Two Vercel projects in **korirussell's projects** (Hobby), both from this repo:

| Project | Root Directory | Production URL | What it is |
|---|---|---|---|
| `web` | `frontend/web` | https://web-navy-tau-cbiw53nkby.vercel.app | Next.js site (mock demo by default) |
| `bamahacks-api` | `backend` | https://bamahacks-api.vercel.app | Hono API as one Vercel function (`backend/api/index.js`, `backend/vercel.json`) |

Every push builds both. Preview URLs per branch look like `web-git-<branch>-korirussells-projects.vercel.app` and `bamahacks-api-git-<branch>-korirussells-projects.vercel.app`. Hobby builds **one at a time** across the team, so a queue is normal.

Health check: `GET https://bamahacks-api.vercel.app/api/v1/health` → `{"data":{"ok":true}}`.

## Environment variables

Secret values live only in Vercel and in each dev's own `backend/.env`. **Never commit them or paste them in chat.** Ask Katelyn or Kori for access to the Vercel project to see/edit them.

### `bamahacks-api` (Production + Preview)

| Variable | Value | Secret? |
|---|---|---|
| `SUPABASE_URL` | `https://ovrpypgweuadygjefdmy.supabase.co` | no |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon/publishable key | public-ish |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role | **yes** |
| `SUPABASE_JWT_SECRET` | Supabase → Project Settings → API → JWT secret | **yes** |
| `STRIPE_SECRET_KEY` | Stripe (test mode) → Developers → API keys → `sk_test_…` | **yes** |
| `STRIPE_PUBLISHABLE_KEY` | Stripe → `pk_test_…` | no |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the Stripe webhook endpoint that points at this API (see below), `whsec_…` | **yes** |
| `PAYMENTS` | `stripe` (`demo` = no cards) | no |
| `PLATFORM_FEE_BPS` | `500` (5% from the seller) | no |
| `WEB_ORIGIN` | `https://web-navy-tau-cbiw53nkby.vercel.app,https://*.vercel.app,http://localhost:3000` (first = app URL in links; all = CORS) | no |
| `TOKEN_ENCRYPTION_KEY` | 32+ random chars (encrypts Google tokens) | **yes** |
| `HANDOFF_SECRET` | 32+ random chars (signs meetup QR codes), e.g. `openssl rand -hex 32` | **yes** |
| `ORDER_TIMERS` | `off` (no long-running process on Vercel; see the cron sweep, PR #9) | no |
| `INSTAGRAM` | `off` | no |
| `ROOM_BOOKER` | `manual` | no |
| `PORT` | ignored on Vercel | no |
| `GOOGLE_REDIRECT_URI`, `APP_URL_SCHEME`, `SCHOOL_TIMEZONE` | optional | no |
| `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID/SECRET`, `APNS_*`, `VAPID_*`, `GROUPME_BOT_TOKEN`, `RESEND_API_KEY` | optional, empty is fine | **yes** when set |
| `CRON_SECRET` | needed once PR #9 (cron sweep) is merged; random string | **yes** |

Deployment Protection is **off** on `bamahacks-api` (browsers and Stripe must reach it; the API checks Supabase tokens itself).

### `web`

| Variable | Environments | Value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production + Preview | same as the API's `SUPABASE_ANON_KEY` (public by design) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Production + Preview | `pk_test_…` (public by design, never `sk_`) |
| `NEXT_PUBLIC_USE_MOCKS` | Preview (branch `feat/web-api-connect`) | `false` |
| `NEXT_PUBLIC_API_BASE` | Preview (branch `feat/web-api-connect`) | `https://bamahacks-api-git-feat-web-api-connect-korirussells-projects.vercel.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | Preview (branch `feat/web-api-connect`) | `https://ovrpypgweuadygjefdmy.supabase.co` |

Production web is still the **mock demo** (`NEXT_PUBLIC_USE_MOCKS` unset). To make production talk to the real API, add for Production: `NEXT_PUBLIC_USE_MOCKS=false`, `NEXT_PUBLIC_API_BASE=https://bamahacks-api.vercel.app`, `NEXT_PUBLIC_SUPABASE_URL=https://ovrpypgweuadygjefdmy.supabase.co`, then redeploy `web`.

`NEXT_PUBLIC_*` values are baked in at build time: change one, then **redeploy**.

## Stripe webhook

Stripe (test mode) → Developers → Webhooks → endpoint `https://<api host>/api/v1/webhooks/stripe` with events `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, `account.updated`. Its signing secret goes in `STRIPE_WEBHOOK_SECRET` on `bamahacks-api`, then redeploy. Locally use `stripe listen --forward-to localhost:8787/api/v1/webhooks/stripe` instead (it prints its own `whsec_`).

## Local dev

- API: `cd backend && pnpm install && pnpm dev` with `backend/.env` (copy `.env.example`).
- Web real mode: `frontend/web/.env.local` with the five `NEXT_PUBLIC_*` values above (`NEXT_PUBLIC_API_BASE=http://localhost:8787` for a local API), then `npm run dev`.
- Demo sign-in: `cd backend && pnpm seed:demo otp buyer` prints a code; on `/signin` enter `bamahacks.buyer@crimson.ua.edu`, click **I already have a code**. Test card `4242 4242 4242 4242`.
