# 進捗追記 & セッション復旧

## 基本原則

**トークンリミットで会話が途切れても、Issue コメントから続きを再開できるようにする。**

各 Phase の完了時・実装の区切りごとに、対象 Issue へコンパクトなチェックポイントコメントを追記する。
新しいセッションで `/issue-flow` を実行した際、最新のチェックポイントを読み取り、完了済み Phase をスキップして途中から再開する。

## チェックポイント形式（コンパクト）

HTML コメントにメタデータ、本文は4行以内。`<!-- CLAUDE_PROGRESS -->` マーカーで機械的に検出可能にする。

```markdown
<!-- CLAUDE_PROGRESS phase=N status=STATUS branch=BRANCH -->
completed: 1 | current: 2 | next: Phase 2 実装
files: src/types.ts, src/config.ts
context: offset/limit方式, Server Component
```

### フィールド説明

| フィールド | 説明 | 例 |
|-----------|------|-----|
| `phase` | 現在の Phase 番号 | `1`, `2`, `3`, `4` |
| `status` | COMPLETED / IN_PROGRESS | `COMPLETED` |
| `branch` | ブランチ名 | `feat/#42-pagination` |
| `completed` | 完了済み Phase 番号 | `1,2` |
| `current` / `next` | 現在実行中 or 次の Phase | `Phase 2 実装` |
| `files` | 変更済みファイル一覧 | `src/types.ts, src/config.ts` |
| `context` | 技術判断・ユーザー指示の要約 | `offset/limit, Server Component` |

### Phase 2（実装）の追加フィールド

Phase 2 はトークン消費が最も大きいため、レベル進捗を追加:

```markdown
<!-- CLAUDE_PROGRESS phase=2 status=IN_PROGRESS branch=feat/#42-pagination -->
completed: 1 | current: 2 | levels: L0✓ L1✓ L2…
files: src/types.ts, src/lib/csv-parser.ts
context: 並列実行モード, Level 0-1 完了
```

| フィールド | 説明 | 例 |
|-----------|------|-----|
| `levels` | レベル別進捗 | `L0✓ L1✓ L2… L3` |

## Phase 一覧（4フェーズ）

```
Phase 1: 分析+計画  (issue-analyzer + Explore + planner: 3並列 → architect-reviewer)
Phase 2: 実装      (TDD: レベル別並列実行)
Phase 3: レビュー   (最大5エージェント並列)
Phase 4: デリバリー  (doc-updater → commit → PR作成)
```

## 追記タイミング

| タイミング | 追記内容 |
|-----------|---------|
| Phase 1 完了後 | 分析結果要約、計画概要、ブランチ名 |
| Phase 2 途中（レベル完了時） | 完了ステップ/ファイル、レベル進捗 |
| Phase 2 完了後 | 全実装ファイル一覧、テスト結果 |
| Phase 3 完了後 | レビュー結果サマリー（PASS/FAIL） |
| Phase 4 完了後 | コミットハッシュ、PR URL |

## Phase 2 の細粒度チェックポイント

Phase 2（実装）はトークン消費が最も大きいため、レベル完了ごとに追記する。

### 並列実行モード（依存グラフあり）

追記タイミング:
1. ブランチ作成直後（実行戦略を記録）
2. 各レベル完了時（完了ステップ・ファイル・テスト結果）
3. Phase 2 全体完了時

### フォールバックモード（依存グラフなし）

追記タイミング:
1. ブランチ作成直後
2. 各機能の TDD サイクル（RED→GREEN→REFACTOR）完了時
3. Phase 2 全体完了時

### 再開時のレベル判定

| チェックポイントの状態 | 再開ポイント |
|---------------------|------------|
| Level N まで完了 | Level N+1 から再開 |
| Level N 途中 | Level N の未完了ステップから再開 |
| 実行戦略が記録されていない | フォールバックモードで再開 |

## 再開検出プロトコル

`/issue-flow #<number>` の実行開始時:

1. `gh issue view --json comments -q '.comments | length'` でコメント数確認
2. **0件 → Phase 1 へ即スキップ（検索不要）**
3. コメントがある場合のみ `<!-- CLAUDE_PROGRESS -->` マーカーを検索
4. マーカーが見つかった場合:
   - `phase`, `status`, `branch`, `context` を解析
   - 完了済み Phase をスキップ
   - IN_PROGRESS の Phase から再開ポイントを特定
   - ユーザーに再開確認を表示
5. マーカーが見つからない場合: Phase 1 から開始
6. `phase=1 COMPLETED` 以降を再開する場合、`<!-- CLAUDE_PLAN -->` マーカー（Phase 1 完了時に別コメントで永続化した依存グラフのスナップショット）も読む。あれば依存グラフを復元して **Phase 1 を完全スキップ**、なければ planner のみ再実行して再生成する。`CLAUDE_PLAN` は `CLAUDE_PROGRESS`（本文4行以内）とは別マーカー・別コメントのため、4行制約の対象外。

### ブランチ復元

```bash
git branch --list <branch-name>                          # ローカル確認
git fetch origin && git checkout -b <branch> origin/<branch>  # リモートから取得
# リモートにもない場合 → Phase 2 からやり直し
```

## コンテキストの記載事項

`context` フィールドには、新しいセッションで判断に迷わないよう以下を記録する:

| 項目 | 例 |
|------|-----|
| ユーザーの明示的な指示 | `Hono指定, Express不可` |
| 技術的な判断 | `TanStack Query選択(キャッシュ無効化容易)` |
| 計画からの変更点 | `認証部分を別Issue分離` |
| 既知の問題 | `search.tsにバグあり要先行修正` |

## 注意事項

- チェックポイントコメントは **追記のみ**。過去のコメントを編集・削除しない
- 複数チェックポイントがある場合、**最新のもの** を参照
- 機密情報（APIキー等）は含めない
- Phase 4 完了後のチェックポイントには PR URL を含め、ワークフロー完了を明示する

## チェックリスト

- [ ] 各 Phase 完了時にチェックポイントが追記されている
- [ ] Phase 2 ではレベル完了ごとに追記されている
- [ ] `<!-- CLAUDE_PROGRESS -->` マーカーが含まれている
- [ ] ブランチ名が正しく記録されている
- [ ] 次のアクションが記載されている
- [ ] コンテキストにユーザーの指示・判断事項が記録されている
- [ ] 機密情報が含まれていない
