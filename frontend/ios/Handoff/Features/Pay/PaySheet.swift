import SwiftUI

struct PaySheet: View {
    let amountCents: Int
    var onPaid: () -> Void
    @State private var processing: String?

    private var fee: Int { Int((Double(amountCents) * 0.05).rounded()) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SheetTitle(kicker: "Checkout", title: "Pay \(Money.format(amountCents))")
            VStack(spacing: 10) {
                row("Item", Money.exact(amountCents))
                row("Service fee", Money.exact(fee))
                Rectangle().fill(Color.hoInk).frame(height: 2)
                row("Total", Money.exact(amountCents + fee), bold: true)
            }
            .padding(14)
            .sticker(radius: 18, shadow: 3)

            Text("🔒 Money's held until it's in your hands")
                .font(.system(size: 13.5, weight: .bold)).foregroundStyle(Color.hoInk)

            Button { pay("apple") } label: {
                HStack(spacing: 6) {
                    if processing == "apple" { ProgressView().tint(.white) } else {
                        Text("Pay with")
                        Image(systemName: "apple.logo")
                        Text("Pay")
                    }
                }
            }
            .buttonStyle(.pill(.dark, full: true))

            Button { pay("card") } label: {
                HStack {
                    if processing == "card" { ProgressView() } else { Text("Pay with card") }
                }
            }
            .buttonStyle(.pill(.neutral, full: true))
        }
        .disabled(processing != nil)
        .padding(20)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Color.hoBg.ignoresSafeArea())
        .presentationDetents([.medium])
        .presentationCornerRadius(28)
        .presentationDragIndicator(.visible)
    }

    private func row(_ label: String, _ value: String, bold: Bool = false) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value).monospacedDigit()
        }
        .font(.system(size: bold ? 17 : 15, weight: bold ? .heavy : .semibold))
        .foregroundStyle(Color.hoInk)
    }

    private func pay(_ method: String) {
        processing = method
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.2))
            onPaid()
        }
    }
}

/// Pay → Touchdown! → Meetup, shared by Buy now and the haggle thread.
/// One full-screen cover per flow; the celebration and the meetup are stages inside it.
struct DealFlow: ViewModifier {
    @Binding var isPaying: Bool
    @Binding var openMeetup: Bool
    let amountCents: Int
    let listing: Listing?
    @Environment(AppStore.self) private var store
    @State private var showCover = false
    @State private var stage: Stage = .celebrate

    enum Stage { case celebrate, meetup }

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: $isPaying) {
                PaySheet(amountCents: amountCents) {
                    store.startOrder(listing: listing, amountCents: amountCents)
                    isPaying = false
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(450))
                        stage = .celebrate
                        presentCover()
                    }
                }
            }
            .onChange(of: openMeetup) {
                guard openMeetup else { return }
                openMeetup = false
                stage = .meetup
                showCover = true
            }
            .fullScreenCover(isPresented: $showCover) {
                ZStack {
                    if stage == .meetup {
                        MeetupView().transition(.opacity)
                    }
                    if stage == .celebrate {
                        CelebrationView(celebration: .touchdown(line: amountCents == 6500 ? Copy.celebrateTDPaid
                            : "Paid \(Money.format(amountCents)). It's held safe until the handoff.")) {
                            withAnimation(.easeInOut(duration: 0.3)) { stage = .meetup }
                        }
                        .transition(.opacity)
                    }
                }
                .presentationBackground(.clear)
            }
    }

    private func presentCover() {
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) { showCover = true }
    }
}

extension View {
    func dealFlow(isPaying: Binding<Bool>, openMeetup: Binding<Bool> = .constant(false),
                  amountCents: Int, listing: Listing?) -> some View {
        modifier(DealFlow(isPaying: isPaying, openMeetup: openMeetup, amountCents: amountCents, listing: listing))
    }
}

/// Celebration drawn on top of an already full-screen view.
struct CelebrationOverlay: ViewModifier {
    @Binding var celebration: Celebration?
    var onDone: () -> Void
    func body(content: Content) -> some View {
        content.overlay {
            if let c = celebration {
                CelebrationView(celebration: c) {
                    withAnimation(.easeOut(duration: 0.25)) { celebration = nil }
                    onDone()
                }
                .transition(.opacity)
            }
        }
    }
}

extension View {
    func celebrationOverlay(_ c: Binding<Celebration?>, onDone: @escaping () -> Void = {}) -> some View {
        modifier(CelebrationOverlay(celebration: c, onDone: onDone))
    }
}
