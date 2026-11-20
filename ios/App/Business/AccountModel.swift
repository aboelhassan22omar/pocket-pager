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
        #if DEBUG
        // Screenshots in CI (.github/workflows/ios-screens.yml): `-ppScreen <name>` opens one screen.
        switch UserDefaults.standard.string(forKey: "ppScreen") {
        case "login": screen = .login
        case "signup1", "signup2", "signup3": screen = .signup
        case "ready": if let sample = Self.sampleResult { screen = .ready(sample) }
        default: break
        }
        #endif
    }

    #if DEBUG
    static var previewStep: Int {
        switch UserDefaults.standard.string(forKey: "ppScreen") {
        case "signup2": return 2
        case "signup3": return 3
        default: return 1
        }
    }

    static var previewFilled: Bool { UserDefaults.standard.string(forKey: "ppScreen")?.hasPrefix("signup") == true }

    private static var sampleResult: AccountAPI.SignupResult? {
        let json = #"{"brandId":"cafe-zd","branchId":"cafe-zd-maadi","pin":"4821","trial":true,"trialDays":3,"urls":{"bar":"https://pager.aurexis.cc/bar/cafe-zd-maadi","qr":"https://pager.aurexis.cc/qr/cafe-zd-maadi","settings":"https://pager.aurexis.cc/settings/cafe-zd-maadi"}}"#
        return try? JSONDecoder().decode(AccountAPI.SignupResult.self, from: Data(json.utf8))
    }
    #endif

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
