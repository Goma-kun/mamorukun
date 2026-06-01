const PANEL_URL = chrome.runtime.getURL('sidepanel.html');

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
