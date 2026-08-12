// やることモード（先延ばし防止）のロジックを切り出して検証する。
// extractJsonObject などの共通関数は英語学習ブロックにあるので、両方のブロックを
// つないで評価する。マーカーコメントで囲んだ部分だけを取り出すので、本体は変えずに済む。
//   実行: node test/tasks_test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function extractBlock(relPath, start, end) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  const s = src.indexOf(start);
  const e = src.indexOf(end);
  if (s < 0 || e < 0) throw new Error(`マーカーが見つかりません: ${relPath} (${start})`);
  return src.slice(s, e);
}

const enBlock = extractBlock(
  'extension/sidepanel.js',
  '// ===== 英語学習モードのロジック（ここから）=====',
  '// ===== 英語学習モードのロジック（ここまで）=====',
);
const tkBlock = extractBlock(
  'extension/sidepanel.js',
  '// ===== やることモードのロジック（ここから）=====',
  '// ===== やることモードのロジック（ここまで）=====',
);

const mod = new Function(
  `${enBlock}
   ${tkBlock}
   return { shiftDayStamp, buildTasksPrompt, buildShrinkPrompt, parseTasksResponse,
            parseShrinkResponse, rolloverTasks, viewTasks, taskRemaining,
            tkOnDone, tkOnUndone, tkTotalDone, tkStreak, tkPruneStats,
            TK_MAX_TASKS, TK_STUCK_AT, TK_TIMER_MIN };`
)();

const {
  shiftDayStamp, buildTasksPrompt, buildShrinkPrompt, parseTasksResponse,
  parseShrinkResponse, rolloverTasks, viewTasks, taskRemaining,
  tkOnDone, tkOnUndone, tkTotalDone, tkStreak, tkPruneStats,
  TK_MAX_TASKS,
} = mod;

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

// ============================================================
console.log('== 日付の計算 ==');
check('翌日',            shiftDayStamp('2026-08-12', 1),  '2026-08-13');
check('前日',            shiftDayStamp('2026-08-12', -1), '2026-08-11');
check('月またぎ（進む）', shiftDayStamp('2026-08-31', 1),  '2026-09-01');
check('月またぎ（戻る）', shiftDayStamp('2026-08-01', -1), '2026-07-31');
check('年またぎ',        shiftDayStamp('2026-12-31', 1),  '2027-01-01');
check('うるう年',        shiftDayStamp('2028-02-28', 1),  '2028-02-29');

// ============================================================
console.log('== タスク抽出の応答の解釈 ==');
{
  const sample = { tasks: [
    { title: '経費精算を出す', first_step: '経費精算のページを開く' },
    { title: '上司にメールする', first_step: '件名だけ書く' },
  ] };
  const raw = JSON.stringify(sample);
  check('素の JSON',       parseTasksResponse(raw).length, 2);
  check('title が入る',    parseTasksResponse(raw)[0].title, '経費精算を出す');
  check('first_step → firstStep', parseTasksResponse(raw)[0].firstStep, '経費精算のページを開く');

  const fenced = '```json\n' + JSON.stringify(sample, null, 2) + '\n```';
  check('コードフェンス付き', parseTasksResponse(fenced).length, 2);

  const preamble = 'はい、以下が結果です。\n' + JSON.stringify(sample) + '\nご確認ください。';
  check('前置きと後書き付き', parseTasksResponse(preamble).length, 2);
}
check('JSON が無い（回答してきた）', parseTasksResponse('経費精算とは、立て替えた費用を…'), null);
check('壊れた JSON',                 parseTasksResponse('{ "tasks": ['), null);
check('tasks が無い',                parseTasksResponse('{"items":[]}'), null);
check('tasks が配列でない',          parseTasksResponse('{"tasks":"none"}'), null);
check('null 入力',                   parseTasksResponse(null), null);
check('空配列はそのまま通る',        parseTasksResponse('{"tasks":[]}'), []);
{
  const raw = JSON.stringify({ tasks: [
    { title: 'A' },                          // first_step 無し → 空文字
    { first_step: 'タイトルが無い' },        // title 無し → 捨てる
    { title: '  ', first_step: 'x' },        // 空白だけの title → 捨てる
    { title: 'B', firstStep: 'キャメルでも読む' },
  ] });
  const items = parseTasksResponse(raw);
  check('first_step 無しは空文字',  items[0], { title: 'A', firstStep: '' });
  check('title 無しは捨てる',       items.length, 2);
  check('firstStep 表記も読む',     items[1].firstStep, 'キャメルでも読む');
}
{
  const many = { tasks: Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, first_step: 's' })) };
  check('上限で打ち切る', parseTasksResponse(JSON.stringify(many)).length, TK_MAX_TASKS);
}

// ============================================================
console.log('== 一歩を小さく割る応答の解釈 ==');
check('素の JSON',        parseShrinkResponse('{"first_step":"ページを開くだけ"}'), 'ページを開くだけ');
check('フェンス付き',     parseShrinkResponse('```json\n{"first_step":"1行だけ書く"}\n```'), '1行だけ書く');
check('空文字は null',    parseShrinkResponse('{"first_step":""}'), null);
check('JSON 無しは null', parseShrinkResponse('もっと小さくすると良いですよ。'), null);

// ============================================================
console.log('== プロンプトの体裁 ==');
{
  const p = buildTasksPrompt('明日までに請求書を送らないと。あとジムの予約もしたい。');
  check('発話が入る',            p.includes('請求書を送らないと'), true);
  check('回答禁止の指示が入る',  p.includes('答えずに'), true);
  check('JSON 指定が入る',       p.includes('{"tasks":[{"title":"...","first_step":"..."}]}'), true);
}
{
  const p = buildShrinkPrompt('確定申告をやる', '書類を集める');
  check('タスク名が入る',   p.includes('確定申告をやる'), true);
  check('今の一歩が入る',   p.includes('書類を集める'), true);
  const p2 = buildShrinkPrompt('確定申告をやる', '');
  check('一歩が未設定でも壊れない', p2.includes('（未設定）'), true);
}

// ============================================================
console.log('== 日付が変わったときの持ち越し ==');
{
  const today = '2026-08-12';
  const tasksIn = [
    { id: 1, title: '昨日の残り',   when: '2026-08-11', createdAt: '2026-08-11', doneDay: null },
    { id: 2, title: '今日の予定',   when: '2026-08-12', createdAt: '2026-08-12', doneDay: null },
    { id: 3, title: '明日の予定',   when: '2026-08-13', createdAt: '2026-08-12', doneDay: null },
    { id: 4, title: '昨日終わった', when: '2026-08-11', createdAt: '2026-08-11', doneDay: '2026-08-11' },
    { id: 5, title: '今日終わった', when: '2026-08-12', createdAt: '2026-08-12', doneDay: '2026-08-12' },
  ];
  const out = rolloverTasks(tasksIn, today);
  const byId = Object.fromEntries(out.map(t => [t.id, t]));

  check('期日超過は今日へ寄せる',      byId[1].when, today);
  check('持ち越しの印が付く',          byId[1].carried, true);
  check('今日の予定はそのまま',        byId[2].when, '2026-08-12');
  check('明日の予定はそのまま',        byId[3].when, '2026-08-13');
  check('昨日の完了は一覧から消える',  byId[4], undefined);
  check('今日の完了は残る',            byId[5].doneDay, '2026-08-12');
  check('元の配列を壊さない',          tasksIn[0].carried, undefined);
  check('null 入力でも落ちない',       rolloverTasks(null, today), []);
}

// ============================================================
console.log('== 画面用の分類と並び ==');
{
  const today = '2026-08-12';
  const list = [
    { id: 3, title: '今日作った',      when: today,        createdAt: today,        doneDay: null },
    { id: 1, title: '一昨日から残る',  when: today,        createdAt: '2026-08-10', doneDay: null, carried: true },
    { id: 2, title: '昨日から残る',    when: today,        createdAt: '2026-08-11', doneDay: null, carried: true },
    { id: 4, title: '明日やる',        when: '2026-08-13', createdAt: today,        doneDay: null },
    { id: 5, title: '終わった',        when: today,        createdAt: today,        doneDay: today },
  ];
  const v = viewTasks(list, today);
  check('今日の分は古い順（沈ませない）', v.today.map(t => t.id), [1, 2, 3]);
  check('あす以降は別枠',                 v.later.map(t => t.id), [4]);
  check('今日の完了は別枠',               v.doneToday.map(t => t.id), [5]);
  check('残り件数は未完了の今日分だけ',   taskRemaining(list, today), 3);
  check('when 無しは今日扱い',            taskRemaining([{ id: 9, doneDay: null }], today), 1);
}

// ============================================================
console.log('== 完了の記録（合計・取り消し・連続日数）==');
{
  let s = { base: 0, days: {} };
  s = tkOnDone(s, '2026-08-12');
  s = tkOnDone(s, '2026-08-12');
  check('同じ日に2件',        s.days['2026-08-12'], 2);
  check('合計',               tkTotalDone(s), 2);

  s = tkOnUndone(s, '2026-08-12');
  check('取り消しで減る',     s.days['2026-08-12'], 1);
  s = tkOnUndone(s, '2026-08-12');
  check('0 になったら消える', s.days['2026-08-12'], undefined);
  s = tkOnUndone(s, '2026-08-12');
  check('0 未満にはならない', tkTotalDone(s), 0);
  check('null でも落ちない',  tkTotalDone(null), 0);
}
{
  const days3 = { '2026-08-12': 1, '2026-08-11': 2, '2026-08-10': 1 };
  check('今日を含む連続',       tkStreak({ base: 0, days: days3 }, '2026-08-12'), 3);
  check('今日まだでも継続中',   tkStreak({ base: 0, days: { '2026-08-11': 1, '2026-08-10': 1 } }, '2026-08-12'), 2);
  check('1日空くと途切れる',    tkStreak({ base: 0, days: { '2026-08-10': 1 } }, '2026-08-12'), 0);
  check('記録なしは 0',         tkStreak({ base: 0, days: {} }, '2026-08-12'), 0);
  check('月またぎでも数える',   tkStreak({ base: 0, days: { '2026-09-01': 1, '2026-08-31': 1 } }, '2026-09-01'), 2);
}
{
  const s = tkPruneStats(
    { base: 10, days: { '2020-01-01': 5, '2026-08-11': 1 } },
    '2026-08-12'
  );
  check('古い分は base に畳む',   s.base, 15);
  check('最近の分は残す',         s.days['2026-08-11'], 1);
  check('合計は変わらない',       tkTotalDone(s), 16);
}

// ============================================================
console.log('');
console.log(`結果: ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
