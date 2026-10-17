import SwiftUI

struct ListingDetailView: View {
    let listingId: String
    @Environment(AppStore.self) private var store
    @State private var openThread = false
    @State private var buying = false
    @State private var payDirect = false
    @State private var openBuyThread = false

    var body: some View {
        if let listing = store.listing(listingId) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ItemTile(listing: listing, emojiSize: 120)
                        .frame(height: 260)
                        .frame(maxWidth: .infinity)
                        .sticker(radius: 24, shadow: 5,
                                 shadowColor: listing.isGhost ? .igPink : .hoShadow,
                                 dashed: listing.isGhost)
                        .overlay(alignment: .topLeading) {
                            if listing.isGhost, let h = listing.source.authorHandle {
                                GhostBadge(handle: h).padding(12)
                            } else if let tag = listing.tag {
                                TagPill(text: tag).padding(12)
                            }
                        }

                    VStack(alignment: .leading, spacing: 10) {
                        Text(listing.title).font(.display(30)).displayTracking(30).foregroundStyle(Color.hoInk)
                        PriceTag(listing: listing)
                        HStack(spacing: 8) {
                            TagPill(text: listing.conditionLabel)
                            if let loc = listing.locationLabel { TagPill(text: "📍 \(loc)") }
                            if listing.negotiable { TagPill(text: "Negotiable") }
                        }
                        Text(listing.description)
                            .font(.system(size: 15)).foregroundStyle(Color.hoInk)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    sellerRow(listing)

                    if listing.isGhost { ghostSection(listing) }
                }
                .padding(.horizontal, 18)
                .padding(.top, 8)
                .padding(.bottom, 120)
            }
            .background(Color.hoBg.ignoresSafeArea())
            .hidesTabBar()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .toolbarBackground(Color.hoBg, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .safeAreaInset(edge: .bottom) { actionBar(listing) }
            .navigationDestination(isPresented: $openThread) { HaggleThreadView(listingId: listing.id) }
            .navigationDestination(isPresented: $openBuyThread) { BuyThreadView(listingId: listing.id) }
            .sheet(isPresented: $payDirect) {
                // features-v2 Flow B: Buy at the listed price → money held → straight into the chat.
                PaySheet(amountCents: listing.priceCents) {
                    payDirect = false
                    store.show(toast: "\(Money.format(listing.priceCents)) held 🔒")
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(450))
                        openBuyThread = true
                    }
                }
            }
            .dealFlow(isPaying: $buying, amountCents: listing.priceCents, listing: listing)
            .task { if listing.isGhost { await store.loadBids(listing.id) } }
        } else {
            EmptyState(text: "That listing's gone.")
        }
    }

    private func sellerRow(_ listing: Listing) -> some View {
        HStack(spacing: 12) {
            if listing.isGhost {
                Text("📸").font(.system(size: 24))
                    .frame(width: 46, height: 46)
                    .background(Circle().fill(Color.igGradient))
                    .overlay(Circle().strokeBorder(Color.hoInk, lineWidth: 2))
                VStack(alignment: .leading, spacing: 2) {
                    Text(listing.source.authorHandle ?? "").font(.system(size: 15, weight: .heavy)).foregroundStyle(Color.hoInk)
                    Text(Copy.ghostLabel).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Color.hoSoft)
                }
            } else if let seller = listing.sellerId.flatMap({ store.users[$0] }) {
                Text(seller.avatarEmoji).font(.system(size: 26))
                    .frame(width: 46, height: 46)
                    .background(Circle().fill(Color.hoSunk))
                    .overlay(Circle().strokeBorder(Color.hoInk, lineWidth: 2))
                VStack(alignment: .leading, spacing: 3) {
                    Text(seller.displayName).font(.system(size: 15, weight: .heavy)).foregroundStyle(Color.hoInk)
                    HStack(spacing: 6) {
                        ReliabilityBadge(reliability: seller.reliability)
                        Text("\(seller.reliability.completed) trades · \(seller.mutualFriendCount) mutuals")
                            .font(.system(size: 11.5, weight: .semibold)).foregroundStyle(Color.hoSoft)
                    }
                }
            }
            Spacer()
        }
        .padding(12)
        .sticker(radius: 18, shadow: 3)
    }

    @ViewBuilder private func ghostSection(_ listing: Listing) -> some View {
        // Original post preview, IG gradient frame
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(listing.source.authorHandle ?? "").font(.system(size: 13, weight: .heavy))
                Spacer()
                Text(listing.source.postedAgo ?? "").font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.hoSoft)
            }
            Text("“\(listing.source.postCaption ?? "")”")
                .font(.display(17, weight: .semibold))
            Text("View on Instagram ↗").font(.system(size: 12.5, weight: .heavy)).foregroundStyle(Color.hoAccentText)
        }
        .foregroundStyle(Color.hoInk)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 18).fill(Color.hoCard))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.igGradient, lineWidth: 3))

        Text("🔥 \(listing.interest?.count ?? 0) people want this")
            .font(.display(19)).foregroundStyle(Color.hoInk)

        BidBubbles(bids: store.bids[listing.id] ?? [], users: store.users)

        Text(Copy.ghostFineprint)
            .font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.hoSoft)
    }

    @ViewBuilder private func actionBar(_ listing: Listing) -> some View {
        HStack(spacing: 12) {
            if listing.isGhost {
                let wanted = store.myInterests.contains(listing.id)
                Button(wanted ? "You're in · we'll DM them ✓" : Copy.ghostCta) {
                    store.wantThis(listing.id)
                }
                .buttonStyle(.pill(.butter, full: true))
                .disabled(wanted)
            } else if listing.id == "l_owala" {
                VStack(spacing: 8) {
                    Button(Copy.buyCta) { payDirect = true }
                        .buttonStyle(.pill(.primary, full: true))
                    Text(Copy.buyNote).font(.system(size: 12, weight: .bold)).foregroundStyle(Color.hoSoft)
                }
            } else if listing.sellerId == store.me?.userId {
                if listing.id == "l_mouse", store.buyRequest != nil, !store.requestAccepted {
                    Button("Maya wants it · View request") { store.rootSheet = .request }
                        .buttonStyle(.pill(.butter, full: true))
                } else {
                    Text("This is your listing · \(store.requestAccepted ? "sold to Maya" : "live on the feed")")
                        .font(.system(size: 14, weight: .heavy)).foregroundStyle(Color.hoSoft)
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                }
            } else {
                if listing.negotiable {
                    Button("Make offer") { openThread = true }
                        .buttonStyle(.pill(.neutral, full: true))
                }
                Button("Buy now") { buying = true }
                    .buttonStyle(.pill(.primary, full: true))
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(Color.hoBg.overlay(alignment: .top) { Rectangle().fill(Color.hoInk).frame(height: 2) })
    }
}
