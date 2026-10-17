import SwiftUI

/// Explore: search over the feed + seeded tutoring / rides / tickets (extras.json, P2).
struct ExploreView: View {
    @Environment(AppStore.self) private var store
    @State private var query = ""
    @State private var extras: Extras?

    struct Extras: Codable {
        let tutors: [Tutor]; let rides: [Ride]; let events: [Event]
        struct Tutor: Codable, Identifiable { let id, userId, course, grade: String; let verified: Bool; let rateCents: Int; let rating: Double; let sessions: Int }
        struct Ride: Codable, Identifiable { let id, driverId, from, to, when: String; let seatsLeft, seatsTotal, priceCents: Int }
        struct Event: Codable, Identifiable { let id, name, when: String; let tickets: Int }
    }

    private var results: [Listing] {
        guard !query.isEmpty else { return [] }
        return store.listings.filter { $0.title.localizedCaseInsensitiveContains(query) || ($0.tag ?? "").localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Explore").font(.display(30)).displayTracking(30).foregroundStyle(Color.hoInk).padding(.top, 8)
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").font(.system(size: 14, weight: .bold)).foregroundStyle(Color.hoSoft)
                    TextField(Copy.searchPlaceholder, text: $query).font(.system(size: 15, weight: .medium))
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                .capsuleSticker()

                if !query.isEmpty {
                    if results.isEmpty { EmptyState(text: "No matches. Try “CS 201” or “fridge”.") }
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)], spacing: 16) {
                        ForEach(results) { l in
                            NavigationLink(value: l) { ListingCard(listing: l) }.buttonStyle(PressableStyle())
                        }
                    }
                } else if let extras {
                    section("Tutoring 📚")
                    ForEach(extras.tutors) { t in
                        let u = store.users[t.userId]
                        card(u?.avatarEmoji ?? "🙂", "\(t.course) · \(u?.displayName ?? "")",
                             "Got an \(t.grade) ✓ · \(String(format: "%.1f", t.rating))★ · \(t.sessions) sessions",
                             "\(Money.format(t.rateCents))/hr")
                    }
                    section("Rides 🚗")
                    ForEach(extras.rides) { r in
                        card("🚗", "\(r.from) → \(r.to)", "\(r.when) · \(r.seatsLeft) of \(r.seatsTotal) seats left",
                             Money.format(r.priceCents))
                    }
                    section("Tickets 🎟️")
                    ForEach(extras.events) { e in
                        card("🎟️", e.name, e.when, "\(e.tickets) listed")
                    }
                } else {
                    ForEach(0..<3, id: \.self) { _ in RoundedRectangle(cornerRadius: 18).fill(Color.hoSunk).frame(height: 70) }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .background(Color.hoBg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .navigationDestination(for: Listing.self) { ListingDetailView(listingId: $0.id) }
        .task {
            guard extras == nil, let url = Bundle.main.url(forResource: "extras", withExtension: "json"),
                  let data = try? Data(contentsOf: url) else { return }
            try? await Task.sleep(for: .milliseconds(Int.random(in: 300...800)))
            let d = JSONDecoder(); d.keyDecodingStrategy = .convertFromSnakeCase
            extras = try? d.decode(Extras.self, from: data)
        }
    }

    private func section(_ title: String) -> some View {
        Text(title).font(.display(20)).foregroundStyle(Color.hoInk).padding(.top, 4)
    }

    private func card(_ emoji: String, _ title: String, _ sub: String, _ trailing: String) -> some View {
        HStack(spacing: 12) {
            Text(emoji).font(.system(size: 26))
                .frame(width: 48, height: 48)
                .background(Circle().fill(Color.hoPeach))
                .overlay(Circle().strokeBorder(Color.hoInk, lineWidth: 2))
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 15, weight: .heavy)).foregroundStyle(Color.hoInk)
                Text(sub).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Color.hoSoft)
            }
            Spacer()
            Text(trailing).font(.display(15)).foregroundStyle(Color.hoInk)
        }
        .padding(12)
        .sticker(radius: 18, shadow: 3)
    }
}
