import Foundation
import Speech
import AVFoundation
import UIKit

/// オーディオスレッドと画面側の橋渡し。
///
/// マイクのタップはリアルタイムの別スレッドから呼ばれるので、
/// 認識リクエストの差し替えと `append` をロックで守る。
private final class AudioSink: @unchecked Sendable {
    private let lock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?

    func attach(_ request: SFSpeechAudioBufferRecognitionRequest?) {
        lock.lock(); defer { lock.unlock() }
        self.request = request
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock(); defer { lock.unlock() }
        request?.append(buffer)
    }
}

/// マイク入力を文字にする。
///
/// `SFSpeechRecognizer` の認識タスクは1分程度で打ち切られるため、
/// **オーディオエンジンは回したまま、認識リクエストだけを張り直す**方式にしている。
/// 確定したテキストは自前で積んでいくので、張り直しの前後で内容は失われない。
/// （Web版が「毎サイクル新しい認識オブジェクトを作る」のと同じ考え方）
@MainActor
final class SpeechService: ObservableObject {

    /// 確定済みの全文（改行区切り）
    @Published private(set) var transcript: String = ""
    /// 認識中の未確定テキスト
    @Published private(set) var interim: String = ""
    @Published private(set) var isRecording = false
    @Published var errorMessage: String?

    enum Permission { case unknown, granted, denied }
    @Published private(set) var permission: Permission = .unknown

    private let audioEngine = AVAudioEngine()
    private let sink = AudioSink()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    /// 現在の認識タスクが返している最新テキスト（このタスクの担当ぶんだけ）
    private var segmentText: String = ""
    /// 締めたタスクのテキスト。最終結果が届かなかったときの保険に使う
    private var lastClosedText = ""
    /// 認識タスクの世代。古いタスクから遅れて届く結果を捨てるのに使う
    private var generation = 0

    private var language: RecogLanguage = .default

    /// 電話の着信などで中断された状態か
    private var wasInterrupted = false
    private var interruptionObserver: NSObjectProtocol?

    /// 発話が途切れたと判断するまでの秒数。
    ///
    /// Chrome の Web Speech API は無音がおよそ1秒続くと確定を返す。
    /// Web版・拡張機能版の体感に合わせてここを 1.0 にしている。
    /// 短くすると息継ぎで行が切れ、長くすると確定が遅れる。
    private let silenceThreshold: TimeInterval = 1.0
    private var silenceTimer: Timer?

    init() {
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            Task { @MainActor [weak self] in
                self?.handleInterruption(raw)
            }
        }
    }

    deinit {
        if let interruptionObserver {
            NotificationCenter.default.removeObserver(interruptionObserver)
        }
    }

    /// 着信・他アプリの再生などで録音が止められたときの処理。
    /// 録音中だったなら、中断が明けた時点で自動的に再開する。
    private func handleInterruption(_ rawType: UInt?) {
        guard let rawType, let type = AVAudioSession.InterruptionType(rawValue: rawType) else { return }

        switch type {
        case .began:
            guard isRecording else { return }
            wasInterrupted = true
            commitSegment()
            task?.cancel()
            task = nil
            sink.attach(nil)
            request?.endAudio()
            request = nil
            if audioEngine.isRunning { audioEngine.stop() }

        case .ended:
            guard wasInterrupted, isRecording else { return }
            wasInterrupted = false
            do {
                try configureSession()
                try startEngine()
                startRecognitionTask()
            } catch {
                isRecording = false
                UIApplication.shared.isIdleTimerDisabled = false
                errorMessage = "録音が中断されました。もう一度「開始」を押してください。"
            }

        @unknown default:
            break
        }
    }

    // MARK: - 権限

    /// マイクと音声認識の許可を求める
    func requestPermission() async {
        let speech = await withCheckedContinuation { (c: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
            SFSpeechRecognizer.requestAuthorization { status in c.resume(returning: status) }
        }
        guard speech == .authorized else {
            permission = .denied
            return
        }

        let mic = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
            AVAudioApplication.requestRecordPermission { granted in c.resume(returning: granted) }
        }
        permission = mic ? .granted : .denied
    }

    // MARK: - 録音

    func start(language: RecogLanguage) async {
        guard !isRecording else { return }

        if permission != .granted { await requestPermission() }
        guard permission == .granted else {
            errorMessage = "マイクと音声認識の使用を許可してください。「設定」アプリのまもるくんの項目から変更できます。"
            return
        }

        self.language = language
        guard let recognizer = SFSpeechRecognizer(locale: language.locale), recognizer.isAvailable else {
            errorMessage = "この言語の音声認識が使えません。別の言語を選ぶか、少し時間をおいてお試しください。"
            return
        }
        self.recognizer = recognizer

        do {
            try configureSession()
            try startEngine()
        } catch {
            errorMessage = "マイクを開始できませんでした: \(error.localizedDescription)"
            teardown()
            return
        }

        isRecording = true
        UIApplication.shared.isIdleTimerDisabled = true   // 録音中は画面を消さない
        startRecognitionTask()
    }

    func stop() {
        guard isRecording else { return }
        isRecording = false
        commitSegment()
        teardown()
    }

    func clearTranscript() {
        transcript = ""
        interim = ""
        segmentText = ""
    }

    /// 清書・履歴に渡す本文
    var fullText: String {
        transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - 内部

    private func configureSession() throws {
        let session = AVAudioSession.sharedInstance()
        // .measurement は自動ゲイン等の加工を抑え、認識精度を優先する設定
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker])
        try session.setActive(true, options: .notifyOthersOnDeactivation)
    }

    private func startEngine() throws {
        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        let sink = self.sink

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            // ここはオーディオスレッド。リクエストへ流すだけに留める
            sink.append(buffer)
        }

        audioEngine.prepare()
        try audioEngine.start()
    }

    private func teardown() {
        UIApplication.shared.isIdleTimerDisabled = false
        silenceTimer?.invalidate()
        silenceTimer = nil
        generation += 1   // 動いているタスクの結果は、もう受け取らない

        task?.cancel()
        task = nil
        sink.attach(nil)
        request?.endAudio()
        request = nil

        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine.inputNode.removeTap(onBus: 0)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// 認識リクエストを1本張る。
    ///
    /// 1本 ＝ ひとまとまりの発話。話が途切れたら締めて、次の1本を張る。
    private func startRecognitionTask() {
        guard isRecording, let recognizer else { return }

        // 世代番号。古いタスクから遅れて届く結果を捨てるために使う。
        // これが無いと、締めたあとに前のタスクの結果が届いて確定済みの内容が復活し、
        // 次の区切りでもう一度確定されて二重になる
        generation += 1
        let generation = self.generation

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        // 端末内で完結できる言語ではそうする（通信なしで速く、音声が外に出ない）
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        self.request = request
        sink.attach(request)
        segmentText = ""

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            // コールバックは任意スレッド。値だけ取り出してから画面側へ渡す
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            let failed = error != nil

            Task { @MainActor [weak self] in
                guard let self else { return }

                if generation == self.generation {
                    // 現役のタスク
                    if let text, !text.isEmpty { self.updateSegment(text) }
                    // 1分制限や一時的な失敗で終わった場合。
                    // 録音中なら黙って次を張るのが正しい（Web版で Load Failed を無視するのと同じ判断）
                    if isFinal || failed { self.commitAndRestart() }
                } else if isFinal || failed {
                    // 締めた古いタスクから最終結果が届いた。これを確定分に積む
                    self.commitClosed(text)
                }
            }
        }
    }

    /// 認識中テキストの更新。
    ///
    /// このテキストは「このタスクが受け取った音声の全文」で、精度が上がると
    /// 前より短く書き換わることもある（言い直しの修正）。素直に差し替えるだけにして、
    /// 区切りの判断はタイマーに任せる。
    private func updateSegment(_ text: String) {
        segmentText = text
        interim = text
        scheduleSilenceCheck()
    }

    /// 話が途切れたら、こちらから締める。
    ///
    /// iOSの `isFinal` は無音が続いても返ってこないことがあるので、
    /// 待っているだけでは発話がいつまでも確定しない。
    private func scheduleSilenceCheck() {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: silenceThreshold, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.closeCurrentSegment()
            }
        }
    }

    /// いまの認識を締める。
    ///
    /// 2つの理由でこの形にしている。
    ///
    /// 1. `cancel()` で打ち切らず `endAudio()` で締める。締めるとiOSが最終結果を返すので、
    ///    それで確定できる。打ち切ると結果が捨てられ、中途半端なテキストで確定することになる
    /// 2. 締めるより先に次の認識を張る。最終結果を待ってから次を張ると、その一瞬のあいだ
    ///    マイクの音声が行き場を失い、黙ったあとすぐ話し始めた出だしが落ちる
    private func closeCurrentSegment() {
        guard isRecording, !segmentText.isEmpty else { return }
        silenceTimer?.invalidate()
        silenceTimer = nil

        let closing = request
        // 最終結果が届かなかったときの保険。届けばそちらを優先する
        lastClosedText = segmentText

        startRecognitionTask()   // 先に次を張って、音声を途切れさせない
        closing?.endAudio()      // そのうえで古い方を締める
    }

    /// 締めた古いタスクの最終結果を確定分に積む
    private func commitClosed(_ text: String?) {
        let fromTask = text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let result = fromTask.isEmpty
            ? lastClosedText.trimmingCharacters(in: .whitespacesAndNewlines)
            : fromTask
        lastClosedText = ""
        guard !result.isEmpty else { return }
        transcript += result + "\n"
    }

    /// 現在のセグメントを確定分へ移す
    private func commitSegment() {
        let text = segmentText.trimmingCharacters(in: .whitespacesAndNewlines)
        segmentText = ""
        interim = ""
        guard !text.isEmpty else { return }
        transcript += text + "\n"
    }

    /// 確定して次の1本を張る。オーディオエンジンは止めない。
    private func commitAndRestart() {
        guard isRecording else { return }

        silenceTimer?.invalidate()
        silenceTimer = nil
        commitSegment()

        task = nil
        sink.attach(nil)
        request = nil

        startRecognitionTask()
    }
}
