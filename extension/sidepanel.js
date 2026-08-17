// i18n: ブラウザの言語に応じた文言を返す／DOMへ流し込む
const T = (k, ...sub) => chrome.i18n.getMessage(k, sub.length ? sub : undefined) || k;
function applyI18n() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const m = T(el.dataset.i18n);
    if (m) el.textContent = m;
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    const m = T(el.dataset.i18nTitle);
    if (m) el.title = m;
  }
}

// ============================================================
// 状態
// ============================================================
// 独り言（英語学習）モードは v1.8.0 で単独の拡張機能「独り言」へ分離した。
// 過去の独り言データ（en_ 接頭辞）は消さずに残してある（history-store.js 参照）
let geminiKey      = '';
let isRecording    = false;
let recogLang      = 'ja-JP';   // 音声認識の言語（設定画面で変更可能）
let enginePref     = 'auto';    // AIエンジン設定（'auto' | 'nano'。設定画面で変更可能）
let nanoState      = 'unavailable'; // Chrome 内蔵 AI の利用可否（起動時に判定）
let transcript     = '';
let history        = [];

// ============================================================
// 音声認識の言語
// ============================================================
// 言語名の一覧（LANG_NAMES / langLabel）は清書プロンプト専用なので ai-providers.js に移した
const SUPPORTED = ['ja-JP','en-US','en-GB','es-ES','es-MX','zh-CN','zh-TW','ko-KR','fr-FR','de-DE','pt-BR'];

// 未設定時は日本語。ブラウザのUI言語からは推測しない。
// （英語優先のChromeを使う日本語話者が、いきなり英語認識になって困るのを防ぐ。
//   日本語以外で使う場合は設定画面から1回選べば以後は保存される）
const DEFAULT_LANG = 'ja-JP';

// ============================================================
// ストレージ（実体の保存・読み出しは履歴層 history-store.js に集約）
// ============================================================
async function loadStorage() {
  // 設定（キー・言語）はここで読む
  const d = await chrome.storage.local.get(['mamoru_gemini_key', 'mamoru_lang', 'mamoru_engine']);
  geminiKey  = d.mamoru_gemini_key || '';
  recogLang  = d.mamoru_lang || DEFAULT_LANG;
  enginePref = d.mamoru_engine === 'nano' ? 'nano' : 'auto';

  // 書き起こし・履歴の実体は履歴層から
  const h = await HistoryStore.load();
  transcript = h.transcript;
  history    = h.cleanHistory;
}

function saveTranscript() {
  HistoryStore.saveTranscript(transcript);
}

function saveHistory() {
  HistoryStore.saveCleanHistory(history);
}

// いま使う AI プロバイダ。null なら AI なし（従来のキー無し挙動）
function currentAi() {
  return selectAiProvider({ geminiKey, engine: enginePref, nanoState });
}

function addToHistory(t, c) {
  if (!t.trim()) return;
  const entry = {
    id:         Date.now(),
    date:       new Date().toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    transcript: t,
    cleaned:    c || '',
  };
  history.unshift(entry);
  if (history.length > 3) history = history.slice(0, 3);
  saveHistory();
}

// ============================================================
// UI 要素
// ============================================================
const settingsBtn    = document.getElementById('settings-btn');
const tabTranscript  = document.getElementById('tab-transcript');
const tabHistory     = document.getElementById('tab-history');
const panelTranscript = document.getElementById('panel-transcript');
const panelHistory   = document.getElementById('panel-history');
const transcriptLines = document.getElementById('transcript-lines');
const interimLine    = document.getElementById('interim-line');
const toggleBtn      = document.getElementById('toggle-btn');

// ============================================================
// パネル切り替え
// ============================================================
function switchPanel(id) {
  [tabTranscript, tabHistory].forEach(t => t.classList.remove('active'));
  panelTranscript.style.display = 'none';
  panelHistory.style.display    = 'none';

  if (id === 'transcript') {
    panelTranscript.style.display = 'block';
    tabTranscript.classList.add('active');
  } else if (id === 'history') {
    panelHistory.style.display = 'block';
    tabHistory.classList.add('active');
    renderHistory();
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
  panelTranscript.scrollTop = panelTranscript.scrollHeight;
}

// ============================================================
// 履歴パネル表示
// ============================================================

// 履歴の本文。長いものは4行で畳んでおき、「全文」で開けるようにする。
// 全文を見るのにコピーして貼り付ける必要があった状態を直したもの
function historyBody(text) {
  const body = document.createElement('div');
  body.className = 'history-body';
  body.textContent = text;
  return body;
}

// カードを画面に入れたあとに呼ぶ。実際に畳まれているときだけボタンを出す
function addExpandBtn(body) {
  if (body.scrollHeight <= body.clientHeight + 1) return;

  const btn = document.createElement('button');
  btn.className = 'history-expand-btn';
  btn.textContent = T('btnExpand');
  btn.addEventListener('click', () => {
    const open = body.classList.toggle('expanded');
    btn.textContent = open ? T('btnCollapse') : T('btnExpand');
  });
  body.insertAdjacentElement('afterend', btn);
}

function renderHistory() {
  panelHistory.innerHTML = '';

  if (history.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = T('historyEmpty');
    panelHistory.appendChild(empty);
    return;
  }

  history.forEach((entry) => {
    const card = document.createElement('div');
    card.className = 'history-card';

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.textContent = entry.date + (entry.cleaned ? T('historyCleaned') : T('historyLogOnly'));

    const text = entry.cleaned || entry.transcript;
    const body = historyBody(text);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'history-copy-btn';
    copyBtn.textContent = T('btnCopy');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = T('btnCopied');
        setTimeout(() => { copyBtn.textContent = T('btnCopy'); }, 1500);
      }).catch(() => showToast(T('copyFailed'), 'error'));
    });

    card.appendChild(meta);
    card.appendChild(body);
    card.appendChild(copyBtn);
    panelHistory.appendChild(card);
    addExpandBtn(body);
  });
}

// ============================================================
// 録音制御（認識オブジェクトの生成・再起動は音声認識層 speech.js が持つ）
// ============================================================
const recognizer = SpeechCapture.createRecognizer({
  onStart:  () => onRecordingStarted(),
  onStop:   () => onRecordingStopped(),
  onResult: (interim, final) => onResult(interim, final),
  onError:  (code) => showToast(T('speechError') + code, 'error'),
});

function startRecording() {
  if (!SpeechCapture.supported()) { showToast(T('speechUnavailable'), 'error'); return; }
  recognizer.start(recogLang);
}

function stopRecording() {
  recognizer.stop();
}

function onRecordingStarted() {
  isRecording = true;
  toggleBtn.textContent = T('btnStop');
  toggleBtn.className = 'recording';
  switchPanel('transcript');
}

function onRecordingStopped() {
  isRecording = false;
  toggleBtn.textContent = T('btnStart');
  toggleBtn.className = 'idle';

  const pending = interimLine.textContent.trim();
  if (pending) {
    transcript += pending + '\n';
    appendTranscriptLine(pending);
    saveTranscript();
  }
  interimLine.textContent = '';

  if (currentAi() && transcript.trim()) {
    runClean();
  } else if (transcript.trim()) {
    addToHistory(transcript, '');
    navigator.clipboard.writeText(transcript + "​").then(() => {
      showToast(T('toastCopied'), 'ok');
      setTimeout(() => autoClear(), 800);
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
// 清書（バックグラウンド処理・UIなし）
// ============================================================

// 清書プロンプト（buildPrompt）と言語名一覧は AI 呼び出し層（ai-providers.js）に移した

async function runClean() {
  if (!transcript.trim()) return;
  const ai = currentAi();
  if (!ai) {
    showToast(T('noApiKey'), 'info');
    return;
  }
  showToast(T('cleaning'), 'info');

  try {
    const cleanedText = await ai.cleanUp(transcript, recogLang);

    addToHistory(transcript, cleanedText);

    navigator.clipboard.writeText(cleanedText + "​").then(() => {
      showToast(T('cleanedAndCopied'), 'ok');
      setTimeout(() => autoClear(), 800);
    }).catch(() => {
      showToast(T('cleanedManual'), 'info');
      setTimeout(() => autoClear(), 800);
    });
  } catch (err) {
    // 'denied' はキーの誤りではなく、プロジェクトに無料枠が割り当てられていないケース
    if (err.code === 'denied') { showToast(T('cleanErrDenied'), 'error'); return; }
    if (err.code === 'unsupported') {
      // 端末内 AI が扱えない言語は、AI なしのときと同じ動き（そのままコピー）に落とす
      addToHistory(transcript, '');
      navigator.clipboard.writeText(transcript + "​").then(() => {
        showToast(T('toastCopied'), 'ok');
        setTimeout(() => autoClear(), 800);
      }).catch(() => {});
      return;
    }
    showToast(T('cleanError') + (err.message || T('unknownError')), 'error');
  }
}

// ============================================================
// 自動クリア
// ============================================================
function autoClear() {
  transcript = '';
  saveTranscript();
  renderTranscript();
  switchPanel('transcript');
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
    style.bottom   = '70px';
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
// ストレージ変更監視
// ============================================================
chrome.storage.onChanged.addListener((changes) => {
  if (changes.mamoru_gemini_key) {
    geminiKey = changes.mamoru_gemini_key.newValue || '';
  }
  // 設定画面で言語を変えたら即反映（録音中の場合は次回の録音から）
  if (changes.mamoru_lang) {
    recogLang = changes.mamoru_lang.newValue || DEFAULT_LANG;
    if (recognizer.running) showToast(T('langChanged'), 'info');
  }
  // 設定画面で AI エンジンを変えたら即反映。DL 直後の場合もあるので利用可否を取り直す
  if (changes.mamoru_engine) {
    enginePref = changes.mamoru_engine.newValue === 'nano' ? 'nano' : 'auto';
    nanoAvailability().then(s => {
      nanoState = s;
      if (currentAi()?.id === 'nano') prewarmNano();
    });
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

tabTranscript.addEventListener('click', () => switchPanel('transcript'));
tabHistory.addEventListener('click', () => switchPanel('history'));

// ============================================================
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  applyI18n();
  // Chrome 内蔵 AI の利用可否。ロードを待たせないため並行で取る
  const nanoCheck = nanoAvailability().then(s => { nanoState = s; });
  await loadStorage();
  await nanoCheck;
  // Nano を使う見込みなら、この時点でモデルのロード（初回約16秒）を始めておく。
  // 録音が終わってから待たせないための仕込み
  if (currentAi()?.id === 'nano') prewarmNano();
  renderTranscript();
  switchPanel('transcript');
});

// ヘッダーのバージョンバッジ。manifest の版をそのまま出す（表示と実体をずらさない）
const verBadge = document.getElementById('ver-badge');
if (verBadge && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
  verBadge.textContent = 'v' + chrome.runtime.getManifest().version;
}
