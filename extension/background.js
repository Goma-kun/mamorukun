const PANEL_URL = chrome.runtime.getURL('sidepanel.html');

chrome.action.onClicked.addListener(async () => {
  // 既存のまもるくんウィンドウを全ウィンドウから検索
  const allWindows = await chrome.windows.getAll({ populate: true });
  for (const win of allWindows) {
    if (win.type === 'popup' && win.tabs?.some(t => t.url === PANEL_URL)) {
      await chrome.windows.update(win.id, { focused: true });
      return;
    }
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
