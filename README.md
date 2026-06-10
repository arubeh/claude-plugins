# claude-plugins

arubeh の **Claude Code プラグイン marketplace**（クローズド配布）。
リポジトリ自身が marketplace を兼ねる（`.claude-plugin/marketplace.json`）。**このリポに read 権限がある人だけ**が追加・インストールできる＝公開 marketplace には載せないクローズド配布。

## 収録プラグイン

| プラグイン | 説明 |
|-----------|------|
| [`arag-memory`](plugins/arag-memory/) | arag を記憶バックエンドにした Claude Code 継続学習ループ。recall/capture を二層（フック＋MCP）で行い、汎用知識は全PJ共通 global へ自動昇格。インストール=オプトイン・未参加PJでは no-op。 |

---

## インストール（プライベート marketplace）

1. （初回のみ）GitHub 認証。プライベートリポへのアクセスに必要:

   ```bash
   gh auth login        # HTTPS / Login with a web browser
   gh auth status       # 認証確認
   ```

2. Claude Code で marketplace を追加 → プラグインをインストール（`/plugin` はスラッシュコマンド）:

   ```
   /plugin marketplace add arubeh/claude-plugins
   /plugin install arag-memory@claude-plugins
   ```

   - marketplace 名 `claude-plugins` は `marketplace.json` の `name`。プラグインは `arag-memory@claude-plugins` で参照。
   - 無効化は `/plugin disable arag-memory@claude-plugins`、削除は `/plugin uninstall arag-memory@claude-plugins`。

3. 更新:

   ```
   /plugin marketplace update claude-plugins
   ```

> **プライベートリポの自動更新**: バックグラウンド更新を効かせる場合は環境変数 `GITHUB_TOKEN`（または `GH_TOKEN`）を設定する（対話プロンプトをブロックしないため）。

---

## プラグインを更新したとき（開発者向け手順）

プラグインの中身（hooks / bin / skills / .mcp.json など）を変更したら、以下の順で公開する:

1. **バージョンを 2 箇所同期して上げる**（必須・忘れやすい）:
   - `plugins/<name>/.claude-plugin/plugin.json` の `version`
   - `.claude-plugin/marketplace.json` の該当プラグインの `version`
   - description を変えた場合も両ファイルで揃える。

2. **ローカル読み込みで動作確認**（marketplace を経由しない）:

   ```bash
   claude --plugin-dir /path/to/claude-plugins/plugins/<name>
   ```

3. **commit & push**（main に入った時点で配布された状態になる。リポ自身が marketplace のためリリース作業は不要）:

   ```bash
   git add -A
   git commit -m "feat(<name>): 変更内容 (vX.Y.Z)"
   git push
   ```

4. **利用者側で更新を取り込む**（各ユーザーが実行）:

   ```
   /plugin marketplace update claude-plugins
   ```

   フック・MCP の変更は Claude Code の再起動後に反映される。

---

## ローカル開発（配布せず手元で試す）

marketplace を経由せず、プラグインディレクトリを直接読み込む:

```bash
claude --plugin-dir /path/to/claude-plugins/plugins/arag-memory
```

---

## arag-memory の使い方

プラグインごとの詳細は各 README を参照:

- [plugins/arag-memory/README.md](plugins/arag-memory/README.md) — できること・前提・スキル一覧
