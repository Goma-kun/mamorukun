# Chrome Web Store 申請チェックリスト — まもるくん

## 提出前に完了すること

### ファイル準備
- [x] `content.js` 削除済み（未使用コード、manifest に content_scripts なし）
- [x] `privacy-policy.html` 作成済み（`public/` フォルダ）
- [ ] プライバシーポリシーをウェブ上の公開URLに公開する
  - GitHub Pages または Cloudflare Pages でホスティング
  - 例: `https://goma-kun.github.io/mamorukun/privacy-policy.html`

### ZIPファイル作成
```
extension/ フォルダの中身のみをZIP化する（フォルダごとではなく中身を）
```
含めるファイル:
- [x] `manifest.json`
- [x] `background.js`
- [x] `sidepanel.html`
- [x] `sidepanel.js`
- [x] `options.html`
- [x] `options.js`
- [x] `icons/icon16.png`
- [x] `icons/icon48.png`
- [x] `icons/icon128.png`

### スクリーンショット（必須: 1280×800 または 640×400）
- [ ] メイン画面（録音停止中）
- [ ] 録音中の画面（■ 停止ボタン表示）
- [ ] 清書結果の画面（ティア2）
- [ ] 設定画面（APIキー入力）

### ストア説明文（日本語）
```
短い説明（132文字以内）:
リアルタイム音声文字起こし & AI清書アシスタント。APIキー不要で文字起こしメモとして使えます。Gemini APIキーを設定すると録音停止後に自動で清書・コピーまで完了。

詳細説明:
まもるくんは、会議・講義・インタビューをその場でテキスト化する Chrome 拡張機能です。

【基本機能（無料・APIキー不要）】
・ワンクリックでリアルタイム音声文字起こし
・文字起こしはブラウザにローカル保存
・どのタブを開いていても使用可能

【清書機能（Gemini APIキー設定時）】
・録音停止と同時にGemini AIが自動で清書
・フィラー語（えー、あのー）や言い淀みを除去
・整えた文章をそのままクリップボードにコピー
・清書結果はその場で編集可能

【プライバシー重視の設計】
・必要最小限の権限のみ要求（storage のみ）
・APIキーはあなたの端末だけに保存
・開発者のサーバーにデータは送信されません
```

## Chrome Web Store Developer Dashboard での入力項目

### ストア掲載情報
- [ ] 拡張機能名: `まもるくん`
- [ ] 説明文: 上記コピー
- [ ] カテゴリ: `生産性`
- [ ] 言語: 日本語
- [ ] スクリーンショット: 最低1枚（最大5枚）

### プライバシー
- [ ] プライバシーポリシーURL: 公開後のURL
- [ ] 単一用途の説明:「音声文字起こしとAI清書を行う拡張機能」
- [ ] データ使用の申告:
  - 「ユーザーデータを収集しない」にチェック（開発者サーバーには何も送らない）
  - ただし「Web Speech API を通じてGoogleに音声が送信されること」は補足説明に記載

### 権限の正当化（審査フォームで聞かれた場合）
- `storage`: 文字起こしテキストとGemini APIキーをローカル保存するため
- `host_permissions (generativelanguage.googleapis.com)`: ユーザーが設定したGemini APIキーで清書APIを呼び出すため

## 審査通過のポイント

1. **最小権限**: tabs, scripting, activeTab 等の強い権限を要求していない ✅
2. **BYOK設計**: APIキーはユーザー管理、開発者サーバーなし ✅
3. **未使用コードなし**: content.js 削除済み ✅
4. **プライバシーポリシー**: Web Speech API のGoogle送信を明記 ✅
5. **マイク権限**: ブラウザが都度確認するため manifest での宣言不要 ✅

---

## ハンドオフログ

### 2026-05-28 — プライバシーポリシー最終調整・申請物完成

**実施内容（commit: fa9675f）**
- 第6項 権限リストからマイクを削除（storage と generativelanguage.googleapis.com の2つに整理）。マイクはnoteブロックで「ブラウザが都度確認する権限」として別記。manifest と一致。
- 第7項（新設）Google API Limited Use への準拠：Chrome Web Store User Data Policy 準拠の英文定型文を追加。"Limited Use" にChrome公式ドキュメントへのリンクあり。
- 第8項 お問い合わせ：提供者名「ニシラ（個人事業主）」を追記。
- 最終更新日を 2026年5月28日 に修正。

**現状**
申請物の中身はすべて完成。残りは以下の手作業のみ：
1. GitHub Pages 有効化（Settings → Pages → Source: main / `/public`）
2. ポリシーURL確認: `https://goma-kun.github.io/mamorukun/privacy-policy.html`
3. スクリーンショット撮影（1280×800、4枚）
4. `extension/` の中身をZIP化
5. Chrome Web Store Developer Dashboard で申請
