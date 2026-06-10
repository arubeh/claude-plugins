# Cursor 仕様準拠チェック

[Rules](https://cursor.com/ja/docs/context/rules) と [Agent Skills](https://cursor.com/ja/docs/context/skills) に基づく確認結果（最終確認日: 2025-01-31）。

---

## ルール（.cursor/rules/）

| 項目 | 仕様 | 現状 | 判定 |
|------|------|------|------|
| 配置 | `.cursor/rules` に .md / .mdc | `.cursor/rules/` に 6 件の .mdc | ✅ |
| フロントマター | description, globs, alwaysApply | 全ファイルに description、必要に応じて globs / alwaysApply | ✅ |
| Rule Type | Always Apply / Apply Intelligently / Apply to Specific Files / Apply Manually | alwaysApply: true（4件）、globs + alwaysApply: false（2件） | ✅ |
| 行数 | 500 行以内推奨 | 最大 51 行（progress-tracking.mdc） | ✅ |
| globs 複数指定 | カンマ区切り、**カンマ後にスペースなし** | database.mdc, ui-design.mdc ともスペースなし | ✅ |

### ルール一覧

| ファイル | description | alwaysApply | globs |
|----------|-------------|-------------|--------|
| coding-style.mdc | コーディングスタイル | true | — |
| database.mdc | データベース・マイグレーション | false | db/**/*, prisma/**/*, ... |
| git-workflow.mdc | Git/GitHub ワークフロー | true | — |
| progress-tracking.mdc | 進捗追記・セッション復旧 | true | — |
| security.mdc | セキュリティガイドライン | true | — |
| ui-design.mdc | 画面構成・遷移設計 | false | src/**/*.tsx, ... |

---

## スキル（.cursor/skills/）

| 項目 | 仕様 | 現状 | 判定 |
|------|------|------|------|
| 配置 | 各スキルは **フォルダ**、その中に SKILL.md | 7 スキルとも `skill-name/SKILL.md` | ✅ |
| name | 必須、**親フォルダ名と一致** | build-fix, code-review, e2e, issue-create, issue-flow, plan, tdd すべて一致 | ✅ |
| description | 必須 | 全 SKILL.md に記載 | ✅ |
| オプション | license, compatibility, metadata, disable-model-invocation | 未使用（必要に応じて追加可） | ✅ |

### スキル一覧

| フォルダ | name（SKILL.md） | 一致 |
|----------|------------------|------|
| build-fix/ | build-fix | ✅ |
| code-review/ | code-review | ✅ |
| e2e/ | e2e | ✅ |
| issue-create/ | issue-create | ✅ |
| issue-flow/ | issue-flow | ✅ |
| plan/ | plan | ✅ |
| tdd/ | tdd | ✅ |

---

## AGENTS.md

- 仕様: プロジェクトルートまたはサブディレクトリに配置可能。エージェント向けのシンプルな指示用。
- 現状: `.cursor/AGENTS.md` にサブエージェント（ロール）の参照を記載。ルートの AGENTS.md は未配置。
- 補足: プロジェクト全体の「コードスタイル・アーキテクチャ」指示をルートに置く場合は、プロジェクトルートに `AGENTS.md` を追加可能。その場合も `.cursor/AGENTS.md` はサブエージェント参照として併用可能。

---

## サブエージェント（.cursor/agents/）

- [Subagents](https://cursor.com/ja/docs/context/subagents) 仕様に従い、YAML フロントマター（name, description, model, readonly）＋ 本文で 9 体を定義済み。
- 自動委任・明示的呼び出し（/name）・並列実行の対象として利用可能。

---

## まとめ

- **ルール**: [Rules](https://cursor.com/ja/docs/context/rules) のプロジェクトルール仕様に準拠。
- **スキル**: [Agent Skills](https://cursor.com/ja/docs/context/skills) のディレクトリ構成・SKILL.md の name/description に準拠。
- 修正不要と判断したため、設定の変更は行っていません。
