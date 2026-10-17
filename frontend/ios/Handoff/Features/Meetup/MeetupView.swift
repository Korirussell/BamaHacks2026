import SwiftUI

/// Who the meetup is with and what happens around it. One screen for Kayla (haggle demo) and Maya (Flow A).
struct MeetupContext {
    let fixture: String
    let partner: String
    let amountLabel: String
    let waitForPartner: Bool
    let calendarChip: String?
    let calendarTitle: String
    let handoff: HandoffContext
    let isKayla: Bool

    static let kayla = MeetupContext(fixture: "meetups", partner: "Kayla", amountLabel: "$65", waitForPartner: false,
                                     calendarChip: nil, calendarTitle: "Handoff: Mini fridge with Kayla",
                                     handoff: .kayla, isKayla: true)
    static let maya = MeetupContext(fixture: "meetups_maya", partner: "Maya", amountLabel: "$25", waitForPartner: true,
                                    calendarChip: Copy.calAdded, calendarTitle: "Handoff: Logitech mouse with Maya",
                                    handoff: .maya, isKayla: false)
}

/// Sticker map + 3 handoff spots (§7.5, §11.6, features-v2 Flow A step 7).
struct MeetupView: View {
    var context: MeetupContext = .kayla
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var meetups: [MeetupSuggestion] = []
    @State private var selected: String = ""
    @State private var celebration: Celebration?
    @State private var locked: MeetupSuggestion?
    @State private var waiting = false
    @State private var confirmed = false
    @State private var showHandoff = false

    private var current: MeetupSuggestion? { meetups.first { $0.id == selected } }

    var body: some View {
        MapContainer(mode: .meetup, dataKey: context.fixture, interactive: true,
                     selectedPillarId: selected.isEmpty ? nil : selected,
                     onPillarTap: { id in
                         guard locked == nil, !waiting else { return }
                         Haptics.tap()
                         withAnimation(.spring(duration: 0.3)) { selected = id }
                     },
                     fallback: {
                         StickerMapView(places: store.places,
                                        pins: meetups.map { .init(id: $0.id, placeId: $0.placeId) },
                                        selected: selected)
                     })
            .ignoresSafeArea()
            .overlay(alignment: .topLeading) {
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 15, weight: .heavy))
                        .foregroundStyle(Color.hoInk)
                        .frame(width: 40, height: 40)
                        .background(Circle().fill(Color.hoCard))
                        .overlay(Circle().strokeBorder(Color.hoInk, lineWidth: 2))
                        .background(Circle().fill(Color.hoShadow).offset(x: 3, y: 3))
                }
                .buttonStyle(PressableStyle())
                .padding(.leading, 16).padding(.top, 4)
            }
            .sheet(isPresented: .constant(true)) {
                panel
                    .presentationDetents([.medium, .large])
                    .presentationBackgroundInteraction(.enabled(upThrough: .medium))
                    .presentationDragIndicator(.visible)
                    .presentationCornerRadius(28)
                    .interactiveDismissDisabled()
            }
        .background(Color.hoBg.ignoresSafeArea())
        .task {
            if meetups.isEmpty {
                try? await Task.sleep(for: .milliseconds(Int.random(in: 300...800)))
                meetups = (try? await store.api.fixture(context.fixture)) ?? []
                selected = meetups.first?.id ?? ""
                if context.isKayla { store.meetups = meetups }
            }
            Haptics.success()
        }
        .overlay(alignment: .top) { ToastView() }
        .celebrationOverlay($celebration) {
            if let m = locked, context.calendarChip != nil {
                CalendarService.add(title: context.calendarTitle, placeName: store.place(m.placeId)?.name ?? "", startISO: m.startIso)
            }
        }
        .fullScreenCover(isPresented: $showHandoff) {
            HandoffView(context: context.handoff, meetup: locked)
        }
    }

    private var panel: some View {
        VStack(alignment: .leading, spacing: 14) {
            SheetTitle(kicker: "Deal at \(context.isKayla ? Money.format(store.order?.amountCents ?? 6500) : context.amountLabel) 🤝",
                       title: Copy.meetupTitle)
            if context.waitForPartner && locked == nil {
                Text(Copy.pickYou).font(.system(size: 12.5, weight: .bold)).foregroundStyle(Color.hoSoft)
            }

            if meetups.isEmpty {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 16).fill(Color.hoSunk).frame(height: 62)
                }
            } else {
                ForEach(Array(meetups.enumerated()), id: \.element.id) { i, m in
                    SpotRow(index: i + 1, meetup: m, place: store.place(m.placeId), selected: m.id == selected)
                        .onTapGesture {
                            guard locked == nil, !waiting else { return }
                            Haptics.tap()
                            withAnimation(.spring(duration: 0.3)) { selected = m.id }
                        }
                }
            }
            Spacer(minLength: 0)

            if let m = locked, confirmed {
                VStack(spacing: 10) {
                    if let chip = context.calendarChip {
                        Text(chip)
                            .font(.system(size: 13, weight: .heavy)).foregroundStyle(Color.hoInkOnLight)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .capsuleSticker(fill: .hoMint)
                    }
                    Text("Meet \(context.partner) · \(store.place(m.placeId)?.name ?? "") · \(m.startLabel)")
                        .font(.system(size: 14, weight: .heavy)).foregroundStyle(Color.hoInk)
                    HStack(spacing: 10) {
                        if context.calendarChip == nil {
                            Button("Add to calendar") {
                                CalendarService.add(title: context.calendarTitle, placeName: store.place(m.placeId)?.name ?? "", startISO: m.startIso)
                                store.show(toast: "📅 Added")
                            }
                            .buttonStyle(.pill(.neutral, small: true))
                        }
                        Button("Go to handoff →") { showHandoff = true }
                            .buttonStyle(.pill(.primary, full: true))
                    }
                }
            } else if waiting {
                HStack(spacing: 10) {
                    ProgressView().tint(Color.hoInk)
                    Text(Copy.pickWaiting).font(.system(size: 14, weight: .heavy)).foregroundStyle(Color.hoInk)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .capsuleSticker(fill: .hoSunk)
            } else {
                Button(Copy.meetupLock(shortTime(current?.startLabel ?? "3:30"))) { lock() }
                    .buttonStyle(.pill(.primary, full: true))
                    .disabled(current == nil)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .padding(.horizontal, 18)
        .padding(.top, 10)
        .padding(.bottom, 12)
        .background(Color.hoBg.ignoresSafeArea(edges: .bottom))
    }

    /// "3:30 PM" → "3:30", "Tue 12:15 PM" → "Tue 12:15".
    private func shortTime(_ label: String) -> String {
        label.replacingOccurrences(of: " PM", with: "").replacingOccurrences(of: " AM", with: "")
    }

    private func lock() {
        guard let m = current else { return }
        let line = Copy.celebrateFGLocked(place: store.place(m.placeId)?.name ?? "", time: m.startLabel)
        if context.isKayla { store.lock(m) } else { store.mayaMeetup = m }
        if context.waitForPartner {
            withAnimation { waiting = true }
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(1.5))
                store.show(toast: Copy.pickConfirmed)
                withAnimation { waiting = false; locked = m; confirmed = true }
                celebration = .fieldGoal(line: line)
            }
        } else {
            withAnimation { locked = m; confirmed = true }
            celebration = .fieldGoal(line: line)
        }
    }
}

struct SpotRow: View {
    let index: Int
    let meetup: MeetupSuggestion
    let place: Place?
    let selected: Bool

    var body: some View {
        HStack(spacing: 12) {
            Text("\(index)")
                .font(.system(size: 13, weight: .heavy)).foregroundStyle(.white)
                .frame(width: 26, height: 26)
                .background(Circle().fill(Color.hoAccent))
                .overlay(Circle().strokeBorder(Color.hoInk, lineWidth: 2))
            if !meetup.isLocker {
                Text(meetup.startLabel)
                    .font(.system(size: 14.5, weight: .heavy)).monospacedDigit()
                    .lineLimit(2).minimumScaleFactor(0.8)
                    .frame(width: 70, alignment: .leading)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text((meetup.isLocker ? "🔐 " : "") + (place?.name ?? "")).font(.system(size: 13, weight: .bold))
                if meetup.isLocker {
                    Text("Drop off by 6:00 PM · pick up anytime").font(.system(size: 11, weight: .semibold))
                }
                Text(meetup.reason).font(.system(size: 11)).opacity(0.75)
            }
            Spacer(minLength: 4)
            Text("\(meetup.walkMinutes.me) min / \(meetup.walkMinutes.them) min")
                .font(.system(size: 11, weight: .bold)).monospacedDigit()
                .multilineTextAlignment(.trailing)
        }
        .foregroundStyle(selected ? Color.hoInkOnLight : Color.hoInk)
        .padding(.horizontal, 12).padding(.vertical, 11)
        .sticker(radius: 16, shadow: selected ? 4 : 0, fill: selected ? .hoButter : .hoCard)
    }
}

/// Native flat map — the web-map fallback everywhere (map-plan.md §5) and the standalone
/// map used inline in the meetup sheet before that.
struct StickerMapView: View {
    /// Decoupled from `MeetupSuggestion` so this same view can plot history pins, locker pins, etc.
    struct PinRef: Identifiable { let id: String; let placeId: String }

    let places: [Place]
    let pins: [PinRef]
    var selected: String = ""
    /// When set: ignore `pins`/`selected` and render one place framed up close, camera-on-it style.
    var focusPlaceId: String? = nil

    var body: some View {
        if let focusPlaceId, let place = places.first(where: { $0.id == focusPlaceId }) {
            focusedView(place)
        } else {
            campusGrid
        }
    }

    private var campusGrid: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let sel = pins.first { $0.id == selected }.flatMap { m in places.first { $0.id == m.placeId } }
            ZStack(alignment: .topLeading) {
                Color.hoMapGround
                Canvas { ctx, size in
                    var x: CGFloat = 38
                    while x < size.width {
                        ctx.fill(Path(CGRect(x: x, y: 0, width: 10, height: size.height)), with: .color(.hoMapRoad))
                        x += 76
                    }
                    var y: CGFloat = 50
                    while y < size.height {
                        ctx.fill(Path(CGRect(x: 0, y: y, width: size.width, height: 10)), with: .color(.hoMapRoad))
                        y += 76
                    }
                }
                ForEach(places) { p in
                    let r = rect(p, w, h)
                    Text(p.name.uppercased())
                        .font(.system(size: 9, weight: .heavy))
                        .foregroundStyle(Color.hoInk)
                        .lineLimit(1).minimumScaleFactor(0.6)
                        .padding(.horizontal, 4)
                        .frame(width: r.width, height: r.height)
                        .background(RoundedRectangle(cornerRadius: 6).fill(p.isSafeZone ? Color.hoCard : Color.hoSunk))
                        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.hoInk, lineWidth: 2))
                        .background(RoundedRectangle(cornerRadius: 6).fill(Color.hoShadow).offset(x: 3, y: 3))
                        .offset(x: r.minX, y: r.minY)
                }
                ForEach(Array(pins.enumerated()), id: \.element.id) { i, m in
                    if let p = places.first(where: { $0.id == m.placeId }) {
                        let r = rect(p, w, h)
                        CampusPinMarker(number: i + 1)
                            .scaleEffect(m.id == selected ? 1.15 : 1, anchor: .bottom)
                            .animation(.spring(duration: 0.3), value: selected)
                            .position(x: r.midX, y: r.minY - 18)
                            .zIndex(m.id == selected ? 2 : 1)
                    }
                }
            }
            .offset(x: sel.map { (50 - ($0.map.x + $0.map.w / 2)) / 100 * w * 0.12 } ?? 0,
                    y: sel.map { (35 - ($0.map.y + $0.map.h / 2)) / 100 * h * 0.12 } ?? 0)
            .animation(.spring(duration: 0.5), value: selected)
        }
        .background(Color.hoMapGround)
        .clipped()
    }

    private func focusedView(_ place: Place) -> some View {
        ZStack {
            Color.hoMapGround
            VStack(spacing: 10) {
                CampusPinMarker(number: nil)
                Text(place.name.uppercased())
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundStyle(Color.hoInk)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.hoCard))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.hoInk, lineWidth: 2))
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.hoShadow).offset(x: 3, y: 3))
            }
        }
        .clipped()
    }

    // Places only use the top ~60% of the box; spread them over the visible map area.
    private func rect(_ p: Place, _ w: CGFloat, _ h: CGFloat) -> CGRect {
        let top: CGFloat = 70, usable = h - top - 10
        let maxY = places.map { $0.map.y + $0.map.h }.max() ?? 68
        let yScale = usable / max(0.62, (maxY - 6) / 100)
        return CGRect(x: p.map.x / 100 * w, y: top + (p.map.y - 6) / 100 * yScale,
                      width: p.map.w / 100 * w, height: max(26, p.map.h / 100 * yScale))
    }
}

struct CampusPinMarker: View {
    var number: Int?
    var body: some View {
        ZStack {
            Image(systemName: "drop.fill")
                .resizable().scaledToFit()
                .rotationEffect(.degrees(180))
                .foregroundStyle(Color.hoAccent)
                .frame(width: 30, height: 38)
                .overlay(
                    Image(systemName: "drop")
                        .resizable().scaledToFit()
                        .rotationEffect(.degrees(180))
                        .fontWeight(.bold)
                        .foregroundStyle(Color.hoInk)
                        .frame(width: 30, height: 38)
                )
            if let number {
                Text("\(number)")
                    .font(.system(size: 13, weight: .heavy)).foregroundStyle(.white)
                    .offset(y: -4)
            }
        }
    }
}
