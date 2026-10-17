# MVP TODO

Status as of 2026-10-17 (evening). Every endpoint in `API_CONTRACT.md` exists except Katelyn's four Stripe ones. Hosted Supabase has 0001–0018 from main, plus Katelyn's `0019_tutoring_escrow` (applied from `feat/stripe-tutoring`, not merged yet). 284 tests pass, and `pnpm smoke` runs every new module against the live DB and passes.

## 1. Demo blockers (do first)

- [x] **Live smoke test of every new module.** `pnpm smoke` (as Jordan and Ava; cleans up after itself). Fixed review timestamps and digital_transfer offers on ticket listings.
- [ ] **Deploy for the demo: API on a laptop behind an https tunnel, web stays on Vercel.** The iOS app's `apiBaseURL` is still `http://localhost:8787` (`frontend/ios/Handoff/Data/APIClient.swift:5`), which a real iPhone can't reach. Don't put the backend on Vercel: serverless kills the Instagram poller, the order timers and the fire-and-forget AI jobs, and the LibCal booker needs the signed-in Chrome on the same machine. Run `pnpm dev`, start a tunnel (`cloudflared tunnel --url http://localhost:8787`), then point `apiBaseURL`, Vercel's `NEXT_PUBLIC_API_BASE` (with `NEXT_PUBLIC_USE_MOCKS=false`) and `WEB_ORIGIN` at it.
- [x] **Instagram tokens.** Both are in `backend/.env` and valid (handoff.scout = app account, darealkorirussell = seller, both Creator). A story posted from darealkorirussell's phone reaches the poller and the image is saved to storage; text typed on the story comes through baked into the image.
- [ ] **Instagram DMs.** The API sees no conversations on either account, so it can't DM yet. On both phones: Settings → Messages and story replies → Message controls / Connected tools → **Allow access to messages** ON, and accept the chat if it's in Requests. Then retest `POST /admin/instagram/dm`.
- [ ] **AI adapter (Kori).** Implement `TextbookIdentifier` (`backend/src/adapters/ports.ts`) on Gemma and swap it in at `backend/src/index.ts:24`. One adapter powers screenshot → listing, identify-textbook, Instagram and GroupMe ingest. Without it those return empty drafts or "couldn't find an ISBN".
- [ ] **Stripe (Katelyn).**
  - Merge `feat/stripe-marketplace` and `feat/stripe-tutoring`.
  - Migrations are sorted: her 0012 is on main unchanged, and `0019_tutoring_escrow` is already applied to the hosted DB.
  - Endpoints left: `POST /payments/onboard`, `GET /payments/status`, `POST /webhooks/stripe`, `POST /tutoring/sessions/{id}/pay`.
  - Make sure `PAYMENTS=demo` still works for the demo.
- [ ] **Frontend (Codex).** Paste prompts A (Live Sources) and B (library rooms) from `codex-prompts-instagram-library.md`. Then add screens for:
  - friends and suggested friends
  - wishlist and matches
  - tickets / events
  - rides
  - study groups
  - user profiles
- [ ] **Demo seed.** Run `pnpm seed:demo` on hosted DB (it now seeds UA events and an Iron Bowl ticket). Check the demo story has the students, classes, tutors and listings it needs.
- [ ] **Rehearse twice.**
  - The booking Chrome is up and signed into UA (`pnpm libcal browser`, then `pnpm libcal login` once).
  - darealkorirussell DMs "yo" to handoff.scout less than 24 h before going on stage.
  - The UA account has no Team Workroom booked that day.
  - Cancel the Sun Oct 18 3–4 pm test booking (Work Space 2) from the LibCal email.

## 2. Gaps the new modules left (backend, after the demo works)

- [ ] **Tickets:** app-transfer tickets should auto-release funds when the event starts with no dispute (add to `workers/order-timers.ts`).
- [ ] **Tickets:** after a digital-transfer order is paid, the seller is told "Print the campus-mail label". Fix that one line in `/pay` in `routes/orders.ts` (coordinate with Katelyn).
- [ ] **Rides:** bookings don't use orders or escrow. In `PAYMENTS=stripe`, book and accept return 503, and there's no driver payout. Hook into Stripe once it lands.
- [ ] **Rides:** add an admin endpoint to verify drivers. Outside demo mode they stay `pending` forever.
- [ ] **Push:** subscriptions are stored but nothing sends. Plug into `notify()` in `lib/notify.ts` (web-push and APNs need new deps, so ask first). Add a DELETE endpoint to unsubscribe.
- [ ] **Google Calendar:** nothing registers watch channels (`events.watch`), so webhook pings are all "unknown". Also re-fetch busy times when `needs_refresh` is set.
- [ ] **GroupMe:** image attachments aren't copied, so only the text is classified. Ride-request classification isn't built; `ingested_posts.ride_request` is always null.
- [ ] **Syllabi:** photo syllabi leave a queued job. Add a model-backed `SyllabusParser` (Kori) for them; PDFs already parse without AI.
- [ ] **Wishlist:** `on_wishlist` in `GET /me/upcoming-materials` is always false.
- [ ] **Paging:** most new lists cap at 20–100 and never return `next_cursor`.
- [ ] **Cleanup:** `study-groups.ts` has a copy of tutoring's `freeTimeFor`. Export the original and remove the copy.

## 3. Contract doc updates (so the frontend isn't surprised)

- [ ] New notification types: `friend_request.created`, `friend_request.accepted`, `wishlist.match`, `ride.updated`, `study_group.joined`, `report.created`, `tutoring.request`.
- [ ] Extras beyond the contract:
  - `WishlistItem.category`
  - `GET /rides/{id}`
  - optional `price_per_seat_cents` on ride-request accept
  - `meeting_url` on `POST /study-groups`
  - book-ride response includes `demo` and `ride`
- [ ] Behaviour notes:
  - A repeat friend request returns the existing one (200).
  - A duplicate report within 24 h returns 409 `RATE_LIMITED`.
  - `/users/{id}` `mutual_friends` is real now.
  - Ticket listings get their `fulfillment` set from `ticket.transfer`.
- [ ] New env vars: `GROUPME_WEBHOOK_SECRET`, `GROUPME_SCHOOL_ID`.

## 4. Ops

- [ ] Delete the merged `worktree-agent-*` branches and worktrees, plus the leftover remote branches (`codex/*`, old `feat/*`).
- [ ] Rotate the Instagram account passwords after the hackathon (they were shared in chat).
