import Foundation

/// ヘルプデスクモードの状態（AIチャットと要約）。
@MainActor
final class HelpdeskStore: ObservableObject {

    struct ChatMessage: Identifiable, Equatable {
        enum Sender { case user, ai }
        let id = UUID()
        let sender: Sender
        let text: String

        var label: String { sender == .user ? "あなた" : "AI" }
    }

    @Published private(set) var messages: [ChatMessage] = []
    @Published private(set) var summary: String = ""
    @Published private(set) var isThinking = false

    /// APIに送る会話履歴
    private var context: [GeminiClient.Message] = []
    /// 報告書に載せるためのプレーンな会話ログ
    private(set) var chatLog: String = ""

    let startedAt = Date()

    // MARK: - チャット

    /// 初回の質問だけ、文字起こしログを前提として一緒に送る（Web版と同じ）
    func ask(_ question: String, transcript: String) async {
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }

        messages.append(ChatMessage(sender: .user, text: q))
        isThinking = true
        defer { isThinking = false }

        let prompt = context.isEmpty
            ? Prompts.helpdeskFirstQuestion(log: transcript, question: q)
            : q
        context.append(GeminiClient.Message(role: .user, text: prompt))

        // 直近10往復ぶんだけ送る
        let trimmed = Array(context.suffix(10))

        do {
            let reply = try await GeminiClient.generate(trimmed)
            messages.append(ChatMessage(sender: .ai, text: reply))
            context.append(GeminiClient.Message(role: .model, text: reply))
            chatLog += "あなた: \(q)\nAI: \(reply)\n\n"
        } catch {
            let message = (error as? GeminiClient.Failure)?.errorDescription ?? error.localizedDescription
            messages.append(ChatMessage(sender: .ai, text: message))
            // 失敗した問いかけは履歴に残さない（次の質問で同じ失敗を引きずらないため）
            context.removeLast()
        }
    }

    // MARK: - 要約

    func summarize(transcript: String) async throws {
        isThinking = true
        defer { isThinking = false }
        summary = try await GeminiClient.generate(Prompts.summary(transcript))
    }

    // MARK: - 報告書

    func buildReport(transcript: String) async throws -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ja_JP")
        f.dateFormat = "yyyy/M/d HH:mm:ss"
        return try await GeminiClient.generate(
            Prompts.report(
                log: transcript,
                chat: chatLog,
                start: f.string(from: startedAt),
                end: f.string(from: Date())
            )
        )
    }

    func reset() {
        messages = []
        summary = ""
        context = []
        chatLog = ""
    }
}
