# MVP TODO

Status as of 2026-10-17. Every endpoint in `API_CONTRACT.md` now exists except Katelyn's four Stripe ones. Hosted Supabase has migrations 0001–0018. 284 tests pass. **None of the new modules (social, wishlist, rides, tickets, study groups, misc) has run against the live database yet**, so item 1 matters most.

## 1. Demo blockers (do first)

- [ ] **Live smoke test of every new module (backend).** Run `pnpm dev` against hosted Supabase. As two demo users, hit each new endpoint once, then fix what breaks. The tests only cover pure logic and request validation, so SQL, RLS and the joins are unproven. Listings are the riskiest: `LISTING_SELECT` now joins `events`, and the wishlist and ticket hooks run on publish.
- [ ] **Instagram tokens (buddy, then Alex).** Follow `instagram-steps-for-buddy.md`. handoff.scout is the app account and darealkorirussell is the seller. Paste the two tokens into `backend/.env` (`INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_SELLER_TOKEN`), then do one live run: post a story → it lists → DM. That will surface whatever differs between the real API and our code (story `media_url`, conversations shape, window error codes).
- [ ] **AI adapter (Kori).** Implement `TextbookIdentifier` (`backend/src/adapters/ports.ts`) on Gemma and swap it in at `backend/src/index.ts:24`. One adapter powers screenshot → listing, identify-textbook, Instagram and GroupMe ingest. Without it those return empty drafts or "couldn't find an ISBN".
- [ ] **Stripe (Katelyn).**
  - Merge `feat/stripe-marketplace` and `feat/stripe-tutoring`.
  - Renumber `0013_tutoring_escrow.sql` to **0019** first: 0013 is wishlist on the hosted DB. Her `0012_stripe_events.sql` is already applied and already on main, unchanged.
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

- [ ] Decide where the API runs for the demo (laptop or Fly/Railway). The LibCal booker needs the booking Chrome on the same machine as the API.
- [ ] Delete the merged `worktree-agent-*` branches and worktrees, plus the leftover remote branches (`codex/*`, old `feat/*`).
- [ ] Rotate the Instagram account passwords after the hackathon (they were shared in chat).
