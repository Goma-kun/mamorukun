// ============================================================
// 音声認識層。Web Speech API の生成・自動再起動・停止をここに閉じ込める。
// UI からは supported / start / stop と 4 つのコールバックだけを使う。
// SpeechRecognition オブジェクトは使い回さず、start のたびに新しく作る
// ============================================================
const SpeechCapture = {
  supported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  },

  // handlers: {
  //   onStart()                … 認識が実際に走り始めた
  //   onStop()                 … 停止が完了した（stop 後・致命的エラー後）
  //   onResult(interim, final) … 認識結果（interim=途中経過, final=確定分）
  //   onError(code)            … エラー種別の文字列（no-speech は通知しない）
  // }
  createRecognizer(handlers) {
    let recognition = null;
    let alive = false;   // 生存中は onend のたびに自動で再起動する（連続認識の維持）

    return {
      get running() { return alive; },

      start(lang) {
        if (alive) return;
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return;

        recognition = new SR();
        recognition.continuous     = true;
        recognition.interimResults = true;
        recognition.lang           = lang;

        recognition.onstart = () => {
          alive = true;
          handlers.onStart();
        };

        recognition.onresult = (e) => {
          let interim = '', final = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) final += t;
            else interim += t;
          }
          handlers.onResult(interim, final);
        };

        recognition.onend = () => {
          if (alive) recognition.start();
        };

        recognition.onerror = (e) => {
          if (e.error === 'no-speech') return;
          handlers.onError(e.error);
          if (e.error !== 'aborted') {
            alive = false;
            handlers.onStop();
          }
        };

        recognition.start();
      },

      stop() {
        if (!recognition) return;
        alive = false;
        const rec = recognition;
        recognition = null;
        rec.onend = () => handlers.onStop();
        rec.stop();
      },
    };
  },
};
