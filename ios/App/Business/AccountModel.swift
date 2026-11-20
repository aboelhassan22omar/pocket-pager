import Foundation

/// Where the restaurant side of the app is: the explainer, login, the three sign-up steps,
/// the "your restaurant is ready" screen, or the dashboard.
@MainActor
final class AccountModel: ObservableObject {
    enum Screen: Equatable {
        case welcome
        case login
        case signup
        case ready(AccountAPI.SignupResult)
        case dashboard(brandId: String)
    }

    private static let brandKey = "pp.business.brand"

    @Published var screen: Screen
    @Published var trialDays = 3
    @Published var host = PagerAPI.baseURL.host ?? "pager.aurexis.cc"
    @Published var support: String?

    let api = AccountAPI()

    init() {
        if let brand = UserDefaults.standard.string(forKey: Self.brandKey), Self.hasSession {
            screen = .dashboard(brandId: brand)
        } else {
            screen = .welcome
        }
    }

    private static var hasSession: Bool {
        (HTTPCookieStorage.shared.cookies ?? []).contains { $0.name == "sp_owner" && ($0.expiresDate ?? .distantFuture) > Date() }
    }

    func loadInfo() async {
        guard let info = try? await api.info() else { return }
        trialDays = info.trialDays
        host = info.host
        support = info.support
    }

    func signedIn(brandId: String) {
        UserDefaults.standard.set(brandId, forKey: Self.brandKey)
        screen = .dashboard(brandId: brandId)
    }

    func signOut() async {
        UserDefaults.standard.removeObject(forKey: Self.brandKey)
        await AccountAPI.clearSession()
        screen = .welcome
    }
}
