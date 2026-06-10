---
name: code-review
description: 最大5つの専門サブエージェントを並列実行し、品質・セキュリティ・テスト・DB・不要コードを同時にレビューする。
---

# Code Review スキル

最大5つの専門サブエージェントを **並列実行** し、多角的なコードレビューを効率的に実行します。

## 大規模 diff の委譲フック（上乗せ・既定挙動は不変）

変更ファイルが `.claude/rules/workflow-orchestration.md` の**判定基準**を超える場合（閾値の定義はルール側に集約。Step 0 で計算する `git diff --name-only main...HEAD` の件数で判定）、または各指摘を**敵対的に検証**したい場合は、定義済み workflow への委譲を**推奨第1候補で提案**する（`AskUserQuestion`）。委譲には Workflow のオプトインが必要なため、ユーザー承認のうえ起動する。

| 用途 | 委譲先 | 起動 |
|------|--------|------|
| 大規模 diff の多次元レビュー＋指摘ごとの敵対的検証 | `review-changes` | `/orchestrate review-changes` |
| **「網羅的に監査して」級**（diff を loop-until-dry で掘り尽くす＋多視点パネル検証） | `exhaustive-review` | `/orchestrate exhaustive-review`（`{scope:"diff"}`） |
| **リポジトリ全体監査**（diff ではなく追跡ファイル全体／特定サブディレクトリを網羅監査） | `exhaustive-review` | `/orchestrate exhaustive-review`（`{scope:"all"}` または `{scope:"<path>"}`） |

> 全体監査は重い。段階導入として、まず `{scope:"<サブディレクトリ>"}` で試してから `{scope:"all"}` に広げることを推奨（`workflow-orchestration.md`「段階導入」）。`exhaustive-review` は `budget.total` ガード付きなので予算ディレクティブ（`+500k` 等）で深さを制御できる。

**判定基準未満なら従来どおり下記の最大5並列のまま**（軽量・低コスト）。

## 使い方

```
/code-review
```

## アーキテクチャ

```
/code-review
    │
    ├──────────┬──────────┬──────────┬──────────┐
    │          │          │          │          │
    ▼          ▼          ▼          ▼          ▼
 code-     security-  test-     database-  refactor-
 quality-  reviewer   verifier  reviewer   checker
 reviewer  (sonnet)   (haiku)   (haiku)    (haiku)
 (sonnet)                      ※条件付き
    │          │          │          │          │
    ▼          ▼          ▼          ▼          ▼
┌──────────────────────────────────────────────────┐
│              統合レビューレポート                   │
│                                                  │
│  品質:       PASS/FAIL                           │
│  セキュリティ: SECURE/VULNERABLE                   │
│  テスト:      PASS/FAIL                           │
│  DB:         PASS/FAIL/SKIP                      │
│  不要コード:  CLEAN/NEEDS_CLEANUP                  │
│  ──────────────────                              │
│  総合判定:    APPROVE / REQUEST_CHANGES            │
└──────────────────────────────────────────────────┘
```

## 並列実行の流れ

### Step 0: 変更ファイルリスト事前計算 + 早期スキップ

エージェント起動前に変更ファイルリストを取得し、全エージェントに渡す:

```bash
git diff --name-only main...HEAD
```

変更ファイルリストに DB 関連ファイル（`*.sql`, `migrations/`, ORM スキーマ, `supabase/` 等）が含まれない場合、database-reviewer を起動しない。

### Step 1: 最大5つのサブエージェントを同時起動

変更ファイルリストを引数として渡して起動。各エージェントは `git diff` を実行せず即座にレビューを開始する。

| # | エージェント | 観点 | モデル | 実行条件 |
|---|-------------|------|--------|---------|
| 1 | code-quality-reviewer | 品質・構造・命名・不変性 | sonnet | 常時 |
| 2 | security-reviewer | 脆弱性・シークレット・OWASP | sonnet | 常時 |
| 3 | test-verifier | テスト実行・カバレッジ | haiku | 常時 |
| 4 | database-reviewer | SQL・スキーマ・RLS | haiku | DB関連ファイルがある場合のみ |
| 5 | refactor-checker | 未使用コード・重複・デッドコード | haiku | 常時 |

### Step 2: 結果を統合

各エージェントは詳細レポート全文を直接返す（ファイル書き出しは行わない）。

統合レポートは各エージェントの要約を集約して表示:

```
═══════════════════════════════════════
  統合レビューレポート
═══════════════════════════════════════

## 品質 (code-quality-reviewer)
  判定: PASS / FAIL
  CRITICAL: N件, HIGH: N件, MEDIUM: N件

## セキュリティ (security-reviewer)
  判定: SECURE / VULNERABLE
  CRITICAL: N件, HIGH: N件

## テスト (test-verifier)
  判定: PASS / FAIL
  カバレッジ: XX%

## DB (database-reviewer)
  判定: PASS / FAIL / SKIP
  ※DB変更がない場合は SKIP

## 不要コード (refactor-checker)
  判定: CLEAN / NEEDS_CLEANUP
  HIGH: N件, MEDIUM: N件

───────────────────────────────────────
  総合判定: APPROVE / REQUEST_CHANGES
  詳細: 各エージェントの返却レポートを参照
═══════════════════════════════════════
```

### Step 3: 判定基準

| 判定 | 条件 |
|------|------|
| **APPROVE** | 全エージェント PASS（SKIP含む） |
| **REQUEST_CHANGES** | いずれかが FAIL / VULNERABLE |

## 問題発見時のアクション

| 重要度 | アクション |
|--------|-----------|
| CRITICAL | 即座に修正。コミットをブロック |
| HIGH | コミット前に修正推奨 |
| MEDIUM | 可能なら修正。次回対応も可 |
| NEEDS_CLEANUP | 警告のみ。コミットは可能 |

## 他のスキルとの連携

- `/issue-flow` → Phase 3 で自動的に呼び出される
- `/tdd` → 実装後のレビューとして使用
- `/e2e` → E2Eテスト結果と組み合わせ
