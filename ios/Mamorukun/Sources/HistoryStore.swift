import Foundation

/// 直近の書き起こしを端末内に残す。Web版と同じく既定は3件。
@MainActor
final class HistoryStore: ObservableObject {

    struct Entry: Codable, Identifiable, Equatable {
        let id: UUID
        let date: Date
        let transcript: String
        let cleaned: String

        /// コピー・表示に使う本文（清書があればそちら）
        var body: String { cleaned.isEmpty ? transcript : cleaned }
        var hasCleaned: Bool { !cleaned.isEmpty }

        var dateLabel: String {
            let f = DateFormatter()
            f.locale = Locale(identifier: "ja_JP")
            f.dateFormat = "M月d日 HH:mm"
            return f.string(from: date)
        }
    }

    @Published private(set) var entries: [Entry] = []

    private let limit = 3
    private let fileURL: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("history.json")
    }()

    init() { load() }

    func add(transcript: String, cleaned: String) {
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        entries.insert(Entry(id: UUID(), date: Date(), transcript: text, cleaned: cleaned), at: 0)
        if entries.count > limit { entries = Array(entries.prefix(limit)) }
        save()
    }

    func delete(_ entry: Entry) {
        entries.removeAll { $0.id == entry.id }
        save()
    }

    func clear() {
        entries = []
        save()
    }

    private func load() {
        guard let data = try? Data(contentsOf: fileURL),
              let decoded = try? JSONDecoder().decode([Entry].self, from: data)
        else { return }
        entries = decoded
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(entries) else { return }
        // 端末内のみ。iCloudバックアップにも載せない
        try? data.write(to: fileURL, options: .atomic)
        var url = fileURL
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
    }
}
