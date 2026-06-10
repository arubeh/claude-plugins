# Claude Code 開発ワークフロー

GitHub Issue を起点に、サブエージェントを並列実行して開発する。

---

## 1. Issue を新規作成して完成まで（全手順）

### Step 0: Issue を作る

```
あなた:  /issue-create 検索にページネーションを追加したい
```

Claude Code が **既存 Issue を確認してから** 作成:

```
Claude:  ■ 既存 Issue 確認結果
           オープン: 12件
           類似: #38 検索機能の改善 (enhancement) ← 関連あり？
           重複: なし

         → 新規 Issue を作成します。

         タイトル: 検索結果にページネーションを追加
         ラベル:   enhancement
         本文:
           ## 概要
           検索結果を20件ずつページ分割し、ナビゲーションを追加する。

           ## 受け入れ条件
           - [ ] 検索結果が20件ずつ表示される
           - [ ] 次へ/前へボタンが動作する
           - [ ] URLにページ番号が含まれる

         作成してよいですか？

あなた:  OK

Claude:  Issue #42 を作成しました。
         https://github.com/owner/repo/issues/42

         /issue-flow #42 で開発を開始しますか？
```

重複が見つかった場合:

```
Claude:  ■ 既存 Issue 確認結果
           重複: #38 検索機能の改善 — ページネーションの要件を含む

         既存 Issue #38 で進めますか？ それとも新規作成しますか？

あなた:  #38 で進めて
Claude:  /issue-flow #38 を開始します。
```

### 新規プロジェクトの場合

空リポジトリで `/issue-create` を実行すると、プロジェクト初期セットアップから開始:

```
あなた:  /issue-create REST API でユーザー管理機能を作りたい

Claude:  ■ プロジェクト状態判定
           プロジェクト定義ファイル: なし
           ソースディレクトリ:      なし
           追跡ファイル数:          2

         → 新規プロジェクトと判定しました。
           初期セットアップを行いますか？

あなた:  はい

Claude:  ■ 要件分析
           機能要件: ユーザーCRUD、認証・認可、ロール管理
           非機能要件: DB必須、トークン管理、パスワードハッシュ化

         ■ 設計方針
           1. DB必須 → RDB推奨（ユーザーデータは関係性が強い）
           2. 認証必要 → JWT or セッション方式
           3. CRUD中心 → シンプルなHTTPフレームワークで十分

         言語やフレームワークに好みはありますか？
         [おまかせで進める] / [好みを指定する]

あなた:  TypeScript で

Claude:  ■ 技術スタック提案 (WebSearch で最新情報を調査)
           言語:          TypeScript 5.x
           ランタイム:     Node.js 22 LTS
           フレームワーク:  Hono v4
           DB:            Docker+PostgreSQL
           認証:           JWT
           テスト:         Vitest
           リンター:       Biome
           CI/CD:         GitHub Actions

         設計方針との対応:
           DB必須 → PostgreSQL / 認証 → JWT / CRUD中心 → Hono

         この構成で進めますか？

あなた:  Hono ではなく Express で

Claude:  フレームワークを Express に変更しました。
         この構成で進めますか？

あなた:  OK

Claude:  ■ プロジェクト雛形を生成しました (15件)
           package.json, tsconfig.json, biome.json, ...
         初期コミットしてよいですか？

あなた:  OK

Claude:  ■ 初期セットアップ完了
           コミット: chore: プロジェクト初期セットアップ
           プッシュ: origin/main

         → Issue 作成に進みます。

         ■ 既存 Issue 確認結果
           オープン: 0件
           重複: なし

         タイトル: ユーザー管理 REST API を実装
         ラベル:   enhancement
         ...

         作成してよいですか？

あなた:  OK

Claude:  Issue #1 を作成しました。
         /issue-flow #1 で開発を開始しますか？
```

### Step 1〜: Issue から全自動で開発

```
あなた:  /issue-flow #42
Claude:  （分析+計画）この方針で実装してよいですか？
あなた:  OK
Claude:  （TDD実装 → レビュー）コミット・PR作成してよいですか？
あなた:  コミットして
Claude:  PR #55 を作成しました → https://github.com/.../pull/55
```

### まとめ: 全体の流れ（実行スキル付き）

```
スキル                  やること                  あなたの入力
─────────────────────────────────────────────────────────────
/issue-create           3並列事前チェック → Issue作成 「ページネーション追加したい」
                        ↓
/issue-flow #42         Phase 1: 分析+計画          「OK」
                        Phase 2: /tdd 実装          (自動)
                        Phase 2: /build-fix         (エラー時のみ自動)
                        Phase 3: /code-review       (自動)
                        Phase 4: デリバリー          「コミットして」
                        ↓
                        PR完成 → マージで Issue 自動クローズ
```

---

## 2. 途中で中断した場合（セッション復旧）

トークンリミットで会話が途切れても、Issue コメントに自動追記された進捗チェックポイントから続きを再開できます。

### 自動で再開

```
あなた:  /issue-flow #42

Claude:  ■ 前回の進捗を検出しました

           Issue:      #42 検索結果にページネーションを追加
           ブランチ:    feat/#42-search-pagination
           完了済み:    Phase 1（分析+計画）
           中断地点:    Phase 2（実装）- GREEN ステップ途中
           変更ファイル: 5件

           続きから再開しますか？
           [続きから再開]  [最初から]

あなた:  続きから
Claude:  （Phase 2 の途中から再開 → 以降は通常フロー）
```

### 仕組み

1. **チェックポイント自動追記**: 各 Phase 完了時に `gh issue comment` で進捗を Issue に追記
2. **Phase 2 は細粒度**: TDD サイクル（RED/GREEN/REFACTOR）の区切りごとに追記
3. **再開検出**: `/issue-flow` 実行時に Issue コメントの `<!-- CLAUDE_PROGRESS -->` マーカーを検索
4. **スキップ**: 完了済み Phase を自動スキップし、中断地点から継続

### 手動で再開（チェックポイントがない場合）

チェックポイントがない場合や、特定の Phase から手動で再開したい場合:

```
あなた:  /issue-flow #42
Claude:  （Phase 1 からの通常開始を提示）

あなた:  Phase 1 は完了済み。ブランチ feat/#42-search-pagination で
         Phase 2 の途中。API の offset/limit は実装済み。
         Pagination コンポーネントの実装から再開して。
```

### Issue コメントの例

各チェックポイントは以下のような形式で Issue に追記されます:

```markdown
<!-- CLAUDE_PROGRESS -->
## 進捗チェックポイント

**Phase**: 2 (実装)
**ステータス**: IN_PROGRESS
**ブランチ**: feat/#42-search-pagination

### 完了済み Phase
- [x] Phase 1: 分析+計画
- [ ] Phase 2: 実装 (進行中)
...

### 次のアクション
Pagination コンポーネントの GREEN ステップから再開
```

---

## 3. 既存 Issue から始める場合

### Issue がすでにある場合

```
あなた:  /issue-flow #42
```

あとは2回 `OK` するだけ。

### Issue 番号がわからない場合

```
あなた:  gh issue list
Claude:  #42 検索にページネーション追加 (enhancement)
         #43 ログインエラー修正 (bug)
         #44 API ドキュメント更新 (documentation)

あなた:  /issue-flow #42
```

### 途中から手動で進める場合

```
あなた:  /plan                     ← 計画だけ立てたい
あなた:  /tdd                      ← TDD実装だけしたい
あなた:  /code-review              ← レビューだけしたい
あなた:  /build-fix                ← ビルドが壊れた
あなた:  /e2e                      ← E2Eテストだけ実行したい
```

### Issue の種類別

```
■ 新機能（複雑）
あなた:  /issue-flow #42
         → Phase 1 で詳細な計画が出る → 確認して OK

■ バグ修正
あなた:  /issue-flow #99
         → Phase 2 で再現テスト → 修正 → 回帰テスト

■ ドキュメント更新
あなた:  /issue-flow #120
         → Phase 2 は直接編集（TDDスキップ）

■ リファクタリング
あなた:  /issue-flow #88
         → Phase 1 で影響範囲分析 → 計画重視
```

---

## 4. 確認ポイントでの指示例

### 確認① 分析+計画提示後

```
■ そのまま進める場合:
あなた:  OK

■ 要件を追加する場合:
あなた:  OK、ただし「ページ番号をURLに含める」も追加して

■ 要件が違う場合:
あなた:  違う。ページネーションではなく無限スクロールで実装して

■ スコープを絞る場合:
あなた:  まず API だけ先に実装して。UIは別 Issue にする

■ アプローチを変える場合:
あなた:  別のアプローチで。Server Component で実装して
```

### 確認② レビュー後

```
■ そのまま進める場合:
あなた:  コミットして

■ 問題を修正する場合:
あなた:  MEDIUM の問題も修正してから再レビューして

■ テストを追加する場合:
あなた:  エッジケースのテストを追加してから再レビューして

■ E2E テストも実行する場合:
あなた:  /e2e も実行してからコミットして
```

---

## 5. よく使う指示フレーズ集

### 開始

```
/issue-create ページネーション追加     Issue 新規作成（要件は必須）
/issue-flow #42                       既存 Issue から全自動
/issue-flow                           Issue 一覧から選択
gh issue list                         Issue 一覧を表示
```

### 途中介入

```
ここまでの変更を見せて              git diff を確認
テストだけ実行して                  npm test
ビルドして                         npm run build
一旦コミットして                    途中コミット
```

### やり直し

```
最後の変更を取り消して              git checkout -- <file>
この方針でやり直して                再計画
テストが失敗してる。修正して         テスト修正
```

### 完了操作

```
コミットして                        git add + commit
プッシュして                        git push
PR 作成して                        gh pr create
マージして                         gh pr merge --squash
```

---

## 6. 全体フロー図（実行スキル・エージェント対応）

```
実行スキル              Phase              エージェント
──────────────────────────────────────────────────────────────

/issue-create           Issue作成           (gh CLI, WebSearch, tech-selector)
                        ├─ ★ 3並列事前チェック ★
                        │  ├─ GitHub状態確認
                        │  ├─ プロジェクト判定
                        │  └─ 重複確認
                        ├─ 新規の場合:
                        │  ├─ 要件分析・設計方針
                        │  ├─ 技術スタック提案 (WebSearch)
                        │  ├─ プロジェクト雛形生成
                        │  └─ 初期コミット
                        ├─ 技術方針セレクター (tech-selector)
                        └─ gh issue create
                        │
                        ▼
/issue-flow #42 ─────── Phase 1: 分析+計画 ── ★ 3並列 → 直列 ★
                        ├─ issue-analyzer      Issue取得・要件抽出
                        ├─ Explore             コードベース調査
                        └─ planner             実装フェーズ分解
                        ▼ architect-reviewer   アーキテクチャ適合性
                        ▼ ユーザー確認① 「OK」
                        │
  /tdd ──────────────── Phase 2: 実装
                        ├─ git checkout -b feat/#42-xxx
                        └─ tdd-guide           RED → GREEN → REFACTOR
                        │
  /build-fix ────────── (エラー時のみ)
                        └─ build-error-resolver
                        │
  /code-review ──────── Phase 3: レビュー ─ ★ 最大5並列 ★
                        ├─ code-quality-reviewer  品質・構造・命名
                        ├─ security-reviewer      セキュリティ脆弱性
                        ├─ test-verifier          テスト・カバレッジ 80%
                        ├─ database-reviewer      DB変更（該当時のみ）
                        └─ refactor-checker       不要コード・重複
                        ▼ ユーザー確認② 「コミットして」
                        │
  (issue-flow内) ────── Phase 4: デリバリー
                        ├─ doc-updater            README・API docs
                        ├─ git commit
                        └─ pr-creator             push + PR (Closes #42)
                        ▼ 完了
```

**ポイント:** `/issue-flow` が `/plan` `/tdd` `/build-fix` `/code-review` を内部で自動実行する。
個別スキルとしても単独で使える。

---

## 7. 実際の会話例

### Phase 1: 分析+計画

```
あなた:  /issue-flow #42
```

```
Claude Code:
  ■ Issue #42 分析結果
    タイトル: 検索結果にページネーションを追加
    ラベル:   enhancement
    ブランチ: feat/#42-search-pagination
    複雑度:   中

  ■ 要件
    - 検索結果を20件ずつ分割
    - 次へ/前へボタン表示
    - URLにページ番号含める

  ■ 関連ファイル
    - src/pages/search.tsx
    - src/api/search.ts

  ■ 実装計画（3ステップ）
    1. API修正: search.ts に offset/limit 追加
    2. コンポーネント: Pagination.tsx 新規作成
    3. 統合: search.tsx にページネーション統合

  ■ アーキテクチャ適合性: PASS

  この方針で実装してよいですか？
```

```
あなた:  OK
```

### Phase 2: TDD 実装

```
Claude Code:
  git checkout -b feat/#42-search-pagination

  [TDD サイクル]
    RED:      search.test.ts → 3件失敗 ✗
    GREEN:    search.ts 実装  → 3件成功 ✓
    REFACTOR: 共通ロジック抽出 → 3件成功 ✓

    RED:      Pagination.test.tsx → 5件失敗 ✗
    GREEN:    Pagination.tsx 実装  → 5件成功 ✓
```

### Phase 3: レビュー

```
Claude Code:
  ■ 統合レビュー結果

    品質:       PASS  (CRITICAL=0, HIGH=0, MEDIUM=1)
    セキュリティ: SECURE
    テスト:      PASS  (カバレッジ 87%)
    DB:         SKIP  (DB変更なし)
    不要コード:  CLEAN

    総合判定: APPROVE

  コミット・PR作成してよいですか？
```

```
あなた:  コミットして
```

### Phase 4: デリバリー

```
Claude Code:
  ■ ドキュメント更新
    README.md → ページネーション機能の説明追加

  ■ 完了レポート
    Issue:    #42
    ブランチ: feat/#42-search-pagination
    PR:       #55 https://github.com/owner/repo/pull/55
    CI:       pending
    マージ時: Issue #42 自動クローズ
```

---

## 8. トラブルシューティング

### レビューで FAIL が出た

```
Claude Code:  総合判定: REQUEST_CHANGES
              CRITICAL: security-reviewer が XSS 脆弱性を検出

あなた:  修正して再レビューして
```

Claude Code が修正 → 再度 Phase 3 を並列実行。

### ビルドが通らない

```
あなた:  /build-fix
```

build-error-resolver が1つずつエラーを修正。

### テストが失敗する

```
あなた:  テストが失敗してる。修正して
```

tdd-guide がテスト or 実装を修正。

### 途中で方針を変えたい

```
あなた:  一旦止めて。Server Component ではなく Client Component で実装し直して
```

Claude Code が Phase 2 からやり直す。

### トークンリミットで中断された

```
（新しいセッションで）
あなた:  /issue-flow #42
Claude:  ■ 前回の進捗を検出しました
         ...
         続きから再開しますか？

あなた:  続きから
```

Issue コメントにチェックポイントが自動追記されているので、同じ `/issue-flow #42` を実行するだけで続きから再開される。

### Issue のスコープが大きすぎる

```
Claude Code:  複雑度: 高。サブ Issue への分割を推奨します。

あなた:  3つの Issue に分割して
```

Claude Code が `gh issue create` で3つの Issue を作成。

---

## 9. スキル一覧（8つ）

| スキル | 実行コマンド | 機能 | 呼び出すエージェント |
|--------|-------------|------|---------------------|
| **issue-create** | `/issue-create 説明` | 3並列事前チェック→新規PJセットアップ→技術方針→Issue作成 | (gh CLI, WebSearch, tech-selector) |
| **issue-flow** | `/issue-flow #N` | 全4フェーズ自動実行 | 全13体 |
| **plan** | `/plan` | 実装計画（2並列） | planner + architect-reviewer |
| **tdd** | `/tdd` | TDD実装 | tdd-guide |
| **code-review** | `/code-review` | 並列レビュー（最大5並列） | 品質+セキュリティ+テスト+DB+不要コード |
| **build-fix** | `/build-fix` | ビルドエラー修正 | build-error-resolver |
| **e2e** | `/e2e` | E2Eテスト | e2e-runner |
| **orchestrate** | `/orchestrate タスク` | 大規模並列の起動（判断→計画→承認→Workflow実行→検証→復帰）★Claude専用。組み込み `/workflows`（実行監視）とは別物 | Workflow（最大16同時・累計約1000） |

`/issue-flow` は内部で `/plan` `/tdd` `/build-fix` `/code-review` を自動的に呼び出す。
各スキルは単独でも実行できる。`/orchestrate` は大規模タスク専用（下記「Workflow」節参照）。

---

## 10. サブエージェント一覧（14体）


### カスタムエージェント（10体）

| エージェント | 役割 | モデル | Phase | 並列 |
|-------------|------|--------|-------|------|
| issue-analyzer | Issue分析・要件抽出 | haiku | 1 | Yes |
| tech-selector | 技術的決定ポイント特定・選択肢提案 | sonnet | 0 | No |
| architect-reviewer | アーキテクチャ適合性 | haiku | 1 | No |
| code-quality-reviewer | コード品質レビュー | sonnet | 3 | Yes |
| security-reviewer | セキュリティ検出 | haiku | 3 | Yes |
| test-verifier | テスト・カバレッジ | haiku | 3 | Yes |
| database-reviewer | DB変更レビュー | haiku | 3 | Yes |
| refactor-checker | 不要コード検出 | haiku | 3 | Yes |
| doc-updater | ドキュメント更新 | sonnet | 4 | No |
| pr-creator | PR作成・プッシュ | sonnet | 4 | No |

### ビルトインエージェント（4体）

| エージェント | 役割 | Phase |
|-------------|------|-------|
| Explore | コードベース探索 | 1 |
| planner | 実装計画策定 | 1 |
| tdd-guide | TDD実装 | 2 |
| build-error-resolver | ビルド修正 | 2 |

---

## 11. 並列実行ポイント（2箇所）

```
Phase 1:  issue-analyzer + Explore + planner    = 3並列 → architect-reviewer
Phase 3:  code-quality + security + test        = 最大5並列
          + database + refactor
```

順次実行なら9回待つところを、並列実行で2回に短縮。

---

## 12. フォルダ構成

```
.claude/
├── README.md                            ← このファイル
├── agents/ (10)
│   ├── issue-analyzer.md                Phase 1: Issue分析 (haiku)
│   ├── tech-selector.md                 issue-create: 技術方針セレクター (sonnet)
│   ├── architect-reviewer.md            Phase 1: アーキテクチャ (haiku)
│   ├── code-quality-reviewer.md         Phase 3: 品質 (sonnet)
│   ├── security-reviewer.md             Phase 3: セキュリティ (haiku)
│   ├── test-verifier.md                 Phase 3: テスト (haiku)
│   ├── database-reviewer.md             Phase 3: DB (haiku)
│   ├── refactor-checker.md              Phase 3: 不要コード (haiku)
│   ├── doc-updater.md                   Phase 4: ドキュメント (sonnet)
│   └── pr-creator.md                    Phase 4: PR作成 (sonnet)
├── rules/ (5)
│   ├── coding-style.md                  イミュータビリティ・ファイル構成
│   ├── database.md                      DB選択・マイグレーション
│   ├── git-workflow.md                  ブランチ命名・コミット・PR規約
│   ├── progress-tracking.md             進捗追記・セッション復旧
│   ├── security.md                      セキュリティチェックリスト
│   └── ui-design.md                     画面構成・遷移設計
└── skills/ (7)
    ├── issue-create/SKILL.md            /issue-create 3並列事前チェック+重複確認+Issue作成
    ├── issue-flow/SKILL.md              /issue-flow 全4フェーズ
    ├── plan/SKILL.md                    /plan 計画（2並列）
    ├── tdd/SKILL.md                     /tdd テスト駆動開発
    ├── code-review/SKILL.md             /code-review 最大5並列レビュー
    ├── build-fix/SKILL.md               /build-fix ビルド修正
    └── e2e/SKILL.md                     /e2e E2Eテスト
```

---

## 13. Git 規約（自動適用）

```
ブランチ:  feat/#42-search-pagination
コミット:  feat(#42): 検索結果のページネーションを追加
PR本文:    Closes #42  ← マージ時にIssue自動クローズ
マージ:    Squash merge 推奨
```

---

## 14. 前提条件

```bash
gh auth status        # GitHub CLI 認証済み
npm test              # テスト実行可能
```

**新規プロジェクトの場合:**
- `/issue-create` 実行時に空リポジトリを検出すると、技術スタック提案のために **WebSearch** を使用します
- GitHub リモートが設定済み・認証済みであることが必要です（`git remote add origin` + `gh auth login`）

---

## 15. Workflow（大規模並列・Claude 専用）

大規模リファクタ・マイグレーション・全体監査・包括テスト生成など **1 回のパスでは大きすぎるタスク** を、
Claude Code の **Workflow** 機能で並列実行する。基本思想は **「頭脳と品質管理＝ハーネス / 大規模並列の手足＝Workflow」**。
詳細ルールは `rules/workflow-orchestration.md`、起動は `/orchestrate`（`skills/orchestrate/SKILL.md`）。組み込み `/workflows`（実行中 Workflow の監視・一覧）とは別物。

> Workflow は Claude Code 専用機能のため、`workflows/`・`rules/workflow-orchestration.md`・`skills/orchestrate/` は
> claudecode 側のみ（Cursor へは非同期）。

### ハイブリッド7ステップ（誰が担当か）

| ステップ | 担当 | 使うもの |
|---|---|---|
| 1. タスク判断（Workflow 向きか） | ハーネス | `rules/workflow-orchestration.md` の判定基準 |
| 2. 事前分析・計画 | ハーネス | plan モード / `/plan` |
| 3. Workflow 起動指示 | ハーネス | `/orchestrate` スキル（authorize 役） |
| 4. プラン生成→レビュー | Workflow生成 → ハーネス確認 | Workflow + ExitPlanMode |
| 5. 大規模並列実行 | **Workflow** | `workflows/*.js` or 動的生成 |
| 6. 最終検証・品質保証 | ハーネス | `/code-review`・テスト |
| 7. 永続化＋復帰 | ハーネス | progress + 復帰 |

### いつ使うか（判定基準）

変更/対象ファイル **概ね 50 以上** / **複数モジュール横断** / 大規模マイグレーション / サービス全体リファクタ /
**数十以上の独立サブタスク** / 包括テスト生成。**これ未満は従来の `/code-review` `/issue-flow` `/fix-impl` の並列のまま**（軽量・低コスト）。

ハーネスがタスク内容から自動判断し、向いていれば **確認のうえ提案**（起動の最終判断はユーザー）。

### 2つの確認ポイント

- **① 起動前**: 「Workflow を使うか / 従来の並列で進めるか」を推奨第1候補つきで確認。
- **② 復帰前**: 「実行前の状態へ戻すか」を確認してから復帰（消費抑制）。

### 実行後の復帰（クリーンアップ）

| 対象 | 戻し方 | 実行者 |
|------|--------|--------|
| ultracode | `/effort high`（新セッションで自動リセット） | ユーザーが入力（Claude からは直接実行不可） |
| 一時 worktree | `.claude/worktrees/` 掃除 | Claude が自動実行 |
| fast / Workflow無効化 | settings.json `fastMode` / `disableWorkflows` | 必要時に `update-config` |

### 定義済み Workflow

| 名前 | 用途 |
|------|------|
| `review-changes` | 多次元レビュー（品質/セキュリティ/テスト/DB/不要コード）＋各指摘の敵対的検証。大規模 diff 向け。`/orchestrate review-changes` または `/code-review`・`/issue-flow` Phase 3 から委譲。 |
