---
name: code-review
description: 最大5つの専門観点（品質・セキュリティ・テスト・DB・不要コード）を並列でレビューする。Use when reviewing PR, code changes, or user asks for /code-review.
---

# Code Review スキル

品質・セキュリティ・テスト・DB・不要コードの5観点を **並列** でレビューする。

## 使い方

```
/code-review
```

## 並列実行の流れ

### Step 0: 変更ファイルリスト事前計算 + 早期スキップ

エージェント起動前に `git diff --name-only main...HEAD` で変更ファイルリストを取得し、全エージェントに渡す。DB 関連ファイルがなければ database を起動しない。

### Step 1: 最大5観点を同時に実施

変更ファイルリストを引数として渡して起動。各エージェントは git diff を実行せず即座にレビュー開始。

| # | 観点 | 内容 | 条件 |
|---|------|------|------|
| 1 | code-quality | 品質・構造・命名・不変性 | 常時 |
| 2 | security | 脆弱性・シークレット・OWASP | 常時 |
| 3 | test-verifier | テスト実行・カバレッジ 80% | 常時 |
| 4 | database | SQL・スキーマ・RLS・マイグレーション | DB関連ファイルがある場合のみ |
| 5 | refactor | 未使用コード・重複・デッドコード | 常時 |

各観点の詳細は `.cursor/AGENTS.md` の該当ロールに従う。

### Step 2: 結果の出力

各エージェントは詳細レポート全文を直接返す（ファイル書き出しは行わない）。

統合レポートは各観点の要約（PASS/FAIL/SECURE/VULNERABLE 等）を集約して表示。

### Step 3: 判定

- **APPROVE**: 全観点 PASS（DB変更なしの場合は SKIP 可）
- **REQUEST_CHANGES**: いずれか FAIL / VULNERABLE

## 連携

- `/issue-flow` Phase 3 で自動実行
- `/tdd` 実装後のレビュー
- `/e2e` と組み合わせ可能
