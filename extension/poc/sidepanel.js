const statusEl     = document.getElementById('status');
const toggleBtn    = document.getElementById('toggle-btn');
const interimEl    = document.getElementById('interim');
const transcriptEl = document.getElementById('transcript');
const logEl        = document.getElementById('log');
const clearBtn     = document.getElementById('clear-btn');

let isRecording = false;
let activeTabId  = null;
let finalText    = '';

function addLog(text, lvl = 'info') {
  const line = document.createElement('div');
  line.className = 'log-' + lvl;
  line.textContent = '[' + new Date().toLocaleTimeString('ja-JP') + '] ' + text;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = 'status-' + cls;
}

// content.js からのメッセージを受信
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'LOG')     addLog(msg.text, msg.lvl || 'info');
  if (msg.type === 'STARTED') {
    setStatus('録音中 🔴', 'active');
    toggleBtn.textContent = '録音停止';
    toggleBtn.className = 'active';
  }
  if (msg.type === 'STOPPED') {
    setStatus('待機中', 'idle');
    toggleBtn.textContent = '録音開始';
    toggleBtn.className = 'idle';
    isRecording = false;
  }
  if (msg.type === 'RESULT') {
    if (msg.interim) interimEl.textContent = msg.interim;
    if (msg.final) {
      finalText += msg.final + '\n';
      transcriptEl.textContent = finalText;
      interimEl.textContent = '—';
    }
  }
});

toggleBtn.addEventListener('click', async () => {
  if (!isRecording) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { addLog('アクティブタブが見つかりません', 'err'); return; }

    const url = tab.url || '';
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url === '') {
      addLog('chrome:// ページには注入できません。通常の Web ページを開いてください。', 'err');
      setStatus('通常のWebページで試してください', 'error');
      return;
    }

    activeTabId = tab.id;
    addLog('content.js を注入中... (tabId: ' + tab.id + ', url: ' + url.slice(0, 40) + ')', 'info');

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      addLog('注入完了 → START コマンド送信', 'info');
      chrome.tabs.sendMessage(tab.id, { type: 'START' });
      isRecording = true;
    } catch (err) {
      addLog('注入失敗: ' + err.message, 'err');
      setStatus('注入失敗', 'error');
    }
  } else {
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { type: 'STOP' });
    }
    isRecording = false;
  }
});

clearBtn.addEventListener('click', () => {
  finalText = '';
  transcriptEl.textContent = '';
  interimEl.textContent = '—';
  logEl.innerHTML = '';
  addLog('クリア', 'info');
});

addLog('sidepanel.js ロード完了', 'ok');
