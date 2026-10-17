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

- Private accounts, Stories, and posts made before the account was a tester don't show up.
- If the dashboard can't add a tester, check that the account is public and that it accepted the invite.
- The token expires after about 60 days. Generate a new one in the dashboard.
- If `last_error` mentions a field, the account type is probably wrong: it must be Business or Creator.
