---
name: issue-flow
description: GitHub Issueを起点に、分析+計画→TDD実装→レビュー→デリバリーの4フェーズで開発。サブエージェント並列実行とコンパクトなチェックポイントで高速完了。セッション切れ後も続きから再開可能。Use when user says /issue-flow #N or wants to run full flow from an issue.
---

# Issue Flow スキル

GitHub Issue を起点に、サブエージェントの並列実行を最大活用した **4フェーズ** 開発フローを実行する。各 Phase 完了時に Issue へコンパクトなチェックポイントを追記し、セッション中断時も再開可能。

## 使い方

**単一 Issue（従来通り・worktree なし）**:

```
/issue-flow #123
/issue-flow 123
/issue-flow                         # Issue一覧から選択
```

**複数 Issue 並列（worktree 使用）**:

```
/issue-flow #41 #42 #43             # 明示指定
/issue-flow --all-open              # open Issue 全部
/issue-flow --parallel=3 #41 #42 #43 #44 #45  # 並列度を絞る
```

複数 Issue 指定時は各 Issue が独立した git worktree で並列実行される。詳細は「複数 Issue 並列モード」セクション参照。

**Phase 3 オプション**:

```
/issue-flow --auto-fix #N      # error 級指摘を 1-shot 自動修正試行 (オプトイン・suggest/apply 分離)
/issue-flow --re-review #N     # auto-fix 後の修正版に reviewer を再走 (明示時のみ)
```

## ワークフロー全体

```
Phase 0: 再開検出 ─── コメント数 0 → スキップ（即 Phase 1 へ）
                     チェックポイント発見 → 再開確認 → 完了済みスキップ
                     なし → Phase 1 から開始

Phase 1: 分析+計画 ── ★3並列★
                     [並列] issue-analyzer 相当 + コードベース調査 + planner 相当
                     → 3並列完了後 → architect-reviewer 相当（条件付き・既定スキップ）
                     → 統合結果を提示 → ユーザー確認①（分析+計画を一括承認）
                     → チェックポイント追記

Phase 2: 実装 ─────── ★レベル並列★
                     git checkout -b <type>/#<N>-<slug>
                     → 実行戦略判定（依存グラフ有無）
                     → Level 単位で TDD 並列実行
                     → レベル完了ごとにチェックポイント追記

Phase 3: レビュー ─── 変更ファイルリスト事前取得 → DB reviewer スキップ判定
                     → [並列] 最大5観点（品質・セキュリティ・テスト・DB・不要コード）
                     変更ファイルリストを全エージェントに渡して起動（git diff 省略）
                     各エージェントは詳細レポート全文を直接返す
                     → ユーザー確認②「コミット・PR作成してよいか？」
                     → チェックポイント追記

Phase 4: デリバリー ── doc-updater 相当 → git commit → pr-creator 相当
                     → 最終チェックポイント追記（PR URL 含む）→ 完了レポート
```

上図は **単一 Issue モード**。複数 Issue 指定時は次節の worktree 並列モードで動作する。

## 複数 Issue 並列モード（worktree 使用）

`/issue-flow #41 #42 #43` 等の複数 Issue 指定で、各 Issue を独立した git worktree 内で並列実行する。単一 Issue は従来通り cwd で実行。

### モード切替

| 起動形式 | モード |
|---------|--------|
| `/issue-flow #41` | 単一モード（worktree なし） |
| `/issue-flow #41 #42 #43` | 並列モード（各 Issue が worktree） |
| `/issue-flow --all-open` | 並列モード（open Issue 全部） |
| `/issue-flow --parallel=N #41 ...` | 並列モード（並列度 N に制限） |

### 実行フロー

```
Step A: ブランチ名確定 → git worktree add .cursor/worktrees/<branch> -b <branch> main（並列度ゲート 既定5）
Step B: 各 worktree で Phase 1 並列 → バッチ UI で承認/却下
Step C: 承認済み Issue のみ Phase 2 並列（各 worktree で tdd-guide）
Step D: Phase 3 並列 → バッチ提示 → 承認
Step E: Phase 4 並列（doc-updater → commit → pr-creator）
Step F: PR を最大 5 分 polling (30s × 10) → MERGED なら git worktree unlock (locked時) → remove --force → branch -D。timeout/失敗は残す → PR URL 一覧出力
```

### worktree 管理

- 配置: リポ内 `<runtime>/worktrees/`。issue-flow 並列モードは `<runtime>/worktrees/<branch-name>/` (ブランチ名は `<type>/#<issue>-<slug>`)、Agent isolation は `<runtime>/worktrees/agent-<id>/` (auto-prefix)。Cursor 利用時は `.cursor/worktrees/`、Claude Code 利用時は `.claude/worktrees/`。**両系統とも同じ親 dir 配下** で Phase 0 が一括掃除する
- `.cursor/worktrees/.gitignore` に `*` (および `!.gitignore`) を置いて配下を全て ignore する運用 (skeleton 自体は repo に残す)。未配置なら警告
- 削除タイミング = **PR マージ後** (PR 作成のみでは削除しない)。Phase 4 末尾の polling と Phase 0 起動時掃除の 2 段防御で回収する
  - Phase 4: PR 作成後 `gh pr view <N> --json state -q .state` を 30s × 10 polling、`MERGED` で locked であれば `git worktree unlock` 後に `git worktree remove --force` + `git branch -D <branch>`。timeout は残す
  - Phase 0 (毎起動時): `git worktree list --porcelain` 列挙 → `gh pr list --head <branch> --state merged` で MERGED PR があれば unlock + remove --force + branch -D (前回 timeout / 手動マージ / 他スキル生成 `agent-*` の後始末)
- 再開: Phase 0 再開検出で worktree 残存時は再利用、なければ再作成

### 並列度

既定 5 Issue 同時。`--parallel=N` で 1〜10 の範囲で上書き可能。

### ビルドキャッシュ共有（強く推奨）

worktree 毎にフルビルドが走ると並列化の効果が激減するため共有推奨:

- Rust: `CARGO_TARGET_DIR=<親リポ>/target` を統一
- Node (pnpm): 自動共有。npm/yarn は親の `node_modules` を symlink か pnpm 移行推奨
- Python (uv): global cache で自動共有。poetry/pip は親の `.venv` を共有

未設定検出時は警告してユーザー判断に委ねる。

### バッチ UI（Phase 1 / 3 のユーザー確認）

全 Issue の結果を 1 枚に集約し、`[a] 全承認 [s] 承認済のみ進行 [1] 個別選択 [q] 中止` で一括判断。単一モードは従来通り個別確認。

```
■ Phase 1 結果サマリ（5 Issue）
  #41 ✓ PASS   UndoStack         / 5 ステップ, 3 レベル
  #42 ✓ PASS   Spring animation  / 4 ステップ
  #43 ⚠ 指摘   InterpolatedColor / architect 指摘 1 件
  #44 ✓ PASS   decompile         / 7 ステップ, 4 レベル
  #45 ✗ FAIL   asset_manage      / 依存グラフ矛盾
```

### 失敗時の独立性

ある Issue が落ちても他は続行。失敗 Issue の worktree は残存し、ユーザーが個別再開できる（`/issue-flow #<N>` 単一モードで Phase 0 が worktree を検出して復旧）。チェックポイントは各 Issue の GitHub コメントに独立して書かれるため競合なし。

## チェックポイント形式（コンパクト）

全 Phase 統一のコンパクト形式。HTML コメントにメタデータ、本文は4行以内:

```
<!-- CLAUDE_PROGRESS phase=N status=STATUS branch=BRANCH -->
completed: 1 | current: 2 | next: Phase 2 実装
files: src/types.ts, src/config.ts
context: offset/limit方式, Server Component
```

Phase 2 のみレベル進捗を追加: `levels: L0✓ L1✓ L2… L3`
追記は `gh issue comment <number> --body "..."` で実行。追記のみ（編集・削除しない）。

**依存グラフの永続化（再開用）**: Phase 1 完了時、上記コンパクト形式とは**別コメント**で依存グラフのスナップショットを `<!-- CLAUDE_PLAN -->` マーカー＋ `<details>` で追記する（`CLAUDE_PROGRESS` の4行制約は別マーカーなので不変）。再開時に planner を作り直さず Phase 1 を完全スキップするために使う。

```
<!-- CLAUDE_PLAN branch=<branch> -->
<details><summary>Phase 1 実装計画（依存グラフ）— 再開用</summary>

Level 0: [S0 setup] files: ... / Level 1: [S1, S2] files: ... / Level 2: [S3] / Level 3: [S4]
API 仕様: <要約 or docs/api-design.md 参照>
</details>
```

## ユーザー介入ポイント

| Phase | タイミング | 典型的な回答 |
|-------|-----------|-------------|
| 0 | 再開検出後 | 「続きから」 |
| 1 | 分析+計画後 | 「OK」「OK、ただし〇〇も追加して」 |
| 3 | レビュー後 | 「コミットして」 |

## Phase 0: マージ済み worktree 自動掃除 + 早期スキップ

### Step 0-A: マージ済み worktree 掃除 (毎起動時、無条件)

`/issue-flow` を起動するたびに最初に実行。前回の polling timeout 分、手動マージ分、および **他スキル / Agent isolation (`.cursor/worktrees/agent-*`) 経由で生成された worktree** も回収する。

**重要 — locked 対応**: ランタイムは agent isolation worktree を `git worktree lock` するため、`git worktree remove --force` だけでは貫通できない。`git worktree unlock` を先に呼ぶ 2 段構え必須。

```bash
git worktree list --porcelain | awk '
  BEGIN { RS=""; FS="\n" }
  {
    path=""; branch=""; locked=0
    for (i=1; i<=NF; i++) {
      if ($i ~ /^worktree /)              { path = substr($i, 10) }
      else if ($i ~ /^branch refs\/heads\//) { branch = substr($i, 19) }
      else if ($i ~ /^locked/)            { locked = 1 }
    }
    if (path && branch) print path "\t" branch "\t" locked
  }
' | while IFS=$'\t' read -r path branch locked; do
  case "$path" in
    *.cursor/worktrees/*|*.claude/worktrees/*) ;;
    *) continue ;;
  esac
  if gh pr list --head "$branch" --state merged --json number -q '.[0].number' 2>/dev/null | grep -q .; then
    [ "$locked" = "1" ] && git worktree unlock "$path" 2>/dev/null
    if git worktree remove --force "$path" 2>/dev/null; then
      echo "cleaned: $path (merged: $branch)"
      git branch -D "$branch" 2>/dev/null || true
    fi
  fi
done
```

掃除結果は冒頭で 1 行報告。0 件なら無報告。

**スコープ**: `<runtime>/worktrees/<branch-name>/` (issue-flow 並列モードが作成) と `<runtime>/worktrees/agent-<id>/` (Agent isolation が作成、ランタイム自動命名) の **両方**。後者は他スキル経由で残存しがちなので本スキルが集約掃除する。

### Step 0-B: 早期スキップ + 再開検出

`gh issue view <number> --json comments -q '.comments | length'` でコメント数を確認。0件なら Phase 1 へ即スキップ。コメントがあれば最新の `<!-- CLAUDE_PROGRESS -->` を解析し完了済み Phase をスキップ。

`phase=1 COMPLETED` 以降を再開する場合は `<!-- CLAUDE_PLAN -->`（永続化した依存グラフ）も読む。あれば依存グラフを復元して **Phase 1 を完全スキップ**、なければ planner のみ再実行。

## Phase 1: 分析+計画（3並列 → 1順次）

**Step 1-0: Issue 充実度判定（軽量化トリガー）** — Issue 本文を見てフル実行か縮約か決める。`issue-create` が生成した充実 Issue（受け入れ条件チェックリスト `- [ ]` / 技術方針・技術メモ / `Issue #N に依存` 参照のいずれかあり）では要件分析が重複する。

- issue-analyzer 相当: 充実時は**縮約**（ブランチ名生成＋本文整合確認のみ、要件再構造化を省く） / 非充実時はフル
- コードベース調査: **常にフル**（省略不可）— Issue は作成時点のスナップショットで、実装着手時にはコードが変わっている可能性がある（時点差）
- planner 相当: **常にフル**（省略不可）— 依存グラフ（`step_id`/`depends_on`/`files`/`type`）は Phase 2 のレベル並列を駆動する機械可読入力で、Issue 本文の散文からは作れない。充実時は Issue 本文を渡して再導出を抑制

Step 1-3 のユーザー提示に `Phase 1: フル / 縮約（<理由>）` を 1 行明記する。

**Step 1-1: 3並列起動**
- issue-analyzer 相当: Issue分析・要件構造化・ブランチ名生成
- コードベース調査: 構造・関連ファイル調査
- planner 相当: 実装計画+依存グラフ出力

3つとも Issue を直接読めるため、互いの結果を待つ必要がない。

**Step 1-2: architect-reviewer 相当（条件付き・既定スキップ）** — クリティカルパス上で 2分以上かかるため、**既定はスキップ**。以下のトリガーに1つ以上該当する場合のみ起動する:

- API エンドポイントの新規追加/変更（planner 出力に「API 仕様」セクションあり）
- DB スキーマ変更（変更対象に `migrations/`, `*.sql`, ORM スキーマ, `supabase/` を含む）
- 新規モジュール/クレート/パッケージ追加（新規 `Cargo.toml`/`package.json`/新ディレクトリ）
- 複数レイヤー横断変更（UI・API・DB のうち 2 層以上に跨る）
- planner が `architectural_risk: true` を明示

いずれにも該当しない場合はスキップ（単一ファイル・単一レイヤーの変更、UI 文言調整、設定値変更など）。スキップ時はユーザー提示に `アーキテクチャ: SKIP（<理由>）` と明記する。

**Step 1-3: 統合提示** — 分析+計画+アーキテクチャ評価を **1回のユーザー確認** で承認。

### 依存グラフ出力要件

planner 相当の計画策定時に、各ステップに依存グラフ情報を付与（`/plan` スキル参照）:
- `step_id`, `title`, `depends_on`, `files`, `type`

**API 仕様出力要件:** API エンドポイントの作成・変更を含む場合、planner は依存グラフに加えて API 仕様も出力する（`/plan` スキルの「API 仕様」セクション参照）。architect-reviewer は API 契約の一貫性もレビューする。

**構造リスク申告:** planner が構造的リスク（既存の責務分界に影響、新規抽象層の導入、等）を判断した場合は、出力先頭に `architectural_risk: true` と理由を明示。親エージェントはこのフラグを Step 1-2 のトリガー判定に使う。

**フォールバック:** 依存グラフがない場合、Phase 2 は従来の逐次実行モードで動作。

## Phase 2: 実装（レベル別並列実行）

**単一モード**: cwd で `git fetch origin main` → `git checkout main && git pull` → `git checkout -b <type>/#<N>-<slug>` でブランチを切る。
**並列モード**: cwd が worktree（`git worktree add` 済み）なのでブランチ操作は不要。

### 実行戦略判定

| 条件 | 戦略 |
|------|------|
| 依存グラフあり + 並列可能 | **並列実行モード** |
| 依存グラフあり + 全直列 | **順次実行モード** |
| 依存グラフなし | **フォールバック（従来モード）** |

### トポロジカルソート & レベル分け

`depends_on` が空 → Level 0。全依存先が Level N 以下 → Level N+1。

### ファイル競合チェック

同一レベル内でファイル重複を検出。重複するステップは直列化グループにまとめる。

### レベル単位の並列実行

Level N の全タスク完了を待ってから Level N+1 を開始。各タスクは TDD シングルステップモードで実行。

### エラーハンドリング

| 状況 | 対応 |
|------|------|
| 1タスク失敗 | 同レベルの他タスクは続行。リトライ最大2回 |
| リトライ失敗 | ユーザー報告、後続中断 |
| ビルドエラー | build-fix 相当で修正後リトライ |

### フォールバック

依存グラフなし → TDD で全ステップを逐次実行。

## Phase 3: レビュー（最大5並列）

変更ファイルリストを事前取得し全エージェントに渡す。DB 関連ファイルなし → database-reviewer 起動しない。詳細は .cursor/AGENTS.md および /code-review スキル参照。各エージェントは詳細レポート全文を直接返し、**末尾に `findings` ブロック (SARIF サブセット JSON) を必ず付与する**。

### 指摘の構造化ブロック (SARIF サブセット)

各 reviewer はレポート末尾に以下のフェンス付きブロックを 1 個出力する:

````
```findings
{
  "tool": "<reviewer-name>",
  "result": "PASS|FAIL|SKIP|SECURE|VULNERABLE|CLEAN|NEEDS_CLEANUP",
  "findings": [
    {
      "ruleId": "<short-stable-id>",
      "level": "error|warning|note",
      "locations": [{"file": "<path>", "startLine": <int>, "endLine": <int>}],
      "message": "<指摘内容を 1-2 行>",
      "suggested_patch": "<該当時のみ。unified diff>"
    }
  ]
}
```
````

severity 対応: CRITICAL/VULNERABLE → `error` (auto-fix 候補), HIGH/NEEDS_CLEANUP → `warning` (提示のみ), MEDIUM → `note` (提示のみ)。`ruleId` は `security/sql-injection` のような短く安定したキー (再レビュー時の dedupe 用)。

### 判定とユーザー提示

全 PASS/SECURE/CLEAN → Phase 4 へ。FAIL/VULNERABLE があれば findings を severity 順 (`error`→`warning`→`note`) で集約提示し、ユーザーに `[m] 手動 / [a] error のみ --auto-fix 試行 / [i] 一部無視 / [s] 別 Issue 化` を選ばせる。

### `--auto-fix` (オプトイン・1-shot・suggest/apply 分離)

AI reviewer の指摘には客観 oracle がない (build error と異なる category) ため自動ループは禁止。`--auto-fix` は明示オプトインの **1 回限り**。

起動条件: ユーザーが `[a]` 選択 or `--auto-fix` 起動 ∧ `level=error` のみ ∧ `suggested_patch` あり。

フロー: (1) tdd-guide を fix モード (RED/GREEN スキップ、既存テスト green 維持) で起動 → (2) build/lint/test で post-fix 検証 (失敗時は patch 破棄) → (3) `git diff --staged` を提示 `[y]/[n]/[e]` → (4) 承認時のみステージング維持。

制約:
- **再レビューはユーザー指示時のみ** (`--re-review`)。auto-fix 後に reviewer 自動再走しない (修正版への hallucinated 指摘でユーザー戻し品質が下がるため)
- **2 回目の auto-fix は禁止**。1 回失敗で必ずユーザーへ
- 対象 reviewer: code-quality / security / refactor-checker のみ。test-verifier FAIL は通常 tdd-guide へ、database-reviewer FAIL は対象外

## Phase 4: デリバリー（doc + commit + PR）

1. doc-updater 相当でドキュメント更新
2. `git commit -m "<type>(#<issue>): <説明>"`
3. pr-creator 相当でプッシュ + PR 作成（`Closes #<issue>`）

## サブエージェント起動コンテキスト

サブエージェントは親の会話履歴を引き継がない。起動時に必要なデータを明示的に渡すこと。

### Phase 1: 分析+計画

| エージェント | 渡すデータ |
|-------------|-----------|
| issue-analyzer 相当 | Issue 番号 |
| コードベース調査 | Issue 要件サマリー（1-2行）、調査すべき観点（関連ファイル・ディレクトリ構造・既存パターン） |
| planner 相当 | Issue 番号、Issue 本文全文 |
| architect-reviewer 相当 | planner の計画全文（依存グラフ含む）、API 仕様（該当時）、変更対象ファイルリスト |

### Phase 2: 実装

| エージェント | 渡すデータ |
|-------------|-----------|
| TDD 実行 | 該当ステップの `step_id`, `title`, `files`、実装すべき内容の説明、ブランチ名 |
| ビルドエラー修正 | エラーメッセージ全文、該当ファイルパス |

### Phase 3: レビュー

| エージェント | 渡すデータ |
|-------------|-----------|
| 全レビュー観点共通 | 変更ファイルリスト（`git diff --name-only main...HEAD` の結果）、ブランチ名、**末尾に `findings` ブロック (SARIF サブセット) を付与する出力契約** |
| database 観点 | 上記に加えて、DB 関連の変更ファイルリスト |
| TDD (auto-fix モード) | 対象 findings 配列、変更対象ファイルリスト、ブランチ名、「fix モード: RED/GREEN スキップ、既存テストを green に保つこと」の指示 |

### Phase 4: デリバリー

| エージェント | 渡すデータ |
|-------------|-----------|
| doc-updater 相当 | 変更ファイルリスト、Issue 番号、ブランチ名 |
| pr-creator 相当 | Issue 番号、ブランチ名、コミットメッセージ、レビュー結果サマリー |

## 注意事項

- `gh auth status` で認証済みであること
- チェックポイントは追記のみ。機密情報を含めない
- `git push --force` は使わない
- レビュー詳細は各エージェントの返却レポートを参照
- サブエージェント並列実行は最大10タスク

### 並列モード限定

- `.cursor/worktrees/.gitignore`（Claude 利用時は `.claude/worktrees/.gitignore`）に `*` が置かれていることを起動時に確認。未配置なら警告
- ビルドキャッシュ共有設定を事前に（Rust の `CARGO_TARGET_DIR` 等）。未設定だと並列効果が激減
- 既定並列度 5、`--parallel=N` で 1〜10 の範囲で上書き
- 1 Issue の失敗は他 Issue に波及しない。失敗 Issue の worktree は残す
- worktree クリーンアップは **2 段防御**: (1) Phase 4 で最大 5 分 polling し MERGED 検出時に削除 (2) 次回起動時 Phase 0 で `gh pr list --head <branch> --state merged` を再チェック。手動マージや timeout 分も回収される。残存時は手動 `git worktree remove --force <path>`
