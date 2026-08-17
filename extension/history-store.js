// ============================================================
// 履歴層。storage のキーと保存・読み出し・エクスポートをここに集約する。
// 独り言モード（英語学習モード）は v1.8.0 で単独の拡張機能「独り言」へ分離した。
// 過去の独り言データ（en_ 接頭辞）はユーザーのデータなので消さずに残し、
// exportEnglishJson で「独り言」拡張へ移行できるようにしてある
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

  // 過去の独り言データを JSON 文字列で書き出す（「独り言」拡張のインポートで読める形式）。
  // 画面は無い。DevTools から await HistoryStore.exportEnglishJson() で取る
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
