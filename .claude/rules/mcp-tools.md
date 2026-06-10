# MCP ツール利用ガイドライン

Claude Code / Cursor で **MCP (Model Context Protocol) サーバーが有効な場合**、専用ツールを優先利用する。grep/find/sed では取れない構造的・意味的な文脈情報が得られるため、品質と速度の両面で優位。

## 基本原則

1. **作業開始時に有効な MCP サーバーを確認する** — システムリマインダーや起動時の通知で `mcp__<server>__*` 形式のツールが列挙されているかを確認
2. **MCP が機能を提供する操作は、MCP 経由で行う** — grep/find で代替できる場合でも、MCP の方が正確で文脈情報が豊富
3. **編集前に影響範囲を把握する** — 特に cgc が有効な場合、`impact()` で blast radius を確認してから編集に入る

## cgc (Code Graph Context)

ソースコードの構造解析・依存関係追跡用。シンボル単位でインデックスを持ち、関数の呼び出し関係や型の影響範囲を高速に取得できる。

### 編集前に必ず実行（cgc 有効 + 対象ファイルがインデックス済み）

```
1. mcp__cgc__context(symbol)   ← シンボルの 360 度ビュー（定義・型・周辺コード）
2. mcp__cgc__impact(symbol)    ← 呼び出し元・呼び出し先・関連テスト・リスクレベル
3. リスク評価 → 編集 → テスト
```

### 必ず使う場面

- **既存シンボルの編集前**: `context` + `impact` で blast radius を確認
- **シンボルのリネーム**: `mcp__cgc__rename` を使用（grep+sed の置換は import/参照漏れを起こしやすい）
- **デッドコード検出**: `mcp__cgc__find_dead_code`
- **複雑度の高い関数の特定**: `mcp__cgc__most_complex_functions`, `mcp__cgc__cyclomatic_complexity`

### 推奨する場面

- **大規模リファクタリング前のコールチェーン把握**: `find_callers`, `find_callees`, `find_call_chain`
- **シンボル/コード片の検索**: `find_code`, `find_literal`（grep より高速・文脈付き）
- **影響を受けるテストの特定**: `affected_tests`
- **DB カラム変更時の波及確認**: `column_impact`, `column_invariants`
- **コードベース全体の見取り図**: `class_hierarchy`, `server_info`, `list_repositories`

### Graph 鮮度確認 (重要・編集前必須)

`cgc mcp start` の `--watch` (既定 ON) は inotify ベースの**増分**追従であり、**プロジェクト構造の大改変 (例: `apps/x/` → `crates/x-cli/` のレイアウト migration) を検知しない**。古いシンボルが graph に残り続け、`context()` / `impact()` は **stale な path を返す**。

**stale 検知のシグナル** (どれか 1 つでも該当したら graph は信用できない):

1. `mcp__cgc__context(<symbol>)` の返却 path が **現存しない** (例: `apps/x/src/...` だが今は `crates/x-cli/src/...`)
2. `mcp__cgc__list_repositories` の `path` が現在の repo root と異なる、または存在しない
3. graph build 時刻が `git log -1 --format=%ct` より明確に古い

**stale 検知時の正しい対応**:

```
cgc index .       # bash / cmd / pwsh いずれからでも呼べる cross-platform binary
                  # その後 mcp__cgc__reload_graph で in-memory graph をリロード
```

**間違った対応 (やってはいけない)**:

- 「session の権限外」と判断して `cgc index` を skip する → cgc は単純な CLI コマンド、`Bash` ツールから呼べる
- waiver「対象ファイルがインデックス未登録」を流用する → 鮮度の問題は waiver ではない (graph は存在するがズレている)
- grep / find で代替して終わる → blast radius を見失う

### resolver の弱点と rg フォールバック (言語中立)

cgc は **call graph (関数呼び出しの追跡) には強いが、type reference (型参照の追跡) には弱い**。これは特定言語の問題ではなく、cgc が対応する全言語に共通する構造的弱点 (cgc 本体の Issue で resolver 強化を追跡中)。

**空振りシグナル**（cgc が型を取りこぼしている兆候）:

- `find_callers(<TypeName>)` が「明らかに存在するはずの参照箇所」を返さない
- `impact(<TypeName>)` の callers が定義ファイル内に閉じている
- 単一ファイルに留まるはずのない型なのに 0 件 / 極端に少ない結果

**フォールバック原則** (言語特化の cheatsheet は持たない):

| 用途 | 一次ツール | 補足 |
|------|----------|------|
| 関数呼び出しの追跡 | cgc (`find_callers` / `impact`) | 通常は cgc で完結 |
| 型 (class / struct / interface / enum / trait など) の参照位置 | **最初から rg** | cgc では現状取れない |
| import / use / require 等の依存宣言文 | **rg** | 同上 |
| 型注釈位置 (引数 / 戻り値 / フィールド / ジェネリクス引数) | **rg** | 同上 |
| 修飾名による参照 (`a.b.T` / `a::b::T` 等の名前空間付き参照) | **rg** | 同上 |

**rg の汎用パターン**（言語名でテーブル化せず、概念で覚える）:

- 対象シンボルの全参照: `rg "<Symbol>"`
- 言語フィルタ: `rg "<Symbol>" --type <lang>` （`rg --type-list` で利用可能な言語を確認）
- 完全一致語のみ: `rg "\b<Symbol>\b"`
- 依存宣言文に絞る: `rg "(import|use|require|from).*<Symbol>"` 等、必要なキーワードを or で並べる

**注意**:

- resolver が強化されればこのフォールバックは不要になる。cgc 本体の進捗で運用を見直す
- rg は名前ベースなので同名別シンボルにヒットする可能性がある。`context()` の出力で文脈を確認する
- `[cgc-check]` マーカーは call graph 部分の責任の証跡。rg フォールバックを使ったときも省略しない (調査結果を反映した risk 評価を含める)

### 使用しない場面（policy waiver — 厳格に解釈する）

waiver は以下の 3 種に**限定**する。「stale graph」も「resolver の弱点」も waiver に**含まれない** (それぞれ上記の手順で対処する):

- **対象ファイルが cgc グラフに真に未登録**: 新規ファイル / `cgc index` 未実行の repo / `cgc list-repositories` で repo 自体が listed されていない
- **ドキュメント・設定ファイルの編集**: `.md`, `.yml`, `.json`, `.toml` 等（コードグラフの対象外）
- **typo 修正・コメント追加・フォーマット修正**: 文脈把握が不要な軽微変更

### 出力マーカー（編集前のセルフチェック）

cgc が有効なソースコードを編集する場合、編集ツール呼び出し直前のメッセージに以下のマーカーを 1 行含める:

```
[cgc-check] symbol=<name> risk=<LOW|MEDIUM|HIGH|CRITICAL> callers=<N>
```

これにより「impact を見ずに編集していないか」が後から監査可能になる。

## acdp (Browser MCP)

E2E テスト・UI 動作確認用。Chrome DevTools Protocol ベースで Playwright MCP 互換 API を提供する。

### 使う場面

- UI 変更後の動作確認（golden path + edge case）
- スクリーンショットでの差分確認・回帰検出
- フォーム入力・クリック・ナビゲーション等のインタラクション検証

### 推奨フロー

- **テスト仕様書がある場合**: `/ui-test` スキル経由
- **手動確認**: `browser_navigate` → `browser_snapshot` → 各種操作（`browser_click`, `browser_type` 等）

### 使用しない場面

- ユニットテストで完結する変更
- バックエンドのみの変更で UI に影響がない

## その他の MCP サーバー

新規 MCP サーバーが追加された場合は、本ファイルに利用ガイドラインを追記する。
基本原則は変わらず、「**専用ツールが提供する文脈は専用ツール経由で取得する**」。

## 利用判断フロー

```
作業開始
  ↓
有効な MCP サーバーを確認
  ↓
作業内容を分類
  ├─ コードのシンボル編集 → cgc 有効 & 対象がインデックス済み？
  │   ├─ Yes → context + impact 必須
  │   └─ No  → grep/Read で対応
  │
  ├─ UI 動作確認 → acdp 有効？
  │   ├─ Yes → /ui-test or browser_* で実機確認
  │   └─ No  → 手動確認の指示をユーザーに案内
  │
  └─ ドキュメント・設定編集 → MCP 不要、Edit/Write で直接対応
```

## チェックリスト

- [ ] 作業開始時に有効な MCP サーバー（`mcp__*` ツール）を把握した
- [ ] cgc 有効 + コード変更で、`context()` + `impact()` を実行してから編集した
- [ ] cgc-check マーカーを編集ツール呼び出し前のメッセージに含めた
- [ ] UI 変更で acdp 有効な場合、ブラウザでの動作確認を行った
- [ ] grep で済ませず、MCP で取得すべき文脈を取得している
