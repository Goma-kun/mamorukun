import Foundation

/// 動作モード。Web版の2モードをそのまま持ち込む。
enum AppMode: String, CaseIterable, Identifiable {
    /// 個人メモ用：清書 → コピー → クリア
    case memo
    /// 業務用：AIチャット・要約・報告書
    case helpdesk

    var id: String { rawValue }

    var title: String {
        switch self {
        case .memo:     return "📝 メモモード（個人用）"
        case .helpdesk: return "🏢 ヘルプデスクモード"
        }
    }

    var subtitle: String {
        switch self {
        case .memo:     return "清書→コピー→クリア。シンプルな個人メモ用。"
        case .helpdesk: return "AIチャット・要約・ログ保存。業務サポート向け。"
        }
    }
}

/// 端末に残す設定。APIキーだけはここではなくKeychainに置く。
@MainActor
final class AppSettings: ObservableObject {

    @Published var mode: AppMode {
        didSet { UserDefaults.standard.set(mode.rawValue, forKey: Keys.mode) }
    }

    @Published var language: RecogLanguage {
        didSet { UserDefaults.standard.set(language.rawValue, forKey: Keys.language) }
    }

    /// APIキーの有無だけをUIに伝えるためのフラグ（キー本体はKeychainから都度読む）
    @Published private(set) var hasAPIKey: Bool

    private enum Keys {
        static let mode = "mamoru_mode"
        static let language = "mamoru_lang"
    }

    init() {
        let saved = UserDefaults.standard.string(forKey: Keys.mode)
        mode = AppMode(rawValue: saved ?? "") ?? .memo

        let lang = UserDefaults.standard.string(forKey: Keys.language)
        language = RecogLanguage(rawValue: lang ?? "") ?? .default

        hasAPIKey = KeychainStore.hasKey
    }

    func saveAPIKey(_ key: String) {
        KeychainStore.apiKey = key
        hasAPIKey = KeychainStore.hasKey
    }

    func deleteAPIKey() {
        KeychainStore.apiKey = nil
        hasAPIKey = false
    }
}
