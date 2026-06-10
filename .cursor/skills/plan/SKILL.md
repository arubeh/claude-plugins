---
name: plan
description: 実装計画とアーキテクチャ適合性を並列で評価する。コードに触れる前にユーザー確認を待つ。Use when starting a feature, /plan, or user asks for implementation plan.
---

# Plan スキル

実装計画の策定とアーキテクチャ適合性チェックを **並列** で行う。

## 使い方

```
/plan
/plan ユーザー認証機能を追加
```

## 並列実行

- **planner 相当**: 要件分解、リスク評価、フェーズ計画
- **architect-reviewer 相当**: 既存パターンとの整合性、モジュール分割、依存関係の方向

両方の結果を統合して計画を提示し、**ユーザーの承認を得るまでコードを書かない。**

## 実行内容

1. 要件の再確認
2. リスクの特定
3. 段階的計画の作成（フェーズ分解）
4. アーキテクチャ適合性（既存設計との整合性）
5. **確認待ち** — 続行前にユーザー承認必須

## 使用場面

- 新機能開始時・大きなアーキテクチャ変更時・複雑なリファクタリング
- 複数ファイル/コンポーネントが影響する場合
- 要件が不明確な場合

## planner 出力フォーマット: 依存グラフ

実装計画には**依存グラフ**を含めること。各ステップに以下を付与する:

| フィールド | 説明 | 例 |
|-----------|------|-----|
| `step_id` | 一意識別子 | `S0`, `S1`, `S2` |
| `title` | ステップタイトル | `CSV Parser 実装` |
| `depends_on` | 依存する step_id のリスト | `[S0]` |
| `files` | 作成・変更するファイルパス | `[src/lib/csv-parser.ts, ...]` |
| `type` | ステップ種別 | `setup` / `feature` / `integration` / `verification` |

### 出力例

```
S0: プロジェクト初期設定 (setup)
  depends_on: []
  files: [src/types.ts, src/config.ts]
  type: setup

S1: CSV Parser 実装 (feature)
  depends_on: [S0]
  files: [src/lib/csv-parser.ts, src/lib/csv-parser.test.ts]
  type: feature

S2: Validation schemas 実装 (feature)
  depends_on: [S0]
  files: [src/lib/validation.ts, src/lib/validation.test.ts]
  type: feature

S3: 統合処理 (integration)
  depends_on: [S1, S2]
  files: [src/app/processor.ts, src/app/processor.test.ts]
  type: integration

S4: 全体検証 (verification)
  depends_on: [S3]
  files: []
  type: verification
```

### 依存グラフのルール

1. **setup** → 全 `feature` が依存
2. **feature 同士** → 同じファイルを触る場合のみ依存
3. **integration** → 統合対象の `feature` すべてに依存
4. **verification** → 全ステップに依存（最後）
5. **データ依存**（import 関係）→ 依存に追加
6. **循環依存** → 禁止。検出時はステップを統合して解消

### 並列実行可能性の可視化

```
Level 0: [S0]           ← setup（単独実行）
Level 1: [S1, S2]       ← 並列実行可能
Level 2: [S3]           ← Level 1 完了後に実行
Level 3: [S4]           ← 全体検証
```

## planner 出力フォーマット: API 仕様（条件付き）

実装ステップに API エンドポイントの作成・変更が含まれる場合、planner は依存グラフに加えて **API 仕様** を出力すること。

### 検出条件

以下のいずれかに該当する場合、API 仕様を出力する:
- Issue に API / エンドポイント / REST / GraphQL 等のキーワードが含まれる
- 実装ステップの `files` に `routes/`, `api/`, `controllers/`, `handlers/`, `resolvers/` 等が含まれる
- 新しい HTTP エンドポイントの追加・変更が計画に含まれる

### 出力フォーマット

```
## API 仕様

### POST /api/users
- 認証: 必須 (Bearer Token)
- リクエスト:
  - body: { name: string, email: string }
- レスポンス:
  - 201: { id: string, name: string, email: string, createdAt: string }
  - 400: { error: string, details: { field: string, message: string }[] }
  - 401: { error: "Unauthorized" }
  - 409: { error: "Email already exists" }

### GET /api/users/:id
- 認証: 必須 (Bearer Token)
- パスパラメータ: id (string, UUID)
- レスポンス:
  - 200: { id: string, name: string, email: string, createdAt: string }
  - 404: { error: "User not found" }
```

### 各エンドポイントに含める項目

| 項目 | 必須 | 説明 |
|------|------|------|
| メソッド + パス | Yes | `GET /api/users/:id` |
| 認証 | Yes | 不要 / 必須(方式) |
| リクエスト | Yes | params, query, body のスキーマ |
| レスポンス | Yes | ステータスコード別のスキーマ |
| エラーコード | Yes | 400, 401, 403, 404, 409, 500 等 |
| レート制限 | No | 必要な場合のみ |

### API 仕様の保存先

1. **ユーザー確認時に提示** — 計画と一緒に表示して承認を得る
2. **`docs/api-design.md`** — 承認後にファイルとして保存（実装の setup ステップで作成）
3. **Issue チェックポイント** — context に API 仕様の要約を含める

### API 設計がない場合

API エンドポイントの作成・変更が含まれない場合、このセクションは省略する。

## 連携

- `/issue-flow` Phase 1 で自動実行
- `/tdd` 計画承認後にテスト駆動で実装
- `/code-review` 実装後に5観点レビュー
