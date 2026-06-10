---
name: issue-create
description: 既存Issueを確認し、重複がなければ新規Issueを作成する。新規プロジェクト（空リポジトリ）の場合は技術スタック提案→雛形生成→初期コミットを行ってからIssue作成に進む。作成後に /issue-flow で開発を開始できる。
argument-hint: "<要件の説明>"
---

# Issue Create スキル

既存 Issue を確認したうえで、必要であれば新規 Issue を作成します。
新規プロジェクト（空リポジトリ）を検出した場合は、技術スタックの提案からプロジェクト雛形の生成・初期コミットまでを行い、開発の土台を整えてから Issue 作成に進みます。

> **参照ファイル（その分岐に入ったときだけ読む）**:
> - 新規プロジェクト（空リポ）と判定された場合の Step 1 全体 → [`reference/new-project-setup.md`](reference/new-project-setup.md)（技術選定・visibility/CI/Release/Security 確認・雛形生成・gh api）
> - 大スコープ要件の分解（Step 3-2b） → [`reference/large-scope-decomposition.md`](reference/large-scope-decomposition.md)（要件抽出・トレーサビリティ・並列 Issue 作成）

## 使い方

```
/issue-create 検索にページネーション追加
/issue-create ログイン時に500エラーが出る
/issue-create REST API でユーザー管理機能を作りたい
/issue-create docs/req.md この要件をもとにアプリを作りたい
```

**引数は必須。** `$ARGUMENTS` が空の場合は使い方を案内して中断。

## 実行フロー

```
引数チェック（空なら中断）→ EnterPlanMode（ここから読み取り専用）
    │
─── plan モード（コード/ファイルを書かない。途中の確認は AskUserQuestion で可）───
    │
Step 0: 事前チェック ──── ★3並列★（全て read-only）
    │
    ├─ [並列A] GitHub連携確認 (git remote + gh auth)
    ├─ [並列B] プロジェクト状態判定 + CLAUDE.md Project Context 取得
    └─ [並列C] 既存Issue確認 (gh issue list --search "kw is:open")
    │
    ▼ 結果統合
    │
    ├─ GitHub NG → 中断（エラー案内）
    ├─ 新規PJ → Step 1（初期セットアップ → reference/new-project-setup.md）
    └─ 既存PJ →
        ├─ 重複あり → 該当Issue提示
        └─ 重複なし → Step 2 へ
    │
Step 1: 初期セットアップ（新規PJのみ）── reference/new-project-setup.md
    │   1-1 要件分析 → 1-2 技術調査 → 1-2b visibility/CI/Release/Security 確認 ★必須★
    │   ▼ ExitPlanMode（生成物の最終承認）→ 1-3 雛形生成 → 1-4 commit/push + gh api
    ▼ Step 3 へ合流（Issue 作成）
    │
Step 2: tech-selector 判定（既存PJのみ・plan モード内）
    │
    ├─ 親側で要件から決定ポイント候補を列挙（Step 0 取得の Context を活用）
    ├─ 決定ポイントなし → tech-selector スキップ → Step 3 直行
    └─ 決定ポイントあり → tech-selector 起動 → ユーザー確認
                          （CLAUDE.md 追記は承認後に main スレッドが実行）
    │
Step 3: スコープ判定 → Issue 作成
    │
    ├─ 3-1: スコープ判定（小 or 大）
    ├─ 小スコープ → 3-2a: ▼ ExitPlanMode = 単一 Issue 承認 → gh issue create
    └─ 大スコープ → 3-2b: reference/large-scope-decomposition.md（手順1〜6）
    │
Step 4: 次のアクション提示
    └─ 「/issue-flow #N で開発を開始しますか？」
```

## plan モード（書き込み前のハードゲート）

書き込みが発生する前の全フェーズ（Step 0 + 調査・設計・確認）を **plan モード**で実行し、ユーザー承認まで Edit/Write がハーネス側でブロックされる状態を保つ。特に `.github/**` の自動生成（`rules/ci-release.md` STOP ゲートの対象）を「承認前に書かない」ことを物理的に担保する。

### 入口は 1 か所（Step 0 は新規/既存どちらでも read-only）

引数チェックを通過したら `EnterPlanMode` を呼ぶ。Step 0 の 3 並列事前チェックは `git`/`gh` 参照・ファイル読取・PJ 判定のみで書き込みが無いため、新規/既存の判定前でも安全に plan モードに入れる。

### 出口（ExitPlanMode）はパス別に 1 回

| パス | ExitPlanMode の地点 | 承認後に行う書き込み |
|------|--------------------|--------------------|
| 既存PJ・小スコープ | Step 3-2a の Issue 確認 | `gh issue create`（単一） |
| 既存PJ・大スコープ | Step 3-2b 手順 5 のトレーサビリティ承認 | `gh issue create`（並列） |
| 新規PJ | Step 1-2b の最終確認（生成物が確定する地点） | 1-3 雛形生成 + 1-4 commit/push + `gh api` Security 有効化 + Step 3 Issue 作成 |

- 途中の確認（1-1 / 1-2 / tech-selector の推奨確認）は **plan モード内で `AskUserQuestion`** として出す。plan モードは質問をブロックしない。
- ExitPlanMode は「最後の書き込み直前の承認」**1 回**にまとめる。新規PJでは 1-2b（何を生成するか確定）がそれにあたる。

### 注意

- **tech-selector の CLAUDE.md 追記は承認後に回す**: tech-selector（サブエージェント）は plan モードを継承しないため plan モード中でも書けてしまう。決定は返させるだけにし、CLAUDE.md `## Project Context` への追記は ExitPlanMode 後に main スレッドが実行する。
- **`[gh-check]` マーカーは維持**: 1-3 の `.github/**` 生成は ExitPlanMode 承認とは別に、`rules/ci-release.md` の `[gh-check]` マーカーも必須（ExitPlanMode 承認が `user_confirmed=yes` の根拠になる）。

## Step 0: 事前チェック（3並列）

以下の3つを **同時に実行** し、全結果が揃ってから判定する。

### 並列タスク A: GitHub 連携確認

```bash
git remote -v        # github.com を含むリモートがあるか
gh auth status       # 認証済みか
```

いずれか失敗 → 処理中断。修正コマンドを案内:
- リモート未設定 → `git remote add origin` を案内
- 認証エラー → `gh auth login` を案内

### 並列タスク B: プロジェクト状態判定 + コンテキスト取得

**新規/既存の判定（主条件のみ）**: プロジェクト定義ファイル（`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `build.gradle`, `pom.xml` 等）が **1 つも存在しない場合のみ** 「新規プロジェクト」とする。

AND 条件（src/ なし、追跡ファイル数 ≤5 等）は使わない。README + .gitignore + CLAUDE.md + AGENTS.md 程度でも空リポは空リポである。

**同時に取得（Step 2 で再読込しないため）**:
- CLAUDE.md の `## Project Context` セクションの有無と、存在すれば全文
- ソースコードディレクトリの有無（`src/`, `lib/`, `app/`, `cmd/`, `internal/`, `pkg/` 等） — 補助情報として Step 2 判定で使用

### 並列タスク C: 既存 Issue 確認

open Issue を 1 回の検索で取得（全件リストと検索を 2 回実行しない）:

```bash
gh issue list --search "<キーワード> is:open" --limit 20
```

類似・重複 Issue があれば候補リストを作成。

### 結果統合

3つの結果を統合して次のステップを決定:
- GitHub NG → 即中断
- 重複あり → 該当 Issue を提示し、ユーザーに判断を委ねる
- 新規PJ → Step 1（[`reference/new-project-setup.md`](reference/new-project-setup.md) を読んで実行）
- 既存PJ + 重複なし → Step 2

## Step 1: 初期セットアップ（新規PJのみ）

新規プロジェクト（空リポジトリ）と判定された場合のみ実行する。要件分析 → WebSearch による技術スタック提案 → リポジトリ visibility / CI / Release / GitHub Security の 1 つずつ確認（★必須・自動デフォルト禁止★）→ `ExitPlanMode` 承認 → 雛形生成（依存最新化・`[gh-check]` マーカー必須）→ 初期コミット・push・`gh api` Security 有効化、までを行う。

**手順の全詳細は [`reference/new-project-setup.md`](reference/new-project-setup.md) を参照して実行する。** 完了後 Step 3 へ合流。

## Step 2: tech-selector 判定（既存PJのみ）

### 決定ポイント事前判定（親側で実行 — エージェント起動前）

**CLAUDE.md の有無ではなく、要件内容で分岐する。** Step 0 並列タスク B で取得済みの Project Context と、引数の要件を照らし、**新規の技術選定ポイント** が含まれるか判定:

| 決定ポイントの例 | 該当時の扱い |
|----------------|------------|
| 新規の外部ライブラリ・フレームワーク・サービス連携 | tech-selector 起動 |
| DB・認証・通信方式・キャッシュ戦略・ログ基盤等の選定 | tech-selector 起動 |
| 既存スタックへの影響を伴うアーキテクチャ変更 | tech-selector 起動 |
| 既存スタック内で完結する機能追加・バグ修正 | **tech-selector スキップ → Step 3 へ直行** |

**決定ポイントなし** → tech-selector 自体を起動せず Step 3 へ。これによりトークンと待ち時間を削減。

**決定ポイントあり** → tech-selector を起動。Project Context（Step 0 で取得済み）と決定ポイント候補をあらかじめ渡すことで、tech-selector 側の再探索を抑制:

```
Task(
  subagent_type: "tech-selector",
  prompt: "要件: $ARGUMENTS\n決定ポイント候補: <親側で列挙したリスト>\nProject Context: <Step 0 で取得した全文 or 「なし」>"
)
```

- Project Context が CLAUDE.md に未記載の場合、tech-selector は決定結果を**返すだけ**にする。CLAUDE.md `## Project Context` への追記は **plan モードを抜けた後（Step 3 の ExitPlanMode 承認後）に main スレッドが実行**する（plan モード中は Write 不可。サブエージェントは plan モードを継承しないため、tech-selector 自身には書かせない）
- 推奨が返ったらユーザーに提示・確認:
  - 「推奨で進める」 → 採用
  - 「変更あり」 → 指定を反映
  - 「調べてから決めたい」 → WebSearch で補足調査後に再提示

## Step 3: スコープ判定 → Issue 作成

### 3-1: スコープ判定

以下の **いずれか** に該当する場合「大スコープ」と判定する:

| 条件 | 例 |
|------|-----|
| 引数にファイルパス（要件定義書等）が含まれる | `docs/req.md` |
| 要件に複数の独立した機能領域がある | DB + API + 画面 |
| ロードマップ / Phase 分けが記載されている | Phase 1, Phase 2... |
| 複数のアクター / ポータルが登場する | 家主、管理会社、業者 |
| 要件の行数が 30行を超える | - |

- **小スコープ** → 3-2a へ
- **大スコープ** → 3-2b（[`reference/large-scope-decomposition.md`](reference/large-scope-decomposition.md) を読んで実行）

### 3-2a: 単一 Issue 作成（小スコープ）

ユーザーの説明から以下を生成:
- **タイトル**: 簡潔（日本語 or 英語）
- **ラベル**: 自動判定
- **本文**: 概要、背景、受け入れ条件、技術方針（決定済みの場合）、技術メモ

生成内容を `ExitPlanMode` で提示してユーザー承認を取る（plan モードはここで抜ける）。承認後:

```bash
gh issue create --title "..." --label "..." --body "..."
```

（既存PJパスで Step 2 の tech-selector が決定を返していた場合、ここで CLAUDE.md `## Project Context` への追記も合わせて実行する。）

### 3-2b: 要件分解フロー（大スコープ）★重要★

大スコープの要件を複数 Issue に分解する。要件の漏れを防ぐため、**[`reference/large-scope-decomposition.md`](reference/large-scope-decomposition.md) の手順 1〜6 を厳密に実行する**（要件セクション抽出 → Phase 判定 → Issue 分割案 → トレーサビリティマトリクス ★必須★ → 部分スコープ時のプロジェクト突合 → 手順 5 で `ExitPlanMode` 承認 → 手順 6 で依存レベル単位の並列 `gh issue create`）。

### ラベル自動判定

| ユーザーの表現 | ラベル |
|---------------|--------|
| 追加、新機能、〜したい | `enhancement` |
| エラー、バグ、壊れた、動かない | `bug` |
| ドキュメント、README | `documentation` |
| リファクタ、整理、改善 | `refactor` |
| テスト追加 | `test` |
| 遅い、パフォーマンス | `performance` |

## Step 4: 次のアクション（開発へのハンドオフ）

Issue URL を表示したうえで、**テキスト案内で終わらせず `AskUserQuestion` で開発開始へハンドオフする**（推奨を第1候補に置く。`decision-presentation.md`）。Workflow 起動を含む場合も、ここでの承認が確認ポイント①（オプトイン）を兼ねる。

提示の直前に目的＋現在地を添える:

```
目的：作成した Issue を実装まで進めること
現在地：要件 → Issue作成（完了）→ 実装ハンドオフ（現在地） → レビュー → PR
```

### 4-A: 単一 Issue（小スコープ）

`AskUserQuestion` で「続けて実装するか」を確認:
- **続けて実装する（推奨）** → `/issue-flow #N` を起動。
- あとで → URL のみ提示して終了。

### 4-B: 複数 Issue（大スコープ分解）

分解で作成した Issue 群を**そのまま実装に流す**。ここで**依存順序を必ず尊重する**（分解時の依存グラフ＝`reference/large-scope-decomposition.md` のトレーサビリティ/依存レベルを使う）。`AskUserQuestion`:

| 選択肢 | 挙動 |
|--------|------|
| **続けて全件を実装する（推奨）** | 件数で経路を自動選択（下表） |
| 第0レベル（依存なし）だけ先に実装 | 依存先のない Issue だけを実装し、残りは後続セッションへ |
| あとで | 推奨開発順序（依存グラフ）を提示して終了 |

「全件を実装する」を選んだ場合の経路:

| 作成 Issue 数 | 経路 |
|--------------|------|
| **概ね 10 件未満** | `/issue-flow #N1 #N2 …`（素朴 worktree 並列。`reference/parallel-worktree.md`） |
| **概ね 10 件以上** | 定義済み workflow **`issue-batch`** に委譲。`/orchestrate issue-batch` で起動し `{issues:[{number,title,body,level}], base}` を渡す（**`level` に依存レベルを必ず入れる**＝レベル間バリアで依存違反を防ぐ） |

> **重要 — 依存違反の防止**: 分解 Issue は「Issue #N に依存」を持つため、**全件を無条件に並列実行してはならない**。`issue-batch` 経路では各 Issue に `level`（依存レベル）を付与し、素朴並列経路でも依存レベル順に投入する。判定基準・閾値は `.claude/rules/workflow-orchestration.md` が単一ソース。

## サブエージェント起動コンテキスト

サブエージェントは親の会話履歴を引き継がない。起動時に必要なデータを明示的に渡すこと。

| エージェント | 渡すデータ |
|-------------|-----------|
| tech-selector | ユーザー要件（`$ARGUMENTS`）、CLAUDE.md の Project Context（あれば全文、なければ「なし」） |

## 他のスキルとの連携

- `/issue-create` → Issue 作成 → **Step 4 で開発へハンドオフ**（単一は `/issue-flow #N`、複数は依存順を保って一括実装）
- `/issue-flow #N` → 作成した Issue から全自動開発
- **複数 Issue 一括（大スコープ分解の続き）**: Step 4-B が件数で経路を選ぶ。≥10 件は `issue-batch` workflow（`/orchestrate issue-batch`・依存レベル順）、未満は素朴 worktree 並列。閾値は `.claude/rules/workflow-orchestration.md` 参照
