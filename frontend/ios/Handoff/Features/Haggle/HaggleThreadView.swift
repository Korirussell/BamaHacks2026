import SwiftUI

/// The iOS star (§11.4). Plays thread.json one message at a time.
struct HaggleThreadView: View {
    let listingId: String
    @Environment(AppStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var script: [ThreadMessage] = []
    @State private var shown: [ThreadMessage] = []
    @State private var amount = 5500
    @State private var typing = false
    @State private var agreed: Int?
    @State private var stickerIn = false
    @State private var paying = false
    @State private var busy = false
    @State private var openMeetup = false

    private var listing: Listing? { store.listing(listingId) }
    private var seller: UserPublic? { listing?.sellerId.flatMap { store.users[$0] } }
    private var sellerFirst: String { seller?.displayName.components(separatedBy: " ").first ?? "Seller" }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 14) {
                        Text(Copy.threadExpiry)
                            .font(.system(size: 11.5, weight: .heavy)).textCase(.uppercase)
                            .foregroundStyle(Color.hoSoft)
                            .padding(.top, 14)

                        ForEach(shown) { msg in
                            bubble(msg)
                                .transition(.asymmetric(insertion: .move(edge: msg.from == "me" ? .trailing : .leading)
                                    .combined(with: .opacity), removal: .opacity))
                        }
                        if typing {
                            TypingBubble(name: sellerFirst).transition(.opacity)
                        }
                        if let agreed {
                            AcceptedSticker(text: "\(sellerFirst) accepted \(Money.format(agreed)) ✓")
                                .scaleEffect(stickerIn ? 1 : 1.6)
                                .opacity(stickerIn ? 1 : 0)
                                .padding(.vertical, 10)
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 16)
                }
                .onChange(of: shown.count) { withAnimation { proxy.scrollTo("bottom") } }
                .onChange(of: typing) { withAnimation { proxy.scrollTo("bottom") } }
                .onChange(of: stickerIn) { withAnimation { proxy.scrollTo("bottom") } }
            }
            bottomBar
        }
        .background(Color.hoBg.ignoresSafeArea())
        .navigationTitle("Offer")
        .hidesTabBar()
            .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
            .toolbarBackground(Color.hoBg, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
        .task {
            if script.isEmpty, let t = try? await store.api.thread(id: "t_fridge") { script = t.messages }
        }
        .dealFlow(isPaying: $paying, openMeetup: $openMeetup, amountCents: agreed ?? 6500, listing: listing)
    }

    private var header: some View {
        HStack(spacing: 12) {
            if let listing {
                ItemTile(listing: listing, emojiSize: 30)
                    .frame(width: 56, height: 56)
                    .sticker(radius: 14, shadow: 3)
                VStack(alignment: .leading, spacing: 3) {
                    Text(listing.title).font(.display(17)).foregroundStyle(Color.hoInk)
                    HStack(spacing: 4) {
                        Text("Listed at \(Money.format(listing.priceCents)) · \(seller?.displayName ?? "")")
                            .font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Color.hoSoft)
                        if let seller {
                            Text("· " + (seller.reliability.badge == "top" ? "Top" : seller.reliability.badge.capitalized))
                                .font(.system(size: 12.5, weight: .heavy)).foregroundStyle(Color.hoAccentText)
                        }
                    }
                }
            }
            Spacer()
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(Color.hoCard.overlay(alignment: .bottom) { Rectangle().fill(Color.hoInk).frame(height: 2) })
    }

    @ViewBuilder private func bubble(_ msg: ThreadMessage) -> some View {
        BubbleView(side: msg.from == "me" ? .me : .them,
                   text: msg.text,
                   tag: msg.kind == "counter" ? "counter" : (msg.kind == "offer" ? "offer \(Money.format(msg.amountCents ?? 0))" : nil),
                   footer: msg.at)
    }

    @ViewBuilder private var bottomBar: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Color.hoInk).frame(height: 2)
            Group {
                if store.order != nil, store.order?.status != "awaiting_payment" {
                    Button(store.lockedMeetup == nil ? "Pick a handoff spot →" : "Meetup & handoff →") { openMeetup = true }
                        .buttonStyle(.pill(.butter, full: true))
                } else if let agreed {
                    Button(agreed == 6500 ? Copy.payCta : "Pay \(Money.format(agreed)) · held until handoff 🔒") {
                        paying = true
                    }
                    .buttonStyle(.pill(.primary, full: true))
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                } else {
                    HStack(spacing: 12) {
                        HStack(spacing: 0) {
                            stepButton("minus") { amount = max(100, amount - 100) }
                            Text(Money.format(amount))
                                .font(.display(22)).monospacedDigit()
                                .foregroundStyle(Color.hoInk)
                                .frame(minWidth: 64)
                                .contentTransition(.numericText(value: Double(amount)))
                            stepButton("plus") { amount += 100 }
                        }
                        .padding(4)
                        .capsuleSticker()

                        Button(busy ? "Waiting…" : "Send offer") { send() }
                            .buttonStyle(.pill(.primary, full: true))
                            .disabled(busy)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Color.hoBg)
        }
    }

    private func stepButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            withAnimation(.snappy) { action() }
        } label: {
            Image(systemName: icon).font(.system(size: 15, weight: .heavy))
                .foregroundStyle(Color.hoInk)
                .frame(width: 36, height: 36)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Script

    private func now() -> String {
        let f = DateFormatter(); f.dateFormat = "h:mm a"
        return f.string(from: .now)
    }

    private func send() {
        guard !busy else { return }
        busy = true
        Haptics.tap()
        let sent = amount
        let myScripted = script.filter { $0.from == "me" }
        let scriptedMine = myScripted.first { $0.amountCents == sent && !shown.contains($0) }
        let mine = scriptedMine ?? ThreadMessage(id: UUID().uuidString, from: "me", kind: "offer", amountCents: sent,
                                                text: "Would you take \(Money.format(sent))?", at: now())
        withAnimation(.spring(duration: 0.35)) { shown.append(mine) }

        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.2))
            withAnimation { typing = true }
            try? await Task.sleep(for: .seconds(1.3))
            withAnimation { typing = false }

            if sent >= 6500 {
                accept(sent)
                return
            }
            // Next scripted counter after my scripted offer, otherwise counter at $65.
            var reply: ThreadMessage
            if let mine = scriptedMine, let idx = script.firstIndex(of: mine),
               idx + 1 < script.count, script[idx + 1].from == "them" {
                reply = script[idx + 1]
            } else {
                reply = ThreadMessage(id: UUID().uuidString, from: "them", kind: "counter", amountCents: 6500,
                                      text: "$65 and it's yours", at: now())
            }
            withAnimation(.spring(duration: 0.35)) { shown.append(reply) }
            Haptics.soft()

            if reply.amountCents == 6500 {
                try? await Task.sleep(for: .seconds(0.9))
                accept(6500)
                return
            }
            // Jump the stepper to my next scripted amount so the demo is one tap.
            if let next = myScripted.first(where: { !shown.contains($0) })?.amountCents {
                withAnimation(.snappy) { amount = next }
            }
            busy = false
        }
    }

    private func accept(_ cents: Int) {
        withAnimation(.spring(duration: 0.4)) { agreed = cents }
        if reduceMotion {
            stickerIn = true
        } else {
            withAnimation(.spring(response: 0.45, dampingFraction: 0.55)) { stickerIn = true }
        }
        Haptics.success()
        store.agree(cents)
        busy = false
    }
}

struct TypingBubble: View {
    let name: String
    @State private var phase = 0.0
    var body: some View {
        HStack {
            HStack(spacing: 8) {
                HStack(spacing: 4) {
                    ForEach(0..<3) { i in
                        Circle().fill(Color.hoInk).frame(width: 7, height: 7)
                            .opacity(0.3 + 0.7 * max(0, sin(phase + Double(i) * 0.9)))
                    }
                }
                Text("\(name) is typing…").font(.system(size: 12, weight: .bold)).foregroundStyle(Color.hoSoft)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .sticker(radius: 18, shadow: 3)
            Spacer()
        }
        .onAppear { withAnimation(.linear(duration: 0.9).repeatForever(autoreverses: false)) { phase = .pi * 2 } }
    }
}

struct AcceptedSticker: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.display(20))
            .foregroundStyle(Color.hoInkOnLight)
            .padding(.horizontal, 18).padding(.vertical, 12)
            .capsuleSticker(fill: .hoButter, shadow: 4)
            .rotationEffect(.degrees(-3))
    }
}
