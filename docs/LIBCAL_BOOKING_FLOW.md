# LibCal booking flow (Gorgas Team Workrooms)

Verified end to end on 2026-10-17: Gorgas Team Work Space 2 (eid 49271) was booked for Sun 2026-10-18 3–4 pm by following exactly these steps and selectors.

I recorded this live on ua.libcal.com on 2026-10-17 by driving a signed-in Chrome. It's the map for the Playwright booker (`ROOM_BOOKER=playwright`, `backend/src/adapters/libcal-booker.ts`, CLI `pnpm libcal login|rooms|book`). IDs: Gorgas `lid=214`, Team Workrooms `gid=436`. Times are America/Chicago.

## Rules LibCal enforces

- **1 booking per day per category.** A second Team Workroom on the same day fails at the final step with HTTP 500: "Sorry, this exceeds the 1 booking per day limit in this category." This is per patron, so one UA account can book only one room a day for the whole app.
- Up to one 3-hour block per day, at most 2 weeks ahead.
- Groups of 3 or more. The booking is cancelled if fewer than 3 people show up within 15 minutes.
- A slot is held for about 10 minutes once it's in the cart (the "held for you until …" banner).

## Steps

| # | User action | Request | Notes |
|---|---|---|---|
| 1 | Open `/spaces?lid=214&gid=436` | `GET` the page, then `POST /spaces/availability/grid` | The grid body is `lid, gid, eid=-1, seat=0, seatId=0, zone=0, start=YYYY-MM-DD, end=YYYY-MM-DD, pageIndex=0, pageSize=18`. Each slot is `{start, end, itemId, checksum}` and our adapter already reads this. A taken slot has a `className`. |
| 2 | Click a free (blue) cell | `POST /spaces/availability/booking/add` | Body: `add[eid]=<itemId>, add[gid]=436, add[lid]=214, add[start]=YYYY-MM-DD HH:mm, add[checksum]=<the slot's checksum from the grid>`, plus `lid, gid, start, end` for the visible range. The response's `bookings[0]` has `id, eid, start, end, checksum, options[]` (allowed end times) and `optionChecksums`. |
| 2b | (Optional) Pick an end time | none (`select[name^=bookingend_]`, named `bookingend_<cart id>`) | Option values look like `2026-10-18 16:00:00`. The default is start + 1 h. |
| 2c | Trash icon (remove from cart) | `POST /spaces/availability/booking/add` with `removeId=<id>` and the current `bookings[0][…]` | |
| 3 | **Submit Times** (`#submit_times`) | `POST /ajax/space/times` with `patron, patronHash, returnUrl, bookings[…], method`, then a redirect to `/spaces/auth?returnUrl=…&token=…` | If the browser already has a UA sign-in, there's no SSO prompt. Otherwise it bounces through UA SSO (Microsoft). **The user signs in by hand once, and Playwright reuses that profile.** |
| 4 | Terms: **Continue** (`#terms_accept`) | none (client-side) | Shows the Team Workroom terms. |
| 5 | The form (`#s-lc-eq-bform`) | none | Full name and email come from SSO and are read-only. The one field is `nick` ("Gorgas Team Workrooms"), which is optional. |
| 6 | **Submit my Booking** (`#btn-form-submit`) | `POST /ajax/equipment/checkout` (multipart: `nick, …, logoutUrl, session`) | 200 shows the "Booking Confirmed" page with the space, date, time, name and email. 500 returns an HTML `<p>` with the reason (for example the daily limit), and the page shows it as a red toast. |
| 7 | Confirmation | email to the patron's @crimson.ua.edu | The confirmation page has "Make Another Booking" and "Logout". |

## Notes for Playwright

- Each room's lane is `td.fc-timeline-lane[data-resource-id=eid_<id>]`, and the hour headers are `th[data-date="YYYY-MM-DDTHH:00:00"]`. The grid shows 3 days; `button.fc-next-button` pages forward. The booker finds the free cell in the lane whose left edge matches the header, after the scroll has settled (the scroll animates).
- The grid cells (`a.fc-timeline-event.s-lc-eq-avail`) carry **no data attributes**, so clicking by selector is fragile. Two options:
  - **Recommended:** load the page in the signed-in context, then call the same endpoints from the page with `page.evaluate(fetch …)`. Steps 1–2 use `availability/grid` for the checksum, then `booking/add`. After that, drive the UI from Submit Times on (steps 3–6), because `patronHash` and `session` are rendered into the page.
  - Or click by position: find the row by its room-name link, then the column from the time header. This is FullCalendar's timeline; I haven't checked the header selectors.
- Persistent profile: `chromium.launchPersistentContext(<dir>, { channel: "chrome" })`. The user signs into UA SSO in it once. Never store their password.
- Success check: the page text contains "Booking Confirmed" and the room name. Failure: read the toast or the 500 body and return `manual_required` with the reason.
- Before booking, check whether this patron already has a Team Workroom that day (the "View Confirmed Bookings" page). If they do, skip straight to `manual_required` with the room link.
- To cancel: use the link in the confirmation email, or "View Confirmed Bookings".
