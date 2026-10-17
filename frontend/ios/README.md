# Handoff — iOS (SwiftUI)

Self-contained. Nothing in this folder imports or calls `/backend`, `/supabase` or `/frontend/web`.

## Run
```bash
cd frontend/ios
xcodegen generate          # Handoff.xcodeproj is generated from project.yml
open Handoff.xcodeproj     # iOS 17+, run on any iPhone simulator
```

## Demo path
Feed → Mini fridge → **Make offer** → Send $55 → Send $62 → "Kayla accepted $65 ✓" → **Pay $65** → Pay → **Touchdown!** → Done →
3 handoff spots → **Lock in 3:30 →** → **It's good!** → Go to handoff → Seller (QR) / Buyer → **Pretend I'm at the spot** → **Touchdown!** → review.

Also: ghost bike → **I want this · $200** (count 3 → 4), + tab → Screenshot → listing (long-press the card for the failure state), Activity, Profile theme picker, Notifications (bell), Explore.

## Notes
- Mock mode only (`Config.useMocks = true`). JSON in `Handoff/Mocks` is copied verbatim from frontend-build.md §5, 300–800 ms fake delay.
- Display font is SF Rounded (Fredoka not bundled, per §3.2 fallback).
- Celebrations are Katelyn's idea — see `Features/Celebration/CelebrationView.swift`.
- Local-only fields: `Listing.localImageData` and `source.channel = "screenshot_local"` for posts made in the Sell flow.
