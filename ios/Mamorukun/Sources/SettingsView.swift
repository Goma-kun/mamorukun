import SwiftUI

struct SettingsView: View {

    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    @State private var keyInput = ""
    @State private var isTesting = false
    @State private var testResult: TestResult?
    @State private var showKey = false

    private enum TestResult: Equatable {
        case ok
        case failed(String)
    }

    var body: some View {
        NavigationStack {
            Form {
                modeSection
                apiKeySection
                languageSection
                aboutSection
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("設定")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("閉じる") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    // MARK: - モード

    private var modeSection: some View {
        Section {
            ForEach(AppMode.allCases) { mode in
                Button {
                    settings.mode = mode
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(mode.title)
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(settings.mode == mode ? Theme.accent : Theme.text)
                            Text(mode.subtitle)
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textFaint)
                                .multilineTextAlignment(.leading)
                        }
                        Spacer()
                        if settings.mode == mode {
                            Image(systemName: "checkmark").foregroundStyle(Theme.accent)
                        }
                    }
                }
            }
        } header: {
            Text("モード")
        } footer: {
            Text("使う場面に合わせて切り替えられます。あとから何度でも変えられます。")
        }
        .listRowBackground(Theme.bgPanel)
    }

    // MARK: - APIキー

    private var apiKeySection: some View {
        Section {
            if settings.hasAPIKey && keyInput.isEmpty {
                HStack {
                    Label("登録済み", systemImage: "checkmark.seal.fill")
                        .foregroundStyle(Theme.ok)
                        .font(.system(size: 14, weight: .semibold))
                    Spacer()
                    Button("削除", role: .destructive) {
                        settings.deleteAPIKey()
                        testResult = nil
                    }
                    .font(.system(size: 13))
                }
            }

            HStack {
                Group {
                    if showKey {
                        TextField("AIza...", text: $keyInput)
                    } else {
                        SecureField(settings.hasAPIKey ? "新しいキーに変更する場合のみ入力" : "AIza...", text: $keyInput)
                    }
                }
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.system(size: 14, design: .monospaced))

                Button {
                    showKey.toggle()
                } label: {
                    Image(systemName: showKey ? "eye.slash" : "eye")
                        .foregroundStyle(Theme.textFaint)
                }
            }

            Button {
                save()
            } label: {
                Text("保存する")
                    .font(.system(size: 14, weight: .bold))
                    .frame(maxWidth: .infinity)
            }
            .disabled(keyInput.trimmingCharacters(in: .whitespaces).isEmpty)

            Button {
                Task { await test() }
            } label: {
                HStack {
                    if isTesting { ProgressView().tint(Theme.accent) }
                    Text(isTesting ? "確認しています…" : "接続テスト")
                        .font(.system(size: 14, weight: .semibold))
                }
                .frame(maxWidth: .infinity)
            }
            .disabled(isTesting || !settings.hasAPIKey)

            switch testResult {
            case .ok:
                Label("つながりました。清書が使えます。", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.ok)
            case .failed(let message):
                Text(message)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.errorFg)
            case nil:
                EmptyView()
            }

        } header: {
            Text("Gemini APIキー")
        } footer: {
            VStack(alignment: .leading, spacing: 8) {
                Text("AIによる清書・要約・チャットに使います。キーがなくても、話した内容を文字にする機能はそのままお使いいただけます。")
                Text("キーはこの端末の中（キーチェーン）にのみ保存され、開発者に送られることはありません。")
                Text("⚠️ 新しく作った無料のプロジェクトのキーは、Google側で利用が許可されず使えないことがあります。その場合は、請求先アカウントを設定したプロジェクトのキーをお使いください（従量課金になります）。")
                    .foregroundStyle(Theme.badge)
                Link("キーの取得はこちら（Google AI Studio）", destination: URL(string: "https://aistudio.google.com/apikey")!)
                    .font(.system(size: 13, weight: .semibold))
            }
            .font(.system(size: 12))
        }
        .listRowBackground(Theme.bgPanel)
    }

    // MARK: - 言語

    private var languageSection: some View {
        Section {
            Picker("聞き取る言語", selection: Binding(
                get: { settings.language },
                set: { settings.language = $0 }
            )) {
                ForEach(RecogLanguage.allCases) { lang in
                    Text(lang.label).tag(lang)
                }
            }
        } header: {
            Text("音声認識の言語")
        } footer: {
            Text("画面の表示は日本語のまま、聞き取る言語だけを変えられます（英語の練習などに）。清書も同じ言語で行います。録音中に変えた場合は、次の録音から反映されます。")
                .font(.system(size: 12))
        }
        .listRowBackground(Theme.bgPanel)
    }

    // MARK: - このアプリについて

    private var aboutSection: some View {
        Section {
            LabeledContent("バージョン", value: Bundle.appVersion)
            Link("プライバシーポリシー", destination: URL(string: "https://goma-kun.github.io/mamorukun/privacy-policy-ios.html")!)
            Link("お問い合わせ", destination: URL(string: "https://github.com/Goma-kun/mamorukun/issues")!)
        } header: {
            Text("このアプリについて")
        } footer: {
            Text("提供：ニシラ")
        }
        .listRowBackground(Theme.bgPanel)
    }

    // MARK: - 動作

    private func save() {
        settings.saveAPIKey(keyInput)
        keyInput = ""
        showKey = false
        testResult = nil
        Task { await test() }
    }

    private func test() async {
        isTesting = true
        testResult = nil
        defer { isTesting = false }

        switch await GeminiClient.testConnection() {
        case .success:
            testResult = .ok
        case .failure(let failure):
            testResult = .failed(failure.errorDescription ?? "確認できませんでした。")
        }
    }
}
