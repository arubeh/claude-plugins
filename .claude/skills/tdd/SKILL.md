---
name: tdd
description: テスト駆動開発ワークフローを強制する。インターフェースを定義し、テストを先に生成し、最小限のコードで実装。80%以上のカバレッジを保証。
---

# TDD スキル

ビルトインの **tdd-guide** エージェントを呼び出し、テスト駆動開発の方法論を強制します。

## 使い方

```
/tdd
/tdd ユーザー認証機能を実装
```

## TDD サイクル

```
RED → GREEN → REFACTOR → REPEAT

RED:      失敗するテストを書く
GREEN:    テストを通す最小限のコードを書く
REFACTOR: テストを維持しながらコードを改善
REPEAT:   次の機能/シナリオへ
```

## ワークフローステップ

### Step 1: ユーザージャーニーを記述
```
[ロール]として、[アクション]を行いたい、なぜなら[メリット]だから
```

### Step 2: インターフェース定義（SCAFFOLD）

公開する型・関数のシグネチャを定義し、本体は未実装にする:

```
# 疑似コード
struct MarketData:
  totalVolume: number
  bidAskSpread: number

function calculateScore(market: MarketData) -> number:
  raise NotImplementedError("未実装")
```

### Step 3: 失敗するテストを記述（RED）

プロジェクトのテストフレームワークに合わせてテストを記述:

```
# 疑似コード（Jest, pytest, Go testing, RSpec 等に読み替え）
test "高い値に対して高スコアを返す":
  market = MarketData(totalVolume=100000, bidAskSpread=0.01)
  score = calculateScore(market)
  assert score > 80

test "エッジケース: ゼロを処理する":
  market = MarketData(totalVolume=0, bidAskSpread=0)
  assert calculateScore(market) == 0
```

### Step 4: テスト実行 - 失敗を確認

プロジェクトのテストコマンドを実行（自動検出）:
- **JS/TS**: `npm test` / `pnpm test` / `vitest`
- **Python**: `pytest`
- **Go**: `go test ./...`
- **Rust**: `cargo test`
- **Java/Kotlin**: `./gradlew test` / `mvn test`

### Step 5: 最小限の実装（GREEN）

テストを通す最小限のコードのみ書く:

```
function calculateScore(market: MarketData) -> number:
  if market.totalVolume == 0:
    return 0
  return min(market.totalVolume / 1000, 100)
```

### Step 6: テスト実行 - 成功を確認

Step 4 と同じテストコマンドを実行。

### Step 7: リファクタリング（IMPROVE）
テストを維持しながらコード品質を改善。併せて docstring を整える:
- [ ] 公開シンボルに docstring を記述した（意図・ドメイン語・副作用を含む）
- [ ] 既存 docstring が実装変更に追随している（drift なし）

詳細な書き方は `rules/coding-style.md` の「検索可能なドキュメントコメント」を参照。

### Step 8: カバレッジ検証

プロジェクトのカバレッジコマンドを実行し 80% 以上を確認:
- **JS/TS**: `npm run test:coverage` / `vitest --coverage`
- **Python**: `pytest --cov`
- **Go**: `go test -cover ./...`
- **Rust**: `cargo tarpaulin`
- **Java/Kotlin**: `./gradlew jacocoTestReport`

## 必須テストすべきエッジケース

1. **Null/空値**: 入力が null・nil・None 等の場合
2. **空**: 配列/文字列が空の場合
3. **不正な型**: 間違った型が渡された場合
4. **境界値**: 最小値/最大値
5. **エラー**: ネットワーク障害、データベースエラー
6. **競合状態**: 並行処理
7. **大量データ**: パフォーマンス
8. **特殊文字**: Unicode、絵文字、SQL文字

## シングルステップモード

フルモード（全ステップ逐次実行）に加え、**1ステップのみ**をスコープ制限付きで TDD 実行するモードを提供する。
`/issue-flow` Phase 3 のレベル別並列実行で使用される。

### 起動パラメータ

| パラメータ | 説明 | 例 |
|-----------|------|-----|
| `step_id` | 実行するステップの ID | `S1` |
| `title` | ステップのタイトル | `CSV Parser 実装` |
| `files` | 作成・変更を許可するファイルパス | `[src/lib/csv-parser.ts, src/lib/csv-parser.test.ts]` |
| `depends_on` | 依存ステップ（情報参照用） | `[S0]` |

### スコープ制限

- **書き込み**: `files` に指定されたファイルのみ変更可（他ファイルは読み取り専用）
- **テスト実行**: 指定ファイルに関連するテストのみ実行
- **import 参照**: 依存ステップで作成されたファイルの読み取り・import は可

### TDD サイクル（シングルステップ）

フルモードと同じ RED → GREEN → REFACTOR サイクルを実行するが、対象を `files` に限定する:

```
1. SCAFFOLD: files 内の型・関数シグネチャを定義
2. RED:      files 内のテストファイルに失敗するテストを記述
3. GREEN:    テストを通す最小限のコードを files 内に実装
4. REFACTOR: files 内のコードを改善（テスト維持）
5. VERIFY:   テスト実行 → 結果を構造化して返す
```

### 構造化された結果出力

シングルステップモード完了時、以下の形式で結果を返す:

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

`status: FAIL` の場合、`error` にエラー内容を含める。

## カバレッジ要件

- **80% 最低** - すべてのコード
- **100% 必須** - 金融計算、認証ロジック、セキュリティ重要コード

## 使用エージェント

| エージェント | 種類 | モデル |
|-------------|------|--------|
| tdd-guide | ビルトイン | inherit |

## 他のスキルとの連携

- `/issue-flow` → Phase 3 で自動的に呼び出される
- `/plan` → 何を構築するか理解する
- `/build-fix` → ビルドエラー修正
- `/code-review` → 実装後に5並列レビュー（品質+セキュリティ+テスト+DB+不要コード）
- `/e2e` → E2Eテスト実行
