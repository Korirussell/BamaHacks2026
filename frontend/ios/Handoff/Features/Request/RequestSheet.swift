import SwiftUI

/// Flow A step 6: "Maya wants your mouse" → ✓ Accept / Decline.
struct RequestSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let req = store.buyRequest
        let buyer = req.flatMap { store.users[$0.buyerId] }
        let listing = req.flatMap { store.listing($0.listingId) }
        VStack(alignment: .leading, spacing: 16) {
            SheetTitle(kicker: "New request", title: Copy.reqTitle)

            HStack(spacing: 12) {
                Text(buyer?.avatarEmoji ?? "👩🏽").font(.system(size: 30))
                    .frame(width: 50, height: 50)
                    .background(Circle().fill(Color.hoSunk))
                    .overlay(Circle().strokeBorder(Color.hoInk, lineWidth: 2))
                VStack(alignment: .leading, spacing: 4) {
                    Text(buyer?.displayName ?? "Maya T.").font(.system(size: 17, weight: .heavy)).foregroundStyle(Color.hoInk)
                    if let r = buyer?.reliability {
                        HStack(spacing: 6) {
                            ReliabilityBadge(reliability: r)
                            Text("\(r.completed) trades · \(String(format: "%.1f", r.score))★").lineLimit(1).fixedSize()
                                .font(.system(size: 12, weight: .bold)).foregroundStyle(Color.hoSoft)
                        }
                    }
                }
                Spacer()
                Text(Money.format(req?.amountCents ?? 2500)).font(.display(24)).foregroundStyle(Color.hoInk)
            }
            .padding(14)
            .sticker(radius: 18, shadow: 3)

            if let req {
                BubbleView(side: .them, text: req.message, tag: buyer?.displayName, footer: req.createdAgo)
            }

            HStack(spacing: 10) {
                if let listing {
                    ItemTile(listing: listing, emojiSize: 22).frame(width: 40, height: 40).sticker(radius: 10, shadow: 2)
                    Text(listing.title).font(.system(size: 13, weight: .bold)).foregroundStyle(Color.hoInk).lineLimit(1)
                }
                Spacer()
            }

            Text("🔒 " + Copy.reqMoney)
                .font(.system(size: 14, weight: .heavy)).foregroundStyle(Color.hoInkOnLight)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .capsuleSticker(fill: .hoMint)

            HStack(spacing: 12) {
                Button(Copy.reqDecline) {
                    store.show(toast: "Declined. We'll let Maya know.")
                    dismiss()
                }
                .buttonStyle(.pill(.neutral, full: true))
                Button(Copy.reqAccept) { store.acceptRequest() }
                    .buttonStyle(.pill(.primary, full: true))
            }
        }
        .padding(20)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Color.hoBg.ignoresSafeArea())
        .presentationDetents([.large, .medium])
        .presentationCornerRadius(28)
        .presentationDragIndicator(.visible)
    }
}
