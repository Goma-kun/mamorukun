import Foundation

/// 音声認識の対象言語。Web版・拡張機能版と同じ11言語。
///
/// 画面表示は日本語のままで、聞き取る言語だけを切り替える方式。
/// 選択肢のラベルは各言語を自言語で表示する（翻訳しないのが慣習）。
enum RecogLanguage: String, CaseIterable, Identifiable {
    case ja   = "ja-JP"
    case enUS = "en-US"
    case enGB = "en-GB"
    case esES = "es-ES"
    case esMX = "es-MX"
    case zhCN = "zh-CN"
    case zhTW = "zh-TW"
    case ko   = "ko-KR"
    case fr   = "fr-FR"
    case de   = "de-DE"
    case ptBR = "pt-BR"

    var id: String { rawValue }

    /// 未設定時は日本語。**端末の言語設定からは推測しない。**
    ///
    /// 英語を優先言語にしている日本語話者が、いきなり英語認識になって
    /// 「壊れた」と感じる事故が実機で再現したため（Web版 v1.4.2 での判断を踏襲）。
    static let `default`: RecogLanguage = .ja

    var label: String {
        switch self {
        case .ja:   return "日本語"
        case .enUS: return "English (US)"
        case .enGB: return "English (UK)"
        case .esES: return "Español (España)"
        case .esMX: return "Español (México)"
        case .zhCN: return "中文（简体）"
        case .zhTW: return "中文（繁體）"
        case .ko:   return "한국어"
        case .fr:   return "Français"
        case .de:   return "Deutsch"
        case .ptBR: return "Português (Brasil)"
        }
    }

    var locale: Locale { Locale(identifier: rawValue) }

    var isJapanese: Bool { self == .ja }

    /// 清書プロンプトで「この言語で書け」と指定するときの英語名。
    var englishName: String {
        switch self {
        case .ja:          return "Japanese"
        case .enUS, .enGB: return "English"
        case .esES, .esMX: return "Spanish"
        case .zhCN, .zhTW: return "Chinese"
        case .ko:          return "Korean"
        case .fr:          return "French"
        case .de:          return "German"
        case .ptBR:        return "Portuguese"
        }
    }
}
