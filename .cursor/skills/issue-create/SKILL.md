---
name: issue-create
description: 既存Issueを確認し、重複がなければ新規Issueを作成する。新規プロジェクトの場合は要件分析・設計方針→技術スタック提案→雛形生成→初期コミットの後にIssue作成。既存プロジェクトの場合はtech-selectorで技術方針を確認してからIssue作成。作成後に /issue-flow で開発開始可能。Use when user wants to create an issue (e.g. /issue-create 検索にページネーション追加).
---

# Issue Create スキル

既存 Issue を確認し、重複がなければ新規 Issue を作成する。新規プロジェクト（空リポジトリ）の場合は技術スタック提案・雛形生成・初期コミットを行ってから Issue 作成に進む。

## 使い方

```
/issue-create 検索にページネーション追加
/issue-create ログイン時に500エラーが出る
/issue-create REST API でユーザー管理機能を作りたい
/issue-create docs/req.md この要件をもとにアプリを作りたい
```

**引数（要件の説明）は必須。** 空の場合は「要件を指定してください」と案内して中断。

## 実行フロー

```
引数チェック（空なら中断）→ EnterPlanMode（ここから読み取り専用）
    │
─── plan モード（書き込まない。途中の確認は AskUserQuestion で可）───
    │
Step 0: 事前チェック ──── ★3並列★（全て read-only）
    │
    ├─ [並列A] GitHub連携確認 (git remote + gh auth)
    ├─ [並列B] プロジェクト状態判定 + AGENTS.md Project Context 取得
    └─ [並列C] 既存Issue確認 (gh issue list --search "kw is:open")
    │
    ▼ 結果統合
    │
    ├─ GitHub NG → 中断
    ├─ 新規PJ → Step 1（初期セットアップ）
    └─ 既存PJ → 重複あり → 該当Issue提示 / 重複なし → Step 2 へ
    │
Step 1: 初期セットアップ（新規PJのみ）
    ├─ 要件分析・設計方針 → ユーザー確認（plan モード内）
    ├─ WebSearchで技術スタック調査・提案 → ユーザー確認（plan モード内）
    ├─ ★必須★ リポジトリ visibility (Public/Private) / CI / Release / GitHub Security をユーザーに**1 つずつ明示確認**（rules/ci-release.mdc + rules/security.mdc 参照）— Actions 課金枠・GHAS サブスク・Public 化が絡むため、**自動デフォルトで「使う」前提に倒さない**
    │  ▼ ExitPlanMode = 生成物の最終承認（plan モードはここで終了。以降が書き込み）
    ├─ **依存バージョン最新化**（雛形書き出し前に並列取得: `cargo search` / `npm view` / `pip index versions` / `go list -m -versions` / `gh api repos/<owner>/<repo>/releases/latest`）— Dependabot 初回 PR を 0 件にするための必須ステップ
    ├─ 雛形生成（.github/workflows/ci.yml / release.yml, dependabot.yml, codeql.yml, SECURITY.md は**ユーザーが明示的に「使う」と回答した項目のみ生成**。`.github/**` は `[gh-check]` マーカー必須）→ 初期コミット・プッシュ
    ├─ GitHub Security 機能を `gh api` で有効化 — **ユーザーが Yes と回答した項目のみ** (vulnerability-alerts, automated-security-fixes, private-vulnerability-reporting (OSS), secret_scanning + push_protection (Public または GHAS 契約済 Private))。失敗時は README に手動有効化項目として残す
    └─ Step 3 へ合流
    │
Step 2: tech-selector 判定（既存PJのみ・plan モード内）
    ├─ 親側で要件から決定ポイント候補を列挙（Step 0 取得の Context を活用）
    ├─ 決定ポイントなし → tech-selector スキップ → Step 3 直行
    └─ 決定ポイントあり → tech-selector 起動 → ユーザー確認
                          （AGENTS.md 追記は承認後に main スレッドが実行）
    │
Step 3: スコープ判定 → Issue 作成
    │
    ├─ 3-1: スコープ判定（小 or 大）
    ├─ 小スコープ → 3-2a: ▼ ExitPlanMode = 単一 Issue 承認 → gh issue create
    └─ 大スコープ → 3-2b: 手順1〜4b → ▼ ExitPlanMode = 手順5 承認 → 並列 gh issue create
    │
Step 4: 「/issue-flow #N で開発を開始しますか？」
```

### plan モード（書き込み前のハードゲート）

書き込み前の全フェーズ（Step 0 + 調査・設計・確認）を **plan モード**で実行し、承認まで Edit/Write をハーネスがブロックする。特に `.github/**` 自動生成（`rules/ci-release.mdc` STOP ゲート対象）を「承認前に書かない」ことを担保する。

- **入口は 1 か所**: 引数チェック通過後に `EnterPlanMode`。Step 0 は新規/既存どちらでも read-only なので判定前でも安全に入れる。
- **出口（ExitPlanMode）はパス別 1 回**:
  - 既存PJ・小スコープ → 3-2a の Issue 確認 → `gh issue create`
  - 既存PJ・大スコープ → 3-2b 手順 5 の承認 → 並列 `gh issue create`
  - 新規PJ → 1-2b（visibility/CI/Security 確認＝生成物が確定する地点）→ 雛形生成 + commit/push + `gh api`
- 途中の確認（要件・スタック・tech-selector 推奨）は **plan モード内で `AskUserQuestion`**。質問はブロックされない。
- **tech-selector の AGENTS.md 追記は承認後**: サブエージェントは plan モードを継承しないため、決定は返させるだけにし、AGENTS.md `## Project Context` への追記は ExitPlanMode 後に main スレッドが実行する。
- **`[gh-check]` マーカーは維持**: `.github/**` 生成は ExitPlanMode 承認とは別に `[gh-check]` マーカーも必須（承認が `user_confirmed=yes` の根拠）。

### Step 0: 並列実行の詳細

- **タスク A**: `git remote -v` + `gh auth status`。失敗時は修正コマンドを案内して中断
- **タスク B**: プロジェクト定義ファイル（`package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` / `build.gradle` / `pom.xml` 等）が **1 つも無い場合のみ**「新規PJ」。同時に AGENTS.md の `## Project Context` セクションの有無と内容も取得（Step 2 で再読込しない）
- **タスク C**: `gh issue list --search "<キーワード> is:open" --limit 20` の **1 回のみ** で重複候補を取得（全件リスト取得と 2 回検索は行わない）

### Step 2: 決定ポイント事前判定（エージェント起動前に親側で実行）

**AGENTS.md の有無ではなく、要件内容で分岐する。** Step 0 で取得した Project Context と引数の要件を照らし、新規技術選定ポイントが含まれるか判定:

- 新規の外部ライブラリ・フレームワーク・サービス連携
- DB・認証・通信方式・キャッシュ戦略・ログ基盤等の選定
- 既存スタックへの影響を伴うアーキテクチャ変更

**該当なし** → tech-selector 自体をスキップし Step 3 へ直行（トークン・時間を削減）。

**該当あり** → tech-selector を起動。要件・決定ポイント候補・Project Context（Step 0 取得済み）を渡す。Project Context 未記載の場合、tech-selector は決定を**返すだけ**にし、AGENTS.md `## Project Context` への追記は **ExitPlanMode 後（Step 3 承認後）に main スレッドが実行**する（plan モード中は Write 不可・サブエージェントは plan モードを継承しないため tech-selector に書かせない）。

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
- **大スコープ** → 3-2b へ

### 3-2a: 単一 Issue 作成（小スコープ）

ユーザーの説明から以下を生成:
- **タイトル**: 簡潔（日本語 or 英語）
- **ラベル**: 自動判定
- **本文**: 概要、背景、受け入れ条件、技術方針（決定済みの場合）、技術メモ

生成内容を `ExitPlanMode` で提示してユーザー承認を取り（plan モードはここで抜ける）、承認後に `gh issue create` を実行。tech-selector が決定を返していた場合は AGENTS.md `## Project Context` 追記もこのタイミングで行う。

### 3-2b: 要件分解フロー（大スコープ）★重要★

大スコープの要件を複数 Issue に分解する。**要件の漏れを防ぐため、以下の手順を厳密に実行する。**

#### 手順 1: 要件セクション抽出

要件ドキュメント（または引数テキスト）の **全セクション・全機能項目** を列挙する。
見出し単位ではなく、**個別の機能・データモデル・非機能要件** まで粒度を下げて列挙する。

```
例:
- 3.1 家主向け機能 > 資産ダッシュボード
- 3.1 家主向け機能 > ワークフロー承認
- 3.1 家主向け機能 > 債権管理
- 3.2 不動産会社向け機能 > 物件・契約管理
- 3.2 不動産会社向け機能 > リーシング業務
- 4.1 土地テーブル
- 4.1 建物テーブル
- ...
```

#### 手順 2: Phase スコープ判定

ロードマップや Phase 分けがある場合、各要件項目が **どの Phase に属するか** を判定する。
対象 Phase に含まれない項目は「Phase N で対応」と明記してスキップ。

#### 手順 3: Issue 分割案の作成

Phase 内の要件を Issue に分解する。分割の粒度:
- **1 Issue = 1つの独立してデプロイ可能な機能単位**
- 目安: 1 Issue の実装が 1-3日程度（受け入れ条件 3-10個）
- DB スキーマ → API → 画面 の順に依存関係を考慮

#### 手順 4: トレーサビリティマトリクス（★必須★）

**要件セクション → Issue の対応表** を作成し、ユーザーに提示する。
この表により、すべての要件が Issue にマッピングされていることを目視確認できる。

```
| 要件セクション          | 対象Phase | Issue                     | 備考           |
|------------------------|----------|---------------------------|---------------|
| 3.1 資産ダッシュボード    | Phase 2  | -                         | Phase 2 で対応  |
| 3.2 物件・契約管理       | Phase 1  | #1 DBスキーマ, #5 物件API   | ✓             |
| 3.2 リーシング業務       | Phase 1  | #10 リーシング基盤          | 図面作成はPhase2 |
| 3.2 全銀フォーマット     | Phase 2  | -                         | Phase 2 で対応  |
| 4.1 土地テーブル         | Phase 1  | #1 DBスキーマ              | ✓             |
| 4.1 建物テーブル         | Phase 1  | #1 DBスキーマ              | ✓             |
| ...                    | ...      | ...                       | ...           |
```

**チェック項目:**
- [ ] 対象 Phase の全要件に対応する Issue が存在する
- [ ] 「-」（対応 Issue なし）の行は、意図的に Phase 外としたものだけか
- [ ] 1つの要件が複数 Issue にまたがる場合、どちらが主担当か明確か
- [ ] Issue 間の依存関係が循環していないか

#### 手順 4b: プロジェクト全体との突合（★部分スコープ時は必須★）

入力ドキュメントがプロジェクト要件の **一部** である場合（例: 改善提案書、追加仕様、特定領域の要件書など）、入力の範囲内だけでは同じ Phase/マイルストーンの網羅性を保証できない。

**部分スコープの判定基準**（いずれかに該当すれば部分スコープ）:
- 入力がプロジェクトのメイン要件定義書とは別のドキュメント
- 入力が特定の改善領域・技術的負債に限定されている
- プロジェクトに他の要件定義書・ロードマップが存在する

**部分スコープの場合、以下を実行する:**

1. **プロジェクトコンテキストの参照**: CLAUDE.md / AGENTS.md、要件定義書、ロードマップ等から、対象 Phase/マイルストーンに属する全要件を列挙
2. **実装状況の突合**: 各要件について確認
   - 既に実装済みか（コードベースの存在確認）
   - 既存の open Issue があるか（`gh issue list`）
   - 今回の Issue 分割案に含まれているか
3. **未カバー要件の報告**: いずれにも該当しない要件を一覧化し、追加 Issue としてユーザーに提示

```
例:
| Phase N 要件（プロジェクト全体） | 実装済み | 既存Issue | 今回の分割案 | 状態       |
|---------------------------------|---------|----------|------------|-----------|
| 機能 A                          | ✓       | -        | -          | 完了       |
| 機能 B                          | ✓       | -        | -          | 完了       |
| 機能 C                          | 部分のみ | -        | -          | ★未カバー  |
| 機能 D                          | -       | #16      | -          | Issue済み  |
| 機能 E（入力ドキュメント由来）    | -       | -        | Issue B    | ✓         |
```

**このチェックを省略してはならない。** 入力ドキュメントのスコープに閉じた Issue 一覧は、Phase の完全性を保証しない。

#### 手順 5: ユーザー確認

トレーサビリティマトリクス（手順 4）と、部分スコープ時のプロジェクト突合結果（手順 4b）を合わせてユーザーに提示し、以下を確認:
- 漏れている要件はないか
- 分割の粒度は適切か
- Phase の振り分けは正しいか
- 追加・削除・統合したい Issue はあるか

トレーサビリティマトリクスを `ExitPlanMode` で計画として提示し、**ユーザー承認後**（plan モードを抜けてから）にまとめて `gh issue create` を実行する。tech-selector が決定を返していた場合は AGENTS.md `## Project Context` 追記もこのタイミングで行う。

#### 手順 6: Issue 一括作成（依存レベル単位で並列）

`gh issue create` は独立 API 呼び出しのため、**同一依存レベルの Issue は並列作成する**（逐次は禁止）。

**手順**:
1. `depends_on` からレベル分け: Level 0 = 依存なし、Level N = 全依存先が Level <N
2. Level 0 を **1 メッセージ内で複数 Bash ツール同時発行**（N 個の `gh issue create` を並列）し、返却 URL から Issue 番号を収集
3. Level N (N ≥ 1) は Level <N の番号確定後、`Issue #N に依存` を実番号で埋めて並列発行
4. 並列上限: 1 メッセージあたり 10 タスク。超える場合は 2 バッチに分割

**制約**: GitHub は API 到達順に番号を振るため、プランの「#1, #2, …」と実番号が乱れる可能性あり。ユーザーに提示する一覧は **作成完了後の実番号** を使う。依存参照は番号確定済みのもののみ本文に書く（プレースホルダで投げない）。

各 Issue 本文: 概要、背景、受け入れ条件（チェックリスト形式）、依存参照（`Issue #N に依存`）、技術メモ。

作成完了後、Issue 一覧表（実番号・タイトル・依存関係）を表示。

### ラベル自動判定

| 表現 | ラベル |
|------|--------|
| 追加・新機能・〜したい | `enhancement` |
| エラー・バグ・動かない | `bug` |
| ドキュメント・README | `documentation` |
| リファクタ・整理 | `refactor` |
| テスト追加 | `test` |
| 遅い・パフォーマンス | `performance` |

## Step 4: 次のアクション

Issue URL を表示し、`/issue-flow #N` での開発開始を案内。
大スコープの場合は推奨開発順序（依存関係グラフ）も提示。

## サブエージェント起動コンテキスト

サブエージェントは親の会話履歴を引き継がない。起動時に必要なデータを明示的に渡すこと。

| エージェント | 渡すデータ |
|-------------|-----------|
| tech-selector 相当 | ユーザー要件（`$ARGUMENTS`）、AGENTS.md の Project Context（あれば全文、なければ「なし」） |

## 注意事項

- リモート未設定・認証未完了の場合は中断
- 機密情報を Issue 本文に含めない
