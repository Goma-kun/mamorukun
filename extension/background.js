let windowId = null;

chrome.action.onClicked.addListener(async () => {
  // 既存ウィンドウがあればフォーカス、なければ新規作成
  if (windowId !== null) {
    try {
      await chrome.windows.update(windowId, { focused: true });
      return;
    } catch (_) {
      windowId = null;
    }
  }
  const focused = await chrome.windows.getLastFocused();
  const left = focused.left + focused.width - 380 - 10;
  const top = focused.top + 10;
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('sidepanel.html'),
    type: 'popup',
    width: 380,
    height: 620,
    left,
    top,
  });
  windowId = win.id;
});

chrome.windows.onRemoved.addListener((id) => {
  if (id === windowId) windowId = null;
});
