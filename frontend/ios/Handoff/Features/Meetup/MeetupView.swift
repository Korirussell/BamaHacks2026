import SwiftUI

/// Sticker map + 3 handoff spots (§7.5, §11.6). Shows meetups.json exactly.
struct MeetupView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var selected: String = "mu1"
    @State private var celebration: Celebration?
    @State private var locked = false
    @State private var showHandoff = false

    private var current: MeetupSuggestion? { store.meetups.first { $0.id == selected } }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottom) {
                StickerMapView(places: store.places, meetups: store.meetups, selected: selected)
                    .frame(height: geo.size.height * 0.5 + 40)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .ignoresSafeArea(edges: .top)

                panel
                    .frame(height: geo.size.height * 0.62)
            }
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
        }
        .background(Color.hoBg.ignoresSafeArea())
        .task {
            if store.meetups.isEmpty { store.meetups = (try? await store.api.meetups(orderId: "o_fridge")) ?? [] }
            Haptics.success()
        }
        .overlay(alignment: .top) { ToastView() }
        .celebrationOverlay($celebration) { withAnimation { locked = true } }
        .fullScreenCover(isPresented: $showHandoff) { HandoffView() }
    }

    private var panel: some View {
        VStack(alignment: .leading, spacing: 14) {
            Capsule().fill(Color.hoSoft.opacity(0.5)).frame(width: 40, height: 5)
                .frame(maxWidth: .infinity)
            SheetTitle(kicker: "Deal at \(Money.format(store.order?.amountCents ?? 6500)) 🤝", title: Copy.meetupTitle)

            if store.meetups.isEmpty {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 16).fill(Color.hoSunk).frame(height: 62)
                }
            } else {
                ForEach(Array(store.meetups.enumerated()), id: \.element.id) { i, m in
                    SpotRow(index: i + 1, meetup: m, place: store.place(m.placeId), selected: m.id == selected)
                        .onTapGesture {
                            guard !locked else { return }
                            Haptics.tap()
                            withAnimation(.spring(duration: 0.3)) { selected = m.id }
                        }
                }
            }
            Spacer(minLength: 0)

            if locked, let m = store.lockedMeetup {
                VStack(spacing: 10) {
                    Text("Meet Kayla · \(store.place(m.placeId)?.name ?? "") · \(m.startLabel)")
                        .font(.system(size: 14, weight: .heavy)).foregroundStyle(Color.hoInk)
                    HStack(spacing: 10) {
                        Button("Add to calendar") { store.show(toast: "Added") }
                            .buttonStyle(.pill(.neutral, small: true))
                        Button("Go to handoff →") { showHandoff = true }
                            .buttonStyle(.pill(.primary, small: true, full: true))
                    }
                }
            } else {
                Button(Copy.meetupLock(current?.startLabel.replacingOccurrences(of: " PM", with: "")
                    .replacingOccurrences(of: " AM", with: "") ?? "3:30")) {
                    guard let m = current else { return }
                    store.lock(m)
                    celebration = .fieldGoal(line: Copy.celebrateFGLocked(place: store.place(m.placeId)?.name ?? "", time: m.startLabel))
                }
                .buttonStyle(.pill(.primary, full: true))
                .disabled(current == nil)
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 10)
        .padding(.bottom, 12)
        .background(
            UnevenRoundedRectangle(topLeadingRadius: 28, topTrailingRadius: 28)
                .fill(Color.hoBg)
                .overlay(UnevenRoundedRectangle(topLeadingRadius: 28, topTrailingRadius: 28)
                    .stroke(Color.hoInk, lineWidth: 2))
                .ignoresSafeArea(edges: .bottom)
        )
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
            Text(meetup.startLabel)
                .font(.system(size: 14.5, weight: .heavy)).monospacedDigit()
                .frame(width: 66, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(place?.name ?? "").font(.system(size: 13, weight: .bold))
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

struct StickerMapView: View {
    let places: [Place]
    let meetups: [MeetupSuggestion]
    let selected: String

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let sel = meetups.first { $0.id == selected }.flatMap { m in places.first { $0.id == m.placeId } }
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
                ForEach(Array(meetups.enumerated()), id: \.element.id) { i, m in
                    if let p = places.first(where: { $0.id == m.placeId }) {
                        let r = rect(p, w, h)
                        Pin(number: i + 1)
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

    // Places only use the top ~60% of the box; spread them over the visible map area.
    private func rect(_ p: Place, _ w: CGFloat, _ h: CGFloat) -> CGRect {
        let top: CGFloat = 70, usable = h - top - 10
        let yScale = usable / 0.62
        return CGRect(x: p.map.x / 100 * w, y: top + (p.map.y - 6) / 100 * yScale,
                      width: p.map.w / 100 * w, height: max(26, p.map.h / 100 * yScale))
    }
}

private struct Pin: View {
    let number: Int
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
            Text("\(number)")
                .font(.system(size: 13, weight: .heavy)).foregroundStyle(.white)
                .offset(y: -4)
        }
    }
}
