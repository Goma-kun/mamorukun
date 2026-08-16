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
let geminiKey      = '';
let isRecording    = false;
let recogLang      = 'ja-JP';   // 音声認識の言語（設定画面で変更可能）
let enginePref     = 'auto';    // AIエンジン設定（'auto' | 'nano'。設定画面で変更可能）
let nanoState      = 'unavailable'; // Chrome 内蔵 AI の利用可否（起動時に判定）
let transcript     = '';
let history        = [];

// 英語学習モード（独り言モード）
let mode           = 'clean';   // 'clean'（清書） | 'english'（英語学習）
let enSessions     = [];        // 過去のセッション（新しい順）
let enRecurring    = [];        // 繰り返し出ている指摘
let enLatest       = null;      // 画面に出している直近のフィードバック
let enBusy         = false;
let enError        = '';
let historyView    = 'clean';   // 履歴タブで見ている側（'clean' | 'english'）


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
  // 設定（キー・言語・モード）はここで読む
  const d = await chrome.storage.local.get(['mamoru_gemini_key', 'mamoru_lang', 'mamoru_mode', 'mamoru_engine']);
  geminiKey  = d.mamoru_gemini_key || '';
  recogLang  = d.mamoru_lang || DEFAULT_LANG;
  enginePref = d.mamoru_engine === 'nano' ? 'nano' : 'auto';
  // 前回のモードで開く（開いてすぐ話せる状態にするため）
  mode      = d.mamoru_mode === 'english' ? 'english' : 'clean';

  // 書き起こし・履歴の実体は履歴層から
  const h = await HistoryStore.load();
  transcript  = h.transcript;
  history     = h.cleanHistory;
  enSessions  = h.enSessions;
  enRecurring = h.enRecurring;
  // 前回のフィードバックは戻さない。開いた時点では常に「話してください」の状態にする
  enLatest    = null;
  historyView = mode;
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
const tabEnglish     = document.getElementById('tab-english');
const tabHistory     = document.getElementById('tab-history');
const panelTranscript = document.getElementById('panel-transcript');
const panelEnglish   = document.getElementById('panel-english');
const panelHistory   = document.getElementById('panel-history');
const transcriptLines = document.getElementById('transcript-lines');
const interimLine    = document.getElementById('interim-line');
const enLive         = document.getElementById('en-live');
const enFeedback     = document.getElementById('en-feedback');
const toggleBtn      = document.getElementById('toggle-btn');

// ============================================================
// パネル切り替え
// ============================================================
function switchPanel(id) {
  [tabTranscript, tabEnglish, tabHistory].forEach(t => t.classList.remove('active'));
  panelTranscript.style.display = 'none';
  panelEnglish.style.display    = 'none';
  panelHistory.style.display    = 'none';

  if (id === 'transcript') {
    panelTranscript.style.display = 'block';
    tabTranscript.classList.add('active');
  } else if (id === 'english') {
    panelEnglish.style.display = 'block';
    tabEnglish.classList.add('active');
    // 開いた時点では常に「話してください」の状態にする。
    // 前回のフィードバックが残っていると、何の画面か分からなくなるため。
    // 読み返しは履歴タブから（指摘つきで全部残っている）
    enLatest = null;
    enError  = '';
    renderEnglish();
  } else if (id === 'history') {
    panelHistory.style.display = 'block';
    tabHistory.classList.add('active');
    historyView = mode;   // 開いたときは今いるモードの側を見せる
    renderHistory();
  }
}

// モードは「ログ」「英語」タブを押したときだけ変わる。
// 履歴タブや録音開始によるパネル移動では変えない（次に開いたとき同じモードで開くため）
function setMode(m) {
  mode = m;
  chrome.storage.local.set({ mamoru_mode: m });
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
  panelHistory.appendChild(historySwitch());
  if (historyView === 'english') renderEnglishHistory();
  else renderCleanHistory();
}

// 「メモ／独り言」の切り替え。中身の性質が違うので、1か所にまとめつつ混ぜない
function historySwitch() {
  const wrap = document.createElement('div');
  wrap.className = 'history-switch';

  [['clean', T('tabLog')], ['english', T('tabEnglish')]].forEach(([view, label]) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.className = historyView === view ? 'active' : '';
    btn.addEventListener('click', () => {
      if (historyView === view) return;
      historyView = view;
      renderHistory();
    });
    wrap.appendChild(btn);
  });
  return wrap;
}

function renderCleanHistory() {
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
  // 英語学習モードのときだけ英語で聞く。設定（mamoru_lang）自体は書き換えない
  recognizer.start(mode === 'english' ? englishRecogLang() : recogLang);
}

function stopRecording() {
  recognizer.stop();
}

function onRecordingStarted() {
  isRecording = true;
  toggleBtn.textContent = T('btnStop');
  toggleBtn.className = 'recording';

  if (mode === 'english') {
    enLatest = null;
    enError  = '';
    enLive.textContent = transcript;
    switchPanel('english');
  } else {
    switchPanel('transcript');
  }
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

  // 英語学習モードは清書・自動コピー・自動クリアを走らせない
  // （フィードバックを読み終わる前に画面が消えてしまうため）
  if (mode === 'english') {
    enLive.textContent = transcript;
    if (transcript.trim()) runEnglishFeedback();
    return;
  }

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
  if (mode === 'english') {
    enLive.textContent = transcript + interim;
    panelEnglish.scrollTop = panelEnglish.scrollHeight;
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
// 英語学習モード（独り言モード）
// ============================================================

// 添削のシステム指示（EN_SYSTEM_PROMPT）は AI 呼び出し層（ai-providers.js）に移した

// 英語学習モードの純ロジック（parseFeedback・foldSessions など）は english-core.js に移した。
// test/english_test.mjs はそちらを切り出して検証する

function englishRecogLang() {
  // 設定が en-GB などならそれを尊重する。それ以外（日本語など）は en-US で聞く
  return recogLang.startsWith('en') ? recogLang : 'en-US';
}

function todayStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function runEnglishFeedback() {
  const text = transcript.trim();
  if (!text) return;
  const ai = currentAi();
  if (!ai) { renderEnglish(); showToast(T('enNoKey'), 'info'); return; }

  enBusy  = true;
  enError = '';
  renderEnglish();

  try {
    // 応答の取得と JSON 解釈は AI 呼び出し層が行う。JSON として読めない応答はここまで来ない
    const fb = await ai.reviewEnglish(text, topRecurring(enRecurring));
    fb.engineId = ai.id;   // 表示用（端末内 AI のときは注記を出す）

    enSessions.unshift({
      id:             new Date().toISOString(),
      transcript:     text,
      corrected_text: fb.corrected_text,
      issues:         fb.issues,
      good:           fb.good,
    });
    enSessions  = foldSessions(enSessions);
    enRecurring = promoteRecurring(enRecurring, fb.issues, todayStamp());
    await HistoryStore.saveEnglish(enSessions, enRecurring);

    enLatest = fb;
    enBusy   = false;

    // 次の録音のために書き起こしだけ空にする。フィードバックは読み終わるまで残す
    transcript = '';
    saveTranscript();
    renderTranscript();
    enLive.textContent = '';
    renderEnglish();
  } catch (err) {
    // 失敗したときは書き起こしを消さない（話した内容を失わせない）
    enBusy  = false;
    enError = err.code === 'denied' ? T('cleanErrDenied')
            : err.code === 'parse'  ? T('enParseError')
            : (err.message || T('unknownError'));
    renderEnglish();
    showToast(T('enError') + enError, 'error');
  }
}

// ============================================================
// 英語学習モードの表示
// ============================================================
function enNote(text, cls = '') {
  const el = document.createElement('div');
  el.className = 'en-note' + (cls ? ' ' + cls : '');
  el.textContent = text;
  return el;
}

function enSection(title) {
  const sec = document.createElement('section');
  sec.className = 'en-section';
  const h = document.createElement('div');
  h.className = 'en-section-title';
  h.textContent = title;
  sec.appendChild(h);
  return sec;
}

function enTypeLabel(type) {
  return T({ phrasing: 'typePhrasing', vocabulary: 'typeVocabulary', grammar: 'typeGrammar' }[type] || 'typePhrasing');
}

function renderEnglish() {
  enFeedback.innerHTML = '';

  if (enBusy)      { enFeedback.appendChild(enNote(T('enAnalyzing'))); return; }
  if (!currentAi()) { enFeedback.appendChild(enNote(T('enNoKey'))); return; }
  if (enError)    { enFeedback.appendChild(enNote(enError, 'en-error')); }

  const fb = enLatest;
  if (!fb) {
    if (!enError) enFeedback.appendChild(enNote(T('enHint')));
    // 話す前に、これまで繰り返し出ている癖を出しておく。
    // 「今日はここに気をつけて話す」の materials になる
    const recurring = topRecurring(enRecurring, 3);
    if (recurring.length > 0) {
      const sec = enSection(T('enRecurring'));
      const ul = document.createElement('ul');
      ul.className = 'en-recurring';
      recurring.forEach(r => {
        const li = document.createElement('li');
        li.textContent = `${r.text}（${T('enTimes', String(r.count))}）`;
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      enFeedback.appendChild(sec);
    }
    enFeedback.appendChild(enNote(T('enNoPronunciation'), 'en-fineprint'));
    return;
  }

  // 表示順は good → issues → recurring → corrected_text
  if (fb.good) {
    const sec = enSection(T('enGood'));
    const p = document.createElement('p');
    p.className = 'en-good';
    p.textContent = fb.good;
    sec.appendChild(p);
    enFeedback.appendChild(sec);
  }

  {
    const sec = enSection(T('enIssues'));
    if (fb.issues.length === 0) {
      sec.appendChild(enNote(T('enNoIssues')));
    } else {
      fb.issues.forEach(it => {
        const card = document.createElement('div');
        card.className = 'en-issue';

        const badge = document.createElement('span');
        badge.className = 'en-badge en-badge-' + it.type;
        badge.textContent = enTypeLabel(it.type);

        const swap = document.createElement('div');
        swap.className = 'en-swap';
        const from = document.createElement('span');
        from.className = 'en-from';
        from.textContent = it.original;
        const arrow = document.createElement('span');
        arrow.className = 'en-arrow';
        arrow.textContent = '→';
        const to = document.createElement('span');
        to.className = 'en-to';
        to.textContent = it.suggestion;
        swap.append(from, arrow, to);

        card.appendChild(badge);
        card.appendChild(swap);
        if (it.reason) {
          const why = document.createElement('p');
          why.className = 'en-reason';
          why.textContent = it.reason;
          card.appendChild(why);
        }
        sec.appendChild(card);
      });
    }
    enFeedback.appendChild(sec);
  }

  if (fb.recurring.length > 0) {
    const sec = enSection(T('enRecurring'));
    const ul = document.createElement('ul');
    ul.className = 'en-recurring';
    fb.recurring.forEach(r => {
      const li = document.createElement('li');
      li.textContent = r;
      ul.appendChild(li);
    });
    sec.appendChild(ul);
    enFeedback.appendChild(sec);
  }

  // 音声認識が化けた箇所。指摘に混ざると「言っていないこと」を直されたように見えるので、
  // 別枠で事実だけ出す。発音の話にはしない（音声は Gemini に届いていない）
  if (fb.recognition_doubt.length > 0) {
    const sec = enSection(T('enDoubt'));
    const ul = document.createElement('ul');
    ul.className = 'en-doubt';
    fb.recognition_doubt.forEach(d => {
      const li = document.createElement('li');
      li.textContent = d;
      ul.appendChild(li);
    });
    sec.appendChild(ul);
    sec.appendChild(enNote(T('enDoubtNote'), 'en-fineprint'));
    enFeedback.appendChild(sec);
  }

  if (fb.corrected_text) {
    const sec = enSection(T('enCorrected'));
    const p = document.createElement('p');
    p.className = 'en-corrected';
    p.textContent = fb.corrected_text;
    sec.appendChild(p);

    const btn = document.createElement('button');
    btn.className = 'history-copy-btn';
    btn.textContent = T('btnCopy');
    btn.addEventListener('click', () => {
      // 清書モードと違い、末尾に目印（U+200B）は付けない。
      // 付けると自動貼り付けツールが拾ってしまうため
      navigator.clipboard.writeText(fb.corrected_text).then(() => {
        btn.textContent = T('btnCopied');
        setTimeout(() => { btn.textContent = T('btnCopy'); }, 1500);
      }).catch(() => showToast(T('copyFailed'), 'error'));
    });
    sec.appendChild(btn);
    enFeedback.appendChild(sec);
  }

  // 端末内 AI で処理したときは明示する（API より精度が下がることがあるため）
  if (fb.engineId === 'nano') {
    enFeedback.appendChild(enNote(T('enNanoNote'), 'en-fineprint'));
  }
  enFeedback.appendChild(enNote(T('enNoPronunciation'), 'en-fineprint'));
}

// ============================================================
// 英語学習モードの履歴表示
// ============================================================
function renderEnglishHistory() {
  const recurring = topRecurring(enRecurring);
  if (recurring.length > 0) {
    const card = document.createElement('div');
    card.className = 'history-card';

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.textContent = T('enRecurring');
    card.appendChild(meta);

    const ul = document.createElement('ul');
    ul.className = 'en-recurring';
    recurring.forEach(r => {
      const li = document.createElement('li');
      li.textContent = `${r.text}（${T('enTimes', String(r.count))}）`;
      ul.appendChild(li);
    });
    card.appendChild(ul);
    panelHistory.appendChild(card);
  }

  if (enSessions.length === 0) {
    panelHistory.appendChild(enNote(T('enHistoryEmpty')));
    return;
  }

  enSessions.forEach(s => {
    const card = document.createElement('div');
    card.className = 'history-card';

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    const when = new Date(s.id);
    const label = isNaN(when) ? String(s.id)
      : when.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    meta.textContent = `${label}　${T('enIssueCount', String((s.issues || []).length))}`;
    card.appendChild(meta);

    if (s.folded) {
      const lines = (s.issues || []).map(it => it.suggestion).filter(Boolean);
      const body = historyBody(lines.length ? lines.join(' / ') : T('enFolded'));
      card.appendChild(body);
      const foldedBtn = enHistoryCopyBtn(s);
      if (foldedBtn) card.appendChild(foldedBtn);
      panelHistory.appendChild(card);
      addExpandBtn(body);
      return;
    }

    const body = historyBody(s.corrected_text || s.transcript || '');
    card.appendChild(body);

    // 修正版だけでなく、何を直したのかも履歴から見返せるようにする。
    // コピーは従来どおり修正版だけにして、音読用の使い方は変えない。
    if ((s.issues || []).length > 0) {
      const title = document.createElement('div');
      title.className = 'en-section-title';
      title.textContent = T('enIssues');
      card.appendChild(title);

      const issues = document.createElement('ul');
      issues.className = 'en-recurring';
      s.issues.forEach(it => {
        const li = document.createElement('li');
        li.textContent = `${it.original} → ${it.suggestion}${it.reason ? ` — ${it.reason}` : ''}`;
        issues.appendChild(li);
      });
      card.appendChild(issues);
    }

    const btn = enHistoryCopyBtn(s);
    if (btn) card.appendChild(btn);
    panelHistory.appendChild(card);
    addExpandBtn(body);
  });
}

// コピーの見出し。表示言語に合わせる
function enCopyLabels() {
  return {
    corrected: T('enLabelCorrected'),
    issues:    T('enIssues'),
    good:      T('enGood'),
    said:      T('enLabelSaid'),
    types: { phrasing: T('typePhrasing'), vocabulary: T('typeVocabulary'), grammar: T('typeGrammar') },
  };
}

// 履歴のコピーは指摘つき。あとから見返して使えるように、何を直されたのかも持ち出す
function enHistoryCopyBtn(session) {
  const text = buildSessionText(session, enCopyLabels());
  if (!text) return null;

  const btn = document.createElement('button');
  btn.className = 'history-copy-btn';
  btn.textContent = T('btnCopyWithIssues');
  btn.addEventListener('click', () => {
    // 清書モードと違い、末尾に目印（U+200B）は付けない。
    // 付けると自動貼り付けツールが拾ってしまうため
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = T('btnCopied');
      setTimeout(() => { btn.textContent = T('btnCopyWithIssues'); }, 1500);
    }).catch(() => showToast(T('copyFailed'), 'error'));
  });
  return btn;
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
    if (mode === 'english' && panelEnglish.style.display !== 'none') renderEnglish();
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

// 録音中のモード切り替えは受け付けない（聞き取る言語も停止後の処理も変わってしまうため）
tabTranscript.addEventListener('click', () => {
  if (isRecording) { showToast(T('enModeLocked'), 'info'); return; }
  setMode('clean');
  switchPanel('transcript');
});
tabEnglish.addEventListener('click', () => {
  if (isRecording) { showToast(T('enModeLocked'), 'info'); return; }
  enError = '';   // 前回のエラーはタブを開き直した時点で消す
  setMode('english');
  switchPanel('english');
});
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
  // 前回のモードのまま開く。「開く → 話す」の間に操作を挟ませない
  switchPanel(mode === 'english' ? 'english' : 'transcript');
});

// ヘッダーのバージョンバッジ。manifest の版をそのまま出す（表示と実体をずらさない）
const verBadge = document.getElementById('ver-badge');
if (verBadge && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
  verBadge.textContent = 'v' + chrome.runtime.getManifest().version;
}
