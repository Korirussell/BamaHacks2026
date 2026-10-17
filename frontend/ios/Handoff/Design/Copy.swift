import Foundation

// Exact strings from frontend-build.md §6.
enum Copy {
    static let feedTitle = "Feed"
    static let feedSub = "University of Alabama · 1,284 listings"
    static let searchPlaceholder = "Search textbooks, tickets, rides…"
    static let chips = ["All", "Books", "Tickets", "Rides", "Instagram"]

    static let reasonYourClass = "Your class"
    static let reasonWishlist = "Wishlist match"
    static let reasonNearby = "Near you"

    static let ghostLabel = "Seller's not on Handoff yet"
    static let ghostCta = "I want this · $200"
    static let ghostToast = "Done! We'll DM @jackson.rides. You'll hear back when they claim it."
    static let ghostFineprint = "We'll DM @jackson.rides a claim link. Money's held until it's in your hands."

    static let threadExpiry = "Offer thread · expires in 47h"
    static let payCta = "Pay $65 · held until handoff 🔒"

    static let meetupKicker = "Deal at $65 🤝"
    static let meetupTitle = "3 handoff spots that fit both your schedules"
    static func meetupLock(_ time: String) -> String { "Lock in \(time) →" }

    static let celebrateTD = "Touchdown!"
    static let celebrateTDPaid = "Paid $65. It's held safe until the handoff."
    static let celebrateTDDone = "Clean handoff. $65 is on its way to Kayla."
    static let celebrateFG = "It's good!"
    static let celebrateFGLocked = "Locked in: Bevill Building · 3:30 PM"
    static func celebrateFGLocked(place: String, time: String) -> String { "Locked in: \(place) · \(time)" }
    static let celebrateFGClaimed = "Your bike is live. 3 buyers are waiting."
    static let celebrateDone = "Done"

    static let qrGiver = "Show this to Kori"
    static let qrReceiver = "Scan Kayla's code to finish"
    static let qrOverride = "Pretend I'm at the spot"

    static let emptyFeed = "Nothing here yet. Be the first to post something."
    static let errorGeneric = "That didn't load. Check your connection and try again."
    static let jobSteps = ["Reading your post… 🔍", "Spotting the item…", "💸 Estimating a fair price…"]
    static let jobFailed = "Couldn't read that one. Fill it in yourself?"
}
