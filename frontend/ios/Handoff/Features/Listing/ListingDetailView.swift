import SwiftUI

struct ListingDetailView: View {
    let listingId: String
    @Environment(AppStore.self) private var store
    @State private var openThread = false
    @State private var buying = false
    @State private var payDirect = false
    @State private var openBuyThread = false
    @State private var galleryIndex = 0
    @State private var haggleAI = false

    var body: some View {
        if let listing = store.listing(listingId) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    gallery(listing)

                    VStack(alignment: .leading, spacing: 10) {
                        Text(listing.title).font(.system(size: 26, weight: .bold)).foregroundStyle(Color.hoInk)
                        priceBlock(listing)
                        HStack(spacing: 8) {
                            CleanChip(text: listing.conditionLabel)
                            if let loc = listing.locationLabel { CleanChip(text: loc) }
                            if listing.negotiable { CleanChip(text: "Negotiable") }
                        }
                        Text(listing.description)
                            .font(.system(size: 15)).foregroundStyle(Color.hoInk)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    sellerRow(listing)

                    if !listing.isGhost, listing.status == "active", listing.sellerId != store.me?.userId {
                        Button { haggleAI = true } label: {
                            Label("Haggle with AI", systemImage: "sparkles")
                        }
                        .buttonStyle(.pill(.butter, full: true))
                    }

                    if let place = listing.locationLabel.flatMap({ store.place(matchingLabel: $0) }) {
                        pickupMap(place)
                    }

                    if listing.isGhost { ghostSection(listing) }
                }
                .padding(.horizontal, 18)
                .padding(.top, 8)
                .padding(.bottom, 120)
            }
            .background(Color.hoBg.ignoresSafeArea())
            .hidesTabBar()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .toolbarBackground(Color.hoBg, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .safeAreaInset(edge: .bottom) { actionBar(listing) }
            .navigationDestination(isPresented: $openThread) { HaggleThreadView(listingId: listing.id) }
            .navigationDestination(isPresented: $openBuyThread) { BuyThreadView(listingId: listing.id) }
            .sheet(isPresented: $payDirect) {
                // features-v2 Flow B: Buy at the listed price → money held → straight into the chat.
                PaySheet(amountCents: listing.priceCents) {
                    payDirect = false
                    store.show(toast: "\(Money.format(listing.priceCents)) held 🔒")
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(450))
                        openBuyThread = true
                    }
                }
            }
            .sheet(isPresented: $haggleAI) { HaggleChatSheet(listing: listing) }
            .dealFlow(isPaying: $buying, amountCents: listing.priceCents, listing: listing)
            .task { if listing.isGhost { await store.loadBids(listing.id) } }
        } else {
            EmptyState(text: "That listing's gone.")
        }
    }

    /// Full-bleed swipeable gallery (TabView .page) with page dots; single photo skips the pager.
    @ViewBuilder private func gallery(_ listing: Listing) -> some View {
        let assets = listing.imageAssetNames
        let showsPager = listing.localImageData == nil && assets.count > 1

        ZStack(alignment: .bottom) {
            if showsPager {
                GeometryReader { _ in
                    TabView(selection: $galleryIndex) {
                        ForEach(Array(assets.enumerated()), id: \.offset) { idx, name in
                            ListingPhoto(listing: listing, assetName: name, cornerRadius: 16, fallbackIconSize: 56)
                                .tag(idx)
                        }
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))
                }
                .aspectRatio(4.0 / 5.0, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 16))

                HStack(spacing: 5) {
                    ForEach(0..<assets.count, id: \.self) { i in
                        Circle().fill(i == galleryIndex ? Color.white : Color.white.opacity(0.5))
                            .frame(width: 5.5, height: 5.5)
                    }
                }
                .padding(.horizontal, 9).padding(.vertical, 6)
                .background(.ultraThinMaterial, in: Capsule())
                .padding(.bottom, 10)
            } else {
                ListingPhoto(listing: listing, cornerRadius: 16, fallbackIconSize: 56)
            }
        }
        .overlay(alignment: .topLeading) {
            GeometryReader { geo in
                Group {
                    if listing.isGhost, let h = listing.source.authorHandle {
                        GlassBadge(text: "From Instagram · \(h)", igDot: true)
                    } else if let tag = listing.tag {
                        GlassBadge(text: tag)
                    }
                }
                .frame(maxWidth: geo.size.width - 60, alignment: .leading)
                .padding(12)
            }
        }
        .overlay(alignment: .topTrailing) {
            HeartButton(listingId: listing.id).padding(12)
        }
    }

    private func priceBlock(_ listing: Listing) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                if let original = listing.originalPriceCents, original > listing.priceCents {
                    Text(Money.format(listing.priceCents)).foregroundStyle(Color.hoAccentText)
                    Text(Money.format(original)).strikethrough().foregroundStyle(Color.cardMeta)
                } else {
                    Text(Money.format(listing.priceCents)).foregroundStyle(Color.hoInk)
                }
            }
            .font(.system(size: 28, weight: .heavy)).monospacedDigit()

            if let fair = listing.fairPrice {
                let good = listing.priceCents <= fair.highCents
                Text("Fair price \(Money.format(fair.lowCents))–\(Money.format(fair.highCents))\(good ? " · Good deal" : "")")
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(Color.cardMeta)
            }
        }
    }

    private func pickupMap(_ place: Place) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Pick up at").font(.system(size: 11, weight: .heavy)).textCase(.uppercase).foregroundStyle(Color.hoSoft)
            MapContainer(mode: .focus, dataKey: nil, interactive: false,
                         focusPlaceId: place.id,
                         fallback: {
                             StickerMapView(places: store.places, pins: [], focusPlaceId: place.id)
                         })
                .frame(height: 160)
                .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    private func sellerRow(_ listing: Listing) -> some View {
        HStack(spacing: 12) {
            if listing.isGhost {
                Text("📸").font(.system(size: 24))
                    .frame(width: 46, height: 46)
                    .background(Circle().fill(Color.igGradient))
                VStack(alignment: .leading, spacing: 2) {
                    Text(listing.source.authorHandle ?? "").font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.hoInk)
                    Text(Copy.ghostLabel).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Color.cardMeta)
                }
            } else if let seller = listing.sellerId.flatMap({ store.users[$0] }) {
                Text(seller.avatarEmoji).font(.system(size: 26))
                    .frame(width: 46, height: 46)
                    .background(Circle().fill(Color.hoSunk))
                VStack(alignment: .leading, spacing: 3) {
                    Text(seller.displayName).font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.hoInk)
                    HStack(spacing: 6) {
                        ReliabilityBadge(reliability: seller.reliability)
                        Text("\(seller.reliability.completed) trades · \(seller.mutualFriendCount) mutuals")
                            .font(.system(size: 11.5, weight: .medium)).foregroundStyle(Color.cardMeta)
                    }
                }
            }
            Spacer()
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.hoCard))
    }

    @ViewBuilder private func ghostSection(_ listing: Listing) -> some View {
        // Original post preview, IG gradient frame
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(listing.source.authorHandle ?? "").font(.system(size: 13, weight: .semibold))
                Spacer()
                Text(listing.source.postedAgo ?? "").font(.system(size: 12, weight: .medium)).foregroundStyle(Color.cardMeta)
            }
            Text("“\(listing.source.postCaption ?? "")”")
                .font(.system(size: 17, weight: .medium))
            Text("View on Instagram ↗").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Color.hoAccentText)
        }
        .foregroundStyle(Color.hoInk)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.hoCard))

        Text("🔥 \(listing.interest?.count ?? 0) people want this")
            .font(.system(size: 19, weight: .bold)).foregroundStyle(Color.hoInk)

        BidBubbles(bids: store.bids[listing.id] ?? [], users: store.users)

        Text(Copy.ghostFineprint)
            .font(.system(size: 12, weight: .medium)).foregroundStyle(Color.cardMeta)
    }

    @ViewBuilder private func actionBar(_ listing: Listing) -> some View {
        HStack(spacing: 12) {
            if listing.isGhost {
                let wanted = store.myInterests.contains(listing.id)
                Button(wanted ? "You're in · we'll DM them ✓" : Copy.ghostCta) {
                    store.wantThis(listing.id)
                }
                .buttonStyle(.pill(.butter, full: true))
                .disabled(wanted)
            } else if listing.id == "l_owala" {
                VStack(spacing: 8) {
                    Button(Copy.buyCta) { payDirect = true }
                        .buttonStyle(.pill(.primary, full: true))
                    Text(Copy.buyNote).font(.system(size: 12, weight: .medium)).foregroundStyle(Color.cardMeta)
                }
            } else if listing.sellerId == store.me?.userId {
                if listing.id == "l_mouse", store.buyRequest != nil, !store.requestAccepted {
                    Button("Maya wants it · View request") { store.rootSheet = .request }
                        .buttonStyle(.pill(.butter, full: true))
                } else {
                    Text("This is your listing · \(store.requestAccepted ? "sold to Maya" : "live on the feed")")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(Color.cardMeta)
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                }
            } else {
                if listing.negotiable {
                    Button("Make offer") { openThread = true }
                        .buttonStyle(.pill(.outline, full: true))
                }
                Button("Buy now") { buying = true }
                    .buttonStyle(.pill(.primary, full: true))
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(Color.hoBg.overlay(alignment: .top) { Rectangle().fill(Color.cardDivider).frame(height: 1) })
    }
}

// MARK: - Haggle with AI (POST /listings/{id}/haggle)

/// The buyer chats with the seller's AI agent. JEV-9B triages each message on the laptop worker;
/// the API's keyword rules (or `OfflineAI` on the phone, when the API can't be reached) cover the rest.
struct HaggleChatSheet: View {
    let listing: Listing
    @Environment(\.dismiss) private var dismiss

    private struct Line: Identifiable {
        let id = UUID()
        let fromBuyer: Bool
        let text: String
        var response: HaggleResponse? = nil
    }

    @State private var lines: [Line] = []
    @State private var history: [HaggleTurn] = []
    @State private var lastCounterCents: Int?
    @State private var draft = ""
    @State private var sending = false
    @State private var engine: String?
    @State private var offlineReason: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            header
                            ForEach(lines) { line in
                                lineView(line).id(line.id)
                            }
                            if sending {
                                HStack(spacing: 8) {
                                    ProgressView().tint(Color.hoInk)
                                    Text("Seller's agent is thinking…")
                                        .font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Color.hoSoft)
                                }
                            }
                        }
                        .padding(18)
                    }
                    .onChange(of: lines.count) {
                        if let id = lines.last?.id { withAnimation { proxy.scrollTo(id, anchor: .bottom) } }
                    }
                }
                inputBar
            }
            .background(Color.hoBg.ignoresSafeArea())
            .navigationTitle("Haggle with AI")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: { Image(systemName: "xmark").fontWeight(.heavy) }.tint(Color.hoInk)
                }
            }
        }
        .presentationDetents([.large])
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            SheetTitle(kicker: "Seller's AI agent", title: listing.title)
            HStack(spacing: 8) {
                Text("Asking \(Money.format(listing.priceCents))")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Color.cardMeta)
                if let lastCounterCents {
                    Text("· Last counter \(Money.format(lastCounterCents))")
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(Color.cardMeta)
                }
                Spacer()
                if let engine { engineLabel(engine) }
            }
            if let offlineReason {
                Text("Live API unavailable (\(offlineReason)). Using on-phone rules.")
                    .font(.system(size: 11.5, weight: .medium)).foregroundStyle(Color.hoSoft)
            }
            if lines.isEmpty {
                Text("Ask a question or make an offer, like “Would you take $\(max(1, listing.priceCents * 8 / 10 / 100))?”")
                    .font(.system(size: 14, weight: .medium)).foregroundStyle(Color.hoSoft)
                    .padding(.top, 6)
            }
        }
    }

    private func engineLabel(_ engine: String) -> some View {
        let jev = engine == "jev"
        return Label(jev ? "JEV-9B on-device" : "rules", systemImage: jev ? "cpu" : "list.bullet")
            .font(.system(size: 10.5, weight: .heavy))
            .foregroundStyle(jev ? Color.hoInkOnLight : Color.hoInk)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(Capsule().fill(jev ? Color.hoMint : Color.hoSunk))
    }

    @ViewBuilder private func lineView(_ line: Line) -> some View {
        if line.fromBuyer {
            BubbleView(side: .me, text: line.text)
        } else if let r = line.response {
            VStack(alignment: .leading, spacing: 8) {
                if !r.scamFlags.isEmpty { safetyBanner(r) }
                BubbleView(side: .them, text: r.reply.isEmpty ? "…" : r.reply, tag: "Seller's agent")
                HStack(spacing: 8) {
                    HaggleActionBadge(action: r.action)
                    if let p = r.priceCents, r.action == "counter" || r.action == "hold_firm" {
                        Text(Money.format(p)).font(.system(size: 13, weight: .heavy)).monospacedDigit()
                            .foregroundStyle(Color.hoInk)
                    }
                }
                if let offer = r.proposedOffer {
                    Label("Offer sent at \(Money.format(offer.amountCents ?? r.priceCents ?? listing.priceCents))",
                          systemImage: "checkmark.seal.fill")
                        .font(.system(size: 13, weight: .heavy)).foregroundStyle(Color.hoInkOnLight)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(Capsule().fill(Color.hoMint))
                }
                if let d = r.decisions, !d.isEmpty { JEVWhy(decisions: d) }
            }
        }
    }

    private func safetyBanner(_ r: HaggleResponse) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.shield.fill").font(.system(size: 18, weight: .bold))
            VStack(alignment: .leading, spacing: 3) {
                Text("Possible scam").font(.system(size: 14, weight: .heavy))
                Text(r.scamFlags.map(Self.flagLabel).joined(separator: " · "))
                    .font(.system(size: 12.5, weight: .semibold))
                Text(r.reported == true ? "Reported to Handoff safety. Never pay outside the app." : "Never pay outside the app.")
                    .font(.system(size: 12, weight: .medium)).opacity(0.85)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(Color.white)
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.hoAccent))
    }

    private static func flagLabel(_ flag: String) -> String {
        switch flag {
        case "off_platform_payment": return "Off-platform payment"
        case "urgency_pressure": return "Urgency pressure"
        case "meetup_change": return "Meetup change"
        case "phishing": return "Phishing"
        default: return flag.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    private var trimmedDraft: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var inputBar: some View {
        HStack(spacing: 10) {
            TextField("Make an offer or ask a question", text: $draft, axis: .vertical)
                .lineLimit(1...4)
                .font(.system(size: 15))
                .foregroundStyle(Color.hoInk)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.hoCard))
            Button(action: send) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 16, weight: .heavy))
                    .foregroundStyle(Color.white)
                    .frame(width: 42, height: 42)
                    .background(Circle().fill(Color.hoAccent))
            }
            .buttonStyle(.plain)
            .disabled(trimmedDraft.isEmpty || sending)
            .opacity(trimmedDraft.isEmpty || sending ? 0.5 : 1)
        }
        .padding(.horizontal, 18).padding(.vertical, 10)
        .background(Color.hoBg.overlay(alignment: .top) { Rectangle().fill(Color.cardDivider).frame(height: 1) })
    }

    private func send() {
        let message = trimmedDraft
        guard !message.isEmpty, !sending else { return }
        draft = ""
        Haptics.tap()
        withAnimation(.snappy) { lines.append(Line(fromBuyer: true, text: message)) }
        sending = true
        let prior = Array(history.suffix(20))   // the API takes at most 20 turns
        let counter = lastCounterCents
        Task { @MainActor in
            let r: HaggleResponse
            do {
                r = try await AIAPI.haggle(listingId: listing.id, message: message, history: prior, lastCounterCents: counter)
                offlineReason = nil
            } catch {
                offlineReason = error.localizedDescription
                r = OfflineAI.haggle(askCents: listing.priceCents, negotiable: listing.negotiable,
                                     message: message, lastCounterCents: counter)
            }
            history += [HaggleTurn(from: "buyer", text: message), HaggleTurn(from: "seller", text: r.reply)]
            if r.action == "counter" || r.action == "hold_firm", let p = r.priceCents { lastCounterCents = p }
            engine = r.engine
            sending = false
            if r.action == "accept" { Haptics.success() } else { Haptics.soft() }
            withAnimation(.snappy) { lines.append(Line(fromBuyer: false, text: r.reply, response: r)) }
        }
    }
}

private struct HaggleActionBadge: View {
    let action: String
    var body: some View {
        let (label, fill, ink): (String, Color, Color) = switch action {
        case "accept": ("Accept", .hoMint, .hoInkOnLight)
        case "counter": ("Counter", .hoButter, .hoInkOnLight)
        case "hold_firm": ("Hold firm", .hoPeach, .hoInk)
        case "warn": ("Warn", .hoAccent, .white)
        case "ignore": ("Ignore", .hoSunk, .hoSoft)
        default: ("Reply", .hoCard, .hoInk)
        }
        Text(label)
            .font(.system(size: 10.5, weight: .heavy))
            .textCase(.uppercase)
            .foregroundStyle(ink)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Capsule().fill(fill))
            .overlay(Capsule().strokeBorder(Color.hoInk, lineWidth: 1.5))
    }
}

/// "Why (JEV)": each decision key → pick, with its value as a bar. Score questions (0–5) show the expected level.
private struct JEVWhy: View {
    let decisions: [String: JEVDecision]
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { withAnimation(.snappy) { open.toggle() } } label: {
                HStack(spacing: 4) {
                    Text("Why (JEV)").font(.system(size: 12, weight: .heavy))
                    Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 10, weight: .heavy))
                }
                .foregroundStyle(Color.hoAccentText)
            }
            .buttonStyle(.plain)
            if open {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(decisions.keys.sorted(), id: \.self) { key in
                        if let d = decisions[key] { row(key, d) }
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.hoCard))
            }
        }
    }

    private func row(_ key: String, _ d: JEVDecision) -> some View {
        let isScore = d.probabilities.map { Set($0.keys) == Set(["0", "1", "2", "3", "4", "5"]) } ?? false
        let fraction = min(max(isScore ? d.value / 5 : d.value, 0), 1)
        let valueText = isScore ? String(format: "%.1f / 5", d.value) : "\(Int((fraction * 100).rounded()))%"
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("\(key.replacingOccurrences(of: "_", with: " ")) → \(d.pick)")
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.hoInk)
                Spacer()
                Text(valueText).font(.system(size: 11.5, weight: .heavy)).monospacedDigit().foregroundStyle(Color.hoSoft)
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.hoSunk)
                    Capsule().fill(Color.hoMint).frame(width: g.size.width * fraction)
                }
            }
            .frame(height: 6)
        }
    }
}
