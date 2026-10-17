# Demo screens for Codex (ALEX_MAIN)

Every call below was run live against the API on 2026-10-17 and works. What's missing is the screens.
Demo first: no real auth, no polish beyond what the stage needs.

## Ground rules

- Branch off `ALEX_MAIN` (`git switch -c codex/demo-screens ALEX_MAIN`) in your own worktree. Never push `main`.
  ALEX_MAIN is checked out in `BamaHacks2026-main`, so you can't check it out too: use your branch, Alex merges it.
- Web: `frontend/web`, real mode (`NEXT_PUBLIC_USE_MOCKS=false`). Use `request()` in `lib/api.ts`: it carries the
  demo session (`demoLogin(email)`, also set from `/signin` and the persona picker) and adds the ngrok header.
- iOS: same endpoints through `APIClient`.
- API: `http://localhost:8787/api/v1` (Simulator / local web) or `https://sled-maker-outshoot.ngrok-free.dev/api/v1`.
  Backend runs with `DEMO_AUTH=on` and `PAYMENTS=demo` (paying needs no card).
- Personas: `bamahacks.student@crimson.ua.edu` (Jordan, needs a CH 101 tutor, buyer) and
  `bamahacks.ava@crimson.ua.edu` (Ava, CH 101 tutor and seller). CH 101 = `00000000-0000-4000-e000-000000000001`.
- **On stage nobody is at the meetup spot.** Endpoints that check GPS (`/handoffs/:id/tap`, `/handoffs/:id/code`,
  `/handoffs/:id/confirm`, `/shipments/:id/dropped-off`) must get the spot's own coordinates in the demo: send
  `safe_zone.location` / `drop_off.location` with `accuracy_m: 10`, not the device location.
- Already done, don't redo: web `/signin` (persona buttons) and the web Instagram claim page `/claim/[token]`
  (preview → one tap claims with no login → Accept an offer → `/orders/{id}`).

## 1. Tutor match → time → library room (student Jordan, tutor Ava)

1. Pick a course, then `GET /tutors?course_id=<id>&from=<iso now>&to=<iso +6 days>` returns an array of matches. Each match has:
   - `tutor`: `display_name`, `id`
   - `grade`, `grade_verified`, `rating`, `review_count`, `hourly_rate_cents`
   - `match.reasons`: strings like "Got A in Fall 2025 (verified)" and "11 times you're both free". Show them, they sell the demo.
   - `mutual_slots[]`: each `{start, end, library_room: {name, book_url} | null}`
2. Card per tutor: grade + verified badge, ★ rating (reviews), $/hr, the reasons, and the mutual slots as chips
   (local time, plus the room name if one is free).
3. Pick a slot: `POST /tutoring/sessions` with `{tutor_id, course_id, start, end, location_pref: "library_room", notes}`.
   It returns a session with `status: "requested"`.
4. As Ava: `GET /tutoring/sessions?role=tutor`, then Accept → `POST /tutoring/sessions/:id/accept`. The response's
   `room_booking` is `{status: "booked" | "manual_required" | "pending", room: {name}, booking_url}`. Show
   "Room booked: <name>" when booked; for manual_required, show the room name with a "Book it" link to `booking_url`.
5. Student pays: `POST /tutoring/sessions/:id/pay` (demo: paid at once).
6. Optional "your schedule" strip: `GET /me/class-schedule` (classes), `GET /me/availability?from&to` → `{blocks:[{start,end,kind}]}`.

## 2a. Instagram textbook → buyers in the course → offer

- Ingested posts become listings with `external_seller` set (no seller account yet). The feed and explore already show them.
- Buyers in a matching course get a notification: `GET /me/notifications` (already wired). The deep link opens the listing.
- Offer: `POST /listings/:id/offers` with `{kind:"cash", amount_cents, trade_listing_ids:[], fulfillment:"in_person"|"campus_mail", message}`.
  - On an Instagram listing this DMs the seller a claim link (`/claim/<token>`, page done).
  - Let the buyer choose fulfillment here; today `makeOffer` hardcodes `in_person`.
- Seller inbox for native listings: offers waiting on the seller, then Accept → `POST /offers/:id/accept`, which returns `{order}`.
- Buyer pays: `POST /orders/:id/pay`.

## 2b. In person: safe spot + time, escrow, both confirm (order.fulfillment = in_person)

1. `GET /orders/:id` gives `handoff_id`.
2. `POST /handoffs/:handoff_id/suggest` with `{}` returns `{suggestions:[...]}`. Each suggestion has:
   - `start`, `end`
   - `safe_zone`: `{id, name, kind, location: {lat, lng}, hours_note}`
   - `walk_minutes`: `{me, them}`
   - `reason`, e.g. "UAPD lobby: while you're free (7 min walk), while they're free (7 min walk)"
   Show 2–3 cards with the reason.
3. One side proposes, `POST /handoffs/:id/propose` with `{start, safe_zone_id}`. The other side gets a notification and
   sends the same body to `POST /handoffs/:id/agree`. The handoff becomes `agreed`.
4. Escrow card: `GET /orders/:id/escrow` returns `{entries:[{kind:"hold"|"release", amount_cents, reason}], held_cents}`. It shows "$28 held 🔒".
5. At the spot, each side presses "It went fine", which sends `POST /handoffs/:id/tap` with `{location, accuracy_m}`. The buyer also sends `item_ok: true`.
   - The first tap returns `status: "waiting_for_other"`; show "Waiting for <other> to confirm".
   - The second returns `completed`. Celebrate, then show escrow released (a `release` entry for the payout minus the 5% fee).
   - Alternative already on the API: the seller shows a code (`POST /handoffs/:id/code` → `{short_code, qr_token}`) and the
     buyer types it (`POST /handoffs/:id/confirm` with `{short_code, location, accuracy_m, item_ok}`). Pick one; tap is simpler.

## 2c. Campus mail (order.fulfillment = campus_mail)

1. The buyer needs mail info first: `PATCH /me` with `{mail_name, mail_stop_code}`. Without it, the seller's step 2 returns
   409 `MAIL_INFO_REQUIRED`; show a small form to the buyer when they choose campus mail.
2. Seller: `POST /orders/:id/shipment` with `{}` returns:
   - `label_code`
   - `to.address_lines`: four lines, e.g. "JORDAN STUDENT / 1831 UNIVERSITY STATION / MSC 870245 / TUSCALOOSA, AL 35487-0002"
   - `steps[]`: plain-English drop-off directions
   - `drop_off`: `{name, location, instructions, hours}`
   Make a printable label (address block + big `label_code`, `window.print()` with a print stylesheet), then the steps and a map pin.
3. Seller at the window: upload a photo (`POST /media/upload-url` with `purpose:"listing"` → PUT → `POST /media/:id/complete`),
   then `POST /shipments/:id/dropped-off` with `{location: drop_off.location, accuracy_m: 10, photo_media_id}`.
   Opening hours are skipped in demo mode.
4. Buyer: "I got it", typing the code on the package: `POST /shipments/:id/received` with `{label_code, item_ok: true}`.
   The order is completed and escrow released.

## Order to build (stop after any step if time runs out)

1. 2b (meetup suggest/propose/agree, escrow card, tap-to-confirm)
2. 1 (tutor match cards, request, accept, room)
3. Offer fulfillment choice, then 2c (label + drop-off + received)
4. Seller offers inbox for native listings
