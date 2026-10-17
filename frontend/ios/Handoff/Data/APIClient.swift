import Foundation

enum Config {
    static let useMocks = true
    static let apiBaseURL = URL(string: "http://localhost:8787/api/v1")!
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
}

enum APIError: Error { case missingMock(String), notImplemented }

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
}

/// URLSession stubs for the swap to the real API (§15). Not used while Config.useMocks is on.
struct LiveAPI: APIClient {
    func feed() async throws -> [Listing] { throw APIError.notImplemented }
    func users() async throws -> [UserPublic] { throw APIError.notImplemented }
    func me() async throws -> MeRecord { throw APIError.notImplemented }
    func bids(listingId: String) async throws -> [Bid] { throw APIError.notImplemented }
    func thread(id: String) async throws -> OfferThread { throw APIError.notImplemented }
    func order(id: String) async throws -> Order { throw APIError.notImplemented }
    func places() async throws -> [Place] { throw APIError.notImplemented }
    func meetups(orderId: String) async throws -> [MeetupSuggestion] { throw APIError.notImplemented }
    func notifications() async throws -> [AppNotification] { throw APIError.notImplemented }
    func screenshotJob() async throws -> ScreenshotResult { throw APIError.notImplemented }
}
