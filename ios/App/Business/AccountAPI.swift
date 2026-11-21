import Foundation
import WebKit

/// The managers' app talks to the same API as the website (/login, /brand). The session is the
/// website's own cookie: URLSession keeps it in HTTPCookieStorage.shared (400 days, renewed on
/// every dashboard load), and `syncCookies` hands it to the management web view.
struct AccountAPI {
    struct Failure: Error, LocalizedError {
        let message: String
        let field: String?
        let status: Int
        var errorDescription: String? { message }
    }

    struct Info: Decodable {
        let support: String?
        let host: String
    }

    struct Login: Decodable {
        let brandId: String
        let manager: Bool
    }

    var base: URL { PagerAPI.baseURL }

    func info() async throws -> Info {
        try await send("api/signup/info", method: "GET", body: nil)
    }

    func login(_ login: String, password: String) async throws -> Login {
        try await send("api/login", method: "POST", body: ["login": login, "password": password])
    }

    func overview(brandId: String) async throws -> Overview {
        try await send("api/brand/\(brandId)/overview", method: "GET", body: nil)
    }

    func alerts(brandId: String) async throws -> [AlertItem] {
        struct List: Decodable { let alerts: [AlertItem] }
        let list: List = try await send("api/brand/\(brandId)/alerts", method: "GET", body: nil)
        return list.alerts
    }

    func registerPush(brandId: String, token: String) async {
        struct Ok: Decodable { let ok: Bool }
        let _: Ok? = try? await send("api/brand/\(brandId)/push-devices", method: "POST", body: ["token": token, "platform": "ios"])
    }

    func logout(brandId: String, pushToken: String?) async {
        struct Ok: Decodable { let ok: Bool }
        if let pushToken {
            let _: Ok? = try? await send("api/brand/\(brandId)/push-devices/delete", method: "POST", body: ["token": pushToken])
        }
        let _: Ok? = try? await send("api/brand/\(brandId)/logout", method: "POST", body: [:])
    }

    /// Server-sent events of the brand: calls `onChange` whenever anything changes, until cancelled.
    func watch(brandId: String, onChange: @escaping @MainActor () -> Void) async {
        guard let url = URL(string: "api/brand/\(brandId)/events", relativeTo: base) else { return }
        while !Task.isCancelled {
            do {
                var request = URLRequest(url: url)
                request.timeoutInterval = 3600
                let (bytes, response) = try await URLSession.shared.bytes(for: request)
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
                for try await line in bytes.lines where line.hasPrefix("event: changed") || line.hasPrefix("event: alert") {
                    await onChange()
                }
            } catch {
                // Offline or the server restarted: try again shortly.
            }
            try? await Task.sleep(nanoseconds: 5_000_000_000)
        }
    }

    private func send<T: Decodable>(_ path: String, method: String, body: [String: String]?) async throws -> T {
        guard let url = URL(string: path, relativeTo: base) else { throw Failure(message: "حصلت مشكلة. جرّب تاني", field: nil, status: 0) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw Failure(message: "مفيش اتصال بالإنترنت. جرّب تاني", field: nil, status: 0)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw Failure(message: object?["error"] as? String ?? "حصلت مشكلة. جرّب تاني", field: object?["field"] as? String, status: status)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// Our cookies (the owner session) into the web view's store, before the management page loads.
    @MainActor
    static func syncCookies(into store: WKHTTPCookieStore) async {
        let host = PagerAPI.baseURL.host ?? ""
        for cookie in HTTPCookieStorage.shared.cookies ?? [] where host.hasSuffix(cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) {
            await store.setCookie(cookie)
        }
    }

    /// Signs out on this phone: our cookies and the web view's.
    @MainActor
    static func clearSession() async {
        for cookie in HTTPCookieStorage.shared.cookies ?? [] where cookie.name == "sp_owner" {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
        let store = WKWebsiteDataStore.default()
        let records = await store.dataRecords(ofTypes: [WKWebsiteDataTypeCookies])
        await store.removeData(ofTypes: [WKWebsiteDataTypeCookies], for: records)
    }
}

// MARK: - What the dashboard API returns (the fields the app shows)

struct Overview: Decodable {
    struct Brand: Decodable {
        let id: String
        let name: String
    }

    struct Owner: Decodable {
        let username: String
        let name: String?
        let role: String
        let phone: String?
    }

    let brand: Brand
    let branches: [BranchInfo]
    let owner: Owner
    let stopped: String?
    let whatsapp: String?
}

struct BranchInfo: Decodable, Identifiable {
    struct Plan: Decodable {
        let status: String
        let reason: String?
        let daysLeft: Int?
    }

    struct Urls: Decodable {
        let bar: String
        let qr: String
        let settings: String
    }

    let id: String
    let name: String
    let plan: Plan
    let ordersToday: Int
    let openNow: Int
    let lateToday: Int
    let screens: Int
    let paused: Bool?
    let delivery: Bool?
    let urls: Urls?
    let pin: String?
    let avgRating7d: Double?

    var cashierOnline: Bool { screens > 0 }

    /// The plan in words, as on the website's branch card.
    var planText: String {
        if plan.reason == "awaiting_payment" { return "مستني التفعيل" }
        switch plan.status {
        case "trial": return plan.daysLeft.map { "تجربة · فاضل \($0) \($0 == 1 ? "يوم" : "أيام")" } ?? "تجربة"
        case "active": return "شغّال"
        case "past_due": return "الاشتراك خلص · فترة سماح"
        default: return "واقف"
        }
    }
}

struct AlertItem: Decodable, Identifiable {
    let id: Int
    let branchId: String?
    let kind: String
    let title: String
    let body: String
    let at: Double
}
