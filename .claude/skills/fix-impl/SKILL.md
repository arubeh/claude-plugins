---
name: fix-impl
description: fix系の open Issue を自動収集し、競合がなければ並列で実装して1つのPRにまとめる。引数不要。fix系以外のIssueは実行しない。
---

# Fix-Impl スキル

fix 系（bug / refactor / documentation / test / performance）の open Issue を自動収集し、
競合がなければ並列で実装して 1つの PR にまとめます。
引数は不要です。

## 大規模バッチの委譲フック（上乗せ・既定挙動は不変）

**このスキルは Workflow の才能（多数の独立サブタスクの大規模ファンアウト）が最も活きる入口。**
Step 1 で収集した fix Issue が `.claude/rules/workflow-orchestration.md` の**判定基準**（概ね **10 件以上の独立 Issue**／複数モジュール横断）を超える場合は、定義済み workflow **`fix-batch`** への委譲を**推奨第1候補で提案**する（`AskUserQuestion`）。承認後 `/orchestrate fix-batch` で起動し、収集 Issue を `{issues: [{number, title, files, body}], base}` として渡す（`files` は Step 3 の競合判定用に算出済みのもの）。`fix-batch` が競合グループ分割→各グループを独立 worktree で並列（グループ内は直列）実装し、**グループ専用ブランチ群（`branches`）と各 Issue の status を集約して返す**。本スキルはそれを受けて **(1) 返ってきたグループブランチをバッチブランチへ順次マージ（グループは互いに素なので基本クリーン・衝突時はユーザー提示）→ (2) Step 4（テスト）→ (3) Step 5（push + PR）** を担う。委譲には Workflow のオプトインが必要なため、ユーザー承認のうえ起動する。

これにより従来の「最大5件・6件以上は分割を推奨」という自前の頭打ち（Step 3）を超えて、収集した全 fix Issue を一括並列で処理できる。**判定基準未満なら従来どおり下記の最大5並列のまま**（軽量・低コスト）。判定は Step 1 の収集件数で自動的に行い、提案時は目的＋現在地を添える（`decision-presentation.md`）。

## 使い方

```
/fix-impl
```

引数なしで実行すると、fix 系の open Issue を自動収集して実装を開始します。

## 実行フロー

```
Step 1: fix 系 Issue の自動収集
    │
    ├─ gh issue list で fix 系ラベルの open Issue を全取得
    ├─ 0 件 → 「対象の Issue がありません」→ 終了
    └─ 各 Issue の要件・影響ファイルを整理
    │
    ▼ ユーザー確認「以下の N 件を修正します。よいですか？」
    │
Step 2: ブランチ作成
    │
    └─ git checkout -b fix/#42-#43-#44-batch-fixes
    │
Step 3: 競合判定 + worktree 分離並列実装
    │
    ├─ 影響ファイルの重複で union-find グルーピング（グループ間はファイル互いに素）
    ├─ 各グループを別 worktree + 専用ブランチで実装（グループ間は並列・グループ内は直列）
    └─ 完了後グループブランチをバッチブランチへ順次マージ → 1 PR
    │
Step 4: テスト検証
    │
    ├─ test-verifier エージェントを起動
    ├─ PASS → Step 5 へ
    └─ FAIL → エラー箇所を修正して再検証
    │
Step 5: PR 作成
    │
    ├─ 実装はグループブランチに commit 済→バッチブランチへマージ済
    ├─ git push → pr-creator エージェントで PR 作成
    └─ PR URL を表示
    │
    ▼ 完了
```

## Step 1: fix 系 Issue の自動収集

```bash
# fix 系ラベルの open Issue を取得
gh issue list --state open --label "bug"
gh issue list --state open --label "refactor"
gh issue list --state open --label "documentation"
gh issue list --state open --label "test"
gh issue list --state open --label "performance"
```

### ラベルによるフィルタ

| 判定 | ラベル |
|------|--------|
| 対象 | `bug`, `refactor`, `documentation`, `test`, `performance` |
| 対象外 | `enhancement`, `feature`, ラベルなし |

対象外の Issue は自動的に除外される（警告不要）。

### 0 件の場合

```
■ fix 系の open Issue がありません。
  /fix-plan で Issue を登録してから再度実行してください。
```

### ユーザー確認

```
■ 以下の 3 件を修正します。よいですか？

  #42 bug: VECTOR_DB_DIMENSION の不整合を修正
  #43 test: mock の次元数を実際のモデルに合わせる
  #44 refactor: 未使用 import の削除

  [実行する] / [キャンセル]
```

## Step 2: ブランチ作成

```bash
# Issue が複数の場合
git checkout -b fix/#42-#43-#44-batch-fixes

# Issue が1件の場合
git checkout -b fix/#42-dimension-mismatch
```

## Step 3: 競合判定 + worktree 分離並列実装

### 競合判定（union-find グルーピング）

影響ファイルを共有する Issue を同一グループにまとめる（union-find）。**グループ間はファイル互いに素**になる。

```
各 Issue の影響ファイル一覧を比較
  ├─ ファイルを共有する Issue 同士 → 同一グループ（グループ内は直列）
  └─ 共有しない → 別グループ（グループ間は並列）
      → 「#42 と #43 が src/config.py を共有するため同一グループ・直列実装します」
```

> **なぜ worktree 分離するか**: 影響ファイル集合の予測は**経験則で不正確になりうる**（共有 util・barrel/index・lockfile・生成物を予測外に触る）。予測が外れると共有作業ツリーで並列書き込みが静かに上書き/混線する。グループごとに worktree を分けると、予測外の衝突が静かな破損でなく**明示的なマージ衝突**として顕在化する。判定基準は `.claude/rules/workflow-orchestration.md`「並列の安全策」が単一ソース。

### worktree 分離並列実装

各グループを**独立した worktree + 専用ブランチ**で実装する（グループ間は並列・グループ内は直列）。worktree はハーネス（このスキル）が直接握るため、マージバックが容易:

```bash
# グループごと（n=0,1,...）。<batchbranch> は Step 2 で作成したブランチ
git worktree add .claude/worktrees/<batchbranch>-g<n> -b <batchbranch>-g<n> <batchbranch>
# その worktree 内でグループの Issue を直列に TDD 実装（Task エージェント）
```

```
Task(
  subagent_type: "general-purpose",
  prompt: "worktree <path> 内でグループの Issue を順に TDD 実装。files スコープ外は触るな。各 Issue を fix(#N): ... でコミット。push・PR は作らない。CLAUDE.md のコンテキスト: ..."
)
```

### マージバック（→ 1 PR）

各グループ完了後、グループブランチをバッチブランチへ順次マージする:

```bash
git checkout <batchbranch>
git merge --no-ff <batchbranch>-g<n>   # グループは互いに素なので基本クリーン
```

予測外の共有ファイル衝突でマージ衝突が出た場合は、静かな破損ではなく**解決可能な衝突**として顕在化するので、ユーザーに提示して解決する。マージ後、一時 worktree は `.claude/worktrees/` 規約（`git worktree unlock`→`--force` の2段防御）で掃除する。

### 制約

- **最大 5 グループ**まで同時実行（このスキル単体の並列上限＝並列レーン数）
- グループ数が多い（収集 Issue ≥10 件）→ **まず「大規模バッチの委譲フック」を発火**（`/orchestrate fix-batch` で全件一括並列を推奨第1候補で提案。`fix-batch` も各グループを worktree 分離する）。ユーザーが Workflow を使わない場合のみ「5 グループずつに分割して実行を推奨」と案内
- **同一ファイルを複数 Issue が変更する場合** → 同一グループ内で直列実装（同じ worktree で先の変更を反映してから次を実行）
- 各 Task エージェントは TDD で実装（RED → GREEN → REFACTOR）
- worktree は変更があれば残る。グループブランチのマージ・worktree 掃除はハーネス（このスキル）が行う

## Step 4: テスト検証

test-verifier エージェントを起動:

```
Task(
  subagent_type: "general-purpose",
  prompt: "テスト実行 + カバレッジ確認。CLAUDE.md の Tech Stack を参照してテストコマンドを特定。"
)
```

- **PASS** → Step 5 へ
- **FAIL** → エラー箇所を修正して再検証（最大 3 回リトライ）

## Step 5: PR 作成（push + PR）

実装は各グループブランチに commit 済みで、Step 3（委譲時は委譲フックのマージバック）でバッチブランチへマージ済みのため、ここでは push と PR 作成のみ（個別の `git add`/`commit` は不要）:

```bash
# バッチブランチ（実装マージ済み）をプッシュ
git push -u origin fix/#42-#43-#44-batch-fixes
```

PR 作成（pr-creator エージェント）:

```bash
gh pr create --title "fix(#42,#43,#44): バッチ修正" --body "$(cat <<'EOF'
## Summary
- #42 VECTOR_DB_DIMENSION の不整合を修正
- #43 mock の次元数を実際のモデルに合わせる
- #44 未使用 import の削除

## Test plan
- [ ] 全テストが PASS すること
- [ ] 各 Issue の受け入れ条件を満たすこと

Closes #42
Closes #43
Closes #44
EOF
)"
```

完了メッセージ:

```
■ PR を作成しました
  https://github.com/owner/repo/pull/50

  修正 Issue:
    ✓ #42 VECTOR_DB_DIMENSION の不整合を修正
    ✓ #43 mock の次元数を実際のモデルに合わせる
    ✓ #44 未使用 import の削除
```

## 他のスキルとの連携

- `/fix-plan` → バグ調査 + Issue 作成
- `/fix-impl` → fix 系 Issue を自動収集して実装 + PR 作成（このスキル）
- `/issue-create` → 新機能の Issue 作成
- `/issue-flow #N` → 新機能の Issue 実装 + PR 作成
