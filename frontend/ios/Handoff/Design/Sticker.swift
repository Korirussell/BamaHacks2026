import SwiftUI

// §11.2 — outline + hard offset shadow, zero blur.
struct Sticker: ViewModifier {
    var radius: CGFloat = 18
    var offset: CGFloat = 4
    var fill: Color = .hoCard
    var stroke: Color = .hoInk
    var shadow: Color = .hoShadow
    var dashed: Bool = false

    func body(content: Content) -> some View {
        content
            .background(RoundedRectangle(cornerRadius: radius).fill(fill))
            .clipShape(RoundedRectangle(cornerRadius: radius))
            .overlay(
                RoundedRectangle(cornerRadius: radius)
                    .strokeBorder(stroke, style: StrokeStyle(lineWidth: 2, dash: dashed ? [6, 4] : []))
            )
            .background(RoundedRectangle(cornerRadius: radius).fill(shadow).offset(x: offset, y: offset))
    }
}

extension View {
    func sticker(radius: CGFloat = 18, shadow offset: CGFloat = 4, fill: Color = .hoCard,
                 shadowColor: Color = .hoShadow, dashed: Bool = false) -> some View {
        modifier(Sticker(radius: radius, offset: offset, fill: fill, shadow: shadowColor, dashed: dashed))
    }

    func capsuleSticker(fill: Color = .hoCard, shadow offset: CGFloat = 3) -> some View {
        self
            .background(Capsule().fill(fill))
            .overlay(Capsule().strokeBorder(Color.hoInk, lineWidth: 2))
            .background(Capsule().fill(Color.hoShadow).offset(x: offset, y: offset))
    }
}

struct PillButtonStyle: ButtonStyle {
    enum Kind { case primary, neutral, butter, dark }
    var kind: Kind = .primary
    var small = false
    var fullWidth = false

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        let shadow: CGFloat = small ? 3 : 4
        configuration.label
            .font(.label(small ? 12 : 13))
            .textCase(.uppercase)
            .tracking(0.26)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .padding(.horizontal, small ? 12 : 18)
            .padding(.vertical, small ? 8 : 14)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .foregroundStyle(foreground)
            .background(Capsule().fill(background))
            .overlay(Capsule().strokeBorder(Color.hoInk, lineWidth: 2))
            .background(Capsule().fill(Color.hoShadow).offset(x: pressed ? 2 : shadow, y: pressed ? 2 : shadow))
            .offset(x: pressed ? 2 : 0, y: pressed ? 2 : 0)
            .animation(.easeOut(duration: 0.12), value: pressed)
    }

    private var foreground: Color {
        switch kind {
        case .primary, .dark: return .white
        case .butter: return .hoInkOnLight
        case .neutral: return .hoInk
        }
    }
    private var background: Color {
        switch kind {
        case .primary: return .hoAccent
        case .butter: return .hoButter
        case .neutral: return .hoCard
        case .dark: return .black
        }
    }
}

/// Plain press feel for tappable stickers (cards).
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .offset(x: configuration.isPressed ? 2 : 0, y: configuration.isPressed ? 2 : 0)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == PillButtonStyle {
    static func pill(_ kind: PillButtonStyle.Kind = .primary, small: Bool = false, full: Bool = false) -> PillButtonStyle {
        PillButtonStyle(kind: kind, small: small, fullWidth: full)
    }
}
