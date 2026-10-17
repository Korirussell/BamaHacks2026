import SwiftUI
import UIKit

// Kickoff Classic tokens (frontend-build.md §3.1). Light / dark resolved per trait.
extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255,
                  green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

extension Color {
    init(hex: UInt32) { self.init(uiColor: UIColor(hex: hex)) }

    static func dyn(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }

    static let hoBg = dyn(0xFBF6EE, 0x161213)
    static let hoInk = dyn(0x1A1414, 0xF7EFE6)
    static let hoSoft = dyn(0x6B5F5A, 0xB5A9A2)
    static let hoCard = dyn(0xFFFFFF, 0x221B1C)
    static let hoSunk = dyn(0xF3ECE1, 0x1C1617)
    static let hoAccent = dyn(0x9E1B32, 0xD62B47)
    static let hoAccentText = dyn(0x9E1B32, 0xFF7088)
    static let hoOnAccent = Color.white
    static let hoShadow = dyn(0x1A1414, 0xC8243F)
    static let hoButter = Color(hex: 0xFFD84D)
    static let hoMint = dyn(0xB9F0D0, 0x8FE3B4)
    static let hoPeach = dyn(0xFFE3D6, 0x3B2C2E)
    static let hoMapGround = dyn(0xB9F0D0, 0x1F2A24)
    static let hoMapRoad = dyn(0xFFFFFF, 0x2D3A32)
    /// Text on butter / mint is always dark ink in both modes.
    static let hoInkOnLight = Color(hex: 0x1A1414)
    static let igPink = Color(hex: 0xDD2A7B)
    static let igGradient = LinearGradient(colors: [Color(hex: 0xF58529), Color(hex: 0xDD2A7B), Color(hex: 0x8134AF)],
                                           startPoint: .leading, endPoint: .trailing)

    static func tile(_ name: String) -> Color {
        switch name {
        case "mint": return .hoMint
        case "butter": return .hoButter
        default: return .hoPeach
        }
    }
}

extension Font {
    /// Display face. Fredoka isn't bundled; SF Rounded bold is the documented fallback (§3.2).
    static func display(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }
    static func label(_ size: CGFloat = 13) -> Font { .system(size: size, weight: .heavy) }
}

extension View {
    func displayTracking(_ size: CGFloat) -> some View { tracking(-0.03 * size) }
}

enum ThemeChoice: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

enum Money {
    /// `$65` for whole dollars, `$65.50` otherwise.
    static func format(_ cents: Int) -> String {
        cents % 100 == 0 ? "$\(cents / 100)" : String(format: "$%.2f", Double(cents) / 100)
    }
    /// Always two decimals, for checkout totals.
    static func exact(_ cents: Int) -> String { String(format: "$%.2f", Double(cents) / 100) }
}

enum Haptics {
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func soft() { UIImpactFeedbackGenerator(style: .soft).impactOccurred() }
}
