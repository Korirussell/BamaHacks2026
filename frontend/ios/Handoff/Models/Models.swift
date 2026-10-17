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
    /// Local-only: photo picked in the Sell flow (not in the mock JSON).
    var localImageData: Data? = nil

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

    enum CodingKeys: String, CodingKey {
        case id, title, description, category, priceCents, negotiable, condition, emoji, tile, tag,
             locationLabel, status, sellerId, source, fairPrice, interest, reason, createdAt
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
}
