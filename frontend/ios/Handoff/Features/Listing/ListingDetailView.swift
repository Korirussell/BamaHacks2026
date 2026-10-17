import SwiftUI

struct ListingDetailView: View {
    let listingId: String
    @Environment(AppStore.self) private var store
    @State private var openThread = false
    @State private var buying = false
    @State private var payDirect = false
    @State private var openBuyThread = false
    @State private var galleryIndex = 0

    var body: some View {
        if let listing = store.listing(listingId) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    gallery(listing)

                    VStack(alignment: .leading, spacing: 10) {
                        Text(listing.title).font(.system(size: 26, weight: .bold)).foregroundStyle(Color.hoInk)
                        priceBlock(listing)
                        HStack(spacing: 8) {
                            CleanChip(text: listing.conditionLabel)
                            if let loc = listing.locationLabel { CleanChip(text: loc) }
                            if listing.negotiable { CleanChip(text: "Negotiable") }
                        }
                        Text(listing.description)
                            .font(.system(size: 15)).foregroundStyle(Color.hoInk)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    sellerRow(listing)

                    if let place = listing.locationLabel.flatMap({ store.place(matchingLabel: $0) }) {
                        pickupMap(place)
                    }

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

    /// Full-bleed swipeable gallery (TabView .page) with page dots; single photo skips the pager.
    @ViewBuilder private func gallery(_ listing: Listing) -> some View {
        let assets = listing.imageAssetNames
        let showsPager = listing.localImageData == nil && assets.count > 1

        ZStack(alignment: .bottom) {
            if showsPager {
                GeometryReader { _ in
                    TabView(selection: $galleryIndex) {
                        ForEach(Array(assets.enumerated()), id: \.offset) { idx, name in
                            ListingPhoto(listing: listing, assetName: name, cornerRadius: 16, fallbackIconSize: 56)
                                .tag(idx)
                        }
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))
                }
                .aspectRatio(4.0 / 5.0, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 16))

                HStack(spacing: 5) {
                    ForEach(0..<assets.count, id: \.self) { i in
                        Circle().fill(i == galleryIndex ? Color.white : Color.white.opacity(0.5))
                            .frame(width: 5.5, height: 5.5)
                    }
                }
                .padding(.horizontal, 9).padding(.vertical, 6)
                .background(.ultraThinMaterial, in: Capsule())
                .padding(.bottom, 10)
            } else {
                ListingPhoto(listing: listing, cornerRadius: 16, fallbackIconSize: 56)
            }
        }
        .overlay(alignment: .topLeading) {
            GeometryReader { geo in
                Group {
                    if listing.isGhost, let h = listing.source.authorHandle {
                        GlassBadge(text: "From Instagram · \(h)", igDot: true)
                    } else if let tag = listing.tag {
                        GlassBadge(text: tag)
                    }
                }
                .frame(maxWidth: geo.size.width - 60, alignment: .leading)
                .padding(12)
            }
        }
        .overlay(alignment: .topTrailing) {
            HeartButton(listingId: listing.id).padding(12)
        }
    }

    private func priceBlock(_ listing: Listing) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                if let original = listing.originalPriceCents, original > listing.priceCents {
                    Text(Money.format(listing.priceCents)).foregroundStyle(Color.hoAccentText)
                    Text(Money.format(original)).strikethrough().foregroundStyle(Color.cardMeta)
                } else {
                    Text(Money.format(listing.priceCents)).foregroundStyle(Color.hoInk)
                }
            }
            .font(.system(size: 28, weight: .heavy)).monospacedDigit()

            if let fair = listing.fairPrice {
                let good = listing.priceCents <= fair.highCents
                Text("Fair price \(Money.format(fair.lowCents))–\(Money.format(fair.highCents))\(good ? " · Good deal" : "")")
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(Color.cardMeta)
            }
        }
    }

    private func pickupMap(_ place: Place) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Pick up at").font(.system(size: 11, weight: .heavy)).textCase(.uppercase).foregroundStyle(Color.hoSoft)
            MapContainer(mode: .focus, dataKey: nil, interactive: false,
                         focusPlaceId: place.id,
                         fallback: {
                             StickerMapView(places: store.places, pins: [], focusPlaceId: place.id)
                         })
                .frame(height: 160)
                .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    private func sellerRow(_ listing: Listing) -> some View {
        HStack(spacing: 12) {
            if listing.isGhost {
                Text("📸").font(.system(size: 24))
                    .frame(width: 46, height: 46)
                    .background(Circle().fill(Color.igGradient))
                VStack(alignment: .leading, spacing: 2) {
                    Text(listing.source.authorHandle ?? "").font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.hoInk)
                    Text(Copy.ghostLabel).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Color.cardMeta)
                }
            } else if let seller = listing.sellerId.flatMap({ store.users[$0] }) {
                Text(seller.avatarEmoji).font(.system(size: 26))
                    .frame(width: 46, height: 46)
                    .background(Circle().fill(Color.hoSunk))
                VStack(alignment: .leading, spacing: 3) {
                    Text(seller.displayName).font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.hoInk)
                    HStack(spacing: 6) {
                        ReliabilityBadge(reliability: seller.reliability)
                        Text("\(seller.reliability.completed) trades · \(seller.mutualFriendCount) mutuals")
                            .font(.system(size: 11.5, weight: .medium)).foregroundStyle(Color.cardMeta)
                    }
                }
            }
            Spacer()
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.hoCard))
    }

    @ViewBuilder private func ghostSection(_ listing: Listing) -> some View {
        // Original post preview, IG gradient frame
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(listing.source.authorHandle ?? "").font(.system(size: 13, weight: .semibold))
                Spacer()
                Text(listing.source.postedAgo ?? "").font(.system(size: 12, weight: .medium)).foregroundStyle(Color.cardMeta)
            }
            Text("“\(listing.source.postCaption ?? "")”")
                .font(.system(size: 17, weight: .medium))
            Text("View on Instagram ↗").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Color.hoAccentText)
        }
        .foregroundStyle(Color.hoInk)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.hoCard))

        Text("🔥 \(listing.interest?.count ?? 0) people want this")
            .font(.system(size: 19, weight: .bold)).foregroundStyle(Color.hoInk)

        BidBubbles(bids: store.bids[listing.id] ?? [], users: store.users)

        Text(Copy.ghostFineprint)
            .font(.system(size: 12, weight: .medium)).foregroundStyle(Color.cardMeta)
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
                    Text(Copy.buyNote).font(.system(size: 12, weight: .medium)).foregroundStyle(Color.cardMeta)
                }
            } else if listing.sellerId == store.me?.userId {
                if listing.id == "l_mouse", store.buyRequest != nil, !store.requestAccepted {
                    Button("Maya wants it · View request") { store.rootSheet = .request }
                        .buttonStyle(.pill(.butter, full: true))
                } else {
                    Text("This is your listing · \(store.requestAccepted ? "sold to Maya" : "live on the feed")")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(Color.cardMeta)
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                }
            } else {
                if listing.negotiable {
                    Button("Make offer") { openThread = true }
                        .buttonStyle(.pill(.outline, full: true))
                }
                Button("Buy now") { buying = true }
                    .buttonStyle(.pill(.primary, full: true))
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(Color.hoBg.overlay(alignment: .top) { Rectangle().fill(Color.cardDivider).frame(height: 1) })
    }
}
