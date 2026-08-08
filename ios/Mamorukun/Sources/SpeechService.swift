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

    /// 直近の音声。認識を張り替えるときに、これを新しい方へ流し込む。
    ///
    /// 認識エンジンは動き出すまでに一瞬かかるので、張り替えた直後に話し始めると
    /// その出だしが落ちる。少し前から渡してやることで取りこぼさない。
    private var recent: [AVAudioPCMBuffer] = []
    /// 1バッファ 1024フレーム（48kHzで約21ミリ秒）。20個でおよそ0.42秒。
    ///
    /// ここを長くしすぎると、前の発話の末尾まで巻き戻して渡すことになり、
    /// 次の行の先頭に同じ言葉が重複して出る。iOSが認識中テキストを返すのは
    /// 実際に喋ってから0.3〜0.5秒遅れるためで、**締めるタイミングとの兼ね合いで決まる**。
    ///
    /// `silenceThreshold` が0.8秒だった頃は、締めた時点が実際の発話終了から
    /// 0.3〜0.5秒しか経っておらず、0.2秒（10個）が限界だった。
    /// 1.2秒に延ばしたことで発話終了から0.7〜0.9秒の余裕ができたので、
    /// 0.42秒巻き戻してもまだ無音の中に収まる。
    ///
    /// 0.2秒のままだと新しい認識の起動ラグを埋めきれず、
    /// 「一度切って話し始めると出だしが落ちる」症状が出る（2026-08-08に実機で再現）。
    private let recentLimit = 20

    /// - Parameter withPreroll: 直前の音声を流し込むなら true
    func attach(_ request: SFSpeechAudioBufferRecognitionRequest?, withPreroll: Bool = false) {
        lock.lock(); defer { lock.unlock() }
        self.request = request
        guard let request, withPreroll else { return }
        for buffer in recent { request.append(buffer) }
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock(); defer { lock.unlock() }

        // タップが渡すバッファは使い回される可能性があるので、貯めるぶんは複製する
        if let copy = Self.copy(buffer) {
            recent.append(copy)
            if recent.count > recentLimit { recent.removeFirst() }
        }
        request?.append(buffer)
    }

    private static func copy(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let out = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else { return nil }
        out.frameLength = buffer.frameLength

        let channels = Int(buffer.format.channelCount)
        let frames = Int(buffer.frameLength)

        if let src = buffer.floatChannelData, let dst = out.floatChannelData {
            for ch in 0..<channels {
                memcpy(dst[ch], src[ch], frames * MemoryLayout<Float>.size)
            }
        } else if let src = buffer.int16ChannelData, let dst = out.int16ChannelData {
            for ch in 0..<channels {
                memcpy(dst[ch], src[ch], frames * MemoryLayout<Int16>.size)
            }
        } else {
            return nil
        }
        return out
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
    ///
    /// 確定した行が消えるのは、どんな理由であれ不具合。
    /// 起きたことに気づけるよう、減ったら記録に残す（実機で追うのが難しいため）。
    @Published private(set) var transcript: String = "" {
        didSet {
            guard isRecording else { return }
            let before = oldValue.split(separator: "\n").count
            let after = transcript.split(separator: "\n").count
            if after < before {
                Diagnostics.log("⚠️ 確定行が減った \(before) → \(after)")
            }
        }
    }
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
    /// 締めたタスクごとの暫定テキスト（世代番号で引く）。
    /// 最終結果が届いたら、この行を差し替える
    private var provisionalLines: [Int: String] = [:]
    /// 認識タスクの世代。古いタスクから遅れて届く結果を捨てるのに使う
    private var generation = 0

    private var language: RecogLanguage = .default
    /// 端末内だけで認識するか（録音開始時に設定から受け取る）
    private var useOnDevice = true

    /// 電話の着信などで中断された状態か
    private var wasInterrupted = false
    private var interruptionObserver: NSObjectProtocol?

    /// 発話が途切れたと判断するまでの秒数。
    ///
    /// 短くすると確定が速くなるが、息継ぎで行が切れやすくなる。
    /// 張り替え時に直前の音声を渡すようにした（AudioSink のプリロール）ので、
    /// 短めでも話し始めを取りこぼさない。
    ///
    /// 0.8秒で実機を20分使ったところ「一瞬でも間を開けるとすぐ改行される・使いづらい」
    /// となったため1.2秒にした（2026-08-08）。拡張機能版が使っている Web Speech API は
    /// 自前で区切りを判断していて、体感はこのあたりに近い。
    private let silenceThreshold: TimeInterval = 1.2
    private var silenceTimer: Timer?

    /// いまの認識タスクを張った時刻。張った直後に失敗が続く暴走を見つけるのに使う
    private var taskStartedAt = Date()
    /// 張った直後に失敗した回数
    private var consecutiveFailures = 0
    private var restartTimer: Timer?

    /// 張ってからこの秒数以内に終わったら「即失敗」とみなす
    private let failureWindow: TimeInterval = 1.0
    /// 即失敗がこれだけ続いたら、黙って回り続けずに諦めて知らせる
    private let failureLimit = 8

    /// 録音を始めた時刻と、生存確認のログを出すタイマー（長時間テスト用）
    private var startedAt = Date()
    private var heartbeatTimer: Timer?

    private var observers: [NSObjectProtocol] = []

    init() {
        let center = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()

        interruptionObserver = center.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: session,
            queue: .main
        ) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            Task { @MainActor [weak self] in
                self?.handleInterruption(raw)
            }
        }

        // 入力の経路やフォーマットが変わるとエンジンは自分で止まる。
        // 張り直さないと、音が来ないまま「録音中」の表示だけが続く
        observers.append(center.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: audioEngine,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.restartAudio(reason: "構成の変化")
            }
        })

        // 音声系そのものが作り直された。セッションもエンジンも張り直しになる
        observers.append(center.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification,
            object: session,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.restartAudio(reason: "音声系のリセット")
            }
        })

        // 経路の変化そのものは異常ではないが、止まったときの手がかりになるので残す
        observers.append(center.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: session,
            queue: .main
        ) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
            Task { @MainActor [weak self] in
                guard self?.isRecording == true else { return }
                Diagnostics.log("経路が変わった reason=\(raw)")
            }
        })

        for name in [UIApplication.didEnterBackgroundNotification,
                     UIApplication.willEnterForegroundNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard self?.isRecording == true else { return }
                    let back = name == UIApplication.didEnterBackgroundNotification
                    Diagnostics.log(back ? "バックグラウンドへ" : "フォアグラウンドへ復帰")
                }
            })
        }
    }

    deinit {
        let center = NotificationCenter.default
        if let interruptionObserver {
            center.removeObserver(interruptionObserver)
        }
        for observer in observers { center.removeObserver(observer) }
    }

    /// 着信・他アプリの再生などで録音が止められたときの処理。
    /// 録音中だったなら、中断が明けた時点で自動的に再開する。
    private func handleInterruption(_ rawType: UInt?) {
        guard let rawType, let type = AVAudioSession.InterruptionType(rawValue: rawType) else { return }

        switch type {
        case .began:
            guard isRecording else { return }
            Diagnostics.log("中断された（着信など）")
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
                Diagnostics.log("中断から復帰した")
            } catch {
                Diagnostics.log("中断から復帰できなかった: \(error.localizedDescription)")
                isRecording = false
                teardown()
                errorMessage = "録音が中断されました。もう一度「開始」を押してください。"
            }

        @unknown default:
            break
        }
    }

    /// オーディオを丸ごと張り直す。
    ///
    /// 入力の経路やフォーマットが変わったとき（`AVAudioEngineConfigurationChange`）と、
    /// 音声系がリセットされたときに呼ぶ。どちらもエンジンは既に止まっていて、
    /// タップに渡していたフォーマットも古い。**張り直さないと、音が届かないまま
    /// 「録音中」の表示だけが続く**という、いちばん気づきにくい壊れ方になる。
    private func restartAudio(reason: String) {
        guard isRecording, !wasInterrupted else { return }
        Diagnostics.log("オーディオを張り直す（\(reason)）")

        silenceTimer?.invalidate()
        silenceTimer = nil
        restartTimer?.invalidate()
        restartTimer = nil

        commitSegment()      // 手元まで確定させてから捨てる
        generation += 1      // 動いているタスクの結果は、もう受け取らない
        task?.cancel()
        task = nil
        sink.attach(nil)
        request?.endAudio()
        request = nil

        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)

        do {
            try configureSession()
            try startEngine()
            startRecognitionTask()
            Diagnostics.log("張り直せた（\(reason)）")
        } catch {
            Diagnostics.log("張り直しに失敗（\(reason)）: \(error.localizedDescription)")
            isRecording = false
            teardown()
            errorMessage = "録音を続けられなくなりました。もう一度「開始」を押してください。"
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

    /// - Parameter onDevice: 端末内だけで認識するなら true。
    ///   false にすると Apple のサーバー側認識になり、精度は上がるが通信が要る。
    func start(language: RecogLanguage, onDevice: Bool) async {
        guard !isRecording else { return }

        if permission != .granted { await requestPermission() }
        guard permission == .granted else {
            errorMessage = "マイクと音声認識の使用を許可してください。「設定」アプリのまもるくんの項目から変更できます。"
            return
        }

        self.language = language
        // 端末内認識に対応していない言語では、選択に関わらずサーバー側になる
        self.useOnDevice = onDevice
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
        UIApplication.shared.isIdleTimerDisabled = true   // 録音中は自動では画面を消さない
        startedAt = Date()
        consecutiveFailures = 0
        let actuallyOnDevice = onDevice && recognizer.supportsOnDeviceRecognition
        Diagnostics.log("開始 lang=\(language.rawValue) 端末内認識=\(actuallyOnDevice) 希望=\(onDevice)")
        startHeartbeat()
        startRecognitionTask()
    }

    func stop() {
        guard isRecording else { return }
        isRecording = false
        let minutes = Date().timeIntervalSince(startedAt) / 60
        Diagnostics.log(String(format: "停止 経過=%.1f分 行数=%d", minutes, transcript.split(separator: "\n").count))
        commitSegment()
        teardown()
    }

    /// 画面を消したまま続いているかを確かめるための記録。30秒ごとに1行残す。
    ///
    /// 途中で切れた場合、ログが途絶えた時刻が「いつ止まったか」になる。
    private func startHeartbeat() {
        heartbeatTimer?.invalidate()
        heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.isRecording else { return }
                Diagnostics.log(String(
                    format: "生存 %.1f分 エンジン=%@ 行数=%d 世代=%d",
                    Date().timeIntervalSince(self.startedAt) / 60,
                    self.audioEngine.isRunning ? "稼働" : "停止",
                    self.transcript.split(separator: "\n").count,
                    self.generation
                ))
            }
        }
    }

    func clearTranscript() {
        transcript = ""
        interim = ""
        segmentText = ""
        provisionalLines.removeAll()
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
        restartTimer?.invalidate()
        restartTimer = nil
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
        provisionalLines.removeAll()
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
        // 端末内を選んでいて、その言語が対応していればそうする
        request.requiresOnDeviceRecognition = useOnDevice && recognizer.supportsOnDeviceRecognition
        self.request = request
        // 直前の音声も渡して、張り替え直後の話し始めを落とさない
        sink.attach(request, withPreroll: true)
        segmentText = ""
        interim = ""      // 前のタスクの認識中テキストを画面に残さない
        taskStartedAt = Date()

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            // コールバックは任意スレッド。値だけ取り出してから画面側へ渡す
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            let failure = error?.localizedDescription

            Task { @MainActor [weak self] in
                guard let self else { return }

                if generation == self.generation {
                    // 現役のタスク
                    if let text, !text.isEmpty { self.updateSegment(text) }
                    // 1分制限や一時的な失敗で終わった場合。
                    // 録音中なら黙って次を張るのが正しい（Web版で Load Failed を無視するのと同じ判断）
                    if isFinal || failure != nil { self.commitAndRestart(failure: failure) }
                } else if isFinal || failure != nil {
                    // 締めた古いタスクから最終結果が届いた。これを確定分に積む
                    self.commitClosed(generation, text)
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
        let closingGeneration = generation   // これから張り替えるので、いまの番号を控える

        // 最終結果が返るまで数百ミリ秒かかる。その間に画面から文が消えてちらつかないよう、
        // いま持っているテキストで先に1行積んでおき、最終結果が届いたら差し替える
        let text = segmentText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty {
            provisionalLines[closingGeneration] = text
            transcript += text + "\n"
        }

        startRecognitionTask()   // 先に次を張って、音声を途切れさせない
        closing?.endAudio()      // そのうえで古い方を締める
    }

    /// 締めた古いタスクの最終結果を受け取る。
    /// 先に積んでおいた暫定の行を、iOSが返した最終結果に差し替える。
    ///
    /// **どの世代の結果かを見て差し替える。** 以前は「直前に締めた1件」だけを覚えていたが、
    /// 最終結果が届く前に次の区切りが来ると上書きされ、あとから届いた結果が
    /// 別の行を書き換えてしまう。短く区切って話し続けると起きる。
    private func commitClosed(_ generation: Int, _ text: String?) {
        let final = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

        guard let provisional = provisionalLines.removeValue(forKey: generation) else {
            // 暫定の行を積んでいないケース（空のまま締まった等）
            if !final.isEmpty { transcript += final + "\n" }
            return
        }
        // 最終結果が空、または暫定と同じなら、積んだままでよい
        guard !final.isEmpty, final != provisional else { return }

        if let range = transcript.range(of: provisional + "\n", options: .backwards) {
            transcript.replaceSubrange(range, with: final + "\n")
        } else {
            transcript += final + "\n"
        }
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
    ///
    /// 1分制限で終わるのは正常なので、そのまま張り直してよい。
    /// ただし**張った直後に失敗するのが続く**場合は話が別で、そのまま張り直すと
    /// 全力で失敗し続ける輪になる（画面を消したあと認識が使えなくなった、など）。
    /// 間隔を空けて様子を見て、それでも直らなければ諦めて知らせる。
    private func commitAndRestart(failure: String? = nil) {
        guard isRecording else { return }

        silenceTimer?.invalidate()
        silenceTimer = nil
        commitSegment()

        task = nil
        sink.attach(nil)
        request = nil

        let lifetime = Date().timeIntervalSince(taskStartedAt)
        if failure != nil, lifetime < failureWindow {
            consecutiveFailures += 1
        } else {
            consecutiveFailures = 0
        }
        if let failure {
            Diagnostics.log(String(format: "認識が%.1f秒で終了（連続%d回目）: %@",
                                   lifetime, consecutiveFailures, failure))
        }

        guard consecutiveFailures < failureLimit else {
            Diagnostics.log("即失敗が\(consecutiveFailures)回続いたので録音を止める")
            isRecording = false
            teardown()
            errorMessage = "音声認識を続けられなくなりました。もう一度「開始」を押してください。"
            return
        }

        guard consecutiveFailures > 0 else {
            startRecognitionTask()
            return
        }

        // 0.5秒 → 1秒 → 2秒 … と間隔を空ける（最大8秒）
        let delay = min(0.5 * pow(2, Double(consecutiveFailures - 1)), 8)
        restartTimer?.invalidate()
        restartTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.isRecording else { return }
                self.startRecognitionTask()
            }
        }
    }
}
