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

async function loadKey() {
  const { mamoru_gemini_key } = await chrome.storage.local.get('mamoru_gemini_key');
  const hasKey = !!mamoru_gemini_key;

  keySavedIndicator.style.display = hasKey ? '' : 'none';
  apiKeyInput.value = hasKey ? mamoru_gemini_key : '';
  apiKeyInput.placeholder = hasKey ? '（設定済み）' : 'AIza...';

  tierLabel.innerHTML = hasKey
    ? '文字起こし + AI清書 <span class="tier-badge tier2">✨ 清書 ON</span>'
    : '文字起こしのみ <span class="tier-badge tier1">APIキー未設定</span>';
}

saveBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) { showStatus('APIキーを入力してください', 'error'); return; }
  if (!key.startsWith('AIza')) { showStatus('有効なGemini APIキーは "AIza" で始まります', 'error'); return; }

  await chrome.storage.local.set({ mamoru_gemini_key: key });
  showStatus('✓ 保存しました', 'ok');
  loadKey();
  setTimeout(hideStatus, 2000);
});

let deleteConfirmTimer = null;
deleteBtn.addEventListener('click', async () => {
  if (deleteBtn.dataset.confirm !== '1') {
    deleteBtn.dataset.confirm = '1';
    deleteBtn.textContent = '本当に削除しますか？';
    deleteConfirmTimer = setTimeout(() => {
      deleteBtn.dataset.confirm = '';
      deleteBtn.textContent = '削除';
    }, 3000);
    return;
  }
  clearTimeout(deleteConfirmTimer);
  deleteBtn.dataset.confirm = '';
  deleteBtn.textContent = '削除';
  await chrome.storage.local.remove('mamoru_gemini_key');
  apiKeyInput.value = '';
  showStatus('APIキーを削除しました', 'info');
  loadKey();
  setTimeout(hideStatus, 2000);
});

testBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim() || (await chrome.storage.local.get('mamoru_gemini_key')).mamoru_gemini_key;
  if (!key) { showStatus('先にAPIキーを入力または保存してください', 'error'); return; }

  showStatus('⏳ 接続テスト中...', 'testing');
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
      showStatus('✓ 接続成功！APIキーは有効です', 'ok');
    } else {
      const msg = data?.error?.message || '不明なエラー';
      showStatus('✗ エラー: ' + msg, 'error');
    }
  } catch (err) {
    showStatus('✗ 通信エラー: ' + err.message, 'error');
  } finally {
    testBtn.disabled = false;
  }
});

// ── 音声認識の言語 ──
// 未設定ならブラウザの言語から推測し、以後は選んだ言語を優先する
async function loadLang() {
  const { mamoru_lang } = await chrome.storage.local.get('mamoru_lang');
  if (mamoru_lang) { langSelect.value = mamoru_lang; return; }

  const ui = (chrome.i18n.getUILanguage() || 'ja').toLowerCase();
  const match = [...langSelect.options].find(o => o.value.toLowerCase() === ui)
             || [...langSelect.options].find(o => o.value.toLowerCase().startsWith(ui.split('-')[0]));
  langSelect.value = match ? match.value : 'ja-JP';
}

langSelect.addEventListener('change', async () => {
  await chrome.storage.local.set({ mamoru_lang: langSelect.value });
  const label = langSelect.options[langSelect.selectedIndex].textContent;
  langStatus.textContent = `✓ ${label} に設定しました`;
  langStatus.className = 'status-ok';
  langStatus.style.display = 'block';
  setTimeout(() => { langStatus.style.display = 'none'; }, 2000);
});

document.addEventListener('DOMContentLoaded', () => { loadKey(); loadLang(); });
