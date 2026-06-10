# issue-create 参照: 新規プロジェクト初期セットアップ（Step 1）

SKILL.md の Step 0 で**新規プロジェクト（空リポジトリ）と判定された場合のみ**読む。既存プロジェクトでは不要。
1-2b の `ExitPlanMode` 承認 → 1-3 雛形生成 → 1-4 commit/push という書き込みは、すべてこの承認後に行う。

## Step 1: 初期セットアップ（新規PJのみ）

### 1-1: 要件分析・設計方針

引数からプロジェクトタイプ・機能要件・非機能要件を抽出し、技術選定に必要な設計方針を導出する。ユーザーに提示し、好みがあれば反映。

### 1-2: 技術スタック調査・提案（WebSearch）

設計方針に基づき **WebSearch** で最新ベストプラクティスを調査。**1つの具体的なスタック**を提案する。設計方針の各項目に「なぜこの技術か」を対応づけて説明。

調査対象: フレームワーク最新版、テストFW、リンター、DB/ORM、CI/CD。
ユーザーが部分変更を指示した場合は指定部分のみ差し替えて再提案。

DB選択の詳細は `rules/database.md` を参照。

### 1-2b: リポジトリ visibility / CI / Release / Security の明示確認 ★必須★

**勝手に「使う」前提で雛形を生成しない**。GitHub Actions の CI、`.github/workflows/release.yml`、`dependabot.yml`、`codeql.yml`、`SECURITY.md`、Secret scanning / Push protection の有効化はすべて課金枠・GHAS サブスク・Public 化のいずれかに関わるため、tech-selector で示された決定ポイント（`rules/ci-release.md` 5 段階 + visibility）を**ユーザーに 1 つずつ確認**してから雛形に反映する。

確認項目（tech-selector の出力をそのまま使う想定。新規 PJ なら親側で tech-selector 起動も可）:

| 確認項目 | 選択肢 | 確認の意図 |
|---------|--------|-----------|
| リポジトリ visibility | Public / Private | Private の場合、Secret scanning/CodeQL は GHAS サブスク必要、Actions は分課金枠を消費する旨を伝える |
| CI を使うか | Yes / No | No なら `.github/workflows/ci.yml` を生成しない |
| CI matrix（Yes 時） | Linux のみ / Linux+Windows / 3 OS | コスト差を伝える（macOS は 10x） |
| Release を使うか | Yes / No | No なら `.github/workflows/release.yml` を生成しない |
| Release targets（Yes 時） | 3 OS / Linux のみ / 5 OS / カスタム | - |
| Dependabot alerts/updates | Yes / No | 無料。Yes なら `gh api` で有効化 |
| `dependabot.yml` (version updates) | Yes / No | 無料。Yes なら `.github/dependabot.yml` を生成 |
| Secret scanning + Push protection | Yes / No / N/A | Public は無料。**Private は GHAS 必要** — 未契約なら N/A 扱い |
| CodeQL workflow | Yes / No / N/A | Public は無料。**Private は GHAS 必要 + Actions 分課金** — 未契約なら N/A 扱い |
| Private vulnerability reporting (OSS) | Yes / No | OSS のみ無料 |

**自動デフォルトを置かない**: 「迷ったら全部 Yes」「とりあえず Linux CI + Dependabot」のような暗黙のデフォルトは適用しない。ユーザーが明示的に「全部 No で」「Dependabot だけ Yes」など選択した結果のみを使う。

**Private + GHAS なし** が判明した場合: Secret scanning + Push protection / CodeQL は選択肢として提示しない（または「未契約のため不可」と注記）。「Public 化すれば無料で使える」旨も明示し、選択をユーザーに委ねる。

回答が揃ったら、**生成予定ファイル一覧（特に `.github/**`）と確定スタックを `ExitPlanMode` で計画として提示し、ユーザー承認を得て plan モードを抜ける**。この承認が、Step 1-3 以降の書き込み（雛形生成・commit・`gh api`）と `[gh-check]` マーカーの `user_confirmed=yes` の根拠になる。回答内容は最終的に Step 1-3 の `## CI/Release/Security ファイルの生成ルール` 表で「生成する/しない」に直接マッピングされる。

### 1-3: プロジェクト雛形生成

**ここは 1-2b の ExitPlanMode 承認後（plan モード終了後）に実行する。** 以降はファイル書き込みが発生する。`.github/**` を書く直前には `rules/ci-release.md` の `[gh-check]` マーカーを必ず出力する。

#### 1-3-0: 依存バージョン最新化（必須・先行実行）

**雛形に古い依存を書くと、Dependabot 導入直後に PR が量産される（古ければ古いほど件数が増える）。** 雛形ファイルを書き出す **前** に、外部依存（言語パッケージ・GitHub Actions）の最新版を取得してから書き込むこと。

| 対象 | 取得コマンド |
|------|------------|
| Rust crate | `cargo search <crate> --limit 1` |
| npm パッケージ | `npm view <pkg> version` |
| Python パッケージ | `pip index versions <pkg>` または `uv pip index versions <pkg>` |
| Go モジュール | `go list -m -versions <module>` の末尾 |
| GitHub Actions | `gh api repos/<owner>/<repo>/releases/latest -q .tag_name`（例: `actions/checkout`, `actions/download-artifact`, `actions/upload-artifact`, `softprops/action-gh-release`, `docker/login-action`, `docker/setup-buildx-action`, `dtolnay/rust-toolchain`, `Swatinem/rust-cache`） |
| Docker base image | 公式 `:latest` 指定、または特定タグなら `docker manifest inspect <image>:<tag>` で存在確認 |

**並列で取得する。** 1 メッセージで複数 Bash を同時発行し、全結果を揃えてからファイル生成に反映する。

**完了基準**: `git push` 直後の Dependabot 初回スキャンで **更新可能な依存が 0 件** になること。1 件でも上がる場合は、その依存の最新版を雛形へ反映して再コミットする（または「最新が使えない理由」をユーザーに確認してから旧版を採用する）。

#### 1-3-1: 生成ファイル一覧

確定スタック・最新化済みバージョンに基づき生成:

| カテゴリ | 生成ファイル例 |
|---------|--------------|
| プロジェクト定義 | `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` 等 |
| 言語設定 | `tsconfig.json` / `rustfmt.toml` 等 |
| バージョン管理 | `.gitignore`（言語別テンプレート + DB ファイル除外、`.env*` を含む） |
| 環境変数 | `.env.example`（`DATABASE_URL` を含む。シークレット値は含めない） |
| CI/CD | `.github/workflows/ci.yml` / `release.yml`（**tech-selector の回答に従って条件付き生成**、下表参照） |
| リンター | `biome.json` / `ruff.toml` / `.golangci.yml` 等 |
| ディレクトリ | `src/`, `tests/` 等（言語の慣習に従う） |
| DB | 選択に応じて `docker-compose.yml` / `supabase/` 等 |
| ドキュメント | `README.md`（概要・セットアップ・開発コマンド） |
| GitHub | Issue/PR テンプレート |
| GitHub Security | `.github/dependabot.yml`（必須）、`.github/workflows/codeql.yml`（推奨表で✅時）、`SECURITY.md`（OSSのみ） |
| エディタ | `.editorconfig` |

DB選択に応じた生成内容は `rules/database.md` の「DB選択ガイド」に従う。

#### CI/Release/Security ファイルの生成ルール

tech-selector が提示した 5 決定ポイント (Step 0〜4) の回答に従って条件付きで生成する。詳細は `rules/ci-release.md` / `rules/security.md` を参照。

| tech-selector 回答 | 生成物 |
|-------------------|-------|
| Step 0: CI = No | `.github/workflows/ci.yml` を**作らない** |
| Step 0: CI = Yes / Step 1: Linux のみ | `rules/ci-release.md` の「ci.yml (Linux only)」テンプレを展開 |
| Step 0: CI = Yes / Step 1: Linux + Windows | 「ci.yml (Linux + Windows)」テンプレを展開 |
| Step 0: CI = Yes / Step 1: 3 OS | 「ci.yml (Linux + Windows + macOS)」テンプレを展開 |
| Step 2: Release = No | `.github/workflows/release.yml` を**作らない** |
| Step 2: Release = Yes / Step 3: 3 OS | 「release.yml (3 OS)」テンプレを展開 |
| Step 2: Release = Yes / Step 3: Linux のみ | 「release.yml (Linux のみ)」テンプレを展開 |
| Step 2: Release = Yes / Step 3: 5 OS | 「release.yml (5 OS)」テンプレを展開 or カスタム |
| Step 4: Dependabot 有効 | `rules/ci-release.md` の「dependabot.yml」テンプレを展開（ecosystem は雛形生成時の言語から自動決定、`github-actions` は `.github/workflows/` がある場合に必ず含める） |
| Step 4: CodeQL 有効 | 「codeql.yml」テンプレを展開（`<LANG>` `<MODE>` を言語に応じて置換。Rust の場合 `rust` / `manual` + `cargo build`） |
| Step 4: PVR 有効 (OSS) | `SECURITY.md` を生成（`rules/ci-release.md` の SECURITY.md テンプレを展開） |

**デフォルトでの自動有効化はしない**。Step 1-2b でユーザーが明示的に「使う」と回答した項目だけを生成する。回答が「No」または未選択の場合、対応するファイル（`ci.yml` / `release.yml` / `dependabot.yml` / `codeql.yml` / `SECURITY.md`）は生成しない。GHAS サブスク・Public 化・Actions 課金枠の意思決定はユーザーが持つべきものなので、モデル側で「迷ったら全部 Yes」に倒さない。

#### GitHub Security 設定の有効化（雛形生成後）

ファイル生成だけでは不足。**Step 1-2b でユーザーが「使う」と回答した項目のみ**、初期コミット後に対応する `gh api` を実行する (詳細は `rules/security.md`):

```bash
# Dependabot alerts + automated security updates を Yes と回答した場合のみ
gh api -X PUT /repos/{owner}/{repo}/vulnerability-alerts
gh api -X PUT /repos/{owner}/{repo}/automated-security-fixes

# Private vulnerability reporting を Yes と回答した場合のみ（OSS）
gh api -X PUT /repos/{owner}/{repo}/private-vulnerability-reporting

# Secret scanning + Push protection を Yes と回答した場合のみ（Public または GHAS 契約済 Private）
gh api -X PATCH /repos/{owner}/{repo} \
  -F 'security_and_analysis[secret_scanning][status]=enabled' \
  -F 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
```

ユーザーが「No」と回答した項目は **`gh api` も実行しない**。実行は失敗しても致命的でない（既に有効・権限なし・GHAS 未契約等）。失敗内容を README に「手動有効化が必要な項目」として記載してフォローする。

### 1-4: 初期コミット

```bash
git add -A
git commit -m "chore: プロジェクト初期セットアップ"
git push origin main
```

→ Step 3 へ合流。
