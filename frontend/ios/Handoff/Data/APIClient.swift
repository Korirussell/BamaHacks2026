import Foundation

enum Config {
    static let useMocks = false
    static let demoEmail = "bamahacks.student@crimson.ua.edu"
    /// Local-only switch: Simulator talks directly to this Mac; physical devices retain the committed ngrok URL.
    #if targetEnvironment(simulator)
    static let apiBaseURL = URL(string: "http://localhost:8787/api/v1")!
    #else
    static let apiBaseURL = URL(string: "https://sled-maker-outshoot.ngrok-free.dev/api/v1")!
    #endif
    /// web/app/embed/campus (map-plan.md §4). Physical-device demo URL (Vercel); swap back to
    /// "http://localhost:3000" for the Simulator.
    static let mapBaseURL = URL(string: "https://web-navy-tau-cbiw53nkby.vercel.app")!
}

protocol APIClient {
    func feed() async throws -> [Listing]
    func users() async throws -> [UserPublic]
    func me() async throws -> MeRecord
    func bids(listingId: String) async throws -> [Bid]
    func thread(id: String) async throws -> OfferThread
    func order(id: String) async throws -> Order
    func places() async throws -> [Place]
    func meetups(orderId: String) async throws -> [MeetupSuggestion]
    func notifications() async throws -> [AppNotification]
    func screenshotJob() async throws -> ScreenshotResult
    /// features-v2 fixtures by file name (photo_result, buy_request, meetups_maya, …).
    func fixture<T: Decodable>(_ name: String) async throws -> T
}

enum APIError: Error { case missingMock(String), notImplemented, invalidResponse, server(String) }

/// Loads the bundled JSON from frontend-build.md §5 with a 300–800 ms fake delay.
struct MockAPI: APIClient {
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    private func load<T: Decodable>(_ name: String, delay: Bool = true) async throws -> T {
        if delay { try await Task.sleep(for: .milliseconds(Int.random(in: 300...800))) }
        guard let url = Bundle.main.url(forResource: name, withExtension: "json") else {
            throw APIError.missingMock(name)
        }
        return try decoder.decode(T.self, from: Data(contentsOf: url))
    }

    func feed() async throws -> [Listing] { try await load("listings") }
    func users() async throws -> [UserPublic] { try await load("users", delay: false) }
    func me() async throws -> MeRecord { try await load("me", delay: false) }
    func bids(listingId: String) async throws -> [Bid] {
        let all: [Bid] = try await load("bids")
        return all.filter { $0.listingId == listingId }
    }
    func thread(id: String) async throws -> OfferThread { try await load("thread", delay: false) }
    func order(id: String) async throws -> Order { try await load("order", delay: false) }
    func places() async throws -> [Place] { try await load("places", delay: false) }
    func meetups(orderId: String) async throws -> [MeetupSuggestion] { try await load("meetups") }
    func notifications() async throws -> [AppNotification] { try await load("notifications") }
    func screenshotJob() async throws -> ScreenshotResult { try await load("screenshot_result", delay: false) }
    func fixture<T: Decodable>(_ name: String) async throws -> T { try await load(name, delay: false) }
}

/// The marketplace demo path is live; visual-only flows continue to use their bundled fixtures.
final class LiveAPI: APIClient {
    private let mocks = MockAPI()
    private var token: String?
    private let decoder: JSONDecoder = { let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase; return decoder }()

    private struct Envelope<T: Decodable>: Decodable { let data: T }
    private struct ErrorEnvelope: Decodable { struct Detail: Decodable { let code: String; let message: String }; let error: Detail }
    private struct Session: Decodable { let accessToken: String; let refreshToken: String; let expiresAt: Int; let userId: String }
    private struct RemoteUser: Decodable { let id: String; let displayName: String; let major: String?; let gradYear: Int?; let reliability: Reliability; let school: RemoteSchool }
    private struct RemoteSchool: Decodable { let id: String }
    private struct RemoteMedia: Decodable { let url: String }
    private struct RemoteSource: Decodable { let channel: String; let claimed: Bool }
    private struct RemoteListing: Decodable {
        let id: String; let title: String; let description: String; let category: String; let priceCents: Int; let negotiable: Bool; let condition: String
        let media: [RemoteMedia]; let status: String; let seller: RemoteUser?; let source: RemoteSource; let createdAt: String
    }
    private struct FeedItem: Decodable { let type: String; let item: RemoteListing; let reason: String? }
    private struct RemoteMe: Decodable { let user: RemoteUser; let email: String; let budgetCents: Int? }
    private struct RemoteOffer: Decodable { let id: String; let listingId: String; let buyer: RemoteUser; let amountCents: Int; let message: String? }
    private struct RemoteOrder: Decodable { let id: String; let listing: RemoteListing; let amountCents: Int; let feeCents: Int; let status: String }
    private struct RemoteNotification: Decodable { let id: String; let title: String; let body: String; let deepLink: String; let readAt: String?; let createdAt: String }

    private func session() async throws -> String {
        if let token { return token }
        var request = URLRequest(url: Config.apiBaseURL.appending(path: "demo/login"))
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["email": Config.demoEmail])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { throw try apiError(data) }
        let minted = try decoder.decode(Envelope<Session>.self, from: data).data
        token = minted.accessToken
        return minted.accessToken
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        var request = URLRequest(url: Config.apiBaseURL.appending(path: path))
        request.setValue("Bearer \(try await session())", forHTTPHeaderField: "Authorization")
        request.setValue("1", forHTTPHeaderField: "ngrok-skip-browser-warning")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { throw try apiError(data) }
        return try decoder.decode(Envelope<T>.self, from: data).data
    }

    private func apiError(_ data: Data) throws -> APIError {
        let detail = try? decoder.decode(ErrorEnvelope.self, from: data).error
        return .server(detail.map { "\($0.code): \($0.message)" } ?? "Request failed")
    }
    private func listing(_ remote: RemoteListing, reason: String? = nil) -> Listing {
        let category = ["textbook", "lab_supplies", "dorm", "ticket"].contains(remote.category) ? remote.category : "other"
        let emoji = remote.category == "textbook" ? "📚" : remote.category == "ticket" ? "🎟️" : remote.category == "lab_supplies" ? "🧪" : "📦"
        let tile = remote.category == "ticket" ? "butter" : remote.category == "textbook" ? "mint" : "peach"
        return Listing(id: remote.id, title: remote.title, description: remote.description, category: category, priceCents: remote.priceCents, negotiable: remote.negotiable, condition: remote.condition, emoji: emoji, tile: tile, tag: nil, locationLabel: nil, status: remote.status, sellerId: remote.seller?.id, source: .init(channel: remote.source.channel, authorHandle: nil, postCaption: nil, postUrl: nil, postedAgo: nil, claimed: remote.source.claimed), fairPrice: nil, interest: nil, reason: reason, createdAt: remote.createdAt, images: remote.media.map(\.url))
    }

    func feed() async throws -> [Listing] {
        let items: [FeedItem] = try await get("feed")
        return items.filter { $0.type == "listing" }.map { listing($0.item, reason: $0.reason) }
    }
    func me() async throws -> MeRecord { let remote: RemoteMe = try await get("me"); return MeRecord(userId: remote.user.id, email: remote.email, budgetCents: remote.budgetCents ?? 0, theme: "system") }
    func bids(listingId: String) async throws -> [Bid] { let offers: [RemoteOffer] = try await get("me/offers?role=buyer"); return offers.filter { $0.listingId == listingId }.map { Bid(id: $0.id, listingId: $0.listingId, userId: $0.buyer.id, amountCents: $0.amountCents, message: $0.message ?? "Offer", reactions: .init(fire: 0, eyes: 0)) } }
    func order(id: String) async throws -> Order { let remote: RemoteOrder = try await get("orders/\(id)"); return Order(id: remote.id, listingId: remote.listing.id, amountCents: remote.amountCents, feeCents: remote.feeCents, totalCents: remote.amountCents + remote.feeCents, status: remote.status) }
    func notifications() async throws -> [AppNotification] { let remote: [RemoteNotification] = try await get("me/notifications"); return remote.map { AppNotification(id: $0.id, title: $0.title, body: $0.body, deepLink: $0.deepLink, ago: $0.createdAt, read: $0.readAt != nil) } }
    func users() async throws -> [UserPublic] { try await mocks.users() }
    func thread(id: String) async throws -> OfferThread { try await mocks.thread(id: id) }
    func places() async throws -> [Place] { try await mocks.places() }
    func meetups(orderId: String) async throws -> [MeetupSuggestion] { try await mocks.meetups(orderId: orderId) }
    func screenshotJob() async throws -> ScreenshotResult { try await mocks.screenshotJob() }
    func fixture<T: Decodable>(_ name: String) async throws -> T { try await mocks.fixture(name) }
}
