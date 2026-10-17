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
