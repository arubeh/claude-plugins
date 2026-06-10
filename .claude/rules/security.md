# セキュリティガイドライン

## 必須セキュリティチェック

すべてのコミット前に:
- [ ] ハードコードされたシークレットなし（APIキー、パスワード、トークン）
- [ ] すべてのユーザー入力をバリデーション
- [ ] SQLインジェクション防止（パラメータ化クエリ）
- [ ] XSS防止（HTMLサニタイズ）
- [ ] CSRF保護有効
- [ ] 認証/認可の検証
- [ ] すべてのエンドポイントにレート制限
- [ ] エラーメッセージが機密データを漏洩しない

## シークレット管理

```
# 絶対NG: ハードコードされたシークレット
apiKey = "sk-proj-xxxxx"

# 常にOK: 環境変数から取得
apiKey = getEnv("OPENAI_API_KEY")

if apiKey is empty:
  raise Error("OPENAI_API_KEY が設定されていません")
```

言語ごとの環境変数アクセス:
- **JS/TS**: `process.env.KEY`
- **Python**: `os.environ["KEY"]` / `os.getenv("KEY")`
- **Go**: `os.Getenv("KEY")`
- **Rust**: `std::env::var("KEY")`
- **Java/Kotlin**: `System.getenv("KEY")`

## セキュリティ対応プロトコル

セキュリティ問題が発見された場合:
1. 即座に停止
2. **security-reviewer** エージェントを使用
3. CRITICALな問題を修正してから続行
4. 公開されたシークレットをローテート
5. 類似の問題がないかコードベース全体をレビュー

## GitHub Security 機能の活用

**コード自体の脆弱性対策（上記）に加え、リポジトリ運用面の防御層を有効化する。**
GitHub が提供する 4 機能（Dependabot / Secret scanning / CodeQL / Private vulnerability reporting）を、プロジェクトタイプに応じて選択的に導入する。

### ★前提: 有効化はユーザー確認後 ★必読★

Secret scanning / CodeQL は **Private リポジトリでは GitHub Advanced Security (GHAS) サブスクが必須**。GHAS なしの Private リポで使うには **Public 化** か **GHAS 契約** のいずれかが必要。`issue-create` で新規プロジェクトを作るときは、これらを「自動で有効化」せず、visibility・サブスク状況とあわせてユーザーに使うかどうか明示確認すること。

| 機能 | Public | Private + GHAS なし | Private + GHAS |
|------|------|---------------------|----------------|
| Dependabot alerts/updates | 無料 | 無料 | 無料 |
| `dependabot.yml` | 無料 | 無料 | 無料 |
| Secret scanning + Push protection | 無料 | **不可（要 GHAS or Public 化）** | 無料 |
| CodeQL | 無料 | **不可（要 GHAS or Public 化）** | 利用可 |
| Private vulnerability reporting | OSS は無料 | 対象外 | 対象外 |

→ ユーザーが Yes と回答した項目だけ `gh api` で有効化し、対応するファイル（`dependabot.yml` / `codeql.yml` / `SECURITY.md`）を生成する。

### プロジェクトタイプ別の推奨

| プロジェクトタイプ | Dependabot alerts/updates | Secret scanning + Push protection | CodeQL | Private vuln. reporting |
|---|---|---|---|---|
| OSS（公開リポ・配布あり）| ✅ | ✅ | ✅ | ✅ |
| 社内/プライベート（GHAS あり）| ✅ | ✅ | ✅ | — |
| 社内/プライベート（GHAS なし）| ✅ | — | — | — |
| 実験 / POC | — | — | — | — |

**前提**:
- Dependabot alerts / Secret scanning（パブリックリポ）/ Private vulnerability reporting は **無料**
- Secret scanning（プライベートリポ）/ CodeQL（プライベートリポ）は **GitHub Advanced Security (GHAS)** が必要

### 各機能の役割

| 機能 | 何を防ぐか | 設定方法 |
|------|----------|---------|
| **Dependabot alerts** | 既知 CVE を持つ依存パッケージの放置 | UI / `gh api` で有効化 |
| **Dependabot security updates** | 脆弱性ある依存の更新漏れ | UI / `gh api` で有効化 |
| **Dependabot version updates** | バージョン乖離による技術負債 | `.github/dependabot.yml` |
| **Secret scanning** | コミット済みシークレットの放置 | UI で有効化 |
| **Push protection** | シークレットの**新規流入** | UI で有効化（推奨） |
| **CodeQL** | SQLi / XSS / パストラバーサル等の静的検出 | `.github/workflows/codeql.yml` |
| **Private vulnerability reporting** | OSS の脆弱性が公開で晒される | UI / `gh api` で有効化 |

ファイルテンプレート（`dependabot.yml` / `codeql.yml`）は `rules/ci-release.md` を参照。

### CLI/API での有効化

```bash
# Dependabot alerts + automated security updates
gh api -X PUT /repos/{owner}/{repo}/vulnerability-alerts
gh api -X PUT /repos/{owner}/{repo}/automated-security-fixes

# Private vulnerability reporting（OSS 推奨）
gh api -X PUT /repos/{owner}/{repo}/private-vulnerability-reporting

# Secret scanning + Push protection（GHAS 利用可能なリポのみ）
gh api -X PATCH /repos/{owner}/{repo} \
  -F 'security_and_analysis[secret_scanning][status]=enabled' \
  -F 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
```

### Private vulnerability reporting を有効化したら

`SECURITY.md` を作成し、報告窓口を案内する:

```markdown
# Security Policy

脆弱性を発見した場合、公開 Issue ではなく
[Security Advisories](../../security/advisories/new) から非公開で報告してください。
```

### チェックリスト（プロジェクト作成・棚卸し時）

- [ ] プロジェクトタイプを判定し、推奨表に従い必要な機能を選定した
- [ ] Dependabot alerts + security updates を有効化した
- [ ] `.github/dependabot.yml` をプロジェクトの ecosystem に合わせて生成した
- [ ] OSS の場合、Private vulnerability reporting を有効化し `SECURITY.md` を作成した
- [ ] Secret scanning + Push protection を有効化した（GHAS 利用可時）
- [ ] CodeQL workflow を生成した（推奨表で ✅ の場合）
