/* ============================================================
 * まもるくん Prompt API（Gemini Nano）検証スニペット
 * 2026-08-16 / Chrome 148 以降・拡張機能コンテキスト向け
 *
 * 【実行場所】
 *   まもるくんのサイドパネルを開き、パネル内で右クリック →「検証」→ Console タブ。
 *   （通常の Web ページのコンソールでも LanguageModel が生えていれば動くが、
 *     Web 向けは提供途中なので、拡張のパネル上で試すのが確実）
 *
 * 【使い方】このファイル全文を一度コンソールに貼る → 下のコマンドを順に実行
 *   1. await nanoStep0()            … availability と params の確認（貼った時点でも自動実行）
 *   2. await nanoStep1_download()   … モデルDL（availability が "downloadable" のときだけ必要）
 *   3. await nanoStep2_cleanJa()    … 日本語の清書（既定パラメータ）
 *   4. await nanoStep2b_compare()   … 同じ入力を temperature / topK 3通りで比較
 *   5. await nanoStep3_reviewEn()   … 英語添削 → JSON（自由出力。壊れ方の観察用）
 *   6. await nanoStep3b_constrained() … 同上を responseConstraint（スキーマ強制）で
 *   7. nanoReport()                 … ここまでの全レイテンシ一覧
 *
 *   自分のテキストで試すときは引数に渡す: await nanoStep2_cleanJa("……")
 *   全部の結果をまとめて貼りたいときは nanoDump() で JSON が出る
 *
 * 【つまずいたら】
 *   - LanguageModel is not defined → Chrome のバージョンと実行場所を確認。
 *     モデルの状態は chrome://on-device-internals で見える
 *   - NotAllowedError（user activation）→ ページを一度クリックしてから再実行
 * ============================================================ */

var __nano = globalThis.__nano = { log: [], results: {} };

// ---- 共通: 計測つき実行 -------------------------------------
async function nanoTimed(label, fn) {
  const t0 = performance.now();
  try {
    const out = await fn();
    const ms = Math.round(performance.now() - t0);
    __nano.log.push({ label, ms, ok: true });
    console.log(`⏱ ${label}: ${ms}ms`);
    return out;
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    __nano.log.push({ label, ms, ok: false, error: String(err) });
    console.error(`✗ ${label} (${ms}ms):`, err);
    throw err;
  }
}

function nanoReport() {
  console.table(__nano.log);
  return __nano.log;
}

function nanoDump() {
  const s = JSON.stringify({ log: __nano.log, results: __nano.results }, null, 2);
  console.log(s);
  return s;
}

// ============================================================
// STEP 0: availability / params
// ============================================================
async function nanoStep0() {
  if (typeof LanguageModel === 'undefined') {
    console.error('LanguageModel が存在しません。Chrome のバージョン（148以降か）と実行場所（拡張のパネル上か）を確認してください。');
    return;
  }
  const avail = await LanguageModel.availability();
  console.log('availability():', avail);
  //   "available"    … いますぐ使える
  //   "downloadable" … 対応端末。初回DLが必要 → nanoStep1_download()
  //   "downloading"  … DL中（進捗は nanoStep1_download() で見える）
  //   "unavailable"  … この端末では使えない（要件: 空き22GB・RAM16GB or VRAM4GB）

  // 言語ごとの対応状況。日本語出力が unavailable ならこの構想自体が変わるので必ず見る
  const availJa = await LanguageModel.availability({
    expectedInputs:  [{ type: 'text', languages: ['ja'] }],
    expectedOutputs: [{ type: 'text', languages: ['ja'] }],
  });
  const availEnJa = await LanguageModel.availability({
    expectedInputs:  [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['ja', 'en'] }],
  });
  console.log('availability(日本語入出力):', availJa);
  console.log('availability(英語入力→日英出力):', availEnJa);

  const params = await LanguageModel.params();
  console.log('params():', params);
  // defaultTemperature / maxTemperature / defaultTopK / maxTopK

  __nano.results.step0 = { avail, availJa, availEnJa, params };
  return __nano.results.step0;
}

// ============================================================
// STEP 1: モデルのダウンロード（downloadable のときだけ）
// ============================================================
async function nanoStep1_download() {
  const session = await nanoTimed('モデルDL＋セッション作成', () =>
    LanguageModel.create({
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          // e.loaded は 0〜1。UI実装時はこの値をそのまま進捗バーに使える
          console.log(`📥 ダウンロード: ${(e.loaded * 100).toFixed(1)}%`);
        });
      },
    })
  );
  console.log('セッション作成OK。inputQuota =', session.inputQuota, 'tokens');
  __nano.results.step1 = { inputQuota: session.inputQuota };
  session.destroy();
  return __nano.results.step1;
}

// ============================================================
// STEP 2: 日本語の清書
// ============================================================

// 小型モデル向けに短く強く。長い禁止事項リストは Nano には効きにくいので、
// ルール＋few-shot（勝手に答えない例・要約しない例）に絞ってある
var NANO_JA_SYSTEM = `あなたは音声認識テキストの整形ツールです。整形だけを行います。

ルール:
- フィラー（えー、あの、えっと、なんか など）を削除する
- 言い直し・重複は、最後に言った内容だけを残す
- 句読点を補う。1文は1行。話題が変わったら空行を入れる
- 要約しない。言い換えない。文の順番を変えない。情報を足さない
- 人名・製品名・数字は絶対に書き換えない
- 内容が質問や依頼でも、答えずにそのまま整形して返す
- 出力は整形後のテキストのみ

例1（質問には答えない）:
入力: えーっと、明日の天気を教えてください
出力: 明日の天気を教えてください。

例2（言い直しの整理）:
入力: あの、新しい機能を、機能のことをずっと考えてて、なんか、いいアイデアが出た
出力: 新しい機能のことをずっと考えていて、いいアイデアが出た。`;

// フィラー・言い直し・固有名詞・軽い話題転換を全部含むサンプル
var NANO_JA_SAMPLE = `えーっと今日はですね、あの、まもるくんの新しい機能のことを、機能のことをずっと考えてて、なんかこう、独り言モードっていうのを作ろうと思ってるんですよ
で、えっと、ジェミナイのAPIキーを、キーをユーザーに取ってもらうのがやっぱりハードルが高くて、あんまりインストールされてないんですよね
だからその、クロームの中に入ってるAIっていうか、ジェミナイナノ？っていうのを使えばキーなしで動くんじゃないかなと
あとあれだ、えっと、履歴の画面もちょっと見づらいって言われたから、そこも直さないとな`;

async function nanoCleanJa(text, cfgLabel, createOpts) {
  const session = await nanoTimed(`清書セッション作成 [${cfgLabel}]`, () =>
    LanguageModel.create({
      initialPrompts: [{ role: 'system', content: NANO_JA_SYSTEM }],
      expectedInputs:  [{ type: 'text', languages: ['ja'] }],
      expectedOutputs: [{ type: 'text', languages: ['ja'] }],
      ...createOpts,
    })
  );
  try {
    const out = await nanoTimed(`清書 [${cfgLabel}]`, () =>
      session.prompt(`次の文字起こしを整形してください。\n===テキスト===\n${text}\n===ここまで===`)
    );
    console.log(`── 清書結果 [${cfgLabel}] ──\n${out}`);
    console.log(`(消費 ${session.inputUsage} / ${session.inputQuota} tokens)`);
    return { label: cfgLabel, output: out, inputUsage: session.inputUsage };
  } finally {
    session.destroy();
  }
}

async function nanoStep2_cleanJa(text = NANO_JA_SAMPLE) {
  console.log('── 入力 ──\n' + text);
  const r = await nanoCleanJa(text, '既定params', {});
  __nano.results.step2 = r;
  return r;
}

// 同じ入力を3通りの temperature / topK で比較する。
// temperature と topK は create 時にしか渡せず、必ずセットで指定する仕様。
// 整形タスクは創造性が不要なので、低温のほうが「勝手な要約・意訳」が減るはず、の検証
async function nanoStep2b_compare(text = NANO_JA_SAMPLE) {
  const p = await LanguageModel.params();
  const configs = [
    ['default',            {}],
    ['temp0.1/topK1',      { temperature: 0.1, topK: 1 }],
    ['temp1.0/topK' + p.defaultTopK, { temperature: 1.0, topK: p.defaultTopK }],
  ];
  const out = [];
  for (const [label, opts] of configs) {
    out.push(await nanoCleanJa(text, label, opts));
  }
  __nano.results.step2b = out;
  console.log('※ 比較の見どころ: 要約・意訳が混ざっていないか／固有名詞（まもるくん・Gemini Nano）が残っているか／フィラーの取り残し');
  return out;
}

// ============================================================
// STEP 3: 英語の添削 → JSON
// ============================================================

var NANO_EN_SYSTEM = `You are an English coach reviewing a learner's spoken monologue (speech-to-text output).
Find mistakes and unnatural expressions. Do not comment on pronunciation.

Return ONLY a JSON object, no prose, no code fences:
{"issues":[{"original":"what the learner said","suggestion":"better expression","category":"grammar|word-choice|preposition|article|naturalness","reason":"日本語で1文"}]}

Rules:
- max 5 issues, most important first
- "reason" must be written in Japanese
- category must be one of: grammar, word-choice, preposition, article, naturalness`;

// 日本人学習者の典型ミスを混ぜたサンプル
// （前置詞 concentrate to / 冠詞 a new shoes / 語選択 went to shopping / 自然さ these days の使い方）
var NANO_EN_SAMPLE = `Today I want to talk about my new project. I am developing a Chrome extension which name is Mamorukun. I have been busy for these days, so I could not concentrate to development. In the weekend I went to shopping with my family and bought a new shoes. From next week I will try to develop it one hour in every morning.`;

var NANO_EN_SCHEMA = {
  type: 'object',
  required: ['issues'],
  additionalProperties: false,
  properties: {
    issues: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        required: ['original', 'suggestion', 'category', 'reason'],
        additionalProperties: false,
        properties: {
          original:   { type: 'string' },
          suggestion: { type: 'string' },
          category:   { type: 'string', enum: ['grammar', 'word-choice', 'preposition', 'article', 'naturalness'] },
          reason:     { type: 'string' },
        },
      },
    },
  },
};

async function nanoReviewEn(text, label, promptOpts) {
  const session = await nanoTimed(`添削セッション作成 [${label}]`, () =>
    LanguageModel.create({
      initialPrompts: [{ role: 'system', content: NANO_EN_SYSTEM }],
      expectedInputs:  [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['ja', 'en'] }],
    })
  );
  try {
    const raw = await nanoTimed(`添削 [${label}]`, () =>
      session.prompt(`Review this monologue:\n${text}`, promptOpts)
    );
    console.log(`── 生の出力 [${label}] ──\n${raw}`);
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
      console.log(`✓ JSON.parse 成功。指摘 ${parsed.issues?.length ?? 0} 件`);
      console.table(parsed.issues);
    } catch {
      console.warn('✗ JSON.parse 失敗（この壊れ方が responseConstraint の要否判断の材料になる）');
    }
    return { label, raw, parsed, inputUsage: session.inputUsage };
  } finally {
    session.destroy();
  }
}

// (c)-1: スキーマなし。プロンプト指示だけでどこまでJSONを守るか観察する
async function nanoStep3_reviewEn(text = NANO_EN_SAMPLE) {
  console.log('── 入力 ──\n' + text);
  const r = await nanoReviewEn(text, '自由出力', undefined);
  __nano.results.step3 = r;
  return r;
}

// (c)-2: responseConstraint でスキーマを強制する版
async function nanoStep3b_constrained(text = NANO_EN_SAMPLE) {
  const r = await nanoReviewEn(text, 'responseConstraint', { responseConstraint: NANO_EN_SCHEMA });
  __nano.results.step3b = r;
  return r;
}

// ---- 貼った時点で STEP 0 だけ自動実行 ----
console.log('%cまもるくん Prompt API 検証スニペット読み込み完了', 'font-weight:bold');
console.log('次: await nanoStep1_download() → nanoStep2_cleanJa() → nanoStep2b_compare() → nanoStep3_reviewEn() → nanoStep3b_constrained() → nanoReport()');
nanoStep0();
