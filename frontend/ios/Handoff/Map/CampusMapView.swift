import SwiftUI
import WebKit

/// Same campus map on web and iOS: this wraps the `/embed/campus` page (map-plan.md §3) in a
/// `WKWebView` instead of reimplementing the 3D scene natively.
enum MapMode: String { case meetup, history, focus }

struct CampusMapView: UIViewRepresentable {
    var mode: MapMode
    var dataKey: String?
    var interactive: Bool
    var labels: Bool = true
    var focusPlaceId: String?
    var selectedPillarId: String?
    var colorScheme: ColorScheme

    /// Bumped by the caller to fire a one-shot `window.handoffMap.replay(from,to)` (history Replay button).
    var replayTick: Int = 0
    var replayFrom: String?
    var replayTo: String?

    var onReady: (() -> Void)?
    var onPillarTap: ((String) -> Void)?
    var onPinTap: ((String) -> Void)?
    var onReplayEnd: ((String, String) -> Void)?
    var onError: ((String) -> Void)?

    static func url(mode: MapMode, dataKey: String?, interactive: Bool, labels: Bool,
                     focusPlaceId: String?, selectedPillarId: String?, colorScheme: ColorScheme) -> URL? {
        var comps = URLComponents(url: Config.mapBaseURL.appendingPathComponent("embed/campus"), resolvingAgainstBaseURL: false)
        var items = [
            URLQueryItem(name: "mode", value: mode.rawValue),
            URLQueryItem(name: "theme", value: colorScheme == .dark ? "dark" : "light"),
            URLQueryItem(name: "interactive", value: interactive ? "1" : "0"),
            URLQueryItem(name: "labels", value: labels ? "1" : "0"),
        ]
        if let dataKey { items.append(URLQueryItem(name: "data", value: dataKey)) }
        if let focusPlaceId { items.append(URLQueryItem(name: "focus", value: focusPlaceId)) }
        if let selectedPillarId { items.append(URLQueryItem(name: "selected", value: selectedPillarId)) }
        comps?.queryItems = items
        return comps?.url
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(context.coordinator, name: "handoff")
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.navigationDelegate = context.coordinator
        context.coordinator.load(self, into: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.update(self, webView: webView)
    }

    func makeCoordinator() -> Coordinator { Coordinator(view: self) }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        private var isReady = false
        private var pendingJS: [String] = []
        private var loadedMode: MapMode?
        private var loadedDataKey: String?
        private var lastColorScheme: ColorScheme?
        private var lastInteractive: Bool?
        private var lastFocus: String?
        private var lastSelected: String?
        private var lastReplayTick = 0
        private var view: CampusMapView

        init(view: CampusMapView) { self.view = view }

        func load(_ view: CampusMapView, into webView: WKWebView) {
            self.view = view
            isReady = false
            pendingJS = []
            loadedMode = view.mode
            loadedDataKey = view.dataKey
            lastColorScheme = view.colorScheme
            lastInteractive = view.interactive
            lastFocus = view.focusPlaceId
            lastSelected = view.selectedPillarId
            lastReplayTick = view.replayTick
            guard let url = CampusMapView.url(mode: view.mode, dataKey: view.dataKey, interactive: view.interactive,
                                               labels: view.labels, focusPlaceId: view.focusPlaceId,
                                               selectedPillarId: view.selectedPillarId, colorScheme: view.colorScheme) else {
                view.onError?("Bad map URL")
                return
            }
            webView.load(URLRequest(url: url))
        }

        func update(_ view: CampusMapView, webView: WKWebView) {
            self.view = view
            if loadedMode != view.mode || loadedDataKey != view.dataKey {
                load(view, into: webView)
                return
            }
            if lastColorScheme != view.colorScheme {
                lastColorScheme = view.colorScheme
                evaluate("window.handoffMap?.setTheme('\(view.colorScheme == .dark ? "dark" : "light")')")
            }
            if lastInteractive != view.interactive {
                lastInteractive = view.interactive
                evaluate("window.handoffMap?.setInteractive(\(view.interactive))")
            }
            if lastFocus != view.focusPlaceId, let focus = view.focusPlaceId {
                lastFocus = view.focusPlaceId
                evaluate("window.handoffMap?.focusPlace('\(escape(focus))')")
            }
            if lastSelected != view.selectedPillarId, let sel = view.selectedPillarId {
                lastSelected = view.selectedPillarId
                evaluate("window.handoffMap?.selectPillar('\(escape(sel))')")
            }
            if lastReplayTick != view.replayTick {
                lastReplayTick = view.replayTick
                if let from = view.replayFrom, let to = view.replayTo {
                    evaluate("window.handoffMap?.replay('\(escape(from))', '\(escape(to))')")
                }
            }
        }

        private func escape(_ s: String) -> String { s.replacingOccurrences(of: "'", with: "\\'") }

        private func evaluate(_ js: String) {
            guard isReady, let webView else { pendingJS.append(js); return }
            webView.evaluateJavaScript(js)
        }

        private weak var webView: WKWebView?

        // MARK: - WKScriptMessageHandler

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "handoff", let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            switch type {
            case "ready":
                isReady = true
                let queued = pendingJS
                pendingJS = []
                for js in queued { self.webView?.evaluateJavaScript(js) }
                view.onReady?()
            case "pillarTap":
                if let id = body["id"] as? String { view.onPillarTap?(id) }
            case "pinTap":
                if let id = body["id"] as? String { view.onPinTap?(id) }
            case "replayEnd":
                if let from = body["fromPlaceId"] as? String, let to = body["toPlaceId"] as? String { view.onReplayEnd?(from, to) }
            case "error":
                view.onError?(body["message"] as? String ?? "Map error")
            default:
                break
            }
        }

        // MARK: - WKNavigationDelegate

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { self.webView = webView }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            view.onError?(error.localizedDescription)
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            view.onError?(error.localizedDescription)
        }
    }
}
