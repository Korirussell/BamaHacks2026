# Handoff — iOS (SwiftUI)

Self-contained. Nothing in this folder imports or calls `/backend`, `/supabase` or `/frontend/web`.

## Run
```bash
cd frontend/ios
xcodegen generate          # Handoff.xcodeproj is generated from project.yml
open Handoff.xcodeproj     # iOS 17+, run on any iPhone simulator
```

## Demo paths (features-v2)
**Flow A (seller, main):** + → **Snap it** (or "Use the sample mouse") → 4-step AI job → prefilled card, Sell fast $25 / Max $32 → **Post it** →
~4 s later banner "Maya wants your mouse · $25" (also in the bell / on the listing) → **✓ Accept** → 3 spots → **Lock in** → "Waiting for Maya…" →
**It's good!** → "📅 Added to your calendar and Maya's" (EventKit) → Go to handoff (seller QR) → "Maya scanned it ✓" → **Touchdown!** → review.

**Flow B (buyer):** Feed **For you** → Owala FreeSip $15 → **Buy · $15** → Pay → chat with Zoe → pick **Ridgecrest Lockers** → Zoe confirms →
**It's good!** → calendar chip → ~4 s later "Zoe dropped it in Locker 14" + banner → locker card (code 4821) → **I picked it up** → **Touchdown!** → review.

Profile → **Handoff history** (history.json + anything completed this session).

## Original demo path (haggle)
Feed → Mini fridge → **Make offer** → Send $55 → Send $62 → "Kayla accepted $65 ✓" → **Pay $65** → Pay → **Touchdown!** → Done →
3 handoff spots → **Lock in 3:30 →** → **It's good!** → Go to handoff → Seller (QR) / Buyer → **Pretend I'm at the spot** → **Touchdown!** → review.

Also: ghost bike → **I want this · $200** (count 3 → 4), + tab → Screenshot → listing (long-press the card for the failure state), Activity, Profile theme picker, Notifications (bell), Explore.

## Notes
- Mock mode only (`Config.useMocks = true`). JSON in `Handoff/Mocks` is copied verbatim from frontend-build.md §5, 300–800 ms fake delay.
- Display font is SF Rounded (Fredoka not bundled, per §3.2 fallback).
- Celebrations are Katelyn's idea — see `Features/Celebration/CelebrationView.swift`.
- campus3d.md is web-only (Three.js) — not built on iOS.
- Local-only fields: `Listing.localImageData` and `source.channel = "screenshot_local"` for posts made in the Sell flow.
