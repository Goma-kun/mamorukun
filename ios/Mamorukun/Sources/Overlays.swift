import SwiftUI

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
    /// 実際に保存・送信までいったら true で呼ばれる（キャンセルなら false）
    var onFinish: (Bool) -> Void = { _ in }

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: [text], applicationActivities: nil)
        controller.completionWithItemsHandler = { _, completed, _, _ in
            onFinish(completed)
        }
        return controller
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
