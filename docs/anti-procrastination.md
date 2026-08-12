# やることモード：先延ばし防止の仕組みと根拠

「やること」タブは、先延ばし（procrastination）研究で効果が確認されている介入を、
まもるくんの「声で吐き出す」体験に合わせて組み込んだもの。
どの機能がどの知見に基づくかをここにまとめる。実装は `extension/sidepanel.js` の
「やることモード」セクション、検証は `test/tasks_test.mjs`。

## 前提にしている知見

先延ばしは「怠け」や時間管理の問題ではなく、**課題が引き起こす嫌な気分を避けるための
短期的な感情調整**として起きる（Sirois & Pychyl, 2013）。したがって効く介入は
「気合を入れさせる」ことではなく、**着手の瞬間の心理的コストを下げる**こと。

## 機能と根拠の対応

### 1. 声で吐き出すだけで登録できる
- 頭の中にあるやることは、曖昧なまま不安の種になり続ける（未完了課題は意識に残り続ける：Zeigarnik, 1927。書き出して計画にすると解放される：Masicampo & Baumeister, 2011）。
- 話す→自動でタスク化、の最小摩擦にして「整理すること自体の先延ばし」を防ぐ。
- APIキーが無い場合や AI が失敗した場合も、話した行をそのまま追加して内容を失わせない。

### 2. タスクごとに「5分で始められる最初の一歩」を自動生成
- 先延ばしの主因は課題の曖昧さと嫌悪感。抽象的な課題ほど着手されない（解釈レベル理論；具体的な実行計画が実行率を大きく上げる：Gollwitzer & Sheeran, 2006 のメタ分析で効果量 d≈0.65）。
- Gemini への指示は「頭の準備ではなく、体が動く最初の動作」（例：ページを開く、件名だけ書く）。

### 3. 「▶ 5分だけ」タイマー
- 「終わらせる」ではなく「始める」を目標にする（just get started：Pychyl）。
  始めてしまえば未完了のまま放置しにくくなる（Zeigarnik 効果）。
- 押した時点で「着手ずみ」と記録し、完走は要求しない。5分後は「ノッてきたなら続けて OK」とだけ伝える。

### 4. 完了数・連続日数の表示、アイコンバッジの残数
- 小さな前進の実感が翌日の意欲を最も強く支える（進捗の原理：Amabile & Kramer, 2011）。
- 連続日数は「今日まだ 0 件」でも昨日まで続いていれば継続中として表示し、朝イチにやる気を削がない。
- バッジは「視界に入らないタスクは実行されない」ことへの対策。パネルを閉じていても background.js が残数を出す。

### 5. 先送りを責めない。2回先送りされたら「一歩を小さく割る」
- 先延ばした自分を責めると回避感情が強まり、次の先延ばしがむしろ増える。
  自分を許した学生ほど次の試験勉強の先延ばしが減った（Wohl, Pychyl & Bennett, 2010）。
- そのため先送りボタンの文言は中立で、回数は静かに数えるだけ。2回で「気が重いサインかも。
  一歩を小さくしましょう」と**設計の問題**として扱い直し、AI がさらに小さい一歩（2分以内）に割り直す。

### 6. 期日は「今日／明日」だけ。持ち越しは翌日「今日」に自動で寄せる
- 人は遠い締切ほど価値を割り引く（現在バイアス・双曲割引：Ainslie; O'Donoghue & Rabin, 1999。
  動機は締切が近いほど強まる：時間的動機づけ理論 Steel & König, 2006）。
  遠い予定日を選ばせないことで「いつかやる」への逃げ道を塞ぐ。
- 日付が変わると持ち越しタスクは自動で「今日」に戻る。区切りの日は仕切り直しの動機が高まる
  （フレッシュスタート効果：Dai, Milkman & Riis, 2014）。持ち越しは「持ち越し」チップで示すだけで責めない。
- 今日の一覧は**古いものほど上**に出す。下に沈んだまま永遠に後回しになるのを防ぐ。

## 主な参考文献

- Sirois, F. & Pychyl, T. (2013). Procrastination and the priority of short-term mood regulation. *Social and Personality Psychology Compass*.
- Steel, P. (2007). The nature of procrastination: A meta-analytic and theoretical review. *Psychological Bulletin*.
- Steel, P. & König, C. (2006). Integrating theories of motivation (Temporal Motivation Theory). *Academy of Management Review*.
- Gollwitzer, P. & Sheeran, P. (2006). Implementation intentions and goal achievement: A meta-analysis. *Advances in Experimental Social Psychology*.
- Masicampo, E. & Baumeister, R. (2011). Consider it done! Plan making can eliminate the cognitive effects of unfulfilled goals. *JPSP*.
- Wohl, M., Pychyl, T. & Bennett, S. (2010). I forgive myself, now I can study. *Personality and Individual Differences*.
- Amabile, T. & Kramer, S. (2011). *The Progress Principle*. Harvard Business Review Press.
- Dai, H., Milkman, K. & Riis, J. (2014). The fresh start effect. *Management Science*.
- O'Donoghue, T. & Rabin, M. (1999). Doing it now or later. *American Economic Review*.

## 未対応（今後の候補）

- Web 版（`public/index.html`）への同機能の移植
- 実装意図の時間指定（「今日の 14 時に」まで踏み込む if-then プラン）
- 誘惑バンドリング（好きな作業とセットにする）などの報酬設計
