---
name: issue-flow
description: GitHub Issueを起点に、分析+計画 → TDD実装 → レビュー → デリバリーの4フェーズで開発。サブエージェント並列実行とコンパクトなチェックポイントで高速に完了する。セッション中断時はIssueコメントから再開可能。
---

# Issue Flow スキル

GitHub Issue を起点として、サブエージェントの並列実行を最大活用した **4フェーズ** 開発フローを実行します。
各 Phase 完了時に Issue へコンパクトなチェックポイントを追記し、セッション中断時も再開可能です。

> **参照ファイル（必要なフェーズで読む）**:
> - 複数 Issue を並列実行する場合 → [`reference/parallel-worktree.md`](reference/parallel-worktree.md)（worktree モードの全詳細）
> - Phase 3 の reviewer 出力契約・判定 UI・`--auto-fix` の詳細 → [`reference/phase3-review-detail.md`](reference/phase3-review-detail.md)

## 使い方

### 単一 Issue（従来通り・worktree なし）

```
/issue-flow #123
/issue-flow 123
/issue-flow                         # Issue一覧から選択
```

### 複数 Issue 並列（worktree 使用）

```
/issue-flow #41 #42 #43             # 明示指定
/issue-flow --all-open              # open Issue 全部
/issue-flow --parallel=3 #41 #42 #43 #44 #45  # 並列度を絞る
```

複数 Issue を指定すると各 Issue が独立した git worktree で並列実行される。**詳細・実行フロー・worktree 管理・キャッシュ共有・バッチ UI は [`reference/parallel-worktree.md`](reference/parallel-worktree.md) を参照**（並列モードを実際に使うときに読む）。

### Phase 3 オプション

```
/issue-flow --auto-fix #N      # Phase 3 で error 級指摘を 1-shot 自動修正試行 (suggest/apply 分離・オプトイン)
/issue-flow --re-review #N     # auto-fix 後の修正版に対し reviewer を再走させる (明示時のみ)
```

`--auto-fix` の詳細仕様は [`reference/phase3-review-detail.md`](reference/phase3-review-detail.md) 参照。

## ワークフロー全体像

```
Phase 0: 再開検出 ──────────────────────────
  │
  ├─ コメント数 0 → スキップ（即 Phase 1 へ）
  ├─ チェックポイント発見 → 再開確認 → 完了済みスキップ
  └─ なし → Phase 1 から開始
  │
Phase 1: 分析+計画 ──────────── ★3並列★ ──
  │
  ├─ [並列] issue-analyzer       → Issue分析・ブランチ名生成
  ├─ [並列] Explore agent        → コードベース調査
  └─ [並列] planner              → 実装計画+依存グラフ
  │        ↓ 3並列の結果を統合
  └─ architect-reviewer           → ★条件付き★ 既定はスキップ
  │
  ▼ ユーザー確認①「分析+計画は正しいか？」
  ▼ ★ チェックポイント追記 ★
  │
Phase 2: 実装 ──────────── ★レベル並列★ ──
  │
  ├─ git checkout -b <branch>
  ├─ 実行戦略判定（依存グラフ有無）
  └─ Level 単位で tdd-guide 並列実行
  │  ▼ ★ レベル完了ごとにチェックポイント ★
  │  ▼ ★ Phase 2 完了チェックポイント ★
  │
Phase 3: レビュー ──────────── ★最大5並列★
  │
  ├─ [並列] code-quality-reviewer
  ├─ [並列] security-reviewer
  ├─ [並列] test-verifier
  ├─ [並列] database-reviewer    （DB変更時のみ）
  └─ [並列] refactor-checker
  │
  ▼ ユーザー確認②「コミット・PR作成してよいか？」
  ▼ ★ チェックポイント追記 ★
  │
Phase 4: デリバリー ─────────────────────
  │
  ├─ doc-updater                 → ドキュメント更新
  ├─ git commit                  → コミット作成
  └─ pr-creator                  → プッシュ・PR作成
  │
  ▼ ★ 最終チェックポイント（PR URL 含む）★
  ▼ 完了レポート出力
```

上図は **単一 Issue モード**。複数 Issue を指定した場合は [`reference/parallel-worktree.md`](reference/parallel-worktree.md) の worktree 並列モードで動作する。

## チェックポイント形式（コンパクト）

全 Phase で統一のコンパクト形式を使用する。HTML コメントにメタデータ、本文は最小限:

```
<!-- CLAUDE_PROGRESS phase=N status=STATUS branch=BRANCH -->
completed: 1 | current: 2 | next: Phase 2 実装
files: src/types.ts, src/config.ts
context: offset/limit方式, Server Component
```

**ルール:**
- メタデータは HTML コメント内（`phase`, `status`, `branch`）
- 本文は `completed`, `current`/`next`, `files`, `context` の **4行以内**
- Phase 2（実装）のみレベル進捗を追加: `levels: L0✓ L1✓ L2… L3`
- 機密情報を含めない
- 追記のみ（過去のコメントは編集・削除しない）

（追記タイミングや再開時のレベル判定など詳細は `.claude/rules/progress-tracking.md` を参照）

## Phase 0: 再開検出 + worktree 自動掃除

### Step 0-A: マージ済み worktree 自動掃除 (毎起動時、無条件)

`/issue-flow` を起動するたびに最初に実行する。前回 Phase 4 で polling timeout になった分、別経路でマージされた worktree、および他スキル / Agent isolation 経由で `.claude/worktrees/agent-*` 配下に作られた worktree も含めて回収する。

**重要 — locked 対応**: Claude Code ランタイムは agent isolation worktree を `git worktree lock` する。`git worktree remove --force` だけでは貫通できないため、**`git worktree unlock` を先に呼んでから `--force` で remove** する 2 段構え必須。

→ **掃除の具体的な bash スクリプトとスコープは [`reference/parallel-worktree.md`](reference/parallel-worktree.md)「Phase 0: マージ済み worktree 自動掃除」を参照**。掃除結果は冒頭で `N 件のマージ済み worktree を掃除しました` 形式で簡潔に報告（0 件なら無報告）。単一 Issue モードのみの利用が確実なら本ステップは実質 no-op。

### 早期スキップ

```bash
# コメント数を先にチェック
gh issue view <number> --json comments -q '.comments | length'
```

**0件 → Phase 1 へ即座にスキップ。** コメントがある場合のみチェックポイント検索を実行:

```bash
gh issue view <number> --comments --json comments -q '.comments[].body' | grep -l 'CLAUDE_PROGRESS'
```

最新のチェックポイントから `phase`, `status`, `branch`, `context` を解析。

### 依存グラフの復元（CLAUDE_PLAN）

`phase=1 COMPLETED` 以降を再開する場合、`<!-- CLAUDE_PLAN -->` マーカー（Phase 1 完了時に別コメントで永続化した依存グラフ）も読む。

- **あり** → 依存グラフ（Level/step/files）を復元し **Phase 1 を完全スキップ**して Phase 2 へ。
- **なし**（旧 Issue・永続化前）→ planner のみ再実行して依存グラフを再生成。

### 再開確認

チェックポイント発見時、完了済み Phase と中断地点を提示し、ユーザーに「続きから再開 / 最初から」を確認。

### ブランチ復元

ローカル → リモート → なければ Phase 2 からやり直し（ブランチ作成から）。

```bash
git branch --list <branch-name>                          # ローカル確認
git fetch origin && git checkout -b <branch> origin/<branch>  # リモートから取得
```

### スキップルール

| チェックポイントの状態 | 再開ポイント |
|---------------------|------------|
| Phase 1 COMPLETED | Phase 2 から |
| Phase 2 IN_PROGRESS | Phase 2 の中断レベルから |
| Phase 2 COMPLETED | Phase 3 から |
| Phase 3 COMPLETED | Phase 4 から |

## Phase 1: 分析+計画（3並列 → 1順次）

### Step 1-0: Issue 充実度判定（軽量化トリガー）

Issue 本文（`gh issue view <number> --json body -q .body`）を見て、Phase 1 をフル実行するか縮約するか決める。`issue-create` が生成した充実 Issue では要件分析が重複するため。

**充実シグナル**（いずれかに該当で「充実」）:
- 受け入れ条件チェックリスト（`- [ ]`）がある
- 技術方針 / 技術メモ セクションがある
- （分解 Issue）`Issue #N に依存` 参照がある

| エージェント | 充実 Issue | 非充実 Issue | 省略可否 |
|-------------|-----------|-------------|---------|
| issue-analyzer | **縮約**: ブランチ名生成＋本文整合確認のみ（要件再構造化を省く） | フル | 条件付き縮約 |
| Explore | フル | フル | **省略不可** |
| planner | フル（Issue 本文を渡し再導出を抑制） | フル | **省略不可** |

**なぜ Explore と planner は省けないか（重要）**:
- **Explore（現コード調査）**: Issue は作成時点のスナップショット。実装着手時にはコードが変わっている可能性があるため、現コードベースの調査は**時点差**ゆえ常に必要。
- **planner の依存グラフ**: `step_id`/`depends_on`/`files`/`type` は Phase 2 のレベル並列実行を駆動する**機械可読な入力**。Issue 本文の散文からは生成できないため省略不可。

充実時は issue-analyzer を縮約モードで起動し、planner には Issue 本文（受け入れ条件・技術メモ）を渡して要件の再導出を避ける。Step 1-3 のユーザー提示欄に `Phase 1: フル / 縮約（<理由>）` を 1 行明記する。

> **注**: issue-analyzer は haiku・並列でクリティカルパス外のため、縮約単体の節約は小さい。主価値は責務の明文化と planner への文脈受け渡しによる再導出削減、および後述「依存グラフの永続化」との相乗による再開時スキップ。

### Step 1-1: 3エージェント同時起動

| # | エージェント | モデル | 役割 |
|---|-------------|--------|------|
| 1 | issue-analyzer | haiku | Issue分析・要件構造化・ブランチ名生成 |
| 2 | Explore | haiku | コードベース構造調査 |
| 3 | planner | inherit | 実装計画策定・依存グラフ出力 |

3つとも Issue を GitHub から直接読めるため、互いの結果を待つ必要がない。

**planner の出力要件:**
- 各実装ステップに `step_id`, `title`, `depends_on`, `files`, `type` を付与（`/plan` スキル参照）
- **API エンドポイントの作成・変更を含む場合**: API 仕様（メソッド・パス・認証・リクエスト/レスポンススキーマ・エラーコード）も出力する（`/plan` スキルの「API 仕様」参照）
- **構造リスクがあると判断した場合**: 出力先頭に `architectural_risk: true` と理由を明示（例: 既存の責務分界に影響、新規抽象層の導入、等）。親エージェントはこのフラグを Step 1-2 のトリガー判定に使用する

### Step 1-2: architect-reviewer（条件付き・既定スキップ）

architect-reviewer はクリティカルパス上で 2分以上かかるため、**既定はスキップ**。以下のトリガーに**1つ以上**該当する場合のみ起動する:

| トリガー | 判定方法 |
|---------|---------|
| API エンドポイントの新規追加/変更 | planner 出力に「API 仕様」セクションあり |
| DB スキーマ変更 | 変更対象ファイルに `migrations/`, `*.sql`, ORM スキーマ, `supabase/` を含む |
| 新規モジュール/クレート/パッケージ追加 | planner 出力に新規 `Cargo.toml`/`package.json`/新ディレクトリ作成あり |
| 複数レイヤー横断変更 | 変更対象ファイルが UI・API・DB のうち 2 層以上に跨る |
| planner が明示リスク申告 | planner が `architectural_risk: true` を付けた |

**いずれにも該当しない場合はスキップ**（単一ファイル・単一レイヤーの変更、UI 文言調整、設定値変更など）。起動判定は親エージェントが planner 完了時点で行い、スキップ時はユーザー提示欄に `アーキテクチャ: SKIP（<スキップ理由>）` と明記する。

### Step 1-3: 統合結果をユーザーに提示

分析結果・計画・API 仕様（該当時）・アーキテクチャ評価をまとめて提示し、**1回の確認** で承認を得る:

```
■ 分析+計画

  要件: <要件サマリー>
  ブランチ: <type>/#<number>-<slug>

  計画: <ステップ数>ステップ / <レベル数>レベル
  <計画概要>

  API 仕様: <エンドポイント数>件（該当時のみ表示）
  <API 仕様概要>

  Phase 1: フル / 縮約（<理由>）
  アーキテクチャ: PASS / 指摘事項あり / SKIP（<理由>）

  この方針で実装を開始してよいですか？
```

### チェックポイント追記

```bash
gh issue comment <number> --body "$(cat <<'EOF'
<!-- CLAUDE_PROGRESS phase=1 status=COMPLETED branch=<branch> -->
completed: 1 | next: Phase 2 実装
plan: <ステップ数> steps, <レベル数> levels
context: <技術選定・ユーザー指示の要約>
EOF
)"
```

### 依存グラフの永続化（再開用）

上記コンパクトチェックポイントとは**別コメント**で、依存グラフのスナップショットを `<!-- CLAUDE_PLAN -->` マーカーで追記する。`CLAUDE_PROGRESS` の「本文 4 行以内」制約は別マーカーなので影響しない。これにより**再開時に planner を作り直さず Phase 1 を完全スキップ**できる（Phase 0 が読む）。

```bash
gh issue comment <number> --body "$(cat <<'EOF'
<!-- CLAUDE_PLAN branch=<branch> -->
<details><summary>Phase 1 実装計画（依存グラフ）— 再開用</summary>

Level 0: [S0 setup] files: ...
Level 1: [S1 feature, S2 feature] files: ...
Level 2: [S3 integration]
Level 3: [S4 verification]

API 仕様: <要約 or docs/api-design.md 参照>
</details>
EOF
)"
```

## Phase 2: 実装（レベル別並列実行）

**単一モード**: 現在の cwd で以下のブランチ操作を行う。

```bash
git fetch origin main
git checkout main && git pull origin main
git checkout -b <type>/#<number>-<slug>
```

**並列モード**: cwd が既に worktree（`git worktree add` 済み）なので上記は不要。worktree 作成時にブランチが切れている前提で Phase 2 本体へ進む（[`reference/parallel-worktree.md`](reference/parallel-worktree.md) 参照）。

### 実行戦略判定

| 条件 | 戦略 |
|------|------|
| 依存グラフあり + 並列可能 | **並列実行モード** |
| 依存グラフあり + 全直列 | **順次実行モード** |
| 依存グラフなし | **フォールバック（逐次 TDD）** |

### 巨大単一 Issue の扱い（自動委譲はしない）

> **方針**: 単一 Issue モードでは Workflow への自動委譲フックを置かない。単一 Issue が 50 ファイル超／複数モジュール横断／数十ステップに膨らむのは **Issue の分解不足**（プロセス臭）であり、Workflow をぶつけるのは対症療法。**Workflow の主軸はバッチ入口**（`/fix-impl` の大規模一括・`/issue-flow --all-open`）に置く。

planner の依存グラフが明らかに巨大（`files` ユニーク ≥ 50、跨るモジュール ≥ 3、`step_id` ≥ 30 のいずれか）だと判明した場合は、**委譲提案ではなく次を助言**する:

1. `/issue-create` でサブ Issue に分解し、バッチ経路（`--all-open` / `/fix-impl`）に乗せる（推奨）。
2. どうしても 1 単位で進めたい大規模マイグレーション等は、`/orchestrate <タスク説明>` を**直接**起動する（Issue 経由のフックではなく直接起動でカバー）。

それ以外は従来どおり下記のレベル別並列のまま実装する。

### トポロジカルソート & レベル分け

`depends_on` からレベルを導出:
- `depends_on` が空 → Level 0
- 全依存先が Level N 以下 → Level N+1

### ファイル競合チェック（レベル内）

同一レベル内でファイル重複があれば直列化グループにまとめる。

### レベル単位の並列実行

Level N の全タスク完了後に Level N+1 を開始。各タスクは **tdd-guide シングルステップモード** で実行（files スコープ制限付き）。

### エラーハンドリング

| 状況 | 対応 |
|------|------|
| 1タスク失敗 | 同レベル他タスクは続行。リトライ最大2回 |
| リトライ失敗 | ユーザー報告、後続中断 |
| ビルドエラー | build-error-resolver で修正後リトライ |

### フォールバック

依存グラフなし → 単一の tdd-guide で逐次実行（RED → GREEN → REFACTOR）。TDD サイクルの区切りごとにチェックポイント追記。

### チェックポイント（レベル単位）

Phase 2 はトークン消費が最も大きいため、レベル完了ごとに追記:

```bash
gh issue comment <number> --body "$(cat <<'EOF'
<!-- CLAUDE_PROGRESS phase=2 status=IN_PROGRESS branch=<branch> -->
completed: 1 | current: 2 | levels: L0✓ L1✓ L2…
files: <変更済みファイル>
context: <ステップ結果サマリー>
EOF
)"
```

## Phase 3: レビュー（最大5並列）

### 大規模 diff の委譲フック（上乗せ・既定挙動は不変）

変更ファイルが `.claude/rules/workflow-orchestration.md` の**判定基準**を超える場合（閾値の定義はルール側に集約。下記「変更ファイルリスト事前計算」の `git diff --name-only main...HEAD` の件数で判定）は、`review-changes` workflow への委譲を**推奨第1候補で提案**する（`AskUserQuestion`）。委譲には Workflow のオプトインが必要なため、ユーザー承認のうえ `/orchestrate review-changes` 経由で起動し、結果（確定済み findings）を本 Phase の判定にそのまま用いる。**判定基準未満なら従来どおり下記の最大5並列のまま**。

### 変更ファイルリスト事前計算

```bash
git diff --name-only main...HEAD
```

全エージェントにリストを渡し、個別の `git diff` を排除。

### database-reviewer 早期スキップ

変更ファイルに DB 関連パターン（`*.sql`, `migrations/`, ORM スキーマ, `supabase/` 等）がなければスキップ。

### レビューエージェント並列起動

| # | エージェント | モデル | 条件 |
|---|-------------|--------|------|
| 1 | code-quality-reviewer | sonnet | 常時 |
| 2 | security-reviewer | sonnet | 常時 |
| 3 | test-verifier | haiku | 常時 |
| 4 | database-reviewer | haiku | DB関連ファイルありの場合のみ |
| 5 | refactor-checker | haiku | 常時 |

各エージェントは詳細レポート全文を親に直接返す（ファイル書き出しは行わない）。**レポート末尾に `findings` ブロック（SARIF サブセット）を必ず付与する**こと。

### 出力契約・判定・auto-fix の詳細

reviewer の `findings` ブロックの構造、severity マッピング、`ruleId`/`suggested_patch` の指針、FAIL/VULNERABLE 時の判定 UI（`[m]/[a]/[i]/[s]`）、`--auto-fix`（1-shot・suggest/apply 分離）の完全仕様は **[`reference/phase3-review-detail.md`](reference/phase3-review-detail.md) を参照**。

判定の要点のみ:
- 全 reviewer の `result` が PASS / SECURE / CLEAN → ユーザー確認後 Phase 4 へ
- いずれか FAIL / VULNERABLE → 集約 findings を severity 順で提示しユーザーに方針を選ばせる
- database-reviewer SKIP は DB 変更なし（正常）

### チェックポイント

```bash
gh issue comment <number> --body "$(cat <<'EOF'
<!-- CLAUDE_PROGRESS phase=3 status=COMPLETED branch=<branch> -->
completed: 1,2,3 | next: Phase 4 デリバリー
review: quality=PASS security=PASS test=PASS db=SKIP refactor=CLEAN
context: <レビュー結果要約>
EOF
)"
```

## Phase 4: デリバリー（doc + commit + PR）

### Step 4-1: ドキュメント更新

**doc-updater** (sonnet) で変更に基づきドキュメントを更新:
- README.md、API ドキュメント、.env.example、CHANGELOG、CLAUDE.md、AGENTS.md

### Step 4-2: コミット

```bash
git add <files>
git commit -m "<type>(#<issue>): <説明>"
```

### Step 4-3: PR 作成

**pr-creator** (sonnet) がプッシュ + PR 作成:
- `Closes #<issue>` で Issue 自動クローズ
- テストプラン記載
- CI チェック確認

### Step 4-4: PR マージ待ち polling (並列モードのみ)

worktree が `.claude/worktrees/<branch>/` 配下にある場合のみ実行（単一モードの cwd は対象外）。PR を最大 5 分 polling し MERGED 検出で worktree 掃除、timeout は残して次回 Phase 0 が回収する。**具体的な polling スクリプトと設計理由は [`reference/parallel-worktree.md`](reference/parallel-worktree.md)「Phase 4 Step 4-4」を参照**。

### 最終チェックポイント

```bash
gh issue comment <number> --body "$(cat <<'EOF'
<!-- CLAUDE_PROGRESS phase=4 status=COMPLETED branch=<branch> -->
completed: 1,2,3,4 | status: DONE
pr: <PR URL>
context: 全Phase完了。PRマージでIssue自動クローズ。
EOF
)"
```

## ユーザーの介入ポイント（3箇所）

| Phase | タイミング | 判断内容 |
|-------|-----------|---------|
| 0 | 再開検出時 | 続きから再開するか（条件付き） |
| 1 | 分析+計画提示後 | 要件と実装方針の承認 |
| 3 | レビュー後 | コミット・PR作成の承認 |

## サブエージェント起動コンテキスト

サブエージェントは親の会話履歴を引き継がない。起動時に必要なデータを明示的に渡すこと。

### Phase 1: 分析+計画

| エージェント | 渡すデータ |
|-------------|-----------|
| issue-analyzer | Issue 番号 |
| Explore | Issue 要件サマリー（1-2行）、調査すべき観点（関連ファイル・ディレクトリ構造・既存パターン） |
| planner | Issue 番号、Issue 本文全文 |
| architect-reviewer | planner の計画全文（依存グラフ含む）、API 仕様（該当時）、変更対象ファイルリスト |

### Phase 2: 実装

| エージェント | 渡すデータ |
|-------------|-----------|
| tdd-guide | 該当ステップの `step_id`, `title`, `files`、実装すべき内容の説明、ブランチ名 |
| build-error-resolver | エラーメッセージ全文、該当ファイルパス |

### Phase 3: レビュー

| エージェント | 渡すデータ |
|-------------|-----------|
| 全レビュアー共通 | 変更ファイルリスト（`git diff --name-only main...HEAD` の結果）、ブランチ名、**末尾に `findings` ブロック (SARIF サブセット) を付与する出力契約** |
| database-reviewer | 上記に加えて、DB 関連の変更ファイルリスト |
| tdd-guide (auto-fix モード) | 対象 findings 配列、変更対象ファイルリスト、ブランチ名、「fix モード: RED/GREEN スキップ、既存テストを green に保つこと」の指示 |

### Phase 4: デリバリー

| エージェント | 渡すデータ |
|-------------|-----------|
| doc-updater | 変更ファイルリスト、Issue 番号、ブランチ名 |
| pr-creator | Issue 番号、ブランチ名、コミットメッセージ、レビュー結果サマリー |

## サブエージェント一覧

| エージェント | 種類 | モデル | Phase | 並列 |
|-------------|------|--------|-------|------|
| issue-analyzer | カスタム | haiku | 1 | Yes (3並列) |
| Explore | ビルトイン | haiku | 1 | Yes (3並列) |
| planner | ビルトイン | inherit | 1 | Yes (3並列) |
| architect-reviewer | カスタム | haiku | 1 | No (条件付き・既定スキップ) |
| tdd-guide | ビルトイン | inherit | 2 | Yes（レベル内） |
| build-error-resolver | ビルトイン | inherit | 2 | No |
| code-quality-reviewer | カスタム | sonnet | 3 | Yes |
| security-reviewer | カスタム | sonnet | 3 | Yes |
| test-verifier | カスタム | haiku | 3 | Yes |
| database-reviewer | カスタム | haiku | 3 | Yes |
| refactor-checker | カスタム | haiku | 3 | Yes |
| doc-updater | カスタム | sonnet | 4 | No |
| pr-creator | カスタム | sonnet | 4 | No |

## 注意事項

- `gh` CLI が認証済みであること（`gh auth status`）
- Issue 番号は正しいものを指定
- 機密情報を含む Issue の場合、PR本文に転記しない
- `git push --force` は使わない
- サブエージェント並列実行は最大10タスクまで
- チェックポイントには機密情報を含めない
- **並列モード（複数 Issue）固有の注意事項は [`reference/parallel-worktree.md`](reference/parallel-worktree.md)「並列モード限定の注意事項」を参照**（`.claude/worktrees/.gitignore` の確認、ビルドキャッシュ共有、worktree クリーンアップの 2 段防御など）
