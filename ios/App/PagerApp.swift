import SwiftUI

@main
struct PagerApp: App {
    @StateObject private var model = OrderModel(appKind: "app")
    @StateObject private var account = AccountModel()
    @State private var linkOpened = false

    var body: some Scene {
        WindowGroup {
            AppRoot(model: model, account: account, linkOpened: $linkOpened)
                .onOpenURL { url in
                    linkOpened = true
                    model.handle(url: url)
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL {
                        linkOpened = true
                        model.handle(url: url)
                    }
                }
        }
    }
}

/// A customer who opened an order link (or has one running) sees their order, as before.
/// Everyone else opens the restaurant side: what it is, sign up or log in, the dashboard.
struct AppRoot: View {
    @ObservedObject var model: OrderModel
    @ObservedObject var account: AccountModel
    @Binding var linkOpened: Bool

    /// An order on screen, one being opened, or a link that failed (its message matters).
    private var customer: Bool {
        switch model.phase {
        case .idle: return false
        case .splash: return model.isBusy
        case .tracking: return true
        case .failed: return linkOpened
        }
    }

    var body: some View {
        Group {
            if customer {
                RootView(model: model)
            } else {
                ZStack {
                    Theme.background.ignoresSafeArea()
                    switch account.screen {
                    case .welcome: WelcomeView(account: account)
                    case .login: LoginView(account: account)
                    case .signup: SignupView(account: account)
                    case .ready(let result): RestaurantReadyView(account: account, result: result)
                    case .dashboard(let brandId): DashboardView(account: account, brandId: brandId)
                    }
                }
                .environment(\.layoutDirection, .rightToLeft)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
                .onAppear { model.boot() }
            }
        }
        .animation(.easeOut(duration: 0.25), value: account.screen)
    }
}
