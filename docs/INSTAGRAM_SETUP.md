# Instagram setup (demo)

The API watches posts that tag our Instagram account and lists the textbook automatically. This follows Instagram's rules: no scraping, no cold DMs. We read only posts that tag us, and we reply in public on the post.

## Accounts

- **Platform account** (e.g. `@bamamarket`): a Business or Creator account. Switch it in the Instagram app under Settings → Account type and tools. It must be **public**.
- **Seller account** (e.g. `@bama_books`): a teammate's **public** account that posts the textbook.

## Meta app (one time)

1. On https://developers.facebook.com/apps, create an app and pick the use case **"Manage messaging & content on Instagram"** (this is the Instagram API with Instagram Login).
2. Under **App roles → Roles**, add both accounts as **Instagram testers**. While the app is in development mode, only accounts with a role on the app show up in the API. Each account then accepts the invite in Instagram → Settings → Website permissions → Apps and websites → Tester invites.
3. Under **Instagram → API setup with Instagram login**:
   - Add the platform account.
   - Grant `instagram_business_basic` and `instagram_business_manage_comments`.
   - Click **Generate token**. This gives a long-lived token, valid for about 60 days.
4. In `backend/.env`, set:
   ```
   INSTAGRAM=graph
   INSTAGRAM_ACCESS_TOKEN=<the token>
   ANTHROPIC_API_KEY=<key>      # so the photo is read by Claude vision
   ```
   Restart `pnpm dev`. On startup the log should show `instagram: graph`, and `GET /api/v1/admin/instagram/status` should show `account`.

## The post (what the seller does on stage)

- Post a photo of the book.
- **Photo-tag** `@bamamarket`. This is how the poller finds the post.
- **@mention** `@bamamarket` in the caption, e.g. "Selling my chem book @bamamarket $60". The mention is what lets us reply: Instagram doesn't allow replies on photo tags alone.

Within about 15 s (`INSTAGRAM_POLL_SECONDS`, or `POST /admin/instagram/poll`):

1. The post shows up in `GET /admin/ingestion/feed`.
2. The listing goes live, and CH 101/102 students get a notification.
3. We reply on the post.

The first offer adds a second reply with the claim link.

## Fallbacks

- `POST /admin/ingested-posts` feeds a post in by hand. It runs the same pipeline and shows up in the same feed.
- `INSTAGRAM_AUTO_REPLY=off` keeps us from commenting. The invite then waits in `GET /admin/seller-invites` for someone to send it by hand.
- `INSTAGRAM=off` turns all of this off.

## Gotchas

- Private accounts, Stories (in tag mode; see stories mode below), and posts made before the account was a tester don't show up.
- If the dashboard can't add a tester, check that the account is public and that it accepted the invite.
- The token expires after about 60 days. Generate a new one in the dashboard.
- If `last_error` mentions a field, the account type is probably wrong: it must be Business or Creator.

## Stories + DMs mode (`INSTAGRAM=stories`)

This mode needs no tag and no mention. The seller account posts a **story** with the textbook photo, and our account DMs the seller.

- **Platform account** `@bamahacks` (`INSTAGRAM_ACCESS_TOKEN`) reads its DM conversations and sends the DMs.
- **Seller account** `@bamahacks2` (`INSTAGRAM_SELLER_TOKEN`) reads its **own** stories: `GET /{seller-ig-id}/stories`. An account reading its own content is allowed.

Meta lets a business message someone only within **24 hours of that person's last message to it**. So a human opens the window by DMing `@bamahacks` from `@bamahacks2` before the demo. The server never sends anything to keep the window open. When the window is closed, it refuses to send: the admin endpoints return `409`, and the feed shows a `dm_window_closed` event that says "Ask @bamahacks2 to DM us first".

### Setup

1. Both accounts are Business or Creator accounts, and both are **Instagram testers** on the Meta app (see "Meta app" above).
2. Under **Instagram → API setup with Instagram login**, add both accounts and generate a token for each one:
   - `bamahacks` needs `instagram_business_basic` and `instagram_business_manage_messages`. Tag mode also needs `instagram_business_manage_comments`.
   - `bamahacks2` needs `instagram_business_basic`.
3. In `backend/.env`, set:
   ```
   INSTAGRAM=stories
   INSTAGRAM_ACCESS_TOKEN=<bamahacks token>
   INSTAGRAM_SELLER_TOKEN=<bamahacks2 token>
   INSTAGRAM_SELLER_USERNAME=bamahacks2   # optional; looked up from the seller token
   INSTAGRAM_SELLER_IGSID=                # optional; found from our conversations
   INSTAGRAM_AUTO_REPLY=on                # on = DM automatically (only while the window is open)
   ANTHROPIC_API_KEY=<key>                # story text is baked into the image, so Claude vision reads it
   ```
   Restart `pnpm dev`. The log should show `instagram: stories`.

### How the window is read

There's no public webhook, so the server reads the window from the Conversations API with our token:

1. `GET /{our-ig-id}/conversations?platform=instagram`. Once we know the seller's IGSID, it adds `&user_id=<IGSID>`.
2. `GET /{conversation-id}?fields=messages` lists the latest messages.
3. `GET /{message-id}?fields=id,created_time,from,to` tells us who sent each one. Instagram only gives details for the 20 most recent.

The window is open if the seller's newest message to us is under 24 h old. Our own messages don't count. The seller's IGSID comes from the `from`/`to` of the messages in their conversation, matched on username, and is cached. DMs go to `POST /{our-ig-id}/messages` with `{"recipient":{"id":"<IGSID>"},"message":{"text":"..."}}`.

### Demo script

1. **Before the demo (a person, under 24 h before):** from `@bamahacks2`, DM `@bamahacks` anything, e.g. "hi".
2. `POST /api/v1/admin/instagram/dm-window/refresh` should show `open: true`, a `seller_igsid`, and `expires_at`. The same data is in `GET /admin/instagram/status` under `dm_window`.
3. **On stage:** `@bamahacks2` posts a story with a photo of the book and the price written on it.
4. Within about 15 s (or call `POST /admin/instagram/poll`), the story shows up in `GET /admin/ingestion/feed`. The listing goes live, students get notified, and `@bamahacks2` gets a "We listed your …" DM.
5. A student makes an offer. `@bamahacks2` gets a DM with the claim link.
6. Manual controls:
   - `POST /admin/instagram/dm` `{ "text": "..." }` sends a DM now.
   - `POST /admin/instagram/dm/listed` `{ "ingested_post_id": "..." }` re-sends the "listed" DM.
   - Both return `409` if the window is closed.

### Unverified until tested with a real token

- **Story `media_url` for the account's own token.** Meta documents `/{ig-user-id}/stories` on the Facebook-login API. Whether `graph.instagram.com` returns `media_url` and `permalink` for the account's own stories is unverified. Without a permalink, we dedupe on `https://www.instagram.com/stories/<username>/<story-id>/`.
- **The conversations response shape.** This includes whether `messages` come newest first (we sort them anyway), whether `created_time` is ISO or unix (we accept both), and whether our own account appears as its IG user id in `from`/`to` (we also match on username).
- **The exact window-closed error code.** The docs don't name one. We treat Graph codes `10` and `551` as "window closed" (the Messenger Platform's codes). We also check the window ourselves before every send, so this only matters if our check and Meta's disagree.
- **Stories expire after 24 h.** Photos are copied to our bucket as soon as the story is seen, so the listing keeps its photo.
