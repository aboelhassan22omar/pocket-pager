import SafariServices
import StoreKit
import SwiftUI
import WebKit

/// The owner's (or branch manager's) dashboard: the same page as the website, signed in with the
/// session from the native login, with a native bar (refresh, sign out) and pull to refresh.
/// Its user agent says "PocketPagerApp": the page then sells nothing (store rules).
struct DashboardView: View {
    @ObservedObject var account: AccountModel
    let brandId: String
    @State private var reloadToken = 0
    @State private var external: URL?
    @State private var confirmSignOut = false
    @Environment(\.requestReview) private var requestReview

    var body: some View {
        // The tab bar below is the app's; the page brings its own header (pull down to refresh).
        VStack(spacing: 0) {
            DashboardWeb(url: PagerAPI.baseURL.appendingPathComponent("brand/\(brandId)"), reloadToken: reloadToken,
                         openOutside: { external = $0 },
                         // The page left for the home page: the account was closed or signed out.
                         leftDashboard: { Task { await account.signOut() } })
        }
        .background(Theme.background.ignoresSafeArea())
        .sheet(item: $external) { url in
            SafariSheet(url: url).ignoresSafeArea()
        }
        // Ratings carry the app up the store: asked on the 3rd and the 15th time the owner comes back
        // (someone who keeps using it), a few seconds in, never on the first visit. iOS decides
        // whether to show it, at most three times a year.
        .task {
            let key = "pp.business.opens"
            let opens = UserDefaults.standard.integer(forKey: key) + 1
            UserDefaults.standard.set(opens, forKey: key)
            guard opens == 3 || opens == 15 else { return }
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            requestReview()
        }
        .confirmationDialog("تخرج من الحساب؟", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("خروج", role: .destructive) { Task { await account.signOut() } }
            Button("رجوع", role: .cancel) {}
        }
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

struct SafariSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        let vc = SFSafariViewController(url: url)
        vc.preferredControlTintColor = UIColor(Theme.accent)
        return vc
    }
    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

struct DashboardWeb: UIViewRepresentable {
    let url: URL
    let reloadToken: Int
    let openOutside: (URL) -> Void
    let leftDashboard: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(openOutside: openOutside, leftDashboard: leftDashboard) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.applicationNameForUserAgent = "PocketPagerApp/ios"
        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = UIColor(Theme.background)
        web.scrollView.backgroundColor = UIColor(Theme.background)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true

        let refresh = UIRefreshControl()
        refresh.tintColor = UIColor(Theme.accent)
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.pulled(_:)), for: .valueChanged)
        web.scrollView.refreshControl = refresh
        context.coordinator.web = web
        context.coordinator.lastToken = reloadToken

        Task { @MainActor in
            await AccountAPI.syncCookies(into: web.configuration.websiteDataStore.httpCookieStore)
            web.load(URLRequest(url: url))
        }
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        if context.coordinator.lastToken != reloadToken {
            context.coordinator.lastToken = reloadToken
            web.reload()
        }
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let openOutside: (URL) -> Void
        let leftDashboard: () -> Void
        weak var web: WKWebView?
        var lastToken = 0
        private let host = PagerAPI.baseURL.host

        init(openOutside: @escaping (URL) -> Void, leftDashboard: @escaping () -> Void) {
            self.openOutside = openOutside
            self.leftDashboard = leftDashboard
        }

        @objc func pulled(_ control: UIRefreshControl) {
            web?.reload()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { control.endRefreshing() }
        }

        /// Our dashboard stays here; the cashier screen, WhatsApp and anything else open on top.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = action.request.url else { return .cancel }
            let ours = url.host == host
            if ours, url.path.hasPrefix("/brand/") { return .allow }
            if ours, url.path == "/" || url.path == "/login" {
                leftDashboard()
                return .cancel
            }
            // Reloads and the page's own fetch-driven navigations of our site.
            if ours, action.navigationType == .other || action.navigationType == .reload { return .allow }
            if url.scheme == "https" || url.scheme == "http" {
                if ours { openOutside(url) } else { await UIApplication.shared.open(url) }
            } else if UIApplication.shared.canOpenURL(url) {
                await UIApplication.shared.open(url)
            }
            return .cancel
        }

        /// target="_blank" (open the cashier screen, a WhatsApp link): on top, never lost.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url {
                if url.host == host { openOutside(url) } else { UIApplication.shared.open(url) }
            }
            return nil
        }
    }
}
