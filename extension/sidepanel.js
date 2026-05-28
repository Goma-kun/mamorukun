// ============================================================
// 状態
// ============================================================
let geminiKey      = '';
let isRecording    = false;
let recognition    = null;
let recognitionAlive = false;
let transcript     = '';  // 確定テキスト（改行区切り）
let cleanedText    = '';
let activePanel    = 'transcript';

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
const settingsBtn       = document.getElementById('settings-btn');
const tabTranscript     = document.getElementById('tab-transcript');
const tabClean          = document.getElementById('tab-clean');
const clearBtn          = document.getElementById('clear-btn');
const panelTranscript   = document.getElementById('panel-transcript');
const panelClean        = document.getElementById('panel-clean');
const transcriptLines   = document.getElementById('transcript-lines');
const interimLine       = document.getElementById('interim-line');
const toggleBtn         = document.getElementById('toggle-btn');
const cleanBtn          = document.getElementById('clean-btn');
const cleanTier1Lock    = document.getElementById('clean-tier1-lock');
const cleanProcessing   = document.getElementById('clean-processing');
const cleanResult       = document.getElementById('clean-result');
const goSettingsBtn     = document.getElementById('go-settings-btn');
const cleanCopyTop      = document.getElementById('clean-copy-top');
const cleanCopyTopBtn   = document.getElementById('clean-copy-top-btn');
const cleanCopyBottom   = document.getElementById('clean-copy-bottom');
const cleanCopyBottomBtn = document.getElementById('clean-copy-bottom-btn');
const clearModal        = document.getElementById('clear-modal');

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
  [tabTranscript, tabClean].forEach(t => t.classList.remove('active'));

  if (id === 'transcript') {
    // inline style で確実に切り替え（CSS 詳細度の競合を回避）
    panelTranscript.style.display = 'block';
    panelClean.style.display = 'none';
    tabTranscript.classList.add('active');
  } else {
    panelTranscript.style.display = 'none';
    panelClean.style.display = 'flex';
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

// display:block コンテナに対して直接 scrollTop を設定
function scrollTranscriptToBottom() {
  panelTranscript.scrollTop = panelTranscript.scrollHeight;
}

// ============================================================
// 録音制御（まもるくんウィンドウ内で直接実行）
// ============================================================
function startRecording() {
  if (recognitionAlive) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showToast('音声認識が利用できません', 'error'); return; }

  recognition = new SR();
  recognition.continuous     = true;
  recognition.interimResults = true;
  recognition.lang           = 'ja-JP';

  recognition.onstart = () => {
    recognitionAlive = true;
    onRecordingStarted();
  };

  recognition.onresult = (e) => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }
    onResult(interim, final);
  };

  recognition.onend = () => {
    if (recognitionAlive) recognition.start(); // continuous 維持
  };

  recognition.onerror = (e) => {
    if (e.error === 'no-speech') return;
    showToast('音声認識エラー: ' + e.error, 'error');
    if (e.error !== 'aborted') {
      recognitionAlive = false;
      onRecordingStopped();
    }
  };

  recognition.start();
}

function stopRecording() {
  if (!recognition) return;
  recognitionAlive = false;
  const rec = recognition;
  recognition = null;
  // onend 後に処理することで最終 RESULT が先に届く順序を保証
  rec.onend = () => onRecordingStopped();
  rec.stop();
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

  if (!auto) switchPanel('clean');
  else showToast('✍️ 清書中...', 'info');

  cleanTier1Lock.style.display  = 'none';
  cleanProcessing.style.display = '';
  cleanResult.innerHTML = '';
  cleanCopyTop.classList.remove('visible');
  cleanCopyBottom.classList.remove('visible');

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
    cleanCopyTop.classList.add('visible');
    cleanCopyBottom.classList.add('visible');

    if (auto) {
      // 清書完了後に自動コピー → 貼り付けるだけの状態にする
      navigator.clipboard.writeText(cleanedText).then(() => {
        showToast('✅ 清書してコピーしました', 'ok');
      }).catch(() => {
        showToast('清書完了（コピーは手動でどうぞ）', 'info');
      });
      switchPanel('clean');
    }
  } catch (err) {
    cleanProcessing.style.display = 'none';
    showToast('清書エラー: ' + err.message, 'error');
    if (!auto) switchPanel('transcript');
  }
}

// ============================================================
// コピー共通処理
// ============================================================
async function copyText(text, btn) {
  if (!text.trim()) { showToast('コピーするテキストがありません', 'info'); return; }
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ コピー済';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
    } else {
      showToast('コピーしました！', 'ok');
    }
  } catch {
    showToast('コピーに失敗しました', 'error');
  }
}

function getCleanText() {
  const card = cleanResult.querySelector('.clean-card');
  return card ? card.textContent : cleanedText;
}

// ============================================================
// クリア（モーダル確認）
// ============================================================
function doClear() {
  if (!transcript.trim() && !cleanedText) return;
  clearModal.classList.add('open');
}

function executeClear() {
  clearModal.classList.remove('open');
  transcript  = '';
  cleanedText = '';
  saveTranscript();
  renderTranscript();
  cleanResult.innerHTML = '';
  cleanCopyTop.classList.remove('visible');
  cleanCopyBottom.classList.remove('visible');
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
  toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

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

settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
goSettingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

tabTranscript.addEventListener('click', () => switchPanel('transcript'));
tabClean.addEventListener('click',      () => switchPanel('clean'));

clearBtn.addEventListener('click', doClear);

// 清書パネル：上下コピーボタン
cleanCopyTopBtn.addEventListener('click',    () => copyText(getCleanText(), cleanCopyTopBtn));
cleanCopyBottomBtn.addEventListener('click', () => copyText(getCleanText(), cleanCopyBottomBtn));

// モーダル
document.getElementById('modal-cancel-btn').addEventListener('click', () => {
  clearModal.classList.remove('open');
});
document.getElementById('modal-confirm-btn').addEventListener('click', executeClear);
clearModal.addEventListener('click', (e) => {
  if (e.target === clearModal) clearModal.classList.remove('open');
});

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
  // 初期表示状態を inline style で確定（CSS 詳細度の競合を排除）
  panelTranscript.style.display = 'block';
  panelClean.style.display = 'none';
  renderTranscript();
});
