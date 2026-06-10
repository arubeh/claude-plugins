---
paths:
  - "db/**/*"
  - "prisma/**/*"
  - "supabase/**/*"
  - "**/*.sql"
  - "**/migrations/**/*"
  - "docker-compose.yml"
  - "docker-compose.*.yml"
---

# データベース & マイグレーション

## DB選択ガイド

プロジェクトにDBが必要な場合、以下の3択からユーザーに選択を求める。

| # | 選択肢 | DB | 特徴 | 向いているケース |
|---|--------|-----|------|-----------------|
| 1 | **SQLite** | SQLite | ファイルベース、インストール不要、設定ゼロ | プロトタイプ、個人ツール、小規模アプリ、モバイル |
| 2 | **Docker + PostgreSQL** | PostgreSQL | `docker compose up` で起動、本番同等の環境 | チーム開発、本番がPostgreSQL、複雑なクエリ |
| 3 | **Supabase** | PostgreSQL (hosted) | クラウド無料枠、認証・API自動生成付き | BaaS活用、認証込み、フロントエンド中心の開発 |

### 選択フロー

Phase 2（計画）または新規プロジェクトセットアップ時に、DBが必要と判断した場合:

```
■ データベース選択

  この機能にはデータベースが必要です。
  どの構成を使用しますか？

  [SQLite]              セットアップ不要。ファイル1つで動作。
  [Docker + PostgreSQL]  docker compose で本番同等の環境をローカルに構築。
  [Supabase]            クラウド無料枠。認証・REST API 付き。
```

### 選択肢ごとの構成

#### SQLite

```
生成ファイル:
  db/database.sqlite        ← .gitignore に追加
  db/migrations/            ← マイグレーションディレクトリ
  .env.example              ← DATABASE_URL=file:./db/database.sqlite

推奨ORM/ツール:
  Node.js:  Prisma (provider="sqlite"), Drizzle (better-sqlite3), Knex
  Python:   SQLAlchemy + aiosqlite, Django (デフォルト)
  Go:       modernc.org/sqlite + golang-migrate

注意事項:
  - .sqlite ファイルは .gitignore に含める
  - 同時書き込みに制限あり（WAL モード推奨）
  - 本番移行時は PostgreSQL への切り替えが必要
```

#### Docker + PostgreSQL

```
生成ファイル:
  docker-compose.yml        ← PostgreSQL + (必要に応じて) pgAdmin
  db/migrations/            ← マイグレーションディレクトリ
  db/seeds/                 ← シードデータ
  .env.example              ← DATABASE_URL=postgresql://postgres:postgres@localhost:5432/appdb
  scripts/db-reset.sh       ← DB リセットスクリプト

docker-compose.yml の内容:
  services:
    db:
      image: postgres:17
      environment:
        POSTGRES_USER: postgres
        POSTGRES_PASSWORD: postgres
        POSTGRES_DB: appdb
      ports:
        - "5432:5432"
      volumes:
        - pgdata:/var/lib/postgresql/data
  volumes:
    pgdata:

推奨ORM/ツール:
  Node.js:  Prisma (provider="postgresql"), Drizzle (node-postgres)
  Python:   SQLAlchemy + asyncpg, Django + psycopg
  Go:       pgx + golang-migrate

前提条件:
  - Docker Desktop または Docker Engine がインストール済み
  - README にセットアップ手順を記載
```

#### Supabase

```
生成ファイル:
  supabase/config.toml      ← Supabase CLI 設定（ローカル開発用）
  supabase/migrations/      ← マイグレーションディレクトリ
  supabase/seed.sql          ← シードデータ
  .env.example              ← SUPABASE_URL=, SUPABASE_ANON_KEY=, DATABASE_URL=

推奨ツール:
  マイグレーション: supabase migration new / supabase db push
  ローカル開発:    supabase start（Docker ベースのローカル環境）
  クライアント:    @supabase/supabase-js (JS/TS), supabase-py (Python)

前提条件:
  - Supabase CLI インストール済み（npx supabase または brew install supabase/tap/supabase）
  - Supabase アカウント作成済み（無料枠）
  - README に Supabase プロジェクト作成手順を記載

RLS（Row Level Security）:
  - Supabase はデフォルトで RLS を有効にすることを強く推奨
  - テーブル作成時に ALTER TABLE ... ENABLE ROW LEVEL SECURITY を含める
  - ポリシー定義をマイグレーションに含める
```

### 切り替え・移行パス

```
SQLite → Docker + PostgreSQL:
  1. ORM の provider/driver を変更
  2. マイグレーションを PostgreSQL 向けに再生成
  3. データをエクスポート → インポート

SQLite → Supabase:
  1. Supabase CLI をセットアップ
  2. マイグレーションを supabase/migrations/ に移行
  3. supabase db push で適用

Docker + PostgreSQL → Supabase:
  1. マイグレーションを supabase/migrations/ にコピー
  2. 接続先を Supabase に切り替え
  3. RLS ポリシーを追加
```

## マイグレーション基本原則

### リリース前（初期開発フェーズ）

初期開発中は、スキーマの試行錯誤を素早く行うために **ORM の自動同期やプッシュ系コマンドの使用を許可する**:

```
# OK: リリース前のみ許可
prisma db push              # スキーマをDBに直接反映
drizzle-kit push            # 同上
db.sync({ alter: true })    # ORM の自動同期

# ただし以下は常に NG（データ消失リスク）
db.sync({ force: true })    # テーブルを破壊して再作成
```

リリース前でも、マイグレーションファイルでの管理が **推奨** であることに変わりはない。
プッシュ系コマンドは「素早い試行錯誤」のための例外であり、本番想定のスキーマが固まり次第、マイグレーションファイルに移行すること。

### リリース後（本番運用フェーズ）★必須★

**リリース後は、すべてのスキーマ変更をマイグレーションファイルで管理する。直接のDB操作・ORM自動同期は一切禁止。**

```
# NG: リリース後は禁止
prisma db push                 # マイグレーションを経由していない
drizzle-kit push               # 同上
db.sync({ alter: true })       # ORM の自動同期
db.sync({ force: true })       # テーブルを破壊して再作成
ALTER TABLE users ADD column;   # 手動実行、履歴なし

# OK: マイグレーションファイルで管理
prisma migrate dev --name add_email_to_users
drizzle-kit generate
migrations/20250130_001_add_email_to_users.sql
```

### リリース状態の判定

プロジェクトが「リリース済み」かどうかは以下で判定する:

1. **CLAUDE.md の `## Project Context` に `release: true`** が記載されている
2. **`main` / `master` ブランチにタグ（`v1.0.0` 等）が存在する**
3. **`production` 環境向けの CI/CD パイプラインが存在する**

上記いずれかに該当する場合、リリース済みとみなし、マイグレーションファイルでの管理を **必須** とする。
判断に迷う場合はユーザーに確認する。

## マイグレーションファイル命名規則

```
<タイムスタンプ>_<連番>_<操作>_<対象>.{sql,ts,py,...}
```

| 要素 | 形式 | 例 |
|------|------|-----|
| タイムスタンプ | `YYYYMMDD` | `20250130` |
| 連番 | `NNN` | `001` |
| 操作 | 動詞 | `create`, `add`, `drop`, `alter`, `rename` |
| 対象 | テーブル/カラム名 | `users`, `email_to_users` |

例:
```
20250130_001_create_users.sql
20250130_002_add_email_to_users.sql
20250201_001_create_orders.sql
```

ORMツール固有の命名がある場合（Prisma, Alembic 等）はそちらに従う。

## Up / Down の必須化

すべてのマイグレーションに **up（適用）** と **down（ロールバック）** を用意する:

```sql
-- up: 適用
ALTER TABLE users ADD COLUMN email VARCHAR(255);
CREATE INDEX idx_users_email ON users(email);

-- down: ロールバック
DROP INDEX idx_users_email;
ALTER TABLE users DROP COLUMN email;
```

ORMツールでの例:
- **Prisma**: `prisma migrate` が自動生成（down は `prisma migrate diff` で確認）
- **Drizzle**: `drizzle-kit generate` + 手動 down
- **Alembic**: `upgrade()` / `downgrade()` を必ず両方実装
- **Knex**: `exports.up` / `exports.down`
- **golang-migrate**: `*.up.sql` / `*.down.sql` のペア
- **ActiveRecord**: `change` メソッド（自動可逆）または `up` / `down`

## 破壊的変更の回避: Expand-Contract パターン

カラム削除・リネーム・型変更は **一度にやらない**。段階的に移行する:

```
Phase 1 (Expand):  新カラム追加、両方に書き込み
Phase 2 (Migrate): 既存データを新カラムにコピー
Phase 3 (Contract): アプリを新カラムのみ使用に切替後、旧カラム削除
```

### 具体例: カラムリネーム（name → full_name）

```
# マイグレーション1: Expand（新カラム追加）
ALTER TABLE users ADD COLUMN full_name VARCHAR(255);
UPDATE users SET full_name = name;

# アプリ側: 両方のカラムに書き込むよう変更
# デプロイ後、一定期間運用

# マイグレーション2: Contract（旧カラム削除）
ALTER TABLE users DROP COLUMN name;
```

**以下の操作は単一マイグレーションで行わない:**
- カラム削除（`DROP COLUMN`）
- テーブル削除（`DROP TABLE`）
- カラム型変更（`ALTER COLUMN ... TYPE`）
- NOT NULL 制約の追加（既存データにNULLがある場合）
- カラムリネーム（`RENAME COLUMN`）

## 冪等性

マイグレーションは **冪等（何度実行しても同じ結果）** であること:

```sql
-- OK: 冪等
CREATE TABLE IF NOT EXISTS users (...);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- NG: 非冪等（2回目でエラー）
CREATE TABLE users (...);
CREATE INDEX idx_users_email ON users(email);
```

## データマイグレーション

スキーマ変更とデータ変更は **別のマイグレーションファイル** に分ける:

```
20250130_001_add_status_to_orders.sql       # スキーマ変更
20250130_002_backfill_orders_status.sql      # データ移行
```

データマイグレーションでは:
- バッチ処理で実行（大量 UPDATE を1文で実行しない）
- 進捗ログを出力
- ロールバック手順を明記

## マイグレーションツール選定

プロジェクトの技術スタックに合わせて選択:

| スタック | 推奨ツール |
|---------|-----------|
| **Node.js + SQL** | Knex, Prisma Migrate, Drizzle Kit |
| **Node.js + NoSQL** | migrate-mongo |
| **Python + SQL** | Alembic, Django Migrations |
| **Go + SQL** | golang-migrate, goose, atlas |
| **Rust + SQL** | diesel_migrations, sqlx-migrate |
| **Ruby** | ActiveRecord Migrations |
| **Java/Kotlin** | Flyway, Liquibase |

## マイグレーション実行順序

依存関係を考慮し、以下の順序で設計する:

```
1. 参照先テーブルの作成（親テーブル）
2. 参照元テーブルの作成（子テーブル・外部キー）
3. インデックスの追加
4. データマイグレーション
5. 不要オブジェクトの削除（Contract フェーズ）
```

## 環境別マイグレーション管理

```
development:  ローカルで自由に実行・リセット可能
staging:      本番と同じ手順でマイグレーション検証
production:   レビュー済みマイグレーションのみ適用
```

- 本番適用前に staging で必ず検証する
- seed データはマイグレーションとは別に管理（`seeds/` ディレクトリ）
- テスト用フィクスチャはテストコード内で管理

## チェックリスト

DB変更を含む実装の設計時に確認:
- [ ] マイグレーションファイルで管理されている
- [ ] up / down が両方定義されている
- [ ] 破壊的変更は Expand-Contract パターンで段階的に実行
- [ ] マイグレーションが冪等である
- [ ] スキーマ変更とデータ変更が分離されている
- [ ] 依存順序が正しい（親テーブル → 子テーブル）
- [ ] 本番適用時のダウンタイムを最小化している
- [ ] ロールバック手順が明確である

### リリース後の追加チェック

リリース済みプロジェクトでは上記に加えて以下を確認:
- [ ] `prisma db push` / `drizzle-kit push` 等のプッシュ系コマンドを使用していない
- [ ] ORM の自動同期設定（`synchronize: true` 等）が無効になっている
- [ ] すべてのスキーマ変更にマイグレーションファイルが存在する
- [ ] マイグレーションファイルがバージョン管理（Git）にコミットされている
