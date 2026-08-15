// ============================================================
// 独り言モード（英語学習モード）の純ロジック
// ============================================================
// sidepanel.js から切り出したもの。実行環境固有の API（chrome.*・DOM）には触れない。
// test/english_test.mjs がマーカーで囲んだ部分を切り出して Node で検証し、
// Web 版（public/index.html）の同名ブロックと突き合わせる。
// 将来 独り言モードを別プロダクトへ切り出すときは、このファイルと
// history-store.js を持っていけばロジックはそのまま動く。

// ===== 英語学習モードのロジック（ここから）=====
// このブロックは test/english_test.mjs が切り出して Node で検証する。
// 拡張機能版と Web 版（public/index.html）で同じ内容を保つこと。
// 実行環境固有の API（chrome.*・localStorage）と DOM には触れないこと。

const EN_KEEP_FULL      = 30;  // 全文で残すセッション数。これより古いものは指摘だけに畳む
const EN_KEEP_TOTAL     = 400; // 畳んだものも含めた保持上限
const EN_RECURRING_MIN  = 2;   // 何回出たら「繰り返し」として Gemini に渡すか
const EN_RECURRING_SEND = 5;   // Gemini に渡す繰り返し指摘の件数

const EN_TYPES = ['phrasing', 'vocabulary', 'grammar'];

// Gemini はコードフェンスや前置きを付けて返すことがあるので、
// 最初の { から対応する } までを取り出してから解釈する。取れなければ null。
function extractJsonObject(raw) {
  if (typeof raw !== 'string') return null;
  const start = raw.indexOf('{');
  if (start < 0) return null;

  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return raw.slice(start, i + 1);
  }
  return null;
}

function asStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map(x => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
}

function asText(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// 応答を、表示と保存が前提にできる形に揃える。読み取れなければ null を返す。
function parseFeedback(raw) {
  const json = extractJsonObject(raw);
  if (json === null) return null;

  let data;
  try { data = JSON.parse(json); } catch { return null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const issues = Array.isArray(data.issues) ? data.issues : [];
  return {
    corrected_text: asText(data.corrected_text),
    issues: issues
      .map(it => {
        const type = asText(it && it.type).toLowerCase();
        return {
          type:       EN_TYPES.includes(type) ? type : 'phrasing',
          original:   asText(it && it.original),
          suggestion: asText(it && it.suggestion),
          reason:     asText(it && it.reason),
        };
      })
      .filter(it => it.original && it.suggestion),
    recurring:         asStringArray(data.recurring),
    recognition_doubt: asStringArray(data.recognition_doubt),
    good:              asText(data.good),
  };
}

// 指摘を1行の文字列にする。これが繰り返し判定のキーにもなる
function recurringText(issue) {
  return `${issue.original} → ${issue.suggestion}`;
}

function recurringKey(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// 今回の指摘を繰り返しリストへ反映する。
// 1回目は count:1 で控えるだけで、EN_RECURRING_MIN 回に達したものが Gemini に渡る対象になる。
function promoteRecurring(prev, issues, today) {
  const list  = (Array.isArray(prev) ? prev : []).map(r => ({ ...r }));
  const index = new Map(list.map((r, i) => [recurringKey(r.text), i]));
  const seen  = new Set();

  for (const issue of (issues || [])) {
    const text = recurringText(issue);
    const key  = recurringKey(text);
    if (!key || seen.has(key)) continue;   // 同じセッション内の重複は1回と数える
    seen.add(key);

    const at = index.get(key);
    if (at === undefined) {
      index.set(key, list.length);
      list.push({ text, count: 1, last_seen: today });
    } else {
      list[at].count    = (list[at].count || 0) + 1;
      list[at].last_seen = today;
    }
  }
  return list;
}

// Gemini に渡すのは「2回以上出たもの」の上位だけ。履歴の全文は渡さない
function topRecurring(list, limit = EN_RECURRING_SEND, min = EN_RECURRING_MIN) {
  return (Array.isArray(list) ? list : [])
    .filter(r => (r.count || 0) >= min)
    .sort((a, b) => (b.count - a.count) || String(a.text).localeCompare(String(b.text)))
    .slice(0, limit);
}

// 直近 EN_KEEP_FULL 件は全文、それ以前は transcript と corrected_text を捨てて
// issues の type と suggestion だけ残す。保存のたびに走らせる
function foldSessions(sessions, keepFull = EN_KEEP_FULL, keepTotal = EN_KEEP_TOTAL) {
  const list = Array.isArray(sessions) ? sessions : [];
  return list.slice(0, keepTotal).map((s, i) => {
    if (i < keepFull || s.folded) return s;
    return {
      id: s.id,
      folded: true,
      issues: (s.issues || []).map(it => ({ type: it.type, suggestion: it.suggestion })),
    };
  });
}

// 履歴からコピーするときの本文。修正版だけでなく、何をどう直されたのかも持ち出せるようにする。
// （独り言タブのコピーは音読用なので修正版だけ。用途が違うので分けている）
// 見出しは表示言語に合わせて呼び出し側から渡す
function buildSessionText(session, labels) {
  const s = session || {};
  const L = labels || {};
  const out = [];

  if (s.corrected_text) out.push(`【${L.corrected}】\n${s.corrected_text}`);

  const issues = s.issues || [];
  if (issues.length > 0) {
    const lines = issues.map((it, i) => {
      // 畳んだ古い記録は suggestion しか残っていない
      const head = it.original ? `${it.original}\n   → ${it.suggestion}` : `→ ${it.suggestion}`;
      const type = L.types && L.types[it.type] ? `[${L.types[it.type]}] ` : '';
      return `${i + 1}. ${type}${head}${it.reason ? `\n   ${it.reason}` : ''}`;
    });
    out.push(`【${L.issues}】\n${lines.join('\n\n')}`);
  }

  if (s.good) out.push(`【${L.good}】\n${s.good}`);
  if (s.transcript) out.push(`【${L.said}】\n${s.transcript.trim()}`);

  return out.join('\n\n');
}

// Gemini へ渡すユーザーメッセージ。過去のセッション全文は渡さない
function buildEnglishUserMessage(transcript, recurring) {
  const lines = (recurring || []).map(r => `- ${r.text}（${r.count} 回）`);
  return `## 今回の独り言（音声認識結果）
${String(transcript).trim()}

## これまでに繰り返し指摘されている点
${lines.length ? lines.join('\n') : 'なし'}`;
}
// ===== 英語学習モードのロジック（ここまで）=====
