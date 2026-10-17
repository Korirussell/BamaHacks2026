import Foundation

enum Config {
    static let useMocks = true
    /// Live demo API: the laptop behind ngrok's static domain (`ngrok http --url=sled-maker-outshoot.ngrok-free.dev 8787`).
    /// "http://localhost:8787/api/v1" for the Simulator.
    static let apiBaseURL = URL(string: "https://sled-maker-outshoot.ngrok-free.dev/api/v1")!
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
    func fixture<T: Decodable>(_ name: String) async throws -> T { try await load(name, delay: false) }
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
    func fixture<T: Decodable>(_ name: String) async throws -> T { throw APIError.notImplemented }
}

// MARK: - Local AI (live API: JEV-9B haggle triage + listing gate)

/// The two AI endpoints always hit the real API (Config.useMocks only covers the mocked screens).
/// Auth: a Supabase access token from the `HANDOFF_API_TOKEN` env var (Xcode scheme) or the UserDefaults key
/// `api_access_token`. Mock listing ids aren't UUIDs, so haggling on one targets `HANDOFF_DEMO_LISTING_ID`.
/// Without a token, or when the call fails, callers fall back to `OfflineAI` so the demo never dead-ends.
enum AIConfig {
    static func value(_ key: String, defaultsKey: String) -> String? {
        let raw = ProcessInfo.processInfo.environment[key] ?? UserDefaults.standard.string(forKey: defaultsKey)
        let v = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return v.isEmpty ? nil : v
    }
    static var accessToken: String? { value("HANDOFF_API_TOKEN", defaultsKey: "api_access_token") }
    static var demoListingId: String? { value("HANDOFF_DEMO_LISTING_ID", defaultsKey: "demo_listing_id") }

    /// The id the API knows this listing by: its own id when that's a UUID, else the demo listing.
    static func liveListingId(_ id: String) -> String? {
        UUID(uuidString: id) != nil ? id : demoListingId
    }
}

enum AIError: LocalizedError {
    case noToken, noLiveListing, http(Int, String)
    var errorDescription: String? {
        switch self {
        case .noToken: return "no API token set"
        case .noLiveListing: return "listing isn't on the live API"
        case let .http(code, msg): return "API \(code): \(msg)"
        }
    }
}

struct HaggleTurn: Codable, Hashable {
    let from: String   // buyer | seller
    let text: String
}

struct JEVDecision: Codable, Hashable {
    let pick: String
    let value: Double
    let probabilities: [String: Double]?
}

/// The AI types use explicit snake_case keys and a plain decoder: `.convertFromSnakeCase`
/// would also rewrite the keys of the `decisions` dictionary.
struct HaggleResponse: Decodable, Hashable {
    struct ProposedOffer: Decodable, Hashable {
        let id: String?
        let amountCents: Int?
        enum CodingKeys: String, CodingKey { case id, amountCents = "amount_cents" }
    }
    let intent: String?
    let amountCents: Int?
    let action: String
    let priceCents: Int?
    let reply: String
    let scamFlags: [String]
    let reported: Bool?
    let engine: String
    let decisions: [String: JEVDecision]?
    let proposedOffer: ProposedOffer?

    enum CodingKeys: String, CodingKey {
        case intent, action, reply, reported, engine, decisions
        case amountCents = "amount_cents", priceCents = "price_cents", scamFlags = "scam_flags"
        case proposedOffer = "proposed_offer"
    }

    init(action: String, priceCents: Int? = nil, reply: String, scamFlags: [String] = [], acceptedCents: Int? = nil) {
        self.intent = nil; self.amountCents = nil; self.action = action; self.priceCents = priceCents
        self.reply = reply; self.scamFlags = scamFlags; self.reported = nil; self.engine = "rules"; self.decisions = nil
        self.proposedOffer = acceptedCents.map { ProposedOffer(id: nil, amountCents: $0) }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        intent = try c.decodeIfPresent(String.self, forKey: .intent)
        amountCents = try c.decodeIfPresent(Int.self, forKey: .amountCents)
        action = try c.decode(String.self, forKey: .action)
        priceCents = try c.decodeIfPresent(Int.self, forKey: .priceCents)
        reply = try c.decode(String.self, forKey: .reply)
        scamFlags = try c.decodeIfPresent([String].self, forKey: .scamFlags) ?? []
        reported = try c.decodeIfPresent(Bool.self, forKey: .reported)
        engine = try c.decodeIfPresent(String.self, forKey: .engine) ?? "rules"
        decisions = try c.decodeIfPresent([String: JEVDecision].self, forKey: .decisions)
        proposedOffer = try c.decodeIfPresent(ProposedOffer.self, forKey: .proposedOffer)
    }
}

struct ListingReview: Decodable, Hashable {
    let allowed: Bool
    let blockedReasons: [String]
    let warnings: [String]
    let suggestedCategory: String?
    let engine: String

    enum CodingKeys: String, CodingKey {
        case allowed, warnings, engine
        case blockedReasons = "blocked_reasons", suggestedCategory = "suggested_category"
    }

    init(allowed: Bool, blockedReasons: [String], warnings: [String], suggestedCategory: String?, engine: String) {
        self.allowed = allowed; self.blockedReasons = blockedReasons; self.warnings = warnings
        self.suggestedCategory = suggestedCategory; self.engine = engine
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        allowed = try c.decode(Bool.self, forKey: .allowed)
        blockedReasons = try c.decodeIfPresent([String].self, forKey: .blockedReasons) ?? []
        warnings = try c.decodeIfPresent([String].self, forKey: .warnings) ?? []
        suggestedCategory = try c.decodeIfPresent(String.self, forKey: .suggestedCategory)
        engine = try c.decodeIfPresent(String.self, forKey: .engine) ?? "none"
    }
}

enum AIAPI {
    private struct HaggleBody: Encodable {
        let message: String
        let history: [HaggleTurn]
        let last_counter_cents: Int?
        let place_offer: Bool
    }
    private struct ReviewBody: Encodable {
        let title: String
        let description: String
        let category: String
        let price_cents: Int
        let isbn: String?
    }
    private struct Envelope<T: Decodable>: Decodable { let data: T }
    private struct ErrorEnvelope: Decodable {
        struct Body: Decodable { let code: String; let message: String }
        let error: Body
    }

    /// POST /listings/{id}/haggle.
    static func haggle(listingId: String, message: String, history: [HaggleTurn], lastCounterCents: Int?) async throws -> HaggleResponse {
        guard let id = AIConfig.liveListingId(listingId) else { throw AIError.noLiveListing }
        return try await post("listings/\(id)/haggle",
                              HaggleBody(message: message, history: history, last_counter_cents: lastCounterCents, place_offer: true))
    }

    /// POST /ai/listing-review. Mock categories outside the API's enum ("tech", "bike") go up as "other".
    static func listingReview(title: String, description: String, category: String, priceCents: Int, isbn: String? = nil) async throws -> ListingReview {
        let known = ["textbook", "lab_supplies", "dorm", "ticket", "other"]
        return try await post("ai/listing-review",
                              ReviewBody(title: title, description: description,
                                         category: known.contains(category) ? category : "other",
                                         price_cents: priceCents, isbn: isbn))
    }

    private static func post<Body: Encodable, Res: Decodable>(_ path: String, _ body: Body) async throws -> Res {
        guard let token = AIConfig.accessToken else { throw AIError.noToken }
        var req = URLRequest(url: Config.apiBaseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.timeoutInterval = 25   // JEV runs on the laptop worker; fall back rather than hang the demo
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("1", forHTTPHeaderField: "ngrok-skip-browser-warning")
        req.httpBody = try JSONEncoder().encode(body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let msg = (try? JSONDecoder().decode(ErrorEnvelope.self, from: data))?.error.message ?? "request failed"
            throw AIError.http(status, msg)
        }
        return try JSONDecoder().decode(Envelope<Res>.self, from: data).data
    }
}

/// On-phone stand-in for the API's keyword rules, used only when the live call can't be made.
enum OfflineAI {
    static func haggle(askCents: Int, negotiable: Bool, message: String, lastCounterCents: Int?) -> HaggleResponse {
        let text = message.lowercased()
        var flags: [String] = []
        if ["venmo", "zelle", "cash app", "cashapp", "paypal", "gift card", "wire"].contains(where: { text.contains($0) }) {
            flags.append("off_platform_payment")
        }
        if ["urgent", "right now", "asap", "today only"].contains(where: { text.contains($0) }) { flags.append("urgency_pressure") }
        if ["http", "verify your", "login", "code you got"].contains(where: { text.contains($0) }) { flags.append("phishing") }
        if !flags.isEmpty {
            return .init(action: "warn", reply: "Let's keep payment in Handoff so the money's protected for both of us.", scamFlags: flags)
        }
        guard let amount = parseCents(message) else {
            return .init(action: "reply", reply: "Still available! It's \(Money.format(lastCounterCents ?? askCents)). Make me an offer.")
        }
        let ceiling = lastCounterCents ?? askCents
        if amount >= ceiling || amount >= askCents * 9 / 10 {
            let deal = min(amount, ceiling)
            return .init(action: "accept", priceCents: deal, reply: "Deal at \(Money.format(deal)). Sending it over.", acceptedCents: deal)
        }
        let floor = askCents * 3 / 4
        if !negotiable || amount < askCents / 2 {
            let firm = negotiable ? min(ceiling, floor) : askCents
            return .init(action: "hold_firm", priceCents: firm, reply: "That's a bit low. Best I can do is \(Money.format(firm)).")
        }
        let counter = min(ceiling, max(floor, ((amount + ceiling) / 2 + 50) / 100 * 100))
        return .init(action: "counter", priceCents: counter, reply: "Meet me at \(Money.format(counter))?")
    }

    static func listingReview(title: String, priceCents: Int) -> ListingReview {
        var warnings: [String] = []
        if priceCents < 100 { warnings.append("That price looks too low to be real.") }
        if title.trimmingCharacters(in: .whitespaces).count < 4 { warnings.append("Add a more descriptive title.") }
        return .init(allowed: true, blockedReasons: [], warnings: warnings, suggestedCategory: nil, engine: "none")
    }

    /// "$40", "would you take 35.50" → cents.
    private static func parseCents(_ message: String) -> Int? {
        guard let range = message.range(of: #"\$?\d+(\.\d{1,2})?"#, options: .regularExpression) else { return nil }
        let raw = message[range].replacingOccurrences(of: "$", with: "")
        guard let dollars = Double(raw), dollars > 0 else { return nil }
        return Int((dollars * 100).rounded())
    }
}
