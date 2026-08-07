import Foundation

/// Gemini API をユーザー自身のキーで直接呼ぶ。開発者のサーバーは経由しない。
struct GeminiClient {

    /// モデルは全機能でこれに統一する（拡張機能・Web版と揃える）
    static let model = "gemini-2.5-flash"

    private static let endpoint = URL(
        string: "https://generativelanguage.googleapis.com/v1beta/models/\(model):generateContent"
    )!

    struct Message {
        enum Role: String { case user, model }
        let role: Role
        let text: String
    }

    enum Failure: LocalizedError {
        /// APIキーが未設定
        case noKey
        /// キーそのものが不正（401 / 400）
        case keyInvalid
        /// プロジェクトがアクセス拒否（403）。無料枠のプロジェクトで起きる
        case projectDenied
        /// レート制限（429）
        case rateLimited
        case server(String)
        case network(String)
        case empty

        var errorDescription: String? {
            switch self {
            case .noKey:
                return "AIによる清書には、Google の APIキーが必要です。設定画面から登録してください。"
            case .keyInvalid:
                return "APIキーが正しくないようです。設定画面でもう一度ご確認ください。"
            case .projectDenied:
                return """
                このAPIキーのプロジェクトは、Google 側で利用が許可されていません。

                新しく作った無料のプロジェクトで起きることがあります。Google AI Studio のキー一覧で「請求階層」が「使用不可」になっていないかご確認ください。請求先アカウントを設定したプロジェクトのキーであれば通ります（従量課金になります）。
                """
            case .rateLimited:
                return "アクセスが集中しています。少し時間をおいてからお試しください。"
            case .server(let m):
                return "AIの応答でエラーが起きました: \(m)"
            case .network(let m):
                return "通信に失敗しました: \(m)"
            case .empty:
                return "AIから応答がありませんでした。もう一度お試しください。"
            }
        }
    }

    /// 単発のプロンプトを投げる
    ///
    /// - Parameter disableThinking: 清書のように考える必要のない用途では true にする。
    ///   拡張機能版と同じく `thinkingBudget: 0` を送って待ち時間を減らす。
    static func generate(_ prompt: String, disableThinking: Bool = false) async throws -> String {
        try await generate([Message(role: .user, text: prompt)], disableThinking: disableThinking)
    }

    /// 会話履歴つきで投げる
    static func generate(_ messages: [Message], disableThinking: Bool = false) async throws -> String {
        guard let key = KeychainStore.apiKey else { throw Failure.noKey }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // キーはURLではなくヘッダーで渡す（ログやRefererに残さないため）
        request.setValue(key, forHTTPHeaderField: "x-goog-api-key")
        request.timeoutInterval = 60

        var body: [String: Any] = [
            "contents": messages.map { [
                "role": $0.role.rawValue,
                "parts": [["text": $0.text]],
            ] }
        ]
        if disableThinking {
            body["generationConfig"] = ["thinkingConfig": ["thinkingBudget": 0]]
            body["tools"] = []
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw Failure.network(error.localizedDescription)
        }

        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]

        guard (200..<300).contains(status) else {
            let message = ((json?["error"] as? [String: Any])?["message"] as? String) ?? ""
            throw classify(status: status, message: message)
        }

        guard
            let candidates = json?["candidates"] as? [[String: Any]],
            let content = candidates.first?["content"] as? [String: Any],
            let parts = content["parts"] as? [[String: Any]]
        else { throw Failure.empty }

        let text = parts.compactMap { $0["text"] as? String }.joined()
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw Failure.empty }
        return text
    }

    /// エラーの出し分け。拡張機能 v1.5.1 の `errDenied` / `errKeyInvalid` と同じ分類。
    ///
    /// 403 + "denied access" は「キーが間違っている」ではなく
    /// 「プロジェクトに無料枠が割り当てられていない」ケースで、案内する内容がまったく違う。
    private static func classify(status: Int, message: String) -> Failure {
        let lower = message.lowercased()
        switch status {
        case 403 where lower.contains("denied access") || lower.contains("permission_denied"):
            return .projectDenied
        case 400, 401:
            if lower.contains("api key") || lower.contains("api_key") || lower.contains("invalid") {
                return .keyInvalid
            }
            return .server(message.isEmpty ? "HTTP \(status)" : message)
        case 403:
            return .keyInvalid
        case 429:
            return .rateLimited
        default:
            return .server(message.isEmpty ? "HTTP \(status)" : message)
        }
    }

    /// 設定画面の接続テスト
    static func testConnection() async -> Result<Void, Failure> {
        do {
            _ = try await generate("こんにちは、と一言だけ返してください。")
            return .success(())
        } catch let failure as Failure {
            return .failure(failure)
        } catch {
            return .failure(.network(error.localizedDescription))
        }
    }
}
