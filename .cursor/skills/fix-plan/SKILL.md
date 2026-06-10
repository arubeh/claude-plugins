---
name: fix-plan
description: バグや軽微な修正の原因を調査し、GitHub Issueを作成する。実装は行わない。Issueが溜まったら /fix-impl でまとめて実装できる。Use when user wants to investigate a bug or minor fix (e.g. /fix-plan ログイン時に500エラーが出る).
---

# Fix-Plan スキル

バグや軽微な修正の原因を調査し、GitHub Issue を作成する。実装は行わない。Issue が溜まったら `/fix-impl` でまとめて実装できる。

## 使い方

```
/fix-plan VECTOR_DB_DIMENSION の値が不整合を起こしている
/fix-plan ログイン時に500エラーが出る
/fix-plan 未使用 import が残っている
```

**引数（問題の説明）は必須。** 空の場合は「問題の説明を指定してください」と案内して中断。

## 実行フロー

1. **引数チェック** — 引数なしなら中断
2. **plan モード開始 (EnterPlanMode)** — 以降の調査（手順 3〜6）は読み取り専用。コード/ファイルを書かない
3. **GitHub 連携確認** — `git remote -v`, `gh auth status`
4. **重複 Issue 確認** — `gh issue list --state open` でキーワード検索。重複あれば案内して終了
5. **原因・対象の特定** — AGENTS.md の `## Project Context` を参照（なければ Explore で**読み取り**調査。AGENTS.md への書き出しは plan モード中は不可なので手順 8 に回す）。Grep/Read で原因特定、影響ファイル・修正方針を整理
6. **Issue 内容整理** — タイトル・ラベル（bug/refactor/documentation/test/performance）・本文（概要・原因・影響ファイル・受け入れ条件・技術メモ）を生成
7. **承認 (ExitPlanMode)** — Issue ドラフトを計画として提示し承認を取る（「この内容で作成してよいか？」）。承認で plan モードを抜ける
8. **Issue 作成 + 保留書き込み** — `gh issue create`。手順 5 で保留した AGENTS.md `## Project Context` の書き出しもここで実行（初回のみ）
9. 作成後 Issue URL を表示して終了。「修正する場合は `/fix-impl` を実行してください」と案内（自動実行しない）

### plan モード（読み取り専用の保証）

調査（手順 3〜6）は **plan モード**で実行し、Edit/Write がハーネス側で物理的にブロックされた状態で進める。`gh issue create` と AGENTS.md 書き出しは **ExitPlanMode 承認後（手順 8）** に行う。plan モード中は Write 不可のため。`gh issue create` は副作用 Bash なので、必ず承認後に実行する。

## ラベル判定ルール

| ユーザーの表現 | ラベル |
|---------------|--------|
| エラー、バグ、壊れた、動かない、失敗 | `bug` |
| リファクタ、整理、cleanup、未使用 | `refactor` |
| ドキュメント、README、typo | `documentation` |
| テスト修正、mock、カバレッジ | `test` |
| 遅い、パフォーマンス | `performance` |

**注意**: `enhancement` は付与しない（/fix-plan の対象外。新機能は /issue-create を使用）。

## 注意事項

- リモート未設定・認証未完了の場合は中断
- 機密情報を Issue 本文に含めない
