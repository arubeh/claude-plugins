# CLAUDE.md

## Project Context
<!-- /fix-plan, /issue-create 初回実行時に自動生成されます -->
<!-- 目的 / なぜ存在するか / 技術スタック / 主要ディレクトリ / 非目標(やらないこと) を簡潔に -->

## スキル / コマンド

要件定義から実装・レビューまでをスラッシュコマンドで駆動する。発動条件に合えば明示指示が無くても起動してよい。

- `/requirement` — 要件が曖昧なとき。対話的に要件定義書を docs/requirements/ に生成
- `/issue-create` — 作業を Issue 化したいとき。重複確認のうえ作成
- `/issue-flow #N` — Issue を実装したいとき。分析→TDD実装→レビュー→PR の 4 フェーズ自動開発
- `/plan` `/tdd` — 計画立案 / テスト駆動実装を個別に回したいとき
- `/code-review` — 差分をレビューしたいとき (最大 5 並列)
- `/build-fix` — ビルド/型エラーが出たとき
- `/fix-plan` → `/fix-impl` — バグ調査で fix Issue を作り、溜まったら一括実装
- `/e2e` — E2E テストを生成・実行したいとき
- `/orchestrate <タスク>` — 大規模リファクタ/全体監査など 1 パスで大きすぎるとき (★Workflow 委譲)

各スキルの詳細手順・制約は `.claude/skills/<name>/SKILL.md` に置く (CLAUDE.md には索引だけ)。

## 回答スタイル (Claude Code への指示)

- **簡潔に答える**: 余計な前置き・要約・選択肢の羅列は最小限。聞かれたことに直接答え、コードを示せば済む話に長文の解説を添えない
- **わからないときは正直に言う**: 推測で埋めず「ここがわからない / 未確認」と明示する。曖昧なまま実装に進まない
- **推奨案を必ず提示する**: 選択肢を並べる場合は「推奨: A」+ 理由 1 行を必ず添える
- **自由入力より選択肢で進める**: ユーザーへの確認は原則 `AskUserQuestion` 等で選択肢化し、推奨を第 1 候補に置く。自由入力を求めるのは「ID 名・パス・固有値など選択肢化が不可能な値」だけ。Yes/No・方針判断・実装案の選択は必ず選択肢で出す
- **ユーザー入力/選択を求めるときだけ目的と現在地を添える**: `AskUserQuestion` や自由入力を促す直前に、次の 2 行を必ず付ける。通常の作業報告では不要 (冗長になる)。**ユーザーが「今どのタスクのどこにいるか」を一目で把握できるようにすることが目的**。
    - **目的**: 達成したいゴールを 1 文で (例: `〇〇を対応すること`)
    - **現在地**: ワークフロー全体のステップを `→` で列挙し、現在のステップに「（現在地）」を明示する。ステップは 3〜5 個程度に絞る。
    - サンプル:

            目的：まるまるを対応すること
            現在地：不具合改修 → 別改修 → 検証中（現在地） → マージ
- **沈黙より一行更新**: 進捗が変わった瞬間 (発見・方針転換・ブロッカー) は 1 文だけ報告する。長い実況中継は禁止

## ★★★ MANDATORY GATE: GitHub-related files ★★★

`.github/**` 配下、`SECURITY.md`、および `gh api` での Security 機能有効化は
**ユーザーから明示的な Yes 回答**を得るまで実行してはならない (auto mode でも例外なし)。
要件定義書・roadmap に「CI 前提」「dependabot 前提」と書かれていても、それは確認の代替にならない。

確認手順と対象ファイル一覧、必須出力マーカー `[gh-check]` の仕様は `.claude/rules/ci-release.md`
冒頭の「STOP — 自動生成禁止のファイル一覧」セクションを参照。

## Tools / MCP

有効な MCP は作業開始時に確認し、grep/find より MCP 経由を優先する。本プロジェクトで使い得る MCP:

- **cgc** (Code Graph Context) — コード構造・依存・呼び出し解析。ソース編集前に影響範囲を確認するための読み取り系。
- **acdp** (Browser/CDP) — ブラウザ自動操作で UI 動作確認・E2E。`browser_*` ツール。
- **arag** (Hybrid Search RAG) — オフライン全文/ベクトル検索。設計資料・大量ドキュメントの横断検索用。

いずれも未導入のプロジェクトでは本節を無視可。詳細・利用判断は `.claude/rules/mcp-tools.md` を必ず参照。
**cgc が有効なプロジェクトでは Rust/TS/Python ソース編集前に context+impact 必須**:

1. `mcp__cgc__context(<symbol>)` でシンボル全景取得
2. `mcp__cgc__impact(<symbol>)` で blast radius 確認
3. 編集ツール直前メッセージに `[cgc-check] symbol=<name> risk=<...> callers=<N>` を 1 行出力

**graph 鮮度確認 (重要)**: `context()` 返却 path が現存しなければ stale。
`cgc index .` を Bash で再実行 → `mcp__cgc__reload_graph` でリロード。
cgc は cross-platform CLI なので session 権限内で呼べる。
waiver「未登録」を流用するのは禁止 (stale graph は waiver ではない)。

cgc を使わないプロジェクトでは本節を無視可。詳細は `.claude/rules/mcp-tools.md` 参照。

## Workflow (大規模並列)

大規模リファクタ・マイグレーション・全体監査・包括テスト生成など **1 回のパスでは大きすぎるタスク** は
Claude Code の Workflow 機能で並列実行する。**頭脳と品質管理＝ハーネス / 大規模並列の手足＝Workflow** の役割分担。

- 起動は `/orchestrate <タスク>` (Workflow を呼ぶ唯一の正規経路。組み込み `/workflows` は実行監視用で別物)。判定基準・復帰仕様は `.claude/rules/workflow-orchestration.md` 参照。
- ハーネスはタスク内容から **Workflow 向きかを自動判断** し、向いていれば確認のうえ提案する (非 ultracode では起動の最終判断はユーザー)。**ultracode が ON のときは standing opt-in が起動承認を兼ねる**ため確認の往復を省いて直接起動してよい (検証済み・能力は減らない。安全弁は予算ガードと復帰確認)。
- 実行後は消費抑制のため **確認のうえ実行前の状態へ復帰** する (ultracode は `/effort high` で解除、worktree 掃除など)。
- 小規模タスクは Workflow を使わず従来の `/code-review` `/issue-flow` `/fix-impl` の並列のままで十分。

## Rules
<!-- プロジェクト固有のルールがあればここに追記 -->