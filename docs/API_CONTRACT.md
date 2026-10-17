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
| DB, auth, files, realtime | Supabase (Postgres + PostGIS, Auth, Storage, Realtime) | RLS gives per-school isolation for free |
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
- **Error codes:** `UNAUTHENTICATED`, `NOT_EDU_EMAIL`, `SCHOOL_NOT_SUPPORTED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `INVALID_STATE` (illegal status change), `STRIPE_ONBOARDING_REQUIRED`, `PAYMENT_FAILED`, `NOT_NEARBY`, `RATE_LIMITED`, `INTERNAL` (500, unexpected server error).
- **Idempotency:** any call that moves money or advances an order or handoff takes an `Idempotency-Key` header.
- **AI jobs:** return `202 { "job_id" }`; the frontend listens on its user channel or polls `GET /jobs/{id}`.

**Notation in the schemas:** `"uuid"`, `"string"`, `"int"`, `"number"`, `"bool"`, `"ts"` (timestamp), `"cents"`, `"a|b|c"` = enum, `[T]` = array, trailing `?` = optional or nullable, a Capitalised name = a shared object below.

### Shared objects

```jsonc
{
  "School":       { "id": "uuid", "name": "string", "domain": "string", "center": "LatLng", "campus_mail_supported": "bool" },
  "LatLng":       { "lat": "number", "lng": "number" },
  "Place":        { "label": "string", "location": "LatLng" },
  "Media":        { "id": "uuid", "url": "string", "kind": "image|pdf", "width": "int?", "height": "int?" },
  "Reliability":  { "score": "number", "completed": "int", "no_shows": "int", "badge": "new|reliable|top" },
  "UserPublic": {
    "id": "uuid", "display_name": "string", "avatar_url": "string?", "major": "string?", "grad_year": "int?",
    "school": "School", "reliability": "Reliability", "is_friend": "bool", "mutual_friend_count": "int",
    "can_receive_payments": "bool", "is_verified_driver": "bool"
  },
  "Me": {
    "user": "UserPublic", "email": "string", "phone": "string?",
    "budget_cents": "cents?", "mail_stop_code": "string?", "tutor_opt_in": "bool",
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
  "ClassMeeting": { "course_id": "uuid", "days": ["mon|tue|wed|thu|fri|sat|sun"], "start": "HH:MM", "end": "HH:MM", "place": "Place?" },
  "TimeBlock":    { "start": "ts", "end": "ts", "kind": "free|busy|class" },
  "SafeZone":     { "id": "uuid", "name": "string", "kind": "police|student_center|library|other", "location": "LatLng", "radius_m": "int", "hours": "string?" },
  "MeetupSuggestion": { "start": "ts", "end": "ts", "safe_zone": "SafeZone", "walk_minutes": { "me": "int", "them": "int" }, "reason": "string" },
  "Listing": {
    "id": "uuid", "seller": "UserPublic",
    "category": "textbook|lab_supplies|dorm|ticket|other",
    "title": "string", "description": "string", "price_cents": "cents", "negotiable": "bool",
    "floor_price_cents": "cents? (seller only)", "condition": "new|like_new|good|fair|poor",
    "media": ["Media"],
    "textbook": { "isbn": "string", "title": "string", "authors": ["string"], "edition": "string?", "courses": ["Course"] },
    "ticket": { "event": "Event", "section": "string", "row": "string?", "seat": "string?", "transfer": "app_transfer|in_person" },
    "fulfillment": ["in_person|campus_mail|digital_transfer"],
    "status": "draft|active|pending|sold|removed",
    "source": { "channel": "native|screenshot|groupme|facebook|snapchat", "external_url": "string?", "claimed": "bool" },
    "created_at": "ts"
  },
  "Event":        { "id": "uuid", "name": "string", "kind": "athletics|concert|other", "starts_at": "ts", "venue": "string" },
  "Offer": {
    "id": "uuid", "listing_id": "uuid", "buyer": "UserPublic", "seller": "UserPublic",
    "kind": "cash|trade|cash_plus_trade", "amount_cents": "cents", "trade_listing_ids": ["uuid"],
    "message": "string?", "counter_of": "uuid?", "auto_generated": "bool",
    "status": "pending|countered|accepted|declined|withdrawn|expired", "expires_at": "ts"
  },
  "Order": {
    "id": "uuid", "listing": "Listing", "buyer": "UserPublic", "seller": "UserPublic", "offer_id": "uuid?",
    "amount_cents": "cents", "fee_cents": "cents", "seller_payout_cents": "cents",
    "fulfillment": "in_person|campus_mail|digital_transfer",
    "status": "awaiting_payment|paid|scheduled|handing_off|completed|cancelled|disputed|refunded",
    "payment": { "status": "requires_payment|succeeded|failed|refunded", "paid_at": "ts?" },
    "handoff_id": "uuid?", "shipment": "Shipment?", "created_at": "ts"
  },
  "Handoff": {
    "id": "uuid", "context": { "type": "order|tutoring_session", "id": "uuid" },
    "parties": { "giver": "UserPublic", "receiver": "UserPublic" },
    "suggestions": ["MeetupSuggestion"], "agreed": { "start": "ts", "end": "ts", "safe_zone": "SafeZone" },
    "status": "proposing|agreed|arriving|completed|no_show|cancelled|expired",
    "presence": { "giver_nearby": "bool", "receiver_nearby": "bool" },
    "confirmations": { "giver_at": "ts?", "receiver_at": "ts?" }
  },
  "Shipment":     { "id": "uuid", "label_pdf_url": "string", "to": { "name": "string", "mail_stop_code": "string" }, "status": "label_created|dropped_off|received", "dropped_off_at": "ts?" },
  "Review":       { "id": "uuid", "from": "UserPublic", "to_user_id": "uuid", "context": { "type": "order|tutoring_session|ride", "id": "uuid" }, "stars": "int", "on_time": "bool", "as_described": "bool", "comment": "string?", "created_at": "ts" },
  "Notification": { "id": "uuid", "type": "string", "title": "string", "body": "string", "deep_link": "string", "read_at": "ts?", "created_at": "ts" },
  "Job":          { "id": "uuid", "kind": "transcript_parse|syllabus_parse|screenshot_to_listing|textbook_identify", "status": "queued|running|succeeded|failed", "result": "object?", "error": "string?" }
}
```

- `floor_price_cents` is returned **only to the seller** and is what auto-bargaining negotiates against.
- `ticket` and `textbook` are present only for those categories.

### Endpoints — identity, profile, academics, schedule

Sign-in: the frontend calls `/auth/check-email`, then Supabase `signInWithOtp`. A Supabase auth hook rejects non-.edu or unsupported domains server-side and attaches `school_id`, so the check is UX only.

```jsonc
{
  "POST /auth/check-email":   { "req": { "email": "string" }, "res": { "allowed": "bool", "school": "School?", "reason": "NOT_EDU_EMAIL|SCHOOL_NOT_SUPPORTED?" } },

  "GET /me":                  { "res": "Me" },
  "PATCH /me":                { "req": { "display_name": "string?", "major": "string?", "grad_year": "int?", "avatar_media_id": "uuid?", "phone": "string?", "budget_cents": "cents?", "mail_stop_code": "string?", "tutor_opt_in": "bool?", "location_sharing": "off|during_handoffs?", "notification_prefs": "object?" }, "res": "Me" },
  "GET /users/{id}":          { "res": { "user": "UserPublic", "mutual_friends": ["UserPublic"], "active_listings": ["Listing"], "tutor_profile": "TutorProfile?", "review_summary": { "avg_stars": "number", "count": "int" } } },
  "GET /users/search":        { "query": { "q": "string", "course_id": "uuid?" }, "res": ["UserPublic"] },

  "POST /media/upload-url":   { "req": { "purpose": "listing|avatar|transcript|syllabus|screenshot", "content_type": "string", "bytes": "int" }, "res": { "media_id": "uuid", "upload_url": "string", "expires_at": "ts" } },
  "GET /jobs/{id}":           { "res": "Job" },

  "POST /transcripts":        { "req": { "media_id": "uuid" }, "res": { "job_id": "uuid", "transcript_id": "uuid" } },
  "GET /transcripts/{id}":    { "res": { "id": "uuid", "status": "parsing|needs_review|confirmed|failed", "parsed": { "student_name": "string?", "terms": [{ "term": "string", "classes": [{ "course_code": "string", "title": "string", "credits": "number", "grade": "string?", "matched_course_id": "uuid?" }] }], "gpa": "number?" } } },
  "POST /transcripts/{id}/confirm": { "req": { "classes": [{ "course_id": "uuid", "term": "string", "status": "current|past", "grade": "string?" }] }, "res": { "classes": ["ClassRecord"], "tutor_eligible_courses": ["Course"] } },

  "GET /me/classes":          { "query": { "status": "current|past|planned?" }, "res": ["ClassRecord"] },
  "POST /me/classes":         { "req": { "course_id": "uuid", "term": "string", "status": "current|past|planned", "grade": "string?" }, "res": "ClassRecord" },
  "DELETE /me/classes/{id}":  { "res": "204" },
  "GET /courses":             { "query": { "q": "string" }, "res": ["Course"] },
  "GET /courses/{id}/materials": { "query": { "term": "string?" }, "res": [{ "isbn": "string", "title": "string", "required": "bool", "active_listings": "int", "lowest_price_cents": "cents?" }] },

  "PUT /me/class-schedule":   { "req": { "meetings": ["ClassMeeting"] }, "res": { "meetings": ["ClassMeeting"] } },
  "POST /integrations/google/connect": { "res": { "auth_url": "string" } },
  "GET /integrations/google/callback": { "note": "server-side OAuth redirect, stores refresh token, redirects to /settings" },
  "DELETE /integrations/google":       { "res": "204" },
  "GET /me/availability":     { "query": { "from": "ts", "to": "ts" }, "res": { "blocks": ["TimeBlock"] } }
}
```

Transcript parsing is **review-then-confirm**: grades only count as `grade_verified` after the user confirms the parsed result from an uploaded transcript, and only verified grades unlock tutoring.

### Endpoints — feed, listings, wishlist, offers, orders, handoff, mail

```jsonc
{
  "GET /feed":                { "query": { "cursor": "string?" }, "res": [{ "type": "listing|tutor|ride|ticket|study_group", "item": "object", "reason": "wishlist_match|your_class|friend|nearby|new?" }] },
  "GET /explore/listings":    { "query": { "q": "string?", "category": "string?", "course_id": "uuid?", "isbn": "string?", "min_cents": "int?", "max_cents": "int?", "condition": "string?", "fulfillment": "string?", "source": "string?", "within_budget": "bool?", "sort": "relevance|newest|price_asc|price_desc" }, "res": ["Listing"] },

  "POST /listings":           { "req": { "category": "string", "title": "string", "description": "string", "price_cents": "cents", "negotiable": "bool", "floor_price_cents": "cents?", "condition": "string", "media_ids": ["uuid"], "isbn": "string?", "course_ids": ["uuid"], "ticket": "object?", "fulfillment": ["string"], "publish": "bool" }, "res": "Listing" },
  "GET /listings/{id}":       { "res": { "listing": "Listing", "is_mine": "bool", "my_open_offer": "Offer?", "suggested_trades": ["SuggestedTrade"] } },
  "PATCH /listings/{id}":     { "req": "any POST /listings field", "res": "Listing" },
  "DELETE /listings/{id}":    { "res": "204 (sets status=removed)" },
  "GET /me/listings":         { "query": { "status": "string?" }, "res": ["Listing"] },
  "POST /listings/from-screenshot":   { "req": { "media_ids": ["uuid"] }, "res": { "job_id": "uuid" }, "job_result": { "draft": "POST /listings req", "confidence": "number", "missing_fields": ["string"] } },
  "POST /listings/identify-textbook": { "req": { "media_id": "uuid" }, "res": { "job_id": "uuid" }, "job_result": { "isbn": "string", "title": "string", "edition": "string?", "matched_courses": ["Course"], "suggested_price_cents": "cents?" } },

  "GET /me/wishlist":         { "res": ["WishlistItem"] },
  "POST /me/wishlist":        { "req": { "kind": "isbn|course_materials|keyword|category", "isbn": "string?", "course_id": "uuid?", "keyword": "string?", "category": "string?", "max_price_cents": "cents?", "alert": "bool" }, "res": "WishlistItem" },
  "DELETE /me/wishlist/{id}": { "res": "204" },
  "GET /me/wishlist/matches": { "res": [{ "wishlist_item_id": "uuid", "listing": "Listing" }] },
  "GET /me/upcoming-materials": { "query": { "term": "string" }, "res": [{ "course": "Course", "isbn": "string", "title": "string", "on_wishlist": "bool", "best_listing": "Listing?" }] },
  "GET /listings/{id}/suggested-trades": { "res": ["SuggestedTrade"] },

  "POST /listings/{id}/offers": { "req": { "kind": "cash|trade|cash_plus_trade", "amount_cents": "cents", "trade_listing_ids": ["uuid"], "message": "string?" }, "res": "Offer" },
  "GET /me/offers":           { "query": { "role": "buyer|seller", "status": "string?" }, "res": ["Offer"] },
  "POST /offers/{id}/counter":  { "req": { "amount_cents": "cents", "message": "string?" }, "res": "Offer" },
  "POST /offers/{id}/accept":   { "res": { "offer": "Offer", "order": "Order" } },
  "POST /offers/{id}/decline":  { "res": "Offer" },
  "POST /offers/{id}/withdraw": { "res": "Offer" },
  "POST /listings/{id}/auto-bargain": { "req": { "max_price_cents": "cents", "style": "quick|balanced|patient" }, "res": { "session_id": "uuid", "status": "negotiating|deal_found|no_deal" } },
  "GET /auto-bargain/{id}":   { "res": { "status": "negotiating|deal_found|no_deal", "rounds": [{ "by": "buyer_agent|seller_agent", "amount_cents": "cents", "at": "ts" }], "proposed_offer": "Offer?" } },

  "GET /orders/{id}":         { "res": "Order" },
  "GET /me/orders":           { "query": { "role": "buyer|seller", "status": "string?" }, "res": ["Order"] },
  "POST /orders/{id}/pay":    { "headers": ["Idempotency-Key"], "res": { "client_secret": "string", "payment_intent_id": "string" } },
  "POST /orders/{id}/cancel": { "req": { "reason": "string" }, "res": "Order" },
  "POST /orders/{id}/dispute":{ "req": { "reason": "not_as_described|no_show|never_received|other", "details": "string", "media_ids": ["uuid"] }, "res": "Order" },
  "POST /payments/onboard":   { "res": { "onboarding_url": "string" } },
  "GET /payments/status":     { "res": { "charges_enabled": "bool", "payouts_enabled": "bool", "requirements_due": ["string"] } },

  "GET /safe-zones":          { "res": ["SafeZone"] },
  "GET /handoffs/{id}":       { "res": "Handoff" },
  "POST /handoffs/{id}/suggest": { "res": { "suggestions": ["MeetupSuggestion"] } },
  "POST /handoffs/{id}/propose": { "req": { "start": "ts", "safe_zone_id": "uuid" }, "res": "Handoff" },
  "POST /handoffs/{id}/agree":   { "req": { "start": "ts", "safe_zone_id": "uuid" }, "res": "Handoff" },
  "POST /handoffs/{id}/location":{ "req": { "location": "LatLng", "accuracy_m": "int" }, "res": { "giver_nearby": "bool", "receiver_nearby": "bool" } },
  "GET /handoffs/{id}/code":     { "note": "giver only", "res": { "qr_token": "string", "short_code": "string", "expires_at": "ts" } },
  "POST /handoffs/{id}/confirm": { "headers": ["Idempotency-Key"], "req": { "qr_token": "string?", "short_code": "string?", "location": "LatLng" }, "res": "Handoff" },
  "POST /handoffs/{id}/no-show": { "res": "Handoff" },

  "POST /orders/{id}/shipment":      { "res": "Shipment" },
  "POST /shipments/{id}/dropped-off":{ "res": "Shipment" },
  "POST /shipments/{id}/received":   { "res": { "shipment": "Shipment", "order": "Order" } },

  "WishlistItem":   { "id": "uuid", "kind": "string", "isbn": "string?", "course": "Course?", "keyword": "string?", "max_price_cents": "cents?", "alert": "bool", "match_count": "int" },
  "SuggestedTrade": { "their_listing": "Listing", "my_listings": ["Listing"], "cash_delta_cents": "cents", "score": "number" }
}
```

> **Sync confirm rule (anti-scam):** the giver shows a QR (or 6-digit code) that rotates every 60 s; the receiver scans it and sends their location. The server completes the handoff only if the token is valid **and** the receiver is inside the agreed safe zone's radius. That completion is what releases money to the seller.

> **Auto-bargain rule:** the agent never goes above the buyer's max or below the seller's private floor; if those ranges overlap it proposes a price between them, otherwise `no_deal`. The result is a normal `Offer` with `auto_generated: true` that a human still taps to accept.

### Endpoints — tutoring, rides, tickets, study groups

```jsonc
{
  "GET /me/tutor-eligibility":  { "res": [{ "course": "Course", "grade": "string", "verified": "bool", "eligible": "bool", "reason": "string?" }] },
  "PUT /me/tutor-profile":      { "req": { "enabled": "bool", "course_ids": ["uuid"], "hourly_rate_cents": "cents", "bio": "string?", "modes": ["in_person|virtual"], "open_to_requests": "bool" }, "res": "TutorProfile" },
  "GET /me/tutor-availability/suggested": { "query": { "week_of": "ts" }, "res": ["TimeBlock"] },
  "PUT /me/tutor-availability": { "req": { "recurring": [{ "days": ["string"], "start": "HH:MM", "end": "HH:MM" }], "one_off": ["TimeBlock"] }, "res": "TutorProfile" },
  "GET /tutors":                { "query": { "course_id": "uuid", "from": "ts?", "to": "ts?", "max_rate_cents": "int?", "sort": "match|rating|price|grade" }, "res": [{ "tutor": "UserPublic", "profile": "TutorProfile", "grade": "string", "grade_verified": "bool", "rating": "number", "open_slots": ["TimeBlock"] }] },
  "POST /tutoring/requests":    { "req": { "course_id": "uuid", "windows": ["TimeBlock"], "max_rate_cents": "cents", "notes": "string?" }, "res": { "request_id": "uuid", "matched_tutor_count": "int" } },
  "POST /tutoring/sessions":    { "req": { "tutor_id": "uuid", "course_id": "uuid", "start": "ts", "end": "ts", "location_pref": "library_room|safe_zone|virtual" }, "res": "TutoringSession" },
  "POST /tutoring/sessions/{id}/accept":   { "res": "TutoringSession" },
  "POST /tutoring/sessions/{id}/decline":  { "res": "TutoringSession" },
  "POST /tutoring/sessions/{id}/pay":      { "res": { "client_secret": "string" } },
  "POST /tutoring/sessions/{id}/book-room":{ "res": { "status": "booked|manual_required", "room": "string?", "booking_url": "string?" } },
  "POST /tutoring/sessions/{id}/complete": { "res": "TutoringSession" },
  "POST /tutoring/sessions/{id}/cancel":   { "req": { "reason": "string" }, "res": "TutoringSession" },

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
  "TutoringSession": { "id": "uuid", "tutor": "UserPublic", "student": "UserPublic", "course": "Course", "start": "ts", "end": "ts", "price_cents": "cents", "location": { "kind": "library_room|safe_zone|virtual", "name": "string?", "meeting_url": "string?" }, "status": "requested|accepted|paid|completed|cancelled|no_show", "handoff_id": "uuid?" },
  "Ride":            { "id": "uuid", "driver": "UserPublic", "origin": "Place", "destination": "Place", "depart_at": "ts", "seats_total": "int", "seats_left": "int", "price_per_seat_cents": "cents", "riders": ["UserPublic"], "status": "open|full|en_route|completed|cancelled", "driver_location": "LatLng?" },
  "RideRequest":     { "id": "uuid", "rider": "UserPublic", "pickup": "Place", "dropoff": "Place", "depart_at": "ts", "seats": "int", "max_price_cents": "cents?", "status": "open|matched|cancelled", "ride_id": "uuid?" },
  "CourseEvent":     { "id": "uuid", "course_id": "uuid", "kind": "string", "title": "string", "due_at": "ts", "source": "syllabus|manual", "confirmations": "int" },
  "StudyGroup":      { "id": "uuid", "course": "Course", "title": "string", "host": "UserPublic", "target_event": "CourseEvent?", "mode": "string", "place": "Place?", "meeting_url": "string?", "start": "ts", "end": "ts", "capacity": "int", "members": ["UserPublic"], "cross_campus": "bool" }
}
```

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
  "POST /ingested-posts/{id}/claim":  { "note": "poster links it to their account to sell through us", "res": "Listing" }
}
```

The frontend **never talks to Stripe, Google or GroupMe directly**, except Stripe Elements / PaymentSheet (using `client_secret`) and the Stripe-hosted onboarding page.

### Realtime channels (Supabase Realtime)

Every message is `{ "event": "string", "at": "ts", "data": object }`. Channels are private and authorised by RLS.

| Channel | Events | Payload `data` |
|---|---|---|
| `user:{id}` | `notification.created`, `offer.created`, `offer.updated`, `order.updated`, `job.finished`, `wishlist.match`, `tutoring.updated` | `Notification`, `Offer`, `Offer`, `Order`, `Job`, `{ wishlist_item_id, listing }`, `TutoringSession` |
| `handoff:{id}` | `handoff.updated`, `handoff.presence`, `handoff.completed` | `Handoff`, `{ giver_nearby, receiver_nearby }`, `Handoff` |
| `ride:{id}` | `ride.location`, `ride.updated` | `{ location: LatLng }`, `Ride` |
| `auto-bargain:{id}` | `round`, `finished` | `{ by, amount_cents }`, `{ status, proposed_offer }` |

### Inbound webhooks (server only, not called by the frontend)

| Endpoint | Source | Handles |
|---|---|---|
| `POST /webhooks/stripe` | Stripe | `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, `account.updated` |
| `POST /webhooks/groupme` | GroupMe bot callback | New group messages → `ingested_posts` → AI classify into listing or ride request |
| `POST /webhooks/google-calendar` | Google push notifications | Calendar changed → refresh cached free/busy |

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
| 6 | Handoff & safety | safe_zones, handoffs, handoff_events (PostGIS) | 5 | `/handoffs`, `/safe-zones` |
| 7 | AI parsing | jobs; prompts + JSON schemas per job kind | 1, 3, Claude API | `/jobs`, used by 4, 8, 17, 20 |
| 8 | Academics | courses, class_records, transcripts, course_materials | 2, 7 | `/transcripts`, `/me/classes`, `/courses` |
| 9 | Schedule & availability | class_meetings, calendar_connections, busy_cache; slot-finder | 2, 8, Google | `/me/availability`, `/integrations/google` |
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
- Campus mail swaps the handoff steps for `label_created → dropped_off → received`; tickets swap them for `ticket-sent → ticket-received`.
- Timers (job runner): offers expire after 48 h, unpaid orders cancel after 30 min, mail orders auto-complete N days after drop-off (N is an open question).

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
| Supabase | Postgres + PostGIS, Auth, Storage, Realtime | Create project · enable `postgis` + `pg_trgm` · Auth: email OTP (6-digit code, easier than magic links in a Swift app) · auth hook or trigger that rejects non-.edu domains and sets `school_id` · Storage buckets `public-media` (listing photos) and `private-docs` (transcripts, syllabi; signed URLs only) · enable Realtime on notifications, offers, orders, handoffs · custom SMTP so OTP emails aren't rate-limited |
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
| Maps | Campus map, safe zones, distance | MapKit on iOS · Mapbox or Leaflet + OSM on web · distance checks done **server-side with PostGIS**, not in clients |
| Book metadata | ISBN → title, cover, edition | Open Library or Google Books API |
| GroupMe | Ingest Joyride + marketplace group posts | Developer token · bot with callback URL `/webhooks/groupme` · a group member has to add the bot to each group |
| Library rooms | Auto-book tutoring rooms | Depends on what UA uses; fallback is a deep link (`manual_required`) |
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
```

> **Never ship the Supabase service-role key or Stripe secret key to either client**; only the anon key and Stripe publishable key go in the app and website.

---

## Open questions

The first four change what gets built for the demo; the rest can be answered as each phase starts.

- [ ] **Time and team:** how many hours is the hackathon and how many backend people? That decides where the P0 line actually falls.
- [ ] **Demo school:** UA only, or must a second school work live?
- [ ] **Money:** Stripe test mode for the demo? What platform fee (default assumed 5%), and does buyer or seller pay it?
- [ ] **Escrow:** OK to hold buyer funds until the QR confirm, with refund on no-show? Or pay seller immediately for speed?
- [ ] **Tutoring threshold:** minimum grade to tutor (assumed A-)? Allow self-reported grades with an "unverified" badge, or transcript only?
- [ ] **Auto-bargaining:** must a human tap accept on the agent's deal (assumed yes), or can it auto-close?
- [ ] **Rides:** scheduled carpools (like Joyride), or on-demand with live driver tracking? Carpools are far simpler and lower liability.
- [ ] **Tickets:** how are UA student tickets transferred today (in-app transfer vs. physical/ID)?
- [ ] **Course materials:** is there a source for required textbooks per course (bookstore list), or crowdsource from listings?
- [ ] **Campus mail:** what's the UA mail stop format, and how many days after drop-off should a mail order auto-complete?
- [ ] **Library booking:** which system does UA use for study rooms, and does it allow automated booking?
- [ ] **GroupMe:** can we get the Joyride group admins to add our bot?
