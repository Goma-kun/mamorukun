import SwiftUI

// MARK: - 清書結果

/// 清書が終わったら全画面で見せて、確認してからコピーさせる。
/// （iOSはタップなしでもコピーできるが、内容を確かめてから渡す流れは残したい）
struct CleanupOverlay: View {
    let text: String
    var onCopy: () -> Void
    var onClose: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.6).ignoresSafeArea()
                .onTapGesture { onClose() }

            VStack(spacing: 0) {
                HStack {
                    Text("✏️ 清書できました")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.accent)
                    Spacer()
                    Button {
                        onClose()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.textFaint)
                    }
                    .accessibilityLabel("閉じる")
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)

                Divider().overlay(Theme.border)

                ScrollView {
                    Text(text)
                        .font(.system(size: 16))
                        .foregroundStyle(Theme.text)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                }

                Button {
                    onCopy()
                } label: {
                    Text("📋 コピーして次へ")
                        .font(.system(size: 16, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 12))
                        .foregroundStyle(Theme.bg)
                }
                .padding(16)
            }
            .background(Theme.bgPanel, in: RoundedRectangle(cornerRadius: 18))
            .padding(.horizontal, 16)
            .padding(.vertical, 60)
        }
        .transition(.opacity)
    }
}

// MARK: - 処理中

struct BusyOverlay: View {
    let label: String

    var body: some View {
        ZStack {
            Color.black.opacity(0.5).ignoresSafeArea()
            VStack(spacing: 14) {
                ProgressView().tint(Theme.accent).scaleEffect(1.2)
                Text(label)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.text)
            }
            .padding(28)
            .background(Theme.bgPanel, in: RoundedRectangle(cornerRadius: 16))
        }
    }
}

// MARK: - トースト

struct ToastMessage: Identifiable, Equatable {
    enum Kind { case ok, error, info }
    let id = UUID()
    let text: String
    let kind: Kind
}

struct ToastView: View {
    let message: ToastMessage

    private var colors: (bg: Color, fg: Color) {
        switch message.kind {
        case .ok:    return (Theme.okBg, Theme.ok)
        case .error: return (Theme.errorBg, Theme.errorFg)
        case .info:  return (Theme.bg, Theme.textDim)
        }
    }

    var body: some View {
        VStack {
            Spacer()
            Text(message.text)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(colors.fg)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(colors.bg, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(colors.fg.opacity(0.27)))
                .padding(.horizontal, 24)
                .padding(.bottom, 110)
        }
        .transition(.opacity)
        .allowsHitTesting(false)
    }
}

// MARK: - 共有シート

struct ShareSheet: UIViewControllerRepresentable {
    let text: String

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [text], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
