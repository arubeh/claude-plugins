---
name: fix-impl
description: fix系の open Issue を自動収集し、競合がなければ並列で実装して1つのPRにまとめる。引数不要。fix系以外のIssueは実行しない。Use when user wants to implement all open fix issues (e.g. /fix-impl).
---

# Fix-Impl スキル

fix 系（bug / refactor / documentation / test / performance）の open Issue を自動収集し、競合がなければ並列で実装して 1つの PR にまとめる。引数不要。

## 使い方

```
/fix-impl
```

## 実行フロー

1. **fix 系 Issue の自動収集** — `gh issue list` で bug/refactor/documentation/test/performance ラベルの open Issue を全取得。0 件なら終了。ユーザー確認
2. **ブランチ作成** — `fix/#42-#43-#44-batch-fixes`（1件なら `fix/#42-description`）
3. **競合判定 + 実装** — 影響ファイルの重複チェック。重複なしなら並列実装（最大 5 件）、重複ありなら該当グループを直列実装。各エージェントは TDD で実装
4. **テスト検証** — test-verifier で実行。FAIL なら修正→再検証
5. **コミット + PR 作成** — `git add` + `git commit` + `gh pr create`。PR 本文に全 Issue を列挙（Closes #N）

## 対象ラベル

対象: bug, refactor, documentation, test, performance
対象外: enhancement, feature, ラベルなし（自動的に除外）

## 注意事項

- 最大 5 Issue まで同時実行。6件以上は「5件ずつに分割」を推奨
- 同一ファイルを複数 Issue が変更する場合は直列実行に切り替え
