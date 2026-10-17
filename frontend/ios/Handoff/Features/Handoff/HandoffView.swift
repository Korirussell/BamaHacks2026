import SwiftUI
import CoreImage.CIFilterBuiltins

/// Rotating QR handoff (§11.7, §12).
struct HandoffView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var role = "buyer"
    @State private var code = ""
    @State private var celebration: Celebration?
    @State private var reviewing = false

    private var orderId: String { store.order?.id ?? "o_fridge" }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    HStack(spacing: 0) {
                        ForEach([("buyer", "I'm the buyer"), ("seller", "I'm the seller")], id: \.0) { key, label in
                            Button {
                                Haptics.tap()
                                withAnimation(.snappy) { role = key }
                            } label: {
                                Text(label)
                                    .font(.system(size: 13, weight: .heavy)).textCase(.uppercase)
                                    .foregroundStyle(role == key ? Color.hoBg : Color.hoInk)
                                    .frame(maxWidth: .infinity).padding(.vertical, 11)
                                    .background(Capsule().fill(role == key ? Color.hoInk : Color.clear))
                                    .contentShape(Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(4)
                    .capsuleSticker()

                    if let m = store.lockedMeetup {
                        Text("\(store.place(m.placeId)?.name ?? "") · \(m.startLabel)")
                            .font(.system(size: 13, weight: .heavy)).foregroundStyle(Color.hoSoft)
                    }

                    if role == "seller" { sellerView } else { buyerView }
                }
                .padding(20)
            }
            .background(Color.hoBg.ignoresSafeArea())
            .navigationTitle("Make the handoff")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: { Image(systemName: "xmark").fontWeight(.heavy) }
                        .tint(Color.hoInk)
                }
            }
        }
        .overlay(alignment: .top) { ToastView() }
        .celebrationOverlay($celebration) {
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(400))
                reviewing = true
            }
        }
        .sheet(isPresented: $reviewing) {
            ReviewSheet { reviewing = false; dismiss() }
        }
    }

    private var sellerView: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            let minute = Int(ctx.date.timeIntervalSince1970 / 60)
            let remaining = 60 - Int(ctx.date.timeIntervalSince1970) % 60
            let token = HandoffToken.token(orderId: orderId, minute: minute)
            VStack(spacing: 18) {
                Text(Copy.qrGiver).font(.display(24)).foregroundStyle(Color.hoInk)
                ZStack {
                    Circle().stroke(Color.hoSunk, lineWidth: 10)
                    Circle()
                        .trim(from: 0, to: CGFloat(remaining) / 60)
                        .stroke(Color.hoAccent, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .animation(.linear(duration: 1), value: remaining)
                    QRImage(text: token)
                        .frame(width: 180, height: 180)
                        .padding(12)
                        .sticker(radius: 18, shadow: 4, fill: .white)
                        .id(minute)
                        .transition(.asymmetric(insertion: .scale(scale: 0.6).combined(with: .opacity), removal: .opacity))
                }
                .frame(width: 290, height: 290)
                .animation(.spring(duration: 0.4), value: minute)

                Text(HandoffToken.code(token).map(String.init).joined(separator: " "))
                    .font(.display(34)).monospacedDigit()
                    .foregroundStyle(Color.hoInk)
                Text("New code in \(remaining)s").font(.system(size: 12.5, weight: .bold)).foregroundStyle(Color.hoSoft)
            }
        }
    }

    private var buyerView: some View {
        VStack(spacing: 18) {
            Text(Copy.qrReceiver).font(.display(24)).foregroundStyle(Color.hoInk)
            ZStack {
                RoundedRectangle(cornerRadius: 24).fill(Color.black.opacity(0.85))
                CornerBrackets().stroke(Color.hoButter, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                    .padding(30)
                Text("Point at Kayla's code").font(.system(size: 13, weight: .bold)).foregroundStyle(.white.opacity(0.7))
            }
            .frame(height: 260)
            .overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(Color.hoInk, lineWidth: 2))
            .background(RoundedRectangle(cornerRadius: 24).fill(Color.hoShadow).offset(x: 4, y: 4))

            HStack(spacing: 10) {
                TextField("6-digit code", text: $code)
                    .keyboardType(.numberPad)
                    .font(.system(size: 17, weight: .bold)).monospacedDigit()
                    .padding(.horizontal, 16).padding(.vertical, 12)
                    .capsuleSticker()
                Button("Confirm") { confirm(code: code) }
                    .buttonStyle(.pill(.neutral, small: true))
            }

            Button(Copy.qrOverride) { complete() }
                .buttonStyle(.pill(.primary, full: true))
        }
    }

    private func confirm(code: String) {
        let minute = Int(Date().timeIntervalSince1970 / 60)
        let valid = [minute, minute - 1].map { HandoffToken.code(HandoffToken.token(orderId: orderId, minute: $0)) }
        if valid.contains(code.filter(\.isNumber)) { complete() } else { store.show(toast: "That code didn't match. Try again.") }
    }

    private func complete() {
        store.completeHandoff()
        celebration = .touchdown(line: Copy.celebrateTDDone)
    }
}

enum HandoffToken {
    static func token(orderId: String, minute: Int) -> String { "HO-\(orderId)-\(minute)" }
    /// Stable djb2 hash → last 6 digits.
    static func code(_ token: String) -> String {
        var h: UInt64 = 5381
        for b in token.utf8 { h = (h &* 33) &+ UInt64(b) }
        return String(format: "%06d", Int(h % 1_000_000))
    }
}

struct QRImage: View {
    let text: String
    var body: some View {
        if let img = Self.make(text) {
            Image(uiImage: img).interpolation(.none).resizable().scaledToFit()
        }
    }
    static func make(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let out = filter.outputImage?.transformed(by: .init(scaleX: 10, y: 10)),
              let cg = CIContext().createCGImage(out, from: out.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

private struct CornerBrackets: Shape {
    func path(in r: CGRect) -> Path {
        let l: CGFloat = 34
        var p = Path()
        for (pt, dx, dy) in [(CGPoint(x: r.minX, y: r.minY), 1.0, 1.0), (CGPoint(x: r.maxX, y: r.minY), -1.0, 1.0),
                             (CGPoint(x: r.minX, y: r.maxY), 1.0, -1.0), (CGPoint(x: r.maxX, y: r.maxY), -1.0, -1.0)] {
            p.move(to: CGPoint(x: pt.x, y: pt.y + dy * l)); p.addLine(to: pt); p.addLine(to: CGPoint(x: pt.x + dx * l, y: pt.y))
        }
        return p
    }
}

struct ReviewSheet: View {
    var onDone: () -> Void
    @Environment(AppStore.self) private var store
    @State private var stars = 5
    @State private var onTime = true
    @State private var asDescribed = true

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SheetTitle(kicker: "Clean handoff", title: "How was Kayla?")
            HStack(spacing: 10) {
                ForEach(1...5, id: \.self) { i in
                    Button {
                        Haptics.tap(); stars = i
                    } label: {
                        Image(systemName: i <= stars ? "star.fill" : "star")
                            .font(.system(size: 30, weight: .bold))
                            .foregroundStyle(i <= stars ? Color.hoButter : Color.hoSoft)
                            .shadow(color: .hoInk, radius: 0, x: 1.5, y: 1.5)
                    }
                    .buttonStyle(.plain)
                }
            }
            Toggle("On time", isOn: $onTime).font(.system(size: 15, weight: .bold))
            Toggle("As described", isOn: $asDescribed).font(.system(size: 15, weight: .bold))
            Button("Send review") {
                store.show(toast: "Thanks! Review sent ⭐️")
                onDone()
            }
            .buttonStyle(.pill(.primary, full: true))
        }
        .tint(.hoAccent)
        .foregroundStyle(Color.hoInk)
        .padding(22)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Color.hoBg.ignoresSafeArea())
        .presentationDetents([.medium])
        .presentationCornerRadius(28)
    }
}
