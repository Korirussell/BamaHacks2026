import SwiftUI

struct FeedView: View {
    @Environment(AppStore.self) private var store
    @State private var chip = "All"
    @State private var showNotifications = false

    private var filtered: [Listing] {
        let all = store.listings
        let list: [Listing] = switch chip {
        case "Books": all.filter { $0.category == "textbook" }
        case "Tickets": all.filter { $0.category == "ticket" }
        case "Rides": []
        case "Instagram": all.filter { $0.isGhost }
        default: all
        }
        // Ghost listings lead the feed.
        // Fresh local posts first, then ghost listings, then everything else.
        let local = list.filter { $0.source.channel == "screenshot_local" }
        let rest = list.filter { $0.source.channel != "screenshot_local" }
        return local + rest.filter(\.isGhost) + rest.filter { !$0.isGhost }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                SearchPill()
                    .padding(.horizontal, 16)
                segmentToggle.padding(.horizontal, 16)
                if store.feedSegment == Copy.forYouTitle {
                    wishlistRow
                    forYouContent
                } else {
                    ChipRow(chips: Copy.chips, selected: $chip)
                    content
                }
            }
            .padding(.bottom, 24)
        }
        .refreshable {
            try? await Task.sleep(for: .milliseconds(Int.random(in: 300...800)))
        }
        .background(Color.hoBg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .navigationDestination(for: Listing.self) { ListingDetailView(listingId: $0.id) }
        .navigationDestination(isPresented: $showNotifications) { NotificationsView() }
    }

    private var header: some View {
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 2) {
                Text("University of Alabama")
                    .font(.system(size: 12, weight: .bold)).foregroundStyle(Color.hoSoft)
                Text(Copy.feedTitle).font(.display(30)).displayTracking(30).foregroundStyle(Color.hoInk)
            }
            Spacer()
            Button { showNotifications = true } label: {
                Image(systemName: "bell.fill")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(Color.hoInk)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Color.hoCard))
                    .overlay(Circle().strokeBorder(Color.hoInk, lineWidth: 2))
                    .background(Circle().fill(Color.hoShadow).offset(x: 3, y: 3))
                    .overlay(alignment: .topTrailing) {
                        if store.unreadCount > 0 {
                            Text("\(store.unreadCount)")
                                .font(.system(size: 11, weight: .heavy)).foregroundStyle(.white)
                                .frame(width: 20, height: 20)
                                .background(Circle().fill(Color.hoAccent))
                                .overlay(Circle().strokeBorder(Color.hoInk, lineWidth: 1.5))
                                .offset(x: 4, y: -4)
                        }
                    }
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("Notifications")
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private var segmentToggle: some View {
        @Bindable var store = store
        return HStack(spacing: 0) {
            ForEach([Copy.forYouTitle, "All"], id: \.self) { seg in
                Button {
                    Haptics.tap()
                    withAnimation(.snappy) { store.feedSegment = seg }
                } label: {
                    Text(seg).font(.system(size: 14, weight: .heavy))
                        .foregroundStyle(store.feedSegment == seg ? Color.hoBg : Color.hoInk)
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                        .background(Capsule().fill(store.feedSegment == seg ? Color.hoInk : Color.clear))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .capsuleSticker()
    }

    /// Wishlist items as sticker chips with match counts (features-v2 §5.3).
    private var wishlistRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(store.wishlist?.items ?? []) { w in
                    Text("\(w.label) · \(w.matchCount)")
                        .font(.system(size: 13, weight: .heavy)).foregroundStyle(Color.hoInkOnLight)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(Capsule().fill(Color.hoButter))
                        .overlay(Capsule().strokeBorder(Color.hoInk, lineWidth: 2))
                }
                Text("＋ Add").font(.system(size: 13, weight: .heavy)).foregroundStyle(Color.hoInk)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .overlay(Capsule().strokeBorder(Color.hoInk, style: StrokeStyle(lineWidth: 2, dash: [4, 3])))
            }
            .padding(.horizontal, 16).padding(.vertical, 4)
        }
    }

    @ViewBuilder private var forYouContent: some View {
        let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]
        if store.feedState != .loaded {
            LazyVGrid(columns: columns, spacing: 20) { ForEach(0..<4, id: \.self) { _ in GridSkeletonCard() } }
                .padding(.horizontal, 16)
        } else if store.forYouListings.isEmpty {
            EmptyState(text: "Add something to your wishlist and we'll find it.")
        } else {
            LazyVGrid(columns: columns, spacing: 20) {
                ForEach(store.forYouListings, id: \.0.id) { listing, reason in
                    NavigationLink(value: listing) { ListingCard(listing: listing, reasonText: reason) }
                        .buttonStyle(PressableStyle())
                }
            }
            .padding(.horizontal, 16)
        }
    }

    @ViewBuilder private var content: some View {
        let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]
        switch store.feedState {
        case .idle, .loading:
            LazyVGrid(columns: columns, spacing: 20) {
                ForEach(0..<6, id: \.self) { _ in GridSkeletonCard() }
            }
            .padding(.horizontal, 16)
        case .failed:
            ErrorState { Task { await store.loadFeed() } }
        case .loaded:
            if filtered.isEmpty {
                EmptyState()
            } else {
                LazyVGrid(columns: columns, spacing: 20) {
                    ForEach(filtered) { listing in
                        NavigationLink(value: listing) { ListingCard(listing: listing) }
                            .buttonStyle(PressableStyle())
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }
}

/// Cards-v3 §5: 44px, radius 12, bg img-bg, icon left, no border.
struct SearchPill: View {
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 14, weight: .semibold))
            Text(Copy.searchPlaceholder).font(.system(size: 14, weight: .medium))
            Spacer()
        }
        .foregroundStyle(Color.hoSoft)
        .padding(.horizontal, 16)
        .frame(height: 44)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.cardImgBg))
    }
}

// ListingCard now lives in Design/ListingCardV3.swift (cards-v3 §2/§6).
