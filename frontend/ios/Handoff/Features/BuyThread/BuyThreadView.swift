import SwiftUI

/// features-v2 Flow B: Buy at Zoe's price → chat with the deal confirmed → I pick the spot in the chat →
/// Zoe confirms → It's good! → drop-off → locker code → I picked it up → Touchdown!
struct BuyThreadView: View {
    let listingId: String
    @Environment(AppStore.self) private var store

    enum Item: Identifiable, Equatable {
        case system(String, String)
        case me(String, String)
        case them(String, String)
        case spotPicker
        case calendar
        case locker
        case meetInPerson
        var id: String {
            switch self {
            case .system(let id, _), .me(let id, _), .them(let id, _): return id
            case .spotPicker: return "picker"
            case .calendar: return "calendar"
            case .locker: return "locker"
            case .meetInPerson: return "inperson"
            }
        }
    }

    enum Cover: Identifiable {
        case celebrate(Celebration), handoff
        var id: String { if case .celebrate(let c) = self { return c.id } else { return "handoff" } }
    }

    @State private var items: [Item] = []
    @State private var script: [ScriptLine] = []
    @State private var spots: [MeetupSuggestion] = []
    @State private var locker: Locker?
    @State private var selected = ""
    @State private var picked: MeetupSuggestion?
    @State private var typing = false
    @State private var cover: Cover?
    @State private var reviewing = false
    @State private var pickedUp = false
    @State private var started = false

    private var listing: Listing? { store.listing(listingId) }
    private var seller: UserPublic? { listing?.sellerId.flatMap { store.users[$0] } }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 14) {
                        ForEach(items) { item in
                            row(item).transition(.move(edge: .bottom).combined(with: .opacity))
                        }
                        if typing { TypingBubble(name: "Zoe").transition(.opacity) }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(16)
                }
                .onChange(of: items.count) { withAnimation { proxy.scrollTo("bottom") } }
                .onChange(of: typing) { withAnimation { proxy.scrollTo("bottom") } }
            }
        }
        .background(Color.hoBg.ignoresSafeArea())
        .navigationTitle("Zoe M.")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbarBackground(Color.hoBg, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .hidesTabBar()
        .task { await start() }
        .fullScreenCover(item: $cover) { c in
            switch c {
            case .celebrate(let cel):
                CelebrationView(celebration: cel) { celebrationDone() }
                    .presentationBackground(.clear)
            case .handoff:
                HandoffView(context: .zoe, meetup: picked)
            }
        }
        .sheet(isPresented: $reviewing) { ReviewSheet(partner: "Zoe") { reviewing = false } }
    }

    private var header: some View {
        HStack(spacing: 12) {
            if let listing {
                ItemTile(listing: listing, emojiSize: 28).frame(width: 52, height: 52).sticker(radius: 14, shadow: 3)
                VStack(alignment: .leading, spacing: 3) {
                    Text(listing.title).font(.display(17)).foregroundStyle(Color.hoInk)
                    Text("\(Money.format(listing.priceCents)) · held until it's in your hands 🔒")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.hoSoft)
                }
            }
            Spacer()
            Text(pickedUp ? "Done" : "Paid")
                .font(.system(size: 10.5, weight: .heavy)).textCase(.uppercase).foregroundStyle(Color.hoInkOnLight)
                .padding(.horizontal, 9).padding(.vertical, 4)
                .background(Capsule().fill(Color.hoMint))
                .overlay(Capsule().strokeBorder(Color.hoInk, lineWidth: 1.5))
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(Color.hoCard.overlay(alignment: .bottom) { Rectangle().fill(Color.hoInk).frame(height: 2) })
    }

    @ViewBuilder private func row(_ item: Item) -> some View {
        switch item {
        case .system(_, let text):
            Text(text)
                .font(.system(size: 13, weight: .heavy)).foregroundStyle(Color.hoInk)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .capsuleSticker(fill: .hoSunk, shadow: 2)
                .frame(maxWidth: .infinity)
        case .me(_, let text): BubbleView(side: .me, text: text)
        case .them(_, let text): BubbleView(side: .them, text: text, tag: "Zoe M.")
        case .spotPicker: spotPicker
        case .calendar:
            Text(Copy.calAddedZoe)
                .font(.system(size: 13, weight: .heavy)).foregroundStyle(Color.hoInkOnLight)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .capsuleSticker(fill: .hoMint)
                .frame(maxWidth: .infinity)
        case .locker:
            if let locker { LockerCard(locker: locker, placeName: store.place(locker.placeId)?.name ?? "", done: pickedUp) { pickUp() } }
        case .meetInPerson:
            if let m = picked {
                VStack(spacing: 10) {
                    Text("Meet Zoe · \(store.place(m.placeId)?.name ?? "") · \(m.startLabel)")
                        .font(.system(size: 14, weight: .heavy)).foregroundStyle(Color.hoInk)
                    Button("Go to handoff →") { cover = .handoff }
                        .buttonStyle(.pill(.primary, small: true, full: true))
                }
                .padding(14)
                .sticker(radius: 18, shadow: 3)
            }
        }
    }

    private var spotPicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            SheetTitle(kicker: "Pick the spot", title: "Where should Zoe hand it off?")
            ForEach(Array(spots.enumerated()), id: \.element.id) { i, m in
                SpotRow(index: i + 1, meetup: m, place: store.place(m.placeId), selected: m.id == selected)
                    .onTapGesture {
                        guard picked == nil else { return }
                        Haptics.tap()
                        withAnimation(.spring(duration: 0.3)) { selected = m.id }
                    }
            }
            if picked == nil, let m = spots.first(where: { $0.id == selected }) {
                Button("Pick \(store.place(m.placeId)?.name ?? "") →") { pick(m) }
                    .buttonStyle(.pill(.primary, full: true))
                    .padding(.top, 4)
            }
        }
        .padding(14)
        .sticker(radius: 22, shadow: 4)
    }

    // MARK: - Script (thread_zoe.json)

    private func line(_ id: String) -> ScriptLine? { script.first { $0.id == id } }

    private func append(_ item: Item) {
        withAnimation(.spring(duration: 0.35)) { items.append(item) }
    }

    private func start() async {
        guard !started else { return }
        started = true
        script = (try? await store.api.fixture("thread_zoe")) ?? []
        spots = (try? await store.api.fixture("meetups_zoe")) ?? []
        locker = try? await store.api.fixture("locker")
        selected = spots.first?.id ?? ""
        for l in script where l.after == nil {
            try? await Task.sleep(for: .milliseconds(max(l.delayMs, 250)))
            switch l.from {
            case "system": append(.system(l.id, l.text))
            case "spot_picker": append(.spotPicker)
            default: break
            }
        }
    }

    private func pick(_ m: MeetupSuggestion) {
        picked = m
        let name = store.place(m.placeId)?.name ?? ""
        append(.me("z4", m.placeId == "p_locker_ridgecrest" ? (line("z4")?.text ?? "") : "\(name) works for me"))
        Task { @MainActor in
            withAnimation { typing = true }
            try? await Task.sleep(for: .milliseconds(line("z5")?.delayMs ?? 1500))
            withAnimation { typing = false }
            append(.them("z5", m.isLocker ? (line("z5")?.text ?? "") : "Works for me 👍 see you there"))
            Haptics.soft()
            try? await Task.sleep(for: .milliseconds(600))
            let when = m.isLocker ? m.startLabel : m.startLabel
            celebrate(.fieldGoal(line: Copy.celebrateFGLocked(place: name, time: when)))
        }
    }

    private func celebrationDone() {
        if pickedUp {
            var t = Transaction(); t.disablesAnimations = true
            withTransaction(t) { cover = nil }
            store.addHistory(emoji: "🥤", title: "Owala FreeSip", partner: "Zoe M.", placeId: picked?.placeId ?? "p_locker_ridgecrest",
                             method: "locker", cents: listing?.priceCents ?? 1500, role: "bought")
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(450))
                reviewing = true
            }
            return
        }
        var t = Transaction(); t.disablesAnimations = true
        withTransaction(t) { cover = nil }
        guard let m = picked else { return }
        CalendarService.add(title: "Handoff: Owala FreeSip with Zoe", placeName: store.place(m.placeId)?.name ?? "", startISO: m.startIso)
        append(.calendar)
        if m.isLocker {
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(line("z6")?.delayMs ?? 4000))
                let place = store.place(locker?.placeId ?? m.placeId)?.name ?? ""
                append(.system("z6", "Zoe dropped it in Locker \(locker?.lockerNumber ?? 14) at \(place)"))
                locker?.status = "ready_for_pickup"
                store.fire(notification: "n5")
                try? await Task.sleep(for: .milliseconds(400))
                append(.locker)
            }
        } else {
            append(.meetInPerson)
        }
    }

    /// Present without the cover slide; CelebrationView fades itself in (§8.2).
    private func celebrate(_ c: Celebration) {
        var t = Transaction(); t.disablesAnimations = true
        withTransaction(t) { cover = .celebrate(c) }
    }

    private func pickUp() {
        pickedUp = true
        locker?.status = "picked_up"
        celebrate(.touchdown(line: Copy.tdLocker))
    }
}

/// features-v2 §4: locker number + 4-digit pickup code in outlined boxes.
struct LockerCard: View {
    let locker: Locker
    let placeName: String
    let done: Bool
    var onPickedUp: () -> Void
    @State private var openedAt = Date.now

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(Copy.lockerReady).font(.display(21)).foregroundStyle(Color.hoInk)
                    Text("Locker \(locker.lockerNumber) · \(placeName)").font(.system(size: 13, weight: .bold)).foregroundStyle(Color.hoSoft)
                }
                Spacer()
                VStack(spacing: 0) {
                    Text("LOCKER").font(.system(size: 9, weight: .heavy))
                    Text("\(locker.lockerNumber)").font(.display(34))
                }
                .foregroundStyle(.white)
                .frame(width: 70, height: 70)
                .background(RoundedRectangle(cornerRadius: 16).fill(Color.hoAccent))
                .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.hoInk, lineWidth: 2))
                .background(RoundedRectangle(cornerRadius: 16).fill(Color.hoShadow).offset(x: 3, y: 3))
            }

            Text(Copy.lockerCode.uppercased()).font(.system(size: 11, weight: .heavy)).foregroundStyle(Color.hoSoft)
            HStack(spacing: 10) {
                ForEach(Array(locker.pickupCode.enumerated()), id: \.offset) { i, d in
                    Text(String(d))
                        .font(.display(44)).foregroundStyle(i == 0 ? Color.hoInkOnLight : Color.hoInk)
                        .frame(maxWidth: .infinity).frame(height: 70)
                        .sticker(radius: 14, shadow: 3, fill: i == 0 ? .hoButter : .hoCard)
                }
            }

            HStack {
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    let left = max(0, locker.expiresInSeconds - Int(ctx.date.timeIntervalSince(openedAt)))
                    Text(String(format: "Code expires in %02d:%02d:%02d", left / 3600, left / 60 % 60, left % 60))
                        .font(.system(size: 12.5, weight: .bold)).monospacedDigit().foregroundStyle(Color.hoSoft)
                }
                Spacer()
                Button("Copy code") {
                    UIPasteboard.general.string = locker.pickupCode
                    Haptics.tap()
                }
                .buttonStyle(.pill(.neutral, small: true))
            }

            Button(done ? "Picked up ✓" : Copy.lockerDone, action: onPickedUp)
                .buttonStyle(.pill(.primary, full: true))
                .disabled(done)
        }
        .padding(16)
        .sticker(radius: 22, shadow: 5)
    }
}
