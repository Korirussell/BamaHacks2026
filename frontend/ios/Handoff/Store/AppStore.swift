import SwiftUI
import Observation

enum LoadState: Equatable { case idle, loading, loaded, failed }

enum Celebration: Identifiable, Equatable {
    case touchdown(line: String)
    case fieldGoal(line: String)
    var id: String {
        switch self {
        case .touchdown(let l): return "td-\(l)"
        case .fieldGoal(let l): return "fg-\(l)"
        }
    }
}

@Observable
final class AppStore {
    let api: APIClient = Config.useMocks ? MockAPI() : LiveAPI()

    var theme: ThemeChoice = .system
    var listings: [Listing] = []
    var feedState: LoadState = .idle
    var users: [String: UserPublic] = [:]
    var me: MeRecord?
    var bids: [String: [Bid]] = [:]
    var myInterests: Set<String> = []
    var places: [Place] = []
    var meetups: [MeetupSuggestion] = []
    var notifications: [AppNotification] = []
    var order: Order?
    var lockedMeetup: MeetupSuggestion?
    var toast: String?
    var selectedTab: Tab = .feed
    var showSell = false
    var tabBarHiders: Set<String> = []

    enum Tab: Hashable { case feed, explore, sell, activity, profile }

    var unreadCount: Int { notifications.filter { !$0.read }.count }
    var meUser: UserPublic? { me.flatMap { users[$0.userId] } }

    func bootstrap() async {
        async let u = try? api.users()
        async let m = try? api.me()
        async let p = try? api.places()
        if let list = await u { users = Dictionary(uniqueKeysWithValues: list.map { ($0.id, $0) }) }
        me = await m
        places = await p ?? []
        // order.json is the awaiting_payment template; a live order only exists after Pay (startOrder).
        notifications = (try? await api.notifications()) ?? []
        await loadFeed()
    }

    func loadFeed() async {
        if listings.isEmpty { feedState = .loading }
        do {
            let fresh = try await api.feed()
            // Keep anything posted locally from the Sell flow on top.
            let local = listings.filter { $0.source.channel == "screenshot_local" }
            if listings.isEmpty || feedState != .loaded {
                listings = local + fresh
            }
            feedState = .loaded
        } catch {
            feedState = .failed
        }
    }

    func listing(_ id: String) -> Listing? { listings.first { $0.id == id } }

    func loadBids(_ listingId: String) async {
        if bids[listingId] != nil { return }
        bids[listingId] = (try? await api.bids(listingId: listingId)) ?? []
    }

    func wantThis(_ listingId: String) {
        guard let i = listings.firstIndex(where: { $0.id == listingId }), !myInterests.contains(listingId) else { return }
        myInterests.insert(listingId)
        listings[i].interest = Listing.Interest(count: (listings[i].interest?.count ?? 0) + 1,
                                                topAmountCents: listings[i].interest?.topAmountCents)
        let mine = Bid(id: "b_me", listingId: listingId, userId: me?.userId ?? "u_kori",
                       amountCents: listings[i].priceCents, message: "I want this", reactions: .init(fire: 0, eyes: 0))
        bids[listingId, default: []].append(mine)
        show(toast: Copy.ghostToast)
        Haptics.success()
    }

    func show(toast text: String) {
        withAnimation(.spring(duration: 0.35)) { toast = text }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2.8))
            if toast == text { withAnimation(.easeOut) { toast = nil } }
        }
    }

    var agreedCents: Int?

    func agree(_ cents: Int) { agreedCents = cents }

    func startOrder(listing: Listing?, amountCents: Int) {
        let fee = Int((Double(amountCents) * 0.05).rounded())
        order = Order(id: "o_\(listing?.id.dropFirst(2) ?? "fridge")", listingId: listing?.id ?? "l_fridge",
                      amountCents: amountCents, feeCents: fee, totalCents: amountCents + fee, status: "paid")
        lockedMeetup = nil
    }

    func lock(_ meetup: MeetupSuggestion) {
        lockedMeetup = meetup
        order?.status = "scheduled"
    }

    func completeHandoff() { order?.status = "completed" }

    func publish(_ listing: Listing) {
        withAnimation(.spring) { listings.insert(listing, at: 0) }
        selectedTab = .feed
        show(toast: "Live on the feed")
    }

    func place(_ id: String) -> Place? { places.first { $0.id == id } }

    func markNotificationsRead() {
        for i in notifications.indices { notifications[i].read = true }
    }
}
