// 音声認識スクリプト（タブコンテキストで動作）
// 二重注入防止
if (!window.__mamorukun_injected) {
  window.__mamorukun_injected = true;

  let recognition = null;
  let isRunning = false;

  function send(msg) {
    try { chrome.runtime.sendMessage(msg); } catch (_) {}
  }

  function startRecognition(lang) {
    if (isRunning) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      send({ type: 'ERROR', msg: 'webkitSpeechRecognition が存在しません' });
      return;
    }

    recognition = new SR();
    recognition.continuous     = true;
    recognition.interimResults = true;
    recognition.lang           = lang || 'ja-JP';

    recognition.onstart = () => {
      isRunning = true;
      send({ type: 'STARTED' });
    };

    recognition.onresult = (e) => {
      let interim = '';
      let final   = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      send({ type: 'RESULT', interim, final });
    };

    recognition.onend = () => {
      // continuous=true でも Chrome は定期的に onend を発火させる → 録音中なら再起動
      if (isRunning) recognition.start();
    };

    recognition.onerror = (e) => {
      if (e.error === 'no-speech') return; // 無音は正常
      send({ type: 'ERROR', msg: e.error });
      if (e.error !== 'aborted') {
        isRunning = false;
        send({ type: 'STOPPED' });
      }
    };

    recognition.start();
  }

  function stopRecognition() {
    isRunning = false;
    if (recognition) {
      recognition.stop();
      recognition = null;
    }
    send({ type: 'STOPPED' });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'START') startRecognition(msg.lang);
    if (msg.type === 'STOP')  stopRecognition();
  });
}
