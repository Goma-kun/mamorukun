import Foundation
import OSLog

/// 実機での長時間テスト用の記録。
///
/// 画面を消したまま録音が続くかどうかは、あとから結果だけを見ても
/// 「いつ・なぜ止まったのか」が分からない。出来事を時刻つきで残しておき、
/// テストのあとに Mac から取り出して読む。
///
/// ```
/// xcrun devicectl device copy from --device 5D2E13B0-A806-5078-A8ED-7D1BCEF164AE \
///   --domain-type appDataContainer --domain-identifier jp.nishira.mamorukun \
///   --source Documents/mamorukun-diag.log --destination .
/// ```
///
/// **書き起こしの中身は書かない。**残すのは出来事の名前と数だけ。
enum Diagnostics {

    private static let logger = Logger(subsystem: "jp.nishira.mamorukun", category: "speech")

    /// ファイルへの書き込みは1本の列に並べる（オーディオ側からも呼ばれる）
    private static let queue = DispatchQueue(label: "jp.nishira.mamorukun.diagnostics")

    private static let stamp: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MM-dd HH:mm:ss"
        return f
    }()

    /// これを超えたら古いぶんを捨てる（端末を圧迫しないための上限）
    private static let sizeLimit = 256 * 1024

    static func log(_ message: String) {
        logger.notice("\(message, privacy: .public)")
        #if DEBUG
        let line = "\(stamp.string(from: Date()))  \(message)\n"
        queue.async { append(line) }
        #endif
    }

    #if DEBUG
    static var fileURL: URL? {
        FileManager.default
            .urls(for: .documentDirectory, in: .userDomainMask).first?
            .appendingPathComponent("mamorukun-diag.log")
    }

    private static func append(_ line: String) {
        guard let url = fileURL, let data = line.data(using: .utf8) else { return }

        if !FileManager.default.fileExists(atPath: url.path) {
            // 画面をロックするとiOSは既定でファイルを保護し、開けなくなる。
            // そのままだと**ロックした瞬間から記録が残らず**、
            // 「録音が止まったのか、ログが書けないだけなのか」が区別できない。
            // 起動後に一度ロックを解いていれば読み書きできる保護に落としておく。
            FileManager.default.createFile(
                atPath: url.path,
                contents: nil,
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
            )
        }

        // 開けなかったら諦める（ここで書き直すと、ログを1行で上書きしてしまう）
        guard let handle = try? FileHandle(forWritingTo: url) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: data)

        // 上限を超えたら後ろ半分だけ残す
        if let size = try? handle.offset(), size > sizeLimit,
           let whole = try? Data(contentsOf: url) {
            try? whole.suffix(sizeLimit / 2).write(to: url)
        }
    }
    #endif
}
