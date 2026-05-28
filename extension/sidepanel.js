// ============================================================
// 状態
// ============================================================
let geminiKey   = '';
let isRecording = false;
let activeTabId = null;
let transcript  = '';       // 確定テキスト（改行区切り）
let cleanedText = '';
let activePanel = 'transcript';

// ============================================================
// ストレージ
// ============================================================
async function loadStorage() {
  const d = await chrome.storage.local.get(['mamoru_transcript', 'mamoru_gemini_key']);
  transcript = d.mamoru_transcript || '';
  geminiKey  = d.mamoru_gemini_key || '';
}

function saveTranscript() {
  chrome.storage.local.set({ mamoru_transcript: transcript });
}

// ============================================================
// UI 要素
// ============================================================
const settingsBtn     = document.getElementById('settings-btn');
const tabTranscript   = document.getElementById('tab-transcript');
const tabClean        = document.getElementById('tab-clean');
const copyBtn         = document.getElementById('copy-btn');
const clearBtn        = document.getElementById('clear-btn');
const panelTranscript = document.getElementById('panel-transcript');
const panelClean      = document.getElementById('panel-clean');
const transcriptLines = document.getElementById('transcript-lines');
const interimLine     = document.getElementById('interim-line');
const toggleBtn       = document.getElementById('toggle-btn');
const cleanBtn        = document.getElementById('clean-btn');
const cleanTier1Lock  = document.getElementById('clean-tier1-lock');
const cleanProcessing = document.getElementById('clean-processing');
const cleanResult     = document.getElementById('clean-result');
const goSettingsBtn   = document.getElementById('go-settings-btn');

// ============================================================
// ティア UI（APIキーの有無で変わる）
// ============================================================
function applyTier() {
  const hasKey = !!geminiKey;
  document.body.classList.toggle('tier2', hasKey);

  if (hasKey) {
    tabClean.classList.remove('tier2-locked');
    tabClean.title = '';
    cleanBtn.textContent = '✏️ 清書';
    cleanBtn.style.opacity = '';
    cleanTier1Lock.style.display = 'none';
  } else {
    tabClean.classList.add('tier2-locked');
    tabClean.title = 'APIキーを設定すると使えます';
    cleanBtn.textContent = '🔑 APIキーを設定して清書';
    cleanBtn.style.opacity = '0.7';
    cleanTier1Lock.style.display = '';
  }
}

// ============================================================
// パネル切り替え
// ============================================================
function switchPanel(id) {
  if (id === 'clean' && tabClean.classList.contains('tier2-locked')) return;

  activePanel = id;
  [panelTranscript, panelClean].forEach(p => p.classList.remove('active'));
  [tabTranscript, tabClean].forEach(t => t.classList.remove('active'));

  if (id === 'transcript') {
    panelTranscript.classList.add('active');
    tabTranscript.classList.add('active');
  } else {
    panelClean.classList.add('active');
    tabClean.classList.add('active');
  }
}

// ============================================================
// 文字起こし表示
// ============================================================
function renderTranscript() {
  transcriptLines.innerHTML = '';
  if (!transcript.trim()) return;
  transcript.split('\n').forEach(line => {
    if (!line.trim()) return;
    const p = document.createElement('p');
    p.className = 'transcript-line';
    p.textContent = line;
    transcriptLines.appendChild(p);
  });
  scrollTranscriptToBottom();
}

function appendTranscriptLine(text) {
  if (!text.trim()) return;
  const p = document.createElement('p');
  p.className = 'transcript-line';
  p.textContent = text;
  transcriptLines.appendChild(p);
  scrollTranscriptToBottom();
}

function scrollTranscriptToBottom() {
  requestAnimationFrame(() => {
    panelTranscript.scrollTop = panelTranscript.scrollHeight;
  });
}

// ============================================================
// 録音制御
// ============================================================
async function startRecording() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const url = tab.url || '';
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || !url) {
    showToast('通常のWebページで使用してください', 'error');
    return;
  }

  activeTabId = tab.id;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    chrome.tabs.sendMessage(tab.id, { type: 'START', lang: 'ja-JP' });
  } catch (err) {
    showToast('スクリプト注入に失敗しました: ' + err.message, 'error');
  }
}

function stopRecording() {
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, { type: 'STOP' });
  }
}

function onRecordingStarted() {
  isRecording = true;
  toggleBtn.textContent = '■ 停止';
  toggleBtn.className = 'recording';
}

function onRecordingStopped() {
  isRecording = false;
  toggleBtn.textContent = '▶ 開始';
  toggleBtn.className = 'idle';

  // 停止時に未確定の中間テキストを確定済みとして保存
  const pending = interimLine.textContent.trim();
  if (pending) {
    transcript += pending + '\n';
    appendTranscriptLine(pending);
    saveTranscript();
  }

  interimLine.textContent = '';

  if (geminiKey && transcript.trim()) {
    // APIキーあり → 自動清書
    runClean(true);
  } else if (!geminiKey && transcript.trim()) {
    // APIキーなし → 書き起こしを自動コピー
    navigator.clipboard.writeText(transcript).then(() => {
      showToast('📋 書き起こしをコピーしました', 'ok');
    }).catch(() => {});
  }
}

function onResult(interim, final) {
  if (interim) {
    interimLine.textContent = interim;
    scrollTranscriptToBottom();
  }
  if (final) {
    transcript += final + '\n';
    interimLine.textContent = '';
    appendTranscriptLine(final);
    saveTranscript();
  }
}

// ============================================================
// 清書（ティア2）
// ============================================================
async function runClean(auto = false) {
  if (!geminiKey || !transcript.trim()) return;

  if (!auto) {
    switchPanel('clean');
  } else {
    showToast('✍️ 清書中...', 'info');
  }

  cleanTier1Lock.style.display  = 'none';
  cleanProcessing.style.display = '';
  cleanResult.innerHTML = '';

  const prompt = `以下の音声文字起こしテキストを読みやすく整形してください。
【ルール】
・えー、あのー、えっと、なんか等のフィラーを除去する
・重複・言い淀みを削除する
・適切な句読点を追加する
・話し言葉のスタイルはそのまま維持する（文体・敬体は変えない）
・箇条書きや見出しにしない
・整形後のテキストのみ出力する（前置き・後書き禁止）

テキスト:
${transcript}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: []
        })
      }
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    cleanedText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    cleanProcessing.style.display = 'none';
    const card = document.createElement('div');
    card.className = 'clean-card';
    card.contentEditable = 'true';
    card.textContent = cleanedText;
    cleanResult.appendChild(card);

    if (auto) switchPanel('clean');
  } catch (err) {
    cleanProcessing.style.display = 'none';
    showToast('清書エラー: ' + err.message, 'error');
    if (!auto) switchPanel('transcript');
  }
}

// ============================================================
// コピー
// ============================================================
async function doCopy() {
  let text = '';
  if (activePanel === 'transcript') text = transcript;
  else if (activePanel === 'clean') {
    const card = cleanResult.querySelector('.clean-card');
    text = card ? card.textContent : cleanedText;
  }

  if (!text.trim()) { showToast('コピーするテキストがありません', 'info'); return; }
  try {
    await navigator.clipboard.writeText(text);
    showToast('コピーしました！', 'ok');
  } catch {
    showToast('コピーに失敗しました', 'error');
  }
}

// ============================================================
// クリア
// ============================================================
let clearConfirmTimer = null;
function doClear() {
  if (!transcript.trim() && !cleanedText) return;
  if (clearBtn.dataset.confirm !== '1') {
    clearBtn.dataset.confirm = '1';
    clearBtn.textContent = '確認';
    clearConfirmTimer = setTimeout(() => {
      clearBtn.dataset.confirm = '';
      clearBtn.textContent = '🗑️';
    }, 3000);
    return;
  }
  clearTimeout(clearConfirmTimer);
  clearBtn.dataset.confirm = '';
  clearBtn.textContent = '🗑️';
  transcript  = '';
  cleanedText = '';
  saveTranscript();
  renderTranscript();
  cleanResult.innerHTML = '';
  cleanTier1Lock.style.display = geminiKey ? 'none' : '';
  switchPanel('transcript');
  showToast('クリアしました', 'ok');
}

// ============================================================
// トースト通知
// ============================================================
let toastTimer = null;
function showToast(msg, type = 'info') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    const style = toast.style;
    style.position = 'fixed';
    style.bottom   = '90px';
    style.left     = '50%';
    style.transform = 'translateX(-50%)';
    style.padding  = '7px 14px';
    style.borderRadius = '8px';
    style.fontSize  = '12px';
    style.fontWeight = '700';
    style.zIndex   = '9999';
    style.pointerEvents = 'none';
    style.transition = 'opacity 0.3s';
    document.body.appendChild(toast);
  }
  const colors = { ok: ['#052e16','#4ade80'], error: ['#450a0a','#f87171'], info: ['#0f172a','#94a3b8'] };
  const [bg, fg] = colors[type] || colors.info;
  toast.style.background = bg;
  toast.style.color      = fg;
  toast.style.border     = `1px solid ${fg}44`;
  toast.textContent = msg;
  toast.style.opacity = '1';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}

// ============================================================
// メッセージ受信（content.js から）
// ============================================================
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'STARTED': onRecordingStarted(); break;
    case 'STOPPED': onRecordingStopped(); break;
    case 'RESULT':  onResult(msg.interim || '', msg.final || ''); break;
    case 'ERROR':
      showToast('音声認識エラー: ' + msg.msg, 'error');
      if (isRecording) { isRecording = false; onRecordingStopped(); }
      break;
  }
});

// ============================================================
// ストレージ変更監視（options から API キーが保存されたとき即反映）
// ============================================================
chrome.storage.onChanged.addListener((changes) => {
  if (changes.mamoru_gemini_key) {
    geminiKey = changes.mamoru_gemini_key.newValue || '';
    applyTier();
  }
});

// ============================================================
// イベントリスナー
// ============================================================
toggleBtn.addEventListener('click', () => {
  if (!isRecording) startRecording();
  else stopRecording();
});

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

goSettingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

tabTranscript.addEventListener('click', () => switchPanel('transcript'));
tabClean.addEventListener('click',      () => switchPanel('clean'));

copyBtn.addEventListener('click', doCopy);
clearBtn.addEventListener('click', doClear);

cleanBtn.addEventListener('click', () => {
  if (!geminiKey) { chrome.runtime.openOptionsPage(); return; }
  if (!transcript.trim()) { showToast('文字起こしがありません', 'info'); return; }
  runClean();
});

// ============================================================
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  await loadStorage();
  applyTier();
  renderTranscript();
});
