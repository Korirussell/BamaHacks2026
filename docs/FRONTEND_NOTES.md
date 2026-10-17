# Frontend notes

Short, screen-by-screen notes for things the API expects the app to do. Shapes live in [API_CONTRACT.md](API_CONTRACT.md); this file says how to use them.

## Campus mail (UA)

**This is optional scaffolding.** Students choose how to trade, with no default: **in person** at a safe zone (handoff flow) or **async by campus mail**. Only build these screens for the async path: they apply when an offer/order has `fulfillment: "campus_mail"` (the seller lists `campus_mail` in the listing's `fulfillment`, and the buyer picks it on the offer). In-person orders never touch shipments, MSC or `mail_name`.

Background: [API_CONTRACT.md → Campus mail at UA](API_CONTRACT.md#campus-mail-at-ua). In short, the seller ships the package USPS at the **Crimson Mail & Shipping** window in the Student Center, addressed to the buyer's campus address; Campus Mail puts it in the buyer's locker; the buyer types our code to release the money.

### 1. Profile: collect the buyer's mail info (only when they choose campus mail)

`PATCH /me` with:

| Field | What to ask | Notes |
|---|---|---|
| `mail_stop_code` | "Your MSC (6 digits)" | Help text: *myBama → Campus Mail Student Portal, at the top.* `"MSC 123456"` is accepted; anything that isn't 6 digits → `400 VALIDATION` with `field_errors.mail_stop_code`. |
| `mail_name` | "First and last name (as on your UA record)" | Must be at least two words. Not the nickname: Campus Mail matches packages by this name + MSC. |

Ask for these only when the buyer picks campus mail (or from an optional "Campus mail" section in settings); don't make them part of required onboarding. `GET /me` returns both. If either is missing when the seller creates the shipment, the API returns `409 MAIL_INFO_REQUIRED`; send the buyer to this screen.

**Off-campus buyers:** show a one-liner when they pick campus mail: *"UA charges off-campus students $2.50 per package (max $25 per semester) on your student account."*

### 2. Seller: "Ship by campus mail" screen

After `POST /orders/{id}/shipment` you get a `Shipment`. Everything to print or write is in it:

- **Address block**: `shipment.to.address_lines` (4 lines). Render them exactly, one per line, big and monospace-ish:
  ```
  JORDAN SAMPLE
  1831 UNIVERSITY STATION
  MSC 123456
  TUSCALOOSA, AL 35487-0002
  ```
- **Code**: `shipment.label_code` (8 characters, no 0/O/1/I/L). Show it large plus as a QR. The seller writes or prints it on the package; the buyer types or scans it on pickup.
- **Steps**: `shipment.steps` is an ordered list of plain sentences (write the address, write the code, go to the window, 3 pm cutoff, tap "Dropped off"). Render as a numbered list; don't hardcode your own copy.
- **Where**: `shipment.drop_off` (name, `location` for a map pin, `hours`, `instructions`).
- **Print**: add a "Print label" button that prints the address block + code + QR (a simple print stylesheet is enough). `label_pdf_url` is still a placeholder (`about:blank#label-…`), so don't link to it yet.
- **Writing by hand is fine**: the address block + code is all that has to be on the package.

### 3. Seller: at the window

`POST /shipments/{id}/dropped-off` with the phone's location, `accuracy_m`, and a photo (`POST /media/upload-url` with `purpose: drop_off_proof` first). Errors to handle:

- `403 NOT_NEARBY`: "You need to be at the Crimson Mail & Shipping window."
- `409 INVALID_STATE` with message "… is closed right now": the window is closed (Mon–Fri 8:00–4:30, closed on UA holidays).

After it succeeds, show `shipment.auto_complete_at` as "Completes automatically on {date} if the buyer doesn't confirm."

### 4. Buyer: pickup

The buyer gets Campus Mail's own email/text with the locker and pickup code (that's UA's code, not ours). Once they have the package: `POST /shipments/{id}/received` with **our** `label_code` (written on the package) and `item_ok`. Make it clear which code is which: *"Enter the 8-character code the seller wrote on the package."*

## In-person meetup (both tap + location)

Applies to orders with `fulfillment: "in_person"` (the user picks in-person or campus mail per order; campus mail never touches handoffs). Shapes: [API_CONTRACT.md → Meetup confirm, location and escrow](API_CONTRACT.md#meetup-confirm-location-and-escrow). Order of events: `pay` (money held) → `suggest`/`propose`/`agree` (handoff `agreed`) → both phones ping location → both tap **Confirm trade** → `completed` and the seller is paid.

### 1. Before the meetup: location permission

Ask for **when-in-use** location the first time a user agrees to a meetup (not at launch). Explain it: *"We use your location only around meetup time, to show you're at the spot and to confirm the trade."* Also offer the `PATCH /me` `location_sharing` toggle:

- `during_handoffs` (default): the other person also sees roughly how far you are from the spot ("about 120 m away"), only from 30 min before to 30 min after the meetup. Never your map position.
- `off`: they only see whether you've arrived. Pings and taps still work; the server still checks where you are.

If permission is denied, the app can't tap or ping: send the user to the QR fallback (below) and say why.

### 2. Meetup screen: pinging and the map

Open it from the order or the `agreed` handoff. While it is open and `now` is inside `GET /handoffs/{id}` → `agreed.start - 30 min` to `agreed.end + 30 min` (the `sharing_window` from the ping response):

- `POST /handoffs/{id}/location` with `location` + the **real** `accuracy_m` from the device (don't hardcode it) every **10–15 s**, plus once on a big movement (~25 m). Stop pinging when the screen closes or the handoff leaves `agreed|arriving`.
- **Draw yourself from the device GPS** (the 3D map), not from the API. Use the response only for text and state: `me.inside_zone` (show "You're at the spot"), `me.distance_to_zone_m` ("40 m to the spot"; 0 when inside).
- The other person: `other.arrived` is always set ("Alex is here"). `other.distance_m` is null unless they share and it's within the window; then show "about 120 m away" (no pin on the map, there are no coordinates). `other.last_seen_at` can say "seen 20 s ago".
- `me.accuracy_ok: false` (accuracy worse than 100 m): the server ignores that fix for presence. Show *"Weak GPS. Move outside, or use the code."* and offer the QR fallback.
- When both are inside the zone the handoff goes `arriving` and the order `handing_off`; show the confirm screen.
- **Realtime:** subscribe to the **private** channel `handoff:{id}` with the user's access token (the Supabase client's own session; only the two parties are allowed in). Events: `handoff.presence` (arrival changed), `handoff.tap` (the other side tapped), `handoff.updated` (status changed), `handoff.completed`. Payloads carry no locations, so on `handoff.presence`/`handoff.updated` just refetch `GET /handoffs/{id}` for your own `tracking`. Keep pinging as the fallback if the channel drops.

### 3. Confirm screen

- Big **Confirm trade** button, enabled when `me.inside_zone` is true. Tap sends `POST /handoffs/{id}/tap` with `location`, `accuracy_m` and an `Idempotency-Key` (one key per tap press; reuse it on a retry).
- **Buyer (receiver) first asks** *"Got the item and it's as described?"* and sends the answer as `item_ok`. The seller sends no `item_ok`; omitting it as the buyer is `400 VALIDATION`.
- Response `status`:
  - `waiting_for_other`: show *"Waiting for {name} to tap"* with a countdown to `tap_expires_at` (60 s). The other side gets `handoff.tap` / a push.
  - `completed`: done; show the receipt, ask for a review.
  - `disputed`: buyer said `item_ok: false`; money stays held, show *"We'll review this."*
- On `handoff.tap` from the other side (or `taps.giver_at` / `taps.receiver_at` set and not yours): show *"{name} tapped. Tap now (60 s)."* If the 60 s lapses, both just tap again.
- Errors: `403 NOT_NEARBY` (outside the spot or weak GPS) → *"We can't tell you're at the spot."* and offer the **QR fallback**: the seller opens "Show code" (`POST /handoffs/{id}/code`, QR rotates every 60 s, also a 6-digit code), the buyer scans or types it (`POST /handoffs/{id}/confirm` with `item_ok`). `409 INVALID_STATE` means the handoff changed (completed, no-show); refetch.

### 4. No-show

Show **"They didn't show up"** only when `now >= agreed.start + 15 min`, `me.inside_zone` is true and `other.arrived` is false. It sends `POST /handoffs/{id}/no-show` with `location` + `accuracy_m`. Result: handoff `no_show`, the buyer is refunded, the absent person's reliability drops. `403 NOT_NEARBY` → "Be at the spot to report this". `409 INVALID_STATE` ("other person has arrived" / too early) → hide the button and refetch. If nobody comes, the server cleans it up itself an hour after the slot: one-sided no-show, or back to `proposing` ("Pick a new time") with the order still paid.

### 5. Payment timeline and disputes

On the order screen, `GET /orders/{id}/escrow` drives a three-step timeline from `entries` (`kind`, `created_at`, `amount_cents`):

- **Held**: a `hold` entry. *"Your $X is held until the trade is confirmed."* (`held_cents` > 0.)
- **Released**: a `release` entry. Seller sees *"Paid out"*. If the order is `completed` with `payout.status: "awaiting_onboarding"` there's no release yet: *"Finish payout setup to get paid."*
- **Refunded**: a `refund` entry (no-show, cancel, unpaid timeout, or admin ruling). Buyer sees *"Refunded"*.

`provider` is `demo` or `stripe`; don't show it. Reload the timeline on `order.updated` (user channel). Either party can open a dispute from `scheduled`, `handing_off` or `in_transit`: `POST /orders/{id}/dispute` with `reason`, `details` and optional photos (`purpose: handoff_proof` uploads), plus an `Idempotency-Key`. The order shows `disputed` with money still held until the team resolves it; you then get a *"Dispute resolved"* notification and the order lands on `completed` or `refunded`.

## Card payments (Stripe)

Shapes: [API_CONTRACT.md](API_CONTRACT.md) → `POST /orders/{id}/pay`, `/payments/*`. The app only ever holds the **publishable** key (`STRIPE_PUBLISHABLE_KEY`, `pk_test_…`); never a secret key.

### 1. Buyer pays

`POST /orders/{id}/pay` with an `Idempotency-Key`, then branch on `demo`:

- `demo: true`: the order comes back `paid`. No sheet, go straight to the order screen.
- `demo: false`: present **PaymentSheet** (iOS) / **Payment Element** (web) with `client_secret`. When the sheet reports success, show *"Payment processing…"* and wait for `order.updated` (or refetch `GET /orders/{id}`) to see `paid`; the server marks it paid from Stripe's webhook, not from the app. If the sheet is dismissed, calling `pay` again returns the same payment, so a "Pay" button can just retry.
- `payment.status: "failed"` on the order (buyer also gets *"Payment didn't go through"*): let them pay again with another card.

Test cards: `4242 4242 4242 4242` (works), `4000 0000 0000 9995` (declined), any future date and CVC.

### 2. Seller payout setup

- Settings → "Get paid": `GET /payments/status`. If `payouts_enabled` is false, show **Set up payouts** (also show it on the order screen when `payout.status` is `awaiting_onboarding`).
- Tap → `POST /payments/onboard` (`?client=ios` from the app) → open `onboarding_url` (web: redirect; iOS: `ASWebAuthenticationSession`/Safari view).
- Stripe sends them back to `/settings/payments?stripe=return` (web) or `<scheme>://payments?stripe=return` (iOS). Then refetch `GET /payments/status`. `?stripe=refresh` means the link expired: call `onboard` again and reopen.
- `requirements_due` non-empty → *"Stripe needs a bit more info"* with the same button.
- Once payouts turn on, anything that was waiting is paid out automatically and the seller gets *"Payouts are on"*.

### 3. Tutoring payments

Shapes: [API_CONTRACT.md](API_CONTRACT.md) → `POST /tutoring/sessions/{id}/pay`, *Tutoring escrow*. Same sheet and same key as orders.

- Once a session is `accepted`, show **Pay $X** to the student only. `POST /tutoring/sessions/{id}/pay` with an `Idempotency-Key`; branch on `demo` exactly like orders (`demo: true` → `session` is already `paid`; `demo: false` → PaymentSheet with `client_secret`, then wait for `tutoring.updated` / refetch the session to see `paid`). `session.payment.status: "failed"` → let them try another card.
- Paid **in person**: `session.handoff_id` is set. Open the normal meetup screen (`GET /handoffs/{id}`); it's already `agreed` at the session time and library spot, so skip suggest/propose. The tutor is the giver (shows the code), the student the receiver (scans / taps with `item_ok`). Confirming pays the tutor; a no-show refunds the student.
- Paid **virtual**: after the start time the student taps **Mark as done** → `POST /tutoring/sessions/{id}/complete`, which pays the tutor. Hide that button for the tutor on paid sessions (it's FORBIDDEN for them).
- Cancelling a paid session refunds the student: show *"You'll be refunded $X"* in the confirm dialog.
- Tutor side: `session.payout.status` `held` → *"You'll be paid $Y after the session"* (`payout.tutor_payout_cents`); `awaiting_onboarding` → **Set up payouts** (same flow as sellers); `released` → *"Paid out"*.
