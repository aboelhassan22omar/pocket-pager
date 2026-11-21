import SwiftUI
import UIKit
import UserNotifications

@main
struct PagerApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = OrderModel(appKind: "app")
    @StateObject private var account = AccountModel()
    @State private var linkOpened = false

    var body: some Scene {
        WindowGroup {
            AppRoot(model: model, account: account, linkOpened: $linkOpened)
                .onAppear { appDelegate.account = account }
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

/// Push notifications for owners and managers: the device token goes to the server, and an
/// alert that arrives while the app is open still shows as a banner.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    weak var account: AccountModel?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in
            UserDefaults.standard.set(token, forKey: AccountModel.pushTokenKey)
            self.account?.pushToken(token)
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        Task { @MainActor in await self.account?.refresh() }
        return [.banner, .sound, .list]
    }
}

/// A customer who opened an order link (or has one running) sees their order, as before.
/// Everyone else opens the managers' side: sign in once, then the branches.
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
                    case .login: LoginView(account: account)
                    case .home(let brandId): ManagerHome(account: account, brandId: brandId)
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
