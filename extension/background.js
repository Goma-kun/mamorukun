const PANEL_URL = chrome.runtime.getURL('sidepanel.html');

// ============================================================
// アイコンバッジ＝「今日やる」残り件数
// 視界に入らないタスクは実行されない。パネルを閉じていても残数が見えるようにする
// ============================================================
function tasksRemainingToday(tasks) {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return (Array.isArray(tasks) ? tasks : [])
    .filter(t => t && !t.doneDay && (!t.when || t.when <= today)).length;
}

async function updateTaskBadge() {
  const { mamoru_tasks } = await chrome.storage.local.get('mamoru_tasks');
  const n = tasksRemainingToday(mamoru_tasks);
  chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' });
  if (n > 0) chrome.action.setBadgeBackgroundColor({ color: '#0ea5e9' });
}

chrome.runtime.onStartup.addListener(updateTaskBadge);
chrome.runtime.onInstalled.addListener(updateTaskBadge);
chrome.storage.onChanged.addListener((changes) => {
  if (changes.mamoru_tasks) updateTaskBadge();
});


chrome.action.onClicked.addListener(async () => {
  // 既存のまもるくんタブをURLで検索
  const tabs = await chrome.tabs.query({ url: PANEL_URL });
  if (tabs.length > 0) {
    await chrome.windows.update(tabs[0].windowId, { focused: true });
    return;
  }
  // なければ新規作成
  const focused = await chrome.windows.getLastFocused();
  const left = focused.left + focused.width - 380 - 10;
  const top = focused.top + 10;
  await chrome.windows.create({
    url: PANEL_URL,
    type: 'popup',
    width: 380,
    height: 620,
    left,
    top,
  });
});
