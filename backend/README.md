# Backend

Hono + Zod TypeScript API. Every route follows [`../docs/API_CONTRACT.md`](../docs/API_CONTRACT.md).

```bash
pnpm install
cp .env.example .env   # fill in keys
pnpm dev               # http://localhost:8787/api/v1
```

- `src/index.ts`: app setup, CORS, error handler, `/api/v1` mount
- `src/routes/`: one file per module (see contract Part 2)
- `src/schemas/`: Zod schemas for the contract's shared objects
- `src/services/`: pure domain logic (availability, tutoring, meetups, handoff codes, orders, offers, claims, mail); no DB access, unit tested
- `src/adapters/`: interfaces for external services (`ports.ts`) + demo stubs (`stubs.ts`)
- `src/lib/errors.ts`: `ApiError` + the contract's error codes

Scripts: `pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm start`.

Build plan: [`../docs/BACKEND_ROADMAP.md`](../docs/BACKEND_ROADMAP.md).

## Order timers on Vercel

On Vercel (`api/index.js`) nothing long-running survives, so set `ORDER_TIMERS=off` there and let Vercel Cron call `GET /api/v1/internal/sweep` instead. Each call runs one pass of the timers: unpaid orders cancel, campus-mail orders auto-complete, offers expire, overdue meetups resolve (`sweepOverdueHandoffs`). The route needs `Authorization: Bearer $CRON_SECRET`; Vercel sends that header itself when the project has a `CRON_SECRET` env var. Without `CRON_SECRET` the route returns 403. It is internal and not part of the API contract.

`vercel.json` schedules it once a day (`0 9 * * *`) because the Hobby plan only allows daily crons. The timers expect about one pass a minute (unpaid orders should cancel ~30 min after creation), so for real use either move to Pro and set the schedule to `* * * * *`, or have an external pinger (cron-job.org, a GitHub Actions schedule, UptimeRobot) send `POST /api/v1/internal/sweep` with the same bearer every minute.
