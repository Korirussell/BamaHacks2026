import SwiftUI

struct ActivityView: View {
    @Environment(AppStore.self) private var store
    @State private var tab = "Buying"
    @State private var showHandoff = false
    @State private var openListing: Listing?

    private var mySelling: [Listing] { store.listings.filter { $0.sellerId == store.me?.userId } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Activity").font(.display(30)).displayTracking(30).foregroundStyle(Color.hoInk)
                    .padding(.top, 8)
                ChipRow(chips: ["Buying", "Selling"], selected: $tab).padding(.horizontal, -16)

                if tab == "Buying" {
                    if let order = store.order, let listing = store.listing(order.listingId) {
                        orderRow(order, listing)
                    }
                    ForEach(store.listings.filter { store.myInterests.contains($0.id) }) { l in
                        row(l, status: "Interested", fill: .hoButter,
                            detail: "We DM'd \(l.source.authorHandle ?? "the seller") · \(l.interest?.count ?? 0) want it")
                    }
                    if store.order == nil && store.myInterests.isEmpty {
                        EmptyState(text: "No deals yet. Make an offer on something in the feed.")
                    }
                } else {
                    if mySelling.isEmpty {
                        EmptyState(text: "Nothing listed yet. Tap + to sell something.")
                    }
                    ForEach(mySelling) { l in
                        row(l, status: "Live", fill: .hoMint, detail: "Posted just now · \(Money.format(l.priceCents))")
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .background(Color.hoBg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .fullScreenCover(isPresented: $showHandoff) { HandoffView() }
    }

    private func orderRow(_ order: Order, _ listing: Listing) -> some View {
        let status: (String, Color) = switch order.status {
        case "completed": ("Completed", .hoMint)
        case "scheduled": ("Scheduled", .hoButter)
        default: ("Paid", .hoMint)
        }
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                ItemTile(listing: listing, emojiSize: 28).frame(width: 52, height: 52).sticker(radius: 12, shadow: 2)
                VStack(alignment: .leading, spacing: 3) {
                    Text(listing.title).font(.display(16)).foregroundStyle(Color.hoInk)
                    Text("\(Money.exact(order.totalCents)) · held until handoff 🔒")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.hoSoft)
                }
                Spacer()
                statusChip(status.0, status.1)
            }
            if let m = store.lockedMeetup, order.status == "scheduled" {
                Text("Meet Kayla · \(store.place(m.placeId)?.name ?? "") · \(m.startLabel)")
                    .font(.system(size: 14, weight: .heavy)).foregroundStyle(Color.hoInk)
                HStack(spacing: 10) {
                    Button("Show QR") { showHandoff = true }.buttonStyle(.pill(.neutral, small: true, full: true))
                    Button("Scan") { showHandoff = true }.buttonStyle(.pill(.primary, small: true, full: true))
                }
            } else if order.status == "completed" {
                Text("Clean handoff. $\(order.amountCents / 100) released to Kayla.")
                    .font(.system(size: 13, weight: .bold)).foregroundStyle(Color.hoSoft)
            }
        }
        .padding(14)
        .sticker(radius: 18, shadow: 3)
    }

    private func row(_ l: Listing, status: String, fill: Color, detail: String) -> some View {
        HStack(spacing: 12) {
            ItemTile(listing: l, emojiSize: 28).frame(width: 52, height: 52).sticker(radius: 12, shadow: 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(l.title).font(.display(16)).foregroundStyle(Color.hoInk).lineLimit(1)
                Text(detail).font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.hoSoft).lineLimit(1)
            }
            Spacer()
            statusChip(status, fill)
        }
        .padding(14)
        .sticker(radius: 18, shadow: 3)
    }

    private func statusChip(_ text: String, _ fill: Color) -> some View {
        Text(text)
            .font(.system(size: 10.5, weight: .heavy)).textCase(.uppercase)
            .foregroundStyle(Color.hoInkOnLight)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(Capsule().fill(fill))
            .overlay(Capsule().strokeBorder(Color.hoInk, lineWidth: 1.5))
    }
}
