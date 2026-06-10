# Cursor 用設定（.claude 対応版）

このディレクトリは、`.claude` のルール・スキル・サブエージェントを Cursor 向けに変換したものです。

## 構成

| パス | 内容 |
|------|------|
| `.cursor/rules/` | ルール（.mdc）。コーディングスタイル・DB・ドキュメント・Git・進捗・セキュリティ・UI設計 |
| `.cursor/skills/` | スキル（SKILL.md）。issue-create, issue-flow, plan, tdd, code-review, build-fix, e2e |
| `.cursor/agents/` | **サブエージェント**（Cursor ネイティブ）。10体。自動委任・並列実行可能 |
| `.cursor/AGENTS.md` | ロール参照（スキル実行時の振る舞い・出力形式の補足） |
| `.cursor/reviews/` | （未使用。レビュー結果はエージェントが直接返却） |

### サブエージェント（.cursor/agents/）

[Cursor のサブエージェント](https://cursor.com/ja/docs/context/subagents)として登録済み。Agent がタスクに応じて自動委任したり、並列実行の指示で複数同時起動できます。

| サブエージェント | 役割 | 主な使用場面 |
|-----------------|------|--------------|
| `issue-analyzer` | Issue 取得・分析・要件抽出・ブランチ名生成 | issue-flow Phase 1 (3並列) |
| `tech-selector` | 技術的決定ポイント特定・選択肢提案 | issue-create（既存PJ） |
| `architect-reviewer` | アーキテクチャ適合性レビュー | issue-flow Phase 1 (planner後) |
| `code-quality-reviewer` | 品質・構造・命名・イミュータビリティ | code-review / issue-flow Phase 3 |
| `security-reviewer` | 脆弱性・シークレット・OWASP | code-review / issue-flow Phase 3 |
| `test-verifier` | テスト実行・カバレッジ 80% 検証 | code-review / issue-flow Phase 3 |
| `database-reviewer` | SQL・マイグレーション・RLS（DB 変更時のみ） | code-review / issue-flow Phase 3 |
| `refactor-checker` | 不要コード・重複検出 | code-review / issue-flow Phase 3 |
| `doc-updater` | README・API docs・.env.example 更新 | issue-flow Phase 4 |
| `pr-creator` | push・PR 作成・Closes #N | issue-flow Phase 4 |

**明示的な呼び出し例:** `/code-quality-reviewer この PR をレビューして`、`/security-reviewer 決済モジュールをレビューして`
**並列実行例:** 「API 変更をレビューし、ドキュメントを並列で更新して」

※ サブエージェント利用には [Max Mode](https://cursor.com/ja/docs/context/max-mode) 有効（従来プラン）または従量課金プランが必要です。

## 使い方

- **Issue から開発**: `/issue-flow #N` または「issue-flow #42 で進めて」→ 分析+計画 → TDD → レビュー → デリバリー
- **Issue 新規作成**: `/issue-create 検索にページネーション追加` など
- **計画だけ**: `/plan` または「実装計画を立てて」
- **TDD だけ**: `/tdd` または「TDD で実装して」
- **レビューだけ**: `/code-review` または「コードレビューして」
- **ビルド修正**: `/build-fix` または「ビルドエラーを直して」
- **E2E**: `/e2e` または「E2E テストを実行して」

## 詳細フロー・トラブルシューティング

フロー図・確認ポイント・再開方法・スキル一覧は **`.claude/README.md`** を参照してください。

## 前提条件

- `gh auth status` で GitHub CLI 認証済み
- プロジェクトで `npm test` / `npm run build` 等が実行可能
