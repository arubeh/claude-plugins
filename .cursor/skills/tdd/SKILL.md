---
name: tdd
description: テスト駆動開発を強制する。インターフェース定義→テスト先に生成→最小限の実装。カバレッジ80%以上を保証。Use when implementing features or user asks for /tdd.
---

# TDD スキル

RED → GREEN → REFACTOR のサイクルでテスト駆動開発を実行する。

## 使い方

```
/tdd
/tdd ユーザー認証機能を実装
```

## TDD サイクル

```
RED:      失敗するテストを書く
GREEN:    テストを通す最小限のコードを書く
REFACTOR: テストを維持しながらコードを改善
REPEAT:   次の機能/シナリオへ
```

## ワークフローステップ

1. **ユーザージャーニー記述** — [ロール]として、[アクション]を行いたい、なぜなら[メリット]だから
2. **インターフェース定義（SCAFFOLD）** — 公開する型・関数のシグネチャを定義、本体は未実装
3. **RED** — 失敗するテストを記述（プロジェクトのテストフレームワークに合わせる）
4. **テスト実行** — 失敗を確認（npm test, pytest, go test, cargo test 等を自動検出）
5. **GREEN** — テストを通す最小限の実装のみ
6. **REFACTOR** — テストを維持したままコード改善。併せて公開シンボルの docstring を整える（意図・ドメイン語・副作用を含む / drift なし。詳細は `rules/coding-style.mdc` の「検索可能なドキュメントコメント」）
7. カバレッジ 80% 以上を確認

## 判定基準

- **PASS**: 全テスト成功 AND カバレッジ 80% 以上
- 金融計算・認証・認可・セキュリティ重要コードは 100% 必須

## シングルステップモード

フルモード（全ステップ逐次実行）に加え、**1ステップのみ**をスコープ制限付きで TDD 実行するモード。
`/issue-flow` Phase 3 のレベル別並列実行で使用される。

### 起動パラメータ

| パラメータ | 説明 | 例 |
|-----------|------|-----|
| `step_id` | 実行するステップの ID | `S1` |
| `title` | ステップのタイトル | `CSV Parser 実装` |
| `files` | 作成・変更を許可するファイルパス | `[src/lib/csv-parser.ts, src/lib/csv-parser.test.ts]` |
| `depends_on` | 依存ステップ（情報参照用） | `[S0]` |

### スコープ制限

- **書き込み**: `files` に指定されたファイルのみ変更可（他は読み取り専用）
- **テスト実行**: 指定ファイルに関連するテストのみ
- **import 参照**: 依存ステップで作成されたファイルの読み取り・import は可

### TDD サイクル（シングルステップ）

```
1. SCAFFOLD: files 内の型・関数シグネチャを定義
2. RED:      files 内のテストファイルに失敗するテストを記述
3. GREEN:    テストを通す最小限のコードを files 内に実装
4. REFACTOR: files 内のコードを改善（テスト維持）
5. VERIFY:   テスト実行 → 結果を構造化して返す
```

### 構造化された結果出力

```
step_id: S1
status: SUCCESS | FAIL
files:
  - path: src/lib/csv-parser.ts
    action: created
  - path: src/lib/csv-parser.test.ts
    action: created
test_results:
  total: 8
  passed: 8
  failed: 0
  coverage: 92%
error: null
```

## 連携

- `/issue-flow` Phase 3 で自動実行
- ビルドエラー時は `/build-fix` で修正
- 実装後は `/code-review` でレビュー
