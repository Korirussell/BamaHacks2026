import SwiftUI

/// What every screen embeds (map-plan.md §5): a native skeleton until the web map says `ready`,
/// a 4 s timeout or `error` swap to the caller's native fallback, and never a blank box.
struct MapContainer<Fallback: View>: View {
    var mode: MapMode
    var dataKey: String?
    var interactive: Bool
    var labels: Bool = true
    var focusPlaceId: String? = nil
    var selectedPillarId: String? = nil
    var cornerRadius: CGFloat = 16
    var isFullScreen: Bool = false

    var replayTick: Int = 0
    var replayFrom: String? = nil
    var replayTo: String? = nil

    var onClose: (() -> Void)? = nil
    var onPillarTap: ((String) -> Void)? = nil
    var onPinTap: ((String) -> Void)? = nil
    var onReplayEnd: ((String, String) -> Void)? = nil

    @ViewBuilder var fallback: () -> Fallback

    @Environment(\.colorScheme) private var colorScheme
    @State private var phase: Phase = .loading

    private enum Phase { case loading, ready, fallback }

    var body: some View {
        ZStack {
            Color.hoMapGround

            if phase != .fallback {
                CampusMapView(mode: mode, dataKey: dataKey, interactive: interactive, labels: labels,
                              focusPlaceId: focusPlaceId, selectedPillarId: selectedPillarId, colorScheme: colorScheme,
                              replayTick: replayTick, replayFrom: replayFrom, replayTo: replayTo,
                              onReady: { withAnimation { phase = .ready } },
                              onPillarTap: onPillarTap, onPinTap: onPinTap, onReplayEnd: onReplayEnd,
                              onError: { _ in withAnimation { phase = .fallback } })
                    .opacity(phase == .ready ? 1 : 0)
            }

            if phase == .loading { skeleton }
            if phase == .fallback { fallback() }

            if isFullScreen, let onClose {
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .heavy))
                        .foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .background(Circle().fill(.black.opacity(0.35)))
                        .background(.ultraThinMaterial, in: Circle())
                }
                .buttonStyle(PressableStyle())
                .padding(16)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: isFullScreen ? 0 : cornerRadius))
        .onChange(of: replayTick) { _, tick in
            guard tick > 0, phase != .ready else { return }
            // No live web map to animate the football — simulate the landing so Replay still works.
            onReplayEnd?(replayFrom ?? "", replayTo ?? "")
        }
        .task {
            try? await Task.sleep(for: .seconds(4))
            if phase == .loading { withAnimation { phase = .fallback } }
        }
    }

    private var skeleton: some View {
        VStack(spacing: 8) {
            Text("Building campus\u{2026} \u{1F3D7}\u{FE0F}")
                .font(.system(size: 13, weight: .heavy))
                .foregroundStyle(Color.hoInk)
        }
    }
}
