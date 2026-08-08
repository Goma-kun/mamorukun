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

  tierLabel.innerHTML = hasKey
    ? `${T('tierFull')} <span class="tier-badge tier2">${T('badgeCleanOn')}</span>`
    : `${T('tierBasic')} <span class="tier-badge tier1">${T('badgeNoKey')}</span>`;
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
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

document.addEventListener('DOMContentLoaded', () => { applyI18n(); loadKey(); loadLang(); });
