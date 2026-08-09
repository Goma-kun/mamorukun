// 英語学習モードのロジックをそのまま切り出して検証する。
// 拡張機能版（extension/sidepanel.js）と Web 版（public/index.html）は同じブロックを持つので、
// 両方から切り出して突き合わせ、同じテストを拡張機能版に対して回す。
// マーカーコメントで囲んだ部分だけを取り出すので、本体のコードは変えずに済む。
//   実行: node test/english_test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const START = '// ===== 英語学習モードのロジック（ここから）=====';
const END   = '// ===== 英語学習モードのロジック（ここまで）=====';

function extractBlock(relPath) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  const start = src.indexOf(START);
  const end   = src.indexOf(END);
  if (start < 0 || end < 0) throw new Error(`マーカーが見つかりません: ${relPath}`);
  return src.slice(start, end);
}

const blockExt = extractBlock('extension/sidepanel.js');
const blockWeb = extractBlock('public/index.html');

const mod = new Function(
  `${blockExt}
   return { extractJsonObject, parseFeedback, recurringText, promoteRecurring,
            topRecurring, foldSessions, buildEnglishUserMessage,
            EN_KEEP_FULL, EN_RECURRING_MIN, EN_RECURRING_SEND };`
)();

const {
  parseFeedback, promoteRecurring, topRecurring, foldSessions,
  buildEnglishUserMessage, EN_KEEP_FULL, EN_RECURRING_MIN,
} = mod;

// インデントだけ揃えて比較する。片方だけ直して食い違ったまま出荷するのを防ぐ
const normalize = s => s.split('\n').map(l => l.trimEnd().replace(/^\s+/, '')).join('\n').trim();

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}\n       期待: ${e}\n       実際: ${a}`);
  }
}

const SAMPLE = {
  corrected_text: 'I went to the park yesterday.',
  issues: [
    { type: 'vocabulary', original: 'develop my English', suggestion: 'improve my English', reason: 'develop は能力そのものを作る意味合いになります。' },
    { type: 'grammar',    original: 'I go to park',       suggestion: 'I went to the park', reason: '過去のことなので過去形にします。' },
  ],
  recurring: ['develop と improve の使い分け'],
  recognition_doubt: ['their / there'],
  good: '文と文のつなぎが自然でした。',
};

// ============================================================
console.log('== 拡張機能版と Web 版のロジックが一致しているか ==');
check('同じロジックを持っている', normalize(blockExt) === normalize(blockWeb), true);
if (normalize(blockExt) !== normalize(blockWeb)) {
  const a = normalize(blockExt).split('\n');
  const b = normalize(blockWeb).split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) { console.log(`       最初の違い ${i + 1} 行目\n       拡張: ${a[i]}\n       Web : ${b[i]}`); break; }
  }
}

// ============================================================
console.log('== JSON 以外が混ざって返ってきたとき ==');
{
  const raw = JSON.stringify(SAMPLE);
  check('素の JSON', parseFeedback(raw).corrected_text, SAMPLE.corrected_text);
}
{
  const raw = '```json\n' + JSON.stringify(SAMPLE, null, 2) + '\n```';
  check('コードフェンス付き', parseFeedback(raw).issues.length, 2);
}
{
  const raw = 'はい、承知しました。以下が結果です。\n\n```\n' + JSON.stringify(SAMPLE) + '\n```\nご確認ください。';
  check('前置きと後書き付き', parseFeedback(raw).good, SAMPLE.good);
}
{
  // 本文中に } を含む文字列があっても、対応する括弧まで正しく拾えること
  const tricky = { ...SAMPLE, good: '括弧 } と "引用符" が入っています' };
  const raw = 'ここから→ ' + JSON.stringify(tricky);
  check('文字列内の閉じ括弧', parseFeedback(raw).good, tricky.good);
}
check('JSON が無い',        parseFeedback('申し訳ありませんが対応できません。'), null);
check('壊れた JSON',        parseFeedback('{ "corrected_text": '), null);
check('文字列を返してきた', parseFeedback('{ "corrected_text": "x", }'), null);
check('null 入力',          parseFeedback(null), null);
{
  // 独り言の中の質問に Gemini が答えてしまった場合。JSON が無いので表示させない
  check('質問に回答してきた', parseFeedback('ローマ帝国は紀元前27年に始まりました。'), null);
}

// ============================================================
console.log('== 欠けたフィールドの補完 ==');
{
  const fb = parseFeedback('{"corrected_text":"Hello."}');
  check('issues が無い → 空配列',    fb.issues, []);
  check('recurring が無い → 空配列', fb.recurring, []);
  check('good が無い → 空文字',      fb.good, '');
}
{
  const fb = parseFeedback(JSON.stringify({ corrected_text: 'Hello.', issues: [] }));
  check('issues が空のまま通る', fb.issues, []);
}
{
  const fb = parseFeedback(JSON.stringify({
    issues: [
      { type: 'VOCABULARY', original: 'a', suggestion: 'b', reason: 'r' },
      { type: 'なにか',     original: 'c', suggestion: 'd' },
      { type: 'grammar',    original: 'e' },                    // suggestion 無しは捨てる
      { type: 'grammar',    reason: 'これは指摘になっていない' }, // 同上
    ],
  }));
  check('type は大文字でも通る',   fb.issues[0].type, 'vocabulary');
  check('未知の type は phrasing', fb.issues[1].type, 'phrasing');
  check('reason 無しは空文字',     fb.issues[1].reason, '');
  check('片方だけの指摘は捨てる',  fb.issues.length, 2);
}

// ============================================================
console.log('== 繰り返し指摘の昇格（1回目では昇格しない・2回目で昇格する）==');
{
  const issue = { type: 'vocabulary', original: 'develop my English', suggestion: 'improve my English', reason: '' };

  let list = promoteRecurring([], [issue], '2026-08-10');
  check('1回目は記録される',            list.length, 1);
  check('1回目の count',                list[0].count, 1);
  check('1回目は Gemini に渡さない',    topRecurring(list).length, 0);

  list = promoteRecurring(list, [issue], '2026-08-11');
  check('2回目で count が増える',       list[0].count, 2);
  check('2回目で Gemini に渡る',        topRecurring(list).map(r => r.text), ['develop my English → improve my English']);
  check('last_seen が更新される',       list[0].last_seen, '2026-08-11');
  check('昇格のしきい値',               EN_RECURRING_MIN, 2);
}
{
  // 同じセッション内で同じ指摘が2回出ても、1回とだけ数える（1日で昇格させない）
  const issue = { type: 'grammar', original: 'I go', suggestion: 'I went', reason: '' };
  const list = promoteRecurring([], [issue, { ...issue }], '2026-08-10');
  check('セッション内の重複は1回', list[0].count, 1);
}
{
  // 大文字小文字・余分な空白の違いは同じ指摘として扱う
  const a = { type: 'vocabulary', original: 'Develop  my English', suggestion: 'improve my English', reason: '' };
  const b = { type: 'vocabulary', original: 'develop my english', suggestion: 'Improve My English', reason: '' };
  const list = promoteRecurring(promoteRecurring([], [a], '2026-08-10'), [b], '2026-08-11');
  check('表記ゆれは同一視', list.length, 1);
  check('まとめて2回',      list[0].count, 2);
}
{
  const list = [
    { text: 'a → A', count: 5, last_seen: '2026-08-01' },
    { text: 'b → B', count: 1, last_seen: '2026-08-02' },
    { text: 'c → C', count: 9, last_seen: '2026-08-03' },
    { text: 'd → D', count: 2, last_seen: '2026-08-04' },
    { text: 'e → E', count: 3, last_seen: '2026-08-05' },
    { text: 'f → F', count: 4, last_seen: '2026-08-06' },
    { text: 'g → G', count: 8, last_seen: '2026-08-07' },
  ];
  check('多い順に上位5件', topRecurring(list).map(r => r.text), ['c → C', 'g → G', 'a → A', 'f → F', 'e → E']);
}

// ============================================================
console.log('== 履歴の畳み込み（30件を超えたとき）==');
{
  const mkSession = (i) => ({
    id: `2026-08-10T00:00:${String(i).padStart(2, '0')}Z`,
    transcript: `transcript ${i}`,
    corrected_text: `corrected ${i}`,
    issues: [{ type: 'grammar', original: `o${i}`, suggestion: `s${i}`, reason: `r${i}` }],
    good: `good ${i}`,
  });

  const sessions = Array.from({ length: 35 }, (_, i) => mkSession(i));
  const folded = foldSessions(sessions);

  check('件数は減らない',              folded.length, 35);
  check('保持件数の既定値',            EN_KEEP_FULL, 30);
  check('29件目は全文のまま',          folded[29].transcript, 'transcript 29');
  check('30件目は畳まれる',            folded[30].folded, true);
  check('transcript は捨てる',         folded[30].transcript, undefined);
  check('corrected_text は捨てる',     folded[30].corrected_text, undefined);
  check('id は残す',                   folded[30].id, sessions[30].id);
  check('issues は type と suggestion だけ', folded[30].issues, [{ type: 'grammar', suggestion: 's30' }]);

  // 保存のたびに走らせても、畳み済みのものが壊れないこと
  const again = foldSessions([mkSession(99), ...folded]);
  check('再実行しても畳み済みは維持',  again[31].issues, [{ type: 'grammar', suggestion: 's30' }]);
  check('再実行で30件目が新たに畳まれる', again[30].folded, true);

  check('30件以下なら何も畳まない', foldSessions(sessions.slice(0, 30)).every(s => !s.folded), true);

  // 上限を超えたぶんは捨てる（chrome.storage.local を無限に太らせない）
  const many = Array.from({ length: 500 }, (_, i) => mkSession(i));
  check('保持上限で打ち切る', foldSessions(many).length, 400);
}

// ============================================================
console.log('== Gemini へ渡すユーザーメッセージ ==');
{
  const msg = buildEnglishUserMessage('I go to park yesterday.', [
    { text: 'develop → improve', count: 3, last_seen: '2026-08-10' },
  ]);
  check('書き起こしが入る', msg.includes('I go to park yesterday.'), true);
  check('繰り返し指摘が入る', msg.includes('- develop → improve（3 回）'), true);
  check('見出しの体裁', msg.startsWith('## 今回の独り言（音声認識結果）\n'), true);
}
{
  const msg = buildEnglishUserMessage('Hello.', []);
  check('繰り返しが無ければ「なし」', msg.trim().endsWith('なし'), true);
}
{
  // 過去の全文がプロンプトに紛れ込んでいないこと
  const sessions = [{ id: '1', transcript: 'PAST TRANSCRIPT', corrected_text: 'PAST CORRECTED', issues: [], good: '' }];
  const msg = buildEnglishUserMessage('today text', topRecurring([]));
  check('過去の書き起こしを渡さない', msg.includes(sessions[0].transcript), false);
  check('過去の修正版を渡さない',     msg.includes(sessions[0].corrected_text), false);
}

// ============================================================
console.log('');
console.log(`結果: ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
