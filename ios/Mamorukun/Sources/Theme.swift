import SwiftUI

/// Web版・拡張機能版と揃えた配色。ダーク基調で固定する。
enum Theme {
    static let bg          = Color(hex: 0x0F172A)
    static let bgPanel     = Color(hex: 0x1E293B)
    static let bgRaised    = Color(hex: 0x334155)
    static let border      = Color(hex: 0x334155)
    static let text        = Color(hex: 0xE2E8F0)
    static let textDim     = Color(hex: 0x94A3B8)
    static let textFaint   = Color(hex: 0x64748B)
    static let accent      = Color(hex: 0x38BDF8)
    static let recording   = Color(hex: 0xEF4444)
    static let ok          = Color(hex: 0x4ADE80)
    static let okBg        = Color(hex: 0x052E16)
    static let errorFg     = Color(hex: 0xF87171)
    static let errorBg     = Color(hex: 0x450A0A)
    static let badge       = Color(hex: 0xFBBF24)
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red:   Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >>  8) & 0xFF) / 255,
            blue:  Double( hex        & 0xFF) / 255,
            opacity: 1
        )
    }
}
