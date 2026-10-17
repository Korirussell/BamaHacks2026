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
- `src/lib/errors.ts`: `ApiError` + the contract's error codes

Scripts: `pnpm dev`, `pnpm typecheck`, `pnpm build`, `pnpm start`.
