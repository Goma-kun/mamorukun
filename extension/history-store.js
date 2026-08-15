// ============================================================
// 履歴層。storage のキーと保存・読み出し・エクスポートをここに集約する。
// 独り言モード（英語学習モード）のデータは en_ 接頭辞で独立していて、
// 将来別プロダクトへ切り出すときは english-core.js とこのファイルを持っていけばよい
// ============================================================
const HistoryStore = (() => {
  const KEYS = {
    transcript:   'mamoru_transcript',   // 書き起こし中の本文
    cleanHistory: 'mamoru_history',      // 清書モードの履歴（直近3件）
    enSessions:   'en_sessions',         // 独り言モードのセッション履歴
    enRecurring:  'en_recurring',        // 独り言モードの繰り返し指摘
  };

  async function load() {
    const d = await chrome.storage.local.get(Object.values(KEYS));
    return {
      transcript:   d[KEYS.transcript] || '',
      cleanHistory: Array.isArray(d[KEYS.cleanHistory]) ? d[KEYS.cleanHistory] : [],
      enSessions:   Array.isArray(d[KEYS.enSessions])   ? d[KEYS.enSessions]   : [],
      enRecurring:  Array.isArray(d[KEYS.enRecurring])  ? d[KEYS.enRecurring]  : [],
    };
  }

  function saveTranscript(text) {
    chrome.storage.local.set({ [KEYS.transcript]: text });
  }

  function saveCleanHistory(list) {
    chrome.storage.local.set({ [KEYS.cleanHistory]: list });
  }

  function saveEnglish(sessions, recurring) {
    return chrome.storage.local.set({
      [KEYS.enSessions]:  sessions,
      [KEYS.enRecurring]: recurring,
    });
  }

  // 独り言モードのデータを JSON 文字列で書き出す。
  // 画面はまだ無い。それまでは DevTools から await HistoryStore.exportEnglishJson() で取れる
  async function exportEnglishJson() {
    const d = await load();
    return JSON.stringify({
      format:      'mamorukun-english-v1',
      exported_at: new Date().toISOString(),
      sessions:    d.enSessions,
      recurring:   d.enRecurring,
    }, null, 2);
  }

  return { KEYS, load, saveTranscript, saveCleanHistory, saveEnglish, exportEnglishJson };
})();
