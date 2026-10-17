import SwiftUI
import WebKit

/// Preloads the campus map off-screen at launch (map-plan.md §5) so three.js and campus.json
/// are already cached by the time the demo reaches the meetup sheet. Every `WKWebView` shares
/// the default `WKWebsiteDataStore`, so that HTTP cache carries over to later `CampusMapView`s.
@MainActor
final class MapWarmup {
    static let shared = MapWarmup()

    private var warmWebView: WKWebView?

    private init() {}

    func preload() {
        guard warmWebView == nil else { return }
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        webView.isOpaque = false
        webView.backgroundColor = .clear
        warmWebView = webView

        if let url = CampusMapView.url(mode: .focus, dataKey: nil, interactive: false, labels: false,
                                        focusPlaceId: nil, selectedPillarId: nil, colorScheme: .light) {
            webView.load(URLRequest(url: url))
        }

        if let window = UIApplication.shared.connectedScenes
            .compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first {
            window.insertSubview(webView, at: 0)
        }
    }
}
