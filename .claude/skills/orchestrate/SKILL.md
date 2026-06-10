---
name: orchestrate
description: 大規模並列タスク（大規模リファクタ・マイグレーション・全体監査・包括テスト生成など）を Claude Code の Workflow 機能で実行する。ハーネスが判断・計画・最終検証・永続化・復帰を担い、Workflow が大規模並列実行だけを担う正規経路。組み込みの /workflows（実行監視）とは別物。
argument-hint: "[タスク説明 | 定義済みworkflow名]"
---

# Orchestrate スキル（大規模並列の起動・正規経路）

**このスキルは、acode で Claude Code の Workflow ツールを呼ぶことを authorize する唯一の正規経路。**
役割分担と判定基準・復帰仕様の本文は `.claude/rules/workflow-orchestration.md` に従う（本スキルはその実行手順）。

基本思想: **頭脳と品質管理＝ハーネス／大規模並列の手足＝Workflow**。
Workflow に任せるのは Phase 3 の大規模並列実行だけ。判断・計画・レビュー・永続化・復帰はこのスキル（ハーネス）が持つ。

## 使い方

```
/orchestrate <タスク説明>        # 例: /orchestrate 全 API ハンドラを新しいエラー型に移行
/orchestrate review-changes      # 定義済み workflow を名前で起動（レビューを大規模並列で）
```

> 組み込みの `/workflows`（実行中 Workflow の監視・一覧）とは別物。起動はこの `/orchestrate`、監視は `/workflows`。

## 全体像

```
Phase 0: 判断（ハーネス）       Workflow 向きか判定 → 未満なら従来スキルへ差し戻し
   ↓
Phase 1: 計画（ハーネス/plan）   scope・成功基準・制約・停止条件・expected output を分解
   ↓
Phase 2: 承認（ハーネス）        確認ポイント① ─ ExitPlanMode で起動承認
   ↓
Phase 3: 実行（Workflow）        ★ここで Workflow ツールを呼ぶ（authorize 済み）★
   ↓
Phase 4: 最終検証（ハーネス）    /code-review・テスト実行
   ↓
Phase 5: 永続化＋復帰（ハーネス） progress 追記 → 確認ポイント② ─ 復帰
```

## Phase 0: 判断（ハーネス）

`.claude/rules/workflow-orchestration.md` の**判定基準**に照らして、本当に Workflow 向きか確認する。

- 該当しない（変更ファイル少・単一モジュール・独立サブタスクが少数）→ **Workflow を使わず差し戻す**。
  「このタスクは従来の `/code-review` / `/issue-flow` / `/fix-impl` の並列で十分です（軽量・低コスト）」と案内して終了。
- 該当する → Phase 1 へ。

## Phase 1: 計画（ハーネス・plan モード）

`EnterPlanMode` で読み取り専用化し、以下を分解する（`/plan` を流用してよい）:

- **scope**: 対象範囲（ディレクトリ・モジュール・ファイル群）。まずはサブディレクトリ/単一モジュールに絞れないか検討。
- **成功基準 / "完了" の定義**: 何をもって完了とするか。
- **制約**: コーディング規約（`coding-style.md`）、`.github/**` 自動生成禁止ゲート（`ci-release.md`）、cgc impact 確認（`mcp-tools.md`）など、Workflow 内のエージェントにも引き継ぐ規約。
- **停止条件**: loop-until-dry の打ち切り、トークン予算（`budget.total` ガード）。
- **expected output**: 構造化出力スキーマ・最終成果物の形。
- **オーケストレーション方針**: 定義済み `workflows/*.js` を名前で呼ぶか、その場で動的生成するか。サブエージェントの役割分担・検証ループ（implementor→verifier→fixer / 敵対的検証）・モデルルーティング。

## Phase 2: 承認（ハーネス）— 確認ポイント①

オーケストレーション方針をユーザーに提示し、`ExitPlanMode` で**起動承認**を取る。

提示の直前に**目的＋現在地**を添える（`decision-presentation.md`）。例:

```
目的：<タスク>を大規模並列で完遂すること
現在地：判断 → 計画 → 承認（現在地） → 並列実行 → 検証 → 復帰
```

承認されなければ起動しない。

> **ultracode 下は例外（★検証済み）**: ultracode は standing opt-in そのものがゴーサインに相当するため、① の承認往復を省いて直接起動してよい（省いても fan-out・エージェント数は減らない＝能力低下なし。実測 28–31 並列が ① なしで完走）。そのぶん安全弁は Phase 3 の予算ガードと Phase 5 の復帰②に寄る。承認往復を ultracode でも必ず効かせたいときは `/effort high` で起動する。詳細は `.claude/rules/workflow-orchestration.md`「2つの確認ポイント」参照。

## Phase 3: 実行（Workflow）★authorize ポイント★

**承認後、ここで Workflow ツールを呼んでよい（このスキルが Workflow 呼び出しを authorize する）。**

- 高頻度パターンは定義済みスクリプトを名前で起動: `{name: "review-changes"}`（`.claude/workflows/` 配下）。
- 新規の大規模タスクは動的生成: `{script: "<生成した meta+本文>"}`。`pipeline()` を既定にし、全件横断の集約が要るときだけ `parallel()` のバリアを使う。
- モデルは原則セッション継承。探索=haiku / 合成・検証=opus の上書きは明確な場合のみ。
- 並列でファイルを書き換えるなら `isolation: 'worktree'`。
- 動的ループは `while (budget.total && budget.remaining() > N)` で予算ガード。

実行中の進捗は `/workflows` で監視できる。中断後は `resumeFromRunId` で再開可能（同一スクリプト・同一 args なら完了分はキャッシュ）。

## Phase 4: 最終検証（ハーネス）

Workflow が一次統合した結果を、ハーネスの品質ゲートにかける:

- テスト実行（プロジェクトのテストコマンド）
- `/code-review`（必要なら再び大規模なら `review-changes` workflow に委譲）
- 規約違反（coding-style / security / ci-release ゲート）の最終チェック

問題があれば修正指示。小規模な手直しなら通常のハーネスループで、再び大規模なら Workflow を再利用してよい。

## Phase 5: 永続化＋復帰（ハーネス）

1. **永続化**: 重要な変更・決定事項・残タスクを `progress-tracking.md` のチェックポイント形式で記録（Issue 連動タスクなら Issue コメントへ）。Workflow の監査要約（生成スクリプト・反論内容・落としたもの）も残す。
2. **復帰（確認ポイント②）**: `AskUserQuestion` で「実行前の状態へ戻すか」を確認してから:
   - **ultracode 解除**: `/effort high` を打つようユーザーに案内（Claude からは直接実行不可。新セッションでも自動リセットされる旨も伝える）。
   - **一時 worktree 掃除**: `.claude/worktrees/` 配下を `git worktree unlock`→`--force` の2段で片付け（Claude が自動実行）。
   - 必要なら settings.json（`fastMode` / `disableWorkflows`）を `update-config` 経由で戻す。

   詳細は `.claude/rules/workflow-orchestration.md`「復帰」節を参照。

## 他スキルとの連携

Workflow の才能が最も活きるのは**バッチ入口**（独立サブタスクが多数ある入口）。委譲フックは**定義済み workflow を名前で起動**する（その場の動的生成は最後の手段）。優先度順:

| 入口 | 委譲先（`.claude/workflows/`） | 起動 | 渡す args |
|------|------------------------------|------|----------|
| **`/fix-impl`（最優先）** | `fix-batch` | `/orchestrate fix-batch` | `{issues:[{number,title,files,body}], base}` |
| **`/issue-flow --all-open`** | `issue-batch` | `/orchestrate issue-batch` | `{issues:[{number,title,body}], base}` |
| **`/code-review`・Phase 3（大規模 diff）** | `review-changes` | `/orchestrate review-changes` | `{base, refuters}` |
| **「網羅的に監査」級（diff）** | `exhaustive-review` | `/orchestrate exhaustive-review` | `{scope:"diff", base, dryRounds, refuters, maxRounds}` |
| **リポジトリ全体監査（diff 非依存）** | `exhaustive-review` | `/orchestrate exhaustive-review` | `{scope:"all"\|"<path>", dryRounds, refuters, maxRounds}` |
| **`/e2e` 包括 E2E 生成（≥10 フロー）** | 動的生成（定義済みなし） | `/orchestrate <フロー一覧>` | フローごとに spec 生成→実行検証の `pipeline()` |

- **巨大マイグレーション等（Issue 不要・定義済みに合致しない）**: `/orchestrate <タスク説明>` で**直接起動**し、その場で動的スクリプトを生成する。`/issue-flow` Phase 2 の単一実装には自動委譲フックを置かない（巨大単一 Issue は分解 or 本スキル直接起動で扱う）。
- 上記いずれの閾値も未満なら本スキルを使わず従来スキルのまま（軽量・低コスト）。

> 閾値の定義は `.claude/rules/workflow-orchestration.md`「判定基準」が単一ソース。
