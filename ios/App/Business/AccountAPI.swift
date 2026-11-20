import Foundation
import WebKit

/// The restaurant side of the app talks to the same API as the website (/signup, /login).
/// The session is the website's own cookie: URLSession keeps it in HTTPCookieStorage.shared,
/// and `syncCookies` hands it to the dashboard's web view.
struct AccountAPI {
    struct Failure: Error, LocalizedError {
        let message: String
        let field: String?
        var errorDescription: String? { message }
    }

    struct Info: Decodable {
        let signup: Bool
        let trialDays: Int
        let support: String?
        let host: String
    }

    struct SlugCheck: Decodable {
        struct Brand: Decodable {
            let ok: Bool
            let error: String?
        }
        let brand: Brand
    }

    struct Login: Decodable {
        let brandId: String
        let manager: Bool
    }

    struct SignupResult: Decodable, Equatable {
        struct Urls: Decodable, Equatable {
            let bar: String
            let qr: String
            let settings: String
        }
        let brandId: String
        let branchId: String
        let pin: String
        let trial: Bool
        let trialDays: Int
        let urls: Urls
    }

    struct SignupForm {
        var name = ""
        var phone = ""
        var password = ""
        var brandName = ""
        var brandId = ""
        var branchName = "الفرع الرئيسي"
        var branchSlug = ""
    }

    var base: URL = PagerAPI.baseURL

    func info() async throws -> Info {
        try await send("api/signup/info", method: "GET", body: nil)
    }

    func check(brandId: String) async throws -> SlugCheck {
        var parts = URLComponents()
        parts.queryItems = [URLQueryItem(name: "brand", value: brandId)]
        return try await send("api/signup/check?\(parts.percentEncodedQuery ?? "")", method: "GET", body: nil)
    }

    func login(_ login: String, password: String) async throws -> Login {
        try await send("api/login", method: "POST", body: ["login": login, "password": password])
    }

    func signup(_ form: SignupForm) async throws -> SignupResult {
        try await send("api/signup", method: "POST", body: [
            "name": form.name.trimmingCharacters(in: .whitespacesAndNewlines),
            "phone": form.phone.trimmingCharacters(in: .whitespacesAndNewlines),
            "password": form.password,
            "brandName": form.brandName.trimmingCharacters(in: .whitespacesAndNewlines),
            "brandId": form.brandId,
            "branchName": form.branchName.trimmingCharacters(in: .whitespacesAndNewlines),
            "branchSlug": form.branchSlug,
        ])
    }

    private func send<T: Decodable>(_ path: String, method: String, body: [String: String]?) async throws -> T {
        guard let url = URL(string: path, relativeTo: base) else { throw Failure(message: "حصلت مشكلة. جرّب تاني", field: nil) }
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
            throw Failure(message: "مفيش اتصال بالإنترنت. جرّب تاني", field: nil)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw Failure(message: object?["error"] as? String ?? "حصلت مشكلة. جرّب تاني", field: object?["field"] as? String)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// Our cookies (the owner session) into the web view's store, before the dashboard loads.
    @MainActor
    static func syncCookies(into store: WKHTTPCookieStore) async {
        let host = PagerAPI.baseURL.host ?? ""
        for cookie in HTTPCookieStorage.shared.cookies ?? [] where host.hasSuffix(cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) {
            await store.setCookie(cookie)
        }
    }

    /// Signs out everywhere on this phone: our cookies and the web view's.
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

/// A link name from what the owner typed: "كافيه زد" -> "cafe-zd" (same rules as the website).
enum Slug {
    private static let words: [String: String] = [
        "كافيه": "cafe", "كافية": "cafe", "كافي": "cafe", "كوفي": "coffee", "قهوة": "coffee", "مطعم": "restaurant",
        "برجر": "burger", "بيتزا": "pizza", "شاورما": "shawarma", "كشري": "koshary", "جريل": "grill", "بيكري": "bakery",
    ]
    private static let letters: [Character: String] = [
        "ا": "a", "أ": "a", "إ": "e", "آ": "a", "ب": "b", "ت": "t", "ث": "s", "ج": "g", "ح": "h", "خ": "kh", "د": "d",
        "ذ": "z", "ر": "r", "ز": "z", "س": "s", "ش": "sh", "ص": "s", "ض": "d", "ط": "t", "ظ": "z", "ع": "a", "غ": "gh",
        "ف": "f", "ق": "k", "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "ة": "a", "و": "o", "ي": "y", "ى": "a",
        "ئ": "e", "ؤ": "o", "ء": "",
        "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    ]

    static func suggest(_ text: String, max: Int = 24) -> String {
        let words = text.split(whereSeparator: { $0.isWhitespace }).map { word -> String in
            var w = String(word)
            if w.hasPrefix("ال") { w = String(w.dropFirst(2)) }
            return Self.words[w] ?? String(word)
        }
        var latin = ""
        for ch in words.joined(separator: " ").lowercased() {
            if let mapped = letters[ch] { latin += mapped } else if ch.isASCII, ch.isLetter || ch.isNumber { latin.append(ch) } else { latin += "-" }
        }
        let parts = latin.split(separator: "-").filter { !$0.isEmpty }
        var out = String(parts.joined(separator: "-").prefix(max))
        while out.hasSuffix("-") { out.removeLast() }
        if !out.isEmpty, out.count < 3 { out = String("\(out)-cafe".prefix(max)) }
        return out
    }

    /// What may be typed into a link field: small English letters, digits and single dashes.
    static func clean(_ text: String, max: Int = 24) -> String {
        var out = ""
        for ch in text.lowercased() {
            if ch == " " || ch == "-" {
                if !out.hasSuffix("-") { out += "-" }
            } else if ch.isASCII, ch.isLetter || ch.isNumber {
                out.append(ch)
            }
        }
        return String(out.prefix(max))
    }

    static func isValid(_ slug: String, min: Int = 3) -> Bool {
        slug.count >= min && slug.range(of: "^[a-z0-9]+(-[a-z0-9]+)*$", options: .regularExpression) != nil
    }
}
