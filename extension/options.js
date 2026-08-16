// i18n: data-i18n / data-i18n-title を持つ要素へ、ブラウザの言語に応じた文言を流し込む
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

const langSelect       = document.getElementById('lang-select');
const langStatus       = document.getElementById('lang-status');
const engineSelect     = document.getElementById('engine-select');
const engineStatus     = document.getElementById('engine-status');
const engineAvailEl    = document.getElementById('engine-availability');
const apiKeyInput      = document.getElementById('api-key-input');
const saveBtn          = document.getElementById('save-btn');
const testBtn          = document.getElementById('test-btn');
const deleteBtn        = document.getElementById('delete-btn');
const keyStatus        = document.getElementById('key-status');
const keySavedIndicator= document.getElementById('key-saved-indicator');
const tierLabel        = document.getElementById('tier-label');

function showStatus(msg, type) {
  keyStatus.textContent = msg;
  keyStatus.className   = 'status-' + type;
  keyStatus.style.display = 'block';
}

function hideStatus() {
  keyStatus.style.display = 'none';
}

// Gemini API のエラーを原因ごとに出し分ける
// 403 + "denied access" はキーの誤りではなく、プロジェクトに無料枠が割り当てられていないケース
function geminiErrorText(status, apiMessage) {
  const msg = apiMessage || '';
  if (status === 403 && /denied access/i.test(msg)) return T('errDenied');
  if (status === 401) return T('errKeyInvalid');
  if (status === 400 && /api[ _-]?key/i.test(msg)) return T('errKeyInvalid');
  return msg || T('unknownError');
}

async function loadKey() {
  const { mamoru_gemini_key } = await chrome.storage.local.get('mamoru_gemini_key');
  const hasKey = !!mamoru_gemini_key;

  keySavedIndicator.style.display = hasKey ? '' : 'none';
  apiKeyInput.value = hasKey ? mamoru_gemini_key : '';
  apiKeyInput.placeholder = hasKey ? T('placeholderSaved') : T('placeholderKey');

  renderTierLabel();
}

// 上部の「現在のモード」。サイドパネル側の selectAiProvider と同じ順で判定して、
// 表示と実際の動きがズレないようにする（キー無しでも端末内 AI が動くなら、そう表示する）
async function renderTierLabel() {
  const d = await chrome.storage.local.get(['mamoru_gemini_key', 'mamoru_engine']);
  const hasKey = !!d.mamoru_gemini_key;
  const nanoOk = (await nanoAvailabilityOpt()) === 'available';
  const preferNano = d.mamoru_engine === 'nano';

  if (nanoOk && (preferNano || !hasKey)) {
    tierLabel.innerHTML = `${T('tierNano')} <span class="tier-badge tier2">${T('badgeNano')}</span>`;
  } else if (hasKey) {
    tierLabel.innerHTML = `${T('tierFull')} <span class="tier-badge tier2">${T('badgeCleanOn')}</span>`;
  } else {
    tierLabel.innerHTML = `${T('tierBasic')} <span class="tier-badge tier1">${T('badgeNoKey')}</span>`;
  }
}

saveBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) { showStatus(T('enterKey'), 'error'); return; }

  await chrome.storage.local.set({ mamoru_gemini_key: key });
  showStatus(T('savedOk'), 'ok');
  loadKey();
  setTimeout(hideStatus, 2000);
});

let deleteConfirmTimer = null;
deleteBtn.addEventListener('click', async () => {
  if (deleteBtn.dataset.confirm !== '1') {
    deleteBtn.dataset.confirm = '1';
    deleteBtn.textContent = T('confirmDelete');
    deleteConfirmTimer = setTimeout(() => {
      deleteBtn.dataset.confirm = '';
      deleteBtn.textContent = T('btnDelete');
    }, 3000);
    return;
  }
  clearTimeout(deleteConfirmTimer);
  deleteBtn.dataset.confirm = '';
  deleteBtn.textContent = T('btnDelete');
  await chrome.storage.local.remove('mamoru_gemini_key');
  apiKeyInput.value = '';
  showStatus(T('keyDeleted'), 'info');
  loadKey();
  setTimeout(hideStatus, 2000);
});

testBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim() || (await chrome.storage.local.get('mamoru_gemini_key')).mamoru_gemini_key;
  if (!key) { showStatus(T('enterOrSaveFirst'), 'error'); return; }

  showStatus(T('testing'), 'testing');
  testBtn.disabled = true;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
          tools: []
        })
      }
    );
    const data = await res.json();
    if (res.ok && data.candidates) {
      showStatus(T('testOk'), 'ok');
    } else {
      showStatus(T('errorPrefix') + geminiErrorText(res.status, data?.error?.message), 'error');
    }
  } catch (err) {
    showStatus(T('networkError') + err.message, 'error');
  } finally {
    testBtn.disabled = false;
  }
});

// ── AIエンジン（清書・添削に使うAI） ──
// Chrome 内蔵 AI（Prompt API / Gemini Nano）の利用可否は端末ごとに違うので、ここで見せる
async function nanoAvailabilityOpt() {
  if (typeof LanguageModel === 'undefined') return 'unavailable';
  try { return await LanguageModel.availability(); } catch { return 'unavailable'; }
}

function showEngineStatus(msg, type) {
  engineStatus.textContent = msg;
  engineStatus.className   = 'status-' + type;
  engineStatus.style.display = 'block';
}

async function loadEngine() {
  const { mamoru_engine } = await chrome.storage.local.get('mamoru_engine');
  engineSelect.value = mamoru_engine === 'nano' ? 'nano' : 'auto';

  const s = await nanoAvailabilityOpt();
  engineAvailEl.textContent =
    s === 'available' ? T('engineNanoReady')
    : (s === 'downloadable' || s === 'downloading') ? T('engineNanoDownload')
    : T('engineNanoNo');
}

engineSelect.addEventListener('change', async () => {
  await chrome.storage.local.set({ mamoru_engine: engineSelect.value });
  showEngineStatus(T('engineSetTo'), 'ok');
  setTimeout(() => { engineStatus.style.display = 'none'; }, 2000);
  renderTierLabel();

  // 端末内 AI を選んでモデルが未DLなら、この操作（クリック）を起点にDLを始める。
  // モデルDLを伴う create() はユーザー操作が必須のため、裏で勝手には始められない
  if (engineSelect.value === 'nano') {
    const s = await nanoAvailabilityOpt();
    if (s === 'downloadable' || s === 'downloading') startNanoDownload();
  }
});

let nanoDlRunning = false;
async function startNanoDownload() {
  if (nanoDlRunning || typeof LanguageModel === 'undefined') return;
  nanoDlRunning = true;
  showEngineStatus(T('engineDownloading') + ' 0%', 'testing');
  try {
    const session = await LanguageModel.create({
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          showEngineStatus(T('engineDownloading') + ' ' + Math.round(e.loaded * 100) + '%', 'testing');
        });
      },
    });
    session.destroy();
    showEngineStatus(T('engineDownloadDone'), 'ok');
    engineAvailEl.textContent = T('engineNanoReady');
    renderTierLabel();
  } catch (err) {
    // 進まない・失敗するケースの実例あり（Chrome の再起動で直る）。案内込みで出す
    showEngineStatus(T('engineDownloadFail') + (err.message || err), 'error');
  } finally {
    nanoDlRunning = false;
  }
}

// ── 音声認識の言語 ──
// 未設定ならブラウザの言語から推測し、以後は選んだ言語を優先する
async function loadLang() {
  const { mamoru_lang } = await chrome.storage.local.get('mamoru_lang');
  if (mamoru_lang) { langSelect.value = mamoru_lang; return; }

  // 未設定時は日本語。ブラウザのUI言語からは推測しない（sidepanel.js の DEFAULT_LANG と揃える）
  langSelect.value = 'ja-JP';
}

langSelect.addEventListener('change', async () => {
  await chrome.storage.local.set({ mamoru_lang: langSelect.value });
  const label = langSelect.options[langSelect.selectedIndex].textContent;
  langStatus.textContent = T('langSetTo', label);
  langStatus.className = 'status-ok';
  langStatus.style.display = 'block';
  setTimeout(() => { langStatus.style.display = 'none'; }, 2000);
});

document.addEventListener('DOMContentLoaded', () => { applyI18n(); loadKey(); loadLang(); loadEngine(); });
