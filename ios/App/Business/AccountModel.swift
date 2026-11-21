import Foundation
import UIKit
import UserNotifications

/// The managers' side of the app: sign-in, then the branches, alerts, management and account.
/// Signed in once, it stays signed in: only «خروج», or Aurexis stopping the account / changing
/// its password (the server answers 401), signs out.
@MainActor
final class AccountModel: ObservableObject {
    enum Screen: Equatable {
        case login
        case home(brandId: String)
    }

    private static let brandKey = "pp.business.brand"
    static let pushTokenKey = "pp.business.pushToken"

    @Published var screen: Screen
    @Published var overview: Overview?
    @Published var alerts: [AlertItem] = []
    @Published var loadError: String?
    @Published var support: String?

    let api = AccountAPI()
    private var liveTask: Task<Void, Never>?

    init() {
        if let brand = UserDefaults.standard.string(forKey: Self.brandKey), Self.hasSession {
            screen = .home(brandId: brand)
        } else {
            screen = .login
        }
    }

    private static var hasSession: Bool {
        (HTTPCookieStorage.shared.cookies ?? []).contains { $0.name == "sp_owner" && ($0.expiresDate ?? .distantFuture) > Date() }
    }

    var brandId: String? {
        if case .home(let id) = screen { return id }
        return nil
    }

    /// The WhatsApp chat with Aurexis (new accounts, forgotten passwords, the subscription).
    var whatsappURL: URL? {
        let raw = overview?.whatsapp ?? support
        guard let raw else { return nil }
        var digits = raw.filter(\.isNumber)
        if digits.hasPrefix("01") { digits = "2" + digits }
        return URL(string: "https://wa.me/\(digits)")
    }

    func loadInfo() async {
        support = (try? await api.info())?.support
    }

    func signedIn(brandId: String) {
        UserDefaults.standard.set(brandId, forKey: Self.brandKey)
        screen = .home(brandId: brandId)
        askForNotifications()
    }

    func signOut() async {
        liveTask?.cancel()
        if let brandId {
            await api.logout(brandId: brandId, pushToken: UserDefaults.standard.string(forKey: Self.pushTokenKey))
        }
        UserDefaults.standard.removeObject(forKey: Self.brandKey)
        await AccountAPI.clearSession()
        overview = nil
        alerts = []
        screen = .login
    }

    /// Everything the screens show, fresh. A 401 means Aurexis ended the session.
    func refresh() async {
        guard let brandId else { return }
        do {
            overview = try await api.overview(brandId: brandId)
            alerts = (try? await api.alerts(brandId: brandId)) ?? alerts
            loadError = nil
        } catch let failure as AccountAPI.Failure where failure.status == 401 || failure.status == 403 {
            await signOut()
        } catch {
            loadError = error.localizedDescription
        }
    }

    /// While the app is open: refresh whenever anything of the brand changes (server events).
    func startLive() {
        guard let brandId, liveTask == nil else { return }
        liveTask = Task { [weak self] in
            await self?.api.watch(brandId: brandId) { [weak self] in
                Task { await self?.refresh() }
            }
        }
    }

    func stopLive() {
        liveTask?.cancel()
        liveTask = nil
    }

    // MARK: - Notifications

    func askForNotifications() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    /// The device token from APNs: the server pushes this brand's alerts to it.
    func pushToken(_ token: String) {
        UserDefaults.standard.set(token, forKey: Self.pushTokenKey)
        guard let brandId else { return }
        Task { await api.registerPush(brandId: brandId, token: token) }
    }
}
