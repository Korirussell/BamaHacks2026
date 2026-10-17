import Foundation

// Codable mirrors of frontend-build.md §4. Decoded with .convertFromSnakeCase.

struct Reliability: Codable, Hashable {
    let score: Double
    let completed: Int
    let noShows: Int
    let badge: String
}

struct School: Codable, Hashable {
    let id: String
    let name: String
    let domain: String
    let listingCount: Int?
}

struct UserPublic: Codable, Identifiable, Hashable {
    let id: String
    let displayName: String
    let avatarEmoji: String
    let major: String?
    let gradYear: Int?
    let schoolId: String
    let reliability: Reliability
    let mutualFriendCount: Int
}

struct MeRecord: Codable, Hashable {
    let userId: String
    let email: String
    let budgetCents: Int
    let theme: String
}

struct Place: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let kind: String
    let isSafeZone: Bool
    let map: MapRect
    struct MapRect: Codable, Hashable { let x: Double; let y: Double; let w: Double; let h: Double }
}

struct Listing: Codable, Identifiable, Hashable {
    let id: String
    var title: String
    var description: String
    let category: String
    var priceCents: Int
    let originalPriceCents: Int?
    let negotiable: Bool
    var condition: String
    let emoji: String
    let tile: String
    let tag: String?
    let locationLabel: String?
    var status: String
    let sellerId: String?
    let source: Source
    let fairPrice: FairPrice?
    var interest: Interest?
    let reason: String?
    let createdAt: String
    /// Web-style paths from the mock JSON, e.g. "/listings/l_owala-1.webp" (cards-v3 §4.3).
    let images: [String]
    /// Local-only: photo picked in the Sell flow (not in the mock JSON).
    var localImageData: Data? = nil

    /// Cards-v3 §4.3: "/listings/l_owala-1.webp" -> asset catalog name "l_owala-1".
    var imageAssetNames: [String] {
        images.map { ($0 as NSString).lastPathComponent.replacingOccurrences(of: ".webp", with: "") }
    }

    struct Source: Codable, Hashable {
        let channel: String
        let authorHandle: String?
        let postCaption: String?
        let postUrl: String?
        let postedAgo: String?
        let claimed: Bool
    }
    struct FairPrice: Codable, Hashable { let lowCents: Int; let highCents: Int }
    struct Interest: Codable, Hashable { var count: Int; var topAmountCents: Int? }

    var isGhost: Bool { status == "ghost" }

    var conditionLabel: String {
        condition.replacingOccurrences(of: "_", with: " ").capitalized
    }

    /// Cards-v3 §2 meta line: `{condition} · {place} · {time ago}`, skipping empty parts.
    var metaLine: String {
        if isGhost { return "🔥 \(interest?.count ?? 0) want this · Not on Handoff yet" }
        return [conditionLabel, locationLabel, source.postedAgo]
            .compactMap { $0?.isEmpty == false ? $0 : nil }
            .joined(separator: " · ")
    }

    /// Cards-v3 §4.4: category line icon shown when a listing has no photo. Never emoji.
    var fallbackSymbol: String {
        if id.hasPrefix("l_bike") { return "bicycle" }
        if id.hasPrefix("l_fridge") { return "refrigerator" }
        if id.hasPrefix("l_ti84") { return "function" }
        if id.hasPrefix("l_cs201") { return "book.closed" }
        if id.hasPrefix("l_ticket") { return "ticket" }
        if id.hasPrefix("l_goggles") { return "eyeglasses" }
        if id.hasPrefix("l_owala") || id.hasPrefix("l_hydro") { return "waterbottle" }
        if id.hasPrefix("l_lamp") { return "lamp.desk" }
        if id.hasPrefix("l_mouse") { return "computermouse" }
        return "photo"
    }

    enum CodingKeys: String, CodingKey {
        case id, title, description, category, priceCents, originalPriceCents, negotiable, condition, emoji, tile, tag,
             locationLabel, status, sellerId, source, fairPrice, interest, reason, createdAt, images
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        description = try c.decode(String.self, forKey: .description)
        category = try c.decode(String.self, forKey: .category)
        priceCents = try c.decode(Int.self, forKey: .priceCents)
        originalPriceCents = try c.decodeIfPresent(Int.self, forKey: .originalPriceCents)
        negotiable = try c.decode(Bool.self, forKey: .negotiable)
        condition = try c.decode(String.self, forKey: .condition)
        emoji = try c.decode(String.self, forKey: .emoji)
        tile = try c.decode(String.self, forKey: .tile)
        tag = try c.decodeIfPresent(String.self, forKey: .tag)
        locationLabel = try c.decodeIfPresent(String.self, forKey: .locationLabel)
        status = try c.decode(String.self, forKey: .status)
        sellerId = try c.decodeIfPresent(String.self, forKey: .sellerId)
        source = try c.decode(Source.self, forKey: .source)
        fairPrice = try c.decodeIfPresent(FairPrice.self, forKey: .fairPrice)
        interest = try c.decodeIfPresent(Interest.self, forKey: .interest)
        reason = try c.decodeIfPresent(String.self, forKey: .reason)
        createdAt = try c.decode(String.self, forKey: .createdAt)
        images = try c.decodeIfPresent([String].self, forKey: .images) ?? []
    }

    init(id: String, title: String, description: String, category: String, priceCents: Int,
         originalPriceCents: Int? = nil, negotiable: Bool, condition: String, emoji: String, tile: String,
         tag: String?, locationLabel: String?, status: String, sellerId: String?, source: Source,
         fairPrice: FairPrice?, interest: Interest?, reason: String?, createdAt: String,
         images: [String] = [], localImageData: Data? = nil) {
        self.id = id; self.title = title; self.description = description; self.category = category
        self.priceCents = priceCents; self.originalPriceCents = originalPriceCents; self.negotiable = negotiable
        self.condition = condition; self.emoji = emoji; self.tile = tile; self.tag = tag
        self.locationLabel = locationLabel; self.status = status; self.sellerId = sellerId; self.source = source
        self.fairPrice = fairPrice; self.interest = interest; self.reason = reason; self.createdAt = createdAt
        self.images = images; self.localImageData = localImageData
    }
}

struct Bid: Codable, Identifiable, Hashable {
    let id: String
    let listingId: String
    let userId: String
    let amountCents: Int
    let message: String
    let reactions: Reactions
    struct Reactions: Codable, Hashable { let fire: Int; let eyes: Int }
}

struct ThreadMessage: Codable, Identifiable, Hashable {
    let id: String
    let from: String
    let kind: String
    let amountCents: Int?
    let text: String
    let at: String
}

struct OfferThread: Codable, Identifiable, Hashable {
    let id: String
    let listingId: String
    let buyerId: String
    let sellerId: String
    var status: String
    let expiresInHours: Int
    var messages: [ThreadMessage]
    var agreedCents: Int?
}

struct Order: Codable, Identifiable, Hashable {
    let id: String
    let listingId: String
    var amountCents: Int
    var feeCents: Int
    var totalCents: Int
    var status: String
}

struct MeetupSuggestion: Codable, Identifiable, Hashable {
    let id: String
    let startLabel: String
    let startIso: String
    let placeId: String
    let reason: String
    let walkMinutes: Walk
    let score: Int
    var method: String? = nil
    var isLocker: Bool { method == "locker" }
    struct Walk: Codable, Hashable { let me: Int; let them: Int }
}

struct AppNotification: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let body: String
    let deepLink: String
    let ago: String
    var read: Bool
}

struct ScreenshotResult: Codable, Hashable {
    let isSalePost: Bool
    let category: String
    let title: String
    let condition: String
    let priceCents: Int
    let fairPrice: Listing.FairPrice
    let description: String
    let authorHandle: String?
    let confidence: Double
    let missingFields: [String]
    /// screenshot | comparable_listings | ai_estimate (Gemma); price_reason only comes with ai_estimate.
    let priceSource: String?
    let priceReason: String?

    var priceSourceLine: String? {
        switch priceSource {
        case "screenshot": return "Price taken from the post"
        case "comparable_listings": return "Priced from similar listings on Handoff"
        case "ai_estimate": return "Priced by Gemma: \(priceReason ?? "estimated from the photo")"
        default: return nil
        }
    }
}

// MARK: - features-v2 fixtures

struct PhotoResult: Codable, Hashable {
    struct Detected: Codable, Hashable { let label: String; let confidence: Double }
    struct Comp: Codable, Hashable { let source: String; let priceCents: Int }
    struct PriceModel: Codable, Hashable { let fastCents: Int; let fastDays: Int; let maxCents: Int; let maxDays: Int }
    let detected: Detected
    let attributes: [String]
    let category: String
    let condition: String
    let title: String
    let description: String
    let tags: [String]
    let emoji: String
    let tile: String
    let comps: [Comp]
    let priceModel: PriceModel
    let confidence: Double
    let modelNote: String
}

struct BuyRequest: Codable, Hashable {
    let id: String
    let listingId: String
    let buyerId: String
    let amountCents: Int
    let message: String
    let moneyReady: Bool
    let createdAgo: String
}

struct Locker: Codable, Hashable {
    let orderId: String
    let placeId: String
    let lockerNumber: Int
    let dropoffCode: String
    let pickupCode: String
    let dropoffByLabel: String
    let expiresInSeconds: Int
    var status: String
}

struct Wishlist: Codable, Hashable {
    struct Item: Codable, Hashable, Identifiable { let id: String; let label: String; let maxPriceCents: Int; let matchCount: Int }
    struct ForYou: Codable, Hashable { let listingId: String; let wishlistId: String; let reason: String; let score: Int }
    let items: [Item]
    let forYou: [ForYou]
}

struct ScriptLine: Codable, Hashable, Identifiable {
    let id: String
    let from: String
    let text: String
    let delayMs: Int
    let after: String?
}

struct History: Codable, Hashable {
    struct Stats: Codable, Hashable { var count: Int; var savedCents: Int; let avgWalkMin: Int; let noShows: Int }
    struct Item: Codable, Hashable, Identifiable {
        let id: String; let emoji: String; let title: String; let partner: String; let placeId: String
        let date: String; let method: String; let amountCents: Int; let role: String
    }
    var stats: Stats
    var items: [Item]
}
