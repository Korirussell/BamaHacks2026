# Campus Marketplace — API Contract & Technical Spec

> **Source of truth** for how the frontend (Swift iOS app + website) and the backend (`/backend`) talk to each other.
> If you change a request/response shape, change it here **in the same PR** and tell the other side.
>
> Oct 17, 2026 · @alex gundrum

---

## Assumptions & scope

Build on Supabase plus a TypeScript API and Stripe Connect in test mode; ship **Marketplace end to end first, Tutoring second**, everything else as stretch. Every assumption below is a default the team can overrule (see [Open questions](#open-questions)).

| Decision | Assumption | Why |
|---|---|---|
| Frontend | Swift iOS app + website (frontend dev owns both) | Two clients, so the backend is a standalone API that knows nothing about either |
| API layer | Standalone TypeScript API (Hono on Node) on Fly.io or Railway; Zod schemas generate an OpenAPI spec | Swift (`swift-openapi-generator`) and web both generate typed clients from the spec; the JSON below maps 1:1 to it |
| DB, auth, files, realtime | Supabase (Postgres, Auth, Storage, Realtime); locations are plain lat/lng columns and distances are computed in the API | RLS gives per-school isolation for free; no PostGIS needed at campus scale |
| Payments | Stripe Connect Express, separate charges and transfers | Charge buyer up front, release to seller only after handoff confirm |
| AI parsing | Claude API with vision and structured JSON output | One integration covers transcript, syllabus, screenshot-to-listing and textbook photo |
| Multi-tenancy | One `school` row per `.edu` domain; every row carries `school_id` | College-by-college routing without separate deployments |
| Background work | A job queue (Inngest, or Supabase pg_cron + Edge Functions) | AI parsing, offer expiry, auto-bargain rounds, payout release |

| Tier | Features |
|---|---|
| **P0** demo-critical | .edu auth, profile, transcript upload, feed + explore, listings (incl. Instagram screenshot → listing), offers, Stripe checkout, in-person handoff with safe zones + dual sync confirm |
| **P1** | Wishlist + matching + Suggest Trade, Google Calendar, auto meetup suggestions, tutoring, reliability score, notifications |
| **P2** stretch | Rides, tickets, study groups + syllabus parse, auto-bargaining, campus mail, GroupMe ingestion, library room booking |

---

## Part 1 — Frontend ↔ backend contract

All traffic is **JSON REST under `/api/v1`**, authenticated with the Supabase access token, plus **Supabase Realtime** channels for live updates. Sign-in itself (email OTP) goes straight from the frontend to Supabase Auth; everything else goes through our API.

### Conventions

- **Auth:** `Authorization: Bearer <supabase_access_token>`. `school_id` is read from the token, **never accepted from the client**.
- **IDs and times:** IDs are UUIDs; timestamps are ISO 8601 UTC; money is **integer cents** (`*_cents`), currency USD.
- **Lists:** `?cursor=&limit=` (default 20, max 50) → `{ "data": [T], "next_cursor": "string?" }`.
- **Single objects:** `{ "data": T }`.
- **Errors:** HTTP status + `{ "error": { "code": "string", "message": "string", "field_errors": { "<field>": "string" }? } }`.
- **Error codes:** `UNAUTHENTICATED`, `NOT_EDU_EMAIL`, `SCHOOL_NOT_SUPPORTED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `INVALID_STATE` (illegal status change), `STRIPE_ONBOARDING_REQUIRED`, `PAYMENT_FAILED`, `NOT_NEARBY`, `MAIL_INFO_REQUIRED` (buyer has no 6-digit MSC or no first + last `mail_name` on file), `CLAIM_INVALID` (claim link expired, used or unknown), `RATE_LIMITED`, `INTERNAL` (500, unexpected server error).
- **Idempotency:** any call that moves money or advances an order or handoff takes an `Idempotency-Key` header.
- **AI jobs:** return `202 { "job_id" }`; the frontend listens on its user channel or polls `GET /jobs/{id}`.

**Notation in the schemas:** `"uuid"`, `"string"`, `"int"`, `"number"`, `"bool"`, `"ts"` (timestamp), `"date"` (`YYYY-MM-DD`, no time), `"HH:MM"` (24-hour local wall-clock time), `"cents"`, `"a|b|c"` = enum, `[T]` = array, trailing `?` = optional or nullable, a Capitalised name = a shared object below.

### Shared objects

```jsonc
{
  "School":       { "id": "uuid", "name": "string", "domain": "string", "center": "LatLng", "timezone": "string (IANA)", "campus_mail_supported": "bool", "tutor_min_grade": "string (e.g. A-)" },
  "LatLng":       { "lat": "number", "lng": "number" },
  "Place":        { "label": "string", "location": "LatLng" },
  "Media":        { "id": "uuid", "url": "string", "kind": "image|pdf|ics", "width": "int?", "height": "int?" },
  "Reliability":  { "score": "number", "completed": "int", "no_shows": "int", "badge": "new|reliable|top" },
  "UserPublic": {
    "id": "uuid", "display_name": "string", "avatar_url": "string?", "major": "string?", "grad_year": "int?",
    "school": "School", "reliability": "Reliability", "is_friend": "bool", "mutual_friend_count": "int",
    "can_receive_payments": "bool", "is_verified_driver": "bool"
  },
  "Me": {
    "user": "UserPublic", "email": "string", "phone": "string?",
    "budget_cents": "cents?", "mail_stop_code": "string? (6 digits)", "mail_name": "string? (first + last, as on UA record)", "tutor_opt_in": "bool",
    "location_sharing": "off|during_handoffs",
    "notification_prefs": { "push": "bool", "email": "bool", "wishlist_alerts": "bool", "tutor_requests": "bool" },
    "connections": { "google_calendar": "bool", "stripe": "none|pending|ready" },
    "onboarding": { "profile": "bool", "transcript": "bool", "calendar": "bool", "payments": "bool" }
  },
  "Course":       { "id": "uuid", "code": "string", "title": "string", "department": "string" },
  "ClassRecord": {
    "id": "uuid", "course": "Course", "term": "string", "status": "current|past|planned",
    "grade": "string?", "grade_source": "transcript|self_reported", "grade_verified": "bool"
  },
  "Building":     { "id": "uuid", "school_id": "uuid", "name": "string", "code": "string (e.g. NERC)", "location": "LatLng" },
  "ClassMeeting": {
    "id": "uuid", "course": "Course", "section": "string?",
    "days": ["mon|tue|wed|thu|fri|sat|sun"], "start": "HH:MM", "end": "HH:MM",
    "timezone": "string (IANA, e.g. America/Chicago)",
    "term": "string", "term_start": "date", "term_end": "date",
    "building": "Building?", "room": "string?",
    "source": "manual|ics|screenshot|google"
  },
  "ClassMeetingInput": {
    "course_id": "uuid", "section": "string?",
    "days": ["mon|tue|wed|thu|fri|sat|sun"], "start": "HH:MM", "end": "HH:MM",
    "timezone": "string?", "term": "string", "term_start": "date", "term_end": "date",
    "building_id": "uuid?", "room": "string?",
    "source": "manual|ics|screenshot|google"
  },
  "TimeBlock":    { "start": "ts", "end": "ts", "kind": "free|busy|class" },
  "LibraryRoom":  { "room_id": "string (LibCal space id)", "name": "string", "capacity": "int", "book_url": "string (the room's LibCal booking page)" },
  "FreeRoomSlot": { "room_id": "string", "name": "string", "capacity": "int", "start": "ts", "end": "ts", "book_url": "string" },
  "OpeningHours": { "days": ["mon|tue|wed|thu|fri|sat|sun"], "open": "HH:MM", "close": "HH:MM" },
  "SafeZone":     { "id": "uuid", "name": "string", "kind": "police|student_center|library|other", "location": "LatLng", "radius_m": "int", "hours": ["OpeningHours"], "hours_note": "string?" },
  "MeetupSuggestion": {
    "start": "ts", "end": "ts", "safe_zone": "SafeZone",
    "walk_minutes": { "me": "int", "them": "int" },
    "context": { "me": { "before": "string?", "after": "string?" }, "them": { "before": "string?", "after": "string?" } },
    "reason": "string", "score": "number"
  },
  "DropOffPoint": { "id": "uuid", "name": "string", "location": "LatLng", "radius_m": "int", "hours": ["OpeningHours"], "instructions": "string" },
  "ExternalSeller": { "channel": "instagram|groupme|facebook|snapchat", "handle": "string", "profile_url": "string?" },
  "Listing": {
    "id": "uuid", "seller": "UserPublic? (null until an ingested listing is claimed)",
    "external_seller": "ExternalSeller? (set for ingested listings)",
    "category": "textbook|lab_supplies|dorm|ticket|other",
    "title": "string", "description": "string", "price_cents": "cents", "negotiable": "bool",
    "floor_price_cents": "cents? (seller only)", "condition": "new|like_new|good|fair|poor",
    "media": ["Media"],
    "textbook": { "isbn": "string", "title": "string", "authors": ["string"], "edition": "string?", "courses": ["Course"] },
    "ticket": { "event": "Event", "section": "string", "row": "string?", "seat": "string?", "transfer": "app_transfer|in_person" },
    "fulfillment": ["in_person|campus_mail|digital_transfer"],
    "status": "draft|active|pending|sold|removed",
    "source": { "channel": "native|screenshot|instagram|groupme|facebook|snapchat", "external_url": "string?", "claimed": "bool" },
    "course_match": "Course? (viewer-specific: a class the viewer is in that requires this item)",
    "created_at": "ts"
  },
  "Event":        { "id": "uuid", "name": "string", "kind": "athletics|concert|other", "starts_at": "ts", "venue": "string" },
  "Offer": {
    "id": "uuid", "listing_id": "uuid", "buyer": "UserPublic", "seller": "UserPublic? (null while listing is unclaimed)",
    "kind": "cash|trade|cash_plus_trade", "amount_cents": "cents", "trade_listing_ids": ["uuid"],
    "fulfillment": "in_person|campus_mail|digital_transfer",
    "message": "string?", "counter_of": "uuid?", "auto_generated": "bool", "made_by": "buyer|seller",
    "status": "pending|countered|accepted|declined|withdrawn|expired",
    "waiting_on": "buyer|seller|seller_claim?", "seller_notified_at": "ts?", "expires_at": "ts"
  },
  "Order": {
    "id": "uuid", "listing": "Listing", "buyer": "UserPublic", "seller": "UserPublic", "offer_id": "uuid?",
    "amount_cents": "cents", "fee_cents": "cents", "seller_payout_cents": "cents",
    "fulfillment": "in_person|campus_mail|digital_transfer",
    "status": "awaiting_payment|paid|scheduled|handing_off|in_transit|completed|cancelled|disputed|refunded",
    "payment": { "status": "requires_payment|succeeded|failed|refunded", "paid_at": "ts?" },
    "payout": { "status": "held|awaiting_onboarding|released|reversed", "released_at": "ts?" },
    "handoff_id": "uuid?", "shipment": "Shipment?", "created_at": "ts"
  },
  "Handoff": {
    "id": "uuid", "context": { "type": "order|tutoring_session", "id": "uuid" },
    "parties": { "giver": "UserPublic", "receiver": "UserPublic" },
    "suggestions": ["MeetupSuggestion"], "agreed": { "start": "ts", "end": "ts", "safe_zone": "SafeZone" },
    "status": "proposing|agreed|arriving|completed|no_show|cancelled|expired",
    "presence": { "giver_nearby": "bool", "receiver_nearby": "bool" },
    "confirmations": { "giver_at": "ts?", "receiver_at": "ts?", "item_ok": "bool?" },
    "tracking": "Tracking (viewer-relative: the caller is \"me\")",
    "taps": "Taps"
  },
  "Tracking":     { "me": "MeTracking? (null outside agreed/arriving or before your first ping)", "other": "OtherTracking" },
  "MeTracking":   { "inside_zone": "bool", "distance_to_zone_m": "int? (to the zone edge, nearest 10 m; 0 inside; null when accuracy_ok is false)", "accuracy_ok": "bool (accuracy_m <= 100)" },
  "OtherTracking": { "arrived": "bool", "distance_m": "int? (to the zone edge, nearest 10 m; null unless they share, see Meetup confirm rules)", "last_seen_at": "ts?" },
  "Taps":         { "giver_at": "ts? (only while the tap is still valid, 60 s, or the handoff is completed)", "receiver_at": "ts?" },
  "EscrowEntry":  { "kind": "hold|release|refund", "amount_cents": "cents", "provider": "demo|stripe", "created_at": "ts", "reason": "string?" },
  "Shipment": {
    "id": "uuid", "order_id": "uuid", "label_pdf_url": "string", "label_code": "string (printed on label as QR + text)",
    "to": { "name": "string", "mail_stop_code": "string", "address_lines": ["string (4 lines: NAME, 1831 UNIVERSITY STATION, MSC ######, TUSCALOOSA, AL 35487-0002)"] },
    "steps": ["string (seller's drop-off steps, in order; show next to the address)"],
    "drop_off": "DropOffPoint", "status": "label_created|dropped_off|received",
    "dropped_off_at": "ts?", "drop_off_proof_media_id": "uuid?", "received_at": "ts?", "auto_complete_at": "ts?"
  },
  "Review":       { "id": "uuid", "from": "UserPublic", "to_user_id": "uuid", "context": { "type": "order|tutoring_session|ride", "id": "uuid" }, "stars": "int", "on_time": "bool", "as_described": "bool", "comment": "string?", "created_at": "ts" },
  "Notification": { "id": "uuid", "type": "string", "title": "string", "body": "string", "deep_link": "string", "read_at": "ts?", "created_at": "ts" },
  "Job":          { "id": "uuid", "kind": "transcript_parse|syllabus_parse|schedule_import|screenshot_to_listing|textbook_identify|ingest_classify", "status": "queued|running|succeeded|failed", "result": "object?", "error": "string?" }
}
```

- `floor_price_cents` is returned **only to the seller** and is what auto-bargaining negotiates against.
- `ticket` and `textbook` are present only for those categories.
- `Building` rows are **seeded per school** (name, short code, lat/lng); clients never create them.
- `ClassMeeting.start`/`end` are wall-clock times in `timezone` (defaults to the school's timezone, `America/Chicago` for UA). The meeting repeats on `days` between `term_start` and `term_end` inclusive.
- `ClassMeetingInput` is the write shape: it takes `course_id` / `building_id` instead of nested objects.

### Endpoints — identity, profile, academics, schedule

Sign-in: the frontend calls `/auth/check-email`, then Supabase `signInWithOtp`. A Supabase auth hook rejects non-.edu or unsupported domains server-side and attaches `school_id`, so the check is UX only.

```jsonc
{
  "POST /auth/check-email":   { "req": { "email": "string" }, "res": { "allowed": "bool", "school": "School?", "reason": "NOT_EDU_EMAIL|SCHOOL_NOT_SUPPORTED?" } },

  "GET /me":                  { "res": "Me" },
  "PATCH /me":                { "req": { "display_name": "string?", "major": "string?", "grad_year": "int?", "avatar_media_id": "uuid?", "phone": "string?", "budget_cents": "cents?", "mail_stop_code": "string? (6 digits; \"MSC 123456\" accepted)", "mail_name": "string?", "tutor_opt_in": "bool?", "location_sharing": "off|during_handoffs?", "notification_prefs": "object?" }, "res": "Me" },
  "GET /users/{id}":          { "res": { "user": "UserPublic", "mutual_friends": ["UserPublic"], "active_listings": ["Listing"], "tutor_profile": "TutorProfile?", "review_summary": { "avg_stars": "number", "count": "int" } } },
  "GET /users/search":        { "query": { "q": "string", "course_id": "uuid?" }, "res": ["UserPublic"] },

  "POST /media/upload-url":   { "note": "201; then PUT the file to upload_url (or supabase.storage.uploadToSignedUrl with token), then /complete. Max 10 MB", "req": { "purpose": "listing|avatar|transcript|syllabus|schedule|screenshot|drop_off_proof|handoff_proof", "content_type": "image/jpeg|image/png|image/heic|image/webp|application/pdf|text/calendar", "bytes": "int" }, "res": { "media_id": "uuid", "upload_url": "string", "token": "string", "expires_at": "ts" } },
  "POST /media/{id}/complete": { "note": "owner; 409 until the file is in Storage. Other endpoints only take completed media", "res": "Media" },
  "GET /media/{id}":          { "note": "owner; private files get a 10-minute signed url", "res": "Media" },
  "GET /jobs/{id}":           { "res": "Job" },

  "POST /transcripts":        { "req": { "media_id": "uuid" }, "res": { "job_id": "uuid", "transcript_id": "uuid" } },
  "GET /transcripts/{id}":    { "res": { "id": "uuid", "status": "parsing|needs_review|confirmed|failed", "parsed": { "student_name": "string?", "terms": [{ "term": "string", "classes": [{ "course_code": "string", "title": "string", "credits": "number", "grade": "string?", "matched_course_id": "uuid?" }] }], "gpa": "number?" } } },
  "POST /transcripts/{id}/confirm": { "req": { "classes": [{ "course_id": "uuid", "term": "string", "status": "current|past", "grade": "string?" }] }, "res": { "classes": ["ClassRecord"], "tutor_eligible_courses": ["Course"] } },

  "GET /me/classes":          { "query": { "status": "current|past|planned?" }, "res": ["ClassRecord"] },
  "POST /me/classes":         { "req": { "course_id": "uuid", "term": "string", "status": "current|past|planned", "grade": "string?" }, "res": "ClassRecord" },
  "DELETE /me/classes/{id}":  { "res": "204" },
  "GET /courses":             { "query": { "q": "string" }, "res": ["Course"] },
  "GET /courses/{id}/materials": { "query": { "term": "string?" }, "res": [{ "isbn": "string", "title": "string", "required": "bool", "active_listings": "int", "lowest_price_cents": "cents?" }] },

  "GET /buildings":           { "query": { "q": "string?" }, "res": ["Building"] },
  "GET /me/class-schedule":   { "query": { "term": "string?" }, "res": ["ClassMeeting"] },
  "PUT /me/class-schedule":   { "note": "replaces all meetings for every term present in the request", "req": { "meetings": ["ClassMeetingInput"] }, "res": ["ClassMeeting"] },
  "POST /me/class-schedule/import": { "note": "202, AI job kind schedule_import", "req": { "kind": "ics|screenshot", "media_id": "uuid" }, "res": { "job_id": "uuid" }, "job_result": { "drafts": ["ClassMeetingInput"], "unmatched": [{ "raw_text": "string", "reason": "course_not_found|building_not_found|unreadable" }], "confidence": "number" } },
  "POST /integrations/google/connect": { "res": { "auth_url": "string" } },
  "GET /integrations/google/callback": { "note": "server-side OAuth redirect, stores refresh token, redirects to /settings" },
  "DELETE /integrations/google":       { "res": "204" },
  "GET /me/availability":     { "query": { "from": "ts", "to": "ts" }, "res": { "blocks": ["TimeBlock"] } }
}
```

Schedule import is also **review-then-confirm**: upload the `.ics` file or screenshot via `/media/upload-url` (`purpose: schedule`), call `/me/class-schedule/import`, wait for `job.finished`, let the user fix the drafts (and anything in `unmatched`), then save with `PUT /me/class-schedule`. Nothing is written to the schedule until that PUT.

> **Walk-time rule:** meetup suggestions (`MeetupSuggestion.walk_minutes`) and tutor slot suggestions use the `Building.location` of each person's class right **before** and right **after** a free block to estimate walk time to the safe zone or tutoring spot (haversine distance in the API, `services/geo.ts`). If there is no class next to the block, or the class has no building, fall back to the school's `center`.

Transcript parsing is **review-then-confirm**: grades only count as `grade_verified` after the user confirms the parsed result from an uploaded transcript, and only verified grades unlock tutoring.

### Endpoints — feed, listings, wishlist, offers, orders, handoff, mail

```jsonc
{
  "GET /feed":                { "query": { "cursor": "string?" }, "res": [{ "type": "listing|tutor|ride|ticket|study_group", "item": "object", "reason": "wishlist_match|your_class|friend|nearby|new?", "reason_course": "Course? (set when reason=your_class)" }] },
  "GET /explore/listings":    { "query": { "q": "string?", "category": "string?", "course_id": "uuid?", "isbn": "string?", "min_cents": "int?", "max_cents": "int?", "condition": "string?", "fulfillment": "string?", "source": "string?", "within_budget": "bool?", "sort": "relevance|newest|price_asc|price_desc" }, "res": ["Listing"] },

  "POST /listings":           { "req": { "category": "string", "title": "string", "description": "string", "price_cents": "cents", "negotiable": "bool", "floor_price_cents": "cents?", "condition": "string", "media_ids": ["uuid"], "isbn": "string?", "course_ids": ["uuid"], "ticket": "object?", "fulfillment": ["string"], "publish": "bool" }, "res": "Listing" },
  "GET /listings/{id}":       { "res": { "listing": "Listing", "is_mine": "bool", "my_open_offer": "Offer?", "suggested_trades": ["SuggestedTrade"] } },
  "PATCH /listings/{id}":     { "req": "any POST /listings field", "res": "Listing" },
  "DELETE /listings/{id}":    { "res": "204 (sets status=removed)" },
  "GET /me/listings":         { "query": { "status": "string?" }, "res": ["Listing"] },
  "POST /listings/from-screenshot":   { "req": { "media_ids": ["uuid"] }, "res": { "job_id": "uuid" }, "job_result": { "draft": "POST /listings req", "confidence": "number", "missing_fields": ["string"], "price_source": "screenshot|comparable_listings|ai_estimate|null", "price_reason": "string? (only for ai_estimate)" } },
  "POST /listings/identify-textbook": { "req": { "media_id": "uuid" }, "res": { "job_id": "uuid" }, "job_result": { "isbn": "string", "title": "string", "edition": "string?", "matched_courses": ["Course"], "suggested_price_cents": "cents?" } },

  "GET /me/wishlist":         { "res": ["WishlistItem"] },
  "POST /me/wishlist":        { "req": { "kind": "isbn|course_materials|keyword|category", "isbn": "string?", "course_id": "uuid?", "keyword": "string?", "category": "string?", "max_price_cents": "cents?", "alert": "bool" }, "res": "WishlistItem" },
  "DELETE /me/wishlist/{id}": { "res": "204" },
  "GET /me/wishlist/matches": { "res": [{ "wishlist_item_id": "uuid", "listing": "Listing" }] },
  "GET /me/upcoming-materials": { "query": { "term": "string" }, "res": [{ "course": "Course", "isbn": "string", "title": "string", "on_wishlist": "bool", "best_listing": "Listing?" }] },
  "GET /listings/{id}/suggested-trades": { "res": ["SuggestedTrade"] },

  "POST /listings/{id}/offers": { "req": { "kind": "cash|trade|cash_plus_trade", "amount_cents": "cents", "trade_listing_ids": ["uuid"], "fulfillment": "in_person|campus_mail", "message": "string?" }, "res": { "offer": "Offer", "order": "Order? (set when auto-accepted, see rule below)" } },
  "GET /me/offers":           { "query": { "role": "buyer|seller", "status": "string?" }, "res": ["Offer"] },
  "POST /offers/{id}/counter":  { "req": { "amount_cents": "cents", "message": "string?" }, "res": "Offer" },
  "POST /offers/{id}/accept":   { "res": { "offer": "Offer", "order": "Order" } },
  "POST /offers/{id}/decline":  { "res": "Offer" },
  "POST /offers/{id}/withdraw": { "res": "Offer" },
  "POST /listings/{id}/auto-bargain": { "req": { "max_price_cents": "cents", "style": "quick|balanced|patient" }, "res": { "session_id": "uuid", "status": "negotiating|deal_found|no_deal" } },
  "POST /listings/{id}/haggle": { "req": { "message": "string", "history": [{ "from": "buyer|seller", "text": "string" }], "last_counter_cents": "cents?", "place_offer": "bool (default true)" }, "res": { "intent": "offer|accept|decline|question|logistics|spam", "amount_cents": "cents?", "action": "accept|counter|hold_firm|reply|warn|ignore", "price_cents": "cents?", "reply": "string", "scam_flags": ["off_platform_payment|urgency_pressure|meetup_change|phishing"], "reported": "bool", "seriousness": "number 0-5", "engine": "jev|rules", "decisions": "{ key: { pick, value, probabilities } }? (JEV only)", "proposed_offer": "Offer? (set when action=accept)" } },
  "POST /ai/listing-review":  { "req": { "title": "string", "description": "string?", "category": "textbook|lab_supplies|dorm|ticket|other", "price_cents": "cents", "isbn": "string?" }, "res": { "allowed": "bool", "blocked_reasons": ["string"], "warnings": ["string"], "suggested_category": "string?", "engine": "jev|none", "decisions": "object?" } },
  "GET /ai/status":           { "auth": "none", "res": { "online": "bool", "kinds": ["gemma_vision|jev_decide"], "models": "object", "last_seen_at": "ts?" } },
  "GET /auto-bargain/{id}":   { "res": { "status": "negotiating|deal_found|no_deal", "rounds": [{ "by": "buyer_agent|seller_agent", "amount_cents": "cents", "at": "ts" }], "proposed_offer": "Offer?" } },

  "GET /orders/{id}":         { "res": "Order" },
  "GET /me/orders":           { "query": { "role": "buyer|seller", "status": "string?" }, "res": ["Order"] },
  "POST /orders/{id}/pay":    { "headers": ["Idempotency-Key"], "note": "buyer only. PAYMENTS=demo: paid at once, client_secret null, demo true, the paid Order comes back; skip the payment sheet. PAYMENTS=stripe: demo false, open PaymentSheet/Elements with client_secret; the order stays awaiting_payment until the payment_intent.succeeded webhook moves it to paid (watch order.updated). Calling pay again returns the same PaymentIntent. In-person orders get handoff_id once paid.", "res": { "client_secret": "string?", "payment_intent_id": "string", "demo": "bool?", "order": "Order?" } },
  "POST /orders/{id}/cancel": { "req": { "reason": "string" }, "res": "Order" },
  "POST /orders/{id}/dispute":{ "headers": ["Idempotency-Key"], "note": "buyer or seller; only from scheduled, handing_off or in_transit (else INVALID_STATE). details 1-1000 chars, media_ids max 10 and must be the caller's own uploads. Order becomes disputed, money stays held until the team resolves it, the other party is notified", "req": { "reason": "not_as_described|no_show|never_received|other", "details": "string", "media_ids": ["uuid"] }, "res": "Order" },
  "GET /orders/{id}/escrow":  { "note": "buyer or seller; the money ledger for the order, oldest first, for the payment timeline", "res": { "entries": ["EscrowEntry"], "held_cents": "cents (hold minus release minus refund, so 0 once settled)" } },
  "POST /payments/onboard":   { "query": { "client": "web|ios? (default web; ios returns to APP_URL_SCHEME://payments)" }, "note": "seller; creates the Stripe Express account on first call. Open onboarding_url (Stripe-hosted); it comes back to ?stripe=return or ?stripe=refresh (refresh = link expired, call onboard again)", "res": { "onboarding_url": "string" } },
  "GET /payments/status":     { "res": { "charges_enabled": "bool", "payouts_enabled": "bool", "requirements_due": ["string"] } },

  "GET /safe-zones":          { "res": ["SafeZone"] },
  "GET /handoffs/{id}":       { "res": "Handoff" },
  "POST /handoffs/{id}/suggest": { "res": { "suggestions": ["MeetupSuggestion"] } },
  "POST /handoffs/{id}/propose": { "req": { "start": "ts", "safe_zone_id": "uuid" }, "res": "Handoff" },
  "POST /handoffs/{id}/agree":   { "req": { "start": "ts", "safe_zone_id": "uuid" }, "res": "Handoff" },
  "POST /handoffs/{id}/location":{ "note": "either party, status agreed|arriving; accuracy_m 0-5000. Latest position only; fixes with accuracy_m > 100 refresh last-seen but never change presence. When both are nearby the handoff goes arriving", "req": { "location": "LatLng", "accuracy_m": "int" }, "res": { "giver_nearby": "bool", "receiver_nearby": "bool", "me": "MeTracking", "other": "OtherTracking", "sharing_window": { "starts_at": "ts", "ends_at": "ts" } } },
  "POST /handoffs/{id}/code":    { "note": "giver only; giver must be inside the zone, which records confirmations.giver_at", "req": { "location": "LatLng", "accuracy_m": "int" }, "res": { "qr_token": "string", "short_code": "string", "expires_at": "ts" } },
  "POST /handoffs/{id}/confirm": { "note": "receiver only", "headers": ["Idempotency-Key"], "req": { "qr_token": "string?", "short_code": "string?", "location": "LatLng", "accuracy_m": "int", "item_ok": "bool" }, "res": "Handoff" },
  "POST /handoffs/{id}/tap":     { "note": "either party; primary confirm. Both must tap within 60 s, both inside the safe zone with accuracy_m <= 100, tap positions within 50 m + min(both accuracies, 50). The receiver must send item_ok (else 400 VALIDATION). First tap waits; the second completes it (status completed, or disputed when item_ok=false: money stays held). NOT_NEARBY (403) when outside the zone or accuracy is poor: fall back to /code + /confirm. Status agreed|arriving only", "headers": ["Idempotency-Key"], "req": { "location": "LatLng", "accuracy_m": "int", "item_ok": "bool? (required for the receiver)" }, "res": { "handoff": "Handoff", "status": "waiting_for_other|completed|disputed", "tap_expires_at": "ts (this tap + 60 s)" } },
  "POST /handoffs/{id}/no-show": { "note": "reporter must be inside the zone now (accuracy_m <= 100), at least agreed start + 15 min, and the other party never arrived or tapped; else 409 INVALID_STATE (too early, other arrived) or 403 NOT_NEARBY. Buyer is always refunded; the absent party's no-show count goes up", "req": { "location": "LatLng", "accuracy_m": "int" }, "res": "Handoff" },

  "GET /mail/drop-off-points":      { "res": ["DropOffPoint"] },
  "POST /orders/{id}/shipment":      { "note": "seller; needs buyer MSC + mail_name else MAIL_INFO_REQUIRED", "req": { "drop_off_point_id": "uuid?" }, "res": "Shipment" },
  "POST /shipments/{id}/dropped-off":{ "note": "seller; must be inside the drop-off point radius while it is open (else NOT_NEARBY / INVALID_STATE)", "headers": ["Idempotency-Key"], "req": { "location": "LatLng", "accuracy_m": "int", "photo_media_id": "uuid" }, "res": "Shipment" },
  "POST /shipments/{id}/received":   { "note": "buyer; scan or type the label code", "headers": ["Idempotency-Key"], "req": { "label_code": "string", "item_ok": "bool" }, "res": { "shipment": "Shipment", "order": "Order" } },

  "GET /claims/{token}":             { "note": "NO auth; landing page for the link we DM to an external seller", "res": { "external_seller": "ExternalSeller", "listings": ["Listing"], "pending_offers": ["Offer"], "expires_at": "ts" } },
  "POST /claims/{token}":            { "note": "auth; links every listing from that handle to the signed-in user", "res": { "listings": ["Listing"], "pending_offers": ["Offer"] } },

  "WishlistItem":   { "id": "uuid", "kind": "string", "isbn": "string?", "course": "Course?", "keyword": "string?", "max_price_cents": "cents?", "alert": "bool", "match_count": "int" },
  "SuggestedTrade": { "their_listing": "Listing", "my_listings": ["Listing"], "cash_delta_cents": "cents", "score": "number" }
}
```

### Campus mail at UA

Campus mail is **one of the fulfillment methods students choose between**: in person at a safe zone (`in_person`) or async by campus mail (`campus_mail`). There is no default; the seller lists which methods they accept and the buyer picks one on the offer. In-person trades need none of this. Everything below only applies to `campus_mail` orders.

How UA Campus Mail works (campusmail.ua.edu and the myBama Student Mail Portal), and what the app does about it:

- **Address:** every student has a permanent 6-digit **MSC** (mailstop code), on or off campus. Packages are matched by **name + MSC**, so the label uses `mail_name` (first + last, as on the UA record), not `display_name`. A wrong name or MSC lands the package in Campus Mail's "mystery pile" with no notice.
- **Shipping:** Campus Mail only accepts student packages that arrive through USPS or another carrier; intra-campus mail is for University departments only. So the seller ships it **USPS at the Crimson Mail & Shipping window** (Student Center, 1st floor, behind Starbucks, Mon–Fri 8:00–4:30; after 3:00 pm it goes out the next business day). Campus Mail then puts it in the buyer's locker and emails/texts them a pickup code.
- **Pickup:** lockers are Bryce Lawn, Student Center (Student Mail Center) and Magnolia Parking Deck; students pick a primary one in the portal. A package waits 3–5 days in the locker, then 10 more at the Service Center, then goes back to the sender.
- **Fees:** off-campus students (not in residence halls, Greek housing or UA-leased apartments) pay Campus Mail **$2.50 per package**, capped at $25 per billing period (Jan–May, Jun–Dec), billed to their student account. Show this to off-campus buyers before they pick campus mail.
- **Auto-complete:** `auto_complete_at` = 7 days after the package enters the mail stream, at 3:00 pm local.

> **Sync confirm rule (anti-scam):** the primary confirm is **both parties tapping "Confirm trade"** (`POST /handoffs/{id}/tap`) within 60 s of each other, both inside the agreed safe zone's radius. The **QR fallback** (for bad GPS): the giver shows a QR (or 6-digit code) that rotates every 60 s; the receiver scans it and sends their location. The server completes the handoff only if the token is valid **and** the receiver is inside the zone. Either way, that completion is what releases money to the seller.

### Meetup confirm, location and escrow

- **Both-tap:** a tap carries `location` + `accuracy_m`. It counts only when `accuracy_m <= 100` and the point is inside the safe zone. The other tap must land within 60 s and within 50 m + min(both accuracies, 50) of the first. The receiver's tap carries `item_ok`; `false` makes the order `disputed` and the money stays held. Taps expire after 60 s (`Handoff.taps` hides expired ones).
- **Location privacy:** the other party only ever gets `arrived` and a distance to the zone edge (rounded to 10 m), never coordinates. Distance shows only while the handoff is `agreed|arriving`, inside `[agreed_start - 30 min, agreed_end + 30 min]` (`sharing_window`), and only if that person's `location_sharing` is `during_handoffs`; otherwise `distance_m` and `last_seen_at` are null. `arrived` is always visible. Stored positions are wiped when the meetup ends (completed, no-show, reschedule).
- **No-show:** the reporter must be inside the zone, at least 15 min after `agreed.start`, and the other side must never have arrived or tapped. The buyer is always refunded (seller no-show or buyer no-show) and the absent party's `no_show_count` goes up by 1.
- **Escrow:** `POST /orders/{id}/pay` holds the full amount in the `escrow_entries` ledger (`GET /orders/{id}/escrow`). Final states settle it: `completed` releases the seller payout (or `awaiting_onboarding` until Stripe onboarding), `refunded`/`cancelled` refunds the buyer and relists the item. `provider` is `demo` (nothing leaves the platform) or, with `PAYMENTS=stripe`, `stripe`: the hold is a PaymentIntent on the platform, the release a Transfer to the seller's Express account (`source_transaction` = the charge), the refund a Stripe Refund. The shapes are the same either way.
- **Disputes:** `POST /orders/{id}/dispute` freezes the money; an admin ends it with `POST /admin/orders/{id}/resolve`.

> **Auto-accept rule:** an offer with `kind: cash` and `amount_cents >= price_cents` on a **claimed** listing is accepted immediately and the response includes the new `Order`. On an unclaimed listing every offer waits with `waiting_on: seller_claim` and triggers a claim invite to the external seller.

> **Claim rule:** a claim link is single-use, expires after 7 days, and is only ever sent to the handle that posted the item, so holding the token is the proof of ownership. Claiming doesn't need Stripe; payouts stay `awaiting_onboarding` until the seller finishes `/payments/onboard`.

> **Auto-bargain rule:** the agent never goes above the buyer's max or below the seller's private floor; if those ranges overlap it proposes a price between them, otherwise `no_deal`. The result is a normal `Offer` with `auto_generated: true` that a human still taps to accept.

### Endpoints — tutoring, rides, tickets, study groups

```jsonc
{
  "GET /me/tutor-eligibility":  { "res": [{ "course": "Course", "grade": "string", "verified": "bool", "eligible": "bool", "reason": "string?" }] },
  "GET /me/tutor-profile":      { "res": "TutorProfile | null (null until the user sets one up)" },
  "PUT /me/tutor-profile":      { "req": { "enabled": "bool", "course_ids": ["uuid"], "hourly_rate_cents": "cents", "bio": "string?", "modes": ["in_person|virtual"], "open_to_requests": "bool" }, "res": "TutorProfile" },
  "GET /me/tutor-availability/suggested": { "query": { "week_of": "ts" }, "res": ["TimeBlock"] },
  "PUT /me/tutor-availability": { "req": { "recurring": [{ "days": ["string"], "start": "HH:MM", "end": "HH:MM" }], "one_off": ["TimeBlock"] }, "res": "TutorProfile" },
  "GET /tutors":                { "query": { "course_id": "uuid", "from": "ts?", "to": "ts? (default from + 7 days)", "duration_min": "int? (default 60)", "max_rate_cents": "int?", "include_unverified": "bool? (default false)", "sort": "match|rating|price|grade" }, "res": ["TutorMatch"] },
  "POST /tutoring/requests":    { "req": { "course_id": "uuid", "windows": ["TimeBlock"], "max_rate_cents": "cents", "notes": "string?" }, "res": { "request_id": "uuid", "matched_tutor_count": "int" } },
  "POST /tutoring/sessions":    { "note": "student proposes; waiting_on=tutor", "req": { "tutor_id": "uuid", "course_id": "uuid", "start": "ts", "end": "ts", "location_pref": "library_room|safe_zone|virtual", "notes": "string?" }, "res": "TutoringSession" },
  "GET /tutoring/sessions":     { "query": { "role": "tutor|student?", "status": "string?" }, "res": ["TutoringSession"] },
  "GET /tutoring/sessions/{id}":{ "note": "parties only; 404 otherwise", "res": "TutoringSession" },
  "POST /tutoring/sessions/{id}/counter":  { "note": "either side proposes a different time; flips waiting_on", "req": { "start": "ts", "end": "ts", "message": "string?" }, "res": "TutoringSession" },
  "POST /tutoring/sessions/{id}/accept":   { "note": "only the party in waiting_on; library_room triggers room booking (picks the first LibCal room free for the whole session)", "res": "TutoringSession" },
  "POST /tutoring/sessions/{id}/decline":  { "res": "TutoringSession" },
  "POST /tutoring/sessions/{id}/pay":      { "headers": ["Idempotency-Key"], "note": "student only; session must be accepted (else INVALID_STATE; free sessions too). Same flow as POST /orders/{id}/pay: PAYMENTS=demo → paid at once, client_secret null, demo true. PAYMENTS=stripe → demo false, open PaymentSheet/Elements with client_secret; the session stays accepted until the payment_intent.succeeded webhook moves it to paid (watch tutoring.updated). Calling pay again returns the same PaymentIntent. Money is held until the session is confirmed (see Tutoring escrow).", "res": { "client_secret": "string? (null when demo is true)", "payment_intent_id": "string?", "demo": "bool", "session": "TutoringSession" } },
  "POST /tutoring/sessions/{id}/book-room":{ "note": "retries booking; returns the session's room_booking", "res": "RoomBooking" },
  "GET /library/rooms":         { "note": "free Gorgas study rooms on a library-local day, for a 'rooms free now' card; [] when LibCal is off or unreachable", "query": { "date": "date" }, "res": ["FreeRoomSlot"] },
  "POST /tutoring/sessions/{id}/complete": { "note": "after the start time. A paid session can only be completed by the student (else FORBIDDEN); it pays the tutor", "res": "TutoringSession" },
  "POST /tutoring/sessions/{id}/cancel":   { "note": "a paid session is refunded to the student in full", "req": { "reason": "string" }, "res": "TutoringSession" },

  "PUT /me/driver":             { "req": { "vehicle": { "make": "string", "model": "string", "color": "string", "plate": "string" }, "accepts_terms": "bool" }, "res": { "status": "pending|verified|rejected" } },
  "POST /rides":                { "note": "driver posts a trip", "req": { "origin": "Place", "destination": "Place", "depart_at": "ts", "seats": "int", "price_per_seat_cents": "cents" }, "res": "Ride" },
  "POST /ride-requests":        { "note": "rider asks, now or scheduled", "req": { "pickup": "Place", "dropoff": "Place", "depart_at": "ts|now", "seats": "int", "max_price_cents": "cents?" }, "res": "RideRequest" },
  "GET /rides":                 { "query": { "near": "lat,lng?", "to_near": "lat,lng?", "date": "string?" }, "res": ["Ride"] },
  "GET /ride-requests/open":    { "note": "for drivers", "res": ["RideRequest"] },
  "POST /rides/{id}/book":      { "req": { "seats": "int", "pickup": "Place?" }, "res": { "booking_id": "uuid", "client_secret": "string" } },
  "POST /ride-requests/{id}/accept": { "res": "Ride" },
  "POST /rides/{id}/status":    { "req": { "status": "en_route|picked_up|completed|cancelled" }, "res": "Ride" },
  "POST /rides/{id}/location":  { "req": { "location": "LatLng" }, "res": "204" },

  "GET /events":                { "query": { "kind": "string?", "from": "ts?" }, "res": ["Event"] },
  "GET /events/{id}/tickets":   { "res": ["Listing"] },
  "POST /orders/{id}/ticket-sent":     { "note": "seller, after app transfer", "req": { "proof_media_id": "uuid?" }, "res": "Order" },
  "POST /orders/{id}/ticket-received": { "note": "buyer, releases funds", "res": "Order" },

  "POST /syllabi":              { "req": { "course_id": "uuid", "term": "string", "media_id": "uuid" }, "res": { "job_id": "uuid", "syllabus_id": "uuid" } },
  "POST /syllabi/{id}/confirm": { "req": { "events": [{ "kind": "exam|assignment|project|quiz", "title": "string", "due_at": "ts" }] }, "res": ["CourseEvent"] },
  "GET /courses/{id}/events":   { "query": { "term": "string" }, "res": ["CourseEvent"] },
  "GET /study-groups":          { "query": { "course_id": "uuid?", "scope": "campus|all_schools" }, "res": ["StudyGroup"] },
  "GET /study-groups/suggested-times": { "query": { "course_id": "uuid", "before_event_id": "uuid?" }, "res": [{ "start": "ts", "end": "ts", "classmates_free": "int" }] },
  "POST /study-groups":         { "req": { "course_id": "uuid", "title": "string", "target_event_id": "uuid?", "mode": "in_person|virtual", "place": "Place?", "start": "ts", "end": "ts", "capacity": "int", "cross_campus": "bool" }, "res": "StudyGroup" },
  "POST /study-groups/{id}/join":  { "res": "StudyGroup" },
  "POST /study-groups/{id}/leave": { "res": "204" },

  "TutorProfile":    { "user_id": "uuid", "enabled": "bool", "courses": [{ "course": "Course", "grade": "string", "verified": "bool" }], "hourly_rate_cents": "cents", "bio": "string?", "modes": ["string"], "open_to_requests": "bool", "rating": "number", "sessions_completed": "int" },
  "TutorMatch": {
    "tutor": "UserPublic", "profile": "TutorProfile",
    "grade": "string", "grade_verified": "bool", "term_taken": "string",
    "rating": "number", "review_count": "int", "hourly_rate_cents": "cents",
    "open_slots": ["TimeBlock"], "mutual_slots": [{ "start": "ts", "end": "ts", "kind": "free", "library_room": "LibraryRoom? (first room free for the whole slot; null if none or the tutor is online-only)" }],
    "match": { "score": "number", "mutual_minutes": "int", "reasons": ["string"] }
  },
  "TutoringSession": {
    "id": "uuid", "tutor": "UserPublic", "student": "UserPublic", "course": "Course", "start": "ts", "end": "ts", "price_cents": "cents",
    "location": { "kind": "library_room|safe_zone|virtual", "name": "string?", "meeting_url": "string?" },
    "room_booking": "RoomBooking",
    "status": "requested|accepted|paid|completed|cancelled|no_show",
    "waiting_on": "tutor|student?", "history": [{ "by": "tutor|student", "action": "propose|counter|accept|decline", "start": "ts", "end": "ts", "at": "ts" }],
    "handoff_id": "uuid?",
    "payment": { "status": "none|requires_payment|succeeded|failed|refunded", "paid_at": "ts?" },
    "payout": { "status": "held|awaiting_onboarding|released|reversed?", "released_at": "ts?", "tutor_payout_cents": "cents? (price minus the platform fee, fixed at pay)" }
  },
  "RoomBooking":     { "status": "not_needed|pending|booked|manual_required", "room": "{ id: string, name: string }?", "booking_url": "string? (manual_required: the room's LibCal page, or the library site when no room was free)" },
  "Ride":            { "id": "uuid", "driver": "UserPublic", "origin": "Place", "destination": "Place", "depart_at": "ts", "seats_total": "int", "seats_left": "int", "price_per_seat_cents": "cents", "riders": ["UserPublic"], "status": "open|full|en_route|completed|cancelled", "driver_location": "LatLng?" },
  "RideRequest":     { "id": "uuid", "rider": "UserPublic", "pickup": "Place", "dropoff": "Place", "depart_at": "ts", "seats": "int", "max_price_cents": "cents?", "status": "open|matched|cancelled", "ride_id": "uuid?" },
  "CourseEvent":     { "id": "uuid", "course_id": "uuid", "kind": "string", "title": "string", "due_at": "ts", "source": "syllabus|manual", "confirmations": "int" },
  "StudyGroup":      { "id": "uuid", "course": "Course", "title": "string", "host": "UserPublic", "target_event": "CourseEvent?", "mode": "string", "place": "Place?", "meeting_url": "string?", "start": "ts", "end": "ts", "capacity": "int", "members": ["UserPublic"], "cross_campus": "bool" }
}
```

> **Tutoring escrow:** `POST /tutoring/sessions/{id}/pay` holds the full `price_cents` on the platform (same `escrow_entries` ledger and providers as orders). In-person sessions then get a `handoff_id`: a Handoff with `context.type: tutoring_session`, giver = tutor, receiver = student, already `agreed` at the session's start and library spot (or `proposing` when the school has no library safe zone). The money moves when the session ends: handoff confirmed (`/confirm` or both `/tap`, `item_ok: true`) or the student calls `/complete` (the only way for virtual sessions) → `completed`, tutor paid (`payout.status: released`, or `awaiting_onboarding` until their Stripe payouts are on); `item_ok: false` keeps the money held on a still-`paid` session for the team; `/cancel` → `cancelled` and the handoff no-show (reported or overdue, either party) → `no_show`, both refunding the student in full.

> **Tutor eligibility rule:** a user shows up in `/tutors` for a course when they have a `past` `ClassRecord` for it with a grade ≥ `School.tutor_min_grade` (verified only, unless `include_unverified=true`), and an enabled `TutorProfile` that lists the course. `mutual_slots` apply the walk-time rule to the tutor and student, using the library (or chosen safe zone) as the meeting spot.

> **Library room rule:** each mutual slot gets `library_room`: the first Gorgas Team Workroom (smallest first) that UA's LibCal shows free for the **whole** slot. Consecutive free LibCal slots of one room are merged; any taken part disqualifies it. Each slot with a room adds +1.5 to `match.score` (counted for at most 3 slots, so at most +4.5), and the reasons say "Library room free at …". Availability is read-only from the public booking page, cached 60 s, and turned off with `LIBCAL=off`; if LibCal is down every `library_room` is `null`. Nothing is booked automatically: on accept, `room_booking` stays `manual_required` with `booking_url` = that room's LibCal page, unless a room booker that can really book is configured.

Tickets reuse Listings, Offers and Orders (`category: ticket`); only the transfer confirmation is new. Funds for tickets stay held until the buyer confirms receipt or the event starts with no dispute.

### Endpoints — friends, reviews, notifications, ingestion

```jsonc
{
  "GET /me/friends":                  { "res": ["UserPublic"] },
  "GET /users/{id}/mutuals":          { "res": ["UserPublic"] },
  "POST /friend-requests":            { "req": { "user_id": "uuid" }, "res": { "id": "uuid", "status": "pending" } },
  "GET /me/friend-requests":          { "res": [{ "id": "uuid", "from": "UserPublic", "created_at": "ts" }] },
  "POST /friend-requests/{id}/accept":  { "res": "UserPublic" },
  "POST /friend-requests/{id}/decline": { "res": "204" },
  "DELETE /friends/{user_id}":        { "res": "204" },
  "GET /me/suggested-friends":        { "note": "shared classes + mutuals", "res": [{ "user": "UserPublic", "shared_courses": ["Course"] }] },

  "POST /reviews":                    { "req": { "context": { "type": "order|tutoring_session|ride", "id": "uuid" }, "stars": "int", "on_time": "bool", "as_described": "bool", "comment": "string?" }, "res": "Review" },
  "GET /users/{id}/reviews":          { "res": ["Review"] },
  "POST /reports":                    { "req": { "target": { "type": "user|listing|offer", "id": "uuid" }, "reason": "scam|unsafe|spam|other", "details": "string" }, "res": "204" },

  "GET /me/notifications":            { "res": ["Notification"] },
  "POST /me/notifications/read":      { "req": { "ids": ["uuid"], "all": "bool?" }, "res": "204" },
  "POST /me/push-subscriptions":      { "req": { "platform": "web|ios|android", "subscription": "object" }, "res": "204" },

  "GET /ingested-posts/{id}":         { "res": { "id": "uuid", "channel": "string", "raw_text": "string", "author_handle": "string?", "posted_at": "ts", "listing": "Listing?", "ride_request": "RideRequest?" } },
  "POST /admin/orders/{id}/resolve":  { "note": "admin; only for a disputed order (else INVALID_STATE). complete = release to the seller (or awaiting_onboarding), refund = money back to the buyer. Both parties are notified", "req": { "outcome": "complete|refund", "note": "string (1-1000)" }, "res": "Order" },
  "POST /admin/ingested-posts":       { "note": "admin (profiles.is_admin) or scraper; feeds one external post in; the same URL twice is a no-op; 202 → ingest_classify job (owned by the caller, so GET /jobs/{id} works; result: { listing_id, status, isbn, missing, matched_course_ids, notified }) → Listing with source.claimed=false", "req": { "channel": "instagram|groupme|facebook|snapchat", "external_url": "string", "author_handle": "string", "caption": "string", "media_ids": ["uuid"], "posted_at": "ts" }, "res": { "job_id": "uuid", "ingested_post_id": "uuid" } },
  "GET /admin/seller-invites":        { "note": "admin; DMs to send by hand until outreach is automated", "query": { "status": "queued|sent|claimed?" }, "res": ["SellerInvite"] },
  "POST /admin/seller-invites/{id}/sent": { "res": "SellerInvite" },
  "GET /admin/ingestion/feed":       { "note": "admin; the live-sources screen, newest first (poll every ~2 s). status: queued|processing|processed|failed. events are the pipeline steps in order; step: detected|photos_saved|identified|matched_courses|listed|notified|replied|reply_failed|failed|dm_sent|dm_failed|dm_window_closed", "res": [{ "id": "uuid", "channel": "string", "external_url": "string", "author_handle": "string", "caption": "string", "posted_at": "ts", "received_at": "ts", "photo_url": "string?", "status": "string", "listing": "{ id, title, price_cents, status, isbn? }?", "course_codes": ["string"], "notified": "int", "identified_by": "vision|caption?", "confidence": "number?", "events": [{ "at": "ts", "step": "string", "text": "string" }], "error": "string?" }] },
  "GET /admin/instagram/status":     { "note": "admin; the poller reads posts that tag our account (INSTAGRAM=graph) or the seller account's own stories (INSTAGRAM=stories) every INSTAGRAM_POLL_SECONDS. seller_account and dm_window are null outside stories mode. dm_window.open: the seller DMed us in the last 24 h (expires_at = last_inbound_at + 24 h), re-worked out against the clock on every read", "res": { "mode": "graph|stories|off", "account": "string? (our IG username)", "seller_account": "string? (stories mode)", "polling_every_s": "int", "last_poll_at": "ts?", "next_poll_at": "ts?", "last_error": "string?", "polls": "int", "ingested": "int", "dm_window": "DmWindow?" } },
  "POST /admin/instagram/poll":      { "note": "admin; poll right now instead of waiting for the next tick (stories in stories mode); 409 INVALID_STATE when polling is off", "res": { "found": "int", "ingested": "int", "status": "InstagramStatus" } },
  "DmWindow":                        { "open": "bool", "last_inbound_at": "ts? (the seller's newest message to us)", "expires_at": "ts?", "seller_igsid": "string? (the seller as our account sees them; cached)", "checked_at": "ts?", "last_error": "string?" },
  "POST /admin/instagram/dm":        { "note": "admin; stories mode; DMs the seller now. 409 INVALID_STATE when the mode isn't stories or the 24 h window is closed (message says why and to ask the seller to DM us first); 500 INTERNAL with Instagram's message if Instagram refuses", "req": { "text": "string (1-1000)" }, "res": { "sent": "true", "message_id": "string", "dm_window": "DmWindow" } },
  "POST /admin/instagram/dm-window/refresh": { "note": "admin; stories mode; re-reads our conversation with the seller (Conversations API). Never fails on an Instagram error: it lands in last_error. 409 INVALID_STATE outside stories mode", "res": "DmWindow" },
  "POST /admin/instagram/dm/listed": { "note": "admin; stories mode; re-sends the \"listed\" DM for an ingested story and adds the event to its feed entry. 404 when it isn't an ingested story, 409 when it isn't a live listing or the window is closed. sent=false (with a dm_failed event) when Instagram refuses", "req": { "ingested_post_id": "uuid" }, "res": { "sent": "bool", "event": "{ at, step, text }", "dm_window": "DmWindow" } },

  "SellerInvite": { "id": "uuid", "external_seller": "ExternalSeller", "listing_ids": ["uuid"], "claim_url": "string", "message_text": "string", "status": "queued|sent|claimed|expired", "trigger": "first_offer|manual", "sent_at": "ts?", "claimed_at": "ts?", "expires_at": "ts" }
}
```

The frontend **never talks to Stripe, Google or GroupMe directly**, except Stripe Elements / PaymentSheet (using `client_secret`) and the Stripe-hosted onboarding page.

### Realtime channels (Supabase Realtime)

Every message is `{ "event": "string", "at": "ts", "data": object }`. Channels are private and authorised by RLS: subscribe with the user's access token; on `handoff:{id}` only the giver and receiver receive (clients never send). Payloads are identical for both phones and never carry locations or distances; refetch `GET /handoffs/{id}` for your own `tracking`.

| Channel | Events | Payload `data` |
|---|---|---|
| `user:{id}` | `notification.created`, `offer.created`, `offer.updated`, `order.updated`, `job.finished`, `wishlist.match`, `material.match`, `tutoring.updated`, `shipment.updated` | `Notification`, `Offer`, `Offer`, `Order`, `Job`, `{ wishlist_item_id, listing }`, `{ listing, course }`, `TutoringSession`, `Shipment` |
| `handoff:{id}` | `handoff.updated`, `handoff.presence`, `handoff.tap`, `handoff.completed` | `Handoff` (neutral: `tracking.me` null, no distances), `{ giver_nearby, receiver_nearby }`, `{ by: giver\|receiver, expires_at }`, `Handoff` (neutral: `tracking.me` null, no distances) |
| `ride:{id}` | `ride.location`, `ride.updated` | `{ location: LatLng }`, `Ride` |
| `auto-bargain:{id}` | `round`, `finished` | `{ by, amount_cents }`, `{ status, proposed_offer }` |

### Inbound webhooks (server only, not called by the frontend)

| Endpoint | Source | Handles |
|---|---|---|
| `POST /webhooks/stripe` | Stripe | `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, `account.updated` |
| `POST /webhooks/groupme` | GroupMe bot callback | New group messages → `ingested_posts` → AI classify into listing or ride request |
| `POST /webhooks/google-calendar` | Google push notifications | Calendar changed → refresh cached free/busy |

### Demo flows (call sequences)

These are the two P0 demo moments, end to end. If a step here can't be done with the endpoints above, the contract is wrong.

**Demo 1 — tutor match → schedule → library room**

1. Student (has a schedule saved) opens course A → `GET /tutors?course_id=A&from=…&to=…`.
2. Server: users with a past grade in A ≥ `tutor_min_grade` and an enabled `TutorProfile` → expands both schedules into free time → `mutual_slots` (with walk time to the library) → ranked `TutorMatch[]` with grade, rating, rate, slots.
3. Student picks a tutor + slot → `POST /tutoring/sessions` (`waiting_on: tutor`). Tutor gets `tutoring.updated`.
4. Tutor `accept`s, or `counter`s with another time (then the student accepts).
5. On accept with `library_room`: room booking runs → `room_booking.status` = `booked`, or `manual_required` with `room` = the real free Gorgas room and `booking_url` = its LibCal page (library site if none was free). `GET /library/rooms?date=…` powers a "rooms free now" card.
6. Payment + in-person check-in reuse the order/handoff pieces (stretch for the demo).

**Demo 2 — Instagram post → matched buyer → claim → fulfil**

1. Scraper (stubbed: `POST /admin/ingested-posts`) feeds in a post → `ingest_classify` job identifies the textbook (ISBN, title, edition), looks up the courses that require it, and creates a `Listing` with `external_seller` set and `source.claimed: false`.
2. Matching: every student with a `current`/`planned` `ClassRecord` in one of those courses gets `material.match` + a notification; the listing shows in their `/feed` with `reason: your_class` and `reason_course`.
3. Buyer `POST /listings/{id}/offers` (their price, or the asking price) with `fulfillment`. Listing is unclaimed → offer `waiting_on: seller_claim`, and a `SellerInvite` is queued with a ready-to-send DM + claim link.
4. Seller taps the link → `GET /claims/{token}` (preview, no login) → signs in with .edu → `POST /claims/{token}` → the listing + pending offers are now theirs.
5. Seller accepts (or counters) → `Order` (`awaiting_payment`) → buyer `POST /orders/{id}/pay` → `paid` (money held on the platform).
6. **In person:** `POST /handoffs/{id}/suggest` → safe zone + time picked from both schedules (classes near each other, both free) → `propose`/`agree` → at the zone, giver `POST /handoffs/{id}/code`, receiver scans → `confirm` with `item_ok` → `completed` → payout released.
7. **Campus mail:** seller `POST /orders/{id}/shipment` → printable label (buyer name + mail stop + label code) + `drop_off` directions → seller drops it off: `dropped-off` with photo + location inside the drop-off point → order `in_transit` → buyer scans the label code: `received` → `completed` → payout released (or auto-complete after N days).

---

## Part 2 — Backend modules and build order

Twenty modules, but the demo rides on six: **Platform, Identity, Media, Listings, Orders & Payments, and Handoff.** Build those first as one vertical slice, then layer the smart features on top, then reuse the same pieces for the other verticals.

| # | Module | Owns (tables) | Depends on | Serves endpoints |
|---|---|---|---|---|
| 1 | Platform core | config, errors, auth middleware, Zod schemas, job runner, RLS policies | — | all |
| 2 | Identity & profile | schools, profiles, auth hook | 1 | `/auth`, `/me`, `/users` |
| 3 | Media | Storage buckets, media | 1, 2 | `/media` |
| 4 | Listings & search | listings, listing_media, search index (Postgres full-text) | 2, 3 | `/listings`, `/explore`, `/feed` |
| 5 | Orders & payments | orders, payments, stripe_accounts, payouts, order state machine | 2, 4, Stripe | `/orders`, `/payments`, Stripe webhook |
| 6 | Handoff & safety | safe_zones, handoffs, handoff_events | 5 | `/handoffs`, `/safe-zones` |
| 7 | AI parsing | jobs; prompts + JSON schemas per job kind | 1, 3, Claude API | `/jobs`, used by 4, 8, 9, 17, 20 |
| 8 | Academics | courses, class_records, transcripts, course_materials | 2, 7 | `/transcripts`, `/me/classes`, `/courses` |
| 9 | Schedule & availability | buildings (seeded per school), class_meetings, calendar_connections, busy_cache; slot-finder + walk-time estimator | 2, 7, 8, Google | `/me/class-schedule`, `/buildings`, `/me/availability`, `/integrations/google` |
| 10 | Offers & negotiation | offers, bargain_sessions | 4, 5 | `/offers`, `/auto-bargain` |
| 11 | Wishlist & matching | wishlist_items, matches; trade suggester | 4, 8 | `/me/wishlist`, `/suggested-trades` |
| 12 | Notifications | notifications, push_subscriptions; realtime fan-out | 2 | `/me/notifications`, realtime |
| 13 | Reputation & reviews | reviews, reports, reliability calculator | 5, 6 | `/reviews`, `/reports` |
| 14 | Social graph | friendships, friend_requests | 2, 8 | `/friends`, `/mutuals` |
| 15 | Campus mail | shipments; label PDF generator | 5 | `/shipments` |
| 16 | Ingestion | ingested_posts, source configs | 4, 7, GroupMe | `/ingested-posts`, GroupMe webhook |
| 17 | Tutoring | tutor_profiles, tutor_availability, tutoring_requests, tutoring_sessions | 5, 6, 8, 9 | `/tutoring`, `/tutors` |
| 18 | Rides | drivers, rides, ride_requests, ride_bookings | 5, 12 | `/rides`, `/ride-requests` |
| 19 | Tickets | events (tickets are listings) | 4, 5 | `/events` |
| 20 | Study groups | syllabi, course_events, study_groups, study_group_members | 7, 8, 9 | `/syllabi`, `/study-groups` |

### Order lifecycle (the one state machine everything shares)

```text
awaiting_payment --pay--> paid --agree time/place--> scheduled --both nearby--> handing_off --QR confirm--> completed
        |                   |                            |                            |
        +--cancel--> cancelled   +--cancel--> refunded     +--no_show--> refunded/dispute  +--dispute--> disputed --> completed | refunded
```

- `paid` = buyer charged; money sits on the platform balance.
- `completed` = Stripe transfer to the seller minus `fee_cents`, then reviews unlock and reliability updates.
- Campus mail swaps the handoff steps: `paid --label created--> scheduled --dropped off (geofence + photo)--> in_transit --buyer scans label--> completed`. Tickets swap them for `ticket-sent → ticket-received`.
- Escrow ledger: `pay` writes a `hold`, final states write a `release` or `refund` (`GET /orders/{id}/escrow`). Demo or Stripe provider, chosen by `PAYMENTS`.
- Payout: `held` while the order is open; on `completed` it becomes `released` (Stripe transfer), or `awaiting_onboarding` if the seller hasn't finished Stripe yet; a refund makes it `reversed`.
- Timers (`workers/order-timers.ts`, `ORDER_TIMERS=on|off`, every `ORDER_TIMERS_INTERVAL_MS`, default 60 s): unpaid orders cancel after 30 min; campus-mail orders auto-complete at `auto_complete_at`; pending offers expire after 48 h; overdue meetups (1 h past `agreed.end`, still agreed/arriving): only one side ever arrived → no-show against the other + buyer refund; nobody arrived → handoff back to `proposing` (order stays `scheduled`); both arrived but no confirm → both notified once.

### Build order

Within a phase, modules can be built in parallel by different people.

- **Phase 1 (P0 vertical slice):** 1 Platform, 2 Identity, 3 Media, 4 Listings, 5 Orders & Payments, 6 Handoff.
- Screenshot-to-listing (7 AI parsing) can jump into phase 1 if someone is free, since it only needs Media and Listings.
- Later phases follow the P1 / P2 tiers above.

---

## Part 3 — Integrations and external setup

Set up **Supabase, the API host, Stripe, the Claude API and an Apple Developer account** before anything else; those five unblock the whole P0 demo. Everything else can be added per phase.

### Must have for P0

| Service | Used for | Setup checklist |
|---|---|---|
| Supabase | Postgres, Auth, Storage, Realtime | Create project · apply `supabase/migrations` (enables `pg_trgm`) · Auth: email OTP (6-digit code, easier than magic links in a Swift app) · auth hook or trigger that rejects non-.edu domains and sets `school_id` · Storage buckets `public-media` (listing photos) and `private-docs` (transcripts, syllabi; signed URLs only) · enable Realtime on notifications, offers, orders, handoffs · custom SMTP so OTP emails aren't rate-limited |
| API host | Runs the Hono API + job workers | Fly.io or Railway app · env vars (below) · HTTPS domain, e.g. `api.<yourapp>.com` · CORS allow-list for the website origin |
| Stripe | Buyer payments, seller payouts, platform fee | Test mode · enable Connect, Express accounts · separate charges and transfers so funds wait until handoff · webhook endpoint for `payment_intent.*`, `charge.refunded`, `charge.dispute.created`, `account.updated` · iOS: Stripe iOS SDK PaymentSheet; web: Stripe Elements · optional Apple Pay merchant ID |
| Claude API | Screenshot → listing, transcript, syllabus, textbook photo, GroupMe post classification | API key · one prompt + JSON schema per job kind · run as background jobs, never inline in a request |
| Apple Developer | Ship the Swift app at all | Paid account for TestFlight · APNs auth key (.p8) for push · location usage strings (when-in-use is enough) · camera + photo library usage strings · URL scheme for OAuth return |
| Email sender | OTP + receipts | Resend or Postmark · verify sending domain (SPF/DKIM) · plug in as Supabase custom SMTP |

### Needed for P1–P2

| Service | Used for | Setup checklist |
|---|---|---|
| Google Cloud | Calendar free/busy | OAuth client (web type, redirect to `/integrations/google/callback`) · scope `calendar.readonly` (or `calendar.freebusy`) · consent screen in Testing mode, add team + demo users as test users · iOS opens the backend's `auth_url` in `ASWebAuthenticationSession` |
| Push delivery | iOS + web notifications | APNs from the API (token-based .p8) · Web Push with VAPID keys |
| Maps | Campus map, safe zones, distance | MapKit on iOS · Mapbox or Leaflet + OSM on web · distance and geofence checks done **server-side in the API**, not in clients |
| Book metadata | ISBN → title, cover, edition | Open Library or Google Books API |
| GroupMe | Ingest Joyride + marketplace group posts | Developer token · bot with callback URL `/webhooks/groupme` · a group member has to add the bot to each group |
| Library rooms | Free rooms + auto-book tutoring rooms | UA uses Springshare LibCal (`ua.libcal.com`, Gorgas `lid=214`, Team Workrooms `gid=436`). Free rooms come read-only from its public availability grid (`LIBCAL=on`); booking stays a deep link to the room (`manual_required`) until a booker that signs in exists |
| Campus mail | Async delivery labels | Generated PDF only (no carrier API); needs UA mail stop format confirmed |

### Channels without a usable API

Instagram, Snapchat and Facebook groups don't expose posts or chats to third-party apps, so ingest them through **screenshot → listing** and the **iOS share sheet** instead of scrapers. A Share Extension in the Swift app that sends a screenshot to `/listings/from-screenshot` is the fastest path.

### Environment variables

See [`backend/.env.example`](../backend/.env.example).

```text
SUPABASE_URL  SUPABASE_ANON_KEY  SUPABASE_SERVICE_ROLE_KEY  SUPABASE_JWT_SECRET
STRIPE_SECRET_KEY  STRIPE_WEBHOOK_SECRET  STRIPE_PUBLISHABLE_KEY (clients)  PLATFORM_FEE_BPS
ANTHROPIC_API_KEY
GOOGLE_CLIENT_ID  GOOGLE_CLIENT_SECRET  GOOGLE_REDIRECT_URI  TOKEN_ENCRYPTION_KEY
APNS_KEY_ID  APNS_TEAM_ID  APNS_PRIVATE_KEY  APNS_BUNDLE_ID
VAPID_PUBLIC_KEY  VAPID_PRIVATE_KEY
GROUPME_BOT_TOKEN  RESEND_API_KEY  WEB_ORIGIN  APP_URL_SCHEME
ROOM_BOOKER  ROOM_BOOKING_URL  LIBCAL (on|off, live free library rooms)
HANDOFF_SECRET (32+ chars, signs handoff QR codes)  PAYMENTS (demo|stripe)  ORDER_TIMERS (on|off)  ORDER_TIMERS_INTERVAL_MS (default 60000)
```

> **Never ship the Supabase service-role key or Stripe secret key to either client**; only the anon key and Stripe publishable key go in the app and website.

---

## Open questions

The first four change what gets built for the demo; the rest can be answered as each phase starts.

- [ ] **Time and team:** how many hours is the hackathon and how many backend people? That decides where the P0 line actually falls.
- [ ] **Demo school:** UA only, or must a second school work live?
- [ ] **Money:** Stripe test mode for the demo? What platform fee (default assumed 5%), and does buyer or seller pay it?
- [x] **Escrow:** hold buyer funds from pay until the meetup is confirmed (both tap, or QR); refund on no-show or cancel. Built on an `escrow_entries` ledger with a demo provider; Stripe comes later as a provider.
- [ ] **Tutoring threshold:** minimum grade to tutor (assumed A-)? Allow self-reported grades with an "unverified" badge, or transcript only?
- [ ] **Auto-bargaining:** must a human tap accept on the agent's deal (assumed yes), or can it auto-close?
- [ ] **Rides:** scheduled carpools (like Joyride), or on-demand with live driver tracking? Carpools are far simpler and lower liability.
- [ ] **Tickets:** how are UA student tickets transferred today (in-app transfer vs. physical/ID)?
- [ ] **Course materials:** is there a source for required textbooks per course (bookstore list), or crowdsource from listings?
- [x] **Campus mail:** MSC is a permanent 6-digit code (myBama → Campus Mail Student Portal); orders auto-complete 7 days after the package enters the mail stream. See [Campus mail at UA](#campus-mail-at-ua).
- [ ] **Library booking:** UA uses LibCal (availability is public; booking needs a UA sign-in). Is automated booking allowed?
- [ ] **GroupMe:** can we get the Joyride group admins to add our bot?
- [x] **Instagram:** no scraping, no cold DMs. Sellers tag our business account (photo tag **and** an @mention in the caption). With `INSTAGRAM=graph` the API polls `GET /{ig-id}/tags`, copies the photos, runs Claude vision (`IDENTIFIER=auto` + `ANTHROPIC_API_KEY`), lists the book, notifies students, and replies publicly on the post (`POST /{ig-id}/mentions`, caption mentions only). The first offer replies again with the claim link and marks the invite sent. `/admin/ingested-posts` stays as the by-hand fallback; `INSTAGRAM=off` turns all of it off.
- [x] **Instagram stories + DMs (`INSTAGRAM=stories`):** the seller account reads its own stories with its own token (`INSTAGRAM_SELLER_TOKEN`), and each new story goes through the same ingest. Our account DMs the seller the "listed" message and, on the first offer, the claim link, but only while the seller's 24 h messaging window is open (read from the Conversations API). A human opens the window by DMing us; nothing automated keeps it open, and sends are refused (`409`, `dm_window_closed`) when it's closed. See `docs/INSTAGRAM_SETUP.md`.
- [ ] **Payout before onboarding:** OK that a claimed seller can accept and the buyer can pay before the seller sets up Stripe (payout waits as `awaiting_onboarding`)?
