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

    /// 音声認識を端末の中だけで行うか。
    ///
    /// 端末内は通信せず、音声が外に出ず、画面を消しても止まらない。
    /// 代わりに辞書が小さく、製品名や専門用語を取り違えやすい。
    /// サーバー側はその逆で、精度は上がるが通信が要る。
    ///
    /// **既定は端末内。** 画面を消したまま録音できることがiOS版を作った理由なので、
    /// 何も選んでいない人がそれを失わないほうを初期値にする。
    @Published var onDeviceRecognition: Bool {
        didSet { UserDefaults.standard.set(onDeviceRecognition, forKey: Keys.onDevice) }
    }

    /// APIキーの有無だけをUIに伝えるためのフラグ（キー本体はKeychainから都度読む）
    @Published private(set) var hasAPIKey: Bool

    private enum Keys {
        static let mode = "mamoru_mode"
        static let language = "mamoru_lang"
        static let onDevice = "mamoru_ondevice"
    }

    init() {
        let saved = UserDefaults.standard.string(forKey: Keys.mode)
        mode = AppMode(rawValue: saved ?? "") ?? .memo

        let lang = UserDefaults.standard.string(forKey: Keys.language)
        language = RecogLanguage(rawValue: lang ?? "") ?? .default

        // 未設定なら端末内。object(forKey:) で「未設定」と「false」を区別する
        onDeviceRecognition = (UserDefaults.standard.object(forKey: Keys.onDevice) as? Bool) ?? true

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
