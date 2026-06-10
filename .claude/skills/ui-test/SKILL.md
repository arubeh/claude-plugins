---
name: ui-test
description: テスト仕様書に基づき acdp MCP でブラウザを直接操作して UI テストを実行し、判定結果をレポート出力する。
---

# UI テストスキル

テスト仕様書（Markdown）を入力として受け取り、**acdp MCP サーバー（Chrome DevTools Protocol、Playwright MCP 互換）経由でブラウザを直接操作**して UI の表示・動作を検証します。コードは生成しません。各テストケースの PASS/FAIL を判定し、スクリーンショット付きのレポートを出力します。

## 前提条件

acdp MCP サーバーがプロジェクトルートの `.mcp.json` に設定されていること:

```json
{
  "mcpServers": {
    "acdp": {
      "command": "${HOME}/.acode/bin/acdp"
    }
  }
}
```

## 使い方

```
/ui-test <仕様書パス>
/ui-test docs/test-specs/login-test.md
/ui-test docs/test-specs/search-flow.md --url http://localhost:3000
```

## 実行内容

### 1. 事前チェック

- テスト仕様書の存在と形式を確認
- 対象アプリケーションの URL を特定（引数 `--url` > 仕様書内の記載 > `localhost:3000`）
- acdp MCP サーバーの接続を確認

### 2. テスト仕様書の解析

仕様書から以下を抽出:

| 項目 | 説明 |
|------|------|
| テストケース | ID・画面名・操作手順・期待結果 |
| 前提条件 | ログイン情報・初期データ・環境 |
| 判定基準 | 各ケースの PASS/FAIL 条件 |

### 3. 出力フォルダの準備

テスト開始前に出力先フォルダを確定する:

```
test-results/
  stories/                       ← UI テストの artifacts ルート
    <シナリオ名>/                ← 仕様書ファイル名（拡張子なし）
      <YYYYMMDD-HHmmss>/        ← テスト実行日時（秒まで）
        01/                      ← ステップ 1（連番フォルダ）
          screenshot.png         ← スクリーンショット (必須)
          snap.md                ← browser_snapshot 取得時のみ (discovery 用途)
          cdp.log                ← browser_cdp_log 取得時のみ (debug 用途)
        02/
          screenshot.png
        03/
          screenshot.png
          error.txt              ← エラー時のみ生成
        report.md                ← テスト結果レポート（実行フォルダ直下）
  recordings/                    ← `browser_recording_*` の生記録（自動）
  cdp-errors/                    ← Issue #42 失敗時の CDP 自動 dump
```

**WHY `stories/` 配下に置くか**: `test-results/` 直下には `recordings/`（録画 → 仕様書生成）と `cdp-errors/`（失敗時の CDP dump）が並存する。UI テストの artifact はそれらと役割が違う（人手で運用する判定エビデンス）ので、`stories/` という名前で 1 段深い独立ルートを設ける。`.gitignore` でも粒度を変えやすくなる。

- `<シナリオ名>`: 仕様書のファイル名から拡張子を除いたもの（例: `suumo-search-meguro-mansion`）
- `<YYYYMMDD-HHmmss>`: テスト開始時刻（例: `20260319-143025`）
- 各ステップは **画面遷移の順番に `01/`, `02/`, `03/`...** と連番フォルダで管理（テストケースをまたいで通し番号、ゼロ埋め2桁）
- `screenshot.png`: 各ステップのスクリーンショット（固定名、**★必須★**）
- `snap.md`: `browser_snapshot` を discovery 用途で取得した時のみ生成。ステップフォルダ内に置くことで後から検索・再利用可能
- `cdp.log`: `browser_cdp_log` を呼んだ時のみ生成。そのステップで acdp が送受信した CDP メッセージのダンプ (debug 用途)
- `error.txt`: そのステップで FAIL/ERROR が発生した場合のみ生成。期待値・実際値・推定原因を記載
- `report.md`: 全体レポート（実行日時フォルダ直下）

**step 完全性ルール (重要)**: `NN/` フォルダは **必ず `screenshot.png` を含む**。`browser_snapshot` / `browser_cdp_log` だけを呼んで screenshot を撮らずに次ステップへ進んではいけない (SKIP ステップを除く)。取り忘れを防ぐため、**1 ステップのツール呼び出し列は必ず `browser_take_screenshot` で締める** と覚える。snap.md は discovery のために読むもの、screenshot.png は判定エビデンスとして残すものであり、役割が違う。

**【最重要】artifact ファイルは必ずフルパスで指定する**:

acdp の `filename` を受け取るすべてのツール (`browser_take_screenshot` / `browser_snapshot` / `browser_cdp_log`) は、**渡された文字列をそのまま `test-results/` 配下に書き出す** (相対パスの自動プレフィックス)。つまり LLM 側で **シナリオ名 + 時刻 + ステップ番号 + 固定ファイル名** を連結したフルパスを毎回渡す必要がある。

**✅ 正しい呼び方**:
```
browser_take_screenshot { filename: "stories/suumo-search-meguro-mansion/20260411-200439/04/screenshot.png" }
browser_snapshot        { filename: "stories/suumo-search-meguro-mansion/20260411-200439/04/snap.md" }
browser_cdp_log         { filename: "stories/suumo-search-meguro-mansion/20260411-200439/04/cdp.log" }
```

**❌ ダメな呼び方**:
```
browser_take_screenshot { filename: "04/screenshot.png" }                                ← test-results/04/screenshot.png になる
browser_snapshot        { filename: "snap.md" }                                          ← test-results/snap.md になり step 対応不明
browser_take_screenshot { filename: "suumo-.../20260411-200439/04/screenshot.png" }      ← stories/ プレフィックスを忘れて recordings/ と混在する
```

シナリオ名と時刻は テスト開始時の Step 3 で確定しているので、ステップごとに `NN` を差し替えて連結する。

### 4. ブラウザ直接操作によるテスト実行

**コード生成は行わない。** acdp MCP の `browser_*` ツールでブラウザを直接操作する:

ステップ連番カウンターを 1 から開始し、各テストケースに対して以下を繰り返す:

1. **`browser_set_artifact_dir`** — ステップの **先頭** で必ず呼ぶ。`dir: "stories/<シナリオ名>/<時刻>/<NN>"` を渡すと、それ以降に失敗したツール呼び出しの自動 CDP エラー dump がそのステップフォルダに `cdp-error-<tool>-<uuid8>.md` として着地する。**忘れた場合**は dump がグローバルな `test-results/cdp-errors/` に飛び散り、後から「どのステップで何が起きたか」を追えなくなる
2. **`browser_navigate`** — 対象 URL にアクセス
3. **`browser_click_by_name` / `browser_type_by_name` / `browser_select_option_by_name` / `browser_hover_by_name`** — 要素の「見えるテキスト」（accessible name）で直接操作
4. **`browser_take_screenshot`** — `filename: "stories/<シナリオ名>/<時刻>/<NN>/screenshot.png"` のフルパスで保存。**`stories/` プレフィックスを忘れない**（`recordings/` と混在する）。**省略禁止** — `browser_snapshot` でステップを終わらせると artifact 欠落になり、Section 5 の完全性検証で警告される
5. **目視判定** — スクリーンショットの内容から期待結果を照合（vision モード）
6. **エラー記録** — FAIL/ERROR の場合、同じフォルダに `error.txt` を生成。`browser_set_artifact_dir` を先に呼んでおけば、acdp の自動 dump が同じフォルダに `cdp-error-*.md` を残すので、`error.txt` 内でそのファイルを参照できる

### 原則: semantic-first、snapshot は discovery 用のみ（重要）

**`browser_*_by_name` を第 1 選択として使う。** Issue #27 で追加された acdp 拡張ツール群で、CDP `Accessibility.queryAXTree` を直接叩いて要素を取得するため、以下の 3 問題を同時に解消する:

1. **snapshot 不要** — 100-400KB の AX ツリーを LLM 側で読む必要がない → トークン消費が大幅に減る
2. **stale ref なし** — 毎呼び出しで AX ツリーを再解決するため、前段の click で DOM が変わっても次段で失敗しない
3. **LLM のツール呼び出し回数が半減** — 1 ステップ = `click_by_name → screenshot` の 2 呼び出しで完結

#### 使い方（semantic-first パターン）

```
browser_click_by_name  { name: "この条件で検索する", role: "button" }
browser_type_by_name   { name: "検索キーワード", text: "東京都目黒区" }
browser_select_option_by_name { name: "駅徒歩", values: ["10分以内"] }
browser_hover_by_name  { name: "詳細メニュー" }
```

- `name` は必須。要素の accessible name（ボタンならラベル文字、input ならひもづく `<label>` のテキスト、aria-label 等）を厳密一致で渡す
- `role` は曖昧さを排除したい時にだけ指定（`button` / `link` / `textbox` / `checkbox` / `combobox` / `menuitem` 等）
- 同じ name+role が複数あると `ambiguous match` エラーになる → `nth: 0` で 0 番目を明示する
- 要素が存在しないと `element not found by name` エラーになる → 名前が正しいか `browser_snapshot` で 1 度だけ確認する

#### snapshot は discovery 用途だけ

要素の accessible name が事前に分かっていない時だけ `browser_snapshot` で 1 度取得し、Grep で探索する:

```
browser_snapshot → filename: "stories/<シナリオ名>/<時刻>/<NN>/snap.md"
Grep → pattern: "検索する|目黒区" path: "test-results/stories/<シナリオ名>/<時刻>/<NN>/snap.md"
```

**ファイル名はステップフォルダのフルパスを含める** — 例えば `"stories/suumo-search-meguro-mansion/20260411-200439/04/snap.md"`。こうしないと `test-results/` 直下にフラットに散らばって、後からどのステップの snap か分からなくなる。acdp は渡された相対パスを自動的に `test-results/` 配下に書き出すので、上記のパスは `test-results/stories/suumo-search-meguro-mansion/20260411-200439/04/snap.md` に着地する。

取れたら **それ以降のステップは `browser_*_by_name` で直接操作する**。snapshot をステップごとに取る旧パターンは絶対に避ける。

#### CDP プロトコルログ (debug 用途)

操作の原因調査が必要な時 (click が謎の失敗をした等)、`browser_cdp_log` で直前の CDP やりとりを dump できる:

```
browser_cdp_log → filename: "stories/<シナリオ名>/<時刻>/<NN>/cdp.log"
```

成果物として `test-results/stories/<シナリオ名>/<時刻>/<NN>/cdp.log` に保存される。通常ステップでは呼ばず、failure 調査時のみ使う。

#### fallback: ref 方式（旧パターン）

`browser_click` / `browser_type` / `browser_select_option` / `browser_hover` は Playwright MCP 互換のため残されているが、以下の場合のみ使う:

- semantic 方式で `element not found` が出て、かつ対象要素に accessible name が無い場合
- 複雑な座標ベースの操作（ドラッグ、マウスホイール 等）

ref 方式は `browser_snapshot` で取得した `r1/r2/...` を `ref` パラメータに渡すが、stale ref / トークン肥大の問題は残る。

#### 1 ステップ = 最小ツール呼び出し

| パターン | ツール呼び出し | 回数 |
|---------|-------------|------|
| ページ遷移 | navigate → screenshot | 2 |
| 要素クリック（名前既知） | **click_by_name → screenshot** | **2** |
| 要素クリック（名前未知） | snapshot(filename) → grep → click_by_name → screenshot | 4 |
| フォーム入力 | **type_by_name → screenshot** | **2** |
| プルダウン選択 | **select_option_by_name → screenshot** | **2** |
| 判定のみ | screenshot | 1 |

**避けるべきパターン:**
- ❌ ステップごとに snapshot を取り直す
- ❌ snapshot → Grep → ref 方式 click を毎回やる（旧 Playwright MCP 流）
- ✅ 最初の 1 回だけ snapshot で名前を調べ、あとは semantic 方式で連続操作する

#### screenshot で判定する（snapshot で判定しない）

- `--vision` モードが有効なので、**判定は screenshot の目視確認で行う**
- screenshot 1 回 ≪ snapshot 1 回（トークンコスト）
- 期待結果の照合に snapshot のテキスト解析は不要。screenshot の画像を見て判定する

### 5. 判定・レポート出力

- テストケースごとに PASS / FAIL / SKIP / ERROR を判定
- **artifact 完全性検証 (必須)** — `report.md` を書き出す前に、各ステップフォルダを走査して `screenshot.png` の不在を検出する (下記 bash)。検出結果は `report.md` の冒頭に **「⚠️ Artifact 警告」セクション** として必ず追記する。警告 0 件のときも「Artifact 警告: なし」と明示する (silent skip 禁止)
- 詳細レポートを実行日時フォルダ直下の `report.md` に出力
- レポート内で各スクリーンショットを `![NN](NN/screenshot.png)` で参照
- FAIL/ERROR のステップは `error.txt` の内容もレポートに含める
- フォルダ内に `error.txt` が存在するかどうかで、エラー箇所を一目で特定できる

**完全性検証スクリプト** (テスト判定とは独立、警告のみ):

```bash
missing=()
for d in test-results/stories/<シナリオ名>/<時刻>/*/; do
  step=$(basename "$d")
  [[ "$step" == "report.md" ]] && continue
  if [ ! -f "$d/screenshot.png" ]; then
    extras=$(ls "$d" 2>/dev/null | tr '\n' ' ')
    missing+=("step $step: screenshot.png 欠落 (存在: ${extras:-なし})")
  fi
done
```

`missing` 配列が空でなければ `report.md` の冒頭に以下を追記する:

```markdown
## ⚠️ Artifact 警告

以下のステップで `screenshot.png` が欠落しています (テスト判定には影響しませんが、該当ステップの視覚的エビデンスが残っていません):

- step 05: screenshot.png 欠落 (存在: snap.md)
- step 08: screenshot.png 欠落 (存在: snap.md)

原因の多くは `browser_snapshot` で情報を取得した後 `browser_take_screenshot` を呼び忘れたケースです。次回は各ステップを必ず screenshot で締めてください。
```

### 6. 後片付け (必須)

レポート生成後、`test-results/` 直下と `test-results/stories/` 直下にフラットに残った artifact ファイルを削除する。これらは LLM が過去に誤ったフルパス（`stories/` プレフィックスや時刻フォルダの欠落）で発行した残骸で、次回のテスト実行時にも残り続ける:

```bash
find test-results test-results/stories -maxdepth 1 -type f \( \
  -name 'snap*.md' \
  -o -name 'snap*.yaml' \
  -o -name 'screenshot*.png' \
  -o -name 'screenshot*.webp' \
  -o -name 'screenshot*.jpeg' \
  -o -name 'cdp*.log' \
\) -print -delete 2>/dev/null
```

- `-maxdepth 1` で各シナリオフォルダ (`test-results/stories/suumo-.../...`) の中身には触れない
- `recordings/` `cdp-errors/` 配下も `-maxdepth 1` の絞り込みで触らない
- 正規のステップフォルダ内 artifact (`test-results/stories/<シナリオ>/<時刻>/<NN>/...`) は保持される
- 削除ログを `report.md` の末尾に「cleanup」セクションとして追記する

## 使用ツール

| ツール | 用途 |
|--------|------|
| `browser_navigate` | URL にアクセス |
| `browser_snapshot` | ページ構造を取得（要素特定用） |
| `browser_click` | 要素をクリック |
| `browser_type` | テキスト入力 |
| `browser_select_option` | プルダウン選択 |
| `browser_screenshot` | スクリーンショット取得（判定エビデンス） |
| `browser_wait` | 要素の表示待ち |
| `browser_tab_*` | タブ切り替え（新しいタブで開く場合） |
| Read | テスト仕様書の読み取り |
| Write | レポートの書き出し |

## テスト仕様書のフォーマット

テスト仕様書は以下の形式を推奨（他の形式でも解析可能）:

```markdown
# テスト仕様書: <機能名>

## 前提条件
- 対象URL: http://localhost:3000
- ログイン: test@example.com / password123

## テストケース

### TC-001: ログイン画面の表示
- 画面: /login
- 操作手順:
  1. /login にアクセスする
  2. ページの読み込みを待つ
- 期待結果:
  - メールアドレス入力欄が表示される
  - パスワード入力欄が表示される
  - ログインボタンが表示される
```

## 操作の手順

各テストケースを実行する際の基本手順:

1. **操作実行** — 前ステップの応答から ref を特定し、`browser_click` / `browser_type` / `browser_select_option` を実行
2. **ref 不明時のみ snapshot** — 応答に目的の要素がなければ `browser_snapshot(filename)` → Grep で ref を検索
3. **screenshot で判定** — 操作後に `browser_screenshot` を取得し、画像を目視確認して PASS/FAIL を判定
4. **次の操作の ref を応答から取得** — click/navigate の応答に含まれる snapshot を活用し、追加の snapshot 呼び出しを避ける

ポップアップやモーダルが表示された場合は、閉じるボタンを snapshot で探してクリックしてから本来の操作を続行する。

## 出力例

### フォルダ構成例

```
test-results/
  stories/
   suumo-search-meguro-mansion/
    20260319-143025/
      01/                        ← TC-001: トップページ表示
        screenshot.png
      02/                        ← TC-002: 中古マンション検索ページ
        screenshot.png
      03/                        ← TC-003: 東京都選択（エラー発生）
        screenshot.png
        error.txt                ← エラー内容
      04/                        ← TC-004: SKIP
      05/                        ← TC-005: 検索結果一覧
        screenshot.png
      06/                        ← TC-006: 価格安い順ソート後
        screenshot.png
      07/                        ← TC-007: 物件詳細ページ
        screenshot.png
      report.md
```

### error.txt の例

```
期待: 東京都の市区町村選択ページが表示される
実際: モーダルが表示されたまま遷移しなかった
推定原因: 「関東」→「東京都」の2段階選択が必要だが、直接「東京都」をクリックしようとした
```

### レポート出力例

```
═══════════════════════════════════════
  UI テスト結果レポート
═══════════════════════════════════════

## テスト結果サマリー
- 合計: 3 ケース
- PASS: 2
- FAIL: 1
- SKIP: 0
- ERROR: 0

## 総合判定: FAIL

## 詳細結果

### TC-001: ログイン画面の表示
- 判定: PASS
- スクリーンショット: ![01](01/screenshot.png)

### TC-002: ログイン成功
- 判定: PASS
- スクリーンショット: ![02](02/screenshot.png), ![03](03/screenshot.png)

### TC-003: エラーメッセージ表示
- 判定: FAIL
- スクリーンショット: ![04](04/screenshot.png)
- 期待: エラーメッセージが表示される
- 実際: 画面に変化なし
- エラー詳細: [04/error.txt](04/error.txt)
═══════════════════════════════════════
```

## 他のスキルとの連携

| スキル | 連携方法 |
|--------|---------|
| `/e2e` | E2E テストコードの生成・保守（`/ui-test` は仕様書ベースの手動テスト代替） |
| `/issue-flow` | Phase 3 のレビューで UI テストを追加実行 |
| `/fix-plan` | UI テスト失敗を起点にバグ Issue を作成 |
| `/requirement` | 要件定義書からテスト仕様書を生成する起点 |

## `/e2e` との違い

| 観点 | `/e2e` | `/ui-test` |
|------|--------|-----------|
| 方式 | テストコード生成・実行 | MCP でブラウザ直接操作 |
| 入力 | ユーザーフロー名（自動生成） | テスト仕様書（人が書く） |
| 目的 | リグレッション防止のテストコード | 仕様通りの UI 動作を確認 |
| 出力 | テストファイル（`.spec.ts` 等） | 判定レポート + スクリーンショット |
| 継続性 | CI で繰り返し実行 | 都度実行（受入テスト向き） |
| 適用場面 | 開発中の自動テスト | リリース前の仕様確認・受入テスト |
