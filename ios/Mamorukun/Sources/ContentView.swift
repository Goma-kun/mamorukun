import SwiftUI

struct ContentView: View {

    @EnvironmentObject private var settings: AppSettings
    @StateObject private var speech = SpeechService()
    @StateObject private var history = HistoryStore()
    @StateObject private var helpdesk = HelpdeskStore()

    enum Tab: Hashable { case transcript, history, chat, summary }

    @State private var tab: Tab = .transcript
    @State private var showSettings = false
    @State private var cleaned: String?          // 清書結果（オーバーレイ表示中）
    @State private var isBusy = false
    @State private var busyLabel = ""
    @State private var toast: ToastMessage?
    @State private var question = ""
    @State private var report: ReportDocument?   // 共有シート用
    @FocusState private var questionFocused: Bool

    private var tabs: [Tab] {
        settings.mode == .memo ? [.transcript, .history] : [.transcript, .chat, .summary]
    }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()

            VStack(spacing: 0) {
                header
                tabBar
                panel
                if settings.mode == .helpdesk { questionField }
                actionBar
            }

            if let cleaned {
                CleanupOverlay(text: cleaned) {
                    UIPasteboard.general.string = cleaned
                    self.cleaned = nil
                    speech.clearTranscript()
                    tab = .transcript
                    show("✅ コピーしました", .ok)
                } onClose: {
                    self.cleaned = nil
                }
            }

            if isBusy { BusyOverlay(label: busyLabel) }

            if let toast { ToastView(message: toast) }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showSettings) {
            SettingsView().environmentObject(settings)
        }
        .sheet(item: $report) { doc in
            ShareSheet(text: doc.text)
        }
        .onChange(of: settings.mode) { _, _ in
            tab = .transcript
        }
        .onChange(of: speech.errorMessage) { _, message in
            guard let message else { return }
            show(message, .error)
            speech.errorMessage = nil
        }
        // マイクと音声認識の許可は、起動直後ではなく
        // 「開始」を押したときに求める（何のための許可かが伝わる場面で聞く）
    }

    // MARK: - ヘッダー

    private var header: some View {
        HStack {
            HStack(spacing: 8) {
                Text("🛡️ まもるくん")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(Theme.text)
                Text("v\(Bundle.appVersion)")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.badge)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Theme.badge.opacity(0.15), in: RoundedRectangle(cornerRadius: 6))
            }
            Spacer()
            Button {
                showSettings = true
            } label: {
                Image(systemName: "gearshape.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(Theme.textDim)
            }
            .accessibilityLabel("設定")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Theme.bg)
        .overlay(alignment: .bottom) { Divider().overlay(Theme.border) }
    }

    // MARK: - タブ

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(tabs, id: \.self) { item in
                Button {
                    tab = item
                    questionFocused = false
                } label: {
                    VStack(spacing: 2) {
                        Text(icon(for: item)).font(.system(size: 16))
                        Text(title(for: item)).font(.system(size: 11, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .foregroundStyle(tab == item ? Theme.accent : Theme.textFaint)
                    .overlay(alignment: .bottom) {
                        Rectangle()
                            .fill(tab == item ? Theme.accent : .clear)
                            .frame(height: 2)
                    }
                }
            }
        }
        .background(Theme.bg)
        .overlay(alignment: .bottom) { Divider().overlay(Theme.border) }
    }

    private func icon(for tab: Tab) -> String {
        switch tab {
        case .transcript: return "🎙️"
        case .history:    return "🕐"
        case .chat:       return "💬"
        case .summary:    return "📄"
        }
    }

    private func title(for tab: Tab) -> String {
        switch tab {
        case .transcript: return "ログ"
        case .history:    return "履歴"
        case .chat:       return "AI回答"
        case .summary:    return "要約"
        }
    }

    // MARK: - パネル

    @ViewBuilder
    private var panel: some View {
        switch tab {
        case .transcript:
            TranscriptPanel(transcript: speech.transcript, interim: speech.interim, isRecording: speech.isRecording)
        case .history:
            HistoryPanel(history: history) { show("✅ コピーしました", .ok) }
        case .chat:
            ChatPanel(messages: helpdesk.messages)
        case .summary:
            SummaryPanel(text: helpdesk.summary)
        }
    }

    // MARK: - ヘルプデスクの質問欄

    private var questionField: some View {
        HStack(spacing: 8) {
            TextField("質問を入力…", text: $question, axis: .vertical)
                .lineLimit(1...3)
                .padding(10)
                .background(Theme.bgPanel, in: RoundedRectangle(cornerRadius: 10))
                .foregroundStyle(Theme.text)
                .focused($questionFocused)

            Button("送信") {
                let q = question
                question = ""
                questionFocused = false
                tab = .chat
                Task { await helpdesk.ask(q, transcript: speech.fullText) }
            }
            .font(.system(size: 14, weight: .bold))
            .foregroundStyle(question.isEmpty ? Theme.textFaint : Theme.accent)
            .disabled(question.trimmingCharacters(in: .whitespaces).isEmpty || helpdesk.isThinking)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.bg)
        .overlay(alignment: .top) { Divider().overlay(Theme.border) }
    }

    // MARK: - 下部のボタン

    private var actionBar: some View {
        VStack(spacing: 10) {
            Button {
                toggleRecording()
            } label: {
                Text(speech.isRecording ? "■ 停止" : "▶ 開始")
                    .font(.system(size: 18, weight: .bold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(speech.isRecording ? Theme.recording : Theme.accent,
                                in: RoundedRectangle(cornerRadius: 14))
                    .foregroundStyle(speech.isRecording ? .white : Theme.bg)
            }

            if settings.mode == .helpdesk {
                HStack(spacing: 10) {
                    Button {
                        tab = .summary
                        Task { await summarize() }
                    } label: {
                        Text("📝 要約").frame(maxWidth: .infinity).padding(.vertical, 12)
                    }
                    .background(Theme.bgRaised, in: RoundedRectangle(cornerRadius: 10))

                    Button {
                        Task { await exportReport() }
                    } label: {
                        Text("💾 終了&保存").frame(maxWidth: .infinity).padding(.vertical, 12)
                    }
                    .background(Theme.bgRaised, in: RoundedRectangle(cornerRadius: 10))
                }
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.text)
                .disabled(speech.fullText.isEmpty)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(Theme.bg)
    }

    // MARK: - 動作

    private func toggleRecording() {
        if speech.isRecording {
            speech.stop()
            // メモモードだけ、停止と同時に清書する（ヘルプデスクは自動清書しない）
            if settings.mode == .memo { Task { await runCleanup() } }
        } else {
            tab = .transcript
            Task { await speech.start(language: settings.language) }
        }
    }

    private func runCleanup() async {
        let text = speech.fullText
        guard !text.isEmpty else { return }

        // キーがなくても書き起こしは残す。清書だけができない、と伝える
        guard settings.hasAPIKey else {
            history.add(transcript: text, cleaned: "")
            show("書き起こしを履歴に保存しました。AIの清書には設定からAPIキーの登録が必要です。", .info)
            return
        }

        isBusy = true
        busyLabel = "✍️ 清書しています…"
        defer { isBusy = false }

        do {
            let result = try await GeminiClient.generate(Prompts.cleanup(text, language: settings.language))
            history.add(transcript: text, cleaned: result)
            cleaned = result
        } catch {
            history.add(transcript: text, cleaned: "")
            show(message(for: error), .error)
        }
    }

    private func summarize() async {
        guard !speech.fullText.isEmpty else { return }
        guard settings.hasAPIKey else { show(GeminiClient.Failure.noKey.errorDescription ?? "", .info); return }

        isBusy = true
        busyLabel = "📝 要約しています…"
        defer { isBusy = false }

        do {
            try await helpdesk.summarize(transcript: speech.fullText)
        } catch {
            show(message(for: error), .error)
        }
    }

    private func exportReport() async {
        guard !speech.fullText.isEmpty else { return }

        isBusy = true
        busyLabel = "💾 報告書を作成しています…"
        defer { isBusy = false }

        // キーがなければ書き起こしそのものを書き出す（何も残らないよりよい）
        guard settings.hasAPIKey else {
            report = ReportDocument(text: speech.fullText)
            return
        }

        do {
            report = ReportDocument(text: try await helpdesk.buildReport(transcript: speech.fullText))
        } catch {
            show(message(for: error), .error)
            report = ReportDocument(text: speech.fullText)
        }
    }

    private func message(for error: Error) -> String {
        (error as? GeminiClient.Failure)?.errorDescription ?? error.localizedDescription
    }

    private func show(_ text: String, _ kind: ToastMessage.Kind) {
        let message = ToastMessage(text: text, kind: kind)
        toast = message
        Task {
            try? await Task.sleep(for: .seconds(3))
            if toast?.id == message.id { toast = nil }
        }
    }
}

/// 共有シートに渡す報告書
struct ReportDocument: Identifiable {
    let id = UUID()
    let text: String
}

extension Bundle {
    static var appVersion: String {
        main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    }
}
