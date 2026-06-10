# CI / Release ワークフロー方針

GitHub Actions の CI テストと Release 配布を**いつ**、**どのターゲットで**セットアップするかの判断基準とテンプレート。プロジェクト作成時に `issue-create` / `tech-selector` が参照する。

## ★★★ STOP — 自動生成禁止のファイル一覧 ★★★必読★★★

**以下のファイルは、ユーザーから明示的な Yes 回答を得る前に Edit/Write してはならない。**
auto mode でも `/issue-flow` 中でも `/init-project` 中でも例外なし。**要件定義書・roadmap・
README に「CI 前提」「dependabot 前提」と書かれていても、それは確認の代替にならない**
(計画段階の想定であって実作業時の同意ではない)。

| ファイル | 確認すべきこと |
|---------|---------------|
| `.github/workflows/ci.yml` (および他の CI workflow) | Step 0 (CI やるか) + Step 1 (matrix) |
| `.github/workflows/release.yml` | Step 2 (Release やるか) + Step 3 (targets) |
| `.github/workflows/codeql.yml` | Step 4 + GHAS 契約有無 (Private の場合) |
| `.github/workflows/deny.yml` (cargo-deny CI) | Step 0 と同じ。ローカル運用も valid な選択肢 |
| `.github/dependabot.yml` | Step 4 (Dependabot version updates をやるか) |
| `SECURITY.md` | Private vulnerability reporting (PVR) を有効化するかと同時確認 (OSS のみ対象) |
| `gh api -X PUT /repos/.../vulnerability-alerts` 等の Security 機能有効化 | Step 4 |

### 必須確認手順 (固定順、抜かしてはいけない)

1. **Prereq-A**: リポジトリ visibility (Public / Private) を確認 (`gh repo view --json visibility` 等)
2. **Prereq-B**: Private なら GHAS サブスクの有無をユーザーに確認
3. **Step 0**: CI をやるか? (Yes / No / 後で決める) — No も valid
4. **Step 1**: CI matrix (Linux のみ / +Windows / +macOS)
5. **Step 2**: Release をやるか? (Yes / No)
6. **Step 3**: Release targets (3 OS / Linux のみ / カスタム)
7. **Step 4**: GitHub Security 機能の各項目 (Dependabot alerts/updates、`dependabot.yml`、Secret scanning + Push protection、CodeQL、PVR) を **個別に** Yes/No 確認

→ 回答が揃ったファイル**だけ**を作成する。

### REQUIRED OUTPUT MARKER

`.github/**` 配下のファイルを Edit / Write する直前、**および `gh api` 等でリポジトリの
Security 機能を有効化するコマンドを実行する直前**のメッセージに、必ず次の形式で 1 行出力する:

```
[gh-check] file=<path-or-gh-command> user_confirmed=yes question_ref=<conversation-turn-or-issue#>
```

- `user_confirmed=yes` は、当該ファイル/操作に対するユーザーの **明示的な Yes 回答** が会話/Issue に
  記録されている場合のみ。テンプレ・要件定義書の記述は `user_confirmed` の根拠にならない。
- マーカーが無いまま `.github/**` を Edit/Write、または `gh api -X PUT/POST/PATCH/DELETE`
  等で Security 機能を有効化したら、それは規約違反。レビュー・監査で検出可能。

### 違反例（過去事例）

> 2026-05-03 as2s プロジェクト初期化時、要件定義書 06-license.md / 07-roadmap.md に「CI で
> deny check」「dependabot.yml 生成」と書かれていたため、確認なしで `.github/workflows/ci.yml`
> `deny.yml` `dependabot.yml` を生成 → ユーザーから明確に指摘された。
> 教訓: **ドキュメントの記述は「確認済」ではなく「確認の出発点」**。

## ★前提: 課金・サブスク・公開範囲の確認 ★必読★

GitHub Actions / GitHub Security は **リポジトリ visibility と契約プランで使えるかどうか・無料かどうかが変わる**。`issue-create` で新規プロジェクトを作るときは、雛形生成より先に visibility と「使うかどうか」をユーザーに確認すること。**自動で「使う」前提にしてはいけない**。

| 機能 | Public リポ | Private + GitHub Free | Private + GHAS |
|------|------------|----------------------|----------------|
| GitHub Actions (CI/Release) | 無料・分課金枠なし | 月 2,000 分まで無料、超過分は課金 | プランに応じた分課金枠 |
| Dependabot alerts/updates | 無料 | 無料 | 無料 |
| `dependabot.yml` (version updates) | 無料 | 無料 | 無料 |
| Secret scanning + Push protection | 無料 | **使えない（GHAS 必須）** | 無料 |
| CodeQL workflow | 無料 | **使えない（GHAS 必須）** + Actions 分課金枠を消費 | 利用可 + Actions 分課金枠を消費 |
| Private vulnerability reporting | 無料（OSS のみ） | OSS でないため対象外 | OSS でないため対象外 |

→ Private + GHAS なしのプロジェクトで Secret scanning / CodeQL を使うには、**Public 化** か **GHAS サブスク** のいずれかが必要。`issue-create` ではこの選択をユーザーに委ね、回答が揃うまで `.github/workflows/*.yml` `dependabot.yml` `codeql.yml` `SECURITY.md` の生成と `gh api` での有効化を保留する。

## 基本原則

1. **使うかどうかは必ずユーザーに確認** — 課金・サブスク・公開範囲が絡むため、モデル側で「迷ったら全部 Yes」に倒さない
2. **必要最小限から始める** — 「念のため全 OS 入れておく」は月 $150+ の隠れたコストになる
3. **macOS は特別扱い** — GitHub Actions の macOS runner は **Linux の 10 倍単価** ($0.062/min vs $0.006/min)
4. **CI と Release は別物** — PR ごとの検証 (CI) と配布物作成 (Release) は頻度もコストも分けて判断する

## 意思決定フロー (5 段階 + Prereq)

```
Prereq: リポジトリ visibility は?  ← issue-create で必ずユーザーに確認
  ├─ Public  → Actions / Security 機能はすべて無料
  └─ Private → Actions は分課金枠あり、Secret scanning / CodeQL は GHAS 必要

Step 0: CI をやるか?  ← 必ずユーザーに確認 (No も valid な選択肢)
  ├─ No  → ci.yml を生成しない
  └─ Yes → Step 1 へ

Step 1: CI matrix は?
  ├─ Linux のみ              ← デフォルト (★★★)
  ├─ Linux + Windows          ← Windows 配布あり (★★)
  └─ Linux + Windows + macOS  ← macOS 固有 API 使用時のみ (★)

Step 2: Release をやるか?
  ├─ No  → release.yml を生成しない
  └─ Yes → Step 3 へ

Step 3: Release targets は?
  ├─ 3 OS (Linux x64 + macOS arm64 + Windows x64) ← デフォルト (★★★)
  ├─ Linux のみ (Docker / Web サーバー)           ← (★★)
  ├─ 5 OS (複数アーキテクチャ)                    ← (★)
  └─ カスタム (要件に応じて)

Step 4: GitHub Security 設定は?  (詳細は rules/security.md「GitHub Security 機能の活用」)
  ├─ Dependabot alerts/updates  ← ほぼ常に Yes（実験/POC のみ No）
  ├─ dependabot.yml             ← ecosystem に合わせて生成
  ├─ Secret scanning + Push protection  ← パブリック or GHAS あり
  ├─ CodeQL workflow            ← OSS / 機密データを扱う社内
  └─ Private vulnerability reporting    ← OSS のみ
```

## Step 0: CI をやるか?

| YES 側 | NO 側 |
|--------|-------|
| 複数人が触る (OSS / チーム) | 個人の実験・POC |
| main が production 扱い | throwaway スクリプト |
| テストが意味ある規模 | docs-only / 設定だけのレポ |
| 公開 / 配布する | 一時的な prototype |

**判断はユーザーに委ねる**。Public リポなら Actions は無料で CI 設定のコストは限りなくゼロだが、Private + GitHub Free プランの場合は月 2,000 分の分課金枠を消費する。コスト感とプロジェクト性質を踏まえて、ユーザーが Yes/No を決定する。モデル側で「迷ったら YES」に倒さない。

## Step 1: CI matrix は?

### Linux のみ (デフォルト)

**こんなプロジェクトに**:
- Rust CLI / Go CLI / Node CLI ツール (OS 依存性が薄い実装)
- Web アプリ / API サーバー
- MCP サーバー
- 汎用ライブラリ

**理由**: $0.006/min と最安。本体ロジックのバグは Linux CI で十分捕まる。

### Linux + Windows

**こんなプロジェクトに**:
- Windows 配布バイナリを出す (`.exe` を release.yml で作る)
- パス区切り / 改行コード / エンコーディング / long path の考慮が必要
- subprocess / signal handling を使う

**理由**: Windows は 1.7x ($0.01/min) で受容範囲。Linux で通って Windows で落ちる系のバグ (CRLF, `\\\\`, SIGKILL 等) を PR 時点で検知できる。

### Linux + Windows + macOS

**以下のいずれかに該当する場合のみ**:
- macOS 固有 API を使う (AVFoundation / CoreGraphics / Metal / Accessibility)
- OS 依存の subprocess / IPC が多い
- クライアントが macOS 開発者中心

**注意**: macOS は **10x 単価**。PR ごとに走らせると月 $150-200 になる。paths-filter or weekly cron を併用するか、Release で tag 時のみに限定するのが賢明。

## Step 2: Release をやるか?

| YES 側 | NO 側 |
|--------|-------|
| バイナリ配布 (CLI ツール) | Docker image が別経路で build |
| crates.io / npm 公開 | Web アプリが main push で自動デプロイ |
| tag 単位でバージョン管理 | git dep で使われるライブラリ |
| エンドユーザーに直接届く | 社内ツールで手動デプロイ |

**迷ったら配布形態から決める** — ユーザーが「バイナリをダウンロードして使う」なら YES。

## Step 3: Release targets は?

### 3 OS (デフォルト)

| Target | ランナー |
|--------|---------|
| `x86_64-unknown-linux-gnu` | `ubuntu-latest` |
| `aarch64-apple-darwin` | `macos-latest` (M1+) |
| `x86_64-pc-windows-msvc` | `windows-latest` |

年数回の tag push 時のみ実行されるので macOS 単価も許容範囲。**CLI ツール / デスクトップアプリの事実上の標準**。

### Linux のみ

- Web サーバー / API サーバー
- Docker image ビルド後 push するだけ
- crates.io / npm が対象プラットフォームは吸収する (Rust / Node ライブラリ公開)

### 5 OS (+ arm64)

- Linux x64 + Linux arm64 + macOS x64 + macOS arm64 + Windows x64
- クラウド / ラズパイ / Intel mac / Apple Silicon まで対応したい場合
- **CI コストが倍になる**ので必要性を精査

### カスタム

例: Linux arm64 のみ (組込み)、WASM (ブラウザ) 等。要件に応じて。

## Step 4: GitHub Security 設定は?

CI/Release とセットで判断する。**プロジェクトタイプ別の推奨は `rules/security.md` 「プロジェクトタイプ別の推奨」表** を参照。

意思決定の要点:

| 機能 | 判断基準 | コスト |
|------|---------|-------|
| Dependabot alerts/updates | ほぼ常に Yes（実験/POC は No） | 無料 |
| `dependabot.yml`（version updates）| 依存ある全プロジェクト | 無料（PR が増えるだけ） |
| Secret scanning | パブリック or GHAS 利用可 | 無料 / GHAS |
| Push protection | Secret scanning と同条件、**強く推奨** | 無料 / GHAS |
| CodeQL | OSS / 機密データ扱い / 公開エンドポイント持ち | 無料 / GHAS |
| Private vulnerability reporting | OSS のみ | 無料 |

**有効化の優先順位** (迷ったらこの順):
1. Dependabot alerts (デフォルト ON のはず、明示確認のみ)
2. `dependabot.yml` (5 分で書ける、PR で更新が来るようになる)
3. Push protection (シークレット流入の事前防止)
4. CodeQL (静的解析、コストはほぼゼロ)
5. Private vulnerability reporting (OSS のみ、`SECURITY.md` とセット)

## 依存ライブラリ監査 (言語非依存)

GitHub Security とは別軸で、**依存ライブラリ自体を 4 観点で継続監査する**。商用利用前提なら必須、
実験/POC なら省略可。Rust の `cargo-deny`、JS の `npm audit + license-checker` 等は **同じ概念の
言語別実装**。プロジェクトを横断する共通フレームとして本節を持つ。

### 4 観点 (言語に依らない)

| 観点 | 何を見るか | 商用上の重要度 |
|---|---|---|
| **licenses** | 使用ライセンスが allow リストに収まっているか (GPL/AGPL 等の強コピーレフトを排除) | ★★★ |
| **advisories** | 既知 CVE / 脆弱性 DB と照合し、危険なバージョンを使っていないか | ★★★ |
| **bans** | 「絶対使わない」と決めた特定パッケージを機械的に拒否 (例: 重複競合 crate、メンテ停止 fork) | ★★ |
| **sources** | 公式 registry 以外 (野良 git URL 等) から取得していないか | ★★ |

### 言語別ツール対応表

| 言語 / エコシステム | 主要ツール | カバー観点 | 設定ファイル |
|---|---|---|---|
| Rust (`cargo`) | `cargo-deny` | 4 観点すべて | `deny.toml` |
| Node.js (`npm`/`pnpm`/`yarn`) | `npm audit` + `license-checker` (or `licensee`) | advisories + licenses | `package.json` (allow list を script で) |
| Python (`pip`/`poetry`/`uv`) | `pip-audit` + `pip-licenses` (or `liccheck`) | advisories + licenses | `pyproject.toml` / `liccheck.ini` |
| Go (`go mod`) | `govulncheck` + `go-licenses` | advisories + licenses | スクリプト or Makefile |
| Java/Kotlin (Gradle/Maven) | OWASP `dependency-check` + `license-maven-plugin` (or `licensee` Gradle) | advisories + licenses | `build.gradle` / `pom.xml` |
| Ruby (`bundler`) | `bundler-audit` + `license_finder` | advisories + licenses | `.dependency_decisions.yml` |
| PHP (`composer`) | `composer audit` + `composer licenses` | advisories + licenses | `composer.json` |
| Swift (SwiftPM) | `swift package show-dependencies` + 自前 license 抽出 | licenses (advisories は弱い) | スクリプト |
| Dart/Flutter (`pub`) | `pub deps` + `oss_licenses` 系 | licenses | `pubspec.yaml` |

### 言語横断ツール (multi-language / monorepo / コンテナ向け)

| ツール | カバー範囲 | 使い所 |
|---|---|---|
| **GitHub Dependabot alerts** | advisories のみ (UI/通知ベース) | 全言語、無料、PR 不要、GitHub 上だけで完結。最初に有効化すべき |
| **OSV-Scanner** (Google) | advisories (OSV.dev DB) | 多言語混在 monorepo、軽量 (Linux 数十秒)、CI に最適 |
| **Trivy** (Aqua) | advisories + licenses + SBOM + secret + IaC | container を配布する場合や「全部入り」が欲しい場合 |
| **Grype** + **Syft** (Anchore) | advisories + SBOM | container / バイナリ scan、SBOM 重視 |
| **Snyk** / **Socket** / **Sonatype** | 商用、リアルタイム検知 | 商用契約あり時のみ |

### 「ローカル運用」と「CI 運用」の選び方

| 選択 | 利点 | 欠点 | 向くフェーズ |
|---|---|---|---|
| **ローカル手動** (開発者が時々実行) | 0 コスト、CI 構成不要 | 忘れる、PR 時点で見逃す | 実験 / MVP / Phase 0 |
| **GitHub Dependabot alerts のみ** | 無料、自動、UI 通知 | advisories のみ、license/bans 別途 | 軽量 OSS / 社内ツール |
| **CI で言語別ツール** (`cargo deny check` 等) | 機械的 PR 検証 | 1-2 分/PR、初期セットアップ要 | 商用配布が射程に入った段階 |
| **CI で言語横断ツール** (OSV-Scanner / Trivy) | 多言語対応、SBOM も取れる | 追加学習、設定要 | monorepo / 多言語混在 |

### 推奨パス

1. **全プロジェクト初日**: GitHub Dependabot alerts の有効化を**ユーザーに提案・確認**する（Yes を得てから `gh api -X PUT /repos/.../vulnerability-alerts` を実行。冒頭 STOP セクションのゲート対象。No / 後で も valid）
2. **依存追加が落ち着いてから**: 言語別ツールでローカル監査 (`cargo deny check` / `npm audit` / `pip-audit` 等) を README に手順記載
3. **商用配布が決まったら**: CI に言語別 or 横断ツールの job を追加 (`.github/workflows/dep-audit.yml` 等)
4. **monorepo / 多言語**: OSV-Scanner で統一すると workflow が 1 つで済む

### `.github/workflows/` の生成は本ルール冒頭 STOP セクションのゲートに従う

依存監査 CI を追加するときも、`.github/workflows/dep-audit.yml` (or `deny.yml`) の生成前に
ユーザー確認 + `[gh-check]` マーカーが必要。**「依存監査だから自動で入れていい」は誤り**。

## プロジェクトタイプ別の推奨

| プロジェクトタイプ | CI | Release | GitHub Security |
|-------------------|-----|---------|-----------------|
| Rust/Go CLI ツール (OSS) | Linux のみ | 3 OS | フル（Dependabot + Secret scan + CodeQL + PVR） |
| MCP サーバー (OSS) | Linux のみ | 3 OS | フル |
| Electron デスクトップアプリ | Linux + Windows + macOS | 3 OS + 署名 | フル |
| Next.js Web アプリ | Linux のみ | なし (Vercel 自動) | フル（公開エンドポイント） |
| Express API サーバー | Linux のみ | なし (Docker push) | フル（公開エンドポイント） |
| npm ライブラリ | Linux のみ | Linux のみ (`npm publish`) | フル |
| crates.io ライブラリ | Linux のみ | Linux のみ (`cargo publish`) | フル |
| 社内ツール (private, GHAS なし) | Linux のみ | 配布形態次第 | Dependabot のみ |
| docs リポジトリ | paths-filter 込み軽量 CI or なし | なし | Dependabot のみ |
| 実験 / POC | なし | なし | なし |

## コスト表 (2026 年時点)

| OS | 単価 | 100 分使用 | 備考 |
|----|------|----------|------|
| Linux | $0.006/min | $0.60 | 最安 |
| Windows | $0.010/min (1.7x) | $1.00 | 受容範囲 |
| macOS | **$0.062/min (10x)** | **$6.20** | **要注意** |

Linux x86_64 の macOS 単価がそのまま arm64 (M1) に適用される。Apple Silicon が速い分ジョブ時間は短くなることもあるが、単価は変わらない。

## 既存プロジェクトの見直し

既に CI が走っている場合、以下のサインは「削減の余地あり」:
- 毎 PR で macOS ジョブが走る ($6.32/日 の事例あり — avideo プロジェクトで観測)
- Integration tests が全 matrix で重複実行される
- `cargo test -- --ignored` で perf 系まで全部走る

改善策は `rules/ci-release.md` の方針を適用 + 以下も検討:
- `cargo-nextest` で test 実行高速化
- `actions/cache` で ffmpeg / 重い依存をキャッシュ
- Merge Queue + PR-smoke / merge-full 分離 (GitHub Actions Merge Queue)
- paths-filter で OS 依存コード変更時のみ macOS/Windows を起動

## テンプレート YAML

以下のテンプレは `issue-create` スキルの Step 1-3 でそのまま展開される想定。`<VAR>` は変数。

### ci.yml (Linux only)

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
env:
  CARGO_TERM_COLOR: always  # (Rust の例。言語に合わせて書き換える)
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with: { components: rustfmt, clippy }
      - uses: Swatinem/rust-cache@v2
      - run: cargo fmt --all --check
      - run: cargo clippy --all-targets -- -D warnings
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - run: cargo test --all-features
```

### ci.yml (Linux + Windows)

```yaml
# ... lint は Linux のみ (同上) ...
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with: { key: ${{ matrix.os }} }
      - run: cargo test --all-features
```

### ci.yml (Linux + Windows + macOS)

```yaml
# ... lint は Linux のみ (同上) ...
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with: { key: ${{ matrix.os }} }
      - run: cargo test --all-features
```

### release.yml (3 OS、Rust バイナリ配布)

```yaml
name: Release
on:
  push:
    tags: ['v*.*.*']
permissions:
  contents: write
env:
  BIN_NAME: <BIN_NAME>
jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - target: x86_64-unknown-linux-gnu
            os: ubuntu-latest
            ext: ""
            archive: tar.gz
          - target: aarch64-apple-darwin
            os: macos-latest
            ext: ""
            archive: tar.gz
          - target: x86_64-pc-windows-msvc
            os: windows-latest
            ext: ".exe"
            archive: zip
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with: { targets: ${{ matrix.target }} }
      - uses: Swatinem/rust-cache@v2
        with: { key: ${{ matrix.target }} }
      - name: Build
        shell: bash
        run: cargo build --release --target ${{ matrix.target }}
      - name: Stage & archive
        shell: bash
        run: |
          mkdir -p dist
          stage="${BIN_NAME}-${{ matrix.target }}"
          mkdir -p "$stage"
          cp "target/${{ matrix.target }}/release/${BIN_NAME}${{ matrix.ext }}" "$stage/"
          cp README.md "$stage/" || true
          if [ "${{ matrix.archive }}" = "zip" ]; then
            7z a "dist/${stage}.zip" "$stage"
          else
            tar -czf "dist/${stage}.tar.gz" "$stage"
          fi
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.target }}
          path: dist/*
  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with: { path: dist, merge-multiple: true }
      - uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          generate_release_notes: true
          files: dist/*
```

### release.yml (Linux のみ)

3 OS 版から matrix を 1 行に絞る:

```yaml
matrix:
  include:
    - target: x86_64-unknown-linux-gnu
      os: ubuntu-latest
      ext: ""
      archive: tar.gz
```

### dependabot.yml (Step 4)

`.github/dependabot.yml` に配置。**プロジェクトの ecosystem に合わせて `package-ecosystem` を選択**する。`github-actions` は workflows を持つ全プロジェクトに必須。

```yaml
version: 2
updates:
  # GitHub Actions ワークフロー (workflows がある全プロジェクトで必須)
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    groups:
      actions:
        patterns: ["*"]

  # 言語別 ecosystem (該当するものだけ残す)
  - package-ecosystem: "<ECOSYSTEM>"
    # 選択肢:
    #   cargo     ← Rust (Cargo.toml)
    #   npm       ← Node.js (package.json)
    #   pip       ← Python (requirements.txt, pyproject.toml)
    #   gomod     ← Go (go.mod)
    #   gradle    ← Java/Kotlin (build.gradle)
    #   maven     ← Java (pom.xml)
    #   bundler   ← Ruby (Gemfile)
    #   composer  ← PHP (composer.json)
    #   docker    ← Dockerfile
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
    groups:
      patch:
        update-types: ["patch"]
      minor:
        update-types: ["minor"]
```

**複数 ecosystem 同居時** (例: Next.js + Docker): `updates:` 配下にエントリを並べる。

### codeql.yml (Step 4)

`.github/workflows/codeql.yml` に配置。**言語非依存テンプレ**。`<LANG>` をプロジェクト言語に置き換える。

```yaml
name: CodeQL
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 0 * * 1'  # 週次フルスキャン (任意)

permissions:
  actions: read
  contents: read
  security-events: write

jobs:
  analyze:
    name: Analyze (${{ matrix.language }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          # 言語ごとに 1 行。複数言語なら複数行追加
          - language: <LANG>       # javascript-typescript, python, go, java-kotlin, ruby, swift, csharp, c-cpp, rust (preview)
            build-mode: <MODE>     # none / autobuild / manual
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: ${{ matrix.language }}
          build-mode: ${{ matrix.build-mode }}

      # build-mode: manual の場合のみビルドコマンドを記述
      # - if: matrix.build-mode == 'manual'
      #   run: <build command, e.g. cargo build --release>

      - uses: github/codeql-action/analyze@v3
        with:
          category: '/language:${{ matrix.language }}'
```

**build-mode 選択指針**:

| 言語 | build-mode | 補足 |
|------|-----------|------|
| JS/TS, Python, Ruby | `none` | ソース解析のみで十分 |
| Go, Java/Kotlin, C# | `autobuild` | CodeQL が自動推論 |
| C/C++, Swift, Rust | `manual` | ビルドコマンド明記必須 |

**Rust について**: 2026 年時点で **public preview**。`language: rust`, `build-mode: manual` + `cargo build` で利用可。GA 前なので false positive/negative ありうる前提で運用。

### Private vulnerability reporting + SECURITY.md (Step 4, OSS)

OSS で Private vulnerability reporting を有効化したら、ルートに `SECURITY.md` を配置:

```markdown
# Security Policy

## Reporting a Vulnerability

脆弱性を発見した場合、**公開 Issue ではなく** GitHub の
[Security Advisories](../../security/advisories/new) から非公開で報告してください。

## Supported Versions

| Version | Supported |
| ------- | --------- |
| <最新メジャー>.x | ✅ |
| それ以前 | ❌ |
```

## チェックリスト

プロジェクト作成時 / CI 見直し時に確認:

- [ ] Step 0: CI が本当に必要か判断した (なくても済むケースを見落としていないか)
- [ ] Step 1: macOS を PR matrix に入れる**明確な理由**があるか (なければ外す)
- [ ] Step 2: Release が本当に必要か判断した (Docker / 自動デプロイで十分ならなし)
- [ ] Step 3: Release targets が配布対象ユーザーとマッチしているか
- [ ] Step 4: `dependabot.yml` を生成した (ecosystem 漏れなし、`github-actions` を含む)
- [ ] Step 4: プロジェクトタイプ表に従い CodeQL / Secret scanning / PVR を判定した
- [ ] Step 4: OSS の場合 `SECURITY.md` を作成し PVR を有効化した
- [ ] コスト試算をドキュメントに残した (将来の見直し時の参照用)
