import SwiftUI

// MARK: - ログ

struct TranscriptPanel: View {
    let transcript: String
    let interim: String
    let isRecording: Bool

    private var lines: [String] {
        transcript.split(separator: "\n").map(String.init).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if lines.isEmpty && interim.isEmpty {
                        emptyState
                    }
                    ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .font(.system(size: 16))
                            .foregroundStyle(Theme.text)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if !interim.isEmpty {
                        Text(interim)
                            .font(.system(size: 16))
                            .foregroundStyle(Theme.textFaint)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .id("interim")
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(16)
            }
            .onChange(of: transcript) { _, _ in
                withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onChange(of: interim) { _, _ in
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Text(isRecording ? "🎙️" : "🛡️").font(.system(size: 40))
            Text(isRecording ? "話しかけてください" : "「開始」を押すと文字にします")
                .font(.system(size: 14))
                .foregroundStyle(Theme.textFaint)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 80)
    }
}

// MARK: - 履歴

struct HistoryPanel: View {
    @ObservedObject var history: HistoryStore
    var onCopy: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if history.entries.isEmpty {
                    Text("履歴はまだありません")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textFaint)
                        .padding(.top, 80)
                }
                ForEach(history.entries) { entry in
                    card(entry)
                }
            }
            .padding(16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func card(_ entry: HistoryStore.Entry) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(entry.dateLabel)　\(entry.hasCleaned ? "✏️ 清書あり" : "🎙️ ログのみ")")
                .font(.system(size: 11))
                .foregroundStyle(Theme.textFaint)

            Text(entry.body)
                .font(.system(size: 14))
                .foregroundStyle(Theme.text)
                .lineLimit(6)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 10) {
                Button {
                    UIPasteboard.general.string = entry.body
                    onCopy()
                } label: {
                    Text("📋 コピー")
                        .font(.system(size: 12, weight: .semibold))
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(Theme.bgRaised, in: RoundedRectangle(cornerRadius: 8))
                        .foregroundStyle(Theme.text)
                }

                Button(role: .destructive) {
                    history.delete(entry)
                } label: {
                    Text("削除")
                        .font(.system(size: 12, weight: .semibold))
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .foregroundStyle(Theme.errorFg)
                }
                Spacer()
            }
        }
        .padding(14)
        .background(Theme.bgPanel, in: RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - AI回答

struct ChatPanel: View {
    let messages: [HelpdeskStore.ChatMessage]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 12) {
                    if messages.isEmpty {
                        Text("下の入力欄から質問できます。\n最初の質問には、ここまでの書き起こしが一緒に渡されます。")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textFaint)
                            .multilineTextAlignment(.center)
                            .padding(.top, 60)
                    }
                    ForEach(messages) { message in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(message.label)
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(message.sender == .user ? Theme.accent : Theme.ok)
                            Text(message.text)
                                .font(.system(size: 15))
                                .foregroundStyle(Theme.text)
                                .textSelection(.enabled)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(Theme.bgPanel, in: RoundedRectangle(cornerRadius: 12))
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(16)
            }
            .onChange(of: messages.count) { _, _ in
                withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - 要約

struct SummaryPanel: View {
    let text: String

    var body: some View {
        ScrollView {
            if text.isEmpty {
                Text("「要約」を押すと、ここまでの内容を箇条書きにまとめます。")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textFaint)
                    .multilineTextAlignment(.center)
                    .padding(.top, 60)
                    .padding(.horizontal, 24)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    Text(text)
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.text)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Button {
                        UIPasteboard.general.string = text
                    } label: {
                        Text("📋 コピー")
                            .font(.system(size: 12, weight: .semibold))
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .background(Theme.bgRaised, in: RoundedRectangle(cornerRadius: 8))
                            .foregroundStyle(Theme.text)
                    }
                }
                .padding(16)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
