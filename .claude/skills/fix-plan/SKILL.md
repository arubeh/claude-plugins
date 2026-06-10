---
name: fix-plan
description: バグや軽微な修正の原因を調査し、GitHub Issueを作成する。実装は行わない。Issueが溜まったら /fix-impl でまとめて実装できる。
argument-hint: "<問題の説明>"
---

# Fix-Plan スキル

バグや軽微な修正の原因を調査し、GitHub Issue を作成します。実装は行いません。
Issue が溜まったら `/fix-impl` でまとめて実装できます。

## 使い方

```
/fix-plan VECTOR_DB_DIMENSION の値が不整合を起こしている
/fix-plan ログイン時に500エラーが出る
/fix-plan 未使用 import が残っている
```

**引数は必須です。** `$ARGUMENTS` が空の場合は処理を中断し、使い方を案内します。

## 実行フロー

```
引数チェック ────────────────────────
    │
    ├─ 引数あり → plan モード開始 (EnterPlanMode) → Step 1 へ
    └─ 引数なし → 「問題の説明を指定してください」→ 処理中断
    │
─── ここから plan モード（読み取り専用・コード/ファイルを書かない）───
    │
Step 1: GitHub 連携確認 + 重複 Issue 確認
    │
    ├─ git remote -v でリモートURL確認
    ├─ gh auth status で認証状態確認
    ├─ gh issue list --state open で重複チェック
    └─ 重複あり → 該当 Issue を案内して終了
    │
Step 2: 原因・対象の特定
    │
    ├─ CLAUDE.md の "## Project Context" を参照
    ├─ 必要に応じて最小限の Grep/Read で原因特定
    └─ 影響ファイル・修正方針を整理
    │
    ※ CLAUDE.md がない場合:
      → Explore で調査（読み取りのみ）。CLAUDE.md への書き出しは
        plan モード中はできないため Step 4（承認後）に回す
    │
Step 3: Issue 内容整理
    │
    ├─ タイトル生成
    ├─ ラベル自動判定
    └─ 本文テンプレート生成
    │
    ▼ ExitPlanMode で計画（Issue ドラフト）を提示し承認を取る
      「この内容で作成してよいか？」
    │
─── plan モード終了（承認後・ここから書き込み可）───
    │
Step 4: Issue 作成 + 保留書き込みの反映
    │
    ├─ gh issue create --title "..." --label "..." --body "..."
    └─ Step 2 で保留した CLAUDE.md "## Project Context" を書き出す（初回のみ）
    │
Step 5: 次のアクション案内
    │
    └─ Issue URL を表示して終了
        「修正する場合は /fix-impl を実行してください」
        「他にも修正がある場合は /fix-plan で追加登録できます」
```

## plan モード（読み取り専用の保証）

調査フェーズ（Step 1〜3）は **plan モード**で実行し、コード・ファイルを書かないことをハーネス側で保証する。散文の「実装しない」指示ではなく、Edit/Write が物理的にブロックされた状態で調査する。

1. **開始**: 引数チェックを通過したら `EnterPlanMode` を呼び、plan モードに入る。
2. **調査**: Step 1〜3 は読み取り専用ツール（`git`/`gh` の参照系、`Grep`/`Read`/`Explore`）のみで進める。
3. **承認**: Step 3 で Issue ドラフトが固まったら `ExitPlanMode` で計画を提示し、ユーザー承認を得て plan モードを抜ける。承認 =「この内容で作成してよいか？」への Yes。
4. **書き込みは承認後**: `gh issue create` と、Step 2 で保留した CLAUDE.md `## Project Context` の書き出しは **plan モードを抜けた後（Step 4）** に行う。plan モード中は Write がブロックされるため。

`gh issue create` は Bash の副作用コマンドなので plan モード中でも実行を試みれば確認プロンプトが出るが、Issue 作成は「成果物の確定」なので必ず ExitPlanMode 承認後に実行する。

## 引数チェック

`$ARGUMENTS` が空の場合は処理を中断する。

```
⚠ 問題の説明を指定してください。

  使い方:
    /fix-plan VECTOR_DB_DIMENSION の値が不整合を起こしている
    /fix-plan ログイン時に500エラーが出る
    /fix-plan 未使用 import が残っている
```

## Step 1: GitHub 連携確認 + 重複 Issue 確認

```bash
# リモートURL確認
git remote -v

# GitHub CLI 認証状態確認
gh auth status

# オープンな Issue 一覧を取得して重複チェック
gh issue list --state open --limit 50
```

判定:

- **リモート未設定** → 処理中断、`git remote add origin` を案内
- **認証未完了** → 処理中断、`gh auth login` を案内
- **重複あり** → 該当 Issue を案内して終了:
  ```
  ■ 類似の Issue が既に存在します

    #38 VECTOR_DB_DIMENSION の不整合を修正 (bug)

    この Issue で対応可能であれば /fix-impl で修正を開始できます。
    別の問題であれば、説明を変えて再度 /fix-plan を実行してください。
  ```
- **重複なし** → Step 2 へ

## Step 2: 原因・対象の特定

### CLAUDE.md キャッシュ確認

CLAUDE.md に `## Project Context` セクションがあるか確認する:

1. **ある場合**: セクション内容を参照して調査をスコープ限定（高速）
2. **ない場合**: Explore で調査（初回のみ遅い・**読み取りのみ**）→ 調査結果は保持し、CLAUDE.md への `## Project Context` 書き出しは **plan モードを抜けた Step 4（承認後）に実行**する（plan モード中は Write 不可）。書き出し後は以後の /fix-plan, /fix-impl, /issue-create 全てが高速化

### 調査内容

- ユーザーの説明から関連キーワードを抽出
- Grep/Read で原因箇所を特定
- 影響ファイル・修正方針を整理

## Step 3: Issue 内容整理

以下を生成し、`ExitPlanMode` で計画として提示してユーザー承認を取る（plan モードはここで抜ける）:

```markdown
タイトル: VECTOR_DB_DIMENSION の不整合を修正
ラベル:   bug

## 概要
VECTOR_DB_DIMENSION の値がモデルの実際の出力次元数と一致していない。

## 原因
config.py で VECTOR_DB_DIMENSION = 768 と定義されているが、
使用モデル text-embedding-3-small のデフォルト出力は 1536 次元。

## 影響ファイル
- src/config.py
- src/vectordb/client.py

## 受け入れ条件
- [ ] VECTOR_DB_DIMENSION が実際のモデル出力次元数と一致している
- [ ] 既存のベクトルデータとの互換性が確認されている

## 技術メモ
- text-embedding-3-small のデフォルト次元数: 1536
- dimensions パラメータで 768 に縮小可能だが、明示的な設定が必要
```

### ラベル自動判定

| ユーザーの表現 | ラベル |
|---------------|--------|
| エラー、バグ、壊れた、動かない、失敗 | `bug` |
| リファクタ、整理、cleanup、未使用 | `refactor` |
| ドキュメント、README、typo | `documentation` |
| テスト修正、mock、カバレッジ | `test` |
| 遅い、パフォーマンス | `performance` |

**注意**: `enhancement` は付与しない（/fix-plan の対象外。新機能は /issue-create を使用）。

## Step 4: Issue 作成

ここで plan モードを抜けている（Step 3 の ExitPlanMode 承認後）。`gh issue create` を実行する。

```bash
gh issue create \
  --title "VECTOR_DB_DIMENSION の不整合を修正" \
  --label "bug" \
  --body "$(cat <<'EOF'
## 概要
...

## 原因
...

## 影響ファイル
...

## 受け入れ条件
- [ ] ...

## 技術メモ
- ...
EOF
)"
```

### 保留した CLAUDE.md 書き出し（初回のみ）

Step 2 で CLAUDE.md に `## Project Context` が無く Explore 調査を行った場合、plan モードを抜けたこのタイミングで調査結果を CLAUDE.md に書き出す。次回以降の /fix-plan・/fix-impl・/issue-create が高速化する。

## Step 5: 次のアクション案内

Issue URL を表示して終了する。`/fix-impl` は自動実行しない。

```
Issue #42 を作成しました。
https://github.com/owner/repo/issues/42

修正する場合は /fix-impl を実行してください。
他にも修正がある場合は /fix-plan で追加登録できます。
```

## 他のスキルとの連携

- `/fix-plan` → バグ調査 + Issue 作成（このスキル）
- `/fix-impl` → fix 系 Issue を自動収集して実装 + PR 作成
- `/issue-create` → 新機能の Issue 作成
- `/issue-flow #N` → 新機能の Issue 実装 + PR 作成
