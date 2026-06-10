# コーディングスタイル

## イミュータビリティ（重要）

常に新しいオブジェクトを作成し、決してミューテートしない:

```
# NG: ミューテーション
function updateUser(user, name):
  user.name = name   # 引数を直接変更している!
  return user

# OK: イミュータビリティ（コピーを返す）
function updateUser(user, name):
  return copy(user, name=name)
```

言語ごとのイミュータブル手法:
- **JS/TS**: スプレッド構文 `{ ...obj, key: value }`、`Object.freeze()`
- **Python**: `dataclasses(frozen=True)`、`copy.deepcopy()`、`|` マージ
- **Go**: 値レシーバでコピーを返す
- **Rust**: デフォルトで所有権・借用、`Clone` トレイト
- **Java/Kotlin**: `record`、`data class`（`copy()`）

## ファイル構成

多数の小さなファイル > 少数の大きなファイル:
- 高凝集、低結合
- 200-400行が標準、800行が最大
- 大きなモジュールからユーティリティを抽出
- 型別ではなく機能/ドメイン別に整理

## エラー処理

常にエラーを包括的に処理:

```
# 例外ベースの言語（Python, JS/TS, Java, Ruby など）
try:
  result = riskyOperation()
  return result
catch error:
  log.error("操作失敗:", error)
  raise AppError("詳細なユーザーフレンドリーメッセージ")

# 戻り値ベースの言語（Go, Rust など）
result, err = riskyOperation()
if err != nil:
  log.error("操作失敗:", err)
  return nil, AppError("詳細なユーザーフレンドリーメッセージ")
```

## 入力バリデーション

常にユーザー入力をバリデーション。言語のエコシステムに適したバリデーションライブラリを使用:

```
# 疑似コード: スキーマベースのバリデーション
schema = Schema({
  email: String & Email,
  age:   Integer & Range(0, 150)
})
validated = schema.validate(input)
```

言語ごとの推奨ライブラリ:
- **JS/TS**: `zod`, `yup`, `joi`
- **Python**: `pydantic`, `marshmallow`, `cerberus`
- **Go**: `go-playground/validator`
- **Rust**: `validator` クレート
- **Java/Kotlin**: Bean Validation (`jakarta.validation`)

## スキーマ↔API↔画面の三層整合性

**DBスキーマにFKがある場合、参照先テーブルのCRUD API・管理画面が揃っていることを確認する。**

新しいテーブルを追加、または既存テーブルを FK で参照する場合:

1. **スキーマ層**: FK 参照先テーブルが存在する
2. **API 層**: 参照先テーブルの CRUD（少なくとも一覧取得 GET）API が存在する
3. **画面層**: 参照先テーブルの管理画面（少なくとも一覧・登録）が存在する

いずれかが欠けている場合、先行して不足分を実装するか、Issue で管理する。

```
# 例: lease_contracts テーブルが listing_agency_id FK を持つ場合
✓ スキーマ: listing_agencies テーブルあり
✓ API:     GET /api/v1/listing-agencies あり
✓ 画面:    /dashboard/listing-agencies 一覧画面あり
→ 三層整合: OK

# NG例: テーブルとAPIはあるが管理画面がない
✓ スキーマ: listing_agencies テーブルあり
✓ API:     GET /api/v1/listing-agencies あり
✗ 画面:    管理画面なし
→ 三層整合: NG（画面を先に実装するか Issue 化する）
```

## 検索可能なドキュメントコメント（docstring）

**コードは書かれるより読まれる回数の方が圧倒的に多い。** 読み手は人間のレビュアーだけでなく、将来のコード検索や AI アシスタントによる横断探索も含まれる。docstring は「この関数を見つけるための導線」そのものであり、自然言語として検索に耐える質が求められる。

### 適用対象

- **必須**: 公開シンボル（`pub` / `export` / `public` / モジュール外から参照されるもの、公開 API、トレイト/インターフェース）
- **任意**: private / internal（意図が自明なら省略可、自明でないなら書く）
- **不要**: trivial な getter/setter、test 関数の本体

### 書き方の原則

1. **1 行目は意図を自然言語の 1 文で書く。** 関数名の言い換えは情報ゼロなので禁止。
   ```
   # NG: 関数名の繰り返し
   /// Gets the user.
   fn get_user(id: UserId) -> Option<User> { ... }

   # OK: 意図 + 対象 + 条件を含む
   /// Fetches the authenticated user profile from the primary DB,
   /// returning None for soft-deleted accounts.
   fn get_user(id: UserId) -> Option<User> { ... }
   ```

2. **ドメイン語を含める。** 探す人がその語で引くであろう機能名・エラー種別・画面名・テーブル名・ビジネス概念を文章中に埋め込む（"authentication", "listing agency", "rent-roll", "dead-letter queue" 等）。

3. **副作用・例外・エッジケースを明記する。**
   - 外部 I/O（DB 書込、ネットワーク呼び出し、ファイル操作）
   - panic / throws / Err で返す条件
   - キャッシュ、グローバル状態、環境依存
   - 境界（空入力、巨大入力、未認証、権限不足）

4. **コード変更時は docstring も同時に更新する（drift 禁止）。** 古い docstring は無い状態より有害。レビューで必ず差分を確認する。

5. **言語の慣習に従う。**
   - Rust: `///`（アイテム直上）、`//!`（モジュール先頭）
   - Go: `// FuncName does X.` で始める
   - Python: `"""..."""`（Google / NumPy / reST いずれか、プロジェクトで統一）
   - JS/TS, Java, C#, PHP: `/** ... */`（JSDoc / Javadoc 形式）
   - Ruby, Bash, Perl: `# ...`

### NG パターン

- 関数名をそのまま文にしただけ（"Gets user by id" on `get_user_by_id`）
- WHAT でなく HOW の逐次列挙（実装手順の写経は読み手の助けにならない）
- `TODO: describe later` のまま放置
- コピペされたテンプレ文（全関数に同じ `/** A function. */`）

### 判定基準

**「半年後にこのコードベースを初めて見る人が、この機能をキーワードで検索して上位にヒットし、docstring だけで用途を判断できるか？」** → Yes なら合格。

## コード品質チェックリスト

作業完了前に確認:
- [ ] コードが読みやすく適切に命名されている
- [ ] 関数が小さい（<50行）
- [ ] ファイルが焦点を絞っている（<800行）
- [ ] 深いネストがない（>4レベル）
- [ ] 適切なエラー処理
- [ ] デバッグ用の出力文が残っていない（`console.log`, `print`, `fmt.Println` 等）
- [ ] ハードコードされた値がない
- [ ] ミューテーションがない（イミュータブルパターン使用）
- [ ] FK参照先の三層整合性（スキーマ↔API↔画面）が確保されている
- [ ] 公開シンボルに docstring があり、意図・ドメイン語・副作用が記述されている（drift なし）
