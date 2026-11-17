import SwiftUI

/// Pocket Pager's identity (brand/pocket-pager-brand), as on the web (server/public/css/base.css):
/// navy surfaces 60, neutrals 30, orange 10. Green is the "ready" state only, never decoration.
enum Theme {
    static let background = Color(hex: 0x0D1324)
    static let surface = Color(hex: 0x131B30)
    static let surface2 = Color(hex: 0x1A2440)
    static let text = Color(hex: 0xF5F7FB)
    static let muted = Color(hex: 0x9AA4B8)
    static let accent = Color(hex: 0xFF6A13)
    /// Text on the orange: the brand's ink, never white.
    static let onAccent = Color(hex: 0x1B1206)
    static let ready = Color(hex: 0x22D39A)
    static let readyDeep = Color(hex: 0x14A97A)

    static func tint(for status: String) -> Color {
        switch status {
        case "ready", "picked": return ready
        case "preparing": return accent
        default: return muted
        }
    }
}

extension Color {
    /// "#rrggbb" → Color; nil for anything else.
    init?(hexString: String) {
        let digits = hexString.hasPrefix("#") ? String(hexString.dropFirst()) : hexString
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        self.init(hex: value)
    }

    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}
