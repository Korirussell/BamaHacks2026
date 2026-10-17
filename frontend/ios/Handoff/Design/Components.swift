import SwiftUI

struct ItemTile: View {
    let listing: Listing
    var emojiSize: CGFloat = 52

    var body: some View {
        ZStack {
            Color.tile(listing.tile)
            if let data = listing.localImageData, let img = UIImage(data: data) {
                Image(uiImage: img).resizable().scaledToFill()
            } else {
                Text(listing.emoji).font(.system(size: emojiSize))
            }
        }
        .clipped()
    }
}

struct TagPill: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 10.5, weight: .heavy))
            .textCase(.uppercase)
            .foregroundStyle(Color.hoInk)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Capsule().fill(Color.hoCard))
            .overlay(Capsule().strokeBorder(Color.hoInk, lineWidth: 1.5))
    }
}

/// Cards-v3 §5: height 34, radius 999, bg img-bg, text title 13/500; selected = title bg + page-bg text. No outlines.
struct ChipRow: View {
    let chips: [String]
    @Binding var selected: String
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(chips, id: \.self) { chip in
                    let on = chip == selected
                    Button { selected = chip } label: {
                        Text(chip)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(on ? Color.hoBg : Color.hoInk)
                            .padding(.horizontal, 14)
                            .frame(height: 34)
                            .background(Capsule().fill(on ? Color.hoInk : Color.cardImgBg))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 4)
        }
    }
}

struct ReliabilityBadge: View {
    let reliability: Reliability
    var body: some View {
        let (label, fill): (String, Color) = switch reliability.badge {
        case "top": ("Top seller ★", .hoButter)
        case "reliable": ("Reliable", .hoMint)
        default: ("New", .hoPeach)
        }
        Text(label)
            .font(.system(size: 10.5, weight: .semibold))
            .foregroundStyle(reliability.badge == "new" ? Color.hoInk : Color.hoInkOnLight)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Capsule().fill(fill))
    }
}

struct BubbleView: View {
    enum Side { case me, them }
    let side: Side
    let text: String
    var tag: String? = nil
    var footer: String? = nil

    var body: some View {
        HStack {
            if side == .me { Spacer(minLength: 50) }
            VStack(alignment: side == .me ? .trailing : .leading, spacing: 4) {
                if let tag {
                    Text(tag)
                        .font(.system(size: 9.5, weight: .heavy)).textCase(.uppercase)
                        .foregroundStyle(Color.hoAccentText)
                }
                Text(text)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(side == .me ? Color.hoInkOnLight : Color.hoInk)
                if let footer {
                    Text(footer).font(.system(size: 10.5, weight: .bold))
                        .foregroundStyle(side == .me ? Color.hoInkOnLight.opacity(0.6) : Color.hoSoft)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .sticker(radius: 18, shadow: 3, fill: side == .me ? .hoMint : .hoCard)
            if side == .them { Spacer(minLength: 50) }
        }
    }
}

struct BidBubbles: View {
    let bids: [Bid]
    let users: [String: UserPublic]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(bids) { bid in
                let isMe = bid.id == "b_me"
                let user = users[bid.userId]
                HStack(alignment: .top, spacing: 8) {
                    if !isMe {
                        Text(user?.avatarEmoji ?? "🙂").font(.system(size: 22))
                            .frame(width: 34, height: 34)
                            .background(Circle().fill(Color.hoSunk))
                            .overlay(Circle().strokeBorder(Color.hoInk, lineWidth: 1.5))
                    }
                    VStack(alignment: isMe ? .trailing : .leading, spacing: 4) {
                        BubbleView(side: isMe ? .me : .them,
                                   text: isMe ? "You · \(Money.format(bid.amountCents))" : bid.message,
                                   tag: isMe ? nil : (user?.displayName ?? ""))
                        if bid.reactions.fire + bid.reactions.eyes > 0 {
                            HStack(spacing: 8) {
                                if bid.reactions.fire > 0 { Text("🔥 \(bid.reactions.fire)") }
                                if bid.reactions.eyes > 0 { Text("👀 \(bid.reactions.eyes)") }
                            }
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Color.hoSoft)
                            .padding(.leading, 6)
                        }
                    }
                }
            }
        }
    }
}

struct EmptyState: View {
    var text: String = Copy.emptyFeed
    var body: some View {
        VStack(spacing: 10) {
            Text("📭").font(.system(size: 44))
            Text(text).font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.hoSoft)
                .multilineTextAlignment(.center)
        }
        .padding(30)
        .frame(maxWidth: .infinity)
    }
}

struct ErrorState: View {
    var retry: () -> Void
    var body: some View {
        VStack(spacing: 14) {
            Text(Copy.errorGeneric).font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.hoSoft)
                .multilineTextAlignment(.center)
            Button("Retry", action: retry).buttonStyle(.pill(.neutral, small: true))
        }
        .padding(30)
    }
}

struct SheetTitle: View {
    let kicker: String?
    let title: String
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let kicker {
                Text(kicker).font(.system(size: 11.5, weight: .heavy)).textCase(.uppercase)
                    .foregroundStyle(Color.hoAccentText)
            }
            Text(title).font(.display(21)).displayTracking(21).foregroundStyle(Color.hoInk)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
