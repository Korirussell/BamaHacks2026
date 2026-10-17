import SwiftUI

/// Cards v3 — clean marketplace overhaul (cards-v3.md). Overrides the sticker rules in
/// Sticker.swift for listing cards, grids, and the listing detail gallery only.

/// 4:5 listing photo: local sell-flow photo > bundled asset > category line icon (never emoji).
struct ListingPhoto: View {
    let listing: Listing
    var assetName: String? = nil
    var cornerRadius: CGFloat = 12
    var fallbackIconSize: CGFloat = 28

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color.cardImgBg
                photoContent
                    .frame(width: geo.size.width, height: geo.size.height)
                    .clipped()
            }
        }
        .aspectRatio(4.0 / 5.0, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
    }

    private var resolvedAssetName: String? { assetName ?? listing.imageAssetNames.first }

    @ViewBuilder private var photoContent: some View {
        if let data = listing.localImageData, let img = UIImage(data: data) {
            Image(uiImage: img).resizable().scaledToFill()
        } else if let name = resolvedAssetName, UIImage(named: name) != nil {
            Image(name).resizable().scaledToFill()
        } else {
            Image(systemName: listing.fallbackSymbol)
                .font(.system(size: fallbackIconSize))
                .foregroundStyle(Color.cardMeta)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// Glass badge, priority order per §2: Instagram > your class > wishlist match > price drop > new.
struct GlassBadge: View {
    let text: String
    var igDot = false
    var tint: Color = .hoInk

    var body: some View {
        HStack(spacing: 4) {
            if igDot {
                Circle().fill(Color.igGradient).frame(width: 6, height: 6)
            }
            Text(text)
        }
        .font(.system(size: 11.5, weight: .semibold))
        .foregroundStyle(tint)
        .lineLimit(1)
        .padding(.horizontal, 9).padding(.vertical, 5)
        .background(.ultraThinMaterial, in: Capsule())
    }
}

extension Listing {
    /// Cards-v3 §2 badge priority: Instagram > your class > wishlist match > price drop > new.
    func cardBadge(reasonText: String? = nil) -> (text: String, igDot: Bool, tint: Color)? {
        if isGhost, let handle = source.authorHandle {
            return ("From Instagram · \(handle)", true, .hoInk)
        }
        if let reasonText { return (reasonText, false, .hoInk) }
        switch reason {
        case "your_class": return ("Your class", false, .hoInk)
        case "wishlist_match": return ("Wishlist match", false, .hoInk)
        default: break
        }
        if let original = originalPriceCents, original > priceCents { return ("Price drop", false, .hoAccentText) }
        return reason == "new" ? ("New", false, .hoInk) : nil
    }
}

/// Heart (wishlist/save) toggle, top-right glass circle per §2.
struct HeartButton: View {
    let listingId: String
    @Environment(AppStore.self) private var store

    var body: some View {
        let saved = store.savedListingIds.contains(listingId)
        Button {
            store.toggleSaved(listingId)
        } label: {
            Image(systemName: saved ? "heart.fill" : "heart")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(saved ? Color.hoAccent : Color.hoInk)
                .frame(width: 32, height: 32)
                .background(.ultraThinMaterial, in: Circle())
                .symbolEffect(.bounce, value: saved)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(saved ? "Remove from wishlist" : "Save to wishlist")
    }
}

/// Cards v3 §2/§6 — photo-first grid card. No border, no background box, no shadow at rest.
struct ListingCard: View {
    let listing: Listing
    var reasonText: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            GeometryReader { geo in
                ListingPhoto(listing: listing)
                    .overlay(alignment: .topLeading) {
                        if let badge = listing.cardBadge(reasonText: reasonText) {
                            GlassBadge(text: badge.text, igDot: badge.igDot, tint: badge.tint)
                                .frame(maxWidth: geo.size.width - 52, alignment: .leading)
                                .padding(8)
                        }
                    }
                    .overlay(alignment: .topTrailing) {
                        HeartButton(listingId: listing.id).padding(8)
                    }
                    .overlay {
                        if listing.status == "sold" || listing.status == "pending" {
                            ZStack {
                                Color.black.opacity(0.4)
                                Text(listing.status == "sold" ? "SOLD" : "PENDING")
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 12).padding(.vertical, 6)
                                    .background(.ultraThinMaterial, in: Capsule())
                            }
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                    }
            }
            .aspectRatio(4.0 / 5.0, contentMode: .fit)

            HStack(spacing: 6) {
                if let original = listing.originalPriceCents, original > listing.priceCents {
                    Text(Money.format(listing.priceCents)).foregroundStyle(Color.hoAccentText)
                    Text(Money.format(original)).strikethrough().foregroundStyle(Color.cardMeta)
                } else {
                    Text(Money.format(listing.priceCents)).foregroundStyle(Color.hoInk)
                }
            }
            .font(.system(size: 15, weight: .semibold)).monospacedDigit()

            Text(listing.title)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.hoInk)
                .lineLimit(1)

            Text(listing.metaLine)
                .font(.system(size: 12.5, weight: .regular))
                .foregroundStyle(listing.isGhost ? Color.hoAccentText : Color.cardMeta)
                .lineLimit(1)
        }
    }
}

/// Cards-v3 §5 clean chip: radius 999, bg img-bg, text title 13/500. No outlines.
struct CleanChip: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(Color.hoInk)
            .padding(.horizontal, 12)
            .frame(height: 30)
            .background(Capsule().fill(Color.cardImgBg))
    }
}

/// Grid skeleton matching the v3 card shape (no sticker outline/shadow).
struct GridSkeletonCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            RoundedRectangle(cornerRadius: 12).fill(Color.cardImgBg).aspectRatio(4.0 / 5.0, contentMode: .fit)
            RoundedRectangle(cornerRadius: 4).fill(Color.cardImgBg).frame(width: 50, height: 14)
            RoundedRectangle(cornerRadius: 4).fill(Color.cardImgBg).frame(height: 12)
            RoundedRectangle(cornerRadius: 4).fill(Color.cardImgBg).frame(width: 90, height: 11)
        }
        .redacted(reason: .placeholder)
    }
}
