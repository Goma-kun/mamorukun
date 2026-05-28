// タブのコンテキストで動く音声認識スクリプト
// 二重注入防止
if (!window.__mamorukun_injected) {
  window.__mamorukun_injected = true;

  let recognition = null;
  let isRunning = false;

  function send(msg) {
    try { chrome.runtime.sendMessage(msg); } catch (_) {}
  }

  function startRecognition() {
    if (isRunning) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      send({ type: 'LOG', text: 'webkitSpeechRecognition が存在しない', lvl: 'err' });
      return;
    }
    send({ type: 'LOG', text: 'webkitSpeechRecognition を検出。recognition.start() 呼び出し...', lvl: 'info' });

    recognition = new SR();
    recognition.continuous     = true;
    recognition.interimResults = true;
    recognition.lang           = 'ja-JP';

    recognition.onstart = () => {
      isRunning = true;
      send({ type: 'STARTED' });
      send({ type: 'LOG', text: 'onstart 発火 — 録音開始！', lvl: 'ok' });
    };

    recognition.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      send({ type: 'RESULT', interim, final });
      if (final) send({ type: 'LOG', text: 'final: ' + final.slice(0, 60), lvl: 'ok' });
    };

    recognition.onend = () => {
      send({ type: 'LOG', text: 'onend 発火', lvl: 'info' });
      if (isRunning) {
        send({ type: 'LOG', text: '→ 自動再起動', lvl: 'info' });
        recognition.start();
      }
    };

    recognition.onerror = (e) => {
      send({ type: 'LOG', text: 'onerror: ' + e.error, lvl: 'err' });
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
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
    send({ type: 'LOG', text: '録音停止', lvl: 'info' });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'START') startRecognition();
    if (msg.type === 'STOP')  stopRecognition();
  });

  send({ type: 'LOG', text: 'content.js 注入完了（タブコンテキスト）', lvl: 'ok' });
}
