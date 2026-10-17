import SwiftUI

// Celebrations were Katelyn's idea 🏈 — football moments only on success
// (Touchdown! / It's good!). These are the ONLY football graphics in the app.
// Spec: frontend-build.md §8.
struct CelebrationView: View {
    let celebration: Celebration
    var onDone: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var flown = false
    @State private var showHeadline = false
    @State private var showLine = false
    @State private var showDone = false
    @State private var confettiGo = false
    @State private var appeared = false

    private var isTouchdown: Bool { if case .touchdown = celebration { true } else { false } }
    private var title: String { isTouchdown ? Copy.celebrateTD : Copy.celebrateFG }
    private var line: String {
        switch celebration {
        case .touchdown(let l), .fieldGoal(let l): return l
        }
    }

    var body: some View {
        ZStack {
            Color.hoAccent.ignoresSafeArea()

            if !reduceMotion { Confetti(go: confettiGo) }

            VStack(spacing: 22) {
                Spacer()
                ZStack {
                    Goalpost()
                    Football()
                        .frame(width: 32, height: 20)
                        .scaleEffect(flown ? 0.6 : 1.6)
                        .rotationEffect(.degrees(flown ? 720 : 0))
                        .position(x: 100, y: flown ? 58 : 420)
                }
                .frame(width: 200, height: 220)

                ZStack(alignment: .topTrailing) {
                    Text(title)
                        .font(.display(46))
                        .displayTracking(46)
                        .foregroundStyle(Color.hoOnAccent)
                    Text(isTouchdown ? "+6" : "+3")
                        .font(.display(16))
                        .foregroundStyle(Color.hoInkOnLight)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Capsule().fill(Color.hoButter))
                        .overlay(Capsule().strokeBorder(Color.hoInkOnLight, lineWidth: 2))
                        .rotationEffect(.degrees(8))
                        .offset(x: 30, y: -18)
                }
                .scaleEffect(showHeadline ? 1 : 0.3)
                .opacity(showHeadline ? 1 : 0)

                Text(line)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(Color.hoOnAccent)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .opacity(showLine ? 1 : 0)
                    .offset(y: showLine ? 0 : 10)

                Spacer()

                Button(Copy.celebrateDone, action: onDone)
                    .buttonStyle(PillButtonStyle(kind: .butter, fullWidth: true))
                    .padding(.horizontal, 40)
                    .padding(.bottom, 30)
                    .opacity(showDone ? 1 : 0)
                    .scaleEffect(showDone ? 1 : 0.8)
            }
        }
        .opacity(appeared ? 1 : 0)
        .scaleEffect(appeared ? 1 : 1.04)
        .onAppear {
            withAnimation(.easeOut(duration: 0.2)) { appeared = true }
            run()
        }
    }

    private func run() {
        if reduceMotion {
            flown = true; showHeadline = true; showLine = true; showDone = true
            Haptics.success()
            return
        }
        withAnimation(.easeOut(duration: 0.95)) { flown = true }
        confettiGo = true
        withAnimation(.spring(response: 0.4, dampingFraction: 0.5).delay(0.8)) { showHeadline = true }
        withAnimation(.easeOut(duration: 0.3).delay(0.95)) { showLine = true }
        withAnimation(.spring(response: 0.35, dampingFraction: 0.6).delay(1.05)) { showDone = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.95) { Haptics.success() }
    }
}

private struct Goalpost: View {
    var body: some View {
        Path { p in
            p.move(to: CGPoint(x: 55, y: 10)); p.addLine(to: CGPoint(x: 55, y: 120))
            p.addLine(to: CGPoint(x: 145, y: 120))
            p.move(to: CGPoint(x: 145, y: 10)); p.addLine(to: CGPoint(x: 145, y: 120))
            p.move(to: CGPoint(x: 100, y: 120)); p.addLine(to: CGPoint(x: 100, y: 210))
        }
        .stroke(Color.hoButter, style: StrokeStyle(lineWidth: 8, lineCap: .round, lineJoin: .round))
        .frame(width: 200, height: 220)
    }
}

private struct Football: View {
    var body: some View {
        ZStack {
            Ellipse().fill(Color(hex: 0x8A4B2A))
            Ellipse().strokeBorder(Color.hoInkOnLight, lineWidth: 2.5)
            Path { p in
                p.move(to: CGPoint(x: 10, y: 10)); p.addLine(to: CGPoint(x: 22, y: 10))
                for x in stride(from: 12.0, through: 20.0, by: 4) {
                    p.move(to: CGPoint(x: x, y: 7.5)); p.addLine(to: CGPoint(x: x, y: 12.5))
                }
            }
            .stroke(Color.white, style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
        }
    }
}

private struct Confetti: View {
    let go: Bool
    private static let colors: [Color] = [.hoButter, Color(hex: 0xB9F0D0), .white, Color(hex: 0xFFE3D6)]
    private struct Piece: Identifiable {
        let id: Int; let x: CGFloat; let drift: CGFloat; let delay: Double; let duration: Double; let spin: Double; let color: Color
    }
    private let pieces: [Piece] = (0..<26).map { i in
        Piece(id: i, x: .random(in: 0.03...0.97), drift: .random(in: -40...40),
              delay: .random(in: 0.7...1.3), duration: .random(in: 1.6...2.6),
              spin: .random(in: 180...720) * (Bool.random() ? 1 : -1), color: colors[i % colors.count])
    }

    var body: some View {
        GeometryReader { geo in
            ForEach(pieces) { p in
                ConfettiPiece(piece: (p.x * geo.size.width, p.drift, p.delay, p.duration, p.spin, p.color),
                              height: geo.size.height, go: go)
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    private struct ConfettiPiece: View {
        let piece: (x: CGFloat, drift: CGFloat, delay: Double, duration: Double, spin: Double, color: Color)
        let height: CGFloat
        let go: Bool
        @State private var fallen = false
        var body: some View {
            Rectangle()
                .fill(piece.color)
                .overlay(Rectangle().strokeBorder(Color.hoInkOnLight, lineWidth: 2))
                .frame(width: 9, height: 14)
                .rotationEffect(.degrees(fallen ? piece.spin : 0))
                .position(x: piece.x + (fallen ? piece.drift : 0), y: fallen ? height + 40 : -30)
                .onAppear {
                    guard go else { return }
                    withAnimation(.easeIn(duration: piece.duration).delay(piece.delay)) { fallen = true }
                }
        }
    }
}
